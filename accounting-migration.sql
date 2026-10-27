-- ============================================================
-- KOST WGA ACCOUNTING FOUNDATION
-- Safe migration untuk menambah akuntansi dasar tanpa menghapus data lama.
-- Jalankan pada database yang sudah aktif, bukan menggantikan schema.sql.
-- ============================================================

create extension if not exists pgcrypto;

-- 1. Chart of Accounts
create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_group text not null check (account_group in ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')),
  normal_balance text not null check (normal_balance in ('debit', 'credit')),
  parent_code text,
  active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chart_of_accounts_parent_fk
    foreign key (parent_code) references public.chart_of_accounts(code)
    on update cascade on delete restrict
);

-- 2. Accounting Period
create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  period_month text not null unique,
  period_label text not null,
  status text not null default 'open' check (status in ('open', 'locked', 'closed')),
  opened_by uuid references auth.users(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Journal Entry
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  journal_no text not null unique,
  entry_date date not null default current_date,
  source_table text not null,
  source_id uuid,
  description text not null,
  status text not null default 'posted' check (status in ('draft', 'posted', 'reversed', 'adjustment')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint journal_entries_source_unique unique (source_table, source_id)
);

-- 4. Journal Entry Lines
create table if not exists public.journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_code text not null references public.chart_of_accounts(code) on update cascade,
  debit numeric(18,2) not null default 0 check (debit >= 0),
  credit numeric(18,2) not null default 0 check (credit >= 0),
  description text,
  created_at timestamptz not null default now(),
  constraint journal_entry_lines_balanced check (debit + credit >= 0)
);

create index if not exists idx_coa_group on public.chart_of_accounts(account_group);
create index if not exists idx_coa_active on public.chart_of_accounts(active);
create index if not exists idx_journal_entries_date on public.journal_entries(entry_date);
create index if not exists idx_journal_entries_source on public.journal_entries(source_table, source_id);
create index if not exists idx_journal_lines_account on public.journal_entry_lines(account_code);

-- 5. Default account mapping
insert into public.chart_of_accounts (code, name, account_group, normal_balance, active, description)
values
  ('1101', 'Kas & Bank', 'Asset', 'debit', true, 'Kas operasional dan rekening bank'),
  ('1201', 'Piutang Usaha', 'Asset', 'debit', true, 'Piutang dari penyewa'),
  ('2101', 'Utang Deposit Penyewa', 'Liability', 'credit', true, 'Deposit jaminan yang belum dikembalikan'),
  ('2201', 'Pendapatan Diterima di Muka', 'Liability', 'credit', true, 'Penerimaan yang belum diakui pendapatan'),
  ('3101', 'Modal Pemilik', 'Equity', 'credit', true, 'Modal awal dan tambahan modal'),
  ('4101', 'Pendapatan Sewa', 'Revenue', 'credit', true, 'Pendapatan sewa kamar'),
  ('5101', 'Beban Operasional', 'Expense', 'debit', true, 'Beban operasional umum')
on conflict (code) do update set
  name = excluded.name,
  account_group = excluded.account_group,
  normal_balance = excluded.normal_balance,
  active = excluded.active,
  description = excluded.description;

