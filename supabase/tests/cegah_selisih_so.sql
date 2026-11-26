-- CEGAH-SELISIH-SO (migrasi *_cegah_selisih_so): fictional fixtures in disposable PostgreSQL only; everything rolls back.
-- Aturan yang dibuktikan: selisih = hitungan - stok saat hitungan DIKUNCI PERTAMA; stok akhir = stok sekarang + selisih (penjualan/terima/transfer
-- di antaranya tidak disentuh); Buka + kunci ulang tidak menggeser foto pertama; barang belum dikunci yang stoknya bergerak ditolak; tidak ada stok negatif baru;
-- jurnal neto (PR #580), kasbon neto, FIFO, idempotensi, periode tutup, gerbang peran, ACL, kasus persis OPR.00012 (Meo Pouch Adult/Kitten).
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
 ('5c100000-0000-4000-8000-000000000001','{"full_name":"CS owner"}'),('5c100000-0000-4000-8000-000000000002','{"full_name":"CS staf kasir"}'),
 ('5c100000-0000-4000-8000-000000000003','{"full_name":"CS admin online"}'),('5c100000-0000-4000-8000-000000000004','{"full_name":"CS staf tanpa shift cabang lain"}');
update profiles set role='OWNER',is_active=true where id='5c100000-0000-4000-8000-000000000001';
update profiles set role='STAFF',is_active=true where id in('5c100000-0000-4000-8000-000000000002','5c100000-0000-4000-8000-000000000004');
update profiles set role='ADMIN_ONLINE',is_active=true where id='5c100000-0000-4000-8000-000000000003';
insert into role_capabilities(role,all_branches,create_accounts) values('STAFF',false,false) on conflict(role) do update set all_branches=false;
insert into role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into branches(id,code,name,type) values('5c200000-0000-4000-8000-000000000001','CSA','CS klinik A','KLINIK'),('5c200000-0000-4000-8000-000000000002','CSB','CS petshop B','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values('5c300000-0000-4000-8000-000000000001','5c200000-0000-4000-8000-000000000001','CSWA','CS gudang A','VET'),
 ('5c300000-0000-4000-8000-000000000002','5c200000-0000-4000-8000-000000000002','CSWB','CS gudang B','RETAIL');
insert into user_branches(user_id,branch_id) values('5c100000-0000-4000-8000-000000000002','5c200000-0000-4000-8000-000000000001'),('5c100000-0000-4000-8000-000000000003','5c200000-0000-4000-8000-000000000001'),
 ('5c100000-0000-4000-8000-000000000004','5c200000-0000-4000-8000-000000000002');
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active) values('170001','Persediaan fiktif','ASET','D',false,true),('720010','Beban selisih stok fiktif','BEBAN','D',false,true),
 ('810004','Pendapatan lain-lain fiktif','PENDAPATAN','K',false,true),('182001','Kasbon karyawan fiktif','ASET','D',false,true) on conflict(code) do update set is_active=true,is_header=false;
update accounting_locks set closed_until=null;
insert into public.employees(id,nama,status,branch_id) values('5c400000-0000-4000-8000-000000000001','Karyawan CS satu','Aktif','5c200000-0000-4000-8000-000000000001'),
 ('5c400000-0000-4000-8000-000000000002','Karyawan CS dua','Aktif','5c200000-0000-4000-8000-000000000001');
-- Paritas hosted: Supabase memberi authenticated hak tabel lewat default privileges; rantai native tidak.
grant select,insert,update,delete on public.opname_counts to authenticated;

create temp table it(code text primary key,id uuid);grant all on it to public;
create temp table res(name text primary key,r jsonb);grant all on res to public;
create temp table ords(label text primary key,id uuid);grant all on ords to public;
create temp table seq(n int);insert into seq values(0);grant all on seq to public;
create function pg_temp.iid(c text) returns uuid language sql as $$select id from it where code=c$$;
create function pg_temp.wa() returns uuid language sql as $$select '5c300000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.owner() returns text language sql as $$select '5c100000-0000-4000-8000-000000000001'$$;
create function pg_temp.staf() returns text language sql as $$select '5c100000-0000-4000-8000-000000000002'$$;
create function pg_temp.e(i int) returns uuid language sql as $$select ('5c400000-0000-4000-8000-00000000000'||i)::uuid$$;
create function pg_temp.mk(c text,sell numeric default 1000,buy numeric default 0) returns void language plpgsql as $$begin
 insert into it values(c,gen_random_uuid());
 insert into public.items(id,code,name,unit,item_type,buy_price,sell_price) values(pg_temp.iid(c),'CS-'||c,'Barang '||c,'PCS','Persediaan',buy,sell);end$$;
-- Lapisan awal: mutasi fixture dibuat "lama" (10 hari lalu) supaya tidak dianggap bergerak sesudah SO dimulai (SO dibuat 2 hari lalu).
create function pg_temp.lay(c text,qty numeric,cost numeric,daysago int default 5) returns void language plpgsql as $$begin
 update seq set n=n+1;
 perform public.stock_in_fifo(pg_temp.wa(),pg_temp.iid(c),qty,cost,'fixture','FX-'||c||'-'||(select n from seq),pg_temp.today()-daysago,null);
 update public.stock_moves set created_at=now()-interval '10 days' where item_id=pg_temp.iid(c) and source='fixture';end$$;
create function pg_temp.sale(c text,qty numeric,ref text default 'POS-CS') returns void language plpgsql as $$begin
 perform public.stock_out_fifo(pg_temp.wa(),pg_temp.iid(c),qty,'sale',ref,pg_temp.today());end$$;
create function pg_temp.recv(c text,qty numeric,cost numeric,src text default 'terima-permintaan') returns void language plpgsql as $$begin
 update seq set n=n+1;
 perform public.stock_in_fifo(pg_temp.wa(),pg_temp.iid(c),qty,cost,src,'RC-'||c||'-'||(select n from seq),pg_temp.today(),null);end$$;
create function pg_temp.sq(c text) returns numeric language sql as $$select qty from public.stock where warehouse_id=pg_temp.wa() and item_id=pg_temp.iid(c)$$;
create function pg_temp.lsum(c text) returns numeric language sql as $$select coalesce(sum(qty_left),0) from public.stock_layers where warehouse_id=pg_temp.wa() and item_id=pg_temp.iid(c)$$;
create function pg_temp.ord(label text) returns uuid language plpgsql as $$
declare oid uuid:=gen_random_uuid();begin
 insert into public.opname_orders(id,no_opname,warehouse_id,penanggung_jawab,created_at) values(oid,'OPO.CS.'||label,pg_temp.wa(),'Penghitung fiktif',now()-interval '2 days');
 insert into ords values(label,oid);return oid;end$$;
create function pg_temp.oid(label text) returns uuid language sql as $$select id from ords where label=$1$$;
-- Kunci seperti aplikasi (kunciBaris): upsert ignoreDuplicates; qty_sistem sengaja diisi angka ngawur 999999 (harus ditimpa server).
create function pg_temp.lock(label text,c text,qty numeric) returns void language plpgsql as $$begin
 insert into public.opname_counts(order_id,item_id,qty_fisik,qty_sistem,locked_by) values(pg_temp.oid(label),pg_temp.iid(c),qty,999999,pg_temp.owner()::uuid)
  on conflict(order_id,item_id) do nothing;end$$;
create function pg_temp.buka(label text,c text) returns void language plpgsql as $$begin
 delete from public.opname_counts where order_id=pg_temp.oid(label) and item_id=pg_temp.iid(c);end$$;
create function pg_temp.cq(label text,c text) returns numeric language sql as $$select qty_sistem from public.opname_counts where order_id=pg_temp.oid($1) and item_id=pg_temp.iid($2)$$;
create function pg_temp.bq(label text,c text) returns numeric language sql as $$select qty_sistem from public.opname_count_baselines where order_id=pg_temp.oid($1) and item_id=pg_temp.iid($2)$$;
create function pg_temp.cnt(counts jsonb) returns jsonb language sql as $$
 select coalesce(jsonb_object_agg(pg_temp.iid(k)::text,v),'{}'::jsonb) from jsonb_each(counts) e(k,v)$$;
create function pg_temp.post(label text,counts jsonb default '{}',uid text default null,d date default null) returns jsonb language plpgsql as $$
declare o uuid:=coalesce(pg_temp.oid(label),pg_temp.ord(label));r jsonb;begin
 perform pg_temp.as_(coalesce(uid,pg_temp.owner()));
 r:=public.post_opname_atomic(o,coalesce(d,pg_temp.today()),pg_temp.cnt(counts));
 insert into res values(label,r||jsonb_build_object('order_id',o)) on conflict(name) do update set r=excluded.r;return r;end$$;
create function pg_temp.tryp(label text,counts jsonb default '{}',uid text default null,d date default null) returns text language plpgsql as $$
begin begin perform pg_temp.post(label,counts,uid,d);raise exception 'TRY_OK';
 exception when others then return case when sqlerrm='TRY_OK' then 'OK' else sqlerrm end;end;end$$;
create function pg_temp.rr(label text) returns jsonb language sql as $$select r from res where name=label$$;
create function pg_temp.ref(label text) returns text language sql as $$select r->>'no_hasil' from res where name=label$$;
create function pg_temp.rid(label text) returns uuid language sql as $$select (r->>'result_id')::uuid from res where name=label$$;
create function pg_temp.ri(label text,c text) returns jsonb language sql as $$
 select to_jsonb(x)-'id'-'result_id'-'item_id' from public.opname_result_items x where x.result_id=pg_temp.rid(label) and x.item_id=pg_temp.iid(c)$$;
create function pg_temp.gl(src text,ref text) returns jsonb language sql as $$
 select coalesce(jsonb_object_agg(code,net),'{}') from (select a.code,sum(l.debit-l.credit) net from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
  join public.journal_entries e on e.id=l.entry_id where e.source=src and e.source_ref=ref group by a.code) x$$;
create function pg_temp.jcount(src text,ref text) returns int language sql as $$select count(*)::int from public.journal_entries where source=src and source_ref=ref$$;
create function pg_temp.balanced(src text,ref text) returns boolean language sql as $$
 select coalesce(sum(l.debit-l.credit),0)=0 from public.journal_lines l join public.journal_entries e on e.id=l.entry_id where e.source=src and e.source_ref=ref$$;
create function pg_temp.opmoves(ref text,c text) returns int language sql as $$select count(*)::int from public.stock_moves where source='opname' and source_ref=ref and item_id=pg_temp.iid(c)$$;
create function pg_temp.rc(label text) returns jsonb language sql as $$
 select source_snapshot-'rows'-'order'-'price_report' from public.opname_posting_receipts where result_id=pg_temp.rid(label)$$;
create function pg_temp.moved(label text,c text) returns jsonb language sql as $$
 select e from public.opname_posting_receipts p cross join lateral jsonb_array_elements(p.source_snapshot->'sejak_hitung') e
  where p.result_id=pg_temp.rid(label) and e->>'item_id'=pg_temp.iid(c)::text$$;
-- sebagai peran klien (authenticated) dalam sub-transaksi; mengembalikan 'OK' atau pesan galat
create function pg_temp.cl(stmt text,uid text default null) returns text language plpgsql as $$
declare m text:='OK';begin
 perform pg_temp.as_(coalesce(uid,pg_temp.staf()));
 begin set local role authenticated;execute stmt;exception when others then m:=sqlerrm;end;
 reset role;return m;end$$;
create function pg_temp.nres(wh uuid default null) returns bigint language sql as $$select count(*) from public.opname_results$$;

-- ═════════ S0 objek, ACL, tanda tambalan ═════════
select pg_temp.ok(to_regclass('public.opname_count_baselines') is not null,'S0 tabel opname_count_baselines ada');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.opname_count_baselines'::regclass),'S0 tabel baseline memakai RLS');
select pg_temp.ok(not has_table_privilege('authenticated','public.opname_count_baselines','SELECT') and not has_table_privilege('authenticated','public.opname_count_baselines','INSERT') and not has_table_privilege('authenticated','public.opname_count_baselines','UPDATE') and not has_table_privilege('authenticated','public.opname_count_baselines','DELETE'),'S0 authenticated tanpa hak apa pun pada tabel baseline');
select pg_temp.ok(not has_table_privilege('anon','public.opname_count_baselines','SELECT') and not has_table_privilege('anon','public.opname_count_baselines','INSERT') and not has_table_privilege('service_role','public.opname_count_baselines','SELECT') and not has_table_privilege('service_role','public.opname_count_baselines','INSERT'),'S0 anon dan service_role tanpa hak pada tabel baseline');
select pg_temp.ok((select count(*) from pg_trigger t where t.tgrelid='public.opname_counts'::regclass and t.tgname in('opname_counts_a_tetapkan_baseline','opname_counts_b_simpan_baseline','opname_counts_c_beku_foto') and not t.tgisinternal)=3,'S0 tiga trigger baru terpasang pada opname_counts');
select pg_temp.ok((select count(*) from pg_proc p where p.oid in('public.opname_counts_simpan_baseline()'::regprocedure,'public.opname_counts_tetapkan_baseline()'::regprocedure) and p.prosecdef and array_to_string(p.proconfig,',') like '%search_path=""%')=2,'S0 trigger baseline: SECURITY DEFINER + search_path kosong');
select pg_temp.ok((select p.prosecdef from pg_proc p where p.oid='public.opname_counts_beku_foto()'::regprocedure) is false and (select array_to_string(p.proconfig,',') from pg_proc p where p.oid='public.opname_counts_beku_foto()'::regprocedure) like '%search_path=""%','S0 trigger pembeku foto: SECURITY INVOKER + search_path kosong');
select pg_temp.ok(not exists(select 1 from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid in('public.opname_counts_simpan_baseline()'::regprocedure,'public.opname_counts_tetapkan_baseline()'::regprocedure,'public.opname_counts_beku_foto()'::regprocedure) and (a.grantee=0 or a.grantee in(select oid from pg_roles where rolname in('anon','authenticated','service_role')))),'S0 fungsi trigger tanpa EXECUTE untuk PUBLIC/anon/authenticated/service_role');
select pg_temp.ok(has_function_privilege('authenticated','public.post_opname_atomic(uuid,date,jsonb)','EXECUTE') and not has_function_privilege('anon','public.post_opname_atomic(uuid,date,jsonb)','EXECUTE') and not has_function_privilege('service_role','public.post_opname_atomic(uuid,date,jsonb)','EXECUTE') and not exists(select 1 from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.post_opname_atomic(uuid,date,jsonb)'::regprocedure and a.grantee=0),'S0 ACL post_opname_atomic: hanya authenticated');
select pg_temp.ok((select prosecdef and array_to_string(proconfig,',') like '%search_path=""%' and array_to_string(proconfig,',') like '%lock_timeout=8s%' from pg_proc where oid='public.post_opname_atomic(uuid,date,jsonb)'::regprocedure),'S0 post_opname_atomic tetap DEFINER + search_path kosong + lock_timeout 8s');
select pg_temp.ok(position('perform admin_online_private.deny_admin_online();' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))>0,'S0 pagar Admin Online tetap ada di post_opname_atomic');
select pg_temp.ok(position('kunci-pertama-v1' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))>0 and position('hpp-rata-rata-v1' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))>0 and position('s.qty<-x.selisih' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))>0,'S0 tanda tambalan baru ada dan tanda migrasi lama (surplus HPP, hitung ulang) tetap ada');
select pg_temp.ok(not exists(select 1 from pg_trigger t where t.tgrelid='public.opname_count_baselines'::regclass and t.tgname='zz_admin_online_write_fence') is false and exists(select 1 from pg_policy where polrelid='public.opname_count_baselines'::regclass and polname='admin_online_fence_r'),'S0 pagar Admin Online (fence_all) mencakup tabel baseline');

