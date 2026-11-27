-- CoolFix: dagdag na seguridad (005_security.sql). Ligtas patakbuhin ulit.
-- Hiwalay na trigger ang gamit dito para hindi magalaw ang guard_role at guard_booking.
-- Ang admin at ang SQL Editor (walang naka-login na user) ay hindi hinaharang.

-- 1) Bawal palitan ng user ang sarili niyang role. Exception: sa unang 30 minuto ng bagong account,
--    pwedeng customer -> technician (kailangan ito ng Google sign-up ng technician).
create or replace function public.lock_profile_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.role is distinct from old.role
     and not (old.role = 'customer' and new.role = 'technician' and old.created_at > now() - interval '30 minutes') then
    raise exception 'Bawal baguhin ang role ng account';
  end if;
  return new;
end $$;
drop trigger if exists profiles_lock_role on public.profiles;
create trigger profiles_lock_role before update on public.profiles
  for each row execute function public.lock_profile_role();

-- 2) Booking: status lang ang pwedeng baguhin ng customer o technician,
--    at hindi na mababago ang booking na tapos, kinansela o tinanggihan na.
create or replace function public.lock_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.cust_name is distinct from old.cust_name or new.cust_phone is distinct from old.cust_phone
     or new.tech_name is distinct from old.tech_name or new.address is distinct from old.address
     or new.sched is distinct from old.sched or new.created_at is distinct from old.created_at then
    raise exception 'Bawal baguhin ang detalye ng booking';
  end if;
  if new.status is distinct from old.status and old.status in ('Natapos','Kinansela','Tinanggihan') then
    raise exception 'Sarado na ang booking na ito';
  end if;
  if auth.uid() = old.tech_id and new.status is distinct from old.status then
    if not (
      (old.status = 'Bago'        and new.status in ('Tinanggap','Papunta na','Tinanggihan')) or
      (old.status = 'Tinanggap'   and new.status in ('Papunta na','Tinanggihan')) or
      (old.status = 'Papunta na'  and new.status in ('Dumating na')) or
      (old.status = 'Dumating na' and new.status in ('Natapos'))
    ) then
      raise exception 'Hindi pwedeng ilipat ang booking sa status na ito';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists bookings_lock on public.bookings;
create trigger bookings_lock before update on public.bookings
  for each row execute function public.lock_booking();

-- 3) Chat: ang "nabasa na" lang ang pwedeng baguhin, at sariling panig lang.
create or replace function public.lock_conversation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.id is distinct from old.id or new.customer_id is distinct from old.customer_id
     or new.tech_id is distinct from old.tech_id or new.cust_name is distinct from old.cust_name
     or new.tech_name is distinct from old.tech_name or new.created_at is distinct from old.created_at
     or (new.read_c is distinct from old.read_c and auth.uid() <> old.customer_id)
     or (new.read_t is distinct from old.read_t and auth.uid() <> old.tech_id) then
    raise exception 'Bawal baguhin ang usapang ito';
  end if;
  return new;
end $$;
drop trigger if exists conversations_lock on public.conversations;
create trigger conversations_lock before update on public.conversations
  for each row execute function public.lock_conversation();
drop policy if exists "conv update" on public.conversations;
create policy "conv update" on public.conversations for update to authenticated
  using (customer_id = auth.uid() or tech_id = auth.uid())
  with check (customer_id = auth.uid() or tech_id = auth.uid());

-- 4) Tanggalin ang mga hindi kailangang pahintulot (TRUNCATE, TRIGGER, REFERENCES).
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
revoke insert, update, delete on public.bookings, public.conversations, public.messages, public.profiles from anon;

-- 5) Hindi dapat matawag nang direkta ang mga trigger function mula sa API.
do $$ declare f text; begin
  foreach f in array array['guard_booking()','guard_role()','handle_new_user()','prep_booking()',
                           'lock_profile_role()','lock_booking()','lock_conversation()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
