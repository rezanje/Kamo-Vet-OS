#!/usr/bin/env python3
"""E3 (meeting 12 Nov 2026): akses khusus per akun (migrasi 20261114074354_e3_akses_khusus_akun.sql).

Owner-only save/clear with validation, request key and append-only history; get_my_access_override is self-only;
the Activity Log sees every change; and the STAFF "Penjualan Online" database path (post_online_order, listing,
cair satu order, cair sekaligus, hasil posting, lampiran) works for an account Owner granted Penjualan — and ONLY
for that account, only in its branches, and without touching role action policies.

Native full schema (every repository migration), fictional fixtures, throwaway local cluster, no network.
  python3 -I scripts/test-akses-khusus-akun-postgres.py [--pg-bin DIR] [--json out.json]
  --baseline    chain WITHOUT the candidate: feature cases must FAIL (RED); old-behaviour cases PASS
  --mutations   fixtures once, then each mutant of the candidate in a cloned database; every mutant must be killed
"""
import argparse, importlib.util, json, os, sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
CANDIDATE = ROOT / "supabase/migrations/20261114074354_e3_akses_khusus_akun.sql"
RESULTS = []

U = lambda n: f"e3000000-0000-4000-8000-{n:012d}"
OWNER, OWNER_OFF, ADMIN, FINANCE, STAFF_ON, STAFF_LAIN, STAFF_HAPUS, DOCTOR = (U(i) for i in range(1, 9))
BR_A, BR_B = U(101), U(102)
WH_A, WH_B = U(201), U(202)
ITEM = U(301)
BANK_A = U(401)


def q(v): return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def j(v): return q(json.dumps(v)) + "::jsonb"


def check(name, ok, detail=None):
    RESULTS.append(dict(case=name, status="PASS" if ok else "FAIL", detail=detail))
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

    def val(self, s, user=None):
        """One value; as `user` (authenticated JWT) when given. Raises RuntimeError with the database message."""
        if user is None: out = self.db.sql(s)
        else:
            out = self.db.sql("begin;\nset local role authenticated;\n"
                              f"select set_config('request.jwt.claim.sub',{q(user)},true);\n"
                              f"select set_config('request.jwt.claims',{q(json.dumps(dict(sub=user, role='authenticated')))},true);\n"
                              "select set_config('request.jwt.claim.role','authenticated',true);\n"
                              + s + "\ncommit;")
        lines = [x for x in out.splitlines() if x != ""]
        return lines[-1] if lines else ""

    def err(self, s, user=None):
        try: self.val(s, user); return None
        except RuntimeError as e: return str(e)


def has(err, *words): return bool(err) and all(w in err for w in words)


def short(e): return (e or "")[:240]


# ---------------------------------------------------------------- fixtures (do not depend on the candidate)
def prep(h):
    users = [(OWNER, "Owner Fiktif", "OWNER"), (OWNER_OFF, "Owner Nonaktif Fiktif", "OWNER"), (ADMIN, "Admin Fiktif", "ADMIN"),
             (FINANCE, "Finance Fiktif", "FINANCE"), (STAFF_ON, "Staf Online Fiktif", "STAFF"), (STAFF_LAIN, "Staf Klinik Fiktif", "STAFF"),
             (STAFF_HAPUS, "Staf Dihapus Fiktif", "STAFF"), (DOCTOR, "Dokter Fiktif", "DOCTOR")]
    h.sql("insert into auth.users(id,raw_user_meta_data) values " + ",".join(f"({q(u)},{j(dict(full_name=n))})" for u, n, _ in users) + ";")
    h.sql("".join(f"update public.profiles set role={q(r)} where id={q(u)};" for u, _, r in users)
          + f"update public.profiles set is_active=false where id={q(OWNER_OFF)};")
    h.sql(f"""
insert into public.branches(id,code,name,type) values ({q(BR_A)},'E3A','Petshop Fiktif A','PETSHOP'),({q(BR_B)},'E3B','Petshop Fiktif B','PETSHOP');
insert into public.user_branches(user_id,branch_id) values ({q(STAFF_ON)},{q(BR_A)}),({q(STAFF_LAIN)},{q(BR_A)}),({q(STAFF_HAPUS)},{q(BR_A)});
insert into public.warehouses(id,branch_id,code,name,type,is_active) values
 ({q(WH_A)},{q(BR_A)},'E3A-ON','Online Fiktif A','ONLINE',true),({q(WH_B)},{q(BR_B)},'E3B-ON','Online Fiktif B','ONLINE',true);
insert into public.items(id,code,name,unit,buy_price,sell_price,item_type) values ({q(ITEM)},'E3ITEM','Barang Online Fiktif','pcs',2,10,'Persediaan');
insert into public.stock(warehouse_id,item_id,qty) values ({q(WH_A)},{q(ITEM)},100),({q(WH_B)},{q(ITEM)},100);
insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values
 ({q(WH_A)},{q(ITEM)},current_date - 30,100,100,3,'purchase'),({q(WH_B)},{q(ITEM)},current_date - 30,100,100,3,'purchase');
insert into public.coa_accounts(code,name,type,normal_balance,is_header) values
 ('510001','Sales','PENDAPATAN','K',false),('600001','COGS','BEBAN','D',false),('312005','VAT','LIABILITAS','K',false),('740020','Komisi','BEBAN','D',false),('120099','Bank Fiktif A','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
update public.coa_accounts set is_active=true,is_header=false where code in ('110003','120002','130009','170001');
insert into public.cash_accounts(id,nama,jenis,coa_code,branch_id,is_active) values ({q(BANK_A)},'Bank Fiktif A','Bank','120099',{q(BR_A)},true);
update public.accounting_locks set closed_until=null;
""")


