# Promo kedaluwarsa — handoff lokal

Basis verifikasi: main `7f88f4a8475fcceaf9a8a74aaebb3e9bcd874160`.
Rebase dua commit lama bersih; pekerjaan promo lama dipertahankan. Tidak ada network,
Production, push, PR, merge, deploy atau CLI berbayar pada putaran ini.

## Perubahan kesiapan

- Migrasi BELUM diterapkan diganti `20261102010000` →
  `20261104050000_promo_kadaluarsa_otomatis.sql`, setelah main 0403 dan slot
  pembayaran 0404 yang dikerjakan terpisah. Tidak ada versi terpasang diubah dan
  tidak ada klaim "migrasi terbaru".
- Kegagalan nyata fullschema: shim `auth.uid()` lama tidak cocok sidik migrasi
  impor 20261101120000. Memakai fixture platform hosted yang sudah ada di main;
  tidak melewati prasyarat atau mengganti fungsi bisnis asli.
- Klaster native socket-only di /opt/data, shared_buffers=128MB, max_connections=20.
- Suite lama dipertahankan, ditambah uji tulis native STAFF/DOCTOR dengan klaim
  role OWNER/app_metadata ADMIN palsu (insert/update/delete promo, voucher, kampanye),
  serta jalur ADMIN tetap boleh edit master valid. Tidak ada grant/role dilonggarkan.
- Penghitung assertion native mencatat eksekusi nyata, bukan menghitung teks tes.
- Catatan pra-rilis sekarang meminta backup semua baris terdampak termasuk kampanye,
  jumlah per tabel dan readback ID sebelum/sesudah. Rollback tidak mengaktifkan
  kembali data kedaluwarsa. Empat pengaturan potong otomatis lama tidak diubah.

## Bukti putaran ini

- `PG_BIN=/opt/data/kamo-pg-harness/bin python3 scripts/test-promo-kadaluarsa-postgres.py`:
  exit 0; 328 migrasi basis + 1 kandidat = 329; apply dua kali idempoten;
  61 assertion suite promo; promo_edit, c05_campaign_codes, promo_excel_batch lulus.
- `python3 /opt/data/kamo-queue-run-local.py promo`: exit 0;
  Vitest 57 berkas / 609 tes lulus, lint semua TS/TSX berubah exit 0.
  Manifest perintah/daftar berkas: `/opt/data/kamo-queue-promo-checks.json`.
  NODE_OPTIONS=`--max-old-space-size=1024 --no-experimental-webstorage`, forks, maxWorkers=1.
- Audit diff main: checkout math, coordinator, posting, DP/admission, stage invoice,
  stock/jurnal dan fitur rawat inap main tidak ditimpa. Readers promo/voucher,
  kampanye, KPI, kasir/POS, antrian dan pembayaran klinik diperiksa;
  fallback expiry tetap date-based walaupun sapuan gagal. Tes route pembayaran
  dan tagihan terbaru dipilih eksplisit, bukan hanya filter nama clinic.

## Status dan batas

SIAP LOKAL untuk review/CI parent; BELUM live atau UAT. Full-project tsc/build dan
full-suite tidak dijalankan karena batas RAM; bukan mengulang bukti SHA lama.
Kegagalan shim awal disimpan `/opt/data/kamo-queue-promo-native-initial.log`.
pg_cron tidak tersedia di klaster; jalur cron belum dibuktikan. Campaign belum
terdaftar activity_log (warisan), promo/voucher tercatat sistem. Hosted preflight,
backup/count, pemasangan migrasi SEBELUM UI, ACL/readback, exact-head CI/build dan
UAT pemilik tetap gerbang parent. Persetujuan rilis ditangani parent, bukan dianggap
belum ada hanya karena laporan historis menulis demikian.
