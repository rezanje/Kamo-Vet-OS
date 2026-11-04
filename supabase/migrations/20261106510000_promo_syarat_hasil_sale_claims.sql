-- Promo "Syarat -> Hasil", stage 2b: PER-SALE persistence and the DB-side verification at finalization.
-- Requires 20261106500000 (definition, release flags) and the installed quantity_pool migration (20261105020000).
--
-- Nothing recomputes the optimum: the application (stage 1 engine) proposes a witness assignment per sale line
-- (which units were consumed as syarat, which units got the reward, how many sets) and the database independently re-checks that
-- witness against the CURRENT masters: promo still valid, official unit/factor/price, discount = the exact per-unit formula,
-- sets/grants/syarat feasibility, whole-cart nilai, stock+HPP provenance. A forged, stale or over-claimed witness is refused and
-- the whole original atomic transaction (stock, journals) rolls back.
--
-- Untouched: finalize_pos_sale, sale_stock_out_fifo, quantity_pool_competing_discount, refund functions. Patched (anchored, fail closed):
-- quantity_pool_finalize_guard (three exact anchors: members, snapshot keys, cashier pick). The HPP-floor patch is the next migration.
--
-- APP CONTRACT (stage-2 review):
--  * A line carrying a claim (promo_claim_id) is excluded from the Bolt quantity pool AS A WHOLE LINE (SH_POOL_MEMBERS): units of the
--    same line that are neither syarat nor hasil units get NO pool discount (safe direction: the customer pays more). The app must
--    SPLIT a cart line into a claimed line (syarat/hasil units only) and a plain line for the rest, exactly like the Bolt pool does.
--  * A below-HPP waiver line (promo_floor_waiver) must be a PURE reward line: promo_hasil_units = qty, promo_syarat_units = 0
--    (readable trigger refusal + CHECK). The relaxed HPP floor therefore never covers non-reward units.
--  * nilai syarat (R1, stage-2 re-review): each line counts at LESSER( qty x OFFICIAL master price, what the customer is ACTUALLY charged for
--    the line ), never more than the real money in the cart. REFINEMENT of Andri's "nilai belanja = seluruh keranjang" (he did not say
--    "before discount"; that was our earlier assumption) - decision of the parent agent, NOT yet confirmed by Andri/Reza, who may overrule:
--    the earlier reading made the threshold cashier-controlled, because harga, manual discount and qty are client-written and lines without
--    an HPP floor (Jasa / Non-Persediaan) can be priced at Rp1, discounted 100% or sold in qty 1,000,000 at harga 0.
--    Actually charged = qty*harga - least(greatest(d,0), qty*harga) with d = the manual line discount (percent: round(gross*value/100); any
--    other type: the value) when it is > 0, else promo_discount (another mechanism such as the Bolt pool) - exactly the formula the finalize
--    guard and the P03 floor use for the line net - BEFORE cart-level voucher/points/total discount. R5 (stage-3): the reward discount of a line
--    that carries a claim IS subtracted like every other discount (no special case): reward units never qualify their own nilai syarat, the
--    threshold means the money actually charged for the cart (a reward-only cart paid Rp1.000 counts Rp1.000). The engine plans the sets so that this
--    holds (largest set count whose own reward discount still leaves nilai >= sets x min). H2: non-finite harga/qty count 0. A line of qty >= 1,000,000 counts 0 (absurd-quantity bound, the engine uses the same bound), a line without
--    an active item / official price (free text, inactive item, unknown unit) counts 0. Consequences the app must know: a manual discount, a tier
--    price below the official price or a Persediaan line sold at HPP counts at the discounted amount; an overcharge counts at the official price.
--    Why this is provable without a new HPP rule: the counted value of every line is bounded by what the sale charges for it, and a below-HPP
--    waiver sale additionally needs total = sum of line nets (P03 waiver floor), so the waiver reward units cannot be unlocked with value the
--    customer does not pay. Residual (documented, by decision): cart-level voucher/points/total discount are not subtracted.
--  * promo_selection is display-only text, bounded to 8192 bytes; it never influences pricing.
--  * The P03 HPP floor lives only in cashier_post_stock_atomic (pre-existing): a caller that uses sale_stock_out_fifo + finalize_pos_sale
--    directly skips it (claim verification still runs). See also the waiver migration header.
begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Columns. Claim columns carry no FK (promo_id's ON DELETE SET NULL must not erase the audit trail; promos cannot be deleted anyway).
-- ---------------------------------------------------------------------------------------------
alter table public.sale_items
 add column promo_claim_id uuid,
 add column promo_sets integer not null default 0,
 add column promo_syarat_units numeric not null default 0,
 add column promo_hasil_units numeric not null default 0,
 add column promo_floor_waiver boolean not null default false;
alter table public.sale_items add constraint sale_items_promo_claim_shape check(
 (promo_claim_id is null and promo_sets=0 and promo_syarat_units=0 and promo_hasil_units=0 and not promo_floor_waiver)
 or (promo_claim_id is not null and promo_sets>=1 and promo_syarat_units>=0 and promo_hasil_units>=0
  and promo_syarat_units+promo_hasil_units>0 and promo_syarat_units=trunc(promo_syarat_units) and promo_hasil_units=trunc(promo_hasil_units)
  and promo_syarat_units+promo_hasil_units<=qty
  and ((promo_hasil_units>0 and promo_id=promo_claim_id and promo_discount>0) or (promo_hasil_units=0 and promo_id is null and promo_discount=0))
  and (not promo_floor_waiver or (promo_hasil_units=qty and promo_syarat_units=0)))) not valid; -- L1: a waiver line is made of reward units ONLY
alter table public.sale_items validate constraint sale_items_promo_claim_shape;

alter table public.sales
 add column promo_pick_id uuid,
 add column promo_pick_mode text,
 add column promo_pick_exclusive boolean not null default false,
 add column promo_selection jsonb;
alter table public.sales add constraint sales_promo_pick_shape check(
 ((promo_pick_mode is null and promo_pick_id is null and not promo_pick_exclusive and promo_selection is null)
  or (promo_pick_mode in('auto','tanpa') and promo_pick_id is null and not promo_pick_exclusive)
  or (promo_pick_mode='pilih' and promo_pick_id is not null))
 and (promo_selection is null or (jsonb_typeof(promo_selection)='object' and promo_selection->'version'='1'::jsonb))) not valid;
alter table public.sales validate constraint sales_promo_pick_shape;
-- S3: promo_selection is display-only client text (never used for pricing): bound its size so it cannot bloat sales rows.
alter table public.sales add constraint sales_promo_selection_bound check(promo_selection is null or octet_length(promo_selection::text)<=8192) not valid;
alter table public.sales validate constraint sales_promo_selection_bound;

-- ---------------------------------------------------------------------------------------------
-- 2. Insert-time guards (cheap, no pricing authority): claims must point at a real syarat_hasil promo and are immutable.
-- ---------------------------------------------------------------------------------------------
create function public.promo_sh_claim_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.promos%rowtype;
begin
 if tg_op='UPDATE' then
  if new.promo_claim_id is distinct from old.promo_claim_id or new.promo_sets is distinct from old.promo_sets
   or new.promo_syarat_units is distinct from old.promo_syarat_units or new.promo_hasil_units is distinct from old.promo_hasil_units
   or new.promo_floor_waiver is distinct from old.promo_floor_waiver then
   raise exception 'PROMO_SH_SNAPSHOT: promo claim is immutable';
  end if;
  -- S2: the "syarat_hasil promo only through its claim" rule holds on UPDATE too (promo_id repointed after insert)
  if new.promo_id is distinct from old.promo_id and new.promo_id is not null and new.promo_claim_id is distinct from new.promo_id
   and exists(select 1 from public.promos x where x.id=new.promo_id and x.rule->>'discount_mode'='syarat_hasil') then
   raise exception 'PROMO_SH_CLAIM: a syarat_hasil promo can only be attached to a line through its claim';
  end if;
  return new;
 end if;
 if new.promo_id is not null and new.promo_claim_id is distinct from new.promo_id and exists(select 1 from public.promos x where x.id=new.promo_id and x.rule->>'discount_mode'='syarat_hasil') then
  raise exception 'PROMO_SH_CLAIM: a syarat_hasil promo can only be attached to a line through its claim';
 end if;
 if new.promo_claim_id is null then return new;end if;
 select * into p from public.promos where id=new.promo_claim_id;
 if not found or p.rule->>'discount_mode' is distinct from 'syarat_hasil' then
  raise exception 'PROMO_SH_CLAIM: claim must point at an existing syarat_hasil promo';
 end if;
 if new.source_position is null then raise exception 'PROMO_SH_CLAIM: a claimed line needs its immutable source_position';end if;
 if coalesce(new.item_discount_value,0)>0 then raise exception 'PROMO_SH_CLAIM: a manual line discount cannot take part in a promo claim';end if;
 if new.promo_floor_waiver and coalesce(p.rule#>>'{syarat_hasil,below_hpp,allowed}','false')<>'true' then
  raise exception 'PROMO_SH_CLAIM: the promo has no Owner below-HPP waiver';
 end if;
 -- L1: the relaxed HPP floor applies to a waiver line as a whole, so the line may contain reward units only. The app splits a
 -- cart line into a plain/syarat line and a pure reward line (like the Bolt pool); the other units keep the ordinary HPP floor.
 if new.promo_floor_waiver and (new.promo_hasil_units is distinct from new.qty or new.promo_syarat_units<>0) then
  raise exception 'PROMO_SH_CLAIM: a below-HPP waiver line (promo_floor_waiver) may only contain reward units: promo_hasil_units must equal qty and promo_syarat_units 0; split the line';
 end if;
 return new;
end$$;
revoke all on function public.promo_sh_claim_guard() from public,anon,authenticated,service_role;
create trigger promo_sh_claim before insert or update on public.sale_items for each row execute function public.promo_sh_claim_guard();

create function public.promo_sh_sale_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare changed boolean;
begin
 changed:=tg_op='UPDATE' and (new.promo_pick_id is distinct from old.promo_pick_id or new.promo_pick_mode is distinct from old.promo_pick_mode
  or new.promo_pick_exclusive is distinct from old.promo_pick_exclusive or new.promo_selection is distinct from old.promo_selection);
 if changed and old.payments_finalized_at is not null then
  raise exception 'PROMO_SH_PICK: the cashier promo selection is immutable after finalization';
 end if;
 if (tg_op='INSERT' or changed) and new.promo_pick_mode in('pilih','tanpa') then
  if not public.promo_release_enabled('promo_picker') then
   raise exception 'PROMO_SH_RELEASE: promo picker is not released' using errcode='55000';
  end if;
  if new.promo_pick_mode='pilih' and not exists(select 1 from public.promos where id=new.promo_pick_id) then
   raise exception 'PROMO_SH_PICK: picked promo does not exist';
  end if;
 end if;
 return new;
end$$;
revoke all on function public.promo_sh_sale_guard() from public,anon,authenticated,service_role;
create trigger promo_sh_sale before insert or update on public.sales for each row execute function public.promo_sh_sale_guard();

-- ---------------------------------------------------------------------------------------------
-- 3. Exact per-unit formula, identical to the stage-1 engine (nominal capped at price-1; percent half-up, per-unit max_amount, price-1 cap).
-- ---------------------------------------------------------------------------------------------
create function public.promo_sh_unit_discount(p_rule jsonb,p_price numeric) returns numeric
language sql immutable set search_path='' as $$
 select case when p_price<=1 then 0 else least(p_price-1,
  case p_rule#>>'{syarat_hasil,hasil,discount,type}'
   when 'nominal' then (p_rule#>>'{syarat_hasil,hasil,discount,value}')::numeric
   else least(floor((p_price*(p_rule#>>'{syarat_hasil,hasil,discount,value}')::numeric+50)/100),
    coalesce((p_rule#>>'{syarat_hasil,hasil,discount,max_amount}')::numeric,'Infinity'::numeric)) end) end
$$;
revoke all on function public.promo_sh_unit_discount(jsonb,numeric) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. Independent feasibility check of every claim on a sale (raises; callers hold the locks).
-- ---------------------------------------------------------------------------------------------
create function public.promo_sh_verify_claims(p_sale uuid) returns void
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare s public.sales%rowtype;p public.promos%rowtype;l record;m record;today date:=(now() at time zone 'Asia/Jakarta')::date;
 sh jsonb;rq numeric;a integer;grants numeric;row_json jsonb;cur_row integer:=0;supplied numeric;cart numeric;problem text;want uuid[];have uuid[];
begin
 select * into strict s from public.sales where id=p_sale;
 for p in select pr.* from public.promos pr where pr.id in(select promo_claim_id from public.sale_items where sale_id=p_sale and promo_claim_id is not null) order by pr.id loop
  if not public.promo_release_enabled('syarat_hasil') then
   raise exception 'PROMO_SH_RELEASE: syarat_hasil is not released' using errcode='55000';
  end if;
  if not p.is_active or not p.auto_apply or p.valid_from>today or p.valid_until<today
   or (cardinality(p.branch_ids)>0 and not s.branch_id=any(p.branch_ids)) then
   raise exception 'PROMO_SH_ELIGIBILITY: inactive, expired, future or wrong branch';
  end if;
  problem:=coalesce(public.promo_syarat_hasil_rule_problem(p.rule),public.promo_sh_targets_problem(p.rule));
  if problem is not null then raise exception 'PROMO_SH_RULE: %',problem;end if;
  select coalesce(array_agg(distinct r.item_id order by r.item_id),'{}') into want from public.promo_sh_refs(p.rule) r;
  select coalesce(array_agg(t.item_id order by t.item_id),'{}') into have from public.promo_items t where t.promo_id=p.id;
  if want is distinct from have then raise exception 'PROMO_SH_TARGET: promo_items differ from the rule';end if;
  sh:=p.rule->'syarat_hasil';
  rq:=coalesce((sh->'hasil'->>'reward_qty')::numeric,1);
  if (select count(distinct promo_sets) from public.sale_items where sale_id=p_sale and promo_claim_id=p.id)<>1 then
   raise exception 'PROMO_SH_SETS: claimed lines of one promo must agree on the number of sets';
  end if;
  select promo_sets into a from public.sale_items where sale_id=p_sale and promo_claim_id=p.id limit 1;
  if (sh->>'repeat')::boolean is not true and a<>1 then raise exception 'PROMO_SH_SETS: a promo without repeat can be applied once only';end if;
  -- every claimed line against the CURRENT masters
  for l in select i.* from public.sale_items i where i.sale_id=p_sale and i.promo_claim_id=p.id order by i.source_position loop
   select it.is_active active,it.item_type,case when l.satuan=it.unit then 1 else u.factor end official_factor,
    coalesce(b.sell_price,case when l.satuan=it.unit then it.sell_price else u.sell_price end) official_price
   into m from public.items it
   left join public.item_units u on u.item_id=it.id and u.unit=l.satuan and l.satuan<>it.unit
   left join public.item_branch_prices b on b.item_id=it.id and b.unit=l.satuan and b.branch_id=s.branch_id
   where it.id=l.item_id;
   if not found or not m.active or m.item_type<>'Persediaan' or m.official_factor is null or l.faktor is distinct from m.official_factor
    or m.official_price is null or l.harga is distinct from m.official_price or l.qty<>trunc(l.qty) or l.qty<1 or l.qty>1e9
    or coalesce(l.item_discount_value,0)>0 or l.harga<>trunc(l.harga) then
    raise exception 'PROMO_SH_LINE: claimed line must be an active stock item at its official unit, factor and price, whole quantity, no manual discount';
   end if;
   if l.promo_syarat_units>0 and not exists(select 1 from public.promo_sh_refs(p.rule) r where r.row_no>0 and r.item_id=l.item_id and r.unit=l.satuan) then
    raise exception 'PROMO_SH_LINE: syarat units on an item outside every syarat pool';
   end if;
   if l.promo_hasil_units>0 then
    if not exists(select 1 from public.promo_sh_refs(p.rule) r where r.row_no=0 and r.item_id=l.item_id and r.unit=l.satuan) then
     raise exception 'PROMO_SH_LINE: hasil units on an item outside the hasil pool';
    end if;
    if l.promo_discount is distinct from l.promo_hasil_units*public.promo_sh_unit_discount(p.rule,l.harga) then
     raise exception 'PROMO_SH_TOTAL: refresh quote; discount differs from the promo formula';
    end if;
    -- exact original stock + HPP provenance (the discounted line cannot be finalized with fabricated cost)
    if not exists(select 1 from public.stock_moves mv join public.warehouses w on w.id=mv.warehouse_id
      where mv.source_ref=s.no_struk and mv.source='sale' and mv.sale_line_id=l.id and mv.item_id=l.item_id and w.branch_id=s.branch_id
      group by mv.sale_line_id having -sum(mv.qty)=l.qty*l.faktor and round(sum(-mv.qty*mv.unit_cost),2)=l.hpp) then
     raise exception 'PROMO_SH_HPP: exact original stock and HPP provenance required';
    end if;
   end if;
   if l.promo_floor_waiver and (coalesce(sh#>>'{below_hpp,allowed}','false')<>'true' or not public.promo_release_enabled('below_hpp')) then
    raise exception 'PROMO_SH_WAIVER: below-HPP waiver is not granted/released for this promo';
   end if;
  end loop;
  select coalesce(sum(promo_hasil_units),0) into grants from public.sale_items where sale_id=p_sale and promo_claim_id=p.id;
  if grants<1 or grants>a*rq or grants<=(a-1)*rq then
   raise exception 'PROMO_SH_GRANTS: hasil units % do not match % set(s) of reward_qty %',grants,a,rq;
  end if;
  -- syarat rows: qty rows need a*min consumed units inside the pool; nilai rows need a*min of whole-cart value = sum of lesser(official value, actually charged) per line (R1)
  for row_json in select x from jsonb_array_elements(sh->'syarat') x loop
   cur_row:=cur_row+1;
   if row_json->>'kind'='qty' then
    select coalesce(sum(i.promo_syarat_units),0) into supplied from public.sale_items i
     where i.sale_id=p_sale and i.promo_claim_id=p.id and exists(select 1 from public.promo_sh_refs(p.rule) r where r.row_no=cur_row and r.item_id=i.item_id and r.unit=i.satuan);
    if supplied<a*(row_json->>'min')::numeric then
     raise exception 'PROMO_SH_SYARAT: row % needs % units, claim supplies %',cur_row,a*(row_json->>'min')::numeric,supplied;
    end if;
   else
    -- S1 + R1 + R5 + H2: ONLY lines that join an active item master count, each at the LESSER of qty x OFFICIAL price (branch price, else unit/base price)
    -- and the amount actually charged for the line (same net formula as the finalize guard / P03 floor). R5: a claim line is NOT special: its own verified
    -- reward discount is subtracted like any other discount, so reward units can never qualify their own nilai syarat (the cart counts the money actually
    -- charged). Free text / no official price -> 0; qty >= 1,000,000 on one line -> 0; H2: a non-finite (NaN / +-Infinity) or absurd harga/qty (|x| > 1e15) -> 0.
    -- harga/discount/qty are client-written: they can only LOWER the count.
    select coalesce(sum(case when not (i.qty<1000000 and i.qty>=-1e15 and i.harga<=1e15 and i.harga>=-1e15) then 0 else least(i.qty*coalesce(b.sell_price,case when i.satuan=it.unit then it.sell_price else u.sell_price end,0),
      i.qty*i.harga-least(greatest(case when d.manual>0 then d.manual else coalesce(i.promo_discount,0) end,0),i.qty*i.harga)) end),0) into cart
     from public.sale_items i join public.items it on it.id=i.item_id and it.is_active
     cross join lateral(select case when i.item_discount_type='percent' then round(i.qty*i.harga*coalesce(i.item_discount_value,0)/100,0) else coalesce(i.item_discount_value,0) end manual) d
     left join public.item_units u on u.item_id=it.id and u.unit=i.satuan and i.satuan<>it.unit
     left join public.item_branch_prices b on b.item_id=it.id and b.unit=i.satuan and b.branch_id=s.branch_id
     where i.sale_id=p_sale;
    if cart<a*(row_json->>'min')::numeric then
     raise exception 'PROMO_SH_NILAI: whole-cart value % (each line at the lesser of official price and actual charge) is below % x %',cart,a,row_json->>'min';
    end if;
   end if;
  end loop;
  cur_row:=0;
 end loop;
end$$;
revoke all on function public.promo_sh_verify_claims(uuid) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. Finalization guard. Trigger name sorts AFTER quantity_pool_finalize so the pool writer (if any) has already written the snapshot.
-- ---------------------------------------------------------------------------------------------
create function public.promo_sh_finalize_guard() returns trigger
language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare after_items numeric;goods numeric;
begin
 if old.payments_finalized_at is not null or new.payments_finalized_at is null then return new;end if;
 if new.promo_pick_mode='tanpa' and exists(select 1 from public.sale_items where sale_id=new.id and (promo_id is not null or promo_claim_id is not null)) then
  raise exception 'PROMO_SH_PICK: cashier chose no promo but lines carry one';
 end if;
 if new.promo_pick_mode='pilih' and new.promo_pick_exclusive and exists(select 1 from public.sale_items where sale_id=new.id
   and ((promo_id is not null and promo_id<>new.promo_pick_id) or (promo_claim_id is not null and promo_claim_id<>new.promo_pick_id))) then
  raise exception 'PROMO_SH_PICK: exclusive pick but another promo is on a line';
 end if;
 if not exists(select 1 from public.sale_items where sale_id=new.id and (promo_claim_id is not null or promo_floor_waiver)) then return new;end if;
 -- same lock order as the pool guard: lines, then catalog, then promos
 perform 1 from public.sale_items where sale_id=new.id order by id for update;
 perform 1 from public.items i where i.id in(select item_id from public.sale_items where sale_id=new.id) order by i.id for share;
 perform 1 from public.item_units u where u.item_id in(select item_id from public.sale_items where sale_id=new.id) order by u.item_id,u.unit for share;
 perform 1 from public.item_branch_prices b where b.branch_id=new.branch_id and b.item_id in(select item_id from public.sale_items where sale_id=new.id) order by b.item_id,b.unit for share;
 perform 1 from public.promos p where p.id in(select promo_claim_id from public.sale_items where sale_id=new.id and promo_claim_id is not null) order by p.id for share;
 perform 1 from public.items i where i.id in(select t.item_id from public.promo_items t where t.promo_id in(select promo_claim_id from public.sale_items where sale_id=new.id and promo_claim_id is not null)) order by i.id for share;
 perform public.promo_sh_verify_claims(new.id);
 -- The pool writer (patched below to add the claim keys) already wrote a complete snapshot for mixed Bolt carts.
 if exists(select 1 from public.sale_line_pricing where sale_id=new.id) then return new;end if;
 if exists(select 1 from public.sale_items where sale_id=new.id and source_position is null)
  or (select count(*)<>coalesce(max(source_position),-1)+1 from public.sale_items where sale_id=new.id) then
  raise exception 'PROMO_SH_POSITION: complete immutable source order required';
 end if;
 select sum(qty*harga-least(qty*harga,greatest(0,case when coalesce(item_discount_value,0)>0 then
  case when item_discount_type='percent' then round(qty*harga*item_discount_value/100) else item_discount_value end
  else coalesce(promo_discount,0) end))) into after_items from public.sale_items where sale_id=new.id;
 goods:=new.total-coalesce(new.merchant_fee_total,0);
 if after_items<=0 or goods<0 or goods>after_items then raise exception 'PROMO_SH_TOTAL: header exceeds authoritative net items';end if;
 -- Same largest-remainder cent allocation as the pool writer (goods and paid total independently, ties by immutable source_position).
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
   'promo_rule',(select p.rule from public.promos p where p.id=r.promo_id),'source_position',r.source_position,
   'promo_claim_id',r.promo_claim_id,'sets',r.promo_sets,'syarat_units',r.promo_syarat_units,'hasil_units',r.promo_hasil_units,'waiver',r.promo_floor_waiver)
 from ranked r;
 return new;
end$$;
revoke all on function public.promo_sh_finalize_guard() from public,anon,authenticated,service_role;
create trigger quantity_pool_finalize_sh before update of payments_finalized_at on public.sales
 for each row execute function public.promo_sh_finalize_guard();

-- ---------------------------------------------------------------------------------------------
-- 6. quantity_pool_finalize_guard: three exact anchors, fail closed on drift (design 8.5).
--    (1) lines claimed by a syarat_hasil promo are not pool members (otherwise QUANTITY_POOL_TOTAL rejects the checkout);
--    (2) the pool-written snapshot also carries the claim keys; (3) a cashier pick of another promo / no promo stops the pool from
--        imposing itself, a pick of the pool forces it (competing legacy discounts ignored).
-- ---------------------------------------------------------------------------------------------
do $$
declare
 sig regprocedure:='public.quantity_pool_finalize_guard()'::regprocedure;
 definition text:=pg_get_functiondef(sig);
 p record;
begin
 if position('SH_POOL' in definition)>0 then raise exception 'SH_POOL_DRIFT: pool guard already patched';end if;
 for p in select * from(values
  ($a$ where l.sale_id=new.id and i.is_active and i.item_type='Persediaan'$a$,
   $b$ where l.sale_id=new.id and i.is_active and i.item_type='Persediaan' and l.promo_claim_id is null -- SH_POOL_MEMBERS$b$),
  ($a$'source_position',r.source_position)$a$,
   $b$'source_position',r.source_position,'promo_claim_id',r.promo_claim_id,'sets',r.promo_sets,'syarat_units',r.promo_syarat_units,'hasil_units',r.promo_hasil_units,'waiver',r.promo_floor_waiver)$b$),
  ($a$ if discount>0 and discount>other_discount then$a$,
   $b$ if discount>0 and (case when new.promo_pick_mode='pilih' and new.promo_pick_id=p.id then true when new.promo_pick_mode in('pilih','tanpa') then false else discount>other_discount end) then -- SH_POOL_PICK$b$)
 ) x(old_text,new_text) loop
  if (length(definition)-length(replace(definition,p.old_text,'')))/length(p.old_text)<>1 then
   raise exception 'SH_POOL_DRIFT: quantity_pool_finalize_guard changed; review before release (anchor %)',left(p.old_text,40);
  end if;
  definition:=replace(definition,p.old_text,p.new_text);
 end loop;
 execute definition;
end$$;

-- ---------------------------------------------------------------------------------------------
-- 7. Backoffice atomic composition for syarat_hasil sales (mirror of quantity_pool_post_backoffice_atomic: SECURITY INVOKER, every
--    stock issue and the finalization call the ORIGINAL authorized RPCs, so a refused finalization rolls back the stock issue).
-- ---------------------------------------------------------------------------------------------
create function public.pos_post_promo_atomic(p_sale_id uuid,p_warehouse_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.sales%rowtype;l record;cost numeric;result jsonb;issued integer:=0;
begin
 select * into s from public.sales where id=p_sale_id for update;
 if not found or s.channel is not null or s.payment_plan is null or s.payments_finalized_at is not null or s.voided_at is not null then
  raise exception 'PROMO_SH_POST: pending backoffice sale required';
 end if;
 if not exists(select 1 from public.sale_items where sale_id=s.id and (promo_claim_id is not null or promo_floor_waiver)) then
  raise exception 'PROMO_SH_POST: syarat_hasil receipt required';
 end if;
 if not exists(select 1 from public.warehouses where id=p_warehouse_id and branch_id=s.branch_id and is_active)
  or exists(select 1 from public.stock_moves where source_ref=s.no_struk and source in('sale','sale-group')) then
  raise exception 'PROMO_SH_POST: invalid warehouse or stock already issued';
 end if;
 perform 1 from public.sale_items where sale_id=s.id order by id for update;
 for l in select i.* from public.sale_items i join public.items m on m.id=i.item_id
   where i.sale_id=s.id and m.item_type='Persediaan' order by i.item_id,i.created_at,i.id loop
  select x.cost into strict cost from public.sale_stock_out_fifo(p_warehouse_id,l.item_id,l.qty*l.faktor,'sale',s.no_struk,
   (s.created_at at time zone 'Asia/Jakarta')::date,l.id) x;
  update public.sale_items set hpp=cost where id=l.id and sale_id=s.id;
  if not found then raise exception 'PROMO_SH_POST: source HPP update refused';end if;
  issued:=issued+1;
 end loop;
 if issued=0 then raise exception 'PROMO_SH_POST: inventory rows required';end if;
 result:=public.finalize_pos_sale(s.id);
 if result->>'finalized' is distinct from 'true' then raise exception 'PROMO_SH_POST: original finalization incomplete';end if;
 return result||jsonb_build_object('checked',true,'stock_events',issued);
end$$;
revoke all on function public.pos_post_promo_atomic(uuid,uuid) from public,anon,service_role;
grant execute on function public.pos_post_promo_atomic(uuid,uuid) to authenticated;
commit;
