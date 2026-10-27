-- ============================================================
-- KOST WGA PROPERTY AND ROOM MASTER DATA
-- Apply after security-role-migration.sql. Existing room_number data
-- is retained and backfilled into a default property.
-- ============================================================

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  address text,
  owner_name text,
  contact_phone text,
  floor_count integer not null default 1 check (floor_count > 0),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  room_number text not null,
  floor_number integer,
  room_type text not null default 'Standard',
  monthly_rent numeric(18,2) not null default 0 check (monthly_rent >= 0),
  facilities text,
  condition text not null default 'good' check (condition in ('good', 'needs_repair', 'unusable')),
  status text not null default 'available' check (status in ('available', 'reserved', 'occupied', 'maintenance', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, room_number)
);

alter table public.tenants add column if not exists room_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_room_id_fkey') then
    alter table public.tenants add constraint tenants_room_id_fkey
      foreign key (room_id) references public.rooms(id) on delete restrict;
  end if;
end;
$$;

insert into public.properties (code, name, status)
values ('KOST-WGA', 'Kost WGA', 'active')
on conflict (code) do nothing;

insert into public.rooms (property_id, room_number, monthly_rent)
select property.id, tenant_rooms.room_number, tenant_rooms.monthly_rent
from (
  select room_number, max(monthly_rent) as monthly_rent
  from public.tenants
  where nullif(trim(room_number), '') is not null
  group by room_number
) tenant_rooms
cross join public.properties property
where property.code = 'KOST-WGA'
on conflict (property_id, room_number) do nothing;

update public.tenants tenant
set room_id = room.id
from public.rooms room
join public.properties property on property.id = room.property_id and property.code = 'KOST-WGA'
where tenant.room_id is null and room.room_number = tenant.room_number;

update public.rooms room
set status = 'occupied'
where room.status = 'available'
  and exists (select 1 from public.tenants tenant where tenant.room_id = room.id and tenant.status = 'Aktif');

create index if not exists idx_rooms_property_status on public.rooms(property_id, status);
create index if not exists idx_tenants_room_id on public.tenants(room_id);

create or replace function public.guard_tenant_room_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_status text;
begin
  if new.status <> 'Aktif' or new.room_id is null then
    return new;
  end if;

  select status into v_room_status from public.rooms where id = new.room_id for update;
  if not found then
    raise exception 'Kamar tidak ditemukan';
  end if;
  if v_room_status in ('maintenance', 'inactive', 'reserved') then
    raise exception 'Kamar tidak tersedia untuk penghuni aktif';
  end if;
  if exists (
    select 1 from public.tenants other_tenant
    where other_tenant.room_id = new.room_id
      and other_tenant.status = 'Aktif'
      and other_tenant.id <> new.id
  ) then
    raise exception 'Kamar sudah ditempati penghuni aktif';
  end if;
  return new;
end;
$$;

create or replace function public.sync_room_occupancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.room_id is not null and
    (old.room_id is distinct from new.room_id or old.status = 'Aktif' and new.status <> 'Aktif') then
    update public.rooms room
    set status = 'available'
    where room.id = old.room_id
      and room.status = 'occupied'
      and not exists (
        select 1 from public.tenants tenant
        where tenant.room_id = old.room_id and tenant.status = 'Aktif' and tenant.id <> new.id
      );
  end if;

  if new.status = 'Aktif' and new.room_id is not null then
    update public.rooms set status = 'occupied'
    where id = new.room_id and status = 'available';
  end if;
  return new;
end;
$$;

create or replace function public.guard_room_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> old.status and exists (
    select 1 from public.tenants tenant
    where tenant.room_id = new.id and tenant.status = 'Aktif'
  ) and new.status <> 'occupied' then
    raise exception 'Status kamar dengan penghuni aktif harus occupied';
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_guard_room_assignment on public.tenants;
create trigger tenants_guard_room_assignment
before insert or update of room_id, status on public.tenants
for each row execute procedure public.guard_tenant_room_assignment();

drop trigger if exists tenants_sync_room_occupancy on public.tenants;
create trigger tenants_sync_room_occupancy
after insert or update of room_id, status on public.tenants
for each row execute procedure public.sync_room_occupancy();

drop trigger if exists rooms_guard_status on public.rooms;
create trigger rooms_guard_status
before update of status on public.rooms
for each row execute procedure public.guard_room_status();

drop trigger if exists properties_set_updated_at on public.properties;
create trigger properties_set_updated_at before update on public.properties
for each row execute procedure public.set_updated_at();

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at before update on public.rooms
for each row execute procedure public.set_updated_at();

alter table public.properties enable row level security;
alter table public.rooms enable row level security;

drop policy if exists "kost members read properties" on public.properties;
drop policy if exists "kost staff insert properties" on public.properties;
drop policy if exists "kost staff update properties" on public.properties;
drop policy if exists "kost staff delete properties" on public.properties;
create policy "kost members read properties" on public.properties
for select to authenticated using (public.has_kost_role(array['admin','pengelola','pemilik']));
create policy "kost staff insert properties" on public.properties
for insert to authenticated with check (public.has_kost_role(array['admin','pengelola']));
create policy "kost staff update properties" on public.properties
for update to authenticated using (public.has_kost_role(array['admin','pengelola']))
with check (public.has_kost_role(array['admin','pengelola']));
create policy "kost staff delete properties" on public.properties
for delete to authenticated using (public.has_kost_role(array['admin']));

drop policy if exists "kost members read rooms" on public.rooms;
drop policy if exists "kost staff insert rooms" on public.rooms;
drop policy if exists "kost staff update rooms" on public.rooms;
drop policy if exists "kost staff delete rooms" on public.rooms;
create policy "kost members read rooms" on public.rooms
for select to authenticated using (public.has_kost_role(array['admin','pengelola','pemilik']));
create policy "kost staff insert rooms" on public.rooms
for insert to authenticated with check (public.has_kost_role(array['admin','pengelola']));
create policy "kost staff update rooms" on public.rooms
for update to authenticated using (public.has_kost_role(array['admin','pengelola']))
with check (public.has_kost_role(array['admin','pengelola']));
create policy "kost admins delete rooms" on public.rooms
for delete to authenticated using (public.has_kost_role(array['admin']));

grant select, insert, update, delete on public.properties, public.rooms to authenticated;
grant select, update on public.tenants to authenticated;

-- Keep tenant.room_number for backward compatibility; room_id is the normalized relation.
