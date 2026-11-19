# Transfer Kas dua cabang + koreksi ala Accurate (19 Nov 2026)

Permintaan Mba Anisa (finance) via Reza, WA 19 Nov 2026:

1. "Pada menu transfer kas harus ada dua cabang, dari kas sumber dan kas tertujunya" (+ "menu transfer kas blm 2 cabang ya mas").
2. Video 2 menit: koreksi transfer di KAMO terasa panjang (harus batal dulu, tidak bisa ganti cabang). Minta dipersingkat
   seperti Accurate: buka transfer, ubah cabang/tanggal/rekening/nilai langsung, simpan. (Di video juga disinggung revisi
   pembayaran penjualan ala Accurate — **belum** dikerjakan di sini, lihat "Sisa".)
3. Saldo awal kas hasil impor masih di "umum/Pusat", jadi saldo per cabang selisih setelah transfer — lihat "Sisa".
4. Dua koreksi data faktur — lihat "Koreksi data".

## Yang berubah

### Database — `supabase/migrations/20261202100000_transfer_kas_dua_cabang.sql`

- `cash_transfers.to_branch_id` (cabang tujuan) dan `cash_transfers.to_journal_entry_id` (jurnal sisi tujuan).
  `branch_id` sekarang berarti cabang asal. Baris lama diisi `to_branch_id = branch_id` (angka lama tidak berubah).
- Akun baru **182010 Rekening Antar Cabang** (ASET, di bawah 182000 Piutang Diluar Usaha). Saldonya per cabang menunjukkan
  uang yang pindah antar cabang; total semua cabang selalu 0.
- `mutate_cash_transfer`:
  - cabang asal = tujuan → satu jurnal seperti sebelumnya;
  - cabang asal ≠ tujuan → dua jurnal: asal (`transfer`, cabang asal) D 182010 / D biaya admin / K rekening asal;
    tujuan (`transfer-tujuan`, cabang tujuan) D rekening tujuan / K 182010. Masing-masing seimbang di cabangnya;
  - koreksi boleh ganti cabang asal/tujuan (dulu ditolak). Jurnal lama dibalik di cabang & tanggal aslinya
    (dua pembalik bila dulu dua jurnal), pengganti di cabang & tanggal baru;
  - form lama yang belum mengirim `to_branch_id` tetap jalan (tujuan = asal);
  - pengguna harus bisa mengakses kedua cabang. Dengan cabang operasional terpilih (bukan "Semua Cabang"), transfer ke
    cabang lain ditolak — pesan di layar menyuruh pilih "Semua Cabang".
- `internal_transfer_scope` ikut memeriksa cabang tujuan; `guard_internal_transfer_journal` melindungi source `transfer-tujuan`.

### Layar — `/kas-bank/transfer`

- Form: Tanggal; **Dari rekening + Cabang asal**; **Ke rekening + Cabang tujuan**; Jumlah, Biaya admin, Keterangan.
  Memilih rekening yang terikat cabang (mis. Kas Toko CMS) langsung mengisi cabangnya. Selama cabang tujuan belum dipilih
  sendiri, ia mengikuti cabang asal (kebiasaan lama). Bila berbeda muncul catatan "Antar cabang".
- "Koreksi" → **"Ubah"**: isian yang sama (tanggal, rekening, kedua cabang, nilai) langsung bisa diubah + alasan,
  tombol "Simpan perubahan". Penjelasan jurnal pembalik yang panjang diganti satu kalimat.
- Kolom Cabang di daftar: "Asal → Tujuan" untuk transfer antar cabang.
- Buku rekening (`/kas-bank/rekening/[id]`): label source `transfer-tujuan` = "Transfer masuk antar cabang".

## Tes

