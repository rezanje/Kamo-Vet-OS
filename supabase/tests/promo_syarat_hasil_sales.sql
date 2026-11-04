-- Stage 2b: per-sale claims, immutable snapshot, DB-side feasibility check at finalization, Bolt pool interplay, cashier pick.
-- Promo masters are created directly as the database owner (the definition suite proves the RPC path); everything money-related
-- below goes through the ORIGINAL public RPCs (cashier_post_stock_atomic / finalize_pos_sale) as a STAFF cashier.
update promo_release_flags set enabled=true;
select pg_temp.mk('p1',pg_temp.rule_of(pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}')));
select pg_temp.mk('p1n',pg_temp.rule_of(pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1100}'),false));
select pg_temp.mk('p2',pg_temp.rule_of(pg_temp.bolt_syarat()||'[{"kind":"nilai","min":100000}]'::jsonb,pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1200}')));
select pg_temp.mk('p3',pg_temp.rule_of(pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1300}',2)));
select pg_temp.mk('p4',pg_temp.rule_of(pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"percent","value":50,"max_amount":4000}')));
select pg_temp.mk('p5',pg_temp.rule_of(pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1400}',null,'BOX')));
select pg_temp.mk('pw',pg_temp.rule_of(pg_temp.bolt_syarat(),pg_temp.hasil_of('EXP-REJECT','{"type":"nominal","value":5000}'),true,
 '{"allowed":true,"reason":"barang mendekati expired","ack_by":"e1100000-0000-4000-8000-000000000003","ack_at":"2026-11-04T01:02:03Z"}'));
set constraints all immediate;set constraints all deferred;
select pg_temp.ok((select count(*)=7 and bool_and(is_active) from promos where rule->>'discount_mode'='syarat_hasil'),'seven fictional syarat_hasil masters active (flags on)');

select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
set local role authenticated;

-- ============================================================ 1. a valid claim posts through the ORIGINAL cashier RPC
select pg_temp.sale('SH.B1',55000,54000);
select pg_temp.cl('SH.B1','DRC8993374326970',2,20000,0,pg_temp.pid('p1'),1,2,0,0);
select pg_temp.cl('SH.B1','ANC-CREAMY',1,15000,1,pg_temp.pid('p1'),1,0,1,1000);
select pg_temp.ok((pg_temp.post('SH.B1')->>'finalized')::boolean,'Bolt Ikan x2 (syarat) + ANC x1 (hasil -1000) finalizes although the Bolt pool is active and would also match 2 Bolt');
select pg_temp.ok((select count(*)=2 and sum(net_paid)=54000 and sum(item_discount)=1000 from sale_line_pricing where sale_id=(select id from sales where no_struk='SH.B1')),'immutable pricing snapshot covers EVERY line (net 54000, discount 1000; the syarat line stays at normal price)');
select pg_temp.ok((select (pg_temp.snap('SH.B1',1)->>'promo_claim_id')::uuid=pg_temp.pid('p1') and (pg_temp.snap('SH.B1',1)->>'hasil_units')::numeric=1 and (pg_temp.snap('SH.B1',0)->>'syarat_units')::numeric=2
  and (pg_temp.snap('SH.B1',1)->>'net_paid')::numeric=14000),'snapshot carries claim promo id, syarat/hasil units and waiver flag');
select pg_temp.ok((select -sum(qty)=3 from stock_moves where source_ref='SH.B1'),'stock moved by the original FIFO writer');
select pg_temp.must_reject($q$update sale_line_pricing set net_paid=1 where sale_id=(select id from sales where no_struk='SH.B1')$q$,'permission denied|immutable','STAFF cannot rewrite the snapshot');
select pg_temp.must_reject($q$update sale_items set promo_hasil_units=0 where sale_id=(select id from sales where no_struk='SH.B1')$q$,'diposting|PROMO_SH_SNAPSHOT','a posted sale line cannot be rewritten');

-- repeat (kelipatan): 3 Ikan + 2 Donat = 5 units -> 2 sets (4 syarat units), 2 ANC discounted
select pg_temp.sale('SH.REP',3*20000+2*20000+2*15000,3*20000+2*20000+2*14000);
select pg_temp.cl('SH.REP','DRC8993374326970',3,20000,0,pg_temp.pid('p1'),2,3,0,0);
select pg_temp.cl('SH.REP','DRC8993374326987',2,20000,1,pg_temp.pid('p1'),2,1,0,0);
select pg_temp.cl('SH.REP','ANC-CREAMY',2,15000,2,pg_temp.pid('p1'),2,0,2,2000);
select pg_temp.ok((pg_temp.post('SH.REP')->>'finalized')::boolean,'kelipatan: 5 mixed Bolt units -> 2 sets, 2 hasil units, one spare Bolt unit stays at normal price');
select pg_temp.ok((select sum(net_paid)=128000 from sale_line_pricing where sale_id=(select id from sales where no_struk='SH.REP')),'repeat sale pays 130000 - 2000 = 128000');
-- partial claim on a line: 3 ANC, only 1 discounted
select pg_temp.sale('SH.PART',40000+45000,40000+45000-1000);
select pg_temp.cl('SH.PART','DRC8993374326970',2,20000,0,pg_temp.pid('p1'),1,2,0,0);
select pg_temp.cl('SH.PART','ANC-CREAMY',3,15000,1,pg_temp.pid('p1'),1,0,1,1000);
select pg_temp.ok((pg_temp.post('SH.PART')->>'finalized')::boolean,'a hasil line may hold more units than discounted (1 of 3)');
select pg_temp.ok((select (pg_temp.snap('SH.PART',1)->>'net_paid')::numeric=44000 and (pg_temp.snap('SH.PART',1)->>'hasil_units')::numeric=1),'3 ANC line nets 44000 (2 full + 1 discounted)');

-- ============================================================ 2. insert-time guards (claims cannot be forged into the table)
select pg_temp.sale('SH.F.INS',1,1);
select pg_temp.must_reject($q$select pg_temp.cl('SH.F.INS','ANC-CREAMY',1,15000,0,gen_random_uuid(),1,0,1,1000)$q$,'PROMO_SH_CLAIM','claim to a promo that does not exist refused');
select pg_temp.must_reject($q$select pg_temp.cl('SH.F.INS','ANC-CREAMY',1,15000,0,'f2000000-0000-4000-8000-000000000001',1,0,1,1000)$q$,'PROMO_SH_CLAIM','claim to the Bolt quantity pool (not a syarat_hasil promo) refused');
select pg_temp.must_reject($q$select pg_temp.cl('SH.F.INS','ANC-CREAMY',1,15000,0,pg_temp.pid('p1'),1,0,1,1000,true)$q$,'PROMO_SH_CLAIM','below-HPP waiver flag on a promo without the Owner waiver refused');
select pg_temp.must_reject($q$select pg_temp.cl('SH.F.INS','ANC-CREAMY',1,15000,0,pg_temp.pid('p1'),1,0,1,1000,false,'PCS',1,null,500)$q$,'PROMO_SH_CLAIM|sale_items_promo_claim','manual discount on a claimed line refused');
select pg_temp.must_reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,promo_id,promo_discount)
 select s.id,i.id,i.name,1,15000,'PCS',1,0,0,pg_temp.pid('p1'),1000 from sales s cross join items i where s.no_struk='SH.F.INS' and i.code='ANC-CREAMY'$q$,'PROMO_SH_CLAIM','a legacy promo_id/promo_discount pointing at a syarat_hasil promo WITHOUT a claim refused');
select pg_temp.must_reject($q$select pg_temp.cl('SH.F.INS','ANC-CREAMY',1,15000,0,pg_temp.pid('p1'),1,0,2,2000)$q$,'sale_items_promo_claim','hasil units above the line quantity refused (CHECK)');
select pg_temp.must_reject($q$select pg_temp.cl('SH.F.INS','ANC-CREAMY',1,15000,0,pg_temp.pid('p1'),0,0,1,1000)$q$,'sale_items_promo_claim','sets must be >= 1 for a claim (CHECK)');
select pg_temp.must_reject($q$select pg_temp.cl('SH.F.INS','ANC-CREAMY',1,15000,0,pg_temp.pid('p1'),1,0,1,0)$q$,'sale_items_promo_claim','a hasil line must carry a positive discount (CHECK)');
select pg_temp.must_reject($q$insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,promo_claim_id,promo_sets,promo_syarat_units)
 select s.id,i.id,i.name,2,20000,'PCS',1,0,pg_temp.pid('p1'),1,2 from sales s cross join items i where s.no_struk='SH.F.INS' and i.code='DRC8993374326970'$q$,'PROMO_SH_CLAIM|source_position','a claimed line needs its immutable source_position');

-- pending sale: claim columns are immutable even before finalization
select pg_temp.sale('SH.IMM',55000,54000);
select pg_temp.cl('SH.IMM','ANC-CREAMY',1,15000,0,pg_temp.pid('p1'),1,0,1,1000);
select pg_temp.must_reject($q$update sale_items set promo_hasil_units=1,promo_sets=2 where sale_id=(select id from sales where no_struk='SH.IMM')$q$,'PROMO_SH_SNAPSHOT','claim columns are immutable after insert (sets)');
select pg_temp.must_reject($q$update sale_items set promo_claim_id=pg_temp.pid('p2') where sale_id=(select id from sales where no_struk='SH.IMM')$q$,'PROMO_SH_SNAPSHOT','claim cannot be re-pointed to another promo');
select pg_temp.must_reject($q$update sale_items set promo_floor_waiver=true where sale_id=(select id from sales where no_struk='SH.IMM')$q$,'PROMO_SH_SNAPSHOT','waiver flag cannot be switched on later');
-- ============================================================ 3. finalization: forged / over-claimed / stale claims are refused and roll back stock
create function pg_temp.refused(ref text,pattern text,label text) returns text language plpgsql as $$
declare r text;begin
 r:=pg_temp.must_reject(format('select pg_temp.post(%L)',ref),pattern,label);
 if exists(select 1 from stock_moves where source_ref=ref) then raise exception 'stock leaked for %',ref;end if;
 if exists(select 1 from sale_line_pricing where sale_id=(select id from sales where no_struk=ref)) then raise exception 'snapshot leaked for %',ref;end if;
 return r;
end$$;
-- a. discount higher than the formula
select pg_temp.sale('SH.F.DISC',55000,53999);
select pg_temp.cl('SH.F.DISC','DRC8993374326970',2,20000,0,pg_temp.pid('p1'),1,2,0,0);
select pg_temp.cl('SH.F.DISC','ANC-CREAMY',1,15000,1,pg_temp.pid('p1'),1,0,1,1001);
select pg_temp.refused('SH.F.DISC','PROMO_SH_TOTAL','discount 1001 instead of the formula 1000 refused; stock and snapshot rolled back');
-- b. syarat not met (only 1 Bolt)
select pg_temp.sale('SH.F.SYARAT',35000,34000);
select pg_temp.cl('SH.F.SYARAT','DRC8993374326970',1,20000,0,pg_temp.pid('p1'),1,1,0,0);
select pg_temp.cl('SH.F.SYARAT','ANC-CREAMY',1,15000,1,pg_temp.pid('p1'),1,0,1,1000);
select pg_temp.refused('SH.F.SYARAT','PROMO_SH_SYARAT','one Bolt cannot satisfy "2 Bolt" even when the client says so');
-- c. more hasil units than the sets allow
select pg_temp.sale('SH.F.GRANTS',70000,68000);
select pg_temp.cl('SH.F.GRANTS','DRC8993374326970',2,20000,0,pg_temp.pid('p1'),1,2,0,0);
select pg_temp.cl('SH.F.GRANTS','ANC-CREAMY',2,15000,1,pg_temp.pid('p1'),1,0,2,2000);
select pg_temp.refused('SH.F.GRANTS','PROMO_SH_GRANTS','2 hasil units for 1 set (reward_qty 1) refused');
-- d. sets inconsistent across lines / above what the syarat supports
select pg_temp.sale('SH.F.SETS',70000,68000);
select pg_temp.cl('SH.F.SETS','DRC8993374326970',2,20000,0,pg_temp.pid('p1'),2,2,0,0);
select pg_temp.cl('SH.F.SETS','ANC-CREAMY',2,15000,1,pg_temp.pid('p1'),2,0,2,2000);
select pg_temp.refused('SH.F.SETS','PROMO_SH_SYARAT','2 sets claimed but the syarat units only cover 1 set');
select pg_temp.sale('SH.F.SETS2',95000,94000);
select pg_temp.cl('SH.F.SETS2','DRC8993374326970',2,20000,0,pg_temp.pid('p1'),1,2,0,0);
select pg_temp.cl('SH.F.SETS2','DRC8993374326987',2,20000,1,pg_temp.pid('p1'),2,2,0,0);
select pg_temp.cl('SH.F.SETS2','ANC-CREAMY',1,15000,2,pg_temp.pid('p1'),1,0,1,1000);
select pg_temp.refused('SH.F.SETS2','PROMO_SH_SETS','claimed lines of one promo must agree on the number of sets');
-- non-repeat promo cannot be claimed twice
select pg_temp.sale('SH.F.NOREP',4*20000+2*15000,4*20000+2*15000-2200);
select pg_temp.cl('SH.F.NOREP','DRC8993374326970',4,20000,0,pg_temp.pid('p1n'),2,4,0,0);
select pg_temp.cl('SH.F.NOREP','ANC-CREAMY',2,15000,1,pg_temp.pid('p1n'),2,0,2,2200);
select pg_temp.refused('SH.F.NOREP','PROMO_SH_SETS','a promo without repeat can be applied once only');
-- e. item outside the pools
select pg_temp.sale('SH.F.ITEM',40000+80000,40000+80000-1000);
select pg_temp.cl('SH.F.ITEM','DRC8993374326970',2,20000,0,pg_temp.pid('p1'),1,2,0,0);
select pg_temp.cl('SH.F.ITEM','KOPI',1,80000,1,pg_temp.pid('p1'),1,0,1,1000);
select pg_temp.refused('SH.F.ITEM','PROMO_SH_LINE','a hasil line outside the hasil pool refused');
-- f. non-official price on a claimed line
select pg_temp.sale('SH.F.PRICE',40000+14000,40000+14000-1000);
select pg_temp.cl('SH.F.PRICE','DRC8993374326970',2,20000,0,pg_temp.pid('p1'),1,2,0,0);
select pg_temp.cl('SH.F.PRICE','ANC-CREAMY',1,14000,1,pg_temp.pid('p1'),1,0,1,1000);
select pg_temp.refused('SH.F.PRICE','PROMO_SH_LINE','a claimed line must sit at the OFFICIAL price');
-- g. wrong factor for the unit
select pg_temp.sale('SH.F.UNIT',40000+140000,40000+140000-1400);
select pg_temp.cl('SH.F.UNIT','DRC8993374326970',2,20000,0,pg_temp.pid('p5'),1,2,0,0);
select pg_temp.cl('SH.F.UNIT','ANC-CREAMY',1,140000,1,pg_temp.pid('p5'),1,0,1,1400,false,'BOX',1);
select pg_temp.refused('SH.F.UNIT','PROMO_SH_LINE|Konversi satuan','BOX with factor 1 is not the official unit factor');
-- h. promo deactivated / expired / wrong branch between quote and finalization
select pg_temp.sale('SH.F.OFF',55000,54000);
select pg_temp.cl('SH.F.OFF','DRC8993374326970',2,20000,0,pg_temp.pid('p1'),1,2,0,0);
select pg_temp.cl('SH.F.OFF','ANC-CREAMY',1,15000,1,pg_temp.pid('p1'),1,0,1,1000);
reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);update promos set is_active=false where id=pg_temp.pid('p1');set local role authenticated;select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
select pg_temp.refused('SH.F.OFF','PROMO_SH_ELIGIBILITY','promo deactivated after the quote: finalization refused (never a silent price change)');
reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);update promos set branch_ids=array['e2200000-0000-4000-8000-000000000002']::uuid[] where id=pg_temp.pid('p1');update promos set is_active=true where id=pg_temp.pid('p1');set local role authenticated;select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
select pg_temp.refused('SH.F.OFF','PROMO_SH_ELIGIBILITY','promo scoped to another branch refused');
reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);update promos set is_active=false where id=pg_temp.pid('p1');update promos set branch_ids='{}' where id=pg_temp.pid('p1');update promos set is_active=true where id=pg_temp.pid('p1');set local role authenticated;select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
-- i. release flag turned off = fail-closed rollback lever
reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);update promo_release_flags set enabled=false where flag='syarat_hasil';set local role authenticated;select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
select pg_temp.refused('SH.F.OFF','PROMO_SH_RELEASE','release flag OFF: syarat_hasil claims are refused at finalization (rollback lever)');
reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);update promo_release_flags set enabled=true where flag='syarat_hasil';set local role authenticated;select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
select pg_temp.ok((pg_temp.post('SH.F.OFF')->>'finalized')::boolean,'same sale finalizes once the promo is active and the flag on again');
-- j. direct finalization cannot fabricate stock/HPP provenance
select pg_temp.sale('SH.F.DIRECT',55000,54000);
select pg_temp.cl('SH.F.DIRECT','DRC8993374326970',2,20000,0,pg_temp.pid('p1'),1,2,0,0);
select pg_temp.cl('SH.F.DIRECT','ANC-CREAMY',1,15000,1,pg_temp.pid('p1'),1,0,1,1000);
select pg_temp.must_reject($q$select finalize_pos_sale((select id from sales where no_struk='SH.F.DIRECT'))$q$,'PROMO_SH_HPP','direct STAFF finalization without stock provenance refused');
-- k. nilai row (whole cart at normal price)
select pg_temp.sale('SH.NILAI.OK',40000+15000+80000,40000+15000+80000-1200);
select pg_temp.cl('SH.NILAI.OK','DRC8993374326970',2,20000,0,pg_temp.pid('p2'),1,2,0,0);
select pg_temp.cl('SH.NILAI.OK','ANC-CREAMY',1,15000,1,pg_temp.pid('p2'),1,0,1,1200);
select pg_temp.pl('SH.NILAI.OK','KOPI',1,80000,2);
select pg_temp.ok((pg_temp.post('SH.NILAI.OK')->>'finalized')::boolean,'nilai row counts the WHOLE cart (Bolt 40000 + ANC 15000 + KOPI 80000 >= 100000)');
select pg_temp.sale('SH.NILAI.LOW',40000+15000,40000+15000-1200);
select pg_temp.cl('SH.NILAI.LOW','DRC8993374326970',2,20000,0,pg_temp.pid('p2'),1,2,0,0);
select pg_temp.cl('SH.NILAI.LOW','ANC-CREAMY',1,15000,1,pg_temp.pid('p2'),1,0,1,1200);
select pg_temp.refused('SH.NILAI.LOW','PROMO_SH_NILAI','cart value 55000 < 100000: nilai syarat refused');
-- l. reward_qty 2 and percent cap
select pg_temp.sale('SH.RQ',40000+30000,40000+30000-2600);
select pg_temp.cl('SH.RQ','DRC8993374326970',2,20000,0,pg_temp.pid('p3'),1,2,0,0);
select pg_temp.cl('SH.RQ','ANC-CREAMY',2,15000,1,pg_temp.pid('p3'),1,0,2,2600);
select pg_temp.ok((pg_temp.post('SH.RQ')->>'finalized')::boolean,'reward_qty 2: one set discounts two hasil units');
select pg_temp.sale('SH.RQ.BAD',40000+45000,40000+45000-3900);
select pg_temp.cl('SH.RQ.BAD','DRC8993374326970',2,20000,0,pg_temp.pid('p3'),1,2,0,0);
select pg_temp.cl('SH.RQ.BAD','ANC-CREAMY',3,15000,1,pg_temp.pid('p3'),1,0,3,3900);
select pg_temp.refused('SH.RQ.BAD','PROMO_SH_GRANTS','3 hasil units on a 1-set reward_qty 2 promo refused');
select pg_temp.sale('SH.PCT',40000+15000,40000+15000-4000);
select pg_temp.cl('SH.PCT','DRC8993374326970',2,20000,0,pg_temp.pid('p4'),1,2,0,0);
select pg_temp.cl('SH.PCT','ANC-CREAMY',1,15000,1,pg_temp.pid('p4'),1,0,1,4000);
select pg_temp.ok((pg_temp.post('SH.PCT')->>'finalized')::boolean,'percent 50% of 15000 = 7500 is capped by max_amount 4000 per reward unit');
select pg_temp.sale('SH.PCT.BAD',40000+15000,40000+15000-5000);
select pg_temp.cl('SH.PCT.BAD','DRC8993374326970',2,20000,0,pg_temp.pid('p4'),1,2,0,0);
select pg_temp.cl('SH.PCT.BAD','ANC-CREAMY',1,15000,1,pg_temp.pid('p4'),1,0,1,5000);
select pg_temp.refused('SH.PCT.BAD','PROMO_SH_TOTAL','discount 5000 above the per-unit max_amount 4000 refused');

