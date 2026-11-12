# 2026-11-12 — Diskon manual: penjaga di database (lanjutan Owner/Admin)

## Latar
Andri (11-12 Nov): "tolong jangan sembarang kasih diskon, hanya Role yang dikasih akses saja". Izin `kasir.diskon_manual` dan
`manual_discount_allowed()` sudah live (migrasi `20261112072724`, PR #509) dan server aplikasi sudah menolak diskon ketikan dari peran
tanpa izin. Yang tercatat sebagai "sisa" di dokumen itu: **database sendiri belum menolak**, jadi klien yang dimodifikasi atau panggilan API
mentah tetap bisa menyimpan diskon. Migrasi ini menutup itu. Tidak ada izin baru, tidak ada id katalog baru: semuanya memakai
`manual_discount_allowed()` yang sudah ada (OWNER selalu; ADMIN tanpa kebijakan tersimpan boleh; peran berkebijakan bila dicentang Owner).

## Yang ditolak database untuk peran tanpa izin
- Petshop (kasir `/kasir` dan POS back-office menulis langsung ke tabel): diskon baris yang diketik (nominal, atau persen yang tidak sama dengan
  `items.default_discount`) dan total potongan struk yang lebih besar daripada yang bisa dibenarkan master (promo aktif untuk barang itu,
  voucher/kode kampanye, diskon golongan, poin). Pemeriksaan penuh saat struk difinalkan (`finalize_pos_sale` mengisi `payments_finalized_at`).
- Klinik: `clinic_post_invoice` dan `clinic_edit_invoice_core` memanggil `clinic_private.assert_manual_discount`: diskon baris (`diskon_persen`) yang
  naik, dan diskon nota yang naik di atas yang bisa dibenarkan master. Koreksi yang mempertahankan/menurunkan diskon Owner tetap boleh.
- Pesan: "Anda tidak punya izin memberi diskon manual. Minta Owner mengaktifkannya di Pengaturan > Akses Grup." atau
  "Diskon melebihi yang bisa dibenarkan promo, voucher, golongan, atau poin. ...".

## Yang TIDAK terpengaruh
Promo master, diskon bawaan barang (persen sama dengan master), voucher/kode kampanye, diskon golongan, poin, paket, struk marketplace
(`sales.channel` terisi), dokumen terbitan ulang (`clinic_void_reissue_invoice_core` membawa kolom jejak), OWNER dan peran berizin (tidak
diperiksa batasnya), tugas sistem / SQL editor tanpa pengguna login.

## Jejak
Kolom opsional `sales.manual_discount` dan `invoices.manual_discount` (bawaan 0, tidak boleh melebihi diskon dokumen). **Aplikasi belum
mengisinya** (aplikasi #509 tidak mengirim kuncinya); kolom itu disiapkan supaya rilis aplikasi berikutnya bisa mencatat bagian diskon
yang diketik per dokumen. Sampai itu, jejak pemberi diskon = `cashier_id` dokumen + nilai `discount`.

## Uji balik (Production, baca-saja, rollback-only, 90 hari) dan keputusan risiko
- Petshop, struk selesai berdiskon oleh peran selain OWNER: 1.222. Dengan fungsi penjaga sungguhan (menghormati klaim promo bundling/kolam kuantitas) yang akan ditolak: 51 (semua STAFF):
  44 karena diskon baris ketikan (bukan diskon bawaan master) dan 7 karena total potongan melebihi batas master (2 tanpa dasar sama sekali, 5 memakai promo 'Free ANC Creamy' yang sudah dinonaktifkan sesudah transaksi).
  (Angka awal 61/1.208 memakai perhitungan lebih kasar yang tidak menghitung klaim promo; yang di atas yang benar.)
- Klinik 899 tagihan, 99 berdiskon; 10 melebihi batas master (diskon nota ketikan 9.000-40.000) — angka dari uji balik awal, tidak dihitung ulang.
- **Promo dicabut saat keranjang terbuka**: kasir (server) menghitung ulang promo dari master saat bayar (`src/app/kasir/checkout.ts`: "Promo dihitung ULANG di server dari master"), sehingga
  struk dari aplikasi tidak membawa promo yang sudah dicabut dan tidak ditolak. Database tidak bisa tahu kapan keranjang dihitung, jadi ia menilai terhadap promo yang berlaku saat struk
  difinalkan (tidak dilonggarkan). Bila terjadi balapan, penolakan terjadi di dalam transaksi finalisasi yang sama (stok, jurnal, pembayaran ikut batal; struk tertunda dihapus aplikasi)
  dengan pesan "... Jika promo sudah tidak berlaku, muat ulang keranjang." Promo bundling/kolam kuantitas memakai klaim tersimpan sehingga tidak terpengaruh.
- Klinik: OWNER, koreksi Owner, struk terbit ulang/batalkan penerimaan (tidak melewati penjaga ini) dan tanggal mundur tidak terpengaruh; koreksi yang tidak menaikkan diskon tetap boleh.
- OWNER dicek lebih dulu oleh `manual_discount_allowed()` tanpa membaca tabel kebijakan/katalog (diuji: tabel kebijakan dan katalog hilang tetap lolos untuk Owner).

## Pengujian
- `supabase/tests/diskon_manual_izin.sql` (PostgreSQL 17 native, data fiktif, 114 pernyataan lulus) dan `diskon_manual_izin_red.sql` (RED:
  sebelum migrasi STAFF/DOCTOR/ADMIN/FINANCE menyimpan diskon di database; sesudahnya ditolak).
- 39 mutan migrasi: 38 terbunuh; 1 setara (`+least(v_hdr, v_old_hdr)` sudah dijaga pemeriksaan sebelumnya).
- 167 suite SQL lama dijalankan tanpa dan dengan migrasi: hasil sama; lima fixture yang memposting diskon ketikan sebagai STAFF/DOCTOR diberi izin
  `kasir.diskon_manual` (c05_voucher_lewat_kampanye menyamakan diskon dengan nilai voucher), fixture lain tidak berubah.

## Rilis
Migrasi `20261116100000` dipasang dulu (satu transaksi, tanpa begin/commit sendiri), aplikasi tidak berubah. Pemasangan memeriksa
`manual_discount_allowed()` sudah ada. Rollback: `ROLLBACK.sql` di `prod-backups/diskon-manual-<waktu>/`.
