-- Base stock quantities are unchanged; selected unit is an immutable document snapshot.
alter table public.stock_transfer_items add column selected_qty numeric, add column satuan text, add column faktor numeric;
alter table public.stock_receipts add column receipt_payload jsonb;
alter table public.stock_transfers add column request_key uuid unique, add column posting_payload jsonb;

create function public.stock_document_access(p_branch uuid,p_module text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null or not exists(select 1 from profiles p where p.id=auth.uid() and p.is_active and (
 p.role='OWNER' or exists(select 1 from role_modules m where m.role=p.role and m.module_id=p_module)
 or (not exists(select 1 from role_modules m where m.role=p.role) and (p.role in ('ADMIN','DOCTOR') or (p.role='STAFF' and p_module='klinik')))))
 or not public.user_can_access_branch(p_branch) then raise exception 'Akses transaksi stok ditolak'; end if;
 if p_module='klinik' and not exists(select 1 from cashier_shifts where opened_by=auth.uid() and branch_id=p_branch and status='open' and shift_type='klinik') then raise exception 'Shift klinik penerimaan belum terbuka'; end if;
end $$;
revoke all on function public.stock_document_access(uuid,text) from public,anon,authenticated;

-- Internal primitive: exact source ceiling under the same aggregate lock as FIFO.
create function public.stock_transfer_fifo_exact(p_from uuid,p_to uuid,p_item uuid,p_qty numeric,p_source text,p_ref text,p_date date) returns void
language plpgsql security definer set search_path=public as $$
declare v_result record; v_take jsonb; v_wh uuid; v_qty numeric;
begin
 if p_from=p_to or p_qty is null or p_qty<=0 or p_qty>1000000000000000000 then raise exception 'Qty/gudang pemindahan tidak valid'; end if;
 if not exists(select 1 from items where id=p_item and is_active and (item_type is null or item_type='Persediaan')) then raise exception 'Barang bukan persediaan aktif'; end if;
 for v_wh in select x from unnest(array[p_from,p_to]) x order by x loop
  insert into stock(warehouse_id,item_id,qty) values(v_wh,p_item,0) on conflict(warehouse_id,item_id) do nothing;
  perform 1 from stock where warehouse_id=v_wh and item_id=p_item for update;
 end loop;
 select qty into v_qty from stock where warehouse_id=p_from and item_id=p_item;
 if v_qty<p_qty then raise exception 'Stok gudang asal tidak cukup'; end if;
 select * into v_result from stock_out_fifo(p_from,p_item,p_qty,p_source,p_ref,p_date);
 for v_take in select value from jsonb_array_elements(v_result.takes) loop
  perform stock_in_fifo(p_to,p_item,(v_take->>'qty')::numeric,(v_take->>'unit_cost')::numeric,p_source,p_ref,p_date,(v_take->>'exp_date')::date);
 end loop;
 if v_result.shortfall>0 then perform stock_in_fifo(p_to,p_item,v_result.shortfall,v_result.harga_beli,p_source,p_ref,p_date,null); end if;
end $$;
revoke all on function public.stock_transfer_fifo_exact(uuid,uuid,uuid,numeric,text,text,date) from public,anon,authenticated;

create function public.stock_document_number(p_kind text,p_date date) returns text
language plpgsql security definer set search_path=public as $$
declare v_prefix text; v_digits integer; v_seq bigint; v_table text; v_col text;
begin
 if p_kind not in ('IT','TRM') then raise exception 'Seri tidak valid'; end if;
 select pola,digit into v_prefix,v_digits from document_numbering where jenis=p_kind;
 v_prefix:=coalesce(v_prefix,case when p_kind='IT' then 'IT.{YYYY}.{MM}.' else 'TRM-{YY}{MM}{DD}-' end);
 v_digits:=coalesce(v_digits,case when p_kind='IT' then 5 else 3 end);
 v_prefix:=replace(replace(replace(replace(v_prefix,'{YYYY}',to_char(p_date,'YYYY')),'{YY}',to_char(p_date,'YY')),'{MM}',to_char(p_date,'MM')),'{DD}',to_char(p_date,'DD'));
 if v_digits not between 1 and 8 or length(v_prefix)+v_digits>(case when p_kind='IT' then 30 else 24 end) then raise exception 'Format nomor tidak valid'; end if;
 perform pg_advisory_xact_lock(hashtext('vetos:stock-number:'||p_kind||v_prefix)::bigint);
 v_table:=case when p_kind='IT' then 'stock_transfers' else 'stock_receipts' end;
 v_col:=case when p_kind='IT' then 'no_pemindahan' else 'receipt_number' end;
 execute format('select coalesce(max(substring(%I from $1 for $2)::bigint),0)+1 from public.%I where left(%I,$3)=$4 and substring(%I from $1 for $2) ~ ''^[0-9]+$''',v_col,v_table,v_col,v_col) into v_seq using length(v_prefix)+1,v_digits,length(v_prefix),v_prefix;
 if length(v_seq::text)>v_digits then raise exception 'Urutan nomor penuh'; end if;
 return v_prefix||lpad(v_seq::text,v_digits,'0');
end $$;
revoke all on function public.stock_document_number(text,date) from public,anon,authenticated;

create function public.post_stock_transfer_atomic(p_key uuid,p_source uuid,p_from uuid,p_to uuid,p_date date,p_notes text,p_items jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_doc stock_transfers%rowtype; v_source stock_transfers%rowtype; v_from warehouses%rowtype; v_to warehouses%rowtype; v_transit uuid; v_id uuid:=gen_random_uuid(); v_number text; v_row record; v_unit text; v_factor numeric; v_remaining numeric; v_proses transfer_proses; v_total numeric; v_received numeric; v_payload jsonb;
begin
 if p_key is null or p_date is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Data pemindahan tidak valid'; end if;
 if p_source is not null then
  select * into v_source from stock_transfers where id=p_source for update;
  if not found or v_source.proses<>'Kirim Barang' or v_source.status='Dibatalkan' then raise exception 'Dokumen kirim tidak tersedia'; end if;
  p_from:=v_source.from_warehouse_id; p_to:=v_source.to_warehouse_id;
 end if;
 select * into v_from from warehouses where id=p_from and is_active and type<>'TRANSIT';
 if not found then raise exception 'Gudang asal tidak aktif'; end if;
 select * into v_to from warehouses where id=p_to and is_active and type<>'TRANSIT';
 if not found or p_from=p_to then raise exception 'Gudang tujuan tidak valid'; end if;
 perform stock_document_access(case when p_source is null then v_from.branch_id else v_to.branch_id end,'pos');
 v_payload:=jsonb_build_object('source',p_source,'from',p_from,'to',p_to,'date',p_date,'notes',nullif(trim(p_notes),''),'items',(select jsonb_agg(jsonb_build_object('item_id',x.item_id,'qty',x.qty,'satuan',nullif(x.satuan,'')) order by x.item_id) from jsonb_to_recordset(p_items) x(item_id uuid,qty numeric,satuan text)));
 perform pg_advisory_xact_lock(hashtext('vetos:stock-transfer:'||p_key)::bigint);
 select * into v_doc from stock_transfers where request_key=p_key;
 if found then
  if v_doc.posting_payload is distinct from v_payload or v_doc.created_by is distinct from auth.uid() or v_doc.source_transfer_id is distinct from p_source or v_doc.from_warehouse_id<>p_from or v_doc.to_warehouse_id<>p_to then raise exception 'Kunci pengiriman sudah dipakai'; end if;
  return v_doc.id;
 end if;
 if (select count(*) from jsonb_to_recordset(p_items) as x(item_id uuid))<>(select count(distinct item_id) from jsonb_to_recordset(p_items) as x(item_id uuid)) then raise exception 'Barang duplikat'; end if;
 -- ponytail: transfer setup and numbering serialize posts; use per-series locks if throughput warrants it.
 perform pg_advisory_xact_lock(hashtext('vetos:transit-warehouse')::bigint);
 select id into v_transit from warehouses where type='TRANSIT' and is_active order by id limit 1;
 if v_transit is null then insert into warehouses(branch_id,code,name,type) values(v_from.branch_id,'TRANSIT','Transit (VetOS System)','TRANSIT') returning id into v_transit; end if;
 v_proses:=case when p_source is null then 'Kirim Barang'::transfer_proses else 'Terima Barang'::transfer_proses end;
 v_number:=stock_document_number('IT',p_date);
 insert into stock_transfers(id,no_pemindahan,proses,tanggal,from_warehouse_id,to_warehouse_id,keterangan,status,source_transfer_id,created_by,request_key,posting_payload)
 values(v_id,v_number,v_proses,p_date,p_from,p_to,p_notes,case when p_source is null then 'Sedang dikirim'::transfer_status else null end,p_source,auth.uid(),p_key,v_payload);
 for v_row in select * from jsonb_to_recordset(p_items) as x(item_id uuid,qty numeric,satuan text) order by item_id loop
  if v_row.qty is null or v_row.qty<=0 or v_row.qty>1000000000000000000 then raise exception 'Qty tidak valid'; end if;
  select coalesce(nullif(unit,''),'pcs') into v_unit from items where id=v_row.item_id and is_active and (item_type is null or item_type='Persediaan');
  if not found then raise exception 'Barang bukan persediaan aktif'; end if;
  v_factor:=1;
  if p_source is null and coalesce(nullif(v_row.satuan,''),v_unit)<>v_unit then
   select factor into v_factor from item_units where item_id=v_row.item_id and unit=v_row.satuan;
   if not found or v_factor is null or v_factor<=0 then raise exception 'Satuan barang tidak tersedia'; end if;
   v_unit:=v_row.satuan;
  end if;
  if p_source is not null then
   select coalesce(sum(qty),0) into v_remaining from stock_transfer_items where transfer_id=p_source and item_id=v_row.item_id;
   select v_remaining-coalesce(sum(i.qty),0) into v_remaining from stock_transfer_items i join stock_transfers d on d.id=i.transfer_id where d.source_transfer_id=p_source and d.id<>v_id and i.item_id=v_row.item_id;
   if v_row.qty>v_remaining then raise exception 'Qty diterima melebihi sisa kiriman'; end if;
  end if;
  insert into stock_transfer_items(transfer_id,item_id,qty,selected_qty,satuan,faktor) values(v_id,v_row.item_id,v_row.qty*v_factor,v_row.qty,v_unit,v_factor);
  perform stock_transfer_fifo_exact(case when p_source is null then p_from else v_transit end,case when p_source is null then v_transit else p_to end,v_row.item_id,v_row.qty*v_factor,'transfer',v_number,p_date);
 end loop;
 if p_source is not null then
  select sum(qty) into v_total from stock_transfer_items where transfer_id=p_source;
  select sum(i.qty) into v_received from stock_transfer_items i join stock_transfers d on d.id=i.transfer_id where d.source_transfer_id=p_source;
  update stock_transfers set status=case when v_received>=v_total then 'Diterima Seluruhnya'::transfer_status else 'Diterima Sebagian'::transfer_status end where id=p_source;
 end if;
 return v_id;
end $$;
revoke all on function public.post_stock_transfer_atomic(uuid,uuid,uuid,uuid,date,text,jsonb) from public,anon;
grant execute on function public.post_stock_transfer_atomic(uuid,uuid,uuid,uuid,date,text,jsonb) to authenticated;

create function public.receive_stock_request_atomic(p_request_id uuid,p_branch_id uuid,p_rows jsonb) returns table(receipt_number text,selisih numeric)
language plpgsql security definer set search_path=public as $$
declare v_req stock_requests%rowtype; v_receipt uuid; v_number text; v_wh uuid; v_line stock_request_items%rowtype; v_row record; v_difference numeric:=0; v_payload jsonb;
begin
 select * into v_req from stock_requests where id=p_request_id for update;
 if not found or v_req.from_branch_id is distinct from p_branch_id then raise exception 'Permintaan/cabang tidak cocok'; end if;
 -- Backoffice receipt uses pos; clinic branch receipt also accepts its existing clinic module.
 begin perform stock_document_access(p_branch_id,'pos'); exception when others then
  if exists(select 1 from profiles p join cashier_shifts sh on sh.opened_by=p.id where p.id=auth.uid() and p.is_active and p.role in ('STAFF','DOCTOR','ADMIN','OWNER') and sh.status='open' and sh.branch_id=p_branch_id and (sh.shift_type='petshop' or (sh.shift_type='klinik' and exists(select 1 from branches b where b.id=p_branch_id and b.type in ('KLINIK','BOTH'))))) and public.user_can_access_branch(p_branch_id) then null;
  elsif exists(select 1 from branches where id=p_branch_id and type in ('KLINIK','BOTH')) then perform stock_document_access(p_branch_id,'klinik');
  else raise; end if;
 end;
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Rincian penerimaan tidak valid'; end if;
 v_payload:=(select jsonb_agg(jsonb_build_object('id',x.id,'qty_diterima',x.qty_diterima,'kondisi',x.kondisi,'notes',coalesce(x.notes,'')) order by x.id) from jsonb_to_recordset(p_rows) x(id uuid,qty_diterima numeric,kondisi text,notes text));
 if v_req.status='Selesai' then
  if not exists(select 1 from stock_receipts where stock_request_id=p_request_id and receipt_payload=v_payload) then raise exception 'Permintaan telah diterima dengan rincian berbeda'; end if;
  return query select r.receipt_number::text,(select coalesce(sum(i.qty_received-i.qty_ordered),0) from stock_receipt_items i where i.stock_receipt_id=r.id) from stock_receipts r where r.stock_request_id=p_request_id order by r.received_at limit 1;
  return;
 end if;
 if v_req.approved_by is null or not exists(select 1 from profiles where id=v_req.approved_by and role in ('OWNER','ADMIN')) then raise exception 'Permintaan belum memiliki persetujuan gudang yang sah'; end if;
 if v_req.status<>'Dikirim' then raise exception 'Hanya permintaan Dikirim dapat diterima'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0 or
 (select count(*) from jsonb_to_recordset(p_rows) x(id uuid))<>(select count(distinct id) from jsonb_to_recordset(p_rows) x(id uuid)) or
 jsonb_array_length(p_rows)<>(select count(*) from stock_request_items where request_id=p_request_id) then raise exception 'Rincian penerimaan harus lengkap dan unik'; end if;
 select id into v_wh from warehouses where branch_id=p_branch_id and is_active and type<>'TRANSIT' order by code,id limit 1;
 if v_wh is null or not exists(select 1 from warehouses where id=v_req.to_warehouse_id and is_active) or v_wh=v_req.to_warehouse_id then raise exception 'Gudang pengiriman/penerimaan tidak valid'; end if;
 v_number:=stock_document_number('TRM',(now() at time zone 'Asia/Jakarta')::date);
 insert into stock_receipts(receipt_number,stock_request_id,received_by,receipt_payload) values(v_number,p_request_id,auth.uid(),v_payload) returning id into v_receipt;
 for v_row in select * from jsonb_to_recordset(p_rows) x(id uuid,qty_diterima numeric,kondisi text,notes text) order by id loop
  select * into v_line from stock_request_items where id=v_row.id and request_id=p_request_id for update;
  if not found or v_line.item_id is null or v_line.faktor is null or v_line.faktor<=0 or v_row.qty_diterima is null or v_row.qty_diterima<0 or v_row.qty_diterima>coalesce(v_line.qty_disetujui,v_line.qty_diminta) or v_row.kondisi not in ('baik','rusak','kurang') then raise exception 'Rincian/qty penerimaan tidak valid'; end if;
  if v_row.kondisi='baik' and v_row.qty_diterima>0 then perform stock_transfer_fifo_exact(v_req.to_warehouse_id,v_wh,v_line.item_id,v_row.qty_diterima*v_line.faktor,'terima-permintaan',p_request_id::text,(now() at time zone 'Asia/Jakarta')::date); end if;
  insert into stock_receipt_items(stock_receipt_id,item_id,nama,qty_ordered,qty_received,satuan,faktor,condition,notes) values(v_receipt,v_line.item_id,v_line.nama,v_line.qty_diminta,v_row.qty_diterima,v_line.satuan,v_line.faktor,v_row.kondisi,nullif(v_row.notes,''));
  update stock_request_items set qty_diterima=v_row.qty_diterima,kondisi=v_row.kondisi where id=v_line.id;
  v_difference:=v_difference+v_row.qty_diterima-v_line.qty_diminta;
 end loop;
 update stock_requests set status='Selesai' where id=p_request_id;
 return query select v_number,v_difference;
end $$;
revoke all on function public.receive_stock_request_atomic(uuid,uuid,jsonb) from public,anon;
grant execute on function public.receive_stock_request_atomic(uuid,uuid,jsonb) to authenticated;

-- All document writes use the checked atomic entrypoints; browser writes must not
-- forge a sending document or alter its base ceiling before a receipt.
drop policy stf_all on public.stock_transfers;
drop policy stfi_all on public.stock_transfer_items;
drop policy srec_all on public.stock_receipts;
drop policy sreci_all on public.stock_receipt_items;
create policy stock_transfer_read on public.stock_transfers for select to authenticated using (
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active)
 and exists(select 1 from public.warehouses w where w.id in (from_warehouse_id,to_warehouse_id) and public.user_can_access_branch(w.branch_id)));
create policy stock_transfer_item_read on public.stock_transfer_items for select to authenticated using (
 exists(select 1 from public.stock_transfers d where d.id=transfer_id));
create policy stock_receipt_read on public.stock_receipts for select to authenticated using (
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active)
 and exists(select 1 from public.stock_requests r where r.id=stock_request_id and public.user_can_access_branch(r.from_branch_id)));
