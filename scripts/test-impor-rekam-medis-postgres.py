#!/usr/bin/env python3
"""Rekam medis import — fictional regression harness against a throwaway PostgreSQL.

TEST-ONLY. Measures the CURRENT behaviour of the real import RPCs
(import_legacy_medical_records_bulk -> import_legacy_medical_record_resolved) after every
repository migration is applied. Changes no application code, parser, key, phone
normalisation, hold rule or migration.

Never accepts a database URL and never connects to Production. Every row is fictional
(`wowo-test::` keys, made-up owners, phones in the reserved 0800000xxxx range).

Expectations encode the CORRECT behaviour (no loss, no silent duplicate, no overwrite).
A case that fails is a FINDING about current behaviour, not a test to be relaxed.

Usage:
  python3 scripts/test-impor-rekam-medis-postgres.py                # Docker postgres:16, network none
  python3 scripts/test-impor-rekam-medis-postgres.py --pg-bin DIR   # native throwaway cluster, no Docker

Exit status: 0 only when every case passes; 1 when any case FAILS or is BLOCKED.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import threading
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

OWNER = 'f7000000-0000-4000-8000-000000000001'
STAFF = 'f7000000-0000-4000-8000-000000000002'
BRANCH = 'f7000000-0000-4000-8000-000000000101'
RESULTS = []


def record(case, status, detail):
    RESULTS.append({'case': case, 'status': status, 'detail': detail})
    print(f'{status:7} {case}: {detail}', flush=True)


def check(case, ok, detail, finding=None):
    record(case, 'PASS' if ok else 'FAIL', detail if ok else f'{detail} | FINDING: {finding or "expectation not met"}')


def row(key, owner='Fiktif Satu', phone='08000000001', patient='Kucing Fiktif', **extra):
    base = {'source_key': key, 'record_date': '2026-01-15T00:00:00+07:00', 'owner_name': owner,
            'phone': phone, 'patient_name': patient, 'diagnosis': 'Diagnosis fiktif', 'anamnesis': 'Anamnesis fiktif'}
    base.update(extra)
    return base


def lit(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


def as_actor(sql, actor=OWNER):
    return ("set role authenticated;\n"
            "select set_config('request.jwt.claim.role','authenticated',false);\n"
            f"select set_config('request.jwt.claim.sub','{actor}',false);\n" + sql)


class Harness:
    def __init__(self, db, psql_cmd):
        self.db = db
        self.psql_cmd = psql_cmd

    def sql(self, source):
        return self.db.sql(source)

    def bulk(self, rows, actor=OWNER):
        out = self.sql(as_actor(f'select public.import_legacy_medical_records_bulk({lit(rows)});', actor))
        return json.loads(out.splitlines()[-1])

    def scalar(self, source):
        return self.sql(source).splitlines()[-1]

    def counts(self):
        return json.loads(self.scalar(
            "select json_build_object("
            "'visits',(select count(*) from public.visits where legacy_source_key like 'wowo-test::%'),"
            "'records',(select count(*) from public.medical_records m join public.visits v on v.id=m.visit_id where v.legacy_source_key like 'wowo-test::%'),"
            "'customers',(select count(*) from public.customers where phone like '0800000%' or phone like '+62800000%' or phone like '62800000%'),"
            "'pets',(select count(*) from public.pets p join public.customers c on c.id=p.customer_id where c.phone like '0800000%' or c.phone like '+62800000%' or c.phone like '62800000%'))"))

    def reset(self):
        self.sql("delete from public.medical_records where visit_id in (select id from public.visits where legacy_source_key like 'wowo-test::%' or keluhan like 'wowo-test-live%');"
                 "delete from public.visits where legacy_source_key like 'wowo-test::%' or keluhan like 'wowo-test-live%';"
                 "delete from public.pets where customer_id in (select id from public.customers where phone like '0800000%' or phone like '+62800000%' or phone like '62800000%');"
                 "delete from public.customers where phone like '0800000%' or phone like '+62800000%' or phone like '62800000%';")

    def session(self, script, out, name):
        """Independent psql connection, used to run genuinely concurrent transactions."""
        started = time.monotonic()
        proc = subprocess.run(self.psql_cmd, input=script, text=True, capture_output=True,
                              env={**os.environ, 'PSQLRC': '/dev/null'})
        out[name] = {'rc': proc.returncode, 'stdout': proc.stdout.strip(), 'stderr': proc.stderr.strip(),
                     'seconds': round(time.monotonic() - started, 2)}

    def race(self, first, second, delay=1.0):
        out = {}
        a = threading.Thread(target=self.session, args=(first, out, 'A'))
        b = threading.Thread(target=self.session, args=(second, out, 'B'))
        a.start(); time.sleep(delay); b.start(); a.join(); b.join()
        return out


def statuses(result):
    return [r['status'] for r in result]


def bootstrap_fixture(h):
    h.sql(f"""insert into auth.users(id,raw_user_meta_data) values
 ('{OWNER}','{{"full_name":"Pemilik fiktif harness"}}'),('{STAFF}','{{"full_name":"Staf fiktif harness"}}') on conflict do nothing;
