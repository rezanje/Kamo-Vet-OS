-- Rekap Setoran — perbaikan review (migrasi *_rekap_setoran_fix): fixture fiktif di PostgreSQL sekali pakai; semuanya dibatalkan (rollback).
-- Dibuktikan: B1 staf TIDAK dapat membaca/menulis jurnal setoran lewat tabel, join, tulis tanpa WHERE, maupun fungsi buku besar (lines/totals), sedangkan Owner/Admin/
-- Admin Umum/Finance tetap melihatnya; jurnal umum lain tidak berubah; jalur SECURITY DEFINER dan service_role berjalan; nomor jurnal setoran SJR (tanpa celah JRN);
-- M1 sisa staf = 0 sesudah diajukan; M2 pengeluaran > kewajiban diblok; M3 kebijakan storage setoran/ per cabang/peran; M4 pemisahan tugas; M5 validasi + klaim berkas,
-- peringatan kembar; M6 shift tertutup beku; jejak berisi jumlah; ACL/kebijakan.
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

-- ── 0. objek baru, ACL, kebijakan ────────────────────────────────────────────────────────────────
select pg_temp.ok(exists(select 1 from pg_policy p where p.polrelid='public.journal_entries'::regclass and p.polname='setoran_jurnal_tertutup' and not p.polpermissive and p.polcmd='*' and p.polroles=array['authenticated'::regrole::oid])
  and exists(select 1 from pg_policy p where p.polrelid='public.journal_lines'::regclass and p.polname='setoran_jurnal_tertutup' and not p.polpermissive and p.polcmd='*' and p.polroles=array['authenticated'::regrole::oid]),'dua kebijakan RESTRICTIVE FOR ALL setoran_jurnal_tertutup (authenticated) ada di journal_entries dan journal_lines');
select pg_temp.ok((select pg_get_expr(polqual,polrelid) from pg_policy where polrelid='public.journal_entries'::regclass and polname='je_all')~'user_can_access_branch'
  and (select pg_get_expr(polqual,polrelid) from pg_policy where polrelid='public.journal_lines'::regclass and polname='jl_all')~'user_can_access_branch'
  and (select polpermissive from pg_policy where polrelid='public.journal_entries'::regclass and polname='je_all') and (select count(*) from pg_policy where polrelid in('public.journal_entries'::regclass,'public.journal_lines'::regclass))=6,
  'kebijakan umum je_all/jl_all tetap (permissive, hanya cabang); total 6 kebijakan jurnal (2 lama + 2 pagar Admin Online + 2 baru)');
select pg_temp.ok(not has_table_privilege('authenticated','public.setoran_lampiran_pakai','select') and not has_table_privilege('authenticated','public.setoran_lampiran_pakai','insert')
  and not has_table_privilege('anon','public.setoran_lampiran_pakai','select') and not has_table_privilege('service_role','public.setoran_lampiran_pakai','select')
  and (select relrowsecurity from pg_class where oid='public.setoran_lampiran_pakai'::regclass),'tabel klaim berkas: RLS aktif, tanpa hak klien');
