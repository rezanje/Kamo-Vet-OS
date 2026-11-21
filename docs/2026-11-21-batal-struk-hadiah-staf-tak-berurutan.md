# Batalkan struk kasir walau kasir sudah jualan lagi (21 Nov 2026)

Permintaan Reza (opsi A) setelah POS-20261120-0008-K821 (Kamo Petshop Muara, double input dari POS-20261120-0006-FAT0)
tidak bisa dibatalkan, baik dari aplikasi maupun lewat fungsi resmi: "Transaksi staf berikutnya masih aktif".
Kasus kedua sesudah POS-20261117-0009-BJF5 (waktu itu hanya pesannya yang diperjelas).

## Akar masalah

`reverse_sale_staff_effects` (dipanggil `cancel_posted_sale` dan jalur Ubah transaksi) mengembalikan snapshot
"sebelum" poin / rangkaian (streak) / progres misi kasir, jadi hanya aman dari efek staf TERAKHIR (LIFO). Kasir
yang sudah membuat transaksi lain sesudah struk itu, yang hampir selalu terjadi, membuat pembatalan ditolak seluruhnya.

## Perubahan: `supabase/migrations/20261202100000_batal_struk_hadiah_staf_tak_berurutan.sql`

Bila masih ada efek staf aktif sesudahnya, pembalikan di luar urutan diizinkan **hanya** kalau struk itu:
- tidak memberi poin (`ledger_ids` kosong, poin sebelum = sesudah);
- tidak mengubah rangkaian aktivitas (bukan struk pertama kasir hari itu);
- hanya menambah `current_value` pada baris progres misi yang sudah ada sebelumnya, tanpa mengubah status /
  `completed_at` / `claimed_at`, dan status/klaim baris itu SEKARANG masih sama (misi tidak diselesaikan atau diklaim
  oleh transaksi sesudahnya).

Progres dibalik sebagai selisih (`current_value - kontribusi struk`). Snapshot efek staf aktif sesudahnya ikut
dikurangi selisih yang sama (`before_value.progress[].row.current_value`, `after_value.progress[].current_value`),
sehingga pembalikan berurutan mereka nanti tetap persis. Selain kasus itu, perilaku lama (tolak) dan jalur LIFO
tidak berubah. Pesan penolakan di layar (`src/app/(app)/penjualan/[id]/actions.ts`) disesuaikan.

## Tes

- `scripts/test-batal-struk-hadiah-staf-postgres.py` (rantai 459 migrasi, PostgreSQL lokal sekali pakai, data fiktif):
  11/11 PASS; `--baseline` (tanpa migrasi): 6/6 kasus fitur RED, 5/5 regresi PASS.
  Kasus: struk tengah batal + progres -100.000 persis, lalu sisa struk batal berurutan kembali persis; struk pembuka
  rangkaian, struk yang memberi poin, dan struk yang misinya diselesaikan transaksi sesudahnya tetap ditolak; misi yang
  sudah selesai sebelumnya tetap selesai; ulang permintaan tidak mengurangi dua kali.
- `scripts/test-b3-jurnal-batal-tanggal-asli-postgres.py`: 33/33 PASS.
- `scripts/test-batalkan-penerimaan-petshop-postgres.py`: 18 pass / 1 fail; fail (`pos_payment_method_corrections.sql`
  NEIGHBOUR) sama persis tanpa migrasi ini, jadi bukan regresi.
- Vitest `penolakan-struk-actions` + `ubah-transaksi-action`: 24/24; lint 0 error; `tsc --noEmit` bersih.

## Production

- Migrasi diterapkan 21 Nov 2026 lewat Supabase `apply_migration` (`batal_struk_hadiah_staf_tak_berurutan`),
  setelah uji coba (migrasi + pembatalan) di dalam transaksi yang di-rollback.
- POS-20261120-0008-K821 dibatalkan 21 Nov 12.14 WIB (akun sistem "Owner", alasan: double input, atas permintaan Anisa lewat Reza).
  Shift 20 Nov sudah ditutup, jadi lewat 2 langkah resmi:
  1. `cancel_pos_sale_receipt` tanggal efektif 2026-11-20: QRIS 67.000 dibalik di 20 Nov (`shift_mode` nonkas, laci kas tidak tersentuh);
  2. `cancel_posted_sale`: pendapatan dibalik di 20 Nov, stok 2 barang (ANC Cat Litter 5,5L Coffee, Mr Vet T2 Hair & Skin 300gr)
     dan HPP kembali 21 Nov.
- Progres misi "Testing Quest" kasir: 1.685.500 → 1.618.500, tetap selesai; poin kasir tidak berubah.
- POS-20261120-0006-FAT0 (struk asli muara dini) tetap aktif.
