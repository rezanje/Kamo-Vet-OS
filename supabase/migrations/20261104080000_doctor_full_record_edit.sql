-- LOCAL candidate. Full medical edit is DOCTOR-only and closes on ANY invoice.
-- Money coordinator precedes visit/record/Rx locks. No stock/money writer here.
create table clinic_private.record_edit_permits (
 transaction_id bigint primary key, actor uuid not null, visit_id uuid not null
);
revoke all on clinic_private.record_edit_permits from public,anon,authenticated,service_role;
create table public.clinic_full_record_edits (
 id uuid primary key default gen_random_uuid(), medical_record_id uuid not null references public.medical_records(id),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default clock_timestamp(),
 request_key text not null, request_hash text not null, reason text not null,
 before_rows jsonb not null, after_rows jsonb not null,
 unique(created_by,request_key)
);
alter table public.clinic_full_record_edits enable row level security;
revoke all on public.clinic_full_record_edits from public,anon,authenticated,service_role;
grant select on public.clinic_full_record_edits to authenticated;
create policy full_record_edits_read on public.clinic_full_record_edits for select to authenticated
 using(exists(select 1 from public.medical_records m where m.id=medical_record_id and public.clinic_record_correction_actor(m.visit_id)));
create trigger full_record_edits_immutable before update or delete on public.clinic_full_record_edits
 for each row execute function public.clinic_record_correction_immutable();
create trigger full_record_edits_no_truncate before truncate on public.clinic_full_record_edits
 for each statement execute function public.clinic_record_correction_immutable();

-- Keep the shared clinical actor helper UNCHANGED: evidence/addenda use it too.
create or replace function public.clinic_can_correct_record(p_record_id uuid)returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.medical_records m join public.visits v on v.id=m.visit_id
 join public.profiles p on p.id=auth.uid()
 where m.id=p_record_id and m.submission_key is not null and p.role='DOCTOR' and p.is_active
 and public.clinic_record_correction_actor(v.id) and v.status='Pembayaran'
 and v.service_started_at is not null and v.service_finished_at is not null and v.checked_out_at is null
 and not exists(select 1 from public.invoices i where i.visit_id=v.id));
$$;

