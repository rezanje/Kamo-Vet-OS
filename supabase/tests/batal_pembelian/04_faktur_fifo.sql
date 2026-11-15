-- 04 Faktur: FIFO membolehkan pembatalan faktur selama lapisan faktur masih sama seperti saat faktur dibuat (penjualan yang memakai
-- lapisan LAIN tidak menghalangi); lapisan yang sudah terpakai ditolak; membatalkan penerimaan lain di PO yang sama tidak lagi
-- mengunci faktur. Rata-rata bergerak mempertahankan aturan lama.
select pg_temp.act(1);
-- @AVERAGE_ACTIVATION@
select pg_temp.act(1);
select (select method='moving_average' from inventory_costing_settings where id) as avg \gset
select pg_temp.su();
select pg_temp.mkpo(1,1,'[{"item":"a","qty":5,"harga":100}]');
select pg_temp.mkpo(2,1,'[{"item":"a","qty":10,"harga":100}]');
select pg_temp.act(1);
select pg_temp.recv(1,'ff-r0','[{"line":1,"qty":5}]') as r0 \gset
select pg_temp.age(:'r0'::uuid, interval '4 hour');
select pg_temp.act(1);
select pg_temp.recv(2,'ff-r1','[{"line":1,"qty":10}]') as r1 \gset
select pg_temp.age(:'r1'::uuid, interval '3 hour');
select pg_temp.act(1);
-- Faktur menagih 110 (PO 100): menaikkan nilai lapisan R1.
select pg_temp.inv(2,'ff-inv1','[{"line":1,"qty":10,"harga":110}]',array[:'r1'::uuid]) as inv1 \gset
select pg_temp.invariants('04 setelah faktur');
select pg_temp.su();
-- Penjualan 3 unit SESUDAH faktur: memakai lapisan R0 (lama) saja.
select * from stock_out_fifo('bd200000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-00000000000a',3,'sale','SALE.BP.F1',current_date);
select pg_temp.act(1);
\if :avg
 select pg_temp.expect_error(format('select cancel_purchase_invoice(%L,0,%L,%L)',:'inv1','ff-avg','Faktur salah'),'setelah faktur');
\else
 select pg_temp.digest() as d0 \gset
 select cancel_purchase_invoice(:'inv1'::uuid,0,'ff-ci1','Faktur salah',current_date) as ci1 \gset
 select pg_temp.ok((select voided_at is not null from purchase_invoices where id=:'inv1'::uuid),'FIFO: faktur dibatalkan walau lapisan lama terpakai');
 select pg_temp.ok((select unit_cost from stock_layers where source_ref='PO.BP.2')=100,'FIFO: nilai lapisan R1 kembali ke harga PO');
 select pg_temp.ok((select qty_left from stock_layers where source_ref='PO.BP.1')=2 and (select qty from stock where item_id='bd400000-0000-4000-8000-00000000000a')=12,'FIFO: stok dan lapisan lama tidak berubah');
 select pg_temp.ok(cancel_purchase_invoice(:'inv1'::uuid,0,'ff-ci1','Faktur salah',current_date)=:'ci1'::jsonb,'FIFO: batal faktur idempoten');
 select pg_temp.invariants('04 setelah batal faktur');
 -- Faktur ulang, lalu penjualan yang MEMAKAI lapisan faktur: ditolak, tanpa efek.
 select pg_temp.inv(2,'ff-inv1b','[{"line":1,"qty":10,"harga":110}]',array[:'r1'::uuid]) as inv1b \gset
 select pg_temp.su();
 select * from stock_out_fifo('bd200000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-00000000000a',5,'sale','SALE.BP.F2',current_date);
 select pg_temp.act(1);
 select pg_temp.digest() as d1 \gset
 select pg_temp.expect_error(format('select cancel_purchase_invoice(%L,%L,%L,%L)',:'inv1b',0,'ff-ci2','Faktur salah lagi'),'Stok atau harga sudah berubah setelah faktur');
 select pg_temp.ok(pg_temp.digest()=:'d1','FIFO: faktur yang lapisannya terpakai ditolak tanpa efek');
 select pg_temp.invariants('04 setelah penolakan faktur');

 -- Urutan bebas: batalkan penerimaan LAIN di PO yang sama dulu, lalu faktur penerimaan pertama (dulu terkunci selamanya).
 select pg_temp.su();
 select pg_temp.mkpo(4,1,'[{"item":"b","qty":5,"harga":100}]');
 select pg_temp.act(1);
 select pg_temp.recv(4,'ff-r4a','[{"line":1,"qty":3}]') as r4a \gset
 select pg_temp.age(:'r4a'::uuid, interval '2 hour');
 select pg_temp.act(1);
 select pg_temp.recv(4,'ff-r4b','[{"line":1,"qty":2}]') as r4b \gset
 select pg_temp.age(:'r4b'::uuid, interval '1 hour');
 select pg_temp.act(1);
 select pg_temp.inv(4,'ff-inv4','[{"line":1,"qty":3,"harga":100}]',array[:'r4a'::uuid]) as inv4 \gset
 select pg_temp.diff(:'r4b'::uuid,'04 R4b');
 select pg_temp.diff(:'r4a'::uuid,'04 R4a ditagih');
 select cancel_goods_receipt(:'r4b'::uuid,'ff-c4b','Salah penerimaan kedua',current_date) is not null as x \gset
 select cancel_purchase_invoice(:'inv4'::uuid,0,'ff-ci4','Faktur penerimaan pertama salah',current_date) is not null as x \gset
 select pg_temp.diff(:'r4a'::uuid,'04 R4a setelah faktur batal');
 select cancel_goods_receipt(:'r4a'::uuid,'ff-c4a','Salah penerimaan pertama',current_date) is not null as x \gset
 select pg_temp.ok((select count(*) from stock where item_id='bd400000-0000-4000-8000-00000000000b' and qty<>0)=0,'stok B kembali nol setelah semua batal');
 select pg_temp.invariants('04 urutan bebas');
\endif

-- Catatan pengeluaran sesudah faktur tanpa mengubah lapisan: FIFO tetap bisa dibatalkan, rata-rata bergerak menolak.
select pg_temp.su();
select pg_temp.mkpo(5,1,'[{"item":"d","qty":4,"harga":100}]');
select pg_temp.act(1);
select pg_temp.recv(5,'ff-r5','[{"line":1,"qty":4}]') as r5 \gset
select pg_temp.act(1);
select pg_temp.inv(5,'ff-inv5','[{"line":1,"qty":4,"harga":100}]',array[:'r5'::uuid]) as inv5 \gset
select pg_temp.su();
insert into stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref) values(current_date,'bd200000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-00000000000d',-1,100,'test-pengeluaran','HANTU.BP5');
select pg_temp.act(1);
\if :avg
 select pg_temp.expect_error(format('select cancel_purchase_invoice(%L,0,%L,%L)',:'inv5','ff-ghost','Coba'),'Barang sudah dipakai setelah faktur');
\else
 select cancel_purchase_invoice(:'inv5'::uuid,0,'ff-ghost','Faktur salah',current_date) is not null as x \gset
 select pg_temp.ok((select voided_at is not null from purchase_invoices where id=:'inv5'::uuid),'FIFO: faktur dibatalkan walau ada catatan pengeluaran tanpa lapisan');
\endif
