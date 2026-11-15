-- 02 Batalkan penerimaan pada tanggal efektif: jurnal/kartu stok/lapisan terbaca di tanggal pilihan, waktu nyata tetap tercatat,
-- izin tanggal mundur, tanggal sebelum dokumen/masa depan, periode akuntansi, Closing HPP, idempoten, neraca saldo nol per cabang per tanggal.
select pg_temp.su();
select pg_temp.mkpo(1,1,'[{"item":"a","qty":10,"harga":100}]');
select pg_temp.mkpo(2,1,'[{"item":"b","qty":10,"harga":200}]');
select pg_temp.mkpo(3,1,'[{"item":"c","qty":4,"harga":50}]');
select pg_temp.act(1);
select pg_temp.recv_at(1,'bm-r1','[{"line":1,"qty":10}]',current_date-5) as r1 \gset
select pg_temp.recv_at(2,'bm-r2','[{"line":1,"qty":10}]',current_date-4) as r2 \gset
select pg_temp.recv_at(3,'bm-r3','[{"line":1,"qty":4}]',current_date-3) as r3 \gset
select pg_temp.ok(pg_temp.bal_asof('170001',current_date-5)=1000 and pg_temp.bal_asof('170001',current_date-6)=0,'penerimaan r1 tercatat di tanggal aslinya');

-- Pratinjau: Owner boleh pada tanggal dokumen asli; ADMIN (izin batal saja) diberi penghalang tanggal mundur; masa depan ditolak.
select preview_goods_receipt_cancellation(:'r1'::uuid,current_date-5) as pv \gset
select pg_temp.ok((:'pv'::jsonb->>'can_cancel')::boolean and (:'pv'::jsonb->>'min_tanggal')::date=current_date-5,'pratinjau Owner: tanggal asli boleh + tanggal minimum');
select pg_temp.ok((preview_goods_receipt_cancellation(:'r1'::uuid,current_date+1)#>>'{blockers,0,code}')='tanggal_masa_depan','pratinjau: masa depan');
select pg_temp.ok((preview_goods_receipt_cancellation(:'r1'::uuid,current_date-6)#>>'{blockers,0,code}')='tanggal_tidak_valid','pratinjau: sebelum dokumen');
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_penerimaan']);
select pg_temp.act(2);
select preview_goods_receipt_cancellation(:'r1'::uuid,current_date-5) as pva \gset
select pg_temp.ok(not (:'pva'::jsonb->>'can_cancel')::boolean and :'pva'::jsonb#>>'{blockers,0,code}'='tanggal_mundur_izin','pratinjau ADMIN: tanggal mundur butuh izin');
select pg_temp.ok((preview_goods_receipt_cancellation(:'r1'::uuid)->>'can_cancel')::boolean,'pratinjau ADMIN: hari ini boleh');
select pg_temp.digest() as d0 \gset
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date-5)',:'r1','bm-adm1','Salah terima'),'Tanggal mundur');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date-1)',:'r1','bm-adm2','Salah terima'),'Tanggal mundur');
select pg_temp.ok(pg_temp.digest()=:'d0' and pg_temp.n_audit()=0,'ADMIN tanpa izin tanggal mundur: tanpa efek, tanpa bukti');

-- Owner: masa depan, sebelum dokumen, alasan kosong (tanpa efek).
select pg_temp.act(1);
select pg_temp.digest() as d0 \gset
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date+1)',:'r1','bm-f1','Coba'),'masa depan');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date-6)',:'r1','bm-f2','Coba'),'sebelum tanggal penerimaan');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date-5)',:'r1','bm-f3',' x '),'Alasan pembatalan wajib');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,null)',:'r1','bm-f4','Coba'),'tidak valid');
select pg_temp.ok(pg_temp.digest()=:'d0','penolakan tanggal: tanpa efek');

-- Periode akuntansi dikunci pada tanggal dokumen: ditolak dengan penjelasan (bukan pesan teknis); Owner melepas kunci lalu berhasil.
select pg_temp.su();
update accounting_locks set closed_until=current_date-5;
select pg_temp.act(1);
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date-5)',:'r1','bm-p1','Coba'),'Keuangan > Tutup Buku');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date)',:'r1','bm-p2','Coba'),'pembatalan dokumen bertanggal');
select pg_temp.ok(pg_temp.digest()=:'d0','periode akuntansi: tanpa efek');
select pg_temp.su();
update accounting_locks set closed_until=null;
-- Closing HPP sampai tanggal dokumen: ditolak dengan penjelasan; setelah dibuka berhasil.
update inventory_costing_settings set closed_through=current_date-5 where id;
select pg_temp.act(1);
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date-5)',:'r1','bm-h1','Coba'),'Closing HPP');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date)',:'r1','bm-h2','Coba'),'Keuangan > Closing HPP');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date)',:'r1','bm-h3','Coba'),'untuk dokumen bertanggal');
select pg_temp.ok(pg_temp.digest()=:'d0','Closing HPP: tanpa efek');
select pg_temp.su();
update inventory_costing_settings set closed_through=null where id;

