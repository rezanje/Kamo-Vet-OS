# Dompet e-commerce di Transfer Kas, plus edit dan lampiran Kas & Transfer untuk Admin/Finance (12 Nov 2026)

Pelapor: Mba Anisa lewat Reza.

1. Saldo akun e-commerce tidak muncul di Transfer Kas, padahal ada pemindahan dari saldo e-commerce ke bank.
2. Pengeluaran, transfer kas, dan penerimaan kas perlu akses edit: tanggal, item, lampiran, dan lainnya.

Keputusan Reza (12 Nov):

- Akses edit diberikan ke **Admin + Finance**, selain Super Admin/OWNER.
- Pencairan penjualan online boleh masuk ke **dompet toko** dulu, lalu ditarik ke bank lewat Transfer.

## 1. Dompet e-commerce jadi rekening

Penyebab: bagan akun baru (`20261105010000`) membuat akun dompet 130001–130008 (TikTok B2C, Lazada B2C,
Shopee B2C, Shopee Bogor, Shopee Bandung, Tokopedia Bogor, Lazada Bogor, Tokopedia Bandung) di bawah induk
130000. Yang terdaftar sebagai rekening (`20261112070356`) hanya akun 11xxxx dan 12xxxx, sehingga dompet tidak
bisa dipilih di layar mana pun. Saldo dompet di Production pada 12 Nov masih Rp 0, tanpa jurnal.

Perbaikan ada di migrasi `20261112081850_dompet_ecommerce_jadi_rekening.sql`. Migrasi ini idempoten dan tidak
membuat jurnal:

- Setiap akun aktif bukan-induk bertipe ASET berkode `13xxxx`, kecuali 130009 Piutang Marketplace, didaftarkan
  sebagai rekening dengan jenis **Bank**, nama sama dengan nama akun, berlaku untuk semua cabang.
- Jenis Bank dipilih karena pencairan penjualan online dan rekonsiliasi hanya menawarkan rekening Bank. Dengan
  begitu dompet langsung muncul di Transfer, Kas Masuk/Keluar, tujuan pencairan online, dan rekonsiliasi.
- Rekening yang sudah ada, termasuk yang dinonaktifkan atau diganti nama, tidak disentuh.

Alur setelah rilis:

- Penjualan online tetap tercatat sebagai Piutang Marketplace.
- Saat dana cair, pilih "Masuk ke rekening" = dompet tokonya, misalnya Shopee Bogor.
- Penarikan ke bank dicatat lewat Transfer Kas dari dompet ke rekening BCA.
- Saldo awal dompet, kalau ada, dicatat finance satu kali lewat Kas Masuk atau jurnal saldo awal.

Verifikasi: `python3 -I scripts/test-dompet-ecommerce-rekening-postgres.py`, memakai PostgreSQL sekali pakai
dengan semua migrasi.

## 2. Edit Kas Masuk/Keluar & Transfer untuk Admin/Finance

Migrasi `20261112083122_edit_kas_transfer_admin_finance.sql`:

- `internal_transfer_access`: koreksi dan batal transfer kini boleh dilakukan OWNER, ADMIN, dan FINANCE aktif.
  Sebelumnya hanya OWNER.
- `revise_cash_entry`: pembatas "Hanya Super Admin yang bisa mengedit kas" dihapus. Daftar peran tetap
  OWNER/ADMIN/FINANCE.
- `mutate_cash_transfer`: koreksi boleh mengganti **tanggal**. Jurnal pembalik tetap di tanggal asli, jurnal
  pengganti di tanggal baru. Tanggal baru tetap ditolak bila di masa depan, di periode tertutup, atau tercakup
  rekonsiliasi bank. Cabang tetap mengikuti catatan asli.
- Dua fungsi terakhir sudah dipatch berlapis, jadi perubahannya dilakukan dengan mengganti teks pada definisi
  yang sedang berjalan. Penggantian wajib menemukan tepat satu potongan teks, kalau tidak migrasi gagal.
  Menjalankan ulang migrasi tidak mengubah apa-apa.
- Pengaman yang tetap berlaku: akses cabang, tutup buku, rekonsiliasi, revisi bersamaan, alasan wajib, jurnal
  pembalik + pengganti, dan jejak revisi. Izin per grup `bank.cash_transfer.*` di Pengaturan > Akses Grup juga
  tetap berlaku.

Perubahan aplikasi:

- Kas Masuk/Keluar: form "Edit / koreksi" (tanggal, rekening, akun, jumlah, keterangan) tampil untuk
  OWNER/ADMIN/FINANCE. Server action `koreksiKasEntry` memakai daftar peran yang sama.
- Transfer: tautan Koreksi dan Batalkan tampil untuk OWNER/ADMIN/FINANCE. Form koreksi kini punya isian tanggal.
  Server action edit dan void memakai peran yang sama.