- `scripts/test-transfer-kas-dua-cabang-postgres.py` — 457 migrasi dari nol (PostgreSQL lokal sekali pakai, data fiktif),
  lalu `supabase/tests/internal_transfer_corrections.sql` (regresi satu cabang) + `supabase/tests/transfer_kas_dua_cabang.sql`:
  dua jurnal per cabang, saldo per cabang, 182010 nol konsolidasi, idempoten, koreksi dua→satu cabang (dua pembalik),
  satu→dua cabang + ganti cabang asal & tanggal, klien lama, batal (semua akun nol per cabang), Pusat→cabang,
  cabang operasional menolak, tulis langsung ke jurnal ditolak, 182010 nonaktif menolak. GREEN lulus; `--baseline` gagal.
- `scripts/test-edit-kas-transfer-admin-finance-postgres.py` lulus (cek teks "cabang tetap" diganti cek akses cabang; cek
  pasang-ulang migrasi 12 Nov dilepas karena fungsinya sekarang ditulis ulang utuh).
- Vitest: `bank-transfer-form`, `bank-transfer-page`, `bank-transfer-actions` (+ kasus baru dua cabang).

## Koreksi data (belum dijalankan)

Percobaan menjalankan koreksi lewat fungsi resmi sebagai akun Owner dari sesi agen ditolak pengaman otomatis sesi
(tulis ke Production atas nama pengguna). Tidak ada yang berubah. Jalurnya:

- **FB.2026.10.00072** (saldo awal hutang, Pak Kris, belum dibayar): 1.280.000 → **1.320.000**.
  Owner: Keuangan → Saldo Awal → Saldo Awal Hutang & Piutang per Faktur → 03 Koreksi (`/keuangan/saldo-awal-faktur#koreksi`).
  Jurnal koreksi otomatis: D 410001 / K 311001 40.000.
- **FB.2026.11.00057** (Mitra Plas, belum dibayar), baris *Kalung Yabeibi Lonceng Besar* 30 PCS @ 13.334 → minta **60 PCS @ 6.666**.
  - Koreksi resmi hanya boleh **menurunkan** qty ("Tambahan barang dicatat sebagai pembelian baru").
  - Ke-30 pcs dari faktur ini sudah dikirim semua dari DC LOJI (PRM-20261116-0009, -0007, 20261117-0004, -0012, -0009),
    stok DC LOJI barang ini 0.
  - Jalur resmi: (1) Koreksi harga baris → 6.666 (qty 30). Pratinjau (tanpa simpan): hutang −200.040, HPP −200.040
    (barang sudah keluar gudang), total faktur 11.520.000 → 11.319.960. (2) Faktur pembelian langsung baru: Mitra Plas,
    DC LOJI, 16 Nov 2026, no. faktur pemasok "2", Kalung Yabeibi Lonceng Besar 30 PCS @ 6.666 = 199.980.
    Total hutang ke Mitra Plas untuk nota ini jadi 11.519.940 (beda Rp60 dari semula karena 60 × 6.666 = 399.960 vs 30 × 13.334 = 400.020).

## Sisa

- Migrasi belum diterapkan ke Production; layar baru aktif setelah PR di-merge + Vercel deploy + migrasi diterapkan.
  Urutan aman: migrasi dulu (form lama tetap jalan dengan migrasi baru), lalu merge.
- **Saldo awal kas per cabang** (permintaan 1 Anisa): rekening bercabang (Kas Toko */Kas Toko Vet *) sudah dipindah ke
  cabangnya sejak 31 Okt (JRN-202610-0025 s/d -0054). Yang masih di Pusat: Kas Blu BCA (527.246), Kas Kecil Gudang
  (Bu Fitri) (2.080.130), Bank BCA Toko (1.064.355), Bank BCA Transaksi (132.135.191), Bank BCA Gudang (372.267),
  Bank BCA Margin (85.928.385), Bank BCA Tabungan (842.536). Perlu jawaban Anisa: masing-masing masuk cabang mana
  (boleh dibagi). Setelah itu dipindah dengan pola yang sama (pasangan jurnal keluar Pusat / masuk cabang).
- Revisi pembayaran penjualan langsung ala Accurate (bagian akhir video) — belum.
