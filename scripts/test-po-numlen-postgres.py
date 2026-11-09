#!/usr/bin/env python3
"""Native PG17 proof: document-number columns widened (PO number 25+ chars no longer fails with 22001). Local socket only, no hosted DB.

  flock-free: this script takes /opt/data/kamo-heavy-test.lock itself.
  python3 -I scripts/test-po-numlen-postgres.py --pg-bin /opt/data/kamo-pg-harness/bin [--baseline] [--mutations] [--suites] --json out.json

--baseline  : omit ONLY the candidate migration (RED: the 8-character branch codes must fail with 22001)
default     : candidate applied (GREEN: 0 FAIL)
--mutations : control + clone-per-mutant runs; every mutant must have >= 1 FAIL
--suites    : run the existing PO / receipt / stock-request SQL suites on clones WITHOUT and WITH the candidate; results must be identical
"""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres  # noqa: E402

CANDIDATE = '20261108120000_document_number_columns_widen.sql'
OWNER = '00000000-0000-0000-0000-00000000a001'
WIDENED = [('purchase_orders', 'no_po'), ('sales', 'no_struk'), ('invoices', 'invoice_no'), ('point_ledger', 'ref'),
           ('stock_requests', 'no_request'), ('stock_receipts', 'receipt_number'), ('cash_entries', 'no_bukti'), ('cash_transfers', 'no_transfer')]
CODES8 = ['VET_CMGG', 'VET_GRLG', 'VET_PDRY', 'VET_CIAW', 'VET_GRDA', 'VET_SRKN', 'VET_GRND']   # the hosted 8-character clinic codes
CODE7, CODE13, CODE14 = 'VET_CMS', 'ABCDEFGHIJKLM', 'ABCDEFGHIJKLMN'
SUITES = ['po_branch_numbering.sql', 'purchase_order_lifecycle.sql', 'goods_receipt_cancellation.sql', 'purchase_recovery.sql',
          'purchase_short_close.sql', 'n01_purchase_invoice_receipts.sql', 'purchase_order_line_correction.sql']
ITEMS = '[{"nama":"Fiction item","qty":1,"harga_beli":100}]'

MUTANTS = [  # (name, [(old, new), ...])
    ('skip purchase_orders.no_po', [("('purchase_orders','no_po'),", '')]),
    ('skip sales.no_struk', [("('sales','no_struk'),", '')]),
    ('skip invoices.invoice_no', [("('invoices','invoice_no'),", '')]),
    ('skip point_ledger.ref', [("('point_ledger','ref'),", '')]),
    ('skip stock_requests.no_request', [("('stock_requests','no_request'),", '')]),
    ('skip stock_receipts.receipt_number', [("('stock_receipts','receipt_number'),", '')]),
    ('skip cash_entries.no_bukti', [("('cash_entries','no_bukti'),", '')]),
    ('skip cash_transfers.no_transfer', [(",('cash_transfers','no_transfer')\n", "\n")]),
    ('widen to 25 only (still too short for margin)', [('type varchar(64)', 'type varchar(25)'), ('if v_len<>64 then', 'if v_len<>25 then')]),
    ('widen an extra column (journal_entries.no_jurnal)', [("('cash_transfers','no_transfer')\n", "('cash_transfers','no_transfer'),('journal_entries','no_jurnal')\n")]),
    ('no lock_timeout', [("set local lock_timeout='5s';", '-- no lock timeout')]),
    ('own begin;', [("set local lock_timeout='5s';", "begin;set local lock_timeout='5s';")]),
    ('view guard disabled', [('if exists(select 1 from pg_depend d', 'if false and exists(select 1 from pg_depend d')]),
    ('unexpected-length guard disabled', [("if v_len<>24 then raise exception 'WIDEN_UNEXPECTED_LENGTH", "if false then raise exception 'WIDEN_UNEXPECTED_LENGTH")]),
    ('idempotence removed (already widened = error)', [('if v_len>=64 then continue; end if;', '')]),
]


