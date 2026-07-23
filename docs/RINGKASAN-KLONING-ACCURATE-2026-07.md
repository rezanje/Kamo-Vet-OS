# Ringkasan: Kloning Fitur Accurate → VetOS (Juli 2026)

> Handoff buat sesi/chat baru. Semua yang di bawah ini **sudah jadi, sudah diuji, dan sudah
> dirilis ke server** (Vercel, push main = auto-deploy). Database Supabase in-sync
> (migrasi 0052–0061). Detail teknis per fitur: `docs/superpowers/specs/`.

## Status Roadmap Paritas Accurate

| # | Fitur | Status | Lokasi di VetOS |
|---|-------|--------|-----------------|
| 1 | Pemindahan Barang antar gudang (Kirim → Transit → Terima, nomor IT.YYYY.MM.NNNNN, terima sebagian) | ✅ | POS & Inventori → Pemindahan barang |
| 2 | Retur Pembelian (potong hutang) & Retur Penjualan (refund tunai kasir, nyambung tutup shift) | ✅ | Pembelian → Retur · Penjualan → Retur |
| 3 | Stok Opname 2 dokumen ala Accurate (Perintah OPO → Hasil OPR, selisih otomatis jurnal) | ✅ | POS & Inventori → Stock opname |
| 4 | Laporan: Laba/Rugi per unit (Semua Klinik / Semua Petshop), Stok matrix semua gudang, Penjualan per cabang & per barang + filter periode | ✅ | Keuangan → Laba Rugi · POS → Stok (matrix) · Penjualan |
| 5 | Faktur Pembelian (hutang lahir dari faktur pemasok, jatuh tempo, bayar per faktur, akun antara 2102) | ✅ | Pembelian → Faktur pembelian · Keuangan → Hutang |
| 6 | Tutup Buku & Kunci Periode (jurnal lama digembok level database, laba → Laba Ditahan) | ✅ | Keuangan → Tutup buku |
| 7 | Penyusutan aset otomatis (catch-up saat halaman Aset dibuka + cron bulanan siap) | ✅ | Keuangan → Aset tetap |
| 8 | PPN + Mode PKP (toggle, default OFF; dulu PPN hardcoded nyala — sudah dikoreksi) + Rekap PPN | ✅ | Pengaturan → Pajak · Keuangan → Rekap PPN |
| 9 | HPP FIFO (PRD §10.2) — cost layers, semua mutasi stok 1 pintu, HPP jurnal = cost riil | ✅ | Otomatis di semua transaksi |
| 10 | Neraca Saldo (trial balance, badge Seimbang) | ✅ | Keuangan → Neraca saldo |
| 11 | Jurnal Berulang (langganan bulanan auto-posting) | ✅ | Keuangan → Jurnal berulang |
| 12 | Manajemen Pengguna (akun per karyawan, role, cabang, link HRIS, nonaktifkan; login page dibersihkan dari akun demo) | ✅ | Pengaturan → Manajemen pengguna |

**Kesimpulan: sisi AKUNTANSI & INVENTORI Accurate sudah 100% pindah ke VetOS.**

## Bonus/perbaikan penting yang nemu di jalan
- Form PO sekarang pilih barang dari master SKU (dulu teks bebas → stok tidak pernah nambah saat PO diterima).
- Bug tanggal hardcoded di halaman Penjualan (kartu "Hari Ini" selalu nol) — fixed.
- Klinik dulu selalu menambah PPN 11% ke tagihan pelanggan padahal belum tentu PKP — sekarang ikut toggle Mode PKP (default OFF).
- Konfirmasi email Supabase di-bypass via trigger DB (dashboard tak punya toggle-nya) — akun baru langsung bisa login. Insiden "Enable email provider" sempat kematiin (semua login mati) — sudah pulih.

## Keputusan bisnis yang sudah dikunci (jangan tanya ulang)
- Pemindahan barang: langsung kirim TANPA approval (ala Accurate).
- Retur jual = refund tunai kasir; retur beli = potong hutang pemasok.
- PPN: dibangun penuh, aktif via toggle Mode PKP (status PKP belum pasti → default OFF).
- HPP: FIFO (sesuai PRD §10.2).

## Sisa backlog (belum dikerjakan)
1. **Online/B2C** — jalur jualan online terpisah (gudang WH ONLINE); penutup roadmap Accurate.
2. **WA otomatis** — kode follow-up klinik & retensi sudah ada, mati karena `FONNTE_TOKEN` belum diisi (nunggu token dari boss).
3. **CRM Retensi screen** (7 trigger WA) — belum dibangun; tergantung #2.
4. Opsional ops: `SUPABASE_SERVICE_ROLE_KEY` + `CRON_SECRET` di Vercel → nyalain cron penyusutan bulanan (tanpa ini pun aman, ada lazy catch-up).
5. Opsional data: bersihkan PPN historis era hardcoded (Jun–Jul ± Rp 470rb di 2201) kalau dipastikan non-PKP.

## Fakta teknis buat sesi baru
- Repo: `~/Gen_Dev_Studio/VET_OS` · GitHub `rezanje/Kamo-Vet-OS` · push main = auto-deploy Vercel (kamo-group).
- Supabase project `koaglxcyjqfmgfzxszkj`; migrasi via MCP `apply_migration`; RLS mode demo (permissive).
- Tes: `npm test` (170 lolos) · `tsc --noEmit` bersih · pola: logika murni di `src/lib/*.ts` + test.
- Akun uji: `claude-test@vetos.local` / `password123` (ADMIN, tidak lagi dipajang di login page).
- Jangan `npm run build` saat dev server preview nyala (rusak `.next`).
- Nomor dokumen: IT/RB/RJ/FB = per bulan; OPO/OPR = global; via count+1 (ponytail).
