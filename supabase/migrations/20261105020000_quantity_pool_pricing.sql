-- Narrow opt-in quantity_pool v1. No activation, master writes, role changes, or
-- replacement of original FIFO/payment/HPP/finalization/cancellation RPCs.
-- Deploy DB then app, refresh old clients, and only then activate reviewed masters.
begin;
alter table public.promos drop constraint promos_discount_mode_valid;
alter table public.promos add constraint promos_discount_mode_valid check (
 (not(coalesce(rule,'{}') ?| array['quantity_pool','quantity_pool_scope'])
  or coalesce(rule->>'discount_mode'='quantity_pool',false)) and (
 coalesce(rule->>'discount_mode','per_unit')='per_unit'
 or coalesce(rule->>'discount_mode'='package_total' and discount_type='nominal' and min_qty>0,false)
 or coalesce(rule->>'discount_mode'='quantity_pool'
  and rule->'quantity_pool'='{"version":1,"unit":"PCS","normal_price":20000,"tiers":[{"qty":6,"total":110000},{"qty":2,"total":38000}]}'::jsonb
  and rule->>'quantity_pool_scope' in('bolt_800gr','cat_choize_adult')
  and auto_apply and discount_type='nominal' and discount_value>0
  and min_qty=2 and max_qty is null and kelipatan
  and (rule->>'unit' is null or upper(rule->>'unit')='PCS')
  and coalesce((rule->>'min_subtotal')::numeric,0)=0,false)
 )) not valid;

-- A unique shared scope serializes concurrent activation, including callers
-- forcing deferred target guards IMMEDIATE before either transaction commits.
create unique index quantity_pool_active_scope_unique on public.promos((rule->>'quantity_pool_scope'))
 where is_active and rule->>'discount_mode'='quantity_pool';

