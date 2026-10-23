-- S01-S04. No historical backfill; NULL means no recorded per-line attribution.
alter table public.sale_items add column service_performers jsonb;
alter table public.prescription_items add column service_performers jsonb;
alter table public.invoice_items add column service_performers jsonb, add column service_source_line_id uuid;
alter table public.sales add column cashier_name text;
alter table public.invoices add column cashier_profile_id uuid references public.profiles(id) on delete restrict,
  add column cashier_name text,
  add column service_pricing_version smallint check (service_pricing_version in (1));

create function public.normalize_service_performers(p_value jsonb,p_branch_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_doctor uuid;v_staff uuid;v_id uuid;v_employee public.employees%rowtype;v_doctor_name text;v_staff_name text;
begin
 if jsonb_typeof(coalesce(p_value,'{}')) is distinct from 'object' then
  raise exception using errcode='P0001',message='CARE_INVALID: pelaksana jasa harus berisi satu dokter dan satu non-dokter';
 end if;
 if jsonb_typeof(p_value->'doctor_id') not in ('null','string') or jsonb_typeof(p_value->'staff_id') not in ('null','string') then
  raise exception using errcode='P0001',message='CARE_INVALID: pilih pelaksana dari daftar karyawan';
 end if;
 begin
  v_doctor:=nullif(p_value->>'doctor_id','')::uuid;v_staff:=nullif(p_value->>'staff_id','')::uuid;
 exception when invalid_text_representation then
  raise exception using errcode='P0001',message='CARE_INVALID: identitas pelaksana tidak valid';
 end;
 if v_doctor is not null and v_doctor=v_staff then
  raise exception using errcode='P0001',message='CARE_INVALID: dokter dan non-dokter harus berbeda';
 end if;
 -- Stable employee lock order, including effective secondary branch assignments.
 for v_id in select x from unnest(array[v_doctor,v_staff]) x where x is not null order by x loop
  select * into v_employee from public.employees where id=v_id for share;
  if not found or v_employee.status is distinct from 'Aktif' then
   raise exception using errcode='P0001',message='CARE_INVALID: pelaksana harus karyawan aktif';
  end if;
  if v_employee.branch_id is distinct from p_branch_id then
   perform 1 from public.employee_branch_assignments where employee_id=v_id and branch_id=p_branch_id
    and effective_date <= (now() at time zone 'Asia/Jakarta')::date for share;
   if not found then raise exception using errcode='P0001',message='CARE_INVALID: pelaksana tidak ditugaskan di cabang transaksi';end if;
  end if;
  if coalesce(v_id=v_doctor,false) is distinct from ('doctor'=any(public.clinic_employee_roles(v_employee.jabatan))) then
   raise exception using errcode='P0001',message='CARE_INVALID: pilih satu dokter dan satu non-dokter sesuai jabatan';
  end if;
  if v_id=v_doctor then v_doctor_name:=v_employee.nama;else v_staff_name:=v_employee.nama;end if;
 end loop;
 return jsonb_build_object('version',1,'doctor_id',v_doctor,'staff_id',v_staff,'doctor_name',v_doctor_name,'staff_name',v_staff_name);
end $$;
revoke all on function public.normalize_service_performers(jsonb,uuid) from public,anon,authenticated,service_role;

create function public.guard_service_line_performers() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_branch uuid;v_service boolean;v_type text;v_source jsonb;v_reissued uuid;v_parent uuid;v_old_parent uuid;
begin
 if tg_table_name='sale_items' then
  v_parent:=new.sale_id;
  select branch_id into v_branch from public.sales where id=v_parent for share;
  select item_type into v_type from public.items where id=new.item_id for share;
  v_service:=v_type='Jasa';
 elsif tg_table_name='prescription_items' then
  v_parent:=new.medical_record_id;
  select v.branch_id into v_branch from public.medical_records m join public.visits v on v.id=m.visit_id where m.id=v_parent for share of m,v;
  select item_type into v_type from public.items where id=new.item_id for share;
  v_service:=new.jenis='jasa' and (new.item_id is null or v_type='Jasa');
 else
  v_parent:=new.invoice_id;
  select v.branch_id,i.reissued_from into v_branch,v_reissued from public.invoices i join public.visits v on v.id=i.visit_id where i.id=v_parent for share of i,v;
  select item_type into v_type from public.items where id=new.item_id for share;
  v_service:=new.jenis='jasa' and (new.item_id is null or v_type='Jasa');
 end if;
 if auth.role()='authenticated' then
  perform 1 from public.profiles where id=auth.uid() and is_active=true for share;
  if not found or v_branch is null or not public.user_can_access_branch(v_branch) then
   raise exception using errcode='P0001',message='ACCESS_DENIED: cabang pelaksana tidak dapat diakses';
  end if;
 end if;
 if tg_op='UPDATE' then
  v_old_parent:=case when tg_table_name='sale_items' then to_jsonb(old)->>'sale_id' when tg_table_name='prescription_items' then to_jsonb(old)->>'medical_record_id' else to_jsonb(old)->>'invoice_id' end;
  if new.service_performers is distinct from old.service_performers or to_jsonb(new)->>'service_source_line_id' is distinct from to_jsonb(old)->>'service_source_line_id' or (old.service_performers is not null and (v_parent is distinct from v_old_parent or new.item_id is distinct from old.item_id)) then
   raise exception using errcode='P0001',message='CARE_INVALID: atribusi tersimpan tidak dapat ditulis ulang; gunakan koreksi dokumen yang berlaku';
  end if;
  return new;
 end if;
 if coalesce(v_service,false)=false then
  if nullif(new.service_performers->>'doctor_id','') is not null or nullif(new.service_performers->>'staff_id','') is not null then
   raise exception using errcode='P0001',message='CARE_INVALID: pelaksana per baris hanya untuk item Jasa';
  end if;
  new.service_performers:=null;return new;
 end if;
 if tg_table_name='invoice_items' then
  -- Exact source row, held in the same transaction before edit deletes old lines.
  -- Reissues retain original rows; edits insert replacements before deleting originals.
  if new.service_source_line_id is not null then
   select service_performers into v_source from public.invoice_items where id=new.service_source_line_id
    and invoice_id in(new.invoice_id,v_reissued) and item_id is not distinct from new.item_id
    and jenis='jasa' for share;
   if not found then raise exception using errcode='P0001',message='CARE_INVALID: sumber atribusi jasa tidak sesuai dokumen';end if;
   if nullif(new.service_performers->>'doctor_id','') is not distinct from nullif(v_source->>'doctor_id','')
    and nullif(new.service_performers->>'staff_id','') is not distinct from nullif(v_source->>'staff_id','') then
    new.service_performers:=v_source;return new;
   end if;
  end if;
  if new.prescription_item_id is not null then
   select pi.service_performers into v_source from public.prescription_items pi join public.medical_records mr on mr.id=pi.medical_record_id
    join public.invoices i on i.visit_id=mr.visit_id where i.id=new.invoice_id and pi.id=new.prescription_item_id for share of pi;
   if v_source is not null and (new.service_performers is null or (
    nullif(new.service_performers->>'doctor_id','') is not distinct from nullif(v_source->>'doctor_id','') and
    nullif(new.service_performers->>'staff_id','') is not distinct from nullif(v_source->>'staff_id',''))) then
    new.service_performers:=v_source;return new;
   end if;
  end if;
 end if;
 new.service_performers:=public.normalize_service_performers(new.service_performers,v_branch);
 return new;
end $$;
revoke all on function public.guard_service_line_performers() from public,anon,authenticated,service_role;
create trigger service_line_performers before insert or update on public.sale_items for each row execute function public.guard_service_line_performers();
create trigger service_line_performers before insert or update on public.prescription_items for each row execute function public.guard_service_line_performers();
create trigger service_line_performers before insert or update on public.invoice_items for each row execute function public.guard_service_line_performers();

create function public.snapshot_service_cashier() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_name text;
begin
 if tg_op='UPDATE' then
  if new.cashier_name is distinct from old.cashier_name or (tg_table_name='invoices' and (to_jsonb(new)->>'cashier_profile_id' is distinct from to_jsonb(old)->>'cashier_profile_id' or to_jsonb(new)->>'service_pricing_version' is distinct from to_jsonb(old)->>'service_pricing_version')) then
   raise exception using errcode='P0001',message='CARE_INVALID: snapshot transaksi tersimpan tidak dapat diganti';
  end if;
  return new;
 end if;
 v_actor:=case when tg_table_name='sales' then nullif(to_jsonb(new)->>'cashier_id','')::uuid else auth.uid() end;
 if auth.role()='authenticated' and (v_actor is distinct from auth.uid() or auth.uid() is null) then
  raise exception using errcode='P0001',message='ACCESS_DENIED: kasir harus akun yang login';
 end if;
 select coalesce((select nama from public.employees where profile_id=v_actor and status='Aktif'),p.full_name) into v_name from public.profiles p where p.id=v_actor;
 new.cashier_name:=v_name;
 if tg_table_name='invoices' then new.cashier_profile_id:=v_actor;end if;
 return new;
end $$;
revoke all on function public.snapshot_service_cashier() from public,anon,authenticated,service_role;
create trigger service_cashier_snapshot before insert or update on public.sales for each row execute function public.snapshot_service_cashier();
create trigger service_cashier_snapshot before insert or update on public.invoices for each row execute function public.snapshot_service_cashier();

-- Extend existing atomic inserts only; retain signatures/ACL/hash/stock/journal code.
-- An unexpected schema definition fails the migration rather than silently skipping.
do $patch$
declare p record;definition text;anchor text;replacement text;signature regprocedure;
begin
 for p in select * from (values
 ('public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text)', E'harga, aturan_pakai, jenis, kategori\n    )', E'harga, aturan_pakai, jenis, kategori, service_performers\n    )'),
 ('public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text)', E'v_row->>''aturan_pakai'', v_row->>''jenis'', v_row->>''kategori''\n    );', E'v_row->>''aturan_pakai'', v_row->>''jenis'', v_row->>''kategori'', v_row->''service_performers''\n    );'),
 ('public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text)', E'harga, aturan_pakai, jenis, kategori\n    )', E'harga, aturan_pakai, jenis, kategori, service_performers\n    )'),
 ('public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text)', E'v_row->>''aturan_pakai'', v_row->>''jenis'', v_row->>''kategori''\n    );', E'v_row->>''aturan_pakai'', v_row->>''jenis'', v_row->>''kategori'', v_row->''service_performers''\n    );'),
 ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)', E'paid_status, metode_bayar, paid_at, shift_id, voucher_code, salesperson_id\n  ) values', E'paid_status, metode_bayar, paid_at, shift_id, voucher_code, salesperson_id, service_pricing_version\n  ) values'),
 ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)', E'v_shift.id, v_voucher, v_salesperson_id\n  ) returning', E'v_shift.id, v_voucher, v_salesperson_id, nullif(p_invoice->>''service_pricing_version'','''')::smallint\n  ) returning'),
 ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)', E'compound_recipe_id, prescription_item_id, satuan, faktor\n    ) values', E'compound_recipe_id, prescription_item_id, satuan, faktor, service_performers\n    ) values'),
 ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)', E'v_item_id, v_line_hpp, v_recipe_id, v_prescription_item_id, v_unit, v_factor\n    ) returning', E'v_item_id, v_line_hpp, v_recipe_id, v_prescription_item_id, v_unit, v_factor, v_line.value->''service_performers''\n    ) returning'),
 ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)', E'where nullif(x.value->>''item_id'','''') is not null\n    group by x.value->>''item_id'' having count(*)>1)', E'where nullif(x.value->>''item_id'','''') is not null\n    and not (x.value->>''kind''=''jasa'' and exists(select 1 from public.items si where si.id=(x.value->>''item_id'')::uuid and si.item_type=''Jasa''))\n    group by x.value->>''item_id'' having count(*)>1)'),
 ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)', '  v_line jsonb;', '  v_line jsonb; v_service_old_ids uuid[];'),
 ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)', '  delete from public.invoice_items where invoice_id=p_invoice_id;', '  select coalesce(array_agg(id),array[]::uuid[]) into v_service_old_ids from public.invoice_items where invoice_id=p_invoice_id;'),
 ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)', E'  end loop;\n  select coalesce(sum(hpp),0) into v_total_hpp', E'  end loop;\n  delete from public.invoice_items where invoice_id=p_invoice_id and id=any(v_service_old_ids);\n  select coalesce(sum(hpp),0) into v_total_hpp'),
 ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)', E'item_id,hpp,prescription_item_id,satuan,faktor)\n    values', E'item_id,hpp,prescription_item_id,satuan,faktor,service_performers,service_source_line_id)\n    values'),
 ('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)', E'nullif(v_line->>''prescription_item_id'','''')::uuid,v_unit,v_factor);', E'nullif(v_line->>''prescription_item_id'','''')::uuid,v_unit,v_factor,v_line->''service_performers'',nullif(v_line->>''source_invoice_item_id'','''')::uuid);'),
 ('public.clinic_void_reissue_invoice_core(uuid,text,text)', 'reissued_from,request_key,request_hash,correction_pending,shift_cash_carry)', 'reissued_from,request_key,request_hash,correction_pending,shift_cash_carry,service_pricing_version)'),
 ('public.clinic_void_reissue_invoice_core(uuid,text,text)', 'v_invoice.voucher_code,v_invoice.salesperson_id,p_invoice_id,v_key,v_hash,true,v_shift_cash)', 'v_invoice.voucher_code,v_invoice.salesperson_id,p_invoice_id,v_key,v_hash,true,v_shift_cash,v_invoice.service_pricing_version)'),
 ('public.clinic_void_reissue_invoice_core(uuid,text,text)', E'item_id,hpp,prescription_item_id,satuan,faktor)\n  select v_new_id', E'item_id,hpp,prescription_item_id,satuan,faktor,service_performers,service_source_line_id)\n  select v_new_id'),
 ('public.clinic_void_reissue_invoice_core(uuid,text,text)', E'prescription_item_id,satuan,faktor from public.invoice_items where invoice_id=p_invoice_id;', E'prescription_item_id,satuan,faktor,service_performers,id from public.invoice_items where invoice_id=p_invoice_id;')
 ) as patches(sig,old_text,new_text) loop
  signature:=to_regprocedure(p.sig);
  if signature is null then raise exception 'S01 missing required RPC: %',p.sig;end if;
  definition:=pg_get_functiondef(signature);anchor:=p.old_text;replacement:=p.new_text;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
   raise exception 'S01 expected exactly one insert anchor in %; inspect parity before applying',p.sig;
  end if;
  execute replace(definition,anchor,replacement);
 end loop;
end $patch$;
