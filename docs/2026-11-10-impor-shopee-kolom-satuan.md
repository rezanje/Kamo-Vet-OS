# 2026-11-10 — Impor Shopee: kolom Satuan di kiri Qty

## Laporan
Grup klinik (ke Reza): file ekspor Shopee tidak membawa satuan, padahal sistem wajib tahu satuan. Contoh pesanan
`261110UMED18MR` — "Beauty premium cat food All stage 1kg" (kode DRC8997210900539). Di master, satuan Beauty
Premium masih 1/2kg (harga Rp 15.000), sedangkan Shopee menjual 1kg (Rp 32.502). Akibatnya pratinjau memberi
peringatan "+117% dari harga master" dan — lebih penting — stok yang terpotong hanya 1 × 1/2kg untuk 1 kg yang
benar-benar keluar. Permintaan: tambah pilihan satuan di samping kiri Qty (1kg atau 1/2kg).

## Penyebab
- `simpanImporShopee` selalu mengirim `satuan: ""` ke RPC `post_online_order` → `unit_posting_factor` memakai
  satuan dasar (faktor 1).
- Pratinjau tidak memuat `item_units`, jadi tidak ada pilihan satuan dan harga pembanding selalu harga dasar.

## Perbaikan (tanpa migrasi — RPC sudah menerima `satuan` sejak `20261007110000`)
1. `pratinjauImporShopee` memuat `items.unit` + semua `item_units` (`loadItemUnits`) dan menyusun daftar satuan per
   barang lewat `unitOptions` (dasar dulu, lalu turunan dari kecil ke besar). Yang dikirim ke browser hanya
   `unit`, `factor`, `sell_price` — harga beli tidak.
2. `shopee-import-match.ts`
   - `tebakSatuan`: menebak satuan dari Nama Variasi lalu Nama Produk Shopee. Hanya satuan yang memuat angka
     (ukuran: `1kg`, `1/2kg`, `500gr`), harus tertulis utuh (`1/2kg` ≠ `1kg`/`2kg`, `21kg` ≠ `1kg`), dan hanya bila
     tepat satu satuan cocok; selain itu satuan dasar. Teks dirapikan: huruf kecil, `½` = `1/2`, `1 kg` = `1kg`.
   - `analisisImpor` menerima `satuan` (pilihan manual per baris, diabaikan bila tidak ada di barang terpilih).
     Prioritas: pilihan pengguna → tebakan → satuan dasar. Info ditampilkan bila satuan hasil tebakan, atau bila
     barang bersatuan ganda tetapi ukurannya tidak terbaca.
   - Peringatan harga membandingkan harga Shopee dengan harga jual **satuan terpilih**.
   - Cek stok kumulatif memakai satuan dasar: `qty × faktor`.
3. `ShopeeImportWorkspace`: kolom **Satuan** di antara "Barang master" dan "Qty". Dropdown bila barang punya lebih
   dari satu satuan, teks biasa bila hanya satu. Bila faktor ≠ 1 tampil "stok keluar N <satuan dasar>". Ganti
   barang = pilihan satuan baris itu direset. Pilihan dikirim sebagai `satuan[]` sejajar `items[]`.
4. `simpanImporShopee`: `satuan[i]` (dipangkas, maks 40 karakter, jumlah ≤ jumlah barang) diteruskan ke RPC.
   Faktor isi tetap ditentukan database (`unit_posting_factor`), bukan klien; satuan yang tidak terdaftar ditolak
   database dan diterjemahkan jadi "Satuan yang dipilih sudah tidak ada di master barang…". Kiriman lama tanpa
   `satuan` tetap = satuan dasar.

## Syarat data
Pilihan 1kg hanya muncul bila master barang memang punya satuan 1kg (Master SKU → satuan berjenjang, mis. 1kg isi 2
× 1/2kg). Bila Beauty Premium baru punya 1/2kg saja, satuan 1kg perlu ditambahkan dulu di master.

## Tes
- `src/lib/__tests__/shopee-import-match.test.ts` — tebakan satuan, kasus Beauty Premium, pilihan manual,
  stok kumulatif dalam satuan dasar, info satuan ganda.
- `src/lib/__tests__/shopee-import-actions.test.ts` — katalog membawa satuan tanpa harga beli; satuan diteruskan
  ke RPC; satuan tidak valid ditolak tanpa RPC; pesan "Satuan tidak terdaftar".
- `src/components/__tests__/shopee-import-workspace.test.tsx` — kolom Satuan di kiri Qty, ganti 1/2kg → 1kg
  mengubah stok keluar & pembanding harga, satuan ikut dikirim saat simpan.
- Lokal: seluruh vitest 8224 lulus, `tsc --noEmit` bersih, eslint bersih, `next build` sukses.

## Belum diuji
- Belum dicoba di Production dengan file Shopee asli dan master Beauty Premium yang sebenarnya.
