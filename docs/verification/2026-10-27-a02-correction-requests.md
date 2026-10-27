# A02 — permintaan koreksi pembelian tersimpan + antrean/notifikasi

Stack: PR221 (approval read fail-closed) → PR233 (dashboard pending work) → PR248 (request koreksi tersimpan).
Base kode PR248: head PR233 `69f193984807baa9fa2483df8ea5aa494b505064`. Main terakhir diperiksa:
`906bc98c82c2cc42388e8821a5066f2a9b64598b` (sudah berisi C04 #223 app-first dan R05 #246 parsial).
Gabungan ketiga PR dengan main bersih (tanpa konflik teks).

Tidak ada merge, deploy, migrasi production, atau perubahan Sheet. Sheet checklist hanya dibaca.

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
    dan akses cabang dokumen. Idempoten per (pemohon, request_key); kunci dipakai ulang dengan isi beda ditolak.
  - Proses: RPC `process_purchase_correction_request` — hanya OWNER aktif dengan akses cabang;
    catatan tindak lanjut wajib; idempoten; request yang sudah selesai tidak bisa diputus ulang.
  - Tidak ada grant insert/update/delete langsung ke tabel.
- Baca (RLS): pemohon melihat request miliknya; OWNER aktif melihat semua di cabang yang boleh ia buka.
  ADMIN/FINANCE/STAFF tidak melihat request orang lain.
- Membuat/memproses request **tidak** menyentuh PO, faktur, pembayaran, stok, atau jurnal (dibuktikan tes SQL).
  Koreksi resmi tetap lewat kontrol OWNER yang sudah ada.
- A01: tabel terdaftar di `activity_log_sources` (modul pembelian, induk PO/faktur, nilai yang dicatat hanya `status`);
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

## Migrasi persis, urutan rilis, backup & rollback

- Satu migrasi: `supabase/migrations/20261027153000_purchase_correction_requests.sql` (aditif: 1 tabel baru, 4 fungsi baru,
  1 policy, 1 baris `activity_log_sources`, 2 trigger pada tabel baru). Tidak mengubah tabel/fungsi lama, tidak ada grant global,
  tidak ada backfill. PR221 dan PR233 tidak punya migrasi.
- Nomor versi semula `20261027090000` bentrok dengan `20261027090000_private_report_promo_history_presets.sql` di main;
  sudah dipindah ke `20261027153000` dan dijaga tes (gagal pada kode lama + main, lulus sekarang).
- Urutan rilis yang disarankan (setelah giliran dari Wowo, tidak bersamaan dengan C04):
  1. Pastikan PR221 & PR233 di-update dengan main terbaru dan `Technical checks` hijau di GitHub (keduanya belum pernah
     menjalankan workflow karena dibuat sebelum workflow ada). Merge PR221 → PR233, lalu arahkan PR248 ke `main`, tunggu
     `Technical checks` hijau di head final.
  2. Catat titik backup/PITR database production sebelum migrasi.
  3. Terapkan **hanya** file migrasi A02 di atas (jangan `db push` massal bila migrasi C04 `20261026002100_promo_package_total_mode.sql`
     masih tertunda — itu akan ikut terpasang). Verifikasi: riwayat migrasi berisi `20261027153000` sekali; tabel RLS aktif;
     `anon` tanpa EXECUTE; `authenticated` hanya SELECT tabel + EXECUTE 4 fungsi; 2 trigger aktif.
  4. Merge PR248 (deploy aplikasi). Migrasi duluan aman untuk aplikasi lama (aditif). Bila aplikasi terlanjur jalan tanpa migrasi,
     layar gagal tertutup: "status belum dapat dimuat", form disembunyikan, tidak ada angka palsu.
  5. Komentar pasca-deploy di PR248 sesuai AGENTS.md.
- Rollback: `docs/rollback/2026-10-27-a02-purchase-correction-requests.sql` (belum dijalankan di target). Langkah 1 membekukan
  pembuatan/pemrosesan dan menyimpan semua request + log; diuji di database sementara. Langkah 2 (hapus total) dikomentari dan
  menolak jalan bila ada request nyata.
- Catatan: fungsi lama `reset_simulasi_barang_dan_stok` tidak diperluas untuk tabel ini (sama seperti tabel request lain
  yang ditambahkan setelahnya); FK default akan menahan reset bila ada request.

## Verifikasi (main terakhir `906bc98`, data uji fiktif saja)

### Lulus
- SQL A02 (PostgreSQL 16.15 sementara, socket lokal, dihapus setelahnya; seluruh migrasi repo + main):
  `purchase_correction_requests.sql` lulus (lifecycle pending→selesai, idempotensi, tautan asal, pemroses/catatan,
  pelacakan pemohon, isolasi STAFF/ADMIN/FINANCE/cabang lain/OWNER nonaktif, tulis langsung ditolak,
  PO/faktur/jurnal/pembayaran tidak berubah, log A01 tanpa teks bebas); 0 baris tersisa; rollback langkah 1 diuji.
  Perintah: `python3 docs/evidence/2026-10-27-a02-correction-requests/run-native-pg.py scripts/test-purchase-correction-requests-postgres.py`
  (Docker: `python3 scripts/test-purchase-correction-requests-postgres.py`).
- Regresi SQL terkait lulus dan identik main vs main+A02: `purchase_invoice_lifecycle`, `purchase_short_close`,
  13 suite PASS di `test-activity-audit-postgres.py`.
- Gabungan main `906bc98` + PR221/233/248: `npm run lint` 0 error (12 warning lama), `npm test` 508 berkas / 3.717 tes lulus
  (1 skip bawaan main), `tsc --noEmit` lulus.
- Tes pengaman versi migrasi: gagal pada kode A02 lama + main (bentrok `20261027090000` terdeteksi), lulus setelah dipindah.
- Bukti build main murni di GitHub: Technical checks run 40440914658 pada `906bc98` sukses.

### Kegagalan baseline (sama persis di main murni; bukan dari A02)
- `test-activity-audit-postgres.py`: 6 suite gagal identik di main murni dan main+A02 (`activity_audit_framework` batas
  "179 sumber" yang belum mengikuti sumber refund, `activity_audit_financial/inventory/remaining_modules`,
  `posted_sale_cancellations`, `purchase_payment_corrections`).
- Lewat runner umum (tanpa prasyarat runner khususnya): `po_price_after_advance`, `promo_package_total` gagal identik di main.
- `npm run build` lokal kehabisan memori (heap Node) di sandbox ini, **juga pada main murni** `906bc98`; tidak diulang dan
  tidak diakali (tidak menaikkan batas/menambah resource).

### Masih ditunggu
- Technical checks GitHub pada **head final PR248** (termasuk build): workflow hanya berjalan untuk PR ke `main`; PR248
  berbasis cabang PR233 sehingga belum ada run. Akan tersedia setelah PR221 → PR233 masuk dan PR248 diarahkan ke `main`.
- PR221 dan PR233 belum pernah punya run Technical checks (dibuat sebelum workflow ada); perlu update dengan main agar jalan.
- UAT pengguna: ditunda sesuai arahan.
