-- P02 koreksi harga faktur pembelian setelah barang terjual. Fiksi lokal, selalu di-rollback.
-- Runner mengganti __MODE__ dengan 'fifo' atau 'average'.
begin;
insert into auth.users(id) values('f2000000-0000-4000-8000-000000000001'),('f2000000-0000-4000-8000-000000000002'),('f2000000-0000-4000-8000-000000000003');
update profiles set role='OWNER' where id='f2000000-0000-4000-8000-000000000001';
update profiles set role='ADMIN' where id='f2000000-0000-4000-8000-000000000002';
update profiles set role='FINANCE' where id='f2000000-0000-4000-8000-000000000003';
insert into branches(id,code,name,type) values('f2100000-0000-4000-8000-000000000001','P02-FIC','P02 fiction','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('f2200000-0000-4000-8000-000000000001','f2100000-0000-4000-8000-000000000001','P02-WH','P02 warehouse','VET');
insert into suppliers(id,nama) values('f2300000-0000-4000-8000-000000000001','P02 supplier');
insert into items(id,code,name,unit,item_type) values
 ('f2400000-0000-4000-8000-000000000001','P02-PCS','Meeting goods','pcs','Persediaan'),
 ('f2400000-0000-4000-8000-000000000002','P02-BOX','PO goods','pcs','Persediaan'),
 ('f2400000-0000-4000-8000-000000000003','P02-TRF','Transferred goods','pcs','Persediaan'),
 ('f2400000-0000-4000-8000-000000000004','P02-VOID','Voided sale goods','pcs','Persediaan'),
 ('f2400000-0000-4000-8000-000000000005','P02-ZERO','Average zero goods','pcs','Persediaan');
insert into item_units(item_id,unit,factor) values('f2400000-0000-4000-8000-000000000002','box',10);
insert into purchase_orders(id,no_po,supplier_id,branch_id,to_warehouse_id,status) values('f2500000-0000-4000-8000-000000000001','PO.P02.FIC','f2300000-0000-4000-8000-000000000001','f2100000-0000-4000-8000-000000000001','f2200000-0000-4000-8000-000000000001','Dipesan');
insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor) values('f2600000-0000-4000-8000-000000000001','f2500000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000002','PO goods',4,111,'box',10);
insert into coa_accounts(code,name,type,normal_balance) values('170001','Fiction stock','ASET','D'),('311001','Fiction AP','LIABILITAS','K'),('182004','Fiction VAT','ASET','D'),('600001','Fiction HPP','BEBAN','D'),('110219','Fiction bank','ASET','D') on conflict(code) do update set is_active=true,is_header=false;
update coa_accounts set is_active=true,is_header=false where code in('170001','160001','311003','110003','120002','311001','182004','600001');
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false,ppn_rate=11;
insert into cash_accounts(id,nama,jenis,coa_code,branch_id) values('f2700000-0000-4000-8000-000000000001','P02 bank','Bank','110219','f2100000-0000-4000-8000-000000000001');
create function pg_temp.expect_error(command text,fragment text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if position(fragment in sqlerrm)=0 then raise exception 'Wrong error: % wanted %',sqlerrm,fragment;end if;return;end;
 raise exception 'Expected rejection: %',fragment;
end$$;
create function pg_temp.ok(c boolean,m text) returns void language plpgsql as $$begin if c is distinct from true then raise exception 'Assertion failed: %',m;end if;end$$;
create function pg_temp.as_user(u text) returns void language sql as $$select set_config('request.jwt.claim.sub',u,true)$$;
create function pg_temp.stock_value(item uuid) returns numeric language sql as $$
 select case when (select method from inventory_costing_settings where id)='moving_average'
  then (select qty*coalesce(average_cost,0) from stock where item_id=item)
  else (select coalesce(sum(qty_left*unit_cost),0) from stock_layers where item_id=item) end
$$;
create function pg_temp.lines(ref text,src text) returns jsonb language sql as $$
 select jsonb_object_agg(code,amount) from (select a.code,sum(l.debit-l.credit) amount from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id
 where e.source=src and e.source_ref=ref group by a.code) x
$$;
create function pg_temp.expected(p jsonb) returns jsonb language sql as $$
 select jsonb_build_object('remaining_qty',p->'remaining_qty','sold_qty',p->'sold_qty','removed_qty',p->'removed_qty','ap_delta',p->'ap_delta','ppn_delta',p->'ppn_delta','inventory_delta',p->'inventory_delta','hpp_delta',p->'hpp_delta')
$$;
create table p02_ids(name text primary key,id uuid);
grant all on p02_ids to authenticated;
create function pg_temp.direct(key text,item uuid,qty numeric,price numeric) returns jsonb language sql as $$
 select create_direct_purchase_invoice(key,jsonb_build_object('supplier_id','f2300000-0000-4000-8000-000000000001','warehouse_id','f2200000-0000-4000-8000-000000000001','tanggal',current_date,'jatuh_tempo',current_date+30,'no_faktur_pemasok','SUP-P02','surat_jalan',null,'keterangan','P02','lampiran','[]'::jsonb,
  'items',jsonb_build_array(jsonb_build_object('item_id',item,'qty',qty,'harga',price,'satuan','pcs','exp_date',null))))
$$;
grant execute on all functions in schema pg_temp to authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f2000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$begin if '__MODE__'='average' then perform activate_moving_average(); end if; end$$;
select pg_temp.ok((select method from inventory_costing_settings where id)=case when '__MODE__'='average' then 'moving_average' else 'fifo' end,'costing mode');

-- ===== Kasus rapat: beli 100 pcs @1.000, jual 70, harga ternyata 1.200 =====
do $$declare inv jsonb;line uuid;pv jsonb;res jsonb;retry jsonb;jcount int;rev int;begin
 inv:=create_direct_purchase_invoice('p02-direct',jsonb_build_object('supplier_id','f2300000-0000-4000-8000-000000000001','warehouse_id','f2200000-0000-4000-8000-000000000001','tanggal',current_date,'jatuh_tempo',current_date+30,'no_faktur_pemasok','SUP-P02','surat_jalan',null,'keterangan','P02','lampiran','[]'::jsonb,
  'items',jsonb_build_array(jsonb_build_object('item_id','f2400000-0000-4000-8000-000000000001','qty',100,'harga',1000,'satuan','pcs','exp_date',null))));
 select id into line from purchase_invoice_items where invoice_id=(inv->>'invoice_id')::uuid;
 perform stock_out_fifo('f2200000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000001',70,'test-consume','P02.SALE',current_date);
 perform pg_temp.ok(pg_temp.stock_value('f2400000-0000-4000-8000-000000000001')=30000,'stock value before');

 -- Non-owner ditolak (pratinjau dan simpan).
 perform pg_temp.as_user('f2000000-0000-4000-8000-000000000002');
 perform pg_temp.expect_error(format('select preview_purchase_invoice_line_correction(%L,100,1200,current_date)',line),'hanya oleh OWNER');
 perform pg_temp.expect_error(format('select correct_purchase_invoice_line(''p02-admin-key'',%L,0,100,1200,current_date,''Harga salah'',''{}'')',line),'hanya oleh OWNER');
 perform pg_temp.as_user('f2000000-0000-4000-8000-000000000001');

 -- Pratinjau: angka dampak benar dan tidak meninggalkan jejak.
 select count(*) into jcount from journal_entries;
 pv:=preview_purchase_invoice_line_correction(line,100,1200,current_date);
 perform pg_temp.ok((pv->>'remaining_qty')::numeric=30 and (pv->>'sold_qty')::numeric=70,'preview qty split '||pv::text);
 perform pg_temp.ok((pv->>'inventory_delta')::numeric=6000 and (pv->>'hpp_delta')::numeric=14000 and (pv->>'ap_delta')::numeric=20000 and (pv->>'ppn_delta')::numeric=0,'preview values '||pv::text);
 perform pg_temp.ok(jsonb_array_length(pv->'lines')=3,'preview journal lines');
 perform pg_temp.ok((select sum((x->>'debit')::numeric)=sum((x->>'credit')::numeric) from jsonb_array_elements(pv->'lines') x),'preview balanced');
 perform pg_temp.ok((select count(*) from journal_entries)=jcount and not exists(select 1 from purchase_invoice_corrections)
  and (select total from purchase_invoices where id=(inv->>'invoice_id')::uuid)=100000 and pg_temp.stock_value('f2400000-0000-4000-8000-000000000001')=30000,'preview left no trace');

 -- Simpan dengan pratinjau basi ditolak; tanpa pratinjau ditolak.
 perform pg_temp.expect_error(format('select correct_purchase_invoice_line(''p02-stale-key'',%L,0,100,1200,current_date,''Harga salah'',%L)',line,(pg_temp.expected(pv)||'{"hpp_delta":1}')::text),'berubah sejak pratinjau');
 perform pg_temp.expect_error(format('select correct_purchase_invoice_line(''p02-nopv-key'',%L,0,100,1200,current_date,''Harga salah'',null)',line),'pratinjau');
 perform pg_temp.expect_error(format('select correct_purchase_invoice_line(''p02-rev-key'',%L,7,100,1200,current_date,''Harga salah'',%L)',line,pg_temp.expected(pv)::text),'berubah sejak pratinjau');

 res:=correct_purchase_invoice_line('p02-commit-key',line,0,100,1200,current_date,'Harga pemasok naik',pg_temp.expected(pv));
 perform pg_temp.ok((res->>'inventory_delta')::numeric=6000 and (res->>'hpp_delta')::numeric=14000,'commit values');
 perform pg_temp.ok(pg_temp.lines(inv->>'no_faktur','purchase-inv-correction')='{"170001":6000,"600001":14000,"311001":-20000}'::jsonb,'journal '||pg_temp.lines(inv->>'no_faktur','purchase-inv-correction')::text);
 perform pg_temp.ok(pg_temp.stock_value('f2400000-0000-4000-8000-000000000001')=36000,'stock value 30 x 1200');
 perform pg_temp.ok((select qty from stock where item_id='f2400000-0000-4000-8000-000000000001')=30,'qty unchanged');
 select revision into rev from purchase_invoices where id=(inv->>'invoice_id')::uuid;
 perform pg_temp.ok((select total from purchase_invoices where id=(inv->>'invoice_id')::uuid)=120000 and rev=1,'AP total updated');
 perform pg_temp.ok((select harga from purchase_invoice_items where id=line)=1200,'line price updated');
 perform pg_temp.ok(exists(select 1 from purchase_invoice_corrections where invoice_item_id=line and old_harga=1000 and new_harga=1200 and reason='Harga pemasok naik' and remaining_qty=30 and sold_qty=70),'history kept');
 retry:=correct_purchase_invoice_line('p02-commit-key',line,0,100,1200,current_date,'Harga pemasok naik',pg_temp.expected(pv));
 perform pg_temp.ok(retry=res and (select count(*) from purchase_invoice_corrections)=1,'idempotent retry');
 perform pg_temp.expect_error(format('select correct_purchase_invoice_line(''p02-commit-key'',%L,0,100,1300,current_date,''Harga pemasok naik'',%L)',line,pg_temp.expected(pv)::text),'rincian berbeda');
 perform pg_temp.expect_error(format('update journal_entries set deskripsi=''x'' where id=%L',res->>'journal_id'),'dilindungi');
 perform pg_temp.expect_error('insert into purchase_invoice_corrections(invoice_id) values(null)','permission denied');

 -- Batal/hapus faktur tetap ditolak karena barang sudah terpakai.
 perform pg_temp.expect_error(format('select cancel_purchase_invoice(%L,1,''p02-cancel'',''Coba batal'')',inv->>'invoice_id'),'Rekonsiliasi');

 -- Qty: naik ditolak; turun melebihi sisa stok ditolak; turun 10 (sisa 30) boleh.
 perform pg_temp.expect_error(format('select preview_purchase_invoice_line_correction(%L,101,1200,current_date)',line),'hanya bisa dikurangi');
 perform pg_temp.expect_error(format('select preview_purchase_invoice_line_correction(%L,50,1200,current_date)',line),'sisa stok faktur');
 perform pg_temp.expect_error(format('select preview_purchase_invoice_line_correction(%L,100,1200,current_date)',line),'Tidak ada perubahan');
 pv:=preview_purchase_invoice_line_correction(line,90,1200,current_date);
 perform pg_temp.ok((pv->>'removed_qty')::numeric=10 and (pv->>'ap_delta')::numeric=-12000 and (pv->>'inventory_delta')::numeric=-12000 and (pv->>'hpp_delta')::numeric=0,'qty preview '||pv::text);
 res:=correct_purchase_invoice_line('p02-qty-key',line,1,90,1200,current_date,'Barang kurang kirim',pg_temp.expected(pv));
 perform pg_temp.ok((select qty from stock where item_id='f2400000-0000-4000-8000-000000000001')=20 and pg_temp.stock_value('f2400000-0000-4000-8000-000000000001')=24000,'qty removed at corrected cost');
 perform pg_temp.ok((select total from purchase_invoices where id=(inv->>'invoice_id')::uuid)=108000,'AP after qty');

 -- Total baru di bawah pembayaran ditolak dengan pesan jelas.
 perform pay_purchase_invoice_atomic('p02-pay-key',(inv->>'invoice_id')::uuid,current_date,100000,'Transfer',null,'f2700000-0000-4000-8000-000000000001',null);
 perform pg_temp.expect_error(format('select preview_purchase_invoice_line_correction(%L,90,1000,current_date)',line),'lebih kecil dari pembayaran');
 -- Penurunan yang masih di atas pembayaran boleh: 90 x 1.150 = 103.500.
 pv:=preview_purchase_invoice_line_correction(line,90,1150,current_date);
 perform pg_temp.ok((pv->>'ap_delta')::numeric=-4500 and (pv->>'inventory_delta')::numeric=-1000 and (pv->>'hpp_delta')::numeric=-3500,'price down preview '||pv::text);
 perform correct_purchase_invoice_line('p02-down-key',line,2,90,1150,current_date,'Diskon susulan',pg_temp.expected(pv));
 perform pg_temp.ok(pg_temp.stock_value('f2400000-0000-4000-8000-000000000001')=23000,'stock after price down');
 -- Semua jurnal koreksi seimbang.
 perform pg_temp.ok(not exists(select 1 from journal_entries e where e.source='purchase-inv-correction' and (select sum(debit)-sum(credit) from journal_lines where entry_id=e.id)<>0),'all correction journals balanced');
end$$;

-- ===== Faktur dari PO, PKP 11%: lapisan dari bukti faktur, PPN ikut dikoreksi =====
update company_settings set mode_pkp=true,ppn_rate=11;
do $$declare inv record;line uuid;pv jsonb;res jsonb;begin
 perform receive_purchase_order('f2500000-0000-4000-8000-000000000001','p02-receipt','TB.P02.',5,current_date,null,null,jsonb_build_array(jsonb_build_object('id','f2600000-0000-4000-8000-000000000001','qty_terima',4,'qty_rusak',0)));
 select * into inv from create_purchase_invoice_from_po('f2500000-0000-4000-8000-000000000001','FB.P02.',5,null,current_date,current_date+30,null,
  jsonb_build_array(jsonb_build_object('po_item_id','f2600000-0000-4000-8000-000000000001','qty',4,'harga',111)),'[]','[]',44,'p02-po-invoice');
 select id into line from purchase_invoice_items where invoice_id=inv.invoice_id;
 perform pg_temp.ok(pg_temp.stock_value('f2400000-0000-4000-8000-000000000002')=400,'PO stock value 40 x 10');
 perform stock_out_fifo('f2200000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000002',25,'test-consume','P02.SALE2',current_date);
 perform pg_temp.expect_error(format('select preview_purchase_invoice_line_correction(%L,3,222,current_date)',line),'Retur Pembelian');
 pv:=preview_purchase_invoice_line_correction(line,4,222,current_date);
 perform pg_temp.ok((pv->>'remaining_qty_base')::numeric=15 and (pv->>'sold_qty_base')::numeric=25,'PO split '||pv::text);
 perform pg_temp.ok((pv->>'ap_delta')::numeric=444 and (pv->>'ppn_delta')::numeric=44 and (pv->>'inventory_delta')::numeric=150 and (pv->>'hpp_delta')::numeric=250,'PO values '||pv::text);
 res:=correct_purchase_invoice_line('p02-po-key',line,0,4,222,current_date,'Harga PO salah',pg_temp.expected(pv));
 perform pg_temp.ok(pg_temp.lines(inv.no_faktur,'purchase-inv-correction')='{"182004":44,"170001":150,"600001":250,"311001":-444}'::jsonb,'PO journal '||pg_temp.lines(inv.no_faktur,'purchase-inv-correction')::text);
 perform pg_temp.ok(pg_temp.stock_value('f2400000-0000-4000-8000-000000000002')=300,'PO stock 15 x 20');
 -- Koreksi kedua memakai lapisan hasil koreksi pertama.
 pv:=preview_purchase_invoice_line_correction(line,4,166.5,current_date);
 perform pg_temp.ok((pv->>'remaining_qty_base')::numeric=15 and (pv->>'inventory_delta')::numeric=-75 and (pv->>'old_unit_cost')::numeric=20 and (pv->>'new_unit_cost')::numeric=15,'second correction '||pv::text);
 perform pg_temp.expect_error(format('select cancel_purchase_invoice(%L,1,''p02-po-cancel'',''Coba batal'')',inv.invoice_id),'Rekonsiliasi');
end$$;
-- ===== Riwayat koreksi hanya untuk OWNER/FINANCE =====
do $$begin
 perform pg_temp.ok((select count(*) from purchase_invoice_corrections)>0,'owner reads history');
 perform pg_temp.as_user('f2000000-0000-4000-8000-000000000003');
 perform pg_temp.ok((select count(*) from purchase_invoice_corrections)>0,'finance reads history');
 perform pg_temp.as_user('f2000000-0000-4000-8000-000000000002');
 perform pg_temp.ok((select count(*) from purchase_invoice_corrections)=0,'admin cannot read HPP history');
 perform pg_temp.as_user('f2000000-0000-4000-8000-000000000001');
end$$;

reset role;
update company_settings set mode_pkp=false;
set local role authenticated;
-- ===== Barang dipindah gudang (bukan terjual): koreksi ditolak =====
do $$declare inv jsonb;begin
 inv:=pg_temp.direct('p02-trf','f2400000-0000-4000-8000-000000000003',10,100);
 insert into p02_ids select 'trf-line',id from purchase_invoice_items where invoice_id=(inv->>'invoice_id')::uuid;
end$$;
reset role;
select stock_out_fifo('f2200000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000003',3,'transfer','P02.TRF',current_date);
set local role authenticated;
do $$begin
 perform pg_temp.expect_error(format('select preview_purchase_invoice_line_correction(%L,10,120,current_date)',(select id from p02_ids where name='trf-line')),'dipindah gudang');
end$$;

-- ===== Koreksi -> batal jual (qty kembali ke lapisan lama) -> koreksi lagi =====
do $$declare inv jsonb;begin
 inv:=pg_temp.direct('p02-void','f2400000-0000-4000-8000-000000000004',10,100);
 insert into p02_ids select 'void-line',id from purchase_invoice_items where invoice_id=(inv->>'invoice_id')::uuid;
end$$;
-- Lapisan asal sengaja dibuat lebih tua supaya salinan created_at bisa dibuktikan.
reset role;
update stock_layers set created_at=created_at-interval '1 day' where item_id='f2400000-0000-4000-8000-000000000004';
set local role authenticated;
do $$declare line uuid:=(select id from p02_ids where name='void-line');pv jsonb;begin
 perform stock_out_fifo('f2200000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000004',6,'test-consume','P02.SALE3',current_date);
 pv:=preview_purchase_invoice_line_correction(line,10,110,current_date);
 perform pg_temp.ok((pv->>'inventory_delta')::numeric=40 and (pv->>'hpp_delta')::numeric=60,'void first '||pv::text);
 perform correct_purchase_invoice_line('p02-void-1',line,0,10,110,current_date,'Harga naik',pg_temp.expected(pv));
end$$;
reset role;
-- Pembatalan penjualan mengembalikan 2 unit ke lapisan asli (yang sudah dipensiunkan koreksi).
do $$declare retired uuid;begin
 select c.layer_id into retired from purchase_invoice_correction_layers c where c.item_id='f2400000-0000-4000-8000-000000000004' and c.role='retired';
 if (select created_at from stock_layers where id=retired) is distinct from (select l.created_at from stock_layers l join purchase_invoice_correction_layers c on c.layer_id=l.id where c.item_id='f2400000-0000-4000-8000-000000000004' and c.role='created') then
  raise exception 'Assertion failed: replacement layer keeps FIFO created_at';end if;
 if (select created_at from stock_layers where id=retired)>=now()-interval '1 hour' then raise exception 'Assertion failed: fixture layer not aged';end if;
 update stock_layers set qty_left=qty_left+2 where id=retired;
 update stock set qty=qty+2 where item_id='f2400000-0000-4000-8000-000000000004';
 insert into stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref) values(current_date,'f2200000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000004',2,100,'sale-void','P02.SALE3');
