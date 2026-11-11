-- 07 Pembayaran multi-faktur (perintah bayar) dan uang muka dipakai di beberapa pembayaran: pembatalan membalik seluruh kelompok,
-- uang muka & hutang kembali persis, kapabilitas diperiksa di setiap pintu (termasuk pratinjau dan pemulihan), semua atomik.
select pg_temp.su();
select pg_temp.mkpo(1,1,'[{"item":"a","qty":5,"harga":100}]');
select pg_temp.mkpo(2,1,'[{"item":"b","qty":5,"harga":200}]');
select pg_temp.act(1);
select (pay_purchase_advance_atomic('um-adv','UM.BP.',5,'bd300000-0000-4000-8000-000000000001',pg_temp.po(1),current_date,300,'Transfer','bd700000-0000-4000-8000-000000000001',null))->>'advance_id' as adv \gset
select pg_temp.recv(1,'um-r1','[{"line":1,"qty":5}]') as r1 \gset
select pg_temp.recv(2,'um-r2','[{"line":1,"qty":5}]') as r2 \gset
select pg_temp.inv(1,'um-i1','[{"line":1,"qty":5,"harga":100}]',array[:'r1'::uuid]) as i1 \gset
select pg_temp.inv(2,'um-i2','[{"line":1,"qty":5,"harga":200}]',array[:'r2'::uuid]) as i2 \gset
-- Perintah bayar untuk dua faktur sekaligus (500 + 1000), disetujui, lalu dibayar.
select mutate_purchase_payment_order('um-po-create','create',null,null,jsonb_build_object('supplier_id','bd300000-0000-4000-8000-000000000001'),
  jsonb_build_array(jsonb_build_object('invoice_id',:'i1'::uuid,'jumlah',500),jsonb_build_object('invoice_id',:'i2'::uuid,'jumlah',1000)))->>'order_id' as ord \gset
select mutate_purchase_payment_order('um-po-approve','approve',:'ord'::uuid,0,'{}','[]') is not null as x \gset
select pay_purchase_payment_order_atomic('um-po-pay',:'ord'::uuid,current_date,'Transfer','bd700000-0000-4000-8000-000000000001',1) is not null as x \gset
select pg_temp.ok((select count(*)=2 from purchase_invoice_payments where payment_order_id=:'ord'::uuid and reversal_of is null),'dua pembayaran satu perintah bayar');
select pg_temp.invariants('07 setelah bayar perintah');
select id::text as pa from purchase_invoice_payments where invoice_id=:'i1'::uuid and reversal_of is null \gset
-- ADMIN tanpa izin ditolak (pembaca pemulihan juga); tanpa efek.
select pg_temp.act(2);
select pg_temp.digest() as d0 \gset
-- Setiap pintu menolak ADMIN tanpa izin (faktur, cascade uang muka, penerimaan) dengan pesan yang menyebut Akses Grup; tanpa efek.
select pg_temp.expect_error(format('select cancel_purchase_invoice(%L,0,%L,%L,current_date)',:'i1','um-adm-inv0','Coba'),'diberi izin Batalkan faktur di Akses Grup');
select pg_temp.expect_error(format('select cancel_purchase_advance_cascade(%L,%L,%L,%L)',:'adv','Coba','um-adm-adv0','x'),'diberi izin Batalkan uang muka di Akses Grup');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'r1','um-adm-rc0','Coba'),'diberi izin Batalkan penerimaan di Akses Grup');
select pg_temp.expect_error(format('select preview_purchase_advance_cascade(%L)',:'adv'),'diberi izin Batalkan uang muka di Akses Grup');
select pg_temp.expect_error(format('select cancel_purchase_payment(%L,0,%L,%L)',:'pa','um-adm0','Coba'),'Hanya Owner aktif');
select pg_temp.expect_error(format('select get_purchase_payment_cancellation(%L,%L)',:'pa','um-adm0'),'Hanya Owner aktif');
select pg_temp.ok(pg_temp.digest()=:'d0','tanpa izin: tanpa efek');
-- Izin pembayaran saja: ADMIN membatalkan; seluruh kelompok dibalik, perintah bayar siap dibayar lagi.
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_pembayaran']);
select pg_temp.act(2);
select cancel_purchase_payment(:'pa'::uuid,0,'um-adm1','Perintah bayar salah rekening') as ca \gset
select pg_temp.ok(get_purchase_payment_cancellation(:'pa'::uuid,'um-adm1')=:'ca'::jsonb,'pemulihan lewat Periksa hasil terakhir untuk ADMIN berizin');
select pg_temp.ok((select count(*)=2 from purchase_invoice_payments where payment_order_id=:'ord'::uuid and reversal_of is not null),'dua pembalik (kelompok dibalik bersama)');
select pg_temp.ok((select status from payment_orders where id=:'ord'::uuid)='disetujui','perintah bayar kembali disetujui (siap dibayar)');
select pg_temp.su();
select pg_temp.ok((select actor_id from purchase_payment_cancellation_requests where request_key='um-adm1')='bd000000-0000-4000-8000-000000000002','aktor ADMIN tercatat');
select pg_temp.invariants('07 setelah batal kelompok');
select pg_temp.su();
select pg_temp.ok((select sum(l.credit-l.debit) from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='311001')=1500,'hutang kembali 1500 (kedua faktur belum dibayar)');
-- Bayar lagi, batalkan lagi dengan Owner (kunci lain): riwayat berlapis tetap konsisten.
select pg_temp.act(1);
select pay_purchase_payment_order_atomic('um-po-pay2',:'ord'::uuid,current_date,'Transfer','bd700000-0000-4000-8000-000000000001',(select revision from payment_orders where id=:'ord'::uuid)) is not null as x \gset
select id::text as pb from purchase_invoice_payments where invoice_id=:'i2'::uuid and reversal_of is null and voided_at is null \gset
select cancel_purchase_payment(:'pb'::uuid,(select revision from purchase_invoice_payments where id=:'pb'::uuid),'um-own2','Salah lagi') is not null as x \gset
select pg_temp.invariants('07 setelah batal kedua');
select mutate_purchase_payment_order('um-po-cancel','cancel',:'ord'::uuid,(select revision from payment_orders where id=:'ord'::uuid),'{}','[]') is not null as x \gset

