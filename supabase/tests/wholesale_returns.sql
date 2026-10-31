-- N01/J01 Retur Penjualan grosir. Fictional fixtures only; never run against a shared database.
-- Runner: scripts/test-wholesale-returns-postgres.py (applies every migration to a throwaway
-- PostgreSQL, runs this file — which rolls back — then the two-session races on a committed copy
-- of the fixture section below).
begin;
do $$ begin
 if to_regprocedure('public.post_wholesale_return(text,uuid,date,uuid,text,jsonb)') is null
  or to_regprocedure('public.void_wholesale_return(uuid,integer,text,text)') is null then
  raise exception 'Wholesale return RPCs are missing';
 end if;
end $$;
-- ── fixture (the runner commits this section for its concurrency checks) ──
insert into auth.users(id,raw_user_meta_data) values
 (md5('wr-owner')::uuid,'{"full_name":"Fictional return owner"}'),
 (md5('wr-finance')::uuid,'{"full_name":"Fictional return finance"}'),
 (md5('wr-admin')::uuid,'{"full_name":"Fictional return admin"}'),
 (md5('wr-staff')::uuid,'{"full_name":"Fictional return staff"}'),
 (md5('wr-finance-other')::uuid,'{"full_name":"Fictional other-branch finance"}');
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='OWNER',is_active=true where id=md5('wr-owner')::uuid;
update profiles set role='FINANCE',is_active=true where id in (md5('wr-finance')::uuid,md5('wr-finance-other')::uuid);
update profiles set role='ADMIN',is_active=true where id=md5('wr-admin')::uuid;
update profiles set role='STAFF',is_active=true where id=md5('wr-staff')::uuid;
alter table profiles enable trigger guard_profile_privileges;
insert into role_modules(role,module_id) values('FINANCE','penjualan'),('STAFF','penjualan') on conflict do nothing;
-- FINANCE defaults to all branches; restrict it so branch isolation is exercised.
insert into role_capabilities(role,all_branches) values('FINANCE',false) on conflict(role) do update set all_branches=false;
insert into branches(id,code,name,type) values
 (md5('wr-branch')::uuid,'WRTEST','Fictional wholesale branch','PETSHOP'),
 (md5('wr-branch-other')::uuid,'WROTHER','Fictional other branch','PETSHOP');
insert into user_branches(user_id,branch_id) values
 (md5('wr-owner')::uuid,md5('wr-branch')::uuid),(md5('wr-finance')::uuid,md5('wr-branch')::uuid),
 (md5('wr-admin')::uuid,md5('wr-branch')::uuid),(md5('wr-staff')::uuid,md5('wr-branch')::uuid),
 (md5('wr-finance-other')::uuid,md5('wr-branch-other')::uuid);
insert into warehouses(id,branch_id,code,name,type) values
 (md5('wr-wh')::uuid,md5('wr-branch')::uuid,'WRWH','Fictional wholesale warehouse','RETAIL'),
 (md5('wr-wh-return')::uuid,md5('wr-branch')::uuid,'WRWH2','Fictional return warehouse','RETAIL'),
 (md5('wr-wh-other')::uuid,md5('wr-branch-other')::uuid,'WRWH3','Fictional other warehouse','RETAIL');
insert into customers(id,name,phone) values(md5('wr-customer')::uuid,'Fictional reseller','000-wr-test');
insert into items(id,code,name,unit,buy_price,sell_price,item_type) values
 (md5('wr-good')::uuid,'WRGOOD','Fictional food','pcs',2,10,'Persediaan'),
 (md5('wr-service')::uuid,'WRSERVICE','Fictional service','unit',0,50,'Jasa');
