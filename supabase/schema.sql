-- CoolFix database setup for Supabase
-- Paano gamitin: Supabase dashboard → SQL Editor → New query → i-paste ito lahat → Run.
-- Ligtas itong patakbuhin ulit (idempotent).

-- ============ PROFILES ============
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer','technician','admin')),
  name text not null default '',
  email text,
  phone text default '',
  addr text default '',
  services text[] not null default '{}',
  online boolean not null default false,
  lat double precision,
  lng double precision,
  google boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Gumagawa ng profile kapag may bagong sign-up. Hindi pwedeng mag-sign up bilang admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, role, name, email, phone, addr, services, google)
  values (
    new.id,
    case when m->>'role' = 'technician' then 'technician' else 'customer' end,
    coalesce(m->>'name', m->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(m->>'phone', ''),
    coalesce(m->>'addr', ''),
    coalesce(array(select jsonb_array_elements_text(m->'services')), '{}'),
    coalesce(new.raw_app_meta_data->>'provider', '') = 'google'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Bawal gawing admin ang sarili, at bawal tanggalin ang pagka-admin, maliban kung admin ka.
create or replace function public.guard_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin()
     and (new.role = 'admin' or old.role = 'admin') then
    raise exception 'Bawal baguhin ang role na ito';
  end if;
  new.id := old.id; new.email := old.email; new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_role();

alter table public.profiles enable row level security;
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid() or role = 'technician' or public.is_admin());
drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- ============ SETTINGS (serbisyo, presyo, iba pang singil) ============
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.settings enable row level security;
drop policy if exists "settings read" on public.settings;
create policy "settings read" on public.settings for select to anon, authenticated using (true);
drop policy if exists "settings admin write" on public.settings;
create policy "settings admin write" on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ============ BOOKINGS ============
create table if not exists public.bookings (
  id bigint generated always as identity primary key,
  code text generated always as ('CF-' || (1000 + id)::text) stored,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  tech_id uuid not null references public.profiles(id) on delete cascade,
  cust_name text not null default '',
  cust_phone text default '',
  tech_name text not null default '',
  svc text not null,
  address text not null default '',
  sched text default '',
  amt integer not null default 0 check (amt >= 0),
  status text not null default 'Bago'
    check (status in ('Bago','Papunta na','Dumating na','Natapos','Kinansela','Tinanggihan')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bookings_customer on public.bookings(customer_id);
create index if not exists bookings_tech on public.bookings(tech_id);

-- Bantay sa pagbabago ng status: ang customer ay pwede lang mag-cancel,
-- ang technician ay pwede lang sa sarili niyang mga hakbang.
create or replace function public.guard_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then new.updated_at := now(); return new; end if;
  if new.customer_id <> old.customer_id or new.tech_id <> old.tech_id or new.amt <> old.amt
     or new.svc <> old.svc then
    raise exception 'Bawal baguhin ang detalye ng booking';
  end if;
  if auth.uid() = old.tech_id then
    if not (new.status in ('Papunta na','Dumating na','Natapos','Tinanggihan')) then
      raise exception 'Bawal ang status na ito';
    end if;
  elsif auth.uid() = old.customer_id then
    if new.status <> old.status and not (new.status = 'Kinansela' and old.status in ('Bago','Papunta na')) then
      raise exception 'Pwede lang i-cancel ang booking bago dumating ang technician';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists bookings_guard on public.bookings;
create trigger bookings_guard before update on public.bookings
  for each row execute function public.guard_booking();

alter table public.bookings enable row level security;
drop policy if exists "bookings read" on public.bookings;
create policy "bookings read" on public.bookings for select to authenticated
  using (customer_id = auth.uid() or tech_id = auth.uid() or public.is_admin());
drop policy if exists "bookings insert" on public.bookings;
create policy "bookings insert" on public.bookings for insert to authenticated
  with check (customer_id = auth.uid() and status = 'Bago'
    and exists (select 1 from public.profiles p where p.id = tech_id and p.role = 'technician'));
drop policy if exists "bookings update" on public.bookings;
create policy "bookings update" on public.bookings for update to authenticated
  using (customer_id = auth.uid() or tech_id = auth.uid() or public.is_admin());

-- ============ CHAT ============
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  tech_id uuid not null references public.profiles(id) on delete cascade,
  cust_name text not null default '',
  tech_name text not null default '',
  read_c timestamptz not null default now(),
  read_t timestamptz not null default 'epoch',
  created_at timestamptz not null default now(),
  unique (customer_id, tech_id)
);
alter table public.conversations enable row level security;
drop policy if exists "conv read" on public.conversations;
create policy "conv read" on public.conversations for select to authenticated
  using (customer_id = auth.uid() or tech_id = auth.uid() or public.is_admin());
drop policy if exists "conv insert" on public.conversations;
create policy "conv insert" on public.conversations for insert to authenticated
  with check (
    (customer_id = auth.uid()
      and exists (select 1 from public.profiles p where p.id = tech_id and p.role = 'technician'))
    or (tech_id = auth.uid()
      and exists (select 1 from public.bookings b where b.tech_id = auth.uid() and b.customer_id = conversations.customer_id)));
drop policy if exists "conv update" on public.conversations;
create policy "conv update" on public.conversations for update to authenticated
  using (customer_id = auth.uid() or tech_id = auth.uid());

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  conv_id uuid not null references public.conversations(id) on delete cascade,
  sender text not null check (sender in ('c','t')),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists messages_conv on public.messages(conv_id, created_at);
alter table public.messages enable row level security;
drop policy if exists "msg read" on public.messages;
create policy "msg read" on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conv_id
    and (c.customer_id = auth.uid() or c.tech_id = auth.uid() or public.is_admin())));
drop policy if exists "msg insert" on public.messages;
create policy "msg insert" on public.messages for insert to authenticated
  with check (exists (select 1 from public.conversations c where c.id = conv_id and (
    (sender = 'c' and c.customer_id = auth.uid()) or (sender = 't' and c.tech_id = auth.uid()))));

-- ============ REALTIME ============
do $$ begin
  begin alter publication supabase_realtime add table public.bookings; exception when others then null; end;
  begin alter publication supabase_realtime add table public.messages; exception when others then null; end;
  begin alter publication supabase_realtime add table public.profiles; exception when others then null; end;
end $$;

-- ============ GAWING ADMIN ANG ACCOUNT MO ============
-- 1) Mag-sign up muna sa app gamit ang email mo.
-- 2) Palitan ang email sa ibaba at patakbuhin ang linyang ito nang mag-isa:
-- update public.profiles set role = 'admin' where email = 'ILAGAY-ANG-EMAIL-MO@example.com';
