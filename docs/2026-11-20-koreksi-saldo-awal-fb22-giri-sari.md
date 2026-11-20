# Koreksi saldo awal FB.2026.10.00022 (Cv. Giri Sari Mulyo): 2.587.500 → 25.639.100 (20 Nov 2026)

Permintaan finance lewat Reza. Faktur saldo awal hutang Giri Sari (no. asal Accurate PI.2026.10.00009, tgl 6 Okt 2026),
batch impor saldo awal per faktur 31 Okt 2026. Nilai di file impor: `original_total` 23.227.500, `outstanding` 2.587.500.
Belum ada pembayaran. Angka 25.639.100 dikonfirmasi ulang oleh peminta (naik 23.051.600, di atas nilai faktur Accurate).

## Cara

Bukan migrasi. Lewat fungsi resmi layar koreksi (`correct_opening_invoice`, lihat
`docs/2026-11-18-layar-koreksi-saldo-awal-per-faktur.md`), dijalankan via Supabase SQL dengan sesi akun sistem
"Owner" (`owner@vetos.local`, pembuat batch impor), kunci permintaan `claude-fb22-20261120`.
Uji coba di-rollback dulu (kunci `dryrun-fb22-20261120`, tidak tersimpan), lalu dijalankan sungguhan.

## Hasil di Production (20 Nov 2026, 17.13 WIB)

| Data | Sebelum | Sesudah |
|---|---|---|
| `purchase_invoices.total` | 2.587.500 | 25.639.100 |
| `opening_invoice_lines.outstanding` / `original_total` | 2.587.500 / 23.227.500 | 25.639.100 / 25.639.100 |
| `opening_invoice_batches.ap_total` | 865.439.423 | 888.491.023 |

- Riwayat koreksi `7f9051a1-1ce8-4464-bfc7-42624ccc3b96`: lama 2.587.500, baru 25.639.100, selisih +23.051.600, dibayar saat koreksi 0.
- Jurnal koreksi **JRN-202610-0057** tgl 31 Okt 2026 (tanggal batch): D 410001 / K 311001 masing-masing 23.051.600, seimbang.
  Jurnal batch asli tidak diubah.
- Tampil di layar Keuangan → Saldo Awal → Saldo Awal Hutang & Piutang per Faktur → riwayat koreksi (oleh "Owner").
