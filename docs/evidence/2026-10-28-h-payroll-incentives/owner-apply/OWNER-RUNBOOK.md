# H02–H06 — langkah database owner (sebelum merge PR)

Isi: 5 migrasi (`20261028170000`, `170500`, `171000`, `173000`, `174000`). Tidak ada tarif, template, atau kelompok yang diisi otomatis.

1. **Preflight (baca saja)** — jalankan `preflight.sql` di SQL editor Supabase. Baris `SUMMARY` harus `true` / `0 failed`.
   Kalau ada yang `false`, berhenti dan kirim hasilnya ke developer.
2. **Apply** — jalankan `apply.sql` sekali (satu transaksi; gagal = tidak ada yang berubah; aman diulang).
3. **Readback (baca saja)** — jalankan `readback.sql`. Semua baris `true`.
4. Baru setelah itu PR boleh di-merge (aplikasi membaca kolom/tabel baru; tanpa langkah 2, layar Komisi dan Penggajian gagal dimuat).
5. **Rollback** (`rollback.sql`) hanya kalau owner memutuskan membatalkan, dan setelah deploy aplikasi dikembalikan. Rollback menghapus
   konfigurasi yang sudah diisi setelah apply (kelompok, tarif visit, tanda paket di invoice, template slip + riwayatnya).
   Rollback MENOLAK berjalan selama data itu ada; owner harus ekspor dulu lalu menjalankan
   `set kamo.h_rollback_discard_data = 'yes';` di sesi yang sama sebelum `rollback.sql`.

Bukti latihan (cluster lokal sekali pakai, bukan produksi): `rehearsal-pg16.log`, `rehearsal-pg17.log` —
preflight → apply → readback → apply ulang → rollback ditolak saat ada data → rollback dengan tanda owner → apply lagi, semuanya lulus.

Setelah apply, yang perlu diisi bisnis sendiri (tidak ada nilai contoh):
- Penjualan › Komisi: kode kelompok per karyawan, aturan per kelompok, pengecualian individu, aturan "Visit dokter rawat inap" (nominal per visit).
- HRIS › Komponen Gaji: template slip per kelompok + isinya; komponen omzet (persen) bila dipakai.
- Profil karyawan: pilih template; pengecualian per karyawan wajib beralasan.
- Barang Grup (paket) yang dipakai klinik harus berisi SKU komponennya, supaya kasir klinik bisa menandai baris sebagai "Asal paket".
