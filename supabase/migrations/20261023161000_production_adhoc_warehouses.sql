-- One-off FIFO jobs. Cross-branch allocation is deliberately not inferred.
alter table public.production_orders alter column recipe_id drop not null;
alter table public.production_orders add column output_item_id uuid references public.items(id) on delete restrict;
alter table public.production_orders add constraint production_recipe_or_output check(recipe_id is not null or output_item_id is not null);
alter table public.production_order_items add column warehouse_id uuid references public.warehouses(id) on delete restrict;

-- A pre-extension proof omits these new nullable columns. NULL and omission are
-- equivalent; non-NULL source changes still differ and the source fence remains.
do $upgrade$declare definition text;old_guard text;new_guard text;begin
 definition:=pg_get_functiondef('public.post_production_atomic(text,text,jsonb)'::regprocedure);
 old_guard:=$old$if to_jsonb(doc)-array['status','qty_jadi','tanggal_selesai'] is distinct from (start_proof.source_snapshot->'order')-array['status','qty_jadi','tanggal_selesai']
   or (select jsonb_agg(to_jsonb(x) order by x.id) from public.production_order_items x where order_id=oid) is distinct from start_proof.source_snapshot->'lines' then$old$;
 new_guard:=$new$if jsonb_strip_nulls(to_jsonb(doc)-array['status','qty_jadi','tanggal_selesai']) is distinct from jsonb_strip_nulls((start_proof.source_snapshot->'order')-array['status','qty_jadi','tanggal_selesai'])
   or jsonb_strip_nulls((select jsonb_agg(to_jsonb(x) order by x.id) from public.production_order_items x where order_id=oid)) is distinct from jsonb_strip_nulls(start_proof.source_snapshot->'lines') then$new$;
 if position(old_guard in definition)=0 then raise exception 'Production core provenance mismatch; stop before extending jobs';end if;
 execute replace(definition,old_guard,new_guard);
end$upgrade$;

