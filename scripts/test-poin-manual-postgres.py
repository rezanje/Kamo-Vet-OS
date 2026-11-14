#!/usr/bin/env python3
"""D1 (meeting 12 Nov 2026): sesuaikan poin pelanggan manual (migrasi 20261114085215_d1_poin_manual.sql).

Native throwaway PostgreSQL only (full migration chain, fictional fixtures). Never accepts a database URL, no network.

  python3 -I scripts/test-poin-manual-postgres.py [--pg-bin DIR] [--json out.json] [--baseline]
  (default)   chain without candidate -> fixtures -> candidate -> behaviour checks.
  --baseline  same fixtures WITHOUT the candidate: every feature case must FAIL (RED).
"""
import argparse, importlib.util, json, os, sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
CANDIDATE = ROOT / "supabase/migrations/20261114085215_d1_poin_manual.sql"
RESULTS = []

U = lambda n: f"d1000000-0000-4000-8000-{n:012d}"
OWNER, OWNER_OFF, ADMIN, FINANCE, STAFF = (U(i) for i in range(1, 6))
CUST, CUST2 = U(101), U(102)
K = lambda n: f"d1aaaaaa-0000-4000-8000-{n:012d}"


def q(v): return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def check(name, ok, detail=None, kind="feature"):
    RESULTS.append(dict(case=name, kind=kind, status="PASS" if ok else "FAIL", detail=detail))
    print(RESULTS[-1]["status"], name, json.dumps(detail, default=str)[:300], flush=True)


class _HoldBack:
    """Shared fixture bootstrap, every migration except the candidate."""
    def __init__(self, db): self.db = db
    def sql(self, source):
        if source == "begin;\n" + CANDIDATE.read_text() + "\ncommit;": return ""
        return self.db.sql(source)


class H:
    def __init__(self, db): self.db = db
    def sql(self, s): return self.db.sql(s)

    def val(self, s, user=None, role="authenticated"):
        if user is None and role == "authenticated": out = self.db.sql(s)
        else:
            out = self.db.sql(f"begin;\nset local role {role};\n"
                              + (f"select set_config('request.jwt.claim.sub',{q(user)},true);\n"
                                 f"select set_config('request.jwt.claims',{q(json.dumps(dict(sub=user, role=role)))},true);\n"
                                 f"select set_config('request.jwt.claim.role',{q(role)},true);\n" if user else "")
                              + s + "\ncommit;")
        lines = [x for x in out.splitlines() if x != ""]
        return lines[-1] if lines else ""

    def err(self, s, user=None, role="authenticated"):
        try: self.val(s, user, role); return None
        except RuntimeError as e: return str(e)


def prep(h):
    users = [(OWNER, "Owner Fiktif", "OWNER"), (OWNER_OFF, "Owner Nonaktif", "OWNER"), (ADMIN, "Admin Fiktif", "ADMIN"),
             (FINANCE, "Finance Fiktif", "FINANCE"), (STAFF, "Staf Fiktif", "STAFF")]
    h.sql("insert into auth.users(id,raw_user_meta_data) values " + ",".join(f"({q(u)},{q(json.dumps(dict(full_name=n)))}::jsonb)" for u, n, _ in users) + ";")
    h.sql("".join(f"update public.profiles set role={q(r)},is_active=true where id={q(u)};" for u, _, r in users)
          + f"update public.profiles set is_active=false where id={q(OWNER_OFF)};")
    h.sql(f"insert into public.customers(id,name,phone,points) values ({q(CUST)},'Pelanggan Fiktif D1','081100000001',0),({q(CUST2)},'Pelanggan Fiktif D1b','081100000002',50);")


def adj(h, user, cust, delta, reason, key):
    try:
        return None, json.loads(h.val(f"select public.adjust_customer_points({q(cust)},{delta},{q(reason)},{q(key)}::uuid);", user))
    except RuntimeError as e: return str(e), None


def points(h, cust): return int(h.val(f"select points from public.customers where id={q(cust)}"))


