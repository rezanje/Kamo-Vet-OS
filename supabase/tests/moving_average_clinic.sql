-- Fixture companion for scripts/test-moving-average-clinic-postgres.py.
-- All changes roll back; prices and quantities are fictional.
update stock_layers set unit_cost=3 where item_id='d8000000-0000-4000-8000-000000000004';
update stock_layers set tanggal=current_date-1 where item_id='d8000000-0000-4000-8000-000000000002';
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)
values('d3000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000002',current_date,2,2,11,'purchase');
update stock set qty=6 where item_id='d8000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
-- On the pre-feature baseline this deliberately leaves FIFO enabled so the
-- first behavioral assertion demonstrates the real missing valuation change.
do $$ begin
  if to_regprocedure('public.activate_moving_average()') is not null then
    perform public.activate_moving_average();
  end if;
end $$;
-- New unknown-cost stock introduced after activation must fail closed.
insert into items(id,code,name,unit,buy_price,item_type,is_compound_material)
values('d8000000-0000-4000-8000-000000000009','AVG-UNKNOWN','Unknown average','pcs',0,'Persediaan',true);
insert into stock(warehouse_id,item_id,qty) values
('d3000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000009',1),
('f3000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000009',1);
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values
('d3000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000009',current_date,1,1,0,'purchase'),
('f3000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000009',current_date,1,1,0,'purchase');
do $$ begin
  begin
    perform public.clinic_issue_compound('d7000000-0000-4000-8000-000000000002','d6000000-0000-4000-8000-000000000002',
      '{"recipe_name":"Unknown cost","dosage_form":"puyer","ingredients":[{"item_id":"d8000000-0000-4000-8000-000000000009","quantity":1,"unit":"pcs","unit_price":100}]}','average-compound-unknown');
    raise exception 'Unknown compound cost accepted';
  exception when raise_exception then if position('COST_MISSING:' in sqlerrm)<>1 then raise; end if; end;
  if exists(select 1 from compounding_recipes where request_key='average-compound-unknown') then raise exception 'Failed compound retained recipe'; end if;
end $$;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);

do $$
declare
  v_recipe uuid; v_invoice uuid; v_edited uuid; v_hpp numeric; v_prescription uuid;
  v_header jsonb:=jsonb_build_object('tanggal',current_date,'subtotal',100,'discount',0,'tax',0,'total',100,
    'shift_id','da000000-0000-4000-8000-000000000001','dp_amount',0,'paid_status','Belum Lunas','metode_bayar','Tunai');
  v_lines jsonb:='[{"description":"Obat Unit","qty":2,"price":50,"kind":"obat","item_id":"d8000000-0000-4000-8000-000000000001","unit":"pcs","discount_percent":0}]';
