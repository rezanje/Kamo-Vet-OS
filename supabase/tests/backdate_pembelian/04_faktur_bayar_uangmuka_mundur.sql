-- 04 Batalkan pembayaran, faktur, uang muka (dan cascade) pada tanggal efektif: jurnal, baris pembayaran pembalik, hutang pemasok as-of,
-- kas/bank as-of, bukti (tanggal dipilih vs nyata, jumlah uang fisik), izin, lantai tanggal, idempoten, tanpa efek saat ditolak.
select pg_temp.su();
select pg_temp.mkpo(1,1,'[{"item":"a","qty":10,"harga":100}]');
select pg_temp.mkpo(2,1,'[{"item":"b","qty":4,"harga":50}]');
select pg_temp.mkpo(3,1,'[{"item":"c","qty":5,"harga":200}]');
select pg_temp.mkpo(4,1,'[{"item":"d","qty":5,"harga":100}]');
select pg_temp.mkpo(5,1,'[{"item":"c","qty":5,"harga":100}]');
select pg_temp.mkpo(6,1,'[{"item":"b","qty":5,"harga":200}]');
select pg_temp.act(1);
select (pay_purchase_advance_atomic('bm-adv1','UM.BP.',5,'bd300000-0000-4000-8000-000000000001',pg_temp.po(2),current_date-9,150,'Transfer','bd700000-0000-4000-8000-000000000001',null))->>'advance_id' as adv1 \gset
select (pay_purchase_advance_atomic('bm-adv3','UM.BP.',5,'bd300000-0000-4000-8000-000000000001',pg_temp.po(6),current_date-9,400,'Transfer','bd700000-0000-4000-8000-000000000001',null))->>'advance_id' as adv3 \gset
select pg_temp.recv_at(1,'bm-r1','[{"line":1,"qty":10}]',current_date-9) as r1 \gset
select pg_temp.inv_at(1,'bm-i1','[{"line":1,"qty":10,"harga":100}]',array[:'r1'::uuid],current_date-8) as i1 \gset
select (pay_purchase_invoice_atomic('bm-pa',:'i1'::uuid,current_date-7,400,'Transfer',null,'bd700000-0000-4000-8000-000000000001',null))->>'payment_id' as pa \gset
select (pay_purchase_invoice_atomic('bm-pb',:'i1'::uuid,current_date-6,600,'Transfer',null,'bd700000-0000-4000-8000-000000000001',null))->>'payment_id' as pb \gset
select pg_temp.recv_at(3,'bm-r3','[{"line":1,"qty":5}]',current_date-8) as r3 \gset
select pg_temp.inv_at(3,'bm-i3','[{"line":1,"qty":5,"harga":200}]',array[:'r3'::uuid],current_date-7) as i3 \gset
select (pay_purchase_invoice_atomic('bm-pc',:'i3'::uuid,current_date-5,1000,'Transfer',null,'bd700000-0000-4000-8000-000000000001',null))->>'payment_id' as pc \gset
select pg_temp.recv_at(6,'bm-r6','[{"line":1,"qty":5}]',current_date-8) as r6 \gset
select pg_temp.inv_at(6,'bm-i6','[{"line":1,"qty":5,"harga":200}]',array[:'r6'::uuid],current_date-7) as i6 \gset
select (pay_purchase_invoice_atomic('bm-pd',:'i6'::uuid,current_date-4,1000,'Transfer',null,'bd700000-0000-4000-8000-000000000001',:'adv3'::uuid))->>'payment_id' as pd \gset
select pg_temp.invariants('04 awal');

