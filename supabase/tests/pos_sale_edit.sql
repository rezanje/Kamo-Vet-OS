-- Ubah transaksi struk kasir petshop (migrasi 20261115500000_ubah_struk_petshop.sql). Fixture fiktif; semua di-rollback.
-- Dibuktikan: struk tetap di tanggal asli (omzet + kas/bank), stok & HPP di hari ubah, shift tertutup boleh, Owner + Finance,
-- rekening tercatat dipertahankan, rantai koreksi metode bayar ikut dibalik, promo terbawa, idempotensi, penolakan yang perlu.
begin;
create function pg_temp.ok(value boolean, label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;raise notice 'UE_PASS %',label;end$$;
create function pg_temp.reject(stmt text, expected text, label text) returns void language plpgsql as $$
declare failed boolean:=false;msg text;begin
 begin execute stmt;exception when others then failed:=true;msg:=sqlerrm;end;
 if not failed then raise exception 'Expected rejection: %',label;end if;
 if position(expected in msg)=0 then raise exception 'Unexpected rejection for %: %',label,msg;end if;
 raise notice 'UE_PASS %',label;
end$$;
create function pg_temp.as_(uid text) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',uid,true);perform set_config('request.jwt.claims','{"role":"authenticated"}',true);end$$;

-- ── fixtures ──
insert into auth.users(id,raw_user_meta_data) values
 ('ee100000-0000-4000-8000-000000000001','{"full_name":"UE owner"}'),('ee100000-0000-4000-8000-000000000002','{"full_name":"UE finance"}'),
 ('ee100000-0000-4000-8000-000000000003','{"full_name":"UE cashier"}'),('ee100000-0000-4000-8000-000000000004','{"full_name":"UE admin"}');
update profiles set role='OWNER',is_active=true where id='ee100000-0000-4000-8000-000000000001';
update profiles set role='FINANCE',is_active=true where id='ee100000-0000-4000-8000-000000000002';
update profiles set role='STAFF',is_active=true where id='ee100000-0000-4000-8000-000000000003';
update profiles set role='ADMIN',is_active=true where id='ee100000-0000-4000-8000-000000000004';
insert into role_modules(role,module_id) values('STAFF','pos'),('FINANCE','penjualan') on conflict do nothing;
insert into branches(id,code,name,type) values('ee200000-0000-4000-8000-000000000001','UEB1','UE satu','PETSHOP');
insert into user_branches(user_id,branch_id) select u,'ee200000-0000-4000-8000-000000000001' from unnest(array[
 'ee100000-0000-4000-8000-000000000001','ee100000-0000-4000-8000-000000000002','ee100000-0000-4000-8000-000000000003','ee100000-0000-4000-8000-000000000004']::uuid[]) u;
insert into warehouses(id,branch_id,code,name,type) values('ee300000-0000-4000-8000-000000000001','ee200000-0000-4000-8000-000000000001','UEWH','UE gudang','RETAIL');
insert into items(id,code,name,unit,item_type,buy_price,sell_price) values
 ('ee400000-0000-4000-8000-000000000001','UESVC','UE jasa','pcs','Jasa',0,20000),
 ('ee400000-0000-4000-8000-000000000002','UEGOOD','UE barang','pcs','Persediaan',3000,50000);
insert into stock(warehouse_id,item_id,qty) values('ee300000-0000-4000-8000-000000000001','ee400000-0000-4000-8000-000000000002',100);
insert into stock_layers(warehouse_id,item_id,qty_in,qty_left,unit_cost,source) values
 ('ee300000-0000-4000-8000-000000000001','ee400000-0000-4000-8000-000000000002',100,100,3000,'manual');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1191','UE kas lama','ASET','D',false),('1192','UE bank','ASET','D',false),('1193','UE kas toko','ASET','D',false),
 ('510001','Pendapatan','PENDAPATAN','K',false),('520002','Diskon','PENDAPATAN','D',false),('312005','PPN','LIABILITAS','K',false),
 ('600001','HPP','BEBAN','D',false),('170001','Persediaan','ASET','D',false),('810004','Pendapatan lain','PENDAPATAN','K',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values
 ('ee500000-0000-4000-8000-000000000001','UE kas lama','Kas','1191'),('ee500000-0000-4000-8000-000000000002','UE bank','Bank','1192');
insert into cash_accounts(id,nama,jenis,coa_code,branch_id) values
 ('ee500000-0000-4000-8000-000000000003','UE kas toko','Kas','1193','ee200000-0000-4000-8000-000000000001');
insert into payment_account_map(metode,branch_id,cash_account_id) values
 ('Tunai','ee200000-0000-4000-8000-000000000001','ee500000-0000-4000-8000-000000000001'),
 ('Transfer','ee200000-0000-4000-8000-000000000001','ee500000-0000-4000-8000-000000000002') on conflict do nothing;
insert into customers(id,name,phone,points) values('ee700000-0000-4000-8000-000000000001','UE pelanggan','0800000001',0);
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false,ppn_rate=11;
insert into promos(id,name,promo_type,rule,is_active,discount_type,discount_value) values
 ('ee800000-0000-4000-8000-000000000001','UE promo lama','diskon_produk','{}'::jsonb,false,'nominal',5000);
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance) values
 ('ee600000-0000-4000-8000-000000000001','ee200000-0000-4000-8000-000000000001','ee100000-0000-4000-8000-000000000003','petshop',0);

-- Struk kasir lewat jalur resmi (stok atomik), lalu dimundurkan 4 hari (seolah dibuat tanggal 2, diubah tanggal 6).
create function pg_temp.sale(ref text, qty numeric, harga numeric, plan jsonb, cust uuid default null, earned integer default 0) returns uuid language plpgsql as $$
declare doc uuid;tot numeric:=qty*harga;begin
 perform pg_temp.as_('ee100000-0000-4000-8000-000000000003');
 insert into sales(branch_id,customer_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
  values('ee200000-0000-4000-8000-000000000001',cust,ref,tot,0,tot,case when jsonb_array_length(plan)>1 then 'Split' else plan->0->>'method' end,tot,0,earned,
   'ee100000-0000-4000-8000-000000000003','ee600000-0000-4000-8000-000000000001',plan,'k:'||ref,repeat('a',64)) returning id into doc;
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position) values(doc,'ee400000-0000-4000-8000-000000000002','UE barang',qty,harga,'pcs',1,0,0);
 perform cashier_post_stock_atomic(doc,'ee300000-0000-4000-8000-000000000001');
 perform apply_sale_staff_effects(doc);
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
-- Saldo akun dari seluruh jurnal satu rantai struk (asal + ubah + koreksi), opsional per tanggal.
create function pg_temp.bal(refs text[], code text, on_date date default null) returns numeric language sql security definer as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id
 where a.code=$2 and ($3 is null or e.tanggal=$3) and (
  e.source_ref=any($1)
  or e.source_ref in(select c.id::text from public.sale_cancellations c join public.sales s on s.id=c.sale_id where s.no_struk=any($1))
  or e.source_ref in(select c.id::text from public.sale_payment_corrections c join public.sales s on s.id=c.sale_id where s.no_struk=any($1)))
$$;
create function pg_temp.edit_payload(lines jsonb, subtotal numeric, discount numeric, plan jsonb, earned integer default 0) returns jsonb language sql as $$
 select jsonb_build_object('header',jsonb_build_object('subtotal',subtotal,'discount',discount,'diskon_kategori',0,
  'total',(select sum((x->>'amount')::numeric) from jsonb_array_elements(plan) x),'merchant_fee_total',0,
  'metode_bayar',case when jsonb_array_length(plan)>1 then 'Split' else plan->0->>'method' end,
  'bayar',(select sum((x->>'amount')::numeric) from jsonb_array_elements(plan) x),'kembali',0,'payment_plan',plan,'poin_earned',earned),'lines',lines)
$$;

select pg_temp.sale('UE-A',2,50000,'[{"method":"Tunai","amount":100000}]','ee700000-0000-4000-8000-000000000001',100);
select pg_temp.sale('UE-B',1,50000,'[{"method":"Tunai","amount":50000}]');  -- transaksi kasir sesudahnya (aturan urutan efek staf)
select pg_temp.backdate(pg_temp.sid('UE-A'),4);
select pg_temp.backdate(pg_temp.sid('UE-B'),4);
-- Peta Tunai cabang pindah ke kas toko SESUDAH struk dibuat (kasus 1-6 Nov di produksi).
set local role postgres;
update payment_account_map set cash_account_id='ee500000-0000-4000-8000-000000000003'
 where branch_id='ee200000-0000-4000-8000-000000000001' and metode='Tunai';
-- Shift asal sudah ditutup.
set local session_replication_role=replica;
update cashier_shifts set status='closed',closed_at=now() where id='ee600000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
create temp table ue_d(d date, today date);
insert into ue_d values(((now()-interval '4 days') at time zone 'Asia/Jakarta')::date,(now() at time zone 'Asia/Jakarta')::date);
grant select on ue_d to authenticated;
select pg_temp.ok((select points=100 from customers where id='ee700000-0000-4000-8000-000000000001'),'fixture: customer earned 100 points');
select pg_temp.ok((select qty=97 from stock where item_id='ee400000-0000-4000-8000-000000000002'),'fixture: 3 units sold');

-- ── Penolakan dasar ──
set local role authenticated;
select pg_temp.as_('ee100000-0000-4000-8000-000000000003');
select pg_temp.reject($q$select edit_posted_pos_sale(pg_temp.sid('UE-A'),0,'ue-staff','Kasir coba ubah',pg_temp.edit_payload('[{"item_id":"ee400000-0000-4000-8000-000000000002","nama":"UE barang","qty":2,"harga":50000,"satuan":"pcs","faktor":1}]',100000,0,'[{"method":"Transfer","amount":100000}]',100))$q$,
 'Hanya Owner atau Finance','staff cannot edit');
select pg_temp.as_('ee100000-0000-4000-8000-000000000004');
select pg_temp.reject($q$select edit_posted_pos_sale(pg_temp.sid('UE-A'),0,'ue-admin','Admin coba ubah',pg_temp.edit_payload('[{"item_id":"ee400000-0000-4000-8000-000000000002","nama":"UE barang","qty":2,"harga":50000,"satuan":"pcs","faktor":1}]',100000,0,'[{"method":"Transfer","amount":100000}]',100))$q$,
 'Hanya Owner atau Finance','admin cannot edit');
select pg_temp.reject($q$insert into pos_sale_edit_gate(transaction_id,backend_pid,sale_id) values(txid_current(),pg_backend_pid(),pg_temp.sid('UE-A'))$q$,
 'permission denied','client cannot open the private edit gate');
select pg_temp.reject($q$select pos_sale_edit_void(pg_temp.sid('UE-A'),0,'x','Coba langsung')$q$,'permission denied','internal void variant is not callable');
select pg_temp.as_('ee100000-0000-4000-8000-000000000001');
select pg_temp.reject($q$select edit_posted_pos_sale(pg_temp.sid('UE-A'),0,'ue-floor','Harga salah',pg_temp.edit_payload('[{"item_id":"ee400000-0000-4000-8000-000000000002","nama":"UE barang","qty":2,"harga":1000,"satuan":"pcs","faktor":1}]',2000,0,'[{"method":"Tunai","amount":2000}]',0))$q$,
 'di bawah HPP','price below HPP is still refused');
select pg_temp.reject($q$select edit_posted_pos_sale(pg_temp.sid('UE-A'),0,'ue-sum','Total salah',pg_temp.edit_payload('[{"item_id":"ee400000-0000-4000-8000-000000000002","nama":"UE barang","qty":2,"harga":50000,"satuan":"pcs","faktor":1}]',100000,0,'[{"method":"Tunai","amount":90000}]',0))$q$,
 'tidak valid','header totals must add up');
select pg_temp.ok((select voided_at is null and revision=0 from sales where no_struk='UE-A'),'rejected edits leave the source untouched');

-- ── Ubah oleh Owner: tambah qty + jasa + diskon, split Tunai/Transfer, promo lama terbawa ──
select edit_posted_pos_sale(pg_temp.sid('UE-A'),0,'ue-a1','Salah input jumlah dan jasa',pg_temp.edit_payload(
 '[{"item_id":"ee400000-0000-4000-8000-000000000002","nama":"UE barang","qty":3,"harga":50000,"satuan":"pcs","faktor":1,"promo_id":"ee800000-0000-4000-8000-000000000001","promo_discount":5000},
   {"item_id":"ee400000-0000-4000-8000-000000000001","nama":"UE jasa","qty":1,"harga":20000,"satuan":"pcs","faktor":1}]',
 170000,15000,'[{"method":"Tunai","amount":55000},{"method":"Transfer","amount":100000}]',155));
