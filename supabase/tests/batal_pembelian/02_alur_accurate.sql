-- 02 Alur Accurate penuh: batal pembayaran -> faktur kembali belum dibayar; batal faktur; batal penerimaan (sebagian);
-- ubah PO; terima lagi; faktur lagi. Neraca saldo nol, lapisan FIFO konsisten, uang muka & hutang kembali, idempoten.
select pg_temp.su();
select pg_temp.mkpo(1,1,'[{"item":"a","qty":10,"harga":100},{"item":"b","qty":10,"harga":200}]');
select pg_temp.act(1);
-- Uang muka 200 untuk PO ini (dari bank).
select (pay_purchase_advance_atomic('al-um','UM.BP.',5,'bd300000-0000-4000-8000-000000000001',pg_temp.po(1),current_date,200,'Transfer','bd700000-0000-4000-8000-000000000001',null))->>'advance_id' as adv \gset
select pg_temp.recv(1,'al-r1','[{"line":1,"qty":6},{"line":2,"qty":4}]') as r1 \gset
select pg_temp.age(:'r1'::uuid, interval '3 hour');
select pg_temp.act(1);
select pg_temp.recv(1,'al-r2','[{"line":1,"qty":4},{"line":2,"qty":6}]') as r2 \gset
select pg_temp.age(:'r2'::uuid, interval '2 hour');
select pg_temp.act(1);
select pg_temp.ok((select status::text from purchase_orders where id=pg_temp.po(1))='Diterima','PO lengkap setelah dua penerimaan');
select pg_temp.invariants('02 setelah terima');
-- Faktur hanya untuk penerimaan 1: A 6 x 100 + B 4 x 200 = 1400.
select pg_temp.inv(1,'al-inv1','[{"line":1,"qty":6,"harga":100},{"line":2,"qty":4,"harga":200}]',array[:'r1'::uuid]) as inv \gset
select pg_temp.ok((select total from purchase_invoices where id=:'inv'::uuid)=1400,'faktur 1400');
-- Dua pembayaran: transfer 500, lalu 400 (200 dari uang muka + 200 transfer).
select (pay_purchase_invoice_atomic('al-pay1',:'inv'::uuid,current_date,500,'Transfer',null,'bd700000-0000-4000-8000-000000000001',null))->>'payment_id' as pay1 \gset
select (pay_purchase_invoice_atomic('al-pay2',:'inv'::uuid,current_date,400,'Transfer',null,'bd700000-0000-4000-8000-000000000001',:'adv'::uuid))->>'payment_id' as pay2 \gset
select pg_temp.ok((select terpakai from purchase_advances where id=:'adv'::uuid)=200,'uang muka terpakai 200');
select pg_temp.invariants('02 setelah bayar');
select pg_temp.su();
select sum(credit-debit)::text as ap_after_pay from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='311001' \gset
select pg_temp.ok(:'ap_after_pay'::numeric=1400-900,'hutang 500 setelah bayar 900');

