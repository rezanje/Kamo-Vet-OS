# Struk WA otomatis setelah bayar — semua kasir (14 Nov 2026)

Pelapor: Aldi — "Kalau bisa saat klik pembayaran langsung direct ke wa gitu mas jadi mau ga mau dia kirim."
Keputusan Reza: **opsi A** — struk dikirim otomatis dari nomor WA klinik (Fonnte), bukan dibuka di HP kasir.

## Temuan
- Struk WA sudah ada untuk pembayaran klinik rawat jalan tunggal (`bayarVisit` → `kirimStrukWa`).
- Tapi tabel `whatsapp_message_log` hanya bisa ditulis OWNER/ADMIN (RLS 0136). Kasir biasa → insert log
  gagal → `kirimStrukWa` berhenti diam-diam. Artinya struk WA praktis tidak pernah terkirim saat kasir
  biasa yang menekan Bayar.
- Struk ikut saklar `is_enabled` (pengingat retensi). Kalau retensi dimatikan, struk ikut mati.
- Kasir toko (`/kasir`), POS (`/pos/transaksi`), bayar rombongan, pelunasan DP, dan rawat inap belum
  mengirim struk WA sama sekali.

## Perubahan
- Migrasi `20261119100000_struk_wa_semua_kasir.sql`:
  - `wa_engine_settings.receipt_enabled` (bawaan `true`) — saklar struk sendiri.
  - `wa_struk_catat(...)` / `wa_struk_tandai(...)` SECURITY DEFINER untuk akun aktif. Catat hanya bila
    nomor transaksi ada (sales.no_struk / invoices.invoice_no milik pelanggan itu) dan nomor HP sama dengan
    data pelanggan. Idempotensi `receipt:<nomor>` (anti dobel). RLS riwayat WA tidak dilonggarkan.
- `src/lib/wa-engine.ts`: `kirimStrukWa` memakai fungsi DB; jatuh ke tulis langsung bila migrasi belum
  terpasang. Saklar `strukWaAktif` (pakai `receipt_enabled`, fallback `is_enabled`). Pesan menampilkan
  baris "Potongan"/"Biaya lain" bila total ≠ jumlah rincian.
- `src/lib/struk-wa.ts`: `kirimStrukWaPenjualan(saleId)`, `kirimStrukWaInvoiceKlinik(invoiceId)` (hanya
  Lunas; isi paket digabung jadi nama paket), `setelahResponsStruk` (Next `after`, tidak menahan kasir,
  tidak pernah menggagalkan pembayaran).
- Disambung ke: kasir toko, POS transaksi, bayar rombongan (per nota), pelunasan DP rawat jalan,
  rawat inap (`terimaPembayaran`, `simpanBayar` — hanya bila invoice menjadi Lunas).
- Pengaturan WA: saklar "Kirim struk ke WA pelanggan setiap pembayaran" (muncul setelah migrasi).
- Pelanggan umum tanpa nomor HP dilewati.

## Tes
- `src/lib/__tests__/struk-wa.test.ts` (13 tes) + uji WA lama tetap lulus.
- Golden kasir/POS (`promo-flags-off-equivalence-*`) me-mock struk-wa seperti quest/tier (efek samping
  setelah respons) — jejak checkout tidak berubah.
- Lengkap: vitest 9043 lulus, tsc bersih, lint 0 error, build sukses.

## Syarat live
1. Migrasi di atas dipasang di Production.
2. `FONNTE_TOKEN` terpasang di Vercel Production dan nomor pengirim Fonnte aktif (belum bisa dicek dari
   sesi ini — akses baca Production ditolak).
3. Merge ke `main` (auto-deploy).
Cek setelah live: bayar 1 transaksi dengan pelanggan bernomor uji → Pengaturan → WA Engine → riwayat
"Struk pembayaran" berstatus Terkirim.

## Belum dikerjakan
- Kirim ulang struk manual dari halaman struk (bila gagal/nomor salah).
- Struk koreksi/terbit ulang (void & reissue) tidak dikirim ulang otomatis.