-- 6. Helper function: create journal for payment
drop function if exists public.create_payment_journal(uuid, uuid);
create or replace function public.create_payment_journal(p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_journal_id uuid;
  v_existing_status text;
  v_journal_no text;
  v_account_cash text := '1101';
  v_account_revenue text := '4101';
  v_amount numeric(18,2);
begin
  if p_payment_id is null then
    raise exception 'Payment ID wajib diisi';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id;

  if not found then
    raise exception 'Pembayaran tidak ditemukan';
  end if;

  if v_payment.status = 'Dibatalkan' then
    return null;
  end if;

  -- Pastikan akun default tersedia
  insert into public.chart_of_accounts (code, name, account_group, normal_balance, active, description)
  values
    ('1101', 'Kas & Bank', 'Asset', 'debit', true, 'Kas operasional dan rekening bank'),
    ('4101', 'Pendapatan Sewa', 'Revenue', 'credit', true, 'Pendapatan sewa kamar')
  on conflict (code) do nothing;

  select id, status into v_journal_id, v_existing_status
  from public.journal_entries
  where source_table = 'payments' and source_id = p_payment_id;

  if v_journal_id is not null then
    if v_existing_status = 'reversed' and v_payment.status <> 'Dibatalkan' then
      update public.journal_entry_lines
      set account_code = v_account_revenue
      where journal_entry_id = v_journal_id and account_code = '1201' and credit > 0;
      update public.journal_entries
      set status = 'posted', entry_date = v_payment.payment_date
      where id = v_journal_id;
    end if;
    return v_journal_id;
  end if;

  v_amount := coalesce(v_payment.amount, 0);
  v_journal_no := 'JRN-' || to_char(current_date, 'YYYYMMDD') || '-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.journal_entries (
    journal_no,
    entry_date,
    source_table,
    source_id,
    description,
    status,
    created_by
  ) values (
    v_journal_no,
    coalesce(v_payment.payment_date, current_date),
    'payments',
    v_payment.id,
    'Pendapatan sewa diterima dari ' || coalesce(v_payment.tenant_name, 'penyewa'),
    'posted',
    auth.uid()
  ) returning id into v_journal_id;

  insert into public.journal_entry_lines (journal_entry_id, account_code, debit, credit, description)
  values
    (v_journal_id, v_account_cash, v_amount, 0, 'Kas/Bank diterima dari pembayaran'),
    (v_journal_id, v_account_revenue, 0, v_amount, 'Pendapatan sewa diterima');

  return v_journal_id;
end;
$$;

create or replace function public.reverse_payment_journal(p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original_id uuid;
  v_reversal_id uuid;
  v_payment record;
begin
  select * into v_payment from public.payments where id = p_payment_id;
  if not found then
    raise exception 'Pembayaran tidak ditemukan';
  end if;

  select id into v_reversal_id
  from public.journal_entries
  where source_table = 'payment_reversals' and source_id = p_payment_id;
  if v_reversal_id is not null then
    return v_reversal_id;
  end if;

  select id into v_original_id
  from public.journal_entries
  where source_table = 'payments' and source_id = p_payment_id and status = 'posted';
  if v_original_id is null then
    return null;
  end if;

  insert into public.journal_entries (journal_no, entry_date, source_table, source_id, description, status, created_by)
  values (
    'JRN-VOID-' || replace(p_payment_id::text, '-', ''),
    current_date,
    'payment_reversals',
    p_payment_id,
    'Pembatalan pembayaran ' || coalesce(v_payment.payment_id, p_payment_id::text),
    'posted',
    auth.uid()
  )
  returning id into v_reversal_id;

  insert into public.journal_entry_lines (journal_entry_id, account_code, debit, credit, description)
  select
    v_reversal_id,
    account_code,
    credit,
    debit,
    'Pembalik: ' || coalesce(description, 'Pembayaran dibatalkan')
  from public.journal_entry_lines
  where journal_entry_id = v_original_id;

  return v_reversal_id;
end;
$$;

-- 7. Trigger auto-create journal on payment insert
create or replace function public.handle_payment_journal()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'Dibatalkan' then
      perform public.create_payment_journal(new.id);
    end if;
    return new;
  end if;

  if old.status = 'Dibatalkan' and new.status <> 'Dibatalkan' then
    raise exception 'Pembayaran yang sudah dibatalkan tidak dapat diaktifkan kembali';
  elsif old.status <> 'Dibatalkan' and new.status = 'Dibatalkan' then
    perform public.reverse_payment_journal(new.id);
  elsif new.status <> 'Dibatalkan' then
    perform public.create_payment_journal(new.id);
  end if;
  return new;
end;
$$;

create or replace function public.prevent_accounted_payment_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.journal_entries
    where source_id = old.id and source_table in ('payments', 'payment_reversals')
  ) then
    raise exception 'Pembayaran yang sudah dijurnal tidak dapat dihapus. Batalkan pembayaran agar jurnal pembalik tercatat.';
  end if;
  return old;
end;
$$;

drop trigger if exists payment_insert_journal on public.payments;
drop trigger if exists payment_status_journal on public.payments;
create trigger payment_insert_journal
after insert on public.payments
for each row execute procedure public.handle_payment_journal();
create trigger payment_status_journal
after update of status on public.payments
for each row execute procedure public.handle_payment_journal();

drop trigger if exists payment_prevent_accounted_delete on public.payments;
create trigger payment_prevent_accounted_delete
before delete on public.payments
for each row execute procedure public.prevent_accounted_payment_delete();

