# Penerimaan faktur penjualan grosir: pilih cabang kas penerima (23 Nov 2026)

Pelapor: Mba Anisa (finance) via Reza, 23 Nov 2026, dengan tangkapan layar form *Terima / periksa* faktur
FJ.2026.11.00033 (cabang DC): "penerimaan penjualan, harus ada cabang. karena kas nya per cabang".

## Penyebab

`receive_wholesale_payment` selalu menjurnal penerimaan di **cabang faktur**. Peta rekening dibaca untuk cabang
faktur, dan rekening milik cabang lain ditolak ("Rekening tidak aktif atau berbeda cabang"). Jadi faktur DC yang
dibayar tunai di toko tidak bisa masuk ke Kas Toko cabang itu; finance harus transfer kas manual sesudahnya.

## Yang berubah

### Database — `supabase/migrations/20261205100000_penerimaan_grosir_cabang.sql`

- `sales_receipts.branch_id` (cabang penerima uang; NULL = baris lama = cabang faktur) dan
  `sales_receipts.cash_journal_id` (jurnal kas di cabang penerima bila beda cabang).
- `receive_wholesale_payment(..., p_branch_id uuid)` versi 9 argumen. Versi 8 argumen tetap ada sebagai pembungkus
  (cabang faktur) untuk klien lama.
  - Cabang kosong / sama dengan cabang faktur → **persis seperti sebelumnya** (satu jurnal, payload idempoten sama).
  - Cabang lain → dua jurnal, pola sama dengan Transfer Kas dua cabang (182010 Rekening Antar Cabang):
    - `sales-receipt` (cabang faktur): D 182010 bagian kas [+ D 314001 uang muka] / K 150001 piutang
    - `sales-receipt-cabang` (cabang penerima): D rekening kas/bank / K 182010
    Piutang lunas di cabang faktur, uang masuk di cabang penerima, 182010 total semua cabang = 0.
  - Peta rekening & rekening milik cabang dicocokkan ke cabang **penerima**. Cabang penerima wajib aktif dan bisa
    diakses pengguna (FINANCE yang dibatasi ke satu cabang tidak bisa memilih cabang lain).
- `cancel_wholesale_receipt` (Hapus penerimaan) membalik kedua jurnal; pembalik kas di cabang penerima
  (source `sales-receipt-void-cbg` — kolom source maks 24 huruf).
- `guard_wholesale_journal` melindungi kedua source baru dari tulis langsung.
- `correct_wholesale_invoice` **tidak diubah**: jurnal `sales-receipt` tetap berbentuk "kas + uang muka / piutang"
  (kasnya 182010), jadi pemeriksanya tetap lulus — dibuktikan di tes.
- Diterapkan lewat penggantian teks pada definisi live (fungsi sudah dipatch berlapis). Sebelum rilis, semua 16
  potongan teks dicek **hanya-baca** terhadap Production: masing-masing ditemukan tepat 1 kali.

### Layar — Penjualan → Faktur Penjualan → *Terima / periksa* (baris grosir)

- Isian baru **Cabang (kas penerima)**, bawaan = cabang faktur (ditandai "(cabang faktur)").
- **Masuk ke** hanya menawarkan rekening tanpa cabang (mis. BCA) atau milik cabang terpilih (mis. Kas Toko cabang
  itu). Ganti cabang → rekening milik cabang lama dilepas ke "ikut peta cabang".
- Bila cabang ≠ cabang faktur muncul catatan: "Uang dicatat masuk ke kas X; tagihan tetap lunas di Y."
- Aplikasi hanya mengirim cabang bila beda dari cabang faktur, jadi penerimaan biasa tetap jalan walau tampilan
  sudah live sebelum migrasi terpasang (urutan rilis aman). Penerimaan lintas cabang baru berfungsi setelah migrasi.
- Hasil server dicek: cabang yang tercatat harus sama dengan yang dipilih, kalau tidak draf tidak dihapus.

## Tes

- `python3 -I scripts/test-penerimaan-grosir-cabang-postgres.py` — 466 migrasi dari nol di PostgreSQL 16 sekali
  pakai (data fiktif), fixture faktur grosir dari `wholesale_returns.sql`, lalu
  `supabase/tests/penerimaan_grosir_cabang.sql`: cabang sama = klien lama (replay idempoten lintas versi), lintas
  cabang (dua jurnal, saldo kas per cabang, 182010 nol), replay & kunci beda isi, rekening salah cabang ditolak,
  bank tanpa cabang boleh, cabang nonaktif ditolak, FINANCE terbatas ditolak, hapus penerimaan (dua pembalik, kas &
  piutang kembali), jurnal dilindungi, koreksi faktur tetap lulus. Lalu regresi `wholesale_returns.sql`. **Lulus.**
  `--baseline` (tanpa migrasi) gagal seperti seharusnya.
- Catatan: `sales_safe_posting.sql` / `wholesale_corrections.sql` sudah gagal di main pada rantai fixture ini
  ("Pengaturan akses berubah…", dicek tanpa migrasi ini) — bukan dari perubahan ini, tidak dirangkai.
- Vitest baru: `penerimaan-grosir-cabang.test.tsx` (filter rekening, ganti cabang, catatan, pulih draf),
  tambahan di `wholesale-correction-actions.test.ts` dan `faktur-jual-aksi.test.tsx`. Seluruh `vitest run`
  (1050 file), `lint` (0 error), `tsc --noEmit`, `next build` lulus.

## Rilis

1. Merge PR → Vercel deploy (aman duluan).
2. Terapkan migrasi `20261205100000_penerimaan_grosir_cabang.sql` ke Production (idempoten; gagal keras bila
   definisi live berubah).
3. Cek hanya-baca:

```sql
select to_regprocedure('public.receive_wholesale_payment(text,uuid,date,numeric,text,uuid,uuid,text,uuid)') is not null as v9,
       position('penerimaan-grosir-cabang' in pg_get_functiondef('public.cancel_wholesale_receipt(uuid,integer,text,text)'::regprocedure))>0 as batal,
       position('sales-receipt-cabang' in pg_get_functiondef('public.guard_wholesale_journal()'::regprocedure))>0 as guard;
```

## Sisa

- Penerimaan lama **tidak dipindah** cabangnya. Kalau ada yang sudah terlanjur masuk Kas Kecil/DC padahal uangnya
  di toko: Hapus penerimaan lalu catat ulang dengan cabang yang benar, atau Transfer Kas antar cabang.
- Belum ada "ubah cabang" langsung pada penerimaan yang sudah tersimpan (tetap hapus + catat ulang).
- Belum diuji pengguna (UAT) di Production.
