-- Backoffice /pos/transaksi atomic posting (pos_backoffice_post_atomic).
-- Fictional data in a disposable PostgreSQL only; the whole suite rolls back.
--
-- Proves:
--  1. parity: the atomic RPC leaves exactly the same per-line HPP, FIFO moves, layers,
--     stock, journals and points as a literal replay of the old per-line action path
--     (sale_stock_out_fifo per line in cart order, HPP update, then finalize_pos_sale);
--  2. a failure on a later line (or in the finalizer) leaves no stock_moves, no layer
--     consumption, no stock change, no HPP and no journal;
--  3. retrying after a failure issues stock exactly once; retrying after success and
--     re-running a receipt the old writer already touched never issue again;
--  4. backoffice behaviour kept: services-only carts finalize, no price floor, Grup and
--     non-stock lines issue nothing, sales with or without a shift, actor/branch guards.
begin;
create function pg_temp.ok(value boolean, label text) returns text language plpgsql as $$begin
 if value is distinct from true then raise exception 'Assertion failed: %',label;end if;return 'PASS '||label;end$$;
create function pg_temp.must_reject(stmt text, pattern text, label text) returns text language plpgsql as $$
declare message text;begin
 begin execute stmt;exception when others then
  get stacked diagnostics message=message_text;
  if message !~ pattern then raise exception 'WRONG REJECTION %: %',label,message;end if;
  return 'PASS '||label||' ['||message||']';
 end;
 raise exception 'Expected rejection: %',label;
end$$;

insert into auth.users(id,raw_user_meta_data) values
 ('eb100000-0000-4000-8000-000000000001','{"full_name":"Backoffice cashier"}'),
 ('eb100000-0000-4000-8000-000000000002','{"full_name":"Other branch cashier"}'),
 ('eb100000-0000-4000-8000-000000000003','{"full_name":"Owner"}');
update profiles set role='STAFF',is_active=true where id in
 ('eb100000-0000-4000-8000-000000000001','eb100000-0000-4000-8000-000000000002');
update profiles set role='OWNER',is_active=true where id='eb100000-0000-4000-8000-000000000003';
insert into role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into branches(id,code,name,type) values
 ('eb200000-0000-4000-8000-000000000001','BOAPOS','Backoffice atomic','PETSHOP'),
 ('eb200000-0000-4000-8000-000000000002','BOAOTHER','Backoffice other','PETSHOP');
insert into user_branches(user_id,branch_id) values
 ('eb100000-0000-4000-8000-000000000001','eb200000-0000-4000-8000-000000000001'),
 ('eb100000-0000-4000-8000-000000000002','eb200000-0000-4000-8000-000000000002'),
 ('eb100000-0000-4000-8000-000000000003','eb200000-0000-4000-8000-000000000001');
insert into warehouses(id,branch_id,code,name,type,is_active) values
 ('eb300000-0000-4000-8000-000000000001','eb200000-0000-4000-8000-000000000001','BOAWH','Backoffice warehouse','RETAIL',true),
 ('eb300000-0000-4000-8000-000000000002','eb200000-0000-4000-8000-000000000002','BOAOTHERWH','Other warehouse','RETAIL',true),
 ('eb300000-0000-4000-8000-000000000003','eb200000-0000-4000-8000-000000000001','BOAOLDWH','Inactive warehouse','VET',false);
-- item ids are chosen so the canonical (item_id) issue order differs from cart order
insert into items(id,code,name,unit,item_type,buy_price) values
 ('eb500000-0000-4000-8000-000000000001','BOA-A','Fictional food A','pcs','Persediaan',10),
 ('eb500000-0000-4000-8000-000000000002','BOA-B','Fictional food B','pcs','Persediaan',20),
 ('eb500000-0000-4000-8000-000000000003','BOA-S','Fictional grooming','x','Jasa',0),
 ('eb500000-0000-4000-8000-000000000004','BOA-G','Fictional bundle','set','Grup',0),
 ('eb500000-0000-4000-8000-000000000005','BOA-N','Fictional bag','pcs','Non-Persediaan',0),
 ('eb500000-0000-4000-8000-000000000009','BOA-Z','Fictional unpriced','pcs','Persediaan',0);
insert into item_units(item_id,unit,factor,sell_price,buy_price) values
 ('eb500000-0000-4000-8000-000000000001','box',2,90,0);
