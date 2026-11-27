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

-- ============ GRANTS ============
-- Kailangan ito sa mga bagong Supabase project na hindi na awtomatikong nagbibigay ng access sa Data API.
grant usage on schema public to anon, authenticated;
grant select on public.settings to anon, authenticated;
grant insert, update, delete on public.settings to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update on public.bookings to authenticated;
grant select, insert, update on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

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

-- ============ DOKUMENTO NG TECHNICIAN (002_tech_docs.sql) ============
alter table public.profiles add column if not exists cert_type text check (cert_type in ('nc2', 'dti_bir'));
alter table public.profiles add column if not exists docs jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists doc_status text not null default 'kulang'
  check (doc_status in ('kulang', 'sinusuri', 'aprubado', 'tinanggihan'));
alter table public.profiles add column if not exists doc_note text not null default '';

-- Kung kailangan ng pag-apruba ng admin bago mag-online ang technician.
insert into public.settings (key, value) values ('require_doc_approval', 'true'::jsonb)
  on conflict (key) do nothing;

-- Bantay: ang technician ay pwedeng mag-submit (sinusuri) pero hindi pwedeng mag-apruba ng sarili,
-- at hindi pwedeng mag-online nang walang aprubado o naka-submit na dokumento.
create or replace function public.guard_role() returns trigger
language plpgsql security definer set search_path = public as $$
declare need_ok boolean := coalesce((select (value)::text::boolean from public.settings where key = 'require_doc_approval'), true);
begin
  if new.role is distinct from old.role and not public.is_admin()
     and (new.role = 'admin' or old.role = 'admin') then
    raise exception 'Bawal baguhin ang role na ito';
  end if;
  if not public.is_admin() then
    -- Kapag pinalitan ang dokumento, babalik sa pagsusuri.
    if new.docs is distinct from old.docs or new.cert_type is distinct from old.cert_type then
      new.doc_status := 'sinusuri';
    end if;
    if new.doc_status is distinct from old.doc_status and new.doc_status not in ('sinusuri') then
      raise exception 'Ang admin lang ang pwedeng mag-apruba ng dokumento';
    end if;
    if new.doc_status is distinct from old.doc_status then new.doc_note := ''; end if;
    if new.role = 'technician' and new.online and not old.online then
      if need_ok and new.doc_status <> 'aprubado' then
        raise exception 'Hindi pa aprubado ang mga dokumento mo';
      elsif not need_ok and new.doc_status not in ('sinusuri', 'aprubado') then
        raise exception 'Mag-upload muna ng mga dokumento';
      end if;
    end if;
  end if;
  -- Offline agad kapag tinanggihan, o kapag hindi pa aprubado (kung kailangan ng pag-apruba).
  if new.role = 'technician' and (new.doc_status = 'tinanggihan' or (need_ok and new.doc_status <> 'aprubado')) then
    new.online := false;
  end if;
  new.id := old.id; new.email := old.email; new.created_at := old.created_at;
  return new;
end $$;

-- File storage (pribado: ang may-ari at admin lang ang makakakita)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tech-docs', 'tech-docs', false, 5242880, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf'];

