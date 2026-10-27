-- ============================================================
-- KOST WGA ROLE AND ACCESS CONTROL
-- Apply after schema.sql, accounting-migration.sql, and
-- accounting-advanced-migration.sql. Existing data is preserved.
-- ============================================================

alter table public.users_profile
  add column if not exists approved boolean not null default true;

create or replace function public.has_kost_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users_profile
    where id = auth.uid()
      and approved = true
      and role = any(p_roles)
  );
$$;

revoke all on function public.has_kost_role(text[]) from public, anon;
grant execute on function public.has_kost_role(text[]) to authenticated;

create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' and (new.role <> 'pengelola' or new.approved) then
    raise exception 'Akun baru harus menunggu persetujuan admin';
  end if;

  if tg_op = 'UPDATE'
    and (new.role is distinct from old.role or new.approved is distinct from old.approved)
    and not public.has_kost_role(array['admin']) then
    raise exception 'Hanya admin yang dapat mengubah role atau persetujuan akun';
  end if;

  return new;
end;
$$;

drop trigger if exists users_profile_protect_role on public.users_profile;
drop trigger if exists users_profile_protect_role_update on public.users_profile;
create trigger users_profile_protect_role
before insert on public.users_profile
for each row execute procedure public.protect_profile_role();
create trigger users_profile_protect_role_update
before update of role, approved on public.users_profile
for each row execute procedure public.protect_profile_role();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users_profile (id, full_name, role, approved)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), 'User Kost WGA'),
    'pengelola',
    false
  )
  on conflict (id) do update
  set full_name = excluded.full_name;

  return new;
end;
$$;

-- Operational data: all registered roles may read; staff can change data.
drop policy if exists "kost users read own profile" on public.users_profile;
drop policy if exists "kost users update own profile" on public.users_profile;
drop policy if exists "kost members read tenants" on public.tenants;
drop policy if exists "kost staff insert tenants" on public.tenants;
drop policy if exists "kost staff update tenants" on public.tenants;
drop policy if exists "kost staff delete tenants" on public.tenants;
drop policy if exists "kost members read payments" on public.payments;
drop policy if exists "kost staff insert payments" on public.payments;
drop policy if exists "kost staff update payments" on public.payments;
drop policy if exists "kost staff delete payments" on public.payments;
drop policy if exists "kost members read maintenance" on public.maintenance_records;
drop policy if exists "kost staff insert maintenance" on public.maintenance_records;
drop policy if exists "kost staff update maintenance" on public.maintenance_records;
drop policy if exists "kost staff delete maintenance" on public.maintenance_records;
drop policy if exists "kost members read chart_of_accounts" on public.chart_of_accounts;
drop policy if exists "kost admins insert chart_of_accounts" on public.chart_of_accounts;
drop policy if exists "kost admins update chart_of_accounts" on public.chart_of_accounts;
drop policy if exists "kost members read accounting_periods" on public.accounting_periods;
drop policy if exists "kost admins manage accounting_periods" on public.accounting_periods;
drop policy if exists "kost members read journal_entries" on public.journal_entries;
drop policy if exists "kost members read journal_entry_lines" on public.journal_entry_lines;
drop policy if exists "kost members read deposits" on public.tenant_deposits;
drop policy if exists "kost staff insert deposits" on public.tenant_deposits;
drop policy if exists "kost members read refunds" on public.tenant_refunds;
drop policy if exists "kost staff insert refunds" on public.tenant_refunds;
drop policy if exists "kost staff update refunds" on public.tenant_refunds;
drop policy if exists "kost members read audit log" on public.accounting_audit_log;

drop policy if exists "authenticated users read own profile" on public.users_profile;
drop policy if exists "authenticated users insert own profile" on public.users_profile;
drop policy if exists "authenticated users update own profile" on public.users_profile;
create policy "kost users read own profile" on public.users_profile
for select to authenticated using (auth.uid() = id);
create policy "kost users update own profile" on public.users_profile
for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "authenticated users read tenants" on public.tenants;
drop policy if exists "authenticated users insert tenants" on public.tenants;
drop policy if exists "authenticated users update tenants" on public.tenants;
drop policy if exists "authenticated users delete tenants" on public.tenants;
create policy "kost members read tenants" on public.tenants
for select to authenticated using (public.has_kost_role(array['admin','pengelola','pemilik']));
create policy "kost staff insert tenants" on public.tenants
for insert to authenticated with check (public.has_kost_role(array['admin','pengelola']));
create policy "kost staff update tenants" on public.tenants
for update to authenticated using (public.has_kost_role(array['admin','pengelola']))
with check (public.has_kost_role(array['admin','pengelola']));
create policy "kost staff delete tenants" on public.tenants
for delete to authenticated using (public.has_kost_role(array['admin','pengelola']));

drop policy if exists "authenticated users read payments" on public.payments;
drop policy if exists "authenticated users insert payments" on public.payments;
drop policy if exists "authenticated users update payments" on public.payments;
drop policy if exists "authenticated users delete payments" on public.payments;
create policy "kost members read payments" on public.payments
for select to authenticated using (public.has_kost_role(array['admin','pengelola','pemilik']));
create policy "kost staff insert payments" on public.payments
for insert to authenticated with check (public.has_kost_role(array['admin','pengelola']));
create policy "kost staff update payments" on public.payments
for update to authenticated using (public.has_kost_role(array['admin','pengelola']))
with check (public.has_kost_role(array['admin','pengelola']));
create policy "kost staff delete payments" on public.payments
for delete to authenticated using (public.has_kost_role(array['admin','pengelola']));