-- Berhasil: Owner membatalkan r1 pada tanggal ASLI (hari -5).
select pg_temp.act(1);
select pg_temp.diff(:'r1'::uuid,'02 r1 sebelum');
select cancel_goods_receipt(:'r1'::uuid,'bm-ok1','Salah terima barang',current_date-5) as c1 \gset
select pg_temp.ok((:'c1'::jsonb->>'tanggal')::date=current_date-5,'hasil memuat tanggal efektif');
select pg_temp.su();
select pg_temp.ok((select voided_on=current_date-5 and (voided_at at time zone 'Asia/Jakarta')::date=current_date and void_reason='Salah terima barang' from goods_receipts where id=:'r1'::uuid),'penerimaan: tanggal efektif tersimpan, waktu nyata = sekarang');
select pg_temp.ok((select e.tanggal=current_date-5 and e.no_jurnal like 'JRN-'||to_char(current_date-5,'YYYYMM')||'-%' and (e.created_at at time zone 'Asia/Jakarta')::date=current_date from journal_entries e where e.source='purchase-receipt-void' and e.id=(select reversal_journal_id from goods_receipts where id=:'r1'::uuid)),'jurnal pembalik bertanggal efektif; waktu nyata sekarang');
select pg_temp.ok((select m.tanggal=current_date-5 and m.qty=-10 and (m.created_at at time zone 'Asia/Jakarta')::date=current_date from stock_moves m where m.source='purchase-receipt-void' and m.source_ref=(select no_terima from goods_receipts where id=:'r1'::uuid)),'kartu stok: mutasi pembalik bertanggal efektif, waktu nyata tercatat');
select pg_temp.ok((select sum(qty_left)=0 from stock_layers where source_ref='PO.BP.1'),'lapisan asal dinolkan (tidak diberi tanggal baru)');
select pg_temp.ok((select min(tanggal)=current_date-5 and max(tanggal)=current_date-5 from stock_layers where source_ref='PO.BP.1'),'tanggal lapisan tidak diubah');
select pg_temp.ok((select count(*)=1 and min(effective_date)=current_date-5 and min(actual_date)=current_date and min(days_back)=5 and min(doc_date)=current_date-5
  and min(reason)='Salah terima barang' and min(actor_id::text)='bd000000-0000-4000-8000-000000000001' and min(kind)='receipt-cancel' and bool_and(journal_id=(select reversal_journal_id from goods_receipts where id=:'r1'::uuid))
  from purchase_backdate_audit),'bukti: tanggal dipilih vs tanggal nyata, pelaku, alasan, jurnal');
select pg_temp.ok((select (actual_at at time zone 'Asia/Jakarta')::date=current_date from purchase_backdate_audit limit 1),'bukti: waktu nyata tersimpan');
select pg_temp.ok(pg_temp.bal_asof('170001',current_date-5)=0 and pg_temp.bal_asof('311003',current_date-5)=0,'saldo persediaan dan GRNI pada tanggal asli = 0 (terbaca di tanggal aslinya)');
select pg_temp.stock_card_ok('02 r1');
select pg_temp.tb_zero('02 r1');
select pg_temp.invariants('02 r1');
-- Idempoten: kunci sama = hasil sama tanpa bukti kedua; rincian beda ditolak; kunci lain pada penerimaan batal = sudah dibatalkan.
select pg_temp.act(1);
select pg_temp.ok(cancel_goods_receipt(:'r1'::uuid,'bm-ok1','Salah terima barang',current_date-5)=:'c1'::jsonb,'kunci sama: hasil sama');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date-4)',:'r1','bm-ok1','Salah terima barang'),'rincian berbeda');
select pg_temp.ok((cancel_goods_receipt(:'r1'::uuid,'bm-ok2','Salah terima barang',current_date-5)->>'already_cancelled')::boolean,'klik ganda dengan kunci lain: sudah dibatalkan');
select pg_temp.ok(pg_temp.n_audit()=1 and (select count(*)=1 from purchase_receipt_cancellations),'tidak ada bukti/pembatalan kedua');

-- Antara tanggal dokumen dan hari ini (hari -2 untuk r2 yang bertanggal -4): kartu stok balance as-of terbaca benar.
select cancel_goods_receipt(:'r2'::uuid,'bm-ok3','Salah barang',current_date-2) as c2 \gset
select pg_temp.su();
select pg_temp.ok((select coalesce(sum(m.qty),0)=10 from stock_moves m where m.item_id='bd400000-0000-4000-8000-00000000000b' and m.tanggal<=current_date-3)
  and (select coalesce(sum(m.qty),0)=0 from stock_moves m where m.item_id='bd400000-0000-4000-8000-00000000000b' and m.tanggal<=current_date-2),'kartu stok: ada hingga -3, nol sejak -2 (tanggal pilihan)');
select pg_temp.stock_card_ok('02 r2');select pg_temp.tb_zero('02 r2');select pg_temp.invariants('02 r2');

-- Hari ini (tanpa mundur): ADMIN dengan izin batal penerimaan boleh; bukti tercatat dengan days_back = 0 dan tanpa alasan wajib selain alasan batal.
select pg_temp.act(2);
select cancel_goods_receipt(:'r3'::uuid,'bm-adm-ok','Salah input hari ini') as c3 \gset
select pg_temp.su();
select pg_temp.ok((select days_back=0 and effective_date=current_date and actual_date=current_date and actor_id='bd000000-0000-4000-8000-000000000002' from purchase_backdate_audit where doc_id=:'r3'::uuid),'bukti hari ini: days_back 0, pelaku ADMIN');
select pg_temp.ok((select count(*)=3 from purchase_backdate_audit),'tiga bukti (r1, r2, r3)');
select pg_temp.stock_card_ok('02 akhir');select pg_temp.tb_zero('02 akhir');select pg_temp.invariants('02 akhir');
