-- Rekap Setoran (migrasi *_rekap_setoran): fictional fixtures in disposable PostgreSQL only; everything rolls back.
-- Dibuktikan: ACL/RLS (klien tidak membaca tabel), privasi staf (tanpa selisih/lebih/catatan penyetuju), periode+kewajiban per hari dari shift tertutup,
-- selisih tutup shift tidak dihitung dua kali, pengeluaran dari dana setoran (diposting saat disetujui lewat post_expense_atomic, tepat sekali, tanggal barisnya),
-- transfer parsial + konfirmasi Finance, pemisahan tugas, kurang -> kasbon (182001) per karyawan, lebih -> 810004, pas -> tanpa jurnal, beban perusahaan, pembulatan,
-- tutup buku, idempotensi, void dengan pembalik, rekap/umur, Admin Online ditolak di semua fungsi, jejak tak dapat diubah.
begin;
create function pg_temp.ok(value boolean, label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;raise notice 'BP_PASS %',label;end$$;
create function pg_temp.reject(stmt text, expected text, label text) returns void language plpgsql as $$
declare failed boolean:=false;msg text;begin
 begin execute stmt;exception when others then failed:=true;msg:=sqlerrm;end;
 if not failed then raise exception 'Expected rejection: %',label;end if;
 if position(expected in msg)=0 then raise exception 'Unexpected rejection for %: %',label,msg;end if;
 raise notice 'BP_PASS %',label;
end$$;
create function pg_temp.u(n text) returns uuid language sql immutable as $$select ('e5100000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.as_(n text) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.u(n)::text,true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);end$$;
create function pg_temp.noauth() returns void language sql as $$select set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true)$$;
create function pg_temp.today() returns date language sql as $$select (now() at time zone 'Asia/Jakarta')::date$$;
create function pg_temp.kk(name text) returns uuid language sql immutable as $$select md5('e5-'||name)::uuid$$;
create function pg_temp.try(stmt text) returns text language plpgsql as $$
begin
 begin execute stmt;raise exception 'TRY_OK';
 exception when others then return case when sqlerrm='TRY_OK' then 'OK' else sqlerrm end;end;
end$$;
create temp table res(name text primary key,r jsonb);grant all on res to public;
create function pg_temp.save(name text,v jsonb) returns void language sql as $$insert into res values($1,$2) on conflict(name) do update set r=excluded.r$$;
create function pg_temp.sid(name text) returns uuid language sql security definer as $$select (r->>'id')::uuid from res where res.name=$1$$;
create function pg_temp.rev(name text) returns integer language sql security definer as $$select revision from public.setoran where id=(select (r->>'id')::uuid from res where res.name=$1)$$;
create function pg_temp.st(name text) returns text language sql security definer as $$select status from public.setoran where id=(select (r->>'id')::uuid from res where res.name=$1)$$;
create function pg_temp.sv(stmt text) returns text language plpgsql security definer as $$declare r text;begin execute stmt into r;return r;end$$;
create function pg_temp.svn(stmt text) returns numeric language plpgsql security definer as $$declare r numeric;begin execute stmt into r;return r;end$$;
create function pg_temp.lamp(s uuid,k text) returns jsonb language plpgsql security definer as $$
declare br uuid;p text;begin
 select branch_id into br from public.setoran where id=s;p:='setoran/'||br::text||'/'||md5(k)||'.jpg';
 insert into storage.objects(bucket_id,name,owner_id) select 'dokumen',p,coalesce(auth.uid()::text,'sistem') where not exists(select 1 from storage.objects where bucket_id='dokumen' and name=p);
 return jsonb_build_array(jsonb_build_object('path',p,'nama','e5.jpg','mime','image/jpeg','ukuran',100));end$$;
create function pg_temp.jn(src text,ref uuid) returns integer language sql security definer as $$select count(*)::int from public.journal_entries where source=src and source_ref=ref::text$$;
create function pg_temp.jline(src text,ref uuid,p_code text) returns numeric language sql security definer as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.coa_accounts a on a.id=l.account_id join public.journal_entries j on j.id=l.entry_id where j.source=src and j.source_ref=ref::text and a.code=p_code$$;
create function pg_temp.jdate(src text,ref uuid) returns date language sql security definer as $$select tanggal from public.journal_entries where source=src and source_ref=ref::text limit 1$$;
create function pg_temp.balanced() returns boolean language sql security definer as $$select not exists(select 1 from public.journal_lines group by entry_id having sum(debit-credit)<>0)$$;
create function pg_temp.njr() returns integer language sql security definer as $$select count(*)::int from public.journal_entries$$;
create function pg_temp.nexp() returns integer language sql security definer as $$select count(*)::int from public.expenses$$;
create function pg_temp.mk_shift(br uuid,opener text,dayoff int,opening numeric,closing numeric,typ text default 'petshop',expc numeric default null) returns uuid language plpgsql security definer as $$
declare id uuid:=gen_random_uuid();d date:=(now() at time zone 'Asia/Jakarta')::date-dayoff;
begin
 perform set_config('request.jwt.claims','{}',true);perform set_config('request.jwt.claim.sub','',true);
 insert into public.cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance,opened_at,closing_balance,expected_cash,selisih,closed_at,status,closing_breakdown)
 values(id,br,pg_temp.u(opener),typ,opening,((d::timestamp+time '08:00') at time zone 'Asia/Jakarta'),closing,coalesce(expc,closing),closing-coalesce(expc,closing),((d::timestamp+time '17:00') at time zone 'Asia/Jakarta'),'closed',jsonb_build_object('Tunai',closing-opening));
 return id;
end$$;
create function pg_temp.numeric_of(j jsonb,k text) returns numeric language sql immutable as $$select (j->>k)::numeric$$;

insert into storage.buckets(id,name,public) values('dokumen','dokumen',false) on conflict do nothing;
-- ── fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into auth.users(id,raw_user_meta_data) select pg_temp.u(n),jsonb_build_object('full_name','STR '||n) from unnest(array['01','02','03','04','05','06','07','08','09','0a','0b','0c']) n;
update profiles set role='OWNER',is_active=true where id=pg_temp.u('01');
update profiles set role='ADMIN',is_active=true where id in(pg_temp.u('02'),pg_temp.u('0a'));
update profiles set role='FINANCE',is_active=true where id in(pg_temp.u('03'),pg_temp.u('0c'));
update profiles set role='STAFF',is_active=true where id in(pg_temp.u('04'),pg_temp.u('05'),pg_temp.u('07'),pg_temp.u('08'));
update profiles set role='ADMIN_ONLINE',is_active=true where id=pg_temp.u('06');
update profiles set role='FINANCE',is_active=false where id=pg_temp.u('09');
update profiles set role='DOCTOR',is_active=true where id=pg_temp.u('0b');
insert into role_capabilities(role,all_branches,create_accounts) values('ADMIN',false,false),('FINANCE',false,false) on conflict(role) do update set all_branches=false;
insert into role_modules(role,module_id) values('STAFF','pos'),('ADMIN','pos'),('FINANCE','pos'),('DOCTOR','klinik') on conflict do nothing;
insert into branches(id,code,name,type) values
 ('e5200000-0000-4000-8000-00000000000a','STRA','STR petshop A','PETSHOP'),('e5200000-0000-4000-8000-00000000000b','STRK','STR klinik K','KLINIK'),
 ('e5200000-0000-4000-8000-00000000000c','STRC','STR cabang C','PETSHOP'),('e5200000-0000-4000-8000-00000000000d','STRD','STR cabang D','PETSHOP'),
 ('e5200000-0000-4000-8000-00000000000e','STRE','STR cabang E','PETSHOP'),('e5200000-0000-4000-8000-00000000000f','STRF','STR cabang F','PETSHOP'),
 ('e5200000-0000-4000-8000-0000000000a1','STRG','STR cabang G','PETSHOP'),('e5200000-0000-4000-8000-0000000000a2','STRH','STR cabang H','PETSHOP'),
 ('e5200000-0000-4000-8000-0000000000a3','STRI','STR cabang I','PETSHOP'),('e5200000-0000-4000-8000-0000000000a4','STRJ','STR cabang J','PETSHOP'),
 ('e5200000-0000-4000-8000-0000000000b1','STRX','STR cabang lain','PETSHOP');

insert into user_branches(user_id,branch_id)
 select pg_temp.u(n),b.id from unnest(array['02','03','04','05','07','0c']) n cross join branches b where b.code in ('STRA','STRK','STRC','STRD','STRE','STRF','STRG','STRH','STRI','STRJ');
insert into user_branches(user_id,branch_id) values(pg_temp.u('0a'),'e5200000-0000-4000-8000-0000000000b1'),(pg_temp.u('08'),'e5200000-0000-4000-8000-0000000000b1'),
 (pg_temp.u('06'),'e5200000-0000-4000-8000-00000000000a'),(pg_temp.u('09'),'e5200000-0000-4000-8000-00000000000a'),(pg_temp.u('0b'),'e5200000-0000-4000-8000-00000000000b');
insert into employees(id,nama,profile_id,status) values
 ('e5300000-0000-4000-8000-000000000001','Kasir Satu',pg_temp.u('04'),'Aktif'),('e5300000-0000-4000-8000-000000000002','Kasir Dua',pg_temp.u('05'),'Aktif'),
 ('e5300000-0000-4000-8000-000000000003','Budi Pengganti',null,'Aktif'),('e5300000-0000-4000-8000-000000000004','Karyawan Resign',null,'Resign');
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active,parent_id) values
 ('1191','STR laci A','ASET','D',false,true,null),('1193','STR laci K','ASET','D',false,true,null),('1195','STR kas finance','ASET','D',false,true,null),
 ('1192','STR bank utama','ASET','D',false,true,(select id from coa_accounts where code='120000')),('1199','STR bank palsu','ASET','D',false,true,null),('1196','STR bank mati','ASET','D',false,true,(select id from coa_accounts where code='120000')),('1197','STR bank cabang lain','ASET','D',false,true,(select id from coa_accounts where code='120000'))
 on conflict(code) do update set is_active=true,is_header=false;
update coa_accounts set parent_id=(select id from coa_accounts where code='120000') where code='1192';
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active) select c,'STR '||c,'BEBAN','D',false,true from unnest(array['720002','740003','760003','740001']) c on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code,is_active,branch_id) values
 ('e5500000-0000-4000-8000-000000000001','STR laci A','Kas','1191',true,'e5200000-0000-4000-8000-00000000000a'),
 ('e5500000-0000-4000-8000-000000000002','STR laci K','Kas','1193',true,'e5200000-0000-4000-8000-00000000000b'),
 ('e5500000-0000-4000-8000-000000000003','STR kas finance','Kas','1195',true,null),
 ('e5500000-0000-4000-8000-000000000004','STR bank utama','Bank','1192',true,null),
 ('e5500000-0000-4000-8000-000000000005','STR bank palsu','Bank','1199',true,null),
 ('e5500000-0000-4000-8000-000000000006','STR bank mati','Bank','1196',false,null),
 ('e5500000-0000-4000-8000-000000000007','STR bank cabang lain','Bank','1197',true,'e5200000-0000-4000-8000-0000000000b1');
insert into payment_account_map(metode,branch_id,cash_account_id) values
 ('Tunai','e5200000-0000-4000-8000-00000000000a','e5500000-0000-4000-8000-000000000001'),('Tunai','e5200000-0000-4000-8000-00000000000b','e5500000-0000-4000-8000-000000000002') on conflict do nothing;
update accounting_locks set closed_until=null;

-- ── 0. objek baru, ACL, RLS ─────────────────────────────────────────────────────────────────────
select pg_temp.ok((select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relname in('setoran','setoran_shift','setoran_keuangan','setoran_pengeluaran','setoran_transfer','setoran_kasbon','setoran_event','setoran_permintaan') and c.relrowsecurity)=8,'8 tabel setoran ada dan RLS aktif semuanya');
select pg_temp.ok(not has_table_privilege('authenticated','public.'||t,'select') and not has_table_privilege('anon','public.'||t,'select') and not has_table_privilege('authenticated','public.'||t,'insert') and not has_table_privilege('authenticated','public.'||t,'update') and not has_table_privilege('authenticated','public.'||t,'delete') and not has_table_privilege('service_role','public.'||t,'select'),'ACL tabel '||t||': klien (authenticated/anon/service_role) tanpa hak langsung')
 from unnest(array['setoran','setoran_shift','setoran_keuangan','setoran_pengeluaran','setoran_transfer','setoran_kasbon','setoran_event','setoran_permintaan']) t;
select pg_temp.ok(not has_function_privilege('authenticated',('public.'||f)::regprocedure,'execute') and not has_function_privilege('anon',('public.'||f)::regprocedure,'execute') and not has_function_privilege('service_role',('public.'||f)::regprocedure,'execute'),'fungsi internal '||f||' tidak bisa dipanggil klien')
 from unnest(array['setoran_role()','setoran_penyetuju()','setoran_hitung(uuid)','setoran_angka(uuid)','setoran_log(uuid,text,text,text,text,jsonb)','setoran_ulang(uuid,text,jsonb)','setoran_simpan_permintaan(uuid,text,jsonb,jsonb)','setoran_akses_cabang(uuid)','setoran_periode_terbuka(date)','setoran_sinkron_inti(uuid)','setoran_akun_valid(uuid,uuid,text)','setoran_penanggung(uuid)','setoran_rincian_live(uuid)','setoran_shift_layak(uuid)']) f;
select pg_temp.ok(has_function_privilege('authenticated',('public.'||f)::regprocedure,'execute') and not has_function_privilege('anon',('public.'||f)::regprocedure,'execute') and not has_function_privilege('service_role',('public.'||f)::regprocedure,'execute') and not exists(select 1 from pg_proc p where p.oid=('public.'||f)::regprocedure and exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0)),'RPC '||f||': hanya authenticated (bukan anon/public/service_role)')
 from unnest(array['setoran_akses()','setoran_rekening_tujuan(uuid)','setoran_buat(uuid,date,date,date,text,uuid)','setoran_sinkron(uuid)','setoran_tambah_pengeluaran(uuid,date,text,numeric,text,jsonb,integer,uuid)','setoran_hapus_pengeluaran(uuid,uuid,integer,uuid)','setoran_tambah_transfer(uuid,date,numeric,text,uuid,jsonb,text,integer,uuid)','setoran_hapus_transfer(uuid,uuid,integer,uuid)','setoran_putuskan_transfer(uuid,uuid,boolean,text,uuid)','setoran_ajukan(uuid,integer,uuid)','setoran_batalkan_draft(uuid,text,uuid)','setoran_tolak(uuid,text,uuid)','setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)','setoran_void(uuid,text,uuid)','setoran_daftar(date,date,uuid,text,uuid)','setoran_detail(uuid)','setoran_rekap(date,date,uuid,text,uuid)','setoran_so_terakhir(uuid)']) f;
select pg_temp.ok((select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like 'setoran\_%' or p.proname like 'guard\_setoran%') and p.prosecdef)>=30,'fungsi setoran SECURITY DEFINER (>= 30)');
select pg_temp.ok(not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'setoran\_%' and p.prosecdef and not ('search_path=""'=any(coalesce(p.proconfig,'{}')))),'semua fungsi SECURITY DEFINER setoran memakai search_path kosong');
select pg_temp.ok(not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'setoran\_%' and p.prosecdef and has_function_privilege('authenticated',p.oid,'execute') and p.prosrc !~ 'deny_admin_online' and p.proname not in ('setoran_jurnal_boleh','setoran_jurnal_tersembunyi','setoran_berkas_boleh','setoran_berkas_boleh_hapus')),'semua RPC setoran yang bisa dipanggil klien memuat penjaga deny_admin_online');
select pg_temp.ok((select count(*) from pg_trigger where tgname like 'setoran%' and not tgisinternal)>=13,'trigger penjaga setoran terpasang (>= 13)');
select pg_temp.ok(exists(select 1 from pg_policy where polrelid='public.setoran'::regclass and polname='admin_online_fence_r') and exists(select 1 from pg_trigger where tgrelid='public.setoran_transfer'::regclass and tgname='zz_admin_online_write_fence'),'pagar Admin Online (kebijakan baca + pemicu tulis) terpasang pada tabel setoran');
select pg_temp.ok(position('post_expense_atomic' in pg_get_functiondef('public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)'::regprocedure))>0 and position('INSERT INTO public.expenses' in upper(pg_get_functiondef('public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)'::regprocedure)))=0,'pengeluaran diposting HANYA lewat post_expense_atomic (tidak ada INSERT langsung ke expenses)');
select pg_temp.ok(not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'setoran\_%' and p.prosrc ~* 'insert into public\.expenses'),'tidak ada fungsi setoran yang menulis expenses langsung');

