#!/usr/bin/env python3
"""Peran "Admin Online" (ADMIN_ONLINE), Andri 17-18 Nov 2026: akun yang HANYA boleh memasukkan penjualan marketplace.

Migrasi: 20261126100000_admin_online_enum.sql (nilai enum) + 20261126100100_admin_online_role.sql (isi).
Dibuktikan di database (gagal tertutup):
  - post_online_order: ADMIN_ONLINE hanya cabang sendiri, gudang ONLINE/RETAIL, channel marketplace, tanpa pelanggan,
    nomor pesanan wajib & tidak ganda; peran lain memakai pemeriksaan lama PERSIS;
  - pagar tulis: ADMIN_ONLINE tidak bisa menulis tabel apa pun (langsung maupun lewat fungsi SECURITY DEFINER) di luar
    transaksi post_online_order;
  - pagar baca: tabel public tidak terbaca (kecuali profil sendiri/cabang/gudang/aturan peran), pembaca SECURITY DEFINER
    tanpa gerbang peran ditolak, RPC katalog impor tanpa harga beli/HPP;
  - akun: OWNER bisa memberi peran ini (cabang wajib);
  - peran lama tidak berubah: snapshot Akses Grup 4 peran, definisi fungsi lain, kebijakan & pemicu lama sama persis.

Native full schema (semua migrasi repo), fixture fiktif, cluster lokal sekali pakai, tanpa jaringan.
  python3 -I scripts/test-admin-online-postgres.py [--pg-bin DIR] [--json out.json]
  --baseline    rantai TANPA migrasi isi (hanya enum): kasus fitur harus GAGAL (RED)
  --mutations   tiap mutan migrasi isi di database klon; semua mutan harus mati
"""
import argparse, hashlib, importlib.util, json, os, sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
ENUM = ROOT / "supabase/migrations/20261126100000_admin_online_enum.sql"
CANDIDATE = ROOT / "supabase/migrations/20261126100100_admin_online_role.sql"
RESULTS = []

U = lambda n: f"a0a00000-0000-4000-8000-{n:012d}"
OWNER, ADMIN, STAFF, AO, AO_OFF, AO_TARGET, STAFF_SALES = (U(i) for i in range(1, 8))
BR_A, BR_B = U(101), U(102)
WH_A, WH_B, WH_A_KLINIK, WH_A_RETAIL = U(201), U(202), U(203), U(204)
ITEM, ITEM2 = U(301), U(302)
CUST = U(401)
# Tambalan BERJANGKAR (bukan penjaga massal): perubahan isi yang ditinjau satu per satu.
PATCHED = {
    "public.post_online_order(text,jsonb,jsonb)", "public.preflight_employee_account(uuid,text,uuid[])",
    "public.configure_employee_account(uuid,uuid,text,text,uuid[])", "public.edit_user_account(uuid,text,text,uuid[],text,uuid)",
    "public.get_user_account_for_edit(uuid)", "public.preview_clinic_refund_source(uuid)", "public.clinic_quote_inpatient_payment(uuid,uuid,jsonb)",
}
GUARD_LINE = "\n  perform admin_online_private.deny_admin_online();"
# Fungsi SECURITY DEFINER yang SENGAJA tidak diberi penjaga massal (alasan di migrasi): gerbang sendiri / dipakai kebijakan RLS.
SIN = "'public.post_online_order(text,jsonb,jsonb)'"


def q(v): return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def j(v): return q(json.dumps(v)) + "::jsonb"


def check(name, ok, detail=None):
    RESULTS.append(dict(case=name, status="PASS" if ok else "FAIL", detail=detail))
    print(RESULTS[-1]["status"], name, json.dumps(detail, default=str)[:300], flush=True)


class _HoldBack:
    """Bootstrap bersama: semua migrasi KECUALI dua kandidat."""
    def __init__(self, db): self.db = db
    def sql(self, source):
        for f in (ENUM, CANDIDATE):
            if source == "begin;\n" + f.read_text() + "\ncommit;": return ""
        return self.db.sql(source)


class DevDb:
    """Hanya pengembangan: cluster yang sudah hidup (rantai tanpa kandidat sebagai database 'postgres'); database klon baru."""
    def __init__(self, template):
        self.root = os.environ["AO_DEV_ROOT"]; self.template = template; self.name = f"aodev_{os.getpid()}"
        self.psql = os.environ.get("AO_DEV_PSQL", "psql")
    def __enter__(self):
        os.environ.pop("PGDATABASE", None)
        self.sql(f"drop database if exists {self.name}"); self.sql(f"create database {self.name} template {self.template}")
        os.environ["PGDATABASE"] = self.name; return self
    def __exit__(self, *_): pass
    def sql(self, source):
        import subprocess
        r = subprocess.run([self.psql, "-X", "-qAt", "-h", self.root, "-U", "postgres", "-v", "ON_ERROR_STOP=1"], input=source, text=True,
                           capture_output=True, env={**os.environ, "PSQLRC": "/dev/null"})
        if r.returncode: raise RuntimeError(r.stderr + r.stdout)
        return r.stdout.strip()


class H:
    def __init__(self, db): self.db = db

    def sql(self, s): return self.db.sql(s)

    def val(self, s, user=None):
        if user is None: out = self.db.sql(s)
        else:
            out = self.db.sql("begin;\nset local role authenticated;\n"
                              f"select set_config('request.jwt.claim.sub',{q(user)},true);\n"
                              f"select set_config('request.jwt.claims',{q(json.dumps(dict(sub=user, role='authenticated')))},true);\n"
                              "select set_config('request.jwt.claim.role','authenticated',true);\n"
                              + s.rstrip().rstrip(";") + ";\ncommit;")
        lines = [x for x in out.splitlines() if x != ""]
        return lines[-1] if lines else ""

    def err(self, s, user=None):
        try: self.val(s, user); return None
        except RuntimeError as e: return str(e)


def has(err, *words): return bool(err) and all(w in err for w in words)


def short(e): return (e or "")[:240]