-- Penolakan pembayaran: sebelum tanggal pembayaran, masa depan, tanpa alasan/tanggal kosong, ADMIN tanpa izin tanggal mundur. Tanpa efek.
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_pembayaran','pembelian.batalkan_faktur','pembelian.batalkan_uang_muka','pembelian.batalkan_penerimaan']);
select pg_temp.act(1);
select pg_temp.digest() as d0 \gset
select pg_temp.expect_error(format('select cancel_purchase_payment(%L,0,%L,%L,current_date-8)',:'pa','bm-p1','Salah bayar'),'sebelum tanggal pembayaran asal');
select pg_temp.expect_error(format('select cancel_purchase_payment(%L,0,%L,%L,current_date+1)',:'pa','bm-p2','Salah bayar'),'masa depan');
select pg_temp.expect_error(format('select cancel_purchase_payment(%L,0,%L,%L,null)',:'pa','bm-p3','Salah bayar'),'tidak valid');
select pg_temp.expect_error(format('select cancel_purchase_payment(%L,0,%L,%L,current_date-7)',:'pa','bm-p4','  '),'tidak valid');
select pg_temp.act(2);
select pg_temp.expect_error(format('select cancel_purchase_payment(%L,0,%L,%L,current_date-7)',:'pa','bm-p5','Salah bayar'),'Tanggal mundur');
select pg_temp.expect_error(format('select cancel_purchase_payment(%L,0,%L,%L,current_date-1)',:'pa','bm-p6','Salah bayar'),'Tanggal mundur');
select pg_temp.ok(pg_temp.digest()=:'d0' and pg_temp.n_audit()=0,'penolakan pembayaran: tanpa efek, tanpa bukti');

-- Owner membatalkan pb pada tanggal aslinya (-6) dan pa pada tanggal aslinya (-7).
select pg_temp.act(1);
select pg_temp.ap_asof(current_date-7) as ap7, pg_temp.ap_asof(current_date-6) as ap6, pg_temp.ap_asof(current_date) as ap0, pg_temp.bal_asof('110209',current_date-7) as bk7, pg_temp.bal_asof('110209',current_date-6) as bk6 \gset
select cancel_purchase_payment(:'pb'::uuid,0,'bm-ok-pb','Salah transfer',current_date-6) as cpb \gset
select pg_temp.su();
select pg_temp.ok((select p.tanggal=current_date-6 and p.amount=-600 and p.reversal_of=:'pb'::uuid and (p.created_at at time zone 'Asia/Jakarta')::date=current_date from purchase_invoice_payments p where p.reversal_of=:'pb'::uuid),'baris pembayaran pembalik bertanggal efektif; waktu nyata sekarang');
select pg_temp.ok((select e.tanggal=current_date-6 and e.source='purchase-pay-void' and e.deskripsi like '%dibukukan mundur ke%' and e.no_jurnal like 'JRN-'||to_char(current_date-6,'YYYYMM')||'-%' from journal_entries e where e.id=(:'cpb'::jsonb->>'reversal_journal_id')::uuid),'jurnal pembalik bertanggal efektif (+ keterangan mundur)');
select pg_temp.ok(pg_temp.ap_asof(current_date-7)=:'ap7'::numeric and pg_temp.ap_asof(current_date-6)=:'ap6'::numeric+600 and pg_temp.ap_asof(current_date)=:'ap0'::numeric+600,'hutang: pembatalan terbaca mulai tanggal aslinya (-6), sebelum itu tidak berubah');
select pg_temp.ok(pg_temp.bal_asof('110209',current_date-7)=:'bk7'::numeric and pg_temp.bal_asof('110209',current_date-6)=:'bk6'::numeric+600,'bank: uang kembali dibukukan di tanggal aslinya (-6), sebelum itu tidak berubah');
select pg_temp.ok((select count(*)=1 and min(effective_date)=current_date-6 and min(actual_date)=current_date and min(days_back)=6 and min(cash_amount)=600 and min(cash_account_code)='110209' and min(doc_date)=current_date-6
  and min(kind)='payment-cancel' and min(reason)='Salah transfer' from purchase_backdate_audit where doc_id=:'pb'::uuid),'bukti pembayaran: tanggal pembukuan vs nyata, uang fisik kembali 600 ke bank');
select pg_temp.act(1);
select pg_temp.ok(cancel_purchase_payment(:'pb'::uuid,0,'bm-ok-pb','Salah transfer',current_date-6)=:'cpb'::jsonb,'kunci sama: hasil sama');
select pg_temp.ok(get_purchase_payment_cancellation(:'pb'::uuid,'bm-ok-pb')=:'cpb'::jsonb,'pembaca pemulihan mengulang dengan tanggal tersimpan');
select pg_temp.expect_error(format('select cancel_purchase_payment(%L,0,%L,%L,current_date-5)',:'pb','bm-ok-pb','Salah transfer'),'rincian berbeda');
select pg_temp.ok(pg_temp.n_audit()=1,'tidak ada bukti kedua');
-- pa pada tanggal aslinya (-7) lewat pintu baru; hasilnya memuat tanggal.
select cancel_purchase_payment(:'pa'::uuid,0,'bm-ok-pa','Salah transfer',current_date-7) as cpa \gset
select pg_temp.ok((:'cpa'::jsonb->>'tanggal')::date=current_date-7,'hasil memuat tanggal');
select pg_temp.su();
select pg_temp.tb_zero('04 payment');select pg_temp.invariants('04 payment');

