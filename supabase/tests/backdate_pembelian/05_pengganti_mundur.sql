-- 05 Penerimaan / faktur / pembayaran PENGGANTI (terima ulang, faktur ulang, bayar ulang): tanggal efektif memakai aturan yang sama
-- (default hari ini, dari tanggal dokumen asal sampai hari ini, tidak masa depan, mundur hanya Owner/izin, alasan wajib); dokumen BIASA tidak berubah.
select pg_temp.su();
select pg_temp.mkpo(1,1,'[{"item":"a","qty":10,"harga":100}]');
select pg_temp.mkpo(2,1,'[{"item":"b","qty":5,"harga":100}]');
select pg_temp.mkpo(3,1,'[{"item":"a","qty":5,"harga":100}]');
select pg_temp.mkpo(4,1,'[{"item":"c","qty":5,"harga":100}]');
select pg_temp.mkpo(5,1,'[{"item":"d","qty":4,"harga":100}]');
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_pembayaran','pembelian.batalkan_faktur','pembelian.batalkan_penerimaan']);
select pg_temp.act(1);
select pg_temp.recv_at(1,'pg-r1','[{"line":1,"qty":10}]',current_date-9) as r1 \gset
select pg_temp.inv_at(1,'pg-i1','[{"line":1,"qty":10,"harga":100}]',array[:'r1'::uuid],current_date-8) as i1 \gset
select (pay_purchase_invoice_atomic('pg-pa',:'i1'::uuid,current_date-7,500,'Transfer',null,'bd700000-0000-4000-8000-000000000001',null))->>'payment_id' as pa \gset

-- Bayar ulang (pengganti pembayaran yang dibatalkan).
select cancel_purchase_payment(:'pa'::uuid,0,'pg-cpa','Salah akun',current_date-7) is not null as x \gset
select pg_temp.digest() as d0 \gset
select pg_temp.act(2);
select pg_temp.expect_error(format('select pay_purchase_invoice_atomic(%L,%L,current_date-7,500,%L,%L,%L,null,%L)','pg-rp1',:'i1','Transfer','Bayar ulang','bd700000-0000-4000-8000-000000000001',:'pa'),'Tanggal mundur');
select pg_temp.act(1);
select pg_temp.expect_error(format('select pay_purchase_invoice_atomic(%L,%L,current_date-7,500,%L,null,%L,null,%L)','pg-rp2',:'i1','Transfer','bd700000-0000-4000-8000-000000000001',:'pa'),'Alasan wajib');
select pg_temp.expect_error(format('select pay_purchase_invoice_atomic(%L,%L,current_date-8,500,%L,%L,%L,null,%L)','pg-rp3',:'i1','Transfer','Bayar ulang','bd700000-0000-4000-8000-000000000001',:'pa'),'sebelum tanggal pembayaran yang dibatalkan');
select pg_temp.expect_error(format('select pay_purchase_invoice_atomic(%L,%L,current_date+1,500,%L,%L,%L,null,%L)','pg-rp4',:'i1','Transfer','Bayar ulang','bd700000-0000-4000-8000-000000000001',:'pa'),'masa depan');
select pg_temp.ok(pg_temp.digest()=:'d0' and pg_temp.n_audit()=1,'bayar ulang ditolak: tanpa efek');
select pay_purchase_invoice_atomic('pg-rp-ok',:'i1'::uuid,current_date-7,500,'Transfer','Bayar ulang di tanggal asli','bd700000-0000-4000-8000-000000000001',null,:'pa'::uuid)->>'payment_id' as pnew \gset
select pg_temp.su();
select pg_temp.ok((select p.tanggal=current_date-7 and p.replaces_payment_id=:'pa'::uuid from purchase_invoice_payments p where p.id=:'pnew'::uuid),'pembayaran pengganti bertanggal asli');
select pg_temp.ok((select count(*)=1 and min(effective_date)=current_date-7 and min(doc_date)=current_date-7 and min(reason)='Bayar ulang di tanggal asli' and min(cash_account_code)='110209' from purchase_backdate_audit where kind='payment-replace' and doc_id=:'pnew'::uuid),'bukti pembayaran pengganti');
-- Pembayaran BIASA bertanggal mundur oleh peran keuangan: tidak berubah (tidak ada aturan baru).
select pg_temp.act(2);
select pay_purchase_invoice_atomic('pg-plain',:'i1'::uuid,current_date-5,100,'Transfer','Biasa','bd700000-0000-4000-8000-000000000001',null)->>'payment_id' is not null as x \gset
select pg_temp.ok(pg_temp.n_audit()=2,'pembayaran biasa: tidak ada bukti baru (aturan baru hanya untuk pengganti)');