select pg_temp.ok(exists(select 1 from role_settings_private.submenu_catalog where id='kas-bank.setoran' and module_id='kas-bank'),'katalog Akses Grup memuat sub-menu kas-bank.setoran');
-- ── fixture shift & periode ─────────────────────────────────────────────────────────────────────
-- Cabang A: 3 shift tertutup. S1 punya selisih tutup shift (+50.000) yang SUDAH dijurnal tutup shift; kewajiban memakai closing-opening.
select pg_temp.save('sA1',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-00000000000a','04',5,500000,2300000,'petshop',2250000)));
select pg_temp.save('sA2',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-00000000000a','05',4,500000,1200000)));
select pg_temp.save('sA3',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-00000000000a','04',3,100000,600000)));
-- pengeluaran tunai yang sudah diinput lewat kasir saat shift S1 (informasi saja; sudah mengurangi closing_balance)
insert into expenses(branch_id,tanggal,kategori,deskripsi,jumlah,metode_bayar,shift_id,created_by) values('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-5,'Operasional','galon dari kasir',50000,'Tunai',pg_temp.sid('sA1'),pg_temp.u('04'));
-- Cabang K (klinik): satu shift klinik, lebih
select pg_temp.save('sK1',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-00000000000b','0b',2,100000,1100000,'klinik')));
-- Cabang C: pas; D: manual/beban; E: pembulatan; F: tanpa karyawan; G: tutup buku; H: ditolak/ajukan ulang; I: void; J: konkurensi/lain
select pg_temp.save('sC1',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-00000000000c','04',3,0,400000)));
select pg_temp.save('sD1',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-00000000000d','04',3,0,1000000)));
select pg_temp.save('sE1',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-00000000000e','04',3,0,300000)));
select pg_temp.save('sE2',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-00000000000e','05',3,0,200000)));
select pg_temp.save('sF1',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-00000000000f','07',3,0,500000)));
select pg_temp.save('sG1',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-0000000000a1','04',3,0,600000)));
select pg_temp.save('sH1',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-0000000000a2','04',3,0,700000)));
select pg_temp.save('sI1',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-0000000000a3','04',3,0,800000)));
select pg_temp.save('sJ1',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-0000000000a4','04',3,0,900000)));
select pg_temp.ok((select count(*) from cashier_shifts where id in (select (r->>'id')::uuid from res where name like 's%'))=13 and (select count(*) from cashier_shifts where employee_id is not null and id in (select (r->>'id')::uuid from res where name like 's%'))=11,'fixture: 13 shift tertutup, 11 tertaut karyawan (kasir 07 dan dokter tanpa karyawan)');

-- ── 1. akses & pembuatan periode ────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.ok((public.setoran_akses()->>'masuk')::boolean and not (public.setoran_akses()->>'penyetuju')::boolean and not (public.setoran_akses()->>'void')::boolean,'akses kasir: masuk, bukan penyetuju, tidak boleh void');
select pg_temp.as_('03');
select pg_temp.ok((public.setoran_akses()->>'penyetuju')::boolean and (public.setoran_akses()->>'void')::boolean,'akses Finance: penyetuju dan boleh void');
select pg_temp.as_('02');
select pg_temp.ok((public.setoran_akses()->>'penyetuju')::boolean and not (public.setoran_akses()->>'void')::boolean and not (public.setoran_akses()->>'pemutus')::boolean,'akses Admin: penyetuju (baca) tetapi tidak boleh void dan tidak boleh memutuskan');
select pg_temp.as_('01');
select pg_temp.ok((public.setoran_akses()->>'penyetuju')::boolean and (public.setoran_akses()->>'void')::boolean,'akses Owner: penyetuju dan boleh void');
select pg_temp.as_('06');
select pg_temp.reject($$select public.setoran_akses()$$,'ADMIN_ONLINE_FUNCTION_DENIED','Admin Online: setoran_akses ditolak');
select pg_temp.as_('09');
select pg_temp.ok(not (public.setoran_akses()->>'masuk')::boolean,'Finance nonaktif: tidak masuk');
select pg_temp.as_('04');
select pg_temp.reject($$select public.setoran_buat('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-5,pg_temp.today()+1,pg_temp.today()+1,'12:00',pg_temp.kk('x1'))$$,'periode transaksi belum berakhir','periode yang belum berakhir ditolak');
select pg_temp.reject($$select public.setoran_buat('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-40,pg_temp.today()-3,pg_temp.today()-1,'12:00',pg_temp.kk('x2'))$$,'SETORAN_PERIODE','periode lebih dari 31 hari ditolak');
select pg_temp.reject($$select public.setoran_buat('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-90,pg_temp.today()-85,pg_temp.today()-84,'12:00',pg_temp.kk('x3'))$$,'terlalu lama ke belakang','periode lebih dari 62 hari ke belakang ditolak');
select pg_temp.reject($$select public.setoran_buat('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-5,pg_temp.today()-3,pg_temp.today()-4,'12:00',pg_temp.kk('x4'))$$,'SETORAN_JADWAL','jadwal sebelum akhir periode ditolak');
select pg_temp.reject($$select public.setoran_buat('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-20,pg_temp.today()-18,pg_temp.today()-3,'12:00',pg_temp.kk('x5'))$$,'SETORAN_JADWAL','jadwal lebih dari 14 hari sesudah periode ditolak');
select pg_temp.reject($$select public.setoran_buat('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-5,pg_temp.today()-3,pg_temp.today()-1,'25:00',pg_temp.kk('x6'))$$,'SETORAN_JAM','jam batas tidak valid ditolak');
select pg_temp.reject($$select public.setoran_buat('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-3,pg_temp.today()-5,pg_temp.today()-1,'12:00',pg_temp.kk('x7'))$$,'SETORAN_PERIODE','tanggal akhir sebelum awal ditolak');
select pg_temp.reject($$select public.setoran_buat('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-5,pg_temp.today()-3,pg_temp.today()-1,'12:00',null)$$,'SETORAN_KUNCI','kunci permintaan kosong ditolak');
select pg_temp.reject($$select public.setoran_buat('e5200000-0000-4000-8000-0000000000b1',pg_temp.today()-5,pg_temp.today()-3,pg_temp.today()-1,'12:00',pg_temp.kk('x8'))$$,'cabang ini tidak dapat diakses','kasir tidak bisa membuat setoran untuk cabang yang bukan miliknya');
select pg_temp.as_('08');
select pg_temp.reject($$select public.setoran_buat('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-5,pg_temp.today()-3,pg_temp.today()-1,'12:00',pg_temp.kk('x9'))$$,'cabang ini tidak dapat diakses','staf cabang lain ditolak');
select pg_temp.as_('04');
-- periode utama cabang A (Jumat-Minggu ala Andri): tiga shift
select pg_temp.save('pA',public.setoran_buat('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-5,pg_temp.today()-3,pg_temp.today()-1,'12:00',pg_temp.kk('a-buat')));
select pg_temp.ok(pg_temp.st('pA')='Draft' and (select r->>'no_setoran' from res where name='pA') ~ '^STR-[0-9]{8}-001$','setoran baru berstatus Draft dengan nomor STR-YYYYMMDD-001');
reset role;
select pg_temp.ok((select count(*) from setoran_shift where setoran_id=pg_temp.sid('pA') and aktif)=3,'3 shift tertutup di periode otomatis tersambung');
select pg_temp.ok((select count(*) from setoran_event where setoran_id=pg_temp.sid('pA') and jenis='dibuat')=1,'riwayat: satu baris "dibuat"');
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.save('pA2',public.setoran_buat('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-5,pg_temp.today()-3,pg_temp.today()-1,'12:00',pg_temp.kk('a-buat')));
select pg_temp.ok((select r->>'id' from res where name='pA2')=(select r->>'id' from res where name='pA') and (select (r->>'ulang')::boolean from res where name='pA2'),'kunci sama + isi sama: hasil lama dikembalikan (idempoten), tanda ulang');
reset role;
select pg_temp.ok((select count(*) from setoran where branch_id='e5200000-0000-4000-8000-00000000000a')=1,'idempoten: hanya satu setoran tersimpan');
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.reject($$select public.setoran_buat('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-5,pg_temp.today()-4,pg_temp.today()-1,'12:00',pg_temp.kk('a-buat'))$$,'SETORAN_KUNCI_DIPAKAI','kunci sama + isi beda ditolak');
select pg_temp.reject($$select public.setoran_buat('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-4,pg_temp.today()-4,pg_temp.today()-1,'12:00',pg_temp.kk('a-tumpang'))$$,'SETORAN_TUMPANG_TINDIH','periode yang beririsan dengan setoran lain cabang yang sama ditolak');
select pg_temp.reject($$select public.setoran_buat('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-10,pg_temp.today()-5,pg_temp.today()-4,'12:00',pg_temp.kk('a-tumpang2'))$$,'SETORAN_TUMPANG_TINDIH','irisan satu hari (hari terakhir = awal setoran lain) juga ditolak');
-- periode lain / cabang lain
select pg_temp.save('pK',public.setoran_buat('e5200000-0000-4000-8000-00000000000b',pg_temp.today()-2,pg_temp.today()-2,pg_temp.today()+1,'12:00',pg_temp.kk('k-buat')));
select pg_temp.save('pC',public.setoran_buat('e5200000-0000-4000-8000-00000000000c',pg_temp.today()-3,pg_temp.today()-3,pg_temp.today()-3,'09:30',pg_temp.kk('c-buat')));
select pg_temp.save('pD',public.setoran_buat('e5200000-0000-4000-8000-00000000000d',pg_temp.today()-3,pg_temp.today()-3,pg_temp.today()-2,'12:00',pg_temp.kk('d-buat')));
select pg_temp.save('pE',public.setoran_buat('e5200000-0000-4000-8000-00000000000e',pg_temp.today()-3,pg_temp.today()-3,pg_temp.today()-2,'12:00',pg_temp.kk('e-buat')));
select pg_temp.as_('07');
select pg_temp.save('pF',public.setoran_buat('e5200000-0000-4000-8000-00000000000f',pg_temp.today()-3,pg_temp.today()-3,pg_temp.today()-2,'12:00',pg_temp.kk('f-buat')));
select pg_temp.as_('04');
select pg_temp.as_('02');
select pg_temp.save('pG',public.setoran_buat('e5200000-0000-4000-8000-0000000000a1',pg_temp.today()-3,pg_temp.today()-3,pg_temp.today()-2,'12:00',pg_temp.kk('g-buat')));
select pg_temp.as_('04');
select pg_temp.save('pH',public.setoran_buat('e5200000-0000-4000-8000-0000000000a2',pg_temp.today()-3,pg_temp.today()-3,pg_temp.today()-2,'12:00',pg_temp.kk('h-buat')));
select pg_temp.save('pI',public.setoran_buat('e5200000-0000-4000-8000-0000000000a3',pg_temp.today()-3,pg_temp.today()-3,pg_temp.today()-2,'12:00',pg_temp.kk('i-buat')));
select pg_temp.save('pJ',public.setoran_buat('e5200000-0000-4000-8000-0000000000a4',pg_temp.today()-3,pg_temp.today()-3,pg_temp.today()-2,'12:00',pg_temp.kk('j-buat')));
reset role;
select pg_temp.ok((select count(*) from setoran)=10 and (select count(distinct no_setoran) from setoran)=10,'10 setoran uji, nomor unik');
select pg_temp.ok((select count(*) from setoran_shift where aktif)=13,'13 shift tersambung ke 10 setoran (satu shift satu setoran aktif)');
select pg_temp.reject($$insert into setoran_shift(setoran_id,shift_id) values(pg_temp.sid('pK'),pg_temp.sid('sA1'))$$,'duplicate key','satu shift tidak bisa masuk dua setoran aktif (indeks unik)');
select pg_temp.ok((select count(*) from journal_entries where source in ('setoran','setoran-batal'))=0 and (select count(*) from expenses where created_by=pg_temp.u('04') and deskripsi like 'Setoran%')=0,'membuat setoran tidak menjurnal apa pun dan tidak membuat pengeluaran');
set local role authenticated;
select pg_temp.as_('04');
reset role;
select pg_temp.noauth();
update accounting_locks set closed_until=pg_temp.today()-1;
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.reject($$select public.setoran_buat('e5200000-0000-4000-8000-00000000000a',pg_temp.today()-12,pg_temp.today()-10,pg_temp.today()-9,'12:00',pg_temp.kk('a-tutup-buku'))$$,'periode akuntansi untuk tanggal','periode akuntansi tertutup: setoran baru ditolak');
reset role;
select pg_temp.noauth();
update accounting_locks set closed_until=null;

-- ── 2. angka, rincian per hari, privasi staf (Draft) ───────────────────────────────────────────
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.save('dA',public.setoran_detail(pg_temp.sid('pA')));
select pg_temp.ok((select (r->>'kewajiban')::numeric=3000000 from res where name='dA'),'kewajiban = SUM(closing-opening) tiga shift = Rp 3.000.000');
select pg_temp.ok((select jsonb_array_length(r->'harian')=3 and (r->'harian'->0->>'total')::numeric=1800000 and (r->'harian'->1->>'total')::numeric=700000 and (r->'harian'->2->>'total')::numeric=500000 from res where name='dA'),'rincian per hari: 1.800.000 / 700.000 / 500.000 (3 hari periode)');
select pg_temp.ok((select (r->'harian'->0->>'tanggal')::date=pg_temp.today()-5 and (r->'harian'->2->>'tanggal')::date=pg_temp.today()-3 from res where name='dA'),'tanggal per hari = periode mulai .. selesai');
reset role;
select pg_temp.ok((select sum(expected_cash-opening_balance) from cashier_shifts where id in (pg_temp.sid('sA1'),pg_temp.sid('sA2'),pg_temp.sid('sA3')))=2950000 and (select sum(selisih) from cashier_shifts where id in (pg_temp.sid('sA1'),pg_temp.sid('sA2'),pg_temp.sid('sA3')))=50000,'fixture: kas seharusnya tutup shift dikurangi modal 2.950.000, selisih tutup shift +50.000 (sudah dijurnal oleh tutup shift)');
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.ok((select (r->>'kewajiban')::numeric<>2950000 from res where name='dA'),'selisih tutup shift TIDAK dijurnal/dihitung ulang: kewajiban memakai kas fisik yang sudah dibukukan (3.000.000), bukan kas seharusnya (2.950.000)');
select pg_temp.ok((select (r->>'pengeluaran')::numeric=0 and (r->>'sisa')::numeric=3000000 and (r->>'persen')::numeric=0 from res where name='dA'),'Draft awal: pengeluaran 0, sisa 3.000.000, 0% selesai');
select pg_temp.ok((select jsonb_array_length(r->'pengeluaran_shift')=1 and (r->'pengeluaran_shift'->0->>'jumlah')::numeric=50000 from res where name='dA'),'pengeluaran kasir yang sudah diinput saat shift tampil sebagai informasi (50.000)');
select pg_temp.ok((select (r->>'kewajiban')::numeric=3000000 from res where name='dA') and (select (r->>'kewajiban')::numeric from res where name='dA')=3000000,'pengeluaran shift TIDAK dikurangkan lagi (tidak dobel)');
select pg_temp.ok((select r->>'badge'='Terlambat' and r->>'status_periode'='Terlambat' and (r->>'terlambat')::boolean and r->>'batas_jam'='12:00' from res where name='dA'),'badge Terlambat: lewat jadwal+batas jam dan sisa > 0');
select pg_temp.save('dK',public.setoran_detail(pg_temp.sid('pK')));
select pg_temp.ok((select r->>'badge'='Belum lunas' and r->>'status_periode'='Aktif' and not (r->>'terlambat')::boolean and (r->>'kewajiban')::numeric=1000000 from res where name='dK'),'periode klinik: badge Belum lunas, status periode Aktif, kewajiban 1.000.000');
select pg_temp.ok(not ((select r from res where name='dA') ?| array['keuangan','selisih','selisih_sementara','jenis','diharapkan','penjelasan_lebih','kasbon','rincian_shift','penyelesaian','journal_id']),'detail staf (Draft) tidak memuat bagian keuangan/selisih/jenis/kasbon/jurnal');
select pg_temp.ok(position('810004' in (select r::text from res where name='dA'))=0 and position('Lebih' in (select r::text from res where name='dA'))=0 and position('Kurang' in (select r::text from res where name='dA'))=0,'detail staf tidak memuat kata Lebih/Kurang/810004');
select pg_temp.as_('08');
select pg_temp.reject($$select public.setoran_detail(pg_temp.sid('pA'))$$,'tidak ditemukan atau tidak dapat diakses','staf cabang lain tidak bisa membuka detail');
select pg_temp.ok(jsonb_array_length(public.setoran_daftar(null,null,null,null,null)->'baris')=0,'staf cabang lain: daftar kosong');
select pg_temp.as_('04');
select pg_temp.save('lA',public.setoran_daftar(null,null,null,null,null));
select pg_temp.ok((select jsonb_array_length(r->'baris')=10 and not (r->>'penyetuju')::boolean from res where name='lA'),'daftar kasir: 10 setoran cabangnya, bukan penyetuju');
select pg_temp.ok(not exists(select 1 from res, jsonb_array_elements(r->'baris') b where name='lA' and b ?| array['selisih','selisih_sementara','jenis','diharapkan','penyelesaian','kas_seharusnya']),'daftar kasir: tidak ada kolom selisih/jenis/diharapkan');
select pg_temp.ok((select (b->>'kewajiban')::numeric=3000000 and (b->>'sisa')::numeric=3000000 and b->>'badge'='Terlambat' from res, jsonb_array_elements(r->'baris') b where name='lA' and b->>'no_setoran'=(select r->>'no_setoran' from res where name='pA')),'daftar: kewajiban, sisa dan badge pada baris setoran A');
select pg_temp.ok(jsonb_array_length(public.setoran_daftar(null,null,'e5200000-0000-4000-8000-00000000000b',null,null)->'baris')=1 and jsonb_array_length(public.setoran_daftar(null,null,null,'Void',null)->'baris')=0,'filter cabang dan status pada daftar');
select pg_temp.ok(jsonb_array_length(public.setoran_daftar(pg_temp.today()-3,pg_temp.today()-3,null,null,null)->'baris')=9,'filter tanggal (periode selesai) pada daftar');

-- ── 3. muat ulang shift (sinkron) ───────────────────────────────────────────────────────────────
reset role;
select pg_temp.save('sC2',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-00000000000c','05',3,0,100000)));
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.ok((public.setoran_detail(pg_temp.sid('pC'))->>'shift_baru')::int=1 and (public.setoran_detail(pg_temp.sid('pC'))->>'kewajiban')::numeric=400000,'shift tertutup baru terdeteksi (shift_baru=1) tetapi belum dihitung');
select pg_temp.save('sink1',public.setoran_sinkron(pg_temp.sid('pC')));
select pg_temp.ok((select (r->>'shift_baru')::int=1 from res where name='sink1') and (public.setoran_detail(pg_temp.sid('pC'))->>'kewajiban')::numeric=500000 and (public.setoran_detail(pg_temp.sid('pC'))->>'shift_baru')::int=0,'sinkron menyambung shift baru: kewajiban jadi 500.000');
select pg_temp.ok((public.setoran_sinkron(pg_temp.sid('pC'))->>'shift_baru')::int=0,'sinkron kedua idempoten: tidak ada yang baru');
select pg_temp.as_('08');
select pg_temp.reject($$select public.setoran_sinkron(pg_temp.sid('pC'))$$,'cabang ini tidak dapat diakses','sinkron oleh staf cabang lain ditolak');

-- ── 4. pengeluaran dari dana setoran (usulan; belum ada jurnal/expense) ─────────────────────────
select pg_temp.as_('04');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pA'),pg_temp.today()-3,'Salah',1000,'x',pg_temp.lamp(pg_temp.sid('pA'),'pe1'),pg_temp.rev('pA'),pg_temp.kk('pe1'))$$,'SETORAN_KATEGORI','kategori tidak dikenal ditolak');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pA'),pg_temp.today()-3,'Operasional',0,'x',pg_temp.lamp(pg_temp.sid('pA'),'pe2'),pg_temp.rev('pA'),pg_temp.kk('pe2'))$$,'SETORAN_JUMLAH','jumlah 0 ditolak');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pA'),pg_temp.today()-3,'Operasional',12.345,'x',pg_temp.lamp(pg_temp.sid('pA'),'pe3'),pg_temp.rev('pA'),pg_temp.kk('pe3'))$$,'SETORAN_JUMLAH','jumlah dengan 3 desimal ditolak');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pA'),pg_temp.today()-3,'Operasional',1000,'x','[]'::jsonb,pg_temp.rev('pA'),pg_temp.kk('pe4'))$$,'SETORAN_LAMPIRAN','tanpa lampiran bukti ditolak');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pA'),pg_temp.today()-3,'Operasional',1000,'x','[{"path":"../x.jpg","nama":"x","mime":"image/jpeg","ukuran":10}]'::jsonb,pg_temp.rev('pA'),pg_temp.kk('pe5'))$$,'SETORAN_LAMPIRAN','lampiran dengan path berbahaya ditolak');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pA'),pg_temp.today()-6,'Operasional',1000,'x',pg_temp.lamp(pg_temp.sid('pA'),'pe6'),pg_temp.rev('pA'),pg_temp.kk('pe6'))$$,'antara awal periode','tanggal sebelum periode ditolak');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pA'),pg_temp.today()+1,'Operasional',1000,'x',pg_temp.lamp(pg_temp.sid('pA'),'pe7'),pg_temp.rev('pA'),pg_temp.kk('pe7'))$$,'antara awal periode','tanggal masa depan ditolak');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pA'),pg_temp.today()-3,'Operasional',1000,'x',pg_temp.lamp(pg_temp.sid('pA'),'pe8'),pg_temp.rev('pA')+5,pg_temp.kk('pe8'))$$,'SETORAN_BERUBAH','revisi usang ditolak (tidak menimpa perubahan orang lain)');
select pg_temp.as_('08');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pA'),pg_temp.today()-3,'Operasional',1000,'x',pg_temp.lamp(pg_temp.sid('pA'),'pe9'),pg_temp.rev('pA'),pg_temp.kk('pe9'))$$,'cabang ini tidak dapat diakses','staf cabang lain tidak bisa menambah pengeluaran');
select pg_temp.as_('04');
select pg_temp.save('e1',public.setoran_tambah_pengeluaran(pg_temp.sid('pA'),pg_temp.today()-3,'Operasional',60000,'beli plastik',pg_temp.lamp(pg_temp.sid('pA'),'pe-ok1'),pg_temp.rev('pA'),pg_temp.kk('pe-ok1')));
select pg_temp.save('e2',public.setoran_tambah_pengeluaran(pg_temp.sid('pA'),pg_temp.today()-4,'Transportasi',40000,'ongkir',pg_temp.lamp(pg_temp.sid('pA'),'pe-ok2'),pg_temp.rev('pA'),pg_temp.kk('pe-ok2')));
select pg_temp.save('e1b',public.setoran_tambah_pengeluaran(pg_temp.sid('pA'),pg_temp.today()-3,'Operasional',60000,'beli plastik',pg_temp.lamp(pg_temp.sid('pA'),'pe-ok1'),(select (r->>'revision')::int-1 from res where name='e1'),pg_temp.kk('pe-ok1')));
select pg_temp.ok((select (r->>'ulang')::boolean and r->>'baris_id'=(select r->>'baris_id' from res where name='e1') from res where name='e1b'),'tambah pengeluaran idempoten: kunci sama = baris yang sama');
select pg_temp.save('e3',public.setoran_tambah_pengeluaran(pg_temp.sid('pA'),pg_temp.today()-5,'Operasional',10000,'sementara',pg_temp.lamp(pg_temp.sid('pA'),'pe-ok3'),pg_temp.rev('pA'),pg_temp.kk('pe-ok3')));
select pg_temp.save('e3d',public.setoran_hapus_pengeluaran(pg_temp.sid('pA'),(select (r->>'baris_id')::uuid from res where name='e3'),pg_temp.rev('pA'),pg_temp.kk('pe-del3')));
select pg_temp.reject($$select public.setoran_hapus_pengeluaran(pg_temp.sid('pA'),(select (r->>'baris_id')::uuid from res where name='e3'),pg_temp.rev('pA'),pg_temp.kk('pe-del3b'))$$,'baris pengeluaran tidak ditemukan','menghapus baris yang sudah terhapus ditolak');
select pg_temp.save('dA2',public.setoran_detail(pg_temp.sid('pA')));
select pg_temp.ok((select jsonb_array_length(r->'pengeluaran_baris')=2 and (r->>'pengeluaran')::numeric=100000 and (r->>'sisa')::numeric=2900000 from res where name='dA2'),'dua pengeluaran 60.000 + 40.000: sisa kewajiban 2.900.000');
reset role;
select pg_temp.ok((select count(*) from expenses where deskripsi like 'Setoran%')=0 and (select count(*) from journal_entries where source='expense' and deskripsi like '%Setoran%')=0,'sebelum disetujui: tidak ada expense dan tidak ada jurnal pengeluaran dari setoran');
select pg_temp.ok((select count(*) from setoran_pengeluaran where setoran_id=pg_temp.sid('pA'))=2 and (select count(*) from setoran_pengeluaran where expense_id is not null)=0,'dua baris usulan tersimpan, belum ada expense_id');

-- ── 5. transfer / serah tunai parsial + konfirmasi Finance ──────────────────────────────────────
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today()-1,1000,'Cek','e5500000-0000-4000-8000-000000000004',pg_temp.lamp(pg_temp.sid('pA'),'t1'),null,pg_temp.rev('pA'),pg_temp.kk('t1'))$$,'SETORAN_METODE','metode selain Transfer/Serah tunai ditolak');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today()-1,1000,'Transfer','e5500000-0000-4000-8000-000000000004','[]'::jsonb,null,pg_temp.rev('pA'),pg_temp.kk('t2'))$$,'foto bukti transfer wajib','Transfer tanpa foto bukti ditolak');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today()-1,1000,'Transfer','e5500000-0000-4000-8000-000000000003',pg_temp.lamp(pg_temp.sid('pA'),'t3'),null,pg_temp.rev('pA'),pg_temp.kk('t3'))$$,'transfer harus ke rekening bank','Transfer ke akun Kas ditolak');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today()-1,1000,'Serah tunai','e5500000-0000-4000-8000-000000000004',null,null,pg_temp.rev('pA'),pg_temp.kk('t4'))$$,'serah tunai harus ke akun kas','Serah tunai ke rekening Bank ditolak');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today()-1,1000,'Transfer','e5500000-0000-4000-8000-000000000005',pg_temp.lamp(pg_temp.sid('pA'),'t5'),null,pg_temp.rev('pA'),pg_temp.kk('t5'))$$,'bukan rekening bank yang sah','rekening bertanda Bank tetapi akun COA bukan di bawah 120000 ditolak (pemalsuan jenis)');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today()-1,1000,'Transfer','e5500000-0000-4000-8000-000000000006',pg_temp.lamp(pg_temp.sid('pA'),'t6'),null,pg_temp.rev('pA'),pg_temp.kk('t6'))$$,'tidak ditemukan, tidak aktif','rekening nonaktif ditolak');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today()-1,1000,'Transfer','e5500000-0000-4000-8000-000000000007',pg_temp.lamp(pg_temp.sid('pA'),'t7'),null,pg_temp.rev('pA'),pg_temp.kk('t7'))$$,'bukan milik cabang ini','rekening milik cabang lain ditolak');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today()-1,0,'Transfer','e5500000-0000-4000-8000-000000000004',pg_temp.lamp(pg_temp.sid('pA'),'t9'),null,pg_temp.rev('pA'),pg_temp.kk('t9'))$$,'SETORAN_JUMLAH','jumlah transfer 0 ditolak');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today()-1,10.123,'Transfer','e5500000-0000-4000-8000-000000000004',pg_temp.lamp(pg_temp.sid('pA'),'t10'),null,pg_temp.rev('pA'),pg_temp.kk('t10'))$$,'SETORAN_JUMLAH','jumlah transfer 3 desimal ditolak');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today()-6,1000,'Transfer','e5500000-0000-4000-8000-000000000004',pg_temp.lamp(pg_temp.sid('pA'),'t11'),null,pg_temp.rev('pA'),pg_temp.kk('t11'))$$,'antara awal periode','tanggal transfer sebelum periode ditolak');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today()+1,1000,'Transfer','e5500000-0000-4000-8000-000000000004',pg_temp.lamp(pg_temp.sid('pA'),'t12'),null,pg_temp.rev('pA'),pg_temp.kk('t12'))$$,'antara awal periode','tanggal transfer masa depan ditolak');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today()-1,1000,'Transfer','e5500000-0000-4000-8000-000000000004',pg_temp.lamp(pg_temp.sid('pA'),'t13'),null,pg_temp.rev('pA')+3,pg_temp.kk('t13'))$$,'SETORAN_BERUBAH','revisi usang pada transfer ditolak');
select pg_temp.save('t1',public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today()-1,2000000,'Transfer','e5500000-0000-4000-8000-000000000004',pg_temp.lamp(pg_temp.sid('pA'),'t-ok1'),'transfer BCA',pg_temp.rev('pA'),pg_temp.kk('t-ok1')));
select pg_temp.save('t2',public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today(),800000,'Serah tunai','e5500000-0000-4000-8000-000000000003',null,'diserahkan ke Finance',pg_temp.rev('pA'),pg_temp.kk('t-ok2')));
select pg_temp.save('t4',public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today(),5000,'Serah tunai','e5500000-0000-4000-8000-000000000003',null,null,pg_temp.rev('pA'),pg_temp.kk('t-ok4')));
select pg_temp.save('t4d',public.setoran_hapus_transfer(pg_temp.sid('pA'),(select (r->>'transfer_id')::uuid from res where name='t4'),pg_temp.rev('pA'),pg_temp.kk('t-del4')));
select pg_temp.save('dA3',public.setoran_detail(pg_temp.sid('pA')));
select pg_temp.ok((select (r->>'transfer')::numeric=2800000 and (r->>'sisa')::numeric=100000 and (r->>'persen')::numeric=96 and jsonb_array_length(r->'transfer_baris')=2 from res where name='dA3'),'transfer parsial 2.000.000 + 800.000: sisa 100.000, 96% (pengeluaran + transfer) / kewajiban');
select pg_temp.ok((select bool_and(t->>'status'='Menunggu') from res, jsonb_array_elements(r->'transfer_baris') t where name='dA3') and (select count(*)=2 from res, jsonb_array_elements(r->'transfer_baris') x where name='dA3' and x->>'rekening' in ('STR bank utama','STR kas finance')),'transfer baru berstatus Menunggu dengan nama rekening tujuan');
select pg_temp.reject($$select public.setoran_putuskan_transfer(pg_temp.sid('pA'),(select (r->>'transfer_id')::uuid from res where name='t1'),true,null,pg_temp.kk('t-dec0'))$$,'SETORAN_DITOLAK_PERAN','staf tidak boleh mengonfirmasi transfer');
select pg_temp.as_('03');
select pg_temp.save('t3',public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today(),1000,'Serah tunai','e5500000-0000-4000-8000-000000000003',null,'uji pemisahan tugas',pg_temp.rev('pA'),pg_temp.kk('t-ok3')));
select pg_temp.reject($$select public.setoran_putuskan_transfer(pg_temp.sid('pA'),(select (r->>'transfer_id')::uuid from res where name='t3'),true,null,pg_temp.kk('t-dec1'))$$,'SETORAN_PEMISAHAN_TUGAS','Finance tidak boleh mengonfirmasi transfer yang dicatatnya sendiri');
select pg_temp.as_('0c');
select pg_temp.reject($$select public.setoran_putuskan_transfer(pg_temp.sid('pA'),(select (r->>'transfer_id')::uuid from res where name='t3'),false,null,pg_temp.kk('t-dec2'))$$,'SETORAN_ALASAN','menolak transfer tanpa alasan ditolak');
select pg_temp.reject($$select public.setoran_putuskan_transfer(pg_temp.sid('pA'),(select (r->>'transfer_id')::uuid from res where name='t3'),null,'x',pg_temp.kk('t-dec2b'))$$,'SETORAN_KEPUTUSAN','keputusan kosong ditolak');
select pg_temp.save('t3d',public.setoran_putuskan_transfer(pg_temp.sid('pA'),(select (r->>'transfer_id')::uuid from res where name='t3'),false,'uang tidak masuk rekening',pg_temp.kk('t-dec3')));
select pg_temp.as_('04');
select pg_temp.save('dA4',public.setoran_detail(pg_temp.sid('pA')));
select pg_temp.ok((select (r->>'transfer')::numeric=2800000 from res where name='dA4') and (select count(*)=3 from res, jsonb_array_elements(r->'transfer_baris') where name='dA4') and (select count(*)=1 from res, jsonb_array_elements(r->'transfer_baris') x where name='dA4' and x->>'status'='Ditolak' and x->>'alasan_tolak'='uang tidak masuk rekening'),'transfer ditolak tidak dihitung, tetap tampil dengan alasan');
select pg_temp.as_('02');
select pg_temp.reject($$select public.setoran_putuskan_transfer(pg_temp.sid('pA'),(select (r->>'transfer_id')::uuid from res where name='t1'),true,null,pg_temp.kk('t-dec3a'))$$,'hanya Owner atau Finance yang dapat mengonfirmasi transfer','SETORAN-FINANCE-ONLY: Admin tidak boleh mengonfirmasi transfer');
select pg_temp.reject($$select public.setoran_putuskan_transfer(pg_temp.sid('pA'),(select (r->>'transfer_id')::uuid from res where name='t1'),false,'tolak',pg_temp.kk('t-dec3b'))$$,'hanya Owner atau Finance yang dapat mengonfirmasi transfer','SETORAN-FINANCE-ONLY: Admin tidak boleh menolak transfer');
select pg_temp.as_('03');
select pg_temp.save('t1c',public.setoran_putuskan_transfer(pg_temp.sid('pA'),(select (r->>'transfer_id')::uuid from res where name='t1'),true,null,pg_temp.kk('t-dec4')));
select pg_temp.save('t2c',public.setoran_putuskan_transfer(pg_temp.sid('pA'),(select (r->>'transfer_id')::uuid from res where name='t2'),true,'uang diterima',pg_temp.kk('t-dec5')));
select pg_temp.reject($$select public.setoran_putuskan_transfer(pg_temp.sid('pA'),(select (r->>'transfer_id')::uuid from res where name='t1'),false,'salah klik',pg_temp.kk('t-dec6'))$$,'sudah diputuskan','transfer yang sudah dikonfirmasi tidak bisa diputuskan lagi');
select pg_temp.as_('04');
select pg_temp.reject($$select public.setoran_hapus_transfer(pg_temp.sid('pA'),(select (r->>'transfer_id')::uuid from res where name='t1'),pg_temp.rev('pA'),pg_temp.kk('t-del5'))$$,'sudah diputuskan Finance','transfer yang sudah dikonfirmasi tidak bisa dihapus staf');
select pg_temp.save('dA5',public.setoran_detail(pg_temp.sid('pA')));
select pg_temp.ok(not exists(select 1 from res, jsonb_array_elements(r->'riwayat') e where name='dA5' and e->>'jenis' in ('transfer_dikonfirmasi','transfer_ditolak','disetujui','void')) and not exists(select 1 from res, jsonb_array_elements(r->'riwayat') e where name='dA5' and e ? 'catatan' and e->>'jenis' not in ('ditolak')),'riwayat staf: tanpa keputusan keuangan dan tanpa catatan penyetuju');
select pg_temp.as_('03');
select pg_temp.save('dA6',public.setoran_detail(pg_temp.sid('pA')));
select pg_temp.ok(not (select r from res where name='dA6') ? 'keuangan','sebelum diajukan: penyetuju pun belum melihat bagian keuangan (angka belum dikunci)');
select pg_temp.ok(exists(select 1 from res, jsonb_array_elements(r->'riwayat') e where name='dA6' and e->>'jenis'='transfer_dikonfirmasi' and e->>'catatan'='uang diterima'),'riwayat penyetuju memuat konfirmasi transfer + catatan');
select pg_temp.save('lA2',public.setoran_daftar(null,null,'e5200000-0000-4000-8000-00000000000a',null,null));
select pg_temp.ok((select (r->>'penyetuju')::boolean and not exists(select 1 from jsonb_array_elements(r->'baris') b where b ? 'selisih') from res where name='lA2'),'daftar penyetuju untuk Draft: belum ada selisih');

-- ── 6. ajukan (kunci angka) ────────────────────────────────────────────────────────────────────
reset role;
select pg_temp.noauth();
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance,opened_at,status) values('e5600000-0000-4000-8000-0000000000aa','e5200000-0000-4000-8000-00000000000a',pg_temp.u('05'),'petshop',0,((pg_temp.today()-4)::timestamp+time '08:00') at time zone 'Asia/Jakarta','open');
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.reject($$select public.setoran_ajukan(pg_temp.sid('pA'),pg_temp.rev('pA'),pg_temp.kk('aj0'))$$,'SETORAN_SHIFT_TERBUKA','tidak bisa diajukan selama ada shift cabang yang masih terbuka di periode');
reset role;
delete from cashier_shifts where id='e5600000-0000-4000-8000-0000000000aa';
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.reject($$select public.setoran_ajukan(pg_temp.sid('pA'),pg_temp.rev('pA')+1,pg_temp.kk('aj1'))$$,'SETORAN_BERUBAH','ajukan dengan revisi usang ditolak');
select pg_temp.save('aj',public.setoran_ajukan(pg_temp.sid('pA'),pg_temp.rev('pA'),pg_temp.kk('aj2')));
select pg_temp.ok((select r->>'status'='Diajukan' and not r ?| array['selisih','diharapkan','kewajiban','jenis','sisa','keuangan'] from res where name='aj'),'hasil ajukan ke staf hanya id/nomor/status (tanpa angka)');
select pg_temp.save('aj2',public.setoran_ajukan(pg_temp.sid('pA'),pg_temp.rev('pA')-1,pg_temp.kk('aj2')));
select pg_temp.ok((select (r->>'ulang')::boolean from res where name='aj2'),'ajukan idempoten (kunci sama)');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pA'),pg_temp.today()-3,'Operasional',1000,'x',pg_temp.lamp(pg_temp.sid('pA'),'post1'),pg_temp.rev('pA'),pg_temp.kk('post1'))$$,'SETORAN_STATUS','sesudah diajukan: tambah pengeluaran ditolak');
select pg_temp.reject($$select public.setoran_hapus_pengeluaran(pg_temp.sid('pA'),(select (r->>'baris_id')::uuid from res where name='e1'),pg_temp.rev('pA'),pg_temp.kk('post2'))$$,'SETORAN_STATUS','sesudah diajukan: hapus pengeluaran ditolak');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pA'),pg_temp.today(),1000,'Serah tunai','e5500000-0000-4000-8000-000000000003',null,null,pg_temp.rev('pA'),pg_temp.kk('post3'))$$,'SETORAN_STATUS','sesudah diajukan: tambah transfer ditolak');
select pg_temp.reject($$select public.setoran_hapus_transfer(pg_temp.sid('pA'),(select (r->>'transfer_id')::uuid from res where name='t1'),pg_temp.rev('pA'),pg_temp.kk('post4'))$$,'SETORAN_STATUS','sesudah diajukan: hapus transfer ditolak');
select pg_temp.reject($$select public.setoran_sinkron(pg_temp.sid('pA'))$$,'SETORAN_STATUS','sesudah diajukan: muat ulang shift ditolak');
select pg_temp.reject($$select public.setoran_ajukan(pg_temp.sid('pA'),pg_temp.rev('pA'),pg_temp.kk('post5'))$$,'SETORAN_STATUS','diajukan dua kali dengan kunci baru ditolak');
select pg_temp.reject($$select public.setoran_batalkan_draft(pg_temp.sid('pA'),'salah buat',pg_temp.kk('post6'))$$,'hanya Draft atau Ditolak','setoran yang sudah diajukan tidak bisa dibuang staf');
select pg_temp.reject($$select public.setoran_tolak(pg_temp.sid('pA'),'coba tolak',pg_temp.kk('post7'))$$,'SETORAN_DITOLAK_PERAN','staf tidak boleh menolak setoran');
select pg_temp.save('dA7',public.setoran_detail(pg_temp.sid('pA')));
select pg_temp.ok((select r->>'badge'='Menunggu persetujuan' and r->>'status'='Diajukan' and not r ?| array['keuangan','selisih','selisih_sementara','diharapkan','jenis'] from res where name='dA7'),'staf setelah diajukan: badge Menunggu persetujuan, tanpa bagian keuangan');
select pg_temp.as_('03');
select pg_temp.save('dA8',public.setoran_detail(pg_temp.sid('pA')));
select pg_temp.ok((select (r->'keuangan'->>'diharapkan')::numeric=2900000 and (r->'keuangan'->>'transfer_dikonfirmasi')::numeric=2800000 and (r->'keuangan'->>'selisih_sementara')::numeric=-100000 and (r->'keuangan'->>'bersih_shift')::numeric=3000000 and (r->'keuangan'->>'pengeluaran_setoran')::numeric=100000 from res where name='dA8'),'penyetuju melihat: diharapkan 2.900.000, dikonfirmasi 2.800.000, selisih sementara -100.000');
select pg_temp.ok((select jsonb_array_length(r->'keuangan'->'penanggung_otomatis')=2 from res where name='dA8'),'penyetuju melihat dua karyawan penanggung jawab otomatis (kasir shift)');
select pg_temp.ok((select jsonb_array_length(r->'keuangan'->'rincian_shift')=3 from res where name='dA8'),'rincian per shift untuk penyetuju (3 shift)');
reset role;
select pg_temp.ok((select expected_amount=2900000 and shift_net=3000000 and pengeluaran_total=100000 and selisih is null and jenis is null from setoran_keuangan where setoran_id=pg_temp.sid('pA')),'snapshot keuangan saat diajukan: diharapkan/bersih/pengeluaran terkunci, selisih belum diputuskan');

-- ── 7. persiapan setoran lain (transfer, pengeluaran, ajukan) ───────────────────────────────────
create function pg_temp.pay(nm text,amt numeric,metode text,enterer text,confirmer text,k text,tgl int default 1) returns void language plpgsql as $$
declare r jsonb;acc uuid:=case when metode='Transfer' then 'e5500000-0000-4000-8000-000000000004'::uuid else 'e5500000-0000-4000-8000-000000000003'::uuid end;
begin
 perform set_config('role','authenticated',true);perform pg_temp.as_(enterer);
 r:=public.setoran_tambah_transfer(pg_temp.sid(nm),pg_temp.today()-tgl,amt,metode,acc,case when metode='Transfer' then pg_temp.lamp(pg_temp.sid(nm),k) else null end,null,pg_temp.rev(nm),pg_temp.kk(k));
 perform pg_temp.save(k,r);
 if confirmer is not null then perform pg_temp.as_(confirmer);
  perform public.setoran_putuskan_transfer(pg_temp.sid(nm),(r->>'transfer_id')::uuid,true,null,pg_temp.kk(k||'-c'));end if;
 perform set_config('role','none',true);
end$$;
create function pg_temp.sub(nm text,u text,k text) returns void language plpgsql as $$
begin perform set_config('role','authenticated',true);perform pg_temp.as_(u);perform public.setoran_ajukan(pg_temp.sid(nm),pg_temp.rev(nm),pg_temp.kk(k));perform set_config('role','none',true);end$$;
create function pg_temp.exps(nm text,u text,d int,kat text,amt numeric,k text) returns void language plpgsql as $$
begin perform set_config('role','authenticated',true);perform pg_temp.as_(u);perform public.setoran_tambah_pengeluaran(pg_temp.sid(nm),pg_temp.today()-d,kat,amt,'uji '||k,pg_temp.lamp(pg_temp.sid(nm),k),pg_temp.rev(nm),pg_temp.kk(k));perform set_config('role','none',true);end$$;
select pg_temp.pay('pK',1037500,'Transfer','04',null,'k-t1');
select pg_temp.sub('pK','04','k-aj');
select pg_temp.exps('pC','04',3,'Operasional',50000,'c-e1');
select pg_temp.pay('pC',450000,'Transfer','04','03','c-t1',2);
select pg_temp.sub('pC','04','c-aj');
select pg_temp.pay('pD',900000,'Transfer','04','03','d-t1',2);
select pg_temp.sub('pD','04','d-aj');
select pg_temp.pay('pE',499999.97,'Serah tunai','04','03','e-t1',2);
select pg_temp.sub('pE','04','e-aj');
select pg_temp.pay('pF',400000,'Transfer','07','03','f-t1',2);
select pg_temp.sub('pF','07','f-aj');
select pg_temp.pay('pG',600000,'Serah tunai','02','03','g-t1',2);
select pg_temp.sub('pG','02','g-aj');
select pg_temp.pay('pH',700000,'Transfer','04','03','h-t1',2);
select pg_temp.sub('pH','0c','h-aj');
select pg_temp.exps('pI','04',3,'Operasional',20000,'i-e1');
select pg_temp.pay('pI',700000,'Transfer','04','0c','i-t1',2);
select pg_temp.sub('pI','04','i-aj');
select pg_temp.pay('pJ',800000,'Transfer','04','0c','j-t1',2);
select pg_temp.sub('pJ','04','j-aj');
select pg_temp.ok((select count(*) from setoran where status='Diajukan')=10,'10 setoran berstatus Diajukan (A, K, C, D, E, F, G, H, I, J)');
select pg_temp.ok((select count(*) from setoran_keuangan where selisih is null)=10,'10 snapshot keuangan terkunci saat diajukan');
select pg_temp.ok(not exists(select 1 from journal_entries where source in ('setoran','setoran-batal')) and not exists(select 1 from expenses where deskripsi like 'Setoran %') and not exists(select 1 from cash_advances where alasan like 'Selisih kurang setoran%'),'sebelum ada persetujuan: nol jurnal setoran, nol expense setoran, nol kasbon setoran');
create temp table snap_before as select (select count(*) from journal_entries) j,(select count(*) from expenses) e,(select count(*) from cash_advances) c;
grant all on snap_before to public;

-- ── 8. otorisasi persetujuan & pemisahan tugas ─────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pA'),pg_temp.kk('ap-staff'),null,null,false,false,null)$$,'SETORAN_DITOLAK_PERAN','kasir tidak boleh menyetujui');
select pg_temp.reject($$select public.setoran_rekap(null,null,null,null,null)$$,'SETORAN_DITOLAK_PERAN','kasir tidak boleh membuka rekap');
select pg_temp.reject($$select public.setoran_so_terakhir('e5200000-0000-4000-8000-00000000000a')$$,'SETORAN_DITOLAK_PERAN','kasir tidak boleh membuka pintasan SO');
select pg_temp.reject($$select public.setoran_void(pg_temp.sid('pA'),'coba void',pg_temp.kk('ap-void-staff'))$$,'SETORAN_DITOLAK_PERAN','kasir tidak boleh void');
select pg_temp.as_('09');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pA'),pg_temp.kk('ap-nonaktif'),null,null,false,false,null)$$,'SETORAN_DITOLAK','Finance nonaktif tidak boleh menyetujui');
select pg_temp.as_('0a');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pA'),pg_temp.kk('ap-admin-lain'),null,null,false,false,null)$$,'hanya Owner atau Finance yang dapat menyetujui setoran','SETORAN-FINANCE-ONLY: Admin (cabang lain) tidak boleh menyetujui setoran; peran ditolak lebih dulu dari cabang');
select pg_temp.as_('02');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pG'),pg_temp.kk('ap-g-self'),null,null,false,false,null)$$,'hanya Owner atau Finance yang dapat menyetujui setoran','SETORAN-FINANCE-ONLY: Admin pembuat/pengaju setoran tidak boleh menyetujui (peran ditolak; pemisahan tugas Finance diuji pada setoran H)');
select pg_temp.reject($$select public.setoran_tolak(pg_temp.sid('pG'),'coba tolak admin',pg_temp.kk('ap-g-tolak'))$$,'hanya Owner atau Finance yang dapat menolak setoran','SETORAN-FINANCE-ONLY: Admin tidak boleh menolak setoran');
select pg_temp.as_('0c');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pH'),pg_temp.kk('ap-h-submitter'),null,null,false,false,null)$$,'SETORAN_PEMISAHAN_TUGAS','pengaju (Finance) tidak boleh menyetujui setoran yang diajukannya');
select pg_temp.as_('06');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pA'),pg_temp.kk('ap-ao'),null,null,false,false,null)$$,'ADMIN_ONLINE_FUNCTION_DENIED','Admin Online tidak boleh menyetujui');
-- tutup buku: periode akuntansi sampai akhir periode G menolak persetujuan
reset role;
select pg_temp.noauth();
update accounting_locks set closed_until=pg_temp.today()-3;
set local role authenticated;
select pg_temp.as_('03');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pG'),pg_temp.kk('ap-g-tutup'),null,null,false,false,null)$$,'periode akuntansi untuk tanggal','periode akuntansi tertutup: persetujuan ditolak');
reset role;
select pg_temp.noauth();
update accounting_locks set closed_until=null;
select pg_temp.ok((select status from setoran where id=pg_temp.sid('pG'))='Diajukan' and not exists(select 1 from journal_entries where source='setoran'),'penolakan karena tutup buku tidak mengubah setoran dan tidak ada jurnal');
set local role authenticated;
select pg_temp.as_('03');
-- K: transfer masih Menunggu -> ditolak persetujuan
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pK'),pg_temp.kk('ap-k-wait'),null,null,false,false,null)$$,'SETORAN_TRANSFER_MENUNGGU','transfer yang belum diputuskan menahan persetujuan');
-- selisih besar butuh konfirmasi: D punya selisih 100.000 (kecil); uji dengan J nanti. Beban/alokasi pada selisih bukan kurang ditolak
select pg_temp.as_('0c');
select pg_temp.save('kc',public.setoran_putuskan_transfer(pg_temp.sid('pK'),(select (r->>'transfer_id')::uuid from res where name='k-t1'),true,'masuk',pg_temp.kk('k-t1-c')));

-- ── 9. K: kelebihan (lebih) — staf tidak boleh tahu ────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.save('dK2',public.setoran_detail(pg_temp.sid('pK')));
select pg_temp.ok((select (r->>'sisa')::numeric=0 and (r->>'persen')::numeric=100 and r->>'badge'='Menunggu persetujuan' and (r->>'transfer')::numeric=1037500 and not r ?| array['keuangan','selisih','selisih_sementara','diharapkan','jenis'] from res where name='dK2'),'staf K (transfer melebihi kewajiban): sisa dipatok 0, 100%, tanpa selisih/lebih');
select pg_temp.as_('03');
select pg_temp.save('dK3',public.setoran_detail(pg_temp.sid('pK')));
select pg_temp.ok((select (r->'keuangan'->>'selisih_sementara')::numeric=37500 and (r->'keuangan'->>'diharapkan')::numeric=1000000 from res where name='dK3'),'penyetuju K melihat selisih sementara +37.500');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pK'),pg_temp.kk('ap-k-1'),null,'[{"employee_id":"e5300000-0000-4000-8000-000000000003","jumlah":37500}]'::jsonb,false,false,null)$$,'hanya untuk selisih kurang','alokasi karyawan pada selisih lebih ditolak');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pK'),pg_temp.kk('ap-k-2'),null,null,true,false,'x kasbon')$$,'hanya untuk selisih kurang','beban perusahaan pada selisih lebih ditolak');
select pg_temp.save('apK',public.setoran_setujui(pg_temp.sid('pK'),pg_temp.kk('ap-k-3'),'barang lupa input? cek SO',null,false,false,'catatan internal rahasia'));
reset role;
select pg_temp.ok((select r->>'penyelesaian'='PendapatanLain' and (r->>'selisih')::numeric=37500 and jsonb_array_length(r->'kasbon_ids')=0 from res where name='apK'),'K disetujui: Pendapatan Lain, selisih +37.500, tanpa kasbon');
select pg_temp.ok(pg_temp.jn('setoran',pg_temp.sid('pK'))=1 and pg_temp.jline('setoran',pg_temp.sid('pK'),'1193')=37500 and pg_temp.jline('setoran',pg_temp.sid('pK'),'810004')=-37500 and pg_temp.jdate('setoran',pg_temp.sid('pK'))=pg_temp.today()-2,'jurnal lebih: Dr kas laci klinik (1193) 37.500 / Cr 810004 37.500, tanggal = akhir periode');
select pg_temp.ok((select jenis='Lebih' and selisih=37500 and transfer_total=1037500 and penyelesaian='PendapatanLain' and penjelasan_lebih='barang lupa input? cek SO' and catatan_keuangan='catatan internal rahasia' from setoran_keuangan where setoran_id=pg_temp.sid('pK')),'keuangan K: jenis Lebih, penjelasan lebih dan catatan internal tersimpan');
select pg_temp.ok(not exists(select 1 from cash_advances where alasan like '%'||(select no_setoran from setoran where id=pg_temp.sid('pK'))||'%') and (select count(*) from setoran_kasbon where setoran_id=pg_temp.sid('pK'))=0,'lebih tidak membuat kasbon');
select pg_temp.ok(pg_temp.balanced(),'semua jurnal seimbang (sesudah K)');
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.save('dK4',public.setoran_detail(pg_temp.sid('pK')));
select pg_temp.ok((select r->>'status'='Disetujui' and r->>'badge'='Lunas' and (r->>'sisa')::numeric=0 from res where name='dK4'),'staf K sesudah disetujui: Lunas, sisa 0');
select pg_temp.ok(position('barang lupa' in (select r::text from res where name='dK4'))=0 and position('catatan internal' in (select r::text from res where name='dK4'))=0 and position('810004' in (select r::text from res where name='dK4'))=0,'staf tidak melihat penjelasan lebih, catatan internal, atau akun 810004');
select pg_temp.ok(position('Lebih' in (select r::text from res where name='dK4'))=0 and position('"selisih"' in (select r::text from res where name='dK4'))=0 and position('penjelasan_lebih' in (select r::text from res where name='dK4'))=0,'staf tidak melihat kata Lebih, kolom selisih, atau penjelasan_lebih');
select pg_temp.ok(not exists(select 1 from res, jsonb_array_elements(r->'riwayat') e where name='dK4' and e->>'jenis' in ('disetujui','void')),'riwayat staf K tanpa peristiwa persetujuan');
select pg_temp.save('lK',public.setoran_daftar(null,null,'e5200000-0000-4000-8000-00000000000b',null,null));
select pg_temp.ok(not exists(select 1 from res, jsonb_array_elements(r->'baris') b where name='lK' and (b ?| array['selisih','selisih_sementara','jenis','penyelesaian','diharapkan']) ),'daftar staf K: tanpa selisih/jenis/penyelesaian dan tanpa angka kelebihan');
select pg_temp.as_('03');
select pg_temp.save('lK2',public.setoran_daftar(null,null,'e5200000-0000-4000-8000-00000000000b',null,null));
select pg_temp.ok((select (b->>'selisih')::numeric=37500 and b->>'jenis'='Lebih' and b->>'penyelesaian'='PendapatanLain' from res, jsonb_array_elements(r->'baris') b where name='lK2'),'daftar penyetuju K: selisih +37.500, jenis Lebih');

