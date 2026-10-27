-- Clinic only: optional salesperson for each billed SKU. Historic lines stay NULL.
-- No commission formula, POS service performer, stock, HPP, or grant changes.
alter table public.invoice_items
  add column salesperson_id uuid references public.employees(id) on delete restrict,
  add column salesperson_name text;
create index clinic_invoice_items_salesperson_idx on public.invoice_items(salesperson_id)
  where salesperson_id is not null;

create function public.guard_clinic_line_salesperson() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_branch uuid;v_header_seller uuid;v_reissued uuid;v_source public.invoice_items%rowtype;v_employee public.employees%rowtype;
begin
  select v.branch_id,i.salesperson_id,i.reissued_from into v_branch,v_header_seller,v_reissued
  from public.invoices i join public.visits v on v.id=i.visit_id
  where i.id=new.invoice_id for share of i,v;
  if v_branch is null then raise exception using errcode='P0001',message='CARE_INVALID: invoice klinik tidak memiliki cabang';end if;
  if auth.role()='authenticated' and (auth.uid() is null or not public.user_can_access_branch(v_branch)) then
    raise exception using errcode='P0001',message='ACCESS_DENIED: cabang penjual SKU tidak dapat diakses';
  end if;
  if tg_op='UPDATE' then
    if new.salesperson_id is distinct from old.salesperson_id or new.salesperson_name is distinct from old.salesperson_name
      or (old.salesperson_id is not null and (new.invoice_id is distinct from old.invoice_id
        or new.item_id is distinct from old.item_id or new.jenis is distinct from old.jenis)) then
      raise exception using errcode='P0001',message='CARE_INVALID: penjual baris tersimpan tidak dapat ditulis ulang';
    end if;
    return new;
  end if;
  -- Corrections and reissues must inherit the exact prior line, even if its
  -- employee was renamed or deactivated after the original transaction.
  if new.service_source_line_id is not null then
    select * into v_source from public.invoice_items where id=new.service_source_line_id
      and invoice_id in(new.invoice_id,v_reissued)
      and item_id is not distinct from new.item_id and jenis=new.jenis for share;
    if not found or (new.salesperson_id is not null and new.salesperson_id is distinct from v_source.salesperson_id) then
      raise exception using errcode='P0001',message='CARE_INVALID: sumber penjual baris tidak sesuai invoice';
    end if;
    new.salesperson_id:=v_source.salesperson_id;
    new.salesperson_name:=v_source.salesperson_name;
    return new;
  end if;
  new.salesperson_id:=coalesce(new.salesperson_id,v_header_seller);
  if new.salesperson_id is null then new.salesperson_name:=null;return new;end if;
  select * into v_employee from public.employees where id=new.salesperson_id for share;
  if not found or v_employee.status is distinct from 'Aktif' then
    raise exception using errcode='P0001',message='CARE_INVALID: penjual SKU harus karyawan aktif';
  end if;
  if v_employee.branch_id is distinct from v_branch then
    perform 1 from public.employee_branch_assignments where employee_id=v_employee.id and branch_id=v_branch
      and effective_date <= (now() at time zone 'Asia/Jakarta')::date for share;
    if not found then raise exception using errcode='P0001',message='CARE_INVALID: penjual SKU tidak ditugaskan di cabang invoice';end if;
  end if;
  new.salesperson_name:=v_employee.nama;
  return new;
end $$;
revoke all on function public.guard_clinic_line_salesperson() from public,anon,authenticated,service_role;
create trigger clinic_line_salesperson before insert or update on public.invoice_items
  for each row execute function public.guard_clinic_line_salesperson();

-- Keep existing atomic RPC signatures and ACLs. Fail closed on unexpected
-- definitions rather than deploying code that appears to save attribution.
do $patch$
declare p record;definition text;signature regprocedure;
begin
 for p in select * from (values
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'compound_recipe_id, prescription_item_id, satuan, faktor, service_performers, bmhp_components\n    ) values',
   E'compound_recipe_id, prescription_item_id, satuan, faktor, service_performers, bmhp_components, salesperson_id\n    ) values'),
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'v_unit, v_factor, v_line.value->''service_performers'', v_bmhp\n    ) returning',
   E'v_unit, v_factor, v_line.value->''service_performers'', v_bmhp, nullif(v_line.value->>''salesperson_id'','''')::uuid\n    ) returning'),
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
   'service_performers,service_source_line_id,bmhp_components)',
   'service_performers,service_source_line_id,bmhp_components,salesperson_id)'),
  ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
   E'case when v_kind=''jasa'' then v_bmhp_map->(v_line->>''prescription_item_id'') else null end);',
   E'case when v_kind=''jasa'' then v_bmhp_map->(v_line->>''prescription_item_id'') else null end,nullif(v_line->>''salesperson_id'','''')::uuid);')
 ) as patches(sig,old_text,new_text) loop
  signature:=to_regprocedure(p.sig);
  if signature is null then raise exception 'Line seller required RPC missing: %',p.sig;end if;
  definition:=pg_get_functiondef(signature);
  if (length(definition)-length(replace(definition,p.old_text,'')))/length(p.old_text)<>1 then
    raise exception 'Line seller expected one RPC anchor in %',p.sig;
  end if;
  execute replace(definition,p.old_text,p.new_text);
 end loop;
end $patch$;
