-- 017: Push notification, paalala bago ang schedule, warranty (libreng balik), referral at promo code,
-- at paulit-ulit na cleaning. Patakbuhin sa SQL Editor pagkatapos ng 016. Ligtas patakbuhin ulit.
--
-- Buod:
--  * push_subs: mga device na naka-on ang notification (Web Push). push_outbox: mga notification na ipapadala.
--    Ang edge function na "push-send" ang nagpapadala (gamit ang VAPID key na nasa pm_config, server lang).
--  * Bawat 5 minuto (pg_cron): paalala 1 araw at 1 oras bago ang schedule, at paggawa ng booking para sa paulit-ulit na cleaning.
--  * Warranty: libreng balik sa parehong technician habang may warranty pa (walang bayad, walang commission).
--  * Referral: ₱50 credit sa bagong customer na gumamit ng code, at ₱50 sa nag-imbita kapag natapos ang unang booking ng kaibigan.
--    Promo code: ginagawa ng admin. Sagot ng CoolFix ang discount: ibinabalik ito sa wallet ng technician pagka-Natapos.
--  * Paulit-ulit na cleaning: tuwing 3 o 6 na buwan, kusang nagbu-book 3 araw bago ang petsa sa parehong technician.
--
-- PAGKATAPOS: ilagay ang VAPID keys (hiwalay na SQL, hindi kasama sa GitHub) at i-deploy ang edge function na push-send.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ============ SETTINGS ============
insert into public.settings (key, value) values
  ('ref_new', '50'::jsonb),      -- credit ng bagong customer na gumamit ng referral code
  ('ref_inv', '50'::jsonb),      -- credit ng nag-imbita kapag natapos ang unang booking ng kaibigan
  ('push_public', '""'::jsonb)   -- VAPID public key (pampubliko)
on conflict (key) do nothing;

-- ============ BAGONG COLUMN SA BOOKINGS ============
alter table public.bookings add column if not exists warranty_of bigint references public.bookings(id) on delete set null;
alter table public.bookings add column if not exists cust_note text not null default '';
alter table public.bookings add column if not exists discount integer not null default 0;
alter table public.bookings add column if not exists promo text not null default '';
alter table public.bookings add column if not exists plan_id bigint;
alter table public.bookings drop constraint if exists bookings_discount_check;
alter table public.bookings add constraint bookings_discount_check check (discount >= 0 and discount <= amt + extra_amt);
alter table public.bookings drop constraint if exists bookings_cust_note_len;
alter table public.bookings add constraint bookings_cust_note_len check (char_length(cust_note) <= 500);
create index if not exists bookings_warranty_of on public.bookings(warranty_of) where warranty_of is not null;
create index if not exists bookings_sched_open on public.bookings(sched_at) where status in ('Bago', 'Tinanggap');

alter table public.wallet_tx drop constraint if exists wallet_tx_kind_check;
alter table public.wallet_tx add constraint wallet_tx_kind_check
  check (kind in ('topup', 'commission', 'booking_fee', 'bonus', 'adjust', 'promo'));

-- ============ PUSH ============
create table if not exists public.push_subs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) < 1000),
  p256dh text not null check (char_length(p256dh) < 200),
  auth text not null check (char_length(auth) < 100),
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user on public.push_subs(user_id);
alter table public.push_subs enable row level security;
revoke all on public.push_subs from public, anon, authenticated;
grant select, insert, update, delete on public.push_subs to service_role;

create table if not exists public.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null default '',
  url text not null default './',
  tag text not null default '',
  dedup text unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists push_outbox_wait on public.push_outbox(id) where sent_at is null;
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.push_outbox to service_role;

