# Integrasi prioritas keluhan Aldy — PR74/75/76/77

Status: kandidat **draft untuk review dan acceptance terisolasi**, bukan izin rilis.
Prioritas terbaru parent membatasi paket utama ke PR74/75/76/77 dan Kartu Stok.
Kartu Stok dari thread `01a15db6-e4d0-729e-911c-d7a84f732013` diterima
sebagai PR77 setelah parent mengonfirmasi review independen statis tanpa temuan
penting. Head tepat dibaca/diperiksa lalu digabung; runtime diulang di sini.

## Sumber tepat dan cakupan

Base main: `d6d9c70d24fed05ff16a2dfd32f55cbeaa48fb3f`.
Branch: `codex/kamo-priority-74-77-20261021`.
Commit komposisi sumber yang diuji: `426b3584eb5d1a860922bb6f056859158f08472c`.
Commit sesudahnya hanya menambah harness dan bukti pengujian. PR77 tidak
mengubah SQL; hasil 210 migrasi sebelum penambahan UI itu tetap berlaku.

| PR | Head tepat | Perlakuan |
| --- | --- | --- |
| 74 | `af4599401703379a974bed9489722991089588ee` | Impor **baru** atomik stok/FIFO/mutasi dan GL cabang; historis hanya laporan |
| 75 | `94b4474a60c2774f910ac76df277d82e1a73f2cc` | Aksi reset tetap tertutup; panduan pemeliharaan baca saja |
| 76 | `cb0cb3b87e7ffac0c9bfd1e9710d5e7aac47fdef` | Lifecycle master termasuk guard rename kode sebelum Sampah |
| 77 | `12a964d874706e93be9a2bd35458d9b129da1778` | Kartu Stok: nama searchable, kode terpisah; default picker lama tetap |

Head main/74/75/76/77 diverifikasi ulang dengan `git ls-remote` sebelum handoff,
tidak berubah. AGENTS dibaca. Next terpasang 15.5.25 tidak menyediakan
`node_modules/next/dist/docs/`; tidak ada perubahan implementasi Next baru.
PR62 dan seluruh PR68–77 beserta komentar/review/thread dibaca melalui GitHub.
Saat pembacaan tidak ada GitHub review/review-thread pada PR tersebut. Parent
menyampaikan review independen statis delta PR76 menutup P2; ini bukan approval
GitHub atau acceptance gabungan produksi.

Tidak ada konflik teks pada komposisi prioritas. Auto-merge `pos/sku/impor/actions.ts`
mempertahankan seluruh jalur stok/GL PR74 dan menambahkan guard peran aktif PR76.
PR62 tidak menjadi ancestor; versi PR76 lama `06c2a5b` tidak digunakan sendirian.

## Verifikasi aktual

Seluruh DB fixture dibuat sendiri dalam Docker PostgreSQL16 `--network none`,
tanpa published port, host volume, kredensial eksternal, atau data nyata.
Image digest ada di [manifest](../../evidence/2026-10-21-priority-integration/manifest.json).
Auth/storage adalah shim fiktif, bukan GoTrue/PostgREST.

- **210 migrasi** main + PR74 + PR76 diterapkan. Tiga suite impor lulus:
  `accurate_inventory_accounting.sql`, `..._guards.sql`, `..._review.sql`.
  Meliputi posting baru, retry, immutable basis/receipt/journal, fail-closed dan
  rollback kegagalan jurnal; perbandingan nilai impor asli vs FIFO tersisa pada
  laporan historis tetap baca saja.
- Suite `master_data_lifecycle.sql`, `master_item_code_history.sql` dan **15 race
  dengan lock wait nyata** lulus. Termasuk kedua urutan source-code/JSON vs rename,
  stale revision, FK/satuan/JSON, pencabutan cabang/actor. Regresi merchant-fee,
  split-payment dan online-return/FIFO juga lulus pada skema prioritas.
- Runner race impor: actor dinonaktifkan saat menunggu ditolak; retry batch
  concurrent menghasilkan satu receipt/jurnal/kuantitas. Tiga kasus khusus RPC
  PR70 ditandai SKIP karena PR70 sengaja tidak dimasukkan paket prioritas; kasus
  itu telah lulus pada cabang lanjutan berisi PR70.
- Harness tambahan `test-priority-integration-postgres.py` lulus: fixture PR74
  dengan provenance kode nyata tetap dapat post/retry; rename dan Sampah ditolak;
  edit label dan Nonaktifkan mempertahankan identitas/kode serta satu jurnal.
  Percobaan awal harness belum mengatur claim role dan ditolak sesuai guard;
  penambahan claim fiktif memperbaiki setup, tidak mengubah izin implementasi.
- Full Vitest prioritas: **2.257 lulus / 3 gagal** (275 file) setelah PR77; sebelum PR77 2.251/3. Main bersih pada
  dependensi yang sama: **2.194 lulus / 3 gagal** (263 file). Ketiganya identik:
  dua `merchant-fee-report-pages.test.tsx` kekurangan auth.getUser mock dan satu
  `remaining-transaction-forms.test.tsx` mengasumsikan input PO draft_key.
  Tidak ada kegagalan baru yang teramati; tidak mengklaim full suite hijau.
- Next production build exit0; TypeScript `tsc --noEmit` exit0; scoped ESLint
  dan `git diff --check` lulus. Build hanya memakai Supabase loopback fiktif.
  Warning lama Supabase/Edge dan lint tetap tercatat pada log.