def apply_candidate(h, text=None):
    h.sql("begin;\n" + (text if text is not None else CANDIDATE.read_text()) + "\ncommit;")


# ---------------------------------------------------------------- helpers
def save(h, user, profile, mode, modules=None, reason=None, key=None):
    """-> (error, result dict)"""
    try:
        out = h.val(f"select public.save_account_access_override({q(profile)},{q(mode)},{j(modules) if modules is not None else 'null'},{q(reason)},{q(key)}::uuid);", user)
        return None, json.loads(out)
    except RuntimeError as e: return str(e), None


def mine(h, user):
    try: return h.val("select coalesce(public.get_my_access_override()::text,'NULL');", user)
    except RuntimeError as e: return "ERR " + short(str(e))


def row(h, profile): return h.val(f"select coalesce((select jsonb_build_object('mode',mode,'modules',modules) from role_settings_private.account_access_overrides where profile_id={q(profile)})::text,'NULL')")


def hist(h, profile):
    return json.loads(h.val(f"select coalesce(jsonb_agg(jsonb_build_object('by',created_by,'role',target_role,'reason',reason,'before',before,'after',after) order by created_at,id),'[]') from role_settings_private.account_access_override_history where profile_id={q(profile)}"))


def k(n): return f"e3e3e3e3-0000-4000-8000-{n:012d}"


def order(h, user, key, wh=WH_A, qty=2):
    today = h.val("select ((now() at time zone 'Asia/Jakarta')::date)::text")
    try:
        out = h.val(f"select public.post_online_order({q(key)},{j(dict(tanggal=today, channel='Shopee', warehouse_id=wh, external_ref=key))},{j([dict(item_id=ITEM, qty=qty, satuan='pcs', harga=10)])});", user)
        return None, json.loads(out)
    except RuntimeError as e: return str(e), None


DENIED_SALES = "Dokumen penjualan tidak ditemukan atau tidak dapat diakses"


# ---------------------------------------------------------------- sections
def sec_baseline_behaviour(h):
    """Behaviour that is true with or without the candidate (old rules unchanged)."""
    err, _ = order(h, STAFF_LAIN, "e3-old-staff")
    check("perilaku lama: STAFF tanpa modul Penjualan di peran DITOLAK menyimpan order online (gerbang modul peran)", has(err, DENIED_SALES), short(err))
    err, res = order(h, OWNER, "e3-old-owner")
    check("perilaku lama: OWNER menyimpan order online", err is None and res and res.get("document_id"), short(err))
    err, res = order(h, ADMIN, "e3-old-admin")
    check("perilaku lama: ADMIN bawaan (semua modul, semua cabang) menyimpan order online", err is None and res and res.get("document_id"), short(err))


