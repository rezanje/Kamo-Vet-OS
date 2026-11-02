-- Durable, explicit pending origin only. No inference, pricing, role or posting changes.
alter table public.prescription_items
 add column package_item_id uuid references public.items(id) on delete restrict,
 add column package_qty numeric(15,4),
 add constraint prescription_items_package_origin_pair check (
  (package_item_id is null and package_qty is null) or
  (package_item_id is not null and package_qty is not null and package_qty>0
   and package_qty<=100000 and package_qty=trunc(package_qty)));
create index prescription_items_pending_package_idx on public.prescription_items(package_item_id)
 where package_item_id is not null;

-- All supported recipe members, exactly once per SKU, with one coherent count.
-- Pin recipe membership (including absent/new members), active/type and unit facts.
-- NOWAIT deliberately fails closed instead of adding a master-row wait after the
-- original coordinator/shift/Rx locks. No actor lock or original lock is reordered.
create function clinic_private.assert_pending_package_rows(p_rows jsonb) returns void
language plpgsql set search_path='' as $$
declare g record; row_value jsonb; i public.items%rowtype; f numeric; expected numeric;
begin
 if not exists(select 1 from jsonb_array_elements(p_rows) l
   where nullif(l->>'package_item_id','') is not null or nullif(l->>'package_qty','') is not null) then return;end if;
 lock table public.items,public.item_group_components,public.item_units in share mode nowait;
 -- A lifecycle SELECT FOR UPDATE holds only RowShare on items. Reject its row
 -- lock now, before the new FK or any original downstream item FK can wait and
 -- invert that lifecycle writer's later RowExclusive table upgrade.
 perform 1 from public.items master where master.id in (
  select nullif(l->>'item_id','')::uuid from jsonb_array_elements(p_rows) l
  union select nullif(l->>'package_item_id','')::uuid from jsonb_array_elements(p_rows) l
  union select nullif(b->>'item_id','')::uuid from jsonb_array_elements(p_rows) l
    cross join lateral jsonb_array_elements(coalesce(nullif(l->'bmhp_components','null'),'[]')) b
 ) order by master.id for share nowait;
 if exists(select 1 from jsonb_array_elements(p_rows) l where
   (nullif(l->>'package_item_id','') is null) <> (nullif(l->>'package_qty','') is null)) then
  raise exception 'PACKAGE_INVALID: asal paket wajib berpasangan';end if;
 for g in select (l->>'package_item_id')::uuid id,min((l->>'package_qty')::numeric) n,
   count(distinct (l->>'package_qty')::numeric) counts,count(*) rows,count(distinct l->>'item_id') members
   from jsonb_array_elements(p_rows) l where nullif(l->>'package_item_id','') is not null group by 1 loop
  if g.n is null or g.n<=0 or g.n>100000 or g.n<>trunc(g.n) or g.counts<>1 or g.rows<>g.members
   or not exists(select 1 from public.items where id=g.id and item_type='Grup' and is_active) then
   raise exception 'PACKAGE_INVALID: paket/jumlah/komponen tidak koheren';end if;
  if g.members<>(select count(distinct c.component_item_id) from public.item_group_components c
    join public.items catalogue on catalogue.id=c.component_item_id where c.group_item_id=g.id and catalogue.item_type in ('Jasa','Persediaan'))
   or g.members=0 then raise exception 'PACKAGE_INVALID: isi paket harus lengkap';end if;
  for row_value in select value from jsonb_array_elements(p_rows) where value->>'package_item_id'=g.id::text loop
   select * into i from public.items where id=(row_value->>'item_id')::uuid and is_active and item_type in ('Jasa','Persediaan');
   if not found or nullif(coalesce(row_value->>'compound_recipe_id',row_value->>'recipe_id'),'') is not null then
    raise exception 'PACKAGE_INVALID: komponen master aktif wajib';end if;
   f:=null;
   if coalesce(row_value->>'satuan',row_value->>'unit',i.unit)=i.unit then f:=1;
   else select u.factor into f from public.item_units u where u.item_id=i.id and u.unit=coalesce(row_value->>'satuan',row_value->>'unit');end if;
   if f is null or f<=0 or (nullif(row_value->>'faktor','') is not null and (row_value->>'faktor')::numeric<>f)
    or coalesce(row_value->>'jenis',row_value->>'kind',case when i.item_type='Jasa' then 'jasa' else 'obat' end)
      <>(case when i.item_type='Jasa' then 'jasa' else 'obat' end) then
    raise exception 'PACKAGE_INVALID: satuan/faktor/jenis komponen tidak sesuai master';end if;
   -- Recipe factors too must describe actual units; neither client nor stale recipe
   -- factors are authority for a conversion no longer present in item_units.
   if exists(select 1 from public.item_group_components c where c.group_item_id=g.id and c.component_item_id=i.id
     and (c.qty<=0 or c.factor<=0 or c.factor is distinct from
       case when c.unit=i.unit then 1 else (select u.factor from public.item_units u where u.item_id=i.id and u.unit=c.unit) end)) then
    raise exception 'PACKAGE_INVALID: satuan resep paket berubah';end if;
   select sum(c.qty*c.factor) into expected from public.item_group_components c where c.group_item_id=g.id and c.component_item_id=i.id;
   if expected is null or (row_value->>'qty')::numeric is null or (row_value->>'qty')::numeric*f is distinct from g.n*expected then
    raise exception 'PACKAGE_INVALID: jumlah komponen tidak sesuai resep paket';end if;
  end loop;
 end loop;
