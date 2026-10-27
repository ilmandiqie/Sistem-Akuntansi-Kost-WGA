-- ============================================================
-- KOST WGA ACCOUNTING PERIOD CONTROL
-- Apply after payment-verification-migration.sql.
-- ============================================================

create or replace function public.guard_journal_accounting_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_month text;
  v_period_status text;
begin
  v_period_month := to_char(new.entry_date, 'YYYY-MM');
  insert into public.accounting_periods (period_month, period_label, status, opened_by)
  values (v_period_month, v_period_month, 'open', auth.uid())
  on conflict (period_month) do nothing;

  select status into v_period_status
  from public.accounting_periods
  where period_month = v_period_month
  for update;

  if v_period_status <> 'open' then
    raise exception 'Periode % tidak terbuka untuk posting atau perubahan jurnal', v_period_month;
  end if;
  return new;
end;
$$;

drop trigger if exists journal_entries_guard_period on public.journal_entries;
drop trigger if exists journal_entries_guard_period_insert on public.journal_entries;
drop trigger if exists journal_entries_guard_period_update on public.journal_entries;
create trigger journal_entries_guard_period_insert
before insert on public.journal_entries
for each row execute procedure public.guard_journal_accounting_period();
create trigger journal_entries_guard_period_update
before update of entry_date, status on public.journal_entries
for each row execute procedure public.guard_journal_accounting_period();

create or replace function public.close_accounting_period(p_period_month text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date;
  v_end date;
  v_status text;
  v_unbalanced integer;
  v_draft integer;
  v_pending integer;
begin
  if not public.has_kost_role(array['admin']) then
    raise exception 'Hanya admin yang dapat menutup periode';
  end if;
  if p_period_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Periode harus berformat YYYY-MM';
  end if;

  v_start := to_date(p_period_month || '-01', 'YYYY-MM-DD');
  v_end := (v_start + interval '1 month - 1 day')::date;
  insert into public.accounting_periods (period_month, period_label, status, opened_by)
  values (p_period_month, p_period_month, 'open', auth.uid())
  on conflict (period_month) do nothing;

  select status into v_status from public.accounting_periods
  where period_month = p_period_month for update;
  if v_status <> 'open' then
    raise exception 'Periode % tidak berstatus open', p_period_month;
  end if;

  select count(*) into v_unbalanced
  from (
    select entry.id
    from public.journal_entries entry
    join public.journal_entry_lines line on line.journal_entry_id = entry.id
    where entry.entry_date between v_start and v_end and entry.status = 'posted'
    group by entry.id
    having abs(sum(line.debit) - sum(line.credit)) > 0.01
  ) unbalanced_entries;
  if v_unbalanced > 0 then
    raise exception 'Periode memiliki % jurnal tidak seimbang', v_unbalanced;
  end if;

  select count(*) into v_draft
  from public.journal_entries
  where entry_date between v_start and v_end and status in ('draft', 'adjustment');
  if v_draft > 0 then
    raise exception 'Periode memiliki % jurnal draft/adjustment yang belum diposting', v_draft;
  end if;

  select count(*) into v_pending
  from public.payments
  where payment_date between v_start and v_end
    and status <> 'Dibatalkan'
    and verification_status = 'pending';
  if v_pending > 0 then
    raise exception 'Periode memiliki % transfer yang menunggu verifikasi', v_pending;
  end if;

  update public.accounting_periods
  set status = 'closed', closed_at = now(), opened_by = auth.uid()
  where period_month = p_period_month;

  insert into public.accounting_audit_log (source_table, source_id, event_type, event_message, created_by)
  select 'accounting_periods', id, 'closed', 'Periode ' || p_period_month || ' ditutup', auth.uid()
  from public.accounting_periods where period_month = p_period_month;
end;
$$;

revoke all on function public.close_accounting_period(text) from public, anon;
grant execute on function public.close_accounting_period(text) to authenticated;