-- ============================================================ 4. Bolt 2/6 pool interplay (design 8.5)
select pg_temp.sale('SH.POOL',40000+40000+15000,40000+38000+14000);
select pg_temp.cl('SH.POOL','DRC8993374326970',2,20000,0,pg_temp.pid('p1'),1,2,0,0);
select pg_temp.cl('SH.POOL','ANC-CREAMY',1,15000,1,pg_temp.pid('p1'),1,0,1,1000);
select pg_temp.cl('SH.POOL','DRC8993374326987',2,20000,2,null,0,0,0,2000,false,'PCS',1,'f2000000-0000-4000-8000-000000000001');
select pg_temp.ok((pg_temp.post('SH.POOL')->>'finalized')::boolean,'unclaimed Donat x2 still get the Bolt pool (38000) while Ikan x2 serve the syarat_hasil promo');
select pg_temp.ok((select count(*)=3 and sum(net_paid)=92000 from sale_line_pricing where sale_id=(select id from sales where no_struk='SH.POOL')),'one complete snapshot written (pool writer) for all 3 lines, net 92000');
select pg_temp.ok((pg_temp.snap('SH.POOL',1)->>'promo_claim_id')::uuid=pg_temp.pid('p1') and (pg_temp.snap('SH.POOL',0)->>'syarat_units')::numeric=2 and (pg_temp.snap('SH.POOL',2)->>'promo_claim_id') is null,
 'pool-written snapshot also carries the claim keys (SH lines) and null for the pool line');
