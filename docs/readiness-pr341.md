# PR341 — checkpoint readiness, bukan izin rilis

## Scope, owner, runtime

- Owner implementasi: Hermes, branch existing `hermes/susulan-rekam-medis`, worktree `/opt/data/kamo-wt-susulan`.
- Runtime existing terverifikasi lewat log giliran: `gpt-6.1-sol`, `openai-codex`, reasoning high. Tidak ada permintaan inference Claude/Anthropic, retry tagihan, top-up, penggantian provider/model, atau akses baru.
- Dasar pekerjaan sebelum checkpoint: `9ca46b8c1fdc20890c6568efe64f0f6d406f4963`.
- Main yang direkonsiliasi secara merge biasa (tanpa rebase/force): `9b7c47d761423407f09418d0f675a4085c7c1fac` (PR342 + PR343).
- Andri telah memilih **A** untuk consent item susulan kasir: tetap tercatat tanpa memicu kewajiban persetujuan baru. Bukti: https://github.com/rezanje/Kamo-Vet-OS/pull/341#issuecomment-6499697790 . Tidak ditanyakan ulang. Ini berbeda dari keputusan awal bahwa semua item harus masuk rekam medis.
- Tidak menyentuh Production, mengubah ACL produksi, menggunakan pasien asli, mengambil BMHP/C05, merge ke main, deploy, atau posting grup.

## Rekonsiliasi dan perubahan

1. Dua overlap bergabung tanpa konflik: `dokumen/page.tsx` mempertahankan label susulan DAN rincian uang multi-invoice PR343; `src/lib/klinik-posting.ts` mempertahankan seluruh pesan mitigasi PR343 DAN penolakan item susulan setelah posting.
2. Tambah tes render gabungan: label susulan dengan dua tagihan, sudah dibayar dan sisa yang benar.
3. Harness baru `scripts/test-item-susulan-full-schema-postgres.py`: memasang 324 migrasi main ke PostgreSQL 17.11 sekali-pakai, lalu migrasi PR341 **terakhir**, sesuai urutan kandidat yang akan dipasang setelah main. Menggunakan RPC bisnis publik asli, peran authenticated + JWT fixture, skema/trigger/RLS/stok/jurnal asli. Hanya platform auth/storage berupa shim repo. Tidak menerima URL remote, tidak membaca kredensial.
4. Ditemukan dua regresi kompatibilitas nyata: pembungkus posting dan koreksi PR341 mengambil kunci kunjungan sebelum koordinator PR343 sehingga dapat deadlock dengan RPC publik asli. Reproduksi deterministik dua sesi + pengamat/gate, dengan blocking PID dan wait event. Perbaikan hanya pada dua pembungkus PR341: ambil koordinator existing terlebih dahulu. Definisi RPC bisnis asli tidak diubah (hash sebelum/sesudah pemasangan kandidat dicek).
5. Harness lama berskema mini diselaraskan dengan mengambil empat fungsi koordinator asli dari migrasi PR343. Posting/racikan pada harness lama tetap stub, sehingga hasilnya bukan bukti siklus bisnis penuh. Bukti utama sekarang harness full-schema.

## Hasil eksekusi

- `node --max-old-space-size=1536 node_modules/vitest/vitest.mjs run clinic susulan tagihan ranap uang-tagihan baca-uang --maxWorkers=1`: **71 file, 745 pass**, 0 fail.
- Tes cetak gabungan berada di direktori `klinik` (bukan filter `clinic`) dan diuji terpisah: `node --max-old-space-size=1536 node_modules/vitest/vitest.mjs run 'src/app/(app)/klinik/rekam-medis/[visitId]/dokumen/__tests__/page.test.tsx' --maxWorkers=1`: **9 pass**, 0 fail.
- `node --max-old-space-size=3072 node_modules/typescript/bin/tsc --noEmit`: exit 0.
- ESLint pada 18 file TS/TSX diff terhadap main: exit 0, 0 error, 1 warning `<img>` lama.
- `python3 scripts/test-item-susulan-full-schema-postgres.py --pre-coordinator --json /opt/data/kamo-pr341-full-schema-red-final.json`: **12 PASS / 2 FAIL / 0 BLOCKED**, exit 1 yang diharapkan; kedua kegagalan adalah deadlock 40P01 terhadap SQL sebelum perbaikan, dipin ke commit 9ca46b8c.
- Verifikasi ulang gabungan sesudah review: `node --max-old-space-size=1536 node_modules/vitest/vitest.mjs run clinic susulan tagihan ranap uang-tagihan baca-uang 'src/app/(app)/klinik/rekam-medis/[visitId]/dokumen/__tests__/page.test.tsx' --maxWorkers=1`: **72 file, 754 PASS / 0 FAIL**.
- `python3 scripts/test-item-susulan-full-schema-postgres.py --json /opt/data/kamo-pr341-full-schema-reviewed.json`: **16 PASS / 0 FAIL / 0 BLOCKED**, exit 0. Menambah bukti nilai omzet/HPP yang diharapkan, keseimbangan jurnal per entry, dan readback tautan/stok/saldo setelah kedua jadwal konkurensi. Run green-final sebelumnya tetap **14/0/0**, bukan ditimpa atau diganti labelnya.
- `python3 scripts/test-item-susulan-rekam-medis-postgres.py`: **12 PASS**, exit 0 (harness mini, batas stub seperti di atas).

