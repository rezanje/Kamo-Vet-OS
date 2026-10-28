"""Gladi paket owner edit baris PO di PostgreSQL lokal sekali pakai (tanpa URL remote)."""
import importlib.util, os, re, shutil, sys
from pathlib import Path
ROOT = Path(sys.argv[1]); PG = sys.argv[2]
PKG = ROOT / 'docs/evidence/2026-10-28-edit-baris-po'
NEW = ROOT / 'supabase/migrations/20261029150000_purchase_order_line_correction.sql'
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
from native_postgres import NativePostgres
os.environ.setdefault('LC_ALL', 'en_US.UTF-8')
def owner_updates(src):
    return re.sub(r"(?m)^update profiles (.*);$", r"alter table profiles disable trigger guard_profile_privileges;\nupdate profiles \1;\nalter table profiles enable trigger guard_profile_privileges;", src)
def suite(db, name, mode):
    db.sql(owner_updates((ROOT / 'supabase/tests' / name).read_text().replace('__MODE__', mode)))
hidden = Path(str(NEW) + '.hidden'); shutil.move(NEW, hidden)
try:
    with NativePostgres(PG) as db:
        print('server:', db.sql('show server_version'))
        fixture.DisposablePostgres.bootstrap(db)
        versions = sorted(p.name.split('_')[0] for p in (ROOT / 'supabase/migrations').glob('*.sql'))
        db.sql('create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);'
               + ''.join(f"insert into supabase_migrations.schema_migrations(version) values('{v}') on conflict do nothing;" for v in versions))
        print('PREFLIGHT'); print(db.sql((PKG / 'preflight.sql').read_text()))
        db.sql((PKG / 'apply.sql').read_text()); db.sql((PKG / 'apply.sql').read_text()); print('APPLY 2x ok')
        print('READBACK'); print(db.sql((PKG / 'readback.sql').read_text()))
        for mode in ['fifo', 'average']:
            suite(db, 'purchase_order_line_correction.sql', mode); suite(db, 'purchase_invoice_line_correction.sql', mode)
            print(f'PASS edit baris PO + koreksi faktur ({mode}) setelah apply')
        db.sql((PKG / 'rollback.sql').read_text()); print('ROLLBACK ok')
        print('READBACK setelah rollback'); print(db.sql((PKG / 'readback.sql').read_text().replace("has_function_privilege('authenticated', 'public.preview_purchase_order_line_correction(uuid,numeric,numeric,numeric,date)', 'execute')::text", "(to_regprocedure('public.preview_purchase_order_line_correction(uuid,numeric,numeric,numeric,date)') is not null)::text").split('union all select \'simpan')[0] + ';'))
        print('PREFLIGHT setelah rollback'); print(db.sql((PKG / 'preflight.sql').read_text()))
        for mode in ['fifo', 'average']:
            suite(db, 'purchase_invoice_line_correction.sql', mode); print(f'PASS koreksi faktur ({mode}) setelah rollback')
        try:
            suite(db, 'purchase_order_line_correction.sql', 'fifo'); print('UNEXPECTED: edit baris PO masih jalan setelah rollback'); sys.exit(1)
        except RuntimeError as e:
            print('EXPECTED FAIL edit baris PO setelah rollback:', str(e).splitlines()[0][:160])
finally:
    shutil.move(hidden, NEW)
