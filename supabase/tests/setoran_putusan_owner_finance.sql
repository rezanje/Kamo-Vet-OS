-- Rekap Setoran — keputusan hanya Owner/Finance (migrasi *_setoran_putusan_owner_finance): fixture fiktif di PostgreSQL sekali pakai; semuanya dibatalkan (rollback).
-- Dibuktikan: setujui/tolak setoran dan konfirmasi/tolak transfer DITOLAK untuk ADMIN, ADMIN_UMUM, STAFF, DOCTOR (SETORAN_DITOLAK_PERAN) dan jalan untuk OWNER/FINANCE;
-- hak baca (akses, daftar, detail+keuangan, rekap, pintasan SO) dan hak buat/catat/ajukan Admin/Admin Umum TIDAK berubah; pemisahan tugas dan akses cabang tidak berubah; ACL.
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
create function pg_temp.u(n text) returns uuid language sql immutable as $$select ('f6100000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.br(n text) returns uuid language sql immutable as $$select ('f6200000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.as_(n text) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.u(n)::text,true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);end$$;
create function pg_temp.noauth() returns void language sql as $$select set_config('request.jwt.claims','{}',true),set_config('request.jwt.claim.sub','',true)$$;
create function pg_temp.today() returns date language sql as $$select (now() at time zone 'Asia/Jakarta')::date$$;
create function pg_temp.kk(name text) returns uuid language sql immutable as $$select md5('f6-'||name)::uuid$$;
create temp table res(name text primary key,r jsonb);grant all on res to public;
create function pg_temp.save(name text,v jsonb) returns void language sql as $$insert into res values($1,$2) on conflict(name) do update set r=excluded.r$$;
create function pg_temp.sid(name text) returns uuid language sql security definer as $$select (r->>'id')::uuid from res where res.name=$1$$;
create function pg_temp.rev(name text) returns integer language sql security definer as $$select revision from public.setoran where id=(select (r->>'id')::uuid from res where res.name=$1)$$;
create function pg_temp.st(name text) returns text language sql security definer as $$select status from public.setoran where id=(select (r->>'id')::uuid from res where res.name=$1)$$;
create function pg_temp.lineid(nm text,n int default 0) returns uuid language sql security definer as $$select id from public.setoran_pengeluaran where setoran_id=(select (r->>'id')::uuid from res where res.name=$1) order by created_at,id offset $2 limit 1$$;
create function pg_temp.trid(nm text,n int default 0) returns uuid language sql security definer as $$select id from public.setoran_transfer where setoran_id=(select (r->>'id')::uuid from res where res.name=$1) order by created_at,id offset $2 limit 1$$;
create function pg_temp.sv(stmt text) returns text language plpgsql security definer as $$declare r text;begin execute stmt into r;return r;end$$;
-- jalankan sebagai pengguna (RLS berlaku): hasil skalar teks atau 'ERR:'||pesan; semua dibatalkan di dalam sub-blok
create function pg_temp.ra(un text, stmt text) returns text language plpgsql as $$
declare r text;
begin
 perform pg_temp.as_(un);
 begin execute 'set local role authenticated';execute stmt into r;execute 'reset role';return coalesce(r,'NULL');
 exception when others then execute 'reset role';return 'ERR:'||sqlerrm;end;
end$$;
-- DML sebagai pengguna: jumlah baris terpengaruh, atau 'ERR:'||pesan; selalu dibatalkan
create function pg_temp.dml(un text, stmt text) returns text language plpgsql as $$
declare n bigint;
begin
 perform pg_temp.as_(un);
 begin execute 'set local role authenticated';execute stmt;get diagnostics n=row_count;execute 'reset role';raise exception 'BATAL_%',n;
 exception when others then execute 'reset role';
  if sqlerrm like 'BATAL\_%' then return substr(sqlerrm,7);end if;return 'ERR:'||sqlerrm;end;
end$$;
create function pg_temp.dml_sisa(un text, stmt text) returns text language plpgsql as $$
declare n bigint;m bigint;
begin
 perform pg_temp.as_(un);
 begin execute 'set local role authenticated';execute stmt;get diagnostics n=row_count;execute 'reset role';
  select count(*) into m from public.journal_lines where id in(select id from hid_lines);raise exception 'BATAL_%_%',n,m;
 exception when others then execute 'reset role';
  if sqlerrm like 'BATAL\_%' then return substr(sqlerrm,7);end if;return 'ERR:'||sqlerrm;end;