set local role postgres;
select pg_temp.ok((select voided_at is not null and void_reason='Diubah: Salah input jumlah dan jasa' and revision=1 from sales where no_struk='UE-A'),'old receipt closed with the edit reason');
select pg_temp.ok((select n.created_at=o.created_at+interval '1 millisecond' and n.cashier_id=o.cashier_id and n.shift_id=o.shift_id and n.revision=0
  and n.total=155000 and n.metode_bayar='Split' and n.customer_id=o.customer_id and n.voided_at is null
 from sales n,sales o where n.no_struk='UE-A-U1' and o.no_struk='UE-A'),'replacement keeps date, cashier, closed shift and customer');
select pg_temp.ok((select count(*)=1 from sale_edits e join sales o on o.id=e.old_sale_id join sales n on n.id=e.new_sale_id
 where o.no_struk='UE-A' and n.no_struk='UE-A-U1' and e.reason='Salah input jumlah dan jasa' and e.created_by='ee100000-0000-4000-8000-000000000001'
  and e.before_value->'sale'->>'total'='100000' and e.after_value->'sale'->>'total'='155000'),'edit trail with before/after');
select pg_temp.ok((select promo_id='ee800000-0000-4000-8000-000000000001' and promo_discount=5000 from sale_items i join sales s on s.id=i.sale_id
 where s.no_struk='UE-A-U1' and i.item_id='ee400000-0000-4000-8000-000000000002'),'old promo carried as-is (inactive promo, no re-check)');
