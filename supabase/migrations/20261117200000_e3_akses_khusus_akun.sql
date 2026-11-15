-- E3 (meeting 12 Nov 2026): AKSES KHUSUS PER AKUN — bagian "Akses khusus akun ini" di Pengaturan › Pengguna.
-- apply as ONE transaction (the Supabase CLI runs this file in one; there is no begin/commit in it).
--
-- Keputusan Owner (docs/meeting-2026-11-12/USULAN-E3.md): 1A akses khusus per akun; 2A peran dasar akun staf online =
-- STAFF; 3A ketiga mode tersedia. Per akun (profile) Owner memilih:
--   * "Ikuti peran"        = tidak ada baris di sini (bawaan; perilaku sebelum migrasi ini persis);
--   * "Peran + tambahan"   = mode 'tambah': akses menu peran DITAMBAH modul/sub-menu yang dicentang untuk akun ini;
--   * "Hanya akses khusus" = mode 'khusus': akun hanya bisa membuka modul/sub-menu yang dicentang (menu peran diabaikan).
-- Cakupan = hak buka menu/halaman (katalog yang sama dengan Akses Grup: modul + grup Operasional + submenu_catalog).
-- TIDAK memberi tindakan bisnis yang dijaga database: action_policies / role_action_allowed tetap per peran.
-- Hanya OWNER aktif yang mengatur; akun OWNER tidak bisa diberi akses khusus (OWNER selalu penuh).
-- Tiap perubahan tercatat (siapa, kapan, sebelum/sesudah, alasan opsional) di riwayat append-only, dan muncul di
-- Log Aktifitas (metadata saja, seperti pengaturan akses lain). Penautan akun ↔ karyawan (employees.profile_id) dan
-- akses cabang (user_branches) TIDAK disentuh.
--
-- DAMPAK: tidak ada yang berubah sampai Owner menyimpan akses khusus untuk sebuah akun (tabel baru kosong; bagian 7
-- hanya menambah satu syarat "atau" yang bergantung pada baris tabel baru itu).
-- Aplikasi: membaca get_my_access_override() bersamaan dengan aturan peran. Aplikasi yang rilis SEBELUM migrasi ini:
-- tidak memanggil apa pun (aman). Aplikasi baru SEBELUM migrasi: fungsi belum ada = "Ikuti peran" (aman).
--
-- ROLLBACK (satu transaksi, urut):
--   1. kembalikan public.sales_module_access() ke definisi 20261004150000 (hapus baris bertanda "E3" di bagian 7);
--   2. drop function public.save_account_access_override(uuid,text,jsonb,text,uuid),
--      public.get_account_access_override(uuid), public.get_my_access_override();
--   3. drop table role_settings_private.account_access_requests, role_settings_private.account_access_permits,
--      role_settings_private.account_access_override_history, role_settings_private.account_access_overrides;
--   4. drop function role_settings_private.account_access_guard(), role_settings_private.account_access_normalize(jsonb);
--   5. delete from public.activity_log_sources where entity='account_access_overrides';
--   Aplikasi yang sudah rilis tetap aman setelah rollback: fungsi baca yang hilang = "Ikuti peran".
set local lock_timeout='5s';

