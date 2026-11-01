# Racikan tidak muncul di layar Edit rekam medis (1 Nov 2026)

## Laporan
Anisa (grup "Kamo Group – ERP Dev", 15.56 WIB): "Racik racik mental lagi mas, ga muncul di sini" — foto layar
Rekam medis → INPUT OBAT & JASA (POS) → tab **Tindakan & Racikan**, cari `racik` → "Tidak ada tindakan / racikan cocok".
Keranjang berisi Vaksinasi F4, Biaya Admin, Anthel Cat dengan pemilih "Ganti item" di bawah tiap nama — itu tanda
layar **Edit rekam medis sebelum tagihan terbit** (`?edit=<id rekam medis>`, `correction.fullEdit`). Akun Anisa: OWNER.

## Penyebab
- Data barang baik: 43 SKU "Obat Racik …" aktif, Persediaan, bukan bahan racikan (dicek baca-saja di produksi).
- `RekamForm` sengaja mengirim `racikanItems={correction?.fullEdit ? [] : racikanItems}` sejak fitur Edit penuh
  (29b5060, 30 Okt), karena RPC `clinic_edit_queued_record` menolak racikan baru (`COMPOUND_LOCKED`): bahan racikan
  harus keluar lewat alur racik berjejak, bukan disimpan sebagai baris resep biasa.
- Jalur racik berjejak untuk rekam medis tersimpan sudah ada (`clinic_add_record_items`, item susulan 20261104340000,
  dipakai halaman "Tambah tindakan / obat"), tapi layar Edit tidak memakainya.

## Perbaikan
1. Migrasi `20261106020000_racikan_baru_di_edit_rekam_medis.sql` — RPC baru
   `clinic_edit_queued_record_with_compounds(...)` (SECURITY DEFINER, hanya `authenticated`), dipakai untuk SETIAP
   simpan Edit penuh: koordinator tagihan → gerbang peran/cabang → buku kunci `clinic_private.record_edit_requests`
   (sidik seluruh kiriman per pelaku+kunci) → `clinic_edit_queued_record` apa adanya → bila ada racikan baru
   `clinic_add_record_items(visit, 'edit-racikan:'||md5(uid:key), '[]', p_compounds)` → pastikan racikan masuk ke rekam
   medis yang sama. Satu transaksi: stok bahan kurang / peran salah / tagihan sudah ada → semuanya batal. Aditif, tidak ada
   fungsi lama yang ditulis ulang.
   - Buku kunci (temuan review): kedua RPC di dalam hanya membandingkan sebagian kiriman (edit: baris resep; item
     susulan: racikan). Tanpa buku kunci, respons hilang → racikan dihapus → simpan lagi dengan kunci sama akan dibalas
     "tersimpan" padahal racikan sudah terlanjur diracik. Sekarang ditolak `IDEMPOTENCY_CONFLICT` ("muat ulang").
2. `koreksiRekamMedisLengkap`: baris `jenis='racikan'` tanpa `prescription_item_id`/`compound_recipe_id` = racikan baru
   → `p_compounds` (bentuk sama dengan item susulan, helper `compoundPayload`); baris lain → `p_rows` persis seperti
   dulu. Semua simpan lewat pembungkus; bila fungsi belum terpasang (PGRST202) dan tidak ada racikan baru, jatuh ke
   `clinic_edit_queued_record` persis seperti sebelumnya; dengan racikan baru → pesan jelas. Penolakan peracikan
   (STOCK_SHORT dll.) diterjemahkan seperti form pemeriksaan.
3. `RekamForm`: racikan tampil di Edit; baris racikan baru tidak punya "Ganti item"; textarea catatan resep umum
   disembunyikan saat koreksi (koreksi memang tidak pernah menyimpannya).

## Uji
- Vitest baru: `racikan-edit-rekam-medis.test.tsx` (UI), `racikan-edit-rekam-medis-action.test.ts` (aksi) — merah di
  kode lama, hijau di kode baru. Seluruh suite vitest hijau.
- PostgreSQL sekali-pakai, rantai migrasi penuh: `scripts/test-racikan-edit-rekam-medis-postgres.py` 24/24
  (`--baseline` merah: fungsi belum ada). Regresi: `test-rekam-full-edit-postgres.py --include-cashier` 41/41,
  `test-item-susulan-full-schema-postgres.py` 18/18, `test-item-susulan-keranjang-postgres.py` 17/17.
  (Mode bawaan `test-rekam-full-edit-postgres.py` tanpa `--include-cashier` memang sudah gagal sebelum perubahan ini:
  migrasi item susulan butuh kolom dari migrasi kasir rawat inap yang dikecualikan mode itu.)

## Catatan
- Racikan baru di Edit langsung diracik saat disimpan (stok bahan keluar), sama seperti form pemeriksaan & item susulan.
- Racikan yang sudah dibuat tetap dikoreksi lewat Aksi racikan (stok tidak keluar dua kali).