def sec_preflight(h):
    o = json.loads(h.val("""select jsonb_build_object(
 'tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='role_settings_private'
   and c.relname in ('account_access_overrides','account_access_override_history','account_access_requests','account_access_permits')),
 'auth_reads_table',has_table_privilege('authenticated','role_settings_private.account_access_overrides','SELECT'),
 'svc_writes_table',has_table_privilege('service_role','role_settings_private.account_access_overrides','INSERT'),
 'my',has_function_privilege('authenticated','public.get_my_access_override()','EXECUTE'),
 'get',has_function_privilege('authenticated','public.get_account_access_override(uuid)','EXECUTE'),
 'save',has_function_privilege('authenticated','public.save_account_access_override(uuid,text,jsonb,text,uuid)','EXECUTE'),
 'anon_save',has_function_privilege('anon','public.save_account_access_override(uuid,text,jsonb,text,uuid)','EXECUTE'),
 'anon_my',has_function_privilege('anon','public.get_my_access_override()','EXECUTE'),
 'normalize_auth',has_function_privilege('authenticated','role_settings_private.account_access_normalize(jsonb)','EXECUTE'),
 'activity',exists(select 1 from public.activity_log_sources where entity='account_access_overrides' and module_id='pengaturan' and metadata_only))"""))
    check("preflight: 4 tabel privat, tidak terbaca/tertulis klien; 3 RPC hanya untuk authenticated (bukan anon); sumber Log Aktifitas terdaftar",
          o == dict(tables=4, auth_reads_table=False, svc_writes_table=False, my=True, get=True, save=True, anon_save=False, anon_my=False, normalize_auth=False, activity=True), o)
    err = h.err("select count(*) from role_settings_private.account_access_overrides;", STAFF_ON)
    check("klien tidak bisa membaca tabel akses khusus langsung (permission denied)", has(err, "permission denied"), short(err))


def sec_owner_only(h):
    mods = {"penjualan": ["penjualan.online"]}
    for user, name in ((ADMIN, "ADMIN"), (FINANCE, "FINANCE"), (STAFF_ON, "STAFF (akunnya sendiri)"), (DOCTOR, "DOCTOR"), (OWNER_OFF, "OWNER nonaktif")):
        err, _ = save(h, user, STAFF_ON, "khusus", mods, "coba")
        check(f"{name} menyimpan akses khusus: DITOLAK ACCOUNT_ACCESS_OWNER_REQUIRED, tidak ada baris/riwayat",
              has(err, "ACCOUNT_ACCESS_OWNER_REQUIRED") and row(h, STAFF_ON) == "NULL" and hist(h, STAFF_ON) == [], short(err))
    err = h.err(f"select public.get_account_access_override({q(STAFF_ON)});", ADMIN)
    check("ADMIN membaca akses khusus akun lain: DITOLAK (Owner saja)", has(err, "ACCOUNT_ACCESS_OWNER_REQUIRED"), short(err))
    for target, name in ((OWNER, "OWNER sendiri"), (OWNER_OFF, "OWNER lain (nonaktif)")):
        err, _ = save(h, OWNER, target, "khusus", mods)
        check(f"target {name}: DITOLAK ACCOUNT_ACCESS_TARGET_OWNER (OWNER selalu penuh)", has(err, "ACCOUNT_ACCESS_TARGET_OWNER") and row(h, target) == "NULL", short(err))
    err, _ = save(h, OWNER, U(999), "khusus", mods)
    check("target tidak ada: DITOLAK ACCOUNT_ACCESS_TARGET_INVALID", has(err, "ACCOUNT_ACCESS_TARGET_INVALID"), short(err))
    # tulis langsung tanpa RPC (definer lain / DBA dengan klaim API): penjaga menolak
    err = h.err(f"begin; select set_config('request.jwt.claim.role','service_role',true); insert into role_settings_private.account_access_overrides(profile_id,mode,modules,updated_by) values ({q(STAFF_ON)},'khusus','{{\"crm\":null}}',{q(OWNER)}); commit;")
    check("tulis langsung ke tabel (klaim API, bukan DBA native): DITOLAK penjaga ACCOUNT_ACCESS_GUARD", has(err, "ACCOUNT_ACCESS_GUARD") and row(h, STAFF_ON) == "NULL", short(err))


