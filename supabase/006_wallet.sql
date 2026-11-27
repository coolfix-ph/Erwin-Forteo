-- CoolFix: Tech Wallet, quote, presyong kinukuwenta sa server, at proteksyon laban sa "lalaktawan ang app" (006_wallet.sql)
-- Patakbuhin PAGKATAPOS ng 005_security.sql. Ligtas patakbuhin ulit.
--
-- Buod:
--  * Wallet ng technician: prepaid na CREDITS (hindi pera, hindi ma-withdraw). Nilo-load sa pamamagitan ng GCash/Maya
--    na ipinadala sa CoolFix; inaaprubahan ng admin ang top-up. Sa bawat cash na job na natapos, awtomatikong
--    ibinabawas ang commission at booking fee.
--  * Kapag naka-on ang "wallet_required" at mas mababa sa "wallet_min" ang balance, hindi makakapag-online
--    o makakatanggap ng bagong job ang technician.
--  * Sa server na kinukuwenta ang presyo ng booking (mula sa catalog sa settings), hindi na sa app.
--  * Quote: magpapadala ang technician ng dagdag na singil (parte o dagdag na gawa), at kailangang aprubahan ng customer.
--  * Nakatago na sa technician ang cellphone ng customer, at tinatakpan ang mga cellphone number sa chat.
--  * Warranty (30 araw) at rating para sa mga job na natapos sa app.

-- ============ SETTINGS ============
insert into public.settings (key, value) values
  ('commission_pct', '20'::jsonb),          -- % ng bayad sa serbisyo na napupunta sa CoolFix
  ('wallet_min', '200'::jsonb),             -- pinakamababang balance para makatanggap ng job
  ('wallet_required', 'false'::jsonb),      -- i-on ito ng admin kapag nakapag-top up na ang mga technician
  ('warranty_days', '30'::jsonb),
  ('topup_info', '{"gcash":{"name":"","number":""},"maya":{"name":"","number":""}}'::jsonb)
on conflict (key) do nothing;
-- Kailangan ng server ang catalog para makuwenta ang presyo. Ito ang default na catalog ng app.
insert into public.settings (key, value) values
  ('catalog', '[{"k":"Aircon cleaning","t":"Aircon Cleaning","d":"General cleaning / preventive maintenance","n":"Presyo ayon sa uri at laki (HP) ng aircon.","g":[["Window Type",[["Window 0.5 HP",600],["Window 1.0 HP",700],["Window 1.5 HP",800],["Window 2.0 HP",900]]],["Split Type",[["Split 1.0 HP",950],["Split 1.5 HP",1100],["Split 2.0 HP",1350],["Split 2.5 HP",1600]]],["Floor Standing at Cassette",[["Floor Standing",2000],["Ceiling Cassette",2750]]]]},{"k":"Aircon repair","t":"Aircon Repair","d":"Check-up, parte, freon at compressor","n":"Labor lang ang presyo. Hiwalay ang singil sa parte.","g":[["Check-up",[["Initial Check-up / Diagnosis",550]]],["Electrical at parte",[["Capacitor Replacement",650],["Fan Motor Replacement",950],["Thermostat Replacement",700],["PCB Troubleshooting",1150],["PCB Replacement",1150],["Electrical Wiring Repair",1000]]],["Drainage at refrigerant",[["Drainage Repair",750],["Refrigerant Leak Detection",1150],["Refrigerant Recharging",1500],["Compressor Replacement",3250]]]]},{"k":"Ref cleaning","t":"Refrigerator Cleaning","d":"General cleaning at maintenance","n":"Presyo ayon sa uri ng ref o freezer.","g":[["Refrigerator",[["Single Door",600],["Two Door",750],["No Frost Refrigerator",1000],["Side-by-Side Refrigerator",1250],["French Door Refrigerator",1500]]],["Commercial at Freezer",[["Commercial Refrigerator",2250],["Chest Freezer",950],["Upright Freezer",1150]]]]},{"k":"Ref repair","t":"Refrigerator Repair","d":"Thermostat, fan motor, gasket, freon, compressor","n":"Labor lang ang presyo. Hiwalay ang singil sa parte.","g":[["Check-up",[["Check-up / Diagnosis",550]]],["Electrical at parte",[["Thermostat Repair",750],["Defrost Timer Replacement",700],["Fan Motor Replacement",950],["Relay Replacement",700],["Overload Protector Replacement",700]]],["Pinto at drainage",[["Door Gasket Replacement",750],["Drainage Repair",700]]],["Refrigerant system",[["Refrigerant Leak Detection",1150],["Refrigerant Charging",1500],["Compressor Replacement",3750]]]]}]'::jsonb),
  ('other_charges', '[{"n":"Home Service / Dispatch Fee","k":"fixed","p":300,"a":true},{"n":"Additional Unit Inspection","k":"fixed","p":250,"a":false},{"n":"Emergency Service","k":"pct","p":30,"a":false},{"n":"After-hours Service","k":"pct","p":20,"a":false},{"n":"Out-of-town Service","k":"custom","a":false},{"n":"Ladder / Special Equipment","k":"fixed","p":400,"a":false}]'::jsonb)
