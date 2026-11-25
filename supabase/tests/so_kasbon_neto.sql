-- SO-KASBON-NETO (migrasi *_so_kasbon_neto): fictional fixtures in disposable PostgreSQL only; everything rolls back.
-- Aturan yang dibuktikan: beban ke karyawan per DOKUMEN opname = max(sum(kurang x harga jual) - sum(lebih x harga jual), 0);
-- pembagian ke karyawan tak berubah; jurnal Dr 182001 / Cr 720010 (<= beban 720010 yang tersisa pada jurnal opname) / Cr 810004 sisanya;
-- lebih menutup kurang -> ditolak; hanya-kurang identik dengan perilaku lama; ACL/DEFINER/search_path; jejak bukti neto; pembatalan.
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
create function pg_temp.as_(uid text) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',uid,true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);end$$;
create function pg_temp.today() returns date language sql as $$select (now() at time zone 'Asia/Jakarta')::date$$;
create function pg_temp.n(j jsonb,k text) returns numeric language sql as $$select coalesce((j->>k)::numeric,0)$$;

-- ── fixtures ────────────────────────────────────────────────────────────────────────────────
insert into auth.users(id,raw_user_meta_data) values
 ('5b100000-0000-4000-8000-000000000001','{"full_name":"KN owner"}'),('5b100000-0000-4000-8000-000000000002','{"full_name":"KN admin"}'),
 ('5b100000-0000-4000-8000-000000000003','{"full_name":"KN finance"}'),('5b100000-0000-4000-8000-000000000004','{"full_name":"KN staf"}'),
 ('5b100000-0000-4000-8000-000000000005','{"full_name":"KN admin online"}');
update profiles set role='OWNER',is_active=true where id='5b100000-0000-4000-8000-000000000001';
update profiles set role='ADMIN',is_active=true where id='5b100000-0000-4000-8000-000000000002';
update profiles set role='FINANCE',is_active=true where id='5b100000-0000-4000-8000-000000000003';
update profiles set role='STAFF',is_active=true where id='5b100000-0000-4000-8000-000000000004';
update profiles set role='ADMIN_ONLINE',is_active=true where id='5b100000-0000-4000-8000-000000000005';
insert into role_capabilities(role,all_branches,create_accounts) values('ADMIN',false,false),('FINANCE',false,false) on conflict(role) do update set all_branches=false;
insert into role_modules(role,module_id) values('STAFF','pos'),('ADMIN','pos'),('FINANCE','pos') on conflict do nothing;
insert into branches(id,code,name,type) values('5b200000-0000-4000-8000-000000000001','KNA','KN klinik A','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('5b300000-0000-4000-8000-000000000001','5b200000-0000-4000-8000-000000000001','KNWA','KN gudang A','VET');
insert into user_branches(user_id,branch_id) values('5b100000-0000-4000-8000-000000000002','5b200000-0000-4000-8000-000000000001'),('5b100000-0000-4000-8000-000000000003','5b200000-0000-4000-8000-000000000001'),
 ('5b100000-0000-4000-8000-000000000004','5b200000-0000-4000-8000-000000000001'),('5b100000-0000-4000-8000-000000000005','5b200000-0000-4000-8000-000000000001');
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active) values('170001','Persediaan fiktif','ASET','D',false,true),('720010','Beban selisih stok fiktif','BEBAN','D',false,true),
 ('810004','Pendapatan lain-lain fiktif','PENDAPATAN','K',false,true),('182001','Kasbon karyawan fiktif','ASET','D',false,true) on conflict(code) do update set is_active=true,is_header=false;
update accounting_locks set closed_until=null;
insert into public.employees(id,nama,status,branch_id) values('5b400000-0000-4000-8000-000000000001','Karyawan KN satu','Aktif','5b200000-0000-4000-8000-000000000001'),
 ('5b400000-0000-4000-8000-000000000002','Karyawan KN dua','Aktif','5b200000-0000-4000-8000-000000000001'),('5b400000-0000-4000-8000-000000000003','Karyawan KN tiga','Aktif','5b200000-0000-4000-8000-000000000001'),
 ('5b400000-0000-4000-8000-000000000004','Karyawan KN empat nonaktif','Nonaktif','5b200000-0000-4000-8000-000000000001');

create temp table it(code text primary key,id uuid);grant all on it to public;
create temp table res(name text primary key,r jsonb);grant all on res to public;
create temp table seq(n int);insert into seq values(0);grant all on seq to public;
create function pg_temp.iid(c text) returns uuid language sql as $$select id from it where code=c$$;
create function pg_temp.mk(c text,sell numeric,buy numeric default 0) returns void language plpgsql as $$begin
 insert into it values(c,gen_random_uuid());
 insert into public.items(id,code,name,unit,item_type,buy_price,sell_price) values(pg_temp.iid(c),'KN-'||c,'Barang '||c,'PCS','Persediaan',buy,sell);end$$;
create function pg_temp.lay(c text,qty numeric,cost numeric) returns void language plpgsql as $$begin
 update seq set n=n+1;
 perform public.stock_in_fifo(pg_temp.wa(),pg_temp.iid(c),qty,cost,'fixture','FX-'||c||'-'||(select n from seq),pg_temp.today()-5,null);end$$;
create function pg_temp.wa() returns uuid language sql as $$select '5b300000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.owner() returns text language sql as $$select '5b100000-0000-4000-8000-000000000001'$$;
create function pg_temp.e(i int) returns uuid language sql as $$select ('5b400000-0000-4000-8000-00000000000'||i)::uuid$$;
create function pg_temp.post(label text,counts jsonb) returns jsonb language plpgsql as $$
declare o uuid:=gen_random_uuid();r jsonb;begin
 insert into public.opname_orders(id,no_opname,warehouse_id,penanggung_jawab) values(o,'OPO.KN.'||label,pg_temp.wa(),'Penghitung fiktif');
 perform pg_temp.as_(pg_temp.owner());
 r:=public.post_opname_atomic(o,pg_temp.today(),(select coalesce(jsonb_object_agg(pg_temp.iid(k)::text,v),'{}'::jsonb) from jsonb_each(counts) e(k,v)));
 insert into res values(label,r||jsonb_build_object('order_id',o)) on conflict(name) do update set r=excluded.r;return r;end$$;
create function pg_temp.rid(label text) returns uuid language sql as $$select (r->>'result_id')::uuid from res where name=label$$;
create function pg_temp.ref(label text) returns text language sql as $$select r->>'no_hasil' from res where name=label$$;
create function pg_temp.basis(label text) returns jsonb language sql as $$select public.opname_variance_charge_basis(pg_temp.rid(label))$$;
create function pg_temp.gl(src text,ref text) returns jsonb language sql as $$
 select coalesce(jsonb_object_agg(code,net),'{}') from (select a.code,sum(l.debit-l.credit) net from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
  join public.journal_entries e on e.id=l.entry_id where e.source=src and e.source_ref=ref group by a.code) x$$;
create function pg_temp.jcount(src text,ref text) returns int language sql as $$select count(*)::int from public.journal_entries where source=src and source_ref=ref$$;
-- semua jurnal terkait satu dokumen (SO + beban + batal): saldo bersih akun
create function pg_temp.glall(ref text) returns jsonb language sql as $$
 select coalesce(jsonb_object_agg(code,net),'{}') from (select a.code,sum(l.debit-l.credit) net from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
  join public.journal_entries e on e.id=l.entry_id where e.source in('opname','opname-beban-karyawan','opname-beban-batal') and e.source_ref=ref group by a.code) x$$;
