-- Preserve future FIFO precision; historical rounded amounts are not reconstructed.
alter table public.production_orders alter column nilai_bahan type numeric;
alter table public.production_order_items alter column hpp type numeric;
create table public.production_atomic_postings (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in('start','finish')),
 order_id uuid not null references public.production_orders(id), actor_id uuid not null references public.profiles(id),
 request_key text not null, payload jsonb not null, source_snapshot jsonb not null,
 receipt jsonb not null, unique(kind,order_id),unique(actor_id,kind,request_key)
);
alter table public.production_atomic_postings enable row level security;
revoke all on public.production_atomic_postings from public,anon,authenticated,service_role;

create function public.production_posting_access(p_wh uuid) returns uuid
language plpgsql security definer set search_path='' as $$declare branch uuid;begin
 if auth.uid() is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'Akses produksi ditolak' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','ADMIN') for share;
 if not found then raise exception 'Produksi hanya tersedia untuk OWNER/ADMIN aktif' using errcode='42501';end if;
 select branch_id into branch from public.warehouses where id=p_wh and is_active for share;
 if not found or not public.user_can_access_branch(branch) then raise exception 'Gudang produksi tidak dapat diakses' using errcode='42501';end if;
 perform 1 from public.branches where id=branch and is_active for share;
 if not found then raise exception 'Cabang produksi tidak aktif' using errcode='42501';end if;
 perform public.stock_document_access(branch,'pos');return branch;
end$$;
revoke all on function public.production_posting_access(uuid) from public,anon,authenticated,service_role;

create function public.production_atomic_number(p_date date) returns text
language plpgsql security definer set search_path='' as $$declare prefix text;digits int;seq bigint;begin
 select pola,digit into prefix,digits from public.document_numbering where jenis='PRD';
 prefix:=coalesce(prefix,'PRD.{YYYY}.{MM}.');digits:=coalesce(digits,5);
 prefix:=replace(replace(replace(replace(prefix,'{YYYY}',to_char(p_date,'YYYY')),'{YY}',to_char(p_date,'YY')),'{MM}',to_char(p_date,'MM')),'{DD}',to_char(p_date,'DD'));
 if digits not between 1 and 8 or length(prefix)+digits>30 then raise exception 'Format nomor produksi tidak valid';end if;
 perform pg_advisory_xact_lock(hashtext('vetos:production-number:'||prefix)::bigint);
 select coalesce(max(substring(no_produksi from length(prefix)+1 for digits)::bigint),0)+1 into seq from public.production_orders where left(no_produksi,length(prefix))=prefix and substring(no_produksi from length(prefix)+1 for digits)~'^[0-9]+$';
 if length(seq::text)>digits then raise exception 'Urutan nomor produksi penuh';end if;
 return prefix||lpad(seq::text,digits,'0');end$$;
revoke all on function public.production_atomic_number(date) from public,anon,authenticated,service_role;

create function public.production_atomic_journal(p_date date,p_branch uuid,p_ref text,p_description text,p_lines jsonb) returns uuid
language plpgsql security definer set search_path='' as $$declare journal uuid;begin
 perform a.id from public.coa_accounts a where a.code in(select x->>'code' from jsonb_array_elements(p_lines)x) order by a.id for share;
 perform public.sales_write_journal(p_date,p_branch,'produksi',p_ref,p_description,p_lines);
 select id into strict journal from public.journal_entries where source='produksi' and source_ref=p_ref and deskripsi=p_description;
 perform public.wholesale_assert_journal(journal,'produksi',p_ref,p_date,p_branch,p_lines);return journal;end$$;
revoke all on function public.production_atomic_journal(date,uuid,text,text,jsonb) from public,anon,authenticated,service_role;

create function public.production_assert_finite_stock(p_wh uuid,p_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.stock where warehouse_id=p_wh and item_id=any(p_ids) and qty::text in('NaN','Infinity','-Infinity'))
 or exists(select 1 from public.stock_layers where warehouse_id=p_wh and item_id=any(p_ids) and (qty_in::text in('NaN','Infinity','-Infinity') or qty_left::text in('NaN','Infinity','-Infinity') or unit_cost::text in('NaN','Infinity','-Infinity') or qty_in<0 or qty_left<0 or unit_cost<0)) then
  raise exception 'Saldo/lapisan produksi tidak valid; rekonsiliasi sumber sebelum posting';
 end if;end$$;
revoke all on function public.production_assert_finite_stock(uuid,uuid[]) from public,anon,authenticated,service_role;