-- Legacy correction and its direct audit INSERT share the new DOCTOR gate.
-- Coordinate before their original row/request locks, and recheck role BEFORE replay.
do $patch$
declare d text; old_text text; new_text text;
begin
 d:=pg_get_functiondef('public.clinic_correct_unpaid_record(uuid,uuid,integer,jsonb,text,text)'::regprocedure);
 old_text:=' if not public.clinic_record_correction_actor(p_visit_id)then';
 new_text:=E' perform clinic_private.billing_lock(clinic_private.billing_keys_visit(p_visit_id));\n if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role=''DOCTOR'')then raise exception ''ACCESS_DENIED: hanya dokter dapat mengubah rekam medis'' using errcode=''42501'';end if;\n if not public.clinic_record_correction_actor(p_visit_id)then';
 if (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 then raise exception 'Legacy correction anchor drift';end if;
 execute replace(d,old_text,new_text);
 -- Trigger remains security invoker, so coordinator access must not be exposed.
 -- Direct audit writes are no longer public; only the definer wrapper below writes.
end $patch$;
revoke insert on public.clinic_record_corrections from authenticated;
-- Existing text-only RPC cannot insert the audit after revoke. Keep it disabled;
-- the full wrapper performs the validated insert as definer. No alternate legacy edit.
revoke execute on function public.clinic_correct_unpaid_record(uuid,uuid,integer,jsonb,text,text) from authenticated;

-- Existing BMHP normalizer is retained verbatim except its UPDATE early-return:
-- only a private transaction permit can normalize changes as a new composition.
do $patch$
declare d text; needle text:='  if tg_op = ''UPDATE'' then';
begin
 d:=pg_get_functiondef('public.guard_prescription_bmhp()'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'BMHP update anchor drift';end if;
 execute replace(d,needle,E'  if tg_op = ''UPDATE'' and not exists(select 1 from clinic_private.record_edit_permits e join public.medical_records m on m.visit_id=e.visit_id where e.transaction_id=txid_current() and e.actor=auth.uid() and m.id=new.medical_record_id) then');
end $patch$;

-- Direct API UPDATE/DELETE cannot bypass the full edit gate on submitted records.
create function public.guard_full_record_prescription()returns trigger
language plpgsql security invoker set search_path='' as $$
declare v uuid;
begin
 -- A definer-owned business RPC retains its own stock/role/evidence guards.
 -- Direct table API writes run as authenticated and cannot impersonate that
 -- context with a user-settable GUC. Initial save precedes visit completion.
 if current_user not in ('authenticated','anon','service_role') then
  return case when tg_op='DELETE' then old else new end;
 end if;
 select m.visit_id into v from public.medical_records m join public.visits s on s.id=m.visit_id
 where m.id=case when tg_op='INSERT' then new.medical_record_id else old.medical_record_id end
 and m.submission_key is not null and s.service_finished_at is not null;
 if v is not null then
  raise exception 'ACCESS_DENIED: resep tersimpan hanya diubah lewat alur klinis berjejak' using errcode='42501';
 end if;
 return case when tg_op='DELETE' then old else new end;
end$$;
revoke all on function public.guard_full_record_prescription() from public,anon,authenticated,service_role;
create trigger aa_full_record_prescription before insert or update or delete on public.prescription_items
 for each row execute function public.guard_full_record_prescription();

-- Product replacement keeps the exact ORIGINAL ordering attribution. A private
-- transaction permit is required; invoice/POS snapshots and direct writes keep
-- the original guard, and no caller can rewrite a saved performer snapshot.
do $patch$
declare d text;needle text:=' if tg_op=''UPDATE'' then';replacement text;
begin
 d:=pg_get_functiondef('public.guard_service_line_performers()'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Performer update anchor drift';end if;
 replacement:=needle||E'\n  if tg_table_name=''prescription_items'' and new.service_performers is not distinct from old.service_performers\n   and (to_jsonb(new)->>''medical_record_id'') is not distinct from (to_jsonb(old)->>''medical_record_id'')\n   and exists(select 1 from clinic_private.record_edit_permits p join public.medical_records m on m.visit_id=p.visit_id\n    where p.transaction_id=txid_current() and p.actor=auth.uid() and m.id=(to_jsonb(old)->>''medical_record_id'')::uuid) then return new;end if;';
 execute replace(d,needle,replacement);
end $patch$;

create function public.clinic_edit_queued_record(
 p_visit_id uuid,p_record_id uuid,p_expected_revision integer,p_changes jsonb,p_rows jsonb,p_reason text,p_request_key text
)returns uuid language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare prev public.clinic_full_record_edits%rowtype; v_hash text; v_before jsonb; v_after jsonb;
 row_value jsonb; rx public.prescription_items%rowtype; v_id uuid; v_seen uuid[]:='{}'; v_item public.items%rowtype;
 v_qty numeric; v_factor numeric; v_unit text; v_price numeric; v_kind text;
begin
 perform clinic_private.billing_lock(clinic_private.billing_keys_visit(p_visit_id));
 if auth.role() is distinct from 'authenticated' or not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='DOCTOR')
 or not public.clinic_record_correction_actor(p_visit_id) then
  raise exception 'ACCESS_DENIED: hanya dokter dapat mengubah rekam medis' using errcode='42501';
 end if;
 perform 1 from public.visits where id=p_visit_id for update;
 perform 1 from public.medical_records where id=p_record_id and visit_id=p_visit_id for update;
 if not found then raise exception 'ACCESS_DENIED: rekam medis tidak sesuai' using errcode='42501';end if;
 if nullif(btrim(p_request_key),'') is null or length(p_request_key)>100 or length(btrim(coalesce(p_reason,''))) not between 3 and 1000
 or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>200 then raise exception 'RECORD_INVALID: data koreksi tidak valid';end if;
 v_hash:=md5(jsonb_build_array(p_visit_id,p_record_id,p_expected_revision,p_changes,p_rows,btrim(p_reason))::text);
 select * into prev from public.clinic_full_record_edits where created_by=auth.uid() and request_key=p_request_key;
 if found then
  if prev.request_hash is distinct from v_hash or prev.medical_record_id<>p_record_id then raise exception 'IDEMPOTENCY_CONFLICT';end if;
  return p_record_id;
 end if;
 if not public.clinic_can_correct_record(p_record_id) then raise exception 'RECORD_POSTED: kunjungan sudah berubah atau memiliki invoice';end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') into v_before from public.prescription_items p where p.medical_record_id=p_record_id;
 -- Validated audited text correction retains exact original MR ID/submission/timestamps.
 insert into public.clinic_record_corrections(medical_record_id,expected_revision,changes,reason,request_key,created_by,transaction_id,before_value,after_value)
 values(p_record_id,p_expected_revision,p_changes,p_reason,p_request_key,auth.uid(),txid_current(),'{}','{}');
 insert into clinic_private.record_edit_permits values(txid_current(),auth.uid(),p_visit_id);
 for row_value in select value from jsonb_array_elements(p_rows) loop
  v_id:=coalesce(nullif(row_value->>'prescription_item_id','')::uuid,nullif(row_value->>'id','')::uuid);
  if v_id=any(v_seen)then raise exception 'RECORD_INVALID: resep duplikat';end if;
  if v_id is not null then
   select * into rx from public.prescription_items where id=v_id and medical_record_id=p_record_id for update;
   if not found then raise exception 'RECORD_INVALID: resep asing';end if;
   v_seen:=v_seen||v_id;
   -- Issued compounds are NEVER reissued or modified by this save. Corrections /
   -- returns use the original Aksi APIs with their reason, audit and delta stock.
   if rx.compound_recipe_id is not null then
    if (row_value->>'qty')::numeric is distinct from rx.qty or (row_value->>'harga')::numeric is distinct from rx.harga
      or nullif(row_value->>'compound_recipe_id','')::uuid is distinct from rx.compound_recipe_id then raise exception 'COMPOUND_LOCKED: gunakan Aksi koreksi racikan';end if;
    continue;
   end if;
  else rx:=null;end if;
  if nullif(row_value->>'compound_recipe_id','') is not null or row_value->>'jenis'='racikan' then raise exception 'COMPOUND_LOCKED: buat racikan lewat alur racik berjejak';end if;
  v_qty:=(row_value->>'qty')::numeric;v_price:=(row_value->>'harga')::numeric;
  if v_qty is null or v_qty<=0 or v_qty>100000 or v_qty<>trunc(v_qty) or v_price is null or v_price<0 or v_price>1e12 then raise exception 'RECORD_INVALID: jumlah/harga tidak valid';end if;
  v_unit:=nullif(btrim(row_value->>'satuan'),'');v_kind:=row_value->>'jenis';v_factor:=1;
  if nullif(row_value->>'item_id','') is not null then
   select * into v_item from public.items where id=(row_value->>'item_id')::uuid and is_active;
   if not found then raise exception 'RECORD_INVALID: barang tidak aktif';end if;
   v_kind:=case when v_item.item_type='Jasa' then 'jasa' else 'obat' end;
   v_unit:=coalesce(v_unit,v_item.unit);
   if v_unit<>v_item.unit then
    select factor into v_factor from public.item_units where item_id=v_item.id and unit=v_unit;
    if v_factor is null or v_factor<=0 then raise exception 'RECORD_INVALID: satuan tidak tersedia';end if;
   end if;
  else
   v_item:=null;
   if v_id is null or rx.item_id is not null then raise exception 'RECORD_INVALID: item baru harus dari master';end if;
   -- Preserve legacy free-name rows, do not create new ones.
   v_kind:=rx.jenis;v_unit:=rx.satuan;v_factor:=rx.faktor;
  end if;
  if v_id is null then
   insert into public.prescription_items(medical_record_id,nama_obat,item_id,qty,satuan,faktor,harga,aturan_pakai,jenis,kategori,bmhp_components,service_performers)
   values(p_record_id,v_item.name,v_item.id,v_qty,v_unit,v_factor,v_price,row_value->>'aturan_pakai',v_kind,row_value->>'kategori',nullif(nullif(row_value->'bmhp_components','[]'),'null'),nullif(row_value->'service_performers','null')) returning id into v_id;
   v_seen:=v_seen||v_id;
  else
   update public.prescription_items set nama_obat=coalesce(v_item.name,rx.nama_obat),item_id=v_item.id,qty=v_qty,satuan=v_unit,faktor=v_factor,harga=v_price,
    aturan_pakai=row_value->>'aturan_pakai',jenis=v_kind,kategori=row_value->>'kategori',bmhp_components=nullif(nullif(row_value->'bmhp_components','[]'),'null'),service_performers=nullif(row_value->'service_performers','null')
   where id=v_id;
  end if;
 end loop;
 -- Removal is not supported at this medical checkpoint: no clinical history is
 -- deleted or silently unbilled. Existing compound/evidence rows MUST be retained.
 if exists(select 1 from public.prescription_items where medical_record_id=p_record_id and not(id=any(v_seen)))then
  raise exception 'RECORD_INVALID: resep tersimpan tidak boleh dihapus; pertahankan baris atau gunakan koreksi berjejak';end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') into v_after from public.prescription_items p where p.medical_record_id=p_record_id;
 insert into public.clinic_full_record_edits(medical_record_id,created_by,request_key,request_hash,reason,before_rows,after_rows)
 values(p_record_id,auth.uid(),p_request_key,v_hash,btrim(p_reason),v_before,v_after);
 delete from clinic_private.record_edit_permits where transaction_id=txid_current();
 return p_record_id;
end$$;
revoke all on function public.clinic_edit_queued_record(uuid,uuid,integer,jsonb,jsonb,text,text)from public,anon,authenticated,service_role;
grant execute on function public.clinic_edit_queued_record(uuid,uuid,integer,jsonb,jsonb,text,text)to authenticated;