insert into item_group_components(group_item_id,component_item_id,qty,unit,factor) values
 ('eb500000-0000-4000-8000-000000000004','eb500000-0000-4000-8000-000000000002',1,'pcs',1);
-- A has an older cheap layer and a newer dearer one, so per-line cost depends on order.
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values
 ('eb300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Jakarta')::date-2,3,3,10,'purchase'),
 ('eb300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Jakarta')::date-1,10,10,12,'purchase'),
 ('eb300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000002',(now() at time zone 'Asia/Jakarta')::date,10,10,20,'purchase');
insert into stock(warehouse_id,item_id,qty) values
 ('eb300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000001',13),
 ('eb300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000002',10)
 on conflict (warehouse_id,item_id) do update set qty=excluded.qty;
insert into customers(id,name,phone,points) values('eb900000-0000-4000-8000-000000000001','BOA loyalty','000-boa-loyalty',5);
insert into cashier_shifts(id,branch_id,opened_by,shift_type) values
 ('eb400000-0000-4000-8000-000000000001','eb200000-0000-4000-8000-000000000001','eb100000-0000-4000-8000-000000000001','petshop');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1111','Test cash','ASET','D',false),('510001','Sales','PENDAPATAN','K',false),
 ('520002','Discount','PENDAPATAN','D',false),('312005','VAT','LIABILITAS','K',false),
 ('600001','COGS','BEBAN','D',false),('170001','Inventory','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values
 ('eb600000-0000-4000-8000-000000000001','BOA cash','Kas','1111');
insert into payment_account_map(metode,branch_id,cash_account_id) values
 ('Tunai','eb200000-0000-4000-8000-000000000001','eb600000-0000-4000-8000-000000000001') on conflict do nothing;
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false;

create function pg_temp.sale(p_ref text, p_gross numeric, p_net numeric, p_with_shift boolean default false,
 p_customer uuid default null, p_points integer default 0) returns uuid language plpgsql as $$
declare result uuid;begin
 insert into sales(branch_id,customer_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,
  payment_plan,checkout_key,checkout_fingerprint,poin_earned)
 values('eb200000-0000-4000-8000-000000000001',p_customer,p_ref,p_gross,p_gross-p_net,p_net,'Tunai',p_net,auth.uid(),
  case when p_with_shift then 'eb400000-0000-4000-8000-000000000001'::uuid end,
  case when p_net=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('method','Tunai','amount',p_net)) end,
  'sql:'||p_ref,repeat('b',64),p_points) returning id into result;
 return result;
end$$;
-- Mirrors the action's staged row: hpp 0 for catalogue lines, null for free-text lines.
create function pg_temp.line(p_ref text, p_item uuid, p_qty numeric, p_price numeric, p_pos integer,
 p_unit text default null, p_factor numeric default 1, p_line uuid default gen_random_uuid()) returns uuid language plpgsql as $$
declare result uuid;begin
 insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,target_species)
 select p_line,s.id,p_item,coalesce(i.name,'Ongkos manual'),p_qty,p_price,coalesce(p_unit,i.unit),p_factor,
  case when p_item is null then null else 0 end,p_pos,'Universal'
 from public.sales s left join public.items i on i.id=p_item where s.no_struk=p_ref returning sale_items.id into result;
 return result;