create function public.post_production_atomic(p_kind text,p_request_key text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare wh uuid;branch uuid;dt date;v_qty numeric;payload jsonb;receipt jsonb;proof public.production_atomic_postings%rowtype;
 doc public.production_orders%rowtype;recipe public.production_recipes%rowtype;material jsonb;line record;ids uuid[];
 cost record;total numeric:=0;journal uuid;lines jsonb;unit_cost numeric;quantum numeric;last_cost numeric;before_qty numeric;
 oid uuid;ref text;output_id uuid;start_proof public.production_atomic_postings%rowtype;average boolean;
begin
 if p_kind is null or p_kind not in('start','finish') or p_request_key is null or p_request_key !~ '^[A-Za-z0-9._:-]{1,120}$' or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Permintaan produksi tidak valid';end if;
 average:=public.inventory_is_average();
 -- Future average production needs its separate valuation/variance contract;
 -- never pretend exact FIFO proof establishes rounded average reconciliation.
 begin
  dt:=(p_input->>case when p_kind='start' then 'tanggal' else 'tanggal_selesai' end)::date;
  v_qty:=(p_input->>case when p_kind='start' then 'batch' else 'qty_jadi' end)::numeric;
  if dt is null or not isfinite(dt) or v_qty is null or v_qty<=0 or v_qty>1e9 or v_qty::text in('NaN','Infinity','-Infinity') or length(v_qty::text)>120 then raise exception 'Tanggal/jumlah produksi tidak valid';end if;
  v_qty:=trim_scale(v_qty);
  if p_kind='start' then
   wh:=(p_input->>'warehouse_id')::uuid;
   output_id:=(p_input->>'recipe_id')::uuid;
   payload:=jsonb_build_object('recipe_id',output_id,'warehouse_id',wh,'batch',v_qty,'tanggal',dt,'catatan',nullif(btrim(p_input->>'catatan'),''));
  else
   oid:=(p_input->>'id')::uuid;
   payload:=jsonb_build_object('id',oid,'qty_jadi',v_qty,'tanggal_selesai',dt);
  end if;
 exception when invalid_text_representation or datetime_field_overflow then raise exception 'Tanggal, identitas atau jumlah produksi tidak valid';end;
 if p_kind='start' then
  branch:=public.production_posting_access(wh);
  perform pg_advisory_xact_lock(hashtext('vetos:production-request:'||auth.uid()::text||':'||p_request_key)::bigint);
  select * into proof from public.production_atomic_postings where actor_id=auth.uid() and kind='start' and request_key=p_request_key;
  if found then
   if proof.payload is distinct from payload then raise exception 'Identitas produksi sudah digunakan dengan isian berbeda. Periksa dokumen asal';end if;
   return proof.receipt||jsonb_build_object('already_posted',true);
  end if;
 else
  select * into doc from public.production_orders where id=oid for update;
  if not found then raise exception 'Produksi tidak ditemukan atau tidak dapat diakses' using errcode='42501';end if;
  wh:=doc.warehouse_id;branch:=public.production_posting_access(wh);
  select * into proof from public.production_atomic_postings where order_id=oid and kind='finish';
  if found then
   if proof.payload is distinct from payload then raise exception 'Produksi sudah selesai dengan jumlah atau tanggal berbeda. Tidak ada penerimaan ulang';end if;
   return proof.receipt||jsonb_build_object('already_posted',true);
  end if;
  if doc.status<>'berjalan' then raise exception 'Produksi tidak berjalan; periksa hasil asal';end if;
  select * into start_proof from public.production_atomic_postings where order_id=oid and kind='start';
  if not found then raise exception 'Produksi lama belum memiliki bukti atomik. Rekonsiliasi bahan, WIP dan jurnal sebelum penyelesaian';end if;
  if to_jsonb(doc)-array['status','qty_jadi','tanggal_selesai'] is distinct from (start_proof.source_snapshot->'order')-array['status','qty_jadi','tanggal_selesai']
   or (select jsonb_agg(to_jsonb(x) order by x.id) from public.production_order_items x where order_id=oid) is distinct from start_proof.source_snapshot->'lines' then raise exception 'Sumber produksi berubah; rekonsiliasi diperlukan';end if;
  if dt<doc.tanggal then raise exception 'Tanggal selesai mendahului bahan keluar';end if;
 end if;
 if average then raise exception 'Produksi ini memerlukan rekonsiliasi metode average tersendiri; tidak ada posting yang dilakukan';end if;
 perform 1 from public.accounting_locks where id for share;
 if not found then raise exception 'Status tutup buku tidak tersedia';end if;
 perform public.purchase_payment_period(dt,dt);
 if p_kind='start' then
  select * into recipe from public.production_recipes where id=output_id and is_active for share;
  if not found then raise exception 'Resep produksi tidak aktif atau tidak tersedia';end if;
  if recipe.output_qty<=0 or recipe.output_qty::text in('NaN','Infinity','-Infinity') then raise exception 'Hasil resep tidak valid';end if;
  perform 1 from public.production_recipe_items where recipe_id=recipe.id order by item_id for share;
  select jsonb_agg(jsonb_build_object('item_id',r.item_id,'qty',r.qty*v_qty,'nama',i.name) order by r.item_id) into material from public.production_recipe_items r left join public.items i on i.id=r.item_id where r.recipe_id=recipe.id;
  if material is null or jsonb_array_length(material)=0 then raise exception 'Resep belum memiliki bahan';end if;
  select array_agg((x->>'item_id')::uuid order by x->>'item_id') into ids from jsonb_array_elements(material)x;
  if recipe.item_id=any(ids) then raise exception 'Barang jadi tidak boleh menjadi bahannya sendiri';end if;
  ids:=array_append(ids,recipe.item_id);
  perform 1 from public.items where id=any(ids) order by id for share;
  if (select count(*) from public.items where id=any(ids) and is_active and coalesce(item_type,'Persediaan')='Persediaan')<>cardinality(ids) then raise exception 'Barang produksi harus persediaan aktif';end if;
  insert into public.stock(warehouse_id,item_id,qty) select wh,x,0 from unnest(ids)x order by x on conflict(warehouse_id,item_id) do nothing;
  perform 1 from public.stock where warehouse_id=wh and item_id=any(ids) order by item_id for update;
  perform public.production_assert_finite_stock(wh,ids);
  for line in select * from jsonb_to_recordset(material) as x(item_id uuid,qty numeric,nama text) order by item_id loop
   if line.qty is null or line.qty<=0 or line.qty>1e9 or line.qty::text in('NaN','Infinity','-Infinity') or (select s.qty from public.stock s where warehouse_id=wh and item_id=line.item_id)<line.qty then raise exception 'Stok bahan tidak cukup atau jumlah tidak valid';end if;
   if (select s.qty from public.stock s where warehouse_id=wh and item_id=line.item_id) is distinct from (select coalesce(sum(qty_left),0) from public.stock_layers where warehouse_id=wh and item_id=line.item_id) then raise exception 'Stok/lapisan bahan tidak konsisten';end if;
  end loop;
  oid:=gen_random_uuid();ref:=public.production_atomic_number(dt);
  insert into public.production_orders(id,no_produksi,recipe_id,warehouse_id,batch,tanggal,catatan,created_by) values(oid,ref,recipe.id,wh,v_qty,dt,payload->>'catatan',auth.uid());
  for line in select * from jsonb_to_recordset(material) as x(item_id uuid,qty numeric,nama text) order by item_id loop
   select * into cost from public.stock_out_fifo(wh,line.item_id,line.qty,'produksi',ref,dt);
   if cost.cost is null or cost.cost<0 or cost.cost::text in('NaN','Infinity','-Infinity') or cost.shortfall<>0 then raise exception 'Bukti biaya FIFO bahan tidak lengkap';end if;
   total:=total+cost.cost;
   insert into public.production_order_items(order_id,item_id,nama,qty,hpp) values(oid,line.item_id,line.nama,line.qty,cost.cost);
  end loop;
  update public.production_orders set nilai_bahan=total where id=oid returning * into doc;
  if total>0 then journal:=public.production_atomic_journal(dt,branch,ref,'Bahan keluar produksi '||ref||' ('||recipe.nama||')',jsonb_build_array(jsonb_build_object('code','1302','debit',total,'credit',0),jsonb_build_object('code','1301','debit',0,'credit',total)));end if;
  receipt:=jsonb_build_object('order_id',oid,'no_produksi',ref,'kind',p_kind,'tanggal',dt,'value',total,'journal_id',journal,'already_posted',false);
  insert into public.production_atomic_postings(kind,order_id,actor_id,request_key,payload,source_snapshot,receipt) values('start',oid,auth.uid(),p_request_key,payload,jsonb_build_object('order',to_jsonb(doc),'lines',(select jsonb_agg(to_jsonb(x) order by x.id) from public.production_order_items x where order_id=oid),'recipe',to_jsonb(recipe),'output_id',recipe.item_id,'output_name',(select name from public.items where id=recipe.item_id),'output_unit',(select unit from public.items where id=recipe.item_id),'planned_qty',recipe.output_qty*v_qty,'material',material),receipt);
 else
  total:=doc.nilai_bahan;ref:=doc.no_produksi;output_id:=(start_proof.source_snapshot->>'output_id')::uuid;
  if total is null or total<0 or total::text in('NaN','Infinity','-Infinity') then raise exception 'Nilai WIP produksi tidak valid';end if;
  if total>0 then perform public.wholesale_assert_journal((start_proof.receipt->>'journal_id')::uuid,'produksi',ref,doc.tanggal,branch,jsonb_build_array(jsonb_build_object('code','1302','debit',total,'credit',0),jsonb_build_object('code','1301','debit',0,'credit',total)));end if;
  perform 1 from public.items where id=output_id and is_active and coalesce(item_type,'Persediaan')='Persediaan' and unit is not distinct from start_proof.source_snapshot->>'output_unit' for share;
  if not found then raise exception 'Barang jadi tidak tersedia sebagai persediaan aktif';end if;
  insert into public.stock(warehouse_id,item_id,qty) values(wh,output_id,0) on conflict(warehouse_id,item_id) do nothing;
  select s.qty into before_qty from public.stock s where warehouse_id=wh and item_id=output_id for update;
  perform public.production_assert_finite_stock(wh,array[output_id]);
  if greatest(before_qty,0) is distinct from (select coalesce(sum(qty_left),0) from public.stock_layers where warehouse_id=wh and item_id=output_id) then raise exception 'Stok/lapisan barang jadi tidak konsisten';end if;
  -- A finite decimal quantum gives an exact final residual unit cost. Normalize
  -- quantity scale first so 3, 3.0 and 3.000 have the same allocation.
  quantum:=('1e-'||scale(v_qty))::numeric;
  unit_cost:=trunc(total::numeric(100,40)/v_qty,30);
  last_cost:=(total-(v_qty-quantum)*unit_cost)/quantum;
  if unit_cost<0 or last_cost<0 or unit_cost>1e18 or last_cost>1e18 then raise exception 'Biaya satuan hasil di luar kapasitas; seluruh penyelesaian dibatalkan';end if;
  if v_qty>quantum then perform public.stock_in_fifo(wh,output_id,v_qty-quantum,unit_cost,'produksi',ref,dt,null);end if;
  perform public.stock_in_fifo(wh,output_id,quantum,last_cost,'produksi',ref,dt,null);
  if (select s.qty from public.stock s where warehouse_id=wh and item_id=output_id) is distinct from before_qty+v_qty
   or (select coalesce(sum(m.qty),0) from public.stock_moves m where source='produksi' and source_ref=ref and item_id=output_id and m.qty>0) is distinct from v_qty
   or (select coalesce(sum(m.qty*m.unit_cost),0) from public.stock_moves m where source='produksi' and source_ref=ref and item_id=output_id and m.qty>0) is distinct from total then raise exception 'Rekonsiliasi barang jadi/WIP gagal';end if;
  if total>0 then journal:=public.production_atomic_journal(dt,branch,ref,'Barang jadi masuk produksi '||ref||' ('||(start_proof.source_snapshot#>>'{recipe,nama}')||')',jsonb_build_array(jsonb_build_object('code','1301','debit',total,'credit',0),jsonb_build_object('code','1302','debit',0,'credit',total)));end if;
  receipt:=jsonb_build_object('order_id',oid,'no_produksi',ref,'kind',p_kind,'tanggal',dt,'qty_jadi',v_qty,'value',total,'journal_id',journal,'already_posted',false);
  insert into public.production_atomic_postings(kind,order_id,actor_id,request_key,payload,source_snapshot,receipt) values('finish',oid,auth.uid(),p_request_key,payload,jsonb_build_object('start_posting_id',start_proof.id,'base_unit_cost',unit_cost,'residual_qty',quantum,'residual_unit_cost',last_cost,'output_qty_before',before_qty),receipt);
  update public.production_orders set status='selesai',qty_jadi=v_qty,tanggal_selesai=dt where id=oid;
 end if;
 return receipt;
end$$;
revoke all on function public.post_production_atomic(text,text,jsonb) from public,anon,service_role;
grant execute on function public.post_production_atomic(text,text,jsonb) to authenticated;

create function public.get_production_atomic_result(p_kind text,p_request_key text,p_order_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$declare proof public.production_atomic_postings%rowtype;wh uuid;begin
 if p_kind is null or p_kind not in('start','finish') or auth.uid() is null then raise exception 'Permintaan pemulihan tidak valid' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','ADMIN') for share;
 if not found then raise exception 'Akses pemeriksaan produksi ditolak' using errcode='42501';end if;
 select * into proof from public.production_atomic_postings where kind=p_kind and ((p_kind='start' and actor_id=auth.uid() and request_key=p_request_key) or (p_kind='finish' and order_id=p_order_id));
 if not found then return null;end if;
 select warehouse_id into wh from public.production_orders where id=proof.order_id;
 perform public.production_posting_access(wh);return proof.receipt||jsonb_build_object('already_posted',true);end$$;
revoke all on function public.get_production_atomic_result(text,text,uuid) from public,anon,service_role;
grant execute on function public.get_production_atomic_result(text,text,uuid) to authenticated;

create function public.guard_production_atomic_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare oldrow jsonb:='{}';newrow jsonb:='{}';refs uuid[];parent record;completion public.production_atomic_postings%rowtype;
begin
 if tg_op<>'INSERT' then oldrow:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then newrow:=to_jsonb(new);end if;
 if tg_table_name='production_orders' then refs:=array[nullif(oldrow->>'id','')::uuid,nullif(newrow->>'id','')::uuid];
 else refs:=array[nullif(oldrow->>'order_id','')::uuid,nullif(newrow->>'order_id','')::uuid];end if;
 for parent in select id from public.production_orders where id=any(refs) order by id for update loop
  if exists(select 1 from public.production_atomic_postings where order_id=parent.id) then
   if tg_table_name='production_orders' and tg_op='UPDATE' and oldrow->>'status'='berjalan' and newrow->>'status'='selesai'
    and oldrow-array['status','qty_jadi','tanggal_selesai'] is not distinct from newrow-array['status','qty_jadi','tanggal_selesai'] then
    select * into completion from public.production_atomic_postings where order_id=parent.id and kind='finish';
    if found and (newrow->>'qty_jadi')::numeric=(completion.payload->>'qty_jadi')::numeric and (newrow->>'tanggal_selesai')::date=(completion.payload->>'tanggal_selesai')::date then continue;end if;
   end if;
   raise exception 'Sumber produksi atomik dilindungi; periksa dokumen dan jurnal asal';
  end if;
 end loop;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_production_atomic_source() from public,anon,authenticated,service_role;
create trigger production_atomic_order_fence before update or delete on public.production_orders for each row execute function public.guard_production_atomic_source();
create trigger production_atomic_line_fence before insert or update or delete on public.production_order_items for each row execute function public.guard_production_atomic_source();

-- View frozen source metadata without granting private receipt-table access.
create function public.read_production_atomic_sources(p_order_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$declare result jsonb:='{}';r record;branch uuid;begin
 if auth.uid() is null or coalesce(auth.role(),'')<>'authenticated' or not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','ADMIN')) then raise exception 'Akses sumber produksi ditolak' using errcode='42501';end if;
 if coalesce(cardinality(p_order_ids),0)>100 then raise exception 'Terlalu banyak produksi';end if;
 for r in select p.order_id,p.source_snapshot,o.warehouse_id from public.production_atomic_postings p join public.production_orders o on o.id=p.order_id where p.kind='start' and p.order_id=any(p_order_ids) loop
  select branch_id into branch from public.warehouses where id=r.warehouse_id;
  if not found or not public.user_can_access_branch(branch) then continue;end if;
  begin perform public.stock_document_access(branch,'pos');exception when insufficient_privilege or raise_exception then continue;end;
  result:=result||jsonb_build_object(r.order_id::text,jsonb_build_object('recipe_name',r.source_snapshot#>>'{recipe,nama}','output_name',r.source_snapshot->>'output_name','unit',r.source_snapshot->>'output_unit','planned_qty',r.source_snapshot->'planned_qty'));
 end loop;return result;end$$;
revoke all on function public.read_production_atomic_sources(uuid[]) from public,anon,service_role;
grant execute on function public.read_production_atomic_sources(uuid[]) to authenticated;

-- Method activation is irreversible. A running FIFO job must finish under the
-- valuation contract that consumed its materials before the method can change.
create function public.guard_running_fifo_production() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if new.method='moving_average' and old.method is distinct from new.method then
  perform pg_advisory_xact_lock(1962072401::bigint);
  if exists(select 1 from public.production_orders o join public.production_atomic_postings p on p.order_id=o.id and p.kind='start' where o.status='berjalan') then
   raise exception 'Produksi FIFO masih berjalan. Selesaikan atau rekonsiliasi WIP sebelum aktivasi average';
  end if;
 end if;return new;end$$;
revoke all on function public.guard_running_fifo_production() from public,anon,authenticated,service_role;
create trigger production_fifo_method_fence before update of method on public.inventory_costing_settings for each row execute function public.guard_running_fifo_production();