def sec_validation(h):
    bad = [
        ("menu tidak dikenal", "khusus", {"gudang-rahasia": None}),
        ("sub-menu tidak dikenal", "khusus", {"penjualan": ["penjualan.tidak-ada"]}),
        ("sub-menu milik modul lain", "khusus", {"penjualan": ["crm.promo"]}),
        ("modul dicentang tanpa sub-menu", "tambah", {"penjualan": []}),
        ("sub-menu ganda", "khusus", {"penjualan": ["penjualan.online", "penjualan.online"]}),
        ("daftar kosong", "khusus", {}),
        ("modul tanpa sub-menu diberi daftar", "khusus", {"dashboard": ["dashboard.x"]}),
        ("bukan objek", "khusus", ["penjualan"]),
        ("isi sub-menu bukan teks", "khusus", {"penjualan": [1]}),
    ]
    for name, mode, mods in bad:
        err, _ = save(h, OWNER, STAFF_ON, mode, mods)
        check(f"validasi: {name} DITOLAK ACCOUNT_ACCESS_MODULES_INVALID", has(err, "ACCOUNT_ACCESS_MODULES_INVALID") and row(h, STAFF_ON) == "NULL", short(err))
    err, _ = save(h, OWNER, STAFF_ON, "khusus", None)
    check("validasi: mode khusus tanpa daftar menu DITOLAK", has(err, "ACCOUNT_ACCESS_MODULES_INVALID"), short(err))
    err, _ = save(h, OWNER, STAFF_ON, "semua", {"crm": None})
    check("validasi: mode tidak dikenal DITOLAK ACCOUNT_ACCESS_MODE_INVALID", has(err, "ACCOUNT_ACCESS_MODE_INVALID"), short(err))
    err, _ = save(h, OWNER, STAFF_ON, "ikuti", {"crm": None})
    check("validasi: 'Ikuti peran' dengan daftar menu DITOLAK", has(err, "ACCOUNT_ACCESS_MODULES_INVALID"), short(err))
    err, _ = save(h, OWNER, STAFF_ON, "khusus", {"crm": None}, "x" * 1001)
    check("validasi: alasan > 1000 huruf DITOLAK", has(err, "ACCOUNT_ACCESS_REASON_INVALID") and hist(h, STAFF_ON) == [], short(err))


def sec_save_history(h):
    klinik_all = json.loads(h.val("select jsonb_agg(id order by id) from role_settings_private.submenu_catalog where module_id='klinik'"))
    err, res = save(h, OWNER, STAFF_LAIN, "tambah", {"klinik": klinik_all, "penjualan": ["penjualan.rekap", "penjualan.online"], "kasir": None}, "  uji normalisasi  ")
    stored = json.loads(row(h, STAFF_LAIN)) if err is None else None
    check("normalisasi: semua sub-menu dicentang disimpan sebagai seluruh modul (null); sub-menu diurutkan; alasan dirapikan",
          err is None and stored == dict(mode="tambah", modules=dict(klinik=None, kasir=None, penjualan=["penjualan.online", "penjualan.rekap"]))
          and hist(h, STAFF_LAIN)[-1]["reason"] == "uji normalisasi", dict(err=short(err), stored=stored))
    err, res = save(h, OWNER, STAFF_LAIN, "ikuti", None, None, None)
    check("'Ikuti peran' menghapus akses khusus; riwayat mencatat sesudah = null", err is None and res["changed"] and row(h, STAFF_LAIN) == "NULL"
          and hist(h, STAFF_LAIN)[-1]["after"] is None and hist(h, STAFF_LAIN)[-1]["before"]["mode"] == "tambah", short(err))

    mods = {"penjualan": ["penjualan.online"]}
    err, res = save(h, OWNER, STAFF_ON, "khusus", mods, "Staf online hanya Penjualan Online", k(1))
    hs = hist(h, STAFF_ON)
    check("OWNER menyimpan 'Hanya akses khusus' Penjualan Online untuk STAFF: berhasil + riwayat (pelaku, peran akun, alasan, sebelum null, sesudah)",
          err is None and res["changed"] and res["already_applied"] is False and json.loads(row(h, STAFF_ON)) == dict(mode="khusus", modules=mods)
          and len(hs) == 1 and hs[0]["by"] == OWNER and hs[0]["role"] == "STAFF" and hs[0]["before"] is None
          and hs[0]["after"] == dict(mode="khusus", modules=mods) and hs[0]["reason"] == "Staf online hanya Penjualan Online", dict(err=short(err), hist=hs))
    err, res = save(h, OWNER, STAFF_ON, "khusus", mods, "Staf online hanya Penjualan Online", k(1))
    check("kunci permintaan sama + isi sama: hasil lama (already_applied), tidak ada riwayat ganda",
          err is None and res["already_applied"] is True and len(hist(h, STAFF_ON)) == 1, short(err))
    err, _ = save(h, OWNER, STAFF_ON, "tambah", mods, "lain", k(1))
    check("kunci permintaan sama + isi berbeda: DITOLAK ACCOUNT_ACCESS_REQUEST_KEY_REUSED, tidak berubah",
          has(err, "ACCOUNT_ACCESS_REQUEST_KEY_REUSED") and json.loads(row(h, STAFF_ON))["mode"] == "khusus", short(err))
    err, res = save(h, OWNER, STAFF_ON, "khusus", mods, None, k(2))
    check("simpan tanpa perubahan isi: changed=false, tidak ada riwayat baru", err is None and res["changed"] is False and len(hist(h, STAFF_ON)) == 1, short(err))
    err = h.err("update role_settings_private.account_access_override_history set reason='diubah';")
    check("riwayat append-only: UPDATE ditolak (juga untuk DBA)", has(err, "ROLE_AUDIT_IMMUTABLE"), short(err))
    err = h.err("delete from role_settings_private.account_access_override_history;")
    check("riwayat append-only: DELETE ditolak", has(err, "ROLE_AUDIT_IMMUTABLE"), short(err))
    out = json.loads(h.val(f"select public.get_account_access_override({q(STAFF_ON)});", OWNER))
    check("OWNER membaca akses khusus akun: mode/menu, pelaku terakhir (nama), riwayat terbaru dulu",
          out["role"] == "STAFF" and out["override"]["mode"] == "khusus" and out["override"]["modules"] == mods
          and out["override"]["updated_by_name"] == "Owner Fiktif" and out["history"][0]["created_by_name"] == "Owner Fiktif" and len(out["history"]) == 1,
          dict(o=out.get("override"), n=len(out.get("history", []))))
    acts = json.loads(h.val(f"select coalesce(jsonb_agg(jsonb_build_object('a',action,'by',actor_id,'m',module_id) order by id),'[]') from public.activity_log where row_entity='account_access_overrides' and row_id={q(STAFF_ON)}"))
    check("Log Aktifitas: perubahan akses khusus tercatat (Dibuat oleh Owner, modul Pengaturan)", acts == [dict(a="create", by=OWNER, m="pengaturan")], acts)
    acts2 = json.loads(h.val(f"select coalesce(jsonb_agg(action order by id),'[]') from public.activity_log where row_entity='account_access_overrides' and row_id={q(STAFF_LAIN)}"))
    check("Log Aktifitas: dibuat lalu dihapus ('Ikuti peran') juga tercatat", acts2 == ["create", "delete"], acts2)


