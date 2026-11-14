-- Perusahaan > Cabang / Gudang: Owner/Admin dapat MENGUBAH cabang dan MENGUBAH / NONAKTIFKAN gudang; hanya OWNER boleh MENGHAPUS gudang
-- (Andri 14 Nov 2026: cabang Lengkong salah nama, menu gudang tidak bisa edit/hapus).
--
-- Mengapa lewat fungsi database, bukan UPDATE/DELETE langsung dari layar:
--  * branches_update memakai USING true: akun login mana pun bisa mengubah nama/kode/status cabang lewat REST.
--  * warehouses_update/delete hanya menanya akses cabang (user_can_access_branch), dan FK stock, stock_layers, stock_moves
--    adalah ON DELETE CASCADE: DELETE langsung pada gudang berstok MENGHAPUS riwayat stoknya.
-- Fungsi di bawah SECURITY DEFINER (search_path kosong), cek peran di database, mengunci baris, memeriksa pemakaian
-- lewat KATALOG FK (tabel baru yang menunjuk cabang/gudang otomatis ikut terhitung), lalu menulis jejak.
-- Tiga pemicu penjaga menolak penulisan langsung (peran authenticated/anon) pada kolom penting; kolom lat, lng, radius_m
-- cabang (layar Pengaturan > Cabang) tidak disentuh. Aditif: tidak ada fungsi lama yang diganti.

create table if not exists clinic_private.master_edit_audit (
  id bigint generated always as identity primary key,
  entity text not null check (entity in ('branches','warehouses')),
  entity_id uuid not null,
  action text not null check (action in ('update','delete')),
  before_state jsonb not null,
  after_state jsonb,
  reason text,
  actor_id uuid not null,
  created_at timestamptz not null default now()
);
revoke all on clinic_private.master_edit_audit from public, anon, authenticated, service_role;
alter table clinic_private.master_edit_audit enable row level security;

create or replace function clinic_private.master_actor_role() returns text
language sql stable security definer set search_path='' as $$
  select p.role::text from public.profiles p where p.id = auth.uid() and p.is_active
$$;
revoke all on function clinic_private.master_actor_role() from public, anon, authenticated, service_role;

-- Tabel mana yang menunjuk satu baris induk (cabang/gudang), dibaca dari katalog FK.
create or replace function clinic_private.fk_referencing_tables(p_parent regclass, p_id uuid, p_skip text[])
returns text[] language plpgsql security definer set search_path='' as $$
declare r record; v_hit boolean; v text[] := '{}';
begin
  for r in
    select n.nspname || '.' || c.relname as tbl, k.conrelid::regclass as rel, a.attname as col
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     where k.contype = 'f' and k.confrelid = p_parent
       and not (n.nspname || '.' || c.relname) = any (coalesce(p_skip, '{}'))
     order by 1, 3
  loop
    execute format('select exists(select 1 from %s where %I = $1)', r.rel, r.col) into v_hit using p_id;
    if v_hit and not (r.tbl = any (v)) then v := v || r.tbl; end if;
  end loop;
  return v;
end $$;
revoke all on function clinic_private.fk_referencing_tables(regclass, uuid, text[]) from public, anon, authenticated, service_role;