end$$;
revoke all on function clinic_private.assert_pending_package_rows(jsonb) from public,anon,authenticated,service_role;

-- A constraint trigger also covers original clinical/direct ingress. Check the final
-- pending set, not the first component INSERT of an atomic five-component selection.
create function public.check_pending_package_origin() returns trigger
language plpgsql security definer set search_path='' as $$
declare v uuid;
begin
 if tg_op='UPDATE' and (new.package_item_id is distinct from old.package_item_id or new.package_qty is distinct from old.package_qty)
  and exists(select 1 from public.invoice_items where prescription_item_id=old.id) then
  raise exception 'PACKAGE_INVALID: asal resep tertagih tidak dapat ditulis ulang';end if;
 select visit_id into v from public.medical_records where id=case when tg_op='DELETE' then old.medical_record_id else new.medical_record_id end;
 perform clinic_private.assert_pending_package_rows(clinic_private.pending_cashier_rows(v));
 return null;
end$$;
revoke all on function public.check_pending_package_origin() from public,anon,authenticated,service_role;
create constraint trigger prescription_package_complete after insert or update or delete on public.prescription_items
 deferrable initially deferred for each row execute function public.check_pending_package_origin();

-- Legacy stage callers omit tags. Only the explicit durable source may supply them;
-- caller tags cannot upgrade an untagged historical prescription into a package.
create function clinic_private.pending_package_stage_lines(p_visit uuid,p_lines jsonb,p_validate boolean)
returns jsonb language plpgsql set search_path='' as $$
declare l jsonb; rx public.prescription_items%rowtype; result jsonb:='[]';
begin
 for l in select value from jsonb_array_elements(p_lines) loop
  if nullif(l->>'prescription_item_id','') is not null then
   select p.* into rx from public.prescription_items p join public.medical_records m on m.id=p.medical_record_id
    where p.id=(l->>'prescription_item_id')::uuid and m.visit_id=p_visit;
   if found then
    if (nullif(l->>'package_item_id','') is not null and (l->>'package_item_id')::uuid is distinct from rx.package_item_id)
     or (nullif(l->>'package_qty','') is not null and (l->>'package_qty')::numeric is distinct from rx.package_qty) then
     raise exception 'PACKAGE_INVALID: asal paket berbeda dari resep tersimpan';end if;
    if rx.package_item_id is not null then
     l:=l||jsonb_build_object('package_item_id',rx.package_item_id,'package_qty',rx.package_qty);
    end if;
   end if;
  end if;
  result:=result||jsonb_build_array(l);
 end loop;
 if p_validate then perform clinic_private.assert_pending_package_rows(result);end if;
 return result;
end$$;
revoke all on function clinic_private.pending_package_stage_lines(uuid,jsonb,boolean) from public,anon,authenticated,service_role;

