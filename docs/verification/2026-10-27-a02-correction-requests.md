# A02 — permintaan koreksi pembelian tersimpan + antrean/notifikasi

Stack: PR221 (approval read fail-closed) → PR233 (dashboard pending work) → PR248 (request koreksi tersimpan).
PR221 (`80800f4`) dan PR233 (`e77eb34`) sudah dirilis ke production. PR248 kini berbasis `main` `e77eb34`, digabung
dengan merge biasa; konflik di alert dashboard diselesaikan dengan mempertahankan gating Akses Grup dari PR233.

PR248 belum di-merge/deploy dan migrasinya belum diterapkan ke production. Sheet checklist hanya dibaca.

## Aturan yang dipakai (sudah ada, tidak dikarang)

| Aturan | Sumber |
|---|---|
| Koreksi pembelian oleh peran berwenang; staf/supervisor **melaporkan atau meminta** koreksi, bukan mengubah sendiri. Role terbatas "tahu alur meminta koreksi". | Checklist P01 kolom Tindak lanjut & Kriteria selesai |
| Peran berwenang saat ini = Super Admin (`OWNER` aktif): semua kontrol koreksi PO/faktur/pembayaran dan RPC pembatalan memeriksa `role='OWNER' and is_active`. | `src/app/(app)/pembelian/[id]/page.tsx`, `faktur/[id]/page.tsx`, migration `20261021004732`, `20261023022600` |
| Panduan non-owner sebelumnya: "Sampaikan kepada Super Admin", tanpa request tersimpan. | PR198 (main) |
| A02: daftar pending yang bisa ditindaklanjuti dan dilacak status; bedakan dari toast sukses/gagal; kaitkan request ke dokumen asal dan role penanggung jawab. Kanal WhatsApp belum diputuskan. | Checklist A02 |
| Akses modul Pembelian mengikuti Akses Grup (`role_modules`), bawaan FINANCE/STAFF tanpa Pembelian. | `src/lib/akses.ts` |

## Yang dibangun

- Tabel `purchase_correction_requests` (migration `20261027153000_purchase_correction_requests.sql`):
  terikat tepat satu dokumen asal (`po_id` **atau** `invoice_id`, FK + check), snapshot nomor dokumen,
  cabang dokumen, pemohon, rincian, status, pemroses, waktu, tindak lanjut.
- Siklus: `pending` → `selesai` (label UI "Sudah diproses"). Tidak ada transisi lain.
  - Buat: RPC `create_purchase_correction_request` — user aktif non-OWNER dengan akses modul Pembelian
    dan akses baca dokumen asal (aturan cabang sama dengan RLS PO/faktur; faktur tanpa cabang hanya untuk peran lintas cabang). Idempoten per (pemohon, request_key); kunci dipakai ulang dengan isi beda ditolak.
  - Proses: RPC `process_purchase_correction_request` — hanya OWNER aktif dengan akses cabang;
    catatan tindak lanjut wajib; idempoten; request yang sudah selesai tidak bisa diputus ulang.
  - Tidak ada grant insert/update/delete langsung ke tabel.
- Baca (RLS): pemohon melihat request miliknya; OWNER aktif melihat semua di cabang yang boleh ia buka.
  ADMIN/FINANCE/STAFF tidak melihat request orang lain, termasuk lewat log aktivitas.
- Membuat/memproses request **tidak** menyentuh PO, faktur, pembayaran, stok, atau jurnal (dibuktikan tes SQL).
  Koreksi resmi tetap lewat kontrol OWNER yang sudah ada.
- A01: tabel terdaftar di `activity_log_sources` (modul pembelian, induk PO/faktur, nilai yang dicatat hanya `status`,
  pembaca log hanya OWNER — sama dengan pembaca antrean);
  trigger buat/ubah/hapus aktif. Teks rincian/tindak lanjut tidak disalin ke log.
- UI:
  - Detail PO & faktur: panduan manual diganti form "Kirim permintaan koreksi" (non-OWNER) + daftar request dokumen itu
    beserta status/tindak lanjut dan tautan ke antrean. OWNER melihat jumlah menunggu/total. Gagal baca → peringatan,
    form disembunyikan, tidak dianggap "tidak ada".
  - Antrean `/pembelian/koreksi` (tab Menunggu / Sudah diproses, 50/halaman, jumlah exact): tautan balik ke dokumen asal,
    form "Tandai sudah diproses" hanya untuk OWNER aktif. Gagal baca → pesan error, jumlah "—".
  - Dashboard (PR233): OWNER mendapat alert persisten "Permintaan koreksi pembelian: N menunggu" (exact count);
    gagal baca → "status belum dapat dimuat". Peran lain tidak di-query.
  - Menu Pembelian: tile "Permintaan Koreksi"; log aktivitas mengenali menu dan entitasnya.

