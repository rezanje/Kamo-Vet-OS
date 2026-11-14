#!/usr/bin/env python3
"""F1 (meeting 12 Nov 2026): akun selisih opname & snapshot HPP average (migrasi 20261118630000_f1_opname_akun_selisih.sql).

Native throwaway PostgreSQL only (full migration chain, fictional fixtures). Never accepts a database URL, no network.

  python3 -I scripts/test-f1-opname-akun-selisih-postgres.py [--pg-bin DIR] [--json out.json] [--baseline]
  (default)   chain without candidate -> fixtures (incl. one legacy plus opname) -> candidate -> behaviour checks.
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
CANDIDATE = ROOT / "supabase/migrations/20261118630000_f1_opname_akun_selisih.sql"
RESULTS = []

U = lambda n: f"f1000000-0000-4000-8000-{n:012d}"
OWNER, FINANCE, STAFF = U(1), U(2), U(3)
BR_A, BR_B, WH_A, WH_B = U(11), U(12), U(21), U(22)
ITEM = {k: U(100 + i) for i, k in enumerate(
    "plus minus mix_p mix_m zero last none adj_p adj_m adj_z adj_n cor_p cor_m cor_z legacy free avg_p avg_m avg_z avg_n other".split())}


def q(v): return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def check(name, ok, detail=None, kind="feature"):
    RESULTS.append(dict(case=name, kind=kind, status="PASS" if ok else "FAIL", detail=detail))
    print(RESULTS[-1]["status"], f"[{kind}]", name, json.dumps(detail, default=str)[:300], flush=True)


class _HoldBack:
    """Shared fixture bootstrap, every migration except the candidate."""
    def __init__(self, db): self.db = db
    def sql(self, source):
        if source == "begin;\n" + CANDIDATE.read_text() + "\ncommit;": return ""
        return self.db.sql(source)


class H:
    def __init__(self, db): self.db = db
    def sql(self, s): return self.db.sql(s)

    def val(self, s, user=None):
        if user is None: out = self.db.sql(s)
        else:
            out = self.db.sql("begin;\nset local role authenticated;\n"
                              f"select set_config('request.jwt.claim.sub',{q(user)},true);\n"
                              f"select set_config('request.jwt.claims',{q(json.dumps(dict(sub=user, role='authenticated')))},true);\n"
                              "select set_config('request.jwt.claim.role','authenticated',true);\n" + s + "\ncommit;")
        lines = [x for x in out.splitlines() if x != ""]
        return lines[-1] if lines else ""

    def err(self, s, user=None):
        try: self.val(s, user); return None
        except RuntimeError as e: return str(e)

    def js(self, s, user=None):
        v = self.val(s, user)
        return json.loads(v) if v else None


def prep(h):
    users = [(OWNER, "OWNER"), (FINANCE, "FINANCE"), (STAFF, "STAFF")]
    h.sql("insert into auth.users(id) values " + ",".join(f"({q(u)})" for u, _ in users) + ";"
          + "".join(f"update public.profiles set role={q(r)},is_active=true where id={q(u)};" for u, r in users))
    h.sql(f"""insert into public.branches(id,code,name,type) values({q(BR_A)},'F1A','Cabang Fiktif A','KLINIK'),({q(BR_B)},'F1B','Cabang Fiktif B','KLINIK');
