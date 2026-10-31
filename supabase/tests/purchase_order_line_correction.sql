-- Edit per baris PO. Fiksi lokal, selalu di-rollback. Runner mengganti __MODE__ dengan 'fifo' atau 'average'.
begin;
insert into auth.users(id) values('f9000000-0000-4000-8000-000000000001'),('f9000000-0000-4000-8000-000000000002');
update profiles set role='OWNER' where id='f9000000-0000-4000-8000-000000000001';
update profiles set role='ADMIN' where id='f9000000-0000-4000-8000-000000000002';
insert into branches(id,code,name,type) values('f9100000-0000-4000-8000-000000000001','POL-FIC','POL fiction','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('f9200000-0000-4000-8000-000000000001','f9100000-0000-4000-8000-000000000001','POL-WH','POL warehouse','VET');
insert into suppliers(id,nama) values('f9300000-0000-4000-8000-000000000001','POL supplier');
insert into items(id,code,name,unit,item_type) values
 ('f9400000-0000-4000-8000-000000000001','POL-A','Line goods A','pcs','Persediaan'),
 ('f9400000-0000-4000-8000-000000000002','POL-B','Line goods B','pcs','Persediaan'),
 ('f9400000-0000-4000-8000-000000000003','POL-C','Line goods C','pcs','Persediaan'),
 ('f9400000-0000-4000-8000-000000000004','POL-D','Dozen goods D','pcs','Persediaan');
insert into item_units(item_id,unit,factor) values('f9400000-0000-4000-8000-000000000004','lusin',12);
insert into item_units(item_id,unit,factor) values('f9400000-0000-4000-8000-000000000001','box',10),('f9400000-0000-4000-8000-000000000002','box',10),('f9400000-0000-4000-8000-000000000003','box',10);
insert into purchase_orders(id,no_po,supplier_id,branch_id,to_warehouse_id,status) values
 ('f9500000-0000-4000-8000-000000000001','PO.POL.1','f9300000-0000-4000-8000-000000000001','f9100000-0000-4000-8000-000000000001','f9200000-0000-4000-8000-000000000001','Dipesan'),
 ('f9500000-0000-4000-8000-000000000002','PO.POL.2','f9300000-0000-4000-8000-000000000001','f9100000-0000-4000-8000-000000000001','f9200000-0000-4000-8000-000000000001','Dipesan'),
 ('f9500000-0000-4000-8000-000000000003','PO.POL.3','f9300000-0000-4000-8000-000000000001','f9100000-0000-4000-8000-000000000001','f9200000-0000-4000-8000-000000000001','Dipesan');
insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor) values
 ('f9600000-0000-4000-8000-000000000001','f9500000-0000-4000-8000-000000000001','f9400000-0000-4000-8000-000000000001','Line goods A',4,100,'box',10),
 ('f9600000-0000-4000-8000-000000000002','f9500000-0000-4000-8000-000000000001','f9400000-0000-4000-8000-000000000002','Line goods B',2,50,'box',10),
 ('f9600000-0000-4000-8000-000000000003','f9500000-0000-4000-8000-000000000002','f9400000-0000-4000-8000-000000000003','Line goods C',3,100,'box',10),
 ('f9600000-0000-4000-8000-000000000004','f9500000-0000-4000-8000-000000000003','f9400000-0000-4000-8000-000000000004','Dozen goods D',4,120,'lusin',12);
update purchase_orders set total=480 where id='f9500000-0000-4000-8000-000000000003';
update purchase_orders set total=500 where id='f9500000-0000-4000-8000-000000000001';
update purchase_orders set total=300 where id='f9500000-0000-4000-8000-000000000002';
insert into coa_accounts(code,name,type,normal_balance) values('170001','Fiction stock','ASET','D'),('311001','Fiction AP','LIABILITAS','K'),('182004','Fiction VAT','ASET','D'),('600001','Fiction HPP','BEBAN','D'),('110219','Fiction bank','ASET','D') on conflict(code) do update set is_active=true,is_header=false;
update coa_accounts set is_active=true,is_header=false where code in('170001','160001','311003','110003','120002','311001','182004','600001');
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false,ppn_rate=11;
insert into cash_accounts(id,nama,jenis,coa_code,branch_id) values('f9700000-0000-4000-8000-000000000001','POL bank','Bank','110219','f9100000-0000-4000-8000-000000000001');
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
create function pg_temp.rev(po text) returns int language sql as $$select revision from purchase_orders where id=po::uuid$$;
grant execute on all functions in schema pg_temp to authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f9000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$begin if '__MODE__'='average' then perform activate_moving_average(); end if; end$$;

