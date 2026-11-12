# 2026-11-12 — Diskon manual hanya Owner/Admin

## Laporan
Grup Kamo, 12 Nov 2026 (13.31–13.38 WIB). Aldi: "Eh ini anak toko bisa kasih diskon?". Andri memeriksa kode dan database:
semua peran yang bisa membuka kasir (termasuk Staff) bisa memberi diskon manual, tanpa pembatas peran maupun batas maksimal.
Keputusan Aldi: **"Yg diskon jangan dikasih ke karyawan mas biar akun admin ajh"**.

Catatan: layar Akses Grup sebelumnya menulis "harga/diskon transaksi manual tetap khusus OWNER aktif", padahal itu tidak
pernah ditegakkan. Kalimat itu sudah dibetulkan.

## Yang dimaksud "diskon manual"
Angka yang **diketik kasir**:
- Kasir petshop (`/kasir`): potongan per barang (Rp/%) dan diskon total struk.
- POS back-office (`/pos/transaksi`): kolom "Diskon manual / promo".
- Pembayaran klinik (`/klinik/pembayaran/[visitId]`): diskon % per baris (termasuk baris paket) dan diskon total invoice.

**Tidak** dibatasi (ditentukan master/sistem, bukan diketik): promo otomatis, promo syarat-hasil, voucher, kode kampanye,
poin, diskon golongan member, dan diskon bawaan barang dari master (`items.default_discount`, terpasang otomatis di kasir).

## Perbaikan
1. Migrasi `20261115100000_diskon_manual_owner_admin.sql`
   - Katalog Akses Grup: tindakan `kasir.diskon_manual` (enforced, grup "Kasir & Tagihan", modul `kasir`).
   - Fungsi `public.manual_discount_allowed()` (SECURITY DEFINER, STABLE, hanya `authenticated`):
     OWNER selalu `true` (tidak membaca tabel kebijakan); peran tanpa kebijakan tindakan tersimpan (legacy) → hanya ADMIN;
     peran berkebijakan → bila izin dicentang Owner. Galat apa pun → `false`.
   - Tidak mengubah data, jurnal, stok, atau transaksi lama.
2. `src/lib/manual-discount.ts`: pemanggil RPC (fail-closed), pesan penolakan, dan aturan murni:
   - kasir: diskon total wajib 0; potongan per barang hanya boleh bila persis diskon bawaan master (persen) barang itu;
   - klinik: tagihan baru tanpa diskon manual; koreksi tagihan boleh mempertahankan/mengurangi diskon tersimpan
     (per `source_invoice_item_id` dan diskon total), tidak boleh menambah.
3. Server action (penentu akhir): `src/app/kasir/checkout.ts`, `src/app/(app)/pos/transaksi/actions.ts`,
   `src/app/(app)/klinik/pembayaran/[visitId]/actions.ts` (`bayarVisit`) menolak sebelum menulis apa pun.
   `bayarRombongan` tidak menerima diskon manual sejak awal; tagihan rawat inap bertahap sudah mengunci diskon.
4. Layar: tanpa izin, kolom diskon disembunyikan (kasir petshop, POS back-office) atau dikunci baca-saja dengan
   keterangan "Diskon manual hanya bisa diberikan Owner/Admin" (klinik — diskon lama tetap terlihat). Draf lama yang
   terlanjur berisi diskon dibersihkan saat dipulihkan (kasir: kembali ke diskon bawaan; klinik: dibatasi ke yang tersimpan).
5. Akses Grup: `kasir.diskon_manual` adalah izin khusus dengan pengecualian bawaan per peran
   (`GRANT_ONLY_LEGACY_ROLES` di `src/lib/role-grant-only-actions.ts`): editor menampilkan ADMIN legacy tercentang,
   peran legacy lain tidak; label "izin khusus (bawaan hanya ADMIN; OWNER selalu boleh)". Simpan "tanpa perubahan"
   untuk peran legacy tetap tidak membuat kebijakan baru.

## Pengujian
- `python3 -I scripts/test-diskon-manual-postgres.py` (PostgreSQL 16 native, 413 migrasi, data fiktif): sebelum migrasi
  fungsi belum ada; pasang ulang gagal; katalog enforced; anon tidak bisa memanggil; bawaan OWNER/ADMIN boleh,
  STAFF/DOCTOR/FINANCE/akun nonaktif/tanpa login tidak; Owner mencentang STAFF lewat simpan Akses Grup resmi → boleh;
  Owner menyimpan ADMIN tanpa izin → tidak boleh; non-owner tidak bisa mengubah (ROLE_OWNER_REQUIRED). **Lulus.**
- vitest: `manual-discount.test.ts` (aturan murni, fail-closed, editor Akses Grup, sinkron migrasi),
  `manual-discount-checkout-actions.test.ts` (kasir + back-office: diskon total ditolak tanpa izin & tidak ada transaksi
  tersimpan; tanpa diskon tetap jalan; dengan izin tersimpan; potongan per barang ditolak; diskon bawaan master lolos;
  menaikkan diskon bawaan ditolak), blok baru di `promo-baris-posting.test.ts` (klinik: diskon total & per baris ditolak
  tanpa posting; promo tetap jalan; koreksi menaikkan diskon ditolak).
- 8 berkas uji lama yang memakai diskon manual dijalankan sebagai Owner/Admin (mock `manualDiscountAllowed` → true);
  uji kesetaraan hash log DB (`promo-flags-off-equivalence-*`) tetap identik.

## Rilis
- **Pasang migrasi dulu (atau bersamaan) sebelum deploy aplikasi.** Kalau aplikasi sudah jalan tapi fungsi belum ada,
  pemeriksaan gagal-tertutup: Owner/Admin pun tidak bisa memberi diskon manual sampai migrasi dipasang (transaksi tanpa
  diskon tetap normal).
- Pemeriksaan sebelum pasang (baca-saja): `select to_regprocedure('public.manual_discount_allowed()')` → NULL;
  `select * from role_settings_private.action_catalog where id='kasir.diskon_manual'` → kosong.
- Sesudah pasang: `select id, enforced from role_settings_private.action_catalog where id='kasir.diskon_manual'` → `true`;
  `select role, allowed from role_settings_private.action_policies` — peran yang SUDAH punya kebijakan tersimpan tidak
  otomatis mendapat izin ini (termasuk ADMIN bila kebijakannya sudah disimpan); Owner perlu mencentangnya di Akses Grup.

## Sisa
- Penegakan ada di server aplikasi (berbasis izin dari database). Kolom `sales.discount` menggabungkan diskon manual
  dengan potongan lain, jadi tidak ada trigger database terpisah untuk diskon total; panggilan API mentah di luar
  aplikasi tidak ditutup oleh perubahan ini (sama seperti sebelumnya).
- Faktur penjualan grosir/back-office di modul Penjualan tidak termasuk (bukan kasir; dikerjakan Admin/Finance).
- Koreksi struk kasir (ganti struk) oleh Staff atas struk yang dulu diberi diskon Owner/Admin: diskonnya perlu dihapus
  atau koreksi dilakukan Owner/Admin.
