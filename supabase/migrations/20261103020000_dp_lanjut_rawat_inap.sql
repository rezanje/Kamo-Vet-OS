-- LOCAL candidate: explicitly selected ordinary DP posts first, then admission,
-- in ONE transaction. No rewrite/backfill of existing invoices or business cores.
create function public.clinic_post_dp_and_admit(
  p_visit_id uuid, p_request_key text, p_invoice jsonb, p_lines jsonb,
  p_treatment_plan text, p_stay_type text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_visit public.visits%rowtype;
  v_invoice uuid;
  v_stay uuid;
  v_key text := nullif(btrim(p_request_key), '');
begin
  -- Same coordinator as #343, BEFORE request/visit/pet/shift/admission locks
  -- and before CURRENT role/branch/history authorization (including exact replays).
  perform clinic_private.billing_lock(clinic_private.billing_keys_visit(p_visit_id));
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null or not exists(
    select 1 from public.profiles where id = auth.uid() and is_active
  ) or not public.inpatient_clinic_module_access() then
    raise exception 'ACCESS_DENIED: pengguna tidak aktif atau tidak memiliki akses modul klinik';
  end if;
  select * into v_visit from public.visits where id = p_visit_id;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception 'ACCESS_DENIED: kunjungan atau cabang tidak dapat diakses';
  end if;
  if v_key is null or length(v_key) > 100
     or nullif(btrim(p_treatment_plan), '') is null or length(btrim(p_treatment_plan)) > 4000
     or p_stay_type is null or p_stay_type not in ('sakit','pet_hotel') then
    raise exception 'ADMISSION_INVALID: isi rencana tindakan dan pilih tipe rawat inap';
  end if;
  -- This is deliberately NOT a paid/closed outpatient continuation, split/DEMO
  -- checkout, or an INPATIENT_OPEN bypass. Those retain their existing paths.
  if p_invoice ->> 'paid_status' is distinct from 'DP' then
    raise exception 'ADMISSION_INVALID: simpan sebagai DP untuk melanjutkan rawat inap';
  end if;
  -- Initial collection keeps the original cashier contract (incl. STAFF/DOCTOR
  -- with branch access and their own shift). This is NOT financial correction.
  v_invoice := public.clinic_post_invoice(p_visit_id, v_key, p_invoice, p_lines);
  v_stay := public.clinic_admit_inpatient_typed(
    p_visit_id, btrim(p_treatment_plan), 'dp-admit:' || md5(v_key), p_stay_type);
  -- No checkout, no Lunas and no visit recreation. Both public RPCs retain all
  -- original consent/doctor/stock/period/minimum-DP/journal/idempotency guards.
  return jsonb_build_object('invoice_id',v_invoice,'inpatient_id',v_stay);
end $$;
revoke all on function public.clinic_post_dp_and_admit(uuid,text,jsonb,jsonb,text,text)
  from public, anon, service_role;
grant execute on function public.clinic_post_dp_and_admit(uuid,text,jsonb,jsonb,text,text) to authenticated;
