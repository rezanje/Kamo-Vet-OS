# Hak akses SUB-MENU per peran (Akses Grup level 2)

Status: kandidat di branch `hermes/role-submenu` (belum rilis). Berlaku untuk navigasi/halaman saja; RLS dan
kebijakan aksi (`role_action_allowed`) di database tidak disentuh.

## Aturan
- Tanpa kebijakan sub-menu, peran berperilaku persis seperti sekarang: modul diizinkan ⇒ semua halamannya boleh.
  Pembatasan itu opt-in per peran per modul; bawaannya "semua sub-menu". OWNER tidak pernah dibatasi.
- Satu id sub-menu (`klinik.pembayaran`) memiliki satu/lebih prefix rute (`src/lib/submenu-access.ts`). Halaman rincian
  di bawah prefix mewarisi sub-menunya; prefix terpanjang menang.
- Rute di dalam modul yang dibatasi tapi tidak dimiliki sub-menu mana pun **ditolak** (gagal tertutup), kecuali halaman
  depan modul (kotak menu) yang terbuka selama ada ≥ 1 sub-menu diizinkan.
- Modul dicentang tetapi semua sub-menu kosong ⇒ dianggap tidak bisa dibuka (hilang dari sidebar, URL ditolak).
- Shift Kasir, Quest Staff, Kasir tetap diatur grup Operasional; `/me`, `/mulai`, `/login`, `/booking` tetap selalu boleh.

## Alur data
`role_settings_private.submenu_policies(role, module_id, allowed[])` ← hanya `save_role_access_config(..., p_submenus)`
(permit + revision + request key + epoch + audit, sama seperti kebijakan aksi). Dibaca lewat `get_my_submenu_policy()`,
ditempel ke baris `role_modules` yang sama (`gabungSubmenu`) sehingga middleware, sidebar, tile, pencarian memakai satu
aturan (`bolehBukaPath`). Aplikasi rilis sebelum database: fungsi tidak ada ⇒ "tidak ada kebijakan" (perilaku lama);
**hanya** bila galatnya PGRST202 / 42883 yang pesannya menyebut persis `get_my_submenu_policy`. Galat lain (timeout,
izin, bentuk jawaban, atau 42883 dari DALAM fungsi lain) = galat: peran selain OWNER gagal tertutup (middleware ke
`/login` dengan pesan "Hak akses halaman belum bisa diperiksa…"; `/api/cari` membalas 503). OWNER tidak pernah
dibatasi, jadi galat baca kebijakan diabaikan untuk OWNER (tidak ada kunci-keluar).

## Di mana sub-menu ditegakkan (dan di mana tidak)
- Halaman `(app)` dan Server Action yang lewat URL halaman: middleware (`src/lib/supabase/middleware.ts`), per URL.
- **Middleware melewati semua `/api`.** Route handler `/api` yang membaca data menurut peran harus memakai
  `loadSubmenuPolicy` sendiri dan gagal tertutup (`status === "error"` dan bukan OWNER). Saat ini: `/api/cari` (sudah).
  `/api/pelanggan` dan `/api/impor/accurate/progres` tidak memakai `bolehBukaPath`/sub-menu (RLS / OWNER+ADMIN saja);
  `/api/cron/*` memakai CRON_SECRET; `/api/version` publik.
- `rulesWithSubmenu` hanya untuk tampilan (tile `/laporan`): gagal baca = tanpa batas, JANGAN dipakai sebagai gerbang.
- Pemeriksa server tingkat modul (inventory-closing, inventory-historical, opname-price-report, hpp-reports-server,
  pos/opname/actions, faktur/unduh, penjualan-barang/unduh, preset-actions, pending-work, mulai/cabang) memakai
  `role_modules` mentah (tanpa sub-menu); URL-nya tertutup oleh middleware. Sub-menu = navigasi, bukan pagar DB.

## Halaman tanpa pemilik modul
`/dokumen`, `/keuangan`, `/pajak/faktur`, `/aset-tetap`, `/keuangan/laba-ditahan` dipegang peran yang bawaannya semua modul
(ADMIN, DOCTOR) hanya selama SEMUA modul tercentang dan tiap modul masih punya sub-menu terbuka. Satu modul tak dicentang
atau dikosongkan ⇒ semuanya tertutup. Form Akses Grup memperingatkan hal ini (`OWNERLESS_FULL_REACH_PAGES`).

## Nomor migrasi
`20261107890000_role_submenu_access.sql` sengaja bernomor jauh di depan. Aturan renumber: tes sinkron hanya meminta nomor
ini unik, versi = nama berkas, dan setelah `role_settings_atomic`; migrasi lain bernomor lebih BESAR tidak membuat CI merah.
Renumber saat merge: bila sudah ada migrasi di main bernomor LEBIH BESAR dari ini, ganti nomor berkas ini menjadi setelah
migrasi terakhir (nama berkas + tes + dokumen ini). Sesudah ini terpasang di produksi, migrasi baru wajib bernomor di atasnya
(nomor lebih kecil = "out of order" di Supabase CLI kecuali `--include-all`).
