-- SO-SURPLUS-HPP (migrasi *_so_surplus_hpp_rata2): fictional fixtures in disposable PostgreSQL only; everything rolls back.
-- Aturan yang dibuktikan: selisih lebih dinilai HPP rata-rata gudang (rantai cadangan), SATU jurnal neto per dokumen opname
-- (lebih mengurangi beban selisih kurang, sisanya Pendapatan Lain-lain), selisih kurang tetap FIFO apa adanya, baris kartu stok,
-- kuitansi/snapshot, idempotensi, periode tutup, gerbang peran, koreksi opname (HPP rata-rata + jurnal neto), ACL.
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
 ('5a100000-0000-4000-8000-000000000001','{"full_name":"SX owner"}'),('5a100000-0000-4000-8000-000000000002','{"full_name":"SX admin"}'),
 ('5a100000-0000-4000-8000-000000000003','{"full_name":"SX finance"}'),('5a100000-0000-4000-8000-000000000004','{"full_name":"SX staf tanpa shift"}'),
 ('5a100000-0000-4000-8000-000000000005','{"full_name":"SX admin online"}'),('5a100000-0000-4000-8000-000000000006','{"full_name":"SX finance cabang B"}'),('5a100000-0000-4000-8000-000000000007','{"full_name":"SX dokter tanpa modul pos"}');
update profiles set role='DOCTOR',is_active=true where id='5a100000-0000-4000-8000-000000000007';
update profiles set role='OWNER',is_active=true where id='5a100000-0000-4000-8000-000000000001';
update profiles set role='ADMIN',is_active=true where id='5a100000-0000-4000-8000-000000000002';
update profiles set role='FINANCE',is_active=true where id in('5a100000-0000-4000-8000-000000000003','5a100000-0000-4000-8000-000000000006');
update profiles set role='STAFF',is_active=true where id='5a100000-0000-4000-8000-000000000004';
update profiles set role='ADMIN_ONLINE',is_active=true where id='5a100000-0000-4000-8000-000000000005';
insert into role_capabilities(role,all_branches,create_accounts) values('ADMIN',false,false),('FINANCE',false,false) on conflict(role) do update set all_branches=false;
insert into role_modules(role,module_id) values('STAFF','pos'),('ADMIN','pos'),('FINANCE','pos'),('DOCTOR','klinik') on conflict do nothing;
insert into branches(id,code,name,type) values('5a200000-0000-4000-8000-000000000001','SXA','SX klinik A','KLINIK'),('5a200000-0000-4000-8000-000000000002','SXB','SX petshop B','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values('5a300000-0000-4000-8000-000000000001','5a200000-0000-4000-8000-000000000001','SXWA','SX gudang A','VET'),
 ('5a300000-0000-4000-8000-000000000002','5a200000-0000-4000-8000-000000000002','SXWB','SX gudang B','RETAIL');
insert into user_branches(user_id,branch_id) values('5a100000-0000-4000-8000-000000000002','5a200000-0000-4000-8000-000000000001'),('5a100000-0000-4000-8000-000000000003','5a200000-0000-4000-8000-000000000001'),
 ('5a100000-0000-4000-8000-000000000004','5a200000-0000-4000-8000-000000000001'),('5a100000-0000-4000-8000-000000000005','5a200000-0000-4000-8000-000000000001'),
 ('5a100000-0000-4000-8000-000000000006','5a200000-0000-4000-8000-000000000002'),('5a100000-0000-4000-8000-000000000007','5a200000-0000-4000-8000-000000000001');
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active) values('170001','Persediaan fiktif','ASET','D',false,true),('720010','Beban selisih stok fiktif','BEBAN','D',false,true),
 ('810004','Pendapatan lain-lain fiktif','PENDAPATAN','K',false,true) on conflict(code) do update set is_active=true,is_header=false;
update accounting_locks set closed_until=null;

create temp table it(code text primary key,id uuid);grant all on it to public;
create temp table res(name text primary key,r jsonb);grant all on res to public;
create temp table seq(n int);insert into seq values(0);grant all on seq to public;
create function pg_temp.iid(c text) returns uuid language sql as $$select id from it where code=c$$;
create function pg_temp.mk(c text,buy numeric default 0) returns void language plpgsql as $$begin
 insert into it values(c,gen_random_uuid());
 insert into public.items(id,code,name,unit,item_type,buy_price,sell_price) values(pg_temp.iid(c),'SX-'||c,'Barang '||c,'PCS','Persediaan',buy,1000);end$$;
create function pg_temp.lay(wh uuid,c text,qty numeric,cost numeric,daysago int default 5) returns void language plpgsql as $$begin
 update seq set n=n+1;
 perform public.stock_in_fifo(wh,pg_temp.iid(c),qty,cost,'fixture','FX-'||c||'-'||(select n from seq),pg_temp.today()-daysago,null);end$$;
create function pg_temp.wa() returns uuid language sql as $$select '5a300000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.wb() returns uuid language sql as $$select '5a300000-0000-4000-8000-000000000002'::uuid$$;
create function pg_temp.owner() returns text language sql as $$select '5a100000-0000-4000-8000-000000000001'$$;
create function pg_temp.ord(label text,wh uuid) returns uuid language plpgsql as $$
declare oid uuid:=gen_random_uuid();begin
 insert into public.opname_orders(id,no_opname,warehouse_id,penanggung_jawab) values(oid,'OPO.SX.'||label,wh,'Penghitung fiktif');return oid;end$$;
-- counts: {"kode": fisik}
create function pg_temp.cnt(counts jsonb) returns jsonb language sql as $$
 select coalesce(jsonb_object_agg(pg_temp.iid(k)::text,v),'{}'::jsonb) from jsonb_each(counts) e(k,v)$$;
create function pg_temp.post(label text,wh uuid,counts jsonb,uid text default null,d date default null,oid uuid default null) returns jsonb language plpgsql as $$
declare o uuid:=coalesce(oid,pg_temp.ord(label,wh));r jsonb;begin
 perform pg_temp.as_(coalesce(uid,pg_temp.owner()));
 r:=public.post_opname_atomic(o,coalesce(d,pg_temp.today()),pg_temp.cnt(counts));
 insert into res values(label,r||jsonb_build_object('order_id',o)) on conflict(name) do update set r=excluded.r;return r;end$$;
-- galat atau 'OK' (sub-transaksi dibatalkan)
create function pg_temp.tryp(label text,wh uuid,counts jsonb,uid text default null,d date default null,oid uuid default null) returns text language plpgsql as $$
begin begin perform pg_temp.post(label,wh,counts,uid,d,oid);raise exception 'TRY_OK';
 exception when others then return case when sqlerrm='TRY_OK' then 'OK' else sqlerrm end;end;end$$;
create function pg_temp.rr(label text) returns jsonb language sql as $$select r from res where name=label$$;
create function pg_temp.ref(label text) returns text language sql as $$select r->>'no_hasil' from res where name=label$$;
-- saldo bersih per akun (debit-kredit) jurnal sumber tertentu
create function pg_temp.gl(src text,ref text) returns jsonb language sql as $$
 select coalesce(jsonb_object_agg(code,net),'{}') from (select a.code,sum(l.debit-l.credit) net from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
  join public.journal_entries e on e.id=l.entry_id where e.source=src and e.source_ref=ref group by a.code) x$$;
create function pg_temp.glr(src text,ref text) returns jsonb language sql as $$  -- jumlah debit/kredit kotor per akun
 select coalesce(jsonb_object_agg(code,jsonb_build_object('d',d,'c',c)),'{}') from (select a.code,sum(l.debit) d,sum(l.credit) c from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
  join public.journal_entries e on e.id=l.entry_id where e.source=src and e.source_ref=ref group by a.code) x$$;
