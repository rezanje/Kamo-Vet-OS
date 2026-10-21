-- Financial valuation is independent of physical FEFO acquisition layers.
alter table public.stock add column average_cost numeric
 check(average_cost is null or (average_cost>0 and average_cost::text not in('NaN','Infinity','-Infinity')));
alter table public.stock_moves add column cost_method text not null default 'fifo'
 check (cost_method in ('fifo','moving_average')),
 add column valuation_adjustment numeric not null default 0;

create table public.inventory_costing_settings (
 id boolean primary key default true check(id),
 method text not null default 'fifo' check(method in ('fifo','moving_average')),
 activated_at timestamptz, activated_by uuid references public.profiles(id),
 closed_through date
);
insert into public.inventory_costing_settings(id) values(true);
create table public.inventory_cost_events (
 id bigint generated always as identity primary key,
 movement_id uuid unique references public.stock_moves(id),
 warehouse_id uuid not null references public.warehouses(id),
 item_id uuid not null references public.items(id), tanggal date not null,
 source text not null, source_ref text, qty_delta numeric not null,
 value_delta numeric, qty_after numeric not null, value_after numeric,
 average_before numeric, average_after numeric, variance numeric,
 created_at timestamptz not null default clock_timestamp()
);
create index inventory_cost_events_asof on public.inventory_cost_events(warehouse_id,item_id,tanggal desc,id desc);
create table public.inventory_month_closes (
 id uuid primary key default gen_random_uuid(), period date not null unique,
 closed_through date not null, closed_at timestamptz not null default clock_timestamp(),
 closed_by uuid not null references public.profiles(id),
 snapshot_count integer not null default 0, total_value numeric not null default 0
);
create table public.inventory_month_values (
 close_id uuid not null references public.inventory_month_closes(id),
 warehouse_id uuid not null references public.warehouses(id), item_id uuid not null references public.items(id),
 qty numeric not null, average_cost numeric, value numeric,
 primary key(close_id,warehouse_id,item_id)
);
alter table public.inventory_costing_settings enable row level security;
alter table public.inventory_cost_events enable row level security;
alter table public.inventory_month_closes enable row level security;
alter table public.inventory_month_values enable row level security;
revoke all on public.inventory_costing_settings,public.inventory_cost_events,public.inventory_month_closes,public.inventory_month_values from public,anon,authenticated,service_role;
grant select on public.inventory_costing_settings,public.inventory_cost_events,public.inventory_month_closes,public.inventory_month_values to authenticated;
-- Header dates are global; monetary totals and counts must not bypass the
-- warehouse-scoped snapshot policy through a direct REST table request.
revoke select on public.inventory_month_closes from authenticated;
grant select(id,period,closed_through,closed_at,closed_by) on public.inventory_month_closes to authenticated;
create policy inventory_costing_read on public.inventory_costing_settings for select to authenticated using(true);
create policy inventory_events_read on public.inventory_cost_events for select to authenticated using(exists(select 1 from public.warehouses w where w.id=warehouse_id and public.user_can_access_branch(w.branch_id)));
create policy inventory_closes_read on public.inventory_month_closes for select to authenticated using(exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role in('OWNER','FINANCE')));
create policy inventory_values_read on public.inventory_month_values for select to authenticated using(exists(select 1 from public.warehouses w where w.id=warehouse_id and public.user_can_access_branch(w.branch_id)));

-- Statement locks are acquired before aggregate/layer tuple locks. A close takes
-- the exclusive form, so it never snapshots half of a multi-item transaction.
create function public.inventory_period_statement_lock() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform pg_advisory_xact_lock_shared(1962072401::bigint); return null; end $$;
revoke all on function public.inventory_period_statement_lock() from public,anon,authenticated,service_role;
create trigger inventory_stock_period_lock before insert or update or delete on public.stock for each statement execute function public.inventory_period_statement_lock();
create trigger inventory_layers_period_lock before insert or update or delete on public.stock_layers for each statement execute function public.inventory_period_statement_lock();
create trigger inventory_moves_period_lock before insert or update or delete on public.stock_moves for each statement execute function public.inventory_period_statement_lock();

create function public.inventory_guard_direct_write() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if current_user in('authenticated','anon','service_role') and public.inventory_is_average()
  and coalesce(current_setting('vetos.inventory_mutation',true),'')<>'on' then
  if tg_table_name='stock' and tg_op='INSERT' then
   if new.qty=0 and new.average_cost is null then return new;end if;
  end if;
  raise exception 'Gunakan dokumen mutasi persediaan resmi; saldo, lapisan dan nilai average tidak dapat ditulis langsung' using errcode='42501';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.inventory_guard_direct_write() from public,anon,authenticated,service_role;
