# Koreksi saldo awal FB.2026.10.00079 + akun Xendit ditolak (17 Nov 2026)

Pelapor: Mba Anisa (finance klinik), grup WA 17 Nov 09.24 dan 11.13.

## 1. Saldo awal FB.2026.10.00079: 27.452.000 → 26.452.000

Faktur saldo awal hutang Twin Petfood (no. asal PI.2026.10.00098), hasil impor
`Format-Saldo-Awal-Faktur-VetOS new.xlsx` (batch 31 Okt 2026, jurnal JRN-202610-0009).
Nilai di file salah ketik 1.000.000. Faktur sudah dibayar 26.452.000 (tanggal bayar 4 Nov,
dicatat 17 Nov) — jadi setelah koreksi sisa hutangnya 0 / lunas.

Faktur saldo awal dikunci (`guard_opening_invoice`: hanya status/revisi lewat pembayaran) dan belum
ada layar koreksinya, jadi dikoreksi sekali lewat migrasi
`supabase/migrations/20261121300000_koreksi_saldo_awal_fb_2026_10_00079.sql` (satu transaksi, idempoten):

| Data | Sebelum | Sesudah |
|---|---|---|
| `purchase_invoices.total` | 27.452.000 | 26.452.000 |
| `opening_invoice_lines.outstanding` / `original_total` | 27.452.000 | 26.452.000 (+ catatan koreksi) |
| `opening_invoice_batches.ap_total` / `result.hutang.total` | 862.162.103 | 861.162.103 |
| JRN-202610-0009: 410001 Debit / 311001 Kredit | 862.162.103 | 861.162.103 |

Jurnal tetap seimbang; periode belum ditutup (`accounting_locks.closed_until` kosong). Trigger penjaga
dimatikan hanya di dalam transaksi lalu dinyalakan lagi (terverifikasi `tgenabled = 'O'`).
Perubahan tercatat di log aktivitas lewat trigger `capture_activity_log`.

**Sudah diterapkan ke Production** 17 Nov 2026 (Supabase `apply_migration`
`koreksi_saldo_awal_fb_2026_10_00079`). Kueri cek:

```sql
select pi.total, l.outstanding, b.ap_total,
       (select sum(amount) from purchase_invoice_payments where invoice_id = pi.id and voided_at is null) dibayar
  from purchase_invoices pi
  join opening_invoice_lines l on l.purchase_invoice_id = pi.id
  join opening_invoice_batches b on b.id = pi.opening_batch_id
 where pi.no_faktur = 'FB.2026.10.00079';
-- 26452000 | 26452000 | 861162103 | 26452000
```

Catatan: bila koreksi saldo awal per faktur makin sering diminta, layak dibuat layar koreksi resmi
(Owner, dengan alasan + jurnal koreksi) alih-alih migrasi satu-satu.

## 2. Tambah akun 120007 "Xendit" ditolak

Bukan bug data: kode 120007–129999 (dan 110023–119999 untuk kas) memang dipesan untuk rekening yang
dibuat dari **Kas & Bank → Rekening** (kode diberi otomatis, akun langsung jadi rekening yang bisa dipilih di
pembayaran dan dihitung di Arus Kas). Akun yang dibuat dari Bagan Akun tidak jadi rekening.

Masalahnya pesan error menyuruh "Pakai kode lain" — menyesatkan, karena Xendit memang seharusnya rekening bank.

Perubahan:
- `src/lib/coa-sistem.ts` — pesan jatah kode per jenis (kas/bank) dan menunjuk langkahnya: buka
  Kas & Bank → Rekening, isi nama, pilih jenis, Simpan rekening. Konstanta `MENU_REKENING`.
- `src/app/(app)/keuangan/coa/page.tsx` — banner error menampilkan tautan langsung ke `/kas-bank/rekening`;
  keterangan di bawah form ikut menautkan menu itu dan menyebut contoh Xendit/e-wallet.
- Tes: `src/lib/__tests__/coa-sistem.test.ts`, `src/lib/__tests__/impor-akun.test.ts`.

Cara Anisa membuat Xendit: Kas & Bank → Rekening → Nama "Xendit", Jenis "Bank" (bank/no. rekening boleh
kosong), saldo awal bila ada → Simpan rekening. Kode 120007 terbentuk otomatis di bawah 120000 Bank.

## Verifikasi lokal

- `npx vitest run` — 1002 file lulus (9452 tes), 4 file dilewati.
- `tsc --noEmit` lulus; eslint file yang diubah bersih; `next build` — lihat PR.
