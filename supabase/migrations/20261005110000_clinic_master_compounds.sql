-- Selling identity/price is separate from immutable formula and FIFO snapshots.
create table public.clinic_compound_sales (
  request_key text primary key,
  request_hash text not null,
  recipe_id uuid unique references public.compounding_recipes(id),
  visit_id uuid not null references public.visits(id),
  medical_record_id uuid not null references public.medical_records(id),
  actor_id uuid not null references public.profiles(id),
  sale_item_id uuid not null references public.items(id),
  sale_name text not null,
  sale_price numeric(15,2) not null check(sale_price>=0),
  sale_unit text not null,
  created_at timestamptz not null default now()
);
alter table public.clinic_compound_sales enable row level security;
revoke all on public.clinic_compound_sales from public,anon,authenticated,service_role;
grant select on public.clinic_compound_sales to authenticated;
create policy compound_sale_branch_read on public.clinic_compound_sales for select to authenticated
  using (exists(select 1 from public.visits v where v.id=visit_id and public.user_can_access_branch(v.branch_id)));

create function public.clinic_issue_master_compound(
  p_medical_record_id uuid,p_visit_id uuid,p_sale_item_id uuid,p_recipe jsonb,
  p_request_key text,p_formula_version_id uuid default null,p_dosage_instruction text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=auth.uid();
  v_visit public.visits%rowtype;
  v_sale public.clinic_compound_sales%rowtype;
  v_item public.items%rowtype;
  v_price numeric(15,2);
  v_key text:=nullif(btrim(p_request_key),'');
  v_hash text;
  v_recipe jsonb;
  v_ingredients jsonb:='[]'::jsonb;
  v_ingredient jsonb;
  v_material public.items%rowtype;
  v_recipe_id uuid;
begin
  if coalesce(auth.role(),'')<>'authenticated' or v_user is null or not exists (
    select 1 from public.profiles p where p.id=v_user and p.is_active=true
  ) then
    raise exception using errcode='P0001',message='ACCESS_DENIED: pengguna tidak aktif atau tidak terautentikasi';
  end if;
  if v_key is null or length(v_key)>100 or p_sale_item_id is null
    or (p_formula_version_id is null and jsonb_typeof(p_recipe) is distinct from 'object')
    or (p_formula_version_id is not null and p_recipe is not null) then
    raise exception using errcode='P0001',message='RECIPE_INVALID: pilih SKU obat racik dan komposisi yang valid';
  end if;
  select * into v_visit from public.visits where id=p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) or not exists (
    select 1 from public.medical_records where id=p_medical_record_id and visit_id=p_visit_id
  ) then
    raise exception using errcode='P0001',message='ACCESS_DENIED: pemeriksaan atau cabang tidak dapat diakses';
  end if;
  v_hash:=md5(jsonb_build_object('medical',p_medical_record_id,'visit',p_visit_id,
    'sale_item',p_sale_item_id,'recipe',p_recipe,'formula',p_formula_version_id,'dose',p_dosage_instruction)::text);
  perform pg_advisory_xact_lock(hashtextextended('clinic-master-compound:'||v_key,0));
  select * into v_sale from public.clinic_compound_sales where request_key=v_key for update;
  if found then
    if v_sale.actor_id is distinct from v_user or v_sale.request_hash is distinct from v_hash
      or v_sale.recipe_id is null then
      raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT: kunci racikan dipakai untuk data berbeda';
    end if;
    return v_sale.recipe_id;
  end if;
  if exists(select 1 from public.compounding_recipes where request_key=v_key) then
    raise exception using errcode='P0001',message='IDEMPOTENCY_CONFLICT: kunci sudah dipakai racikan sebelumnya';
  end if;
  select i.* into v_item from public.items i where i.id=p_sale_item_id and i.is_active
    and i.item_type='Persediaan' and not i.is_compound_material
    and (i.name ilike 'Obat Racik %' or i.name ilike 'Obat Racikan %' or exists (
      select 1 from public.item_categories c where c.id=i.category_id
        and upper(regexp_replace(btrim(c.name),'\s+',' ','g')) in ('OBAT RACIK','OBAT RACIKAN','RACIKAN')
    )) for share of i;
  if not found then
    raise exception using errcode='P0001',message='ITEM_INVALID: pilih SKU obat racik aktif dari Barang & Jasa';
  end if;
  select sell_price into v_price from public.item_branch_prices
    where item_id=v_item.id and branch_id=v_visit.branch_id and unit=v_item.unit for share;
  v_price:=coalesce(v_price,v_item.sell_price,0);
  if v_price<0 or v_price::text in ('NaN','Infinity','-Infinity') then
    raise exception using errcode='P0001',message='ITEM_INVALID: harga jual master tidak valid';
  end if;
  insert into public.clinic_compound_sales(request_key,request_hash,visit_id,medical_record_id,
    actor_id,sale_item_id,sale_name,sale_price,sale_unit)
  values(v_key,v_hash,p_visit_id,p_medical_record_id,v_user,v_item.id,v_item.name,v_price,v_item.unit);
  if p_formula_version_id is not null then
    v_recipe_id:=public.clinic_issue_official_compound(p_medical_record_id,p_visit_id,p_formula_version_id,v_key,p_dosage_instruction);
  else
    if jsonb_typeof(p_recipe->'ingredients') is distinct from 'array'
      or jsonb_array_length(p_recipe->'ingredients') not between 1 and 100 then
      raise exception using errcode='P0001',message='RECIPE_INVALID: minimal satu bahan racikan';
    end if;
    for v_ingredient in select value from jsonb_array_elements(p_recipe->'ingredients') loop
      select * into v_material from public.items where id=(v_ingredient->>'item_id')::uuid
        and is_active and is_compound_material and item_type='Persediaan' for share;
      if not found then
        raise exception using errcode='P0001',message='INGREDIENT_INVALID: bahan tidak aktif';
      end if;
      -- Unit/quantity is validated by the existing stock routine. Client prices
      -- never set selling price or ingredient snapshots.
      v_ingredients:=v_ingredients||jsonb_build_array(v_ingredient||jsonb_build_object('unit_price',coalesce(v_material.sell_price,0)));
    end loop;
    v_recipe:=p_recipe||jsonb_build_object('recipe_name',v_item.name,'ingredients',v_ingredients);
    v_recipe_id:=public.clinic_issue_compound(p_medical_record_id,p_visit_id,v_recipe,v_key);
  end if;
  update public.clinic_compound_sales set recipe_id=v_recipe_id where request_key=v_key;
  if not exists(select 1 from public.prescription_items where compound_recipe_id=v_recipe_id
      and item_id is null and nama_obat=v_item.name and harga=v_price and qty=1) then
    raise exception using errcode='P0001',message='RECIPE_INVALID: tautan harga jual racikan gagal';
  end if;
  return v_recipe_id;
