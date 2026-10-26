#!/usr/bin/env python3
"""C04 fictional package-mode and legacy editor regression in owned PostgreSQL."""
import importlib.util
from pathlib import Path
import sys
import subprocess
import time
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fixture',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
fixture=importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(fixture)
with fixture.DisposablePostgres() as db:
    db.bootstrap()
    prefix=(ROOT/'supabase/tests/pos_split_payments.sql').read_text().split('set local role authenticated;')[0]
    db.sql(prefix+(ROOT/'supabase/tests/promo_edit.sql').read_text())
    db.sql(prefix+(ROOT/'supabase/tests/promo_package_total.sql').read_text())
    print('PASS C04: package mode selection, invalid settings, legacy edit, ACL and existing C01 editor',flush=True)

    package_id="e9900000-0000-4000-8000-000000000004"
    item_id="e5500000-0000-4000-8000-000000000001"
    claims="""set local role authenticated;
set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000001';
set local request.jwt.claims='{"role":"authenticated"}';
"""
    db.sql(prefix+f"""
update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';
insert into promos(id,name,promo_type,rule,discount_type,discount_value,min_qty,is_active)
values('{package_id}','Fiction staged package','diskon_produk','{{"suggest":"Fiction","discount_mode":"package_total"}}','nominal',10000,5,false);
commit;""")
    visible=f"select count(*) from promos p where p.id='{package_id}' and p.is_active and (select count(*) from promo_items i where i.promo_id=p.id)<>1;"
    assert db.sql(visible)=='0'

    def denied(statement:str):
        result=subprocess.run(db.command(),input=statement,text=True,capture_output=True,timeout=20)
        assert result.returncode!=0 and 'C04_PACKAGE_TARGET_INCOMPLETE' in result.stderr,result.stderr+result.stdout

    # A second manager cannot activate the staged row before the target exists.
    denied('begin;'+claims+f"update promos set is_active=true where id='{package_id}';commit;")
    assert db.sql(f"select is_active from promos where id='{package_id}'")=='f'

    # Hold both target insertion and activation uncommitted. Another checkout
    # connection still sees the committed inactive row and never a partial one.
    holder=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    holder.stdin.write('begin;set application_name=\'c04-held-activation\';'+claims+
       f"insert into promo_items(promo_id,item_id) values('{package_id}','{item_id}');"+
       f"update promos set is_active=true where id='{package_id}';select pg_sleep(2);commit;")
    holder.stdin.close();holder.stdin=None
    try:
        for _ in range(100):
            if db.sql("select count(*) from pg_stat_activity where application_name='c04-held-activation' and wait_event='PgSleep'")=='1':break
            if holder.poll() is not None:raise RuntimeError('Activation holder exited before barrier')
            time.sleep(0.02)
        else:raise RuntimeError('Activation holder never reached barrier')
        assert db.sql(visible)=='0'
        assert db.sql(f"select is_active from promos where id='{package_id}'")=='f'
        output,error=holder.communicate(timeout=10)
        assert holder.returncode==0,error+output
    finally:
        if holder.poll() is None:holder.kill();holder.communicate()
    assert db.sql(f"select is_active from promos where id='{package_id}'")=='t'
    assert db.sql(f"select count(*) from promo_items where promo_id='{package_id}'")=='1'

    # A concurrent target deletion must fail at commit and leave checkout's
    # active target set intact. The same guard covers a second target insert.
    denied('begin;'+claims+f"delete from promo_items where promo_id='{package_id}';commit;")
    denied('begin;'+claims+f"insert into promo_items(promo_id,item_id) values('{package_id}','e5500000-0000-4000-8000-000000000002');commit;")
    assert db.sql(visible)=='0'
    assert db.sql(f"select count(*) from promo_items where promo_id='{package_id}'")=='1'
    print('PASS C04 visibility: early toggle denied, uncommitted activation invisible, target removal/addition rolled back',flush=True)
