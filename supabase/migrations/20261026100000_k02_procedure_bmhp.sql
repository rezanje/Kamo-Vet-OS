-- K02: BMHP (bahan habis pakai) as actual usage linked to a clinical procedure row.
-- Approved semantics (Founder, 26 Oct 2026): usage is recorded on the procedure row,
-- stock is issued once when the invoice posts (existing FIFO/moving-average path),
-- its cost becomes the procedure line HPP (existing 'klinik-hpp' 5101/1301 journal),
-- and void/reissue/edit reverse it through the existing correction paths.
-- Selling price, revenue lines and commission rules are unchanged; no new roles/grants.
-- Additive: nullable columns, private helpers, exact-anchor patches that fail on drift.

alter table public.prescription_items add column bmhp_components jsonb;
alter table public.invoice_items add column bmhp_components jsonb;

-- Capability probe for the app, same pattern as clinic_manual_invoice_units_supported().
create function public.clinic_bmhp_supported() returns boolean
language sql immutable set search_path = pg_catalog, public as $$ select true $$;
revoke all on function public.clinic_bmhp_supported() from public, anon, service_role;
grant execute on function public.clinic_bmhp_supported() to authenticated;

-- Normalise the doctor's actual usage. Names/costs are never accepted from clients.
create function public.guard_prescription_bmhp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_row jsonb; v_out jsonb := '[]'::jsonb; v_item public.items%rowtype;
  v_qty numeric; v_unit text; v_factor numeric; v_seen uuid[] := array[]::uuid[]; v_id uuid; v_type text;
begin
  if tg_op = 'UPDATE' then
    if new.bmhp_components is distinct from old.bmhp_components
       or (old.bmhp_components is not null and (new.item_id is distinct from old.item_id
         or new.jenis is distinct from old.jenis or new.medical_record_id is distinct from old.medical_record_id)) then
      raise exception using errcode = 'P0001', message = 'BMHP_INVALID: BMHP tersimpan tidak dapat diubah langsung';
    end if;
    return new;
  end if;
  if new.bmhp_components is null or new.bmhp_components = '[]'::jsonb then
    new.bmhp_components := null; return new;
  end if;
  select i.item_type into v_type from public.items i where i.id = new.item_id;
  if new.jenis is distinct from 'jasa' or new.item_id is null or v_type is distinct from 'Jasa' then
    raise exception using errcode = 'P0001', message = 'BMHP_INVALID: BMHP hanya untuk baris tindakan/jasa dari master';
  end if;
  if jsonb_typeof(new.bmhp_components) <> 'array' or jsonb_array_length(new.bmhp_components) > 50 then
    raise exception using errcode = 'P0001', message = 'BMHP_INVALID: daftar BMHP tidak valid';
  end if;
  for v_row in select value from jsonb_array_elements(new.bmhp_components) loop
    begin
      if jsonb_typeof(v_row) <> 'object' then raise exception 'shape'; end if;
      v_id := (v_row->>'item_id')::uuid;
      v_qty := (v_row->>'qty')::numeric;
      v_unit := nullif(btrim(v_row->>'unit'), '');
    exception when others then
      raise exception using errcode = 'P0001', message = 'BMHP_INVALID: bahan atau jumlah BMHP tidak valid';
    end;
    if v_id is null or v_qty is null or v_qty <= 0 or v_qty > 100000 or v_qty::text in ('NaN','Infinity')
       or v_id = any(v_seen) then
      raise exception using errcode = 'P0001', message = 'BMHP_INVALID: bahan atau jumlah BMHP tidak valid';
    end if;
    select * into v_item from public.items where id = v_id and is_active and item_type = 'Persediaan';
    if not found then
      raise exception using errcode = 'P0001', message = 'BMHP_INVALID: BMHP harus barang persediaan aktif';
    end if;
    v_unit := coalesce(v_unit, v_item.unit);
    if v_unit = v_item.unit then v_factor := 1;
    else
      select iu.factor into v_factor from public.item_units iu where iu.item_id = v_id and iu.unit = v_unit;
      if not found or v_factor is null or v_factor <= 0 then
        raise exception using errcode = 'P0001', message = 'BMHP_INVALID: satuan BMHP tidak ditemukan';
      end if;
    end if;
    v_seen := v_seen || v_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('item_id', v_id, 'name', v_item.name,
      'qty', v_qty, 'unit', v_unit, 'factor', v_factor, 'base_qty', round(v_qty * v_factor, 4)));
  end loop;
  new.bmhp_components := v_out;
  return new;
