#!/usr/bin/env python3
"""Semua akun Kas & Bank jadi rekening (20261115100000) on a throwaway native PostgreSQL.

Applies every repository migration, then rebuilds the production state from before the release (only the
default 110003 "Kas" / 120002 "Bank BCA" rekening plus a few hand-made finance settings), re-applies the target
migration and checks: every active Kas/Bank account becomes a rekening, finance settings survive, the default
names get the account names, inactive/header/non-cash accounts stay out, and re-applying is a no-op.
Fictional data only; no production connection.

Usage: python3 scripts/test-semua-rekening-kas-bank-postgres.py [/usr/lib/postgresql/16/bin]
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
TARGET = ROOT / "supabase/migrations/20261115100000_semua_akun_kas_bank_jadi_rekening.sql"


def ok(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("PASS " + msg, flush=True)


def state(db):
    return db.last("""select coalesce(string_agg(x, ';' order by x), '') from (
      select c.coa_code||'/'||c.jenis||'/'||c.nama||'/'||coalesce(c.bank_nama,'-')||'/'||coalesce(c.no_rekening,'-')
             ||'/'||c.is_active||'/'||coalesce(c.branch_id::text,'-') x from cash_accounts c) s;""")


def one(db, code, col):
    return db.last(f"select coalesce({col}::text,'<null>') from cash_accounts where coa_code='{code}';")


if __name__ == "__main__":
    with NativePostgres(BIN) as db:
        fixture.DisposablePostgres.bootstrap(db)

        # Production before this release: only the defaults are rekening; finance renamed none of them,
        # deactivated a hand-made 120005 rekening, and named 110001 themselves. Headers / inactive /
        # non-cash accounts must never become rekening.
        db.sql("""
          update coa_accounts set is_active=true where code ~ '^1[12][0-9]{4}$';
          delete from cash_accounts c where c.coa_code not in ('110003','120002')
            and not exists (select 1 from payment_account_map m where m.cash_account_id=c.id);
          update cash_accounts set nama='Kas', no_rekening=null where coa_code='110003';
          update cash_accounts set nama='Bank BCA', bank_nama='BCA', no_rekening=null where coa_code='120002';
          insert into cash_accounts(nama,jenis,coa_code,bank_nama,no_rekening,is_active)
            values('BCA Margin lama','Bank','120005','BCA','999',false),('Kas Blu (manual)','Kas','110001',null,null,true);
          insert into coa_accounts(code,name,type,normal_balance,is_active)
            values('120099','Bank Mandiri Nonaktif (1234567)','ASET','D',false),('121000','Bank Lain','ASET','D',true)
            on conflict (code) do nothing;
          update coa_accounts set is_header=true where code='121000';""")
        ok(db.last("select count(*) from cash_accounts where coa_code in ('120001','120003','120004','120006');") == "0",
           "pre-release state: the other BCA accounts are not rekening")

        db.sql("begin;\n" + TARGET.read_text() + "\ncommit;")
        first = state(db)
        db.sql("begin;\n" + TARGET.read_text() + "\ncommit;")
        ok(state(db) == first, "re-applying the migration is a no-op")

        missing = db.last("""select count(*) from coa_accounts a where a.code ~ '^1[12][0-9]{4}$' and a.is_active
          and not a.is_header and a.type='ASET' and not exists (select 1 from cash_accounts c where c.coa_code=a.code);""")
        ok(missing == "0", "every active Kas/Bank account is a rekening")
        ok(db.last("select count(*) from cash_accounts where coa_code between '120001' and '120006';") == "6",
           "all six BCA accounts are listed")
        ok(one(db, "120001", "nama") == "Bank BCA Toko (1740260461)" and one(db, "120001", "jenis") == "Bank"
           and one(db, "120001", "bank_nama") == "BCA" and one(db, "120001", "no_rekening") == "1740260461"
           and one(db, "120001", "branch_id") == "<null>" and one(db, "120001", "is_active") == "true",
           "new BCA rekening: account name, Bank, BCA, account number, all branches, active")
        ok(one(db, "110002", "jenis") == "Kas" and one(db, "110002", "no_rekening") == "<null>"
           and one(db, "110002", "bank_nama") == "<null>", "new Kas rekening has no bank details")
        ok(one(db, "120002", "nama") == "Bank BCA Transaksi (4270086743)" and one(db, "120002", "no_rekening") == "4270086743",
           "default 'Bank BCA' gets its account name and number")
        ok(one(db, "110003", "nama") == "Kas Kecil", "default 'Kas' gets its account name")
        ok(one(db, "120005", "nama") == "BCA Margin lama" and one(db, "120005", "is_active") == "false"
           and one(db, "120005", "no_rekening") == "999", "finance-deactivated rekening untouched")
        ok(one(db, "110001", "nama") == "Kas Blu (manual)", "finance-named rekening untouched")
        ok(db.last("select count(*) from cash_accounts where coa_code in ('120099','121000','100000','110000','120000','150001');") == "0",
           "inactive, header and non-cash accounts are not rekening")
        ok(db.last("select count(*) from cash_accounts group by coa_code having count(*)>1 union all select 0 limit 1;") == "0",
           "one rekening per account")
        ok(db.last("select count(*) from journal_entries;") == "0", "no journal created")
        print("ALL PASS", flush=True)
