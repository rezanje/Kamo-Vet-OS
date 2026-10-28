#!/usr/bin/env python3
"""End-to-end rehearsal of both owner-apply packages on a disposable cluster with fictional data.

Run through the native shim (no Docker, no database URL):
  python3 docs/evidence/2026-10-28-k03-j01-s04/run-native-pg.py docs/evidence/2026-10-28-k03-j01-s04/rehearse-owner-apply.py

State before the packages mirrors production on 28 Oct 2026: every repository migration applied EXCEPT
20261026002000 (S04), 20261029120000 (K03) and 20261029121000 (J01), plus a supabase_migrations history table.
"""
from pathlib import Path
import importlib.util
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
PENDING = {'20261026002000_service_commission_policy.sql', '20261029120000_k03_racikan_recipe_required.sql',
           '20261029121000_j01_finance_wholesale_correction.sql'}
KJ, S4 = HERE / 'owner-apply-k03-j01', HERE / 'owner-apply-s04'


def summary(db, path):
    return db.sql(path.read_text()).splitlines()[-1]


def expect(db, path, failed):
    line = summary(db, path)
    ok = line.startswith(f'SUMMARY: {failed} failed') if failed == 0 else not line.startswith('SUMMARY: 0 failed')
    assert ok, f'{path.relative_to(HERE)} -> {line}'
    print(f'PASS {path.relative_to(HERE)} -> {line}', flush=True)


def refused(db, path, needle, label):
    try:
        db.sql(path.read_text())
    except RuntimeError as error:
        assert needle in str(error), str(error)
        print(f'PASS {label}: refused and rolled back ({needle})', flush=True)
        return
    raise AssertionError(f'{label}: expected refusal')


with fixture.DisposablePostgres() as db:
    # Bootstrap with the pending migrations held back.
    real_glob = Path.glob

    def glob(self, pattern):
        return [p for p in real_glob(self, pattern) if p.name not in PENDING]

    Path.glob = glob
    try:
        db.bootstrap()
    finally:
        Path.glob = real_glob
    db.sql("""create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
insert into auth.users(id) values ('c3f00000-0000-4000-8000-000000000001');
update public.profiles set role='OWNER', is_active=true where id='c3f00000-0000-4000-8000-000000000001';""")

    # K03 + J01
    expect(db, KJ / 'preflight.sql', 0)
    expect(db, KJ / 'readback.sql', 'some')
    db.sql("""do $t$ declare s text; begin
      select prosrc into s from pg_proc where oid='public.wholesale_access(uuid,boolean)'::regprocedure;
      execute 'create or replace function public.wholesale_access(p_branch uuid,p_owner boolean default false) returns void language plpgsql security definer set search_path='''' as $f$' || s || ' $f$';
    end $t$;""")
    expect(db, KJ / 'preflight.sql', 'some')
    refused(db, KJ / 'apply.sql', 'berbeda dari versi yang ditinjau', 'apply with unreviewed wholesale_access body')
    assert db.sql("select count(*) from pg_trigger where tgname='zz_racikan_recipe_required'") == '0', 'refused apply leaked K03 trigger'
    # Restore the reviewed body exactly via the package rollback's function text.
    rollback = (KJ / 'rollback.sql').read_text()
    body = rollback[rollback.index('create or replace function public.wholesale_access'):rollback.index('revoke all on function public.wholesale_access')]
    db.sql(body)
    expect(db, KJ / 'preflight.sql', 0)
    db.sql((KJ / 'apply.sql').read_text())
    print('PASS apply k03-j01', flush=True)
    expect(db, KJ / 'readback.sql', 0)
    expect(db, KJ / 'preflight.sql', 'some')
    db.sql((KJ / 'rollback.sql').read_text())
    print('PASS rollback k03-j01', flush=True)
    expect(db, KJ / 'preflight.sql', 0)
    db.sql((KJ / 'apply.sql').read_text())
    print('PASS re-apply k03-j01', flush=True)
    expect(db, KJ / 'readback.sql', 0)

    # S04
    expect(db, S4 / 'preflight.sql', 0)
    refused(db, S4 / 'readback.sql', 'does not exist', 's04 readback before apply (table absent)')
    db.sql((S4 / 'apply.sql').read_text())
    print('PASS apply s04', flush=True)
    expect(db, S4 / 'readback.sql', 0)
    rows = db.sql("select count(*) from public.service_commission_policies")
    assert rows == '1', rows
    refused(db, S4 / 'apply.sql', 'already exists', 'second s04 apply')
    expect(db, S4 / 'preflight.sql', 'some')
    # A later choice saved from the Komisi screen makes rollback refuse unless the owner flag is set.
    db.sql("""insert into public.service_commission_policies(effective_from,mode,created_by)
      values('2026-12-01','pending','c3f00000-0000-4000-8000-000000000001');""")
    refused(db, S4 / 'rollback.sql', 'S04 rollback ditolak', 's04 rollback with a later policy row')
    assert db.sql("select count(*) from public.service_commission_policies") == '2', 'refused rollback changed rows'
    flagged = (S4 / 'rollback.sql').read_text().replace(
        "-- select set_config('kamo.s04_rollback_confirm'", "select set_config('kamo.s04_rollback_confirm'", 1)
    db.sql(flagged)
    print('PASS rollback s04 with explicit owner flag (extra row present)', flush=True)
    expect(db, S4 / 'preflight.sql', 0)
    db.sql((S4 / 'apply.sql').read_text())
    print('PASS re-apply s04', flush=True)
    db.sql((S4 / 'rollback.sql').read_text())
    print('PASS rollback s04 (only the seeded row, no flag needed)', flush=True)
    expect(db, S4 / 'preflight.sql', 0)
    db.sql((S4 / 'apply.sql').read_text())
    print('PASS re-apply s04', flush=True)
    expect(db, S4 / 'readback.sql', 0)

    # The repository suites still pass on the post-package state.
    for name in ['clinic_compound_issue.sql']:
        db.sql((ROOT / 'supabase/tests' / name).read_text())
        print(f'PASS suite {name}', flush=True)
