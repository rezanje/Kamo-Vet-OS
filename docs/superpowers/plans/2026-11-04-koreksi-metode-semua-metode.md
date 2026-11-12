# Edit transaksi ala Accurate, tahap A — koreksi metode bayar ke SEMUA metode (petshop kasir + klinik rawat jalan)

Base: main 4b53ec31. Worktree `/opt/data/kamo-wt-koreksi-metode` (branch hermes/koreksi-metode-semua). Migrasi ≥ 20261106700000. Lokal saja.

## 0. Hasil langkah 1: kenapa sekarang hanya Tunai↔Transfer?
| Saluran | RPC | Penyebab batasan | Alasan akuntansi nyata? |
|---|---|---|---|
| Petshop | `correct_pos_sale_payment(sale, rev, key, reason, p_cash, p_transfer)` | Antarmuka literal "jumlah Tunai + jumlah Transfer"; bagian lain (Debit/Kredit/QRIS/E-Wallet) dibiarkan apa adanya. Peta rekening dibaca hanya untuk Tunai & Transfer (`cash_code<>transfer_code`). | Sebagian: **fee merchant ditanggung pelanggan** (`sale_payments.fee_percent/fee_amount`, baris jurnal 4303, `sales.total` sudah termasuk fee, constraint `Tunai ⇒ fee 0`). Metode bernilai fee tidak bisa dipindah tanpa mengubah total/pendapatan 4303. Untuk struk fee = 0 (bawaan: kasir harus mengetik persen) tidak ada penghalang. |
| Klinik rawat jalan | `correct_clinic_invoice_payment(...,p_new_method)` | Murni whitelist `in('Tunai','Transfer')` di 3 tempat + tabel audit `check(... in('Tunai','Transfer'))` + `from_code<>to_code`. Jurnal koreksi sudah generik (Dr rekening baru / Cr rekening asal dari jurnal). | Tidak untuk invoice biasa (tanpa fee). **Ada** untuk invoice DEMO (snapshot fee per metode, `clinic_demo_invoice_snapshots`) dan bagian kwitansi rawat inap (`invoice_payments.receipt_id`, parts kwitansi menyimpan metode+kas_code sendiri). |
Tidak ada akun kliring/settlement: semua metode langsung ke satu rekening kas/bank lewat `payment_account_map` → `unit_posting_cash`. Bila peta kosong: Tunai→1101, semua selain Tunai→1102 (rekening SAMA).
**Keputusan**: bukan blocker total. Alasan fee/DEMO/kwitansi ditangani sebagai PENOLAKAN eksplisit (bukan tebakan); memo opsi untuk fee ada di §8.

## 1. Kontrak
Satu transaksi → satu metode baru (salah satu dari 6, sumber tunggal `src/lib/metode-bayar.ts`). Nominal, total, diskon, pajak, baris, stok, HPP tidak berubah. Hanya sisi debit kas/bank di jurnal dan label metode.

### Petshop — RPC BARU `correct_pos_sale_method(p_sale_id, p_expected_revision, p_request_key, p_reason, p_new_method)`
`correct_pos_sale_payment` (Tunai/Transfer + split) TIDAK diubah (byte-identik). RPC baru memakai ulang tabel/gerbang/trigger yang sudah terbukti (`sale_payment_correction_gate`, `sale_payment_corrections`, `sale_payment_correction_requests`, `pos_sale_protect_header`, `pos_sale_allocation_immutable`, jurnal 'sale-payment-reversal' / 'sale-payment-repost').
Tambahan skema: `sale_payment_corrections.from_method/to_method` (nullable; baris lama null).
- Peran: OWNER, FINANCE aktif + `user_can_access_branch` (sama dengan RPC lama; ADMIN TIDAK ditambah — lihat pertanyaan 1).
- Sumber boleh: non-online, tidak void, `payment_plan` final, total>0, tepat 1 baris `sale_payments` senilai total, fee=0 (`merchant_fee_total=0`), tanpa retur/refund/permintaan refund, periode sumber & hari koreksi terbuka, revisi cocok, jejak koreksi cocok revisi, jurnal aktif = non-aset (posting.expected_lines) + alokasi, akun sumber = peta sekarang (aturan lama), rekening lama & baru aset-detail aktif, tidak ada rekonsiliasi bank yang menutup rekening lama/baru sejak tanggal sumber.
- Shift: baris shift dikunci FOR UPDATE; shift tertutup TIDAK dibuka dan angka penutupannya tidak diubah (keputusan Owner 29 Okt, sama dengan RPC lama); status dicatat `source_shift_status`. Shift terbuka: hitungan tutup shift membaca `sale_payments` → otomatis ikut.
- Split (lebih dari 1 metode): DITOLAK di RPC baru dengan pesan arahkan ke koreksi pembagian Tunai/Transfer yang sudah ada (tetap tersedia di layar untuk split).
- Idempoten: `(actor, request_key)` di `sale_payment_correction_requests`, payload memuat method baru; ulang = hasil sama tanpa efek; payload beda = ditolak.
- Jurnal: pembalik penuh jurnal aktif + pengganti (baris non-aset disalin; satu baris debit rekening metode baru). Bila rekening lama = baru (peta bersama, mis. Transfer→QRIS dengan peta kosong): tetap dua jurnal (net 0) supaya jejak seragam dan tidak ada cabang baru; total saldo akun tidak berubah.
- Kembalian: Tunai→non-Tunai: bayar:=total, kembali:=0 (aturan J02_KEMBALIAN yang sama); non-Tunai→Tunai: tidak diubah.

