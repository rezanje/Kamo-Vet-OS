# Serah-terima: tiga perbaikan impor rekam medis (temuan harness PR #328)

Status: **draft PR siap direview (Claude Code, 29 Okt 2026).** Belum merge/deploy, migrasi belum
dipasang di DB mana pun selain Postgres sekali-pakai. Dilanjutkan dari commit Hermes `3be71767`
(branch `hermes/impor-rekmed-fix`), tidak dibuat ulang dari main.

## Dasar & batas (dari Reza, via Wowo)
- Disetujui: implementasi perbaikan K1b, K3 (0/+62), C3b lalu uji ulang fiktif sebelum Andri memeriksa sampel. PR #328 tetap baseline bukti.
- Dilarang: merge/deploy, pasang migrasi produksi, backfill/gabung pelanggan lama, impor pasien produksi, akses Google baru, memutuskan aturan bisnis (minimum digit HP, tanggal, klinis kosong, folder ambigu), koneksi/kredensial Production. Semua tes data fiktif + DB sekali-pakai.

## Yang dikerjakan
1. **K1b (key sama, isi beda)** — Hermes: `visits.legacy_source_hash` + `import_legacy_row_hash()`; RPC
   massal dan per baris hanya `sudah_ada` bila sidik identik; beda isi / tanpa sidik → `ditahan` + alasan.
   App mengirim baris `tercatat` ke DB untuk dibuktikan; folder dengan baris ditahan tidak dicatat selesai.
2. **K3 (0/+62)** — Hermes: `kunciHpIndonesia()` ≡ `public.indonesian_phone_key()`, vektor bersama
   `src/lib/__tests__/fixtures/kunci-hp-indonesia.json`. Data pelanggan lama tidak diubah.
3. **C3b (registrasi vs impor bersamaan)** — Hermes: `customer_identity_lock`, `registrasi_pelanggan_atomik`,
   `customer_pick_by_phone`; registrasi klinik memakai RPC ini.
4. **Claude Code (lanjutan):**
   - Harness PostgreSQL dijalankan untuk pertama kali — langsung lulus tanpa perbaikan kode harness inti.
   - Celah harness ditutup: jalur **per baris** (`import_legacy_medical_record_resolved`, dipakai
     `konfirmasiImporRekamMedis`/`simpanBatchImporRekamMedis`) belum pernah diuji. Ditambah X1–X3
     (paritas sidik per-baris ↔ massal dua arah, dan tolak bentrok di jalur per baris) dan C8
     (key sama, HP beda, bersamaan: B tertahan oleh baris A yang belum commit, lalu `ditahan`, tanpa
     pemilik yatim). `race()` sekarang bisa menunggu jenis kunci `row` selain `advisory`.
   - Migrasi: `import_legacy_source_conflict_reason` di-`revoke` dari `public, anon` (konsisten dengan fungsi lain).

## Hasil tes (head draft PR)
- Harness `scripts/test-impor-rekam-medis-postgres.py --pg-bin <dir>`: **33/33 PASS, 0 FAIL, 0 BLOCKED**
  di PostgreSQL 17.10 (4× berturut-turut, stabil) dan 16.15. 319 migrasi repo teraplikasi.
- Uji mutasi (fix sengaja dirusak sementara, lalu dipulihkan): tanpa kunci identitas di registrasi →
  C3/C4/C6 FAIL; tanpa cek sidik per baris → X3 FAIL. Harness memang menangkap regresi.
- `npm test` penuh: 602 berkas / 4648 tes lulus (1 di-skip, sudah ada sebelumnya).
- `npm run lint`: 0 error (14 warning `<img>` yang sudah ada, bukan di berkas yang diubah).
- `npx tsc --noEmit` (heap 4 GB): lulus.
- `npm run build` (heap 6 GB): lulus. Dengan heap bawaan mesin uji (≈2 GB) build kehabisan memori —
  kondisi mesin, bukan kode; `Technical checks` di GitHub yang menjadi acuan.
- Cara menjalankan PG17 tanpa Docker: biner `@embedded-postgres/linux-x64@17.10.0-beta.17` (npm) disalin
  ke dir yang bisa dibaca user `postgres`, lalu `--pg-bin <dir>/bin`.