-- beban: bagi total ke karyawan 1..k menurut daftar jumlah
create function pg_temp.lines(a1 numeric,a2 numeric default null,a3 numeric default null) returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('employee_id',pg_temp.e(i),'amount',a)) from (values(1,a1),(2,a2),(3,a3)) v(i,a) where a is not null$$;
create function pg_temp.charge(label text,lines jsonb,key uuid default gen_random_uuid(),uid text default null) returns jsonb language plpgsql as $$
declare r jsonb;begin
 perform pg_temp.as_(coalesce(uid,pg_temp.owner()));
 r:=public.charge_opname_variance_to_employees(pg_temp.rid(label),lines,'Selisih stok KN uji',key);
 insert into res values(label||'.ch',r) on conflict(name) do update set r=excluded.r;return r;end$$;
create function pg_temp.chs(label text,lines jsonb,uid text default null) returns text language plpgsql as $$
begin return pg_temp.charge(label,lines,gen_random_uuid(),uid)::text;end$$;

create function pg_temp.g(ref text,code text) returns numeric language sql as $$select coalesce((pg_temp.glall(ref)->>code)::numeric,0)$$;
create function pg_temp.gs(src text,ref text,code text) returns numeric language sql as $$select coalesce((pg_temp.gl(src,ref)->>code)::numeric,0)$$;
create function pg_temp.has(src text,ref text,code text) returns boolean language sql as $$select pg_temp.gl(src,ref) ? code$$;
create function pg_temp.advsum(label text) returns numeric language sql as $$
 select coalesce(sum(a.jumlah),0) from public.cash_advances a where a.id in (select unnest(advance_ids) from public.opname_variance_charges where result_id=pg_temp.rid(label) and cancelled_at is null)$$;
create function pg_temp.chrow(label text) returns public.opname_variance_charges language sql as $$
 select c from public.opname_variance_charges c where c.result_id=pg_temp.rid(label) order by created_at desc limit 1$$;

-- ═════════ S1 hanya kurang: perilaku lama tidak berubah ═════════
select pg_temp.mk('a1',150);select pg_temp.lay('a1',10,100);
select pg_temp.ok(pg_temp.post('s1','{"a1":0}') ? 'no_hasil','S1 SO hanya-kurang diposting (10 x HPP 100, harga jual 150)');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s1'),'jual_kurang')=1500 and pg_temp.n(pg_temp.basis('s1'),'jual_lebih')=0 and pg_temp.n(pg_temp.basis('s1'),'jual_total')=1500,'S1 dasar: kurang 1.500, lebih 0, nilai beban 1.500');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s1'),'hpp_total')=1000 and pg_temp.n(pg_temp.basis('s1'),'hpp_neto')=1000 and pg_temp.n(pg_temp.basis('s1'),'hpp_part')=1000 and pg_temp.n(pg_temp.basis('s1'),'gain_part')=500,'S1 dasar: HPP 1.000 (neto 1.000), bagian HPP 1.000, bagian pendapatan lain 500');
select pg_temp.ok(pg_temp.basis('s1')->'refuse'='null'::jsonb and (pg_temp.basis('s1')->>'plus_count')::int=0 and (pg_temp.basis('s1')->>'minus_count')::int=1 and jsonb_array_length(pg_temp.basis('s1')->'plus_lines')=0,'S1 dasar: tidak ditolak, tanpa baris lebih');
select pg_temp.ok((pg_temp.basis('s1')->'minus_lines'->0->>'qty')::numeric=10 and (pg_temp.basis('s1')->'minus_lines'->0->>'jual')::numeric=1500 and (pg_temp.basis('s1')->'minus_lines'->0->>'harga_jual')::numeric=150,'S1 baris kurang: qty 10, harga jual 150, nilai 1.500');
select pg_temp.ok((pg_temp.charge('s1',pg_temp.lines(900,600))->>'total')::numeric=1500,'S1 beban 1.500 dibagi 900 + 600 diterima');
select pg_temp.ok(pg_temp.gs('opname-beban-karyawan',pg_temp.ref('s1'),'182001')=1500 and pg_temp.gs('opname-beban-karyawan',pg_temp.ref('s1'),'720010')=-1000 and pg_temp.gs('opname-beban-karyawan',pg_temp.ref('s1'),'810004')=-500,'S1 jurnal beban: Dr 182001 1.500 / Cr 720010 1.000 / Cr 810004 500 (sama dengan perilaku lama)');
select pg_temp.ok(pg_temp.g(pg_temp.ref('s1'),'720010')=0 and pg_temp.g(pg_temp.ref('s1'),'810004')=-500,'S1 saldo bersih sesudah SO + beban: 720010 0, 810004 -500');
select pg_temp.ok((pg_temp.chrow('s1')).jual_kurang=1500 and (pg_temp.chrow('s1')).jual_lebih=0 and (pg_temp.chrow('s1')).total=1500 and (pg_temp.chrow('s1')).hpp_total=1000 and (pg_temp.chrow('s1')).hpp_part=1000 and (pg_temp.chrow('s1')).gain_part=500,'S1 jejak: kurang 1.500, lebih 0, total 1.500, HPP 1.000/1.000, pendapatan lain 500');
select pg_temp.ok(position('neto' in (select deskripsi from public.journal_entries where source='opname-beban-karyawan' and source_ref=pg_temp.ref('s1')))=0,'S1 deskripsi jurnal beban tanpa kata neto (tanpa lebih)');
select pg_temp.ok(pg_temp.advsum('s1')=1500 and (select count(*) from public.cash_advances where id=any((pg_temp.chrow('s1')).advance_ids) and status='Dicatat')=2,'S1 dua kasbon status Dicatat berjumlah 1.500');

