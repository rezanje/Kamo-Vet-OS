-- Jalur Owner: ubah isi struk petshop berpromo/voucher yang penerimaannya dibatalkan (migrasi 20261119100000). Fixture fiktif; di-rollback.
-- Dibuktikan: hanya Owner (Finance/Admin ditolak), promo baris dihitung database sebanding nilai baris (bukan dari klien), manipulasi promo
-- ditolak, lantai HPP tetap, buku besar & laci benar (shift asal tutup -> shift Owner; shift asal terbuka -> dinetralkan), jalur lama tidak berubah.
begin;
create function pg_temp.ok(value boolean, label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;raise notice 'UO_PASS %',label;end$$;
create function pg_temp.reject(stmt text, expected text, label text) returns void language plpgsql as $$
declare failed boolean:=false;msg text;begin
 begin execute stmt;exception when others then failed:=true;msg:=sqlerrm;end;
 if not failed then raise exception 'Expected rejection: %',label;end if;
 if position(expected in msg)=0 then raise exception 'Unexpected rejection for %: %',label,msg;end if;
 raise notice 'UO_PASS %',label;
end$$;
create function pg_temp.as_(uid text) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',uid,true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);end$$;

-- ── fixtures ──
insert into auth.users(id,raw_user_meta_data) values
 ('fa100000-0000-4000-8000-000000000001','{"full_name":"UO owner"}'),('fa100000-0000-4000-8000-000000000002','{"full_name":"UO finance"}'),
 ('fa100000-0000-4000-8000-000000000003','{"full_name":"UO kasir"}'),('fa100000-0000-4000-8000-000000000004','{"full_name":"UO admin"}');
update profiles set role='OWNER',is_active=true where id='fa100000-0000-4000-8000-000000000001';
update profiles set role='FINANCE',is_active=true where id='fa100000-0000-4000-8000-000000000002';
update profiles set role='STAFF',is_active=true where id='fa100000-0000-4000-8000-000000000003';
update profiles set role='ADMIN',is_active=true where id='fa100000-0000-4000-8000-000000000004';
insert into role_modules(role,module_id) values('STAFF','pos'),('FINANCE','penjualan') on conflict do nothing;
insert into branches(id,code,name,type) values('fa200000-0000-4000-8000-000000000001','UOB1','UO satu','PETSHOP');
insert into user_branches(user_id,branch_id) select u,'fa200000-0000-4000-8000-000000000001' from unnest(array[
 'fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000000003','fa100000-0000-4000-8000-000000000004']::uuid[]) u;
insert into warehouses(id,branch_id,code,name,type) values('fa300000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','UOWH','UO gudang','RETAIL');
insert into items(id,code,name,unit,item_type,buy_price,sell_price) values
 ('fa400000-0000-4000-8000-000000000001','UOSVC','UO jasa','pcs','Jasa',0,20000),
 ('fa400000-0000-4000-8000-000000000002','UOGOOD','UO barang','pcs','Persediaan',3000,50000),
 ('fa400000-0000-4000-8000-000000000003','UOGOOD2','UO barang dua','pcs','Persediaan',3000,30000);
insert into stock(warehouse_id,item_id,qty) values('fa300000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000002',100),
 ('fa300000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000003',100);
insert into stock_layers(warehouse_id,item_id,qty_in,qty_left,unit_cost,source) values
 ('fa300000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000002',100,100,3000,'manual'),
 ('fa300000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000003',100,100,3000,'manual');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1191','UO kas','ASET','D',false),('1192','UO bank','ASET','D',false),('150001','Piutang Usaha','ASET','D',false),
 ('510001','Pendapatan','PENDAPATAN','K',false),('520002','Diskon','PENDAPATAN','D',false),('312005','PPN','LIABILITAS','K',false),
 ('600001','HPP','BEBAN','D',false),('170001','Persediaan','ASET','D',false),('810004','Pendapatan lain','PENDAPATAN','K',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values
 ('fa500000-0000-4000-8000-000000000001','UO kas','Kas','1191'),('fa500000-0000-4000-8000-000000000002','UO bank','Bank','1192');
insert into payment_account_map(metode,branch_id,cash_account_id) values
 ('Tunai','fa200000-0000-4000-8000-000000000001','fa500000-0000-4000-8000-000000000001'),
 ('Transfer','fa200000-0000-4000-8000-000000000001','fa500000-0000-4000-8000-000000000002') on conflict do nothing;
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false,ppn_rate=11;
-- promo nominal 5.000/unit untuk UO barang; voucher nominal 7.000
insert into promos(id,name,promo_type,rule,is_active,auto_apply,discount_type,discount_value) values
 ('fa800000-0000-4000-8000-000000000001','UO promo','diskon_produk','{}',true,true,'nominal',5000);
insert into promo_items(promo_id,item_id) values('fa800000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000002');
insert into vouchers(code,tipe,nilai,is_active,max_potongan) values('UOV7','nominal',7000,true,null);
-- shift kasir (asal struk) dan shift Owner
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance) values
 ('fa600000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000003','petshop',0),
 ('fa600000-0000-4000-8000-000000000009','fa200000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','petshop',0);

-- Struk kasir lewat jalur resmi (stok atomik). lines: [{item,qty,harga,promo}] ; promo = potongan promo baris (promo_id UO promo bila >0)
create function pg_temp.sale(ref text, lines jsonb, voucher numeric, plan jsonb, shift uuid default 'fa600000-0000-4000-8000-000000000001') returns uuid language plpgsql as $$
declare doc uuid;sub numeric;pr numeric;tot numeric;l jsonb;p integer:=0;begin
 perform pg_temp.as_('fa100000-0000-4000-8000-000000000003');
 select sum((x->>'qty')::numeric*(x->>'harga')::numeric),coalesce(sum((x->>'promo')::numeric),0) into sub,pr from jsonb_array_elements(lines) x;
 tot:=sub-pr-voucher;
 insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,voucher_code,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
  values('fa200000-0000-4000-8000-000000000001',ref,sub,pr+voucher,tot,case when jsonb_array_length(plan)>1 then 'Split' else plan->0->>'method' end,tot,0,
   case when voucher>0 then 'UOV7' end,'fa100000-0000-4000-8000-000000000003',shift,plan,'k:'||ref,repeat('a',64)) returning id into doc;
 for l in select value from jsonb_array_elements(lines) loop
  insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,promo_id,promo_discount)
   values(doc,(l->>'item')::uuid,'baris',(l->>'qty')::numeric,(l->>'harga')::numeric,'pcs',1,0,p,
    case when coalesce((l->>'promo')::numeric,0)>0 then 'fa800000-0000-4000-8000-000000000001'::uuid end,coalesce((l->>'promo')::numeric,0));
  p:=p+1;
 end loop;
 perform cashier_post_stock_atomic(doc,'fa300000-0000-4000-8000-000000000001');
 return doc;end$$;
