-- Jalankan satu kali pada database yang sudah berisi data.
-- Jangan jalankan schema.sql pada database aktif karena file tersebut melakukan DROP tabel.

alter table public.tenants
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists occupation text,
  add column if not exists move_in_date date,
  add column if not exists emergency_name text,
  add column if not exists emergency_relation text,
  add column if not exists emergency_phone text,
  add column if not exists id_card_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-documents', 'tenant-documents', false, 5242880, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authenticated users read tenant documents" on storage.objects;
create policy "authenticated users read tenant documents"
on storage.objects for select to authenticated
using (bucket_id = 'tenant-documents');

drop policy if exists "authenticated users upload tenant documents" on storage.objects;
create policy "authenticated users upload tenant documents"
on storage.objects for insert to authenticated
with check (bucket_id = 'tenant-documents');

drop policy if exists "authenticated users update tenant documents" on storage.objects;
create policy "authenticated users update tenant documents"
on storage.objects for update to authenticated
using (bucket_id = 'tenant-documents') with check (bucket_id = 'tenant-documents');

drop policy if exists "authenticated users delete tenant documents" on storage.objects;
create policy "authenticated users delete tenant documents"
on storage.objects for delete to authenticated
using (bucket_id = 'tenant-documents');