## Review migrasi — catatan
- Urutan kunci: impor massal mengambil semua kunci identitas terurut sebelum baris pertama; registrasi
  hanya satu kunci → tidak ada siklus (C7 lulus). Sisa kasus teoretis: dua impor bersamaan yang membawa
  **jejak sumber sama dengan HP berbeda dalam urutan terbalik** bisa saling tunggu di indeks unik;
  Postgres memutus salah satu (deadlock terdeteksi), baris korban `ditahan` dengan alasan, tidak ada data
  hilang/ganda. Tidak ditangani khusus karena sangat jarang dan aman-gagal.
- Sidik tanggal: aplikasi selalu mengirim `YYYY-MM-DDT00:00:00+07:00` di kedua jalur, jadi tidak
  bergantung zona waktu sesi.
- Hak akses: fungsi kunci HP baru di-`revoke` dari `anon`. Probe: insert pelanggan oleh peran selain
  `authenticated`/`service_role` memang sudah gagal sebelumnya karena `quest_customer_phone_key`, jadi
  tidak ada jalur baru yang rusak.
- `customer_pick_by_phone` memakai RLS pemanggil; kebijakan `customers_read` untuk `authenticated` adalah
  baca semua, jadi STAF melihat semua kandidat (N2/C3/C6 lulus sebagai STAF).

## Perubahan perilaku yang perlu diketahui pemilik
- Registrasi klinik **menolak** nomor HP yang terdaftar pada beberapa pelanggan (dan tidak ada yang
  tulisannya persis sama), dengan pesan "minta admin memeriksa data pelanggan". Dulu sistem diam-diam
  membuat kartu baru lagi. Layar cari-HP di registrasi tampil kosong untuk nomor seperti ini.
  Jumlah nomor seperti ini di Production **belum diketahui** (tidak ada akses Production).

## Celah Kasir / CRM / impor pelanggan — dilaporkan, BELUM dikerjakan (di luar scope)
Jalur pembuat pelanggan lain belum memakai kunci identitas dan kunci HP kanonik:

| Jalur | Celah |
|---|---|
| `src/app/kasir/actions.ts` `tambahCustomerKasir` | cek `eq("phone")` persis: `08..` vs `+62..` lolos → kartu ganda; cek-lalu-insert tanpa kunci → bisa ganda bila bersamaan dengan impor/registrasi; bila sudah ada >1 kartu dengan nomor persis sama, `maybeSingle()` gagal diam-diam → kartu ketiga dibuat. |
| `src/app/(app)/crm/pelanggan/baru/actions.ts` `simpanPelanggan` | sama persis dengan Kasir. |
| `src/app/(app)/pengaturan/impor/actions.ts` (impor CSV pelanggan) | normalisasi sendiri (`normalTelp`, tanpa batas panjang, `8xx` → `08xx`) dan pemeriksaan set di aplikasi tanpa kunci; tidak bentrok dengan impor rekam medis secara atomik. |

Usulan perubahan minimum (satu PR terpisah, perlu persetujuan):
1. Satu RPC `tambah_pelanggan_atomik(nama, hp, …kolom tambahan)` di migrasi baru: ambil
   `customer_identity_lock(hp)`, panggil `customer_pick_by_phone`; bila `one`/`ambiguous` → tolak
   "No HP sudah terdaftar" (perilaku Kasir/CRM sekarang memang menolak, bukan memakai ulang); bila `none` → insert.
2. Ganti blok cek+insert di Kasir dan CRM dengan RPC itu (±10 baris per berkas), tambah kasus harness
   untuk Kasir/CRM bersamaan dengan impor.
3. Impor CSV pelanggan dibiarkan dulu (beda aturan `8xx` adalah keputusan bisnis); cukup dicatat.

Catatan lain: ada tiga normalisasi HP berbeda (`indonesian_phone_key`, `quest_customer_phone_key`,
`normalTelp`). Menyatukannya menyentuh aturan bisnis (nomor `8xx` tanpa 0, minimum digit) → keputusan pemilik.

## Sisa hambatan
- Migrasi belum dipasang di Production (butuh persetujuan teks persis migrasi).
- `Technical checks` GitHub di head final dicatat di PR.
- Simulasi/UAT pengguna (Andri memeriksa sampel) belum dilakukan.
