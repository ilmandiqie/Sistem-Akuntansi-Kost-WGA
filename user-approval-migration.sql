-- ============================================================
-- KOST WGA ADMIN USER APPROVAL
-- Apply once after security-role-migration.sql.
-- Keeps new registrations pending; admins approve them in the app.
-- ============================================================

insert into public.users_profile (id, full_name, role, approved)
select
  auth_user.id,
  coalesce(nullif(auth_user.raw_user_meta_data->>'full_name', ''), split_part(auth_user.email, '@', 1)),
  'pengelola',
  false
from auth.users auth_user
left join public.users_profile profile on profile.id = auth_user.id
where profile.id is null
on conflict (id) do nothing;

create or replace function public.admin_list_kost_users()
returns table (
  user_id uuid,
  email text,
  full_name text,
  role text,
  approved boolean,
  registered_at timestamptz
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
         profile.approved, auth_user.created_at
  from auth.users auth_user
  join public.users_profile profile on profile.id = auth_user.id
  order by profile.approved asc, auth_user.created_at desc;
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
  set approved = true
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
      'Akses aplikasi disetujui untuk ' || coalesce(v_full_name, p_user_id::text),
      auth.uid()
    );
  end if;
end;
$$;

revoke all on function public.admin_list_kost_users() from public, anon;
revoke all on function public.admin_approve_kost_user(uuid) from public, anon;
grant execute on function public.admin_list_kost_users() to authenticated;
grant execute on function public.admin_approve_kost_user(uuid) to authenticated;