-- the pool still refuses what it always refused
select pg_temp.sale('SH.POOL.LEGACY',40000,40000);
select pg_temp.pl('SH.POOL.LEGACY','DRC8993374326970',2,20000,0);
select pg_temp.must_reject($q$select pg_temp.post('SH.POOL.LEGACY')$q$,'QUANTITY_POOL_TOTAL','without any claim the pool still fails closed on an old client (unchanged)');

-- ============================================================ 5. cashier pick (promo_picker flag)
reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);update promo_release_flags set enabled=false where flag='promo_picker';set local role authenticated;select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
select pg_temp.must_reject($q$select pg_temp.sale('SH.PICK.OFF',40000,40000,'tanpa')$q$,'PROMO_SH_RELEASE','picking is blocked while the promo_picker flag is off');
reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);update promo_release_flags set enabled=true where flag='promo_picker';set local role authenticated;select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
select pg_temp.must_reject($q$select pg_temp.sale('SH.PICK.BAD1',40000,40000,'pilih')$q$,'sales_promo_pick|PROMO_SH_PICK','mode pilih without a promo refused');
select pg_temp.must_reject($q$select pg_temp.sale('SH.PICK.BAD2',40000,40000,'auto',pg_temp.pid('p1'))$q$,'sales_promo_pick|PROMO_SH_PICK','a pick id under auto mode refused');
select pg_temp.must_reject($q$select pg_temp.sale('SH.PICK.BAD3',40000,40000,'pilih',gen_random_uuid())$q$,'PROMO_SH_PICK','pick of a promo that does not exist refused');
select pg_temp.sale('SH.PICK.NONE',40000,40000,'tanpa');
select pg_temp.pl('SH.PICK.NONE','DRC8993374326970',2,20000,0);
select pg_temp.ok((pg_temp.post('SH.PICK.NONE')->>'finalized')::boolean,'cashier chose "tanpa promo": Bolt x2 at full 40000, the pool does NOT force itself');
select pg_temp.ok((select count(*)=0 from sale_line_pricing where sale_id=(select id from sales where no_struk='SH.PICK.NONE')) or (select sum(net_paid)=40000 from sale_line_pricing where sale_id=(select id from sales where no_struk='SH.PICK.NONE')),'no pool discount stored for the cancelled pool');
select pg_temp.sale('SH.PICK.NONE3',40000,38000,'tanpa');
select pg_temp.pl('SH.PICK.NONE3','DRC8993374326970',1,20000,0);
select pg_temp.pl('SH.PICK.NONE3','DRC8993374326987',1,20000,1);
update sale_items set promo_id='f2000000-0000-4000-8000-000000000001',promo_discount=1000 where sale_id=(select id from sales where no_struk='SH.PICK.NONE3');
select pg_temp.must_reject($q$select pg_temp.post('SH.PICK.NONE3')$q$,'QUANTITY_POOL_ELIGIBILITY|PROMO_SH_PICK','"tanpa" but the lines carry the pool promo: refused');
-- pick = SH promo: the pool does not force itself on unclaimed Bolt lines
select pg_temp.sale('SH.PICK.SH',40000,40000,'pilih',pg_temp.pid('p1'));
select pg_temp.pl('SH.PICK.SH','DRC8993374326970',2,20000,0);
select pg_temp.ok((pg_temp.post('SH.PICK.SH')->>'finalized')::boolean,'cashier picked the syarat_hasil promo (not applicable to this cart): pool is skipped, Bolt x2 at 40000');
-- pick = pool: unchanged pool behaviour
select pg_temp.sale('SH.PICK.POOL',40000,38000,'pilih','f2000000-0000-4000-8000-000000000001');
select pg_temp.pool_line('SH.PICK.POOL','DRC8993374326970',1,1000,0);
select pg_temp.pool_line('SH.PICK.POOL','DRC8993374326987',1,1000,1);
select pg_temp.ok((pg_temp.post('SH.PICK.POOL')->>'finalized')::boolean,'cashier picked the pool: finalizes');
select pg_temp.ok((select sum(net_paid)=38000 from sale_line_pricing where sale_id=(select id from sales where no_struk='SH.PICK.POOL')),'cashier picked the pool: 2 Bolt = 38000 as before');
-- pick = SH promo but a line claims the pool: inconsistent, refused
select pg_temp.sale('SH.PICK.INCONS',40000,38000,'pilih',pg_temp.pid('p1'));
select pg_temp.pool_line('SH.PICK.INCONS','DRC8993374326970',1,1000,0);
select pg_temp.pool_line('SH.PICK.INCONS','DRC8993374326987',1,1000,1);
select pg_temp.must_reject($q$select pg_temp.post('SH.PICK.INCONS')$q$,'QUANTITY_POOL_ELIGIBILITY','picked another promo yet the lines claim the pool: refused');
-- exclusive: nothing but the picked promo may appear on any line
reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);
insert into promos(id,name,promo_type,is_active,auto_apply,discount_type,discount_value,valid_from,valid_until,rule)
 values('f2000000-0000-4000-8000-0000000000a1','Fictional legacy per_unit','diskon_produk',true,true,'nominal',1000,(now() at time zone 'Asia/Jakarta')::date,(now() at time zone 'Asia/Jakarta')::date+30,'{}');
