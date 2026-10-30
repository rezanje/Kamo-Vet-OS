-- Standalone OBAT KHUSUS additions, NOT medication protocol/dose administration.
-- Same pending prescription pipeline. Ordinary inventory/money remain at billing;
-- compounds still use the original public issue-once RPCs. No clinical log created.
create table public.clinic_inpatient_billable_entries (
 id uuid primary key default gen_random_uuid(),
 inpatient_record_id uuid not null references public.inpatient_records(id),
 medical_record_id uuid not null references public.medical_records(id),
 visit_id uuid not null references public.visits(id),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 reason text not null, source text not null default 'OBAT_KHUSUS' check(source='OBAT_KHUSUS'),
 request_key text not null, request_hash text not null,
 prescription_ids uuid[] not null, rows jsonb not null, compounds jsonb not null,
 unique(created_by,request_key)
);
alter table public.clinic_inpatient_billable_entries enable row level security;
revoke all on public.clinic_inpatient_billable_entries from public,anon,authenticated,service_role;
grant select on public.clinic_inpatient_billable_entries to authenticated;
create policy inpatient_billable_entries_read on public.clinic_inpatient_billable_entries
 for select to authenticated using(public.clinic_record_correction_actor(visit_id));
create trigger inpatient_billable_entries_immutable before update or delete
 on public.clinic_inpatient_billable_entries for each row execute function public.clinic_record_correction_immutable();
create trigger inpatient_billable_entries_no_truncate before truncate
 on public.clinic_inpatient_billable_entries for each statement execute function public.clinic_record_correction_immutable();

create function public.clinic_add_inpatient_billables(
 p_inpatient_id uuid,p_rows jsonb,p_compounds jsonb,p_reason text,p_request_key text
) returns uuid language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare
 v_stay public.inpatient_records%rowtype;
 v_visit public.visits%rowtype;
 v_existing public.clinic_inpatient_billable_entries%rowtype;
 v_mr uuid; v_row jsonb; v_item public.items%rowtype; v_factor numeric;
 v_user uuid := auth.uid(); v_hash text; v_key text := nullif(btrim(p_request_key),'');
 v_ids uuid[] := '{}'; v_before uuid[]; v_id uuid;