ONLINE_MODS = {"penjualan": ["penjualan.online"]}


def pastikan_online(h):
    """Setiap bagian berdiri sendiri (mutan menjalankan satu bagian saja): STAFF_ON = 'Hanya akses khusus' Penjualan Online."""
    err, _ = save(h, OWNER, STAFF_ON, "khusus", ONLINE_MODS, "Staf online hanya Penjualan Online")
    if err: raise RuntimeError("penyiapan akses khusus gagal: " + short(err))


def sec_self_only(h):
    pastikan_online(h)
    m = mine(h, STAFF_ON)
    check("get_my_access_override: STAFF dengan akses khusus membaca miliknya", m != "NULL" and not m.startswith("ERR") and json.loads(m)["mode"] == "khusus", m)
    for user, name in ((STAFF_LAIN, "STAFF lain"), (ADMIN, "ADMIN"), (OWNER, "OWNER")):
        m2 = mine(h, user)
        check(f"get_my_access_override: {name} tidak melihat akses khusus akun lain (null)", m2 == "NULL", m2)
    err = h.err(f"select public.get_my_access_override({q(STAFF_ON)});", STAFF_LAIN)
    check("get_my_access_override tidak menerima id akun lain (tidak ada parameter)", bool(err), short(err))
    h.sql(f"update public.profiles set is_active=false where id={q(STAFF_ON)};")
    m3 = mine(h, STAFF_ON)
    h.sql(f"update public.profiles set is_active=true where id={q(STAFF_ON)};")
    check("akun nonaktif: get_my_access_override null (akses khusus tidak berlaku)", m3 == "NULL", m3)


