"""Shared fixtures for the Owner BMHP (bahan habis pakai) correction suites (part A: pending cart, part B: invoiced line).

Fictional data only. Every fixture is a RANAP visit (the DP-first stage invoice posted by scripts/test-ranap-racikan-postgres.py `visit`)
plus ONE extra pending procedure row carrying `bmhp_components`, saved by the real ranap cashier (`clinic_save_inpatient_cashier`).
Not a test by itself (no `test-` prefix); imported through importlib by the two suites.
"""
import importlib.util, json, math, sys
from decimal import Decimal
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('medical', ROOT / 'scripts/test-rekam-full-edit-postgres.py'); assert spec and spec.loader
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
x, r, q, j = m.x, m.r, m.q, m.j
c = x.c
D = Decimal
OFF = 0
# item ids (own range so nothing collides with other suites)
CAT, PROC, PROCJ, LAC, CB, CC, CX, CS, CU, CD, PROCB = (r.uid('e', 9300 + i) for i in range(11))
NAMES = {LAC: 'Lacto-B Fiktif', CB: 'Bahan B Fiktif', CC: 'Bahan C Fiktif', CX: 'Bahan nonaktif Fiktif', CS: 'Jasa bukan stok Fiktif', CU: 'Bahan Kotak Fiktif', CD: 'Bahan D Fiktif',
         PROC: 'Injeksi Antibiotik Fiktif', PROCJ: 'Tindakan Jasa Fiktif', PROCB: 'Injeksi Non Antibiotik Fiktif'}
COST = {LAC: D('12000'), CB: D('9100.25'), CC: D('500'), CU: D('100')}


def J(s): return json.loads(s, parse_float=Decimal)
def err_has(err, *words): return bool(err) and all(w in err for w in words)


def prep(h):
    """Procedure masters (under category TINDAKAN for the stock-type 'pesanan' procedure) and component masters."""
    h.sql(f"""
insert into public.item_categories(id,name) values ({q(CAT)},'TINDAKAN');
insert into public.items(id,code,name,unit,item_type,is_active,is_compound_material,sell_price,buy_price,category_id) values
 ({q(PROC)},'OBM-PROC','{NAMES[PROC]}','kali','Persediaan',true,false,50000,0,{q(CAT)}),
 ({q(PROCB)},'OBM-PROCB','{NAMES[PROCB]}','kali','Persediaan',true,false,50000,0,{q(CAT)}),
 ({q(PROCJ)},'OBM-PROCJ','{NAMES[PROCJ]}','kali','Jasa',true,false,50000,0,null),
 ({q(LAC)},'OBM-LAC','{NAMES[LAC]}','pcs','Persediaan',true,false,15000,12000,null),
 ({q(CB)},'OBM-CB','{NAMES[CB]}','ml','Persediaan',true,false,15000,9100.25,null),
 ({q(CC)},'OBM-CC','{NAMES[CC]}','ml','Persediaan',true,false,1000,500,null),
 ({q(CX)},'OBM-CX','{NAMES[CX]}','ml','Persediaan',false,false,1000,100,null),
 ({q(CS)},'OBM-CS','{NAMES[CS]}','kali','Jasa',true,false,1000,0,null),
 ({q(CU)},'OBM-CU','{NAMES[CU]}','pcs','Persediaan',true,false,1000,100,null),
 ({q(CD)},'OBM-CD','{NAMES[CD]}','ml','Persediaan',true,false,1000,100,null);
insert into public.item_units(item_id,unit,factor,sell_price,buy_price) values ({q(CU)},'kotak',10,0,1000);
insert into public.stock(warehouse_id,item_id,qty) values ({q(r.WH)},{q(LAC)},0),({q(r.WH)},{q(CB)},0),({q(r.WH)},{q(CC)},0),({q(r.WH)},{q(CX)},0),({q(r.WH)},{q(CU)},0),({q(r.WH)},{q(CD)},0);
""")


def fresh(h, item, qty, cost=None, date='2026-01-01'):
    """A fresh EARLIEST FIFO layer so the fixture's consumption cost is known to the cent."""
    cost = COST[item] if cost is None else cost
    h.sql(f"insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values ({q(r.WH)},{q(item)},{q(date)},{qty},{qty},{cost},'purchase');"
          f"update public.stock set qty=qty+{qty} where warehouse_id={q(r.WH)} and item_id={q(item)};")


def comp(item, qty, unit=None):
    row = dict(item_id=item, qty=qty)
    if unit: row['unit'] = unit
    return row