-- Tanggal: pendapatan & kas di tanggal struk; stok & HPP hari ini.
select pg_temp.ok((select tanggal=(select d from ue_d) from journal_entries where source='sale' and source_ref='UE-A-U1')
 and (select tanggal=(select today from ue_d) from journal_entries where source='sale-hpp' and source_ref='UE-A-U1'),'new revenue on sale date, new HPP today');
select pg_temp.ok((select bool_and(case when e.source='sale-void-hpp' then e.tanggal=(select today from ue_d) else e.tanggal=(select d from ue_d) end) and count(*)=2
 from journal_entries e join sale_cancellations c on c.id::text=e.source_ref join sales s on s.id=c.sale_id where s.no_struk='UE-A'),'old revenue reversed on sale date, old HPP reversed today');
select pg_temp.ok(pg_temp.bal(array['UE-A','UE-A-U1'],'1191',(select d from ue_d))=55000
 and pg_temp.bal(array['UE-A','UE-A-U1'],'1192',(select d from ue_d))=100000
 and pg_temp.bal(array['UE-A','UE-A-U1'],'1193')=0
 and pg_temp.bal(array['UE-A','UE-A-U1'],'510001',(select d from ue_d))=-170000
 and pg_temp.bal(array['UE-A','UE-A-U1'],'520002',(select d from ue_d))=15000,
 'on the sale date: cash stays on the recorded account (not the new map), bank and revenue reflect the edit');
