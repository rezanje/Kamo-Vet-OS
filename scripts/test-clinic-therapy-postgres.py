#!/usr/bin/env python3
"""K12 isolated PostgreSQL: fictional fixtures only; no target URL or credentials."""
import importlib.util
from pathlib import Path
import sys
import tempfile
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
MIGRATION = '20261023121700_clinic_therapy_note.sql'
spec = importlib.util.spec_from_file_location('therapy_fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
with tempfile.TemporaryDirectory(prefix='kamo-therapy-baseline-') as directory:
    migrations = Path(directory) / 'supabase/migrations'
    migrations.mkdir(parents=True)
    for source in (ROOT / 'supabase/migrations').glob('*.sql'):
        if source.name != MIGRATION:
            (migrations / source.name).symlink_to(source)
    fixture.ROOT = Path(directory)
    with fixture.DisposablePostgres() as database:
        database.bootstrap()
        identity = "select row(proowner,prosecdef,proconfig,proacl)::text from pg_proc where oid='public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text)'::regprocedure;"
        before = database.sql(identity)
        # A request committed by the previous app must replay after deployment.
        # Empty therapy is omitted by the new action, retaining the original JSON hash.
        if '--baseline' not in sys.argv:
            clone = 'therapy_legacy_retry'
            database.sql('create database ' + clone + ' template postgres;')
            prefix = (ROOT / 'supabase/tests/clinic_therapy_note.sql').read_text().split('do $$')[0]
            call = "select public.clinic_save_initial_record('ca600000-0000-4000-8000-000000000001','ca500000-0000-4000-8000-000000000001','{\"diagnosis\":\"Legacy\"}','[]','[]','[]',null,'ca800000-0000-4000-8000-000000000001','Dokter Fiktif','Keluhan fiktif','pre-deployment-request');"
            try:
                database.sql('\\connect ' + clone + '\n' + prefix + call + '\ncommit;')
                database.sql('\\connect ' + clone + '\nbegin;\n' + (ROOT / 'supabase/migrations' / MIGRATION).read_text() + '\ncommit;')
                database.sql('\\connect ' + clone + "\nbegin;set local role authenticated;select set_config('request.jwt.claim.role','authenticated',true);select set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000002',true);\n" + call + '\nrollback;')
                print('PASS pre-deployment record replays after candidate migration without changed hash.', flush=True)
            finally:
                database.sql('drop database ' + clone + ' with (force);')
        if '--baseline' not in sys.argv:
            database.sql('begin;\n' + (ROOT / 'supabase/migrations' / MIGRATION).read_text() + '\ncommit;')
            assert database.sql(identity) == before, 'Save function owner/security/ACL changed'
        database.sql((ROOT / 'supabase/tests/clinic_therapy_note.sql').read_text())
        if '--baseline' not in sys.argv:
            database.sql((ROOT / 'docs/rollback/2026-10-23-clinic-therapy-note.sql').read_text())
            assert database.sql(identity) == before, 'Rollback changed function security'
            assert database.sql("select count(*) from information_schema.columns where table_schema='public' and table_name='medical_records' and column_name='therapy';") == '1', 'Rollback removed stored note column'
        print('PASS therapy persistence, legacy null, retry/hash, rollback, posted guard, access and migration security.', flush=True)
