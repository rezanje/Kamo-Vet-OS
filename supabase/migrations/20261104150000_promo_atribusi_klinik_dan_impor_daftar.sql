-- 0415 INDEPENDENT CHECKPOINT: Excel master import ONLY. UNAPPLIED.
-- Filename retained from the original unapplied candidate for queue coordination.
-- OWNER/ADMIN manager contract; one promo with many product/service targets.
-- Same-name updates and complete-file atomicity. Reuses existing expiry guards.
-- NO clinic attribution, invoice/journal/stock/admission changes in this checkpoint.
-- Deferred full reporting candidate + its acceptance cases are preserved under
-- docs/deferred/promo-reporting and at immutable source cb1135bad7f67405074705fe70f1fdef6d85b936.

create or replace function public.read_promo_import_context(p_names jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_promo_manager();
  if jsonb_typeof(p_names) is distinct from 'array' or jsonb_array_length(p_names) > 50 then
    raise exception 'Daftar promo tidak valid' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('promo_id', p.id,
    'locked', exists(select 1 from public.promo_import_targets t where t.promo_id=p.id),
    'snapshot', public.promo_edit_snapshot(p.id)) order by p.id)
    from public.promos p where lower(btrim(p.name)) in (select lower(btrim(value)) from jsonb_array_elements_text(p_names))), '[]'::jsonb);
end $$;
revoke all on function public.read_promo_import_context(jsonb) from public, anon, service_role;
grant execute on function public.read_promo_import_context(jsonb) to authenticated;

