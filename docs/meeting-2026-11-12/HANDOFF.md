# HANDOFF — pekerjaan meeting 12 Nov 2026 (per 14 Nov 2026)

Untuk agen/developer berikutnya yang melanjutkan `docs/meeting-2026-11-12/TODO.md`.
Baca dulu `CLAUDE.md` + `AGENTS.md` di root repo (SOP lapor ke Reza & laporan rilis wajib).

---

## 1. Aturan main (wajib)

- **Reza = pemilik, non-teknis.** Chat: Bahasa Indonesia santai (gue/lo), tanpa jargon/nama file/kode.
  Format: Kesimpulan → Ringkasan (2–4 bullet) → Pilihan A/B/C (hanya kalau ada keputusan bisnis nyata).
  Tiap pekerjaan selesai: **Udah live belum? / Tindak lanjut / Chat buat user** (draf atas nama Reza: "aku",
  panggil "mas/mba", santai, pendek).
- **Database:** jangan ubah skema atau data Production tanpa konfirmasi Reza. Tulis migrasinya + jelaskan
  dampaknya dulu. Pasang satu per satu lewat Supabase MCP `apply_migration` (project `koaglxcyjqfmgfzxszkj`),
  **bukan** `db push` massal.
- Item `[?]` jangan dikerjakan sebelum Reza menjawab. Item `[x]` cukup diverifikasi. Item "Ops (bukan dev)" dilewati.
- Satu item = satu commit, ID di pesan (`A1: …`). Centang TODO.md di commit yang sama.
- Branch kerja: `claude/epic-hypatia-raw2el` (saat ini = `main` @ `f790622`). PR ke `main`.
- Laporan rilis (AGENTS.md): ringkasan di deskripsi PR; setelah merge+deploy **satu komentar** di PR
  (SHA main, URL deployment, Production, hasil cek live, yang belum diuji). Jangan klaim UAT lulus.
  Google Sheet dipegang Wowo — agen tidak mengubahnya.

## 2. Status item

| ID | Status | Live di Production? | Catatan |
|---|---|---|---|
| A1 Laporan wajib "Tampilkan" | [x] | Ya (kode + 7 index) | Semua entri Daftar Laporan. Detail: `RENCANA-P0.md` |
| A2 Rekap per item (tenaga penjual) | [x] | Ya | |
| A3 Unduh Excel tenaga penjual | [x] | Ya | Unduhan dibuat di server |
| A4 Laporan Visit | [x] | Ya (kode + katalog sub-menu) | Owner perlu centang "Laporan Visit" di Akses Grup untuk ADMIN bila perlu |
| A5 Koreksi visit rawat inap | [x] | Ya (kode + migrasi) | Keputusan 1A/2A/3A. Detail: `USULAN-A5.md` |
| A6 Omzet harian per cabang | [x] | Ya | |
| A7 Laporan ala Accurate | [?] | — | Menunggu contoh dari Reza |
| B1 Multi racikan rawat inap | [x] | Ya | Perbaikan 2A (konfirmasi sebelum pindah racikan). Detail: `TEMUAN-B1.md` |
| B2 Hapus/arsip data percobaan | [ ] | — | Belum disentuh |
| B3 Void ke tanggal transaksi asli | [ ] | — | Cek dulu: di `main` sudah ada migrasi backdate/J02 (`20261114…`, `20261115…`) dari pekerjaan lain — mungkin sebagian sudah tertangani |
| B4 Pasien dobel | [x] | — | Tidak perlu perubahan |
| C1 Shift & absensi | [ ] | — | Belum disentuh |
| D1 Poin manual | [ ] | — | Belum disentuh |
| D2 Filter retensi N bulan | [ ] | — | Belum disentuh |
| D3 Promo paket | [x] | — | **Belum diverifikasi** |
| E1 Impor pilihan satuan | [x] | — | **Belum diverifikasi** |
| E2 Bundling di impor | [ ] | — | Belum disentuh |
| E3 Akses khusus per akun | [x] di kode | **Kode live, migrasi BELUM dipasang** | Lihat §4. Detail: `USULAN-E3.md` |
| E4 Gudang otomatis saat impor | [ ] sebagian | Bagian 1 live; bagian 2 (pindah stok + nonaktif WH Online) BELUM | Reza sudah jawab [?] = **2A (pindah + nonaktifkan)**. Lihat §4 |
| F1 Laporan hasil opname | [ ] | — | Belum disentuh |
| F2 Beban selisih minus ke karyawan | [ ] | — | Belum disentuh |
| F3 | Ops | — | Lewati |

