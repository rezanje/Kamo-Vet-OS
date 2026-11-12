-- 03 Konsistensi FIFO dengan tanggal efektif: penjualan SESUDAH tanggal pilihan tidak boleh berubah nilainya.
--  A. batal penerimaan: hanya bila lapisan penerimaan utuh; penjualan yang memakai lapisan LAIN tidak terganggu (HPP persis sama);
--     lapisan yang dipakai penjualan ditolak dengan penjelasan menyebut penjualannya.
--  B. penerimaan PENGGANTI bertanggal mundur ditolak bila lapisan yang lebih baru sudah terpakai (urutan FIFO akan berubah).
--  C. urutan FEFO (exp_date) ikut diperhitungkan.
select pg_temp.su();
select pg_temp.mkpo(1,1,'[{"item":"c","qty":5,"harga":100}]');
select pg_temp.mkpo(2,1,'[{"item":"c","qty":10,"harga":120}]');
select pg_temp.mkpo(3,1,'[{"item":"c","qty":4,"harga":150}]');
select pg_temp.act(1);
select pg_temp.recv_at(1,'ff-ra','[{"line":1,"qty":5}]',current_date-10) as ra \gset
select pg_temp.recv_at(2,'ff-rb','[{"line":1,"qty":10}]',current_date-6) as rb \gset
select pg_temp.recv_at(3,'ff-rc','[{"line":1,"qty":4}]',current_date-3) as rc \gset
select pg_temp.su();
-- S1 memakai lapisan lama (ra) saja; S2 melewati ra ke rb.
select * from stock_out_fifo('bd200000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-00000000000c',3,'sale','SALE.BD.1',current_date-2);
select * from stock_out_fifo('bd200000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-00000000000c',4,'sale','SALE.BD.2',current_date-1);
select pg_temp.ok((select qty_left from stock_layers where source_ref='PO.BP.1')=0 and (select qty_left from stock_layers where source_ref='PO.BP.2')=8 and (select qty_left from stock_layers where source_ref='PO.BP.3')=4,'penjualan memakai ra lalu rb; rc utuh');
select md5(string_agg(m.source_ref||':'||m.tanggal||':'||m.qty||':'||round(m.unit_cost,6)||':'||coalesce(m.fifo_takes::text,''),'|' order by m.source_ref)) as sales0 from stock_moves m where m.source='sale' \gset
select pg_temp.act(1);
-- A1: rb sebagian terpakai oleh S2: ditolak pada tanggal aslinya DAN hari ini, dengan penjelasan memuat penjualannya; tanpa efek.
select pg_temp.digest() as d0 \gset
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date-6)',:'rb','ff-a1','Coba'),'sudah terpakai atau keluar dari gudang');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date-6)',:'rb','ff-a2','Coba'),'Yang memakainya');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date-6)',:'rb','ff-a3','Coba'),'SALE.BD.2');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date)',:'rb','ff-a4','Coba'),'SALE.BD.2');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date-6)',:'ra','ff-a5','Coba'),'SALE.BD.1');
select pg_temp.ok(pg_temp.digest()=:'d0' and pg_temp.n_audit()=0,'ditolak: tanpa efek dan tanpa bukti');
select pg_temp.ok((preview_goods_receipt_cancellation(:'rb'::uuid,current_date-6)#>>'{blockers,0,code}')='barang_terpakai','pratinjau: barang terpakai pada tanggal aslinya');
select pg_temp.diff(:'rb'::uuid,'03 rb terpakai');
-- A2: rc utuh: dibatalkan pada tanggal asli (-3, SEBELUM penjualan S1/S2 bertanggal -2/-1), nilai penjualan tidak berubah sama sekali.
select pg_temp.ok((preview_goods_receipt_cancellation(:'rc'::uuid,current_date-3)->>'can_cancel')::boolean,'pratinjau rc: bisa pada tanggal asli');
select pg_temp.diff(:'rc'::uuid,'03 rc utuh');
select cancel_goods_receipt(:'rc'::uuid,'ff-ok1','Salah terima',current_date-3) is not null as x \gset
select pg_temp.su();
select pg_temp.ok((select md5(string_agg(m.source_ref||':'||m.tanggal||':'||m.qty||':'||round(m.unit_cost,6)||':'||coalesce(m.fifo_takes::text,''),'|' order by m.source_ref)) from stock_moves m where m.source='sale')=:'sales0','HPP dan lapisan yang dipakai penjualan setelah tanggal pilihan: persis sama');
select pg_temp.ok((select qty_left from stock_layers where source_ref='PO.BP.1')=0 and (select qty_left from stock_layers where source_ref='PO.BP.2')=8 and (select qty_left from stock_layers where source_ref='PO.BP.3')=0,'lapisan lain tidak berubah; rc nol');
select pg_temp.stock_card_ok('03 A');select pg_temp.tb_zero('03 A');select pg_temp.invariants('03 A');

-- B. Penerimaan pengganti bertanggal mundur. PO4: rbd (-6, 10 unit) lalu S3 (-4) memakai 3 unit. PO5: penerimaan A bertanggal -10 dicatat
--    SESUDAH penjualan (penerimaan biasa bertanggal mundur, tidak dibatasi aturan baru), lalu dibatalkan; penggantinya pada -10 harus ditolak.
select pg_temp.mkpo(4,1,'[{"item":"d","qty":10,"harga":120}]');
select pg_temp.mkpo(5,1,'[{"item":"d","qty":5,"harga":100}]');
select pg_temp.act(1);
select pg_temp.recv_at(4,'ff-rbd','[{"line":1,"qty":10}]',current_date-6) as rbd \gset
select pg_temp.su();
select * from stock_out_fifo('bd200000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-00000000000d',3,'sale','SALE.BD.3',current_date-4);
select pg_temp.act(1);
select pg_temp.recv_at(5,'ff-ra5','[{"line":1,"qty":5}]',current_date-10) as a5 \gset
select pg_temp.ok((select count(*)=0 from goods_receipts g where g.po_id=pg_temp.po(5) and g.voided_at is not null),'penerimaan biasa: belum ada pembatalan, tidak ada aturan baru');
select cancel_goods_receipt(:'a5'::uuid,'ff-ca5','Salah input',current_date-10) is not null as x \gset
select pg_temp.su();
select pg_temp.ok((select status::text from purchase_orders where id=pg_temp.po(5))='Dipesan','PO5 dibuka lagi');
select md5(string_agg(m.source_ref||':'||m.tanggal||':'||m.qty||':'||round(m.unit_cost,6)||':'||coalesce(m.fifo_takes::text,''),'|' order by m.source_ref)) as sales1 from stock_moves m where m.source='sale' \gset
select pg_temp.act(1);
select pg_temp.digest() as d1 \gset
-- tanpa alasan: ditolak lebih dulu; dengan alasan: ditolak karena lapisan lebih baru sudah terpakai (3 unit).
select pg_temp.expect_error('select pg_temp.recv_at(5,''ff-b1'',''[{"line":1,"qty":2}]'',current_date-10)','Alasan wajib diisi');
select pg_temp.expect_error(format('select pg_temp.recv_note(5,%L,%L::jsonb,current_date-10,%L)','ff-b2','[{"line":1,"qty":2}]','Terima ulang tanggal asli'),'tidak bisa dipakai');
select pg_temp.expect_error(format('select pg_temp.recv_note(5,%L,%L::jsonb,current_date-10,%L)','ff-b3','[{"line":1,"qty":2}]','Terima ulang tanggal asli'),'sudah terpakai 3');
select pg_temp.expect_error(format('select pg_temp.recv_note(5,%L,%L::jsonb,current_date-10,%L)','ff-b4','[{"line":1,"qty":2}]','Terima ulang tanggal asli'),'HPP yang sudah tercatat');
select pg_temp.expect_error(format('select pg_temp.recv_note(5,%L,%L::jsonb,current_date-7,%L)','ff-b5','[{"line":1,"qty":2}]','Terima ulang'),'tidak bisa dipakai');
select pg_temp.expect_error(format('select pg_temp.recv_note(5,%L,%L::jsonb,current_date+1,%L)','ff-b6','[{"line":1,"qty":2}]','Terima ulang'),'masa depan');
select pg_temp.expect_error(format('select pg_temp.recv_note(5,%L,%L::jsonb,current_date-11,%L)','ff-b7','[{"line":1,"qty":2}]','Terima ulang'),'sebelum tanggal penerimaan yang dibatalkan');
select pg_temp.ok(pg_temp.digest()=:'d1' and pg_temp.n_audit()=2,'penerimaan pengganti ditolak: tanpa efek (bukti hanya dua pembatalan awal)');
-- Tanggal sama dengan lapisan yang terpakai (-6) tidak menyalip urutan (lapisan baru dibuat belakangan): boleh.
select pg_temp.recv_note(5,'ff-ok2','[{"line":1,"qty":2}]',current_date-6,'Terima ulang pada tanggal lapisan terakhir') as a5b \gset
select pg_temp.su();
select pg_temp.ok((select tanggal=current_date-6 and qty_in=2 and qty_left=2 from stock_layers where source_ref='PO.BP.5' and qty_in=2),'lapisan pengganti bertanggal efektif');
select pg_temp.ok((select md5(string_agg(m.source_ref||':'||m.tanggal||':'||m.qty||':'||round(m.unit_cost,6)||':'||coalesce(m.fifo_takes::text,''),'|' order by m.source_ref)) from stock_moves m where m.source='sale')=:'sales1','penjualan lama tidak berubah oleh penerimaan pengganti');
select pg_temp.ok((select count(*)=1 from purchase_backdate_audit where kind='receipt-replace' and doc_id=:'a5b'::uuid and effective_date=current_date-6 and doc_date=current_date-10 and days_back=6 and reason like 'Terima ulang pada%'),'bukti penerimaan pengganti');
-- Hari ini: bukan tanggal mundur, tidak perlu izin atau alasan, tidak diperiksa urutan.
select pg_temp.act(1);
select pg_temp.recv_at(5,'ff-ok3','[{"line":1,"qty":3}]',current_date) is not null as x \gset
select pg_temp.stock_card_ok('03 B');select pg_temp.tb_zero('03 B');select pg_temp.invariants('03 B');

-- C. FEFO: X (-8, exp +200 hari) dipakai 2 unit oleh S4 (-5). Y (-9, tanpa exp) dibatalkan; pengganti Y' pada -9:
--    exp +100 hari mendahului X => ditolak; exp +300 hari atau tanpa exp sesudah X => boleh.
select pg_temp.su();
select pg_temp.mkpo(6,1,'[{"item":"b","qty":5,"harga":100}]');
select pg_temp.mkpo(7,1,'[{"item":"b","qty":5,"harga":90}]');
select pg_temp.act(1);
select receive_purchase_order(pg_temp.po(6),'ff-x','TB.BP.',5,current_date-8,null,null,jsonb_build_array(jsonb_build_object('id',pg_temp.line(6,1),'qty_terima',5,'exp_date',(current_date+200)::text)))->>'receipt_id' as x6 \gset
select pg_temp.su();
select * from stock_out_fifo('bd200000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-00000000000b',2,'sale','SALE.BD.4',current_date-5);
select pg_temp.act(1);
select pg_temp.recv_at(7,'ff-y','[{"line":1,"qty":5}]',current_date-9) as y7 \gset
select cancel_goods_receipt(:'y7'::uuid,'ff-cy','Salah input',current_date-9) is not null as x \gset
select pg_temp.digest() as d2 \gset
select pg_temp.expect_error(format('select receive_purchase_order(pg_temp.po(7),%L,%L,5,current_date-9,null,%L,jsonb_build_array(jsonb_build_object(%L,pg_temp.line(7,1),%L,2,%L,(current_date+100)::text)))','ff-c1','TB.BP.','Terima ulang exp awal','id','qty_terima','exp_date'),'tidak bisa dipakai');
select pg_temp.ok(pg_temp.digest()=:'d2','FEFO: exp lebih awal dari lapisan terpakai: ditolak tanpa efek');
select receive_purchase_order(pg_temp.po(7),'ff-c2','TB.BP.',5,current_date-9,null,'Terima ulang exp lebih akhir',jsonb_build_array(jsonb_build_object('id',pg_temp.line(7,1),'qty_terima',2,'exp_date',(current_date+300)::text)))->>'receipt_id' is not null as x \gset
select receive_purchase_order(pg_temp.po(7),'ff-c3','TB.BP.',5,current_date-9,null,'Terima ulang tanpa exp',jsonb_build_array(jsonb_build_object('id',pg_temp.line(7,1),'qty_terima',3)))->>'receipt_id' is not null as x \gset
select pg_temp.stock_card_ok('03 C');select pg_temp.tb_zero('03 C');select pg_temp.invariants('03 C');
