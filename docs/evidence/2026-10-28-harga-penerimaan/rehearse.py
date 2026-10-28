"""Gladi paket harga penerimaan di PostgreSQL lokal sekali pakai (tanpa URL remote)."""
import importlib.util, os, re, shutil, sys
from pathlib import Path
ROOT = Path(sys.argv[1]); PG = sys.argv[2]
PKG = ROOT / 'docs/evidence/2026-10-28-harga-penerimaan'
NEW = ROOT / 'supabase/migrations/20261029160000_purchase_receipt_price_follows_line_edit.sql'
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
from native_postgres import NativePostgres
os.environ.setdefault('LC_ALL', 'en_US.UTF-8')
def suite(db, mode):
    src = (ROOT / 'supabase/tests/purchase_order_line_correction.sql').read_text().replace('__MODE__', mode)
    db.sql(re.sub(r"(?m)^update profiles (.*);$", r"alter table profiles disable trigger guard_profile_privileges;\nupdate profiles \1;\nalter table profiles enable trigger guard_profile_privileges;", src))
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
            suite(db, mode); print(f'PASS edit baris PO + harga penerimaan ({mode}) setelah apply')
        db.sql((PKG / 'rollback.sql').read_text()); print('ROLLBACK ok')
        print('PREFLIGHT setelah rollback'); print(db.sql((PKG / 'preflight.sql').read_text()))
        try:
            suite(db, 'fifo'); print('UNEXPECTED: harga penerimaan masih ikut setelah rollback'); sys.exit(1)
        except RuntimeError as e:
            print('EXPECTED FAIL setelah rollback:', re.search(r'Assertion failed: [^\n]*', str(e)).group(0))
finally:
    shutil.move(hidden, NEW)
