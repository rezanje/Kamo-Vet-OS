# 2026-11-01 — Insiden: petshop tidak bisa tutup shift

## Gejala
Malam 1 Nov (±21.08 WIB) kasir beberapa petshop menekan Tutup Shift dan ditolak dengan pesan
"Pembayaran masih diproses. Selesaikan transaksi sebelum menutup shift."

## Temuan (baca saja, produksi)
Penjaga tutup shift (`pos_shift_pending_checkout_guard`) menolak bila shift masih punya penjualan
dengan `payment_plan` terisi tapi `payments_finalized_at` kosong. Ada tiga baris seperti itu, satu per
cabang, semuanya shift yang masih terbuka:

| Struk | Jam (WIB) | Cabang | Total | Catatan |
|---|---|---|---|---|
| POS-20261101-0004-8GZC | 09.46 | Surken | 105.000 Tunai | pelanggan "diana"; tidak ditemukan struk pengganti |
| POS-20261101-0009 | 10.22 | Granada | 88.000 QRIS | pelanggan umum "andi"; pengganti tidak bisa dipastikan |
| POS-20261101-0004-VKDX | 13.09 | Bantarkemang | 35.000 Tunai | diulang jadi POS-20261101-0022-9GIK (16.09, barang & total sama) |

Ketiganya: baris barang ada, `sale_payments` & `pos_sale_postings` (jurnal kosong) ada, **tidak ada**
`stock_moves`, **tidak ada** `journal_entries`. Artinya checkout berhenti setelah menyimpan kepala +
baris, sebelum/selama `cashier_post_stock_atomic`, dan langkah pembersihan (`delete sales`) tidak
pernah jalan. Waktunya bertepatan dengan hari database lambat/hang (lihat
`2026-11-01-insiden-login-macet-database.md`, jatuh 11.16–12.36 WIB). Tiap kasir juga tidak
bertransaksi 2–4 jam sesudah struknya nyangkut — draf yang sama ditolak "Transaksi ini masih diproses".

## Akar masalah
Kalau proses checkout mati di antara "simpan kepala struk" dan "finalisasi atomik" (koneksi putus,
database hang, fungsi server kehabisan waktu), tidak ada jalur yang membuang struk setengah jadi itu.
Struknya menahan tutup shift selamanya, dan kasir tidak punya tombol apa pun untuk membereskannya.
Penghapusan juga hanya boleh oleh kasir pemilik struk (`pos_sale_cancel_pending`).

## Perbaikan (kode)
- `src/lib/transaksi-terputus.ts`: struk berencana-bayar yang belum final dan berumur ≥ 10 menit
  dianggap terputus. Jurnal/poin/pembayaran hanya ditulis finalisasi, jadi belum ada. **Stok belum
  tentu:** kasir (/kasir) dan backoffice berpromo kuantitas memotong stok di dalam finalisasi atomik,
  tetapi backoffice biasa (/pos/transaksi) memotong stok per baris *sebelum* finalisasi. Karena itu
  struk terputus hanya dibuang bila **tidak ada** `stock_moves` (source `sale`/`sale-group`,
  `source_ref` = no_struk); gagal baca = dianggap ada (gagal-tertutup). Struk yang sudah memotong stok
  dibiarkan supaya penjaga tetap menahan dan manusia merekonsiliasi dengan bukti utuh.
- `tutupShift` (satu pintu tutup shift petshop/backoffice) membuang struk terputus milik shift itu
  sebelum menghitung. Penghapusan lewat jalur yang sama dengan pembersihan checkout (pemicu DB tetap
  memeriksa kasir pemilik & tidak adanya jurnal). Yang gagal/tidak boleh dibuang tetap ditahan penjaga DB.
- Pesan penjaga diterjemahkan: kasir diminta tunggu ±10 menit lalu coba lagi, lalu lapor tim teknis
  (bukan Owner/Admin — mereka tidak punya jalan membersihkannya). Tutup paksa supervisor mendapat
  pesan sendiri: minta kasir pemilik laci menekan Tutup Shift.
