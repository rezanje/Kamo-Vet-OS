-- Semua akun Kas (11xxxx) & Bank (12xxxx) di bagan akun menjadi rekening Kas & Bank (12 Nov 2026).
--
-- Pelapor: Reza — form "Terima / periksa" piutang (Faktur Penjualan) cuma menawarkan "Bank BCA" tanpa
-- keterangan rekening mana. Penyebab: bagan akun baru (20261105010000) membuat 120001–120006 (6 rekening
-- BCA) dan 110001–110022 (kas), tetapi yang terdaftar sebagai rekening Kas & Bank hanya akun bawaan
-- (110003 "Kas", 120002 "Bank BCA") plus Kas Toko per cabang (20261107010000). Semua pilihan rekening di
-- aplikasi (penerimaan piutang, uang muka, pembayaran hutang, gaji, aset, beban, transfer, kas masuk/keluar)
-- membaca daftar rekening, dan RPC penerimaan hanya menerima rekening terdaftar — jadi akun lain tidak bisa
-- dipilih sama sekali.
--
-- Perbaikan (idempoten, tidak menimpa pengaturan finance):
--  1. Setiap akun aktif bukan-induk bertipe ASET dengan kode 11xxxx/12xxxx yang belum punya rekening
--     didaftarkan: nama = nama akun, jenis Kas/Bank dari kodenya, tanpa cabang (bisa dipakai semua cabang),
--     nama bank BCA bila nama akun memuat "BCA", no. rekening dari angka dalam kurung di nama akun.
--     Rekening yang sudah ada (termasuk yang dinonaktifkan) TIDAK disentuh.
--  2. Dua rekening bawaan yang namanya masih nama bawaan ("Kas" → 110003, "Bank BCA" → 120002) diberi nama
--     akunnya supaya terbaca rekening mana (mis. "Bank BCA Transaksi (4270086743)"). Nama yang sudah diganti
--     finance dibiarkan.
--  3. No. rekening Bank yang masih kosong diisi dari nama akunnya (bila ada angka dalam kurung).
-- Tidak ada jurnal yang dibuat atau dipindah; Peta Rekening Pembayaran tidak berubah.

insert into public.cash_accounts(nama, jenis, coa_code, bank_nama, no_rekening)
select left(btrim(a.name), 80),
       case when a.code like '11%' then 'Kas' else 'Bank' end,
       a.code,
       case when a.code like '12%' and a.name ~* '(^|[^a-z])bca([^a-z]|$)' then 'BCA' end,
       case when a.code like '12%' then left(substring(a.name from '\(([0-9][0-9 .-]*[0-9])\)'), 40) end
  from public.coa_accounts a
 where a.code ~ '^1[12][0-9]{4}$'
   and a.is_active and not a.is_header and a.type = 'ASET'
   and not exists (select 1 from public.cash_accounts c where c.coa_code = a.code)
 order by a.code;

update public.cash_accounts c
   set nama = left(btrim(a.name), 80)
  from public.coa_accounts a
 where a.code = c.coa_code
   and ((c.coa_code = '110003' and c.nama = 'Kas') or (c.coa_code = '120002' and c.nama = 'Bank BCA'))
   and btrim(a.name) <> '';

update public.cash_accounts c
   set no_rekening = left(substring(a.name from '\(([0-9][0-9 .-]*[0-9])\)'), 40)
  from public.coa_accounts a
 where a.code = c.coa_code
   and c.jenis = 'Bank' and c.no_rekening is null
   and a.name ~ '\([0-9][0-9 .-]*[0-9]\)';
