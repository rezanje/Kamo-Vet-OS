# Paket owner: simpan pengaturan satu baris (aturan gaji, loyalitas, pajak)

Satu-satunya perubahan database: izin **membuat** baris Pengaturan Loyalitas (`tier_settings`)
untuk OWNER/ADMIN, sama dengan izin mengubah yang sudah ada. Tidak ada data yang disisipkan.
Aturan gaji **tidak** butuh langkah database: izin OWNER yang ada sudah cukup untuk membuat barisnya.

Urutan (SQL editor Supabase, produksi):

1. `preflight.sql` (hanya baca). Harapan 28 Okt: aturan gaji 0 baris, loyalitas 0 baris,
   policy loyalitas hanya `tier_settings_read:SELECT, tier_settings_write:UPDATE`, migrasi belum tercatat.
2. `apply.sql`. Aman diulang.
3. `readback.sql` (hanya baca). Harapan: ada `tier_settings_insert | INSERT`, migrasi tercatat,
   jumlah baris data sama dengan preflight.
4. Rollback hanya kalau diputuskan mundur: `rollback.sql`.

Setelah kode rilis: OWNER buka Pengaturan → Aturan gaji, isi angka, tekan **Simpan aturan** (isi 0
kalau memang tidak ada potongan/lembur). Sampai itu dilakukan, tombol Hitung penggajian ditolak
dengan pesan yang menjelaskan caranya.

Gladi bersih di PostgreSQL 16 lokal (semua migrasi repo kecuali yang ini → preflight → apply 2x →
readback → tes DB → rollback → readback): lulus, lihat `rehearsal-pg16.log`.