-- ── 10. C: pas dengan pengeluaran (tidak ada jurnal selisih) ───────────────────────────────────
select pg_temp.as_('0c');
select pg_temp.save('apC',public.setoran_setujui(pg_temp.sid('pC'),pg_temp.kk('ap-c'),null,null,false,false,null));
reset role;
select pg_temp.ok((select r->>'penyelesaian'='Pas' and (r->>'selisih')::numeric=0 and r->>'journal_id' is null from res where name='apC'),'C pas: tanpa jurnal selisih');
select pg_temp.ok(pg_temp.jn('setoran',pg_temp.sid('pC'))=0 and (select count(*) from setoran_kasbon where setoran_id=pg_temp.sid('pC'))=0,'C pas: nol jurnal setoran, nol kasbon');
select pg_temp.ok((select count(*)=1 and sum(jumlah)=50000 and bool_and(tanggal=pg_temp.today()-3) from expenses where deskripsi like 'Setoran '||(select no_setoran from setoran where id=pg_temp.sid('pC'))||'%'),'C: pengeluaran 50.000 dibukukan satu kali pada tanggal barisnya');
select pg_temp.ok((select jenis='Pas' and selisih=0 and transfer_total=450000 and expected_amount=450000 from setoran_keuangan where setoran_id=pg_temp.sid('pC')),'C: kewajiban 500.000 - pengeluaran 50.000 = 450.000 = transfer: pas');

