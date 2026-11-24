-- Opname: barang yang terjual SESUDAH dihitung sampai stoknya lebih kecil dari selisih kurang.
-- Apply as ONE transaction (seluruh file satu transaksi; file ini sengaja tanpa begin/commit sendiri).
--
-- INSIDEN (24 Nov 2026, OPO.00013 SO BULAN NOV PET GRANADA, 378 barang)
--  "Simpan semua & sesuaikan stok" selalu gagal dengan pesan umum
--  "Stok/lapisan biaya tidak cukup atau tidak konsisten. Rekonsiliasi diperlukan" tanpa menyebut barangnya.
--  Penyebab: Life cat Tofu 7L Sweet Bubble Gum dikunci 11:53 WIB dengan stok sistem 6, fisik 0 (selisih -6),
--  lalu 13:56 WIB terjual 1 di kasir -> stok sekarang 5. Posting memakai SELISIH terhadap foto saat dikunci
--  (supaya penjualan sesudah hitung tidak terhapus), jadi harus mengeluarkan 6 dari stok 5 -> ditolak jauh di
--  dalam issue_stock_document_recorded dengan pesan generik. Hitungan fisik 0 bertentangan dengan penjualan
--  sesudahnya (barangnya ternyata ada), jadi jalan keluar yang benar adalah hitung ulang barang itu.
--
-- RANCANGAN
--  post_opname_atomic memeriksa lebih dulu (sebelum nomor hasil dibuat / apa pun ditulis): baris dengan selisih
--  kurang yang stok sistem SEKARANG-nya lebih kecil dari jumlah yang akan dikeluarkan. Bila ada, posting ditolak
--  dengan pesan yang menyebut nama barang, hitungan, stok saat dikunci, dan stok sekarang, plus petunjuk
--  "Buka kunci, hitung ulang, simpan lagi". Aturan stok, jurnal, dan perilaku lain tidak berubah; sebelumnya
--  kasus ini juga ditolak, hanya pesannya yang tidak bisa ditindaklanjuti.
--
-- ROLLBACK: terapkan tambalan balik (tukar old_text/new_text di bagian 2). Tidak ada data yang berubah.
set local lock_timeout = '5s';

do $guard$
begin
 if to_regprocedure('public.post_opname_atomic(uuid,date,jsonb)') is null
  or to_regprocedure('public.issue_stock_document_recorded(text,uuid,uuid)') is null then
  raise exception 'OPNAME_HITUNG_ULANG_PRECONDITION: fungsi posting opname tidak ada';
 end if;
 if position('Hitungan barang berikut perlu diulang' in pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure))>0 then
  raise exception 'OPNAME_HITUNG_ULANG_PRECONDITION: tambalan sudah terpasang';
 end if;
end $guard$;

do $patch$
declare p record; definition text; found_count integer;
begin
 definition := pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure);
 for p in select * from (values
  (E' acc_gain text:=public.stock_opname_account(''gain'');\nbegin',
   E' acc_gain text:=public.stock_opname_account(''gain'');\n recount text;\nbegin'),
  (E'then raise exception ''Saldo/lapisan stok tidak konsisten. Rekonsiliasi sumber diperlukan.'';end if;\n',
   E'then raise exception ''Saldo/lapisan stok tidak konsisten. Rekonsiliasi sumber diperlukan.'';end if;\n'
   || E' -- Selisih dihitung terhadap foto saat dikunci. Bila sesudah dikunci barangnya masih terjual/keluar sampai stok\n'
   || E' -- sekarang lebih kecil dari jumlah yang akan dikurangi, hitungan fisiknya bertentangan dengan transaksi -> hitung ulang.\n'
   || E' select string_agg(format(''%s (dihitung %s, stok saat dikunci %s, stok sekarang %s)'',x.name,trim_scale(x.qty_fisik),trim_scale(x.qty_sistem),trim_scale(s.qty)),''; '' order by x.name)\n'
   || E'  into recount from jsonb_to_recordset(rows) as x(item_id uuid,qty_sistem numeric,qty_fisik numeric,selisih numeric,name text)\n'
   || E'  join public.stock s on s.warehouse_id=wh.id and s.item_id=x.item_id where x.selisih<0 and s.qty<-x.selisih;\n'
   || E' if recount is not null then raise exception ''Hitungan barang berikut perlu diulang karena sesudah dihitung barangnya masih terjual/keluar, jadi stok sistem sekarang lebih kecil dari jumlah yang mau dikurangi: %. Buka kunci barang tersebut, hitung ulang fisiknya, lalu simpan lagi.'',recount;end if;\n')
 ) as patches(old_text, new_text) loop
  found_count := (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text);
  if found_count <> 1 then
   raise exception 'OPNAME_HITUNG_ULANG: jangkar harus muncul 1 kali (ditemukan %): %', found_count, left(p.old_text, 90);
  end if;
  definition := replace(definition, p.old_text, p.new_text);
 end loop;
 execute definition;
end $patch$;

revoke all on function public.post_opname_atomic(uuid,date,jsonb) from public,anon,service_role;
grant execute on function public.post_opname_atomic(uuid,date,jsonb) to authenticated;

do $check$
declare d text := pg_get_functiondef('public.post_opname_atomic(uuid,date,jsonb)'::regprocedure);
begin
 if position('Hitungan barang berikut perlu diulang' in d)=0
  or position('s.qty<-x.selisih' in d)=0
  or position('if recount is not null' in d)>position('ref:=public.opname_posting_number' in d) then
  raise exception 'OPNAME_HITUNG_ULANG: pemeriksaan hitung ulang belum terpasang sebelum penomoran hasil';
 end if;
 if not has_function_privilege('authenticated','public.post_opname_atomic(uuid,date,jsonb)','EXECUTE')
  or has_function_privilege('anon','public.post_opname_atomic(uuid,date,jsonb)','EXECUTE') then
  raise exception 'OPNAME_HITUNG_ULANG: ACL posting opname salah';
 end if;
end $check$;
