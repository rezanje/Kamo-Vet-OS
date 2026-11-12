# Usulan A5 — akses koreksi visit rawat inap (meeting 12 Nov 2026)

Status: **usulan, menunggu keputusan Reza.** Belum ada kode/migrasi A5 yang ditulis.

## Kondisi sekarang (hasil investigasi)

| Situasi | Siapa yang bisa sekarang | Di mana aturannya |
|---|---|---|
| Tambah visit dokter tepat waktu (≤ 48 jam lalu), pasien masih dirawat | Semua yang punya akses cabang | trigger `guard_inpatient_doctor_visit` (H06) |
| Tambah visit dokter > 48 jam lalu | Hanya OWNER/ADMIN (kode tetap, bukan Akses Grup) | trigger H06 (`private.hris_role()`) |
| Ubah waktu/tanggal/dokter/jenis visit | Hanya OWNER/ADMIN (kode tetap) | trigger H06 |
| Ubah paramedis di catatan visit | Semua yang punya akses cabang | tidak dijaga |
| Tambah/ubah catatan setelah pasien pulang/RIP | **Tidak ada siapa pun**, termasuk Owner | server action `updateDailyLog` + tombol disembunyikan |

Catatan: menu Komisi membayar visit dokter maks. 1 per dokter/pasien/hari (H06), dan Laporan Visit (A4)
kini memakai aturan yang sama. Setiap edit catatan sudah tercatat (`audit_inpatient_care_edit`: isi lama + alasan).

## Usulan

Satu izin baru di Akses Grup: **"Koreksi visit rawat inap"** (`klinik.koreksi_visit`, modul Klinik), jenis
izin-khusus seperti "Batalkan penerimaan": Owner selalu boleh, peran lain hanya bila dicentang.

Pemegang izin boleh:
1. menambah visit dokter dengan waktu > 48 jam lalu (pengganti aturan tetap OWNER/ADMIN);
2. mengubah waktu, tanggal, dokter, jenis, **dan paramedis** catatan visit;
3. menambah/mengubah catatan visit **setelah pasien pulang/RIP** (hanya catatan visit/pemantauan, tanpa obat/tagihan).

Yang lain tetap seperti sekarang: mengisi visit tepat waktu selama pasien dirawat.
Setiap koreksi wajib alasan dan tercatat di log aktivitas (pakai jejak edit yang sudah ada + catatan tambah terlambat).
Aturan bisnis "yang tidak mengisi visit tidak dapat insentif" cukup didokumentasikan (tidak dipaksa sistem).

## Perubahan teknis (bila disetujui)
- Migrasi baru: baris `action_catalog`/`action_modules` untuk `klinik.koreksi_visit`; trigger H06 diganti memakai
  izin itu (Owner selalu lolos); pagar baru di database: insert/update catatan pada rawat inap yang sudah pulang hanya
  untuk pemegang izin; perubahan paramedis di catatan visit ikut dijaga.
- Aplikasi: tombol "Tambah koreksi visit" & edit tetap muncul setelah pulang untuk pemegang izin; form koreksi tanpa
  keranjang obat; alasan wajib; daftar `GRANT_ONLY_ACTIONS` + tes sinkron katalog.
- Risiko: menyentuh catatan yang menjadi dasar komisi → koreksi untuk bulan yang komisinya sudah dibayar tidak otomatis
  ikut dibayar ulang (lihat keputusan 3).

## Keputusan yang dibutuhkan
1. **"Manager" itu peran apa?** Di sistem ada OWNER, ADMIN, FINANCE, STAFF, DOCTOR. Usulan: ADMIN.
2. **ADMIN saat ini sudah bisa (1) dan (2) lewat aturan tetap.** Saat pindah ke Akses Grup:
   A) ADMIN otomatis dicentang (perilaku sekarang tidak berubah) — saran; B) mulai dari tidak dicentang, Owner centang manual.
3. **Koreksi untuk bulan yang komisinya sudah dibayar:** A) tetap boleh, Finance menyesuaikan manual — saran;
   B) ditolak bila periode akuntansi sudah dikunci (tutup buku).