select pg_temp.ok(pg_temp.bal(array['UE-A','UE-A-U1'],'600001')=9000 and pg_temp.bal(array['UE-A','UE-A-U1'],'600001',(select d from ue_d))=6000
 and pg_temp.bal(array['UE-A','UE-A-U1'],'600001',(select today from ue_d))=3000,'HPP: original 6000 on sale date, +3000 net on edit day');
select pg_temp.ok((select qty=96 from stock where item_id='ee400000-0000-4000-8000-000000000002')
 and (select count(*)=2 from stock_moves where tanggal=(select today from ue_d) and item_id='ee400000-0000-4000-8000-000000000002'),'stock: 2 returned and 3 issued today');
select pg_temp.ok((select points=155 from customers where id='ee700000-0000-4000-8000-000000000001'),'points follow the new receipt');
select pg_temp.ok((select count(*)=1 from sale_staff_effects f join sales n on n.id=f.sale_id where n.no_struk='UE-A-U1' and f.reversed_at is null)
 and not exists(select 1 from sale_staff_effects f join sales o on o.id=f.sale_id where o.no_struk='UE-A'),'staff effects moved, not reversed (later sale UE-B untouched)');
select pg_temp.ok((select status='closed' from cashier_shifts where id='ee600000-0000-4000-8000-000000000001'),'closed shift stays closed');
select pg_temp.ok(not exists(select 1 from pos_sale_edit_gate),'gate rows are removed');

