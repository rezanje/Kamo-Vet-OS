# Grup bertingkat (paket di dalam paket)

**Pelapor:** Andri (grup Kamo Group – ERP Dev, 6 Nov 2026). Kebutuhan: paket sering dibuat dari paket lain
(mis. Kimia Darah Lengkap di dalam paket checkup), dan paket luar harus ikut berubah otomatis bila isi paket
dalam diubah.

## Desain

- `item_group_recipe` — susunan yang diisi admin di tab *Rincian Grup*. Komponen boleh Grup lain.
- `item_group_components` — tetap menjadi **resep terbuka** (hanya Persediaan/Jasa/Non-Persediaan), tetapi kini
  dihitung otomatis dari `item_group_recipe`. Qty barang dari Grup dalam = qty Grup dalam × faktor satuannya × qty
  barang di Grup dalam. Barang + satuan yang sama dari beberapa jalur dijumlahkan.
- `replace_item_group_components(uuid, jsonb)` (tanda tangan & ACL sama) sekarang: kunci advisory → ganti susunan →
  tolak lingkaran (`GRUP_LINGKARAN`) → hitung ulang Grup itu dan semua Grup yang memuatnya, termasuk yang tidak
  langsung. Kedalaman maksimum 5 tingkat (`GRUP_TERLALU_DALAM`). Resep terbuka hanya ditulis bila hasilnya berubah,
  jadi menyimpan barang biasa tidak menambah jejak audit.
- Semua pembaca hilir (katalog kasir, checkout & snapshot, struk, retur, HPP, klinik/H05 beserta guard
  database-nya) membaca `item_group_components`, sehingga **tidak diubah**. Penjualan lama memakai snapshot dan
  tidak terpengaruh perubahan resep.
- Data lama disalin 1:1 ke `item_group_recipe` saat migrasi; resep terbuka yang sudah ada tidak ditulis ulang.
- Reset simulasi ikut membersihkan `item_group_recipe`; tabel baru terdaftar di log aktivitas ("Susunan Grup Barang").

## Pesan ke admin

| Kode | Arti |
| --- | --- |
| `GRUP_LINGKARAN` | Paket A berisi B, B (langsung/tidak) berisi A |
| `GRUP_TERLALU_DALAM` | Lebih dari 5 tingkat |
| `GRUP_NONAKTIF` | Paket luar yang ikut dihitung ulang masih memuat barang nonaktif |
| `GRUP_QTY` / `GRUP_SATUAN` | Qty hasil gabungan di luar presisi 4 desimal / faktor satuan tidak konsisten |

Kode dibuang oleh `pesanSimpanGagal`, admin hanya melihat kalimatnya.

## Batasan yang diketahui

- Struk, kasir, dan klinik menampilkan isi paket yang sudah dibuka (barang-barangnya), bukan nama paket dalam.
- Menonaktifkan paket dalam tidak menghapusnya dari paket luar. Paket luar tetap memakai isi terakhirnya.
- Bila paket luar memuat barang yang sudah nonaktif, perubahan paket dalam ditolak sampai paket luar dibereskan.

## Uji

- `python3 scripts/test-grup-bertingkat-postgres.py` — PostgreSQL 16 sementara: salin data lama, simpan ulang tanpa
  tulis, 3 tingkat, perubahan otomatis ke atas, lingkaran langsung/tidak langsung, batas kedalaman, non-admin,
  barang nonaktif, reset simulasi.
- Unit: `grup-barang`, `impor-accurate-lanjutan`, `group-component-catalog`, `activity-log`.
