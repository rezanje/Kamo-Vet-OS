-- 05 Retur pembelian dan tutup sisa PO: retur aktif menghalangi, retur yang sudah dibatalkan tidak lagi; sisa PO yang ditutup bisa
-- dibuka kembali (arsip bukti tidak bisa diubah) sehingga penerimaannya bisa dibatalkan; tutup sisa bisa dilakukan lagi sesudahnya.
select pg_temp.su();
select pg_temp.mkpo(1,1,'[{"item":"a","qty":10,"harga":100}]');
select pg_temp.mkpo(2,1,'[{"item":"b","qty":10,"harga":100}]');
select pg_temp.act(1);
select pg_temp.recv(1,'rt-r1','[{"line":1,"qty":4}]') as r1 \gset
select pg_temp.recv(2,'rt-r2','[{"line":1,"qty":4}]') as r2 \gset

-- A. Retur aktif menghalangi (pratinjau + pembatalan sungguhan sepakat), tanpa efek.
select pg_temp.su();
insert into purchase_returns(id,no_retur,po_id,tanggal,total) values('bd900000-0000-4000-8000-000000000001','RB.BP.1',pg_temp.po(1),current_date,100);
select pg_temp.act(1);
select pg_temp.diff(:'r1'::uuid,'05 retur aktif');
select preview_goods_receipt_cancellation(:'r1'::uuid) as pv \gset
select pg_temp.ok(:'pv'::jsonb#>>'{blockers,0,code}'='retur_aktif' and :'pv'::jsonb#>>'{blockers,0,docs,0,label}'='Retur RB.BP.1','pratinjau menyebut retur aktif');
select pg_temp.digest() as d0 \gset
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'r1','rt-x1','Coba'),'retur pembelian');
select pg_temp.ok(pg_temp.digest()=:'d0','retur aktif: ditolak tanpa efek');
-- Retur yang sudah dibatalkan tidak lagi menghalangi.
select pg_temp.su();
update purchase_returns set voided_at=now(),voided_on=current_date where id='bd900000-0000-4000-8000-000000000001';
select pg_temp.act(1);
select pg_temp.diff(:'r1'::uuid,'05 retur sudah batal');
select pg_temp.ok((preview_goods_receipt_cancellation(:'r1'::uuid)->>'can_cancel')::boolean,'retur batal: pratinjau bisa');
select cancel_goods_receipt(:'r1'::uuid,'rt-c1','Salah input',current_date) is not null as x \gset
select pg_temp.invariants('05 setelah batal dengan retur batal');