-- ── 11. A: kurang, pengeluaran, kasbon otomatis per karyawan ────────────────────────────────────
set local role authenticated;
select pg_temp.as_('0c');
select pg_temp.save('apA',public.setoran_setujui(pg_temp.sid('pA'),pg_temp.kk('ap-a'),null,null,false,false,'ok'));
reset role;
select pg_temp.ok((select r->>'status'='Disetujui' and r->>'penyelesaian'='Kasbon' and (r->>'selisih')::numeric=-100000 and jsonb_array_length(r->'kasbon_ids')=2 and jsonb_array_length(r->'pengeluaran_ids')=2 from res where name='apA'),'A disetujui: kurang 100.000 -> Kasbon untuk 2 karyawan, 2 pengeluaran dibukukan');
select pg_temp.ok((select count(*)=2 and sum(jumlah)=100000 and bool_and(metode_bayar='Tunai') and bool_and(shift_id is null) and bool_and(created_by=pg_temp.u('0c')) and bool_and(journal_entry_id is not null) and bool_and(branch_id='e5200000-0000-4000-8000-00000000000a') from expenses where deskripsi like 'Setoran '||(select no_setoran from setoran where id=pg_temp.sid('pA'))||'%'),'A: 2 pengeluaran tunai (60.000 + 40.000) dibukukan lewat post_expense_atomic, tanpa shift, pembuat = penyetuju');
select pg_temp.ok((select min(tanggal)=pg_temp.today()-4 and max(tanggal)=pg_temp.today()-3 from expenses where deskripsi like 'Setoran '||(select no_setoran from setoran where id=pg_temp.sid('pA'))||'%'),'A: tanggal pengeluaran = tanggal barisnya (t-4 dan t-3), bukan hari persetujuan');
select pg_temp.ok((select count(*)=2 from journal_entries j join expenses e on e.journal_entry_id=j.id where j.source='expense' and e.deskripsi like 'Setoran %'||'%' and e.deskripsi like (select 'Setoran '||no_setoran||'%' from setoran where id=pg_temp.sid('pA')) and j.tanggal=e.tanggal),'A: jurnal pengeluaran jatuh di tanggal pengeluaran masing-masing');
select pg_temp.ok((select sum(l.debit)=100000 and sum(l.credit)=100000 and bool_and(case when l.debit>0 then a.code in (public.expense_account_code('Operasional'),public.expense_account_code('Transportasi')) else a.code='1191' end) from journal_lines l join coa_accounts a on a.id=l.account_id join journal_entries j on j.id=l.entry_id join expenses e on e.journal_entry_id=j.id where e.deskripsi like (select 'Setoran '||no_setoran||'%' from setoran where id=pg_temp.sid('pA'))),'A: jurnal pengeluaran Dr beban kategori / Cr kas laci 1191 (akun tunai cabang)');
select pg_temp.ok((select count(*)=2 from expense_backdates b join expenses e on e.id=b.expense_id where e.deskripsi like (select 'Setoran '||no_setoran||'%' from setoran where id=pg_temp.sid('pA')) and b.reason like 'Pengeluaran dari dana setoran STR-%'),'A: jejak tanggal mundur otomatis (alasan sistem) tercatat untuk 2 pengeluaran');
select pg_temp.ok((select count(*)=2 from document_attachments d join expenses e on e.id=d.ref_id where d.modul='pengeluaran' and e.deskripsi like (select 'Setoran '||no_setoran||'%' from setoran where id=pg_temp.sid('pA'))),'A: lampiran bukti ikut tersimpan pada expense');
select pg_temp.ok(pg_temp.jn('setoran',pg_temp.sid('pA'))=1 and pg_temp.jline('setoran',pg_temp.sid('pA'),'182001')=100000 and pg_temp.jline('setoran',pg_temp.sid('pA'),'1191')=-100000 and pg_temp.jdate('setoran',pg_temp.sid('pA'))=pg_temp.today()-3,'A: jurnal kurang Dr 182001 Cashbon Karyawan 100.000 / Cr kas laci 1191, tanggal akhir periode');
select pg_temp.ok((select count(*)=2 and bool_and(status='Dicatat') and bool_and(jumlah=50000) and bool_and(tanggal=pg_temp.today()-3) and bool_and(approved_by=pg_temp.u('0c')) and bool_and(alasan like 'Selisih kurang setoran STR-%') and bool_and(tenor_bulan=1) from cash_advances where alasan like 'Selisih kurang setoran '||(select no_setoran from setoran where id=pg_temp.sid('pA'))||'%'),'A: dua kasbon Dicatat 50.000 (dibagi rata ke kasir shift), tanpa potong gaji otomatis');
select pg_temp.ok((select array_agg(employee_id order by employee_id)=array['e5300000-0000-4000-8000-000000000001','e5300000-0000-4000-8000-000000000002']::uuid[] and bool_and(mode='otomatis') and sum(jumlah)=100000 from setoran_kasbon where setoran_id=pg_temp.sid('pA')),'A: rekaman per karyawan (Kasir Satu, Kasir Dua) mode otomatis, total 100.000');
select pg_temp.ok(not exists(select 1 from setoran_kasbon k join cash_advances ca on ca.id=k.advance_id where k.setoran_id=pg_temp.sid('pA') and (ca.employee_id<>k.employee_id or ca.jumlah<>k.jumlah)),'A: setiap setoran_kasbon cocok dengan cash_advances (karyawan, jumlah)');
select pg_temp.ok((select jenis='Kurang' and selisih=-100000 and transfer_total=2800000 and expected_amount=2900000 and penyelesaian='Kasbon' and selisih_journal_id is not null from setoran_keuangan where setoran_id=pg_temp.sid('pA')),'A: keuangan tersimpan (diharapkan 2.900.000, dikonfirmasi 2.800.000, selisih -100.000)');
select pg_temp.ok((select count(*)=2 and count(expense_id)=2 and count(journal_id)=2 from setoran_pengeluaran where setoran_id=pg_temp.sid('pA')),'A: baris usulan terhubung ke expense dan jurnalnya');
select pg_temp.ok((select (select coalesce(sum(l.debit-l.credit),0) from journal_lines l join coa_accounts a on a.id=l.account_id join journal_entries j on j.id=l.entry_id where a.code='1191' and (j.source='setoran' and j.source_ref=pg_temp.sid('pA')::text or j.id in (select journal_entry_id from expenses where deskripsi like (select 'Setoran '||no_setoran||'%' from setoran where id=pg_temp.sid('pA')))))=-200000),'A: pengaruh total ke kas laci = -200.000 (pengeluaran 100.000 + kurang 100.000), tidak dobel');
select pg_temp.ok(pg_temp.balanced(),'semua jurnal seimbang (sesudah A)');
select pg_temp.ok(not exists(select 1 from cash_advances where status='Disetujui' and alasan like 'Selisih kurang setoran%'),'kasbon setoran tidak berstatus Disetujui (tidak otomatis memotong gaji)');
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.save('dA9',public.setoran_detail(pg_temp.sid('pA')));
select pg_temp.ok((select r->>'status'='Disetujui' and r->>'badge'='Lunas' and not r ?| array['keuangan','selisih','jenis','kasbon'] from res where name='dA9') and position('Kurang' in (select r::text from res where name='dA9'))=0 and position('182001' in (select r::text from res where name='dA9'))=0,'staf A sesudah disetujui: Lunas, tanpa kurang/kasbon/akun');
select pg_temp.as_('0c');
select pg_temp.save('dA10',public.setoran_detail(pg_temp.sid('pA')));
select pg_temp.ok((select jsonb_array_length(r->'keuangan'->'kasbon')=2 and r->'keuangan'->'kasbon'->0->>'status'='Dicatat' and (r->'keuangan'->>'selisih')::numeric=-100000 and r->'keuangan'->>'penyelesaian'='Kasbon' from res where name='dA10'),'penyetuju A: melihat 2 kasbon status Dicatat, selisih -100.000');
select pg_temp.save('apA2',public.setoran_setujui(pg_temp.sid('pA'),pg_temp.kk('ap-a'),null,null,false,false,'ok'));
reset role;
select pg_temp.ok((select (r->>'ulang')::boolean from res where name='apA2') and (select count(*) from journal_entries where source='setoran')=2 and (select count(*) from expenses where deskripsi like 'Setoran %')=3 and (select count(*) from cash_advances where alasan like 'Selisih kurang setoran%')=2,'approve diulang dengan kunci sama: hasil lama, tidak ada jurnal/expense/kasbon tambahan');
set local role authenticated;
select pg_temp.as_('0c');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pA'),pg_temp.kk('ap-a-lagi'),null,null,false,false,null)$$,'sudah diputuskan (Disetujui)','approve kedua dengan kunci baru ditolak (sudah diputuskan)');
select pg_temp.reject($$select public.setoran_tolak(pg_temp.sid('pA'),'terlambat',pg_temp.kk('ap-a-tolak'))$$,'sudah diputuskan','menolak setoran yang sudah disetujui ditolak');
select pg_temp.reject($$select public.setoran_putuskan_transfer(pg_temp.sid('pA'),(select (r->>'transfer_id')::uuid from res where name='t1'),false,'telat',pg_temp.kk('ap-a-tr'))$$,'sudah final','transfer pada setoran yang sudah disetujui tidak bisa diputuskan');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pA'),pg_temp.today()-3,'Operasional',1000,'x',pg_temp.lamp(pg_temp.sid('pA'),'ap-a-pe'),pg_temp.rev('pA'),pg_temp.kk('ap-a-pe'))$$,'SETORAN_STATUS','setoran yang sudah disetujui tidak bisa ditambah pengeluaran');
reset role;
-- jejak tak dapat diubah, bahkan oleh pemilik basis data
select pg_temp.reject($$update setoran set status='Diajukan' where id=pg_temp.sid('pA')$$,'tidak diperbolehkan','setoran Disetujui tidak bisa dikembalikan ke Diajukan');
select pg_temp.reject($$update setoran set catatan='ubah' where id=pg_temp.sid('pA')$$,'SETORAN_BEKU','setoran Disetujui beku (kolom apa pun)');
select pg_temp.reject($$delete from setoran where id=pg_temp.sid('pA')$$,'SETORAN_JEJAK','setoran tidak bisa dihapus');
select pg_temp.reject($$truncate setoran cascade$$,'SETORAN_JEJAK','TRUNCATE setoran ditolak');
select pg_temp.reject($$update setoran_keuangan set selisih=0,jenis='Pas',transfer_total=2900000 where setoran_id=pg_temp.sid('pA')$$,'SETORAN_BEKU','keuangan setoran Disetujui tidak bisa diubah');
select pg_temp.reject($$delete from setoran_keuangan where setoran_id=pg_temp.sid('pA')$$,'SETORAN_JEJAK','keuangan setoran tidak bisa dihapus');
select pg_temp.reject($$update setoran_transfer set jumlah=1 where setoran_id=pg_temp.sid('pA')$$,'SETORAN_BEKU','transfer pada setoran final tidak bisa diubah');
select pg_temp.reject($$delete from setoran_transfer where setoran_id=pg_temp.sid('pA')$$,'SETORAN_BEKU','transfer pada setoran final tidak bisa dihapus');
select pg_temp.reject($$insert into setoran_pengeluaran(setoran_id,tanggal,kategori,jumlah,lampiran,entered_by,request_key) values(pg_temp.sid('pA'),pg_temp.today()-3,'Operasional',1,pg_temp.lamp(pg_temp.sid('pA'),'ln522'),pg_temp.u('04'),gen_random_uuid())$$,'SETORAN_BEKU','pengeluaran tidak bisa disisipkan ke setoran final');
select pg_temp.reject($$delete from setoran_pengeluaran where setoran_id=pg_temp.sid('pA')$$,'SETORAN_BEKU','pengeluaran setoran final tidak bisa dihapus');
select pg_temp.reject($$update setoran_pengeluaran set jumlah=1 where setoran_id=pg_temp.sid('pA')$$,'SETORAN_BEKU','baris pengeluaran final tidak bisa diubah');
select pg_temp.reject($$update setoran_kasbon set jumlah=1 where setoran_id=pg_temp.sid('pA')$$,'SETORAN_JEJAK','rekaman kasbon tidak bisa diubah');
select pg_temp.reject($$delete from setoran_kasbon where setoran_id=pg_temp.sid('pA')$$,'SETORAN_JEJAK','rekaman kasbon tidak bisa dihapus');
select pg_temp.reject($$update setoran_event set jenis='x'$$,'SETORAN_JEJAK','riwayat tidak bisa diubah');
select pg_temp.reject($$delete from setoran_event$$,'SETORAN_JEJAK','riwayat tidak bisa dihapus');
select pg_temp.reject($$truncate setoran_event$$,'SETORAN_JEJAK','TRUNCATE riwayat ditolak');
select pg_temp.reject($$update setoran_permintaan set jenis='x'$$,'SETORAN_JEJAK','catatan idempotensi tidak bisa diubah');
select pg_temp.reject($$update setoran_shift set aktif=false where setoran_id=pg_temp.sid('pA')$$,'SETORAN_BEKU','shift setoran Disetujui tidak bisa dilepas langsung');
select pg_temp.reject($$insert into setoran(no_setoran,branch_id,periode_mulai,periode_selesai,jadwal,status,request_key,created_by) values('X','e5200000-0000-4000-8000-00000000000a',pg_temp.today()-30,pg_temp.today()-29,pg_temp.today()-29,'Disetujui',gen_random_uuid(),pg_temp.u('01'))$$,'harus berstatus Draft','setoran baru langsung berstatus Disetujui ditolak');
select pg_temp.reject($$update setoran_keuangan set jenis='Pas' where setoran_id=pg_temp.sid('pD')$$,'violates check constraint','kolom jenis dan selisih tidak boleh tidak konsisten (CHECK)');

