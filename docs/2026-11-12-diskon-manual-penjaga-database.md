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

## Uji back (Production, baca-saja, 90 hari)
- Petshop 4.949 struk, 1.208 berdiskon. Yang akan ditolak untuk peran tanpa izin: 61 (59 oleh STAFF). 17 karena potongan melebihi batas master
  (dinilai dengan promo yang aktif HARI INI): 13 struk STAFF terjadi karena promo B1G1 yang sudah dinonaktifkan sesudah transaksi (bukan diskon ketikan),
  2 struk STAFF dan 2 struk OWNER diskon ketikan asli; 44 karena diskon baris ketikan (bukan diskon bawaan master).
- Klinik 899 tagihan, 99 berdiskon; 10 melebihi batas master (diskon nota ketikan 9.000–40.000).
- Konsekuensi yang disengaja: promo yang dinonaktifkan Owner saat keranjang masih terbuka membuat simpan ditolak (batas dihitung dari promo yang aktif saat disimpan).

## Pengujian
- `supabase/tests/diskon_manual_izin.sql` (PostgreSQL 17 native, data fiktif, 100 pernyataan lulus) dan `diskon_manual_izin_red.sql` (RED:
  sebelum migrasi STAFF/DOCTOR/ADMIN/FINANCE menyimpan diskon di database; sesudahnya ditolak).
- 34 mutan migrasi: 33 terbunuh; 1 setara (`+least(v_hdr, v_old_hdr)` sudah dijaga pemeriksaan sebelumnya).
- 167 suite SQL lama dijalankan tanpa dan dengan migrasi: hasil sama; lima fixture yang memposting diskon ketikan sebagai STAFF/DOCTOR diberi izin
  `kasir.diskon_manual` (c05_voucher_lewat_kampanye menyamakan diskon dengan nilai voucher), fixture lain tidak berubah.

## Rilis
Migrasi `20261116100000` dipasang dulu (satu transaksi, tanpa begin/commit sendiri), aplikasi tidak berubah. Pemasangan memeriksa
`manual_discount_allowed()` sudah ada. Rollback: `ROLLBACK.sql` di `prod-backups/diskon-manual-<waktu>/`.
