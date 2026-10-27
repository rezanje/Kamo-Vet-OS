#!/usr/bin/env python3
"""R05: private report preset guard vs the app's saved-URL allowlist, on a throwaway native PostgreSQL.

No Docker, no DB URL: initdb into a temp dir, unix socket only, deleted at the end.
Usage: python3 scripts/test-private-report-presets-native-postgres.py [/path/to/postgresql/bin]
(default: $PG_BIN, then /usr/lib/postgresql/16/bin). Run as root, it uses the `postgres` OS user.

Checks:
- every report path and every query key the app keeps in `src/lib/report-presets.ts` is accepted by the
  database guard after all preset migrations (so a preset the UI offers can actually be saved);
- report-specific keys stay rejected on other reports; unknown keys, other users' rows and accounts
  without report access stay denied; re-running the latest patch fails closed on drift.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PG_BIN", "/usr/lib/postgresql/16/bin"))
MIGRATIONS = [
    "20261023154500_private_report_presets.sql",
    "20261025110800_private_report_branch_filter.sql",
    "20261025173500_private_report_opname_preset.sql",
    "20261026000345_private_report_sales_performer_filter.sql",
    "20261027090000_private_report_promo_history_presets.sql",
]
USER_A = "fa100000-0000-4000-8000-000000000001"
USER_B = "fa100000-0000-4000-8000-000000000002"
STAFF = "fa100000-0000-4000-8000-000000000003"


def app_allowlist():
    source = (ROOT / "src/lib/report-presets.ts").read_text()
    sets = {name: re.findall(r"'([^']+)'", body) for name, body in re.findall(r"const (\w+)=new Set\(\[([^\]]*)\]\)", source)}
    specific = {}
    for path, name in re.findall(r"path==='(/laporan/[^']+)'&&(\w+)\.has\(key\)", source):
        specific.setdefault(path, []).extend(sets[name])
    assert sets.get("paths") and sets.get("filters") and specific, "report-presets.ts allowlist not found"
    return sets["paths"], sets["filters"], specific


class NativePostgres:
    def __enter__(self):
        self.root = Path(tempfile.mkdtemp(prefix="pgr05."))
        self.as_user = ["runuser", "-u", "postgres", "--"] if os.geteuid() == 0 else []
        if self.as_user:
            shutil.chown(self.root, "postgres")
        self.run(BIN / "initdb", "-D", self.root / "data", "-U", "postgres", "-E", "UTF8", "--locale=C.UTF-8", "-A", "trust")
        self.run(BIN / "pg_ctl", "-D", self.root / "data", "-l", self.root / "log", "-w", "start",
                 "-o", f"-c listen_addresses='' -k {self.root} -c timezone=Etc/UTC")
        return self

    def __exit__(self, *_):
        subprocess.run(self.as_user + [str(BIN / "pg_ctl"), "-D", str(self.root / "data"), "-m", "fast", "-w", "stop"], capture_output=True)
        shutil.rmtree(self.root, ignore_errors=True)
        print("Stopped and removed the throwaway PostgreSQL cluster.", flush=True)

    def run(self, *args):
        subprocess.run(self.as_user + [str(a) for a in args], check=True, capture_output=True)

    def last(self, source):
        return self.sql(source).splitlines()[-1]

    def sql(self, source):
        result = subprocess.run(self.as_user + [str(BIN / "psql"), "-X", "-qAt", "-h", str(self.root), "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
                                input=source, text=True, capture_output=True, env={**os.environ, "PSQLRC": "/dev/null"})
        if result.returncode:
            raise RuntimeError(result.stderr + result.stdout)
        return result.stdout.strip()


def as_user(user):
    return f"""set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','{user}',true);
