-- READ-ONLY. Jalankan sebelum apply.sql. Tidak mengubah apa pun.
-- Harapan:
--   prasyarat tercatat: 20261020134110, 20261023200000, 20261028160000, 20261029110000
--   migrasi 20261029150000 belum tercatat; fungsi edit baris PO belum ada;
--   mesin koreksi faktur 8 argumen ada, md5 isinya = nilai di OWNER-RUNBOOK.md (sama dengan repo).
select 'prasyarat migrasi tercatat' as cek, coalesce(string_agg(version, ', ' order by version), '-') as nilai
  from supabase_migrations.schema_migrations where version in ('20261020134110','20261023200000','20261028160000','20261029110000')
union all select 'migrasi 20261029150000 tercatat', coalesce((select version from supabase_migrations.schema_migrations where version = '20261029150000'), '-')
union all select 'mesin koreksi faktur 8 argumen ada', (to_regprocedure('public.purchase_invoice_line_correction_run(uuid,numeric,numeric,date,text,text,jsonb,boolean)') is not null)::text
union all select 'md5 isi mesin koreksi faktur', coalesce((select md5(prosrc) from pg_proc where oid = to_regprocedure('public.purchase_invoice_line_correction_run(uuid,numeric,numeric,date,text,text,jsonb,boolean)')), '-')
union all select 'fungsi edit baris PO sudah ada', (to_regprocedure('public.correct_purchase_order_line(text,uuid,integer,numeric,numeric,numeric,date,text,jsonb)') is not null)::text
union all select 'koreksi faktur tercatat', count(*)::text from public.purchase_invoice_corrections
union all select 'permintaan PO tercatat', count(*)::text from public.purchase_order_requests
union all select 'akun OWNER aktif', count(*)::text from public.profiles where role = 'OWNER' and is_active;
