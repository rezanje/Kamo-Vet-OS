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

-- ============================================================ 7. stage-2 review fixes (S1 nilai forgery, S2 UPDATE bypass, S3 bounded selection)
select pg_temp.mk('pnil',pg_temp.rule_of('[{"kind":"nilai","min":500000}]'::jsonb,pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}')));
set constraints all immediate;set constraints all deferred;
select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
set local role authenticated;
-- S1: a free-text line (no item master) must never count towards the whole-cart value, whatever harga/discount the client writes
select pg_temp.sale('SH.S1.FORGED',515000,14000);
select pg_temp.cl('SH.S1.FORGED','ANC-CREAMY',1,15000,1,pg_temp.pid('pnil'),1,0,1,1000);
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,item_discount_type,item_discount_value)
 select s.id,null,'Jasa bebas',1,500000,'PCS',1,0,0,'nominal',500000 from sales s where no_struk='SH.S1.FORGED';
select pg_temp.refused('SH.S1.FORGED','PROMO_SH_NILAI','S1: free-text Rp500k line with a 100% manual discount cannot satisfy a nilai syarat (customer would pay 14000)');
select pg_temp.sale('SH.S1.PLAIN',515000,515000-1000);
select pg_temp.cl('SH.S1.PLAIN','ANC-CREAMY',1,15000,1,pg_temp.pid('pnil'),1,0,1,1000);
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position)
 select s.id,null,'Jasa bebas',1,500000,'PCS',1,0,0 from sales s where no_struk='SH.S1.PLAIN';
select pg_temp.refused('SH.S1.PLAIN','PROMO_SH_NILAI','S1: a free-text line at client-chosen harga (no discount) does not count either: only the OFFICIAL master price counts');
-- control: master items at the OFFICIAL price still satisfy the same nilai syarat (KOPI 7 x 80000 = 560000)
select pg_temp.sale('SH.S1.REAL',15000+560000,15000+560000-1000);
select pg_temp.cl('SH.S1.REAL','ANC-CREAMY',1,15000,1,pg_temp.pid('pnil'),1,0,1,1000);
select pg_temp.pl('SH.S1.REAL','KOPI',7,80000,0);
select pg_temp.ok((pg_temp.post('SH.S1.REAL')->>'finalized')::boolean,'S1 control: a cart of master items at official prices (560000 + 15000) still satisfies the nilai syarat');
-- S2: promo_id cannot be repointed to a syarat_hasil promo after insert
select pg_temp.sale('SH.S2.UPD',15000,10000);
select pg_temp.pl('SH.S2.UPD','ANC-CREAMY',1,15000,0);
select pg_temp.must_reject($q$update sale_items set promo_id=pg_temp.pid('p1'),promo_discount=5000 where sale_id=(select id from sales where no_struk='SH.S2.UPD')$q$,'PROMO_SH_CLAIM','S2: UPDATE promo_id -> syarat_hasil promo without a claim is refused');
select pg_temp.must_reject($q$update sale_items set promo_claim_id=pg_temp.pid('p1'),promo_sets=1,promo_hasil_units=1,promo_id=pg_temp.pid('p1'),promo_discount=1000 where sale_id=(select id from sales where no_struk='SH.S2.UPD')$q$,'PROMO_SH_SNAPSHOT','S2: attaching a claim to an existing line by UPDATE is refused (claim columns immutable)');
select pg_temp.ok((select promo_id is null and promo_discount=0 from sale_items where sale_id=(select id from sales where no_struk='SH.S2.UPD')),'S2: the line is untouched');
select pg_temp.sale('SH.S2.LEGACY',15000,14000);
select pg_temp.pl('SH.S2.LEGACY','ANC-CREAMY',1,15000,0);
with u as(update sale_items set promo_id=null,promo_discount=0 where sale_id=(select id from sales where no_struk='SH.S2.LEGACY') returning 1) select pg_temp.ok(count(*)=1,'S2: ordinary updates of a line that does not target a syarat_hasil promo still work') from u;
-- S3: promo_selection is display-only client text (never used for pricing): bounded size
create function pg_temp.sale_sel(ref text,sel jsonb) returns void language sql as $$
 insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,promo_selection)
 values('e2200000-0000-4000-8000-000000000001',ref,15000,0,15000,'Tunai',15000,auth.uid(),'e4400000-0000-4000-8000-000000000001',
  '[{"method":"Tunai","amount":15000}]','sql:'||ref,repeat('a',64),sel)