-- ===== 1. Belum diterima: Qty PO dan harga langsung, tanpa stok/jurnal =====
do $$declare pv jsonb;res jsonb;jcount int;begin
 perform pg_temp.as_user('f9000000-0000-4000-8000-000000000002');
 perform pg_temp.expect_error('select preview_purchase_order_line_correction(''f9600000-0000-4000-8000-000000000002'',3,null,60,current_date)','hanya oleh Super Admin');
 perform pg_temp.expect_error('select correct_purchase_order_line(''pol-admin-key'',''f9600000-0000-4000-8000-000000000002'',0,3,null,60,current_date,''Ubah qty'',''{}'')','hanya oleh Super Admin');
 perform pg_temp.as_user('f9000000-0000-4000-8000-000000000001');
 perform pg_temp.expect_error('select preview_purchase_order_line_correction(''f9600000-0000-4000-8000-000000000002'',2,null,50,current_date)','Tidak ada perubahan');
 perform pg_temp.expect_error('select preview_purchase_order_line_correction(''f9600000-0000-4000-8000-000000000002'',0,null,50,current_date)','Qty PO harus');
 select count(*) into jcount from journal_entries;
 pv:=preview_purchase_order_line_correction('f9600000-0000-4000-8000-000000000002',3,null,60,current_date);
 perform pg_temp.ok(pv->>'path'='unreceived' and (pv->>'new_qty')::numeric=3 and (pv->>'total')::numeric=580,'unreceived preview '||pv::text);
 perform pg_temp.ok((select qty from purchase_order_items where id='f9600000-0000-4000-8000-000000000002')=2 and pg_temp.rev('f9500000-0000-4000-8000-000000000001')=0,'preview left no trace');
 perform pg_temp.expect_error(format('select correct_purchase_order_line(''pol-stale-key'',''f9600000-0000-4000-8000-000000000002'',0,3,null,60,current_date,''Ubah qty'',%L)',(pv||'{"total":1}')::text),'berubah sejak pratinjau');
 res:=correct_purchase_order_line('pol-unrecv-key','f9600000-0000-4000-8000-000000000002',0,3,null,60,current_date,'Vendor cuma punya 3 box',pv);
 perform pg_temp.ok((select qty=3 and harga_beli=60 from purchase_order_items where id='f9600000-0000-4000-8000-000000000002'),'line updated');
 perform pg_temp.ok((select total=580 and revision=1 and status='Dipesan' from purchase_orders where id='f9500000-0000-4000-8000-000000000001'),'PO header updated');
 perform pg_temp.ok((select count(*) from journal_entries)=jcount,'no journal for unreceived edit');
 perform pg_temp.ok(exists(select 1 from purchase_order_revisions where purchase_order_id='f9500000-0000-4000-8000-000000000001' and after_value->>'mode'='line' and reason='Vendor cuma punya 3 box'),'revision history kept');
 perform pg_temp.ok(correct_purchase_order_line('pol-unrecv-key','f9600000-0000-4000-8000-000000000002',0,3,null,60,current_date,'Vendor cuma punya 3 box',pv)=res,'idempotent replay');
 perform pg_temp.expect_error(format('select correct_purchase_order_line(''pol-unrecv-key'',''f9600000-0000-4000-8000-000000000002'',0,4,null,60,current_date,''Vendor cuma punya 3 box'',%L)',pv::text),'rincian berbeda');
 perform pg_temp.expect_error(format('select correct_purchase_order_line(''pol-rev-key'',''f9600000-0000-4000-8000-000000000002'',0,4,null,60,current_date,''Lagi'',%L)',pv::text),'berubah sejak pratinjau');
end$$;

-- ===== 2. Sudah diterima tanpa faktur: ditolak dengan arahan =====
do $$begin
 perform receive_purchase_order('f9500000-0000-4000-8000-000000000002','pol-receipt-c','TB.POL.',5,current_date,null,null,
  jsonb_build_array(jsonb_build_object('id','f9600000-0000-4000-8000-000000000003','qty_terima',3,'qty_rusak',0)));
 perform pg_temp.expect_error('select preview_purchase_order_line_correction(''f9600000-0000-4000-8000-000000000003'',null,2,100,current_date)','belum ada faktur');
end$$;

