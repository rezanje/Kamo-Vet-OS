-- 08 Periode tertutup, tanggal, alasan, kunci permintaan, cakupan cabang/modul, akses pratinjau. Setiap penolakan tanpa efek; Owner
-- membuka kunci periode lalu berhasil.
select pg_temp.su();
select pg_temp.mkpo(1,1,'[{"item":"a","qty":10,"harga":100}]');
select pg_temp.mkpo(2,1,'[{"item":"b","qty":10,"harga":100}]');
select pg_temp.act(1);
select pg_temp.recv(1,'pv-r1','[{"line":1,"qty":10}]') as r1 \gset
select (select pg_temp.recv(2,'pv-r2','[{"line":1,"qty":10}]')) as r2 \gset
select pg_temp.inv(2,'pv-i2','[{"line":1,"qty":10,"harga":100}]',array[:'r2'::uuid]) as i2 \gset
select (pay_purchase_invoice_atomic('pv-p2',:'i2'::uuid,current_date,400,'Transfer',null,'bd700000-0000-4000-8000-000000000001',null))->>'payment_id' as p2 \gset

-- Periode akuntansi dikunci sampai hari ini: penerimaan, faktur, pembayaran tidak bisa dibatalkan; pratinjau menyebut kunci.
select pg_temp.su();
update accounting_locks set closed_until=current_date;
select pg_temp.act(1);
select pg_temp.diff(:'r1'::uuid,'08 periode ditutup');
select preview_goods_receipt_cancellation(:'r1'::uuid) as pv \gset
select pg_temp.ok(:'pv'::jsonb#>>'{blockers,0,code}'='periode_tertutup' and (:'pv'::jsonb#>>'{blockers,0,message}') like '%Keuangan > Tutup Buku%','pratinjau: periode dikunci + petunjuk Tutup Buku');
select pg_temp.digest() as d0 \gset
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'r1','pv-c1','Coba'),'Periode akuntansi');
select pg_temp.expect_error(format('select cancel_purchase_payment(%L,0,%L,%L)',:'p2','pv-c2','Coba'),'sudah ditutup');
select pg_temp.ok(pg_temp.digest()=:'d0','periode tertutup: tanpa efek');
-- Owner melepas kunci (jalur Tutup Buku), lalu semuanya berhasil.
select pg_temp.su();
update accounting_locks set closed_until=null;
select pg_temp.act(1);
select pg_temp.diff(:'r1'::uuid,'08 periode dibuka');
select pg_temp.ok((preview_goods_receipt_cancellation(:'r1'::uuid)->>'can_cancel')::boolean,'pratinjau: bisa setelah kunci dilepas');

-- Tanggal dan alasan.
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date+1)',:'r1','pv-d1','Coba'),'masa depan');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L,current_date-1)',:'r1','pv-d2','Coba'),'sebelum tanggal penerimaan');
select pg_temp.ok((select (preview_goods_receipt_cancellation(:'r1'::uuid,current_date-1)#>>'{blockers,0,code}')='tanggal_tidak_valid'),'pratinjau: tanggal sebelum penerimaan');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'r1','pv-a1','  x '),'Alasan pembatalan wajib');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'r1',' pv-k ','Alasan sah'),'Identitas pembatalan tidak valid');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'r1',repeat('k',121),'Alasan sah'),'Identitas pembatalan tidak valid');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)','bd800000-0000-4000-8000-000000000999','pv-nf','Alasan sah'),'tidak ditemukan');
select pg_temp.expect_error(format('select preview_goods_receipt_cancellation(%L)','bd800000-0000-4000-8000-000000000999'),'tidak ditemukan');
select pg_temp.ok(pg_temp.digest()=:'d0','validasi: tanpa efek');
-- Kunci permintaan: sama = ulang hasil; kunci sama alasan lain = ditolak; penerimaan sudah batal = pratinjau "sudah dibatalkan".
select cancel_goods_receipt(:'r1'::uuid,'pv-ok','Salah input') as c1 \gset
select pg_temp.ok(cancel_goods_receipt(:'r1'::uuid,'pv-ok','Salah input')=:'c1'::jsonb,'kunci sama: hasil sama');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'r1','pv-ok','Alasan berbeda'),'rincian berbeda');
select pg_temp.ok((preview_goods_receipt_cancellation(:'r1'::uuid)->>'already_cancelled')::boolean and not (preview_goods_receipt_cancellation(:'r1'::uuid)->>'can_cancel')::boolean,'pratinjau penerimaan batal: sudah dibatalkan');
select pg_temp.ok((select count(*) from purchase_receipt_cancellations)=1,'tepat satu bukti pembatalan');

-- Cakupan: FINANCE (modul pembelian tidak ada), peran dibatasi cabang, dan anon.
select pg_temp.act(3);
select pg_temp.expect_error(format('select preview_goods_receipt_cancellation(%L)',:'r2'),'Akses modul ditolak');
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_penerimaan'],array['pembelian','kas-bank'],false);
select pg_temp.act(2);
select pg_temp.expect_error(format('select preview_goods_receipt_cancellation(%L)',:'r2'),'Cabang tidak dapat diakses');
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'r2','pv-br','Coba'),'Cabang tidak dapat diakses');
select pg_temp.grant_role('ADMIN',array['pembelian.batalkan_penerimaan'],array['kas-bank'],true);
select pg_temp.act(2);
select pg_temp.expect_error(format('select cancel_goods_receipt(%L,%L,%L)',:'r2','pv-md','Coba'),'Akses modul ditolak');
select pg_temp.su();
set local role anon;
do $$ begin
 begin perform preview_goods_receipt_cancellation('bd800000-0000-4000-8000-000000000999'); raise exception 'anon boleh memanggil pratinjau';
 exception when insufficient_privilege then null; end;
 begin perform cancel_goods_receipt('bd800000-0000-4000-8000-000000000999','x','alasan sah'); raise exception 'anon boleh membatalkan';
 exception when insufficient_privilege then null; end;
 begin perform reopen_purchase_order_remainder('bd800000-0000-4000-8000-000000000999','x','alasan sah'); raise exception 'anon boleh membuka kembali';
 exception when insufficient_privilege then null; end;
end $$;
select pg_temp.su();
select pg_temp.invariants('08 selesai');