$$;
select pg_temp.must_reject($q$select pg_temp.sale_sel('SH.S3.BIG',jsonb_build_object('version',1,'pad',repeat('x',20000)))$q$,'sales_promo_selection_bound','S3: an oversized promo_selection is refused');
select pg_temp.must_reject($q$select pg_temp.sale_sel('SH.S3.MANY',jsonb_build_object('version',1,'a',(select jsonb_agg(g) from generate_series(1,5000) g)))$q$,'sales_promo_selection_bound','S3: a many-element promo_selection is refused by the same bound');
select pg_temp.must_reject($q$select pg_temp.sale_sel('SH.S3.SHAPE','[1]'::jsonb)$q$,'sales_promo_pick_shape','S3: a non-object promo_selection is refused (shape CHECK)');
select pg_temp.sale_sel('SH.S3.OK',jsonb_build_object('version',1,'note','ok'));
select pg_temp.ok((select promo_selection->>'note'='ok' from sales where no_struk='SH.S3.OK'),'S3: a normal small promo_selection is accepted');

-- ============================================================ 8. stage-2 re-review R1: nilai counts min(qty x official price, what the customer is ACTUALLY charged)
-- Attack surface: harga, manual discount and qty are client-written, and lines without an HPP floor (Jasa / Non-Persediaan) are not
-- bounded by anything. Authoritative columns at verify time: items/item_units/item_branch_prices (official price, locked FOR SHARE by the
-- finalize guard) and the line's qty, harga, item_discount_*, promo_discount (the SAME columns cashier_post_stock_atomic / the finalize guard
-- use for the line net; promo_discount of a claim line is re-derived exactly by the claim verification, so its own reward discount is added back).
reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);
insert into items(id,code,name,unit,item_type,sell_price,buy_price,is_active) values
 ('e5500000-0000-4000-8000-0000000000b1','SVC600','Fictional paid service','PCS','Jasa',600000,0,true),
 ('e5500000-0000-4000-8000-0000000000b2','SVCOLD','Fictional INACTIVE service','PCS','Jasa',600000,0,false);
update items set sell_price=15000 where code='EXP-REJECT';
insert into item_branch_prices(item_id,branch_id,unit,sell_price) select id,'e2200000-0000-4000-8000-000000000001','PCS',100000 from items where code='KOPI';
select pg_temp.mk('pnw',pg_temp.rule_of('[{"kind":"nilai","min":500000}]'::jsonb,pg_temp.hasil_of('EXP-REJECT','{"type":"nominal","value":5000}'),true,
 '{"allowed":true,"reason":"barang mendekati expired","ack_by":"e1100000-0000-4000-8000-000000000003","ack_at":"2026-11-04T01:02:03Z"}'));
set constraints all immediate;set constraints all deferred;
select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
set local role authenticated;
-- line with item code, optional manual discount (nominal/percent) and promo_discount (a mechanism other than this promo)
create function pg_temp.li(ref text,code text,q numeric,price numeric,pos integer,disc numeric default 0,dtype text default 'nominal',pdisc numeric default 0,unit text default 'PCS',factor numeric default 1) returns uuid language plpgsql as $$
#variable_conflict use_variable
declare id uuid;begin
 insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,source_position,item_discount_type,item_discount_value,promo_discount)
 select s.id,i.id,i.name,q,price,unit,factor,0,pos,case when disc>0 then dtype end,disc,pdisc from sales s cross join items i where s.no_struk=ref and i.code=code returning sale_items.id into id;
 return id;
end$$;
-- the reward claim every nilai-only scenario carries (ANC Creamy 15000, -1000, exactly 1 set)
create function pg_temp.reward(ref text,pos integer default 0) returns uuid language sql as $$ select pg_temp.cl(ref,'ANC-CREAMY',1,15000,pos,pg_temp.pid('pnil'),1,0,1,1000) $$;

