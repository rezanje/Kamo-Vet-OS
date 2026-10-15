-- Fictional fixtures for disposable PostgreSQL only. All changes roll back.
begin;
insert into auth.users(id) values
 ('f1100000-0000-4000-8000-000000000001'),('f1100000-0000-4000-8000-000000000002'),('f1100000-0000-4000-8000-000000000003');
insert into branches(id,code,name,type) values
 ('f1200000-0000-4000-8000-000000000001','REQ-A','Fictional request branch A','BOTH'),
 ('f1200000-0000-4000-8000-000000000002','REQ-B','Fictional request branch B','BOTH');
insert into user_branches(user_id,branch_id,role) values
 ('f1100000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000001','PRIMARY'),
 ('f1100000-0000-4000-8000-000000000002','f1200000-0000-4000-8000-000000000002','PRIMARY'),
 ('f1100000-0000-4000-8000-000000000003','f1200000-0000-4000-8000-000000000001','PRIMARY');
insert into warehouses(id,branch_id,code,name,type,is_active) values
 ('f1300000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000001','REQ-WH-A','Fictional retail A','RETAIL',true),
 ('f1300000-0000-4000-8000-000000000002','f1200000-0000-4000-8000-000000000002','DC-REQ-B','Fictional DC B','DC',true),
 ('f1300000-0000-4000-8000-000000000003','f1200000-0000-4000-8000-000000000002','DC-REQ-CLOSED','Fictional inactive DC','DC',false);
insert into items(id,code,name,unit,item_type,is_active) values
 ('f1400000-0000-4000-8000-000000000001','REQ-ITEM-A','Fictional medicine A','pcs','Persediaan',true),
 ('f1400000-0000-4000-8000-000000000002','REQ-ITEM-B','Fictional medicine B','pcs','Persediaan',true),
 ('f1400000-0000-4000-8000-000000000003','REQ-ITEM-CLOSED','Fictional inactive medicine','pcs','Persediaan',false);
insert into item_units(item_id,unit,factor,sell_price,buy_price) values ('f1400000-0000-4000-8000-000000000001','box',12,120,60);
insert into cashier_shifts(id,branch_id,opened_by,shift_type) values
 ('f1500000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000001','f1100000-0000-4000-8000-000000000001','petshop'),
 ('f1500000-0000-4000-8000-000000000002','f1200000-0000-4000-8000-000000000002','f1100000-0000-4000-8000-000000000002','petshop');
-- Hidden from branch A, but still owns a globally unique number in the PRM series.
insert into stock_requests(id,no_request,from_branch_id,to_warehouse_id,requested_by) values
 ('f1600000-0000-4000-8000-000000000001','PRM-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD')||'-0001',
 'f1200000-0000-4000-8000-000000000002','f1300000-0000-4000-8000-000000000002','f1100000-0000-4000-8000-000000000002');
-- Force a real detail-table rejection after the routine inserts its header.
alter table stock_request_items add constraint request_test_detail_failure check(catatan is distinct from 'REQ-FORCE-DETAIL-FAILURE');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1100000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers','{"x-kamo-operational-branch":"f1200000-0000-4000-8000-000000000001"}',true);
do $$ begin
 if exists(select 1 from warehouses where id='f1300000-0000-4000-8000-000000000002') then raise exception 'Destination metadata isolation was relaxed'; end if;
 if not exists(select 1 from operational_request_destinations(true) where id='f1300000-0000-4000-8000-000000000002') then raise exception 'Allowed destination reference missing'; end if;
 if exists(select 1 from stock_requests where id='f1600000-0000-4000-8000-000000000001') then raise exception 'Foreign request leaked'; end if;
