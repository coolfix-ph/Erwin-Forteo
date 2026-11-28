-- 015: Profile picture para sa lahat, at public profile ng technician
-- (tungkol sa akin, taon ng karanasan, brand na kabisado, litrato ng trabaho).
-- Patakbuhin sa SQL Editor pagkatapos ng 014.

alter table public.profiles
  add column if not exists avatar text,                         -- storage path sa bucket 'avatars': <user id>/<file>.jpg
  add column if not exists bio text not null default '',
  add column if not exists years_exp smallint,
  add column if not exists brands text[] not null default '{}',
  add column if not exists gallery text[] not null default '{}';  -- hanggang 6 na litrato ng trabaho

alter table public.profiles drop constraint if exists profiles_bio_len;
alter table public.profiles add constraint profiles_bio_len check (char_length(bio) <= 600);
alter table public.profiles drop constraint if exists profiles_years_exp;
alter table public.profiles add constraint profiles_years_exp check (years_exp is null or years_exp between 0 and 60);
alter table public.profiles drop constraint if exists profiles_brands_n;
alter table public.profiles add constraint profiles_brands_n check (cardinality(brands) <= 15);
alter table public.profiles drop constraint if exists profiles_gallery_n;
alter table public.profiles add constraint profiles_gallery_n check (cardinality(gallery) <= 6);

-- Sariling folder lang ang pwedeng ituro ng avatar at gallery, at maikling text lang ang brand.
create or replace function public.guard_profile_media() returns trigger
language plpgsql set search_path = public as $$
declare pre text := new.id::text || '/'; x text;
begin
  if new.avatar is not null and new.avatar !~ ('^' || new.id::text || '/[A-Za-z0-9._-]{1,80}$') then
    raise exception 'Hindi tamang litrato';
  end if;
  foreach x in array coalesce(new.gallery, '{}') loop
    if x !~ ('^' || new.id::text || '/[A-Za-z0-9._-]{1,80}$') then raise exception 'Hindi tamang litrato'; end if;
  end loop;
  foreach x in array coalesce(new.brands, '{}') loop
    if char_length(x) > 30 then raise exception 'Masyadong mahaba ang brand'; end if;
  end loop;
  return new;
end $$;
drop trigger if exists profiles_media on public.profiles;
create trigger profiles_media before insert or update of avatar, gallery, brands on public.profiles
  for each row execute function public.guard_profile_media();

-- Nakikita ng ibang naka-log in (public na bahagi ng technician profile) at nae-edit ng may-ari.
grant select (avatar, bio, years_exp, brands, gallery) on public.profiles to authenticated;
grant update (avatar, bio, years_exp, brands, gallery) on public.profiles to authenticated;

-- Litrato ng mga taong kausap/ka-booking mo (hal. para makita ng technician ang litrato ng customer).
-- Technician: nakikita ng lahat. Customer: ng sarili, ng admin, at ng technician na may booking o chat sa kanya.
create or replace function public.avatars_of(ids uuid[]) returns table(id uuid, avatar text)
language sql stable security definer set search_path = public as $$
  select p.id, p.avatar from public.profiles p
  where p.id = any(ids) and p.avatar is not null and auth.uid() is not null
    and (p.role = 'technician' or p.id = auth.uid() or public.is_admin()
      or exists (select 1 from public.bookings b where b.customer_id = p.id and b.tech_id = auth.uid())
      or exists (select 1 from public.conversations c where c.customer_id = p.id and c.tech_id = auth.uid()))
$$;
revoke all on function public.avatars_of(uuid[]) from public, anon;
grant execute on function public.avatars_of(uuid[]) to authenticated;

-- Storage: public na bucket (para mabilis lumabas sa listahan), images lang, max 2 MB.
-- Sariling folder lang ang pwedeng i-upload, palitan at burahin. Walang listing ng ibang folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars insert own" on storage.objects;
create policy "avatars insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars read own" on storage.objects;
create policy "avatars read own" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars update own" on storage.objects;
create policy "avatars update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
