#!/usr/bin/env python3
"""RS-2 shared-history readers (customer → pet → history → detail) — fictional regression harness.

Covers design docs/desain-rs2-riwayat-bersama-hewan.md on a throwaway PostgreSQL, on top of every repo migration
and 20261101120000 (D1/D2/RS-1):
  * public.riwayat_bersama_hewan / public.detail_riwayat_bersama (INVOKER) → kamo_import readers owned by the
    NOLOGIN NOBYPASSRLS writer role; only branch-NULL + legacy-key visits whose customer owns the pet.
  * OWNER active only; header (when present) must be an active, accessible branch; nothing else changes.
  * no new table/column grants, no policy change, older kamo_import functions/ACLs untouched (catalog snapshot),
    the migration fails closed on mutants and hostile preconditions, and works for a non-superuser runner.

Every actor runs as role `authenticated` with a fictional JWT `sub` and, where stated, the `request.headers` the
Next.js server sends. Never accepts a database URL, never connects to Production. All rows are fictional.

Usage:
  python3 scripts/test-riwayat-bersama-hewan-postgres.py --pg-bin DIR [--json OUT] [--migration MUTANT.sql]
Exit status: 0 only when every case passes.
"""
from datetime import datetime, timedelta
from pathlib import Path
import argparse
import importlib.util
import json
import os
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('rls', ROOT / 'scripts/test-impor-rekam-medis-rls-postgres.py')
rls = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rls)

RS2 = ROOT / 'supabase/migrations/20261104010000_rs2_riwayat_bersama_hewan.sql'
OWNER, ADMIN, ADMIN_A, DOCTOR, FINANCE, STAFF, OWNER_OFF = (rls.OWNER, rls.ADMIN, rls.ADMIN_A, rls.DOCTOR, rls.FINANCE,
                                                           rls.STAFF, rls.OWNER_OFF)
BR_A, BR_B, BR_C = rls.BR_A, rls.BR_B, rls.BR_C
record, actor, q = rls.record, rls.actor, rls.q
WRITER = rls.WRITER_ROLE
NEW_FUNCS = ('pastikan_pembaca_riwayat_bersama', 'baca_riwayat_bersama_hewan', 'baca_detail_riwayat_bersama')


def fid(n):
    return 'f9000000-0000-4000-8000-%012d' % n


# Customers / pets
CS, CO, CB, CD = fid(1), fid(2), fid(3), fid(4)
PS, PB, PP, PD, PO = fid(11), fid(12), fid(13), fid(14), fid(15)
# Visits on PS (the UAT shape: two shared imports + branch rows + rows that must stay hidden)
S1, S2, A1, B1, X1, N1, M0 = fid(21), fid(22), fid(23), fid(24), fid(25), fid(26), fid(27)
A2, B2 = fid(31), fid(32)          # PB: branch-only pet
DV, MR_LO, MR_HI = fid(41), fid(42), fid(43)   # PD: one shared visit with two medical records
PAGE_N = 205                       # PP: pagination pet
RANDOM = '00000000-0000-4000-8000-000000000999'


