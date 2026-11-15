-- The `nilai` (spend) syarat is ONE shared pool of money per receipt (migration 20261111150000_promo_syarat_nilai_bersama.sql).
-- Prepended by scripts/test-promo-nilai-bersama-postgres.py: fixture + helpers of the promo_syarat_hasil_* suites, all inside one
-- transaction that is rolled back. Every sale goes through the ORIGINAL public RPC (cashier_post_stock_atomic -> finalize_pos_sale) as a STAFF cashier.
-- Fictional data: ANC 15000 (hpp 10000), EXP 20000 (hpp 17040), BOLT3 20000 (hpp 17040), KOPI 80000 (hpp 50000), Bolt Ikan/Donat 20000.
update promo_release_flags set enabled=true;
create function pg_temp.refused(ref text,pattern text,label text) returns text language plpgsql as $$
declare r text;begin
 r:=pg_temp.must_reject(format('select pg_temp.post(%L)',ref),pattern,label);
 if exists(select 1 from stock_moves where source_ref=ref) then raise exception 'stock leaked for %',ref;end if;
 if exists(select 1 from sale_line_pricing where sale_id=(select id from sales where no_struk=ref)) then raise exception 'snapshot leaked for %',ref;end if;
 return r;
end$$;
create function pg_temp.accepted(ref text,label text) returns text language sql as $$
 select pg_temp.ok((pg_temp.post(ref)->>'finalized')::boolean,label)