# ---------------------------------------------------------------- fixtures (tidak bergantung pada kandidat isi)
def prep(h):
    users = [(OWNER, "Owner Fiktif", "OWNER"), (ADMIN, "Admin Fiktif", "ADMIN"), (STAFF, "Staf Fiktif", "STAFF"),
             (AO, "Admin Online Fiktif", "ADMIN_ONLINE"), (AO_OFF, "Admin Online Nonaktif", "ADMIN_ONLINE"),
             (AO_TARGET, "Calon Admin Online", "STAFF"), (STAFF_SALES, "Staf Penjualan Fiktif", "STAFF")]
    h.sql("insert into auth.users(id,raw_user_meta_data) values " + ",".join(f"({q(u)},{j(dict(full_name=n))})" for u, n, _ in users) + ";")
    h.sql("".join(f"update public.profiles set role={q(r)} where id={q(u)};" for u, _, r in users)
          + f"update public.profiles set is_active=false where id={q(AO_OFF)};")
    h.sql(f"""
insert into public.branches(id,code,name,type) values ({q(BR_A)},'AOA','Petshop Fiktif A','PETSHOP'),({q(BR_B)},'AOB','Petshop Fiktif B','PETSHOP');
insert into public.user_branches(user_id,branch_id) values ({q(AO)},{q(BR_A)}),({q(AO_OFF)},{q(BR_A)}),({q(STAFF)},{q(BR_A)}),({q(AO_TARGET)},{q(BR_A)}),({q(STAFF_SALES)},{q(BR_A)});
insert into public.warehouses(id,branch_id,code,name,type,is_active) values
 ({q(WH_A)},{q(BR_A)},'AOA-ON','Online Fiktif A','ONLINE',true),({q(WH_B)},{q(BR_B)},'AOB-ON','Online Fiktif B','ONLINE',true),
 ({q(WH_A_KLINIK)},{q(BR_A)},'AOA-KL','Klinik Fiktif A','VET',true),({q(WH_A_RETAIL)},{q(BR_A)},'AOA-RT','Toko Fiktif A','RETAIL',true);
insert into public.items(id,code,name,unit,buy_price,sell_price,item_type) values
 ({q(ITEM)},'AOITEM','Barang Online Fiktif','pcs',2,10,'Persediaan'),({q(ITEM2)},'AOITEM2','Barang Kedua Fiktif','pcs',4,20,'Persediaan');
insert into public.stock(warehouse_id,item_id,qty) select w,i,100 from unnest(array[{q(WH_A)},{q(WH_B)},{q(WH_A_KLINIK)},{q(WH_A_RETAIL)}]::uuid[]) w, unnest(array[{q(ITEM)},{q(ITEM2)}]::uuid[]) i;
insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)
 select w,i,current_date - 30,100,100,3,'purchase' from unnest(array[{q(WH_A)},{q(WH_B)},{q(WH_A_KLINIK)},{q(WH_A_RETAIL)}]::uuid[]) w, unnest(array[{q(ITEM)},{q(ITEM2)}]::uuid[]) i;
insert into public.coa_accounts(code,name,type,normal_balance,is_header) values
 ('510001','Sales','PENDAPATAN','K',false),('600001','COGS','BEBAN','D',false),('312005','VAT','LIABILITAS','K',false)
 on conflict(code) do update set is_active=true,is_header=false;
update public.coa_accounts set is_active=true,is_header=false where code in ('110003','120002','130009','170001');
insert into public.customers(id,name,phone) values ({q(CUST)},'Pelanggan Fiktif','080000000001');
update public.accounting_locks set closed_until=null;
""")
    # Staf berizin Penjualan Online lewat akses khusus akun (E3) — jalur lama yang harus tetap sama.
    h.val(f"select public.save_account_access_override({q(STAFF_SALES)},'tambah',{j(dict(penjualan=None))},'Uji staf penjualan online fiktif',gen_random_uuid());", OWNER)


def apply_text(h, text):
    h.sql("begin;\n" + text + "\ncommit;")


def today(h): return h.val("select ((now() at time zone 'Asia/Jakarta')::date)::text")


def order(h, user, key, wh=WH_A, channel="Shopee", ref="__key__", extra=None, items=None, customer=""):
    header = dict(tanggal=today(h), channel=channel, warehouse_id=wh, buyer_name="Pembeli Fiktif", customer_id=customer,
                  external_ref=key if ref == "__key__" else ref)
    if ref is None: header.pop("external_ref")
    header.update(extra or {})
    items = items if items is not None else [dict(item_id=ITEM, qty=2, satuan="pcs", harga=10)]
    try:
        out = h.val(f"select public.post_online_order({q(key)},{j(header)},{j(items)});", user)
        return None, json.loads(out)
    except RuntimeError as e: return str(e), None


def digest(h):
    """Fungsi, kebijakan dan pemicu yang ADA sebelum kandidat (untuk bukti 'peran lama tidak berubah')."""
    def fx(strip):
        expr = "pg_get_functiondef(p.oid)" if not strip else "replace(pg_get_functiondef(p.oid), E'\\n  perform admin_online_private.deny_admin_online();', '')"
        out = json.loads(h.val("select coalesce(jsonb_object_agg(k, v),'{}') from (select n.nspname||'.'||p.oid::regprocedure::text k, md5(" + expr + "||coalesce(p.proacl::text,'')||p.prosecdef::text||coalesce(p.proconfig::text,'')) v "
                               "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private','role_settings_private','people_actions_private') and p.prokind='f') x"))
        return {k.replace("public.public.", "public.").replace("clinic_private.clinic_private.", "clinic_private.").replace("role_settings_private.role_settings_private.", "role_settings_private.").replace("people_actions_private.people_actions_private.", "people_actions_private."): v for k, v in out.items()}
    funcs, funcs_s = fx(False), fx(True)
    pols = json.loads(h.val("select coalesce(jsonb_object_agg(schemaname||'.'||tablename||'.'||policyname, md5(concat_ws('|',permissive,roles::text,cmd,qual,with_check))),'{}') from pg_policies"))
    trg = json.loads(h.val("select coalesce(jsonb_object_agg(c.oid::regclass::text||'.'||t.tgname, md5(pg_get_triggerdef(t.oid)||t.tgenabled::text)),'{}') from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal"))
    snaps = {r: h.val(f"select md5(role_settings_private.snapshot({q(r)})::text)") for r in ("ADMIN", "FINANCE", "STAFF", "DOCTOR")}
    rm = h.val("select coalesce(jsonb_agg(jsonb_build_array(role,module_id) order by role,module_id),'[]')::text from public.role_modules where role<>'ADMIN_ONLINE'")
    caps = h.val("select coalesce(jsonb_agg(to_jsonb(c) order by role),'[]')::text from public.role_capabilities c")
    return dict(funcs=funcs, funcs_s=funcs_s, pols=pols, trg=trg, snaps=snaps, rm=rm, caps=caps)


