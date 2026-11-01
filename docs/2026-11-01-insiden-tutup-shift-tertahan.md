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
  dianggap terputus. Aman dibuang karena finalisasi atomik — belum ada stok/jurnal/poin/pembayaran.
- `tutupShift` (satu pintu tutup shift petshop/backoffice) membuang struk terputus milik shift itu
  sebelum menghitung. Penghapusan lewat jalur yang sama dengan pembersihan checkout (pemicu DB tetap
  memeriksa kasir pemilik & tidak adanya jurnal). Yang gagal dibuang tetap ditahan penjaga DB.
- Pesan penjaga diterjemahkan: minta tunggu ±10 menit lalu coba lagi.
- `resumePosCheckout`: draf yang sama dengan percobaan terputus ≥ 10 menit membuang struk lama lalu
  melanjutkan, tidak lagi terkunci "masih diproses".

## Sisa
- Ketiga struk di atas akan terbuang otomatis saat kasirnya menekan Tutup Shift sesudah rilis.
- Surken (105.000 tunai, "diana") dan Granada (88.000 QRIS) perlu dicek manual oleh toko: kalau
  uangnya diterima tapi transaksi tidak diulang, laci akan selisih lebih — transaksi perlu diinput ulang.