-- Penolakan berantai: tiap penolakan tidak meninggalkan efek, dan pratinjau menyebut persis langkah berikutnya.
select pg_temp.act(1);
select pg_temp.digest() as d0 \gset
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'r1','al-x1','Salah input'),'sudah ditagih di faktur pembelian aktif');
select pg_temp.expect_error(format('select cancel_purchase_invoice(%L,0,%L,%L)',:'inv','al-x2','Salah faktur'),'Balikkan seluruh pembayaran');
select pg_temp.ok(pg_temp.digest()=:'d0','penolakan tidak mengubah apa pun');
select pg_temp.act(1);
select preview_goods_receipt_cancellation(:'r1'::uuid) as pv \gset
select pg_temp.ok(not (:'pv'::jsonb->>'can_cancel')::boolean,'pratinjau: tidak bisa dibatalkan');
select pg_temp.ok(:'pv'::jsonb#>>'{blockers,0,code}'='faktur_aktif' and (:'pv'::jsonb#>>'{blockers,0,paid}')::numeric=900 and :'pv'::jsonb#>>'{blockers,0,docs,0,id}'=:'inv','pratinjau menyebut faktur aktif, nilai terbayar dan dokumennya');
select pg_temp.ok((:'pv'::jsonb#>>'{blockers,0,message}') like '%Batalkan pembayarannya dulu%','pratinjau: bahasa biasa, bayar dulu');
-- R2 tidak ditagih faktur itu: bisa dibatalkan kapan saja (alasan ada).
select pg_temp.ok((preview_goods_receipt_cancellation(:'r2'::uuid)->>'can_cancel')::boolean,'pratinjau R2: bisa dibatalkan');

-- 1) Batal pembayaran #2 (porsi uang muka): uang muka kembali, pembayaran #1 utuh. Idempoten.
select cancel_purchase_payment(:'pay2'::uuid,0,'al-cp2','Salah uang muka') as c2 \gset
select pg_temp.ok((select terpakai from purchase_advances where id=:'adv'::uuid)=0,'uang muka kembali penuh');
select pg_temp.ok(cancel_purchase_payment(:'pay2'::uuid,0,'al-cp2','Salah uang muka')=:'c2'::jsonb,'ulang kunci sama = hasil sama');
select pg_temp.expect_error(format('select cancel_purchase_payment(%L,0,%L,%L)',:'pay2','al-cp2','Alasan lain'),'rincian berbeda');
select pg_temp.ok((select sum(amount) from purchase_invoice_payments where invoice_id=:'inv'::uuid)=500,'pembayaran #1 tidak tersentuh');
select cancel_purchase_payment(:'pay1'::uuid,0,'al-cp1','Salah transfer') as c1 \gset
select pg_temp.ok((select coalesce(sum(amount),0) from purchase_invoice_payments where invoice_id=:'inv'::uuid)=0,'faktur kembali belum dibayar (neto 0)');
select pg_temp.ok((select count(*) from purchase_invoice_payments where invoice_id=:'inv'::uuid)=4,'pembayaran asli + pembalik tetap tersimpan (4 baris)');
select pg_temp.invariants('02 setelah batal bayar');
select pg_temp.su();
select sum(credit-debit)::text as ap2 from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='311001' \gset
select pg_temp.ok(:'ap2'::numeric=1400,'hutang kembali penuh 1400');
select pg_temp.ok((select coalesce(sum(debit-credit),0) from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='110209')=-200,'kas bank hanya berkurang uang muka 200 (pembayaran dibalik)');

-- 2) Batal faktur; lalu 3) batal penerimaan 1 (R2 tetap), sebagian.
select pg_temp.act(1);
select cancel_purchase_invoice(:'inv'::uuid,0,'al-ci','Faktur salah',current_date) as ci \gset
select pg_temp.ok((select voided_at is not null from purchase_invoices where id=:'inv'::uuid),'faktur dibatalkan, dokumen tetap');
select pg_temp.ok((cancel_purchase_invoice(:'inv'::uuid,0,'al-ci','Faktur salah',current_date))=:'ci'::jsonb,'batal faktur idempoten');
select pg_temp.ok((preview_goods_receipt_cancellation(:'r1'::uuid)->>'can_cancel')::boolean,'pratinjau R1: kini bisa dibatalkan');
select pg_temp.digest() as before_r1 \gset
select cancel_goods_receipt(:'r1'::uuid,'al-cr1','Salah jumlah',current_date) as cr1 \gset
select pg_temp.ok((select coalesce(qty_terima,0) from purchase_order_items where id=pg_temp.line(1,1))=4 and (select coalesce(qty_terima,0) from purchase_order_items where id=pg_temp.line(1,2))=6,'qty terima PO tinggal milik R2');
select pg_temp.ok((select status::text from purchase_orders where id=pg_temp.po(1))='Dipesan','PO kembali Dipesan (belum lengkap)');
select pg_temp.ok((select qty from stock where item_id='bd400000-0000-4000-8000-00000000000a')=4 and (select qty from stock where item_id='bd400000-0000-4000-8000-00000000000b')=6,'stok tinggal R2');
select pg_temp.ok(cancel_goods_receipt(:'r1'::uuid,'al-cr1','Salah jumlah',current_date)=:'cr1'::jsonb,'batal penerimaan idempoten');
select pg_temp.ok((cancel_goods_receipt(:'r1'::uuid,'al-cr1b','klik kedua',current_date)->>'already_cancelled')::boolean,'kunci lain: sudah dibatalkan, tanpa efek kedua');
select pg_temp.ok((select count(*) from purchase_receipt_cancellations)=1,'satu bukti pembatalan');
select pg_temp.invariants('02 setelah batal R1');

