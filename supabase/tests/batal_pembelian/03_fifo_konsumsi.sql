-- 03 Konsumsi stok: FIFO membatalkan penerimaan yang lapisannya masih utuh walau lapisan LAMA terpakai; yang sudah terpakai ditolak tanpa
-- efek dan tanpa stok minus; rata-rata bergerak mempertahankan aturan lama (ada barang keluar sesudahnya = ditolak).
select pg_temp.act(1);
-- @AVERAGE_ACTIVATION@
select pg_temp.act(1);
select (select method='moving_average' from inventory_costing_settings where id) as avg \gset
select pg_temp.su();
select pg_temp.mkpo(1,1,'[{"item":"c","qty":5,"harga":100}]');
select pg_temp.mkpo(2,1,'[{"item":"c","qty":10,"harga":120}]');
select pg_temp.act(1);
select pg_temp.recv(1,'fc-ra','[{"line":1,"qty":5}]') as ra \gset
select pg_temp.age(:'ra'::uuid, interval '3 hour');
select pg_temp.act(1);
select pg_temp.recv(2,'fc-rb','[{"line":1,"qty":10}]') as rb \gset
select pg_temp.age(:'rb'::uuid, interval '2 hour');
select pg_temp.su();
-- Penjualan 3 unit: memakai lapisan LAMA (Ra) saja.
select * from stock_out_fifo('bd200000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-00000000000c',3,'sale','SALE.BP.1',current_date);
select pg_temp.ok((select qty_left from stock_layers where source_ref='PO.BP.1')=2 and (select qty_left from stock_layers where source_ref='PO.BP.2')=10 or :'avg'::boolean,'penjualan memakai lapisan lama saja (FIFO)');
select pg_temp.act(1);
select pg_temp.invariants('03 setelah penjualan');
-- Pratinjau penerimaan baru (Rb): FIFO = bisa; rata-rata = barang keluar sesudahnya (aturan lama) = tidak.
select preview_goods_receipt_cancellation(:'rb'::uuid) as pvb \gset
select pg_temp.ok((:'pvb'::jsonb->>'can_cancel')::boolean = not :'avg'::boolean,'pratinjau Rb sesuai metode (FIFO bisa, rata-rata tidak)');
select pg_temp.diff(:'rb'::uuid,'03 Rb sebelum');
-- Penerimaan lama (Ra) sebagian terpakai: ditolak di KEDUA metode; pratinjau menyebut jumlah terpakai dan dokumen pemakai.
select preview_goods_receipt_cancellation(:'ra'::uuid) as pva \gset
select pg_temp.ok(not (:'pva'::jsonb->>'can_cancel')::boolean and :'pva'::jsonb#>>'{blockers,0,code}'='barang_terpakai','pratinjau Ra: barang terpakai');
select pg_temp.ok((:'pva'::jsonb#>>'{blockers,0,items,0,qty_terpakai}')::numeric=3 or :'avg'::boolean,'pratinjau Ra: 3 unit terpakai (FIFO)');
select pg_temp.ok(:'pva'::jsonb#>>'{blockers,0,keluar,0,source_ref}'='SALE.BP.1','pratinjau Ra: dokumen pemakai disebut');
select pg_temp.ok((:'pva'::jsonb#>>'{blockers,0,message}') like '%tidak akan pernah dibuat minus%','pesan: stok tidak dibuat minus diam-diam');
select pg_temp.diff(:'ra'::uuid,'03 Ra terpakai');
select pg_temp.digest() as d0 \gset
select pg_temp.act(1);
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'ra','fc-x1','Coba'),'sudah terpakai atau keluar dari gudang');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'ra','fc-x1b','Coba'),'Batalkan dulu transaksi yang memakainya');
select pg_temp.ok(pg_temp.digest()=:'d0','penolakan Ra tanpa efek');
\if :avg
 -- Rata-rata bergerak: aturan lama utuh (ada barang keluar sesudahnya = ditolak), tanpa efek.
 select pg_temp.act(1);
 select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'rb','fc-avg-rb','Coba'),'sudah terpakai atau keluar dari gudang');
 select pg_temp.ok(pg_temp.digest()=:'d0','rata-rata: penolakan Rb tanpa efek');