-- ═════════ S2 contoh review: kurang 10 x (HPP 100, jual 150), lebih 1 x (HPP 100, jual 150) ═════════
select pg_temp.mk('s2',150);select pg_temp.lay('s2',10,100);select pg_temp.mk('g2',150);select pg_temp.lay('g2',5,100);
select pg_temp.ok(pg_temp.post('s2','{"s2":0,"g2":6}') ? 'no_hasil','S2 SO campuran diposting (kurang 10, lebih 1)');
select pg_temp.ok(pg_temp.gs('opname',pg_temp.ref('s2'),'720010')=900 and pg_temp.gs('opname',pg_temp.ref('s2'),'810004')=0 and pg_temp.jcount('opname',pg_temp.ref('s2'))=1,'S2 SO: satu jurnal neto, beban 720010 900, tanpa 810004');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s2'),'jual_kurang')=1500 and pg_temp.n(pg_temp.basis('s2'),'jual_lebih')=150 and pg_temp.n(pg_temp.basis('s2'),'jual_total')=1350,'S2 dasar: kurang 1.500 - lebih 150 = nilai beban 1.350 (bukan 1.500)');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s2'),'hpp_total')=1000 and pg_temp.n(pg_temp.basis('s2'),'hpp_lebih')=100 and pg_temp.n(pg_temp.basis('s2'),'hpp_neto')=900,'S2 dasar: HPP kurang 1.000, HPP lebih 100, beban HPP tersisa di buku 900');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s2'),'hpp_part')=900 and pg_temp.n(pg_temp.basis('s2'),'gain_part')=450,'S2 dasar: bagian HPP 900 (maks. beban yang tersisa), sisa 450 pendapatan lain');
select pg_temp.ok((pg_temp.basis('s2')->>'plus_count')::int=1 and (pg_temp.basis('s2')->'plus_lines'->0->>'qty')::numeric=1 and (pg_temp.basis('s2')->'plus_lines'->0->>'jual')::numeric=150 and (pg_temp.basis('s2')->'plus_lines'->0->>'hpp')::numeric=100 and (pg_temp.basis('s2')->'plus_lines'->0->>'harga_jual')::numeric=150 and pg_temp.basis('s2')->'plus_lines'->0->>'name'='Barang g2','S2 baris lebih: qty 1, jual 150, HPP 100, harga jual 150, nama barang');
select pg_temp.ok((pg_temp.basis('s2')->'minus_lines'->0->>'jual')::numeric=1500 and (pg_temp.basis('s2')->>'minus_count')::int=1 and pg_temp.basis('s2')->'refuse'='null'::jsonb,'S2 baris kurang tetap kotor 1.500; tidak ditolak');
select pg_temp.reject('select pg_temp.chs(''s2'',pg_temp.lines(900,600))','BEBAN_KARYAWAN_TOTAL','S2 pembagian sebesar nilai kotor 1.500 ditolak (harus 1.350)');
select pg_temp.reject('select pg_temp.chs(''s2'',pg_temp.lines(900,300))','BEBAN_KARYAWAN_TOTAL','S2 pembagian 1.200 ditolak');
select pg_temp.ok(not exists(select 1 from public.opname_variance_charges where result_id=pg_temp.rid('s2')) and pg_temp.jcount('opname-beban-karyawan',pg_temp.ref('s2'))=0,'S2 penolakan tidak meninggalkan jejak/jurnal');
select pg_temp.ok((pg_temp.charge('s2',pg_temp.lines(800,550))->>'total')::numeric=1350,'S2 beban 1.350 dibagi 800 + 550 diterima (aturan bagi tetap)');
select pg_temp.ok(pg_temp.gs('opname-beban-karyawan',pg_temp.ref('s2'),'182001')=1350 and pg_temp.gs('opname-beban-karyawan',pg_temp.ref('s2'),'720010')=-900 and pg_temp.gs('opname-beban-karyawan',pg_temp.ref('s2'),'810004')=-450,'S2 jurnal beban: Dr 182001 1.350 / Cr 720010 900 / Cr 810004 450');
select pg_temp.ok(pg_temp.g(pg_temp.ref('s2'),'720010')=0,'S2 beban 720010 sesudah SO + beban = 0 (dulu -100: saldo kredit)');
select pg_temp.ok(pg_temp.g(pg_temp.ref('s2'),'810004')=-450 and pg_temp.g(pg_temp.ref('s2'),'182001')=1350 and pg_temp.g(pg_temp.ref('s2'),'170001')=-900,'S2 saldo akhir: 810004 -450, kasbon 1.350, persediaan -900');
select pg_temp.ok(pg_temp.advsum('s2')=1350 and (select count(*) from public.cash_advances where id=any((pg_temp.chrow('s2')).advance_ids))=2,'S2 kasbon karyawan berjumlah 1.350 (bukan 1.500)');
select pg_temp.ok((pg_temp.chrow('s2')).jual_kurang=1500 and (pg_temp.chrow('s2')).jual_lebih=150 and (pg_temp.chrow('s2')).total=1350 and (pg_temp.chrow('s2')).hpp_total=1000 and (pg_temp.chrow('s2')).hpp_part=900 and (pg_temp.chrow('s2')).gain_part=450,'S2 jejak: kurang 1.500, lebih 150, total 1.350, HPP kurang 1.000, bagian HPP 900, pendapatan lain 450');
select pg_temp.ok((select deskripsi from public.journal_entries where source='opname-beban-karyawan' and source_ref=pg_temp.ref('s2')) like '%— neto: kurang Rp 1500 − lebih Rp 150%','S2 deskripsi jurnal menyebut neto: kurang Rp 1500 − lebih Rp 150');
select pg_temp.ok(pg_temp.basis('s2')->'refuse'->>'code'='SUDAH','S2 sesudah dicatat: dasar menolak SUDAH (satu beban aktif per opname)');
select pg_temp.reject('select pg_temp.chs(''s2'',pg_temp.lines(1350))','BEBAN_KARYAWAN_SUDAH','S2 beban kedua pada opname yang sama ditolak');
do $$begin perform pg_temp.as_(pg_temp.owner());insert into res values('s2.read',public.read_opname_variance_charge(pg_temp.rid('s2')));end$$;
select pg_temp.ok((select r->'charges'->0->>'jual_kurang' from res where name='s2.read')::numeric=1500 and (select r->'charges'->0->>'jual_lebih' from res where name='s2.read')::numeric=150 and (select r->'charges'->0->>'total' from res where name='s2.read')::numeric=1350,'S2 ringkasan baca: riwayat beban memuat jual_kurang 1.500, jual_lebih 150, total 1.350');
select pg_temp.ok((select (r->>'jual_total')::numeric=1350 and (r->>'can_charge')::boolean and jsonb_array_length(r->'plus_lines')=1 and (r->>'hpp_neto')::numeric=900 from res where name='s2.read'),'S2 ringkasan baca: nilai neto 1.350, bisa mencatat, 1 baris lebih, HPP neto 900');
-- pembatalan: jurnal pembalik persis, kasbon Batal, lalu boleh dicatat ulang
do $$begin perform pg_temp.as_(pg_temp.owner());
 insert into res values('s2.cancel',public.cancel_opname_variance_charge((pg_temp.chrow('s2')).id,'Salah hitung uji',gen_random_uuid()));end$$;
select pg_temp.ok(pg_temp.gs('opname-beban-batal',pg_temp.ref('s2'),'182001')=-1350 and pg_temp.gs('opname-beban-batal',pg_temp.ref('s2'),'720010')=900 and pg_temp.gs('opname-beban-batal',pg_temp.ref('s2'),'810004')=450,'S2 pembatalan: jurnal pembalik persis (182001 -1.350, 720010 +900, 810004 +450)');
select pg_temp.ok(pg_temp.g(pg_temp.ref('s2'),'720010')=900 and pg_temp.g(pg_temp.ref('s2'),'810004')=0 and pg_temp.g(pg_temp.ref('s2'),'182001')=0,'S2 sesudah batal: saldo kembali ke keadaan SO neto (720010 900, 810004 0, kasbon 0)');
select pg_temp.ok((select count(*) from public.cash_advances where id=any((pg_temp.chrow('s2')).advance_ids) and status='Batal')=2,'S2 kedua kasbon berstatus Batal');
select pg_temp.ok(pg_temp.basis('s2')->'refuse'='null'::jsonb and pg_temp.n(pg_temp.basis('s2'),'jual_total')=1350,'S2 sesudah batal: dasar neto 1.350 bisa dicatat ulang');
select pg_temp.charge('s2',pg_temp.lines(1350));
select pg_temp.ok((select (r->>'total')::numeric from res where name='s2.ch')=1350 and (select count(*) from public.opname_variance_charges where result_id=pg_temp.rid('s2'))=2,'S2 dicatat ulang satu karyawan 1.350 (riwayat 2 baris)');
select pg_temp.ok((pg_temp.chrow('s2')).jual_lebih=150 and (pg_temp.chrow('s2')).total=1350,'S2 baris ulang menyimpan bukti neto yang sama');

