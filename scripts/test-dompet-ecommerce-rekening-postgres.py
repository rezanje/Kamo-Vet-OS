#!/usr/bin/env python3
"""Dompet e-commerce jadi rekening (20261112081850) on a throwaway native PostgreSQL.

Applies every repository migration, removes any e-commerce rekening to rebuild the pre-release production state
(plus one wallet finance already registered by hand and renamed), re-applies the target migration and checks:
every active e-commerce wallet 130001-130008 becomes a Bank rekening for all branches, 130009 Piutang
Marketplace and the 130000 header stay out, finance settings survive, re-applying is a no-op, no journal.
Fictional data only; no production connection.

Usage: python3 scripts/test-dompet-ecommerce-rekening-postgres.py [/usr/lib/postgresql/16/bin]
"""
import importlib.util
import os
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
TARGET = ROOT / "supabase/migrations/20261112081850_dompet_ecommerce_jadi_rekening.sql"


def ok(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("PASS " + msg, flush=True)


def state(db):
    return db.last("""select coalesce(string_agg(x, ';' order by x), '') from (
      select c.coa_code||'/'||c.jenis||'/'||c.nama||'/'||c.is_active||'/'||coalesce(c.branch_id::text,'-') x
        from cash_accounts c) s;""")


def one(db, code, col):
    return db.last(f"select coalesce({col}::text,'<null>') from cash_accounts where coa_code='{code}';")


if __name__ == "__main__":
    with NativePostgres(BIN) as db:
        fixture.DisposablePostgres.bootstrap(db)
        db.sql("""
          delete from cash_accounts c where c.coa_code like '13%'
            and not exists (select 1 from payment_account_map m where m.cash_account_id=c.id);
          insert into cash_accounts(nama,jenis,coa_code,is_active) values('Shopee Bogor (manual)','Bank','130004',false);""")
        ok(db.last("select count(*) from coa_accounts where code between '130001' and '130009' and is_active;") == "9",
           "chart of accounts has 8 wallets + Piutang Marketplace")
        journals_before = db.last("select count(*) from journal_entries;")

        db.sql("begin;\n" + TARGET.read_text() + "\ncommit;")
        first = state(db)
        db.sql("begin;\n" + TARGET.read_text() + "\ncommit;")
        ok(state(db) == first, "re-applying the migration is a no-op")

        ok(db.last("select count(*) from cash_accounts where coa_code between '130001' and '130008';") == "8",
           "all eight e-commerce wallets are rekening")
        ok(one(db, "130005", "nama") == "Shopee Bandung" and one(db, "130005", "jenis") == "Bank"
           and one(db, "130005", "branch_id") == "<null>" and one(db, "130005", "is_active") == "true",
           "new wallet: account name, Bank (shown in disbursement & transfer), all branches, active")
        ok(one(db, "130004", "nama") == "Shopee Bogor (manual)" and one(db, "130004", "is_active") == "false",
           "finance-registered wallet untouched")
        ok(db.last("select count(*) from cash_accounts where coa_code in ('130000','130009');") == "0",
           "header and Piutang Marketplace are not rekening")
        ok(db.last("select count(*) from cash_accounts group by coa_code having count(*)>1 union all select 0 limit 1;") == "0",
           "one rekening per account")
        ok(db.last("select count(*) from journal_entries;") == journals_before, "no journal created")
        print("ALL PASS", flush=True)