create function pg_temp.jcount(src text,ref text) returns int language sql as $$select count(*)::int from public.journal_entries where source=src and source_ref=ref$$;
create function pg_temp.balanced(src text,ref text) returns boolean language sql as $$
 select coalesce(sum(l.debit-l.credit),0)=0 from public.journal_lines l join public.journal_entries e on e.id=l.entry_id where e.source=src and e.source_ref=ref$$;
create function pg_temp.layer(ref text,c text) returns public.stock_layers language sql as $$
 select l from public.stock_layers l where l.source='opname' and l.source_ref=ref and l.item_id=pg_temp.iid(c) limit 1$$;
create function pg_temp.mv(src text,ref text,c text) returns public.stock_moves language sql as $$
 select m from public.stock_moves m where m.source=src and m.source_ref=ref and m.item_id=pg_temp.iid(c) limit 1$$;
create function pg_temp.avg(wh uuid,c text) returns numeric language sql as $$
 select sum(qty_left*unit_cost)/sum(qty_left) from public.stock_layers where warehouse_id=wh and item_id=pg_temp.iid(c) and qty_left>0$$;
create function pg_temp.sq(wh uuid,c text) returns numeric language sql as $$select qty from public.stock where warehouse_id=wh and item_id=pg_temp.iid(c)$$;
create function pg_temp.snap(label text,c text) returns jsonb language sql as $$
 select r from public.opname_posting_receipts p cross join lateral jsonb_array_elements(p.source_snapshot->'price_report'->'rows') r
  where p.result_id=(pg_temp.rr(label)->>'result_id')::uuid and r->>'item_id'=pg_temp.iid(c)::text$$;
create function pg_temp.sraw(label text,c text) returns jsonb language sql as $$
 select r from public.opname_posting_receipts p cross join lateral jsonb_array_elements(p.source_snapshot->'rows') r
  where p.result_id=(pg_temp.rr(label)->>'result_id')::uuid and r->>'item_id'=pg_temp.iid(c)::text$$;
create function pg_temp.rc(label text) returns jsonb language sql as $$
 select source_snapshot-'rows'-'order'-'price_report' from public.opname_posting_receipts where result_id=(pg_temp.rr(label)->>'result_id')::uuid$$;
create function pg_temp.refuse(label text) returns text language sql as $$
 select coalesce(public.opname_variance_charge_basis((pg_temp.rr(label)->>'result_id')::uuid)->'refuse'->>'code','')$$;
create function pg_temp.cost(wh uuid,c text,master numeric default 0) returns jsonb language plpgsql as $$
begin return (select to_jsonb(x) from public.opname_surplus_cost(wh,pg_temp.iid(c),master) x);end$$;

-- ═════════ barang & lapisan ═════════
select pg_temp.mk(c,b) from (values('p1',0),('m1',90),('p3',0),('m3',0),('p4',0),('m4',0),('p5',0),('m5',0),('z6',0),('m6',0),('l7',0),('o7',0),('ms7',70),('pr7',500),('zl7',0),
 ('rnd1',0),('rnd2',0),('wavg',0),('rv',0),('adj2',30),('av1',0),('av2',0),('bp',0),('p16',0),('m16',0),('adj',30),('q10',0),('out10',0),('idem',0),('cl',0),('gt',0),('neg9',0),('fm',40)) v(c,b);
select pg_temp.lay(pg_temp.wa(),'p1',10,100,9);select pg_temp.lay(pg_temp.wa(),'p1',10,200,8);
select pg_temp.lay(pg_temp.wa(),'m1',3,100,9);select pg_temp.lay(pg_temp.wa(),'m1',4,120,8);
select pg_temp.lay(pg_temp.wa(),'p3',10,100);select pg_temp.lay(pg_temp.wa(),'m3',5,100);
select pg_temp.lay(pg_temp.wa(),'p4',10,100);select pg_temp.lay(pg_temp.wa(),'m4',5,100);
select pg_temp.lay(pg_temp.wa(),'p5',10,100);select pg_temp.lay(pg_temp.wa(),'m5',5,100);
select pg_temp.lay(pg_temp.wa(),'m6',1,100);
select pg_temp.lay(pg_temp.wa(),'l7',5,120);
select pg_temp.lay(pg_temp.wb(),'o7',4,90);select pg_temp.lay(pg_temp.wb(),'o7',4,110);
select pg_temp.lay(pg_temp.wa(),'pr7',2,100);
select pg_temp.lay(pg_temp.wa(),'zl7',3,0);select pg_temp.lay(pg_temp.wa(),'zl7',2,100);
select pg_temp.lay(pg_temp.wa(),'bp',27,12960.5);
select pg_temp.lay(pg_temp.wa(),'p16',10,100);select pg_temp.lay(pg_temp.wa(),'m16',5,100);
select pg_temp.lay(pg_temp.wa(),'adj',2,30);
select pg_temp.lay(pg_temp.wa(),'q10',4,50);select pg_temp.lay(pg_temp.wa(),'out10',4,50);
select pg_temp.lay(pg_temp.wa(),'idem',6,80);
select pg_temp.lay(pg_temp.wa(),'cl',3,60);select pg_temp.lay(pg_temp.wa(),'gt',3,60);
select pg_temp.lay(pg_temp.wa(),'fm',5,40);
select pg_temp.lay(pg_temp.wa(),'rnd1',3,33.335,9);select pg_temp.lay(pg_temp.wa(),'rnd2',3,33.335,9);
select pg_temp.lay(pg_temp.wa(),'wavg',30,100,9);select pg_temp.lay(pg_temp.wa(),'wavg',10,200,8);
select pg_temp.lay(pg_temp.wa(),'rv',5,500,9);select pg_temp.lay(pg_temp.wa(),'rv',5,100,8);
select pg_temp.lay(pg_temp.wa(),'adj2',4,100,7);
select pg_temp.lay(pg_temp.wa(),'neg9',2,60,3);
-- l7: lapisan terpakai habis (stok 0) -> tinggal "harga masuk terakhir"
select public.stock_out_fifo(pg_temp.wa(),pg_temp.iid('l7'),5,'sale','SX-L7-OUT',pg_temp.today());
-- neg9: dijual 5 padahal stok 2 -> stok minus -3 (lapisan habis, sisa 'stok minus')
select public.stock_out_fifo(pg_temp.wa(),pg_temp.iid('neg9'),5,'sale','SX-NEG9-OUT',pg_temp.today());

-- ═════════ S1 hanya selisih lebih: HPP rata-rata lapisan (10@100 + 10@200 = 150) ═════════
select pg_temp.ok(pg_temp.post('s1',pg_temp.wa(),'{"p1":24}') ? 'no_hasil','S1 posting selisih lebih berhasil');
select pg_temp.ok(pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s1')),'170001')=600 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s1')),'810004')=-600 and not (pg_temp.gl('opname',pg_temp.ref('s1')) ? '720010'),
 'S1 jurnal: Dr 170001 600 / Cr 810004 600 (4 x HPP rata-rata 150), tanpa 720010');
