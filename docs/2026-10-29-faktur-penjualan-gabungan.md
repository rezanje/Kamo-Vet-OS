# Faktur Penjualan gabungan — catatan teknis

Tanggal: 29 Oktober 2026 · Layar: **Penjualan → Faktur Penjualan** (`/penjualan/faktur`)

Permintaan Andri: "Kenapa harus dipisah-pisah? Itu termasuk penjualan. Kenapa ga kaya
Accurate aja semua penjualan muncul di faktur penjualan, tinggal kita klik kita tau
isinya." Layar lama memecah penjualan jadi tiga seksi terpisah (tagihan klinik, faktur
reseller, "struk POS & online — bukan faktur"). Sekarang jadi satu daftar.

## Sumber data

| Sumber di layar | Tabel | Yang tidak ikut |
|---|---|---|
| Petshop | `sales` | `voided_at` terisi; rencana bayar yang belum diselesaikan (`payment_plan` terisi tapi `payments_finalized_at` kosong) |
| Klinik | `invoices` | `voided_at` terisi |
| Grosir | `sales_invoices` | `voided_on` terisi, `status = 'batal'`, dan faktur yang sudah ditunjuk `replaces_invoice_id` faktur lain (koreksi PR #309) |

Dokumen batal tetap bisa dimunculkan lewat centang **Tampilkan batal**; faktur grosir
yang sudah diganti faktur koreksi **tidak pernah** ikut, supaya nilainya tidak dihitung dua kali.

Struk marketplace/online tetap ada di tabel `sales`, jadi lencananya "Petshop" dengan
nama kanalnya ditulis di kolom Keterangan.

## Definisi angka Total

> Total = nilai dokumen apa adanya saat disimpan, **sudah termasuk pajak**, **sebelum retur**.

Retur penjualan tidak dikurangkan karena retur adalah dokumen tersendiri. Angka ini
sama dengan "omzet kotor" di laporan penjualan untuk filter yang sama:

* Petshop → `sales.total` (sama dengan yang dipakai Laporan Penjualan per Kasir sebagai omzet kotor)
* Klinik → `invoices.total`
* Grosir → `sales_invoices.total` (= `dpp + ppn`)

Pemeriksaan ke Production 29 Oktober 2026, rentang 1–31 Oktober 2026:
petshop 33 dokumen / Rp 3.259.500, klinik 11 / Rp 9.064.000, grosir 7 / Rp 10.525.000 →
**51 dokumen / Rp 22.848.500**. Bagian petshop + klinik (Rp 12.323.500) adalah angka yang
sama dengan laporan omzet lintas kanal sebelum retur; bagian grosir ditambahkan ke
laporan lewat cabang kerja `hermes/omzet-grosir` (berkas laporan tidak disentuh di sini).

Kartu "Belum lunas" memakai **nilai dokumen**, bukan sisa tagihan: faktur yang sudah
dibayar sebagian tetap dihitung penuh. Sisa tagihan sebenarnya ada di dokumennya.

## Cara halaman tetap ringan walau struknya ribuan

Pilihannya "jendela tanggal", bukan keyset:

1. Rentang tanggal adalah jendelanya (bawaan: bulan berjalan sampai hari ini).
2. Untuk jendela itu tiap sumber ditarik **sekali** dengan kolom kunci saja — id, nomor,
   tanggal, total, status, cabang, pelanggan — tanpa satu pun relasi. Pembacaannya lewat
   `readCompleteList`, jadi batas 1.000 baris per permintaan API tidak bisa memotong
   daftar diam-diam.
3. Ketiga hasil digabung sekali jalan (`gabungFaktur`, k-way merge; tiap sumber sudah urut
   dari databasenya) dengan urutan **tanggal terbaru → nomor terbesar → sumber → id**.
4. Dari gabungan itu: jumlah dokumen & total kaki daftar dihitung untuk **seluruh hasil
   saringan**, lalu 50 baris halaman yang diminta dipotong.
5. Nama pelanggan, nama cabang, dan keterangan baru diambil **untuk 50 baris itu saja**,
   dalam potongan maksimal 100 id per permintaan.

Beban per halaman karena itu tetap: satu tarikan kolom-kunci per sumber + satu tarikan
rincian per sumber, berapa pun halamannya. Jendela dibatasi **20.000 dokumen**; kalau
terlampaui pengguna diminta mempersempit tanggal, bukan disuguhi daftar yang terpotong.
Unduhan menarik rincian semua baris, jadi batasnya lebih ketat: **5.000 dokumen**.

Kalau suatu hari sebulan benar-benar melewati puluhan ribu dokumen, langkah berikutnya
adalah satu VIEW `union all` di database supaya urut, hitung, dan potong halaman
dikerjakan Postgres. Itu butuh migrasi, jadi sengaja **belum** dilakukan — pekerjaan ini
tidak menambah migrasi sama sekali.

## Saringan: mana yang di database, mana yang di aplikasi

Di database (menentukan besar jendela): rentang tanggal, cabang, sumber, pengecualian batal.
Di aplikasi (atas kolom kunci yang sudah ditarik): status, kotak cari, filter pelanggan.

Alasannya: status dibaca dari status tersimpan tiap dokumen (`sales.voided_at`,
`invoices.paid_status`, `sales_invoices.status`) dan dipetakan jadi Lunas / Belum Lunas /
Dibatalkan — menyaringnya di satu tempat menjamin kolom Status dan filternya selalu
sepakat. Nama pelanggan klinik tersimpan di tabel kunjungan, bukan di fakturnya, jadi
tidak ada satu kolom yang bisa dicari lintas sumber; yang dilakukan: nama dicocokkan
lebih dulu ke tabel `customers` (maksimal 2.000 nama; kalau menyentuh batas, pengguna
diberi tahu agar mengetik lebih lengkap), lalu id-nya dicocokkan ke baris. Nama pembeli
bebas pada struk marketplace (`sales.buyer_name`) ikut dicari.

Karakter `% _ , ( )` pada kotak cari dibersihkan (`amankanKueri`) supaya tidak merusak kueri.

## Hak akses

Halaman tetap milik modul `penjualan` — tidak ada perubahan peran. Pembatasan cabang
memakai `allowedBranchIds` seperti daftar/laporan lain: peran lintas cabang melihat semua,
peran bercabang hanya cabang penempatannya (klinik lewat `visits.branch_id`). Memilih
cabang di filter tidak bisa menembus batas itu, dan dropdown cabang hanya memuat cabang
yang boleh dibaca. Unduhan memakai klien pengguna yang sama, jadi tidak pernah melihat
lebih banyak daripada layarnya.

## Yang tetap seperti sebelumnya

* Tombol **+ Faktur Penjualan baru** (grosir) dan form **Penerimaan** per baris grosir.
* Kolom Aksi: **Edit** untuk faktur grosir yang masih berjalan, **Lihat** untuk sumber lain.
* Seksi **Kredit pelanggan dari koreksi grosir**.
* Tautan **Lihat rincian HPP** — sekarang tersedia untuk ketiga sumber, bukan hanya grosir
  (halaman `/keuangan/buku-besar/hpp/<nomor>` memang sudah mengenali nomor struk dan
  nomor tagihan klinik).

## Yang hilang dari layar lama

Kolom **Sisa** pada seksi klinik dan grosir. Daftar gabungan menampilkan Status dari status
tersimpan dokumennya, bukan hitungan ulang dari baris penerimaan; sisa tagihan yang pasti
ada di halaman dokumennya (dan di form Penerimaan yang masih ada di baris grosir).
`src/lib/sales-channel-trace.ts` ikut dihapus karena pemakainya tinggal daftar ini.