begin
 -- Shared coordinator is FIRST: no outer visit/stay/MR/recipe/stock row locks.
 perform clinic_private.billing_lock(clinic_private.billing_keys_visit(
   (select visit_id from public.inpatient_records where id=p_inpatient_id)));
 select * into v_stay from public.inpatient_records where id=p_inpatient_id;
 if not found or auth.role() is distinct from 'authenticated' or v_user is null
   or not public.clinic_record_correction_actor(v_stay.visit_id)
   or not exists(select 1 from public.profiles where id=v_user and is_active and role in('OWNER','ADMIN','DOCTOR','STAFF')) then
   raise exception 'ACCESS_DENIED: akses perawatan atau cabang tidak diizinkan' using errcode='42501';
 end if;
 select * into v_visit from public.visits where id=v_stay.visit_id for update;
 select * into v_stay from public.inpatient_records where id=p_inpatient_id for update;
 -- Recheck after ALL outer waits, including cached replay. Do not use the full
 -- record-correction OWNER/DOCTOR-only gate for legitimate STAFF care additions.
 if not public.clinic_record_correction_actor(v_stay.visit_id)
   or not exists(select 1 from public.profiles where id=v_user and is_active and role in('OWNER','ADMIN','DOCTOR','STAFF')) then
   raise exception 'ACCESS_DENIED: akses perawatan telah berubah' using errcode='42501';
 end if;
 if v_stay.discharged_at is not null or v_stay.condition_status not in('stabil','kritis')
   or v_visit.checked_out_at is not null or v_visit.status not in('Menunggu','Diperiksa','Pembayaran','Selesai')
   or v_stay.branch_id is distinct from v_visit.branch_id
   or v_stay.stay_type not in('sakit','pet_hotel')
   or lower(btrim(coalesce(v_visit.poli,''))) in('grooming','penitipan')
   or not exists(select 1 from public.branches where id=v_visit.branch_id and is_active and type in('KLINIK','BOTH'))
   or not exists(select 1 from public.pets where id=v_visit.pet_id and customer_id=v_visit.customer_id)
   or exists(select 1 from public.inpatient_records where visit_id=v_visit.id and admitted_at>v_stay.admitted_at) then
   raise exception 'STAY_CLOSED: rawat inap tidak aktif' using errcode='P0001';
 end if;
 -- Server chooses the existing record, never a browser-provided medical ID.
 v_mr := v_stay.medical_record_id;
 if v_mr is null then
   select id into v_mr from public.medical_records where visit_id=v_visit.id order by created_at desc,id desc limit 1;
 end if;
 perform 1 from public.medical_records where id=v_mr and visit_id=v_visit.id for update;
 if not found then raise exception 'RECORD_INVALID: rekam medis belum tersedia untuk tagihan' using errcode='P0001';end if;
 if v_key is null or length(v_key)>100 or length(btrim(coalesce(p_reason,''))) not between 3 and 1000
   or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_typeof(p_compounds) is distinct from 'array'
   or jsonb_array_length(p_rows)>200 or jsonb_array_length(p_compounds)>50
   or jsonb_array_length(p_rows)+jsonb_array_length(p_compounds)=0 then
   raise exception 'ENTRY_INVALID: isi obat / BMHP dan alasan penambahan' using errcode='P0001';
 end if;
 v_hash := md5(jsonb_build_object('stay',p_inpatient_id,'record',v_mr,'rows',p_rows,'compounds',p_compounds,'reason',p_reason)::text);
 -- Usable checkpoint: issue one recipe per submission. The original per-recipe
 -- locks persist to COMMIT; opposite multi-recipe batches across patients need
 -- a separately verified global ingredient lock order, not an invented stock core.
 if jsonb_array_length(p_compounds)>1 then
   raise exception 'COMPOUND_BATCH_UNSUPPORTED: simpan satu racikan per penambahan; obat dan BMHP boleh beberapa baris' using errcode='P0001';
 end if;
 -- Same actor request keys may span visits, so serialize BEFORE checking/issuing.
 perform pg_advisory_xact_lock(hashtextextended('inpatient-entry:'||v_user::text||':'||v_key,0));
 -- Branch activity/type can change while the MR/request lock is waiting.
 -- SHARE (not KEY SHARE) pins these non-key fields until commit, and the
 -- actor gate below also revalidates after a wait on this branch lock.
 perform 1 from public.branches where id=v_visit.branch_id and is_active
   and type in('KLINIK','BOTH') for share;
 if not found then
   raise exception 'ACCESS_DENIED: cabang klinik tidak aktif' using errcode='42501';
 end if;
 -- The MR/request locks above can also wait after the initial coordinator check.
 -- Re-read authorization immediately before cached replay and all new writes.
 if not public.clinic_record_correction_actor(v_stay.visit_id)
   or not exists(select 1 from public.profiles where id=v_user and is_active and role in('OWNER','ADMIN','DOCTOR','STAFF')) then
   raise exception 'ACCESS_DENIED: akses perawatan telah berubah' using errcode='42501';
 end if;
 if exists(select 1 from jsonb_array_elements(p_compounds) c where nullif(c->>'official_version_id','') is null
   and not exists(select 1 from public.profiles p where p.id=v_user and p.is_active
     and (p.role in('OWNER','ADMIN') or (p.role='DOCTOR' and nullif(c->>'sale_item_id','') is not null)))) then
   raise exception 'ACCESS_DENIED: komposisi racikan hanya untuk peran klinis yang diizinkan' using errcode='42501';
 end if;
 select * into v_existing from public.clinic_inpatient_billable_entries where created_by=v_user and request_key=v_key;
 if found then
   if v_existing.request_hash is distinct from v_hash then raise exception 'IDEMPOTENCY_CONFLICT: kunci penambahan dipakai untuk data berbeda' using errcode='P0001';end if;
   return v_existing.id;
 end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into v_before from public.prescription_items where medical_record_id=v_mr;
 for v_row in select value from jsonb_array_elements(p_rows) loop
   select * into v_item from public.items where id=(v_row->>'item_id')::uuid and is_active;
   if not found or nullif(btrim(v_row->>'nama_obat'),'') is null
     or coalesce(v_row->>'jenis','') not in('obat','jasa')
     or (v_row->>'qty')::numeric is null or (v_row->>'qty')::numeric<=0
     or (v_row->>'qty')::numeric<>trunc((v_row->>'qty')::numeric)
     or (v_row->>'harga')::numeric is null or (v_row->>'harga')::numeric<0
     or (v_row->>'harga') in('NaN','Infinity','-Infinity') then
     raise exception 'ENTRY_INVALID: barang / jumlah / harga tidak valid' using errcode='P0001';
   end if;
   -- Resolve factor from the same item-unit master as the ordinary care action.
   if v_row->>'satuan'=v_item.unit then v_factor:=1;
   else select factor into v_factor from public.item_units where item_id=v_item.id and unit=v_row->>'satuan';end if;
   if v_factor is null or v_factor<=0 then raise exception 'ENTRY_INVALID: satuan tidak valid' using errcode='P0001';end if;
   insert into public.prescription_items(medical_record_id,nama_obat,item_id,qty,satuan,faktor,harga,aturan_pakai,jenis,kategori,service_performers,bmhp_components,salesperson_id)
   values(v_mr,v_row->>'nama_obat',v_item.id,(v_row->>'qty')::integer,v_row->>'satuan',v_factor,
     (v_row->>'harga')::numeric,v_row->>'aturan_pakai',v_row->>'jenis',v_row->>'kategori',v_row->'service_performers',v_row->'bmhp_components',nullif(v_row->>'salesperson_id','')::uuid);
 end loop;
 for v_row in select value from jsonb_array_elements(p_compounds) loop
   perform set_config('kamo.clinic_compound_seller',coalesce(v_row->>'salesperson_id',''),true);
   perform set_config('kamo.clinic_compound_performers',coalesce(v_row->>'service_performers',''),true);
   if nullif(v_row->>'sale_item_id','') is not null then
     perform public.clinic_issue_master_compound(v_mr,v_visit.id,(v_row->>'sale_item_id')::uuid,v_row->'recipe',v_row->>'request_key',nullif(v_row->>'official_version_id','')::uuid,v_row->>'dosage_instruction');
   elsif nullif(v_row->>'official_version_id','') is not null then
     perform public.clinic_issue_official_compound(v_mr,v_visit.id,(v_row->>'official_version_id')::uuid,v_row->>'request_key',v_row->>'dosage_instruction');
   else
     perform public.clinic_issue_compound(v_mr,v_visit.id,v_row->'recipe',v_row->>'request_key');
   end if;
   perform set_config('kamo.clinic_compound_seller','',true);
   perform set_config('kamo.clinic_compound_performers','',true);
 end loop;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into v_ids from public.prescription_items where medical_record_id=v_mr and not(id=any(v_before));
 insert into public.clinic_inpatient_billable_entries(inpatient_record_id,medical_record_id,visit_id,created_by,reason,request_key,request_hash,prescription_ids,rows,compounds)
 values(p_inpatient_id,v_mr,v_visit.id,v_user,p_reason,v_key,v_hash,v_ids,p_rows,p_compounds) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.clinic_add_inpatient_billables(uuid,jsonb,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.clinic_add_inpatient_billables(uuid,jsonb,jsonb,text,text) to authenticated;