drop policy if exists "tech-docs insert own" on storage.objects;
create policy "tech-docs insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'tech-docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "tech-docs update own" on storage.objects;
create policy "tech-docs update own" on storage.objects for update to authenticated
  using (bucket_id = 'tech-docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "tech-docs read own or admin" on storage.objects;
create policy "tech-docs read own or admin" on storage.objects for select to authenticated
  using (bucket_id = 'tech-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- Itala ang napiling uri ng dokumento sa sign-up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, role, name, email, phone, addr, services, google, cert_type)
  values (
    new.id,
    case when m->>'role' = 'technician' then 'technician' else 'customer' end,
    coalesce(m->>'name', m->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(m->>'phone', ''),
    coalesce(m->>'addr', ''),
    coalesce(array(select jsonb_array_elements_text(m->'services')), '{}'),
    coalesce(new.raw_app_meta_data->>'provider', '') = 'google',
    case when m->>'cert_type' in ('nc2', 'dti_bir') then m->>'cert_type' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Hindi pwedeng mag-book sa technician na hindi pa aprubado ang dokumento.
drop policy if exists "bookings insert" on public.bookings;
create policy "bookings insert" on public.bookings for insert to authenticated
  with check (customer_id = auth.uid() and status = 'Bago'
    and exists (select 1 from public.profiles p where p.id = tech_id and p.role = 'technician'
      and (p.doc_status = 'aprubado'
        or not coalesce((select (value)::text::boolean from public.settings where key = 'require_doc_approval'), true))));

-- I-offline ang mga technician na wala pang aprubadong dokumento (kasama ang mga dati nang naka-register).
update public.profiles set online = false where role = 'technician' and online and doc_status <> 'aprubado';

-- ============ BOOKING FEE AT NC II-ONLY NA SERBISYO (003_fee_nc2.sql) ============
-- Booking fee: sinisingil sa customer, buo itong napupunta sa CoolFix (hindi binabawas sa technician).
alter table public.bookings add column if not exists booking_fee integer not null default 0 check (booking_fee >= 0);
insert into public.settings (key, value) values ('booking_fee', '49'::jsonb) on conflict (key) do nothing;

-- Mga serbisyong NC II holder lang ang pwedeng tumanggap (installation at major repair).
insert into public.settings (key, value) values ('nc2_only',
  '["Compressor Replacement","Refrigerant Recharging","Refrigerant Charging","Refrigerant Leak Detection","PCB Replacement"]'::jsonb)
  on conflict (key) do nothing;

-- Sa bagong booking: ilagay ang booking fee mula sa settings, at harangin ang NC II-only na serbisyo
-- kung hindi aprubadong NC II holder ang technician.
create or replace function public.prep_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  new.booking_fee := greatest(0, coalesce((select (value)::text::int from public.settings where key = 'booking_fee'), 0));
  select role, services, cert_type, doc_status into t from public.profiles where id = new.tech_id;
  if (new.svc ilike 'Aircon Install%' or exists (
        select 1 from jsonb_array_elements_text(coalesce((select value from public.settings where key = 'nc2_only'), '[]'::jsonb)) x
        where position(lower(x) in lower(new.svc)) > 0))
     and not (t.cert_type = 'nc2' and t.doc_status = 'aprubado') then
    raise exception 'NC II certified na technician lang ang pwede sa serbisyong ito';
  end if;
  return new;
end $$;
drop trigger if exists bookings_prep on public.bookings;
create trigger bookings_prep before insert on public.bookings
  for each row execute function public.prep_booking();

-- Hindi pwedeng baguhin ng customer o technician ang booking fee.
create or replace function public.guard_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then new.updated_at := now(); return new; end if;
  if new.customer_id <> old.customer_id or new.tech_id <> old.tech_id or new.amt <> old.amt
     or new.svc <> old.svc or new.booking_fee <> old.booking_fee then
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

-- CoolFix: pag-schedule ng booking (petsa at oras) at bagong status na 'Tinanggap'
-- Patakbuhin PAGKATAPOS ng 003_fee_nc2.sql. Ligtas patakbuhin ulit.

-- Petsa at oras na pinili ng customer. Walang laman kung "Ngayon na" ang booking.
alter table public.bookings add column if not exists sched_at timestamptz;
create index if not exists bookings_tech_sched on public.bookings(tech_id, sched_at);

-- Bagong status: 'Tinanggap' = tinanggap ng technician ang naka-schedule na booking, pero hindi pa papunta.
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('Bago','Tinanggap','Papunta na','Dumating na','Natapos','Kinansela','Tinanggihan'));

-- Mga oras na okupado na ang technician (oras lang ang ibinabalik, walang detalye ng ibang customer).
create or replace function public.tech_busy(t uuid) returns setof timestamptz
language sql stable security definer set search_path = public as $$
  select sched_at from public.bookings
  where tech_id = t and sched_at is not null and sched_at > now() - interval '2 hours'
    and status in ('Bago','Tinanggap','Papunta na','Dumating na')
$$;
revoke all on function public.tech_busy(uuid) from public, anon;
grant execute on function public.tech_busy(uuid) to authenticated;

-- Sa bagong booking: booking fee, NC II-only na serbisyo, at pag-check ng schedule.
-- Bawat booking ay may 2 oras na laan, kaya bawal ang dalawang booking na mas malapit sa 2 oras sa isa't isa.
create or replace function public.prep_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  new.booking_fee := greatest(0, coalesce((select (value)::text::int from public.settings where key = 'booking_fee'), 0));
  select role, services, cert_type, doc_status into t from public.profiles where id = new.tech_id;
  if (new.svc ilike 'Aircon Install%' or exists (
        select 1 from jsonb_array_elements_text(coalesce((select value from public.settings where key = 'nc2_only'), '[]'::jsonb)) x
        where position(lower(x) in lower(new.svc)) > 0))
     and not (t.cert_type = 'nc2' and t.doc_status = 'aprubado') then
    raise exception 'NC II certified na technician lang ang pwede sa serbisyong ito';
  end if;
  if new.sched_at is not null then
    if new.sched_at < now() - interval '5 minutes' then
      raise exception 'Lumipas na ang oras na pinili mo. Pumili ng ibang oras';
    end if;
    if new.sched_at > now() + interval '31 days' then
      raise exception 'Hanggang 30 araw lang ang advance booking';
    end if;
    perform pg_advisory_xact_lock(hashtext(new.tech_id::text));
    if exists (select 1 from public.bookings b
               where b.tech_id = new.tech_id and b.sched_at is not null
                 and b.status in ('Bago','Tinanggap','Papunta na','Dumating na')
                 and abs(extract(epoch from (b.sched_at - new.sched_at))) < 7200) then
      raise exception 'May booking na ang technician sa oras na ito. Pumili ng ibang oras';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists bookings_prep on public.bookings;
create trigger bookings_prep before insert on public.bookings
  for each row execute function public.prep_booking();

-- Bawal baguhin ang schedule pagkatapos mag-book. Pwedeng 'Tinanggap' ang technician,
-- at pwedeng mag-cancel ang customer habang Bago, Tinanggap o Papunta na.
create or replace function public.guard_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then new.updated_at := now(); return new; end if;
  if new.customer_id <> old.customer_id or new.tech_id <> old.tech_id or new.amt <> old.amt
     or new.svc <> old.svc or new.booking_fee <> old.booking_fee
     or new.sched_at is distinct from old.sched_at then
    raise exception 'Bawal baguhin ang detalye ng booking';
  end if;
  if auth.uid() = old.tech_id then
    if not (new.status in ('Tinanggap','Papunta na','Dumating na','Natapos','Tinanggihan')) then
      raise exception 'Bawal ang status na ito';
    end if;
  elsif auth.uid() = old.customer_id then
    if new.status <> old.status and not (new.status = 'Kinansela' and old.status in ('Bago','Tinanggap','Papunta na')) then
      raise exception 'Pwede lang i-cancel ang booking bago dumating ang technician';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- CoolFix: eksaktong lokasyon ng customer sa booking, para sa mapa at direksyon ng technician.
-- Patakbuhin PAGKATAPOS ng 007_tech_privacy.sql. Ligtas patakbuhin ulit.
-- Ang technician at ang customer ng booking lang ang nakakakita nito (sakop ng "bookings read" policy).
alter table public.bookings add column if not exists cust_lat double precision;
alter table public.bookings add column if not exists cust_lng double precision;