create function pg_temp.backdate(doc uuid, days integer) returns void language plpgsql as $$
declare ref text;begin
 select no_struk into ref from public.sales where id=doc;
 set local session_replication_role=replica;
 update public.sales set created_at=created_at-make_interval(days=>days),payments_finalized_at=payments_finalized_at-make_interval(days=>days) where id=doc;
 update public.journal_entries set tanggal=tanggal-days where source in('sale','sale-hpp') and source_ref=ref;
 update public.stock_moves set tanggal=tanggal-days where source in('sale','sale-group') and source_ref=ref;
 set local session_replication_role=origin;
end$$;
create function pg_temp.sid(ref text) returns uuid language sql security definer as $$select id from public.sales where no_struk=$1$$;
create function pg_temp.rev(ref text) returns integer language sql security definer as $$select revision from public.sales where no_struk=$1$$;
create function pg_temp.lid(ref text, pos integer) returns uuid language sql security definer as $$
 select i.id from public.sale_items i join public.sales s on s.id=i.sale_id where s.no_struk=$1 and i.source_position=$2$$;
-- Saldo akun dari seluruh jurnal rantai struk (asal + pembatalan penerimaan + ubah), opsional per tanggal.
create function pg_temp.bal(refs text[], code text, on_date date default null) returns numeric language sql security definer as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id
 where a.code=$2 and ($3 is null or e.tanggal=$3) and (
  e.source_ref=any($1)
  or e.source_ref in(select c.id::text from public.sale_cancellations c join public.sales s on s.id=c.sale_id where s.no_struk=any($1))
  or e.source_ref in(select c.id::text from public.pos_receipt_cancellations c join public.sales s on s.id=c.sale_id where s.no_struk=any($1)))
$$;
create function pg_temp.edit_payload(lines jsonb, subtotal numeric, discount numeric, plan jsonb) returns jsonb language sql as $$
 select jsonb_build_object('header',jsonb_build_object('subtotal',subtotal,'discount',discount,'diskon_kategori',0,
  'total',(select sum((x->>'amount')::numeric) from jsonb_array_elements(plan) x),'merchant_fee_total',0,
  'metode_bayar',case when jsonb_array_length(plan)>1 then 'Split' else plan->0->>'method' end,
  'bayar',(select sum((x->>'amount')::numeric) from jsonb_array_elements(plan) x),'kembali',0,'payment_plan',plan,'poin_earned',0),'lines',lines)
