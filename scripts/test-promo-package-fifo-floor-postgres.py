#!/usr/bin/env python3
"""C04 package-total promos against the live cashier FIFO price floor, plus post-activation containment.

Owned disposable PostgreSQL, every repository migration, fictional data only:
1. Package promos are stored in the database; the app's own engine (scripts/promo-package-quote.mjs) prices
   carts from those rows; the sale lines carry that promo_discount into cashier_post_stock_atomic, which applies
   the FIFO floor (20261025060000). Above/equal floor posts; below floor and zero net are rejected with nothing
   issued. No pricing policy, exemption or mixed-SKU behaviour is added.
2. Containment (06) freezes active package promos only; a manager's later edit survives; posted sales, stock and
   journals are byte-identical; thaw (07) stops on drift and re-activates only unchanged promos; both stop when
   the installed C04 objects differ from the tested build.
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / 'docs/evidence/2026-10-27-c04-package-activation/owner-apply'
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(fixture)


def uid(group, n):
    return f'0c4{group:02x}000-0000-4000-8000-{n:012d}'


CASHIER, OWNER = uid(0, 1), uid(0, 2)
BRANCH, WAREHOUSE, SHIFT, CASH = uid(1, 1), uid(2, 1), uid(3, 1), uid(7, 1)
ITEM = {k: uid(5, i) for i, k in enumerate('ABCDE', 1)}
PROMO = {k: uid(6, i) for i, k in enumerate('ABCDE', 1)}
# Package amount per complete group of 5 at price 20 and FIFO cost 10 (gross 100, FIFO 50 per package).
PACKAGE = {'A': 30, 'B': 50, 'C': 60, 'D': 100}
CARTS = [('C04.A', 'A', 5), ('C04.A.CAP', 'A', 10), ('C04.B', 'B', 5), ('C04.C', 'C', 5), ('C04.D', 'D', 5), ('C04.L', 'E', 5)]
EXPECT = {  # ref: (promo_discount, net, posts, rejection text)
    'C04.A': (30, 70, True, None), 'C04.A.CAP': (30, 170, True, None), 'C04.B': (50, 50, True, None),
    'C04.C': (60, 40, False, 'di bawah HPP FIFO'), 'C04.D': (100, 0, False, 'Harga neto Persediaan nol'),
    'C04.L': (10, 90, True, None),
}
CLAIMS = lambda user: f"""select set_config('request.jwt.claim.sub','{user}',true);
select set_config('request.jwt.claims','{{"role":"authenticated","sub":"{user}"}}',true);
"""
LEDGER = ['sales', 'sale_items', 'sale_payments', 'stock_moves', 'stock_layers', 'journal_entries', 'journal_lines']
FINGERPRINT = ' union all '.join(
    f"select '{t}', count(*)::text, coalesce(md5(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text)), '') from public.{t} x"
    for t in LEDGER)

FIXTURES = f"""begin;
insert into auth.users(id,raw_user_meta_data) values('{CASHIER}','{{"full_name":"Fiction cashier"}}'),('{OWNER}','{{"full_name":"Fiction owner"}}');
update profiles set role='STAFF',is_active=true where id='{CASHIER}';
update profiles set role='OWNER',is_active=true where id='{OWNER}';
insert into role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into branches(id,code,name,type) values('{BRANCH}','C04FIFO','Fiction C04 shop','PETSHOP');
insert into user_branches(user_id,branch_id) values('{CASHIER}','{BRANCH}');
insert into warehouses(id,branch_id,code,name,type) values('{WAREHOUSE}','{BRANCH}','C04WH','Fiction C04 warehouse','RETAIL');
insert into cashier_shifts(id,branch_id,opened_by,shift_type) values('{SHIFT}','{BRANCH}','{CASHIER}','petshop');
insert into items(id,code,name,unit,item_type,buy_price) values
{','.join(f"('{ITEM[k]}','C04STOCK{k}','Fiction stock {k}','pcs','Persediaan',10)" for k in ITEM)};
insert into stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values
{','.join(f"('{WAREHOUSE}','{ITEM[k]}',(now() at time zone 'Asia/Jakarta')::date,20,20,10,'purchase')" for k in ITEM)};
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1111','Test cash','ASET','D',false),('4101','Sales','PENDAPATAN','K',false),('4102','Discount','PENDAPATAN','D',false),
 ('2201','VAT','LIABILITAS','K',false),('5101','COGS','BEBAN','D',false),('1301','Inventory','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code) values('{CASH}','Fiction C04 cash','Kas','1111');
insert into payment_account_map(metode,branch_id,cash_account_id) values('Tunai','{BRANCH}','{CASH}') on conflict do nothing;
update accounting_locks set closed_until=null;
update company_settings set mode_pkp=false;
insert into promos(id,name,promo_type,rule,discount_type,discount_value,min_qty,max_qty,kelipatan,auto_apply,is_active) values
{','.join(f"('{PROMO[k]}','Fiction package {k}','diskon_produk','{{\"suggest\":\"Fiction\",\"discount_mode\":\"package_total\"}}','nominal',{v},5,5,false,true,true)" for k, v in PACKAGE.items())},
 ('{PROMO['E']}','Fiction legacy E','diskon_produk','{{"suggest":"Fiction"}}','percent',10,null,null,false,true,true);
insert into promo_items(promo_id,item_id) values {','.join(f"('{PROMO[k]}','{ITEM[k]}')" for k in ITEM)};
commit;
"""


def main():
    with fixture.DisposablePostgres() as db:
        db.bootstrap()

        def run(sql, check=True):
            r = subprocess.run(db.command(), input=sql, text=True, capture_output=True)
            if check and r.returncode:
                raise RuntimeError(r.stderr + r.stdout)
            return r

        print(f"Server: PostgreSQL {db.sql('show server_version')}", flush=True)
        db.sql(FIXTURES)
        promos = json.loads(db.sql("select json_agg(to_jsonb(p) order by id) from promos p"))
        targets = json.loads(db.sql("select json_agg(json_build_object('promo_id',promo_id,'item_id',item_id)) from promo_items"))
        carts = [{'ref': ref, 'lines': [{'item_id': ITEM[k], 'qty': qty, 'harga': 20}]} for ref, k, qty in CARTS]
        quoted = subprocess.run(['node', str(ROOT / 'scripts/promo-package-quote.mjs')], cwd=ROOT, check=True, text=True,
                                capture_output=True, input=json.dumps({'branchId': BRANCH, 'promos': promos, 'targets': targets, 'carts': carts}))
        quotes = {q['ref']: q for q in json.loads(quoted.stdout)}
        for ref, (discount, net, _, _) in EXPECT.items():
            got = (quotes[ref]['lines'][0]['promo_discount'], quotes[ref]['net'])
            assert got == (discount, net), (ref, got)
        print('PASS engine from stored promos: package 30/30(capped)/50/60/100 and legacy 10% quoted as expected', flush=True)

        sales = '\n'.join(f"""insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values('{BRANCH}','{q['ref']}',{q['gross']},{q['gross'] - q['net']},{q['net']},'Tunai',{q['net']},auth.uid(),'{SHIFT}',
 {"'[]'::jsonb" if q['net'] == 0 else f"jsonb_build_array(jsonb_build_object('method','Tunai','amount',{q['net']}))"},'sql:{q['ref']}',repeat('c',64));
insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp,promo_id,promo_discount)
select id,'{l['item_id']}','Fiction cashier line',{l['qty']},{l['harga']},'pcs',1,0,{f"'{l['promo_id']}'" if l['promo_id'] else 'null'},{l['promo_discount']}
from sales where no_struk='{q['ref']}';
do $$begin
 perform cashier_post_stock_atomic((select id from sales where no_struk='{q['ref']}'),'{WAREHOUSE}');
 insert into c04_outcome values('{q['ref']}',true,null);