- `resumePosCheckout`: percobaan terputus ≥ 10 menit dengan checkout key yang sama dibuang lalu
  checkout lanjut — **sebelum** pembandingan sidik draf, karena kasir sering mengganti metode bayar /
  uang diterima sebelum mencoba ulang (dulu tetap terkunci "Draft ini sudah digunakan…").
- `tutupShiftKasir` (/kasir/tutup) sekarang memeriksa pemilik laci seperti layar backoffice & klinik.
  Sebelumnya rekan satu cabang bisa menutup laci petshop orang lain lewat aksi ini, dan kas kurangnya
  menjadi kasbon pemilik laci.

## Hasil uji silang (5 sudut, tiap temuan diverifikasi pembantah)
12 dari 13 temuan bertahan; yang ditangani di PR ini: stok backoffice non-atomik (4 temuan sama),
draf yang diubah tetap terkunci (2), pesan tutup paksa/Owner (3, sebagian — lihat lanjutan),
pemilik laci di /kasir/tutup (1).

## Lanjutan (belum dikerjakan, perlu migrasi / di luar insiden)
1. ~~**Tutup paksa supervisor** tetap tertahan bila kasir pemilik laci tidak bisa masuk lagi~~ —
   dikerjakan di migrasi `20261106030000_tutup_paksa_buang_transaksi_terputus.sql` (lihat bagian
   "Tutup paksa membersihkan transaksi terputus" di bawah). Berlaku di Production setelah migrasi
   itu dipasang.
2. **Backoffice /pos/transaksi non-atomik**: pindahkan potong stok + finalisasi ke satu RPC seperti
   `cashier_post_stock_atomic`. Ini juga menutup kebocoran lama di jalur gagal eksplisit
   (hapus kepala struk sesudah sebagian stok keluar).
3. KPI dasbor "Grooming hari ini – Kasir" (`src/lib/grooming-kasir.ts`) ikut menghitung struk yang
   belum final; samakan dengan pembaca lain (`isCompletedSale`).

## Pembersihan manual produksi (1 Nov 2026 ±22.20 WIB, atas persetujuan Reza)
- Cadangan lengkap sebelum hapus: `docs/evidence/2026-11-01-tutup-shift-tertahan/backup-sebelum-hapus.json`
  (3 sales, 6 sale_items, 3 sale_payments, 3 pos_sale_postings; stock_moves & journal_entries kosong;
  semua anak RESTRICT = 0).
- Uji kering dulu (`begin … rollback`), lalu tiap struk dihapus dalam transaksinya sendiri lewat
  Management API dengan `set local role authenticated` + `request.jwt.claims.sub` = kasir pemilik struk,
  supaya RLS dan pemicu `pos_sale_cancel_pending` / `unit_posted_sale_source_immutable` tetap berlaku
  persis seperti pembersihan checkout. Syarat hapus: belum final, `payment_plan` terisi, kasir cocok,
  tanpa jurnal, tanpa stock_moves.
- Hasil: 0 sisa baris; 0 penjualan belum-final di seluruh produksi. Shift Surken, Granada,
  Bantarkemang tetap `open` dan bisa ditutup kasirnya.
- **Catatan audit:** di Riwayat Aktivitas, penghapusan tercatat atas nama kasir masing-masing
  (Raidika 22:20:04, Dimas 22:20:05, Subhan 22:20:07) karena identitas kasir dipakai untuk melewati
  pemicu. Yang menjalankan adalah agen (Claude) atas instruksi pemilik, bukan kasirnya.

| Struk | Barang tercatat |
|---|---|
| POS-20261101-0004-8GZC (Surken) | Catto 50gr Tuna 1 × 10.000; Delijoy Pouch Tuna 1 × 10.000; **sisa 85.000 tidak tersimpan** |
| POS-20261101-0009 (Granada) | Cat Choize Kitten 1 × 30.000; Cat Choize Tuna adult 2 × 20.000 (promo −2.000); Bolt Ikan 800gr 1 × 20.000 |
| POS-20261101-0004-VKDX (Bantarkemang) | ANC Cat Litter 5,5L Coffee 1 × 35.000 (sudah diulang: POS-20261101-0022-9GIK) |

