#!/usr/bin/env python3
"""Run production sale migrations and cancellation regressions in a disposable local DB."""
from pathlib import Path
import re
import os
import subprocess
import time

ROOT=Path(__file__).resolve().parents[1]
DB=f'vetos_sale_cancellation_{os.getpid()}_{int(time.time())}'
PSQL=['psql','-X','-q','-At','-h127.0.0.1','-p5432','-v','ON_ERROR_STOP=1','-d',DB]
ENV={**os.environ,'PGOPTIONS':'-c client_min_messages=warning'}
def sql(source, succeeds=True):
    r=subprocess.run(PSQL,input=source,text=True,capture_output=True,env=ENV)
    if (r.returncode==0)!=succeeds: raise RuntimeError(r.stderr[-5000:])
    return r

AUTH="""set role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"role":"authenticated"}',false);
"""

def fixture_owner_updates(source):
    import re
    return re.sub(r"(?m)^update profiles (.*);$", r"alter table profiles disable trigger guard_profile_privileges;\nselect set_config('test.fixture_actor',coalesce(current_setting('request.jwt.claim.sub',true),''),true);\nselect set_config('request.jwt.claim.sub','',true);\nupdate profiles \1;\nselect set_config('request.jwt.claim.sub',current_setting('test.fixture_actor',true),true);\nalter table profiles enable trigger guard_profile_privileges;", source)

def concurrency_tests():
    base=(ROOT/'supabase/tests/pos_merchant_fees.sql').read_text()
    setup=base[:base.index('set local role authenticated;')]+"\nupdate profiles set role='OWNER' where id='e1100000-0000-4000-8000-000000000001';\n"+AUTH
    # Payment records staff effects (Q01 atomic), and a void reverses them latest-first per cashier,
    # so pay in the reverse of the order the races below cancel them.
    for ref in ['RACE.VOID.FIRST','RACE.EFFECT.FIRST','RACE.CANCEL']:
        setup+=f"select pg_temp.fee_sale('{ref}');select pg_temp.lines((select id from sales where no_struk='{ref}'));select finalize_pos_sale((select id from sales where no_struk='{ref}'));\n"
    sql(fixture_owner_updates(setup)+'commit;')
    def start(source):
        p=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=ENV)
        p.stdin.write(AUTH+source);p.stdin.close();return p
    def finish(p,success=True):
        p.wait(timeout=10);out,err=p.stdout.read(),p.stderr.read()
        if (p.returncode==0)!=success: raise RuntimeError(out+err)
        return err
    def wait(predicate):
        for _ in range(200):
            if sql('select exists(select 1 from pg_stat_activity where datname=current_database() and ('+predicate+'));').stdout.strip()=='t':return
            time.sleep(.01)
        raise RuntimeError('Concurrency barrier missing: '+predicate)
    def cancel(ref,key):return f"select cancel_posted_sale((select id from sales where no_struk='{ref}'),0,'{key}','Race cancellation');"
    def effects(ref):return f"select apply_sale_staff_effects((select id from sales where no_struk='{ref}'));"
    winner=start('begin;'+cancel('RACE.CANCEL','race-same')+'select pg_sleep(1) /* sale-cancel-holder */;commit;')
    wait("wait_event='PgSleep' and query like '%sale-cancel-holder%'")
    retry=start('/* sale-cancel-retry */'+cancel('RACE.CANCEL','race-same'))
    wait("wait_event_type='Lock' and query like '%sale-cancel-retry%'")
    finish(winner);finish(retry)
    assert sql("select count(*) from sale_cancellations where sale_id=(select id from sales where no_struk='RACE.CANCEL');").stdout.strip()=='1'
    writer=start('begin;'+effects('RACE.EFFECT.FIRST')+'select pg_sleep(1) /* sale-effects-holder */;commit;')
    wait("wait_event='PgSleep' and query like '%sale-effects-holder%'")
    canceler=start('/* sale-effects-cancel */'+cancel('RACE.EFFECT.FIRST','race-effect-cancel'))
    wait("wait_event_type='Lock' and query like '%sale-effects-cancel%'")
    finish(writer);finish(canceler)
    assert sql("select reversed_at is not null from sale_staff_effects where sale_id=(select id from sales where no_struk='RACE.EFFECT.FIRST');").stdout.strip()=='t'
    # Progress is back to exactly what the earlier, still-active RACE.VOID.FIRST payment left.
    assert sql("select (select jsonb_agg(to_jsonb(p) order by p.id::text) from staff_quest_progress p where staff_id='e1100000-0000-4000-8000-000000000001') is not distinct from (select jsonb_agg(x order by x->>'id') from sale_staff_effects e cross join jsonb_array_elements(e.after_value->'progress') x where e.sale_id=(select id from sales where no_struk='RACE.VOID.FIRST'));").stdout.strip()=='t'
    canceler=start('begin;'+cancel('RACE.VOID.FIRST','race-void-first')+'select pg_sleep(1) /* sale-void-holder */;commit;')
    wait("wait_event='PgSleep' and query like '%sale-void-holder%'")
    writer=start('/* sale-late-effects */'+effects('RACE.VOID.FIRST'))
    wait("wait_event_type='Lock' and query like '%sale-late-effects%'")
    finish(canceler);err=finish(writer,False)
    assert 'dibatalkan' in err,err
    assert sql("select count(*) from sale_staff_effects where sale_id=(select id from sales where no_struk='RACE.VOID.FIRST') and reversed_at is null;").stdout.strip()=='0'
    reward='ebb00000-0000-4000-8000-000000000001'
    sql("insert into staff_reward_catalog(id,reward_name,reward_type,points_cost) values('"+reward+"','Race reward','free_product',25);insert into staff_quest_definitions(quest_type,title,target_kind,target_value,points_reward) values('daily','Race award','total_sales_amount',1,10);insert into staff_points(staff_id,total_points) values('e1100000-0000-4000-8000-000000000001',20);")
    # Reuse helper functions by recreating their temp definitions in this session.
    helpers='\n'.join(re.findall(r'create function pg_temp\.(?:sale|lines|fee_sale)\(.*?\$\$;',base,re.S))
    def pay(ref):sql(AUTH+helpers+f"select pg_temp.fee_sale('{ref}');select pg_temp.lines((select id from sales where no_struk='{ref}'));select finalize_pos_sale((select id from sales where no_struk='{ref}'));" )
    pay('RACE.REDEEM.FIRST')
    def redeem(key):return f"select redeem_staff_reward('{reward}','{key}');"
    sql(AUTH+effects('RACE.REDEEM.FIRST'))
    redeemer=start('begin;'+redeem('redeem-first')+'select pg_sleep(1) /* redeem-holder */;commit;')
    wait("wait_event='PgSleep' and query like '%redeem-holder%'")
    canceler=start('/* redeem-cancel-waiter */'+cancel('RACE.REDEEM.FIRST','redeem-cancel'))
    wait("wait_event_type='Lock' and query like '%redeem-cancel-waiter%'")
    finish(redeemer);err=finish(canceler,False)
    assert 'Saldo hadiah staf sudah berubah' in err,err
    assert sql("select total_points from staff_points where staff_id='e1100000-0000-4000-8000-000000000001';").stdout.strip()=='5'
    sql("update staff_points set total_points=20;delete from staff_quest_progress;delete from staff_streaks;")
    pay('RACE.CANCEL.FIRST')
    sql(AUTH+effects('RACE.CANCEL.FIRST'))
    canceler=start('begin;'+cancel('RACE.CANCEL.FIRST','cancel-before-redeem')+'select pg_sleep(1) /* cancel-redeem-holder */;commit;')
    wait("wait_event='PgSleep' and query like '%cancel-redeem-holder%'")
    redeemer=start('/* cancelled-redeem-waiter */'+redeem('cancelled-first'))
    wait("wait_event_type='Lock' and query like '%cancelled-redeem-waiter%'")
    finish(canceler);err=finish(redeemer,False)
    assert 'Poin belum cukup' in err,err
    assert sql("select total_points from staff_points where staff_id='e1100000-0000-4000-8000-000000000001';").stdout.strip()=='20'
    assert sql("select count(*) from staff_reward_redemptions;").stdout.strip()=='1'
    sql("update staff_reward_catalog set points_cost=10 where id='"+reward+"';")
    sql(AUTH+redeem('remaining-balance')+redeem('remaining-balance'))
    assert sql("select total_points from staff_points where staff_id='e1100000-0000-4000-8000-000000000001';").stdout.strip()=='10'
    print('Both redemption/cancellation lock orders preserve balances and durable redemption retries.',flush=True)
    print('Concurrent identical retries and both effect/cancel orderings passed.',flush=True)