insert into item_units(item_id,unit,factor,sell_price,buy_price) values(md5('wr-good')::uuid,'box',12,110,24);
insert into stock(warehouse_id,item_id,qty) values(md5('wr-wh')::uuid,md5('wr-good')::uuid,60);
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values
 (md5('wr-wh')::uuid,md5('wr-good')::uuid,current_date-2,10,10,2,'purchase'),
 (md5('wr-wh')::uuid,md5('wr-good')::uuid,current_date-1,50,50,3,'purchase');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1201','Receivable','ASET','D',false),('1301','Inventory','ASET','D',false),('4101','Sales','PENDAPATAN','K',false),
 ('4102','Sales discount','PENDAPATAN','D',false),('5101','COGS','BEBAN','D',false),('2201','VAT','LIABILITAS','K',false),
 ('2103','Customer advance','LIABILITAS','K',false)
 on conflict(code) do update set is_active=true,is_header=false;
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=true,ppn_rate=11;
insert into sales_orders(id,no_pesanan,customer_id,branch_id,warehouse_id) values
 (md5('wr-order-a')::uuid,'SO.WR.A',md5('wr-customer')::uuid,md5('wr-branch')::uuid,md5('wr-wh')::uuid),
 (md5('wr-order-b')::uuid,'SO.WR.B',md5('wr-customer')::uuid,md5('wr-branch')::uuid,md5('wr-wh')::uuid),
 (md5('wr-order-c')::uuid,'SO.WR.C',md5('wr-customer')::uuid,md5('wr-branch')::uuid,md5('wr-wh')::uuid);
insert into sales_order_items(id,order_id,item_id,nama,satuan,faktor,qty,harga) values
 (md5('wr-a-box')::uuid,md5('wr-order-a')::uuid,md5('wr-good')::uuid,'Food box','box',12,2,110),
 (md5('wr-a-pcs')::uuid,md5('wr-order-a')::uuid,md5('wr-good')::uuid,'Food pcs','pcs',1,5,10),
 (md5('wr-a-svc')::uuid,md5('wr-order-a')::uuid,md5('wr-service')::uuid,'Service','unit',1,1,50),
 (md5('wr-b-pcs')::uuid,md5('wr-order-b')::uuid,md5('wr-good')::uuid,'Food pcs','pcs',1,4,10),
 (md5('wr-c-pcs')::uuid,md5('wr-order-c')::uuid,md5('wr-good')::uuid,'Food pcs','pcs',1,3,10);
set role authenticated;
select set_config('request.jwt.claim.sub',md5('wr-owner')::uuid::text,true);
select sales_create_delivery(md5('wr-order-a')::uuid,'wr-delivery-a',jsonb_build_object('tanggal',current_date),
 jsonb_build_array(jsonb_build_object('order_item_id',md5('wr-a-box')::uuid,'qty',2),jsonb_build_object('order_item_id',md5('wr-a-pcs')::uuid,'qty',5),
  jsonb_build_object('order_item_id',md5('wr-a-svc')::uuid,'qty',1)));
select sales_create_invoice(md5('wr-order-a')::uuid,'wr-invoice-a',jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+30),
 jsonb_build_array(jsonb_build_object('order_item_id',md5('wr-a-box')::uuid,'qty',2),jsonb_build_object('order_item_id',md5('wr-a-pcs')::uuid,'qty',5),
  jsonb_build_object('order_item_id',md5('wr-a-svc')::uuid,'qty',1)));
select sales_create_delivery(md5('wr-order-b')::uuid,'wr-delivery-b',jsonb_build_object('tanggal',current_date),
 jsonb_build_array(jsonb_build_object('order_item_id',md5('wr-b-pcs')::uuid,'qty',4)));
select sales_create_invoice(md5('wr-order-b')::uuid,'wr-invoice-b',jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+30),
 jsonb_build_array(jsonb_build_object('order_item_id',md5('wr-b-pcs')::uuid,'qty',4)));
select sales_create_delivery(md5('wr-order-c')::uuid,'wr-delivery-c',jsonb_build_object('tanggal',current_date),
 jsonb_build_array(jsonb_build_object('order_item_id',md5('wr-c-pcs')::uuid,'qty',3)));
