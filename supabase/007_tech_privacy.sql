-- CoolFix: itago ang cellphone, email at dokumento ng technician sa ibang user (007_tech_privacy.sql).
-- Ligtas patakbuhin ulit. Hindi ito umaasa sa 006_wallet.sql.
-- Dati: kahit sinong naka-login ay nakakakuha ng phone at email ng lahat ng technician sa API,
-- kaya pwedeng kontakin ang technician nang hindi dumadaan sa app.
-- Ngayon: column lang na ligtas ang nababasa ng iba (pati sa realtime).
-- Ang buong profile ay sa may-ari (my_profile) at sa admin (admin_profiles) lang.
-- KAILANGAN ang bagong app.js (branch tech-privacy) kasabay nito.

revoke select on public.profiles from anon, authenticated;
grant select (id, role, name, services, online, lat, lng, addr, cert_type, doc_status, google, created_at)
  on public.profiles to authenticated;

create or replace function public.my_profile() returns public.profiles
language sql stable security definer set search_path = public as $$
  select * from public.profiles where id = auth.uid()
$$;

create or replace function public.admin_profiles() returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select * from public.profiles where public.is_admin() order by created_at
$$;

revoke execute on function public.my_profile(), public.admin_profiles() from public, anon;
grant execute on function public.my_profile(), public.admin_profiles() to authenticated;