-- ═════════ barang & lapisan ═════════
select pg_temp.mk(c,s,b) from (values('ma',6500,0),('mk',6500,0),('sd',1000,0),('sf',1000,0),('sg',1000,0),('sr',1000,0),('sr2',1000,0),('sr3',1000,0),('st',1000,0),('st2',1000,0),
 ('sn',1000,0),('sn2',1000,0),('sn3',1000,0),('su',1000,0),('su2',1000,0),('su3',1000,0),('sb',1000,0),('sb2',1000,0),('sb3',1000,0),('sk1',150,0),('sk2',150,0),('sk3',150,0),
 ('sj1',1000,0),('sj2',1000,0),('si',1000,0),('sc',1000,0),('sx',1000,0),('sz',1000,0),('sy',1000,0),('sp',1000,0),('sq1',1000,0),('sq2',1000,0)) v(c,s,b);
select pg_temp.lay('ma',11,5553.33);select pg_temp.lay('mk',1,5553.33);
select pg_temp.lay('sd',11,100);
select pg_temp.lay('sf',4,100,9);select pg_temp.lay('sf',7,120,8);
select pg_temp.lay('sg',11,100);
select pg_temp.lay('sr',10,100);select pg_temp.lay('sr2',10,100);select pg_temp.lay('sr3',10,100);
select pg_temp.lay('st',10,100);select pg_temp.lay('st2',10,100);
select pg_temp.lay('sn',5,60);select pg_temp.lay('sn2',5,60);select pg_temp.lay('sn3',5,60);
select pg_temp.lay('su',10,100);select pg_temp.lay('su2',10,100);select pg_temp.lay('su3',10,100);
select pg_temp.lay('sb',10,100);select pg_temp.lay('sb2',10,100);select pg_temp.lay('sb3',10,100);
select pg_temp.lay('sk1',11,100);select pg_temp.lay('sk2',11,100);select pg_temp.lay('sk3',10,100);
select pg_temp.lay('sj1',10,100);select pg_temp.lay('sj2',10,50);
select pg_temp.lay('si',6,80);select pg_temp.lay('sc',3,60);select pg_temp.lay('sx',10,100);select pg_temp.lay('sz',10,100);select pg_temp.lay('sy',10,100);select pg_temp.lay('sp',10,100);
select pg_temp.lay('sq1',10,100);select pg_temp.lay('sq2',10,100);