end $$;
-- Atomic regression cases.
do $$ declare v_id uuid; v_retry uuid; v_number text; v_before integer; begin
 if to_regprocedure('public.create_cashier_stock_request_atomic(uuid,uuid,uuid,text,text,jsonb)') is null then
  raise exception 'Missing atomic cashier stock request creation routine';
 end if;
 v_id:=create_cashier_stock_request_atomic('f1700000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000002','tinggi','  urgent  ',
  '[{"item_id":"f1400000-0000-4000-8000-000000000001","qty_diminta":2,"satuan":"box","catatan":"stok tipis","nama":"FORGED","faktor":999}]');
 select no_request into v_number from stock_requests where id=v_id;
 if v_number<>'PRM-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD')||'-0002' then raise exception 'Numbering ignored hidden branches: %',v_number; end if;
 if not exists(select 1 from stock_requests where id=v_id and from_branch_id='f1200000-0000-4000-8000-000000000001' and requested_by=auth.uid() and status='Menunggu Persetujuan' and approved_by is null and priority='tinggi' and catatan='urgent') then raise exception 'Request actor/lifecycle invalid'; end if;
 if not exists(select 1 from stock_request_items where request_id=v_id and item_id='f1400000-0000-4000-8000-000000000001' and nama='Fictional medicine A' and qty_diminta=2 and satuan='box' and faktor=12 and catatan='stok tipis') then raise exception 'Master snapshots were not authoritative'; end if;
 v_retry:=create_cashier_stock_request_atomic('f1700000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000002','tinggi','urgent',
  '[{"item_id":"f1400000-0000-4000-8000-000000000001","qty_diminta":2,"satuan":"box","catatan":"stok tipis"}]');
 if v_retry<>v_id or (select count(*) from stock_request_items where request_id=v_id)<>1 then raise exception 'Identical retry created a duplicate'; end if;
 begin
  perform create_cashier_stock_request_atomic('f1700000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000002','tinggi','urgent',
   '[{"item_id":"f1400000-0000-4000-8000-000000000001","qty_diminta":3,"satuan":"box","catatan":"stok tipis"}]');
  raise exception 'Changed retry accepted';
 exception when raise_exception then if sqlerrm not like '%Kunci permintaan sudah dipakai%' then raise; end if; end;
 begin
  update stock_requests set request_key='f1700000-0000-4000-8000-000000000099' where id=v_id;
  raise exception 'Browser rewrote retry identity';
 exception when raise_exception then if sqlerrm not like '%Identitas pengiriman permintaan tidak dapat diubah%' then raise; end if; end;
 select count(*) into v_before from stock_requests;
 begin
  perform create_cashier_stock_request_atomic('f1700000-0000-4000-8000-000000000002','f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000002','normal',null,
   '[{"item_id":"f1400000-0000-4000-8000-000000000001","qty_diminta":1,"satuan":"pcs"},{"item_id":"f1400000-0000-4000-8000-000000000002","qty_diminta":1,"satuan":"removed-box"}]');
  raise exception 'Invalid second line accepted';
 exception when raise_exception then if sqlerrm not like '%Satuan permintaan tidak tersedia%' then raise; end if; end;
 if (select count(*) from stock_requests)<>v_before or exists(select 1 from stock_requests where request_key='f1700000-0000-4000-8000-000000000002') then raise exception 'Failed line left a partial header'; end if;
 if (select count(*) from stock_request_items i join stock_requests r on r.id=i.request_id where r.request_key='f1700000-0000-4000-8000-000000000001')<>1 then raise exception 'Failed line altered existing details'; end if;
 begin
  perform create_cashier_stock_request_atomic('f1700000-0000-4000-8000-000000000003','f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000002','normal',null,
   '[{"item_id":"f1400000-0000-4000-8000-000000000001","qty_diminta":1,"satuan":"pcs"},{"item_id":"f1400000-0000-4000-8000-000000000002","qty_diminta":1,"satuan":"pcs","catatan":"REQ-FORCE-DETAIL-FAILURE"}]');
  raise exception 'Detail constraint failure was ignored';
 exception when check_violation then null; end;
 if (select count(*) from stock_requests)<>v_before or exists(select 1 from stock_requests where request_key='f1700000-0000-4000-8000-000000000003') then raise exception 'Detail insert failure left a header'; end if;
