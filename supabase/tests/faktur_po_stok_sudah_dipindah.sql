-- Owned native PostgreSQL fixtures, never a production connection.
-- Faktur PO setelah barang penerimaan dipindah/terpakai (kasus PO-20261102-DC-0004, 16 Nov).
begin;
insert into auth.users(id) values('fd000000-0000-4000-8000-000000000001');
update profiles set role='OWNER' where id='fd000000-0000-4000-8000-000000000001';
insert into branches(id,code,name,type) values('fd100000-0000-4000-8000-000000000001','FD-DC','DC fiction','KLINIK');
insert into warehouses(id,branch_id,code,name,type) values('fd200000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001','FD-WH','DC warehouse','VET');
insert into suppliers(id,nama) values('fd300000-0000-4000-8000-000000000001','Fiction supplier');
insert into items(id,code,name,unit,item_type,track_expiry) values
 ('fd400000-0000-4000-8000-000000000001','FD-A','Habis dipindah','pcs','Persediaan',false),
 ('fd400000-0000-4000-8000-000000000002','FD-B','Sebagian dipindah','pcs','Persediaan',false),
 ('fd400000-0000-4000-8000-000000000003','FD-C','Masih utuh','pcs','Persediaan',false);
insert into item_units(item_id,unit,factor) values('fd400000-0000-4000-8000-000000000002','btl',45);
insert into purchase_orders(id,no_po,supplier_id,branch_id,to_warehouse_id,status) values('fd500000-0000-4000-8000-000000000001','PO.FD.1','fd300000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001','fd200000-0000-4000-8000-000000000001','Dipesan');
insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor) values
 ('fd600000-0000-4000-8000-000000000001','fd500000-0000-4000-8000-000000000001','fd400000-0000-4000-8000-000000000001','Habis dipindah',10,100,'pcs',1),
 ('fd600000-0000-4000-8000-000000000002','fd500000-0000-4000-8000-000000000001','fd400000-0000-4000-8000-000000000002','Sebagian dipindah',2,10000,'btl',45),
 ('fd600000-0000-4000-8000-000000000003','fd500000-0000-4000-8000-000000000001','fd400000-0000-4000-8000-000000000003','Masih utuh',5,3166.65,'pcs',1);
insert into coa_accounts(code,name,type,normal_balance) values('170001','Fiction stock','ASET','D'),('311001','Fiction AP','LIABILITAS','K'),('182004','Fiction VAT','ASET','D') on conflict(code) do update set is_active=true,is_header=false;
update coa_accounts set is_active=true,is_header=false where code in('170001','160001','311003','110003','120002');
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false,ppn_rate=11;
create function pg_temp.expect_error(command text,fragment text) returns void language plpgsql as $$begin
 begin execute command;exception when others then if position(fragment in sqlerrm)=0 then raise exception 'Wrong error: % wanted %',sqlerrm,fragment;end if;return;end;
 raise exception 'Expected rejection: %',fragment;
end$$;
create function pg_temp.lines(p_a numeric default 100,p_b numeric default 10000) returns jsonb language sql as $$
 select jsonb_build_array(
  jsonb_build_object('po_item_id','fd600000-0000-4000-8000-000000000001','qty',10,'harga',p_a),
  jsonb_build_object('po_item_id','fd600000-0000-4000-8000-000000000002','qty',2,'harga',p_b),
  jsonb_build_object('po_item_id','fd600000-0000-4000-8000-000000000003','qty',5,'harga',3166.65))
$$;
create function pg_temp.invoice(p_key text,p_items jsonb,p_ppn numeric default 0) returns jsonb language sql as $$
 select to_jsonb(x) from create_purchase_invoice_from_po('fd500000-0000-4000-8000-000000000001','FB.FD.',5,null,current_date,current_date+30,null,p_items,'[]','[]',p_ppn,p_key,null)x
$$;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','fd000000-0000-4000-8000-000000000001',true);
select receive_purchase_order('fd500000-0000-4000-8000-000000000001','fd-receipt','TB.FD.',5,current_date,null,null,jsonb_build_array(
 jsonb_build_object('id','fd600000-0000-4000-8000-000000000001','qty_terima',10,'qty_rusak',0),
 jsonb_build_object('id','fd600000-0000-4000-8000-000000000002','qty_terima',2,'qty_rusak',0),
 jsonb_build_object('id','fd600000-0000-4000-8000-000000000003','qty_terima',5,'qty_rusak',0)));
