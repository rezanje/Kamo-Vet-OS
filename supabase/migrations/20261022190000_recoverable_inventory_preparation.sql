-- Atomic, recoverable preparation only. Existing stock/journal posting and its
-- exact-cent/reconciliation guards are unchanged. No live data is repaired.
create function public.prepare_accurate_initial_stock(
 p_source_hash text,p_source_name text,p_branch_id uuid,p_warehouse_id uuid,
 p_as_of date,p_rows jsonb,p_policy text default 'STRICT'
) returns uuid language plpgsql security invoker set search_path='' as $$
declare
 run public.import_runs%rowtype; run_id uuid; x jsonb; v jsonb; payload jsonb;
 prepared jsonb:='[]'; adjusted jsonb:='[]'; sources jsonb;
 source_value numeric:=0; posted_value numeric:=0; target numeric; residual numeric;
 row_source numeric; row_qty numeric; qty numeric; cost numeric; source_factor numeric;
 rate numeric; candidate numeric; adjustment numeric:=0; allocated int;
 conversion_count int;
 n int:=0; skipped int:=0; rejected int:=0; total_qty numeric:=0;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role in ('OWNER','ADMIN') and is_active)
 or not public.user_can_access_branch(p_branch_id) then
  raise exception 'Akun/cabang tidak dapat diakses' using errcode='42501';end if;
 if not exists(select 1 from public.warehouses where id=p_warehouse_id and branch_id=p_branch_id and is_active)
 or not exists(select 1 from public.branches where id=p_branch_id and is_active) then
  raise exception 'Cabang/gudang tidak cocok atau tidak aktif' using errcode='22023';end if;
 if p_as_of is null or not isfinite(p_as_of) or p_as_of>(now() at time zone 'Asia/Jakarta')::date
 or p_policy not in ('STRICT','HALF_UP_BATCH_V1') or p_policy is null
 or p_source_hash is null or length(p_source_hash) not between 8 and 128
 or p_source_name is null or length(p_source_name) not between 1 and 255
 or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>20000 then
  raise exception 'Tanggal, sumber, atau kebijakan impor tidak valid' using errcode='22023';end if;
 -- Same hash cannot become a partially populated run on a concurrent retry.
 perform pg_advisory_xact_lock(hashtextextended(p_source_hash,0));
 select * into run from public.import_runs where kind='initial_stock' and source_hash=p_source_hash;
 if found then
  if run.created_by<>auth.uid() or run.branch_id is distinct from p_branch_id or run.warehouse_id is distinct from p_warehouse_id
   or run.as_of_date is distinct from p_as_of or run.summary#>>'{valuation,policy}' is distinct from p_policy then raise exception 'Batch bukan milik akun/tujuan ini' using errcode='42501';end if;
  if run.status not in ('previewed','posted') then raise exception 'Batch gagal; perlu pemeriksaan' using errcode='22023';end if;
  return run.id;
 end if;
 if exists(select 1 from jsonb_array_elements(p_rows) a group by a->>'source_row' having count(*)>1) then
  raise exception 'Nomor baris sumber ganda' using errcode='22023';end if;
 for x in select value from jsonb_array_elements(p_rows) order by (value->>'source_row')::int loop
  payload:=x->'payload';
  if (x->>'source_row')::int<2 or x->>'status' not in ('valid','skipped','rejected') then
   raise exception 'Status/baris impor tidak valid' using errcode='22023';end if;
  if x->>'status'='valid' then
   if not exists(select 1 from public.items where id=(payload->>'item_id')::uuid and item_type='Persediaan' and is_active)
    or (payload->>'warehouse_id')::uuid is distinct from p_warehouse_id
    or (payload->>'as_of')::date is distinct from p_as_of
    or exists(select 1 from public.items where id=(payload->>'item_id')::uuid and track_expiry and nullif(payload->>'exp_date','') is null) then
    raise exception 'Pemetaan barang/gudang/tanggal tidak valid' using errcode='22023';end if;
   sources:=payload->'source_values';row_source:=0;row_qty:=0;
   if jsonb_typeof(sources) is distinct from 'array' or jsonb_array_length(sources)=0 then
    raise exception 'Bukti nilai sumber diperlukan' using errcode='22023';end if;
   for v in select value from jsonb_array_elements(sources) loop
    if length(v->>'qty')>80 or length(v->>'unit_cost')>80 or length(v->>'factor')>80 then
     raise exception 'Presisi sumber terlalu panjang' using errcode='22023';end if;
    qty:=(v->>'qty')::numeric;cost:=(v->>'unit_cost')::numeric;source_factor:=(v->>'factor')::numeric;
    if qty is null or cost is null or source_factor is null or qty<=0 or qty>1000000000 or cost<0 or cost>1000000000000 or source_factor<=0 or source_factor>1000000000
     or qty::text in ('NaN','Infinity','-Infinity') or cost::text in ('NaN','Infinity','-Infinity') or source_factor::text in ('NaN','Infinity','-Infinity') then
     raise exception 'Nilai sumber tidak valid' using errcode='22023';end if;
    select count(distinct f) into conversion_count from (
      select 1::numeric f from public.items where id=(payload->>'item_id')::uuid and lower(btrim(unit))=lower(btrim(v->>'unit'))
      union all
      select u.factor f from public.item_units u where u.item_id=(payload->>'item_id')::uuid and lower(btrim(u.unit))=lower(btrim(v->>'unit'))
    ) conversions;
    if conversion_count<>1 then raise exception 'Konversi satuan ambigu atau tidak tersedia' using errcode='22023';end if;
    if not exists(select 1 from public.items i where i.id=(payload->>'item_id')::uuid and
      ((lower(btrim(i.unit))=lower(btrim(v->>'unit')) and source_factor=1) or
       exists(select 1 from public.item_units u where u.item_id=i.id and lower(btrim(u.unit))=lower(btrim(v->>'unit')) and u.factor=source_factor))) then
     raise exception 'Konversi satuan tidak cocok dengan master' using errcode='22023';end if;
    row_source:=row_source+qty*cost;row_qty:=row_qty+qty*source_factor;
   end loop;
   if row_qty>1000000000 then raise exception 'Qty dasar terlalu besar' using errcode='22023';end if;
   -- Explicit 60-decimal working rate; strict also requires exact source equality.
   rate:=trunc(row_source::numeric(200,100)/row_qty,60);
   if rate is null or rate<0 or rate>1000000000000 or rate::text in ('NaN','Infinity','-Infinity') then
    raise exception 'HPP dasar tidak valid' using errcode='22023';end if;
   payload:=payload||jsonb_build_object('base_qty',row_qty::text,'base_unit_cost',rate::text,
    'source_value',row_source::text,'original_base_unit_cost',rate::text,'normalization_policy',p_policy);
   source_value:=source_value+row_source;posted_value:=posted_value+row_qty*rate;total_qty:=total_qty+row_qty;n:=n+1;
  elsif x->>'status'='skipped' then skipped:=skipped+1;else rejected:=rejected+1;end if;
  prepared:=prepared||jsonb_build_array(x||jsonb_build_object('payload',payload));
 end loop;
 if n=0 or source_value<=0 or source_value>1000000000000 then
  raise exception 'Tidak ada saldo bernilai positif yang siap disimpan' using errcode='22023';end if;
 target:=case when p_policy='HALF_UP_BATCH_V1' then round(source_value,2) else posted_value end;
 if target<=0 or target<>round(target,2) or (p_policy='STRICT' and posted_value<>source_value) then
  raise exception 'Nilai sumber belum tepat dua desimal. Pilih normalisasi eksplisit atau perbaiki sumber.' using errcode='22023';end if;
 residual:=target-posted_value;
 if p_policy='HALF_UP_BATCH_V1' and residual<>0 then
  -- Only allocate to the first eligible row. Exact equality is mandatory:
  -- e.g. 1/3 cannot be represented by a finite decimal stock-layer rate.
  for x in select value from jsonb_array_elements(prepared) loop
   payload:=x->'payload';
   if allocated is null and x->>'status'='valid' then
    qty:=(payload->>'base_qty')::numeric;rate:=(payload->>'base_unit_cost')::numeric;
    candidate:=rate+(residual::numeric(200,100)/qty)::numeric(200,100);
    if candidate>=0 and candidate<=1000000000000 and qty*candidate=qty*rate+residual then
     adjustment:=candidate-rate;allocated:=(x->>'source_row')::int;
     payload:=payload||jsonb_build_object('base_unit_cost',candidate::text,'rate_adjustment',adjustment::text);
    end if;
   end if;
   adjusted:=adjusted||jsonb_build_array(x||jsonb_build_object('payload',payload));
  end loop;
  if allocated is null then raise exception 'Residu tidak dapat direpresentasikan tepat pada HPP layer. Perbaiki nilai sumber.' using errcode='22023';end if;
  prepared:=adjusted;
 end if;
 select sum((a#>>'{payload,base_qty}')::numeric*(a#>>'{payload,base_unit_cost}')::numeric) into posted_value
 from jsonb_array_elements(prepared) a where a->>'status'='valid';
 if posted_value<>target then raise exception 'Normalisasi tidak rekonsiliasi' using errcode='22023';end if;
 insert into public.import_runs(kind,source_name,source_hash,branch_id,warehouse_id,as_of_date,created_by,summary)
 values('initial_stock',p_source_name,p_source_hash,p_branch_id,p_warehouse_id,p_as_of,auth.uid(),
 jsonb_build_object('valid',n,'skipped',skipped,'rejected',rejected,'source_qty',total_qty,'source_value',posted_value,
 'valuation',jsonb_build_object('policy',p_policy,'source_value',source_value::text,'posted_value',posted_value::text,
 'residual',(posted_value-source_value)::text,'allocated_source_row',allocated,'rate_adjustment',adjustment::text,
 'control','computed_from_source_not_authoritative')))
 returning id into run_id;
 insert into public.import_run_rows(run_id,source_row,source_code,status,reason,payload)
 select run_id,(a->>'source_row')::int,a->>'source_code',a->>'status',a->>'reason',a->'payload' from jsonb_array_elements(prepared) a;
 return run_id;
end $$;
revoke all on function public.prepare_accurate_initial_stock(text,text,uuid,uuid,date,jsonb,text) from public,anon;
grant execute on function public.prepare_accurate_initial_stock(text,text,uuid,uuid,date,jsonb,text) to authenticated;
