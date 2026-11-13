# Rencana teknis P0 — A1, A2, A3 (meeting 12 Nov 2026)

Status: disetujui ("sesuai to-do list"). A1 selesai di kode; migrasi index ditulis, belum dipasang ke Production.
Branch kerja: `claude/epic-hypatia-raw2el` (dibuat dari `docs/meeting-2026-11-12`), PR ke `main`.
Satu item = satu commit (`A1: …`, `A2: …`, `A3: …`), centang TODO.md di commit yang sama.

---

## Temuan saat mempelajari repo

1. **Semua laporan langsung menarik data saat dibuka.** Halaman laporan adalah server component; begitu URL
   dibuka tanpa parameter, ia memakai default (umumnya awal bulan s/d hari ini, semua cabang) dan langsung query.
   Beberapa laporan keuangan (Laba Rugi, Buku Besar, Arus Kas) tanpa parameter malah membaca **seluruh periode**.
2. **Filter cabang kebanyakan diterapkan di memori, bukan di query.** Contoh `/laporan/penjual/data.ts`:
   semua baris `invoice_items`, `sale_items`, `sales_invoice_items` seluruh cabang ditarik (dipaginasi
   `readReportRows`), lalu disaring `cabang_id` di `saringAtribusi`. Pola yang sama ada di `penjualan-rinci`,
   `transaksi-cabang`, `operasional-penjualan`, `penjualan-kasir`, `pelanggan-harian`, `rekap-klinik`.
   Jadi memilih satu cabang hampir tidak mempercepat apa-apa.
3. **Tidak ada index tanggal pada tabel penjualan utama.** Index yang ada: `sales(branch_id)`, `visits(branch_id)`,
   `journal_entries(tanggal)`, `journal_entries(branch_id)`. **Tidak ada** index untuk `sales(created_at)`,
   `invoices(created_at)`, `sales_invoices(tanggal)`, `sales_returns(tanggal)`. Filter rentang tanggal pada
   tabel-tabel ini = full scan; makin lama makin lambat (kekhawatiran "data setahun").
4. **A3 (unduh saat 1 tenaga penjual):** unduhan laporan ini dibuat di browser dengan membaca tabel yang tampil
   (`UnduhLaporan` → `displaySections`). Simulasi DOM dengan filter satu karyawan **tidak** mereproduksi
   kegagalan (berkas tetap terbentuk), tapi ada cacat terlihat: kolom "Karyawan" di lembar filter berisi ID,
   bukan nama. Karena penyebab di browser asli belum bisa dipastikan tanpa akses Production, solusi yang
   diusulkan menghilangkan ketergantungan pada layar: **unduhan dibuat di server** (pola yang sudah terbukti di
   `/laporan/penjualan-barang/unduh`).

---

## A1 — Laporan wajib "Tampilkan" dulu

**Pendekatan (satu mekanisme bersama, bukan tambal per halaman):**

- Helper baru `src/lib/report-gate.ts`:
  - `laporanDiminta(sp)` → `true` hanya bila URL membawa `tampil=1`.
  - Konstanta nama parameter, supaya tautan drill-down bisa memakainya.
- `src/components/LaporanPage.tsx`:
  - Form filter otomatis menyisipkan `<input type="hidden" name="tampil" value="1">` — tombol "Tampilkan" yang
    sudah ada di tiap laporan langsung jadi pemicu.
  - Prop baru `siap: boolean`. Saat `false`: ringkasan & isi diganti kartu kosong "Pilih filter (cabang &
    periode), lalu klik Tampilkan"; tombol Unduh disembunyikan.
- Tiap halaman laporan: `if (!laporanDiminta(sp))` → **jangan panggil fungsi data** (hanya opsi filter ringan:
  daftar cabang/karyawan/akun). Ini inti kriteria "membuka halaman tidak memicu query berat".
- Halaman laporan keuangan yang belum memakai `LaporanPage` (Laba Rugi, Neraca, Neraca Saldo, Laba Ditahan,
  Buku Besar, Arus Kas, Rincian Arus Kas, Piutang, Hutang, Pembantu Piutang/Hutang, Rekonsiliasi, Komisi,
  Riwayat Tutup Shift, Nilai Persediaan, Hasil Opname, Margin Racikan): diberi hidden input + gate yang sama.
  Piutang/Hutang yang saat ini tanpa filter tanggal: gate + filter cabang.