def behaviour(h, tag):
    """Perilaku peran lama: dicatat sebelum dan sesudah kandidat, harus sama."""
    out = {}
    e, r = order(h, OWNER, f"OWN{tag}"); out["owner_post"] = (e is None, bool(r and r.get("document_no")))
    e, r = order(h, STAFF_SALES, f"STS{tag}"); out["staff_sales_post"] = (e is None, bool(r and r.get("document_no")))
    e, _ = order(h, STAFF, f"STF{tag}"); out["staff_plain_post"] = short(e)
    e, _ = order(h, OWNER, f"WAO{tag}", channel="WA", customer=CUST); out["owner_wa"] = e is None
    out["admin_sales_visible"] = h.val("select count(*)>0 from public.sales", ADMIN)
    out["staff_branches"] = h.val("select count(*) from public.branches", STAFF)
    out["admin_items"] = h.val("select count(*) from public.items", ADMIN)
    out["owner_cost"] = short(h.err(f"select public.inventory_effective_unit_cost({q(WH_A)},{q(ITEM)})", OWNER))
    return out


# ---------------------------------------------------------------- cases
def sec_post(h):
    e, r = order(h, AO, "SHP-AO-0001")
    check("AO: simpan pesanan Shopee di gudang Online cabang sendiri", e is None and r and r.get("document_no", "").startswith("ONL-"), short(e) or r)
    if e is None:
        row = json.loads(h.val("select to_jsonb(s) from public.sales s where external_ref='SHP-AO-0001'"))
        check("AO: penjualan tercatat channel Shopee, kasir = akun ini, piutang marketplace, tanpa pelanggan",
              row["channel"] == "Shopee" and row["cashier_id"] == AO and row["marketplace_status"] == "piutang" and row["customer_id"] is None, row)
        jr = h.val("select count(*) from public.journal_entries where source_ref=" + q(r["document_no"]))
        check("AO: jurnal penjualan + HPP tercatat (jalur sama dengan peran lain)", jr == "2", jr)
        stock = h.val(f"select qty from public.stock where warehouse_id={q(WH_A)} and item_id={q(ITEM)}")
        check("AO: stok gudang Online berkurang", float(stock) < 100, stock)
    e, r = order(h, AO, "SHP-AO-RT01", wh=WH_A_RETAIL)
    check("AO: gudang Toko (RETAIL) cabang sendiri boleh (gudang utama impor E4)", e is None, short(e))
    e, _ = order(h, AO, "SHP-AO-0002", wh=WH_B)
    check("AO: gudang cabang LAIN ditolak", has(e, "ADMIN_ONLINE_GATE_BRANCH"), short(e))
    e, _ = order(h, AO, "SHP-AO-0003", wh=WH_A_KLINIK)
    check("AO: gudang Klinik ditolak", has(e, "ADMIN_ONLINE_GATE_WAREHOUSE"), short(e))
    e, _ = order(h, AO, "WA-AO-0004", channel="WA")
    check("AO: channel WA (pelanggan/poin) ditolak", has(e, "ADMIN_ONLINE_GATE_CHANNEL"), short(e))
    e, _ = order(h, AO, "SHP-AO-0005", customer=CUST)
    check("AO: menautkan pelanggan ditolak", has(e, "ADMIN_ONLINE_GATE_CUSTOMER"), short(e))
    e, _ = order(h, AO, "SHP-AO-0006", ref=None)
    check("AO: tanpa nomor pesanan ditolak", has(e, "ADMIN_ONLINE_GATE_REF"), short(e))
    e, _ = order(h, AO, "SHP-AO-0007", ref="SHP-AO-0001")
    check("AO: nomor pesanan yang sudah tercatat ditolak (tidak ganda)", has(e, "ADMIN_ONLINE_GATE_DUPLIKAT"), short(e))
    e, _ = order(h, AO, "SHP-AO-0008", extra=dict(metode_bayar="Tunai"))
    check("AO: kolom header tak dikenal ditolak", has(e, "ADMIN_ONLINE_GATE_HEADER"), short(e))
    e, _ = order(h, AO, "SHP-AO-0009", items=[dict(item_id=ITEM, qty=1, satuan="pcs", harga=10, hpp=0)])
    check("AO: kolom baris tak dikenal ditolak", has(e, "ADMIN_ONLINE_GATE_ITEMS"), short(e))
    e, _ = order(h, AO, "TKP-AO-0010", channel="Tokopedia")
    check("AO: channel Tokopedia diterima database (layar v1 hanya Shopee)", e is None, short(e))
    e, _ = order(h, AO_OFF, "SHP-AOX-0011")
    check("AO nonaktif: ditolak (pemeriksaan lama)", has(e, "Akses transaksi ditolak"), short(e))
    n = h.val("select count(*) from admin_online_private.permits")
    check("izin tulis per transaksi tidak bisa dibaca/ditulis akun", has(h.err("select count(*) from admin_online_private.permits", AO), "permission denied")
          and has(h.err(f"insert into admin_online_private.permits(xid,actor) values (pg_current_xact_id()::text,{q(AO)})", AO), "permission denied"), n)
    e = h.err(f"select admin_online_private.online_gate({q(WH_A)},{q(BR_A)},'{{}}'::jsonb,'[]'::jsonb)", AO)
    check("gerbang tidak bisa dipanggil langsung", has(e, "permission denied"), short(e))