-- Uang muka dipakai di dua pembayaran faktur 1: cascade membalik keduanya lalu membatalkan uang muka.
select pg_temp.act(1);
select pay_purchase_invoice_atomic('um-pa1',:'i1'::uuid,current_date,200,'Transfer',null,'bd700000-0000-4000-8000-000000000001',:'adv'::uuid) is not null as x \gset
select pay_purchase_invoice_atomic('um-pa2',:'i1'::uuid,current_date,100,'Transfer',null,'bd700000-0000-4000-8000-000000000001',:'adv'::uuid) is not null as x \gset
select pg_temp.ok((select terpakai from purchase_advances where id=:'adv'::uuid)=300,'uang muka terpakai 300 di dua pembayaran');
select pg_temp.invariants('07 uang muka dipakai');
select preview_purchase_advance_cascade(:'adv'::uuid) as pvc \gset
select pg_temp.ok(jsonb_array_length(:'pvc'::jsonb->'payments')=2,'pratinjau cascade memuat dua pembayaran');
-- ADMIN dengan izin uang muka SAJA: cascade gagal di pembayaran pertama dengan pesan jelas dan SEMUA dibatalkan kembali (atomik).
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_uang_muka']);
select pg_temp.act(2);
select pg_temp.digest() as d1 \gset
select preview_purchase_advance_cascade(:'adv'::uuid)->>'fingerprint' as fp \gset
select pg_temp.expect_error(format('select cancel_purchase_advance_cascade(%L,%L,%L,%L)',:'adv','Uang muka salah','um-casc0',:'fp'),'Hanya Owner aktif (atau peran yang diberi izin Batalkan pembayaran');
select pg_temp.ok(pg_temp.digest()=:'d1','cascade tanpa izin pembayaran: tidak ada efek tertinggal');
-- Izin lengkap: cascade berhasil.
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_uang_muka','pembelian.batalkan_pembayaran']);
select pg_temp.act(2);
select cancel_purchase_advance_cascade(:'adv'::uuid,'Uang muka salah pemasok','um-casc1',:'fp') as cc \gset
select pg_temp.ok((:'cc'::jsonb->>'payment_count')::int=2,'cascade membalik dua pembayaran');
select pg_temp.ok((select status='batal' and terpakai=0 from purchase_advances where id=:'adv'::uuid),'uang muka batal, terpakai nol');
select pg_temp.ok(cancel_purchase_advance_cascade(:'adv'::uuid,'Uang muka salah pemasok','um-casc1',:'fp')=:'cc'::jsonb,'cascade idempoten');
select pg_temp.invariants('07 setelah cascade');
select pg_temp.su();
select pg_temp.ok((select coalesce(sum(l.debit-l.credit),0) from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='160001')=0,'saldo uang muka pemasok nol');
select pg_temp.ok((select sum(l.credit-l.debit) from journal_lines l join coa_accounts a on a.id=l.account_id where a.code='311001')=1500,'hutang kembali 1500');
-- Peran lain tetap ditolak.
select pg_temp.act(3);
select pg_temp.expect_error(format('select preview_purchase_advance_cascade(%L)',:'adv'),'peran yang diberi izin Batalkan uang muka');
select pg_temp.act(4);
select pg_temp.expect_error(format('select cancel_purchase_invoice(%L,0,%L,%L,current_date)',:'i1','um-stf','Coba'),'Akses modul ditolak');
-- Faktur: izin faktur memungkinkan ADMIN membatalkan faktur (sesudah pembayaran dibalik) dan pemulihan.
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_faktur']);
select pg_temp.act(2);
select cancel_purchase_invoice(:'i2'::uuid,0,'um-adm-inv','Faktur salah',current_date) as ci \gset
select pg_temp.ok(get_purchase_invoice_cancellation(:'i2'::uuid,'um-adm-inv')=:'ci'::jsonb,'pemulihan batal faktur untuk ADMIN berizin');
select pg_temp.invariants('07 selesai');