-- Peta {id induk: [tabel]} untuk layar (satu panggilan, bukan satu per kartu).
create or replace function clinic_private.fk_usage_map(p_parent regclass, p_skip text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare r record; v_ids uuid[]; v_id uuid; v jsonb := '{}'::jsonb; v_tables jsonb;
begin
  for r in
    select n.nspname || '.' || c.relname as tbl, k.conrelid::regclass as rel, a.attname as col
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     where k.contype = 'f' and k.confrelid = p_parent
       and not (n.nspname || '.' || c.relname) = any (coalesce(p_skip, '{}'))
     order by 1, 3
  loop
    execute format('select coalesce(array_agg(distinct %I), ''{}'') from %s where %I is not null', r.col, r.rel, r.col) into v_ids;
    foreach v_id in array v_ids loop
      v_tables := coalesce(v -> v_id::text, '[]'::jsonb);
      if not v_tables ? r.tbl then v := jsonb_set(v, array[v_id::text], v_tables || to_jsonb(r.tbl), true); end if;
    end loop;
  end loop;
  return v;
end $$;
revoke all on function clinic_private.fk_usage_map(regclass, text[]) from public, anon, authenticated, service_role;

-- Tabel pengaturan/penempatan yang BUKAN transaksi: kehadirannya tidak mengunci kode cabang.
create or replace function clinic_private.branch_config_tables() returns text[]
language sql immutable set search_path='' as $$
  select array['public.user_branches','public.warehouses','public.employee_branch_assignments','public.employee_branch_change_log',
    'public.employees','public.branch_capacity_periods','public.branch_grooming_rules','public.payment_account_map',
    'public.operational_alert_settings','public.item_branch_prices','public.consent_templates','public.commission_rules',
    'public.service_commission_policies','public.inpatient_rx_evidence_settings','public.staff_quest_definitions',
    'public.sales_targets','public.budgets','public.cash_accounts','public.initial_stock_scope_mappings','public.work_shifts']
$$;
revoke all on function clinic_private.branch_config_tables() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- pembaca untuk layar (OWNER/ADMIN)
create or replace function public.read_branch_usage() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(clinic_private.master_actor_role(), '') not in ('OWNER', 'ADMIN') then
    raise exception 'Hanya OWNER/ADMIN aktif yang dapat melihat pemakaian cabang' using errcode = '42501';
  end if;
  return clinic_private.fk_usage_map('public.branches'::regclass, clinic_private.branch_config_tables());
end $$;

create or replace function public.read_warehouse_usage() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(clinic_private.master_actor_role(), '') not in ('OWNER', 'ADMIN') then
    raise exception 'Hanya OWNER/ADMIN aktif yang dapat melihat pemakaian gudang' using errcode = '42501';
  end if;
  return clinic_private.fk_usage_map('public.warehouses'::regclass, '{}');
end $$;

-- ---------------------------------------------------------------- ubah cabang
create or replace function public.update_branch_info(p_id uuid, p_name text, p_code text default null, p_is_active boolean default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_role text := clinic_private.master_actor_role();
  b public.branches%rowtype;
  v_name text;
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
  v_n int;
  r public.branches%rowtype;
begin
  if v_role is null or v_role not in ('OWNER', 'ADMIN') then
    raise exception 'Hanya OWNER/ADMIN aktif yang dapat mengubah cabang' using errcode = '42501';
  end if;
  select * into b from public.branches where id = p_id for update;
  if not found then raise exception 'Cabang tidak ditemukan' using errcode = 'CG002'; end if;
  -- p_name null = nama tidak diubah (dipakai tombol Nonaktifkan/Aktifkan); teks kosong tetap ditolak di bawah.
  v_name := case when p_name is null then b.name else regexp_replace(btrim(p_name), '\s+', ' ', 'g') end;

  if v_name is distinct from b.name then
    if length(v_name) not between 2 and 80 or v_name ~ '[[:cntrl:]]' then
      raise exception 'Nama cabang 2 sampai 80 karakter' using errcode = '22023';
    end if;
    if exists (select 1 from public.branches x where x.id <> b.id
                and lower(regexp_replace(btrim(x.name), '\s+', ' ', 'g')) = lower(v_name)) then
      raise exception 'Nama cabang sudah dipakai cabang lain' using errcode = '23505';
    end if;
  end if;

  if v_code is not null and v_code is distinct from b.code then
    if v_code !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,14}$' then
      raise exception 'Kode cabang 1 sampai 15 karakter: huruf, angka, spasi, titik, garis bawah, atau tanda minus' using errcode = '22023';
    end if;
    if cardinality(clinic_private.fk_referencing_tables('public.branches'::regclass, b.id, clinic_private.branch_config_tables())) > 0 then
      raise exception 'Kode cabang terkunci: cabang ini sudah punya transaksi atau riwayat. Ubah namanya saja' using errcode = 'CG001';
    end if;
    if exists (select 1 from public.branches x where x.id <> b.id and lower(x.code) = lower(v_code)) then
      raise exception 'Kode cabang sudah dipakai' using errcode = '23505';
    end if;
  end if;

  if p_is_active is not null and p_is_active is distinct from b.is_active and not p_is_active then
    select count(*) into v_n from public.cashier_shifts s where s.branch_id = b.id and s.status = 'open';
    if v_n > 0 then
      raise exception 'Cabang masih punya % shift kasir yang terbuka. Tutup shift dulu', v_n using errcode = 'CG001';
    end if;
    select count(*) into v_n from public.visits v where v.branch_id = b.id and v.archived_at is null and v.status <> 'Selesai';
    if v_n > 0 then
      raise exception 'Cabang masih punya % kunjungan klinik yang belum selesai. Selesaikan atau arsipkan dulu', v_n using errcode = 'CG001';
    end if;
    if not exists (select 1 from public.branches x where x.id <> b.id and x.is_active) then
      raise exception 'Tidak bisa menonaktifkan satu-satunya cabang aktif' using errcode = 'CG001';
    end if;
  end if;

  if v_name is not distinct from b.name and (v_code is null or v_code is not distinct from b.code)
     and (p_is_active is null or p_is_active is not distinct from b.is_active) then
    return jsonb_build_object('id', b.id, 'code', b.code, 'name', b.name, 'is_active', b.is_active, 'changed', false);
  end if;

  update public.branches
     set name = v_name, code = coalesce(v_code, b.code), is_active = coalesce(p_is_active, b.is_active)
   where id = b.id
   returning * into r;
  insert into clinic_private.master_edit_audit(entity, entity_id, action, before_state, after_state, actor_id)
    values ('branches', b.id, 'update',
            jsonb_build_object('name', b.name, 'code', b.code, 'is_active', b.is_active),
            jsonb_build_object('name', r.name, 'code', r.code, 'is_active', r.is_active), auth.uid());
  return jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name, 'is_active', r.is_active, 'changed', true);
