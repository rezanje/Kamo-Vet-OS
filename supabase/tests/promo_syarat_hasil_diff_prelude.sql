-- Differential harness: scenarios come from the REAL stage-1 TypeScript engine (scripts/promo-syarat-hasil-diff-gen.mts).
-- Four extra stock items (prices 7000/12500/5000/9000, actual FIFO cost 1000 so the P03 floor never interferes with the maths).
insert into items(id,code,name,unit,item_type,sell_price,buy_price) values
 ('e5500000-0000-4000-8000-0000000000d1','DIFA','Diff A','PCS','Persediaan',7000,0),
 ('e5500000-0000-4000-8000-0000000000d2','DIFB','Diff B','PCS','Persediaan',12500,0),
 ('e5500000-0000-4000-8000-0000000000d3','DIFC','Diff C','PCS','Persediaan',5000,0),
 ('e5500000-0000-4000-8000-0000000000d4','DIFD','Diff D','PCS','Persediaan',9000,0);
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source,exp_date)
 select 'e3300000-0000-4000-8000-000000000001',id,(now() at time zone 'Asia/Jakarta')::date,100000,100000,1000,'purchase','2030-01-01' from items where code like 'DIF_';
insert into stock(warehouse_id,item_id,qty) select warehouse_id,item_id,100000 from stock_layers where item_id in(select id from items where code like 'DIF_');
update promo_release_flags set enabled=true where flag='syarat_hasil';
-- One scenario = promos + cart + the engine's claims, run inside a sub-transaction that is always rolled back.
-- forge: add 1 Rp to the first claimed reward line's discount (header total adjusted): the database MUST refuse.
create function pg_temp.diff_scenario(j jsonb,forge boolean) returns text language plpgsql as $$
declare p jsonb;l jsonb;c jsonb;sid uuid:=gen_random_uuid();gross numeric:=0;disc numeric:=0;forged boolean:=false;add numeric;res jsonb;
 today date:=(now() at time zone 'Asia/Jakarta')::date;
begin
 begin
  for p in select * from jsonb_array_elements(j->'promos') loop
   insert into promos(id,name,promo_type,rule,is_active,auto_apply,kelipatan,valid_from,valid_until)
    values((p->>'id')::uuid,'Direct diff '||(p->>'id'),'bundling',p->'rule',true,true,(p->'rule'#>>'{syarat_hasil,repeat}')::boolean,today,today+30);
   insert into promo_items select (p->>'id')::uuid,r.item_id from(select distinct item_id from public.promo_sh_refs(p->'rule')) r;
  end loop;
  set constraints all immediate;
  for l in select * from jsonb_array_elements(j->'lines') loop
   gross:=gross+(l->>'qty')::numeric*(l->>'price')::numeric;
  end loop;
  for c in select * from jsonb_array_elements(j->'claims') loop
   disc:=disc+(c->>'disc')::numeric;
  end loop;
  if forge then disc:=disc+1;end if;
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  insert into sales(id,branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
   values(sid,'e2200000-0000-4000-8000-000000000001','D'||substr(replace(sid::text,'-',''),1,20),gross,disc,gross-disc,'Tunai',gross-disc,auth.uid(),'e4400000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('method','Tunai','amount',gross-disc)),'sql:'||sid,repeat('a',64));
  for l in select * from jsonb_array_elements(j->'lines') loop
   select x into c from jsonb_array_elements(j->'claims') x where (x->>'pos')::int=(l->>'pos')::int;
   add:=0;
   if c is not null and forge and not forged and (c->>'hasil')::numeric>0 then add:=1;forged:=true;end if;
   insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,promo_id,promo_discount,promo_claim_id,promo_sets,promo_syarat_units,promo_hasil_units)
   values(sid,(l->>'item')::uuid,'diff',(l->>'qty')::numeric,(l->>'price')::numeric,'PCS',1,0,(l->>'pos')::int,
    case when c is not null and (c->>'hasil')::numeric>0 then (c->>'promo')::uuid end,
    case when c is not null and (c->>'hasil')::numeric>0 then (c->>'disc')::numeric+add else 0 end,
    (c->>'promo')::uuid,coalesce((c->>'sets')::int,0),coalesce((c->>'syarat')::numeric,0),coalesce((c->>'hasil')::numeric,0));
  end loop;
  res:=cashier_post_stock_atomic(sid,'e3300000-0000-4000-8000-000000000001');
  if res->>'finalized'<>'true' then raise exception 'NOT FINALIZED';end if;
  if forge and not forged then raise exception 'NOTHING TO FORGE';end if;
  raise exception 'DIFF_ROLLBACK';
 exception when others then
  if sqlerrm='DIFF_ROLLBACK' then return 'ACCEPTED';end if;
  if sqlerrm='NOTHING TO FORGE' then return 'SKIP';end if;
  return 'REFUSED: '||left(sqlerrm,160);
 end;
end$$;
