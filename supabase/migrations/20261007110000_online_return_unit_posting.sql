-- New submissions only; historical quantities/prices are not rewritten.
alter table public.sale_items alter column qty type numeric;
-- qty/harga on return rows retain their base-unit meaning for existing readers.
alter table public.purchase_return_items add column source_line_id uuid references public.purchase_order_items(id) on delete restrict,
 add column selected_qty numeric check(selected_qty>0), add column satuan text, add column faktor numeric check(faktor>0), add column hpp numeric;
alter table public.sales_return_items add column source_line_id uuid references public.sale_items(id) on delete restrict,
 add column selected_qty numeric check(selected_qty>0), add column satuan text, add column faktor numeric check(faktor>0), add column hpp numeric;
create index on public.purchase_return_items(source_line_id);
create index on public.sales_return_items(source_line_id);
create table public.unit_posting_requests(actor_id uuid not null references public.profiles(id),scope text not null,request_key text not null,payload jsonb not null,result jsonb not null,branch_id uuid references public.branches(id),primary key(actor_id,scope,request_key),unique(actor_id,request_key));
alter table public.unit_posting_requests enable row level security;
revoke all on public.unit_posting_requests from public,anon,authenticated,service_role;

create function public.unit_posting_access(p_scope text,p_branch uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_scope like 'purchase-return:%' then perform public.purchase_assert_access('invoice',p_branch);
 else
  -- Retail return also belongs to the cashier world, but only active authorized branch actors.
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not public.user_can_access_branch(p_branch)
    or not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN','FINANCE','STAFF','DOCTOR')) then
    raise exception 'Akses transaksi ditolak.' using errcode='42501'; end if;
  if p_scope='online' or not exists(select 1 from public.cashier_shifts where opened_by=auth.uid() and branch_id=p_branch and status='open' and shift_type='petshop') then perform public.sales_assert_access(p_branch); end if;
 end if;
end $$;
revoke all on function public.unit_posting_access(text,uuid) from public,anon,authenticated,service_role;

create function public.get_unit_posting_result(p_scope text,p_request_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.unit_posting_requests%rowtype;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan.' using errcode='42501';end if;
 select * into r from public.unit_posting_requests where actor_id=auth.uid() and (scope=p_scope or (p_scope='purchase-return' and scope like 'purchase-return:%')) and request_key=p_request_key;
 if not found then return null;end if;
 perform public.unit_posting_access(r.scope,r.branch_id);return r.result;
end $$;
revoke all on function public.get_unit_posting_result(text,text) from public,anon;
grant execute on function public.get_unit_posting_result(text,text) to authenticated;

create function public.unit_posting_number(p_kind text,p_date date) returns text language plpgsql security definer set search_path='' as $$
declare prefix text;digits integer;n bigint;t text;c text;
begin
 if p_kind not in ('ONL','RB','RJ') then raise exception 'Seri tidak valid';end if;
 select pola,digit into prefix,digits from public.document_numbering where jenis=p_kind;
 prefix:=coalesce(prefix,case when p_kind='ONL' then 'ONL-{YYYY}{MM}{DD}-' else p_kind||'.{YYYY}.{MM}.' end);digits:=coalesce(digits,case when p_kind='ONL' then 4 else 5 end);
 prefix:=replace(replace(replace(replace(prefix,'{YYYY}',to_char(p_date,'YYYY')),'{YY}',to_char(p_date,'YY')),'{MM}',to_char(p_date,'MM')),'{DD}',to_char(p_date,'DD'));
 if digits not between 1 and 8 or length(prefix)+digits>30 then raise exception 'Format nomor terlalu panjang';end if;
 t:=case p_kind when 'ONL' then 'sales' when 'RB' then 'purchase_returns' else 'sales_returns' end;c:=case when p_kind='ONL' then 'no_struk' else 'no_retur' end;
 perform pg_advisory_xact_lock(hashtext('vetos:unit-number:'||prefix)::bigint);
 execute format('select coalesce(max(substring(%I from $1 for $2)::bigint),0)+1 from public.%I where left(%I,$3)=$4 and substring(%I from $1 for $2) ~ ''^[0-9]+$''',c,t,c,c) into n using length(prefix)+1,digits,length(prefix),prefix;
 if length(n::text)>digits then raise exception 'Urutan nomor penuh';end if;
 return prefix||lpad(n::text,digits,'0');
end $$;
revoke all on function public.unit_posting_number(text,date) from public,anon,authenticated,service_role;

create function public.unit_posting_factor(p_item uuid,p_unit text,p_inactive boolean default false) returns table(unit text,factor numeric) language plpgsql security definer set search_path='' as $$
declare base text;f numeric;
begin
 select coalesce(nullif(i.unit,''),'pcs') into base from public.items i where id=p_item and (p_inactive or is_active) for share;
 if not found then raise exception 'Barang tidak ditemukan atau tidak aktif' using errcode='22023';end if;
 if p_unit is null or p_unit='' or p_unit=base then return query select base,1::numeric;return;end if;
 select u.factor into f from public.item_units u where item_id=p_item and u.unit=p_unit for share;
 if not found or f is null or f<=0 or f::text in ('NaN','Infinity','-Infinity') then raise exception 'Satuan tidak terdaftar' using errcode='22023';end if;
 return query select p_unit,f;
end $$;
revoke all on function public.unit_posting_factor(uuid,text,boolean) from public,anon,authenticated,service_role;

create function public.unit_posting_cash(p_method text,p_branch uuid) returns text language sql stable security definer set search_path='' as $$
 select coalesce((select a.coa_code from public.payment_account_map m join public.cash_accounts a on a.id=m.cash_account_id where m.metode=p_method and (m.branch_id=p_branch or m.branch_id is null) order by m.branch_id nulls last limit 1),case when p_method='Tunai' then '1101' else '1102' end)
$$;
revoke all on function public.unit_posting_cash(text,uuid) from public,anon,authenticated,service_role;

create function public.post_online_order(p_request_key text,p_header jsonb,p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare wh public.warehouses%rowtype;r record;u record;it public.items%rowtype;prior public.unit_posting_requests%rowtype;payload jsonb;lines jsonb:='[]';d date;no text;doc uuid:=gen_random_uuid();total numeric:=0;hpp numeric:=0;cost numeric;stockqty numeric;customer uuid;v_points integer:=0;v_saldo integer;spending numeric;cfg record;dpp numeric;ppn numeric;cash text;result jsonb;issued record;
begin
 select * into wh from public.warehouses where id=(p_header->>'warehouse_id')::uuid and type='ONLINE' and is_active for share;
 if not found then raise exception 'Gudang online tidak ditemukan';end if;
 perform public.unit_posting_access('online',wh.branch_id);
 if p_request_key is null or length(p_request_key) not between 1 and 120 or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Identitas atau barang tidak valid' using errcode='22023';end if;
 payload:=jsonb_build_object('header',p_header,'items',p_items);
 perform pg_advisory_xact_lock(hashtext('vetos:unit-request:'||auth.uid()::text||':'||p_request_key)::bigint);
 select * into prior from public.unit_posting_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then if prior.scope<>'online' or prior.payload<>payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda' using errcode='22023';end if;return prior.result;end if;
 if p_header->>'channel' not in ('Shopee','Tokopedia','TikTok Shop','WA') or p_header->>'channel' is null then raise exception 'Channel tidak valid';end if;
 d:=(p_header->>'tanggal')::date;
 if d is null or d>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal tidak valid';end if;
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and d<=closed_until) then raise exception 'Periode akuntansi sudah ditutup';end if;
 for r in select * from jsonb_to_recordset(p_items) as x(item_id uuid,qty numeric,harga numeric,satuan text) order by item_id,satuan loop
  if r.qty is null or r.qty<=0 or r.qty>1000000000 or r.harga is null or r.harga<0 or r.harga>1000000000000 or r.qty::text='NaN' or r.harga::text='NaN' then raise exception 'Qty atau harga tidak valid' using errcode='22023';end if;
  select * into u from public.unit_posting_factor(r.item_id,r.satuan);
  select * into it from public.items where id=r.item_id;
  if coalesce(it.item_type,'Persediaan')='Grup' then raise exception 'Grup tidak didukung pada online';end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('item_id',r.item_id,'nama',it.name,'qty',r.qty,'harga',r.harga,'satuan',u.unit,'faktor',u.factor));
  total:=total+r.qty*r.harga;
 end loop;
 if total<=0 then raise exception 'Total order harus positif';end if;
 -- Lock balances once in stable SKU order, and validate total mixed-unit demand.
 for r in select x.item_id,sum(x.qty*x.faktor) qty from jsonb_to_recordset(lines) as x(item_id uuid,qty numeric,faktor numeric) join public.items i on i.id=x.item_id where coalesce(i.item_type,'Persediaan')='Persediaan' group by x.item_id order by x.item_id loop
  select qty into stockqty from public.stock where warehouse_id=wh.id and item_id=r.item_id for update;
  if stockqty is null or stockqty<r.qty then raise exception 'Stok tidak cukup' using errcode='22003';end if;
 end loop;
 customer:=case when p_header->>'channel'='WA' then nullif(p_header->>'customer_id','')::uuid else null end;
 if customer is not null then perform 1 from public.customers where id=customer for update;if not found then raise exception 'Pelanggan tidak ditemukan';end if;v_points:=floor(total/1000);end if;
 no:=public.unit_posting_number('ONL',d);
 insert into public.sales(id,branch_id,customer_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,poin_earned,cashier_id,channel,external_ref,buyer_name,marketplace_status,created_at)
 values(doc,wh.branch_id,customer,no,total,0,total,p_header->>'channel',total,0,v_points,auth.uid(),p_header->>'channel',nullif(p_header->>'external_ref',''),nullif(p_header->>'buyer_name',''),case when p_header->>'channel'<>'WA' then 'piutang' end,(d::text||'T12:00:00+07:00')::timestamptz);
 for r in select * from jsonb_to_recordset(lines) as x(item_id uuid,nama text,qty numeric,harga numeric,satuan text,faktor numeric) order by item_id,satuan loop
  select * into issued from public.stock_out_fifo(wh.id,r.item_id,r.qty*r.faktor,'sale-online',no,d);
  if issued.shortfall>0 then raise exception 'Lapisan stok tidak cukup untuk HPP FIFO' using errcode='22003';end if;
  cost:=issued.cost;
  cost:=coalesce(cost,0);hpp:=hpp+cost;
  insert into public.sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values(doc,r.item_id,r.nama,r.qty,r.harga,r.satuan,r.faktor,cost);
 end loop;
 select mode_pkp,ppn_rate into cfg from public.company_settings where id;
 dpp:=case when coalesce(cfg.mode_pkp,false) then round(total*100/(100+cfg.ppn_rate)) else total end;ppn:=total-dpp;
 cash:=case when p_header->>'channel'='WA' then public.unit_posting_cash('Transfer',wh.branch_id) else '1202' end;
 perform public.sales_write_journal(d,wh.branch_id,'sale-online',no,'Penjualan online '||no,jsonb_build_array(jsonb_build_object('code',cash,'debit',total,'credit',0),jsonb_build_object('code','4101','debit',0,'credit',dpp),jsonb_build_object('code','2201','debit',0,'credit',ppn)));
 if hpp>0 then perform public.sales_write_journal(d,wh.branch_id,'sale-online-hpp',no,'HPP online '||no,jsonb_build_array(jsonb_build_object('code','5101','debit',hpp,'credit',0),jsonb_build_object('code','1301','debit',0,'credit',hpp)));end if;
 if customer is not null then
  update public.customers set points=coalesce(customers.points,0)+v_points where id=customer returning customers.points into v_saldo;
  if v_points>0 then insert into public.point_ledger(customer_id,delta,saldo,ref,description) values(customer,v_points,v_saldo,no,'Penjualan online '||no);end if;
  select coalesce((select sum(s.total) from public.sales s where s.customer_id=customer),0)+coalesce((select sum(i.total) from public.invoices i join public.visits v on v.id=i.visit_id where v.customer_id=customer and i.paid_status='Lunas' and i.voided_at is null),0) into spending;
  update public.customers set total_spending=spending,tier=case when spending>=coalesce((select platinum_min from public.tier_settings where id=1),50000000) then 'Platinum' when spending>=coalesce((select gold_min from public.tier_settings where id=1),15000000) then 'Gold' when spending>=coalesce((select silver_min from public.tier_settings where id=1),5000000) then 'Silver' when spending>=coalesce((select bronze_min from public.tier_settings where id=1),1000000) then 'Bronze' else 'New' end where id=customer;
 end if;
 result:=jsonb_build_object('document_id',doc,'document_no',no);
 insert into public.unit_posting_requests values(auth.uid(),'online',p_request_key,payload,result,wh.branch_id);return result;
end $$;
revoke all on function public.post_online_order(text,jsonb,jsonb) from public,anon;
grant execute on function public.post_online_order(text,jsonb,jsonb) to authenticated;

create function public.post_unit_return(p_kind text,p_source uuid,p_request_key text,p_header jsonb,p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders%rowtype;sale public.sales%rowtype;prior public.unit_posting_requests%rowtype;v_scope text;branch uuid;wh uuid;payload jsonb;result jsonb;d date;no text;doc uuid:=gen_random_uuid();r record;src record;u record;it public.items%rowtype;c record;lines jsonb:='[]';base numeric;available numeric;used numeric;cost numeric;price numeric;total numeric:=0;hppgood numeric:=0;hppbad numeric:=0;ratio numeric:=1;paid numeric;accepted numeric;previous numeric;cash text;shift uuid;dpp numeric;ppn numeric;cfg record;componentqty numeric;componentcost numeric;stockqty numeric;source_hpp numeric;is_group boolean;previous_hpp numeric;issued record;inventory_cost numeric:=0;variance numeric;
begin
 if p_kind not in ('purchase','sales') or p_kind is null then raise exception 'Jenis retur tidak valid';end if;
 v_scope:=case when p_kind='purchase' then 'purchase-return:' else 'sales-return:' end||p_source::text;
 if p_kind='purchase' then
  select * into po from public.purchase_orders where id=p_source for update;if not found then raise exception 'PO tidak ditemukan';end if;
  branch:=po.branch_id;wh:=po.to_warehouse_id;
 else
  select * into sale from public.sales where id=p_source and channel is null for update;if not found then raise exception 'Struk tidak ditemukan atau online';end if;
  branch:=sale.branch_id;
  if not exists(select 1 from public.journal_entries where source='sale' and source_ref=sale.no_struk) then raise exception 'Jurnal sumber penjualan belum tersedia — rekonsiliasi diperlukan';end if;
 end if;
 perform public.unit_posting_access(v_scope,branch);
 if p_kind='sales' and coalesce(p_header->>'dari','')<>'kasir' then perform public.sales_assert_access(branch);end if;
 if p_request_key is null or length(p_request_key) not between 1 and 120 or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Identitas atau barang tidak valid' using errcode='22023';end if;
 payload:=jsonb_build_object('header',p_header,'items',p_items);
 perform pg_advisory_xact_lock(hashtext('vetos:unit-request:'||auth.uid()::text||':'||p_request_key)::bigint);
 select * into prior from public.unit_posting_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then if prior.scope<>v_scope or prior.payload<>payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda' using errcode='22023';end if;return prior.result;end if;
 if p_kind='purchase' and (po.status<>'Diterima' or wh is null) then raise exception 'PO belum diterima atau tidak punya gudang';end if;
 if p_kind='sales' then
  if nullif(p_header->>'lock_branch_id','') is not null and (p_header->>'lock_branch_id')::uuid<>branch then raise exception 'Struk bukan cabang kasir';end if;
  -- Cashier authorization derives from the actual active shift, never a client branch field.
  if p_header->>'dari'='kasir' and not exists(select 1 from public.cashier_shifts where opened_by=auth.uid() and branch_id=branch and status='open' and shift_type='petshop') then raise exception 'Shift kasir tidak ditemukan' using errcode='42501';end if;
  select id into wh from public.warehouses where branch_id=branch and is_active order by type,id limit 1;
  ratio:=case when sale.subtotal>0 then least(1,greatest(0,sale.total/sale.subtotal)) else 1 end;
 end if;
 d:=(p_header->>'tanggal')::date;if d is null then raise exception 'Tanggal wajib';end if;
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and d<=closed_until) then raise exception 'Periode akuntansi sudah ditutup';end if;
 if (select count(*) from jsonb_to_recordset(p_items) as x(source_line_id uuid))<>(select count(distinct source_line_id) from jsonb_to_recordset(p_items) as x(source_line_id uuid)) then raise exception 'Baris sumber dobel atau kosong' using errcode='22023';end if;
 for r in select * from jsonb_to_recordset(p_items) as x(source_line_id uuid,item_id uuid,qty numeric,satuan text,kondisi text,exp_date date) order by item_id,source_line_id loop
  if r.qty is null or r.qty<=0 or r.qty>1000000000 or r.qty::text='NaN' then raise exception 'Qty tidak valid' using errcode='22023';end if;
  if r.kondisi is not null and r.kondisi not in ('baik','rusak') then raise exception 'Kondisi tidak valid' using errcode='22023';end if;
  if p_kind='purchase' then
   select id,item_id,nama,coalesce(qty_terima,qty) qty,faktor,harga_beli harga,null::numeric hpp into src from public.purchase_order_items where id=r.source_line_id and po_id=p_source for update;
  else
   select id,item_id,nama,qty,faktor,harga,hpp into src from public.sale_items where id=r.source_line_id and sale_id=p_source for update;
  end if;
  if not found or src.item_id is null or src.item_id is distinct from r.item_id then raise exception 'Baris bukan milik dokumen sumber' using errcode='22023';end if;
  if src.faktor is null or src.faktor<=0 then raise exception 'Snapshot faktor sumber tidak valid';end if;
  select * into u from public.unit_posting_factor(src.item_id,r.satuan,true);
  base:=r.qty*u.factor;
  if p_kind='purchase' then
   if exists(select 1 from public.purchase_return_items ri join public.purchase_returns rt on rt.id=ri.return_id where rt.po_id=p_source and ri.item_id=src.item_id and ri.source_line_id is null)
      and (select count(*) from public.purchase_order_items where po_id=p_source and item_id=src.item_id)>1 then raise exception 'Retur lama perlu rekonsiliasi sumber baris';end if;
   select coalesce(sum(ri.qty),0) into used from public.purchase_return_items ri join public.purchase_returns rt on rt.id=ri.return_id where rt.po_id=p_source and (ri.source_line_id=src.id or (ri.source_line_id is null and ri.item_id=src.item_id));
   price:=src.harga/src.faktor;cost:=base*price;
  else
   if exists(select 1 from public.sales_return_items ri join public.sales_returns rt on rt.id=ri.return_id where rt.sale_id=p_source and ri.item_id=src.item_id and ri.source_line_id is null)
      and (select count(*) from public.sale_items where sale_id=p_source and item_id=src.item_id)>1 then raise exception 'Retur lama perlu rekonsiliasi sumber baris';end if;
   select coalesce(sum(ri.qty),0) into used from public.sales_return_items ri join public.sales_returns rt on rt.id=ri.return_id where rt.sale_id=p_source and (ri.source_line_id=src.id or (ri.source_line_id is null and ri.item_id=src.item_id));
   price:=src.harga/src.faktor*ratio;
   select * into it from public.items where id=src.item_id;
   if coalesce(it.item_type,'Persediaan')='Persediaan' and src.hpp is null then raise exception 'HPP sumber belum tersedia — rekonsiliasi diperlukan';end if;
   is_group:=exists(select 1 from public.sale_item_group_components where sale_item_id=src.id);
   if is_group then select coalesce(sum(hpp),0) into source_hpp from public.sale_item_group_components where sale_item_id=src.id and item_type='Persediaan';
   else source_hpp:=coalesce(src.hpp,0);end if;

   select coalesce(sum(coalesce(ri.hpp,ri.qty*source_hpp/(src.qty*src.faktor))),0) into previous_hpp from public.sales_return_items ri join public.sales_returns rt on rt.id=ri.return_id where rt.sale_id=p_source and (ri.source_line_id=src.id or (ri.source_line_id is null and ri.item_id=src.item_id));
   if previous_hpp<0 or previous_hpp>source_hpp then raise exception 'Alokasi HPP sumber perlu rekonsiliasi';end if;
   cost:=greatest(0,least(source_hpp,case when is_group then source_hpp*(used+base)/(src.qty*src.faktor) else round(source_hpp*(used+base)/(src.qty*src.faktor),2) end)-previous_hpp);
  end if;
  available:=src.qty*src.faktor-used;
  if base>available then raise exception 'Qty melebihi sisa % satuan dasar',available using errcode='22003';end if;
  total:=total+base*price;
  lines:=lines||jsonb_build_array(jsonb_build_object('source_line_id',src.id,'item_id',src.item_id,'nama',src.nama,'qty',base,'selected_qty',r.qty,'satuan',u.unit,'faktor',u.factor,'harga',price,'hpp',cost,'source_base',src.qty*src.faktor,'kondisi',coalesce(r.kondisi,'baik'),'exp_date',r.exp_date));
 end loop;
 if total<=0 then raise exception 'Nilai retur nol';end if;
 if p_kind='purchase' then
  -- Same PO lock as invoice creation; lock invoices before payments can change the debt.
  perform 1 from public.purchase_invoices where po_id=p_source order by id for update;
  select coalesce(sum(p.amount),0) into paid from public.purchase_invoice_payments p join public.purchase_invoices i on i.id=p.invoice_id where i.po_id=p_source;
  select coalesce(sum(coalesce(qty_terima,qty)*harga_beli),0) into accepted from public.purchase_order_items where po_id=p_source;
  select coalesce(sum(rt.total),0) into previous from public.purchase_returns rt where rt.po_id=p_source;
  if total>greatest(0,accepted-paid-previous) then raise exception 'Nilai retur melebihi sisa hutang' using errcode='22003';end if;
  for r in select item_id,sum(qty) qty from jsonb_to_recordset(lines) as x(item_id uuid,qty numeric) group by item_id order by item_id loop
   select qty into stockqty from public.stock where warehouse_id=wh and item_id=r.item_id for update;
   if stockqty is null or stockqty<r.qty then raise exception 'Stok tidak cukup' using errcode='22003';end if;
  end loop;
  no:=public.unit_posting_number('RB',d);
  insert into public.purchase_returns(id,no_retur,po_id,tanggal,keterangan,total,created_by) values(doc,no,p_source,d,nullif(p_header->>'keterangan',''),total,auth.uid());
 else
  no:=public.unit_posting_number('RJ',d);
  insert into public.sales_returns(id,no_retur,sale_id,tanggal,keterangan,total,created_by) values(doc,no,p_source,d,nullif(p_header->>'keterangan',''),total,auth.uid());
 end if;
 for r in select * from jsonb_to_recordset(lines) as x(source_line_id uuid,item_id uuid,nama text,qty numeric,selected_qty numeric,satuan text,faktor numeric,harga numeric,hpp numeric,source_base numeric,kondisi text,exp_date date) order by item_id,source_line_id loop
  if p_kind='purchase' then
   select * into issued from public.stock_out_fifo(wh,r.item_id,r.qty,'retur-beli',no,d);
   if issued.shortfall>0 then raise exception 'Lapisan stok tidak cukup untuk HPP FIFO' using errcode='22003';end if;
   inventory_cost:=inventory_cost+issued.cost;
   insert into public.purchase_return_items(return_id,source_line_id,item_id,nama,qty,harga,selected_qty,satuan,faktor,hpp) values(doc,r.source_line_id,r.item_id,r.nama,r.qty,r.harga,r.selected_qty,r.satuan,r.faktor,issued.cost);
  else
   insert into public.sales_return_items(return_id,source_line_id,item_id,nama,qty,harga,selected_qty,satuan,faktor,hpp,kondisi,exp_date) values(doc,r.source_line_id,r.item_id,r.nama,r.qty,r.harga,r.selected_qty,r.satuan,r.faktor,r.hpp,r.kondisi,r.exp_date);
   if exists(select 1 from public.sale_item_group_components where sale_item_id=r.source_line_id) then
    for c in select * from public.sale_item_group_components where sale_item_id=r.source_line_id and item_type='Persediaan' order by component_item_id loop
     componentqty:=c.total_base_qty*r.qty/r.source_base;componentcost:=c.hpp*r.qty/r.source_base;
     if c.component_item_id is null then raise exception 'Komponen sumber sudah dihapus';end if;
     if r.kondisi='baik' then
      if wh is null then raise exception 'Gudang aktif diperlukan';end if;
      perform public.stock_in_fifo(wh,c.component_item_id,componentqty,componentcost/componentqty,'retur-jual-group',no,d,r.exp_date);hppgood:=hppgood+componentcost;
     else hppbad:=hppbad+componentcost;end if;
    end loop;
   else
    select * into it from public.items where id=r.item_id;
    if coalesce(it.item_type,'Persediaan')='Persediaan' then
     if r.kondisi='baik' then
      if wh is null then raise exception 'Gudang aktif diperlukan';end if;
      perform public.stock_in_fifo(wh,r.item_id,r.qty,r.hpp/r.qty,'retur-jual',no,d,r.exp_date);hppgood:=hppgood+r.hpp;
     else hppbad:=hppbad+r.hpp;end if;
    end if;
   end if;
  end if;
 end loop;
 if p_kind='purchase' then
  variance:=inventory_cost-total;
  perform public.sales_write_journal(d,branch,'purchase-return',no,'Retur pembelian '||no,jsonb_build_array(jsonb_build_object('code','2101','debit',total,'credit',0),jsonb_build_object('code','1301','debit',0,'credit',inventory_cost),jsonb_build_object('code','5902','debit',greatest(variance,0),'credit',greatest(-variance,0))));
 else
  if sale.metode_bayar='Tunai' then select id into shift from public.cashier_shifts where branch_id=branch and opened_by=auth.uid() and status='open' and shift_type='petshop' order by opened_at desc limit 1 for update;end if;
  insert into public.expenses(branch_id,tanggal,kategori,deskripsi,jumlah,metode_bayar,shift_id,created_by) values(branch,d,'Retur Penjualan','Refund retur '||no||' (struk '||sale.no_struk||')',total,sale.metode_bayar,shift,auth.uid());
  select a.code into cash from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id where e.source='sale' and e.source_ref=sale.no_struk and l.debit>0 and (a.code in ('1101','1102') or a.code in(select coa_code from public.cash_accounts)) limit 1;
  cash:=coalesce(cash,public.unit_posting_cash(sale.metode_bayar,branch));
  select mode_pkp,ppn_rate into cfg from public.company_settings where id;
  dpp:=case when coalesce(cfg.mode_pkp,false) then round(total*100/(100+cfg.ppn_rate)) else total end;ppn:=total-dpp;
  perform public.sales_write_journal(d,branch,'sales-return',no,'Retur penjualan '||no,jsonb_build_array(jsonb_build_object('code','4101','debit',dpp,'credit',0),jsonb_build_object('code','2201','debit',ppn,'credit',0),jsonb_build_object('code',cash,'debit',0,'credit',total)));
  if hppgood+hppbad>0 then perform public.sales_write_journal(d,branch,'sales-return-hpp',no,'HPP retur '||no,jsonb_build_array(jsonb_build_object('code','1301','debit',hppgood,'credit',0),jsonb_build_object('code','5902','debit',hppbad,'credit',0),jsonb_build_object('code','5101','debit',0,'credit',hppgood+hppbad)));end if;
 end if;
 result:=jsonb_build_object('document_id',doc,'document_no',no);
 insert into public.unit_posting_requests values(auth.uid(),v_scope,p_request_key,payload,result,branch);return result;
end $$;
revoke all on function public.post_unit_return(text,uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.post_unit_return(text,uuid,text,jsonb,jsonb) to authenticated;

-- All new return writes go through the source-locking RPC; permissive legacy
-- RLS policies alone must not allow authenticated clients to skip the ceilings.
revoke insert,update,delete on public.purchase_returns,public.purchase_return_items,public.sales_returns,public.sales_return_items from authenticated;

-- Posted source snapshots are immutable. Initial POS lines and HPP snapshots are
-- written before their revenue journal; marketplace settlement fields stay writable.
create function public.unit_posted_sale_source_immutable() returns trigger language plpgsql security definer set search_path='' as $$
declare sale_id uuid;ref text;posted boolean;
begin
 if tg_op='UPDATE' and tg_table_name='sale_items' then if new.sale_id is distinct from old.sale_id then raise exception 'Induk rincian penjualan tidak boleh dipindah' using errcode='22023';end if;end if;
 if tg_op='UPDATE' and tg_table_name='sale_item_group_components' then if new.sale_item_id is distinct from old.sale_item_id then raise exception 'Induk snapshot komponen tidak boleh dipindah' using errcode='22023';end if;end if;
 if tg_table_name='sales' then sale_id:=old.id;
 elsif tg_table_name='sale_item_group_components' then select si.sale_id into sale_id from public.sale_items si where si.id=case when tg_op='INSERT' then new.sale_item_id else old.sale_item_id end;
 elsif tg_op='INSERT' then sale_id:=new.sale_id;
 else sale_id:=old.sale_id;end if;
 select no_struk into ref from public.sales where id=sale_id;
 posted:=exists(select 1 from public.journal_entries where source in ('sale','sale-online') and source_ref=ref);
 if posted then
  if tg_table_name='sales' and tg_op='UPDATE' then
   if (to_jsonb(new)-array['marketplace_status','komisi','disbursed_at','external_ref','buyer_name']) is distinct from (to_jsonb(old)-array['marketplace_status','komisi','disbursed_at','external_ref','buyer_name']) then raise exception 'Snapshot penjualan yang sudah diposting tidak boleh diubah' using errcode='22023';end if;
  else raise exception 'Snapshot rincian penjualan yang sudah diposting tidak boleh diubah' using errcode='22023';end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
revoke all on function public.unit_posted_sale_source_immutable() from public,anon,authenticated,service_role;
create trigger unit_posted_sale_header before update or delete on public.sales for each row execute function public.unit_posted_sale_source_immutable();
create trigger unit_posted_sale_line before insert or update or delete on public.sale_items for each row execute function public.unit_posted_sale_source_immutable();
create trigger unit_posted_sale_group before insert or update or delete on public.sale_item_group_components for each row execute function public.unit_posted_sale_source_immutable();

create function public.unit_returned_purchase_source_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
declare po uuid;frozen boolean;
begin
 if tg_op='UPDATE' and tg_table_name='purchase_order_items' then if new.po_id is distinct from old.po_id then raise exception 'Induk rincian PO tidak boleh dipindah' using errcode='22023';end if;end if;
 -- Validated security-definer receipt/invoice RPCs may extend cumulative receipt/invoice fields.
 if current_user not in ('authenticated','anon') then if tg_op='DELETE' then return old;else return new;end if;end if;
 if tg_table_name='purchase_orders' then po:=old.id;elsif tg_op='INSERT' then po:=new.po_id;else po:=old.po_id;end if;
 frozen:=exists(select 1 from public.purchase_returns where po_id=po);
 if frozen then
  if tg_table_name='purchase_order_items' and tg_op='UPDATE' then
   if (to_jsonb(new)-array['qty_faktur']) is distinct from (to_jsonb(old)-array['qty_faktur']) then raise exception 'Sumber PO yang sudah diretur tidak boleh diubah' using errcode='22023';end if;
  else raise exception 'Sumber PO yang sudah diretur tidak boleh diubah' using errcode='22023';end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
revoke all on function public.unit_returned_purchase_source_immutable() from public,anon,authenticated,service_role;
create trigger unit_returned_purchase_header before update or delete on public.purchase_orders for each row execute function public.unit_returned_purchase_source_immutable();
create trigger unit_returned_purchase_line before insert or update or delete on public.purchase_order_items for each row execute function public.unit_returned_purchase_source_immutable();