create policy stock_receipt_item_read on public.stock_receipt_items for select to authenticated using (
 exists(select 1 from public.stock_receipts r where r.id=stock_receipt_id));

-- Direct request creation remains supported by the existing three forms. It
-- cannot manufacture approved shipments or mutate trusted source/unit snapshots.
create function public.guard_stock_request_write() returns trigger
language plpgsql security invoker set search_path=public as $$
declare v_branch uuid; v_req stock_requests%rowtype; v_factor numeric; v_unit text;
begin
 -- Checked definer RPCs and migration owners perform completion; authenticated
 -- browser writes must pass the same creation/approval lifecycle as the actions.
 if current_user<>'authenticated' then return case when tg_op='DELETE' then old else new end; end if;
 if not exists(select 1 from profiles where id=auth.uid() and is_active) then raise exception 'Pengguna tidak aktif'; end if;
 if tg_table_name='stock_requests' then
  if tg_op='INSERT' then
   if new.status<>'Menunggu Persetujuan' or new.approved_by is not null or not public.user_can_access_branch(new.from_branch_id)
    or not exists(select 1 from warehouses where id=new.to_warehouse_id and is_active and type<>'TRANSIT') then raise exception 'Permintaan baru harus menunggu persetujuan'; end if;
   begin perform stock_document_access(new.from_branch_id,'pos'); exception when others then
    if not exists(select 1 from cashier_shifts sh where sh.opened_by=auth.uid() and sh.branch_id=new.from_branch_id and sh.status='open' and (sh.shift_type='petshop' or (sh.shift_type='klinik' and exists(select 1 from branches where id=new.from_branch_id and type in ('KLINIK','BOTH'))))) then raise; end if;
   end;
   new.requested_by:=auth.uid();
   return new;
  end if;
  if tg_op='DELETE' then raise exception 'Permintaan tidak dapat dihapus lewat browser'; end if;
  if new.from_branch_id is distinct from old.from_branch_id or new.to_warehouse_id is distinct from old.to_warehouse_id or new.requested_by is distinct from old.requested_by or new.no_request is distinct from old.no_request then raise exception 'Cabang/gudang sumber permintaan tidak dapat diubah'; end if;
  select branch_id into v_branch from warehouses where id=old.to_warehouse_id and is_active;
  if v_branch is null then raise exception 'Gudang sumber tidak aktif'; end if;
  perform stock_document_access(v_branch,'pos');
  if not exists(select 1 from profiles where id=auth.uid() and role in ('OWNER','ADMIN')) then raise exception 'Hanya Kepala Gudang / Manajer yang bisa menyetujui/mengirim'; end if;
  if new.status is distinct from old.status then
   if not ((old.status='Menunggu Persetujuan' and new.status in ('Disetujui','Ditolak')) or (old.status='Disetujui' and new.status='Dikirim')) then raise exception 'Transisi permintaan tidak valid'; end if;
   if new.status='Disetujui' then new.approved_by:=auth.uid(); end if;
  elsif old.status not in ('Menunggu Persetujuan','Disetujui') then raise exception 'Permintaan terkirim/selesai tidak dapat diubah'; end if;
  if old.status<>'Menunggu Persetujuan' and new.approved_by is distinct from old.approved_by then raise exception 'Persetujuan tidak dapat diubah'; end if;
  return new;
 end if;
 select * into v_req from stock_requests where id=case when tg_op='DELETE' then old.request_id else new.request_id end for update;
 if not found or v_req.status<>'Menunggu Persetujuan' then raise exception 'Rincian permintaan terkirim/disetujui tidak dapat diubah'; end if;
 if tg_op='INSERT' then
  if v_req.requested_by is distinct from auth.uid() or not public.user_can_access_branch(v_req.from_branch_id) or new.qty_diminta<=0 or new.qty_diminta>1000000000000000000 or new.qty_diterima is not null or new.qty_disetujui is not null then raise exception 'Rincian permintaan tidak valid'; end if;
  select coalesce(nullif(unit,''),'pcs') into v_unit from items where id=new.item_id and is_active and (item_type is null or item_type='Persediaan');
  if not found then raise exception 'Barang bukan persediaan aktif'; end if;
  v_factor:=1;
  if coalesce(nullif(new.satuan,''),v_unit)<>v_unit then
   select factor into v_factor from item_units where item_id=new.item_id and unit=new.satuan;
   if not found or v_factor is null or v_factor<=0 then raise exception 'Satuan permintaan tidak tersedia'; end if;
   v_unit:=new.satuan;
  end if;
  new.satuan:=v_unit; new.faktor:=v_factor;
  return new;
 end if;
 if tg_op='DELETE' then raise exception 'Rincian permintaan tidak dapat dihapus lewat browser'; end if;
 if (to_jsonb(new)-'qty_disetujui') is distinct from (to_jsonb(old)-'qty_disetujui') or new.qty_disetujui is null or new.qty_disetujui<0 or new.qty_disetujui>old.qty_diminta then raise exception 'Hanya qty persetujuan yang dapat diubah'; end if;
 select branch_id into v_branch from warehouses where id=v_req.to_warehouse_id and is_active;
 perform stock_document_access(v_branch,'pos');
 if not exists(select 1 from profiles where id=auth.uid() and role in ('OWNER','ADMIN')) then raise exception 'Persetujuan rincian ditolak'; end if;
 return new;
