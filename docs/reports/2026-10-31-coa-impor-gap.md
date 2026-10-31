# Impor COA dari Accurate (Andri, pesan 3632) — penelusuran & gap (31 Okt 2026)

Branch `claude/coa-impor-accurate`, base `origin/main` = `291bb8c8c99957762fde613819417645ffb3a2f1`
(337 migrasi). Migrasi baru: `20261104330000_coa_import_atomic.sql` (satu-satunya).

**Status Accurate: BLOCKED.** Belum ada contoh ekspor COA Accurate asli. Tidak ada nama kolom Accurate yang
ditebak atau dikirim. Yang dikerjakan: jalur impor bagan akun KAMO yang sudah ada dibuat aman dan atomik, plus
satu titik pemetaan terisolasi (`src/lib/impor-akun-pemetaan.ts`) untuk dipasang begitu contoh file diterima.

## 1. Cek tabrakan

- PR terbuka (REST, 31 Okt): tidak ada PR COA/impor akun. #362 `hermes/promo-master-import-release` = promo.
- Branch remote `claude/impor-*` = saldo/gudang stok; `codex/accurate-*` = persediaan/stok (tanpa merge-base dengan
  main, 21 Okt); `codex/next-import-check` = pesan error impor master (25 Okt) — tidak menyentuh bagan akun.