select pg_temp.ok(pg_temp.jcount('opname',pg_temp.ref('s1'))=1 and pg_temp.balanced('opname',pg_temp.ref('s1')),'S1 satu jurnal, seimbang');
select pg_temp.ok((select deskripsi from public.journal_entries where source='opname' and source_ref=pg_temp.ref('s1'))='Selisih lebih stok opname '||pg_temp.ref('s1')||' (OPO.SX.s1)','S1 deskripsi jurnal sama dengan format lama (hanya lebih)');
select pg_temp.ok((pg_temp.layer(pg_temp.ref('s1'),'p1')).unit_cost=150 and (pg_temp.layer(pg_temp.ref('s1'),'p1')).qty_in=4 and (pg_temp.layer(pg_temp.ref('s1'),'p1')).qty_left=4,'S1 lapisan baru: 4 unit pada HPP 150');
select pg_temp.ok((pg_temp.mv('opname',pg_temp.ref('s1'),'p1')).qty=4 and (pg_temp.mv('opname',pg_temp.ref('s1'),'p1')).unit_cost=150 and (pg_temp.mv('opname',pg_temp.ref('s1'),'p1')).tanggal=pg_temp.today(),'S1 mutasi stok (kartu stok): +4, nilai satuan 150, no. sumber OPR, tanggal opname');
select pg_temp.ok(pg_temp.sq(pg_temp.wa(),'p1')=24,'S1 stok menjadi 24');
select pg_temp.ok(round(pg_temp.avg(pg_temp.wa(),'p1'),6)=150,'S1 HPP rata-rata sesudah posting tetap 150 (menambah pada rata-rata tidak mengubah rata-rata)');
select pg_temp.ok(pg_temp.n(pg_temp.rr('s1'),'surplus_value')=600 and pg_temp.n(pg_temp.rr('s1'),'shortage_value')=0 and pg_temp.n(pg_temp.rr('s1'),'net_variance')=-600 and pg_temp.n(pg_temp.rr('s1'),'surplus_offset')=0 and pg_temp.rr('s1')->'surplus_unpriced'='[]'::jsonb,
 'S1 kuitansi: lebih 600, kurang 0, neto -600, tanpa barang tanpa harga');
select pg_temp.ok(pg_temp.n(pg_temp.sraw('s1','p1'),'buy_price')=150 and pg_temp.n(pg_temp.sraw('s1','p1'),'master_buy_price')=0 and pg_temp.sraw('s1','p1')->>'surplus_cost_source'='HPP rata-rata lapisan gudang','S1 foto baris: harga = HPP dipakai, harga master disimpan terpisah, sumber tercatat');
select pg_temp.ok(pg_temp.n(pg_temp.snap('s1','p1'),'nilai_selisih_modal')=600 and pg_temp.n(pg_temp.snap('s1','p1'),'modal_satuan')=150 and pg_temp.snap('s1','p1')->>'sumber_nilai_modal'='HPP rata-rata stok masuk yang dijurnal',
 'S1 laporan harga opname: nilai lebih 600 = jurnal, sumber HPP rata-rata');
select pg_temp.ok(pg_temp.n(pg_temp.rc('s1'),'gain_cost')=600 and pg_temp.n(pg_temp.rc('s1'),'gain_offset')=0 and pg_temp.rc('s1')->>'surplus_rule'='hpp-rata-rata-v1' and pg_temp.rc('s1')->>'warehouse_policy'='variance-loss-expense-gain-income' and pg_temp.rc('s1')->>'gain_account'='810004','S1 bukti posting: gain_cost 600, aturan hpp-rata-rata-v1, kebijakan lama tetap');
select pg_temp.ok(round((select sum(m.qty*m.unit_cost) from public.stock_moves m where m.source='opname' and m.source_ref=pg_temp.ref('s1')),2)=pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s1')),'170001'),'S1 nilai mutasi stok = mutasi akun persediaan 170001');
select pg_temp.ok((select count(*) from public.stock_moves where item_id=pg_temp.iid('p1') and source='opname' and qty>0 and source_ref=pg_temp.ref('s1'))=1,'S1 baris kartu stok barang plus ada tepat satu (query kartu stok per barang)');
select pg_temp.ok((select status::text from public.opname_orders where id=(pg_temp.rr('s1')->>'order_id')::uuid)='Selesai','S1 perintah opname Selesai');

-- ═════════ S2 hanya selisih kurang: perilaku lama (FIFO) ═════════
select pg_temp.ok(pg_temp.post('s2',pg_temp.wa(),'{"m1":2}') ? 'no_hasil','S2 posting selisih kurang berhasil');
select pg_temp.ok(pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s2')),'720010')=540 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s2')),'170001')=-540 and not (pg_temp.gl('opname',pg_temp.ref('s2')) ? '810004'),'S2 jurnal: Dr 720010 540 / Cr 170001 540 (3x100 + 2x120 FIFO)');
select pg_temp.ok((select deskripsi from public.journal_entries where source='opname' and source_ref=pg_temp.ref('s2'))='Selisih kurang stok opname '||pg_temp.ref('s2')||' (OPO.SX.s2)' and pg_temp.jcount('opname',pg_temp.ref('s2'))=1,'S2 deskripsi jurnal sama dengan format lama (hanya kurang)');
select pg_temp.ok((pg_temp.mv('opname',pg_temp.ref('s2'),'m1')).qty=-5 and (pg_temp.mv('opname',pg_temp.ref('s2'),'m1')).unit_cost=108,'S2 mutasi: -5 pada HPP keluar 108');
select pg_temp.ok((select count(*) from jsonb_array_elements((pg_temp.mv('opname',pg_temp.ref('s2'),'m1')).fifo_takes))=2 or (select count(*) from public.stock_document_issue_proofs p where p.kind='opname' and p.document_id=(pg_temp.rr('s2')->>'result_id')::uuid)=1,'S2 bukti pengeluaran FIFO tercatat');
select pg_temp.ok((select sum(qty_left) from public.stock_layers where item_id=pg_temp.iid('m1') and warehouse_id=pg_temp.wa())=2 and (select qty_left from public.stock_layers where item_id=pg_temp.iid('m1') and unit_cost=100)=0 and (select qty_left from public.stock_layers where item_id=pg_temp.iid('m1') and unit_cost=120)=2,'S2 FIFO: lapisan tertua habis dulu (100 -> 0, 120 -> sisa 2)');
select pg_temp.ok(pg_temp.n(pg_temp.rr('s2'),'shortage_value')=540 and pg_temp.n(pg_temp.rr('s2'),'surplus_value')=0 and pg_temp.n(pg_temp.rr('s2'),'net_variance')=540 and pg_temp.n(pg_temp.rc('s2'),'loss_cost')=540,'S2 kuitansi: kurang 540, lebih 0, neto 540');
select pg_temp.ok(pg_temp.refuse('s2')='','S2 dasar beban karyawan: tidak ditolak (kode kosong)');
select pg_temp.ok(pg_temp.n(public.opname_variance_charge_basis((pg_temp.rr('s2')->>'result_id')::uuid),'hpp_total')=540,'S2 dasar beban karyawan: HPP kurang 540');

