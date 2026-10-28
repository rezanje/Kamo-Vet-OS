# Pasang perubahan database untuk PR #291 (sebelum merge)

Untuk: pemegang akses owner Supabase Production. Lama pengerjaan sekitar 15 menit. Bisa dikerjakan kapan saja,
tetapi **harus selesai sebelum PR #291 di-merge**, karena merge langsung men-deploy aplikasi.

## Cara menjalankan
Buka Supabase → project Production → **SQL Editor**. Untuk setiap file di bawah: buka file di GitHub (branch
`claude/busy-ptolemy-4wlam0`), salin **seluruh isinya**, tempel ke SQL Editor, lalu klik **Run**.

Aturan umum:
- File **preflight** dan **readback** hanya membaca, aman dijalankan kapan saja. Semua baris hasilnya harus
  `ok = true` (atau `SUMMARY: 0 failed`).
- Kalau ada satu saja baris `false`: **berhenti**, jangan lanjut ke apply. Kirim screenshot hasilnya ke developer.
- File **apply** adalah satu-satunya yang mengubah database. Ketiga file apply aman dijalankan ulang (apply kedua
  ditolak atau tidak mengubah apa pun).
- File **rollback** hanya dijalankan kalau developer meminta.

## Urutan

### 1. Log aktivitas (A01) — `docs/evidence/2026-10-29-a01-new-tables/owner-apply/`
1. `preflight.sql` → semua `ok = true`
2. `apply.sql`
3. `readback.sql` → semua `ok = true`. Satu baris informasi boleh menyebut tabel yang hanya ada di Production;
   catat dan kirim ke developer, tapi itu tidak menghalangi.

### 2. Tagihan rawat inap (K08) — `docs/evidence/2026-10-29-k08-rebill/owner-apply/`
1. `preflight.sql` → Query 1 harus `SUMMARY: 0 failed`.
   **Query A/B/C hanya daftar informasi** kunjungan lama yang kena bug. Simpan hasilnya (export/screenshot)
   untuk finance. Daftar ini tidak menghalangi apply, dan apply tidak mengubah data itu.
2. `apply.sql`
3. `readback.sql` → `SUMMARY: 0 failed`

### 3. Kode kampanye (C05) — `docs/evidence/2026-10-29-c05-coverage/owner-apply/`
Syarat: paket C05 dasar (28 Okt) sudah terpasang. Preflight memeriksanya.
1. `preflight.sql` → 12 baris, semua `ok = true` (baris berawalan `info` hanya angka untuk dibaca)
2. `apply.sql`
3. `readback.sql` → 7 baris, semua `ok = true`

**Jangan** menjalankan ulang `apply.sql` C05 dasar (folder `2026-10-28-c05-q01`) setelah langkah ini, karena itu
akan menghapus tambalan rombongan. Kalau terlanjur: jalankan lagi `apply.sql` C05 di atas, lalu `readback.sql`.

## Setelah selesai
Kabari developer: "3 paket database PR #291 sudah terpasang, readback semua ok". Kirim juga hasil Query A/B/C
dari K08. Developer lalu merge PR #291, memantau deploy, dan menulis laporan rilis di PR.
