-- CoolFix: social media ng technician (Facebook, WhatsApp, Telegram) at mga link ng komunidad.
-- Patakbuhin PAGKATAPOS ng 009_chat_files.sql. Ligtas patakbuhin ulit.
-- Ang socials ay HINDI kasama sa column grants ng 007_tech_privacy.sql, kaya ang technician mismo
-- (my_profile) at ang admin (admin_profiles) lang ang nakakakita nito. Hindi ito nakikita ng customer.
alter table public.profiles add column if not exists socials jsonb not null default '{}'::jsonb;
alter table public.profiles drop constraint if exists profiles_socials_ok;
alter table public.profiles add constraint profiles_socials_ok
  check (jsonb_typeof(socials) = 'object' and length(socials::text) < 1000);

-- Link ng Facebook group chat at community ng mga technician (pwedeng palitan ng admin sa Base price).
insert into public.settings (key, value) values
  ('fb_gc', '"https://m.me/j/6zfKIc_s_N1CLkz1/?send_source=gc:copy_invite_link_c"'::jsonb),
  ('community_link', '""'::jsonb)
on conflict (key) do nothing;