insert into public.profiles(id,role,is_active) values ('{OWNER}','OWNER',true),('{STAFF}','STAFF',true)
 on conflict(id) do update set role=excluded.role,is_active=true;
insert into public.branches(id,code,name,type) values ('{BRANCH}','WTEST','Cabang fiktif harness','KLINIK') on conflict do nothing;""")


def run_cases(h):
    # ---------------------------------------------------------------- R1 retry/dedupe
    h.reset()
    rows = [row('wowo-test::r1-a'), row('wowo-test::r1-b', patient='Anjing Fiktif'), row('wowo-test::r1-c', owner='Fiktif Dua', phone='08000000002')]
    first = h.bulk(rows)
    before = h.counts()
    again = h.bulk(rows)
    after = h.counts()
    check('R1 first send saves every valid row', statuses(first) == ['tersimpan'] * 3, f'statuses={statuses(first)}')
    check('R1 identical resend is all sudah_ada with the same visit ids',
          statuses(again) == ['sudah_ada'] * 3 and [r['visit_id'] for r in again] == [r['visit_id'] for r in first],
          f'statuses={statuses(again)}')
    check('R1 resend writes nothing', before == after and after['visits'] == 3 and after['records'] == 3,
          f'before={before} after={after}')
    check('R1 same owner+phone reuses one customer and one pet per name', after['customers'] == 2 and after['pets'] == 3,
          f'customers={after["customers"]} pets={after["pets"]}')

    # ---------------------------------------------------------------- R2 duplicate inside one batch
    h.reset()
    dup = h.bulk([row('wowo-test::r2'), row('wowo-test::r2')])
    c = h.counts()
    check('R2 same key twice in one batch saves once', statuses(dup) == ['tersimpan', 'sudah_ada'] and c['visits'] == 1,
          f'statuses={statuses(dup)} visits={c["visits"]}')

    # ---------------------------------------------------------------- R3 one bad row does not sink the batch
    h.reset()
    mixed = h.bulk([row('wowo-test::r3-ok1'), row('wowo-test::r3-bad', phone=None), row('wowo-test::r3-ok2', patient='Anjing Fiktif')])
    c = h.counts()
    check('R3 invalid row is held with a reason, the others are saved',
          statuses(mixed) == ['tersimpan', 'ditahan', 'tersimpan'] and bool(mixed[1]['reason']) and c['visits'] == 2,
          f'statuses={statuses(mixed)} reason={mixed[1]["reason"]!r} visits={c["visits"]}')

    # ---------------------------------------------------------------- R4 resume after an interrupted chunk (DB level)
    h.reset()
    chunks = [[row(f'wowo-test::r4-{c}{i}', patient=f'Pasien {c}{i}') for i in range(3)] for c in 'abc']
    h.bulk(chunks[0])
    # Chunk 2 reaches the database but its transaction never commits (connection lost mid-request).
    h.sql(as_actor('begin;\n' + f'select public.import_legacy_medical_records_bulk({lit(chunks[1])});\n' + 'rollback;'))
    mid = h.counts()
    resumed = [h.bulk(chunk) for chunk in chunks]
    end = h.counts()
    check('R4 aborted chunk leaves nothing behind', mid['visits'] == 3, f'visits after abort={mid["visits"]}')
    check('R4 resending every chunk after the cut converges with no duplicate',
          statuses(resumed[0]) == ['sudah_ada'] * 3 and statuses(resumed[1]) == ['tersimpan'] * 3
          and statuses(resumed[2]) == ['tersimpan'] * 3 and end['visits'] == 9 and end['records'] == 9,
          f'chunk statuses={[statuses(r) for r in resumed]} visits={end["visits"]}')

    # ---------------------------------------------------------------- K1 key collision with different content
    h.reset()
    h.bulk([row('wowo-test::k1', diagnosis='Diagnosis kartu pertama')])
    other = h.bulk([row('wowo-test::k1', owner='Pemilik Lain Fiktif', phone='08000000009', patient='Pasien Lain', diagnosis='Diagnosis kartu kedua')])
    kept = h.scalar("select m.diagnosis from public.medical_records m join public.visits v on v.id=m.visit_id where v.legacy_source_key='wowo-test::k1'")
    c = h.counts()
    check('K1a colliding key never overwrites the stored history', kept == 'Diagnosis kartu pertama' and c['visits'] == 1,
          f'stored diagnosis={kept!r} visits={c["visits"]}')
    check('K1b colliding key with different content is surfaced, not silently reported as already present',
          other[0]['status'] not in ('sudah_ada',),
          f'status={other[0]["status"]!r} reason={other[0]["reason"]!r}',
          'a different card (different owner/phone/patient/diagnosis) with the same source_key is reported as sudah_ada '
          'and dropped without any signal; the second card is lost silently')

    # ---------------------------------------------------------------- K2 same key already used by a branch visit
    h.reset()
    h.sql(f"insert into public.customers(id,name,phone) values ('f7000000-0000-4000-8000-000000000201','Fiktif Cabang','08000000003');"
          f"insert into public.pets(id,customer_id,name) values ('f7000000-0000-4000-8000-000000000202','f7000000-0000-4000-8000-000000000201','Pasien Cabang');"
          f"insert into public.visits(branch_id,customer_id,pet_id,poli,status,legacy_source_key) values "
          f"('{BRANCH}','f7000000-0000-4000-8000-000000000201','f7000000-0000-4000-8000-000000000202','Poli Umum','Selesai','wowo-test::k2');")
    cross = h.bulk([row('wowo-test::k2')])
    c = h.counts()
    check('K2 key that exists on a branch visit is not imported a second time',
          cross[0]['status'] == 'sudah_ada' and c['visits'] == 1, f'status={cross[0]["status"]} visits={c["visits"]}')

    # ---------------------------------------------------------------- K3 the same person written 08 vs +62
    h.reset()
    h.bulk([row('wowo-test::k3-a', phone='08000000004')])
    h.bulk([row('wowo-test::k3-b', phone='+628000000004', patient='Kucing Fiktif')])
    c = h.counts()
    check('K3 one owner whose phone is written 08 and +62 stays one customer', c['customers'] == 1,
          f'customers={c["customers"]} pets={c["pets"]}',
          'digit-only phone key treats 08000000004 and +628000000004 as different owners, creating a duplicate customer and pet')

    # ---------------------------------------------------------------- A1 role gate
    h.reset()
    try:
        h.bulk([row('wowo-test::a1')], actor=STAFF)
        denied = False
        message = 'call succeeded'
    except RuntimeError as error:
        denied = 'OWNER/ADMIN' in str(error)
        message = str(error).strip().splitlines()[0][:120]
    check('A1 STAFF cannot call the bulk import', denied and h.counts()['visits'] == 0, message)

    # ---------------------------------------------------------------- C1 two sessions import the same key
    h.reset()
    one = [row('wowo-test::c1')]
    hold = as_actor(f'begin;\nselect public.import_legacy_medical_records_bulk({lit(one)});\nselect pg_sleep(3);\ncommit;')
    late = as_actor(f'begin;\nselect public.import_legacy_medical_records_bulk({lit(one)});\ncommit;')
    out = h.race(hold, late)
    c = h.counts()
    b_status = [json.loads(line)[0]['status'] for line in out['B']['stdout'].splitlines() if line.startswith('[')]
    check('C1 concurrent import of one key leaves one visit and no error',
          out['A']['rc'] == 0 and out['B']['rc'] == 0 and c['visits'] == 1 and c['customers'] == 1,
          f'A rc={out["A"]["rc"]} B rc={out["B"]["rc"]} B status={b_status} B waited={out["B"]["seconds"]}s visits={c["visits"]} customers={c["customers"]}')

    # ---------------------------------------------------------------- C2 two sessions, different keys, same NEW owner
    h.reset()
    hold = as_actor(f"begin;\nselect public.import_legacy_medical_records_bulk({lit([row('wowo-test::c2-a')])});\nselect pg_sleep(3);\ncommit;")
    late = as_actor(f"begin;\nselect public.import_legacy_medical_records_bulk({lit([row('wowo-test::c2-b')])});\ncommit;")
    out = h.race(hold, late)
    c = h.counts()
    check('C2 concurrent imports for the same new owner create one customer and one pet',
          out['A']['rc'] == 0 and out['B']['rc'] == 0 and c['visits'] == 2 and c['customers'] == 1 and c['pets'] == 1,
          f'B waited={out["B"]["seconds"]}s visits={c["visits"]} customers={c["customers"]} pets={c["pets"]}')

    # ---------------------------------------------------------------- C3 import vs a live clinic registration of the same owner
    h.reset()
    hold = as_actor(f"begin;\nselect public.import_legacy_medical_records_bulk({lit([row('wowo-test::c3', owner='Fiktif Live', phone='08000000005')])});\nselect pg_sleep(3);\ncommit;")
    # Mirrors src/app/(app)/klinik/registrasi/actions.ts: look up customers by exact phone,
    # insert only when none is visible, then create the visit. Direct SQL stand-in, not the server action.
    live = ("begin;\n"
            "with found as (select id from public.customers where phone='08000000005' limit 1),\n"
            " ins as (insert into public.customers(name,phone) select 'Fiktif Live','08000000005' where not exists (select 1 from found) returning id),\n"
            " c as (select id from found union all select id from ins),\n"
            " p as (insert into public.pets(customer_id,name) select id,'Pasien Live' from c returning id, customer_id)\n"
            f"insert into public.visits(branch_id,customer_id,pet_id,poli,status,keluhan) select '{BRANCH}',customer_id,id,'Poli Umum','Menunggu','wowo-test-live' from p;\n"
            "commit;")
    out = h.race(hold, live)
    live_saved = h.scalar("select count(*) from public.visits where keluhan='wowo-test-live'")
    owners = h.scalar("select count(*) from public.customers where name='Fiktif Live' and phone='08000000005'")
    check('C3a a live visit created during an import is saved and not blocked', out['B']['rc'] == 0 and live_saved == '1',
          f'live rc={out["B"]["rc"]} live visits={live_saved} live waited={out["B"]["seconds"]}s'
          + (f' live error={out["B"]["stderr"][:160]!r}' if out['B']['rc'] else ''))
    if out['B']['rc'] != 0:
        # Without the live insert the duplicate-owner question was never exercised; do not count it as a pass.
        record('C3b import and live registration of the same owner end with one customer', 'BLOCKED',
               'live registration did not run, so the outcome was not measured')
    else:
        check('C3b import and live registration of the same owner end with one customer', owners == '1',
              f'customers named Fiktif Live with that phone={owners}',
              'the live registration looks up the owner by phone before inserting, but cannot see the import\'s '
              'uncommitted customer and does not take the import advisory lock; customers.phone is not unique, so the '
              'same owner registered live while an import is open becomes two customer rows')
    h.reset()
    left = h.counts()
    check('Z fixture cleanup leaves no fictional rows', left == {'visits': 0, 'records': 0, 'customers': 0, 'pets': 0}, f'{left}')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--pg-bin', help='PostgreSQL bin dir for a native throwaway cluster instead of Docker')
    parser.add_argument('--json', type=Path, help='Write case results to this file')
    args = parser.parse_args()
    if args.pg_bin:
        sys.path.insert(0, str(ROOT / 'scripts'))
        from native_postgres import NativePostgres
        ctx = NativePostgres(args.pg_bin)
        boot = lambda db: fixture.DisposablePostgres.bootstrap(db)
        cmd = lambda db: db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']
    else:
        ctx = fixture.DisposablePostgres()
        boot = lambda db: db.bootstrap()
        cmd = lambda db: db.command()
    with ctx as db:
        boot(db)
        h = Harness(db, cmd(db))
        bootstrap_fixture(h)
        run_cases(h)
    totals = {s: sum(1 for r in RESULTS if r['status'] == s) for s in ('PASS', 'FAIL', 'BLOCKED')}
    print(f"TOTAL pass={totals['PASS']} fail={totals['FAIL']} blocked={totals['BLOCKED']}", flush=True)
    if args.json:
        args.json.write_text(json.dumps({'totals': totals, 'results': RESULTS}, indent=2))
    sys.exit(0 if totals['FAIL'] == 0 and totals['BLOCKED'] == 0 else 1)


if __name__ == '__main__':
    main()