-- Pembungkus lama (4 argumen) = tanggal hari ini: aplikasi lama bekerja persis seperti dulu. pc dibatalkan hari ini.
select pg_temp.act(1);
select cancel_purchase_payment(:'pc'::uuid,0,'bm-old-pc','Salah bayar lama') as cpc \gset
select pg_temp.su();
select pg_temp.ok((select p.tanggal=current_date from purchase_invoice_payments p where p.reversal_of=:'pc'::uuid) and (select e.tanggal=current_date and e.deskripsi='Pembatalan pembayaran hutang' from journal_entries e where e.id=(:'cpc'::jsonb->>'reversal_journal_id')::uuid),'pembungkus lama: tanggal hari ini, deskripsi lama');
select pg_temp.ok((select days_back=0 and effective_date=current_date from purchase_backdate_audit where doc_id=:'pc'::uuid),'pembungkus lama: bukti days_back 0');

-- Faktur i1: pembayaran sudah dibalik pada -7 dan -6, jadi pembatalan faktur tidak boleh lebih awal dari -6; pada -6 berhasil.
select pg_temp.act(1);
select pg_temp.digest() as d1 \gset
select pg_temp.expect_error(format('select cancel_purchase_invoice(%L,0,%L,%L,current_date-8)',:'i1','bm-i-1','Salah faktur'),'mendahului faktur atau riwayat pembayaran');
select pg_temp.expect_error(format('select cancel_purchase_invoice(%L,0,%L,%L,current_date+1)',:'i1','bm-i-2','Salah faktur'),'tidak valid atau di masa depan');
select pg_temp.act(2);
select pg_temp.expect_error(format('select cancel_purchase_invoice(%L,0,%L,%L,current_date-6)',:'i1','bm-i-3','Salah faktur'),'Tanggal mundur');
select pg_temp.ok(pg_temp.digest()=:'d1','faktur ditolak: tanpa efek');
select pg_temp.act(1);
select pg_temp.ap_asof(current_date-8) as iap8, pg_temp.ap_asof(current_date-7) as iap7, pg_temp.ap_asof(current_date-6) as iap6 \gset
select cancel_purchase_invoice(:'i1'::uuid,0,'bm-i-ok','Salah faktur',current_date-6) as ci1 \gset
select pg_temp.su();
select pg_temp.ok((select i.voided_on=current_date-6 and (i.voided_at at time zone 'Asia/Jakarta')::date=current_date from purchase_invoices i where i.id=:'i1'::uuid),'faktur: tanggal efektif tersimpan, waktu nyata sekarang');
select pg_temp.ok((select e.tanggal=current_date-6 from journal_entries e where e.id=(:'ci1'::jsonb->>'reversal_journal_id')::uuid),'jurnal pembalik faktur bertanggal efektif');

select pg_temp.ok(pg_temp.ap_asof(current_date-8)=:'iap8'::numeric and pg_temp.ap_asof(current_date-7)=:'iap7'::numeric and pg_temp.ap_asof(current_date-6)=:'iap6'::numeric-1000,'hutang as-of: faktur tetap terlihat sebelum tanggal pembatalan, hilang sejak tanggal pembatalan (-6)');
select pg_temp.ok((select count(*)=1 and min(effective_date)=current_date-6 and min(doc_date)=current_date-8 and min(days_back)=6 from purchase_backdate_audit where kind='invoice-cancel' and doc_id=:'i1'::uuid),'bukti faktur');
select pg_temp.tb_zero('04 invoice');select pg_temp.invariants('04 invoice');

