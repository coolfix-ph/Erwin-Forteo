-- CoolFix: awtomatikong setup ng PayMongo webhook at pagsubok bago i-on sa lahat (013_paymongo_setup.sql)
-- Patakbuhin pagkatapos ng 012_paymongo.sql.
--  * pm_config: dito itinatago ng server ang webhook secret ng PayMongo. Server lang (service role) ang nakakabasa.
--  * paymongo_testers: listahan ng technician (id) na pwedeng sumubok ng online top-up kahit naka-off pa ito sa lahat.

create table if not exists public.pm_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.pm_config enable row level security;   -- walang policy: anon at authenticated, walang access
revoke all on public.pm_config from public, anon, authenticated;
grant select, insert, update, delete on public.pm_config to service_role;

insert into public.settings (key, value) values ('paymongo_testers', '[]'::jsonb) on conflict (key) do nothing;