begin
  begin
    perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001','average-clinic-unknown',v_header,
      '[{"description":"Unknown average","qty":1,"price":100,"kind":"obat","item_id":"d8000000-0000-4000-8000-000000000009","unit":"pcs"}]');
    raise exception 'Unknown clinic cost accepted';
  exception when raise_exception then if position('COST_MISSING:' in sqlerrm)<>1 then raise; end if; end;
  if exists(select 1 from invoices where request_key='average-clinic-unknown') then raise exception 'Failed clinic retained invoice'; end if;
  if exists(select 1 from stock where item_id='d8000000-0000-4000-8000-000000000009' and qty<>1)
    or exists(select 1 from stock_layers where item_id='d8000000-0000-4000-8000-000000000009' and qty_left<>1)
    or exists(select 1 from stock_moves where item_id='d8000000-0000-4000-8000-000000000009') then raise exception 'Unknown-cost clinic issue leaked stock writes'; end if;
  v_invoice:=public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001','average-clinic-post',v_header,v_lines);
  select hpp into v_hpp from public.invoice_items where invoice_id=v_invoice;
  if v_hpp<>5.33 then raise exception 'Clinic must issue at moving average 8/3: expected 5.33, got %',v_hpp; end if;
  if (select sum(qty_left) from stock_layers where item_id='d8000000-0000-4000-8000-000000000001' and unit_cost=2)<>8 then
    raise exception 'Clinic changed physical FEFO depletion'; end if;
  if public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001','average-clinic-post',v_header,v_lines)<>v_invoice then
    raise exception 'Clinic retry changed identity'; end if;
  -- An old zero-priced physical layer must not invalidate known average HPP.
  update stock_layers set unit_cost=0 where item_id='d8000000-0000-4000-8000-000000000001' and unit_cost=2;
  v_edited:=public.clinic_edit_invoice(v_invoice,'average-clinic-edit',
    v_header||'{"subtotal":150,"total":150,"reason":"Tambahkan obat"}',
    '[{"description":"Obat Unit","qty":3,"price":50,"kind":"obat","item_id":"d8000000-0000-4000-8000-000000000001","unit":"pcs","discount_percent":0}]');
  if (select hpp from invoice_items where invoice_id=v_edited)<>8 then raise exception 'Clinic edit did not retain and add average HPP'; end if;

  perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
  v_recipe:=public.clinic_issue_compound('d7000000-0000-4000-8000-000000000002','d6000000-0000-4000-8000-000000000002',
    '{"recipe_name":"Average compound","dosage_form":"puyer","ingredients":[{"item_id":"d8000000-0000-4000-8000-000000000002","quantity":2,"unit":"gram","unit_price":30}]}','average-compound');
  if (select sum(qty*unit_cost) from compound_issues where recipe_id=v_recipe)<>14 then raise exception 'Compound did not snapshot average issuance'; end if;
  if exists(select 1 from compound_issues where recipe_id=v_recipe and physical_unit_cost<>5) then raise exception 'Compound lost original physical price'; end if;
  perform public.stock_in_fifo('d3000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000002',2,20,'purchase','average-clinic-receipt',current_date,null);
  perform public.clinic_void_compound(v_recipe);
  if (select qty from stock where item_id='d8000000-0000-4000-8000-000000000002')<>8 then raise exception 'Compound void stock incorrect'; end if;
  if abs((select average_cost from stock where item_id='d8000000-0000-4000-8000-000000000002')-10.25)>0.000001 then raise exception 'Compound void did not restore historical issued value'; end if;
  if (select sum(qty_left) from stock_layers where item_id='d8000000-0000-4000-8000-000000000002' and unit_cost=5)<>4 then raise exception 'Compound void lost physical price snapshot'; end if;
  if (select unit_cost from stock_moves where source='racik' and source_ref=v_recipe::text and qty>0)<>7 then raise exception 'Compound void valued return at current average'; end if;
  perform public.clinic_void_compound(v_recipe);
  if (select count(*) from stock_moves where source='racik' and source_ref=v_recipe::text and qty>0)<>1 then raise exception 'Compound void replay doubled restoration'; end if;
  v_recipe:=public.clinic_issue_compound('d7000000-0000-4000-8000-000000000002','d6000000-0000-4000-8000-000000000002',
    '{"recipe_name":"Billed average compound","dosage_form":"puyer","ingredients":[{"item_id":"d8000000-0000-4000-8000-000000000002","quantity":1,"unit":"gram","unit_price":100}]}','average-compound-billed');
  select id into v_prescription from prescription_items where compound_recipe_id=v_recipe;
  perform public.stock_in_fifo('d3000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000002',1,40,'purchase','average-compound-before-bill',current_date,null);
  perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
  v_invoice:=public.clinic_post_invoice('d6000000-0000-4000-8000-000000000002','average-compound-invoice',v_header,
    jsonb_build_array(jsonb_build_object('description','Billed average compound','qty',1,'price',100,'kind','obat','unit','racikan',
      'recipe_id',v_recipe,'prescription_item_id',v_prescription)));
  if (select hpp from invoice_items where invoice_id=v_invoice)<>10.25 then raise exception 'Compound invoice repriced historical issued average'; end if;
  if (select qty from stock where item_id='d8000000-0000-4000-8000-000000000002')<>8 then raise exception 'Compound billed stock twice'; end if;
  begin
    perform public.clinic_void_compound(v_recipe);
    raise exception 'Billed compound was restored';
  exception when raise_exception then
    if position('RECIPE_LINKED:' in sqlerrm)<>1 then raise; end if;
  end;
end $$;

insert into sales_order_items(id,order_id,item_id,nama,satuan,faktor,qty,harga)
values('f7000000-0000-4000-8000-000000000009','f6000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000009','Unknown average','pcs',1,1,100);
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
do $$
declare r jsonb; inv jsonb; v_hpp numeric;
begin
  begin
    perform public.sales_create_delivery('f6000000-0000-4000-8000-000000000001','average-sales-unknown',jsonb_build_object('tanggal',current_date),
      '[{"order_item_id":"f7000000-0000-4000-8000-000000000009","qty":1}]');
    raise exception 'Unknown sales cost accepted';
  exception when raise_exception then if position('COST_MISSING:' in sqlerrm)<>1 then raise; end if; end;
  if exists(select 1 from stock where item_id='d8000000-0000-4000-8000-000000000009' and qty<>1)
    or exists(select 1 from stock_layers where item_id='d8000000-0000-4000-8000-000000000009' and qty_left<>1)
    or exists(select 1 from stock_moves where item_id='d8000000-0000-4000-8000-000000000009') then raise exception 'Unknown-cost sales issue leaked stock writes'; end if;
  r:=public.sales_create_delivery('f6000000-0000-4000-8000-000000000001','average-sales-delivery',jsonb_build_object('tanggal',current_date),
    '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1},{"order_item_id":"f7000000-0000-4000-8000-000000000002","qty":5}]');
  select sum(hpp) into v_hpp from sales_delivery_items where delivery_id=(r->>'document_id')::uuid;
  if v_hpp<>45.33 then raise exception 'Sales delivery must value 17 at 8/3: got %',v_hpp; end if;
  if (select sum(qty_left) from stock_layers where item_id='f5000000-0000-4000-8000-000000000001' and unit_cost=2)<>0 then raise exception 'Sales changed FEFO depletion'; end if;
  -- Receipt changes the average; billing must still allocate delivery snapshots.
  perform public.stock_in_fifo('f3000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001',5,20,'purchase','average-sales-receipt',current_date,null);
  inv:=public.sales_create_invoice('f6000000-0000-4000-8000-000000000001','average-sales-invoice',jsonb_build_object('tanggal',current_date),
    '[{"order_item_id":"f7000000-0000-4000-8000-000000000001","qty":1},{"order_item_id":"f7000000-0000-4000-8000-000000000002","qty":5}]');
  if (select sum(hpp) from sales_invoice_items where invoice_id=(inv->>'document_id')::uuid)<>45.33 then raise exception 'Sales invoice repriced delivery'; end if;
end $$;
rollback;
