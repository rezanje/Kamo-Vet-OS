#!/usr/bin/env python3
"""Bagan akun baru (20261105010000) on a throwaway native PostgreSQL with fictional data only.

Applies every migration BEFORE the new chart of accounts, fills every table that stores an
account code (FK columns, text columns, JSON snapshots) with old codes plus a balanced journal,
then applies the migration and checks: codes recoded in place (same account ids, journals kept),
referencing rows cascaded, snapshots/text columns recoded, functions use only new codes, posting
helpers resolve new accounts, new chart complete with parents/headers, re-apply is a no-op, the
rollback script restores old codes and the migration installs again after rollback.

Usage: python3 scripts/test-coa-bagan-baru-postgres.py [/usr/lib/postgresql/16/bin]
"""
import importlib.util
import json
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
TARGET = "20261105010000_coa_bagan_baru.sql"
ROLLBACK = ROOT / "docs/rollback/2026-11-05-coa-bagan-baru.sql"

# Old chart as it exists before the migration (seed.sql + accounts added by earlier migrations).
OLD = [("1101", "Kas", "ASET", "D"), ("1102", "Bank BCA", "ASET", "D"), ("1201", "Piutang Usaha", "ASET", "D"),
       ("1301", "Persediaan Obat & Produk", "ASET", "D"), ("1401", "Perlengkapan Klinik", "ASET", "D"),
       ("2101", "Hutang Usaha", "LIABILITAS", "K"), ("2201", "PPN Keluaran", "LIABILITAS", "K"),
       ("2301", "Hutang Gaji", "LIABILITAS", "K"), ("3101", "Modal Pemilik", "EKUITAS", "K"),
       ("3201", "Laba Ditahan", "EKUITAS", "K"), ("4101", "Pendapatan Penjualan Produk", "PENDAPATAN", "K"),
       ("4201", "Pendapatan Jasa Klinik", "PENDAPATAN", "K"), ("5101", "Beban Pokok Penjualan", "BEBAN", "D"),
       ("5201", "Beban Gaji & Tunjangan", "BEBAN", "D"), ("5301", "Beban Listrik & Air", "BEBAN", "D"),
       ("5302", "Beban Perlengkapan", "BEBAN", "D"), ("5303", "Beban Transportasi", "BEBAN", "D"),
       ("5304", "Beban Perawatan Aset", "BEBAN", "D"), ("5401", "Beban Operasional Lain-lain", "BEBAN", "D"),
       ("5901", "Selisih Kas", "BEBAN", "D"), ("5501", "Beban Administrasi Bank", "BEBAN", "D"),
       ("4301", "Pendapatan Bunga Bank", "PENDAPATAN", "K"), ("7777", "Akun Buatan Pengguna Fiktif", "ASET", "D")]