-- Faktur tanpa pembayaran: batal pada tanggal fakturnya sendiri; hutang pada tanggal itu menjadi nol.
select pg_temp.act(1);
select pg_temp.recv_at(4,'bm-r4','[{"line":1,"qty":5}]',current_date-5) as r4 \gset
select pg_temp.inv_at(4,'bm-i4','[{"line":1,"qty":5,"harga":100}]',array[:'r4'::uuid],current_date-5) as i4 \gset
select pg_temp.act(2);
select pg_temp.expect_error(format('select cancel_purchase_invoice(%L,0,%L,%L,current_date-5)',:'i4','bm-i4-a','Salah faktur'),'Tanggal mundur');
select pg_temp.act(1);
select pg_temp.ap_asof(current_date-5) as ap_before \gset
select cancel_purchase_invoice(:'i4'::uuid,0,'bm-i4-ok','Salah faktur',current_date-5) is not null as x \gset
select pg_temp.ok(pg_temp.ap_asof(current_date-5)=:'ap_before'::numeric-500 and pg_temp.ap_asof(current_date-5)=pg_temp.ap_asof(current_date),'hutang tanggal asli turun sebesar faktur (Accurate: terbaca di omset/hutang tanggal asli)');
select pg_temp.stock_card_ok('04 i4');

-- Faktur i5 dengan stok yang sudah terpakai penjualan sesudahnya: ditolak dengan penjelasan menyebut penjualannya.
select pg_temp.act(1);
select pg_temp.recv_at(5,'bm-r5','[{"line":1,"qty":5}]',current_date-4) as r5 \gset
select pg_temp.inv_at(5,'bm-i5','[{"line":1,"qty":5,"harga":100}]',array[:'r5'::uuid],current_date-4) as i5 \gset
select pg_temp.su();
select * from stock_out_fifo('bd200000-0000-4000-8000-000000000001','bd400000-0000-4000-8000-00000000000c',7,'sale','SALE.BD.I5',current_date-3);
select pg_temp.act(1);
select pg_temp.digest() as d2 \gset
select pg_temp.expect_error(format('select cancel_purchase_invoice(%L,0,%L,%L,current_date-4)',:'i5','bm-i5-a','Salah faktur'),'Stok atau harga sudah berubah setelah faktur');
select pg_temp.expect_error(format('select cancel_purchase_invoice(%L,0,%L,%L,current_date-4)',:'i5','bm-i5-b','Salah faktur'),'SALE.BD.I5');
select pg_temp.ok(pg_temp.digest()=:'d2','faktur dengan stok terpakai: tanpa efek');

-- Uang muka tak terpakai (adv1, bertanggal -9): lantai, izin, alasan, lalu berhasil pada tanggal aslinya.
select pg_temp.act(1);
select pg_temp.digest() as d3 \gset
select pg_temp.expect_error(format('select cancel_purchase_advance_atomic(%L,current_date-10,%L)',:'adv1','Salah uang muka'),'sebelum tanggal uang muka asal');
select pg_temp.expect_error(format('select cancel_purchase_advance_atomic(%L,current_date+1,%L)',:'adv1','Salah uang muka'),'masa depan');
select pg_temp.expect_error(format('select cancel_purchase_advance_atomic(%L,current_date-9,null)',:'adv1'),'Alasan wajib');
select pg_temp.expect_error(format('select cancel_purchase_advance_atomic(%L,null,%L)',:'adv1','Salah uang muka'),'Tanggal wajib');
select pg_temp.act(2);
select pg_temp.expect_error(format('select cancel_purchase_advance_atomic(%L,current_date-9,%L)',:'adv1','Salah uang muka'),'Tanggal mundur');
select pg_temp.ok(pg_temp.digest()=:'d3' and pg_temp.n_audit()=5,'uang muka ditolak: tanpa efek (bukti: pb, pa, pc, i1, i4)');
select pg_temp.act(1);
select cancel_purchase_advance_atomic(:'adv1'::uuid,current_date-9,'Salah uang muka') as ca1 \gset
select pg_temp.su();
select pg_temp.ok((select e.tanggal=current_date-9 and e.source='purchase-advance-void' from journal_entries e where e.id=(:'ca1'::jsonb->>'journal_id')::uuid) and (:'ca1'::jsonb->>'tanggal')::date=current_date-9,'jurnal pembalik uang muka bertanggal efektif');
select pg_temp.ok((select a.status='batal' from purchase_advances a where a.id=:'adv1'::uuid),'uang muka batal');
select pg_temp.ok((select count(*)=1 and min(cash_amount)=150 and min(cash_account_code)='110209' and min(effective_date)=current_date-9 and min(days_back)=9 from purchase_backdate_audit where kind='advance-cancel' and doc_id=:'adv1'::uuid),'bukti uang muka: uang fisik kembali 150 ke bank');
select pg_temp.act(1);
select pg_temp.ok(cancel_purchase_advance_atomic(:'adv1'::uuid,current_date-9,'Salah uang muka')=:'ca1'::jsonb and pg_temp.n_audit()=6,'uang muka: panggilan ulang = hasil sama, tanpa bukti kedua');

