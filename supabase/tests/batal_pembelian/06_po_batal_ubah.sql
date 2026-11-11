-- 06 Ubah / batalkan PO sesudah pembatalan: dokumen turunan yang sudah dibatalkan tidak lagi mengunci pembatalan PO; yang masih aktif
-- tetap menghalangi; ganti-total baris tetap ditolak bila ada riwayat (kunci asing) dengan petunjuk Edit baris / Batalkan PO.
select pg_temp.su();
select pg_temp.mkpo(1,1,'[{"item":"a","qty":10,"harga":100},{"item":"b","qty":10,"harga":200}]');
select pg_temp.mkpo(2,1,'[{"item":"c","qty":5,"harga":100}]');
select pg_temp.mkpo(3,1,'[{"item":"d","qty":5,"harga":100}]');
select pg_temp.mkpo(4,1,'[{"item":"a","qty":5,"harga":100}]');
select pg_temp.mkpo(5,1,'[{"item":"b","qty":5,"harga":100}]');
select pg_temp.act(1);
select pg_temp.recv(1,'po-r1','[{"line":1,"qty":10},{"line":2,"qty":10}]') as r1 \gset
select pg_temp.inv(1,'po-i1','[{"line":1,"qty":10,"harga":100},{"line":2,"qty":10,"harga":200}]',array[:'r1'::uuid]) as i1 \gset
select (pay_purchase_invoice_atomic('po-p1',:'i1'::uuid,current_date,3000,'Transfer',null,'bd700000-0000-4000-8000-000000000001',null))->>'payment_id' as p1 \gset
-- Selama aktif: tidak bisa dibatalkan (pesan jelas), tanpa efek.
select pg_temp.digest() as d0 \gset
select pg_temp.expect_error(format('select revise_purchase_order(%L,%L,(select revision from purchase_orders where id=%L),%L,%L::jsonb,%L::jsonb,%L)','po-v0',pg_temp.po(1),pg_temp.po(1),'void','{}','[]','Salah PO'),'PO yang sudah selesai atau batal');
select pg_temp.ok(pg_temp.digest()=:'d0','void ditolak tanpa efek');
-- Balikkan: pembayaran -> faktur -> penerimaan.
select cancel_purchase_payment(:'p1'::uuid,0,'po-cp','Salah bayar') is not null as x \gset
select cancel_purchase_invoice(:'i1'::uuid,0,'po-ci','Salah faktur',current_date) is not null as x \gset
select cancel_goods_receipt(:'r1'::uuid,'po-cr','Salah terima',current_date) is not null as x \gset
select pg_temp.ok((select status::text from purchase_orders where id=pg_temp.po(1))='Dipesan','PO kembali Dipesan');
-- Ganti-total baris ditolak (kunci asing ke riwayat), pesan memberi dua jalan keluar.
select pg_temp.expect_error(format('select revise_purchase_order(%L,%L,(select revision from purchase_orders where id=%L),%L,%L::jsonb,%L::jsonb,%L)','po-e1',pg_temp.po(1),pg_temp.po(1),'edit',
  '{"to_warehouse_id":"bd200000-0000-4000-8000-000000000001"}','[{"item_id":"bd400000-0000-4000-8000-00000000000a","nama":"BP A","qty":10,"harga_beli":110,"satuan":"pcs"}]','Ganti'),'termasuk yang sudah dibatalkan');
select pg_temp.expect_error(format('select revise_purchase_order(%L,%L,(select revision from purchase_orders where id=%L),%L,%L::jsonb,%L::jsonb,%L)','po-e1',pg_temp.po(1),pg_temp.po(1),'edit',
  '{"to_warehouse_id":"bd200000-0000-4000-8000-000000000001"}','[{"item_id":"bd400000-0000-4000-8000-00000000000a","nama":"BP A","qty":10,"harga_beli":110,"satuan":"pcs"}]','Ganti'),'Edit baris');
-- ADMIN yang diberi izin tetap tidak boleh membatalkan PO (Owner saja).
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_penerimaan','pembelian.batalkan_faktur','pembelian.batalkan_pembayaran','pembelian.batalkan_uang_muka']);
select pg_temp.act(2);
select pg_temp.expect_error(format('select revise_purchase_order(%L,%L,(select revision from purchase_orders where id=%L),%L,%L::jsonb,%L::jsonb,%L)','po-v-adm',pg_temp.po(1),pg_temp.po(1),'void','{}','[]','Coba'),'Hanya Super Admin');
select pg_temp.act(1);
-- Batalkan PO: kini diizinkan karena semua dokumen turunan sudah batal.
select revise_purchase_order('po-v1',pg_temp.po(1),(select revision from purchase_orders where id=pg_temp.po(1)),'void','{}','[]','PO salah dibuat') as rv \gset
select pg_temp.ok((select status::text from purchase_orders where id=pg_temp.po(1))='Batal','PO dibatalkan');
select pg_temp.ok((select count(*)=1 and bool_and(voided_at is not null) from purchase_invoices where po_id=pg_temp.po(1)) and (select count(*)=1 from goods_receipts where po_id=pg_temp.po(1)),'riwayat dokumen tetap tersimpan');
select pg_temp.ok(revise_purchase_order('po-v1',pg_temp.po(1),(select revision from purchase_orders where id=pg_temp.po(1))-1,'void','{}','[]','PO salah dibuat')=:'rv'::jsonb,'void idempoten');
select pg_temp.expect_error(format('select receive_purchase_order(%L,%L,%L,5,current_date,null,null,%L)',pg_temp.po(1),'po-r-batal','TB.BP.','[{"id":"'||pg_temp.line(1,1)||'","qty_terima":1}]'),'');
select pg_temp.invariants('06 PO batal');