exception when others then insert into c04_outcome values('{q['ref']}',false,sqlerrm);
end$$;""" for q in quotes.values() for l in q['lines'])
        out = db.sql(f"""begin;
create temp table c04_outcome(ref text, posted boolean, message text);
grant all on c04_outcome to authenticated;
set local role authenticated;
{CLAIMS(CASHIER)}{sales}
select json_agg(json_build_object('ref',o.ref,'posted',o.posted,'message',o.message,
 'moves',(select count(*) from stock_moves m where m.source_ref=o.ref),
 'hpp',(select sum(i.hpp) from sale_items i join sales s on s.id=i.sale_id where s.no_struk=o.ref))) from c04_outcome o;
commit;""").splitlines()[-1]
        for row in json.loads(out):
            discount, net, posts, text = EXPECT[row['ref']]
            assert row['posted'] is posts, row
            if posts:
                assert row['moves'] == 1 and float(row['hpp']) == quotes[row['ref']]['lines'][0]['qty'] * 10, row
            else:
                assert text in row['message'] and row['moves'] == 0 and float(row['hpp']) == 0, row
        print('PASS FIFO floor: package sales above/equal floor post with FIFO HPP; below floor and zero net rejected, nothing issued', flush=True)

        # Containment and recovery after activation.
        contain = (PKG / '06-contain-package-promos-writes.sql').read_text()
        thaw = (PKG / '07-thaw-unchanged-package-promos-writes.sql').read_text()
        ledger_before = db.sql(FINGERPRINT)
        edit = lambda key, name: f"""begin;