-- ───────────── 1. Tabel privat (tidak bisa dibaca/ditulis langsung oleh klien) ─────────────
create table role_settings_private.account_access_overrides (
 profile_id uuid primary key references public.profiles(id) on delete cascade,
 mode text not null check (mode in ('tambah','khusus')),
 -- {module_id: null (seluruh modul) | [id sub-menu, ...]}; dinormalisasi oleh account_access_normalize()
 modules jsonb not null check (jsonb_typeof(modules)='object' and modules<>'{}'::jsonb),
 updated_by uuid not null,
 updated_at timestamptz not null default clock_timestamp()
);
-- Riwayat append-only: tanpa FK supaya tetap ada walau akun dihapus. before/after null = "Ikuti peran".
create table role_settings_private.account_access_override_history (
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 created_by uuid not null,
 target_role public.user_role not null,
 reason text,
 before jsonb,
 after jsonb,
 request_key uuid
);
create index account_access_override_history_profile on role_settings_private.account_access_override_history(profile_id,created_at desc,id desc);
-- Kunci permintaan (simpan ulang dengan kunci sama = hasil lama, tidak dobel).
create table role_settings_private.account_access_requests (
 request_key uuid primary key,
 actor uuid not null,
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
-- Izin tulis per transaksi, hanya dibuat oleh RPC simpan atomik (pola sama dengan role_settings_private.permits).
create table role_settings_private.account_access_permits (
 xid bigint not null, actor uuid not null, profile_id uuid not null,
 primary key(xid,actor,profile_id)
);
revoke all on role_settings_private.account_access_overrides, role_settings_private.account_access_override_history,
 role_settings_private.account_access_requests, role_settings_private.account_access_permits from public,anon,authenticated,service_role;
alter table role_settings_private.account_access_overrides enable row level security;
alter table role_settings_private.account_access_override_history enable row level security;
alter table role_settings_private.account_access_requests enable row level security;
alter table role_settings_private.account_access_permits enable row level security;

create trigger account_access_history_immutable before update or delete or truncate on role_settings_private.account_access_override_history
 for each statement execute function role_settings_private.audit_immutable();

-- ───────────── 2. Penjaga tulis: hanya lewat RPC simpan (atau akun dihapus = cascade) ─────────────
create function role_settings_private.account_access_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_profile uuid;
begin
 -- Pemeliharaan DBA native saja (sama dengan config_guard); service_role API bukan DBA.
 if auth.uid() is null and auth.role() is null
 and current_setting('role') in ('none','postgres')
 and exists(select 1 from pg_roles where rolname=session_user and rolsuper) then
   if tg_op='DELETE' then return old; else return new; end if;
 end if;
 if tg_op='TRUNCATE' then raise exception 'ACCOUNT_ACCESS_GUARD: akses khusus akun hanya diubah lewat simpan atomik.'; end if;
 -- Akun dihapus (cascade dari profiles): baris akses khususnya ikut hilang; riwayat tetap.
 if tg_op='DELETE' and not exists(select 1 from public.profiles where id=old.profile_id) then return old; end if;
 if tg_op='UPDATE' and old.profile_id<>new.profile_id then raise exception 'ACCOUNT_ACCESS_GUARD: akses khusus akun hanya diubah lewat simpan atomik.'; end if;
 v_profile:=case when tg_op='DELETE' then old.profile_id else new.profile_id end;
 if not exists(select 1 from role_settings_private.account_access_permits
   where xid=txid_current() and actor=auth.uid() and profile_id=v_profile) then
   raise exception 'ACCOUNT_ACCESS_GUARD: akses khusus akun hanya diubah lewat simpan atomik.';
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function role_settings_private.account_access_guard() from public,anon,authenticated,service_role;
create trigger account_access_guard before insert or update or delete on role_settings_private.account_access_overrides
 for each row execute function role_settings_private.account_access_guard();
create trigger account_access_truncate_guard before truncate on role_settings_private.account_access_overrides
 for each statement execute function role_settings_private.account_access_guard();

-- ───────────── 3. Validasi + normalisasi daftar menu ─────────────
-- Modul = katalog yang sama dengan save_role_access_config (14 modul + grup Operasional kasir/quest-staff/pos-shift).
-- Sub-menu = role_settings_private.submenu_catalog, wajib milik modulnya, tanpa duplikat. Daftar kosong ditolak
-- (modul tanpa halaman). Semua sub-menu dicentang = null (seluruh modul, termasuk sub-menu baru nanti).
create function role_settings_private.account_access_normalize(p_modules jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare e record; v_total integer; v_out jsonb:='{}'::jsonb;
begin
 if p_modules is null or jsonb_typeof(p_modules)<>'object' or p_modules='{}'::jsonb then
   raise exception using errcode='22023', message='ACCOUNT_ACCESS_MODULES_INVALID: pilih minimal satu menu.';
 end if;
 for e in select key, value from jsonb_each(p_modules) order by key loop
   if e.key not in ('dashboard','klinik','crm','hris','pengaturan','perusahaan','buku-besar','kas-bank','penjualan','pembelian','pos','aset-tetap','pajak','laporan','kasir','quest-staff','pos-shift') then
     raise exception using errcode='22023', message='ACCOUNT_ACCESS_MODULES_INVALID: menu tidak dikenal.';
   end if;
   select count(*) into v_total from role_settings_private.submenu_catalog c where c.module_id=e.key;
   if jsonb_typeof(e.value)='null' then v_out:=v_out||jsonb_build_object(e.key,null::jsonb); continue; end if;
   if jsonb_typeof(e.value)<>'array' or v_total=0
   or exists(select 1 from jsonb_array_elements(e.value) x where jsonb_typeof(x)<>'string'
      or not exists(select 1 from role_settings_private.submenu_catalog c where c.id=x#>>'{}' and c.module_id=e.key))
   or (select count(*)<>count(distinct x) from jsonb_array_elements(e.value) x) then
     raise exception using errcode='22023', message='ACCOUNT_ACCESS_MODULES_INVALID: sub-menu tidak dikenal atau ganda.';
   end if;
   if jsonb_array_length(e.value)=0 then
     raise exception using errcode='22023', message='ACCOUNT_ACCESS_MODULES_INVALID: menu dicentang tanpa satu pun sub-menu.';
   end if;
   v_out:=v_out||jsonb_build_object(e.key,case when jsonb_array_length(e.value)=v_total then null::jsonb
     else (select jsonb_agg(x order by x collate "C") from jsonb_array_elements_text(e.value) x) end);
 end loop;
 return v_out;
end $$;
revoke all on function role_settings_private.account_access_normalize(jsonb) from public,anon,authenticated,service_role;

-- ───────────── 4. Baca: akun sendiri (middleware/sidebar) ─────────────
-- Hanya baris milik pemanggil yang AKTIF dan bukan OWNER. Tidak ada baris = null = "Ikuti peran".
create function public.get_my_access_override() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('mode',o.mode,'modules',o.modules,'updated_at',o.updated_at)
 from public.profiles p
 join role_settings_private.account_access_overrides o on o.profile_id=p.id
 where p.id=auth.uid() and p.is_active and p.role<>'OWNER';
$$;
revoke all on function public.get_my_access_override() from public,anon,service_role;
grant execute on function public.get_my_access_override() to authenticated;

-- ───────────── 5. Baca: Owner melihat akun mana pun (layar Pengaturan › Pengguna) ─────────────
create function public.get_account_access_override(p_profile_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_target public.profiles;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null
 or not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active) then
   raise exception using errcode='42501', message='ACCOUNT_ACCESS_OWNER_REQUIRED: hanya pemilik aktif yang boleh melihat akses khusus akun.';
 end if;
 select * into v_target from public.profiles where id=p_profile_id;
 if not found then raise exception using errcode='22023', message='ACCOUNT_ACCESS_TARGET_INVALID: akun tidak ditemukan.'; end if;
 return jsonb_build_object(
  'profile_id',v_target.id,'role',v_target.role::text,'is_active',v_target.is_active,
  'override',(select jsonb_build_object('mode',o.mode,'modules',o.modules,'updated_at',o.updated_at,'updated_by',o.updated_by,
      'updated_by_name',(select a.full_name from public.profiles a where a.id=o.updated_by))
    from role_settings_private.account_access_overrides o where o.profile_id=v_target.id),
  'history',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'created_at',h.created_at,'created_by',h.created_by,
      'created_by_name',(select a.full_name from public.profiles a where a.id=h.created_by),'target_role',h.target_role::text,
      'reason',h.reason,'before',h.before,'after',h.after) order by h.created_at desc,h.id desc)
    from (select * from role_settings_private.account_access_override_history x where x.profile_id=v_target.id
          order by x.created_at desc,x.id desc limit 20) h),'[]'::jsonb));
