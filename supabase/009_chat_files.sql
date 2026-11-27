-- CoolFix: attachment (larawan o file) sa chat ng customer at technician.
-- Patakbuhin PAGKATAPOS ng 008_cust_loc.sql. Ligtas patakbuhin ulit.
-- Private ang bucket: ang customer at technician ng usapan lang (at ang admin) ang makakabukas ng file.

-- Detalye ng file sa mensahe: { path, name, type, size }. Dapat nasa folder ng sariling usapan ang path.
alter table public.messages add column if not exists file jsonb;
alter table public.messages drop constraint if exists messages_file_path;
alter table public.messages add constraint messages_file_path
  check (file is null or (file->>'path') like conv_id::text || '/%');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-files', 'chat-files', false, 10485760, array[
  'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
  'application/pdf','text/plain',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'video/mp4','video/quicktime'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Kasali ba ang user sa usapan na ito? (unang folder ng path = id ng usapan)
create or replace function public.in_conv(cid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversations c
                 where c.id::text = cid and auth.uid() in (c.customer_id, c.tech_id))
$$;
revoke all on function public.in_conv(text) from public, anon;
grant execute on function public.in_conv(text) to authenticated;

drop policy if exists "chat-files upload" on storage.objects;
create policy "chat-files upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-files' and public.in_conv((storage.foldername(name))[1]));
drop policy if exists "chat-files read" on storage.objects;
create policy "chat-files read" on storage.objects for select to authenticated
  using (bucket_id = 'chat-files' and (public.in_conv((storage.foldername(name))[1]) or public.is_admin()));
