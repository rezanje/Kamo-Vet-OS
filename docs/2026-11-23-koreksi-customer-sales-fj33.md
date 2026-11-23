# Ganti customer & tenaga penjual faktur FJ.2026.11.00033 (23 Nov 2026)

**Permintaan:** user klinik (via Reza): faktur penjualan FJ.2026.11.00033 customernya harus Exa Vet
(08892019661) dan tenaga penjualnya drh Rais Hamidy. Saat input, keduanya tertukar: customer diisi
"drh Rais Hamidy", tenaga penjual Anisa. Fitur edit faktur di aplikasi baru bisa mengubah qty dan harga.

**Keputusan Reza:** nomor 08892019661 sudah terdaftar atas nama "Dzikry", jadi customer itu diganti namanya
menjadi "Exa Vet" (bukan bikin customer baru).

**Kondisi sebelum:**
- sales_invoices `a8b7a045-a5a7-44de-9bca-c218321f2787` (FJ.2026.11.00033, Rp 135.000, berjalan, belum ada
  penerimaan), customer `654e2ede-…` (drh Rais Hamidy);
- sales_orders `25d5478f-…` (SO.2026.11.00037), customer sama, salesperson `fe364947-…` (ANISA);
- customers `c14b9a5e-f3c7-4ec7-92b1-2721654b17bd` bernama "Dzikry", telp 08892019661.

**Yang diubah (satu blok DO, tiap UPDATE dicek tepat 1 baris dan kondisi lama harus cocok):**
1. customers `c14b9a5e-…`: name Dzikry → Exa Vet;
2. sales_invoices `a8b7a045-…`: customer_id → `c14b9a5e-…`;
3. sales_orders `25d5478f-…`: customer_id → `c14b9a5e-…`, salesperson_id → `da312304-3b9e-4d26-93fe-1148a3e733ce`
   (DRH RAIS HAMIDY, karyawan aktif).

**Tidak berubah:** total, barang (Hematologi - Kolega 1 × 135.000), surat jalan DO.2026.11.00033, jurnal
JRN-202611-23726 (jurnal tidak menyimpan customer). Faktur grosir tidak memberi poin; tidak ada baris
point_ledger untuk faktur ini, jadi poin/total belanja tidak perlu dipindah.

**Verifikasi setelah apply:** faktur & pesanan sama-sama customer Exa Vet (08892019661), tenaga penjual
DRH RAIS HAMIDY, status berjalan, total 135.000.

**Rollback:**
```sql
update customers set name='Dzikry' where id='c14b9a5e-f3c7-4ec7-92b1-2721654b17bd';
update sales_invoices set customer_id='654e2ede-9f48-42f3-910b-10bceaf4679e' where id='a8b7a045-a5a7-44de-9bca-c218321f2787';
update sales_orders set customer_id='654e2ede-9f48-42f3-910b-10bceaf4679e', salesperson_id='fe364947-5df3-4be0-8b60-5fb864ea1689'
 where id='25d5478f-6f69-4878-96e2-edc06abd1bf0';
```

**Celah produk (belum dikerjakan):** edit faktur penjualan belum bisa mengganti customer dan tenaga penjual.