-- ═════════ S3 campuran, lebih < kurang ═════════
select pg_temp.ok(pg_temp.post('s3',pg_temp.wa(),'{"p3":13,"m3":0}') ? 'no_hasil','S3 posting campuran berhasil');
select pg_temp.ok(pg_temp.jcount('opname',pg_temp.ref('s3'))=1,'S3 TEPAT SATU jurnal untuk dokumen (bukan dua)');
select pg_temp.ok(pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s3')),'720010')=200 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s3')),'170001')=-200 and not (pg_temp.gl('opname',pg_temp.ref('s3')) ? '810004'),'S3 neto: Beban Selisih Stok 200 = kurang 500 - lebih 300; persediaan -200; tanpa 810004');
select pg_temp.ok(pg_temp.n(pg_temp.glr('opname',pg_temp.ref('s3'))->'720010','d')=500 and pg_temp.n(pg_temp.glr('opname',pg_temp.ref('s3'))->'720010','c')=300 and pg_temp.n(pg_temp.glr('opname',pg_temp.ref('s3'))->'170001','d')=300 and pg_temp.n(pg_temp.glr('opname',pg_temp.ref('s3'))->'170001','c')=500,'S3 garis kotor terbaca: 720010 D500/K300, 170001 D300/K500');
select pg_temp.ok(pg_temp.balanced('opname',pg_temp.ref('s3')),'S3 jurnal seimbang');
select pg_temp.ok((select deskripsi from public.journal_entries where source='opname' and source_ref=pg_temp.ref('s3'))='Selisih stok opname '||pg_temp.ref('s3')||' (OPO.SX.s3): kurang Rp 500, lebih Rp 300, neto kurang Rp 200','S3 deskripsi memuat kurang, lebih, dan neto');
select pg_temp.ok(pg_temp.n(pg_temp.rr('s3'),'shortage_value')=500 and pg_temp.n(pg_temp.rr('s3'),'surplus_value')=300 and pg_temp.n(pg_temp.rr('s3'),'surplus_offset')=300 and pg_temp.n(pg_temp.rr('s3'),'net_variance')=200,'S3 kuitansi: kurang 500, lebih 300, mengurangi beban 300, neto 200');
select pg_temp.ok((pg_temp.layer(pg_temp.ref('s3'),'p3')).unit_cost=100 and (pg_temp.mv('opname',pg_temp.ref('s3'),'m3')).qty=-5 and (pg_temp.mv('opname',pg_temp.ref('s3'),'m3')).unit_cost=100,'S3 kartu stok: barang plus +3 @100 dan barang minus -5 sama-sama tercatat');
select pg_temp.ok(round((select sum(m.qty*m.unit_cost) from public.stock_moves m where m.source='opname' and m.source_ref=pg_temp.ref('s3')),2)=pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s3')),'170001'),'S3 nilai mutasi stok = mutasi akun persediaan');
select pg_temp.ok(pg_temp.n(public.opname_variance_charge_basis((pg_temp.rr('s3')->>'result_id')::uuid),'hpp_total')=500 and (public.opname_variance_charge_basis((pg_temp.rr('s3')->>'result_id')::uuid)->>'minus_count')::int=1,'S3 dasar beban karyawan: hanya barang kurang (HPP 500), lebih TIDAK menjadi beban negatif');
select pg_temp.ok(pg_temp.refuse('s3')='','S3 dasar beban karyawan tetap lolos cek kecocokan jurnal (debit 720010 kotor = HPP kurang)');
select pg_temp.ok(jsonb_array_length(public.opname_variance_charge_basis((pg_temp.rr('s3')->>'result_id')::uuid)->'minus_lines')=1,'S3 baris beban karyawan hanya selisih kurang');

-- ═════════ S4 campuran, lebih > kurang ═════════
select pg_temp.ok(pg_temp.post('s4',pg_temp.wa(),'{"p4":17,"m4":0}') ? 'no_hasil','S4 posting campuran lebih>kurang berhasil');
select pg_temp.ok(pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s4')),'720010')=0 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s4')),'810004')=-200 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s4')),'170001')=200,'S4 neto: beban 0, kelebihan 200 ke Pendapatan Lain-lain 810004, persediaan +200');
select pg_temp.ok(pg_temp.n(pg_temp.glr('opname',pg_temp.ref('s4'))->'720010','d')=500 and pg_temp.n(pg_temp.glr('opname',pg_temp.ref('s4'))->'720010','c')=500 and pg_temp.n(pg_temp.glr('opname',pg_temp.ref('s4'))->'810004','c')=200,'S4 garis kotor: 720010 D500/K500, 810004 K200');
select pg_temp.ok(pg_temp.jcount('opname',pg_temp.ref('s4'))=1 and pg_temp.balanced('opname',pg_temp.ref('s4')),'S4 satu jurnal seimbang');
select pg_temp.ok((select deskripsi from public.journal_entries where source='opname' and source_ref=pg_temp.ref('s4'))='Selisih stok opname '||pg_temp.ref('s4')||' (OPO.SX.s4): kurang Rp 500, lebih Rp 700, neto lebih Rp 200','S4 deskripsi: neto lebih');
select pg_temp.ok(pg_temp.n(pg_temp.rr('s4'),'net_variance')=-200 and pg_temp.n(pg_temp.rr('s4'),'surplus_offset')=500 and pg_temp.n(pg_temp.rc('s4'),'gain_offset')=500,'S4 kuitansi: neto -200 (untung), mengurangi beban 500');

-- ═════════ S5 lebih = kurang ═════════
select pg_temp.ok(pg_temp.post('s5',pg_temp.wa(),'{"p5":15,"m5":0}') ? 'no_hasil','S5 posting lebih = kurang berhasil');
select pg_temp.ok(pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s5')),'720010')=0 and not (pg_temp.gl('opname',pg_temp.ref('s5')) ? '810004') and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s5')),'170001')=0,'S5 beban neto 0, tanpa 810004, persediaan neto 0');
select pg_temp.ok(pg_temp.jcount('opname',pg_temp.ref('s5'))=1 and pg_temp.balanced('opname',pg_temp.ref('s5')) and pg_temp.n(pg_temp.rr('s5'),'net_variance')=0,'S5 satu jurnal seimbang, neto 0');

-- ═════════ S6 barang tanpa harga sama sekali ═════════
select pg_temp.ok(pg_temp.post('s6',pg_temp.wa(),'{"z6":2,"m6":0}') ? 'no_hasil','S6 posting dengan barang lebih tanpa harga TETAP berhasil (stok fisik harus tercatat)');
select pg_temp.ok((pg_temp.layer(pg_temp.ref('s6'),'z6')).unit_cost=0 and (pg_temp.layer(pg_temp.ref('s6'),'z6')).qty_in=2,'S6 lapisan masuk Rp0 (benar-benar tanpa harga)');
select pg_temp.ok(jsonb_array_length(pg_temp.rr('s6')->'surplus_unpriced')=1 and pg_temp.rr('s6')->'surplus_unpriced'->0->>'name'='Barang z6' and (pg_temp.rr('s6')->'surplus_unpriced'->0->>'qty')::numeric=2,'S6 DAFTAR PERINGATAN: barang z6 (2 unit) tanpa harga ditandai di kuitansi');
select pg_temp.ok(jsonb_array_length(pg_temp.rc('s6')->'surplus_unpriced')=1 and pg_temp.sraw('s6','z6')->>'surplus_cost_source'='tanpa harga','S6 peringatan juga tersimpan di bukti posting dan foto baris');
select pg_temp.ok(pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s6')),'720010')=100 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s6')),'170001')=-100 and pg_temp.jcount('opname',pg_temp.ref('s6'))=1 and not (pg_temp.gl('opname',pg_temp.ref('s6')) ? '810004'),'S6 jurnal hanya selisih kurang 100 (lebih Rp0 tidak menambah jurnal), deskripsi lama');
select pg_temp.ok((select deskripsi from public.journal_entries where source='opname' and source_ref=pg_temp.ref('s6'))='Selisih kurang stok opname '||pg_temp.ref('s6')||' (OPO.SX.s6)','S6 deskripsi kurang-saja');
select pg_temp.ok(pg_temp.post('s6b',pg_temp.wa(),'{"z6":5}') ? 'no_hasil' and pg_temp.jcount('opname',pg_temp.ref('s6b'))=0 and jsonb_array_length(pg_temp.rr('s6b')->'surplus_unpriced')=1,'S6b hanya lebih tanpa harga: berhasil, tidak ada jurnal, peringatan ada');