-- Bring existing journals created by the earlier foundation in line with cash-basis posting.
update public.journal_entry_lines line
set account_code = '4101'
from public.journal_entries je
join public.payments payment on payment.id = je.source_id
where line.journal_entry_id = je.id
  and line.account_code = '1201'
  and line.credit > 0
  and je.source_table = 'payments'
  and payment.status <> 'Dibatalkan';

update public.journal_entries je
set status = 'reversed'
from public.payments payment
where je.source_table = 'payments'
  and je.source_id = payment.id
  and je.status = 'posted'
  and payment.status = 'Dibatalkan';

do $$
declare
  v_payment_id uuid;
begin
  for v_payment_id in select id from public.payments where status <> 'Dibatalkan' loop
    perform public.create_payment_journal(v_payment_id);
  end loop;
end;
$$;

revoke all on function public.create_payment_journal(uuid) from public, anon;
revoke all on function public.reverse_payment_journal(uuid) from public, anon;
grant execute on function public.create_payment_journal(uuid) to authenticated;
grant execute on function public.reverse_payment_journal(uuid) to authenticated;

-- 8. Updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists chart_of_accounts_set_updated_at on public.chart_of_accounts;
create trigger chart_of_accounts_set_updated_at
before update on public.chart_of_accounts
for each row execute procedure public.set_updated_at();

drop trigger if exists accounting_periods_set_updated_at on public.accounting_periods;
create trigger accounting_periods_set_updated_at
before update on public.accounting_periods
for each row execute procedure public.set_updated_at();

drop trigger if exists journal_entries_set_updated_at on public.journal_entries;
create trigger journal_entries_set_updated_at
before update on public.journal_entries
for each row execute procedure public.set_updated_at();

-- 9. RLS dasar akuntansi
alter table public.chart_of_accounts enable row level security;
alter table public.accounting_periods enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_entry_lines enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chart_of_accounts' and policyname = 'authenticated users read chart_of_accounts') then
    execute 'create policy "authenticated users read chart_of_accounts" on public.chart_of_accounts for select to authenticated using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chart_of_accounts' and policyname = 'authenticated users insert chart_of_accounts') then
    execute 'create policy "authenticated users insert chart_of_accounts" on public.chart_of_accounts for insert to authenticated with check (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chart_of_accounts' and policyname = 'authenticated users update chart_of_accounts') then
    execute 'create policy "authenticated users update chart_of_accounts" on public.chart_of_accounts for update to authenticated using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'accounting_periods' and policyname = 'authenticated users read accounting_periods') then
    execute 'create policy "authenticated users read accounting_periods" on public.accounting_periods for select to authenticated using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'accounting_periods' and policyname = 'authenticated users insert accounting_periods') then
    execute 'create policy "authenticated users insert accounting_periods" on public.accounting_periods for insert to authenticated with check (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'accounting_periods' and policyname = 'authenticated users update accounting_periods') then
    execute 'create policy "authenticated users update accounting_periods" on public.accounting_periods for update to authenticated using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'journal_entries' and policyname = 'authenticated users read journal_entries') then
    execute 'create policy "authenticated users read journal_entries" on public.journal_entries for select to authenticated using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'journal_entries' and policyname = 'authenticated users insert journal_entries') then
    execute 'create policy "authenticated users insert journal_entries" on public.journal_entries for insert to authenticated with check (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'journal_entries' and policyname = 'authenticated users update journal_entries') then
    execute 'create policy "authenticated users update journal_entries" on public.journal_entries for update to authenticated using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'journal_entry_lines' and policyname = 'authenticated users read journal_entry_lines') then
    execute 'create policy "authenticated users read journal_entry_lines" on public.journal_entry_lines for select to authenticated using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'journal_entry_lines' and policyname = 'authenticated users insert journal_entry_lines') then
    execute 'create policy "authenticated users insert journal_entry_lines" on public.journal_entry_lines for insert to authenticated with check (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'journal_entry_lines' and policyname = 'authenticated users update journal_entry_lines') then
    execute 'create policy "authenticated users update journal_entry_lines" on public.journal_entry_lines for update to authenticated using (true) with check (true)';
  end if;
end;
$$;

-- ============================================================
-- Catatan implementasi:
-- - Trigger pada payments akan otomatis membuat jurnal untuk pembayaran.
-- - Jurnal dibuat satu kali per transaksi pembayaran untuk mencegah duplikasi.
-- - Akun default dibuat otomatis bila belum ada di chart_of_accounts.
-- ============================================================