end $$;
revoke all on function public.get_account_access_override(uuid) from public,anon,service_role;
grant execute on function public.get_account_access_override(uuid) to authenticated;

-- ───────────── 6. Simpan / hapus atomik (Owner saja) ─────────────
-- p_mode: 'ikuti' (hapus akses khusus; p_modules null/{}), 'tambah', 'khusus'. p_reason opsional (≤1000 huruf).
-- p_request_key opsional: kunci sama + isi sama = hasil lama (already_applied); kunci sama + isi beda = ditolak.
-- Simpan tanpa perubahan (isi sama dengan yang tersimpan) tidak menulis riwayat (changed=false).
create function public.save_account_access_override(p_profile_id uuid,p_mode text,p_modules jsonb default null,
 p_reason text default null,p_request_key uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' set lock_timeout='5s' as $$
declare v_actor uuid:=auth.uid(); v_role public.user_role; v_modules jsonb; v_reason text; v_payload jsonb;
 v_cached role_settings_private.account_access_requests; v_before jsonb; v_after jsonb; v_hist uuid; v_changed boolean; v_result jsonb;
begin
 if auth.role() is distinct from 'authenticated' or v_actor is null
 or not exists(select 1 from public.profiles where id=v_actor and role='OWNER' and is_active) then
   raise exception using errcode='42501', message='ACCOUNT_ACCESS_OWNER_REQUIRED: hanya pemilik aktif yang boleh mengatur akses khusus akun.';
 end if;
 if p_profile_id is null then raise exception using errcode='22023', message='ACCOUNT_ACCESS_TARGET_INVALID: akun tidak ditemukan.'; end if;
 if p_mode is null or p_mode not in ('ikuti','tambah','khusus') then
   raise exception using errcode='22023', message='ACCOUNT_ACCESS_MODE_INVALID: pilih Ikuti peran, Peran + tambahan, atau Hanya akses khusus.';
 end if;
 v_reason:=nullif(btrim(coalesce(p_reason,'')),'');
 if length(v_reason)>1000 then raise exception using errcode='22023', message='ACCOUNT_ACCESS_REASON_INVALID: alasan maksimal 1000 huruf.'; end if;
 if p_mode='ikuti' then
   if p_modules is not null and p_modules not in ('null'::jsonb,'{}'::jsonb) then
     raise exception using errcode='22023', message='ACCOUNT_ACCESS_MODULES_INVALID: "Ikuti peran" tidak memakai daftar menu.';
   end if;
 else
   v_modules:=role_settings_private.account_access_normalize(p_modules);
 end if;
 -- Satu akun satu antrean, lalu satu kunci permintaan satu antrean.
 perform pg_advisory_xact_lock(hashtextextended('account-access:'||p_profile_id::text,0));
 if p_request_key is not null then perform pg_advisory_xact_lock(hashtextextended('account-access-request:'||p_request_key::text,0)); end if;
 -- Akun tujuan dikunci (FOR SHARE) supaya perannya tidak berubah menjadi OWNER di tengah jalan.
 select role into v_role from public.profiles where id=p_profile_id for share;
 if not found then raise exception using errcode='22023', message='ACCOUNT_ACCESS_TARGET_INVALID: akun tidak ditemukan.'; end if;
 if v_role='OWNER' then
   raise exception using errcode='22023', message='ACCOUNT_ACCESS_TARGET_OWNER: akun OWNER selalu punya akses penuh dan tidak bisa diberi akses khusus.';
 end if;
 -- READ COMMITTED: perintah baru melihat pencabutan Owner yang terjadi selama menunggu kunci.
 if not exists(select 1 from public.profiles where id=v_actor and role='OWNER' and is_active) then
   raise exception using errcode='42501', message='ACCOUNT_ACCESS_OWNER_REQUIRED: hanya pemilik aktif yang boleh mengatur akses khusus akun.';
 end if;
 v_payload:=jsonb_build_object('profile_id',p_profile_id,'mode',p_mode,'modules',v_modules,'reason',v_reason);
 if p_request_key is not null then
   select * into v_cached from role_settings_private.account_access_requests where request_key=p_request_key;
   if found then
     if v_cached.actor<>v_actor or v_cached.payload<>v_payload then
       raise exception using errcode='22023', message='ACCOUNT_ACCESS_REQUEST_KEY_REUSED: permintaan ini sudah dipakai dengan isi berbeda. Muat ulang halaman.';
     end if;
     return v_cached.result||jsonb_build_object('already_applied',true);
   end if;
 end if;
 select jsonb_build_object('mode',o.mode,'modules',o.modules) into v_before
 from role_settings_private.account_access_overrides o where o.profile_id=p_profile_id for update;
 v_after:=case when p_mode='ikuti' then null else jsonb_build_object('mode',p_mode,'modules',v_modules) end;
 v_changed:=v_before is distinct from v_after;
 if v_changed then
   insert into role_settings_private.account_access_permits(xid,actor,profile_id) values(txid_current(),v_actor,p_profile_id);
   if v_after is null then
     delete from role_settings_private.account_access_overrides where profile_id=p_profile_id;
   else
     insert into role_settings_private.account_access_overrides(profile_id,mode,modules,updated_by,updated_at)
     values(p_profile_id,p_mode,v_modules,v_actor,clock_timestamp())
     on conflict(profile_id) do update set mode=excluded.mode,modules=excluded.modules,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
   end if;
   delete from role_settings_private.account_access_permits where xid=txid_current() and actor=v_actor and profile_id=p_profile_id;
   insert into role_settings_private.account_access_override_history(profile_id,created_by,target_role,reason,before,after,request_key)
   values(p_profile_id,v_actor,v_role,v_reason,v_before,v_after,p_request_key) returning id into v_hist;
 end if;
 v_result:=jsonb_build_object('profile_id',p_profile_id,'mode',p_mode,'modules',v_modules,'changed',v_changed,
   'history_id',v_hist,'request_key',p_request_key,'already_applied',false);
 if p_request_key is not null then
   insert into role_settings_private.account_access_requests(request_key,actor,payload,result) values(p_request_key,v_actor,v_payload,v_result);
 end if;
 return v_result;
end $$;
revoke all on function public.save_account_access_override(uuid,text,jsonb,text,uuid) from public,anon,service_role;
grant execute on function public.save_account_access_override(uuid,text,jsonb,text,uuid) to authenticated;

-- ───────────── 7. Log Aktifitas (metadata saja; isi sebelum/sesudah ada di riwayat di atas) ─────────────
insert into public.activity_log_sources
 (entity,module_id,scope_kind,identity_keys,branch_columns,scope_parents,parent_entity,parent_key,metadata_only)
values ('account_access_overrides','pengaturan','all',array['profile_id'],'{}','[]',null,null,true);
create trigger a01_activity_change after insert or update on role_settings_private.account_access_overrides
 for each row execute function public.capture_activity_log();
create trigger a01_activity_delete before delete on role_settings_private.account_access_overrides
 for each row execute function public.capture_activity_log();

-- ───────────── 8. USULAN DB untuk Penjualan Online (DITANDAI untuk ditinjau lead) ─────────────
-- Temuan: order online (post_online_order, scope 'online') dan pencairan (online_disburse_batch) memanggil
-- sales_assert_access() → sales_module_access(), yang mensyaratkan PERAN punya modul 'penjualan' di role_modules
-- (atau ADMIN/DOCTOR bawaan). STAFF bawaan tidak punya, jadi akun STAFF dengan akses khusus Penjualan Online bisa
-- MEMBUKA halamannya tetapi setiap simpan ditolak "Dokumen penjualan tidak ditemukan atau tidak dapat diakses."
-- Perubahan: sales_module_access() juga benar bila Owner memberi akun AKTIF (bukan OWNER) modul Penjualan (sub-menu
-- apa pun) lewat akses khusus akun. Ini setara dengan memberi modul Penjualan ke peran lewat Akses Grup (gerbang
-- database itu memang tingkat modul, sub-menu hanya menu), tetapi hanya untuk akun yang dipilih Owner dan tercatat.
-- TIDAK menyentuh RLS, akses cabang (user_can_access_branch tetap wajib), action_policies, atau role_action_allowed.
-- Gerbang modul lain (pembelian, persediaan, klinik, kas/bank, ...) TIDAK diubah: centang modul itu lewat akses khusus
-- hanya membuka menunya. Dipatch lewat jangkar teks persis satu kali; bila definisi produksi berbeda, transaksi gagal.
do $patch$
declare v text; v_anchor text:=$a$    or (p.role in ('ADMIN','DOCTOR') and not exists(select 1 from public.role_modules m where m.role=p.role))$a$;
begin
 v:=pg_get_functiondef('public.sales_module_access()'::regprocedure);
 if (length(v)-length(replace(v,v_anchor,'')))/length(v_anchor)<>1 then
   raise exception 'E3_MIGRATION_ANCHOR_MISMATCH: sales_module_access';
 end if;
 v:=replace(v,v_anchor,v_anchor||E'\n    -- E3 (meeting 12 Nov 2026): akses khusus akun yang memberi modul Penjualan (lihat 20261117200000).\n'
   ||$b$    or (p.role<>'OWNER' and exists(select 1 from role_settings_private.account_access_overrides o where o.profile_id=p.id and o.modules ? 'penjualan'))$b$);
 execute v;
end $patch$;
