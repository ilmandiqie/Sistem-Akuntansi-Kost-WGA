-- ============================================================
-- KOST WGA V2
-- Sistem Akuntansi Piutang, Penerimaan Kas,
-- Pengeluaran & Pemeliharaan Kost
-- Supabase / PostgreSQL
-- ============================================================

create extension if not exists pgcrypto;

-- Hapus tabel lama bila ini adalah instalasi baru.
-- Untuk database yang sudah berisi data, jangan jalankan DROP.
drop table if exists public.maintenance_records cascade;
drop table if exists public.payments cascade;
drop table if exists public.tenants cascade;
drop table if exists public.users_profile cascade;

-- ============================================================
-- 1. USERS PROFILE
-- Relasi: users_profile.id -> auth.users.id
-- ============================================================
create table public.users_profile (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'pengelola'
    check (role in ('admin', 'pengelola', 'pemilik')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. TENANTS
-- tenant_id adalah kode bisnis, mis. WGA-001.
-- ============================================================
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null unique,
  name text not null,
  phone text,
  email text,
  address text,
  occupation text,
  move_in_date date,
  emergency_name text,
  emergency_relation text,
  emergency_phone text,
  id_card_path text,
  room_number text not null,
  monthly_rent numeric(15,2) not null check (monthly_rent >= 0),
  due_date integer not null check (due_date between 1 and 31),
  status text not null default 'Aktif'
    check (status in ('Aktif', 'Keluar')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 3. PAYMENTS
-- tenant_id mengacu ke tenants.tenant_id (kode bisnis).
-- ============================================================
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_id text not null unique,
  tenant_id text not null references public.tenants(tenant_id) on update cascade on delete restrict,
  tenant_name text not null,
  room_number text not null,
  amount numeric(15,2) not null check (amount > 0),
  payment_date date not null default current_date,
  payment_method text not null
    check (payment_method in ('Cash', 'Transfer')),
  status text not null default 'Lunas'
    check (status in ('Lunas', 'Belum Lunas', 'Dibatalkan')),
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 4. MAINTENANCE / OPERATING EXPENSE
-- room_number nullable karena pengeluaran bisa untuk area/fasilitas umum.
-- ============================================================
create table public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  room_number text,
  title text not null,
  description text,
  expense_date date not null default current_date,
  cost numeric(15,2) not null check (cost >= 0),
  vendor_name text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'completed')),
  created_at timestamptz not null default now()
);

create index idx_tenants_status on public.tenants(status);
create index idx_payments_tenant_id on public.payments(tenant_id);
create index idx_payments_payment_date on public.payments(payment_date);
create index idx_maintenance_expense_date on public.maintenance_records(expense_date);
create index idx_maintenance_status on public.maintenance_records(status);

-- ============================================================
-- 5. AUTO PROFILE AFTER AUTH SIGNUP
-- signUp() mengirim options.data.full_name dan options.data.role.
-- Trigger membuat users_profile secara otomatis.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  requested_role text;
begin
  requested_role := coalesce(new.raw_user_meta_data->>'role', 'pengelola');

  if requested_role not in ('admin', 'pengelola', 'pemilik') then
    requested_role := 'pengelola';
  end if;

  insert into public.users_profile (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), 'User Kost WGA'),
    requested_role
  )
  on conflict (id) do update
  set full_name = excluded.full_name,
      role = excluded.role;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ============================================================
-- 6. UPDATED_AT TRIGGER
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tenants_set_updated_at
before update on public.tenants
for each row execute procedure public.set_updated_at();

-- ============================================================
-- 7. RLS
-- Semua tabel hanya bisa diakses authenticated users.
-- ============================================================
alter table public.users_profile enable row level security;
alter table public.tenants enable row level security;
alter table public.payments enable row level security;
alter table public.maintenance_records enable row level security;

-- Profile: user hanya dapat melihat/mengubah profilnya sendiri.
create policy "authenticated users read own profile"
on public.users_profile for select
to authenticated
using (auth.uid() = id);

create policy "authenticated users insert own profile"
on public.users_profile for insert
to authenticated
with check (auth.uid() = id);

create policy "authenticated users update own profile"
on public.users_profile for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Data operasional: semua authenticated user dapat CRUD.
create policy "authenticated users read tenants"
on public.tenants for select
to authenticated using (true);

create policy "authenticated users insert tenants"
on public.tenants for insert
to authenticated with check (true);

create policy "authenticated users update tenants"
on public.tenants for update
to authenticated using (true) with check (true);

create policy "authenticated users delete tenants"
on public.tenants for delete
to authenticated using (true);

create policy "authenticated users read payments"
on public.payments for select
to authenticated using (true);

create policy "authenticated users insert payments"
on public.payments for insert
to authenticated with check (true);

create policy "authenticated users update payments"
on public.payments for update
to authenticated using (true) with check (true);

create policy "authenticated users delete payments"
on public.payments for delete
to authenticated using (true);

create policy "authenticated users read maintenance"
on public.maintenance_records for select
to authenticated using (true);

create policy "authenticated users insert maintenance"
on public.maintenance_records for insert
to authenticated with check (true);

create policy "authenticated users update maintenance"
on public.maintenance_records for update
to authenticated using (true) with check (true);

create policy "authenticated users delete maintenance"
on public.maintenance_records for delete
to authenticated using (true);

-- KTP disimpan di private storage, bukan sebagai URL publik.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-documents', 'tenant-documents', false, 5242880, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "authenticated users read tenant documents"
on storage.objects for select to authenticated
using (bucket_id = 'tenant-documents');

create policy "authenticated users upload tenant documents"
on storage.objects for insert to authenticated
with check (bucket_id = 'tenant-documents');

create policy "authenticated users update tenant documents"
on storage.objects for update to authenticated
using (bucket_id = 'tenant-documents') with check (bucket_id = 'tenant-documents');

create policy "authenticated users delete tenant documents"
on storage.objects for delete to authenticated
using (bucket_id = 'tenant-documents');

-- ============================================================
-- ERD RINGKAS
--
-- auth.users
--      │ 1:1
--      └──────── users_profile
--
-- tenants
--      │ 1:N
--      └──────── payments
--                 payments.tenant_id -> tenants.tenant_id
--
-- maintenance_records berdiri sendiri karena dapat berlaku
-- untuk kamar tertentu maupun area/fasilitas umum.
-- ============================================================
