#!/usr/bin/env python3
"""LOCAL ONLY — COA master import (Andri 3632) on a throwaway native PostgreSQL.

Applies EVERY repository migration (no business stubs), seeds fictional OWNER/ADMIN/STAFF/DOCTOR/
FINANCE users, then:
  1. calls the public writer as role `authenticated` with fictional JWT actors (access, backstop
     validation, atomic rollback, stale version, no journals);
  2. runs src/lib/__tests__/impor-akun-native.test.ts against the same cluster (parser → preview →
     real server action → real writer → readback).

Usage: KAMO_PG_BIN=/usr/lib/postgresql/16/bin python3 scripts/test-coa-import-postgres.py [result.json]
"""
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

BIN = os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin")
USERS = {
    "OWNER": "c0a00000-0000-4000-8000-000000000001",
    "ADMIN": "c0a00000-0000-4000-8000-000000000002",
    "STAFF": "c0a00000-0000-4000-8000-000000000003",
    "DOCTOR": "c0a00000-0000-4000-8000-000000000004",
    "FINANCE": "c0a00000-0000-4000-8000-000000000005",
    "ADMIN_NONAKTIF": "c0a00000-0000-4000-8000-000000000006",
}
RESULTS = []


def record(name, ok, detail=""):
    RESULTS.append({"case": name, "status": "PASS" if ok else "FAIL", "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail and not ok else ""), flush=True)


def q(value):
    return "'" + str(value).replace("'", "''") + "'"


def as_user(user):
    return ("set role authenticated;"
            f"select set_config('request.jwt.claims',{q(json.dumps({'sub': user, 'role': 'authenticated'}))},false);")


def attempt(db, source, user):
    """Run as an authenticated actor; return (ok, output-or-error)."""
    try:
        return True, db.sql("begin;" + as_user(user) + source + ";commit;")
    except RuntimeError as error:
        return False, str(error)


def snapshot(db):
    return db.sql("select md5(coalesce(string_agg(code||name||type||normal_balance||is_header::text||is_active::text"
                  "||coalesce(parent_id::text,''),',' order by code),'')) from public.coa_accounts;")


def money(db):
    return db.sql("select (select count(*) from public.journal_entries)||'/'||(select count(*) from public.journal_lines);")


def version(db, user):
    ok, out = attempt(db, "select public.read_coa_import_context()->>'versi'", user)
    if not ok:
        raise RuntimeError(out)
    return out.splitlines()[-1]


def rows(*items):
    base = {"type": "BEBAN", "normal_balance": "D", "is_header": False, "is_active": None, "set_parent": False, "parent_code": None}
    return json.dumps([{**base, **item} for item in items])


def call(rows_json, ver):
    return f"select public.import_coa_accounts({q(rows_json)}::jsonb,{q(ver)}::text)"


def seed(db):
    for role, uid in USERS.items():
        db.sql(f"insert into auth.users(id,email,email_confirmed_at) values({q(uid)},{q(role.lower() + '@fiktif.test')},now());")
        real = "ADMIN" if role == "ADMIN_NONAKTIF" else role
        db.sql(f"update public.profiles set role={q(real)},is_active={str(role != 'ADMIN_NONAKTIF').lower()},full_name={q(role + ' fiktif')} where id={q(uid)};")
    # One fictional detail account with a posted journal, to prove "used in journals" protection.
    db.sql("""insert into public.coa_accounts(code,name,type,normal_balance) values('5798','Beban Berjurnal Fiktif','BEBAN','D');
    insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source) values('c0a00000-0000-4000-8000-0000000000e1','JF-COA-1','2026-10-01','Jurnal fiktif','manual');
    insert into public.journal_lines(entry_id,account_id,debit,credit)
      select 'c0a00000-0000-4000-8000-0000000000e1'::uuid,id,1000,0 from public.coa_accounts where code='5798'
      union all select 'c0a00000-0000-4000-8000-0000000000e1'::uuid,id,0,1000 from public.coa_accounts where code='1101';""")


def denied(out):
    return "42501" in out or "permission denied" in out or "COA_IMPORT_ACCESS_DENIED" in out


def run(db):
    exists = db.sql("select to_regprocedure('public.import_coa_accounts(jsonb,text)') is not null "
                    "and to_regprocedure('public.read_coa_import_context()') is not null;")
    record("writer-and-context-rpc-installed", exists == "t", exists)
    seed(db)
    if exists != "t":
        app_suite(db)
        return
    owner, admin = USERS["OWNER"], USERS["ADMIN"]

    # ── access ───────────────────────────────────────────────────────────────
    before = snapshot(db)
    ver = version(db, owner)
    good = rows({"code": "5781", "name": "Beban Akses Fiktif"})
    for role in ("STAFF", "DOCTOR", "FINANCE", "ADMIN_NONAKTIF"):
        ok1, out1 = attempt(db, "select public.read_coa_import_context()", USERS[role])
        ok2, out2 = attempt(db, call(good, ver), USERS[role])
        record(f"{role}-denied-read-and-write", not ok1 and not ok2 and denied(out1) and denied(out2) and snapshot(db) == before,
               out1[-160:] + " | " + out2[-160:])
    try:
        db.sql("set role anon;" + call(good, ver))
        record("anon-denied", False, "anon executed writer")
    except RuntimeError as error:
        record("anon-denied", "permission denied" in str(error) and snapshot(db) == before, str(error)[-160:])
    ok, out = attempt(db, "insert into public.coa_accounts(code,name,type,normal_balance) values('5782','Langsung Nonaktif','BEBAN','D')",
                      USERS["ADMIN_NONAKTIF"])
    record("inactive-ADMIN-direct-table-write-denied", not ok and snapshot(db) == before, out[-160:])
    ok, out = attempt(db, "insert into public.coa_accounts(code,name,type,normal_balance) values('5783','Langsung Admin Aktif','BEBAN','D')", admin)
    record("active-ADMIN-manual-COA-screen-path-still-allowed", ok, out[-160:])

    # ── backstop validation: client checks are never trusted ────────────────
    ver = version(db, owner)
    base = snapshot(db)
    cases = [
        ("leading-zero-code", rows({"code": "01101", "name": "Kas Nol", "type": "ASET"}), "COA_IMPORT_CODE"),
        ("dotted-code", rows({"code": "1101.01", "name": "Kas Titik", "type": "ASET"}), "COA_IMPORT_CODE"),
        ("code-group-mismatch", rows({"code": "5784", "name": "Salah", "type": "ASET"}), "COA_IMPORT_CODE"),
        ("cash-bank-range", rows({"code": "1150", "name": "Bank", "type": "ASET"}), "COA_IMPORT_CODE"),
        ("untrimmed-code", rows({"code": " 5785", "name": "Spasi"}), "COA_IMPORT_INVALID"),
        ("name-too-long", rows({"code": "5786", "name": "N" * 81}), "COA_IMPORT_INVALID"),
        ("pl-contra-side", rows({"code": "5787", "name": "Kontra", "normal_balance": "K"}), "COA_IMPORT_INVALID"),
        ("duplicate-code", rows({"code": "5788", "name": "A"}, {"code": "5788", "name": "B"}), "COA_IMPORT_DUPLICATE"),
        ("missing-parent", rows({"code": "5789", "name": "Yatim", "set_parent": True, "parent_code": "5999"}), "COA_IMPORT_PARENT"),
        ("parent-not-header", rows({"code": "5771", "name": "Anak", "set_parent": True, "parent_code": "5798"}), "COA_IMPORT_PARENT"),
        ("group-mismatch", rows({"code": "4771", "name": "Induk P", "type": "PENDAPATAN", "normal_balance": "K", "is_header": True},
                                {"code": "5772", "name": "Anak B", "set_parent": True, "parent_code": "4771"}), "COA_IMPORT_PARENT"),
        ("cycle", rows({"code": "5773", "name": "A", "is_header": True, "set_parent": True, "parent_code": "5774"},
                       {"code": "5774", "name": "B", "is_header": True, "set_parent": True, "parent_code": "5773"}), "COA_IMPORT_CYCLE"),
        ("journaled-type-change", rows({"code": "5798", "name": "Beban Berjurnal Fiktif", "normal_balance": "D", "type": "ASET"}), "COA_IMPORT_PROTECTED"),
        ("system-normal-change", rows({"code": "1509", "name": "Akumulasi Penyusutan", "type": "ASET", "normal_balance": "D"}), "COA_IMPORT_PROTECTED"),
        ("cash-mapped-rename", rows({"code": "1102", "name": "Bank Ganti Nama", "type": "ASET"}), "COA_IMPORT_PROTECTED"),
        ("system-deactivate", rows({"code": "5101", "name": None, "is_active": False}), "COA_IMPORT_"),
        ("journaled-becomes-header", rows({"code": "5798", "name": "Beban Berjurnal Fiktif", "is_header": True}), "COA_IMPORT_PARENT"),
        ("header-with-children-becomes-detail", None, "COA_IMPORT_PARENT"),
        ("stale-version", rows({"code": "5775", "name": "Basi"}), "COA_IMPORT_STALE"),
        ("empty-payload", "[]", "COA_IMPORT_INVALID"),
    ]
    # existing header with a child, for the header→detail case
    db.sql("""insert into public.coa_accounts(code,name,type,normal_balance,is_header) values('5760','Induk Ada','BEBAN','D',true);
    insert into public.coa_accounts(code,name,type,normal_balance,parent_id) select '5761','Anak Ada','BEBAN','D',id from public.coa_accounts where code='5760';""")
    ver = version(db, owner)
    base = snapshot(db)
    name_5101 = db.sql("select name from public.coa_accounts where code='5101';")
    for name, payload, expected in cases:
        if name == "header-with-children-becomes-detail":
            payload = rows({"code": "5760", "name": "Induk Ada", "is_header": False})
        if name == "system-deactivate":
            payload = rows({"code": "5101", "name": name_5101, "is_active": False})
        ok, out = attempt(db, call(payload, "basi" if name == "stale-version" else ver), owner)
        record(f"backstop-{name}", not ok and expected in out and snapshot(db) == base, out[-200:])

    # ── happy path through the writer as ADMIN: child before parent, exact codes ──
    m0 = money(db)
    payload = rows({"code": "5751", "name": "Anak Dulu", "set_parent": True, "parent_code": "5750"},
                   {"code": "5750", "name": "Induk Belakangan", "is_header": True},
                   {"code": "575201", "name": "Cucu Enam Digit", "set_parent": True, "parent_code": "5750"})
    ok, out = attempt(db, call(payload, version(db, admin)), admin)
    linked = db.sql("select string_agg(c.code||'>'||coalesce(p.code,'-'),',' order by c.code) from public.coa_accounts c "
                    "left join public.coa_accounts p on p.id=c.parent_id where c.code in ('5750','5751','575201');")
    record("ADMIN-atomic-create-child-before-parent", ok and linked == "5750>-,5751>5750,575201>5750" and money(db) == m0,
           "linked=" + str(linked) + " " + out[-120:])
    result = json.loads(out.splitlines()[-1]) if ok else {}
    record("writer-returns-counts", result.get("dibuat") == 3 and result.get("diubah") == 0, json.dumps(result))

    # replay of the same rows: no duplicates, counted as unchanged
    count = db.sql("select count(*) from public.coa_accounts;")
    ok, out = attempt(db, call(payload, version(db, admin)), admin)
    result = json.loads(out.splitlines()[-1]) if ok else {}
    record("replay-no-duplicate", ok and db.sql("select count(*) from public.coa_accounts;") == count and result.get("sama") == 3,
           out[-200:])

    # ── final-stage failure: injected at parent linking, nothing persists ──
    db.sql("""create function public.uji_gagal_akhir() returns trigger language plpgsql as $$begin
      if new.code='5741' and new.parent_id is not null then raise exception 'injected final-stage failure'; end if; return new; end$$;
      create trigger uji_gagal_akhir before update on public.coa_accounts for each row execute function public.uji_gagal_akhir();""")
    base = snapshot(db)
    payload = rows({"code": "5740", "name": "Induk Gagal", "is_header": True},
                   {"code": "5741", "name": "Anak Gagal", "set_parent": True, "parent_code": "5740"})
    ok, out = attempt(db, call(payload, version(db, owner)), owner)
    db.sql("drop trigger uji_gagal_akhir on public.coa_accounts; drop function public.uji_gagal_akhir();")
    record("final-stage-failure-rolls-back-everything", not ok and "injected final-stage failure" in out and snapshot(db) == base
           and db.sql("select count(*) from public.coa_accounts where code in ('5740','5741');") == "0", out[-200:])

    # ── no money side-effects at all ──
    record("no-journal-or-balance-created", money(db) == m0, money(db) + " vs " + m0)

    app_suite(db)


def app_suite(db):
    """App path: parser → preview → real action → real writer → readback."""
    env = {**os.environ, "KAMO_TEST_SOCKET": str(db.root), "KAMO_TEST_PSQL": db.psql,
           "NODE_OPTIONS": "--max-old-space-size=2048 --no-experimental-webstorage",
           **{f"KAMO_TEST_{k}": v for k, v in USERS.items()}}
    run_vitest = subprocess.run(["node", "node_modules/vitest/vitest.mjs", "run", "src/lib/__tests__/impor-akun-native.test.ts"],
                                cwd=ROOT, env=env, capture_output=True, text=True)
    tail = "\n".join((run_vitest.stdout + run_vitest.stderr).splitlines()[-25:])
    print(tail, flush=True)
    record("app-action-native-suite", run_vitest.returncode == 0 and "skipped" not in tail.split("Tests")[-1], tail[-400:])


def main():
    with NativePostgres(BIN) as db:
        fixture.DisposablePostgres.bootstrap(db)
        try:
            run(db)
        except Exception as error:  # noqa: BLE001
            record("HARNESS", False, str(error)[-800:])
    totals = {s: sum(r["status"] == s for r in RESULTS) for s in ("PASS", "FAIL")}
    print("TOTAL", json.dumps(totals), flush=True)
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(json.dumps({"total": totals, "cases": RESULTS}, indent=2))
    return 1 if totals["FAIL"] or not totals["PASS"] else 0


if __name__ == "__main__":
    sys.exit(main())
