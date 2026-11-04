-- Shared sale/promo helpers for the sales and hpp suites (prepended after the fixture).
create temp table P(k text primary key,id uuid);
grant all on P to authenticated;
create function pg_temp.rule_of(syarat jsonb,hasil jsonb,rep boolean default true,below jsonb default '{"allowed":false}') returns jsonb language sql as $$
 select jsonb_build_object('discount_mode','syarat_hasil','suggest','fictional','syarat_hasil',
  jsonb_build_object('version',1,'repeat',rep,'syarat',syarat,'hasil',hasil,'below_hpp',below))
$$;
create function pg_temp.mk(k text,rule jsonb) returns uuid language plpgsql as $$
declare id uuid;begin
 insert into promos(name,promo_type,rule,is_active,auto_apply,kelipatan,valid_from,valid_until)
 values('SH '||k,'bundling',rule,true,true,(rule#>>'{syarat_hasil,repeat}')::boolean,(now() at time zone 'Asia/Jakarta')::date,(now() at time zone 'Asia/Jakarta')::date+30) returning promos.id into id;
 insert into promo_items select distinct id,r.item_id from promo_sh_refs(rule) r;
 insert into P values(k,id);
 return id;
end$$;
create function pg_temp.pid(k text) returns uuid language sql as $$select id from P where k=$1$$;
create function pg_temp.sale(ref text,gross numeric,net numeric,pmode text default null,ppick uuid default null,pexcl boolean default false) returns uuid language plpgsql as $$
declare result uuid;begin
 insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,promo_pick_mode,promo_pick_id,promo_pick_exclusive)
 values('e2200000-0000-4000-8000-000000000001',ref,gross,gross-net,net,'Tunai',net,auth.uid(),'e4400000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object('method','Tunai','amount',net)),'sql:'||ref,repeat('a',64),pmode,ppick,pexcl) returning id into result;
 return result;
end$$;
-- plain line (no promo)
create function pg_temp.pl(ref text,code text,q numeric,price numeric,pos integer,unit text default 'PCS',factor numeric default 1) returns uuid language plpgsql as $$
#variable_conflict use_variable
declare id uuid;begin
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position)
 select s.id,i.id,i.name,q,price,unit,factor,0,pos from sales s cross join items i where s.no_struk=ref and i.code=code returning sale_items.id into id;
 return id;
end$$;
-- claimed line: syarat units / hasil units / sets, hasil lines carry promo_id + discount
create function pg_temp.cl(ref text,code text,q numeric,price numeric,pos integer,claim uuid,sets integer,syarat numeric,hasil numeric,discount numeric,
 waiver boolean default false,unit text default 'PCS',factor numeric default 1,promo uuid default null,manual numeric default 0) returns uuid language plpgsql as $$
#variable_conflict use_variable
declare id uuid;begin
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,promo_id,promo_discount,promo_claim_id,promo_sets,promo_syarat_units,promo_hasil_units,promo_floor_waiver,item_discount_type,item_discount_value)
 select s.id,i.id,i.name,q,price,unit,factor,0,pos,case when hasil>0 then coalesce(promo,claim) else promo end,discount,claim,sets,syarat,hasil,waiver,case when manual>0 then 'nominal' end,manual
 from sales s cross join items i where s.no_struk=ref and i.code=code returning sale_items.id into id;
 return id;
end$$;
create function pg_temp.pool_line(ref text,code text,q numeric,discount numeric,pos integer,promo uuid default 'f2000000-0000-4000-8000-000000000001') returns uuid language plpgsql as $$
#variable_conflict use_variable
declare id uuid;begin
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,promo_id,promo_discount)
 select s.id,i.id,i.name,q,20000,'PCS',1,0,pos,promo,discount from sales s cross join items i where s.no_struk=ref and i.code=code returning sale_items.id into id;
 return id;
end$$;
create function pg_temp.post(ref text) returns jsonb language sql as $$
 select cashier_post_stock_atomic((select id from sales where no_struk=ref),'e3300000-0000-4000-8000-000000000001')
$$;
create function pg_temp.snap(ref text,pos integer) returns jsonb language sql as $$
 select v.snapshot||jsonb_build_object('net_paid',v.net_paid,'item_discount',v.item_discount) from sale_line_pricing v join sales s on s.id=v.sale_id where s.no_struk=ref and v.source_position=pos
$$;
