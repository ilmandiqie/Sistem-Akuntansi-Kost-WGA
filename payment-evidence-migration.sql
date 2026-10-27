-- ============================================================
-- KOST WGA PRIVATE PAYMENT EVIDENCE
-- Apply after payment-verification-migration.sql.
-- ============================================================

alter table public.payments
  add column if not exists transaction_reference text,
  add column if not exists evidence_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-evidence',
  'payment-evidence',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "payment evidence staff read" on storage.objects;
create policy "payment evidence staff read" on storage.objects
for select to authenticated
using (
  bucket_id = 'payment-evidence'
  and public.has_kost_role(array['admin','pengelola'])
);

drop policy if exists "payment evidence owner upload" on storage.objects;
create policy "payment evidence owner upload" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'payment-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "payment evidence owner delete" on storage.objects;
create policy "payment evidence owner delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'payment-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.record_invoice_payment_with_evidence(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_payment_method text,
  p_notes text default null,
  p_transaction_reference text default null,
  p_evidence_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_payment_id uuid;
begin
  if p_payment_method = 'Transfer' then
    if nullif(trim(p_transaction_reference), '') is null then
      raise exception 'Nomor referensi transfer wajib diisi';
    end if;
    if nullif(trim(p_evidence_path), '') is null then
      raise exception 'Bukti transfer wajib dilampirkan';
    end if;
    if (storage.foldername(p_evidence_path))[1] <> auth.uid()::text then
      raise exception 'Bukti transfer tidak dimiliki sesi pengguna ini';
    end if;
    if not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'payment-evidence'
        and object.name = p_evidence_path
        and object.owner_id = auth.uid()::text
    ) then
      raise exception 'Berkas bukti transfer tidak ditemukan';
    end if;
  end if;

  v_payment_id := public.record_invoice_payment(
    p_invoice_id, p_amount, p_payment_date, p_payment_method, p_notes
  );

  update public.payments
  set transaction_reference = nullif(trim(p_transaction_reference), ''),
      evidence_path = p_evidence_path
  where id = v_payment_id;

  return v_payment_id;
end;
$$;

revoke all on function public.record_invoice_payment(uuid, numeric, date, text, text) from authenticated;
revoke all on function public.record_invoice_payment_with_evidence(uuid, numeric, date, text, text, text, text) from public, anon;
grant execute on function public.record_invoice_payment_with_evidence(uuid, numeric, date, text, text, text, text) to authenticated;

create or replace function public.attach_pending_payment_evidence(
  p_payment_id uuid,
  p_transaction_reference text,
  p_evidence_path text
)
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_payment public.payments%rowtype;
begin
  if not public.has_kost_role(array['admin','pengelola']) then
    raise exception 'Tidak memiliki izin memperbarui bukti transfer';
  end if;
  if nullif(trim(p_transaction_reference), '') is null or nullif(trim(p_evidence_path), '') is null then
    raise exception 'Referensi dan bukti transfer wajib diisi';
  end if;
  if (storage.foldername(p_evidence_path))[1] <> auth.uid()::text then
    raise exception 'Bukti transfer tidak dimiliki sesi pengguna ini';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'payment-evidence'
      and object.name = p_evidence_path
      and object.owner_id = auth.uid()::text
  ) then
    raise exception 'Berkas bukti transfer tidak ditemukan';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found or v_payment.status = 'Dibatalkan' or v_payment.verification_status <> 'pending' then
    raise exception 'Pembayaran tidak menunggu verifikasi';
  end if;

  update public.payments
  set transaction_reference = trim(p_transaction_reference), evidence_path = p_evidence_path
  where id = p_payment_id;

  insert into public.accounting_audit_log (source_table, source_id, event_type, event_message, created_by)
  values ('payments', p_payment_id, 'evidence_attached', 'Referensi dan bukti transfer ditambahkan', auth.uid());
end;
$$;

revoke all on function public.attach_pending_payment_evidence(uuid, text, text) from public, anon;
grant execute on function public.attach_pending_payment_evidence(uuid, text, text) to authenticated;

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
  if nullif(trim(v_payment.transaction_reference), '') is null or nullif(trim(v_payment.evidence_path), '') is null then
    raise exception 'Referensi dan bukti transfer wajib tersedia sebelum verifikasi';
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

  select invoice_id into v_invoice_id from public.payment_allocations where payment_id = p_payment_id limit 1;
  if v_invoice_id is null or (select count(*) from public.payment_allocations where payment_id = p_payment_id) <> 1 then
    raise exception 'Verifikasi pembayaran saat ini memerlukan tepat satu invoice';
  end if;

  select total_amount into v_invoice_total from public.invoices where id = v_invoice_id for update;
  select coalesce(sum(pa.amount), 0) into v_confirmed_before
  from public.payment_allocations pa
  join public.payments other_payment on other_payment.id = pa.payment_id
  where pa.invoice_id = v_invoice_id and pa.payment_id <> p_payment_id
    and other_payment.status <> 'Dibatalkan'
    and other_payment.verification_status = 'confirmed';
  v_payment_status := case when v_confirmed_before + v_allocated >= v_invoice_total then 'Lunas' else 'Belum Lunas' end;

  insert into public.chart_of_accounts (code, name, account_group, normal_balance, active)
  values ('1101', 'Kas & Bank', 'Asset', 'debit', true), ('1201', 'Piutang Usaha', 'Asset', 'debit', true)
  on conflict (code) do nothing;

  insert into public.journal_entries (journal_no, entry_date, source_table, source_id, description, status, created_by)
  values ('JRN-PAY-' || replace(v_payment.id::text, '-', ''), v_payment.payment_date,
    'payments', v_payment.id,
    'Transfer terverifikasi untuk pembayaran ' || v_payment.payment_id,
    'posted', auth.uid())
  returning id into v_journal_id;

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

revoke all on function public.verify_invoice_payment(uuid) from public, anon;
grant execute on function public.verify_invoice_payment(uuid) to authenticated;
