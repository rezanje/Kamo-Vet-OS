# Koreksi saldo awal FB.2026.10.00030 (Loving Pet): 9.939.500 → 11.404.500 (18 Nov 2026)

Permintaan finance klinik lewat Reza. Faktur saldo awal hutang Loving Pet (no. asal PI.2026.10.00114),
hasil impor saldo awal per faktur batch 31 Okt 2026 (batch yang sama dengan FB.2026.10.00079).
Belum ada pembayaran atas faktur ini, jadi sisa hutang setelah koreksi = 11.404.500.

Mekanisme sama persis dengan `docs/2026-11-17-koreksi-saldo-awal-fb79-dan-akun-xendit.md`:
migrasi satu kali `supabase/migrations/20261124200000_koreksi_saldo_awal_fb_2026_10_00030.sql`
(satu transaksi, idempoten — hanya jalan bila total masih 9.939.500).

| Data | Sebelum | Sesudah |
|---|---|---|
| `purchase_invoices.total` | 9.939.500 | 11.404.500 |
| `opening_invoice_lines.outstanding` / `original_total` | 9.939.500 | 11.404.500 (+ catatan koreksi) |
| `opening_invoice_batches.ap_total` / `result.hutang.total` | 861.162.103 | 862.627.103 |
| Jurnal saldo awal batch: 410001 Debit / 311001 Kredit | 861.162.103 | 862.627.103 |

Baris 410001 sisi kredit (lawan piutang 137.606.797) tidak disentuh. Jurnal tetap seimbang;
periode belum ditutup (`accounting_locks.closed_until` kosong). Trigger `opening_invoice_guard`
menyala lagi (terverifikasi `tgenabled = 'O'`).

**Sudah diterapkan ke Production** 18 Nov 2026 (Supabase `apply_migration`
`koreksi_saldo_awal_fb_2026_10_00030`). Kueri cek:

```sql
select pi.total, l.outstanding, b.ap_total
  from purchase_invoices pi
  join opening_invoice_lines l on l.purchase_invoice_id = pi.id
  join opening_invoice_batches b on b.id = pi.opening_batch_id
 where pi.no_faktur = 'FB.2026.10.00030';
-- 11404500 | 11404500 | 862627103
```

Catatan: ini koreksi saldo awal per faktur kedua dalam dua hari — layar koreksi resmi
(Owner, dengan alasan + jurnal koreksi) makin layak dibuat.
