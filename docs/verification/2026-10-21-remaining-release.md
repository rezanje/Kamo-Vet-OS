# Gabungan rilis sisa PR68–73 dan PR79

Base produksi/main terbaru: `9aafe37d13913735dacbee60ffd2099b43853db9` (PR80).
Base awal sebelum perubahan bersamaan: `c320e5b73364a60aca3b580563db12e4a7d1550e` (PR78).
Branch `codex/kamo-remaining-release-20261021`. SHA tepat semua sumber dan
checksum/urutan migrasi ada di [manifest](../evidence/2026-10-21-remaining-release/manifest.json).
PR74–80 yang sudah masuk main tetap dipertahankan. PR62, implementasi costing
baru, aktivasi average dan perbaikan historis PDRY tidak dimasukkan; tidak ada
koreksi transaksi otomatis saat rilis. PR80 berasal dari tugas bersamaan.

## Komposisi

- PR68 transfer;69 stok/opname;70 saldo awal uang;71 grosir;72 retur;73 aset;
  79 input jumlah langsung pada Kasir. Seluruh head diperiksa ulang.
- Konflik dashboard PR71/72: tetap gunakan `fjMovements` bertanggal untuk
  source/reversal/replacement, settlement dan carried payment aktif saja, chart
  signed; netting retur jual aktif sekali. Predicate retur pemasok/mutasiHutang
  dan guard legacy NULL reconciliation PR72 tetap ada.
- Migrasi enam PR hanya menambah metadata/histori dan mengganti definisi RPC,
  policy/guard. Tidak mengeksekusi mutasi dokumen/jurnal/stok historis. Body RPC
  yang dapat mengoreksi transaksi baru berjalan bila dipanggil oleh pengguna
  yang berwenang; tidak dipanggil saat rilis/tes produksi.

## Dua perbedaan integrasi produksi yang ditutup

1. PR76 sudah dipasang sebelum tabel koreksi baru. Clean replay memasang guard
   master sesudah tabel baru, berbeda dari urutan produksi. RED pada urutan
   produksi menemukan35 kolom JSON tanpa fence. Migrasi terakhir
   `20261021183000_correction_master_reference_guards.sql` mendaftarkan kontrak
   guard existing hanya pada16 tabel koreksi baru (FK master, UUID/JSON, label
   satuan), tanpa ACL baru atau rewrite data. Aman pada clean replay karena
   guard yang sudah sama dibiarkan; benturan fungsi guard ditolak.
2. Produksi masih menyimpan overload invoker faktur11 argumen lama, tidak ada
   pada clean replay dan tanpa izin INSERT faktur untuk anon/authenticated/
   service_role. Patch PR72 yang memproses semua overload sebelumnya berhenti
   karena anchor canonical tidak ada. RED direproduksi pada fixture legacy.
   Delta integrasi membiarkan signature lama itu tetap utuh hanya bila tetap
   invoker dan tanpa hak INSERT; authority tak terduga membatalkan migrasi.
   Signature canonical13 argumen wajib ada dan tetap mendapat predicate retur
   aktif. Tidak menghapus RPC lama, mengganti ACL, atau memperluas hak tulis.

## Verifikasi awal pada base PR78 (arsip)

- Full aplikasi: **2.359 lulus / 3 gagal**,300 file. Ketiganya baseline yang sama
  pada main/PR78: dua `merchant-fee-report-pages.test.tsx` missing auth.getUser
  mock dan satu `remaining-transaction-forms.test.tsx` asumsi PO draft_key.
- Next production build termasuk TypeScript, scoped lint dan whitespace lulus.
  Build memakai Supabase loopback fiktif; warning lama tetap dicatat.
- Seluruh217 migrasi pada DB Docker milik fixture, network-none: suite/race
  transfer, stock/opname, monetary opening, wholesale, return, asset dan bridge
  impor lulus. Mencakup rollback final-step, stale/retry, kedua urutan konsumsi,
  rekonsiliasi, payroll/advance dan pencabutan actor. Opening runner memakai
  adapter DisposablePostgres karena host tidak menyediakan createdb/psql.
- Runner khusus mengulang urutan produksi:210 migrasi main yang telah rilis,
  kemudian enam migrasi sisa dan guard terakhir. Fixture legacy11 argumen
  tetap identik setelah patch. Coverage master dan penolakan request JSON baru
  yang menunjuk master Sampah lulus. Fixture transfer, stock, dua opening,
  sales posting/wholesale, asset, impor, kode SKU, merchant fee, split payment,
  online return, return correction dan date windows lulus dalam urutan itu.
  Setup wholesale awal runner belum menyertakan fixture sales source; diperbaiki
  mengikuti runner asal, tanpa perubahan produksi atau pelonggaran izin.
- Tambahan fixture menguji unexpected INSERT authority pada overload lama:
  migrasi wajib gagal dan rollback grant/table fixture tersebut. Perubahan izin
  ini hanya di transaksi fixture disposable, tidak pernah di produksi.
- PR79:73 tes terarah dan Chromium komponen1280px/390px lulus pada source
  input yang sama; full gabungan juga mencakup11 tes Qty. Bukan acceptance
  login/checkout bisnis. Tidak menjalankan transaksi fiktif pada produksi.

