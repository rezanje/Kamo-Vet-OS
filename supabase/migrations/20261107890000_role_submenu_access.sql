-- Sub-menu access per role (Akses Grup level 2): a role granted a module may be limited to some of its sub-menus.
-- apply as ONE transaction (the Supabase CLI runs this file in one; there is no begin/commit in it).
--
-- Design (navigation/page authorization only):
--  * No policy row for (role, module) = every sub-menu of that module, exactly as before this migration.
--    Installing this file changes nobody's access and no existing revision (the revision hash only gains
--    the new key when a policy exists).
--  * Policies live in role_settings_private (same architecture as the action policies): written ONLY by the
--    atomic save_role_access_config RPC under the existing permit/guard, revision, request key, epoch and audit.
--  * The app reads the caller's own rows through get_my_submenu_policy(). If the app is deployed BEFORE this
--    migration the missing function is treated as "no policy" (today's behaviour); any other read failure fails closed.
--  * DB-level RLS and role_action_allowed are NOT touched.
-- Anchored and additive: the two existing functions are patched by exact text anchors that must each occur exactly
-- once; otherwise the whole transaction fails closed.
set local lock_timeout='5s';

create table role_settings_private.submenu_catalog (
 id text primary key check (id ~ '^[a-z][a-z-]*\.[a-z][a-z0-9-]*$'),
 module_id text not null,
 check (split_part(id,'.',1)=module_id)
);
create table role_settings_private.submenu_policies (
 role public.user_role not null check (role<>'OWNER'),
 module_id text not null,
 allowed text[] not null,
 primary key (role,module_id)
);
insert into role_settings_private.submenu_catalog(id,module_id) values
('klinik.registrasi','klinik'),
('klinik.antrian','klinik'),
('klinik.rekam-medis','klinik'),
('klinik.impor-rekam-medis','klinik'),
('klinik.rawat-inap','klinik'),
('klinik.racik','klinik'),
('klinik.aturan-demo','klinik'),
('klinik.persetujuan','klinik'),
('klinik.follow-up','klinik'),
('klinik.bahan-baku','klinik'),
('klinik.katalog-racikan','klinik'),
('klinik.jadwal-dokter','klinik'),
('klinik.maintenance','klinik'),
('klinik.booking','klinik'),
('klinik.penerimaan','klinik'),
('klinik.pembayaran','klinik'),
('klinik.shift','klinik'),
('klinik.pengeluaran','klinik'),
('klinik.permintaan','klinik'),
('crm.promo','crm'),
('crm.pelanggan','crm'),
('crm.kategori-pelanggan','crm'),
('crm.status-ulasan','crm'),
('crm.kampanye','crm'),
('hris.karyawan','hris'),
('hris.absensi','hris'),
('hris.jadwal','hris'),
('hris.penggajian','hris'),
('hris.cuti','hris'),
('hris.pengajuan','hris'),
('hris.kpi','hris'),
('hris.komponen-gaji','hris'),
('hris.shift','hris'),
('pengaturan.akses-grup','pengaturan'),
('pengaturan.pengguna','pengaturan'),
('pengaturan.penomoran','pengaturan'),
('pengaturan.penyetuju','pengaturan'),
('pengaturan.cabang','pengaturan'),
('pengaturan.tier','pengaturan'),
('pengaturan.gaji','pengaturan'),
('pengaturan.operasional-klinik','pengaturan'),
('pengaturan.alert-operasional','pengaturan'),
('pengaturan.wa-engine','pengaturan'),
('pengaturan.impor','pengaturan'),
('perusahaan.cabang','perusahaan'),
('perusahaan.gudang','perusahaan'),
('perusahaan.log-aktifitas','perusahaan'),
('buku-besar.coa','buku-besar'),
('buku-besar.jurnal','buku-besar'),
('buku-besar.jurnal-berulang','buku-besar'),
('buku-besar.histori-akun','buku-besar'),
('buku-besar.tutup-buku','buku-besar'),
('buku-besar.closing-hpp','buku-besar'),
('buku-besar.saldo-awal','buku-besar'),
('buku-besar.saldo-awal-faktur','buku-besar'),
('buku-besar.sinkron','buku-besar'),
('buku-besar.monitor-anggaran','buku-besar'),
('buku-besar.transfer-anggaran','buku-besar'),
('buku-besar.anggaran','buku-besar'),
('buku-besar.log','buku-besar'),
('buku-besar.beban','buku-besar'),
('kas-bank.hutang','kas-bank'),
('kas-bank.hutang-pembantu','kas-bank'),
('kas-bank.piutang','kas-bank'),
('kas-bank.piutang-pembantu','kas-bank'),
('kas-bank.kas-keluar','kas-bank'),
('kas-bank.kas-masuk','kas-bank'),
('kas-bank.transfer','kas-bank'),
('kas-bank.rekonsiliasi','kas-bank'),
('kas-bank.rekening','kas-bank'),
('kas-bank.peta','kas-bank'),
('kas-bank.refund','kas-bank'),
('penjualan.rekap','penjualan'),
('penjualan.penawaran','penjualan'),
('penjualan.pesanan','penjualan'),
('penjualan.pengiriman','penjualan'),
('penjualan.uang-muka','penjualan'),
('penjualan.faktur','penjualan'),
('penjualan.retur','penjualan'),
('penjualan.retur-grosir','penjualan'),
('penjualan.komisi','penjualan'),
('penjualan.target','penjualan'),
('penjualan.online','penjualan'),
('pembelian.pesanan','pembelian'),
('pembelian.penerimaan','pembelian'),
('pembelian.uang-muka','pembelian'),
('pembelian.faktur','pembelian'),
('pembelian.faktur-langsung','pembelian'),
('pembelian.retur','pembelian'),
('pembelian.kategori-pemasok','pembelian'),
('pembelian.perintah-bayar','pembelian'),
('pembelian.koreksi','pembelian'),
('pos.permintaan','pos'),
('pos.pemindahan','pos'),
('pos.penyesuaian','pos'),
('pos.produksi','pos'),
('pos.opname','pos'),
('pos.sku','pos'),
('pos.sku-varian','pos'),
('pos.sku-impor','pos'),
('pos.harga','pos'),
('pos.satuan','pos'),
('pos.kategori','pos'),
('pos.merek','pos'),
('pos.stok-minimum','pos'),
('pos.stok','pos'),
('pos.kartu-stok','pos'),
('pos.expired','pos'),
('pos.transaksi','pos'),
('pos.expense','pos'),
('aset-tetap.aset','aset-tetap'),
('aset-tetap.kategori-aset','aset-tetap'),
('aset-tetap.kategori-aset-pajak','aset-tetap'),
('pajak.mode-pkp','pajak'),
('pajak.rekap-ppn','pajak'),
('laporan.operasional-penjualan','laporan'),
('laporan.pelanggan-teratas','laporan'),
('laporan.jadwal-anabul','laporan'),
('laporan.absensi','laporan'),
('laporan.gaji','laporan'),
('laporan.penjualan-rinci','laporan'),
('laporan.penjualan-barang','laporan'),
('laporan.penjualan-kasir','laporan'),
('laporan.transaksi-cabang','laporan'),
('laporan.pelanggan-harian','laporan'),
('laporan.akuisisi','laporan'),
('laporan.pembelian','laporan'),
('laporan.penjual','laporan'),
('laporan.anamnesa','laporan'),
('laporan.retensi','laporan'),
('laporan.promo','laporan'),
('laporan.rekap-klinik','laporan'),
('laporan.member','laporan'),
('laporan.kpi','laporan'),
('laporan.hasil-opname','laporan'),
('laporan.margin-racikan','laporan'),
('laporan.nilai-persediaan','laporan'),
('laporan.laba-rugi','laporan'),
('laporan.neraca','laporan'),
('laporan.neraca-saldo','laporan'),
('laporan.arus-kas','laporan'),
('laporan.arus-kas-rincian','laporan');
revoke all on role_settings_private.submenu_catalog, role_settings_private.submenu_policies from public,anon,authenticated,service_role;
alter table role_settings_private.submenu_catalog enable row level security;
alter table role_settings_private.submenu_policies enable row level security;
create trigger submenu_policy_guard before insert or update or delete on role_settings_private.submenu_policies
 for each row execute function role_settings_private.config_guard();
create trigger submenu_policy_truncate_guard before truncate on role_settings_private.submenu_policies
 for each statement execute function role_settings_private.config_guard();

create function role_settings_private.patch_once(p_def text,p_old text,p_new text,p_label text) returns text
language plpgsql immutable set search_path='' as $$
begin
 if p_old is null or length(p_old)=0 or (length(p_def)-length(replace(p_def,p_old,'')))/length(p_old)<>1 then
   raise exception 'SUBMENU_MIGRATION_ANCHOR_MISMATCH: %',p_label;
 end if;
 return replace(p_def,p_old,p_new);
end $$;

do $patch$
declare v text;
begin
 -- snapshot(): revision hash and output gain the sub-menu policy (absent policy keeps the old hash bit-for-bit).
 v:=pg_get_functiondef('role_settings_private.snapshot(text)'::regprocedure);
 v:=role_settings_private.patch_once(v,$a$md5(jsonb_build_object('modules',e.modules_raw,$a$,$b$md5((jsonb_build_object('modules',e.modules_raw,$b$,'snapshot hash open');
 v:=role_settings_private.patch_once(v,$a$(select epoch from role_settings_private.epochs where role::text=p_role))::text),$a$,
  $b$(select epoch from role_settings_private.epochs where role::text=p_role)) || coalesce((select jsonb_build_object('submenus',jsonb_object_agg(s.module_id,to_jsonb(s.allowed) order by s.module_id)) from role_settings_private.submenu_policies s where s.role::text=p_role having count(*)>0),'{}'::jsonb))::text),$b$,'snapshot hash close');
 v:=role_settings_private.patch_once(v,$a$from effective e;$a$,
  $b$|| jsonb_build_object('submenus',coalesce((select jsonb_object_agg(s.module_id,to_jsonb(s.allowed) order by s.module_id) from role_settings_private.submenu_policies s where s.role::text=p_role),'{}'::jsonb)) from effective e;$b$,'snapshot output');
 execute v;

 -- save_role_access_config(): one extra optional argument. The old 8-argument overload is replaced (never both: PostgREST would see ambiguity).
 v:=pg_get_functiondef('public.save_role_access_config(text,text,uuid,text,jsonb,jsonb,text,jsonb)'::regprocedure);
 v:=role_settings_private.patch_once(v,$a$p_actions jsonb DEFAULT NULL::jsonb)$a$,$b$p_actions jsonb DEFAULT NULL::jsonb, p_submenus jsonb DEFAULT NULL::jsonb)$b$,'save signature');
 v:=role_settings_private.patch_once(v,$a$if p_role is null or p_role not in ('ADMIN','FINANCE','STAFF','DOCTOR') then raise exception 'ROLE_SCOPE_INVALID'; end if;$a$,
  $b$p_submenus:=nullif(p_submenus,'null'::jsonb);
 if p_role is null or p_role not in ('ADMIN','FINANCE','STAFF','DOCTOR') then raise exception 'ROLE_SCOPE_INVALID'; end if;$b$,'save normalise null');
 v:=role_settings_private.patch_once(v,$a$or (p_capabilities is not null and p_capabilities<>'null'::jsonb) then$a$,
  $b$or (p_capabilities is not null and p_capabilities<>'null'::jsonb) or p_submenus is not null then$b$,'save reset refuses submenus');
 v:=role_settings_private.patch_once(v,$a$-- Role before global request key, never profile-row before role wait.$a$,
  $b$-- Sub-menu policy: object {module:[ids]}; every id in the catalogue AND of that module; module granted in p_modules; no duplicates.
 if p_submenus is not null then
   if jsonb_typeof(p_submenus)<>'object' or exists(
     select 1 from jsonb_each(p_submenus) e
     where not exists(select 1 from role_settings_private.submenu_catalog c where c.module_id=e.key)
     or not exists(select 1 from jsonb_array_elements_text(p_modules) m where m=e.key)
     or jsonb_typeof(e.value)<>'array'
     or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(e.value)='array' then e.value else '[]'::jsonb end) x
        where jsonb_typeof(x)<>'string' or not exists(select 1 from role_settings_private.submenu_catalog c where c.id=x#>>'{}' and c.module_id=e.key))
     or (select count(*)<>count(distinct x) from jsonb_array_elements(case when jsonb_typeof(e.value)='array' then e.value else '[]'::jsonb end) x)
   ) then raise exception 'ROLE_SUBMENU_INVALID'; end if;
 end if;
 -- Role before global request key, never profile-row before role wait.$b$,'save submenu validation');
 v:=role_settings_private.patch_once(v,$a$'reason',p_reason,'actions',p_actions);$a$,
  $b$'reason',p_reason,'actions',p_actions)
 || case when p_submenus is null then '{}'::jsonb else jsonb_build_object('submenus',p_submenus) end;$b$,'save payload');
 v:=role_settings_private.patch_once(v,$a$update role_settings_private.epochs set epoch=epoch+1 where role::text=p_role;$a$,
  $b$if p_mode='reset' then
   delete from role_settings_private.submenu_policies where role::text=p_role;
 elsif p_submenus is not null then
   delete from role_settings_private.submenu_policies where role::text=p_role;
   -- a fully-ticked module is "all sub-menus" = no row; an empty list is kept (module not accessible)
   insert into role_settings_private.submenu_policies(role,module_id,allowed)
   select p_role::public.user_role,e.key,array(select x from jsonb_array_elements_text(e.value) x order by x collate "C")
   from jsonb_each(p_submenus) e
   where (select count(*) from role_settings_private.submenu_catalog c where c.module_id=e.key)<>jsonb_array_length(e.value);
 else
   -- an older page that does not send sub-menus: keep policies of retained modules, drop those of removed modules (no resurrection)
   delete from role_settings_private.submenu_policies s where s.role::text=p_role
   and not exists(select 1 from jsonb_array_elements_text(p_modules) m where m=s.module_id);
 end if;
 update role_settings_private.epochs set epoch=epoch+1 where role::text=p_role;$b$,'save writes');
 execute v;
end $patch$;
drop function role_settings_private.patch_once(text,text,text,text);
drop function public.save_role_access_config(text,text,uuid,text,jsonb,jsonb,text,jsonb);
revoke all on function public.save_role_access_config(text,text,uuid,text,jsonb,jsonb,text,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.save_role_access_config(text,text,uuid,text,jsonb,jsonb,text,jsonb,jsonb) to authenticated;

-- The caller's own policy (role of the ACTIVE caller only; OWNER never has rows). Read by middleware/layout.
create function public.get_my_submenu_policy() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('role',p.role::text,'module_id',s.module_id,'allowed',to_jsonb(s.allowed)) order by s.module_id),'[]'::jsonb)
 from public.profiles p
 join role_settings_private.submenu_policies s on s.role=p.role
 where p.id=auth.uid() and p.is_active and p.role<>'OWNER';
$$;
revoke all on function public.get_my_submenu_policy() from public,anon,service_role;
grant execute on function public.get_my_submenu_policy() to authenticated;