## Pemetaan acceptance A02

| Acceptance | Status | Bukti |
|---|---|---|
| Daftar pending yang bisa ditindaklanjuti, bukan hanya toast | Terpenuhi untuk approval transaksi, perintah bayar, refund transfer (PR233) dan koreksi pembelian (PR ini) | `pending-work.test.ts`, `purchase-correction-requests.test.tsx` |
| Permintaan koreksi pembelian tersimpan, bukan panduan manual | Terpenuhi | SQL suite + panel tests; teks "belum dikirim atau dicatat" dihapus dan diuji tidak muncul |
| Request terkait dokumen asal | Terpenuhi (PO/faktur; FK + check + tautan dua arah) | SQL suite, queue link tests |
| Status dapat dilacak (pending/diproses) dan siapa memproses | Terpenuhi (`pending`/`selesai`, pemroses, waktu, tindak lanjut, log A01) | SQL suite (trace + activity log), queue/panel tests |
| Role penanggung jawab | Terpenuhi sesuai aturan yang ada: OWNER aktif memproses; pemohon non-OWNER dengan akses Pembelian | SQL suite: STAFF/ADMIN tidak bisa memproses, OWNER nonaktif ditolak |
| Staff tidak melihat antrean finance | Terpenuhi | `pending-work` STAFF tanpa query; SQL: FINANCE/cabang lain melihat 0 request |
| Read error tidak dianggap nol / tanpa approval | Terpenuhi | PR221 (approval fail-closed), PR233 + PR ini (unknown, bukan 0) |
| Membuat request bukan izin edit transaksi posted | Terpenuhi | SQL: PO/faktur/jurnal/pembayaran identik sebelum-sesudah; tulis tabel langsung ditolak |
| Cash/transfer punya jejak sesuai scope | Tidak diubah: refund transfer pending/diproses tetap dari PR233; cash tetap langsung tercatat | Regresi penuh |
| Kanal notifikasi di luar aplikasi (WhatsApp) | **Belum** — keputusan belum ada | — |
| UAT/simulasi pengguna | **Ditunda** sesuai arahan | — |

## Keputusan minimal untuk Reza (belum diterapkan; perilaku sekarang = opsi pertama)

| # | Keputusan | Sekarang | Dampak bila diubah |
|---|---|---|---|
| 1 | Admin/Finance **melihat** antrean koreksi orang lain (tanpa memproses)? | Tidak; hanya Super Admin + pemohon sendiri | Perlu ubah aturan baca + dashboard Admin/Finance; tidak menambah hak ubah transaksi. Finance bawaan tetap tanpa modul Pembelian kecuali Akses Grup diubah. |
| 2 | Status **Ditolak** terpisah? | Tidak; "Sudah diproses" + catatan alasan | Perlu migrasi kecil (status baru) + tampilan; laporan bisa membedakan dikoreksi vs ditolak. |
| 3 | Pemohon boleh **membatalkan** request yang menunggu? | Tidak | Perlu status/aksi baru + migrasi; mengurangi antrean salah kirim. |
| 4 | Notifikasi **WhatsApp** / kanal luar aplikasi? | Tidak; hanya dashboard + antrean dalam aplikasi | Butuh penyedia, nomor, template, persetujuan kirim pesan; tidak ada kredensial sekarang. |
| 5 | Pemroses selain Super Admin ("manajer", P01)? | Tidak | Perubahan matriks role; di luar A02, ikut keputusan P01. |
| 6 | Super Admin juga boleh **mengajukan** request (catatan untuk diri sendiri)? | Tidak; Super Admin langsung memakai kontrol koreksi | Tidak menambah akses; hanya mengubah aturan form/RPC. |

## Migrasi persis, urutan rilis, backup & rollback

- Satu migrasi: `supabase/migrations/20261027153000_purchase_correction_requests.sql` (aditif: 1 tabel baru, 4 fungsi baru,
  1 policy, 1 baris `activity_log_sources`, 2 trigger pada tabel baru). Tidak mengubah tabel/fungsi lama, tidak ada grant global,
  tidak ada backfill. PR221 dan PR233 tidak punya migrasi.
- Nomor versi semula `20261027090000` bentrok dengan `20261027090000_private_report_promo_history_presets.sql` di main;
  sudah dipindah ke `20261027153000` dan dijaga tes (gagal pada kode lama + main, lulus sekarang).