create trigger inventory_direct_stock_guard before insert or update or delete on public.stock for each row execute function public.inventory_guard_direct_write();
create trigger inventory_direct_layer_guard before insert or update or delete on public.stock_layers for each row execute function public.inventory_guard_direct_write();
create trigger inventory_direct_move_guard before insert or update or delete on public.stock_moves for each row execute function public.inventory_guard_direct_write();

create function public.inventory_is_average() returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock_shared(1962072401::bigint);
 return (select method='moving_average' from public.inventory_costing_settings where id);
end $$;
revoke all on function public.inventory_is_average() from public,anon;
grant execute on function public.inventory_is_average() to authenticated,service_role;

create function public.inventory_assert_open_date(p_date date) returns void
language plpgsql security definer set search_path='' as $$
declare cutoff date;accounting_cutoff date;
begin
 perform pg_advisory_xact_lock_shared(1962072401::bigint);
 if p_date is null then raise exception 'Tanggal mutasi persediaan wajib diisi';end if;
 select closed_until into accounting_cutoff from public.accounting_locks where id;
 if p_date<=accounting_cutoff then raise exception 'Periode akuntansi sampai % sudah ditutup.',accounting_cutoff;end if;
 select closed_through into cutoff from public.inventory_costing_settings where id;
 if p_date<=cutoff then raise exception 'Periode persediaan sampai % sudah ditutup. Tanggal mutasi atau koreksi harus setelah periode terkunci.',cutoff;end if;
end $$;
revoke all on function public.inventory_assert_open_date(date) from public,anon;
grant execute on function public.inventory_assert_open_date(date) to authenticated,service_role;

create function public.inventory_effective_unit_cost(p_warehouse uuid,p_item uuid) returns numeric
language plpgsql security definer set search_path='' as $$
declare result numeric;master numeric;
begin
 perform pg_advisory_xact_lock_shared(1962072401::bigint);
 if current_setting('role',true) in('authenticated','anon') and (auth.uid() is null or not exists(select 1 from public.warehouses w where w.id=p_warehouse and public.user_can_access_branch(w.branch_id))) then raise exception 'Akses harga pokok gudang ditolak' using errcode='42501';end if;
 select average_cost into result from public.stock where warehouse_id=p_warehouse and item_id=p_item;
 if result>0 then return result;end if;
 select known.unit_cost into result from (
  select l.unit_cost,l.tanggal,l.created_at,0 priority,l.id,l.source,l.source_ref from public.stock_layers l
   where l.warehouse_id=p_warehouse and l.item_id=p_item and l.unit_cost>0 and l.tanggal<=(now() at time zone 'Asia/Jakarta')::date and not public.stock_layer_cost_was_reversed(l.id)
  union all
  select m.unit_cost,m.tanggal,m.created_at,1 priority,m.id,m.source,m.source_ref from public.stock_moves m
   where m.warehouse_id=p_warehouse and m.item_id=p_item and m.qty>0 and m.unit_cost>0 and m.tanggal<=(now() at time zone 'Asia/Jakarta')::date and m.source not in('sale-void','purchase-invoice-void')
 ) known where not exists(select 1 from public.purchase_invoices i where known.source='faktur-langsung' and i.no_faktur=known.source_ref and i.voided_at is not null)
 order by known.tanggal desc,known.created_at desc,known.priority,known.id desc limit 1;
 select buy_price into master from public.items where id=p_item;
 return coalesce(result,nullif(greatest(master,0),0),0);
end $$;
revoke all on function public.inventory_effective_unit_cost(uuid,uuid) from public,anon;
grant execute on function public.inventory_effective_unit_cost(uuid,uuid) to authenticated,service_role;

create function public.inventory_assert_finance_actor() returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and (
  p.role='OWNER' or (p.role='FINANCE' and (not exists(select 1 from public.role_modules r where r.role=p.role)
   or exists(select 1 from public.role_modules r where r.role=p.role and r.module_id='buku-besar')))))
 or exists(select 1 from public.branches b where not public.user_can_access_branch(b.id)) then
  raise exception 'Aktivasi/closing HPP hanya oleh OWNER atau FINANCE dengan akses seluruh cabang' using errcode='42501';
 end if;