end $$;
revoke all on function public.guard_stock_request_write() from public,anon,authenticated;
create trigger stock_request_write_guard before insert or update or delete on public.stock_requests for each row execute function public.guard_stock_request_write();
create trigger stock_request_item_write_guard before insert or update or delete on public.stock_request_items for each row execute function public.guard_stock_request_write();
-- Read-only assertion is callable by the invoker trigger; it grants no writes.
grant execute on function public.stock_document_access(uuid,text) to authenticated;

create function public.approve_stock_request_atomic(p_id uuid,p_rows jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare v_req stock_requests%rowtype; v_branch uuid; v_row record;
begin
 select * into v_req from stock_requests where id=p_id for update;
 if not found or v_req.status<>'Menunggu Persetujuan' then raise exception 'Permintaan tidak menunggu persetujuan'; end if;
 select branch_id into v_branch from warehouses where id=v_req.to_warehouse_id and is_active;
 perform stock_document_access(v_branch,'pos');
 if not exists(select 1 from profiles where id=auth.uid() and role in ('OWNER','ADMIN')) then raise exception 'Persetujuan ditolak'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<>(select count(*) from stock_request_items where request_id=p_id) or (select count(*) from jsonb_to_recordset(p_rows) x(id uuid))<>(select count(distinct id) from jsonb_to_recordset(p_rows) x(id uuid)) then raise exception 'Rincian persetujuan tidak lengkap'; end if;
 for v_row in select * from jsonb_to_recordset(p_rows) x(id uuid,qty numeric) loop
  update stock_request_items set qty_disetujui=v_row.qty where id=v_row.id and request_id=p_id and v_row.qty>=0 and v_row.qty<=qty_diminta;
  if not found then raise exception 'Qty persetujuan tidak valid'; end if;
 end loop;
 update stock_requests set status='Disetujui',approved_by=auth.uid() where id=p_id;
end $$;
revoke all on function public.approve_stock_request_atomic(uuid,jsonb) from public,anon;
grant execute on function public.approve_stock_request_atomic(uuid,jsonb) to authenticated;