-- R1 attacks (the reviewer's exact vectors): every one MUST be refused with PROMO_SH_NILAI and roll back stock/snapshot
select pg_temp.sale('R1.A3',1+15000,1+14000);
select pg_temp.li('R1.A3','SVC600',1,1,1);select pg_temp.reward('R1.A3');
select pg_temp.refused('R1.A3','PROMO_SH_NILAI','R1 A3: Jasa (master 600000) at harga 1 counts 1, not 600000');
select pg_temp.sale('R1.A3b',600000+15000,14000);
select pg_temp.li('R1.A3b','SVC600',1,600000,1,600000);select pg_temp.reward('R1.A3b');
select pg_temp.refused('R1.A3b','PROMO_SH_NILAI','R1 A3b: Jasa at harga 600000 with a 600000 nominal manual discount counts 0');
select pg_temp.sale('R1.A3c',600000+15000,14000);
select pg_temp.li('R1.A3c','SVC600',1,600000,1,100,'percent');select pg_temp.reward('R1.A3c');
select pg_temp.refused('R1.A3c','PROMO_SH_NILAI','R1 A3c: Jasa with a 100% manual discount counts 0');
select pg_temp.sale('R1.A7d',15000,14000);
select pg_temp.li('R1.A7d','SVC600',1000000,0,1);select pg_temp.reward('R1.A7d');
select pg_temp.refused('R1.A7d','PROMO_SH_NILAI','R1 A7d: Jasa qty 1,000,000 at harga 0 counts 0');
-- defence in depth: an absurd quantity counts 0 even when it is genuinely "paid" (qty >= 1,000,000 on one line)
select pg_temp.sale('R1.A7e',600000::numeric*1000000+15000,600000::numeric*1000000+14000);
select pg_temp.li('R1.A7e','SVC600',1000000,600000,1);select pg_temp.reward('R1.A7e');
select pg_temp.refused('R1.A7e','PROMO_SH_NILAI','R1 A7e: a single line of 1,000,000 units counts 0 (quantity bound) even at the full price');
select pg_temp.sale('R1.A7f',999999+15000,999999+14000);
select pg_temp.li('R1.A7f','SVC600',999999,1,1);select pg_temp.reward('R1.A7f');
select pg_temp.ok((pg_temp.post('R1.A7f')->>'finalized')::boolean,'R1 A7f control: 999,999 units really charged Rp1 each (999,999) still count under the bound');
-- a Persediaan line bounded only by the HPP floor counts at what is paid, not at the master price (R3 of the review)
select pg_temp.sale('R1.A4c',350000+15000,350000+14000);
select pg_temp.li('R1.A4c','KOPI',7,50000,1);select pg_temp.reward('R1.A4c');
select pg_temp.refused('R1.A4c','PROMO_SH_NILAI','R1 A4c: KOPI x7 sold at HPP 50000 (master 80000) counts 350000, not 560000');
select pg_temp.sale('R1.A4d',500000+15000,500000+14000);
select pg_temp.li('R1.A4d','KOPI',10,50000,1);select pg_temp.reward('R1.A4d');
select pg_temp.ok((pg_temp.post('R1.A4d')->>'finalized')::boolean,'R1 A4d control: KOPI x10 really paid 50000 each = 500000 satisfies the syarat');
select pg_temp.sale('R1.A5b',400000+15000,400000+14000);
select pg_temp.li('R1.A5b','KOPI',5,80000,1);select pg_temp.reward('R1.A5b');
select pg_temp.refused('R1.A5b','PROMO_SH_NILAI','R1 A5b: KOPI x5 charged 80000 while the branch price is 100000 counts what is paid (400000)');
-- a non-claim promo_discount (another mechanism) reduces the counted value too
select pg_temp.sale('R1.PD1',560000+15000,560000-74000+14000);
select pg_temp.li('R1.PD1','KOPI',7,80000,1,0,'nominal',74000);select pg_temp.reward('R1.PD1');
select pg_temp.ok((pg_temp.post('R1.PD1')->>'finalized')::boolean,'R1 PD1 boundary (R5): KOPI x7 net 486000 (promo_discount 74000) + reward NET 14000 = exactly 500000 is accepted');
select pg_temp.sale('R1.PD2',560000+15000,560000-74001+14000);
select pg_temp.li('R1.PD2','KOPI',7,80000,1,0,'nominal',74001);select pg_temp.reward('R1.PD2');
select pg_temp.refused('R1.PD2','PROMO_SH_NILAI','R1 PD2 boundary (R5): one rupiah more promo_discount -> 499999 < 500000 refused');
-- nilai-only WAIVER promo (review X1): fake free Jasa line + 50 below-HPP reward units
select pg_temp.sale('R1.X1',750000,500000);
select pg_temp.li('R1.X1','SVC600',1000000,0,1);
select pg_temp.cl('R1.X1','EXP-REJECT',50,15000,0,pg_temp.pid('pnw'),50,0,50,250000,true);
select pg_temp.refused('R1.X1','PROMO_SH_NILAI','R1 X1: a fake Jasa qty 1e6 @ harga 0 cannot inflate the sets of a nilai-only waiver promo (50 below-HPP units refused)');
select pg_temp.sale('R1.X1b',750001,500001);
select pg_temp.li('R1.X1b','SVC600',1,1,1);
select pg_temp.cl('R1.X1b','EXP-REJECT',50,15000,0,pg_temp.pid('pnw'),50,0,50,250000,true);
select pg_temp.refused('R1.X1b','PROMO_SH_NILAI','R1 X1b: same with a Jasa line at harga 1');
-- legit carts must NOT be refused
select pg_temp.sale('R1.X1d',615000,610000);
select pg_temp.li('R1.X1d','SVC600',1,600000,1);
select pg_temp.cl('R1.X1d','EXP-REJECT',1,15000,0,pg_temp.pid('pnw'),1,0,1,5000,true);
select pg_temp.ok((pg_temp.post('R1.X1d')->>'finalized')::boolean,'R1 X1d control: a GENUINELY paid Jasa 600000 + one waiver reward unit below HPP is accepted (customer pays 610000)');
select pg_temp.ok((select net_paid from sale_line_pricing v join sales s on s.id=v.sale_id where s.no_struk='R1.X1d' and v.source_position=0)=10000,'R1 X1d: the waiver reward line is net 10000 (below HPP 17040), nothing stacked');
select pg_temp.sale('R1.OK1',600000+15000,600000+14000);
select pg_temp.li('R1.OK1','SVC600',1,600000,1);select pg_temp.reward('R1.OK1');
select pg_temp.ok((pg_temp.post('R1.OK1')->>'finalized')::boolean,'R1 OK1: a genuinely paid Jasa 600000 satisfies the syarat');
select pg_temp.sale('R1.OK2',600000+15000,486000+14000);
select pg_temp.li('R1.OK2','SVC600',1,600000,1,114000);select pg_temp.reward('R1.OK2');
select pg_temp.ok((pg_temp.post('R1.OK2')->>'finalized')::boolean,'R1 OK2 boundary (R5): Jasa 600000 with a genuine 114000 discount (486000) + reward NET 14000 = 500000 is accepted');
select pg_temp.sale('R1.NO2',600000+15000,485999+14000);
select pg_temp.li('R1.NO2','SVC600',1,600000,1,114001);select pg_temp.reward('R1.NO2');
select pg_temp.refused('R1.NO2','PROMO_SH_NILAI','R1 NO2 boundary (R5): discount 114001 -> 499999 refused (the documented refinement: discounted value counts)');
select pg_temp.sale('R1.OK3',600000+15000,540000+14000);
select pg_temp.li('R1.OK3','SVC600',1,600000,1,10,'percent');select pg_temp.reward('R1.OK3');
select pg_temp.ok((pg_temp.post('R1.OK3')->>'finalized')::boolean,'R1 OK3: Jasa with a genuine 10% discount (540000) is accepted');
select pg_temp.sale('R1.OK4',500000+15000,500000+14000);
select pg_temp.li('R1.OK4','KOPI',5,100000,1);select pg_temp.reward('R1.OK4');
select pg_temp.ok((pg_temp.post('R1.OK4')->>'finalized')::boolean,'R1 OK4: branch-price carts (KOPI x5 at the branch price 100000) are not falsely refused');
select pg_temp.sale('R1.OK5',500000+15000,500000+14000);
select pg_temp.li('R1.OK5','DRC8993374326970',1,500000,1,0,'nominal',0,'SAK',25);select pg_temp.reward('R1.OK5');
select pg_temp.ok((pg_temp.post('R1.OK5')->>'finalized')::boolean,'R1 OK5: a derived unit (1 SAK = 25 PCS at its own price 500000) counts at that price');
select pg_temp.sale('R1.NO5',20000+15000,20000+14000);
select pg_temp.li('R1.NO5','DRC8993374326970',1,20000,1,0,'nominal',0,'SAK',25);select pg_temp.reward('R1.NO5');
select pg_temp.refused('R1.NO5','PROMO_SH_NILAI|Konversi|HPP','R1 NO5: a derived unit sold at the base price still refused');
select pg_temp.sale('R1.OK6',560000+15000,504000+14000);
select pg_temp.li('R1.OK6','KOPI',7,80000,1,10,'percent');select pg_temp.reward('R1.OK6');
select pg_temp.ok((pg_temp.post('R1.OK6')->>'finalized')::boolean,'R1 OK6: a genuinely discounted stock line (KOPI x7 -10% = 504000) is accepted');
select pg_temp.sale('R1.OK7',700000+15000,700000+14000);
select pg_temp.li('R1.OK7','KOPI',7,100000,1);select pg_temp.reward('R1.OK7');
select pg_temp.ok((pg_temp.post('R1.OK7')->>'finalized')::boolean,'R1 OK7: an overcharged line (above the official price) is accepted and counts at the official price only');
select pg_temp.sale('R1.OV',800000+15000,800000+14000);
select pg_temp.li('R1.OV','KOPI',4,200000,1);select pg_temp.reward('R1.OV');
select pg_temp.refused('R1.OV','PROMO_SH_NILAI','R1 OV: KOPI x4 charged 200000 (above the branch price 100000) counts at the OFFICIAL price only (400000 + 15000 < 500000): lesser-of, an overcharge adds nothing');
-- a line whose unit is unknown to the master has no official price. The ORIGINAL trigger guard_pos_finalization_units already refuses it on every
-- finalization path (faktor must equal the master factor), so the coalesce(official,0) default in the nilai count is defence in depth only
-- (mutant s1_harga_fallback is therefore equivalent/unreachable natively).
select pg_temp.sale('R1.UN',600000+15000,600000+14000);
select pg_temp.li('R1.UN','SVC600',1,600000,1,0,'nominal',0,'XYZ');select pg_temp.reward('R1.UN');
select pg_temp.refused('R1.UN','Konversi satuan','R1 UN: an active Jasa line in a unit the master does not define is refused by the original unit guard before nilai is evaluated');
-- KNOWN RESIDUAL (by decision: nilai is measured BEFORE cart-level voucher/points/total discount): a receipt-level discount typed on the sale header
-- still counts the full line values. It is bounded by the existing P03 floor of the reward line (here ANC: HPP 10000 of net 14000 -> total >= ~71.5% of
-- the lines), so the sale below cannot go lower; flip this assertion if a later decision subtracts cart-level discounts too.
select pg_temp.sale('R1.TD1',615000,50000);
select pg_temp.li('R1.TD1','SVC600',1,600000,1);select pg_temp.reward('R1.TD1');
select pg_temp.refused('R1.TD1','Harga neto Persediaan di bawah HPP','R1 TD1: a receipt discount down to 50000 is stopped by the reward line HPP floor (not by nilai)');
select pg_temp.sale('R1.TD2',615000,440000);
select pg_temp.li('R1.TD2','SVC600',1,600000,1);select pg_temp.reward('R1.TD2');
select pg_temp.ok((pg_temp.post('R1.TD2')->>'finalized')::boolean,'R1 TD2 KNOWN RESIDUAL: a receipt-level discount to 440000 (HPP floor allows it) still counts the 600000 Jasa line (customer pays 440000 < 500000)');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref like 'R1.A3%' or source_ref like 'R1.A7d%' or source_ref like 'R1.X1' or source_ref='R1.X1b'),'R1: no stock leaked by any refused attack');