-- ═════════ S7 rantai cadangan biaya (fungsi aturan biaya langsung) ═════════
select pg_temp.ok((pg_temp.cost(pg_temp.wa(),'p1')->>'unit_cost')::numeric=150 and pg_temp.cost(pg_temp.wa(),'p1')->>'source'='HPP rata-rata lapisan gudang','S7a rata-rata tertimbang lapisan: p1 sisa 20 (setelah S1 24) tetap 150');
select pg_temp.ok((pg_temp.cost(pg_temp.wa(),'l7')->>'unit_cost')::numeric=120 and pg_temp.cost(pg_temp.wa(),'l7')->>'source'='harga masuk terakhir gudang' and pg_temp.sq(pg_temp.wa(),'l7')=0,'S7b lapisan habis terpakai -> harga masuk berharga terakhir 120');
select pg_temp.ok((pg_temp.cost(pg_temp.wa(),'o7')->>'unit_cost')::numeric=100 and pg_temp.cost(pg_temp.wa(),'o7')->>'source'='HPP rata-rata gudang lain','S7c barang hanya punya stok di gudang lain -> rata-rata tertimbang gudang lain 100');
select pg_temp.ok((pg_temp.cost(pg_temp.wa(),'ms7',70)->>'unit_cost')::numeric=70 and pg_temp.cost(pg_temp.wa(),'ms7',70)->>'source'='harga beli master','S7d tidak ada riwayat harga -> harga beli master 70');
select pg_temp.ok((pg_temp.cost(pg_temp.wa(),'pr7',500)->>'unit_cost')::numeric=100,'S7e lapisan berharga menang atas harga master (100, bukan 500)');
select pg_temp.ok((pg_temp.cost(pg_temp.wa(),'zl7')->>'unit_cost')::numeric=100,'S7f lapisan Rp0 diabaikan dalam rata-rata (3@0 + 2@100 = 100, bukan 40)');
select pg_temp.ok((pg_temp.cost(pg_temp.wa(),'av2')->>'unit_cost')::numeric=0 and pg_temp.cost(pg_temp.wa(),'av2')->>'source'='tanpa harga','S7g tidak ada harga sama sekali -> 0 dengan sumber "tanpa harga"');
select pg_temp.ok(pg_temp.post('s7a',pg_temp.wa(),'{"l7":2}') ? 'no_hasil' and (pg_temp.layer(pg_temp.ref('s7a'),'l7')).unit_cost=120 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s7a')),'810004')=-240,'S7h posting memakai harga masuk terakhir 120 x 2 = 240');
select pg_temp.ok(pg_temp.post('s7b',pg_temp.wa(),'{"o7":3}') ? 'no_hasil' and (pg_temp.layer(pg_temp.ref('s7b'),'o7')).unit_cost=100 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s7b')),'810004')=-300,'S7i posting memakai rata-rata gudang lain 100 x 3 = 300');
select pg_temp.ok(pg_temp.post('s7c',pg_temp.wa(),'{"ms7":2}') ? 'no_hasil' and (pg_temp.layer(pg_temp.ref('s7c'),'ms7')).unit_cost=70 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s7c')),'810004')=-140 and pg_temp.n(pg_temp.rr('s7c'),'surplus_value')=140,'S7j posting dengan harga master 70 x 2 = 140 (perilaku lama untuk barang tanpa riwayat)');
select pg_temp.ok(pg_temp.post('s7d',pg_temp.wa(),'{"pr7":3,"zl7":6}') ? 'no_hasil' and (pg_temp.layer(pg_temp.ref('s7d'),'pr7')).unit_cost=100 and (pg_temp.layer(pg_temp.ref('s7d'),'zl7')).unit_cost=100 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s7d')),'810004')=-(1*100+1*100) and jsonb_array_length(pg_temp.rr('s7d')->'surplus_unpriced')=0,'S7k posting dua barang lebih sekaligus: tiap barang pada HPP-nya sendiri');

select pg_temp.ok((pg_temp.cost(pg_temp.wa(),'wavg')->>'unit_cost')::numeric=125,'S7l rata-rata TERTIMBANG qty (30@100 + 10@200 = 125, bukan rata-rata biasa 150)');
select pg_temp.ok(pg_temp.post('s7e',pg_temp.wa(),'{"wavg":42}') ? 'no_hasil' and (pg_temp.layer(pg_temp.ref('s7e'),'wavg')).unit_cost=125 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s7e')),'810004')=-250,'S7m posting: 2 x 125 = 250');

select pg_temp.ok(pg_temp.post('s7f',pg_temp.wa(),'{"rnd1":4,"rnd2":4}') ? 'no_hasil' and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s7f')),'810004')=-66.68 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s7f')),'170001')=66.68,'S7n pembulatan per baris: 2 baris x round(33.335)=33.34 -> 66.68 (bukan 66.67)');

select pg_temp.ok(pg_temp.snap('s1','p1')->>'sumber_modal'='HPP rata-rata (selisih lebih) yang dijurnal per unit','S17b laporan harga: sumber modal baris lebih menyebut HPP rata-rata');

-- ═════════ S9 stok minus (mengurangi stok minus) ═════════
select pg_temp.ok(pg_temp.sq(pg_temp.wa(),'neg9')=-3,'S9 prasyarat: stok sistem minus -3');
select pg_temp.ok(pg_temp.post('s9',pg_temp.wa(),'{"neg9":1}') ? 'no_hasil' and pg_temp.sq(pg_temp.wa(),'neg9')=1,'S9 hitung fisik 1 pada stok -3: selisih +4, stok menjadi 1 (minus tertutup)');
select pg_temp.ok((pg_temp.mv('opname',pg_temp.ref('s9'),'neg9')).qty=4 and (pg_temp.mv('opname',pg_temp.ref('s9'),'neg9')).unit_cost=60,'S9 kartu stok: +4 pada harga masuk terakhir 60');
select pg_temp.ok(pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s9')),'170001')=240 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s9')),'810004')=-240,'S9 jurnal 4 x 60 = 240 (nilai minus yang tertutup ikut tercatat)');
select pg_temp.ok((select sum(qty_left) from public.stock_layers where item_id=pg_temp.iid('neg9') and warehouse_id=pg_temp.wa())=1,'S9 hanya 1 unit fisik yang menjadi lapisan (3 unit menutup minus), stok = lapisan');

-- ═════════ S10 opname sebagian (lingkup) ═════════
do $$declare o uuid:=pg_temp.ord('s10',pg_temp.wa());begin
 insert into public.opname_order_items(order_id,item_id) values(o,pg_temp.iid('q10'));
 insert into res values('s10o',jsonb_build_object('o',o));end$$;
