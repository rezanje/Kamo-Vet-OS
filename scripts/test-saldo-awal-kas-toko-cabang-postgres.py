#!/usr/bin/env python3
"""Saldo awal Kas Toko ikut cabangnya (20261130300000) on a throwaway native PostgreSQL.

Applies every repository migration (the target no-ops: a fresh database has no saldo-awal journal), seeds the
production branch list from supabase/seed.sql, binds Kas Toko rekening to branches (re-applying
20261107010000), builds a combined "Pusat" saldo-awal journal like production's JRN-202610-0021 plus some
branch transactions, applies the target twice and checks per-branch / Pusat / company-wide balances and the
monetary opening correction branch. Fictional data only; no production connection.

Usage: python3 -I scripts/test-saldo-awal-kas-toko-cabang-postgres.py [/usr/lib/postgresql/16/bin]
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
TARGET = ROOT / "supabase/migrations/20261130300000_saldo_awal_kas_toko_ke_cabang.sql"
KAS_CABANG = ROOT / "supabase/migrations/20261107010000_kas_tunai_per_cabang_pencairan_online.sql"
OWNER = "5a1d0000-0000-4000-8000-000000000001"


def ok(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("PASS " + msg, flush=True)


def saldo(db, code, branch=None, pusat=False):
    where = ""
    if pusat:
        where = " and e.branch_id is null"
    elif branch:
        where = f" and e.branch_id=(select id from branches where code='{branch}')"
    return db.last(f"""select coalesce(sum(l.debit-l.credit),0)::numeric(18,2) from journal_lines l
      join journal_entries e on e.id=l.entry_id join coa_accounts a on a.id=l.account_id
      where a.code='{code}'{where};""")


def state(db):
    return db.last("""select count(*)||'/'||coalesce(sum(l.debit),0) from journal_lines l
      join journal_entries e on e.id=l.entry_id where e.source='saldo-awal-cabang';""")


if __name__ == "__main__":
    with NativePostgres(BIN) as db:
        fixture.DisposablePostgres.bootstrap(db)
        ok(state(db) == "0/0", "fresh database without saldo-awal journal: migration is a no-op")

        seed = (ROOT / "supabase/seed.sql").read_text()
        db.sql(re.search(r"insert into branches \(code, name, type, is_active\) values.*?;", seed, re.S).group(0))
        db.sql("""
          update coa_accounts set is_active=true where code between '110001' and '110021';
          insert into coa_accounts(code,name,type,normal_balance) values
            ('410001','Modal Pemilik','EKUITAS','K'),('400901','Fixture pendapatan','PENDAPATAN','K')
            on conflict(code) do nothing;
          update coa_accounts set is_active=true,is_header=false where code in ('410001','400901');
          insert into cash_accounts(nama,jenis,coa_code) values('Kas Blu (pusat)','Kas','110001')
            on conflict do nothing;""")
        db.sql(KAS_CABANG.read_text())
        ok(db.last("select count(*) from cash_accounts where coa_code between '110004' and '110021' and branch_id is not null;") != "0",
           "Kas Toko rekening bound to branches")

        # Production shape: one combined saldo-awal journal without branch; 110017 has no opening.
        db.sql(f"""
          insert into auth.users(id,raw_user_meta_data) values('{OWNER}','{{}}');
          alter table profiles disable trigger guard_profile_privileges;
          update profiles set role='OWNER',is_active=true where id='{OWNER}';
          alter table profiles enable trigger guard_profile_privileges;
          update accounting_locks set closed_until=null where id;
          insert into journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values
            ('5a1e0000-0000-4000-8000-000000000001','JRN-FIX-OPEN','2026-10-31','Saldo awal per 2026-10-31','saldo-awal','2026-10-31',null),
            ('5a1e0000-0000-4000-8000-000000000002','JRN-FIX-BTKM','2026-11-03','Penjualan tunai','fixture','btkm',(select id from branches where code='BTKM')),
            ('5a1e0000-0000-4000-8000-000000000003','JRN-FIX-VCMS','2026-11-04','Setor ke bank','fixture','vcms',(select id from branches where code='VET_CMS'));
          insert into journal_lines(entry_id,account_id,debit,credit)
            select '5a1e0000-0000-4000-8000-000000000001'::uuid,id,527246,0 from coa_accounts where code='110001'
            union all select '5a1e0000-0000-4000-8000-000000000001',id,2437500,0 from coa_accounts where code='110004'
            union all select '5a1e0000-0000-4000-8000-000000000001',id,310500,0 from coa_accounts where code='110013'
            union all select '5a1e0000-0000-4000-8000-000000000001',id,1686001,0 from coa_accounts where code='110011'
            union all select '5a1e0000-0000-4000-8000-000000000001',id,0,4961247 from coa_accounts where code='410001'
            union all select '5a1e0000-0000-4000-8000-000000000002',id,100000,0 from coa_accounts where code='110004'
            union all select '5a1e0000-0000-4000-8000-000000000002',id,0,100000 from coa_accounts where code='400901'
            union all select '5a1e0000-0000-4000-8000-000000000003',id,0,342500 from coa_accounts where code='110013'
            union all select '5a1e0000-0000-4000-8000-000000000003',id,342500,0 from coa_accounts where code='110001';""")

        before = {c: saldo(db, c) for c in ("110001", "110004", "110011", "110013", "110017", "410001")}
        ok(saldo(db, "110013", branch="VET_CMS") == "-342500.00", "before: Vet CMS per cabang minus (opening stuck in Pusat)")

        db.sql(TARGET.read_text())
        first = state(db)
        db.sql(TARGET.read_text())
        ok(state(db) == first, "re-applying the migration is a no-op")

        ok(db.last("select count(*) from journal_entries where source='saldo-awal-cabang';") == "6",
           "one Pusat + one branch entry for each of 110004, 110011, 110013 (110017 had no opening)")
        ok(db.last("select count(*) from journal_entries where source='saldo-awal-cabang' and source_ref='110001';") == "0",
           "rekening without branch (110001 Kas Blu) stays in Pusat")
        ok({c: saldo(db, c) for c in before} == before, "company-wide balances unchanged for every account")
        ok(saldo(db, "110004", branch="BTKM") == "2537500.00", "BTKM per cabang = opening 2.437.500 + sales 100.000")
        ok(saldo(db, "110013", branch="VET_CMS") == "-32000.00", "Vet CMS per cabang = opening 310.500 − setoran 342.500")
        ok(saldo(db, "110011", branch="SRKN") == "1686001.00", "SRKN per cabang = opening 1.686.001")
        for code in ("110004", "110011", "110013"):
            ok(saldo(db, code, pusat=True) == "0.00", f"{code} no longer has a Pusat balance")
        ok(saldo(db, "110001", pusat=True) == "527246.00", "110001 Pusat balance unchanged (opening only)")
        ok(saldo(db, "410001", branch="BTKM") == "-2437500.00", "BTKM equity carries its opening (balance sheet per cabang balances)")
        ok(db.last("select count(*) from (select entry_id from journal_lines group by entry_id having sum(debit)<>sum(credit)) x;") == "0",
           "every journal balances")
        ok(db.last("select count(*) from journal_lines where entry_id='5a1e0000-0000-4000-8000-000000000001';") == "5",
           "original saldo-awal journal untouched")
        ok(db.last("select count(distinct tanggal)||'/'||min(tanggal) from journal_entries where source='saldo-awal-cabang';") == "1/2026-10-31",
           "pemindahan dated on the opening date")

        # Monetary opening correction of a moved account now posts in the rekening's branch.
        db.sql(f"""begin;
          set local role authenticated;
          select set_config('request.jwt.claim.sub','{OWNER}',true);
          select correct_monetary_opening(c.id,2500000,'Hitung ulang kas BTKM',
            preview_monetary_opening(c.id,2500000,'Hitung ulang kas BTKM'),'fix-btkm')
            from cash_accounts c where c.coa_code='110004';
          select correct_monetary_opening(c.id,600000,'Hitung ulang Kas Blu',
            preview_monetary_opening(c.id,600000,'Hitung ulang Kas Blu'),'fix-blu')
            from cash_accounts c where c.coa_code='110001';
          commit;""")
        ok(saldo(db, "110004", branch="BTKM") == "2600000.00", "correction lands in BTKM: 2.500.000 + sales 100.000")
        ok(saldo(db, "110004", pusat=True) == "0.00", "correction does not reopen a Pusat balance")
        ok(db.last("""select count(*) from journal_entries e join journal_lines l on l.entry_id=e.id join coa_accounts a on a.id=l.account_id
            where e.source like 'cash-open-%' and a.code='110001' and e.branch_id is null;""") == "2",
           "unbound account correction still posts in Pusat")
        ok(saldo(db, "110001") == "942500.00", "Kas Blu company-wide = 600.000 + setoran 342.500")
