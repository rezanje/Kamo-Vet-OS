# Reset transaksi & saldo stok — Production, 31 Okt 2026

Disetujui Reza di chat ("bukain 10 kuncinya dan gas", lalu "reset sekarang juga!"). Untuk 19 kunjungan
yang masih terbuka, Reza tidak memilih opsi secara eksplisit. Agen memakai opsi yang ia sarankan, yaitu
ikut dikosongkan dan kasir diberi daftar untuk ditindaklanjuti manual.

- Database: Supabase `koaglxcyjqfmgfzxszkj` (ap-northeast-2), migrasi terakhir `20261104360000`, **sebelum** PR #375.
- Waktu commit: 2026-10-31 14:51:03–14:52:12 UTC (21:51–21:52 WIB). Aktivitas terakhir sebelumnya 13:31 UTC.
- Bukti: `kamo_maintenance.transaction_reset_runs` (1 baris), salinannya di
  `scripts/maintenance/reset-transaksi-2026-10-31/receipt.json`.

## Cakupan
Klasifikasi seluruh 285 tabel `public` ada di `scope.py`: 159 tabel dikosongkan, 126 dilindungi. Tiga tabel
idempotensi pembayaran di `clinic_private` juga dikosongkan. Total 8.831 baris dihapus. Yang dikosongkan:
POS, retur, invoice klinik, pembayaran/kwitansi, DP, grosir, pembelian (PO/GRN/faktur/bayar/uang muka),
faktur saldo awal utang, jurnal, kas masuk/keluar, pengeluaran, shift kasir, stok/layer/mutasi, opname,
pemindahan, permintaan barang, produksi, poin pelanggan (18 pelanggan: `points`, `total_spending`,
`tier`, `tier_downgraded_at`), serta poin/quest/komisi staf. Lampiran bukti pengeluaran juga dibersihkan:
4 baris tabel dan 9 berkas di `dokumen/pengeluaran/`. Lima berkas di antaranya sudah yatim sejak reset 21 Okt.

Yang sengaja **dipertahankan**:
- master, pengguna, cabang/gudang;
- seluruh data klinis, termasuk impor dan `kamo_import.kartu_tertunda`;
- resep produksi/BOM, `import_runs`/`import_run_rows`, log audit, `arsip_20260801`;
- kasbon karyawan (14, Rp 14,3 jt) dan register aset tetap (3, Rp 70 jt). Saldo GL keduanya ikut nol,
  jadi perlu dimasukkan lewat saldo awal.
- `accurate_inventory_accounting` (6 baris) **dihapus**. Tabel ini catatan posting jurnal stok awal Accurate
  yang mengunci jurnal dan layer stok awal. Provenance impornya tetap ada di `import_runs`/`import_run_rows`.

## Mekanisme
Satu transaksi (`gen_reset.py`):
1. Cek set tabel sama persis dengan klasifikasi.
2. Kunci tulis semua tabel aplikasi.
3. Sidik jari 193 tabel yang dilindungi, log audit lama, ID auth, objek storage, dan skema
   (kolom, constraint, trigger, fungsi, RLS, policy).
4. Hanya 10 fungsi pengaman yang memblokir mendapat baris izin `DELETE` untuk tabel reset. Daftarnya
   ditemukan empiris lewat `find_needed.sh`: `guard_accurate_inventory_accounting`,
   `guard_completed_opname_counts`, `guard_po_receipt_closure_immutable`,
   `guard_purchase_receipt_cancellation_immutable`, `pos_sale_allocation_immutable`,
   `sales_allocations_immutable`, `guard_cancelled_opname_children`, `unit_posted_sale_source_immutable`,
   `guard_posted_sale_movement`, `guard_opening_invoice`. Perubahan ini tidak pernah ter-commit, karena
   definisi asli dibuat ulang sebelum akhir transaksi dan md5-nya dicek. Tidak ada trigger, FK, RLS, atau
   audit yang dimatikan. Setiap baris yang dihapus dicatat log aktivitas (+8.504 baris).
5. Hapus berurutan anak → induk.
6. Verifikasi. Gagal satu, semuanya rollback.