## 3. Rilis yang sudah keluar

| PR | Isi | Merge SHA | Deployment | Waktu |
|---|---|---|---|---|
| rezanje/kamo-vet-os#507 | A1, A2, A3, A4, A5, A6, B1 | `c36e616` | `dpl_54yC5C5sJidxXbdoksqX2vmx9Xkc` | ~03:36 UTC 13 Nov |
| rezanje/kamo-vet-os#523 | E3 (kode), detail order online (3A), E4 bagian 1, migrasi E4 bagian 2 (file saja, belum dipasang) | `f790622` | `dpl_CsQUwFdj8TmZ3bC8pTxUG36HsG4S` | ~07:00 UTC 14 Nov |

Komentar rilis sudah diposting di kedua PR. Vercel men-deploy `main` otomatis; ID deployment terlihat
sebagai `dpl_…` di HTML halaman `/login`.

Migrasi yang **sudah terpasang** di Production (13 Nov, 10.11–10.13 WIB):
`20261113031139_a1_index_tanggal_laporan`, `20261113031150_a4_submenu_laporan_visit`,
`20261113031357_a5_koreksi_visit_rawat_inap`. Cek live: 7 index A1, `submenu_catalog` 143 baris termasuk
`laporan.visit`, aksi `klinik.koreksi_visit`, kebijakan ADMIN lama + baru, epoch 10→11, trigger guard aktif,
kolom `correction_reason` ada.

## 4. Pekerjaan tertunda (urut prioritas)

### 4a. Pasang migrasi E3 — sudah disetujui Reza (1A)
- File: `supabase/migrations/20261117200000_e3_akses_khusus_akun.sql`.
- Isi: tabel `account_access_overrides` (+ history/requests/permits) di schema `role_settings_private`, RPC
  `get_my_access_override` / `get_account_access_override` / `save_account_access_override`, log aktivitas,
  bagian 8 memperluas `sales_module_access()` untuk akun non-Owner yang diberi modul `penjualan` lewat akses khusus
  (anchor teks fungsi lama sudah dicek cocok dengan Production).
- Kendala sebelumnya: `apply_migration` timeout 3x karena dialog persetujuan Supabase tidak dijawab. Kode sudah
  live dan **aman tanpa migrasi** (loader `src/lib/akses-akun.ts` jatuh ke akses peran bila RPC belum ada) —
  fitur akses khusus saja yang belum bisa dipakai.
- Langkah: (1) `list_migrations` → pastikan versi tertinggi Production masih < `20261117200000`; kalau tidak,
  ganti nomor file di atas max Production **dan** max `main`. (2) `apply_migration`. (3) Verifikasi: tabel & RPC ada,
  `sales_module_access` memuat klausa override, akun tanpa override tidak berubah aksesnya. (4) Rename file ke versi
  yang tercatat Production (konvensi repo), commit, PR.

### 4b. E4 bagian 2 — pindah stok WH Online + nonaktifkan (disetujui 2A)
- Preflight read-only dulu: `docs/runbooks/e4-pindah-stok-wh-online/01-preflight-readonly.sql`.
  Ekspektasi (13 Nov): WH ONLINE PDRY 31 barang / 230 unit, WH ONLINE TKI 3 / 16, mutasi terakhir ≤ 4 Nov 2026.
- Migrasi: `supabase/migrations/20261117300000_e4_pindah_stok_wh_online.sql`. Memakai salinan sementara
  `post_stock_transfer_atomic` (cek akses diganti aktor sistem), prasyarat ketat (angka di atas harus persis
  cocok, kalau beda → gagal tanpa perubahan), pindah stok ke gudang Toko cabang masing-masing, nonaktifkan
  WH ONLINE PDRY/TKI. Di database tanpa kedua gudang itu → no-op (NOTICE).
- Uji lokal: `scripts/test-pindah-stok-wh-online-postgres.py` (52/52 lulus).
- Verifikasi setelah pasang: saldo WH Online = 0, gudang Toko bertambah sebesar qty, **nilai persediaan total
  tidak berubah**, WH Online nonaktif, gudang B2C tidak tersentuh. Lalu rename file ke versi Production,
  centang E4 di TODO.md, laporan rilis.
