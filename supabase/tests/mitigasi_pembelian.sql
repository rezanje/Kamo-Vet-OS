-- MITIGASI_1111 R1 (migrasi 20261113100000): izin pembatalan pembelian menghormati pencabutan modul; pratinjau penerimaan tidak bocor.
-- Dijalankan seperti seksi batal_pembelian (fixture 00_fixture.sql di template, _helpers.sql di depan, semuanya di-rollback).
select pg_temp.su();
select pg_temp.mkpo(1,1,'[{"item":"a","qty":10,"harga":100}]');
select pg_temp.act(1);
select pg_temp.recv(1,'mt-r1','[{"line":1,"qty":4}]') as rid \gset
select pg_temp.age(:'rid'::uuid, interval '2 hour');
select pg_temp.act(1);
select pg_temp.recv(1,'mt-r2','[{"line":1,"qty":6}]') as rid2 \gset
select pg_temp.age(:'rid2'::uuid, interval '1 hour');
-- Faktur + pembayaran untuk penerimaan 1 (pratinjau memuat total bayar faktur: itu yang bocor).
select pg_temp.act(1);
select pg_temp.inv(1,'mt-inv','[{"line":1,"qty":4,"harga":100}]',array[:'rid'::uuid]) as inv \gset
select (pay_purchase_invoice_atomic('mt-pay1',:'inv'::uuid,current_date,150,'Transfer',null,'bd700000-0000-4000-8000-000000000001',null))->>'payment_id' as pay1 \gset

-- 0) Kontrol: ADMIN diberi izin DAN modul pembelian -> boleh; STAFF/FINANCE tanpa izin -> pratinjau ditolak (tidak membocorkan total bayar faktur).
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_penerimaan','pembelian.batalkan_pembayaran'],array['pembelian','kas-bank']);
select pg_temp.act(2);
select pg_temp.ok(purchase_cancel_allowed('pembelian.batalkan_penerimaan') and purchase_cancel_allowed('pembelian.batalkan_pembayaran'),'R1-0 ADMIN berizin + modul pembelian: boleh');
select pg_temp.ok((preview_goods_receipt_cancellation(:'rid2'::uuid)->>'can_cancel')::boolean,'R1-0 ADMIN berizin: pratinjau jalan');
select pg_temp.act(4);
select pg_temp.expect_error(format('select preview_goods_receipt_cancellation(%L)',:'rid'),'Pratinjau pembatalan penerimaan hanya untuk Owner');
select pg_temp.act(3);
select pg_temp.expect_error(format('select preview_goods_receipt_cancellation(%L)',:'rid'),'Pratinjau pembatalan penerimaan hanya untuk Owner');
select pg_temp.act(1);
select pg_temp.ok(preview_goods_receipt_cancellation(:'rid'::uuid)#>>'{blockers,0,paid}'='150','R1-0 Owner: pratinjau memuat total bayar faktur (tidak dikunci)');

-- 1) Modul pembelian DICABUT dari ADMIN tetapi izin tersimpan masih ada: ditolak di semua jalur (sebelumnya true).
select pg_temp.su();
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_penerimaan','pembelian.batalkan_faktur','pembelian.batalkan_pembayaran','pembelian.batalkan_uang_muka'],array['kas-bank']);
select pg_temp.act(2);
select pg_temp.ok(not role_action_allowed('pembelian.batalkan_penerimaan'),'R1-1 prasyarat: gerbang modul menolak ADMIN tanpa modul pembelian');
select pg_temp.ok(not purchase_cancel_allowed('pembelian.batalkan_penerimaan') and not purchase_cancel_allowed('pembelian.batalkan_faktur')
  and not purchase_cancel_allowed('pembelian.batalkan_pembayaran') and not purchase_cancel_allowed('pembelian.batalkan_uang_muka'),'R1-1 purchase_cancel_allowed: semua tindakan false saat modul dicabut');
