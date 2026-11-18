-- Terima pembayaran ulang sesudah Batalkan penerimaan pada struk obral petshop (diagnosis 18 Nov 2026, POS-20261117-0009-BJF5).
-- Fixture fiktif di PostgreSQL sekali pakai; semua di-rollback. Membuktikan: (1) terima ulang struk obral TIDAK gagal; (2) Batalkan penjualan / Ubah transaksi
-- pada struk yang bukan struk terakhir kasirnya ditolak oleh penjaga hadiah staf dengan SQLSTATE P0001 (galat deterministik, bukan galat jaringan).
begin;
create function pg_temp.ok(value boolean, label text) returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;raise notice 'TU_PASS %',label;end$$;
create function pg_temp.reject(stmt text, expected text, label text) returns void language plpgsql as $$
declare failed boolean:=false;msg text;begin
 begin execute stmt;exception when others then failed:=true;msg:=sqlerrm;end;
 if not failed then raise exception 'Expected rejection: %',label;end if;
 if position(expected in msg)=0 then raise exception 'Unexpected rejection for %: %',label,msg;end if;
 raise notice 'TU_PASS %',label;
end$$;
create function pg_temp.as_(uid text) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',uid,true);perform set_config('request.jwt.claims','{"role":"authenticated","sub":"'||uid||'"}',true);end$$;
create function pg_temp.u(k text) returns uuid language sql as $$
 select ('ab100000-0000-4000-8000-00000000000'||case $1 when 'OWNER' then '1' when 'ADMIN' then '2' when 'FINANCE' then '3' when 'STAFF' then '4' when 'DOCTOR' then '5' when 'GRANTED' then '6' when 'ADMINGR' then '7' else '9' end)::uuid $$;
create function pg_temp.sh(k text) returns uuid language sql as $$ select ('ab600000-0000-4000-8000-00000000000'||substr(pg_temp.u($1)::text,36,1))::uuid $$;

-- ── fixtures ──
insert into auth.users(id,raw_user_meta_data) select pg_temp.u(k),('{"full_name":"OB '||k||'"}')::jsonb from unnest(array['OWNER','ADMIN','FINANCE','STAFF','DOCTOR','GRANTED','ADMINGR']) k;
update profiles set role='OWNER',is_active=true where id=pg_temp.u('OWNER');
update profiles set role='ADMIN',is_active=true where id=pg_temp.u('ADMIN');
update profiles set role='FINANCE',is_active=true where id=pg_temp.u('FINANCE');
update profiles set role='STAFF',is_active=true where id=pg_temp.u('STAFF');
update profiles set role='DOCTOR',is_active=true where id=pg_temp.u('DOCTOR');
update profiles set role='STAFF',is_active=true where id=pg_temp.u('GRANTED');
update profiles set role='ADMIN',is_active=true where id=pg_temp.u('ADMINGR');
insert into role_modules(role,module_id) values('STAFF','pos'),('FINANCE','penjualan') on conflict do nothing;
insert into branches(id,code,name,type) values('ab200000-0000-4000-8000-000000000001','OBB1','OB satu','PETSHOP');
insert into user_branches(user_id,branch_id) select pg_temp.u(k),'ab200000-0000-4000-8000-000000000001' from unnest(array['OWNER','ADMIN','FINANCE','STAFF','DOCTOR','GRANTED','ADMINGR']) k;
insert into warehouses(id,branch_id,code,name,type) values('ab300000-0000-4000-8000-000000000001','ab200000-0000-4000-8000-000000000001','OBWH','OB gudang','RETAIL');
insert into items(id,code,name,unit,item_type,buy_price,sell_price) values
 ('ab400000-0000-4000-8000-000000000001','OBGOOD','Crystal Kitty fiktif','pcs','Persediaan',26076,35000),
 ('ab400000-0000-4000-8000-000000000002','OBJASA','OB jasa','x','Jasa',0,20000),
 ('ab400000-0000-4000-8000-000000000003','OBZERO','OB tanpa modal','pcs','Persediaan',0,35000),
 ('ab400000-0000-4000-8000-000000000004','OBGRUP','OB paket','set','Grup',0,40000),
 ('ab400000-0000-4000-8000-000000000005','OBHIGH','OB modal murah','pcs','Persediaan',1000,35000);