- Catatan: penjualan online lama yang dibatalkan setelah ini akan mengembalikan stok ke gudang asalnya (WH Online
  yang sudah nonaktif) — perlu dicek perilakunya / dipindah manual bila terjadi. Order online manual
  (Penjualan Online → Baru) masih memilih gudang seperti dulu (di luar cakupan bagian 1).

### 4c. Sisa TODO
- Verifikasi D3 dan E1 (item [x]).
- B3: cek status kode `main` dulu sebelum merancang (ada pekerjaan backdate/J02 dari agen lain).
- P1 berikutnya yang belum disentuh: B2, C1, D1, F1. P2: D2, E2, F2. A7 tunggu jawaban.
- Untuk item yang menyentuh jurnal/stok (B2, B3, F1, F2): tulis usulan di `docs/meeting-2026-11-12/` dulu,
  minta keputusan Reza, baru kerjakan.

## 5. Catatan teknis penting

- **Penomoran migrasi:** Production mencatat migrasi dengan timestamp saat dipasang. File baru harus bernomor
  di atas versi tertinggi Production **dan** di atas file tertinggi di `main` (agen lain juga menambah migrasi —
  sudah beberapa kali bentrok). Setelah dipasang, rename file ke versi Production.
- **Typecheck:** `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .` (tanpa flag → kehabisan memori).
- Tes: `npx vitest run`, `npm run lint`, `npm run build`.
- Harness Postgres lokal:
  `python3 -I scripts/test-<nama>-postgres.py --pg-bin /usr/lib/postgresql/16/bin --json <out.json>`
  (harness A5 **wajib** `--json`; ada juga `--baseline`, `--mutations`). Hapus `scripts/__pycache__` setelahnya.
- Next.js di repo ini versi baru (lihat `AGENTS.md`): `page.tsx` hanya boleh mengekspor nama yang diizinkan —
  komponen bersama taruh di file terpisah (contoh: `penjualan/[id]/DetailPenjualan.tsx`).

### Pola kode yang dibangun
- **Gerbang laporan (A1):** `src/lib/report-gate.ts` (`laporanDiminta`, `denganTampil` — menambah `tampil=1`
  tanpa meng-encode ulang query lain), `src/components/GerbangLaporan.tsx` (`InputTampil`,
  `LaporanBelumDitampilkan`), `LaporanPage` prop wajib `siap`. Halaman laporan baru **wajib** ikut pola ini:
  tanpa `tampil=1` jangan panggil fungsi data. Redirect/drill-down ke laporan pakai `denganTampil()`.
- **Unduhan laporan di server:** pola `laporan/penjual/unduh/route.ts` & `laporan/visit/unduh/route.ts`
  (cek sesi + `bolehBukaPath` dengan `aturanEfektif`, data & saringan sama dengan halaman lewat `olah.ts`,
  sel diamankan `amankanSel`).
- **Akses efektif akun (E3):** satu loader `src/lib/akses-akun.ts` (`bacaAkses`, `aturanEfektif`) menggabungkan
  peran + kebijakan sub-menu + akses khusus akun; dipakai middleware, nav, dan route unduhan.
- **Izin koreksi visit (A5):** aksi `klinik.koreksi_visit` termasuk `GRANT_ONLY_ACTIONS`; jalur ADMIN lama tetap
  harus menyertakan `kasir.diskon_manual` (pernah salah dihapus → ADMIN kehilangan diskon manual; sudah dibalik).
- **Visit terhitung (A4):** maks. 1 visit per orang per pasien per tanggal WIB, sama dengan aturan komisi H06
  (`barisVisitRanap` di `src/lib/komisi.ts`).
- **Gudang impor (E4 bagian 1):** `src/lib/online-gudang.ts` (`gudangUtamaPerCabang`, `tentukanGudangImpor`) +
  `online-gudang-server.ts`; user memilih CABANG, server menghitung ulang gudangnya (gudang Toko, atau satu-satunya
  gudang cabang). Akun satu cabang terkunci.
- **Detail order online (3A):** rute `/penjualan/online/[id]` memakai `DetailPenjualan` dengan `online` → 404 bila
  penjualan bukan kanal online.