end $$;

-- ---------------------------------------------------------------- ubah / nonaktifkan gudang
create or replace function public.update_warehouse_info(p_id uuid, p_name text, p_code text default null, p_type text default null, p_is_active boolean default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_role text := clinic_private.master_actor_role();
  w public.warehouses%rowtype;
  r public.warehouses%rowtype;
  v_name text;
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
  v_type text := nullif(btrim(coalesce(p_type, '')), '');
  v_used boolean;
  v_n int;
  v_branch_active boolean;
begin
  if v_role is null or v_role not in ('OWNER', 'ADMIN') then
    raise exception 'Hanya OWNER/ADMIN aktif yang dapat mengubah gudang' using errcode = '42501';
  end if;
  select * into w from public.warehouses where id = p_id for update;
  if not found then raise exception 'Gudang tidak ditemukan' using errcode = 'CG002'; end if;
  v_name := case when p_name is null then w.name else regexp_replace(btrim(p_name), '\s+', ' ', 'g') end;
  select is_active into v_branch_active from public.branches where id = w.branch_id for share;

  if v_name is distinct from w.name then
    if length(v_name) not between 2 and 100 or v_name ~ '[[:cntrl:]]' then
      raise exception 'Nama gudang 2 sampai 100 karakter' using errcode = '22023';
    end if;
    if exists (select 1 from public.warehouses x where x.id <> w.id and x.branch_id = w.branch_id
                and lower(regexp_replace(btrim(x.name), '\s+', ' ', 'g')) = lower(v_name)) then
      raise exception 'Nama gudang sudah dipakai gudang lain di cabang ini' using errcode = '23505';
    end if;
  end if;

  if (v_code is not null and v_code is distinct from w.code) or (v_type is not null and v_type is distinct from w.type::text) then
    v_used := cardinality(clinic_private.fk_referencing_tables('public.warehouses'::regclass, w.id, '{}')) > 0;
    if v_code is not null and v_code is distinct from w.code then
      if v_code !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,19}$' then
        raise exception 'Kode gudang 1 sampai 20 karakter: huruf, angka, spasi, titik, garis bawah, atau tanda minus' using errcode = '22023';
      end if;
      if v_used then
        raise exception 'Kode gudang terkunci: gudang ini sudah dipakai stok atau dokumen. Ubah namanya saja' using errcode = 'CG001';
      end if;
      if (lower(v_code) like 'dc%') is distinct from (lower(w.code) like 'dc%') then
        raise exception 'Awalan DC pada kode dipakai untuk memilih gudang distribusi; jangan menambah atau menghapus awalan itu' using errcode = '22023';
      end if;
      if exists (select 1 from public.warehouses x where x.id <> w.id and lower(x.code) = lower(v_code)) then
        raise exception 'Kode gudang sudah dipakai' using errcode = '23505';
      end if;
    end if;
    if v_type is not null and v_type is distinct from w.type::text then
      if v_type not in ('RETAIL', 'VET', 'EXPIRED', 'TRANSIT', 'ONLINE', 'DC') then
        raise exception 'Jenis gudang tidak dikenal' using errcode = '22023';
      end if;
      if v_used then
        raise exception 'Jenis gudang terkunci: gudang ini sudah dipakai stok atau dokumen' using errcode = 'CG001';
      end if;
    end if;
  end if;

  if p_is_active is not null and p_is_active is distinct from w.is_active then
    if p_is_active then
      if not v_branch_active then
        raise exception 'Cabang gudang ini nonaktif. Aktifkan cabangnya dulu' using errcode = 'CG001';
      end if;
    else
      select count(*) into v_n from public.stock s where s.warehouse_id = w.id and s.qty <> 0;
      if v_n > 0 then
        raise exception 'Gudang masih punya stok (% barang). Pindahkan atau nolkan stoknya dulu', v_n using errcode = 'CG001';
      end if;
      select (select count(*) from public.stock_transfers t where t.status = 'Sedang dikirim' and w.id in (t.from_warehouse_id, t.to_warehouse_id))
           + (select count(*) from public.stock_requests q where q.status in ('Menunggu Persetujuan', 'Disetujui', 'Dikirim') and w.id in (q.to_warehouse_id, q.transit_warehouse_id))
           + (select count(*) from public.opname_orders o where o.status = 'Terbuka' and o.warehouse_id = w.id)
        into v_n;
      if v_n > 0 then
        raise exception 'Gudang masih dipakai % dokumen yang belum selesai (transfer, permintaan, atau opname)', v_n using errcode = 'CG001';
      end if;
      if v_branch_active and w.type::text in ('VET', 'RETAIL') and not exists (
           select 1 from public.warehouses x where x.id <> w.id and x.branch_id = w.branch_id and x.type = w.type and x.is_active) then
        raise exception 'Ini satu-satunya gudang % yang aktif di cabangnya. Buat gudang pengganti dulu', w.type using errcode = 'CG001';
      end if;
    end if;
  end if;

  if v_name is not distinct from w.name and (v_code is null or v_code is not distinct from w.code)
     and (v_type is null or v_type is not distinct from w.type::text)
     and (p_is_active is null or p_is_active is not distinct from w.is_active) then
    return jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name, 'type', w.type, 'is_active', w.is_active, 'changed', false);
  end if;

  update public.warehouses
     set name = v_name, code = coalesce(v_code, w.code), type = coalesce(v_type, w.type::text)::public.warehouse_type,
         is_active = coalesce(p_is_active, w.is_active)
   where id = w.id
   returning * into r;
  insert into clinic_private.master_edit_audit(entity, entity_id, action, before_state, after_state, actor_id)
    values ('warehouses', w.id, 'update',
            jsonb_build_object('name', w.name, 'code', w.code, 'type', w.type, 'is_active', w.is_active),
            jsonb_build_object('name', r.name, 'code', r.code, 'type', r.type, 'is_active', r.is_active), auth.uid());
  return jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name, 'type', r.type, 'is_active', r.is_active, 'changed', true);
