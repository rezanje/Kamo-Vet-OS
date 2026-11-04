# Koreksi pengeluaran sesudah shift ditutup (4 Nov 2026)

Keputusan Owner (Reza, 4 Nov, opsi C): pengeluaran kasir yang salah input boleh diedit /
dibatalkan walau shift kasirnya sudah ditutup — khusus **Owner dan Finance**. Pemicu: laporan
Anisa (grup klinik) bahwa banyak pengeluaran salah input. Koreksi metode bayar penjualan
selain Tunai↔Transfer (QRIS/Debit/E-Wallet) menyusul terpisah.

## Perilaku

| Peran | Shift masih buka | Shift sudah ditutup |
|---|---|---|
| Owner | edit + batal | edit + batal |
| Finance | edit + batal | edit + batal |
| Admin | edit + batal | ditolak ("hanya Owner atau Finance") |
| Staff/kasir | ditolak | ditolak |

- Shift tidak dibuka ulang; `expected_cash`, `closing_balance`, `closing_breakdown`, `selisih`
  tidak diubah. Baris shift tetap dikunci `FOR UPDATE` agar tidak berlomba dengan tutup shift.
- Status shift sumber dicatat di `expense_revisions.source_shift_status` dan di hasil RPC.
- Jurnal pembalik (tanggal sumber) + pengganti (tanggal baru) sama seperti koreksi biasa.
- Periode tutup buku tetap mengunci (tanggal sumber atau tanggal baru ≤ `closed_until`).
- Refund retur tetap hanya bisa dikoreksi lewat catatan retur.

Catatan tampilan: rincian tutup shift membaca pengeluaran secara langsung, jadi daftar
pengeluaran di rincian shift akan menampilkan nilai hasil koreksi, sementara angka
"kas seharusnya / selisih" yang tersimpan saat tutup shift tetap. Form edit memberi tahu hal ini.

## Perubahan

- `supabase/migrations/20261106600000_expense_correction_after_shift.sql` — patch berjangkar
  `revise_expense_atomic` (pola sama dengan J02 `20261104373000`), kolom baru
  `expense_revisions.source_shift_status`.
- `src/components/pengeluaran/PengeluaranDetail.tsx` — form edit/batal tampil untuk
  Owner/Finance walau shift ditutup, dengan catatan angka tutup shift tidak berubah.

## Verifikasi lokal

- `supabase/tests/expense_correction_after_shift.sql` (baru) — lulus di PostgreSQL 16 lokal
  lewat `scripts/test-feedback-expense-postgres.py`; gagal tanpa migrasi (bukti tes bermakna).
- `supabase/tests/expense-workflow.sql` — blok shift ditutup diubah: Admin ditolak.
  Catatan: suite ini sudah merah di harness sebelum perubahan ini (baris akun `760003`
  tidak cocok dengan pemetaan kategori pasca `20261105010000_coa_bagan_baru`); bagian lain
  diverifikasi dengan menyaring dua baris tersebut.
- Vitest `expense-detail-controls`, seluruh `npm test`, `npm run lint`, `tsc --noEmit`, `next build` lulus.

## Deploy

Migrasi harus diterapkan ke database Production bersamaan dengan rilis aplikasi. Tanpa migrasi,
tombol edit muncul untuk Owner/Finance tetapi penyimpanan ditolak dengan pesan "Shift sudah ditutup".
