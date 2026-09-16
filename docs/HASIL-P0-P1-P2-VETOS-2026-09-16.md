# Hasil Stabilization VetOS P0–P2 — 16 September 2026

## Status rilis

- Implementasi tersimpan di branch cloud `codex/p0-p2-stabilization`.
- Commit GitHub checkpoint: `e682b6f4590b436b361613c1d025eb25684f65f9`.
- `main` dan produksi belum dipindahkan karena kredensial Supabase produksi tidak tersedia di sesi cloud. Mendorong kode sebelum migrasi akan membuat halaman baru meminta kolom/RPC yang belum ada.
- URL produksi yang masih aktif: `https://kamo-vet-os.vercel.app` (masih commit lama `df4d0d4`).

## Migrasi yang disiapkan (belum diterapkan)

1. `20260916090000_access_hris_scope.sql`
2. `20260916091000_atomic_asset_acquisition.sql`
3. `20260916092000_direct_purchase_assets.sql`
4. `20260916093000_bounded_recurring_journals.sql`

## Bukti verifikasi cloud

- Targeted P0/P1/P2: lulus.
- Full suite: 124 file, 1.158 test lulus.
- TypeScript: `tsc --noEmit` lulus.
- ESLint: lulus tanpa error; 12 warning lama tetap ada.
- Production build: lulus, 181 route berhasil dibangun.
- `git diff --check`: lulus.

## Skenario yang dibuktikan oleh test/build

- ADMIN tidak lagi company-wide; dokter hanya cabang penugasan atau visit yang ditugaskan langsung.
- HRIS tidak mengubah kegagalan query menjadi angka nol diam-diam dan default absensi memakai tanggal WIB.
- Saldo awal aset terpisah dari pembelian; pembelian Kas/Bank/Hutang membuat aset+jurnal atomik.
- Faktur langsung mendukung stok, aset-saja, dan campuran; satu baris aset menjadi satu aset, baris aset tidak masuk stok.
- Umur ekonomis wajib per aset, tidak lagi diambil dari kategori.
- Transaksi berulang Harian/Bulanan memiliki tanggal mulai, batas jumlah, hitungan jalan, status, riwayat, dan run-now idempoten.
- COA buatan pengguna menerima 4–6 digit; proteksi kode sistem/rekening dan roll-up induk tetap berlaku.
- Baris/nama akun Buku Besar membuka mutasi; asal cabang dibawa pada detail dan filter cabang diuji.
- Jurnal normal dan sinkronisasi klinik/petshop memakai akun `4102` terpisah; nilai kontra mengurangi pendapatan Laba Rugi.

## Blokir produksi

- `SUPABASE_ACCESS_TOKEN`/database credential tidak tersedia; Supabase CLI menolak akses.
- Vercel CLI tidak login. Deployment preview GitHub dapat berjalan, tetapi deployment produksi tetap mengikuti `main`.
- Karena migrasi belum dapat diterapkan, `main` sengaja tidak dipindahkan dan smoke test autentikasi/keuangan produksi belum dijalankan. Ini mencegah deployment parsial yang merusak produksi.

