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
1. **Tutup paksa supervisor** tetap tertahan bila kasir pemilik laci tidak bisa masuk lagi (resign,
   akun nonaktif): `cashier_shift_supervisor_close` tidak membersihkan, dan `pos_sale_cancel_pending`
   hanya mengizinkan kasir pemilik. Usulan: migrasi yang membuat fungsi supervisor membuang struk
   terputus (≥10 menit, tanpa jurnal, tanpa stock_moves, tanpa anak RESTRICT) memakai penanda
   transaksi-lokal (`set_config(..., true)`) yang diterima `pos_sale_cancel_pending`, dan mencatat
   struk yang dibuang di jejak audit tutup paksa.
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