end$$;
create function pg_temp.sale_id(p_ref text) returns uuid language sql as $$select id from public.sales where no_struk=p_ref$$;
create function pg_temp.post(p_ref text, p_warehouse uuid default 'eb300000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select public.pos_backoffice_post_atomic(pg_temp.sale_id(p_ref),p_warehouse)$$;
-- Everything the posting can touch, without generated ids or the new line attribution.
create function pg_temp.snapshot(p_ref text) returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'finalized',(select payments_finalized_at is not null from sales where no_struk=p_ref),
  'line_hpp',(select jsonb_agg(jsonb_build_array(i.source_position,i.hpp) order by i.source_position)
   from sale_items i join sales s on s.id=i.sale_id where s.no_struk=p_ref),
  'moves',(select coalesce(jsonb_agg(jsonb_build_array(m.source,m.item_id,m.tanggal,m.qty,m.unit_cost,m.fifo_takes,m.fifo_shortfall)
   order by m.item_id,m.fifo_takes::text),'[]') from stock_moves m where m.source_ref=p_ref),
  'layers',(select jsonb_agg(jsonb_build_array(l.item_id,l.tanggal,l.unit_cost,l.qty_left) order by l.item_id,l.tanggal)
   from stock_layers l where l.warehouse_id='eb300000-0000-4000-8000-000000000001'),
  'stock',(select jsonb_agg(jsonb_build_array(item_id,qty) order by item_id) from stock
   where warehouse_id='eb300000-0000-4000-8000-000000000001'),
  'journals',(select coalesce(jsonb_agg(jsonb_build_array(e.source,e.tanggal,a.code,l.debit,l.credit) order by e.source,a.code,l.debit,l.credit),'[]')
   from journal_entries e join journal_lines l on l.entry_id=e.id join coa_accounts a on a.id=l.account_id where e.source_ref=p_ref),
  'points',(select coalesce(jsonb_agg(jsonb_build_array(customer_id,delta,saldo) order by delta),'[]') from point_ledger where ref=p_ref),
  'customer_points',(select points from customers where id='eb900000-0000-4000-8000-000000000001'))
$$;
-- Literal replay of the OLD per-line action path, then rolled back: one
-- sale_stock_out_fifo per catalogue line in cart order (no line identity, as the
-- action called it), HPP written to that line (0 for non-stock), then the finalizer.
create function pg_temp.old_path(p_ref text) returns jsonb language plpgsql as $$
declare s public.sales%rowtype;l record;c numeric;snap jsonb;
begin
 begin
  select * into strict s from public.sales where no_struk=p_ref;
  for l in select i.*,m.item_type from public.sale_items i left join public.items m on m.id=i.item_id
   where i.sale_id=s.id order by i.source_position loop
   continue when l.item_id is null;
   if l.item_type='Persediaan' then
    select x.cost into strict c from public.sale_stock_out_fifo('eb300000-0000-4000-8000-000000000001',
     l.item_id,l.qty*l.faktor,'sale',p_ref,(now() at time zone 'Asia/Jakarta')::date) x;
   else c:=0;
   end if;
   update public.sale_items set hpp=c where id=l.id and sale_id=s.id;
  end loop;
  perform public.finalize_pos_sale(s.id);
  snap:=pg_temp.snapshot(p_ref);
  raise exception using errcode='ZB001',message='BOA replay rollback';
 exception when sqlstate 'ZB001' then null;
 end;
 return snap;
end$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','eb100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);

select pg_temp.ok(not has_function_privilege('anon','public.pos_backoffice_post_atomic(uuid,uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.pos_backoffice_post_atomic(uuid,uuid)','EXECUTE')
 and has_function_privilege('authenticated','public.pos_backoffice_post_atomic(uuid,uuid)','EXECUTE'),
 'only signed-in staff can execute the backoffice posting');
select pg_temp.ok((select not prosecdef and array_to_string(proconfig,',') like 'search_path=%' from pg_proc
 where oid='public.pos_backoffice_post_atomic(uuid,uuid)'::regprocedure),'SECURITY INVOKER with pinned search_path (no privilege elevation)');

-- 1. Parity with the old per-line path. Cart: A 2pcs, service, B, A 1 box (=2pcs),
--    Grup, non-stock bag, free-text fee. The later A line gets the lower id, so an
--    id/created_at ordering would swap A's two FIFO costs; cart order must win.
select pg_temp.sale('BOA.PARITY',332,300,false,'eb900000-0000-4000-8000-000000000001',3);
select pg_temp.line('BOA.PARITY','eb500000-0000-4000-8000-000000000001',2,50,0,null,1,'eb700000-0000-4000-8000-0000000000ff');
select pg_temp.line('BOA.PARITY','eb500000-0000-4000-8000-000000000003',1,30,1);
select pg_temp.line('BOA.PARITY','eb500000-0000-4000-8000-000000000002',1,40,2);
select pg_temp.line('BOA.PARITY','eb500000-0000-4000-8000-000000000001',1,90,3,'box',2,'eb700000-0000-4000-8000-000000000001');
select pg_temp.line('BOA.PARITY','eb500000-0000-4000-8000-000000000004',1,60,4);
select pg_temp.line('BOA.PARITY','eb500000-0000-4000-8000-000000000005',1,5,5);
select pg_temp.line('BOA.PARITY',null,1,7,6);
select set_config('boa.before',pg_temp.snapshot('BOA.PARITY')::text,true);
select set_config('boa.expected',pg_temp.old_path('BOA.PARITY')::text,true);
select pg_temp.ok((current_setting('boa.expected')::jsonb->>'finalized')::boolean
 and current_setting('boa.expected')::jsonb->'line_hpp'='[[0,20],[1,0],[2,20],[3,22],[4,0],[5,0],[6,null]]'::jsonb,
 'old per-line path replay: A 2pcs=20 (old layer), A box=22 (1@10+1@12), B=20, others 0/null');