create function public.post_production_adhoc_atomic(p_kind text,p_request_key text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare wh uuid;ctx uuid;output_id uuid;dt date;planned numeric;output_factor numeric;unit text;payload jsonb;raw_material jsonb;material jsonb:='[]';snapshot jsonb:='[]';
 average boolean;proof public.production_atomic_postings%rowtype;doc public.production_orders%rowtype;oid uuid;ref text;total numeric:=0;journal uuid;receipt jsonb;
 ids uuid[];pair_ids uuid[];warehouses uuid[];w uuid;line record;u record;cost record;wh_name text;item_name text;base_unit text;qty_base numeric;job_name text;
begin
 if p_kind is distinct from 'start' or p_request_key is null or p_request_key !~ '^[A-Za-z0-9._:-]{1,120}$' or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Permintaan pekerjaan tidak valid';end if;
 average:=public.inventory_is_average();
 begin
  wh:=(p_input->>'warehouse_id')::uuid;ctx:=(p_input->>'branch_id')::uuid;output_id:=(p_input->>'output_item_id')::uuid;
  dt:=(p_input->>'tanggal')::date;planned:=(p_input->>'output_qty')::numeric;unit:=p_input->>'output_unit';job_name:=btrim(p_input->>'nama');
  if wh is null or ctx is null or output_id is null or dt is null or not isfinite(dt) or planned is null or planned<=0 or planned>1e9 or planned::text in('NaN','Infinity','-Infinity') or length(planned::text)>120 or coalesce(length(job_name),0) not between 1 and 120 or coalesce(length(unit),0) not between 1 and 40 or length(coalesce(p_input->>'catatan',''))>2000 then raise exception 'Identitas, nama, tanggal atau jumlah pekerjaan tidak valid';end if;
  if jsonb_typeof(p_input->'bahan') is distinct from 'array' or jsonb_array_length(p_input->'bahan') not between 1 and 100 then raise exception 'Isi 1 sampai 100 bahan pekerjaan';end if;
  select jsonb_agg(jsonb_build_object('item_id',(x->>'item_id')::uuid,'warehouse_id',(x->>'warehouse_id')::uuid,'qty',trim_scale((x->>'qty')::numeric),'satuan',x->>'satuan') order by x->>'warehouse_id',x->>'item_id') into raw_material from jsonb_array_elements(p_input->'bahan')x;
 exception when invalid_text_representation or datetime_field_overflow then raise exception 'Identitas atau jumlah pekerjaan tidak valid';end;
 if exists(select 1 from jsonb_to_recordset(raw_material)x(item_id uuid,warehouse_id uuid,qty numeric,satuan text) where item_id is null or warehouse_id is null or qty is null or qty<=0 or qty>1e9 or qty::text in('NaN','Infinity','-Infinity') or length(qty::text)>120 or coalesce(length(satuan),0) not between 1 and 40) then raise exception 'Bahan, gudang, jumlah atau satuan tidak valid';end if;
 if exists(select 1 from jsonb_to_recordset(raw_material)x(item_id uuid,warehouse_id uuid) group by item_id,warehouse_id having count(*)>1) then raise exception 'Bahan dalam gudang yang sama tidak boleh berulang';end if;
 payload:=jsonb_build_object('mode','adhoc','nama',job_name,'branch_id',ctx,'warehouse_id',wh,'output_item_id',output_id,'output_qty',trim_scale(planned),'output_unit',unit,'tanggal',dt,'catatan',nullif(btrim(p_input->>'catatan'),''),'bahan',raw_material);
 select array_agg(distinct id order by id) into warehouses from (select (x->>'warehouse_id')::uuid id from jsonb_array_elements(raw_material)x union select wh)s;
 foreach w in array warehouses loop
  if public.production_posting_access(w) is distinct from ctx then raise exception 'Gudang bahan, hasil dan konteks harus satu cabang; alokasi lintas cabang belum ditetapkan';end if;
 end loop;
 perform pg_advisory_xact_lock(hashtext('vetos:production-request:'||auth.uid()::text||':'||p_request_key)::bigint);
 select * into proof from public.production_atomic_postings where actor_id=auth.uid() and kind='start' and request_key=p_request_key;
 if found then
  if proof.payload is distinct from payload then raise exception 'Identitas produksi sudah digunakan dengan isian berbeda. Periksa dokumen asal';end if;
  return proof.receipt||jsonb_build_object('already_posted',true);
 end if;
 if average then raise exception 'Pekerjaan FIFO ini memerlukan kontrak average tersendiri; tidak ada posting';end if;
 perform 1 from public.accounting_locks where id for share;if not found then raise exception 'Status tutup buku tidak tersedia';end if;
 perform public.purchase_payment_period(dt,dt);
 select array_agg(distinct id order by id) into ids from (select (x->>'item_id')::uuid id from jsonb_array_elements(raw_material)x union select output_id)s;
 if exists(select 1 from jsonb_array_elements(raw_material)x where (x->>'item_id')::uuid=output_id) then raise exception 'Barang hasil tidak boleh menjadi bahannya sendiri';end if;
 perform 1 from public.items where id=any(ids) order by id for share;
 if (select count(*) from public.items where id=any(ids) and is_active and coalesce(item_type,'Persediaan')='Persediaan')<>cardinality(ids) then raise exception 'Bahan dan hasil harus persediaan aktif';end if;
 select * into u from public.unit_posting_factor(output_id,unit);output_factor:=u.factor;planned:=trim_scale(planned*output_factor);
 if planned<=0 or planned>1e9 or length(planned::text)>120 then raise exception 'Jumlah hasil satuan dasar di luar kapasitas';end if;
 for line in select * from jsonb_to_recordset(raw_material)x(item_id uuid,warehouse_id uuid,qty numeric,satuan text) order by warehouse_id,item_id loop
  select * into u from public.unit_posting_factor(line.item_id,line.satuan);qty_base:=trim_scale(line.qty*u.factor);
  if qty_base<=0 or qty_base>1e9 or length(qty_base::text)>120 then raise exception 'Jumlah bahan satuan dasar di luar kapasitas';end if;
  select name,coalesce(nullif(items.unit,''),'pcs') into item_name,base_unit from public.items where id=line.item_id;
  select name into wh_name from public.warehouses where id=line.warehouse_id;
  material:=material||jsonb_build_array(jsonb_build_object('item_id',line.item_id,'warehouse_id',line.warehouse_id,'warehouse_name',wh_name,'nama',item_name,'qty',qty_base,'unit',base_unit,'submitted_qty',line.qty,'submitted_unit',u.unit,'factor',u.factor));
 end loop;
 insert into public.stock(warehouse_id,item_id,qty) select warehouse_id,item_id,0 from (select distinct x.warehouse_id,x.item_id from jsonb_to_recordset(material)x(warehouse_id uuid,item_id uuid) union select wh,output_id)s order by warehouse_id,item_id on conflict(warehouse_id,item_id) do nothing;
 perform 1 from public.stock s where (s.warehouse_id=wh and s.item_id=output_id) or exists(select 1 from jsonb_to_recordset(material)x(warehouse_id uuid,item_id uuid) where x.warehouse_id=s.warehouse_id and x.item_id=s.item_id) order by s.warehouse_id,s.item_id for update;
 foreach w in array warehouses loop
  select array_agg(distinct id) into pair_ids from (select (x->>'item_id')::uuid id from jsonb_array_elements(material)x where (x->>'warehouse_id')::uuid=w union select output_id where w=wh)s;
  perform public.production_assert_finite_stock(w,pair_ids);
 end loop;
 for line in select * from jsonb_to_recordset(material)x(item_id uuid,warehouse_id uuid,qty numeric) order by warehouse_id,item_id loop
  if (select s.qty from public.stock s where warehouse_id=line.warehouse_id and item_id=line.item_id)<line.qty then raise exception 'Stok bahan tidak cukup';end if;
  if (select s.qty from public.stock s where warehouse_id=line.warehouse_id and item_id=line.item_id) is distinct from (select coalesce(sum(qty_left),0) from public.stock_layers where warehouse_id=line.warehouse_id and item_id=line.item_id) then raise exception 'Stok/lapisan bahan tidak konsisten';end if;
 end loop;
 oid:=gen_random_uuid();ref:=public.production_atomic_number(dt);
 insert into public.production_orders(id,no_produksi,recipe_id,output_item_id,warehouse_id,batch,tanggal,catatan,created_by) values(oid,ref,null,output_id,wh,1,dt,payload->>'catatan',auth.uid());
 for line in select value from jsonb_array_elements(material) order by value->>'warehouse_id',value->>'item_id' loop
  select * into cost from public.stock_out_fifo((line.value->>'warehouse_id')::uuid,(line.value->>'item_id')::uuid,(line.value->>'qty')::numeric,'produksi',ref,dt);
  if cost.cost is null or cost.cost<0 or cost.cost::text in('NaN','Infinity','-Infinity') or cost.shortfall<>0 then raise exception 'Bukti biaya FIFO bahan tidak lengkap';end if;
  total:=total+cost.cost;
  insert into public.production_order_items(order_id,item_id,warehouse_id,nama,qty,hpp) values(oid,(line.value->>'item_id')::uuid,(line.value->>'warehouse_id')::uuid,line.value->>'nama',(line.value->>'qty')::numeric,cost.cost);
  snapshot:=snapshot||jsonb_build_array(line.value||jsonb_build_object('cost',cost.cost));
 end loop;
 update public.production_orders set nilai_bahan=total where id=oid returning * into doc;
 if total>0 then journal:=public.production_atomic_journal(dt,ctx,ref,'Bahan keluar pekerjaan '||ref||' ('||job_name||')',jsonb_build_array(jsonb_build_object('code','1302','debit',total,'credit',0),jsonb_build_object('code','1301','debit',0,'credit',total)));end if;
 receipt:=jsonb_build_object('order_id',oid,'no_produksi',ref,'kind','start','tanggal',dt,'value',total,'journal_id',journal,'already_posted',false);
 insert into public.production_atomic_postings(kind,order_id,actor_id,request_key,payload,source_snapshot,receipt) values('start',oid,auth.uid(),p_request_key,payload,jsonb_build_object('mode','adhoc','order',to_jsonb(doc),'lines',(select jsonb_agg(to_jsonb(x) order by x.id) from public.production_order_items x where order_id=oid),'recipe',jsonb_build_object('nama','Ad hoc: '||job_name),'output_id',output_id,'output_name',(select name from public.items where id=output_id),'output_unit',(select i.unit from public.items i where id=output_id),'planned_qty',planned,'material',snapshot),receipt);
 return receipt;
end$$;
revoke all on function public.post_production_adhoc_atomic(text,text,jsonb) from public,anon,service_role;
grant execute on function public.post_production_adhoc_atomic(text,text,jsonb) to authenticated;

-- Same authorization as the core source reader; no private table grants.
create or replace function public.read_production_atomic_sources(p_order_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$declare result jsonb:='{}';r record;branch uuid;begin
 if auth.uid() is null or coalesce(auth.role(),'')<>'authenticated' or not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','ADMIN')) then raise exception 'Akses sumber produksi ditolak' using errcode='42501';end if;
 if coalesce(cardinality(p_order_ids),0)>100 then raise exception 'Terlalu banyak produksi';end if;
 for r in select p.order_id,p.source_snapshot,o.warehouse_id from public.production_atomic_postings p join public.production_orders o on o.id=p.order_id where p.kind='start' and p.order_id=any(p_order_ids) loop
  select branch_id into branch from public.warehouses where id=r.warehouse_id;
  if not found or not public.user_can_access_branch(branch) then continue;end if;
  begin perform public.stock_document_access(branch,'pos');exception when insufficient_privilege or raise_exception then continue;end;
  result:=result||jsonb_build_object(r.order_id::text,jsonb_build_object('recipe_name',r.source_snapshot#>>'{recipe,nama}','output_name',r.source_snapshot->>'output_name','unit',r.source_snapshot->>'output_unit','planned_qty',r.source_snapshot->'planned_qty','materials',coalesce(r.source_snapshot->'material','[]'::jsonb)));
 end loop;return result;end$$;