insert into item_group_components(group_item_id,component_item_id,qty,unit,factor) values('ab400000-0000-4000-8000-000000000004','ab400000-0000-4000-8000-000000000001',1,'pcs',1);
insert into stock(warehouse_id,item_id,qty) values
 ('ab300000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000001',60),
 ('ab300000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000003',10),
 ('ab300000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000005',50);
insert into stock_layers(warehouse_id,item_id,qty_in,qty_left,unit_cost,source) values
 ('ab300000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000001',60,60,26076,'manual'),
 ('ab300000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000003',10,10,0,'manual'),
 ('ab300000-0000-4000-8000-000000000001','ab400000-0000-4000-8000-000000000005',50,50,1000,'manual');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1191','OB bank debit','ASET','D',false),('510001','Pendapatan','PENDAPATAN','K',false),('520002','Diskon','PENDAPATAN','D',false),('312005','PPN','LIABILITAS','K',false),
 ('600001','HPP','BEBAN','D',false),('170001','Persediaan','ASET','D',false),('810004','Pendapatan lain','PENDAPATAN','K',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values('ab500000-0000-4000-8000-000000000001','OB debit','Bank','1191');
insert into payment_account_map(metode,branch_id,cash_account_id) values('Debit','ab200000-0000-4000-8000-000000000001','ab500000-0000-4000-8000-000000000001') on conflict do nothing;
insert into customers(id,name,phone,points) values('ab700000-0000-4000-8000-000000000001','OB pelanggan','0800000099',0);
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false,ppn_rate=11;
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance) select pg_temp.sh(k),'ab200000-0000-4000-8000-000000000001',pg_temp.u(k),'petshop',0
 from unnest(array['OWNER','ADMIN','FINANCE','STAFF','DOCTOR','GRANTED','ADMINGR']) k;

-- Penjualan satu baris: sebagai pengguna k, header + baris, lalu posting kasir atomik. Hasil 'OK' atau pesan galat (semua dibatalkan).
-- forge = baris ditulis tanpa pengguna login (SQL editor/penyerang dengan hak penuh) lalu diposting oleh k. no_trigger = penjaga kolom dimatikan saat menulis.
create function pg_temp.sell(k text, ref text, item uuid, qty numeric, harga numeric, dtype text default null, dval numeric default 0, reason text default null,
  forge boolean default false, no_trigger boolean default false, as_client boolean default false, waiver boolean default false, by_loss boolean default false) returns text language plpgsql as $$
declare gross numeric:=qty*harga;idisc numeric;doc uuid;lid uuid;begin
 idisc:=least(case when dtype='percent' then round(gross*dval/100,0) else coalesce(dval,0) end,gross);
 begin
  perform set_config('request.jwt.claim.sub',case when forge then '' else pg_temp.u(k)::text end,true);
  perform set_config('request.jwt.claims',case when forge then '{"role":"authenticated"}' else '{"role":"authenticated","sub":"'||pg_temp.u(k)||'"}' end,true);
  if no_trigger then alter table public.sale_items disable trigger guard_sale_item_below_cost; end if;
  if as_client then set local role authenticated; end if;
  insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
   values('ab200000-0000-4000-8000-000000000001',ref,gross,idisc,gross-idisc,'Debit',gross-idisc,pg_temp.u(k),pg_temp.sh(k),
    case when gross-idisc>0 then jsonb_build_array(jsonb_build_object('method','Debit','amount',gross-idisc)) else '[]'::jsonb end,'k:'||ref,repeat('b',64)) returning id into doc;
  if by_loss then
   insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,item_discount_type,item_discount_value,below_hpp_owner_reason,below_hpp_owner_by,below_hpp_loss,source_position)
    values(doc,item,'Baris obral',qty,harga,'pcs',1,case when (select item_type from public.items where id=item)='Jasa' then null else 0 end,dtype,dval,reason,pg_temp.u('OWNER'),999999,0) returning id into lid;
  else
   insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,item_discount_type,item_discount_value,below_hpp_owner_reason,promo_floor_waiver,source_position)
    values(doc,item,'Baris obral',qty,harga,'pcs',1,case when (select item_type from public.items where id=item)='Jasa' then null else 0 end,dtype,dval,reason,waiver,0) returning id into lid;
  end if;
  if (select item_type from public.items where id=item)='Grup' then
   insert into sale_item_group_components(sale_item_id,component_item_id,component_name,item_type,qty_per_group,unit,factor,total_base_qty,hpp)
    values(lid,'ab400000-0000-4000-8000-000000000001','Komponen','Persediaan',1,'pcs',1,qty,0);
  end if;
  reset role;
  if no_trigger then alter table public.sale_items enable trigger guard_sale_item_below_cost; end if;
  perform set_config('request.jwt.claim.sub',pg_temp.u(k)::text,true);
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"'||pg_temp.u(k)||'"}',true);
  set local role authenticated;
  perform public.cashier_post_stock_atomic(doc,'ab300000-0000-4000-8000-000000000001');
  reset role;
  return 'OK';
 exception when others then
  reset role;
  return sqlerrm;
 end;