select pg_temp.ok(pg_temp.snapshot('BOA.PARITY')=current_setting('boa.before')::jsonb,'old-path replay fully rolled back before the atomic run');
select pg_temp.ok((pg_temp.post('BOA.PARITY')->>'stock_events')::integer=3,'atomic posting issues the three stock lines once each');
select pg_temp.ok(pg_temp.snapshot('BOA.PARITY')=current_setting('boa.expected')::jsonb,
 'atomic result identical to old path: per-line HPP, FIFO moves/takes, layers, stock, journals, points');
select pg_temp.ok((select count(*)=3 and count(distinct m.sale_line_id)=3 and bool_and(i.item_id=m.item_id and i.sale_id=pg_temp.sale_id('BOA.PARITY'))
 from stock_moves m join sale_items i on i.id=m.sale_line_id where m.source_ref='BOA.PARITY' and m.source='sale'),
 'every stock move now records its own source line');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='BOA.PARITY' and item_id in
 ('eb500000-0000-4000-8000-000000000003','eb500000-0000-4000-8000-000000000004','eb500000-0000-4000-8000-000000000005')),
 'service, Grup and non-stock lines issue nothing, as before');
select pg_temp.ok((select sum(l.debit) from journal_lines l join journal_entries e on e.id=l.entry_id
 where e.source='sale-hpp' and e.source_ref='BOA.PARITY')=62,'one HPP journal for the actual FIFO cost 62');

-- 2. A later line fails inside FIFO (no cost reference): nothing of the earlier lines stays.
select pg_temp.sale('BOA.MIDLINE',190,190);
select pg_temp.line('BOA.MIDLINE','eb500000-0000-4000-8000-000000000001',2,50,0);
select pg_temp.line('BOA.MIDLINE','eb500000-0000-4000-8000-000000000009',1,50,1);
select pg_temp.line('BOA.MIDLINE','eb500000-0000-4000-8000-000000000002',1,40,2);
select set_config('boa.before',pg_temp.snapshot('BOA.MIDLINE')::text,true);
select pg_temp.must_reject($q$select pg_temp.post('BOA.MIDLINE')$q$,'Harga pokok barang Fictional unpriced belum tersedia',
 'unpriced third issue rejects the whole posting after A and B were issued');
select pg_temp.ok(pg_temp.snapshot('BOA.MIDLINE')=current_setting('boa.before')::jsonb,
 'mid-line failure: no stock_moves, no layer consumption, no stock change, HPP still 0, no journal, still pending');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='BOA.MIDLINE'),'mid-line failure leaves zero stock_moves');

-- 3a. Retry after the failure (cause fixed) issues exactly once.
reset role;
update items set buy_price=5 where id='eb500000-0000-4000-8000-000000000009';
set local role authenticated;
select pg_temp.ok((pg_temp.post('BOA.MIDLINE')->>'finalized')::boolean,'retry after failure posts');
select pg_temp.ok((select count(*)=3 and count(distinct sale_line_id)=3 from stock_moves where source_ref='BOA.MIDLINE'),'retry: one move per stock line');
select pg_temp.ok((select sum(qty_left) from stock_layers where item_id='eb500000-0000-4000-8000-000000000001'
 and warehouse_id='eb300000-0000-4000-8000-000000000001')=(select sum((x->>3)::numeric) from jsonb_array_elements(current_setting('boa.before')::jsonb->'layers') x
 where x->>0='eb500000-0000-4000-8000-000000000001')-2,'retry consumed exactly 2 units of A layers, not 4');