def sec_write(h):
    e = h.err(f"insert into public.customers(name,phone) values ('Bocor','089999')", AO)
    check("pagar tulis: INSERT langsung ke tabel ditolak", has(e, "ADMIN_ONLINE_WRITE_DENIED"), short(e))
    e = h.err(f"update public.profiles set full_name='Ganti' where id={q(AO)}", AO)
    check("pagar tulis: ubah profil sendiri ditolak", has(e, "ADMIN_ONLINE_WRITE_DENIED"), short(e))
    e = h.err(f"delete from public.user_branches where user_id={q(AO)}", AO)
    check("pagar tulis: DELETE penugasan cabang sendiri ditolak (pagar ini atau penjaga penugasan lama) dan data utuh", bool(e) and ("ADMIN_ONLINE_WRITE_DENIED" in e or "PEOPLE_ACCOUNT_RPC_REQUIRED" in e)
          and h.val(f"select count(*) from public.user_branches where user_id={q(AO)}") == "1", short(e))
    e = h.err(f"select public.refresh_customer_spending({q(CUST)})", AO)
    check("pagar tulis: fungsi SECURITY DEFINER tanpa gerbang peran yang menulis ditolak", bool(e) and ("ADMIN_ONLINE" in e or "42501" in e or "ditolak" in e.lower() or "denied" in e.lower()), short(e))
    before = h.val("select count(*) from public.sales")
    e2 = h.err(f"insert into public.sales(branch_id,no_struk,total,channel) values ({q(BR_A)},'X-AO',1,'Shopee')", AO)
    check("izin tulis tidak terbawa ke transaksi lain sesudah impor", has(e2, "ADMIN_ONLINE_WRITE_DENIED") and h.val("select count(*) from public.sales") == before, short(e2))
    e = h.err("insert into public.items(code,name,unit) values ('X','X','pcs')", OWNER)
    check("peran lain: pagar tulis tidak menghalangi OWNER (RLS lama yang menentukan)", e is None or "ADMIN_ONLINE" not in e, short(e))


def sec_read(h):
    hidden = {}
    for t in ("sales", "sale_items", "items", "item_units", "stock", "stock_layers", "customers", "journal_entries", "journal_lines", "coa_accounts", "employees", "cash_accounts"):
        hidden[t] = (h.val(f"select count(*) from public.{t}", AO), h.val(f"select count(*) from public.{t}"))
    check("pagar baca: tabel bisnis tidak terbaca (0 baris) padahal berisi", all(a == "0" for a, _ in hidden.values()) and int(hidden["sales"][1]) > 0 and int(hidden["items"][1]) > 0, hidden)
    me = h.val("select count(*) from public.profiles", AO)
    check("pagar baca: profil hanya milik sendiri", me == "1", me)
    br = h.val("select count(*) from public.branches", AO); wh = h.val("select count(*) from public.warehouses", AO)
    ub = h.val("select count(*) from public.user_branches", AO)
    rmc = h.val("select count(*) from public.role_modules", AO); rcc = h.val("select count(*) from public.role_capabilities", AO)
    check("baca sesi: HANYA profil & penugasan cabang sendiri; cabang, gudang, aturan peran tertutup", br == "0" and wh == "0" and ub == "1" and rmc == "0" and rcc == "0", dict(br=br, wh=wh, ub=ub, rm=rmc, rc=rcc))
    gd = json.loads(h.val("select public.admin_online_import_gudang()", AO))
    ids = {g["id"] for g in gd}
    check("RPC gudang: hanya gudang ONLINE/RETAIL aktif di cabang akun (A), tanpa Klinik dan tanpa cabang lain", ids == {WH_A, WH_A_RETAIL}, sorted(ids))
    check("RPC gudang: hanya kolom yang dibutuhkan layar", all(set(g) == {"id", "name", "branch_id", "type", "branch_name"} for g in gd), [sorted(g) for g in gd][:1])
    for u, nm in ((STAFF, "STAFF"), (OWNER, "OWNER"), (AO_OFF, "AO nonaktif")):
        e = h.err("select public.admin_online_import_gudang()", u)
        check(f"RPC gudang: {nm} ditolak (khusus peran ini)", has(e, "ADMIN_ONLINE_ONLY"), short(e))
    e = h.err("begin; set local role anon; select public.admin_online_import_gudang(); commit;")
    check("RPC gudang: anon tanpa hak eksekusi", has(e, "permission denied"), short(e))
    st = h.err("select count(*) from storage.objects", AO)
    check("pagar baca: berkas storage tidak terbaca (tak ada hak/0 baris)", st is None and h.val("select count(*) from storage.objects", AO) == "0" or has(st, "permission denied"), short(st))
    for sig in [f"public.inventory_effective_unit_cost({q(WH_A)},{q(ITEM)})", "public.ledger_account_totals(current_date-30,current_date,null)",
                "public.pelanggan_tidak_datang(30)", f"public.pelanggan_terakhir_datang(array[{q(CUST)}]::uuid[])",
                "public.read_stock_document_effective('x',array[]::uuid[])"]:
        e = h.err(f"select {sig}", AO)
        check(f"pembaca tanpa gerbang peran ditolak: {sig.split('(')[0]}", has(e, "ADMIN_ONLINE_FUNCTION_DENIED"), short(e))
    e = h.err("select * from public.pelanggan_tidak_datang(30)", ADMIN)
    check("peran lain: pembaca yang dijaga tetap jalan untuk ADMIN", e is None or "ADMIN_ONLINE" not in e, short(e))
    v = h.val("select public.sales_module_access()::text", AO)
    check("modul Penjualan TIDAK dimiliki peran ini (penanda role_modules)", v == "false", v)
    rm = h.val("select string_agg(module_id,',') from public.role_modules where role='ADMIN_ONLINE'")
    check("penanda role_modules = admin-online-only saja", rm == "admin-online-only", rm)


