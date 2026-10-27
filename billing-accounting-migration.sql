-- ============================================================
-- KOST WGA BILLING AND ACCRUAL ACCOUNTING
-- Apply after accounting-migration.sql, accounting-advanced-migration.sql,
-- security-role-migration.sql, and tenant-contract-migration.sql.
-- Additive and safe to rerun.
-- ============================================================

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  tenant_id text not null references public.tenants(tenant_id) on update cascade on delete restrict,
  period_month text not null check (period_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  issue_date date not null default current_date,
  due_date date not null,
  subtotal numeric(18,2) not null check (subtotal >= 0),
  discount_amount numeric(18,2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(18,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(18,2) not null check (total_amount >= 0),
  status text not null default 'issued' check (status in ('issued', 'partially_paid', 'paid', 'overdue', 'cancelled')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, period_month),
  check (total_amount = subtotal - discount_amount + tax_amount)
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  description text not null,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_price numeric(18,2) not null check (unit_price >= 0),
  line_total numeric(18,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  check (line_total = quantity * unit_price)
);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, invoice_id)
);

create index if not exists idx_invoices_tenant_period on public.invoices(tenant_id, period_month);
create index if not exists idx_invoices_status_due on public.invoices(status, due_date);
create index if not exists idx_invoice_items_invoice on public.invoice_items(invoice_id);
create index if not exists idx_payment_allocations_invoice on public.payment_allocations(invoice_id);
create index if not exists idx_payment_allocations_payment on public.payment_allocations(payment_id);

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
before update on public.invoices
for each row execute procedure public.set_updated_at();

alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payment_allocations enable row level security;

drop policy if exists "kost members read invoices" on public.invoices;
create policy "kost members read invoices" on public.invoices
for select to authenticated using (public.has_kost_role(array['admin','pengelola','pemilik']));

drop policy if exists "kost members read invoice items" on public.invoice_items;
create policy "kost members read invoice items" on public.invoice_items
for select to authenticated using (
  exists (select 1 from public.invoices i where i.id = invoice_id
    and public.has_kost_role(array['admin','pengelola','pemilik']))
);

drop policy if exists "kost members read payment allocations" on public.payment_allocations;
create policy "kost members read payment allocations" on public.payment_allocations
for select to authenticated using (
  public.has_kost_role(array['admin','pengelola','pemilik'])
);

grant select on public.invoices, public.invoice_items, public.payment_allocations to authenticated;
revoke insert, update, delete on public.invoices, public.invoice_items, public.payment_allocations from authenticated;

create or replace function public.issue_monthly_rent_invoices(
  p_period_month text,
  p_issue_date date default current_date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant record;
  v_invoice_id uuid;
  v_journal_id uuid;
  v_invoice_no text;
  v_period_start date;
  v_period_end date;
  v_due_date date;
  v_amount numeric(18,2);
  v_created integer := 0;
  v_period_status text;
  v_payment record;
  v_allocated numeric(18,2);
  v_remaining numeric(18,2);
begin
  if not public.has_kost_role(array['admin','pengelola']) then
    raise exception 'Tidak memiliki izin menerbitkan invoice';
  end if;
  if p_period_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Periode harus berformat YYYY-MM';
  end if;
  if p_period_month > to_char(current_date, 'YYYY-MM') then
    raise exception 'Invoice tidak dapat diterbitkan untuk periode masa depan';
  end if;

  v_period_start := to_date(p_period_month || '-01', 'YYYY-MM-DD');
  v_period_end := (v_period_start + interval '1 month - 1 day')::date;
  insert into public.accounting_periods (period_month, period_label, status, opened_by)
  values (p_period_month, p_period_month, 'open', auth.uid())
  on conflict (period_month) do nothing;
  select status into v_period_status from public.accounting_periods where period_month = p_period_month;
  if v_period_status <> 'open' then
    raise exception 'Periode % tidak terbuka untuk posting', p_period_month;
  end if;

  insert into public.chart_of_accounts (code, name, account_group, normal_balance, active)
  values
    ('1201', 'Piutang Usaha', 'Asset', 'debit', true),
    ('4101', 'Pendapatan Sewa', 'Revenue', 'credit', true),
    ('2201', 'Pendapatan Diterima di Muka', 'Liability', 'credit', true)
  on conflict (code) do nothing;

  for v_tenant in
    select tenant_id, name, monthly_rent, due_date
    from public.tenants
    where status = 'Aktif' and monthly_rent > 0
        and contract_start_date <= v_period_end
        and (contract_end_date is null or contract_end_date >= v_period_start)
    order by tenant_id
  loop
    v_amount := v_tenant.monthly_rent;
    v_due_date := make_date(
      extract(year from v_period_start)::integer,
      extract(month from v_period_start)::integer,
      least(v_tenant.due_date, extract(day from v_period_end)::integer)
    );
    v_invoice_no := 'INV-' || replace(p_period_month, '-', '') || '-' ||
      left(regexp_replace(v_tenant.tenant_id, '[^A-Za-z0-9]', '', 'g'), 18) || '-' ||
      left(replace(gen_random_uuid()::text, '-', ''), 8);

    insert into public.invoices (
      invoice_no, tenant_id, period_month, issue_date, due_date,
      subtotal, discount_amount, tax_amount, total_amount, status, created_by
    ) values (
      v_invoice_no, v_tenant.tenant_id, p_period_month, p_issue_date, v_due_date,
      v_amount, 0, 0, v_amount, 'issued', auth.uid()
    )
    on conflict (tenant_id, period_month) do nothing
    returning id into v_invoice_id;

    if v_invoice_id is null then
      continue;
    end if;
    v_created := v_created + 1;

    insert into public.invoice_items (invoice_id, description, quantity, unit_price, line_total)
    values (v_invoice_id, 'Sewa kamar - ' || p_period_month, 1, v_amount, v_amount);

    insert into public.journal_entries (journal_no, entry_date, source_table, source_id, description, status, created_by)
    values (
      'JRN-INV-' || replace(v_invoice_id::text, '-', ''),
      v_period_start,
      'invoices',
      v_invoice_id,
      'Tagihan sewa ' || p_period_month || ' - ' || v_tenant.name,
      'posted',
      auth.uid()
    )
    on conflict (source_table, source_id) do nothing
    returning id into v_journal_id;

    if v_journal_id is not null then
      insert into public.journal_entry_lines (journal_entry_id, account_code, debit, credit, description)
      values
        (v_journal_id, '1201', v_amount, 0, 'Piutang sewa diterbitkan'),
        (v_journal_id, '4101', 0, v_amount, 'Pendapatan sewa diakui');
    end if;

    -- Allocate legacy receipts from the same rent month to avoid double-counting revenue.
    v_remaining := v_amount;
    for v_payment in
      select p.id, p.amount
      from public.payments p
      where p.tenant_id = v_tenant.tenant_id
        and p.payment_date between v_period_start and v_period_end
        and p.status <> 'Dibatalkan'
        and not exists (select 1 from public.payment_allocations pa where pa.payment_id = p.id)
      order by p.payment_date, p.created_at
      for update
    loop
      exit when v_remaining <= 0;
      v_allocated := least(v_payment.amount, v_remaining);
      insert into public.payment_allocations (payment_id, invoice_id, amount)
      values (v_payment.id, v_invoice_id, v_allocated);

      select id into v_journal_id
      from public.journal_entries
      where source_table = 'payments' and source_id = v_payment.id;

      if v_journal_id is not null then
        update public.journal_entry_lines
        set account_code = '1201', credit = v_allocated,
            description = 'Alokasi penerimaan ke piutang invoice'
        where journal_entry_id = v_journal_id and account_code = '4101' and credit > 0;

        if v_payment.amount > v_allocated then
          insert into public.journal_entry_lines (journal_entry_id, account_code, debit, credit, description)
          values (v_journal_id, '2201', 0, v_payment.amount - v_allocated, 'Kelebihan bayar menjadi uang muka');
        end if;
      end if;

      v_remaining := v_remaining - v_allocated;
    end loop;

    insert into public.accounting_audit_log (source_table, source_id, event_type, event_message, created_by)
    values ('invoices', v_invoice_id, 'issued', 'Invoice sewa ' || p_period_month || ' diterbitkan', auth.uid());

    update public.invoices i
    set status = case
      when coalesce((select sum(pa.amount) from public.payment_allocations pa
        join public.payments p on p.id = pa.payment_id
        where pa.invoice_id = i.id and p.status <> 'Dibatalkan'), 0) >= i.total_amount then 'paid'
      when exists (select 1 from public.payment_allocations pa
        join public.payments p on p.id = pa.payment_id
        where pa.invoice_id = i.id and p.status <> 'Dibatalkan') then 'partially_paid'
      when i.due_date < current_date then 'overdue'
      else 'issued'
    end
    where i.id = v_invoice_id;
  end loop;

  return v_created;
end;
$$;

create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_payment_method text,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_tenant public.tenants%rowtype;
  v_payment_id uuid;
  v_payment_code text;
  v_journal_id uuid;
  v_paid numeric(18,2);
  v_outstanding numeric(18,2);
  v_status text;
  v_payment_date date;
  v_period_month text;
  v_period_status text;
begin
  if not public.has_kost_role(array['admin','pengelola']) then
    raise exception 'Tidak memiliki izin mencatat pembayaran';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal pembayaran harus lebih dari nol';
  end if;
  if p_payment_date is not null and p_payment_date > current_date then
    raise exception 'Tanggal pembayaran tidak boleh di masa depan';
  end if;
  if p_payment_method not in ('Cash', 'Transfer') then
    raise exception 'Metode pembayaran tidak valid';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found or v_invoice.status = 'cancelled' then
    raise exception 'Invoice tidak ditemukan atau sudah dibatalkan';
  end if;
  select * into v_tenant from public.tenants where tenant_id = v_invoice.tenant_id;

  v_payment_date := coalesce(p_payment_date, current_date);
  v_period_month := to_char(v_payment_date, 'YYYY-MM');
  insert into public.accounting_periods (period_month, period_label, status, opened_by)
  values (v_period_month, v_period_month, 'open', auth.uid())
  on conflict (period_month) do nothing;
  select status into v_period_status from public.accounting_periods where period_month = v_period_month;
  if v_period_status <> 'open' then
    raise exception 'Periode pembayaran % tidak terbuka untuk posting', v_period_month;
  end if;

  select coalesce(sum(pa.amount), 0) into v_paid
  from public.payment_allocations pa
  join public.payments p on p.id = pa.payment_id
  where pa.invoice_id = p_invoice_id and p.status <> 'Dibatalkan';
  v_outstanding := v_invoice.total_amount - v_paid;
  if p_amount > v_outstanding then
    raise exception 'Pembayaran melebihi sisa invoice: %', v_outstanding;
  end if;

  v_status := case when p_amount = v_outstanding then 'Lunas' else 'Belum Lunas' end;
  v_payment_code := 'PAY-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.payments (
    payment_id, tenant_id, tenant_name, room_number, amount,
    payment_date, payment_method, status, notes
  ) values (
    v_payment_code, v_invoice.tenant_id, v_tenant.name, v_tenant.room_number,
    p_amount, v_payment_date, p_payment_method, v_status, p_notes
  ) returning id into v_payment_id;

  insert into public.payment_allocations (payment_id, invoice_id, amount)
  values (v_payment_id, p_invoice_id, p_amount);

  insert into public.chart_of_accounts (code, name, account_group, normal_balance, active)
  values ('1101', 'Kas & Bank', 'Asset', 'debit', true), ('1201', 'Piutang Usaha', 'Asset', 'debit', true)
  on conflict (code) do nothing;

  insert into public.journal_entries (journal_no, entry_date, source_table, source_id, description, status, created_by)
  values (
    'JRN-PAY-' || replace(v_payment_id::text, '-', ''),
    v_payment_date,
    'payments',
    v_payment_id,
    'Pembayaran invoice ' || v_invoice.invoice_no || ' dari ' || v_tenant.name,
    'posted',
    auth.uid()
  ) returning id into v_journal_id;

  insert into public.journal_entry_lines (journal_entry_id, account_code, debit, credit, description)
  values
    (v_journal_id, '1101', p_amount, 0, 'Kas diterima'),
    (v_journal_id, '1201', 0, p_amount, 'Pelunasan piutang invoice');

  update public.invoices
  set status = case when v_paid + p_amount = total_amount then 'paid' else 'partially_paid' end
  where id = p_invoice_id;

  insert into public.accounting_audit_log (source_table, source_id, event_type, event_message, created_by)
  values ('payments', v_payment_id, 'allocated', 'Pembayaran dialokasikan ke invoice ' || v_invoice.invoice_no, auth.uid());

  return v_payment_id;
end;
$$;

create or replace function public.refresh_invoice_payment_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_invoice public.invoices%rowtype;
  v_paid numeric(18,2);
begin
  if old.status = new.status then
    return new;
  end if;

  for v_invoice_id in
    select invoice_id from public.payment_allocations where payment_id = new.id
  loop
    select * into v_invoice from public.invoices where id = v_invoice_id for update;
    select coalesce(sum(pa.amount), 0) into v_paid
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
    where pa.invoice_id = v_invoice_id and p.status <> 'Dibatalkan';

    update public.invoices
    set status = case
      when v_paid >= v_invoice.total_amount then 'paid'
      when v_paid > 0 then 'partially_paid'
      when v_invoice.due_date < current_date then 'overdue'
      else 'issued'
    end
    where id = v_invoice_id;
  end loop;
  return new;
end;
$$;

drop trigger if exists payment_insert_journal on public.payments;
drop trigger if exists payment_invoice_allocation_check on public.payments;

drop trigger if exists payment_refresh_invoice_status on public.payments;
create trigger payment_refresh_invoice_status
after update of status on public.payments
for each row execute procedure public.refresh_invoice_payment_status();

-- Remove direct browser inserts. Record payments only through the atomic RPC.
drop policy if exists "kost staff insert payments" on public.payments;
drop policy if exists "authenticated users insert payments" on public.payments;
revoke insert on public.payments from authenticated;

grant execute on function public.issue_monthly_rent_invoices(text, date) to authenticated;
grant execute on function public.record_invoice_payment(uuid, numeric, date, text, text) to authenticated;
revoke all on function public.issue_monthly_rent_invoices(text, date) from public, anon;
revoke all on function public.record_invoice_payment(uuid, numeric, date, text, text) from public, anon;

-- Existing receipt journals retain their source history. New receipts are atomic
-- through record_invoice_payment and must reference an issued invoice.
