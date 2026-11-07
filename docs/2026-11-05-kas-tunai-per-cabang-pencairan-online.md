# Kas tunai per cabang + pencairan online sekaligus (5 Nov 2026)

Pelapor: Aldi Saputra (grup *Kamo Group – ERP Dev*, 5 Nov 16.49–16.51), diteruskan Reza: "fixin itu".

1. "Pembayaran tunai di masing-masing cabang belum konek ke COA uang kas masing-masing cabang, masih ke kas
   kecil semua." — **urgent**.
2. "Yang online saat input penjualan masih jadi piutang, tinggal tambah bayar piutang online-nya saat uang sudah
   masuk. Bisa langsung bayar semua faktur."

## 1. Kas tunai per cabang

**Penyebab.** Bagan akun baru (`20261105010000_coa_bagan_baru`) membuat akun 110004–110021 "Kas Toko <cabang>",
tetapi akun itu belum didaftarkan sebagai rekening Kas & Bank dan belum ada aturan *Peta Rekening Pembayaran*
`Tunai → Kas Toko <cabang>`. Semua penerimaan tunai (kasir petshop, pembayaran klinik, rawat inap, pengeluaran
shift, selisih tutup shift, retur tunai) memakai peta yang sama (`unit_posting_cash` / `kodeAkunBayar`), dan
tanpa aturan cabang semuanya jatuh ke bawaan 110003 Kas Kecil.

**Perbaikan** (`supabase/migrations/20261107010000_kas_tunai_per_cabang_pencairan_online.sql`, bagian 1):

| Akun | Cabang (kode) | Akun | Cabang (kode) |
|---|---|---|---|
| 110004 Kas Toko BTKM | BTKM | 110013 Kas Toko Vet CMS | VET_CMS |
| 110005 Kas Toko CIAWI | CIAW | 110014 Kas Toko Vet CMGG | VET_CMGG |
| 110006 Kas Toko CMS | CMS | 110015 Kas Toko Vet CIAW | VET_CIAW |
| 110007 Kas Toko CMGG | CMGG | 110016 Kas Toko Vet PDRY | VET_PDRY |
| 110008 Kas Toko MUAR | MUAR | 110017 Kas Toko Vet TKI | VET_TKI |
| 110009 Kas Toko TKI | TKI | 110018 Kas Toko Vet GRDA | VET_GRDA |
| 110010 Kas Toko GRND | GRND | 110019 Kas Toko Vet GRLG | VET_GRLG |
| 110011 Kas Toko SRKN | SRKN | 110020 Kas Toko Vet SRKN | VET_SRKN |
| 110012 Kas Toko PDRY | PDRY | 110021 Kas Toko Vet GRND | VET_GRND (dilewati bila cabang tidak ada) |

- Kode cabang dicocokkan tanpa tanda baca (VET_CMGG = VET-CMGG); harus tepat satu cabang aktif.
- Akun didaftarkan sebagai rekening **Kas** milik cabang itu, lalu dipasang aturan cabang `Tunai`.
- **Tidak menimpa** pengaturan finance: aturan Tunai cabang yang sudah ada dibiarkan; rekening yang sudah ada
  untuk akun itu dipakai ulang (diikat ke cabang bila belum bercabang); rekening nonaktif / milik cabang lain
  dilewati.
- Yang **tidak** berubah: metode non-tunai (QRIS/Debit/Kredit/Transfer/E-Wallet) tetap ke 120002; cabang tanpa
  akun Kas Toko (LOJI, DC, OFFICE, B2C) tetap ke 110003 Kas Kecil; **jurnal lama tidak dipindah** — hanya
  transaksi sesudah migrasi. Pembatalan/koreksi transaksi lama tetap membalik ke akun jurnal aslinya
  (`kodeKasJurnalAsal`, pembalikan SQL membaca jurnal sumber).
- Saldo Kas Kecil yang sebenarnya milik toko (transaksi 5 Nov s/d rilis) bisa dipindah finance lewat
  Kas & Bank → Transfer antar rekening, atau jurnal umum. Tidak dilakukan otomatis.

