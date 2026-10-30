#!/usr/bin/env python3
"""Medical-record import under an ACTIVE operational branch (RLS) — fictional regression harness.

Covers design docs/desain-impor-rekmed-rls-cabang-aktif.md (D1 + D2 + RS-1) on a throwaway PostgreSQL:
  * D1  shared-history writer `kamo_import.*` owned by NOLOGIN NOBYPASSRLS role; public RPCs stay INVOKER.
  * D2  `authenticated` can never INSERT/UPDATE/DELETE a visit without branch, nor any child row that points
        (directly or through its parent chain) at one — regardless of role, `all_branches`, or header.
  * RS-1 bounded importer read path `public.hasil_impor_rekam_medis` → private validated reader.

Every actor runs as role `authenticated` with a fictional JWT `sub` and, where stated, the same
`request.headers` the Next.js server sends (`x-kamo-operational-branch`). PostgREST's login role is emulated
as `authenticator` (member of anon/authenticated) so SET ROLE reachability is checked like on Supabase.

Never accepts a database URL, never connects to Production. All rows are fictional. A failing case is a
finding, not a test to relax.

Also: own-branch controls for every child payload, the same inserts with user triggers off (only RLS may stop
them), fail-closed rollback of the migration on hostile preconditions, and a non-superuser runner emulating
Supabase `postgres`. Hosted Supabase specifics stay an operational gate (docs, §10).

Usage:
  python3 scripts/test-impor-rekam-medis-rls-postgres.py --pg-bin DIR   # native throwaway cluster, no Docker
  python3 scripts/test-impor-rekam-medis-rls-postgres.py --pg-bin DIR --migration MUTANT.sql   # mutation checks
Exit status: 0 only when every case passes.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('base', ROOT / 'scripts/test-impor-rekam-medis-postgres.py')
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)

NEW_MIGRATION = '20261101120000_impor_penulis_riwayat_bersama.sql'
# Later migrations that build on kamo_import: left out of the bootstrap here (they need this migration first)
# and covered by their own harness (scripts/test-riwayat-bersama-hewan-postgres.py).
DEPENDENT_MIGRATIONS = {'20261104010000_rs2_riwayat_bersama_hewan.sql', '20261104140000_kartu_rekam_medis_tertunda.sql'}
MIGRATION_FILE = ROOT / 'supabase/migrations' / NEW_MIGRATION   # --migration overrides (mutation checks)
WRITER_ROLE = 'kamo_legacy_import_writer'
OWNER, STAFF, BR_A = base.OWNER, base.STAFF, base.BRANCH
ADMIN = 'f7000000-0000-4000-8000-000000000003'
DOCTOR = 'f7000000-0000-4000-8000-000000000004'
FINANCE = 'f7000000-0000-4000-8000-000000000005'
OWNER_OFF = 'f7000000-0000-4000-8000-000000000006'
ADMIN_A = 'f7000000-0000-4000-8000-000000000007'   # ADMIN assigned only to branch A
BR_B = 'f7000000-0000-4000-8000-000000000102'
BR_C = 'f7000000-0000-4000-8000-000000000103'     # inactive branch
RESULTS = []
q, lit = base.q, base.lit


def record(case, ok, detail, finding=None):
    status = 'PASS' if ok else 'FAIL'
    RESULTS.append({'case': case, 'status': status, 'detail': detail})
    print(f'{status:7} {case}: {detail}' + ('' if ok else f' | FINDING: {finding or "expectation not met"}'), flush=True)


def actor(sql, who, header=None):
    hdr = ("select set_config('request.headers', %s, false);\n" % q(json.dumps({'x-kamo-operational-branch': header}))
           if header else "select set_config('request.headers', '', false);\n")
    return ("set role authenticated;\nselect set_config('request.jwt.claim.role','authenticated',false);\n"
            f"select set_config('request.jwt.claim.sub','{who}',false);\n" + hdr + sql)


class Db:
    def __init__(self, db):
        self.db = db

    def sql(self, source, user='postgres'):
        r = subprocess.run(self.db.as_user + [self.db.psql, '-X', '-qAt', '-h', str(self.db.root), '-U', user, '-d', 'postgres',
                                              '-v', 'ON_ERROR_STOP=1'], input=source, text=True, capture_output=True,
                           env={**os.environ, 'PSQLRC': '/dev/null'})
        if r.returncode:
            raise RuntimeError(r.stderr + r.stdout)
        return r.stdout.strip()

    def last(self, source, user='postgres'):
        lines = self.sql(source, user).splitlines()
        return lines[-1] if lines else ''

    def try_(self, source, user='postgres'):
        """(ok, last line or first error line)."""
        try:
            out = self.sql(source, user)
            return True, (out.splitlines()[-1] if out else '')
        except RuntimeError as error:
            lines = [l for l in str(error).strip().splitlines() if l.startswith('ERROR')] or str(error).strip().splitlines()
            return False, lines[0][:220]


# --------------------------------------------------------------------------- fixtures
def bootstrap(d):
    d.sql(f"""
insert into auth.users(id) values ('{ADMIN}'),('{DOCTOR}'),('{FINANCE}'),('{OWNER_OFF}'),('{ADMIN_A}') on conflict do nothing;
insert into public.profiles(id,role,is_active) values ('{ADMIN}','ADMIN',true),('{DOCTOR}','DOCTOR',true),('{FINANCE}','FINANCE',true),
 ('{OWNER_OFF}','OWNER',false),('{ADMIN_A}','ADMIN',true)
 on conflict(id) do update set role=excluded.role, is_active=excluded.is_active;
insert into public.branches(id,code,name,type,is_active) values ('{BR_B}','WTB','Cabang fiktif B','KLINIK',true),
 ('{BR_C}','WTC','Cabang fiktif C nonaktif','KLINIK',false) on conflict do nothing;
insert into public.user_branches(user_id,branch_id,role) values ('{STAFF}','{BR_A}','PRIMARY'),('{DOCTOR}','{BR_A}','PRIMARY'),
 ('{ADMIN_A}','{BR_A}','PRIMARY') on conflict do nothing;""")


IDS = {}


def uid(name):
    """Stable fictional uuid per fixture name."""
    if name not in IDS:
        IDS[name] = 'f8000000-0000-4000-8000-%012d' % (len(IDS) + 1)
    return IDS[name]


def seed_chain(d, tag, branch):
    """Visit → medical record → recipe/consent/inpatient/medication/booking/invoice, triggers off (fixture only)."""
    c, p = uid(f'cust-{tag}'), uid(f'pet-{tag}')
    v, m, r, cn, ir, im, b, inv = (uid(f'{k}-{tag}') for k in ('visit', 'mr', 'recipe', 'consent', 'inpatient', 'med', 'booking', 'invoice'))
    branch_sql = 'null' if branch is None else q(branch)
    legacy = q(f'wowo-test::rls-{tag}') if branch is None else 'null'
    d.sql(f"""set session_replication_role = replica;
insert into public.customers(id,name,phone) values ('{c}','Fiktif {tag}','080000099{len(IDS) % 100:02d}');
insert into public.pets(id,customer_id,name) values ('{p}','{c}','Hewan {tag}');
insert into public.visits(id,branch_id,customer_id,pet_id,poli,status,legacy_source_key,legacy_source_hash,keluhan)
 values ('{v}',{branch_sql},'{c}','{p}','Poli Umum','Selesai',{legacy},{"'hash-awal-" + tag + "'" if branch is None else 'null'},'Keluhan fiktif {tag}');