-- ── 12. G: pas (setelah uji pemisahan tugas dan tutup buku) ─────────────────────────────────────
set local role authenticated;
select pg_temp.as_('03');
select pg_temp.save('apG',public.setoran_setujui(pg_temp.sid('pG'),pg_temp.kk('ap-g'),null,null,false,false,null));
reset role;
select pg_temp.ok((select r->>'penyelesaian'='Pas' from res where name='apG') and pg_temp.jn('setoran',pg_temp.sid('pG'))=0,'G pas (transfer = kewajiban): tanpa jurnal selisih');

-- ── 13. D: shift baru muncul sesudah diajukan, lalu alokasi manual ──────────────────────────────
select pg_temp.save('sD2',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-00000000000d','05',3,0,10000)));
set local role authenticated;
select pg_temp.as_('03');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pD'),pg_temp.kk('ap-d-baru'),null,null,false,false,null)$$,'SETORAN_SHIFT_BARU','ada shift tertutup baru di periode yang belum masuk setoran: persetujuan ditolak');
reset role;
delete from cashier_shifts where id=pg_temp.sid('sD2');
set local role authenticated;
select pg_temp.as_('03');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pD'),pg_temp.kk('ap-d-1'),null,'{"x":1}'::jsonb,false,false,null)$$,'pilih 1 sampai 10 karyawan','alokasi bukan array ditolak');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pD'),pg_temp.kk('ap-d-2'),null,'[{"employee_id":"e5300000-0000-4000-8000-000000000003","jumlah":60000},{"employee_id":"e5300000-0000-4000-8000-000000000001","jumlah":30000}]'::jsonb,false,false,null)$$,'harus sama dengan selisih kurang','pembagian tidak sama dengan selisih ditolak');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pD'),pg_temp.kk('ap-d-3'),null,'[{"employee_id":"e5300000-0000-4000-8000-000000000004","jumlah":100000}]'::jsonb,false,false,null)$$,'tidak ditemukan atau sudah tidak aktif','karyawan nonaktif ditolak');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pD'),pg_temp.kk('ap-d-4'),null,'[{"employee_id":"e5300000-0000-4000-8000-000000000003","jumlah":50000},{"employee_id":"e5300000-0000-4000-8000-000000000003","jumlah":50000}]'::jsonb,false,false,null)$$,'hanya boleh dipilih sekali','karyawan ganda ditolak');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pD'),pg_temp.kk('ap-d-5'),null,'[{"employee_id":"e5300000-0000-4000-8000-0000000000ff","jumlah":100000}]'::jsonb,false,false,null)$$,'tidak ditemukan atau sudah tidak aktif','karyawan yang tidak ada ditolak');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pD'),pg_temp.kk('ap-d-6'),null,'[{"employee_id":"e5300000-0000-4000-8000-000000000003","jumlah":0},{"employee_id":"e5300000-0000-4000-8000-000000000001","jumlah":100000}]'::jsonb,false,false,null)$$,'lebih dari 0','jumlah 0 pada alokasi ditolak');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pD'),pg_temp.kk('ap-d-7'),null,'[{"employee_id":"e5300000-0000-4000-8000-000000000003","jumlah":99999.995},{"employee_id":"e5300000-0000-4000-8000-000000000001","jumlah":0.005}]'::jsonb,false,false,null)$$,'lebih dari 0','jumlah dengan 3 desimal pada alokasi ditolak');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pD'),pg_temp.kk('ap-d-8'),null,'[]'::jsonb,false,false,null)$$,'pilih 1 sampai 10 karyawan','alokasi kosong ditolak');
select pg_temp.save('apD',public.setoran_setujui(pg_temp.sid('pD'),pg_temp.kk('ap-d-ok'),null,'[{"employee_id":"e5300000-0000-4000-8000-000000000003","jumlah":70000},{"employee_id":"e5300000-0000-4000-8000-000000000001","jumlah":30000}]'::jsonb,false,false,'ditimpa Finance'));
reset role;
select pg_temp.ok((select r->>'penyelesaian'='Kasbon' and jsonb_array_length(r->'kasbon_ids')=2 from res where name='apD') and (select count(*) from cash_advances where alasan like 'Selisih kurang setoran '||(select no_setoran from setoran where id=pg_temp.sid('pD'))||'%')=2,'D: alokasi manual Finance: dua kasbon');
select pg_temp.ok((select bool_and(mode='manual') and sum(jumlah)=100000 and max(jumlah) filter (where employee_id='e5300000-0000-4000-8000-000000000003')=70000 and max(jumlah) filter (where employee_id='e5300000-0000-4000-8000-000000000001')=30000 from setoran_kasbon where setoran_id=pg_temp.sid('pD')) and not exists(select 1 from setoran_kasbon where setoran_id=pg_temp.sid('pD') and employee_id='e5300000-0000-4000-8000-000000000002'),'D: Budi 70.000 dan Kasir Satu 30.000 (mode manual); kasir shift lain tidak dibebani');
select pg_temp.ok(pg_temp.jline('setoran',pg_temp.sid('pD'),'182001')=100000 and pg_temp.balanced(),'D: jurnal Dr 182001 100.000 seimbang');

