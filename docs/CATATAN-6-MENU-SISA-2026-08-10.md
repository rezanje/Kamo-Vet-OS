# Catatan: 6 menu sisa (Persediaan + kerapian dokumen)

Status: **ditunda 2026-08-10 atas keputusan bos.** Belum ada kode yang ditulis.
Dokumen ini menyimpan jawaban bos supaya tidak perlu ditanya ulang saat dilanjutkan.

## Jawaban bos (2026-08-10)

**1. Apakah ada proses menggabung beberapa barang jadi satu barang baru?**
Ya — **manufaktur produk own brand**, dan ini BEDA dari racik obat klinik.

> "Kalau ini bukan resep kayak di klinik. Ini buat bikin produk own brand. Biasa produk
> kita misal ada SKU plastik, SKU isi A dan SKU isi B masing-masing 500 dan diproses jadi
> SKU iCare 500 pcs dengan HPP gabungan dari resep tersebut. Kalau di resep lebih ke
> rakitan non-proses; stok memotong saat transaksi saja. Kalau ini kita ada menu dulu
> buat bikin (kayak manufacture)."

Artinya: butuh resep produksi (bill of materials) + dokumen produksi yang berdiri sendiri.
`/klinik/racik` TIDAK bisa dipakai ulang — itu potong stok saat transaksi, tanpa tahap produksi.

**2. Ada jeda antara bahan keluar dan barang jadi masuk?**
**Dua-duanya ada, tergantung produk.** → perlu 2 dokumen (Perintah Produksi → Penyelesaian)
+ akun penampung Barang Dalam Proses, DENGAN tombol pintas "langsung selesai" untuk produk
yang sekali jalan.

**3. Biaya selain bahan yang masuk modal produk jadi?**
**Tidak ada — bahan saja.** Modal produk jadi = total modal bahan terpakai ÷ jumlah hasil.
Tidak perlu kolom upah/overhead.

**4. Sejauh apa Desain Cetakan?**
**Cukup kop, logo, dan catatan kaki.** Bukan editor geser-geser posisi.

**5. Data perusahaan (logo/alamat/NPWP) sudah ada?**
**Belum, nanti menyusul.** → semua kolom dibuat opsional; yang kosong tidak dicetak.

## Rancangan yang sudah disepakati (tinggal 1 keputusan)

| Menu | Rencana |
|---|---|
| Perintah Produksi | Pilih resep + jumlah + gudang → bahan keluar, nilainya parkir di akun baru Barang Dalam Proses (usul kode **1302**, masih kosong di COA) |
| Penyelesaian Produksi | Catat hasil jadi → barang jadi masuk stok, modal = nilai bahan ÷ hasil; kekurangan hasil masuk 5902 Selisih Persediaan |
| Resep Produksi | Master baru: barang jadi + daftar bahan & takaran per 1 hasil |
| Penyesuaian Persediaan | Dokumen bernomor + alasan wajib (rusak/hilang/kadaluarsa/temuan); jurnal ke 5902 |
| Penomoran | Awalan, jumlah digit, dan periode reset per jenis dokumen; dibaca `lib/no-dokumen` |
| Preferensi + Desain Cetakan | Identitas perusahaan + catatan kaki + ukuran kertas; dipakai 6 layar cetak lewat satu komponen kop bersama |

**Keputusan yang BELUM diambil** — nasib koreksi stok cepat di `/pos/stok`:
A) dimatikan, semua lewat dokumen Penyesuaian · B) dua-duanya jalan · C) dipertahankan,
jurnalnya saja yang dibetulkan. (Saran: A.)

## Temuan yang muncul saat menelusuri — BELUM DIPERBAIKI

`src/app/(app)/pos/stok/actions.ts` — koreksi stok manual:

1. **Menambah stok membuat utang palsu.** Jurnalnya Dr 1301 Persediaan / **Cr 2101 Hutang
   Usaha**, padahal tidak ada pemasok yang ditagih. Hutang Usaha jadi menggelembung oleh
   koreksi gudang.
2. **Mengurangi stok tidak dijurnal sama sekali.** Stok fisik turun, nilai persediaan di
   buku besar tidak ikut turun — Neraca melebih-lebihkan nilai persediaan, dan kerugiannya
   tidak pernah muncul di Laba Rugi.

Keduanya hilang sendiri kalau menu Penyesuaian Persediaan dikerjakan (jurnal yang benar:
lawan akunnya 5902 Selisih Persediaan, bukan 2101). Kalau menu itu masih lama ditunda,
perbaiki jurnalnya lebih dulu secara terpisah — ini lubang uang yang aktif.