set local role authenticated;
{CLAIMS(OWNER)}do $$declare snap jsonb:=read_promo_edit('{PROMO[key]}'); p jsonb:=snap->'promo';begin
 perform edit_promo('{PROMO[key]}',snap->>'version',jsonb_build_object('name','{name}','promo_type',p->>'promo_type',
  'suggest',p->'rule'->>'suggest','min_subtotal',null,'min_qty',(p->>'min_qty')::numeric,'max_qty',(p->>'max_qty')::numeric,
  'kelipatan',(p->>'kelipatan')::boolean,'auto_apply',(p->>'auto_apply')::boolean,'discount_type',p->>'discount_type',
  'discount_value',(p->>'discount_value')::numeric,'branch_ids',null,'valid_from',null,'valid_until',null),
  array(select jsonb_array_elements_text(snap->'item_ids'))::uuid[]);
end$$;commit;"""
        db.sql(edit('A', 'Fiction package A renamed before freeze'))
        run(contain)
        state = lambda: dict(line.split('|', 1) for line in db.sql(
            "select id || '|' || is_active || '|' || name from promos where id in (" + ','.join(f"'{v}'" for v in PROMO.values()) + ")").splitlines())
        frozen = state()
        assert all(frozen[PROMO[k]].startswith('false|') for k in PACKAGE) and frozen[PROMO['E']].startswith('true|'), frozen
        assert frozen[PROMO['A']] == 'false|Fiction package A renamed before freeze', frozen
        assert db.sql(FINGERPRINT) == ledger_before
        run(contain)
        assert db.sql(FINGERPRINT) == ledger_before and state() == frozen
        assert db.sql("select bool_or(has_table_privilege(r,'ops_c04.frozen_package_promos','SELECT')) from unnest(array['anon','authenticated','service_role']) r") == 'f'
        print('PASS contain: only active package promos frozen, legacy untouched, earlier edit kept, re-run idempotent, sales/stock/journals identical', flush=True)

        db.sql(edit('B', 'Fiction package B repaired after freeze'))
        r = run(thaw, check=False)
        assert r.returncode and 'C04_THAW_DRIFT' in r.stderr and PROMO['B'] in r.stderr and PROMO['A'] not in r.stderr, r.stderr
        assert state()[PROMO['A']].startswith('false|') and state()[PROMO['B']] == 'false|Fiction package B repaired after freeze'
        db.sql(f"update ops_c04.frozen_package_promos set thawed_at=now(), resolution='kept: repaired after freeze' where promo_id='{PROMO['B']}';")
        run(thaw)
        after = state()
        assert all(after[PROMO[k]].startswith('true|') for k in 'ACD') and after[PROMO['B']] == 'false|Fiction package B repaired after freeze', after
        assert after[PROMO['A']] == 'true|Fiction package A renamed before freeze'
        assert db.sql(FINGERPRINT) == ledger_before
        print('PASS thaw: stops on a promo edited after freeze, keeps that edit; after a recorded decision re-activates only unchanged promos; ledger identical', flush=True)

        db.sql(f"update promos set is_active=false where id='{PROMO['C']}';")
        run(contain)
        db.sql(f"delete from promo_items where promo_id='{PROMO['D']}';")
        r = run(thaw, check=False)
        assert r.returncode and 'C04_THAW_DRIFT' in r.stderr and PROMO['D'] in r.stderr, r.stderr
        db.sql("create or replace function public.assert_active_package_promo_target() returns trigger language plpgsql "
               "security definer set search_path='' as $$begin return null; end$$;")
        for script, name in ((contain, '06'), (thaw, '07')):
            r = run(script, check=False)
            assert r.returncode and 'C04_INSTALL_DRIFT' in r.stderr, (name, r.stderr)
        print('PASS drift: a removed target blocks thaw; a changed C04 guard stops both 06 and 07 before any write', flush=True)


if __name__ == '__main__':
    main()
