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
| Rincian arus kas | 🔨 | ada ringkasannya; rincian per akun belum |
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
| Rincian pembayaran per bank | 🔨 | datanya ada di peta metode bayar, laporannya belum berdiri sendiri |
| Arus kas per akun | ⬜ | |

### Piutang
| Laporan | Status | Catatan |
|---|---|---|
| Faktur belum lunas / rincian piutang | ✅ | `/keuangan/piutang`, lengkap dengan umur piutang |
| Buku besar pembantu piutang | 🔨 | per pelanggan sudah ada; format buku besar pembantu belum |
| History piutang | 🔨 | |
| Penerimaan penjualan | ✅ | |

### Utang
| Laporan | Status | Catatan |
|---|---|---|
| Faktur belum lunas / rincian utang | ✅ | `/keuangan/hutang`, rinciannya bisa diklik ke PO & faktur |
| Buku besar pembantu utang | 🔨 | |
| History utang | 🔨 | |
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
| Pelanggan baru per cabang per periode | ⬜ |
| Pertumbuhan anggota member | 🔨 — golongan & strata sudah tercatat, grafik pertumbuhan belum |
| Rasio pelanggan baru vs lama per transaksi | ⬜ |

### Retensi
| Laporan | Status |
|---|---|
| Daftar pelanggan dorman (tidak transaksi > 90 hari, ambangnya bisa diatur) per cabang | ⬜ |
| Rata-rata interval kunjungan | ⬜ |

### Program & promo
| Laporan | Status |
|---|---|
| Voucher: diterbitkan, ditukarkan, redemption rate per program per cabang | ⬜ |
| Cashback/poin: terkumpul, ditukar, saldo | 🔨 — saldo & mutasi poin sudah tercatat, laporannya belum |
| Diskon: dipakai dan rasio terhadap target | ⬜ |

---

## C. Klinik

| Laporan | Status |
|---|---|
| Daftar kategori rawat inap, pet hotel, grooming | 🔨 — kategori tindakan sudah ada, laporannya belum |
| Daftar anamnesa / penyakit | ⬜ |
| Daftar kondisi: sembuh, kontrol, RIP | 🔨 — status tercatat per pasien, rekapnya belum |
| Daftar follow up: vaksin, grooming, kontrol lanjutan | 🔨 — `/klinik/follow-up` sudah ada, belum dipecah per jenis |

---

## D. Laporan dasar (ditanyakan "perlu ga?")

Perlu — ini yang paling sering dilihat harian dan paling murah dibuat:

| Laporan | Status |
|---|---|
| Jumlah pelanggan per hari | 🔨 — ada di dashboard operasional, belum jadi laporan |
| Rata-rata transaksi per pelanggan | ✅ per kasir; per cabang belum |
| Rata-rata item per invoice | ⬜ |
| Jumlah transaksi per cabang | ⬜ |

---

## Ringkasan & usulan urutan

Dari 45 laporan yang diminta: **19 sudah ada · 12 sebagian · 14 belum**.

Usulan garap:

1. **Laporan dasar + transaksi per cabang** — paling sering dipakai, datanya sudah lengkap,
   tinggal disajikan. Ini juga yang dua kali disebut di meeting 14 Agustus.
2. **Melengkapi yang tinggal sebagian** — buku besar pembantu piutang & utang, rincian arus
   kas, rekap kondisi klinik. Datanya sudah ada, tinggal bentuk laporannya.
3. **Marketing** — dorman, interval kunjungan, dan kinerja voucher. Ini yang paling
   mengubah cara kerja tim marketing, tapi butuh kesepakatan ambang (mis. dorman > 90 hari).
4. **Pembelian & tenaga penjual per dimensi** — pembelian per pemasok/barang, penjualan per
   penjual. Rapi tapi jarang dilihat harian.