end $$;

-- ---------------------------------------------------------------- hapus gudang (hanya OWNER, hanya bila belum dipakai sama sekali)
create or replace function public.delete_warehouse(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_role text := clinic_private.master_actor_role();
  w public.warehouses%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_used text[];
begin
  if v_role is distinct from 'OWNER' then
    raise exception 'Hanya OWNER aktif yang dapat menghapus gudang' using errcode = '42501';
  end if;
  if length(v_reason) not between 5 and 300 then
    raise exception 'Alasan hapus wajib diisi (5 sampai 300 karakter)' using errcode = '22023';
  end if;
  select * into w from public.warehouses where id = p_id for update;
  if not found then raise exception 'Gudang tidak ditemukan' using errcode = 'CG002'; end if;
  v_used := clinic_private.fk_referencing_tables('public.warehouses'::regclass, w.id, '{}');
  if cardinality(v_used) > 0 then
    raise exception 'Sudah dipakai, nonaktifkan saja' using errcode = 'CG001';
  end if;
  insert into clinic_private.master_edit_audit(entity, entity_id, action, before_state, after_state, reason, actor_id)
    values ('warehouses', w.id, 'delete',
            jsonb_build_object('name', w.name, 'code', w.code, 'type', w.type, 'is_active', w.is_active, 'branch_id', w.branch_id),
            null, v_reason, auth.uid());
  delete from public.warehouses where id = w.id;
  return jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name, 'deleted', true);
