-- Pelanggan nonaktif — preflight (READ-ONLY). Semua baris `ok` harus true sebelum apply.sql.
select 'tabel transaksi yang dijaga ada semua' as cek,
  (select count(*) from unnest(array['sales','visits','sales_quotations','sales_orders','sales_invoices','sales_advances']) t
    where to_regclass('public.'||t) is not null) = 6 as ok
union all select 'kolom pengecualian ada (impor/lanjutan ranap/faktur pengganti/saldo awal)',
  (select count(*) from information_schema.columns where table_schema='public' and
    ((table_name='visits' and column_name in ('legacy_source_key','continued_from_visit_id'))
     or (table_name='sales_invoices' and column_name in ('replaces_invoice_id','opening_batch_id')))) = 4
union all select 'profiles.is_active ada (syarat peran owner/admin aktif)',
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_active')
union all select 'belum diterapkan, atau sudah diterapkan dengan bentuk yang sama (aman diulang)',
  (select count(*) from information_schema.columns where table_schema='public' and table_name='customers'
    and column_name in ('is_active','deactivated_at','deactivated_by','deactivation_reason')) in (0,4)
union all select 'tidak ada trigger lain bernama sama',
  not exists(select 1 from pg_trigger where not tgisinternal and tgname in ('customers_status_guard','customer_active_guard')
    and pg_get_triggerdef(oid) not like '%guard_customer_status%' and pg_get_triggerdef(oid) not like '%guard_new_transaction_customer_active%');

-- Informasi (bukan syarat): angka ini harus SAMA PERSIS di readback.sql (data lama tidak diubah).
select 'customers' as tabel, count(*) as baris from public.customers
union all select 'sales', count(*) from public.sales
union all select 'visits', count(*) from public.visits
union all select 'sales_quotations', count(*) from public.sales_quotations
union all select 'sales_orders', count(*) from public.sales_orders
union all select 'sales_invoices', count(*) from public.sales_invoices
union all select 'sales_advances', count(*) from public.sales_advances
order by 1;

-- Informasi: kandidat akun "CS pusat" + jumlah struk 30 hari terakhir (untuk dikonfirmasi pemilik sebelum dinonaktifkan).
select c.id, c.name, c.phone,
  (select count(*) from public.sales s where s.customer_id=c.id and s.created_at > now()-interval '30 days') as struk_30_hari,
  (select count(*) from public.visits v where v.customer_id=c.id and v.created_at > now()-interval '30 days') as kunjungan_30_hari
from public.customers c
where c.name ilike '%cs%pusat%' or c.name ilike '%pusat%' or c.name ilike 'cs %' or c.name ilike '%customer service%'
order by struk_30_hari desc, c.name limit 20;