-- ── 14. E: pembulatan (0,03 dibagi dua orang) ───────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_('0c');
select pg_temp.save('apE',public.setoran_setujui(pg_temp.sid('pE'),pg_temp.kk('ap-e'),null,null,false,false,null));
reset role;
select pg_temp.ok((select (r->>'selisih')::numeric=-0.03 from res where name='apE') and (select count(*)=2 and sum(jumlah)=0.03 and max(jumlah) filter (where employee_id='e5300000-0000-4000-8000-000000000001')=0.02 and max(jumlah) filter (where employee_id='e5300000-0000-4000-8000-000000000002')=0.01 from setoran_kasbon where setoran_id=pg_temp.sid('pE')),'E: pembulatan sen: 0,03 -> 0,02 (urutan id pertama) + 0,01; total tepat 0,03');
select pg_temp.ok(pg_temp.jline('setoran',pg_temp.sid('pE'),'182001')=0.03 and pg_temp.balanced(),'E: jurnal 0,03 seimbang');

-- ── 15. F: kasir tanpa data karyawan ────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_('03');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pF'),pg_temp.kk('ap-f-1'),null,null,false,false,null)$$,'SETORAN_PENANGGUNG','kasir shift tanpa karyawan: kasbon otomatis ditolak (Finance harus memilih)');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pF'),pg_temp.kk('ap-f-2'),null,null,true,false,null)$$,'wajib diberi catatan alasan','beban perusahaan tanpa alasan ditolak');
select pg_temp.save('apF',public.setoran_setujui(pg_temp.sid('pF'),pg_temp.kk('ap-f-3'),null,null,true,false,'kasir belum terdaftar sebagai karyawan'));
reset role;
select pg_temp.ok((select r->>'penyelesaian'='BebanPerusahaan' and jsonb_array_length(r->'kasbon_ids')=0 from res where name='apF') and pg_temp.jline('setoran',pg_temp.sid('pF'),'760002')=100000 and pg_temp.jline('setoran',pg_temp.sid('pF'),'110003')=-100000,'F: beban perusahaan Dr 760002 / Cr kas (110003 default) tanpa kasbon');
select pg_temp.ok((select count(*)=0 from setoran_kasbon where setoran_id=pg_temp.sid('pF')) and pg_temp.balanced(),'F: tidak ada rekaman kasbon, jurnal seimbang');