-- Cascade uang muka adv3 (dipakai pembayaran pd bertanggal -4): lantai = tanggal pembayaran; ADMIN tanpa izin ditolak; Owner berhasil di -4.
select pg_temp.act(1);
select preview_purchase_advance_cascade(:'adv3'::uuid) as pv \gset
select pg_temp.ok((:'pv'::jsonb->>'min_tanggal')::date=current_date-4 and (:'pv'::jsonb->>'tanggal')::date=current_date-9,'pratinjau cascade: tanggal minimum = pembayaran terakhir');
select pg_temp.digest() as d4 \gset
select pg_temp.expect_error(format('select cancel_purchase_advance_cascade(%L,%L,%L,%L,current_date-5)',:'adv3','Salah uang muka','bm-cas-1',:'pv'::jsonb->>'fingerprint'),'sebelum tanggal pembayaran asal');
select pg_temp.expect_error(format('select cancel_purchase_advance_cascade(%L,%L,%L,%L,current_date+1)',:'adv3','Salah uang muka','bm-cas-2',:'pv'::jsonb->>'fingerprint'),'masa depan');
select pg_temp.act(2);
select pg_temp.expect_error(format('select cancel_purchase_advance_cascade(%L,%L,%L,%L,current_date-4)',:'adv3','Salah uang muka','bm-cas-3',:'pv'::jsonb->>'fingerprint'),'Tanggal mundur');
select pg_temp.ok(pg_temp.digest()=:'d4','cascade ditolak: tanpa efek (semua atau tidak sama sekali)');
select pg_temp.act(1);
select cancel_purchase_advance_cascade(:'adv3'::uuid,'Salah uang muka','bm-cas-ok',:'pv'::jsonb->>'fingerprint',current_date-4) as cas \gset
select pg_temp.su();
select pg_temp.ok((:'cas'::jsonb->>'tanggal')::date=current_date-4 and (:'cas'::jsonb->>'payment_count')::int=1,'cascade: tanggal di hasil, satu pembayaran dibalik');
select pg_temp.ok((select p.tanggal=current_date-4 from purchase_invoice_payments p where p.reversal_of=:'pd'::uuid) and (select e.tanggal=current_date-4 from journal_entries e where e.id=(:'cas'::jsonb->>'journal_id')::uuid),'pembayaran dan uang muka dibalik pada tanggal efektif');
select pg_temp.ok((select count(*)=1 from purchase_backdate_audit where kind='advance-cancel' and doc_id=:'adv3'::uuid and effective_date=current_date-4)
  and (select count(*)=1 from purchase_backdate_audit where kind='payment-cancel' and doc_id=:'pd'::uuid and effective_date=current_date-4 and cash_amount=600),'bukti cascade: pembayaran dan uang muka');
select pg_temp.act(1);
select pg_temp.ok(cancel_purchase_advance_cascade(:'adv3'::uuid,'Salah uang muka','bm-cas-ok',:'pv'::jsonb->>'fingerprint',current_date-4)=:'cas'::jsonb,'cascade: kunci sama = hasil sama');
select pg_temp.expect_error(format('select cancel_purchase_advance_cascade(%L,%L,%L,%L,current_date-3)',:'adv3','Salah uang muka','bm-cas-ok',:'pv'::jsonb->>'fingerprint'),'rincian berbeda');

-- Daftar rekonsiliasi: dua tanggal berdampingan (pembukuan vs fisik).
select pg_temp.act(3);
select pg_temp.ok((select bool_and(actual_date=current_date and effective_date<=current_date and cash_account_name='BP bank') from list_purchase_backdate_audit(100,true)),'daftar: tanggal nyata = hari ini, rekening bernama');
select pg_temp.ok((select count(*) from list_purchase_backdate_audit(100,true) where days_back>0 and kind='payment-cancel')>=2,'daftar memuat pembayaran dibatalkan mundur');
select pg_temp.stock_card_ok('04 akhir');select pg_temp.tb_zero('04 akhir');select pg_temp.invariants('04 akhir');