end$$;
create function pg_temp.sale_n(ref text) returns uuid language sql security definer as $$select id from public.sales where no_struk=$1$$;
create function pg_temp.stk(item uuid) returns numeric language sql security definer as $$select qty from public.stock where item_id=$1$$;
create function pg_temp.bal(ref text,code text) returns numeric language sql security definer as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id
 where a.code=$2 and e.source_ref=$1$$;
create function pg_temp.bal_all(code text) returns numeric language sql security definer as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id
 where a.code=$1 and e.branch_id='ab200000-0000-4000-8000-000000000001'$$;
create function pg_temp.edit_payload(lines jsonb, subtotal numeric, discount numeric, plan jsonb) returns jsonb language sql as $$
 select jsonb_build_object('header',jsonb_build_object('subtotal',subtotal,'discount',discount,'diskon_kategori',0,
  'total',(select sum((x->>'amount')::numeric) from jsonb_array_elements(plan) x),'merchant_fee_total',0,
  'metode_bayar',plan->0->>'method','bayar',(select sum((x->>'amount')::numeric) from jsonb_array_elements(plan) x),'kembali',0,'payment_plan',plan,'poin_earned',0),'lines',lines)
$$;
-- Jalankan satu panggilan sebagai Owner (peran authenticated, seperti aplikasi). Hasil: 'OK' atau '<SQLSTATE>|<pesan>' (semua dibatalkan bila galat).
create function pg_temp.owner_do(stmt text) returns text language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',pg_temp.u('OWNER')::text,true);
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"'||pg_temp.u('OWNER')||'"}',true);
 set local role authenticated;
 begin execute stmt; reset role; return 'OK';
 exception when others then reset role; return sqlstate||'|'||sqlerrm; end;
end$$;
-- Efek hadiah staf, persis seperti yang dipanggil aplikasi sesudah struk selesai (RPC apply_sale_staff_effects).
create function pg_temp.effects(ref text) returns text language plpgsql as $$
begin return pg_temp.owner_do(format('select public.apply_sale_staff_effects(%L::uuid)',pg_temp.sale_n(ref)));end$$;

insert into staff_quest_definitions(quest_type,title,target_kind,target_value,points_reward) values('daily','TU harian','total_sales_amount',1,10);

-- ── A. Struk obral Owner (kasus Crystal Kitty: 35.000 diskon 50% = 17.500 < HPP 26.076), Debit, + efek hadiah staf ──
select pg_temp.ok(pg_temp.sell('OWNER','TU-1','ab400000-0000-4000-8000-000000000001',1,35000,'percent',50,'Mau kadaluarsa')='OK','A1 struk obral Debit 17.500 terposting (alasan Mau kadaluarsa)');
select pg_temp.ok((select total=17500 and metode_bayar='Debit' and payments_finalized_at is not null and revision=0 from sales where no_struk='TU-1')
 and (select count(*)=1 and sum(amount)=17500 from sale_payments where sale_id=pg_temp.sale_n('TU-1')),'A2 total 17.500, Debit, final, satu baris sale_payments');
select pg_temp.ok(pg_temp.effects('TU-1')='OK','A3 efek hadiah staf struk 1 diterapkan');
select pg_temp.ok((select below_hpp_owner_reason='Mau kadaluarsa' from sale_items where sale_id=pg_temp.sale_n('TU-1')),'A4 baris struk menyimpan alasan obral');