end$$;
create function pg_temp.raj(un text, stmt text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
 perform pg_temp.as_(un);
 begin execute 'set local role authenticated';execute stmt into r;execute 'reset role';return r;
 exception when others then execute 'reset role';return jsonb_build_object('err',sqlerrm);end;
end$$;
-- jl_all dilonggarkan (using true) di dalam sub-blok yang dibatalkan: kebijakan jurnal setoran harus tetap berdiri sendiri (tidak bergantung pada subquery jl_all -> journal_entries)
create function pg_temp.loose_jl(un text) returns text language plpgsql as $$
declare n bigint;m bigint;
begin
 perform pg_temp.as_(un);
 begin
  drop policy jl_all on public.journal_lines;create policy jl_all on public.journal_lines for all to authenticated using (true) with check (true);
  execute 'set local role authenticated';
  select count(*) into n from public.journal_lines where id in(select id from hid_lines);
  execute 'reset role';raise exception 'BATAL_%',n;
 exception when others then execute 'reset role';if sqlerrm like 'BATAL\_%' then return substr(sqlerrm,7);end if;return 'ERR:'||sqlerrm;end;
end$$;
create sequence pg_temp.fseq;
-- berkas bukti yang sah untuk setoran s: dibuat di storage.objects (pengunggah = akun yang sedang aktif) dan dikembalikan sebagai lampiran
create function pg_temp.lamp(s uuid,k text) returns jsonb language plpgsql security definer as $$
declare br uuid;p text;begin
 select branch_id into br from public.setoran where id=s;p:='setoran/'||br::text||'/'||md5(k)||'.jpg';
 insert into storage.objects(bucket_id,name,owner_id) select 'dokumen',p,coalesce(auth.uid()::text,'sistem') where not exists(select 1 from storage.objects where bucket_id='dokumen' and name=p);
 return jsonb_build_array(jsonb_build_object('path',p,'nama','f6.jpg','mime','image/jpeg','ukuran',100));end$$;
create function pg_temp.lampp(p text) returns jsonb language sql as $$select jsonb_build_array(jsonb_build_object('path',p,'nama','f6.jpg','mime','image/jpeg','ukuran',100))$$;
create function pg_temp.obj(p text,own text) returns void language sql security definer as $$
 insert into storage.objects(bucket_id,name,owner_id) values('dokumen',p,own)$$;
create function pg_temp.mk_shift(br uuid,opener text,dayoff int,opening numeric,closing numeric,typ text default 'petshop') returns uuid language plpgsql security definer as $$
declare id uuid:=gen_random_uuid();d date:=(now() at time zone 'Asia/Jakarta')::date-dayoff;
begin
 perform set_config('request.jwt.claims','{}',true);perform set_config('request.jwt.claim.sub','',true);
 insert into public.cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance,opened_at,closing_balance,expected_cash,selisih,closed_at,status,closing_breakdown)
 values(id,br,pg_temp.u(opener),typ,opening,((d::timestamp+time '08:00') at time zone 'Asia/Jakarta'),closing,closing,0,((d::timestamp+time '17:00') at time zone 'Asia/Jakarta'),'closed',jsonb_build_object('Tunai',closing-opening));
 return id;
end$$;
create function pg_temp.mk(nm text,br uuid,creator text,dayoff int default 3) returns void language plpgsql as $$
begin
 perform set_config('role','authenticated',true);perform pg_temp.as_(creator);
 perform pg_temp.save(nm,public.setoran_buat(br,pg_temp.today()-dayoff,pg_temp.today()-dayoff,pg_temp.today()-dayoff+1,'12:00',pg_temp.kk('buat-'||nm)));
 perform set_config('role','none',true);
end$$;
create function pg_temp.exps(nm text,u text,d int,kat text,amt numeric,k text) returns void language plpgsql as $$
begin perform set_config('role','authenticated',true);perform pg_temp.as_(u);perform public.setoran_tambah_pengeluaran(pg_temp.sid(nm),pg_temp.today()-d,kat,amt,'uji '||k,pg_temp.lamp(pg_temp.sid(nm),k),pg_temp.rev(nm),pg_temp.kk(k));perform set_config('role','none',true);end$$;
create function pg_temp.pay(nm text,amt numeric,metode text,enterer text,confirmer text,k text,tgl int default 1) returns void language plpgsql as $$
declare r jsonb;acc uuid:=case when metode='Transfer' then 'f6500000-0000-4000-8000-000000000004'::uuid else 'f6500000-0000-4000-8000-000000000003'::uuid end;
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
create function pg_temp.appr(nm text,u text,k text,alok jsonb default null,beban boolean default false,besar boolean default false) returns jsonb language plpgsql as $$
declare r jsonb;begin perform set_config('role','authenticated',true);perform pg_temp.as_(u);
 r:=public.setoran_setujui(pg_temp.sid(nm),pg_temp.kk(k),null,alok,beban,besar,'catatan uji');perform set_config('role','none',true);perform pg_temp.save('ap-'||nm,r);return r;end$$;
create function pg_temp.jn(src text,ref uuid) returns integer language sql security definer as $$select count(*)::int from public.journal_entries where source=src and source_ref=ref::text$$;
create function pg_temp.hid() returns integer language sql security definer as $$select count(*)::int from public.journal_entries where source in ('setoran','setoran-batal')$$;

-- ── fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into storage.buckets(id,name,public) values('dokumen','dokumen',false),('pembelian','pembelian',false) on conflict do nothing;
-- kebijakan lama bucket dokumen (dokumen_read/write/delete) sudah ada dari rantai migrasi; kandidat menambah kebijakan RESTRICTIVE di atasnya
create policy tmp_dokumen_ubah on storage.objects for update to authenticated using (bucket_id='dokumen') with check (bucket_id='dokumen');
insert into auth.users(id,raw_user_meta_data) select pg_temp.u(n),jsonb_build_object('full_name','FX '||n) from unnest(array['01','02','03','04','05','06','07','08','09','0b','0c','0d','0e']) n;
update profiles set role='OWNER',is_active=true where id=pg_temp.u('01');
update profiles set role='ADMIN',is_active=true where id in(pg_temp.u('02'));
update profiles set role='FINANCE',is_active=true where id in(pg_temp.u('03'),pg_temp.u('0c'));
update profiles set role='STAFF',is_active=true where id in(pg_temp.u('04'),pg_temp.u('05'),pg_temp.u('07'),pg_temp.u('08'),pg_temp.u('0e'));
update profiles set role='ADMIN_ONLINE',is_active=true where id=pg_temp.u('06');
update profiles set role='FINANCE',is_active=false where id=pg_temp.u('09');
update profiles set role='DOCTOR',is_active=true where id=pg_temp.u('0b');
update profiles set role='ADMIN_UMUM',is_active=true where id=pg_temp.u('0d');
insert into role_capabilities(role,all_branches,create_accounts) values('ADMIN',false,false),('FINANCE',false,false) on conflict(role) do update set all_branches=false;
insert into role_modules(role,module_id) values('STAFF','pos'),('ADMIN','pos'),('FINANCE','pos'),('DOCTOR','klinik') on conflict do nothing;
insert into branches(id,code,name,type) values
 (pg_temp.br('0a'),'FXA','FX petshop A','PETSHOP'),(pg_temp.br('0b'),'FXB','FX cabang B','PETSHOP'),(pg_temp.br('0c'),'FXC','FX cabang C','PETSHOP'),
 (pg_temp.br('0d'),'FXD','FX cabang D','PETSHOP'),(pg_temp.br('0e'),'FXE','FX cabang E','PETSHOP'),(pg_temp.br('0f'),'FXF','FX cabang F','PETSHOP'),
 (pg_temp.br('a1'),'FXG','FX cabang G','PETSHOP'),(pg_temp.br('a2'),'FXH','FX cabang H','PETSHOP'),(pg_temp.br('a3'),'FXI','FX cabang I','PETSHOP'),
 (pg_temp.br('a4'),'FXJ','FX cabang J','PETSHOP'),(pg_temp.br('a5'),'FXK','FX cabang K','PETSHOP'),(pg_temp.br('a6'),'FXL','FX cabang L','PETSHOP'),
 (pg_temp.br('c1'),'FXM','FX cabang M','PETSHOP'),(pg_temp.br('c2'),'FXN','FX cabang N','PETSHOP'),(pg_temp.br('c3'),'FXO','FX cabang O','PETSHOP'),(pg_temp.br('c4'),'FXP','FX cabang P','PETSHOP'),
 (pg_temp.br('b1'),'FXX','FX cabang lain','PETSHOP');
insert into user_branches(user_id,branch_id)
 select pg_temp.u(n),b.id from unnest(array['02','03','04','05','0b','0c','0d','0e']) n cross join branches b where b.code in ('FXA','FXB','FXC','FXD','FXE','FXF','FXG','FXH','FXI','FXJ','FXK','FXL','FXM','FXN','FXO','FXP');
insert into user_branches(user_id,branch_id) values(pg_temp.u('07'),pg_temp.br('b1')),(pg_temp.u('08'),pg_temp.br('b1')),(pg_temp.u('06'),pg_temp.br('0a'));
insert into employees(id,nama,profile_id,status) values
 ('f6300000-0000-4000-8000-000000000001','Kasir Satu',pg_temp.u('04'),'Aktif'),('f6300000-0000-4000-8000-000000000002','Kasir Dua',pg_temp.u('05'),'Aktif'),
 ('f6300000-0000-4000-8000-000000000003','Admin Pegang Shift',pg_temp.u('02'),'Aktif'),('f6300000-0000-4000-8000-000000000004','Finance Kasir',pg_temp.u('0c'),'Aktif');
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active,parent_id) values
 ('1191','FX laci A','ASET','D',false,true,null),('1195','FX kas finance','ASET','D',false,true,null),('1192','FX bank utama','ASET','D',false,true,(select id from coa_accounts where code='120000'))
 on conflict(code) do update set is_active=true,is_header=false;
update coa_accounts set parent_id=(select id from coa_accounts where code='120000') where code='1192';
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active) select c,'FX '||c,'BEBAN','D',false,true from unnest(array['720002','740003','760003','740001']) c on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code,is_active,branch_id) values
 ('f6500000-0000-4000-8000-000000000001','FX laci A','Kas','1191',true,pg_temp.br('0a')),
 ('f6500000-0000-4000-8000-000000000003','FX kas finance','Kas','1195',true,null),
 ('f6500000-0000-4000-8000-000000000004','FX bank utama','Bank','1192',true,null);
