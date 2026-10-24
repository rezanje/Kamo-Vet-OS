-- Fixture prefix from pos_split_payments is prepended by the owned local runner.
insert into item_units(item_id,unit,factor,sell_price,buy_price) values('e5500000-0000-4000-8000-000000000001','box',24,100000,0);
update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select pg_temp.sale('I07.SOLD');
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor) select id,'e5500000-0000-4000-8000-000000000001','Fictional box',1,100000,'box',24 from sales where no_struk='I07.SOLD';
select finalize_pos_sale((select id from sales where no_struk='I07.SOLD'));
select pg_temp.reject($q$update item_units set factor=28 where item_id='e5500000-0000-4000-8000-000000000001'$q$,'sold conversion24 must not become28');
select pg_temp.assert_ok((select factor=24 from item_units where item_id='e5500000-0000-4000-8000-000000000001'),'master remains24');
select pg_temp.reject($q$delete from item_units where item_id='e5500000-0000-4000-8000-000000000001'$q$,'delete/reinsert cannot bypass sold factor');
select pg_temp.reject($q$update item_units set unit='case' where item_id='e5500000-0000-4000-8000-000000000001'$q$,'unit rename cannot bypass history');
select pg_temp.reject($q$update items set unit='btl' where id='e5500000-0000-4000-8000-000000000001'$q$,'sold base unit cannot change');
select pg_temp.reject($q$update item_units set item_id='e5500000-0000-4000-8000-000000000002' where item_id='e5500000-0000-4000-8000-000000000001'$q$,'reparent cannot bypass history');
select replace_item_unit_configuration('e5500000-0000-4000-8000-000000000001','pcs','[{"unit":"box","factor":24,"sell_price":120000,"buy_price":0}]');
select pg_temp.assert_ok((select factor=24 and sell_price=120000 from item_units where item_id='e5500000-0000-4000-8000-000000000001'),'price-only edits/reapply preserve factor');
select pg_temp.reject($q$select replace_item_unit_configuration('e5500000-0000-4000-8000-000000000001','pcs','[{"unit":"box","factor":28,"sell_price":130000,"buy_price":0}]')$q$,'RPC also rejects28');
select pg_temp.assert_ok((select factor=24 and sell_price=120000 from item_units where item_id='e5500000-0000-4000-8000-000000000001'),'rejected RPC has no partial price changes');
select pg_temp.assert_ok((select faktor=24 and satuan='box' from sale_items where sale_id=(select id from sales where no_struk='I07.SOLD')),'historical snapshot24 unchanged');
-- Pending modern checkout is not yet a sale; it must not invent a sold policy.
select pg_temp.sale('I07.PENDING');

-- Unsold stocked/purchased inventory intentionally remains editable.
insert into stock(warehouse_id,item_id,qty) values('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',100);
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values('e3300000-0000-4000-8000-000000000001','e5500000-0000-4000-8000-000000000002',current_date,100,100,50,'purchase');
select replace_item_unit_configuration('e5500000-0000-4000-8000-000000000002','pcs','[{"unit":"box","factor":24,"sell_price":2400,"buy_price":1200}]');
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp) select id,'e5500000-0000-4000-8000-000000000002','Fictional pending box',1,100000,'box',24,0 from sales where no_struk='I07.PENDING';
select replace_item_unit_configuration('e5500000-0000-4000-8000-000000000002','pcs','[{"unit":"box","factor":28,"sell_price":2800,"buy_price":1400}]');
select pg_temp.assert_ok((select factor=28 from item_units where item_id='e5500000-0000-4000-8000-000000000002'),'unsold conversion remains editable');
do $$declare denied boolean:=false;begin
 begin perform finalize_pos_sale((select id from sales where no_struk='I07.PENDING'));
 exception when raise_exception then
  if sqlerrm not like 'Konversi satuan berubah%' then raise;end if;denied:=true;
 end;
 if not denied then raise exception 'Pending sold24 finalized against changed master28';end if;
 if exists(select 1 from sales where no_struk='I07.PENDING' and payments_finalized_at is not null)
  or exists(select 1 from journal_entries where source_ref='I07.PENDING') then raise exception 'Stale finalization leaked financial writes';end if;
end$$;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000002',true);
select pg_temp.reject($q$select replace_item_unit_configuration('e5500000-0000-4000-8000-000000000002','pcs','[]')$q$,'nonadmin cannot call master RPC');
rollback;
