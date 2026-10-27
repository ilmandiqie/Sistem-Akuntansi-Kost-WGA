-- ============================================================
-- KOST WGA TENANT CONTRACT DATES
-- Apply after property-room-migration.sql and before billing migration.
-- Additive: preserves tenants and backfills a current contract reference.
-- ============================================================

alter table public.tenants
  add column if not exists contract_number text,
  add column if not exists contract_start_date date,
  add column if not exists contract_end_date date;

update public.tenants
set contract_number = coalesce(contract_number, 'CON-' || tenant_id),
    contract_start_date = coalesce(contract_start_date, move_in_date, created_at::date, current_date);

alter table public.tenants alter column contract_number set not null;
alter table public.tenants alter column contract_start_date set not null;

create unique index if not exists idx_tenants_contract_number
  on public.tenants(contract_number);
create index if not exists idx_tenants_contract_dates
  on public.tenants(contract_start_date, contract_end_date);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_contract_dates_valid') then
    alter table public.tenants add constraint tenants_contract_dates_valid
      check (contract_end_date is null or contract_end_date >= contract_start_date);
  end if;
end;
$$;
