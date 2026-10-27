-- ============================================================
-- KOST WGA PAYMENT VERIFICATION
-- Apply after billing-accounting-migration.sql.
-- Existing payments remain confirmed for backward compatibility.
-- ============================================================

alter table public.payments
  add column if not exists verification_status text not null default 'confirmed',
  add column if not exists verified_by uuid references auth.users(id),
  add column if not exists verified_at timestamptz,
  add column if not exists rejection_reason text;

alter table public.payments
  drop constraint if exists payments_verification_status_check;
alter table public.payments
  add constraint payments_verification_status_check
  check (verification_status in ('pending', 'confirmed', 'rejected'));
alter table public.payments alter column verification_status set default 'pending';

create index if not exists idx_payments_verification on public.payments(verification_status, payment_date);

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
  if old.status = new.status and old.verification_status = new.verification_status then
    return new;
  end if;

  for v_invoice_id in
    select invoice_id from public.payment_allocations where payment_id = new.id
  loop
    select * into v_invoice from public.invoices where id = v_invoice_id for update;
    select coalesce(sum(pa.amount), 0) into v_paid
    from public.payment_allocations pa
    join public.payments p on p.id = pa.payment_id
    where pa.invoice_id = v_invoice_id
      and p.status <> 'Dibatalkan'
      and p.verification_status = 'confirmed';

    update public.invoices
    set status = case
      when v_paid >= v_invoice.total_amount then 'paid'
      when v_paid > 0 then 'partially_paid'
      when v_invoice.due_date < current_date then 'overdue'
      else 'issued'
    end
    where id = v_invoice_id and status <> 'cancelled';
  end loop;
  return new;
end;
$$;

drop trigger if exists payment_refresh_invoice_status on public.payments;
create trigger payment_refresh_invoice_status
after update of status, verification_status on public.payments
for each row execute procedure public.refresh_invoice_payment_status();

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
  v_confirmed numeric(18,2);
  v_reserved numeric(18,2);
  v_status text;
  v_verification_status text;
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

  select coalesce(sum(pa.amount), 0) into v_confirmed
  from public.payment_allocations pa
  join public.payments p on p.id = pa.payment_id
  where pa.invoice_id = p_invoice_id
    and p.status <> 'Dibatalkan'
    and p.verification_status = 'confirmed';

  select coalesce(sum(pa.amount), 0) into v_reserved
  from public.payment_allocations pa
  join public.payments p on p.id = pa.payment_id
  where pa.invoice_id = p_invoice_id and p.status <> 'Dibatalkan';

  if p_amount > v_invoice.total_amount - v_reserved then
    raise exception 'Nominal melebihi saldo yang belum dibayar atau menunggu verifikasi';
  end if;

  v_verification_status := case when p_payment_method = 'Cash' then 'confirmed' else 'pending' end;
  v_status := case when v_verification_status = 'confirmed' and v_confirmed + p_amount = v_invoice.total_amount then 'Lunas' else 'Belum Lunas' end;
  v_payment_code := 'PAY-' || replace(gen_random_uuid()::text, '-', '');
  insert into public.payments (
    payment_id, tenant_id, tenant_name, room_number, amount,
    payment_date, payment_method, status, notes, verification_status,
    verified_by, verified_at
  ) values (
    v_payment_code, v_invoice.tenant_id, v_tenant.name, v_tenant.room_number,
    p_amount, v_payment_date, p_payment_method, v_status, p_notes, v_verification_status,
    case when v_verification_status = 'confirmed' then auth.uid() else null end,
    case when v_verification_status = 'confirmed' then now() else null end
  ) returning id into v_payment_id;

  insert into public.payment_allocations (payment_id, invoice_id, amount)
  values (v_payment_id, p_invoice_id, p_amount);

  if v_verification_status = 'confirmed' then
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
  end if;

  if v_verification_status = 'confirmed' then
    update public.invoices
    set status = case when v_confirmed + p_amount = total_amount then 'paid' else 'partially_paid' end
    where id = p_invoice_id;
  end if;

  insert into public.accounting_audit_log (source_table, source_id, event_type, event_message, created_by)
  values (
    'payments', v_payment_id,
    case when v_verification_status = 'confirmed' then 'confirmed' else 'pending_verification' end,
    'Pembayaran invoice ' || v_invoice.invoice_no || case when v_verification_status = 'confirmed' then ' terkonfirmasi' else ' menunggu verifikasi transfer' end,
    auth.uid()
  );

  return v_payment_id;
end;
$$;

create or replace function public.verify_invoice_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_allocated numeric(18,2);
  v_invoice_id uuid;
  v_invoice_total numeric(18,2);
  v_confirmed_before numeric(18,2);
  v_payment_status text;
  v_journal_id uuid;
  v_period_month text;
  v_period_status text;