end $$;
do $$ declare v_rows jsonb; v_destination uuid; begin
 foreach v_rows in array array[
  '[]'::jsonb,
  '[{"item_id":"f1400000-0000-4000-8000-000000000003","qty_diminta":1,"satuan":"pcs"}]'::jsonb,
  '[{"item_id":"f1400000-0000-4000-8000-000000000001","qty_diminta":0,"satuan":"pcs"}]'::jsonb,
  '[{"item_id":"f1400000-0000-4000-8000-000000000001","qty_diminta":-1,"satuan":"pcs"}]'::jsonb,
  '[{"item_id":"f1400000-0000-4000-8000-000000000001","qty_diminta":"NaN","satuan":"pcs"}]'::jsonb
 ] loop
  begin
   perform create_cashier_stock_request_atomic(gen_random_uuid(),'f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000002','normal',null,v_rows);
   raise exception 'Invalid request details accepted';
  exception when raise_exception then if sqlerrm not like '%Rincian permintaan tidak valid%' and sqlerrm not like '%Barang bukan persediaan aktif%' then raise; end if; end;
 end loop;
 foreach v_destination in array array['f1300000-0000-4000-8000-000000000001'::uuid,'f1300000-0000-4000-8000-000000000003'::uuid] loop
  begin
   perform create_cashier_stock_request_atomic(gen_random_uuid(),'f1200000-0000-4000-8000-000000000001',v_destination,'normal',null,'[{"item_id":"f1400000-0000-4000-8000-000000000001","qty_diminta":1}]');
   raise exception 'Invalid destination accepted';
  exception when raise_exception then if sqlerrm not like '%Gudang tujuan tidak aktif atau bukan gudang DC%' then raise; end if; end;
 end loop;
 begin
  perform create_cashier_stock_request_atomic(gen_random_uuid(),'f1200000-0000-4000-8000-000000000002','f1300000-0000-4000-8000-000000000002','normal',null,'[{"item_id":"f1400000-0000-4000-8000-000000000001","qty_diminta":1}]');
  raise exception 'Foreign branch accepted';
 exception when raise_exception then if sqlerrm not like '%Akses permintaan cabang ditolak%' then raise; end if; end;
end $$;
-- A changed user cannot replay another user's posting identity.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1100000-0000-4000-8000-000000000002"}',true);
select set_config('request.headers','{"x-kamo-operational-branch":"f1200000-0000-4000-8000-000000000002"}',true);
do $$ begin
 begin
  perform create_cashier_stock_request_atomic('f1700000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000002','f1300000-0000-4000-8000-000000000002','tinggi','urgent','[{"item_id":"f1400000-0000-4000-8000-000000000001","qty_diminta":2,"satuan":"box","catatan":"stok tipis"}]');
  raise exception 'Cross-actor retry accepted';
 exception when raise_exception then if sqlerrm not like '%Kunci permintaan sudah dipakai%' then raise; end if; end;
end $$;
-- Authorized branch access alone cannot replace an open shift.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1100000-0000-4000-8000-000000000003"}',true);
select set_config('request.headers','{"x-kamo-operational-branch":"f1200000-0000-4000-8000-000000000001"}',true);
do $$ begin
 begin
  perform create_cashier_stock_request_atomic(gen_random_uuid(),'f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000002','normal',null,'[{"item_id":"f1400000-0000-4000-8000-000000000001","qty_diminta":1}]');
  raise exception 'Request without own open shift accepted';
 exception when raise_exception then if sqlerrm not like '%Shift kasir belum terbuka%' then raise; end if; end;
end $$;
reset role;
update profiles set is_active=false where id='f1100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f1100000-0000-4000-8000-000000000001"}',true);
do $$ begin
 begin
  perform create_cashier_stock_request_atomic(gen_random_uuid(),'f1200000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000002','normal',null,'[{"item_id":"f1400000-0000-4000-8000-000000000001","qty_diminta":1}]');
  raise exception 'Inactive requester accepted';
 exception when raise_exception then if sqlerrm not like '%Akses permintaan cabang ditolak%' then raise; end if; end;
end $$;
reset role;
do $$ begin
 if exists(select 1 from stock where warehouse_id in ('f1300000-0000-4000-8000-000000000001','f1300000-0000-4000-8000-000000000002')) then raise exception 'Request creation changed stock'; end if;
 if has_function_privilege('anon','public.create_cashier_stock_request_atomic(uuid,uuid,uuid,text,text,jsonb)','execute') then raise exception 'Anonymous posting allowed'; end if;
 if (select count(*) from stock_requests where request_key is not null and from_branch_id in ('f1200000-0000-4000-8000-000000000001','f1200000-0000-4000-8000-000000000002'))<>1 then raise exception 'Failed request left a partial document'; end if;
end $$;
rollback;