def bmhp_visit(h, n, comps=None, price=50000, proc=PROC, qty=1, out_cost=None, headroom=60, layers=True):
    """RANAP visit WITH the DP-first stage invoice, plus one pending procedure row with the doctor's BMHP (default LAC 5 @12000 = HPP 60000 > price 50000).
    `proc` PROC = stock-type procedure (jenis obat, 'pesanan' flow: components out, output in at their cost, output out at FIFO); PROCJ = service (jenis jasa).
    `out_cost`: an older output-item layer at that cost (live INV-0434 shape: FIFO sells the OLDER output layer, so line HPP != component cost)."""
    n += OFF
    comps = [comp(LAC, 5)] if comps is None else comps
    v, mr = x.visit(h, n)
    rx = r.uid(9, n * 10 + 7)
    if layers:
        for cp in comps:
            fresh(h, cp['item_id'], math.ceil(float(cp['qty'])) + headroom)
    if out_cost is not None:
        h.sql(f"insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values ({q(r.WH)},{q(proc)},'2025-12-01',1,1,{out_cost},'purchase');"
              f"insert into public.stock(warehouse_id,item_id,qty) values ({q(r.WH)},{q(proc)},1) on conflict (warehouse_id,item_id) do update set qty=public.stock.qty+1;")
    jenis = 'jasa' if proc == PROCJ else 'obat'
    h.sql(f"insert into public.prescription_items(id,medical_record_id,nama_obat,item_id,qty,satuan,faktor,harga,jenis,kategori,bmhp_components) "
          f"values ({q(rx)},{q(mr)},{q(NAMES[proc])},{q(proc)},{qty},'kali',1,{price},{q(jenis)},'Tindakan',{q(json.dumps(comps))}::jsonb);")
    stay = h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
    return dict(v=v, mr=mr, rx=rx, stay=stay, n=n, proc=proc, comps=comps)


def read_cart(h, rv, user=r.OWNER):
    return json.loads(h.nilai(f"select clinic_read_inpatient_cashier({q(rv['stay'])},{q(rv['v'])});", user))


def save_sql(h, rv, key, parts, user=r.OWNER, snapshot=None, rows=None):
    cart = read_cart(h, rv, user)
    return (f"select clinic_save_inpatient_cashier({q(rv['stay'])},{q(rv['v'])},{q(key + str(OFF))},'2026-11-03',{q(snapshot or cart['snapshot'])},{j(rows if rows is not None else cart['rows'])},{j(parts)},null,false,null,'Kasir Fiktif');"), cart


def save(h, rv, key, parts=None, user=r.OWNER, paid=False):
    """Cashier save through the REAL ranap cashier. paid=True pays everything open on the visit with Tunai."""
    cart = read_cart(h, rv, user)
    if paid: parts = [dict(method='Tunai', amount=cart['quote']['remaining'])]
    sql = (f"select clinic_save_inpatient_cashier({q(rv['stay'])},{q(rv['v'])},{q(key + str(OFF))},'2026-11-03',{q(cart['snapshot'])},{j(cart['rows'])},{j(parts or [])},null,false,null,'Kasir Fiktif');")
    return h.gagal(sql, user), cart


def link(h, rv):
    """Invoice line / invoice of the procedure row once the cashier saved it."""
    rv['line'] = h.nilai(f"select id from invoice_items where prescription_item_id={q(rv['rx'])} and invoice_id in (select id from invoices where voided_at is null)") or None
    rv['inv'] = h.nilai(f"select invoice_id from invoice_items where id={q(rv['line'])}") if rv['line'] else None
    rv['no'] = h.nilai(f"select invoice_no from invoices where id={q(rv['inv'])}") if rv['inv'] else None
    return rv


def stock_state(h, items=(LAC, CB, CC, CX, CU, CD)):
    sl = ','.join(q(i) for i in items)
    return dict(
        stock=h.nilai(f"select coalesce(jsonb_object_agg(item_id::text,qty),'{{}}') from stock where warehouse_id={q(r.WH)} and item_id in ({sl})"),
        layers=h.nilai(f"select coalesce(jsonb_agg(jsonb_build_array(item_id,tanggal,qty_in,qty_left,unit_cost,source) order by item_id,tanggal,created_at,id),'[]') from stock_layers where item_id in ({sl})"),
        moves=h.nilai('select count(*) from stock_moves'))


def rx_row(h, rv): return json.loads(h.nilai(f"select to_jsonb(p) from prescription_items p where id={q(rv['rx'])}"))
def comps_of(h, rv): return rx_row(h, rv)['bmhp_components']
def line_row(h, rv): return json.loads(h.nilai(f"select coalesce(to_jsonb(ii),'null') from invoice_items ii where id={q(rv['line'])}")) if rv.get('line') else None


def jr(h, ref):
    """Journal rows of a document reference, ordered by creation."""
    return J(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_array(e.source,e.tanggal,a.code,l.debit,l.credit) order by e.created_at,e.no_jurnal,l.debit desc,a.code),'[]') "
                     f"from journal_entries e join journal_lines l on l.entry_id=e.id join coa_accounts a on a.id=l.account_id where e.source_ref={q(ref)}"))


def jsum(rows):   # net HPP booked (600001 debit - credit) by 'klinik-hpp' + 'klinik-hpp-edit'
    return sum((row[3] - row[4]) for row in rows if row[2] == '600001' and row[0] in ('klinik-hpp', 'klinik-hpp-edit'))


def all_balanced(h):
    return h.nilai("select coalesce(sum(l.debit-l.credit),0) from journal_lines l")


def unbalanced_entries(h):
    return int(h.nilai("select count(*) from (select entry_id from journal_lines group by entry_id having sum(debit)<>sum(credit)) z"))
