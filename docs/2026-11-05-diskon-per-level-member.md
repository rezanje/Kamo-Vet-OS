# Diskon per level member — golongan ikut level (5 Nov 2026)

**Asal permintaan:** janji Reza di grup Kamo Group – ERP Dev, 5 Nov 2026 pukul 12.28:

> "Tiap level (Bronze, Silver, dst) bisa dikasih diskon sendiri: diskon buat SKU tertentu atau
> kategori produk tertentu. Diskonnya otomatis ngikut pas pelanggan naik level."

## Kondisi sebelumnya

- Diskon per SKU dan per kategori produk sudah ada di tingkat **golongan**
  (`customer_categories` + `category_discounts`, migrasi 0082).
- Kasir petshop, POS back office, dan klinik membaca diskon ini dari `customers.category_id` di server.
- Masalahnya: golongan dipasang manual, sedangkan level (`customers.tier`) dihitung otomatis dari
  total belanja. Keduanya tidak terhubung.

## Perubahan (migrasi `20261107040000_golongan_ikut_level.sql`)

### Kolom baru di `customer_categories`

- **`tier_otomatis`** — level (New, Bronze, Silver, Gold, atau Platinum) yang memakai golongan ini.
  Satu level hanya boleh punya satu golongan (dijaga indeks unik).
- **`khusus`** — golongan manual seperti Reseller, B2B, atau Rescuer. Golongan khusus tidak pernah
  ditimpa level.
  - Untuk data yang sudah ada: semua golongan lama ditandai khusus, kecuali 'Umum'.
  - Golongan yang dipakai untuk level tidak boleh khusus (ada constraint).

### Trigger `customers_golongan_ikut_level`

Berjalan saat `insert` dan saat `update of tier`, jadi menangkap semua jalur perubahan level:
`refresh_customer_spending`, order online, pembatalan, retur, dan turun level otomatis di `loyalty-server`.

Aturannya:

1. Kalau pelanggan sedang memakai golongan khusus → golongan dibiarkan.
2. Kalau level baru punya golongan aktif → pelanggan dipindah ke golongan itu.
3. Kalau level baru tidak punya golongan, dan golongan lama adalah golongan level → golongan dikosongkan.
4. Kalau golongan dan level diganti pada perintah yang sama → pilihan admin yang dipakai.

### RPC `terapkan_golongan_level()`

- Hanya bisa dipanggil OWNER/ADMIN aktif.
- Memindahkan pelanggan yang sudah ada ke golongan levelnya.
- Dipanggil otomatis setelah admin menyimpan golongan atau mengaktifkan/menonaktifkannya.
- Aman dijalankan berulang; kalau tidak ada yang perlu dipindah, hasilnya 0.

### Yang tidak berubah

Rumus harga, diskon, poin, dan jurnal tetap sama. Uji pembanding promo tidak terpengaruh.

## Layar

Halaman **CRM › Kategori Pelanggan** sekarang punya:

- Pilihan **"Otomatis untuk level"**. Level yang sudah dipakai golongan lain tidak bisa dipilih.
- Centang **"Golongan khusus"**.
- Kolom **Level otomatis** di tabel.
- Pesan "N pelanggan dipindah ke golongan levelnya" setelah menyimpan.

Kalau migrasi belum terpasang, halaman tetap terbuka tanpa pilihan level.

Diskon per SKU/kategori untuk tiap level diatur dari tombol "Diskon per barang" yang sudah ada.

## Cara pakai (untuk admin)

1. Buat golongan, misalnya "Gold", lalu pilih *Otomatis untuk level: Gold*. Isi diskon umum dan
   rumus poinnya.
2. Klik **Diskon per barang** untuk menambah diskon per SKU atau per kategori produk.
3. Ulangi untuk Bronze, Silver, dan Platinum sesuai kebutuhan.
4. Pelanggan Gold yang sudah ada langsung dipindah. Pelanggan yang naik ke Gold nanti akan ikut
   pindah otomatis.

## Uji

- **`python3 -I scripts/test-golongan-ikut-level-postgres.py`** — memakai PostgreSQL 16 lokal sekali
  pakai, 377 migrasi, dan data fiktif.
  - RED: tanpa kandidat, golongan tidak ikut level.
  - Kandidat dijalankan ulang: skema tidak berubah.
  - GREEN `supabase/tests/golongan_ikut_level.sql`, 17 kasus:
    - naik level, turun level, level tanpa golongan;
    - golongan khusus aman;
    - pilihan admin yang diganti bersamaan tetap dipakai;
    - pelanggan baru langsung dapat golongan levelnya;
    - golongan nonaktif tidak dipasang;
    - unik per level, validasi nama level, golongan level tidak boleh khusus;
    - staf ditolak saat menerapkan; owner berhasil menerapkan; penerapan ulang hasilnya 0.
- **Vitest** `golongan-ikut-level.test.tsx`: 9 kasus untuk aksi dan halaman. Suite penuh: 821 file lulus.
- **`tsc --noEmit`, `eslint`, `next build`**: lulus.

## Belum

- Migrasi belum dipasang di Production.
- Golongan per level belum dibuat di data asli (itu tugas admin, bukan migrasi).
- Belum ada UAT.
- Turun level karena tidak aktif tetap mengikuti saklar di Konfigurasi loyalty.