-- Faktur ulang (pengganti) lewat PO.
select pg_temp.act(1);
select pg_temp.recv_at(2,'pg-r2','[{"line":1,"qty":5}]',current_date-6) as r2 \gset
select pg_temp.inv_at(2,'pg-i2','[{"line":1,"qty":5,"harga":100}]',array[:'r2'::uuid],current_date-5) as i2 \gset
select cancel_purchase_invoice(:'i2'::uuid,0,'pg-ci2','Salah harga',current_date-5) is not null as x \gset
select format('select create_purchase_invoice_from_po_receipts(%L,%L,5,null,%s,%s,%L,%L::jsonb,%L,%L,0,%L,%L,array[%L::uuid])',pg_temp.po(2),'FB.BP.','%s','%s','%s','[{"po_item_id":"'||pg_temp.line(2,1)||'","qty":5,"harga":90}]','[]','[]','%s',:'i2',:'r2') as tpl \gset
select pg_temp.digest() as d1 \gset
select pg_temp.act(2);
select pg_temp.expect_error(format(:'tpl','current_date-5','current_date-5','Harga benar','pg-ri1'),'Tanggal mundur');
select pg_temp.act(1);
select pg_temp.expect_error(format(:'tpl','current_date-5','current_date-5',null,'pg-ri2'),'Alasan wajib');
select pg_temp.expect_error(format(:'tpl','current_date-6','current_date-6','Harga benar','pg-ri3'),'sebelum tanggal faktur yang dibatalkan');
select pg_temp.expect_error(format(:'tpl','current_date+1','current_date+1','Harga benar','pg-ri4'),'masa depan');
select pg_temp.ok(pg_temp.digest()=:'d1' and pg_temp.n_audit()=3,'faktur ulang ditolak: tanpa efek');
select (select invoice_id from create_purchase_invoice_from_po_receipts(pg_temp.po(2),'FB.BP.',5,null,current_date-5,current_date-5,'Harga benar',jsonb_build_array(jsonb_build_object('po_item_id',pg_temp.line(2,1),'qty',5,'harga',90)),'[]','[]',0,'pg-ri-ok',:'i2'::uuid,array[:'r2'::uuid])) as i2n \gset
select pg_temp.su();
select pg_temp.ok((select i.tanggal=current_date-5 and i.replaces_invoice_id=:'i2'::uuid from purchase_invoices i where i.id=:'i2n'::uuid),'faktur pengganti bertanggal asli');
select pg_temp.ok((select count(*)=1 and min(doc_date)=current_date-5 and min(reason)='Harga benar' and min(days_back)=5 from purchase_backdate_audit where kind='invoice-replace' and doc_id=:'i2n'::uuid),'bukti faktur pengganti');
select pg_temp.act(1);
-- Faktur BIASA bertanggal mundur (tanpa pengganti): tidak berubah.
select pg_temp.recv_at(3,'pg-r3','[{"line":1,"qty":5}]',current_date-3) as r3 \gset
select pg_temp.inv_at(3,'pg-i3','[{"line":1,"qty":5,"harga":100}]',array[:'r3'::uuid],current_date-2) is not null as x \gset
select pg_temp.ok(pg_temp.n_audit()=4,'faktur biasa: tidak ada bukti baru');

-- Faktur langsung pengganti (lapisan baru bertanggal efektif; urutan FIFO dijaga).
select pg_temp.act(1);
select jsonb_build_object('supplier_id','bd300000-0000-4000-8000-000000000001','warehouse_id','bd200000-0000-4000-8000-000000000001','tanggal',(current_date-6)::text,'jatuh_tempo',(current_date+30)::text,
 'no_faktur_pemasok','SUP-D','surat_jalan','SJ-D','keterangan','Faktur langsung','lampiran','[]'::jsonb,'items',jsonb_build_array(jsonb_build_object('item_id','bd400000-0000-4000-8000-00000000000d','qty',3,'harga',100,'satuan','pcs'))) as dpay \gset
