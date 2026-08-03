# Sisa Pembelian — dokumen penerimaan, uang muka, perintah pembayaran

Tanggal: 2026-08-03 · Status: dipilih boss (opsi A, 2026-08-03)

## Masalah

Tiga tile Accurate di modul Pembelian masih kosong, dan ketiganya soal kontrol uang keluar.

1. **Penerimaan Barang bukan dokumen.** Penerimaan bertahap sebenarnya sudah jalan, tapi
   jejaknya cuma satu angka kumulatif di baris PO. Tidak ada nomor dokumen, tidak ketahuan
   kiriman mana datang kapan dan diterima siapa, dan **barang rusak tidak punya tempat**:
   pilihannya cuma "terima" (masuk stok padahal rusak) atau "tidak terima" (klaim ke pemasok
   hilang jejak).
2. **Uang Muka Pembelian tidak ada.** DP ke pemasok dicatat sebagai kas keluar biasa —
   terlihat seperti beban padahal itu hak tagih. Saat fakturnya datang, hutang tercatat penuh
   seolah belum dibayar sepeser pun.
3. **Perintah Pembayaran tidak ada.** Siapa pun yang bisa membuka layar hutang bisa langsung
   membayar. Tidak ada tahap diajukan → disetujui → dibayar, jadi tidak ada jejak siapa yang
   menyetujui pengeluaran.

## Rancangan

### Fase 1 — Dokumen Penerimaan Barang (migrasi 0093)

| Tabel baru | Isi |
|---|---|
| `goods_receipts` | no_terima `TB.YYYY.MM.NNNNN`, po_id, tanggal, surat jalan pemasok, catatan, lampiran, penerima |
| `goods_receipt_items` | potret qty pesan & sisa sebelum, qty diterima baik, qty rusak, harga, catatan per baris |

`purchase_order_items` dapat `qty_rusak` (akumulasi) supaya sisa yang ditunggu tidak perlu
menjumlah ulang seluruh dokumen.

Aturan yang dikunci di `src/lib/penerimaan.ts` (murni, teruji):

- Hanya **qty diterima baik** yang masuk stok dan dijurnal (Dr Persediaan / Cr Hutang Belum
  Difakturkan). Barang rusak tidak menambah persediaan dan tidak menambah hutang.
- **Barang rusak tidak memotong sisa pesanan** — pemasok masih berhutang kiriman pengganti.
  Kalau rusak ikut memotong, sisa kiriman hilang diam-diam dan tidak akan pernah ditagih.
- Total yang datang (baik + rusak) dibatasi qty pesanan.

Layar: kolom rusak & keterangan di form terima, daftar `/pembelian/penerimaan`, dan tanda
terima yang bisa dicetak lengkap dengan kolom tanda tangan.

### Fase 2 — Uang Muka Pembelian (migrasi 0094 & 0095)

Akun baru **1303 Uang Muka Pembelian**. Tabel `purchase_advances` menyimpan nomor
`UM.YYYY.MM.NNNNN`, pemasok, PO (opsional), nominal, dan berapa yang sudah terpakai — dipisah
supaya satu uang muka bisa dipakai bertahap ke beberapa pembayaran.

- Bayar DP → Dr 1303 / Cr rekening kas.
- Melunasi faktur dengan uang muka → Dr 2101 / **Cr 1303 sebesar porsi DP** / Cr kas sisanya.
  Porsi uang muka tidak menyentuh kas: uangnya sudah keluar waktu DP dibayar, menjurnalnya
  lagi berarti uang yang sama keluar dua kali.
- Batal hanya boleh selama belum terpakai, dan menghasilkan jurnal pembalikan.

Migrasi 0095 memindahkan kolom penanda dari `po_payments` ke `purchase_invoice_payments`:
`po_payments` ternyata jalur mati — hutang lahir dari faktur pemasok (migrasi 0056), dan
layar hutang membayar lewat faktur.

### Fase 3 — Perintah Pembayaran (migrasi 0096)

`payment_orders` (`PP.YYYY.MM.NNNNN`) + `payment_order_items` yang menunjuk faktur dan nominal.
Alur: **diajukan** (OWNER/ADMIN/FINANCE) → **disetujui** (OWNER/ADMIN) → **dibayar**.

- Faktur yang sudah masuk perintah bayar berstatus draft/disetujui **dikunci** dari daftar
  pengajuan berikutnya, supaya satu faktur tidak masuk dua perintah bayar dan terbayar dua kali.
- Saat eksekusi, sisa hutang dicek ulang — fakturnya bisa saja keburu dibayar dari layar
  hutang di antara persetujuan dan pembayaran.
- Pembayarannya tetap tercatat di tabel pembayaran faktur yang sama, jadi sisa hutang selalu
  dihitung dari satu sumber.

## Yang sengaja tidak dikerjakan

- Approval berjenjang (satu penyetuju saja, ikut pola cuti & pengajuan staf).
- Uang muka di dalam perintah bayar — sudah tersedia di layar pembayaran faktur.
- Retur otomatis untuk barang rusak; sekarang cuma dicatat sebagai dasar klaim.

## Uji

- Vitest: pembagian qty terima/rusak (batas sisa, rusak tidak memotong sisa, angka sampah),
  penomoran TB/UM/PP, jurnal uang muka & pembayaran campuran (harus seimbang, kas tidak keluar
  dua kali), penguncian sisa faktur oleh perintah bayar yang menunggu.
- Manual di browser: PO 10 pcs → terima 6 baik + 2 rusak (stok & jurnal cuma 6, status tetap
  Dipesan) → terima 4 sisanya (dokumen kedua) → faktur → bayar 800rb dengan uang muka 500rb
  (kas keluar 300rb) → sisa 1,3 jt lewat perintah bayar yang disetujui dulu.