end $$;
revoke all on function public.inventory_assert_finance_actor() from public,anon,authenticated,service_role;

create function public.activate_moving_average() returns jsonb
language plpgsql security definer set search_path='' as $$
declare s record;l record;price numeric;stamp timestamptz:=clock_timestamp();
begin
 perform public.inventory_assert_finance_actor();
 perform pg_advisory_xact_lock(1962072401::bigint);
 if (select method='moving_average' from public.inventory_costing_settings where id) then
  return jsonb_build_object('method','moving_average','activated_at',(select activated_at from public.inventory_costing_settings where id),'already_active',true);
 end if;
 if exists(select 1 from public.stock_moves where tanggal>(stamp at time zone 'Asia/Jakarta')::date) then raise exception 'Ada mutasi bertanggal masa depan; rekonsiliasi sebelum aktivasi average';end if;
 for s in select st.*,i.item_type,i.code item_code,i.name item_name from public.stock st join public.items i on i.id=st.item_id where coalesce(i.item_type,'Persediaan')='Persediaan' order by st.warehouse_id,st.item_id for update of st loop
  select coalesce(sum(qty_left),0) qty,coalesce(sum(qty_left*unit_cost),0) value,coalesce(bool_or(qty_left>0 and unit_cost<=0),false) unpriced into l from public.stock_layers where warehouse_id=s.warehouse_id and item_id=s.item_id;
  if s.qty::text in('NaN','Infinity','-Infinity') or l.value::text in('NaN','Infinity','-Infinity') or l.qty<>greatest(s.qty,0) or (s.qty>0 and l.unpriced) then raise exception 'Saldo stok atau HPP awal belum lengkap. Rekonsiliasi barang % (%) sebelum aktivasi average.',s.item_name,s.item_code;end if;
  if s.qty>0 then price:=l.value/s.qty;else price:=nullif(public.inventory_effective_unit_cost(s.warehouse_id,s.item_id),0);end if;
  update public.stock set average_cost=price where id=s.id;
  insert into public.inventory_cost_events(warehouse_id,item_id,tanggal,source,qty_delta,value_delta,qty_after,value_after,average_after)
   values(s.warehouse_id,s.item_id,(stamp at time zone 'Asia/Jakarta')::date,'average-activation',s.qty,case when s.qty=0 then 0 else s.qty*price end,s.qty,case when s.qty=0 then 0 else s.qty*price end,price);
 end loop;
 update public.inventory_costing_settings set method='moving_average',activated_at=stamp,activated_by=auth.uid() where id;
 return jsonb_build_object('method','moving_average','activated_at',stamp,'already_active',false);
end $$;
revoke all on function public.activate_moving_average() from public,anon,service_role;
grant execute on function public.activate_moving_average() to authenticated;

create function public.inventory_guard_cost_write() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if current_user in('authenticated','anon','service_role') and
  ((tg_op='INSERT' and new.average_cost is not null) or (tg_op='UPDATE' and new.average_cost is distinct from old.average_cost)) then
  raise exception 'Harga pokok average dikelola proses persediaan resmi' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.inventory_guard_cost_write() from public,anon,authenticated,service_role;
create trigger inventory_average_write_guard before insert or update of average_cost on public.stock for each row execute function public.inventory_guard_cost_write();

create function public.inventory_guard_movement() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op<>'INSERT' then
  perform public.inventory_assert_open_date(old.tanggal);
  if exists(select 1 from public.inventory_cost_events where movement_id=old.id)
   and not (tg_op='UPDATE' and (to_jsonb(new)-'sale_line_id')=(to_jsonb(old)-'sale_line_id')) then
   raise exception 'Mutasi bernilai average tidak dapat diubah/hapus; gunakan dokumen koreksi';
  end if;
 end if;
 if tg_op<>'DELETE' then
  perform public.inventory_assert_open_date(new.tanggal);
  if tg_op='INSERT' then new.cost_method:=case when public.inventory_is_average() then 'moving_average' else 'fifo' end;end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.inventory_guard_movement() from public,anon,authenticated,service_role;
create trigger inventory_movement_period_guard before insert or update or delete on public.stock_moves for each row execute function public.inventory_guard_movement();

