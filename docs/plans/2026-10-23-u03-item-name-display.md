# U03 — nama dan kode terpisah pada selector

Nama menjadi label utama dan kode ditampilkan terpisah; pencarian kode/nama serta ID tetap dipakai. Terapkan di shared SearchableItemPicker dan selector permintaan klinik, billing klinik serta katalog racikan. Jangan mengubah nama master, deskripsi transaksi historis, harga/qty/satuan atau hak akses. Nama sama tetap dapat dipilih melalui ID/kode yang jelas; ketikan nama ambigu tidak boleh memasangkan SKU sembarang.

Picker tetap terbaca dalam tabel scroll dan mobile, mendukung keyboard, katalog lebih dari50 hasil serta pilihan/draf yang dipulihkan. Popup terikat posisi input agar tidak terpotong overflow tabel. Teks bebas billing existing tetap didukung; provenance resep/racikan mengikuti alur existing.

RED tampilan nama/default dan pagination lalu GREEN; tes klinik dan shared consumers, review independen, browser fixture desktop/mobile, lint/build/typecheck dan suite proyek. Tidak ada migration/target write; candidate diteruskan lane rilis. Template C03 belum ditemukan; K06 dan definisi durasi K07 tetap tidak diubah.
