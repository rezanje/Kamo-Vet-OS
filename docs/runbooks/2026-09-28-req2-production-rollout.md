# Rilis katalog racikan resmi (REQ-2)

Status 28 September 2026: **belum live**. PR #9 bergantung pada PR #6; keduanya draft. Jangan merge hanya karena build Vercel hijau: halaman akan memanggil RPC yang belum terbukti tersedia di database produksi.

## Gate sebelum migrasi

1. Uji SQL `supabase/tests/clinic_compound_issue.sql`, `clinic_invoice_post.sql`, `official_compound_catalog.sql`, `atomic_initial_clinic_record.sql`, dan `atomic_inpatient_daily_log.sql` pada Supabase/PostgreSQL terisolasi dengan seluruh fungsi/RLS asli. Uji dua sesi untuk stok terakhir dan retry request key. PGlite dengan stub belum memenuhi gate ini.
2. Tuntaskan atau putuskan secara eksplisit pembatasan edit/void/reissue invoice di PR #6. Pastikan alur pembayaran piutang dan pulang rawat inap tidak membuat tagihan setengah jadi.
3. Bandingkan objek produksi dengan migrasi di bawah. Catatan audit sebelumnya menemukan riwayat migrasi produksi tidak lengkap, sedangkan `20260924120000`, `20260924122000`, dan `20260924123000` sudah dipasang terarah. Jangan gunakan `supabase db push` massal; migrasi `20260924121000` bukan prasyarat alur ini.
4. Pastikan backup produksi baru tersedia dan pemulihannya dapat dijalankan. Catat waktu, target pemulihan, dan SHA `main` sebelum rilis. PITR pada audit sebelumnya belum aktif.

## Preflight baca saja di database produksi

Jalankan dan simpan hasil sebelum mengubah skema. Hentikan rilis bila suatu objek sudah ada dengan definisi berbeda; jangan mengulang `CREATE` secara membabi buta.

```sql
select version from supabase_migrations.schema_migrations
where version in ('20260924124000','20260924125000','20260924125500',
  '20260924140000','20260924141000','20260924142000') order by version;

select p.oid::regprocedure::text as function_signature
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','clinic_private') and p.proname in
  ('clinic_issue_compound','clinic_void_compound','clinic_post_invoice',
   'clinic_issue_official_compound','publish_compound_formula',
   'clinic_save_initial_record','clinic_save_inpatient_log')
order by 1;

select table_name, column_name from information_schema.columns
where table_schema='public' and (
  (table_name='inpatient_daily_logs' and column_name='submission_key') or
  (table_name='medical_records' and column_name='submission_key') or
  (table_name='compounding_recipes' and column_name='request_key') or
  (table_name='prescription_items' and column_name='compound_recipe_id')
) order by 1,2;
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

Setiap file SQL memerlukan transaksi utuh; catat riwayat versi hanya setelah SQL berhasil. Jadwalkan jeda posting klinik sejak migrasi pertama sampai aplikasi baru terverifikasi: wrapper racikan manual akan menolak dokter yang masih membuka halaman lama. Kode aplikasi baru dimerge setelah semua fungsi/grant/RLS dan kolom yang diperlukan terbukti siap.

## Pemeriksaan setelah deploy

1. Pastikan SHA produksi Vercel sama dengan SHA merge yang dituju; buka katalog sebagai OWNER dan pastikan DOCTOR tidak melihat tombol pengelolaan.
2. Di akun uji dengan cabang dan stok yang terkontrol, terbitkan formula resmi lalu buat pemeriksaan dan catatan inap. Periksa resep, bahan, stok, HPP, invoice, dan jurnal pada transaksi yang sama. Ulangi request key dan pastikan tidak terduplikasi.
3. Periksa error log Vercel dan respons RPC. Tandai REQ-2 live hanya setelah pemeriksaan ini lulus dengan data nyata.

## Jika gagal

Hentikan posting baru di alur terkait, catat request key dan identitas transaksi, lalu kembalikan aplikasi ke SHA produksi sebelumnya. Jangan otomatis menghapus tabel/kolom baru: resep yang telah diposting mungkin sudah merujuk ke versi formula. Pemulihan database dari backup adalah keputusan insiden terpisah setelah menilai transaksi yang terjadi sejak backup. Jangan melakukan backfill atau reset data demo tanpa keputusan terarah.