begin
  if not public.has_kost_role(array['admin','pengelola']) then
    raise exception 'Tidak memiliki izin memverifikasi pembayaran';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status = 'Dibatalkan' or v_payment.verification_status <> 'pending' then
    raise exception 'Pembayaran tidak ditemukan atau tidak menunggu verifikasi';
  end if;

  v_period_month := to_char(v_payment.payment_date, 'YYYY-MM');
  select status into v_period_status from public.accounting_periods where period_month = v_period_month for update;
  if v_period_status is distinct from 'open' then
    raise exception 'Periode pembayaran % tidak terbuka untuk verifikasi', v_period_month;
  end if;

  select coalesce(sum(amount), 0) into v_allocated
  from public.payment_allocations where payment_id = p_payment_id;
  if v_allocated <> v_payment.amount then
    raise exception 'Total alokasi tidak sama dengan nilai pembayaran';
  end if;

  select invoice_id into v_invoice_id
  from public.payment_allocations
  where payment_id = p_payment_id
  limit 1;
  if v_invoice_id is null or (select count(*) from public.payment_allocations where payment_id = p_payment_id) <> 1 then
    raise exception 'Verifikasi pembayaran saat ini memerlukan tepat satu invoice';
  end if;

  select total_amount into v_invoice_total
  from public.invoices where id = v_invoice_id for update;
  select coalesce(sum(pa.amount), 0) into v_confirmed_before
  from public.payment_allocations pa
  join public.payments other_payment on other_payment.id = pa.payment_id
  where pa.invoice_id = v_invoice_id
    and pa.payment_id <> p_payment_id
    and other_payment.status <> 'Dibatalkan'
    and other_payment.verification_status = 'confirmed';
  v_payment_status := case when v_confirmed_before + v_allocated >= v_invoice_total then 'Lunas' else 'Belum Lunas' end;

  insert into public.chart_of_accounts (code, name, account_group, normal_balance, active)
  values ('1101', 'Kas & Bank', 'Asset', 'debit', true), ('1201', 'Piutang Usaha', 'Asset', 'debit', true)
  on conflict (code) do nothing;

  insert into public.journal_entries (journal_no, entry_date, source_table, source_id, description, status, created_by)
  values (
    'JRN-PAY-' || replace(v_payment.id::text, '-', ''),
    v_payment.payment_date,
    'payments',
    v_payment.id,
    'Transfer terverifikasi untuk pembayaran ' || v_payment.payment_id,
    'posted',
    auth.uid()
  ) returning id into v_journal_id;

  insert into public.journal_entry_lines (journal_entry_id, account_code, debit, credit, description)
  values
    (v_journal_id, '1101', v_allocated, 0, 'Transfer terkonfirmasi sebagai kas/bank'),
    (v_journal_id, '1201', 0, v_allocated, 'Pelunasan piutang invoice');

  update public.payments
  set verification_status = 'confirmed', verified_by = auth.uid(), verified_at = now(), status = v_payment_status
  where id = p_payment_id;

  insert into public.accounting_audit_log (source_table, source_id, event_type, event_message, created_by)
  values ('payments', p_payment_id, 'verified', 'Pembayaran transfer terverifikasi oleh petugas', auth.uid());
end;
$$;

create or replace function public.reject_invoice_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
begin
  if not public.has_kost_role(array['admin','pengelola']) then
    raise exception 'Tidak memiliki izin menolak pembayaran';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Alasan penolakan wajib diisi';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status = 'Dibatalkan' or v_payment.verification_status <> 'pending' then
    raise exception 'Pembayaran tidak ditemukan atau tidak menunggu verifikasi';
  end if;

  update public.payments
  set status = 'Dibatalkan', verification_status = 'rejected', rejection_reason = trim(p_reason)
  where id = p_payment_id;

  insert into public.accounting_audit_log (source_table, source_id, event_type, event_message, created_by)
  values ('payments', p_payment_id, 'rejected', 'Transfer ditolak: ' || trim(p_reason), auth.uid());
end;
$$;

-- The older accounting trigger posted every inserted payment. Disable that
-- behavior so a pending transfer cannot create cash or revenue prematurely.
create or replace function public.handle_payment_journal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status <> 'Dibatalkan' and new.status = 'Dibatalkan' then
      perform public.reverse_payment_journal(new.id);
    elsif old.status = 'Dibatalkan' and new.status <> 'Dibatalkan' then
      raise exception 'Pembayaran yang sudah dibatalkan tidak dapat diaktifkan kembali';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payment_insert_journal on public.payments;
drop trigger if exists payment_status_journal on public.payments;
create trigger payment_status_journal
after update of status on public.payments
for each row execute procedure public.handle_payment_journal();

revoke all on function public.record_invoice_payment(uuid, numeric, date, text, text) from public, anon;
revoke all on function public.verify_invoice_payment(uuid) from public, anon;
revoke all on function public.reject_invoice_payment(uuid, text) from public, anon;
grant execute on function public.record_invoice_payment(uuid, numeric, date, text, text) to authenticated;
grant execute on function public.verify_invoice_payment(uuid) to authenticated;
grant execute on function public.reject_invoice_payment(uuid, text) to authenticated;

-- Status is the only payment field staff may update directly (for cancellation).
revoke update on public.payments from authenticated;
grant update (status) on public.payments to authenticated;