def apply_sql(raw, text, user='postgres'):
    r = subprocess.run(raw.as_user + [raw.psql, '-X', '-qAt', '-h', str(raw.root), '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                       input="begin;\n" + text + "\ncommit;", text=True, capture_output=True, env={**os.environ, 'PSQLRC': '/dev/null'})
    errors = [l for l in (r.stderr or '').splitlines() if l.startswith('ERROR') or l.startswith('psql:')]
    return r.returncode == 0, (errors[0] if errors else r.stderr.strip()[:200])


def seed(d):
    def visit(vid, branch, cust, pet, at, legacy, dokter='drh. Fiktif', keluhan='Keluhan fiktif'):
        b = 'null' if branch is None else q(branch)
        k = 'null' if not legacy else q(f'wowo-test::rs2-{vid}')
        h = 'null' if not legacy else q(f'hash-{vid}')
        return (f"insert into public.visits(id,branch_id,customer_id,pet_id,poli,status,created_at,dokter,keluhan,legacy_source_key,legacy_source_hash)"
                f" values ('{vid}',{b},'{cust}','{pet}','Poli Umum','Selesai',{q(at)},{q(dokter)},{q(keluhan)},{k},{h});\n")

    def mr(vid, diag, mid=None, terapi=None, gejala=None, anam=None):
        cols = "visit_id,diagnosis,anamnesis,gejala_klinis,catatan_resep" + (",id" if mid else "")
        vals = f"'{vid}',{q(diag)},{q(anam or 'Anamnesis ' + diag)},{q(gejala or 'Gejala ' + diag)},{q(terapi or 'Terapi ' + diag)}" + (f",'{mid}'" if mid else "")
        return f"insert into public.medical_records({cols}) values ({vals});\n"

    sql = ["set session_replication_role = replica;\n",
           f"insert into public.customers(id,name,phone) values ('{CS}','UJI PEMILIK RS2','0800009001'),('{CO}','UJI PEMILIK LAIN','0800009002'),"
           f"('{CB}','UJI PEMILIK CABANG','0800009003'),('{CD}','UJI PEMILIK DUA MR','0800009004');\n",
           f"insert into public.pets(id,customer_id,name) values ('{PS}','{CS}','UJI KUCING RS2'),('{PB}','{CB}','UJI KUCING CABANG'),"
           f"('{PP}','{CS}','UJI KUCING HALAMAN'),('{PD}','{CD}','UJI KUCING DUA MR'),('{PO}','{CO}','UJI KUCING LAIN');\n",
           visit(S1, None, CS, PS, '2026-01-14 17:00:00+00', True, 'drh. Satu', 'Keluhan satu'),
           mr(S1, 'UJI DIAGNOSIS 1', terapi='UJI TERAPI 1', gejala='UJI GEJALA 1', anam='UJI ANAMNESIS 1'),
           visit(S2, None, CS, PS, '2026-01-15 17:00:00+00', True, 'drh. Dua', 'Keluhan dua'),
           mr(S2, 'UJI DIAGNOSIS 2', terapi='UJI TERAPI 2', gejala='UJI GEJALA 2', anam='UJI ANAMNESIS 2'),
           visit(A1, BR_A, CS, PS, '2026-02-01 01:00:00+00', False), mr(A1, 'CABANG A RAHASIA'),
           visit(B1, BR_B, CS, PS, '2026-02-02 01:00:00+00', False), mr(B1, 'CABANG B RAHASIA'),
           visit(X1, None, CO, PS, '2026-01-20 01:00:00+00', True), mr(X1, 'BOCOR SILANG'),
           visit(N1, None, CS, PS, '2026-01-21 01:00:00+00', False), mr(N1, 'TANPA JEJAK'),
           visit(M0, None, CS, PS, '2026-01-22 01:00:00+00', True),
           visit(A2, BR_A, CB, PB, '2026-03-01 01:00:00+00', False), mr(A2, 'HANYA CABANG A'),
           visit(B2, BR_B, CB, PB, '2026-03-02 01:00:00+00', True), mr(B2, 'HANYA CABANG B'),
           visit(DV, None, CD, PD, '2026-04-01 01:00:00+00', True),
           mr(DV, 'MR PERTAMA', mid=MR_LO), mr(DV, 'MR KEDUA', mid=MR_HI)]
    for i in range(PAGE_N):
        v = fid(1000 + i)
        at = (datetime(2025, 1, 1) + timedelta(hours=i)).strftime('%Y-%m-%d %H:%M:%S+00')
        sql.append(visit(v, None, CS, PP, at, True))
        sql.append(mr(v, f'HALAMAN {i}'))
    sql.append("set session_replication_role = origin;\n")
    d.sql(''.join(sql))


def daftar(pet, dari=0, jumlah=200):
    return (f"select coalesce(json_agg(json_build_object('v',visit_id,'p',pet_id,'c',customer_id,'t',tanggal,'dok',dokter,'kel',keluhan,"
            f"'dx',diagnosis,'an',anamnesis,'gk',gejala_klinis,'tx',terapi)),'[]') from public.riwayat_bersama_hewan({q(pet) if pet else 'null'},{dari},{jumlah});")


def detail(visit):
    return (f"select coalesce(json_agg(json_build_object('v',visit_id,'p',pet_id,'c',customer_id,'t',tanggal,'dok',dokter,'kel',keluhan,"
            f"'dx',diagnosis,'an',anamnesis,'gk',gejala_klinis,'tx',terapi)),'[]') from public.detail_riwayat_bersama({q(visit) if visit else 'null'});")


def run_json(d, sql, who, header=None):
    ok, out = d.try_(actor(sql, who, header))
    return ok, (json.loads(out) if ok else out)


def catalog_snapshot(d):
    return d.last(f"""select md5(concat_ws('#',
 (select string_agg(c.oid::regclass::text||':'||a.privilege_type, ',' order by c.oid::regclass::text, a.privilege_type)
    from pg_class c cross join lateral aclexplode(c.relacl) a where a.grantee='{WRITER}'::regrole),
 (select string_agg(c.oid::regclass::text||'.'||att.attname||':'||a.privilege_type, ',' order by c.oid::regclass::text, att.attname, a.privilege_type)
    from pg_attribute att join pg_class c on c.oid=att.attrelid cross join lateral aclexplode(att.attacl) a where a.grantee='{WRITER}'::regrole),
 (select string_agg(pol.polrelid::regclass::text||pol.polname||pol.polcmd::text||pol.polpermissive::text||coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')
    ||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),'')||pol.polroles::text, E'\\n' order by pol.polrelid::regclass::text, pol.polname)
    from pg_policy pol join pg_class c on c.oid=pol.polrelid where c.relnamespace='public'::regnamespace),
 (select string_agg(p.oid::regprocedure::text||pg_get_userbyid(p.proowner)||coalesce(p.proacl::text,'')||md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)
    from pg_proc p where (p.pronamespace='kamo_import'::regnamespace and p.proname not in {NEW_FUNCS!r})
      or p.oid in ('public.user_can_access_branch(uuid)'::regprocedure,'public.hasil_impor_rekam_medis(text[])'::regprocedure,
                   'public.import_legacy_medical_records_bulk(jsonb)'::regprocedure)),
 (select string_agg(m.member::regrole::text||m.roleid::regrole::text||m.admin_option||m.set_option||m.inherit_option||m.grantor::regrole::text, ',' order by m.member::regrole::text, m.roleid::regrole::text, m.grantor::regrole::text)
    from pg_auth_members m where m.roleid='{WRITER}'::regrole or m.member='{WRITER}'::regrole),
 (select concat_ws('|',rolsuper,rolinherit,rolcanlogin,rolbypassrls,rolcreaterole) from pg_roles where rolname='{WRITER}')))""")


def leftovers(d):
    return d.last("select (to_regprocedure('public.riwayat_bersama_hewan(uuid,integer,integer)') is null"
                  " and to_regprocedure('public.detail_riwayat_bersama(uuid)') is null"
                  " and (select count(*) from pg_proc where pronamespace='kamo_import'::regnamespace)=14)::text")


# --------------------------------------------------------------------------- mutants (fail closed, nothing left)
def mutants(d, base_text):
    def sub(old, new):
        # First occurrence only: the post-check gate quotes some of these fragments and must stay intact.
        assert old in base_text, old
        return base_text.replace(old, new, 1)
    cases = [
        ('validator tanpa cek OWNER', sub("p.is_active and p.role = 'OWNER'", "p.is_active")),
        ('validator tanpa cek header', sub("if v_header is not null and public.user_can_access_branch(v_header::uuid) is not true then",
                                           "if false then")),
        ('pembaca tanpa syarat tanpa-cabang', sub("v.branch_id is null and v.legacy_source_key is not null", "v.legacy_source_key is not null")),
        ('pembaca tanpa relasi pelanggan↔hewan', sub("join public.pets p on p.id = v.pet_id and p.customer_id = v.customer_id",
                                                     "join public.pets p on p.id = v.pet_id")),
        ('pembaca detail tanpa validasi', base_text.replace(
            "  perform kamo_import.pastikan_pembaca_riwayat_bersama();\n  if p_visit is null then",
            "  if p_visit is null then")),
        ('batas jumlah dilonggarkan', sub("p_jumlah not between 1 and 200", "p_jumlah not between 1 and 5000")),
        ('pembaca VOLATILE', base_text.replace(
            "returns table(visit_id uuid, pet_id uuid, customer_id uuid, tanggal timestamptz, dokter text, keluhan text,\n"
            "              diagnosis text, anamnesis text, gejala_klinis text, terapi text)\nlanguage plpgsql stable security definer",
            "returns table(visit_id uuid, pet_id uuid, customer_id uuid, tanggal timestamptz, dokter text, keluhan text,\n"
            "              diagnosis text, anamnesis text, gejala_klinis text, terapi text)\nlanguage plpgsql volatile security definer", 1)),
        ('pembungkus publik SECURITY DEFINER', sub(
            "language sql stable security invoker set search_path = '' as $$\n  select * from kamo_import.baca_detail_riwayat_bersama",
            "language sql stable security definer set search_path = '' as $$\n  select * from kamo_import.baca_detail_riwayat_bersama")),
        ('EXECUTE ke anon', base_text.replace("-- 7. Pindah pemilik",
                                              "grant execute on function public.detail_riwayat_bersama(uuid) to anon;\n-- 7. Pindah pemilik")),
        ('validator diberikan ke authenticated', base_text.replace("-- 7. Pindah pemilik",
            "grant execute on function kamo_import.pastikan_pembaca_riwayat_bersama() to authenticated;\n-- 7. Pindah pemilik")),
        ('hak kolom baru untuk role penulis', base_text.replace("-- 7. Pindah pemilik",
            f"grant select (address) on public.customers to {WRITER};\n-- 7. Pindah pemilik")),
        ('kebijakan SELECT luas baru', base_text.replace("-- 7. Pindah pemilik",
            "create policy rs2_luas on public.visits for select to authenticated using (branch_id is null);\n-- 7. Pindah pemilik")),
        ('fungsi akses cabang diubah', base_text.replace("-- 7. Pindah pemilik",
            "create or replace function public.user_can_access_branch(b uuid) returns boolean language sql security definer stable set search_path='' as $x$ select true $x$;\n-- 7. Pindah pemilik")),
        ('role penulis tetap bisa di-SET runner', sub(
            "  execute format('revoke kamo_legacy_import_writer from %I granted by %I', v_runner, v_runner);\n", "")),
        ('prasyarat: auth.uid() berubah', "create or replace function auth.uid() returns uuid language sql stable as $f$ select coalesce("
         "(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid $f$;\n"
         + base_text),
        ('prasyarat: kebijakan baca role penulis hilang', f"drop policy kamo_import_baca on public.pets;\n" + base_text),
    ]
    before = catalog_snapshot(d)
    for label, text in cases:
        assert text != base_text, label
        ok, msg = apply_sql(d.db, text)
        left = leftovers(d)
        same = catalog_snapshot(d) == before
        record(f'Gerbang RS-2 mutan: {label} → migrasi batal, tanpa sisa, katalog lama utuh',
               not ok and left == 'true' and same, f'failed={not ok} clean={left} same={same} {msg[:120]}')


# --------------------------------------------------------------------------- cases after RS-2 is installed
def cases(d, before_snapshot):
    expect_s = [  # newest first, exact UAT-shaped content
        {'v': S2, 'p': PS, 'c': CS, 'dok': 'drh. Dua', 'kel': 'Keluhan dua', 'dx': 'UJI DIAGNOSIS 2', 'an': 'UJI ANAMNESIS 2', 'gk': 'UJI GEJALA 2', 'tx': 'UJI TERAPI 2'},
        {'v': S1, 'p': PS, 'c': CS, 'dok': 'drh. Satu', 'kel': 'Keluhan satu', 'dx': 'UJI DIAGNOSIS 1', 'an': 'UJI ANAMNESIS 1', 'gk': 'UJI GEJALA 1', 'tx': 'UJI TERAPI 1'}]
    strip = lambda rows: [{k: v for k, v in r.items() if k != 't'} for r in rows]

    record('Katalog lama (hak role penulis, kebijakan public, fungsi kamo_import lama, keanggotaan) identik setelah RS-2',
           catalog_snapshot(d) == before_snapshot, 'snapshot md5 equal')

    for header, label in ((BR_A, 'cabang aktif A'), (None, 'Semua cabang (tanpa header)')):
        ok, rows = run_json(d, daftar(PS), OWNER, header)
        record(f'OWNER {label}: daftar hewan = tepat 2 riwayat bersama, terbaru dulu, isi klinis & terapi (catatan_resep) benar',
               ok and strip(rows) == expect_s and [r['t'][:10] for r in rows] == ['2026-01-15', '2026-01-14'], str(rows)[:200])
        for want in expect_s:
            ok, rows = run_json(d, detail(want['v']), OWNER, header)
            record(f'OWNER {label}: detail {want["dx"]} = 1 baris, pet/customer cocok, isi persis',
                   ok and strip(rows) == [want], str(rows)[:200])
        for vid, what in ((A1, 'kunjungan cabang A'), (B1, 'kunjungan cabang B'), (B2, 'kunjungan cabang B berjejak'),
                          (RANDOM, 'UUID acak'), (X1, 'tautan silang pelanggan≠pemilik hewan'), (N1, 'tanpa cabang tanpa jejak'),
                          (M0, 'tanpa rekam medis')):
            ok, rows = run_json(d, detail(vid), OWNER, header)
            record(f'OWNER {label}: detail {what} → kosong (identik dengan tidak ada, tanpa metadata)', ok and rows == [], str(rows)[:120])
        ok, rows = run_json(d, daftar(PB), OWNER, header)
        record(f'OWNER {label}: hewan yang hanya punya riwayat bercabang → daftar kosong', ok and rows == [], str(rows)[:120])
        ok, rows = run_json(d, daftar(PO), OWNER, header)
        record(f'OWNER {label}: hewan pelanggan lain tidak mewarisi tautan silang', ok and rows == [], str(rows)[:120])

    ok, rows = run_json(d, daftar(PD), OWNER, BR_A)
    record('Dua rekam medis pada satu kunjungan → tetap satu baris (rekam medis id terkecil)',
           ok and len(rows) == 1 and rows[0]['v'] == DV and rows[0]['dx'] == 'MR PERTAMA', str(rows)[:160])

    # Pagination: stable order, no overlap, nothing lost, exact page sizes; overflow probe beyond the end is empty.
    ok1, p1 = run_json(d, daftar(PP, 0, 200), OWNER, BR_A)
    ok2, p2 = run_json(d, daftar(PP, 200, 200), OWNER, BR_A)
    ok3, p3 = run_json(d, daftar(PP, 205, 1), OWNER, BR_A)
    ok4, p4 = run_json(d, daftar(PP, 1000, 1), OWNER, BR_A)
    ids = [r['v'] for r in (p1 if ok1 else []) + (p2 if ok2 else [])]
    expected = [fid(1000 + i) for i in reversed(range(PAGE_N))]
    record('Paginasi 205 baris: 200 + 5, urutan stabil (terbaru dulu), tanpa tumpang-tindih/hilang; halaman sesudah akhir kosong',
           ok1 and ok2 and ok3 and ok4 and len(p1) == 200 and len(p2) == 5 and ids == expected and p3 == [] and p4 == [],
           f'p1={len(p1) if ok1 else p1} p2={len(p2) if ok2 else p2} p3={p3} p4={p4}')
    ok, rows = run_json(d, daftar(PP, 10000, 1), OWNER, BR_A)
    record('Batas atas sah: halaman 10000 jumlah 1 diterima (kosong)', ok and rows == [], str(rows)[:100])

    for dari, jumlah in ((-1, 10), (10001, 1), (0, 0), (0, 201), ('null', 10), (0, 'null')):
        ok, msg = d.try_(actor(daftar(PS, dari, jumlah), OWNER, BR_A))
        record(f'Batas ditolak: dari={dari} jumlah={jumlah} → 22023', not ok and 'halaman 0–10000' in msg, msg[:100])
    ok, msg = d.try_(actor(daftar(None), OWNER, BR_A))
    record('Hewan NULL ditolak', not ok and 'Hewan wajib diisi' in msg, msg[:100])
    ok, msg = d.try_(actor(detail(None), OWNER, BR_A))
    record('Kunjungan NULL ditolak', not ok and 'Kunjungan wajib diisi' in msg, msg[:100])

    # Roles other than active OWNER: refused before any row is read, whatever the header.
    for who, label in ((ADMIN, 'ADMIN semua cabang'), (ADMIN_A, 'ADMIN cabang A'), (DOCTOR, 'DOCTOR'), (FINANCE, 'FINANCE'),
                       (STAFF, 'STAFF'), (OWNER_OFF, 'OWNER nonaktif'), ('f7000000-0000-4000-8000-00000000dead', 'JWT tanpa profil')):
        for header in (BR_A, None):
            res = [d.try_(actor(s, who, header)) for s in (daftar(PS), detail(S1))]
            record(f'{label} ({"header A" if header else "tanpa header"}): kedua pembaca ditolak 42501',
                   all(not ok and 'hanya untuk OWNER aktif' in m for ok, m in res), ' | '.join(m[:60] for _, m in res))
    ok, msg = d.try_("set role authenticated;\nselect set_config('request.jwt.claim.sub','',false);\nselect set_config('request.headers','',false);\n" + daftar(PS))
    record('authenticated tanpa JWT sub ditolak', not ok and 'hanya untuk OWNER aktif' in msg, msg[:100])
    for fn in (daftar(PS), detail(S1)):
        ok, msg = d.try_("set role anon;\n" + fn)
        record('anon tidak bisa memanggil pembungkus', not ok and 'permission denied' in msg, msg[:100])
    ok, msg = d.try_(actor("select kamo_import.pastikan_pembaca_riwayat_bersama();", OWNER, BR_A))
    record('Validator privat tidak bisa dipanggil langsung oleh authenticated', not ok and 'permission denied' in msg, msg[:100])
    ok, rows = run_json(d, daftar(PS).replace('public.riwayat_bersama_hewan', 'kamo_import.baca_riwayat_bersama_hewan'), ADMIN, BR_A)
    record('Pembaca privat dipanggil langsung tetap memvalidasi (ADMIN ditolak)', not ok and 'hanya untuk OWNER aktif' in str(rows), str(rows)[:100])

    # Headers: never removed; invalid/inaccessible ones refuse.
    for header, label, needle in ((BR_C, 'cabang nonaktif', 'Cabang aktif tidak valid'), (RANDOM, 'cabang tidak ada', 'Cabang aktif tidak valid'),
                                  ('bukan-uuid', 'UUID rusak', 'invalid input syntax')):
        ok, msg = d.try_(actor(daftar(PS), OWNER, header))
        record(f'OWNER header {label} → ditolak', not ok and needle in msg, msg[:100])
    ok, msg = d.try_("set role authenticated;\nselect set_config('request.jwt.claim.role','authenticated',false);\n"
                     f"select set_config('request.jwt.claim.sub','{OWNER}',false);\nselect set_config('request.headers','{{rusak',false);\n" + daftar(PS))
    record('OWNER header JSON rusak → ditolak', not ok and 'invalid input syntax' in msg, msg[:100])

    # RLS normal unchanged: direct SELECT under an active header still hides shared rows; without header OWNER sees them.
    direct = (f"select count(*) from public.visits v where v.pet_id='{PS}' and v.branch_id is null and v.legacy_source_key is not null"
              f" and exists(select 1 from public.medical_records m where m.visit_id=v.id);")
    a = d.try_(actor(direct, OWNER, BR_A))
    n = d.try_(actor(direct, OWNER, None))
    doc = d.try_(actor(direct, DOCTOR, None))
    record('Kontrol: SELECT langsung OWNER header A tetap 0; tanpa header 3 (tak berubah); DOCTOR tetap 0',
           a == (True, '0') and n == (True, '3') and doc == (True, '0'), f'A={a} none={n} doctor={doc}')

    # Writes: still refused by D2 for OWNER (any header), and the readers are not a write path.
    for sql, label in ((f"update public.medical_records set diagnosis='DIUBAH' where visit_id='{S1}';", 'UPDATE rekam medis'),
                       (f"update public.visits set keluhan='DIUBAH' where id='{S1}';", 'UPDATE kunjungan'),
                       (f"delete from public.medical_records where visit_id='{S2}';", 'DELETE rekam medis'),
                       (f"insert into public.medical_records(visit_id,diagnosis) values ('{S1}','SISIPAN');", 'INSERT rekam medis')):
        for header in (BR_A, None):
            d.try_(actor(sql, OWNER, header))
    state = d.last(f"select (select string_agg(diagnosis, ',' order by diagnosis) from public.medical_records where visit_id in ('{S1}','{S2}'))"
                   f"||'|'||(select string_agg(keluhan, ',' order by keluhan) from public.visits where id in ('{S1}','{S2}'))")
    record('OWNER tidak bisa mengubah/menghapus/menambah riwayat bersama (D2 tetap), dengan atau tanpa header',
           state == 'UJI DIAGNOSIS 1,UJI DIAGNOSIS 2|Keluhan dua,Keluhan satu', state)
    vol = d.last("select string_agg(proname||':'||provolatile::text, ',' order by proname) from pg_proc where proname in "
                 "('pastikan_pembaca_riwayat_bersama','baca_riwayat_bersama_hewan','baca_detail_riwayat_bersama','riwayat_bersama_hewan','detail_riwayat_bersama')")
    record('Semua fungsi RS-2 STABLE (DML di dalamnya ditolak Postgres)', all(x.endswith(':s') for x in vol.split(',')) and vol.count(':') == 5, vol)

    # Catalog: owners, security, ACL exact.
    cat = json.loads(d.last("""select json_agg(json_build_object('f',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'secdef',p.prosecdef,
      'cfg',array_to_string(p.proconfig,','),'acl',(select json_agg(json_build_object('g',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      'p',a.privilege_type,'go',a.is_grantable) order by a.grantee) from aclexplode(p.proacl) a)) order by p.oid::regprocedure::text)
      from pg_proc p where p.proname in ('pastikan_pembaca_riwayat_bersama','baca_riwayat_bersama_hewan','baca_detail_riwayat_bersama',
      'riwayat_bersama_hewan','detail_riwayat_bersama')"""))
    by = {c['f']: c for c in cat}
    priv = [by['kamo_import.baca_detail_riwayat_bersama(uuid)'], by['kamo_import.baca_riwayat_bersama_hewan(uuid,integer,integer)']]
    val = by['kamo_import.pastikan_pembaca_riwayat_bersama()']
    pub = [by['detail_riwayat_bersama(uuid)'], by['riwayat_bersama_hewan(uuid,integer,integer)']]
    grantees = lambda c: sorted(a['g'] for a in c['acl'])
    record('Katalog: pembaca privat milik role penulis, SECURITY DEFINER, search_path kosong, EXECUTE hanya pemilik+authenticated',
           all(c['owner'] == WRITER and c['secdef'] and c['cfg'] == 'search_path=""' and grantees(c) == sorted([WRITER, 'authenticated'])
               and not any(a['go'] for a in c['acl']) for c in priv), json.dumps(priv)[:220])
    record('Katalog: validator milik role penulis, EXECUTE hanya pemilik',
           val['owner'] == WRITER and val['secdef'] and grantees(val) == [WRITER], json.dumps(val)[:200])
    record('Katalog: pembungkus publik INVOKER, EXECUTE pemilik+authenticated saja (tanpa PUBLIC/anon/service_role)',
           all(not c['secdef'] and c['cfg'] == 'search_path=""' and grantees(c) == sorted([c['owner'], 'authenticated']) for c in pub),
           json.dumps(pub)[:220])


def hosted_after(raw):
    """Run inside rls.hosted_emulation: the same non-superuser runner that installed 20261101120000 installs RS-2."""
    ok, msg = apply_sql(raw, RS2.read_text(), user='mig_emul')
    record('Emulasi hosted: runner non-superuser yang memasang 20261101120000 juga memasang RS-2, gerbang lulus', ok, msg[:150] if not ok else RS2.name)
    if not ok:
        return
    state = json.loads(raw.sql(f"""select json_build_object(
 'owner', (select string_agg(distinct pg_get_userbyid(proowner), ',') from pg_proc where pronamespace='kamo_import'::regnamespace),
 'count', (select count(*) from pg_proc where pronamespace='kamo_import'::regnamespace),
 'runner_can_set', pg_has_role('mig_emul', '{WRITER}', 'SET'),
 'schema_create', has_schema_privilege('{WRITER}', 'kamo_import', 'CREATE'),
 'runner_membership', (select json_agg(json_build_object('set', set_option, 'inherit', inherit_option))
                       from pg_auth_members where roleid='{WRITER}'::regrole and member='mig_emul'::regrole))"""))
    record('Emulasi hosted: 17 fungsi milik role penulis; runner tidak bisa SET; role tanpa CREATE skema',
           state['owner'] == WRITER and state['count'] == 17 and not state['runner_can_set'] and not state['schema_create']
           and all(not m['set'] and not m['inherit'] for m in (state['runner_membership'] or [])), json.dumps(state))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--pg-bin', required=True, help='PostgreSQL bin dir for a native throwaway cluster')
    parser.add_argument('--json', type=Path)
    parser.add_argument('--migration', type=Path, help='Apply this file instead of the RS-2 migration (mutation checks only)')
    args = parser.parse_args()
    global RS2
    if args.migration:
        RS2 = args.migration.resolve()
    sys.path.insert(0, str(ROOT / 'scripts'))
    from native_postgres import NativePostgres
    base_text = RS2.read_text()
    with NativePostgres(args.pg_bin) as db:
        rls.fresh_without_new(args.pg_bin, db)
        ok, msg, _ = rls.apply_new(db)
        record('Prasyarat: 20261101120000 terpasang', ok, msg[:120] if not ok else 'ok')
        d = rls.Db(db)
        h = rls.base.Harness(db, None)
        rls.base.bootstrap_fixture(h)
        rls.bootstrap(d)
        seed(d)
        mutants(d, base_text)
        before = catalog_snapshot(d)
        ok, msg = apply_sql(db, base_text)
        record('Migrasi RS-2 terpasang di atas semua migrasi repo (gerbang pasca-cek lulus)', ok, msg[:160] if not ok else RS2.name)
        if ok:
            cases(d, before)
            ok2, msg2 = apply_sql(db, base_text)
            record('Migrasi RS-2 tidak bisa dipasang dua kali (prasyarat menolak)', not ok2 and 'RS-2: skema kamo_import tidak sama' in msg2, msg2[:120])
    rls.hosted_emulation(args.pg_bin, after=hosted_after)
    fails = [r for r in rls.RESULTS if r['status'] != 'PASS']
    print(f"TOTAL pass={len(rls.RESULTS) - len(fails)} fail={len(fails)}", flush=True)
    if args.json:
        args.json.write_text(json.dumps({'results': rls.RESULTS}, indent=2))
    sys.exit(0 if not fails else 1)


if __name__ == '__main__':
    main()
