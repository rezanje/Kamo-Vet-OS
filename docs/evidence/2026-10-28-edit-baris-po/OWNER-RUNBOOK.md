# Paket owner: Edit per baris PO (pop-up)

Perubahan fungsi database saja. Tidak ada data yang disisipkan atau diubah saat apply.

- Fungsi baru: pratinjau + simpan **edit baris PO** (khusus Super Admin/OWNER).
- Mesin koreksi faktur (P02) mendapat satu tombol privat agar qty faktur dari PO boleh turun
  **hanya** lewat edit baris PO. Koreksi faktur biasa tetap menolaknya seperti sebelumnya.

Urutan (SQL editor Supabase, produksi). **Jalankan sebelum kode dirilis/merge**:

1. `preflight.sql` (hanya baca). Pastikan:
   - prasyarat tercatat: `20261020134110, 20261023200000, 20261028160000, 20261029110000`;
   - `migrasi 20261029150000 tercatat` = `-` dan `fungsi edit baris PO sudah ada` = `false`;
   - `md5 isi mesin koreksi faktur` = **`02610c3a87d6901abe5122c8e827229e`** (sama dengan repo).
     Kalau beda: **berhenti**, kabari developer (fungsi produksi tidak sama dengan repo).
2. `apply.sql`. Aman diulang.
3. `readback.sql` (hanya baca). Harapan semua baris `true`, migrasi tercatat `20261029150000`,
   jumlah koreksi faktur & permintaan PO sama dengan preflight.
4. Rollback hanya kalau diputuskan mundur: `rollback.sql`. Mesin koreksi faktur kembali persis
   ke versi lama (md5 sama), fungsi edit baris PO hilang, riwayat yang sudah tersimpan tetap ada.

Kalau kode terlanjur rilis sebelum apply: tombol Edit di tabel barang PO tetap muncul, tapi
"Lihat dampak" menampilkan pesan gagal. Tidak ada data yang berubah.

Gladi bersih di PostgreSQL 16 lokal (semua migrasi repo kecuali yang baru → preflight → apply 2x →
readback → tes edit baris PO + tes koreksi faktur, FIFO dan rata-rata → rollback → preflight sama
lagi → tes koreksi faktur lulus, tes edit baris PO gagal sesuai harapan): lihat `rehearsal-pg16.log`.