-- Exact counted anchors preserve function headers/ACLs/definer/settings and all
-- original business code. H05/P03, invoice/stock/money cores remain byte-identical.
do $patch$
declare p record; d text;
begin
 for p in select * from (values
 ('public.protect_official_compound_snapshot()',
  E'  elsif tg_table_name = ''prescription_items'' then\n    v_recipe_id :=',
  E'  elsif tg_table_name = ''prescription_items'' then\n    -- PR420 withdraws only billing eligibility after original stock return.\n    -- Keep every clinical, price and origin field byte-identical; direct DML\n    -- cannot use this nested trigger-only exception.\n    if tg_op = ''UPDATE'' and pg_trigger_depth()>1\n       and old.billing_withdrawn_at is null and new.billing_withdrawn_at is not null\n       and new.billing_withdrawn_by is not distinct from auth.uid()\n       and new.billing_withdrawal_reason = ''Racikan dibatalkan; bahan dikembalikan ke stok''\n       and (to_jsonb(new)-array[''billing_withdrawn_at'',''billing_withdrawn_by'',''billing_withdrawal_reason''])\n         = (to_jsonb(old)-array[''billing_withdrawn_at'',''billing_withdrawn_by'',''billing_withdrawal_reason''])\n       and exists(select 1 from public.compounding_recipes c where c.id=old.compound_recipe_id and c.status=''void'')\n       and exists(select 1 from public.compound_issues ci where ci.recipe_id=old.compound_recipe_id)\n       and not exists(select 1 from public.compound_issues ci where ci.recipe_id=old.compound_recipe_id and (ci.restored_at is null or ci.posted_invoice_item_id is not null))\n       and exists(select 1 from public.medical_records mr join public.inpatient_records ir on ir.visit_id=mr.visit_id where mr.id=old.medical_record_id)\n       and not exists(select 1 from public.invoice_items ii join public.invoices i on i.id=ii.invoice_id where ii.prescription_item_id=old.id and i.voided_at is null) then\n      return new;\n    end if;\n    v_recipe_id :='),
 ('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)',
  '  for row_value in select value from jsonb_array_elements(p_rows)loop',
  E'  perform clinic_private.assert_pending_package_rows(p_rows);\n  for row_value in select value from jsonb_array_elements(p_rows)loop'),
 ('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)',
  'harga,jenis,kategori,service_performers)', 'harga,jenis,kategori,service_performers,package_item_id,package_qty)'),
 ('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)',
  'v_item.tindakan_kategori,nullif(row_value->''service_performers'',''null''));',
  'v_item.tindakan_kategori,nullif(row_value->''service_performers'',''null''),nullif(row_value->>''package_item_id'','''')::uuid,nullif(row_value->>''package_qty'','''')::numeric);'),
 ('public.clinic_save_inpatient_cashier(uuid,uuid,text,date,text,jsonb,jsonb,text,boolean,text,text)',
  'update public.prescription_items set qty=v_qty,harga=v_price,item_id=v_item.id,',
  'update public.prescription_items set package_item_id=nullif(row_value->>''package_item_id'','''')::uuid,package_qty=nullif(row_value->>''package_qty'','''')::numeric,qty=v_qty,harga=v_price,item_id=v_item.id,'),
 ('clinic_private.inpatient_payment_quote(uuid,uuid,jsonb)',
  '''prescription_item_id'',pi.id,''recipe_id'',pi.compound_recipe_id,''discount_percent'',0)',
  '''prescription_item_id'',pi.id,''recipe_id'',pi.compound_recipe_id,''discount_percent'',0)||case when pi.package_item_id is null then ''{}''::jsonb else jsonb_build_object(''package_item_id'',pi.package_item_id,''package_qty'',pi.package_qty) end'),
 ('clinic_private.pending_cashier_rows(uuid)',
  'to_jsonb(p)',
  '(to_jsonb(p)-array[''package_item_id'',''package_qty''])||case when p.package_item_id is null then ''{}''::jsonb else jsonb_build_object(''package_item_id'',p.package_item_id,''package_qty'',p.package_qty) end'),
 ('clinic_private.outpatient_cart_version(uuid)',
  'to_jsonb(p)',
  '(to_jsonb(p)-array[''package_item_id'',''package_qty''])||case when p.package_item_id is null then ''{}''::jsonb else jsonb_build_object(''package_item_id'',p.package_item_id,''package_qty'',p.package_qty) end'),
 ('public.clinic_post_inpatient_stage_invoice(uuid,text,jsonb,jsonb)',
  '  perform clinic_private.context_begin(''stage'', p_visit_id);',
  E'  p_lines:=clinic_private.pending_package_stage_lines(p_visit_id,p_lines,not v_replay);\n  perform clinic_private.context_begin(''stage'', p_visit_id);'),
 ('public.clinic_read_inpatient_cashier(uuid,uuid)',
  'jsonb_agg(to_jsonb(l) order by l.created_at,l.id)',
  'jsonb_agg(to_jsonb(l)||case when l.package_item_id is null then ''{}''::jsonb else jsonb_build_object(''package_name'',(select g.name from public.items g where g.id=l.package_item_id)) end order by l.created_at,l.id)'),
 ('public.clinic_edit_queued_record(uuid,uuid,integer,jsonb,jsonb,text,text)',
  'harga,aturan_pakai,jenis,kategori,bmhp_components,service_performers)',
  'harga,aturan_pakai,jenis,kategori,bmhp_components,service_performers,package_item_id,package_qty)'),
 ('public.clinic_edit_queued_record(uuid,uuid,integer,jsonb,jsonb,text,text)',
  'nullif(row_value->''service_performers'',''null'')) returning id into v_id;',
  'nullif(row_value->''service_performers'',''null''),nullif(row_value->>''package_item_id'','''')::uuid,nullif(row_value->>''package_qty'','''')::numeric) returning id into v_id;'),
 ('public.clinic_edit_queued_record(uuid,uuid,integer,jsonb,jsonb,text,text)',
  'update public.prescription_items set nama_obat=',
  'update public.prescription_items set package_item_id=nullif(row_value->>''package_item_id'','''')::uuid,package_qty=nullif(row_value->>''package_qty'','''')::numeric,nama_obat=')
 ) as patches(signature,old_text,new_text) loop
  d:=pg_get_functiondef(p.signature::regprocedure);
  if (length(d)-length(replace(d,p.old_text,'')))/length(p.old_text)<>1 then raise exception 'Pending package anchor drift: % / %',p.signature,p.old_text;end if;
  execute replace(d,p.old_text,p.new_text);
 end loop;