-- ═════════ S1 KASUS PERSIS OPR.00012: Meo Pouch Adult (foto 11) dan Kitten (foto 1) ═════════
do $$begin perform pg_temp.ord('s1');end$$;
select pg_temp.lock('s1','ma',10);select pg_temp.lock('s1','mk',0);
select pg_temp.ok(pg_temp.cq('s1','ma')=11 and pg_temp.cq('s1','mk')=1,'S1 kunci pertama: foto = stok saat itu (Adult 11, Kitten 1); angka ngawur 999999 dari klien ditimpa server');
select pg_temp.ok(pg_temp.bq('s1','ma') is null and pg_temp.bq('s1','mk') is null,'S1 belum ada baseline tersimpan selama barang masih terkunci (barisnya sendiri adalah fotonya)');
select pg_temp.sale('ma',11,'POS-20261124-0048');select pg_temp.sale('mk',1,'POS-20261124-0048');
select pg_temp.ok(pg_temp.sq('ma')=0 and pg_temp.sq('mk')=0 and pg_temp.cq('s1','ma')=11,'S1 penjualan POS-20261124-0048 (Adult 11 + Kitten 1) mengosongkan stok; foto terkunci tetap 11');
create temp table s1n as select (select count(*) from public.opname_results) results,(select count(*) from public.journal_entries) journals,(select count(*) from public.stock_moves) moves;grant all on s1n to public;
select pg_temp.ok(pg_temp.tryp('s1') like 'Hitungan barang berikut perlu diulang%Barang ma (dihitung 10, stok saat dikunci 11, sejak itu berubah -11, stok sekarang 0)%Barang mk (dihitung 0, stok saat dikunci 1, sejak itu berubah -1, stok sekarang 0)%','S1 simpan: hitungan 10/0 lebih kecil dari stok yang tersisa 0 -> "perlu diulang" dengan foto, perubahan sejak itu, dan stok sekarang');
select pg_temp.ok(pg_temp.tryp('s1') like '%isi rak PADA SAAT barang pertama kali dikunci%' and pg_temp.tryp('s1') like '%Penyesuaian Persediaan%','S1 pesan penolakan menjelaskan arti hitungan (isi rak saat dikunci pertama) dan jalan keluar (Penyesuaian Persediaan)');
select pg_temp.ok((select count(*) from public.opname_results)=(select results from s1n) and (select count(*) from public.journal_entries)=(select journals from s1n) and (select count(*) from public.stock_moves)=(select moves from s1n) and (select status::text from public.opname_orders where id=pg_temp.oid('s1'))='Terbuka','S1 penolakan tidak menulis apa pun (hasil, jurnal, mutasi, status tetap Terbuka)');
-- staf menekan Buka lalu mengunci ulang "mengikuti sistem" (11 / 1) setelah penjualan: inilah yang dulu membuat selisih lebih palsu
select pg_temp.buka('s1','ma');select pg_temp.buka('s1','mk');
select pg_temp.ok(pg_temp.bq('s1','ma')=11 and pg_temp.bq('s1','mk')=1 and pg_temp.cq('s1','ma') is null,'S1 Buka: foto pertama (11 / 1) disimpan di baseline, baris kunci dihapus');
select pg_temp.lock('s1','ma',11);select pg_temp.lock('s1','mk',1);
select pg_temp.ok(pg_temp.cq('s1','ma')=11 and pg_temp.cq('s1','mk')=1,'S1 kunci ulang sesudah penjualan: foto TETAP 11 / 1 (dulu 0 / 0 = akar selisih lebih palsu)');
select pg_temp.ok(pg_temp.bq('s1','ma')=11 and pg_temp.bq('s1','mk')=1,'S1 baseline tidak bergeser oleh kunci ulang');
select pg_temp.ok(pg_temp.post('s1') ? 'no_hasil','S1 SIMPAN BERHASIL: hitungan 11 / 1 mengikuti sistem');
select pg_temp.ok(pg_temp.ri('s1','ma')->>'selisih'='0' and (pg_temp.ri('s1','ma')->>'qty_sistem')::numeric=11 and (pg_temp.ri('s1','ma')->>'qty_fisik')::numeric=11,'S1 Adult: qty_sistem 11, qty_fisik 11, selisih 0 (bukan +11)');
select pg_temp.ok((pg_temp.ri('s1','mk')->>'selisih')::numeric=0 and (pg_temp.ri('s1','mk')->>'qty_sistem')::numeric=1 and (pg_temp.ri('s1','mk')->>'qty_fisik')::numeric=1,'S1 Kitten: qty_sistem 1, qty_fisik 1, selisih 0 (bukan +1)');
select pg_temp.ok(pg_temp.sq('ma')=0 and pg_temp.sq('mk')=0,'S1 stok sesudah simpan tetap 0 / 0 (stok sekarang + selisih 0), bukan 11 / 1');
select pg_temp.ok(pg_temp.jcount('opname',pg_temp.ref('s1'))=0 and jsonb_array_length(pg_temp.rr('s1')->'journal_ids')=0,'S1 TIDAK ADA jurnal selisih (tanpa selisih lebih palsu dan tanpa kurang)');
select pg_temp.ok(pg_temp.opmoves(pg_temp.ref('s1'),'ma')=0 and pg_temp.opmoves(pg_temp.ref('s1'),'mk')=0 and not exists(select 1 from public.stock_layers where source='opname' and source_ref=pg_temp.ref('s1')),'S1 tidak ada mutasi/lapisan opname (kartu stok bersih)');
select pg_temp.ok(pg_temp.n(pg_temp.rr('s1'),'surplus_value')=0 and pg_temp.n(pg_temp.rr('s1'),'shortage_value')=0 and pg_temp.n(pg_temp.rr('s1'),'net_variance')=0 and pg_temp.rr('s1')->'surplus_unpriced'='[]'::jsonb,'S1 kuitansi: lebih 0, kurang 0, neto 0');
select pg_temp.ok((pg_temp.rr('s1')->>'bergerak_sejak_hitung')::int=2 and jsonb_array_length((select source_snapshot->'sejak_hitung' from public.opname_posting_receipts where result_id=pg_temp.rid('s1')))=2,'S1 kuitansi: 2 barang bergerak sejak dihitung (dihitung otomatis)');
select pg_temp.ok((pg_temp.moved('s1','ma')->>'gerak')::numeric=-11 and (pg_temp.moved('s1','ma')->>'qty_sistem')::numeric=11 and (pg_temp.moved('s1','ma')->>'stok_sekarang')::numeric=0 and pg_temp.rc('s1')->>'baseline_rule'='kunci-pertama-v1','S1 jejak: Adult foto 11, stok sekarang 0, gerak -11; aturan kunci-pertama-v1 tercatat');
select pg_temp.ok((select status::text from public.opname_orders where id=pg_temp.oid('s1'))='Selesai','S1 perintah opname Selesai');
select pg_temp.ok((select count(*) from public.opname_posting_receipts r cross join lateral jsonb_array_elements(r.source_snapshot->'price_report'->'rows') e where r.result_id=pg_temp.rid('s1') and (e->>'qty_sistem')::numeric=11 and (e->>'qty_fisik')::numeric=11 and (e->>'selisih')::numeric=0)=1,'S1 laporan harga opname: baris Adult 11 / 11 / selisih 0');

