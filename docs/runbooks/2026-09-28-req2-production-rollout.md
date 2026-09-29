# Rilis katalog racikan resmi (REQ-2)

Status 29 September 2026: **belum siap deploy**. PR #9 bergantung pada PR #6; keduanya tetap draft. Perbaikan tagihan, piutang, dan rawat inap kini lulus uji lokal, tetapi objek dan pemulihan database produksi belum terbukti siap.

## Gate sebelum migrasi

1. **Lulus sebagian, 29 Sep:** lima tes SQL lulus di PostgreSQL lokal 16.14 setelah semua 166 migrasi diterapkan dengan shim auth/storage serta izin tabel khusus uji. Uji dua sesi lulus untuk stok terakhir invoice dan racikan, serta retry katalog versi resmi. Ini bukan Supabase lokal penuh atau `supabase db reset`; migrasi 0068 memerlukan dua akun COA yang dimuat sebelum migrasi. Rincian ada di `supabase/tests/README.md`.
2. **Lulus di lokal, 29 Sep:** `20260929120000` membuat edit invoice unpaid/DP, void/reissue paid atau partially paid, pelunasan piutang, dan pulang/biaya rawat inap menjadi transaksi database. Pembayaran yang sudah diterima dialihkan ke invoice pengganti secara atomik; tidak ada penerimaan kas baru. Koreksi lanjutan yang nilainya lebih kecil dari kredit ditolak untuk tinjauan keuangan. Koreksi/void racikan historis, invoice legacy tanpa `request_key`, dan edit dengan lebih dari satu baris obat yang sama ditolak sebelum mutasi. Rawat inap yang masih aktif tidak bisa ditagih sebelum biaya pulang dihitung. Invoice yang sudah terbit sebelum pasien pulang memerlukan penanganan manual oleh keuangan; jangan paksa perubahan status/data.
3. **Belum diverifikasi ulang:** cocokkan objek produksi dengan migrasi di bawah. Audit sebelumnya menemukan riwayat migrasi tidak lengkap, sedangkan `20260924120000`, `20260924122000`, dan `20260924123000` sudah dipasang terarah. Jangan gunakan `supabase db push` massal; migrasi `20260924121000` bukan prasyarat alur ini.
4. **Belum lulus:** pastikan backup produksi baru tersedia dan pemulihannya bisa dijalankan. Catat waktu, target pemulihan, dan SHA `main` sebelum rilis. Audit sebelumnya belum menemukan PITR aktif.
5. **Belum lulus:** cek invoice historis dengan HPP/jurnal/tautan racikan tidak lengkap dan pasien yang masih dirawat tetapi sudah punya invoice aktif. Kasus itu sengaja ditolak, bukan dikoreksi otomatis. Untuk koreksi yang lebih kecil dari pembayaran lama, selisih memerlukan keputusan keuangan terpisah sebelum invoice dapat disimpan; alur ini tidak otomatis mengembalikan uang.

## Preflight baca saja di database produksi

Jalankan dan simpan hasil sebelum mengubah skema. Hentikan rilis bila suatu objek sudah ada dengan definisi berbeda; jangan mengulang `CREATE` secara membabi buta.

```sql
select version from supabase_migrations.schema_migrations
where version in ('20260924124000','20260924125000','20260924125500',
  '20260924140000','20260924141000','20260924142000','20260929120000') order by version;

select p.oid::regprocedure::text as function_signature
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','clinic_private') and p.proname in
  ('clinic_issue_compound','clinic_void_compound','clinic_post_invoice',
   'clinic_issue_official_compound','publish_compound_formula',
   'clinic_save_initial_record','clinic_save_inpatient_log',
   'clinic_edit_invoice','clinic_void_reissue_invoice',
   'clinic_receive_invoice_payment','clinic_change_inpatient_condition')
order by 1;

select table_name, column_name from information_schema.columns
where table_schema='public' and (
  (table_name='inpatient_daily_logs' and column_name='submission_key') or
  (table_name='medical_records' and column_name='submission_key') or
  (table_name='compounding_recipes' and column_name='request_key') or
  (table_name='prescription_items' and column_name='compound_recipe_id')
) order by 1,2;

select count(*) as active_inpatient_with_invoice
from inpatient_records r join invoices i on i.visit_id=r.visit_id
where r.discharged_at is null and i.voided_at is null;

select count(*) as active_legacy_invoices from invoices
where voided_at is null and request_key is null;

select count(*) as active_compound_invoices
from invoice_items ii join invoices i on i.id=ii.invoice_id
where i.voided_at is null and ii.compound_recipe_id is not null;
```

