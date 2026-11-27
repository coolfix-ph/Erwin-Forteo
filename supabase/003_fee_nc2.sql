-- CoolFix: booking fee ng customer at mga serbisyong NC II lang
-- Patakbuhin PAGKATAPOS ng 002_tech_docs.sql. Ligtas patakbuhin ulit.

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
