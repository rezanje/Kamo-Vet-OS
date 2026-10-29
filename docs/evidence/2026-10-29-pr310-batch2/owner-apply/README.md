# PR #310 batch 2 (P03/J02/N01/K08/K14/C05/I09/M04) — paket langkah database untuk pemegang akses production

**Belum ada yang dijalankan ke production.** Jalankan dengan akses owner Supabase (`postgres`), berhenti di langkah
mana pun yang hasilnya tidak sesuai. Repo ini bisa terbaca pihak lain: **jangan menulis ID project, jumlah data,
atau keluaran query production ke repo/PR** — catat di catatan rilis privat.

## Syarat dan urutan rilis

Batch 2 dipasang **sesudah** semua migrasi main dan **sesudah batch 1**
(`docs/evidence/2026-10-29-pr310-k08-a01-q01/owner-apply`, readback `0 failed`). `apply.sql` menolak jalan
(`PR310B2_BATCH1_MISSING`) bila batch 1 belum tercatat, karena K14 menimpa fungsi pemulangan rawat inap yang
diubah batch 1 — batch 1 yang dipasang belakangan akan menghapus tarif pet hotel.

Disarankan: **batch 1 → preflight → apply → readback → merge PR #310 → cek layar.** Jalankan di jam sepi: apply
membuat trigger di `journal_entries`, `journal_lines`, `stock_moves`, `stock_layers`, `sales_invoices`, `invoices`
dan dua index (`clinic_compound_sales`, `invoices`) tanpa `concurrently`; tulis ke tabel itu tertahan sebentar.

## File

| Urutan | File | Menulis? | sha256 |
|---|---|---|---|
| 1 | `preflight.sql` | tidak | `4be7fcec95cc7709a51b6875401756a28aa995b99b4b5872408c10ed681ff409` |
| 2 | `apply.sql` | **ya** — satu transaksi | `1c856244c204f50a3a9bf1670a7527c154a5083b40f2346a591243533e8f2ea9` |
| 3 | `readback.sql` | tidak | `755e9f3def91a22f01f88b03433f993388465cf8a4a3746fc4544f5a61eb0f23` |
| — | `rollback.sql` | **ya** — hanya bila diputuskan mundur | `fd77cff1797029494a3780b55ed2ac6f0efa4a882761b66154569ffca8050dcf` |

`apply.sql`, `preflight.sql` dan `readback.sql` dihasilkan `build-and-rehearse.py` (jangan diedit tangan). Nilai md5
di preflight (definisi fungsi sebelum apply) dan readback (sesudah apply) diambil dari gladi bersih; production
harus sama persis. `apply.sql` memuat sepuluh migrasi berikut apa adanya, urut nama file:

| Migrasi | sha256 |
|---|---|
| `20261101100000_p03_harga_bawah_hpp_kasir_klinik.sql` | `77703b7b5ad70f590860ad3374ecffe2347fad3a87cdb6aad7dba95cab4b0ab7` |
| `20261101110000_j02_pos_correction_after_shift_finance.sql` | `41f1c939e399f401640be9fa5ac92c1347c2dca5cf55342daf309708b74abb17` |
| `20261101111000_j02_clinic_payment_correction.sql` | `0014babf1579d8da04afa1f72bdaf5c4a947a578711eea266aab0b60ebab3b2f` |
| `20261101130000_n01_retur_faktur_grosir.sql` | `227591929b76fc031b2d8c6eaca6674239c94f87524d3036cbc222a6494da266` |
| `20261101140000_k08_admission_requires_settled_invoice.sql` | `d9696ec68d010bd3aa1fd9d8b32a96082e44a9670b443fd815a0c68e55cdc73e` |
| `20261101141000_k14_pet_hotel_checkin_tariff.sql` | `9f6a1d82bc34d7789cd95388db85f264ca359a83e4f70fceebb8ac409b47629c` |
| `20261101150000_c05_voucher_hanya_lewat_kampanye.sql` | `58ca8acf3b372444bd791e0d283fd0ae58c9f70b0d193971944a64e507d77b88` |
| `20261101151000_i09_riwayat_induk_racikan.sql` | `bdcd1506bf62fd69ee0d3abb69f278c245229b08c0aa31314fbfb2b715b08a82` |
| `20261101152000_c05_rombongan_nota_pendamping.sql` | `5fd1f3f88752d5faedfd409bf33e8d1e959eeb9af7e00d5feb83b96a0b9dc093` |
| `20261101160000_opening_stock_line_rupiah_rounding.sql` | `749a82309cb325a3a6bcd441954a1027922c9df42354791b7d63186a60b2a8d3` |