create function public.inventory_guard_layer_date() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then perform public.inventory_assert_open_date(new.tanggal);
 elsif tg_op='DELETE' then perform public.inventory_assert_open_date(old.tanggal);
 elsif (new.unit_cost,new.qty_in,new.tanggal,new.source,new.source_ref) is distinct from (old.unit_cost,old.qty_in,old.tanggal,old.source,old.source_ref) then
  perform public.inventory_assert_open_date(old.tanggal);perform public.inventory_assert_open_date(new.tanggal);
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.inventory_guard_layer_date() from public,anon,authenticated,service_role;
create trigger inventory_layer_period_guard before insert or update or delete on public.stock_layers for each row execute function public.inventory_guard_layer_date();

create function public.inventory_record_valuation() returns trigger
language plpgsql security definer set search_path='' as $$
declare st public.stock%rowtype;before_qty numeric;before_avg numeric;after_avg numeric;
 before_value numeric;after_value numeric;delta numeric;variance numeric;branch uuid;amount numeric;
begin
 if new.cost_method<>'moving_average' then return new;end if;
 select * into strict st from public.stock where warehouse_id=new.warehouse_id and item_id=new.item_id for update;
 if exists(select 1 from public.inventory_cost_events e where e.warehouse_id=new.warehouse_id and e.item_id=new.item_id and e.tanggal>new.tanggal) then raise exception 'Mutasi mendahului riwayat average terakhir; gunakan koreksi periode berjalan';end if;
 before_qty:=st.qty-new.qty;before_avg:=st.average_cost;
 before_value:=case when before_qty=0 then 0 else before_qty*before_avg end;
 if new.qty>0 then
  if before_qty>0 then
   if before_avg is null then raise exception 'Harga pokok persediaan awal belum tersedia; rekonsiliasi sebelum penerimaan';end if;
   after_avg:=(before_qty*before_avg+new.qty*new.unit_cost)/(before_qty+new.qty);
  else after_avg:=nullif(new.unit_cost,0);end if;
 elsif new.qty<0 and new.source='purchase-invoice-void' then
  if st.qty>0 then after_avg:=(before_value+new.qty*new.unit_cost)/st.qty;
  elsif st.qty=0 then after_avg:=before_avg;else raise exception 'Pembatalan pembelian membuat stok negatif';end if;
 else after_avg:=coalesce(before_avg,nullif(new.unit_cost,0));end if;
 if new.valuation_adjustment<>0 then
  if st.qty<=0 or after_avg is null then raise exception 'Penyesuaian HPP memerlukan stok tersisa dan harga pokok yang diketahui';end if;
  after_avg:=(st.qty*after_avg+new.valuation_adjustment)/st.qty;
 end if;
 if after_avg<0 then raise exception 'Koreksi menghasilkan harga pokok negatif; rekonsiliasi diperlukan';end if;
 after_avg:=nullif(round(after_avg,12),0);
 after_value:=case when st.qty=0 then 0 else st.qty*after_avg end;
 delta:=after_value-before_value;
 variance:=new.qty*new.unit_cost+new.valuation_adjustment-delta;
 update public.stock set average_cost=after_avg where id=st.id;
 insert into public.inventory_cost_events(movement_id,warehouse_id,item_id,tanggal,source,source_ref,qty_delta,value_delta,qty_after,value_after,average_before,average_after,variance)
 values(new.id,new.warehouse_id,new.item_id,new.tanggal,new.source,new.source_ref,new.qty,delta,st.qty,after_value,before_avg,after_avg,variance);
 -- Resetting an average over negative stock changes its carrying estimate. The
 -- difference belongs to this receipt's period, never to an immutable old sale.
 if new.qty>0 and before_qty<0 and abs(variance)>=0.005 then
  amount:=round(abs(variance),2);
  select branch_id into branch from public.warehouses where id=new.warehouse_id;
  perform public.sales_write_journal(new.tanggal,branch,'inventory-variance',new.id::text,'Penyesuaian HPP stok minus',jsonb_build_array(
   jsonb_build_object('code','5101','debit',case when variance>0 then amount else 0 end,'credit',case when variance<0 then amount else 0 end),
   jsonb_build_object('code','1301','debit',case when variance<0 then amount else 0 end,'credit',case when variance>0 then amount else 0 end)));
 end if;
 return new;
end $$;
revoke all on function public.inventory_record_valuation() from public,anon,authenticated,service_role;
create trigger inventory_movement_valuation after insert on public.stock_moves for each row execute function public.inventory_record_valuation();