Log di [direktori bukti](../evidence/2026-10-21-remaining-release).
Reproduksi urutan rollout: `python3 scripts/test-remaining-production-order.py`.
Enam runner native Docker masing-masing ada di `scripts/test-*-corrections*`;
build dan aplikasi: `npm test -- --maxWorkers=2`, `npm run build` dengan backend
loopback fiktif. AGENTS dibaca; Next15.5.25 tidak menyediakan direktori docs
yang diminta dan tidak ada API/routing Next baru pada delta ini.

## Batas rilis dan recovery

Gunakan hanya tujuh migrasi dalam manifest, urut, satu transaksi dengan lock/
statement timeout dan assertion skema/privilege. Tidak menjalankan db push semua
history karena registry lama memakai nama/timestamp berbeda. Sesudah commit,
readback registry, RLS, RPC/ACL, sumber legacy dan coverage guard wajib lulus
sebelum merge normal dengan guard SHA; produksi harus terminal SUCCESS dahulu.

Failure SQL membatalkan transaksi. Fallback aplikasi mempertahankan data/guard
dan reset tertutup; beberapa aksi lama dapat fail closed sehingga forward fix
lebih tepat daripada membuka guard. Tidak memakai restore backup lama yang
menimpa transaksi hari ini. Tidak mengklaim full recovery drill atau acceptance
bisnis. Scope/limit Finance, legacy proof, periode dan komisi masing-masing PR
tetap berlaku; deploy kode tidak berarti mengeksekusi koreksi historis.

Hasil merge, deployment exact SHA/URL dan smoke read-only dicatat pada PR rilis.


## Rekonsiliasi final dengan PR80 yang sudah live

Main diverifikasi ulang sebagai `9aafe37d13913735dacbee60ffd2099b43853db9`.
Produksi memiliki lima record migrasi PR80, tetapi mode masih `fifo`,
`activated_at=null`, `closed_through=null`; tujuh migrasi paket ini belum terpasang.
Tidak mengulang atau mengganti migrasi PR80, tidak mengaktifkan costing.

- Merge main PR80 ke branch integrasi berjalan bersih. Saldo awal mempertahankan
  pembacaan valuasi PR80 dan penyimpanan atomic PR70; penghapusan lama tetap ditolak.
- Koreksi stok/opname dan koreksi retur baru melakukan fail-closed bila average
  aktif. Algoritma reversal FIFO tidak dipaksakan menjadi algoritma average.
  Posting normal tetap memakai helper PR80; fungsi stock_in/out, activation dan
  closing PR80 terbukti identik byte sebelum/sesudah migrasi paket ini pada fixture.
- Semua entry koreksi/posting stok yang baru mengambil shared costing-mode lock
  sebelum lock dokumen/stok/ledger. Enam race sesi riil membuktikan mereka menunggu
  exclusive lock yang juga dipakai activation/closing, tanpa lock dokumen lebih dulu.
- Saldo awal moneter tetap usable; opening persediaan 1301 melalui RPC baru ditolak
  saat average aktif karena harus memakai bridge impor resmi. Ini tidak mengubah
  mode, saldo atau jurnal produksi.
- **2.401/2.401 tes aplikasi lulus, 308 file**, production build termasuk TypeScript
  lulus. Tiga kegagalan baseline lama ditutup oleh PR80; angka arsip di atas bukan
  hasil gabungan terbaru. Chromium fixture Qty 1280/390 lulus, nol error runtime
  dan nol request eksternal; ini bukan acceptance backend/login bisnis.
- Urutan produksi:215 migrasi main lalu tujuh pending lulus seluruh fixture family,
  guard master/legacy, dan suite PR80 moving-average/closing, purchase correction,
  sale correction, clinic/compound/delivery. Native stock dan retur mencakup retry,
  stale revision, konsumsi bersamaan, bank reconciliation kedua urutan dan rollback.
- Clean replay222 migrasi juga diuji terpisah. Nomor enam migrasi asal belum pernah
  diterapkan di produksi dan tidak diganti; sumber helper PR80 tetap dipertahankan.
- Percobaan awal menjalankan `moving_average_inventory.sql` tanpa prefix fixture POS
  ditolak karena barang fiktif belum dibuat. Runner komposisi kini menyertakan setup
  asli PR80 dan suite tersebut lulus. Race guard juga menemukan entry `begin` inline
  pada issue RPC; posisi lock diperbaiki lalu race diulang sampai lulus.

Log final memakai prefix `pr80-` pada direktori bukti. `production-order-final`
merupakan hasil final; log lain merupakan jejak RED/iterasi, bukan acceptance.

## Status publikasi

Paket tersedia sebagai draft PR81. Pemeriksaan izin otomatis menolak pembuatan
PR non-draft karena menerapkan batas awal draft-only/no-merge/deploy, meskipun
pesan delegasi terbaru membawa ACC user untuk PR68–73+79. Tidak mencoba ready,
merge, apply migrasi atau deployment lewat jalur lain. PR81 tetap draft sampai
blokir ini diselesaikan. Tidak ada transaksi uji bisnis di produksi.
