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

## Catat Pembelian (migrasi `20261207100000_inventaris_pembelian.sql`)

Tab **Pembelian** (`/pos/inventaris-operasional/pembelian`, sub-menu yang sama `pos.inventaris-operasional`).

- **Siapa:** hanya **FINANCE aktif** yang lolos gerbang menu (Akses Grup / akses khusus) dan akses cabang. Owner, Admin,
  staf hanya membaca daftarnya (bila lolos menu + cabang). Pilot: Owner memberi peran FINANCE modul Persediaan dengan
  sub-menu **Inventaris Operasional saja** di Akses Grup — modul/sub-menu Persediaan lain tetap tertutup.
- **Form:** barang terdaftar atau baru (nama + satuan), jumlah, nominal total, kas sumber (rekening kas/bank aktif milik
  cabang atau rekening umum; kas kecil salah satunya), catatan, nota (wajib, folder `pengeluaran/`). Tanggal = hari ini (WIB).
- **Satu simpan, satu transaksi** (`inventaris_operasional_beli`): Kas Keluar biasa (`cash_entries`, nomor KK master
  penomoran) + jurnal `kas-entry` Dr akun beban / Cr akun rekening kas + nota (`document_attachments`, modul pengeluaran)
  + jumlah barang & riwayat `pembelian` + baris penghubung `operational_inventory_purchases`. Gagal di mana pun = semua batal.
  Kunci permintaan per pelaku: kiriman ulang/klik ganda mengembalikan hasil pertama.
- **Persetujuan:** aturan `kas-keluar` di atas batas nominal tetap berlaku (kunci sama dengan Kas Keluar biasa); pengajuan
  `disetujui` dipakai (`terpakai`) di transaksi yang sama.
- **Batal/koreksi:** hanya dari tab Pembelian (`inventaris_operasional_batal_pembelian`, Finance): Kas Keluar dibatalkan
  lewat `revise_cash_entry` (jurnal pembalik) dan jumlah barang dikurangi (riwayat `batal_pembelian`) sekaligus; ditolak
  bila jumlah sekarang < jumlah pembelian. Koreksi = batalkan lalu catat ulang. Jalur kas umum (`revise_cash_entry` edit/void,
  ubah/hapus langsung `cash_entries`, ubah/hapus nota) ditolak trigger untuk Kas Keluar pembelian (`INVENTARIS_KAS_TERKUNCI`).
- **Barang lama / saldo awal / opname:** tidak dijurnal (tidak ada jurnal retroaktif). Pembelian menaikkan revisi barang,
  jadi halaman opname yang dibuka sebelum pembelian ditolak saat disimpan.

### Akun beban (ASUMSI UJI: 740001 Beban Perlengkapan Toko)

Kode final menunggu konfirmasi klien. Disimpan di `operational_inventory_settings.beban_code` (satu baris). Mengganti dengan aman:

    update public.operational_inventory_settings set beban_code = '<kode>' where id;  -- dalam migrasi kecil

Trigger menolak akun induk, nonaktif, bukan tipe BEBAN, atau akun rekening kas/bank. Berlaku hanya untuk **pembelian baru**;
pembelian lama tetap di akun saat dibukukan (`operational_inventory_purchases.beban_code`). Jangan mengubah jurnal lama.

### Uji pembelian

`scripts/test-inventaris-pembelian-postgres.py` (PostgreSQL native sekali pakai, rantai migrasi penuh, data fiktif dua cabang):
Finance sah (barang baru & terdaftar, rekening cabang & umum), isi Kas Keluar/jurnal/nota/riwayat, nomor KK, kirim ulang,
kunci dipakai ulang, kiriman bersamaan, bukan Finance (staf/Admin/Owner/nonaktif/Admin Online), cabang & kas salah, Finance
tanpa menu, nota wajib/valid, angka tidak valid, kegagalan atomik di tengah, persetujuan, jalur kas umum ditolak (+ regresi
kas biasa), pembatalan resmi (+ kirim ulang, ganda, jumlah kurang), opname tanpa jurnal, opname basi, ganti akun beban, jurnal
seimbang, tanpa stok barang jual. `--baseline` tanpa migrasi = RED. Unit: `src/lib/__tests__/inventaris-pembelian.test.ts`.

## Belum termasuk

Nonaktif/ubah nama barang, ekspor, penyusutan, tanggal mundur pembelian, unggah nota di sandbox (storage), dan pemilihan cabang pilot nyata.
