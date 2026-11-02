-- Fictional fixtures for disposable PostgreSQL only. All changes roll back.
-- Anisa 2 Nov 2026: clinic request to a DC / other-branch warehouse under the operational
-- branch header. Reproduces the legacy rejection, then proves the atomic clinic routine.
begin;
insert into auth.users(id) values
 ('c1100000-0000-4000-8000-000000000001'),('c1100000-0000-4000-8000-000000000002');
insert into branches(id,code,name,type) values
 ('c1200000-0000-4000-8000-000000000001','KLN-A','Fictional clinic A','KLINIK'),
 ('c1200000-0000-4000-8000-000000000002','DC-B','Fictional DC branch B','DC');
insert into user_branches(user_id,branch_id,role) values
 ('c1100000-0000-4000-8000-000000000001','c1200000-0000-4000-8000-000000000001','PRIMARY'),
 ('c1100000-0000-4000-8000-000000000002','c1200000-0000-4000-8000-000000000001','PRIMARY');
insert into warehouses(id,branch_id,code,name,type,is_active) values
 ('c1300000-0000-4000-8000-000000000001','c1200000-0000-4000-8000-000000000001','KLN-A-VET','Fictional clinic A vet','VET',true),
 ('c1300000-0000-4000-8000-000000000002','c1200000-0000-4000-8000-000000000002','DC-VET-B','Fictional DC VET B','VET',true),
 ('c1300000-0000-4000-8000-000000000003','c1200000-0000-4000-8000-000000000002','DC-CLOSED','Fictional inactive','VET',false),
 ('c1300000-0000-4000-8000-000000000004','c1200000-0000-4000-8000-000000000002','TRANSIT','Fictional transit','TRANSIT',true);
insert into items(id,code,name,unit,item_type,is_active) values
 ('c1400000-0000-4000-8000-000000000001','KLN-ITEM-A','Fictional syringe','pcs','Persediaan',true),
 ('c1400000-0000-4000-8000-000000000002','KLN-SVC','Fictional service','x','Jasa',true);
insert into item_units(item_id,unit,factor,sell_price,buy_price) values ('c1400000-0000-4000-8000-000000000001','box',100,100,50);
-- User 1 has an open clinic shift; user 2 has none.
insert into cashier_shifts(id,branch_id,opened_by,shift_type) values
 ('c1500000-0000-4000-8000-000000000001','c1200000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001','klinik');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"c1100000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers','{"x-kamo-operational-branch":"c1200000-0000-4000-8000-000000000001"}',true);

-- 1. The legacy browser insert is rejected exactly as reported (destination hidden by RLS).
do $$ begin
 if not exists(select 1 from operational_request_destinations() where id='c1300000-0000-4000-8000-000000000002') then raise exception 'Destination not offered'; end if;
 begin
  insert into stock_requests(no_request,from_branch_id,to_warehouse_id,priority)
  values('PRM-LEGACY-0001','c1200000-0000-4000-8000-000000000001','c1300000-0000-4000-8000-000000000002','normal');
  raise exception 'Legacy insert unexpectedly accepted';
 exception when raise_exception then if sqlerrm not like '%Permintaan baru harus menunggu persetujuan%' then raise; end if; end;
end $$;

-- 2. The atomic clinic routine creates, snapshots, numbers and retries.
do $$ declare v_id uuid; v_retry uuid; v_before integer; begin
 v_id:=create_clinic_stock_request_atomic('c1700000-0000-4000-8000-000000000001','c1200000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000002','tinggi','  urgent  ',
  '[{"item_id":"c1400000-0000-4000-8000-000000000001","qty_diminta":5,"satuan":"pcs","catatan":"Syringe 1 ml","nama":"FORGED","faktor":9}]');
 if not exists(select 1 from stock_requests where id=v_id and from_branch_id='c1200000-0000-4000-8000-000000000001'
   and to_warehouse_id='c1300000-0000-4000-8000-000000000002' and requested_by=auth.uid() and status='Menunggu Persetujuan'
   and approved_by is null and priority='tinggi' and catatan='urgent' and no_request like 'PRM-%') then raise exception 'Request header invalid'; end if;
 if not exists(select 1 from stock_request_items where request_id=v_id and item_id='c1400000-0000-4000-8000-000000000001'
   and nama='Fictional syringe' and qty_diminta=5 and satuan='pcs' and faktor=1 and catatan='Syringe 1 ml') then raise exception 'Master snapshot not authoritative'; end if;
 v_retry:=create_clinic_stock_request_atomic('c1700000-0000-4000-8000-000000000001','c1200000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000002','tinggi','urgent',
  '[{"item_id":"c1400000-0000-4000-8000-000000000001","qty_diminta":5,"satuan":"pcs","catatan":"Syringe 1 ml"}]');
 if v_retry<>v_id or (select count(*) from stock_request_items where request_id=v_id)<>1 then raise exception 'Identical retry duplicated'; end if;
 begin
  perform create_clinic_stock_request_atomic('c1700000-0000-4000-8000-000000000001','c1200000-0000-4000-8000-000000000001',
   'c1300000-0000-4000-8000-000000000002','tinggi','urgent','[{"item_id":"c1400000-0000-4000-8000-000000000001","qty_diminta":6,"satuan":"pcs"}]');
  raise exception 'Changed retry accepted';
 exception when raise_exception then if sqlerrm not like '%Kunci permintaan sudah dipakai%' then raise; end if; end;
 -- Box unit resolves its master factor.
 v_id:=create_clinic_stock_request_atomic(gen_random_uuid(),'c1200000-0000-4000-8000-000000000001','c1300000-0000-4000-8000-000000000001','normal',null,
  '[{"item_id":"c1400000-0000-4000-8000-000000000001","qty_diminta":2,"satuan":"box"}]');
 if not exists(select 1 from stock_request_items where request_id=v_id and satuan='box' and faktor=100) then raise exception 'Unit factor not resolved'; end if;
 -- Requests stay visible to the requesting branch.
 if (select count(*) from stock_requests where from_branch_id='c1200000-0000-4000-8000-000000000001')<>2 then raise exception 'Requests not visible to clinic'; end if;
 select count(*) into v_before from stock_requests;
 begin
  perform create_clinic_stock_request_atomic(gen_random_uuid(),'c1200000-0000-4000-8000-000000000001','c1300000-0000-4000-8000-000000000002','normal',null,
   '[{"item_id":"c1400000-0000-4000-8000-000000000001","qty_diminta":1},{"item_id":"c1400000-0000-4000-8000-000000000001","qty_diminta":1,"satuan":"missing"}]');
  raise exception 'Invalid unit accepted';
 exception when raise_exception then if sqlerrm not like '%Satuan permintaan tidak tersedia%' then raise; end if; end;
 if (select count(*) from stock_requests)<>v_before then raise exception 'Failed request left a header'; end if;