-- The original manager/version/ACL checks stay intact. Caller mode hints never
-- authorize the legacy editor to edit an authoritative saved quantity pool.
do $$
declare definition text;anchor text:=$anchor$if jsonb_typeof(p_values) is distinct from 'object' or not p_values ?& fields$anchor$;
begin
 definition:=pg_get_functiondef('public.edit_promo(uuid,text,jsonb,uuid[])'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'QUANTITY_POOL_EDITOR_DRIFT';
 end if;
 execute replace(definition,anchor,
  $guard$if existing.rule->>'discount_mode'='quantity_pool' then
  raise exception 'QUANTITY_POOL_READONLY: saved quantity pool cannot be edited through legacy editor';
 end if;
 $guard$||anchor);
end$$;

-- Immutable reviewed SKU-code identity, independent of nullable legacy brands.
create function public.quantity_pool_scope_codes(scope text) returns text[]
language sql immutable set search_path='' as $$
 select case scope
  when 'bolt_800gr' then array['DRC8993374326970','DRC8993374326987','DRC8993374326994']
  when 'cat_choize_adult' then array['DRC8994125000064','DRC8994125000118']
 end
$$;
revoke all on function public.quantity_pool_scope_codes(text) from public,anon,authenticated,service_role;
-- Explicit target lists: never the legacy "empty means all" interpretation.
-- The existing manager guard locks each promo before child target changes.
create function public.quantity_pool_target_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare candidate uuid;p public.promos%rowtype;codes text[];nonstock boolean;ids uuid[];
begin
 if tg_table_name='promos' then ids:=array[new.id];
 else
  if tg_op<>'INSERT' then ids:=array[old.promo_id];end if;
  if tg_op<>'DELETE' then ids:=coalesce(ids,'{}')||new.promo_id;end if;
 end if;
 for candidate in select distinct id from unnest(ids) x(id) where id is not null order by id loop
  select * into p from public.promos where id=candidate for share;
  if p.rule->>'discount_mode'='quantity_pool' and p.is_active then
   select array_agg(i.code::text order by i.code::text),bool_or(i.item_type<>'Persediaan')
    into codes,nonstock from public.promo_items t join public.items i on i.id=t.item_id where t.promo_id=p.id;
   if public.quantity_pool_scope_codes(p.rule->>'quantity_pool_scope') is null
    or codes is distinct from public.quantity_pool_scope_codes(p.rule->>'quantity_pool_scope') or nonstock then
    raise exception 'QUANTITY_POOL_TARGET: exact reviewed stock SKU code set required for named scope' using errcode='23514';
   end if;
   if exists(select 1 from public.promo_items a join public.promo_items b on b.item_id=a.item_id and b.promo_id<>a.promo_id
    join public.promos other on other.id=b.promo_id where a.promo_id=p.id and other.is_active and other.rule->>'discount_mode'='quantity_pool') then
    raise exception 'QUANTITY_POOL_TARGET: overlapping active pools' using errcode='23514';
   end if;
  end if;
 end loop;
 return null;
end$$;
revoke all on function public.quantity_pool_target_guard() from public,anon,authenticated,service_role;
create constraint trigger quantity_pool_targets_header after insert or update on public.promos
 deferrable initially deferred for each row execute function public.quantity_pool_target_guard();
create constraint trigger quantity_pool_targets_items after insert or update or delete on public.promo_items
 deferrable initially deferred for each row execute function public.quantity_pool_target_guard();

alter table public.sale_items add column source_position integer check(source_position>=0),
 add column quantity_pool_claim boolean not null default false;
-- This is a fail-closed intent fence, never pricing authority. Derive it from
-- the actual master; a caller cannot erase it after staging or use it to obtain
-- a discount. It survives the original promo FK's ON DELETE SET NULL action.
create function public.quantity_pool_claim_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare is_pool boolean;
begin
 select rule->>'discount_mode'='quantity_pool' into is_pool from public.promos where id=new.promo_id;
 is_pool:=coalesce(is_pool,false);
 if tg_op='INSERT' then
  if new.quantity_pool_claim and not is_pool then raise exception 'QUANTITY_POOL_ELIGIBILITY: quoted master changed before staging';end if;
  new.quantity_pool_claim:=is_pool;
 else
  if new.quantity_pool_claim is distinct from old.quantity_pool_claim then raise exception 'QUANTITY_POOL_SNAPSHOT: pricing intent is immutable';end if;
  new.quantity_pool_claim:=old.quantity_pool_claim or is_pool;
 end if;
 return new;
end$$;
revoke all on function public.quantity_pool_claim_guard() from public,anon,authenticated,service_role;
create trigger quantity_pool_claim before insert or update on public.sale_items for each row execute function public.quantity_pool_claim_guard();
create unique index sale_items_source_position on public.sale_items(sale_id,source_position) where source_position is not null;
create function public.quantity_pool_position_guard() returns trigger
language plpgsql set search_path='' as $$begin
 if old.source_position is not null and new.source_position is distinct from old.source_position then
  raise exception 'QUANTITY_POOL_POSITION: source order is immutable';
 end if;
 return new;
end$$;
revoke all on function public.quantity_pool_position_guard() from public,anon,authenticated,service_role;
create trigger quantity_pool_source_position before update on public.sale_items for each row execute function public.quantity_pool_position_guard();

-- Only the original finalization transition writes these snapshots. No writable
-- client column, caller JSON equality check, GUC bypass, or client write grants.
create table public.sale_line_pricing(
 sale_item_id uuid primary key references public.sale_items(id) on delete restrict,
 sale_id uuid not null references public.sales(id) on delete restrict,
 version integer not null check(version=1), source_position integer not null check(source_position>=0),
 gross numeric not null check(gross>=0), item_discount numeric not null check(item_discount>=0 and item_discount<=gross),
 net_goods numeric not null check(net_goods>=0), net_paid numeric not null check(net_paid>=0),
 snapshot jsonb not null, unique(sale_id,source_position)
);
alter table public.sale_line_pricing enable row level security;
revoke all on public.sale_line_pricing from public,anon,authenticated,service_role;
grant select on public.sale_line_pricing to authenticated;
create policy sale_line_pricing_read on public.sale_line_pricing for select to authenticated
 using(exists(select 1 from public.sales s where s.id=sale_id and public.user_can_access_branch(s.branch_id)));
create function public.quantity_pool_snapshot_immutable() returns trigger
language plpgsql set search_path='' as $$begin
 raise exception 'QUANTITY_POOL_SNAPSHOT: pricing snapshot is immutable';
end$$;
revoke all on function public.quantity_pool_snapshot_immutable() from public,anon,authenticated,service_role;
create trigger quantity_pool_snapshot_immutable before update or delete on public.sale_line_pricing
 for each row execute function public.quantity_pool_snapshot_immutable();

-- An untrusted legacy label/amount cannot suppress a winning new pool. This
-- allowance is used ONLY by the new-rule eligibility guard; legacy finalization
-- and historical refund behavior are not rewritten. Formula mirrors current
-- per_unit/package_total precedence and original source-order allocation.
create function public.quantity_pool_competing_discount(l public.sale_items,s public.sales) returns numeric
language plpgsql security definer set search_path='' as $$
declare p public.promos%rowtype;mode text;n numeric;q numeric;kena numeric;amount numeric;per_unit numeric;previous numeric;
 today date:=(now() at time zone 'Asia/Jakarta')::date;
begin
 if l.promo_id is null or coalesce(l.promo_discount,0)<=0 then return 0;end if;
 select * into p from public.promos where id=l.promo_id for share;
 mode:=coalesce(p.rule->>'discount_mode','per_unit');
 if not found or not p.is_active or not p.auto_apply or mode not in('per_unit','package_total')
  or p.discount_type is null or p.discount_value is null or p.discount_value<=0
  or p.valid_from>today or p.valid_until<today
  or (cardinality(p.branch_ids)>0 and not s.branch_id=any(p.branch_ids))
  or (coalesce(p.rule->>'unit','')<>'' and p.rule->>'unit'<>l.satuan)
  or coalesce((p.rule->>'min_subtotal')::numeric,0)>s.subtotal
  or (exists(select 1 from public.promo_items where promo_id=p.id)
   and not exists(select 1 from public.promo_items where promo_id=p.id and item_id=l.item_id)) then return 0;end if;
 n:=coalesce(p.min_qty,1);
 if mode='per_unit' then
  if l.qty<n then return 0;end if;
  kena:=case when p.kelipatan then floor(l.qty/n)*n else l.qty end;
  kena:=least(kena,coalesce(p.max_qty,kena));
  per_unit:=case when p.discount_type='percent' then round(l.harga*least(p.discount_value,100)/100)
   else least(p.discount_value,l.harga) end;
  amount:=least(round(per_unit*kena),round(l.harga*l.qty));
 else
  if p.discount_type<>'nominal' or p.min_qty is null or l.source_position is null then return 0;end if;
  select sum(i.qty) into q from public.sale_items i where i.sale_id=s.id and i.item_id=l.item_id
   and i.satuan is not distinct from l.satuan and i.harga=l.harga;
  if q<n then return 0;end if;
  kena:=case when p.kelipatan then floor(q/n)*n else q end;
  kena:=least(kena,coalesce(p.max_qty,kena));
  if kena<n then return 0;end if;
  kena:=case when p.kelipatan then floor(kena/n) else 1 end;
  amount:=least(round(p.discount_value*kena),round(l.harga*n*kena));
  if exists(select 1 from public.sale_items i where i.sale_id=s.id and i.item_id=l.item_id
    and i.satuan is not distinct from l.satuan and i.harga=l.harga and i.source_position>l.source_position) then
   amount:=floor(amount*l.qty/q);
  else
   select coalesce(sum(floor(amount*i.qty/q)),0) into previous from public.sale_items i where i.sale_id=s.id and i.item_id=l.item_id
    and i.satuan is not distinct from l.satuan and i.harga=l.harga and i.id<>l.id;
   amount:=amount-previous;
  end if;
 end if;
 return case when l.promo_discount<=amount then l.promo_discount else 0 end;
exception when invalid_text_representation or numeric_value_out_of_range then return 0;
end$$;
revoke all on function public.quantity_pool_competing_discount(public.sale_items,public.sales) from public,anon,authenticated,service_role;

create function public.quantity_pool_finalize_guard() returns trigger
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare p public.promos%rowtype;line record;members jsonb;allocation jsonb:='[]';q numeric;discount numeric;
 other_discount numeric;remaining numeric;claimed boolean;expected numeric;after_items numeric;goods numeric;
 today date:=(now() at time zone 'Asia/Jakarta')::date;
begin
 if old.payments_finalized_at is not null or new.payments_finalized_at is null then return new;end if;
 if exists(select 1 from public.sale_items l left join public.promos p on p.id=l.promo_id where l.sale_id=new.id
   and l.quantity_pool_claim and (p.id is null or p.rule->>'discount_mode' is distinct from 'quantity_pool')) then
  raise exception 'QUANTITY_POOL_ELIGIBILITY: pending new-rule master was removed or changed';
 end if;
 -- Legacy receipts without a relevant new-mode master follow the exact old path.
 if not exists(select 1 from public.promos p where p.rule->>'discount_mode'='quantity_pool' and
   (exists(select 1 from public.sale_items l where l.sale_id=new.id and l.promo_id=p.id)
    or (p.is_active and p.auto_apply and exists(select 1 from public.promo_items t join public.sale_items l on l.item_id=t.item_id where t.promo_id=p.id and l.sale_id=new.id)))) then return new;end if;
 perform 1 from public.sale_items where sale_id=new.id order by id for update;
 -- Same source locks as the original finalizer, then current official catalog.
 perform 1 from public.items i where i.id in(select item_id from public.sale_items where sale_id=new.id) order by i.id for share;
 perform 1 from public.item_units u where u.item_id in(select item_id from public.sale_items where sale_id=new.id) order by u.item_id,u.unit for share;
 perform 1 from public.item_branch_prices b where b.branch_id=new.branch_id and b.item_id in(select item_id from public.sale_items where sale_id=new.id) order by b.item_id,b.unit for share;
 for p in select p.* from public.promos p where p.rule->>'discount_mode'='quantity_pool' and
   (exists(select 1 from public.sale_items l where l.sale_id=new.id and l.promo_id=p.id)
    or (p.is_active and p.auto_apply and exists(select 1 from public.promo_items t join public.sale_items l on l.item_id=t.item_id where t.promo_id=p.id and l.sale_id=new.id))) order by p.id for share loop
  select exists(select 1 from public.sale_items where sale_id=new.id and promo_id=p.id) into claimed;
  if not p.is_active or not p.auto_apply or p.valid_from>today or p.valid_until<today
   or (cardinality(p.branch_ids)>0 and not new.branch_id=any(p.branch_ids)) then
   if claimed then raise exception 'QUANTITY_POOL_ELIGIBILITY: inactive, expired, future or wrong branch';end if;
   continue;
  end if;
  perform 1 from public.items i where i.id in(select t.item_id from public.promo_items t where t.promo_id=p.id) order by i.id for share;
  if public.quantity_pool_scope_codes(p.rule->>'quantity_pool_scope') is null or (select
    array_agg(i.code::text order by i.code::text) is distinct from public.quantity_pool_scope_codes(p.rule->>'quantity_pool_scope')
    or bool_or(i.item_type<>'Persediaan')
    from public.promo_items t join public.items i on i.id=t.item_id where t.promo_id=p.id) then
   raise exception 'QUANTITY_POOL_TARGET: current targets must equal reviewed named code scope';
  end if;
  if p.rule->'quantity_pool' is distinct from '{"version":1,"unit":"PCS","normal_price":20000,"tiers":[{"qty":6,"total":110000},{"qty":2,"total":38000}]}'::jsonb then
   raise exception 'QUANTITY_POOL_RULE: unsupported or partial rule';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'qty',l.qty,'position',l.source_position) order by l.source_position),'[]'),coalesce(sum(l.qty),0),
   coalesce(sum(case when l.promo_id is distinct from p.id then public.quantity_pool_competing_discount(l,new) else 0 end),0)
   into members,q,other_discount
   from public.sale_items l join public.promo_items t on t.item_id=l.item_id and t.promo_id=p.id
   join public.items i on i.id=l.item_id
   left join public.item_units u on u.item_id=i.id and u.unit=l.satuan and l.satuan<>i.unit
   left join public.item_branch_prices b on b.item_id=i.id and b.unit=l.satuan and b.branch_id=new.branch_id
   where l.sale_id=new.id and i.is_active and i.item_type='Persediaan'
    and l.qty>0 and l.qty=trunc(l.qty) and l.qty<=1e9 and l.faktor=1 and upper(l.satuan)='PCS'
    and (case when l.satuan=i.unit then 1 else u.factor end)=1
    and l.harga=20000 and coalesce(b.sell_price,case when l.satuan=i.unit then i.sell_price else u.sell_price end)=20000
    and coalesce(l.item_discount_value,0)<=0;
  -- Fixed, reviewed v1 tiers: repeated six, then two, then normal remainder.
  discount:=floor(q/6)*10000+floor(mod(q,6)/2)*2000;
  if discount>0 and discount>other_discount then
   if exists(select 1 from jsonb_to_recordset(members) x(id uuid,qty numeric,position integer) where position is null) then
    raise exception 'QUANTITY_POOL_POSITION: refresh the cashier before checkout';
   end if;
   with raw as(select x.*,floor(discount*x.qty/q) base,mod(discount*x.qty,q) rem from jsonb_to_recordset(members) x(id uuid,qty numeric,position integer)),
   ranked as(select *,row_number() over(order by rem desc,position) rank,sum(base) over() base_sum from raw)
   select allocation||jsonb_agg(jsonb_build_object('id',id,'promo',p.id,'discount',base+case when rank<=discount-base_sum then 1 else 0 end)) into allocation from ranked;
  elsif claimed then
   raise exception 'QUANTITY_POOL_ELIGIBILITY: pool is not the winning eligible promotion';
  end if;
 end loop;
 -- Validate actual source rows, not a caller-authored snapshot or promo name.
 for line in select l.*,p.rule->>'discount_mode' mode from public.sale_items l left join public.promos p on p.id=l.promo_id where l.sale_id=new.id loop
  select x.discount into expected from jsonb_to_recordset(allocation) x(id uuid,promo uuid,discount numeric) where x.id=line.id;
  if found then
   -- The new rule cannot turn direct finalization into a stock/HPP bypass.
   -- Attribution is emitted by the original sale_stock_out_fifo writer; client
   -- roles cannot forge its metadata. No changes to its FIFO/expiry algorithm.
   if not exists(select 1 from public.stock_moves m join public.warehouses w on w.id=m.warehouse_id
     where m.source_ref=new.no_struk and m.source='sale' and m.sale_line_id=line.id and m.item_id=line.item_id and w.branch_id=new.branch_id
     group by m.sale_line_id having -sum(m.qty)=line.qty*line.faktor and round(sum(-m.qty*m.unit_cost),2)=line.hpp) then
    raise exception 'QUANTITY_POOL_HPP: exact original stock and HPP provenance required';
   end if;
   if line.promo_id is distinct from (select x.promo from jsonb_to_recordset(allocation) x(id uuid,promo uuid,discount numeric) where x.id=line.id)
    or line.promo_discount is distinct from expected then
    raise exception 'QUANTITY_POOL_TOTAL: refresh quote; authoritative line allocation differs';
   end if;
  elsif line.mode='quantity_pool' then
   raise exception 'QUANTITY_POOL_ELIGIBILITY: line not eligible for this pool';
  end if;
 end loop;
 if jsonb_array_length(allocation)=0 then return new;end if;
 if exists(select 1 from public.sale_items where sale_id=new.id and source_position is null)
  or (select count(*)<>coalesce(max(source_position),-1)+1 from public.sale_items where sale_id=new.id) then
  raise exception 'QUANTITY_POOL_POSITION: complete immutable source order required';
 end if;
 select sum(qty*harga-least(qty*harga,greatest(0,case when coalesce(item_discount_value,0)>0 then
  case when item_discount_type='percent' then round(qty*harga*item_discount_value/100) else item_discount_value end
  else coalesce(promo_discount,0) end))) into after_items from public.sale_items where sale_id=new.id;
 goods:=new.total-coalesce(new.merchant_fee_total,0);
 if after_items<=0 or goods<0 or goods>after_items then raise exception 'QUANTITY_POOL_TOTAL: header exceeds authoritative net items';end if;
 -- Allocate whole cents independently for goods and actual paid total, using
 -- largest remainder then immutable source_position (same pool tie rule as TS).
 with weights as(select l.*,l.qty*l.harga gross,
  least(l.qty*l.harga,greatest(0,case when coalesce(l.item_discount_value,0)>0 then
   case when l.item_discount_type='percent' then round(l.qty*l.harga*l.item_discount_value/100) else l.item_discount_value end
   else coalesce(l.promo_discount,0) end)) discount from public.sale_items l where l.sale_id=new.id),
 raw as(select *,floor(goods*100*(gross-discount)/after_items) g,floor(new.total*100*(gross-discount)/after_items) n,
  mod(goods*100*(gross-discount),after_items) gr,mod(new.total*100*(gross-discount),after_items) nr from weights),
 ranked as(select *,row_number() over(order by gr desc,source_position) gi,row_number() over(order by nr desc,source_position) ni,
  sum(g) over() gs,sum(n) over() ns from raw)
 insert into public.sale_line_pricing(sale_item_id,sale_id,version,source_position,gross,item_discount,net_goods,net_paid,snapshot)
 select r.id,new.id,1,r.source_position,r.gross,r.discount,
  (g+case when gi<=goods*100-gs then 1 else 0 end)/100,(n+case when ni<=new.total*100-ns then 1 else 0 end)/100,
  jsonb_build_object('version',1,'item_id',r.item_id,'qty',r.qty,'unit',r.satuan,'factor',r.faktor,'price',r.harga,'promo_id',r.promo_id,
   'promo_rule',(select p.rule from public.promos p where p.id=r.promo_id),'source_position',r.source_position)
 from ranked r;
 return new;