-- B. Tutup sisa PO2 (diterima 4 dari 10) lalu buka kembali.
select pg_temp.act(1);
select close_purchase_order_remainder(pg_temp.po(2),'rt-close',(select jsonb_agg(jsonb_build_object('id',id,'qty',qty,'qty_terima',coalesce(qty_terima,0),'qty_rusak',coalesce(qty_rusak,0),'satuan',satuan,'faktor',faktor)) from purchase_order_items where po_id=pg_temp.po(2)),'Pemasok tidak kirim sisa',true) is not null as x \gset
select pg_temp.ok((select status::text from purchase_orders where id=pg_temp.po(2))='Diterima' and exists(select 1 from purchase_order_receipt_closures where po_id=pg_temp.po(2)),'PO2 ditutup sisanya');
select pg_temp.diff(:'r2'::uuid,'05 sisa ditutup');
select preview_goods_receipt_cancellation(:'r2'::uuid) as pv2 \gset
select pg_temp.ok(:'pv2'::jsonb#>>'{blockers,0,code}'='sisa_ditutup' and (:'pv2'::jsonb#>>'{blockers,0,message}') like '%Buka kembali sisa PO%','pratinjau: sisa ditutup, tunjukkan Buka kembali');
select pg_temp.digest() as d1 \gset
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'r2','rt-x2','Coba'),'Sisa PO ini sudah ditutup');
select pg_temp.ok(pg_temp.digest()=:'d1','sisa ditutup: ditolak tanpa efek');
-- Tanpa izin: ditolak, tanpa efek.
select pg_temp.act(2);
select pg_temp.expect_error(format('select reopen_purchase_order_remainder(%L,%L,%L)',pg_temp.po(2),'rt-o0','Coba'),'hanya oleh Super Admin');
select pg_temp.act(1);
select pg_temp.expect_error(format('select reopen_purchase_order_remainder(%L,%L,%L)',pg_temp.po(2),'rt-o1','x'),'Alasan wajib');
select pg_temp.expect_error(format('select reopen_purchase_order_remainder(%L,%L,%L)',pg_temp.po(2),' rt-o1 ','Alasan sah'),'Identitas pembukaan tidak valid');
select pg_temp.ok(pg_temp.digest()=:'d1','penolakan buka-kembali tanpa efek');
select reopen_purchase_order_remainder(pg_temp.po(2),'rt-o2','Pemasok akan kirim sisa') as ro \gset
select pg_temp.ok((:'ro'::jsonb->>'status_sesudah')='Dipesan' and (:'ro'::jsonb->>'status_sebelum')='Diterima','status Diterima -> Dipesan');
select pg_temp.ok(not exists(select 1 from purchase_order_receipt_closures where po_id=pg_temp.po(2)) and (select status::text from purchase_orders where id=pg_temp.po(2))='Dipesan','penutup dilepas, PO terbuka lagi');
select pg_temp.ok((select count(*) from purchase_order_receipt_closure_reopenings where po_id=pg_temp.po(2))=1,'arsip pembukaan tersimpan');
select pg_temp.ok((select closure->>'reason' from purchase_order_receipt_closure_reopenings where po_id=pg_temp.po(2))='Pemasok tidak kirim sisa' and jsonb_array_length((select closure->'lines' from purchase_order_receipt_closure_reopenings where po_id=pg_temp.po(2)))=1,'arsip memuat bukti tutup sisa asli (alasan + baris)');
select pg_temp.ok(reopen_purchase_order_remainder(pg_temp.po(2),'rt-o2','Pemasok akan kirim sisa')=:'ro'::jsonb,'buka kembali idempoten (kunci sama)');
select pg_temp.expect_error(format('select reopen_purchase_order_remainder(%L,%L,%L)',pg_temp.po(2),'rt-o2','Alasan lain'),'rincian berbeda');
select pg_temp.expect_error(format('select reopen_purchase_order_remainder(%L,%L,%L)',pg_temp.po(2),'rt-o3','Sekali lagi'),'tidak sedang ditutup');
select pg_temp.ok((select count(*) from purchase_order_receipt_closure_reopenings)=1,'tidak ada arsip kedua');
-- Arsip dan penutup tidak bisa diubah/dihapus dari klien maupun tanpa jalur resmi.
select pg_temp.expect_error('delete from purchase_order_receipt_closure_reopenings','permission denied');
select pg_temp.expect_error('delete from purchase_order_receipt_closures','permission denied');
select pg_temp.su();
select pg_temp.expect_error('update purchase_order_receipt_closure_reopenings set reason=''x''','tidak dapat diubah atau dihapus');
select pg_temp.expect_error('delete from purchase_order_receipt_closure_reopenings','tidak dapat diubah atau dihapus');
select pg_temp.expect_error('truncate purchase_order_receipt_closure_reopenings','tidak dapat diubah atau dihapus');
-- Penutup baru (tanpa jalur resmi) tidak bisa dihapus langsung walau oleh pemilik fungsi.
select pg_temp.age(:'r2'::uuid, interval '2 hour');
select pg_temp.act(1);
select pg_temp.recv(2,'rt-r2b','[{"line":1,"qty":1}]') as r2b \gset
select close_purchase_order_remainder(pg_temp.po(2),'rt-close2',(select jsonb_agg(jsonb_build_object('id',id,'qty',qty,'qty_terima',coalesce(qty_terima,0),'qty_rusak',coalesce(qty_rusak,0),'satuan',satuan,'faktor',faktor)) from purchase_order_items where po_id=pg_temp.po(2)),'Tutup lagi',true) is not null as x \gset
select pg_temp.ok(exists(select 1 from purchase_order_receipt_closures where po_id=pg_temp.po(2)),'tutup sisa dapat dilakukan lagi setelah dibuka');
select pg_temp.su();
select pg_temp.expect_error('delete from purchase_order_receipt_closures','tidak dapat diubah atau dihapus');
select pg_temp.expect_error('update purchase_order_receipt_closures set reason=''x''','tidak dapat diubah atau dihapus');
-- Buka lagi (kunci baru) lalu batalkan penerimaannya: kini bisa.
select pg_temp.act(1);
select reopen_purchase_order_remainder(pg_temp.po(2),'rt-o4','Buka lagi') is not null as x \gset
select pg_temp.ok((select count(*) from purchase_order_receipt_closure_reopenings where po_id=pg_temp.po(2))=2,'dua arsip pembukaan (dua tutup sisa berbeda)');
select pg_temp.diff(:'r2'::uuid,'05 setelah buka kembali');
select pg_temp.ok((preview_goods_receipt_cancellation(:'r2'::uuid)->>'can_cancel')::boolean,'pratinjau: bisa setelah buka kembali');
select cancel_goods_receipt(:'r2'::uuid,'rt-c2','Salah input',current_date) is not null as x \gset
select cancel_goods_receipt(:'r2b'::uuid,'rt-c2b','Salah input',current_date) is not null as x \gset
select pg_temp.ok((select count(*) from stock where item_id='bd400000-0000-4000-8000-00000000000b' and qty<>0)=0,'stok B nol');
select pg_temp.invariants('05 selesai');
-- Peran yang diberi izin penerimaan boleh membuka kembali sisa PO.
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_penerimaan']);
select pg_temp.su();
select pg_temp.mkpo(3,1,'[{"item":"c","qty":10,"harga":100}]');
select pg_temp.act(1);
select pg_temp.recv(3,'rt-r3','[{"line":1,"qty":3}]') is not null as x \gset
select close_purchase_order_remainder(pg_temp.po(3),'rt-close3',(select jsonb_agg(jsonb_build_object('id',id,'qty',qty,'qty_terima',coalesce(qty_terima,0),'qty_rusak',coalesce(qty_rusak,0),'satuan',satuan,'faktor',faktor)) from purchase_order_items where po_id=pg_temp.po(3)),'Tutup',true) is not null as x \gset
select pg_temp.act(2);
select reopen_purchase_order_remainder(pg_temp.po(3),'rt-adm','ADMIN diberi izin') is not null as x \gset
select pg_temp.ok((select actor_id from purchase_order_receipt_closure_reopenings where po_id=pg_temp.po(3))='bd000000-0000-4000-8000-000000000002','aktor ADMIN tercatat di arsip');