select pg_temp.ok((select qty from stock where item_id='eb500000-0000-4000-8000-000000000002' and warehouse_id='eb300000-0000-4000-8000-000000000001')
 =(select (x->>1)::numeric from jsonb_array_elements(current_setting('boa.before')::jsonb->'stock') x where x->>0='eb500000-0000-4000-8000-000000000002')-1,
 'retry reduced B stock by exactly 1');
select pg_temp.ok((select jsonb_agg(hpp order by source_position)='[24,5,20]'::jsonb from sale_items where sale_id=pg_temp.sale_id('BOA.MIDLINE')),
 'retry HPP per line: A 2@12, Z fallback 5, B 20');
-- 3b. A second call after success (lost response, double click) never issues again.
select set_config('boa.before',pg_temp.snapshot('BOA.MIDLINE')::text,true);
select pg_temp.must_reject($q$select pg_temp.post('BOA.MIDLINE')$q$,'belum siap difinalkan','retry after success is refused');
select pg_temp.ok(pg_temp.snapshot('BOA.MIDLINE')=current_setting('boa.before')::jsonb,'retry after success changes nothing');
-- 3c. A receipt the old per-line writer already touched is never issued a second time.
select pg_temp.sale('BOA.ORPHAN',90,90);
select pg_temp.line('BOA.ORPHAN','eb500000-0000-4000-8000-000000000001',1,50,0);
select pg_temp.line('BOA.ORPHAN','eb500000-0000-4000-8000-000000000002',1,40,1);
select public.sale_stock_out_fifo('eb300000-0000-4000-8000-000000000001','eb500000-0000-4000-8000-000000000001',1,'sale','BOA.ORPHAN',
 (now() at time zone 'Asia/Jakarta')::date);
select set_config('boa.before',pg_temp.snapshot('BOA.ORPHAN')::text,true);
select pg_temp.must_reject($q$select pg_temp.post('BOA.ORPHAN')$q$,'sudah pernah diproses','receipt with legacy per-line issue is refused');
select pg_temp.ok(pg_temp.snapshot('BOA.ORPHAN')=current_setting('boa.before')::jsonb
 and (select count(*)=1 from stock_moves where source_ref='BOA.ORPHAN'),'legacy receipt keeps its single old move; nothing re-issued');

-- 4. Finalizer failure after every stock line was issued rolls the stock back too.
select pg_temp.sale('BOA.FINALFAIL',90,90);
select pg_temp.line('BOA.FINALFAIL','eb500000-0000-4000-8000-000000000001',1,50,0);
select pg_temp.line('BOA.FINALFAIL','eb500000-0000-4000-8000-000000000002',1,40,1);
select set_config('boa.before',pg_temp.snapshot('BOA.FINALFAIL')::text,true);
reset role;
update coa_accounts set is_active=false where code='510001';
set local role authenticated;
select pg_temp.must_reject($q$select pg_temp.post('BOA.FINALFAIL')$q$,'.','journal failure after FIFO rejects the posting');
select pg_temp.ok(pg_temp.snapshot('BOA.FINALFAIL')=current_setting('boa.before')::jsonb,'finalizer failure: stock, layers, HPP, journals untouched');
reset role;
update coa_accounts set is_active=true where code='510001';
set local role authenticated;
-- The action's explicit cleanup still works for the rolled-back pending receipt.
delete from sales where id=pg_temp.sale_id('BOA.FINALFAIL');
select pg_temp.ok(pg_temp.sale_id('BOA.FINALFAIL') is null,'pending receipt is deletable by its cashier after the failure');

-- 5. Unchanged backoffice behaviour.
select pg_temp.sale('BOA.SERVICES',30,30);
select pg_temp.line('BOA.SERVICES','eb500000-0000-4000-8000-000000000003',1,30,0);
-- Each posting runs in its own statement so the assertion that follows sees its writes.
select pg_temp.ok((select (r->>'finalized')::boolean and (r->>'stock_events')::integer=0 from pg_temp.post('BOA.SERVICES') r),
 'services-only cart finalizes with zero stock events');
select pg_temp.ok((select payments_finalized_at is not null from sales where no_struk='BOA.SERVICES')
 and (select count(*)=0 from stock_moves where source_ref='BOA.SERVICES'),'services-only cart: final, no stock move');