insert into promo_items values('f2000000-0000-4000-8000-0000000000a1',pg_temp.iid('KOPI'));
set local role authenticated;select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
select pg_temp.sale('SH.PICK.EXCL',40000+15000+80000,40000+15000+80000-1000-1000,'pilih',pg_temp.pid('p1'),true);
select pg_temp.cl('SH.PICK.EXCL','DRC8993374326970',2,20000,0,pg_temp.pid('p1'),1,2,0,0);
select pg_temp.cl('SH.PICK.EXCL','ANC-CREAMY',1,15000,1,pg_temp.pid('p1'),1,0,1,1000);
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,promo_id,promo_discount)
 select s.id,i.id,i.name,1,80000,'PCS',1,0,2,'f2000000-0000-4000-8000-0000000000a1',1000 from sales s cross join items i where s.no_struk='SH.PICK.EXCL' and i.code='KOPI';
select pg_temp.must_reject($q$select pg_temp.post('SH.PICK.EXCL')$q$,'PROMO_SH_PICK','exclusive pick of p1 while another promo sits on a line: refused');
select pg_temp.sale('SH.PICK.NOEXCL',40000+15000+80000,40000+15000+80000-1000-1000,'pilih',pg_temp.pid('p1'),false);
select pg_temp.cl('SH.PICK.NOEXCL','DRC8993374326970',2,20000,0,pg_temp.pid('p1'),1,2,0,0);
select pg_temp.cl('SH.PICK.NOEXCL','ANC-CREAMY',1,15000,1,pg_temp.pid('p1'),1,0,1,1000);
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,promo_id,promo_discount)
 select s.id,i.id,i.name,1,80000,'PCS',1,0,2,'f2000000-0000-4000-8000-0000000000a1',1000 from sales s cross join items i where s.no_struk='SH.PICK.NOEXCL' and i.code='KOPI';