-- Idempotensi.
set local role authenticated;
select pg_temp.ok((select edit_posted_pos_sale(pg_temp.sid('UE-A'),0,'ue-a1','Salah input jumlah dan jasa',pg_temp.edit_payload(
 '[{"item_id":"ee400000-0000-4000-8000-000000000002","nama":"UE barang","qty":3,"harga":50000,"satuan":"pcs","faktor":1,"promo_id":"ee800000-0000-4000-8000-000000000001","promo_discount":5000},
   {"item_id":"ee400000-0000-4000-8000-000000000001","nama":"UE jasa","qty":1,"harga":20000,"satuan":"pcs","faktor":1}]',
 170000,15000,'[{"method":"Tunai","amount":55000},{"method":"Transfer","amount":100000}]',155))->>'no_struk'='UE-A-U1'),'same key retry returns the same result');
select pg_temp.reject($q$select edit_posted_pos_sale(pg_temp.sid('UE-A'),0,'ue-a1','Alasan lain',pg_temp.edit_payload('[{"item_id":"ee400000-0000-4000-8000-000000000002","nama":"UE barang","qty":2,"harga":50000,"satuan":"pcs","faktor":1}]',100000,0,'[{"method":"Tunai","amount":100000}]',0))$q$,
 'sudah dipakai','same key with a different edit is refused');
select pg_temp.reject($q$select edit_posted_pos_sale(pg_temp.sid('UE-A'),1,'ue-a2','Ubah lagi yang lama',pg_temp.edit_payload('[{"item_id":"ee400000-0000-4000-8000-000000000002","nama":"UE barang","qty":2,"harga":50000,"satuan":"pcs","faktor":1}]',100000,0,'[{"method":"Tunai","amount":100000}]',0))$q$,
 'sudah dibatalkan atau sudah diubah','an already edited receipt cannot be edited again');

-- ── Finance mengubah lagi hasil ubah: kembali ke 2 barang, Tunai saja (rekening tercatat 1191 dipakai lagi) ──
select pg_temp.as_('ee100000-0000-4000-8000-000000000002');
select edit_posted_pos_sale(pg_temp.sid('UE-A-U1'),0,'ue-a3','Ternyata 2 barang saja',pg_temp.edit_payload(
 '[{"item_id":"ee400000-0000-4000-8000-000000000002","nama":"UE barang","qty":2,"harga":50000,"satuan":"pcs","faktor":1}]',100000,0,'[{"method":"Tunai","amount":100000}]',100));
set local role postgres;
select pg_temp.ok((select voided_at is null and created_at=(select created_at+interval '2 milliseconds' from sales where no_struk='UE-A') from sales where no_struk='UE-A-U2'),'second edit numbered -U2, still on the original date');
select pg_temp.ok(pg_temp.bal(array['UE-A','UE-A-U1','UE-A-U2'],'1191')=100000 and pg_temp.bal(array['UE-A','UE-A-U1','UE-A-U2'],'1192')=0
 and pg_temp.bal(array['UE-A','UE-A-U1','UE-A-U2'],'1191',(select d from ue_d))=100000 and pg_temp.bal(array['UE-A','UE-A-U1','UE-A-U2'],'510001',(select d from ue_d))=-100000
 and pg_temp.bal(array['UE-A','UE-A-U1','UE-A-U2'],'600001')=6000 and pg_temp.bal(array['UE-A','UE-A-U1','UE-A-U2'],'170001')=-6000,
 'chain of two edits nets back to the original books');
