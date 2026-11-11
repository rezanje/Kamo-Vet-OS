# Dashboard Operation & Sales — cabang vs bulan lalu (11 Nov 2026)

Permintaan Mas Mai (via Reza): di dashboard data, per cabang, dibanding tanggal yang sama bulan lalu
(mis. 15 Nov vs 15 Okt) supaya kelihatan tumbuh atau turun:

1. rata-rata transaksi petshop
2. rata-rata transaksi klinik
3. jumlah customer & jumlah transaksi petshop (berjalan)
4. jumlah customer & jumlah transaksi klinik (berjalan)
5. jumlah grooming
6. nilai stok petshop (HPP)
7. nilai stok klinik (HPP)

## Letak

`/laporan/operasional-penjualan` (Laporan → OPERATION & SALES), bagian baru **03 · CABANG vs BULAN LALU**,
tepat di bawah Branch Performance. Bagian sesudahnya bergeser nomor (04 Customer … 07 Clinic & Service).
Tiap sel: angka periode ini, "bln lalu …", lalu ▲/▼ persen. "baru" = bulan lalu nol.

## Aturan periode

- Rentang filter dashboard (preset Bulan berjalan / Hari ini / Custom) dibanding rentang yang sama bulan lalu:
  1–11 Nov ↔ 1–11 Okt; hari ini 15 Nov ↔ 15 Okt.
- Tanggal yang tidak ada di bulan lalu jatuh ke akhir bulan (31 Mar ↔ 28/29 Feb). Akhir bulan ↔ akhir bulan
  (1–30 Nov ↔ 1–31 Okt). Kode: `src/lib/perbandingan-cabang.ts` (`samaTanggalBulanLalu`).
- Filter cabang dihormati; filter kanal **tidak** (blok ini selalu petshop + klinik).

## Definisi angka

| Angka | Sumber | Catatan |
|---|---|---|
| Petshop: transaksi, rata-rata, customer | `sales` (kasir + online), struk selesai (`isCompletedSale`) | Neto setelah retur & tanpa biaya merchant — sama dengan blok Sales/Laporan Transaksi. Grosir/reseller tidak masuk. |
| Klinik: transaksi, rata-rata, customer | `invoices` tidak batal, cabang dari kunjungan | Neto setelah refund klinik; tanggal = tanggal tagihan. |
| Customer | customer_id berbeda yang bertransaksi | Transaksi tanpa pelanggan tidak dihitung. Baris Total = unik lintas cabang. |
| Grooming | kunjungan poli `%grooming%` (tidak diarsipkan, semua status) + qty jasa Grooming di kasir (struk tidak batal) | Aturan sama dengan kartu "Grooming hari ini" di Dashboard Operasional. |
| Nilai stok petshop | gudang RETAIL + ONLINE | DC, EXPIRED, TRANSIT tidak dihitung. |
| Nilai stok klinik | gudang VET | |

Dokumen penjualan periode berjalan dibaca sekali dan dipakai bersama blok Sales/Branch bila kanal = Semua kanal.

## Nilai stok tanggal lampau

Sistem hanya menyimpan nilai persediaan *saat ini* (sisa lapisan FIFO, atau qty × HPP rata-rata bila metode
rata-rata aktif) — sama persis dengan laporan Nilai Persediaan. Nilai akhir hari tanggal D dihitung mundur:

    nilai(D) = nilai sekarang − Σ (qty × unit_cost + valuation_adjustment) mutasi kartu stok bertanggal > D

Batasan (ditulis juga di bawah tabel): bisa sedikit beda dari angka sebenarnya bila ada stok minus pada periode
itu (keluar tanpa lapisan), atau mutasi dengan tanggal default server di jam 00–07 WIB. Hanya mutasi sesudah
tanggal pembanding yang dibaca (per gudang, berhalaman lengkap).

Hak lihat: nilai stok hanya dihitung & ditampilkan untuk OWNER/FINANCE aktif (aturan yang sama dengan link
Nilai Persediaan). Peran lain tetap melihat tabel penjualan/grooming.

## Tes

- `src/lib/__tests__/perbandingan-cabang.test.ts` — aturan tanggal, pertumbuhan, rekap per cabang, nilai stok mundur.
- `src/lib/__tests__/operation-sales-server.test.ts` — blok perbandingan end-to-end (struk, tagihan, grooming,
  rentang bulan lalu, bacaan bersama) dan nilai stok FIFO mundur.
- `src/lib/__tests__/operation-sales-inventory-access.test.ts` — nilai stok hanya tampil untuk OWNER/FINANCE aktif.

## Belum dicek

Angka live di Production belum dicocokkan dengan data nyata (perlu login Owner setelah deploy).
