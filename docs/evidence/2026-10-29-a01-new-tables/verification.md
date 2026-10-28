# A01 — log aktivitas untuk tabel baru (audit 29 Okt)

Status: **sebagian** untuk A01. Celah "tabel sesudah 24 Okt belum tercatat" ditutup di repo dan diuji di
PostgreSQL 16 lokal. **Belum diterapkan ke production** (paket owner di `owner-apply/`). UAT pengguna belum dilakukan.

## Yang berubah

Migrasi `supabase/migrations/20261029150000_a01_audit_new_tables.sql` memakai mekanisme A01 yang sama
(baris registri privat `activity_log_sources` + trigger `a01_activity_change` AFTER INSERT/UPDATE dan
`a01_activity_delete` BEFORE DELETE ke `capture_activity_log()`). Tidak ada tabel sumber, grant, policy, RPC
atau isi log lama yang diubah. Hanya penulisan sesudah migrasi yang tercatat (tanpa backfill).

18 tabel baru masuk log (185 → 203 sumber):

| Tabel | Modul | Nilai yang ikut dicatat | Pembaca log |
| --- | --- | --- | --- |
| campaign_codes | crm | code, max_uses, is_active (catatan bebas tidak) | OWNER, ADMIN |
| payslip_templates | hris | metadata saja | OWNER |
| payslip_template_components | hris (di bawah template) | metadata saja | OWNER |
| employee_payslip_templates | hris (di bawah karyawan) | metadata saja | OWNER |
| employee_base_salaries | hris (di bawah karyawan) | metadata saja | OWNER |
| service_commission_policies | penjualan | metadata saja | OWNER, ADMIN |
| branch_grooming_rules | pengaturan | doctor_required | OWNER, ADMIN |
| opening_invoice_batches | buku-besar | ap/ar count & total | OWNER, ADMIN |
| opening_invoice_lines | buku-besar (di bawah batch) | row_no, tanggal, jatuh_tempo, outstanding, original_total | OWNER, ADMIN |
| recurring_journal_sources | buku-besar (di bawah jurnal berulang) | metadata saja | OWNER, ADMIN |
| recurring_source_occurrences | buku-besar (di bawah sumber) | metadata saja | OWNER, ADMIN |
| clinic_refund_items | klinik (di bawah refund) | qty, amount, hpp, kondisi, restock | OWNER, ADMIN |
| clinic_record_addenda | klinik (di bawah rekam medis) | metadata saja | OWNER, ADMIN |
| inpatient_rx_evidence | klinik (di bawah rawat inap) | metadata saja | OWNER, ADMIN |
| inpatient_rx_evidence_settings | klinik | metadata saja | OWNER, ADMIN |
| quest_new_customer_claims | pos (di bawah transaksi) | metadata saja | tidak ada (sumber tanpa akses baca, seperti sale_staff_effects) |
| purchase_invoice_receipts | pembelian (di bawah faktur) | active | OWNER, ADMIN |
| private_report_presets | laporan | metadata saja | hanya pemilik preset itu sendiri |

Tambahan: `clinic_refunds` dan `clinic_refund_requests` (J03) kini juga mencatat penghapusan
(sebelumnya hanya insert/update; perbaikan sama seperti 20261024114433 untuk refund petshop).

Sengaja **tidak** didaftarkan (kelas pengecualian A01 yang sudah ada; baris bisnisnya sudah tercatat):

- request_receipt: purchase_advance_requests, opname_posting_receipts, production_atomic_postings,
  sale_payment_correction_requests, purchase_advance_cascade_cancellations, promo_import_batches
- domain_history: purchase_advance_cancellations, purchase_order_receipt_closures, user_account_edits,
  clinic_record_corrections, sale_payment_corrections, purchase_invoice_corrections, payslip_override_history,
  purchase_receipt_cancellations
- posting_proof: purchase_invoice_correction_layers, promo_import_targets
- technical_concurrency: purchase_advance_capacity_locks, sale_payment_correction_gate

`clinic_history_reads` (K13) tetap insert-only: tabelnya append-only, sudah seperti itu sejak K13.

Aplikasi: `src/lib/activity-log.ts` (label 21 objek: 18 baru + 3 yang terlewat sejak 28 Okt — clinic_history_reads,
clinic_refund_requests, clinic_refunds; modul "Laporan"; menu `/crm/kampanye` dan `/keuangan/saldo-awal-faktur`),
`src/lib/activity-presentation.ts` (label kolom nilai baru).

