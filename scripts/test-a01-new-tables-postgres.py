#!/usr/bin/env python3
"""A01 new-table coverage (20261029150000) in an owned, network-isolated PostgreSQL 16.

Uses the same disposable container fixture as scripts/test-accurate-inventory-accounting-postgres.py
(no external database or credentials). Steps: all repository migrations; re-apply the new migration
(idempotent); drift must abort; SQL test on a cloned database; owner package rehearsal
readback -> rollback -> preflight -> apply -> apply again -> readback -> SQL test again.
Without Docker: python3 docs/evidence/2026-10-29-a01-new-tables/run-native-pg.py scripts/test-a01-new-tables-postgres.py
"""
import importlib.util
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('a01_fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

MIGRATION = (ROOT / 'supabase/migrations/20261029150000_a01_audit_new_tables.sql').read_text()
PKG = ROOT / 'docs/evidence/2026-10-29-a01-new-tables/owner-apply'
TEST = (ROOT / 'supabase/tests/activity_audit_new_tables.sql').read_text()
STATE = """select (select count(*) from public.activity_log_sources)||'/'||
  (select count(*) from pg_trigger where tgname like 'a01\\_activity\\_%' and not tgisinternal)||'/'||
  md5((select string_agg(to_jsonb(s)::text, '' order by entity) from public.activity_log_sources s));"""


def expect_failure(database, sql, needle, label):
    try:
        database.sql(sql)
    except RuntimeError as error:
        if needle not in str(error):
            raise RuntimeError(f'{label}: unexpected error {error}') from error
        print(f'PASS drift refused: {label}', flush=True)
        return
    raise RuntimeError(f'{label}: migration did not refuse drift')


def checks(database, name):
    rows = database.sql((PKG / name).read_text()).splitlines()
    bad = [row for row in rows if not row.endswith('|t')]
    if bad or not rows or not rows[-1].startswith('SUMMARY: 0 failed'):
        raise RuntimeError(f'{name}: failed checks {bad}')
    return len(rows) - 1


def run_test(database, label):
    database.sql('create database a01_new_tables template postgres;')
    try:
        database.sql("\\connect a01_new_tables\nset time zone 'Asia/Jakarta';\n" + TEST)
        print(f'PASS activity_audit_new_tables.sql ({label})', flush=True)
    finally:
        database.sql('drop database a01_new_tables with (force);')


with fixture.DisposablePostgres() as database:
    database.bootstrap()
    first = database.sql(STATE)
    database.sql('begin;\n' + MIGRATION + '\ncommit;')
    if database.sql(STATE) != first:
        raise RuntimeError('Re-applying the migration changed the registry or triggers')
    print(f'PASS idempotent re-apply (sources/triggers/registry hash unchanged: {first})', flush=True)
    expect_failure(database, "begin;update public.activity_log_sources set reader_roles=array['OWNER','ADMIN'] where entity='payslip_templates';\n"
                   + MIGRATION + '\nrollback;', 'A01 registry drift: payslip_templates', 'registry row changed')
    expect_failure(database, 'begin;drop trigger a01_activity_delete on public.campaign_codes;'
                   'create trigger a01_activity_delete before delete on public.campaign_codes for each row execute function public.activity_log_immutable();\n'
                   + MIGRATION + '\nrollback;', 'exists with a different definition', 'foreign trigger body')
    expect_failure(database, 'begin;alter table public.opening_invoice_lines rename column outstanding to outstanding_old;\n'
                   + MIGRATION + '\nrollback;', 'A01 column missing: opening_invoice_lines.outstanding', 'source column renamed')
    if database.sql(STATE) != first:
        raise RuntimeError('A refused drift run left changes behind')
    run_test(database, 'after all migrations')

    print('readback after migrations:', checks(database, 'readback.sql'), 'checks ok', flush=True)
    database.sql((PKG / 'rollback.sql').read_text())
    left = database.sql("""select (select count(*) from public.activity_log_sources where entity in ('campaign_codes','payslip_templates',
      'payslip_template_components','employee_payslip_templates','employee_base_salaries','service_commission_policies','branch_grooming_rules',
      'opening_invoice_batches','opening_invoice_lines','recurring_journal_sources','recurring_source_occurrences','clinic_refund_items',
      'clinic_record_addenda','inpatient_rx_evidence','inpatient_rx_evidence_settings','quest_new_customer_claims','purchase_invoice_receipts',
      'private_report_presets'))||'/'||(select count(*) from public.activity_log_sources);""")
    if left != '0/185':
        raise RuntimeError('rollback left registry rows or removed older sources: ' + left)
    print('rollback: 18 registrations and their triggers removed, 185 older sources intact.', flush=True)
    print('preflight after rollback:', checks(database, 'preflight.sql'), 'checks ok', flush=True)
    database.sql((PKG / 'apply.sql').read_text())
    database.sql((PKG / 'apply.sql').read_text())
    if database.sql(STATE) != first:
        raise RuntimeError('Owner package apply differs from the migration result')
    print('apply.sql twice: same registry/triggers as the migration.', flush=True)
    print('preflight on applied database (re-run case):', checks(database, 'preflight.sql'), 'checks ok', flush=True)
    print('readback after apply.sql:', checks(database, 'readback.sql'), 'checks ok', flush=True)
    run_test(database, 'after owner package apply')
print('PASS A01 new-table coverage.', flush=True)
