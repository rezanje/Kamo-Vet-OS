# Kas & Bank — pemisahan rekening & buku mutasi

Tanggal: 2026-08-02 · Status: disetujui boss (2026-08-02)

## Masalah

Modul Kas & Bank sudah punya master rekening (`cash_accounts`, migrasi 0068), transfer antar
rekening, kas masuk/keluar, dan kartu saldo per rekening. Tapi **seluruh aplikasi di luar modul
itu** masih menulis jurnal ke dua kode akun mati:

```
const kasCode = metode === "Tunai" ? "1101" : "1102";
```

Ada di ±15 tempat: kasir petshop, pembayaran klinik, pelunasan piutang, bayar faktur pembelian,
beban, beli aset, pengeluaran shift, sinkron penjualan online.

Akibatnya:

1. QRIS, debit, kartu kredit, e-wallet, dan transfer semuanya menumpuk di satu akun "Bank BCA".
   Rekening kedua (Mandiri, QRIS settlement, e-wallet) tidak akan pernah menerima mutasi
   walaupun sudah didaftarkan.
2. Rekonsiliasi bank terkunci ke 1102 — judul layarnya bahkan hardcode "BANK BCA".
3. `getCashMovements` (arus kas) dan `dashboard.ts` menghitung kas dari kode `["1101","1102"]`
   saja → rekening baru tidak terhitung sebagai kas.

## Keputusan yang dikunci boss

- **Peta otomatis + boleh ganti manual.** Metode bayar dipetakan sekali ke rekening; kasir tidak
  dapat pilihan tambahan (kecepatan kasir tidak boleh berubah). Layar keuangan tetap boleh
  memilih rekening manual.
- Peta boleh dibuat khusus per cabang; kalau cabang tidak diatur, ikut aturan pusat.
- **Payment gateway TIDAK termasuk** — proyek terpisah.

## Rancangan

### 1. Peta metode bayar → rekening

Tabel baru `payment_account_map`:

| kolom | isi |
|---|---|
| `metode` | Tunai / Debit / Kredit / QRIS / E-Wallet / Transfer |
| `branch_id` | null = aturan pusat, terisi = khusus cabang itu |
| `cash_account_id` | rekening tujuan |

Urutan pencarian: **cabang → pusat → bawaan lama** (Tunai→1101, selain itu→1102). Bawaan lama
dipertahankan supaya kalau boss tidak mengatur apa pun, angka persis sama dengan sekarang —
tidak ada perubahan diam-diam.

`Transfer` ikut didaftar sebagai metode walau bukan pilihan di kasir: dipakai layar keuangan
(bayar hutang, terima piutang) yang metodenya "Transfer".

Logika murni di `src/lib/kas-akun.ts` (bisa diuji tanpa DB) + satu pembungkus async yang
membaca peta dari DB. Semua pemanggil lama diganti ke pembungkus ini — satu pintu, tidak ada
lagi kode akun mati di server action.

### 2. Pilihan rekening manual di layar keuangan

Dropdown rekening (default mengikuti peta) ditambahkan di: pelunasan piutang, pembayaran faktur
pembelian, pencatatan beban, pembelian aset. Kas masuk/keluar & transfer sudah punya.

Layar kasir, pembayaran klinik, dan pengeluaran shift **tidak** diubah tampilannya.

### 3. Rekonsiliasi bank per rekening

`bank_reconciliations` dapat kolom `cash_account_id`. Layar memilih rekening dulu; saldo buku,
jurnal biaya admin, dan jurnal bunga memakai kode akun rekening terpilih. Riwayat menampilkan
nama rekening.

### 4. Buku mutasi per rekening

Halaman `/kas-bank/rekening/[id]`: saldo awal periode, daftar mutasi (tanggal, no. jurnal,
keterangan, masuk, keluar, saldo berjalan), saldo akhir, saring tanggal, bisa dicetak.
Memakai `getAccountLedger` yang sudah ada — tidak ada query baru.

### 5. Perbaikan ikutan

`cashAccountIds` di `src/lib/ledger.ts` dan filter kas di `src/lib/dashboard.ts` dibaca dari
`cash_accounts`, bukan daftar kode mati. Tanpa ini, rekening baru tidak masuk hitungan arus kas
dan kartu kas di dashboard.

## Yang sengaja tidak dikerjakan

- Payment gateway / QRIS otomatis.
- Pilihan rekening manual di layar kasir & klinik.
- Menulis ulang jurnal lama (data transaksi baru saja direset 2026-08-02, tidak ada riwayat
  yang perlu dipindah).

## Uji

- Vitest untuk pencarian peta (cabang menang atas pusat, pusat menang atas bawaan, metode tak
  dikenal jatuh ke bawaan).
- Uji manual lewat browser: atur QRIS ke rekening baru → transaksi kasir QRIS → saldo rekening
  itu bertambah, BCA tidak; rekonsiliasi rekening baru; buku mutasi cocok dengan kartu saldo.
