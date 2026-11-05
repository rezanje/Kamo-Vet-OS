# Pelanggan nonaktif (Aldi, 5 Nov 2026)

## Latar

Aldi Saputra (grup "Kamo Group - ERP Dev", 5 Nov 2026 14.48): *"Mas tolong bisa non aktifin customer
boleh skrng? Soalnya banyak yg buang penjualan ke customer CS pusat."* Kasir cabang wajib memilih
pelanggan sebelum bayar; banyak yang memilih akun "CS pusat" alih-alih pelanggan asli.

## Perilaku baru

- **CRM → Pelanggan**: OWNER/ADMIN (akun aktif) bisa **Nonaktifkan pelanggan** (alasan opsional, ada
  konfirmasi) dan **Aktifkan lagi**. Daftar menyembunyikan pelanggan nonaktif; centang
  **Tampilkan nonaktif (n)** untuk melihatnya (baris diberi label "Nonaktif"). Panel detail menampilkan
  sejak kapan, oleh siapa, dan alasannya — terlihat oleh semua peran.
- **Pemilih pelanggan transaksi baru** tidak menawarkan pelanggan nonaktif: kasir petshop, POS back office,
  faktur/pesanan/penawaran/uang muka penjualan, penjualan online (WA), plus pemilih lain yang memakai
  `/api/pelanggan` (voucher bersasaran, anabul baru, transfer anabul). Draf lama yang menyimpan pelanggan
  nonaktif dipulihkan tanpa pelanggan dan layar meminta memilih ulang.
- **Registrasi klinik** (pencocokan no. HP): bila HP milik pelanggan nonaktif, layar memberi tahu
  "No. HP ini milik pelanggan yang sudah dinonaktifkan. Pakai no. HP pemilik asli." dan penyimpanan
  ditolak **sebelum** kartu anabul dibuat.
- **Penjaga database** (tidak bergantung layar): insert baru ke `sales`, `visits`, `sales_quotations`,
  `sales_orders`, `sales_invoices`, `sales_advances` — atau mengganti `customer_id` dokumen lama ke
  pelanggan nonaktif — ditolak dengan pesan **"Pelanggan ini sudah dinonaktifkan, pilih pelanggan asli."**
  Pesan ini tampil apa adanya di kasir, POS, faktur, pesanan, penawaran, uang muka, dan online.
- **Tidak berubah**: riwayat, laporan, piutang, poin, dan dokumen lama pelanggan nonaktif. Pembayaran,
  pembatalan, dan koreksi atas dokumen lama tetap jalan. Pengecualian yang tetap boleh: impor rekam medis
  lama (`legacy_source_key`), lanjutan rawat inap yang sudah berjalan (`continued_from_visit_id`), faktur
  pengganti koreksi (`replaces_invoice_id`), saldo awal piutang (`opening_batch_id`).
- Waktu & pelaku penonaktifan diisi database (kiriman klien diabaikan). Peran lain (STAFF, DOKTER, FINANCE,
  admin nonaktif) ditolak database; mereka tetap boleh mengedit data biasa pelanggan.

## Keputusan yang masih terbuka (pemilik)

Butir 6 tugas: apakah akun "CS pusat" masih boleh dipakai **tim CS pusat sendiri** (mis. hanya cabang pusat
atau peran tertentu)? Belum ada jawaban, jadi yang dipasang **nonaktif total** (sesuai tugas). Kalau nanti
perlu pengecualian per cabang/peran, penjaga database perlu aturan tambahan.

Catatan operasional: pesanan penjualan yang **sudah dibuat** atas nama pelanggan yang kemudian dinonaktifkan
tidak bisa diterbitkan fakturnya (faktur = transaksi baru). Aktifkan lagi sementara bila memang perlu.

## Perubahan

- `supabase/migrations/20261107100000_pelanggan_nonaktif.sql` — kolom `customers.is_active` (default true),
  `deactivated_at`, `deactivated_by`, `deactivation_reason`; trigger peran `customers_status_guard`;
  trigger `customer_active_guard` di 6 tabel transaksi.
- `src/lib/pelanggan-server.ts` — pencarian & pemuatan per id hanya pelanggan aktif.
- `src/lib/pelanggan-aktif.ts` — pesan & cek bersama.
- `src/app/(app)/klinik/registrasi/actions.ts`, `RegistrasiForm.tsx` — tolak pemilik nonaktif sebelum anabul disimpan.
- `src/app/(app)/crm/pelanggan/{page.tsx,PelangganClient.tsx,actions.ts,StatusPelanggan.tsx}` — filter, label, tombol.
- Kasir & POS back office **tidak diubah kodenya**: pencarian sudah tersaring dan penolakan database tampil
  apa adanya. (Menambah cek di sana mengubah urutan panggilan database yang dikunci tes kesetaraan promo.)

## Verifikasi lokal

- `scripts/test-pelanggan-nonaktif-postgres.py` (skema penuh 377 migrasi, PostgreSQL 16 lokal, data fiktif):
  40/40 lulus (`docs/evidence/2026-11-05-pelanggan-nonaktif/db-candidate.json`); tanpa migrasi gagal di
  preflight (`db-red-baseline.json`); 9/9 mutan terbunuh, kontrol 0 gagal (`db-mutations.json`).
- Paket owner-apply: gladi bersih lulus (`owner-apply/rehearsal-pg16.log`).
- Vitest baru/diubah: `pelanggan-cari`, `registrasi-pelanggan-atomik-action`, `operational-list-pages`,
  `pelanggan-nonaktif-panel`. Tes kesetaraan promo kasir/POS tetap identik dengan main.
- Hasil `npx vitest run`, `npm run lint`, `npx tsc --noEmit`, `npm run build`: lihat deskripsi PR.

## Deploy

**Database dulu, baru aplikasi** — lihat `docs/evidence/2026-11-05-pelanggan-nonaktif/owner-apply/README.md`.
Bila aplikasi sempat terdeploy lebih dulu: pencarian pelanggan kasir/POS/faktur tetap jalan (filter dilewati
otomatis bila kolom belum ada), tetapi halaman CRM → Pelanggan gagal dimuat sampai database diterapkan.
Rollback: `docs/rollback/2026-11-05-pelanggan-nonaktif.sql` bersama rollback aplikasi.