- Urutan rilis yang disarankan (slot rilis terpisah dari Wowo; tidak bersamaan dengan C04 atau migrasi klinis PR251
  `20261027100000_doctor_patient_compound.sql`):
  1. Technical checks hijau di head final PR248 + review independen tanpa blocker (status: lihat laporan PR248).
  2. Review backup/target/preflight: catat titik backup/PITR production; pastikan target project benar; preflight read-only
     memastikan `20261027153000` belum ada di riwayat migrasi dan tabel/fungsi bernama sama belum ada.
  3. Terapkan **hanya** file migrasi A02 (jangan `db push` massal: migrasi C04 `20261026002100`, R05 `20261027090000` dan
     PR251 `20261027100000` bisa ikut terpasang). Verifikasi pasca-terap: versi `20261027153000` tercatat sekali; RLS aktif;
     `anon` tanpa EXECUTE; `authenticated` hanya SELECT tabel + EXECUTE 4 fungsi; 2 trigger aktif; baris
     `activity_log_sources` dengan `reader_roles={OWNER}`.
  4. Merge PR248 (deploy aplikasi Production). Migrasi duluan aman untuk aplikasi lama (aditif). Bila aplikasi terlanjur jalan
     tanpa migrasi, layar gagal tertutup: "status belum dapat dimuat", form disembunyikan, tidak ada angka palsu.
  5. Komentar pasca-deploy di PR248 sesuai AGENTS.md.
- Rollback: `docs/rollback/2026-10-27-a02-purchase-correction-requests.sql` (belum dijalankan di target). Langkah 1 membekukan
  pembuatan/pemrosesan dan menyimpan semua request + log; diuji di database sementara. Langkah 2 (hapus total) dikomentari dan
  menolak jalan bila ada request nyata.
- Catatan: fungsi lama `reset_simulasi_barang_dan_stok` tidak diperluas untuk tabel ini (sama seperti tabel request lain
  yang ditambahkan setelahnya); FK default akan menahan reset bila ada request.

## Verifikasi (main `e77eb34`, data uji fiktif saja)

### Lulus
- SQL A02 (PostgreSQL 16.15 sementara, socket lokal, dihapus setelahnya; seluruh 270 migrasi repo):
  `purchase_correction_requests.sql` lulus (lifecycle pending→selesai, idempotensi, tautan asal, pemroses/catatan,
  pelacakan pemohon, isolasi STAFF/ADMIN/FINANCE/cabang lain/OWNER nonaktif, tulis langsung ditolak,
  PO/faktur/jurnal/pembayaran tidak berubah, log A01 tanpa teks bebas dan tidak terbaca ADMIN, faktur tanpa cabang
  ditolak untuk staff cabang); 0 baris tersisa; rollback langkah 1 diuji (tulis beku, data tetap terbaca).
  Perintah: `python3 docs/evidence/2026-10-27-a02-correction-requests/run-native-pg.py scripts/test-purchase-correction-requests-postgres.py`
  (Docker: `python3 scripts/test-purchase-correction-requests-postgres.py`).
- Perbaikan hasil review independen PR248, masing-masing merah→hijau:
  - Log aktivitas request terbaca ADMIN → pembaca log hanya OWNER.
  - Staff cabang bisa mengajukan request pada faktur tanpa cabang yang disembunyikan RLS faktur → ditolak.
  - Galat infrastruktur (JWT expired, fetch failed, cache skema, dsb.) bisa tampil mentah → hanya pesan guard RPC (SQLSTATE
    42501/22023/23505/55000) yang ditampilkan.
- Tes pengaman versi migrasi: `20261027153000` unik di main dan seluruh branch remote.
- Regresi SQL terkait identik main vs main+A02 (`purchase_invoice_lifecycle`, `purchase_short_close`, 13 suite PASS di
  `test-activity-audit-postgres.py`).
- Technical checks GitHub di head final PR248: lihat laporan PR248 (URL dan langkah per head).

### Kegagalan baseline (sama persis di main murni; bukan dari A02)
- `test-activity-audit-postgres.py`: 6 suite gagal identik di main murni dan main+A02 (`activity_audit_framework` batas
  "179 sumber" yang belum mengikuti sumber refund, `activity_audit_financial/inventory/remaining_modules`,
  `posted_sale_cancellations`, `purchase_payment_corrections`).
- Lewat runner umum (tanpa prasyarat runner khususnya): `po_price_after_advance`, `promo_package_total` gagal identik di main.
- `npm run build` lokal kehabisan memori di sandbox ini, juga pada main murni; bukti build dari Technical checks GitHub.

### Catatan baseline (tidak diubah)
- `requested_by`/`processed_by` merujuk `profiles` tanpa ON DELETE, sama seperti tabel request lain (mis.
  `sales_refund_requests`): akun yang punya request tidak bisa dihapus permanen; nonaktifkan saja.

### Masih ditunggu
- Review backup/target/preflight dan slot rilis migrasi dari Wowo.
- UAT pengguna: ditunda sesuai arahan.
