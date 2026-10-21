# Kasir: jumlah barang dapat diketik langsung

Base main `c320e5b73364a60aca3b580563db12e4a7d1550e` sesudah rilis PR78.
Branch `codex/kasir-direct-quantity-20261021`.

Komponen sebenarnya `src/app/kasir/KasirClient.tsx` menampilkan jumlah sebagai
`span` di antara tombol minus/plus. Perubahan menggantinya dengan input angka
berlabel per item/satuan. Input memperbarui jumlah absolut pada state keranjang
yang sama; harga bertingkat, diskon, subtotal, konversi satuan, minimum jual,
peringatan stok dan penyimpanan draft tetap memakai jalur existing.

Kosong, nol, negatif, nonfinite atau angka melebihi presisi integer aman tidak
masuk payload keranjang. Native form validation menolak isian invalid; saat blur,
jumlah valid terakhir tampil kembali. Enter mengakhiri edit tanpa checkout.
`step=any` mempertahankan dukungan jumlah pecahan. Minus/plus termasuk minus
yang menghapus baris ketika hasilnya <=0 tetap berperilaku seperti sebelumnya.

Stok Kasir existing bersifat peringatan nonblocking sesuai kode dan aturan bisnis
yang sudah ada; perubahan ini tidak menggantinya dengan clamp stok. Checkout
server tetap otoritatif dan tidak diubah. Tidak ada perubahan PosClient backoffice,
SQL/migrasi, FIFO/average, histori PDRY, harga atau helper perhitungan.

Verifikasi aktual:

- RED: 10 kasus awal gagal karena input Qty belum ada; setup selector yang salah
  dibetulkan sebelum red yang relevan diamati.
- GREEN final: **73 tes pada 6 file**, termasuk 11 kasus input baru; mengetik
  memperbarui harga tier/diskon/subtotal/draft, dua satuan item tetap terpisah,
  pecahan/minimum/stok serta kontrol minus/plus dan Enter terjaga.
- Full suite **2.268 lulus / 3 gagal**. Kegagalan sama dengan baseline PR78/main:
  dua kasus `merchant-fee-report-pages.test.tsx` kekurangan mock auth.getUser;
  satu `remaining-transaction-forms.test.tsx` mengasumsikan input PO draft_key.
- Next production build (termasuk TypeScript), scoped ESLint dan whitespace
  lulus. Build memakai Supabase loopback fiktif, bukan credential/data produksi.
  Next15.5.25 tidak menyediakan direktori docs yang disebut AGENTS; tidak ada
  API/routing Next baru yang diperkenalkan.
- Chromium komponen input asli, wrapper/state fiktif,1280px/390px: pengetikan
  `0.3333` dengan keyboard, input kosong/nol/negatif, Enter tanpa submit, plus
  dan pemulihan blur lulus; tidak ada overflow, error runtime atau request luar.
  Ini fixture komponen, bukan login/checkout produksi atau acceptance Aldy.

Reproduksi: `npm test -- src/components/__tests__/kasir-direct-quantity.test.tsx`;
`node scripts/test-kasir-quantity-browser.mjs` (Playwright existing atau override
`KAMO_PLAYWRIGHT_MODULE`). Screenshot/checks di
[`docs/evidence/2026-10-21-kasir-direct-quantity`](../evidence/2026-10-21-kasir-direct-quantity).
Rilis produksi dan smoke read-only dicatat pada PR; tidak melakukan transaksi
bisnis uji, reset, perubahan credential atau revisi valuasi historis.
