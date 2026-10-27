# A02 permintaan koreksi pembelian — paket migrasi untuk pemilik akses production

Ringkas (ID): paket ini untuk orang yang memegang akses Supabase production pada **slot rilis A02** yang diberikan
koordinator (bukan bersamaan dengan rilis DB lain). Isinya: cek awal (hanya baca), satu skrip pemasangan atomik,
cek baca-balik (hanya baca), dan rollback yang menyimpan data. **Belum ada yang dijalankan ke production.**
Berhenti di langkah mana pun yang hasilnya tidak sesuai.

Repo ini bisa terbaca pihak lain: **jangan menulis ID project, waktu backup, jumlah data, atau keluaran query
production ke repo/PR.** Catat semuanya di catatan rilis privat (lihat "Catatan privat" di bawah).

Semua langkah sudah dilatih ujung-ke-ujung pada cluster sementara PostgreSQL 16.15 dan **17.6** (versi production)
dengan 270 migrasi repo sebelumnya + riwayat migrasi tiruan: preflight → apply tertahan kunci (gagal aman) →
apply sebagai role lain ditolak (gagal aman) → apply → readback → readback menangkap 13 penyimpangan katalog (satu per satu, di-rollback) → suite A02 → teardown
saat kosong → preflight → apply ulang → readback → request fiktif → freeze → teardown ditolak (ada baris) →
teardown ditolak (baris dihapus manual tetapi jejak log ada). Log: `rehearsal-pg16.log`, `rehearsal-pg17.6.log`. Ulangi dengan
`build-and-verify.py` (lihat docstring); file 01–03 dihasilkan ulang dan harus identik byte demi byte.

## File

| File | Menulis? | sha256 |
|---|---|---|
| `supabase/migrations/20261027153000_purchase_correction_requests.sql` | (isi dari 02) | `923bb7420acd35ecaee2ba80ff54b201e9beb3d8fce65ff8fae21d11e5909081` |
| `01-preflight-readonly.sql` | tidak | `e5c7d09bdc237420292ffd266b665179fefb14130cb65401b031f5d5dfb54f4f` |
| `02-apply.sql` | **ya** — migrasi + baris riwayat, satu transaksi | `2dcc403d53607e7ed7580e78dd28137dd96c1764dfea27553633448b52dcc8de` |
| `03-readback-readonly.sql` | tidak | `5b3b2d0adaef759f3eaf340878fdd2b1eb7b42e04730ce34533821d44eea0aeb` |
| `04-freeze-if-decided.sql` | **ya** — hanya pada keputusan rollback | `725d5a12cd8b46a73edfd1534834b68212bd4855175b3a487baee8b370ef546f` |
| `05-teardown-empty-only.sql` | **ya** — hanya bila belum ada request | `479589f91c2377a9ce6b54b8d986007203a963edcb74659135b42f6c525178f9` |

## Dampak migrasi

Aditif saja: 1 tabel baru, 3 index, 4 fungsi baru (security definer, `search_path` kosong), RLS + 1 policy baca,
grant SELECT tabel/EXECUTE fungsi ke `authenticated` saja, 1 baris `activity_log_sources` (pembaca OWNER),
2 trigger di tabel baru. Tidak mengubah fungsi/kolom/policy lama dan tidak mengisi data. Pembuatan foreign key
mengambil kunci singkat pada `purchase_orders`, `purchase_invoices`, `branches`, `profiles`; `02` memakai
`lock_timeout = 5s` sehingga bila ada transaksi tulis yang sedang berjalan, pemasangan **gagal utuh** (tidak
setengah jadi) — ulangi beberapa menit kemudian.

## Langkah 0 — target dan catatan privat (tanpa SQL)

1. Pastikan project Supabase yang dipakai aplikasi production (bukan staging/branch). Catat di catatan privat.
2. Catat waktu backup **lengkap terbaru** (atau status PITR) di catatan privat. Backup on-demand atau backup penuh baru
   **tidak** disyaratkan: rollback A02 tidak pernah memakai restore (restore membuang transaksi setelah backup).
3. Pilih jam sepi (tidak ada checkout/penerimaan pembelian yang sedang berjalan).

## Langkah 1 — file persis

Dari checkout head PR248 yang sudah lulus Technical checks (catat SHA-nya di catatan privat):

```
sha256sum supabase/migrations/20261027153000_purchase_correction_requests.sql docs/evidence/2026-10-27-a02-correction-requests/owner-apply/0*.sql
```

Semua harus sama dengan tabel di atas. Berbeda: berhenti.

## Langkah 2 — preflight (hanya baca): `01-preflight-readonly.sql`

Jalankan tiap query terpisah (SQL Editor; atau Management API dengan `read_only: true`).

- **Query A**: semua baris berharapan menunjukkan `ok = true`; baris terakhir `SUMMARY` = `0 failed`.
  Memastikan A02 belum terpasang, nama objek belum dipakai, dan semua ketergantungan (tabel pembelian, profil,
  Akses Grup, kerangka log aktivitas A01, fungsi akses cabang, role Supabase) ada dengan kolom yang dibutuhkan.
