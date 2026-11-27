-- CoolFix: online na top-up ng Tech Wallet gamit ang PayMongo (GCash, Maya, card) (012_paymongo.sql)
-- Patakbuhin pagkatapos ng 006_wallet.sql.
--  * Ang Edge Function na "paymongo-checkout" ang gumagawa ng top-up row (method = 'paymongo', status = 'naghihintay').
--  * Ang Edge Function na "paymongo-webhook" ang tumatawag sa pm_paid() kapag bayad na. Isang beses lang papasok ang credits.
--  * Ang lumang GCash/Maya na may screenshot (aaprubahan ng admin) ay gumagana pa rin.

insert into public.settings (key, value) values ('paymongo_on', 'false'::jsonb) on conflict (key) do nothing;

-- Bagong paraan at status
alter table public.topups drop constraint if exists topups_method_check;
alter table public.topups add constraint topups_method_check check (method in ('gcash', 'maya', 'paymongo'));
alter table public.topups drop constraint if exists topups_status_check;
alter table public.topups add constraint topups_status_check
  check (status in ('naghihintay', 'sinusuri', 'aprubado', 'tinanggihan', 'expired'));
alter table public.topups add column if not exists pm_payment text not null default '';
alter table public.topups add column if not exists paid_with text not null default '';

create or replace function public.prep_topup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.method = 'paymongo' then
    -- Ang server lang (Edge Function na may service role) ang pwedeng gumawa ng PayMongo top-up.
    if auth.uid() is not null then raise exception 'Hindi pwede'; end if;
    new.status := 'naghihintay'; new.proof := ''; new.note := ''; new.pm_payment := ''; new.paid_with := '';
    new.reviewed_at := null; new.reviewed_by := null; new.created_at := now();
    return new;
  end if;
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
  new.pm_payment := ''; new.paid_with := '';
  return new;
end $$;

-- Paalala: hindi kailangang baguhin ang review_topup(): "sinusuri" lang ang naaaprubahan nito,
-- at hindi kailanman "sinusuri" ang PayMongo top-up.

-- Tinatawag ng webhook kapag kumpirmadong bayad na sa PayMongo. Ligtas tawagin nang paulit-ulit.
-- Ibinabalik: 'credited', 'already', 'not_found', o 'amount_mismatch'.
create or replace function public.pm_paid(sess text, pay_id text, centavos bigint, via text) returns text
language plpgsql security definer set search_path = public as $$
declare t public.topups;
begin
  select * into t from public.topups where method = 'paymongo' and ref = sess for update;
  if not found then return 'not_found'; end if;
  if t.status = 'aprubado' then return 'already'; end if;
  if centavos <> t.amt::bigint * 100 then
    update public.topups set note = 'Hindi tugma ang halagang binayaran (' || centavos || ' centavos)' where id = t.id;
    return 'amount_mismatch';
  end if;
  update public.topups set status = 'aprubado', pm_payment = coalesce(pay_id, ''), paid_with = coalesce(via, ''),
         note = '', reviewed_at = now() where id = t.id;
  perform public.wallet_add(t.tech_id, 'topup', t.amt,
    'Top-up online' || case when coalesce(via, '') <> '' then ' (' || via || ')' else '' end || ' · ' || coalesce(pay_id, sess), null, t.id);
  return 'credited';
end $$;

-- Mga lumang hindi nabayarang checkout (lampas 1 araw): markahang expired.
create or replace function public.pm_expire_old() returns integer
language sql security definer set search_path = public as $$
  with x as (update public.topups set status = 'expired'
             where method = 'paymongo' and status = 'naghihintay' and created_at < now() - interval '1 day' returning 1)
  select count(*)::integer from x;
$$;

revoke execute on function public.pm_paid(text, text, bigint, text) from public, anon, authenticated;
revoke execute on function public.pm_expire_old() from public, anon, authenticated;
revoke execute on function public.prep_topup() from public, anon, authenticated;
grant execute on function public.pm_paid(text, text, bigint, text) to service_role;
grant execute on function public.pm_expire_old() to service_role;