insert into payment_account_map(metode,branch_id,cash_account_id) values('Tunai',pg_temp.br('0a'),'f6500000-0000-4000-8000-000000000001') on conflict do nothing;
update accounting_locks set closed_until=null;
-- jurnal umum biasa (bukan setoran) untuk pembanding: cabang A dan cabang lain X
select public.sales_write_journal(pg_temp.today()-9,pg_temp.br('0a'),'manual','fx-man-1','FX jurnal umum A sebelum',jsonb_build_array(jsonb_build_object('code','720002','debit',11111,'credit',0),jsonb_build_object('code','1195','debit',0,'credit',11111)));
select public.sales_write_journal(pg_temp.today()-9,pg_temp.br('b1'),'manual','fx-man-2','FX jurnal umum X',jsonb_build_array(jsonb_build_object('code','720002','debit',22222,'credit',0),jsonb_build_object('code','1195','debit',0,'credit',22222)));
select pg_temp.save('jrn-before',jsonb_build_object('no',(select no_jurnal from journal_entries where source_ref='fx-man-2')));


-- ── 0. predikat, ACL, definisi ────────────────────────────────────────────────────────────────────
create function pg_temp.pred(un text, f text) returns text language plpgsql security definer as $$
declare r text;begin perform pg_temp.as_(un);execute 'select '||f into r;return coalesce(r,'NULL');end$$;
select pg_temp.ok(to_regprocedure('public.setoran_pemutus()') is not null,'setoran_pemutus() ada');
select pg_temp.ok(not has_function_privilege('anon','public.setoran_pemutus()','execute') and not has_function_privilege('authenticated','public.setoran_pemutus()','execute') and not has_function_privilege('service_role','public.setoran_pemutus()','execute')
  and (select proacl::text from pg_proc where oid='public.setoran_pemutus()'::regprocedure) is not distinct from (select proacl::text from pg_proc where oid='public.setoran_penyetuju()'::regprocedure),'ACL setoran_pemutus() = ACL setoran_penyetuju() (hanya pemilik)');
select pg_temp.ok((select prosecdef and 'search_path=""'=any(proconfig) and provolatile='s' from pg_proc where oid='public.setoran_pemutus()'::regprocedure),'setoran_pemutus() SECURITY DEFINER, search_path kosong, STABLE');
select pg_temp.ok(pg_get_functiondef('public.setoran_pemutus()'::regprocedure) ~ 'OWNER.,.FINANCE' and pg_get_functiondef('public.setoran_pemutus()'::regprocedure) !~ 'ADMIN','definisi setoran_pemutus() hanya OWNER dan FINANCE');
select pg_temp.ok(pg_get_functiondef('public.setoran_penyetuju()'::regprocedure) ~ 'OWNER.,.FINANCE.,.ADMIN.,.ADMIN_UMUM','setoran_penyetuju() (predikat BACA) tidak berubah: Owner, Finance, Admin, Admin Umum');
select pg_temp.ok(position('setoran_pemutus()' in pg_get_functiondef(('public.'||f)::regprocedure))>0 and position('setoran_penyetuju()' in pg_get_functiondef(('public.'||f)::regprocedure))=0 and pg_get_functiondef(('public.'||f)::regprocedure) !~ 'Admin cabang',f||' memutuskan lewat setoran_pemutus() saja')
 from unnest(array['setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)','setoran_tolak(uuid,text,uuid)','setoran_putuskan_transfer(uuid,uuid,boolean,text,uuid)']) f;
select pg_temp.ok(position('setoran_penyetuju()' in pg_get_functiondef(('public.'||f)::regprocedure))>0,f||' tetap memakai predikat BACA setoran_penyetuju()')
 from unnest(array['setoran_daftar(date,date,uuid,text,uuid)','setoran_rekap(date,date,uuid,text,uuid)','setoran_so_terakhir(uuid)','setoran_jurnal_boleh()','setoran_detail(uuid)','setoran_akses()']) f;
select pg_temp.ok(pg_get_functiondef('public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)'::regprocedure) ~ 'hanya Owner atau Finance yang dapat menyetujui setoran'
  and pg_get_functiondef('public.setoran_tolak(uuid,text,uuid)'::regprocedure) ~ 'hanya Owner atau Finance yang dapat menolak setoran'
  and pg_get_functiondef('public.setoran_putuskan_transfer(uuid,uuid,boolean,text,uuid)'::regprocedure) ~ 'hanya Owner atau Finance yang dapat mengonfirmasi transfer','pesan galat memakai Owner atau Finance (bukan Admin cabang)');
select pg_temp.ok((select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'setoran%' and p.prosrc ~ 'Owner, Finance, atau Admin cabang')=0,'tidak ada lagi pesan "Owner, Finance, atau Admin cabang" di fungsi setoran');
select pg_temp.ok((select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'setoran%' and p.prosrc ~ 'Minta Owner/Finance/Admin')=0,'tidak ada lagi saran "Minta Owner/Finance/Admin" di fungsi setoran');
select pg_temp.ok(admin_online_private.guard_all()=0,'guard_all() idempoten: fungsi baru tidak perlu penjaga Admin Online (tidak bisa dipanggil klien)');