select pg_temp.ok(pg_temp.tryp('s10x',pg_temp.wa(),'{"q10":6,"out10":6}',null,null,(select (r->>'o')::uuid from res where name='s10o')) like '%di luar lingkup%','S10 barang di luar lingkup perintah ditolak');
select pg_temp.ok(pg_temp.post('s10',pg_temp.wa(),'{"q10":6}',null,null,(select (r->>'o')::uuid from res where name='s10o')) ? 'no_hasil' and (pg_temp.layer(pg_temp.ref('s10'),'q10')).unit_cost=50 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s10')),'810004')=-100,'S10 opname sebagian: selisih +2 pada HPP 50 = 100');
select pg_temp.ok(pg_temp.sq(pg_temp.wa(),'out10')=4,'S10 barang di luar lingkup tidak tersentuh');

-- ═════════ S11 idempoten ═════════
select pg_temp.post('s11',pg_temp.wa(),'{"idem":8}');
select pg_temp.ok((select count(*) from public.opname_results where order_id=(pg_temp.rr('s11')->>'order_id')::uuid)=1 and pg_temp.jcount('opname',pg_temp.ref('s11'))=1 and (pg_temp.layer(pg_temp.ref('s11'),'idem')).unit_cost=80,'S11 posting pertama: 1 hasil, 1 jurnal, lapisan 80');
do $$declare r jsonb;begin
 perform pg_temp.as_(pg_temp.owner());
 r:=public.post_opname_atomic((pg_temp.rr('s11')->>'order_id')::uuid,pg_temp.today(),pg_temp.cnt('{"idem":8}'));
 insert into res values('s11again',r);end$$;
select pg_temp.ok((pg_temp.rr('s11again')->>'already_posted')::boolean and pg_temp.rr('s11again')->>'no_hasil'=pg_temp.ref('s11') and pg_temp.n(pg_temp.rr('s11again'),'surplus_value')=160,'S11 posting ulang dengan isi sama: jawaban lama (already_posted), nilai kuitansi sama');
select pg_temp.ok((select count(*) from public.opname_results where order_id=(pg_temp.rr('s11')->>'order_id')::uuid)=1 and pg_temp.jcount('opname',pg_temp.ref('s11'))=1 and (select count(*) from public.stock_layers where source='opname' and source_ref=pg_temp.ref('s11'))=1 and (select count(*) from public.stock_moves where source='opname' and source_ref=pg_temp.ref('s11'))=1 and pg_temp.sq(pg_temp.wa(),'idem')=8,'S11 tidak ada hasil/jurnal/lapisan/mutasi ganda dan stok tetap 8');
select pg_temp.ok((select count(*) from public.opname_posting_receipts where order_id=(pg_temp.rr('s11')->>'order_id')::uuid)=1,'S11 tepat satu kuitansi posting');
do $$begin perform pg_temp.as_(pg_temp.owner());end$$;
select pg_temp.reject('select public.post_opname_atomic('''||(pg_temp.rr('s11')->>'order_id')||'''::uuid,pg_temp.today(),pg_temp.cnt(''{"idem":9}''))','sudah diposting dengan hitungan atau tanggal berbeda','S11 hitungan berbeda pada perintah yang sama ditolak');

-- ═════════ S14 periode akuntansi tutup ═════════
update accounting_locks set closed_until=pg_temp.today();
select pg_temp.ok(pg_temp.tryp('s14a',pg_temp.wa(),'{"cl":5}') like '%ditutup%','S14 periode ditutup sampai hari ini: posting hari ini ditolak');
select pg_temp.ok(pg_temp.tryp('s14b',pg_temp.wa(),'{"cl":5}',null,pg_temp.today()-2) like '%ditutup%','S14 tanggal sebelum batas tutup ditolak');
select pg_temp.ok(pg_temp.sq(pg_temp.wa(),'cl')=3 and not exists(select 1 from public.stock_layers where item_id=pg_temp.iid('cl') and source='opname') and not exists(select 1 from public.opname_results r join public.opname_orders o on o.id=r.order_id where o.no_opname in('OPO.SX.s14a','OPO.SX.s14b')),'S14 penolakan tidak meninggalkan lapisan, hasil, atau perubahan stok');
update accounting_locks set closed_until=null;
select pg_temp.ok(pg_temp.tryp('s14c',pg_temp.wa(),'{"cl":5}')='OK','S14 setelah periode dibuka posting berhasil');

-- ═════════ S15 gerbang peran ═════════
select pg_temp.ok(pg_temp.tryp('s15a',pg_temp.wa(),'{"gt":4}','5a100000-0000-4000-8000-000000000005') not in('OK',''),'S15 Admin Online ditolak (peran tetap terpagar)');
select pg_temp.ok(pg_temp.tryp('s15b',pg_temp.wa(),'{"gt":4}','5a100000-0000-4000-8000-000000000007') like '%Akses posting opname ditolak%','S15 dokter tanpa modul pos dan tanpa shift petshop ditolak');
select pg_temp.ok(pg_temp.tryp('s15g',pg_temp.wa(),'{"gt":4}','5a100000-0000-4000-8000-000000000004')='OK','S15 STAF dengan modul pos cabang yang sama boleh (kasir opname)');
select pg_temp.ok(pg_temp.tryp('s15c',pg_temp.wa(),'{"gt":4}','5a100000-0000-4000-8000-000000000006') like '%tidak dapat diakses%','S15 FINANCE cabang lain ditolak');
select pg_temp.ok(pg_temp.tryp('s15d',pg_temp.wa(),'{"gt":4}','5a100000-0000-4000-8000-0000000000ff') like '%ditolak%','S15 pengguna tak dikenal ditolak');
select pg_temp.ok(pg_temp.tryp('s15e',pg_temp.wa(),'{"gt":4}','5a100000-0000-4000-8000-000000000002')='OK','S15 ADMIN cabang yang sama boleh (bukan khusus Owner)');
select pg_temp.ok(pg_temp.tryp('s15f',pg_temp.wa(),'{"gt":4}','5a100000-0000-4000-8000-000000000003')='OK','S15 FINANCE cabang yang sama boleh');
select pg_temp.ok(pg_temp.sq(pg_temp.wa(),'gt')=3,'S15 percobaan yang ditolak/dibatalkan tidak mengubah stok');
do $$begin perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','',true);end$$;
select pg_temp.reject('select public.post_opname_atomic(pg_temp.ord(''s15nolog'',pg_temp.wa()),pg_temp.today(),pg_temp.cnt(''{"gt":4}''))','Akses posting opname ditolak','S15 tanpa login ditolak');

-- ═════════ S16 koreksi opname ═════════
-- 16a: seperti kasus Muara OPR.00003: baris selisih 0 dikoreksi menambah 31 unit (dulu lapisan Rp0 tanpa jurnal)
select pg_temp.ok(pg_temp.post('s16a',pg_temp.wa(),'{"bp":27}') ? 'no_hasil' and pg_temp.jcount('opname',pg_temp.ref('s16a'))=0,'S16a opname tanpa selisih diposting (tanpa jurnal)');
create function pg_temp.corr(label text,rows jsonb,key text) returns jsonb language plpgsql as $$
declare rj jsonb;prev jsonb;res_ jsonb;doc uuid:=(pg_temp.rr(label)->>'result_id')::uuid;begin
 select jsonb_agg(jsonb_build_object('item_id',pg_temp.iid(k),'qty',v)) into rj from jsonb_each(rows) e(k,v);
 perform pg_temp.as_(pg_temp.owner());
 prev:=public.preview_stock_document_correction('opname',doc,rj);
 res_:=public.correct_stock_document('opname',doc,rj,'Koreksi fiktif SX',key,prev->>'token');
 return res_||jsonb_build_object('preview',prev);end$$;
do $$begin insert into res select 's16ac',pg_temp.corr('s16a','{"bp":58}','sx-16a');end$$;
select pg_temp.ok(pg_temp.rr('s16ac') ? 'correction_id','S16a koreksi +31 berhasil');
select pg_temp.ok((select unit_cost from public.stock_layers where source='stock-correction' and source_ref=(pg_temp.rr('s16ac')->>'correction_id') and item_id=pg_temp.iid('bp'))=12960.5 and (select qty_in from public.stock_layers where source='stock-correction' and source_ref=(pg_temp.rr('s16ac')->>'correction_id') and item_id=pg_temp.iid('bp'))=31,'S16a lapisan koreksi: 31 unit pada HPP rata-rata 12.960,5 (dulu Rp0)');
select pg_temp.ok(pg_temp.n(pg_temp.gl('stock-correction',pg_temp.rr('s16ac')->>'correction_id'),'170001')=401775.5 and pg_temp.n(pg_temp.gl('stock-correction',pg_temp.rr('s16ac')->>'correction_id'),'810004')=-401775.5 and not (pg_temp.gl('stock-correction',pg_temp.rr('s16ac')->>'correction_id') ? '720010'),'S16a jurnal pengganti: Dr 170001 / Cr 810004 Rp401.775,50 (31 x 12.960,5)');
select pg_temp.ok((select replacement_journal_id from public.stock_document_corrections where id=(pg_temp.rr('s16ac')->>'correction_id')::uuid) is not null and cardinality((select reversal_journal_ids from public.stock_document_corrections where id=(pg_temp.rr('s16ac')->>'correction_id')::uuid))=0,'S16a tercatat: ada jurnal pengganti, tanpa pembalikan (dokumen asal tanpa jurnal)');
select pg_temp.ok(pg_temp.balanced('stock-correction',pg_temp.rr('s16ac')->>'correction_id') and pg_temp.sq(pg_temp.wa(),'bp')=58,'S16a jurnal seimbang, stok 58');
-- 16b: koreksi dokumen campuran (S3): jurnal asal dibalik persis, pengganti neto
select pg_temp.post('s16b',pg_temp.wa(),'{"p16":13,"m16":0}');
select pg_temp.ok(pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s16b')),'720010')=200 and pg_temp.jcount('opname',pg_temp.ref('s16b'))=1,'S16b dokumen asal: jurnal neto 200');
do $$begin insert into res select 's16bc',pg_temp.corr('s16b','{"p16":15,"m16":3}','sx-16b');end$$;
select pg_temp.ok(pg_temp.n(pg_temp.gl('stock-correct-reverse',pg_temp.rr('s16bc')->>'correction_id'),'170001')=200 and pg_temp.n(pg_temp.gl('stock-correct-reverse',pg_temp.rr('s16bc')->>'correction_id'),'720010')=-200,'S16b pembalikan: jurnal asal dibalik persis (170001 +200, 720010 -200)');
select pg_temp.ok(pg_temp.n(pg_temp.gl('stock-correction',pg_temp.rr('s16bc')->>'correction_id'),'170001')=300 and pg_temp.n(pg_temp.gl('stock-correction',pg_temp.rr('s16bc')->>'correction_id'),'720010')=0 and pg_temp.n(pg_temp.gl('stock-correction',pg_temp.rr('s16bc')->>'correction_id'),'810004')=-300,'S16b pengganti neto: lebih 500 (5 x 100) - kurang 200 (2 x 100): 720010 0, 810004 -300, persediaan +300');
select pg_temp.ok(pg_temp.n(pg_temp.glr('stock-correction',pg_temp.rr('s16bc')->>'correction_id')->'720010','d')=200 and pg_temp.n(pg_temp.glr('stock-correction',pg_temp.rr('s16bc')->>'correction_id')->'720010','c')=200,'S16b pengganti: garis kotor 720010 D200/K200');
select pg_temp.ok(pg_temp.balanced('stock-correction',pg_temp.rr('s16bc')->>'correction_id') and pg_temp.balanced('stock-correct-reverse',pg_temp.rr('s16bc')->>'correction_id'),'S16b pembalikan dan pengganti seimbang');
-- 16c: bentuk "lama" (lebih Rp0 dijurnal tanpa baris lebih) dikoreksi sesudah ada harga -> lebih dinilai HPP rata-rata
select pg_temp.lay(pg_temp.wa(),'z6',5,80);
do $$begin insert into res select 's16cc',pg_temp.corr('s6','{"z6":4,"m6":0}','sx-16c');end$$;
select pg_temp.ok(pg_temp.n(pg_temp.gl('stock-correct-reverse',pg_temp.rr('s16cc')->>'correction_id'),'170001')=100 and pg_temp.n(pg_temp.gl('stock-correct-reverse',pg_temp.rr('s16cc')->>'correction_id'),'720010')=-100,'S16c pembalikan jurnal asal (kurang 100) persis');
select pg_temp.ok(pg_temp.n(pg_temp.gl('stock-correction',pg_temp.rr('s16cc')->>'correction_id'),'170001')=220 and pg_temp.n(pg_temp.gl('stock-correction',pg_temp.rr('s16cc')->>'correction_id'),'810004')=-220 and pg_temp.n(pg_temp.gl('stock-correction',pg_temp.rr('s16cc')->>'correction_id'),'720010')=0,'S16c pengganti: lebih 4 x 80 = 320 dikurangi kurang 100 -> 810004 -220');
select pg_temp.ok((select unit_cost from public.stock_layers where source='stock-correction' and source_ref=(pg_temp.rr('s16cc')->>'correction_id') and item_id=pg_temp.iid('z6'))=80,'S16c lapisan koreksi barang lebih pada HPP rata-rata 80 (bukan 0)');
-- 16d: penyesuaian persediaan (bukan opname) TIDAK berubah: lebih tetap harga master
do $$declare r jsonb;begin perform pg_temp.as_(pg_temp.owner());
 r:=public.post_inventory_adjustment_atomic('sx-adj-1',pg_temp.wa(),pg_temp.today(),'temuan','fiktif',jsonb_build_array(jsonb_build_object('item_id',pg_temp.iid('adj'),'qty_baru',5)));
 insert into res values('adj',r);end$$;
select pg_temp.ok(pg_temp.n(pg_temp.gl('penyesuaian',pg_temp.rr('adj')->>'no_adj'),'170001')=90 and pg_temp.n(pg_temp.gl('penyesuaian',pg_temp.rr('adj')->>'no_adj'),'810004')=-90,'S16d penyesuaian persediaan lebih: tetap harga master 30 x 3 = 90 (tidak berubah)');

-- 16e: koreksi PENYESUAIAN persediaan tetap memakai harga master (aturan baru hanya untuk opname)
do $$declare r jsonb;begin perform pg_temp.as_(pg_temp.owner());
 r:=public.post_inventory_adjustment_atomic('sx-adj-2',pg_temp.wa(),pg_temp.today(),'temuan','fiktif',jsonb_build_array(jsonb_build_object('item_id',pg_temp.iid('adj2'),'qty_baru',6)));
 insert into res values('adj2',r);end$$;
select pg_temp.ok((select unit_cost from public.stock_layers where source='penyesuaian' and item_id=pg_temp.iid('adj2') limit 1)=30,'S16e penyesuaian lebih awal dinilai harga master 30 (tidak berubah)');
do $$declare prev jsonb;res_ jsonb;rj jsonb:=jsonb_build_array(jsonb_build_object('item_id',pg_temp.iid('adj2'),'qty',9));doc uuid:=(pg_temp.rr('adj2')->>'adjustment_id')::uuid;begin
 perform pg_temp.as_(pg_temp.owner());
 prev:=public.preview_stock_document_correction('adjustment',doc,rj);
 res_:=public.correct_stock_document('adjustment',doc,rj,'Koreksi fiktif SX adj','sx-16e',prev->>'token');
 insert into res values('adj2c',res_);end$$;
select pg_temp.ok((select unit_cost from public.stock_layers where source='stock-correction' and source_ref=(pg_temp.rr('adj2c')->>'correction_id') and item_id=pg_temp.iid('adj2'))=30,'S16e koreksi penyesuaian: tambahan tetap pada harga master 30 (bukan HPP rata-rata lapisan)');

-- ═════════ S17 rata-rata bergerak ═════════
update inventory_costing_settings set method='moving_average',activated_at=now() where id;
select pg_temp.lay(pg_temp.wa(),'av1',4,100,0);select pg_temp.lay(pg_temp.wa(),'av1',4,200,0);
select pg_temp.ok((select average_cost from public.stock where warehouse_id=pg_temp.wa() and item_id=pg_temp.iid('av1'))=150,'S17 prasyarat: average_cost barang av1 = 150');
select pg_temp.ok((pg_temp.cost(pg_temp.wa(),'av1')->>'unit_cost')::numeric=150 and pg_temp.cost(pg_temp.wa(),'av1')->>'source'='HPP rata-rata bergerak gudang','S17 mode average: biaya = stock.average_cost 150');
select pg_temp.post('s17',pg_temp.wa(),'{"av1":10}');
select pg_temp.ok((pg_temp.layer(pg_temp.ref('s17'),'av1')).unit_cost=150 and pg_temp.n(pg_temp.gl('opname',pg_temp.ref('s17')),'810004')=-300,'S17 selisih lebih 2 x 150 = 300 pada HPP average');
select pg_temp.ok((select average_cost from public.stock where warehouse_id=pg_temp.wa() and item_id=pg_temp.iid('av1'))=150 and (select qty from public.stock where warehouse_id=pg_temp.wa() and item_id=pg_temp.iid('av1'))=10,'S17 average_cost tetap 150 setelah posting (menambah pada rata-rata tidak merusak rata-rata), stok 10');
select pg_temp.ok((pg_temp.mv('opname',pg_temp.ref('s17'),'av1')).cost_method='moving_average','S17 mutasi tercatat metode moving_average');
select pg_temp.ok(pg_temp.snap('s17','av1')->>'sumber_nilai_modal'='HPP rata-rata stok masuk yang dijurnal' and pg_temp.n(pg_temp.snap('s17','av1'),'nilai_selisih_modal')=300,'S17 laporan harga mode average: lebih 300');
update inventory_costing_settings set method='fifo',activated_at=null where id;

-- ═════════ S18 ACL, konfigurasi, pagar Admin Online ═════════
select pg_temp.ok(not has_function_privilege('anon','public.opname_surplus_cost(uuid,uuid,numeric)','EXECUTE') and not has_function_privilege('authenticated','public.opname_surplus_cost(uuid,uuid,numeric)','EXECUTE') and not has_function_privilege('service_role','public.opname_surplus_cost(uuid,uuid,numeric)','EXECUTE'),'S18 opname_surplus_cost tidak bisa dipanggil anon/authenticated/service_role');
select pg_temp.ok(not exists(select 1 from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.opname_surplus_cost(uuid,uuid,numeric)'::regprocedure and a.grantee=0),'S18 opname_surplus_cost tanpa EXECUTE untuk PUBLIC');
select pg_temp.ok(has_function_privilege('authenticated','public.post_opname_atomic(uuid,date,jsonb)','EXECUTE') and not has_function_privilege('anon','public.post_opname_atomic(uuid,date,jsonb)','EXECUTE'),'S18 post_opname_atomic: authenticated boleh, anon tidak');
select pg_temp.ok(not exists(select 1 from pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid='public.post_opname_atomic(uuid,date,jsonb)'::regprocedure and a.grantee=0),'S18 post_opname_atomic tanpa EXECUTE untuk PUBLIC');
select pg_temp.ok(has_function_privilege('authenticated','public.correct_stock_document(text,uuid,jsonb,text,text,text)','EXECUTE') and not has_function_privilege('anon','public.correct_stock_document(text,uuid,jsonb,text,text,text)','EXECUTE') and not has_function_privilege('authenticated','public.stock_correction_plan(text,uuid,jsonb)','EXECUTE'),'S18 koreksi: correct_stock_document authenticated boleh, perencana tidak');
select pg_temp.ok((select prosecdef and coalesce(array_to_string(proconfig,','),'') like '%search_path=""%' and pg_get_userbyid(proowner)='postgres' from pg_proc where oid='public.opname_surplus_cost(uuid,uuid,numeric)'::regprocedure),'S18 opname_surplus_cost: SECURITY DEFINER, search_path kosong, pemilik postgres');
select pg_temp.ok((select prosecdef and coalesce(array_to_string(proconfig,','),'') like '%search_path=""%' and coalesce(array_to_string(proconfig,','),'') like '%lock_timeout=8s%' from pg_proc where oid='public.post_opname_atomic(uuid,date,jsonb)'::regprocedure),'S18 post_opname_atomic: konfigurasi (search_path kosong, lock_timeout 8s) tetap');
select pg_temp.ok((select prosecdef and coalesce(array_to_string(proconfig,','),'') like '%search_path=""%' from pg_proc where oid='public.correct_stock_document(text,uuid,jsonb,text,text,text)'::regprocedure) and (select prosecdef and coalesce(array_to_string(proconfig,','),'') like '%search_path=""%' from pg_proc where oid='public.stock_correction_plan(text,uuid,jsonb)'::regprocedure),'S18 koreksi: SECURITY DEFINER + search_path kosong tetap');
select pg_temp.ok(position('deny_admin_online' in pg_get_functiondef('public.opname_surplus_cost(uuid,uuid,numeric)'::regprocedure))>0,'S18 opname_surplus_cost memanggil deny_admin_online');
do $$begin perform pg_temp.as_('5a100000-0000-4000-8000-000000000005');end$$;
select pg_temp.reject('select * from public.opname_surplus_cost(pg_temp.wa(),pg_temp.iid(''p1''),0)','','S18 aturan biaya menolak sesi Admin Online (walau dipanggil langsung)');
do $$begin perform pg_temp.as_(pg_temp.owner());end$$;
-- anon/authenticated tidak bisa memanggil aturan biaya
create function pg_temp.callas(role_ text,stmt text) returns text language plpgsql as $$
begin begin execute 'set local role '||role_;execute stmt;execute 'reset role';raise exception 'TRY_OK';
 exception when others then return case when sqlerrm='TRY_OK' then 'OK' else sqlerrm end;end;end$$;
select pg_temp.ok(pg_temp.callas('anon','select * from public.opname_surplus_cost(pg_temp.wa(),pg_temp.iid(''p1''),0)') like '%permission denied%','S18 anon ditolak (permission denied)');
select pg_temp.ok(pg_temp.callas('authenticated','select * from public.opname_surplus_cost(pg_temp.wa(),pg_temp.iid(''p1''),0)') like '%permission denied%','S18 authenticated ditolak (permission denied)');
select pg_temp.ok(pg_temp.callas('anon','select public.post_opname_atomic(gen_random_uuid(),current_date,''{}''::jsonb)') like '%permission denied%','S18 anon tidak bisa memanggil posting opname');

-- ═════════ S20 lapisan pembelian yang sudah dibatalkan tidak ikut rata-rata ═════════
create table public.sx_reversed(id uuid primary key);
insert into public.sx_reversed select id from public.stock_layers where item_id=pg_temp.iid('rv') and unit_cost=500;
create or replace function public.stock_layer_cost_was_reversed(p_layer_id uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.sx_reversed where id=p_layer_id)$$;
select pg_temp.ok((pg_temp.cost(pg_temp.wa(),'rv')->>'unit_cost')::numeric=100,'S20 lapisan 5@500 yang biayanya dibatalkan diabaikan: HPP rata-rata 100 (bukan 300)');
select pg_temp.ok(pg_temp.post('s20',pg_temp.wa(),'{"rv":13}') ? 'no_hasil' and (pg_temp.layer(pg_temp.ref('s20'),'rv')).unit_cost=100,'S20 posting memakai 100');

-- ═════════ S19 invarian akhir ═════════
select pg_temp.ok((select coalesce(sum(debit-credit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id where e.source in('opname','stock-correction','stock-correct-reverse'))=0,'S19 neraca percobaan seluruh jurnal opname/koreksi = 0');
select pg_temp.ok(not exists(select 1 from public.journal_lines where debit<0 or credit<0 or (debit>0 and credit>0)),'S19 tidak ada baris jurnal negatif atau debit+kredit sekaligus');
select pg_temp.ok(not exists(select 1 from public.stock s where s.qty>=0 and s.qty is distinct from coalesce((select sum(l.qty_left) from public.stock_layers l where l.warehouse_id=s.warehouse_id and l.item_id=s.item_id),0) and s.item_id in(select id from it)),'S19 untuk semua barang uji stok = jumlah sisa lapisan');
select pg_temp.ok((select count(*) from public.opname_results)>=16,'S19 sejumlah dokumen hasil terbentuk');
select pg_temp.ok(not exists(select 1 from public.journal_entries e where e.source='opname' and (select count(*) from public.journal_entries x where x.source='opname' and x.source_ref=e.source_ref)>1),'S19 tidak ada dokumen opname dengan lebih dari satu jurnal');
select pg_temp.ok(not exists(select 1 from public.stock_layers where source='opname' and unit_cost=0 and item_id in(select id from it where code not in('z6'))),'S19 tidak ada lapisan opname Rp0 kecuali barang yang memang tanpa harga (z6)');
rollback;