## 3. Lampiran setelah transaksi tersimpan

- Halaman baru:
  - `/kas-bank/kas-keluar/lampiran/[id]`
  - `/kas-bank/kas-masuk/lampiran/[id]`
  - `/kas-bank/transfer/lampiran/[id]`
- Ketiganya memakai `LampiranKasScreen` dan `DokumenPanel` yang sudah ada untuk melihat, menambah, dan menghapus
  file. Hak akses OWNER/ADMIN/FINANCE.
- Halaman berada di bawah rute submenu masing-masing, jadi otomatis ikut pengaturan submenu.
- Lampiran kas tetap memakai modul `pengeluaran`, sama dengan yang ditulis saat Kas Masuk/Keluar disimpan.
  Transfer memakai modul baru `transfer`, yang sudah ditambahkan ke `MODUL_DOKUMEN`.
- Daftar Kas Masuk/Keluar dan Transfer kini punya tautan "Lampiran" di kolom Aksi.

## Verifikasi lokal

- `python3 -I scripts/test-edit-kas-transfer-admin-finance-postgres.py`, PostgreSQL sekali pakai dengan
  418 migrasi:
  - menjalankan ulang migrasi tidak mengubah apa-apa;
  - isi fungsi sesuai rencana, dengan pengaturan dan izin yang tidak berubah;
  - SQL suite `cash-entry-corrections.sql`: FINANCE lolos pemeriksaan akses edit;
  - SQL suite `internal_transfer_corrections.sql`: ADMIN/FINANCE bisa koreksi dan batal; ganti tanggal
    menghasilkan pembalik di tanggal asli dan pengganti di tanggal baru; ganti cabang dan tanggal masa depan
    ditolak; semua jurnal seimbang.
- Catatan: `cash-entry-corrections.sql` sudah gagal di main sebelum perubahan ini. Suite itu memilih "rekening
  pertama" (`limit 1`), padahal sejak `20261112070356` rekening pertama bukan lagi 110003. Suite kini dikunci ke
  rekening fixture 110003.
- Vitest penuh: 927 file lulus. `npm run lint`: 0 error. `tsc --noEmit` dan `next build` lulus.

## Rilis

1. Terapkan kedua migrasi ke Production: `20261112081850`, lalu `20261112083122`. Keduanya aman dijalankan
   sebelum atau sesudah aplikasi baru live. Kalau aplikasi lebih dulu live, tombol edit untuk Admin/Finance akan
   ditolak database dengan pesan yang jelas sampai migrasi kedua terpasang.
2. Kueri baca sesudah pasang:

```sql
select coa_code, jenis, nama, branch_id is null semua_cabang from cash_accounts where coa_code like '13%' order by 1;
-- 130001–130008, jenis Bank, semua cabang
select position('Hanya Super Admin yang bisa mengedit kas' in pg_get_functiondef('public.revise_cash_entry(text,uuid,integer,text,jsonb,text)'::regprocedure));  -- 0
select position('d<>doc.tanggal' in pg_get_functiondef('public.mutate_cash_transfer(text,text,uuid,integer,jsonb,text)'::regprocedure));  -- 0
```

Catatan akses: per 12 Nov, grup ADMIN di Production belum diberi izin Transfer (menu dan tindakan
`bank.cash_transfer.*`). Admin baru bisa memakai dan mengoreksi Transfer setelah OWNER menyalakannya di
Pengaturan > Akses Grup. Finance sudah bisa.

## Status Production (12 Nov 2026)

- Kedua migrasi diterapkan langsung ke Production lewat konektor Supabase atas izin Reza. Versinya tercatat
  `20261112081850` dan `20261112083122`, dan nama berkas di repo disamakan dengan versi itu.
- Kueri baca sesudah pasang:
  - 8 dompet 130001–130008 terdaftar sebagai rekening Bank untuk semua cabang.
  - Pembatas "Hanya Super Admin" sudah tidak ada di `revise_cash_entry` maupun `internal_transfer_access`.
  - Aturan "tanggal sama" sudah tidak ada di `mutate_cash_transfer`, sementara aturan cabang tetap ada.
  - `search_path` dan `lock_timeout` fungsi tetap, izin `authenticated` tetap.
- Atas permintaan Reza, grup ADMIN diberi akses Transfer lewat RPC resmi `save_role_access_config`. RPC itu
  dijalankan dengan identitas akun Owner (`f34a14f2-…`); alasan tercatat di audit akses, id
  `799e54b5-b930-494d-9356-21892bb08fcb`.
  - Yang ditambahkan: submenu `kas-bank.transfer` dan tindakan `bank.cash_transfer.create/edit/void/recover`.
  - Modul, kapabilitas, submenu, dan tindakan lain tetap sama. Epoch ADMIN naik dari 9 ke 10.