insert into public.medical_records(id,visit_id,diagnosis,anamnesis) values ('{m}','{v}','Diagnosis {tag}','Anamnesis {tag}');
insert into public.compounding_recipes(id,medical_record_id,recipe_name) values ('{r}','{m}','Racikan {tag}');
insert into public.consents(id,visit_id,tindakan,isi_snapshot) values ('{cn}','{v}','Tindakan {tag}','Isi {tag}');
insert into public.inpatient_records(id,branch_id,visit_id) values ('{ir}','{BR_A}','{v}');
insert into public.inpatient_medications(id,inpatient_record_id,nama_obat) values ('{im}','{ir}','Obat {tag}');
insert into public.bookings(id,branch_id,tanggal,jam,nama_pemilik,phone,nama_hewan,visit_id) values ('{b}','{BR_A}',current_date,'09:00','Fiktif {tag}','0800000990','Hewan {tag}','{v}');
insert into public.invoices(id,visit_id) values ('{inv}','{v}');
set session_replication_role = origin;""")
    return dict(customer=c, pet=p, visit=v, mr=m, recipe=r, consent=cn, inpatient=ir, med=im, booking=b, invoice=inv)


# Child tables writable by `authenticated` and the FK columns that reach a visit (directly or through a parent).
# (table, fk column, parent key in seed_chain, required columns as SQL values with {placeholders}).
CHILDREN = [
    ('medical_records', 'visit_id', 'visit', "diagnosis", "'Anak fiktif'"),
    ('medical_records', 'continued_from_record_id', 'mr', "visit_id", "'{own_visit}'"),
    ('prescription_items', 'medical_record_id', 'mr', "nama_obat", "'Obat anak'"),
    ('compounding_recipes', 'medical_record_id', 'mr', "recipe_name", "'Racikan anak'"),
    ('compounding_ingredients', 'recipe_id', 'recipe', "ingredient_name, quantity, unit", "'Bahan', 1, 'g'"),
    ('prescription_items', 'compound_recipe_id', 'recipe', "medical_record_id, nama_obat", "'{own_mr}', 'Obat racik'"),
    ('consents', 'visit_id', 'visit', "tindakan, isi_snapshot", "'Tindakan anak', 'Isi anak'"),
    ('inpatient_records', 'visit_id', 'visit', "branch_id", f"'{BR_A}'"),
    ('inpatient_records', 'medical_record_id', 'mr', "branch_id, visit_id", f"'{BR_A}', '{{own_visit}}'"),
    ('inpatient_records', 'consent_id', 'consent', "branch_id, visit_id", f"'{BR_A}', '{{own_visit}}'"),
    ('inpatient_medications', 'inpatient_record_id', 'inpatient', "nama_obat", "'Obat ranap'"),
    ('inpatient_daily_logs', 'inpatient_record_id', 'inpatient', "condition_note", "'Catatan harian'"),
    ('inpatient_status_log', 'inpatient_record_id', 'inpatient', "new_status, changed_by", "'stabil', '{actor}'"),
    ('inpatient_med_doses', 'medication_id', 'med', None, None),
    ('visit_operational_events', 'visit_id', 'visit', "branch_id, event_type, created_by", f"'{BR_A}', 'check_in', '{{actor}}'"),
    ('visit_operational_events', 'booking_id', 'booking', "branch_id, event_type, created_by, visit_id", f"'{BR_A}', 'booking_hadir', '{{actor}}', '{{own_visit}}'"),
    ('visit_referrals', 'visit_id', 'visit', "branch_id, direction, facility, reason, created_by", f"'{BR_A}', 'keluar', 'RS fiktif', 'Alasan', '{{actor}}'"),
    ('bookings', 'visit_id', 'visit', "branch_id, tanggal, jam, nama_pemilik, phone, nama_hewan", f"'{BR_A}', current_date, '10:00', 'Fiktif', '0800000991', 'Hewan'"),
    ('follow_ups', 'visit_id', 'visit', "branch_id, pet_id, tanggal", f"'{BR_A}', '{{own_pet}}', current_date"),
    ('follow_ups', 'medical_record_id', 'mr', "branch_id, pet_id, tanggal", f"'{BR_A}', '{{own_pet}}', current_date"),
    ('clinic_record_addenda', 'medical_record_id', 'mr', "visit_id, invoice_id, invoice_paid_status, original_record, request_key, created_by, diagnosis_addendum",
     "'{own_visit}', '{own_invoice}', 'paid', '{{}}'::jsonb, 'k-' || gen_random_uuid(), '{actor}', 'Adendum'"),
    ('clinic_record_corrections', 'medical_record_id', 'mr-koreksi', "expected_revision, changes, reason, request_key, created_by, transaction_id, before_value, after_value",
     "0, '{{}}'::jsonb, 'Koreksi', 'k-' || gen_random_uuid(), '{actor}', txid_current(), '{{}}'::jsonb, '{{}}'::jsonb"),
    ('visits', 'continued_from_visit_id', 'visit', "branch_id, customer_id, pet_id, poli, status", f"'{BR_A}', '{{own_customer}}', '{{own_pet}}', 'Poli Umum', 'Selesai'"),
]
# Tables whose existing child rows are probed for UPDATE/DELETE (one fixture row per shared/own chain).
# The clinic correction/addendum policies only admit actors with the clinic module; FINANCE is refused by them
# before the guard matters, so their own-chain control is only meaningful for OWNER.
CLINIC_ROLE_GATED = {'clinic_record_corrections', 'clinic_record_addenda'}
EXISTING = [('medical_records', 'mr', 'visit_id'), ('compounding_recipes', 'recipe', 'medical_record_id'), ('consents', 'consent', 'visit_id'),
            ('inpatient_medications', 'med', 'inpatient_record_id'), ('bookings', 'booking', 'visit_id')]


def fingerprint(d, chain):
    return d.last(f"""select md5(concat_ws('|',
 (select row(v.*)::text from public.visits v where id='{chain['visit']}'),
 (select row(m.*)::text from public.medical_records m where id='{chain['mr']}'),
 (select count(*) from public.medical_records where visit_id='{chain['visit']}' or continued_from_record_id='{chain['mr']}'),
 (select string_agg(row(x.*)::text, ',' order by x.id) from public.compounding_recipes x where medical_record_id='{chain['mr']}'),
 (select string_agg(row(x.*)::text, ',' order by x.id) from public.consents x where visit_id='{chain['visit']}'),
 (select string_agg(row(x.*)::text, ',' order by x.id) from public.inpatient_records x where visit_id='{chain['visit']}'),
 (select string_agg(row(x.*)::text, ',' order by x.id) from public.inpatient_medications x where inpatient_record_id='{chain['inpatient']}'),
 (select string_agg(row(x.*)::text, ',' order by x.id) from public.bookings x where visit_id='{chain['visit']}'),
 (select count(*) from public.prescription_items where medical_record_id='{chain['mr']}' or compound_recipe_id='{chain['recipe']}'),
 (select count(*) from public.follow_ups where visit_id='{chain['visit']}' or medical_record_id='{chain['mr']}'),
 (select count(*) from public.visit_operational_events where visit_id='{chain['visit']}' or booking_id='{chain['booking']}'),
 (select count(*) from public.visit_referrals where visit_id='{chain['visit']}'),
 (select count(*) from public.clinic_record_addenda where medical_record_id='{chain['mr']}'),
 (select count(*) from public.clinic_record_corrections where medical_record_id='{chain['mr']}'),
 (select count(*) from public.visits where continued_from_visit_id='{chain['visit']}')))""")


# --------------------------------------------------------------------------- cases
def run_cases(d, have_writer):
    shared = seed_chain(d, 'bersama', None)
    own = seed_chain(d, 'cabang-a', BR_A)
    other = seed_chain(d, 'cabang-b', BR_B)
    # A shared and an own medical record in the state where a clinic correction is otherwise allowed
    # (submitted record, visit in payment, no invoice), so only the guard can stop the shared one.
    shared_k, own_k = seed_chain(d, 'bersama-koreksi', None), seed_chain(d, 'koreksi', BR_A)
    for c in (shared_k, own_k):
        d.sql(f"""set session_replication_role = replica;
