# Daftar laporan yang diminta Kamo Group — 24 Agustus 2026

Ini jawaban atas M40 yang selama ini menunggu klien. Dikirim Pak Aldi lewat WhatsApp,
disalin apa adanya lalu ditandai status pengerjaannya.

Status: `✅ sudah ada` · `🔨 sebagian` · `⬜ belum`

---

## A. Finance

### Keuangan
| Laporan | Status | Catatan |
|---|---|---|
| Laba rugi | ✅ | `/keuangan/laba-rugi`, tiap akun bisa diklik ke buku besarnya |
| Neraca | ✅ | `/keuangan/neraca` |
| Arus kas | ✅ | `/keuangan/arus-kas` |
| Rincian arus kas | ✅ | `/keuangan/arus-kas/rincian` — per rekening kas & bank, lengkap saldo berjalan |
| Laba ditahan | ⬜ | terbentuk saat tutup buku, belum ada layar laporannya |

### Buku besar
| Laporan | Status | Catatan |
|---|---|---|
| Keseluruhan jurnal | ✅ | `/keuangan/jurnal`, sudah ada filter & kolom cabang |
| Rincian buku besar | ✅ | `/keuangan/buku-besar` |
| Rincian jurnal akun | ✅ | dari Laba Rugi / Neraca, klik akunnya |

### Kas & bank
| Laporan | Status | Catatan |
|---|---|---|
| History bank | ✅ | `/kas-bank/rekening` per rekening |
| Transaksi terekonsiliasi & belum | ✅ | `/keuangan/rekonsiliasi` |
| Rincian pembayaran per bank | ✅ | `/keuangan/arus-kas/rincian` — tiap rekening bisa dibuka rinciannya |
| Arus kas per akun | ✅ | `/keuangan/arus-kas/rincian` |

### Piutang
| Laporan | Status | Catatan |
|---|---|---|
| Faktur belum lunas / rincian piutang | ✅ | `/keuangan/piutang`, lengkap dengan umur piutang |
| Buku besar pembantu piutang | ✅ | `/keuangan/piutang/pembantu` — saldo awal, mutasi, saldo akhir per pelanggan |
| History piutang | ✅ | `/keuangan/piutang/pembantu` — rincian tiap pelanggan bisa dibuka |
| Penerimaan penjualan | ✅ | |

### Utang
| Laporan | Status | Catatan |
|---|---|---|
| Faktur belum lunas / rincian utang | ✅ | `/keuangan/hutang`, rinciannya bisa diklik ke PO & faktur |
| Buku besar pembantu utang | ✅ | `/keuangan/hutang/pembantu` |
| History utang | ✅ | `/keuangan/hutang/pembantu` |
| Rincian pembayaran pembelian | ✅ | |

### Pembelian
| Laporan | Status | Catatan |
|---|---|---|
| Pembelian per pemasok | ⬜ | |
| Pembelian per barang | ⬜ | |
| Uang muka pembelian | ✅ | `/pembelian/uang-muka` |
| Rincian pesanan pembelian | ✅ | `/pembelian` |
| Rincian penerimaan barang | ✅ | `/pembelian/penerimaan` |
| Rincian faktur pembelian | ✅ | `/pembelian/faktur` |

### Aset tetap
| Laporan | Status | Catatan |
|---|---|---|
| Daftar aset tetap | ✅ | `/keuangan/aset` |
| History aset | ✅ | riwayat perubahan nilai & umur per aset |
| Aset tetap per kategori | ✅ | `/keuangan/kategori-aset` |
| History lokasi aset | ✅ | jejak pindah cabang |
| Detail aset tetap | ✅ | |

### Tenaga penjual
| Laporan | Status | Catatan |
|---|---|---|
| Faktur belum lunas per penjual | ⬜ | |
| Laporan komisi per tenaga penjual | ✅ | `/penjualan/komisi` |
| Penjualan barang per penjual | ⬜ | |
| Faktur penjualan per penjual | ⬜ | |

---

## B. Marketing

### Akuisisi
| Laporan | Status |
|---|---|
| Pelanggan baru per cabang per periode | ✅ — `/laporan/akuisisi`, per cabang + per bulan |
| Pertumbuhan anggota member | ✅ — `/laporan/member`, per bulan + kumulatif + komposisi golongan & strata |
| Rasio pelanggan baru vs lama per transaksi | ✅ — `/laporan/akuisisi` seksi 03, per cabang |

### Retensi
| Laporan | Status |
|---|---|
| Daftar pelanggan dorman (tidak transaksi > 90 hari, ambangnya bisa diatur) per cabang | ✅ — `/laporan/retensi`, ambang bisa diubah + tombol WA |
| Rata-rata interval kunjungan | ✅ — `/laporan/retensi` seksi 01, lengkap sebarannya |

### Program & promo
| Laporan | Status |
|---|---|
| Voucher: diterbitkan, ditukarkan, redemption rate per program per cabang | ✅ — `/laporan/promo` seksi 01 |
| Cashback/poin: terkumpul, ditukar, saldo | ✅ — `/laporan/member`, termasuk nilai kewajiban poin |
| Diskon: dipakai dan rasio terhadap target | ✅ — `/laporan/promo` seksi 03, dipecah 4 jenis potongan + kolom target |

---

## C. Klinik