create function public.inventory_guard_journal() returns trigger
language plpgsql security invoker set search_path='' as $$
declare protected boolean;
begin
 if current_user in('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then
   protected:=coalesce(new.source in('inventory-variance','saldo-awal-accurate'),false) or coalesce(old.source in('inventory-variance','saldo-awal-accurate'),false);
  else
   select exists(select 1 from public.journal_entries e where e.id in(new.entry_id,old.entry_id) and e.source in('inventory-variance','saldo-awal-accurate')) into protected;
  end if;
  if protected then raise exception 'Jurnal persediaan sumber dilindungi; gunakan proses koreksi resmi' using errcode='42501';end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.inventory_guard_journal() from public,anon,authenticated,service_role;
create trigger inventory_journal_header_guard before insert or update or delete on public.journal_entries for each row execute function public.inventory_guard_journal();
create trigger inventory_journal_line_guard before insert or update or delete on public.journal_lines for each row execute function public.inventory_guard_journal();

create function public.inventory_apply_cost_adjustment(p_warehouse uuid,p_item uuid,p_delta numeric,p_tanggal date,p_source text,p_ref text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.inventory_assert_open_date(p_tanggal);
 if not public.inventory_is_average() or p_delta=0 then return;end if;
 perform 1 from public.stock where warehouse_id=p_warehouse and item_id=p_item for update;
 if not found then raise exception 'Saldo stok koreksi tidak ditemukan';end if;
 insert into public.stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref,valuation_adjustment)
 values(p_tanggal,p_warehouse,p_item,0,0,p_source,p_ref,p_delta);
end $$;
revoke all on function public.inventory_apply_cost_adjustment(uuid,uuid,numeric,date,text,text) from public,anon,authenticated,service_role;

create function public.close_inventory_month(p_month date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ending date;stamp timestamptz;closing public.inventory_month_closes%rowtype;cutoff date;
begin
 perform public.inventory_assert_finance_actor();
 perform pg_advisory_xact_lock(1962072401::bigint);
 if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'Pilih bulan closing yang valid';end if;
 ending:=(p_month+interval '1 month - 1 day')::date;
 if ending>=(now() at time zone 'Asia/Jakarta')::date then raise exception 'Closing HPP hanya untuk bulan yang sudah selesai';end if;
 select * into closing from public.inventory_month_closes where period=p_month;
 if found then return jsonb_build_object('close_id',closing.id,'period',closing.period,'snapshot_count',closing.snapshot_count,'already_closed',true);end if;
 select activated_at,closed_through into stamp,cutoff from public.inventory_costing_settings where id and method='moving_average';
 if stamp is null then raise exception 'Aktifkan moving average sebelum closing HPP';end if;
 if p_month<date_trunc('month',stamp at time zone 'Asia/Jakarta')::date then raise exception 'Bulan closing mendahului aktivasi moving average';end if;
 if cutoff is not null and p_month<>(date_trunc('month',cutoff)+interval '1 month')::date then raise exception 'Closing HPP harus berurutan setelah bulan terakhir ditutup';end if;
 if exists(select 1 from (select distinct on(warehouse_id,item_id) qty_after,value_after from public.inventory_cost_events where tanggal<=ending order by warehouse_id,item_id,tanggal desc,id desc)e where qty_after<>0 and value_after is null) then raise exception 'Ada persediaan tanpa HPP; rekonsiliasi sebelum closing';end if;
 insert into public.inventory_month_closes(period,closed_through,closed_by) values(p_month,ending,auth.uid()) returning * into closing;
 insert into public.inventory_month_values(close_id,warehouse_id,item_id,qty,average_cost,value)
 select closing.id,e.warehouse_id,e.item_id,e.qty_after,e.average_after,e.value_after from (
  select distinct on(warehouse_id,item_id) * from public.inventory_cost_events where tanggal<=ending order by warehouse_id,item_id,tanggal desc,id desc
 ) e;
 update public.inventory_month_closes set snapshot_count=(select count(*) from public.inventory_month_values where close_id=closing.id),total_value=(select coalesce(sum(value),0) from public.inventory_month_values where close_id=closing.id) where id=closing.id returning * into closing;
 update public.inventory_costing_settings set closed_through=ending where id;
 return jsonb_build_object('close_id',closing.id,'period',closing.period,'snapshot_count',closing.snapshot_count,'total_value',closing.total_value,'already_closed',false);
end $$;
revoke all on function public.close_inventory_month(date) from public,anon,service_role;
grant execute on function public.close_inventory_month(date) to authenticated;

-- Preserve deployed FIFO behavior until activation; keep the existing function
-- OIDs, owners, ACLs, argument/return contracts and physical takes intact.
do $cutover$
declare body text;marker text;
begin
 body:=pg_get_functiondef('public.stock_out_fifo(uuid,uuid,numeric,text,text,date)'::regprocedure);
 marker:=E'  v_unpriced_qty numeric := 0;';
 if strpos(body,marker)=0 then raise exception 'Unexpected FIFO definition for average cutover';end if;
 body:=replace(body,marker,marker||E'\n  v_use_average boolean;\n  v_average numeric;\n  v_previous_mutation text;');
 body:=replace(body,E'begin\n  -- Retain the atomic transfer',E'begin\n  perform public.inventory_assert_open_date(coalesce(p_tanggal,current_date));\n  v_use_average:=public.inventory_is_average();\n  -- Retain the atomic transfer');
 marker:=E'  v_left := p_qty;';
 body:=replace(body,marker,E'  if v_use_average then v_average:=public.inventory_effective_unit_cost(p_warehouse_id,p_item_id); end if;\n'||marker);
 body:=replace(body,E'  -- Ensure an aggregate row exists, then lock it before any FIFO layer.',E'  v_previous_mutation:=current_setting(''vetos.inventory_mutation'',true);\n  perform set_config(''vetos.inventory_mutation'',''on'',true);\n  -- Ensure an aggregate row exists, then lock it before any FIFO layer.');
 -- The deployed shortage fix uses a different comment at this insertion point.
 body:=replace(body,E'  -- Keep the aggregate-before-layer lock order used by receipts and repricing.',E'  v_previous_mutation:=current_setting(''vetos.inventory_mutation'',true);\n  perform set_config(''vetos.inventory_mutation'',''on'',true);\n  -- Keep the aggregate-before-layer lock order used by receipts and repricing.');
 body:=replace(body,'if v_shortfall > 0 or v_unpriced_qty > 0 then','if not v_use_average and (v_shortfall > 0 or v_unpriced_qty > 0) then');
 marker:=E'  update public.stock\n  set qty = qty - p_qty';
 if strpos(body,marker)=0 then raise exception 'FIFO issue insertion point missing';end if;
 body:=replace(body,marker,E'  if v_use_average then\n    if v_average<=0 and p_source in (''sale'',''sale-group'',''sale-online'') then\n      raise exception ''Harga pokok barang % belum tersedia. Isi harga beli barang sebelum penjualan.'',v_item.name;\n    end if;\n    v_cost:=p_qty*v_average;v_fallback_cost:=v_average;\n  end if;\n'||marker);
 body:=replace(body,'  return query select v_cost, v_takes, v_shortfall, coalesce(v_fallback_cost, v_item.buy_price);',E'  perform set_config(''vetos.inventory_mutation'',coalesce(v_previous_mutation,''''),true);\n  return query select v_cost, v_takes, v_shortfall, coalesce(v_fallback_cost, v_item.buy_price);');
 execute body;
 body:=pg_get_functiondef('public.stock_in_fifo(uuid,uuid,numeric,numeric,text,text,date,date)'::regprocedure);
 if strpos(body,E'begin\n  if p_qty')=0 then raise exception 'Unexpected stock-in definition';end if;
 body:=replace(body,'  v_qty_layer numeric;',E'  v_qty_layer numeric;\n  v_previous_mutation text;');
 body:=replace(body,E'begin\n  if p_qty',E'begin\n  perform public.inventory_assert_open_date(coalesce(p_tanggal,current_date));\n  if p_qty');execute body;
 body:=replace(body,'  insert into public.stock(warehouse_id, item_id, qty)',E'  v_previous_mutation:=current_setting(''vetos.inventory_mutation'',true);\n  perform set_config(''vetos.inventory_mutation'',''on'',true);\n  insert into public.stock(warehouse_id, item_id, qty)');
 body:=replace(body,E'  );\nend;',E'  );\n  perform set_config(''vetos.inventory_mutation'',coalesce(v_previous_mutation,''''),true);\nend;');execute body;
 body:=pg_get_functiondef('public.stock_transfer_fifo_exact(uuid,uuid,uuid,numeric,text,text,date)'::regprocedure);
 body:=replace(body,'(v_take->>''unit_cost'')::numeric','case when public.inventory_is_average() then v_result.cost/p_qty else (v_take->>''unit_cost'')::numeric end');execute body;
end $cutover$;
