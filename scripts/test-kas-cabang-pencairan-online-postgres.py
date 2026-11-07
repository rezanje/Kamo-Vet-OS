#!/usr/bin/env python3
"""Kas tunai per cabang + pencairan online sekaligus (20261107010000) on a throwaway native PostgreSQL.

Applies every repository migration (the target no-ops: a fresh database has no branches), seeds the
production branch list from supabase/seed.sql plus a few hand-made finance settings, re-applies the
target migration, checks it is idempotent, then runs supabase/tests/kas_tunai_per_cabang_pencairan_online.sql.
Fictional data only; no production connection.

Usage: python3 scripts/test-kas-cabang-pencairan-online-postgres.py [/usr/lib/postgresql/16/bin]
"""
import importlib.util
import os
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
BIN = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PG_BIN", "/usr/lib/postgresql/16/bin"))
TARGET = ROOT / "supabase/migrations/20261107010000_kas_tunai_per_cabang_pencairan_online.sql"
TEST = ROOT / "supabase/tests/kas_tunai_per_cabang_pencairan_online.sql"


def ok(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("PASS " + msg, flush=True)


def state(db):
    return db.last("""select coalesce(string_agg(x, ';' order by x), '') from (
      select 'rek:'||c.coa_code||'/'||c.jenis||'/'||coalesce(b.code,'-')||'/'||c.is_active x
        from cash_accounts c left join branches b on b.id=c.branch_id
      union all select 'map:'||m.metode||'/'||coalesce(b.code,'-')||'/'||c.coa_code
        from payment_account_map m join cash_accounts c on c.id=m.cash_account_id left join branches b on b.id=m.branch_id) s;""")


if __name__ == "__main__":
    with NativePostgres(BIN) as db:
        fixture.DisposablePostgres.bootstrap(db)
        ok(db.last("select count(*) from cash_accounts where coa_code between '110004' and '110021';") == "0",
           "fresh database without branches: migration is a no-op")

        seed = (ROOT / "supabase/seed.sql").read_text()
        branches = re.search(r"insert into branches \(code, name, type, is_active\) values.*?;", seed, re.S).group(0)
        db.sql(branches)
        # Finance already set some things by hand before this release:
        #  - TKI cash goes to 110001 (manual rule) → must survive;
        #  - an unowned rekening for 110006 exists → must be reused and bound to CMS;
        #  - 110008 rekening was deactivated → must stay inactive and unmapped.
        db.sql("""
          update coa_accounts set is_active=true where code between '110001' and '110021';
          insert into cash_accounts(nama,jenis,coa_code) values('Kas Blu (manual)','Kas','110001'),('Kas CMS lama','Kas','110006');
          insert into cash_accounts(nama,jenis,coa_code,is_active) values('Kas Muara nonaktif','Kas','110008',false);
          insert into payment_account_map(metode,branch_id,cash_account_id)
            select 'Tunai',b.id,c.id from branches b, cash_accounts c where b.code='TKI' and c.coa_code='110001';""")
        db.sql(TARGET.read_text())
        first = state(db)
        db.sql(TARGET.read_text())
        ok(state(db) == first, "re-applying the migration is a no-op")
        db.sql(TEST.read_text())
        ok(True, "kas_tunai_per_cabang_pencairan_online.sql assertions")
