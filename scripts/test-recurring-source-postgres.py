#!/usr/bin/env python3
"""J04 focused fictional PostgreSQL17.6 source lifecycle; network-none owner-only fixture."""
from pathlib import Path
import importlib.util
import json
import subprocess
import sys
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
fixture.IMAGE = 'postgres:17.6'

def source_period_race(db, core):
    prefix = core.split('-- fixture-end:', 1)[0]
    durable = prefix + '\ncommit;'
    db.sql(durable)
    ready = subprocess.Popen(db.command(), text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    first_sql = """begin;
set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',md5('j04-owner')::uuid::text,true);
select id from public.recurring_journals where id=(select schedule_id from public.qa_j04_state) for update;
select 'READY';select pg_sleep(1);
select public.post_recurring_journal_source_period(schedule_id,first_period) from public.qa_j04_state;
commit;"""
    ready.stdin.write(first_sql)
    ready.stdin.close()
    observed = []
    while True:
        line = ready.stdout.readline()
        if not line:
            raise RuntimeError('J04 race locker ended before it acquired the schedule row')
        observed.append(line.strip())
        if line.strip() == 'READY':
            break
    second_sql = """begin;set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',md5('j04-owner')::uuid::text,true);
select public.post_recurring_journal_source_period(schedule_id,first_period) from public.qa_j04_state;
commit;"""
    second = subprocess.Popen(db.command(), text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    second_out, second_err = second.communicate(second_sql, timeout=20)
    first_tail = ready.stdout.read()
    ready.wait(timeout=20)
    first_err = ready.stderr.read()
    if ready.returncode or second.returncode:
        raise RuntimeError('J04 controlled same-period race failed: ' + first_err + second_err + first_tail + second_out)
    results = [json.loads(line) for line in observed[1:] + first_tail.splitlines() + second_out.splitlines() if line.startswith('{')]
    if len(results) != 2 or sorted(x['posted'] for x in results) != [False, True] or len({x['entry_id'] for x in results}) != 1:
        raise RuntimeError('J04 concurrent callers did not receive one stable journal receipt: ' + repr(results))
    state = db.sql("select (select count(*) from public.recurring_source_occurrences o join public.qa_j04_state s on s.schedule_id=o.schedule_id)=1 and (select count(*) from public.journal_entries e join public.qa_j04_state s on e.source_ref=s.schedule_id::text||':'||s.first_period and e.source='recurring')=1")
    if state != 't':
        raise RuntimeError('J04 concurrent posting left duplicate/missing ledger or proof rows')
    print('PASS deterministic same-period two-session race (one journal, one receipt, one new result)', flush=True)

def main():
    with fixture.DisposablePostgres() as db:
        db.bootstrap()
        core = (ROOT / 'supabase/tests/recurring_source_journals.sql').read_text()
        guards = (ROOT / 'supabase/tests/recurring_source_guards.sql').read_text()
        prefix = core.split('-- fixture-end:',1)[0]
        suites = [
            ('recurring_source_journals.sql', core),
            ('recurring_source_guards.sql', prefix + '\n' + guards),
            ('atomic_recurring_journals.sql', (ROOT / 'supabase/tests/atomic_recurring_journals.sql').read_text()),
            ('recurring_occurrence_limit.sql', (ROOT / 'supabase/tests/recurring_occurrence_limit.sql').read_text()),
        ]
        for name, sql in suites:
            db.sql(sql)
            print('PASS ' + name, flush=True)
        source_period_race(db, core)

if __name__ == '__main__':
    main()
