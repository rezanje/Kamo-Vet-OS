-- Posted sales remain immutable; cancellation appends exact reversals and audit.
alter table public.sales add column revision integer not null default 0,
 add column voided_at timestamptz, add column voided_by uuid references public.profiles(id),
 add column void_reason text;
alter table public.stock_moves add column fifo_takes jsonb, add column fifo_shortfall numeric, add column sale_line_id uuid;
-- Logical source-line identity: checkout inserts the line after the stock RPC, so
-- a cross-request foreign key is impossible. Finalization validates ownership.
create index stock_moves_sale_line on public.stock_moves(sale_line_id) where sale_line_id is not null;
create table public.sale_cancellations (
 id uuid primary key default gen_random_uuid(), sale_id uuid not null unique references public.sales(id) on delete restrict,
 branch_id uuid not null references public.branches(id), reason text not null,
 before_value jsonb not null, reversal_journal_ids uuid[] not null,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
alter table public.sale_cancellations enable row level security;
revoke all on public.sale_cancellations from public,anon,authenticated,service_role;
grant select on public.sale_cancellations to authenticated;
create policy sale_cancellations_read on public.sale_cancellations for select to authenticated
 using(public.user_can_access_branch(branch_id) and public.sales_module_access());
create table public.sale_cancellation_requests (
 actor_id uuid not null references public.profiles(id), request_key text not null,
 sale_id uuid not null references public.sales(id), payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(actor_id,request_key)
);
alter table public.sale_cancellation_requests enable row level security;
revoke all on public.sale_cancellation_requests from public,anon,authenticated,service_role;

create function public.guard_sale_cancellation_metadata() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.voided_at is not null then raise exception 'Penjualan sudah dibatalkan; riwayat tidak dapat diubah';end if;
 if current_user in('authenticated','anon','service_role') and
  ((tg_op='INSERT' and (new.revision<>0 or new.voided_at is not null or new.voided_by is not null or new.void_reason is not null))
   or (tg_op='UPDATE' and (new.revision,new.voided_at,new.voided_by,new.void_reason) is distinct from (old.revision,old.voided_at,old.voided_by,old.void_reason))) then
  raise exception 'Pembatalan hanya melalui tindakan resmi Super Admin' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.guard_sale_cancellation_metadata() from public,anon,authenticated,service_role;
create trigger sale_cancellation_metadata before insert or update on public.sales for each row execute function public.guard_sale_cancellation_metadata();

create or replace function public.stock_out_fifo(
  p_warehouse_id uuid,
  p_item_id uuid,
  p_qty numeric,
  p_source text,
  p_source_ref text,
  p_tanggal date default current_date
)
returns table(cost numeric, takes jsonb, shortfall numeric, harga_beli numeric)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item record;
  v_layer record;
  v_left numeric;
  v_take numeric;
  v_cost numeric := 0;
  v_shortfall numeric := 0;
  v_takes jsonb := '[]'::jsonb;
  v_stock_id uuid;
begin
  if p_qty is null or p_qty <= 0 or p_qty > 1000000000000000000
     or p_source is null or length(p_source) = 0 or length(p_source) > 24
     or length(coalesce(p_source_ref, '')) > 40 then
    raise exception 'Data stok keluar tidak valid.';
  end if;

  select item_type, coalesce(buy_price, 0) as buy_price into v_item
  from public.items where id = p_item_id;
  if not found then raise exception 'Barang tidak ditemukan.'; end if;
  if v_item.item_type is not null and v_item.item_type <> 'Persediaan' then
    return query select 0::numeric, '[]'::jsonb, 0::numeric, 0::numeric;
    return;
  end if;

  -- Ensure an aggregate row exists, then lock it before any FIFO layer.
  insert into public.stock(warehouse_id, item_id, qty)
  values (p_warehouse_id, p_item_id, 0)
  on conflict (warehouse_id, item_id) do nothing;
  select id into v_stock_id from public.stock
  where warehouse_id = p_warehouse_id and item_id = p_item_id
  for update;
  if not found then raise exception 'Saldo stok tidak dapat dikunci.'; end if;

  v_left := p_qty;
  for v_layer in
    select id, qty_left, unit_cost, exp_date
    from public.stock_layers
    where warehouse_id = p_warehouse_id and item_id = p_item_id and qty_left > 0
    order by exp_date nulls last, tanggal, created_at, id
    for update
  loop
    exit when v_left <= 0;
    v_take := least(v_layer.qty_left, v_left);
    if v_take <= 0 then continue; end if;
    update public.stock_layers set qty_left = qty_left - v_take where id = v_layer.id;
    v_takes := v_takes || jsonb_build_array(jsonb_build_object(
      'id', v_layer.id, 'qty', v_take, 'unit_cost', v_layer.unit_cost, 'exp_date', v_layer.exp_date
    ));
    v_cost := v_cost + v_take * v_layer.unit_cost;
    v_left := v_left - v_take;
  end loop;

  v_shortfall := greatest(v_left, 0);
  if v_shortfall > 0 then v_cost := v_cost + v_shortfall * v_item.buy_price; end if;

  update public.stock
  set qty = qty - p_qty, updated_at = now()
  where id = v_stock_id;

  insert into public.stock_moves(
    tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref, fifo_takes, fifo_shortfall
  ) values (
    coalesce(p_tanggal, current_date), p_warehouse_id, p_item_id, -p_qty,
    v_cost / p_qty, p_source, p_source_ref,
    case when p_source in('sale','sale-group','sale-online') then v_takes end,
    case when p_source in('sale','sale-group','sale-online') then v_shortfall end
  );

  return query select v_cost, v_takes, v_shortfall, v_item.buy_price;
end;
$$;

revoke all on function public.stock_out_fifo(uuid, uuid, numeric, text, text, date) from public, anon;
grant execute on function public.stock_out_fifo(uuid, uuid, numeric, text, text, date) to authenticated;


-- Only the target sale path gains elevated inventory access; all other FIFO callers
-- retain the existing invoker function and return contract.
create function public.sale_stock_out_fifo(p_warehouse_id uuid,p_item_id uuid,p_qty numeric,p_source text,p_source_ref text,p_tanggal date default ((now() at time zone 'Asia/Jakarta')::date),p_sale_line_id uuid default null)
returns table(cost numeric,takes jsonb,shortfall numeric,harga_beli numeric)
language plpgsql security definer set search_path='' as $$
declare s public.sales%rowtype;prior_moves uuid[];
begin
 select * into s from public.sales where no_struk=p_source_ref for update;
 if not found or p_source not in('sale','sale-group') or p_source is null or s.channel is not null then raise exception 'Sumber stok penjualan tidak valid';end if;
 perform public.pos_sale_assert_actor(s);
 if s.payments_finalized_at is not null or s.voided_at is not null
  or exists(select 1 from public.journal_entries where source='sale' and source_ref=s.no_struk) then raise exception 'Stok penjualan sudah tetap';end if;
 if p_tanggal is distinct from (s.created_at at time zone 'Asia/Jakarta')::date
  or p_tanggal is distinct from (now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal pengeluaran stok penjualan tidak sesuai';end if;
 if not exists(select 1 from public.warehouses where id=p_warehouse_id and branch_id=s.branch_id and is_active) then raise exception 'Gudang penjualan tidak dapat diakses' using errcode='42501';end if;
 if p_source='sale-group' and p_sale_line_id is null then raise exception 'Identitas baris grup diperlukan sebelum stok dikeluarkan';end if;
 if p_sale_line_id is not null and exists(select 1 from public.sale_items where id=p_sale_line_id and sale_id<>s.id) then raise exception 'Identitas baris bukan milik penjualan sumber' using errcode='42501';end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into prior_moves from public.stock_moves where source_ref=s.no_struk and source in('sale','sale-group');
 return query select * from public.stock_out_fifo(p_warehouse_id,p_item_id,p_qty,p_source,p_source_ref,p_tanggal);
 -- The sale lock serializes all its movements. Only the issue just made here
 -- receives the logical line identity; callers cannot rewrite this metadata.
 if p_sale_line_id is not null then
  update public.stock_moves set sale_line_id=p_sale_line_id where source_ref=s.no_struk and source=p_source and id<>all(prior_moves);
 end if;
end$$;
revoke all on function public.sale_stock_out_fifo(uuid,uuid,numeric,text,text,date,uuid) from public,anon,service_role;
grant execute on function public.sale_stock_out_fifo(uuid,uuid,numeric,text,text,date,uuid) to authenticated;

create or replace function public.pos_sale_protect_header() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.payments_finalized_at is not null then raise exception 'Metadata pembayaran dikelola server';end if;
 else
  if new.merchant_fee_total is distinct from old.merchant_fee_total then raise exception 'Fee merchant penjualan sudah tetap';end if;
  if new.payment_plan is distinct from old.payment_plan then raise exception 'Rencana pembayaran sudah tetap';end if;
  if new.payments_finalized_at is distinct from old.payments_finalized_at and current_user in('authenticated','anon','service_role') then
   raise exception 'Metadata pembayaran dikelola server';end if;
  if old.payment_plan is not null and
   (to_jsonb(new)-array['payments_finalized_at','revision','voided_at','voided_by','void_reason']) is distinct from
   (to_jsonb(old)-array['payments_finalized_at','revision','voided_at','voided_by','void_reason']) then
   raise exception 'Snapshot keuangan penjualan sudah tetap';end if;
 end if;
 return new;
end $$;

create or replace function public.unit_posted_sale_source_immutable() returns trigger language plpgsql security definer set search_path='' as $$
declare sale_id uuid;ref text;posted boolean;
begin
 if tg_op='UPDATE' and tg_table_name='sale_items' then if new.sale_id is distinct from old.sale_id then raise exception 'Induk rincian penjualan tidak boleh dipindah' using errcode='22023';end if;end if;
 if tg_op='UPDATE' and tg_table_name='sale_item_group_components' then if new.sale_item_id is distinct from old.sale_item_id then raise exception 'Induk snapshot komponen tidak boleh dipindah' using errcode='22023';end if;end if;
 if tg_table_name='sales' then sale_id:=old.id;
 elsif tg_table_name='sale_item_group_components' then select si.sale_id into sale_id from public.sale_items si where si.id=case when tg_op='INSERT' then new.sale_item_id else old.sale_item_id end;
 elsif tg_op='INSERT' then sale_id:=new.sale_id;
 else sale_id:=old.sale_id;end if;
 -- Serialize source writes with finalization before checking the seal. A late
 -- child INSERT must not pass this check then wait at its foreign key until
 -- after finalization has committed.
 select no_struk into ref from public.sales where id=sale_id for update;
 posted:=exists(select 1 from public.journal_entries where source in ('sale','sale-online') and source_ref=ref)
  or exists(select 1 from public.sales where id=sale_id and payments_finalized_at is not null);
 if posted then
  if tg_table_name='sales' and tg_op='UPDATE' then
   if (to_jsonb(new)-array['marketplace_status','komisi','disbursed_at','external_ref','buyer_name','revision','voided_at','voided_by','void_reason']) is distinct from (to_jsonb(old)-array['marketplace_status','komisi','disbursed_at','external_ref','buyer_name','revision','voided_at','voided_by','void_reason']) then raise exception 'Snapshot penjualan yang sudah diposting tidak boleh diubah' using errcode='22023';end if;
  else raise exception 'Snapshot rincian penjualan yang sudah diposting tidak boleh diubah' using errcode='22023';end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;

create or replace function public.pos_shift_pending_checkout_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare actual_breakdown jsonb;cash_expenses numeric;actual_expected numeric;
begin
 if old.status<>'open' or new.status is not distinct from old.status then return new;end if;
 if exists(select 1 from public.sales where shift_id=old.id and payment_plan is not null and payments_finalized_at is null) then
  raise exception 'Pembayaran masih diproses. Selesaikan transaksi sebelum menutup shift.';
 end if;
 -- Header insertion and finalization lock this same shift row. Recompute after
 -- acquiring the close's UPDATE lock: a checkout may have finalized since the
 -- app read its totals. Reject that stale snapshot before any variance journal.
 if old.shift_type='petshop' and new.status='closed'
  and exists(select 1 from public.sales where shift_id=old.id and payment_plan is not null) then
  select coalesce(jsonb_object_agg(t.method,round(t.amount,2)),'{}'::jsonb) into actual_breakdown
   from(select incoming.method,sum(incoming.amount) amount from(
    select s.metode_bayar method,s.total amount from public.sales s
     where s.voided_at is null and s.shift_id=old.id and s.payment_plan is null and s.total<>0
    union all
    select p.method,p.amount from public.sale_payments p join public.sales s on s.id=p.sale_id
     where s.voided_at is null and s.shift_id=old.id and s.payment_plan is not null and s.payments_finalized_at is not null
   ) incoming group by incoming.method) t;
  actual_breakdown:=jsonb_build_object('Tunai',0,'Transfer',0,'Debit',0,'Kredit',0,'QRIS',0,'E-Wallet',0)||actual_breakdown;
  select round(coalesce(sum(jumlah),0),2) into cash_expenses from public.expenses where shift_id=old.id and metode_bayar='Tunai';
  actual_expected:=round(new.opening_balance+(actual_breakdown->>'Tunai')::numeric-cash_expenses,2);
  if new.expected_cash is distinct from actual_expected or new.closing_breakdown is distinct from actual_breakdown then
   raise exception 'Pembayaran shift berubah. Hitung ulang sebelum menutup shift.';
  end if;
 end if;
 return new;
end $$;

create or replace function public.post_online_order(p_request_key text,p_header jsonb,p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
  select coalesce((select sum(s.total-s.merchant_fee_total) from public.sales s where s.voided_at is null and s.customer_id=customer and (s.payment_plan is null or s.payments_finalized_at is not null)),0)+coalesce((select sum(i.total) from public.invoices i join public.visits v on v.id=i.visit_id where v.customer_id=customer and i.paid_status='Lunas' and i.voided_at is null),0) into spending;
  update public.customers set total_spending=spending,tier=case when spending>=coalesce((select platinum_min from public.tier_settings where id=1),50000000) then 'Platinum' when spending>=coalesce((select gold_min from public.tier_settings where id=1),15000000) then 'Gold' when spending>=coalesce((select silver_min from public.tier_settings where id=1),5000000) then 'Silver' when spending>=coalesce((select bronze_min from public.tier_settings where id=1),1000000) then 'Bronze' else 'New' end where id=customer;
 end if;
 result:=jsonb_build_object('document_id',doc,'document_no',no);
 insert into public.unit_posting_requests values(auth.uid(),'online',p_request_key,payload,result,wh.branch_id);return result;
end $$;

-- Source snapshots cannot be extended or rewritten after posting, including FIFO provenance.
create function public.guard_posted_sale_movement() returns trigger
language plpgsql security definer set search_path='' as $$
declare r record;s public.sales%rowtype;
begin
 for r in select * from jsonb_to_recordset(case when tg_op='INSERT' then jsonb_build_array(to_jsonb(new)) when tg_op='DELETE' then jsonb_build_array(to_jsonb(old)) else jsonb_build_array(to_jsonb(old),to_jsonb(new)) end) as x(source text,source_ref text) loop
  if r.source in('sale','sale-group','sale-online') then
   select * into s from public.sales where no_struk=r.source_ref for update;
   if found and (s.voided_at is not null or s.payments_finalized_at is not null or exists(select 1 from public.journal_entries where source in('sale','sale-online') and source_ref=s.no_struk)) then
    raise exception 'Mutasi stok penjualan yang sudah diposting tidak boleh diubah';
   end if;
  elsif r.source='sale-void' and tg_op<>'INSERT' then raise exception 'Mutasi pembatalan tidak boleh diubah';end if;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function public.guard_posted_sale_movement() from public,anon,authenticated,service_role;
create trigger posted_sale_movement_guard before insert or update or delete on public.stock_moves for each row execute function public.guard_posted_sale_movement();

create or replace function public.pos_sale_journal_protected(p_entry uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pos_sale_postings where revenue_journal_id=p_entry or hpp_journal_id=p_entry)
 or exists(select 1 from public.journal_entries e where e.id=p_entry and e.source in('sale','sale-hpp','sale-online','sale-online-hpp','sale-void','sale-void-hpp'))
$$;

create function public.guard_sale_void_movement_insert() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if current_user in('authenticated','anon','service_role') and ((tg_op='INSERT' and (new.fifo_takes is not null or new.fifo_shortfall is not null or new.sale_line_id is not null)) or (tg_op in('UPDATE','DELETE') and (old.fifo_takes is not null or old.fifo_shortfall is not null or old.sale_line_id is not null)) or (tg_op='UPDATE' and (new.fifo_takes,new.fifo_shortfall,new.sale_line_id) is distinct from (old.fifo_takes,old.fifo_shortfall,old.sale_line_id))) then raise exception 'Rincian FIFO dikelola proses penjualan' using errcode='42501';end if;
 if new.source='sale-void' and current_user in('authenticated','anon','service_role') then
  raise exception 'Mutasi pembatalan hanya melalui tindakan resmi' using errcode='42501';
 end if;
 return coalesce(new,old);
end $$;
revoke all on function public.guard_sale_void_movement_insert() from public,anon,authenticated,service_role;
create trigger sale_void_movement_insert before insert or update or delete on public.stock_moves for each row execute function public.guard_sale_void_movement_insert();

-- A void sale cannot be returned after its money and inventory were restored.
create function public.guard_sale_return_void() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.sales where id=new.sale_id for update;
 if exists(select 1 from public.sales where id=new.sale_id and voided_at is not null) then raise exception 'Penjualan sudah dibatalkan; retur tidak dapat dibuat';end if;
 return new;
end $$;
revoke all on function public.guard_sale_return_void() from public,anon,authenticated,service_role;
create trigger sale_return_void_guard before insert or update on public.sales_returns for each row execute function public.guard_sale_return_void();

-- A pending stock issue can reference the UUID of a not-yet-inserted line.
-- Before sealing checkout, every supplied identity must resolve inside this sale.
create function public.guard_sale_issue_line_links() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if old.payments_finalized_at is null and new.payments_finalized_at is not null and exists(
  select 1 from public.stock_moves m where m.source_ref=new.no_struk and m.source in('sale','sale-group') and m.sale_line_id is not null and not exists(
   select 1 from public.sale_items i where i.id=m.sale_line_id and i.sale_id=new.id and
    ((m.source='sale' and i.item_id=m.item_id) or (m.source='sale-group' and exists(select 1 from public.sale_item_group_components c where c.sale_item_id=i.id and c.component_item_id=m.item_id and c.item_type='Persediaan')))
  )
 ) then raise exception 'Rincian stok belum terhubung ke baris penjualan sumber';end if;
 return new;
end$$;
revoke all on function public.guard_sale_issue_line_links() from public,anon,authenticated,service_role;
create trigger sale_issue_line_links before update on public.sales for each row execute function public.guard_sale_issue_line_links();

create function public.assert_sale_group_cost_links(p_sale uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r record;part record;ref text;raw_cost numeric;captured_qty numeric;captured_hpp numeric;
begin
 select no_struk into ref from public.sales where id=p_sale;
 if exists(select 1 from public.stock_moves m where m.source_ref=ref and m.source='sale-group' and not exists(
  select 1 from public.sale_items i join public.sale_item_group_components c on c.sale_item_id=i.id
   where i.id=m.sale_line_id and i.sale_id=p_sale and c.component_item_id=m.item_id and c.item_type='Persediaan'
 )) then raise exception 'Rincian FIFO belum terhubung ke grup sumber; rekonsiliasi diperlukan';end if;
 for r in select i.* from public.sale_items i where i.sale_id=p_sale and exists(select 1 from public.sale_item_group_components c where c.sale_item_id=i.id) order by i.id loop
  if exists(select 1 from public.sale_item_group_components where sale_item_id=r.id and item_type<>'Persediaan' and hpp<>0) then raise exception 'HPP komponen tanpa stok tidak sesuai';end if;
  for part in select component_item_id,sum(total_base_qty) qty,sum(hpp) hpp from public.sale_item_group_components where sale_item_id=r.id and item_type='Persediaan' group by component_item_id loop
   select coalesce(-sum(m.qty),0),coalesce(sum(round((select sum(x.qty*x.unit_cost) from jsonb_to_recordset(m.fifo_takes) x(qty numeric,unit_cost numeric)),2)),0)
    into captured_qty,captured_hpp from public.stock_moves m where m.source_ref=ref and m.source='sale-group' and m.sale_line_id=r.id and m.item_id=part.component_item_id;
   if captured_qty<>part.qty or captured_hpp<>part.hpp then raise exception 'Jumlah atau HPP komponen tidak sesuai rincian FIFO sumber';end if;
  end loop;
  select coalesce(sum(x.qty*x.unit_cost),0) into raw_cost from public.stock_moves m cross join lateral jsonb_to_recordset(m.fifo_takes) x(qty numeric,unit_cost numeric)
   where m.source_ref=ref and m.source='sale-group' and m.sale_line_id=r.id;
  if round(raw_cost,2)<>r.hpp then raise exception 'HPP induk grup tidak sesuai rincian FIFO sumber';end if;
 end loop;
end$$;
revoke all on function public.assert_sale_group_cost_links(uuid) from public,anon,authenticated,service_role;

-- New cashier effects are attributable to one sale; old rewards remain fail-closed.
alter table public.sales add column quest_effects_tracked boolean not null default false;
alter table public.sales alter column quest_effects_tracked set default true;
create table public.sale_staff_effects (
 sale_id uuid primary key references public.sales(id) on delete restrict,
 staff_id uuid not null references public.profiles(id), before_value jsonb not null,
 after_value jsonb not null, ledger_ids uuid[] not null, reversed_at timestamptz,
 -- Allocated after the employee lock: transaction timestamps do not order effects.
 effect_order bigint generated always as identity unique,
 created_at timestamptz not null default now()
);
create index sale_staff_effects_active_order on public.sale_staff_effects(staff_id,effect_order) where reversed_at is null;
revoke all on sequence public.sale_staff_effects_effect_order_seq from public,anon,authenticated,service_role;
alter table public.sale_staff_effects enable row level security;
revoke all on public.sale_staff_effects from public,anon,authenticated,service_role;

create function public.apply_sale_staff_effects(p_sale_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.sales%rowtype;q record;p public.staff_quest_progress%rowtype;st public.staff_streaks%rowtype;
 before_progress jsonb:='[]';after_progress jsonb:='[]';before_streak jsonb;after_streak jsonb;
 before_points jsonb;after_points jsonb;ledgers uuid[]:='{}';ledger uuid;
 amount numeric;value numeric;award integer:=0;next_streak integer;key text;d date:=(now() at time zone 'Asia/Jakarta')::date;
 existing boolean;done boolean;cfg public.quest_settings%rowtype;
begin
 select * into s from public.sales where id=p_sale_id for update;
 if not found or auth.uid() is null or auth.role() is distinct from 'authenticated' or s.cashier_id is distinct from auth.uid() then raise exception 'Penjualan tidak dapat diakses' using errcode='42501';end if;
 perform public.pos_sale_assert_actor(s);
 if s.channel is not null or not s.quest_effects_tracked or s.payments_finalized_at is null then raise exception 'Efek staf memerlukan penjualan kasir baru yang selesai';end if;
 if s.voided_at is not null then raise exception 'Penjualan sudah dibatalkan; hadiah staf tidak diterapkan';end if;
 if exists(select 1 from public.sale_staff_effects where sale_id=s.id) then return jsonb_build_object('applied',true);end if;
 -- All sale effect writers for the same employee share this row lock.
 perform 1 from public.profiles where id=s.cashier_id and is_active and role in('OWNER','ADMIN','FINANCE','STAFF','DOCTOR') for update;
 if not found then raise exception 'Akun staf aktif diperlukan' using errcode='42501';end if;
 select to_jsonb(x) into before_points from public.staff_points x where staff_id=s.cashier_id for update;
 select * into st from public.staff_streaks where staff_id=s.cashier_id for update;
 if found then before_streak:=to_jsonb(st);end if;
 for q in select * from public.staff_quest_definitions where is_active and (branch_id is null or branch_id=s.branch_id) order by id for share loop
  if q.target_kind='total_sales_amount' then amount:=s.total-coalesce(s.merchant_fee_total,0);
  else select coalesce(sum(i.qty),0) into amount from public.sale_items i left join public.items m on m.id=i.item_id
   where i.sale_id=s.id and (q.target_ref_id is null or (q.target_kind='product_qty' and i.item_id=q.target_ref_id) or (q.target_kind='category_qty' and m.category_id=q.target_ref_id));end if;
  if amount<=0 then continue;end if;
  key:=case when q.quest_type='daily' then to_char(d,'YYYY-MM-DD') else to_char(d,'YYYY-MM') end;
  select * into p from public.staff_quest_progress where staff_id=s.cashier_id and quest_definition_id=q.id and period_key=key for update;
  existing:=found;before_progress:=before_progress||jsonb_build_array(jsonb_build_object('quest_id',q.id,'period_key',key,'row',case when existing then to_jsonb(p) else null end));
  value:=coalesce(p.current_value,0)+amount;done:=value>=q.target_value;
  if not existing then
   insert into public.staff_quest_progress(staff_id,quest_definition_id,period_key,current_value,status,completed_at)
    values(s.cashier_id,q.id,key,value,case when done then 'completed' else 'in_progress' end,case when done then now() end) returning * into p;
  else
   update public.staff_quest_progress set current_value=value,
    status=case when status='in_progress' and done then 'completed' else status end,
    completed_at=case when status='in_progress' and done then now() else completed_at end
    where id=p.id returning * into p;
  end if;
  -- Award only on the same in-progress -> completed transition as the old hook.
  if done and (not existing or (before_progress->(jsonb_array_length(before_progress)-1)->'row'->>'status')='in_progress') then
   award:=award+q.points_reward;ledger:=gen_random_uuid();ledgers:=array_append(ledgers,ledger);
   insert into public.staff_points_ledger(id,staff_id,points_delta,source_type,source_id,branch_id,notes)
    values(ledger,s.cashier_id,q.points_reward,'quest_completion',q.id,s.branch_id,'Quest selesai ('||key||')');
  end if;
  after_progress:=after_progress||jsonb_build_array(to_jsonb(p));
 end loop;
 if st.last_active_date is distinct from d then
  next_streak:=case when st.last_active_date=d-1 then coalesce(st.current_streak_days,0)+1 else 1 end;
  insert into public.staff_streaks(staff_id,current_streak_days,longest_streak_days,last_active_date,updated_at)
   values(s.cashier_id,next_streak,greatest(coalesce(st.longest_streak_days,0),next_streak),d,now())
   on conflict(staff_id) do update set current_streak_days=excluded.current_streak_days,longest_streak_days=excluded.longest_streak_days,last_active_date=d,updated_at=now();
  select * into cfg from public.quest_settings where id=1 for share;
  if cfg.streak_bonus_every_days>0 and next_streak%cfg.streak_bonus_every_days=0 then
   award:=award+cfg.streak_bonus_points;ledger:=gen_random_uuid();ledgers:=array_append(ledgers,ledger);
   insert into public.staff_points_ledger(id,staff_id,points_delta,source_type,branch_id,notes)
    values(ledger,s.cashier_id,cfg.streak_bonus_points,'streak_bonus',s.branch_id,'Bonus streak '||next_streak||' hari');
  end if;
 end if;
 if award>0 then
  insert into public.staff_points(staff_id,total_points,updated_at) values(s.cashier_id,coalesce((before_points->>'total_points')::integer,0)+award,now())
   on conflict(staff_id) do update set total_points=excluded.total_points,updated_at=now();
 end if;
 select to_jsonb(x) into after_points from public.staff_points x where staff_id=s.cashier_id;
 select to_jsonb(x) into after_streak from public.staff_streaks x where staff_id=s.cashier_id;
 insert into public.sale_staff_effects(sale_id,staff_id,before_value,after_value,ledger_ids)
  values(s.id,s.cashier_id,jsonb_build_object('progress',before_progress,'streak',before_streak,'points',before_points),jsonb_build_object('progress',after_progress,'streak',after_streak,'points',after_points),ledgers);
 return jsonb_build_object('applied',true);
end $$;
revoke all on function public.apply_sale_staff_effects(uuid) from public,anon,service_role;
grant execute on function public.apply_sale_staff_effects(uuid) to authenticated;

create function public.reverse_sale_staff_effects(p_sale public.sales,p_audit uuid) returns void
language plpgsql security definer set search_path='' as $$
declare effects public.sale_staff_effects%rowtype;r jsonb;actual jsonb;expected jsonb;ledger record;
begin
 select * into effects from public.sale_staff_effects where sale_id=p_sale.id for update;
 if not found then
  if not p_sale.quest_effects_tracked and p_sale.channel is null and (
   exists(select 1 from public.staff_quest_progress where staff_id=p_sale.cashier_id and period_key in(to_char(p_sale.created_at at time zone 'Asia/Jakarta','YYYY-MM-DD'),to_char(p_sale.created_at at time zone 'Asia/Jakarta','YYYY-MM')))
   or exists(select 1 from public.staff_streaks where staff_id=p_sale.cashier_id and last_active_date>=(p_sale.created_at at time zone 'Asia/Jakarta')::date)
  ) then raise exception 'Hadiah staf transaksi lama belum memiliki rincian sumber. Rekonsiliasi hadiah staf diperlukan';end if;
  return;
 end if;
 if effects.reversed_at is not null then raise exception 'Hadiah staf sudah dibalik';end if;
 perform 1 from public.profiles where id=effects.staff_id for update;
 -- A later no-op effect still depends on the earlier streak initialization.
 if exists(select 1 from public.sale_staff_effects where staff_id=effects.staff_id and reversed_at is null and effect_order>effects.effect_order) then
  raise exception 'Transaksi staf berikutnya masih aktif. Batalkan dari transaksi terakhir atau rekonsiliasi hadiah staf terlebih dahulu';
 end if;
 select to_jsonb(x) into actual from public.staff_points x where staff_id=effects.staff_id for update;
 if coalesce(actual,'null') is distinct from effects.after_value->'points' then raise exception 'Saldo hadiah staf sudah berubah. Rekonsiliasi hadiah staf diperlukan';end if;
 select to_jsonb(x) into actual from public.staff_streaks x where staff_id=effects.staff_id for update;
 if coalesce(actual,'null') is distinct from effects.after_value->'streak' then raise exception 'Rangkaian aktivitas staf sudah berubah. Rekonsiliasi hadiah staf diperlukan';end if;
 for r in select value from jsonb_array_elements(effects.after_value->'progress') loop
  select to_jsonb(x) into actual from public.staff_quest_progress x where id=(r->>'id')::uuid for update;
  if actual is distinct from r then raise exception 'Progres atau klaim hadiah staf sudah berubah. Rekonsiliasi hadiah staf diperlukan';end if;
 end loop;
 for r in select value from jsonb_array_elements(effects.before_value->'progress') loop
  expected:=r->'row';
  if expected='null'::jsonb then delete from public.staff_quest_progress where staff_id=effects.staff_id and quest_definition_id=(r->>'quest_id')::uuid and period_key=r->>'period_key';
  else update public.staff_quest_progress set current_value=(expected->>'current_value')::numeric,status=expected->>'status',completed_at=(expected->>'completed_at')::timestamptz,claimed_at=(expected->>'claimed_at')::timestamptz where id=(expected->>'id')::uuid;end if;
 end loop;
 expected:=effects.before_value->'streak';
 if expected='null'::jsonb then delete from public.staff_streaks where staff_id=effects.staff_id;
 else update public.staff_streaks set current_streak_days=(expected->>'current_streak_days')::integer,longest_streak_days=(expected->>'longest_streak_days')::integer,last_active_date=(expected->>'last_active_date')::date,updated_at=(expected->>'updated_at')::timestamptz where staff_id=effects.staff_id;end if;
 expected:=effects.before_value->'points';
 if expected='null'::jsonb then delete from public.staff_points where staff_id=effects.staff_id;
 else update public.staff_points set total_points=(expected->>'total_points')::integer,updated_at=(expected->>'updated_at')::timestamptz where staff_id=effects.staff_id;end if;
 for ledger in select * from public.staff_points_ledger where id=any(effects.ledger_ids) order by id for share loop
  insert into public.staff_points_ledger(staff_id,points_delta,source_type,source_id,branch_id,notes)
   values(ledger.staff_id,-ledger.points_delta,ledger.source_type,p_audit,ledger.branch_id,'Pembatalan penjualan '||p_sale.no_struk);
 end loop;
 update public.sale_staff_effects set reversed_at=now() where sale_id=p_sale.id;
end $$;
revoke all on function public.reverse_sale_staff_effects(public.sales,uuid) from public,anon,authenticated,service_role;

create function public.cancel_posted_sale(p_sale_id uuid,p_expected_revision integer,p_request_key text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 s public.sales%rowtype; prior public.sale_cancellation_requests%rowtype;payload jsonb;result jsonb;
 audit uuid:=gen_random_uuid();reversal uuid;reversals uuid[]:='{}';j record;r record;t record;
 d date:=(now() at time zone 'Asia/Jakarta')::date;original_date date;closed date;
 cost numeric;inventory_cost numeric;total_debit numeric;total_credit numeric;balance integer;v_delta integer;spending numeric;
 v_source text;inventory jsonb;layer public.stock_layers%rowtype;goods numeric;
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501';end if;
 if p_sale_id is null or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Identitas atau alasan pembatalan tidak valid';end if;
 payload:=jsonb_build_object('sale_id',p_sale_id,'revision',p_expected_revision,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('vetos:sale-cancel:'||auth.uid()::text||':'||p_request_key,0));
 select * into s from public.sales where id=p_sale_id for update;
 if not found then raise exception 'Penjualan tidak ditemukan';end if;
 perform 1 from public.profiles where id=auth.uid() and is_active and role='OWNER';
 if not found then raise exception 'Hanya Super Admin aktif yang dapat membatalkan penjualan' using errcode='42501';end if;
 perform public.sales_assert_access(s.branch_id);
 perform 1 from public.branches where id=s.branch_id and is_active for share;
 if not found then raise exception 'Cabang sumber tidak aktif' using errcode='42501';end if;
 select * into prior from public.sale_cancellation_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda';end if;
  return prior.result;
 end if;
 if s.revision<>p_expected_revision then raise exception 'Penjualan sudah berubah. Muat ulang sebelum membatalkan';end if;
 if s.voided_at is not null then raise exception 'Penjualan sudah dibatalkan';end if;
 if s.payment_plan is not null and s.payments_finalized_at is null then raise exception 'Selesaikan pembayaran sebelum pembatalan';end if;
 original_date:=(s.created_at at time zone 'Asia/Jakarta')::date;
 select closed_until into closed from public.accounting_locks where id for share;
 if original_date>d then raise exception 'Tanggal sumber di masa depan; rekonsiliasi diperlukan';end if;
 if closed is not null and (original_date<=closed or d<=closed) then raise exception 'Periode sumber atau pembatalan sudah ditutup';end if;
 if s.shift_id is not null then
  perform 1 from public.cashier_shifts where id=s.shift_id and status='open' for update;
  if not found then raise exception 'Shift penjualan sudah ditutup. Rekonsiliasi kas shift diperlukan sebelum koreksi';end if;
 end if;
 perform 1 from public.profiles where id in(auth.uid(),s.cashier_id) order by id for update;
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role='OWNER') then raise exception 'Hanya Super Admin aktif yang dapat membatalkan penjualan' using errcode='42501';end if;
 perform public.sales_assert_access(s.branch_id);
 if exists(select 1 from public.sales_returns where sale_id=s.id) then raise exception 'Penjualan sudah memiliki retur. Rekonsiliasi retur diperlukan sebelum pembatalan';end if;
 if s.disbursed_at is not null or coalesce(s.marketplace_status,'piutang')<>'piutang' or coalesce(s.komisi,0)<>0
  or exists(select 1 from public.journal_entries where source='sale-online-cair' and source_ref=s.no_struk) then raise exception 'Dana marketplace sudah dicairkan. Rekonsiliasi pencairan diperlukan';end if;
 -- Payroll commission is frozen when the payroll row is generated.
 if exists(select 1 from public.payrolls where periode=to_char(original_date,'YYYY-MM')) then raise exception 'Penggajian periode penjualan sudah dibuat. Rekonsiliasi komisi penggajian diperlukan';end if;
 if s.voucher_code is not null or exists(select 1 from public.sale_items where sale_id=s.id and promo_id is not null) then raise exception 'Penjualan memakai voucher atau promo. Rekonsiliasi kuota promo diperlukan sebelum pembatalan';end if;
 v_source:=case when s.channel is null then 'sale' else 'sale-online' end;
 perform 1 from public.sale_items where sale_id=s.id order by id for update;
 if not found or exists(select 1 from public.sale_items where sale_id=s.id and (item_id is null or qty<=0 or faktor is null or faktor<=0 or hpp is null or hpp<0)) then raise exception 'Rincian atau HPP sumber belum lengkap; rekonsiliasi diperlukan';end if;
 perform 1 from public.sale_item_group_components c join public.sale_items i on i.id=c.sale_item_id where i.sale_id=s.id order by c.id for update of c;
 if exists(select 1 from public.sale_items i join public.items m on m.id=i.item_id where i.sale_id=s.id and m.item_type='Grup' and not exists(select 1 from public.sale_item_group_components c where c.sale_item_id=i.id)) then raise exception 'Snapshot komponen grup belum lengkap';end if;
 select coalesce(sum(hpp),0) into cost from public.sale_items where sale_id=s.id;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into inventory from (
  select item_id,sum(qty) qty,sum(hpp) hpp from (
   select i.item_id,i.qty*i.faktor qty,i.hpp from public.sale_items i join public.items m on m.id=i.item_id
    where i.sale_id=s.id and coalesce(m.item_type,'Persediaan')='Persediaan' and not exists(select 1 from public.sale_item_group_components c where c.sale_item_id=i.id)
   union all select c.component_item_id,c.total_base_qty,c.hpp from public.sale_item_group_components c join public.sale_items i on i.id=c.sale_item_id where i.sale_id=s.id and c.item_type='Persediaan'
  ) parts group by item_id
 ) x;
 if exists(select 1 from public.sale_items i join public.items m on m.id=i.item_id where i.sale_id=s.id and coalesce(m.item_type,'Persediaan')<>'Persediaan' and not exists(select 1 from public.sale_item_group_components c where c.sale_item_id=i.id) and i.hpp<>0) then raise exception 'HPP barang tanpa stok tidak sesuai';end if;
 perform 1 from public.stock_moves where source_ref=s.no_struk and source in('sale','sale-group','sale-online') order by id for update;
 if exists(select 1 from public.stock_moves m where m.source_ref=s.no_struk and m.source in('sale','sale-group','sale-online') and
  (m.fifo_takes is null or jsonb_typeof(m.fifo_takes)<>'array' or m.fifo_shortfall is distinct from 0::numeric or m.qty>=0 or not exists(select 1 from public.warehouses w where w.id=m.warehouse_id and w.branch_id=s.branch_id))) then raise exception 'Riwayat FIFO sumber belum lengkap atau memakai stok minus; rekonsiliasi diperlukan';end if;
 perform public.assert_sale_group_cost_links(s.id);
 for r in select * from jsonb_to_recordset(inventory) x(item_id uuid,qty numeric,hpp numeric) order by item_id loop
  if r.item_id is null or r.qty<=0 or r.hpp<0 or
   (select coalesce(-sum(qty),0) from public.stock_moves where source_ref=s.no_struk and source in('sale','sale-group','sale-online') and item_id=r.item_id)<>r.qty or
   (select coalesce(sum(round((select sum(taken.qty*taken.unit_cost) from jsonb_to_recordset(m.fifo_takes) taken(qty numeric,unit_cost numeric)),2)),0) from public.stock_moves m where source_ref=s.no_struk and source in('sale','sale-group','sale-online') and item_id=r.item_id)<>r.hpp then raise exception 'Riwayat stok dan HPP sumber tidak sesuai; rekonsiliasi diperlukan';end if;
 end loop;
 if exists(select 1 from public.stock_moves m where m.source_ref=s.no_struk and m.source in('sale','sale-group','sale-online') and not exists(select 1 from jsonb_to_recordset(inventory) x(item_id uuid) where x.item_id=m.item_id)) then raise exception 'Mutasi tambahan sumber perlu rekonsiliasi';end if;
 -- Each original source line rounds its own issue cost; online journals retain raw takes.
 select coalesce(sum(taken.qty*taken.unit_cost),0) into inventory_cost from public.stock_moves m cross join lateral jsonb_to_recordset(m.fifo_takes) taken(qty numeric,unit_cost numeric) where source_ref=s.no_struk and source in('sale','sale-group','sale-online');
 -- Online posting preserves raw FIFO cost; POS finalization sums rounded line snapshots.
 if s.channel is not null then cost:=inventory_cost;end if;
 -- Validate every original journal, then copy its exact accounts and values.
 for j in select e.* from public.journal_entries e where e.source in(v_source,v_source||'-hpp') and e.source_ref=s.no_struk order by e.id for update loop
  if j.branch_id is distinct from s.branch_id or j.tanggal<>original_date or j.voided_at is not null then raise exception 'Identitas jurnal sumber tidak sesuai';end if;
  perform 1 from public.journal_lines where entry_id=j.id for update;
  select sum(debit),sum(credit) into total_debit,total_credit from public.journal_lines where entry_id=j.id;
  if total_debit is null or total_debit<=0 or total_debit<>total_credit
   or exists(select 1 from public.journal_lines where entry_id=j.id and (debit<0 or credit<0 or debit::text in('NaN','Infinity','-Infinity') or credit::text in('NaN','Infinity','-Infinity') or (debit>0 and credit>0))) then raise exception 'Jurnal sumber tidak lengkap atau tidak seimbang';end if;
 end loop;
 if s.total>0 and (select count(*) from public.journal_entries e where e.source=v_source and e.source_ref=s.no_struk)<>1 then raise exception 'Jurnal penjualan sumber belum lengkap';end if;
 if cost>0 and (select count(*) from public.journal_entries e where e.source=v_source||'-hpp' and e.source_ref=s.no_struk)<>1 then raise exception 'Jurnal HPP sumber belum lengkap';end if;
 if cost>0 and (select sum(l.debit) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id where e.source=v_source||'-hpp' and e.source_ref=s.no_struk)<>cost then raise exception 'Nilai jurnal HPP tidak sesuai sumber';end if;
 if s.customer_id is not null then
  select coalesce(points,0) into balance from public.customers where id=s.customer_id for update;
  select coalesce(sum(delta),0) into v_delta from public.point_ledger where customer_id=s.customer_id and ref=s.no_struk;
  if v_delta<>s.poin_earned-s.poin_digunakan or balance-v_delta<0 then raise exception 'Poin sumber tidak sesuai atau sudah terpakai. Rekonsiliasi poin diperlukan';end if;
 end if;
 perform public.reverse_sale_staff_effects(s,audit);
 -- Lock aggregate stocks before layers, matching the shared FIFO lock order.
 for r in select distinct warehouse_id,item_id from public.stock_moves where source_ref=s.no_struk and source in('sale','sale-group','sale-online') order by warehouse_id,item_id loop
  perform 1 from public.stock where warehouse_id=r.warehouse_id and item_id=r.item_id and qty>=0 for update;
  if not found then raise exception 'Saldo stok saat ini negatif atau hilang; rekonsiliasi diperlukan';end if;
 end loop;
 for r in select * from public.stock_moves where source_ref=s.no_struk and source in('sale','sale-group','sale-online') order by warehouse_id,item_id,id loop
  if (select sum(x.qty) from jsonb_to_recordset(r.fifo_takes) x(qty numeric)) is distinct from -r.qty
   or round((select sum(x.qty*x.unit_cost) from jsonb_to_recordset(r.fifo_takes) x(qty numeric,unit_cost numeric)),2) is distinct from round(-r.qty*r.unit_cost,2) then raise exception 'Snapshot lapisan FIFO tidak sesuai';end if;
  for t in select * from jsonb_to_recordset(r.fifo_takes) x(id uuid,qty numeric,unit_cost numeric,exp_date date) order by id loop
   select * into layer from public.stock_layers where id=t.id for update;
   if not found or layer.warehouse_id<>r.warehouse_id or layer.item_id<>r.item_id or t.qty<=0
    or layer.unit_cost is distinct from t.unit_cost or layer.exp_date is distinct from t.exp_date or layer.qty_left+t.qty>layer.qty_in then raise exception 'Lapisan FIFO sumber sudah berubah; rekonsiliasi diperlukan';end if;
   update public.stock_layers set qty_left=qty_left+t.qty where id=t.id;
  end loop;
  update public.stock set qty=qty-r.qty,updated_at=now() where warehouse_id=r.warehouse_id and item_id=r.item_id;
  insert into public.stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref) values(d,r.warehouse_id,r.item_id,-r.qty,r.unit_cost,'sale-void',audit::text);
 end loop;
 for j in select e.* from public.journal_entries e where e.source in(v_source,v_source||'-hpp') and e.source_ref=s.no_struk order by e.id loop
  reversal:=gen_random_uuid();reversals:=array_append(reversals,reversal);
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
   values(reversal,public.sales_next_number('JRN',d),d,'Pembatalan '||s.no_struk,case when j.source=v_source then 'sale-void' else 'sale-void-hpp' end,audit::text,s.branch_id);
  insert into public.journal_lines(entry_id,account_id,debit,credit) select reversal,account_id,credit,debit from public.journal_lines where entry_id=j.id;
 end loop;
 update public.sales set revision=revision+1,voided_at=now(),voided_by=auth.uid(),void_reason=btrim(p_reason) where id=s.id;
 if s.customer_id is not null then
  if v_delta<>0 then insert into public.point_ledger(customer_id,delta,saldo,ref,description) values(s.customer_id,-v_delta,balance-v_delta,s.no_struk,'Pembatalan '||s.no_struk);end if;
  select coalesce((select sum(a.total-a.merchant_fee_total) from public.sales a where a.customer_id=s.customer_id and a.voided_at is null and (a.payment_plan is null or a.payments_finalized_at is not null)),0)+coalesce((select sum(i.total) from public.invoices i join public.visits v on v.id=i.visit_id where v.customer_id=s.customer_id and i.paid_status='Lunas' and i.voided_at is null),0) into spending;
  update public.customers set points=balance-v_delta,total_spending=spending,tier=case when spending>=coalesce((select platinum_min from public.tier_settings where id=1),50000000) then 'Platinum' when spending>=coalesce((select gold_min from public.tier_settings where id=1),15000000) then 'Gold' when spending>=coalesce((select silver_min from public.tier_settings where id=1),5000000) then 'Silver' when spending>=coalesce((select bronze_min from public.tier_settings where id=1),1000000) then 'Bronze' else 'New' end where id=s.customer_id;
 end if;
 insert into public.sale_cancellations(id,sale_id,branch_id,reason,before_value,reversal_journal_ids,created_by) values(audit,s.id,s.branch_id,btrim(p_reason),to_jsonb(s),reversals,auth.uid());
 result:=jsonb_build_object('sale_id',s.id,'audit_id',audit,'revision',s.revision+1,'voided',true);
 insert into public.sale_cancellation_requests(actor_id,request_key,sale_id,payload,result) values(auth.uid(),p_request_key,s.id,payload,result);
 return result;
end $$;
revoke all on function public.cancel_posted_sale(uuid,integer,text,text) from public,anon,service_role;
grant execute on function public.cancel_posted_sale(uuid,integer,text,text) to authenticated;

-- Redemption and claims share the same employee lock as sale award/reversal.
create table public.staff_reward_requests (
 staff_id uuid not null references public.profiles(id), request_key text not null,
 reward_id uuid not null references public.staff_reward_catalog(id), result jsonb not null,
 created_at timestamptz not null default now(), primary key(staff_id,request_key)
);
alter table public.staff_reward_requests enable row level security;
revoke all on public.staff_reward_requests from public,anon,authenticated,service_role;
create function public.staff_reward_assert_actor() returns void
language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','ADMIN','FINANCE','STAFF','DOCTOR') for update;
 if not found then raise exception 'Akun staf aktif diperlukan' using errcode='42501';end if;
end$$;
revoke all on function public.staff_reward_assert_actor() from public,anon,authenticated,service_role;
create function public.redeem_staff_reward(p_reward_id uuid,p_request_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare reward public.staff_reward_catalog%rowtype;prior public.staff_reward_requests%rowtype;balance integer;redemption uuid;result jsonb;
begin
 perform public.staff_reward_assert_actor();
 if p_reward_id is null or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 then raise exception 'Identitas penukaran tidak valid';end if;
 select * into prior from public.staff_reward_requests where staff_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.reward_id<>p_reward_id then raise exception 'Permintaan sudah digunakan untuk hadiah berbeda';end if;
  return prior.result;
 end if;
 select * into reward from public.staff_reward_catalog where id=p_reward_id and is_active for share;
 if not found or reward.points_cost<=0 then raise exception 'Reward tidak tersedia';end if;
 select total_points into balance from public.staff_points where staff_id=auth.uid() for update;
 if coalesce(balance,0)<reward.points_cost then raise exception 'Poin belum cukup untuk reward ini';end if;
 insert into public.staff_reward_redemptions(staff_id,reward_catalog_id,points_spent)
  values(auth.uid(),reward.id,reward.points_cost) returning id into redemption;
 insert into public.staff_points_ledger(staff_id,points_delta,source_type,source_id,notes)
  values(auth.uid(),-reward.points_cost,'reward_redemption',redemption,'Tukar: '||reward.reward_name);
 update public.staff_points set total_points=total_points-reward.points_cost,updated_at=clock_timestamp() where staff_id=auth.uid();
 result:=jsonb_build_object('redemption_id',redemption);
 insert into public.staff_reward_requests(staff_id,request_key,reward_id,result) values(auth.uid(),p_request_key,reward.id,result);
 return result;
end$$;
revoke all on function public.redeem_staff_reward(uuid,text) from public,anon,service_role;
grant execute on function public.redeem_staff_reward(uuid,text) to authenticated;
create function public.claim_staff_quest(p_progress_id uuid) returns void
language plpgsql security definer set search_path='' as $$begin
 perform public.staff_reward_assert_actor();
 update public.staff_quest_progress set status='claimed',claimed_at=clock_timestamp()
  where id=p_progress_id and staff_id=auth.uid() and status='completed';
end$$;
revoke all on function public.claim_staff_quest(uuid) from public,anon,service_role;
grant execute on function public.claim_staff_quest(uuid) to authenticated;
-- Old clients cannot overwrite a concurrently restored reward balance or invent awards.
create function public.guard_staff_reward_writes() returns trigger
language plpgsql set search_path='' as $$begin
 if current_user in('authenticated','anon','service_role') then
  if tg_table_name='staff_reward_redemptions' and tg_op='UPDATE' then
   if (to_jsonb(new)-array['status','fulfilled_by','fulfilled_at']) is not distinct from (to_jsonb(old)-array['status','fulfilled_by','fulfilled_at'])
    and old.status='pending_fulfillment' and new.status='fulfilled' and new.fulfilled_by=auth.uid() and new.fulfilled_at is not null
    and exists(select 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','ADMIN')) then return new;end if;
  end if;
  raise exception 'Gunakan proses hadiah staf yang tervalidasi' using errcode='42501';
 end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_staff_reward_writes() from public,anon,authenticated,service_role;
create trigger staff_points_atomic_guard before insert or update or delete on public.staff_points for each row execute function public.guard_staff_reward_writes();
create trigger staff_ledger_atomic_guard before insert or update or delete on public.staff_points_ledger for each row execute function public.guard_staff_reward_writes();
create trigger staff_streak_atomic_guard before insert or update or delete on public.staff_streaks for each row execute function public.guard_staff_reward_writes();
create trigger staff_progress_atomic_guard before insert or update or delete on public.staff_quest_progress for each row execute function public.guard_staff_reward_writes();
create trigger staff_redemption_atomic_guard before insert or update or delete on public.staff_reward_redemptions for each row execute function public.guard_staff_reward_writes();
