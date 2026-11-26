# 26 Nov 2026 — Kas Keluar per periode, fee merchant ke Beban Admin EDC, tautan mutasi

Pelapor: Anisa (Finance), 25–26 Nov 2026. PR #591.

## 1. Kas Keluar hanya tampil mulai 19 Nov
- Penyebab: riwayat dibatasi 50 bukti kas + 100 pengeluaran kasir terbaru.
- Perbaikan: saringan Dari/Sampai tanggal (bawaan awal bulan s/d hari ini WIB), dimuat per halaman 1000
  sampai habis, batas pengaman 10.000 baris/sumber dengan peringatan.

## 2. Rincian mutasi akun belum tersambung ke transaksi
- Struk POS ber-akhiran acak (`POS-20261101-0001-6L1M`, ±75% struk Nov) gagal dikenali `tampakNomorDokumen`.
  Pola sekarang menerima akhiran `-XXXX`.
- Jurnal ber-`source_ref` UUID: `expense*` → `/buku-besar/beban/<id>` (label "Pengeluaran kasir"),
  `manual*` → `/keuangan/jurnal?entry=<id>`. Koreksi/pembalik kas mengambil nomor KK/KM dari keterangan.
- Berlaku di Buku Besar dan daftar Jurnal (keduanya lewat `NoDok`).

## 3. Edit pengeluaran yang diinput toko
- Fitur edit sudah ada di detail pengeluaran (`/buku-besar/beban/<id>`, OWNER/ADMIN/FINANCE, jurnal koreksi).
- Kas Keluar sekarang punya tombol **Edit** (atau **Lihat** bila dibatalkan / tanpa hak edit) di kolom Aksi.

## 4. Fee merchant → 740018 Beban Admin EDC
- Migrasi `20261214100000_fee_merchant_beban_admin_edc.sql` (tambalan jangkar eksak, gagal tertutup):
  - `pos_sale_record_payments`: Cr 740018 (dulu Cr 810004).
  - `pos_sale_post_refund` / `_selected`: fee sumber dibaca dari 810004 atau 740018; dibalik ke akun sumbernya.
  - `coa_import_system_codes` + `KODE_SISTEM`: 740018 jadi akun sistem.
- Uji kering di Production dalam transaksi yang dibatalkan: semua jangkar ketemu, fungsi terkompilasi,
  database live tidak berubah (diverifikasi sesudahnya).
- **Belum diterapkan ke Production** — diterapkan setelah PR di-merge.
- Data lama: 29 struk ber-fee 1–25 Nov (Rp 43.740) tetap di 810004. Reklas opsional: jurnal manual
  Dr 810004 / Cr 740018 oleh Finance.