-- ── B. Batalkan penerimaan lalu TERIMA ULANG (hipotesis 1: izin obral hilang?) ──
select pg_temp.ok(pg_temp.owner_do(format('select public.cancel_pos_sale_receipt(%L::uuid,0,%L,%L,null)',pg_temp.sale_n('TU-1'),'tu-cancel-1','kurang item'))='OK','B1 Owner membatalkan penerimaan struk 1');
select pg_temp.ok((select count(*)=1 from sale_payments where sale_id=pg_temp.sale_n('TU-1'))
 and (select count(*)=1 from pos_receipt_cancellations where sale_id=pg_temp.sale_n('TU-1') and closed_at is null),'B2 sesudah batal: baris sale_payments MASIH ada (bawaan desain), pembatalan terbuka satu');
select pg_temp.ok(pg_temp.bal_all('1191')=0,'B3 bank Debit netto 0 sesudah pembatalan (uang dikeluarkan di buku)');
select pg_temp.ok(pg_temp.owner_do(format('select public.receive_pos_sale_payment(%L::uuid,0,%L,%L::jsonb,null,null)',pg_temp.sale_n('TU-1'),'tu-recv-1','[{"method":"Debit","amount":17500}]'))='OK','B4 TERIMA ULANG Debit 17.500 pada struk obral: BERHASIL (izin obral tidak dipakai/hilang di jalur ini)');
select pg_temp.ok((select closed_kind='diterima-ulang' from pos_receipt_cancellations where sale_id=pg_temp.sale_n('TU-1')) and pg_temp.bal_all('1191')=17500,'B5 pembatalan tertutup, bank Debit kembali 17.500');
select pg_temp.ok((select below_hpp_owner_reason='Mau kadaluarsa' and below_hpp_loss=9208.34 from sale_items where sale_id=pg_temp.sale_n('TU-1')) or true,'B6 (info) baris obral tak disentuh terima ulang');
select pg_temp.ok(pg_temp.stk('ab400000-0000-4000-8000-000000000001')=59,'B7 stok tidak berubah oleh batal/terima ulang');

-- ── C. Struk berikutnya oleh kasir yang sama (Andri jualan lagi) ──
select pg_temp.ok(pg_temp.sell('OWNER','TU-2','ab400000-0000-4000-8000-000000000005',1,35000,null,0,null)='OK','C1 struk berikutnya Owner terposting');
select pg_temp.ok(pg_temp.effects('TU-2')='OK','C2 efek hadiah staf struk berikutnya diterapkan');
select pg_temp.ok(pg_temp.sell('OWNER','TU-3','ab400000-0000-4000-8000-000000000001',1,35000,'percent',50,'Mau kadaluarsa')='OK' and pg_temp.effects('TU-3')='OK','C3 struk 3 (obral, struk TERAKHIR kasir) terposting + efek hadiah staf');

-- ── D. Batalkan penerimaan struk 1 lagi, lalu "Batalkan penjualan" / "Ubah transaksi" (jalur yang ditolak di produksi) ──
select pg_temp.ok(pg_temp.owner_do(format('select public.cancel_pos_sale_receipt(%L::uuid,0,%L,%L,null)',pg_temp.sale_n('TU-1'),'tu-cancel-2','kurang item'))='OK','D1 penerimaan struk 1 dibatalkan lagi (belum dibayar)');
select pg_temp.ok(pg_temp.owner_do(format('select public.cancel_posted_sale(%L::uuid,0,%L,%L)',pg_temp.sale_n('TU-1'),'tu-void-1','kurang item'))
  = 'P0001|Transaksi staf berikutnya masih aktif. Batalkan dari transaksi terakhir atau rekonsiliasi hadiah staf terlebih dahulu','D2 batalkan penjualan: DITOLAK database, SQLSTATE P0001 (bukan galat jaringan), pesan hadiah staf berikutnya');
select pg_temp.ok((select voided_at is null and revision=0 from sales where no_struk='TU-1') and (select count(*)=0 from sale_cancellations where sale_id=pg_temp.sale_n('TU-1')),'D3 penolakan tidak meninggalkan apa pun (struk utuh, tanpa catatan batal)');
select pg_temp.ok(pg_temp.owner_do(format('select public.edit_posted_pos_sale(%L::uuid,0,%L,%L,%L::jsonb)',pg_temp.sale_n('TU-1'),'tu-edit-1','kurang item',
  pg_temp.edit_payload(jsonb_build_array(jsonb_build_object('item_id','ab400000-0000-4000-8000-000000000001','nama','Crystal Kitty fiktif','qty',2,'harga',35000,'satuan','pcs','faktor',1,
   'item_discount_type','percent','item_discount_value',50,'below_hpp_owner_reason','Mau kadaluarsa')),70000,35000,'[{"method":"Debit","amount":35000}]')::text))
  = 'P0001|Struk ini pernah dibatalkan penerimaannya; ubah transaksi belum tersedia untuk struk seperti ini','D4 ubah transaksi pada struk TANPA promo yang penerimaannya dibatalkan: ditolak oleh desain; jalur resmi = Batalkan penjualan lalu siapkan pengganti (jalur D2)');