## Uji sebelum produksi
- Replika PostgreSQL 17 lokal (`build_replica.sh`). Skema identik dengan produksi: 6.955 objek, 0 beda.
- Backup logis tepat (`export.py`, teks jsonb per baris) dipulihkan ke kluster baru: 354/357 tabel identik
  byte-per-byte. Tiga sisanya tabel shim auth/storage lokal, jumlah barisnya cocok.
- Simulasi DRYRUN/EXECUTE di replika lulus.
- Uji negatif:
  - data dilindungi diubah di tengah proses → `KAMO_RESET_VERIFY`, rollback;
  - tabel baru belum diklasifikasi → abort;
  - ada transaksi tulis lain yang terbuka → lock timeout, abort;
  - definisi tambalan tidak pernah tersimpan.
- DRYRUN di produksi (rollback) lulus, lalu EXECUTE.

## Verifikasi pasca-reset (produksi)
- 159+3 tabel reset kosong; jurnal 0 (debit = kredit = 0); stok/layer/mutasi 0; shift 0; poin 0.
- 125 tabel dilindungi identik dengan backup. Tiga sisanya sesuai rencana:
  - `customers` identik di luar 4 kolom turunan;
  - `document_attachments` non-pengeluaran identik;
  - `activity_log` lama identik, hanya bertambah.
- Skema/pengaman/RLS identik (6.955 objek); 0 trigger nonaktif; 0 tabel tanpa RLS; 0 FK yatim.
- Pindai referensi lunak dari tabel dilindungi ke ID yang dihapus: 0 (`softref.sql`).
- Storage: `medical-docs` 5 dan `pet-photos` 12 berkas utuh.

## Backup
- Supabase Storage bucket **privat** `kamo-backup-internal/reset-2026-10-31/backup-kamo-sebelum-reset-20261031.tar.gz`
  (22 MB, sha256 `099d77b730a661afaf9954f7fcdf5c668a73ccce539a8269efc8924b7fc98f3a`; akses publik ditolak).
  Isinya seluruh tabel aplikasi (357, termasuk arsip & maintenance) + 26 berkas storage.
- Sebelum reset, backup ini dicek identik dengan produksi untuk 290 tabel.
- Backup harian Supabase terakhir sebelum reset: 2026-10-30 15:16 UTC (sebelum transaksi 31 Okt).
- Pemulihan: bangun ulang dari arsip dengan `build_replica.sh` + `load.py` (teruji). Mengembalikan baris ke
  produksi tidak bisa dengan role `postgres` tanpa melewati trigger insert, jadi pemulihan produksi =
  per kasus dari arsip ini, bukan timpa total.

## Sisa kendala / tindak lanjut
- **19 kunjungan masih terbuka**: 4 rawat inap; tagihan lama Rp 6,71 jt, sudah dibayar Rp 4,98 jt,
  sisa DP Rp 3,51 jt; 10 racikan yang stoknya sudah diambil tapi belum ditagih. Aplikasi sekarang
  menganggap semua item kunjungan itu belum ditagih. Kasir harus memotong yang sudah dibayar secara
  manual. Ke-10 racikan tidak bisa ditagih lewat alur normal (`RECIPE_LINKED`, karena histori HPP
  hilang), jadi perlu dibuat ulang setelah stok awal diisi. Daftar dengan nama pasien diberikan ke
  owner, tidak disimpan di repo.
- Kewajiban riil (utang pemasok Rp 122 jt saldo awal + faktur pembelian, DP pelanggan, piutang) **tidak
  hilang**. Semuanya harus dimasukkan lagi sebagai saldo awal dengan angka nyata.
- PR #375 belum terpasang saat reset. Migrasinya dijalankan sesudah ini seperti rencana.
- Temuan sampingan: `pos_sale_allocation_immutable` error `record "old" has no field "sale_id"` saat
  menghapus `sale_payment_refunds`.
- Tabel bukti `kamo_maintenance.transaction_reset_runs` dibuat langsung saat eksekusi (skema maintenance,
  di luar migrasi repo).
