#!/usr/bin/env python3
"""D2 (meeting 12 Nov 2026): filter retensi pelanggan tidak datang N bulan (migrasi 20261118700000_d2_filter_retensi.sql).

Native throwaway PostgreSQL only (full migration chain, fictional fixtures). Never accepts a database URL, no network.

  python3 -I scripts/test-filter-retensi-postgres.py [--pg-bin DIR] [--json out.json] [--baseline]
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
CANDIDATE = ROOT / "supabase/migrations/20261118700000_d2_filter_retensi.sql"
RESULTS = []

U = lambda n: f"d2000000-0000-4000-8000-{n:012d}"
OWNER, STAFF_A, OFF = U(1), U(2), U(3)
BR_A, BR_B = U(11), U(12)
C_LAMA, C_BARU, C_NOL, C_VOID, C_ARSIP, C_CABANG_B, C_IMPOR = (U(100 + i) for i in range(7))


def q(v): return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def check(name, ok, detail=None, kind="feature"):
    RESULTS.append(dict(case=name, kind=kind, status="PASS" if ok else "FAIL", detail=detail))
    print(RESULTS[-1]["status"], name, json.dumps(detail, default=str)[:300], flush=True)


class _HoldBack:
    def __init__(self, db): self.db = db
    def sql(self, source):
        if source == "begin;\n" + CANDIDATE.read_text() + "\ncommit;": return ""
        return self.db.sql(source)


def as_user(db, user, s, role="authenticated"):
    pre = f"begin;\nset local role {role};\n"
    if user: pre += (f"select set_config('request.jwt.claim.sub',{q(user)},true);\n"
                     f"select set_config('request.jwt.claims',{q(json.dumps(dict(sub=user, role=role)))},true);\n"
                     f"select set_config('request.jwt.claim.role',{q(role)},true);\n")
    try:
        out = db.sql(pre + s + "\ncommit;")
        lines = [x for x in out.splitlines() if x]
        return None, (lines[-1] if lines else "")
    except RuntimeError as e: return str(e), None


def prep(db):
    db.sql(f"""insert into auth.users(id,raw_user_meta_data) values ({q(OWNER)},'{{}}'),({q(STAFF_A)},'{{}}'),({q(OFF)},'{{}}');
update public.profiles set role='OWNER',is_active=true where id={q(OWNER)};
update public.profiles set role='STAFF',is_active=true where id={q(STAFF_A)};
update public.profiles set role='STAFF',is_active=false where id={q(OFF)};
insert into public.branches(id,code,name,type) values ({q(BR_A)},'D2A','Klinik Fiktif A','KLINIK'),({q(BR_B)},'D2B','Klinik Fiktif B','KLINIK');
insert into public.user_branches(user_id,branch_id) values ({q(STAFF_A)},{q(BR_A)});
insert into public.customers(id,name,phone) values
 ({q(C_LAMA)},'Lama','0811'),({q(C_BARU)},'Baru','0812'),({q(C_NOL)},'Tak Pernah','0813'),({q(C_VOID)},'Batal','0814'),
 ({q(C_ARSIP)},'Arsip','0815'),({q(C_CABANG_B)},'Cabang B','0816'),({q(C_IMPOR)},'Impor','0817');
insert into public.pets(id,customer_id,name,species) select gen_random_uuid(),id,'Anabul','Kucing' from public.customers where id in ({",".join(q(c) for c in (C_LAMA,C_BARU,C_ARSIP,C_CABANG_B,C_IMPOR))});
set session_replication_role=replica;
insert into public.visits(branch_id,customer_id,pet_id,status,created_at) select {q(BR_A)},c,(select id from public.pets where customer_id=c limit 1),'Selesai',t from (values
 ({q(C_LAMA)}::uuid, now()-interval '5 months'),({q(C_BARU)}::uuid, now()-interval '5 months'),({q(C_ARSIP)}::uuid, now()-interval '6 months')) x(c,t);
