# M05 saldo awal hutang/piutang per faktur — paket migrasi untuk pemegang akses production

Ringkas: paket ini untuk orang yang memegang akses Supabase production, dijalankan pada **slot rilis M05** dari
koordinator (tidak bersamaan dengan rilis DB lain). Isinya: cek awal (hanya baca), satu skrip pemasangan atomik,
cek baca-balik (hanya baca), dan rollback yang hanya boleh selama belum ada batch terposting.
**Belum ada yang dijalankan ke production.** Berhenti di langkah mana pun yang hasilnya tidak sesuai.

Repo ini bisa terbaca pihak lain: **jangan menulis ID project, waktu backup, jumlah data, atau keluaran query
production ke repo/PR.** Catat di catatan rilis privat.

## Urutan wajib: migrasi dulu, baru merge PR

Kode PR membaca kolom baru `opening_batch_id` di layar Pembayaran Hutang, Piutang, Faktur Pembelian/Penjualan,
dashboard, laporan pembelian/penjual, dan sinkronisasi jurnal. **Kalau PR di-merge sebelum migrasi terpasang,
layar-layar itu gagal dimuat.** Jadi: 01 → 02 → 03 → merge PR → cek layar.

## File

| File | Menulis? | sha256 |
|---|---|---|
| `supabase/migrations/20261027180000_opening_ap_ar_invoices.sql` | (isi dari 02) | `177ebde296717ca7e8e7f4021b2bb79bdeb6f41ae198779f8144b5290615079a` |
| `01-preflight-readonly.sql` | tidak | `e22a4351b6f38157066e0f1cd0dbd32b885f000000be124226253235ed20f95f` |
| `02-apply.sql` | **ya** — migrasi persis + baris riwayat, satu transaksi | `cbd070b7e7fb4a948d9c6b95d04acd625b1faf06efc8ba0eb724f206fa19a3fa` |
| `03-readback-readonly.sql` | tidak | `8491c85fdbc5543a5bf17017f8fb2ed6693d012c9fcdeae2aaa37c16d322c8d2` |
| `04-rollback-only-if-unused.sql` | **ya** — hanya pada keputusan rollback, sebelum ada batch | `4e0410963b0314651e8a15de979ffcc1ad1923cbb9505c4d72c77bc8ca4be84d` |

`02-apply.sql` dihasilkan `build-and-verify.py` dari file migrasi; jangan diedit tangan.

## Dampak migrasi

- **Baru:** tabel `opening_invoice_batches` dan `opening_invoice_lines` (RLS aktif; hanya OWNER/ADMIN/FINANCE aktif
  di cabangnya yang bisa membaca; tidak ada hak tulis langsung), 4 index, 7 fungsi (`search_path` kosong; hanya
  `preview_opening_invoices` dan `post_opening_invoices` yang boleh dipanggil user login).
- **Mengubah tabel lama:** kolom kosong `opening_batch_id` di `purchase_invoices` dan `sales_invoices` (nilai lama
  tetap kosong, tidak ada baris yang diubah); constraint `purchase_invoices_asal_check` diganti agar faktur saldo
  awal boleh tanpa PO/gudang (validasi ulang membaca seluruh tabel faktur pembelian sekali).
- **Trigger baru (7):** pelindung faktur saldo awal di `purchase_invoices`, `sales_invoices`, dan tabel barisnya;
  pelindung jurnal `opening-invoice`; dan pencegah tercatat ganda di `journal_lines` (Saldo Awal per akun menolak
  akun 2101/1201 setelah ada impor per faktur). Untuk transaksi biasa tambahannya hanya satu cek tabel kecil.
- Kunci: `ALTER TABLE` mengambil kunci eksklusif singkat di `purchase_invoices` dan `sales_invoices`.
  `lock_timeout 5s`, `statement_timeout 60s`; kalau kunci tidak didapat, semuanya batal dan bisa diulang.
- Data: **tidak ada baris yang diubah atau dihapus.** Backup penuh tidak menjadi syarat; backup rutin platform tetap
  sebagai jaga-jaga umum.

## Langkah

Jalankan dengan `psql -X -v ON_ERROR_STOP=1 -f <file>` (disarankan). Di SQL editor Supabase: `02`/`04` dijalankan
utuh; untuk `01`/`03` pilih dan jalankan hanya statement `with checks … select …`.

1. **`01-preflight-readonly.sql`** — semua baris yang punya nilai harapan `ok = true`, baris terakhir
   `SUMMARY | 0 failed`. Membuktikan: berjalan sebagai `postgres`; PostgreSQL 16+; migrasi prasyarat
   `20261027153000` sudah tercatat dan M05 belum; nama objek M05 belum dipakai; constraint lama masih persis;
   tabel/fungsi yang dipakai ada; akun 2101/1201/3101 aktif. Dua baris `info` menunjukkan apakah Saldo Awal per akun
   sudah memuat 2101 atau 1201 — kalau `true`, impor per faktur untuk jenis itu akan ditolak (by design, mencegah
   dobel). Bila ada baris gagal: **berhenti**, belum ada yang berubah.
2. **`02-apply.sql`** sekali. Sukses = tanpa error. Error yang mungkin: `M05_ALREADY_APPLIED` (sudah terpasang →
   lanjut ke langkah 3), "must run as postgres", lock timeout (ulang nanti). Error apa pun = tidak ada yang terpasang.
3. **`03-readback-readonly.sql`** — `SUMMARY | 0 failed`: riwayat tercatat, RLS + policy, hak akses tabel/fungsi,
   kolom, constraint baru, 4 index, 7 trigger aktif, 7 fungsi milik `postgres`, belum ada batch.
4. Merge PR M05, tunggu deploy, lalu cek (user OWNER): menu Buku Besar → **Saldo Awal per Faktur** terbuka; layar
   Pembayaran Hutang, Piutang, Faktur Pembelian, Faktur Penjualan, dan Dashboard tetap tampil normal.

## Rollback (hanya bila diputuskan)

`04-rollback-only-if-unused.sql` menghapus semua objek M05 dan baris riwayatnya, **hanya selama belum ada satu pun
batch terposting**. Kalau sudah ada, skrip menolak (`M05_ROLLBACK_REFUSED`) dan tidak mengubah apa pun: faktur
saldo awal, pembayaran atasnya, dan jurnalnya adalah catatan keuangan dan tidak boleh hilang lewat rollback.
Rollback juga butuh revert kode (PR revert) lebih dulu, karena kode membaca kolom `opening_batch_id`.

## Latihan (data fiktif)

`python3 docs/evidence/2026-10-27-m05-opening-invoices/owner-apply/build-and-verify.py <bin-postgres>` membuat ulang
`02`, gagal bila berbeda dari yang di-commit, lalu berlatih di cluster sementara (`scripts/native_postgres.py`:
unix socket saja, tanpa Docker, tanpa URL database, dihapus setelahnya) dengan seluruh migrasi repo + riwayat migrasi
tiruan: rollback saat kosong → preflight `0 failed` → apply → readback `0 failed` → apply kedua ditolak tanpa
perubahan → suite SQL M05 → satu batch fiktif di-commit → rollback ditolak, data utuh.
Lulus di PostgreSQL **16.14** dan **17.11** (`rehearsal-pg16.14.log`, `rehearsal-pg17.11.log`).
Production memakai 17.6 — **belum dilatih persis di 17.6**; perbedaan minor versi 17 tidak memengaruhi fitur yang
dipakai (`pg_input_is_valid`, `sha256`, PL/pgSQL standar).
