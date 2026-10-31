-- NEW compounds during the SAME active inpatient stay may follow prior invoices.
-- This never edits an issued recipe/invoice, restores stock, resets DP or bills old
-- lines. Historical/void outpatient invoices keep their original closed guard.
create or replace function clinic_private.assert_compound_visit_unposted(p_visit_id uuid, p_record_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_visit public.visits%rowtype;
  v_stay public.inpatient_records%rowtype;
  v_active boolean := false;
begin
  -- Every entrypoint below already holds the billing coordinator BEFORE row locks.
  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found or not exists(select 1 from public.medical_records
    where id = p_record_id and visit_id = p_visit_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pemeriksaan tidak sesuai kunjungan';
  end if;
  -- Lock/re-read current care, not a caller flag or the mere existence of history.
  select * into v_stay from public.inpatient_records where visit_id=p_visit_id
    order by admitted_at desc, id desc limit 1 for update;
  v_active := found and v_stay.discharged_at is null
    and v_stay.condition_status in ('stabil','kritis')
    and v_stay.branch_id = v_visit.branch_id
    and v_stay.medical_record_id = p_record_id
    and v_stay.stay_type in ('sakit','pet_hotel')
    and v_visit.pet_id is not null
    and exists(select 1 from public.pets p where p.id=v_visit.pet_id
      and p.customer_id=v_visit.customer_id)
    and exists(select 1 from public.branches b where b.id=v_visit.branch_id
      and b.is_active and b.type in ('KLINIK','BOTH'))
    and lower(btrim(coalesce(v_visit.poli,''))) not in ('grooming','penitipan');
  -- Historical financial Selesai alone is not a discharge when current care
  -- is still valid. The current receive-payment wrapper already avoids closing
  -- an active stay; compatibility must not require rewriting historical status.
  -- Checkout is different and always denies; no status/admission rewrite here.
  if v_visit.checked_out_at is not null
     or v_visit.status not in ('Menunggu','Diperiksa','Pembayaran','Selesai')
     or (not coalesce(v_active,false) and (
       v_visit.status not in ('Menunggu','Diperiksa','Pembayaran')
       or exists(select 1 from public.invoices where visit_id=p_visit_id)))
     or (exists(select 1 from public.inpatient_records where visit_id=p_visit_id)
         and not coalesce(v_active,false)) then
    raise exception using errcode = 'P0001', message = 'RECIPE_POSTED: kunjungan sudah ditagih atau selesai';
  end if;
end $$;
revoke all on function clinic_private.assert_compound_visit_unposted(uuid,uuid)
  from public,anon,authenticated,service_role;

-- Patch current definitions, not stale copies. Compile each once, retaining
-- function owner/ACL/security/search_path and all business/idempotency bodies.
-- Both invoker clinical saves and definer compound writers need the SAME key.
-- Inline the coordinator's exact single-visit expression in invoker functions:
-- this avoids granting private billing helpers or elevating a clinical writer.
-- No coordinator may first be acquired inside the private writer AFTER an outer
-- visit/stay/recipe/catalogue lock. Include ALL original clinical callers.
do $patch$
declare
  r record;
  v_oid regprocedure;
  v_def text;
  v_owner oid;
  v_acl aclitem[];
  v_security boolean;
  v_config text[];
  v_lock text;
  v_access text;
begin
  for r in select * from (values
    ('public.clinic_issue_master_compound(uuid,uuid,uuid,jsonb,text,uuid,text)', 'p_visit_id', 'true',
     'p_formula_version_id is null'),
    ('public.clinic_issue_official_compound(uuid,uuid,uuid,text,text)', 'p_visit_id', 'true', 'false'),
    ('public.clinic_issue_compound(uuid,uuid,jsonb,text)', 'p_visit_id', 'true', 'false'),
    ('clinic_private.clinic_issue_compound(uuid,uuid,jsonb,text)', 'p_visit_id', 'true', 'false'),
    ('public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text)',
     'p_visit_id', 'jsonb_array_length(p_compounds)>0', 'false'),
    ('public.clinic_save_inpatient_log(uuid,uuid,jsonb,jsonb,jsonb,text)',
     '(select visit_id from public.inpatient_records where id=p_inpatient_id)',
     'jsonb_array_length(p_compounds)>0', 'false'),
    ('public.clinic_save_inpatient_log_with_status(uuid,uuid,jsonb,jsonb,jsonb,text,text)',
     '(select visit_id from public.inpatient_records where id=p_inpatient_id)',
     'jsonb_array_length(p_compounds)>0', 'false'),
    -- Discharge must not take stay -> visit while a direct issue takes visit ->
    -- stay. Serialize the actual care transition before either row lock too.
    ('public.clinic_change_inpatient_condition(uuid,text,text)',
     '(select visit_id from public.inpatient_records where id=p_inpatient_id)', 'false', 'false')
  ) x(sig, visit_expr, check_access, custom_check) loop
    v_oid := r.sig::regprocedure;
    select pg_get_functiondef(p.oid),proowner,proacl,prosecdef,proconfig
      into v_def,v_owner,v_acl,v_security,v_config from pg_proc p where p.oid=v_oid;
    if (length(v_def)-length(replace(v_def,E'\nbegin\n','')))/length(E'\nbegin\n') <> 1
       or position('ranap-compound-coordinator' in v_def)>0 then
      raise exception 'Ranap compound patch drift: %', r.sig;
    end if;
    v_lock := format($body$
  -- ranap-compound-coordinator: same key as clinic_private.billing_keys_visit.
  perform pg_advisory_xact_lock(hashtextextended('clinic-billing:' ||
    case when v.customer_id is not null then 'c:' || v.customer_id::text
         else 'v:' || coalesce(v.id::text,'-') end || '@' || coalesce(v.branch_id::text,'-'),0))
    from public.visits v where v.id=%s;
$body$, r.visit_expr);
    -- Read CURRENT auth/role/branch AFTER waiting, before original locks/replay.
    -- STAFF official-only and legacy no-SKU OWNER/ADMIN restriction remain.
    v_access := format($body$
  if (%s) and (coalesce(auth.role(),'')<>'authenticated' or auth.uid() is null
    or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active
      and p.role in ('OWNER','ADMIN','DOCTOR','STAFF'))
    or not exists(select 1 from public.visits v where v.id=%s
      and public.user_can_access_branch(v.branch_id))) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: akses racikan atau cabang tidak diizinkan';
  end if;
  if (%s) and not exists(select 1 from public.profiles p where p.id=auth.uid()
      and p.is_active and p.role in ('OWNER','ADMIN','DOCTOR')) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: komposisi racikan hanya untuk pemilik/admin/dokter';
  end if;
$body$, r.check_access, r.visit_expr, r.custom_check);
    execute replace(v_def,E'\nbegin\n',E'\nbegin\n' || v_lock || v_access);
    if not exists(select 1 from pg_proc p where p.oid=v_oid and p.proowner=v_owner
      and p.proacl is not distinct from v_acl and p.prosecdef=v_security
      and p.proconfig is not distinct from v_config) then
      raise exception 'Ranap compound changed owner/ACL/security: %',r.sig;
    end if;
  end loop;
end $patch$;