## Dampak

Semua fungsi yang diganti mempertahankan signature, SECURITY DEFINER, `search_path=''` dan pemilik `postgres`;
readback memeriksa md5 definisi, atribut itu, dan hak eksekusi `authenticated`/`anon`/`service_role`/`PUBLIC`.

- **P03:** `cashier_post_stock_atomic`, `clinic_post_invoice`, `clinic_edit_invoice_core` ditambal berjangkar (gagal
  keras bila teksnya beda); fungsi baru `clinic_private.rupiah_text`, `clinic_private.assert_invoice_price_floor`
  (tidak bisa dipanggil pengguna).
- **J02 (110000):** kolom `sale_payment_corrections.source_shift_status`; `correct_pos_sale_payment` ditambal
  (OWNER/FINANCE, sesudah tutup shift); policy baca `…_owner_read` diganti `…_finance_read`.
- **J02 (111000):** tabel `clinic_payment_corrections` (RLS, baca OWNER/FINANCE) dan
  `clinic_payment_correction_requests` (RLS, tanpa akses klien); trigger penjaga di `invoices`; RPC
  `correct_clinic_invoice_payment`; `pos_sale_journal_protected` diperluas ke jurnal koreksi klinik.
- **N01:** kolom `sales_invoices.returned_ar` (default 0); tabel `wholesale_returns` + `wholesale_return_items` (RLS,
  baca saja); 4 fungsi penjaga + 8 trigger (termasuk di jurnal dan stok); RPC `post_wholesale_return`,
  `void_wholesale_return`; 4 fungsi grosir/valuasi ditambal berjangkar; cek jenis `wholesale_operation_requests`
  ditambah `return`/`return-void`; 2 sumber log aktivitas + triggernya.
- **K08:** `clinic_admit_inpatient`, `clinic_continue_visit_to_inpatient` diganti (tagihan aktif menahan rawat inap).
- **K14:** cek `items.tindakan_kategori` ditambah `Pet Hotel`; satu jasa `JASA-PET-HOTEL` "Pet Hotel (per hari)"
  harga 0 dibuat (tarif diisi owner di master SKU; selama 0, tarif Rawat Inap dipakai dengan catatan);
  `protect_inpatient_care_staff`, `clinic_admit_inpatient_typed`, `clinic_change_inpatient_condition` diganti.
- **C05 (150000):** fungsi baru `voucher_wajib_lewat_kampanye`; `guard_campaign_code_use` diganti.
- **I09:** index `clinic_compound_sales_sale_item_idx`; RPC baca `read_compound_parent_history`.
- **C05 (152000):** kolom `invoices.campaign_carrier_id` + index parsial; `guard_campaign_code_use` diganti lagi;
  trigger `c05_invoice_campaign_code` dibuat ulang; `clinic_post_invoice` ditambal lagi.
- **M04:** `prepare_accurate_initial_stock` ditambal (kebijakan `ROUND_LINE_RUPIAH_V1`). Batch persediaan awal yang
  sudah tersimpan/diposting tidak disentuh.
- Tidak ada baris data bisnis lama yang diubah; yang ditambah hanya satu baris master jasa Pet Hotel dan 2 baris
  konfigurasi sumber log aktivitas (kolom baru di baris lama berisi default: `returned_ar` 0, lainnya kosong).

**Ketergantungan antar migrasi** (semuanya ada di satu transaksi, urut nama file; readback memeriksa hasil akhirnya):

- `152000` menambal yang dibuat `150000`: guard kampanye final memakai `voucher_wajib_lewat_kampanye` **dan**
  `campaign_carrier_id`.
- `clinic_post_invoice` ditambal dua kali (`100000` P03 lalu `152000` C05); readback memeriksa keduanya ada.
- `141000` (K14) menulis ulang `clinic_change_inpatient_condition` yang sudah diubah batch 1 (K08) dan main
  `20261031095000`: readback memastikan hitungan semua periode (batch 1) tetap ada, peran sesi lewat `auth.role()`,
  dan `request.jwt.claim.role` tidak ada di kelima fungsi rawat inap.
- `141000` memakai aturan K08 dari `140000`; `152000` menambal `clinic_post_invoice` yang sudah memuat P03.