-- Dokumen aktif tetap menghalangi void: penerimaan aktif, faktur aktif, uang muka aktif, retur aktif.
select pg_temp.recv(2,'po-r2','[{"line":1,"qty":5}]') as r2 \gset
select pg_temp.expect_error(format('select revise_purchase_order(%L,%L,(select revision from purchase_orders where id=%L),%L,%L::jsonb,%L::jsonb,%L)','po-v2',pg_temp.po(2),pg_temp.po(2),'void','{}','[]','Coba'),'PO yang sudah selesai atau batal');
select pg_temp.recv(3,'po-r3','[{"line":1,"qty":2}]') as r3 \gset
select pg_temp.expect_error(format('select revise_purchase_order(%L,%L,(select revision from purchase_orders where id=%L),%L,%L::jsonb,%L::jsonb,%L)','po-v3',pg_temp.po(3),pg_temp.po(3),'void','{}','[]','Coba'),'transaksi turunan yang aktif');
select pg_temp.su();
insert into purchase_returns(id,no_retur,po_id,tanggal,total) values('bd900000-0000-4000-8000-000000000002','RB.BP.6',pg_temp.po(4),current_date,10);
select pg_temp.act(1);
select pg_temp.expect_error(format('select revise_purchase_order(%L,%L,(select revision from purchase_orders where id=%L),%L,%L::jsonb,%L::jsonb,%L)','po-v4',pg_temp.po(4),pg_temp.po(4),'void','{}','[]','Coba'),'transaksi turunan yang aktif');
select pg_temp.su();
update purchase_returns set voided_at=now(),voided_on=current_date where id='bd900000-0000-4000-8000-000000000002';
select pg_temp.act(1);
select revise_purchase_order('po-v4b',pg_temp.po(4),(select revision from purchase_orders where id=pg_temp.po(4)),'void','{}','[]','Retur sudah dibatalkan') is not null as x \gset
select pg_temp.ok((select status::text from purchase_orders where id=pg_temp.po(4))='Batal','retur batal tidak menghalangi void PO');
-- Uang muka aktif menghalangi; sesudah dibatalkan, PO boleh dibatalkan.
select (pay_purchase_advance_atomic('po-um5','UM.BP.',5,'bd300000-0000-4000-8000-000000000001',pg_temp.po(5),current_date,100,'Transfer','bd700000-0000-4000-8000-000000000001',null))->>'advance_id' as adv5 \gset
select pg_temp.expect_error(format('select revise_purchase_order(%L,%L,(select revision from purchase_orders where id=%L),%L,%L::jsonb,%L::jsonb,%L)','po-v5',pg_temp.po(5),pg_temp.po(5),'void','{}','[]','Coba'),'transaksi turunan yang aktif');
select preview_purchase_advance_cascade(:'adv5'::uuid)->>'fingerprint' as fp5 \gset
select cancel_purchase_advance_cascade(:'adv5'::uuid,'Uang muka salah','po-cum5',:'fp5') is not null as x \gset
select revise_purchase_order('po-v5b',pg_temp.po(5),(select revision from purchase_orders where id=pg_temp.po(5)),'void','{}','[]','Uang muka dibatalkan') is not null as x \gset
select pg_temp.ok((select status::text from purchase_orders where id=pg_temp.po(5))='Batal','uang muka batal tidak menghalangi void PO');
select pg_temp.invariants('06 selesai');

-- PO tanpa riwayat apa pun: ganti-total tetap bekerja seperti semula.
select pg_temp.su();
select pg_temp.mkpo(6,1,'[{"item":"c","qty":5,"harga":100}]');
select pg_temp.act(1);
select revise_purchase_order('po-e6',pg_temp.po(6),(select revision from purchase_orders where id=pg_temp.po(6)),'edit','{"to_warehouse_id":"bd200000-0000-4000-8000-000000000001"}',
  '[{"item_id":"bd400000-0000-4000-8000-00000000000d","nama":"BP D","qty":7,"harga_beli":90,"satuan":"pcs"}]','Ganti barang') is not null as x \gset
select pg_temp.ok((select count(*)=1 and min(qty)=7 and min(harga_beli)=90 from purchase_order_items where po_id=pg_temp.po(6)),'PO tanpa riwayat: edit total tetap berfungsi');
