# Permintaan barang klinik ke DC / cabang lain ditolak — 2 November 2026

Laporan Anisa (grup klinik, 15.47): permintaan barang dari cabang klinik (Panduraya → "DC VET CMGG") gagal dengan
pesan "Permintaan baru harus menunggu persetujuan".

## Akar masalah
- Layar Permintaan Barang klinik menulis header langsung ke `stock_requests` dari browser/server action.
- Trigger `guard_stock_request_write` (SECURITY INVOKER) memeriksa `exists(select 1 from warehouses where id = to_warehouse_id …)`
  di bawah RLS pemanggil. Kebijakan restriktif `operational_warehouse_selection` (20261014052234) menyembunyikan gudang cabang lain
  begitu header `x-kamo-operational-branch` terpasang — termasuk gudang DC — sehingga cek gagal dan pesan di atas muncul.
- Daftar tujuan di layar memakai `operational_request_destinations` (SECURITY DEFINER), jadi gudangnya tetap bisa dipilih.
- Kasir petshop sudah dibetulkan untuk kasus yang sama lewat `create_cashier_stock_request_atomic` (20261015050000);
  klinik belum.
- Tambahan: pilihan prioritas "Rendah" di form klinik selalu ditolak database (cek `priority in ('normal','tinggi')`).

## Perubahan
- Migrasi `20261106050000_permintaan_barang_klinik_atomik.sql` (aditif): `create_clinic_stock_request_atomic` — padanan fungsi
  kasir untuk shift **klinik**; tujuan = gudang aktif non-TRANSIT di cabang aktif (sama dengan daftar tujuan & syarat trigger lama);
  barang/satuan/faktor dibaca dari master; nomor PRM global dengan kunci yang sama; satu transaksi; ulang identik = dokumen sama.
- `klinik/permintaan/actions.ts`: memakai RPC itu dengan `request_key` dari halaman. Bila fungsi belum terpasang (`PGRST202`),
  jalur lama dipakai apa adanya (aplikasi aman dirilis sebelum migrasi). Prioritas di luar normal/tinggi → normal; opsi "Rendah"
  dihapus dari form.

## Rilis
1. Aplikasi boleh dirilis lebih dulu (perilaku sama seperti sekarang sampai migrasi terpasang).
2. Terapkan migrasi `20261106050000` ke Production (SECURITY DEFINER baru — review: hak `authenticated` saja, cek profil aktif,
   akses cabang, shift klinik terbuka). Setelah itu permintaan klinik ke DC langsung berfungsi tanpa deploy ulang.
- Rollback: `drop function public.create_clinic_stock_request_atomic(uuid,uuid,uuid,text,text,jsonb);` (aplikasi kembali ke jalur lama).

## Tes
- `KAMO_PG_BIN=/usr/lib/postgresql/16/bin python3 scripts/test-clinic-stock-requests-postgres.py`: 362 migrasi dari nol; penolakan
  lama tereproduksi persis; RPC menyimpan header+baris, snapshot master, faktor satuan, ulang identik, rollback penuh bila satu baris
  gagal; menolak gudang nonaktif/TRANSIT/tak dikenal, barang jasa/qty 0, prioritas "rendah", cabang lain, tanpa shift klinik; anon tanpa hak.
- `src/lib/__tests__/clinic-stock-request-action.test.ts`: jalur RPC, penolakan database, fallback sebelum migrasi, prioritas.