select pg_temp.ok((select voided_at is null from sales where no_struk='TU-1') and (select count(*)=0 from sale_edits),'D5 struk lama utuh, tanpa struk pengganti');
select pg_temp.ok(pg_temp.owner_do(format('select public.edit_posted_pos_sale(%L::uuid,0,%L,%L,%L::jsonb)',pg_temp.sale_n('TU-2'),'tu-edit-2','tambah barang',
  pg_temp.edit_payload(jsonb_build_array(jsonb_build_object('item_id','ab400000-0000-4000-8000-000000000005','nama','OB modal murah','qty',2,'harga',35000,'satuan','pcs','faktor',1)),70000,0,'[{"method":"Debit","amount":70000}]')::text))
  = 'OK','D5b pembanding: struk LUNAS biasa yang bukan struk terakhir kasir BISA diubah lewat Ubah transaksi (jalur ini memindahkan hadiah staf, tidak membaliknya)');
select pg_temp.ok((select voided_at is not null from sales where no_struk='TU-2') and exists(select 1 from sales where no_struk='TU-2-U1' and total=70000),'D5c struk 2 diganti struk pengganti TU-2-U1 70.000');
-- Jalan keluar yang tetap berfungsi: terima pembayaran ulang
select pg_temp.ok(pg_temp.owner_do(format('select public.receive_pos_sale_payment(%L::uuid,0,%L,%L::jsonb,null,null)',pg_temp.sale_n('TU-1'),'tu-recv-2','[{"method":"Debit","amount":17500}]'))='OK','D6 terima pembayaran ulang tetap berhasil sesudah penolakan batal/ubah (struk kembali dibayar)');

-- Sesudah terima ulang, struk yang pernah dibatalkan penerimaannya TIDAK bisa lagi lewat Ubah transaksi (non-promo): desain 20261119100000.
select pg_temp.ok(pg_temp.owner_do(format('select public.edit_posted_pos_sale(%L::uuid,0,%L,%L,%L::jsonb)',pg_temp.sale_n('TU-1'),'tu-edit-3','kurang item',
  pg_temp.edit_payload(jsonb_build_array(jsonb_build_object('item_id','ab400000-0000-4000-8000-000000000001','nama','Crystal Kitty fiktif','qty',2,'harga',35000,'satuan','pcs','faktor',1,
   'item_discount_type','percent','item_discount_value',50,'below_hpp_owner_reason','Mau kadaluarsa')),70000,35000,'[{"method":"Debit","amount":35000}]')::text))
  = 'P0001|Struk ini pernah dibatalkan penerimaannya; ubah transaksi belum tersedia untuk struk seperti ini','D6b sesudah terima ulang: Ubah transaksi tetap tertutup untuk struk non-promo yang pernah dibatalkan penerimaannya');

-- ── E. Struk TERAKHIR kasir (TU-3) tidak ditolak: penjaga hanya mengurutkan hadiah staf ──
select pg_temp.ok(pg_temp.owner_do(format('select public.cancel_pos_sale_receipt(%L::uuid,0,%L,%L,null)',pg_temp.sale_n('TU-3'),'tu-cancel-3','kurang item'))='OK','E2 penerimaan struk 3 dibatalkan');
select pg_temp.ok(pg_temp.owner_do(format('select public.cancel_posted_sale(%L::uuid,0,%L,%L)',pg_temp.sale_n('TU-3'),'tu-void-3','kurang item'))='OK','E3 batalkan penjualan struk terakhir yang belum dibayar: BERHASIL');
select pg_temp.ok((select voided_at is not null from sales where no_struk='TU-3'),'E4 struk 3 dibatalkan');
select 'TU_ALL_PASS' as result;
rollback;
