-- C03: one imported row makes one existing product promo. A batch is atomic;
-- a lost response or identical reupload cannot create a second campaign.
create table public.promo_import_batches (
 import_key uuid primary key,
 payload_hash text not null unique,
 created_by uuid not null references public.profiles(id),
 row_count integer not null check (row_count between 1 and 500),
 created_at timestamptz not null default now()
);
alter table public.promo_import_batches enable row level security;
revoke all on table public.promo_import_batches from public,anon,authenticated,service_role;

-- Immutable manifest prevents a later legacy edit from turning one imported
-- target into an unintended all-products promotion (empty promo_items).
create table public.promo_import_targets (
 promo_id uuid primary key references public.promos(id) on delete cascade,
 import_key uuid not null references public.promo_import_batches(import_key),
 item_id uuid not null references public.items(id),
 unit text not null
);
alter table public.promo_import_targets enable row level security;
revoke all on table public.promo_import_targets from public,anon,authenticated,service_role;

create function public.guard_promo_import_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare target public.promo_import_targets%rowtype;
begin
 if tg_table_name='promos' then
  if tg_op='UPDATE' then
   select * into target from public.promo_import_targets where promo_id=new.id;
   if found and new.rule->>'unit' is distinct from target.unit then
    raise exception 'Satuan promo impor tidak boleh berubah' using errcode='22023';end if;
  end if;
  return coalesce(new,old);
 end if;
 -- On UPDATE, inspect the old owner first. Otherwise moving a target from an
 -- imported promo to a legacy promo would leave the imported promo untargeted.
 if tg_op='UPDATE' and old.promo_id is distinct from new.promo_id
  and exists(select 1 from public.promo_import_targets where promo_id=old.promo_id) then
  raise exception 'Target promo impor tidak boleh dipindah' using errcode='22023';
 end if;
 select * into target from public.promo_import_targets
 where promo_id=case when tg_op='DELETE' then old.promo_id else new.promo_id end;
 if not found then return coalesce(new,old);end if;
 if tg_op='DELETE' then
  if exists(select 1 from public.promos where id=old.promo_id) then
   raise exception 'Target promo impor tidak boleh dikosongkan' using errcode='22023';end if;
 elsif tg_op='UPDATE' then
  if new.item_id is distinct from target.item_id or new.promo_id is distinct from target.promo_id then
   raise exception 'Target promo impor tidak boleh diganti' using errcode='22023';end if;
 elsif new.item_id is distinct from target.item_id then
  raise exception 'Target promo impor tidak sesuai manifest' using errcode='22023';
 end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_promo_import_scope() from public,anon,authenticated,service_role;
create trigger promo_import_scope_guard before insert or update or delete on public.promo_items
 for each row execute function public.guard_promo_import_scope();
create trigger promo_import_scope_guard before update on public.promos
 for each row execute function public.guard_promo_import_scope();