\else
 -- FIFO: Rb dibatalkan; lapisan Rb nol, Ra tetap 2; stok 2; penjualan berikutnya memakai Ra pada harga Ra.
 select pg_temp.act(1);
 select cancel_goods_receipt(:'rb'::uuid,'fc-cancel-rb','Jumlah salah',current_date) as cb \gset
 select pg_temp.ok((select qty_left from stock_layers where source_ref='PO.BP.2')=0 and (select qty_left from stock_layers where source_ref='PO.BP.1')=2,'FIFO: lapisan Rb nol, Ra tetap 2');
 select pg_temp.ok((select qty from stock where item_id='bd400000-0000-4000-8000-00000000000c')=2,'FIFO: stok 2 (tidak minus)');
 select pg_temp.ok((select count(*)=1 and min(unit_cost)=120 and sum(qty)=-10 from stock_moves where source='purchase-receipt-void'),'FIFO: satu mutan pembalik pada harga asal Rb');
 select pg_temp.ok(cancel_goods_receipt(:'rb'::uuid,'fc-cancel-rb','Jumlah salah',current_date)=:'cb'::jsonb,'FIFO: idempoten');
 select pg_temp.invariants('03 setelah batal Rb');
 select pg_temp.su();
 select harga_beli::text as hpp from stock_out_fifo('bd200000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-00000000000c',2,'sale','SALE.BP.2',current_date) \gset
 select pg_temp.ok(:'hpp'::numeric=100,'FIFO: penjualan berikutnya memakai harga lapisan Ra (100), bukan Rb yang dibatalkan');
 select pg_temp.invariants('03 setelah penjualan lanjutan');
\endif

-- Stok minus: penerimaan yang menutup stok minus tidak boleh dibatalkan (akan membuat minus lagi); tanpa efek dan stok tidak minus baru.
select pg_temp.act(1);
select pg_temp.su();
select pg_temp.mkpo(3,1,'[{"item":"d","qty":5,"harga":50}]');
update items set buy_price=40 where id='bd400000-0000-4000-8000-00000000000d';
select * from stock_out_fifo('bd200000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-00000000000d',2,'sale','SALE.BP.NEG',current_date);
select pg_temp.act(1);
select pg_temp.recv(3,'fc-rd','[{"line":1,"qty":5}]') as rd \gset
select pg_temp.diff(:'rd'::uuid,'03 menutup stok minus');
select pg_temp.digest() as d1 \gset
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'rd','fc-neg','Coba'),'sudah terpakai atau keluar dari gudang');
select pg_temp.ok(pg_temp.digest()=:'d1','penerimaan penutup minus: ditolak tanpa efek');
select pg_temp.ok((select qty from stock where item_id='bd400000-0000-4000-8000-00000000000d')=3,'stok D tetap 3 (tidak dikurangi, tidak minus)');

-- Catatan pengeluaran tanpa menyentuh lapisan (mis. mutasi pencatatan) sesudah penerimaan: FIFO memeriksa lapisan (utuh = aman),
-- rata-rata bergerak tetap menolak (aturan lama).
select pg_temp.su();
select pg_temp.mkpo(4,1,'[{"item":"b","qty":5,"harga":100}]');
select pg_temp.act(1);
select pg_temp.recv(4,'fc-rg','[{"line":1,"qty":5}]') as rg \gset
select pg_temp.su();
insert into stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref) values(current_date,'bd200000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-00000000000b',-1,100,'test-pengeluaran','HANTU.BP');
select pg_temp.act(1);
select pg_temp.diff(:'rg'::uuid,'03 pengeluaran tercatat tanpa lapisan');
\if :avg
 select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'rg','fc-ghost','Coba'),'sudah terpakai atau keluar dari gudang');
\else
 select cancel_goods_receipt(:'rg'::uuid,'fc-ghost','Salah jumlah',current_date) is not null as x \gset
 select pg_temp.ok((select qty_left from stock_layers where source_ref='PO.BP.4')=0,'FIFO: lapisan utuh dibatalkan walau ada catatan pengeluaran');
\endif