def sec_online_flow(h):
    """STAFF Penjualan Online, database path used by /penjualan/online, /baru, /impor and cair."""
    pastikan_online(h)
    pol_before = h.val("select public.role_action_allowed('penjualan.pos_penerimaan.batalkan')::text;", STAFF_LAIN)
    err, res = order(h, STAFF_ON, "e3-on-1")
    check("STAFF akses khusus Penjualan Online: post_online_order (simpan order / impor Shopee) BERHASIL di gudang online cabangnya",
          err is None and res and res.get("document_id"), short(err))
    sale1 = res["document_id"] if res else None
    err, res2 = order(h, STAFF_ON, "e3-on-2")
    sale2 = res2["document_id"] if res2 else None
    err2, _ = order(h, STAFF_LAIN, "e3-lain-1")
    check("STAFF lain (tanpa akses khusus, cabang sama) tetap DITOLAK: tidak ada pelebaran untuk peran", has(err2, DENIED_SALES), short(err2))
    err3, _ = order(h, STAFF_ON, "e3-on-b", wh=WH_B)
    check("STAFF akses khusus di gudang cabang lain (tanpa akses cabang): DITOLAK, akses cabang tetap wajib", has(err3, "Akses transaksi ditolak"), short(err3))
    err4, resb = order(h, OWNER, "e3-owner-b", wh=WH_B)
    seen = json.loads(h.val("select coalesce(jsonb_agg(branch_id),'[]') from (select distinct branch_id from public.sales where channel is not null and voided_at is null) s;", STAFF_ON))
    check("daftar Penjualan Online: STAFF melihat order cabangnya, bukan cabang lain", BR_A in seen and BR_B not in seen and err4 is None, seen)
    reads = h.val(f"""select jsonb_build_object(
 'items',(select count(*) from public.items where id={q(ITEM)}),
 'gudang',(select count(*) from public.warehouses where id={q(WH_A)}),
 'stok',(select count(*) from public.stock where warehouse_id={q(WH_A)}),
 'rekening',(select count(*) from public.cash_accounts where id={q(BANK_A)}),
 'tutup_buku',(select count(*) from public.accounting_locks),
 'satuan',(select count(*) >= 0 from public.item_units))::text;""", STAFF_ON)
    r = json.loads(reads)
    check("bacaan halaman (barang, gudang online, stok, rekening bank, tutup buku, satuan): terbaca oleh STAFF",
          r["items"] == 1 and r["gudang"] == 1 and r["stok"] == 1 and r["rekening"] == 1 and r["tutup_buku"] >= 1 and r["satuan"] is True, r)
    got = h.err(f"select public.get_unit_posting_result('online','e3-on-1');", STAFF_ON)
    check("get_unit_posting_result (pulihkan hasil simpan): berhasil untuk STAFF", got is None, short(got))
    err = h.err(f"insert into public.document_attachments(modul,ref_id,path,nama,uploaded_by) values ('penjualan',{q(sale1)},'penjualan-online/e3.png','bukti.png',{q(STAFF_ON)});", STAFF_ON)
    check("lampiran bukti order: tercatat oleh STAFF", err is None, short(err))
    # tandaiCair (satu order): UPDATE sales + jurnal lewat klien (postJournal)
    err = h.err(f"""update public.sales set marketplace_status='cair',komisi=1,disbursed_at=now() where id={q(sale1)} and marketplace_status='piutang' and voided_at is null;
insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values ({q(U(901))},'JRN-E3-0001',current_date,'Pencairan fiktif','sale-online-cair','E3',{q(BR_A)});
insert into public.journal_lines(entry_id,account_id,debit,credit) select {q(U(901))},id,case code when '120002' then 19 when '740020' then 1 else 0 end,case when code='130009' then 20 else 0 end from public.coa_accounts where code in ('120002','740020','130009');""", STAFF_ON)
    st = h.val(f"select marketplace_status from public.sales where id={q(sale1)}")
    check("cair satu order (tandaiCair): STAFF mengubah status order + mencatat jurnal pencairan", err is None and st == "cair", dict(err=short(err), st=st))
    err = h.err(f"select public.online_disburse_batch({q('e3-cair-1')},array[{q(sale2)}]::uuid[],18,current_date,{q(BANK_A)}::uuid);", STAFF_ON)
    st2 = h.val(f"select marketplace_status from public.sales where id={q(sale2)}")
    check("cair sekaligus (online_disburse_batch): BERHASIL untuk STAFF akses khusus", err is None and st2 == "cair", dict(err=short(err), st=st2))
    pol_after = h.val("select public.role_action_allowed('penjualan.pos_penerimaan.batalkan')::text;", STAFF_ON)
    check("tindakan bisnis tetap per peran: role_action_allowed STAFF akses khusus = STAFF biasa", pol_after == pol_before, dict(before=pol_before, after=pol_after))
    # Mode tambah juga memberi modul Penjualan; mode khusus TANPA Penjualan tidak
    save(h, OWNER, STAFF_LAIN, "tambah", {"penjualan": ["penjualan.online"]})
    err, _ = order(h, STAFF_LAIN, "e3-tambah-1")
    check("mode 'Peran + tambahan' Penjualan Online: STAFF bisa menyimpan order online", err is None, short(err))
    save(h, OWNER, STAFF_LAIN, "khusus", {"crm": None})
    err, _ = order(h, STAFF_LAIN, "e3-khusus-crm")
    check("mode 'Hanya akses khusus' TANPA Penjualan: tetap DITOLAK", has(err, DENIED_SALES), short(err))
    save(h, OWNER, STAFF_LAIN, "ikuti")
    h.sql(f"update public.profiles set role='OWNER' where id={q(STAFF_ON)};")
    m_owner = mine(h, STAFF_ON)
    h.sql(f"update public.profiles set role='STAFF' where id={q(STAFF_ON)};")
    check("akun yang kemudian dijadikan OWNER: akses khusus tidak berlaku (null)", m_owner == "NULL", m_owner)
    save(h, OWNER, STAFF_ON, "ikuti", None, "Kembali ke peran")
    err, _ = order(h, STAFF_ON, "e3-on-after")
    check("setelah 'Ikuti peran': STAFF itu DITOLAK lagi (akses kembali ke peran)", has(err, DENIED_SALES), short(err))