create function public.import_promo_excel_batch(p_key uuid,p_batch jsonb,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 batch_name text;
 from_date date;
 until_date date;
 branch_ids uuid[];
 branch_count integer;
 row_count integer;
 import_hash text;
 previous public.promo_import_batches%rowtype;
 entry jsonb;
 sku text;
 chosen_unit text;
 kind text;
 amount numeric;
 product public.items%rowtype;
 promo_id uuid;
 promo_name text;
 seen text[]:='{}';
begin
 perform public.assert_promo_manager();
 if p_key is null or jsonb_typeof(p_batch) is distinct from 'object'
  or jsonb_typeof(p_rows) is distinct from 'array'
  or (select count(*) from jsonb_object_keys(p_batch) k where k not in('name','valid_from','valid_until','branch_ids','all_branches'))>0 then
  raise exception 'Data batch promo tidak valid' using errcode='22023';
 end if;
 row_count:=jsonb_array_length(p_rows);
 if row_count not between 1 and 500 then raise exception 'Impor promo harus berisi 1 sampai 500 baris' using errcode='22023';end if;
 batch_name:=btrim(p_batch->>'name');
 if batch_name is null or length(batch_name) not between 1 and 40 then raise exception 'Nama batch promo wajib 1–40 karakter' using errcode='22023';end if;
 if jsonb_typeof(p_batch->'valid_from') is distinct from 'string'
  or jsonb_typeof(p_batch->'valid_until') is distinct from 'string'
  or (p_batch->>'valid_from') !~ '^\d{4}-\d{2}-\d{2}$'
  or (p_batch->>'valid_until') !~ '^\d{4}-\d{2}-\d{2}$' then
  raise exception 'Tanggal promo wajib format YYYY-MM-DD' using errcode='22023';end if;
 from_date:=(p_batch->>'valid_from')::date;
 until_date:=(p_batch->>'valid_until')::date;
 if until_date<from_date then raise exception 'Tanggal akhir promo mendahului awal' using errcode='22023';end if;
 if jsonb_typeof(p_batch->'all_branches') is distinct from 'boolean'
  or jsonb_typeof(p_batch->'branch_ids') is distinct from 'array' then
  raise exception 'Pilihan cabang promo tidak lengkap' using errcode='22023';end if;
 select count(*),array_agg(distinct x::uuid order by x::uuid) into branch_count,branch_ids
 from jsonb_array_elements_text(p_batch->'branch_ids') x;
 if (p_batch->>'all_branches')::boolean then
  if branch_count<>0 then raise exception 'Pilih semua cabang atau cabang tertentu' using errcode='22023';end if;
  branch_ids:=null;
 else
  if branch_count=0 then raise exception 'Pilih sedikitnya satu cabang' using errcode='22023';end if;
  perform id from public.branches where id=any(branch_ids) order by id for share;
  if (select count(*) from public.branches where id=any(branch_ids) and is_active
   and public.user_can_access_branch(id))<>cardinality(branch_ids) then
   raise exception 'Cabang promo tidak tersedia atau tidak dapat diakses' using errcode='42501';end if;
 end if;

 import_hash:=md5(p_batch::text||p_rows::text);
 insert into public.promo_import_batches(import_key,payload_hash,created_by,row_count)
 values(p_key,import_hash,auth.uid(),row_count) on conflict do nothing;
 if not found then
  select * into previous from public.promo_import_batches b where b.import_key=p_key for update;
  if found and previous.payload_hash is distinct from import_hash then
   raise exception 'Kunci impor promo sudah digunakan untuk isi yang berbeda' using errcode='40001';end if;
  if not found then select * into previous from public.promo_import_batches b where b.payload_hash=import_hash for update;end if;
  if not found then raise exception 'Status batch promo tidak dapat dipastikan' using errcode='40001';end if;
  return jsonb_build_object('imported',previous.row_count,'repeat',true);
 end if;

 -- No row is visible to other sessions until the whole RPC commits. Invalid
 -- later rows roll earlier inserts back, including the idempotency key.
 for entry in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(entry) is distinct from 'object'
   or (select count(*) from jsonb_object_keys(entry) k where k not in('code','unit','discount_type','discount_value'))>0
   or jsonb_typeof(entry->'code') is distinct from 'string'
   or jsonb_typeof(entry->'unit') is distinct from 'string'
   or jsonb_typeof(entry->'discount_type') is distinct from 'string'
   or jsonb_typeof(entry->'discount_value') is distinct from 'number' then
   raise exception 'Kolom baris promo tidak lengkap atau salah tipe' using errcode='22023';end if;
  sku:=btrim(entry->>'code');chosen_unit:=btrim(entry->>'unit');kind:=entry->>'discount_type';
  amount:=(entry->>'discount_value')::numeric;
  if sku='' or chosen_unit='' or kind not in('percent','nominal') or amount<=0 or amount::text in('NaN','Infinity','-Infinity')
   or (kind='percent' and amount>100) or round(amount,2)<>amount then
   raise exception 'SKU, satuan, atau nilai diskon tidak valid' using errcode='22023';end if;
  if (sku||chr(31)||chosen_unit)=any(seen) then raise exception 'SKU dan satuan duplikat dalam batch: % / %',sku,chosen_unit using errcode='22023';end if;
  seen:=array_append(seen,sku||chr(31)||chosen_unit);
  select * into product from public.items where code=sku and is_active for share;
  if not found then raise exception 'SKU promo tidak dikenal atau nonaktif: %',sku using errcode='22023';end if;
  if chosen_unit<>product.unit then
   perform 1 from public.item_units u where u.item_id=product.id and u.unit=chosen_unit for share;
   if not found then raise exception 'Satuan % tidak tersedia untuk SKU %',chosen_unit,sku using errcode='22023';end if;
  end if;
  promo_name:=batch_name||' · '||sku||' / '||chosen_unit;
  if length(promo_name)>120 then raise exception 'Nama promo hasil impor terlalu panjang' using errcode='22023';end if;
  insert into public.promos(name,promo_type,rule,is_active,branch_ids,valid_from,valid_until,
   auto_apply,discount_type,discount_value)
  values(promo_name,'diskon_produk',jsonb_build_object('suggest',promo_name,'unit',chosen_unit,'import_batch_key',p_key),
   true,branch_ids,from_date,until_date,true,kind,amount)
  returning id into promo_id;
  insert into public.promo_import_targets(promo_id,import_key,item_id,unit)
  values(promo_id,p_key,product.id,chosen_unit);
  insert into public.promo_items(promo_id,item_id) values(promo_id,product.id);
 end loop;
 return jsonb_build_object('imported',row_count,'repeat',false);
end$$;
revoke all on function public.import_promo_excel_batch(uuid,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.import_promo_excel_batch(uuid,jsonb,jsonb) to authenticated;