Bukti mencakup dokter menambah item; retry identik/isi berubah; replay dari cabang lain ditolak; kasir menambah baris; tagihan/resep tertaut; stok berkurang tepat 2, jurnal seimbang, status Belum Lunas; retry posting tidak menggandakan; dokter setelah posting ditolak; koreksi hanya menambah baris baru; diagnosis asli utuh; tulisan langsung resep pada riwayat bersama tetap ditolak; dua jadwal konkurensi nyata.

### Riwayat kegagalan dipertahankan

- Run harness pertama: 10 PASS / 2 FAIL. Kesalahan query fixture memakai nama field payload untuk kolom invoice, dan ekspektasi kode penolakan guard terlalu sempit; bukan kegagalan fungsi posting. Log run1 tetap disimpan.
- Run2 setelah pembetulan fixture: 12 PASS / 0 FAIL.
- Reproduksi awal deadlock posting: 12 PASS / 1 FAIL; setelah perbaikan posting, koreksi masih deadlock: 13 PASS / 1 FAIL.
- Run green2 awal masih 13 PASS / 1 FAIL karena kedua koreksi memakai `source_invoice_item_id` lama yang memang ditolak sesudah baris pertama diganti. Fixture konkurensi diperbaiki untuk memakai identitas resep stabil, TANPA melonggarkan syarat kedua operasi sukses. Jadwal revisi diuji ulang terhadap SQL lama (RED 12/2) dan terbaru (GREEN 14/0).
- Harness mini sempat gagal karena belum punya dependensi koordinator; setelah mengambil fungsi koordinator asli lulus lagi. Semua log historis tetap berada di `/opt/data/kamo-pr341-*`.

## Migrasi dan batas readiness

- Kandidat tetap satu file: `supabase/migrations/20261101000000_item_susulan_rekam_medis.sql`, kini mencakup penyelarasan urutan koordinator. Versi persis terbaru **belum** diuji hosted atau diizinkan untuk dipasang.
- Bergantung pada koordinator PR343 yang sudah termasuk main 9b7c47d7. Full-schema menguji pemasangan kandidat sesudah main; bukan bukti drift/ACL hosted.
- Tidak ada perubahan pada migrasi PR342 atau PR343.
- Belum ada UAT browser terautentikasi dokter → kasir → dokumen cetak; tes render memakai sumber data mock, tes database tidak menjalankan Next.js/PostgREST.
- Belum menguji fungsi racikan asli, jalur split/DEMO asli, konkurensi dokter/racikan dengan keuangan, atau seluruh variasi peran. Harness mini mencakup beberapa jalur dengan stub, bukan pengganti gap tersebut.
- Belum menjalankan ulang full Vitest seluruh repo atau build pada checkpoint ini; hasil lama tidak diklaim sebagai bukti head baru.
- CI final, hosted preflight, backup/rollback dan persetujuan perubahan persis tetap gerbang terpisah. Tidak ada klaim siap rilis/live.
- Review independen pertama mengonfirmasi urutan koordinator dan dua overlap, tetapi menemukan pesan kosong yang masih muncul saat query resep gagal serta bukti jurnal/readback yang terlalu lemah. Pesan cetak diperbaiki lewat RED (1 gagal/2 lulus) → GREEN; jurnal kini dibuktikan bernilai dan seimbang per entry, dan kedua jadwal konkurensi punya readback. Temuan harness mini yang kehilangan dependensi sudah ditutup dengan 12 PASS setelah mengambil koordinator asli. Pemeriksaan ulang independen read-only selesai: kedua temuan tertutup, penguatan bukti terkonfirmasi, tidak ada blocker konkret tersisa dalam lingkup review terbatas. Ini bukan persetujuan rilis atau audit keamanan penuh; tidak ada worker implementasi kedua.
- Bukti eksekusi yang bisa dibaca reviewer ada di `docs/evidence/pr341-local-regression.json`; log historis tambahan tetap di workspace. Tidak ada hasil gagal yang dibuang atau diubah menjadi lulus.
