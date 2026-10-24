-- The runner prepends fictional POS fixtures. Everything rolls back.
update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',10,100,'purchase','AVG.VOID.FIRST',current_date-2);
select stock_in_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',10,200,'purchase','AVG.VOID.SECOND',current_date-1);
insert into items(id,code,name,unit,item_type) values('ec500000-0000-4000-8000-000000000001','AVGVOIDGROUP','Average group','set','Grup');
insert into item_group_components(group_item_id,component_item_id,qty,unit,factor) values('ec500000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',4,'pcs',1);
set local role authenticated;
select pg_temp.seed_average_opening_gl();
select activate_moving_average();
do $$declare doc uuid;line uuid:=gen_random_uuid();issued record;result jsonb;begin
 doc:=pg_temp.fee_sale('AVG.VOID.REGULAR');
 select * into issued from sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',4,'sale','AVG.VOID.REGULAR',p_sale_line_id=>line);
 perform pg_temp.assert_ok(issued.cost=600,'regular sale uses average 150 for all 4 units');
 perform pg_temp.assert_ok((select sum(x.qty*x.unit_cost) from jsonb_to_recordset(issued.takes)x(qty numeric,unit_cost numeric))=400,'physical takes retain original first receipt cost');
 insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values(line,doc,'e5500000-0000-4000-8000-000000000002','Average stock',4,25000,'pcs',1,issued.cost);
 perform finalize_pos_sale(doc);
 perform stock_in_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',4,300,'purchase','AVG.VOID.LATER');
 result:=cancel_posted_sale(doc,0,'average-regular-cancel','Wrong stock quantity');
 perform pg_temp.assert_ok(result=cancel_posted_sale(doc,0,'average-regular-cancel','Wrong stock quantity'),'regular cancellation retry retains its durable result');
 perform pg_temp.assert_ok((select qty=24 and abs(average_cost-175)<0.00000001 from stock where item_id='e5500000-0000-4000-8000-000000000002'),'regular cancellation restores original 600 value while preserving later 1200 receipt');
 perform pg_temp.assert_ok((select qty_left=10 and unit_cost=100 from stock_layers where source_ref='AVG.VOID.FIRST'),'original physical layer and price restored');
 perform pg_temp.assert_ok((select sum(l.debit-l.credit)=0 from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where a.code='1301' and (e.source_ref='AVG.VOID.REGULAR' or e.source_ref=result->>'audit_id')),'inventory journal reverses exact original average HPP');
end$$;
do $$declare doc uuid;line uuid:=gen_random_uuid();issued record;begin
 doc:=pg_temp.fee_sale('AVG.VOID.GROUP');
 select * into issued from sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',4,'sale-group','AVG.VOID.GROUP',p_sale_line_id=>line);
 perform pg_temp.assert_ok(issued.cost=700,'group component uses current 175 average');
 insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values(line,doc,'ec500000-0000-4000-8000-000000000001','Average group',1,100000,'set',1,issued.cost);
 insert into sale_item_group_components(sale_item_id,component_item_id,component_name,item_type,qty_per_group,unit,factor,total_base_qty,hpp) values(line,'e5500000-0000-4000-8000-000000000002','Average component','Persediaan',4,'pcs',1,4,issued.cost);
 perform finalize_pos_sale(doc);
 perform stock_in_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',4,350,'purchase','AVG.GROUP.LATER');
 perform cancel_posted_sale(doc,0,'average-group-cancel','Wrong group quantity');
 perform pg_temp.assert_ok((select qty=28 and abs(average_cost-200)<0.00000001 from stock where item_id='e5500000-0000-4000-8000-000000000002'),'group cancellation restores its own average value and preserves later receipts');
 perform pg_temp.assert_ok((select qty_left=10 and unit_cost=100 from stock_layers where source_ref='AVG.VOID.FIRST'),'group restores original physical acquisition layer');
end$$;
-- Average HPP must not weaken physical proof validation.
do $$declare doc uuid;line uuid:=gen_random_uuid();issued record;begin
 doc:=pg_temp.fee_sale('AVG.VOID.TAMPER');
 select * into issued from sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',1,'sale','AVG.VOID.TAMPER',p_sale_line_id=>line);
 insert into sale_items(id,sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) values(line,doc,'e5500000-0000-4000-8000-000000000002','Average stock',1,100000,'pcs',1,issued.cost);
 perform finalize_pos_sale(doc);
end$$;
reset role;
update stock_layers set exp_date=current_date+99 where source_ref='AVG.VOID.FIRST';
set local role authenticated;
select pg_temp.reject($q$select cancel_posted_sale((select id from sales where no_struk='AVG.VOID.TAMPER'),0,'average-tamper','Wrong quantity')$q$,'tampered physical expiry still blocks cancellation');
select pg_temp.assert_ok((select voided_at is null from sales where no_struk='AVG.VOID.TAMPER'),'physical mismatch leaves sale posted');
rollback;