select pg_temp.ok(get_my_purchase_cancel_access()=jsonb_build_object('batalkan_penerimaan',false,'batalkan_faktur',false,'batalkan_pembayaran',false,'batalkan_uang_muka',false),'R1-1 ringkasan akses: semua false');
select pg_temp.digest() as d0 \gset
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'rid2','mt-x1','Coba lewat RPC'),'diberi izin');
select pg_temp.expect_error(format('select cancel_purchase_payment(%L,0,%L,%L)',:'pay1','mt-x2','Coba bayar'),'diberi izin');
select pg_temp.expect_error(format('select preview_goods_receipt_cancellation(%L)',:'rid2'),'Pratinjau pembatalan penerimaan hanya untuk Owner');
select pg_temp.expect_error(format('select reopen_purchase_order_remainder(%L,%L,%L)',pg_temp.po(1),'mt-x3','Coba buka'),'diberi izin');
select pg_temp.ok(pg_temp.digest()=:'d0','R1-1 penolakan tidak meninggalkan efek apa pun');

-- 2) Owner tidak pernah terkunci: modul pembelian dicabut dari ROLE OWNER pun tetap boleh (Owner dijawab lebih dulu).
select pg_temp.act(1);
select pg_temp.ok(purchase_cancel_allowed('pembelian.batalkan_penerimaan') and purchase_cancel_allowed('pembelian.batalkan_faktur') and purchase_cancel_allowed('pembelian.batalkan_pembayaran') and purchase_cancel_allowed('pembelian.batalkan_uang_muka'),'R1-2 OWNER tetap boleh semua');
select pg_temp.su();
set local session_replication_role=replica;
insert into role_modules(role,module_id) values('OWNER','__role_v2__') on conflict do nothing;
set local session_replication_role=origin;
select pg_temp.act(1);
select pg_temp.ok(purchase_cancel_allowed('pembelian.batalkan_penerimaan') and purchase_cancel_allowed('pembelian.batalkan_pembayaran'),'R1-2 OWNER boleh walau baris modul v2 ada tanpa modul pembelian');
select pg_temp.ok(cancel_goods_receipt(:'rid2'::uuid,'mt-own-r2','Owner batal penerimaan 2',current_date)?'reversal_journal_id','R1-2 Owner berhasil membatalkan penerimaan');
select pg_temp.su();
select pg_temp.ok(not (select voided_at is null from goods_receipts where id=:'rid2'::uuid),'R1-2 penerimaan 2 tercatat batal');
-- Owner juga tak terkunci saat tabel kebijakan tidak terbaca (perilaku #500 dipertahankan).
alter table role_settings_private.action_policies rename to action_policies_hilang;
select pg_temp.act(1);
select pg_temp.ok(purchase_cancel_allowed('pembelian.batalkan_penerimaan') and purchase_cancel_allowed('pembelian.batalkan_uang_muka'),'R1-2 OWNER boleh saat tabel kebijakan hilang');
select pg_temp.act(2);
select pg_temp.ok(not purchase_cancel_allowed('pembelian.batalkan_penerimaan'),'R1-2 ADMIN gagal-tertutup saat kebijakan tidak terbaca');
select pg_temp.su();
alter table role_settings_private.action_policies_hilang rename to action_policies;
-- 3) Modul dikembalikan: ADMIN boleh lagi (izin tersimpan tidak hilang).
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_penerimaan','pembelian.batalkan_faktur','pembelian.batalkan_pembayaran','pembelian.batalkan_uang_muka'],array['pembelian','kas-bank']);
select pg_temp.act(2);
select pg_temp.ok(purchase_cancel_allowed('pembelian.batalkan_penerimaan') and purchase_cancel_allowed('pembelian.batalkan_uang_muka'),'R1-3 modul dikembalikan: ADMIN boleh lagi');
select pg_temp.ok(not purchase_cancel_allowed('pembelian.tindakan_lain') and not purchase_cancel_allowed(null),'R1-3 tindakan tak dikenal / null: false');
rollback;
