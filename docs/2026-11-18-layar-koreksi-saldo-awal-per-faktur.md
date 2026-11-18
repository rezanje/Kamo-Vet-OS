# Layar koreksi nilai saldo awal per faktur (18 Nov 2026)

Permintaan Reza (opsi B), setelah dua koreksi lewat migrasi dalam dua hari (FB.2026.10.00079, FB.2026.10.00030).
Mulai sekarang Owner mengoreksi sendiri dari **Keuangan → Saldo Awal → Saldo Awal Hutang & Piutang per Faktur →
bagian 03 "Koreksi nilai saldo awal per faktur"** (`/keuangan/saldo-awal-faktur#koreksi`). Halaman faktur pembelian/penjualan
saldo awal sekarang menautkan langsung ke situ.

## Alur pengguna

1. Cari faktur (no. FB/FJ, no. asal Accurate, atau nama pemasok/pelanggan). Tabel menampilkan nilai, sudah dibayar, sisa.
2. Klik **Koreksi** → isi nilai yang benar (boleh pakai titik, mis. `10.101.500`) → layar langsung menampilkan naik/turun berapa,
   sisa tagihan baru, dan jurnal koreksi yang akan dibuat.
3. Isi alasan (10–1.000 karakter), centang konfirmasi, **Simpan koreksi**.
4. Riwayat koreksi (waktu, faktur, lama → baru, selisih, no. jurnal, oleh siapa, alasan) tampil di bawahnya.

ADMIN/FINANCE bisa melihat daftar dan riwayat; hanya OWNER aktif yang bisa menyimpan.

## Database — `supabase/migrations/20261124300000_koreksi_saldo_awal_per_faktur.sql`

- `correct_opening_invoice(p_line_id, p_expected_total, p_new_total, p_reason, p_request_key)` (SECURITY DEFINER, OWNER):
  - nilai baru rupiah bulat > 0 dan ≠ nilai sekarang; `p_expected_total` harus sama dengan nilai sekarang (tidak menimpa
    perubahan orang lain);
  - **tidak boleh di bawah yang sudah dibayar/diterima** (`opening_invoice_paid`: hutang = jumlah semua
    `purchase_invoice_payments`; piutang = `carried_paid + returned_ar + sum(sales_receipts.jumlah)` — rumus yang sama dengan
    alur bayar/terima);
  - faktur batal/void atau sudah diganti → ditolak; periode tertutup (`accounting_locks.closed_until ≥ as_of` batch) → ditolak;
  - **jurnal batch asli tidak diubah**. Selisih dibukukan sebagai jurnal koreksi baru (`clinic_write_journal`) bertanggal
    `as_of` batch, source `opening-invoice` (ikut dilindungi `guard_opening_invoice_journal`), source_ref = id koreksi:
    hutang naik D 410001 / K 311001; hutang turun D 311001 / K 410001; piutang naik D 150001 / K 410001; piutang turun
    D 410001 / K 150001;
  - `purchase_invoices.total` / `sales_invoices.total` (+ status `lunas`/`berjalan` untuk piutang), `opening_invoice_lines.outstanding`
    (+ `original_total` ikut bila sama dengan nilai lama atau jadi lebih kecil, + catatan di `keterangan`), dan
    `opening_invoice_batches.ap_total`/`ar_total` + `result` ikut disesuaikan;
  - riwayat `opening_invoice_corrections` (nilai lama/baru, selisih, yang sudah dibayar saat koreksi, jurnal, alasan, pembuat);
  - idempoten per (pengguna, kunci permintaan) lewat `opening_invoice_correction_requests`; kunci sama + isian beda ditolak.
- `guard_opening_invoice` ditambah satu jalur: hanya bila setelan transaksi `vetos.opening_invoice_correction` = id faktur dan
  pemanggil bukan klien, perubahan **hanya total/status/revision** diizinkan. Klien (authenticated) tetap ditolak walau memasang
  setelan itu.
- `opening_invoice_correction_rows()` untuk daftar di layar (OWNER/ADMIN/FINANCE, menurut akses cabang).
- Kedua tabel baru masuk daftar pengecualian `supabase/tests/activity_audit_coverage.sql` (jejak koreksi domain; efeknya ke
  faktur, baris impor, batch, dan jurnal sudah tercatat di log aktivitas sumbernya).

Catatan: setelah koreksi lewat layar, total batch = jurnal batch asli + jumlah jurnal koreksinya. Koreksi lama
FB.2026.10.00079 dan FB.2026.10.00030 (migrasi) mengubah jurnal batch langsung — itu tetap konsisten, hanya tanpa jurnal koreksi terpisah.

## Tes

- `scripts/test-koreksi-saldo-awal-faktur-postgres.py` — rantai 448 migrasi dari nol (PostgreSQL lokal sekali pakai, data fiktif) +
  `supabase/tests/opening_invoice_corrections.sql`: GREEN lulus; `--baseline` (tanpa migrasi) gagal seperti seharusnya.
  Kasus: akses (STAFF/FINANCE/Owner nonaktif), validasi isian, naik & turun (ralat), idempoten, nilai di bawah yang dibayar
  ditolak / persis sama boleh, piutang lunas↔berjalan, jurnal koreksi (tanggal, sisi, seimbang), jurnal batch asli utuh,
  buku besar = total faktur, penjaga tulis langsung, periode tutup, faktur void.
- `scripts/test-opening-invoices-postgres.py` (suite lama + suite baru) lulus.
- `src/components/__tests__/koreksi-saldo-awal-faktur.test.tsx` — pencarian, dampak, konfirmasi, kunci permintaan sama saat
  ulang, non-Owner tidak bisa simpan.
- `scripts/test-activity-audit-postgres.py`: `activity_audit_coverage.sql` sudah gagal sebelum perubahan ini (33 tabel lain belum
  terdaftar/dikecualikan); dua tabel baru tidak termasuk daftar yang gagal.

## Status Production

- Migrasi diterapkan ke Production 18 Nov 2026 lewat Supabase `apply_migration` (`koreksi_saldo_awal_per_faktur`), lalu
  `koreksi_saldo_awal_per_faktur_batal_false` (perbaikan kecil: kolom `batal` di daftar selalu true/false, bukan null untuk faktur hutang).
  Isi file migrasi di repo = gabungan keduanya.
- Cek baca (transaksi di-rollback, sebagai Owner): `opening_invoice_correction_rows()` mengembalikan 118 faktur (80 hutang, 38 piutang),
  0 nilai `batal` null; FB.2026.10.00030 = 10.101.500, sudah dibayar 10.101.500 (pembayaran tgl 14 Nov, dicatat 18 Nov 10.19 WIB).
- Belum diuji: menyimpan koreksi sungguhan di Production (tidak dilakukan agar tidak membuat jurnal uji di buku besar asli).
  Tampilan layar baru aktif setelah PR di-merge dan Vercel selesai deploy.
