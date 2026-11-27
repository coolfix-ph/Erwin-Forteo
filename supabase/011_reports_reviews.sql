-- CoolFix: customer service report at mga review ng technician.
-- Patakbuhin PAGKATAPOS ng 010_socials.sql. Ligtas patakbuhin ulit.

-- ============ REPORTS ============
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  code text generated always as ('RP-' || (1000 + id)::text) stored,
  reporter_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  booking_id bigint references public.bookings(id) on delete set null,
  cat text not null check (cat in ('technician','bayad','app','kaligtasan','iba')),
  body text not null check (char_length(body) between 10 and 1000),
  file jsonb,
  status text not null default 'bago' check (status in ('bago','inaasikaso','naresolba')),
  admin_note text not null default '' check (char_length(admin_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (file is null or (file->>'path') like reporter_id::text || '/%')
);
create index if not exists reports_reporter on public.reports(reporter_id, created_at desc);
alter table public.reports enable row level security;

drop policy if exists "reports read" on public.reports;
create policy "reports read" on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());
-- Sariling report lang, at kung may booking, dapat kasali siya roon.
drop policy if exists "reports insert" on public.reports;
create policy "reports insert" on public.reports for insert to authenticated
  with check (reporter_id = auth.uid() and status = 'bago' and admin_note = ''
    and (booking_id is null or exists (select 1 from public.bookings b where b.id = booking_id
         and auth.uid() in (b.customer_id, b.tech_id))));
drop policy if exists "reports admin update" on public.reports;
create policy "reports admin update" on public.reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.touch_report() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists reports_touch on public.reports;
create trigger reports_touch before update on public.reports for each row execute function public.touch_report();

grant select, insert, update on public.reports to authenticated;
revoke all on public.reports from anon;

do $$ begin
  alter publication supabase_realtime add table public.reports;
exception when duplicate_object then null; end $$;

-- Larawan o file na kasama ng report (private).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reports', 'reports', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf','video/mp4','video/quicktime'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "reports upload own" on storage.objects;
create policy "reports upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "reports read own or admin" on storage.objects;
create policy "reports read own or admin" on storage.objects for select to authenticated
  using (bucket_id = 'reports' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ============ REVIEWS ============
-- Mga review ng isang technician para makita ng customer. Unang pangalan at inisyal lang ng customer.
create or replace function public.tech_reviews(t uuid, n integer default 20)
returns table (rating smallint, review text, rated_at timestamptz, who text)
language sql stable security definer set search_path = public as $$
  select b.rating, b.review, b.rated_at,
         split_part(trim(p.name), ' ', 1) || coalesce(' ' || nullif(left(split_part(trim(p.name), ' ', 2), 1), '') || '.', '')
  from public.bookings b join public.profiles p on p.id = b.customer_id
  where b.tech_id = t and b.rating is not null
  order by b.rated_at desc nulls last
  limit least(greatest(n, 1), 50)
$$;
revoke all on function public.tech_reviews(uuid, integer) from public, anon;
grant execute on function public.tech_reviews(uuid, integer) to authenticated;
