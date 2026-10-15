-- Keep branch isolation: a DC destination is a checked reference, never a grant
-- to its warehouse, stock or transactions. No historical requests are rewritten.
alter table public.stock_requests
 add column request_key uuid unique,
 add column creation_payload jsonb;

create function public.guard_cashier_stock_request_identity() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if current_user='authenticated' and (
  (tg_op='INSERT' and (new.request_key is not null or new.creation_payload is not null))
  or (tg_op='UPDATE' and (new.request_key is distinct from old.request_key or new.creation_payload is distinct from old.creation_payload))
 ) then raise exception 'Identitas pengiriman permintaan tidak dapat diubah'; end if;
 return new;
end $$;
revoke all on function public.guard_cashier_stock_request_identity() from public,anon,authenticated;
create trigger cashier_stock_request_identity_guard before insert or update on public.stock_requests
for each row execute function public.guard_cashier_stock_request_identity();

create function public.create_cashier_stock_request_atomic(
 p_key uuid,p_branch_id uuid,p_to_warehouse_id uuid,p_priority text,p_notes text,p_items jsonb
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 v_existing public.stock_requests%rowtype; v_id uuid; v_payload jsonb; v_lines jsonb:='[]';
 v_row record; v_item public.items%rowtype; v_unit text; v_factor numeric;
 v_prefix text; v_digits integer; v_seq bigint; v_number text;
 v_date date:=(now() at time zone 'Asia/Jakarta')::date;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_active)
  or not public.user_can_access_branch(p_branch_id)
  or not exists(select 1 from public.branches where id=p_branch_id and is_active)
 then raise exception 'Akses permintaan cabang ditolak'; end if;
 perform 1 from public.cashier_shifts where opened_by=auth.uid() and branch_id=p_branch_id and status='open' and shift_type='petshop' for share;
 if not found then raise exception 'Shift kasir belum terbuka untuk cabang ini'; end if;
 if p_key is null or p_priority is null or p_priority not in ('normal','tinggi') or jsonb_typeof(p_items) is distinct from 'array'
  or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>500 then raise exception 'Rincian permintaan tidak valid'; end if;

 -- Bind retries to the caller's submitted intent, before resolving mutable
 -- master snapshots. Exact retries return the committed document unchanged.
 v_payload:=jsonb_build_object('branch',p_branch_id,'destination',p_to_warehouse_id,'priority',p_priority,'notes',nullif(trim(p_notes),''),
  'items',(select jsonb_agg(jsonb_build_object('item_id',x.item_id,'qty_diminta',x.qty_diminta,'satuan',nullif(x.satuan,''),'catatan',nullif(trim(x.catatan),''))
   order by x.item_id,x.qty_diminta,x.satuan,x.catatan) from jsonb_to_recordset(p_items) x(item_id uuid,qty_diminta numeric,satuan text,catatan text)));
 perform pg_advisory_xact_lock(hashtextextended('vetos:cashier-stock-request:'||p_key,0));
 select * into v_existing from public.stock_requests where request_key=p_key;
 if found then
  if v_existing.requested_by is distinct from auth.uid() or v_existing.from_branch_id is distinct from p_branch_id
   or v_existing.creation_payload is distinct from v_payload then raise exception 'Kunci permintaan sudah dipakai dengan rincian berbeda'; end if;
  return v_existing.id;
 end if;

 if not exists(select 1 from public.warehouses w join public.branches b on b.id=w.branch_id
  where w.id=p_to_warehouse_id and w.is_active and b.is_active and w.type<>'TRANSIT' and w.code ilike 'DC%')
 then raise exception 'Gudang tujuan tidak aktif atau bukan gudang DC'; end if;
 for v_row in select * from jsonb_to_recordset(p_items) x(item_id uuid,qty_diminta numeric,satuan text,catatan text) order by item_id loop
  if v_row.item_id is null or v_row.qty_diminta is null or v_row.qty_diminta<=0 or v_row.qty_diminta>1000000000000000000
  then raise exception 'Rincian permintaan tidak valid'; end if;
  select * into v_item from public.items where id=v_row.item_id and is_active and coalesce(item_type,'Persediaan')='Persediaan' for share;
  if not found then raise exception 'Barang bukan persediaan aktif'; end if;
  v_unit:=coalesce(nullif(v_item.unit,''),'pcs'); v_factor:=1;
  if coalesce(nullif(v_row.satuan,''),v_unit)<>v_unit then
   select factor into v_factor from public.item_units where item_id=v_row.item_id and unit=v_row.satuan for share;
   if not found or v_factor is null or v_factor<=0 or v_factor>1000000000000000000 then raise exception 'Satuan permintaan tidak tersedia'; end if;
   v_unit:=v_row.satuan;
  end if;
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('item_id',v_row.item_id,'nama',left(v_item.name,160),'qty_diminta',v_row.qty_diminta,
   'satuan',v_unit,'faktor',v_factor,'catatan',nullif(trim(v_row.catatan),'')));
 end loop;

 -- The sequence is global even when the caller can read only one branch.
 select pola,digit into v_prefix,v_digits from public.document_numbering where jenis='PRM';
 v_prefix:=coalesce(v_prefix,'PRM-{YYYY}{MM}{DD}-'); v_digits:=coalesce(v_digits,4);
 v_prefix:=replace(replace(replace(replace(v_prefix,'{YYYY}',to_char(v_date,'YYYY')),'{YY}',to_char(v_date,'YY')),'{MM}',to_char(v_date,'MM')),'{DD}',to_char(v_date,'DD'));
 if v_digits not between 1 and 8 or length(v_prefix)+v_digits>24 then raise exception 'Format nomor permintaan tidak valid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('vetos:stock-number:PRM'||v_prefix,0));
 select coalesce(max(substring(no_request from length(v_prefix)+1 for v_digits)::bigint),0)+1 into v_seq
  from public.stock_requests where left(no_request,length(v_prefix))=v_prefix
  and substring(no_request from length(v_prefix)+1 for v_digits) ~ '^[0-9]+$';
 if length(v_seq::text)>v_digits then raise exception 'Urutan nomor permintaan penuh'; end if;
 v_number:=v_prefix||lpad(v_seq::text,v_digits,'0');
 insert into public.stock_requests(no_request,from_branch_id,to_warehouse_id,priority,catatan,requested_by,request_key,creation_payload)
 values(v_number,p_branch_id,p_to_warehouse_id,p_priority,nullif(trim(p_notes),''),auth.uid(),p_key,v_payload) returning id into v_id;
 insert into public.stock_request_items(request_id,item_id,nama,qty_diminta,satuan,faktor,catatan)
 select v_id,x.item_id,x.nama,x.qty_diminta,x.satuan,x.faktor,x.catatan
 from jsonb_to_recordset(v_lines) x(item_id uuid,nama text,qty_diminta numeric,satuan text,faktor numeric,catatan text);
 return v_id;
end $$;
revoke all on function public.create_cashier_stock_request_atomic(uuid,uuid,uuid,text,text,jsonb) from public,anon;
grant execute on function public.create_cashier_stock_request_atomic(uuid,uuid,uuid,text,text,jsonb) to authenticated;
