# A02 — permintaan koreksi pembelian tersimpan + antrean/notifikasi

Stack: PR221 (approval read fail-closed) → PR233 (dashboard pending work) → PR248 (request koreksi tersimpan).
PR221 (`80800f4`) dan PR233 (`e77eb34`) sudah dirilis ke production. PR248 kini berbasis `main` `4a36212` (termasuk K03), digabung
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

- Satu migrasi aditif: `supabase/migrations/20261027153000_purchase_correction_requests.sql`
  (sha256 `923bb7420acd35ecaee2ba80ff54b201e9beb3d8fce65ff8fae21d11e5909081`). PR221/PR233 tanpa migrasi (sudah live).
- **Paket owner:** `docs/evidence/2026-10-27-a02-correction-requests/owner-apply/` — `OWNER-RUNBOOK.md`, preflight dan
  readback read-only, `02-apply.sql` (migrasi persis + baris riwayat dalam satu transaksi, `lock_timeout 5s`,
  `statement_timeout 60s`), `04-freeze-if-decided.sql` (rollback default, data tetap), `05-teardown-empty-only.sql`
  (hanya saat kosong), dan `build-and-verify.py` yang menghasilkan ulang 01–03 dan melatih seluruh alur.
- **Backup:** tidak ada aturan repo yang mewajibkan backup penuh/on-demand baru (AGENTS.md/CLAUDE.md tidak mengaturnya;
  runbook req2 dan K02 hanya untuk rilis masing-masing). Catat waktu backup lengkap terbaru di catatan rilis privat
  saat slot. Rollback A02 tidak memakai restore.
- **Data production tidak masuk repo:** ID project, waktu backup, keluaran query production dicatat privat saja.
- Urutan rilis (slot DB eksklusif dari koordinator): runbook Langkah 0–5 — target & catatan privat, cocokkan sha256,
  preflight `0 failed`, `02-apply.sql`, readback `0 failed`, merge PR248, verifikasi Production READY, komentar pasca-deploy.
  Jangan `supabase db push`: migrasi lain yang belum terpasang (mis. C04 `20261026002100`, R05 `20261027090000`) bisa ikut.
- Catatan: fungsi lama `reset_simulasi_barang_dan_stok` tidak diperluas untuk tabel ini (sama seperti tabel request lain
  yang ditambahkan setelahnya); FK default akan menahan reset bila ada request.

## Verifikasi (main `e77eb34`, data uji fiktif saja)

### Lulus
- SQL A02 (PostgreSQL 16.15 sementara, socket lokal, dihapus setelahnya; seluruh migrasi repo sebelumnya, 271 di main `43b1a33`):
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
- Paket owner dilatih penuh pada PostgreSQL 16.15 dan **17.6** (versi production), 271 migrasi sebelumnya (main `43b1a33`) + riwayat:
  preflight `0 failed`; apply tertahan kunci tulis pada `purchase_orders` menyerah setelah 5,0 s tanpa perubahan;
  apply + readback `0 failed`; suite A02 lulus; teardown saat kosong berhasil lalu preflight kembali `0 failed`;
  apply ulang; freeze menolak pembuatan/pemrosesan sementara data tetap terbaca (readback setelah freeze gagal tepat di
  dua grant fungsi); teardown ditolak saat berisi dan saat jejak log request ada. Readback membandingkan bentuk katalog
  persis (pemilik, grant per role, policy, trigger, constraint, index, kolom, fungsi) dan terbukti menangkap 13
  penyimpangan tunggal. File 01–03 identik byte demi byte di kedua versi. Log: `owner-apply/rehearsal-pg16.log`,
  `owner-apply/rehearsal-pg17.6.log`.

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
