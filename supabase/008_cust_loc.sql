-- CoolFix: eksaktong lokasyon ng customer sa booking, para sa mapa at direksyon ng technician.
-- Patakbuhin PAGKATAPOS ng 007_tech_privacy.sql. Ligtas patakbuhin ulit.
-- Ang technician at ang customer ng booking lang ang nakakakita nito (sakop ng "bookings read" policy).
alter table public.bookings add column if not exists cust_lat double precision;
alter table public.bookings add column if not exists cust_lng double precision;