- Tautan drill-down internal ke halaman laporan yang sudah membawa parameter (±10 tempat, mis. dari jurnal
  berulang, aset, opname, faktur pembelian) ditambah `tampil=1` supaya tetap langsung tampil.
- "Konfigurasi tersimpan" (ReportPresets): preset menyimpan query string; preset baru otomatis membawa
  `tampil=1`. Preset lama tanpa `tampil=1` akan membuka form terisi → user klik Tampilkan sekali (aman).

**Percepatan query (bagian "tetap cepat walau data setahun"):**

- Filter cabang didorong ke query untuk laporan penjualan yang berat: `penjual`, `penjualan-rinci`,
  `transaksi-cabang`, `operasional-penjualan`, `penjualan-kasir`, `pelanggan-harian`, `rekap-klinik`
  (mis. `.eq("sales.branch_id", id)`, `.eq("invoices.visits.branch_id", id)` dengan join `!inner`).
  Saringan di memori tetap dipertahankan sebagai pengaman akses cabang.
- **Migrasi index (BUTUH PERSETUJUAN — perubahan skema):** file baru
  `supabase/migrations/20261113031139_a1_index_tanggal_laporan.sql`:
  ```sql
  create index if not exists sales_branch_created_idx        on public.sales (branch_id, created_at);
  create index if not exists sales_created_idx               on public.sales (created_at);
  create index if not exists invoices_created_idx            on public.invoices (created_at);
  create index if not exists sales_invoices_tanggal_idx      on public.sales_invoices (tanggal);
  create index if not exists sales_returns_tanggal_idx       on public.sales_returns (tanggal);
  create index if not exists journal_entries_branch_tgl_idx  on public.journal_entries (branch_id, tanggal);
  ```
  Dampak: hanya menambah index, **tidak mengubah/menghapus data**. Saat dibuat, tabel terkait terkunci tulis
  beberapa detik (ukuran data sekarang kecil–menengah) → pasang di luar jam operasional, terarah (bukan
  `db push` massal, sesuai runbook). Bisa dibatalkan dengan `drop index`.

**Cakupan (diputuskan Reza: sesuai to-do = semua entri Daftar Laporan):** termasuk daftar kerja harian
(Daftar Pesanan/Penerimaan/Faktur Pembelian, Uang Muka, Faktur Penjualan, Jurnal, Daftar Rekening, Shift Kasir,
Daftar Aset, Kategori Aset, Rekonsiliasi, Piutang, Hutang, Komisi). Tombol/form kerja (buat baru, bayar, buka/tutup
shift, form aturan komisi) tetap tampil; yang ditahan hanya daftar/angka laporannya.

**Pengecualian yang disengaja:**
- Jurnal: tautan langsung ke satu jurnal (`entry`/`nomor`) dianggap "tampil" — query satu baris, dipakai banyak tautan dokumen.
- Hutang: tautan "ganti pembayaran" (`replace_payment`) dianggap "tampil".
- Operation & Sales: tampilan kunci pilot / pesan error tetap tampil (tidak ada filter).
- Pajak > Faktur pajak memakai kerangka laporan tetapi tidak ada di Daftar Laporan → tidak di-gate.
- Pos Shift: hanya bagian "Riwayat shift" yang di-gate; shift aktif kasir tetap tampil.

**Tautan & pengalihan:** semua redirect setelah aksi (bayar hutang, simpan jurnal, aset, rekening, PO, uang muka,
faktur penjualan, komisi, shift, koreksi pembelian, PO dari stok minimum) dan tautan drill-down (Laba Rugi/Neraca →
Buku Besar, Closing HPP, nilai persediaan historis, hasil opname dari stok opname, dashboard Operation & Sales,
dokumen terkait uang muka) membawa `tampil=1`. `denganTampil()` menambah parameter tanpa meng-encode ulang query lain.