-- ===== 3. Diterima + faktur belum dibayar: 36 tercatat, cuma 30 datang, sebagian sudah terjual =====
do $$declare inv record;pv jsonb;res jsonb;line uuid;jcount int;begin
 -- Lengkapi PO 1: baris A 4 box (B tetap belum diterima tidak boleh menghalangi faktur, jadi B diterima juga).
 perform receive_purchase_order('f9500000-0000-4000-8000-000000000001','pol-receipt-1','TB.POL.',5,current_date,null,null,
  jsonb_build_array(jsonb_build_object('id','f9600000-0000-4000-8000-000000000001','qty_terima',4,'qty_rusak',0),
                    jsonb_build_object('id','f9600000-0000-4000-8000-000000000002','qty_terima',3,'qty_rusak',0)));
 perform pg_temp.ok((select status from purchase_orders where id='f9500000-0000-4000-8000-000000000001')='Diterima','PO received');
 select * into inv from create_purchase_invoice_from_po('f9500000-0000-4000-8000-000000000001','FB.POL.',5,null,current_date,current_date+30,null,
  jsonb_build_array(jsonb_build_object('po_item_id','f9600000-0000-4000-8000-000000000001','qty',4,'harga',100),
                    jsonb_build_object('po_item_id','f9600000-0000-4000-8000-000000000002','qty',3,'harga',60)),'[]','[]',0,'pol-invoice-1');
 select id into line from purchase_invoice_items where invoice_id=inv.invoice_id and po_item_id='f9600000-0000-4000-8000-000000000001';
 -- 25 pcs terjual dari 40.
 perform stock_out_fifo('f9200000-0000-4000-8000-000000000001','f9400000-0000-4000-8000-000000000001',25,'test-consume','POL.SALE',current_date);
 perform pg_temp.ok(pg_temp.stock_value('f9400000-0000-4000-8000-000000000001')=150,'15 pcs @10 left');

 -- Guard: qty naik ditolak; qty 0 ditolak; mengurangi lebih dari sisa stok ditolak.
 perform pg_temp.expect_error('select preview_purchase_order_line_correction(''f9600000-0000-4000-8000-000000000001'',null,5,100,current_date)','hanya bisa dikurangi');
 perform pg_temp.expect_error('select preview_purchase_order_line_correction(''f9600000-0000-4000-8000-000000000001'',null,0,100,current_date)','lebih dari 0');
 perform pg_temp.expect_error('select preview_purchase_order_line_correction(''f9600000-0000-4000-8000-000000000001'',null,2,100,current_date)','sisa stok faktur');
 -- Jalur faktur biasa tetap menolak penurunan qty faktur dari PO.
 perform pg_temp.expect_error(format('select preview_purchase_invoice_line_correction(%L,3,100,current_date)',line),'Retur Pembelian');

 select count(*) into jcount from journal_entries;
 pv:=preview_purchase_order_line_correction('f9600000-0000-4000-8000-000000000001',null,3,100,current_date);
 perform pg_temp.ok(pv->>'path'='invoice' and (pv->>'removed_qty')::numeric=1 and (pv->>'ap_delta')::numeric=-100 and (pv->>'inventory_delta')::numeric=-100 and (pv->>'hpp_delta')::numeric=0,'qty preview '||pv::text);
 perform pg_temp.ok((pv->>'new_qty')::numeric=3 and (pv->>'new_qty_terima')::numeric=3 and (pv->>'total')::numeric=480,'PO follows in preview '||pv::text);
 perform pg_temp.ok((select count(*) from journal_entries)=jcount and (select qty_terima from purchase_order_items where id='f9600000-0000-4000-8000-000000000001')=4
  and not exists(select 1 from purchase_invoice_corrections),'preview left no trace');
 res:=correct_purchase_order_line('pol-qty-key','f9600000-0000-4000-8000-000000000001',pg_temp.rev('f9500000-0000-4000-8000-000000000001'),null,3,100,current_date,'Vendor cuma kirim 3 box',pv);
 perform pg_temp.ok((select qty=3 and qty_terima=3 and harga_beli=100 from purchase_order_items where id='f9600000-0000-4000-8000-000000000001'),'PO line follows');
 perform pg_temp.ok((select total=480 and status='Diterima' from purchase_orders where id='f9500000-0000-4000-8000-000000000001'),'PO total follows');
 perform pg_temp.ok((select gi.qty_terima from goods_receipt_items gi where gi.po_item_id='f9600000-0000-4000-8000-000000000001')=3,'receipt line follows');
 perform pg_temp.ok((select gi.harga from goods_receipt_items gi where gi.po_item_id='f9600000-0000-4000-8000-000000000001')=100,'receipt price unchanged when price same');
 perform pg_temp.ok((select qty from purchase_invoice_items where id=line)=3 and (select total from purchase_invoices where id=inv.invoice_id)=480,'invoice follows');
 perform pg_temp.ok((select qty from stock where item_id='f9400000-0000-4000-8000-000000000001')=5 and pg_temp.stock_value('f9400000-0000-4000-8000-000000000001')=50,'stock 5 pcs @10');
 perform pg_temp.ok(not exists(select 1 from journal_entries e where e.source='purchase-inv-correction' and (select sum(debit)-sum(credit) from journal_lines where entry_id=e.id)<>0),'journal balanced');

 -- Harga diterima ternyata 120: harga PO ikut.
 pv:=preview_purchase_order_line_correction('f9600000-0000-4000-8000-000000000001',null,3,120,current_date);
 perform pg_temp.ok((pv->>'ap_delta')::numeric=60 and (pv->>'inventory_delta')::numeric=10 and (pv->>'hpp_delta')::numeric=50,'price preview '||pv::text);
 res:=correct_purchase_order_line('pol-price-key','f9600000-0000-4000-8000-000000000001',pg_temp.rev('f9500000-0000-4000-8000-000000000001'),null,3,120,current_date,'Harga pemasok 120',pv);
 perform pg_temp.ok((select harga_beli from purchase_order_items where id='f9600000-0000-4000-8000-000000000001')=120 and (select harga from purchase_invoice_items where id=line)=120,'price follows');
 perform pg_temp.ok((select total from purchase_orders where id='f9500000-0000-4000-8000-000000000001')=540,'PO total 3x120+3x60');
 perform pg_temp.ok((select gi.harga from goods_receipt_items gi where gi.po_item_id='f9600000-0000-4000-8000-000000000001')=120,'receipt price follows');

 -- Faktur sudah dibayar: ditolak dengan pesan jelas.
 perform pay_purchase_invoice_atomic('pol-pay-key',inv.invoice_id,current_date,100,'Transfer',null,'f9700000-0000-4000-8000-000000000001',null);
 perform pg_temp.expect_error('select preview_purchase_order_line_correction(''f9600000-0000-4000-8000-000000000002'',null,2,60,current_date)','sudah dibayar');