def sec_catalog(h):
    e = None
    try: cat = json.loads(h.val(f"select public.admin_online_import_catalog({q(WH_A)})", AO))
    except RuntimeError as x: e, cat = str(x), {}
    txt = json.dumps(cat)
    ok = e is None and any(i["id"] == ITEM for i in cat.get("items", [])) and any(s["item_id"] == ITEM for s in cat.get("stock", []))
    check("katalog impor: barang & stok gudang terpilih terbaca", ok, short(e) or {k: len(v) for k, v in cat.items()})
    check("katalog impor: tanpa harga beli/HPP", e is None and "buy_price" not in txt and "hpp" not in txt.lower() and "unit_cost" not in txt, sorted(cat.keys()))
    e = h.err(f"select public.admin_online_import_catalog({q(WH_B)})", AO)
    check("katalog impor: gudang cabang lain ditolak", has(e, "ADMIN_ONLINE_GATE_WAREHOUSE"), short(e))
    e = h.err(f"select public.admin_online_import_catalog({q(WH_A_KLINIK)})", AO)
    check("katalog impor: gudang Klinik ditolak", has(e, "ADMIN_ONLINE_GATE_WAREHOUSE"), short(e))
    for u, nm in ((STAFF, "STAFF"), (OWNER, "OWNER"), (AO_OFF, "AO nonaktif")):
        e = h.err(f"select public.admin_online_import_catalog({q(WH_A)})", u)
        check(f"katalog impor: {nm} ditolak (khusus peran ini)", has(e, "ADMIN_ONLINE_ONLY"), short(e))
    ex = h.val("select public.admin_online_import_existing(array['SHP-AO-0001','TIDAK-ADA'])", AO)
    check("cek sudah diimpor: hanya nomor yang ditanyakan", "SHP-AO-0001" in ex and "TIDAK-ADA" not in ex and "total" not in ex, ex)
    e = h.err("select public.admin_online_import_existing(array['x'])", ADMIN)
    check("cek sudah diimpor: peran lain ditolak", has(e, "ADMIN_ONLINE_ONLY"), short(e))
    e = h.err(f"begin; set local role anon; select public.admin_online_import_catalog({q(WH_A)}); commit;")
    check("katalog impor: anon tidak punya hak eksekusi", has(e, "permission denied"), short(e))


def sec_accounts(h):
    snap = json.loads(h.val(f"select public.get_user_account_for_edit({q(AO_TARGET)})", OWNER))
    check("Pengguna: OWNER melihat Admin Online sebagai pilihan peran", "ADMIN_ONLINE" in snap.get("editable_roles", []), snap.get("editable_roles"))
    e = h.err(f"select public.edit_user_account({q(AO_TARGET)},'Calon Admin Online','ADMIN_ONLINE',array[]::uuid[],{q(snap['version'])},gen_random_uuid())", OWNER)
    check("Pengguna: Admin Online tanpa cabang ditolak", bool(e), short(e))
    e = h.err(f"select public.edit_user_account({q(AO_TARGET)},'Calon Admin Online','ADMIN_ONLINE',array[{q(BR_A)}]::uuid[],{q(snap['version'])},gen_random_uuid())", OWNER)
    role = h.val(f"select role from public.profiles where id={q(AO_TARGET)}")
    check("Pengguna: OWNER memberi peran Admin Online dengan cabang", e is None and role == "ADMIN_ONLINE", short(e) or role)
    e, _ = order(h, AO_TARGET, "SHP-AOT-0001")
    check("akun yang baru diberi peran langsung terpagar & bisa impor", e is None and h.val("select count(*) from public.items", AO_TARGET) == "0", short(e))
    e = h.err("select public.get_role_access_config('ADMIN_ONLINE')", OWNER)
    check("Akses Grup: peran ini terkunci (tidak bisa diatur menu)", bool(e), short(e))


def sec_structure(h):
    miss = h.val("""select coalesce(string_agg(c.oid::regclass::text, ',' order by 1),'') from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p') and (not exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='zz_admin_online_write_fence')
      or (c.relname not in ('profiles','user_branches') and not exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname and p.policyname='admin_online_fence_r' and p.permissive='RESTRICTIVE')))""")
    check("setiap tabel public berpagar tulis + baca (kecuali 2 tabel sesi: profil sendiri & penugasan sendiri)", miss == "", miss[:300])
    miss2 = h.val("""select coalesce(string_agg(c.oid::regclass::text, ',' order by 1),'') from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('clinic_private','role_settings_private','people_actions_private') and c.relkind in ('r','p')
      and not exists(select 1 from pg_trigger t where t.tgrelid=c.oid and t.tgname='zz_admin_online_write_fence')""")
    check("tabel privat juga berpagar tulis", miss2 == "", miss2[:300])
    ko = h.val("""select coalesce(string_agg(c.oid::regclass::text, ',' order by 1),'') from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('kamo_import','admin_online_private') and c.relkind in ('r','p','v','m')
      and (has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update') or has_table_privilege('authenticated', c.oid, 'delete'))""")
    check("tabel kamo_import/admin_online_private (tanpa pagar) tidak punya hak apa pun untuk authenticated", ko == "", ko[:300])
    vw = h.val("""select coalesce(string_agg(c.oid::regclass::text, ',' order by 1),'') from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('v','m') and not coalesce(c.reloptions::text,'') like '%security_invoker=true%'""")
    check("tidak ada view/matview public yang melewati RLS (semua security_invoker)", vw == "", vw[:300])