| Laporan | Status |
|---|---|
| Daftar kategori rawat inap, pet hotel, grooming | ✅ — `/laporan/rekap-klinik` seksi 01. Catatan: **Pet Hotel belum ada** sebagai kategori tindakan |
| Daftar anamnesa / penyakit | ⬜ |
| Daftar kondisi: sembuh, kontrol, RIP | ✅ — `/laporan/rekap-klinik` seksi 02 (stabil / kritis / sembuh / RIP) |
| Daftar follow up: vaksin, grooming, kontrol lanjutan | ✅ — `/laporan/rekap-klinik` seksi 03, dipecah per jenis × status |

---

## D. Laporan dasar (ditanyakan "perlu ga?")

Perlu — ini yang paling sering dilihat harian dan paling murah dibuat.
**Keempatnya selesai 25 Agustus 2026** lewat dua layar baru di Daftar Laporan:

| Laporan | Status | Ada di |
|---|---|---|
| Jumlah pelanggan per hari | ✅ | `/laporan/pelanggan-harian` — per hari, bisa disaring per cabang; hari sepi tetap muncul sebagai baris nol |
| Rata-rata transaksi per pelanggan | ✅ | `/laporan/transaksi-cabang` — per cabang dan total |
| Rata-rata item per invoice | ✅ | `/laporan/transaksi-cabang`, juga per hari di laporan harian |
| Jumlah transaksi per cabang | ✅ | `/laporan/transaksi-cabang`, dipecah POS / Online / Klinik |

Catatan angka yang perlu disepakati saat dibahas dengan klien:

- **Pembeli umum.** Struk yang identitasnya tidak dicatat dihitung satu orang per struk.
  Kalau orang yang sama belanja dua kali tanpa menyebut nama, dia terhitung dua orang.
- **Rata-rata kunjungan per pelanggan** sengaja hanya dihitung dari pelanggan berkartu.
  Kalau struk umum ikut, angkanya selalu mendekati 1x dan jadi tidak berarti.
- **Satu orang, dua cabang** dihitung di kedua cabang — jadi jumlah kolom per cabang
  bisa lebih besar dari total.
- **Omzet** sudah dikurangi retur penjualan; tagihan klinik yang dibatalkan tidak dihitung.

---

## Ringkasan & usulan urutan

Dari **50** laporan yang diminta: **43 sudah ada · 7 belum**
(per 25 Agustus 2026, setelah langkah 1, 2, dan 3 selesai).

> Koreksi: dokumen ini awalnya menyebut 45 laporan — salah hitung. Jumlah baris
> permintaannya 50. Angka di atas sudah dihitung ulang baris per baris.

Usulan garap:

1. ~~**Laporan dasar + transaksi per cabang**~~ — ✅ selesai 25 Agustus 2026.
   Paling sering dipakai, datanya sudah lengkap, tinggal disajikan. Ini juga yang
   dua kali disebut di meeting 14 Agustus.
2. ~~**Melengkapi yang tinggal sebagian**~~ — ✅ selesai 25 Agustus 2026. Semua yang tadinya
   setengah jadi sekarang punya layarnya sendiri: buku besar pembantu piutang & utang,
   rincian arus kas per rekening, rekap klinik, dan member & poin.
3. ~~**Marketing**~~ — ✅ selesai 25 Agustus 2026. Dorman, interval kunjungan, akuisisi,
   dan kinerja voucher/promo/diskon. Ambang dorman tidak jadi penghalang: bawaannya 90 hari
   dan bisa diubah langsung di layarnya.
4. **Pembelian & tenaga penjual per dimensi** — pembelian per pemasok/barang, penjualan per
   penjual. Rapi tapi jarang dilihat harian.

---

## Temuan saat laporan dibuat (25 Agustus 2026)

Tiga hal yang baru kelihatan setelah laporannya jadi. Bukan kesalahan program —
data yang perlu dirapikan klien:

1. **Jasa klinik belum digolongkan.** Enam baris jasa senilai Rp 75.000 masuk kategori
   "Jasa tanpa kategori". Selama kategorinya kosong, laporan per kategori tidak bisa
   memisahkan grooming, vaksinasi, dan konsultasi.
2. **Pet Hotel belum ada sebagai kategori tindakan.** Kategori yang tersedia: Konsultasi,
   Vaksinasi, Operasi, Grooming, Rawat Inap, Lab. Perlu ditambah kalau pet hotel dijual
   sebagai layanan tersendiri.
3. **5.000 poin tidak berasal dari transaksi mana pun.** Saldo poin di kartu pelanggan
   8.094, sementara riwayat transaksi hanya menjelaskan 3.094. Selisihnya kemungkinan
   saldo awal saat data dipindahkan. Tertulis terbuka di layar Member & Poin.

Saldo buku pembantu piutang dan hutang keduanya **cocok persis** dengan akun buku
besarnya — tidak ada dokumen yang lolos dari jurnal.

### Tambahan temuan saat laporan marketing dibuat

4. **Promo otomatis dulu tidak meninggalkan jejak.** Potongannya dihitung saat checkout lalu
   langsung dilebur ke kolom diskon; program mana yang kena tidak pernah disimpan. Sejak
   25 Agustus 2026 nilainya dicatat per baris struk (migrasi 0127), jadi laporan promo baru
   bisa terisi untuk transaksi setelah tanggal itu.
5. **Rupiah potongan voucher masih menyatu** dengan diskon transaksi. Jumlah pemakaian dan
   redemption rate sudah tepat; kalau nanti perlu rupiah voucher terpisah, itu perubahan
   berikutnya.
6. **Belum ada satu pun target penjualan tersimpan**, jadi kolom Capaian di laporan diskon
   masih kosong. Begitu target diisi di layar Target Penjualan, kolomnya terisi sendiri.