$$;
-- baris barang UO barang (opsional sumber + promo) dan baris jasa
create function pg_temp.lg(src uuid, qty numeric, harga numeric, promo numeric, item uuid default 'fa400000-0000-4000-8000-000000000002') returns jsonb language sql as $$
 select jsonb_build_object('item_id',item,'nama','baris','qty',qty,'harga',harga,'satuan','pcs','faktor',1,'source_line_id',src)
  ||case when promo is null then '{}'::jsonb else jsonb_build_object('promo_id','fa800000-0000-4000-8000-000000000001','promo_discount',promo) end$$;
create function pg_temp.lj(qty numeric default 1) returns jsonb language sql as $$
 select jsonb_build_object('item_id','fa400000-0000-4000-8000-000000000001','nama','UO jasa','qty',qty,'harga',20000,'satuan','pcs','faktor',1)$$;
create function pg_temp.ed(ref text, key text, lines jsonb, subtotal numeric, discount numeric, plan jsonb) returns text language sql as $$
 select format('select edit_posted_pos_sale(%L::uuid,%s,%L,%L,%L::jsonb)',pg_temp.sid(ref),pg_temp.rev(ref),key,'Owner ubah isi struk promo',
  pg_temp.edit_payload(lines,subtotal,discount,plan)::text)$$;
create temp table uo_d(d date, today date);
insert into uo_d values(((now()-interval '3 days') at time zone 'Asia/Jakarta')::date,(now() at time zone 'Asia/Jakarta')::date);
grant select on uo_d to authenticated;
create temp table uo_res(k text primary key, r jsonb);
grant all on uo_res to authenticated;

-- ── Struk A: 2 x 50.000 promo 10.000 + voucher 7.000 = 83.000 Tunai, tanggal 3 hari lalu, shift kasir sudah tutup ──
set local role authenticated;
select pg_temp.sale('UO-A',jsonb_build_array(jsonb_build_object('item','fa400000-0000-4000-8000-000000000002','qty',2,'harga',50000,'promo',10000)),7000,'[{"method":"Tunai","amount":83000}]');
-- Struk N (tanpa promo/voucher) dan struk R (berpromo, penerimaan dibatalkan lalu diterima lagi) untuk perilaku lama
select pg_temp.sale('UO-N',jsonb_build_array(jsonb_build_object('item','fa400000-0000-4000-8000-000000000003','qty',1,'harga',30000)),0,'[{"method":"Tunai","amount":30000}]');
select pg_temp.sale('UO-R',jsonb_build_array(jsonb_build_object('item','fa400000-0000-4000-8000-000000000002','qty',1,'harga',50000,'promo',5000)),0,'[{"method":"Tunai","amount":45000}]');
-- Struk P (berpromo, sudah dibayar, tidak dibatalkan) untuk jalur lama (Finance, promo dari klien, hasil tanpa penanda)
select pg_temp.sale('UO-P',jsonb_build_array(jsonb_build_object('item','fa400000-0000-4000-8000-000000000002','qty',1,'harga',50000,'promo',5000)),0,'[{"method":"Tunai","amount":45000}]');
set local role postgres;
select pg_temp.backdate(pg_temp.sid(r),3) from unnest(array['UO-A','UO-N','UO-R','UO-P']) r;
set local session_replication_role=replica;
update cashier_shifts set status='closed',closed_at=now() where id='fa600000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select pg_temp.ok((select qty=96 from stock where item_id='fa400000-0000-4000-8000-000000000002'),'fixture: 4 UO barang terjual');
-- Owner membatalkan penerimaan A, N, R (laci: shift Owner karena shift asal tutup); R lalu diterima lagi.
set local role authenticated;
select pg_temp.as_('fa100000-0000-4000-8000-000000000001');
select cancel_pos_sale_receipt(pg_temp.sid(r),pg_temp.rev(r),'uo-cancel-'||r,'Pelanggan minta ubah isi') from unnest(array['UO-A','UO-N','UO-R']) r;
select receive_pos_sale_payment(pg_temp.sid('UO-R'),pg_temp.rev('UO-R'),'uo-recv-r','[{"method":"Tunai","amount":45000}]');
set local role postgres;
select pg_temp.ok((select count(*)=1 from pos_receipt_cancellations c join sales s on s.id=c.sale_id where s.no_struk='UO-A' and c.closed_at is null
  and c.effect_shift_id='fa600000-0000-4000-8000-000000000009'),'fixture: penerimaan A dibatalkan, efek laci di shift Owner');
select pg_temp.ok(pg_temp.bal(array['UO-A'],'1191')=0 and pg_temp.bal(array['UO-A'],'150001')=83000,'fixture: kas A keluar, Piutang Usaha 83.000');