end $patch$;

-- Shared literal INSERT shapes in original initial-record and daily-log writers.
do $clinical$
declare sig text;d text;needle text;replacement text;p record;
begin
 foreach sig in array array[
  'public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text)',
  'public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text)',
  'public.clinic_add_inpatient_billables(uuid,jsonb,jsonb,text,text)',
  'public.clinic_add_record_items(uuid,text,jsonb,jsonb)'] loop
  d:=pg_get_functiondef(sig::regprocedure);
  if sig like '%clinic_add_record_items%' then
   needle:='harga, aturan_pakai, jenis, kategori, service_performers, bmhp_components';
   replacement:=needle||', package_item_id, package_qty';
  elsif sig like '%clinic_add_inpatient_billables%' then
   needle:='service_performers,bmhp_components,salesperson_id)';replacement:='service_performers,bmhp_components,salesperson_id,package_item_id,package_qty)';
  else
   needle:='service_performers, bmhp_components, salesperson_id';replacement:=needle||', package_item_id, package_qty';
  end if;
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Pending clinical columns anchor drift: %',sig;end if;
  d:=replace(d,needle,replacement);
  if sig like '%clinic_add_record_items%' then
   needle:='v_row->''service_performers'', v_row->''bmhp_components''';
  else needle:='nullif(v_row->>''salesperson_id'','''')::uuid';end if;
  replacement:=needle||', nullif(v_row->>''package_item_id'','''')::uuid, nullif(v_row->>''package_qty'','''')::numeric';
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Pending clinical values anchor drift: %',sig;end if;
  execute replace(d,needle,replacement);
 end loop;
end $clinical$;