### Klinik rawat jalan — `correct_clinic_invoice_payment` diperlebar (anchored patch, signature/ACL/definer/search_path/lock_timeout tetap)
- `p_new_method` dan metode lama: 6 metode.
- Penolakan BARU (lebih ketat, berlaku juga untuk Tunai↔Transfer): invoice DEMO (ada `clinic_demo_invoice_snapshots`); bagian pembayaran milik kwitansi rawat inap (`invoice_payments.receipt_id is not null`).
- Rekening lama = baru: label-only (tanpa jurnal; `journal_id` nullable, check `journal_id is null ⇔ from_code=to_code`). Sebelumnya ditolak "Rekening asal dan tujuan sama".
- Peran tetap OWNER/FINANCE. Split klinik: per bagian (sudah didukung kode lama) — termasuk semua metode.
- Tabel audit: check metode diperlebar ke 6.

## 2. Tabel kasus & efek jurnal (petshop; klinik sama, 2 baris)
Untuk setiap (dari→ke), dari≠ke, 6×6−6=30 pasangan, total T, peta lengkap A_m = akun metode m:
- Sebelum: Dr A_dari T / Cr non-aset (pendapatan, PPN, dst) T.
- Pembalik (hari koreksi): Dr non-aset / Cr A_dari T. Pengganti: Dr A_ke T / Cr non-aset.
- Efek bersih per akun: A_dari −T, A_ke +T, semua lain 0. Jika A_dari = A_ke: semua 0.
Uji native: seluruh 30 pasangan petshop + 30 klinik (langsung), bandingkan trial balance per akun sebelum/sesudah = selisih tepat di dua akun saja.

## 3. Refusal (pesan Indonesia, mengatakan apa yang harus dilakukan)
retur/refund | void | online | split → pakai koreksi pembagian | fee merchant → batalkan & input ulang (OWNER) | revisi basi → muat ulang | periode tertutup | rekonsiliasi bank | peta berubah | peran bukan OWNER/FINANCE | cabang | metode tidak dikenal/sama | jurnal tak cocok | (klinik) refund, DEMO, kwitansi rawat inap, invoice void/pending, bagian pindahan.

## 4. Daftar uji native (PG17, `supabase/tests/payment_method_any_corrections.sql`)
P1 30 pasangan petshop (jumlah, metode, jurnal seimbang 2×, trial balance, audit from/to). P2 shift tertutup (FINANCE) tidak berubah; shift terbuka: breakdown tutup ikut. P3 replay kunci sama; payload beda ditolak; stale rev. P4 peran: STAFF, ADMIN ditolak, OWNER/FINANCE lolos; FINANCE cabang lain ditolak. P5 refund/retur, void, split, fee>0, online, periode tertutup, rekonsiliasi bank, peta drift, rollback paksa (audit gagal). P6 koreksi berantai (A→B→C) saldo benar. P7 kembalian. P8 tidak bisa dibatalkan setelah koreksi (guard lama tetap). K1 30 pasangan klinik (langsung); K2 split per bagian multi-metode; K3 DP + pelunasan; K4 DEMO ditolak; K5 receipt_id ditolak; K6 label-only rekening sama; K7 replay/peran/periode/rekon/rollback; K8 suite lama J02 tetap hijau. Mutasi: tiap penjaga di atas dihapus satu per satu ⇒ ≥1 FAIL.

## 5. UI
`src/lib/metode-bayar.ts` tetap sumber opsi. Petshop: panel baru "Ganti metode pembayaran" di /penjualan/[id] (dropdown 5 metode lain, alasan wajib, tampil hanya untuk single-method fee-0); form Tunai/Transfer lama tetap untuk split. Klinik: form per bagian pilih metode tujuan dari daftar.

## 6. NOT in scope
Edit diskon / nominal belanja (stage berikutnya), struk online, split → metode tunggal (dan sebaliknya), fee merchant, invoice DEMO, kwitansi rawat inap, penggabungan jurnal pembalik berlapis.

## 8. Memo keputusan fee merchant (tidak dikerjakan; default = tolak)
Fee ditanggung pelanggan dan sudah masuk `total`. Opsi untuk struk fee>0 (mis. Debit 1%): (a) tolak, batalkan+input ulang [DEFAULT]; (b) ganti metode, fee tetap (struk tidak berubah, fee jadi biaya tetap walau metode baru tak berfee; perlu longgarkan constraint `sale_payments_fee_base` untuk Tunai) ; (c) hitung ulang fee metode baru → total berubah → butuh refund/tagih selisih (uang pelanggan) = bukan koreksi label. Perlu keputusan Andri/Reza.

## 9. Hasil bukti (native PostgreSQL 17.11, fixture fiktif)
- `scripts/test-koreksi-metode-semua-postgres.py`: RED (`--baseline`, tanpa migrasi) gagal "function correct_pos_sale_method does not exist"; GREEN lulus `supabase/tests/payment_method_any_corrections.sql` (30 pasangan petshop + 30 pasangan klinik + kasus penolakan); `--mutations`: kontrol lulus, 23/23 mutan gagal; `--regression`: suite J02 lama (`pos_payment_method_corrections.sql`, `clinic_payment_method_corrections.sql`) tetap lulus di rantai kandidat.
- Fungsi tidak berubah (definisi+ACL+owner byte-identik): correct_pos_sale_payment, pos_sale_protect_header, unit_posted_sale_source_immutable, pos_sale_allocation_immutable, cancel_posted_sale, pos_sale_record_payments, guard_clinic_payment_corrected_invoice, clinic_write_journal. correct_clinic_invoice_payment: hanya isi fungsi berubah; SECURITY DEFINER/search_path/lock_timeout/ACL/owner sama.
- Belum diuji native: kanal online (guard ada, tidak ada fixture), refund klinik (guard lama), tutup-shift tahap konkurensi (lock FOR UPDATE sama dengan RPC lama), peta rekening berganti sesudah koreksi klinik, hosted DB, browser/layar nyata.