insert into public.visits(branch_id,customer_id,pet_id,status,created_at,archived_at,archived_by,archive_reason) select {q(BR_A)},{q(C_ARSIP)},(select id from public.pets where customer_id={q(C_ARSIP)} limit 1),'Pembayaran',now()-interval '3 days',now(),{q(OWNER)},'data percobaan';
insert into public.visits(branch_id,customer_id,pet_id,status,created_at) select {q(BR_A)},{q(C_CABANG_B)},(select id from public.pets where customer_id={q(C_CABANG_B)} limit 1),'Selesai',now()-interval '8 months';
insert into public.visits(branch_id,customer_id,pet_id,status,created_at) select {q(BR_B)},{q(C_CABANG_B)},(select id from public.pets where customer_id={q(C_CABANG_B)} limit 1),'Selesai',now()-interval '10 days';
insert into public.visits(branch_id,customer_id,pet_id,status,created_at,legacy_source_key) select {q(BR_A)},{q(C_IMPOR)},(select id from public.pets where customer_id={q(C_IMPOR)} limit 1),'Selesai',now()-interval '20 months','IMP-1';
insert into public.sales(branch_id,customer_id,no_struk,total,created_at) values ({q(BR_A)},{q(C_BARU)},'D2-S1',1000,now()-interval '7 days');
insert into public.sales(branch_id,customer_id,no_struk,total,created_at) values ({q(BR_A)},{q(C_VOID)},'D2-S2',1000,now()-interval '9 months');
insert into public.sales(branch_id,customer_id,no_struk,total,created_at,voided_at) values ({q(BR_A)},{q(C_VOID)},'D2-S3',1000,now()-interval '5 days',now());
set session_replication_role=origin;""")


def ids(db, user, bulan):
    e, out = as_user(db, user, f"select coalesce(jsonb_agg(id order by name),'[]') from public.pelanggan_tidak_datang({bulan});")
    return e, (json.loads(out) if out else None)


def run(db):
    e, got = ids(db, OWNER, 2)
    want = sorted([C_LAMA, C_ARSIP, C_VOID, C_IMPOR])
    check("Owner, 2 bulan: tepat pelanggan yang terakhir datang > 2 bulan lalu", e is None and sorted(got) == want, e or got)
    check("datang lagi (penjualan 7 hari lalu) tidak ikut", e is None and C_BARU not in got)
    check("tidak pernah datang tidak ikut", e is None and C_NOL not in got)
    check("penjualan dibatalkan tidak dihitung datang", e is None and C_VOID in got)
    check("kunjungan diarsipkan tidak dihitung datang", e is None and C_ARSIP in got)
    e, got = ids(db, STAFF_A, 2)
    check("staf cabang A: kunjungan di cabang B tetap terhitung (lintas cabang)", e is None and C_CABANG_B not in got and sorted(got) == want, e or got)
    e, got = ids(db, OWNER, 12)
    check("12 bulan: hanya riwayat impor 20 bulan lalu", e is None and got == [C_IMPOR], e or got)
    for b in (0, 61):
        e, _ = ids(db, OWNER, b)
        check(f"bulan {b} ditolak", bool(e) and "RETENSI_BULAN" in e, e)
    e, _ = ids(db, OFF, 2)
    check("akun nonaktif ditolak", bool(e) and "RETENSI_DITOLAK" in e, e)
    e, _ = as_user(db, None, "select count(*) from public.pelanggan_tidak_datang(2);", "anon")
    check("anon tidak bisa memanggil", bool(e) and "permission denied" in e, e)
    e, out = as_user(db, STAFF_A, f"select coalesce(jsonb_object_agg(customer_id, to_char(terakhir_datang at time zone 'UTC','YYYY-MM-DD')),'{{}}') from public.pelanggan_terakhir_datang(array[{q(C_CABANG_B)},{q(C_VOID)},{q(C_NOL)}]::uuid[]);")
    m = json.loads(out) if out else {}
    check("terakhir datang: lintas cabang, abaikan batal, tanpa baris untuk yang belum pernah", e is None and set(m) == {C_CABANG_B, C_VOID} and C_NOL not in m, e or m)
    e, _ = as_user(db, OWNER, "select count(*) from public.pelanggan_terakhir_datang(array_fill(gen_random_uuid(), array[201]));")
    check("maks. 200 id sekali baca", bool(e) and "RETENSI_DAFTAR" in e, e)
    e, _ = as_user(db, None, "select public.pelanggan_aktivitas_terakhir();", "authenticated")
    check("fungsi bantu internal tidak bisa dipanggil klien", bool(e) and "permission denied" in e, e)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--json", type=Path); ap.add_argument("--pg-bin", default=os.environ.get("PG_BIN", "/usr/lib/postgresql/16/bin"))
    ap.add_argument("--baseline", action="store_true"); a = ap.parse_args()
    with NativePostgres(a.pg_bin) as db:
        fixture.DisposablePostgres.bootstrap(_HoldBack(db))
        prep(db)
        if not a.baseline: db.sql("begin;\n" + CANDIDATE.read_text() + "\ncommit;")
        try: run(db)
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