select sales_create_invoice(md5('wr-order-c')::uuid,'wr-invoice-c',jsonb_build_object('tanggal',current_date,'jatuh_tempo',current_date+30),
 jsonb_build_array(jsonb_build_object('order_item_id',md5('wr-c-pcs')::uuid,'qty',3)));
reset role;
-- @@fixture-end
create function pg_temp.wr_assert(ok boolean,message text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'ASSERT: %',message;end if;
end$$;
create function pg_temp.wr_as(p_user text) returns void language sql as $$
 select set_config('request.jwt.claim.sub',md5(p_user)::uuid::text,true)$$;
create function pg_temp.wr_reject(command text,fragment text) returns void language plpgsql as $$begin
 begin execute command;exception when others then
  if position(fragment in sqlerrm)=0 then raise exception 'Expected "%", got "%" for %',fragment,sqlerrm,command;end if;return;
 end;raise exception 'Expected rejection: %',command;
end$$;
-- Identities resolved once by the fixture owner, so RLS-hidden rows still name the real target.
create temporary table wr_ids(name text primary key,id uuid not null);
insert into wr_ids select 'inv:'||o.id::text,si.id from sales_invoices si join sales_orders o on o.id=si.order_id where o.no_pesanan like 'SO.WR.%';
insert into wr_ids select 'line:'||oi.id::text,ii.id from sales_invoice_items ii join sales_order_items oi on oi.id=ii.order_item_id join sales_orders o on o.id=oi.order_id where o.no_pesanan like 'SO.WR.%';
grant select on wr_ids to authenticated;
create function pg_temp.wr_inv(p_order text) returns uuid language sql as $$
 select id from wr_ids where name='inv:'||md5(p_order)::uuid::text$$;
create function pg_temp.wr_line(p_line text) returns uuid language sql as $$
 select id from wr_ids where name='line:'||md5(p_line)::uuid::text$$;
create function pg_temp.wr_stock(p_wh text) returns numeric language sql as $$
 select coalesce(sum(qty),0) from public.stock where warehouse_id=md5(p_wh)::uuid and item_id=md5('wr-good')::uuid$$;
create function pg_temp.wr_balanced(p_journal uuid) returns boolean language sql as $$
 select count(*)>0 and sum(debit)=sum(credit) from public.journal_lines where entry_id=p_journal$$;
create function pg_temp.wr_amount(p_journal uuid,p_code text) returns numeric language sql as $$
 select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=p_journal and a.code=p_code$$;
create function pg_temp.wr_items(variadic p jsonb[]) returns jsonb language sql as $$select to_jsonb(p)$$;

-- Source evidence: invoice A = 2 box × 110 + 5 pcs × 10 + service 50 → DPP 320, PPN 35, total 355.
-- Delivery FIFO: box 24 pcs = 10×2 + 14×3 = 62; pcs 5×3 = 15. Warehouse 60 − 29 − 4 − 3 = 24.
do $$begin
 perform pg_temp.wr_assert((select dpp=320 and ppn=35 and total=355 and returned_ar=0 from sales_invoices where id=pg_temp.wr_inv('wr-order-a')),'invoice A source values');
 perform pg_temp.wr_assert((select hpp=62 from sales_invoice_items where id=pg_temp.wr_line('wr-a-box')),'box HPP');
 perform pg_temp.wr_assert(pg_temp.wr_stock('wr-wh')=24,'stock after three deliveries');
end$$;

set role authenticated;
select pg_temp.wr_as('wr-staff');
select pg_temp.wr_reject(format('select post_wholesale_return(''staff-key'',%L,current_date,%L,''Rusak kemasan'',%L)',
 pg_temp.wr_inv('wr-order-a'),md5('wr-wh-return')::uuid,jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-box'),'qty',1))),'hanya oleh OWNER');
select pg_temp.wr_as('wr-finance-other');
select pg_temp.wr_reject(format('select post_wholesale_return(''other-key'',%L,current_date,%L,''Rusak kemasan'',%L)',
 pg_temp.wr_inv('wr-order-a'),md5('wr-wh-return')::uuid,jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-box'),'qty',1))),'tidak dapat diakses');
-- Direct client writes never bypass the RPC.
select pg_temp.wr_as('wr-owner');
select pg_temp.wr_reject(format('insert into wholesale_returns(no_retur,invoice_id,tanggal,alasan,gross,total,ar_reduction,customer_credit,journal_id,created_by) values(''X'',%L,current_date,''abc'',0,0,0,0,gen_random_uuid(),auth.uid())',pg_temp.wr_inv('wr-order-a')),'permission denied');
select pg_temp.wr_reject(format('update sales_invoices set returned_ar=1 where id=%L',pg_temp.wr_inv('wr-order-a')),'');

-- 1. Unpaid invoice, partial return by ADMIN: 1 box back to a different warehouse at original cost.
select pg_temp.wr_as('wr-admin');
do $$declare r jsonb;again jsonb;ret wholesale_returns%rowtype;begin
 r:=post_wholesale_return('ret-1',pg_temp.wr_inv('wr-order-a'),current_date,md5('wr-wh-return')::uuid,'Kemasan penyok',
  jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-box'),'qty',1)));
 again:=post_wholesale_return('ret-1',pg_temp.wr_inv('wr-order-a'),current_date,md5('wr-wh-return')::uuid,'Kemasan penyok',
  jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-box'),'qty',1)));
 perform pg_temp.wr_assert(r=again,'identical retry must return the stored result');
 perform pg_temp.wr_assert(get_wholesale_operation(pg_temp.wr_inv('wr-order-a'),'return','ret-1')=r,'lost-response recovery');
 select * into ret from wholesale_returns where id=(r->>'return_id')::uuid;
 perform pg_temp.wr_assert(ret.no_retur like 'RJG.'||to_char(current_date,'YYYY.MM.')||'%','RJG numbering');
 -- 110 gross; PPN round(35×110/320)=12; total 122 all against the unpaid receivable.
 perform pg_temp.wr_assert(ret.gross=110 and ret.ppn=12 and ret.total=122 and ret.ar_reduction=122 and ret.customer_credit=0 and ret.hpp=31,'partial return values '||to_jsonb(ret)::text);
 perform pg_temp.wr_assert(pg_temp.wr_balanced(ret.journal_id),'return journal balanced');
 perform pg_temp.wr_assert(pg_temp.wr_amount(ret.journal_id,'4101')=110 and pg_temp.wr_amount(ret.journal_id,'2201')=12
  and pg_temp.wr_amount(ret.journal_id,'1201')=-122 and pg_temp.wr_amount(ret.journal_id,'1301')=31 and pg_temp.wr_amount(ret.journal_id,'5101')=-31
  and pg_temp.wr_amount(ret.journal_id,'2103')=0,'return journal accounts');
 perform pg_temp.wr_assert(pg_temp.wr_stock('wr-wh-return')=12 and pg_temp.wr_stock('wr-wh')=24,'stock returned to the chosen warehouse only');
 perform pg_temp.wr_assert((select qty_in=12 and qty_left=12 and round(unit_cost*12,2)=31 from stock_layers where source='wholesale-return' and source_ref=ret.no_retur),'layer at original cost');
 perform pg_temp.wr_assert((select returned_ar=122 and status='berjalan' and revision=1 from sales_invoices where id=pg_temp.wr_inv('wr-order-a')),'receivable reduced');
 perform pg_temp.wr_assert((select qty_kirim=2 and qty_faktur=2 from sales_order_items where id=md5('wr-a-box')::uuid),'order counters unchanged: goods are not billable again');
end$$;
select pg_temp.wr_reject(format('select post_wholesale_return(''ret-1'',%L,current_date,%L,''Kemasan penyok'',%L)',
 pg_temp.wr_inv('wr-order-a'),md5('wr-wh-return')::uuid,jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-box'),'qty',0.5))),'rincian berbeda');
-- 2. Over-return refused (1 box left), invalid quantities, foreign line, wrong warehouse, bad keys.
select pg_temp.wr_reject(format('select post_wholesale_return(''ret-over'',%L,current_date,%L,''Lebih'',%L)',
 pg_temp.wr_inv('wr-order-a'),md5('wr-wh')::uuid,jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-box'),'qty',2))),'melebihi sisa');
select pg_temp.wr_reject(format('select post_wholesale_return(''ret-zero'',%L,current_date,%L,''Nol'',%L)',
 pg_temp.wr_inv('wr-order-a'),md5('wr-wh')::uuid,jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-box'),'qty',0))),'tidak valid');
select pg_temp.wr_reject(format('select post_wholesale_return(''ret-foreign'',%L,current_date,%L,''Asing'',%L)',
 pg_temp.wr_inv('wr-order-a'),md5('wr-wh')::uuid,jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-b-pcs'),'qty',1))),'bukan milik faktur');
select pg_temp.wr_reject(format('select post_wholesale_return(''ret-dup'',%L,current_date,%L,''Dobel'',%L)',
 pg_temp.wr_inv('wr-order-a'),md5('wr-wh')::uuid,jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-pcs'),'qty',1),jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-pcs'),'qty',1))),'jangan gandakan');
select pg_temp.wr_reject(format('select post_wholesale_return(''ret-wh'',%L,current_date,%L,''Gudang lain'',%L)',
 pg_temp.wr_inv('wr-order-a'),md5('wr-wh-other')::uuid,jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-pcs'),'qty',1))),'gudang aktif pada cabang faktur');
select pg_temp.wr_reject(format('select post_wholesale_return(''ret-nowh'',%L,current_date,null,''Tanpa gudang'',%L)',
 pg_temp.wr_inv('wr-order-a'),jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-pcs'),'qty',1))),'Pilih gudang');
select pg_temp.wr_reject(format('select post_wholesale_return(''ret-future'',%L,current_date+1,%L,''Masa depan'',%L)',
 pg_temp.wr_inv('wr-order-a'),md5('wr-wh')::uuid,jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-pcs'),'qty',1))),'masa depan');
select pg_temp.wr_reject(format('select post_wholesale_return(''ret-reason'',%L,current_date,%L,''x'',%L)',
 pg_temp.wr_inv('wr-order-a'),md5('wr-wh')::uuid,jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-pcs'),'qty',1))),'Alasan retur');

-- Line edit (reverse + reissue) of an invoice with an active return is refused: it would re-bill
-- the returned box. The preview runs the same path as saving.
select pg_temp.wr_as('wr-finance');
select pg_temp.wr_reject(format('select preview_wholesale_invoice_lines(%L,current_date,current_date+30,null,%L)',pg_temp.wr_inv('wr-order-a'),
 jsonb_build_array(jsonb_build_object('id',pg_temp.wr_line('wr-a-box'),'qty',2,'harga',100,'diskon',0),
  jsonb_build_object('id',pg_temp.wr_line('wr-a-pcs'),'qty',5,'harga',10,'diskon',0),
  jsonb_build_object('id',pg_temp.wr_line('wr-a-svc'),'qty',1,'harga',50,'diskon',0))),'retur penjualan aktif');

-- 3. Partly paid invoice: the return first clears the receivable, the rest becomes customer credit.
do $$declare r jsonb;ret wholesale_returns%rowtype;begin
 -- Outstanding 355−122=233; receipt over that is refused (the return already reduced the receivable).
 perform pg_temp.wr_reject(format('select receive_wholesale_payment(''pay-too-much'',%L,current_date,234,''Transfer'',null,null,null)',pg_temp.wr_inv('wr-order-a')),'melebihi sisa');
 perform receive_wholesale_payment('pay-200',pg_temp.wr_inv('wr-order-a'),current_date,200,'Transfer',null,null,null);
 -- Return everything left: 1 box + 5 pcs + service → cumulative = whole invoice.
 r:=post_wholesale_return('ret-2',pg_temp.wr_inv('wr-order-a'),current_date,md5('wr-wh')::uuid,'Pelanggan tutup toko',
  jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-box'),'qty',1),
   jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-pcs'),'qty',5,'exp_date',current_date+200),
   jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-svc'),'qty',1)));
 select * into ret from wholesale_returns where id=(r->>'return_id')::uuid;
 perform pg_temp.wr_assert(ret.gross=210 and ret.ppn=23 and ret.total=233 and ret.ar_reduction=33 and ret.customer_credit=200 and ret.hpp=46,'paid return split '||to_jsonb(ret)::text);
 perform pg_temp.wr_assert(pg_temp.wr_balanced(ret.journal_id) and pg_temp.wr_amount(ret.journal_id,'2103')=-200 and pg_temp.wr_amount(ret.journal_id,'1201')=-33,'credit journal');
 -- Two returns together reverse the invoice journal exactly: revenue, VAT and receivable+credit.
 perform pg_temp.wr_assert((select sum(gross)=320 and sum(ppn)=35 and sum(total)=355 and sum(hpp)=77 from wholesale_returns where invoice_id=pg_temp.wr_inv('wr-order-a') and status='posted'),'full return equals invoice');
 perform pg_temp.wr_assert((select returned_ar=155 and status='lunas' from sales_invoices where id=pg_temp.wr_inv('wr-order-a')),'fully settled by payment + returns');
 perform pg_temp.wr_assert(exists(select 1 from stock_layers where source='wholesale-return' and source_ref=ret.no_retur and qty_in=5 and exp_date=current_date+200),'expiry carried to the returned layer');
 perform pg_temp.wr_assert(pg_temp.wr_stock('wr-wh')=41,'24 + 12 + 5 back in the main warehouse');
 perform pg_temp.wr_reject(format('select receive_wholesale_payment(''pay-after'',%L,current_date,1,''Transfer'',null,null,null)',pg_temp.wr_inv('wr-order-a')),'melebihi sisa');
 perform pg_temp.wr_reject(format('select post_wholesale_return(''ret-none-left'',%L,current_date,%L,''Habis'',%L)',
  pg_temp.wr_inv('wr-order-a'),md5('wr-wh')::uuid,jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-pcs'),'qty',1))),'melebihi sisa');
end$$;
-- An invoice with an active return cannot be cancelled/replaced (would re-bill returned goods).
select pg_temp.wr_reject(format('select correct_wholesale_invoice(%L,(select revision from sales_invoices where id=%L),''corr-with-return'',''cancel'',''Batal tagihan'',jsonb_build_object(''tanggal'',current_date))',
 pg_temp.wr_inv('wr-order-a'),pg_temp.wr_inv('wr-order-a')),'retur penjualan aktif');

-- 4. Void: ADMIN may not void; FINANCE voids with full reversal (stock, journal, AR, credit).
select pg_temp.wr_as('wr-admin');
select pg_temp.wr_reject(format('select void_wholesale_return(%L,0,''void-admin'',''Salah input'')',(select id from wholesale_returns where alasan='Pelanggan tutup toko')),'OWNER/FINANCE');
select pg_temp.wr_as('wr-finance');
do $$declare r jsonb;again jsonb;ret wholesale_returns%rowtype;moves numeric;begin
 select * into ret from wholesale_returns where alasan='Pelanggan tutup toko';
 perform pg_temp.wr_reject(format('select void_wholesale_return(%L,5,''void-stale'',''Salah input'')',ret.id),'sudah berubah');
 r:=void_wholesale_return(ret.id,0,'void-2','Salah input retur');
 again:=void_wholesale_return(ret.id,0,'void-2','Salah input retur');
 perform pg_temp.wr_assert(r=again and get_wholesale_operation(pg_temp.wr_inv('wr-order-a'),'return-void','void-2')=r,'void retry/recovery');
 select * into ret from wholesale_returns where id=ret.id;
 perform pg_temp.wr_assert(ret.status='batal' and ret.voided_on=current_date and ret.reversal_journal_id is not null and ret.revision=1,'void recorded');
 perform pg_temp.wr_assert(pg_temp.wr_balanced(ret.reversal_journal_id) and pg_temp.wr_amount(ret.reversal_journal_id,'2103')=200
  and pg_temp.wr_amount(ret.reversal_journal_id,'1201')=33 and pg_temp.wr_amount(ret.reversal_journal_id,'4101')=-210
  and pg_temp.wr_amount(ret.reversal_journal_id,'1301')=-46,'void journal is the exact mirror');
 perform pg_temp.wr_assert(pg_temp.wr_stock('wr-wh')=24,'returned units left the warehouse again');
 perform pg_temp.wr_assert((select bool_and(qty_left=0) from stock_layers where source='wholesale-return' and source_ref=ret.no_retur),'return layers zeroed');
 select sum(qty*unit_cost) into moves from stock_moves where source_ref=ret.no_retur and source in ('wholesale-return','wholesale-return-void');
 perform pg_temp.wr_assert(abs(moves)<0.0001,'void move at the original cost');
 perform pg_temp.wr_assert((select returned_ar=122 and status='berjalan' from sales_invoices where id=pg_temp.wr_inv('wr-order-a')),'receivable restored');
 perform pg_temp.wr_reject(format('select void_wholesale_return(%L,1,''void-again'',''Lagi'')',ret.id),'sudah dibatalkan');
end$$;
-- Voided quantities may be returned again.
select pg_temp.wr_as('wr-owner');
do $$declare r jsonb;ret wholesale_returns%rowtype;begin
 r:=post_wholesale_return('ret-3',pg_temp.wr_inv('wr-order-a'),current_date,md5('wr-wh')::uuid,'Retur ulang satu box',
  jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-a-box'),'qty',1)));
 select * into ret from wholesale_returns where id=(r->>'return_id')::uuid;
 -- Cumulative 220 of 320 → PPN round(35×220/320)=24, minus the active 12 = 12. Outstanding 33.
 perform pg_temp.wr_assert(ret.total=122 and ret.ar_reduction=33 and ret.customer_credit=89 and ret.hpp=31,'re-return after void '||to_jsonb(ret)::text);
end$$;
-- 5. Void refused once the returned units were used (layer no longer intact).
reset role;
update stock_layers set qty_left=qty_left-1 where source='wholesale-return' and source_ref=(select no_retur from wholesale_returns where alasan='Retur ulang satu box');
update stock set qty=qty-1 where warehouse_id=md5('wr-wh')::uuid and item_id=md5('wr-good')::uuid;
set role authenticated;
select pg_temp.wr_as('wr-owner');
select pg_temp.wr_reject(format('select void_wholesale_return(%L,0,''void-consumed'',''Coba batal'')',(select id from wholesale_returns where alasan='Retur ulang satu box')),'sudah terpakai');

-- 6. Fully paid invoice B: the whole return becomes customer credit; receivable untouched.
select pg_temp.wr_as('wr-finance');
do $$declare r jsonb;ret wholesale_returns%rowtype;begin
 perform receive_wholesale_payment('pay-b',pg_temp.wr_inv('wr-order-b'),current_date,(select total from sales_invoices where id=pg_temp.wr_inv('wr-order-b')),'Transfer',null,null,null);
 r:=post_wholesale_return('ret-b',pg_temp.wr_inv('wr-order-b'),current_date,md5('wr-wh')::uuid,'Barang kedaluwarsa',
  jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-b-pcs'),'qty',1)));
 select * into ret from wholesale_returns where id=(r->>'return_id')::uuid;
 -- Invoice B: DPP 40, PPN round(4.4)=4, total 44. One pcs: gross 10, PPN round(4×10/40)=1.
 perform pg_temp.wr_assert(ret.total=11 and ret.ar_reduction=0 and ret.customer_credit=11,'paid invoice → credit '||to_jsonb(ret)::text);
 perform pg_temp.wr_assert((select returned_ar=0 and status='lunas' from sales_invoices where id=pg_temp.wr_inv('wr-order-b')),'paid invoice stays settled');
 perform pg_temp.wr_assert(pg_temp.wr_balanced(ret.journal_id) and pg_temp.wr_amount(ret.journal_id,'2103')=-11,'credit to customer balance');
end$$;

-- 7. Journals of every return/void balance; activity log captured the documents.
reset role;
do $$begin
 perform pg_temp.wr_assert(not exists(select 1 from journal_entries e where e.source in ('wholesale-return','wholesale-return-void')
  and (select sum(debit)-sum(credit) from journal_lines where entry_id=e.id)<>0),'every return journal balanced');
 perform pg_temp.wr_assert((select count(*) from journal_entries where source='wholesale-return')=4 and (select count(*) from journal_entries where source='wholesale-return-void')=1,'journal count');
 perform pg_temp.wr_assert(exists(select 1 from activity_log where row_entity='wholesale_returns' and action='create')
  and exists(select 1 from activity_log where row_entity='wholesale_returns' and action='update')
  and exists(select 1 from activity_log where row_entity='wholesale_return_items' and action='create' and entity='wholesale_returns'),'activity log capture');
 perform pg_temp.wr_assert(exists(select 1 from activity_log where row_entity='wholesale_returns' and branch_ids=array[md5('wr-branch')::uuid]),'activity scoped to the invoice branch');
end$$;
-- Posted documents are immutable even for the table owner path.
select pg_temp.wr_reject('delete from wholesale_return_items','tidak dapat diubah');
select pg_temp.wr_reject('update wholesale_returns set alasan=''ubah''','proses resmi');

-- 8. Moving average: the return blends in at original cost; the void removes exactly that value.
-- Fixture shortcut: switch the costing method directly (activation's GL-1301 reconciliation
-- is covered by its own suites; this fixture has no opening inventory journal).
update inventory_costing_settings set method='moving_average',activated_at=now(),activated_by=md5('wr-owner')::uuid;
update stock s set average_cost=(select sum(l.qty_left*l.unit_cost)/sum(l.qty_left) from stock_layers l where l.warehouse_id=s.warehouse_id and l.item_id=s.item_id and l.qty_left>0)
 where s.qty>0;
set role authenticated;
select pg_temp.wr_as('wr-owner');
do $$declare r jsonb;v jsonb;before_value numeric;after_return numeric;after_void numeric;begin
 select qty*average_cost into before_value from stock where warehouse_id=md5('wr-wh')::uuid and item_id=md5('wr-good')::uuid;
 r:=post_wholesale_return('ret-c',pg_temp.wr_inv('wr-order-c'),current_date,md5('wr-wh')::uuid,'Retur saat average',
  jsonb_build_array(jsonb_build_object('invoice_item_id',pg_temp.wr_line('wr-c-pcs'),'qty',2)));
 select qty*average_cost into after_return from stock where warehouse_id=md5('wr-wh')::uuid and item_id=md5('wr-good')::uuid;
 perform pg_temp.wr_assert(abs(after_return-before_value-(r->>'hpp')::numeric)<0.01,'average value grew by the original HPP');
 v:=void_wholesale_return((r->>'return_id')::uuid,0,'void-c','Batal retur average');
 select qty*average_cost into after_void from stock where warehouse_id=md5('wr-wh')::uuid and item_id=md5('wr-good')::uuid;
 perform pg_temp.wr_assert(abs(after_void-before_value)<0.01,'average value restored after void');
end$$;
reset role;
rollback;
