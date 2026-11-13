-- J02 lanjutan (permintaan tim, 12 Nov 2026): "edit pembayaran ... transaksinya mental ke tgl yg diubahnya.
-- misal, saya ubah tgl 2 november ditgl 6. harusnya kan transaksinya ttp ditgl 2".
--
-- Sebelumnya jurnal pembalik ('sale-payment-reversal') dan jurnal pengganti ('sale-payment-repost') koreksi
-- metode bayar dibukukan di HARI KOREKSI, sehingga di Kas & Bank / Buku Besar uangnya pindah rekening pada
-- tanggal koreksi, bukan tanggal struk. Contoh nyata: POS-20261101-0051 (1 Nov) dikoreksi 12 Nov -> jurnal 12 Nov.
--
-- Perubahan: kedua jurnal kini bertanggal TANGGAL STRUK (source_date = created_at WIB), gaya Accurate.
-- Pagar yang sudah ada tetap berlaku dan sudah memakai tanggal struk:
--  * periode tertutup: ditolak bila tanggal struk (atau hari ini) <= tutup buku;
--  * rekonsiliasi bank: ditolak bila ada rekonsiliasi aktif bertanggal >= tanggal struk pada rekening terkait.
-- Waktu nyata koreksi tetap tercatat di sale_payment_corrections.created_at (+ pelaku + alasan).
-- Laci shift tidak disentuh (sama seperti sebelumnya). Jurnal koreksi yang sudah ada TIDAK diubah.
-- Patch berjangkar; signature, SECURITY, search_path, lock_timeout dan grant tidak berubah.
do $patch$
declare
 fn constant text:='public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric)';
 anchor constant text:=$a$public.sales_next_number('JRN',today),today,$a$;
 replacement constant text:=$r$public.sales_next_number('JRN',source_date),source_date,$r$;
 body text;found_count integer;
begin
 body:=pg_get_functiondef(fn::regprocedure);
 if position('J02_AKUN_LAMA' in body)=0 then
  raise exception 'J02_TANGGAL_ASLI requires J02_AKUN_LAMA (20261115300000) first';end if;
 if position('J02_TANGGAL_ASLI' in body)>0 then
  raise exception 'J02_TANGGAL_ASLI patch already present in %; verify migration history',fn;end if;
 found_count:=(length(body)-length(replace(body,anchor,'')))/length(anchor);
 if found_count<>2 then
  raise exception 'J02_TANGGAL_ASLI anchor found % time(s) in %, expected 2',found_count,fn;end if;
 body:=replace(body,anchor,replacement);
 body:=replace(body,$a$ -- Serializes the as-of ledger snapshot$a$,
  $r$ -- J02_TANGGAL_ASLI: jurnal pembalik dan pengganti dibukukan di tanggal struk (source_date), bukan hari koreksi.
 -- Serializes the as-of ledger snapshot$r$);
 if position('J02_TANGGAL_ASLI' in body)=0 then
  raise exception 'J02_TANGGAL_ASLI marker anchor not found in %',fn;end if;
 execute body;
end $patch$;

revoke all on function public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric)
 from public,anon,authenticated,service_role;
grant execute on function public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric) to authenticated;