insert into public.warehouses(id,branch_id,code,name,type) values({q(WH_A)},{q(BR_A)},'F1A','Gudang Fiktif A','VET'),({q(WH_B)},{q(BR_B)},'F1B','Gudang Fiktif B','VET');
insert into public.user_branches(user_id,branch_id) values({q(FINANCE)},{q(BR_A)}),({q(STAFF)},{q(BR_A)});
insert into public.role_capabilities(role,all_branches,create_accounts) values('FINANCE',false,false) on conflict(role) do update set all_branches=false;
insert into public.role_modules(role,module_id) values('FINANCE','laporan') on conflict do nothing;
insert into public.coa_accounts(code,name,type,normal_balance) values('170001','Persediaan fiktif','ASET','D'),('720010','Beban selisih stok fiktif','BEBAN','D'),
 ('810004','Pendapatan lain-lain fiktif','PENDAPATAN','K') on conflict(code) do update set is_active=true,is_header=false;""")
    buy = dict(plus=50, minus=100, mix_p=40, mix_m=100, zero=80, last=80, none=0, adj_p=30, adj_m=100, adj_z=75, adj_n=0,
               cor_p=20, cor_m=100, cor_z=90, legacy=25, free=0, avg_p=60, avg_m=100, avg_z=70, avg_n=0, other=10)
    h.sql("insert into public.items(id,code,name,unit,item_type,buy_price,sell_price) values "
          + ",".join(f"({q(ITEM[k])},'F1-{k}','Barang fiktif {k}','PCS','Persediaan',{buy[k]},{buy[k] * 2 + 5})" for k in ITEM) + ";")
    layers = [("minus", 5, 100), ("mix_m", 4, 100), ("zero", 5, 0), ("last", 2, 120), ("last", 4, 0), ("none", 3, 0),
              ("adj_m", 5, 100), ("adj_z", 4, 0), ("adj_n", 2, 0), ("cor_m", 6, 100), ("cor_z", 3, 0), ("other", 3, 10)]
    for n, (k, qty, cost) in enumerate(layers):
        wh = WH_B if k == "other" else WH_A
        h.sql(f"select public.stock_in_fifo({q(wh)},{q(ITEM[k])},{qty},{cost},'fixture','F1-FIX-{n}',current_date-{len(layers) - n},null);")
    h.sql("insert into public.stock(warehouse_id,item_id,qty) values "
          + ",".join(f"({q(WH_A)},{q(ITEM[k])},0)" for k in ("plus", "adj_p", "cor_p", "legacy", "free", "mix_p")) + " on conflict do nothing;")
    # Satu opname "lama" (lebih) diposting SEBELUM kandidat: jurnalnya Cr 720010 seperti di Production.
    post(h, "legacy", {"legacy": 4})
    post(h, "other", {"other": 1}, wh=WH_B)


ORDERS = {}


def order(h, label, wh=WH_A):
    oid = ORDERS.setdefault(label, U(5000 + len(ORDERS)))
    h.sql(f"insert into public.opname_orders(id,no_opname,warehouse_id,penanggung_jawab) values({q(oid)},'OPO.F1.'||{q(label[:10].upper())},{q(wh)},'Penghitung fiktif') on conflict do nothing;")
    return oid


def post(h, label, counts, wh=WH_A, user=OWNER):
    oid = order(h, label, wh)
    body = ",".join(f"{q(ITEM[k])},{v}" for k, v in counts.items())
    try: return None, h.js(f"select public.post_opname_atomic({q(oid)},current_date,jsonb_build_object({body}));", user), oid
    except RuntimeError as e: return str(e), None, oid


def adjust(h, key, counts, user=OWNER):
    rows = json.dumps([dict(item_id=ITEM[k], qty_baru=v) for k, v in counts.items()])
    try: return None, h.js(f"select public.post_inventory_adjustment_atomic({q(key)},{q(WH_A)},current_date,'temuan','fiktif',{q(rows)}::jsonb);", user)
    except RuntimeError as e: return str(e), None


def gl(h, source, ref):
    """Saldo per akun (debit-kredit) untuk jurnal sumber tertentu."""
    return h.js(f"""select coalesce(jsonb_object_agg(code,net),'{{}}') from (select a.code,sum(l.debit-l.credit) net from public.journal_lines l
 join public.coa_accounts a on a.id=l.account_id join public.journal_entries e on e.id=l.entry_id
 where e.source={q(source)} and e.source_ref={q(ref)} group by a.code) x""") or {}


def n(v): return float(v) if v is not None else None


def snap_row(h, result_id, item):
    return h.js(f"select r from public.opname_posting_receipts p cross join lateral jsonb_array_elements(p.source_snapshot->'price_report'->'rows') r where p.result_id={q(result_id)} and r->>'item_id'={q(ITEM[item])}")


def stock_qty(h, item, wh=WH_A): return n(h.val(f"select qty from public.stock where warehouse_id={q(wh)} and item_id={q(ITEM[item])}"))


def correct(h, kind, doc, rows, key, user=OWNER):
    rj = json.dumps([dict(item_id=ITEM[k], qty=v) for k, v in rows.items()])
    try:
        prev = h.js(f"select public.preview_stock_document_correction({q(kind)},{q(doc)},{q(rj)}::jsonb);", user)
        res = h.js(f"select public.correct_stock_document({q(kind)},{q(doc)},{q(rj)}::jsonb,'Koreksi fiktif F1',{q(key)},{q(prev['token'])});", user)
        return None, res
    except RuntimeError as e: return str(e), None


def replacement_gl(h, correction_id):
    return gl(h, "stock-correction", correction_id)


def run_fifo(h):
    e, r, _ = post(h, "plus", {"plus": 2})
    g = gl(h, "opname", r and r["no_hasil"])
    check("FIFO lebih: Dr 170001 100 / Cr 810004 100, tidak ada 720010",
          e is None and n(g.get("170001")) == 100 and n(g.get("810004")) == -100 and "720010" not in g, e or g)
    rc = h.js(f"select source_snapshot-'rows'-'order'-'price_report' from public.opname_posting_receipts where result_id={q(r and r['result_id'])}") if r else None
    check("bukti posting mencatat akun lebih 810004 dan kebijakan baru",
          bool(rc) and rc.get("gain_account") == "810004" and rc.get("variance_account") == "720010" and rc.get("warehouse_policy") == "variance-loss-expense-gain-income", rc)

    e, r, _ = post(h, "minus", {"minus": 3})
    g = gl(h, "opname", r and r["no_hasil"])
    check("FIFO kurang: Dr 720010 200 / Cr 170001 200, tidak ada 810004",
          e is None and n(g.get("170001")) == -200 and n(g.get("720010")) == 200 and "810004" not in g, e or g, kind="regression")

    e, r, _ = post(h, "mix", {"mix_p": 1, "mix_m": 2})
    g = gl(h, "opname", r and r["no_hasil"])
    check("FIFO campuran satu dokumen: lebih 40 -> 810004, kurang 200 -> 720010, persediaan neto -160",
          e is None and n(g.get("170001")) == -160 and n(g.get("810004")) == -40 and n(g.get("720010")) == 200, e or g)

    e, r, _ = post(h, "zero", {"zero": 3})
    g = gl(h, "opname", r and r["no_hasil"])
    mv = h.js(f"select jsonb_build_object('unit_cost',unit_cost,'qty',qty) from public.stock_moves where source='opname' and source_ref={q(r and r['no_hasil'])} and item_id={q(ITEM['zero'])}") if r else None
    sr = snap_row(h, r["result_id"], "zero") if r else None
    check("FIFO kurang dari lapisan harga 0: dinilai harga beli master 80 x 2 = 160 dan DIJURNAL (dulu tanpa jurnal)",
          e is None and n(g.get("720010")) == 160 and n(g.get("170001")) == -160, e or g)
    check("nilai taksiran ikut di mutasi stok & snapshot (jurnal = mutasi = laporan)",
          bool(mv) and n(mv["unit_cost"]) == 80 and bool(sr) and n(sr["nilai_selisih_modal"]) == -160 and "tanpa harga" in sr["sumber_nilai_modal"], dict(mv=mv, snap=sr))

    e, r, _ = post(h, "last", {"last": 0})
    g = gl(h, "opname", r and r["no_hasil"])
    check("FIFO lapisan 0 setelah lapisan berharga: pakai harga beli terakhir 120 (bukan master 80): 2x120 + 4x120 = 720",
          e is None and n(g.get("720010")) == 720, e or g)

    before = stock_qty(h, "none")
    e, r, oid = post(h, "none", {"none": 1})
    st = h.val(f"select status from public.opname_orders where id={q(oid)}")
    check("FIFO kurang tanpa harga sama sekali: posting ditolak dengan pesan isi harga beli, tidak ada yang berubah",
          bool(e) and "Harga modal barang" in e and "Isi harga beli" in e and st == "Terbuka" and stock_qty(h, "none") == before
          and h.val(f"select count(*) from public.opname_results where order_id={q(oid)}") == "0", e or r)

    e, r, _ = post(h, "free", {"free": 1})
    check("lebih dengan harga beli master 0: tetap tanpa jurnal (perilaku lama, nilai lebih = harga beli master)",
          e is None and gl(h, "opname", r["no_hasil"]) == {}, e or r, kind="regression")


def run_adjustment(h):
    e, r = adjust(h, "f1-adj-plus", {"adj_p": 3})
    g = gl(h, "penyesuaian", r and r["no_adj"])
    check("penyesuaian lebih: Dr 170001 90 / Cr 810004 90", e is None and n(g.get("810004")) == -90 and n(g.get("170001")) == 90 and "720010" not in g, e or g)
    check("bukti penyesuaian mencatat gain_account 810004", bool(r) and r.get("gain_account") == "810004", r)
    e, r = adjust(h, "f1-adj-minus", {"adj_m": 2})
    g = gl(h, "penyesuaian", r and r["no_adj"])
    check("penyesuaian kurang: Dr 720010 300 / Cr 170001 300", e is None and n(g.get("720010")) == 300 and n(g.get("170001")) == -300, e or g, kind="regression")
    e, r = adjust(h, "f1-adj-zero", {"adj_z": 1})
    g = gl(h, "penyesuaian", r and r["no_adj"])
    check("penyesuaian kurang dari lapisan harga 0: dinilai 3 x 75 = 225 dan dijurnal", e is None and n(g.get("720010")) == 225, e or g)
    e, r = adjust(h, "f1-adj-none", {"adj_n": 0})
    check("penyesuaian kurang tanpa harga sama sekali: ditolak dengan pesan", bool(e) and "Harga modal barang" in e and stock_qty(h, "adj_n") == 2, e or r)


def run_corrections(h):
    leg = h.val(f"select r.id from public.opname_results r join public.opname_result_items i on i.result_id=r.id where i.item_id={q(ITEM['legacy'])}")
    ref = h.val(f"select no_hasil from public.opname_results where id={q(leg)}")
    check("dokumen lama (sebelum kandidat) tetap Cr 720010 — jurnal historis tidak disentuh",
          gl(h, "opname", ref) == {"170001": 100.0, "720010": -100.0} or {k: n(v) for k, v in gl(h, "opname", ref).items()} == {"170001": 100.0, "720010": -100.0},
          gl(h, "opname", ref), kind="regression")
    e, r = correct(h, "opname", leg, {"legacy": 6}, "f1-cor-legacy")
    g = replacement_gl(h, r and r["correction_id"])
    rev = gl(h, "stock-correct-reverse", r and r["correction_id"])
    check("koreksi dokumen lama (lebih di 720010): pembalikan persis 720010, pengganti lebih 6x25=150 -> Cr 810004",
          e is None and {k: n(v) for k, v in rev.items()} == {"170001": -100.0, "720010": 100.0}
          and n(g.get("170001")) == 150 and n(g.get("810004")) == -150 and "720010" not in g, e or dict(rev=rev, rep=g))

    e, r, _ = post(h, "cor_p", {"cor_p": 2})
    e2, c = correct(h, "opname", r["result_id"], {"cor_p": 5}, "f1-cor-plus") if r else (e, None)
    g = replacement_gl(h, c and c["correction_id"])
    rev = gl(h, "stock-correct-reverse", c and c["correction_id"])
    check("koreksi dokumen baru (lebih di 810004) diterima perencana; pembalikan Dr 810004, pengganti Cr 810004 100",
          e2 is None and {k: n(v) for k, v in rev.items()} == {"170001": -40.0, "810004": 40.0} and n(g.get("810004")) == -100, e2 or dict(rev=rev, rep=g))

    e, r, _ = post(h, "cor_m", {"cor_m": 4})
    e2, c = correct(h, "opname", r["result_id"], {"cor_m": 7}, "f1-cor-minus-to-plus") if r else (e, None)
    g = replacement_gl(h, c and c["correction_id"])
    check("koreksi kurang -> lebih: pengganti Cr 810004 (1x100), tanpa baris nol", e2 is None and n(g.get("810004")) == -100 and "720010" not in g
          and h.val(f"select count(*) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id where e.source='stock-correction' and e.source_ref={q(c and c['correction_id'])} and l.debit=0 and l.credit=0") == "0",
          e2 or g)

    e, r, _ = post(h, "cor_z", {"cor_z": 2})
    g0 = gl(h, "opname", r and r["no_hasil"])
    check("lapisan harga 0 (master 90): posting kurang 1 dinilai 90", e is None and n(g0.get("720010")) == 90, e or g0)
    e2, c = correct(h, "opname", r["result_id"], {"cor_z": 0}, "f1-cor-zero") if r else (e, None)
    check("koreksi yang menambah selisih kurang dari lapisan harga 0: ditolak dengan pesan (tidak menilai 0 diam-diam)",
          bool(e2) and "tanpa harga modal" in e2, e2 or c)
    e3, c = correct(h, "opname", r["result_id"], {"cor_z": 3}, "f1-cor-zero-back") if r else (e, None)
    rev = gl(h, "stock-correct-reverse", c and c["correction_id"])
    check("koreksi kembali ke stok sistem: jurnal taksiran dibalik persis, tanpa pengganti",
          e3 is None and {k: n(v) for k, v in rev.items()} == {"170001": 90.0, "720010": -90.0} and replacement_gl(h, c["correction_id"]) == {}, e3 or rev)


def run_average(h):
    h.sql("update public.inventory_costing_settings set method='moving_average',activated_at=now() where id;")
    for k, qty, cost in [("avg_m", 4, 100), ("avg_z", 3, 0), ("avg_n", 2, 0)]:
        h.sql(f"select public.stock_in_fifo({q(WH_A)},{q(ITEM[k])},{qty},{cost},'fixture','F1-AVG-{k}',current_date,null);")
    h.sql(f"insert into public.stock(warehouse_id,item_id,qty) values({q(WH_A)},{q(ITEM['avg_p'])},0) on conflict do nothing;")
    e, r, _ = post(h, "avg_p", {"avg_p": 2})
    g = gl(h, "opname", r and r["no_hasil"])
    sr = snap_row(h, r["result_id"], "avg_p") if r else None
    check("AVERAGE lebih: Cr 810004 120", e is None and n(g.get("810004")) == -120 and "720010" not in g, e or g)
    check("AVERAGE lebih: snapshot HPP = nilai dijurnal (60/unit, 120), bukan kosong",
          bool(sr) and n(sr["modal_satuan"]) == 60 and n(sr["nilai_selisih_modal"]) == 120, sr)
    e, r, _ = post(h, "avg_m", {"avg_m": 1})
    g = gl(h, "opname", r and r["no_hasil"])
    sr = snap_row(h, r["result_id"], "avg_m") if r else None
    check("AVERAGE kurang: Dr 720010 300", e is None and n(g.get("720010")) == 300, e or g, kind="regression")
    check("AVERAGE kurang: snapshot HPP average = jurnal (-300, 100/unit, label average, nilai stok setelah 100)",
          bool(sr) and n(sr["nilai_selisih_modal"]) == -300 and n(sr["modal_satuan"]) == 100 and n(sr["hpp_selisih_keluar"]) == 300
          and "average" in sr["sumber_modal"] and n(sr["nilai_lapisan_setelah"]) == 100, sr)
    rep = h.js(f"select public.read_opname_price_report({q(r['result_id'])})", OWNER) if r else None
    check("AVERAGE: read_opname_price_report melaporkan metode moving_average", bool(rep) and rep["method"] == "moving_average", rep and rep.get("method"), kind="regression")
    e, r, _ = post(h, "avg_z", {"avg_z": 1})
    g = gl(h, "opname", r and r["no_hasil"])
    check("AVERAGE kurang tanpa harga pokok: harga efektif = harga beli master 70 x 2 = 140 dijurnal", e is None and n(g.get("720010")) == 140, e or g, kind="regression")
    e, r, oid = post(h, "avg_n", {"avg_n": 1})
    check("AVERAGE kurang tanpa harga sama sekali: ditolak", bool(e) and "Harga modal barang" in e and stock_qty(h, "avg_n") == 2, e or r)
    err = h.err(f"select public.preview_stock_document_correction('opname',(select id from public.opname_results where order_id={q(order(h, 'avg_m'))}),'[]'::jsonb);", OWNER)
    check("AVERAGE: koreksi historis tetap ditolak (kebijakan lama)", bool(err) and "average" in err, err, kind="regression")


def run_recap(h):
    ids = h.js(f"select jsonb_agg(r.id order by r.id) from public.opname_results r join public.opname_orders o on o.id=r.order_id where o.warehouse_id={q(WH_A)}")
    arr = "array[" + ",".join(f"{q(i)}::uuid" for i in ids) + "]"
    err = None
    try: recap = h.js(f"select public.read_opname_price_recap({arr});", FINANCE)
    except RuntimeError as e: err, recap = str(e), None
    byid = {x["result_id"]: x for x in (recap or [])}
    plus_id = h.val(f"select r.id from public.opname_results r join public.opname_result_items i on i.result_id=r.id where i.item_id={q(ITEM['mix_p'])}")
    m = byid.get(plus_id, {})
    check("rekap periode (FINANCE cabang A): satu baris per dokumen, agregat lebih/kurang HPP & jual",
          err is None and len(byid) == len(ids) and m.get("plus_count") == 1 and m.get("minus_count") == 1
          and n(m.get("plus_modal")) == 40 and n(m.get("minus_modal")) == -200 and n(m.get("plus_jual")) == 85 and n(m.get("minus_jual")) == -410
          and m.get("modal_missing") == 0 and m.get("method") == "fifo" and m.get("snapshot") is True, err or m)
    other = h.val(f"select r.id from public.opname_results r join public.opname_orders o on o.id=r.order_id where o.warehouse_id={q(WH_B)}")
    err = h.err(f"select public.read_opname_price_recap(array[{q(other)}::uuid]);", FINANCE)
    check("rekap: dokumen cabang lain ditolak untuk FINANCE cabang A", bool(err) and "ditolak" in err, err)
    err = h.err(f"select public.read_opname_price_recap({arr});", STAFF)
    check("rekap: kasir/staf tidak boleh membaca nilai modal", bool(err) and "ditolak" in err, err)
    err = h.err(f"begin; set local role anon; select public.read_opname_price_recap({arr}); commit;")
    check("rekap: anon tidak bisa memanggil", bool(err) and "permission denied" in err, err)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--json", type=Path); ap.add_argument("--pg-bin", default=os.environ.get("PG_BIN", "/usr/lib/postgresql/16/bin"))
    ap.add_argument("--baseline", action="store_true"); a = ap.parse_args()
    with NativePostgres(a.pg_bin) as db:
        fixture.DisposablePostgres.bootstrap(_HoldBack(db))
        h = H(db); prep(h)
        if not a.baseline: h.sql("begin;\n" + CANDIDATE.read_text() + "\ncommit;")
        for step in (run_fifo, run_adjustment, run_corrections, run_recap, run_average):
            try: step(h)
            except Exception as e: check(f"battery {step.__name__}", False, str(e)[:400])
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