end$$;
revoke all on function public.quantity_pool_finalize_guard() from public,anon,authenticated,service_role;
-- Original finalize_pos_sale updates this only after its actor, source, HPP and
-- accounting checks. Throwing here rolls back the original atomic stock RPC too.
create trigger quantity_pool_finalize before update of payments_finalized_at on public.sales
 for each row execute function public.quantity_pool_finalize_guard();
-- Only new-mode backoffice receipts use this transaction boundary. SECURITY
-- INVOKER adds no data privilege: every stock issue and finalization calls the
-- original authorized RPC, and HPP updates remain subject to original RLS.
-- Unlike cashier posting, backoffice retains its original warning-only HPP policy.
create function public.quantity_pool_post_backoffice_atomic(p_sale_id uuid,p_warehouse_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.sales%rowtype;l record;cost numeric;result jsonb;issued integer:=0;
begin
 select * into s from public.sales where id=p_sale_id for update;
 if not found or s.channel is not null or s.payment_plan is null or s.payments_finalized_at is not null or s.voided_at is not null then
  raise exception 'QUANTITY_POOL_POST: pending backoffice sale required';
 end if;
 if not exists(select 1 from public.sale_items source_row join public.items i on i.id=source_row.item_id
   where source_row.sale_id=s.id and (i.code in('DRC8993374326970','DRC8993374326987','DRC8993374326994','DRC8994125000118','DRC8994125000064')
    or exists(select 1 from public.promos p where p.id=source_row.promo_id and p.rule->>'discount_mode'='quantity_pool'))) then
  raise exception 'QUANTITY_POOL_POST: reviewed pool-covered receipt required';
 end if;
 if not exists(select 1 from public.warehouses where id=p_warehouse_id and branch_id=s.branch_id and is_active)
  or exists(select 1 from public.stock_moves where source_ref=s.no_struk and source in('sale','sale-group')) then
  raise exception 'QUANTITY_POOL_POST: invalid warehouse or stock already issued';
 end if;
 perform 1 from public.sale_items where sale_id=s.id order by id for update;
 for l in select i.* from public.sale_items i join public.items m on m.id=i.item_id
   where i.sale_id=s.id and m.item_type='Persediaan' order by i.item_id,i.created_at,i.id loop
  select x.cost into strict cost from public.sale_stock_out_fifo(p_warehouse_id,l.item_id,l.qty*l.faktor,'sale',s.no_struk,
    (s.created_at at time zone 'Asia/Jakarta')::date,l.id) x;
  update public.sale_items set hpp=cost where id=l.id and sale_id=s.id;
  if not found then raise exception 'QUANTITY_POOL_POST: source HPP update refused';end if;
  issued:=issued+1;
 end loop;
 if issued=0 then raise exception 'QUANTITY_POOL_POST: inventory rows required';end if;
 result:=public.finalize_pos_sale(s.id);
 if result->>'finalized' is distinct from 'true' then raise exception 'QUANTITY_POOL_POST: original finalization incomplete';end if;
 return result||jsonb_build_object('checked',true,'stock_events',issued);
end$$;
revoke all on function public.quantity_pool_post_backoffice_atomic(uuid,uuid) from public,anon,service_role;
grant execute on function public.quantity_pool_post_backoffice_atomic(uuid,uuid) to authenticated;

-- Both existing quote and posting paths use the same stored paid source net.
-- No snapshot means a genuinely historical sale: preserve its exact old formula.
create function public.quantity_pool_refund_unit_price(p_line uuid,p_legacy numeric) returns numeric
language plpgsql stable security definer set search_path='' as $$
declare l public.sale_items%rowtype;v public.sale_line_pricing%rowtype;
begin
 select * into strict l from public.sale_items where id=p_line;
 select * into v from public.sale_line_pricing where sale_item_id=l.id;
 if found then
  if v.version<>1 or l.qty<=0 or l.faktor<=0 then raise exception 'QUANTITY_POOL_SNAPSHOT: invalid refund source';end if;
  return v.net_paid/(l.qty*l.faktor);
 end if;
 if exists(select 1 from public.sale_line_pricing where sale_id=l.sale_id) then
  raise exception 'QUANTITY_POOL_SNAPSHOT: incomplete refund source';
 end if;
 return p_legacy;
end$$;
revoke all on function public.quantity_pool_refund_unit_price(uuid,numeric) from public,anon,authenticated,service_role;
-- Anchored replacements fail closed on source drift, preserving every other
-- original authorization, reservation, expiry, HPP, payout and replay statement.
do $$
declare p record;definition text;
begin
 for p in select * from (values
  ('public.sales_refund_quote(uuid,jsonb,uuid)',
   'raw_total:=raw_total+base*l.harga/l.faktor*ratio;',
   'raw_total:=raw_total+base*public.quantity_pool_refund_unit_price(l.id,l.harga/l.faktor*ratio);'),
  ('public.return_record_post_base(text,uuid,text,jsonb,jsonb)',
   'price:=src.harga/src.faktor*ratio;',
   'price:=public.quantity_pool_refund_unit_price(src.id,src.harga/src.faktor*ratio);')
 ) x(sig,old_text,new_text) loop
  definition:=pg_get_functiondef(p.sig::regprocedure);
  if (length(definition)-length(replace(definition,p.old_text,'')))/length(p.old_text)<>1 then
   raise exception 'QUANTITY_POOL_REFUND_DRIFT: %',p.sig;
  end if;
  execute replace(definition,p.old_text,p.new_text);
 end loop;
end$$;
commit;