- Chromium komponen aktual: master desktop/390px mempertahankan alasan dan
  menampilkan penolakan/restore/hasil tidak pasti; safe reset desktop/390px punya
  nol kontrol submit dan nol request eksternal. Harness impor tambahan: historis
  tanpa kontrol posting; respons hilang mempertahankan input beku dan retry
  identik menemukan receipt; desktop/390px tanpa overflow/error runtime.
  Screenshot impor memakai wrapper sederhana tanpa stylesheet aplikasi penuh;
  hasil ini memverifikasi interaksi, bukan acceptance visual aplikasi lengkap.
  Setelah PR77, runner Chromium Kartu Stok pada komposisi final juga lulus
  desktop/390px: 1.205 item, nama duplikat/kode, keyboard/klik/clear/Escape,
  GET gudang/tanggal, Back, tanpa request eksternal atau runtime error.

Dependensi bawaan workspace tidak lengkap sehingga run pertama tidak sah untuk
perbandingan regresi. `npm ci` biasa dengan npm11.9.0 juga ditolak oleh resolusi
peer picomatch pada lockfile baseline. Instalasi **lockfile yang sama** dengan
`npm ci --legacy-peer-deps --cache /workspace/.npm` di direktori terpisah berhasil.
Paket/lockfile repository tidak diubah. Semua angka Vitest/build di atas berasal
dari instalasi lengkap tersebut. Standard clean-install/peer resolution tetap
perlu dibereskan terpisah bila pipeline mewajibkan `npm ci` tanpa opsi itu.

Log, screenshot, dan manifest ada di
[`docs/evidence/2026-10-21-priority-integration`](../../evidence/2026-10-21-priority-integration).
Reproduksi:

```sh
python3 scripts/test-accurate-inventory-accounting-postgres.py
python3 scripts/test-accurate-inventory-accounting-races.py
python3 scripts/test-master-data-lifecycle-postgres.py --regression-suite pos_merchant_fees.sql --regression-suite pos_split_payments.sql --regression-suite online_return_unit_posting.sql
python3 scripts/test-priority-integration-postgres.py
npm test -- --maxWorkers=2
npx --no-install tsc --noEmit
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=fictional-local-fixture npm run build
node scripts/test-priority-import-browser.mjs
python3 scripts/test-kartu-stok-browser.py
KAMO_PLAYWRIGHT_MODULE=/path/to/playwright node scripts/test-master-data-lifecycle-browser.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/preview-reset-guidance.mjs
```

## Pekerjaan lanjutan yang dipertahankan

Branch terpisah `codex/kamo-integration-68-75-20261021` menggabungkan PR68–75;
commit komposisi `a1443b1e08e2fb3403f4d3a9ea6486e2ab0932df`.
Branch `codex/kamo-integration-68-76-20261021` menambah PR76, commit komposisi
`161aaa8b8d474d7852b982b261416c23444cadfe`.
Keduanya bukan kandidat rilis prioritas. Head PR68–73/62 tersimpan di manifest.

Satu konflik dashboard PR71/72 diselesaikan pada merge `028da18`: `fjMovements`
bertanggal, settlement/carried-payment active-only dan signed chart PR71
dipertahankan; retur aktif PR72 dikurangi sekali, predicate retur supplier dan
mutasiHutang tetap ada. 20 tes pembaca/dashboard/chart terkait lulus. Guard
rekonsiliasi legacy NULL dari PR72 tidak diubah. Pada 215 migrasi gabungan,
suite native transfer, stock, opening, wholesale, return, asset, impor termasuk
rollback dan race lintas dependensi lulus. Satu run stock race awal kehabisan
barrier saat banyak pekerjaan paralel; rerun tanpa beban tersebut lulus kedua
urutan konsumsi/koreksi. Ini dicatat sebagai sensitivitas harness, bukan bukti
full acceptance. Run aplikasi penuh awal lanjutan memakai dependensi tidak
lengkap dan tidak diklaim sah. Pada 216 migrasi termasuk PR76, lifecycle/code
history dan 15 race juga lulus. Tidak memaksakan PR68–73 ikut paket keluhan.

## Gap dan urutan yang disarankan

1. Review/accept PR75 untuk menjaga reset tertutup; tidak perlu migrasi baru.
2. Review dua migrasi PR74 lalu PR76 secara urut bersama aplikasi yang sesuai,
   pada backend staging terisolasi dengan parity skema dan ukuran data target.
   Jalankan acceptance OWNER/ADMIN aktual, impor baru, jurnal/Neraca, referensi
   master, denial dan recovery. Fixture shim/preview build belum memenuhi gate ini.
3. PR77 dapat direview/dilepas bersama paket keluhan; tidak punya migrasi.
   Tetap lakukan acceptance Kartu Stok terautentikasi pada katalog staging dan
   uji pemakai picker lama dengan lifecycle master. Tidak ada overlap file
   PR76/77; loader/hitungan stok tidak diubah PR77.
4. Historical PDRY tetap **menunggu keputusan tanggal saldo dan akun lawan**.
   PR74 tidak memperbaiki batch historis; jangan reimport/backfill atau memakai
   selisih FIFO tersisa sebagai jurnal.
5. PR68–73 dilanjutkan terpisah setelah keluhan prioritas selesai, termasuk batas
   Finance/komisi/historis masing-masing. PR62/reset tidak digabung otomatis.

Tidak ada akses baru, kredensial/data produksi, DB/migrasi produksi, reset,
backfill PDRY, penghapusan data nyata, merge main atau deploy produksi dilakukan.
Container/fixture yang dibuat sendiri dibersihkan sesudah uji. Tidak ada penolakan
approval yang dibypass. Draft/push hanya menyiapkan review; bukan release.