end;
$$;
revoke all on function public.clinic_issue_master_compound(uuid,uuid,uuid,jsonb,text,uuid,text) from public,anon,service_role;
grant execute on function public.clinic_issue_master_compound(uuid,uuid,uuid,jsonb,text,uuid,text) to authenticated;

-- The existing AFTER INSERT trigger uses this function. Apply sale identity at
-- initial insert, before official usage makes prescription snapshots immutable.
create or replace function public.link_compound_recipe_to_prescription()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_sale public.clinic_compound_sales%rowtype;
begin
  select * into v_sale from public.clinic_compound_sales where request_key=new.request_key
    and medical_record_id=new.medical_record_id and actor_id=new.created_by;
  insert into public.prescription_items(medical_record_id,nama_obat,qty,harga,satuan,faktor,jenis,aturan_pakai,item_id,compound_recipe_id)
  values(new.medical_record_id,coalesce(v_sale.sale_name,new.recipe_name),1,
    coalesce(v_sale.sale_price,new.total_price),'racikan',1,'obat',new.dosage_instruction,null,new.id);
  return new;
end;
$$;
revoke all on function public.link_compound_recipe_to_prescription() from public,anon,authenticated,service_role;

-- Preserve the selling snapshot through checkout. Discounts remain independent.
create function public.protect_master_compound_invoice()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_sale public.clinic_compound_sales%rowtype;
begin
  if tg_op='UPDATE' and old.compound_recipe_id is distinct from new.compound_recipe_id
    and exists(select 1 from public.clinic_compound_sales where recipe_id=old.compound_recipe_id) then
    raise exception using errcode='P0001',message='MASTER_COMPOUND_SNAPSHOT: tautan racikan tidak dapat diubah';
  end if;
  select * into v_sale from public.clinic_compound_sales where recipe_id=new.compound_recipe_id;
  if found and (new.harga is distinct from v_sale.sale_price or new.deskripsi is distinct from v_sale.sale_name
    or new.qty is distinct from 1::numeric or new.item_id is not null or new.satuan is distinct from 'racikan') then
    raise exception using errcode='P0001',message='MASTER_COMPOUND_SNAPSHOT: gunakan nama dan harga racikan tersimpan; koreksi melalui diskon';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_master_compound_invoice() from public,anon,authenticated,service_role;
