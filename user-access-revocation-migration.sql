-- ============================================================
-- KOST WGA ADMIN USER ACCESS REVOCATION
-- Apply once after user-approval-migration.sql.
-- Revokes app access without deleting Auth accounts or passwords.
-- ============================================================

alter table public.users_profile
  add column if not exists access_revoked_at timestamptz,
  add column if not exists access_revoked_by uuid references auth.users(id) on delete set null;

drop function if exists public.admin_list_kost_users();
create function public.admin_list_kost_users()
returns table (
  user_id uuid,
  email text,
  full_name text,
  role text,
  approved boolean,
  registered_at timestamptz,
  access_revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_kost_role(array['admin']) then
    raise exception 'Hanya admin yang dapat melihat daftar pengguna';
  end if;

  return query
  select auth_user.id, auth_user.email::text, profile.full_name, profile.role,
         profile.approved, auth_user.created_at, profile.access_revoked_at
  from auth.users auth_user
  join public.users_profile profile on profile.id = auth_user.id
  order by case
    when not profile.approved and profile.access_revoked_at is null then 0
    when profile.approved then 1
    else 2
  end, auth_user.created_at desc;
end;
$$;

create or replace function public.admin_approve_kost_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_full_name text;
begin
  if not public.has_kost_role(array['admin']) then
    raise exception 'Hanya admin yang dapat menyetujui pengguna';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'ID pengguna untuk persetujuan tidak valid';
  end if;

  update public.users_profile
  set approved = true, access_revoked_at = null, access_revoked_by = null
  where id = p_user_id and approved = false
  returning full_name into v_full_name;

  if not found then
    raise exception 'Pengguna tidak ditemukan atau sudah disetujui';
  end if;

  if to_regclass('public.accounting_audit_log') is not null then
    insert into public.accounting_audit_log (
      source_table, source_id, event_type, event_message, created_by
    ) values (
      'users_profile', p_user_id, 'approved',
      'Akses aplikasi disetujui/dipulihkan untuk ' || coalesce(v_full_name, p_user_id::text),
      auth.uid()
    );
  end if;
end;
$$;

create or replace function public.admin_revoke_kost_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_approved boolean;
  v_full_name text;
begin
  if not public.has_kost_role(array['admin']) then
    raise exception 'Hanya admin yang dapat mencabut akses pengguna';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'Admin tidak dapat mencabut akses akunnya sendiri';
  end if;

  perform pg_advisory_xact_lock(hashtext('kost_wga_admin_access_revocation'));

  perform 1
  from public.users_profile
  where role = 'admin' and approved = true
  for update;

  select role, approved, full_name into v_role, v_approved, v_full_name
  from public.users_profile
  where id = p_user_id
  for update;

  if not found then raise exception 'Pengguna tidak ditemukan'; end if;
  if not v_approved then raise exception 'Akses pengguna ini sudah tidak aktif'; end if;
  if v_role = 'admin' and not exists (
    select 1 from public.users_profile
    where role = 'admin' and approved = true and id <> p_user_id
  ) then
    raise exception 'Akses admin terakhir tidak dapat dicabut';
  end if;

  update public.users_profile
  set approved = false, access_revoked_at = now(), access_revoked_by = auth.uid()
  where id = p_user_id
  returning full_name into v_full_name;

  if to_regclass('public.accounting_audit_log') is not null then
    insert into public.accounting_audit_log (
      source_table, source_id, event_type, event_message, created_by
    ) values (
      'users_profile', p_user_id, 'access_revoked',
      'Akses aplikasi dicabut untuk ' || coalesce(v_full_name, p_user_id::text),
      auth.uid()
    );
  end if;
end;
$$;

revoke all on function public.admin_list_kost_users() from public, anon;
revoke all on function public.admin_approve_kost_user(uuid) from public, anon;
revoke all on function public.admin_revoke_kost_user(uuid) from public, anon;
grant execute on function public.admin_list_kost_users() to authenticated;
grant execute on function public.admin_approve_kost_user(uuid) to authenticated;
grant execute on function public.admin_revoke_kost_user(uuid) to authenticated;