## 2. Pencairan marketplace sekaligus

Sebelumnya 1 order = 1 klik "Tandai cair". Sekarang layar **Penjualan → Penjualan Online** punya bagian
**Pencairan sekaligus**:

- Pilih toko online (kelompok = marketplace + cabang), semua order piutang tercentang otomatis, bisa
  dicentang/dilepas satu-satu atau "pilih semua".
- Isi tanggal dana masuk (default hari ini, tidak boleh masa depan), rekening bank (default ikut peta Transfer),
  dan dana yang masuk sesuai mutasi bank. Layar menghitung potongan platform = total order − dana masuk.
- RPC atomik `online_disburse_batch(p_request_key, p_sale_ids, p_nominal, p_tanggal, p_account_id)`:
  cek akses cabang sebelum mengunci; kunci order urut id; tolak order batal / bukan marketplace / sudah cair /
  campur marketplace / campur cabang; dana > total ditolak; periode tutup buku ditolak; rekening harus aktif
  dan untuk cabang itu. Komisi dibagi proporsional ke tiap order (pembulatan rupiah, sisa ke order terbesar).
  Satu jurnal `sale-online-cair` ref `CAIR-YYYYMMDD-NNN`: Dr Bank (dana) + Dr 740020 (komisi) / Cr 130009
  (total). Idempoten per `request_key` (tabel `unit_posting_requests`, scope `online-cair`).
- Tombol "Tandai cair" per order tetap ada.

## Verifikasi lokal

- `python3 scripts/test-kas-cabang-pencairan-online-postgres.py` — PostgreSQL 16 sekali pakai, 377 migrasi:
  migrasi no-op tanpa cabang; dengan daftar cabang `seed.sql` + pengaturan manual fiktif (aturan TKI manual,
  rekening 110006 tanpa cabang, rekening 110008 nonaktif) hasil pemetaan sesuai tabel; terapkan ulang = tanpa
  perubahan; `supabase/tests/kas_tunai_per_cabang_pencairan_online.sql` (peta Tunai per cabang, non-tunai tidak
  berubah, pencairan 3 order + pembagian komisi + jurnal seimbang, replay idempoten, penolakan kunci beda isi /
  sudah cair / campur marketplace / campur cabang / dana lebih / tanggal depan / tutup buku / tanpa akses cabang,
  anon tanpa akses). Uji mutasi: mengubah satu ekspektasi membuat tes merah.
- Vitest baru `online-cair-sekaligus-action`, `cair-sekaligus-form`; seluruh `npm test`, `npm run lint`,
  `tsc --noEmit`, `next build` lulus.

## Rilis

1. Terapkan migrasi `20261107010000_kas_tunai_per_cabang_pencairan_online.sql` ke Production (satu transaksi).
   NOTICE "dilewati" = cabang/akun tidak cocok — kirim isi NOTICE-nya.
2. Kueri baca sesudah pasang:

```sql
select b.code, c.coa_code, c.nama from payment_account_map m join branches b on b.id=m.branch_id
 join cash_accounts c on c.id=m.cash_account_id where m.metode='Tunai' order by b.code;   -- ±17 baris
select to_regprocedure('public.online_disburse_batch(text,uuid[],numeric,date,uuid)');    -- tidak null
```

3. Merge PR, tunggu Production, cek `/api/version` = SHA merge.
4. Cek live: Kas & Bank → Peta Rekening (bagian Aturan Khusus Cabang berisi Tunai per cabang); satu transaksi
   tunai di satu toko → buku besar Kas Toko cabang itu bertambah, Kas Kecil tidak.

## Belum dikerjakan

- Lampiran bukti order Shopee di order online (permintaan Aldi 16.43) — terpisah.
- Pemindahan saldo Kas Kecil lama ke kas toko — keputusan finance.
- Cabang yang namanya tidak sesuai pola kode di Production akan dilewati (lihat NOTICE) dan bisa dipetakan manual
  di Kas & Bank → Peta Rekening.