create trigger protect_master_compound_invoice before insert or update on public.invoice_items
for each row execute function public.protect_master_compound_invoice();

CREATE OR REPLACE FUNCTION public.clinic_save_initial_record(p_visit_id uuid, p_pet_id uuid, p_record jsonb, p_followups jsonb, p_rows jsonb, p_compounds jsonb, p_provider_id uuid, p_doctor_id uuid, p_dokter text, p_keluhan text, p_request_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_visit public.visits%rowtype;
  v_existing public.medical_records%rowtype;
  v_record_id uuid;
  v_customer_id uuid;
  v_hash text;
  v_user uuid := auth.uid();
  v_row jsonb;
  v_urls text[];
  v_key text := nullif(btrim(p_request_key), '');
begin
  if coalesce(auth.role(), '') <> 'authenticated'
     or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100
     or jsonb_typeof(p_record) is distinct from 'object'
     or jsonb_typeof(p_followups) is distinct from 'array'
     or jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_typeof(p_compounds) is distinct from 'array'
     or jsonb_array_length(p_followups) > 100
     or jsonb_array_length(p_rows) > 200
     or jsonb_array_length(p_compounds) > 50 then
    raise exception using errcode='P0001', message='RECORD_INVALID: pemeriksaan tidak lengkap';
  end if;
  v_hash := md5(jsonb_build_object(
    'visit', p_visit_id, 'pet', p_pet_id, 'record', p_record,
    'followups', p_followups, 'rows', p_rows, 'compounds', p_compounds,
    'provider', p_provider_id, 'doctor', p_doctor_id,
    'doctor_name', p_dokter, 'complaint', p_keluhan
  )::text);

  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found or v_visit.pet_id is distinct from p_pet_id
     or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: kunjungan atau pasien tidak dapat diakses';
  end if;
  select * into v_existing from public.medical_records
  where submission_key = v_key for update;
  if found then
    if v_existing.visit_id is distinct from p_visit_id
       or v_existing.submitted_by is distinct from v_user
       or v_existing.submission_hash is distinct from v_hash then
      raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT: kunci pemeriksaan dipakai untuk data berbeda';
    end if;
    return v_existing.id;
  end if;
  if v_visit.service_started_at is null or v_visit.service_finished_at is not null then
    raise exception using errcode='P0001', message='RECORD_INVALID: kunjungan belum siap disimpan';
  end if;
  -- Validate before any record, prescription, compound or service-state write.
  -- Grooming/boarding are not medical visits; registration drafts remain allowed.
  if lower(btrim(coalesce(v_visit.poli, ''))) not in ('grooming','penitipan') then
    if p_doctor_id is null or not exists (
      select 1 from public.employees e where e.id=p_doctor_id and e.status='Aktif'
        and (coalesce(e.jabatan,'') || ' ' || e.nama) ~* '(dokter|doctor|drh)'
        and (e.branch_id=v_visit.branch_id or exists (
          select 1 from public.employee_branch_assignments a
          where a.employee_id=e.id and a.branch_id=v_visit.branch_id
        ))
    ) then
      raise exception using errcode='P0001', message='DOCTOR_REQUIRED: pilih dokter aktif yang ditugaskan ke cabang';
    end if;
    if nullif(btrim(p_keluhan), '') is null then
      raise exception using errcode='P0001', message='COMPLAINT_REQUIRED: keluhan pasien wajib diisi';
    end if;
  end if;
  select customer_id into v_customer_id from public.pets where id = p_pet_id;

  if p_provider_id is not null then
    perform public.set_visit_service_state(p_visit_id, 'provider', p_provider_id);
  end if;
  if jsonb_typeof(p_record->'penunjang_urls') = 'array' then
    select array_agg(value) into v_urls
    from jsonb_array_elements_text(p_record->'penunjang_urls') as u(value);
  end if;
  insert into public.medical_records(
    visit_id, diagnosis, anamnesis, suhu, berat, gejala_klinis,
    hasil_penunjang, follow_up, catatan_resep, penunjang_urls,
    submission_key, submission_hash, submitted_by
  ) values (
    p_visit_id, p_record->>'diagnosis', p_record->>'anamnesis',
    (p_record->>'suhu')::numeric, (p_record->>'berat')::numeric,
    p_record->>'gejala_klinis', p_record->>'hasil_penunjang',
    p_record->>'follow_up', p_record->>'catatan_resep', v_urls,
    v_key, v_hash, v_user
  ) returning id into v_record_id;

  for v_row in select value from jsonb_array_elements(p_followups) as f(value) loop
    insert into public.follow_ups(
      visit_id, medical_record_id, pet_id, customer_id, branch_id,
      jenis, tanggal, catatan, created_by
    ) values (
      p_visit_id, v_record_id, p_pet_id, v_customer_id, v_visit.branch_id,
      v_row->>'jenis', (v_row->>'tanggal')::date,
      nullif(v_row->>'catatan', ''), v_user
    );
  end loop;
  for v_row in select value from jsonb_array_elements(p_rows) as r(value) loop
    insert into public.prescription_items(
      medical_record_id, nama_obat, item_id, qty, satuan, faktor,
      harga, aturan_pakai, jenis, kategori
    ) values (
      v_record_id, v_row->>'nama_obat', (v_row->>'item_id')::uuid,
      (v_row->>'qty')::integer, v_row->>'satuan',
      (v_row->>'faktor')::numeric, (v_row->>'harga')::numeric,
      v_row->>'aturan_pakai', v_row->>'jenis', v_row->>'kategori'
    );
  end loop;
  for v_row in select value from jsonb_array_elements(p_compounds) as c(value) loop
    if nullif(v_row->>'sale_item_id', '') is not null then
      perform public.clinic_issue_master_compound(
        v_record_id, p_visit_id, (v_row->>'sale_item_id')::uuid,
        v_row->'recipe', v_row->>'request_key',
        nullif(v_row->>'official_version_id','')::uuid, v_row->>'dosage_instruction'
      );
    elsif nullif(v_row->>'official_version_id', '') is not null then
      perform public.clinic_issue_official_compound(
        v_record_id, p_visit_id, (v_row->>'official_version_id')::uuid,
        v_row->>'request_key', v_row->>'dosage_instruction'
      );
    else
      -- Only the OWNER/ADMIN exception wrapper accepts this call.
      perform public.clinic_issue_compound(
        v_record_id, p_visit_id, v_row->'recipe', v_row->>'request_key'
      );
    end if;
  end loop;
  if (p_record->>'berat')::numeric > 0 then
    update public.pets set weight = (p_record->>'berat')::numeric where id = p_pet_id;
  end if;
  perform public.set_visit_service_state(p_visit_id, 'finish');
  update public.visits
  set status = 'Pembayaran', dokter = p_dokter, doctor_id = p_doctor_id, keluhan = p_keluhan
  where id = p_visit_id;
  return v_record_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clinic_save_inpatient_log(p_inpatient_id uuid, p_medical_record_id uuid, p_log jsonb, p_rows jsonb, p_compounds jsonb, p_request_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_inpatient public.inpatient_records%rowtype;
  v_existing public.inpatient_daily_logs%rowtype;
  v_log_id uuid;
  v_hash text;
  v_user uuid := auth.uid();
  v_row jsonb;
  v_key text := nullif(btrim(p_request_key), '');
begin
  if coalesce(auth.role(), '') <> 'authenticated'
     or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100
     or jsonb_typeof(p_log) is distinct from 'object'
     or nullif(btrim(p_log->>'condition_note'), '') is null
     or jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_typeof(p_compounds) is distinct from 'array'
     or jsonb_array_length(p_rows) > 200 or jsonb_array_length(p_compounds) > 50 then
    raise exception using errcode='P0001', message='LOG_INVALID: catatan rawat inap tidak lengkap';
  end if;
  v_hash := md5(jsonb_build_object(
    'inpatient', p_inpatient_id, 'medical_record', p_medical_record_id,
    'log', p_log, 'rows', p_rows, 'compounds', p_compounds
  )::text);
  select * into v_inpatient from public.inpatient_records
  where id = p_inpatient_id for update;
  if not found or not public.user_can_access_branch(v_inpatient.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: rawat inap tidak dapat diakses';
  end if;
  select * into v_existing from public.inpatient_daily_logs
  where submission_key = v_key for update;
  if found then
    if v_existing.inpatient_record_id is distinct from p_inpatient_id
       or v_existing.submitted_by is distinct from v_user
       or v_existing.submission_hash is distinct from v_hash then
      raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT: kunci catatan dipakai untuk data berbeda';
    end if;
    return v_existing.id;
  end if;
  if (jsonb_array_length(p_rows) > 0 or jsonb_array_length(p_compounds) > 0)
     and (p_medical_record_id is null or not exists (
       select 1 from public.medical_records m where m.id = p_medical_record_id
       and m.visit_id = v_inpatient.visit_id
     )) then
    raise exception using errcode='P0001', message='LOG_INVALID: rekam medis belum tersedia untuk menautkan tagihan';
  end if;
  insert into public.inpatient_daily_logs(
    inpatient_record_id, condition_note, tindakan, keterangan, doctor_name,
    created_by, makan, minum, bab, pipis, berat, suhu, foto_url,
    komunikasi_owner, komunikasi_via, log_date, created_at,
    submission_key, submission_hash, submitted_by
  ) values (
    p_inpatient_id, p_log->>'condition_note', p_log->>'tindakan',
    p_log->>'keterangan', p_log->>'doctor_name', v_user,
    p_log->>'makan', p_log->>'minum', p_log->>'bab', p_log->>'pipis',
    (p_log->>'berat')::numeric, (p_log->>'suhu')::numeric,
    p_log->>'foto_url', p_log->>'komunikasi_owner', p_log->>'komunikasi_via',
    coalesce((p_log->>'log_date')::date, current_date),
    coalesce((p_log->>'created_at')::timestamptz, now()),
    v_key, v_hash, v_user
  ) returning id into v_log_id;
  for v_row in select value from jsonb_array_elements(p_rows) as r(value) loop
    insert into public.prescription_items(
      medical_record_id, nama_obat, item_id, qty, satuan, faktor,
      harga, aturan_pakai, jenis
    ) values (
      p_medical_record_id, v_row->>'nama_obat', (v_row->>'item_id')::uuid,
      (v_row->>'qty')::integer, v_row->>'satuan',
      (v_row->>'faktor')::numeric, (v_row->>'harga')::numeric,
      v_row->>'aturan_pakai', v_row->>'jenis'
    );
  end loop;
  for v_row in select value from jsonb_array_elements(p_compounds) as c(value) loop
    if nullif(v_row->>'sale_item_id', '') is not null then
      perform public.clinic_issue_master_compound(
        p_medical_record_id, v_inpatient.visit_id, (v_row->>'sale_item_id')::uuid,
        v_row->'recipe', v_row->>'request_key',
        nullif(v_row->>'official_version_id','')::uuid, v_row->>'dosage_instruction'
      );
    elsif nullif(v_row->>'official_version_id', '') is not null then
      perform public.clinic_issue_official_compound(
        p_medical_record_id, v_inpatient.visit_id,
        (v_row->>'official_version_id')::uuid,
        v_row->>'request_key', v_row->>'dosage_instruction'
      );
    else
      perform public.clinic_issue_compound(
        p_medical_record_id, v_inpatient.visit_id,
        v_row->'recipe', v_row->>'request_key'
      );
    end if;
  end loop;
  return v_log_id;
end;
$function$
;
