# Ubah metode bayar (klinik) — audit, celah, dan isi paket

Andri 12 Nov 2026: "Ubah metode payment proses ya" = GO untuk paket "koreksi metode bayar" yang tertahan. Dokumen ini: (1) audit apa yang SUDAH live, (2) celah yang benar-benar masih ada, (3) apa yang dikirim, (4) apa yang SENGAJA tidak dikirim (milik sesi lain), (5) cara pakai.

## 1. Bukti rekening (data hosted, baca-saja, 12 Nov)
- Bagian kwitansi klinik (`clinic_payment_receipt_parts`, 100 baris): QRIS→120002 (59), Transfer→120002 (23), Debit→120002 (3), Kredit→120002 (1), Tunai→110xxx per cabang (14). `payment_account_map` hanya berisi Tunai (19 baris); semua non-Tunai jatuh ke 120002 lewat aturan penerimaan yang SUDAH ada: `clinic_private.kas_code` (klinik) dan `unit_posting_cash` (petshop), keduanya `Tunai→110003, selain Tunai→120002` bila peta kosong. E-Wallet: tidak ada baris hidup, tetapi aturan yang sama sudah menerimanya (daftar metode kwitansi memuat E-Wallet) → 120002. **Tidak ada akun, rekening, atau peta baru dibuat.**

## 2. Tabel celah: jalur mengubah metode dokumen yang sudah Lunas

