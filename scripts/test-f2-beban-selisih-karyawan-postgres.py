#!/usr/bin/env python3
"""F2 (meeting 12 Nov 2026): beban selisih kurang opname ke karyawan sebagai kasbon (migrasi 20261118660000_f2_beban_selisih_karyawan.sql).

Native throwaway PostgreSQL only (full migration chain incl. F1, fictional fixtures). Never accepts a database URL, no network.

  python3 -I scripts/test-f2-beban-selisih-karyawan-postgres.py [--pg-bin DIR] [--json out.json] [--baseline]
  (default)   chain without candidate -> fixtures (opname F1 + satu opname "lama") -> candidate -> behaviour checks.
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
CANDIDATE = ROOT / "supabase/migrations/20261118660000_f2_beban_selisih_karyawan.sql"
RESULTS = []

U = lambda n: f"f2000000-0000-4000-8000-{n:012d}"
OWNER, FINANCE, ADMIN, STAFF = U(1), U(2), U(3), U(4)
BR_A, BR_B, WH_A, WH_B = U(11), U(12), U(21), U(22)
EMP_A, EMP_B, EMP_OFF = U(31), U(32), U(33)
# (biaya lapisan, harga jual master)
ITEMS = dict(a=(100, 150), b=(40, 50), c=(100, 60), d=(30, 45), e=(20, 30), p=(10, 25), x=(50, 80), y=(70, 90), z=(10, 20), o=(10, 20))
ITEM = {k: U(100 + i) for i, k in enumerate(ITEMS)}
ACTION = "persediaan.beban_selisih_karyawan"


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

    def val(self, s, user=None, role="authenticated"):
        if user is None: out = self.db.sql(s)
        else:
            out = self.db.sql(f"begin;\nset local role {role};\n"
                              f"select set_config('request.jwt.claim.sub',{q(user)},true);\n"
                              f"select set_config('request.jwt.claims',{q(json.dumps(dict(sub=user, role=role)))},true);\n"
                              f"select set_config('request.jwt.claim.role',{q(role)},true);\n" + s + "\ncommit;")
        lines = [x for x in out.splitlines() if x != ""]
        return lines[-1] if lines else ""

    def err(self, s, user=None, role="authenticated"):
        try: self.val(s, user, role); return None
        except RuntimeError as e: return str(e)

    def js(self, s, user=None):
        v = self.val(s, user)
        return json.loads(v) if v else None


ORDERS = {}


def post(h, label, counts, wh=WH_A):
    oid = ORDERS.setdefault(label, U(5000 + len(ORDERS)))
    h.sql(f"insert into public.opname_orders(id,no_opname,warehouse_id,penanggung_jawab) values({q(oid)},'OPO.F2.'||{q(label[:10].upper())},{q(wh)},'Penghitung fiktif') on conflict do nothing;")
    body = ",".join(f"{q(ITEM[k])},{v}" for k, v in counts.items())
    r = h.js(f"select public.post_opname_atomic({q(oid)},current_date,jsonb_build_object({body}));", OWNER)
    return r["result_id"], r["no_hasil"]


def prep(h):
    users = [(OWNER, "OWNER"), (FINANCE, "FINANCE"), (ADMIN, "ADMIN"), (STAFF, "STAFF")]
    h.sql("insert into auth.users(id) values " + ",".join(f"({q(u)})" for u, _ in users) + ";"
          + "".join(f"update public.profiles set role={q(r)},is_active=true,full_name={q('Akun ' + r)} where id={q(u)};" for u, r in users))
    h.sql(f"""insert into public.branches(id,code,name,type) values({q(BR_A)},'F2A','Cabang Fiktif A','KLINIK'),({q(BR_B)},'F2B','Cabang Fiktif B','KLINIK');
