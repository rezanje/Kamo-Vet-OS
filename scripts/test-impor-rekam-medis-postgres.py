#!/usr/bin/env python3
"""Rekam medis import + registration identity — fictional regression harness on a throwaway PostgreSQL.

Runs the REAL database functions after every repository migration is applied:
  import_legacy_medical_records_bulk, import_legacy_medical_record_resolved,
  import_legacy_identity_scan, registrasi_pelanggan_atomik, customer_pick_by_phone,
  indonesian_phone_key.

Never accepts a database URL and never connects to Production. All rows are fictional
(`wowo-test::` source keys, made-up owners, phones in the reserved 0800000xxxx range).

Expectations encode the CORRECT behaviour (no loss, no silent duplicate, no overwrite, no
automatic merge of ambiguous identities). A failing case is a finding, not a test to relax.

Concurrency cases are deterministic, not sleep-based:
  * a controller session takes an exclusive lock on a fixture `harness_gate` row;
  * session A runs its import inside a transaction and then blocks on that gate, so it is
    provably parked while holding every lock its import took;
  * the controller waits (pg_stat_activity) until A is observed waiting on the gate, then
    starts session B and waits until B is observed waiting on the identity advisory lock
    (or has finished, which is itself a finding);
  * only then is the gate released.
If any synchronisation point is not reached within the timeout the case is BLOCKED, never
PASS. The C3 live-registration side calls the real registrasi_pelanggan_atomik RPC that the
registration server action calls; it does not run the Next.js server action itself.

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
SYNC_TIMEOUT = 20.0
RESULTS = []
FIXTURE_PHONE = "(phone like '0800000%' or phone like '+62800000%' or phone like '62800000%' or phone like '+62 800%')"


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


def q(text):
    return "'" + str(text).replace("'", "''") + "'"


PER_ROW_ARGS = [('record_no', 'text'), ('record_date', 'timestamptz'), ('owner_name', 'text'), ('phone', 'text'),
                ('address', 'text'), ('patient_name', 'text'), ('species', 'text'), ('breed', 'text'), ('gender', 'text'),
                ('dob', 'date'), ('doctor', 'text'), ('note', 'text'), ('anamnesis', 'text'),
                ('clinical_findings', 'text'), ('diagnosis', 'text'), ('therapy', 'text'),
                ('customer_id', 'uuid'), ('pet_id', 'uuid')]


def per_row_sql(r):
    args = [f"p_source_key => {q(r['source_key'])}"]
    for name, kind in PER_ROW_ARGS:
        value = r.get(name)
        args.append(f"p_{name} => " + ('null' if value is None else q(value)) + f'::{kind}')
    return 'public.import_legacy_medical_record_resolved(' + ', '.join(args) + ')'


def as_actor(sql, actor=OWNER):
    return ("set role authenticated;\n"
            "select set_config('request.jwt.claim.role','authenticated',false);\n"
            f"select set_config('request.jwt.claim.sub','{actor}',false);\n" + sql)


class SyncTimeout(Exception):
    pass


class Session:
    """An independent psql connection fed statements one at a time (real separate backend)."""

    def __init__(self, cmd, name):
        self.name = name
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     text=True, env={**os.environ, 'PSQLRC': '/dev/null'})
        self.out, self.err = [], []
        threading.Thread(target=self._pump, args=(self.proc.stdout, self.out), daemon=True).start()
        threading.Thread(target=self._pump, args=(self.proc.stderr, self.err), daemon=True).start()

    @staticmethod
    def _pump(stream, sink):
        for line in stream:
            sink.append(line.rstrip('\n'))

    def send(self, sql):
        self.proc.stdin.write(sql + '\n')
        self.proc.stdin.flush()

    def close(self, timeout=SYNC_TIMEOUT):
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            raise SyncTimeout(f'session {self.name} did not finish within {timeout}s')
        return self.proc.returncode


class Harness:
    def __init__(self, db, psql_cmd):
        self.db = db
        self.psql_cmd = psql_cmd

    def sql(self, source):
        return self.db.sql(source)

    def scalar(self, source):
        return self.sql(source).splitlines()[-1]

    def bulk(self, rows, actor=OWNER):
        return json.loads(self.sql(as_actor(f'select public.import_legacy_medical_records_bulk({lit(rows)});', actor)).splitlines()[-1])

    def per_row(self, r, actor=OWNER):
        """The per-row RPC exactly as konfirmasiImporRekamMedis/simpanBatchImporRekamMedis call it."""
        return self.scalar(as_actor(f'select {per_row_sql(r)};', actor))

    def snapshot(self):
        """Exact counts plus a content hash of every fictional row, to prove nothing was added or changed."""
        return json.loads(self.scalar(
            "select json_build_object("
            "'visits',(select count(*) from public.visits where legacy_source_key like 'wowo-test::%' or keluhan like 'wowo-test-live%'),"
            "'records',(select count(*) from public.medical_records m join public.visits v on v.id=m.visit_id where v.legacy_source_key like 'wowo-test::%'),"
            f"'customers',(select count(*) from public.customers where {FIXTURE_PHONE}),"
            f"'pets',(select count(*) from public.pets p join public.customers c on c.id=p.customer_id where {FIXTURE_PHONE.replace('phone', 'c.phone')}),"
            "'content',(select md5(coalesce(string_agg(v.legacy_source_key||'|'||coalesce(v.legacy_source_hash,'')||'|'||v.customer_id||'|'||v.pet_id||'|'"
            "||coalesce(m.diagnosis,'')||'|'||coalesce(m.anamnesis,''),',' order by v.legacy_source_key),'')) "
            "from public.visits v join public.medical_records m on m.visit_id=v.id where v.legacy_source_key like 'wowo-test::%'))"))

    def reset(self):
        self.sql("delete from public.medical_records where visit_id in (select id from public.visits where legacy_source_key like 'wowo-test::%' or keluhan like 'wowo-test-live%');"
                 "delete from public.visits where legacy_source_key like 'wowo-test::%' or keluhan like 'wowo-test-live%';"
                 f"delete from public.pets where customer_id in (select id from public.customers where {FIXTURE_PHONE});"
                 f"delete from public.customers where {FIXTURE_PHONE};")

    # ------------------------------------------------------------ deterministic barrier
    def wait_for(self, predicate_sql, what):
        deadline = time.monotonic() + SYNC_TIMEOUT
        while time.monotonic() < deadline:
            if self.scalar(predicate_sql) == 't':
                return
            time.sleep(0.05)
        raise SyncTimeout(f'sync point not reached within {SYNC_TIMEOUT}s: {what}')

    def waiting_on(self, app, kind):
        if kind == 'gate':
            cond = "wait_event_type='Lock' and wait_event in ('tuple','transactionid','relation')"
        elif kind == 'row':
            # Waiting for another transaction to settle a unique-key conflict (visits.legacy_source_key).
            cond = "wait_event_type='Lock' and wait_event='transactionid'"
        else:
            cond = "wait_event_type='Lock' and wait_event='advisory'"
        return f"select exists(select 1 from pg_stat_activity where application_name='{app}' and {cond})"

    def connected(self, app):
        return f"select exists(select 1 from pg_stat_activity where application_name='{app}')"

    def finished(self, app):
        """Connected and no longer running a statement (its script has completed or failed)."""
        return (f"select exists(select 1 from pg_stat_activity where application_name='{app}') "
                f"and not exists(select 1 from pg_stat_activity where application_name='{app}' and state<>'idle')")

    def race(self, first_sql, second_sql, b_wait='advisory'):
        """A holds its locks parked on the gate; B starts only once A is provably parked.

        Returns (a_rc, b_rc, a_out, b_out, b_waited). b_waited is True only when B was
        observed blocked on the lock named by b_wait ('advisory' = the identity lock,
        'row' = A's uncommitted visit with the same source key). Raises SyncTimeout when a
        synchronisation point is never reached (the caller records BLOCKED).
        """
        ctl = Session(self.psql_cmd, 'ctl')
        a = Session(self.psql_cmd, 'A')
        b = None
        try:
            ctl.send("set application_name='harness_ctl'; begin; select 1 from public.harness_gate where id=1 for update;")
            self.wait_for("select exists(select 1 from pg_stat_activity where application_name='harness_ctl' and state='idle in transaction')",
                          'controller holds the gate')
            a.send("set application_name='harness_a';\nbegin;\n" + first_sql
                   + "\nselect 1 from public.harness_gate where id=1 for update;\ncommit;")
            self.wait_for(self.waiting_on('harness_a', 'gate'), 'session A parked on the gate while holding its import locks')
            b = Session(self.psql_cmd, 'B')
            b.send("set application_name='harness_b';\nbegin;\n" + second_sql + "\ncommit;")
            self.wait_for(self.connected('harness_b'), 'session B connected')
            try:
                self.wait_for(self.waiting_on('harness_b', b_wait), f'session B blocked on the {b_wait} lock')
                b_waited = True
            except SyncTimeout:
                # B never blocked. Make sure it really finished (a finding), not still starting.
                self.wait_for(self.finished('harness_b'), 'session B finished without waiting')
                b_waited = False
            ctl.send('commit;')
            a_rc = a.close()
            b_rc = b.close()
            ctl.close()
            return a_rc, b_rc, a.out, b.out, b_waited
        except BaseException:
            for s in (ctl, a, b):
                if s is not None and s.proc.poll() is None:
                    s.proc.kill()
            raise


def statuses(result):
    return [r['status'] for r in result]


def last_json(lines):
    for line in reversed(lines):
        line = line.strip()
        if line.startswith('[') or line.startswith('{'):
            return json.loads(line)
    return None


def bootstrap_fixture(h):
    h.sql(f"""insert into auth.users(id,raw_user_meta_data) values
 ('{OWNER}','{{"full_name":"Pemilik fiktif harness"}}'),('{STAFF}','{{"full_name":"Staf fiktif harness"}}') on conflict do nothing;
insert into public.profiles(id,role,is_active) values ('{OWNER}','OWNER',true),('{STAFF}','STAFF',true)
 on conflict(id) do update set role=excluded.role,is_active=true;
insert into public.branches(id,code,name,type) values ('{BRANCH}','WTEST','Cabang fiktif harness','KLINIK') on conflict do nothing;
create table public.harness_gate(id int primary key);
insert into public.harness_gate values (1);
grant all on public.harness_gate to authenticated;""")


def run_cases(h):
    # ---------------------------------------------------------------- P  phone key parity with the app
    vectors = json.loads((ROOT / 'src/lib/__tests__/fixtures/kunci-hp-indonesia.json').read_text())
    got = json.loads(h.scalar("select json_agg(public.indonesian_phone_key(v->>'masuk') order by o) from jsonb_array_elements("
                              + lit(vectors) + ") with ordinality as t(v,o)"))
    mismatch = [(v['masuk'], v['kunci'], g) for v, g in zip(vectors, got) if v['kunci'] != g]
    check('P1 database phone key matches every shared app vector', not mismatch, f'{len(vectors)} vectors, mismatches={mismatch}')
    legacy = h.scalar("select public.import_legacy_phone_key('+62 800-000-0004') = public.indonesian_phone_key('0800-000-0004')")
    check('P2 import_legacy_phone_key uses the canonical key', legacy == 't', f'equal={legacy}')

    # ---------------------------------------------------------------- R  retry / dedupe
    h.reset()
    rows = [row('wowo-test::r1-a'), row('wowo-test::r1-b', patient='Anjing Fiktif'), row('wowo-test::r1-c', owner='Fiktif Dua', phone='08000000002')]
    first = h.bulk(rows)
    before = h.snapshot()
    again = h.bulk(rows)
    after = h.snapshot()
    check('R1 first send saves every valid row', statuses(first) == ['tersimpan'] * 3, f'statuses={statuses(first)}')
    check('R1 identical resend is all sudah_ada with the same visit ids',
          statuses(again) == ['sudah_ada'] * 3 and [r['visit_id'] for r in again] == [r['visit_id'] for r in first],
          f'statuses={statuses(again)}')
    check('R1 identical resend writes nothing', before == after and after['visits'] == 3, f'before={before} after={after}')
    cosmetic = h.bulk([dict(rows[0], owner_name='  FIKTIF   satu ', phone='+62 800-000-0001')])
    check('R2 resend differing only in spacing/case/phone format is still proven identical',
          statuses(cosmetic) == ['sudah_ada'] and h.snapshot() == after, f'status={statuses(cosmetic)}')
    h.reset()
    dup = h.bulk([row('wowo-test::r3'), row('wowo-test::r3')])
    check('R3 same key twice in one batch saves once', statuses(dup) == ['tersimpan', 'sudah_ada'] and h.snapshot()['visits'] == 1,
          f'statuses={statuses(dup)}')
    h.reset()
    mixed = h.bulk([row('wowo-test::r4-ok1'), row('wowo-test::r4-bad', phone=None), row('wowo-test::r4-ok2', patient='Anjing Fiktif')])
    check('R4 invalid row held with a reason, others saved',
          statuses(mixed) == ['tersimpan', 'ditahan', 'tersimpan'] and bool(mixed[1]['reason']) and h.snapshot()['visits'] == 2,
          f'statuses={statuses(mixed)} reason={mixed[1]["reason"]!r}')

    # ---------------------------------------------------------------- U  interruption / resume
    h.reset()
    chunks = [[row(f'wowo-test::u-{c}{i}', patient=f'Pasien {c}{i}') for i in range(3)] for c in 'abc']
    h.bulk(chunks[0])
    h.sql(as_actor('begin;\n' + f'select public.import_legacy_medical_records_bulk({lit(chunks[1])});\n' + 'rollback;'))
    mid = h.snapshot()
    resumed = [h.bulk(chunk) for chunk in chunks]
    end = h.snapshot()
    check('U1 aborted chunk leaves nothing behind', mid['visits'] == 3, f'visits after abort={mid["visits"]}')
    check('U2 resending every chunk after the cut converges with no duplicate',
          [statuses(r) for r in resumed] == [['sudah_ada'] * 3, ['tersimpan'] * 3, ['tersimpan'] * 3] and end['visits'] == 9,
          f'chunk statuses={[statuses(r) for r in resumed]} visits={end["visits"]}')
    edited = h.bulk([dict(chunks[0][0], diagnosis='Diagnosis diubah setelah putus')])
    check('U3 a card edited between the cut and the resume is held, not merged or overwritten',
          statuses(edited) == ['ditahan'] and 'bentrok' in (edited[0]['reason'] or '') and h.snapshot() == end,
          f'status={statuses(edited)} reason={edited[0]["reason"]!r}')

    # ---------------------------------------------------------------- K  source-key collisions (K1b)
    h.reset()
    h.bulk([row('wowo-test::k1', diagnosis='Diagnosis kartu pertama')])
    base = h.snapshot()
    other = h.bulk([row('wowo-test::k1', owner='Pemilik Lain Fiktif', phone='08000000009', patient='Pasien Lain', diagnosis='Diagnosis kartu kedua')])
    after = h.snapshot()
    kept = h.scalar("select m.diagnosis from public.medical_records m join public.visits v on v.id=m.visit_id where v.legacy_source_key='wowo-test::k1'")
    check('K1 same key, different owner and content: held with a reason, nothing added or overwritten',
          other[0]['status'] == 'ditahan' and 'bentrok' in (other[0]['reason'] or '') and other[0]['visit_id'] is None
          and after == base and kept == 'Diagnosis kartu pertama',
          f'status={other[0]["status"]!r} reason={other[0]["reason"]!r} visit_id={other[0]["visit_id"]} snapshot_unchanged={after == base} stored={kept!r}')
    same_owner = h.bulk([row('wowo-test::k1', diagnosis='Diagnosis kartu pertama', therapy='Terapi tambahan')])
    check('K2 same key, same owner, one extra field: held, not merged',
          same_owner[0]['status'] == 'ditahan' and h.snapshot() == base, f'status={same_owner[0]["status"]!r}')
    h.sql(f"insert into public.customers(id,name,phone) values ('f7000000-0000-4000-8000-000000000201','Fiktif Lama','08000000003');"
          f"insert into public.pets(id,customer_id,name) values ('f7000000-0000-4000-8000-000000000202','f7000000-0000-4000-8000-000000000201','Pasien Lama');"
          f"insert into public.visits(branch_id,customer_id,pet_id,poli,status,legacy_source_key) values "
          f"('{BRANCH}','f7000000-0000-4000-8000-000000000201','f7000000-0000-4000-8000-000000000202','Poli Umum','Selesai','wowo-test::k3');")
    before_legacy = h.snapshot()
    legacy_hit = h.bulk([row('wowo-test::k3', owner='Fiktif Lama', phone='08000000003', patient='Pasien Lama')])
    check('K3 key already used by a visit without a content hash (unprovable): held, nothing written',
          legacy_hit[0]['status'] == 'ditahan' and 'belum terbukti' in (legacy_hit[0]['reason'] or '') and h.snapshot() == before_legacy,
          f'status={legacy_hit[0]["status"]!r} reason={legacy_hit[0]["reason"]!r}')
    scan = json.loads(h.scalar(as_actor("select public.import_legacy_identity_scan(array['wowo-test::k1','wowo-test::kx'],array[]::text[],array[]::text[]);")))
    check('K4 identity scan reports recorded keys (the app forwards them for proof instead of counting them)',
          scan['sudah_ada'] == ['wowo-test::k1'], f'sudah_ada={scan["sudah_ada"]}')

    # ---------------------------------------------------------------- X  per-row path (konfirmasi / simpan batch)
    # The app sends recorded keys through import_legacy_medical_record_resolved too; both paths
    # must compute the same fingerprint, or a card saved by one is wrongly held by the other.
    h.reset()
    x1 = row('wowo-test::x1', record_no='RM-01', address='Jl. Fiktif 1', species='Kucing', dob='2020-02-02',
             doctor='drh. Fiktif', therapy='Terapi fiktif', clinical_findings='Temuan fiktif')
    saved = h.per_row(x1)
    base = h.snapshot()
    via_bulk = h.bulk([dict(x1, phone='+62 800-000-0001', owner_name='FIKTIF  SATU')])
    check('X1 card saved per row, resent through the bulk path: sudah_ada, same visit, nothing written',
          statuses(via_bulk) == ['sudah_ada'] and via_bulk[0]['visit_id'] == saved and h.snapshot() == base,
          f'status={statuses(via_bulk)} same_visit={via_bulk[0]["visit_id"] == saved}')
    x2 = row('wowo-test::x2', patient='Anjing Fiktif', note='Catatan fiktif')
    first_bulk = h.bulk([x2])
    base = h.snapshot()
    again_row = h.per_row(dict(x2, owner_name=' fiktif satu'))
    check('X2 card saved in bulk, resent per row: the same visit is returned, nothing written',
          again_row == first_bulk[0]['visit_id'] and h.snapshot() == base, f'same_visit={again_row == first_bulk[0]["visit_id"]}')
    try:
        h.per_row(dict(x1, diagnosis='Diagnosis kartu lain'))
        x3_ok, x3_msg = False, 'accepted'
    except RuntimeError as error:
        x3_ok, x3_msg = 'bentrok' in str(error), str(error).strip().splitlines()[0][:110]
    check('X3 per row: same key, different content is refused with the conflict reason, nothing written',
          x3_ok and h.snapshot() == base, x3_msg)

    # ---------------------------------------------------------------- N  08 vs +62 (K3 of PR #328)
    h.reset()
    h.bulk([row('wowo-test::n1-a', phone='08000000004')])
    h.bulk([row('wowo-test::n1-b', phone='+62 800-000-0004')])
    snap = h.snapshot()
    check('N1 one owner written 08 then +62 stays one customer and one pet', snap['customers'] == 1 and snap['pets'] == 1,
          f'customers={snap["customers"]} pets={snap["pets"]}')
    reg = json.loads(h.scalar(as_actor("select public.registrasi_pelanggan_atomik('Fiktif Satu','628000000004',null,null,null,null);", STAFF)))
    check('N2 registration with 62.. finds the owner imported as 08..', reg['dibuat'] is False and h.snapshot()['customers'] == 1,
          f'result={reg}')
    h.reset()
    h.sql("insert into public.customers(name,phone) values ('Fiktif Kembar A','08000000006'),('Fiktif Kembar B','+628000000006');")
    stored = h.scalar("select string_agg(phone, ',' order by phone) from public.customers where name like 'Fiktif Kembar%'")
    try:
        h.sql(as_actor("select public.registrasi_pelanggan_atomik('Fiktif Baru','0800 000 0006',null,null,null,null);", STAFF))
        amb_ok, amb_msg = False, 'accepted'
    except RuntimeError as error:
        amb_ok, amb_msg = 'beberapa pelanggan' in str(error), str(error).strip().splitlines()[0][:110]
    check('N3 a phone shared by two existing customers is refused, not merged or picked',
          amb_ok and h.scalar("select count(*) from public.customers where name like 'Fiktif%'") == '2', amb_msg)
    imp = h.bulk([row('wowo-test::n3', owner='Fiktif Baru', phone='08000000006')])
    check('N4 import for a phone already owned by a differently named customer is held for a decision',
          imp[0]['status'] == 'ditahan' and 'Perlu keputusan' in (imp[0]['reason'] or '') and h.snapshot()['visits'] == 0,
          f'status={imp[0]["status"]!r} reason={imp[0]["reason"]!r}')
    check('N5 existing customer rows are not rewritten', h.scalar(
        "select string_agg(phone, ',' order by phone) from public.customers where name like 'Fiktif Kembar%'") == stored,
        f'phones={stored}')

    # ---------------------------------------------------------------- A  role gate
    h.reset()
    try:
        h.bulk([row('wowo-test::a1')], actor=STAFF)
        denied, message = False, 'call succeeded'
    except RuntimeError as error:
        denied, message = 'OWNER/ADMIN' in str(error), str(error).strip().splitlines()[0][:110]
    check('A1 STAFF cannot call the bulk import', denied and h.snapshot()['visits'] == 0, message)

    # ---------------------------------------------------------------- C  deterministic concurrency
    def concurrent(case, first_sql, second_sql, verify, b_wait='advisory'):
        h.reset()
        try:
            a_rc, b_rc, a_out, b_out, b_waited = h.race(first_sql, second_sql, b_wait)
        except SyncTimeout as error:
            record(case, 'BLOCKED', str(error))
            h.reset()
            return
        verify(a_rc, b_rc, a_out, b_out, b_waited)

    one = [row('wowo-test::c1')]
    concurrent('C1 two imports of the same key: B waits, then sudah_ada; one visit',
               as_actor(f'select public.import_legacy_medical_records_bulk({lit(one)});'),
               as_actor(f'select public.import_legacy_medical_records_bulk({lit(one)});'),
               lambda a, b, ao, bo, w: check('C1 two imports of the same key: B waits, then sudah_ada; one visit',
                                             a == 0 and b == 0 and w and (last_json(bo) or [{}])[0].get('status') == 'sudah_ada'
                                             and h.snapshot()['visits'] == 1,
                                             f'A rc={a} B rc={b} B waited={w} B={last_json(bo)} visits={h.snapshot()["visits"]}'))
    concurrent('C2 same key, different content, concurrent: B held, nothing overwritten',
               as_actor(f"select public.import_legacy_medical_records_bulk({lit([row('wowo-test::c2', diagnosis='Kartu A')])});"),
               as_actor(f"select public.import_legacy_medical_records_bulk({lit([row('wowo-test::c2', diagnosis='Kartu B')])});"),
               lambda a, b, ao, bo, w: check('C2 same key, different content, concurrent: B held, nothing overwritten',
                                             a == 0 and b == 0 and w and (last_json(bo) or [{}])[0].get('status') == 'ditahan'
                                             and h.scalar("select string_agg(m.diagnosis,',') from public.medical_records m join public.visits v on v.id=m.visit_id where v.legacy_source_key='wowo-test::c2'") == 'Kartu A',
                                             f'B waited={w} B={last_json(bo)}'))
    concurrent('C3 import open while live registration of the same owner (+62): one customer',
               as_actor(f"select public.import_legacy_medical_records_bulk({lit([row('wowo-test::c3', owner='Fiktif Live', phone='08000000005')])});"),
               as_actor("select public.registrasi_pelanggan_atomik('Fiktif Live','+62 800-000-0005',null,null,null,null);", STAFF),
               lambda a, b, ao, bo, w: check('C3 import open while live registration of the same owner (+62): one customer',
                                             a == 0 and b == 0 and w and (last_json(bo) or {}).get('dibuat') is False
                                             and h.scalar("select count(*) from public.customers where phone in ('08000000005','+62 800-000-0005')") == '1',
                                             f'B waited={w} registration={last_json(bo)} customers={h.scalar("select count(*) from public.customers where phone in (\'08000000005\',\'+62 800-000-0005\')")}'))
    concurrent('C4 live registration open while import of the same owner: one customer, import reuses it',
               as_actor("select public.registrasi_pelanggan_atomik('Fiktif Live','08000000005',null,null,null,null);", STAFF),
               as_actor(f"select public.import_legacy_medical_records_bulk({lit([row('wowo-test::c4', owner='Fiktif Live', phone='+628000000005')])});"),
               lambda a, b, ao, bo, w: check('C4 live registration open while import of the same owner: one customer, import reuses it',
                                             a == 0 and b == 0 and w and (last_json(bo) or [{}])[0].get('status') == 'tersimpan'
                                             and h.scalar("select count(*) from public.customers where phone in ('08000000005','+628000000005')") == '1',
                                             f'B waited={w} import={last_json(bo)}'))
    concurrent('C5 two imports for the same new owner on different keys: one customer, one pet',
               as_actor(f"select public.import_legacy_medical_records_bulk({lit([row('wowo-test::c5-a')])});"),
               as_actor(f"select public.import_legacy_medical_records_bulk({lit([row('wowo-test::c5-b', phone='+62 800-000-0001')])});"),
               lambda a, b, ao, bo, w: check('C5 two imports for the same new owner on different keys: one customer, one pet',
                                             a == 0 and b == 0 and w and h.snapshot()['customers'] == 1 and h.snapshot()['pets'] == 1,
                                             f'B waited={w} snapshot={h.snapshot()}'))
    concurrent('C6 two registrations sharing a phone (08 vs +62): second reuses the first, one customer',
               as_actor("select public.registrasi_pelanggan_atomik('Fiktif Pertama','08000000007',null,null,null,null);", STAFF),
               as_actor("select public.registrasi_pelanggan_atomik('Fiktif Pertama','+62 800-000-0007',null,null,null,null);", STAFF),
               lambda a, b, ao, bo, w: check('C6 two registrations sharing a phone (08 vs +62): second reuses the first, one customer',
                                             a == 0 and b == 0 and w and (last_json(bo) or {}).get('dibuat') is False
                                             and h.scalar("select count(*) from public.customers where phone in ('08000000007','+62 800-000-0007')") == '1',
                                             f'B waited={w} registration={last_json(bo)}'))

    # ---------------------------------------------------------------- deadlock-free ordering
    concurrent('C7 two imports sharing two owners in opposite order: no deadlock, both complete',
               as_actor(f"select public.import_legacy_medical_records_bulk({lit([row('wowo-test::c7-a1', phone='08000000001'), row('wowo-test::c7-a2', owner='Fiktif Dua', phone='08000000002')])});"),
               as_actor(f"select public.import_legacy_medical_records_bulk({lit([row('wowo-test::c7-b2', owner='Fiktif Dua', phone='08000000002', patient='Anjing'), row('wowo-test::c7-b1', phone='08000000001', patient='Anjing')])});"),
               lambda a, b, ao, bo, w: check('C7 two imports sharing two owners in opposite order: no deadlock, both complete',
                                             a == 0 and b == 0 and w and h.snapshot()['visits'] == 4 and h.snapshot()['customers'] == 2,
                                             f'A rc={a} B rc={b} B waited={w} snapshot={h.snapshot()}'))

    # Same key, different owner phone: no shared identity lock, so B must be stopped by A's
    # uncommitted visit (unique key), then held, with its own customer/pet rolled back.
    c8_phone = "select count(*) from public.customers where phone='08000000009'"
    concurrent('C8 same key, different owner phone, concurrent: B waits on the key, held, no orphan owner',
               as_actor(f"select public.import_legacy_medical_records_bulk({lit([row('wowo-test::c8', diagnosis='Kartu A')])});"),
               as_actor(f"select public.import_legacy_medical_records_bulk({lit([row('wowo-test::c8', owner='Pemilik Lain Fiktif', phone='08000000009', diagnosis='Kartu B')])});"),
               lambda a, b, ao, bo, w: check('C8 same key, different owner phone, concurrent: B waits on the key, held, no orphan owner',
                                             a == 0 and b == 0 and w and (last_json(bo) or [{}])[0].get('status') == 'ditahan'
                                             and 'bentrok' in ((last_json(bo) or [{}])[0].get('reason') or '')
                                             and h.snapshot()['visits'] == 1 and h.scalar(c8_phone) == '0',
                                             f'B waited={w} B={last_json(bo)} visits={h.snapshot()["visits"]} orphan_owners={h.scalar(c8_phone)}'),
               b_wait='row')

    h.reset()
    left = h.snapshot()
    check('Z fixture cleanup leaves no fictional rows',
          (left['visits'], left['records'], left['customers'], left['pets']) == (0, 0, 0, 0), f'{left}')


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