-- ── 16. H: angka shift berubah sesudah diajukan -> tolak -> ajukan ulang ────────────────────────
update cashier_shifts set closing_balance=750000,expected_cash=750000,closing_breakdown=jsonb_build_object('Tunai',750000) where id=pg_temp.sid('sH1');
set local role authenticated;
select pg_temp.as_('03');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pH'),pg_temp.kk('ap-h-1'),null,null,false,false,null)$$,'SETORAN_BERUBAH','angka shift berubah sejak diajukan: persetujuan ditolak');
select pg_temp.reject($$select public.setoran_tolak(pg_temp.sid('pH'),'x',pg_temp.kk('ap-h-t0'))$$,'SETORAN_ALASAN','menolak dengan alasan < 3 huruf ditolak');
select pg_temp.save('tolH',public.setoran_tolak(pg_temp.sid('pH'),'angka shift berubah, hitung ulang',pg_temp.kk('ap-h-t1')));
select pg_temp.as_('04');
select pg_temp.save('dH',public.setoran_detail(pg_temp.sid('pH')));
select pg_temp.ok((select r->>'status'='Ditolak' and r->>'alasan_tolak'='angka shift berubah, hitung ulang' and (r->>'kewajiban')::numeric=750000 and (r->>'sisa')::numeric=50000 and r->>'badge'='Terlambat' from res where name='dH'),'staf melihat Ditolak + alasan; kewajiban hidup 750.000, sisa 50.000, Terlambat');
select pg_temp.pay('pH',50000,'Serah tunai','04','03','h-t2',1);
select pg_temp.as_('04');
select pg_temp.save('ajH',public.setoran_ajukan(pg_temp.sid('pH'),pg_temp.rev('pH'),pg_temp.kk('h-aj2')));
reset role;
select pg_temp.ok((select expected_amount=750000 and shift_net=750000 and selisih is null from setoran_keuangan where setoran_id=pg_temp.sid('pH')) and (select submitted_by=pg_temp.u('04') from setoran where id=pg_temp.sid('pH')),'pengajuan ulang: snapshot diperbarui (750.000), pengaju sekarang kasir');
set local role authenticated;
select pg_temp.as_('0c');
select pg_temp.save('apH',public.setoran_setujui(pg_temp.sid('pH'),pg_temp.kk('ap-h-2'),null,null,false,false,null));
select pg_temp.ok((select r->>'penyelesaian'='Pas' from res where name='apH'),'H: setelah diajukan ulang dan transfer tambahan dikonfirmasi: pas, disetujui Finance lain');
reset role;
select pg_temp.ok((select count(*)=5 from setoran_event where setoran_id=pg_temp.sid('pH') and jenis in ('diajukan','ditolak','disetujui','dibuat')) and (select count(*)>=2 from setoran_event where setoran_id=pg_temp.sid('pH') and jenis='diajukan'),'H: riwayat memuat dibuat, diajukan (2x), ditolak, disetujui');