## Migrasi terarah, hanya setelah gate lulus

Jalankan dan catat satu per satu dalam urutan berikut, hanya yang belum ada dan sudah dicocokkan dengan keadaan produksi:

| Urutan | File | Keperluan |
| --- | --- | --- |
| 1 | `20260924124000_clinic_compound_issue.sql` | Stock issue, histori HPP, dan request key resep |
| 2 | `20260924125000_clinic_invoice_post.sql` | Invoice klinik, stok, HPP, dan jurnal atomik |
| 3 | `20260924125500_clinic_posted_invoice_guard.sql` | Segel invoice setelah posting |
| 4 | `20260924140000_official_compound_catalog.sql` | Formula berversi dan pembatasan racikan manual |
| 5 | `20260924141000_atomic_initial_clinic_record.sql` | Pemeriksaan awal atomik |
| 6 | `20260924142000_atomic_inpatient_daily_log.sql` | Catatan inap dan resep atomik |
| 7 | `20260929120000_clinic_billing_lifecycle.sql` | Koreksi, void, piutang, biaya inap, dan pembatasan akses cabang |

Setiap file SQL memerlukan transaksi utuh; catat riwayat versi hanya setelah SQL berhasil. Jadwalkan jeda posting klinik sejak migrasi pertama sampai aplikasi baru terverifikasi: wrapper racikan manual akan menolak dokter yang masih membuka halaman lama. Kode aplikasi baru dimerge setelah semua fungsi/grant/RLS dan kolom yang diperlukan terbukti siap.

## Pemeriksaan setelah deploy

1. Pastikan SHA produksi Vercel sama dengan SHA merge yang dituju; buka katalog sebagai OWNER dan pastikan DOCTOR tidak melihat tombol pengelolaan.
2. Di akun uji dengan cabang dan stok yang terkontrol, terbitkan formula resmi lalu buat pemeriksaan dan catatan inap. Periksa resep, bahan, stok, HPP, invoice, dan jurnal pada transaksi yang sama. Ulangi request key dan pastikan tidak terduplikasi.
3. Uji tagihan belum lunas dengan koreksi obat, DP tanpa mengubah penerimaan lama, dua pelunasan sebagian, void/reissue, dan pembatalan invoice lunas. Pastikan uang lama muncul sebagai kredit pada invoice pengganti, sisa piutang tepat, dan kas tidak bertambah dua kali. Cocokkan kartu stok, nilai HPP, buku besar, saldo piutang, dan kas fisik. Coba koreksi di bawah nilai kredit dan pastikan ditolak untuk pemeriksaan keuangan.
4. Uji pasien rawat inap pulang setelah 49 jam: tagihan biaya harus 3 hari. Tagihan sebelum pulang harus ditolak. Uji staf cabang lain tidak bisa melihat invoice dan riwayat koreksinya.
5. Periksa error log Vercel dan respons RPC. Tandai REQ-2 live hanya setelah pemeriksaan ini lulus dengan data nyata.

## Jika gagal

Hentikan posting baru di alur terkait, catat request key dan identitas transaksi, lalu kembalikan aplikasi ke SHA produksi sebelumnya. Jangan otomatis menghapus tabel/kolom baru: resep yang telah diposting mungkin sudah merujuk ke versi formula. Pemulihan database dari backup adalah keputusan insiden terpisah setelah menilai transaksi yang terjadi sejak backup. Jangan melakukan backfill atau reset data demo tanpa keputusan terarah.