$$;
-- "Belanja minimal Rp100.000 -> potongan X per PCS <item>, berlaku kelipatan" masters (PayDay style, one reward item each)
select pg_temp.mk('A',pg_temp.rule_of('[{"kind":"nilai","min":100000}]'::jsonb,pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}')));
select pg_temp.mk('B',pg_temp.rule_of('[{"kind":"nilai","min":100000}]'::jsonb,pg_temp.hasil_of('EXP-REJECT','{"type":"nominal","value":2000}')));
select pg_temp.mk('D',pg_temp.rule_of('[{"kind":"nilai","min":100000}]'::jsonb,pg_temp.hasil_of('KOPI','{"type":"nominal","value":10000}')));
select pg_temp.mk('BA',pg_temp.rule_of('[{"kind":"nilai","min":100000}]'::jsonb,pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":5000}')));
select pg_temp.mk('BD',pg_temp.rule_of('[{"kind":"nilai","min":100000}]'::jsonb,pg_temp.hasil_of('KOPI','{"type":"nominal","value":10000}')));
select pg_temp.mk('BD1',pg_temp.rule_of('[{"kind":"nilai","min":100000}]'::jsonb,pg_temp.hasil_of('KOPI','{"type":"nominal","value":10001}')));
select pg_temp.mk('A5',pg_temp.rule_of('[{"kind":"nilai","min":50000}]'::jsonb,pg_temp.hasil_of('DRC8993374326994','{"type":"nominal","value":1500}')));
select pg_temp.mk('TWO',pg_temp.rule_of('[{"kind":"nilai","min":100000},{"kind":"nilai","min":200000}]'::jsonb,pg_temp.hasil_of('EXP-REJECT','{"type":"nominal","value":2000}')));
select pg_temp.mk('Q2',pg_temp.rule_of(pg_temp.bolt_syarat(),pg_temp.hasil_of('EXP-REJECT','{"type":"nominal","value":2000}')));
select pg_temp.mk('A2',pg_temp.rule_of('[{"kind":"nilai","min":100000}]'::jsonb,pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}')));
select pg_temp.mk('NOREP',pg_temp.rule_of('[{"kind":"nilai","min":100000}]'::jsonb,pg_temp.hasil_of('ANC-CREAMY','{"type":"nominal","value":1000}'),false));
set constraints all immediate;set constraints all deferred;
select pg_temp.ok((select count(*)=11 and bool_and(is_active) from promos where rule->>'discount_mode'='syarat_hasil'),'eleven fictional nilai/qty syarat_hasil masters active');
select pg_temp.set_user('e1100000-0000-4000-8000-000000000001');
set local role authenticated;

-- ============================================================ 1. THE REPORTED BUG: two promos, each "Belanja min Rp100.000", on ONE Rp115.000 receipt
-- KOPI 80000 + ANC 15000 (reward A -1000) + EXP 20000 (reward B -2000): each promo alone is satisfied (cart 112000 >= 100000), together they need 200000.
select pg_temp.sale('NB.STACK',115000,112000);
select pg_temp.pl('NB.STACK','KOPI',1,80000,0);
select pg_temp.cl('NB.STACK','ANC-CREAMY',1,15000,1,pg_temp.pid('A'),1,0,1,1000);
select pg_temp.cl('NB.STACK','EXP-REJECT',1,20000,2,pg_temp.pid('B'),1,0,1,2000);
select pg_temp.refused('NB.STACK','PROMO_SH_NILAI.*combined need','1. two Rp100.000 promos on Rp115.000 (cart 112000 < 2 x 100000): the second reward is refused, the sale rolls back');
-- control: the SAME cart with ONE reward finalizes (a threshold still buys one reward set)
select pg_temp.sale('NB.ONE',115000,114000);
select pg_temp.pl('NB.ONE','KOPI',1,80000,0);
select pg_temp.cl('NB.ONE','ANC-CREAMY',1,15000,1,pg_temp.pid('A'),1,0,1,1000);
select pg_temp.pl('NB.ONE','EXP-REJECT',1,20000,2);
select pg_temp.accepted('NB.ONE','1b. control: ONE reward on the same Rp115.000 cart finalizes');
-- three stacked claims (modified client) on a Rp155.000-style cart
select pg_temp.sale('NB.STACK3',195000,182000);
select pg_temp.pl('NB.STACK3','KOPI',1,80000,0);
select pg_temp.cl('NB.STACK3','KOPI',1,80000,1,pg_temp.pid('D'),1,0,1,10000);
select pg_temp.cl('NB.STACK3','ANC-CREAMY',1,15000,2,pg_temp.pid('A'),1,0,1,1000);
select pg_temp.cl('NB.STACK3','EXP-REJECT',1,20000,3,pg_temp.pid('B'),1,0,1,2000);
select pg_temp.refused('NB.STACK3','PROMO_SH_NILAI.*combined need','1c. three stacked rewards on a Rp195.000 cart (paid 182000, needs 300000) refused');

-- ============================================================ 2. TWO sets need Rp200.000 of REAL (paid) money: exact boundary
-- KOPI x2 160000 + ANC 15000 + EXP 20000 + BOLT3 20000 = 215000; rewards BA (ANC -5000, ANC net 10000 = hpp) + BD (KOPI -10000) = 15000 -> paid 200000
select pg_temp.sale('NB.B200',215000,200000);
select pg_temp.pl('NB.B200','KOPI',1,80000,0);
select pg_temp.cl('NB.B200','KOPI',1,80000,1,pg_temp.pid('BD'),1,0,1,10000);
select pg_temp.cl('NB.B200','ANC-CREAMY',1,15000,2,pg_temp.pid('BA'),1,0,1,5000);
select pg_temp.pl('NB.B200','EXP-REJECT',1,20000,3);
select pg_temp.pl('NB.B200','DRC8993374326994',1,20000,4);
select pg_temp.accepted('NB.B200','2a. two promos, paid money exactly 200000 = 2 x 100000: both rewards finalize');
select pg_temp.sale('NB.B199',215000,199999);
select pg_temp.pl('NB.B199','KOPI',1,80000,0);
select pg_temp.cl('NB.B199','KOPI',1,80000,1,pg_temp.pid('BD1'),1,0,1,10001);
select pg_temp.cl('NB.B199','ANC-CREAMY',1,15000,2,pg_temp.pid('BA'),1,0,1,5000);
select pg_temp.pl('NB.B199','EXP-REJECT',1,20000,3);
select pg_temp.pl('NB.B199','DRC8993374326994',1,20000,4);
select pg_temp.refused('NB.B199','PROMO_SH_NILAI.*combined need','2b. one rupiah less (paid 199999 < 200000): refused');

-- ============================================================ 3. kelipatan (sets) shares the pool as well
-- promo A with 2 sets + promo B with 1 set need 300000
select pg_temp.sale('NB.SETS.OK',370000,366000);
select pg_temp.pl('NB.SETS.OK','KOPI',4,80000,0);
select pg_temp.cl('NB.SETS.OK','ANC-CREAMY',2,15000,1,pg_temp.pid('A2'),2,0,2,2000);
select pg_temp.cl('NB.SETS.OK','EXP-REJECT',1,20000,2,pg_temp.pid('B'),1,0,1,2000);
select pg_temp.accepted('NB.SETS.OK','3a. 2 sets of A + 1 set of B on 370000 (paid 366000 >= 300000) finalize');
select pg_temp.sale('NB.SETS.LOW',290000,286000);
select pg_temp.pl('NB.SETS.LOW','KOPI',3,80000,0);
select pg_temp.cl('NB.SETS.LOW','ANC-CREAMY',2,15000,1,pg_temp.pid('A2'),2,0,2,2000);
select pg_temp.cl('NB.SETS.LOW','EXP-REJECT',1,20000,2,pg_temp.pid('B'),1,0,1,2000);
select pg_temp.refused('NB.SETS.LOW','PROMO_SH_NILAI.*combined need','3b. the same claims on 290000 (paid 286000 < 300000): refused although each promo alone fits');
-- one promo, 2 sets, enough money for two sets only (control: unchanged per-promo rule)
select pg_temp.sale('NB.SETS.ONE',270000,268000);
select pg_temp.pl('NB.SETS.ONE','KOPI',3,80000,0);
select pg_temp.cl('NB.SETS.ONE','ANC-CREAMY',2,15000,1,pg_temp.pid('A2'),2,0,2,2000);
select pg_temp.accepted('NB.SETS.ONE','3c. one promo, 2 sets, paid 268000 >= 200000 finalizes (control)');
select pg_temp.sale('NB.SETS.TWOLOW',190000,188000);
select pg_temp.pl('NB.SETS.TWOLOW','KOPI',2,80000,0);
select pg_temp.cl('NB.SETS.TWOLOW','ANC-CREAMY',2,15000,1,pg_temp.pid('A2'),2,0,2,2000);
select pg_temp.refused('NB.SETS.TWOLOW','PROMO_SH_NILAI','3d. one promo, 2 sets on 188000 paid: refused (per-promo rule kept)');

-- ============================================================ 4. different thresholds: Rp100.000 + Rp50.000 need Rp150.000 together
select pg_temp.sale('NB.MIX.OK',155000,152500);
select pg_temp.pl('NB.MIX.OK','KOPI',1,80000,0);
select pg_temp.cl('NB.MIX.OK','ANC-CREAMY',1,15000,1,pg_temp.pid('A'),1,0,1,1000);
select pg_temp.cl('NB.MIX.OK','DRC8993374326994',1,20000,2,pg_temp.pid('A5'),1,0,1,1500);
select pg_temp.pl('NB.MIX.OK','EXP-REJECT',2,20000,3);
select pg_temp.accepted('NB.MIX.OK','4a. 100000 + 50000 promos on 155000 (paid 152500 >= 150000) finalize');
select pg_temp.sale('NB.MIX.LOW',135000,132500);
select pg_temp.pl('NB.MIX.LOW','KOPI',1,80000,0);
select pg_temp.cl('NB.MIX.LOW','ANC-CREAMY',1,15000,1,pg_temp.pid('A'),1,0,1,1000);
select pg_temp.cl('NB.MIX.LOW','DRC8993374326994',1,20000,2,pg_temp.pid('A5'),1,0,1,1500);
select pg_temp.pl('NB.MIX.LOW','EXP-REJECT',1,20000,3);
select pg_temp.refused('NB.MIX.LOW','PROMO_SH_NILAI.*combined need','4b. the same promos on 135000 (paid 132500 < 150000): refused (each fits alone)');

-- ============================================================ 5. a promo with TWO nilai rows consumes its LARGEST row per set
select pg_temp.sale('NB.TWO.ALONE',260000,248000);
select pg_temp.pl('NB.TWO.ALONE','KOPI',2,80000,0);
select pg_temp.cl('NB.TWO.ALONE','KOPI',1,80000,1,pg_temp.pid('D'),1,0,1,10000);
select pg_temp.cl('NB.TWO.ALONE','EXP-REJECT',1,20000,2,pg_temp.pid('TWO'),1,0,1,2000);
select pg_temp.refused('NB.TWO.ALONE','PROMO_SH_NILAI.*combined need','5a. TWO(100k+200k rows)=200000 + D=100000 need 300000 but only 248000 is paid: refused');
select pg_temp.sale('NB.TWO.OK',260000,258000);
select pg_temp.pl('NB.TWO.OK','KOPI',3,80000,0);
select pg_temp.cl('NB.TWO.OK','EXP-REJECT',1,20000,1,pg_temp.pid('TWO'),1,0,1,2000);
select pg_temp.accepted('NB.TWO.OK','5b. control: the two-row promo alone needs 200000 and has 258000 paid: finalizes');
select pg_temp.sale('NB.TWO.LOW',195000,193000);
select pg_temp.pl('NB.TWO.LOW','KOPI',2,80000,0);
select pg_temp.pl('NB.TWO.LOW','ANC-CREAMY',1,15000,1);
select pg_temp.cl('NB.TWO.LOW','EXP-REJECT',1,20000,2,pg_temp.pid('TWO'),1,0,1,2000);
select pg_temp.refused('NB.TWO.LOW','PROMO_SH_NILAI','5c. the two-row promo alone on 193000 paid: refused (200000 row, existing rule)');

-- ============================================================ 6. qty-only promos consume NO spend
select pg_temp.sale('NB.QTY',155000,152000);
select pg_temp.pl('NB.QTY','KOPI',1,80000,0);
select pg_temp.cl('NB.QTY','DRC8993374326970',2,20000,1,pg_temp.pid('Q2'),1,2,0,0);
select pg_temp.cl('NB.QTY','EXP-REJECT',1,20000,2,pg_temp.pid('Q2'),1,0,1,2000);
select pg_temp.cl('NB.QTY','ANC-CREAMY',1,15000,3,pg_temp.pid('A'),1,0,1,1000);
select pg_temp.accepted('NB.QTY','6a. a qty promo (Bolt x2 -> EXP -2000) and ONE nilai promo on 155000 both finalize: qty rows consume no spend');
select pg_temp.sale('NB.QTY.STACK',155000,142000);
select pg_temp.cl('NB.QTY.STACK','DRC8993374326970',2,20000,0,pg_temp.pid('Q2'),1,2,0,0);
select pg_temp.cl('NB.QTY.STACK','EXP-REJECT',1,20000,1,pg_temp.pid('Q2'),1,0,1,2000);
select pg_temp.cl('NB.QTY.STACK','ANC-CREAMY',1,15000,2,pg_temp.pid('A'),1,0,1,1000);
select pg_temp.cl('NB.QTY.STACK','KOPI',1,80000,3,pg_temp.pid('D'),1,0,1,10000);
select pg_temp.refused('NB.QTY.STACK','PROMO_SH_NILAI.*combined need','6b. but two nilai promos (A + D, need 200000) on 142000 paid still share the pool next to a qty promo');

-- ============================================================ 7. no repeat: the sets rule is untouched, a non-repeat promo still consumes ONE threshold
select pg_temp.sale('NB.NOREP',155000,154000);
select pg_temp.pl('NB.NOREP','KOPI',1,80000,0);
select pg_temp.cl('NB.NOREP','ANC-CREAMY',1,15000,1,pg_temp.pid('NOREP'),1,0,1,1000);
select pg_temp.pl('NB.NOREP','EXP-REJECT',3,20000,2);
select pg_temp.accepted('NB.NOREP','7a. a non-repeat nilai promo finalizes on one threshold');
select pg_temp.sale('NB.NOREP2',115000,112000);
select pg_temp.pl('NB.NOREP2','KOPI',1,80000,0);
select pg_temp.cl('NB.NOREP2','ANC-CREAMY',1,15000,1,pg_temp.pid('NOREP'),1,0,1,1000);
select pg_temp.cl('NB.NOREP2','EXP-REJECT',1,20000,2,pg_temp.pid('B'),1,0,1,2000);
select pg_temp.refused('NB.NOREP2','PROMO_SH_NILAI.*combined need','7b. non-repeat + another nilai promo on 112000 paid: refused');

select pg_temp.ok((select count(*)>=14 from sales where no_struk like 'NB.%'),'suite complete: every scenario sale was created');
