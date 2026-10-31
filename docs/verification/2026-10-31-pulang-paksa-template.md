# Template form Pulang Paksa — 2026-10-31

## Masalah
Status rawat inap "Pulang Paksa" hanya bisa disimpan bila ada form kategori **Pulang Paksa**
yang sudah ditandatangani setelah pasien masuk (`20261025180000_inpatient_forced_discharge.sql`).
Belum pernah ada template kategori itu, jadi pilihan template di rekam medis tidak memuat form
Pulang Paksa dan staf tidak bisa membuatnya.

## Perubahan
- `supabase/migrations/20261104360000_pulang_paksa_default_template.sql` — menambah satu template
  "Surat Pernyataan Pulang Paksa" (semua cabang, aktif) **hanya bila** belum ada template
  Pulang Paksa yang aktif. (Production punya satu template Pulang Paksa demo yang nonaktif dari
  simulasi 12 Okt; tanpa syarat "aktif" migrasi tidak akan menambah apa pun di Production.) Tidak mengubah template, dokumen, atau aturan lain. Bisa diedit /
  dinonaktifkan OWNER/ADMIN di Klinik → Form persetujuan.
- Halaman detail rawat inap: bila template Pulang Paksa aktif untuk cabang pasien tidak ada,
  tampil penjelasan (OWNER/ADMIN mendapat tombol ke Form persetujuan). Bila ada, tombol
  "Buka Form" langsung ke bagian form persetujuan di rekam medis. Gagal baca template tidak
  memunculkan peringatan palsu.
- Daftar template di Form persetujuan menampilkan label jenis (mis. Pulang Paksa).

## Bukti
- PostgreSQL 16 lokal, semua 344 migrasi repo (sesudah digabung dengan main 8375f3f): template terpasang 1×, jalankan ulang tetap 1×,
  placeholder valid; `supabase/tests/inpatient_consent.sql` lulus; skenario staf membuat form
  dari template bawaan → tanda tangan → status Pulang Paksa tersimpan: lulus.
- `npm run lint` (0 error), `npm test` (696 file / 5708 tes lulus), `tsc --noEmit`, `npm run build`: lulus.

## Belum diuji
- Belum dicoba di Production; perlu migrasi diterapkan lalu uji langsung oleh staf klinik.