select pg_temp.ok((select qty=97 from stock where item_id='ee400000-0000-4000-8000-000000000002') and (select points=100 from customers where id='ee700000-0000-4000-8000-000000000001'),'stock and points back to original');

-- ── Struk yang pernah dikoreksi metode bayarnya ──
set local session_replication_role=replica;
update cashier_shifts set status='open',closed_at=null where id='ee600000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
update payment_account_map set cash_account_id='ee500000-0000-4000-8000-000000000001' where branch_id='ee200000-0000-4000-8000-000000000001' and metode='Tunai';
set local role authenticated;
select pg_temp.sale('UE-C',1,50000,'[{"method":"Tunai","amount":50000}]');
set local role postgres;
select pg_temp.backdate(pg_temp.sid('UE-C'),2);
set local role authenticated;
select pg_temp.as_('ee100000-0000-4000-8000-000000000001');
select correct_pos_sale_payment(pg_temp.sid('UE-C'),0,'ue-c-corr','Salah pilih metode',0,50000);
select edit_posted_pos_sale(pg_temp.sid('UE-C'),1,'ue-c1','Tambah satu barang',pg_temp.edit_payload(
 '[{"item_id":"ee400000-0000-4000-8000-000000000002","nama":"UE barang","qty":2,"harga":50000,"satuan":"pcs","faktor":1}]',100000,0,'[{"method":"Transfer","amount":100000}]',0));
set local role postgres;
select pg_temp.ok(pg_temp.bal(array['UE-C','UE-C-U1'],'1191')=0 and pg_temp.bal(array['UE-C','UE-C-U1'],'1192')=100000
 and pg_temp.bal(array['UE-C','UE-C-U1'],'510001')=-100000
 and pg_temp.bal(array['UE-C','UE-C-U1'],'1192',((now()-interval '2 days') at time zone 'Asia/Jakarta')::date)=100000,
 'corrected receipt: correction chain reversed too, books equal the new receipt on its date');

-- ── Pembatalan resmi struk hasil ubah tetap bisa (jurnal HPP hari ubah diterima) ──
set local role authenticated;
select cancel_posted_sale(pg_temp.sid('UE-C-U1'),0,'ue-c-cancel','Batal beneran');
set local role postgres;
select pg_temp.ok((select voided_at is not null from sales where no_struk='UE-C-U1') and pg_temp.bal(array['UE-C','UE-C-U1'],'510001')=0,'edited receipt can still be cancelled');

-- ── Penolakan periode & rekonsiliasi ──
insert into bank_reconciliations(tanggal,cash_account_id,bank_coa_code) values((select d from ue_d),'ee500000-0000-4000-8000-000000000001','1191');
set local role authenticated;
select pg_temp.reject($q$select edit_posted_pos_sale(pg_temp.sid('UE-B'),0,'ue-b-rec','Coba ubah',pg_temp.edit_payload('[{"item_id":"ee400000-0000-4000-8000-000000000002","nama":"UE barang","qty":1,"harga":60000,"satuan":"pcs","faktor":1}]',60000,0,'[{"method":"Tunai","amount":60000}]',0))$q$,
 'Rekonsiliasi bank','bank reconciliation on the receipt account blocks');
set local role postgres;
delete from bank_reconciliations where cash_account_id='ee500000-0000-4000-8000-000000000001';
update accounting_locks set closed_until=(select d from ue_d) where id;
set local role authenticated;
select pg_temp.reject($q$select edit_posted_pos_sale(pg_temp.sid('UE-B'),0,'ue-b-closed','Coba ubah',pg_temp.edit_payload('[{"item_id":"ee400000-0000-4000-8000-000000000002","nama":"UE barang","qty":1,"harga":60000,"satuan":"pcs","faktor":1}]',60000,0,'[{"method":"Tunai","amount":60000}]',0))$q$,
 'ditutup buku','closed period on the receipt date blocks');
select pg_temp.ok((select voided_at is null from sales where no_struk='UE-B'),'refusals leave UE-B untouched');
rollback;
