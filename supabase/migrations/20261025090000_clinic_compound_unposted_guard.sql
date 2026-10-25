-- A late compound must never consume stock after an invoice exists, even if the
-- invoice was later voided. Keep the visit lock used by clinic invoice posting.
create function clinic_private.assert_compound_visit_unposted(p_visit_id uuid, p_record_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_visit public.visits%rowtype;
begin
  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found or not exists(select 1 from public.medical_records
    where id = p_record_id and visit_id = p_visit_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pemeriksaan tidak sesuai kunjungan';
  end if;
  if v_visit.status not in ('Menunggu', 'Diperiksa', 'Pembayaran')
     or v_visit.checked_out_at is not null
     or exists(select 1 from public.invoices where visit_id = p_visit_id) then
    raise exception using errcode = 'P0001', message = 'RECIPE_POSTED: kunjungan sudah ditagih atau selesai';
  end if;
end $$;
revoke all on function clinic_private.assert_compound_visit_unposted(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Patch the live definitions, including earlier cost/role fixes. Abort on drift
-- rather than replacing those bodies with an older version.
create function pg_temp.patch_compound_unposted(p_function regprocedure, p_old text, p_new text)
returns void language plpgsql as $$
declare v_definition text := pg_get_functiondef(p_function);
begin
  if (length(v_definition) - length(replace(v_definition, p_old, ''))) / length(p_old) <> 1 then
    raise exception 'Compound guard patch drift: %', p_function;
  end if;
  execute replace(v_definition, p_old, p_new);
end $$;

-- The master wrapper already locks the visit. Preserve exact retries after
-- invoice posting; check only before a new stock/billing write.
select pg_temp.patch_compound_unposted(
  'public.clinic_issue_master_compound(uuid,uuid,uuid,jsonb,text,uuid,text)'::regprocedure,
  $old$  if exists(select 1 from public.compounding_recipes where request_key=v_key) then
    raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT: kunci sudah dipakai racikan sebelumnya';
  end if;$old$,
  $new$  if exists(select 1 from public.compounding_recipes where request_key=v_key) then
    raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT: kunci sudah dipakai racikan sebelumnya';
  end if;
  perform clinic_private.assert_compound_visit_unposted(p_visit_id,p_medical_record_id);$new$
);

-- The direct/custom and official paths converge on this private stock writer.
-- Lock the visit before the recipe key, matching invoice posting's lock order.
select pg_temp.patch_compound_unposted(
  'clinic_private.clinic_issue_compound(uuid,uuid,jsonb,text)'::regprocedure,
  $old$  select r.* into v_existing
  from public.compounding_recipes r
  where r.request_key = v_request_key
  for update;$old$,
  $new$  perform 1 from public.visits where id=p_visit_id for update;
  select r.* into v_existing
  from public.compounding_recipes r
  where r.request_key = v_request_key
  for update;$new$
);

-- Exact retries above still acknowledge the original issue; all new issues
-- must pass the locked status and invoice check before any insert/stock change.
select pg_temp.patch_compound_unposted(
  'clinic_private.clinic_issue_compound(uuid,uuid,jsonb,text)'::regprocedure,
  $old$  insert into public.compounding_recipes (
    medical_record_id, recipe_name, dosage_instruction, dosage_form,$old$,
  $new$  perform clinic_private.assert_compound_visit_unposted(p_visit_id,p_medical_record_id);
  insert into public.compounding_recipes (
    medical_record_id, recipe_name, dosage_instruction, dosage_form,$new$
);

drop function pg_temp.patch_compound_unposted(regprocedure, text, text);
