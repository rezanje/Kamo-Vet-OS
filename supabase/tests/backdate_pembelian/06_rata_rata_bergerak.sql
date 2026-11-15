-- @AVERAGE_ONLY@
-- 06 Rata-rata bergerak: aturan lama dipertahankan dan riwayat harus berurutan. Pembatalan/penerimaan pengganti bertanggal lebih lama dari
-- mutasi terakhir barang ditolak dengan penjelasan (bukan pesan teknis), tanpa efek; tanggal yang tidak mendahului riwayat boleh.
select pg_temp.act(1);
-- @AVERAGE_ACTIVATION@
select pg_temp.act(1);
select pg_temp.ok((select method='moving_average' from inventory_costing_settings where id),'metode rata-rata aktif');
select pg_temp.su();
select pg_temp.mkpo(1,1,'[{"item":"c","qty":5,"harga":100}]');
select pg_temp.mkpo(2,1,'[{"item":"c","qty":10,"harga":120}]');
select pg_temp.mkpo(3,1,'[{"item":"c","qty":4,"harga":150}]');
select pg_temp.mkpo(4,1,'[{"item":"c","qty":3,"harga":100}]');
select pg_temp.act(1);
select pg_temp.recv_at(1,'av-ra','[{"line":1,"qty":5}]',current_date-10) as ra \gset
select cancel_goods_receipt(:'ra'::uuid,'av-ca','Salah terima',current_date-10) is not null as x \gset
select pg_temp.recv_at(2,'av-rb','[{"line":1,"qty":10}]',current_date-6) as rb \gset
select pg_temp.recv_at(3,'av-rc','[{"line":1,"qty":4}]',current_date-3) as rc \gset
select pg_temp.su();
select * from stock_out_fifo('bd200000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-00000000000c',3,'sale','SALE.AV.1',current_date-2);
select pg_temp.act(1);
select pg_temp.digest() as d0 \gset
-- rb: ada pergerakan sesudahnya: ditolak pada tanggal asli (penjelasan rata-rata) dan hari ini (aturan lama: barang keluar).
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date-6)',:'rb','av-x1','Coba'),'rata-rata bergerak');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date-6)',:'rb','av-x1b','Coba'),'SALE.AV.1');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date)',:'rb','av-x2','Coba'),'sudah terpakai atau keluar dari gudang');
-- ra': pengganti pada -10, -6, -3 mendahului pergerakan terakhir (penjualan -2): ditolak; pada -2 dan hari ini boleh.
select pg_temp.expect_error(format('select pg_temp.recv_note(1,%L,%L::jsonb,current_date-10,%L)','av-r1','[{"line":1,"qty":2}]','Terima ulang'),'rata-rata bergerak');
select pg_temp.expect_error(format('select pg_temp.recv_note(1,%L,%L::jsonb,current_date-6,%L)','av-r2','[{"line":1,"qty":2}]','Terima ulang'),'SALE.AV.1');
select pg_temp.expect_error(format('select pg_temp.recv_note(1,%L,%L::jsonb,current_date-3,%L)','av-r3','[{"line":1,"qty":2}]','Terima ulang'),'Pakai tanggal');
select pg_temp.ok(pg_temp.digest()=:'d0','rata-rata: penolakan tanpa efek');
select pg_temp.recv_note(1,'av-ok','[{"line":1,"qty":2}]',current_date-2,'Terima ulang di tanggal penjualan') is not null as x \gset
-- Faktur langsung (rata-rata): dibatalkan pada tanggalnya sendiri padahal barang sudah bergerak sesudahnya: ditolak dengan penjelasan rata-rata.
select create_direct_purchase_invoice('av-d1',jsonb_build_object('supplier_id','bd300000-0000-4000-8000-000000000001','warehouse_id','bd200000-0000-4000-8000-000000000001','tanggal',(current_date-2)::text,'jatuh_tempo',(current_date+30)::text,
 'no_faktur_pemasok','SUP-AV','surat_jalan','SJ-AV','keterangan','Faktur langsung','lampiran','[]'::jsonb,'items',jsonb_build_array(jsonb_build_object('item_id','bd400000-0000-4000-8000-00000000000c','qty',2,'harga',100,'satuan','pcs'))))->>'invoice_id' as avd \gset
select pg_temp.recv_at(1,'av-ok2','[{"line":1,"qty":3}]',current_date) is not null as x \gset
select pg_temp.recv_at(4,'av-ok3','[{"line":1,"qty":1}]',current_date) is not null as x \gset
select pg_temp.digest() as d1 \gset
select pg_temp.expect_error(format('select cancel_purchase_invoice(%L,0,%L,%L,current_date-2)',:'avd','av-di1','Salah faktur'),'rata-rata bergerak');
select pg_temp.ok(pg_temp.digest()=:'d1','faktur langsung rata-rata ditolak: tanpa efek');
select pg_temp.stock_card_ok('06 akhir');select pg_temp.tb_zero('06 akhir');