-- ═════════ S3 lebih lebih besar dari kurang (nilai jual): tidak ada beban ═════════
select pg_temp.mk('s3',150);select pg_temp.lay('s3',2,100);select pg_temp.mk('g3',150);select pg_temp.lay('g3',10,100);
select pg_temp.post('s3','{"s3":0,"g3":15}');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s3'),'jual_kurang')=300 and pg_temp.n(pg_temp.basis('s3'),'jual_lebih')=750 and pg_temp.n(pg_temp.basis('s3'),'jual_total')=0,'S3 dasar: kurang 300, lebih 750, nilai beban 0 (tidak negatif)');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s3'),'hpp_part')=0 and pg_temp.n(pg_temp.basis('s3'),'gain_part')=0 and pg_temp.n(pg_temp.basis('s3'),'hpp_neto')=0,'S3 dasar: bagian HPP 0, bagian pendapatan lain 0');
select pg_temp.ok(pg_temp.basis('s3')->'refuse'->>'code'='LEBIH_MENUTUPI' and pg_temp.basis('s3')->'refuse'->>'message' like '%nilai jual Rp 750%menutup%nilai jual Rp 300%','S3 ditolak LEBIH_MENUTUPI dengan kalimat biasa (lebih Rp 750 menutup kurang Rp 300)');
select pg_temp.reject('select pg_temp.chs(''s3'',pg_temp.lines(1))','BEBAN_KARYAWAN_LEBIH_MENUTUPI','S3 pencatatan beban ditolak: lebih menutup kurang');
select pg_temp.ok(not exists(select 1 from public.opname_variance_charges where result_id=pg_temp.rid('s3')) and pg_temp.jcount('opname-beban-karyawan',pg_temp.ref('s3'))=0 and not exists(select 1 from public.cash_advances where alasan like '%'||pg_temp.ref('s3')||'%'),'S3 tanpa jejak, jurnal, atau kasbon');

-- ═════════ S4 lebih persis sama dengan kurang (nilai jual) ═════════
select pg_temp.mk('s4',150);select pg_temp.lay('s4',3,100);select pg_temp.mk('g4',150);select pg_temp.lay('g4',10,100);
select pg_temp.post('s4','{"s4":0,"g4":13}');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s4'),'jual_kurang')=450 and pg_temp.n(pg_temp.basis('s4'),'jual_lebih')=450 and pg_temp.n(pg_temp.basis('s4'),'jual_total')=0 and pg_temp.basis('s4')->'refuse'->>'code'='LEBIH_MENUTUPI','S4 kurang = lebih: nilai beban 0, ditolak LEBIH_MENUTUPI');

-- ═════════ S5 lebih bernilai jual tinggi: nilai beban kecil, bagian HPP terbatas nilai beban, tanpa 810004 ═════════
select pg_temp.mk('s5',150);select pg_temp.lay('s5',10,100);select pg_temp.mk('g5',1000);select pg_temp.lay('g5',5,100);
select pg_temp.post('s5','{"s5":0,"g5":6}');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s5'),'jual_total')=500 and pg_temp.n(pg_temp.basis('s5'),'hpp_neto')=900 and pg_temp.n(pg_temp.basis('s5'),'hpp_part')=500 and pg_temp.n(pg_temp.basis('s5'),'gain_part')=0,'S5 dasar: 1.500 - 1.000 = 500; bagian HPP min(500, 900) = 500; tanpa pendapatan lain');
select pg_temp.ok((pg_temp.charge('s5',pg_temp.lines(500))->>'total')::numeric=500,'S5 beban 500 diterima');
select pg_temp.ok(pg_temp.gs('opname-beban-karyawan',pg_temp.ref('s5'),'182001')=500 and pg_temp.gs('opname-beban-karyawan',pg_temp.ref('s5'),'720010')=-500 and not pg_temp.has('opname-beban-karyawan',pg_temp.ref('s5'),'810004'),'S5 jurnal beban: Dr 182001 500 / Cr 720010 500, tidak ada baris 810004');
select pg_temp.ok(pg_temp.g(pg_temp.ref('s5'),'720010')=400,'S5 beban 720010 sesudah SO + beban = 400 (900 - 500), tidak negatif');

-- ═════════ S6 biaya lebih melebihi biaya kurang, tetapi nilai jual neto positif ═════════
select pg_temp.mk('s6',500);select pg_temp.lay('s6',1,10);select pg_temp.mk('g6',100);select pg_temp.lay('g6',3,200);
select pg_temp.post('s6','{"s6":0,"g6":6}');
select pg_temp.ok(pg_temp.gs('opname',pg_temp.ref('s6'),'720010')=0 and pg_temp.gs('opname',pg_temp.ref('s6'),'810004')=-590,'S6 SO: beban 720010 0 (kurang 10 tertutup lebih 600), pendapatan lain 590');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s6'),'jual_kurang')=500 and pg_temp.n(pg_temp.basis('s6'),'jual_lebih')=300 and pg_temp.n(pg_temp.basis('s6'),'jual_total')=200,'S6 dasar: kurang 500 - lebih 300 = 200');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s6'),'hpp_neto')=0 and pg_temp.n(pg_temp.basis('s6'),'hpp_part')=0 and pg_temp.n(pg_temp.basis('s6'),'gain_part')=200 and pg_temp.n(pg_temp.basis('s6'),'hpp_total')=10 and pg_temp.n(pg_temp.basis('s6'),'hpp_lebih')=600,'S6 dasar: HPP neto 0 -> bagian HPP 0, seluruh 200 pendapatan lain');
select pg_temp.ok((pg_temp.charge('s6',pg_temp.lines(100,100))->>'total')::numeric=200,'S6 beban 200 dibagi 100 + 100');
select pg_temp.ok(pg_temp.gs('opname-beban-karyawan',pg_temp.ref('s6'),'182001')=200 and pg_temp.gs('opname-beban-karyawan',pg_temp.ref('s6'),'810004')=-200 and not pg_temp.has('opname-beban-karyawan',pg_temp.ref('s6'),'720010'),'S6 jurnal beban: Dr 182001 200 / Cr 810004 200, tanpa baris 720010');
select pg_temp.ok(pg_temp.g(pg_temp.ref('s6'),'720010')=0,'S6 beban 720010 tetap 0, tidak menjadi kredit karena beban karyawan');

