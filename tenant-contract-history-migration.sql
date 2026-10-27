-- ============================================================
-- KOST WGA TENANT CONTRACT HISTORY
-- Apply after tenant-contract-migration.sql. Contract snapshots are
-- written by a database trigger; clients receive read-only access.
-- ============================================================

create table if not exists public.tenant_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(tenant_id) on update cascade on delete restrict,
  contract_number text not null,
  start_date date not null,
  end_date date,
  monthly_rent numeric(18,2) not null check (monthly_rent >= 0),
  due_day integer not null check (due_day between 1 and 31),
  status text not null check (status in ('active', 'ended', 'superseded')),
  ended_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

drop index if exists public.idx_tenant_contracts_number;
create index idx_tenant_contracts_number
  on public.tenant_contracts(contract_number);
create unique index if not exists idx_tenant_contracts_one_active
  on public.tenant_contracts(tenant_id) where status = 'active';
create index if not exists idx_tenant_contracts_tenant_start
  on public.tenant_contracts(tenant_id, start_date desc);

create or replace function public.capture_tenant_contract_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract_changed boolean;
  v_existing_contract public.tenant_contracts%rowtype;
begin
  if tg_op = 'INSERT' then
    insert into public.tenant_contracts (
      tenant_id, contract_number, start_date, end_date, monthly_rent, due_day, status, created_by
    ) values (
      new.tenant_id,
      new.contract_number,
      new.contract_start_date,
      new.contract_end_date,
      new.monthly_rent,
      new.due_date,
      case when new.status = 'Aktif' then 'active' else 'ended' end,
      auth.uid()
    );
    return new;
  end if;

  v_contract_changed := old.contract_number is distinct from new.contract_number
    or old.contract_start_date is distinct from new.contract_start_date
    or old.contract_end_date is distinct from new.contract_end_date
    or old.monthly_rent is distinct from new.monthly_rent
    or old.due_date is distinct from new.due_date;

  if v_contract_changed then
    update public.tenant_contracts
    set status = 'superseded', ended_at = now()
    where tenant_id = old.tenant_id and status = 'active';

    insert into public.tenant_contracts (
      tenant_id, contract_number, start_date, end_date, monthly_rent, due_day, status, created_by
    ) values (
      new.tenant_id,
      new.contract_number,
      new.contract_start_date,
      new.contract_end_date,
      new.monthly_rent,
      new.due_date,
      case when new.status = 'Aktif' then 'active' else 'ended' end,
      auth.uid()
    );
  elsif old.status = 'Aktif' and new.status <> 'Aktif' then
    update public.tenant_contracts
    set status = 'ended', ended_at = now()
    where tenant_id = old.tenant_id and status = 'active';
  elsif old.status <> 'Aktif' and new.status = 'Aktif' then
    select * into v_existing_contract
    from public.tenant_contracts
    where tenant_id = new.tenant_id
      and contract_number = new.contract_number
      and start_date = new.contract_start_date
      and monthly_rent = new.monthly_rent
      and due_day = new.due_date
      and status = 'ended'
    order by created_at desc
    limit 1
    for update;

    if found then
      update public.tenant_contracts
      set status = 'active', ended_at = null
      where id = v_existing_contract.id;
    else
      insert into public.tenant_contracts (
        tenant_id, contract_number, start_date, end_date, monthly_rent, due_day, status, created_by
      ) values (
        new.tenant_id, new.contract_number, new.contract_start_date,
        new.contract_end_date, new.monthly_rent, new.due_date, 'active', auth.uid()
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.capture_tenant_contract_history() from public, anon, authenticated;

drop trigger if exists tenants_capture_contract_history on public.tenants;
drop trigger if exists tenants_capture_contract_insert on public.tenants;
drop trigger if exists tenants_capture_contract_update on public.tenants;
create trigger tenants_capture_contract_insert
after insert on public.tenants
for each row execute procedure public.capture_tenant_contract_history();
create trigger tenants_capture_contract_update
after update of contract_number, contract_start_date, contract_end_date, monthly_rent, due_date, status
on public.tenants
for each row execute procedure public.capture_tenant_contract_history();

insert into public.tenant_contracts (
  tenant_id, contract_number, start_date, end_date, monthly_rent, due_day, status
)
select
  tenant.tenant_id,
  tenant.contract_number,
  tenant.contract_start_date,
  tenant.contract_end_date,
  tenant.monthly_rent,
  tenant.due_date,
  case when tenant.status = 'Aktif' then 'active' else 'ended' end
from public.tenants tenant
where not exists (
  select 1 from public.tenant_contracts contract
  where contract.tenant_id = tenant.tenant_id
    and contract.contract_number = tenant.contract_number
);

alter table public.tenant_contracts enable row level security;
drop policy if exists "kost members read tenant contracts" on public.tenant_contracts;
create policy "kost members read tenant contracts" on public.tenant_contracts
for select to authenticated using (public.has_kost_role(array['admin','pengelola','pemilik']));
grant select on public.tenant_contracts to authenticated;
revoke insert, update, delete on public.tenant_contracts from authenticated;
