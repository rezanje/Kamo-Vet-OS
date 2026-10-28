-- K03 + J01 PREFLIGHT — READ ONLY. Semua baris harus ok = true.
-- Jangan salin keluaran production (jumlah data, ID) ke repo/PR.
with checks(check_name, ok) as (
  select 'tabel prescription_items & invoice_items ada', to_regclass('public.prescription_items') is not null and to_regclass('public.invoice_items') is not null
  union all select 'kolom yang dipakai trigger K03 ada (termasuk sumber salinan terbit ulang/koreksi)',
    (select count(*) from information_schema.columns where table_schema='public'
      and ((table_name='prescription_items' and column_name in ('item_id','compound_recipe_id','nama_obat'))
        or (table_name='invoice_items' and column_name in ('item_id','compound_recipe_id','prescription_item_id','deskripsi','service_source_line_id','invoice_id'))
        or (table_name='invoices' and column_name='reissued_from'))) = 10
  union all select 'kolom aturan SKU racik ada (items.item_type/is_compound_material/category_id, item_categories.name)',
    (select count(*) from information_schema.columns where table_schema='public'
      and ((table_name='items' and column_name in ('item_type','is_compound_material','category_id','name'))
        or (table_name='item_categories' and column_name='name'))) = 5
  union all select 'invoices.visit_id wajib (invoice_items khusus klinik, kasir petshop tidak terdampak)',
    (select is_nullable='NO' from information_schema.columns where table_schema='public' and table_name='invoices' and column_name='visit_id')
  union all select 'nama trigger zz_racikan_recipe_required masih bebas',
    not exists(select 1 from pg_trigger where tgname='zz_racikan_recipe_required' and tgrelid in ('public.prescription_items'::regclass,'public.invoice_items'::regclass))
  union all select 'nama fungsi K03 masih bebas',
    to_regprocedure('clinic_private.is_racikan_sku(uuid)') is null
    and to_regprocedure('clinic_private.k03_prescription_recipe_required()') is null
    and to_regprocedure('clinic_private.k03_invoice_recipe_required()') is null
  union all select 'J01: wholesale_access ada, SECURITY DEFINER',
    (select prosecdef from pg_proc where oid=to_regprocedure('public.wholesale_access(uuid,boolean)'))
  union all select 'J01: tubuh wholesale_access = versi yang ditinjau (md5 6b15f97c…)',
    (select md5(prosrc)='6b15f97c64b813e269a7b2f3bfcbc8c1' from pg_proc where oid=to_regprocedure('public.wholesale_access(uuid,boolean)'))
  union all select 'J01: helper hanya dipanggil fungsi grosir (tidak ada hak EXECUTE authenticated)',
    not has_function_privilege('authenticated',to_regprocedure('public.wholesale_access(uuid,boolean)'),'execute')
  union all select 'K03 belum tercatat di riwayat migrasi', not exists(select 1 from supabase_migrations.schema_migrations where version='20261029120000')
  union all select 'J01 belum tercatat di riwayat migrasi', not exists(select 1 from supabase_migrations.schema_migrations where version='20261029121000')
)
select check_name, coalesce(ok,false) as ok from checks
union all select 'SUMMARY: ' || count(*) filter (where not coalesce(ok,false)) || ' failed', bool_and(coalesce(ok,false)) from checks;

-- INFO (boleh dijalankan, jangan salin hasilnya ke repo/PR): baris resep lama SKU racik tanpa komposisi.
-- Baris ini TIDAK diubah K03 dan tetap bisa ditagih; hanya baris baru/yang item-nya diganti yang diperiksa.
-- select count(*) from public.prescription_items p join public.items i on i.id=p.item_id
--  where p.compound_recipe_id is null and i.item_type='Persediaan' and not i.is_compound_material
--  and (i.name ilike 'Obat Racik %' or i.name ilike 'Obat Racikan %' or exists(select 1 from public.item_categories c
--   where c.id=i.category_id and upper(regexp_replace(btrim(c.name),'\s+',' ','g')) in ('OBAT RACIK','OBAT RACIKAN','RACIKAN')));