end$$;
set local role authenticated;
do $$declare line uuid:=(select id from p02_ids where name='void-line');pv jsonb;begin
 pv:=preview_purchase_invoice_line_correction(line,10,120,current_date);
 perform pg_temp.ok((pv->>'remaining_qty')::numeric=6 and (pv->>'sold_qty')::numeric=4,'restored units counted '||pv::text);
 perform pg_temp.ok((pv->>'inventory_delta')::numeric=80 and (pv->>'hpp_delta')::numeric=20,'restored units revalued '||pv::text);
 perform correct_purchase_invoice_line('p02-void-2',line,1,10,120,current_date,'Harga naik lagi',pg_temp.expected(pv));
 perform pg_temp.ok(pg_temp.stock_value('f2400000-0000-4000-8000-000000000004')=720,'void item value 6 x 120');
 perform pg_temp.ok(pg_temp.lines((select no_faktur from purchase_invoices i join purchase_invoice_items ii on ii.invoice_id=i.id where ii.id=line),'purchase-inv-correction')='{"170001":120,"600001":80,"311001":-200}'::jsonb,'void journals sum');
end$$;

-- ===== Average: rata-rata gudang (75) beda dari harga faktur (100) dan qty turun mengosongkan stok =====
do $$declare inv jsonb;line uuid;pv jsonb;begin
 perform stock_in_fifo('f2200000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000005',10,50,'purchase','P02.OLD',current_date,current_date+30);
 inv:=pg_temp.direct('p02-zero','f2400000-0000-4000-8000-000000000005',10,100);
 select id into line from purchase_invoice_items where invoice_id=(inv->>'invoice_id')::uuid;
 perform stock_out_fifo('f2200000-0000-4000-8000-000000000001','f2400000-0000-4000-8000-000000000005',14,'test-consume','P02.SALE4',current_date);
 if '__MODE__'='average' then
  perform pg_temp.expect_error(format('select preview_purchase_invoice_line_correction(%L,4,100,current_date)',line),'mengosongkan stok');
  -- Harga saja (stok tetap 6) tetap bisa: sisa 6 dinilai ulang tepat 6 x 20.
  pv:=preview_purchase_invoice_line_correction(line,10,120,current_date);
  perform pg_temp.ok((pv->>'inventory_delta')::numeric=120 and (pv->>'hpp_delta')::numeric=80,'avg price only '||pv::text);
  perform correct_purchase_invoice_line('p02-zero-avg',line,0,10,120,current_date,'Harga naik',pg_temp.expected(pv));
  perform pg_temp.ok(round(pg_temp.stock_value('f2400000-0000-4000-8000-000000000005'),6)=570,'avg value 450+120');
 else
  pv:=preview_purchase_invoice_line_correction(line,4,100,current_date);
  perform pg_temp.ok((pv->>'removed_qty')::numeric=6 and (pv->>'inventory_delta')::numeric=-600 and (pv->>'hpp_delta')::numeric=0 and (pv->>'ap_delta')::numeric=-600,'fifo zero '||pv::text);
  perform correct_purchase_invoice_line('p02-zero-fifo',line,0,4,100,current_date,'Kurang kirim',pg_temp.expected(pv));
  perform pg_temp.ok((select qty from stock where item_id='f2400000-0000-4000-8000-000000000005')=0 and pg_temp.stock_value('f2400000-0000-4000-8000-000000000005')=0,'fifo emptied');
 end if;
end$$;
rollback;
