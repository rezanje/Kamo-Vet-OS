-- Inventaris Operasional (permintaan klien via Nje, 23 Nov 2026): perlengkapan cabang seperti sapu, ember, alat pel.
-- Versi awal = KUANTITAS SAJA. Tidak menyentuh barang jual (items/stok/kartu stok), tidak membuat jurnal,
-- tidak ada nilai rupiah maupun penyusutan. Modul berdiri sendiri; opname barang dagangan (opname_orders) tidak berubah.
--
-- Akses = IRISAN dua gerbang, ditegakkan di database (baca lewat RLS, tulis lewat RPC), bukan hanya di aplikasi:
--  1. Hak menu: public.inventaris_operasional_allowed() membaca sumber Akses Grup yang sama dengan aplikasi
--     (role_modules, role_settings_private.submenu_policies/submenu_catalog, account_access_overrides; lihat fungsinya).
--  2. Hak cabang: public.user_can_access_branch(branch_id), termasuk pilihan cabang operasional di header.
-- Tabel tidak bisa ditulis langsung; satu-satunya jalan tulis adalah dua RPC SECURITY DEFINER di bawah, masing-masing
-- atomik (saldo + riwayat dalam satu transaksi). Admin Online ditolak (gerbang 1 + guard_all()/fence_all() #549).
--
-- Pengaman simpan:
--  * Klik ganda / kirim ulang: kunci permintaan per pelaku (actor_id, request_key) + kunci advisori; kiriman
--    ulang yang sama mengembalikan dokumen pertama, kiriman berbeda dengan kunci yang sama ditolak.
--  * Saldo berubah sejak dibaca: setiap baris membawa revisi yang dibaca layar; beda revisi = ditolak seluruhnya.
--
-- Batal (sebelum ada data nyata):
--   drop function public.inventaris_operasional_tambah(text,uuid,text,text,numeric);
--   drop function public.inventaris_operasional_opname(text,uuid,jsonb,text);
--   drop function public.inventaris_operasional_pelaku(uuid); drop function public.inventaris_operasional_allowed();
--   drop table public.operational_inventory_history, public.operational_inventory_counts, public.operational_inventory_items;
--   delete from role_settings_private.submenu_catalog where id='pos.inventaris-operasional';
set local lock_timeout='5s';

-- Sub-menu Akses Grup (pola 20261117100000). Dipasang lebih dulu: gerbang hak menu di bawah gagal tertutup tanpa baris ini.
insert into role_settings_private.submenu_catalog(id,module_id) values
('pos.inventaris-operasional','pos')
on conflict (id) do nothing;

-- Gerbang hak menu, semantik sama dengan aplikasi (lib/akses.ts modulDiizinkan/bolehBukaPath + lib/akses-akun.ts):
--  * OWNER aktif: selalu boleh (tidak membaca tabel kebijakan, jadi galat kebijakan tidak bisa mengunci pemilik).
--  * ADMIN_ONLINE / tidak login / akun nonaktif: tidak.
--  * Akses khusus akun mode 'khusus': HANYA isi akses khusus (modul pos seluruhnya, atau daftar sub-menu yang memuat id ini).
--  * Mode 'tambah': isi akses khusus DITAMBAH hak peran di bawah.
--  * Hak peran: bila peran punya baris role_modules -> wajib ada modul 'pos'; tanpa baris -> bawaan peran
--    (ADMIN, DOCTOR = semua modul; STAFF = Klinik; FINANCE = modul keuangan -> tidak termasuk Persediaan).
--    Lalu kebijakan sub-menu peran untuk modul 'pos', bila ada, wajib memuat id ini (tanpa kebijakan = semua sub-menu).
--  * Gagal tertutup: id belum ada di katalog, data akses khusus tak terbaca/berbentuk salah, atau galat apa pun = tidak.
create function public.inventaris_operasional_allowed() returns boolean
language plpgsql stable security definer set search_path='' as $fn$
declare v_role public.user_role; v_ovr record; v_pos jsonb; v_rows boolean; v_allowed text[];
 c_id constant text := 'pos.inventaris-operasional';
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then return false; end if;
 select p.role into v_role from public.profiles p where p.id=auth.uid() and p.is_active;
 if v_role is null then return false; end if;
 if v_role='OWNER' then return true; end if;
 if v_role::text='ADMIN_ONLINE' then return false; end if;
 begin
  if not exists(select 1 from role_settings_private.submenu_catalog where id=c_id and module_id='pos') then return false; end if;
  select o.mode,o.modules into v_ovr from role_settings_private.account_access_overrides o where o.profile_id=auth.uid();
  if found then
   if jsonb_typeof(v_ovr.modules) is distinct from 'object' then return false; end if;
   if v_ovr.modules ? 'pos' then
    v_pos := v_ovr.modules->'pos';
    if jsonb_typeof(v_pos)='null' then return true; end if;
    if jsonb_typeof(v_pos) is distinct from 'array' then return false; end if;
    if v_pos ? c_id then return true; end if;
   end if;
   if v_ovr.mode='khusus' then return false; end if;
   if v_ovr.mode is distinct from 'tambah' then return false; end if;
  end if;
  v_rows := exists(select 1 from public.role_modules m where m.role=v_role and m.module_id<>'__role_v2__');
  if v_rows then
   if not exists(select 1 from public.role_modules m where m.role=v_role and m.module_id='pos') then return false; end if;
  elsif v_role::text not in ('ADMIN','DOCTOR') then
   return false;
  end if;
  select s.allowed into v_allowed from role_settings_private.submenu_policies s where s.role=v_role and s.module_id='pos';
  if found then return v_allowed is not null and c_id = any(v_allowed); end if;
  return true;
 exception when others then return false;
 end;
end $fn$;
comment on function public.inventaris_operasional_allowed() is
 'Boleh membuka Inventaris Operasional (Persediaan > sub-menu pos.inventaris-operasional)? Sumber: Akses Grup + akses khusus akun; gagal tertutup. Akses cabang dicek terpisah.';
revoke all on function public.inventaris_operasional_allowed() from public,anon,service_role;
grant execute on function public.inventaris_operasional_allowed() to authenticated;

create table public.operational_inventory_items(
 id uuid primary key default gen_random_uuid(),
 branch_id uuid not null references public.branches(id),
 nama text not null check (length(btrim(nama)) between 2 and 120 and nama=btrim(nama)),
 satuan text not null check (length(btrim(satuan)) between 1 and 30 and satuan=btrim(satuan)),
 qty numeric(14,2) not null default 0 check (qty>=0),
 revision integer not null default 1 check (revision>=1),
 is_active boolean not null default true,
 request_key text not null check (length(request_key) between 8 and 160),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(created_by,request_key)
);
create unique index operational_inventory_items_nama_unik on public.operational_inventory_items(branch_id,lower(nama),lower(satuan)) where is_active;
create index operational_inventory_items_branch on public.operational_inventory_items(branch_id,is_active,nama);
comment on table public.operational_inventory_items is
 'Inventaris Operasional: perlengkapan per cabang (sapu, ember, alat pel). Kuantitas saja; bukan barang jual, tanpa jurnal/penyusutan.';

create table public.operational_inventory_counts(
 id uuid primary key default gen_random_uuid(),
 branch_id uuid not null references public.branches(id),
 actor_id uuid not null references public.profiles(id),
 actor_nama text not null,
 request_key text not null check (length(request_key) between 8 and 160),
 payload jsonb not null,
 catatan text check (catatan is null or length(catatan)<=500),
 jumlah_barang integer not null check (jumlah_barang>0),
 jumlah_selisih integer not null check (jumlah_selisih>=0),
 created_at timestamptz not null default now(),
 unique(actor_id,request_key)
);
create index operational_inventory_counts_branch on public.operational_inventory_counts(branch_id,created_at desc);
comment on table public.operational_inventory_counts is 'Satu sesi opname Inventaris Operasional (seluruh barang aktif satu cabang).';

create table public.operational_inventory_history(
 id uuid primary key default gen_random_uuid(),
 item_id uuid not null references public.operational_inventory_items(id),
 branch_id uuid not null references public.branches(id),
 count_id uuid references public.operational_inventory_counts(id),
 jenis text not null check (jenis in ('saldo_awal','opname')),
 qty_sebelum numeric(14,2) not null check (qty_sebelum>=0),
 qty_sesudah numeric(14,2) not null check (qty_sesudah>=0),
 selisih numeric(14,2) generated always as (qty_sesudah-qty_sebelum) stored,
 alasan text check (alasan is null or length(alasan)<=500),
 actor_id uuid not null references public.profiles(id),
 actor_nama text not null,
 created_at timestamptz not null default now(),
 check ((jenis='saldo_awal' and count_id is null and qty_sebelum=0) or (jenis='opname' and count_id is not null)),
 check (jenis<>'opname' or qty_sesudah=qty_sebelum or length(btrim(coalesce(alasan,'')))>=3)
);
create index operational_inventory_history_branch on public.operational_inventory_history(branch_id,created_at desc);
create index operational_inventory_history_item on public.operational_inventory_history(item_id,created_at desc);
create index operational_inventory_history_count on public.operational_inventory_history(count_id) where count_id is not null;
comment on table public.operational_inventory_history is 'Riwayat Inventaris Operasional: siapa, kapan, jumlah sebelum/sesudah, selisih dan alasannya.';

-- Baca saja lewat RLS; tidak ada hak tulis langsung bagi siapa pun selain pemilik (RPC).
alter table public.operational_inventory_items enable row level security;
alter table public.operational_inventory_counts enable row level security;
alter table public.operational_inventory_history enable row level security;
revoke all on public.operational_inventory_items, public.operational_inventory_counts, public.operational_inventory_history
 from public, anon, authenticated, service_role;
grant select on public.operational_inventory_items, public.operational_inventory_counts, public.operational_inventory_history to authenticated;
create policy operational_inventory_items_read on public.operational_inventory_items for select to authenticated
 using ((select public.inventaris_operasional_allowed()) and public.user_can_access_branch(branch_id));
create policy operational_inventory_counts_read on public.operational_inventory_counts for select to authenticated
 using ((select public.inventaris_operasional_allowed()) and public.user_can_access_branch(branch_id));
create policy operational_inventory_history_read on public.operational_inventory_history for select to authenticated
 using ((select public.inventaris_operasional_allowed()) and public.user_can_access_branch(branch_id));

-- Riwayat tidak boleh diubah/dihapus, termasuk oleh pemilik fungsi lewat jalur lain.
create function public.operational_inventory_history_append_only() returns trigger
language plpgsql set search_path='' as $$
begin
 raise exception 'Riwayat Inventaris Operasional tidak dapat diubah atau dihapus' using errcode='42501';
end $$;
revoke all on function public.operational_inventory_history_append_only() from public,anon,authenticated,service_role;
create trigger operational_inventory_history_append_only before update or delete on public.operational_inventory_history
 for each row execute function public.operational_inventory_history_append_only();
create trigger operational_inventory_counts_append_only before update or delete on public.operational_inventory_counts
 for each row execute function public.operational_inventory_history_append_only();

-- Pelaku aktif yang boleh membuka cabang. Mengembalikan nama tampil untuk riwayat.
create function public.inventaris_operasional_pelaku(p_branch uuid) returns text
language plpgsql security definer stable set search_path='' as $$
declare v_nama text;
begin
 if auth.uid() is null then raise exception 'Sesi login diperlukan' using errcode='42501'; end if;
 select coalesce(nullif(btrim(p.full_name),''),'Pengguna') into v_nama from public.profiles p where p.id=auth.uid() and p.is_active;
 if not found then raise exception 'Akun tidak aktif' using errcode='42501'; end if;
 if not public.inventaris_operasional_allowed() then
  raise exception 'INVENTARIS_MENU_DITOLAK: akun ini tidak diberi akses menu Inventaris Operasional' using errcode='42501';
 end if;
 if p_branch is null or not public.user_can_access_branch(p_branch) then
  raise exception 'INVENTARIS_CABANG_DITOLAK: Anda tidak punya akses ke cabang ini' using errcode='42501';
 end if;
 if not exists(select 1 from public.branches b where b.id=p_branch and b.is_active) then
  raise exception 'Cabang tidak aktif';
 end if;
 return v_nama;
end $$;
revoke all on function public.inventaris_operasional_pelaku(uuid) from public,anon,authenticated,service_role;

-- Tambah barang + saldo awal (riwayat 'saldo_awal'). Idempoten per (pelaku, kunci).
create function public.inventaris_operasional_tambah(p_request_key text, p_branch uuid, p_nama text, p_satuan text, p_qty numeric)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_nama_pelaku text; v_id uuid; v_old record;
 v_nama text := btrim(coalesce(p_nama,'')); v_satuan text := btrim(coalesce(p_satuan,''));
begin
 v_nama_pelaku := public.inventaris_operasional_pelaku(p_branch);
 if p_request_key is null or length(p_request_key) not between 8 and 160 then raise exception 'Kunci permintaan tidak valid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('invop-tambah:'||auth.uid()::text||':'||p_request_key,0));
 select id,branch_id,nama,satuan,qty into v_old from public.operational_inventory_items
  where created_by=auth.uid() and request_key=p_request_key;
 if found then
  if v_old.branch_id<>p_branch or v_old.nama<>v_nama or v_old.satuan<>v_satuan
     or not exists(select 1 from public.operational_inventory_history h where h.item_id=v_old.id and h.jenis='saldo_awal' and h.qty_sesudah=p_qty) then
   raise exception 'Kunci permintaan sudah dipakai untuk data lain. Muat ulang halaman';
  end if;
  return v_old.id;
 end if;
 if length(v_nama) not between 2 and 120 then raise exception 'Nama barang wajib 2-120 huruf'; end if;
 if length(v_satuan) not between 1 and 30 then raise exception 'Satuan wajib diisi (maks. 30 huruf)'; end if;
 if p_qty is null or p_qty<0 or p_qty>=1e12 or p_qty<>round(p_qty,2) then raise exception 'Jumlah awal tidak valid (0 atau lebih, maks. 2 desimal)'; end if;
 if exists(select 1 from public.operational_inventory_items i where i.branch_id=p_branch and i.is_active
           and lower(i.nama)=lower(v_nama) and lower(i.satuan)=lower(v_satuan)) then
  raise exception 'Barang "%" (%) sudah ada di cabang ini', v_nama, v_satuan;
 end if;
 insert into public.operational_inventory_items(branch_id,nama,satuan,qty,request_key,created_by)
  values(p_branch,v_nama,v_satuan,p_qty,p_request_key,auth.uid()) returning id into v_id;
 insert into public.operational_inventory_history(item_id,branch_id,jenis,qty_sebelum,qty_sesudah,alasan,actor_id,actor_nama)
  values(v_id,p_branch,'saldo_awal',0,p_qty,'Saldo awal',auth.uid(),v_nama_pelaku);
 return v_id;
end $$;
revoke all on function public.inventaris_operasional_tambah(text,uuid,text,text,numeric) from public,anon,authenticated,service_role;
grant execute on function public.inventaris_operasional_tambah(text,uuid,text,text,numeric) to authenticated;

-- Opname: p_lines = [{"item_id":uuid,"revision":int,"qty_fisik":number,"alasan":text|null}], wajib mencakup SEMUA
-- barang aktif cabang tepat satu kali. Selisih != 0 wajib alasan (min. 3 huruf). Saldo + riwayat + kepala opname
-- ditulis atomik; satu revisi yang tidak cocok menolak seluruh opname.
create function public.inventaris_operasional_opname(p_request_key text, p_branch uuid, p_lines jsonb, p_catatan text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_nama_pelaku text; v_old record; v_count uuid; v_line jsonb; v_item record; v_row jsonb;
 v_qty numeric; v_rev integer; v_alasan text; v_seen uuid[] := '{}'; v_ok jsonb := '[]'; v_diff integer := 0;
 v_catatan text := nullif(btrim(coalesce(p_catatan,'')),'');
begin
 v_nama_pelaku := public.inventaris_operasional_pelaku(p_branch);
 if p_request_key is null or length(p_request_key) not between 8 and 160 then raise exception 'Kunci permintaan tidak valid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('invop-opname:'||auth.uid()::text||':'||p_request_key,0));
 select id,branch_id,payload into v_old from public.operational_inventory_counts where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if v_old.branch_id<>p_branch or v_old.payload is distinct from jsonb_build_object('lines',p_lines,'catatan',v_catatan) then
   raise exception 'Kunci permintaan sudah dipakai untuk opname lain. Muat ulang halaman';
  end if;
  return v_old.id;
 end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)=0 then raise exception 'Belum ada barang yang dihitung'; end if;
 if jsonb_array_length(p_lines)>1000 then raise exception 'Maksimal 1000 barang per opname'; end if;
 if v_catatan is not null and length(v_catatan)>500 then raise exception 'Catatan maksimal 500 huruf'; end if;

 -- Kunci semua barang aktif cabang (urutan tetap) supaya opname/tambah lain di cabang yang sama menunggu.
 perform 1 from public.operational_inventory_items i where i.branch_id=p_branch and i.is_active order by i.id for update;

 -- Tahap 1: validasi semua baris tanpa menulis apa pun.
 for v_line in select value from jsonb_array_elements(p_lines) loop
  if jsonb_typeof(v_line) is distinct from 'object' then raise exception 'Baris opname tidak valid'; end if;
  begin
   v_qty := (v_line->>'qty_fisik')::numeric;
   v_rev := (v_line->>'revision')::integer;
  exception when others then raise exception 'Jumlah fisik atau revisi tidak valid';
  end;
  if v_qty is null or v_qty<0 or v_qty>=1e12 or v_qty<>round(v_qty,2) then raise exception 'Jumlah fisik harus 0 atau lebih (maks. 2 desimal)'; end if;
  select i.id,i.nama,i.qty,i.revision into v_item from public.operational_inventory_items i
   where i.id=(case when (v_line->>'item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (v_line->>'item_id')::uuid end)
     and i.branch_id=p_branch and i.is_active;
  if not found then raise exception 'Barang tidak ditemukan di cabang ini'; end if;
  if v_item.id=any(v_seen) then raise exception 'Barang "%" terkirim dua kali', v_item.nama; end if;
  v_seen := v_seen||v_item.id;
  if v_rev is distinct from v_item.revision then
   raise exception 'INVENTARIS_SALDO_BERUBAH: jumlah "%" sudah berubah sejak halaman dibuka. Muat ulang lalu hitung lagi', v_item.nama;
  end if;
  v_alasan := nullif(btrim(coalesce(v_line->>'alasan','')),'');
  if v_qty<>v_item.qty and (v_alasan is null or length(v_alasan)<3) then
   raise exception 'Alasan selisih "%" wajib diisi (minimal 3 huruf)', v_item.nama;
  end if;
  if v_alasan is not null and length(v_alasan)>500 then raise exception 'Alasan maksimal 500 huruf'; end if;
  if v_qty<>v_item.qty then v_diff := v_diff+1; end if;
  v_ok := v_ok||jsonb_build_object('id',v_item.id,'sebelum',v_item.qty,'sesudah',v_qty,'alasan',case when v_qty<>v_item.qty then v_alasan end);
 end loop;
 if exists(select 1 from public.operational_inventory_items i where i.branch_id=p_branch and i.is_active and not (i.id=any(v_seen))) then
  raise exception 'INVENTARIS_DAFTAR_BERUBAH: daftar barang cabang ini berubah sejak halaman dibuka. Muat ulang lalu hitung lagi';
 end if;

 -- Tahap 2: kepala opname, riwayat, dan saldo dalam transaksi yang sama.
 insert into public.operational_inventory_counts(branch_id,actor_id,actor_nama,request_key,payload,catatan,jumlah_barang,jumlah_selisih)
  values(p_branch,auth.uid(),v_nama_pelaku,p_request_key,jsonb_build_object('lines',p_lines,'catatan',v_catatan),v_catatan,jsonb_array_length(v_ok),v_diff)
  returning id into v_count;
 for v_row in select value from jsonb_array_elements(v_ok) loop
  insert into public.operational_inventory_history(item_id,branch_id,count_id,jenis,qty_sebelum,qty_sesudah,alasan,actor_id,actor_nama)
   values((v_row->>'id')::uuid,p_branch,v_count,'opname',(v_row->>'sebelum')::numeric,(v_row->>'sesudah')::numeric,v_row->>'alasan',auth.uid(),v_nama_pelaku);
  update public.operational_inventory_items set qty=(v_row->>'sesudah')::numeric,revision=revision+1,updated_at=now() where id=(v_row->>'id')::uuid;
 end loop;
 return v_count;
end $$;
revoke all on function public.inventaris_operasional_opname(text,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.inventaris_operasional_opname(text,uuid,jsonb,text) to authenticated;

-- Pagar Admin Online (#549): fungsi SECURITY DEFINER dan tabel baru. Idempotent.
select admin_online_private.guard_all();
select admin_online_private.fence_all();
