#!/usr/bin/env python3
"""E2 (meeting 12 Nov 2026): barang Grup (paket/bundling) di penjualan online (migrasi 20261118650000_e2_grup_penjualan_online.sql).

Native throwaway PostgreSQL only (full migration chain, fictional fixtures). Never accepts a database URL, no network.

  python3 -I scripts/test-e2-grup-online-postgres.py [--pg-bin DIR] [--json out.json] [--baseline]
  (default)   chain without candidate -> template; clones: (1) identity + FIFO battery + rollback, (2) moving-average battery,
              (3) neighbouring SQL suites with the same outcome without/with the candidate.
  --baseline  same fixtures WITHOUT the candidate: every feature case must FAIL (RED), every regression case must PASS.
"""
import argparse, importlib.util, json, os, re, subprocess, sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
CANDIDATE = ROOT / "supabase/migrations/20261118650000_e2_grup_penjualan_online.sql"
ROLLBACK = ROOT / "docs/runbooks/e2-grup-online/rollback.sql"
PREFLIGHT = ROOT / "docs/runbooks/e2-grup-online/01-preflight-readonly.sql"
TESTS = ROOT / "supabase/tests"
RESULTS = []

U = lambda n: f"e2000000-0000-4000-8000-{n:012d}"
OWNER, STAFF = U(1), U(2)
BR, W1, W2 = U(11), U(21), U(22)
# A < B < S < G...: lines post in item_id order, so a plain A line consumes FIFO layers before a package's A.
A, B, S, G, G2, GE, G3 = U(101), U(102), U(103), U(110), U(111), U(112), U(113)
L1, L2, LB, LW2 = U(201), U(202), U(203), U(204)
PATCHED = ["assert_sale_group_cost_links(uuid)", "post_online_order(text,jsonb,jsonb)"]


def q(v): return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def check(name, ok, detail=None, kind="feature"):
    RESULTS.append(dict(case=name, kind=kind, status="PASS" if ok else "FAIL", detail=detail))
    print(RESULTS[-1]["status"], f"[{kind}]", name, json.dumps(detail, default=str)[:300], flush=True)
    return ok


class _HoldBack:
    """Shared fixture bootstrap, every migration except the candidate."""
    def __init__(self, db): self.db = db
    def sql(self, source):
        if source == "begin;\n" + CANDIDATE.read_text() + "\ncommit;": return ""
        return self.db.sql(source)