create or replace function public.import_promo_master(p_promos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_entry jsonb;
  v_count integer;
  v_items_total integer := 0;
  v_name text;
  v_key text;
  v_suggest text;
  v_branch_ids uuid[];
  v_item_ids uuid[];
  v_existing public.promos%rowtype;
  v_duplicates integer;
  v_rule jsonb;
  v_min_subtotal numeric;
  v_discount_value numeric;
  v_min_qty numeric;
  v_max_qty numeric;
  v_promo_id uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_seen text[] := '{}';
  v_snapshot jsonb;
begin
  perform public.assert_promo_manager();
  if jsonb_typeof(p_promos) is distinct from 'array' then
    raise exception 'Data impor promo tidak valid' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_promos);
  if v_count not between 1 and 50 then
    raise exception 'Impor daftar promo harus berisi 1 sampai 50 promo' using errcode = '22023';
  end if;

  -- Acquire every batch name in a stable order BEFORE any row/catalog writes.
  -- Otherwise [B,A] versus [A,B] can deadlock after partially processing a batch.
  for v_key in select distinct lower(btrim(value ->> 'name'))
    from jsonb_array_elements(p_promos) order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('vetos:promo-master:' || v_key, 0));
  end loop;

  -- Follow the existing edit/child-guard order: parent rows BEFORE catalogue.
  -- Hold the whole batch parent set in UUID order, never take a global table lock.
  perform p.id from public.promos p where lower(btrim(p.name)) in
    (select lower(btrim(value ->> 'name')) from jsonb_array_elements(p_promos))
    order by p.id for update;

  -- Check EVERY reviewed state before the first write. Parent locks remain held
  -- across later catalogue waits; recheck below immediately before each write.
  for v_entry in select value from jsonb_array_elements(p_promos) loop
    v_name := btrim(v_entry ->> 'name');
    select count(*) into v_duplicates from public.promos p where lower(btrim(p.name))=lower(v_name);
    if v_duplicates > 1 then
      raise exception 'Nama % dipakai lebih dari satu promo; rapikan dulu di layar promo', v_name using errcode='22023';
    end if;
    v_existing := null;
    select * into v_existing from public.promos p where lower(btrim(p.name))=lower(v_name) for update;
    v_snapshot := public.promo_edit_snapshot(v_existing.id);
    if not (v_entry ? 'expected')
       or (v_existing.id is null and v_entry -> 'expected' is distinct from 'null'::jsonb)
       or (v_existing.id is not null and (jsonb_typeof(v_entry -> 'expected') is distinct from 'object'
           or v_entry #>> '{expected,id}' is distinct from v_existing.id::text
           or v_entry #>> '{expected,version}' is distinct from v_snapshot ->> 'version')) then
      raise exception 'PROMO_IMPORT_CONFLICT: Promo sudah berubah. Periksa ulang dan tinjau perubahan sebelum menyimpan lagi.' using errcode='40001';
    end if;
  end loop;

  for v_entry in select value from jsonb_array_elements(p_promos) loop
    if jsonb_typeof(v_entry) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(v_entry) k where k not in
           ('name','discount_type','discount_value','auto_apply','branch_ids','valid_from','valid_until',
            'min_qty','max_qty','kelipatan','min_subtotal','suggest','item_ids','expected')) > 0 then
      raise exception 'Kolom promo tidak lengkap atau tidak diizinkan' using errcode = '22023';
    end if;
    v_name := btrim(v_entry ->> 'name');
    if v_name is null or length(v_name) not between 1 and 120 then
      raise exception 'Nama promo wajib 1-120 karakter' using errcode = '22023';
    end if;
    if lower(v_name) = any(v_seen) then
      raise exception 'Nama promo muncul dua kali dalam satu berkas: %', v_name using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, lower(v_name));
    v_suggest := btrim(coalesce(nullif(v_entry ->> 'suggest', ''), v_name));
    if length(v_suggest) > 160 then
      raise exception 'Teks saran promo % terlalu panjang', v_name using errcode = '22023';
    end if;

    if coalesce(v_entry ->> 'discount_type', '') not in ('percent','nominal') then
      raise exception 'Jenis diskon promo % harus Persen atau Nominal', v_name using errcode = '22023';
    end if;
    if jsonb_typeof(v_entry -> 'discount_value') is distinct from 'number'
       or jsonb_typeof(v_entry -> 'auto_apply') is distinct from 'boolean'
       or jsonb_typeof(v_entry -> 'kelipatan') is distinct from 'boolean' then
      raise exception 'Nilai atau pilihan Ya/Tidak promo % tidak valid', v_name using errcode = '22023';
    end if;
    v_discount_value := (v_entry ->> 'discount_value')::numeric;
    if v_discount_value is null or v_discount_value <= 0
       or v_discount_value::text in ('NaN','Infinity','-Infinity')
       or round(v_discount_value, 2) <> v_discount_value
       or (v_entry ->> 'discount_type' = 'percent' and v_discount_value > 100) then
      raise exception 'Nilai diskon promo % tidak valid', v_name using errcode = '22023';
    end if;
    if coalesce(v_entry ->> 'valid_from', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(v_entry ->> 'valid_until', '') !~ '^\d{4}-\d{2}-\d{2}$'
       or (v_entry ->> 'valid_until')::date < (v_entry ->> 'valid_from')::date then
      raise exception 'Tanggal promo % tidak valid', v_name using errcode = '22023';
    end if;
    foreach v_key in array array['min_qty','max_qty','min_subtotal'] loop
      if jsonb_typeof(v_entry -> v_key) not in ('null','number') then
        raise exception 'Angka promo % tidak valid', v_name using errcode = '22023';
      end if;
    end loop;
    v_min_qty := (v_entry ->> 'min_qty')::numeric;
    v_max_qty := (v_entry ->> 'max_qty')::numeric;
    v_min_subtotal := (v_entry ->> 'min_subtotal')::numeric;
    if v_min_qty <= 0 or v_max_qty <= 0 or v_max_qty < v_min_qty or v_min_subtotal < 0 then
      raise exception 'Syarat jumlah atau belanja promo % tidak valid', v_name using errcode = '22023';
    end if;
    if (v_entry ->> 'auto_apply')::boolean and (v_entry ->> 'kelipatan')::boolean and v_min_qty is null then
      raise exception 'Kelipatan pada promo % memerlukan min. qty terisi', v_name using errcode = '22023';
    end if;

    if jsonb_typeof(v_entry -> 'branch_ids') not in ('array','null') then
      raise exception 'Daftar cabang promo % tidak valid', v_name using errcode = '22023';
    end if;
    select array_agg(distinct x::uuid order by x::uuid) into v_branch_ids
    from jsonb_array_elements_text(coalesce(nullif(v_entry -> 'branch_ids', 'null'::jsonb), '[]'::jsonb)) x;
    if v_branch_ids is not null then
      perform id from public.branches where id = any(v_branch_ids) order by id for share;
      if (select count(*) from public.branches b where b.id = any(v_branch_ids) and b.is_active
          and public.user_can_access_branch(b.id)) <> cardinality(v_branch_ids) then
        raise exception 'Cabang promo % tidak tersedia atau tidak dapat diakses', v_name using errcode = '42501';
      end if;
    end if;

    if jsonb_typeof(v_entry -> 'item_ids') is distinct from 'array'
       or jsonb_array_length(v_entry -> 'item_ids') < 1 then
      raise exception 'Promo % harus menyebut sedikitnya satu barang', v_name using errcode = '22023';
    end if;
    select array_agg(distinct x::uuid order by x::uuid) into v_item_ids
    from jsonb_array_elements_text(v_entry -> 'item_ids') x;
    -- Bound raw submitted rows, not only the deduplicated target set.
    v_items_total := v_items_total + jsonb_array_length(v_entry -> 'item_ids');
    if v_items_total > 500 then
      raise exception 'Maksimal 500 baris barang per berkas' using errcode = '22023';
    end if;
    perform id from public.items where id = any(v_item_ids) order by id for share;
    if (select count(*) from public.items i where i.id = any(v_item_ids) and i.is_active) <> cardinality(v_item_ids) then
      raise exception 'Ada barang promo % yang tidak dikenal atau nonaktif', v_name using errcode = '22023';
    end if;

    -- The complete name set was locked above, before any partial batch writes.
    select count(*) into v_duplicates from public.promos p where lower(btrim(p.name)) = lower(v_name);
    if v_duplicates > 1 then
      raise exception 'Nama % dipakai lebih dari satu promo; rapikan dulu di layar promo', v_name using errcode = '22023';
    end if;
    v_existing := null;
    select * into v_existing from public.promos p where lower(btrim(p.name)) = lower(v_name) for update;

    -- Re-read the canonical header (including activation and the entire rule)
    -- plus sorted FULL target set after all waits. Child writers already lock
    -- this same parent via promo_configuration_guard. Missing expected is unsafe.
    v_snapshot := public.promo_edit_snapshot(v_existing.id);
    if not (v_entry ? 'expected')
       or (v_existing.id is null and v_entry -> 'expected' is distinct from 'null'::jsonb)
       or (v_existing.id is not null and (jsonb_typeof(v_entry -> 'expected') is distinct from 'object'
           or v_entry #>> '{expected,id}' is distinct from v_existing.id::text
           or v_entry #>> '{expected,version}' is distinct from v_snapshot ->> 'version')) then
      raise exception 'PROMO_IMPORT_CONFLICT: Promo sudah berubah. Periksa ulang dan tinjau perubahan sebelum menyimpan lagi.' using errcode = '40001';
    end if;

    v_rule := jsonb_build_object('suggest', v_suggest);
    if v_min_subtotal is not null then v_rule := v_rule || jsonb_build_object('min_subtotal', v_min_subtotal); end if;

    if v_existing.id is not null then
      if v_existing.promo_type <> 'diskon_produk' then
        raise exception 'Nama % sudah dipakai promo jenis %; ganti nama promo', v_name, v_existing.promo_type using errcode = '22023';
      end if;
      if coalesce(v_existing.rule ->> 'discount_mode', 'per_unit') <> 'per_unit' then
        raise exception 'Promo % memakai perhitungan total per paket; ubah lewat layar promo', v_name using errcode = '22023';
      end if;
      if exists (select 1 from public.promo_import_targets t where t.promo_id = v_existing.id) then
        raise exception 'Promo % berasal dari impor per-SKU dan targetnya dikunci; pakai nama baru', v_name using errcode = '22023';
      end if;
      update public.promos set
        name = v_name,
        rule = (coalesce(v_existing.rule, '{}'::jsonb) - 'suggest' - 'min_subtotal') || v_rule,
        min_qty = v_min_qty, max_qty = v_max_qty,
        kelipatan = (v_entry ->> 'kelipatan')::boolean,
        auto_apply = (v_entry ->> 'auto_apply')::boolean,
        discount_type = v_entry ->> 'discount_type',
        discount_value = v_discount_value,
        branch_ids = v_branch_ids,
        valid_from = (v_entry ->> 'valid_from')::date,
        valid_until = (v_entry ->> 'valid_until')::date,
        is_active = v_existing.is_active
      where id = v_existing.id;
      delete from public.promo_items pi where pi.promo_id = v_existing.id and not (pi.item_id = any(v_item_ids));
      insert into public.promo_items(promo_id, item_id)
      select v_existing.id, candidate.id from unnest(v_item_ids) candidate(id)
      where not exists (select 1 from public.promo_items pi where pi.promo_id = v_existing.id and pi.item_id = candidate.id);
      v_updated := v_updated + 1;
    else
      insert into public.promos(name, promo_type, rule, is_active, branch_ids, valid_from, valid_until,
        auto_apply, discount_type, discount_value, min_qty, max_qty, kelipatan)
      values (v_name, 'diskon_produk', v_rule, true, v_branch_ids,
        (v_entry ->> 'valid_from')::date, (v_entry ->> 'valid_until')::date,
        (v_entry ->> 'auto_apply')::boolean, v_entry ->> 'discount_type', v_discount_value,
        v_min_qty, v_max_qty, (v_entry ->> 'kelipatan')::boolean)
      returning id into v_promo_id;
      insert into public.promo_items(promo_id, item_id)
      select v_promo_id, candidate.id from unnest(v_item_ids) candidate(id);
      v_created := v_created + 1;
    end if;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated);
end $$;
revoke all on function public.import_promo_master(jsonb) from public, anon, service_role;
grant execute on function public.import_promo_master(jsonb) to authenticated;
comment on function public.import_promo_master(jsonb) is
  'Impor daftar promo diskon produk dari Excel: satu promo banyak SKU, nama yang sudah ada diperbarui. OWNER/ADMIN saja.';