- **Query B**: harus jalan tanpa error, `A02 rows` = 0. Baris "newest" hanya untuk catatan privat.

Berhenti dan kirim hasilnya ke developer bila: ada `ok = false`; Query B error (tabel riwayat tidak ada); atau
`A02 rows` ≠ 0.

## Langkah 3 — pasang (menulis): `02-apply.sql`

Jalankan **seluruh isi file sebagai satu skrip** sebagai role `postgres` (SQL Editor; atau Management API tanpa
`read_only` — jalur `read_only` memakai role baca-saja dan memang tidak bisa memasang). Satu transaksi: pengecekan
role, isi migrasi persis, `insert` riwayat `20261027153000`. Bila dijalankan sebagai role lain, skrip menolak sebelum
membuat objek apa pun (pemilik semua objek A02 harus `postgres`, sama seperti objek pembelian/A01 yang ada). Jangan memakai `supabase db push`/terapkan-semua: migrasi
lain yang belum terpasang di production (mis. C04/R05) bisa ikut terpasang.

- Error `lock timeout` / error lain: tidak ada yang berubah. Jalankan ulang Langkah 2 (harus tetap `0 failed`),
  lalu coba lagi di waktu yang lebih sepi.

## Langkah 4 — baca-balik (hanya baca): `03-readback-readonly.sql`

- **Query A**: `SUMMARY` = `0 failed`. Bentuk katalog dibandingkan persis dengan hasil latihan: pemilik tabel dan
  fungsi (`postgres`), grant tabel dan fungsi per role selain pemilik (tabel: `authenticated:SELECT` saja; fungsi:
  `authenticated:EXECUTE` saja — anon, service_role, PUBLIC tidak ada), RLS aktif/tidak dipaksa, seluruh policy
  (nama, permissive, cmd, roles, aturan), seluruh trigger (definisi + aktif), constraint, index, kolom, sidik jari
  isi 4 fungsi, sifat fungsi (volatility, security definer, `search_path=""`), pembaca log `{OWNER}`.
  `info: request rows` = 0. Jalankan dengan `search_path` bawaan Supabase (berisi `public`); bila `search_path` kosong,
  nama policy/trigger/constraint tampil lengkap dengan skema dan barisnya gagal (gagal aman). Bila pemilik berbeda (dipasang lewat role lain) atau baris lain gagal: berhenti dan
  kirim hasilnya ke developer.
- **Query B**: `a02_rows` = 1.

Gagal: jangan merge aplikasi; kirim hasilnya ke developer (pilihan: `05` bila masih kosong).

## Langkah 5 — aplikasi

Merge PR248 (deploy Production otomatis). Verifikasi deployment Production READY di SHA hasil merge, cek live
tanpa transaksi, lalu satu komentar pasca-deploy di PR248 (AGENTS.md) — tanpa data/ID production.

## Rollback

- **Default (data dipertahankan): `04-freeze-if-decided.sql`**, lalu revert commit aplikasi A02. Mencabut EXECUTE dua
  fungsi tulis; semua request, catatan tindak lanjut, dan log aktivitas tetap tersimpan dan terbaca. Dilatih:
  pembuatan dan pemrosesan ditolak, pemohon dan Super Admin tetap membaca datanya. Membuka kembali: dua `grant`
  di komentar file. **Cek setelah freeze:** jalankan readback Query A; yang gagal harus tepat dua baris
  `grants (all roles except owner)` untuk `create_purchase_correction_request` dan `process_purchase_correction_request`
  (plus `SUMMARY`), selebihnya `ok`.
- **Hapus total: `05-teardown-empty-only.sql`** hanya bila belum pernah ada satu pun request. Menolak (tanpa perubahan)
  bila tabel berisi **atau** log aktivitas pernah mencatat request (mis. baris dihapus manual). Dilatih: berhasil saat
  kosong → preflight kembali `0 failed`; ditolak saat berisi; ditolak setelah penghapusan manual (jejak log tetap).
- Restore backup **bukan** bagian rollback A02.

## Catatan privat (di luar repo)

Project/target, SHA head yang dipakai, sha256 yang dicocokkan, waktu backup lengkap terbaru/PITR, waktu mulai/selesai,
keluaran Query A/B preflight dan readback, SHA main hasil merge, URL deployment. Tidak perlu ekspor data bisnis apa pun.

## Bukti PostgreSQL 17.6 (latihan)

Server: `postgres (PostgreSQL) 17.6` dari paket npm `@embedded-postgres/linux-x64@17.6.0-beta.15` (integritas
sha512 registry cocok; tarball sha256 `8d14394e1092b8bc659943966a5d1cd19b1bcc34ab02e135ed7c51fe60ba9d12`), karena
unduhan resmi postgresql.org diblokir proxy sandbox. Klien: psql 16.15. Hanya data fiktif.