select pg_temp.ok(exists(select 1 from pg_policy where polrelid='public.setoran_lampiran_pakai'::regclass and polname='admin_online_fence_r') and exists(select 1 from pg_trigger where tgrelid='public.setoran_lampiran_pakai'::regclass and tgname='zz_admin_online_write_fence'),'pagar Admin Online terpasang pada tabel klaim (fence_all)');
select pg_temp.ok(not exists(select 1 from pg_proc p where p.oid=('public.'||f)::regprocedure and (has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute'))),'fungsi internal '||f||' tidak bisa dipanggil klien')
 from unnest(array['setoran_tulis_jurnal(date,uuid,text,text,text,jsonb)','setoran_konflik_tugas(uuid,uuid)','setoran_peringatan(uuid,uuid)','setoran_lampiran_cek(jsonb,uuid)','setoran_lampiran_klaim(uuid,text,uuid,jsonb)','guard_setoran_pakai()','guard_shift_tutup_uang()']) f;
select pg_temp.ok(has_function_privilege('authenticated',('public.'||f)::regprocedure,'execute') and not has_function_privilege('anon',('public.'||f)::regprocedure,'execute') and not has_function_privilege('service_role',('public.'||f)::regprocedure,'execute'),'fungsi kebijakan '||f||': hanya authenticated')
 from unnest(array['setoran_jurnal_boleh()','setoran_jurnal_tersembunyi()','setoran_berkas_cabang(text)','setoran_berkas_boleh(text)','setoran_berkas_boleh_hapus(text,text)']) f;
select pg_temp.ok((select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in('setoran_tulis_jurnal','setoran_konflik_tugas','setoran_peringatan','setoran_lampiran_cek','setoran_lampiran_klaim','setoran_jurnal_boleh','setoran_jurnal_tersembunyi','setoran_berkas_boleh','setoran_berkas_boleh_hapus') and p.prosecdef and 'search_path=""'=any(p.proconfig))=9,'9 fungsi baru SECURITY DEFINER dengan search_path kosong');
select pg_temp.ok(exists(select 1 from pg_trigger where tgrelid='public.cashier_shifts'::regclass and tgname='cashier_shift_tutup_uang_guard' and not tgisinternal),'pemicu cashier_shift_tutup_uang_guard terpasang');
select pg_temp.ok((select count(*) from pg_policies where schemaname='storage' and tablename='objects' and permissive='RESTRICTIVE' and policyname like 'setoran_berkas_%')=4,'4 kebijakan RESTRICTIVE storage setoran_berkas_* terpasang');
select pg_temp.ok(admin_online_private.guard_all()=0,'guard_all() idempoten: 0 fungsi baru perlu penjaga (kebijakan storage mengecualikan pembantu kebijakan)');
select pg_temp.ok((select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'setoran%' and p.prosecdef and has_function_privilege('authenticated',p.oid,'execute') and p.prosrc !~ 'deny_admin_online' and p.proname not in('setoran_jurnal_boleh','setoran_jurnal_tersembunyi','setoran_berkas_cabang','setoran_berkas_boleh','setoran_berkas_boleh_hapus'))=0,'semua RPC setoran yang bisa dipanggil klien tetap memuat deny_admin_online');
select pg_temp.ok(position('REKAP-SETORAN-FIX' in pg_get_functiondef('public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)'::regprocedure))>0
  and position('sales_write_journal' in pg_get_functiondef('public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)'::regprocedure))=0
  and position('sales_write_journal' in pg_get_functiondef('public.setoran_void(uuid,text,uuid)'::regprocedure))=0,'setujui dan void menulis jurnal lewat setoran_tulis_jurnal (bukan sales_write_journal)');

-- ── skenario uang ───────────────────────────────────────────────────────────────────────────────
-- A: kurang 100.000 -> kasbon otomatis (kasir 04 + 05). B: lebih 50.000 -> 810004, lalu void. C: kurang 80.000 -> beban perusahaan.
select pg_temp.save('sA1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('0a'),'04',3,0,300000)));
select pg_temp.save('sA2',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('0a'),'05',3,0,200000)));
select pg_temp.save('sB1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('0b'),'04',3,0,300000)));
select pg_temp.save('sC1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('0c'),'04',3,0,400000)));
select pg_temp.mk('pA',pg_temp.br('0a'),'04');select pg_temp.mk('pB',pg_temp.br('0b'),'04');select pg_temp.mk('pC',pg_temp.br('0c'),'04');
select pg_temp.exps('pA','04',3,'Operasional',50000,'a-e1');
select pg_temp.pay('pA',350000,'Serah tunai','04','03','a-t1',2);
select pg_temp.sub('pA','04','a-aj');
select pg_temp.pay('pB',350000,'Serah tunai','04','03','b-t1',2);
select pg_temp.sub('pB','04','b-aj');
select pg_temp.pay('pC',320000,'Serah tunai','04','03','c-t1',2);
select pg_temp.sub('pC','04','c-aj');
select pg_temp.ok(pg_temp.hid()=0,'sebelum persetujuan belum ada jurnal setoran');
-- tampilan staf SEBELUM persetujuan (Diajukan): sisa 0
select pg_temp.as_('04');
set local role authenticated;
select pg_temp.save('dA-diajukan',public.setoran_detail(pg_temp.sid('pA')));
reset role;
select pg_temp.ok((select (r->>'sisa')::numeric=0 and (r->>'persen')::numeric=100 and r->>'status'='Diajukan' and not r ?| array['keuangan','diharapkan','selisih','jenis','peringatan'] from res where name='dA-diajukan'),
  'M1: staf, setoran Diajukan: sisa 0, persen 100, tanpa bagian keuangan/diharapkan/selisih/peringatan');
-- persetujuan oleh Owner (01): bukan pembuat, bukan penginput, bukan pemegang shift
select pg_temp.appr('pA','01','ap-a');
select pg_temp.appr('pB','01','ap-b');
select pg_temp.appr('pC','02','ap-c',null,true,false);
select pg_temp.ok((select r->>'penyelesaian'='Kasbon' and (r->>'selisih')::numeric=-100000 from res where name='ap-pA'),'A: disetujui kurang 100.000 -> Kasbon');
select pg_temp.ok((select r->>'penyelesaian'='PendapatanLain' and (r->>'selisih')::numeric=50000 from res where name='ap-pB'),'B: disetujui lebih 50.000 -> 810004');
select pg_temp.ok((select r->>'penyelesaian'='BebanPerusahaan' and (r->>'selisih')::numeric=-80000 from res where name='ap-pC'),'C: disetujui kurang 80.000 -> Beban perusahaan');
select pg_temp.ok(pg_temp.hid()=3,'tiga jurnal setoran terbentuk (A kasbon, B lebih, C beban) lewat setoran_setujui (jalur SECURITY DEFINER tetap jalan)');
select pg_temp.ok((select count(*)=3 and bool_and(no_jurnal ~ ('^SJR-'||to_char(tanggal,'YYYYMM')||'-[0-9]{4}$')) from journal_entries where source='setoran'),'B1: nomor jurnal setoran berpola SJR-YYYYMM-NNNN');
select pg_temp.ok((select count(distinct no_jurnal)=3 from journal_entries where source='setoran'),'nomor SJR unik');
-- void B (Owner) -> jurnal pembalik source setoran-batal
select pg_temp.as_('01');
set local role authenticated;
select pg_temp.save('vB',public.setoran_void(pg_temp.sid('pB'),'salah hitung uji',pg_temp.kk('void-b')));
reset role;
select pg_temp.ok(pg_temp.hid()=4 and pg_temp.jn('setoran-batal',pg_temp.sid('pB'))=1,'void B: jurnal pembalik source setoran-batal terbentuk (4 jurnal setoran)');
-- jurnal umum sesudah setoran: nomor JRN berurutan tanpa celah
select public.sales_write_journal(pg_temp.today()-9,pg_temp.br('0a'),'manual','fx-man-3','FX jurnal umum A sesudah',jsonb_build_array(jsonb_build_object('code','720002','debit',33333,'credit',0),jsonb_build_object('code','1195','debit',0,'credit',33333)));
select pg_temp.ok(not exists(select 1 from journal_entries where source in('setoran','setoran-batal') and no_jurnal like 'JRN-%') and (select count(*) from journal_entries where no_jurnal like 'SJR-%')=4,'B1: tidak ada jurnal setoran yang memakai deret JRN (semua 4 bernomor SJR): staf tidak melihat celah nomor JRN');

-- ── 1. B1: staf tidak dapat membaca jurnal setoran lewat tabel ──────────────────────────────────
create temp table hid_ids as select id from public.journal_entries where source in ('setoran','setoran-batal');grant all on hid_ids to public;
select pg_temp.ok((select count(*) from hid_ids)=4,'fixture: 4 id entri jurnal setoran disimpan sebagai pembanding');
create temp table hid_lines as select l.id from public.journal_lines l where l.entry_id in(select id from hid_ids);grant all on hid_lines to public;
select pg_temp.ok((select count(*) from hid_lines)=8,'fixture: 8 baris jurnal setoran (4 entri x 2 baris)');
select pg_temp.ok(pg_temp.ra('04',$$select count(*) from journal_entries where source in ('setoran','setoran-batal')$$)='0','B1: STAFF 04 (cabang A,B,C) melihat 0 entri jurnal source setoran/setoran-batal');
select pg_temp.ok(pg_temp.ra('04',$$select count(*) from journal_entries where id in(select id from hid_ids)$$)='0','B1: STAFF 04: 0 entri menurut id');
select pg_temp.ok(pg_temp.ra('04',$$select count(*) from journal_lines where id in(select id from hid_lines)$$)='0','B1: STAFF 04: 0 baris jurnal (journal_lines) setoran menurut id');
select pg_temp.ok(pg_temp.ra('04',$$select count(*) from journal_lines where entry_id in(select id from hid_ids)$$)='0','B1: STAFF 04: 0 baris menurut entry_id');
select pg_temp.ok(pg_temp.ra('04',$$select count(*) from journal_lines l join journal_entries e on e.id=l.entry_id where e.source like 'setoran%'$$)='0','B1: STAFF 04: join lines-entries source setoran: 0');
select pg_temp.ok(pg_temp.ra('04',$$select count(*) from journal_lines l join coa_accounts a on a.id=l.account_id where a.code in('810004','182001','760002') and l.entry_id in(select id from hid_ids)$$)='0','B1: STAFF 04: baris ke akun 810004/182001/760002 milik jurnal setoran: 0');
select pg_temp.ok(pg_temp.ra('04',$$select count(*) from journal_entries where deskripsi ilike 'Selisih kurang setoran%' or deskripsi ilike 'Kelebihan kas setoran%' or deskripsi ilike 'Pembalik setoran%'$$)='0','B1: STAFF 04: pencarian deskripsi jurnal selisih/kelebihan/pembalik setoran: 0');
select pg_temp.ok(pg_temp.ra('05',$$select count(*) from journal_entries where source in ('setoran','setoran-batal')$$)='0','B1: STAFF 05 (rekan kasir): 0');
select pg_temp.ok(pg_temp.ra('0e',$$select count(*) from journal_lines where id in(select id from hid_lines)$$)='0','B1: STAFF 0e (tanpa karyawan): 0');
select pg_temp.ok(pg_temp.ra('07',$$select count(*) from journal_entries where id in(select id from hid_ids)$$)='0' and pg_temp.ra('08',$$select count(*) from journal_lines where id in(select id from hid_lines)$$)='0','B1: STAFF cabang lain (07, 08): 0');
select pg_temp.ok(pg_temp.ra('0b',$$select count(*) from journal_entries where id in(select id from hid_ids)$$)='0' and pg_temp.ra('0b',$$select count(*) from journal_lines where id in(select id from hid_lines)$$)='0','B1: DOCTOR 0b: 0 entri dan 0 baris');
select pg_temp.ok(pg_temp.ra('06',$$select count(*) from journal_entries$$)='0' and pg_temp.ra('06',$$select count(*) from journal_lines$$)='0','Admin Online 06: 0 jurnal apa pun (pagar lama tetap)');
select pg_temp.ok(pg_temp.ra('01',$$select count(*) from journal_entries where id in(select id from hid_ids)$$)='4' and pg_temp.ra('01',$$select count(*) from journal_lines where id in(select id from hid_lines)$$)='8','OWNER 01 melihat 4 entri dan 8 baris jurnal setoran');
select pg_temp.ok(pg_temp.ra('02',$$select count(*) from journal_entries where id in(select id from hid_ids)$$)='4' and pg_temp.ra('02',$$select count(*) from journal_lines where id in(select id from hid_lines)$$)='8','ADMIN 02 melihat 4 entri dan 8 baris (jurnal setoran)');
select pg_temp.ok(pg_temp.ra('03',$$select count(*) from journal_entries where id in(select id from hid_ids)$$)='4' and pg_temp.ra('03',$$select count(*) from journal_lines where id in(select id from hid_lines)$$)='8','FINANCE 03 melihat 4 entri dan 8 baris (jurnal setoran)');
select pg_temp.ok(pg_temp.ra('0c',$$select count(*) from journal_entries where id in(select id from hid_ids)$$)='4','FINANCE 0c melihat 4 entri');
select pg_temp.ok(pg_temp.ra('0d',$$select count(*) from journal_entries where id in(select id from hid_ids)$$)='4' and pg_temp.ra('0d',$$select count(*) from journal_lines where id in(select id from hid_lines)$$)='8','ADMIN_UMUM 0d melihat 4 entri dan 8 baris (jurnal setoran)');
select pg_temp.ok(pg_temp.ra('09',$$select count(*) from journal_entries where id in(select id from hid_ids)$$)='0','FINANCE nonaktif 09: 0');
-- jurnal umum lain tidak berubah untuk staf
select pg_temp.ok(pg_temp.ra('04',$$select count(*) from journal_entries where source='manual' and source_ref in('fx-man-1','fx-man-3')$$)='2','jurnal umum cabang A tetap terlihat oleh STAFF 04 (2 entri manual)');
select pg_temp.ok(pg_temp.ra('04',$$select count(*) from journal_lines where entry_id in(select id from journal_entries where source='manual' and source_ref in('fx-man-1','fx-man-3'))$$)='4','baris jurnal umum A tetap terlihat oleh STAFF 04 (4 baris)');
select pg_temp.ok(pg_temp.ra('07',$$select count(*) from journal_entries where source_ref='fx-man-2'$$)='1' and pg_temp.ra('07',$$select count(*) from journal_entries where source_ref='fx-man-1'$$)='0','STAFF 07: jurnal cabang X terlihat, cabang A tidak (kebijakan cabang lama tetap)');
select pg_temp.ok(pg_temp.ra('04',$$select count(*) from journal_entries$$)::int=(select count(*)::int from journal_entries e where e.branch_id in(select branch_id from user_branches where user_id=pg_temp.u('04')) and e.source not in('setoran','setoran-batal')),'STAFF 04: jumlah entri terlihat = semua entri cabangnya kecuali setoran (tidak ada pemotongan lain)');
select pg_temp.ok(pg_temp.ra('04',$$select count(*) from journal_lines$$)::int=(select count(*)::int from journal_lines l join journal_entries e on e.id=l.entry_id where e.branch_id in(select branch_id from user_branches where user_id=pg_temp.u('04')) and e.source not in('setoran','setoran-batal')),'STAFF 04: jumlah baris terlihat = semua baris cabangnya kecuali setoran');
select pg_temp.ok(pg_temp.ra('01',$$select count(*) from journal_entries$$)::int=(select count(*)::int from journal_entries where branch_id is null or branch_id in(select id from branches)),'OWNER 01 melihat semua entri (tidak ada yang disembunyikan dari penyetuju)');
select pg_temp.ok(pg_temp.loose_jl('04')='0' and pg_temp.loose_jl('0b')='0','B1 berlapis: walau jl_all dilonggarkan (using true), STAFF/DOCTOR tetap 0 baris jurnal setoran (kebijakan journal_lines berdiri sendiri)');
select pg_temp.ok(pg_temp.loose_jl('01')='8','B1 berlapis: dengan jl_all longgar OWNER tetap melihat 8 baris jurnal setoran');
-- tulis tertutup
select pg_temp.ok(pg_temp.dml('04',$$update journal_entries set deskripsi='diubah' where id in(select id from hid_ids)$$)='0','B1: STAFF 04 tidak dapat mengubah entri jurnal setoran (0 baris)');
select pg_temp.ok(pg_temp.dml('04',$$delete from journal_entries where id in(select id from hid_ids)$$)='0','B1: STAFF 04 tidak dapat menghapus entri jurnal setoran menurut id (0 baris)');
select pg_temp.ok(pg_temp.dml('04',$$delete from journal_lines where entry_id in(select id from hid_ids)$$)='0','B1: STAFF 04 tidak dapat menghapus baris jurnal setoran (0 baris)');
select pg_temp.ok(pg_temp.dml('04',$$update journal_lines set debit=0 where id in(select id from hid_lines)$$)='0','B1: STAFF 04 tidak dapat mengubah baris jurnal setoran (0 baris)');
select pg_temp.ok(pg_temp.dml_sisa('04',$$delete from journal_lines$$) like '%\_8','B1: DELETE tanpa WHERE atas journal_lines oleh STAFF tidak menyentuh baris jurnal setoran (8 tetap ada)');
select pg_temp.ok(pg_temp.dml_sisa('04',$$update journal_lines set debit=debit$$) like '%\_8' and pg_temp.dml_sisa('01',$$update journal_lines set debit=debit where true$$) like '%\_8','UPDATE tanpa WHERE oleh STAFF/OWNER: baris setoran tetap 8');
select pg_temp.ok(pg_temp.dml('04',$$insert into journal_entries(tanggal,branch_id,source,source_ref,deskripsi,no_jurnal) values(current_date,'f6200000-0000-4000-8000-00000000000a','setoran','palsu','palsu','SJR-PALSU-1')$$) like 'ERR:%row-level security%','B1: STAFF tidak dapat memalsukan entri jurnal source setoran (ditolak RLS)');
select pg_temp.ok(pg_temp.dml('04',$$insert into journal_entries(tanggal,branch_id,source,source_ref,deskripsi,no_jurnal) values(current_date,'f6200000-0000-4000-8000-00000000000a','setoran-batal','palsu','palsu','SJR-PALSU-2')$$) like 'ERR:%row-level security%','B1: STAFF tidak dapat memalsukan entri source setoran-batal (ditolak RLS)');
select pg_temp.ok(pg_temp.dml('04',$$insert into journal_entries(tanggal,branch_id,source,source_ref,deskripsi,no_jurnal) values(current_date,'f6200000-0000-4000-8000-00000000000a','manual','fx-ok','jurnal biasa','JRN-FX-1')$$)='1','kebijakan umum tidak diubah: STAFF masih dapat menulis jurnal non-setoran (perilaku lama; lubang umum dilaporkan terpisah)');
select pg_temp.ok(pg_temp.dml('01',$$update journal_entries set deskripsi=deskripsi where id in(select id from hid_ids)$$)='4','OWNER dapat memproses entri jurnal setoran (4 baris) lewat jalur klien yang sama');
-- fungsi buku besar
create temp table tot_staff as select (x->>'account_id')::uuid acc,(x->>'debit')::numeric d,(x->>'credit')::numeric c from jsonb_array_elements(coalesce(pg_temp.raj('04',$$select public.ledger_account_totals(null,null,array['f6200000-0000-4000-8000-00000000000a'::uuid,'f6200000-0000-4000-8000-00000000000b'::uuid,'f6200000-0000-4000-8000-00000000000c'::uuid])$$),'[]'::jsonb)) x;
create temp table tot_owner as select (x->>'account_id')::uuid acc,(x->>'debit')::numeric d,(x->>'credit')::numeric c from jsonb_array_elements(coalesce(pg_temp.raj('01',$$select public.ledger_account_totals(null,null,array['f6200000-0000-4000-8000-00000000000a'::uuid,'f6200000-0000-4000-8000-00000000000b'::uuid,'f6200000-0000-4000-8000-00000000000c'::uuid])$$),'[]'::jsonb)) x;
grant all on tot_staff,tot_owner to public;
select pg_temp.ok((select count(*) from tot_owner)>=6 and (select count(*) from tot_staff)>=2,'buku besar: total per akun terbaca untuk STAFF (>=2 akun) dan OWNER (>=6 akun)');
select pg_temp.ok(not exists(select 1 from tot_staff s join coa_accounts a on a.id=s.acc where a.code in('810004','182001','760002')),'B1: ledger_account_totals untuk STAFF tidak memuat akun 810004/182001/760002');
select pg_temp.ok(exists(select 1 from tot_owner s join coa_accounts a on a.id=s.acc where a.code='810004') and exists(select 1 from tot_owner s join coa_accounts a on a.id=s.acc where a.code='182001') and exists(select 1 from tot_owner s join coa_accounts a on a.id=s.acc where a.code='760002'),'ledger_account_totals untuk OWNER memuat 810004/182001/760002');
select pg_temp.ok(not exists(
  select 1 from (select coalesce(o.acc,s.acc) acc, coalesce(o.d-o.c,0)-coalesce(s.d-s.c,0) diff from tot_owner o full join tot_staff s on s.acc=o.acc) q
   left join (select l.account_id acc,sum(l.debit-l.credit) h from journal_lines l where l.entry_id in(select id from hid_ids) group by 1) h on h.acc=q.acc
  where q.diff is distinct from coalesce(h.h,0)),'buku besar: selisih total OWNER - STAFF per akun = persis jumlah baris jurnal setoran (tidak ada pemotongan lain)');
select pg_temp.ok((select sum(d)-sum(c) from tot_staff)=0 and (select sum(d)-sum(c) from tot_owner)=0,'buku besar tetap seimbang (debit=kredit) untuk STAFF dan OWNER (entri disaring utuh)');
select pg_temp.ok(jsonb_array_length(pg_temp.raj('04',$$select public.ledger_account_lines(null,null,array['f6200000-0000-4000-8000-00000000000a'::uuid,'f6200000-0000-4000-8000-00000000000b'::uuid,'f6200000-0000-4000-8000-00000000000c'::uuid],null)$$))
  +8=jsonb_array_length(pg_temp.raj('01',$$select public.ledger_account_lines(null,null,array['f6200000-0000-4000-8000-00000000000a'::uuid,'f6200000-0000-4000-8000-00000000000b'::uuid,'f6200000-0000-4000-8000-00000000000c'::uuid],null)$$)),'buku besar: ledger_account_lines OWNER = STAFF + 8 baris jurnal setoran');
select pg_temp.ok(position('"source": "setoran' in pg_temp.raj('04',$$select public.ledger_account_lines(null,null,null,null)$$)::text)=0 and position('Selisih' in pg_temp.raj('04',$$select public.ledger_account_lines(null,null,null,null)$$)::text)=0 and position('Kelebihan' in pg_temp.raj('04',$$select public.ledger_account_lines(null,null,null,null)$$)::text)=0,'B1: ledger_account_lines untuk STAFF tidak memuat source setoran/Selisih/Kelebihan');
select pg_temp.ok(position('Selisih kurang setoran' in pg_temp.raj('01',$$select public.ledger_account_lines(null,null,null,null)$$)::text)>0 and position('Kelebihan kas setoran' in pg_temp.raj('03',$$select public.ledger_account_lines(null,null,null,null)$$)::text)>0 and position('Pembalik setoran' in pg_temp.raj('0d',$$select public.ledger_account_lines(null,null,null,null)$$)::text)>0,'OWNER/FINANCE/ADMIN_UMUM: buku besar memuat deskripsi jurnal setoran');
select pg_temp.ok(jsonb_array_length(pg_temp.raj('02',$$select public.ledger_account_lines(null,null,array['f6200000-0000-4000-8000-00000000000a'::uuid],array[(select id from coa_accounts where code='182001')])$$))=1,'ADMIN 02: ledger_account_lines per akun 182001 memuat jurnal kasbon setoran (1 baris)');
select pg_temp.ok(jsonb_array_length(pg_temp.raj('04',$$select public.ledger_account_lines(null,null,null,array[(select id from coa_accounts where code in('182001'))])$$))=0 and jsonb_array_length(pg_temp.raj('04',$$select public.ledger_account_lines(null,null,null,array[(select id from coa_accounts where code='810004')])$$))=0,'B1: STAFF: daftar mutasi akun 182001 dan 810004 kosong');
-- mutasi akun kas laci (cash account list) untuk staf tidak membuka selisih
select pg_temp.ok((select count(*) from jsonb_array_elements(pg_temp.raj('04',$$select public.ledger_account_lines(null,null,array['f6200000-0000-4000-8000-00000000000a'::uuid],array[(select id from coa_accounts where code='1195')])$$)))=
  (select count(*) from journal_lines l join journal_entries e on e.id=l.entry_id where l.account_id=(select id from coa_accounts where code='1195') and e.branch_id='f6200000-0000-4000-8000-00000000000a' and e.source not in('setoran','setoran-batal')),'mutasi akun kas finance (1195) cabang A untuk STAFF = tanpa baris setoran');
-- jalur service / anon / tanpa profil
select set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('request.jwt.claim.sub','',true);
select pg_temp.ok(public.setoran_jurnal_boleh() and public.setoran_jurnal_tersembunyi()='{}'::uuid[],'service_role: setoran_jurnal_boleh() true dan daftar tersembunyi kosong');
select set_config('request.jwt.claims','{"role":"anon"}',true);
select pg_temp.ok(not public.setoran_jurnal_boleh() and cardinality(public.setoran_jurnal_tersembunyi())=4,'anon: tidak boleh; 4 entri tersembunyi');
select set_config('request.jwt.claims','{"role":"authenticated"}',true),set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-0000000000ff',true);
select pg_temp.ok(not public.setoran_jurnal_boleh(),'authenticated tanpa profil: tidak boleh');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.ok(not public.setoran_jurnal_boleh() and cardinality(public.setoran_jurnal_tersembunyi())=4,'authenticated tanpa sub: tidak boleh');
select pg_temp.noauth();
select pg_temp.as_('04');select pg_temp.ok(not public.setoran_jurnal_boleh() and cardinality(public.setoran_jurnal_tersembunyi())=4,'STAFF: tidak boleh; 4 entri tersembunyi');
select pg_temp.as_('0b');select pg_temp.ok(not public.setoran_jurnal_boleh(),'DOCTOR: tidak boleh');
select pg_temp.as_('06');select pg_temp.ok(not public.setoran_jurnal_boleh(),'Admin Online: tidak boleh');
select pg_temp.as_('09');select pg_temp.ok(not public.setoran_jurnal_boleh(),'Finance nonaktif: tidak boleh');
select pg_temp.as_('0d');select pg_temp.ok(public.setoran_jurnal_boleh() and public.setoran_jurnal_tersembunyi()='{}'::uuid[],'ADMIN_UMUM: boleh; tanpa entri tersembunyi');
select pg_temp.as_('01');select pg_temp.ok(public.setoran_jurnal_boleh(),'OWNER: boleh');
select pg_temp.as_('02');select pg_temp.ok(public.setoran_jurnal_boleh(),'ADMIN: boleh');
select pg_temp.as_('03');select pg_temp.ok(public.setoran_jurnal_boleh(),'FINANCE: boleh');
select pg_temp.noauth();

-- ── 2. M1: yang terlihat staf sesudah diajukan / disetujui / dibatalkan ──────────────────────────
select pg_temp.as_('04');set local role authenticated;
select pg_temp.save('dA-staf',public.setoran_detail(pg_temp.sid('pA')));
select pg_temp.save('dB-staf',public.setoran_detail(pg_temp.sid('pB')));
select pg_temp.save('dC-staf',public.setoran_detail(pg_temp.sid('pC')));
select pg_temp.save('lst-staf',public.setoran_daftar(null,null,pg_temp.br('0a'),null,null));
select pg_temp.as_('01');
select pg_temp.save('dA-app',public.setoran_detail(pg_temp.sid('pA')));
select pg_temp.save('lst-app',public.setoran_daftar(null,null,pg_temp.br('0a'),null,null));
reset role;
select pg_temp.ok((select r->>'status'='Disetujui' and (r->>'sisa')::numeric=0 and (r->>'persen')::numeric=100 and r->>'badge'='Lunas' from res where name='dA-staf'),'M1: staf, A disetujui dengan KURANG 100.000: sisa 0, persen 100, badge Lunas (tidak lagi membocorkan kekurangan)');
select pg_temp.ok((select not r ?| array['keuangan','diharapkan','selisih','selisih_sementara','jenis','penyelesaian','peringatan','pengeluaran_melebihi'] from res where name='dA-staf'),'M1: detail staf tidak memuat kunci keuangan/diharapkan/selisih/jenis/penyelesaian/peringatan');
select pg_temp.ok((select (r->>'sisa')::numeric=0 and (r->>'persen')::numeric=100 and r->>'badge'='Dibatalkan' from res where name='dB-staf'),'M1: staf, B dibatalkan (void): sisa 0, persen 100, badge Dibatalkan');
select pg_temp.ok((select (r->>'sisa')::numeric=0 and (r->>'persen')::numeric=100 and r->>'badge'='Lunas' from res where name='dC-staf'),'M1: staf, C disetujui kurang 80.000 (beban perusahaan): sisa 0, persen 100, Lunas');
select pg_temp.ok((select (r->>'sisa')::numeric=100000 and (r->>'persen')::numeric=80 and (r->'keuangan'->>'selisih')::numeric=-100000 and r->'keuangan'->>'jenis'='Kurang' from res where name='dA-app'),'M1: penyetuju tetap melihat angka nyata: sisa 100.000, persen 80, selisih -100.000 (Kurang)');
select pg_temp.ok((select (x->>'sisa')::numeric=0 and x->>'status'='Disetujui' and not x ?| array['diharapkan','selisih','jenis','penyelesaian','pengeluaran_melebihi'] from res,jsonb_array_elements(r->'baris') x where name='lst-staf' and x->>'no_setoran'=(select no_setoran from setoran where id=pg_temp.sid('pA'))),'M1: daftar staf: baris A Disetujui sisa 0, tanpa kolom selisih/jenis/penyelesaian');
select pg_temp.ok((select (x->>'sisa')::numeric=100000 and x->>'jenis'='Kurang' and (x->>'pengeluaran_melebihi')::boolean=false from res,jsonb_array_elements(r->'baris') x where name='lst-app' and x->>'no_setoran'=(select no_setoran from setoran where id=pg_temp.sid('pA'))),'M1: daftar penyetuju: baris A sisa 100.000 jenis Kurang pengeluaran_melebihi=false');
-- Draft/Ditolak: staf melihat sisa nyata supaya tahu berapa yang harus disetor
select pg_temp.save('sD1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('0d'),'04',3,0,400000)));
select pg_temp.mk('pD',pg_temp.br('0d'),'04');
select pg_temp.pay('pD',100000,'Serah tunai','04',null,'d-t1',2);
select pg_temp.as_('04');set local role authenticated;
select pg_temp.save('dD1',public.setoran_detail(pg_temp.sid('pD')));
select pg_temp.save('lst-staf-d',public.setoran_daftar(null,null,pg_temp.br('0d'),null,null));
reset role;
select pg_temp.ok((select (x->>'sisa')::numeric=300000 and x->>'status'='Draft' from res,jsonb_array_elements(r->'baris') x where name='lst-staf-d'),'M1: daftar staf: baris Draft tetap menampilkan sisa nyata 300.000');
select pg_temp.ok((select r->>'status'='Draft' and (r->>'sisa')::numeric=300000 and (r->>'persen')::numeric=25 and r->>'badge' in('Belum lunas','Terlambat') from res where name='dD1'),'M1: Draft: staf tetap melihat sisa nyata 300.000 dan persen 25 (kebutuhan kerja, tidak berubah)');
select pg_temp.pay('pD',350000,'Serah tunai','04',null,'d-t2',2);
select pg_temp.as_('04');set local role authenticated;
select pg_temp.save('dD2',public.setoran_detail(pg_temp.sid('pD')));
reset role;
select pg_temp.ok((select (r->>'sisa')::numeric=0 and (r->>'persen')::numeric=100 from res where name='dD2'),'M1: Draft: transfer melebihi kewajiban: sisa dipatok 0 (kata "lebih" tidak muncul), persen 100');
select pg_temp.sub('pD','04','d-aj');
select pg_temp.as_('03');set local role authenticated;
select pg_temp.save('tolakD',public.setoran_tolak(pg_temp.sid('pD'),'nominal belum jelas',pg_temp.kk('d-tolak')));
reset role;
select pg_temp.as_('04');set local role authenticated;
select pg_temp.save('dD3',public.setoran_detail(pg_temp.sid('pD')));
reset role;
select pg_temp.ok((select r->>'status'='Ditolak' and (r->>'sisa')::numeric=0 and r->>'alasan_tolak'='nominal belum jelas' from res where name='dD3'),'Ditolak: staf melihat status, alasan penolakan; sisa dipatok >= 0');

-- ── 3. M2: pengeluaran lebih besar dari kewajiban ────────────────────────────────────────────────
-- E: periode tanpa shift + pengeluaran 1.000.000 (bukti ada). F: kewajiban 500.000, pengeluaran 600.000. G: pengeluaran = kewajiban (batas). H: negatif + transfer. I: tanpa kewajiban, transfer 100.000.
select pg_temp.save('sF1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('0f'),'04',3,0,500000)));
select pg_temp.save('sG1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('a1'),'04',3,0,300000)));
select pg_temp.save('sH1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('a2'),'04',3,0,100000)));
select pg_temp.mk('pE',pg_temp.br('0e'),'04');select pg_temp.mk('pF',pg_temp.br('0f'),'04');select pg_temp.mk('pG',pg_temp.br('a1'),'04');select pg_temp.mk('pH',pg_temp.br('a2'),'04');select pg_temp.mk('pI',pg_temp.br('a3'),'04');
select pg_temp.exps('pE','04',3,'Operasional',1000000,'e-e1');
select pg_temp.exps('pF','04',3,'Operasional',600000,'f-e1');
select pg_temp.exps('pG','04',3,'Operasional',300000,'g-e1');
select pg_temp.exps('pH','04',3,'Operasional',250000,'h-e1');
select pg_temp.pay('pH',50000,'Serah tunai','04','03','h-t1',2);
select pg_temp.pay('pI',100000,'Serah tunai','04','03','i-t1',2);
select pg_temp.sub('pE','04','e-aj');select pg_temp.sub('pF','04','f-aj');select pg_temp.sub('pG','04','g-aj');select pg_temp.sub('pH','04','h-aj');select pg_temp.sub('pI','04','i-aj');
select pg_temp.save('cnt0',jsonb_build_object('j',(select count(*) from journal_entries),'e',(select count(*) from expenses)));
select pg_temp.ok((select (r->>'j')::int=(select count(*) from journal_entries) from res where name='cnt0'),'penghitung awal jurnal/pengeluaran tersimpan');
select pg_temp.as_('01');set local role authenticated;
select pg_temp.ok(pg_temp.ra('01',$$select public.setoran_setujui(pg_temp.sid('pE'),pg_temp.kk('ap-e1'),null,null,false,false,'ok')::text$$) like 'ERR:SETORAN_PENGELUARAN_MELEBIHI%1000000%','M2: periode tanpa shift + pengeluaran 1.000.000: setujui DITOLAK dengan pesan jelas memuat angka (bukan kelebihan palsu)');
select pg_temp.ok(pg_temp.ra('01',$$select public.setoran_setujui(pg_temp.sid('pF'),pg_temp.kk('ap-f1'),null,null,false,true,'ok')::text$$) like 'ERR:SETORAN_PENGELUARAN_MELEBIHI%600000%500000%100000%','M2: kewajiban 500.000 vs pengeluaran 600.000: ditolak; pesan memuat 600.000, 500.000 dan kelebihan 100.000 (konfirmasi selisih besar tidak menembusnya)');
select pg_temp.ok(pg_temp.ra('01',$$select public.setoran_setujui(pg_temp.sid('pH'),pg_temp.kk('ap-h1'),null,null,false,false,'ok')::text$$) like 'ERR:SETORAN_PENGELUARAN_MELEBIHI%','M2: pengeluaran 250.000 > kewajiban 100.000 dengan transfer 50.000: tetap ditolak');
reset role;
select pg_temp.ok((select (r->>'j')::int=(select count(*) from journal_entries) and (r->>'e')::int=(select count(*) from expenses) from res where name='cnt0') and pg_temp.st('pE')='Diajukan' and pg_temp.st('pF')='Diajukan' and pg_temp.st('pH')='Diajukan','M2: penolakan atomik: tidak ada jurnal, tidak ada pengeluaran terposting, status tetap Diajukan');
select pg_temp.ok(not exists(select 1 from journal_entries j join journal_lines l on l.entry_id=j.id join coa_accounts a on a.id=l.account_id where a.code='810004' and j.source='setoran' and j.source_ref in(pg_temp.sid('pE')::text,pg_temp.sid('pF')::text,pg_temp.sid('pH')::text)),'M2: tidak ada jurnal 810004 palsu untuk setoran E/F/H');
select pg_temp.as_('01');set local role authenticated;
select pg_temp.save('dE-app',public.setoran_detail(pg_temp.sid('pE')));
select pg_temp.save('lst-app2',public.setoran_daftar(null,null,pg_temp.br('0e'),null,null));
reset role;
select pg_temp.ok((select exists(select 1 from jsonb_array_elements(r->'keuangan'->'peringatan') w where w->>'kode'='PENGELUARAN_MELEBIHI' and w->>'tingkat'='blokir') and exists(select 1 from jsonb_array_elements(r->'keuangan'->'peringatan') w where w->>'kode'='TANPA_SHIFT') and (r->'keuangan'->>'diharapkan')::numeric=-1000000 from res where name='dE-app'),'M2: layar penyetuju: peringatan PENGELUARAN_MELEBIHI (blokir) + TANPA_SHIFT, diharapkan -1.000.000 tampil apa adanya');
select pg_temp.ok((select (x->>'pengeluaran_melebihi')::boolean from res,jsonb_array_elements(r->'baris') x where name='lst-app2'),'M2: daftar penyetuju: pengeluaran_melebihi = true');
select pg_temp.as_('04');set local role authenticated;
select pg_temp.save('dE-staf',public.setoran_detail(pg_temp.sid('pE')));
reset role;
select pg_temp.ok((select not r ?| array['keuangan','peringatan','diharapkan'] and (r->>'sisa')::numeric=0 from res where name='dE-staf'),'M2: staf tidak melihat peringatan/keuangan apa pun');
-- batas: pengeluaran = kewajiban -> lolos (Pas), pengeluaran dibukukan sekali
select pg_temp.appr('pG','01','ap-g');
select pg_temp.ok((select r->>'penyelesaian'='Pas' and (r->>'selisih')::numeric=0 and jsonb_array_length(r->'pengeluaran_ids')=1 from res where name='ap-pG') and pg_temp.jn('setoran',pg_temp.sid('pG'))=0,'M2 batas: pengeluaran = kewajiban 300.000, transfer 0: disetujui Pas tanpa jurnal selisih, pengeluaran dibukukan sekali');
-- lebih sungguhan (uang diterima tanpa kewajiban) tetap menjadi 810004
select pg_temp.appr('pI','01','ap-i');
select pg_temp.ok((select r->>'penyelesaian'='PendapatanLain' and (r->>'selisih')::numeric=100000 from res where name='ap-pI') and (select coalesce(sum(l.credit-l.debit),0) from journal_lines l join journal_entries j on j.id=l.entry_id join coa_accounts a on a.id=l.account_id where j.source='setoran' and j.source_ref=pg_temp.sid('pI')::text and a.code='810004')=100000,'tanpa kewajiban + transfer 100.000: kelebihan nyata 100.000 -> 810004 (perilaku lama untuk kasus sah tetap)');
-- jalan keluar: tolak, hapus baris, ajukan ulang, setujui
select pg_temp.as_('03');set local role authenticated;
select pg_temp.save('tolakE',public.setoran_tolak(pg_temp.sid('pE'),'pengeluaran lebih besar dari kewajiban',pg_temp.kk('e-tolak')));
reset role;
select pg_temp.as_('04');set local role authenticated;
select pg_temp.save('delE',public.setoran_hapus_pengeluaran(pg_temp.sid('pE'),pg_temp.lineid('pE'),pg_temp.rev('pE'),pg_temp.kk('e-del')));
reset role;
select pg_temp.sub('pE','04','e-aj2');
select pg_temp.appr('pE','01','ap-e2');
select pg_temp.ok((select r->>'penyelesaian'='Pas' from res where name='ap-pE') and pg_temp.st('pE')='Disetujui' and (select count(*) from expenses where deskripsi like 'Setoran '||(select no_setoran from setoran where id=pg_temp.sid('pE'))||'%')=0,'M2 jalan keluar: tolak -> hapus baris -> ajukan ulang -> disetujui Pas, tidak ada pengeluaran terposting');

-- ── 4. M3: storage bucket dokumen, awalan setoran/ ───────────────────────────────────────────────
-- objek uji: f1,f2 cabang A (milik 04 dan 05); f3 cabang X (milik 08); z non-awalan; m1..m3 cabang K (m1 akan diklaim); rusak: tanpa cabang / bersarang / cabang bukan uuid
select pg_temp.obj('setoran/f6200000-0000-4000-8000-00000000000a/f1.jpg',pg_temp.u('04')::text);
select pg_temp.obj('setoran/f6200000-0000-4000-8000-00000000000a/f2.jpg',pg_temp.u('05')::text);
select pg_temp.obj('setoran/f6200000-0000-4000-8000-0000000000b1/f3.jpg',pg_temp.u('08')::text);
select pg_temp.obj('pembelian/zz.jpg',pg_temp.u('08')::text);
select pg_temp.obj('setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg',pg_temp.u('04')::text);
select pg_temp.obj('setoran/f6200000-0000-4000-8000-0000000000a5/m2.jpg',pg_temp.u('04')::text);
select pg_temp.obj('setoran/f6200000-0000-4000-8000-0000000000a5/m3.jpg',pg_temp.u('05')::text);
select pg_temp.obj('setoran/rusak1.jpg',pg_temp.u('04')::text);
select pg_temp.obj('setoran/f6200000-0000-4000-8000-00000000000a/sub/rusak2.jpg',pg_temp.u('04')::text);
select pg_temp.obj('setoran/bukan-uuid/rusak3.jpg',pg_temp.u('04')::text);
create temp table nm_obj(n text);grant all on nm_obj to public;
insert into nm_obj values('setoran/f6200000-0000-4000-8000-00000000000a/f1.jpg'),('setoran/f6200000-0000-4000-8000-00000000000a/f2.jpg'),('setoran/f6200000-0000-4000-8000-0000000000b1/f3.jpg');
create temp table nm_bad(n text);grant all on nm_bad to public;
insert into nm_bad values('setoran/rusak1.jpg'),('setoran/f6200000-0000-4000-8000-00000000000a/sub/rusak2.jpg'),('setoran/bukan-uuid/rusak3.jpg');
select pg_temp.ok(pg_temp.ra('04',$$select count(*) from storage.objects where bucket_id='dokumen' and name in(select n from nm_obj)$$)='2','M3: STAFF 04 (cabang A) melihat berkas setoran cabang A (2) dan TIDAK berkas cabang X');
select pg_temp.ok(pg_temp.ra('05',$$select count(*) from storage.objects where bucket_id='dokumen' and name in(select n from nm_obj)$$)='2' and pg_temp.ra('0e',$$select count(*) from storage.objects where bucket_id='dokumen' and name in(select n from nm_obj)$$)='2','M3: rekan STAFF 05 dan 0e (cabang A) juga melihat 2');
select pg_temp.ok(pg_temp.ra('08',$$select count(*) from storage.objects where bucket_id='dokumen' and name in(select n from nm_obj)$$)='1' and pg_temp.ra('07',$$select count(*) from storage.objects where bucket_id='dokumen' and name like 'setoran/%' and name in(select n from nm_obj)$$)='1','M3: STAFF cabang X (07, 08) hanya melihat berkas cabang X (1): tidak dapat mendaftar folder setoran cabang lain');
select pg_temp.ok(pg_temp.ra('01',$$select count(*) from storage.objects where bucket_id='dokumen' and name in(select n from nm_obj)$$)='3' and pg_temp.ra('0d',$$select count(*) from storage.objects where bucket_id='dokumen' and name in(select n from nm_obj)$$)='3','M3: OWNER dan ADMIN_UMUM (semua cabang) melihat 3');
select pg_temp.ok(pg_temp.ra('02',$$select count(*) from storage.objects where bucket_id='dokumen' and name in(select n from nm_obj)$$)='2' and pg_temp.ra('03',$$select count(*) from storage.objects where bucket_id='dokumen' and name in(select n from nm_obj)$$)='2','M3: ADMIN/FINANCE dengan akses cabang terbatas melihat berkas cabangnya saja (2)');
select pg_temp.ok(pg_temp.ra('0b',$$select count(*) from storage.objects where bucket_id='dokumen' and name like 'setoran/%'$$)='0','M3: DOCTOR 0b melihat 0 berkas setoran/ (walau punya akses cabang)');
select pg_temp.ok(pg_temp.ra('06',$$select count(*) from storage.objects$$)='0','Admin Online: 0 objek storage apa pun (pagar lama tetap)');
select pg_temp.ok(pg_temp.ra('09',$$select count(*) from storage.objects where bucket_id='dokumen' and name like 'setoran/%'$$)='0','Finance nonaktif 09: 0 berkas setoran/');
select pg_temp.ok(pg_temp.ra('01',$$select count(*) from storage.objects where bucket_id='dokumen' and name in(select n from nm_bad)$$)='0' and pg_temp.ra('04',$$select count(*) from storage.objects where bucket_id='dokumen' and name in(select n from nm_bad)$$)='0','M3: nama rusak di bawah setoran/ (tanpa cabang, bersarang, cabang bukan uuid) tidak terbaca siapa pun lewat API (Owner pun)');
select pg_temp.ok(pg_temp.ra('0b',$$select count(*) from storage.objects where bucket_id='dokumen' and name='pembelian/zz.jpg'$$)='1' and pg_temp.ra('04',$$select count(*) from storage.objects where bucket_id='dokumen' and name='pembelian/zz.jpg'$$)='1','diferensial: berkas non-setoran (pembelian/) tetap terbaca DOCTOR dan STAFF seperti semula');
-- unggah
select pg_temp.ok(pg_temp.dml('04',$$insert into storage.objects(bucket_id,name,owner_id) values('dokumen','setoran/f6200000-0000-4000-8000-00000000000a/baru1.jpg',auth.uid()::text)$$)='1','M3: STAFF 04 dapat mengunggah ke setoran/<cabang A>/');
select pg_temp.ok(pg_temp.dml('04',$$insert into storage.objects(bucket_id,name,owner_id) values('dokumen','setoran/f6200000-0000-4000-8000-0000000000b1/baru2.jpg',auth.uid()::text)$$) like 'ERR:%row-level security%','M3: STAFF 04 tidak dapat mengunggah ke folder cabang X');
select pg_temp.ok(pg_temp.dml('04',$$insert into storage.objects(bucket_id,name,owner_id) values('dokumen','setoran/baru3.jpg',auth.uid()::text)$$) like 'ERR:%row-level security%','M3: unggah ke setoran/ tanpa cabang ditolak');
select pg_temp.ok(pg_temp.dml('0b',$$insert into storage.objects(bucket_id,name,owner_id) values('dokumen','setoran/f6200000-0000-4000-8000-00000000000a/baru4.jpg',auth.uid()::text)$$) like 'ERR:%row-level security%','M3: DOCTOR tidak dapat mengunggah ke setoran/');
select pg_temp.ok(pg_temp.dml('06',$$insert into storage.objects(bucket_id,name,owner_id) values('dokumen','setoran/f6200000-0000-4000-8000-00000000000a/baru5.jpg',auth.uid()::text)$$) like 'ERR:%row-level security%','Admin Online tidak dapat mengunggah ke setoran/');
select pg_temp.ok(pg_temp.dml('04',$$insert into storage.objects(bucket_id,name,owner_id) values('dokumen','pembelian/baru6.jpg',auth.uid()::text)$$)='1' and pg_temp.dml('0b',$$insert into storage.objects(bucket_id,name,owner_id) values('dokumen','pembelian/baru7.jpg',auth.uid()::text)$$)='1','diferensial: unggah non-setoran tetap diizinkan (STAFF dan DOCTOR)');
select pg_temp.ok(pg_temp.dml('01',$$insert into storage.objects(bucket_id,name,owner_id) values('dokumen','setoran/f6200000-0000-4000-8000-0000000000b1/baru8.jpg',auth.uid()::text)$$)='1','OWNER dapat mengunggah ke folder cabang mana pun');
-- klaim m1 lewat baris pengeluaran nyata (setoran K)
select pg_temp.save('sK1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('a5'),'04',3,0,300000)));
select pg_temp.mk('pK',pg_temp.br('a5'),'04');
select pg_temp.as_('04');set local role authenticated;
select pg_temp.save('k-e1',public.setoran_tambah_pengeluaran(pg_temp.sid('pK'),pg_temp.today()-3,'Operasional',10000,'dengan m1',pg_temp.lampp('setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg'),pg_temp.rev('pK'),pg_temp.kk('k-e1')));
reset role;
select pg_temp.ok((select count(*)=1 from setoran_lampiran_pakai where path='setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg' and jenis='pengeluaran' and setoran_id=pg_temp.sid('pK') and dipakai_oleh=pg_temp.u('04')),'M5: berkas m1 diklaim oleh baris pengeluaran setoran K');
-- hapus
select pg_temp.ok(pg_temp.dml('04',$$delete from storage.objects where bucket_id='dokumen' and name='setoran/f6200000-0000-4000-8000-0000000000a5/m2.jpg'$$)='1','M3: STAFF 04 dapat menghapus unggahan yatim miliknya sendiri (m2)');
select pg_temp.ok(pg_temp.dml('04',$$delete from storage.objects where bucket_id='dokumen' and name='setoran/f6200000-0000-4000-8000-0000000000a5/m3.jpg'$$)='0','M3: STAFF 04 tidak dapat menghapus unggahan yatim milik rekan (m3)');
select pg_temp.ok(pg_temp.dml('05',$$delete from storage.objects where bucket_id='dokumen' and name='setoran/f6200000-0000-4000-8000-0000000000a5/m3.jpg'$$)='1','M3: pemilik (05) dapat menghapus m3');
select pg_temp.ok(pg_temp.dml('01',$$delete from storage.objects where bucket_id='dokumen' and name='setoran/f6200000-0000-4000-8000-0000000000a5/m3.jpg'$$)='1','M3: OWNER dapat menghapus berkas yatim milik orang lain');
select pg_temp.ok(pg_temp.dml('04',$$delete from storage.objects where bucket_id='dokumen' and name='setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg'$$)='0','M3: berkas yang sudah dipakai baris (m1) tidak dapat dihapus pengunggahnya (bukti tidak boleh hilang)');
select pg_temp.ok(pg_temp.dml('01',$$delete from storage.objects where bucket_id='dokumen' and name='setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg'$$)='0' and pg_temp.dml('03',$$delete from storage.objects where bucket_id='dokumen' and name='setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg'$$)='0','M3: berkas terklaim juga tidak dapat dihapus OWNER maupun FINANCE');
select pg_temp.ok(pg_temp.dml('08',$$delete from storage.objects where bucket_id='dokumen' and name='setoran/f6200000-0000-4000-8000-00000000000a/f1.jpg'$$)='0' and pg_temp.dml('0b',$$delete from storage.objects where bucket_id='dokumen' and name='setoran/f6200000-0000-4000-8000-00000000000a/f1.jpg'$$)='0','M3: staf cabang lain dan DOCTOR tidak dapat menghapus berkas setoran cabang A');
select pg_temp.ok(pg_temp.dml('05',$$delete from storage.objects where bucket_id='dokumen' and name='setoran/f6200000-0000-4000-8000-00000000000a/f1.jpg'$$)='0','M3: rekan cabang A (05) tidak dapat menghapus berkas f1 milik 04');
select pg_temp.ok(pg_temp.dml('0b',$$delete from storage.objects where bucket_id='dokumen' and name='pembelian/zz.jpg'$$)='1','diferensial: DOCTOR masih dapat menghapus berkas non-setoran (perilaku lama; di luar lingkup)');
-- ubah
select pg_temp.ok(pg_temp.dml('04',$$update storage.objects set name=name||'x' where bucket_id='dokumen' and name='setoran/f6200000-0000-4000-8000-00000000000a/f1.jpg'$$)='0' and pg_temp.dml('01',$$update storage.objects set name=name||'x' where bucket_id='dokumen' and name='setoran/f6200000-0000-4000-8000-00000000000a/f1.jpg'$$)='0','M3: berkas setoran tidak dapat diubah (ganti nama/timpa) oleh STAFF maupun OWNER');
select pg_temp.ok(pg_temp.dml('04',$$update storage.objects set name=name where bucket_id='dokumen' and name='pembelian/zz.jpg'$$)='1','diferensial: ubah berkas non-setoran tetap seperti semula (kebijakan uji)');
-- fungsi kebijakan langsung
select pg_temp.ok(pg_temp.ra('04',$$select public.setoran_berkas_boleh('setoran/f6200000-0000-4000-8000-00000000000a/apa.jpg')::text$$)='true' and pg_temp.ra('08',$$select public.setoran_berkas_boleh('setoran/f6200000-0000-4000-8000-00000000000a/apa.jpg')::text$$)='false','setoran_berkas_boleh: STAFF cabang A true, STAFF cabang X false');
select pg_temp.ok(pg_temp.ra('0b',$$select public.setoran_berkas_boleh('setoran/f6200000-0000-4000-8000-00000000000a/apa.jpg')::text$$)='false' and pg_temp.ra('04',$$select public.setoran_berkas_boleh(null)::text$$)='false' and pg_temp.ra('01',$$select public.setoran_berkas_boleh('setoran/xx')::text$$)='false','setoran_berkas_boleh: DOCTOR false, nama kosong false, nama rusak false (Owner pun)');
select pg_temp.ok(pg_temp.ra('04',$$select public.setoran_berkas_boleh_hapus('setoran/f6200000-0000-4000-8000-00000000000a/f1.jpg','x')::text$$)='false' and pg_temp.ra('04',$$select public.setoran_berkas_boleh_hapus('setoran/f6200000-0000-4000-8000-00000000000a/f1.jpg',auth.uid()::text)::text$$)='true','setoran_berkas_boleh_hapus: bukan pemilik false, pemilik true (berkas yatim)');
select pg_temp.ok(pg_temp.ra('04',$$select public.setoran_berkas_boleh_hapus('setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg',auth.uid()::text)::text$$)='false','setoran_berkas_boleh_hapus: berkas terklaim false walau pemilik');
select pg_temp.ok(pg_temp.ra('04',$$select public.setoran_berkas_cabang('setoran/f6200000-0000-4000-8000-00000000000a/apa.jpg')::text$$)='f6200000-0000-4000-8000-00000000000a' and pg_temp.ra('04',$$select coalesce(public.setoran_berkas_cabang('setoran/f6200000-0000-4000-8000-00000000000a/a/b.jpg')::text,'NULL')$$)='NULL' and pg_temp.ra('04',$$select coalesce(public.setoran_berkas_cabang('Setoran/f6200000-0000-4000-8000-00000000000a/b.jpg')::text,'NULL')$$)='NULL','setoran_berkas_cabang: path sah -> cabang; bersarang -> kosong; huruf besar -> kosong');

-- ── 5. M5: validasi + klaim berkas bukti; peringatan kembar ──────────────────────────────────────
select pg_temp.obj('setoran/f6200000-0000-4000-8000-0000000000a5/n1.jpg',pg_temp.u('04')::text);select pg_temp.obj('setoran/f6200000-0000-4000-8000-0000000000a5/n2.jpg',pg_temp.u('04')::text);
select pg_temp.as_('04');set local role authenticated;
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pK'),pg_temp.today()-3,'Operasional',1000,'x',pg_temp.lampp('f.jpg'),pg_temp.rev('pK'),pg_temp.kk('m5-1'))$$,'SETORAN_LAMPIRAN_PATH','M5: path tanpa awalan setoran/<cabang>/ ditolak');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pK'),pg_temp.today()-3,'Operasional',1000,'x',pg_temp.lampp('setoran/f6200000-0000-4000-8000-0000000000b1/f3.jpg'),pg_temp.rev('pK'),pg_temp.kk('m5-2'))$$,'SETORAN_LAMPIRAN_PATH','M5: berkas milik cabang LAIN (X) tidak dapat dilampirkan ke setoran cabang K');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pK'),pg_temp.today()-3,'Operasional',1000,'x',pg_temp.lampp('setoran/f6200000-0000-4000-8000-0000000000a5/sub/n1.jpg'),pg_temp.rev('pK'),pg_temp.kk('m5-3'))$$,'SETORAN_LAMPIRAN_PATH','M5: path bersarang ditolak');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pK'),pg_temp.today()-3,'Operasional',1000,'x',pg_temp.lampp('setoran/f6200000-0000-4000-8000-0000000000a5/'),pg_temp.rev('pK'),pg_temp.kk('m5-4'))$$,'SETORAN_LAMPIRAN_PATH','M5: nama berkas kosong ditolak');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pK'),pg_temp.today()-3,'Operasional',1000,'x',pg_temp.lampp('setoran/f6200000-0000-4000-8000-0000000000a5/tidakada.jpg'),pg_temp.rev('pK'),pg_temp.kk('m5-5'))$$,'SETORAN_LAMPIRAN_TIDAK_ADA','M5: berkas yang tidak ada di storage ditolak');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pK'),pg_temp.today()-3,'Operasional',1000,'x',pg_temp.lampp('setoran/f6200000-0000-4000-8000-0000000000a5/n1.jpg')||pg_temp.lampp('setoran/f6200000-0000-4000-8000-0000000000a5/n1.jpg'),pg_temp.rev('pK'),pg_temp.kk('m5-6'))$$,'SETORAN_LAMPIRAN_GANDA','M5: berkas yang sama dua kali dalam satu baris ditolak');
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pK'),pg_temp.today()-3,'Operasional',1000,'x',pg_temp.lampp('setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg'),pg_temp.rev('pK'),pg_temp.kk('m5-7'))$$,'SETORAN_LAMPIRAN_PAKAI','M5: berkas yang sudah dipakai baris lain di setoran yang sama ditolak');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pK'),pg_temp.today()-1,1000,'Transfer','f6500000-0000-4000-8000-000000000004',pg_temp.lampp('setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg'),null,pg_temp.rev('pK'),pg_temp.kk('m5-8'))$$,'SETORAN_LAMPIRAN_PAKAI','M5: bukti pengeluaran tidak dapat dipakai ulang sebagai bukti transfer');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pK'),pg_temp.today()-1,1000,'Transfer','f6500000-0000-4000-8000-000000000004',pg_temp.lampp('setoran/f6200000-0000-4000-8000-0000000000a5/rusak.jpg'),null,pg_temp.rev('pK'),pg_temp.kk('m5-9'))$$,'SETORAN_LAMPIRAN_TIDAK_ADA','M5: bukti transfer yang tidak ada di storage ditolak');
select pg_temp.reject($$select public.setoran_tambah_transfer(pg_temp.sid('pK'),pg_temp.today()-1,1000,'Transfer','f6500000-0000-4000-8000-000000000004',pg_temp.lampp('setoran/f6200000-0000-4000-8000-0000000000b1/f3.jpg'),null,pg_temp.rev('pK'),pg_temp.kk('m5-10'))$$,'SETORAN_LAMPIRAN_PATH','M5: bukti transfer dari folder cabang lain ditolak');
-- pakai ulang di setoran lain cabang yang sama
reset role;
select pg_temp.mk('pK2',pg_temp.br('a5'),'04',6);
select pg_temp.as_('04');set local role authenticated;
select pg_temp.reject($$select public.setoran_tambah_pengeluaran(pg_temp.sid('pK2'),pg_temp.today()-6,'Operasional',1000,'x',pg_temp.lampp('setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg'),pg_temp.rev('pK2'),pg_temp.kk('m5-11'))$$,'SETORAN_LAMPIRAN_PAKAI','M5: berkas yang sudah dipakai di SETORAN LAIN (periode lain, cabang sama) ditolak');
-- idempoten: panggilan ulang dengan kunci+isi sama mengembalikan hasil lama (tidak kena PAKAI)
select pg_temp.save('k-e1b',public.setoran_tambah_pengeluaran(pg_temp.sid('pK'),pg_temp.today()-3,'Operasional',10000,'dengan m1',pg_temp.lampp('setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg'),(select (r->>'revision')::int-1 from res where name='k-e1'),pg_temp.kk('k-e1')));
select pg_temp.ok((select (r->>'ulang')::boolean and r->>'baris_id'=(select r->>'baris_id' from res where name='k-e1') from res where name='k-e1b'),'M5: percobaan ulang dengan kunci dan isi sama mengembalikan hasil lama (tanpa galat berkas dipakai)');
-- lepas klaim saat baris dihapus (Draft), lalu pakai lagi
select pg_temp.save('k-del',public.setoran_hapus_pengeluaran(pg_temp.sid('pK'),(select (r->>'baris_id')::uuid from res where name='k-e1'),pg_temp.rev('pK'),pg_temp.kk('k-del')));
reset role;
select pg_temp.ok((select count(*)=0 from setoran_lampiran_pakai where path='setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg'),'M5: klaim dilepas saat baris dihapus selagi Draft');
select pg_temp.ok((select e.data->>'jumlah'='10000.00' or (e.data->>'jumlah')::numeric=10000 from setoran_event e where e.setoran_id=pg_temp.sid('pK') and e.jenis='pengeluaran_dihapus') and (select e.data->'lampiran'->0->>'path'='setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg' from setoran_event e where e.setoran_id=pg_temp.sid('pK') and e.jenis='pengeluaran_dihapus'),'m2: jejak baris yang dihapus menyimpan jumlah dan path berkas');
select pg_temp.ok((select (e.data->>'jumlah')::numeric=10000 and e.data->>'kategori'='Operasional' and e.data->'lampiran'->0->>'path' like '%/m1.jpg' from setoran_event e where e.setoran_id=pg_temp.sid('pK') and e.jenis='pengeluaran_ditambah'),'m2: jejak baris yang ditambah menyimpan jumlah, kategori, path berkas');
select pg_temp.as_('04');set local role authenticated;
select pg_temp.save('k-e2',public.setoran_tambah_pengeluaran(pg_temp.sid('pK'),pg_temp.today()-3,'Operasional',10000,'dengan m1 lagi',pg_temp.lampp('setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg'),pg_temp.rev('pK'),pg_temp.kk('k-e2')));
select pg_temp.ok(pg_temp.ra('04',$$select count(*) from storage.objects where name='setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg'$$)='1','berkas m1 masih ada di storage dan dapat dipakai lagi sesudah dilepas');
-- transfer: klaim dan lepas
select pg_temp.obj('setoran/f6200000-0000-4000-8000-0000000000a5/t1.jpg',pg_temp.u('04')::text);
select pg_temp.save('k-t1',public.setoran_tambah_transfer(pg_temp.sid('pK'),pg_temp.today()-1,100000,'Transfer','f6500000-0000-4000-8000-000000000004',pg_temp.lampp('setoran/f6200000-0000-4000-8000-0000000000a5/t1.jpg'),null,pg_temp.rev('pK'),pg_temp.kk('k-t1')));
reset role;
select pg_temp.ok((select count(*)=1 from setoran_lampiran_pakai where path like '%/t1.jpg' and jenis='transfer' and baris_id=(select (r->>'transfer_id')::uuid from res where name='k-t1')),'M5: bukti transfer diklaim (jenis transfer)');
select pg_temp.as_('04');set local role authenticated;
select pg_temp.save('k-tdel',public.setoran_hapus_transfer(pg_temp.sid('pK'),(select (r->>'transfer_id')::uuid from res where name='k-t1'),pg_temp.rev('pK'),pg_temp.kk('k-tdel')));
reset role;
select pg_temp.ok((select count(*)=0 from setoran_lampiran_pakai where path like '%/t1.jpg') and (select (e.data->>'jumlah')::numeric=100000 and e.data->>'metode'='Transfer' from setoran_event e where e.setoran_id=pg_temp.sid('pK') and e.jenis='transfer_dihapus'),'M5: klaim bukti transfer dilepas saat transfer dihapus; jejak menyimpan jumlah dan metode');
-- klaim beku sesudah diajukan
select pg_temp.pay('pK',290000,'Serah tunai','04','03','k-t2',2);
select pg_temp.sub('pK','04','k-aj');
select pg_temp.reject($$delete from setoran_lampiran_pakai where setoran_id=pg_temp.sid('pK')$$,'SETORAN_BEKU','M5: klaim berkas setoran Diajukan tidak dapat dilepas (trigger)');
select pg_temp.reject($$update setoran_lampiran_pakai set path=path||'x' where setoran_id=pg_temp.sid('pK')$$,'SETORAN_JEJAK','M5: klaim tidak dapat diubah');
select pg_temp.reject($$truncate setoran_lampiran_pakai$$,'SETORAN_JEJAK','M5: klaim tidak dapat di-TRUNCATE');
select pg_temp.reject($$insert into setoran_lampiran_pakai(path,setoran_id,jenis,baris_id,dipakai_oleh) values('setoran/f6200000-0000-4000-8000-0000000000a5/m1.jpg',pg_temp.sid('pK2'),'pengeluaran',gen_random_uuid(),pg_temp.u('04'))$$,'duplicate key','M5: path klaim unik di tingkat database (PK)');
select pg_temp.reject($$insert into setoran_lampiran_pakai(path,setoran_id,jenis,baris_id,dipakai_oleh) values('x',pg_temp.sid('pK2'),'lain',gen_random_uuid(),pg_temp.u('04'))$$,'check constraint','M5: jenis klaim dibatasi pengeluaran/transfer');
select pg_temp.ok(pg_temp.dml('04',$$delete from setoran_lampiran_pakai$$) like 'ERR:permission denied%' and pg_temp.dml('04',$$select 1 from setoran_lampiran_pakai$$) like 'ERR:permission denied%','M5: klien tidak dapat membaca atau mengubah tabel klaim');
select pg_temp.ok((select count(*)=2 from setoran_lampiran_pakai where setoran_id=pg_temp.sid('pK')) or (select count(*)=1 from setoran_lampiran_pakai where setoran_id=pg_temp.sid('pK')),'klaim berkas setoran K tercatat');
-- layar penyetuju: pengeluaran mirip kasir + kembar
select pg_temp.save('sL1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('a6'),'04',3,0,300000)));
insert into expenses(branch_id,tanggal,kategori,deskripsi,jumlah,metode_bayar,shift_id,created_by) values(pg_temp.br('a6'),pg_temp.today()-3,'Operasional','galon dari kasir',25000,'Tunai',pg_temp.sid('sL1'),pg_temp.u('04'));
select pg_temp.mk('pL',pg_temp.br('a6'),'04');
select pg_temp.exps('pL','04',3,'Operasional',25000,'l-e1');select pg_temp.exps('pL','04',3,'Operasional',25000,'l-e2');select pg_temp.exps('pL','04',3,'Transportasi',7000,'l-e3');
select pg_temp.pay('pL',243000,'Serah tunai','04','03','l-t1',2);
select pg_temp.sub('pL','04','l-aj');
select pg_temp.as_('01');set local role authenticated;
select pg_temp.save('dL-app',public.setoran_detail(pg_temp.sid('pL')));
select pg_temp.as_('04');
select pg_temp.save('dL-staf',public.setoran_detail(pg_temp.sid('pL')));
reset role;
select pg_temp.ok((select exists(select 1 from jsonb_array_elements(r->'keuangan'->'peringatan') w where w->>'kode'='PENGELUARAN_MIRIP_KASIR' and (w->>'jumlah')::int=2 and w->>'tingkat'='peringatan') from res where name='dL-app'),'M5: penyetuju melihat peringatan PENGELUARAN_MIRIP_KASIR (2 baris sama dengan pengeluaran kasir)');
select pg_temp.ok((select exists(select 1 from jsonb_array_elements(r->'keuangan'->'peringatan') w where w->>'kode'='PENGELUARAN_KEMBAR' and (w->>'jumlah')::int=1) from res where name='dL-app') and (select not exists(select 1 from jsonb_array_elements(r->'keuangan'->'peringatan') w where w->>'kode' in('PENGELUARAN_MELEBIHI','TANPA_SHIFT','PEMISAHAN_TUGAS')) from res where name='dL-app'),'M5: peringatan PENGELUARAN_KEMBAR (1 kelompok); tidak ada peringatan lain yang keliru');
select pg_temp.ok((select not r ?| array['peringatan','keuangan'] from res where name='dL-staf'),'M5: staf tidak melihat peringatan duplikat');

-- ── 6. M4: pemisahan tugas penyetuju ─────────────────────────────────────────────────────────────
-- M: Finance 0c menginput baris pengeluaran. N: Admin 02 mencatat transfer. O: Admin 02 membuka shift. P: Finance 0c membuka shift (snapshot karyawan = 0c).
select pg_temp.save('sM1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('c1'),'04',3,0,400000)));
select pg_temp.save('sN1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('c2'),'04',3,0,400000)));
select pg_temp.save('sO1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('c3'),'02',3,0,400000)));
select pg_temp.save('sP1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('c4'),'0c',3,0,400000)));
select pg_temp.mk('pM',pg_temp.br('c1'),'04');select pg_temp.mk('pN',pg_temp.br('c2'),'04');select pg_temp.mk('pO',pg_temp.br('c3'),'04');select pg_temp.mk('pP',pg_temp.br('c4'),'04');
select pg_temp.exps('pM','0c',3,'Operasional',40000,'m-e1');
select pg_temp.pay('pM',360000,'Serah tunai','04','03','m-t1',2);
select pg_temp.pay('pN',400000,'Serah tunai','02','03','n-t1',2);
select pg_temp.pay('pO',400000,'Serah tunai','04','03','o-t1',2);
select pg_temp.pay('pP',400000,'Serah tunai','04','03','p-t1',2);
select pg_temp.sub('pM','04','m-aj');select pg_temp.sub('pN','04','n-aj');select pg_temp.sub('pO','04','o-aj');select pg_temp.sub('pP','04','p-aj');
select pg_temp.ok((select count(*)=4 from setoran where id in(pg_temp.sid('pM'),pg_temp.sid('pN'),pg_temp.sid('pO'),pg_temp.sid('pP')) and status='Diajukan'),'M4: empat setoran Diajukan siap diuji');
select pg_temp.ok(pg_temp.ra('0c',$$select public.setoran_setujui(pg_temp.sid('pM'),pg_temp.kk('m4-m1'),null,null,false,false,'ok')::text$$) like 'ERR:SETORAN_PEMISAHAN_TUGAS%menginput baris pengeluaran%','M4: Finance yang menginput baris pengeluaran tidak boleh menyetujui setoran itu');
select pg_temp.ok(pg_temp.ra('02',$$select public.setoran_setujui(pg_temp.sid('pN'),pg_temp.kk('m4-n1'),null,null,false,false,'ok')::text$$) like 'ERR:SETORAN_PEMISAHAN_TUGAS%mencatat transfer%','M4: Admin yang mencatat transfer/serah tunai tidak boleh menyetujui setoran itu');
select pg_temp.ok(pg_temp.ra('02',$$select public.setoran_setujui(pg_temp.sid('pO'),pg_temp.kk('m4-o1'),null,null,false,false,'ok')::text$$) like 'ERR:SETORAN_PEMISAHAN_TUGAS%membuka atau memegang shift%','M4: Admin yang membuka shift yang masuk hitungan tidak boleh menyetujui setoran itu');
select pg_temp.ok(pg_temp.ra('0c',$$select public.setoran_setujui(pg_temp.sid('pP'),pg_temp.kk('m4-p1'),null,null,false,false,'ok')::text$$) like 'ERR:SETORAN_PEMISAHAN_TUGAS%membuka atau memegang shift%','M4: Finance yang membuka shift yang masuk hitungan tidak boleh menyetujui');
select pg_temp.ok((select count(*)=0 from journal_entries where source='setoran' and source_ref in(pg_temp.sid('pM')::text,pg_temp.sid('pN')::text,pg_temp.sid('pO')::text,pg_temp.sid('pP')::text)) and (select count(*)=4 from setoran where id in(pg_temp.sid('pM'),pg_temp.sid('pN'),pg_temp.sid('pO'),pg_temp.sid('pP')) and status='Diajukan'),'M4: penolakan atomik (status tetap Diajukan, tanpa jurnal)');
-- layar penyetuju: peringatan untuk yang berkonflik, tidak untuk yang lain
select pg_temp.as_('0c');set local role authenticated;
select pg_temp.save('dM-0c',public.setoran_detail(pg_temp.sid('pM')));
select pg_temp.save('dP-0c',public.setoran_detail(pg_temp.sid('pP')));
select pg_temp.as_('03');
select pg_temp.save('dM-03',public.setoran_detail(pg_temp.sid('pM')));
select pg_temp.as_('02');
select pg_temp.save('dN-02',public.setoran_detail(pg_temp.sid('pN')));
select pg_temp.save('dO-02',public.setoran_detail(pg_temp.sid('pO')));
select pg_temp.as_('01');
select pg_temp.save('dN-01',public.setoran_detail(pg_temp.sid('pN')));
reset role;
select pg_temp.ok((select exists(select 1 from jsonb_array_elements(r->'keuangan'->'peringatan') w where w->>'kode'='PEMISAHAN_TUGAS' and w->>'tingkat'='blokir' and w->>'pesan' like '%menginput baris pengeluaran%') from res where name='dM-0c'),'M4: layar Finance 0c: peringatan PEMISAHAN_TUGAS (blokir) menyebut alasannya');
select pg_temp.ok((select exists(select 1 from jsonb_array_elements(r->'keuangan'->'peringatan') w where w->>'kode'='PEMISAHAN_TUGAS' and w->>'pesan' like '%shift%') from res where name='dP-0c') and (select exists(select 1 from jsonb_array_elements(r->'keuangan'->'peringatan') w where w->>'kode'='PEMISAHAN_TUGAS' and w->>'pesan' like '%transfer%') from res where name='dN-02') and (select exists(select 1 from jsonb_array_elements(r->'keuangan'->'peringatan') w where w->>'kode'='PEMISAHAN_TUGAS' and w->>'pesan' like '%shift%') from res where name='dO-02'),'M4: peringatan PEMISAHAN_TUGAS muncul untuk konflik shift (P, O) dan transfer (N)');
select pg_temp.ok((select not exists(select 1 from jsonb_array_elements(r->'keuangan'->'peringatan') w where w->>'kode'='PEMISAHAN_TUGAS') from res where name='dM-03') and (select not exists(select 1 from jsonb_array_elements(r->'keuangan'->'peringatan') w where w->>'kode'='PEMISAHAN_TUGAS') from res where name='dN-01'),'M4: penyetuju yang tidak terlibat (03 untuk M, 01 untuk N) tidak mendapat peringatan');
-- penyetuju yang tidak terlibat berhasil
select pg_temp.appr('pM','03','m4-m2');
select pg_temp.appr('pN','01','m4-n2');
select pg_temp.appr('pO','03','m4-o2');
select pg_temp.appr('pP','03','m4-p2');
select pg_temp.ok((select count(*)=4 from setoran where id in(pg_temp.sid('pM'),pg_temp.sid('pN'),pg_temp.sid('pO'),pg_temp.sid('pP')) and status='Disetujui'),'M4: penyetuju yang tidak terlibat dapat menyetujui keempatnya');
select pg_temp.ok((select count(*)=1 and bool_and(created_by=pg_temp.u('03')) from expenses where deskripsi like 'Setoran '||(select no_setoran from setoran where id=pg_temp.sid('pM'))||'%'),'M4: pengeluaran M dibukukan atas nama penyetuju yang sah (03)');
-- pembuat/pengaju tetap dilarang (aturan lama) dan tolak oleh orang berkonflik tidak diblok oleh pemisahan tugas setujui
select pg_temp.mk('pQ',pg_temp.br('c1'),'0c',9);
select pg_temp.ok((select created_by=pg_temp.u('0c') from setoran where id=pg_temp.sid('pQ')),'pembuat setoran Q = Finance 0c (aturan lama pembuat/pengaju tetap berlaku)');

-- ── 7. M6: shift tertutup tidak dapat diubah angka uangnya ────────────────────────────────────────
select pg_temp.save('sZ1',jsonb_build_object('id',pg_temp.mk_shift(pg_temp.br('b1'),'07',20,100000,900000)));
select pg_temp.ok(pg_temp.dml('08',format($$update cashier_shifts set closing_balance=1 where id=%L$$,pg_temp.sid('sZ1'))) like 'ERR:SHIFT_TUTUP_UANG_BEKU%','M6: STAFF tidak dapat mengubah closing_balance shift petshop yang sudah ditutup');
select pg_temp.ok(pg_temp.dml('08',format($$update cashier_shifts set status='open' where id=%L$$,pg_temp.sid('sZ1'))) like 'ERR:SHIFT_TUTUP_UANG_BEKU%','M6: shift tertutup tidak dapat dibuka kembali');
select pg_temp.ok(pg_temp.dml('08',format($$update cashier_shifts set %s where id=%L$$,c,pg_temp.sid('sZ1'))) like 'ERR:SHIFT\_%','M6: kolom '||split_part(c,'=',1)||' shift tertutup beku')
 from unnest(array['expected_cash=1','selisih=5','closing_breakdown=''{"Tunai":1}''::jsonb','closed_at=now()','opening_balance=5','opened_at=now()','shift_type=''klinik''',format('branch_id=%L',pg_temp.br('0a')),format('opened_by=%L',pg_temp.u('04'))]) c;
select pg_temp.ok(pg_temp.dml('08',format($$update cashier_shifts set employee_id=employee_id where id=%L$$,pg_temp.sid('sZ1')))='1','M6: pembaruan tanpa perubahan kolom uang tetap diizinkan (UPDATE no-op)');
-- shift terbuka: jalur tutup yang sah (seperti tutupShift) tetap jalan, lalu beku
reset role;
select pg_temp.noauth();
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance,opened_at,status) values('f6400000-0000-4000-8000-0000000000e1',pg_temp.br('b1'),pg_temp.u('07'),'petshop',50000,now()-interval '3 hours','open');
select pg_temp.ok(pg_temp.dml('07',$$update cashier_shifts set closing_balance=150000,expected_cash=150000,selisih=0,closing_breakdown='{"Tunai":100000}'::jsonb,closed_at=now(),status='closed' where id='f6400000-0000-4000-8000-0000000000e1' and status='open'$$)='1','M6: shift TERBUKA dapat ditutup lewat klien (alur tutup shift petshop tidak terganggu)');
select pg_temp.ok(pg_temp.dml('07',$$update cashier_shifts set opening_balance=1 where id='f6400000-0000-4000-8000-0000000000e1' and status='open'$$)='1','M6: shift terbuka lain-lain tetap dapat diubah (modal awal sebelum tutup; perilaku lama)');
update cashier_shifts set status='open',closing_balance=null,expected_cash=null,selisih=null,closing_breakdown=null,closed_at=null where id='f6400000-0000-4000-8000-0000000000e1';
update cashier_shifts set status='closed',closing_balance=150000,expected_cash=150000,selisih=0,closing_breakdown='{"Tunai":100000}'::jsonb,closed_at=now() where id='f6400000-0000-4000-8000-0000000000e1';
select pg_temp.ok((select closing_balance=150000 and status='closed' from cashier_shifts where id='f6400000-0000-4000-8000-0000000000e1'),'M6: jalur sistem/SECURITY DEFINER (pemilik tabel) tetap dapat mengubah shift (supervisor/perbaikan data tidak terhalang)');
select pg_temp.ok(pg_temp.dml('0b',format($$update cashier_shifts set closing_balance=5 where id=%L$$,pg_temp.sid('sK1'))) like 'ERR:%','M6: shift tertutup dilindungi untuk akun lain juga (DOCTOR: ditolak)');
select pg_temp.ok(pg_temp.dml('01',format($$update cashier_shifts set closing_balance=closing_balance+1 where id=%L$$,pg_temp.sid('sZ1'))) like 'ERR:SHIFT_TUTUP_UANG_BEKU%','M6: bahkan OWNER lewat klien tidak dapat mengubah uang shift tertutup (jalur koreksi harus lewat fungsi/migrasi)');
-- aliran setoran tetap utuh: kewajiban tidak berubah setelah upaya ubah
select pg_temp.ok((select shift_net=400000 from setoran_keuangan where setoran_id=pg_temp.sid('pM')),'kewajiban snapshot setoran M tetap 400.000');

-- ── 8. fence_all / guard_all idempoten, keseluruhan ───────────────────────────────────────────────
select pg_temp.ok(admin_online_private.guard_all()=0,'guard_all() sesudah semua uji: 0 fungsi perlu penjaga');
select admin_online_private.fence_all();
select pg_temp.ok(exists(select 1 from pg_policy where polrelid='public.setoran_lampiran_pakai'::regclass and polname='admin_online_fence_r'),'fence_all() dua kali: pagar tabel klaim tetap');
select pg_temp.ok((select count(*) from pg_policy where polrelid='public.setoran_lampiran_pakai'::regclass)=1,'tabel klaim hanya punya satu kebijakan (pagar Admin Online); tanpa kebijakan permisif untuk klien');
select pg_temp.ok(pg_temp.as_('06') is not null and pg_temp.ra('06',$$select public.setoran_detail(pg_temp.sid('pA'))::text$$) like 'ERR:%ADMIN_ONLINE%','Admin Online tetap ditolak di RPC setoran (setoran_detail)');
select pg_temp.ok(pg_temp.ra('06',$$select public.ledger_account_totals(null,null,null)::text$$) like 'ERR:%ADMIN_ONLINE%','Admin Online tetap ditolak di ledger_account_totals');
select pg_temp.ok(pg_temp.ra('0b',$$select public.setoran_detail(pg_temp.sid('pA'))::text$$) like 'ERR:%','DOCTOR tetap ditolak di setoran_detail');
select pg_temp.ok(pg_temp.ra('0b',$$select jsonb_array_length(public.ledger_account_lines(null,null,null,array[(select id from coa_accounts where code='182001')]))::text$$)='0','DOCTOR: mutasi akun 182001 kosong');