end $$;
revoke all on function public.guard_prescription_bmhp() from public, anon, authenticated, service_role;
create trigger k02_prescription_bmhp before insert or update on public.prescription_items
  for each row execute function public.guard_prescription_bmhp();

-- Posted snapshots are written only by the posting/correction RPCs (definer context).
create function public.guard_invoice_item_bmhp() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.bmhp_components is distinct from old.bmhp_components then
    raise exception using errcode = 'P0001', message = 'BMHP_INVALID: snapshot BMHP invoice tidak dapat diubah';
  end if;
  if tg_op = 'INSERT' and new.bmhp_components is not null
     and current_user in ('authenticated', 'anon', 'service_role') then
    raise exception using errcode = 'P0001', message = 'BMHP_INVALID: snapshot BMHP hanya dari posting invoice';
  end if;
  return new;
end $$;
revoke all on function public.guard_invoice_item_bmhp() from public, anon, authenticated, service_role;

create schema if not exists clinic_private;
revoke all on schema clinic_private from public, anon, authenticated, service_role;

-- Issue one procedure row's BMHP through the existing stock-out routine.
create function clinic_private.bmhp_issue(p_prescription_item_id uuid, p_warehouse_id uuid, p_ref text, p_date date)
returns jsonb language plpgsql set search_path = '' as $$
declare v_components jsonb; v_c jsonb; v_item public.items%rowtype; v_stock numeric; v_out record;
  v_cost numeric(15,2); v_total numeric(15,2) := 0; v_snapshot jsonb := '[]'::jsonb; v_qty numeric;
begin
  select pi.bmhp_components into v_components from public.prescription_items pi
  where pi.id = p_prescription_item_id for share;
  if v_components is null then return null; end if;
  if exists (select 1 from public.invoice_items ii join public.invoices i on i.id = ii.invoice_id
    where ii.prescription_item_id = p_prescription_item_id and ii.bmhp_components is not null and i.voided_at is null) then
    raise exception using errcode = 'P0001', message = 'BMHP_POSTED: BMHP tindakan ini sudah diposting';
  end if;
  if p_warehouse_id is null then
    raise exception using errcode = 'P0001', message = 'WAREHOUSE_MISSING: gudang klinik aktif tidak ditemukan';
  end if;
  for v_c in select value from jsonb_array_elements(v_components) loop
    v_qty := (v_c->>'base_qty')::numeric;
    select * into v_item from public.items where id = (v_c->>'item_id')::uuid and is_active and item_type = 'Persediaan' for share;
    if not found then
      raise exception using errcode = 'P0001', message = format('BMHP_INVALID: %s tidak aktif', v_c->>'name');
    end if;
    select s.qty into v_stock from public.stock s where s.warehouse_id = p_warehouse_id and s.item_id = v_item.id for update;
    if coalesce(v_stock, 0) < v_qty then
      raise exception using errcode = 'P0001', message = format('STOCK_SHORT: %s', v_item.name);
    end if;
    select * into v_out from public.stock_out_fifo(p_warehouse_id, v_item.id, v_qty, 'klinik-bmhp', p_ref, p_date);
    if v_out.shortfall > 0 or v_out.cost is null or v_out.cost <= 0 or (not public.inventory_is_average() and exists (
      select 1 from jsonb_array_elements(v_out.takes) t where (t.value->>'unit_cost')::numeric <= 0)) then
      raise exception using errcode = 'P0001', message = format('COST_MISSING: %s', v_item.name);
    end if;
    v_cost := round(v_out.cost, 2);
    v_total := v_total + v_cost;
    v_snapshot := v_snapshot || jsonb_build_array(v_c || jsonb_build_object('cost', v_cost));
  end loop;
  return jsonb_build_object('version', 1, 'cost', v_total, 'components', v_snapshot);
end $$;