select pg_temp.sale('BOA.BELOWHPP',1,1);
select pg_temp.line('BOA.BELOWHPP','eb500000-0000-4000-8000-000000000002',1,1,0);
select pg_temp.ok((pg_temp.post('BOA.BELOWHPP')->>'finalized')::boolean,'below-cost backoffice sale posts');
select pg_temp.ok((select hpp=20 from sale_items where sale_id=pg_temp.sale_id('BOA.BELOWHPP')),
 'backoffice keeps warning-only HPP policy: price 1 posts with actual FIFO cost 20');
select pg_temp.sale('BOA.FREE',40,0);
select pg_temp.line('BOA.FREE','eb500000-0000-4000-8000-000000000002',1,40,0);
select pg_temp.ok((pg_temp.post('BOA.FREE')->>'finalized')::boolean,'zero-total sale posts');
select pg_temp.ok((select count(*)=1 from journal_entries where source_ref='BOA.FREE' and source='sale-hpp')
 and (select count(*)=0 from journal_entries where source_ref='BOA.FREE' and source='sale'),'zero-total sale books only its HPP, like before');
select pg_temp.sale('BOA.SHIFT',40,40,true);
select pg_temp.line('BOA.SHIFT','eb500000-0000-4000-8000-000000000002',1,40,0);
select pg_temp.ok((pg_temp.post('BOA.SHIFT')->>'finalized')::boolean,'backoffice sale linked to the open petshop shift posts');

-- 6. Guards (each leaves stock untouched).
select pg_temp.sale('BOA.GUARD',40,40);
select pg_temp.line('BOA.GUARD','eb500000-0000-4000-8000-000000000002',1,40,0);
select set_config('boa.before',pg_temp.snapshot('BOA.GUARD')::text,true);
select pg_temp.must_reject($q$select pg_temp.post('BOA.GUARD','eb300000-0000-4000-8000-000000000002')$q$,'Gudang tidak sesuai','other branch warehouse');
select pg_temp.must_reject($q$select pg_temp.post('BOA.GUARD','eb300000-0000-4000-8000-000000000003')$q$,'Gudang tidak sesuai','inactive warehouse');
select pg_temp.must_reject($q$select public.pos_backoffice_post_atomic(gen_random_uuid(),'eb300000-0000-4000-8000-000000000001')$q$,'belum siap','unknown receipt');
select set_config('request.jwt.claim.sub','eb100000-0000-4000-8000-000000000002',true);
-- SECURITY INVOKER: branch RLS already hides the receipt from a foreign cashier.
select pg_temp.must_reject($q$select pg_temp.post('BOA.GUARD')$q$,'belum siap|ditolak','another branch''s cashier cannot post this receipt');
-- Same branch, different signed-in staff: the original actor guard refuses before any issue.
reset role;
insert into user_branches(user_id,branch_id) values('eb100000-0000-4000-8000-000000000002','eb200000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.must_reject($q$select pg_temp.post('BOA.GUARD')$q$,'Akses pembayaran POS ditolak','a colleague cannot post another cashier''s receipt');
reset role;
delete from user_branches where user_id='eb100000-0000-4000-8000-000000000002' and branch_id='eb200000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','eb100000-0000-4000-8000-000000000001',true);
select pg_temp.ok(pg_temp.snapshot('BOA.GUARD')=current_setting('boa.before')::jsonb,'rejected guards leave no stock trace');
select pg_temp.ok((pg_temp.post('BOA.GUARD')->>'finalized')::boolean,'the owning cashier can still post it afterwards');

-- 7. A receipt posted this way stays reversible by the original Super Admin cancellation.
select set_config('boa.before',pg_temp.snapshot('BOA.GUARD')::text,true);
select set_config('request.jwt.claim.sub','eb100000-0000-4000-8000-000000000003',true);
select pg_temp.ok(public.cancel_posted_sale(pg_temp.sale_id('BOA.GUARD'),0,'boa-cancel','Uji pembatalan BOA') is not null,
 'original Super Admin cancellation accepts an atomically posted receipt');
select pg_temp.ok((select voided_at is not null from sales where no_struk='BOA.GUARD')
 and (select qty from stock where item_id='eb500000-0000-4000-8000-000000000002' and warehouse_id='eb300000-0000-4000-8000-000000000001')
  =(select (x->>1)::numeric from jsonb_array_elements(current_setting('boa.before')::jsonb->'stock') x where x->>0='eb500000-0000-4000-8000-000000000002')+1,
 'cancellation restores the stock it issued');
rollback;