## Sisa
- Surken (105.000 tunai, "diana") dan Granada (88.000 QRIS) perlu dicek manual oleh toko: kalau
  barang/uangnya diterima tapi transaksi tidak diulang, stok dan laci selisih — transaksi perlu diinput ulang.

## Tutup paksa membersihkan transaksi terputus (migrasi 20261106030000)
Tujuan: laci yang kasirnya tidak bisa masuk lagi tidak pernah terkunci permanen, tanpa perlu
menyamar sebagai kasir seperti pembersihan manual 1 Nov.

- `cashier_shift_supervisor_close` — sesudah semua pemeriksaan lama (Owner/Admin aktif, cabang,
  laci > 24 jam, bukan laci sendiri, alasan) dan kunci baris laci, setiap penjualan
  `payment_plan` terisi + `payments_finalized_at` kosong di laci itu dikunci lalu dipilah:
  - **berumur < 10 menit** → ditolak: "transaksi … masih diproses (belum 10 menit). Tunggu 10 menit
    lalu tutup paksa lagi";
  - **punya jejak efek** → ditolak: "… stok atau pembukuannya sudah sempat tercatat … laporkan nomor
    struk ini ke tim teknis KAMO". Jejak = `journal_entries.source_ref` = no_struk (sumber apa pun),
    jurnal di `pos_sale_postings`, `stock_moves.source_ref` = no_struk (sumber apa pun) atau
    `stock_moves.sale_line_id` milik barisnya, atau anak RESTRICT/NO ACTION (`sale_line_pricing`,
    `sale_staff_effects`, `sale_cancellations`, `sale_cancellation_requests`, `sales_returns`,
    `sales_return_items`, `sales_refund_requests`, `sales_refund_payouts`, `sale_payment_refunds`,
    `sale_payment_correction_gate/_requests`, `sale_payment_corrections`). Tanpa no_struk juga ditolak
    (gagal-tertutup). Lebih ketat dari pembersihan aplikasi (yang hanya melihat stok `sale`/`sale-group`);
  - **sisanya** dibuang. Penolakan bersifat **utuh**: bila satu struk saja ditolak, tidak ada yang
    dibuang dan laci tetap terbuka.
- Penghapusan memakai penanda transaksi-lokal `kamo.supervisor_pending_cleanup` = id laci
  (`set_config(..., true)`, dipulihkan sesudahnya — pola sama dengan `kamo.opname_cancel`).
  `pos_sale_cancel_pending` menerima penghapusan bukan-kasir hanya bila penanda itu = `shift_id`
  struk **dan** pelakunya Owner/Admin aktif yang memegang cabangnya. Penolakan jurnal tetap. RLS
  tidak diubah. Klien PostgREST tidak bisa memasang GUC bebas, dan tidak ada fungsi publik yang
  memasang GUC dengan nama dari masukan pengguna.
- Jejak: kolom baru `cashier_shift_supervisor_closures.removed_pending_sales` (id, no_struk,
  created_at, kasir, total, metode, rencana bayar, barang). Riwayat Aktivitas mencatat penghapusan
  atas nama **supervisor**, bukan kasir. Hasil RPC memuat `removed_pending_sales` (nomor struk);
  layar Shift Kasir menampilkannya dan meminta toko mengecek apakah perlu input ulang.
- Penguncian: kepala struk baru dan finalisasi mengunci baris laci (`pos_sale_assert_actor`), jadi
  selama tutup paksa memegang kunci itu tidak ada struk belum-final baru dan tidak ada yang mendadak
  final.
- Uji: `scripts/test-tutup-paksa-transaksi-terputus-postgres.py` (skema asli penuh, peran
  `authenticated`): 27/27 lulus dengan migrasi; tanpa migrasi (`--tanpa-perbaikan`) 10 gagal —
  tutup paksa ditolak "Pembayaran masih diproses", persis insiden.