drop policy if exists "authenticated users read maintenance" on public.maintenance_records;
drop policy if exists "authenticated users insert maintenance" on public.maintenance_records;
drop policy if exists "authenticated users update maintenance" on public.maintenance_records;
drop policy if exists "authenticated users delete maintenance" on public.maintenance_records;
create policy "kost members read maintenance" on public.maintenance_records
for select to authenticated using (public.has_kost_role(array['admin','pengelola','pemilik']));
create policy "kost staff insert maintenance" on public.maintenance_records
for insert to authenticated with check (public.has_kost_role(array['admin','pengelola']));
create policy "kost staff update maintenance" on public.maintenance_records
for update to authenticated using (public.has_kost_role(array['admin','pengelola']))
with check (public.has_kost_role(array['admin','pengelola']));
create policy "kost staff delete maintenance" on public.maintenance_records
for delete to authenticated using (public.has_kost_role(array['admin','pengelola']));

-- Accounting records are readable by all application roles. Posted journals
-- are immutable from the browser; journal functions run with database-owner rights.
drop policy if exists "authenticated users read chart_of_accounts" on public.chart_of_accounts;
drop policy if exists "authenticated users insert chart_of_accounts" on public.chart_of_accounts;
drop policy if exists "authenticated users update chart_of_accounts" on public.chart_of_accounts;
create policy "kost members read chart_of_accounts" on public.chart_of_accounts
for select to authenticated using (public.has_kost_role(array['admin','pengelola','pemilik']));
create policy "kost admins insert chart_of_accounts" on public.chart_of_accounts
for insert to authenticated with check (public.has_kost_role(array['admin']));
create policy "kost admins update chart_of_accounts" on public.chart_of_accounts
for update to authenticated using (public.has_kost_role(array['admin']))
with check (public.has_kost_role(array['admin']));

drop policy if exists "authenticated users read accounting_periods" on public.accounting_periods;
drop policy if exists "authenticated users insert accounting_periods" on public.accounting_periods;
drop policy if exists "authenticated users update accounting_periods" on public.accounting_periods;
create policy "kost members read accounting_periods" on public.accounting_periods
for select to authenticated using (public.has_kost_role(array['admin','pengelola','pemilik']));
create policy "kost admins manage accounting_periods" on public.accounting_periods
for all to authenticated using (public.has_kost_role(array['admin']))
with check (public.has_kost_role(array['admin']));

drop policy if exists "authenticated users read journal_entries" on public.journal_entries;
drop policy if exists "authenticated users insert journal_entries" on public.journal_entries;
drop policy if exists "authenticated users update journal_entries" on public.journal_entries;
create policy "kost members read journal_entries" on public.journal_entries
for select to authenticated using (public.has_kost_role(array['admin','pengelola','pemilik']));

drop policy if exists "authenticated users read journal_entry_lines" on public.journal_entry_lines;
drop policy if exists "authenticated users insert journal_entry_lines" on public.journal_entry_lines;
drop policy if exists "authenticated users update journal_entry_lines" on public.journal_entry_lines;
create policy "kost members read journal_entry_lines" on public.journal_entry_lines
for select to authenticated using (public.has_kost_role(array['admin','pengelola','pemilik']));

drop policy if exists "authenticated users read deposits" on public.tenant_deposits;
drop policy if exists "authenticated users insert deposits" on public.tenant_deposits;
create policy "kost members read deposits" on public.tenant_deposits
for select to authenticated using (public.has_kost_role(array['admin','pengelola','pemilik']));
create policy "kost staff insert deposits" on public.tenant_deposits
for insert to authenticated with check (public.has_kost_role(array['admin','pengelola']));

drop policy if exists "authenticated users read refunds" on public.tenant_refunds;
drop policy if exists "authenticated users insert refunds" on public.tenant_refunds;
drop policy if exists "authenticated users update refunds" on public.tenant_refunds;
create policy "kost members read refunds" on public.tenant_refunds
for select to authenticated using (public.has_kost_role(array['admin','pengelola','pemilik']));
create policy "kost staff insert refunds" on public.tenant_refunds
for insert to authenticated with check (public.has_kost_role(array['admin','pengelola']));
create policy "kost staff update refunds" on public.tenant_refunds
for update to authenticated using (public.has_kost_role(array['admin','pengelola']))
with check (public.has_kost_role(array['admin','pengelola']));

drop policy if exists "authenticated users read audit log" on public.accounting_audit_log;
create policy "kost members read audit log" on public.accounting_audit_log
for select to authenticated using (public.has_kost_role(array['admin','pengelola','pemilik']));

grant select, update on public.users_profile to authenticated;
grant select, insert, update, delete on public.tenants, public.payments, public.maintenance_records to authenticated;
grant select on public.chart_of_accounts, public.journal_entries, public.journal_entry_lines to authenticated;
grant select, insert, update, delete on public.accounting_periods to authenticated;
grant select, insert on public.tenant_deposits to authenticated;
grant select, insert, update on public.tenant_refunds to authenticated;
grant select on public.accounting_audit_log to authenticated;

-- To provision an administrator, use the Supabase SQL Editor as the project
-- owner: update public.users_profile set role = 'admin', approved = true
-- where id = '<auth user uuid>';