class H:
    """psql against one cloned database."""
    def __init__(self, db, name): self.db, self.name = db, name

    def raw(self, s):
        env = {**os.environ, "PSQLRC": "/dev/null", "PGDATABASE": self.name}
        r = subprocess.run(self.db.as_user + [self.db.psql, "-X", "-qAt", "-h", str(self.db.root), "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
                           input=s, text=True, capture_output=True, env=env)
        if r.returncode: raise RuntimeError(r.stderr + r.stdout)
        return r.stdout.strip()

    def sql(self, s): return self.raw(s)

    def val(self, s, user=None):
        if user is None: out = self.raw(s)
        else:
            out = self.raw("begin;\nset local role authenticated;\n"
                           f"select set_config('request.jwt.claim.sub',{q(user)},true);\n"
                           f"select set_config('request.jwt.claims',{q(json.dumps(dict(sub=user, role='authenticated')))},true);\n"
                           f"select set_config('request.jwt.claim.role','authenticated',true);\n" + s + "\ncommit;")
        lines = [x for x in out.splitlines() if x != ""]
        return lines[-1] if lines else ""

    def j(self, s, user=None): return json.loads(self.val(s, user))

    def err(self, s, user=None):
        try: self.val(s, user); return None
        except RuntimeError as e: return str(e)

    def apply(self, path): self.raw("begin;\n" + Path(path).read_text() + "\ncommit;")


def digests(h):
    rows = h.sql("select p.oid::regprocedure::text||'|'||md5(pg_get_functiondef(p.oid))||'|'||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'")
    return dict(r.split("|", 1) for r in rows.splitlines())


def prep(h):
    h.sql(f"""
insert into auth.users(id,raw_user_meta_data) values ({q(OWNER)},'{{"full_name":"Owner E2"}}'),({q(STAFF)},'{{"full_name":"Staf E2"}}');
update public.profiles set role='OWNER',is_active=true where id={q(OWNER)};
update public.profiles set role='STAFF',is_active=true where id={q(STAFF)};
insert into public.branches(id,code,name,type) values({q(BR)},'E2BR','Cabang Fiktif E2','PETSHOP');
insert into public.user_branches(user_id,branch_id) values({q(OWNER)},{q(BR)});
insert into public.warehouses(id,branch_id,code,name,type) values({q(W1)},{q(BR)},'E2WH','Gudang Toko E2','RETAIL'),({q(W2)},{q(BR)},'E2WH2','Gudang Lain E2','RETAIL');
insert into public.items(id,code,name,unit,buy_price,sell_price,item_type) values
 ({q(A)},'E2-A','Kibble Fiktif A','pcs',100,150,'Persediaan'),({q(B)},'E2-B','Mangkok Fiktif B','pcs',50,80,'Persediaan'),
 ({q(S)},'E2-S','Jasa Bungkus Fiktif','unit',0,0,'Jasa'),({q(G)},'E2-PAKET','Paket Bundling Fiktif','paket',0,500,'Grup'),
 ({q(G2)},'E2-PAKET-DUS','Paket Dus Fiktif','paket',0,1000,'Grup'),({q(GE)},'E2-KOSONG','Paket Kosong Fiktif','paket',0,100,'Grup'),
 ({q(G3)},'E2-PAKET-BOX','Paket Box Fiktif','paket',0,2000,'Grup');
insert into public.item_units(item_id,unit,factor,sell_price,buy_price) values({q(A)},'box',10,1400,1000),({q(G2)},'dus',6,5500,0);
insert into public.stock(warehouse_id,item_id,qty) values({q(W1)},{q(A)},25),({q(W1)},{q(B)},10),({q(W2)},{q(A)},100);
insert into public.stock_layers(id,warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values
 ({q(L1)},{q(W1)},{q(A)},current_date-2,5,5,100,'purchase'),({q(L2)},{q(W1)},{q(A)},current_date-1,20,20,120,'purchase'),
 ({q(LB)},{q(W1)},{q(B)},current_date-1,10,10,50,'purchase'),({q(LW2)},{q(W2)},{q(A)},current_date-1,100,100,999,'purchase');
insert into public.coa_accounts(code,name,type,normal_balance,is_header) values
 ('130009','Piutang Marketplace','ASET','D',false),('170001','Persediaan','ASET','D',false),('510001','Penjualan','PENDAPATAN','K',false),
 ('600001','HPP','BEBAN','D',false),('312005','PPN Keluaran','LIABILITAS','K',false)
 on conflict(code) do update set is_active=true,is_header=false;
update public.accounting_locks set closed_until=null;
update public.company_settings set mode_pkp=false;
""")
    comp = lambda rows: q(json.dumps([dict(component_item_id=c, qty=n, unit=u, factor=f, sort_order=i) for i, (c, n, u, f) in enumerate(rows)])) + "::jsonb"
    for grp, rows in ((G, [(A, 2, "pcs", 1), (B, 1, "pcs", 1), (S, 1, "unit", 1)]), (G2, [(A, 1, "pcs", 1)]), (G3, [(A, 1, "box", 10)])):
        h.val(f"select public.replace_item_group_components({q(grp)},{comp(rows)});", OWNER)


TODAY = "(now() at time zone 'Asia/Jakarta')::date"


def post(h, key, items, user=OWNER, wh=W1, ref=None):
    header = f"jsonb_build_object('channel','Shopee','warehouse_id',{q(wh)},'tanggal',{TODAY},'external_ref',{q(ref or key)},'buyer_name','Pembeli Fiktif','customer_id','')"
    sql = f"select public.post_online_order({q(key)},{header},{q(json.dumps(items))}::jsonb);"
    try: return None, json.loads(h.val(sql, user))
    except RuntimeError as e: return str(e), None
    except json.JSONDecodeError as e: return str(e), None


def line(item, qty, harga, satuan=""): return dict(item_id=item, qty=qty, harga=harga, satuan=satuan)


def stock(h, wh, item): return float(h.val(f"select coalesce((select qty from public.stock where warehouse_id={q(wh)} and item_id={q(item)}),0)"))


def layer(h, lid): return float(h.val(f"select qty_left from public.stock_layers where id={q(lid)}"))


def sales_count(h): return int(h.val("select count(*) from public.sales where channel is not null"))


def sale_snapshot(h, no):
    return h.j(f"""select jsonb_build_object(
 'lines',(select coalesce(jsonb_agg(jsonb_build_object('item',i.item_id,'qty',i.qty,'harga',i.harga,'satuan',i.satuan,'faktor',i.faktor,'hpp',i.hpp,
   'comps',(select coalesce(jsonb_agg(jsonb_build_object('item',c.component_item_id,'type',c.item_type,'per',c.qty_per_group,'unit',c.unit,'factor',c.factor,'tbq',c.total_base_qty,'hpp',c.hpp,'code',c.component_code) order by c.sort_order),'[]') from public.sale_item_group_components c where c.sale_item_id=i.id)) order by i.item_id),'[]')
   from public.sale_items i join public.sales s on s.id=i.sale_id where s.no_struk={q(no)}),
 'moves',(select coalesce(jsonb_agg(jsonb_build_object('item',m.item_id,'qty',m.qty,'wh',m.warehouse_id,'src',m.source,'linked',m.sale_line_id is not null,
   'line_item',(select item_id from public.sale_items where id=m.sale_line_id),'method',m.cost_method) order by m.item_id,m.qty),'[]') from public.stock_moves m where m.source_ref={q(no)}),
 'hpp_journal',(select coalesce(sum(l.debit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id where e.source='sale-online-hpp' and e.source_ref={q(no)} and a.code='600001'),
 'inv_credit',(select coalesce(sum(l.credit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id where e.source='sale-online-hpp' and e.source_ref={q(no)} and a.code='170001'),
 'revenue',(select coalesce(sum(l.credit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id where e.source='sale-online' and e.source_ref={q(no)} and a.code='510001'),
 'receivable',(select coalesce(sum(l.debit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id where e.source='sale-online' and e.source_ref={q(no)} and a.code='130009'),
 'total',(select total from public.sales where no_struk={q(no)}))""")


def cancel(h, no, key=None):
    sql = f"select public.cancel_posted_sale((select id from public.sales where no_struk={q(no)}),(select revision from public.sales where no_struk={q(no)}),{q(key or 'batal:' + no)},'Salah input order online');"
    try: return None, json.loads(h.val(sql, OWNER))
    except RuntimeError as e: return str(e), None


def n(x): return float(x)


def battery_fifo(h, mode):
    """FIFO battery. Regression cases are written so they hold with and without the candidate."""
    # ── regression: plain online items are unchanged ──
    e, r = post(h, "n1", [line(B, 1, 80)])
    snap = sale_snapshot(h, r["document_no"]) if r else None
    check("barang biasa: order online 1 Mangkok tersimpan, HPP 50 dari lapisan FIFO, tanpa snapshot paket, mutasi tidak terhubung baris",
          e is None and snap and n(snap["lines"][0]["hpp"]) == 50 and snap["lines"][0]["comps"] == [] and [m["linked"] for m in snap["moves"]] == [False]
          and n(snap["hpp_journal"]) == 50 and n(snap["revenue"]) == 80, e or snap, kind="regression")
    e, _ = post(h, "n2", [line(A, 1000, 150)])
    check("barang biasa: stok kurang tetap ditolak dengan pesan lama persis 'Stok tidak cukup'", bool(e) and "ERROR:  Stok tidak cukup\n" in e + "\n" and "isi paket" not in e, e, kind="regression")
    e, _ = post(h, "n3", [line(A, 1, 150, "lusin")])
    check("barang biasa: satuan tidak terdaftar tetap ditolak", bool(e) and "Satuan tidak terdaftar" in e, e, kind="regression")
    e, _ = post(h, "n4", [line(B, 1, 80)], user=STAFF)
    check("akses: STAFF tanpa modul/cabang tetap ditolak", bool(e) and ("Akses transaksi ditolak" in e or "tidak dapat diakses" in e), e, kind="regression")
    no_n1 = r["document_no"] if r else None
    if no_n1:
        e, ret = None, None
        try: h.val(f"select public.post_unit_return('sales',(select id from public.sales where no_struk={q(no_n1)}),'retur-n1',jsonb_build_object('tanggal',{TODAY}),"
                   f"jsonb_build_array(jsonb_build_object('item_id',{q(B)},'source_line_id',(select i.id from public.sale_items i join public.sales s on s.id=i.sale_id where s.no_struk={q(no_n1)}),'qty',1,'satuan','pcs','kondisi','baik')));", OWNER)
        except RuntimeError as x: e = str(x)
        check("retur: order online tetap tidak bisa diretur (aturan lama; koreksi lewat Batalkan)", bool(e) and "online" in e, e, kind="regression")
        e, _ = cancel(h, no_n1)
        check("barang biasa: pembatalan order online tetap berhasil dan stok Mangkok kembali 10", e is None and stock(h, W1, B) == 10 and layer(h, LB) == 10, e, kind="regression")

    # ── feature: Grup ──
    before = sales_count(h)
    e, r1 = post(h, "o1", [line(G, 2, 150000)])
    s1 = sale_snapshot(h, r1["document_no"]) if r1 else None
    ok = e is None and s1 and len(s1["lines"]) == 1
    if ok:
        l0 = s1["lines"][0]; comps = {c["item"]: c for c in l0["comps"]}
        ok = (l0["item"] == G and n(l0["qty"]) == 2 and n(l0["harga"]) == 150000 and l0["satuan"] == "paket" and n(l0["faktor"]) == 1 and n(l0["hpp"]) == 500
              and len(comps) == 3 and n(comps[A]["tbq"]) == 4 and n(comps[A]["hpp"]) == 400 and n(comps[A]["per"]) == 2 and comps[A]["unit"] == "pcs" and comps[A]["code"] == "E2-A"
              and n(comps[B]["tbq"]) == 2 and n(comps[B]["hpp"]) == 100 and comps[S]["type"] == "Jasa" and n(comps[S]["tbq"]) == 2 and n(comps[S]["hpp"]) == 0)
    check("paket: 2 Paket Bundling = 1 baris paket (harga Shopee, satuan dasar), snapshot 3 isi (2x Kibble, 1x Mangkok, Jasa tanpa stok), HPP isi FIFO 400+100", ok, e or s1)
    check("paket: stok keluar per isi dari gudang order (Kibble 4 dari lapisan tertua, Mangkok 2), sumber sale-online terhubung ke baris paket, gudang lain tidak tersentuh",
          bool(s1) and [(m["item"], n(m["qty"]), m["src"], m["linked"], m["line_item"], m["wh"]) for m in s1["moves"]] == [(A, -4, "sale-online", True, G, W1), (B, -2, "sale-online", True, G, W1)]
          and stock(h, W1, A) == 21 and stock(h, W1, B) == 8 and layer(h, L1) == 1 and layer(h, L2) == 20 and stock(h, W2, A) == 100 and layer(h, LW2) == 100, s1 and s1["moves"])
    check("paket: jurnal omzet 300.000 di baris paket (piutang marketplace), jurnal HPP 500 dari isi (Dr HPP / Cr Persediaan)",
          bool(s1) and n(s1["revenue"]) == 300000 and n(s1["receivable"]) == 300000 and n(s1["hpp_journal"]) == 500 and n(s1["inv_credit"]) == 500 and n(s1["total"]) == 300000, s1)
    e, again = post(h, "o1", [line(G, 2, 150000)])
    check("paket: kirim ulang kunci sama = hasil sama, stok tidak keluar dua kali", e is None and again == r1 and stock(h, W1, A) == 21 and sales_count(h) == before + 1, e or again)

    e, r2 = post(h, "o2", [line(A, 3, 150), line(G, 1, 150000, "paket")])
    s2 = sale_snapshot(h, r2["document_no"]) if r2 else None
    ok = e is None and s2 and len(s2["lines"]) == 2
    if ok:
        la, lg = s2["lines"]
        ok = (la["item"] == A and n(la["hpp"]) == 340 and la["comps"] == [] and lg["item"] == G and n(lg["hpp"]) == 290
              and {c["item"]: n(c["hpp"]) for c in lg["comps"]} == {A: 240, B: 50, S: 0} and n(s2["hpp_journal"]) == 630)
    check("FIFO campuran: Kibble biasa 3 (1@100+2@120=340) lalu paket (Kibble 2@120=240, Mangkok 50) = HPP 630; satuan 'paket' eksplisit diterima", ok, e or s2)
    check("FIFO campuran: stok Kibble 16, Mangkok 7, lapisan tertua habis", stock(h, W1, A) == 16 and stock(h, W1, B) == 7 and layer(h, L1) == 0 and layer(h, L2) == 16)

    c0, a0 = sales_count(h), stock(h, W1, A)
    e, _ = post(h, "o3", [line(G, 20, 150000)])
    check("stok isi kurang: 20 paket butuh 40 Kibble (tersedia 16) -> ditolak, pesan menyebut isi paket + kebutuhan + stok, tidak ada yang tersimpan",
          bool(e) and "Stok tidak cukup untuk isi paket: Kibble Fiktif A (butuh 40, tersedia 16)" in e and sales_count(h) == c0 and stock(h, W1, A) == a0, e)
    e, _ = post(h, "o4", [line(A, 10, 150), line(G, 4, 150000)])
    check("stok gabungan: Kibble biasa 10 + paket 4 (8 Kibble) = 18 > 16 -> ditolak walau masing-masing cukup", bool(e) and "isi paket" in e and "butuh 18" in e and sales_count(h) == c0, e)
    e, _ = post(h, "o5", [line(G2, 1, 5500, "dus")])
    check("satuan bukan dasar untuk paket ditolak dengan pesan jelas (E2_GRUP_SATUAN)", bool(e) and "E2_GRUP_SATUAN" in e and "satuan dasar" in e and sales_count(h) == c0, e)
    e, _ = post(h, "o6", [line(GE, 1, 100)])
    check("paket tanpa isi ditolak (E2_GRUP_KOSONG)", bool(e) and "E2_GRUP_KOSONG" in e and sales_count(h) == c0, e)
    h.sql(f"alter table public.items disable trigger guard_master_lifecycle; update public.items set is_active=false where id={q(B)}; alter table public.items enable trigger guard_master_lifecycle;")
    e, _ = post(h, "o6b", [line(G, 1, 150000)])
    h.sql(f"alter table public.items disable trigger guard_master_lifecycle; update public.items set is_active=true where id={q(B)}; alter table public.items enable trigger guard_master_lifecycle;")
    check("isi paket nonaktif ditolak (E2_GRUP_RUSAK), tidak ada yang tersimpan", bool(e) and "E2_GRUP_RUSAK" in e and sales_count(h) == c0, e)

    e, r7 = post(h, "o7", [line(G3, 1, 2000)])
    s7 = sale_snapshot(h, r7["document_no"]) if r7 else None
    check("isi dengan satuan turunan: 1 Paket Box = 1 box Kibble = 10 pcs keluar (10@120 = HPP 1200)",
          e is None and s7 and n(s7["lines"][0]["comps"][0]["tbq"]) == 10 and n(s7["lines"][0]["comps"][0]["factor"]) == 10 and n(s7["lines"][0]["hpp"]) == 1200
          and stock(h, W1, A) == 6 and n(s7["hpp_journal"]) == 1200, e or s7)

    # ── cancellation restores components ──
    if r1:
        e, _ = cancel(h, r1["document_no"])
        ok = e is None and h.val(f"select voided_at is not null from public.sales where no_struk={q(r1['document_no'])}") == "t"
        check("batal order paket: berhasil (Owner), stok isi kembali ke lapisan FIFO asal (Kibble +4 ke lapisan tertua, Mangkok +2)",
              ok and stock(h, W1, A) == 10 and layer(h, L1) == 4 and stock(h, W1, B) == 9 and layer(h, LB) == 9, e)
        rev = h.j(f"select jsonb_build_object('void_moves',(select count(*) from public.stock_moves m join public.sale_cancellations c on c.id::text=m.source_ref join public.sales s on s.id=c.sale_id where s.no_struk={q(r1['document_no'])} and m.source='sale-void'),"
                  f"'void_hpp',(select coalesce(sum(l.credit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.sale_cancellations c on c.id::text=e.source_ref join public.sales s on s.id=c.sale_id join public.coa_accounts a on a.id=l.account_id where s.no_struk={q(r1['document_no'])} and e.source='sale-void-hpp' and a.code='600001'))")
        check("batal order paket: 2 mutasi pembatalan (per isi) dan jurnal balik HPP 500", n(rev["void_moves"]) == 2 and n(rev["void_hpp"]) == 500, rev)
    else:
        check("batal order paket: berhasil (Owner), stok isi kembali ke lapisan FIFO asal (Kibble +4 ke lapisan tertua, Mangkok +2)", False, "order paket tidak tersimpan")
        check("batal order paket: 2 mutasi pembatalan (per isi) dan jurnal balik HPP 500", False, "order paket tidak tersimpan")
    if r2:
        e, _ = cancel(h, r2["document_no"])
        check("batal order campuran (barang biasa + paket barang sama): stok Kibble +5 (1 ke lapisan tertua, 4 ke lapisan kedua), Mangkok +1",
              e is None and stock(h, W1, A) == 15 and layer(h, L1) == 5 and layer(h, L2) == 10 and stock(h, W1, B) == 10, e)
    else:
        check("batal order campuran (barang biasa + paket barang sama): stok Kibble +5 (1 ke lapisan tertua, 4 ke lapisan kedua), Mangkok +1", False, "order campuran tidak tersimpan")
    return r7


def rollback_cases(h, before, r7):
    e = None
    try: h.apply(ROLLBACK)
    except RuntimeError as x: e = str(x)
    check("rollback ditolak selama masih ada order online berisi paket yang aktif", bool(e) and "E2_ROLLBACK_DITOLAK" in e, e)
    if r7: cancel(h, r7["document_no"])
    e = None
    try: h.apply(ROLLBACK)
    except RuntimeError as x: e = str(x)
    after = digests(h)
    check("rollback (docs/runbooks/e2-grup-online/rollback.sql): kedua fungsi kembali persis seperti sebelum migrasi, fungsi internal terhapus",
          e is None and all(after.get(k) == before.get(k) for k in PATCHED) and not any(k.startswith("online_post_group_line(") for k in after), e)
    e2, _ = post(h, "rb1", [line(G, 1, 150000)])
    check("sesudah rollback: paket kembali ditolak seperti dulu", bool(e2) and "Grup tidak didukung pada online" in e2, e2)
    h.apply(CANDIDATE)
    e3, r = post(h, "rb2", [line(G, 1, 150000)])
    check("pasang ulang sesudah rollback: paket bisa dijual lagi", e3 is None and r is not None, e3)


def battery_ma(h):
    h.sql(f"""update public.inventory_costing_settings set method='moving_average',activated_at=now() where id;
update public.stock set average_cost=116 where warehouse_id={q(W1)} and item_id={q(A)};
update public.stock set average_cost=50 where warehouse_id={q(W1)} and item_id={q(B)};
update public.stock set average_cost=999 where warehouse_id={q(W2)} and item_id={q(A)};""")
    e, r = post(h, "m1", [line(G, 2, 150000)])
    s = sale_snapshot(h, r["document_no"]) if r else None
    ok = e is None and s and len(s["lines"]) == 1
    if ok:
        comps = {c["item"]: n(c["hpp"]) for c in s["lines"][0]["comps"]}
        ok = comps == {A: 464, B: 100, S: 0} and n(s["lines"][0]["hpp"]) == 564 and n(s["hpp_journal"]) == 564 and all(m["method"] == "moving_average" for m in s["moves"])
    check("moving average: 2 paket -> Kibble 4 x 116 = 464, Mangkok 2 x 50 = 100, HPP paket 564, mutasi bermetode average", ok, e or s)
    check("moving average: stok isi keluar dari gudang order", stock(h, W1, A) == 21 and stock(h, W1, B) == 8 and stock(h, W2, A) == 100)
    if r:
        e, _ = cancel(h, r["document_no"])
        check("moving average: batal order paket mengembalikan stok isi", e is None and stock(h, W1, A) == 25 and stock(h, W1, B) == 10, e)
    else:
        check("moving average: batal order paket mengembalikan stok isi", False, "order paket tidak tersimpan")
    e, _ = post(h, "m2", [line(G, 20, 150000)])
    check("moving average: stok isi kurang tetap ditolak", bool(e) and "isi paket" in e, e)


NEIGHBOURS = ["online_return_unit_posting.sql", "online_semua_gudang.sql", "posted_sale_cancellations.sql", "cashier_atomic_fifo_floor.sql",
              "p03_price_floor.sql", "average_sale_corrections.sql", "owner_jual_bawah_modal.sql"]


def owner_updates(source):
    return re.sub(r"(?m)^update profiles (.*);$", r"alter table profiles disable trigger guard_profile_privileges;\nselect set_config('test.fixture_actor',coalesce(current_setting('request.jwt.claim.sub',true),''),true);\nselect set_config('request.jwt.claim.sub','',true);\nupdate profiles \1;\nselect set_config('request.jwt.claim.sub',current_setting('test.fixture_actor',true),true);\nalter table profiles enable trigger guard_profile_privileges;", source)


def neighbour_text(name):
    text = (TESTS / name).read_text()
    if name in ("posted_sale_cancellations.sql", "average_sale_corrections.sql"):
        # Same composition as scripts/test-posted-sales-postgres.py / test-average-corrections-postgres.py.
        base = (TESTS / "pos_merchant_fees.sql").read_text()
        opening = (TESTS / "fixtures/average_opening_gl.sql").read_text() if name == "average_sale_corrections.sql" else ""
        text = base[:base.index("set local role authenticated;")] + opening + text
    return owner_updates(text)


def outcome(h, text):
    try: h.raw(text); return (0, "")
    except RuntimeError as e:
        errs = [l for l in str(e).splitlines() if l.startswith("ERROR")]
        return (1, (errs[0] if errs else str(e).strip().splitlines()[-1])[:200])


def clone(db, name):
    db.sql(f"drop database if exists {name}"); db.sql(f"create database {name} template tpl_base")
    return H(db, name)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--json", type=Path); ap.add_argument("--pg-bin", default=os.environ.get("PG_BIN", "/usr/lib/postgresql/16/bin"))
    ap.add_argument("--baseline", action="store_true"); a = ap.parse_args()
    with NativePostgres(a.pg_bin) as db:
        fixture.DisposablePostgres.bootstrap(_HoldBack(db))
        db.sql("create database tpl_base template postgres")
        if a.baseline:
            h = clone(db, "red"); prep(h)
            try: battery_fifo(h, "baseline")
            except Exception as e: check("battery", False, str(e)[:300])
        else:
            h = clone(db, "g"); before = digests(h)
            pre = h.raw(PREFLIGHT.read_text()).splitlines()
            check("preflight read-only (docs/runbooks/e2-grup-online/01-preflight-readonly.sql) di rantai tanpa migrasi: jangkar 1/1/1/1/2, belum terpasang",
                  bool(pre) and pre[0] == "1|1|1|1|2|f|f", pre[:2])
            h.apply(CANDIDATE); after = digests(h)
            changed = sorted(k for k in before if k in after and before[k] != after[k])
            new = sorted(k for k in after if k not in before)
            check("identitas: fungsi lama yang berubah tepat post_online_order dan assert_sale_group_cost_links (ACL/pemilik tetap)", changed == PATCHED, changed)
            check("identitas: satu fungsi baru online_post_group_line, tidak bisa dipanggil anon/authenticated/service_role",
                  len(new) == 1 and new[0].startswith("online_post_group_line(") and not re.search(r"(^|[{,])(authenticated|anon|service_role)?=X", after[new[0]].split("|", 1)[1]), (new, [after[k] for k in new]))
            h.apply(CANDIDATE)
            check("pasang ulang migrasi = tidak berubah", digests(h) == after)
            pre = h.raw(PREFLIGHT.read_text()).splitlines()
            check("preflight sesudah migrasi: sudah_terpasang = true, fungsi baru ada", bool(pre) and pre[0].endswith("|t|t"), pre[:1])
            prep(h)
            try:
                r7 = battery_fifo(h, "candidate")
                rollback_cases(h, before, r7)
            except Exception as e: check("battery", False, str(e)[:300])
            m = clone(db, "ma"); m.apply(CANDIDATE); prep(m)
            try: battery_ma(m)
            except Exception as e: check("battery-ma", False, str(e)[:300])
            for i, nb in enumerate(NEIGHBOURS):
                if not (TESTS / nb).exists(): continue
                res = {}
                for tag, with_cand in (("before", False), ("after", True)):
                    hh = clone(db, f"nb{i}_{tag}")
                    if with_cand: hh.apply(CANDIDATE)
                    res[tag] = outcome(hh, neighbour_text(nb))
                    db.sql(f"drop database nb{i}_{tag}")
                check(f"tetangga {nb}: hasil sama tanpa/dengan migrasi {res['after'][:1]}", res["before"] == res["after"], res, kind="regression")
    feature = [r for r in RESULTS if r["kind"] == "feature"]
    regression = [r for r in RESULTS if r["kind"] == "regression"]
    if a.baseline:
        red = [r for r in feature if r["status"] == "FAIL"]
        green = [r for r in regression if r["status"] == "PASS"]
        print(f"BASELINE: {len(red)}/{len(feature)} feature cases RED without the candidate; {len(green)}/{len(regression)} regression cases PASS.", flush=True)
        ok = len(red) == len(feature) and len(green) == len(regression)
    else:
        ok = all(r["status"] == "PASS" for r in RESULTS)
        print(f"{sum(r['status'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} PASS", flush=True)
    if a.json: a.json.write_text(json.dumps(dict(candidate=CANDIDATE.name, baseline=a.baseline, ok=ok, results=RESULTS), indent=1, default=str))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