-- ── 17. L: selisih besar butuh konfirmasi ───────────────────────────────────────────────────────
select pg_temp.noauth();
insert into branches(id,code,name,type) values('e5200000-0000-4000-8000-0000000000a5','STRL','STR cabang L','PETSHOP');
insert into user_branches(user_id,branch_id) values(pg_temp.u('04'),'e5200000-0000-4000-8000-0000000000a5'),(pg_temp.u('03'),'e5200000-0000-4000-8000-0000000000a5');
select pg_temp.save('sL1',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-0000000000a5','04',3,0,7000000)));
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.save('pL',public.setoran_buat('e5200000-0000-4000-8000-0000000000a5',pg_temp.today()-3,pg_temp.today()-3,pg_temp.today()-2,'12:00',pg_temp.kk('l-buat')));
select pg_temp.pay('pL',1000000,'Transfer','04','03','l-t1',2);
select pg_temp.sub('pL','04','l-aj');
select pg_temp.as_('03');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pL'),pg_temp.kk('ap-l-1'),null,null,false,false,null)$$,'SETORAN_SELISIH_BESAR','selisih > Rp 5.000.000 tanpa konfirmasi ditolak');
select pg_temp.save('apL',public.setoran_setujui(pg_temp.sid('pL'),pg_temp.kk('ap-l-2'),null,null,false,true,null));
reset role;
select pg_temp.ok((select (r->>'selisih')::numeric=-6000000 and r->>'penyelesaian'='Kasbon' from res where name='apL') and (select jumlah=6000000 and employee_id='e5300000-0000-4000-8000-000000000001' from setoran_kasbon where setoran_id=pg_temp.sid('pL')),'selisih besar dengan konfirmasi: kasbon Kasir Satu Rp 6.000.000');

-- ── 18. I: void (pembalik jurnal, pengeluaran, kasbon, shift dilepas) ───────────────────────────
set local role authenticated;
select pg_temp.as_('03');
select pg_temp.save('apI',public.setoran_setujui(pg_temp.sid('pI'),pg_temp.kk('ap-i'),null,null,false,false,null));
reset role;
select pg_temp.ok((select (r->>'selisih')::numeric=-80000 from res where name='apI') and (select count(*)=1 and sum(jumlah)=80000 from setoran_kasbon where setoran_id=pg_temp.sid('pI')),'I: kurang 80.000 -> kasbon Kasir Satu 80.000 (kasir tunggal)');
select pg_temp.save('i_exp',jsonb_build_object('id',(select id from expenses where deskripsi like (select 'Setoran '||no_setoran||'%' from setoran where id=pg_temp.sid('pI')))));
select pg_temp.ok((select jumlah=20000 and voided_at is null from expenses where id=pg_temp.sid('i_exp')),'I: pengeluaran 20.000 dibukukan');
set local role authenticated;
select pg_temp.as_('02');
select pg_temp.reject($$select public.setoran_void(pg_temp.sid('pI'),'salah input',pg_temp.kk('v-i-admin'))$$,'SETORAN_DITOLAK_PERAN','Admin tidak boleh membatalkan setoran yang disetujui');
select pg_temp.as_('04');
select pg_temp.reject($$select public.setoran_void(pg_temp.sid('pI'),'salah input',pg_temp.kk('v-i-staff'))$$,'SETORAN_DITOLAK_PERAN','kasir tidak boleh void');
select pg_temp.as_('0c');
select pg_temp.reject($$select public.setoran_void(pg_temp.sid('pI'),'ab',pg_temp.kk('v-i-short'))$$,'SETORAN_ALASAN','void tanpa alasan cukup ditolak');
select pg_temp.reject($$select public.setoran_void(pg_temp.sid('pJ'),'belum disetujui',pg_temp.kk('v-d-notapproved'))$$,'hanya setoran Disetujui','void setoran yang belum disetujui ditolak');
reset role;
select pg_temp.noauth();
update accounting_locks set closed_until=pg_temp.today()-3;
set local role authenticated;
select pg_temp.as_('0c');
select pg_temp.reject($$select public.setoran_void(pg_temp.sid('pI'),'salah input periode tutup',pg_temp.kk('v-i-lock'))$$,'periode akuntansi untuk tanggal','void pada periode akuntansi tertutup ditolak');
reset role;
select pg_temp.noauth();
update accounting_locks set closed_until=null;
set local role authenticated;
select pg_temp.as_('0c');
select pg_temp.save('vI',public.setoran_void(pg_temp.sid('pI'),'salah input angka',pg_temp.kk('v-i-ok')));
reset role;
select pg_temp.ok(pg_temp.st('pI')='Void' and (select void_by=pg_temp.u('0c') and void_reason='salah input angka' from setoran where id=pg_temp.sid('pI')),'I di-void oleh Finance dengan alasan');
select pg_temp.ok(pg_temp.jn('setoran-batal',pg_temp.sid('pI'))=1 and pg_temp.jline('setoran-batal',pg_temp.sid('pI'),'182001')=-80000 and pg_temp.jline('setoran',pg_temp.sid('pI'),'182001')+pg_temp.jline('setoran-batal',pg_temp.sid('pI'),'182001')=0,'void: jurnal pembalik persis (182001 -80.000), net 0');
select pg_temp.ok((select jumlah=0 and voided_at is not null and void_reason like 'Setoran STR-%dibatalkan: salah input angka' from expenses where id=pg_temp.sid('i_exp')) and (select count(*)=1 from journal_entries where source='expense-reversal' and deskripsi like 'Pembalik pengeluaran: Setoran STR-%'),'void: pengeluaran dibatalkan lewat pola koreksi pengeluaran (jumlah 0, pembalik tercatat)');
select pg_temp.ok((select count(*)=1 and bool_and(status='Batal') from cash_advances where id in (select advance_id from setoran_kasbon where setoran_id=pg_temp.sid('pI'))),'void: kasbon karyawan dibatalkan (Batal)');
select pg_temp.ok((select count(*)=0 from setoran_shift where setoran_id=pg_temp.sid('pI') and aktif) and (select reversal_journal_id is not null from setoran_keuangan where setoran_id=pg_temp.sid('pI')),'void: shift dilepas, jurnal pembalik terhubung');
select pg_temp.ok(pg_temp.balanced(),'semua jurnal seimbang (sesudah void I)');
select pg_temp.reject($$update setoran set void_reason='ubah' where id=pg_temp.sid('pI')$$,'SETORAN_BEKU','setoran Void beku');
select pg_temp.reject($$update setoran set status='Disetujui' where id=pg_temp.sid('pI')$$,'tidak diperbolehkan','Void tidak bisa dihidupkan kembali');
set local role authenticated;
select pg_temp.as_('0c');
select pg_temp.save('vI2',public.setoran_void(pg_temp.sid('pI'),'salah input angka',pg_temp.kk('v-i-ok')));
select pg_temp.ok((select (r->>'ulang')::boolean from res where name='vI2'),'void idempoten (kunci sama)');
select pg_temp.reject($$select public.setoran_void(pg_temp.sid('pI'),'lagi',pg_temp.kk('v-i-lagi'))$$,'hanya setoran Disetujui','void kedua dengan kunci baru ditolak');
select pg_temp.as_('04');
select pg_temp.save('pI2',public.setoran_buat('e5200000-0000-4000-8000-0000000000a3',pg_temp.today()-3,pg_temp.today()-3,pg_temp.today()-2,'12:00',pg_temp.kk('i-buat2')));
reset role;
select pg_temp.ok((select count(*)=1 from setoran_shift where setoran_id=pg_temp.sid('pI2') and aktif),'setelah void: periode yang sama bisa dibuat ulang dan shift tersambung kembali');
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.save('bI2',public.setoran_batalkan_draft(pg_temp.sid('pI2'),'dibuat untuk uji',pg_temp.kk('i-buang2')));
reset role;
select pg_temp.ok(pg_temp.st('pI2')='Void' and (select count(*)=0 from setoran_shift where setoran_id=pg_temp.sid('pI2') and aktif),'membuang Draft: status Void, shift dilepas');

-- ── 19. J: kasbon sudah diproses menahan void ───────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_('03');
select pg_temp.save('apJ',public.setoran_setujui(pg_temp.sid('pJ'),pg_temp.kk('ap-j'),null,null,false,false,null));
reset role;
update cash_advances set status='Lunas' where id in (select advance_id from setoran_kasbon where setoran_id=pg_temp.sid('pJ'));
set local role authenticated;
select pg_temp.as_('01');
select pg_temp.reject($$select public.setoran_void(pg_temp.sid('pJ'),'uji kasbon diproses',pg_temp.kk('v-j-1'))$$,'SETORAN_KASBON_BERUBAH','void ditolak bila kasbon sudah diproses (bukan Dicatat)');
reset role;
update cash_advances set status='Dicatat' where id in (select advance_id from setoran_kasbon where setoran_id=pg_temp.sid('pJ'));
set local role authenticated;
select pg_temp.as_('01');
select pg_temp.save('vJ',public.setoran_void(pg_temp.sid('pJ'),'owner membatalkan',pg_temp.kk('v-j-2')));
reset role;
select pg_temp.ok(pg_temp.st('pJ')='Void' and pg_temp.jn('setoran-batal',pg_temp.sid('pJ'))=1,'J: Owner dapat void; jurnal pembalik tercatat');

-- ── 20. batalkan Draft/Ditolak dan batas lain ───────────────────────────────────────────────────
select pg_temp.ok((select count(*) from setoran where status='Disetujui')=9 and (select count(*) from setoran where status='Void')=3 and (select count(*) from setoran where status='Diajukan')=0,'status akhir: 9 Disetujui (A,K,C,D,E,F,G,H,L), 3 Void (I, I2, J), 0 menunggu');

-- ── 21. invarian global ─────────────────────────────────────────────────────────────────────────
select pg_temp.ok((select count(*) from expense_posting_requests where request_key like 'setoran:%')=(select count(*) from setoran_pengeluaran where expense_id is not null) and (select count(*) from setoran_pengeluaran where expense_id is not null)=4,'tepat satu jejak posting pengeluaran per baris (4 baris diposting: A2, C1, I1)');
select pg_temp.ok(not exists(select 1 from setoran_pengeluaran p join expenses e on e.id=p.expense_id join journal_entries j on j.id=e.journal_entry_id where j.tanggal<>p.tanggal or e.tanggal<>p.tanggal or e.jumlah<>p.jumlah and e.voided_at is null),'tanggal dan jumlah expense = baris usulan untuk semua yang diposting');
select pg_temp.ok((select count(*) from journal_entries where source='setoran')=8 and (select count(*) from journal_entries where source='setoran-batal')=2,'jurnal selisih: 8 (A, K, D, E, F, L, I, J; C/G/H pas tanpa jurnal) dan 2 pembalik (I, J)');
select pg_temp.ok(pg_temp.balanced(),'seluruh jurnal seimbang di akhir');
select pg_temp.ok((select admin_online_private.guard_all())=0 and (select admin_online_private.fence_all())=0,'pagar Admin Online idempoten: guard_all dan fence_all tidak menemukan fungsi/tabel baru yang belum terjaga');

-- ── 22. rekap, umur, terlambat ──────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.as_('03');
select pg_temp.save('rk',public.setoran_rekap(null,null,null,null,null));
select pg_temp.ok((select (r->'total'->>'jumlah')::int=9 and (r->'total'->>'kewajiban')::numeric=14850000 and (r->'total'->>'pengeluaran')::numeric=150000 and (r->'total'->>'diharapkan')::numeric=14700000 from res where name='rk'),'rekap total: 9 setoran, kewajiban 14.850.000, pengeluaran 150.000, diharapkan 14.700.000');
select pg_temp.ok((select (r->'total'->>'disetor')::numeric=8437499.97 and (r->'total'->>'kurang')::numeric=6300000.03 and (r->'total'->>'lebih')::numeric=37500 from res where name='rk'),'rekap total: disetor 8.437.499,97; kurang 6.300.000,03; lebih 37.500 (khusus penyetuju)');
select pg_temp.ok((select (r->'total'->>'menunggu')::int=0 and (r->>'menunggu_persetujuan')::int=0 and (r->>'terlambat')::int=0 from res where name='rk'),'rekap: 0 menunggu persetujuan, 0 terlambat');
select pg_temp.ok((select (c->>'kurang')::numeric=100000 and (c->>'lebih')::numeric=0 and (c->>'disetor')::numeric=2800000 and (c->>'kewajiban')::numeric=3000000 from res, jsonb_array_elements(r->'cabang') c where name='rk' and c->>'cabang'='STR petshop A'),'rekap per cabang A: kewajiban 3.000.000, disetor 2.800.000, kurang 100.000');
select pg_temp.ok((select (c->>'lebih')::numeric=37500 and (c->>'kurang')::numeric=0 from res, jsonb_array_elements(r->'cabang') c where name='rk' and c->>'cabang'='STR klinik K'),'rekap per cabang K: lebih 37.500');
select pg_temp.ok((public.setoran_rekap(null,null,'e5200000-0000-4000-8000-00000000000b',null,null)->'total'->>'jumlah')::int=1 and (public.setoran_rekap(pg_temp.today()-2,pg_temp.today()-2,null,null,null)->'total'->>'jumlah')::int=1,'rekap: filter cabang dan tanggal');
select pg_temp.ok((public.setoran_rekap(null,null,null,'Void',null)->'total'->>'jumlah')::int=3 and (public.setoran_rekap(null,null,null,'Disetujui',null)->'total'->>'jumlah')::int=9 and (public.setoran_rekap(null,null,null,'Diajukan',null)->'total'->>'jumlah')::int=0,'rekap: filter status (Void 3, Disetujui 9, Diajukan 0)');
select pg_temp.ok((public.setoran_rekap(null,null,null,null,pg_temp.u('07'))->'total'->>'jumlah')::int=1 and (public.setoran_rekap(null,null,null,null,pg_temp.u('04'))->'total'->>'jumlah')::int>=8,'rekap: filter kasir (07 hanya F; 04 hampir semuanya)');
select pg_temp.reject($$select public.setoran_rekap(null,null,null,'Salah',null)$$,'status tidak dikenal','rekap: status tidak dikenal ditolak');
select pg_temp.as_('0a');
select pg_temp.ok((public.setoran_rekap(null,null,null,null,null)->'total'->>'jumlah')::int=0 and jsonb_array_length(public.setoran_daftar(null,null,null,null,null)->'baris')=0,'Admin cabang X: rekap dan daftar kosong (tidak melihat cabang lain)');
select pg_temp.as_('01');
select pg_temp.ok((public.setoran_rekap(null,null,null,null,null)->'total'->>'jumlah')::int=9,'Owner melihat semua cabang di rekap');
-- umur persetujuan (aging): 4 setoran Diajukan dengan umur berbeda + 1 Draft terlambat
reset role;
select pg_temp.noauth();
insert into branches(id,code,name,type) values('e5200000-0000-4000-8000-0000000000a6','STRM','STR cabang M','PETSHOP');
insert into user_branches(user_id,branch_id) select pg_temp.u(n),'e5200000-0000-4000-8000-0000000000a6' from unnest(array['03','04','0c']) n;
select pg_temp.save('sM1',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-0000000000a6','04',30,0,100000)));
select pg_temp.save('sM2',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-0000000000a6','04',20,0,100000)));
select pg_temp.save('sM3',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-0000000000a6','04',12,0,100000)));
select pg_temp.save('sM4',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-0000000000a6','04',6,0,100000)));
select pg_temp.save('sM5',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-0000000000a6','04',40,0,100000)));
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.save('pM1',public.setoran_buat('e5200000-0000-4000-8000-0000000000a6',pg_temp.today()-30,pg_temp.today()-30,pg_temp.today()-29,'12:00',pg_temp.kk('m1')));
select pg_temp.save('pM2',public.setoran_buat('e5200000-0000-4000-8000-0000000000a6',pg_temp.today()-20,pg_temp.today()-20,pg_temp.today()-19,'12:00',pg_temp.kk('m2')));
select pg_temp.save('pM3',public.setoran_buat('e5200000-0000-4000-8000-0000000000a6',pg_temp.today()-12,pg_temp.today()-12,pg_temp.today()-11,'12:00',pg_temp.kk('m3')));
select pg_temp.save('pM4',public.setoran_buat('e5200000-0000-4000-8000-0000000000a6',pg_temp.today()-6,pg_temp.today()-6,pg_temp.today()-5,'12:00',pg_temp.kk('m4')));
select pg_temp.save('pM5',public.setoran_buat('e5200000-0000-4000-8000-0000000000a6',pg_temp.today()-40,pg_temp.today()-40,pg_temp.today()-39,'12:00',pg_temp.kk('m5')));
select pg_temp.sub('pM1','04','m1-aj');select pg_temp.sub('pM2','04','m2-aj');select pg_temp.sub('pM3','04','m3-aj');select pg_temp.sub('pM4','04','m4-aj');
reset role;
select pg_temp.noauth();
alter table setoran disable trigger setoran_status_guard;
update setoran set submitted_at=now()-interval '2 days' where id=pg_temp.sid('pM2');
update setoran set submitted_at=now()-interval '5 days' where id=pg_temp.sid('pM3');
update setoran set submitted_at=now()-interval '9 days' where id=pg_temp.sid('pM4');
alter table setoran enable trigger setoran_status_guard;
set local role authenticated;
select pg_temp.as_('03');
select pg_temp.save('rk2',public.setoran_rekap(null,null,'e5200000-0000-4000-8000-0000000000a6',null,null));
select pg_temp.ok((select (r->>'menunggu_persetujuan')::int=4 and (r->'umur_menunggu'->>'hari_0_1')::int=1 and (r->'umur_menunggu'->>'hari_2_3')::int=1 and (r->'umur_menunggu'->>'hari_4_7')::int=1 and (r->'umur_menunggu'->>'hari_8_plus')::int=1 from res where name='rk2'),'umur persetujuan: 4 menunggu = 1 (0-1 hari) + 1 (2-3) + 1 (4-7) + 1 (8+)');
select pg_temp.ok((select (r->>'terlambat')::int=1 and (r->'total'->>'menunggu')::int=4 and (r->'total'->>'jumlah')::int=5 from res where name='rk2'),'rekap: 1 setoran Draft terlambat, 4 menunggu, 5 setoran di cabang M');
select pg_temp.save('lM',public.setoran_daftar(null,null,'e5200000-0000-4000-8000-0000000000a6','Diajukan',null));
select pg_temp.ok((select jsonb_array_length(r->'baris')=4 and (select max((b->>'umur_hari')::int) from jsonb_array_elements(r->'baris') b)=9 and (select min((b->>'umur_hari')::int) from jsonb_array_elements(r->'baris') b)=0 from res where name='lM'),'inbox Menunggu persetujuan: 4 baris, umur 0..9 hari');
select pg_temp.ok((select bool_and((b->>'selisih_sementara')::numeric=-100000 and (b->>'diharapkan')::numeric=100000) from res, jsonb_array_elements(r->'baris') b where name='lM'),'inbox penyetuju memuat diharapkan dan selisih sementara');
select pg_temp.as_('04');
select pg_temp.ok((select bool_and(not b ?| array['selisih_sementara','diharapkan','selisih']) from (select jsonb_array_elements(public.setoran_daftar(null,null,'e5200000-0000-4000-8000-0000000000a6','Diajukan',null)->'baris') b) q),'inbox yang sama dilihat staf: tanpa diharapkan/selisih');
select pg_temp.save('dM5',public.setoran_detail(pg_temp.sid('pM5')));
select pg_temp.ok((select r->>'badge'='Terlambat' and r->>'status_periode'='Terlambat' from res where name='dM5'),'Draft yang lewat jadwal dan belum lunas: badge Terlambat');
select pg_temp.save('bM5',public.setoran_batalkan_draft(pg_temp.sid('pM5'),'periode ini tidak jadi disetor',pg_temp.kk('m5-buang')));
select pg_temp.as_('08');
select pg_temp.reject($$select public.setoran_batalkan_draft(pg_temp.sid('pM1'),'iseng',pg_temp.kk('m1-buang-x'))$$,'cabang ini tidak dapat diakses','staf cabang lain tidak bisa membuang setoran');

-- ── 23. pintasan SO (tanpa offset otomatis) ────────────────────────────────────────────────────
select pg_temp.as_('03');
select pg_temp.ok(not (public.setoran_so_terakhir('e5200000-0000-4000-8000-00000000000a')->>'ada')::boolean,'SO terakhir: belum ada hasil opname -> ada=false');
reset role;
select pg_temp.noauth();
insert into warehouses(id,branch_id,code,name,type) values('e5700000-0000-4000-8000-000000000001','e5200000-0000-4000-8000-00000000000a','STRWH','STR gudang','RETAIL');
insert into opname_orders(id,no_opname,warehouse_id,tanggal_mulai,penanggung_jawab) values('e5710000-0000-4000-8000-000000000001','OPN-STR-1','e5700000-0000-4000-8000-000000000001',pg_temp.today()-9,'uji');
insert into opname_results(id,no_hasil,order_id,tanggal) values('e5720000-0000-4000-8000-000000000001','OPR-STR-1','e5710000-0000-4000-8000-000000000001',pg_temp.today()-8);
set local role authenticated;
select pg_temp.as_('03');
select pg_temp.save('so',public.setoran_so_terakhir('e5200000-0000-4000-8000-00000000000a'));
select pg_temp.ok((select (r->>'ada')::boolean and r->>'no_hasil'='OPR-STR-1' and r->>'result_id'='e5720000-0000-4000-8000-000000000001' from res where name='so'),'SO terakhir cabang A: hasil OPR-STR-1 ditemukan (pintasan untuk Finance)');
select pg_temp.as_('0a');
select pg_temp.reject($$select public.setoran_so_terakhir('e5200000-0000-4000-8000-00000000000a')$$,'cabang ini tidak dapat diakses','SO terakhir: Admin cabang lain ditolak');
reset role;
select pg_temp.ok(not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'setoran\_%' and p.prosrc ~* '(stock|stok|opname_counts|opname_posting)' and p.proname<>'setoran_so_terakhir'),'tidak ada fungsi setoran selain pintasan SO yang menyentuh stok/opname (tidak ada offset otomatis)');

-- ── 24. Admin Online ditolak pada SETIAP fungsi, anon, baca langsung tabel ──────────────────────
set local role authenticated;
select pg_temp.as_('06');
select pg_temp.reject('select public.'||stmt,'ADMIN_ONLINE_FUNCTION_DENIED','Admin Online ditolak: '||split_part(stmt,'(',1)) from unnest(array[
 'setoran_akses()','setoran_rekening_tujuan(null::uuid)','setoran_buat(null::uuid,null::date,null::date,null::date,null::text,null::uuid)','setoran_sinkron(null::uuid)',
 'setoran_tambah_pengeluaran(null::uuid,null::date,null::text,null::numeric,null::text,null::jsonb,null::integer,null::uuid)','setoran_hapus_pengeluaran(null::uuid,null::uuid,null::integer,null::uuid)',
 'setoran_tambah_transfer(null::uuid,null::date,null::numeric,null::text,null::uuid,null::jsonb,null::text,null::integer,null::uuid)','setoran_hapus_transfer(null::uuid,null::uuid,null::integer,null::uuid)',
 'setoran_putuskan_transfer(null::uuid,null::uuid,null::boolean,null::text,null::uuid)','setoran_ajukan(null::uuid,null::integer,null::uuid)','setoran_batalkan_draft(null::uuid,null::text,null::uuid)',
 'setoran_tolak(null::uuid,null::text,null::uuid)','setoran_setujui(null::uuid,null::uuid,null::text,null::jsonb,null::boolean,null::boolean,null::text)','setoran_void(null::uuid,null::text,null::uuid)',
 'setoran_daftar(null::date,null::date,null::uuid,null::text,null::uuid)','setoran_detail(null::uuid)','setoran_rekap(null::date,null::date,null::uuid,null::text,null::uuid)','setoran_so_terakhir(null::uuid)']) stmt;
select pg_temp.as_('04');
select pg_temp.reject('select count(*) from public.'||t,'permission denied','staf tidak bisa membaca tabel langsung: '||t) from unnest(array['setoran','setoran_shift','setoran_keuangan','setoran_pengeluaran','setoran_transfer','setoran_kasbon','setoran_event','setoran_permintaan']) t;
select pg_temp.reject('select expected_amount,selisih,jenis from public.setoran_keuangan','permission denied','staf tidak bisa membaca kolom kas seharusnya/selisih/jenis langsung (hitung buta di basis data)');
select pg_temp.reject($$insert into public.setoran(no_setoran,branch_id,periode_mulai,periode_selesai,jadwal,request_key,created_by) values('X','e5200000-0000-4000-8000-00000000000a',current_date-3,current_date-2,current_date-2,gen_random_uuid(),auth.uid())$$,'permission denied','staf tidak bisa INSERT langsung');
select pg_temp.reject($$update public.setoran set status='Disetujui'$$,'permission denied','staf tidak bisa UPDATE langsung (menyetujui sendiri)');
select pg_temp.reject($$delete from public.setoran_keuangan$$,'permission denied','staf tidak bisa DELETE langsung');
select pg_temp.as_('01');
select pg_temp.reject('select count(*) from public.'||t,'permission denied','bahkan Owner tidak membaca tabel langsung: '||t) from unnest(array['setoran','setoran_keuangan','setoran_transfer']) t;
select pg_temp.as_('04');
set local role anon;
select pg_temp.reject($$select public.setoran_akses()$$,'permission denied','anon tidak bisa memanggil RPC setoran');
select pg_temp.reject($$select public.setoran_detail(null)$$,'permission denied','anon tidak bisa membuka detail');
select pg_temp.reject($$select count(*) from public.setoran$$,'permission denied','anon tidak bisa membaca tabel');
reset role;
set local role service_role;
select pg_temp.reject($$select count(*) from public.setoran_keuangan$$,'permission denied','service_role tidak punya hak langsung atas keuangan setoran');
reset role;
select pg_temp.noauth();
select pg_temp.ok(not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'setoran\_%' and p.prosecdef and has_function_privilege('anon',p.oid,'execute')),'tidak ada fungsi setoran yang bisa dipanggil anon');

-- ── 25. kasbon terlihat oleh karyawan/HRIS ──────────────────────────────────────────────────────
select pg_temp.ok((select count(*)>=2 from cash_advances ca join employees e on e.id=ca.employee_id where ca.status='Dicatat' and ca.alasan like 'Selisih kurang setoran%' and e.profile_id=pg_temp.u('04')),'kasbon selisih setoran tercatat atas nama karyawan (tampil di HRIS Utang karyawan)');

-- ── 26. pembuat berbeda dari pengaju: pembuat tidak boleh menyetujui ───────────────────────────
select pg_temp.save('sM6',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-0000000000a6','04',50,0,100000)));
set local role authenticated;
select pg_temp.as_('03');
select pg_temp.save('pM6',public.setoran_buat('e5200000-0000-4000-8000-0000000000a6',pg_temp.today()-50,pg_temp.today()-50,pg_temp.today()-49,'12:00',pg_temp.kk('m6')));
select pg_temp.pay('pM6',100000,'Transfer','04','0c','m6-t1',49);
select pg_temp.sub('pM6','04','m6-aj');
select pg_temp.as_('03');
select pg_temp.reject($$select public.setoran_setujui(pg_temp.sid('pM6'),pg_temp.kk('ap-m6'),null,null,false,false,null)$$,'SETORAN_PEMISAHAN_TUGAS','pembuat setoran (Finance) tidak boleh menyetujui walau pengajunya orang lain');
select pg_temp.as_('0c');
select pg_temp.save('apM6',public.setoran_setujui(pg_temp.sid('pM6'),pg_temp.kk('ap-m6-ok'),null,null,false,false,null));
select pg_temp.ok((select r->>'penyelesaian'='Pas' from res where name='apM6'),'Finance lain menyetujui setoran yang dibuat Finance pertama');

-- ── 27. shift tersambung yang kemudian tidak sah menahan pengajuan ────────────────────────────────
reset role;
select pg_temp.noauth();
select pg_temp.save('sM7',jsonb_build_object('id',pg_temp.mk_shift('e5200000-0000-4000-8000-0000000000a6','04',55,0,100000)));
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.save('pM7',public.setoran_buat('e5200000-0000-4000-8000-0000000000a6',pg_temp.today()-55,pg_temp.today()-55,pg_temp.today()-54,'12:00',pg_temp.kk('m7')));
reset role;
select pg_temp.noauth();
update cashier_shifts set closed_at=closed_at-interval '3 days' where id=pg_temp.sid('sM7');
set local role authenticated;
select pg_temp.as_('04');
select pg_temp.reject($$select public.setoran_ajukan(pg_temp.sid('pM7'),pg_temp.rev('pM7'),pg_temp.kk('m7-aj'))$$,'SETORAN_SHIFT: shift setoran harus sudah ditutup','shift tersambung yang kini di luar periode menahan pengajuan');

-- ── 28. peran di luar Owner/Admin/Finance/Staf (mis. Dokter) tidak punya jalur ke setoran walau punya akses cabang ──────────────
set local role authenticated;
select pg_temp.as_('0b');
select pg_temp.ok(not (public.setoran_akses()->>'masuk')::boolean,'Dokter: tidak masuk ke setoran walau punya akses cabang');
select pg_temp.reject($$select public.setoran_daftar(null,null,null,null,null)$$,'SETORAN_DITOLAK','Dokter: daftar setoran ditolak');
select pg_temp.reject($$select public.setoran_buat('e5200000-0000-4000-8000-00000000000b',pg_temp.today()-3,pg_temp.today()-3,pg_temp.today()-2,'12:00',pg_temp.kk('dok1'))$$,'SETORAN_DITOLAK','Dokter: tidak boleh membuat setoran');
reset role;
rollback;