-- ── Penolakan ──
set local role authenticated;
select pg_temp.as_('fa100000-0000-4000-8000-000000000002');
select pg_temp.reject(pg_temp.ed('UO-A','uo-fin',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-A',0),2,50000,10000)),100000,17000,'[{"method":"Tunai","amount":83000}]'),
 'hanya bisa diubah isinya oleh Owner','Finance ditolak pada struk promo belum dibayar (gagal tertutup)');
select pg_temp.as_('fa100000-0000-4000-8000-000000000004');
select pg_temp.reject(pg_temp.ed('UO-A','uo-adm',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-A',0),2,50000,10000)),100000,17000,'[{"method":"Tunai","amount":83000}]'),
 'Hanya Owner atau Finance','Admin ditolak');
select pg_temp.as_('fa100000-0000-4000-8000-000000000003');
select pg_temp.reject(pg_temp.ed('UO-A','uo-kasir',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-A',0),2,50000,10000)),100000,17000,'[{"method":"Tunai","amount":83000}]'),
 'Hanya Owner atau Finance','kasir ditolak');
select pg_temp.as_('fa100000-0000-4000-8000-000000000001');
-- qty 2 -> 3: promo wajib 15.000 (10.000 x 150.000/100.000); klien mengirim 10.000 -> ditolak
select pg_temp.reject(pg_temp.ed('UO-A','uo-p1',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-A',0),3,50000,10000)),150000,17000,'[{"method":"Tunai","amount":133000}]'),
 'Potongan promo baris 1 harus Rp15','promo dari klien yang tidak sebanding ditolak');
-- klien menaikkan promo (30.000) -> ditolak
select pg_temp.reject(pg_temp.ed('UO-A','uo-p2',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-A',0),3,50000,30000)),150000,37000,'[{"method":"Tunai","amount":113000}]'),
 'harus Rp15','promo dinaikkan klien ditolak');
-- baris tidak berubah: promo wajib persis 10.000
select pg_temp.reject(pg_temp.ed('UO-A','uo-p3',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-A',0),2,50000,9000)),100000,16000,'[{"method":"Tunai","amount":84000}]'),
 'harus Rp10','baris tidak berubah: promo wajib sama persis');
-- identitas promo dihapus/diubah
select pg_temp.reject(pg_temp.ed('UO-A','uo-p4',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-A',0),2,50000,null)),100000,7000,'[{"method":"Tunai","amount":93000}]'),
 'Data promo baris 1 tidak boleh diubah','identitas promo tidak boleh dibuang');
select pg_temp.reject(pg_temp.ed('UO-A','uo-p5',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-A',0),2,50000,10000)||'{"promo_sets":3}'),100000,17000,'[{"method":"Tunai","amount":83000}]'),
 'Data promo baris 1 tidak boleh diubah','set/kuota promo tidak boleh diubah klien');
-- barang baru membawa promo
select pg_temp.reject(pg_temp.ed('UO-A','uo-p6',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-A',0),2,50000,10000),pg_temp.lg(null,1,50000,5000)),150000,22000,'[{"method":"Tunai","amount":128000}]'),
 'Baris 2 adalah barang baru','barang baru tidak boleh membawa promo');
select pg_temp.reject(pg_temp.ed('UO-A','uo-p6b',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-A',0),2,50000,10000),pg_temp.lj()||'{"promo_floor_waiver":true}'),120000,17000,'[{"method":"Tunai","amount":103000}]'),
 'Baris 2 adalah barang baru','barang baru tidak boleh membawa izin promo di bawah HPP');
-- baris sumber milik struk lain / dobel / barang diganti
select pg_temp.reject(pg_temp.ed('UO-A','uo-p7',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-P',0),1,50000,5000)),50000,12000,'[{"method":"Tunai","amount":38000}]'),
 'bukan milik struk ini','baris sumber dari struk lain ditolak');
select pg_temp.reject(pg_temp.ed('UO-A','uo-p8',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-A',0),1,50000,5000),pg_temp.lg(pg_temp.lid('UO-A',0),1,50000,5000)),100000,17000,'[{"method":"Tunai","amount":83000}]'),
 'terduplikasi','baris sumber dipakai dua kali ditolak');
select pg_temp.reject(pg_temp.ed('UO-A','uo-p9',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-A',0),2,30000,null,'fa400000-0000-4000-8000-000000000003')),60000,7000,'[{"method":"Tunai","amount":53000}]'),
 'tidak boleh diganti','barang pada baris sumber tidak boleh diganti');
-- lantai HPP tetap: harga 4.000 x 3 (promo sebanding 1.200) + voucher 7.000 -> neto per unit < HPP 3.000
select pg_temp.reject(pg_temp.ed('UO-A','uo-floor',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-A',0),3,4000,1200)),12000,8200,'[{"method":"Tunai","amount":3800}]'),
 'di bawah HPP','aturan di bawah modal tetap berlaku');
-- struk tanpa promo/voucher & struk yang pembatalan penerimaannya sudah ditutup: perilaku lama
select pg_temp.reject(pg_temp.ed('UO-N','uo-n1',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-N',0),2,30000,null,'fa400000-0000-4000-8000-000000000003')),60000,0,'[{"method":"Tunai","amount":60000}]'),
 'pernah dibatalkan penerimaannya','struk tanpa promo yang belum dibayar: tetap jalur lama (Batalkan penjualan)');
select pg_temp.reject(pg_temp.ed('UO-R','uo-r1',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-R',0),1,50000,5000)),50000,5000,'[{"method":"Tunai","amount":45000}]'),
 'pernah dibatalkan penerimaannya','struk berpromo yang sudah diterima lagi: tetap ditolak seperti dulu');
set local role postgres;
select pg_temp.ok((select voided_at is null and revision=0 from sales where no_struk='UO-A')
 and (select count(*)=1 from pos_receipt_cancellations c join sales s on s.id=c.sale_id where s.no_struk='UO-A' and c.closed_at is null),'penolakan tidak menyentuh struk A');

-- ── Owner mengubah A: qty 3 (promo sebanding 15.000) + jasa baru 20.000, voucher 7.000; bayar Tunai 48.000 + Transfer 100.000 ──
set local role authenticated;
select pg_temp.as_('fa100000-0000-4000-8000-000000000001');
insert into uo_res select 'A', edit_posted_pos_sale(pg_temp.sid('UO-A'),pg_temp.rev('UO-A'),'uo-a1','Owner ubah isi struk promo',pg_temp.edit_payload(
 jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-A',0),3,50000,15000),pg_temp.lj()),170000,22000,'[{"method":"Tunai","amount":48000},{"method":"Transfer","amount":100000}]'));
set local role postgres;
select pg_temp.ok((select r->>'no_struk'='UO-A-U1' and (r->>'unpaid_path')::boolean and r->>'effect_shift_id'='fa600000-0000-4000-8000-000000000009' from uo_res where k='A'),
 'hasil: struk -U1, penanda jalur Owner, efek laci di shift Owner');
select pg_temp.ok((select voided_at is not null and revision=1 from sales where no_struk='UO-A'),'struk lama ditutup');
select pg_temp.ok((select n.created_at=o.created_at+interval '1 millisecond' and n.shift_id='fa600000-0000-4000-8000-000000000001' and n.total=148000
  and n.discount=22000 and n.voucher_code='UOV7' and n.voided_at is null from sales n,sales o where n.no_struk='UO-A-U1' and o.no_struk='UO-A'),
 'struk pengganti di tanggal & shift asal, voucher terbawa, total 148.000');
select pg_temp.ok((select promo_id='fa800000-0000-4000-8000-000000000001' and promo_discount=15000 and qty=3 from sale_items i join sales s on s.id=i.sale_id
  where s.no_struk='UO-A-U1' and i.item_id='fa400000-0000-4000-8000-000000000002')
 and (select promo_id is null and promo_discount=0 from sale_items i join sales s on s.id=i.sale_id where s.no_struk='UO-A-U1' and i.item_id='fa400000-0000-4000-8000-000000000001'),
 'promo baris sebanding (15.000), barang baru tanpa promo');
select pg_temp.ok((select closed_at is not null and closed_kind='penjualan-dibatalkan' from pos_receipt_cancellations c join sales s on s.id=c.sale_id where s.no_struk='UO-A'),
 'pembatalan penerimaan A ditutup');
select pg_temp.ok((select count(*)=1 from sale_edits e join sales o on o.id=e.old_sale_id join sales n on n.id=e.new_sale_id where o.no_struk='UO-A' and n.no_struk='UO-A-U1'
  and e.created_by='fa100000-0000-4000-8000-000000000001'),'jejak ubah transaksi tercatat');
-- Buku besar seluruh rantai: kas = Tunai baru, bank = Transfer baru, Piutang Usaha nol, pendapatan & diskon = struk baru (di tanggal struk)
select pg_temp.ok(pg_temp.bal(array['UO-A','UO-A-U1'],'1191')=48000 and pg_temp.bal(array['UO-A','UO-A-U1'],'1192')=100000
 and pg_temp.bal(array['UO-A','UO-A-U1'],'150001')=0
 and pg_temp.bal(array['UO-A','UO-A-U1'],'510001',(select d from uo_d))=-170000 and pg_temp.bal(array['UO-A','UO-A-U1'],'520002',(select d from uo_d))=22000
 and pg_temp.bal(array['UO-A','UO-A-U1'],'1191',(select d from uo_d))=48000 and pg_temp.bal(array['UO-A','UO-A-U1'],'1191',(select today from uo_d))=0,
 'buku besar: kas 48.000 + bank 100.000 di tanggal struk, Piutang Usaha 0, pembatalan penerimaan hari ini netral');
select pg_temp.ok((select count(*)=1 and sum(debit)=sum(credit) from (select e.id,sum(l.debit) debit,sum(l.credit) credit from journal_entries e join journal_lines l on l.entry_id=e.id
  where e.source='sale-void-receipt' and e.source_ref in(select c.id::text from sale_cancellations c join sales s on s.id=c.sale_id where s.no_struk='UO-A') group by e.id) z),
 'jurnal pembatalan penerimaan dibalik tepat sekali dan seimbang');
-- Laci: shift Owner = -83.000 Tunai (uang dikembalikan) + 48.000 Tunai & 100.000 Transfer (uang diterima); shift kasir yang tutup tidak disentuh
select pg_temp.ok((select coalesce(sum(amount) filter(where method='Tunai'),0)=-35000 and coalesce(sum(amount) filter(where method='Transfer'),0)=100000
  from sale_receipt_shift_effects where shift_id='fa600000-0000-4000-8000-000000000009' and sale_id in(pg_temp.sid('UO-A'),pg_temp.sid('UO-A-U1')))
 and (select count(*)=2 from sale_receipt_shift_effects e where e.sale_id=pg_temp.sid('UO-A-U1') and e.kind='terima'
  and e.cancellation_id=(select c.id from pos_receipt_cancellations c where c.sale_id=pg_temp.sid('UO-A')))
 and not exists(select 1 from sale_receipt_shift_effects where shift_id='fa600000-0000-4000-8000-000000000001'),
 'laci: uang baru masuk shift Owner, shift asal yang tutup tidak disentuh');
select pg_temp.ok((select qty=95 from stock where item_id='fa400000-0000-4000-8000-000000000002'),'stok: 2 kembali, 3 keluar hari ini');
select pg_temp.ok(not exists(select 1 from pos_sale_edit_gate),'gerbang privat dibersihkan');
-- Idempotensi
set local role authenticated;
select pg_temp.ok((select edit_posted_pos_sale(pg_temp.sid('UO-A'),0,'uo-a1','Owner ubah isi struk promo',pg_temp.edit_payload(
 jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-A',0),3,50000,15000),pg_temp.lj()),170000,22000,'[{"method":"Tunai","amount":48000},{"method":"Transfer","amount":100000}]'))->>'no_struk'='UO-A-U1'),
 'kunci sama mengulang hasil yang sama');

-- ── Struk B: shift asal MASIH TERBUKA; promo baris tidak berubah (wajib persis), tambah jasa ──
set local role postgres;
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance) values
 ('fa600000-0000-4000-8000-000000000002','fa200000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000003','petshop',0);
set local role authenticated;
select pg_temp.sale('UO-B',jsonb_build_array(jsonb_build_object('item','fa400000-0000-4000-8000-000000000002','qty',1,'harga',50000,'promo',5000)),7000,'[{"method":"Tunai","amount":38000}]',
 'fa600000-0000-4000-8000-000000000002');
select pg_temp.as_('fa100000-0000-4000-8000-000000000001');
select cancel_pos_sale_receipt(pg_temp.sid('UO-B'),pg_temp.rev('UO-B'),'uo-cancel-b','Salah barang');
insert into uo_res select 'B', edit_posted_pos_sale(pg_temp.sid('UO-B'),pg_temp.rev('UO-B'),'uo-b1','Tambah jasa',pg_temp.edit_payload(
 jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-B',0),1,50000,5000),pg_temp.lj()),70000,12000,'[{"method":"Tunai","amount":58000}]'));
set local role postgres;
select pg_temp.ok((select (r->>'unpaid_path')::boolean and r->'effect_shift_id'='null'::jsonb from uo_res where k='B'),'shift asal terbuka: tanpa efek laci tambahan');
select pg_temp.ok((select coalesce(sum(amount),0)=0 from sale_receipt_shift_effects where shift_id='fa600000-0000-4000-8000-000000000002')
 and (select count(*)=2 from sale_receipt_shift_effects where shift_id='fa600000-0000-4000-8000-000000000002')
 and not exists(select 1 from sale_receipt_shift_effects where sale_id=pg_temp.sid('UO-B-U1')),
 'shift asal terbuka: efek batal dinetralkan, struk pengganti dihitung lewat penjualannya');
select pg_temp.ok((select promo_discount=5000 from sale_items i join sales s on s.id=i.sale_id where s.no_struk='UO-B-U1' and i.item_id='fa400000-0000-4000-8000-000000000002')
 and pg_temp.bal(array['UO-B','UO-B-U1'],'1191')=58000 and pg_temp.bal(array['UO-B','UO-B-U1'],'150001')=0,'baris tak berubah membawa promo persis; buku = struk baru');

-- ── Struk C: shift asal tutup, Owner TANPA shift terbuka -> tidak menyentuh laci siapa pun (Owner tidak dikunci) ──
set local role authenticated;
select pg_temp.sale('UO-C',jsonb_build_array(jsonb_build_object('item','fa400000-0000-4000-8000-000000000002','qty',2,'harga',50000,'promo',10000)),0,'[{"method":"Tunai","amount":90000}]',
 'fa600000-0000-4000-8000-000000000002');
set local role postgres;
set local session_replication_role=replica;
update cashier_shifts set status='closed',closed_at=now() where id in('fa600000-0000-4000-8000-000000000002','fa600000-0000-4000-8000-000000000009');
set local session_replication_role=origin;
-- shift kasir LAIN yang terbuka di cabang yang sama tidak boleh menerima efek laci Owner
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance) values
 ('fa600000-0000-4000-8000-000000000003','fa200000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000003','petshop',0);
set local role authenticated;
select pg_temp.as_('fa100000-0000-4000-8000-000000000001');
select cancel_pos_sale_receipt(pg_temp.sid('UO-C'),pg_temp.rev('UO-C'),'uo-cancel-c','Harga salah');
-- harga 50.000 -> 45.000: promo sebanding 9.000 (10.000 x 90.000/100.000)
insert into uo_res select 'C', edit_posted_pos_sale(pg_temp.sid('UO-C'),pg_temp.rev('UO-C'),'uo-c1','Harga salah',pg_temp.edit_payload(
 jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-C',0),2,45000,9000)),90000,9000,'[{"method":"Tunai","amount":81000}]'));
set local role postgres;
select pg_temp.ok((select (r->>'unpaid_path')::boolean and r->'effect_shift_id'='null'::jsonb from uo_res where k='C')
 and not exists(select 1 from sale_receipt_shift_effects where sale_id=pg_temp.sid('UO-C-U1'))
 and not exists(select 1 from sale_receipt_shift_effects where shift_id='fa600000-0000-4000-8000-000000000003'),
 'Owner tanpa shift terbuka: tidak ada efek laci (shift kasir lain tidak disentuh)');
select pg_temp.ok((select promo_discount=9000 from sale_items i join sales s on s.id=i.sale_id where s.no_struk='UO-C-U1'),'harga turun: promo ikut turun sebanding');

-- ── Struk D: pembulatan promo sebanding ──
set local role authenticated;
select pg_temp.sale('UO-D',jsonb_build_array(jsonb_build_object('item','fa400000-0000-4000-8000-000000000002','qty',3,'harga',50000,'promo',10000)),0,'[{"method":"Tunai","amount":140000}]',
 'fa600000-0000-4000-8000-000000000003');
select pg_temp.as_('fa100000-0000-4000-8000-000000000001');
select cancel_pos_sale_receipt(pg_temp.sid('UO-D'),pg_temp.rev('UO-D'),'uo-cancel-d','Qty salah');
-- qty 3 -> 1: 10.000 x 50.000 / 150.000 = 3.333,33 (dibulatkan 2 desimal)
select pg_temp.reject(pg_temp.ed('UO-D','uo-d0',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-D',0),1,50000,3333)),50000,3333,'[{"method":"Transfer","amount":46667}]'),
 'harus Rp3','pembulatan: 3.333 (tanpa sen) ditolak');
insert into uo_res select 'D', edit_posted_pos_sale(pg_temp.sid('UO-D'),pg_temp.rev('UO-D'),'uo-d1','Qty salah',pg_temp.edit_payload(
 jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-D',0),1,50000,3333.33)),50000,3333.33,'[{"method":"Transfer","amount":46666.67}]'));
set local role postgres;
select pg_temp.ok((select promo_discount=3333.33 from sale_items i join sales s on s.id=i.sale_id where s.no_struk='UO-D-U1'),'promo sebanding dibulatkan 2 desimal');

-- ── Struk E: data lama dengan promo melebihi nilai baris (anomali) -> promo baru dibatasi nilai baris baru ──
set local role authenticated;
select pg_temp.sale('UO-E',jsonb_build_array(jsonb_build_object('item','fa400000-0000-4000-8000-000000000001','qty',1,'harga',20000),
  jsonb_build_object('item','fa400000-0000-4000-8000-000000000003','qty',1,'harga',30000)),0,'[{"method":"Tunai","amount":50000}]',
 'fa600000-0000-4000-8000-000000000003');
set local role postgres;
set local session_replication_role=replica;
update sale_items set promo_id='fa800000-0000-4000-8000-000000000001',promo_discount=25000 where sale_id=pg_temp.sid('UO-E') and source_position=0;
set local session_replication_role=origin;
set local role authenticated;
select pg_temp.as_('fa100000-0000-4000-8000-000000000001');
select cancel_pos_sale_receipt(pg_temp.sid('UO-E'),pg_temp.rev('UO-E'),'uo-cancel-e','Qty jasa salah');
-- jasa qty 1 -> 2: 25.000 x 40.000/20.000 = 50.000 > nilai baris 40.000 -> wajib 40.000; barang dua tidak berubah (tanpa promo)
select pg_temp.reject(pg_temp.ed('UO-E','uo-e0',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-E',0),2,20000,50000,'fa400000-0000-4000-8000-000000000001'),
  pg_temp.lg(pg_temp.lid('UO-E',1),1,30000,null,'fa400000-0000-4000-8000-000000000003')),70000,50000,'[{"method":"Tunai","amount":20000}]'),
 'harus Rp40','promo melebihi nilai baris ditolak');
insert into uo_res select 'E', edit_posted_pos_sale(pg_temp.sid('UO-E'),pg_temp.rev('UO-E'),'uo-e1','Qty jasa salah',pg_temp.edit_payload(
 jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-E',0),2,20000,40000,'fa400000-0000-4000-8000-000000000001'),
  pg_temp.lg(pg_temp.lid('UO-E',1),1,30000,null,'fa400000-0000-4000-8000-000000000003')),70000,40000,'[{"method":"Tunai","amount":30000}]'));
set local role postgres;
select pg_temp.ok((select promo_discount=40000 from sale_items i join sales s on s.id=i.sale_id where s.no_struk='UO-E-U1' and i.item_id='fa400000-0000-4000-8000-000000000001'),
 'promo dibatasi nilai baris baru');

-- ── Struk F: berpromo, penerimaan dibatalkan -> diterima lagi -> dibatalkan LAGI: tetap jalur lama (ada pembatalan tertutup) ──
set local role authenticated;
select pg_temp.sale('UO-F',jsonb_build_array(jsonb_build_object('item','fa400000-0000-4000-8000-000000000002','qty',1,'harga',50000,'promo',5000)),0,'[{"method":"Tunai","amount":45000}]',
 'fa600000-0000-4000-8000-000000000003');
select pg_temp.as_('fa100000-0000-4000-8000-000000000001');
select cancel_pos_sale_receipt(pg_temp.sid('UO-F'),pg_temp.rev('UO-F'),'uo-cancel-f1','Salah metode');
select receive_pos_sale_payment(pg_temp.sid('UO-F'),pg_temp.rev('UO-F'),'uo-recv-f','[{"method":"Tunai","amount":45000}]');
select cancel_pos_sale_receipt(pg_temp.sid('UO-F'),pg_temp.rev('UO-F'),'uo-cancel-f2','Salah lagi');
select pg_temp.reject(pg_temp.ed('UO-F','uo-f1',jsonb_build_array(pg_temp.lg(pg_temp.lid('UO-F',0),1,50000,5000)),50000,5000,'[{"method":"Tunai","amount":45000}]'),
 'pernah dibatalkan penerimaannya','pembatalan kedua setelah diterima lagi: tetap ditolak (riwayat tertutup)');
set local role postgres;

-- ── Jalur lama tidak berubah: Finance mengubah struk P yang sudah dibayar, promo dari klien, hasil tanpa penanda ──
set local role authenticated;
select pg_temp.as_('fa100000-0000-4000-8000-000000000002');
insert into uo_res select 'P', edit_posted_pos_sale(pg_temp.sid('UO-P'),pg_temp.rev('UO-P'),'uo-p-fin','Koreksi Finance',pg_temp.edit_payload(
 jsonb_build_array(jsonb_build_object('item_id','fa400000-0000-4000-8000-000000000002','nama','baris','qty',1,'harga',50000,'satuan','pcs','faktor',1,
  'promo_id','fa800000-0000-4000-8000-000000000001','promo_discount',5000)),50000,5000,'[{"method":"Tunai","amount":45000}]'));
set local role postgres;
select pg_temp.ok((select not (r ? 'unpaid_path') and r->>'no_struk'='UO-P-U1' from uo_res where k='P'),'jalur lama: Finance tetap bisa, hasil tanpa penanda baru');
rollback;
