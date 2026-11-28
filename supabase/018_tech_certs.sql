-- 018: Mga certificate ng technician na nakikita ng customer (NC II at training certificate).
-- Patakbuhin sa SQL Editor pagkatapos ng 017. Ligtas patakbuhin ulit.
--
-- Buod:
--  * tech_certs: certificate na gustong ipakita ng technician sa profile niya (hanggang 8).
--    Laging "sinusuri" muna. Ang admin lang ang nag-aapruba. Ang aprubado lang ang nakikita ng customer,
--    na may tatak na "Verified ng CoolFix".
--  * Bucket na 'tech-certs' (pribado). Ang file ng aprubadong certificate lang ang mabubuksan ng ibang user.
--    Hindi pwedeng palitan o burahin ng technician ang file pagka-upload, kaya hindi mapapalitan ang laman
--    ng certificate pagkatapos itong aprubahan. Kung may mali, buburahin ang certificate at mag-a-upload ng bago.
--  * Hindi ginagalaw ang 'tech-docs' (valid ID, NC II, DTI, BIR sa sign-up). Pribado pa rin iyon.

create table if not exists public.tech_certs (
  id bigint generated always as identity primary key,
  tech_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('nc2', 'training')),
  title text not null check (char_length(title) between 2 and 80),
  issuer text not null default '' check (char_length(issuer) <= 80),
  issued_year smallint check (issued_year is null or issued_year between 1970 and 2100),
  path text not null,
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  status text not null default 'sinusuri' check (status in ('sinusuri', 'aprubado', 'tinanggihan')),
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists tech_certs_tech on public.tech_certs (tech_id);

-- Bantay: technician lang ang pwedeng magdagdag, sa sariling folder lang ang file, laging sinusuri muna,
-- hanggang 8 lang. Ang admin lang ang pwedeng mag-apruba o tumanggi.
create or replace function public.guard_tech_cert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_admin() then
      if not exists (select 1 from public.profiles where id = auth.uid() and role = 'technician') then
        raise exception 'Technician lang ang pwedeng magdagdag ng certificate';
      end if;
      new.tech_id := auth.uid(); new.status := 'sinusuri'; new.note := ''; new.reviewed_at := null;
    end if;
    if new.path !~ ('^' || new.tech_id::text || '/[A-Za-z0-9._-]{1,80}$') then
      raise exception 'Hindi tamang file';
    end if;
    if (select count(*) from public.tech_certs where tech_id = new.tech_id) >= 8 then
      raise exception 'Hanggang 8 na certificate lang';
    end if;
    new.created_at := now();
    return new;
  end if;
  -- UPDATE: status at note lang, at admin lang.
  if not public.is_admin() then raise exception 'Ang admin lang ang pwedeng mag-apruba ng certificate'; end if;
  if new.tech_id <> old.tech_id or new.path <> old.path or new.mime <> old.mime then
    raise exception 'Bawal palitan ang file ng certificate';
  end if;
  if new.status is distinct from old.status then new.reviewed_at := now(); end if;
  if new.status = 'aprubado' then new.note := ''; end if;
  return new;
end $$;
drop trigger if exists tech_certs_guard on public.tech_certs;
create trigger tech_certs_guard before insert or update on public.tech_certs
  for each row execute function public.guard_tech_cert();

alter table public.tech_certs enable row level security;
drop policy if exists "tech_certs read" on public.tech_certs;
create policy "tech_certs read" on public.tech_certs for select to authenticated
  using (status = 'aprubado' or tech_id = auth.uid() or public.is_admin());
drop policy if exists "tech_certs insert own" on public.tech_certs;
create policy "tech_certs insert own" on public.tech_certs for insert to authenticated
  with check (tech_id = auth.uid() or public.is_admin());
drop policy if exists "tech_certs update admin" on public.tech_certs;
create policy "tech_certs update admin" on public.tech_certs for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "tech_certs delete own" on public.tech_certs;
create policy "tech_certs delete own" on public.tech_certs for delete to authenticated
  using (tech_id = auth.uid() or public.is_admin());

revoke all on public.tech_certs from anon;
grant select, insert, delete on public.tech_certs to authenticated;
grant update (status, note) on public.tech_certs to authenticated;

-- ============ STORAGE ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tech-certs', 'tech-certs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Upload: sariling folder lang. Walang update o delete para sa technician (hindi mapapalitan ang aprubadong file).
drop policy if exists "tech-certs insert own" on storage.objects;
create policy "tech-certs insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'tech-certs' and (storage.foldername(name))[1] = auth.uid()::text);
-- Basa: ang may-ari, ang admin, at ang lahat ng naka-login kung aprubado ang certificate na gumagamit ng file.
drop policy if exists "tech-certs read" on storage.objects;
create policy "tech-certs read" on storage.objects for select to authenticated
  using (bucket_id = 'tech-certs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()
    or exists (select 1 from public.tech_certs c where c.path = storage.objects.name and c.status = 'aprubado')));
drop policy if exists "tech-certs delete admin" on storage.objects;
create policy "tech-certs delete admin" on storage.objects for delete to authenticated
  using (bucket_id = 'tech-certs' and public.is_admin());
