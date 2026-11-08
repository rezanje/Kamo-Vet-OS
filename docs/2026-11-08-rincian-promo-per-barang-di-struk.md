# Rincian promo per barang di struk & faktur (8 Nov 2026)

**Asal permintaan:** Reza, 8 Nov 2026 (dengan tangkapan layar pembayaran klinik VET_CMS):

> "Boleh ga setiap diskon produk itu ada informasi potongan rinciannya setiap faktur, baik petshop
> atau klinik. Misal ada promo Icarae MBC, jadi informasi diskonnya langsung di struk baris per
> produk itu. Kalo di bawah itu khusus diskon transaksi."

## Kondisi sebelumnya

| Cetakan | Promo per barang | Bagian bawah |
|---|---|---|
| Struk kasir petshop (`/kasir/struk`) | Sudah ada ("Pot. <promo>") | Subtotal kotor + "Pot. per item" + diskon transaksi |
| Struk POS back office (`/pos/struk`) | **Tidak ada** | "Diskon" = promo + diskon kasir + voucher digabung |
| Struk klinik, struk gabungan (rombongan), invoice A4 klinik | **Tidak ada** | "Diskon" = promo + golongan + voucher + poin + diskon kasir digabung |

Penyebab di klinik: promo otomatis dihitung ulang di server lalu dilebur ke `invoices.discount`.
Tidak ada catatan promo mana memotong barang mana (petshop punya `sale_items.promo_discount` sejak
migrasi 0127, klinik tidak).

## Perubahan

### Database — migrasi `20261108090000_rincian_promo_baris_klinik.sql`

Tabel baru `invoice_promo_lines` (invoice_id, item_id, promo_id, promo_name snapshot, potongan).

- **Tampilan/audit saja.** Uang tetap di `invoices.discount`; posting, jurnal, DPP/PPN, insentif
  tidak membaca tabel ini. RPC posting klinik tidak disentuh.
- Ditulis sesudah posting berhasil (create biasa + bayar rombongan). Gagal tulis → dicatat di log
  server, pembayaran tetap jalan, struk kembali ke tampilan lama.
- Pagar: RLS per cabang (sama dengan `invoice_items`), hanya SELECT + INSERT untuk pengguna
  (tidak bisa ubah/hapus), invoice void ditolak, trigger `guard_invoice_promo_lines` menolak bila
  total promo > diskon invoice, `created_by` dipaksa `auth.uid()`, baris kembar (kirim ulang)
  dilewati diam-diam.

### Aplikasi

- `lib/tagihan-klinik.ts` — `hitungPotonganKlinik` mengembalikan `rincianPromo` (per barang+promo,
  jumlahnya sama persis dengan `promo`).
- `lib/rincian-promo-klinik.ts` — catat, baca, dan `pasangPromoKeBaris` (tempel promo ke baris cetak
  yang memuat barangnya; baris paket dicocokkan lewat isinya; total tempelan tidak pernah melebihi
  diskon invoice).
- `lib/label-potongan.ts` — label seragam petshop & klinik: "Promo <nama>" (tidak dobel bila nama
  sudah diawali "Promo"), "Diskon 10%" / "Diskon item" untuk diskon kasir.
- Struk klinik, struk rombongan: baris barang = harga kotor; di bawahnya "Diskon x%" (diskon kasir)
  dan "Promo …". Bawah: **Subtotal** (setelah potongan barang) dan **Diskon transaksi** (= diskon
  invoice − promo barang: voucher, golongan, poin, diskon kasir di tingkat transaksi).
- Invoice A4 klinik: baris "Promo …" di bawah barangnya; ringkasan "Subtotal" + "Diskon transaksi".
- Struk kasir petshop: "Pot. per item" di bawah dihapus; Subtotal = setelah potongan barang.
- Struk POS back office: kini mencetak promo per barang; "Diskon" → "Diskon transaksi" (sisanya).

Total, PPN, dan angka yang dibukukan **tidak berubah** di semua cetakan.

## Batasan yang diketahui

- **Invoice klinik lama** (sebelum rilis ini) tidak punya rincian → tetap tampil cara lama
  (semua potongan di "Diskon transaksi"). Tidak diisi mundur karena promo yang berlaku saat itu
  tidak bisa dipastikan ulang.
- **Koreksi / terbit ulang invoice klinik**: jalur koreksi tidak menghitung ulang promo. Rincian
  lama tetap menempel bila barangnya masih ada dan totalnya masih ≤ diskon; terbit ulang (invoice
  baru) belum menyalin rincian → tampil cara lama.
- **Tagihan rawat inap bertahap** tidak memakai mesin promo → tidak berubah.
- **Diskon golongan/level member** masih satu angka di bawah (mesinnya hanya mengembalikan total).
  Bisa dipecah per barang di tahap berikut bila diminta.
- Struk WhatsApp klinik belum ikut menampilkan baris promo.
- Layar kasir klinik (sebelum bayar) masih menampilkan "Promo otomatis" sebagai satu angka; yang
  berubah adalah cetakan.

## Uji

- `npx vitest run` — 865 file / 7.879 tes lulus, termasuk:
  - `src/lib/__tests__/rincian-promo-klinik.test.ts` (baru): pengelompokan, penempelan ke baris,
    batas diskon, label, tulis/baca gagal aman.
  - `clinic-package-customer-print.test.tsx`: struk, invoice A4, struk rombongan mencetak promo di
    bawah barangnya dan sisanya sebagai diskon transaksi; tanpa rincian → tampilan lama.
  - `kasir-receipt-58.test.tsx`: struk kasir & back office.
- `python3 -I scripts/test-rincian-promo-baris-klinik-postgres.py` — PostgreSQL 16 lokal sekali
  pakai, 393 migrasi: RED (tabel tidak ada) → kandidat dua kali (skema sama) → GREEN
  `supabase/tests/rincian_promo_baris_klinik.sql` (akses per cabang, tidak bisa ubah/hapus,
  invoice void ditolak, total > diskon ditolak, kirim ulang tidak dobel, pencatat dipaksa).
- `npx tsc --noEmit`, `npm run lint` (0 error), `npm run build` lulus.

## Cara cek setelah rilis

1. Pastikan migrasi `20261108090000` sudah terpasang di database Production.
2. Buat tagihan klinik baru untuk barang yang sedang kena promo otomatis, bayar, cetak struk:
   baris "Promo <nama>" muncul di bawah barangnya, "Diskon transaksi" di bawah hanya sisanya.
3. Transaksi petshop (kasir & POS back office) dengan barang promo: promo di bawah barang, tidak
   ada lagi "Pot. per item" di bawah.
