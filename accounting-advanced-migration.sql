-- ============================================================
-- KOST WGA ADVANCED ACCOUNTING LAYER
-- Additive migration for deposits, refunds, journals, and audit history.
-- Safe to run repeatedly; does not delete existing application data.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.tenant_deposits (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(tenant_id) on update cascade on delete restrict,
  tenant_name text not null,
  amount numeric(18,2) not null,
  deposit_type text not null default 'security' check (deposit_type in ('security', 'advance', 'other')),
  status text not null default 'active' check (status in ('active', 'released', 'refunded')),
  paid_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_refunds (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references public.tenant_deposits(id) on delete restrict,
  tenant_id text not null references public.tenants(tenant_id) on update cascade on delete restrict,
  tenant_name text not null,
  amount numeric(18,2) not null,
  refund_date date not null default current_date,
  reason text,
  status text not null default 'requested' check (status in ('requested', 'approved', 'released', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounting_audit_log (
  id uuid primary key default gen_random_uuid(),
  source_table text not null,
  source_id uuid,
  event_type text not null,
  event_message text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.maintenance_records
  add column if not exists payment_status text not null default 'unpaid'
  check (payment_status in ('unpaid', 'paid'));
alter table public.maintenance_records
  add column if not exists payment_date date;

alter table public.tenant_refunds
  drop constraint if exists tenant_refunds_deposit_id_fkey;
alter table public.tenant_refunds
  alter column deposit_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_deposits_tenant_id_fkey') then
    alter table public.tenant_deposits add constraint tenant_deposits_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(tenant_id) on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_refunds_tenant_id_fkey') then
    alter table public.tenant_refunds add constraint tenant_refunds_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(tenant_id) on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_refunds_deposit_fk') then
    alter table public.tenant_refunds add constraint tenant_refunds_deposit_fk
      foreign key (deposit_id) references public.tenant_deposits(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_deposits_positive_amount') then
    alter table public.tenant_deposits add constraint tenant_deposits_positive_amount check (amount > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_refunds_positive_amount') then
    alter table public.tenant_refunds add constraint tenant_refunds_positive_amount check (amount > 0);
  end if;
end;
$$;

create index if not exists idx_deposits_tenant on public.tenant_deposits(tenant_id);
create index if not exists idx_refunds_tenant on public.tenant_refunds(tenant_id);
create index if not exists idx_refunds_deposit on public.tenant_refunds(deposit_id);
create index if not exists idx_audit_source on public.accounting_audit_log(source_table, source_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.audit_deposit_refund_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.accounting_audit_log (source_table, source_id, event_type, event_message, created_by)
  values (
    tg_table_name,
    new.id,
    tg_op,
    case
      when tg_table_name = 'tenant_refunds' then 'Refund status: ' || coalesce(new.status, 'unknown')
      else 'Deposit status: ' || coalesce(new.status, 'unknown')
    end,
    auth.uid()
  );
  return new;
end;
$$;

create or replace function public.journal_tenant_deposit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_journal_id uuid;
begin
  if new.status <> 'active' then
    raise exception 'Deposit baru harus berstatus active';
  end if;

  insert into public.chart_of_accounts (code, name, account_group, normal_balance, active)
  values
    ('1101', 'Kas & Bank', 'Asset', 'debit', true),
    ('2101', 'Utang Deposit Penyewa', 'Liability', 'credit', true)
  on conflict (code) do nothing;

  insert into public.journal_entries (journal_no, entry_date, source_table, source_id, description, status, created_by)
  values (
    'JRN-DEP-' || replace(new.id::text, '-', ''),
    new.paid_date,
    'tenant_deposits',
    new.id,
    'Penerimaan deposit dari ' || new.tenant_name,
    'posted',
    auth.uid()
  )
  on conflict (source_table, source_id) do nothing
  returning id into v_journal_id;

  if v_journal_id is not null then
    insert into public.journal_entry_lines (journal_entry_id, account_code, debit, credit, description)
    values
      (v_journal_id, '1101', new.amount, 0, 'Deposit diterima'),
      (v_journal_id, '2101', 0, new.amount, 'Kewajiban deposit penyewa');
  end if;

  return new;
end;
$$;

create or replace function public.validate_tenant_refund_insert()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'requested' then
    raise exception 'Refund baru harus berstatus requested';
  end if;
  return new;
end;
$$;

create or replace function public.journal_tenant_refund()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deposit public.tenant_deposits%rowtype;
  v_already_refunded numeric(18,2);
  v_journal_id uuid;
begin
  if old.status = 'requested' and new.status not in ('requested', 'approved', 'rejected') then
    raise exception 'Refund harus disetujui sebelum dicairkan';
  end if;
  if old.status = 'approved' and new.status not in ('approved', 'released', 'rejected') then
    raise exception 'Transisi status refund tidak valid';
  end if;
  if old.status = 'rejected' and new.status <> 'rejected' then
    raise exception 'Refund yang ditolak tidak dapat diaktifkan kembali';
  end if;
  if old.status = 'released' and new.status <> 'released' then
    raise exception 'Refund yang sudah dicairkan tidak dapat diubah statusnya';
  end if;

  if new.status = old.status then
    return new;
  end if;

  if new.status = 'released' and old.status <> 'released' then
    if old.status <> 'approved' then
      raise exception 'Refund harus disetujui sebelum dicairkan';
    end if;

    select * into v_deposit
    from public.tenant_deposits
    where id = new.deposit_id
    for update;

    if not found or v_deposit.status <> 'active' then
      raise exception 'Deposit tidak aktif atau tidak ditemukan';
    end if;

    select coalesce(sum(amount), 0) into v_already_refunded
    from public.tenant_refunds
    where deposit_id = new.deposit_id
      and status = 'released'
      and id <> new.id;

    if v_already_refunded + new.amount > v_deposit.amount then
      raise exception 'Nominal refund melebihi sisa deposit';
    end if;

    insert into public.chart_of_accounts (code, name, account_group, normal_balance, active)
    values
      ('1101', 'Kas & Bank', 'Asset', 'debit', true),
      ('2101', 'Utang Deposit Penyewa', 'Liability', 'credit', true)
    on conflict (code) do nothing;

    insert into public.journal_entries (journal_no, entry_date, source_table, source_id, description, status, created_by)
    values (
      'JRN-REF-' || replace(new.id::text, '-', ''),
      new.refund_date,
      'tenant_refunds',
      new.id,
      'Pengembalian deposit kepada ' || new.tenant_name,
      'posted',
      auth.uid()
    )
    on conflict (source_table, source_id) do nothing
    returning id into v_journal_id;

    if v_journal_id is not null then
      insert into public.journal_entry_lines (journal_entry_id, account_code, debit, credit, description)
      values
        (v_journal_id, '2101', new.amount, 0, 'Pengurangan kewajiban deposit'),
        (v_journal_id, '1101', 0, new.amount, 'Kas refund dicairkan');
    end if;

    if v_already_refunded + new.amount = v_deposit.amount then
      update public.tenant_deposits set status = 'refunded' where id = new.deposit_id;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.sync_completed_maintenance_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_journal_id uuid;
  v_payment_journal_id uuid;
begin
  if new.status <> 'completed' then
    return new;
  end if;

  insert into public.chart_of_accounts (code, name, account_group, normal_balance, active)
  values
    ('1101', 'Kas & Bank', 'Asset', 'debit', true),
    ('5101', 'Beban Operasional', 'Expense', 'debit', true),
    ('2102', 'Utang Operasional', 'Liability', 'credit', true)
  on conflict (code) do nothing;

  insert into public.journal_entries (journal_no, entry_date, source_table, source_id, description, status, created_by)
  values (
    'JRN-MTN-' || replace(new.id::text, '-', ''),
    new.expense_date,
    'maintenance_records',
    new.id,
    'Beban operasional: ' || new.title,
    'posted',
    auth.uid()
  )
  on conflict (source_table, source_id) do update
  set entry_date = excluded.entry_date,
      description = excluded.description,
      status = 'posted'
  returning id into v_journal_id;

  delete from public.journal_entry_lines where journal_entry_id = v_journal_id;
  insert into public.journal_entry_lines (journal_entry_id, account_code, debit, credit, description)
  values (v_journal_id, '5101', new.cost, 0, 'Beban maintenance selesai');
  insert into public.journal_entry_lines (journal_entry_id, account_code, debit, credit, description)
  values (v_journal_id, '2102', 0, new.cost, 'Utang kepada vendor');

  if new.payment_status = 'paid' then
    if new.payment_date is null then
      raise exception 'Tanggal pembayaran vendor wajib diisi';
    end if;

    insert into public.journal_entries (journal_no, entry_date, source_table, source_id, description, status, created_by)
    values (
      'JRN-MTNPAY-' || replace(new.id::text, '-', ''),
      new.payment_date,
      'maintenance_payments',
      new.id,
      'Pembayaran biaya maintenance: ' || new.title,
      'posted',
      auth.uid()
    )
    on conflict (source_table, source_id) do update
    set entry_date = excluded.entry_date,
        description = excluded.description,
        status = 'posted'
    returning id into v_payment_journal_id;

    delete from public.journal_entry_lines where journal_entry_id = v_payment_journal_id;
    insert into public.journal_entry_lines (journal_entry_id, account_code, debit, credit, description)
    values
      (v_payment_journal_id, '2102', new.cost, 0, 'Pelunasan utang vendor'),
      (v_payment_journal_id, '1101', 0, new.cost, 'Kas dibayarkan kepada vendor');
  end if;

  insert into public.accounting_audit_log (source_table, source_id, event_type, event_message, created_by)
  values ('maintenance_records', new.id, tg_op, 'Jurnal beban maintenance disinkronkan: ' || new.title, auth.uid());

  return new;
end;
$$;

create or replace function public.prevent_completed_maintenance_reopen()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'completed' and new.status <> 'completed' then
    raise exception 'Maintenance selesai yang sudah dijurnal tidak dapat dibuka kembali';
  end if;
  if old.payment_status = 'paid' and new.payment_status <> 'paid' then
    raise exception 'Pembayaran vendor yang sudah dijurnal tidak dapat dibatalkan dari form maintenance';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_journaled_maintenance_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.journal_entries
    where source_table in ('maintenance_records', 'maintenance_payments') and source_id = old.id
  ) then
    raise exception 'Maintenance yang sudah dijurnal tidak dapat dihapus';
  end if;
  return old;
end;
$$;

drop trigger if exists tenant_deposits_set_updated_at on public.tenant_deposits;
create trigger tenant_deposits_set_updated_at before update on public.tenant_deposits
for each row execute procedure public.set_updated_at();

drop trigger if exists tenant_refunds_set_updated_at on public.tenant_refunds;
create trigger tenant_refunds_set_updated_at before update on public.tenant_refunds
for each row execute procedure public.set_updated_at();

drop trigger if exists tenant_deposits_journal on public.tenant_deposits;
create trigger tenant_deposits_journal after insert on public.tenant_deposits
for each row execute procedure public.journal_tenant_deposit();

drop trigger if exists tenant_refunds_journal on public.tenant_refunds;
create trigger tenant_refunds_journal before update of status on public.tenant_refunds
for each row execute procedure public.journal_tenant_refund();

drop trigger if exists tenant_refunds_validate_insert on public.tenant_refunds;
create trigger tenant_refunds_validate_insert before insert on public.tenant_refunds
for each row execute procedure public.validate_tenant_refund_insert();

drop trigger if exists maintenance_prevent_reopen on public.maintenance_records;
create trigger maintenance_prevent_reopen before update of status, payment_status on public.maintenance_records
for each row execute procedure public.prevent_completed_maintenance_reopen();

drop trigger if exists maintenance_journaled_delete on public.maintenance_records;
create trigger maintenance_journaled_delete before delete on public.maintenance_records
for each row execute procedure public.prevent_journaled_maintenance_delete();

drop trigger if exists maintenance_completed_journal on public.maintenance_records;
create trigger maintenance_completed_journal after insert or update on public.maintenance_records
for each row execute procedure public.sync_completed_maintenance_journal();

-- Backfill completed maintenance records already present in the database.
update public.maintenance_records set cost = cost where status = 'completed';

drop trigger if exists tenant_deposits_audit on public.tenant_deposits;
create trigger tenant_deposits_audit after insert or update on public.tenant_deposits
for each row execute procedure public.audit_deposit_refund_change();

drop trigger if exists tenant_refunds_audit on public.tenant_refunds;
create trigger tenant_refunds_audit after insert or update on public.tenant_refunds
for each row execute procedure public.audit_deposit_refund_change();

alter table public.tenant_deposits enable row level security;
alter table public.tenant_refunds enable row level security;
alter table public.accounting_audit_log enable row level security;

-- Remove earlier permissive policies. The role migration installs the
-- approved-role policies and must be run after this migration.
drop policy if exists "authenticated users read deposits" on public.tenant_deposits;
drop policy if exists "authenticated users insert deposits" on public.tenant_deposits;
drop policy if exists "authenticated users update deposits" on public.tenant_deposits;
drop policy if exists "authenticated users read refunds" on public.tenant_refunds;
drop policy if exists "authenticated users insert refunds" on public.tenant_refunds;
drop policy if exists "authenticated users update refunds" on public.tenant_refunds;
drop policy if exists "authenticated users read audit log" on public.accounting_audit_log;

grant select, insert on public.tenant_deposits to authenticated;
grant select, insert, update on public.tenant_refunds to authenticated;
grant select on public.accounting_audit_log to authenticated;

-- Run security-role-migration.sql after this file to restore role-scoped access.