def sec_guard(h):
    """Penjaga massal: SETIAP fungsi SECURITY DEFINER dapat-dieksekusi authenticated menolak Admin Online (kecuali pengecualian beralasan)."""
    rows = json.loads(h.val("""select coalesce(jsonb_agg(jsonb_build_object('sig', p.oid::regprocedure::text, 'lang', l.lanname, 'guarded', p.prosrc like '%admin_online_private.deny_admin_online%',
        'pol', exists (select 1 from pg_depend d join pg_policy pol on d.classid='pg_policy'::regclass and d.objid=pol.oid where d.refclassid='pg_proc'::regclass and d.refobjid=p.oid))), '[]')
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
      where n.nspname='public' and p.prokind='f' and p.prosecdef and p.prorettype<>'trigger'::regtype and has_function_privilege('authenticated',p.oid,'execute')
        and p.proname not like 'admin\\_online\\_%'"""))
    plp = [r for r in rows if r["lang"] == "plpgsql"]
    tak = sorted(r["sig"] for r in plp if not r["guarded"] and not r["pol"] and not r["sig"].startswith("post_online_order("))
    check("setiap fungsi DEFINER plpgsql yang dapat dieksekusi authenticated berpenjaga (kecuali post_online_order & fungsi kebijakan RLS)", not tak and len(plp) > 250, dict(tanpa=tak[:8], total=len(plp)))
    e = h.err(f"select public.clinic_quote_inpatient_payment({q(ITEM)}::uuid,{q(ITEM)}::uuid,'{{}}'::jsonb)", AO)
    check("DEFINER berbahasa sql dibungkus penjaga: clinic_quote_inpatient_payment", has(e, "ADMIN_ONLINE_FUNCTION_DENIED"), short(e))
    e = h.err(f"select public.preview_clinic_refund_source({q(ITEM)}::uuid)", AO)
    check("DEFINER berbahasa sql dibungkus penjaga: preview_clinic_refund_source", has(e, "ADMIN_ONLINE_FUNCTION_DENIED"), short(e))
    # Dinamis: panggil tiap fungsi berpenjaga sebagai Admin Online dengan argumen bertipe benar; harus ditolak penjaga.
    probe = r"""create temp table zz_g(sig text, msg text); grant all on zz_g to public;
do $g$ declare f record; call text; m text; i int; ty text; a text;
begin
  for f in select p.oid, p.oid::regproc::text fn, p.pronargs, (select array_agg(t::regtype::text order by o) from unnest(p.proargtypes::oid[]) with ordinality x(t,o)) types
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.prosecdef and p.prorettype<>'trigger'::regtype and has_function_privilege('authenticated',p.oid,'execute')
      and p.prosrc like '%admin_online_private.deny_admin_online%' and p.proname not like 'admin\_online\_%' and p.proname <> 'post_online_order' loop
    a := '';
    for i in 1..f.pronargs loop ty := f.types[i];
      a := a || case when i>1 then ',' else '' end || case when ty='uuid' then '''@@ITEM@@''::uuid' when ty='uuid[]' then 'array[]::uuid[]' when ty in ('text','character varying') then '''x''::'||ty
        when ty in ('integer','bigint','smallint','numeric','double precision') then '1::'||ty when ty='boolean' then 'false' when ty='date' then 'current_date' when ty like 'timestamp%' then 'now()::'||ty
        when ty='jsonb' then '''{}''::jsonb' when ty='text[]' then 'array[]::text[]' else 'null::'||ty end;
    end loop;
    call := format('select %s(%s)', f.fn, a); m := null;
    begin set local role authenticated; execute call into m; m := 'RETURNED:' || coalesce(m, 'null'); raise exception 'rb';
    exception when others then if m is null or m not like 'RETURNED:%' then get stacked diagnostics m = message_text; end if; end;
    reset role;
    insert into zz_g values (f.oid::regprocedure::text, m);
  end loop;
end $g$;
select count(*)||'|'||count(*) filter (where msg like 'ADMIN_ONLINE_FUNCTION_DENIED%' or msg in ('RETURNED:false','RETURNED:null'))||'|'||coalesce(string_agg(sig||'='||left(msg,50), ' ; ') filter (where not (msg like 'ADMIN_ONLINE_FUNCTION_DENIED%' or msg in ('RETURNED:false','RETURNED:null'))),'') from zz_g;""".replace("@@ITEM@@", ITEM)
    out = h.val(probe, AO)
    n, den, rest = (out.split("|", 2) + ["", ""])[:3]
    check("dinamis: semua fungsi berpenjaga ditolak untuk Admin Online (galat penjaga, atau false/null bila fungsinya menelan galat) — argumen bertipe benar", n == den and int(n) > 250, dict(total=n, ditolak=den, lain=rest[:300]))
    for u, nm in ((OWNER, "OWNER"), (ADMIN, "ADMIN"), (STAFF, "STAFF")):
        e = h.err("select * from public.pelanggan_tidak_datang(30)", u)
        check(f"peran lain tidak terpengaruh penjaga: {nm} memanggil fungsi berpenjaga tanpa penolakan ADMIN_ONLINE", "ADMIN_ONLINE" not in (e or ""), short(e))
    e = h.err("select * from public.pelanggan_tidak_datang(30)")
    check("jalur sistem (tanpa auth.uid): penjaga & pagar tidak menolak", "ADMIN_ONLINE" not in (e or ""), short(e))
    e1 = h.err("select kamo_import.baca_hasil_impor(array['x'])", AO)
    check("skema kamo_import: pembaca impor menolak Admin Online (gerbang OWNER/ADMIN)", has(e1, "Hanya OWNER/ADMIN"), short(e1))