- Commit 21 hari terakhir: hanya `46a8b1f8`/`5dc709f5` (laporan mekanisme COA/jurnal I02/J02/P02/M01, PR #314) —
  bukan impor akun. `docs/reports/2026-10-31-coa-jurnal-i02-j02-p02-m01.md` sudah dibaca; tidak ada klaim impor COA.
- `/opt/data/kamo-external-task-ownership.json` tidak ada di mesin ini.

## 2. Jalur yang sudah ada (sebelum perubahan)

| Langkah | Lokasi | Perilaku |
|---|---|---|
| Tombol | `keuangan/coa/page.tsx` | "Impor dari Excel" → `/pengaturan/impor/akun` |
| Halaman | `pengaturan/impor/[jenis]/page.tsx` + `ImporMasterForm.tsx` | file CSV dibaca di browser → textarea → satu tombol **Impor** (langsung simpan, tanpa pratinjau) |
| Aksi | `pengaturan/impor/actions.ts` `imporMaster` → `simpan()` | penjaga `assertBoleh`: role OWNER/ADMIN dari `profiles`, **tanpa cek aktif** |
| Parser | `lib/impor-csv.ts` `bacaCsvUmum` | pemisah , ; tab; BOM; baris kosong dibuang |
| Validasi | `lib/impor-master.ts` `periksaAkun` | kode dipotong 12 huruf & nama 80 huruf diam-diam; kode terpakai = ditolak; tipe & D/K; header (nilai asing = detail) |
| Simpan | `actions.ts` | baca `coa_accounts` (error diabaikan → daftar kosong), `insert` semua, lalu `update parent_id` satu per satu **tanpa cek error**; induk tak ketemu → akun tetap masuk, dilaporkan "berhasil" |
| Database | `0015`, `0108` (`coa_write` OWNER/ADMIN tanpa cek aktif; CHECK tipe, D/K, laba-rugi), `0113` (parent_id, is_header, trigger tolak jurnal ke akun induk), `20260915190000` (pengecualian 4102) | tidak ada RPC impor |
| Aturan COA layar manual | `keuangan/coa/actions.ts`, `lib/coa-sistem.ts`, `lib/coa-pohon.ts` | kode 4–6 angka & digit = kelompok, jatah 1103–1199, kode sistem, sisi saldo, kunci tipe/saldo bila berjurnal, induk header/sekelompok/tidak melingkar — **tidak dipakai importer** |

## 3. Gap terhadap acceptance 1–8 (sebelum → sesudah)

| # | Gap sebelum | Sesudah (branch ini) |
|---|---|---|
| 1 | Tidak ada pratinjau; simpan langsung; hanya hitungan baris kasar | Langkah **Periksa**: jumlah baris, kolom yang dipetakan/diabaikan, hitungan baru/sama/berubah/konflik/ditolak + alasan & solusi per baris. Tidak menulis apa pun |
| 2 | Kode dipotong 12 huruf diam-diam; format kode tidak dicek | Kode dipakai persis. Format di luar kontrak KAMO (nol depan, titik, strip, panjang, digit≠kelompok, 1103–1199, kode sistem) = **konflik + solusi**, tidak pernah diubah. `01101` tidak bertabrakan dengan `1101` |
| 3 | Induk tidak dicek header/kelompok/siklus; induk hilang tetap masuk | Validator pohon existing (`validasiIndukAkun`) atas keadaan akhir; induk boleh sesudah anak; induk hilang, bukan header, beda kelompok, melingkar (termasuk baris di bawah lingkaran), kode kembar → ditolak. Akun induk tetap dijaga trigger `journal_lines_tolak_header` |
| 4 | Kode yang sudah ada = ditolak (tidak bisa unggah ulang); tidak ada diff | Unggah ulang: sama = tidak ditulis; beda = **diff** (nama/tipe/saldo normal/header/induk/aktif), hanya diterapkan setelah centang konfirmasi. Tipe/saldo normal terkunci untuk akun berjurnal, akun sistem, rekening kas/bank, kategori aset, jurnal berulang; rekening kas/bank tidak diganti nama lewat impor; akun terpakai tidak dinonaktifkan; kode tidak pernah berubah |
| 5 | Insert lalu penautan terpisah tanpa cek; baca daftar gagal = daftar kosong | RPC `import_coa_accounts` satu transaksi + kunci tabel + cek versi pratinjau; gagal di mana pun = tidak ada yang tersimpan, layar "Impor gagal — tidak ada akun yang tersimpan". Baca konteks gagal = error, pratinjau tidak dibuat |
| 6 | Kolom saldo diam-diam diabaikan | Kolom bernilai (saldo/debit/kredit/nominal/…) dipisahkan & disebut di pratinjau + jumlah baris berisi angka; tidak dikirim; arah ke menu Saldo Awal. RPC hanya menulis `coa_accounts` |
| 7 | Cek role tanpa status aktif; RLS `coa_write` tanpa cek aktif | Aksi: `klienMasterAdmin` (OWNER/ADMIN **aktif**). RPC: sesi `authenticated` + profil aktif OWNER/ADMIN. RLS `coa_write` kini mensyaratkan aktif. STAFF/DOCTOR/FINANCE/ADMIN nonaktif/anon ditolak |
| 8 | Tidak ada tes jalur nyata | Parser→pratinjau→aksi asli→RPC asli→baca balik pada PostgreSQL 16 lokal (semua migrasi). File contoh fiktif format KAMO: `supabase/tests/fixtures/coa-impor-kamo-fiktif.csv`, SHA-256 `a3d5d694a68bd0f57fe46690bfc670b19ab7c2d7fc8bde0d36cecaf3aadb6365`, 12 akun, 4 induk, 8 akun berinduk |

## 4. Keputusan desain

- **Satu file = satu keputusan.** Ada baris ditolak/konflik → tombol simpan tidak muncul dan server menolak.
  (Dulu baris bermasalah dilewati. Untuk pohon akun, melewati satu induk membuat anak-anaknya salah tempat.)
- Server tidak percaya klien: saat Simpan, pratinjau dibuat ulang dari isi file; SHA-256 isi dan versi bagan akun
  harus sama dengan yang dipratinjau. RPC mengulang semua cek (kode, kelompok, sisi saldo, perlindungan, induk,
  siklus) dan memakai daftar kode sistem yang dikunci tes agar sama dengan `KODE_SISTEM`.
- Kolom `header` ada di file → isinya berlaku (kosong = detail). Kolom `induk` ada → isinya berlaku (kosong = tanpa
  induk). Kolom tidak ada sama sekali → nilai akun lama tidak diubah. `aktif` kosong = tidak diubah.
- Batas 1.000 akun per file.

## 5. Titik pemetaan Accurate (belum aktif)

`src/lib/impor-akun-pemetaan.ts` → `PEMETAAN_AKUN` hanya berisi `kamo`. Langkah saat contoh ekspor asli datang:
simpan contoh tersanitasi + SHA-256 di `supabase/tests/fixtures`, tambah entri pemetaan (judul kolom sumber → kolom
KAMO, dan bila perlu nilai tipe sumber → tipe KAMO) dengan `ditinjau` terisi, tambah tes parser→pratinjau→simpan.
Pemetaan hanya mengganti nama kolom; kode akun tetap apa adanya. Jika kode Accurate memakai pemisah (mis. titik),
hasilnya konflik sampai ada keputusan kontrak kode (lihat §7).

## 6. Bukti uji

Lihat deskripsi PR (`/opt/data/pr-body-claude-coa-impor-accurate.md`) dan `/opt/data/coa-impor-evidence/`.

## 7. Sisa / butuh keputusan

- **Contoh ekspor COA Accurate asli** (CSV/XLSX sesuai file aktual, boleh sebagian baris, header utuh) dari Reza/Andri.
- Bila kode Accurate tidak 4–6 angka (mis. `1-1100`, `110.01`): perlu keputusan — (A) akun disesuaikan manual di file,
  (B) kontrak kode KAMO diperluas (berdampak ke layar COA, laporan, `postJournal`), (C) tabel padanan kode
  Accurate→KAMO yang ditinjau. Tanpa keputusan, baris tersebut tampil sebagai konflik.
- File .xlsx belum dibaca langsung (sama dengan importer master lain: Excel → Save As CSV).
- Penjaga `imporMaster` untuk pelanggan/pemasok/komisi/target masih cek role tanpa status aktif (di luar paket ini).
- Belum diuji: browser/UAT, Supabase hosted, PostgreSQL 17 (hanya PG16 tersedia), `next build`.