-- I-save ang device ng naka-login na user (kapag ibang account ang dating gumamit ng device, mapupunta na sa bago).
create or replace function public.push_save(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Mag-log in muna'; end if;
  insert into public.push_subs (user_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  delete from public.push_subs where user_id = auth.uid() and id not in (
    select id from public.push_subs where user_id = auth.uid() order by created_at desc limit 10);
end $$;
create or replace function public.push_drop(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subs where endpoint = p_endpoint and user_id = auth.uid()
$$;
revoke execute on function public.push_save(text, text, text), public.push_drop(text) from public, anon;
grant execute on function public.push_save(text, text, text), public.push_drop(text) to authenticated;

-- Tawagin ang edge function para ipadala ang mga nakapila. Hindi kailanman pinapalya ang booking o mensahe.
create or replace function public.push_kick() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare u text := (select value from public.pm_config where key = 'push_url');
begin
  if coalesce(u, '') = '' then return; end if;
  perform net.http_post(url := u, body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 8000);
exception when others then null;
end $$;

-- Ipila ang notification para sa isang user (kung may naka-on siyang device).
create or replace function public.cf_push(p_user uuid, p_title text, p_body text, p_url text default './', p_tag text default '', p_dedup text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or not exists (select 1 from public.push_subs where user_id = p_user) then return; end if;
  insert into public.push_outbox (user_id, title, body, url, tag, dedup)
  values (p_user, left(p_title, 120), left(coalesce(p_body, ''), 240), p_url, coalesce(p_tag, ''), p_dedup)
  on conflict (dedup) do nothing;
  if found then perform public.push_kick(); end if;
exception when others then null;
end $$;

-- Kinukuha ng push-send ang mga nakapila (isang beses lang ipinapadala ang bawat isa).
create or replace function public.push_claim(n integer default 200)
returns table (id bigint, user_id uuid, title text, body text, url text, tag text)
language sql security definer set search_path = public as $$
  update public.push_outbox o set sent_at = now()
  where o.id in (select x.id from public.push_outbox x where x.sent_at is null and x.created_at > now() - interval '1 day'
                 order by x.id limit n for update skip locked)
  returning o.id, o.user_id, o.title, o.body, o.url, o.tag
$$;
revoke execute on function public.push_kick(), public.cf_push(uuid, text, text, text, text, text), public.push_claim(integer) from public, anon, authenticated;
grant execute on function public.push_claim(integer) to service_role;

-- Oras sa Pilipinas, hal. "Sab, Nob 29 · 2:00 PM"
create or replace function public.cf_when(t timestamptz) returns text
language sql stable set search_path = public as $$
  select case when t is null then 'Ngayon na' else
    (array['Lin','Lun','Mar','Miy','Huw','Biy','Sab'])[extract(dow from t at time zone 'Asia/Manila')::int + 1] || ', ' ||
    (array['Ene','Peb','Mar','Abr','May','Hun','Hul','Ago','Set','Okt','Nob','Dis'])[extract(month from t at time zone 'Asia/Manila')::int] || ' ' ||
    extract(day from t at time zone 'Asia/Manila')::int || ' · ' || ltrim(to_char(t at time zone 'Asia/Manila', 'HH12:MI AM'), '0') end
$$;
create or replace function public.cf_first(n text) returns text
language sql immutable as $$ select coalesce(nullif(split_part(trim(coalesce(n, '')), ' ', 1), ''), 'Customer') $$;

-- ============ REFERRAL, CREDIT AT PROMO CODE ============
create table if not exists public.ref_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{4,12}$'),
  created_at timestamptz not null default now()
);
create table if not exists public.referrals (
  new_user uuid primary key references public.profiles(id) on delete cascade,
  referrer uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz
);
create table if not exists public.credits (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amt integer not null check (amt > 0),
  note text not null default '',
  booking_id bigint,             -- saan ginamit (null = magagamit pa)
  created_at timestamptz not null default now()
);
create index if not exists credits_user on public.credits(user_id) where booking_id is null;
create table if not exists public.promo_codes (
  code text primary key check (code ~ '^[A-Z0-9]{3,20}$'),
  kind text not null default 'fixed' check (kind in ('fixed', 'pct')),
  value integer not null check (value > 0),
  max_uses integer check (max_uses is null or max_uses > 0),
  first_only boolean not null default false,
  expires_at timestamptz,
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint promo_pct_max check (kind <> 'pct' or value <= 100)
);
alter table public.ref_codes enable row level security;
alter table public.referrals enable row level security;
alter table public.credits enable row level security;
alter table public.promo_codes enable row level security;
revoke all on public.ref_codes, public.referrals, public.credits, public.promo_codes from public, anon, authenticated;
grant select on public.ref_codes, public.referrals, public.credits to authenticated;
grant select, insert, update, delete on public.promo_codes to authenticated;
drop policy if exists "own ref code" on public.ref_codes;
create policy "own ref code" on public.ref_codes for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "own referrals" on public.referrals;
create policy "own referrals" on public.referrals for select to authenticated using (referrer = auth.uid() or new_user = auth.uid() or public.is_admin());
drop policy if exists "own credits" on public.credits;
create policy "own credits" on public.credits for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "admin promo" on public.promo_codes;
create policy "admin promo" on public.promo_codes for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Referral code ng user (ginagawa kapag wala pa): unang pangalan + 3 numero, hal. MARIA482
create or replace function public.my_ref_code() returns text
language plpgsql security definer set search_path = public as $$
declare c text; base text; i int := 0;
begin
  if auth.uid() is null then raise exception 'Mag-log in muna'; end if;
  select code into c from public.ref_codes where user_id = auth.uid();
  if c is not null then return c; end if;
  base := left(regexp_replace(upper(public.cf_first((select name from public.profiles where id = auth.uid()))), '[^A-Z]', '', 'g'), 6);
  if length(base) < 2 then base := 'CF'; end if;
  loop
    i := i + 1;
    c := base || lpad((floor(random() * 1000))::int::text, 3, '0');
    begin
      insert into public.ref_codes (user_id, code) values (auth.uid(), c);
      return c;
    exception when unique_violation then
      if exists (select 1 from public.ref_codes where user_id = auth.uid()) then
        return (select code from public.ref_codes where user_id = auth.uid());
      end if;
      if i > 20 then base := 'CF' || upper(substr(md5(random()::text), 1, 3)); end if;
    end;
  end loop;
end $$;

-- Bagong customer: ilagay ang referral code ng kaibigan (bago ang unang booking).
create or replace function public.apply_ref(p_code text) returns integer
language plpgsql security definer set search_path = public as $$
declare r uuid; amt integer := round(public.cf_num('ref_new', 50))::integer; me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then raise exception 'Mag-log in muna'; end if;
  if me.role <> 'customer' then raise exception 'Para sa customer lang ang referral code'; end if;
  select user_id into r from public.ref_codes where code = upper(trim(p_code));
  if r is null then raise exception 'Walang ganitong referral code'; end if;
  if r = me.id then raise exception 'Hindi pwedeng gamitin ang sarili mong code'; end if;
  if exists (select 1 from public.referrals where new_user = me.id) then raise exception 'May referral code ka nang nagamit'; end if;
  if me.created_at < now() - interval '30 days'
     or exists (select 1 from public.bookings where customer_id = me.id and status not in ('Kinansela', 'Tinanggihan')) then
    raise exception 'Para lang sa bagong customer na wala pang booking ang referral code';
  end if;
  insert into public.referrals (new_user, referrer) values (me.id, r);
  if amt > 0 then
    insert into public.credits (user_id, amt, note) values (me.id, amt, 'Referral ni ' || public.cf_first((select name from public.profiles where id = r)));
  end if;
  return amt;
end $$;

-- Pang-preview sa app: magkano ang discount ng promo code (sinusuri ulit sa server pagka-book).
create or replace function public.check_promo(p_code text, p_amt integer) returns integer
language plpgsql stable security definer set search_path = public as $$
declare p public.promo_codes; me uuid := auth.uid();
begin
  select * into p from public.promo_codes where code = upper(trim(p_code));
  if p.code is null or not p.active or (p.expires_at is not null and p.expires_at < now()) then
    raise exception 'Hindi valid o expired na ang promo code';
  end if;
  if p.max_uses is not null and (select count(*) from public.bookings where promo = p.code and status not in ('Kinansela', 'Tinanggihan')) >= p.max_uses then
    raise exception 'Naubos na ang promo code na ito';
  end if;
  if exists (select 1 from public.bookings where customer_id = me and promo = p.code and status not in ('Kinansela', 'Tinanggihan')) then
    raise exception 'Nagamit mo na ang promo code na ito';
  end if;
  if p.first_only and exists (select 1 from public.bookings where customer_id = me and status not in ('Kinansela', 'Tinanggihan')) then
    raise exception 'Para lang sa unang booking ang promo code na ito';
  end if;
  return least(greatest(p_amt, 0), case when p.kind = 'pct' then round(greatest(p_amt, 0) * p.value / 100.0)::integer else p.value end);
end $$;
revoke execute on function public.my_ref_code(), public.apply_ref(text), public.check_promo(text, integer) from public, anon;
grant execute on function public.my_ref_code(), public.apply_ref(text), public.check_promo(text, integer) to authenticated;

-- ============ PAULIT-ULIT NA CLEANING ============
create table if not exists public.repeat_plans (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  tech_id uuid not null references public.profiles(id) on delete cascade,
  src_booking bigint references public.bookings(id) on delete set null,
  items jsonb not null,
  svc text not null default '',
  address text not null default '',
  cust_lat double precision,
  cust_lng double precision,
  every_m smallint not null check (every_m in (3, 6)),
  hour smallint not null default 9 check (hour between 8 and 17),
  next_at timestamptz not null,
  active boolean not null default true,
  last_booking bigint,
  last_note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists repeat_plans_due on public.repeat_plans(next_at) where active;
alter table public.repeat_plans enable row level security;
revoke all on public.repeat_plans from public, anon, authenticated;
grant select on public.repeat_plans to authenticated;
drop policy if exists "own plans" on public.repeat_plans;
create policy "own plans" on public.repeat_plans for select to authenticated
  using (customer_id = auth.uid() or tech_id = auth.uid() or public.is_admin());

-- Customer: ulitin ang natapos na cleaning tuwing 3 o 6 na buwan (parehong technician, serbisyo at address).
create or replace function public.repeat_make(bid bigint, months integer) returns bigint
language plpgsql security definer set search_path = public as $$
declare b public.bookings; h int; nx timestamptz; pid bigint;
begin
  select * into b from public.bookings where id = bid;
  if b.id is null or b.customer_id <> auth.uid() then raise exception 'Walang ganitong booking'; end if;
  if b.status <> 'Natapos' then raise exception 'Pagkatapos ng trabaho lang ito pwedeng ulitin'; end if;
  if months not in (3, 6) then raise exception 'Pumili ng 3 o 6 na buwan'; end if;
  if b.items is null or b.svc not ilike '%cleaning%' then raise exception 'Para sa cleaning lang ang paulit-ulit na booking'; end if;
  h := least(17, greatest(8, extract(hour from coalesce(b.sched_at, b.done_at, now()) at time zone 'Asia/Manila')::int));
  nx := ((date_trunc('day', coalesce(b.done_at, now()) at time zone 'Asia/Manila') + make_interval(months => months, hours => h)) at time zone 'Asia/Manila');
  select id into pid from public.repeat_plans where src_booking = bid and active;
  if pid is not null then
    update public.repeat_plans set every_m = months, hour = h, next_at = nx where id = pid;
    return pid;
  end if;
  insert into public.repeat_plans (customer_id, tech_id, src_booking, items, svc, address, cust_lat, cust_lng, every_m, hour, next_at)
  values (b.customer_id, b.tech_id, b.id, jsonb_build_object('cart', b.items->'cart', 'extras', coalesce(b.items->'extras', '[]'::jsonb)),
          regexp_replace(b.svc, '^Warranty: ', ''), b.address, b.cust_lat, b.cust_lng, months, h, nx)
  returning id into pid;
  return pid;
end $$;
create or replace function public.repeat_stop(pid bigint) returns void
language sql security definer set search_path = public as $$
  update public.repeat_plans set active = false where id = pid and customer_id = auth.uid()
$$;
revoke execute on function public.repeat_make(bigint, integer), public.repeat_stop(bigint) from public, anon;
grant execute on function public.repeat_make(bigint, integer), public.repeat_stop(bigint) to authenticated;

-- ============ BOOKING: presyo, warranty at discount ============
-- Kapareho ng 006 prep_booking, dagdag ang: warranty (libreng balik), credit/promo code na discount.
create or replace function public.prep_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t record; it jsonb := new.items; w public.bookings; p public.promo_codes; cr record;
  cat jsonb := coalesce((select value from public.settings where key = 'catalog'), '[]'::jsonb);
  oc jsonb := coalesce((select value from public.settings where key = 'other_charges'), '[]'::jsonb);
  x jsonb; c jsonb; o jsonb; price numeric; q integer; d integer := 0;
  base numeric := 0; fx numeric := 0; pct numeric := 0; lines text[] := '{}'; ex text[] := '{}';
begin
  new.cust_note := left(coalesce(new.cust_note, ''), 500);
  if new.warranty_of is not null then
    -- Libreng balik: sa parehong technician, habang may warranty pa ang natapos na booking.
    select * into w from public.bookings where id = new.warranty_of;
    if w.id is null or w.customer_id <> new.customer_id or w.status <> 'Natapos' then
      raise exception 'Walang ganitong natapos na booking';
    end if;
    if w.warranty_until is null or w.warranty_until < now() then
      raise exception 'Tapos na ang warranty ng booking na ito';
    end if;
    if exists (select 1 from public.bookings b where b.warranty_of = w.id and b.status in ('Bago','Tinanggap','Papunta na','Dumating na')) then
      raise exception 'May warranty request ka na para sa booking na ito';
    end if;
    if length(trim(new.cust_note)) < 5 then raise exception 'Ilarawan ang problema'; end if;
    new.tech_id := w.tech_id; new.items := w.items; new.amt := 0; new.booking_fee := 0; new.rate := 0;
    new.svc := 'Warranty: ' || regexp_replace(w.svc, '^Warranty: ', '');
    new.discount := 0; new.promo := ''; new.plan_id := null;
  else
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
    if auth.uid() is not null then new.plan_id := null; end if;   -- ang cron lang ang naglalagay nito
  end if;
  new.pay_method := 'cash';
  new.cust_phone := '';
  new.cust_name := coalesce((select name from public.profiles where id = new.customer_id), new.cust_name);
  new.extra_amt := 0; new.extra_note := ''; new.q_amt := null; new.q_note := ''; new.q_status := 'wala'; new.q_at := null;
  new.final_amt := null; new.commission := null; new.done_at := null; new.warranty_until := null;
  new.rating := null; new.review := ''; new.rated_at := null;

  select role, name, services, cert_type, doc_status into t from public.profiles where id = new.tech_id;
  new.tech_name := coalesce(t.name, new.tech_name);
  if new.warranty_of is null then
    if public.wallet_low(new.tech_id) then
      raise exception 'Hindi available ngayon ang technician na ito. Pumili ng iba';
    end if;
    if (new.svc ilike 'Aircon Install%' or exists (
          select 1 from jsonb_array_elements_text(coalesce((select value from public.settings where key = 'nc2_only'), '[]'::jsonb)) y
          where position(lower(y) in lower(new.svc)) > 0))
       and not (t.cert_type = 'nc2' and t.doc_status = 'aprubado') then
      raise exception 'NC II certified na technician lang ang pwede sa serbisyong ito';
    end if;
    -- Discount: promo code kung may inilagay, kung wala ay ang pinakalumang credit ng customer.
    new.discount := 0;
    if coalesce(trim(new.promo), '') <> '' then
      select * into p from public.promo_codes where code = upper(trim(new.promo));
      if p.code is null or not p.active or (p.expires_at is not null and p.expires_at < now()) then
        raise exception 'Hindi valid o expired na ang promo code';
      end if;
      perform pg_advisory_xact_lock(hashtext('promo:' || p.code));
      if p.max_uses is not null and (select count(*) from public.bookings where promo = p.code and status not in ('Kinansela', 'Tinanggihan')) >= p.max_uses then
        raise exception 'Naubos na ang promo code na ito';
      end if;
      if exists (select 1 from public.bookings where customer_id = new.customer_id and promo = p.code and status not in ('Kinansela', 'Tinanggihan')) then
        raise exception 'Nagamit mo na ang promo code na ito';
      end if;
      if p.first_only and exists (select 1 from public.bookings where customer_id = new.customer_id and status not in ('Kinansela', 'Tinanggihan')) then
        raise exception 'Para lang sa unang booking ang promo code na ito';
      end if;
      d := case when p.kind = 'pct' then round(new.amt * p.value / 100.0)::integer else p.value end;
      new.promo := p.code;
    else
      new.promo := '';
      select id, amt into cr from public.credits where user_id = new.customer_id and booking_id is null order by created_at, id limit 1 for update skip locked;
      if cr.id is not null then
        d := cr.amt; new.promo := 'CREDIT';
        update public.credits set booking_id = new.id where id = cr.id;
      end if;
    end if;
    new.discount := least(greatest(d, 0), new.amt);
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

-- Kapareho ng 006 money_booking, dagdag ang: bantay sa bagong column, warranty na hindi kailangan ng wallet,
-- at warranty_until ng libreng balik = warranty ng orihinal na booking.
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
       or new.review is distinct from old.review or new.rated_at is distinct from old.rated_at
       or new.warranty_of is distinct from old.warranty_of or new.cust_note is distinct from old.cust_note
       or new.discount is distinct from old.discount or new.promo is distinct from old.promo
       or new.plan_id is distinct from old.plan_id) then
      raise exception 'Bawal baguhin ang bayad ng booking';
    end if;
    if auth.uid() = old.tech_id and old.status = 'Bago' and new.status in ('Tinanggap', 'Papunta na')
       and old.warranty_of is null and public.wallet_low(old.tech_id) then
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
    if new.warranty_of is not null then
      new.warranty_until := (select warranty_until from public.bookings where id = new.warranty_of);
    else
      new.warranty_until := now() + make_interval(days => round(public.cf_num('warranty_days', 30))::integer);
    end if;
  end if;
  return new;
end $$;

-- Pagkatapos ng booking: notification, discount na ibinabalik sa technician, referral reward, at pagbalik ng credit kapag kinansela.
create or replace function public.after_booking() returns trigger
language plpgsql security definer set search_path = public as $$
declare u text := './#b=' || new.id; ref public.referrals; amt integer; nm text := public.cf_first(new.cust_name); tn text := public.cf_first(new.tech_name);
begin
  if tg_op = 'INSERT' then
    perform public.cf_push(new.tech_id,
      case when new.warranty_of is not null then 'Warranty: babalikan ka ni ' || nm
           when new.plan_id is not null then 'Paulit-ulit na cleaning ni ' || nm
           else 'Bagong booking mula kay ' || nm end,
      new.svc || ' · ' || public.cf_when(new.sched_at), u, 'b' || new.id);
    return null;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'Tinanggap' then perform public.cf_push(new.customer_id, 'Tinanggap ni ' || tn || ' ang booking mo', public.cf_when(new.sched_at) || ' · ' || new.svc, u, 'b' || new.id);
    elsif new.status = 'Papunta na' then perform public.cf_push(new.customer_id, 'Papunta na si ' || tn || '!', 'Buksan ang app para makita kung nasaan na siya.', u, 'b' || new.id);
    elsif new.status = 'Dumating na' then perform public.cf_push(new.customer_id, 'Dumating na si ' || tn, new.svc, u, 'b' || new.id);
    elsif new.status = 'Natapos' then perform public.cf_push(new.customer_id, 'Tapos na ang trabaho ni ' || tn, 'Babayaran: ₱' || to_char(new.final_amt + new.booking_fee - new.discount, 'FM999,999,990') || '. I-rate ang serbisyo sa app.', u, 'b' || new.id);
    elsif new.status = 'Tinanggihan' then perform public.cf_push(new.customer_id, 'Hindi available si ' || tn, 'Pumili ng ibang technician sa app.', u, 'b' || new.id);
    elsif new.status = 'Kinansela' then perform public.cf_push(new.tech_id, 'Kinansela ni ' || nm || ' ang booking', new.svc, u, 'b' || new.id);
    end if;
    if new.status in ('Kinansela', 'Tinanggihan') then
      update public.credits set booking_id = null where booking_id = new.id;
    end if;
    if new.status = 'Natapos' then
      if new.discount > 0 and not exists (select 1 from public.wallet_tx where booking_id = new.id and kind = 'promo') then
        perform public.wallet_add(new.tech_id, 'promo', new.discount,
          'Discount na sagot ng CoolFix (' || case when new.promo = 'CREDIT' then 'credit' else new.promo end || ') · ' || new.code, new.id, null);
      end if;
      select * into ref from public.referrals where new_user = new.customer_id and rewarded_at is null for update;
      if ref.new_user is not null and new.warranty_of is null then
        update public.referrals set rewarded_at = now() where new_user = ref.new_user;
        amt := round(public.cf_num('ref_inv', 50))::integer;
        if amt > 0 then
          insert into public.credits (user_id, amt, note) values (ref.referrer, amt, 'Referral: natapos ang unang booking ni ' || nm);
          perform public.cf_push(ref.referrer, 'May ₱' || amt || ' credit ka!', 'Natapos na ang unang booking ni ' || nm || '. Awtomatikong ibabawas ito sa susunod mong booking.', './#me', 'ref');
        end if;
      end if;
    end if;
  end if;
  if new.q_status is distinct from old.q_status then
    if new.q_status = 'hinihintay' then perform public.cf_push(new.customer_id, 'May quote si ' || tn || ': +₱' || new.q_amt, new.q_note || ' · Buksan para aprubahan o tanggihan', u, 'q' || new.id);
    elsif new.q_status = 'aprubado' then perform public.cf_push(new.tech_id, 'Inaprubahan ni ' || nm || ' ang quote mo', new.q_note, u, 'q' || new.id);
    elsif new.q_status = 'tinanggihan' then perform public.cf_push(new.tech_id, 'Hindi inaprubahan ni ' || nm || ' ang quote', new.q_note, u, 'q' || new.id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists bookings_after on public.bookings;
create trigger bookings_after after insert or update on public.bookings
  for each row execute function public.after_booking();

-- Bagong mensahe: abiso sa kausap.
create or replace function public.after_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.conversations;
begin
  select * into c from public.conversations where id = new.conv_id;
  if c.id is null then return null; end if;
  if new.sender = 'c' then
    perform public.cf_push(c.tech_id, 'Mensahe mula kay ' || public.cf_first(c.cust_name), case when new.file is not null and new.body in ('', ' ') then '📎 May ipinadalang file' else new.body end, './#c=' || c.id, 'm' || c.id);
  else
    perform public.cf_push(c.customer_id, 'Mensahe mula kay ' || public.cf_first(c.tech_name), case when new.file is not null and new.body in ('', ' ') then '📎 May ipinadalang file' else new.body end, './#c=' || c.id, 'm' || c.id);
  end if;
  return null;
end $$;
drop trigger if exists messages_after on public.messages;
create trigger messages_after after insert on public.messages
  for each row execute function public.after_message();

-- ============ BAWAT 5 MINUTO: paalala at paulit-ulit na cleaning ============
create or replace function public.cf_tick() returns void
language plpgsql security definer set search_path = public as $$
declare b record; pl record; s timestamptz; nb bigint; ok boolean; err text; i int;
begin
  -- 1) Paalala: 1 araw at 1 oras bago ang schedule
  for b in select * from public.bookings where status in ('Bago', 'Tinanggap') and sched_at between now() and now() + interval '25 hours' loop
    if b.sched_at <= now() + interval '24 hours' and b.sched_at > now() + interval '2 hours' and b.created_at <= b.sched_at - interval '20 hours' then
      if b.status = 'Tinanggap' then
        perform public.cf_push(b.customer_id, 'Paalala: bukas na ang booking mo', public.cf_when(b.sched_at) || ' · ' || public.cf_first(b.tech_name) || ' · ' || b.svc, './#b=' || b.id, 'r' || b.id, 'r1d-c-' || b.id);
        perform public.cf_push(b.tech_id, 'Paalala: may booking ka bukas', public.cf_when(b.sched_at) || ' · ' || public.cf_first(b.cust_name) || ' · ' || b.address, './#b=' || b.id, 'r' || b.id, 'r1d-t-' || b.id);
      else
        perform public.cf_push(b.tech_id, 'Hindi mo pa tinatanggap ang booking bukas', public.cf_when(b.sched_at) || ' · ' || public.cf_first(b.cust_name) || ' · ' || b.svc, './#b=' || b.id, 'r' || b.id, 'r1d-t-' || b.id);
      end if;
    end if;
    if b.sched_at <= now() + interval '65 minutes' and b.created_at <= b.sched_at - interval '2 hours' then
      if b.status = 'Tinanggap' then
        perform public.cf_push(b.customer_id, 'Mamaya na ang booking mo (1 oras)', public.cf_when(b.sched_at) || ' · ' || public.cf_first(b.tech_name) || ' · ' || b.svc, './#b=' || b.id, 'r' || b.id, 'r1h-c-' || b.id);
        perform public.cf_push(b.tech_id, 'Booking mo sa loob ng 1 oras', public.cf_when(b.sched_at) || ' · ' || public.cf_first(b.cust_name) || ' · ' || b.address, './#b=' || b.id, 'r' || b.id, 'r1h-t-' || b.id);
      else
        perform public.cf_push(b.tech_id, 'Tanggapin o tanggihan ang booking (1 oras na lang)', public.cf_when(b.sched_at) || ' · ' || public.cf_first(b.cust_name), './#b=' || b.id, 'r' || b.id, 'r1h-t-' || b.id);
      end if;
    end if;
  end loop;

  -- 2) Paulit-ulit na cleaning: mag-book 3 araw bago ang petsa
  for pl in select * from public.repeat_plans where active and next_at <= now() + interval '3 days' order by next_at limit 50 for update skip locked loop
    ok := false; err := ''; nb := null;
    -- petsa: ang next_at (o bukas, kung malapit na), sa oras na pinili; susubukan din ang 2 oras bago o pagkatapos
    s := ((date_trunc('day', greatest(pl.next_at, now() + interval '12 hours') at time zone 'Asia/Manila') + make_interval(hours => pl.hour)) at time zone 'Asia/Manila');
    if s < now() + interval '12 hours' then s := s + interval '1 day'; end if;
    foreach i in array array[0, 2, -2, 4, -4] loop
      continue when pl.hour + i < 8 or pl.hour + i > 17;
      begin
        insert into public.bookings (customer_id, tech_id, cust_name, tech_name, svc, items, address, cust_lat, cust_lng, sched, sched_at, amt, plan_id)
        values (pl.customer_id, pl.tech_id, '', '', pl.svc, pl.items, pl.address, pl.cust_lat, pl.cust_lng,
                'Paulit-ulit na cleaning', s + make_interval(hours => i), 0, pl.id)
        returning id into nb;
        ok := true; exit;
      exception when others then err := sqlerrm;
      end;
    end loop;
    update public.repeat_plans set next_at = next_at + make_interval(months => every_m), last_booking = coalesce(nb, last_booking),
      last_note = case when ok then '' else err end where id = pl.id;
    if ok then
      perform public.cf_push(pl.customer_id, 'Na-book na ang paulit-ulit mong cleaning',
        public.cf_when((select sched_at from public.bookings where id = nb)) || ' · ' || pl.svc || '. Hinihintay ang sagot ng technician.', './#b=' || nb, 'b' || nb);
    else
      perform public.cf_push(pl.customer_id, 'Hindi ma-book ang paulit-ulit mong cleaning',
        'Hindi available ang technician (' || err || '). Mag-book sa ibang technician sa app.', './', 'plan' || pl.id);
    end if;
  end loop;

  -- 3) Ipadala ang naiwan sa pila
  if exists (select 1 from public.push_outbox where sent_at is null and created_at > now() - interval '1 day') then
    perform public.push_kick();
  end if;
  delete from public.push_outbox where created_at < now() - interval '14 days';
end $$;
revoke execute on function public.cf_tick() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('coolfix-tick');
exception when others then null;
end $$;
select cron.schedule('coolfix-tick', '*/5 * * * *', $$select public.cf_tick()$$);

-- ============ REALTIME ============
do $$ begin
  begin alter publication supabase_realtime add table public.credits; exception when others then null; end;
end $$;