**Cadangan untuk rollback:** sebelum mengubah apa pun, `apply.sql` menyimpan ke `vetos_release.pr310_batch2_backup`
(skema privat, tidak bisa dibaca pengguna aplikasi): definisi dan hak akses 16 fungsi yang diganti, trigger
`c05_invoice_campaign_code`, policy baca `sale_payment_corrections`, cek `items.tindakan_kategori` dan cek jenis
permintaan grosir; sesudah migrasi, id jasa Pet Hotel yang dibuat. `lock_timeout 5s`, `statement_timeout 120s`;
gagal kunci = semua batal, bisa diulang nanti.

## Langkah

Jalankan dengan `psql -X -v ON_ERROR_STOP=1 -f <file>`. Di SQL editor Supabase: `apply.sql`/`rollback.sql` dijalankan
utuh; untuk `preflight.sql`/`readback.sql` pilih dan jalankan hanya statement `with … select …`.

1. **`preflight.sql`** — semua baris ber-nilai harapan `ok = true`, baris terakhir `SUMMARY | 0 failed`. Bila ada yang
   gagal: **berhenti**, belum ada yang berubah. Baris `before apply: … (md5, owner)` yang gagal berarti fungsi di
   production berbeda dari repo (perubahan tangan / migrasi lain) — kirim hasilnya ke developer, jangan apply.
2. **`apply.sql`** sekali. Sukses = tanpa error. `PR310B2_ALREADY_APPLIED` = sudah terpasang → lanjut ke langkah 3.
   `PR310B2_BATCH1_MISSING` = pasang batch 1 dulu. Error lain = tidak ada yang terpasang.
3. **`readback.sql`** — `SUMMARY | 0 failed`. Jalankan juga `readback.sql` batch 1: tetap `0 failed`.
4. Merge PR #310, tunggu deploy, lalu cek (OWNER): kasir POS dan kasir klinik bisa transaksi normal; koreksi metode
   bayar POS/klinik tampil; Retur Penjualan grosir tampil; masuk rawat inap / check-in pet hotel; master SKU
   menampilkan jasa "Pet Hotel (per hari)" (isi tarifnya); riwayat SKU induk racikan tampil.

**Rollback** (hanya atas keputusan mundur, dan **sebelum** rollback batch 1): jalankan `rollback.sql` utuh. Fungsi,
hak akses, trigger, policy dan cek kembali persis seperti sebelum apply; objek baru, jasa Pet Hotel yang dibuat
apply, baris riwayat dan tabel cadangan dihapus. **Rollback menolak** (`PR310B2_ROLLBACK_HAS_DATA`, tidak ada yang
berubah) bila fitur baru sudah menyimpan catatan: koreksi metode bayar klinik, retur grosir, nota pendamping
rombongan, koreksi POS yang mencatat status shift, jasa Pet Hotel tambahan atau yang sudah dipakai transaksi. Setelah
itu terjadi, perbaiki maju, jangan mundur. Tarif yang sudah diisi di jasa Pet Hotel ikut hilang saat rollback; batch
persediaan awal yang disiapkan dengan pembulatan per baris tetap tersimpan dan tetap bisa diposting. Log aktivitas
yang sudah tercatat tetap ada.

## Gladi bersih

`rehearsal-pg16.log` (PostgreSQL 16 lokal, data fiktif): 318 migrasi main → batch 1 lewat paketnya sendiri
(preflight/readback `0 failed`) → hak default ala Supabase (fungsi/tabel baru otomatis diberi ke `anon`,
`authenticated`, `service_role`; sisa grant `service_role` di fungsi yang hak aksesnya di-reset batch 2) → apply
tanpa batch 1 ditolak → preflight → apply → readback (137 cek) + readback batch 1 tetap lulus → apply ulang ditolak
tanpa perubahan → rollback (sidik katalog 8.888 baris — fungsi+hak akses, tabel, kolom, cek, trigger, policy, index,
sumber log, master jasa, riwayat, skema — identik dengan sebelum apply) → preflight → apply (sidik identik dengan
apply pertama) → readback → 12 suite SQL batch 2 lulus, masing-masing di salinan database sekali pakai → rollback
dengan catatan fitur baru ditolak tanpa perubahan. Ulangi dengan:

```
LC_ALL=C.UTF-8 python3 -B docs/evidence/2026-10-29-pr310-batch2/owner-apply/build-and-rehearse.py [pg bin dir]
```

Belum diuji: production sungguhan (versi PostgreSQL Supabase, hak akses fungsi lama di production, beban tulis saat
apply) dan UAT pengguna.