def sec_equal(h, before, after, beh_before, beh_after):
    fb, fa = before["funcs"], after["funcs"]
    changed = sorted(k for k in fb if k in fa and fb[k] != fa[k])
    gone = sorted(k for k in fb if k not in fa)
    fs = after["funcs_s"]
    jaga = sorted(k for k in changed if k not in PATCHED)
    check("fungsi lama yang berubah: tambalan berjangkar yang ditinjau + penjaga massal; tidak ada yang hilang", PATCHED <= set(changed) and not gone, dict(missing=sorted(PATCHED - set(changed)), gone=gone))
    sisa = [k for k in jaga if fs.get(k) != fb[k]]
    check("penjaga massal = tepat SATU baris tambahan: fungsi lain identik byte demi byte setelah baris itu dibuang (isi, hak akses, search_path, DEFINER)", not sisa and len(jaga) > 200, dict(menyimpang=sisa[:5], jumlah=len(jaga)))
    new = sorted(k for k in fa if k not in fb)
    check("fungsi baru hanya milik admin_online", all("admin_online" in k for k in new), new)
    pc = sorted(k for k in before["pols"] if after["pols"].get(k) != before["pols"][k])
    pn = sorted(k for k in after["pols"] if k not in before["pols"])
    check("kebijakan RLS lama tidak berubah; yang baru hanya pagar Admin Online", not pc and all(k.endswith(".admin_online_fence_r") or k.endswith(".admin_online_fence_storage") for k in pn), dict(changed=pc, new=pn[:5]))
    tc = sorted(k for k in before["trg"] if after["trg"].get(k) != before["trg"][k])
    tn = sorted(k for k in after["trg"] if k not in before["trg"])
    check("pemicu lama tidak berubah (termasuk penjaga Akses Grup menyala); yang baru hanya pagar tulis", not tc and all(k.endswith(".zz_admin_online_write_fence") for k in tn), dict(changed=tc, new=tn[:3]))
    check("snapshot Akses Grup ADMIN/FINANCE/STAFF/DOCTOR sama persis", before["snaps"] == after["snaps"], dict(before=before["snaps"], after=after["snaps"]))
    check("role_modules & role_capabilities peran lama sama persis", before["rm"] == after["rm"] and before["caps"] == after["caps"])
    check("perilaku peran lama (posting OWNER/STAFF berizin, tolak STAFF biasa, WA, baca ADMIN/STAFF) sama", beh_before == beh_after, dict(before=beh_before, after=beh_after))
    src_b, src_a = before.get("post_src"), after.get("post_src")
    diff = None
    if src_b and src_a:
        lb, la = src_b.splitlines(), src_a.splitlines()
        diff = [(x, y) for x, y in zip(lb, la) if x != y]
        check("post_online_order: hanya SATU baris berganti (gerbang)", len(lb) == len(la) and len(diff) == 1 and "online_gate" in diff[0][1], diff)


SECTIONS = [("post", sec_post), ("write", sec_write), ("read", sec_read), ("guard", sec_guard), ("catalog", sec_catalog), ("accounts", sec_accounts), ("structure", sec_structure)]


def run(h, secs=None):
    for name, fn in SECTIONS:
        if secs is None or name in secs:
            try: fn(h)
            except Exception as e: check(f"{name}: bagian berhenti", False, str(e)[:400])


