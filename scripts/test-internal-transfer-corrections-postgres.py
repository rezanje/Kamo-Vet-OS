#!/usr/bin/env python3
"""All-migration transfer verification in an owned, network-isolated Docker DB only."""
from pathlib import Path
import importlib.util
import subprocess
import time
import uuid
import sys
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = 'kamo-transfer-test-' + uuid.uuid4().hex[:10]
PSQL = ['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-q', '-At', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']
AUTH = "set role authenticated;select set_config('request.jwt.claim.role','authenticated',false);select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000001',false);"


def sql(source):
    result = subprocess.run(PSQL, input=source, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-8000:])
    return result


def main():
    processes = []
    def start(statement):
        p = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        processes.append(p)
        p.stdin.write(AUTH + statement)
        p.stdin.close()
        return p
    def barrier(predicate):
        for _ in range(150):
            if sql('select exists(select 1 from pg_stat_activity where ' + predicate + ');').stdout.strip() == 't':
                return
            time.sleep(.02)
        raise AssertionError('Missing lock barrier: ' + predicate)
    def finish(p, error=None):
        p.wait(timeout=15)
        out, err = p.stdout.read(), p.stderr.read()
        assert (p.returncode != 0 and error in err) if error else p.returncode == 0, out + err
        return out
    def call(key, action='edit', row='race', amount=15):
        return "select mutate_cash_transfer('%s','%s',(select (value->>'transfer_id')::uuid from transfer_results where name='%s'),0,%s,'Fictional correction');" % (key, action, row, "'{}'" if action == 'void' else "jsonb_set((select header from transfer_input),'{jumlah}','%s')" % amount)
    try:
        subprocess.run(['docker', 'run', '-d', '--network=none', '--name', CONTAINER, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16'], check=True, capture_output=True)
        for _ in range(200):
            ready = subprocess.run(['docker', 'exec', CONTAINER, 'pg_isready', '-U', 'postgres'], capture_output=True)
            if ready.returncode == 0 and 'init process complete' in subprocess.run(['docker', 'logs', CONTAINER], capture_output=True, text=True).stdout:
                break
            time.sleep(.1)
        spec = importlib.util.spec_from_file_location('transfer_bootstrap', ROOT / 'scripts/test-posted-sales-postgres.py')
        bootstrap = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bootstrap)
        bootstrap.sql = lambda source: sql(source)
        bootstrap.bootstrap_database()
        sql((ROOT / 'supabase/tests/internal_transfer_corrections.sql').read_text())
        print('PASS transfer permissions, immutable replacement, balances, journals, retry, rollback and downstream SQL suite.', flush=True)
        # Keep the SQL suite's fictional fixtures for real independent sessions.
        for name in ['race', 'concurrent', 'bank-first', 'correction-first', 'close-first', 'revoke-first']:
            sql(AUTH + "insert into transfer_results values('%s',mutate_cash_transfer('create-%s','create',null,null,(select header from transfer_input),null));" % (name, name))
        first = start('begin;' + call('same-request') + "select pg_sleep(2) /* transfer-holder */;commit;")
        barrier("wait_event='PgSleep' and query like '%transfer-holder%'")
        second = start('/* transfer-waiter */' + call('same-request'))
        barrier("wait_event_type='Lock' and query like '%transfer-waiter%'")
        a, b = finish(first), finish(second)
        assert [x for x in a.splitlines() if x.startswith('{')] == [x for x in b.splitlines() if x.startswith('{')]
        first = start('begin;' + call('competing-one', row='concurrent') + "select pg_sleep(2) /* competing-holder */;commit;")
        barrier("wait_event='PgSleep' and query like '%competing-holder%'")
        second = start('/* competing-waiter */' + call('competing-two', row='concurrent', amount=20))
        barrier("wait_event_type='Lock' and query like '%competing-waiter%'")
        finish(first); finish(second, 'sudah berubah')
        reconciliation = "select mutate_bank_reconciliation('transfer-rec','create',null,null,jsonb_build_object('account_id','f7300000-0000-4000-8000-000000000002','tanggal',current_date,'saldo_bank',0,'biaya_adm',0,'bunga',0),null);"
        first = start('begin;' + reconciliation + "select pg_sleep(2) /* rec-holder */;commit;")
        barrier("wait_event='PgSleep' and query like '%rec-holder%'")
        second = start('/* rec-transfer-waiter */' + call('bank-blocked', row='bank-first'))
        barrier("wait_event_type='Lock' and query like '%rec-transfer-waiter%'")
        finish(first); finish(second, 'Rekonsiliasi')
        sql(AUTH + "select mutate_bank_reconciliation('void-transfer-rec','void',(select reconciliation_id from bank_reconciliation_requests where request_key='transfer-rec'),0,'{}','Fictional void');".replace("(select reconciliation_id from bank_reconciliation_requests where request_key='transfer-rec')", "(select id from bank_reconciliations where voided_at is null order by created_at desc limit 1)"))
        first = start('begin;' + call('correction-before-bank', row='correction-first') + "select pg_sleep(2) /* correction-holder */;commit;")
        barrier("wait_event='PgSleep' and query like '%correction-holder%'")
        second = start('/* correction-rec-waiter */' + reconciliation.replace('transfer-rec', 'after-transfer-rec'))
        barrier("wait_event_type='Lock' and query like '%correction-rec-waiter%'")
        finish(first); finish(second)
        assert sql("select r.saldo_buku=(select sum(l.debit-l.credit) from journal_lines l join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id where a.code='1172' and e.tanggal<=current_date) from bank_reconciliations r where voided_at is null;").stdout.strip() == 't'
        first = start("reset role;begin;update accounting_locks set closed_until=current_date where id;select pg_sleep(2) /* closing-holder */;commit;")
        barrier("wait_event='PgSleep' and query like '%closing-holder%'")
        second = start('/* closing-transfer-waiter */' + call('closed-race', row='close-first'))
        barrier("wait_event_type='Lock' and query like '%closing-transfer-waiter%'")
        finish(first); finish(second, 'ditutup')
        sql('update accounting_locks set closed_until=null where id;')
        first = start("reset role;begin;update profiles set is_active=false where id='f7100000-0000-4000-8000-000000000001';select pg_sleep(2) /* revoke-holder */;commit;")
        barrier("wait_event='PgSleep' and query like '%revoke-holder%'")
        second = start('/* revoked-transfer-waiter */' + call('revoked-race', row='revoke-first'))
        barrier("wait_event_type='Lock' and query like '%revoked-transfer-waiter%'")
        finish(first); finish(second, 'Akses')
        print('PASS real duplicate retry, competing correction, both reconciliation orders, close and revocation races.', flush=True)
    finally:
        for p in processes:
            if p.poll() is None:
                p.kill(); p.wait()
        subprocess.run(['docker', 'rm', '-f', CONTAINER], capture_output=True)


if __name__ == '__main__':
    main()
