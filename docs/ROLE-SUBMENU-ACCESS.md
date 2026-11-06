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
galat baca lain ⇒ middleware gagal tertutup ke login.

## Memperbarui katalog
Menambah halaman/sub-menu baru: tambah `e("modul","slug",[rute])` di `submenu-access.ts`, jalankan
`python3 scripts/gen-submenu-migration.py` untuk migrasi katalog baru (jangan mengubah migrasi lama), dan jalankan
`npx vitest run src/lib/__tests__/submenu-access.test.ts` (tes memindai semua `page.tsx`/`route.ts`; rute baru yang
belum dipetakan membuat tes gagal).