delete from public.invoices where visit_id='{c['visit']}';
update public.medical_records set submission_key='k-{c['mr']}' where id='{c['mr']}';
update public.visits set status='Pembayaran', service_started_at=now(), service_finished_at=now() where id='{c['visit']}';
set session_replication_role = origin;""")
    shared['mr-koreksi'], own['mr-koreksi'] = shared_k['mr'], own_k['mr']
    fill = lambda s, who: (s or '').format(own_visit=own['visit'], own_mr=own['mr'], own_pet=own['pet'], own_customer=own['customer'],
                                           own_invoice=own['invoice'], actor=who)
    before = fingerprint(d, shared) + fingerprint(d, shared_k)

    # ---------------- D2: visits written directly by authenticated
    contexts = [('OWNER', OWNER, None), ('OWNER', OWNER, BR_A), ('ADMIN', ADMIN, None), ('ADMIN', ADMIN, BR_A), ('FINANCE', FINANCE, None)]
    for name, who, hdr in contexts:
        ctx = f"{name} {'cabang A' if hdr else 'tanpa header'}"
        for label, key in (('jejak impor', "'wowo-test::palsu'"), ('jejak kosong', "''"), ('tanpa jejak (NULL biasa)', 'null')):
            ok, msg = d.try_(actor(f"insert into public.visits(branch_id,customer_id,pet_id,poli,status,legacy_source_key,legacy_source_hash) values "
                                   f"(null,'{own['customer']}','{own['pet']}','Poli Umum','Selesai',{key},'sidik-palsu');", who, hdr))
            record(f'D2 visits INSERT tanpa cabang, {label}, {ctx}', not ok, msg, 'authenticated created a visit without branch')
        ok, n = d.try_(actor(f"with u as (update public.visits set keluhan='diubah' where id='{shared['visit']}' returning 1) select count(*) from u;", who, hdr))
        record(f'D2 visits UPDATE riwayat bersama, {ctx}', (not ok) or n == '0', f'ok={ok} rows={n}', 'shared visit updated')
        ok, n = d.try_(actor(f"with u as (delete from public.visits where id='{shared['visit']}' returning 1) select count(*) from u;", who, hdr))
        record(f'D2 visits DELETE riwayat bersama, {ctx}', (not ok) or n == '0', f'ok={ok} rows={n}', 'shared visit deleted')
        ok, msg = d.try_(actor(f"update public.visits set branch_id=null where id='{own['visit']}';", who, hdr if hdr else None))
        changed = d.last(f"select branch_id is null from public.visits where id='{own['visit']}'")
        record(f'D2 visits UPDATE bercabang → tanpa cabang, {ctx}', changed == 'f', f'ok={ok} now_null={changed} {msg[:80]}',
               'a branch visit was moved into shared history')
        d.sql(f"update public.visits set branch_id='{BR_A}' where id='{own['visit']}'")

    # all_branches capability toggled for ADMIN role (ADMIN_A is assigned to A only)
    for cap in ('false', 'true'):
        d.sql(f"insert into public.role_capabilities(role, all_branches, create_accounts) values ('ADMIN', {cap}, false) "
              f"on conflict(role) do update set all_branches = excluded.all_branches")
        ok, msg = d.try_(actor(f"insert into public.visits(branch_id,customer_id,pet_id,poli,status,legacy_source_key) values "
                               f"(null,'{own['customer']}','{own['pet']}','Poli Umum','Selesai','wowo-test::cap');", ADMIN_A, None))
        record(f'D2 visits INSERT tanpa cabang, ADMIN all_branches={cap}', not ok, msg, 'capability opened shared writes')
    d.sql("delete from public.role_capabilities where role='ADMIN'")

    # ---------------- D2: every child path — INSERT pointing at shared, reparent, UPDATE/DELETE existing
    for who_name, who, hdr in (('OWNER tanpa header', OWNER, None), ('OWNER cabang A', OWNER, BR_A), ('FINANCE tanpa header', FINANCE, None)):
        for table, col, parent, cols, vals in CHILDREN:
            extra_cols = (cols + ', ') if cols else ''
            extra_vals = (fill(vals, who) + ', ') if vals else ''
            tgt = shared[parent]
            stmt = f"insert into public.{table}({extra_cols}{col}) values ({extra_vals}'{tgt}');"
            ok, msg = d.try_(actor(stmt, who, hdr))
            record(f'D2 {table}.{col} INSERT ke riwayat bersama, {who_name}', not ok, msg, 'child attached to shared history')
            # Same insert with user triggers off (superuser-set before SET ROLE, rolled back): only RLS may stop it,
            # so the guard itself is proven for this path, not just an unrelated validation trigger.
            ok, msg = d.try_("begin;\nset session_replication_role = replica;\n" + actor(stmt, who, hdr) + "\nrollback;")
            # Bila INSERT tabel ini sudah dicabut dari authenticated (mis. clinic_record_corrections sejak 20261104080000),
            # jalur ini tertutup oleh hak tabel — lebih ketat dari RLS; kontrol payload tidak bisa dibuktikan dan dilewati.
            dicabut = d.last(f"select has_table_privilege('authenticated', 'public.{table}', 'INSERT')::text") == 'false'
            record(f'D2 {table}.{col} INSERT ke riwayat bersama tanpa trigger (hanya RLS), {who_name}',
                   not ok and ('row-level security' in msg or (dicabut and 'permission denied' in msg)), msg,
                   'RLS alone does not stop a child attached to shared history')
            if dicabut:
                continue
            # Control: the identical payload pointed at the actor's own branch chain passes every policy, so the
            # denial above comes from the shared-history guard, not from an incomplete payload.
            if who == FINANCE and table in CLINIC_ROLE_GATED:
                continue
            ctrl = f"insert into public.{table}({extra_cols}{col}) values ({extra_vals}'{own[parent]}');"
            ok, msg = d.try_("begin;\nset session_replication_role = replica;\n" + actor(ctrl, who, hdr) + "\nrollback;")
            record(f'Kontrol {table}.{col} INSERT ke rantai cabang sendiri tanpa trigger boleh, {who_name}', ok, msg,
                   'payload is refused even for an own-branch parent, so the shared-history case proves nothing')
        for table, parent, col in EXISTING:
            ok, n = d.try_(actor(f"with u as (update public.{table} set {col}={col} where id='{shared[parent]}' returning 1) select count(*) from u;", who, hdr))
            record(f'D2 {table} UPDATE baris anak riwayat bersama, {who_name}', (not ok) or n == '0', f'ok={ok} rows={n}', 'shared child updated')
            ok, n = d.try_(actor(f"with u as (delete from public.{table} where id='{shared[parent]}' returning 1) select count(*) from u;", who, hdr))
            record(f'D2 {table} DELETE baris anak riwayat bersama, {who_name}', (not ok) or n == '0', f'ok={ok} rows={n}', 'shared child deleted')
        # reparent own → shared (new row pointer) and shared → own (old row pointer)
        for table, parent, col, new_parent in (('medical_records', 'mr', 'visit_id', 'visit'), ('compounding_recipes', 'recipe', 'medical_record_id', 'mr'),
                                               ('consents', 'consent', 'visit_id', 'visit'), ('inpatient_medications', 'med', 'inpatient_record_id', 'inpatient'),
                                               ('bookings', 'booking', 'visit_id', 'visit')):
            ok, msg = d.try_(actor(f"update public.{table} set {col}='{shared[new_parent]}' where id='{own[parent]}';", who, hdr))
            moved = d.last(f"select {col}='{shared[new_parent]}' from public.{table} where id='{own[parent]}'")
            record(f'D2 {table} pindah induk cabang→bersama, {who_name}', moved == 'f', f'ok={ok} moved={moved} {msg[:70]}', 'reparented into shared history')
            if moved == 't':
                d.sql(f"update public.{table} set {col}='{own[new_parent]}' where id='{own[parent]}'")
            ok, n = d.try_(actor(f"with u as (update public.{table} set {col}='{own[new_parent]}' where id='{shared[parent]}' returning 1) select count(*) from u;", who, hdr))
            record(f'D2 {table} pindah induk bersama→cabang, {who_name}', (not ok) or n == '0', f'ok={ok} rows={n}', 'reparented out of shared history')
            if ok and n != '0':
                d.sql(f"update public.{table} set {col}='{shared[new_parent]}' where id='{shared[parent]}'")

    # ---------------- regressions: normal branch rows and existing isolation
    ok, msg = d.try_(actor(f"insert into public.visits(branch_id,customer_id,pet_id,poli,status) values ('{BR_A}','{own['customer']}','{own['pet']}','Poli Umum','Menunggu');", STAFF, BR_A))
    record('Regresi STAFF cabang A: INSERT kunjungan cabang A tetap boleh', ok, msg)
    ok, n = d.try_(actor(f"with u as (update public.visits set keluhan='Keluhan diubah' where id='{own['visit']}' returning 1) select count(*) from u;", STAFF, BR_A))
    record('Regresi STAFF cabang A: UPDATE kunjungan cabang A tetap boleh', ok and n == '1', f'ok={ok} rows={n}')
    ok, n = d.try_(actor(f"with u as (update public.medical_records set anamnesis='Anamnesis diubah' where id='{own['mr']}' returning 1) select count(*) from u;", STAFF, BR_A))
    record('Regresi STAFF cabang A: UPDATE rekam medis kunjungan cabang A tetap boleh', ok and n == '1', f'ok={ok} rows={n}')
    for table, cols, vals in (('compounding_recipes', 'medical_record_id, recipe_name', f"'{own['mr']}', 'Racikan regresi'"),
                              ('bookings', 'branch_id, tanggal, jam, nama_pemilik, phone, nama_hewan, visit_id', f"'{BR_A}', current_date, '11:00', 'Fiktif', '0800000992', 'Hewan', '{own['visit']}'"),
                              ('follow_ups', 'pet_id, tanggal, visit_id', f"'{own['pet']}', current_date, '{own['visit']}'"),
                              ('inpatient_medications', 'inpatient_record_id, nama_obat', f"'{own['inpatient']}', 'Obat regresi'")):
        ok, msg = d.try_(actor(f"insert into public.{table}({cols}) values ({vals});", STAFF, BR_A))
        record(f'Regresi STAFF cabang A: INSERT {table} untuk kunjungan cabang A tetap boleh', ok, msg)
    ok, n = d.try_(actor(f"with u as (delete from public.inpatient_medications where inpatient_record_id='{own['inpatient']}' and nama_obat='Obat regresi' returning 1) select count(*) from u;", STAFF, BR_A))
    record('Regresi STAFF cabang A: DELETE anak kunjungan cabang A tetap boleh', ok and n == '1', f'ok={ok} rows={n}')
    ok, msg = d.try_(actor(f"insert into public.medical_records(visit_id, diagnosis) values ('{own['visit']}','Diagnosis baru');", STAFF, BR_A))
    record('Regresi STAFF cabang A: INSERT rekam medis kunjungan cabang A tetap boleh', ok, msg)
    ok, msg = d.try_(actor(f"insert into public.visits(branch_id,customer_id,pet_id,poli,status) values ('{BR_B}','{own['customer']}','{own['pet']}','Poli Umum','Antri');", STAFF, BR_A))
    record('Regresi lintas cabang: STAFF cabang A INSERT kunjungan cabang B ditolak', not ok, msg)
    ok, msg = d.try_(actor(f"insert into public.medical_records(visit_id, diagnosis) values ('{other['visit']}','X');", STAFF, BR_A))
    record('Regresi induk tersembunyi: STAFF cabang A INSERT rekam medis kunjungan cabang B ditolak', not ok, msg)
    ok, n = d.try_(actor(f"select count(*) from public.visits where id='{shared['visit']}';", STAFF, BR_A))
    record('Regresi baca: STAFF tidak melihat riwayat bersama di cabang aktif (D3 terpisah)', ok and n == '0', f'n={n}')

    after = fingerprint(d, shared) + fingerprint(d, shared_k)
    record('Sidik riwayat bersama (kunjungan, rekam medis, semua anak) tidak berubah setelah semua percobaan', before == after,
           f'sebelum={before} sesudah={after}', 'a failed mutation changed shared history')

    if not have_writer:
        record('D1/RS-1 penulis & pembaca tersedia', False, 'kamo_import schema absent', 'writer not implemented yet')
        return

    # ---------------- D1: importer through public RPCs with active header
    rows = [base.row('wowo-test::aktif-1', record_date='2026-01-15T00:00:00+07:00'),
            base.row('wowo-test::aktif-2', record_date='2026-01-16T00:00:00+07:00')]
    for name, who in (('OWNER', OWNER), ('ADMIN', ADMIN)):
        d.sql("delete from public.medical_records where visit_id in (select id from public.visits where legacy_source_key like 'wowo-test::aktif%');"
              "delete from public.visits where legacy_source_key like 'wowo-test::aktif%';")
        out = json.loads(d.last(actor(f"select public.import_legacy_medical_records_bulk({lit(rows)});", who, BR_A)))
        again = json.loads(d.last(actor(f"select public.import_legacy_medical_records_bulk({lit(rows)});", who, BR_A)))
        stored = d.last("select count(*)||'/'||count(*) filter (where branch_id is null)||'/'||count(*) filter (where legacy_source_hash = public.import_legacy_row_hash(%s)) "
                        "from public.visits where legacy_source_key like 'wowo-test::aktif%%'" % lit(rows[0]))
        record(f'D1 {name} cabang aktif: impor massal tersimpan, kirim ulang sudah_ada, branch NULL, sidik server',
               [r['status'] for r in out] == ['tersimpan'] * 2 and [r['status'] for r in again] == ['sudah_ada'] * 2 and stored == '2/2/1',
               f"first={[r['status'] for r in out]} again={[r['status'] for r in again]} stored(total/null/hash0)={stored}")
    d.sql("delete from public.medical_records where visit_id in (select id from public.visits where legacy_source_key like 'wowo-test::aktif%');"
          "delete from public.visits where legacy_source_key like 'wowo-test::aktif%';")
    pr = base.row('wowo-test::aktif-pr')
    ok, vid = d.try_(actor(f"select {base.per_row_sql(pr)};", OWNER, BR_A))
    ok2, vid2 = d.try_(actor(f"select {base.per_row_sql(pr)};", OWNER, BR_A))
    record('D1 OWNER cabang aktif: per baris tersimpan, kirim ulang mengembalikan kunjungan sama', ok and ok2 and vid == vid2, f'{vid} {vid2}')
    # 08 vs +62: the parser-shaped fixture (structured 4-part keys)
    parsed = json.loads((ROOT / 'src/lib/__tests__/fixtures/impor-folder-hp-varian.json').read_text())
    d.sql("delete from public.medical_records where visit_id in (select id from public.visits where legacy_source_key like 'fiktif satu::%');"
          "delete from public.visits where legacy_source_key like 'fiktif satu::%';")
    a = json.loads(d.last(actor(f"select public.import_legacy_medical_records_bulk({lit([parsed[0]])});", OWNER, BR_A)))
    b = json.loads(d.last(actor(f"select public.import_legacy_medical_records_bulk({lit([parsed[1]])});", ADMIN, BR_A)))
    c = json.loads(d.last(actor(f"select public.import_legacy_medical_records_bulk({lit([dict(parsed[1], diagnosis='Diubah')])});", OWNER, BR_A)))
    record('D1 cabang aktif: 08 lalu +62 sudah_ada (kunjungan sama), isi berubah ditahan bentrok',
           a[0]['status'] == 'tersimpan' and b[0]['status'] == 'sudah_ada' and b[0]['visit_id'] == a[0]['visit_id']
           and c[0]['status'] == 'ditahan' and 'bentrok' in (c[0]['reason'] or ''), f"{a[0]['status']} {b[0]['status']} {c[0]['status']}")

    d.sql("insert into public.role_capabilities(role, all_branches, create_accounts) values ('ADMIN', false, false) on conflict(role) do update set all_branches=false")
    for name, who, hdr in (('STAFF cabang A', STAFF, BR_A), ('DOCTOR cabang A', DOCTOR, BR_A), ('FINANCE tanpa header', FINANCE, None),
                           ('OWNER nonaktif', OWNER_OFF, None), ('OWNER header cabang nonaktif', OWNER, BR_C),
                           ('ADMIN_A all_branches=false header cabang B (tidak berhak)', ADMIN_A, BR_B), ('header bukan uuid', OWNER, 'bukan-uuid')):
        ok, msg = d.try_(actor(f"select public.import_legacy_medical_records_bulk({lit([base.row('wowo-test::tolak')])});", who, hdr))
        saved = d.last("select count(*) from public.visits where legacy_source_key='wowo-test::tolak'")
        record(f'D1 tidak berhak / konteks salah ditolak: {name}', (not ok or '"tersimpan"' not in msg) and saved == '0', f'{msg[:90]} saved={saved}')
    d.sql("delete from public.role_capabilities where role='ADMIN'")
    for cap in ('false', 'true'):
        d.sql(f"insert into public.role_capabilities(role, all_branches, create_accounts) values ('ADMIN', {cap}, false) on conflict(role) do update set all_branches=excluded.all_branches")
        k = f'wowo-test::cap-{cap}'
        out = json.loads(d.last(actor(f"select public.import_legacy_medical_records_bulk({lit([base.row(k)])});", ADMIN_A, BR_A)))
        record(f'D1 ADMIN ditugaskan cabang A, all_branches={cap}, header A: impor tersimpan', out[0]['status'] == 'tersimpan', str(out[0]['status']))
    d.sql("delete from public.role_capabilities where role='ADMIN'")

    # ---------------- D1: writer called directly with forged input
    good = base.row('wowo-test::langsung', owner=f'Fiktif cabang-a', phone=d.last(f"select phone from public.customers where id='{own['customer']}'"),
                    patient=f'Hewan cabang-a')
    def writer(row_, cust, pet, who=OWNER, hdr=BR_A):
        return d.try_(actor(f"select kamo_import.simpan_riwayat_bersama({lit(row_)}, {q(cust) if cust else 'null'}::uuid, {q(pet) if pet else 'null'}::uuid);", who, hdr))
    for label, row_, cust, pet in (('jejak kosong', dict(good, source_key='  '), own['customer'], own['pet']),
                                   ('jejak >500', dict(good, source_key='wowo-test::' + 'x' * 600), own['customer'], own['pet']),
                                   ('pelanggan bukan kandidat (HP & nama beda)', dict(good, owner_name='Orang Lain', phone='08000000999'), own['customer'], own['pet']),
                                   ('anabul milik pelanggan lain', good, own['customer'], other['pet']),
                                   ('pelanggan kosong', good, None, None)):
        ok, msg = writer(row_, cust, pet)
        record(f'D1 penulis langsung menolak: {label}', not ok, msg)
    ok, vid = writer(dict(good, legacy_source_hash='sidik-palsu', source_key='wowo-test::langsung-ok'), own['customer'], own['pet'])
    h = d.last("select legacy_source_hash = public.import_legacy_row_hash(%s) from public.visits where legacy_source_key='wowo-test::langsung-ok'"
               % lit(dict(good, source_key='wowo-test::langsung-ok')))
    record('D1 penulis langsung: sidik dari pemanggil diabaikan, sidik tersimpan = hitungan server', ok and h == 't', f'ok={ok} hash_server={h}')
    for name, who in (('STAFF', STAFF), ('DOCTOR', DOCTOR), ('FINANCE', FINANCE), ('OWNER nonaktif', OWNER_OFF)):
        ok, msg = writer(dict(good, source_key=f'wowo-test::langsung-{name}'), own['customer'], own['pet'], who=who, hdr=None)
        record(f'D1 penulis langsung menolak peran: {name}', not ok, msg)
    ok, msg = d.try_(f"set role anon;\nselect kamo_import.simpan_riwayat_bersama('{{}}'::jsonb, null, null);")
    record('D1 anon tidak bisa memanggil penulis', not ok and 'permission denied' in msg, msg)

    identity_cases(d)
    branch_collision(d)

    # ---------------- triggers under the writer role
    act = d.last(f"select count(*)||'/'||count(*) filter (where actor_id='{OWNER}') from public.activity_log where row_entity='visits' "
                 f"and row_id=(select id::text from public.visits where legacy_source_key='wowo-test::langsung-ok')")
    cont = d.last("select count(*) from public.visits where legacy_source_key like 'wowo-test::%' and continued_from_visit_id is not null")
    record('Trigger: log aktivitas mencatat aktor importir (auth.uid), tautan lanjutan tetap kosong', act.split('/')[1] != '0' and cont == '0', f'activity={act} continued={cont}')

    # ---------------- RS-1 bounded read path
    keys = ['wowo-test::langsung-ok', parsed[0]['source_key']]
    ok, out = d.try_(actor(f"select jsonb_agg(t) from public.hasil_impor_rekam_medis(array[{','.join(q(k) for k in keys)}]) t;", OWNER, BR_A))
    rows_out = json.loads(out) if ok and out else []
    record('RS-1 OWNER cabang aktif membaca hasil impor (tanggal, pemilik, hewan, isi klinis)',
           ok and len(rows_out) >= 2 and all(r.get('diagnosis') and r.get('tanggal') and r.get('hewan') for r in rows_out), f'n={len(rows_out)} {out[:120]}')
    for label, arr, who, hdr in (('>500 kunci', 'array_fill(\'wowo-test::x\'::text, array[501])', OWNER, BR_A),
                                 ('kunci >500 karakter', "array['" + 'x' * 501 + "']", OWNER, BR_A),
                                 ('array kosong', "array[]::text[]", OWNER, BR_A),
                                 ('STAFF', f"array['{keys[0]}']", STAFF, BR_A), ('DOCTOR', f"array['{keys[0]}']", DOCTOR, BR_A),
                                 ('OWNER nonaktif', f"array['{keys[0]}']", OWNER_OFF, None), ('header cabang nonaktif', f"array['{keys[0]}']", OWNER, BR_C)):
        ok, msg = d.try_(actor(f"select count(*) from public.hasil_impor_rekam_medis({arr});", who, hdr))
        record(f'RS-1 ditolak: {label}', not ok, msg)
    d.sql(f"insert into public.visits(branch_id,customer_id,pet_id,poli,status,legacy_source_key) values "
          f"('{BR_A}','{own['customer']}','{own['pet']}','Poli Umum','Selesai','wowo-test::bercabang-lama')")
    ok, n = d.try_(actor("select count(*) from public.hasil_impor_rekam_medis(array['wowo-test::bercabang-lama']);", OWNER, BR_A))
    record('RS-1 tidak mengembalikan kunjungan bercabang (walau berjejak)', ok and n == '0', f'n={n}')
    many = [f'wowo-test::banyak-{i}' for i in range(500)]
    ok, n = d.try_(actor(f"select count(*) from public.hasil_impor_rekam_medis(array[{','.join(q(k) for k in many)}]);", OWNER, BR_A))
    record('RS-1 batas atas: tepat 500 jejak diterima', ok and n == '0', f'ok={ok} n={n}')
    secdef = d.last("select string_agg(p.proname||'='||p.prosecdef, ',' order by p.proname) from pg_proc p where p.oid in "
                    "('public.hasil_impor_rekam_medis(text[])'::regprocedure, 'public.import_legacy_medical_records_bulk(jsonb)'::regprocedure)")
    record('RS-1 & RPC impor publik tetap SECURITY INVOKER', secdef == 'hasil_impor_rekam_medis=false,import_legacy_medical_records_bulk=false', secdef)

    # ---------------- helper failure fails closed
    helper = 'kamo_import.tanpa_cabang_kunjungan(uuid)'
    probe = f"insert into public.medical_records(visit_id, diagnosis) values ('{own['visit']}','Saat helper rusak');"
    d.sql(f"revoke execute on function {helper} from authenticated")
    ok, msg = d.try_(actor(probe, STAFF, BR_A))
    d.sql(f"grant execute on function {helper} to authenticated")
    record('D2 helper galat (tanpa hak EXECUTE) → tulis anak cabang ditolak (gagal tertutup)', not ok, msg[:110])
    original = d.sql(f"select pg_get_functiondef('{helper}'::regprocedure)")
    d.sql("create or replace function kamo_import.tanpa_cabang_kunjungan(p_id uuid) returns boolean language sql stable security definer "
          "set search_path = '' as $$ select null::boolean $$;")
    ok, msg = d.try_(actor(probe, STAFF, BR_A))
    d.sql(original + ';')
    record('D2 helper mengembalikan NULL → tulis anak cabang ditolak (gagal tertutup)', not ok and 'row-level security' in msg, msg[:110])
    ok, msg = d.try_(actor(probe, STAFF, BR_A))
    record('D2 helper dipulihkan → tulis anak cabang kembali boleh (kontrol)', ok, msg[:110])

    # ---------------- hosted-style gate, checked again from outside the migration
    gate = json.loads(d.last(f"""select json_build_object(
 'owner_ok', (select bool_and(pg_get_userbyid(p.proowner) = '{WRITER_ROLE}') from pg_proc p where p.pronamespace='kamo_import'::regnamespace),
 'bypassrls', (select rolbypassrls from pg_roles where rolname='{WRITER_ROLE}'),
 'login', (select rolcanlogin from pg_roles where rolname='{WRITER_ROLE}'),
 'set_members', (select count(*) from pg_auth_members where roleid='{WRITER_ROLE}'::regrole and (set_option or inherit_option)),
 'reachable', (select string_agg(r, ',') from unnest(array['authenticator','authenticated','anon','service_role']) r where pg_has_role(r, '{WRITER_ROLE}', 'SET')),
 'schema_create', (select count(*) from pg_namespace n where has_schema_privilege('{WRITER_ROLE}', n.oid, 'CREATE')),
 'table_udt', (select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and
     (has_table_privilege('{WRITER_ROLE}', c.oid, 'UPDATE') or has_table_privilege('{WRITER_ROLE}', c.oid, 'DELETE') or has_table_privilege('{WRITER_ROLE}', c.oid, 'TRUNCATE'))),
 'table_owner', (select count(*) from pg_class c where pg_get_userbyid(c.relowner) = '{WRITER_ROLE}'),
 'branch_col_insert', has_column_privilege('{WRITER_ROLE}', 'public.visits', 'branch_id', 'INSERT'),
 'continued_col_insert', has_column_privilege('{WRITER_ROLE}', 'public.visits', 'continued_from_visit_id', 'INSERT'),
 'anon_exec', (select count(*) from pg_proc p where p.pronamespace='kamo_import'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')),
 'service_exec', (select count(*) from pg_proc p where p.pronamespace='kamo_import'::regnamespace and has_function_privilege('service_role', p.oid, 'EXECUTE')))"""))
    gate_ok = (gate['owner_ok'] and not gate['bypassrls'] and not gate['login'] and gate['set_members'] == 0 and not gate['reachable']
               and gate['schema_create'] == 0 and gate['table_udt'] == 0 and gate['table_owner'] == 0 and not gate['branch_col_insert']
               and not gate['continued_col_insert'] and gate['anon_exec'] == 0 and gate['service_exec'] == 0)
    record('Gerbang: pemilik, tanpa bypass/login, tanpa SET ROLE terjangkau, tanpa CREATE/UPDATE/DELETE/TRUNCATE, ACL kolom & fungsi', gate_ok, json.dumps(gate))
    for r in ('authenticator', 'authenticated', 'anon', 'service_role'):
        ok, msg = d.try_(f"set role {WRITER_ROLE};", user='authenticator') if r == 'authenticator' else d.try_(f"set role {r};\nset role {WRITER_ROLE};", user='authenticator')
        record(f'Gerbang: SET ROLE {WRITER_ROLE} dari sesi authenticator (sebagai {r}) ditolak', not ok, msg)


def actor_ident(sql, sub, claims, header=None):
    """Like actor(), but with explicit request.jwt.claim.sub / request.jwt.claims values (PostgREST GUCs)."""
    hdr = ("select set_config('request.headers', %s, false);\n" % q(json.dumps({'x-kamo-operational-branch': header}))
           if header else "select set_config('request.headers', '', false);\n")
    return ("set role authenticated;\nselect set_config('request.jwt.claim.role','authenticated',false);\n"
            f"select set_config('request.jwt.claim.sub', {q(sub)}, false);\nselect set_config('request.jwt.claims', {q(claims)}, false);\n"
            + hdr + sql)


def identity_cases(d):
    """kamo_import.uid_permintaan() must behave exactly like auth.uid(), including precedence and failures."""
    state = hosted_auth_state(d.db)
    record('Harness meniru batas auth hosted: pemilik terpisah, PUBLIC tanpa USAGE auth, PUBLIC EXECUTE auth.uid, '
           'authenticated USAGE tanpa grant option, sidik auth.uid sama dengan katalog hosted',
           state['schema_owner'] == 'supabase_auth_admin' and state['uid_owner'] == 'supabase_auth_admin' and not state['public_usage']
           and state['public_exec'] and state['authenticated_usage'] and state['authenticated_usage_grantable'] is False
           and state['fingerprint'] == AUTH_FP, json.dumps(state))
    w_auth = d.last(f"select has_schema_privilege('{WRITER_ROLE}', 'auth', 'USAGE')::text || '/' || "
                    f"has_function_privilege('{WRITER_ROLE}', 'auth.uid()', 'EXECUTE')::text")
    record('Role penulis tanpa USAGE skema auth (EXECUTE auth.uid hanya lewat PUBLIC, tidak bisa dipakai)', w_auth == 'false/true', w_auth)
    a, b = OWNER, ADMIN
    cases = [
        ('claim.sub menang atas claims.sub', a, json.dumps({'sub': b}), a),
        ('claim.sub kosong -> claims.sub', '', json.dumps({'sub': b}), b),
        ('identitas kosong/hilang -> NULL', '', '', ''),
        ('claims tanpa sub -> NULL', '', json.dumps({'role': 'authenticated'}), ''),
        ('claim.sub sah, claims rusak -> claim.sub (claims tidak dibaca, sama seperti auth.uid)', a, '{rusak', a),
        ('claim.sub bukan UUID -> galat, tidak jatuh ke claims', 'bukan-uuid', json.dumps({'sub': b}), 'ERROR'),
        ('claims JSON rusak -> galat', '', '{rusak', 'ERROR'),
        ('claims.sub bukan UUID -> galat', '', json.dumps({'sub': 'zz'}), 'ERROR'),
    ]
    for label, sub, claims, expect in cases:
        prefix = f"select set_config('request.jwt.claim.sub', {q(sub)}, false);\nselect set_config('request.jwt.claims', {q(claims)}, false);\n"
        got = []
        for fn in ('kamo_import.uid_permintaan()', 'auth.uid()'):
            # Marker prefix: an empty/NULL identity must not be confused with the previous output line.
            ok, out = d.try_(prefix + f"select 'uid=' || coalesce({fn}::text, '<null>');")
            got.append(out.removeprefix('uid=') if ok and out.startswith('uid=') else 'ERROR')
        want = expect or '<null>'
        record(f'Identitas: {label}', got[0] == got[1] == want, f'helper={got[0]!r} auth.uid={got[1]!r} expect={want!r}')
    # End to end through the private validator and the public RPC (header A).
    ok, out = d.try_(actor_ident(f"select public.import_legacy_medical_records_bulk({lit([base.row('wowo-test::identitas-claims')])});",
                                 '', json.dumps({'sub': OWNER}), BR_A))
    record('Identitas hanya di request.jwt.claims (OWNER, header A): impor massal tersimpan',
           ok and json.loads(out)[0]['status'] == 'tersimpan', out[:140])
    for label, sub, claims in (('identitas kosong', '', ''), ('claim.sub bukan UUID (claims berisi OWNER sah)', 'bukan-uuid', json.dumps({'sub': OWNER})),
                               ('claims JSON rusak', '', '{rusak'), ('OWNER nonaktif lewat claims', '', json.dumps({'sub': OWNER_OFF}))):
        ok, out = d.try_(actor_ident("select kamo_import.pastikan_pengimpor();", sub, claims, BR_A))
        ok2, out2 = d.try_(actor_ident(f"select kamo_import.simpan_riwayat_bersama({lit(base.row('wowo-test::identitas-tolak'))}, null, null);", sub, claims, BR_A))
        saved = d.last("select count(*) from public.visits where legacy_source_key='wowo-test::identitas-tolak'")
        record(f'Validator & penulis menolak: {label} (tanpa jatuh ke identitas lain, tidak menulis)', not ok and not ok2 and saved == '0',
               f'{out[:80]} | {out2[:60]}')


def branch_collision(d):
    """A historical import stored WITH branch B (20260907160000) must not leak to, or be duplicated by, a caller
    who cannot access B: no UUID/hash in any answer, nothing written, a generic hold. Authorized callers still
    deduplicate against it (sudah_ada / bentrok), and shared NULL history is unaffected (cases above)."""
    cust, pet, vid = uid('cust-kolisi-b'), uid('pet-kolisi-b'), uid('visit-kolisi-b')
    # Structured key (owner::phone::patient::sheet) so the 08/+62 equivalent lookup is exercised too.
    key08 = 'fiktif kolisi::08000000077::kucing kolisi::15012026'
    key62 = 'fiktif kolisi::628000000077::kucing kolisi::15012026'
    row08 = base.row(key08, owner='Fiktif Kolisi', phone='08000000077', patient='Kucing Kolisi')
    row62 = dict(row08, source_key=key62, phone='628000000077')
    d.sql(f"""insert into public.customers(id,name,phone) values ('{cust}','Fiktif Kolisi','08000000077');
insert into public.pets(id,customer_id,name) values ('{pet}','{cust}','Kucing Kolisi');
insert into public.visits(id,branch_id,customer_id,pet_id,poli,status,legacy_source_key,legacy_source_hash)
 values ('{vid}','{BR_B}','{cust}','{pet}','Poli Umum','Selesai',{q(key08)},public.import_legacy_row_hash({lit(row08)}));""")
    secret_hash = d.last(f"select legacy_source_hash from public.visits where id='{vid}'")
    count_sql = f"select count(*) from public.visits where public.import_legacy_source_key_canonical(legacy_source_key) = public.import_legacy_source_key_canonical({q(key08)})"

    def leaks(text):
        return vid in text or secret_hash in text

    d.sql("insert into public.role_capabilities(role, all_branches, create_accounts) values ('ADMIN', false, false) "
          "on conflict(role) do update set all_branches=false")
    for label, r in (('jejak persis', row08), ('jejak setara +62', row62)):
        ok, out = d.try_(actor(f"select coalesce(jsonb_agg(t), '[]') from kamo_import.cari_jejak({q(r['source_key'])}, {q(r['phone'])}) t;", ADMIN_A, BR_A))
        record(f'Kolisi cabang B ({label}), ADMIN_A all_branches=false header A: cari_jejak tanpa UUID/sidik B, hanya tanda terkunci',
               ok and not leaks(out) and json.loads(out) == [{'visit_id': None, 'existing_hash': None, 'terkunci': True}], out[:160])
        ok, out = d.try_(actor(f"select kamo_import.simpan_riwayat_bersama({lit(r)}, '{cust}', '{pet}');", ADMIN_A, BR_A))
        record(f'Kolisi cabang B ({label}): penulis langsung ditolak generik, tanpa UUID/sidik, tidak menulis',
               not ok and 'tidak bisa diakses' in out and not leaks(out) and d.last(count_sql) == '1', out[:160])
        ok, out = d.try_(actor(f"select {base.per_row_sql(r)};", ADMIN_A, BR_A))
        record(f'Kolisi cabang B ({label}): RPC per baris ditolak generik, tanpa UUID/sidik, tidak menulis',
               not ok and 'tidak bisa diakses' in out and not leaks(out) and d.last(count_sql) == '1', out[:160])
        ok, out = d.try_(actor(f"select public.import_legacy_medical_records_bulk({lit([r])});", ADMIN_A, BR_A))
        got = (json.loads(out) if ok else [{}])[0]
        record(f'Kolisi cabang B ({label}): RPC massal ditahan generik, visit_id kosong, tanpa UUID/sidik, tidak menulis',
               ok and got.get('status') == 'ditahan' and got.get('visit_id') is None and 'tidak bisa diakses' in (got.get('reason') or '')
               and not leaks(out) and d.last(count_sql) == '1', out[:200])
    # Changed content must not reveal more (no "bentrok" vs "belum terbukti" distinction) either.
    ok, out = d.try_(actor(f"select public.import_legacy_medical_records_bulk({lit([dict(row08, diagnosis='Isi lain')])});", ADMIN_A, BR_A))
    got = (json.loads(out) if ok else [{}])[0]
    record('Kolisi cabang B, isi berbeda: tetap alasan generik yang sama (tidak membedakan bentrok/belum terbukti)',
           ok and 'tidak bisa diakses' in (got.get('reason') or '') and 'bentrok' not in (got.get('reason') or '') and not leaks(out), out[:200])
    # OWNER with header A cannot access B either (header scopes the request): generic hold, not a duplicate.
    ok, out = d.try_(actor(f"select public.import_legacy_medical_records_bulk({lit([row08])});", OWNER, BR_A))
    got = (json.loads(out) if ok else [{}])[0]
    record('Kolisi cabang B, OWNER header A: ditahan generik, tidak menulis', ok and got.get('status') == 'ditahan' and not leaks(out)
           and d.last(count_sql) == '1', out[:200])

    # Authorized callers keep historical-key deduplication against B.
    for label, who, hdr, cap in (('OWNER header B', OWNER, BR_B, None), ('OWNER tanpa header', OWNER, None, None),
                                 ('ADMIN_A all_branches=true tanpa header', ADMIN_A, None, 'true')):
        if cap:
            d.sql(f"insert into public.role_capabilities(role, all_branches, create_accounts) values ('ADMIN', {cap}, false) "
                  "on conflict(role) do update set all_branches=excluded.all_branches")
        out = json.loads(d.last(actor(f"select public.import_legacy_medical_records_bulk({lit([row08, row62])});", who, hdr)))
        same = d.try_(actor(f"select {base.per_row_sql(row62)};", who, hdr))
        changed = json.loads(d.last(actor(f"select public.import_legacy_medical_records_bulk({lit([dict(row08, diagnosis='Isi lain')])});", who, hdr)))
        record(f'Kolisi cabang B, berhak ({label}): massal sudah_ada kunjungan B (persis & +62), per baris kunjungan B, isi beda bentrok; tidak menulis',
               [x['status'] for x in out] == ['sudah_ada', 'sudah_ada'] and all(x['visit_id'] == vid for x in out)
               and same == (True, vid) and changed[0]['status'] == 'ditahan' and 'bentrok' in (changed[0]['reason'] or '')
               and d.last(count_sql) == '1', f"{[x['status'] for x in out]} per_row={same[1][:40]} changed={changed[0]['status']}")
    d.sql("delete from public.role_capabilities where role='ADMIN'")


def concurrency(d, header):
    """Key races repeated with the active-branch header (deterministic barrier from the base harness)."""
    out = []
    psql = d.db.as_user + [d.db.psql, '-X', '-qAt', '-h', str(d.db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']
    h = base.Harness(d.db, psql)
    d.sql("create table if not exists public.harness_gate(id int primary key); insert into public.harness_gate values (1) on conflict do nothing;"
          "grant all on public.harness_gate to authenticated;")
    parsed = json.loads((ROOT / 'src/lib/__tests__/fixtures/impor-folder-hp-varian.json').read_text())
    cases = [('C1h dua impor jejak sama, cabang aktif', [base.row('wowo-test::c1h')], [base.row('wowo-test::c1h')], OWNER, ADMIN, 'advisory',
              "select count(*) from public.visits where legacy_source_key='wowo-test::c1h'"),
             ('C9h 08 dan +62 bersamaan, cabang aktif', [parsed[0]], [parsed[1]], OWNER, ADMIN, 'advisory',
              "select count(*) from public.visits where legacy_source_key in (%s)" % ','.join(q(r['source_key']) for r in parsed))]
    for name, ra, rb, wa, wb, wait, count_sql in cases:
        d.sql("delete from public.medical_records where visit_id in (select id from public.visits where legacy_source_key like 'wowo-test::c1h%' or legacy_source_key like 'fiktif satu::%');"
              "delete from public.visits where legacy_source_key like 'wowo-test::c1h%' or legacy_source_key like 'fiktif satu::%';")
        try:
            a_rc, b_rc, _ao, bo, waited = h.race(actor(f"select public.import_legacy_medical_records_bulk({lit(ra)});", wa, header),
                                                 actor(f"select public.import_legacy_medical_records_bulk({lit(rb)});", wb, header), wait)
        except base.SyncTimeout as error:
            record(name, False, f'BLOCKED {error}')
            continue
        n = d.last(count_sql)
        status = (base.last_json(bo) or [{}])[0].get('status')
        record(name, a_rc == 0 and b_rc == 0 and waited and status == 'sudah_ada' and n == '1', f'B waited={waited} B={status} visits={n}')


def fresh_without_new(pg_bin, raw):
    """Bootstrap every repo migration except the new one and its dependents (the caller applies it under test)."""
    import tempfile
    raw.sql("create role authenticator login noinherit;")
    # The repo tree is never touched: the bootstrap reads a temp root holding links to every other migration.
    with tempfile.TemporaryDirectory(prefix='kamo-mig-') as tmp:
        mig = Path(tmp) / 'supabase/migrations'
        mig.mkdir(parents=True)
        for f in (ROOT / 'supabase/migrations').glob('*.sql'):
            if f.name != NEW_MIGRATION and f.name not in DEPENDENT_MIGRATIONS:
                (mig / f.name).symlink_to(f)
        saved, base.fixture.ROOT = base.fixture.ROOT, Path(tmp)
        try:
            base.fixture.DisposablePostgres.bootstrap(raw)
        finally:
            base.fixture.ROOT = saved
    raw.sql("grant anon, authenticated, service_role to authenticator;")
    hosted_auth(raw)


# Supabase hosted auth boundary (catalog read 2026-10-29): schema `auth` and auth.uid() belong to a separate
# role; PUBLIC has EXECUTE on auth.uid() but no USAGE on schema auth; runner/authenticated hold USAGE WITHOUT
# grant option. auth.uid() text is the hosted one (shared fixture), md5(pg_get_functiondef) = AUTH_FP.
AUTH_FP = 'ea3b41bf29e2ad573067939329aa088e'


def hosted_auth(raw):
    # auth.uid() itself (text + separate owner) comes from supabase/tests/fixtures/hosted_auth_uid.sql via the shared
    # fixture bootstrap; here the schema owner and ACLs are tightened to the hosted state.
    raw.sql("""alter schema auth owner to supabase_auth_admin;
revoke all on schema auth from public;
revoke all on function auth.uid() from public, anon, authenticated, service_role;
grant execute on function auth.uid() to public;""")


def hosted_auth_state(raw):
    return json.loads(raw.sql(f"""select json_build_object(
 'schema_owner', (select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'auth'),
 'uid_owner', (select pg_get_userbyid(proowner) from pg_proc where oid = 'auth.uid()'::regprocedure),
 'public_usage', exists(select 1 from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                        where n.nspname = 'auth' and a.grantee = 0 and a.privilege_type = 'USAGE'),
 'public_exec', exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where p.oid = 'auth.uid()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
 'authenticated_usage_grantable', (select bool_or(a.is_grantable) from pg_namespace n cross join lateral aclexplode(n.nspacl) a
                                   where n.nspname = 'auth' and a.grantee = 'authenticated'::regrole and a.privilege_type = 'USAGE'),
 'authenticated_usage', has_schema_privilege('authenticated', 'auth', 'USAGE'),
 'fingerprint', md5(pg_get_functiondef('auth.uid()'::regprocedure)))"""))


def leftovers(raw, before):
    return raw.sql("select (to_regnamespace('kamo_import') is null)::text || '/' || "
                   "(not exists(select 1 from pg_policy where polname like 'riwayat_bersama_terkunci_%%'))::text || '/' || "
                   "(md5(pg_get_functiondef('public.import_legacy_medical_records_bulk(jsonb)'::regprocedure)) = %s)::text" % q(before))


def apply_new(raw, user='postgres'):
    sql = "begin;\n" + MIGRATION_FILE.read_text() + "\ncommit;"
    r = subprocess.run(raw.as_user + [raw.psql, '-X', '-qAt', '-h', str(raw.root), '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                       input=sql, text=True, capture_output=True, env={**os.environ, 'PSQLRC': '/dev/null'})
    errors = [l for l in (r.stderr or '').splitlines() if l.startswith('ERROR') or l.startswith('psql:')]
    return r.returncode == 0, (errors[0] if errors else r.stderr.strip()[:200]), r.stderr


def gate_rollback(pg_bin):
    """The migration must fail closed and leave nothing behind when a precondition or the post-check fails."""
    from native_postgres import NativePostgres
    hostile = [
        ('definisi auth.uid() berubah (urutan klaim ditukar)',
         "create or replace function auth.uid() returns uuid language sql stable as $f$ select coalesce("
         "(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), "
         "nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid $f$;",
         f"select count(*)::text from pg_roles where rolname='{WRITER_ROLE}'", '0'),
        ('volatilitas auth.uid() berubah (VOLATILE)', "alter function auth.uid() volatile;",
         f"select count(*)::text from pg_roles where rolname='{WRITER_ROLE}'", '0'),
        ('auth.uid() menjadi SECURITY DEFINER', "alter function auth.uid() security definer;",
         f"select count(*)::text from pg_roles where rolname='{WRITER_ROLE}'", '0'),
        ('role penulis sudah ada dengan BYPASSRLS', f"create role {WRITER_ROLE} nologin bypassrls;", f"select rolbypassrls::text from pg_roles where rolname='{WRITER_ROLE}'", 'true'),
        ('PUBLIC punya CREATE di skema public (pasca-cek skema)', "grant create on schema public to public;", f"select count(*)::text from pg_roles where rolname='{WRITER_ROLE}'", '0'),
        ('trigger invoker baru pada visits (pasca-cek trigger)',
         "create function public.harness_invoker_trg() returns trigger language plpgsql as $$begin return new; end$$;"
         "create trigger harness_invoker_trg before insert on public.visits for each row execute function public.harness_invoker_trg();",
         f"select count(*)::text from pg_roles where rolname='{WRITER_ROLE}'", '0'),
    ]
    for label, setup, role_sql, role_expect in hostile:
        with NativePostgres(pg_bin) as raw:
            fresh_without_new(pg_bin, raw)
            raw.sql(setup)
            before = raw.sql("select md5(pg_get_functiondef('public.import_legacy_medical_records_bulk(jsonb)'::regprocedure))")
            ok, msg, _ = apply_new(raw)
            left = leftovers(raw, before)
            role_state = raw.sql(role_sql)
            record(f'Gerbang rollback: {label} → migrasi gagal, tanpa sisa (skema, kebijakan D2), RPC lama utuh',
                   not ok and left == 'true/true/true' and role_state == role_expect, f'failed={not ok} left={left} role={role_state} {msg[:110]}')


def hosted_emulation(pg_bin, after=None):
    """Runner like Supabase `postgres`: NOT superuser, CREATEROLE + BYPASSRLS, owns the tables it changes.

    Proves the ownership transfer + post-check work for a non-superuser runner (SET membership, temporary
    CREATE, revoke granted-by-runner, the creator's leftover ADMIN-only membership). It does NOT prove hosted
    Supabase specifics (supautils, real grants on auth, default privileges); those stay an operational gate.
    `after(raw)` (optional) runs on the same cluster afterwards, for harnesses of migrations built on this one.
    """
    from native_postgres import NativePostgres
    with NativePostgres(pg_bin) as raw:
        fresh_without_new(pg_bin, raw)
        tables = ['visits', 'medical_records', 'customers', 'pets', 'profiles', 'compounding_recipes', 'consents', 'inpatient_records',
                  'inpatient_medications', 'bookings', 'invoices', 'prescription_items', 'compounding_ingredients', 'inpatient_daily_logs',
                  'inpatient_status_log', 'inpatient_med_doses', 'visit_operational_events', 'visit_referrals', 'follow_ups',
                  'clinic_record_addenda', 'clinic_record_corrections', 'invoice_edit_log']
        raw.sql("create role mig_emul login createrole bypassrls;\n"
                "grant create on database postgres to mig_emul;\n"
                # Like hosted `postgres`: USAGE on auth WITHOUT grant option; auth.uid() only through PUBLIC.
                "grant usage on schema auth to mig_emul;\n"
                + ''.join(f"alter table public.{t} owner to mig_emul;\n" for t in tables)
                + "alter function public.import_legacy_medical_records_bulk(jsonb) owner to mig_emul;\n"
                "alter function public.import_legacy_medical_record_resolved(text,text,timestamptz,text,text,text,text,text,text,text,date,text,text,text,text,text,text,uuid,uuid) owner to mig_emul;\n"
                "grant execute on function public.user_can_access_branch(uuid), public.indonesian_phone_key(text), public.import_legacy_text_key(text),"
                " public.import_legacy_phone_key(text), public.import_legacy_row_hash(jsonb), public.import_legacy_source_key_canonical(text),"
                " public.import_legacy_source_match(text,text), public.import_legacy_source_ambiguous_reason(),"
                " public.import_legacy_source_conflict_reason(text), public.customer_identity_lock(text) to mig_emul with grant option;\n"
                "grant usage, create on schema public to mig_emul;\n")
        is_super = raw.sql("select rolsuper::text from pg_roles where rolname='mig_emul'")
        ok, msg, stderr = apply_new(raw, user='mig_emul')
        warnings = [l for l in stderr.splitlines() if 'WARNING' in l]
        record('Emulasi hosted: runner non-superuser (CREATEROLE BYPASSRLS) memasang migrasi, pasca-cek lulus',
               ok and is_super == 'false', f'ok={ok} super={is_super} warnings={len(warnings)} {msg[:150]}')
        if not ok:
            return
        state = json.loads(raw.sql(f"""select json_build_object(
 'owner', (select string_agg(distinct pg_get_userbyid(proowner), ',') from pg_proc where pronamespace='kamo_import'::regnamespace),
 'runner_membership', (select json_agg(json_build_object('admin', admin_option, 'set', set_option, 'inherit', inherit_option, 'grantor', pg_get_userbyid(grantor)))
                       from pg_auth_members where roleid='{WRITER_ROLE}'::regrole and member='mig_emul'::regrole),
 'runner_can_set', pg_has_role('mig_emul', '{WRITER_ROLE}', 'SET'),
 'schema_create', has_schema_privilege('{WRITER_ROLE}', 'kamo_import', 'CREATE'))"""))
        membership = state['runner_membership'] or []
        record('Emulasi hosted: pemilik = role; runner hanya tersisa ADMIN tanpa SET/INHERIT; role tanpa CREATE',
               state['owner'] == WRITER_ROLE and not state['runner_can_set'] and not state['schema_create']
               and all(not m['set'] and not m['inherit'] for m in membership), json.dumps(state))
        r = subprocess.run(raw.as_user + [raw.psql, '-X', '-qAt', '-h', str(raw.root), '-U', 'mig_emul', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                           input=f"set role {WRITER_ROLE};", text=True, capture_output=True, env={**os.environ, 'PSQLRC': '/dev/null'})
        record('Emulasi hosted: runner tidak bisa SET ROLE ke role penulis sesudah migrasi', r.returncode != 0, (r.stderr.strip().splitlines() or [''])[0][:120])
        if after:
            after(raw)   # later migrations' harnesses continue on the same non-superuser runner


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--pg-bin', required=True, help='PostgreSQL bin dir for a native throwaway cluster')
    parser.add_argument('--json', type=Path)
    parser.add_argument('--migration', type=Path, help='Apply this file instead of the repo migration (mutation checks only)')
    args = parser.parse_args()
    global MIGRATION_FILE
    if args.migration:
        MIGRATION_FILE = args.migration.resolve()
    sys.path.insert(0, str(ROOT / 'scripts'))
    from native_postgres import NativePostgres
    with NativePostgres(args.pg_bin) as db:
        # Every other migration, then the one under test. PostgREST's login role is emulated before
        # migrations so the gate can see it.
        fresh_without_new(args.pg_bin, db)
        if MIGRATION_FILE.exists():
            ok, msg, _ = apply_new(db)
            record('Migrasi baru terpasang di atas semua migrasi repo (gerbang pasca-cek lulus)', ok, msg[:160] if not ok else MIGRATION_FILE.name)
        d = Db(db)
        h = base.Harness(db, None)
        base.bootstrap_fixture(h)
        bootstrap(d)
        have_writer = d.last("select to_regnamespace('kamo_import') is not null") == 't'
        run_cases(d, have_writer)
        if have_writer:
            concurrency(d, BR_A)
    if MIGRATION_FILE.exists():
        gate_rollback(args.pg_bin)
        hosted_emulation(args.pg_bin)
    else:
        record('Gerbang rollback: migrasi baru ada', False, 'migration file missing', 'not implemented yet')
    fails = [r for r in RESULTS if r['status'] != 'PASS']
    print(f"TOTAL pass={len(RESULTS) - len(fails)} fail={len(fails)}", flush=True)
    if args.json:
        args.json.write_text(json.dumps({'results': RESULTS}, indent=2))
    sys.exit(0 if not fails else 1)


if __name__ == '__main__':
    main()