-- ============================================================ 9. stage-3: R5 (a reward unit never qualifies its own nilai syarat) and H2 (finite guard)
-- Rule: a claim line is not special; its verified reward discount is subtracted like any other discount, so the nilai syarat means the money
-- actually charged for the whole cart (reward units count at their NET).
reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);
select pg_temp.mk('r5a',pg_temp.rule_of('[{"kind":"nilai","min":14500}]'::jsonb,pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}')));
select pg_temp.mk('r5a0',pg_temp.rule_of('[{"kind":"nilai","min":14000}]'::jsonb,pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}')));
select pg_temp.mk('r5b',pg_temp.rule_of('[{"kind":"nilai","min":74000}]'::jsonb,pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}',5)));
select pg_temp.mk('r5b0',pg_temp.rule_of('[{"kind":"nilai","min":70000}]'::jsonb,pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}',5)));
-- reward item ALSO a syarat unit: 2 ANC syarat + nilai
select pg_temp.mk('r5d',pg_temp.rule_of('[{"kind":"qty","min":2,"items":[{"item_id":"e5500000-0000-4000-8000-000000000008","unit":"PCS"}]},{"kind":"nilai","min":44000}]'::jsonb,pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}')));
select pg_temp.mk('r5e',pg_temp.rule_of('[{"kind":"qty","min":2,"items":[{"item_id":"e5500000-0000-4000-8000-000000000008","unit":"PCS"}]},{"kind":"nilai","min":44001}]'::jsonb,pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}')));
set constraints all immediate;set constraints all deferred;
select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
set local role authenticated;
-- R5a (review): reward-only cart: the customer pays 14000, the threshold is 14500 -> must be refused (old code counted 15000)
select pg_temp.sale('R5.A',15000,14000);
select pg_temp.cl('R5.A','ANC-CREAMY',1,15000,0,pg_temp.pid('r5a'),1,0,1,1000);
select pg_temp.refused('R5.A','PROMO_SH_NILAI','R5a: a cart of ONLY one reward unit (paid 14000) cannot satisfy a nilai syarat of 14500 (the reward discount is not added back)');
select pg_temp.sale('R5.A0',15000,14000);
select pg_temp.cl('R5.A0','ANC-CREAMY',1,15000,0,pg_temp.pid('r5a0'),1,0,1,1000);
select pg_temp.ok((pg_temp.post('R5.A0')->>'finalized')::boolean,'R5a control: nilai syarat 14000 == the money actually charged is accepted (boundary exact)');
-- R5b (review): 5 reward units, nilai 74000 vs real spend 70000
select pg_temp.sale('R5.B',75000,70000);
select pg_temp.cl('R5.B','ANC-CREAMY',5,15000,0,pg_temp.pid('r5b'),1,0,5,5000);
select pg_temp.refused('R5.B','PROMO_SH_NILAI','R5b: 5 reward units paid 70000 cannot satisfy a nilai syarat of 74000 (old code counted 75000)');
select pg_temp.sale('R5.B0',75000,70000);
select pg_temp.cl('R5.B0','ANC-CREAMY',5,15000,0,pg_temp.pid('r5b0'),1,0,5,5000);
select pg_temp.ok((pg_temp.post('R5.B0')->>'finalized')::boolean,'R5b control: nilai syarat 70000 == real spend is accepted');
-- legitimate: the reward item is ALSO a syarat line of the same promo (one claimed line: 2 syarat units + 1 reward unit)
select pg_temp.sale('R5.D',45000,44000);
select pg_temp.cl('R5.D','ANC-CREAMY',3,15000,0,pg_temp.pid('r5d'),1,2,1,1000);
select pg_temp.ok((pg_temp.post('R5.D')->>'finalized')::boolean,'R5d: reward item that is also a syarat line (3 ANC: 2 syarat + 1 reward, paid 44000, nilai 44000) is NOT falsely refused');
select pg_temp.sale('R5.E',45000,44000);
select pg_temp.cl('R5.E','ANC-CREAMY',3,15000,0,pg_temp.pid('r5e'),1,2,1,1000);
select pg_temp.refused('R5.E','PROMO_SH_NILAI','R5e: same cart against nilai 44001 is refused (44000 charged)');
-- the reward line of ANOTHER promo also reduces the money counted (every claim line is honest about what it charges)
select pg_temp.sale('R5.F',600000+15000,600000+14000);
select pg_temp.li('R5.F','SVC600',1,600000,1);select pg_temp.cl('R5.F','ANC-CREAMY',1,15000,0,pg_temp.pid('pnil'),1,0,1,1000);
select pg_temp.ok((pg_temp.post('R5.F')->>'finalized')::boolean,'R5f: Jasa 600000 + reward (nilai 500000) still posts');

-- H2: non-finite harga / qty cannot count at the full official value. NaN/Infinity harga is refused earlier by cashier_post_stock_atomic /
-- finalize_pos_sale, so the nilai expression is probed DIRECTLY (as the database owner, after the original FIFO writer issued the stock).
reset role;
create function pg_temp.fifo_claims(ref text) returns void language plpgsql as $$
declare l record;cost numeric;s public.sales%rowtype;begin
 select * into s from public.sales where no_struk=ref;
 for l in select i.* from public.sale_items i where i.sale_id=s.id and i.promo_claim_id is not null order by i.id loop
  select x.cost into strict cost from public.sale_stock_out_fifo('e3300000-0000-4000-8000-000000000001',l.item_id,l.qty*l.faktor,'sale',s.no_struk,(s.created_at at time zone 'Asia/Jakarta')::date,l.id) x;
  update public.sale_items set hpp=cost where id=l.id;
 end loop;
end$$;
create function pg_temp.verify_ok(ref text) returns boolean language plpgsql as $$
begin perform public.promo_sh_verify_claims((select id from public.sales where no_struk=ref));return true;end$$;
select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
select pg_temp.sale('H2.CTRL',600000+15000,600000+14000);
select pg_temp.li('H2.CTRL','SVC600',1,600000,1);select pg_temp.reward('H2.CTRL');select pg_temp.fifo_claims('H2.CTRL');
select pg_temp.ok(pg_temp.verify_ok('H2.CTRL'),'H2 control: a finite Jasa 600000 + reward passes the claim verification when called directly');
select pg_temp.sale('H2.NAN',600000+15000,600000+14000);
select pg_temp.li('H2.NAN','SVC600',1,'NaN'::numeric,1);select pg_temp.reward('H2.NAN');select pg_temp.fifo_claims('H2.NAN');
select pg_temp.must_reject($q$select pg_temp.verify_ok('H2.NAN')$q$,'PROMO_SH_NILAI','H2: a NaN harga line counts 0 (old expression counted the official 600000)');
select pg_temp.sale('H2.INF',600000+15000,600000+14000);
select pg_temp.li('H2.INF','SVC600',1,'Infinity'::numeric,1);select pg_temp.reward('H2.INF');select pg_temp.fifo_claims('H2.INF');
select pg_temp.must_reject($q$select pg_temp.verify_ok('H2.INF')$q$,'PROMO_SH_NILAI','H2: an Infinity harga line counts 0');
select pg_temp.sale('H2.QNAN',600000+15000,600000+14000);
select pg_temp.li('H2.QNAN','SVC600','NaN'::numeric,600000,1);select pg_temp.reward('H2.QNAN');select pg_temp.fifo_claims('H2.QNAN');
select pg_temp.must_reject($q$select pg_temp.verify_ok('H2.QNAN')$q$,'PROMO_SH_NILAI','H2: a NaN qty line counts 0');
select pg_temp.sale('H2.NINF',600000+15000,600000+14000);
select pg_temp.li('H2.NINF','SVC600',1,'-Infinity'::numeric,1);select pg_temp.reward('H2.NINF');select pg_temp.fifo_claims('H2.NINF');
select pg_temp.must_reject($q$select pg_temp.verify_ok('H2.NINF')$q$,'PROMO_SH_NILAI','H2: a -Infinity harga line counts 0 (never a huge value)');
