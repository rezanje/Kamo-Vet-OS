# A02 — permintaan koreksi pembelian tersimpan + antrean/notifikasi

Stack: PR221 (approval read fail-closed) → PR233 (dashboard pending work) → PR ini.
Base kode: head PR233 `69f193984807baa9fa2483df8ea5aa494b505064`. Main saat diperiksa:
`0aea0979db5f969542ab723c505c319b252ead57`; gabungan head PR ini dengan main bersih (tanpa konflik)
dan migration baru berurutan setelah migration terakhir main (`20261026100000_k02_procedure_bmhp.sql`).

Tidak ada deploy preview, penulisan production, atau perubahan Sheet. Sheet checklist hanya dibaca.

## Aturan yang dipakai (sudah ada, tidak dikarang)

| Aturan | Sumber |
|---|---|
| Koreksi pembelian oleh peran berwenang; staf/supervisor **melaporkan atau meminta** koreksi, bukan mengubah sendiri. Role terbatas "tahu alur meminta koreksi". | Checklist P01 kolom Tindak lanjut & Kriteria selesai |
| Peran berwenang saat ini = Super Admin (`OWNER` aktif): semua kontrol koreksi PO/faktur/pembayaran dan RPC pembatalan memeriksa `role='OWNER' and is_active`. | `src/app/(app)/pembelian/[id]/page.tsx`, `faktur/[id]/page.tsx`, migration `20261021004732`, `20261023022600` |
| Panduan non-owner sebelumnya: "Sampaikan kepada Super Admin", tanpa request tersimpan. | PR198 (main) |
| A02: daftar pending yang bisa ditindaklanjuti dan dilacak status; bedakan dari toast sukses/gagal; kaitkan request ke dokumen asal dan role penanggung jawab. Kanal WhatsApp belum diputuskan. | Checklist A02 |
| Akses modul Pembelian mengikuti Akses Grup (`role_modules`), bawaan FINANCE/STAFF tanpa Pembelian. | `src/lib/akses.ts` |

## Yang dibangun

- Tabel `purchase_correction_requests` (migration `20261027090000_purchase_correction_requests.sql`):
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

## Keputusan yang masih diperlukan (tidak dikarang)

1. Apakah ADMIN/FINANCE perlu **melihat** (tanpa memproses) antrean koreksi pembelian milik orang lain? Saat ini tidak.
2. Apakah perlu status **ditolak** terpisah, atau cukup "Sudah diproses" + catatan alasan (saat ini)?
3. Apakah pemohon boleh **membatalkan** request yang masih menunggu? Saat ini tidak ada pembatalan.
4. Pemetaan "manajer/super admin" (P01): bila manajer selain OWNER boleh memproses, itu perubahan role yang harus diputuskan dulu.
5. Kanal notifikasi luar aplikasi (WhatsApp, dll.).

## Migration & rollback

- Satu migration baru, **belum diterapkan** ke database mana pun selain database uji sementara. Terapkan sebelum/bersama
  rilis aplikasi ini; tanpa migration, halaman detail menampilkan "status belum dapat dimuat" dan form disembunyikan,
  antrean menampilkan error, dashboard OWNER menampilkan "status belum dapat dimuat" — tidak ada angka palsu.
- Rollback: sembunyikan UI (revert aplikasi). Jangan menghapus tabel berisi request nyata tanpa ekspor; bila belum ada data,
  `drop function` dua RPC + dua helper, hapus baris `activity_log_sources`, `drop table`.
- Catatan: fungsi lama `reset_simulasi_barang_dan_stok` tidak diperluas untuk tabel ini (sama seperti tabel request lain
  yang ditambahkan setelahnya); FK default akan menahan reset bila ada request.

## Verifikasi

- SQL: `python3 docs/evidence/2026-10-27-a02-correction-requests/run-native-pg.py scripts/test-purchase-correction-requests-postgres.py`
  → PostgreSQL 16.15 sementara (socket lokal, dihapus setelahnya), seluruh migration repo + main, suite lulus, 0 baris tersisa.
  Runner Docker yang sama: `python3 scripts/test-purchase-correction-requests-postgres.py`.
- Lihat laporan PR untuk hasil vitest, lint, typecheck, build, dan Technical checks.