-- 4) Terima sisa, lalu batalkan R2 juga; ubah PO (harga) lewat koreksi baris; terima lagi; faktur lagi; bayar lunas.
select pg_temp.act(1);
select pg_temp.recv(1,'al-r3','[{"line":1,"qty":6},{"line":2,"qty":4}]') as r3 \gset
select pg_temp.ok((select status::text from purchase_orders where id=pg_temp.po(1))='Diterima','terima ulang melengkapi PO');
select cancel_goods_receipt(:'r2'::uuid,'al-cr2','Salah jumlah lagi',current_date) is not null as x \gset
select cancel_goods_receipt(:'r3'::uuid,'al-cr3','Ganti harga',current_date) is not null as x \gset
select pg_temp.ok((select count(*) from stock where qty<>0)=0,'semua stok kembali nol');
select pg_temp.ok((select count(*) from stock_layers where qty_left<>0)=0,'semua lapisan nol');
select pg_temp.ok((select count(*) from stock_layers)=6,'lapisan asal tetap tersimpan sebagai riwayat');
select pg_temp.invariants('02 semua penerimaan batal');
select preview_purchase_order_line_correction(pg_temp.line(1,1),10,0,110,current_date) as pre \gset
select correct_purchase_order_line('al-corr-0001',pg_temp.line(1,1),(select revision from purchase_orders where id=pg_temp.po(1)),10,0,110,current_date,'Harga PO naik',:'pre'::jsonb) is not null as x \gset
select pg_temp.ok((select harga_beli from purchase_order_items where id=pg_temp.line(1,1))=110,'harga PO diubah lewat koreksi baris');
select pg_temp.recv(1,'al-r4','[{"line":1,"qty":10},{"line":2,"qty":10}]') as r4 \gset
select pg_temp.inv(1,'al-inv2','[{"line":1,"qty":10,"harga":110},{"line":2,"qty":10,"harga":200}]',array[:'r4'::uuid]) as inv2 \gset
select pay_purchase_invoice_atomic('al-pay3',:'inv2'::uuid,current_date,3100,'Transfer',null,'bd700000-0000-4000-8000-000000000001',null) is not null as x \gset
select pg_temp.ok((select qty from stock where item_id='bd400000-0000-4000-8000-00000000000a')=10 and (select qty from stock where item_id='bd400000-0000-4000-8000-00000000000b')=10,'stok setelah terima ulang');
select pg_temp.ok((select total from purchase_invoices where id=:'inv2'::uuid)=3100,'faktur kedua 3100');
select pg_temp.invariants('02 selesai');
select pg_temp.su();
select pg_temp.ok((select sum(l.credit-l.debit) from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='311001')=0,'hutang lunas 0 di akhir');
select pg_temp.ok((select count(*) from journal_entries where source in ('purchase-receipt-void','purchase-invoice-void','purchase-pay-void'))=3+1+2,'jurnal pembalik: 3 penerimaan + 1 faktur + 2 pembayaran');
-- Dokumen asli tidak pernah dihapus.
select pg_temp.ok((select count(*) from goods_receipts)=4 and (select count(*) from goods_receipts where voided_at is not null)=3,'4 penerimaan tersimpan, 3 dibatalkan');
select pg_temp.expect_error('delete from purchase_receipt_cancellations','Bukti pembatalan penerimaan');
select pg_temp.expect_error('update purchase_receipt_cancellations set reason=''x''','Bukti pembatalan penerimaan');