| Kasus | (a) Batalkan penerimaan + terima ulang (LIVE) | (b) Koreksi langsung, nomor dokumen sama, jurnal reklas | Masih perlu? |
|---|---|---|---|
| KLINIK rawat jalan, bayar sekali (kepala tagihan) | Ada: klinik #498 + tanggal efektif #503 (Owner, izin khusus untuk peran lain) | Ada tapi RUSAK/SEMPIT: `correct_clinic_invoice_payment` hanya Tunai↔Transfer dan **membaca peta rekening mentah** → di hosted (peta hanya Tunai) Tunai→Transfer ditolak "belum dipetakan"; QRIS/Debit/Kredit/E-Wallet tidak bisa. 0 koreksi pernah tercatat | **Ya**: 6 metode + aturan rekening live (paket ini) |
| KLINIK rawat jalan, DP di kepala tagihan | Ada (sama) | Sama dengan di atas (bagian "Uang muka") | Ya (paket ini) |
| KLINIK rawat jalan, split / bagian checkout (`invoice_payments` tanpa kwitansi) | Ada | Per bagian, sama dengan di atas | Ya (paket ini) |
| KLINIK rawat inap / pelunasan / uang muka = **kwitansi** (`clinic_payment_receipts` + bagian) | Ada (#498/#503). Alur penuh: batalkan penerimaan → terima ulang | **Tidak ada.** `correct_clinic_invoice_payment` hanya mengubah `invoice_payments`, TIDAK `clinic_payment_receipt_parts` (sumber hitungan laci shift dan pembatalan) → akan merusak sinkron. Kasus "pemilik bayar QRIS, kasir mengetik Tunai" ("sering banget" di ranap) justru ini | **Ya, utamanya**: `correct_clinic_receipt_part_method` (baru) |
| KLINIK uang muka yang dipakai melunasi tagihan | Ada (batalkan penerimaan melepas pemakaian) | Tidak ada | Ya: sama (bagian kwitansi asal uang muka) |
| PETSHOP kasir satu metode | Ada: #499 + tanggal efektif #502 (split didukung) | `correct_pos_sale_payment` (Tunai/Transfer + split) live, tetapi **ditolak untuk ±1.233 baris Tunai 1–6 Nov** (akun lama 110003 ≠ peta sekarang): diperbaiki **PR #510** (migrasi 20261115300000 SUDAH terpasang di hosted, app menunggu merge). Semua-metode: **PR #412** (stale, konflik) | **Dikerjakan sesi lain.** TIDAK diduplikasi di sini |
| PETSHOP split | Ada (#499/#502) | Koreksi pembagian Tunai/Transfer live (+ #510) | Sesi lain |
| PETSHOP marketplace/online | Ada (Batalkan pencairan) | Tidak (ditolak desain: bukan kas kasir) | Tidak |

## 3. Isi paket (migrasi 20261115900000_ubah_metode_bayar.sql; hanya KLINIK)
1. **Koreksi langsung ke 6 metode** untuk pembayaran kepala tagihan/DP/bagian checkout: patch berjangkar (gagal-tertutup) atas fungsi live; rekening tujuan memakai aturan penerimaan live (`clinic_private.kas_code`); rekening sama (QRIS↔Transfer↔Debit…) = hanya label (tanpa jurnal); invoice DEMO dan bagian kwitansi ditolak dengan petunjuk. Tabel audit lama menerima 6 metode.
2. **Ubah metode satu bagian kwitansi** (baru): `correct_clinic_receipt_part_method(kwitansi, bagian, kunci, alasan, metode_baru)`.
   - Memindah **seluruh bagian** (porsi pelunasan tagihan + porsi uang muka bila ada) ke metode/rekening baru: bagian kwitansi dan baris `invoice_payments` turunannya.
   - Jurnal reklas **Dr rekening baru / Cr rekening lama**, sumber `klinik-koreksi-bayar`, bertanggal **hari ini (WIB)**; rekening sama = tanpa jurnal.
   - Nomor kwitansi/tagihan, nominal, status, stok, poin, komisi **tidak berubah**. Jejak tambah-saja `clinic_receipt_method_corrections` (pelaku, peran, alasan, dari/ke, efek kas, shift asal+status, snapshot sebelum/sesudah). Idempoten per (pelaku, kunci). Satu transaksi.
   - Ditolak (fail-closed, pesan jelas): kwitansi batal, tagihan batal/dalam koreksi, ada refund, invoice DEMO, dua bagian bermetode+rekening sama, pembayaran dibalik, rincian kwitansi ≠ pembayaran+uang muka, periode akuntansi tertutup (tanggal kwitansi atau hari ini), rekonsiliasi bank mencakup rekening, akun bukan aset detail aktif.
3. **Izin khusus** `klinik.ubah_metode_bayar` (Akses Grup, bawaan MATI): Owner tidak pernah dikunci; FINANCE tetap boleh (aturan koreksi yang sudah live sejak Okt memang OWNER+FINANCE; tidak ada kemunduran); peran lain hanya bila tertulis eksplisit; gagal baca kebijakan = ditolak untuk peran lain, Owner tetap boleh.
4. **Layar**: Klinik → Pembayaran → (kunjungan) → bagian "UBAH METODE BAYAR KWITANSI" (Owner/Finance/peran berizin) dan panel "Koreksi metode pembayaran" untuk bayar langsung (Owner/Finance).

## 4. Keputusan desain per kasus yang diminta
- **Tanggal efektif = hari ini.** Mundur (backdate) tidak dikerjakan: kalau tanggal asli penting, pakai Batalkan penerimaan bertanggal #503 + terima ulang. Periode tertutup (pada tanggal kwitansi ATAU hari ini) ditolak.
- **Laci shift (Tunai↔non-Tunai).** Hitungan kas shift klinik membaca bagian kwitansi bermetode Tunai di shift yang MENERIMA uang itu; jadi pada shift yang masih terbuka perkiraan kas langsung ikut (Tunai→QRIS: turun; QRIS→Tunai: naik). Shift yang sudah TUTUP tidak dibuka ulang dan angka penutupannya tidak diubah (keputusan Owner 29 Okt, sama dengan koreksi lama); status shift asal dicatat di jejak dan layar memberi peringatan; selisih dicek Finance. Owner tanpa shift terbuka tetap boleh (tidak terkunci). Berbeda dengan Batalkan penerimaan: tidak ada baris kas di shift Owner (tidak ada uang fisik berpindah).
- **Cancel sesudah koreksi** tetap bersih: Batalkan penerimaan memakai rekening/metode saat ini → kas dan bank kembali persis ke sebelum kwitansi (teruji).

## 5. Yang SENGAJA tidak ada (dan kenapa)
- Petshop (semua-metode, struk lama akun Kas Kecil, izin khusus petshop): PR #412/#510 oleh sesi lain; bagian petshop paket lama (`correct_pos_sale_method`, "Ubah penerimaan petshop fase 1" 830000) tidak dikirim agar tidak menimpa/menggandakan. Izin `penjualan.ubah_metode_bayar` bisa ditambahkan di PR petshop mereka.
- Preview tertulis server-side dan revisi sesudah tutup shift berselisih (kartu Finance) milik paket "fase 1": belum.
- Tanggal mundur untuk koreksi, perubahan nominal/diskon, split→satu metode: tidak.

## 6. Cara pakai (Owner)
Klinik → Pembayaran → buka kunjungan → gulir ke **UBAH METODE BAYAR KWITANSI** → pilih bagian (mis. `KWT-… · Tunai Rp…`) → "Metode yang benar" → alasan → **Ubah metode pembayaran**. Untuk pembayaran rawat jalan sekali bayar: panel **KOREKSI METODE PEMBAYARAN** di halaman yang sama.

## 7. Bukti
Native PG17: `scripts/test-ubah-metode-bayar-postgres.py` (kwitansi/idempoten/guard/shift/peran/peta-hosted/balapan/statik), `scripts/test-koreksi-metode-semua-postgres.py` + `supabase/tests/payment_method_any_corrections.sql` (30 pasangan klinik langsung, penolakan), mutan, suite tetangga. Vitest: aksi, panel, sinkron katalog izin. Lihat `kamo-cost-missing-evidence/ship-ubah-metode/report.json` dan `review-self.md`.