-- ── 1. predikat per peran ─────────────────────────────────────────────────────────────────────────
select pg_temp.ok(pg_temp.pred(u,'public.setoran_pemutus()')=exp,'setoran_pemutus() untuk '||lbl||' = '||exp)
 from (values('01','true','OWNER'),('03','true','FINANCE'),('0c','true','FINANCE lain'),('02','false','ADMIN'),('0d','false','ADMIN_UMUM'),('04','false','STAFF'),('0b','false','DOCTOR'),('06','false','ADMIN_ONLINE'),('09','false','FINANCE nonaktif')) v(u,exp,lbl);
select pg_temp.ok(pg_temp.pred(u,'public.setoran_penyetuju()')=exp,'setoran_penyetuju() (BACA) untuk '||lbl||' = '||exp||' (tidak berubah)')
 from (values('01','true','OWNER'),('03','true','FINANCE'),('02','true','ADMIN'),('0d','true','ADMIN_UMUM'),('04','false','STAFF'),('0b','false','DOCTOR'),('06','false','ADMIN_ONLINE'),('09','false','FINANCE nonaktif')) v(u,exp,lbl);

-- ── 2. skenario: setoran Diajukan (pA, pB, pC), transfer menunggu (pT) ─────────────────────────────
select pg_temp.save('sA1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('0a'),'04',3,0,300000)));
select pg_temp.save('sB1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('0b'),'04',3,0,300000)));
select pg_temp.save('sC1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('0c'),'04',3,0,300000)));
select pg_temp.mk('pA',pg_temp.br('0a'),'04');select pg_temp.mk('pB',pg_temp.br('0b'),'04');select pg_temp.mk('pC',pg_temp.br('0c'),'04');
select pg_temp.exps('pA','04',3,'Operasional',50000,'a-e1');
select pg_temp.pay('pA',250000,'Serah tunai','04','03','a-t1',2);
select pg_temp.sub('pA','04','a-aj');
select pg_temp.pay('pB',300000,'Serah tunai','04','03','b-t1',2);select pg_temp.sub('pB','04','b-aj');
select pg_temp.pay('pC',300000,'Serah tunai','04','03','c-t1',2);select pg_temp.sub('pC','04','c-aj');
-- pT: Draft dengan tiga transfer yang masih Menunggu (dicatat staf 04)
select pg_temp.save('sD1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('0d'),'04',3,0,300000)));
select pg_temp.mk('pT',pg_temp.br('0d'),'04');
select pg_temp.pay('pT',100000,'Serah tunai','04',null,'t-t1',2);select pg_temp.pay('pT',50000,'Serah tunai','04',null,'t-t2',2);select pg_temp.pay('pT',20000,'Serah tunai','04',null,'t-t3',2);
select pg_temp.ok((select count(*)=3 from setoran_transfer where setoran_id=pg_temp.sid('pT') and status='Menunggu'),'pT: tiga transfer Menunggu');
select pg_temp.ok((select count(*)=3 from setoran where id in(pg_temp.sid('pA'),pg_temp.sid('pB'),pg_temp.sid('pC')) and status='Diajukan'),'pA, pB, pC berstatus Diajukan');
create temp table snap as select (select count(*) from journal_entries) j,(select count(*) from expenses) e,(select count(*) from cash_advances) c,(select count(*) from setoran_kasbon) k,(select count(*) from setoran where status<>'Draft') s,(select count(*) from setoran_permintaan) q;
grant all on snap to public;

-- 2a. DITOLAK: Admin, Admin Umum, Staf, Dokter; dan basis data tidak berubah
select pg_temp.ok(pg_temp.ra(u,$q$select public.setoran_setujui(pg_temp.sid('pA'),pg_temp.kk('den-s'),null,null,false,false,null)::text$q$) like 'ERR:SETORAN_DITOLAK_PERAN: hanya Owner atau Finance yang dapat menyetujui setoran.%','setujui ditolak untuk '||lbl)
 from (values('02','ADMIN'),('0d','ADMIN_UMUM'),('04','STAFF'),('0b','DOCTOR')) v(u,lbl);
select pg_temp.ok(pg_temp.ra(u,$q$select public.setoran_tolak(pg_temp.sid('pA'),'alasan uji',pg_temp.kk('den-t'))::text$q$) like 'ERR:SETORAN_DITOLAK_PERAN: hanya Owner atau Finance yang dapat menolak setoran.%','tolak setoran ditolak untuk '||lbl)
 from (values('02','ADMIN'),('0d','ADMIN_UMUM'),('04','STAFF'),('0b','DOCTOR')) v(u,lbl);
select pg_temp.ok(pg_temp.ra(u,format($q$select public.setoran_putuskan_transfer(pg_temp.sid('pT'),pg_temp.trid('pT',0),%s,'catatan uji',pg_temp.kk('den-x'))::text$q$,terima::text)) like 'ERR:SETORAN_DITOLAK_PERAN: hanya Owner atau Finance yang dapat mengonfirmasi transfer.%',
  case when terima then 'konfirmasi' else 'tolak' end||' transfer ditolak untuk '||lbl)
 from (values('02','ADMIN'),('0d','ADMIN_UMUM'),('04','STAFF'),('0b','DOCTOR')) v(u,lbl) cross join (values(true),(false)) t(terima);
select pg_temp.ok(pg_temp.ra('06',$q$select public.setoran_setujui(pg_temp.sid('pA'),pg_temp.kk('den-ao'),null,null,false,false,null)::text$q$) like 'ERR:%ADMIN_ONLINE_FUNCTION_DENIED%','Admin Online tetap ditolak (pagar sendiri) pada setujui');
select pg_temp.ok(pg_temp.ra('09',$q$select public.setoran_setujui(pg_temp.sid('pA'),pg_temp.kk('den-nf'),null,null,false,false,null)::text$q$) like 'ERR:SETORAN_DITOLAK%','Finance nonaktif ditolak');
select pg_temp.ok((select j=(select count(*) from journal_entries) and e=(select count(*) from expenses) and c=(select count(*) from cash_advances) and k=(select count(*) from setoran_kasbon) and s=(select count(*) from setoran where status<>'Draft') and q=(select count(*) from setoran_permintaan) from snap)
  and (select count(*)=3 from setoran where id in(pg_temp.sid('pA'),pg_temp.sid('pB'),pg_temp.sid('pC')) and status='Diajukan') and (select count(*)=3 from setoran_transfer where setoran_id=pg_temp.sid('pT') and status='Menunggu'),
  'sesudah semua penolakan: setoran masih Diajukan, transfer masih Menunggu, tidak ada jurnal/pengeluaran/kasbon/catatan permintaan baru');

-- 2b. hak BACA Admin dan Admin Umum tidak berubah (dan Owner/Finance membaca tetap)
select pg_temp.save('ak-'||u,pg_temp.raj(u,'select public.setoran_akses()')) from (values('01'),('03'),('02'),('0d'),('04'),('0b')) v(u);
select pg_temp.ok((select r->>'masuk'='true' and r->>'penyetuju'='true' and r->>'pemutus'='true' and r->>'void'='true' from res where name='ak-01'),'akses OWNER: masuk, penyetuju, pemutus, void');
select pg_temp.ok((select r->>'masuk'='true' and r->>'penyetuju'='true' and r->>'pemutus'='true' and r->>'void'='true' from res where name='ak-03'),'akses FINANCE: masuk, penyetuju, pemutus, void');
select pg_temp.ok((select r->>'masuk'='true' and r->>'penyetuju'='true' and r->>'pemutus'='false' and r->>'void'='false' from res where name='ak-02'),'akses ADMIN: masuk + penyetuju (baca) tetap, pemutus false, void false');
select pg_temp.ok((select r->>'masuk'='true' and r->>'penyetuju'='true' and r->>'pemutus'='false' and r->>'void'='false' from res where name='ak-0d'),'akses ADMIN_UMUM: masuk + penyetuju (baca) tetap, pemutus false, void false');
select pg_temp.ok((select r->>'masuk'='true' and r->>'penyetuju'='false' and r->>'pemutus'='false' from res where name='ak-04'),'akses STAFF: masuk, bukan penyetuju, bukan pemutus');
select pg_temp.ok((select r->>'masuk'='false' and r->>'penyetuju'='false' and r->>'pemutus'='false' from res where name='ak-0b'),'akses DOCTOR: tidak masuk (pemutus false)');
select pg_temp.save('dt-'||u,pg_temp.raj(u,$q$select public.setoran_detail(pg_temp.sid('pA'))$q$)) from (values('01'),('03'),('02'),('0d'),('04')) v(u);
select pg_temp.ok((select r->>'penyetuju'='true' and r->>'pemutus'='true' and r ? 'keuangan' from res where name='dt-01'),'detail OWNER: penyetuju + pemutus + bagian keuangan');
select pg_temp.ok((select r->>'penyetuju'='true' and r->>'pemutus'='true' and r ? 'keuangan' from res where name='dt-03'),'detail FINANCE: penyetuju + pemutus + bagian keuangan');
select pg_temp.ok((select r->>'penyetuju'='true' and r->>'pemutus'='false' and (r->'keuangan'->>'diharapkan')::numeric=250000 from res where name='dt-02'),'detail ADMIN: bagian keuangan TETAP terlihat (250.000), pemutus false');
select pg_temp.ok((select r->>'penyetuju'='true' and r->>'pemutus'='false' and (r->'keuangan'->>'diharapkan')::numeric=250000 from res where name='dt-0d'),'detail ADMIN_UMUM: bagian keuangan TETAP terlihat, pemutus false');
select pg_temp.ok((select r->>'penyetuju'='false' and r->>'pemutus'='false' and not r ? 'keuangan' from res where name='dt-04'),'detail STAFF: tanpa bagian keuangan, pemutus false');
select pg_temp.save('ls-'||u,pg_temp.raj(u,format($q$select public.setoran_daftar(null,null,%L::uuid,null,null)$q$,pg_temp.br('0a')))) from (values('02'),('0d'),('04')) v(u);
select pg_temp.ok((select r->>'penyetuju'='true' and exists(select 1 from jsonb_array_elements(r->'baris') x where x ? 'diharapkan' or x ? 'selisih' or x ? 'selisih_sementara') from res where name='ls-02'),'daftar ADMIN: baris + kolom keuangan tetap');
select pg_temp.ok((select r->>'penyetuju'='true' and jsonb_array_length(r->'baris')>=1 from res where name='ls-0d'),'daftar ADMIN_UMUM: baris tetap');
select pg_temp.ok((select r->>'penyetuju'='false' from res where name='ls-04'),'daftar STAFF: bukan penyetuju');
select pg_temp.ok(pg_temp.ra('02','select jsonb_typeof(public.setoran_rekap(null,null,null,null,null))')='object','ADMIN tetap bisa membuka setoran_rekap');
select pg_temp.ok(pg_temp.ra('0d','select jsonb_typeof(public.setoran_rekap(null,null,null,null,null))')='object','ADMIN_UMUM tetap bisa membuka setoran_rekap');
select pg_temp.ok(pg_temp.ra('02',format('select jsonb_typeof(public.setoran_so_terakhir(%L::uuid))',pg_temp.br('0a')))='object','ADMIN tetap bisa membuka pintasan SO terakhir');
select pg_temp.ok(pg_temp.ra('04','select public.setoran_rekap(null,null,null,null,null)::text') like 'ERR:SETORAN_DITOLAK_PERAN: rekap setoran hanya untuk Owner, Finance, atau Admin.%','STAFF tetap ditolak di rekap (pesan baca tidak berubah)');

-- 2c. Admin dan Admin Umum tetap boleh MEMBUAT periode, mencatat pengeluaran/transfer, dan mengajukan
select pg_temp.save('sE1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('0e'),'04',3,0,200000)));
select pg_temp.mk('pAd',pg_temp.br('0e'),'02');
select pg_temp.ok((select status='Draft' and created_by=pg_temp.u('02') from setoran where id=pg_temp.sid('pAd')),'ADMIN tetap bisa membuat periode setoran');
select pg_temp.exps('pAd','02',3,'Operasional',10000,'ad-e1');
select pg_temp.pay('pAd',190000,'Serah tunai','02','03','ad-t1',2);
select pg_temp.sub('pAd','02','ad-aj');
select pg_temp.ok((select status='Diajukan' and submitted_by=pg_temp.u('02') from setoran where id=pg_temp.sid('pAd')),'ADMIN tetap bisa mencatat pengeluaran + transfer dan mengajukan');
select pg_temp.save('sF1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('0f'),'04',3,0,200000)));
select pg_temp.mk('pAu',pg_temp.br('0f'),'0d');
select pg_temp.exps('pAu','0d',3,'Operasional',10000,'au-e1');
select pg_temp.pay('pAu',190000,'Serah tunai','0d',null,'au-t1',2);
select pg_temp.sub('pAu','0d','au-aj');
select pg_temp.ok((select status='Diajukan' and created_by=pg_temp.u('0d') and submitted_by=pg_temp.u('0d') from setoran where id=pg_temp.sid('pAu')),'ADMIN_UMUM tetap bisa membuat, mencatat, dan mengajukan');

-- ── 3. DIIZINKAN: Owner dan Finance ───────────────────────────────────────────────────────────────
select pg_temp.as_('01');
set local role authenticated;
select pg_temp.save('t1-owner',public.setoran_putuskan_transfer(pg_temp.sid('pT'),pg_temp.trid('pT',0),true,null,pg_temp.kk('ok-x1')));
reset role;
select pg_temp.as_('03');
set local role authenticated;
select pg_temp.save('t2-fin',public.setoran_putuskan_transfer(pg_temp.sid('pT'),pg_temp.trid('pT',1),true,'uang diterima',pg_temp.kk('ok-x2')));
select pg_temp.save('t3-fin',public.setoran_putuskan_transfer(pg_temp.sid('pT'),pg_temp.trid('pT',2),false,'tidak masuk rekening',pg_temp.kk('ok-x3')));
reset role;
select pg_temp.ok((select status from setoran_transfer where id=pg_temp.trid('pT',0))='Dikonfirmasi' and (select status from setoran_transfer where id=pg_temp.trid('pT',1))='Dikonfirmasi'
  and (select status from setoran_transfer where id=pg_temp.trid('pT',2))='Ditolak' and (select decided_by from setoran_transfer where id=pg_temp.trid('pT',0))=pg_temp.u('01') and (select decided_by from setoran_transfer where id=pg_temp.trid('pT',2))=pg_temp.u('03'),
  'OWNER dan FINANCE dapat mengonfirmasi dan menolak transfer (keputusan dicatat atas nama mereka)');
select pg_temp.as_('03');
set local role authenticated;
select pg_temp.save('tl-c',public.setoran_tolak(pg_temp.sid('pC'),'kembalikan: angka perlu dicek',pg_temp.kk('ok-tolak')));
reset role;
select pg_temp.ok(pg_temp.st('pC')='Ditolak','FINANCE dapat menolak (mengembalikan) setoran');
select pg_temp.appr('pA','01','ok-ap-a');
select pg_temp.ok(pg_temp.st('pA')='Disetujui' and (select decided_by=pg_temp.u('01') from setoran where id=pg_temp.sid('pA')),'OWNER dapat menyetujui setoran');
select pg_temp.appr('pB','0c','ok-ap-b');
select pg_temp.ok(pg_temp.st('pB')='Disetujui' and (select decided_by=pg_temp.u('0c') from setoran where id=pg_temp.sid('pB')),'FINANCE dapat menyetujui setoran');
select pg_temp.ok((select (r->>'selisih')::numeric=0 and r->>'penyelesaian'='Pas' from res where name='ap-pA') and (select (r->>'selisih')::numeric=0 and r->>'penyelesaian'='Pas' from res where name='ap-pB'),'persetujuan Owner/Finance memberi hasil yang sama seperti sebelumnya (pas, tanpa jurnal selisih)');

-- ── 4. pemisahan tugas dan akses cabang TIDAK berubah ─────────────────────────────────────────────
select pg_temp.save('sG1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('a1'),'04',3,0,200000)));
select pg_temp.mk('pG',pg_temp.br('a1'),'0c');
select pg_temp.exps('pG','04',3,'Operasional',5000,'g-e1');
select pg_temp.pay('pG',195000,'Serah tunai','04','03','g-t1',2);
select pg_temp.sub('pG','04','g-aj');
select pg_temp.ok(pg_temp.ra('0c',$q$select public.setoran_setujui(pg_temp.sid('pG'),pg_temp.kk('sod-g'),null,null,false,false,null)::text$q$) like 'ERR:SETORAN_PEMISAHAN_TUGAS%','pembuat setoran (Finance) tetap tidak boleh menyetujui setorannya sendiri');
select pg_temp.ok(pg_temp.ra('03',$q$select public.setoran_putuskan_transfer(pg_temp.sid('pT'),pg_temp.trid('pT',0),false,'coba',pg_temp.kk('sod-x'))::text$q$) like 'ERR:%','transfer yang sudah diputuskan tetap tidak bisa diputuskan lagi');
select pg_temp.save('sH1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('a2'),'04',3,0,200000)));
select pg_temp.mk('pH',pg_temp.br('a2'),'04');
select pg_temp.pay('pH',100000,'Serah tunai','03',null,'h-t1',2);
select pg_temp.ok(pg_temp.ra('03',$q$select public.setoran_putuskan_transfer(pg_temp.sid('pH'),pg_temp.trid('pH',0),true,null,pg_temp.kk('sod-h'))::text$q$) like 'ERR:SETORAN_PEMISAHAN_TUGAS%','pencatat transfer (Finance) tetap tidak boleh mengonfirmasi transfernya sendiri');
select pg_temp.ok(pg_temp.ra('01',$q$select public.setoran_putuskan_transfer(pg_temp.sid('pH'),pg_temp.trid('pH',0),true,null,pg_temp.kk('sod-h2'))::text$q$) like '%transfer_id%','Owner (bukan pencatat) tetap boleh mengonfirmasi transfer itu');
select pg_temp.ok(pg_temp.ra('0d',$q$select public.setoran_putuskan_transfer(pg_temp.sid('pAu'),pg_temp.trid('pAu',0),true,null,pg_temp.kk('sod-au'))::text$q$) like 'ERR:SETORAN_DITOLAK_PERAN%','ADMIN_UMUM ditolak pada transfer setoran yang dia buat sendiri (peran lebih dulu, bukan hanya pemisahan tugas)');
update profiles set role='FINANCE',is_active=true where id=pg_temp.u('08');
select pg_temp.ok(pg_temp.ra('08',$q$select public.setoran_setujui(pg_temp.sid('pG'),pg_temp.kk('cab-g'),null,null,false,false,null)::text$q$) like 'ERR:%cabang ini tidak dapat diakses%','Finance tanpa akses cabang itu tetap ditolak akses cabang (aturan cabang tidak berubah)');
select pg_temp.ok(pg_temp.ra('02',$q$select public.setoran_void(pg_temp.sid('pA'),'coba void',pg_temp.kk('void-a'))::text$q$) like 'ERR:SETORAN_DITOLAK_PERAN: hanya Owner atau Finance yang dapat membatalkan%','void tetap hanya Owner/Finance (tidak berubah)');
select pg_temp.ok((select count(*)=2 from setoran where id in(pg_temp.sid('pA'),pg_temp.sid('pB')) and status='Disetujui' and decided_by in(pg_temp.u('01'),pg_temp.u('0c'))) and (select count(*)=0 from setoran where status in('Disetujui','Ditolak') and decided_by in(pg_temp.u('02'),pg_temp.u('0d'),pg_temp.u('04'))),'ringkasan: tidak ada setoran yang diputuskan Admin/Admin Umum/Staf');
rollback;