end $$;

-- ---------------------------------------------------------------- penjaga penulisan langsung
create or replace function public.guard_branch_direct_edit() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.id is distinct from old.id or new.name is distinct from old.name or new.code is distinct from old.code
          or new.type is distinct from old.type or new.is_active is distinct from old.is_active) then
    raise exception 'Nama, kode, jenis, dan status cabang hanya bisa diubah lewat menu Perusahaan > Cabang' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.guard_warehouse_direct_edit() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.id is distinct from old.id or new.branch_id is distinct from old.branch_id or new.name is distinct from old.name
          or new.code is distinct from old.code or new.type is distinct from old.type or new.is_active is distinct from old.is_active) then
    raise exception 'Nama, kode, jenis, dan status gudang hanya bisa diubah lewat menu Perusahaan > Gudang' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.guard_warehouse_direct_delete() returns trigger
language plpgsql set search_path='' as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'Gudang hanya bisa dihapus lewat menu Perusahaan > Gudang (OWNER)' using errcode = '42501';
  end if;
  return old;
end $$;

drop trigger if exists a00_guard_branch_direct_edit on public.branches;
create trigger a00_guard_branch_direct_edit before update on public.branches
  for each row execute function public.guard_branch_direct_edit();
drop trigger if exists a00_guard_warehouse_direct_edit on public.warehouses;
create trigger a00_guard_warehouse_direct_edit before update on public.warehouses
  for each row execute function public.guard_warehouse_direct_edit();
drop trigger if exists a00_guard_warehouse_direct_delete on public.warehouses;
create trigger a00_guard_warehouse_direct_delete before delete on public.warehouses
  for each row execute function public.guard_warehouse_direct_delete();

-- ---------------------------------------------------------------- hak eksekusi
revoke all on function public.read_branch_usage() from public, anon, service_role;
revoke all on function public.read_warehouse_usage() from public, anon, service_role;
revoke all on function public.update_branch_info(uuid, text, text, boolean) from public, anon, service_role;
revoke all on function public.update_warehouse_info(uuid, text, text, text, boolean) from public, anon, service_role;
revoke all on function public.delete_warehouse(uuid, text) from public, anon, service_role;
revoke all on function public.guard_branch_direct_edit() from public, anon, service_role;
revoke all on function public.guard_warehouse_direct_edit() from public, anon, service_role;
revoke all on function public.guard_warehouse_direct_delete() from public, anon, service_role;
grant execute on function public.read_branch_usage() to authenticated;
grant execute on function public.read_warehouse_usage() to authenticated;
grant execute on function public.update_branch_info(uuid, text, text, boolean) to authenticated;
grant execute on function public.update_warehouse_info(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.delete_warehouse(uuid, text) to authenticated;
