-- KOREKSI-SO-PER-BARIS (migrasi *_koreksi_so_per_baris): fictional fixtures in disposable PostgreSQL only; everything rolls back.
-- Aturan yang dibuktikan: koreksi opname/penyesuaian hanya memblokir baris yang DIUBAH dan yang lapisan/mutasi sumbernya sendiri terpakai/berubah;
-- baris yang tidak diubah tidak disentuh walau lapisannya terpakai (kasus OPR.00009); baris yang diubah dan tertahan memuat nama barang + alasan;
-- jurnal tetap satu jurnal pembalik persis + satu jurnal pengganti neto per dokumen (baris tak disentuh persis seperti jurnal asal);
-- selisih lebih bernilai HPP rata-rata (PR #580); beban karyawan (kasbon) menahan baris yang berdampak dengan pesan nama + nominal; rantai revisi;
-- idempotensi; periode tutup; rollback; ACL/Admin Online/peran.
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
 ('5c100000-0000-4000-8000-000000000001','{"full_name":"KR owner"}'),('5c100000-0000-4000-8000-000000000002','{"full_name":"KR admin"}'),
 ('5c100000-0000-4000-8000-000000000003','{"full_name":"KR owner nonaktif"}'),('5c100000-0000-4000-8000-000000000004','{"full_name":"KR admin online"}'),
 ('5c100000-0000-4000-8000-000000000005','{"full_name":"KR finance"}');
update profiles set role='OWNER',is_active=true where id='5c100000-0000-4000-8000-000000000001';
update profiles set role='ADMIN',is_active=true where id='5c100000-0000-4000-8000-000000000002';
update profiles set role='OWNER',is_active=false where id='5c100000-0000-4000-8000-000000000003';
update profiles set role='ADMIN_ONLINE',is_active=true where id='5c100000-0000-4000-8000-000000000004';
update profiles set role='FINANCE',is_active=true where id='5c100000-0000-4000-8000-000000000005';
insert into role_capabilities(role,all_branches,create_accounts) values('ADMIN',false,false),('FINANCE',false,false) on conflict(role) do update set all_branches=false;
insert into branches(id,code,name,type) values('5c200000-0000-4000-8000-000000000001','KRA','KR klinik A','KLINIK'),('5c200000-0000-4000-8000-000000000002','KRB','KR petshop B','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values('5c300000-0000-4000-8000-000000000001','5c200000-0000-4000-8000-000000000001','KRWA','KR gudang A','VET'),
 ('5c300000-0000-4000-8000-000000000002','5c200000-0000-4000-8000-000000000002','KRWB','KR gudang B','RETAIL');
insert into user_branches(user_id,branch_id) values('5c100000-0000-4000-8000-000000000002','5c200000-0000-4000-8000-000000000001'),('5c100000-0000-4000-8000-000000000005','5c200000-0000-4000-8000-000000000001');
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active) values('170001','Persediaan fiktif','ASET','D',false,true),('720010','Beban selisih stok fiktif','BEBAN','D',false,true),
 ('810004','Pendapatan lain-lain fiktif','PENDAPATAN','K',false,true),('182001','Kasbon karyawan fiktif','ASET','D',false,true) on conflict(code) do update set is_active=true,is_header=false;
update accounting_locks set closed_until=null;
insert into public.employees(id,nama,status,branch_id) values('5c400000-0000-4000-8000-000000000001','Budi Karyawan KR','Aktif','5c200000-0000-4000-8000-000000000001'),
 ('5c400000-0000-4000-8000-000000000002','Sari Karyawan KR','Aktif','5c200000-0000-4000-8000-000000000001');

create temp table it(code text primary key,id uuid);grant all on it to public;
create temp table res(name text primary key,r jsonb);grant all on res to public;
create temp table seq(n int);insert into seq values(0);grant all on seq to public;
create function pg_temp.wa() returns uuid language sql as $$select '5c300000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.owner() returns text language sql as $$select '5c100000-0000-4000-8000-000000000001'$$;
create function pg_temp.iid(c text) returns uuid language sql as $$select id from it where code=c$$;
create function pg_temp.mk(c text,sell numeric default 1000,buy numeric default 0) returns void language plpgsql as $$begin
 insert into it values(c,gen_random_uuid());
 insert into public.items(id,code,name,unit,item_type,buy_price,sell_price) values(pg_temp.iid(c),'KR-'||c,'Barang '||c,'PCS','Persediaan',buy,sell);
 insert into public.stock(warehouse_id,item_id,qty) values(pg_temp.wa(),pg_temp.iid(c),0) on conflict do nothing;end$$;
create function pg_temp.lay(c text,qty numeric,cost numeric,daysago int default 5) returns void language plpgsql as $$begin
 update seq set n=n+1;
 perform public.stock_in_fifo(pg_temp.wa(),pg_temp.iid(c),qty,cost,'fixture','FX-'||c||'-'||(select n from seq),pg_temp.today()-daysago,null);end$$;
-- spec: [{"c":"kode","sell":n,"buy":n,"layers":[[qty,cost],..],"count":fisik}]
create function pg_temp.doc(label text,spec jsonb) returns jsonb language plpgsql as $$
declare e jsonb;l jsonb;o uuid:=gen_random_uuid();counts jsonb:='{}';r jsonb;code text;begin
 for e in select * from jsonb_array_elements(spec) loop
  code:=label||'.'||(e->>'c');
  perform pg_temp.mk(code,coalesce((e->>'sell')::numeric,1000),coalesce((e->>'buy')::numeric,0));
  for l in select * from jsonb_array_elements(coalesce(e->'layers','[]')) loop perform pg_temp.lay(code,(l->>0)::numeric,(l->>1)::numeric,coalesce((l->>2)::int,5));end loop;
  counts:=counts||jsonb_build_object(pg_temp.iid(code)::text,(e->>'count')::numeric);
 end loop;
 insert into public.opname_orders(id,no_opname,warehouse_id,penanggung_jawab) values(o,'OPO.KR.'||label,pg_temp.wa(),'Penghitung fiktif');
 perform pg_temp.as_(pg_temp.owner());
 r:=public.post_opname_atomic(o,pg_temp.today(),counts);
 insert into res values(label,r||jsonb_build_object('order_id',o)) on conflict(name) do update set r=excluded.r;return r;end$$;
create function pg_temp.rid(label text) returns uuid language sql as $$select (r->>'result_id')::uuid from res where name=label$$;
create function pg_temp.kd(label text) returns text language sql as $$select coalesce(r->>'kind','opname') from res where name=label$$;
create function pg_temp.ref(label text) returns text language sql as $$select r->>'no_hasil' from res where name=label$$;
create function pg_temp.id(label text,c text) returns uuid language sql as $$select pg_temp.iid(label||'.'||c)$$;
-- seluruh baris dokumen (hasil efektif terakhir) dengan jumlah dasar; ch = {"kode":qty} menimpa
create function pg_temp.rows_all(label text,ch jsonb) returns jsonb language plpgsql as $$
declare d uuid:=pg_temp.rid(label);begin
 perform pg_temp.as_(pg_temp.owner());
 return (select jsonb_agg(jsonb_build_object('item_id',x->>'item_id','qty',coalesce((ch->>substr(c.code,length(label)+2))::numeric,(x->>'qty')::numeric)) order by x->>'item_id')
  from jsonb_array_elements(public.get_stock_document_correction(pg_temp.kd(label),d)->'rows') x left join it c on c.id=(x->>'item_id')::uuid);end$$;
create function pg_temp.pv(label text,ch jsonb) returns jsonb language plpgsql as $$begin
 perform pg_temp.as_(pg_temp.owner());
 return public.preview_stock_document_correction(pg_temp.kd(label),pg_temp.rid(label),pg_temp.rows_all(label,ch));end$$;
-- galat atau 'OK' (sub-transaksi dibatalkan: tidak ada efek)
create function pg_temp.pve(label text,ch jsonb) returns text language plpgsql as $$begin
 begin perform pg_temp.pv(label,ch);raise exception 'TRY_OK';
 exception when others then return case when sqlerrm='TRY_OK' then 'OK' else sqlerrm end;end;end$$;
create function pg_temp.cr(label text,ch jsonb,key text default null) returns jsonb language plpgsql as $$
declare p jsonb;rws jsonb;k text;r jsonb;begin
 update seq set n=n+1;k:=coalesce(key,'kr-'||label||'-'||(select n from seq));
 perform pg_temp.as_(pg_temp.owner());rws:=pg_temp.rows_all(label,ch);
 p:=public.preview_stock_document_correction(pg_temp.kd(label),pg_temp.rid(label),rws);
 insert into res values('rows:'||k,jsonb_build_object('rows',rws,'tok',p->>'token')) on conflict(name) do update set r=excluded.r;
 r:=public.correct_stock_document(pg_temp.kd(label),pg_temp.rid(label),rws,'Koreksi fiktif KR',k,p->>'token');
 insert into res values(label||'.cr'||coalesce((r->>'revision'),'?'),r) on conflict(name) do update set r=excluded.r;return r;end$$;
create function pg_temp.retry(label text,k text,reason text default 'Koreksi fiktif KR') returns jsonb language plpgsql as $$
declare s jsonb:=(select r from res where name='rows:'||k);begin
 perform pg_temp.as_(pg_temp.owner());
 return public.correct_stock_document(pg_temp.kd(label),pg_temp.rid(label),s->'rows',reason,k,s->>'tok');end$$;
create function pg_temp.cre(label text,ch jsonb) returns text language plpgsql as $$begin
 begin perform pg_temp.cr(label,ch);raise exception 'TRY_OK';
 exception when others then return case when sqlerrm='TRY_OK' then 'OK' else sqlerrm end;end;end$$;
-- mutasi SESUDAH SO: created_at digeser 1 jam ke depan (semua fixture satu transaksi sehingga created_at sama)
create function pg_temp.sale(label text,c text,qty numeric,src text default 'sale') returns void language plpgsql as $$
declare r text:='KR-'||src||'-'||label||'-'||c||'-'||(select n from seq);begin
 update seq set n=n+1;
 perform public.stock_out_fifo(pg_temp.wa(),pg_temp.id(label,c),qty,src,r,pg_temp.today());
 update public.stock_moves set created_at=created_at+interval '1 hour' where source=src and source_ref=r;end$$;
create function pg_temp.sq(label text,c text) returns numeric language sql as $$select qty from public.stock where warehouse_id=pg_temp.wa() and item_id=pg_temp.id(label,c)$$;
create function pg_temp.lv(label text,c text) returns numeric language sql as $$select coalesce(sum(qty_left*unit_cost),0) from public.stock_layers where warehouse_id=pg_temp.wa() and item_id=pg_temp.id(label,c)$$;
create function pg_temp.lq(label text,c text) returns numeric language sql as $$select coalesce(sum(qty_left),0) from public.stock_layers where warehouse_id=pg_temp.wa() and item_id=pg_temp.id(label,c)$$;
-- sidik utuh stok + lapisan + kartu stok satu barang (untuk membuktikan 'tidak disentuh')
create function pg_temp.snap(label text,c text) returns text language sql as $$
 select md5(coalesce((select jsonb_agg(to_jsonb(s) order by s.warehouse_id)::text from public.stock s where s.item_id=pg_temp.id(label,c) and s.warehouse_id=pg_temp.wa()),'')||
  coalesce((select jsonb_agg(to_jsonb(l) order by l.id)::text from public.stock_layers l where l.item_id=pg_temp.id(label,c)),'')||
  coalesce((select jsonb_agg(to_jsonb(m) order by m.id)::text from public.stock_moves m where m.item_id=pg_temp.id(label,c)),''))$$;
create function pg_temp.cids(label text) returns text[] language sql as $$select coalesce(array_agg(id::text order by revision),'{}') from public.stock_document_corrections where kind=pg_temp.kd(label) and document_id=pg_temp.rid(label)$$;
-- saldo bersih per akun: jurnal SO asal + semua jurnal koreksi dokumen itu
create function pg_temp.gall(label text) returns jsonb language sql as $$
 select coalesce(jsonb_object_agg(code,net),'{}') from (select a.code,sum(l.debit-l.credit) net from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
  join public.journal_entries e on e.id=l.entry_id where (e.source=case pg_temp.kd(label) when 'opname' then 'opname' else 'penyesuaian' end and e.source_ref=pg_temp.ref(label)) or (e.source in('stock-correct-reverse','stock-correction') and e.source_ref=any(pg_temp.cids(label))) group by a.code) x$$;
create function pg_temp.g(label text,code text) returns numeric language sql as $$select coalesce((pg_temp.gall(label)->>code)::numeric,0)$$;
create function pg_temp.gs(src text,ref text) returns jsonb language sql as $$
 select coalesce(jsonb_object_agg(code,net),'{}') from (select a.code,sum(l.debit-l.credit) net from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
  join public.journal_entries e on e.id=l.entry_id where e.source=src and e.source_ref=ref group by a.code) x$$;
create function pg_temp.gsn(src text,ref text,code text) returns numeric language sql as $$select coalesce((pg_temp.gs(src,ref)->>code)::numeric,0)$$;
create function pg_temp.jc(src text,ref text) returns int language sql as $$select count(*)::int from public.journal_entries where source=src and source_ref=ref$$;
create function pg_temp.cid(label text,rev int) returns text language sql as $$select (pg_temp.cids(label))[rev]$$;
create function pg_temp.unbalanced() returns int language sql as $$
 select count(*)::int from (select e.id from public.journal_entries e join public.journal_lines l on l.entry_id=e.id group by e.id having sum(l.debit-l.credit)<>0) x$$;
create function pg_temp.blocked_names(p jsonb) returns text language sql as $$select coalesce(string_agg(x->>'name',',' order by x->>'name'),'') from jsonb_array_elements(p->'blocked') x$$;
create function pg_temp.blk(p jsonb,label text,c text) returns text language sql as $$
 select x->>'reason' from jsonb_array_elements(p->'blocked') x where x->>'item_id'=pg_temp.id(label,c)::text$$;
-- jurnal SO ala OPR.00009 (aturan lama: lebih bernilai 0): tulis ulang lapisan/mutasi/jurnal baris yang disebut ke biaya 0 menurut pola posting yang sama
create function pg_temp.age_zero(label text,codes text[]) returns void language plpgsql as $$
declare ref text:=pg_temp.ref(label);gain numeric;loss numeric;je uuid;off numeric;c text;begin
 foreach c in array codes loop
  update public.stock_layers set unit_cost=0 where source='opname' and source_ref=ref and item_id=pg_temp.id(label,c);
  update public.stock_moves set unit_cost=0 where source='opname' and source_ref=ref and item_id=pg_temp.id(label,c) and qty>0;
 end loop;
 select coalesce(sum(round(qty*unit_cost,2)) filter(where qty>0),0),coalesce(-sum(qty*unit_cost) filter(where qty<0),0) into gain,loss from public.stock_moves where source='opname' and source_ref=ref;
 select id into je from public.journal_entries where source='opname' and source_ref=ref limit 1;
 delete from public.journal_lines where entry_id=je;
 off:=least(gain,loss);
 insert into public.journal_lines(entry_id,account_id,debit,credit) select je,a.id,v.d,v.c from (values('170001'::text,gain,0::numeric),('170001',0::numeric,loss),('720010',loss,0::numeric),('720010',0::numeric,off),('810004',0::numeric,gain-off)) v(code,d,c)
  join public.coa_accounts a on a.code=v.code where v.d<>0 or v.c<>0;
end$$;

-- ═════════ S1 bentuk OPR.00009: satu baris lapisan terpakai, dua baris lain dikoreksi ═════════
-- Pelontar (lebih 1, lapisan SO lalu dipakai transfer), TH4 (sistem 3, ketik 1000), Shampoo (sistem 15, ketik 3000), baris pengisi lebih/kurang/tetap.
select pg_temp.doc('s1','[
 {"c":"pel","layers":[[6,40]],"count":7},
 {"c":"th4","layers":[[1,256605.34,6],[2,256605.33,5]],"count":1000},
 {"c":"sh","layers":[[15,16305.8]],"count":3000},
 {"c":"sa1","count":12},{"c":"sa2","count":5},
 {"c":"sp1","layers":[[3,10,6],[4,25,5]],"count":9},
 {"c":"ss1","layers":[[7,1234.5678]],"count":4},{"c":"ss2","layers":[[5,333.3333]],"count":1},{"c":"ss3","layers":[[9,77.7777]],"count":8},
 {"c":"un1","layers":[[4,50]],"count":4},{"c":"un2","layers":[[2,70]],"count":2}]');
select pg_temp.age_zero('s1',array['pel','th4','sh','sa1','sa2']);
-- Pelontar: seluruh stok (6 + 1 dari SO) dipindahkan sesudah SO -> lapisan SO terpakai
select pg_temp.ok((select qty_in=1 and qty_left=1 from public.stock_layers where source='opname' and source_ref=pg_temp.ref('s1') and item_id=pg_temp.id('s1','pel')),'S1 prasyarat: lapisan SO Pelontar masuk 1 sisa 1');
select pg_temp.sale('s1','pel',7,'transfer');
select pg_temp.ok((select qty_in=1 and qty_left=0 from public.stock_layers where source='opname' and source_ref=pg_temp.ref('s1') and item_id=pg_temp.id('s1','pel')) and pg_temp.sq('s1','pel')=0,'S1 Pelontar: lapisan hasil SO terpakai (sisa 0), stok 0');
select pg_temp.ok(pg_temp.jc('opname',pg_temp.ref('s1'))=1 and pg_temp.gsn('opname',pg_temp.ref('s1'),'720010')>0 and pg_temp.gsn('opname',pg_temp.ref('s1'),'170001')<0,'S1 jurnal SO ala OPR.00009: satu jurnal, beban selisih 720010 debit, persediaan kredit (kurang > lebih)');
select pg_temp.ok(scale(pg_temp.gsn('opname',pg_temp.ref('s1'),'170001'))>2,'S1 jurnal SO punya pecahan lebih dari 2 desimal (seperti 6.105.896,988 pada OPR.00009)');
create temp table s1pre as select pg_temp.gall('s1') g0,pg_temp.snap('s1','pel') pel,pg_temp.snap('s1','sa1') sa1,pg_temp.snap('s1','sa2') sa2,pg_temp.snap('s1','sp1') sp1,pg_temp.snap('s1','ss1') ss1,pg_temp.snap('s1','ss2') ss2,pg_temp.snap('s1','ss3') ss3,pg_temp.snap('s1','un1') un1,pg_temp.snap('s1','un2') un2;grant all on s1pre to public;
create temp table s1p as select pg_temp.pv('s1','{"th4":1,"sh":0}') p;grant all on s1p to public;
select pg_temp.ok((select (p->>'applied')::int=2 and jsonb_array_length(p->'blocked')=0 and jsonb_array_length(p->'lines')=2 from s1p),'S1 pratinjau: 2 baris diterapkan, 0 tertahan, walau satu baris lain berlapisan terpakai');
select pg_temp.ok((select (p->>'value_delta')::numeric=-757797.67 from s1p),'S1 pratinjau: selisih nilai = -244.587 (Shampoo 15 x 16.305,8) -513.210,67 (TH4 2 lapisan) = -757.797,67');
select pg_temp.ok((select p->'lines'->0->>'new_qty' is not null and (select bool_and((x->>'stock_after')::numeric=case when x->>'item_id'=pg_temp.id('s1','th4')::text then 1 else 0 end) from jsonb_array_elements(p->'lines') x) from s1p),'S1 pratinjau: stok sesudah TH4 = 1, Shampoo = 0');
select pg_temp.ok((select (p->'lines'->0->>'item_id')::uuid<>pg_temp.id('s1','pel') and (p->'lines'->1->>'item_id')::uuid<>pg_temp.id('s1','pel') from s1p),'S1 pratinjau: baris Pelontar tidak ikut diputar ulang');
select pg_temp.ok(pg_temp.sq('s1','th4')=1000 and pg_temp.sq('s1','sh')=3000,'S1 pratinjau tidak mengubah stok');
create temp table s1r as select pg_temp.cr('s1','{"th4":1,"sh":0}','kr-s1-a') r;grant all on s1r to public;
select pg_temp.ok((select (r->>'revision')::int=1 and (r->>'applied')::int=2 and jsonb_array_length(r->'blocked')=0 from s1r),'S1 simpan: revisi 1, 2 baris diterapkan, tidak ada yang tertahan');
select pg_temp.ok(pg_temp.sq('s1','th4')=1 and pg_temp.sq('s1','sh')=0,'S1 stok TH4 1000 -> 1 dan Shampoo 3000 -> 0');
select pg_temp.ok(pg_temp.lq('s1','th4')=1 and pg_temp.lq('s1','sh')=0 and pg_temp.lv('s1','th4')=256605.33 and pg_temp.lv('s1','sh')=0,'S1 lapisan: TH4 tersisa 1 @256.605,33 (FIFO mengambil 2 lapisan tertua), Shampoo habis');
select pg_temp.ok((select pg_temp.snap('s1','pel')=pel and pg_temp.snap('s1','sa1')=sa1 and pg_temp.snap('s1','sa2')=sa2 and pg_temp.snap('s1','sp1')=sp1 from s1pre),'S1 baris tak diubah (Pelontar terpakai, lebih tanpa harga, lebih berharga) tidak tersentuh sama sekali: stok, lapisan, kartu stok sama persis');
select pg_temp.ok((select pg_temp.snap('s1','ss1')=ss1 and pg_temp.snap('s1','ss2')=ss2 and pg_temp.snap('s1','ss3')=ss3 and pg_temp.snap('s1','un1')=un1 and pg_temp.snap('s1','un2')=un2 from s1pre),'S1 baris kurang dan baris selisih nol tidak diubah: sidik stok/lapisan/kartu sama persis');
select pg_temp.ok((select count(distinct item_id) from public.stock_moves where source in('stock-correct-reverse','stock-correction') and source_ref=pg_temp.cid('s1',1))=2 and (select count(*) from public.stock_moves where source='stock-correct-reverse' and source_ref=pg_temp.cid('s1',1))=2 and (select count(*) from public.stock_moves where source='stock-correction' and source_ref=pg_temp.cid('s1',1))=2,'S1 kartu stok koreksi hanya menyentuh 2 barang (2 pembalik + 2 pengganti)');
select pg_temp.ok((select count(*) from public.journal_entries where source='stock-correct-reverse' and source_ref=pg_temp.cid('s1',1))=1 and (select count(*) from public.journal_entries where source='stock-correction' and source_ref=pg_temp.cid('s1',1))=1,'S1 jurnal: satu pembalik + satu pengganti untuk dokumen');
select pg_temp.ok((select pg_temp.gsn('stock-correct-reverse',pg_temp.cid('s1',1),'170001')=-pg_temp.n(g0,'170001') and pg_temp.gsn('stock-correct-reverse',pg_temp.cid('s1',1),'720010')=-pg_temp.n(g0,'720010') and pg_temp.gsn('stock-correct-reverse',pg_temp.cid('s1',1),'810004')=-pg_temp.n(g0,'810004') from s1pre),'S1 jurnal pembalik = cermin persis jurnal SO asal pada tiap akun (termasuk pecahan 3 desimal)');
select pg_temp.ok((select pg_temp.gsn('stock-correction',pg_temp.cid('s1',1),'170001')=pg_temp.n(g0,'170001')-757797.67 from s1pre),'S1 jurnal pengganti persediaan = jurnal asal + selisih baris yang diterapkan, persis (-757.797,67), tanpa sisa pembulatan');
select pg_temp.ok((select pg_temp.gsn('stock-correction',pg_temp.cid('s1',1),'720010')+pg_temp.gsn('stock-correction',pg_temp.cid('s1',1),'810004')=-pg_temp.gsn('stock-correction',pg_temp.cid('s1',1),'170001')),'S1 jurnal pengganti seimbang (persediaan = beban + pendapatan lain)');
select pg_temp.ok(pg_temp.unbalanced()=0,'S1 semua jurnal seimbang');
select pg_temp.ok((select pg_temp.g('s1','170001')=pg_temp.n(g0,'170001')-757797.67 and pg_temp.g('s1','720010')=pg_temp.n(g0,'720010')+757797.67 from s1pre),'S1 saldo bersih dokumen: persediaan turun 757.797,67, beban selisih naik sebesar itu');
select pg_temp.ok((select (select sum(qty_fisik) from public.opname_result_items where result_id=pg_temp.rid('s1'))=7+1000+3000+12+5+9+4+1+8+4+2),'S1 dokumen SO asal tidak berubah (jumlah fisik tercatat)');
select pg_temp.ok(((select (r->>'correction_id') from s1r)=(pg_temp.retry('s1','kr-s1-a')->>'correction_id')) and (select count(*) from public.stock_document_corrections where document_id=pg_temp.rid('s1'))=1,'S1 idempotensi: kunci yang sama mengulang hasil yang sama, koreksi tetap satu');
select pg_temp.ok((public.get_stock_document_correction('opname',pg_temp.rid('s1'))->>'revision')::int=1 and (select (x->>'qty')::numeric from jsonb_array_elements(public.get_stock_document_correction('opname',pg_temp.rid('s1'))->'rows') x where x->>'item_id'=pg_temp.id('s1','th4')::text)=1 and (select (x->>'qty')::numeric from jsonb_array_elements(public.get_stock_document_correction('opname',pg_temp.rid('s1'))->'rows') x where x->>'item_id'=pg_temp.id('s1','pel')::text)=7,'S1 hasil efektif: TH4 = 1, Pelontar tetap 7 (tercatat), revisi 1');
-- Pelontar sendiri tetap tertahan bila diubah
select pg_temp.ok(position('Barang s1.pel' in pg_temp.cre('s1','{"pel":3}'))>0 and position('Koreksi tidak bisa disimpan' in pg_temp.cre('s1','{"pel":3}'))>0,'S1 mengubah Pelontar (lapisan terpakai) sendiri: galat menyebut barang + semua baris diubah tertahan');
-- revisi 2 membawa baris tak disentuh
create temp table s1p2 as select pg_temp.pv('s1','{"th4":2,"pel":3}') p;grant all on s1p2 to public;
select pg_temp.ok((select (p->>'applied')::int=1 and jsonb_array_length(p->'blocked')=1 and pg_temp.blocked_names(p)='Barang s1.pel' from s1p2),'S1 revisi 2 campuran: TH4 diterapkan, Pelontar tertahan dengan namanya');
select pg_temp.ok((select position('terpakai' in pg_temp.blk(p,'s1','pel'))>0 or position('Rekonsiliasi' in pg_temp.blk(p,'s1','pel'))>0 from s1p2),'S1 alasan baris tertahan menjelaskan lapisan terpakai/rekonsiliasi');
create temp table s1r2 as select pg_temp.cr('s1','{"th4":2,"pel":3}','kr-s1-b') r;grant all on s1r2 to public;
select pg_temp.ok((select (r->>'revision')::int=2 and (r->>'applied')::int=1 and jsonb_array_length(r->'blocked')=1 and r->'blocked'->0->>'name'='Barang s1.pel' from s1r2),'S1 simpan campuran: revisi 2, 1 diterapkan, 1 tertahan dilaporkan');
select pg_temp.ok(pg_temp.sq('s1','th4')=2 and pg_temp.snap('s1','pel')=(select pel from s1pre),'S1 revisi 2: TH4 jadi 2; Pelontar tetap tidak tersentuh');
select pg_temp.ok(pg_temp.unbalanced()=0 and (select count(*) from public.journal_entries where source='stock-correction' and source_ref=pg_temp.cid('s1',2))=1,'S1 revisi 2: jurnal pembalik+pengganti seimbang');
select pg_temp.ok((select pg_temp.g('s1','170001')=pg_temp.n(g0,'170001')-757797.67+256605.33 from s1pre),'S1 revisi 2: TH4 kurang 1 (bukan 2): persediaan neto naik 256.605,33 dari revisi 1');

-- ═════════ S2 baris tertahan, campuran, semua tertahan, tidak ada perubahan ═════════
select pg_temp.doc('s2','[
 {"c":"a","layers":[[10,100]],"count":12},{"c":"b","layers":[[10,100]],"count":8},{"c":"c","layers":[[10,100]],"count":10},
 {"c":"d","layers":[[10,100]],"count":13},{"c":"e","layers":[[10,100]],"count":9},{"c":"f","layers":[[10,100]],"count":10}]');
select pg_temp.sale('s2','a',12),pg_temp.sale('s2','b',3),pg_temp.sale('s2','c',1);
create temp table s2pre as select pg_temp.snap('s2','a') a,pg_temp.snap('s2','b') b,pg_temp.snap('s2','c') c,pg_temp.snap('s2','f') f,pg_temp.gall('s2') g0;grant all on s2pre to public;
create temp table s2p as select pg_temp.pv('s2','{"a":10,"b":9,"c":11,"d":14,"e":8}') p;grant all on s2p to public;
select pg_temp.ok((select (p->>'applied')::int=2 and jsonb_array_length(p->'blocked')=3 from s2p),'S2 pratinjau lima baris diubah: 2 diterapkan (d,e), 3 tertahan (a,b,c)');
select pg_temp.ok((select pg_temp.blocked_names(p)='Barang s2.a,Barang s2.b,Barang s2.c' from s2p),'S2 daftar tertahan menyebut nama barang a, b, c');
select pg_temp.ok((select position('Stok sudah terpakai' in pg_temp.blk(p,'s2','a'))=1 and position('Lapisan FIFO sumber sudah terpakai' in pg_temp.blk(p,'s2','b'))=1 and position('Stok sudah terpakai' in pg_temp.blk(p,'s2','c'))=1 from s2p),'S2 alasan per baris sesuai penyebabnya: mutasi sesudah SO (a, c), lapisan FIFO keluar berubah (b)');
select pg_temp.ok((select position('(mutasi terakhir sesudah SO: sale' in pg_temp.blk(p,'s2','c'))>0 from s2p),'S2 alasan baris c menyebut mutasi terakhir (sale) yang menghalangi');
select pg_temp.ok((select (select array_agg(x->>'item_id' order by x->>'item_id') from jsonb_array_elements(p->'lines') x)=(select array_agg(i::text order by i::text) from unnest(array[pg_temp.id('s2','d'),pg_temp.id('s2','e')]) i) from s2p),'S2 baris diterapkan tepat d dan e');
select pg_temp.ok((select (x->>'old_qty')::numeric=12 and (x->>'new_qty')::numeric=10 from jsonb_array_elements((select p->'blocked' from s2p)) x where x->>'item_id'=pg_temp.id('s2','a')::text),'S2 baris tertahan memuat jumlah tercatat dan jumlah yang diminta');
select pg_temp.ok((select p->>'token' is not null and (pg_temp.pv('s2','{"d":14,"e":8}')->>'token')<>p->>'token' from s2p),'S2 token pratinjau mengikat daftar tertahan (token beda bila baris yang diubah berbeda)');
select pg_temp.ok((pg_temp.pv('s2','{"d":14,"e":8}')->>'token')<>(pg_temp.pv('s2','{"d":14,"e":8,"a":10}')->>'token') and pg_temp.pv('s2','{"d":14,"e":8,"a":10}')->'lines'=pg_temp.pv('s2','{"d":14,"e":8}')->'lines','S2 token mengikat daftar tertahan: baris yang diterapkan sama persis, daftar tertahan beda -> token beda');
select pg_temp.ok(position('Koreksi tidak bisa disimpan: semua baris yang diubah tertahan' in pg_temp.pve('s2','{"a":10}'))=1 and position('Barang s2.a' in pg_temp.pve('s2','{"a":10}'))>0 and position('sudah terpakai' in pg_temp.pve('s2','{"a":10}'))>0,'S2 hanya baris tertahan yang diubah: galat berisi nama barang + alasan');
create function pg_temp.pvd(label text,ch jsonb) returns text language plpgsql as $$declare d text;begin
 begin perform pg_temp.pv(label,ch);return 'OK';exception when others then get stacked diagnostics d=pg_exception_detail;return coalesce(d,'(tanpa detail)');end;end$$;
create function pg_temp.dv(x jsonb,nm text,k text) returns text language sql as $$select e->>k from jsonb_array_elements(x) e where e->>'name'=nm$$;
select pg_temp.ok((select jsonb_typeof(x)='array' and jsonb_array_length(x)=3 and pg_temp.dv(x,'Barang s2.a','reason') like 'Stok sudah terpakai%' and pg_temp.dv(x,'Barang s2.b','reason') like 'Lapisan FIFO sumber%' and pg_temp.dv(x,'Barang s2.c','reason') like 'Stok sudah terpakai%'
  and pg_temp.dv(x,'Barang s2.a','old_qty')='12' and pg_temp.dv(x,'Barang s2.a','new_qty')='10' and pg_temp.dv(x,'Barang s2.a','item_id')=pg_temp.id('s2','a')::text
  from (select pg_temp.pvd('s2','{"a":10,"b":9,"c":11}')::jsonb x) q),'S2 galat semua-tertahan membawa DETAIL JSON terstruktur (nama, jumlah, alasan per baris) untuk layar');
select pg_temp.ok(pg_temp.pvd('s2','{"d":14}')='OK' and pg_temp.pvd('s2','{}')='(tanpa detail)','S2 galat lain tidak membawa DETAIL (hanya galat semua-tertahan)');
select pg_temp.ok(pg_temp.pve('s2','{"a":10,"b":9,"c":11}') like '%Barang s2.a: Stok%' and pg_temp.pve('s2','{"a":10,"b":9,"c":11}') like '%Barang s2.b: Lapisan%' and pg_temp.pve('s2','{"a":10,"b":9,"c":11}') like '%Barang s2.c: Stok%','S2 beberapa baris tertahan: galat memuat semuanya satu per satu');
select pg_temp.ok(pg_temp.pve('s2','{}')='Jumlah koreksi sama dengan hasil saat ini','S2 tidak ada baris diubah: galat lama dipertahankan');
select pg_temp.ok((select pg_temp.pve('s2','{"d":14,"e":8}')='OK'),'S2 hanya baris yang aman diubah: pratinjau OK');
create temp table s2r as select pg_temp.cr('s2','{"a":10,"b":9,"c":11,"d":14,"e":8}','kr-s2-a') r;grant all on s2r to public;
select pg_temp.ok((select (r->>'revision')::int=1 and (r->>'applied')::int=2 and jsonb_array_length(r->'blocked')=3 from s2r),'S2 simpan campuran: 2 diterapkan, 3 tertahan dilaporkan di hasil');
select pg_temp.ok(pg_temp.sq('s2','d')=14 and pg_temp.sq('s2','e')=8,'S2 stok d 13 -> 14 dan e 9 -> 8');
select pg_temp.ok((select pg_temp.snap('s2','a')=a and pg_temp.snap('s2','b')=b and pg_temp.snap('s2','c')=c and pg_temp.snap('s2','f')=f from s2pre),'S2 baris tertahan dan baris tak diubah tidak tersentuh (sidik stok/lapisan/kartu stok sama persis)');
select pg_temp.ok(pg_temp.unbalanced()=0,'S2 semua jurnal seimbang');
select pg_temp.ok(abs(pg_temp.g('s2','170001')-(pg_temp.n((select g0 from s2pre),'170001')+100-100))<0.000001,'S2 nilai neto persediaan dokumen: d +1 unit (+100) dan e -1 unit (-100) = tidak berubah');
select pg_temp.ok((select count(*) from public.stock_moves where source in('stock-correct-reverse','stock-correction') and source_ref=pg_temp.cid('s2',1))=4,'S2 kartu stok koreksi: 4 mutasi (d,e masing-masing pembalik+pengganti)');
-- token berkait dengan daftar baris
select pg_temp.reject(format('select public.correct_stock_document(%L,%L,%L,%L,%L,%L)','opname',pg_temp.rid('s2'),pg_temp.rows_all('s2','{"d":15}'),'Token salah','kr-s2-tok',(pg_temp.pv('s2','{"e":7}')->>'token')),'Preview berubah','S2 token dari pratinjau lain ditolak (Preview berubah)');
select pg_temp.reject(format('select public.correct_stock_document(%L,%L,%L,%L,%L,%L)','opname',pg_temp.rid('s2'),pg_temp.rows_all('s2','{"d":15}'),'Pakai kunci lama','kr-s2-a',(pg_temp.pv('s2','{"d":15}')->>'token')),'Identitas permintaan sudah digunakan','S2 kunci permintaan yang sama dengan isi berbeda ditolak');
select pg_temp.ok((pg_temp.retry('s2','kr-s2-a')->>'correction_id')=(select r->>'correction_id' from s2r),'S2 ulang dengan isi persis sama mengembalikan hasil yang sama');
select pg_temp.ok(pg_temp.pve('s2','{"b":9}') like 'Koreksi tidak bisa disimpan%' and (select count(*) from public.stock_document_corrections where document_id=pg_temp.rid('s2'))=1,'S2 sesudah koreksi: baris yang masih tertahan tetap tertahan, koreksi tetap satu');

-- ═════════ S3 rantai revisi: barang tak disentuh yang sempat bergerak sebelum revisi berikutnya ═════════
select pg_temp.doc('s3','[{"c":"x","layers":[[5,100]],"count":4},{"c":"y","layers":[[5,100]],"count":7},{"c":"z","layers":[[5,100]],"count":5},{"c":"w","layers":[[5,100]],"count":6}]');
select pg_temp.sale('s3','y',3);
select pg_temp.ok(pg_temp.pve('s3','{"x":3}')='OK','S3 revisi 1: x boleh dikoreksi walau y sudah terjual sesudah SO (y tidak disentuh)');
select pg_temp.cr('s3','{"x":3}','kr-s3-a');
select pg_temp.ok(pg_temp.sq('s3','x')=3 and (select (r->>'revision')::int from res where name='s3.cr1')=1,'S3 revisi 1 tersimpan (x 4 -> 3)');
create temp table s3p as select pg_temp.pv('s3','{"y":8,"z":6}') p;grant all on s3p to public;
select pg_temp.ok((select (p->>'applied')::int=1 and pg_temp.blocked_names(p)='Barang s3.y' and position('Stok sudah terpakai' in pg_temp.blk(p,'s3','y'))=1 from s3p),'S3 revisi 2: y (sudah terjual sebelum revisi 1, tidak disentuh waktu itu) tetap tertahan; z diterapkan');
select pg_temp.ok(pg_temp.pve('s3','{"y":8}') like 'Koreksi tidak bisa disimpan%Barang s3.y%','S3 revisi 2 hanya y: semua tertahan, nama disebut');
select pg_temp.cr('s3','{"z":6}','kr-s3-b');
select pg_temp.ok(pg_temp.sq('s3','z')=6 and (select (r->>'revision')::int from res where name='s3.cr2')=2,'S3 revisi 2 tersimpan (z 5 -> 6)');
-- revisi 3: x berubah lagi sebelum ada mutasi lain -> OK; setelah ada penjualan x -> tertahan
select pg_temp.ok(pg_temp.pve('s3','{"x":2}')='OK','S3 revisi 3: x yang dikoreksi pada revisi 1 dan belum bergerak boleh dikoreksi lagi');
select pg_temp.sale('s3','x',1);
select pg_temp.ok(pg_temp.pve('s3','{"x":2}') like 'Koreksi tidak bisa disimpan%Barang s3.x%berpindah setelah koreksi terakhir%','S3 revisi 3: x terjual sesudah revisi 1 -> tertahan dengan alasan "setelah koreksi terakhir"');
select pg_temp.ok(pg_temp.pve('s3','{"w":7}')='OK','S3 revisi 3: w yang tidak pernah bergerak tetap boleh');
select pg_temp.ok(pg_temp.unbalanced()=0,'S3 semua jurnal seimbang');
select pg_temp.ok(abs(pg_temp.g('s3','170001')-(select coalesce(sum(m.qty*m.unit_cost),0) from public.stock_moves m where m.source in('opname','stock-correction','stock-correct-reverse') and m.item_id in(select id from it where code like 's3.%')))<0.05,'S3 persediaan jurnal sama dengan nilai kartu stok dokumen (opname + koreksi + pembalik)');

-- ═════════ S4 beban ke karyawan (kasbon): aturan sama, pesan menyebut karyawan + nominal ═════════
select pg_temp.doc('s4','[
 {"c":"k1","sell":150,"layers":[[10,100]],"count":5},{"c":"k3","sell":100,"layers":[[10,100]],"count":10},
 {"c":"q","sell":0,"count":5},{"c":"k4","sell":200,"layers":[[10,100]],"count":10},
 {"c":"k5","sell":0,"layers":[[10,100]],"count":5},{"c":"k6","sell":0,"layers":[[10,100]],"count":10}]');
create temp table s4ch as select public.charge_opname_variance_to_employees(pg_temp.rid('s4'),jsonb_build_array(jsonb_build_object('employee_id','5c400000-0000-4000-8000-000000000001','amount',500),jsonb_build_object('employee_id','5c400000-0000-4000-8000-000000000002','amount',250)),'Selisih stok KR uji',gen_random_uuid()) r;grant all on s4ch to public;
select pg_temp.ok((select (r->>'total')::numeric=750 from s4ch),'S4 prasyarat: beban 750 dibagi 500 + 250 tercatat');
create temp table s4p as select pg_temp.pv('s4','{"k1":6,"q":6}') p;grant all on s4p to public;
select pg_temp.ok((select (p->>'applied')::int=1 and pg_temp.blocked_names(p)='Barang s4.k1' from s4p),'S4 beban aktif: baris k1 (berdampak ke beban) tertahan, baris q (harga jual 0, nilai 0) diterapkan');
select pg_temp.ok((select pg_temp.blk(p,'s4','k1') like '%Budi Karyawan KR (Rp 500)%' and pg_temp.blk(p,'s4','k1') like '%Sari Karyawan KR (Rp 250)%' from s4p),'S4 alasan menyebut nama karyawan dan nominal masing-masing');
select pg_temp.ok((select pg_temp.blk(p,'s4','k1') like '%total beban Rp 750%' and pg_temp.blk(p,'s4','k1') like '%Batalkan beban karyawan dulu%' and pg_temp.blk(p,'s4','k1') like '%'||pg_temp.ref('s4')||'%' and pg_temp.blk(p,'s4','k1') like '%Riwayat beban karyawan%' from s4p),'S4 alasan menyebut total, nomor hasil opname, dan tempat membatalkan beban');
select pg_temp.ok(pg_temp.pve('s4','{"k1":6}') like 'Koreksi tidak bisa disimpan%Barang s4.k1%Budi Karyawan KR%Batalkan beban karyawan dulu%','S4 hanya baris berdampak: galat memuat nama barang, karyawan, dan petunjuk batalkan');
select pg_temp.ok(pg_temp.pve('s4','{"k3":9}') like '%Barang s4.k3%Batalkan beban karyawan dulu%','S4 baris selisih nol bernilai jual (k3): mengubahnya berdampak ke beban, tertahan');
select pg_temp.ok(pg_temp.pve('s4','{"k5":6}') like '%Barang s4.k5%Batalkan beban karyawan dulu%','S4 baris dengan harga jual 0 tetapi nilai HPP tercatat (k5 kurang 5 x 100): berdampak pada jurnal, tertahan');
select pg_temp.ok(pg_temp.pve('s4','{"k6":12}') like '%Barang s4.k6%Batalkan beban karyawan dulu%','S4 baris harga jual 0 dan selisih nol yang diubah menjadi lebih bernilai HPP (k6 +2 x 100): tertahan');
select pg_temp.ok(pg_temp.pve('s4','{"k4":11}') like '%Barang s4.k4%Batalkan beban karyawan dulu%','S4 lebih yang mengurangi beban (k4 lebih 1 x 200) berdampak, tertahan');
create temp table s4r as select pg_temp.cr('s4','{"k1":6,"q":6}','kr-s4-a') r;grant all on s4r to public;
select pg_temp.ok((select (r->>'applied')::int=1 and jsonb_array_length(r->'blocked')=1 from s4r) and pg_temp.sq('s4','q')=6 and pg_temp.sq('s4','k1')=5,'S4 simpan campuran dengan beban aktif: q berubah, k1 tidak');
select pg_temp.ok((select count(*) from public.opname_variance_charges where result_id=pg_temp.rid('s4') and cancelled_at is null)=1 and (select (after_state->>'charge_checked')::boolean from public.stock_document_corrections where document_id=pg_temp.rid('s4'))=true,'S4 beban tetap aktif dan koreksi mencatat bahwa beban sudah diperiksa');
-- pagar terakhir: sisipan langsung tanpa pemeriksaan beban ditolak
select pg_temp.reject(format($f$insert into public.stock_document_corrections(id,kind,document_id,branch_id,warehouse_id,revision,reason,source_snapshot,before_state,after_state,reversal_journal_ids,replacement_journal_id,created_by) values(gen_random_uuid(),'opname',%L,'5c200000-0000-4000-8000-000000000001','5c300000-0000-4000-8000-000000000001',9,'Sisip langsung','{}','{}','{}','{}',null,null)$f$,pg_temp.rid('s4')),'Batalkan beban karyawan dulu','S4 pagar terakhir (trigger): koreksi tanpa tanda pemeriksaan beban ditolak, pesan menyebut karyawan');
select pg_temp.reject(format($f$insert into public.stock_document_corrections(id,kind,document_id,branch_id,warehouse_id,revision,reason,source_snapshot,before_state,after_state,reversal_journal_ids,replacement_journal_id,created_by) values(gen_random_uuid(),'opname',%L,'5c200000-0000-4000-8000-000000000001','5c300000-0000-4000-8000-000000000001',9,'Sisip langsung','{}','{}','{"charge_checked":false}','{}',null,null)$f$,pg_temp.rid('s4')),'Batalkan beban karyawan dulu','S4 pagar terakhir: tanda charge_checked=false ditolak');
do $$begin perform pg_temp.as_(pg_temp.owner());perform public.cancel_opname_variance_charge((select id from public.opname_variance_charges where result_id=pg_temp.rid('s4') and cancelled_at is null),'Salah hitung uji',gen_random_uuid());end$$;
select pg_temp.ok(pg_temp.pve('s4','{"k1":6}')='OK' and (select (pg_temp.pv('s4','{"k1":6}')->>'applied')::int=1),'S4 sesudah beban dibatalkan: baris k1 bisa dikoreksi');
select pg_temp.cr('s4','{"k1":6}','kr-s4-b');
select pg_temp.ok(pg_temp.sq('s4','k1')=6,'S4 koreksi k1 sesudah pembatalan beban tersimpan (stok 5 -> 6)');
select pg_temp.ok(pg_temp.unbalanced()=0,'S4 semua jurnal seimbang (termasuk jurnal beban dan pembatalannya)');

-- ═════════ S5 pemeriksaan tingkat dokumen tetap menolak seluruh dokumen; pemeriksaan baris hanya baris yang diubah ═════════
create function pg_temp.mp(label text,mut text,ch jsonb) returns text language plpgsql as $$
declare r jsonb;begin
 begin execute replace(replace(mut,'%RID%',pg_temp.rid(label)::text),'%REF%',pg_temp.ref(label));
  r:=pg_temp.pv(label,ch);raise exception 'TRY_OK:%/%',r->>'applied',jsonb_array_length(r->'blocked');
 exception when others then return case when sqlerrm like 'TRY_OK:%' then 'OK '||substr(sqlerrm,8) else sqlerrm end;end;end$$;
select pg_temp.doc('s5','[{"c":"p","layers":[[10,100]],"count":8},{"c":"q","layers":[[10,100]],"count":12},{"c":"r","layers":[[10,100]],"count":10},{"c":"z0","layers":[[10,0]],"count":10}]');
select pg_temp.ok(pg_temp.mp('s5','select 1','{"p":7,"q":13}')='OK 2/0','S5 dasar: dua baris diubah, tidak ada yang tertahan');
select pg_temp.ok(pg_temp.mp('s5','update accounting_locks set closed_until=current_date where id','{"p":7,"q":13}') like '%ditutup%','S5 periode tutup: seluruh koreksi ditolak (jurnal pembalik+pengganti bertanggal hari ini)');
select pg_temp.ok(pg_temp.mp('s5','update accounting_locks set closed_until=current_date where id','{"p":7}') like '%ditutup%','S5 periode tutup: ditolak juga bila hanya satu baris');
select pg_temp.ok(pg_temp.mp('s5','set local session_replication_role=replica;with i as(insert into sales_invoices(no_faktur,tanggal,branch_id,kategori,dpp,ppn,total) values(''FJS.KR'',current_date,''5c200000-0000-4000-8000-000000000001'',''selisih_stok'',100,0,100) returning id) update opname_results set invoice_id=(select id from i) where id=''%RID%''','{"p":7,"q":13}') like '%faktur tagihan%','S5 hasil opname bertagihan: seluruh dokumen ditolak (rekonsiliasi Finance)');
select pg_temp.ok(pg_temp.mp('s5','update inventory_costing_settings set method=''moving_average'',activated_at=now() where id','{"p":7,"q":13}') like '%HPP average aktif%','S5 HPP average aktif: koreksi historis FIFO ditolak');
select pg_temp.ok(pg_temp.mp('s5','update journal_entries set voided_at=now() where source=''opname'' and source_ref=''%REF%''','{"p":7,"q":13}') like '%Jurnal sumber tidak utuh%','S5 jurnal sumber sudah di-void: ditolak');
select pg_temp.ok(pg_temp.mp('s5','update journal_lines l set debit=debit+0.01 from journal_entries e,coa_accounts a where e.id=l.entry_id and a.id=l.account_id and e.source=''opname'' and e.source_ref=''%REF%'' and a.code=''170001'' and l.debit>0;update journal_lines l set credit=credit+0.01 from journal_entries e,coa_accounts a where e.id=l.entry_id and a.id=l.account_id and e.source=''opname'' and e.source_ref=''%REF%'' and a.code=''720010'' and l.credit>0','{"p":7,"q":13}') like '%Nilai jurnal dan stok sumber tidak cocok%','S5 jurnal sumber digeser 0,01 (masih seimbang): rekonsiliasi jurnal-stok menolak seluruh dokumen');
select pg_temp.ok(pg_temp.mp('s5','update journal_lines set debit=case when debit>0 then debit+0.01 else 0 end,credit=case when credit>0 then credit+0.01 else 0 end where entry_id in(select id from journal_entries where source=''opname'' and source_ref=''%REF%'')','{"p":7,"q":13}') like '%Rincian debit/kredit sumber tidak cocok%','S5 jurnal sumber dengan rincian debit/kredit bergeser (net sama): ditolak');
select pg_temp.ok(pg_temp.mp('s5','insert into journal_lines(entry_id,account_id,debit,credit) select e.id,a.id,5,0 from journal_entries e,coa_accounts a where e.source=''opname'' and e.source_ref=''%REF%'' and a.code=''182001'' limit 1','{"p":7,"q":13}') like '%Jurnal sumber%','S5 jurnal sumber punya akun lain/tidak seimbang: ditolak');
select pg_temp.ok(pg_temp.mp('s5','select pg_temp.mk(''s5.zz'');insert into stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref) values(current_date,''5c300000-0000-4000-8000-000000000001'',pg_temp.iid(''s5.zz''),1,10,''opname'',''%REF%'')','{"p":7,"q":13}') like '%Mutasi sumber di luar rincian%','S5 mutasi sumber untuk barang di luar rincian: ditolak');
select pg_temp.ok(pg_temp.mp('s5','delete from stock_moves where source=''opname'' and source_ref=''%REF%'' and item_id=pg_temp.id(''s5'',''q'')','{"p":7}') like '%Bukti mutasi sumber tidak lengkap%','S5 bukti mutasi sumber satu baris hilang (baris yang TIDAK diubah): seluruh dokumen ditolak');
select pg_temp.ok(pg_temp.mp('s5','update stock_moves set unit_cost=-1 where source=''opname'' and source_ref=''%REF%'' and item_id=pg_temp.id(''s5'',''q'')','{"p":7}') like '%Nilai mutasi sumber tidak konsisten%','S5 nilai mutasi sumber rusak pada baris tak diubah: ditolak (jurnal tak terbukti)');
select pg_temp.ok(pg_temp.mp('s5','set local session_replication_role=replica;update opname_result_items set selisih=selisih+1 where result_id=''%RID%'' and item_id=pg_temp.id(''s5'',''r'')','{"p":7}') like '%Angka sumber tidak konsisten%','S5 selisih tercatat tidak sama qty-sistem pada baris tak diubah: ditolak');
select pg_temp.ok(pg_temp.mp('s5','update stock set qty=qty+1 where item_id=pg_temp.id(''s5'',''q'') and warehouse_id=pg_temp.wa()','{"p":7,"q":13}')='OK 1/1','S5 saldo stok q tidak cocok dengan lapisan: baris q (diubah) tertahan, p tetap jalan');
select pg_temp.ok(pg_temp.mp('s5','update stock set qty=qty+1 where item_id=pg_temp.id(''s5'',''r'') and warehouse_id=pg_temp.wa()','{"p":7,"q":13}')='OK 2/0','S5 saldo stok r tidak cocok tetapi r TIDAK diubah: tidak menahan apa pun');
select pg_temp.ok(pg_temp.mp('s5','update stock set qty=qty+1 where item_id=pg_temp.id(''s5'',''q'') and warehouse_id=pg_temp.wa()','{"q":13}') like 'Koreksi tidak bisa disimpan%Barang s5.q: Saldo dan lapisan FIFO tidak cocok%','S5 hanya baris yang saldonya rusak diubah: galat menyebut barangnya');
select pg_temp.ok(pg_temp.mp('s5','set local session_replication_role=replica;update items set is_active=false where id=pg_temp.id(''s5'',''r'')','{"p":7,"q":13}')='OK 2/0','S5 barang r nonaktif tetapi tidak diubah: tidak menahan');
select pg_temp.ok(pg_temp.mp('s5','set local session_replication_role=replica;update items set is_active=false where id=pg_temp.id(''s5'',''p'')','{"p":7,"q":13}')='OK 1/1','S5 barang p nonaktif dan diubah: hanya p tertahan');
select pg_temp.ok(pg_temp.mp('s5','set local session_replication_role=replica;update items set is_active=false where id=pg_temp.id(''s5'',''p'')','{"p":7}') like '%Barang s5.p: Barang sumber tidak aktif%','S5 alasan barang nonaktif menyebut nama');
select pg_temp.ok(pg_temp.mp('s5','update items set buy_price=-5 where id=pg_temp.id(''s5'',''q'')','{"q":13}') like '%Harga modal barang tidak valid%' ,'S5 harga master rusak pada baris yang diubah: tertahan');
select pg_temp.ok(pg_temp.mp('s5','select 1','{"z0":8}') like 'Koreksi tidak bisa disimpan%Barang s5.z0: Selisih kurang koreksi untuk Barang s5.z0 memakai stok tanpa harga modal%' and pg_temp.mp('s5','select 1','{"z0":8,"p":7}')='OK 1/1','S5 pengurangan yang memakai lapisan Rp0 tidak dinilai 0 diam-diam: z0 tertahan dengan nama barang, baris lain jalan');
select pg_temp.ok(pg_temp.mp('s5','select 1','{"p":5000}') like 'Koreksi tidak bisa disimpan%Barang s5.p: Stok tidak cukup%' or pg_temp.mp('s5','select 1','{"p":5000}')='OK 1/0','S5 menambah banyak p (ketik 5000) valid sebagai selisih lebih: diterapkan');
select pg_temp.ok(pg_temp.mp('s5','select 1','{"p":0,"q":0}')='OK 2/0','S5 mengubah ke nol: diterapkan (stok tersedia untuk pengurangan)');
-- validasi masukan (tingkat dokumen)
select pg_temp.ok(pg_temp.pve('s5','{"p":7}') ='OK','S5 pratinjau satu baris diubah OK');
select pg_temp.reject(format('select public.preview_stock_document_correction(%L,%L,%L)','opname',pg_temp.rid('s5'),(select jsonb_agg(x) from (select x from jsonb_array_elements(pg_temp.rows_all('s5','{}')) x limit 2) y)),'Isi jumlah valid untuk seluruh barang','S5 daftar baris tidak lengkap ditolak');
select pg_temp.reject(format('select public.preview_stock_document_correction(%L,%L,%L)','opname',pg_temp.rid('s5'),pg_temp.rows_all('s5','{}')||(pg_temp.rows_all('s5','{}')->0)),'Isi jumlah valid untuk seluruh barang','S5 daftar baris ganda ditolak');
select pg_temp.reject(format('select public.preview_stock_document_correction(%L,%L,%L)','opname',pg_temp.rid('s5'),pg_temp.rows_all('s5','{"p":-1}')),'Isi jumlah valid untuk seluruh barang','S5 jumlah negatif ditolak');
select pg_temp.reject(format('select public.preview_stock_document_correction(%L,%L,%L)','opname',pg_temp.rid('s5'),replace(pg_temp.rows_all('s5','{}')::text,'"qty": 8','"qty": "NaN"')::jsonb),'Isi jumlah valid untuk seluruh barang','S5 jumlah NaN ditolak');
select pg_temp.reject(format('select public.preview_stock_document_correction(%L,%L,%L::jsonb)','opname',pg_temp.rid('s5'),'[]'),'Rincian koreksi tidak valid','S5 daftar kosong ditolak');
select pg_temp.reject(format('select public.preview_stock_document_correction(%L,%L,%L::jsonb)','opname',pg_temp.rid('s5'),'{"a":1}'),'Rincian koreksi tidak valid','S5 bukan array ditolak');
select pg_temp.reject(format('select public.preview_stock_document_correction(%L,%L,%L)','retur',pg_temp.rid('s5'),pg_temp.rows_all('s5','{}')),'Jenis dokumen koreksi tidak didukung','S5 jenis dokumen lain ditolak');
select pg_temp.reject(format('select public.correct_stock_document(%L,%L,%L,%L,%L,%L)','opname',pg_temp.rid('s5'),pg_temp.rows_all('s5','{"p":7}'),'ab','kr-x','tok'),'Identitas permintaan dan alasan koreksi wajib diisi','S5 alasan terlalu pendek ditolak');
select pg_temp.reject(format('select public.correct_stock_document(%L,%L,%L,%L,%L,%L)','opname',pg_temp.rid('s5'),pg_temp.rows_all('s5','{"p":7}'),'Alasan sah',repeat('k',121),'tok'),'Identitas permintaan dan alasan koreksi wajib diisi','S5 kunci permintaan terlalu panjang ditolak');
select pg_temp.reject(format('select public.correct_stock_document(%L,%L,%L,%L,%L,%L)','opname',pg_temp.rid('s5'),pg_temp.rows_all('s5','{"p":7}'),'Alasan sah','kr-notok',null),'Preview berubah','S5 tanpa token pratinjau ditolak');
-- penyimpangan tidak meninggalkan jejak
select pg_temp.ok(not exists(select 1 from public.stock_document_corrections where document_id=pg_temp.rid('s5')) and not exists(select 1 from public.stock_document_correction_requests where document_id=pg_temp.rid('s5')),'S5 semua penolakan tidak meninggalkan koreksi maupun catatan permintaan');

-- ═════════ S6 penilaian selisih lebih (aturan PR #580) dan jurnal pengganti neto ═════════
select pg_temp.doc('s6','[{"c":"h","layers":[[10,100]],"count":14},{"c":"i","layers":[[10,100]],"count":7},{"c":"j","buy":40,"layers":[[5,200,6],[5,300,5]],"count":12}]');
select pg_temp.ok(pg_temp.g('s6','170001')=600 and pg_temp.g('s6','720010')=0 and pg_temp.g('s6','810004')=-600,'S6 jurnal SO asal: lebih 900 (h 400 + j 500), kurang 300: 170001 +600, 720010 0, 810004 -600');
select pg_temp.cr('s6','{"j":13}','kr-s6-1');
select pg_temp.ok((select unit_cost from public.stock_layers where source='stock-correction' and source_ref=pg_temp.cid('s6',1) and item_id=pg_temp.id('s6','j'))=250,'S6 tambahan lebih pada koreksi dinilai HPP rata-rata lapisan 250 (bukan harga master 40, bukan 0)');
select pg_temp.ok(pg_temp.gsn('stock-correction',pg_temp.cid('s6',1),'170001')=850 and pg_temp.gsn('stock-correction',pg_temp.cid('s6',1),'720010')=0 and pg_temp.gsn('stock-correction',pg_temp.cid('s6',1),'810004')=-850,'S6 jurnal pengganti: lebih 900-500+750 = 1.150, kurang 300 tetap, neto 850 ke Pendapatan Lain-lain; beban 0');
select pg_temp.ok(pg_temp.gsn('stock-correct-reverse',pg_temp.cid('s6',1),'170001')=-600 and pg_temp.gsn('stock-correct-reverse',pg_temp.cid('s6',1),'810004')=600,'S6 jurnal pembalik = cermin jurnal SO asal (170001 -600, 810004 +600)');
select pg_temp.ok(pg_temp.g('s6','170001')=850 and pg_temp.g('s6','810004')=-850,'S6 saldo neto dokumen sesudah revisi 1: 170001 +850, 810004 -850');
select pg_temp.cr('s6','{"i":4}','kr-s6-2');
select pg_temp.ok(pg_temp.gsn('stock-correction',pg_temp.cid('s6',2),'170001')=550 and pg_temp.gsn('stock-correction',pg_temp.cid('s6',2),'720010')=0 and pg_temp.gsn('stock-correction',pg_temp.cid('s6',2),'810004')=-550,'S6 revisi 2 (kurang 3 -> 6 unit = 600): lebih 1.150 - kurang 600 = 550 ke 810004; beban 0 (diimbangi)');
select pg_temp.cr('s6','{"h":10}','kr-s6-3');
select pg_temp.ok(pg_temp.gsn('stock-correction',pg_temp.cid('s6',3),'170001')=150 and pg_temp.gsn('stock-correction',pg_temp.cid('s6',3),'810004')=-150 and pg_temp.gsn('stock-correction',pg_temp.cid('s6',3),'720010')=0,'S6 revisi 3 (lebih h 400 dihapus): lebih 750, kurang 600: neto 150 ke 810004');
select pg_temp.ok(pg_temp.lq('s6','h')=10 and pg_temp.sq('s6','h')=10,'S6 lebih yang dihapus mengembalikan lapisan lebih (stok h 14 -> 10)');
select pg_temp.cr('s6','{"j":5}','kr-s6-4');
select pg_temp.ok(pg_temp.gsn('stock-correction',pg_temp.cid('s6',4),'170001')=-1600 and pg_temp.gsn('stock-correction',pg_temp.cid('s6',4),'720010')=1600 and pg_temp.gsn('stock-correction',pg_temp.cid('s6',4),'810004')=0,'S6 revisi 4 (j jadi kurang 5 = 5 x 200 lapisan tertua): tidak ada lebih tersisa -> beban 720010 1.600, tanpa 810004');
select pg_temp.ok(pg_temp.unbalanced()=0,'S6 semua jurnal seimbang di seluruh rantai revisi');
select pg_temp.ok(abs(pg_temp.g('s6','170001')-(select coalesce(sum(m.qty*m.unit_cost),0) from public.stock_moves m where m.source in('opname','stock-correction','stock-correct-reverse') and m.item_id in(select id from it where code like 's6.%')))<0.05,'S6 persediaan jurnal = nilai kartu stok dokumen setelah 4 revisi');
select pg_temp.ok(pg_temp.g('s6','720010')>=0 and pg_temp.g('s6','810004')<=0,'S6 beban selisih tidak pernah kredit bersih dan pendapatan lain tidak pernah debit bersih');
select pg_temp.ok((select count(*) from public.journal_entries where source='stock-correct-reverse' and source_ref=any(pg_temp.cids('s6')))=4 and (select count(*) from public.journal_entries where source='stock-correction' and source_ref=any(pg_temp.cids('s6')))=4,'S6 tiap revisi: tepat satu jurnal pembalik dan satu pengganti');

-- ═════════ S7 penyesuaian persediaan: mekanisme per baris yang sama ═════════
create function pg_temp.adj(label text,spec jsonb) returns jsonb language plpgsql as $$
declare e jsonb;l jsonb;rows jsonb:='[]';code text;r jsonb;begin
 for e in select * from jsonb_array_elements(spec) loop
  code:=label||'.'||(e->>'c');
  perform pg_temp.mk(code,coalesce((e->>'sell')::numeric,1000),coalesce((e->>'buy')::numeric,0));
  for l in select * from jsonb_array_elements(coalesce(e->'layers','[]')) loop perform pg_temp.lay(code,(l->>0)::numeric,(l->>1)::numeric,coalesce((l->>2)::int,5));end loop;
  rows:=rows||jsonb_build_array(jsonb_build_object('item_id',pg_temp.iid(code),'qty_baru',(e->>'count')::numeric));
 end loop;
 perform pg_temp.as_(pg_temp.owner());
 r:=public.post_inventory_adjustment_atomic('kr-adj-'||label,pg_temp.wa(),pg_temp.today(),'temuan','fiktif',rows);
 insert into res values(label,r||jsonb_build_object('result_id',r->>'adjustment_id','no_hasil',r->>'no_adj','kind','adjustment')) on conflict(name) do update set r=excluded.r;return r;end$$;
select pg_temp.adj('s7','[{"c":"g1","buy":30,"layers":[[10,100]],"count":13},{"c":"g2","layers":[[10,100]],"count":8},{"c":"g3","layers":[[10,100]],"count":12},{"c":"g4","layers":[[10,100]],"count":11},{"c":"g5","buy":30,"layers":[[10,100]],"count":11}]');
select pg_temp.ok(pg_temp.kd('s7')='adjustment' and (select count(*) from public.inventory_adjustment_items where adjustment_id=pg_temp.rid('s7'))=5,'S7 penyesuaian 5 baris diposting');
select pg_temp.sale('s7','g3',12),pg_temp.sale('s7','g4',12);
create temp table s7pre as select pg_temp.snap('s7','g3') g3,pg_temp.snap('s7','g4') g4,pg_temp.gall('s7') g0;grant all on s7pre to public;
create temp table s7p as select pg_temp.pv('s7','{"g1":14,"g2":7,"g3":9,"g5":12}') p;grant all on s7p to public;
select pg_temp.ok((select (p->>'applied')::int=3 and pg_temp.blocked_names(p)='Barang s7.g3' from s7p),'S7 penyesuaian: 3 baris diterapkan; g3 (diubah, terjual sesudah) tertahan dengan nama; g4 (terjual sesudah, tidak diubah) tidak menahan');
create temp table s7r as select pg_temp.cr('s7','{"g1":14,"g2":7,"g3":9,"g5":12}','kr-s7-a') r;grant all on s7r to public;
select pg_temp.ok((select (r->>'applied')::int=3 and jsonb_array_length(r->'blocked')=1 from s7r) and pg_temp.sq('s7','g1')=14 and pg_temp.sq('s7','g2')=7 and pg_temp.sq('s7','g5')=12,'S7 hasil: g1 13 -> 14, g2 8 -> 7, g5 11 -> 12');
select pg_temp.ok((select pg_temp.snap('s7','g3')=g3 and pg_temp.snap('s7','g4')=g4 from s7pre),'S7 baris tertahan (g3) dan baris terpakai yang tidak diubah (g4) tidak tersentuh');
select pg_temp.ok((select unit_cost from public.stock_layers where source='stock-correction' and source_ref=pg_temp.cid('s7',1) and item_id=pg_temp.id('s7','g1'))=30,'S7 penyesuaian: tambahan tetap dinilai harga master 30 (aturan rata-rata hanya untuk opname)');
select pg_temp.ok((select pg_temp.g('s7','170001')=pg_temp.n(g0,'170001')+30-100+30 from s7pre),'S7 nilai neto: g1 +30, g2 kurang 2->3 (-100), g5 +30 = -40 terhadap jurnal asal');
select pg_temp.ok(pg_temp.unbalanced()=0 and (select count(*) from public.journal_entries where source='stock-correct-reverse' and source_ref=pg_temp.cid('s7',1))=1,'S7 jurnal seimbang, tepat satu pembalik');
select pg_temp.ok(pg_temp.pve('s7','{"g3":9}') like 'Koreksi tidak bisa disimpan%Barang s7.g3%','S7 hanya g3: galat menyebut nama barang');

-- ═════════ S8 ACL, peran, Admin Online, definer ═════════
select pg_temp.doc('s8','[{"c":"a","layers":[[10,100]],"count":8},{"c":"b","layers":[[10,100]],"count":12}]');
select pg_temp.as_(pg_temp.owner());
create temp table s8rows as select pg_temp.rows_all('s8','{"a":7}') r;grant all on s8rows to public;
select pg_temp.as_('5c100000-0000-4000-8000-000000000002');
select pg_temp.reject(format('select public.preview_stock_document_correction(%L,%L,%L)','opname',pg_temp.rid('s8'),(select r from s8rows)),'Super Admin','S8 Admin biasa ditolak (pratinjau)');
select pg_temp.as_('5c100000-0000-4000-8000-000000000002');
select pg_temp.reject(format('select public.correct_stock_document(%L,%L,%L,%L,%L,%L)','opname',pg_temp.rid('s8'),(select r from s8rows),'Coba admin','kr-s8-a','x'),'Super Admin','S8 Admin biasa ditolak (simpan)');
select pg_temp.as_('5c100000-0000-4000-8000-000000000005');
select pg_temp.reject(format('select public.preview_stock_document_correction(%L,%L,%L)','opname',pg_temp.rid('s8'),(select r from s8rows)),'Super Admin','S8 Finance ditolak');
select pg_temp.as_('5c100000-0000-4000-8000-000000000003');
select pg_temp.reject(format('select public.preview_stock_document_correction(%L,%L,%L)','opname',pg_temp.rid('s8'),(select r from s8rows)),'Super Admin','S8 Super Admin nonaktif ditolak');
select pg_temp.as_('5c100000-0000-4000-8000-000000000004');
select pg_temp.reject(format('select public.preview_stock_document_correction(%L,%L,%L)','opname',pg_temp.rid('s8'),(select r from s8rows)),'ADMIN_ONLINE_FUNCTION_DENIED','S8 Admin Online ditolak (pratinjau)');
select pg_temp.reject(format('select public.correct_stock_document(%L,%L,%L,%L,%L,%L)','opname',pg_temp.rid('s8'),(select r from s8rows),'Coba AO','kr-s8-b','x'),'ADMIN_ONLINE_FUNCTION_DENIED','S8 Admin Online ditolak (simpan)');
select pg_temp.reject(format('select public.stock_correction_charge_note(%L)',pg_temp.rid('s8')),'ADMIN_ONLINE_FUNCTION_DENIED','S8 Admin Online ditolak pada fungsi catatan beban');
select pg_temp.as_(pg_temp.owner());
select pg_temp.reject('select public.preview_stock_document_correction(''opname'',gen_random_uuid(),''[{"item_id":"5c400000-0000-4000-8000-000000000001","qty":1}]''::jsonb)','Dokumen stok tidak ditemukan','S8 dokumen tidak ada: ditolak (setelah akses diperiksa)') ;
select pg_temp.ok(has_function_privilege('authenticated','public.correct_stock_document(text,uuid,jsonb,text,text,text)','EXECUTE') and has_function_privilege('authenticated','public.preview_stock_document_correction(text,uuid,jsonb)','EXECUTE'),'S8 authenticated boleh memanggil pratinjau dan simpan');
select pg_temp.ok(not has_function_privilege('anon','public.correct_stock_document(text,uuid,jsonb,text,text,text)','EXECUTE') and not has_function_privilege('anon','public.preview_stock_document_correction(text,uuid,jsonb)','EXECUTE') and not has_function_privilege('service_role','public.correct_stock_document(text,uuid,jsonb,text,text,text)','EXECUTE'),'S8 anon dan service_role tidak boleh');
select pg_temp.ok(not has_function_privilege('authenticated','public.stock_correction_plan(text,uuid,jsonb)','EXECUTE') and not has_function_privilege('anon','public.stock_correction_plan(text,uuid,jsonb)','EXECUTE') and not has_function_privilege('service_role','public.stock_correction_plan(text,uuid,jsonb)','EXECUTE'),'S8 perencana tidak bisa dipanggil klien');
select pg_temp.ok(not has_function_privilege('authenticated','public.stock_correction_charge_note(uuid)','EXECUTE') and not has_function_privilege('anon','public.stock_correction_charge_note(uuid)','EXECUTE') and not has_function_privilege('service_role','public.stock_correction_charge_note(uuid)','EXECUTE'),'S8 fungsi catatan beban internal, tanpa EXECUTE klien');
select pg_temp.ok(not has_function_privilege('authenticated','public.guard_opname_correction_charge()','EXECUTE') and not has_function_privilege('anon','public.guard_opname_correction_charge()','EXECUTE'),'S8 fungsi pagar beban tanpa EXECUTE klien');
select pg_temp.ok((select count(*) from pg_proc p where p.oid in('public.stock_correction_plan(text,uuid,jsonb)'::regprocedure,'public.correct_stock_document(text,uuid,jsonb,text,text,text)'::regprocedure,'public.preview_stock_document_correction(text,uuid,jsonb)'::regprocedure,'public.guard_opname_correction_charge()'::regprocedure,'public.stock_correction_charge_note(uuid)'::regprocedure) and p.prosecdef and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=""%')=5,'S8 kelima fungsi SECURITY DEFINER dengan search_path kosong');
select pg_temp.ok((select count(*) from pg_proc p where p.oid in('public.correct_stock_document(text,uuid,jsonb,text,text,text)'::regprocedure,'public.preview_stock_document_correction(text,uuid,jsonb)'::regprocedure,'public.stock_correction_charge_note(uuid)'::regprocedure) and p.prosrc like '%perform admin_online_private.deny_admin_online();%')=3,'S8 pagar Admin Online (deny_admin_online) ada pada pratinjau, simpan, catatan beban');
select pg_temp.ok(pg_temp.unbalanced()=0,'S8 jurnal seimbang');
do $$declare p jsonb;r jsonb;rows_ jsonb;begin
 perform pg_temp.as_(pg_temp.owner());rows_:=pg_temp.rows_all('s8','{"a":7}');
 set local role authenticated;
 p:=public.preview_stock_document_correction('opname',pg_temp.rid('s8'),rows_);
 r:=public.correct_stock_document('opname',pg_temp.rid('s8'),rows_,'Koreksi sebagai authenticated','kr-s8-ok',p->>'token');
 reset role;
 if (r->>'revision')::int<>1 or pg_temp.sq('s8','a')<>7 then raise exception 'koreksi authenticated gagal';end if;
 insert into res values('s8.cr1',r);
end$$;
select pg_temp.ok((select (r->>'revision')::int=1 and (r->>'applied')::int=1 from res where name='s8.cr1') and pg_temp.sq('s8','a')=7,'S8 Super Admin dengan peran authenticated berhasil memakai pratinjau + simpan');
do $$begin set local role authenticated;perform public.stock_correction_plan('opname',pg_temp.rid('s8'),pg_temp.rows_all('s8','{"b":13}'));exception when insufficient_privilege then reset role;raise notice 'BP_PASS S8 perencana ditolak untuk peran authenticated (permission denied)';end$$;
select pg_temp.ok((select count(*) from public.stock_document_correction_requests)>=1,'S8 catatan permintaan tersimpan');

-- ═════════ S9 kegagalan di tengah penyimpanan: tidak ada efek sebagian ═════════
select pg_temp.doc('s9','[{"c":"a","layers":[[10,100]],"count":8},{"c":"b","layers":[[10,100]],"count":12},{"c":"c","layers":[[10,100]],"count":10}]');
create function pg_temp.fail_repl() returns trigger language plpgsql as $$begin
 if exists(select 1 from public.journal_entries where id=new.entry_id and source='stock-correction') then raise exception 'forced replacement journal failure';end if;return new;end$$;
create function pg_temp.fail_move() returns trigger language plpgsql as $$begin
 if new.source='stock-correction' then raise exception 'forced replacement move failure';end if;return new;end$$;
create function pg_temp.snapall() returns text language sql as $$select md5(
 coalesce((select jsonb_agg(to_jsonb(t) order by t.item_id,t.warehouse_id)::text from public.stock t),'')||coalesce((select jsonb_agg(to_jsonb(t) order by t.id)::text from public.stock_layers t),'')||
 coalesce((select jsonb_agg(to_jsonb(t) order by t.id)::text from public.stock_moves t),'')||coalesce((select jsonb_agg(to_jsonb(t) order by t.id)::text from public.journal_entries t),'')||
 coalesce((select jsonb_agg(to_jsonb(t) order by t.id)::text from public.journal_lines t),'')||coalesce((select jsonb_agg(to_jsonb(t) order by t.id)::text from public.stock_document_corrections t),'')||
 coalesce((select jsonb_agg(to_jsonb(t) order by t.actor_id,t.request_key)::text from public.stock_document_correction_requests t),''))$$;
create temp table s9pre as select pg_temp.snapall() h;grant all on s9pre to public;
create trigger kr_fail_repl before insert on public.journal_lines for each row execute function pg_temp.fail_repl();
select pg_temp.reject('select pg_temp.cr(''s9'',''{"a":7,"b":13}'',''kr-s9-a'')','forced replacement journal failure','S9 jurnal pengganti gagal: koreksi ditolak');
select pg_temp.ok((select h from s9pre)=pg_temp.snapall(),'S9 kegagalan sesudah stok dan jurnal pembalik ditulis: stok, lapisan, kartu stok, jurnal, audit, catatan permintaan sama persis');
drop trigger kr_fail_repl on public.journal_lines;
create trigger kr_fail_move before insert on public.stock_moves for each row execute function pg_temp.fail_move();
select pg_temp.reject('select pg_temp.cr(''s9'',''{"a":7,"b":13}'',''kr-s9-b'')','forced replacement move failure','S9 mutasi pengganti gagal: koreksi ditolak');
select pg_temp.ok((select h from s9pre)=pg_temp.snapall(),'S9 kegagalan di tengah baris: tidak ada efek sebagian');
drop trigger kr_fail_move on public.stock_moves;
select pg_temp.ok((select (pg_temp.cr('s9','{"a":7,"b":13}','kr-s9-c')->>'applied')::int=2),'S9 sesudah pemicu gagal dilepas: koreksi berhasil');
