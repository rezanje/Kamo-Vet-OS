#!/usr/bin/env python3
"""LOCAL ONLY — Klinik-A (loading): database cost of the reads behind klinik pages.

Applies ALL repository migrations to a throwaway native PostgreSQL cluster (same shims as
the other harnesses: fictional `auth`/`storage`, no business stubs), loads a FICTIONAL
fixture sized like a busy clinic (3.600 SKUs with units/stock/branch prices, thousands of
owners/pets/visits/medical records), then times READ-ONLY queries that approximate what
PostgREST runs for Antrean, Rekam Medis, Pembayaran, OBAT KHUSUS catalogue and the
medical-record history list. Every timed query runs as role `authenticated` with a
fictional JWT so the real RLS policies apply. EXPLAIN ANALYZE is used on SELECTs only;
no writer/RPC that changes data is executed during measurement.

The SQL is an approximation of PostgREST's generated SQL (embeds as lateral json
sub-selects, `count=exact` as a separate count). Network/HTTP/PostgREST/Next.js time is
NOT measured here; the point is to separate database execution time from round trips.

Usage: KAMO_PG_BIN=/usr/lib/postgresql/16/bin python3 scripts/test-klinik-a-loading-postgres.py --json out.json
"""
import argparse
import importlib.util
import json
import os
import re
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BIN = os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin")
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

OWNER = "a0000000-0000-4000-8000-000000000001"
STAFF = "a0000000-0000-4000-8000-000000000002"
DOCTOR = "a0000000-0000-4000-8000-000000000003"
BRANCH = "b0000000-0000-4000-8000-000000000001"
BRANCH2 = "b0000000-0000-4000-8000-000000000002"
WH = "c0000000-0000-4000-8000-000000000001"
SIZE = {"items": 3600, "units_every": 2, "prices_every": 7, "customers": 2500, "pets": 4000,
        "visits": 8000, "today": 45, "records_ratio": 0.9, "rx_per_record": 3}


def fixture_sql():
    s = SIZE
    return f"""
insert into auth.users (id, raw_user_meta_data) values
 ('{OWNER}','{{"full_name":"Pemilik Fiktif"}}'),('{STAFF}','{{"full_name":"Staf Fiktif"}}'),('{DOCTOR}','{{"full_name":"Dokter Fiktif"}}');
update public.profiles set role='OWNER', is_active=true where id='{OWNER}';
update public.profiles set role='STAFF', is_active=true where id='{STAFF}';
update public.profiles set role='DOCTOR', is_active=true where id='{DOCTOR}';
insert into public.branches (id,code,name,type) values ('{BRANCH}','KA-1','Klinik Fiktif A','KLINIK'),('{BRANCH2}','KA-2','Klinik Fiktif B','KLINIK');
insert into public.user_branches (user_id,branch_id) values ('{STAFF}','{BRANCH}'),('{DOCTOR}','{BRANCH}');
insert into public.warehouses (id,branch_id,code,name,type) values ('{WH}','{BRANCH}','KA-WH','Gudang Fiktif','VET');
insert into public.cashier_shifts (branch_id,opened_by,shift_type,status) values ('{BRANCH}','{STAFF}','klinik','open');
insert into public.item_categories (id,name) select gen_random_uuid(), 'Kategori Fiktif '||g from generate_series(1,40) g;
insert into public.items (id,code,name,unit,buy_price,sell_price,item_type,is_active,is_compound_material,category_id)
 select ('d0000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'KA'||g,'Barang Fiktif '||g,'pcs',1000,2000+g,
        case when g%5=0 then 'Jasa' else 'Persediaan' end,true,g%17=0,
        (select id from public.item_categories order by name offset (g%40) limit 1)
 from generate_series(1,{s['items']}) g;
insert into public.item_units (item_id,unit,factor,sell_price,buy_price)
 select id,'box',10,(sell_price*10),10000 from public.items where (substr(code,3)::int)%{s['units_every']}=0;
insert into public.stock (warehouse_id,item_id,qty) select '{WH}',id,100 from public.items where item_type='Persediaan';
insert into public.item_branch_prices (item_id,branch_id,unit,sell_price)
 select id,'{BRANCH}','pcs',sell_price+500 from public.items where (substr(code,3)::int)%{s['prices_every']}=0;
insert into public.customers (id,name,phone)
 select ('e0000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'Pemilik Fiktif '||g,'0800'||lpad(g::text,7,'0') from generate_series(1,{s['customers']}) g;
insert into public.pets (id,customer_id,name,species)
 select ('f0000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,('e0000000-0000-4000-8000-'||lpad((1+g%{s['customers']})::text,12,'0'))::uuid,'Hewan Fiktif '||g,'Kucing'
 from generate_series(1,{s['pets']}) g;
-- visits: history spread over 400 days (both branches), plus today's queue on branch A
insert into public.visits (id,branch_id,customer_id,pet_id,poli,status,keluhan,created_at)
 select ('70000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
        case when g%3=0 then '{BRANCH2}'::uuid else '{BRANCH}'::uuid end,
        p.customer_id,p.id,'Poli Umum','Selesai','Keluhan fiktif '||g, now()-((1+g%400)||' days')::interval
 from generate_series(1,{s['visits']}) g join public.pets p on p.id=('f0000000-0000-4000-8000-'||lpad((1+g%{s['pets']})::text,12,'0'))::uuid;
insert into public.visits (id,branch_id,customer_id,pet_id,poli,status,keluhan,created_at)
 select ('71000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'{BRANCH}',p.customer_id,p.id,'Poli Umum',
        ((array['Menunggu','Diperiksa','Pembayaran','Selesai'])[1+g%4])::public.visit_status,'Antrean fiktif '||g, date_trunc('day', now())+(g||' minutes')::interval
 from generate_series(1,{s['today']}) g join public.pets p on p.id=('f0000000-0000-4000-8000-'||lpad((1+g)::text,12,'0'))::uuid;
insert into public.medical_records (id,visit_id,anamnesis,diagnosis)
 select gen_random_uuid(),v.id,'Anamnesa fiktif','Diagnosa fiktif' from public.visits v where random()<{s['records_ratio']};
insert into public.prescription_items (medical_record_id,nama_obat,qty,harga,satuan,jenis,kategori,item_id,faktor)
 select m.id,'Obat Fiktif',1,2000,'pcs',case when g=1 then 'jasa' else 'obat' end,'Obat',
        ('d0000000-0000-4000-8000-'||lpad((1+(abs(hashtext(m.id::text||g))%{s['items']}))::text,12,'0'))::uuid,1
 from public.medical_records m cross join generate_series(1,{s['rx_per_record']}) g;
analyze;
"""


