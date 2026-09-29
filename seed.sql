-- ============================================================
-- KOST WGA — SEED DATA / DATA DUMMY
-- Jalankan SETELAH schema.sql.
-- ============================================================
-- CATATAN AUTH USER:
-- Supabase Auth membuat auth.users melalui proses Register/Login,
-- bukan melalui insert biasa ke tabel auth.users.
-- Karena itu, buat/register 2 akun berikut melalui aplikasi terlebih dahulu:
--   1) admin.wga@example.com    -> Admin Utama WGA
--   2) siti.pengelola@example.com -> Siti Pengelola
-- Password dapat ditentukan sendiri saat Register.
-- Trigger schema.sql akan otomatis membuat users_profile.
-- Bagian profile di bawah akan menyelaraskan nama/role berdasarkan email.

-- 1. USERS PROFILE
update public.users_profile p
set full_name = v.full_name, role = v.role
from (values
  ('admin.wga@example.com', 'Admin Utama WGA', 'admin'),
  ('siti.pengelola@example.com', 'Siti Pengelola', 'pengelola')
) as v(email, full_name, role)
join auth.users u on lower(u.email) = lower(v.email)
where p.id = u.id;

insert into public.users_profile (id, full_name, role)
select u.id, v.full_name, v.role
from (values
  ('admin.wga@example.com', 'Admin Utama WGA', 'admin'),
  ('siti.pengelola@example.com', 'Siti Pengelola', 'pengelola')
) as v(email, full_name, role)
join auth.users u on lower(u.email) = lower(v.email)
where not exists (select 1 from public.users_profile p where p.id = u.id);

-- 2. TENANTS / PENYEWA
insert into public.tenants
  (tenant_id, name, room_number, monthly_rent, due_date, status)
values
  ('WGA-001', 'Ahmad Fauzi',    '101', 1500000,  5, 'Aktif'),
  ('WGA-002', 'Siti Rahma',    '102', 1750000, 10, 'Aktif'),
  ('WGA-003', 'Rizki Pratama', '201', 1600000, 15, 'Aktif'),
  ('WGA-004', 'Dewi Lestari',  '202', 1850000,  1, 'Aktif'),
  ('WGA-005', 'Joko Susanto',  '203', 1500000, 20, 'Keluar')
on conflict (tenant_id) do update set
  name = excluded.name,
  room_number = excluded.room_number,
  monthly_rent = excluded.monthly_rent,
  due_date = excluded.due_date,
  status = excluded.status;

-- 3. PAYMENTS / PENERIMAAN KAS
-- Empat transaksi Lunas untuk periode Maret 2026.
insert into public.payments
  (payment_id, tenant_id, tenant_name, room_number, amount, payment_date, payment_method, status, notes)
values
  ('PAY-202603-001', 'WGA-001', 'Ahmad Fauzi',    '101', 1500000, '2026-03-05', 'Transfer', 'Lunas', 'Sewa kamar periode Maret 2026'),
  ('PAY-202603-002', 'WGA-002', 'Siti Rahma',    '102', 1750000, '2026-03-10', 'Cash',     'Lunas', 'Sewa kamar periode Maret 2026'),
  ('PAY-202603-003', 'WGA-003', 'Rizki Pratama', '201', 1600000, '2026-03-15', 'Transfer', 'Lunas', 'Sewa kamar periode Maret 2026'),
  ('PAY-202603-004', 'WGA-004', 'Dewi Lestari',  '202', 1850000, '2026-03-01', 'Transfer', 'Lunas', 'Sewa kamar periode Maret 2026')
on conflict (payment_id) do update set
  tenant_id = excluded.tenant_id,
  tenant_name = excluded.tenant_name,
  room_number = excluded.room_number,
  amount = excluded.amount,
  payment_date = excluded.payment_date,
  payment_method = excluded.payment_method,
  status = excluded.status,
  notes = excluded.notes;

-- 4. MAINTENANCE / PENGELUARAN
insert into public.maintenance_records
  (room_number, title, description, expense_date, cost, vendor_name, status)
select * from (values
  ('101', 'Perbaikan Pipa Air Bocor', 'Penggantian bagian pipa dan fitting yang bocor.', '2026-03-08'::date, 250000::numeric, 'Tukang Budi', 'completed'),
  ('203', 'Servis AC Kamar Kos', 'Pembersihan unit indoor dan pengecekan refrigerant.', '2026-03-12'::date, 350000::numeric, 'AC Jaya Teknik', 'completed'),
  ('Area Bersama', 'Perbaikan Pagar Gerbang Utama', 'Perbaikan engsel, pengelasan, dan pengecatan bagian pagar.', '2026-03-18'::date, 400000::numeric, 'Bengkel Las Makmur', 'in_progress'),
  ('102', 'Pengecatan Ulang Dinding Kamar', 'Pengecatan ulang dinding kamar dan perapian permukaan.', '2026-03-25'::date, 600000::numeric, 'Tukang Agus', 'scheduled')
) as x(room_number, title, description, expense_date, cost, vendor_name, status)
where not exists (
  select 1 from public.maintenance_records m
  where m.room_number is not distinct from x.room_number
    and m.title = x.title
    and m.expense_date = x.expense_date
);

-- ============================================================
-- RINGKASAN DATA DUMMY
-- Tenants       : 5
-- Payments      : 4
-- Maintenance   : 4
-- User profile  : maksimal 2, jika kedua akun Auth sudah dibuat
-- ============================================================