def sec_cascade(h):
    save(h, OWNER, STAFF_HAPUS, "khusus", {"penjualan": None}, "akan dihapus")
    n_hist = len(hist(h, STAFF_HAPUS))
    # Produksi: akun dihapus lewat layanan Auth (bukan superuser), jadi jalan pintas DBA penjaga TIDAK berlaku.
    # Ditiru dengan klaim peran API terisi (auth.role() tidak null) supaya penjaga benar-benar diuji.
    err = h.err(f"begin; select set_config('request.jwt.claim.role','service_role',true); delete from auth.users where id={q(STAFF_HAPUS)}; commit;")
    left = h.val(f"select count(*) from role_settings_private.account_access_overrides where profile_id={q(STAFF_HAPUS)}")
    check("akun dihapus: baris akses khusus ikut terhapus (cascade lolos penjaga), riwayat tetap",
          err is None and left == "0" and n_hist == 1 and len(hist(h, STAFF_HAPUS)) == 1, dict(err=short(err), left=left))


def run(h, secs=None):
    for name, fn in (("preflight", sec_preflight), ("owner", sec_owner_only), ("validation", sec_validation), ("history", sec_save_history),
                     ("self", sec_self_only), ("online", sec_online_flow), ("cascade", sec_cascade)):
        if secs is not None and name not in secs: continue
        try: fn(h)
        except Exception as e:  # satu bagian berhenti (mis. --baseline: objek belum ada) = FAIL, bagian lain tetap jalan
            check(f"bagian {name} berhenti", False, str(e).strip().splitlines()[0][:200] if str(e).strip() else repr(e))


