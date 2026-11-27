-- CoolFix database schema para sa Supabase.
-- I-paste ang buong file na ito sa Supabase Dashboard > SQL Editor > New query, tapos i-Run.
-- Ligtas itong patakbuhin ulit (idempotent).

-- ============================================================
-- PROFILES: isang row kada user (customer, technician o admin)
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        text not null default 'customer' check (role in ('customer','technician','admin')),
  name        text not null default '',
  phone       text not null default '',
  addr        text not null default '',
  svc         text[] not null default '{}',
  online      boolean not null default false,
  lat         double precision,
  lng         double precision,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- BOOKINGS: bawat request ng customer sa isang technician
-- ============================================================
create table if not exists public.bookings (
  id           bigint generated always as identity primary key,
  customer_id  uuid not null references public.profiles(id) on delete cascade,
  tech_id      uuid not null references public.profiles(id) on delete cascade,
  category     text not null,
  item         text not null,
  amount       integer not null check (amount >= 0),
  extras       jsonb not null default '[]',
  address      text not null default '',
  sched        text not null default '',
  status       text not null default 'pending'
               check (status in ('pending','accepted','enroute','arrived','done','cancelled','declined')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists bookings_customer_idx on public.bookings(customer_id);
create index if not exists bookings_tech_idx on public.bookings(tech_id);

-- ============================================================
-- MESSAGES: chat sa pagitan ng customer at technician
-- ============================================================
create table if not exists public.messages (
  id           bigint generated always as identity primary key,
  customer_id  uuid not null references public.profiles(id) on delete cascade,
  tech_id      uuid not null references public.profiles(id) on delete cascade,
  sender_id    uuid not null references public.profiles(id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 500),
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists messages_pair_idx on public.messages(customer_id, tech_id, created_at);

-- ============================================================
-- SETTINGS: catalog ng serbisyo at iba pang singil (inaayos ng admin)
-- ============================================================
create table if not exists public.settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Gumawa ng profile kapag may bagong sign-up. Hindi kailanman admin ang role mula sa sign-up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  r text := case when m->>'role' = 'technician' then 'technician' else 'customer' end;
begin
  insert into public.profiles (id, role, name, phone, addr, svc)
  values (
    new.id, r,
    left(coalesce(nullif(m->>'name',''), m->>'full_name', split_part(new.email,'@',1), ''), 120),
    left(coalesce(m->>'phone',''), 20),
    left(coalesce(m->>'addr',''), 200),
    case when r = 'technician' and jsonb_typeof(m->'svc') = 'array'
         then array(select jsonb_array_elements_text(m->'svc')) else '{}' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Hindi puwedeng baguhin ng user ang sarili niyang role.
-- (Kapag walang naka-log in, gaya sa SQL Editor, pinapayagan para makagawa ng admin.)
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'Hindi puwedeng baguhin ang role';
  end if;
  if new.id is distinct from old.id then
    raise exception 'Hindi puwedeng baguhin ang id';
  end if;
  return new;
end $$;

drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

-- Bantayan ang pagbabago ng booking: sino ang puwedeng gumawa ng ano.
create or replace function public.guard_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null or public.is_admin() then
    new.updated_at := now();
    return new;
  end if;
  if new.customer_id <> old.customer_id or new.tech_id <> old.tech_id
     or new.amount <> old.amount or new.item <> old.item or new.category <> old.category
     or new.extras <> old.extras or new.address <> old.address or new.created_at <> old.created_at then
    raise exception 'Status lang ang puwedeng baguhin sa booking';
  end if;
  if new.status <> old.status then
    if me = old.customer_id then
      if not (new.status = 'cancelled' and old.status in ('pending','accepted','enroute')) then
        raise exception 'Hindi puwedeng gawin ito sa booking';
      end if;
    elsif me = old.tech_id then
      if not ((old.status = 'pending'  and new.status in ('accepted','declined'))
           or (old.status = 'accepted' and new.status in ('enroute','cancelled'))
           or (old.status = 'enroute'  and new.status in ('arrived','cancelled'))
           or (old.status = 'arrived'  and new.status = 'done')) then
        raise exception 'Hindi puwedeng gawin ito sa booking';
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists guard_booking on public.bookings;
create trigger guard_booking before update on public.bookings
  for each row execute function public.guard_booking();

-- Markahang nabasa ang mga mensahe mula sa kausap.
create or replace function public.mark_read(other uuid) returns void
language sql security definer set search_path = public as $$
  update public.messages set read_at = now()
  where read_at is null and sender_id = other
    and ((customer_id = auth.uid() and tech_id = other) or (tech_id = auth.uid() and customer_id = other));
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles enable row level security;
alter table public.bookings enable row level security;
alter table public.messages enable row level security;
alter table public.settings enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or role = 'technician'
  or public.is_admin()
  or exists (select 1 from public.bookings b where b.tech_id = auth.uid() and b.customer_id = profiles.id)
  or exists (select 1 from public.messages m where m.tech_id = auth.uid() and m.customer_id = profiles.id)
);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings for select to authenticated using (
  customer_id = auth.uid() or tech_id = auth.uid() or public.is_admin()
);

drop policy if exists bookings_insert on public.bookings;
create policy bookings_insert on public.bookings for insert to authenticated with check (
  customer_id = auth.uid()
  and status = 'pending'
  and public.my_role() = 'customer'
  and exists (select 1 from public.profiles p where p.id = tech_id and p.role = 'technician')
);

drop policy if exists bookings_update on public.bookings;
create policy bookings_update on public.bookings for update to authenticated
  using (customer_id = auth.uid() or tech_id = auth.uid() or public.is_admin());

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated using (
  customer_id = auth.uid() or tech_id = auth.uid() or public.is_admin()
);

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated with check (
  sender_id = auth.uid()
  and (customer_id = auth.uid() or tech_id = auth.uid())
  and exists (select 1 from public.profiles p where p.id = customer_id and p.role = 'customer')
  and exists (select 1 from public.profiles p where p.id = tech_id and p.role = 'technician')
);

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings for select to anon, authenticated using (true);

drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- REALTIME: para live ang booking status, lokasyon at chat
-- ============================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.bookings; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.profiles; exception when duplicate_object then null; end;
  end if;
end $$;