end$$;

-- ===== 4. Faktor 12 + harga faktur beda dari PO =====
do $$declare inv record;pv jsonb;res jsonb;begin
 perform receive_purchase_order('f9500000-0000-4000-8000-000000000003','pol-receipt-3','TB.POL.',5,current_date,null,null,
  jsonb_build_array(jsonb_build_object('id','f9600000-0000-4000-8000-000000000004','qty_terima',4,'qty_rusak',0)));
 select * into inv from create_purchase_invoice_from_po('f9500000-0000-4000-8000-000000000003','FB.POL.',5,null,current_date,current_date+30,null,
  jsonb_build_array(jsonb_build_object('po_item_id','f9600000-0000-4000-8000-000000000004','qty',4,'harga',132)),'[]','[]',0,'pol-invoice-3');
 perform stock_out_fifo('f9200000-0000-4000-8000-000000000001','f9400000-0000-4000-8000-000000000004',25,'test-consume','POL.SALE3',current_date);
 pv:=preview_purchase_order_line_correction('f9600000-0000-4000-8000-000000000004',null,3,132,current_date);
 perform pg_temp.ok((pv->>'old_harga')::numeric=120 and (pv->>'old_harga_faktur')::numeric=132,'invoice price exposed '||pv::text);
 perform pg_temp.ok((pv->>'sold_qty_base')::numeric=25 and (pv->>'removed_qty_base')::numeric=12 and (pv->>'ap_delta')::numeric=-132,'dozen preview '||pv::text);
 -- Browser mengirim balik 25/12 sebagai float JS; simpan tetap diterima karena yang dibandingkan qty dasar.
 res:=correct_purchase_order_line('pol-dozen-key','f9600000-0000-4000-8000-000000000004',pg_temp.rev('f9500000-0000-4000-8000-000000000003'),null,3,132,current_date,'Kurang satu lusin',
  pv||'{"sold_qty":2.0833333333333335,"remaining_qty":1.9166666666666667}'::jsonb);
 perform pg_temp.ok((select qty=3 and qty_terima=3 and harga_beli=132 from purchase_order_items where id='f9600000-0000-4000-8000-000000000004'),'dozen line follows');
 perform pg_temp.ok((select qty from stock where item_id='f9400000-0000-4000-8000-000000000004')=11,'48-25-12 pcs left');
 -- Penerimaan dicatat @120 (harga PO); faktur @132. Setelah edit, nilai penerimaan = PO = faktur.
 perform pg_temp.ok((select gi.qty_terima*gi.harga from goods_receipt_items gi where gi.po_item_id='f9600000-0000-4000-8000-000000000004')
  =(select total from purchase_orders where id='f9500000-0000-4000-8000-000000000003'),'receipt value equals PO value');
end$$;

select pg_temp.ok(not exists(select 1 from journal_entries e where (select coalesce(sum(debit)-sum(credit),0) from journal_lines where entry_id=e.id)<>0),'every journal balanced');
rollback;
