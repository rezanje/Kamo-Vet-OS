-- I09: read-only trace for a clinic racikan whose selling parent is non-stock.
-- Supersedes draft #224's narrower read_compound_production_layer_trace.
--
-- The parent never gets stock rows. The physical facts already exist on the
-- materials: compound_issues (private FIFO takes), stock_moves (source='racik',
-- source_ref=recipe id) and the consumed stock_layers' own origin document.
-- This RPC only reads them; it writes nothing and returns no costs.
--
-- Access: active user with the clinic module (same default rule as
-- stock_document_access, without the open-shift requirement because this is a
-- read) and access to the visit branch. A production job number is returned
-- only to OWNER/ADMIN users who can access the production warehouse branch.
create or replace function public.read_compound_trace(p_recipe_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare me public.profiles%rowtype;clinic_branch uuid;rec record;materials jsonb;moves jsonb;
begin
 if p_recipe_id is null or auth.uid() is null or coalesce(auth.role(),'')<>'authenticated' then
  raise exception 'Akses jejak racikan ditolak' using errcode='42501';
 end if;
 select * into me from public.profiles p where p.id=auth.uid() and p.is_active;
 if not found or not (me.role='OWNER'
   or exists(select 1 from public.role_modules m where m.role=me.role and m.module_id='klinik')
   or (not exists(select 1 from public.role_modules m where m.role=me.role) and me.role in('ADMIN','DOCTOR','STAFF'))) then
  raise exception 'Akses jejak racikan ditolak' using errcode='42501';
 end if;
 select r.id,r.recipe_name,r.status,v.id visit_id,v.branch_id into rec
 from public.compounding_recipes r
 join public.medical_records m on m.id=r.medical_record_id
 join public.visits v on v.id=m.visit_id
 where r.id=p_recipe_id;
 clinic_branch:=rec.branch_id;
 if clinic_branch is null or not public.user_can_access_branch(clinic_branch) then
  raise exception 'Akses jejak racikan ditolak' using errcode='42501';
 end if;

 -- One row per FIFO take: what was consumed, from which warehouse, which
 -- origin document created that layer, and which invoice line consumed it.
 select coalesce(jsonb_agg(jsonb_build_object(
   'ingredient_id',ci.ingredient_id,'item_id',ci.item_id,'item_name',i.name,'unit',coalesce(nullif(i.unit,''),'pcs'),
   'warehouse_name',w.name,'qty',ci.qty,'exp_date',ci.exp_date,
   'restored',ci.restored_at is not null,
   'origin',jsonb_build_object('source',l.source,'ref',case when l.source='produksi' then null else l.source_ref end,'tanggal',l.tanggal,
     'production_order_id',case when po.id is not null and me.role in('OWNER','ADMIN') and public.user_can_access_branch(pw.branch_id) then po.id end,
     'no_produksi',case when po.id is not null and me.role in('OWNER','ADMIN') and public.user_can_access_branch(pw.branch_id) then po.no_produksi end),
   'invoice',case when inv.id is null then null else jsonb_build_object('id',inv.id,'visit_id',inv.visit_id,'invoice_no',inv.invoice_no,'voided',inv.voided_at is not null) end
  ) order by i.name,ci.item_id,l.tanggal,ci.id),'[]'::jsonb) into materials
 from public.compound_issues ci
 join public.items i on i.id=ci.item_id
 join public.warehouses w on w.id=ci.warehouse_id
 join public.stock_layers l on l.id=ci.stock_layer_id
 left join public.production_orders po on l.source='produksi' and po.no_produksi=l.source_ref and po.status='selesai'
 left join public.warehouses pw on pw.id=po.warehouse_id
 left join public.invoice_items ii on ii.id=ci.posted_invoice_item_id
 left join public.invoices inv on inv.id=ii.invoice_id and inv.visit_id=rec.visit_id
 where ci.recipe_id=p_recipe_id;

 -- The stock card rows of the materials for this racikan (issue and, after a
 -- void, the restore). The parent itself has none by design.
 select coalesce(jsonb_agg(jsonb_build_object(
   'tanggal',sm.tanggal,'item_id',sm.item_id,'item_name',i.name,'unit',coalesce(nullif(i.unit,''),'pcs'),
   'warehouse_name',w.name,'qty',sm.qty) order by sm.created_at,sm.id),'[]'::jsonb) into moves
 from public.stock_moves sm
 join public.items i on i.id=sm.item_id
 join public.warehouses w on w.id=sm.warehouse_id
 where sm.source='racik' and sm.source_ref=p_recipe_id::text;

 return jsonb_build_object('recipe_id',rec.id,'recipe_name',rec.recipe_name,'status',rec.status,'visit_id',rec.visit_id,
  'materials',materials,'moves',moves);
end$$;
revoke all on function public.read_compound_trace(uuid) from public,anon,service_role;
grant execute on function public.read_compound_trace(uuid) to authenticated;
