# Follow up dari poli pemeriksaan — 5 Nov 2026

Pelapor: Babibu (grup klinik, 14.14). Dia belum menemukan cara membuat follow up dari poli
pemeriksaan yang otomatis masuk daftar Follow up. Di 14.26 dia sudah menemukan kartu
"Rencana Follow Up" di bagian bawah form pemeriksaan.

## Temuan
Fiturnya sudah ada (form pemeriksaan → kartu Rencana Follow Up → Klinik › Follow up), tapi ada tiga celah:
1. Tanggal yang sudah diisi tapi tombol **Tambah** belum diklik **hilang diam-diam** saat rekam
   medis disimpan. Dokter mengira follow up sudah dibuat padahal tidak masuk daftar.
2. Setelah rekam medis tersimpan (menunggu bayar / selesai), **follow up tidak bisa ditambah lagi**
   dan juga tidak terlihat di halaman detail. Babibu sampai mendaftarkan ulang pasien.
3. Tanggal harus diketik/dipilih manual; untuk vaksin ulang dan kontrol rutin ini lambat.

## Perubahan
- `src/components/FollowUpTable.tsx`: isian bertanggal yang belum di-"Tambah" ikut dikirim
  (`barisFollowUpTerkirim`), ada konfirmasi hijau "ikut tersimpan", tombol diganti "Tambah lagi".
- `src/components/FollowUpIsian.tsx` (baru): isian jenis/tanggal/catatan + tombol cepat
  +1 minggu, +2 minggu, +1 bulan, +3 bulan, +1 tahun. Grid responsif untuk tablet.
- `src/app/(app)/klinik/rekam-medis/[visitId]/FollowUpPanel.tsx` (baru): kartu Follow up di
  halaman detail rekam medis — daftar follow up kunjungan itu + "Tambah follow up".
- `actions.ts`: `tambahFollowUpKunjungan` — insert `follow_ups` (RLS cabang tetap berlaku),
  tolak kunjungan diarsipkan & tanggal sebelum hari ini. Tidak menyentuh tagihan/stok/rekam medis.
  Validasi baris dipindah ke `bersihkanFollowUp` (`src/lib/followup.ts`), dipakai kedua jalur.
- `page.tsx`: baca `follow_ups` per kunjungan di gelombang baca pertama (tidak menambah putaran).
- Tidak ada migrasi database.

## Uji
- `src/lib/__tests__/followup-poli.test.ts` (baru) — isian belum di-Tambah, validasi, tombol tanggal.
- Seluruh vitest: 816 file lulus (2 di-skip), 7281 tes lulus.
- `tsc --noEmit` bersih, eslint tanpa error, `next build` sukses (env Supabase dummy).

## Belum diuji
- Belum dicoba di Production / oleh dokter langsung (UAT).
- Follow up dari layar rawat inap (saat pasien pulang) belum ada — di luar cakupan.