-- ═════════ S7 pembulatan: dua sisi dibulatkan 2 desimal sebelum dikurangkan ═════════
select pg_temp.mk('s7',33.33);select pg_temp.lay('s7',3,20);select pg_temp.mk('g7',33.33);select pg_temp.lay('g7',2,20);
select pg_temp.post('s7','{"s7":0.5,"g7":2.25}');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s7'),'jual_kurang')=83.33 and pg_temp.n(pg_temp.basis('s7'),'jual_lebih')=8.33 and pg_temp.n(pg_temp.basis('s7'),'jual_total')=75,'S7 pembulatan: kurang 2,5 x 33,33 = 83,325 -> 83,33; lebih 0,25 x 33,33 = 8,3325 -> 8,33; nilai beban 75,00 (bukan 74,99)');
select pg_temp.ok((pg_temp.charge('s7',pg_temp.lines(37.5,37.5))->>'total')::numeric=75,'S7 beban 75 dibagi 37,50 + 37,50');
select pg_temp.ok((pg_temp.chrow('s7')).jual_kurang=83.33 and (pg_temp.chrow('s7')).jual_lebih=8.33,'S7 jejak menyimpan dua sisi yang sudah dibulatkan');

-- ═════════ S8 lebih tanpa riwayat harga (Rp0, ditandai): offset nilai jual tetap berlaku ═════════
select pg_temp.mk('s8',150);select pg_temp.lay('s8',4,100);select pg_temp.mk('g8',150);
select pg_temp.post('s8','{"s8":0,"g8":2}');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s8'),'jual_kurang')=600 and pg_temp.n(pg_temp.basis('s8'),'jual_lebih')=300 and pg_temp.n(pg_temp.basis('s8'),'jual_total')=300,'S8 dasar: kurang 600 - lebih 300 = 300');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s8'),'hpp_lebih')=0 and pg_temp.n(pg_temp.basis('s8'),'hpp_neto')=400 and pg_temp.n(pg_temp.basis('s8'),'hpp_part')=300 and pg_temp.n(pg_temp.basis('s8'),'gain_part')=0,'S8 dasar: HPP lebih 0 (tanpa harga), HPP neto 400, bagian HPP min(300, 400) = 300');

-- ═════════ S9 harga jual kurang Rp0: HARGA_JUAL_KOSONG (bukan LEBIH_MENUTUPI) ═════════
select pg_temp.mk('s9',0);select pg_temp.lay('s9',3,100);select pg_temp.mk('g9',150);select pg_temp.lay('g9',4,100);
select pg_temp.post('s9','{"s9":0,"g9":6}');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s9'),'jual_kurang')=0 and pg_temp.n(pg_temp.basis('s9'),'jual_lebih')=300 and pg_temp.basis('s9')->'refuse'->>'code'='HARGA_JUAL_KOSONG','S9 harga jual kurang 0 (lebih 300): ditolak HARGA_JUAL_KOSONG, bukan LEBIH_MENUTUPI');

-- ═════════ S10 periode tutup ═════════
select pg_temp.mk('s10',150);select pg_temp.lay('s10',10,100);select pg_temp.mk('g10',150);select pg_temp.lay('g10',5,100);
select pg_temp.post('s10','{"s10":0,"g10":6}');
update accounting_locks set closed_until=pg_temp.today();
select pg_temp.ok(pg_temp.basis('s10')->'refuse'->>'code'='PERIODE','S10 periode hari ini ditutup: dasar menolak PERIODE');
select pg_temp.reject('select pg_temp.chs(''s10'',pg_temp.lines(1350))','BEBAN_KARYAWAN_PERIODE','S10 pencatatan beban ditolak saat periode ditutup');
update accounting_locks set closed_until=null;
select pg_temp.ok(pg_temp.basis('s10')->'refuse'='null'::jsonb,'S10 periode dibuka lagi: tidak ditolak');

-- ═════════ S11 kunci permintaan idempoten ═════════
select pg_temp.mk('s11',150);select pg_temp.lay('s11',10,100);select pg_temp.mk('g11',150);select pg_temp.lay('g11',5,100);
select pg_temp.post('s11','{"s11":0,"g11":6}');
do $$declare k uuid:='5b500000-0000-4000-8000-000000000011';a jsonb;b jsonb;l jsonb:=pg_temp.lines(1000,350);begin
 a:=pg_temp.charge('s11',l,k);b:=pg_temp.charge('s11',jsonb_build_array(l->1,l->0),k);
 insert into res values('s11.a',a),('s11.b',b);end$$;
select pg_temp.ok((select r->>'charge_id' from res where name='s11.a')=(select r->>'charge_id' from res where name='s11.b') and (select (r->>'already_applied')::boolean from res where name='s11.b') and (select count(*) from public.opname_variance_charges where result_id=pg_temp.rid('s11'))=1,'S11 kunci sama + isi sama (urutan baris dibalik): hasil lama (satu baris, already_applied)');
select pg_temp.reject('select pg_temp.charge(''s11'',pg_temp.lines(1350),''5b500000-0000-4000-8000-000000000011'')','BEBAN_KARYAWAN_KUNCI_DIPAKAI','S11 kunci sama + isi beda ditolak');

-- ═════════ S12 dokumen yang sudah dikoreksi: ditolak seperti sebelumnya ═════════
select pg_temp.mk('s12',150);select pg_temp.lay('s12',10,100);select pg_temp.mk('g12',150);select pg_temp.lay('g12',5,100);
select pg_temp.post('s12','{"s12":0,"g12":6}');
do $$declare doc uuid:=pg_temp.rid('s12');rj jsonb;prev jsonb;begin
 select jsonb_agg(jsonb_build_object('item_id',pg_temp.iid(k),'qty',v)) into rj from jsonb_each('{"s12":2,"g12":6}'::jsonb) e(k,v);
 perform pg_temp.as_(pg_temp.owner());prev:=public.preview_stock_document_correction('opname',doc,rj);
 perform public.correct_stock_document('opname',doc,rj,'Koreksi fiktif KN','kn-12',prev->>'token');end$$;
select pg_temp.ok(pg_temp.basis('s12')->'refuse'->>'code'='DIKOREKSI','S12 opname yang sudah dikoreksi: ditolak DIKOREKSI (tidak berubah)');