on conflict (key) do nothing;

create or replace function public.cf_num(k text, d numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(value) = 'number' then (value)::text::numeric end from public.settings where key = k), d)
$$;
create or replace function public.cf_bool(k text, d boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(value) = 'boolean' then (value)::text::boolean end from public.settings where key = k), d)
$$;

-- ============ WALLET ============
create table if not exists public.wallets (
  tech_id uuid primary key references public.profiles(id) on delete cascade,
  balance integer not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.wallet_tx (
  id bigint generated always as identity primary key,
  tech_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('topup', 'commission', 'booking_fee', 'bonus', 'adjust')),
  amt integer not null,
  balance_after integer not null,
  booking_id bigint references public.bookings(id) on delete set null,
  topup_id bigint,
  note text not null default '',
  by_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists wallet_tx_tech on public.wallet_tx(tech_id, created_at desc);

alter table public.wallets enable row level security;
alter table public.wallet_tx enable row level security;
drop policy if exists "wallet read" on public.wallets;
create policy "wallet read" on public.wallets for select to authenticated using (tech_id = auth.uid() or public.is_admin());
drop policy if exists "wallet tx read" on public.wallet_tx;
create policy "wallet tx read" on public.wallet_tx for select to authenticated using (tech_id = auth.uid() or public.is_admin());

-- Mababa ba ang wallet ng technician (at kailangan ba ito)?
create or replace function public.wallet_low(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.cf_bool('wallet_required', false)
     and coalesce((select balance from public.wallets where tech_id = t), 0) < public.cf_num('wallet_min', 200)
$$;

-- Ang tanging paraan para magbago ang balance. Hindi ito matatawag mula sa app.
create or replace function public.wallet_add(t uuid, k text, a integer, n text, b bigint, tp bigint) returns integer
language plpgsql security definer set search_path = public as $$
declare bal integer;
begin
  insert into public.wallets (tech_id) values (t) on conflict (tech_id) do nothing;
  update public.wallets set balance = balance + a, updated_at = now() where tech_id = t returning balance into bal;
  insert into public.wallet_tx (tech_id, kind, amt, balance_after, booking_id, topup_id, note, by_id)
  values (t, k, a, bal, b, tp, coalesce(n, ''), auth.uid());
  -- Kapag bumaba sa minimum, i-offline para hindi na makatanggap ng bagong job.
  if public.wallet_low(t) then
    update public.profiles set online = false where id = t and online;
  end if;
  return bal;
end $$;

-- ============ TOP-UP (GCash/Maya papunta sa CoolFix, aaprubahan ng admin) ============
create table if not exists public.topups (
  id bigint generated always as identity primary key,
  tech_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  amt integer not null check (amt between 50 and 50000),
  method text not null check (method in ('gcash', 'maya')),
  ref text not null check (char_length(ref) between 4 and 40),
  proof text not null default '',
  status text not null default 'sinusuri' check (status in ('sinusuri', 'aprubado', 'tinanggihan')),
  note text not null default '',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);
create index if not exists topups_tech on public.topups(tech_id, created_at desc);
-- Hindi pwedeng gamitin ulit ang parehong reference number.
create unique index if not exists topups_ref_once on public.topups(method, ref) where status <> 'tinanggihan';

create or replace function public.prep_topup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if not exists (select 1 from public.profiles where id = auth.uid() and role = 'technician') then
      raise exception 'Technician lang ang pwedeng mag-top up';
    end if;
    new.tech_id := auth.uid();
    if (select count(*) from public.topups where tech_id = new.tech_id and status = 'sinusuri') >= 3 then
      raise exception 'May 3 top-up ka pang sinusuri. Hintayin muna ang admin';
    end if;
  end if;
  new.ref := upper(regexp_replace(coalesce(new.ref, ''), '[^A-Za-z0-9]', '', 'g'));
  if char_length(new.ref) < 4 then raise exception 'Ilagay ang tamang reference number'; end if;
  if exists (select 1 from public.topups where method = new.method and ref = new.ref and status <> 'tinanggihan') then
    raise exception 'Nagamit na ang reference number na ito';
  end if;
  new.status := 'sinusuri'; new.note := ''; new.reviewed_at := null; new.reviewed_by := null; new.created_at := now();
  return new;
end $$;
drop trigger if exists topups_prep on public.topups;
create trigger topups_prep before insert on public.topups for each row execute function public.prep_topup();

alter table public.topups enable row level security;
drop policy if exists "topup read" on public.topups;
create policy "topup read" on public.topups for select to authenticated using (tech_id = auth.uid() or public.is_admin());
drop policy if exists "topup insert" on public.topups;
create policy "topup insert" on public.topups for insert to authenticated with check (tech_id = auth.uid());

-- Admin: aprubahan o tanggihan ang top-up. Kapag aprubado, papasok ang credits sa wallet.
create or replace function public.review_topup(tid bigint, ok boolean, why text default '') returns integer
language plpgsql security definer set search_path = public as $$
declare t public.topups;
begin
  if not public.is_admin() then raise exception 'Admin lang ang pwedeng mag-apruba'; end if;
  select * into t from public.topups where id = tid for update;
  if t.id is null then raise exception 'Walang ganitong top-up'; end if;
  if t.status <> 'sinusuri' then raise exception 'Nasuri na ang top-up na ito'; end if;
  if not ok and coalesce(trim(why), '') = '' then raise exception 'Ilagay kung bakit tinanggihan'; end if;
  update public.topups set status = case when ok then 'aprubado' else 'tinanggihan' end, note = coalesce(trim(why), ''),
    reviewed_at = now(), reviewed_by = auth.uid() where id = tid;
  if ok then
    return public.wallet_add(t.tech_id, 'topup', t.amt, 'Top-up ' || upper(t.method) || ' · Ref ' || t.ref, null, t.id);
  end if;
  return coalesce((select balance from public.wallets where tech_id = t.tech_id), 0);
end $$;

-- Admin: manwal na dagdag o bawas (hal. bonus, welcome credits, o pagtatama).
create or replace function public.wallet_adjust(t uuid, a integer, why text) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin lang ang pwedeng mag-adjust ng wallet'; end if;
  if a = 0 or abs(a) > 100000 then raise exception 'Maglagay ng tamang halaga'; end if;
  if coalesce(trim(why), '') = '' then raise exception 'Ilagay ang dahilan'; end if;
  if not exists (select 1 from public.profiles where id = t and role = 'technician') then raise exception 'Hindi technician ito'; end if;
  return public.wallet_add(t, case when a > 0 then 'bonus' else 'adjust' end, a, trim(why), null, null);
end $$;

-- Litrato ng resibo ng GCash/Maya (pribado: may-ari at admin lang ang makakakita).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('topup-proofs', 'topup-proofs', false, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png'];
drop policy if exists "topup-proofs insert own" on storage.objects;
create policy "topup-proofs insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'topup-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "topup-proofs read own or admin" on storage.objects;
create policy "topup-proofs read own or admin" on storage.objects for select to authenticated
  using (bucket_id = 'topup-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ============ BOOKING: bayad, quote, warranty at rating ============
alter table public.bookings add column if not exists items jsonb;
alter table public.bookings add column if not exists rate smallint not null default 20;
alter table public.bookings add column if not exists pay_method text not null default 'cash';
alter table public.bookings add column if not exists extra_amt integer not null default 0;
alter table public.bookings add column if not exists extra_note text not null default '';
alter table public.bookings add column if not exists q_amt integer;
alter table public.bookings add column if not exists q_note text not null default '';
alter table public.bookings add column if not exists q_status text not null default 'wala';
alter table public.bookings add column if not exists q_at timestamptz;
alter table public.bookings add column if not exists final_amt integer;
alter table public.bookings add column if not exists commission integer;
alter table public.bookings add column if not exists done_at timestamptz;
alter table public.bookings add column if not exists warranty_until timestamptz;
alter table public.bookings add column if not exists rating smallint;
alter table public.bookings add column if not exists review text not null default '';
alter table public.bookings add column if not exists rated_at timestamptz;
alter table public.bookings drop constraint if exists bookings_pay_method_check;
alter table public.bookings add constraint bookings_pay_method_check check (pay_method in ('cash', 'online'));
alter table public.bookings drop constraint if exists bookings_q_status_check;
alter table public.bookings add constraint bookings_q_status_check check (q_status in ('wala', 'hinihintay', 'aprubado', 'tinanggihan'));
alter table public.bookings drop constraint if exists bookings_rating_check;
alter table public.bookings add constraint bookings_rating_check check (rating is null or rating between 1 and 5);
alter table public.bookings drop constraint if exists bookings_extra_check;
alter table public.bookings add constraint bookings_extra_check check (extra_amt >= 0 and (q_amt is null or q_amt > 0));

-- Bagong booking: kinukuwenta ang presyo mula sa catalog (items = {cart:[{c,n,q}], extras:[pangalan]}),
-- booking fee, commission rate, pangalan mula sa profile, NC II-only na serbisyo, schedule, at wallet ng technician.
create or replace function public.prep_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t record; it jsonb := new.items;
  cat jsonb := coalesce((select value from public.settings where key = 'catalog'), '[]'::jsonb);
  oc jsonb := coalesce((select value from public.settings where key = 'other_charges'), '[]'::jsonb);
  x jsonb; c jsonb; o jsonb; price numeric; q integer;
  base numeric := 0; fx numeric := 0; pct numeric := 0; lines text[] := '{}'; ex text[] := '{}';
begin
  if it is null or jsonb_typeof(it->'cart') is distinct from 'array'
     or jsonb_array_length(it->'cart') = 0 or jsonb_array_length(it->'cart') > 30 then
    raise exception 'Luma na ang bersyon ng app. I-refresh ang page at subukan ulit';
  end if;
  for x in select * from jsonb_array_elements(it->'cart') loop
    q := case when jsonb_typeof(x->'q') = 'number' then (x->>'q')::numeric::integer end;
    if q is null or q < 1 or q > 20 then raise exception 'Mali ang dami ng serbisyo'; end if;
    select e into c from jsonb_array_elements(cat) e where e->>'k' = x->>'c' limit 1;
    price := null;
    if c is not null then
      select (s->>1)::numeric into price from jsonb_array_elements(c->'g') g, jsonb_array_elements(g->1) s
       where s->>0 = x->>'n' and jsonb_typeof(s->1) = 'number' limit 1;
    end if;
    if price is null then raise exception 'Wala na sa listahan ang "%". I-refresh ang page', x->>'n'; end if;
    base := base + price * q;
    lines := lines || ((c->>'t') || ': ' || (x->>'n') || case when q > 1 then ' ×' || q else '' end);
  end loop;
  for o in select * from jsonb_array_elements(oc) loop
    if coalesce((o->>'a')::boolean, false) or coalesce((it->'extras') ? (o->>'n'), false) then
      if o->>'k' = 'fixed' and jsonb_typeof(o->'p') = 'number' then fx := fx + (o->>'p')::numeric;
      elsif o->>'k' = 'pct' and jsonb_typeof(o->'p') = 'number' then pct := pct + (o->>'p')::numeric;
      end if;
      if not coalesce((o->>'a')::boolean, false) then ex := ex || (o->>'n'); end if;
    end if;
  end loop;
  new.amt := round((base + fx) * (1 + pct / 100));
  new.svc := array_to_string(lines, '; ') || case when cardinality(ex) > 0 then ' + ' || array_to_string(ex, ', ') else '' end;
  new.booking_fee := greatest(0, round(public.cf_num('booking_fee', 0)));
  new.rate := least(100, greatest(0, round(public.cf_num('commission_pct', 20))));
  new.pay_method := 'cash';  -- Online na bayad: sa phase 2 (payment gateway)
  new.cust_phone := '';      -- nakatago sa technician; gamitin ang in-app chat
  new.cust_name := coalesce((select name from public.profiles where id = new.customer_id), new.cust_name);
  new.extra_amt := 0; new.extra_note := ''; new.q_amt := null; new.q_note := ''; new.q_status := 'wala'; new.q_at := null;
  new.final_amt := null; new.commission := null; new.done_at := null; new.warranty_until := null;
  new.rating := null; new.review := ''; new.rated_at := null;

  select role, name, services, cert_type, doc_status into t from public.profiles where id = new.tech_id;
  new.tech_name := coalesce(t.name, new.tech_name);
  if public.wallet_low(new.tech_id) then
    raise exception 'Hindi available ngayon ang technician na ito. Pumili ng iba';
  end if;
  if (new.svc ilike 'Aircon Install%' or exists (
        select 1 from jsonb_array_elements_text(coalesce((select value from public.settings where key = 'nc2_only'), '[]'::jsonb)) y
        where position(lower(y) in lower(new.svc)) > 0))
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

-- Bantay sa bayad: hindi mababago ng customer o technician ang presyo, quote, commission, warranty at rating
-- maliban sa mga function sa ibaba. Pagka-"Natapos", itinatala ang final na bayad, commission at warranty.
create or replace function public.money_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare rpc boolean := coalesce(current_setting('coolfix.rpc', true), '') = '1';
begin
  if auth.uid() is not null and not public.is_admin() then
    if not rpc and (new.items is distinct from old.items or new.rate is distinct from old.rate
       or new.pay_method is distinct from old.pay_method or new.extra_amt is distinct from old.extra_amt
       or new.extra_note is distinct from old.extra_note or new.q_amt is distinct from old.q_amt
       or new.q_note is distinct from old.q_note or new.q_status is distinct from old.q_status
       or new.q_at is distinct from old.q_at or new.final_amt is distinct from old.final_amt
       or new.commission is distinct from old.commission or new.done_at is distinct from old.done_at
       or new.warranty_until is distinct from old.warranty_until or new.rating is distinct from old.rating
       or new.review is distinct from old.review or new.rated_at is distinct from old.rated_at) then
      raise exception 'Bawal baguhin ang bayad ng booking';
    end if;
    if auth.uid() = old.tech_id and old.status = 'Bago' and new.status in ('Tinanggap', 'Papunta na')
       and public.wallet_low(old.tech_id) then
      raise exception 'Kulang ang wallet balance mo (minimum ₱%). Mag-top up muna para makatanggap ng job',
        round(public.cf_num('wallet_min', 200));
    end if;
  end if;
  if new.status = 'Natapos' and old.status is distinct from 'Natapos' then
    if new.q_status = 'hinihintay' then
      raise exception 'May quote pang hinihintay ang sagot ng customer';
    end if;
    new.final_amt := new.amt + new.extra_amt;
    new.commission := round(new.final_amt * new.rate / 100.0);
    new.done_at := now();
    new.warranty_until := now() + make_interval(days => round(public.cf_num('warranty_days', 30))::integer);
  end if;
  return new;
end $$;
drop trigger if exists bookings_money on public.bookings;
create trigger bookings_money before update on public.bookings
  for each row execute function public.money_booking();

-- Pagkatapos ng cash na job: ibawas sa wallet ang commission at booking fee (isang beses lang).
create or replace function public.settle_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Natapos' and old.status is distinct from 'Natapos' and new.pay_method = 'cash'
     and not exists (select 1 from public.wallet_tx where booking_id = new.id and kind in ('commission', 'booking_fee')) then
    if coalesce(new.commission, 0) > 0 then
      perform public.wallet_add(new.tech_id, 'commission', -new.commission, 'Commission ' || new.rate || '% · ' || new.code, new.id, null);
    end if;
    if coalesce(new.booking_fee, 0) > 0 then
      perform public.wallet_add(new.tech_id, 'booking_fee', -new.booking_fee, 'Booking fee · ' || new.code, new.id, null);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists bookings_settle on public.bookings;
create trigger bookings_settle after update on public.bookings
  for each row execute function public.settle_booking();

-- Technician: magpadala ng quote (dagdag na singil) pagdating sa bahay ng customer.
create or replace function public.send_quote(bid bigint, amount integer, why text) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = bid for update;
  if b.id is null or b.tech_id is distinct from auth.uid() then raise exception 'Hindi mo booking ito'; end if;
  if b.status <> 'Dumating na' then raise exception 'Pwede lang mag-quote pagdating sa customer'; end if;
  if b.q_status = 'hinihintay' then raise exception 'May quote ka pang hinihintay ang sagot'; end if;
  if amount is null or amount < 1 or amount > 200000 then raise exception 'Maglagay ng tamang halaga'; end if;
  if char_length(coalesce(trim(why), '')) < 3 then raise exception 'Ilagay kung para saan ang dagdag na singil'; end if;
  perform set_config('coolfix.rpc', '1', true);
  update public.bookings set q_amt = amount, q_note = left(trim(why), 300), q_status = 'hinihintay', q_at = now() where id = bid;
  perform set_config('coolfix.rpc', '', true);
end $$;

-- Customer: aprubahan o tanggihan ang quote.
create or replace function public.answer_quote(bid bigint, ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = bid for update;
  if b.id is null or b.customer_id is distinct from auth.uid() then raise exception 'Hindi mo booking ito'; end if;
  if b.q_status <> 'hinihintay' then raise exception 'Walang quote na hinihintay ang sagot'; end if;
  perform set_config('coolfix.rpc', '1', true);
  if ok then
    update public.bookings set extra_amt = extra_amt + q_amt, q_status = 'aprubado',
      extra_note = left(concat_ws('; ', nullif(extra_note, ''), q_note || ' (' || q_amt || ')'), 1000) where id = bid;
  else
    update public.bookings set q_status = 'tinanggihan' where id = bid;
  end if;
  perform set_config('coolfix.rpc', '', true);
end $$;

-- Customer: i-rate ang natapos na job (isang beses).
create or replace function public.rate_booking(bid bigint, stars integer, words text default '') returns void
language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = bid for update;
  if b.id is null or b.customer_id is distinct from auth.uid() then raise exception 'Hindi mo booking ito'; end if;
  if b.status <> 'Natapos' then raise exception 'Pwede lang i-rate ang natapos na job'; end if;
  if b.rating is not null then raise exception 'Na-rate mo na ito'; end if;
  if stars is null or stars < 1 or stars > 5 then raise exception 'Pumili ng 1 hanggang 5 star'; end if;
  perform set_config('coolfix.rpc', '1', true);
  update public.bookings set rating = stars, review = left(coalesce(trim(words), ''), 300), rated_at = now() where id = bid;
  perform set_config('coolfix.rpc', '', true);
end $$;

-- Rating at bilang ng natapos na job ng bawat technician (walang detalye ng customer).
create or replace function public.tech_stats() returns table (tech_id uuid, rating numeric, reviews integer, done integer)
language sql stable security definer set search_path = public as $$
  select b.tech_id, round(avg(b.rating)::numeric, 1), count(b.rating)::integer, count(*)::integer
  from public.bookings b join public.profiles p on p.id = b.tech_id and p.role = 'technician'
  where b.status = 'Natapos' group by b.tech_id
$$;

-- Hindi na makikita ng technician ang cellphone ng customer (pati sa mga lumang booking).
update public.bookings set cust_phone = '' where coalesce(cust_phone, '') <> '';

-- ============ CHAT: takpan ang cellphone number ============
create or replace function public.mask_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.body := regexp_replace(new.body, '(\+?63|0)[ .-]*9([ .-]*[0-9]){9}', '[nakatagong numero]', 'g');
  new.body := regexp_replace(new.body, '\m9[0-9]{2}[ .-]*[0-9]{3}[ .-]*[0-9]{4}\M', '[nakatagong numero]', 'g');
  new.body := left(new.body, 500);
  return new;
end $$;
drop trigger if exists messages_mask on public.messages;
create trigger messages_mask before insert on public.messages for each row execute function public.mask_contact();

-- ============ PROFILE: bawal mag-online kapag kulang ang wallet ============
create or replace function public.wallet_online() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() and new.role = 'technician'
     and new.online and not old.online and public.wallet_low(new.id) then
    raise exception 'Kulang ang wallet balance mo (minimum ₱%). Mag-top up muna', round(public.cf_num('wallet_min', 200));
  end if;
  return new;
end $$;
drop trigger if exists profiles_wallet on public.profiles;
create trigger profiles_wallet before update on public.profiles for each row execute function public.wallet_online();

-- ============ GRANTS ============
grant select on public.wallets, public.wallet_tx to authenticated;
grant select, insert on public.topups to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on public.wallets, public.wallet_tx, public.topups from anon;
do $$ declare f text; begin
  foreach f in array array['prep_topup()', 'money_booking()', 'settle_booking()', 'mask_contact()', 'wallet_online()',
                           'wallet_add(uuid, text, integer, text, bigint, bigint)', 'wallet_low(uuid)',
                           'cf_num(text, numeric)', 'cf_bool(text, boolean)', 'prep_booking()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['review_topup(bigint, boolean, text)', 'wallet_adjust(uuid, integer, text)',
                           'send_quote(bigint, integer, text)', 'answer_quote(bigint, boolean)',
                           'rate_booking(bigint, integer, text)', 'tech_stats()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ============ REALTIME ============
do $$ begin
  begin alter publication supabase_realtime add table public.wallets; exception when others then null; end;
  begin alter publication supabase_realtime add table public.topups; exception when others then null; end;
end $$;
