-- CoolFix: pahintulot para sa server (Edge Functions ng PayMongo) (014_paymongo_grants.sql)
-- Sa project na ito, walang access ang service_role sa mga table hangga't hindi binibigyan.
-- Kailangan ng paymongo-checkout na mabasa ang profile at settings, at makagawa ng top-up row.
grant select on public.profiles, public.settings to service_role;
grant select, insert on public.topups to service_role;
