-- Owner apply: same text as supabase/migrations/20261029130000_fix_grooming_trigger_update.sql,
-- wrapped in one transaction. Run preflight.sql first; it must show body_md5 = 019ceed5f3e0951a00cd97c7e22e984a.
begin;
-- Fix: zz_grooming_requirement raised `record "new" has no field "sale_id"` on every
-- UPDATE of prescription_items / invoice_items (and on sale_items UPDATEs that change
-- sale_id/item_id). PL/pgSQL resolves each NEW/OLD field of an IF expression even when
-- an earlier AND term is false, so the per-table checks are now nested per table.
-- Grooming rules, INSERT behaviour, messages, trigger definitions and ACLs are unchanged.
-- Provenance: replaces only the exact 20261025040000 body (md5) or this migration's own.
do $guard$declare h text:=md5(pg_get_functiondef('public.enforce_branch_grooming_performers()'::regprocedure));begin
 if h not in('019ceed5f3e0951a00cd97c7e22e984a','f9630a9197f26870696f688e6eee6d7b') then
  raise exception 'enforce_branch_grooming_performers differs from main (md5 %); stop and review',h;
 end if;
end$guard$;
create or replace function public.enforce_branch_grooming_performers() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_branch uuid; v_kind text; v_category text; v_type text; v_override boolean;
  v_staff uuid; v_doctor uuid; v_roles text[];
begin
  -- PL/pgSQL resolves every NEW/OLD field in an IF expression even when an earlier
  -- AND term is false, so each table's columns are only referenced inside its own branch.
  if tg_op = 'UPDATE' then
    if tg_table_name = 'sale_items' then
      if new.sale_id is not distinct from old.sale_id
        and new.item_id is not distinct from old.item_id then return new; end if;
    elsif tg_table_name = 'prescription_items' then
      if old.kategori = 'Grooming' and new.kategori is distinct from old.kategori then
        raise exception using errcode = 'P0001', message = 'CARE_INVALID: kategori Grooming tersimpan tidak dapat diganti langsung';
      end if;
      if new.medical_record_id is not distinct from old.medical_record_id
        and new.item_id is not distinct from old.item_id and new.jenis is not distinct from old.jenis
        and new.kategori is not distinct from old.kategori then return new; end if;
    else
      if new.invoice_id is not distinct from old.invoice_id
        and new.item_id is not distinct from old.item_id and new.jenis is not distinct from old.jenis
        and new.prescription_item_id is not distinct from old.prescription_item_id
        and new.service_source_line_id is not distinct from old.service_source_line_id then return new; end if;
    end if;
  end if;
  if tg_table_name = 'sale_items' then
    select s.branch_id, i.item_type, i.tindakan_kategori into v_branch, v_kind, v_category
      from public.sales s join public.items i on i.id = new.item_id where s.id = new.sale_id;
  elsif tg_table_name = 'prescription_items' then
    select v.branch_id, i.item_type,
      case when i.tindakan_kategori = 'Grooming' or new.kategori = 'Grooming' then 'Grooming'
        else coalesce(i.tindakan_kategori, new.kategori) end
      into v_branch, v_kind, v_category
      from public.medical_records m join public.visits v on v.id = m.visit_id
      left join public.items i on i.id = new.item_id where m.id = new.medical_record_id;
    if new.item_id is null then v_kind := case when new.jenis = 'jasa' then 'Jasa' end; end if;
  else
    select v.branch_id, i.item_type,
      case when i.tindakan_kategori = 'Grooming' or pi.kategori = 'Grooming' then 'Grooming'
        else coalesce(i.tindakan_kategori, pi.kategori) end
      into v_branch, v_kind, v_category
      from public.invoices inv join public.visits v on v.id = inv.visit_id
      left join public.items i on i.id = new.item_id
      left join public.prescription_items pi on pi.id = new.prescription_item_id
      where inv.id = new.invoice_id;
    if new.item_id is null then v_kind := case when new.jenis = 'jasa' then 'Jasa' end; end if;
    if tg_op = 'INSERT' and (new.service_source_line_id is not null or new.prescription_item_id is not null) then return new; end if;
  end if;
  if v_kind is distinct from 'Jasa' or v_category is distinct from 'Grooming' then return new; end if;

  select b.type::text, r.doctor_required into v_type, v_override
    from public.branches b left join public.branch_grooming_rules r on r.branch_id = b.id
    where b.id = v_branch for share of b;
  if v_type is null then raise exception using errcode = 'P0001', message = 'CARE_INVALID: cabang grooming tidak tersedia'; end if;
  if v_type not in ('PETSHOP','KLINIK','BOTH') then return new; end if;
  v_staff := nullif(new.service_performers->>'staff_id', '')::uuid;
  v_doctor := nullif(new.service_performers->>'doctor_id', '')::uuid;
  if v_staff is null then raise exception using errcode = 'P0001', message = 'CARE_INVALID: groomer wajib dipilih untuk layanan Grooming'; end if;
  select public.clinic_employee_roles(e.jabatan) into v_roles from public.employees e where e.id = v_staff;
  if not coalesce('groomer' = any(v_roles), false) then
    raise exception using errcode = 'P0001', message = 'CARE_INVALID: pelaksana layanan Grooming harus groomer';
  end if;
  if coalesce(v_override, v_type in ('KLINIK','BOTH')) and v_doctor is null then
    raise exception using errcode = 'P0001', message = 'CARE_INVALID: dokter wajib dipilih untuk Grooming di cabang ini';
  end if;
  return new;
end $$;
revoke all on function public.enforce_branch_grooming_performers() from public, anon, authenticated, service_role;
do $check$declare h text:=md5(pg_get_functiondef('public.enforce_branch_grooming_performers()'::regprocedure));begin
 if h<>'f9630a9197f26870696f688e6eee6d7b' then raise exception 'enforce_branch_grooming_performers result unexpected (md5 %)',h;end if;
end$check$;
commit;
