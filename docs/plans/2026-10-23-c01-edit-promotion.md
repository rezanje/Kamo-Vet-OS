# C01 — edit konfigurasi promo tersimpan

- Gunakan aturan diskon/jumlah/periode dan target barang/cabang yang sudah ada. Tambahkan tautan Edit untuk OWNER/ADMIN dan formulir berisi nilai tersimpan; target lama yang nonaktif tetap dipertahankan secara eksplisit.
- Satu RPC menyimpan header dan perubahan target atomik, memeriksa profil aktif OWNER/ADMIN dari sesi, validasi database, dan token versi dari snapshot header+target. Perubahan bersamaan ditolak, bukan ditimpa. Guard juga menutup mutasi langsung oleh bukan pengelola tanpa memperluas pembaca.
- Gunakan A01 untuk siapa/kapan/kolom yang berubah dan before/after angka/flag yang aman. Jangan menyalin teks saran atau payload rule bebas. Tautkan riwayat dari editor. Tidak membuat histori lampau dan tidak menghitung ulang sale/invoice/receipt lama.
- RED: SQL membuktikan RPC editor belum ada. GREEN: fixture SQL lokal untuk atomicity, batas akses, konflik, target nonaktif, sanitasi dan transaksi lama; tes action/form untuk kegagalan dan pilihan tersimpan. Lalu review independen, test aplikasi, lint file terkait, build dan typecheck. Publish draft PR, integrasi melalui release lane.