def ledger(h, cust):
    return json.loads(h.val(f"select coalesce(jsonb_agg(jsonb_build_object('delta',delta,'saldo',saldo,'type',entry_type,'by',created_by,'reason',reason,'key',request_key,'desc',description,'ref',ref) order by created_at,id),'[]') from public.point_ledger where customer_id={q(cust)}"))


def run(h):
    e, r = adj(h, OWNER, CUST, 1500, "  Saldo poin sistem lama  ", K(1))
    check("Owner menambah 1500 poin: berhasil, saldo 1500", e is None and r and r["saldo"] == 1500 and r["already_applied"] is False, e or r)
    lg = ledger(h, CUST)
    check("riwayat poin: 1 baris adjustment, saldo berjalan, pelaku, alasan (dipangkas), kunci, deskripsi berisi alasan",
          len(lg) == 1 and lg[0]["delta"] == 1500 and lg[0]["saldo"] == 1500 and lg[0]["type"] == "adjustment" and lg[0]["by"] == OWNER
          and lg[0]["reason"] == "Saldo poin sistem lama" and lg[0]["key"] == K(1) and "Saldo poin sistem lama" in lg[0]["desc"] and lg[0]["ref"].startswith("MANUAL-"), lg)
    check("customers.points ikut 1500", points(h, CUST) == 1500)
    e, r = adj(h, OWNER, CUST, 1500, "Saldo poin sistem lama", K(1))
    check("kirim ulang kunci sama + isi sama: hasil lama, tidak dobel", e is None and r and r["already_applied"] is True and len(ledger(h, CUST)) == 1 and points(h, CUST) == 1500, e or r)
    e, _ = adj(h, OWNER, CUST, 999, "Saldo poin sistem lama", K(1))
    check("kunci sama + isi beda: ditolak", bool(e) and "POIN_MANUAL_KUNCI_DIPAKAI" in e and points(h, CUST) == 1500, e)
    e, r = adj(h, OWNER, CUST, -500, "Salah input", K(2))
    check("Owner mengurangi 500: saldo 1000", e is None and r["saldo"] == 1000 and points(h, CUST) == 1000, e or r)
    e, _ = adj(h, OWNER, CUST, -1001, "Kurangi kebanyakan", K(3))
    check("saldo tidak boleh minus: ditolak, tidak ada yang berubah", bool(e) and "POIN_MANUAL_MINUS" in e and "1000" in e and points(h, CUST) == 1000 and len(ledger(h, CUST)) == 2, e)
    for name, args, code in [("jumlah nol", (0, "alasan ok"), "POIN_MANUAL_JUMLAH"), ("jumlah > 10 juta", (10000001, "alasan ok"), "POIN_MANUAL_JUMLAH"),
                             ("alasan kosong", (5, "  "), "POIN_MANUAL_ALASAN"), ("alasan > 300", (5, "x" * 301), "POIN_MANUAL_ALASAN")]:
        e, _ = adj(h, OWNER, CUST, args[0], args[1], K(10 + len(RESULTS)))
        check(f"validasi: {name} ditolak", bool(e) and code in e, e)
    e = h.err(f"select public.adjust_customer_points({q(CUST)},5,'alasan ok',null);", OWNER)
    check("kunci kosong ditolak", bool(e) and "POIN_MANUAL_KUNCI" in e, e)
    e, _ = adj(h, OWNER, U(999), 5, "alasan ok", K(4))
    check("pelanggan tidak ada: ditolak", bool(e) and "POIN_MANUAL_PELANGGAN" in e, e)
    # peran
    for who, name in [(ADMIN, "ADMIN tanpa kebijakan"), (FINANCE, "FINANCE tanpa kebijakan"), (STAFF, "STAFF"), (OWNER_OFF, "Owner nonaktif")]:
        e, _ = adj(h, who, CUST2, 10, "hadiah quest", K(20 + len(RESULTS)))
        check(f"{name}: ditolak (izin khusus bawaan mati)", bool(e) and "POIN_MANUAL_DITOLAK" in e and points(h, CUST2) == 50, e)
    check("customer_points_adjust_allowed: Owner true, ADMIN false",
          h.val("select public.customer_points_adjust_allowed();", OWNER) == "t" and h.val("select public.customer_points_adjust_allowed();", ADMIN) == "f")
    h.sql("alter table role_settings_private.action_policies disable trigger user;"
          "insert into role_settings_private.action_policies(role,allowed) values('ADMIN',array['crm.poin_manual']) on conflict(role) do update set allowed=excluded.allowed;"
          "insert into role_settings_private.action_policies(role,allowed) values('FINANCE',array['kasir.diskon_manual']) on conflict(role) do update set allowed=excluded.allowed;"
          "alter table role_settings_private.action_policies enable trigger user;")
    e, r = adj(h, ADMIN, CUST2, 10, "hadiah quest", K(5))
    check("ADMIN yang dicentang Owner: boleh", e is None and r["saldo"] == 60, e or r)
    e, _ = adj(h, FINANCE, CUST2, 10, "hadiah quest", K(6))
    check("FINANCE dengan kebijakan tanpa izin ini: ditolak", bool(e) and "POIN_MANUAL_DITOLAK" in e, e)
    e = h.err(f"select public.adjust_customer_points({q(CUST2)},5,'alasan ok',{q(K(7))}::uuid);", None, "anon")
    check("anon tidak bisa memanggil", bool(e) and "permission denied" in e, e)
    # penjaga kolom jejak (klien menulis point_ledger langsung lewat RLS terbuka)
    h.val(f"insert into public.point_ledger(customer_id,delta,saldo,ref,description,created_by,reason,request_key) values ({q(CUST2)},1,61,'X','klien',{q(OWNER)},'palsu',{q(K(8))});", STAFF)
    row = json.loads(h.val(f"select to_jsonb(x) from (select created_by,reason,request_key from public.point_ledger where customer_id={q(CUST2)} and ref='X') x"))
    check("klien menulis kolom jejak langsung: dikosongkan penjaga", row == {"created_by": None, "reason": None, "request_key": None}, row)
    h.val(f"update public.point_ledger set reason='ubah', created_by={q(STAFF)} where request_key={q(K(5))};", STAFF)
    row = json.loads(h.val(f"select to_jsonb(x) from (select created_by,reason from public.point_ledger where request_key={q(K(5))}) x"))
    check("klien mengubah kolom jejak: tetap nilai lama", row == {"created_by": ADMIN, "reason": "hadiah quest"}, row)
    act = h.val(f"select count(*) from public.activity_log where entity='customers' and entity_id={q(CUST)}")
    check("Log Aktifitas mencatat perubahan poin pelanggan", int(act or 0) >= 2, act)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--json", type=Path); ap.add_argument("--pg-bin", default=os.environ.get("PG_BIN", "/usr/lib/postgresql/16/bin"))
    ap.add_argument("--baseline", action="store_true"); a = ap.parse_args()
    with NativePostgres(a.pg_bin) as db:
        fixture.DisposablePostgres.bootstrap(_HoldBack(db))
        h = H(db); prep(h)
        if not a.baseline: h.sql("begin;\n" + CANDIDATE.read_text() + "\ncommit;")
        try: run(h)
        except Exception as e: check("battery", False, str(e)[:300])
    feature = [r for r in RESULTS if r["kind"] == "feature"]
    if a.baseline:
        red = [r for r in feature if r["status"] == "FAIL"]
        print(f"BASELINE: {len(red)}/{len(feature)} feature cases RED without the candidate.", flush=True)
        ok = len(red) == len(feature)
    else:
        ok = all(r["status"] == "PASS" for r in RESULTS)
        print(f"{sum(r['status'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} PASS", flush=True)
    if a.json: a.json.write_text(json.dumps(dict(candidate=CANDIDATE.name, baseline=a.baseline, ok=ok, results=RESULTS), indent=1, default=str))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