select create_direct_purchase_invoice('pg-d1',:'dpay'::jsonb)->>'invoice_id' as di1 \gset
select cancel_purchase_invoice(:'di1'::uuid,0,'pg-cd1','Salah input',current_date-6) is not null as x \gset
-- Lapisan lebih baru (item d) bertanggal -3 yang sudah terpakai penjualan: penggantinya pada -6 menyalip urutan => ditolak.
select pg_temp.recv_at(5,'pg-r5','[{"line":1,"qty":4}]',current_date-3) as r5 \gset
select pg_temp.su();
select * from stock_out_fifo('bd200000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-00000000000d',2,'sale','SALE.BD.D',current_date-2);
select pg_temp.act(1);
select (:'dpay'::jsonb||jsonb_build_object('replaces_invoice_id',:'di1','keterangan','Faktur langsung ulang')) as drep \gset
select pg_temp.digest() as d2 \gset
select pg_temp.expect_error(format('select create_direct_purchase_invoice(%L,%L::jsonb)','pg-d2',:'drep'),'tidak bisa dipakai');
select pg_temp.expect_error(format('select create_direct_purchase_invoice(%L,%L::jsonb)','pg-d3',(:'drep'::jsonb||'{"keterangan":""}')::text),'Alasan wajib');
select pg_temp.act(2);
select pg_temp.expect_error(format('select create_direct_purchase_invoice(%L,%L::jsonb)','pg-d4',:'drep'),'Tanggal mundur');
select pg_temp.ok(pg_temp.digest()=:'d2','faktur langsung pengganti ditolak: tanpa efek');
select pg_temp.act(1);
select create_direct_purchase_invoice('pg-d5',(:'drep'::jsonb||jsonb_build_object('tanggal',(current_date-3)::text,'jatuh_tempo',(current_date+30)::text))) is not null as x \gset
select pg_temp.su();
select pg_temp.ok((select count(*)=1 from purchase_backdate_audit where kind='invoice-replace' and doc_date=current_date-6 and effective_date=current_date-3),'faktur langsung pengganti pada -3 (tidak menyalip): berhasil, bukti dibuat');
select pg_temp.stock_card_ok('05 faktur langsung');select pg_temp.tb_zero('05 faktur langsung');

-- Terima ulang: biasa tidak berubah; pengganti mengikuti aturan tanggal efektif.
select pg_temp.su();
select pg_temp.mkpo(6,1,'[{"item":"c","qty":4,"harga":100}]');
select pg_temp.mkpo(7,1,'[{"item":"c","qty":4,"harga":100}]');
select pg_temp.act(2);
-- ADMIN (peran keuangan/gudang) menerima barang bertanggal mundur pada PO biasa: tidak berubah.
select pg_temp.recv_at(7,'pg-adm-r7','[{"line":1,"qty":2}]',current_date-2) is not null as x \gset
select pg_temp.ok(pg_temp.n_audit()=6,'penerimaan biasa oleh ADMIN: tidak ada bukti baru');
select pg_temp.act(1);
select pg_temp.recv_at(6,'pg-r6','[{"line":1,"qty":4}]',current_date-4) as r6 \gset
select cancel_goods_receipt(:'r6'::uuid,'pg-cr6','Salah terima',current_date-4) is not null as x \gset
select pg_temp.digest() as d3 \gset
select pg_temp.act(2);
select pg_temp.expect_error(format('select pg_temp.recv_note(6,%L,%L::jsonb,current_date-4,%L)','pg-rr1','[{"line":1,"qty":4}]','Terima ulang'),'Tanggal mundur');
select pg_temp.act(1);
select pg_temp.expect_error(format('select pg_temp.recv_note(6,%L,%L::jsonb,current_date-4,%L)','pg-rr2','[{"line":1,"qty":4}]','  '),'Alasan wajib');
select pg_temp.expect_error(format('select pg_temp.recv_note(6,%L,%L::jsonb,current_date-5,%L)','pg-rr3','[{"line":1,"qty":4}]','Terima ulang'),'sebelum tanggal penerimaan yang dibatalkan');
select pg_temp.expect_error(format('select pg_temp.recv_note(6,%L,%L::jsonb,current_date+1,%L)','pg-rr4','[{"line":1,"qty":4}]','Terima ulang'),'masa depan');
select pg_temp.ok(pg_temp.digest()=:'d3','terima ulang ditolak: tanpa efek');
-- Hari ini oleh ADMIN: bukan mundur, boleh tanpa catatan; Owner di tanggal asli dengan alasan: berhasil, jurnal & kartu stok bertanggal asli.
select pg_temp.act(2);
select pg_temp.recv_at(6,'pg-rr5','[{"line":1,"qty":1}]',current_date) is not null as x \gset
select pg_temp.act(1);
select pg_temp.recv_note(6,'pg-rr-ok','[{"line":1,"qty":3}]',current_date-4,'Terima ulang tanggal asli') as r6n \gset
select pg_temp.su();
select pg_temp.ok((select g.tanggal=current_date-4 from goods_receipts g where g.id=:'r6n'::uuid) and (select count(*)=1 from stock_moves m where m.source='purchase' and m.source_ref='PO.BP.6' and m.tanggal=current_date-4 and m.qty=3),'penerimaan pengganti bertanggal asli (kartu stok)');
select pg_temp.ok((select count(*)=1 and min(doc_date)=current_date-4 and min(effective_date)=current_date-4 from purchase_backdate_audit where kind='receipt-replace' and doc_id=:'r6n'::uuid),'bukti terima ulang');

