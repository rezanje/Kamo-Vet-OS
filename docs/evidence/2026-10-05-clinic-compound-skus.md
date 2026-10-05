# Obat racik master pada POS pemeriksaan

Keluhan trial: obat racik yang sudah ada di Barang & Jasa tidak muncul pada tab Racikan pemeriksaan. Pengecekan baca produksi pada 5 Oktober 2026 menemukan 3.422 SKU aktif dan 41 SKU Persediaan aktif/non-bahan bernama Obat Racik: 39 pada kategori `OBAT RACIK`, dua pada kategori `OBAT FLU, DEMAM & PENCERNAAN`. Ada nol resep resmi aktif. Tab lama hanya menampilkan katalog resep resmi serta builder manual; kueri master pemeriksaan/rawat inap juga berhenti pada 400/200 barang pertama.

Perbaikan membaca kategori `OBAT RACIK`, `OBAT RACIKAN`, atau `RACIKAN` (normalisasi huruf/spasi), serta nama awalan lama `Obat Racik ` / `Obat Racikan `; hanya SKU Persediaan aktif yang bukan bahan. Daftar khusus tampil di tab Racikan pemeriksaan dan catatan rawat inap, dengan pencarian nama/kode, 50 baris per halaman, stok, harga, dan tombol tambah. SKU memakai identitas barang, satuan, dan alur resep obat yang sudah ada. Tidak ada bahan/resep resmi yang dikarang dari nama SKU. Katalog resep resmi dan hak builder manual tetap berlaku; tidak ada migrasi atau perubahan master produksi.

SKU kategori tersebut dibaca lengkap dalam batas 10.000 baris dengan pemeriksaan jumlah, panjang halaman, dan ID unik. Metadata stok, satuan, dan harga cabang dibaca lengkap dalam batch 200 ID agar tidak terkena batas respons 1.000 maupun URL besar. Gudang mengikuti aturan posting klinik: cabang kunjungan, aktif, tipe VET, urutan created_at/id. Kegagalan sumber metadata melempar pesan aman; tidak ditampilkan sebagai stok nol/harga pusat karena query gagal.

## Bukti regresi dan browser lokal

- Tes page asli sebelum perbaikan gagal karena tidak ada `racikanItems` untuk SKU setelah baris 550. Tes berikutnya membuktikan metadata baris ke-1.010 sebelumnya berubah menjadi stok nol, harga pusat, dan kehilangan satuan box; fixture RETAIL sebelum VET juga menunjukkan pilihan gudang yang salah. Semua diperbaiki.
- `src/lib/__tests__/clinic-compound-sku-pages.test.tsx` memeriksa kedua page, pengecualian barang nonaktif/bahan/jasa, harga cabang dan gudang yang benar, 1.010 SKU tambahan, serta kegagalan kategori/SKU/gudang/stok/satuan/harga.
- `scripts/test-clinic-compound-skus-local.mjs` memakai GoTrue/PostgREST/PostgreSQL dan Chromium nyata pada localhost. Guard menolak target non-loopback; hanya database fiktif lokal yang disemai.
- Browser lokal lulus untuk pemeriksaan dan rawat inap dengan 55 SKU (dua dengan nama lama di kategori lain): 50 lalu 5 baris; cari kode SKU 55 yang berada melewati batas master lama; tambah dua kali menghasilkan satu baris dengan qty 2 dan item_id yang sama; harga pcs cabang Rp25.000; pilih box menghasilkan faktor 10 dan harga cabang Rp98.000. Tidak muncul error browser. Tidak ada submit transaksi bisnis.
- Review independen menemukan dua isu metadata/gudang di versi awal perubahan dan memeriksa perbaikannya; tidak ada temuan Critical/Important yang tersisa pada diff akhir.
- Verifikasi akhir: `npm test` lulus 142 berkas/1.318 tes; TypeScript tanpa error; ESLint berkas yang berubah tanpa error (dua warning `<img>` lama di CatatanForm); syntax skrip dan `git diff --check` lulus; `npm run build` selesai dengan sukses. Warning build yang sudah ada untuk gambar dan Supabase pada Edge tidak diubah oleh perbaikan ini.

Daftar Obat umum masih memakai batas lama 400/200; perubahan ini khusus memperbaiki daftar obat racik. Pembacaan beberapa query bukan snapshot transaksi. Ketersediaan stok master nyata tetap menentukan apakah resep dapat diposting; perbaikan tidak membuat stok atau formula otomatis.
