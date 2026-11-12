-- Dompet e-commerce (13xxxx) menjadi rekening Kas & Bank (12 Nov 2026).
--
-- Pelapor: Mba Anisa via Reza. Ada pemindahan uang dari saldo e-commerce (Shopee/Tokopedia/Lazada/TikTok per
-- toko) ke bank, tapi di Transfer Kas akun saldo e-commerce tidak muncul. Penyebab: bagan akun baru
-- (20261105010000) punya akun dompet 130001–130008 di bawah induk 130000 "Ecommers", tetapi yang
-- didaftarkan sebagai rekening (20261112070356) hanya 11xxxx/12xxxx. Semua pilihan rekening (Transfer,
-- Kas Masuk/Keluar, pencairan penjualan online, rekonsiliasi) membaca daftar rekening.
--
-- Keputusan Reza (12 Nov): pencairan penjualan online boleh masuk ke dompet tokonya dulu, lalu ditarik ke bank
-- lewat Transfer. Karena itu dompet didaftarkan dengan jenis 'Bank' (pencairan online & rekonsiliasi hanya
-- menawarkan jenis Bank). Nama rekening = nama akun, tanpa cabang (bisa dipakai semua cabang).
--
-- Tidak termasuk: 130009 Piutang Marketplace (itu tagihan ke platform, bukan dompet) dan akun induk.
-- Idempoten: rekening yang sudah ada (termasuk nonaktif / sudah diganti nama finance) tidak disentuh.
-- Tidak ada jurnal yang dibuat atau dipindah.

insert into public.cash_accounts(nama, jenis, coa_code)
select left(btrim(a.name), 80), 'Bank', a.code
  from public.coa_accounts a
 where a.code ~ '^13[0-9]{4}$'
   and a.code <> '130009'
   and a.is_active and not a.is_header and a.type = 'ASET'
   and not exists (select 1 from public.cash_accounts c where c.coa_code = a.code)
 order by a.code;