-- Bayar ulang perintah bayar: dibatalkan, lalu dibayar ulang pada tanggal asli (hanya Owner/izin); alasan dari pembatalan.
select pg_temp.act(1);
select pg_temp.recv_at(4,'pg-r4','[{"line":1,"qty":5}]',current_date-5) as r4 \gset
select pg_temp.inv_at(4,'pg-i4','[{"line":1,"qty":5,"harga":100}]',array[:'r4'::uuid],current_date-4) as i4 \gset
select mutate_purchase_payment_order('pg-o-create','create',null,null,jsonb_build_object('supplier_id','bd300000-0000-4000-8000-000000000001'),jsonb_build_array(jsonb_build_object('invoice_id',:'i4'::uuid,'jumlah',500)))->>'order_id' as ord \gset
select mutate_purchase_payment_order('pg-o-approve','approve',:'ord'::uuid,0,'{}','[]') is not null as x \gset
select pay_purchase_payment_order_atomic('pg-o-pay',:'ord'::uuid,current_date-3,'Transfer','bd700000-0000-4000-8000-000000000001',1) is not null as x \gset
select id::text as po1 from purchase_invoice_payments where payment_order_id=:'ord'::uuid and reversal_of is null \gset
select cancel_purchase_payment(:'po1'::uuid,0,'pg-o-cancel','Salah rekening perintah',current_date-3) is not null as x \gset
select revision as orev from payment_orders where id=:'ord'::uuid \gset
select pg_temp.digest() as d4 \gset
select pg_temp.act(2);
select pg_temp.expect_error(format('select pay_purchase_payment_order_atomic(%L,%L,current_date-3,%L,%L,%s)','pg-o-p1',:'ord','Transfer','bd700000-0000-4000-8000-000000000001',:'orev'),'Tanggal mundur');
select pg_temp.act(1);
select pg_temp.expect_error(format('select pay_purchase_payment_order_atomic(%L,%L,current_date-4,%L,%L,%s)','pg-o-p2',:'ord','Transfer','bd700000-0000-4000-8000-000000000001',:'orev'),'sebelum tanggal pembayaran yang dibatalkan');
select pg_temp.ok(pg_temp.digest()=:'d4','bayar ulang perintah ditolak: tanpa efek');
select pay_purchase_payment_order_atomic('pg-o-ok',:'ord'::uuid,current_date-3,'Transfer','bd700000-0000-4000-8000-000000000001',:'orev') is not null as x \gset
select pg_temp.su();
select pg_temp.ok((select count(*)=1 and min(reason)='Salah rekening perintah' and min(effective_date)=current_date-3 from purchase_backdate_audit where kind='payment-replace' and doc_id=:'ord'::uuid),'bukti bayar ulang perintah: alasan dari pembatalan');
select pg_temp.stock_card_ok('05 akhir');select pg_temp.tb_zero('05 akhir');select pg_temp.invariants('05 akhir');
