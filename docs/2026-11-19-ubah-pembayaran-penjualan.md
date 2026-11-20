# Ubah pembayaran penjualan satu langkah (19 Nov 2026)

Permintaan Mba Anisa (finance) via Reza — video WA 19 Nov 2026 bagian akhir: di Accurate, penerimaan penjualan dibuka lalu
tanggal/metode/nilai diubah langsung. Di KAMO harus dua langkah ("Batalkan penerimaan" → struk belum dibayar → "Terima pembayaran").
Keputusan Reza (opsi A): mulai dari **ubah pembayaran** (tanggal bayar + pembagian metode). Isi struk/diskon tetap lewat
"Ubah transaksi" yang sudah ada.

## Yang berubah

### Database — `supabase/migrations/*_ubah_pembayaran_penjualan.sql`

`change_pos_sale_payment(p_sale_id, p_expected_revision, p_request_key, p_reason, p_plan, p_effective_date)`:

- Satu transaksi database = `cancel_pos_sale_receipt` + `receive_pos_sale_payment` (fungsi resmi yang sudah ada) dengan semua
  penjaganya (izin cabang / Akses Grup, tanggal mundur hanya Owner atau peran berizin, tutup buku, rekonsiliasi bank, fee merchant,
  retur/refund, laci shift, jumlah = total struk). Gagal di langkah mana pun → tidak ada yang tersimpan; struk tidak pernah
  tertinggal "belum dibayar".
- Penerimaan lama dibalik di **tanggal aslinya** (`pos_receipt_date_floor`) bila pelaku boleh tanggal mundur; kalau tidak, hari ini.
  Penerimaan baru di tanggal bayar pilihan (≥ tanggal pembayaran tercatat, ≤ hari ini).
- Tanpa perubahan (metode, jumlah, tanggal sama) ditolak. Alasan 3–980 huruf (alasan pembatalan diberi awalan "Ubah pembayaran: ").
- Idempoten lewat kunci turunan `<kunci>:batal` / `<kunci>:terima`; ulang kirim mengembalikan hasil yang sama.
- Akun per metode tetap mengikuti pemetaan cabang (sama dengan kasir). **Memilih rekening bank bebas per pembayaran belum termasuk.**

### Layar — detail penjualan kasir (`/penjualan/[id]`)

- Bagian bawah: **"Ubah pembayaran"** — tanggal bayar (hanya Owner/peran berizin tanggal mundur; bawaan = tanggal pembayaran tercatat),
  jumlah per metode (Tunai, Transfer, Debit, Kredit, QRIS, E-Wallet; terisi dari pembayaran sekarang), alasan, tombol
  "Simpan perubahan pembayaran" (aktif hanya bila seimbang dan ada perubahan).
- Muncul untuk yang boleh Batalkan penerimaan, struk kasir terbayar, tanpa fee merchant, tanpa retur aktif. Untuk mereka form lama
  "Koreksi metode" (tunai↔transfer) disembunyikan karena sudah tercakup. Batalkan penerimaan / penjualan tetap ada.

## Tes

- `scripts/test-ubah-pembayaran-penjualan-postgres.py` — 458 migrasi dari nol + fixture `backdate_petshop.sql` +
  `supabase/tests/ubah_pembayaran_penjualan.sql`: ganti metode + tanggal (pembalik di tanggal asli, baru di tanggal pilihan),
  isi struk/stok/HPP/jurnal penjualan/poin tidak berubah, ulang kirim tanpa jurnal baru, kunci sama isian beda ditolak, tanpa perubahan /
  tanggal sebelum pembayaran / jumlah ≠ total / masa depan / alasan pendek ditolak tanpa jejak, ganti tanggal saja, split + diubah lagi,
  kasir tanpa izin ditolak, struk yang sedang belum dibayar diarahkan ke Terima pembayaran, neraca nol per cabang per tanggal.
  GREEN lulus; `--baseline` gagal.
- Vitest: `sale-payment-edit-form`, `ubah-pembayaran-actions`, penyesuaian `sale-receipt-cancel-page` & `sale-backdate-page`.
  Seluruh suite 9851 lulus. `tsc`, ESLint (file diubah), `next build` lulus.

## Sisa

- Pilih rekening bank per pembayaran (seperti kolom "Bank" di Accurate).
- Belum diuji dengan transaksi sungguhan di Production (UAT finance).
