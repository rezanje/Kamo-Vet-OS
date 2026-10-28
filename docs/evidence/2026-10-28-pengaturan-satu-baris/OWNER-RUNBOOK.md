# Paket owner: pengaturan satu baris (aturan gaji, loyalitas, pajak)

Dua perubahan izin database. Tidak ada data yang disisipkan atau diubah:

1. **Loyalitas** (`tier_settings`): OWNER/ADMIN boleh **membuat** baris, sama dengan izin
   mengubah yang sudah ada. Baris ini sekarang belum ada di produksi.
2. **Pajak/perusahaan** (`company_settings`): menulis (Mode PKP, PPN, identitas, jam kerja
   standar) **khusus OWNER aktif**. Sebelumnya akun login mana pun bisa mengubahnya lewat API.
   Membaca tetap boleh untuk semua akun login (kasir, klinik, faktur, laporan butuh).

Aturan gaji **tidak** butuh langkah database: izin OWNER yang ada sudah cukup untuk membuat barisnya.

Urutan (SQL editor Supabase, produksi):

1. `preflight.sql` (hanya baca). Hasil 28 Okt ada di `production-preflight-2026-10-28.txt`.
   Pastikan "active OWNER accounts" ≥ 1, karena setelah apply hanya OWNER yang bisa mengubah pajak.
2. `apply.sql`. Aman diulang.
3. `readback.sql` (hanya baca). Harapan: `tier_settings_insert | INSERT`,
   `csettings_owner_write | ALL` + `csettings_select | SELECT`, `csettings_all` hilang,
   kedua migrasi tercatat, jumlah baris sama dengan preflight.
4. Rollback hanya kalau diputuskan mundur: `rollback.sql` (membuka lagi celah tulis pajak).

Setelah kode rilis:
- OWNER buka **Pengaturan → Aturan gaji**, ketik semua angka (0 boleh), lalu Simpan. Sampai itu
  dilakukan, Hitung penggajian ditolak dengan pesan yang menjelaskan caranya.
- OWNER/ADMIN buka **Pengaturan → Tier**, ketik semua angka, lalu Simpan, supaya aturan loyalitas
  resmi tersimpan (sekarang sistem memakai angka bawaan).

Gladi bersih di PostgreSQL 16 lokal (semua migrasi repo kecuali dua ini → preflight → apply 2x →
readback → tes DB → rollback → readback → tes DB gagal sesuai harapan), plus uji merah khusus
pajak: lulus, lihat `rehearsal-pg16.log`.