MUTANTS = [
    ("M1 pagar tulis tidak menolak", "write",
     [("  raise exception 'ADMIN_ONLINE_WRITE_DENIED", "  return null; raise exception 'ADMIN_ONLINE_WRITE_DENIED", 1)]),
    ("M2 gerbang tidak memeriksa cabang", "post",
     [("or not public.user_can_access_branch(p_branch) then\n    raise exception 'ADMIN_ONLINE_GATE_BRANCH", "and false then\n    raise exception 'ADMIN_ONLINE_GATE_BRANCH", 1)]),
    ("M3 pagar baca melewatkan sales", "read",
     [("v_skip text[] := array['profiles',", "v_skip text[] := array['sales','profiles',", 1),
      ("    and c.relname not in ('profiles',", "    and c.relname not in ('sales','profiles',", 1)]),
    ("M4 penjaga pembaca selalu lolos", "read",
     [("     and not exists (select 1 from admin_online_private.permits where xid = pg_current_xact_id()::text and actor = (select auth.uid())) then\n    raise exception 'ADMIN_ONLINE_FUNCTION_DENIED",
       "     and false then\n    raise exception 'ADMIN_ONLINE_FUNCTION_DENIED", 1)]),
    ("M5 katalog tanpa pemeriksaan peran", "catalog",
     [("  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and is_active and role = 'ADMIN_ONLINE') then\n    raise exception 'ADMIN_ONLINE_ONLY: hanya untuk peran Admin Online' using errcode = '42501'; end if;\n  select * into w",
       "  select * into w", 1)]),
    ("M6 gerbang menerima WA", "post",
     [("v_ch not in ('Shopee', 'Tokopedia', 'TikTok Shop')", "v_ch not in ('Shopee', 'Tokopedia', 'TikTok Shop', 'WA')", 1)]),
    ("M7 izin tulis tidak dicatat", "post",
     [("  insert into admin_online_private.permits (xid, actor) values (pg_current_xact_id()::text, auth.uid()) on conflict do nothing;\n", "", 1)]),
    ("M8 penanda role_modules tidak dipasang", "read",
     [("insert into public.role_modules (role, module_id) values ('ADMIN_ONLINE', 'admin-online-only') on conflict do nothing;\n", "", 1),
      ("  if (select array_agg(module_id::text) from public.role_modules where role = 'ADMIN_ONLINE') is distinct from array['admin-online-only'] then\n    raise exception 'ADMIN_ONLINE_CHECK: penanda role_modules tidak tepat'; end if;\n", "", 1)]),
    ("M9 pelanggan boleh ditautkan", "post",
     [("  if nullif(p_header ->> 'customer_id', '') is not null then", "  if false then", 1)]),
    ("M10 nomor ganda boleh", "post",
     [("  if exists (select 1 from public.sales where channel = v_ch and external_ref = v_ref and voided_at is null) then", "  if false then", 1)]),
    ("M11 profil semua orang terbaca", "read",
     [("    and c.relname not in ('profiles','user_branches');", "    and c.relname not in ('profiles','user_branches','items');", 1),
      ("v_skip text[] := array['profiles',", "v_skip text[] := array['items','profiles',", 1)]),
    ("M12 akun tanpa cabang diterima", "accounts",
     [("'if p_role in(''STAFF'',''DOCTOR'',''ADMIN_ONLINE'') and cardinality(new_ids)=0'", "'if p_role in(''STAFF'',''DOCTOR'') and cardinality(new_ids)=0'", 1)]),
    ("M13 penjaga massal tidak berjalan", "guard,read",
     [("    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and l.lanname = 'plpgsql' and p.prorettype <> 'trigger'::regtype\n", "    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and l.lanname = 'plpgsql' and p.prorettype <> 'trigger'::regtype and false\n", 1)]),
    ("M14 satu pembaca dikecualikan dari penjaga massal", "guard,read",
     [("      and p.proname <> 'post_online_order' and p.proname not like 'admin\\_online\\_%'\n", "      and p.proname <> 'post_online_order' and p.proname not like 'admin\\_online\\_%' and p.proname <> 'ledger_account_totals'\n", 1)]),
    ("M15 RPC gudang tidak menyaring cabang akun", "read",
     [("w.type in ('ONLINE', 'RETAIL') and public.user_can_access_branch(w.branch_id));", "w.type in ('ONLINE', 'RETAIL'));", 1)]),
    ("M16 RPC gudang menyertakan gudang Klinik", "read",
     [("w.type in ('ONLINE', 'RETAIL') and public.user_can_access_branch(w.branch_id));", "w.type in ('ONLINE', 'RETAIL', 'VET') and public.user_can_access_branch(w.branch_id));", 1)]),
    ("M18 pembungkus sql tidak menjaga clinic_quote_inpatient_payment", "guard",
     [("select case when admin_online_private.deny_admin_online() then clinic_private.inpatient_payment_quote", "select case when true then clinic_private.inpatient_payment_quote", 1)]),
    ("M19 penjaga Akses Grup tidak dinyalakan lagi", "read",
     [("alter table public.role_modules enable trigger role_settings_atomic_guard;\n", "", 1)]),
    ("M20 penjaga fungsi tidak mengenali peran", "guard,read",
     [("  if exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'ADMIN_ONLINE')\n     and not exists", "  if false\n     and not exists", 1)]),
]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--json", type=Path); ap.add_argument("--pg-bin", default=os.environ.get("PG_BIN", "/usr/lib/postgresql/16/bin"))
    ap.add_argument("--baseline", action="store_true"); ap.add_argument("--mutations", action="store_true"); ap.add_argument("--sections")
    ap.add_argument("--dev-template", help=argparse.SUPPRESS)  # pengembangan: klon database rantai (tanpa kandidat) di cluster yang sudah hidup
    a = ap.parse_args()
    secs = set(a.sections.split(",")) if a.sections else None
    extra = {}
    cand = CANDIDATE.read_text()
    try:
        with (DevDb(a.dev_template) if a.dev_template else NativePostgres(a.pg_bin)) as db:
            if not a.dev_template: fixture.DisposablePostgres.bootstrap(_HoldBack(db))
            h = H(db)
            apply_text(h, ENUM.read_text())  # nilai enum: berkas terpisah, ter-commit sebelum isi
            prep(h)
            if a.mutations:
                extra["mutants"] = {}
                plan = [("M0 kontrol (kandidat utuh)", cand, None)]
                for name, sec, pairs in MUTANTS:
                    text, ok = cand, True
                    for old, new, n in pairs:
                        if text.count(old) != n: check(name + " jangkar", False, dict(count=text.count(old), anchor=old[:80])); ok = False; break
                        text = text.replace(old, new)
                    if ok: plan.append((name, text, set(sec.split(","))))
                for i, (name, text, s) in enumerate(plan):
                    os.environ.pop("PGDATABASE", None); db.sql(f"create database aom{os.getpid()}_{i} template {getattr(db, 'name', 'postgres')}"); os.environ["PGDATABASE"] = f"aom{os.getpid()}_{i}"
                    before = len(RESULTS); crash = None
                    try: apply_text(h, text); run(h, s)
                    except Exception as e: crash = "battery aborted: " + str(e).strip().splitlines()[0][:200]
                    fails = [c["case"] for c in RESULTS[before:] if c["status"] == "FAIL"]
                    del RESULTS[before:]; os.environ.pop("PGDATABASE", None)
                    if i == 0: check(name + " 0 FAIL", not fails and not crash, (fails + [crash or ""])[:3])
                    else:
                        extra["mutants"][name] = dict(killed=bool(fails or crash), failing=fails[:3], crash=crash)
                        check(name + " MATI", bool(fails or crash), fails[:3] or [crash])
            else:
                post_sig = "'public.post_online_order(text,jsonb,jsonb)'::regprocedure"
                d0 = digest(h); d0["post_src"] = h.sql(f"select prosrc from pg_proc where oid={post_sig}")
                b0 = behaviour(h, "A")
                if not a.baseline:
                    apply_text(h, cand)
                    v1 = h.val(f"select md5(pg_get_functiondef({post_sig}))")
                    err = h.err("begin;\n" + cand + "\ncommit;")
                    check("menerapkan ulang migrasi gagal bersih (jangkar sudah berganti), definisi tidak berubah",
                          bool(err) and h.val(f"select md5(pg_get_functiondef({post_sig}))") == v1, short(err))
                    d1 = digest(h); d1["post_src"] = h.sql(f"select prosrc from pg_proc where oid={post_sig}")
                    # Perilaku peran lama sesudah kandidat (kunci beda, nomor pesanan beda).
                    b1 = behaviour(h, "B")
                    sec_equal(h, d0, d1, b0, b1)
                run(h, secs)
    except Exception as e:
        check("HARNESS", False, str(e)[:800])
    totals = {s: sum(c["status"] == s for c in RESULTS) for s in ["PASS", "FAIL"]}
    if a.json: a.json.write_text(json.dumps(dict(mode="mutations" if a.mutations else "RED" if a.baseline else "GREEN", cases=RESULTS, totals=totals, **extra), indent=2, default=str))
    print(totals)
    return 0 if a.baseline else int(totals["FAIL"] > 0)


if __name__ == "__main__":
    sys.exit(main())