reset role;
-- Barang dibagi ke klinik: A habis, B tinggal 30 dari 90 unit dasar, C utuh (simulasi keluarnya stok penerimaan).
alter table stock_layers disable trigger user;
alter table stock disable trigger user;
update stock_layers set qty_left=0 where item_id='fd400000-0000-4000-8000-000000000001' and source_ref='PO.FD.1';
update stock_layers set qty_left=30 where item_id='fd400000-0000-4000-8000-000000000002' and source_ref='PO.FD.1';
update stock set qty=0 where item_id='fd400000-0000-4000-8000-000000000001';
update stock set qty=30 where item_id='fd400000-0000-4000-8000-000000000002';
alter table stock_layers enable trigger user;
alter table stock enable trigger user;
create table fd_before as select id,qty_in,qty_left,unit_cost from stock_layers where source_ref='PO.FD.1';
grant select on fd_before to authenticated;
-- PKP (ber-PPN): nilai stok harus dinilai ulang ke DPP, jadi barang yang sudah keluar tetap ditolak.
update company_settings set mode_pkp=true;
set local role authenticated;
select pg_temp.expect_error('select pg_temp.invoice(''fd-pkp'',pg_temp.lines(),36833.25-round(36833.25*100/111))','harga faktur harus sama dengan harga PO');
reset role;
update company_settings set mode_pkp=false;
create table fd_result(name text primary key,result jsonb);
grant all on fd_result to authenticated;
set local role authenticated;
do $$declare r jsonb;v uuid;begin
 -- Harga faktur berbeda dari PO pada barang yang sudah keluar: tetap ditolak, pesannya jelas.
 perform pg_temp.expect_error('select pg_temp.invoice(''fd-diff'',pg_temp.lines(110))','harga faktur harus sama dengan harga PO');
 -- Harga sama dengan PO: faktur jadi walau A habis dan B tinggal sepertiga.
 r:=pg_temp.invoice('fd-same',pg_temp.lines());
 v:=(r->>'invoice_id')::uuid;
 if (r->>'total')::numeric<>10*100+2*10000+5*3166.65 then raise exception 'Total faktur salah: %',r;end if;
 insert into fd_result values('same',r);
 if (select count(*) from purchase_invoice_items where invoice_id=v)<>3 then raise exception 'Baris faktur hilang';end if;
 -- Ulang dengan kunci yang sama: hasil sama, tidak dobel.
 if pg_temp.invoice('fd-same',pg_temp.lines())<>r then raise exception 'Ulang kunci sama menggandakan faktur';end if;
 -- Faktur kedua untuk qty yang sama ditolak (sisa PO habis).
 perform pg_temp.expect_error('select pg_temp.invoice(''fd-again'',pg_temp.lines())','melebihi sisa');
end$$;
reset role;
do $$declare v uuid;j uuid;begin
 select (result->>'invoice_id')::uuid into v from fd_result where name='same';
 -- Nilai stok tidak berubah sedikit pun (harga faktur = harga PO).
 if exists(select 1 from stock_layers l join fd_before b using(id) where (l.qty_in,l.qty_left,l.unit_cost) is distinct from (b.qty_in,b.qty_left,b.unit_cost))
  or (select count(*) from stock_layers where source_ref='PO.FD.1')<>(select count(*) from fd_before) then raise exception 'Lapisan stok berubah';end if;
 -- Jurnal: Dr barang diterima belum ditagih = Cr hutang, tanpa selisih persediaan.
 select journal_id into j from purchase_invoice_postings where invoice_id=v;
 if (select sum(debit) from journal_lines where entry_id=j)<>(select sum(credit) from journal_lines where entry_id=j)
  or exists(select 1 from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=j and a.code in('170001','182004'))
  or (select l.debit from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=j and a.code='311003')<>36833.25
  or (select l.credit from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id=j and a.code='311001')<>36833.25
 then raise exception 'Jurnal faktur tidak sesuai';end if;
 -- Bukti asal nilai mencakup ketiga barang, termasuk lapisan A yang sudah habis.
 if (select count(distinct l.item_id) from purchase_invoice_layer_proofs p join stock_layers l on l.id=p.layer_id where p.invoice_id=v and p.allocated)<>3 then raise exception 'Bukti lapisan tidak lengkap';end if;
end$$;
-- Pembatalan faktur tetap bisa (lapisan tidak berubah sejak faktur), stok tetap sama.
set local role authenticated;
do $$declare v uuid;begin
 select (result->>'invoice_id')::uuid into v from fd_result where name='same';
 perform cancel_purchase_invoice(v,0,'fd-cancel','Salah input');
 if (select voided_at from purchase_invoices where id=v) is null then raise exception 'Faktur tidak batal';end if;
 if exists(select 1 from stock_layers l join fd_before b using(id) where (l.qty_in,l.qty_left,l.unit_cost) is distinct from (b.qty_in,b.qty_left,b.unit_cost)) then raise exception 'Pembatalan mengubah stok';end if;
 -- Setelah batal, faktur pengganti dengan harga PO bisa dibuat lagi.
 perform pg_temp.invoice('fd-same-2',pg_temp.lines());
end$$;
reset role;
rollback;