-- Correction: keep BMHP of retained procedure rows; return removed rows' BMHP at
-- historical cost (same rule edit uses for removed medicines). Never re-issue.
create function clinic_private.bmhp_edit_plan(p_invoice_id uuid, p_lines jsonb, p_warehouse_id uuid, p_ref text)
returns jsonb language plpgsql set search_path = '' as $$
declare v_map jsonb := '{}'::jsonb; r record; v_c jsonb; v_qty numeric; v_cost numeric;
begin
  for r in select ii.prescription_item_id, ii.bmhp_components from public.invoice_items ii
    where ii.invoice_id = p_invoice_id and ii.bmhp_components is not null order by ii.id loop
    if exists (select 1 from jsonb_array_elements(p_lines) x where x.value->>'kind' = 'jasa'
      and nullif(x.value->>'prescription_item_id', '')::uuid = r.prescription_item_id) then
      v_map := v_map || jsonb_build_object(r.prescription_item_id::text, r.bmhp_components);
    else
      if p_warehouse_id is null then
        raise exception using errcode = 'P0001', message = 'WAREHOUSE_MISSING: gudang klinik tidak tersedia';
      end if;
      for v_c in select value from jsonb_array_elements(r.bmhp_components->'components') loop
        v_qty := (v_c->>'base_qty')::numeric; v_cost := (v_c->>'cost')::numeric;
        if v_qty is null or v_qty <= 0 or v_cost is null or v_cost <= 0 then
          raise exception using errcode = 'P0001', message = 'COST_MISSING: HPP BMHP lama tidak tersedia';
        end if;
        perform public.stock_in_fifo(p_warehouse_id, (v_c->>'item_id')::uuid, v_qty, v_cost / v_qty,
          'klinik-edit', p_ref, current_date, null);
      end loop;
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(p_lines) x
    join public.prescription_items pi on pi.id = nullif(x.value->>'prescription_item_id', '')::uuid
    where pi.bmhp_components is not null and not (v_map ? pi.id::text)) then
    raise exception using errcode = 'P0001', message = 'BMHP_INVALID: tindakan ber-BMHP tidak dapat ditambahkan lewat koreksi';
  end if;
  return v_map;
end $$;
revoke all on function clinic_private.bmhp_issue(uuid, uuid, text, date) from public, anon, authenticated, service_role;
revoke all on function clinic_private.bmhp_edit_plan(uuid, jsonb, uuid, text) from public, anon, authenticated, service_role;

create trigger k02_invoice_item_bmhp before insert or update on public.invoice_items
  for each row execute function public.guard_invoice_item_bmhp();