select pg_temp.ok((pg_temp.post('SH.PICK.NOEXCL')->>'finalized')::boolean,'non-exclusive pick: the picked promo plus a non-conflicting legacy promo on another line finalize together');
select pg_temp.must_reject($q$update sales set promo_pick_mode='tanpa',promo_pick_id=null where no_struk='SH.PICK.NOEXCL'$q$,'PROMO_SH_PICK|permission|immutable|Snapshot keuangan','pick columns cannot change after finalization');

-- ============================================================ 6. snapshot/claim immutability and ACL
select pg_temp.must_reject($q$insert into sale_line_pricing(sale_item_id,sale_id,version,source_position,gross,item_discount,net_goods,net_paid,snapshot)
 select id,sale_id,1,99,1,0,1,1,'{}' from sale_items limit 1$q$,'permission denied','STAFF cannot insert a caller-authored snapshot');
select pg_temp.must_reject($q$delete from sale_line_pricing$q$,'permission denied|immutable','STAFF cannot delete snapshots');
reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);
select pg_temp.ok((select not has_function_privilege('authenticated','public.promo_sh_claim_guard()','execute') and not has_function_privilege('authenticated','public.promo_sh_finalize_guard()','execute')
  and not has_function_privilege('authenticated','public.promo_sh_verify_claims(uuid)','execute')),'ACL: claim/finalize/verify helpers are not callable by clients');