def as_user(user, sql):
    if user is None:  # database owner, RLS bypassed: baseline to isolate the cost of RLS
        return sql
    return ("set role authenticated;\n"
            "select set_config('request.jwt.claim.role','authenticated',false);\n"
            f"select set_config('request.jwt.claim.sub','{user}',false);\n" + sql)


def explain(db, user, sql, runs=3):
    """Median/max execution time (ms) of a read-only SELECT under RLS, via EXPLAIN ANALYZE."""
    assert re.match(r"\s*(select|with)\b", sql, re.I), "EXPLAIN ANALYZE only on reads"
    times, rows = [], None
    for _ in range(runs):
        out = db.sql(as_user(user, f"explain (analyze, format json) {sql};"))
        plan = json.loads(out[out.index("["):])[0]
        times.append(plan["Execution Time"] + plan.get("Planning Time", 0))
        rows = plan["Plan"].get("Actual Rows")
    return {"median_ms": round(statistics.median(times), 3), "max_ms": round(max(times), 3), "rows": rows}


def ids_csv(db, sql):
    return ",".join(f"'{x}'" for x in db.sql(sql).splitlines() if x)


def measure(db):
    first200 = ids_csv(db, "select id from public.items where is_active order by name, id limit 200")
    today_from = "date_trunc('day', now())"
    visit_today = db.sql("select id from public.visits where id::text like '71000000%' order by created_at limit 1")
    rec = db.sql(f"select id from public.medical_records where visit_id='{visit_today}' limit 1") or "00000000-0000-4000-8000-000000000000"
    cases = {
        # middleware / branch guard (every klinik navigation and Server Action)
        "middleware.profiles": (STAFF, f"select role,is_active from public.profiles where id='{STAFF}'"),
        "middleware.role_modules": (STAFF, "select role,module_id from public.role_modules"),
        "middleware.role_capabilities": (STAFF, "select all_branches,create_accounts from public.role_capabilities where role='STAFF'"),
        "middleware.user_branches": (STAFF, f"select branch_id from public.user_branches where user_id='{STAFF}'"),
        "middleware.branch": (STAFF, f"select id,name,code,type,is_active from public.branches where id='{BRANCH}'"),
        "middleware.open_shift": (STAFF, f"select s.id,s.branch_id,(select json_build_object('name',b.name,'code',b.code) from public.branches b where b.id=s.branch_id) from public.cashier_shifts s where s.opened_by='{STAFF}' and s.status='open' and s.shift_type='klinik'"),
        # Antrean (today, one branch) — main list with embeds
        "antrean.visits_today": (STAFF, f"""select v.id,v.status,v.created_at,
            (select json_build_object('name',p.name,'species',p.species) from public.pets p where p.id=v.pet_id),
            (select json_build_object('name',c.name,'phone',c.phone) from public.customers c where c.id=v.customer_id),
            (select coalesce(json_agg(json_build_object('discharged_at',i.discharged_at)),'[]') from public.inpatient_records i where i.visit_id=v.id)
            from public.visits v where v.branch_id in ('{BRANCH}') and v.created_at>={today_from} and v.created_at<{today_from}+interval '1 day'
            and v.status<>'Selesai' order by v.created_at"""),
        # Catalogue used by Rekam Medis form, OBAT KHUSUS and Pembayaran (500-row page + exact count)
        "katalog.items_count_exact": (DOCTOR, "select count(*) from public.items where is_active"),
        "katalog.items_page_500": (DOCTOR, "select id,code,upc,name,unit,sell_price,is_compound_material,item_type,tindakan_kategori,category_id from public.items where is_active order by name,id limit 500 offset 3000"),
        "katalog.stock_batch_200": (DOCTOR, f"select id,item_id,qty from public.stock where warehouse_id='{WH}' and item_id in ({first200}) order by id limit 500"),
        "katalog.item_units_batch_200": (DOCTOR, f"select id,item_id,unit,factor,sell_price,buy_price from public.item_units where item_id in ({first200}) order by id limit 500"),
        "katalog.branch_prices_batch_200": (DOCTOR, f"select id,item_id,unit,sell_price from public.item_branch_prices where branch_id='{BRANCH}' and item_id in ({first200}) order by id limit 500"),
        # Rekam Medis / Pembayaran single-visit reads
        "rekam.visit": (DOCTOR, f"select v.*,(select row_to_json(p) from public.pets p where p.id=v.pet_id),(select row_to_json(c) from public.customers c where c.id=v.customer_id) from public.visits v where v.id='{visit_today}'"),
        "rekam.prescriptions": (DOCTOR, f"select * from public.prescription_items where medical_record_id='{rec}' order by created_at"),
        "pembayaran.invoices_for_visit": (STAFF, f"select * from public.invoices where visit_id='{visit_today}' and voided_at is null order by created_at,id"),
        # Riwayat rekam medis list: ALL visits with medical records (count + 500-row pages)
        "riwayat.list_count_exact": (DOCTOR, "select count(*) from public.visits v where exists(select 1 from public.medical_records m where m.visit_id=v.id)"),
        "riwayat.list_page_500": (DOCTOR, """select v.id,v.pet_id,v.branch_id,v.created_at,v.dokter,v.keluhan,
            (select json_build_object('name',p.name,'species',p.species,'breed',p.breed) from public.pets p where p.id=v.pet_id),
            (select json_build_object('name',c.name,'phone',c.phone) from public.customers c where c.id=v.customer_id),
            (select json_build_object('code',b.code) from public.branches b where b.id=v.branch_id),
            (select json_agg(json_build_object('diagnosis',m.diagnosis,'anamnesis',m.anamnesis)) from public.medical_records m where m.visit_id=v.id),
            (select coalesce(json_agg(json_build_object('created_at',i.created_at,'discharged_at',i.discharged_at)),'[]') from public.inpatient_records i where i.visit_id=v.id)
            from public.visits v where exists(select 1 from public.medical_records m where m.visit_id=v.id)
            order by v.created_at desc,v.id limit 500 offset 2000"""),
        "riwayat.list_page_500_owner": (OWNER, """select v.id,v.created_at,
            (select json_agg(json_build_object('diagnosis',m.diagnosis)) from public.medical_records m where m.visit_id=v.id)
            from public.visits v where exists(select 1 from public.medical_records m where m.visit_id=v.id)
            order by v.created_at desc,v.id limit 500 offset 2000"""),
    }
    # Same reads without RLS (database owner) to separate query cost from per-row policy cost.
    for name in ["antrean.visits_today", "riwayat.list_count_exact", "riwayat.list_page_500"]:
        cases[name + "@tanpa_rls"] = (None, cases[name][1])
    results = {}
    for name, (user, sql) in cases.items():
        results[name] = explain(db, user, sql)
        print(f"{name:38s} median={results[name]['median_ms']:8.3f}ms max={results[name]['max_ms']:8.3f}ms rows={results[name]['rows']}", flush=True)
    plan = db.sql(as_user(DOCTOR, "explain (analyze, verbose, buffers) " + cases["riwayat.list_count_exact"][1]))
    counts = {"riwayat_count_plan": plan,
        "items_active": db.sql("select count(*) from public.items where is_active"),
        "item_units": db.sql("select count(*) from public.item_units"),
        "stock_rows": db.sql("select count(*) from public.stock"),
        "visits": db.sql("select count(*) from public.visits"),
        "medical_records": db.sql("select count(*) from public.medical_records"),
        "prescription_items": db.sql("select count(*) from public.prescription_items"),
        "doctor_visible_records": db.sql(as_user(DOCTOR, "select count(*) from public.visits v where exists(select 1 from public.medical_records m where m.visit_id=v.id)")).splitlines()[-1],
    }
    return results, counts


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    with NativePostgres(BIN) as db:
        fixture.DisposablePostgres.bootstrap(db)
        db.sql(fixture_sql())
        version = db.sql("show server_version")
        results, counts = measure(db)
    out = {"server_version": version, "fixture": SIZE, "row_counts": counts, "reads": results,
           "note": "EXPLAIN ANALYZE of read-only SELECTs as role authenticated (RLS on); planning+execution ms; no network/PostgREST time"}
    print(json.dumps({k: v for k, v in counts.items() if k != "riwayat_count_plan"}), flush=True)
    if args.json:
        args.json.write_text(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