def ok(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("PASS " + msg, flush=True)


def fill(db, table, column, value, jsonb_key=None, extra=None):
    """Insert one fictional row with only NOT NULL columns. Test-only: FKs to unrelated parents
    (sales, invoices, …) are dropped on this throwaway table so only the account-code FKs remain."""
    db.sql(f"""do $$declare c record;begin for c in select conname from pg_constraint where conrelid='public.{table}'::regclass
      and contype='f' and confrelid<>'public.coa_accounts'::regclass loop
      execute format('alter table public.{table} drop constraint %I',c.conname);end loop;end$$;""")
    cols = json.loads(db.last(f"""select coalesce(json_agg(json_build_object('n',column_name,'t',data_type,'u',udt_name) order by ordinal_position),'[]')
      from information_schema.columns where table_schema='public' and table_name='{table}'
       and is_nullable='NO' and column_default is null and column_name<>'{column}';"""))
    dummy = {"uuid": "gen_random_uuid()", "text": "'fiktif'", "character varying": "'fiktif'", "character": "'K'",
             "numeric": "1", "integer": "1", "bigint": "1", "smallint": "1", "boolean": "false", "date": "current_date",
             "timestamp with time zone": "now()", "jsonb": "'{}'::jsonb", "ARRAY": "'{}'"}
    # Values that satisfy the tables' CHECK constraints (still enforced in replica mode).
    extra = {"periode": "'2026-10'", "jenis": "'Masuk'", "method": "'Transfer'", "metode": "'Transfer'", "urutan": "1",
             "fee_percent": "0", "fee_amount": "0", "point_delta": "0", "point_restored": "0", **(extra or {})}
    names = [c["n"] for c in cols] + [column]
    values = [extra.get(c["n"], dummy.get(c["t"], "null")) for c in cols]
    values.append(f"jsonb_build_object('{jsonb_key}','{value}')" if jsonb_key else f"'{value}'")
    db.sql(f"set session_replication_role=replica;insert into public.{table}({','.join(names)}) values({','.join(values)});set session_replication_role=origin;")


def chart_state(db):
    return db.last("""select md5(string_agg(code||name||type||normal_balance||is_header::text||coalesce(parent_id::text,''),'|' order by code)) from coa_accounts;""")


if __name__ == "__main__":
    with NativePostgres(BIN) as db:
        migrations = sorted((ROOT / "supabase/migrations").glob("*.sql"))
        target = next(m for m in migrations if m.name == TARGET)
        before = [m for m in migrations if m.name < TARGET]
        after = [m for m in migrations if m.name > TARGET]
        # Same bootstrap as the shared fixture, but stop right before the new chart.
        boot = fixture.DisposablePostgres.bootstrap
        orig_glob = Path.glob
        Path.glob = lambda self, pattern: (iter(before) if self == ROOT / "supabase/migrations" and pattern == "*.sql" else orig_glob(self, pattern))
        try:
            boot(db)
        finally:
            Path.glob = orig_glob
        values = ",".join(f"('{c}','{n}','{t}','{b}')" for c, n, t, b in OLD)
        db.sql(f"insert into coa_accounts(code,name,type,normal_balance) values {values} on conflict(code) do nothing;")
        ids_before = db.last("select string_agg(code||'='||id,',' order by id) from coa_accounts where code in('1101','1301','5101','4102','1509');")
        db.sql("""insert into journal_entries(id,no_jurnal,tanggal,deskripsi,source) values('c0a00000-0000-4000-8000-000000000001','JRN-COA-1',current_date,'Fiktif','manual');
          insert into journal_lines(entry_id,account_id,debit,credit) select 'c0a00000-0000-4000-8000-000000000001',id,case code when '1101' then 1000 else 0 end,case code when '3101' then 1000 else 0 end from coa_accounts where code in('1101','3101');""")
        fill(db, "cash_entries", "lawan_code", "5401")
        fill(db, "budgets", "coa_code", "5302")
        fill(db, "budget_transfers", "dari_coa", "5302", extra={"ke_coa": "'5303'"})
        fill(db, "sale_payments", "coa_code", "1102")
        fill(db, "sale_payments", "account_snapshot", "1101", jsonb_key="code", extra={"coa_code": "'1101'"})
        fill(db, "sales_refund_payouts", "account_snapshot", "1102", jsonb_key="coa_code")
        fill(db, "clinic_refunds", "account_snapshot", "1101", jsonb_key="coa_code")
        fill(db, "invoice_payments", "kas_code", "1102")
        fill(db, "clinic_payment_receipt_parts", "kas_code", "1101")
        fill(db, "bank_reconciliations", "bank_coa_code", "1102")
        fill(db, "asset_categories", "akun_beban", "5601")
        print("Seeded fictional old-code rows in every code-bearing table.", flush=True)

        db.sql("begin;\n" + target.read_text() + "\ncommit;")
        ok(db.last("select string_agg(code||'='||id,',' order by id) from coa_accounts where code in('110003','170001','600001','520002','200015');")
           == ids_before.replace("1101=", "110003=").replace("1301=", "170001=").replace("5101=", "600001=").replace("4102=", "520002=").replace("1509=", "200015="),
           "system accounts recoded in place (same ids)")
        ok(db.last("select sum(l.debit) filter(where a.code='110003')||'/'||sum(l.credit) filter(where a.code='410001') from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id='c0a00000-0000-4000-8000-000000000001';") == "1000/1000",
           "existing journal follows the recoded accounts")
        ok(db.last("""select (select count(*) from cash_entries where lawan_code='760003')::text||(select count(*) from budgets where coa_code='740001')
          ||(select count(*) from budget_transfers where dari_coa='740001')::text||(select count(*) from sale_payments where coa_code='120002')
          ||(select count(*) from cash_accounts where coa_code in('110003','120002'));""") == "11112", "FK columns cascaded")
        ok(db.last("""select (select count(*) from sale_payments where account_snapshot->>'code'='110003')::text||(select count(*) from sales_refund_payouts where account_snapshot->>'coa_code'='120002')
          ||(select count(*) from clinic_refunds where account_snapshot->>'coa_code'='110003')::text||(select count(*) from invoice_payments where kas_code='120002')
          ||(select count(*) from clinic_payment_receipt_parts where kas_code='110003')::text||(select count(*) from bank_reconciliations where bank_coa_code='120002')
          ||(select count(*) from asset_categories where akun_beban in('5601') or akun_akumulasi in('1509'))::text;""") == "1111110", "text columns and JSON snapshots recoded")
        ok(db.last("select count(*) from coa_accounts where code ~ '^(1101|1102|1301|2101|3101|4101|5101|5401|5902)$';") == "0", "no old system code left")
        ok(db.last("select count(*) from coa_accounts where code='7777' and name='Akun Buatan Pengguna Fiktif';") == "1", "user-created account untouched")
        ok(db.last("select stock_opname_account('inventory')||'/'||stock_opname_account('variance')||'/'||unit_posting_cash('Tunai',null)||'/'||unit_posting_cash('Transfer',null);") == "170001/720010/110003/120002",
           "posting helpers resolve the new accounts")
        ok(db.last("select count(*) from coa_accounts c join coa_accounts p on p.id=c.parent_id where c.code in('110003','170001','600001','720010') and p.is_header;") == "4",
           "recoded accounts hang under their new headers")
        ok(db.last("select count(*) from coa_accounts where code ~ '^[1-8][0-9]{5}$';") == "207", "complete 207-account chart")
        ok(db.last("select coa_type_for_code('200015')||coa_type_for_code('312005')||coa_type_for_code('810001')||coa_type_for_code('820004')||coalesce(coa_type_for_code('900001'),'-');")
           == "ASETLIABILITASPENDAPATANBEBAN-", "coa_type_for_code follows the new chart")
        state = chart_state(db)
        db.sql("begin;\n" + target.read_text() + "\ncommit;")
        ok(chart_state(db) == state, "re-applying the migration is a no-op")

        # Posting through a real atomic path after recode: inventory adjustment (I02) uses 170001/720010.
        db.sql("""alter table profiles disable trigger guard_profile_privileges;
          insert into auth.users(id) values('c0a10000-0000-4000-8000-000000000001');
          update profiles set role='OWNER',is_active=true where id='c0a10000-0000-4000-8000-000000000001';
          alter table profiles enable trigger guard_profile_privileges;
          insert into branches(id,code,name,type) values('c0a20000-0000-4000-8000-000000000001','COA','COA fiksi','PETSHOP');
          insert into warehouses(id,branch_id,code,name,type) values('c0a30000-0000-4000-8000-000000000001','c0a20000-0000-4000-8000-000000000001','COA','Gudang fiksi','RETAIL');
          insert into items(id,code,name,unit,item_type,buy_price) values('c0a40000-0000-4000-8000-000000000001','COA-A','Barang fiksi','pcs','Persediaan',100);
          select stock_in_fifo('c0a30000-0000-4000-8000-000000000001','c0a40000-0000-4000-8000-000000000001',5,100,'saldo-awal','COA-BASE',current_date-1);""")
        receipt = json.loads(db.last("""set role authenticated;select set_config('request.jwt.claim.sub','c0a10000-0000-4000-8000-000000000001',false);
          select post_inventory_adjustment_atomic('coa-1','c0a30000-0000-4000-8000-000000000001',current_date,'hilang',null,'[{"item_id":"c0a40000-0000-4000-8000-000000000001","qty_baru":3}]'::jsonb);"""))
        ok(db.last(f"select string_agg(a.code||':'||l.debit||':'||l.credit,',' order by a.code) from journal_lines l join coa_accounts a on a.id=l.account_id where l.entry_id='{receipt['journal_id']}';")
           == "170001:0:200.00,720010:200.00:0", "real posting after recode lands on 170001/720010")

        db.sql(ROLLBACK.read_text())
        ok(db.last("select count(*) from coa_accounts where code in('1101','1102','1301','5101','4102','3101');") == "6", "rollback restores old system codes")
        ok(db.last("select stock_opname_account('inventory')||'/'||unit_posting_cash('Tunai',null)||'/'||(select lawan_code from cash_entries limit 1);") == "1301/1101/5401",
           "rollback restores functions and cascaded rows")
        ok(db.last("select count(*) from coa_accounts where code ~ '^[1-8][0-9]{5}$';") == "0", "rollback removes the unused new accounts")
        db.sql("begin;\n" + target.read_text() + "\ncommit;")
        ok(db.last("select stock_opname_account('inventory')||'/'||unit_posting_cash('Transfer',null);") == "170001/120002", "migration installs again after rollback")
        for m in after:
            db.sql("begin;\n" + m.read_text() + "\ncommit;")
        print(f"Applied {len(after)} later migrations after the new chart.", flush=True)