end $$;

-- 3. Rejections: destination, items, priority, branch.
do $$ declare v_dest uuid; v_rows jsonb; begin
 foreach v_dest in array array['c1300000-0000-4000-8000-000000000003'::uuid,'c1300000-0000-4000-8000-000000000004'::uuid,gen_random_uuid()] loop
  begin
   perform create_clinic_stock_request_atomic(gen_random_uuid(),'c1200000-0000-4000-8000-000000000001',v_dest,'normal',null,'[{"item_id":"c1400000-0000-4000-8000-000000000001","qty_diminta":1}]');
   raise exception 'Invalid destination accepted';
  exception when raise_exception then if sqlerrm not like '%Gudang tujuan tidak aktif%' then raise; end if; end;
 end loop;
 foreach v_rows in array array['[]'::jsonb,'[{"item_id":"c1400000-0000-4000-8000-000000000002","qty_diminta":1}]'::jsonb,
   '[{"item_id":"c1400000-0000-4000-8000-000000000001","qty_diminta":0}]'::jsonb] loop
  begin
   perform create_clinic_stock_request_atomic(gen_random_uuid(),'c1200000-0000-4000-8000-000000000001','c1300000-0000-4000-8000-000000000002','normal',null,v_rows);
   raise exception 'Invalid details accepted';
  exception when raise_exception then if sqlerrm not like '%Rincian permintaan tidak valid%' and sqlerrm not like '%Barang bukan persediaan aktif%' then raise; end if; end;
 end loop;
 begin
  perform create_clinic_stock_request_atomic(gen_random_uuid(),'c1200000-0000-4000-8000-000000000001','c1300000-0000-4000-8000-000000000002','rendah',null,'[{"item_id":"c1400000-0000-4000-8000-000000000001","qty_diminta":1}]');
  raise exception 'Unsupported priority accepted';
 exception when raise_exception then if sqlerrm not like '%Rincian permintaan tidak valid%' then raise; end if; end;
 begin
  perform create_clinic_stock_request_atomic(gen_random_uuid(),'c1200000-0000-4000-8000-000000000002','c1300000-0000-4000-8000-000000000002','normal',null,'[{"item_id":"c1400000-0000-4000-8000-000000000001","qty_diminta":1}]');
  raise exception 'Foreign branch accepted';
 exception when raise_exception then if sqlerrm not like '%Akses permintaan cabang ditolak%' then raise; end if; end;
end $$;

-- 4. Same branch, no open clinic shift.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"c1100000-0000-4000-8000-000000000002"}',true);
do $$ begin
 perform create_clinic_stock_request_atomic(gen_random_uuid(),'c1200000-0000-4000-8000-000000000001','c1300000-0000-4000-8000-000000000002','normal',null,'[{"item_id":"c1400000-0000-4000-8000-000000000001","qty_diminta":1}]');
 raise exception 'Request without clinic shift accepted';
exception when raise_exception then if sqlerrm not like '%Shift klinik belum terbuka%' then raise; end if; end $$;
-- 5. Anonymous callers have no execute grant.
reset role;
do $$ begin
 if has_function_privilege('anon','public.create_clinic_stock_request_atomic(uuid,uuid,uuid,text,text,jsonb)','execute') then raise exception 'anon can execute'; end if;
end $$;
select 'CLINIC_STOCK_REQUESTS_OK';
rollback;