-- S1b: hitungan 10 (kurang 1) sesudah semua terjual -> kekurangan nyata, tetapi tidak ada stok yang bisa dikurangi -> ditolak (tidak pernah stok negatif baru)
do $$begin perform pg_temp.ord('s1b');end$$;
select pg_temp.mk('s1x',1000,0);select pg_temp.lay('s1x',11,100);
select pg_temp.lock('s1b','s1x',10);select pg_temp.sale('s1x',11,'POS-S1B');
select pg_temp.ok(pg_temp.tryp('s1b') like 'Hitungan barang berikut perlu diulang%Barang s1x (dihitung 10, stok saat dikunci 11, sejak itu berubah -11, stok sekarang 0)%','S1b foto 11, terjual 11, hitungan 10: kekurangan nyata 1 tetapi stok 0 -> ditolak, bukan stok -1');
select pg_temp.buka('s1b','s1x');select pg_temp.lock('s1b','s1x',10);
select pg_temp.ok(pg_temp.cq('s1b','s1x')=11,'S1b kunci ulang 10 memakai foto 11 (selisih -1 tetap terbaca benar)');
select pg_temp.ok(pg_temp.tryp('s1b') like 'Hitungan barang berikut perlu diulang%','S1b tetap ditolak sesudah kunci ulang: selisih kurang 1 > stok 0 (tidak ada stok negatif)');
select pg_temp.ok(pg_temp.sq('s1x')=0 and not exists(select 1 from public.opname_results r join public.opname_orders o on o.id=r.order_id where o.no_opname='OPO.CS.s1b'),'S1b tidak ada hasil, stok tetap 0');
-- jalan keluar yang diarahkan pesan: Buka tanpa hitung ulang -> barang itu dilewati
select pg_temp.buka('s1b','s1x');
select pg_temp.ok(pg_temp.post('s1b','{"sq1":10}') ? 'no_hasil' and not exists(select 1 from public.opname_result_items where result_id=pg_temp.rid('s1b') and item_id=pg_temp.iid('s1x')) and pg_temp.sq('s1x')=0,'S1b sesudah Buka tanpa hitung ulang barang itu dilewati: sisanya tersimpan, stok barang itu tidak berubah');

-- ═════════ S2 kekurangan nyata dengan penjualan di antaranya (foto 11, terjual 5, hitungan 10) ═════════
do $$begin perform pg_temp.ord('s2');end$$;
select pg_temp.lock('s2','sd',10);select pg_temp.sale('sd',5);
select pg_temp.ok(pg_temp.sq('sd')=6,'S2 prasyarat: stok 11 -> 6 setelah penjualan 5');
select pg_temp.ok(pg_temp.post('s2') ? 'no_hasil','S2 simpan berhasil');
select pg_temp.ok((pg_temp.ri('s2','sd')->>'qty_sistem')::numeric=11 and (pg_temp.ri('s2','sd')->>'qty_fisik')::numeric=10 and (pg_temp.ri('s2','sd')->>'selisih')::numeric=-1,'S2 selisih nyata -1 (hitungan 10 - foto 11), bukan 10 - 6 = +4');
select pg_temp.ok(pg_temp.sq('sd')=5,'S2 stok akhir = stok sekarang 6 + selisih -1 = 5');
select pg_temp.ok(pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s2')),'720010')=100 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s2')),'170001')=-100 and pg_temp.jcount('opname',pg_temp.ref('s2'))=1,'S2 satu jurnal: Dr 720010 100 / Cr 170001 100 (1 unit FIFO 100)');
select pg_temp.ok((select qty from public.stock_moves where source='opname' and source_ref=pg_temp.ref('s2') and item_id=pg_temp.iid('sd'))=-1 and pg_temp.lsum('sd')=5,'S2 satu mutasi -1; lapisan tersisa 5 = stok');
select pg_temp.ok(pg_temp.n(pg_temp.rr('s2'),'shortage_value')=100 and (pg_temp.rr('s2')->>'bergerak_sejak_hitung')::int=1 and (pg_temp.moved('s2','sd')->>'gerak')::numeric=-5,'S2 kuitansi: kurang 100, 1 barang bergerak (gerak -5)');
select pg_temp.ok(pg_temp.balanced('opname',pg_temp.ref('s2')),'S2 jurnal seimbang');
-- S2b: FIFO menghormati penjualan di antaranya (lapisan 4@100 + 7@120; terjual 6 = 4@100 + 2@120; kurang 1 diambil dari 120)
do $$begin perform pg_temp.ord('s2b');end$$;
select pg_temp.lock('s2b','sf',10);select pg_temp.sale('sf',6);
select pg_temp.ok(pg_temp.post('s2b') ? 'no_hasil' and pg_temp.sq('sf')=4,'S2b simpan berhasil, stok 5 - 1 = 4');
select pg_temp.ok(pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s2b')),'720010')=120 and (select unit_cost from public.stock_moves where source='opname' and source_ref=pg_temp.ref('s2b') and item_id=pg_temp.iid('sf'))=120,'S2b kekurangan dinilai lapisan 120 (lapisan 100 sudah habis terjual di antaranya)');
select pg_temp.ok(pg_temp.lsum('sf')=4 and (select count(*) from public.stock_layers where item_id=pg_temp.iid('sf') and unit_cost=100 and qty_left=0)=1,'S2b lapisan 100 habis, sisa 4 unit pada 120');

-- ═════════ S3 selisih lebih dengan penjualan di antaranya (foto 11, terjual 11, hitungan 12) ═════════
do $$begin perform pg_temp.ord('s3');end$$;
select pg_temp.lock('s3','sg',12);select pg_temp.sale('sg',11);
select pg_temp.ok(pg_temp.post('s3') ? 'no_hasil','S3 simpan berhasil');
select pg_temp.ok((pg_temp.ri('s3','sg')->>'selisih')::numeric=1 and (pg_temp.ri('s3','sg')->>'qty_sistem')::numeric=11 and pg_temp.sq('sg')=1,'S3 selisih +1 (12 - 11), stok akhir 0 + 1 = 1');
select pg_temp.ok(pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s3')),'170001')=100 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s3')),'810004')=-100 and pg_temp.jcount('opname',pg_temp.ref('s3'))=1 and pg_temp.balanced('opname',pg_temp.ref('s3')),'S3 jurnal lebih: Dr 170001 100 / Cr 810004 100 (HPP rata-rata/harga masuk terakhir 100)');
select pg_temp.ok((select unit_cost from public.stock_layers where source='opname' and source_ref=pg_temp.ref('s3') and item_id=pg_temp.iid('sg'))=100 and pg_temp.lsum('sg')=1,'S3 lapisan opname 1 unit @100 (PR #580)');

