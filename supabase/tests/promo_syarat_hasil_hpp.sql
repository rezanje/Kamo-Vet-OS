-- Stage 2c: below-HPP waiver in the original cashier floor (P03). EXP-REJECT: normal 20000, actual FIFO HPP 17040.
-- A Bolt x2 syarat + EXP x1 reward with -5000 puts the reward at 15000 (< HPP 17040): allowed ONLY on a line that carries the
-- Owner-granted promo waiver, net stays > 0, and no voucher/points/total discount may push that line lower.
update promo_release_flags set enabled=true;
select pg_temp.mk('pw',pg_temp.rule_of(pg_temp.bolt_syarat(),pg_temp.hasil_of('EXP-REJECT','{"type":"nominal","value":5000}'),true,
 '{"allowed":true,"reason":"barang mendekati expired","ack_by":"e1100000-0000-4000-8000-000000000003","ack_at":"2026-11-04T01:02:03Z"}'));
select pg_temp.mk('p1',pg_temp.rule_of(pg_temp.bolt_syarat(),pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}')));
select pg_temp.mk('pn',pg_temp.rule_of(pg_temp.bolt_syarat(),pg_temp.hasil_of('EXP-REJECT','{"type":"nominal","value":5000}')));
select pg_temp.mk('pw2',pg_temp.rule_of(pg_temp.bolt_syarat(),pg_temp.hasil_of('EXP-REJECT','{"type":"nominal","value":2000}'),true,
 '{"allowed":true,"reason":"barang mendekati expired","ack_by":"e1100000-0000-4000-8000-000000000003","ack_at":"2026-11-04T01:02:03Z"}'));
set constraints all immediate;set constraints all deferred;
select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
set local role authenticated;
create function pg_temp.floor_sale(ref text,promo uuid,discount numeric,waiver boolean,total numeric default null) returns void language plpgsql as $$
declare gross numeric:=60000;begin
 perform pg_temp.sale(ref,gross,coalesce(total,gross-discount));
 perform pg_temp.cl(ref,'DRC8993374326970',2,20000,0,promo,1,2,0,0);
 perform pg_temp.cl(ref,'EXP-REJECT',1,20000,1,promo,1,0,1,discount,waiver);
end$$;

-- 1. today's behaviour is untouched: no waiver -> below HPP is refused by the original floor
select pg_temp.floor_sale('HPP.NOWAIVE',pg_temp.pid('pn'),5000,false);
select pg_temp.must_reject($q$select pg_temp.post('HPP.NOWAIVE')$q$,'di bawah HPP FIFO','promo discount below HPP WITHOUT a waiver is refused (original P03 floor)');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='HPP.NOWAIVE'),'refusal rolled back the stock issue');
-- the promo may carry the Owner waiver, but only the line flagged with it may go below HPP
select pg_temp.floor_sale('HPP.UNFLAGGED',pg_temp.pid('pw'),5000,false);
select pg_temp.must_reject($q$select pg_temp.post('HPP.UNFLAGGED')$q$,'di bawah HPP FIFO','waiver promo, but the line is not flagged: still refused');
-- 2. flagged line: allowed, net stays 15000 > 0
select pg_temp.floor_sale('HPP.WAIVE',pg_temp.pid('pw'),5000,true);
select pg_temp.ok((pg_temp.post('HPP.WAIVE')->>'finalized')::boolean,'Owner-waiver line may sell at 15000 < HPP 17040');
select pg_temp.ok((select (pg_temp.snap('HPP.WAIVE',1)->>'net_paid')::numeric=15000 and (pg_temp.snap('HPP.WAIVE',1)->>'waiver')::boolean
  and (select hpp from sale_items where sale_id=(select id from sales where no_struk='HPP.WAIVE') and source_position=1)=17040),'snapshot: net 15000, waiver=true, real FIFO HPP 17040 recorded');