## 6. Dokumen terkait
- `TODO.md` — daftar item + status per item.
- `RENCANA-P0.md` — rencana & keputusan A1–A3.
- `USULAN-A5.md`, `TEMUAN-B1.md`, `USULAN-E3.md` — usulan/temuan + keputusan Reza.
- `docs/runbooks/e4-pindah-stok-wh-online/01-preflight-readonly.sql` — preflight E4 bagian 2.

---

## 7. Update sesi lanjutan (14 Nov 2026 sore, branch `claude/cool-mendel-xjtoy1`)

| ID | Status | Live di Production? | Catatan |
|---|---|---|---|
| E3 | [x] | **Ya** — migrasi terpasang 14.43 WIB | Versi Production `20261114074354` (file di-rename). 0 akun ber-akses khusus. |
| E4 bagian 2 | tahap 1 [x], tahap 2 [ ] | **Tahap 1 ya** (15.08 WIB, `20261114080823`) | Keputusan Reza **B**: 4 barang PDRY (21 unit) sama dengan kiriman Permintaan Barang yang masih di Transit → ditahan. TKI 3/16 pindah + nonaktif; PDRY 27/209 pindah, gudang tetap aktif. **Tahap 2** `20261118500000_e4_pindah_stok_wh_online_tahap2.sql` (diuji, belum dipasang) setelah kiriman Transit diterima toko. |
| D3, E1 | [x] diverifikasi | — | Lihat TODO.md. |
| B3 | [ ] temuan | — | `TEMUAN-B3.md`: omzet sudah di tanggal asli di semua jalur; sisa celah jurnal pembatalan struk / void-terbit-ulang klinik. Menunggu keputusan (A/B/C). |
| B2 | [ ] usulan | — | `USULAN-B2.md` (59 dari 82 kunjungan Pembayaran tanpa tagihan → sudah bisa diarsipkan). Menunggu keputusan. |
| C1 | [ ] sebagian | Belum (kode di PR) | Bug tanggal Catat Absensi (terkunci 1 Juli) diperbaiki. `USULAN-C1.md` (tahap + pilihan teknologi wajah). |
| D1 | [x] | **Ya** — migrasi 15.52 WIB (kode setelah merge) | Migrasi `20261114085215_d1_poin_manual.sql` terpasang (Reza: A). Harness `scripts/test-poin-manual-postgres.py` 24/24. |
| D2 | [x] | **Ya** — migrasi 15.52 WIB (kode setelah merge) | Migrasi fungsi baca `20261114085222_d2_filter_retensi.sql` terpasang (Reza: A). Harness `scripts/test-filter-retensi-postgres.py` 14/14. |
| E2 | [ ] usulan | — | `USULAN-E2.md` (barang Grup untuk bundling online). |
| F1, F2 | [ ] usulan | — | `USULAN-F1-F2.md` (Production masih FIFO; plus & minus opname sama-sama ke 720010). |

Migrasi menunggu: `20261118500000` (E4 tahap 2, syarat Transit kosong). D1/D2 sudah terpasang (versi `20261114085215`/`20261114085222`). Versi tertinggi Production saat ini `20261118200000` (cabang_gudang, dari PR lain); `apply_migration` mencatat jam pasang (mis. 2026111408…),
lalu rename file ke versi itu. Build lokal butuh `NODE_OPTIONS=--max-old-space-size=8192 npm run build`.

### 7b. Sesudah keputusan Reza 14 Nov sore (D1/D2 = A, sisanya ikut saran)
- D1/D2 terpasang (lihat tabel di atas).
- Kode + migrasi siap, **belum dipasang** (menunggu izin pasang): B3 `20261118610000`, B2 `20261118620000`, F1 `20261118630000`,
  C1 `20261118640000` (wajib: deploy aplikasi dulu, lalu segera pasang), E2 `20261118650000`, E4 tahap 2 `20261118500000`
  (syarat Transit kosong). Pasang satu per satu dengan urutan nomor; sesudah pasang rename ke versi Production.
- Harness: B3 33/33, B2 62/62 (`--pg-bin /usr/lib/postgresql/16/bin` wajib), F1 33/33, C1 60/60, E2 41/41, E4 82/82, D1 24/24, D2 14/14.
- Vitest: jalankan dengan `--exclude ".claude/**"` bila ada worktree agen di `.claude/worktrees/`.
- F2 belum dikerjakan: menunggu jawaban potong gaji otomatis vs kasbon.
