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
