# HRIS T1/T2/R1 — handoff kesiapan lokal

Basis: main `7f88f4a8475fcceaf9a8a74aaebb3e9bcd874160`; dua commit lama direbase
bersih. Implementasi existing dipertahankan, tidak dibangun ulang.

## Penyesuaian putaran ini

- Hanya migrasi belum diterapkan yang dinomori ulang `20261102020000` →
  `20261104060000_hris_cabang_penugasan.sql`, setelah main 0403, antrean pembayaran
  0404 dan promo 0405. Rujukan tes/docs/runner ikut diperbarui; bukan klaim terbaru.
- Fullschema awal gagal pada sidik auth.uid() migrasi impor. Shim platform diganti
  fixture hosted yang sudah ada di main. Kegagalan berikutnya pada gerbang RS-2
  berasal dari runner yang mengirim migrasi tanpa transaksi: setiap migrasi kini
  di-BEGIN/COMMIT sebagaimana migrasi sebenarnya, tanpa mengubah SQL main/gerbang.
- Klaster native socket-only, /opt/data, shared_buffers=128MB, max_connections=20.
- Suite perilaku asli tetap berjalan. Ditambah 30 kasus native tiga RPC × dua cabang
  × OWNER/ADMIN A/ADMIN B/STAFF/DOCTOR, dengan role metadata palsu dan readback audit.
  Kasus diputar dalam transaksi rollback; tidak ada pelebaran RLS/grant/peran.
- Ditambah 50 panggilan pembaca publik asli clinic_demo_care_staff: role/cabang dan
  penugasan current/hari terakhir/future end/expired/future start. Cabang utama tetap
  terpilih, cabang di luar hak ditolak. PCA tetap bukan paramedis, dibuktikan SQL+tes TS.
- Catalog fungsi berjalan dicetak ke log: delapan pembaca operasional memakai
  employee_assignment_current; writer, pembuka penugasan, audit historis dan
  private.can_manage_hris_employee memang bukan clinical-current picker.
- Instruksi rollback diperbaiki: backup definisi/ACL/proconfig aktual lalu restore
  persis, bukan menjalankan ulang migrasi lama yang bisa menghapus fitur main baru.

## Verifikasi saat ini

- `python3 scripts/test-hris-cabang-postgres.py`: exit 0; 328 migrasi basis + 1
  kandidat = 329; sembilan jangkar cocok; apply dua kali idempoten; 14 blok PASS,
  termasuk suite perilaku asli + 30 kasus role/RPC + 50 kasus public picker.
- `python3 /opt/data/kamo-queue-run-local.py hris`: exit 0; 96 berkas / 726 tes lulus,
  lint semua TS/TSX berubah exit 0. Manifest exact commands/files:
  `/opt/data/kamo-queue-hris-checks.json`. NODE_OPTIONS=
  `--max-old-space-size=1024 --no-experimental-webstorage`, forks, maxWorkers=1.
  Pemilihan mencakup tes berubah dan caller aktual dokter/penjual/pelaksana/
  master guard/profil HRIS, termasuk mock query chain end_date + pagination main.
- Kegagalan awal disimpan, tidak ditimpa menjadi hijau: native-initial (sidik auth),
  native-shim (transaksi RS-2), native-matrix (fixture telepon wajib), lalu native-final
  lulus. Seluruh log di `/opt/data/kamo-queue-hris-*.log`.

## Status dan gerbang parent

SIAP LOKAL untuk review/CI, BELUM live/UAT/hosted. T1/T2/R1 kode selesai dalam lingkup;
pembersihan karyawan tanpa cabang TIDAK dijalankan, HR tetap harus memilih manusia
+ cabang. Tidak ada auto-backfill/tebakan nama/jabatan. Tidak ada role Manager baru.

- Full-project tsc/build/full-suite tidak dijalankan (batas RAM); bukti 4.916/14 pada
  SHA lama tidak dipakai sebagai bukti saat ini. Exact-head CI/build wajib parent.
- Migrasi sebelum UI; backup fungsi/ACL/policy, hosted validation, pemasangan/readback,
  dan UAT klinik tetap tugas parent. Bila main berubah setelah promo rilis, rebase dan
  revalidasi exact-head lagi; batch pembayaran 0404 terpisah tidak disentuh di sini.
- DELETE assignment OWNER/ADMIN belum ditutup dengan jejak khusus (warisan);
  S1–S5/R2/R3 bukan lingkup ini. private.can_manage_hris_employee sengaja menyertakan
  riwayat agar admin masih bisa mengelola/membuka kembali penugasan yang diakhirinya;
  tidak dipakai memberi branch entitlement login atau memilih petugas klinik.
- Semua native memakai fungsi bisnis asli pada skema repo lengkap. Fixture records
  fiktif saja. Ini bukan bukti Auth/PostgREST/browser/UAT. Tidak ada network,
  Production, push, PR, merge, deploy, install atau CLI berbayar.
