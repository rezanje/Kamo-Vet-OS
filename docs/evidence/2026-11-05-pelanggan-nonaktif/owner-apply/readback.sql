-- Pelanggan nonaktif — readback (READ-ONLY) setelah apply.sql. Semua baris `ok` harus true.
select 'kolom status pelanggan terpasang' as cek,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='customers'
    and column_name in ('is_active','deactivated_at','deactivated_by','deactivation_reason')) = 4 as ok
union all select 'semua pelanggan lama tetap AKTIF (tidak ada yang ikut nonaktif)',
  not exists(select 1 from public.customers where not is_active)
union all select 'trigger peran owner/admin pada customers',
  exists(select 1 from pg_trigger where tgname='customers_status_guard' and tgrelid='public.customers'::regclass and not tgisinternal)
union all select 'trigger penolak transaksi baru di 6 tabel',
  (select count(*) from pg_trigger where tgname='customer_active_guard' and not tgisinternal
    and tgrelid in ('public.sales'::regclass,'public.visits'::regclass,'public.sales_quotations'::regclass,
                    'public.sales_orders'::regclass,'public.sales_invoices'::regclass,'public.sales_advances'::regclass)) = 6
union all select 'fungsi trigger tidak bisa dipanggil klien',
  not has_function_privilege('authenticated','public.guard_new_transaction_customer_active()','EXECUTE')
  and not has_function_privilege('anon','public.guard_new_transaction_customer_active()','EXECUTE')
  and not has_function_privilege('authenticated','public.guard_customer_status()','EXECUTE')
union all select 'cek peran hanya untuk authenticated',
  has_function_privilege('authenticated','public.customer_status_manager()','EXECUTE')
  and not has_function_privilege('anon','public.customer_status_manager()','EXECUTE');

-- Bandingkan dengan angka preflight: harus sama persis.
select 'customers' as tabel, count(*) as baris from public.customers
union all select 'sales', count(*) from public.sales
union all select 'visits', count(*) from public.visits
union all select 'sales_quotations', count(*) from public.sales_quotations
union all select 'sales_orders', count(*) from public.sales_orders
union all select 'sales_invoices', count(*) from public.sales_invoices
union all select 'sales_advances', count(*) from public.sales_advances
order by 1;