**Saringan cabang di query (sudah):** penjual, penjualan-rinci, transaksi-cabang, pelanggan-harian, penjualan-kasir,
rekap-klinik, penjualan-barang (layar), absensi, gaji, kpi, anamnesa, pembelian. **Belum/sengaja tidak:** faktur
grosir (faktur koreksi menandai faktur asal dari kumpulan yang sama), retur/refund yang dibaca tanpa batas tanggal di
penjualan-rinci & loader transaksi (perlu perubahan logika lebih besar), retensi (cabang = cabang transaksi pertama,
dihitung setelah data dibaca). Saringan join bertingkat (`!inner`) baru diuji dengan tiruan → perlu dicek di data asli.

**Risiko:** rendah untuk data (semua read-only, tidak menyentuh jurnal/stok). Risiko utama adalah perilaku:
user yang terbiasa langsung melihat angka sekarang harus klik Tampilkan; tautan drill-down yang terlewat
akan membuka form kosong (bukan error). Mitigasi: tes per halaman bahwa tanpa `tampil=1` fungsi data tidak
dipanggil, dan dengan `tampil=1` hasilnya identik dengan sebelumnya.

## A2 — Rekap per tenaga penjual → per item (qty)

- `src/lib/laporan-tenaga-penjual.ts`: fungsi murni baru `rekapPerItem(atribusi)` → baris
  `{ employeeId, peran[], itemKey, item, kode, jenis, qty, netto, transaksi }`, diurutkan per orang lalu qty.
  Aturan hitung sama dengan rekap sekarang (keputusan Andri 29 Okt): baris Dokter+Non-dokter dihitung penuh
  untuk masing-masing orang.
- `BarisPenjual` ditambah `itemKey` + `kode` (item_id/SKU bila ada, fallback nama). Baris **retur/refund mewarisi
  `itemKey` baris asal** sehingga qty retur mengurangi item yang sama (sekarang namanya "Retur · …" sehingga
  akan jadi item terpisah kalau dikelompokkan per nama).
- `data.ts`: ikut ambil `item_id` (+ kode) dari `invoice_items`, `sale_items`, `sales_invoice_items`.
- `page.tsx`: pilihan **Tampilan**: `Rekap per item` | `Rincian` (default tetap tampilan sekarang supaya
  kebiasaan lama tidak berubah — atau sebaliknya bila Reza mau). Tampilan rincian yang sekarang **tidak dihapus**.
- Tes: unit `rekapPerItem` (retur mengurangi item asal, baris berdua, filter karyawan), tes halaman.
- Risiko: rendah, read-only. Perlu dicatat: rekap ini **bukan** perhitungan komisi (laporan Komisi tetap
  memakai tanggal pelunasan); dijelaskan di keterangan laporan.

## A3 — Download Excel untuk semua kombinasi filter

- Route baru `src/app/(app)/laporan/penjual/unduh/route.ts` (pola `penjualan-barang/unduh`):
  cek sesi + hak akses `/laporan/penjual`, baca filter yang sama, panggil `ambilTenagaPenjual` + saringan yang sama,
  hasilkan `.xlsx` berisi sheet: Filter (nama karyawan/cabang, bukan ID), Rekap per orang, Rekap per item (A2),
  Rincian baris, Faktur grosir belum lunas. CSV ikut tersedia.
- Logika saring dipindah ke satu fungsi bersama dipakai halaman + unduhan → angka layar = angka berkas.
- Halaman memakai `unduhTampilan={false}` + tombol "Excel lengkap" / "CSV lengkap" menuju route itu
  (tombol hanya muncul setelah Tampilkan — A1).
- Sel teks diamankan dari formula injection (`amankanSel`), sama dengan unduhan lain.
- Risiko: Vercel function timeout untuk rentang sangat panjang + semua cabang — sama batasnya dengan layar;
  pesan error ramah bila "Periode memuat terlalu banyak baris".

## Verifikasi per item

`npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`, plus tes baru per item. Live check setelah
deploy: buka laporan → tidak ada data sebelum Tampilkan; filter 1 tenaga penjual → Excel terunduh.