"""


def save(db, user, href):
    return db.sql(f"begin;\n{as_user(user)}insert into private_report_presets(name,href) values('R05','{href}') returning href;\nrollback;")


def denied(db, user, href, expected="PRIVATE_PRESET_INVALID"):
    try:
        save(db, user, href)
    except RuntimeError as error:
        assert expected in str(error), str(error)
    else:
        raise AssertionError(f"Expected {expected}: {href}")


paths, filters, specific = app_allowlist()
with NativePostgres() as db:
    db.sql(f"""
create extension pgcrypto;
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$
 select current_setting('request.jwt.claim.role',true) $$;
create table public.profiles(id uuid primary key, role text not null, is_active boolean not null);
create table public.role_modules(role text not null, module_id text not null);
grant usage on schema public,auth to anon,authenticated,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
grant select on public.profiles,public.role_modules to authenticated;
insert into public.profiles values ('{USER_A}','FINANCE',true),('{USER_B}','OWNER',true),('{STAFF}','STAFF',true);
""")
    for migration in MIGRATIONS:
        db.sql("begin;\n" + (ROOT / "supabase/migrations" / migration).read_text() + "\ncommit;")

    general = "&".join(f"{key}=v{n}" for n, key in enumerate(filters))
    for path in paths:
        href = f"/laporan/{path}?{general}"
        assert href in save(db, USER_A, href), href
    for path, keys in specific.items():
        href = f"{path}?" + "&".join(f"{key}=x{n}" for n, key in enumerate(keys))
        assert href in save(db, USER_A, href), href
        other = "/laporan/pembelian" if path != "/laporan/pembelian" else "/laporan/promo"
        for key in keys:
            denied(db, USER_A, f"{other}?{key}=x")
    denied(db, USER_A, "/laporan/promo?token=secret")
    denied(db, USER_A, "/laporan/nilai-persediaan/historis/unduh?tanggal=2026-10-22")
    denied(db, USER_A, "https://evil.test/laporan/promo")

    # Same account in another browser sees the row; another account and an account without report access do not.
    db.sql(f"begin;\n{as_user(USER_A)}insert into private_report_presets(id,name,href) values"
           f"('fa200000-0000-4000-8000-000000000001','Promo Oktober','/laporan/promo?dari=2026-10-01&promo_id=p1');\ncommit;")
    assert db.last(f"begin;\n{as_user(USER_A)}select href from private_report_presets;\nrollback;") == "/laporan/promo?dari=2026-10-01&promo_id=p1"
    assert db.last(f"begin;\n{as_user(USER_B)}select count(*) from private_report_presets;\nrollback;") == "0"
    assert db.last(f"begin;\n{as_user(STAFF)}select count(*) from private_report_presets;\nrollback;") == "0"
    denied(db, STAFF, "/laporan/promo", "row-level security")
    try:
        db.sql(f"begin;\n{as_user(USER_B)}insert into private_report_presets(user_id,name,href) values('{USER_A}','spoof','/laporan/promo');\nrollback;")
    except RuntimeError as error:
        assert "PRIVATE_PRESET_DENIED" in str(error) or "row-level security" in str(error), str(error)
    else:
        raise AssertionError("Expected another user's row to be refused")

    try:
        db.sql("begin;\n" + (ROOT / "supabase/migrations" / MIGRATIONS[-1]).read_text() + "\nrollback;")
    except RuntimeError as error:
        assert "R05_PRIVATE_PRESET_VALIDATION_DRIFT" in str(error), str(error)
    else:
        raise AssertionError("Expected the patch to refuse a second application")
    assert db.sql("select has_table_privilege('anon','public.private_report_presets','SELECT');") == "f"
    assert db.sql("select has_function_privilege('authenticated','public.guard_private_report_preset()','EXECUTE');") == "f"
    version = db.sql("show server_version;")
    print(f"PASS on PostgreSQL {version}: {len(paths)} report paths, {len(filters)} shared keys and "
          f"{sum(map(len, specific.values()))} report-specific keys accepted as in report-presets.ts; "
          "cross-report keys, unknown keys, other accounts and no-access accounts refused; patch is single-use.")