insert into public.warehouses(id,branch_id,code,name,type) values({q(WH_A)},{q(BR_A)},'F2A','Gudang Fiktif A','VET'),({q(WH_B)},{q(BR_B)},'F2B','Gudang Fiktif B','VET');
insert into public.user_branches(user_id,branch_id) values({q(FINANCE)},{q(BR_A)}),({q(ADMIN)},{q(BR_A)}),({q(STAFF)},{q(BR_A)});
insert into public.role_capabilities(role,all_branches,create_accounts) values('FINANCE',false,false),('ADMIN',false,false) on conflict(role) do update set all_branches=false;
insert into public.coa_accounts(code,name,type,normal_balance) values('170001','Persediaan fiktif','ASET','D'),('720010','Beban selisih stok fiktif','BEBAN','D'),
 ('810004','Pendapatan lain-lain fiktif','PENDAPATAN','K'),('182001','Kasbon karyawan fiktif','ASET','D') on conflict(code) do update set is_active=true,is_header=false;
insert into public.employees(id,nama,branch_id,status) values({q(EMP_A)},'Karyawan Fiktif A',{q(BR_A)},'Aktif'),({q(EMP_B)},'Karyawan Fiktif B',{q(BR_A)},'Aktif'),
 ({q(EMP_OFF)},'Karyawan Fiktif Nonaktif',{q(BR_A)},'Nonaktif');""")
    h.sql("insert into public.items(id,code,name,unit,item_type,buy_price,sell_price) values "
          + ",".join(f"({q(ITEM[k])},'F2-{k}','Barang fiktif {k}','PCS','Persediaan',{c},{s})" for k, (c, s) in ITEMS.items()) + ";")
    for n, k in enumerate(ITEMS):
        wh = WH_B if k == "o" else WH_A
        if k != "p": h.sql(f"select public.stock_in_fifo({q(wh)},{q(ITEM[k])},10,{ITEMS[k][0]},'fixture','F2-FIX-{n}',current_date-30,null);")
    h.sql(f"insert into public.stock(warehouse_id,item_id,qty) values({q(WH_A)},{q(ITEM['p'])},0) on conflict do nothing;")
    # ADMIN memegang izin khusus (kebijakan tersimpan); FINANCE tidak.
    h.sql("alter table role_settings_private.action_policies disable trigger user;"
          f"insert into role_settings_private.action_policies(role,allowed) values('ADMIN',array[{q(ACTION)}]) on conflict(role) do update set allowed=excluded.allowed;"
          "insert into role_settings_private.action_policies(role,allowed) values('FINANCE',array['kasir.diskon_manual']) on conflict(role) do update set allowed=excluded.allowed;"
          "alter table role_settings_private.action_policies enable trigger user;")
    docs = {}
    docs["main"] = post(h, "main", {"a": 9, "b": 8, "p": 1})      # kurang a 1 (100/150), b 2 (80/100); lebih p 1
    docs["plus"] = post(h, "plus", {"p": 2})                       # hanya lebih
    docs["below"] = post(h, "below", {"c": 9})                     # jual 60 < HPP 100
    docs["legacy"] = post(h, "legacy", {"d": 9})                   # dipaksa menjadi bukti kebijakan lama
    docs["closed"] = post(h, "closed", {"e": 9})
    docs["cor"] = post(h, "cor", {"x": 9})
    docs["inst"] = post(h, "inst", {"z": 9})
    docs["other"] = post(h, "other", {"o": 9}, wh=WH_B)
    # Opname "lama" (sebelum F1): bukti posting kebijakan uniform-variance-expense.
    h.sql("set session_replication_role=replica;"
          f"update public.opname_posting_receipts set source_snapshot=jsonb_set(source_snapshot,'{{warehouse_policy}}','\"uniform-variance-expense\"') where result_id={q(docs['legacy'][0])};"
          "set session_replication_role=origin;")
    return docs


def charge(h, user, result, lines, reason, key):
    body = json.dumps([dict(employee_id=e, amount=a) for e, a in lines])
    try: return None, h.js(f"select public.charge_opname_variance_to_employees({q(result)},{q(body)}::jsonb,{q(reason)},{q(key)}::uuid);", user)
    except RuntimeError as e: return str(e), None


def cancel(h, user, charge_id, reason, key):
    try: return None, h.js(f"select public.cancel_opname_variance_charge({q(charge_id)},{q(reason)},{q(key)}::uuid);", user)
    except RuntimeError as e: return str(e), None


def gl(h, source, ref):
    return {k: float(v) for k, v in (h.js(f"""select coalesce(jsonb_object_agg(code,net),'{{}}') from (select a.code,sum(l.debit-l.credit) net from public.journal_lines l
 join public.coa_accounts a on a.id=l.account_id join public.journal_entries e on e.id=l.entry_id
 where e.source={q(source)} and e.source_ref={q(ref)} group by a.code) x""") or {}).items()}


def advances(h, result):
    return h.js(f"""select coalesce(jsonb_agg(jsonb_build_object('employee_id',ca.employee_id,'jumlah',ca.jumlah,'status',ca.status,'tenor',ca.tenor_bulan,'alasan',ca.alasan) order by ca.employee_id),'[]')
 from public.cash_advances ca where ca.alasan like 'Beban selisih stok opname '||(select no_hasil from public.opname_results where id={q(result)})||'%'""") or []


def correct(h, doc, rows, key, user=OWNER):
    rj = json.dumps([dict(item_id=ITEM[k], qty=v) for k, v in rows.items()])
    try:
        prev = h.js(f"select public.preview_stock_document_correction('opname',{q(doc)},{q(rj)}::jsonb);", user)
        return None, h.js(f"select public.correct_stock_document('opname',{q(doc)},{q(rj)}::jsonb,'Koreksi fiktif F2',{q(key)},{q(prev['token'])});", user)
    except RuntimeError as e: return str(e), None


def run(h, d):
    main_id, main_no = d["main"]
    # ---- ringkasan & hak baca
    s = None
    try: s = h.js(f"select public.read_opname_variance_charge({q(main_id)});", FINANCE)
    except RuntimeError as e: s = dict(err=str(e))
    check("ringkasan (FINANCE cabang A): baris kurang saja, HPP 180 & harga jual 250, pratinjau Cr 720010 180 / Cr 810004 70; FINANCE tanpa izin tidak bisa membebankan",
          bool(s) and s.get("minus_count") == 2 and float(s.get("hpp_total", -1)) == 180 and float(s.get("jual_total", -1)) == 250
          and float(s.get("hpp_part", -1)) == 180 and float(s.get("gain_part", -1)) == 70 and s.get("refuse") is None and s.get("can_charge") is False, s)
    e = h.err(f"select public.read_opname_variance_charge({q(main_id)});", STAFF)
    check("STAFF tanpa izin tidak boleh membaca nilai selisih", bool(e) and "Owner/Finance" in e, e)
    e = h.err(f"select public.read_opname_variance_charge({q(main_id)});", OWNER, role="anon")
    check("anon tidak bisa memanggil fungsi ringkasan", bool(e) and "permission denied" in e, e)
    a = h.err("select public.opname_variance_charge_allowed();", ADMIN) or h.val("select public.opname_variance_charge_allowed();", ADMIN)
    f = h.err("select public.opname_variance_charge_allowed();", FINANCE) or h.val("select public.opname_variance_charge_allowed();", FINANCE)
    check("pemeriksa izin: ADMIN dengan izin = true, FINANCE tanpa izin = false", a == "t" and f == "f", dict(admin=a, finance=f))

    # ---- hak catat
    e, _ = charge(h, FINANCE, main_id, [(EMP_A, 250)], "Barang hilang di rak", U(9001))
    check("FINANCE tanpa izin khusus: pencatatan ditolak", bool(e) and "BEBAN_KARYAWAN_DITOLAK" in e, e)
    e, _ = charge(h, ADMIN, d["other"][0], [(EMP_A, 40)], "Barang hilang di rak", U(9002))
    check("ADMIN berizin: opname cabang lain (tanpa akses cabang) ditolak", bool(e) and "tidak dapat diakses" in e, e)

    # ---- validasi pembagian
    e, _ = charge(h, OWNER, main_id, [(EMP_A, 100), (EMP_B, 100)], "Barang hilang di rak", U(9003))
    check("total pembagian harus sama persis dengan nilai jual (200 != 250) — ditolak", bool(e) and "BEBAN_KARYAWAN_TOTAL" in e, e)
    e, _ = charge(h, OWNER, main_id, [(EMP_A, 125), (EMP_A, 125)], "Barang hilang di rak", U(9004))
    check("karyawan ganda ditolak", bool(e) and "hanya boleh dipilih sekali" in e, e)
    e, _ = charge(h, OWNER, main_id, [(EMP_OFF, 250)], "Barang hilang di rak", U(9005))
    check("karyawan nonaktif ditolak", bool(e) and "tidak aktif" in e, e)
    e, _ = charge(h, OWNER, main_id, [(EMP_A, 250)], "x", U(9006))
    check("alasan wajib (3-300 huruf)", bool(e) and "BEBAN_KARYAWAN_ALASAN" in e, e)
    e, _ = charge(h, OWNER, main_id, [(EMP_A, 249.995), (EMP_B, 0.005)], "Barang hilang di rak", U(9007))
    check("jumlah lebih dari 2 desimal ditolak", bool(e) and "BEBAN_KARYAWAN_BAGI" in e, e)

    # ---- catat: ADMIN berizin, dibagi dua karyawan
    e, r = charge(h, ADMIN, main_id, [(EMP_A, 150), (EMP_B, 100)], "Barang hilang di rak depan", U(9010))
    g = gl(h, "opname-beban-karyawan", main_no)
    check("jurnal beban: Dr 182001 250 / Cr 720010 180 / Cr 810004 70 (jual - HPP)",
          e is None and g == {"182001": 250.0, "720010": -180.0, "810004": -70.0}, e or g)
    tg = h.val(f"select string_agg(distinct tanggal::text||'|'||coalesce(branch_id::text,''),',') from public.journal_entries where source='opname-beban-karyawan' and source_ref={q(main_no)}")
    today = h.val("select (now() at time zone 'Asia/Jakarta')::date")
    check("tanggal jurnal = hari ini (WIB), cabang = cabang gudang opname", tg == f"{today}|{BR_A}", dict(jurnal=tg, today=today))
    adv = advances(h, main_id)
    check("kasbon per karyawan: 150 + 100, status Dicatat, tenor 1, alasan menyebut nomor opname",
          [(x["employee_id"], float(x["jumlah"]), x["status"], x["tenor"]) for x in adv] == [(EMP_A, 150.0, "Dicatat", 1), (EMP_B, 100.0, "Dicatat", 1)]
          and all(main_no in x["alasan"] and "Barang hilang" in x["alasan"] for x in adv), adv)
    dis = h.val(f"select count(*) from public.cash_advances where employee_id in ({q(EMP_A)},{q(EMP_B)}) and status='Disetujui'")
    check("tidak dipotong gaji otomatis: penggajian membaca status 'Disetujui' saja -> 0 kasbon terbaca", len(adv) == 2 and dis == "0", dict(disetujui=dis, kasbon=len(adv)))
    try: s2 = h.js(f"select public.read_opname_variance_charge({q(main_id)});", FINANCE)
    except RuntimeError: s2 = None
    ch = (s2 or {}).get("charges") or [{}]
    check("ringkasan sesudah dicatat: penolakan SUDAH, riwayat berisi 2 karyawan + status kasbon + nama pelaku",
          (s2 or {}).get("refuse", {}).get("code") == "SUDAH" and len(ch) == 1 and len(ch[0].get("lines", [])) == 2
          and {x["status"] for x in ch[0]["lines"]} == {"Dicatat"} and ch[0].get("actor_name") == "Akun ADMIN", s2 and dict(refuse=s2.get("refuse"), charges=ch))
    log = h.val("select count(*) from public.activity_log where entity='opname_variance_charges'") if r else "0"
    logk = h.val("select count(*) from public.activity_log where row_entity='cash_advances'")
    check("Log Aktifitas: beban tercatat (sumber opname_variance_charges) dan kasbon tercatat", log not in ("", "0") and logk not in ("", "0"), dict(beban=log, kasbon=logk))

    # ---- idempoten & anti dobel
    e, r2 = charge(h, ADMIN, main_id, [(EMP_A, 150), (EMP_B, 100)], "Barang hilang di rak depan", U(9010))
    n_ch = h.err("select 1") or h.val(f"select count(*) from public.opname_variance_charges where result_id={q(main_id)}") if r else "0"
    check("kunci sama + isi sama: hasil lama (already_applied), tidak ada baris/jurnal dobel",
          e is None and r2 and r2.get("already_applied") is True and r2.get("charge_id") == (r or {}).get("charge_id") and n_ch == "1"
          and gl(h, "opname-beban-karyawan", main_no) == {"182001": 250.0, "720010": -180.0, "810004": -70.0}, e or r2)
    e, _ = charge(h, ADMIN, main_id, [(EMP_A, 250)], "Barang hilang di rak depan", U(9010))
    check("kunci sama + isi beda: ditolak", bool(e) and "KUNCI_DIPAKAI" in e, e)
    e, _ = charge(h, OWNER, main_id, [(EMP_A, 250)], "Coba bebankan lagi", U(9011))
    check("beban kedua untuk opname yang sama (kunci baru): ditolak", bool(e) and "BEBAN_KARYAWAN_SUDAH" in e, e)

    # ---- batal -> boleh dicatat ulang
    e, c = cancel(h, OWNER, (r or {}).get("charge_id"), "Salah pilih karyawan", U(9020))
    g = gl(h, "opname-beban-batal", main_no)
    adv = advances(h, main_id)
    check("batalkan beban: jurnal pembalik persis (Dr 720010 180, Dr 810004 70 / Cr 182001 250), kasbon -> Batal",
          e is None and g == {"182001": -250.0, "720010": 180.0, "810004": 70.0} and {x["status"] for x in adv} == {"Batal"}, e or dict(gl=g, adv=adv))
    e2, c2 = cancel(h, OWNER, (r or {}).get("charge_id"), "Salah pilih karyawan", U(9020))
    e3, _ = cancel(h, OWNER, (r or {}).get("charge_id"), "Batal lagi", U(9021))
    check("pembatalan idempoten (kunci sama = hasil lama); pembatalan kedua ditolak",
          e2 is None and c2 and c2.get("already_applied") is True and bool(e3) and "SUDAH_BATAL" in e3, dict(replay=e2 or c2, kedua=e3))
    e, r3 = charge(h, OWNER, main_id, [(EMP_B, 250)], "Dibebankan ke karyawan yang benar", U(9012))
    check("sesudah dibatalkan, beban boleh dicatat ulang (satu beban AKTIF per opname)",
          e is None and r3 and r3.get("already_applied") is False and gl(h, "opname-beban-karyawan", main_no) == {"182001": 500.0, "720010": -360.0, "810004": -140.0}, e or r3)

    # ---- koreksi sesudah beban ditolak; batal -> koreksi boleh; sesudah dikoreksi -> beban ditolak
    cor_id, cor_no = d["cor"]
    e, rc = charge(h, OWNER, cor_id, [(EMP_A, 80)], "Barang hilang", U(9040))
    e2, _ = correct(h, cor_id, {"x": 10}, "f2-cor-1")
    check("koreksi stok opname yang sudah dibebankan: ditolak dengan pesan batalkan beban dulu", e is None and bool(e2) and "Batalkan beban karyawan dulu" in e2, e or e2)
    e, _ = cancel(h, OWNER, (rc or {}).get("charge_id"), "Untuk koreksi hitungan", U(9041))
    e2, _ = correct(h, cor_id, {"x": 10}, "f2-cor-2")
    check("sesudah beban dibatalkan, koreksi stok opname boleh lagi", e is None and e2 is None, dict(batal=e, koreksi=e2), kind="regression")
    e, _ = charge(h, OWNER, cor_id, [(EMP_A, 80)], "Sesudah koreksi", U(9042))
    check("opname yang sudah dikoreksi: beban ditolak (hanya hasil asal yang belum dikoreksi)", bool(e) and "BEBAN_KARYAWAN_DIKOREKSI" in e, e)

    # ---- aturan lain
    e, _ = charge(h, OWNER, d["legacy"][0], [(EMP_A, 15)], "Barang hilang", U(9030))
    check("opname lama (sebelum F1): ditolak dengan pesan", bool(e) and "BEBAN_KARYAWAN_LAMA" in e and "sebelum aturan akun selisih baru" in e, e)
    e, _ = charge(h, OWNER, d["plus"][0], [(EMP_A, 1)], "Barang hilang", U(9031))
    check("opname tanpa selisih kurang: ditolak", bool(e) and "BEBAN_KARYAWAN_TANPA_KURANG" in e, e)
    e, r4 = charge(h, OWNER, d["below"][0], [(EMP_A, 60)], "Barang pecah", U(9032))
    g = gl(h, "opname-beban-karyawan", d["below"][1])
    check("harga jual < HPP: karyawan menanggung harga jual 60; Cr 720010 60, tanpa baris 810004 (sisa HPP 40 tetap beban)",
          e is None and g == {"182001": 60.0, "720010": -60.0}, e or g)
    h.sql("update public.accounting_locks set closed_until=current_date+1 where id;")
    e, _ = charge(h, OWNER, d["closed"][0], [(EMP_A, 30)], "Barang hilang", U(9033))
    e2, _ = cancel(h, OWNER, (r4 or {}).get("charge_id"), "Coba batal saat tutup buku", U(9034))
    h.sql("update public.accounting_locks set closed_until=null where id;")
    check("periode akuntansi tertutup: pencatatan dan pembatalan ditolak", bool(e) and "BEBAN_KARYAWAN_PERIODE" in e and bool(e2) and "BEBAN_KARYAWAN_PERIODE" in e2, dict(catat=e, batal=e2))

    e, r5 = charge(h, OWNER, d["inst"][0], [(EMP_A, 20)], "Barang hilang", U(9035))
    adv_id = h.val(f"select advance_ids[1] from public.opname_variance_charges where id={q(r5.get('charge_id'))}") if r5 else ""
    if adv_id: h.sql(f"insert into public.cash_advance_installments(advance_id,periode,jumlah) values({q(adv_id)},'2026-11',5);")
    e2, _ = cancel(h, OWNER, (r5 or {}).get("charge_id"), "Coba batal", U(9036))
    check("kasbon yang sudah mulai dibayar: pembatalan ditolak", e is None and bool(e2) and "KASBON_JALAN" in e2, e or e2)

    # ---- jejak tetap
    cid = (r4 or {}).get("charge_id")
    e = h.err(f"update public.opname_variance_charges set total=1 where id={q(cid)};")
    e2 = h.err(f"delete from public.opname_variance_charges where id={q(cid)};")
    if not cid: e = e2 = None
    check("jejak beban tidak bisa diubah atau dihapus (bahkan oleh pemilik tabel)", bool(e) and "JEJAK" in e and bool(e2) and "JEJAK" in e2, dict(ubah=e, hapus=e2))
    e = h.err(f"select * from public.opname_variance_charges;", STAFF)
    check("tabel jejak tidak bisa dibaca langsung oleh klien", bool(e) and "permission denied" in e, e)

    # ---- regresi kasbon lama
    e = h.err(f"insert into public.cash_advances(employee_id,jumlah,status) values({q(EMP_A)},1000,'Menunggu');")
    e2 = h.err(f"insert into public.cash_advances(employee_id,jumlah,status) values({q(EMP_A)},1000,'Aneh');")
    check("status kasbon lama tetap sah; status tak dikenal tetap ditolak", e is None and bool(e2) and "check" in e2.lower(), dict(lama=e, aneh=e2), kind="regression")


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--json", type=Path); ap.add_argument("--pg-bin", default=os.environ.get("PG_BIN", "/usr/lib/postgresql/16/bin"))
    ap.add_argument("--baseline", action="store_true"); a = ap.parse_args()
    with NativePostgres(a.pg_bin) as db:
        fixture.DisposablePostgres.bootstrap(_HoldBack(db))
        h = H(db); docs = prep(h)
        if not a.baseline: h.sql("begin;\n" + CANDIDATE.read_text() + "\ncommit;")
        try: run(h, docs)
        except Exception as e: check("battery run", False, str(e)[:400])
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
