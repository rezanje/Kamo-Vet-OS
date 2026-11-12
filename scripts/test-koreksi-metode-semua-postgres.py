#!/usr/bin/env python3
"""Native PostgreSQL proof: koreksi metode bayar klinik rawat jalan ke semua metode (30 pasangan, aturan rekening live, izin khusus). Petshop SENGAJA tidak termasuk (PR #412/#510).

Never accepts a database URL; throwaway socket-only cluster, fictional fixtures.

  --baseline    chain WITHOUT the candidate migration (RED: the suite must fail)
  (default)     chain WITH the candidate (GREEN)
  --mutations   per-guard mutants of the candidate; control must pass, every mutant must fail
  --regression  also run the older J02 suites on the candidate chain
  --json FILE   write a machine-readable report
Run: flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-koreksi-metode-semua-postgres.py --pg-bin /opt/data/kamo-pg-harness/bin
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

CANDIDATE = "20261115900000_ubah_metode_bayar.sql"
SUITE = "payment_method_any_corrections.sql"
HOSTED_AUTH_UID = (ROOT / "supabase/tests/fixtures/hosted_auth_uid.sql").read_text()
SHIMS = """create extension pgcrypto;
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
""" + HOSTED_AUTH_UID + """
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
create publication supabase_realtime;
grant usage on schema public,auth,storage to authenticated,anon,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
alter default privileges in schema public grant all on tables to authenticated,service_role;
alter default privileges in schema public grant all on sequences to authenticated,service_role;
"""


class Cluster(NativePostgres):
    def q(self, source, db="postgres"):
        r = subprocess.run(self.as_user + [self.psql_path, "-X", "-qAt", "-h", str(self.root), "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
                           input=source, text=True, capture_output=True, env={**os.environ, "PSQLRC": "/dev/null", "PGDATABASE": db})
        if r.returncode:
            raise RuntimeError(r.stderr + r.stdout)
        return r.stdout.strip()


def make_cluster(bin_dir):
    c = Cluster(bin_dir)
    c.psql_path = c.psql
    return c


def build_base(c, include_candidate):
    c.q(SHIMS)
    migrations = sorted((ROOT / "supabase/migrations").glob("*.sql"))
    if not include_candidate:
        migrations = [m for m in migrations if m.name < CANDIDATE]
    for m in migrations:
        if m.name.startswith("0068"):
            c.q("insert into coa_accounts(code,name,type,normal_balance) values('1101','Fictional test cash','ASET','D'),('1102','Fictional test bank','ASET','D') on conflict do nothing;")
        try:
            c.q("begin;\n" + m.read_text() + "\ncommit;")
        except RuntimeError as e:
            raise RuntimeError(m.name + ": " + str(e)) from e
    return len(migrations)


def run_suite(c, db, name=SUITE):
    t = time.time()
    try:
        c.q((ROOT / "supabase/tests" / name).read_text(), db)
        return {"suite": name, "ok": True, "seconds": round(time.time() - t, 1), "error": None}
    except RuntimeError as e:
        return {"suite": name, "ok": False, "seconds": round(time.time() - t, 1), "error": str(e).strip().splitlines()[0][:400]}


MUTATIONS = [
    ("clinic DEMO guard removed", "if exists(select 1 from public.clinic_demo_invoice_snapshots where invoice_id=inv.id) then", "if false and exists(select 1 from public.clinic_demo_invoice_snapshots where invoice_id=inv.id) then", 1),
    ("clinic receipt guard removed", "if pay.receipt_id is not null then", "if false then", 1),
    ("clinic label-only branch removed", "$r$ if from_code<>to_code then\n journal:=", "$r$ if true then\n journal:=", 1),
    ("clinic destination whitelist back to two", "$r$p_new_method not in('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet')$r$", "$r$p_new_method not in('Tunai','Transfer')$r$", 1),
    ("clinic source whitelist back to two", "$r$old_method not in('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') then", "$r$old_method not in('Tunai','Transfer') then", 1),
    ("clinic same-account asset count", "(case when from_code=to_code then 1 else 2 end)", "2", 1),
]

PRESERVED = ["guard_clinic_payment_corrected_invoice()", "clinic_write_journal(date,text,text,text,uuid,jsonb)", "clinic_receive_visit_payment(uuid,text,date,jsonb,uuid,text)",
             "clinic_cancel_invoice_receipt(uuid,text,text,date)"]


def fingerprint(c, db):
    rows = []
    for sig in PRESERVED + ["correct_clinic_invoice_payment(uuid,uuid,integer,text,text,text)", "correct_clinic_receipt_part_method(uuid,uuid,text,text,text)"]:
        out = c.q(f"""select coalesce((select md5(pg_get_functiondef(p.oid))||'|'||p.prosecdef||'|'||coalesce(p.proconfig::text,'')||'|'||
 coalesce(p.proacl::text,'')||'|'||p.proowner::regrole::text from pg_proc p where p.oid=to_regprocedure('public.{sig}')),'absent')""", db)
        rows.append((sig, out))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg-bin", default="/opt/data/kamo-pg-harness/bin")
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--mutations", action="store_true")
    ap.add_argument("--regression", action="store_true")
    ap.add_argument("--json")
    a = ap.parse_args()
    report = {"candidate": CANDIDATE, "candidate_sha256": hashlib.sha256((ROOT / "supabase/migrations" / CANDIDATE).read_bytes()).hexdigest(),
              "suite_sha256": hashlib.sha256((ROOT / "supabase/tests" / SUITE).read_bytes()).hexdigest(), "mode": None}
    with make_cluster(a.pg_bin) as c:
        version = c.q("show server_version")
        report["server_version"] = version
        assert version.startswith("17."), "PostgreSQL 17 expected, got " + version
        if a.baseline:
            report["mode"] = "baseline-RED"
            n = build_base(c, include_candidate=False)
            c.q("create database t_base template postgres")
            report["migrations_applied"] = n
            r = run_suite(c, "t_base")
            report["results"] = [r]
            print(("RED as expected: " if not r["ok"] else "UNEXPECTED PASS: ") + str(r["error"]))
            ok = not r["ok"]
        else:
            n = build_base(c, include_candidate=False)
            report["migrations_applied_before_candidate"] = n
            c.q("create database t_base template postgres")
            cand = (ROOT / "supabase/migrations" / CANDIDATE).read_text()
            if a.mutations:
                report["mode"] = "mutations"
                results = []
                variants = [("control (unmodified)", cand)]
                for name, old, new, count in MUTATIONS:
                    assert cand.count(old) == count, f"mutation anchor stale: {name}: found {cand.count(old)}"
                    variants.append((name, cand.replace(old, new)))
                for i, (name, text) in enumerate(variants):
                    db = f"v_{i}"
                    c.q(f"create database {db} template t_base")
                    c.q("begin;\n" + text + "\ncommit;", db)
                    r = run_suite(c, db)
                    r["variant"] = name
                    r["expected"] = "pass" if i == 0 else "fail"
                    r["verdict"] = "OK" if (r["ok"] if i == 0 else not r["ok"]) else "BAD"
                    results.append(r)
                    print(f"[{r['verdict']}] {name}: {'pass' if r['ok'] else 'fail: ' + str(r['error'])[:140]}", flush=True)
                report["results"] = results
                ok = all(r["verdict"] == "OK" for r in results)
            else:
                report["mode"] = "green"
                c.q("create database t_green template t_base")
                c.q("begin;\n" + cand + "\ncommit;", "t_green")
                r = run_suite(c, "t_green")
                report["results"] = [r]
                print(("PASS " if r["ok"] else "FAIL ") + SUITE + f" ({r['seconds']}s)" + ("" if r["ok"] else ": " + r["error"]))
                ok = r["ok"]
                before = fingerprint(c, "t_base")
                after = fingerprint(c, "t_green")
                diffs = []
                for (sig, b), (_, af) in zip(before, after):
                    same = b == af
                    if sig.startswith("correct_clinic_invoice_payment"):
                        bparts, aparts = b.split("|"), af.split("|")
                        same_attrs = bparts[1:] == aparts[1:]
                        diffs.append({"function": sig, "body_changed": bparts[0] != aparts[0], "definer_config_acl_owner_unchanged": same_attrs})
                        ok = ok and same_attrs and bparts[0] != aparts[0]
                    elif sig.startswith("correct_clinic_receipt_part_method"):
                        diffs.append({"function": sig, "new": b == "absent" and af != "absent", "definition": af})
                        ok = ok and b == "absent" and af != "absent"
                    else:
                        diffs.append({"function": sig, "byte_identical_definition_acl_owner": same})
                        ok = ok and same
                report["function_invariants"] = diffs
                for d in diffs:
                    print(" ", d if "definition" not in d else {k: v for k, v in d.items() if k != "definition"})
                acl = c.q("select has_function_privilege('authenticated','public.correct_clinic_receipt_part_method(uuid,uuid,text,text,text)','execute'),"
                             "has_function_privilege('anon','public.correct_clinic_receipt_part_method(uuid,uuid,text,text,text)','execute'),"
                             "has_function_privilege('service_role','public.correct_clinic_receipt_part_method(uuid,uuid,text,text,text)','execute')", "t_green")
                report["new_function_acl_authenticated_anon_service"] = acl
                ok = ok and acl == "t|f|f"
                print("  new function ACL (authenticated|anon|service_role):", acl)
                if a.regression:
                    for name in ["pos_payment_method_corrections.sql", "clinic_payment_method_corrections.sql"]:  # POS: bukti BYTE-IDENTIK (migrasi ini tidak menyentuh petshop)
                        db = "t_reg_" + name.split("_")[0]
                        c.q(f"create database {db} template t_base")
                        c.q("begin;\n" + cand + "\ncommit;", db)
                        rr = run_suite(c, db, name)
                        report["results"].append(rr)
                        print(("PASS " if rr["ok"] else "FAIL ") + name + ("" if rr["ok"] else ": " + str(rr["error"])))
                        ok = ok and rr["ok"]
        report["ok"] = ok
    if a.json:
        Path(a.json).write_text(json.dumps(report, indent=1, ensure_ascii=False))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