-- ═════════ S13 peran & ACL ═════════
select pg_temp.mk('s13',150);select pg_temp.lay('s13',10,100);select pg_temp.mk('g13',150);select pg_temp.lay('g13',5,100);
select pg_temp.post('s13','{"s13":0,"g13":6}');
select pg_temp.reject('select pg_temp.chs(''s13'',pg_temp.lines(1350),''5b100000-0000-4000-8000-000000000004'')','BEBAN_KARYAWAN_DITOLAK','S13 STAF tidak boleh mencatat beban');
select pg_temp.reject('select pg_temp.chs(''s13'',pg_temp.lines(1350),''5b100000-0000-4000-8000-000000000005'')','ADMIN_ONLINE_FUNCTION_DENIED','S13 ADMIN_ONLINE ditolak pagar Admin Online saat mencatat beban');
select pg_temp.reject('select pg_temp.chs(''s13'',pg_temp.lines(1350),''5b100000-0000-4000-8000-000000000003'')','BEBAN_KARYAWAN_DITOLAK','S13 FINANCE tanpa izin khusus tidak boleh mencatat beban');
select pg_temp.reject('select pg_temp.chs(''s13'',pg_temp.lines(1350),''5b100000-0000-4000-8000-000000000002'')','BEBAN_KARYAWAN_DITOLAK','S13 ADMIN tanpa izin khusus tidak boleh mencatat beban');
do $$begin perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','',true);end$$;
select pg_temp.reject('select public.read_opname_variance_charge(pg_temp.rid(''s13''))','BEBAN_KARYAWAN_DITOLAK','S13 tanpa login tidak boleh membaca ringkasan');
select pg_temp.as_('5b100000-0000-4000-8000-000000000004');
select pg_temp.reject('select public.read_opname_variance_charge(pg_temp.rid(''s13''))','BEBAN_KARYAWAN_DITOLAK','S13 STAF tidak boleh membaca ringkasan nilai');
select pg_temp.as_('5b100000-0000-4000-8000-000000000005');
select pg_temp.reject('select public.read_opname_variance_charge(pg_temp.rid(''s13''))','ADMIN_ONLINE_FUNCTION_DENIED','S13 ADMIN_ONLINE ditolak pagar Admin Online saat membaca ringkasan nilai');
do $$begin perform pg_temp.as_('5b100000-0000-4000-8000-000000000003');insert into res values('s13.fin',public.read_opname_variance_charge(pg_temp.rid('s13')));end$$;
select pg_temp.ok((select (r->>'jual_total')::numeric=1350 and not (r->>'can_charge')::boolean from res where name='s13.fin'),'S13 FINANCE boleh membaca ringkasan neto 1.350 tetapi tidak boleh mencatat (can_charge false)');
select pg_temp.ok(not exists(select 1 from public.opname_variance_charges where result_id=pg_temp.rid('s13')),'S13 penolakan peran tidak meninggalkan jejak');
select pg_temp.ok(has_function_privilege('authenticated','public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid)','EXECUTE') and has_function_privilege('authenticated','public.read_opname_variance_charge(uuid)','EXECUTE') and has_function_privilege('authenticated','public.cancel_opname_variance_charge(uuid,text,uuid)','EXECUTE'),'S13 ACL: authenticated boleh memanggil catat/baca/batal');
select pg_temp.ok(not has_function_privilege('anon','public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid)','EXECUTE') and not has_function_privilege('anon','public.read_opname_variance_charge(uuid)','EXECUTE') and not has_function_privilege('anon','public.cancel_opname_variance_charge(uuid,text,uuid)','EXECUTE') and not has_function_privilege('service_role','public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid)','EXECUTE') and not has_function_privilege('service_role','public.read_opname_variance_charge(uuid)','EXECUTE'),'S13 ACL: anon dan service_role tidak bisa memanggil catat/baca');
select pg_temp.ok(not has_function_privilege('authenticated','public.opname_variance_charge_basis(uuid)','EXECUTE') and not has_function_privilege('anon','public.opname_variance_charge_basis(uuid)','EXECUTE') and not has_function_privilege('service_role','public.opname_variance_charge_basis(uuid)','EXECUTE'),'S13 ACL: fungsi dasar internal tidak bisa dipanggil peran klien');
select pg_temp.ok(not has_table_privilege('authenticated','public.opname_variance_charges','INSERT') and not has_table_privilege('authenticated','public.opname_variance_charges','UPDATE') and not has_table_privilege('authenticated','public.opname_variance_charges','SELECT') and not has_table_privilege('anon','public.opname_variance_charges','SELECT'),'S13 ACL: tabel jejak tidak bisa ditulis/dibaca langsung peran klien');
select pg_temp.ok((select count(*) from pg_proc p where p.oid in('public.read_opname_variance_charge(uuid)'::regprocedure,'public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid)'::regprocedure,'public.cancel_opname_variance_charge(uuid,text,uuid)'::regprocedure) and p.prosrc like '%perform admin_online_private.deny_admin_online();%')=3,'S13 pagar Admin Online (deny_admin_online) tetap ada di baca, catat, dan batal');
select pg_temp.ok((select count(*) from pg_proc p where p.oid in('public.opname_variance_charge_basis(uuid)'::regprocedure,'public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid)'::regprocedure,'public.read_opname_variance_charge(uuid)'::regprocedure,'public.cancel_opname_variance_charge(uuid,text,uuid)'::regprocedure) and p.prosecdef and array_to_string(p.proconfig,',') like '%search_path=""%')=4,'S13 keempat fungsi beban: SECURITY DEFINER + search_path kosong');
select pg_temp.ok((select proconfig::text from pg_proc where oid='public.charge_opname_variance_to_employees(uuid,jsonb,text,uuid)'::regprocedure) like '%lock_timeout=8s%' and (select proconfig::text from pg_proc where oid='public.cancel_opname_variance_charge(uuid,text,uuid)'::regprocedure) like '%lock_timeout=8s%','S13 lock_timeout 8s pada catat/batal tetap');
select pg_temp.ok((select p.provolatile from pg_proc p where p.oid='public.opname_variance_charge_basis(uuid)'::regprocedure)='v' and (select p.prorettype::regtype::text from pg_proc p where p.oid='public.opname_variance_charge_basis(uuid)'::regprocedure)='jsonb','S13 dasar tetap volatile mengembalikan jsonb');

-- ═════════ S14 tabel jejak: kolom, batasan, trigger ═════════
select pg_temp.ok((select data_type||':'||numeric_precision||':'||numeric_scale||':'||is_nullable from information_schema.columns where table_schema='public' and table_name='opname_variance_charges' and column_name='jual_kurang')='numeric:15:2:YES' and (select data_type||':'||numeric_precision||':'||numeric_scale||':'||is_nullable from information_schema.columns where table_schema='public' and table_name='opname_variance_charges' and column_name='jual_lebih')='numeric:15:2:YES','S14 kolom jual_kurang/jual_lebih: numeric(15,2) nullable');
select pg_temp.ok((select count(*) from pg_constraint where conrelid='public.opname_variance_charges'::regclass and conname='opname_variance_charges_neto')=1,'S14 batasan neto terpasang');
create function pg_temp.mut_row(sql_ text) returns text language plpgsql as $$begin
 execute 'alter table public.opname_variance_charges disable trigger opname_variance_charges_guard';
 begin execute sql_;raise exception 'MUT_OK';exception when others then
  execute 'alter table public.opname_variance_charges enable trigger opname_variance_charges_guard';return sqlerrm;end;end$$;
