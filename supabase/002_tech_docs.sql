-- CoolFix: dokumento ng technician (NC II, o DTI Permit + BIR COR)
-- Ligtas patakbuhin ulit. Kasama na rin ito sa dulo ng schema.sql.

alter table public.profiles add column if not exists cert_type text check (cert_type in ('nc2', 'dti_bir'));
alter table public.profiles add column if not exists docs jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists doc_status text not null default 'kulang'
  check (doc_status in ('kulang', 'sinusuri', 'aprubado', 'tinanggihan'));
alter table public.profiles add column if not exists doc_note text not null default '';

-- Kung kailangan ng pag-apruba ng admin bago mag-online ang technician.
insert into public.settings (key, value) values ('require_doc_approval', 'true'::jsonb)
  on conflict (key) do nothing;

-- Bantay: ang technician ay pwedeng mag-submit (sinusuri) pero hindi pwedeng mag-apruba ng sarili,
-- at hindi pwedeng mag-online nang walang aprubado o naka-submit na dokumento.
create or replace function public.guard_role() returns trigger
language plpgsql security definer set search_path = public as $$
declare need_ok boolean := coalesce((select (value)::text::boolean from public.settings where key = 'require_doc_approval'), true);
begin
  if new.role is distinct from old.role and not public.is_admin()
     and (new.role = 'admin' or old.role = 'admin') then
    raise exception 'Bawal baguhin ang role na ito';
  end if;
  if not public.is_admin() then
    -- Kapag pinalitan ang dokumento, babalik sa pagsusuri.
    if new.docs is distinct from old.docs or new.cert_type is distinct from old.cert_type then
      new.doc_status := 'sinusuri';
    end if;
    if new.doc_status is distinct from old.doc_status and new.doc_status not in ('sinusuri') then
      raise exception 'Ang admin lang ang pwedeng mag-apruba ng dokumento';
    end if;
    if new.doc_status is distinct from old.doc_status then new.doc_note := ''; end if;
    if new.role = 'technician' and new.online and not old.online then
      if need_ok and new.doc_status <> 'aprubado' then
        raise exception 'Hindi pa aprubado ang mga dokumento mo';
      elsif not need_ok and new.doc_status not in ('sinusuri', 'aprubado') then
        raise exception 'Mag-upload muna ng mga dokumento';
      end if;
    end if;
  end if;
  -- Offline agad kapag tinanggihan, o kapag hindi pa aprubado (kung kailangan ng pag-apruba).
  if new.role = 'technician' and (new.doc_status = 'tinanggihan' or (need_ok and new.doc_status <> 'aprubado')) then
    new.online := false;
  end if;
  new.id := old.id; new.email := old.email; new.created_at := old.created_at;
  return new;
end $$;

-- File storage (pribado: ang may-ari at admin lang ang makakakita)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tech-docs', 'tech-docs', false, 5242880, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'application/pdf'];

drop policy if exists "tech-docs insert own" on storage.objects;
create policy "tech-docs insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'tech-docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "tech-docs update own" on storage.objects;
create policy "tech-docs update own" on storage.objects for update to authenticated
  using (bucket_id = 'tech-docs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "tech-docs read own or admin" on storage.objects;
create policy "tech-docs read own or admin" on storage.objects for select to authenticated
  using (bucket_id = 'tech-docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- Itala ang napiling uri ng dokumento sa sign-up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, role, name, email, phone, addr, services, google, cert_type)
  values (
    new.id,
    case when m->>'role' = 'technician' then 'technician' else 'customer' end,
    coalesce(m->>'name', m->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(m->>'phone', ''),
    coalesce(m->>'addr', ''),
    coalesce(array(select jsonb_array_elements_text(m->'services')), '{}'),
    coalesce(new.raw_app_meta_data->>'provider', '') = 'google',
    case when m->>'cert_type' in ('nc2', 'dti_bir') then m->>'cert_type' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Hindi pwedeng mag-book sa technician na hindi pa aprubado ang dokumento.
drop policy if exists "bookings insert" on public.bookings;
create policy "bookings insert" on public.bookings for insert to authenticated
  with check (customer_id = auth.uid() and status = 'Bago'
    and exists (select 1 from public.profiles p where p.id = tech_id and p.role = 'technician'
      and (p.doc_status = 'aprubado'
        or not coalesce((select (value)::text::boolean from public.settings where key = 'require_doc_approval'), true))));

-- I-offline ang mga technician na wala pang aprubadong dokumento (kasama ang mga dati nang naka-register).
update public.profiles set online = false where role = 'technician' and online and doc_status <> 'aprubado';