def load_fixture():
    spec = importlib.util.spec_from_file_location('fullschema', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def seed_sql():
    rows_b, rows_w = [], []
    for i, code in enumerate(CODES8 + [CODE7, CODE13, CODE14]):
        rows_b.append(f"(md5('nl-b-{code}')::uuid,'{code}','Fiction {code}','KLINIK')")
        rows_w.append(f"(md5('nl-w-{code}')::uuid,md5('nl-b-{code}')::uuid,'NLW{i}','Fiction warehouse {code}','VET')")
    return (f"insert into auth.users(id,email) values('{OWNER}','nl-owner@fiction.invalid') on conflict do nothing;"
            f"insert into profiles(id,role,is_active) values('{OWNER}','OWNER',true) on conflict(id) do update set role='OWNER',is_active=true;"
            f"insert into branches(id,code,name,type) values {','.join(rows_b)};"
            f"insert into warehouses(id,branch_id,code,name,type) values {','.join(rows_w)};"
            f"insert into purchase_orders(id,no_po,branch_id,to_warehouse_id,total,status) values(md5('nl-legacy')::uuid,'PO-OLD-0007',md5('nl-b-{CODE7}')::uuid,md5('nl-w-{CODE7}')::uuid,100,'Draft');"
            f"insert into purchase_orders(id,no_po,branch_id,to_warehouse_id,total,status) values(md5('nl-legacy2')::uuid,'PO-20260101-VET_CMS-0001',md5('nl-b-{CODE7}')::uuid,md5('nl-w-{CODE7}')::uuid,100,'Draft');")


COL_DIGEST = ("select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||coalesce(character_maximum_length::text,'')||':'||is_nullable||':'||coalesce(column_default,''),'|' order by table_name,column_name),'')) "
              "from information_schema.columns where table_schema in ('public','clinic_private') and not (table_name||'.'||column_name = any(array[{skip}]))")
OBJ_DIGESTS = {
    'functions': ("select md5(coalesce(string_agg(p.oid::regprocedure::text||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,'')||coalesce(p.proconfig::text,'')||p.prosecdef::text,'|' order by p.oid::regprocedure::text),'')) "
                  "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private') and p.prokind in ('f','p')"),
    'triggers': "select md5(coalesce(string_agg(c.oid::regclass::text||pg_get_triggerdef(t.oid),'|' order by c.oid::regclass::text,t.tgname),'')) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','clinic_private')",
    'policies': "select md5(coalesce(string_agg(schemaname||tablename||policyname||coalesce(qual,'')||coalesce(with_check,'')||coalesce(roles::text,''),'|' order by schemaname,tablename,policyname),'')) from pg_policies where schemaname in ('public','clinic_private')",
    'indexes': "select md5(coalesce(string_agg(schemaname||indexname||indexdef,'|' order by schemaname,indexname),'')) from pg_indexes where schemaname in ('public','clinic_private')",
    'constraints': "select md5(coalesce(string_agg(conrelid::regclass::text||conname||pg_get_constraintdef(oid),'|' order by conrelid::regclass::text,conname),'')) from pg_constraint where connamespace in ('public'::regnamespace,'clinic_private'::regnamespace)",
    'views': "select md5(coalesce(string_agg(schemaname||viewname||definition,'|' order by schemaname,viewname),'')) from pg_views where schemaname in ('public','clinic_private')",
    'acl': "select md5(coalesce(string_agg(c.oid::regclass::text||coalesce(c.relacl::text,'')||c.relrowsecurity::text,'|' order by c.oid::regclass::text),'')) from pg_class c where c.relnamespace in ('public'::regnamespace,'clinic_private'::regnamespace) and c.relkind in ('r','v')",
    'index_oids_unchanged_names': "select count(*)::text from pg_indexes where schemaname='public' and tablename in ('purchase_orders','sales','invoices','point_ledger','stock_requests','stock_receipts','cash_entries','cash_transfers')",
}
LEGACY_ROWS = "select md5(string_agg(to_jsonb(p)::text,'|' order by id)) from purchase_orders p"


def snapshot(db):
    skip = ','.join(f"'{t}.{c}'" for t, c in WIDENED)
    s = {k: db.last(q) for k, q in OBJ_DIGESTS.items()}
    s['columns_except_widened'] = db.last(COL_DIGEST.format(skip=skip))
    s['legacy_rows'] = db.last(LEGACY_ROWS)
    s['widened_types'] = db.last("select string_agg(table_name||'.'||column_name||'='||coalesce(character_maximum_length::text,'?'),',' order by table_name) from information_schema.columns where table_schema='public' and table_name||'.'||column_name = any(array[" + skip + "])")
    return s


def run_cases(db, ctx):
    """Returns [(name, ok, detail)]. Never raises: a crash inside a case is that case's FAIL."""
    cases = []
    day = db.last("select to_char(current_date,'YYYYMMDD')")
    day_prefix = f'PO-{day}-'

    def actor(sql):
        return (f"\\set VERBOSITY verbose\nbegin; set local role authenticated; set local request.jwt.claim.sub='{OWNER}'; set local request.jwt.claim.role='authenticated'; "
                f"set local request.jwt.claims='{{\"sub\":\"{OWNER}\",\"role\":\"authenticated\"}}'; {sql}; commit;")

    def create(code, key, digits=4, prefix=None):
        prefix = day_prefix if prefix is None else prefix
        out = db.last(actor(f"select create_purchase_order_atomic('{key}','{prefix}',{digits},null,md5('nl-w-{code}')::uuid,md5('nl-b-{code}')::uuid,current_date,'{ITEMS}')->>'no_po'"))
        return out

    def refused(fn, needle):
        try:
            fn()
        except RuntimeError as e:
            assert needle in str(e), f'expected {needle!r} in {str(e)[-300:]!r}'
            return
        raise AssertionError(f'expected refusal {needle!r}')

    def case(name, fn):
        try:
            fn()
            cases.append((name, True, ''))
            print('PASS', name, flush=True)
        except Exception as e:  # noqa: BLE001
            msg = re.sub(r'\s+', ' ', str(e))
            first = (re.findall(r'ERROR:[^\n]*', str(e)) or [''])[0].strip()
            detail = (first + ' | ' + msg[-260:]) if first else msg[-400:]
            cases.append((name, False, detail))
            print('FAIL', name, '::', detail[:300], flush=True)

    # static
    def static_header():
        text = ctx['text']
        head = '\n'.join(text.splitlines()[:6]).lower()
        assert 'apply as one transaction' in head
        assert "set local lock_timeout='5s'" in text
        body = re.sub(r'--.*', '', text)
        assert not re.search(r'^\s*(begin|commit|rollback)\s*;', body, re.M | re.I), 'migration must not own begin/commit'
        assert not re.search(r'\b(drop|delete|update|insert|truncate)\b', body, re.I), 'migration must not write data or drop objects'
    case('migration header "apply as ONE transaction", set local lock_timeout=5s, no own begin/commit, no data write', static_header)

    def types64():
        got = db.last("select string_agg(table_name||'.'||column_name||'='||coalesce(character_maximum_length::text,'?'),',' order by table_name) from information_schema.columns where table_schema='public' and table_name||'.'||column_name = any(array["
                      + ','.join(f"'{t}.{c}'" for t, c in WIDENED) + "])")
        want = ','.join(f'{t}.{c}=64' for t, c in sorted(WIDENED))
        assert got == want, got
    case('the eight document-number columns are varchar(64)', types64)

    # the confirmed failure: every 8-character clinic code
    for code in CODES8:
        def one(code=code):
            no = create(code, 'k-' + code)
            assert no == f'{day_prefix}{code}-0001' and len(no) == 25, no
            stored = db.last(f"select no_po from purchase_orders where no_po='{no}'")
            assert stored == no
        case(f'PO for branch {code} (8 chars, number is 25 chars) is created through create_purchase_order_atomic', one)

    def seven():
        no = create(CODE7, 'k-cms-1')
        assert no == f'{day_prefix}{CODE7}-0001' and len(no) == 24, no
        no2 = create(CODE7, 'k-cms-2')
        assert no2 == f'{day_prefix}{CODE7}-0002', no2
    case('7-char code (24 chars) still works and its sequence continues', seven)

    def independent():
        a = create('VET_CMGG', 'k-VET_CMGG-2')
        b = create('VET_GRLG', 'k-VET_GRLG-2')
        assert a.endswith('VET_CMGG-0002') and b.endswith('VET_GRLG-0002'), (a, b)
    case('8-char branches keep independent sequences (0002 each)', independent)

    def replay():
        again = create('VET_CMGG', 'k-VET_CMGG')   # exact retry of the first request
        assert again == f'{day_prefix}VET_CMGG-0001', again
        assert db.last("select count(*) from purchase_orders where no_po like 'PO-%-VET_CMGG-%'") == '2'
    case('exact retry of an 8-char request returns the same PO, no duplicate', replay)

    def thirteen():
        no = create(CODE13, 'k-13')
        assert len(no) == 30 and no == f'{day_prefix}{CODE13}-0001', no
    case('longest allowed (13-char code, 30-char number) works', thirteen)

    def fourteen():
        refused(lambda: create(CODE14, 'k-14'), 'melebihi 30 karakter')
        assert db.last(f"select count(*) from purchase_orders where branch_id=md5('nl-b-{CODE14}')::uuid") == '0'
    case('14-char code is refused by the existing 30-char rule (22023, not 22001), nothing stored', fourteen)

    def five_digits():
        no = create('VET_CIAW', 'k-5d', digits=5)
        assert no == f'{day_prefix}VET_CIAW-00002' and len(no) == 26, no   # continues the 0001 created above, now 5 digits wide
        db.sql(f"insert into purchase_orders(no_po,branch_id,to_warehouse_id,total,status) values('{day_prefix}VET_GRDA-09999',md5('nl-b-VET_GRDA')::uuid,md5('nl-w-VET_GRDA')::uuid,100,'Draft');")
        no2 = create('VET_GRDA', 'k-5d-b', digits=5)
        assert no2 == f'{day_prefix}VET_GRDA-10000' and len(no2) == 26, no2
        db.sql(f"insert into purchase_orders(no_po,branch_id,to_warehouse_id,total,status) values('{day_prefix}VET_SRKN-09999',md5('nl-b-VET_SRKN')::uuid,md5('nl-w-VET_SRKN')::uuid,100,'Draft');")
        refused(lambda: create('VET_SRKN', 'k-4d-full', digits=4), 'Nomor PO sudah mencapai batas format')
    case('5-digit sequence (26 chars) works; a full 4-digit series still stops with the existing message', five_digits)

    def legacy_unchanged():
        assert db.last("select no_po from purchase_orders where id=md5('nl-legacy')::uuid") == 'PO-OLD-0007'
        assert db.last("select no_po from purchase_orders where id=md5('nl-legacy2')::uuid") == 'PO-20260101-VET_CMS-0001'
        assert db.last("select md5(string_agg(to_jsonb(p)::text,'|' order by id)) from purchase_orders p where id in (md5('nl-legacy')::uuid,md5('nl-legacy2')::uuid)") == ctx['legacy_hash']
    case('existing PO numbers and rows are byte-identical', legacy_unchanged)

    def nothing_else_changed():
        now = snapshot(db)
        base = ctx['base']
        diff = [k for k in base if k not in ('widened_types',) and base[k] != now[k] and k != 'legacy_rows']
        assert not diff, f'unexpected change in {diff}'
        assert now['widened_types'] != base['widened_types'], 'columns not widened'
    case('nothing else changed: functions, triggers, policies, indexes, constraints, views, ACL/RLS and every other column identical', nothing_else_changed)

    def reapply_noop():
        text = ctx['text']
        before = snapshot(db)
        db.sql('begin;\n' + text + '\ncommit;')
        after = snapshot(db)
        assert before == after, [k for k in before if before[k] != after[k]]
    case('re-applying the migration is a no-op (idempotent, state identical)', reapply_noop)

    def fail_closed_view():
        t = ctx['template']
        text = ctx['text']
        db.sql(f'drop database if exists nl_view; create database nl_view template {t};')
        os.environ['PGDATABASE'] = 'nl_view'
        try:
            db.sql('create view public.nl_dep_view as select id,no_po from public.purchase_orders;')
            refused(lambda: db.sql('begin;\n' + text + '\ncommit;'), 'WIDEN_DEPENDENT_VIEW_OR_RULE')
            got = db.last("select string_agg(table_name||'='||character_maximum_length,',' order by table_name) from information_schema.columns where table_schema='public' and table_name in ('purchase_orders','sales') and column_name in ('no_po','no_struk')")
            assert got == 'purchase_orders=24,sales=24', got
        finally:
            os.environ.pop('PGDATABASE', None)
            db.sql('drop database if exists nl_view;')
    case('a dependent view stops the whole migration (named error, nothing widened)', fail_closed_view)

    def fail_closed_length():
        t = ctx['template']
        text = ctx['text']
        db.sql(f'drop database if exists nl_len; create database nl_len template {t};')
        os.environ['PGDATABASE'] = 'nl_len'
        try:
            db.sql('alter table public.invoices alter column invoice_no type varchar(20);')
            refused(lambda: db.sql('begin;\n' + text + '\ncommit;'), 'WIDEN_UNEXPECTED_LENGTH')
            got = db.last("select character_maximum_length from information_schema.columns where table_schema='public' and table_name='purchase_orders' and column_name='no_po'")
            assert got == '24', got
        finally:
            os.environ.pop('PGDATABASE', None)
            db.sql('drop database if exists nl_len;')
    case('an unexpected column length stops the whole migration (named error, nothing widened)', fail_closed_length)
    return cases


def build_chain(args, fixture, tmp, db_holder):
    migrations = Path(tmp) / 'supabase/migrations'
    migrations.mkdir(parents=True)
    names = sorted(p.name for p in (ROOT / 'supabase/migrations').glob('*.sql') if p.name != CANDIDATE)
    for n in names:
        (migrations / n).symlink_to(ROOT / 'supabase/migrations' / n)
    fixture.ROOT = Path(tmp)
    return names


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', default='/opt/data/kamo-pg-harness/bin')
    ap.add_argument('--baseline', action='store_true')
    ap.add_argument('--mutations', action='store_true')
    ap.add_argument('--suites', action='store_true')
    ap.add_argument('--json')
    args = ap.parse_args()
    cand_path = ROOT / 'supabase/migrations' / CANDIDATE
    candidate = cand_path.read_text() if cand_path.exists() else None
    report = {'candidate': CANDIDATE, 'candidate_sha256': hashlib.sha256(candidate.encode()).hexdigest() if candidate else None,
              'baseline': args.baseline, 'control': [], 'mutants': [], 'suites': []}
    with open('/opt/data/kamo-heavy-test.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        fixture = load_fixture()
        with tempfile.TemporaryDirectory(prefix='numlen-chain-', dir='/opt/data') as tmp:
            report['chain_migrations'] = len(build_chain(args, fixture, tmp, None))
            with NativePostgres(args.pg_bin) as db:
                fixture.DisposablePostgres.bootstrap(db)
                assert 170000 <= int(db.last('show server_version_num')) < 180000
                report['server_version'] = db.last('show server_version')
                db.sql('create database tpl_numlen_suite template postgres;') if args.suites else None   # clean chain, before the fixture rows
                db.sql(seed_sql())
                ctx = {'base': snapshot(db), 'template': 'tpl_numlen_base', 'text': candidate}
                ctx['legacy_hash'] = db.last("select md5(string_agg(to_jsonb(p)::text,'|' order by id)) from purchase_orders p where id in (md5('nl-legacy')::uuid,md5('nl-legacy2')::uuid)")
                report['widened_types_before'] = ctx['base']['widened_types']
                db.sql('create database tpl_numlen_base template postgres;')

                def apply(text, database=None):
                    if database:
                        os.environ['PGDATABASE'] = database
                    try:
                        db.sql('begin;\n' + text + '\ncommit;')
                    finally:
                        if database:
                            os.environ.pop('PGDATABASE', None)

                if candidate and not args.baseline:
                    apply(candidate)
                report['control'] = run_cases(db, dict(ctx))
                report['control_fail'] = sum(1 for c in report['control'] if not c[1])
                if args.mutations:
                    for name, subs in MUTANTS:
                        text = candidate
                        for old, new in subs:
                            assert text.count(old) == 1, f'mutation anchor must occur exactly once: {name}: {old!r}: {text.count(old)}'
                            text = text.replace(old, new)
                        variant = 'v_' + re.sub(r'[^a-z0-9]', '_', name.lower())[:40]
                        db.sql(f'create database {variant} template tpl_numlen_base;')
                        crash = None
                        try:
                            apply(text, variant)
                        except RuntimeError as e:
                            crash = str(e)[-200:]
                        os.environ['PGDATABASE'] = variant
                        try:
                            res = run_cases(db, dict(ctx, template='tpl_numlen_base', text=text)) if crash is None else []
                        finally:
                            os.environ.pop('PGDATABASE', None)
                        failed = [c[0] for c in res if not c[1]]
                        report['mutants'].append({'name': name, 'killed': bool(failed), 'failed_cases': failed, 'apply_crash': crash})
                        print('MUTANT', 'KILLED' if failed else ('CRASH-AT-APPLY' if crash else 'SURVIVED'), name, flush=True)
                if args.suites:
                    sdb = {'without': 'tpl_numlen_suite'}
                    db.sql('create database tpl_numlen_suite_with template tpl_numlen_suite;')
                    apply(candidate, 'tpl_numlen_suite_with')
                    sdb['with'] = 'tpl_numlen_suite_with'
                    for suite in SUITES:
                        path = ROOT / 'supabase/tests' / suite
                        if not path.exists():
                            report['suites'].append({'suite': suite, 'missing': True})
                            continue
                        row = {'suite': suite}
                        for mode, template in sdb.items():
                            cl = f'cl_{mode}_{abs(hash(suite)) % 10**6}'
                            db.sql(f'create database {cl} template {template};')
                            os.environ['PGDATABASE'] = cl
                            try:
                                db.sql(path.read_text())
                                row[mode] = 'PASS'
                            except RuntimeError as e:
                                row[mode] = 'FAIL ' + re.sub(r'\s+', ' ', str(e))[-160:]
                            finally:
                                os.environ.pop('PGDATABASE', None)
                            db.sql(f'drop database {cl};')
                        row['identical'] = row['with'][:4] == row['without'][:4]
                        report['suites'].append(row)
                        print('SUITE', suite, row['without'][:60], '|', row['with'][:60], flush=True)
    report['summary'] = {'control_pass': sum(1 for c in report['control'] if c[1]), 'control_fail': sum(1 for c in report['control'] if not c[1]),
                         'mutants_killed': sum(1 for m in report['mutants'] if m['killed']), 'mutants_total': len(report['mutants']),
                         'suites_identical': sum(1 for s in report['suites'] if s.get('identical')), 'suites_total': len(report['suites'])}
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=1))
    print(json.dumps(report['summary']))
    if args.baseline:
        sys.exit(0 if report['summary']['control_fail'] > 0 else 1)
    ok = (report['summary']['control_fail'] == 0 and all(m['killed'] for m in report['mutants'])
          and all(s.get('identical') for s in report['suites'] if not s.get('missing')))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
