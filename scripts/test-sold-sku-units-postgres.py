#!/usr/bin/env python3
"""One focused I07 suite; owned network-none PostgreSQL, fictional rolled-back fixtures."""
import importlib.util
from pathlib import Path
import sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('fixture',ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
with fixture.DisposablePostgres() as db:
    db.bootstrap()
    prefix=(ROOT/'supabase/tests/pos_split_payments.sql').read_text().split('set local role authenticated;')[0]
    db.sql(prefix+(ROOT/'supabase/tests/sold_sku_units.sql').read_text())
    print('PASS sold_sku_units.sql',flush=True)

    for name,item in [('clinic_invoice_post.sql','d8000000-0000-4000-8000-000000000001'),('sales_safe_posting.sql','f5000000-0000-4000-8000-000000000001')]:
        original=(ROOT/'supabase/tests'/name).read_text().rsplit('rollback;',1)[0]
        assertion="""do $$declare denied boolean:=false;begin
          begin update public.item_units set factor=28 where item_id='"""+item+"""';
          exception when raise_exception then
            if sqlerrm not like '%SKU%sudah memiliki penjualan%' then raise;end if;denied:=true;
          end;
          if not denied then raise exception 'Sold conversion bypass: """+name+"""';end if;
        end$$;rollback;"""
        db.sql(original+assertion)
        print('PASS native '+name+' plus sold conversion fence',flush=True)
    db.sql((ROOT/'supabase/tests/pos_split_payments.sql').read_text())
    print('PASS native POS split/finalization regressions',flush=True)
    # One focused lock regression for the reviewed first-sale race, no target DB.
    import subprocess,time
    db.sql(prefix+"""update profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';
      insert into item_units(item_id,unit,factor,sell_price,buy_price) values('e5500000-0000-4000-8000-000000000001','box',24,100000,0);
      set local role authenticated;select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
      select set_config('request.jwt.claims','{"role":"authenticated"}',true);
      select pg_temp.sale('I07.RACE');
      insert into sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor) select id,'e5500000-0000-4000-8000-000000000001','Fictional race box',1,100000,'box',24 from sales where no_struk='I07.RACE';commit;""")
    auth="set local role authenticated;set local request.jwt.claim.sub='e1100000-0000-4000-8000-000000000001';set local request.jwt.claims='{\"role\":\"authenticated\"}';"
    proc=subprocess.Popen(db.command(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        proc.stdin.write("set application_name='i07-finalizer';begin;"+auth+"select finalize_pos_sale((select id from sales where no_struk='I07.RACE'));select pg_sleep(1);commit;")
        proc.stdin.close()
        for _ in range(300):
            if db.sql("select exists(select 1 from pg_stat_activity where application_name='i07-finalizer' and wait_event='PgSleep');")=='t':break
            if proc.poll() is not None:raise RuntimeError(proc.stderr.read())
            time.sleep(.01)
        else:raise RuntimeError('Finalizer did not reach lock barrier')
        try:
            db.sql('begin;'+auth+"update item_units set factor=28 where item_id='e5500000-0000-4000-8000-000000000001';commit;")
            raise RuntimeError('Concurrent first sale allowed24-to28 rewrite')
        except RuntimeError as error:
            if 'SKU sudah memiliki penjualan' not in str(error):raise
        proc.wait(timeout=10)
        if proc.returncode:raise RuntimeError(proc.stderr.read())
        assert db.sql("select factor=24 from item_units where item_id='e5500000-0000-4000-8000-000000000001';")=='t'
        print('PASS first-sale finalization vs24-to28 edit: waited, then denied; factor24 preserved',flush=True)
    finally:
        if proc.poll() is None:proc.kill();proc.wait()
