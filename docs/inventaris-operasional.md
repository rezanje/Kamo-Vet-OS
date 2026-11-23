# Inventaris Operasional (versi awal, 23 Nov 2026)

Permintaan klien lewat Nje: perlengkapan cabang seperti sapu, ember, dan alat pel dicatat jumlahnya per cabang
dan bisa di-opname. Versi awal ini **hanya kuantitas**: tanpa nilai rupiah, jurnal, penyusutan, atau dampak ke stok barang jual.

## Layar (Persediaan → Inventaris Operasional, `/pos/inventaris-operasional`)

- **Daftar Barang**: nama, satuan, jumlah tercatat, terakhir berubah; tambah barang dengan jumlah awal (masuk riwayat sebagai *saldo awal*).
- **Opname**: isi jumlah fisik semua barang aktif cabang; selisih tampil langsung; selisih wajib alasan (min. 3 huruf).
  Saat disimpan, jumlah tercatat diganti hasil hitungan.
- **Riwayat Cabang**: siapa, kapan, sebelum, sesudah, selisih, alasan; bisa dibuka per opname.

Akses sub-menu: `pos.inventaris-operasional` (Akses Grup), mengikuti hak modul Persediaan seperti sub-menu lain.

## Database (`supabase/migrations/20261206100000_inventaris_operasional.sql`)

| Objek | Isi |
|---|---|
| `operational_inventory_items` | barang per cabang, `qty`, `revision` (naik tiap opname) |
| `operational_inventory_counts` | satu sesi opname (pelaku, catatan, jumlah barang, jumlah selisih); tidak bisa diubah/dihapus |
| `operational_inventory_history` | riwayat saldo awal + opname; tidak bisa diubah/dihapus |
| `inventaris_operasional_tambah(...)` | RPC atomik tambah barang + riwayat saldo awal |
| `inventaris_operasional_opname(...)` | RPC atomik: validasi semua baris dulu, lalu kepala opname + riwayat + saldo |

- Akses = irisan **hak menu** dan **hak cabang**, ditegakkan di database (bukan hanya aplikasi):
  - hak menu `inventaris_operasional_allowed()`: Owner selalu; Admin Online tidak; akses khusus akun (mode *khusus* = hanya isinya,
    *tambah* = ditambah hak peran); hak peran dari `role_modules` (tanpa baris = bawaan: ADMIN/DOCTOR semua modul, STAFF/FINANCE
    tidak termasuk Persediaan) lalu kebijakan sub-menu `pos` (bila ada wajib memuat `pos.inventaris-operasional`).
    Katalog hilang, data akses khusus rusak, atau galat = ditolak (gagal tertutup);
  - hak cabang `user_can_access_branch(branch_id)` (penempatan cabang / peran bebas cabang + pilihan cabang operasional).
- Baca: RLS ketiga tabel = hak menu DAN hak cabang. Tulis: tidak ada hak tulis langsung; hanya dua RPC `SECURITY DEFINER`
  yang mengecek pelaku aktif + hak menu (`INVENTARIS_MENU_DITOLAK`) + hak cabang (`INVENTARIS_CABANG_DITOLAK`).
- Admin Online: ditolak (guard_all/fence_all dijalankan ulang).
- Klik ganda: kunci permintaan per pelaku + kunci advisori; kiriman ulang yang sama mengembalikan dokumen pertama.
- Saldo berubah sejak dibaca: tiap baris membawa `revision`; beda revisi atau daftar barang berubah = seluruh opname ditolak.

## Uji

- `scripts/test-inventaris-operasional-postgres.py` (PostgreSQL native sekali pakai, rantai migrasi penuh, data fiktif):
  daftar, saldo awal, klik ganda, nama kembar, isolasi cabang, Admin Online, akun nonaktif, tulis langsung ditolak,
  selisih tanpa alasan, opname dengan/tanpa selisih, revisi lama, daftar berubah, kiriman bersamaan, riwayat append-only,
  dan **tidak ada baris baru di tabel lain** (jurnal, stok, aset); gerbang hak menu: tanpa centang sub-menu, modul tanpa
  kebijakan, peran tanpa Persediaan, bawaan per peran, akses khusus tambah/khusus, katalog hilang, Admin Online. `--baseline` tanpa migrasi = RED.
- `src/lib/__tests__/inventaris-operasional.test.ts`: parsing angka/form, pilihan cabang, pesan gagal, menu + sub-menu.

## Belum termasuk

Nonaktif/ubah nama barang, ekspor, nilai rupiah, jurnal, penyusutan, dan pemilihan cabang pilot nyata.