-- Exact-anchor patches of existing atomic RPCs (signatures/ACL/hash unchanged).
do $patch$
declare p record; definition text; signature regprocedure;
begin
 for p in select * from (values
  -- clinical saves carry the doctor's usage into the row
  ('public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text)',
   E'harga, aturan_pakai, jenis, kategori, service_performers\n    )', E'harga, aturan_pakai, jenis, kategori, service_performers, bmhp_components\n    )'),
  ('public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text)',
   E'v_row->>''kategori'', v_row->''service_performers''\n    );', E'v_row->>''kategori'', v_row->''service_performers'', v_row->''bmhp_components''\n    );'),
  ('public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text)',
   E'harga, aturan_pakai, jenis, kategori, service_performers\n    )', E'harga, aturan_pakai, jenis, kategori, service_performers, bmhp_components\n    )'),
  ('public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text)',
   E'v_row->>''kategori'', v_row->''service_performers''\n    );', E'v_row->>''kategori'', v_row->''service_performers'', v_row->''bmhp_components''\n    );'),
  -- posting: lock BMHP stock rows in the shared item order, issue once on the procedure line
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)', '  v_cashier_shift_ok boolean;', E'  v_cashier_shift_ok boolean;\n  v_bmhp jsonb;'),
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'    select distinct (e.value ->> ''item_id'')::uuid as item_id\n    from jsonb_array_elements(p_lines) as e(value)\n    where nullif(e.value ->> ''item_id'', '''') is not null\n      and coalesce(e.value ->> ''kind'', ''obat'') <> ''jasa''\n    order by item_id',
   E'    select x.item_id from (\n      select (e.value ->> ''item_id'')::uuid as item_id\n      from jsonb_array_elements(p_lines) as e(value)\n      where nullif(e.value ->> ''item_id'', '''') is not null\n        and coalesce(e.value ->> ''kind'', ''obat'') <> ''jasa''\n      union\n      select (c.value ->> ''item_id'')::uuid\n      from jsonb_array_elements(p_lines) as e(value)\n      join public.prescription_items pi on pi.id = nullif(e.value ->> ''prescription_item_id'', '''')::uuid\n      cross join lateral jsonb_array_elements(coalesce(pi.bmhp_components, ''[]''::jsonb)) as c(value)\n      where e.value ->> ''kind'' = ''jasa''\n    ) x order by x.item_id'),
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)', E'    v_factor := 1;\n    v_line_hpp := null;', E'    v_factor := 1;\n    v_line_hpp := null;\n    v_bmhp := null;'),
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)', E'      v_unit := coalesce(v_unit, ''jasa'');\n',
   E'      v_unit := coalesce(v_unit, ''jasa'');\n      -- K02_BMHP: actual usage on the clinical procedure row is issued once, at posting.\n      if v_prescription_item_id is not null then\n        v_bmhp := clinic_private.bmhp_issue(v_prescription_item_id, v_warehouse_id, v_invoice_no, v_tanggal);\n        if v_bmhp is not null then v_line_hpp := (v_bmhp ->> ''cost'')::numeric(15,2); end if;\n      end if;\n'),
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)', E'compound_recipe_id, prescription_item_id, satuan, faktor, service_performers\n    ) values',
   E'compound_recipe_id, prescription_item_id, satuan, faktor, service_performers, bmhp_components\n    ) values'),
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)', E'v_unit, v_factor, v_line.value->''service_performers''\n    ) returning',
   E'v_unit, v_factor, v_line.value->''service_performers'', v_bmhp\n    ) returning'),
  -- reissue keeps the posted usage on the replacement invoice (stock is not moved, like medicines)
  ('public.clinic_void_reissue_invoice_core(uuid,text,text)', 'prescription_item_id,satuan,faktor,service_performers,service_source_line_id)',
   'prescription_item_id,satuan,faktor,service_performers,service_source_line_id,bmhp_components)'),
  ('public.clinic_void_reissue_invoice_core(uuid,text,text)', 'prescription_item_id,satuan,faktor,service_performers,id from public.invoice_items where invoice_id=p_invoice_id;',
   'prescription_item_id,satuan,faktor,service_performers,id,bmhp_components from public.invoice_items where invoice_id=p_invoice_id;'),
  -- correction keeps retained BMHP and returns removed BMHP
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)', 'v_line jsonb; v_service_old_ids uuid[];', 'v_line jsonb; v_service_old_ids uuid[]; v_bmhp_map jsonb;'),
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
   '  select coalesce(array_agg(id),array[]::uuid[]) into v_service_old_ids from public.invoice_items where invoice_id=p_invoice_id;',
   E'  v_bmhp_map := clinic_private.bmhp_edit_plan(p_invoice_id, p_lines, v_warehouse, v_invoice.invoice_no);\n  select coalesce(array_agg(id),array[]::uuid[]) into v_service_old_ids from public.invoice_items where invoice_id=p_invoice_id;'),
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)', E'item_id,hpp,prescription_item_id,satuan,faktor,service_performers,service_source_line_id)\n    values(',
   E'item_id,hpp,prescription_item_id,satuan,faktor,service_performers,service_source_line_id,bmhp_components)\n    values('),
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)', E'then (v_hpp_map->>v_item::text)::numeric else null end,',
   E'then (v_hpp_map->>v_item::text)::numeric\n        when v_kind=''jasa'' and v_bmhp_map ? coalesce(v_line->>''prescription_item_id'','''')\n        then (v_bmhp_map->(v_line->>''prescription_item_id'')->>''cost'')::numeric else null end,'),
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)', E'nullif(v_line->>''source_invoice_item_id'','''')::uuid);',
   E'nullif(v_line->>''source_invoice_item_id'','''')::uuid,\n      case when v_kind=''jasa'' then v_bmhp_map->(v_line->>''prescription_item_id'') else null end);'),
  -- refund source does not restock BMHP; fail closed to manual reconciliation
  ('public.clinic_refund_source_core(uuid)', 'x.compound_recipe_id is not null or(x.jenis=''obat''',
   'x.compound_recipe_id is not null or x.bmhp_components is not null or(x.jenis=''obat''')
 ) as patches(sig, old_text, new_text) loop
  signature := to_regprocedure(p.sig);
  if signature is null then raise exception 'K02 missing required RPC: %', p.sig; end if;
  definition := pg_get_functiondef(signature);
  if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then
   raise exception 'K02 expected exactly one anchor in %: %', p.sig, left(p.old_text, 80);
  end if;
  execute replace(definition, p.old_text, p.new_text);
 end loop;
end $patch$;