Tes: `supabase/tests/activity_audit_new_tables.sql` (baru: setiap tabel public harus terdaftar atau ada di daftar
pengecualian; insert/update/delete nyata pada campaign_codes, branch_grooming_rules, template slip gaji + komponen +
link karyawan + gaji pokok, pengaturan bukti obat rawat inap, kebijakan komisi jasa, preset laporan; cek privasi dan RLS
OWNER vs ADMIN). `activity_audit_framework.sql` (batas 179 → 203, pengecualian tertulis untuk clinic_history_reads dan
dua antrean refund yang memang metadata-only), `activity_audit_remaining_modules.sql` (promos bukan metadata-only sejak
20261023070134). `docs/evidence/2026-10-28-k13-k01/owner-apply/readback.sql`: hitungan trigger imutabilitas adendum tidak
lagi ikut menghitung trigger log aktivitas.

## Perintah dan hasil (PostgreSQL 16.15 lokal, C.UTF-8, sebagai user `postgres`)

```
python3 docs/evidence/2026-10-29-a01-new-tables/run-native-pg.py scripts/test-a01-new-tables-postgres.py
```
Hasil (`native-pg16-new-tables.log`): 304 migrasi; apply ulang idempoten (203 sumber / 405 trigger, hash registri sama);
3 drift ditolak (baris registri beda, trigger asing, kolom sumber hilang); `activity_audit_new_tables.sql` PASS;
readback 7/7 → rollback (18 dicabut, 185 lama utuh) → preflight 6/6 → apply.sql 2× (hasil identik migrasi) →
readback 7/7 → tes PASS lagi.

Tes yang sama gagal tanpa migrasi baru (menyebut persis 18 tabel di atas sebagai "Unclassified").

```
python3 docs/evidence/2026-10-29-a01-new-tables/run-native-pg.py scripts/test-activity-audit-postgres.py
```
Main sebelum perubahan: 13 PASS / 6 FAIL. Sesudah: **16 PASS / 4 FAIL** (20 suite, termasuk suite baru).
4 yang gagal sama persis di main (fixture lama bentrok dengan aturan bisnis baru, bukan A01 baru):
activity_audit_financial (RECIPE_POSTED), activity_audit_inventory (hapus opname langsung ditolak),
posted_sale_cancellations (sumber opname), purchase_payment_corrections (batas DP PO).

Regresi fitur yang tabelnya kini punya trigger log (semua lewat `run-native-pg.py`, PG16):
test-c05-q01 PASS, test-clinic-refund PASS, test-inpatient-rx-evidence PASS, test-n01-p08 PASS,
test-opening-invoices PASS, test-recurring-source PASS (termasuk race 2 sesi), test-refund-payout PASS (race),
test-grooming-trigger-update PASS, test-h-payroll-incentives PASS, test-clinic-record-history PASS
(termasuk paket owner K13/K01 dengan readback yang disesuaikan).
test-hris-pilot-access GAGAL di main dan sesudah perubahan dengan error yang sama
(`private.hris_role() does not exist`: runner melewati migrasi HRIS yang dibutuhkan migrasi H04).

```
npx vitest run                     # 557 file passed, 1 skipped; 4113 tes passed, 1 skipped
npx eslint <4 file src yang diubah> # exit 0
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p .   # exit 0
```

## Langkah DB owner (`owner-apply/`)

1. `preflight.sql` — hanya baca, semua `ok = true`, `SUMMARY: 0 failed`.
2. `apply.sql` — isi sama dengan migrasi, satu transaksi, aman diulang.
3. `readback.sql` — hanya baca, `SUMMARY: 0 failed`. Baris "informational" menyebut tabel public yang belum
   diputuskan (harus `none`).
4. `rollback.sql` — hanya bila diputuskan mundur. Tidak menyentuh data bisnis; event lama tetap tersimpan
   tapi tersembunyi sampai apply lagi. Bila nanti ada rollback fitur yang menghapus salah satu dari 18 tabel
   (K01, J03, H02, C05, M05, N01, dst.), jalankan rollback ini dulu.

Urutan rilis: kode boleh di-deploy sebelum atau sesudah langkah DB (sebelum DB: label baru belum punya event).

## Belum dikerjakan / batas

- Belum diterapkan dan belum dicek di production; production bisa punya tabel di luar repo (lihat baris informational readback).
- Tidak ada backfill event lama dari 24–29 Okt.
- 4 suite A01 lama dan runner HRIS pilot tetap gagal seperti di main (di luar lingkup ini).
- Rollback paket fitur lain belum otomatis mencabut registri tabelnya.