-- ═════════ S4 barang MASUK di antaranya (terima permintaan / PO) ═════════
do $$begin perform pg_temp.ord('s4');end$$;
select pg_temp.lock('s4','sr',10);select pg_temp.lock('s4','sr2',8);select pg_temp.lock('s4','sr3',12);
select pg_temp.recv('sr',20,130);select pg_temp.recv('sr2',20,130);select pg_temp.recv('sr3',20,130);
select pg_temp.ok(pg_temp.sq('sr')=30 and pg_temp.sq('sr2')=30 and pg_temp.sq('sr3')=30,'S4 prasyarat: stok masing-masing 30 sesudah penerimaan 20');
select pg_temp.ok(pg_temp.post('s4') ? 'no_hasil','S4 simpan berhasil');
select pg_temp.ok((pg_temp.ri('s4','sr')->>'selisih')::numeric=0 and pg_temp.sq('sr')=30 and pg_temp.opmoves(pg_temp.ref('s4'),'sr')=0,'S4 hitungan 10 = foto 10: selisih 0, stok tetap 30 (penerimaan tidak jadi "selisih lebih")');
select pg_temp.ok((pg_temp.ri('s4','sr2')->>'selisih')::numeric=-2 and pg_temp.sq('sr2')=28,'S4 hitungan 8 vs foto 10: kurang 2, stok 30 - 2 = 28');
select pg_temp.ok((pg_temp.ri('s4','sr3')->>'selisih')::numeric=2 and pg_temp.sq('sr3')=32,'S4 hitungan 12 vs foto 10: lebih 2, stok 30 + 2 = 32');
select pg_temp.ok((select unit_cost from public.stock_moves where source='opname' and source_ref=pg_temp.ref('s4') and item_id=pg_temp.iid('sr2'))=100,'S4 kurang 2 diambil dari lapisan tertua (100), bukan dari penerimaan baru (130)');
select pg_temp.ok((pg_temp.moved('s4','sr')->>'gerak')::numeric=20 and (pg_temp.rr('s4')->>'bergerak_sejak_hitung')::int=3,'S4 jejak: 3 barang bergerak (+20 masing-masing)');
select pg_temp.ok(pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s4')),'170001')=(select sum(m.qty*m.unit_cost) from public.stock_moves m where m.source='opname' and m.source_ref=pg_temp.ref('s4')) and pg_temp.balanced('opname',pg_temp.ref('s4')) and pg_temp.jcount('opname',pg_temp.ref('s4'))=1,'S4 jurnal neto satu dokumen = nilai mutasi stok, seimbang');

-- ═════════ S5 transfer keluar/masuk di antaranya ═════════
do $$begin perform pg_temp.ord('s5');end$$;
select pg_temp.lock('s5','st',10);select pg_temp.lock('s5','st2',9);
select pg_temp.sale('st',4,'TRF-OUT-1');select pg_temp.recv('st',1,100,'transfer-in');
select pg_temp.sale('st2',4,'TRF-OUT-2');
select pg_temp.ok(pg_temp.sq('st')=7 and pg_temp.sq('st2')=6,'S5 prasyarat: st 10-4+1=7; st2 10-4=6');
select pg_temp.ok(pg_temp.post('s5') ? 'no_hasil','S5 simpan berhasil');
select pg_temp.ok((pg_temp.ri('s5','st')->>'selisih')::numeric=0 and pg_temp.sq('st')=7,'S5 transfer keluar 4 dan masuk 1 tidak dianggap selisih (hitungan 10 = foto 10)');
select pg_temp.ok((pg_temp.ri('s5','st2')->>'selisih')::numeric=-1 and pg_temp.sq('st2')=5,'S5 hitungan 9 vs foto 10: kurang 1; stok 6 - 1 = 5');
select pg_temp.ok((pg_temp.moved('s5','st')->>'gerak')::numeric=-3 and (pg_temp.moved('s5','st2')->>'gerak')::numeric=-4,'S5 jejak gerak: st -3 (transfer netto), st2 -4');

-- ═════════ S6 stok sekarang negatif / penjualan lebih besar dari hitungan ═════════
do $$begin perform pg_temp.ord('s6');end$$;
select pg_temp.lock('s6','sn',5);select pg_temp.lock('s6','sn2',6);
select pg_temp.sale('sn',8);select pg_temp.sale('sn2',8);
select pg_temp.ok(pg_temp.sq('sn')=-3 and pg_temp.sq('sn2')=-3 and pg_temp.lsum('sn')=0,'S6 prasyarat: dijual 8 padahal stok 5 -> stok sistem -3, lapisan habis');
select pg_temp.ok(pg_temp.post('s6') ? 'no_hasil','S6 simpan berhasil walau stok sekarang minus');
select pg_temp.ok((pg_temp.ri('s6','sn')->>'selisih')::numeric=0 and pg_temp.sq('sn')=-3 and pg_temp.opmoves(pg_temp.ref('s6'),'sn')=0,'S6 hitungan 5 = foto 5: selisih 0, stok tetap -3 (tidak menjadi 5, tidak memperburuk minus)');
select pg_temp.ok((pg_temp.ri('s6','sn2')->>'selisih')::numeric=1 and pg_temp.sq('sn2')=-2 and pg_temp.lsum('sn2')=0,'S6 hitungan 6 vs foto 5: +1 menutup sebagian minus: stok -3 + 1 = -2, tanpa lapisan fisik');
select pg_temp.ok(pg_temp.jcount('opname',pg_temp.ref('s6'))=1 and pg_temp.balanced('opname',pg_temp.ref('s6')),'S6 jurnal seimbang');
do $$begin perform pg_temp.ord('s6b');end$$;
select pg_temp.lock('s6b','sn3',4);select pg_temp.sale('sn3',8);
select pg_temp.ok(pg_temp.sq('sn3')=-3,'S6b prasyarat: sn3 foto 5, dijual 8 -> -3');
select pg_temp.ok(pg_temp.tryp('s6b') like 'Hitungan barang berikut perlu diulang%Barang sn3 (dihitung 4, stok saat dikunci 5, sejak itu berubah -8, stok sekarang -3)%','S6b hitungan 4 (kurang 1) sedangkan penjualan melebihi hitungan: ditolak, tidak membuat stok lebih negatif');
select pg_temp.ok(pg_temp.sq('sn3')=-3,'S6b stok tidak berubah');

-- ═════════ S7 hitungan BELUM dikunci ═════════
do $$begin perform pg_temp.ord('s7');end$$;
select pg_temp.sale('su',3,'POS-S7');
select pg_temp.ok(pg_temp.tryp('s7','{"su":7}') like 'Barang berikut belum dikunci dan stoknya sudah bergerak%Barang su%Tekan Kunci%','S7 diisi tapi belum dikunci dan stok sudah bergerak sejak SO mulai -> ditolak "tekan Kunci" menyebut barangnya');
select pg_temp.ok((select count(*) from public.opname_results r join public.opname_orders o on o.id=r.order_id where o.no_opname='OPO.CS.s7')=0 and pg_temp.sq('su')=7,'S7 penolakan tidak menulis apa pun');
select pg_temp.ok(pg_temp.tryp('s7','{"su2":10}')='OK','S7 belum dikunci TAPI tidak ada gerakan sejak SO mulai: diterima (baseline = stok sekarang, sama dengan perilaku lama)');
select pg_temp.lock('s7','su',7);
select pg_temp.ok(pg_temp.cq('s7','su')=7,'S7 sesudah dikunci: foto = stok saat dikunci 7 (jam hitung tercatat)');
select pg_temp.ok(pg_temp.post('s7','{"su":7,"su2":9}') ? 'no_hasil','S7 simpan berhasil (su terkunci, su2 diisi tanpa gerakan)');
select pg_temp.ok((pg_temp.ri('s7','su')->>'selisih')::numeric=0 and (pg_temp.ri('s7','su2')->>'selisih')::numeric=-1 and (pg_temp.ri('s7','su2')->>'qty_sistem')::numeric=10 and pg_temp.sq('su2')=9,'S7 su2 (tanpa kunci, tanpa gerak): foto = stok sekarang 10, hitungan 9 -> kurang 1');
-- S7b: pernah dikunci lalu dibuka dan diisi lagi tanpa dikunci -> memakai foto pertama walau stok bergerak
do $$begin perform pg_temp.ord('s7b');end$$;
select pg_temp.lock('s7b','su3',10);select pg_temp.buka('s7b','su3');select pg_temp.sale('su3',2,'POS-S7B');
select pg_temp.ok(pg_temp.tryp('s7b','{"su3":10}')='OK','S7b barang pernah dikunci (foto pertama ada): diisi tanpa kunci ulang diterima walau stok bergerak');
select pg_temp.ok(pg_temp.post('s7b','{"su3":10}') ? 'no_hasil' and (pg_temp.ri('s7b','su3')->>'qty_sistem')::numeric=10 and (pg_temp.ri('s7b','su3')->>'selisih')::numeric=0 and pg_temp.sq('su3')=8,'S7b baseline = foto pertama 10 (bukan stok 8): selisih 0, stok tetap 8');

-- ═════════ S8 Buka/kunci ulang berkali-kali ═════════
do $$begin perform pg_temp.ord('s8');end$$;
select pg_temp.lock('s8','sb',10);select pg_temp.buka('s8','sb');select pg_temp.sale('sb',3,'POS-S8');select pg_temp.lock('s8','sb',7);
select pg_temp.ok(pg_temp.cq('s8','sb')=10 and pg_temp.bq('s8','sb')=10,'S8 Buka -> jual 3 -> kunci ulang: foto tetap 10');
select pg_temp.buka('s8','sb');select pg_temp.recv('sb',2,100);select pg_temp.lock('s8','sb',10);
select pg_temp.ok(pg_temp.cq('s8','sb')=10 and pg_temp.bq('s8','sb')=10,'S8 Buka lagi -> terima 2 -> kunci ulang: foto tetap 10 (yang pertama menang)');
select pg_temp.ok(pg_temp.post('s8') ? 'no_hasil' and (pg_temp.ri('s8','sb')->>'selisih')::numeric=0 and pg_temp.sq('sb')=9,'S8 hitungan 10 = foto 10: selisih 0; stok 10-3+2 = 9 utuh');
-- tidak ada yang bergerak: kunci ulang dengan angka lain = sama dengan kunci langsung
do $$begin perform pg_temp.ord('s8b');end$$;
select pg_temp.lock('s8b','sb2',10);select pg_temp.buka('s8b','sb2');select pg_temp.lock('s8b','sb2',12);
select pg_temp.ok(pg_temp.cq('s8b','sb2')=10 and pg_temp.post('s8b') ? 'no_hasil' and (pg_temp.ri('s8b','sb2')->>'selisih')::numeric=2 and pg_temp.sq('sb2')=12,'S8b tanpa gerakan: Buka + hitungan 12 -> +2, stok 12 (identik dengan kunci langsung)');
-- tabel baseline tidak diubah oleh barang yang dikunci sekali saja
do $$begin perform pg_temp.ord('s8c');end$$;
select pg_temp.lock('s8c','sb3',10);
select pg_temp.ok(pg_temp.bq('s8c','sb3') is null,'S8c barang dikunci sekali (tanpa Buka): tidak ada baris baseline');
select pg_temp.ok((select count(*) from public.opname_count_baselines where order_id=pg_temp.oid('s8'))=1 and (select first_locked_at from public.opname_count_baselines where order_id=pg_temp.oid('s8'))<=now(),'S8 tepat satu baris baseline per (opname, barang) dengan jam kunci pertama');

-- ═════════ S9 hak klien pada opname_counts ═════════
do $$begin perform pg_temp.ord('s9');end$$;
select pg_temp.ok(pg_temp.cl('insert into public.opname_counts(order_id,item_id,qty_fisik,qty_sistem) values('''||pg_temp.oid('s9')||''','''||pg_temp.iid('sx')||''',9,12345)')='OK' and pg_temp.cq('s9','sx')=10,'S9 klien (authenticated) mengunci dengan qty_sistem palsu 12345: tersimpan stok sebenarnya 10');
select pg_temp.ok(pg_temp.cl('update public.opname_counts set qty_sistem=0 where order_id='''||pg_temp.oid('s9')||''' and item_id='''||pg_temp.iid('sx')||'''') like 'Foto stok hitungan opname tidak boleh diubah%','S9 klien tidak boleh mengubah qty_sistem baris yang ada');
select pg_temp.ok(pg_temp.cl('update public.opname_counts set locked_at=now()+interval ''1 day'' where order_id='''||pg_temp.oid('s9')||''' and item_id='''||pg_temp.iid('sx')||'''') like 'Foto stok hitungan opname tidak boleh diubah%','S9 klien tidak boleh mengubah locked_at');
select pg_temp.ok(pg_temp.cl('update public.opname_counts set item_id='''||pg_temp.iid('sz')||''' where order_id='''||pg_temp.oid('s9')||''' and item_id='''||pg_temp.iid('sx')||'''') like 'Foto stok hitungan opname tidak boleh diubah%','S9 klien tidak boleh memindahkan baris ke barang lain');
select pg_temp.ok(pg_temp.cl('update public.opname_counts set qty_fisik=8 where order_id='''||pg_temp.oid('s9')||''' and item_id='''||pg_temp.iid('sx')||'''')='OK','S9 klien boleh mengubah qty_fisik');
select pg_temp.ok((select qty_fisik from public.opname_counts where order_id=pg_temp.oid('s9') and item_id=pg_temp.iid('sx'))=8 and pg_temp.cq('s9','sx')=10,'S9 qty_fisik berubah menjadi 8 dan foto tetap 10');
select pg_temp.ok(pg_temp.cl('select count(*) from public.opname_count_baselines') like 'permission denied%','S9 klien tidak bisa membaca tabel baseline');
select pg_temp.ok(pg_temp.cl('insert into public.opname_count_baselines(order_id,item_id,qty_sistem,first_locked_at) values('''||pg_temp.oid('s9')||''','''||pg_temp.iid('sz')||''',1,now())') like 'permission denied%','S9 klien tidak bisa menulis baseline');
select pg_temp.ok(pg_temp.cl('delete from public.opname_count_baselines') like 'permission denied%' and pg_temp.cl('update public.opname_count_baselines set qty_sistem=1') like 'permission denied%','S9 klien tidak bisa mengubah/menghapus baseline');
select pg_temp.ok(pg_temp.cl('select public.opname_counts_tetapkan_baseline()') like 'permission denied%' and pg_temp.cl('select public.opname_counts_simpan_baseline()') like 'permission denied%' and pg_temp.cl('select public.opname_counts_beku_foto()') like 'permission denied%','S9 klien tidak bisa memanggil fungsi trigger');
select pg_temp.ok(pg_temp.cl('delete from public.opname_counts where order_id='''||pg_temp.oid('s9')||''' and item_id='''||pg_temp.iid('sx')||'''')='OK' and pg_temp.bq('s9','sx')=10,'S9 klien menekan Buka (DELETE): foto pertama tersimpan walau penghapus tidak punya hak pada tabel baseline');
select pg_temp.ok(pg_temp.cl('insert into public.opname_counts(order_id,item_id,qty_fisik,qty_sistem) values('''||pg_temp.oid('s9')||''','''||pg_temp.iid('sx')||''',9,1)')='OK' and pg_temp.cq('s9','sx')=10,'S9 klien kunci ulang dengan qty_sistem palsu 1: tersimpan foto pertama 10');
select pg_temp.sale('sx',4,'POS-S9');
select pg_temp.ok(pg_temp.cl('delete from public.opname_counts where order_id='''||pg_temp.oid('s9')||''' and item_id='''||pg_temp.iid('sx')||'''')='OK' and pg_temp.cl('insert into public.opname_counts(order_id,item_id,qty_fisik,qty_sistem) values('''||pg_temp.oid('s9')||''','''||pg_temp.iid('sx')||''',10,0)')='OK' and pg_temp.cq('s9','sx')=10 and pg_temp.sq('sx')=6,'S9 klien Buka + kunci ulang sesudah penjualan 4: foto tetap 10 (stok sekarang 6)');
select pg_temp.ok(pg_temp.post('s9') ? 'no_hasil' and (pg_temp.ri('s9','sx')->>'selisih')::numeric=0 and pg_temp.sq('sx')=6,'S9 simpan: selisih 0, stok 6 utuh');
select pg_temp.ok(pg_temp.cl('delete from public.opname_counts where order_id='''||pg_temp.oid('s9')||'''') like '%Opname tidak terbuka%','S9 sesudah Selesai klien tidak bisa menghapus hitungan (pagar lama tetap)');
select pg_temp.ok(pg_temp.cl('insert into public.opname_counts(order_id,item_id,qty_fisik) values('''||pg_temp.oid('s9')||''','''||pg_temp.iid('sz')||''',1)') like '%Opname tidak terbuka%','S9 sesudah Selesai klien tidak bisa menambah hitungan');

-- ═════════ S10 kasbon neto memakai selisih yang benar ═════════
do $$begin perform pg_temp.ord('s10');end$$;
-- kasus OPR.00012 + kekurangan nyata di dokumen yang sama
select pg_temp.lock('s10','sk1',10);select pg_temp.sale('sk1',5);       -- kurang 1 nyata (jual 150, HPP 100)
select pg_temp.lock('s10','sk2',11);select pg_temp.buka('s10','sk2');select pg_temp.sale('sk2',11);select pg_temp.lock('s10','sk2',11);   -- Adult-like: selisih 0
select pg_temp.lock('s10','sk3',8);                                    -- kurang 2 nyata (tanpa gerak)
select pg_temp.ok(pg_temp.post('s10') ? 'no_hasil','S10 simpan dokumen campuran (kurang nyata + Adult-like) berhasil');
select pg_temp.ok(pg_temp.n(public.opname_variance_charge_basis(pg_temp.rid('s10')),'jual_kurang')=450 and pg_temp.n(public.opname_variance_charge_basis(pg_temp.rid('s10')),'jual_lebih')=0 and pg_temp.n(public.opname_variance_charge_basis(pg_temp.rid('s10')),'jual_total')=450,'S10 dasar beban: kurang 3 unit x 150 = 450, lebih 0 (tanpa +11 palsu yang dulu mengurangi beban karyawan)');
select pg_temp.ok((public.opname_variance_charge_basis(pg_temp.rid('s10'))->>'minus_count')::int=2 and (public.opname_variance_charge_basis(pg_temp.rid('s10'))->>'plus_count')::int=0 and public.opname_variance_charge_basis(pg_temp.rid('s10'))->'refuse'='null'::jsonb,'S10 dasar beban: 2 barang kurang, tanpa barang lebih, tidak ditolak');
select pg_temp.ok(pg_temp.n(public.opname_variance_charge_basis(pg_temp.rid('s10')),'hpp_total')=300,'S10 HPP kurang 300 (3 x 100 FIFO) = jurnal');
select pg_temp.ok(pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s10')),'720010')=300 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s10')),'170001')=-300 and pg_temp.jcount('opname',pg_temp.ref('s10'))=1,'S10 jurnal opname: Dr 720010 300 / Cr 170001 300 (hanya kurang nyata)');
do $$declare r jsonb;begin perform pg_temp.as_(pg_temp.owner());
 r:=public.charge_opname_variance_to_employees(pg_temp.rid('s10'),jsonb_build_array(jsonb_build_object('employee_id',pg_temp.e(1),'amount',300),jsonb_build_object('employee_id',pg_temp.e(2),'amount',150)),'Selisih stok CS uji',gen_random_uuid());
 insert into res values('s10ch',r);end$$;
select pg_temp.ok(pg_temp.n(pg_temp.rr('s10ch'),'total')=450,'S10 beban 450 dibagi 300 + 150 diterima');
select pg_temp.ok(pg_temp.n(pg_temp.gl('opname-beban-karyawan',pg_temp.ref('s10')),'182001')=450 and pg_temp.n(pg_temp.gl('opname-beban-karyawan',pg_temp.ref('s10')),'720010')=-300 and pg_temp.n(pg_temp.gl('opname-beban-karyawan',pg_temp.ref('s10')),'810004')=-150,'S10 jurnal beban: Dr 182001 450 / Cr 720010 300 / Cr 810004 150');
-- SO yang hanya Adult-like: tidak ada yang bisa dibebankan
do $$begin perform pg_temp.ord('s10b');end$$;
select pg_temp.mk('sk4',150,0);select pg_temp.lay('sk4',11,100);
select pg_temp.lock('s10b','sk4',11);select pg_temp.buka('s10b','sk4');select pg_temp.sale('sk4',11);select pg_temp.lock('s10b','sk4',11);
select pg_temp.post('s10b');
select pg_temp.ok(public.opname_variance_charge_basis(pg_temp.rid('s10b'))->'refuse'->>'code'='TANPA_KURANG','S10b SO hanya Adult-like: dasar beban "tanpa kurang" (dulu lebih +11 palsu)');

-- ═════════ S11 jurnal neto per dokumen dengan gerakan di antaranya ═════════
do $$begin perform pg_temp.ord('s11');end$$;
select pg_temp.lock('s11','sj1',8);select pg_temp.lock('s11','sj2',13);
select pg_temp.sale('sj1',3);select pg_temp.recv('sj2',5,70);
select pg_temp.ok(pg_temp.post('s11') ? 'no_hasil','S11 simpan campuran kurang 2 (sj1) dan lebih 3 (sj2) berhasil');
select pg_temp.ok(pg_temp.jcount('opname',pg_temp.ref('s11'))=1 and pg_temp.balanced('opname',pg_temp.ref('s11')),'S11 TEPAT satu jurnal neto per dokumen, seimbang');
select pg_temp.ok((pg_temp.ri('s11','sj1')->>'selisih')::numeric=-2 and (pg_temp.ri('s11','sj2')->>'selisih')::numeric=3 and pg_temp.sq('sj1')=5 and pg_temp.sq('sj2')=18,'S11 selisih benar (-2 / +3); stok akhir sj1 7-2=5, sj2 15+3=18');
select pg_temp.ok(pg_temp.n(pg_temp.rr('s11'),'shortage_value')=200 and pg_temp.n(pg_temp.rr('s11'),'surplus_value')=170 and pg_temp.n(pg_temp.rr('s11'),'surplus_offset')=170 and pg_temp.n(pg_temp.rr('s11'),'net_variance')=30,'S11 kuitansi: kurang 200, lebih 170 (3 x rata-rata 56,6667 dari lapisan 10@50 + 5@70), neto kurang 30');
select pg_temp.ok(pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s11')),'720010')=30 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s11')),'170001')=-30 and not (pg_temp.gl('opname',pg_temp.ref('s11')) ? '810004'),'S11 jurnal neto: beban 720010 30, persediaan -30, tanpa 810004');
select pg_temp.ok(round((select sum(m.qty*m.unit_cost) from public.stock_moves m where m.source='opname' and m.source_ref=pg_temp.ref('s11')),2)=pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s11')),'170001'),'S11 nilai mutasi stok opname = mutasi akun persediaan');

-- ═════════ S12 idempotensi ═════════
do $$begin perform pg_temp.ord('s12');end$$;
select pg_temp.lock('s12','si',5);select pg_temp.sale('si',2);
select pg_temp.post('s12','{"si":5}');
select pg_temp.ok((select count(*) from public.opname_results where order_id=pg_temp.oid('s12'))=1 and pg_temp.jcount('opname',pg_temp.ref('s12'))=1 and (pg_temp.ri('s12','si')->>'selisih')::numeric=-1 and pg_temp.sq('si')=3,'S12 posting pertama: 1 hasil, 1 jurnal, selisih -1 (foto 6, hitungan 5), stok 4-1=3');
select pg_temp.sale('si',1,'POS-S12-LATE');
do $$declare r jsonb;begin
 perform pg_temp.as_(pg_temp.owner());
 r:=public.post_opname_atomic(pg_temp.oid('s12'),pg_temp.today(),pg_temp.cnt('{"si":5}'));
 insert into res values('s12again',r);end$$;
select pg_temp.ok((pg_temp.rr('s12again')->>'already_posted')::boolean and pg_temp.rr('s12again')->>'no_hasil'=pg_temp.ref('s12') and (pg_temp.rr('s12again')->>'bergerak_sejak_hitung')::int=1,'S12 posting ulang dengan isi sama (sesudah penjualan lain): jawaban lama already_posted dengan jejak yang sama');
select pg_temp.ok((select count(*) from public.opname_results where order_id=pg_temp.oid('s12'))=1 and pg_temp.jcount('opname',pg_temp.ref('s12'))=1 and (select count(*) from public.stock_moves where source='opname' and source_ref=pg_temp.ref('s12'))=1 and pg_temp.sq('si')=2,'S12 tidak ada posting ganda (hasil/jurnal/mutasi tetap 1; stok hanya berubah oleh penjualan baru)');
select pg_temp.ok((select count(*) from public.opname_posting_receipts where order_id=pg_temp.oid('s12'))=1,'S12 tepat satu kuitansi');
do $$begin perform pg_temp.as_(pg_temp.owner());end$$;
select pg_temp.reject('select public.post_opname_atomic('''||pg_temp.oid('s12')||'''::uuid,pg_temp.today(),pg_temp.cnt(''{"si":4}''))','sudah diposting dengan hitungan atau tanggal berbeda','S12 hitungan berbeda pada perintah yang sama ditolak');
select pg_temp.ok(pg_temp.tryp('s12x','{"sc":1}','5c100000-0000-4000-8000-000000000001')='OK','S12 perintah baru lain tidak terpengaruh');

-- ═════════ S13 periode akuntansi tutup ═════════
do $$begin perform pg_temp.ord('s13');end$$;
select pg_temp.lock('s13','sc',2);select pg_temp.sale('sc',1);
update accounting_locks set closed_until=pg_temp.today();
select pg_temp.ok(pg_temp.tryp('s13') like '%ditutup%','S13 periode ditutup sampai hari ini: posting hari ini ditolak');
select pg_temp.ok(pg_temp.tryp('s13',null,null,pg_temp.today()-2) like '%ditutup%','S13 tanggal sebelum batas tutup ditolak');
select pg_temp.ok(pg_temp.sq('sc')=2 and not exists(select 1 from public.opname_results r join public.opname_orders o on o.id=r.order_id where o.no_opname='OPO.CS.s13'),'S13 penolakan tidak meninggalkan hasil dan tidak mengubah stok');
update accounting_locks set closed_until=null;
select pg_temp.ok(pg_temp.tryp('s13')='OK','S13 setelah periode dibuka posting berhasil (foto 3, hitungan 2, jual 1: selisih -1 nyata)');

-- ═════════ S14 gerbang peran ═════════
do $$begin perform pg_temp.ord('s14');end$$;
select pg_temp.lock('s14','sy',9);
select pg_temp.ok(pg_temp.tryp('s14',null,'5c100000-0000-4000-8000-000000000003') not in('OK',''),'S14 Admin Online ditolak (pagar tetap)');
select pg_temp.ok(pg_temp.tryp('s14',null,'5c100000-0000-4000-8000-000000000004') like '%tidak dapat diakses%' or pg_temp.tryp('s14',null,'5c100000-0000-4000-8000-000000000004') like '%ditolak%','S14 staf cabang lain ditolak');
select pg_temp.ok(pg_temp.tryp('s14',null,'5c100000-0000-4000-8000-000000000002')='OK','S14 staf kasir cabang yang sama boleh');
select pg_temp.ok(pg_temp.tryp('s14',null,'5c100000-0000-4000-8000-0000000000ff') like '%ditolak%','S14 pengguna tak dikenal ditolak');
select pg_temp.ok(pg_temp.sq('sy')=10,'S14 percobaan yang ditolak/dibatalkan tidak mengubah stok');

-- ═════════ S15 hapus perintah (cascade) tidak membentur FK baseline ═════════
do $$begin perform pg_temp.ord('s15');end$$;
select pg_temp.lock('s15','sz',10);select pg_temp.buka('s15','sz');select pg_temp.lock('s15','sz',10);
select pg_temp.ok(pg_temp.bq('s15','sz')=10 and pg_temp.cq('s15','sz')=10,'S15 prasyarat: ada baris kunci dan baseline');
select pg_temp.ok(pg_temp.cl('select 1')='OK','S15 helper klien hidup');
do $$begin delete from public.opname_orders where id=pg_temp.oid('s15');end$$;
select pg_temp.ok(not exists(select 1 from public.opname_counts where order_id=pg_temp.oid('s15')) and not exists(select 1 from public.opname_count_baselines where order_id=pg_temp.oid('s15')),'S15 menghapus perintah (cascade) menghapus kunci dan baseline tanpa galat FK');

-- ═════════ S16 barang di luar lingkup / tak dikenal tetap ditolak (regresi) ═════════
do $$declare o uuid:=pg_temp.ord('s16');begin insert into public.opname_order_items(order_id,item_id) values(o,pg_temp.iid('sp'));end$$;
select pg_temp.ok(pg_temp.tryp('s16','{"sp":10,"sq1":3}') like '%di luar lingkup%','S16 barang di luar lingkup ditolak (aturan lama utuh)');
select pg_temp.ok(pg_temp.tryp('s16','{"sp":10}')='OK','S16 barang dalam lingkup diterima');

-- ═════════ S17 pemeriksaan "perlu diulang" tidak mengejar selisih lebih / tanpa gerak ═════════
do $$begin perform pg_temp.ord('s17');end$$;
select pg_temp.lock('s17','sq1',4);
select pg_temp.ok(pg_temp.post('s17') ? 'no_hasil' and (pg_temp.ri('s17','sq1')->>'selisih')::numeric=-6 and pg_temp.sq('sq1')=4,'S17 kurang 6 nyata tanpa gerakan: stok 10 cukup -> diposting, stok 4 (perilaku lama identik)');
select pg_temp.ok((pg_temp.rr('s17')->>'bergerak_sejak_hitung')::int=0 and jsonb_array_length((select source_snapshot->'sejak_hitung' from public.opname_posting_receipts where result_id=pg_temp.rid('s17')))=0,'S17 tanpa gerakan: bergerak_sejak_hitung 0, daftar kosong');

-- ═════════ S18 batas hitungan: foto 10, terjual 3 (stok 7), hitungan 0..14 ═════════
-- hitungan c: selisih = c-10; stok akhir = 7 + (c-10); kekurangan > stok sekarang (c < 3) harus ditolak, selebihnya diposting.
create function pg_temp.matrix() returns void language plpgsql as $$
declare c int;code text;lbl text;msg text;exp_ok boolean;
begin
 for c in 0..14 loop
  code:='mx'||c;lbl:='s18_'||c;
  perform pg_temp.mk(code,1000,0);perform pg_temp.lay(code,10,100);
  perform pg_temp.ord(lbl);perform pg_temp.lock(lbl,code,c);perform pg_temp.sale(code,3,'POS-MX-'||c);
  exp_ok:=c>=3;
  msg:=pg_temp.tryp(lbl);
  perform pg_temp.ok((msg='OK')=exp_ok and (exp_ok or msg like 'Hitungan barang berikut perlu diulang%'),'S18 hitungan '||c||': '||case when exp_ok then 'diposting' else 'ditolak perlu diulang (kurang '||(10-c)||' > stok 7)' end);
  if exp_ok then
   perform pg_temp.post(lbl);
   perform pg_temp.ok((pg_temp.ri(lbl,code)->>'selisih')::numeric=c-10 and (pg_temp.ri(lbl,code)->>'qty_sistem')::numeric=10 and pg_temp.sq(code)=7+(c-10),'S18 hitungan '||c||': selisih '||(c-10)||' terhadap foto 10, stok akhir '||(7+(c-10)));
   perform pg_temp.ok(pg_temp.n(pg_temp.gl('opname',pg_temp.ref(lbl)),'170001')=case when c<10 then -100*(10-c) when c>10 then 100*(c-10) else 0 end and pg_temp.jcount('opname',pg_temp.ref(lbl))=case when c=10 then 0 else 1 end,'S18 hitungan '||c||': nilai jurnal persediaan = selisih x 100, tanpa jurnal bila selisih 0');
  end if;
 end loop;
end$$;
select pg_temp.matrix();

-- ═════════ S19 isolasi: barang tanpa baris stok, gudang lain, opname lain ═════════
select pg_temp.mk('snost',1000,0);
select pg_temp.mk('sw',1000,0);select pg_temp.lay('sw',4,100);
insert into public.stock(warehouse_id,item_id,qty) values('5c300000-0000-4000-8000-000000000002',pg_temp.iid('sw'),9);
do $$begin perform pg_temp.ord('s19a');perform pg_temp.ord('s19b');end$$;
select pg_temp.lock('s19a','snost',3);
select pg_temp.ok(pg_temp.cq('s19a','snost')=0,'S19 barang yang belum pernah punya baris stok dikunci: foto 0 (bukan angka klien, bukan 1)');
select pg_temp.lock('s19a','sw',4);
select pg_temp.ok(pg_temp.cq('s19a','sw')=4,'S19 foto memakai stok GUDANG opname (4), bukan gudang lain (9)');
select pg_temp.buka('s19a','sw');select pg_temp.sale('sw',1,'POS-S19');
select pg_temp.ok(pg_temp.bq('s19a','sw')=4 and pg_temp.bq('s19b','sw') is null,'S19 baseline opname A tidak bocor ke opname B');
select pg_temp.lock('s19b','sw',3);
select pg_temp.ok(pg_temp.cq('s19b','sw')=3 and pg_temp.cq('s19a','sw') is null,'S19 opname B mengunci barang yang sama: foto B = stok sekarang 3 (bukan baseline A = 4)');
-- baris kunci lama (sebelum migrasi) yang fotonya berbeda dari baseline pertama: baseline pertama menang
do $$begin perform pg_temp.ord('s19c');end$$;
select pg_temp.lock('s19c','sz',10);select pg_temp.buka('s19c','sz');select pg_temp.lock('s19c','sz',10);
update public.opname_counts set qty_sistem=3 where order_id=pg_temp.oid('s19c') and item_id=pg_temp.iid('sz');
select pg_temp.ok(pg_temp.cq('s19c','sz')=3 and pg_temp.bq('s19c','sz')=10,'S19 prasyarat: baris kunci dengan foto 3 ditanam oleh pemilik; baseline pertama 10');
select pg_temp.ok(pg_temp.post('s19c') ? 'no_hasil' and (pg_temp.ri('s19c','sz')->>'qty_sistem')::numeric=10 and (pg_temp.ri('s19c','sz')->>'selisih')::numeric=0,'S19 bila baseline dan baris kunci berbeda, baseline PERTAMA yang dipakai (10, selisih 0)');
select pg_temp.ok((select first_locked_at from public.opname_count_baselines where order_id=pg_temp.oid('s19c') and item_id=pg_temp.iid('sz')) is not null,'S19 first_locked_at tercatat');
-- jam kunci pertama = jam baris yang dihapus
do $$begin perform pg_temp.ord('s19d');end$$;
select pg_temp.lock('s19d','sx',5);
update public.opname_counts set locked_at='2026-01-02 03:04:05+00' where order_id=pg_temp.oid('s19d') and item_id=pg_temp.iid('sx');
select pg_temp.buka('s19d','sx');
select pg_temp.ok((select first_locked_at from public.opname_count_baselines where order_id=pg_temp.oid('s19d') and item_id=pg_temp.iid('sx'))='2026-01-02 03:04:05+00'::timestamptz,'S19 baseline menyimpan jam kunci pertama (locked_at baris yang dihapus)');
-- pagar Admin Online pada penulisan tabel baseline
select pg_temp.ok(exists(select 1 from pg_trigger t where t.tgrelid='public.opname_count_baselines'::regclass and t.tgname='zz_admin_online_write_fence'),'S19 trigger pagar tulis Admin Online terpasang pada tabel baseline');
select pg_temp.ok(admin_online_private.guard_all()=0 and admin_online_private.fence_all()=0,'S19 guard_all dan fence_all dijalankan ulang: tidak ada fungsi/tabel tanpa pagar (0 dan 0)');
rollback;
