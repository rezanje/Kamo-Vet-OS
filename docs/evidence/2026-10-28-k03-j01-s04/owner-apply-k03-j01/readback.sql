-- K03 + J01 READBACK — READ ONLY. Semua baris harus ok = true.
with checks(check_name, ok) as (
  select 'K03: trigger zz_racikan_recipe_required aktif di prescription_items',
    exists(select 1 from pg_trigger where tgname='zz_racikan_recipe_required' and tgrelid='public.prescription_items'::regclass and tgenabled='O')
  union all select 'K03: trigger zz_racikan_recipe_required aktif di invoice_items',
    exists(select 1 from pg_trigger where tgname='zz_racikan_recipe_required' and tgrelid='public.invoice_items'::regclass and tgenabled='O')
  union all select 'K03: trigger berjalan paling akhir (nama zz_racikan_* urut terakhir di prescription_items)',
    (select max(tgname) from pg_trigger where tgrelid='public.prescription_items'::regclass and not tgisinternal and tgtype & 2 = 2) = 'zz_racikan_recipe_required'
  union all select 'K03: fungsi SECURITY DEFINER dengan search_path kosong',
    (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc
      where oid in (to_regprocedure('clinic_private.is_racikan_sku(uuid)'),
                    to_regprocedure('clinic_private.k03_prescription_recipe_required()'),
                    to_regprocedure('clinic_private.k03_invoice_recipe_required()')))
    and (select count(*) from pg_proc where oid in (to_regprocedure('clinic_private.is_racikan_sku(uuid)'),
                    to_regprocedure('clinic_private.k03_prescription_recipe_required()'),
                    to_regprocedure('clinic_private.k03_invoice_recipe_required()'))) = 3
  union all select 'K03: authenticated tidak bisa memanggil fungsi K03 langsung',
    not has_function_privilege('authenticated',to_regprocedure('clinic_private.is_racikan_sku(uuid)'),'execute')
  union all select 'J01: wholesale_access versi OWNER/FINANCE',
    (select prosrc like '%role in (''OWNER'',''FINANCE'') or (not p_owner and role=''ADMIN'')%' and prosecdef from pg_proc where oid=to_regprocedure('public.wholesale_access(uuid,boolean)'))
  union all select 'J01: helper tetap privat',
    not has_function_privilege('authenticated',to_regprocedure('public.wholesale_access(uuid,boolean)'),'execute')
  union all select 'K03 tercatat di riwayat migrasi', exists(select 1 from supabase_migrations.schema_migrations where version='20261029120000')
  union all select 'J01 tercatat di riwayat migrasi', exists(select 1 from supabase_migrations.schema_migrations where version='20261029121000')
)
select check_name, coalesce(ok,false) as ok from checks
union all select 'SUMMARY: ' || count(*) filter (where not coalesce(ok,false)) || ' failed', bool_and(coalesce(ok,false)) from checks;