select pg_temp.ok(pg_temp.mut_row('update public.opname_variance_charges set jual_lebih=999 where result_id='''||pg_temp.rid('s2')||'''') like '%opname_variance_charges_neto%','S14 batasan neto menolak total yang tidak sama dengan kurang - lebih');
select pg_temp.ok(pg_temp.mut_row('update public.opname_variance_charges set jual_kurang=null where result_id='''||pg_temp.rid('s2')||'''') like '%opname_variance_charges_neto%','S14 batasan neto menolak satu sisi null');
select pg_temp.ok(pg_temp.mut_row('update public.opname_variance_charges set jual_lebih=-1,jual_kurang=1349 where result_id='''||pg_temp.rid('s2')||'''') like '%opname_variance_charges_neto%','S14 batasan neto menolak lebih negatif');
select pg_temp.reject('update public.opname_variance_charges set jual_lebih=0','tidak dapat diubah','S14 jejak: bukti neto tidak bisa diubah (trigger jejak)');
select pg_temp.reject('delete from public.opname_variance_charges','tidak dapat dihapus','S14 jejak: tidak bisa dihapus');
select pg_temp.ok((select count(*) from pg_trigger where tgrelid='public.opname_variance_charges'::regclass and tgname in('opname_variance_charges_guard','a01_activity_change','a01_activity_delete') and not tgisinternal)=3,'S14 trigger jejak dan Log Aktifitas tetap 3');
select pg_temp.ok((select count(*) from public.activity_log_sources where entity='opname_variance_charges')=1,'S14 sumber Log Aktifitas tetap satu');

-- ═════════ S15 pembagian karyawan: aturan lama tetap ═════════
select pg_temp.mk('s15',150);select pg_temp.lay('s15',10,100);select pg_temp.mk('g15',150);select pg_temp.lay('g15',5,100);
select pg_temp.post('s15','{"s15":0,"g15":6}');
select pg_temp.reject('select pg_temp.chs(''s15'',null)','BEBAN_KARYAWAN_BAGI','S15 tanpa pembagian ditolak');
select pg_temp.reject('select pg_temp.chs(''s15'',jsonb_build_array(jsonb_build_object(''employee_id'',pg_temp.e(1),''amount'',675),jsonb_build_object(''employee_id'',pg_temp.e(1),''amount'',675)))','BEBAN_KARYAWAN_BAGI','S15 satu karyawan dua kali ditolak');
select pg_temp.reject('select pg_temp.chs(''s15'',pg_temp.lines(1350.005))','BEBAN_KARYAWAN_BAGI','S15 jumlah lebih dari 2 desimal ditolak');
select pg_temp.reject('select pg_temp.chs(''s15'',pg_temp.lines(1350,0))','BEBAN_KARYAWAN_BAGI','S15 jumlah 0 ditolak');
select pg_temp.reject('select public.charge_opname_variance_to_employees(pg_temp.rid(''s15''),pg_temp.lines(1350),''ab'',gen_random_uuid())','BEBAN_KARYAWAN_ALASAN','S15 alasan terlalu pendek ditolak');
select pg_temp.reject('select public.charge_opname_variance_to_employees(pg_temp.rid(''s15''),pg_temp.lines(1350),''alasan cukup'',null)','BEBAN_KARYAWAN_KUNCI','S15 tanpa kunci ditolak');
select pg_temp.charge('s15',pg_temp.lines(450,450,450));
select pg_temp.ok((select (r->>'total')::numeric from res where name='s15.ch')=1350 and pg_temp.advsum('s15')=1350 and (select count(*) from public.cash_advances where id=any((pg_temp.chrow('s15')).advance_ids))=3,'S15 tiga karyawan 450 + 450 + 450 = 1.350 diterima, tiga kasbon');
select pg_temp.ok((select count(*) from public.cash_advances where id=any((pg_temp.chrow('s15')).advance_ids) and status='Dicatat' and tenor_bulan=1 and alasan like 'Beban selisih stok opname %')=3,'S15 kasbon status Dicatat, tenor 1, alasan diawali Beban selisih stok opname');
select pg_temp.mk('s15b',150);select pg_temp.lay('s15b',4,100);select pg_temp.mk('g15b',150);select pg_temp.lay('g15b',1,100);
select pg_temp.post('s15b','{"s15b":0,"g15b":2}');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s15b'),'jual_total')=450,'S15 dasar s15b: kurang 600 - lebih 150 = 450');
select pg_temp.reject('select pg_temp.chs(''s15b'',jsonb_build_array(jsonb_build_object(''employee_id'',pg_temp.e(1),''amount'',150),jsonb_build_object(''employee_id'',pg_temp.e(2),''amount'',150),jsonb_build_object(''employee_id'',pg_temp.e(4),''amount'',150)))','BEBAN_KARYAWAN_KARYAWAN','S15 karyawan tidak aktif ditolak (nilai neto 450 dibagi 3)');

-- ═════════ S16 SO tanpa selisih lebih dan banyak barang: kotor = neto ═════════
select pg_temp.mk('a16',150);select pg_temp.mk('b16',40);select pg_temp.lay('a16',6,100);select pg_temp.lay('b16',9,25);
select pg_temp.post('s16','{"a16":4,"b16":0}');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s16'),'jual_kurang')=660 and pg_temp.n(pg_temp.basis('s16'),'jual_lebih')=0 and pg_temp.n(pg_temp.basis('s16'),'jual_total')=660 and pg_temp.n(pg_temp.basis('s16'),'hpp_total')=425 and (pg_temp.basis('s16')->>'minus_count')::int=2,'S16 dua barang kurang: 2 x 150 + 9 x 40 = 660, HPP 200 + 225 = 425, tanpa lebih');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s16'),'hpp_part')=425 and pg_temp.n(pg_temp.basis('s16'),'gain_part')=235,'S16 bagian HPP 425, pendapatan lain 235');

-- ═════════ S17 banyak lebih dan banyak kurang ═════════
select pg_temp.mk('k17a',120);select pg_temp.mk('k17b',60);select pg_temp.mk('l17a',200);select pg_temp.mk('l17b',30);
select pg_temp.lay('k17a',5,80);select pg_temp.lay('k17b',8,30);select pg_temp.lay('l17a',2,150);select pg_temp.lay('l17b',3,20);
select pg_temp.post('s17','{"k17a":2,"k17b":4,"l17a":3,"l17b":10}');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s17'),'jual_kurang')=3*120+4*60 and pg_temp.n(pg_temp.basis('s17'),'jual_lebih')=1*200+7*30 and pg_temp.n(pg_temp.basis('s17'),'jual_total')=600-410,'S17 dasar: kurang 3 x 120 + 4 x 60 = 600; lebih 1 x 200 + 7 x 30 = 410; nilai beban 190');
select pg_temp.ok((pg_temp.basis('s17')->>'minus_count')::int=2 and (pg_temp.basis('s17')->>'plus_count')::int=2 and jsonb_array_length(pg_temp.basis('s17')->'plus_lines')=2,'S17 dua baris kurang, dua baris lebih');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s17'),'hpp_total')=3*80+4*30 and pg_temp.n(pg_temp.basis('s17'),'hpp_lebih')=150+7*20,'S17 HPP kurang 360, HPP lebih 290');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s17'),'hpp_neto')=70 and pg_temp.n(pg_temp.basis('s17'),'hpp_part')=70 and pg_temp.n(pg_temp.basis('s17'),'gain_part')=120,'S17 HPP neto 70 (360 - 290): bagian HPP 70, pendapatan lain 120');
select pg_temp.charge('s17',pg_temp.lines(190));
select pg_temp.ok((select (r->>'total')::numeric from res where name='s17.ch')=190 and pg_temp.g(pg_temp.ref('s17'),'720010')=0,'S17 beban 190 diterima; 720010 sesudah SO + beban 0');

-- ═════════ S18 dokumen lama: baris lebih pada foto, jurnal asal hanya-kurang (beban 720010 kotor) ═════════
select pg_temp.mk('s18',150);select pg_temp.lay('s18',10,100);select pg_temp.mk('g18',150);select pg_temp.lay('g18',5,100);
select pg_temp.post('s18','{"s18":0,"g18":5}');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s18'),'jual_total')=1500 and pg_temp.n(pg_temp.basis('s18'),'jual_lebih')=0,'S18 dasar awal (tanpa lebih): 1.500');
do $$declare rid uuid:=pg_temp.rid('s18');rec public.opname_posting_receipts%rowtype;rows_ jsonb;begin
 select * into rec from public.opname_posting_receipts where result_id=rid;
 rows_:=rec.source_snapshot->'price_report'->'rows';
 execute 'alter table public.opname_posting_receipts disable trigger user';
 update public.opname_posting_receipts set source_snapshot=jsonb_set(source_snapshot,'{price_report,rows}',rows_||jsonb_build_array(jsonb_build_object('item_id',pg_temp.iid('g18'),'code','KN-g18','name','Barang g18','unit','PCS','selisih',2,'qty_sistem',5,'qty_fisik',7,'harga_jual_cabang','150','nilai_selisih_jual','300','nilai_selisih_modal','0')))
  where result_id=rid;
 execute 'alter table public.opname_posting_receipts enable trigger user';end$$;
select pg_temp.ok(pg_temp.n(pg_temp.basis('s18'),'jual_lebih')=300 and pg_temp.n(pg_temp.basis('s18'),'jual_total')=1200 and pg_temp.n(pg_temp.basis('s18'),'hpp_neto')=1000 and pg_temp.n(pg_temp.basis('s18'),'hpp_part')=1000 and pg_temp.n(pg_temp.basis('s18'),'gain_part')=200,'S18 dokumen lama dengan baris lebih: nilai beban 1.500 - 300 = 1.200; beban 720010 tercatat 1.000 (jurnal asal tanpa kredit): bagian HPP 1.000');
select pg_temp.charge('s18',pg_temp.lines(1200));
select pg_temp.ok((select (r->>'total')::numeric from res where name='s18.ch')=1200 and pg_temp.gs('opname-beban-karyawan',pg_temp.ref('s18'),'720010')=-1000 and pg_temp.gs('opname-beban-karyawan',pg_temp.ref('s18'),'810004')=-200,'S18 beban 1.200: Cr 720010 1.000 / Cr 810004 200');

-- ═════════ S19 jurnal penyesuaian (mis. penyesuaian data lama) yang mengurangi 720010 ikut dihitung; yang divoid tidak ═════════
create function pg_temp.adj(label text,lines jsonb) returns uuid language plpgsql as $$
declare j uuid;begin
 perform pg_temp.as_(pg_temp.owner());
 j:=public.opname_posting_journal(pg_temp.today(),'5b200000-0000-4000-8000-000000000001'::uuid,'opname',pg_temp.ref(label),'Penyesuaian uji KN',lines);return j;end$$;
select pg_temp.mk('s19',150);select pg_temp.lay('s19',10,100);select pg_temp.mk('g19',150);select pg_temp.lay('g19',5,100);
select pg_temp.post('s19','{"s19":0,"g19":5}');
do $$declare rid uuid:=pg_temp.rid('s19');rows_ jsonb;begin
 select source_snapshot->'price_report'->'rows' into rows_ from public.opname_posting_receipts where result_id=rid;
 execute 'alter table public.opname_posting_receipts disable trigger user';
 update public.opname_posting_receipts set source_snapshot=jsonb_set(source_snapshot,'{price_report,rows}',rows_||jsonb_build_array(jsonb_build_object('item_id',pg_temp.iid('g19'),'code','KN-g19','name','Barang g19','unit','PCS','selisih',2,'qty_sistem',5,'qty_fisik',7,'harga_jual_cabang','150','nilai_selisih_jual','300','nilai_selisih_modal','0')))
  where result_id=rid;
 execute 'alter table public.opname_posting_receipts enable trigger user';end$$;
do $$begin insert into res values('s19.adj',jsonb_build_object('id',pg_temp.adj('s19','[{"code":"170001","debit":300,"credit":0},{"code":"720010","debit":0,"credit":300}]'::jsonb)));end$$;
select pg_temp.ok(pg_temp.n(pg_temp.basis('s19'),'hpp_total')=1000 and pg_temp.n(pg_temp.basis('s19'),'hpp_neto')=700 and pg_temp.n(pg_temp.basis('s19'),'jual_total')=1200 and pg_temp.basis('s19')->'refuse'='null'::jsonb,'S19 jurnal penyesuaian Cr 720010 300 ikut dihitung: HPP tersisa 700 (bukan 1.000), nilai beban 1.500 - 300 = 1.200, tidak ditolak');
select pg_temp.ok(pg_temp.n(pg_temp.basis('s19'),'hpp_part')=700 and pg_temp.n(pg_temp.basis('s19'),'gain_part')=500,'S19 bagian HPP 700, pendapatan lain 500');
select pg_temp.charge('s19',pg_temp.lines(1200));
select pg_temp.ok((select (r->>'total')::numeric from res where name='s19.ch')=1200 and pg_temp.gs('opname-beban-karyawan',pg_temp.ref('s19'),'720010')=-700 and pg_temp.gs('opname-beban-karyawan',pg_temp.ref('s19'),'810004')=-500,'S19 beban 1.200: Cr 720010 700 / Cr 810004 500');
select pg_temp.ok(pg_temp.g(pg_temp.ref('s19'),'720010')=0,'S19 beban 720010 sesudah SO + penyesuaian + beban = 0 (bukan -300)');
do $$begin execute 'alter table public.journal_entries disable trigger user';update public.journal_entries set voided_at=now() where id=(select (r->>'id')::uuid from res where name='s19.adj');execute 'alter table public.journal_entries enable trigger user';end$$;
select pg_temp.ok(pg_temp.n(pg_temp.basis('s19'),'hpp_neto')=1000,'S19 jurnal penyesuaian yang divoid tidak dihitung: HPP tersisa kembali 1.000');
select pg_temp.mk('s20',150);select pg_temp.lay('s20',10,100);select pg_temp.post('s20','{"s20":0}');
do $$begin insert into res values('s20.adj',jsonb_build_object('id',pg_temp.adj('s20','[{"code":"720010","debit":50,"credit":0},{"code":"170001","debit":0,"credit":50}]'::jsonb)));end$$;
select pg_temp.ok(pg_temp.basis('s20')->'refuse'->>'code'='TIDAK_COCOK' and pg_temp.n(pg_temp.basis('s20'),'hpp_neto')=1000 and pg_temp.n(pg_temp.basis('s20'),'hpp_total')=1000,'S20 jurnal tambahan Dr 720010 50 pada dokumen yang sama: TIDAK_COCOK (gagal tertutup); HPP tersisa dibatasi HPP kurang 1.000');
select pg_temp.reject('select pg_temp.chs(''s20'',pg_temp.lines(1500))','BEBAN_KARYAWAN_TIDAK_COCOK','S20 pencatatan beban ditolak saat jurnal tidak cocok');
select pg_temp.mk('s21',150);select pg_temp.lay('s21',10,100);select pg_temp.post('s21','{"s21":0}');
do $$begin insert into res values('s21.adj',jsonb_build_object('id',pg_temp.adj('s21','[{"code":"170001","debit":1200,"credit":0},{"code":"720010","debit":0,"credit":1200}]'::jsonb)));end$$;
select pg_temp.ok(pg_temp.n(pg_temp.basis('s21'),'hpp_neto')=0 and pg_temp.n(pg_temp.basis('s21'),'hpp_part')=0 and pg_temp.n(pg_temp.basis('s21'),'gain_part')=1500,'S21 kredit 720010 melebihi debit (1.200 > 1.000): HPP tersisa 0, tidak negatif; seluruh 1.500 ke pendapatan lain');

select pg_temp.ok(true,'SELESAI tanpa efek samping: semua dirollback');
rollback;