def bootstrap_database():
    """Apply all production migrations to the caller-selected disposable local DB."""
    sql('''create extension pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null;end $$;
do $$ begin create role authenticated; exception when duplicate_object then null;end $$;
-- Supabase service_role bypasses RLS; retain that behavior on reused local clusters.
do $$ begin create role service_role bypassrls; exception when duplicate_object then alter role service_role bypassrls;end $$;
create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
create publication supabase_realtime;
grant usage on schema public,auth,storage to authenticated,anon,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
alter default privileges in schema public grant all on tables to authenticated,service_role;
alter default privileges in schema public grant all on sequences to authenticated,service_role;
''')
    for p in sorted((ROOT/'supabase/migrations').glob('*.sql')):
        if p.name.startswith('0068'): sql("insert into coa_accounts(code,name,type,normal_balance) values('1101','Test cash','ASET','D'),('1102','Test bank','ASET','D') on conflict do nothing;")
        try: sql('begin;\n'+p.read_text()+'\ncommit;')
        except RuntimeError as e: raise RuntimeError(p.name+': '+str(e)) from e
    print('All production migrations applied to disposable local PostgreSQL.',flush=True)

def main():
    subprocess.run(['createdb','-h127.0.0.1','-p5432',DB],check=True)
    try:
        bootstrap_database()
        for name in ['pos_merchant_fees.sql','pos_split_payments.sql','online_return_unit_posting.sql','posted_sale_cancellations.sql']:
            p=ROOT/'supabase/tests'/name
            if p.exists():
                try:
                    fixture=p.read_text()
                    if name=='posted_sale_cancellations.sql':
                        base=(ROOT/'supabase/tests/pos_merchant_fees.sql').read_text()
                        fixture=base[:base.index('set local role authenticated;')]+fixture
                    # Only fixture account writes bypass the native-owner admin guard.
                    fixture=fixture_owner_updates(fixture)
                    sql(fixture)
                except RuntimeError as e: raise RuntimeError(name+': '+str(e)) from e
                print(name+': passed',flush=True)
        concurrency_tests()
    finally:
        subprocess.run(['dropdb','-h127.0.0.1','-p5432','--if-exists',DB],check=True)
        print('Removed disposable local database.',flush=True)
if __name__=='__main__': main()