-- 3. no stacking with voucher/points/total discount on a waiver line
select pg_temp.floor_sale('HPP.STACK',pg_temp.pid('pw'),5000,true,54000);
select pg_temp.must_reject($q$select pg_temp.post('HPP.STACK')$q$,'di bawah HPP FIFO','a total/voucher discount on top of a below-HPP waiver line is refused');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='HPP.STACK'),'stacking refusal rolled back stock');
-- 4. promo alone at/above HPP: floor stays HPP (stacking allowed only down to HPP)
select pg_temp.floor_sale('HPP.ABOVE.OK',pg_temp.pid('pw2'),2000,true,57000);
select pg_temp.ok((pg_temp.post('HPP.ABOVE.OK')->>'finalized')::boolean,'promo alone 18000 >= HPP: a small total discount (net 17.4k >= 17040) still passes on a waiver line');
select pg_temp.floor_sale('HPP.ABOVE.BAD',pg_temp.pid('pw2'),2000,true,52000);
select pg_temp.must_reject($q$select pg_temp.post('HPP.ABOVE.BAD')$q$,'di bawah HPP FIFO','when the promo alone is above HPP the floor stays HPP: a deeper total discount is refused');
-- 5. waiver needs both release flags at finalization
reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);
update promo_release_flags set enabled=false where flag='below_hpp';
set local role authenticated;select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
select pg_temp.floor_sale('HPP.FLAGOFF',pg_temp.pid('pw'),5000,true);
select pg_temp.must_reject($q$select pg_temp.post('HPP.FLAGOFF')$q$,'PROMO_SH_WAIVER','below_hpp release flag OFF: waiver line refused at finalization');
reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);
update promo_release_flags set enabled=true where flag='below_hpp';
-- Owner revokes the waiver (deactivate -> edit -> activate) after the quote: refused, never honoured from the stale line
update promos set is_active=false where id=pg_temp.pid('pw');
update promos set rule=jsonb_set(rule,'{syarat_hasil,below_hpp}','{"allowed":false}') where id=pg_temp.pid('pw');
update promos set is_active=true where id=pg_temp.pid('pw');
set local role authenticated;select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
select pg_temp.must_reject($q$select pg_temp.post('HPP.FLAGOFF')$q$,'PROMO_SH_WAIVER|di bawah HPP','waiver revoked after the quote: the stale waiver line is refused');
-- 6. the waiver cannot launder a free item or a non-formula discount
select pg_temp.floor_sale('HPP.FREE',pg_temp.pid('pw2'),20000,true);
select pg_temp.must_reject($q$select pg_temp.post('HPP.FREE')$q$,'PROMO_SH_TOTAL|Harga neto','waiver line cannot be sold free (discount 20000 = price): refused');
select pg_temp.floor_sale('HPP.EXTRA',pg_temp.pid('pw2'),5000,true);
select pg_temp.must_reject($q$select pg_temp.post('HPP.EXTRA')$q$,'PROMO_SH_TOTAL','waiver line discount larger than the promo formula (5000 vs 2000) refused');

-- 7. backoffice atomic composition: same DB verification, a refused finalization rolls the stock issue back
select pg_temp.sale('HPP.BO',55000,54000);
select pg_temp.cl('HPP.BO','DRC8993374326970',2,20000,0,pg_temp.pid('p1'),1,2,0,0);
select pg_temp.cl('HPP.BO','ANC-CREAMY',1,15000,1,pg_temp.pid('p1'),1,0,1,1000);
select pg_temp.ok((pos_post_promo_atomic((select id from sales where no_struk='HPP.BO'),'e3300000-0000-4000-8000-000000000001')->>'finalized')::boolean,'pos_post_promo_atomic issues stock and finalizes a valid claim sale');
select pg_temp.ok((select count(*)=2 and sum(net_paid)=54000 from sale_line_pricing where sale_id=(select id from sales where no_struk='HPP.BO')),'backoffice sale: complete snapshot written');
select pg_temp.sale('HPP.BO2',55000,54000);
select pg_temp.cl('HPP.BO2','DRC8993374326970',2,20000,0,pg_temp.pid('p1'),1,2,0,0);
select pg_temp.cl('HPP.BO2','ANC-CREAMY',1,15000,1,pg_temp.pid('p1'),1,0,1,1000);
reset role;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','',true);
update promos set is_active=false where id=pg_temp.pid('p1');
set local role authenticated;select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
select pg_temp.must_reject($q$select pos_post_promo_atomic((select id from sales where no_struk='HPP.BO2'),'e3300000-0000-4000-8000-000000000001')$q$,'PROMO_SH_ELIGIBILITY','stale claim (promo deactivated): atomic backoffice post refused');
select pg_temp.ok((select count(*)=0 from stock_moves where source_ref='HPP.BO2'),'refused backoffice post left no stock issue (atomic)');
select pg_temp.sale('HPP.BO3',20000,20000);
select pg_temp.pl('HPP.BO3','KOPI',1,80000,0);
select pg_temp.must_reject($q$select pos_post_promo_atomic((select id from sales where no_struk='HPP.BO3'),'e3300000-0000-4000-8000-000000000001')$q$,'PROMO_SH_POST|Harga neto|tidak konsisten','atomic function refuses a receipt without syarat_hasil claims');
select pg_temp.ok(not has_function_privilege('anon','public.pos_post_promo_atomic(uuid,uuid)','execute'),'ACL: anon cannot execute pos_post_promo_atomic');