MUTANTS = [
    ("M1 gerbang Penjualan tidak memakai akses khusus", "online",
     [("raise exception 'E3_MIGRATION_ANCHOR_MISMATCH: sales_module_access';\n end if;\n v:=replace", "raise exception 'E3_MIGRATION_ANCHOR_MISMATCH: sales_module_access';\n end if;\n return;\n v:=replace", 1)]),
    ("M2 akun OWNER boleh diberi akses khusus", "owner",
     [("if v_role='OWNER' then\n   raise exception", "if false then\n   raise exception", 1)]),
    ("M3 non-owner boleh menyimpan (kedua pemeriksaan Owner dibuang)", "owner",
     [("if auth.role() is distinct from 'authenticated' or v_actor is null\n or not exists(select 1 from public.profiles where id=v_actor and role='OWNER' and is_active) then",
       "if auth.role() is distinct from 'authenticated' or v_actor is null then", 1),
      (" if not exists(select 1 from public.profiles where id=v_actor and role='OWNER' and is_active) then\n   raise exception using errcode='42501'",
       " if false then\n   raise exception using errcode='42501'", 1)]),
    ("M4 get_my membaca akun lain", "self",
     [("where p.id=auth.uid() and p.is_active and p.role<>'OWNER';", "where p.is_active and p.role<>'OWNER' limit 1;", 1)]),
    ("M5 daftar sub-menu kosong diterima", "validation",
     [("if jsonb_array_length(e.value)=0 then", "if false then", 1)]),
    ("M6 riwayat tidak ditulis", "history",
     [("   insert into role_settings_private.account_access_override_history(profile_id,created_by,target_role,reason,before,after,request_key)\n   values(p_profile_id,v_actor,v_role,v_reason,v_before,v_after,p_request_key) returning id into v_hist;\n", "", 1)]),
    ("M7 kunci permintaan dipakai ulang dengan isi beda", "history",
     [("if v_cached.actor<>v_actor or v_cached.payload<>v_payload then", "if false then", 1)]),
    ("M8 akses khusus akun nonaktif tetap berlaku", "self",
     [("where p.id=auth.uid() and p.is_active and p.role<>'OWNER';", "where p.id=auth.uid() and p.role<>'OWNER';", 1)]),
    ("M9 Log Aktifitas tidak dipasang", "history",
     [("create trigger a01_activity_change after insert or update on role_settings_private.account_access_overrides\n for each row execute function public.capture_activity_log();\n", "", 1)]),
    ("M10 cascade hapus akun diblok penjaga", "cascade",
     [(" if tg_op='DELETE' and not exists(select 1 from public.profiles where id=old.profile_id) then return old; end if;\n", "", 1)]),
]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--json", type=Path); ap.add_argument("--pg-bin", default=os.environ.get("PG_BIN", "/usr/lib/postgresql/16/bin"))
    ap.add_argument("--baseline", action="store_true"); ap.add_argument("--mutations", action="store_true"); ap.add_argument("--sections"); a = ap.parse_args()
    secs = set(a.sections.split(",")) if a.sections else None
    extra = {}
    cand = CANDIDATE.read_text()
    try:
        with NativePostgres(a.pg_bin) as db:
            fixture.DisposablePostgres.bootstrap(_HoldBack(db))
            h = H(db); prep(h)
            if a.mutations:
                extra["mutants"] = {}
                plan = [("M0 control (unmodified candidate)", cand, None)]
                for name, sec, pairs in MUTANTS:
                    text, ok = cand, True
                    for old, new, n in pairs:
                        if text.count(old) != n: check(name + " anchor", False, dict(count=text.count(old), anchor=old[:60])); ok = False; break
                        text = text.replace(old, new)
                    if ok: plan.append((name, text, set(sec.split(","))))
                for i, (name, text, s) in enumerate(plan):
                    os.environ.pop("PGDATABASE", None); db.sql(f"create database e3m{i} template postgres"); os.environ["PGDATABASE"] = f"e3m{i}"
                    before = len(RESULTS); crash = None
                    try:
                        apply_candidate(h, text); sec_baseline_behaviour(h) if s is None else None; run(h, s)
                    except Exception as e: crash = "battery aborted: " + str(e).strip().splitlines()[0][:200]
                    fails = [c["case"] for c in RESULTS[before:] if c["status"] == "FAIL"]
                    del RESULTS[before:]; os.environ.pop("PGDATABASE", None)
                    if i == 0: check(name + " has 0 FAIL", not fails and not crash, (fails + [crash or ""])[:3])
                    else:
                        extra["mutants"][name] = dict(killed=bool(fails or crash), failing=fails[:3], crash=crash)
                        check(name + " KILLED", bool(fails or crash), fails[:3] or [crash])
            else:
                sec_baseline_behaviour(h)
                if not a.baseline:
                    apply_candidate(h)
                    v1 = h.val("select md5(pg_get_functiondef('public.sales_module_access()'::regprocedure))")
                    err = h.err("begin;\n" + cand + "\ncommit;")
                    check("menerapkan ulang migrasi gagal dengan bersih (objek sudah ada), definisi tidak berubah",
                          bool(err) and h.val("select md5(pg_get_functiondef('public.sales_module_access()'::regprocedure))") == v1, short(err))
                    sec_baseline_behaviour(h)
                run(h, secs)
    except Exception as e:
        check("HARNESS", False, str(e)[:800])
    totals = {s: sum(c["status"] == s for c in RESULTS) for s in ["PASS", "FAIL"]}
    if a.json: a.json.write_text(json.dumps(dict(mode="mutations" if a.mutations else "RED" if a.baseline else "GREEN", cases=RESULTS, totals=totals, **extra), indent=2, default=str))
    print(totals)
    return 0 if a.baseline else int(totals["FAIL"] > 0)


if __name__ == "__main__":
    sys.exit(main())
