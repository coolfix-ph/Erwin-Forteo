-- 016: Bilangin ang nag-install ng CoolFix app (PWA) para makita sa admin dashboard.
-- Patakbuhin sa SQL Editor pagkatapos ng 015. Ligtas patakbuhin ulit.
-- Paano nabibilang:
--   'install' = pinindot ang Install at natapos (appinstalled event: Android, computer).
--   'open'    = unang beses na binuksan ang app mula sa home screen / desktop icon.
--               Ito lang ang paraan para mabilang ang iPhone, dahil walang install event ang Safari.
-- Isang device = isang random na ID na naka-save sa browser (walang personal na data).

create table if not exists public.app_installs (
  id bigint generated always as identity primary key,
  device text not null check (device ~ '^[A-Za-z0-9-]{8,64}$'),
  platform text not null check (platform in ('android', 'iphone', 'desktop', 'iba')),
  via text not null check (via in ('install', 'open')),
  created_at timestamptz not null default now(),
  unique (device, via)
);
create index if not exists app_installs_created on public.app_installs (created_at);

alter table public.app_installs enable row level security;
revoke all on public.app_installs from public, anon, authenticated;
grant select on public.app_installs to authenticated;
drop policy if exists "admin reads installs" on public.app_installs;
create policy "admin reads installs" on public.app_installs for select to authenticated
  using (public.is_admin());
-- Walang insert/update/delete policy: ang pagdagdag ay sa log_install() lang.

-- Tinatawag ng pwa.js. Hindi nababasa ng caller ang table; pagdagdag lang ang kaya.
create or replace function public.log_install(p_device text, p_platform text, p_via text) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- preno laban sa spam: hanggang 300 bagong record kada 10 minuto
  if (select count(*) from public.app_installs where created_at > now() - interval '10 minutes') >= 300 then return; end if;
  insert into public.app_installs (device, platform, via)
  values (p_device, case when p_platform in ('android', 'iphone', 'desktop') then p_platform else 'iba' end, p_via)
  on conflict (device, via) do nothing;
end $$;

revoke execute on function public.log_install(text, text, text) from public;
grant execute on function public.log_install(text, text, text) to anon, authenticated;
