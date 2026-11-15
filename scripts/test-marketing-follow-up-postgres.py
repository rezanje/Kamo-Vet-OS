#!/usr/bin/env python3
"""Uji migrasi 20261121100000 (Marketing: Follow up pelanggan) di PostgreSQL 17 sungguhan, data fiktif.

Dasar: skema penuh repo (semua migrasi KECUALI migrasi ini) diputar dari nol, lalu data fiktif ditanam, lalu migrasi dipasang.
Mode:
  (default)    GREEN  - semua kasus harus lulus
  --baseline   RED    - tanpa migrasi; kasus yang bergantung padanya harus GAGAL
  --mutants    kloning database per mutan (>= 15); tiap mutan harus gagal di >= 1 kasus, kontrol 0 gagal
  --only a,b   (dengan --mutants) hanya mutan itu
  --attach DIR pakai klaster dev yang sudah punya database tpl_base (tanpa membangun ulang rantai migrasi)
  --json FILE  tulis hasil
Jalankan dengan: flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-marketing-follow-up-postgres.py --pg-bin /opt/data/kamo-pg-harness/bin
Tidak pernah terhubung ke Production: klaster lokal sekali pakai, socket unix, dibuang di akhir.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

_spec = importlib.util.spec_from_file_location("hris", ROOT / "scripts/test-hris-cabang-postgres.py")
hris = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hris)

MIGRATIONS = ROOT / "supabase/migrations"
MIGRASI = MIGRATIONS / "20261121100000_marketing_follow_up.sql"
HARI = "2026-11-15"
DAFTAR = "public.marketing_followup_daftar"

CAB_A = "a0000000-0000-4000-8000-00000000000a"
CAB_B = "b0000000-0000-4000-8000-00000000000b"
U = {k: f"10000000-0000-4000-8000-0000000000{n:02d}" for n, k in enumerate(
    ["owner", "admin_ok", "admin_no", "staff_a", "staff_no", "off", "finance"], 1)}


def uid(prefix, n):
    return f"{prefix}000000-0000-4000-8000-{n:012d}"


def q(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def ts(n):
    """n hari sebelum HARI, pukul 10:00 WIB."""
    return f"(((date '{HARI}' - {n})::timestamp + time '10:00') at time zone 'Asia/Jakarta')"


def dt(n):
    return f"(date '{HARI}' - {n})"


# ───────────── data fiktif ─────────────
C = {}      # kunci -> uuid pelanggan
P = {}      # kunci -> uuid hewan
SQL = []
_n = {"cust": 0, "pet": 0, "visit": 0, "sale": 0, "inv": 0, "item": 0, "fu": 0}


def cust(key, nama, phone=None, spend=0, hidden=False):
    _n["cust"] += 1
    C[key] = uid("c1", _n["cust"])
    phone = phone if phone is not None else f"0812{_n['cust']:08d}"
    SQL.append(f"insert into public.customers(id,name,phone,total_spending,hidden_at,hidden_by,hidden_reason) values ({q(C[key])},{q(nama)},{q(phone)},{spend},"
               + (f"now(),{q(U['owner'])},'data percobaan'" if hidden else "null,null,null") + ");")


def pet(key, ckey, nama=None, status="Aktif"):
    _n["pet"] += 1
    P[key] = uid("d1", _n["pet"])
    SQL.append(f"insert into public.pets(id,customer_id,name,species,status) values ({q(P[key])},{q(C[ckey])},{q(nama or 'Hewan ' + key)},'Kucing',{q(status)});")


def visit(ckey, pkey, hari, branch=CAB_A, status="Selesai", poli="Poli Umum", keluhan=None, impor=False, arsip=False, vid=None):
    _n["visit"] += 1
    vid = vid or uid("e1", _n["visit"])
    extra_cols = ",archived_at,archived_by,archive_reason" if arsip else ""
    extra_vals = f",{ts(max(hari - 1, 0))},{q(U['owner'])},'data percobaan'" if arsip else ""
    SQL.append(f"insert into public.visits(id,branch_id,customer_id,pet_id,status,created_at,poli,keluhan,legacy_source_key{extra_cols}) values "
               f"({q(vid)},{q(None if impor else branch)},{q(C[ckey])},{q(P[pkey])},{q(status)},{ts(hari)},{q(poli)},{q(keluhan)},{q('IMP-' + str(_n['visit'])) if impor else 'null'}{extra_vals});")
    return vid


def sale(ckey, hari, branch=CAB_B, voided=False, sid=None):
    _n["sale"] += 1
    sid = sid or uid("f1", _n["sale"])
    SQL.append(f"insert into public.sales(id,branch_id,customer_id,no_struk,total,created_at,voided_at) values ({q(sid)},{q(branch)},{q(C[ckey])},'MK-{_n['sale']}',1000,{ts(hari)},"
               + (f"{ts(hari)}" if voided else "null") + ");")
    return sid


def item(key, nama, tipe="Jasa", kategori="Konsultasi"):
    _n["item"] += 1
    P["item_" + key] = uid("a1", _n["item"])
    SQL.append(f"insert into public.items(id,code,name,item_type,tindakan_kategori) values ({q(P['item_' + key])},'MK-{_n['item']}',{q(nama)},{q(tipe)},{q(kategori if tipe == 'Jasa' else None)});")


def invoice_item(vid, hari, deskripsi, item_key=None, jenis="jasa", groomer=None, voided=False):
    _n["inv"] += 1
    iid = uid("b1", _n["inv"])
    SQL.append(f"insert into public.invoices(id,visit_id,invoice_no,created_at,voided_at,paid_status) values ({q(iid)},{q(vid)},'MK-INV-{_n['inv']}',{ts(hari)},"
               + (ts(hari) if voided else "null") + ",'Lunas');")
    perf = f"jsonb_build_object('version',1,'staff_name',{q(groomer)},'doctor_name',null)" if groomer else "null"
    SQL.append(f"insert into public.invoice_items(invoice_id,deskripsi,jenis,item_id,service_performers) values ({q(iid)},{q(deskripsi)},{q(jenis)},{q(P.get('item_' + item_key) if item_key else None)},{perf});")


def sale_item(sid, nama, item_key=None):
    SQL.append(f"insert into public.sale_items(sale_id,nama,item_id) values ({q(sid)},{q(nama)},{q(P.get('item_' + item_key) if item_key else None)});")


def followup(ckey, pkey, jenis, tanggal_hari, status="Menunggu", branch=CAB_A, vid=None, catatan=None):
    _n["fu"] += 1
    SQL.append(f"insert into public.follow_ups(customer_id,pet_id,jenis,tanggal,status,branch_id,visit_id,catatan) values "
               f"({q(C[ckey])},{q(P[pkey])},{q(jenis)},{dt(tanggal_hari)},{q(status)},{q(branch)},{q(vid)},{q(catatan)});")


def log(ckey, pkey, jenis, hari, hasil, branch=CAB_A):
    SQL.append(f"insert into public.marketing_followup_log(customer_id,pet_id,jenis,branch_id,hasil,created_by,created_at,request_key) values "
               f"({q(C[ckey])},{q(P[pkey]) if pkey else 'null'},{q(jenis)},{q(branch)},{q(hasil)},{q(U['owner'])},{ts(hari)},gen_random_uuid());")


def bangun_data():
    SQL.clear()
    C.clear()
    P.clear()
    for k in _n:
        _n[k] = 0
    # --- Lama tidak balik ---
    def satu(key, nama, **kw):
        cust(key, nama, **kw)
        pet(key, key, "Anabul " + nama.split()[0])
    satu("L1", "Lama Mahal", spend=500000)
    satu("L2", "Lama Murah")
    satu("L3", "Dua Cabang Petshop", spend=100000)
    satu("L4", "Impor Tanpa Cabang")
    satu("L5", "Pindah Cabang")
    satu("L6", "Aktif Lima Hari")
    satu("L7", "Void Terakhir")
    satu("L8", "Arsip Terakhir")
    satu("L9", "Disembunyikan", hidden=True)
    satu("L10", "tes")
    satu("L11", "Testimoni Budi")
    satu("L12", "Tanpa Nomor", phone="123")
    satu("L13", "Telepon Rumah", phone="0251123456")
    satu("L14", "Format Plus Enam Dua", phone="+62 812-0000-0014")
    satu("L15", "Kunjungan Terbuka")
    cust("L16", "Hewan Tiada"); pet("L16", "L16", "Si Mati", "Mati")
    cust("L17", "Hewan Sebagian"); pet("L17a", "L17", "Si Hidup"); pet("L17b", "L17", "Si Pergi", "Mati")
    satu("L18", "Terlalu Lama")
    satu("L19", "Seratus Delapan Puluh")
    satu("L20", "Empat Lima Hari")
    satu("L22", "Lima Sembilan Hari")
    satu("N1", "Baru Tiga Puluh")
    satu("N2", "Baru Empat Puluh")
    satu("N3", "Dua Kunjungan")
    satu("N4", "Baru Enam Puluh")
    satu("N5", "Baru Enam Satu")
    satu("N6", "Baru Dua Sembilan")
    visit("L1", "L1", 200); visit("L1", "L1", 150); visit("L1", "L1", 100)
    visit("L2", "L2", 70)
    visit("L3", "L3", 300); sale("L3", 95, CAB_B)
    visit("L4", "L4", 100, impor=True)
    visit("L5", "L5", 100, CAB_A); sale("L5", 80, CAB_B)
    visit("L6", "L6", 5)
    sale("L7", 120, CAB_B); sale("L7", 3, CAB_B, voided=True)
    visit("L8", "L8", 120); visit("L8", "L8", 2, arsip=True)
    visit("L9", "L9", 100); visit("L10", "L10", 100); visit("L11", "L11", 100)
    visit("L12", "L12", 100); visit("L13", "L13", 100); visit("L14", "L14", 100)
    visit("L15", "L15", 100, status="Pembayaran")
    visit("L16", "L16", 100); visit("L17", "L17a", 100)
    visit("L18", "L18", 800); visit("L19", "L19", 200); visit("L20", "L20", 45); visit("L22", "L22", 59)
    visit("N1", "N1", 30); sale("N2", 40, CAB_B)
    visit("N3", "N3", 40); visit("N3", "N3", 35)
    visit("N4", "N4", 60); visit("N5", "N5", 61); visit("N6", "N6", 29)
    log("L1", None, "lama_tidak_balik", 3, "Tidak diangkat")
    log("L3", None, "lama_tidak_balik", 20, "Tertarik", CAB_B)
    log("L2", None, "lama_tidak_balik", 30, "Tidak berminat")
    log("L5", None, "lama_tidak_balik", 100, "Nomor salah", CAB_B)
    # --- Grooming ---
    item("g1", "Grooming VET Lengkap + CU")
    item("kons", "Jasa Konsultasi Grooming")
    item("shampoo", "Shampoo Grooming 20L", tipe="Persediaan")
    item("mandi", "Mandi Sehat", kategori="Grooming")
    item("paket", "Paket Grooming + Detick BTKM", tipe="Grup")
    item("kucing", "Grooming Kucing Lengkap")
    for k, nama in [("G1", "Grooming Jatuh Tempo"), ("G2", "Grooming Dua Lima Hari"), ("G3", "Grooming Konsultasi"), ("G4", "Beli Shampoo"),
                    ("G5", "Petshop Satu Hewan"), ("G7", "Riwayat Poli"), ("G7b", "Keluhan Lama"), ("G8", "Dedupe Faktur"),
                    ("G9", "Faktur Batal"), ("G10", "Dijadwalkan Dokter"), ("G10b", "Jadwal Depan"), ("G11", "Baru Grooming"),
                    ("G12", "Jadwal Terpenuhi"), ("G14", "Kategori Grooming"), ("G15", "Paket Grup"),
                    ("G16", "Sudah Dihubungi Grooming"), ("G17", "Grooming Kunjungan Terbuka"), ("G18", "Faktur Tanpa Master"), ("G19", "Obat Bernama Grooming")]:
        satu(k, nama)
    cust("G6", "Petshop Dua Hewan"); pet("G6a", "G6", "Dua A"); pet("G6b", "G6", "Dua B")
    cust("G13", "Hewan Mati Grooming"); pet("G13", "G13", "Almarhum", "Mati")

    def faktur(key, hari, deskripsi, item_key=None, branch=CAB_A, groomer=None, voided=False, jenis="jasa", status="Selesai", poli="Poli Umum"):
        vid = visit(key, key, hari, branch, status=status, poli=poli)
        invoice_item(vid, hari, deskripsi, item_key, jenis, groomer, voided)
        return vid
    faktur("G1", 40, "Grooming VET Lengkap + CU", "g1", groomer="Groomer Satu")
    faktur("G2", 25, "Grooming VET Lengkap + CU", "g1")
    faktur("G3", 40, "Jasa Konsultasi Grooming", "kons")
    s4 = sale("G4", 40, CAB_B); sale_item(s4, "Shampoo Grooming 20L", "shampoo")
    s5 = sale("G5", 45, CAB_B); sale_item(s5, "Grooming Kucing Lengkap", "kucing")
    s6 = sale("G6", 45, CAB_B); sale_item(s6, "Grooming Kucing Lengkap", "kucing")
    visit("G7", "G7", 50, impor=True, poli="Grooming")
    visit("G7b", "G7b", 400, impor=True, keluhan="mandi dan grooming rutin")
    faktur("G8", 40, "Grooming VET Lengkap + CU", "g1", poli="Grooming")
    faktur("G9", 40, "Grooming VET Lengkap + CU", "g1", voided=True)
    visit("G10", "G10", 5)
    followup("G10", "G10", "Grooming", 3)
    visit("G10b", "G10b", 5)
    followup("G10b", "G10b", "Grooming", -10)
    faktur("G11", 5, "Grooming VET Lengkap + CU", "g1")
    followup("G11", "G11", "Grooming", -20)
    faktur("G12", 8, "Grooming VET Lengkap + CU", "g1")
    followup("G12", "G12", "Grooming", 10)
    faktur("G13", 40, "Grooming VET Lengkap + CU", "g1")
    faktur("G14", 40, "Mandi Sehat", "mandi")
    s15 = sale("G15", 40, CAB_B); sale_item(s15, "Paket Grooming + Detick BTKM", "paket")
    faktur("G16", 40, "Grooming VET Lengkap + CU", "g1")
    log("G16", "G16", "grooming", 2, "Tertarik")
    faktur("G17", 40, "Grooming VET Lengkap + CU", "g1", status="Pembayaran")
    faktur("G18", 40, "Grooming Kering", None)
    faktur("G19", 40, "Spray Grooming", None, jenis="obat")
    # --- Hari ini ---
    cust("H1", "Dua Hewan Hari Ini"); pet("H1a", "H1", "Aa"); pet("H1b", "H1", "Bb")
    for k, nama in [("H2", "Besok"), ("H3", "Terkirim"), ("H4", "Cabang B"), ("H5", "Cabang Dari Kunjungan"), ("H6", "Hewan Mati Follow"),
                    ("H7", "Selesai"), ("H8", "Disembunyikan Follow"), ("H9", "Hari Ini Dihubungi")]:
        if k == "H8":
            cust(k, nama, hidden=True); pet(k, k)
        elif k == "H6":
            cust(k, nama); pet(k, k, "Almarhum Dua", "Mati")
        else:
            satu(k, nama)
    followup("H1", "H1a", "Kontrol", 0, catatan="cek luka")
    followup("H1", "H1b", "Vaksin", 2)
    SQL.append(f"insert into public.follow_ups(customer_id,pet_id,jenis,tanggal,status,branch_id) values ({q(C['H2'])},{q(P['H2'])},'Kontrol',date '{HARI}' + 1,'Menunggu',{q(CAB_A)});")
    followup("H3", "H3", "Kontrol", 0, status="Terkirim")
    followup("H4", "H4", "Obat habis", 0, branch=CAB_B)
    vh5 = visit("H5", "H5", 5)
    followup("H5", "H5", "Lainnya", 0, branch=None, vid=vh5)
    followup("H6", "H6", "Kontrol", 0)
    followup("H7", "H7", "Kontrol", 0, status="Selesai")
    followup("H8", "H8", "Kontrol", 0)
    followup("H9", "H9", "Kontrol", 0)
    log("H9", None, "followup_klinik", 2, "Nanti")
    return list(SQL)


def fixture_sql():
    data = "\n".join(bangun_data())
    return f"""
insert into auth.users(id) values {",".join(f"('{u}')" for u in U.values())} on conflict do nothing;
insert into public.profiles(id, role, is_active, full_name) values
  ('{U['owner']}','OWNER',true,'Uji Owner'), ('{U['admin_ok']}','ADMIN',true,'Uji Admin Boleh'), ('{U['admin_no']}','ADMIN',true,'Uji Admin Tidak'),
  ('{U['staff_a']}','STAFF',true,'Uji Staf A'), ('{U['staff_no']}','STAFF',true,'Uji Staf Tidak'), ('{U['off']}','ADMIN',false,'Uji Nonaktif'),
  ('{U['finance']}','FINANCE',true,'Uji Finance')
  on conflict (id) do update set role=excluded.role, is_active=excluded.is_active, full_name=excluded.full_name;
insert into public.branches(id, code, name, type, is_active) values
  ('{CAB_A}','MK-A','Cabang Uji A','KLINIK',true), ('{CAB_B}','MK-B','Cabang Uji B','PETSHOP',true);
insert into public.user_branches(user_id, branch_id) values ('{U['staff_a']}','{CAB_A}'), ('{U['staff_no']}','{CAB_A}');
begin;
set local session_replication_role = replica;
insert into role_settings_private.submenu_policies(role, module_id, allowed) values
  ('ADMIN','crm', array['crm.pelanggan','crm.follow-up-pelanggan']),
  ('STAFF','crm', array['crm.pelanggan']);
{data}
commit;
-- peran dengan izin: admin_ok memegang kebijakan ADMIN; staff_a dan finance diberi sendiri di kasus; admin_no = ADMIN dibuat berbeda lewat kebijakan di kasus
"""


# ───────────── harness ─────────────
class DB(NativePostgres):
    def sql_db(self, db, source):
        env = {**os.environ, "PSQLRC": "/dev/null"}
        r = subprocess.run(self.as_user + [self.psql, "-X", "-qAt", "-h", str(self.root), "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1"],
                           input=source, text=True, capture_output=True, env=env)
        if r.returncode:
            raise RuntimeError(r.stderr + r.stdout)
        return r.stdout.strip()


class Attached(DB):
    """Klaster dev yang sudah berjalan (dev_cluster.py): tidak start/stop."""
    def __init__(self, bin_dir, root):
        super().__init__(bin_dir)
        self.root = Path(root)
        self.as_user = ["runuser", "-u", "postgres", "--"] if os.geteuid() == 0 else []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None


def sesi(uid_, role="authenticated"):
    pre = f"set local role {role}; "
    if uid_:
        pre += (f"select set_config('request.jwt.claim.sub','{uid_}',true); select set_config('request.jwt.claim.role','{role}',true); "
                f"select set_config('request.jwt.claims','{json.dumps(dict(sub=uid_, role=role))}',true); ")
    return pre


def jalan(pg, db, pre, perintah):
    return pg.sql_db(db, f"begin; {pre} {perintah} commit;").splitlines()[-1] if True else ""


def call(pg, db, who, nama_fn, **kw):
    args = ", ".join(f"{k} => {v}" for k, v in kw.items())
    out = pg.sql_db(db, f"begin; {sesi(U[who] if who else None)} select {nama_fn}({args})::text; commit;")
    return json.loads(out.splitlines()[-1])


def daftar(pg, db, who="owner", **kw):
    kw = {"p_" + k if not k.startswith("p_") else k: v for k, v in kw.items()}
    kw.setdefault("p_hari_ini", f"'{HARI}'")
    return call(pg, db, who, DAFTAR, **kw)


def build_chain(pg):
    pg.sql(hris.PLATFORM)
    pg.sql(hris.PERAN)
    lain = [f for f in sorted(MIGRATIONS.glob("*.sql")) if f.name != MIGRASI.name]
    for berkas in lain:
        if berkas.name in hris.SEBELUM:
            pg.sql(hris.SEBELUM[berkas.name])
        try:
            pg.sql("begin;\n" + berkas.read_text() + "\ncommit;")
        except RuntimeError as error:
            raise AssertionError(f"Migrasi {berkas.name} gagal di klaster bersih:\n{str(error)[:2000]}") from None
    print(f"PASS A: {len(lain)} migrasi repo (tanpa migrasi ini) berjalan dari nol", flush=True)
    return len(lain)


def pasang(pg, db, teks):
    pg.sql_db(db, "begin;\n" + teks + "\ncommit;")


def siapkan_fixture(pg, db, dengan_migrasi_dulu):
    """Fixture butuh tabel log (kalau ada): migrasi dipasang dulu bila `dengan_migrasi_dulu` (teks)."""
    if dengan_migrasi_dulu is not None:
        pasang(pg, db, dengan_migrasi_dulu)
    sql = fixture_sql()
    if dengan_migrasi_dulu is None:
        # baseline: tanpa tabel log -> buang baris log dari fixture
        sql = "\n".join(x for x in sql.splitlines() if "marketing_followup_log" not in x)
    pg.sql_db(db, sql)


# ───────────── kasus ─────────────
def nama_set(h):
    return sorted(r["nama"] for r in h["baris"])


def jalankan_kasus(pg, db):
    hasil = []

    def kasus(nama):
        def dekor(fn):
            try:
                fn()
                hasil.append((nama, True, ""))
            except Exception as e:  # noqa: BLE001
                import traceback
                hasil.append((nama, False, (str(e)[:300] + " @ " + " | ".join(traceback.format_exc().splitlines()[-4:-1]))[:600]))
            return fn
        return dekor

    def ditolak(who, kode, perintah, pesan_ada=None):
        try:
            pg.sql_db(db, f"begin; {sesi(U[who] if who else None)} {perintah} commit;")
        except RuntimeError as e:
            assert (pesan_ada or kode) in str(e), (kode, str(e)[:300])
            return
        raise AssertionError(f"seharusnya ditolak ({kode})")

    L60 = {"Lama Murah", "Lama Mahal", "Dua Cabang Petshop", "Impor Tanpa Cabang", "Pindah Cabang", "Void Terakhir", "Arsip Terakhir",
           "Testimoni Budi", "Format Plus Enam Dua", "Hewan Sebagian", "Seratus Delapan Puluh", "Baru Enam Puluh", "Baru Enam Satu", "Keluhan Lama"}

    def lama(who="owner", hari=60, status="semua", **kw):
        return daftar(pg, db, who, tab="'lama'", hari=hari, status=f"'{status}'", **kw)

    # ── A. normalisasi nomor HP
    @kasus("A1 normalisasi HP: 08.., +62.., 62.., 8.., 0062.., +62 08.. -> 62xxxxxxxxxx")
    def _():
        cases = {"0812-3456-7890": "6281234567890", "+62 812 3456 7890": "6281234567890", "6281234567890": "6281234567890",
                 "81234567890": "6281234567890", "0062 812 3456 7890": "6281234567890", "+62 0812 3456 7890": "6281234567890",
                 "(0812) 3456.7890": "6281234567890"}
        for src, want in cases.items():
            got = pg.sql_db(db, f"select coalesce(public.marketing_normalisasi_hp({q(src)}),'NULL');")
            assert got == want, (src, got, want)

    @kasus("A2 normalisasi HP: telepon rumah, terlalu pendek, terlalu panjang, kosong, null, huruf -> NULL")
    def _():
        for src in ["021 555 1234", "0251123456", "0812345", "08123456789012345", "", None, "abc", "123", "0721 1234 5678"]:
            got = pg.sql_db(db, f"select coalesce(public.marketing_normalisasi_hp({q(src)}),'NULL');")
            assert got == "NULL", (src, got)

    @kasus("A3 normalisasi HP: batas panjang 628 + 7..11 digit")
    def _():
        assert pg.sql_db(db, "select public.marketing_normalisasi_hp('0812345678');") == "62812345678"      # 628 + 8
        assert pg.sql_db(db, "select coalesce(public.marketing_normalisasi_hp('08123456'),'NULL');") == "NULL"      # 628 + 5
        assert pg.sql_db(db, "select coalesce(public.marketing_normalisasi_hp('08123456789012'),'NULL');") == "NULL"   # 628 + 12
        assert pg.sql_db(db, "select public.marketing_normalisasi_hp('081234567890');") == "6281234567890"

    # ── B. siapa boleh
    @kasus("B1 Owner boleh; ADMIN dengan sub-menu dicentang boleh")
    def _():
        for who in ("owner", "admin_ok"):
            assert call(pg, db, who, "public.marketing_followup_allowed") is True, who

    @kasus("B2 tanpa izin ditolak: ADMIN tanpa centang, STAFF tanpa kebijakan crm penuh, nonaktif, FINANCE tanpa kebijakan, anon")
    def _():
        pg.sql_db(db, "begin; set local session_replication_role=replica; delete from role_settings_private.submenu_policies where role='ADMIN'; "
                      "insert into role_settings_private.submenu_policies(role,module_id,allowed) values ('ADMIN','crm',array['crm.pelanggan']); commit;")
        try:
            for who in ("admin_ok", "admin_no", "staff_no", "off", "finance", "staff_a"):
                assert call(pg, db, who, "public.marketing_followup_allowed") is False, who
                ditolak(who, "MARKETING_DITOLAK", f"select {DAFTAR}(p_hari_ini => '{HARI}');")
        finally:
            pg.sql_db(db, "begin; set local session_replication_role=replica; delete from role_settings_private.submenu_policies where role='ADMIN'; "
                          "insert into role_settings_private.submenu_policies(role,module_id,allowed) values ('ADMIN','crm',array['crm.pelanggan','crm.follow-up-pelanggan']); commit;")
        assert call(pg, db, "admin_ok", "public.marketing_followup_allowed") is True

    @kasus("B3 Owner tetap lolos walau tabel kebijakan hilang; peran lain ditolak (gagal tertutup)")
    def _():
        out = pg.sql_db(db, f"""begin; drop table role_settings_private.submenu_policies cascade;
          {sesi(U['owner'])} select public.marketing_followup_allowed()::text;
          reset role; {sesi(U['admin_ok'])} select public.marketing_followup_allowed()::text; rollback;""")
        assert [x for x in out.splitlines() if x in ("true", "false")] == ["true", "false"], out

    @kasus("B4 anon tidak punya hak menjalankan fungsi baca, log, ringkas")
    def _():
        for fn in (f"{DAFTAR}(p_hari_ini => '{HARI}')", "public.marketing_followup_ringkas()",
                   "public.marketing_log_contact(null,null,'grooming',null,'Nanti',null,gen_random_uuid())"):
            ditolak(None, "permission denied", f"set local role anon; select {fn};")

    @kasus("B5 fungsi bantu internal tidak bisa dipanggil klien")
    def _():
        ditolak("owner", "permission denied", f"select * from clinic_private.marketing_kandidat('lama', date '{HARI}', 30, 0);")
        ditolak("owner", "permission denied", "select clinic_private.marketing_grooming_jasa('x', null);")

    # ── C. lama tidak balik
    @kasus("C1 60 hari, semua status: tepat himpunan yang benar (hidden/dummy/tanpa nomor/terbuka/hewan tiada/aktif/terlalu lama/59 hari tidak ikut)")
    def _():
        h = lama()
        assert set(nama_set(h)) == L60, (sorted(L60 ^ set(nama_set(h))))
        assert len(h["baris"]) == len(L60)

    @kasus("C2 90 hari dan 180 hari mempersempit; bucket menghitung ketiganya")
    def _():
        h90 = lama(hari=90)
        want90 = L60 - {"Lama Murah", "Pindah Cabang", "Baru Enam Puluh", "Baru Enam Satu"}
        assert set(nama_set(h90)) == want90, sorted(want90 ^ set(nama_set(h90)))
        assert nama_set(lama(hari=180)) == ["Keluhan Lama", "Seratus Delapan Puluh"]
        b = h90["bucket"]
        assert (b["60"], b["90"], b["180"]) == (len(L60), len(want90), 2), b

    @kasus("C3 cabang = cabang transaksi TERAKHIR; riwayat impor tanpa cabang")
    def _():
        h = lama()
        per = {r["nama"]: r["cabang"] for r in h["baris"]}
        assert per["Dua Cabang Petshop"] == "Cabang Uji B" and per["Pindah Cabang"] == "Cabang Uji B" and per["Void Terakhir"] == "Cabang Uji B"
        assert per["Lama Mahal"] == "Cabang Uji A" and per["Impor Tanpa Cabang"] is None
        jenis = {r["nama"]: r["jenis_terakhir"] for r in h["baris"]}
        assert jenis["Dua Cabang Petshop"] == "Petshop" and jenis["Lama Mahal"] == "Klinik"
        cab = {c["nama"]: c["jumlah"] for c in h["cabang"]}
        assert cab == {"Cabang Uji A": 9, "Cabang Uji B": 3, None: 2}, cab

    @kasus("C4 penjualan batal dan kunjungan diarsipkan tidak dihitung datang; kunjungan = jumlah transaksi sah")
    def _():
        h = lama()
        by = {r["nama"]: r for r in h["baris"]}
        assert by["Void Terakhir"]["hari"] == 120 and by["Arsip Terakhir"]["hari"] == 120
        assert by["Lama Mahal"]["kunjungan"] == 3 and by["Dua Cabang Petshop"]["kunjungan"] == 2 and by["Arsip Terakhir"]["kunjungan"] == 1

    @kasus("C5 urutan: total belanja menurun, lalu jumlah kunjungan, lalu yang baru lewat; per cabang")
    def _():
        h = lama()
        a = [r["nama"] for r in h["baris"] if r["cabang"] == "Cabang Uji A"]
        b = [r["nama"] for r in h["baris"] if r["cabang"] == "Cabang Uji B"]
        assert a[0] == "Lama Mahal" and b[:2] == ["Dua Cabang Petshop", "Pindah Cabang"], (a, b)
        assert a[1:4] == ["Baru Enam Puluh", "Baru Enam Satu", "Lama Murah"], a  # 0 belanja, 1 kunjungan: yang paling baru lewat dulu

    @kasus("C6 tanpa nomor dihitung terpisah (kosong/pendek dan telepon rumah); dikecualikan: terbuka, hewan tiada, disembunyikan")
    def _():
        h = lama()
        assert h["tanpa_nomor"] == 2, h["tanpa_nomor"]
        d = h["dikecualikan"]
        assert d["kunjungan_belum_selesai"] == 1 and d["hewan_tiada"] == 1 and d["disembunyikan"] == 2, d  # L9 + H8

    @kasus("C7 nama 'tes' persis dibuang, tapi 'Testimoni Budi' tidak (tidak menebak agresif); +62 diterima, nomor WA 62...")
    def _():
        h = lama()
        n = nama_set(h)
        assert "tes" not in n and "Testimoni Budi" in n
        r = {x["nama"]: x for x in h["baris"]}["Format Plus Enam Dua"]
        assert r["wa"] == "6281200000014" and r["hp"] == "+62 812-0000-0014", r["wa"]

    @kasus("C8 hewan: hanya yang hidup; pemilik semua hewan tiada tidak muncul")
    def _():
        h = lama()
        r = {x["nama"]: x for x in h["baris"]}
        assert r["Hewan Sebagian"]["hewan"] == ["Si Hidup"] and r["Hewan Sebagian"]["hewan_total"] == 1, r["Hewan Sebagian"]["hewan"]
        assert "Hewan Tiada" not in r
        assert r["Lama Mahal"]["hewan"] == ["Anabul Lama"]

    @kasus("C9 catatan sudah dihubungi: masa tunggu 14 hari; Tidak berminat / Nomor salah 90 hari; belum / sudah / semua")
    def _():
        belum = nama_set(lama(status="belum"))
        sudah = nama_set(lama(status="sudah"))
        assert sudah == ["Lama Mahal", "Lama Murah"], sudah           # Tidak diangkat 3 hari lalu; Tidak berminat 30 hari lalu
        assert "Dua Cabang Petshop" in belum and "Pindah Cabang" in belum  # Tertarik 20 hari lalu (lewat 14); Nomor salah 100 hari lalu (lewat 90)
        assert len(belum) + len(sudah) == len(L60)
        h = lama(status="semua")
        r = {x["nama"]: x for x in h["baris"]}
        assert r["Dua Cabang Petshop"]["dihubungi"]["hari_lalu"] == 20 and r["Dua Cabang Petshop"]["dihubungi"]["sudah"] is False
        assert r["Lama Mahal"]["dihubungi"]["hasil"] == "Tidak diangkat" and r["Lama Mahal"]["dihubungi"]["oleh"] == "Uji Owner"
        assert r["Lama Mahal"]["dihubungi"]["sudah"] is True
        h2 = lama(status="belum", cooldown=30)   # masa tunggu 30 hari: 20 hari lalu sekarang masuk 'sudah'
        assert "Dua Cabang Petshop" not in nama_set(h2)
        assert (h2["belum"], h2["sudah"]) == (len(belum) - 1, len(sudah) + 1), (h2["belum"], h2["sudah"])

    @kasus("C10 filter cabang, tanpa cabang, cari nama dan cari nomor")
    def _():
        assert set(nama_set(lama(cabang=f"'{CAB_B}'"))) == {"Dua Cabang Petshop", "Pindah Cabang", "Void Terakhir"}
        assert nama_set(lama(cabang_kosong="true")) == ["Impor Tanpa Cabang", "Keluhan Lama"]
        assert nama_set(lama(cari="'Mahal'")) == ["Lama Mahal"]
        assert nama_set(lama(cari="'lama mah'")) == ["Lama Mahal"]
        tel = pg.sql_db(db, f"select phone from public.customers where id='{C['L1']}';")
        assert nama_set(lama(cari=f"'{tel}'")) == ["Lama Mahal"]
        assert nama_set(lama(cari=f"'{tel[:4]}-{tel[4:8]}-{tel[8:]}'")) == ["Lama Mahal"]
        assert nama_set(lama(cari="'%'")) == []        # % dan _ bukan wildcard
        assert nama_set(lama(cari="'zzzz'")) == []

    @kasus("C11 batas per cabang: tampil dibatasi tetapi jumlah total tetap benar")
    def _():
        h = lama(limit=2)
        per_cab = {}
        for r in h["baris"]:
            per_cab[r["cabang"]] = per_cab.get(r["cabang"], 0) + 1
        assert max(per_cab.values()) == 2 and h["ditampilkan"] == len(h["baris"]) and h["total"] == len(L60), (per_cab, h["total"])
        assert lama(limit=0)["baris"] == [] and lama(limit=0)["total"] == len(L60)

    @kasus("C12 parameter tidak sah ditolak (hari, tab, status, batas, cari panjang)")
    def _():
        for kw, kode in [("p_hari => 45", "MARKETING_HARI"), ("p_tab => 'x'", "MARKETING_TAB"), ("p_status => 'x'", "MARKETING_STATUS"),
                         ("p_limit => 501", "MARKETING_BATAS"), ("p_interval => 10", "MARKETING_INTERVAL"), ("p_depan => 15", "MARKETING_DEPAN"),
                         ("p_cooldown => 0", "MARKETING_MASA_TUNGGU"), (f"p_cari => '{'x' * 61}'", "MARKETING_CARI")]:
            ditolak("owner", kode, f"select {DAFTAR}({kw}, p_hari_ini => '{HARI}');")

    # ── D. batas cabang
    @kasus("D1 STAF cabang A (diberi izin) hanya melihat pelanggan yang cabang TERAKHIR-nya A; B dan tanpa cabang tidak")
    def _():
        pg.sql_db(db, "begin; set local session_replication_role=replica; delete from role_settings_private.submenu_policies where role='STAFF'; "
                      "insert into role_settings_private.submenu_policies(role,module_id,allowed) values ('STAFF','crm',array['crm.follow-up-pelanggan']); commit;")
        try:
            h = lama("staff_a")
            cabs = {r["cabang"] for r in h["baris"]}
            assert cabs == {"Cabang Uji A"}, cabs
            assert "Dua Cabang Petshop" not in nama_set(h) and "Impor Tanpa Cabang" not in nama_set(h)
            assert {"Lama Mahal", "Seratus Delapan Puluh"} <= set(nama_set(h))
            # last-touch memakai SEMUA cabang: pelanggan A yang terakhir ke B tidak muncul di daftar A
            assert "Pindah Cabang" not in nama_set(h)
            assert [c["nama"] for c in h["cabang"]] == ["Cabang Uji A"]
            # cabang lain diminta eksplisit: tetap kosong
            assert lama("staff_a", cabang=f"'{CAB_B}'")["baris"] == []
        finally:
            pg.sql_db(db, "begin; set local session_replication_role=replica; delete from role_settings_private.submenu_policies where role='STAFF'; "
                          "insert into role_settings_private.submenu_policies(role,module_id,allowed) values ('STAFF','crm',array['crm.pelanggan']); commit;")

    @kasus("D2 ADMIN dengan izin (semua cabang) melihat semua termasuk tanpa cabang")
    def _():
        assert set(nama_set(lama("admin_ok"))) == L60

    # ── E. grooming
    G30 = {"Grooming Jatuh Tempo", "Petshop Satu Hewan", "Petshop Dua Hewan", "Riwayat Poli", "Dedupe Faktur", "Dijadwalkan Dokter",
           "Kategori Grooming", "Paket Grup", "Sudah Dihubungi Grooming", "Faktur Tanpa Master"}

    def groom(who="owner", **kw):
        return daftar(pg, db, who, tab="'grooming'", status="'semua'", **kw)

    @kasus("E1 grooming 30 hari: aturan jasa (kategori Grooming ATAU nama grooming; bukan konsultasi/shampoo/obat/batal/hewan mati/kunjungan terbuka/terlalu lama)")
    def _():
        h = groom()
        assert set(nama_set(h)) == G30, sorted(G30 ^ set(nama_set(h)))

    @kasus("E2 interval 21 menambah yang 25 hari; interval 45 hanya yang lebih lama")
    def _():
        assert set(nama_set(groom(interval=21))) == G30 | {"Grooming Dua Lima Hari"}
        assert set(nama_set(groom(interval=45))) == {"Petshop Satu Hewan", "Petshop Dua Hewan", "Riwayat Poli", "Dijadwalkan Dokter"}

    @kasus("E3 hari terlewat, groomer, sumber, cabang grooming terakhir")
    def _():
        r = {x["nama"]: x for x in groom()["baris"]}
        assert r["Grooming Jatuh Tempo"]["hari"] == 10 and r["Grooming Jatuh Tempo"]["groomer"] == "Groomer Satu" and r["Grooming Jatuh Tempo"]["sumber"] == "belanja"
        assert r["Grooming Jatuh Tempo"]["cabang"] == "Cabang Uji A" and r["Petshop Satu Hewan"]["cabang"] == "Cabang Uji B"
        assert r["Riwayat Poli"]["sumber"] == "riwayat kunjungan" and r["Riwayat Poli"]["cabang"] is None and r["Riwayat Poli"]["hari"] == 20
        assert r["Petshop Satu Hewan"]["hari"] == 15

    @kasus("E4 penjualan petshop tanpa hewan: satu hewan hidup -> hewan itu; dua hewan -> hewan tidak dicatat (daftar nama)")
    def _():
        r = {x["nama"]: x for x in groom()["baris"]}
        assert r["Petshop Satu Hewan"]["pet_id"] == P["G5"] and r["Petshop Satu Hewan"]["hewan"] == ["Anabul Petshop"]
        assert r["Petshop Dua Hewan"]["pet_id"] is None and r["Petshop Dua Hewan"]["hewan"] == ["Dua A", "Dua B"] and r["Petshop Dua Hewan"]["hewan_total"] == 2

    @kasus("E5 jadwal dokter: dijadwalkan lewat, jadwal ke depan hanya dengan 'depan'; jadwal yang sudah terpenuhi tidak dihitung")
    def _():
        r = {x["nama"]: x for x in groom()["baris"]}
        assert r["Dijadwalkan Dokter"]["sumber"] == "dijadwalkan dokter" and r["Dijadwalkan Dokter"]["hari"] == 3 and r["Dijadwalkan Dokter"]["jadwal"] == "2026-11-12"
        assert "Jadwal Depan" not in r and "Baru Grooming" not in r and "Jadwal Terpenuhi" not in r
        d10 = set(nama_set(groom(depan=10)))
        assert d10 == G30 | {"Jadwal Depan", "Grooming Dua Lima Hari"}, sorted(d10 ^ (G30 | {"Jadwal Depan", "Grooming Dua Lima Hari"}))
        assert "Baru Grooming" not in set(nama_set(groom(depan=14)))

    @kasus("E6 satu faktur + poli Grooming yang sama dihitung SATU kali (sumber belanja); catatan dihubungi per hewan")
    def _():
        r = {x["nama"]: x for x in groom()["baris"]}
        assert r["Dedupe Faktur"]["sumber"] == "belanja"
        assert len([x for x in groom()["baris"] if x["nama"] == "Dedupe Faktur"]) == 1
        belum = nama_set(daftar(pg, db, tab="'grooming'", status="'belum'"))
        assert "Sudah Dihubungi Grooming" not in belum and len(belum) == len(G30) - 1
        assert nama_set(daftar(pg, db, tab="'grooming'", status="'sudah'")) == ["Sudah Dihubungi Grooming"]

    @kasus("E7 grooming: STAF cabang A hanya melihat cabang A")
    def _():
        pg.sql_db(db, "begin; set local session_replication_role=replica; delete from role_settings_private.submenu_policies where role='STAFF'; "
                      "insert into role_settings_private.submenu_policies(role,module_id,allowed) values ('STAFF','crm',array['crm.follow-up-pelanggan']); commit;")
        try:
            h = groom("staff_a")
            assert {r["cabang"] for r in h["baris"]} == {"Cabang Uji A"}, {r["cabang"] for r in h["baris"]}
            assert not ({"Petshop Satu Hewan", "Petshop Dua Hewan", "Paket Grup", "Riwayat Poli"} & set(nama_set(h)))
        finally:
            pg.sql_db(db, "begin; set local session_replication_role=replica; delete from role_settings_private.submenu_policies where role='STAFF'; "
                          "insert into role_settings_private.submenu_policies(role,module_id,allowed) values ('STAFF','crm',array['crm.pelanggan']); commit;")

    # ── F. hari ini
    HI = {"Dua Hewan Hari Ini", "Cabang B", "Cabang Dari Kunjungan", "Hari Ini Dihubungi", "Dijadwalkan Dokter", "Jadwal Terpenuhi"}

    def hari_ini(who="owner", **kw):
        return daftar(pg, db, who, tab="'hari_ini'", status=kw.pop("status", "'semua'"), **kw)

    @kasus("F1 hari ini: Menunggu yang jatuh tempo/terlewat; besok, Terkirim, Selesai, hewan mati, pelanggan tersembunyi tidak ikut")
    def _():
        assert set(nama_set(hari_ini())) == HI, sorted(HI ^ set(nama_set(hari_ini())))
        assert "Besok" in set(nama_set(hari_ini(depan=1)))

    @kasus("F2 satu pemilik satu baris: dua hewan, dua jenis, tanggal tertua menentukan hari terlewat")
    def _():
        rows = [r for r in hari_ini()["baris"] if r["nama"] == "Dua Hewan Hari Ini"]
        assert len(rows) == 1
        r = rows[0]
        assert r["hari"] == 2 and len(r["item"]) == 2 and [i["jenis"] for i in r["item"]] == ["Vaksin", "Kontrol"], r["item"]
        assert r["item"][1]["hewan"] == "Aa" and r["item"][1]["catatan"] == "cek luka"

    @kasus("F3 cabang follow up: cabang di baris, atau cabang kunjungan bila kosong; STAF A tidak melihat cabang B")
    def _():
        r = {x["nama"]: x["cabang"] for x in hari_ini()["baris"]}
        assert r["Cabang B"] == "Cabang Uji B" and r["Cabang Dari Kunjungan"] == "Cabang Uji A" and r["Dua Hewan Hari Ini"] == "Cabang Uji A"
        pg.sql_db(db, "begin; set local session_replication_role=replica; delete from role_settings_private.submenu_policies where role='STAFF'; "
                      "insert into role_settings_private.submenu_policies(role,module_id,allowed) values ('STAFF','crm',array['crm.follow-up-pelanggan']); commit;")
        try:
            assert "Cabang B" not in nama_set(hari_ini("staff_a"))
            assert "Cabang Dari Kunjungan" in nama_set(hari_ini("staff_a"))
        finally:
            pg.sql_db(db, "begin; set local session_replication_role=replica; delete from role_settings_private.submenu_policies where role='STAFF'; "
                          "insert into role_settings_private.submenu_policies(role,module_id,allowed) values ('STAFF','crm',array['crm.pelanggan']); commit;")

    @kasus("F4 sudah dihubungi (followup_klinik) memisahkan belum/sudah")
    def _():
        assert nama_set(hari_ini(status="'sudah'")) == ["Hari Ini Dihubungi"]
        assert "Hari Ini Dihubungi" not in nama_set(hari_ini(status="'belum'"))

    # ── G. pelanggan baru
    @kasus("G1 pelanggan baru: datang tepat satu kali, pertama 30..60 hari lalu (batas ikut); dua kunjungan, 29 dan 61 hari tidak")
    def _():
        h = daftar(pg, db, tab="'baru'", status="'semua'")
        want = {"Baru Tiga Puluh", "Baru Empat Puluh", "Baru Enam Puluh", "Empat Lima Hari", "Lima Sembilan Hari", "Beli Shampoo", "Dedupe Faktur", "Faktur Batal",
                "Faktur Tanpa Master", "Grooming Jatuh Tempo", "Grooming Konsultasi", "Kategori Grooming", "Obat Bernama Grooming", "Paket Grup",
                "Petshop Dua Hewan", "Petshop Satu Hewan", "Riwayat Poli", "Sudah Dihubungi Grooming"}
        assert set(nama_set(h)) == want, sorted(want ^ set(nama_set(h)))
        assert "Dua Kunjungan" not in nama_set(h) and "Baru Enam Satu" not in nama_set(h) and "Baru Dua Sembilan" not in nama_set(h)

    # ── H. catatan dihubungi (RPC)
    key = "99999999-0000-4000-8000-000000000001"

    def rpc(who, **kw):
        defaults = dict(c=C["L2"], pet="null", jenis="lama_tidak_balik", cab=CAB_A, hasil="Nanti", catatan="'catatan uji'", key=key)
        defaults.update(kw)
        cmd = (f"select public.marketing_log_contact('{defaults['c']}', {defaults['pet'] if str(defaults['pet']).startswith('null') else q(defaults['pet'])}, "
               f"'{defaults['jenis']}', {q(defaults['cab'])}, '{defaults['hasil']}', {defaults['catatan']}, '{defaults['key']}')::text;")
        return cmd

    @kasus("H1 Owner mencatat; kunci sama + isi sama = hasil lama (tidak dobel); kunci sama + isi beda ditolak")
    def _():
        out = json.loads(pg.sql_db(db, f"begin; {sesi(U['owner'])} {rpc('owner')} commit;").splitlines()[-1])
        assert out["already_applied"] is False
        out2 = json.loads(pg.sql_db(db, f"begin; {sesi(U['owner'])} {rpc('owner')} commit;").splitlines()[-1])
        assert out2["already_applied"] is True and out2["id"] == out["id"]
        n = pg.sql_db(db, f"select count(*) from public.marketing_followup_log where request_key='{key}';")
        assert n == "1", n
        ditolak("owner", "MARKETING_KUNCI_DIPAKAI", rpc("owner", hasil="Tertarik"))
        ditolak("owner", "MARKETING_KUNCI_DIPAKAI", rpc("owner", catatan="'lain'"))
        row = pg.sql_db(db, f"select created_by::text||'|'||hasil||'|'||coalesce(catatan,'') from public.marketing_followup_log where request_key='{key}';")
        assert row == f"{U['owner']}|Nanti|catatan uji", row

    @kasus("H2 setelah dicatat, baris pindah ke 'sudah' di daftar (Lama Murah dicatat Nanti hari ini)")
    def _():
        # L2 sudah punya 'Tidak berminat' 30 hari lalu; catatan baru 'Nanti' hari ini menggantikan sebagai yang terakhir
        r = {x["nama"]: x for x in lama(status="semua")["baris"]}
        assert r["Lama Murah"]["dihubungi"]["hasil"] == "Nanti" and r["Lama Murah"]["dihubungi"]["hari_lalu"] == 0 and r["Lama Murah"]["dihubungi"]["sudah"] is True

    @kasus("H3 hasil/jenis/catatan/pelanggan/hewan tidak sah ditolak dengan pesan sendiri")
    def _():
        k2 = "99999999-0000-4000-8000-000000000002"
        ditolak("owner", "MARKETING_HASIL", rpc("owner", hasil="Apa saja", key=k2))
        ditolak("owner", "MARKETING_JENIS", rpc("owner", jenis="lainnya", key=k2))
        ditolak("owner", "MARKETING_CATATAN", rpc("owner", catatan=f"'{'x' * 501}'", key=k2))
        ditolak("owner", "MARKETING_PELANGGAN", rpc("owner", c="00000000-0000-4000-8000-000000000bad", key=k2))
        ditolak("owner", "MARKETING_HEWAN", rpc("owner", pet=P["L1"], key=k2))        # hewan milik pelanggan lain
        ditolak("owner", "MARKETING_CABANG", rpc("owner", cab="00000000-0000-4000-8000-000000000bad", key=k2))
        ditolak("owner", "MARKETING_KUNCI", f"select public.marketing_log_contact('{C['L2']}', null, 'grooming', null, 'Nanti', null, null);")

    @kasus("H4 tanpa izin ditolak; staf cabang A tidak boleh mencatat untuk cabang B; admin berizin boleh")
    def _():
        k3 = "99999999-0000-4000-8000-000000000003"
        ditolak("staff_no", "MARKETING_DITOLAK", rpc("staff_no", key=k3))
        pg.sql_db(db, "begin; set local session_replication_role=replica; delete from role_settings_private.submenu_policies where role='STAFF'; "
                      "insert into role_settings_private.submenu_policies(role,module_id,allowed) values ('STAFF','crm',array['crm.follow-up-pelanggan']); commit;")
        try:
            ditolak("staff_a", "MARKETING_CABANG_DITOLAK", rpc("staff_a", cab=CAB_B, key=k3))
            ditolak("staff_a", "MARKETING_CABANG_DITOLAK", rpc("staff_a", cab="null", key=k3).replace("'null'", "null"))
            out = json.loads(pg.sql_db(db, f"begin; {sesi(U['staff_a'])} {rpc('staff_a', cab=CAB_A, key=k3)} commit;").splitlines()[-1])
            assert out["already_applied"] is False
        finally:
            pg.sql_db(db, "begin; set local session_replication_role=replica; delete from role_settings_private.submenu_policies where role='STAFF'; "
                          "insert into role_settings_private.submenu_policies(role,module_id,allowed) values ('STAFF','crm',array['crm.pelanggan']); commit;")
        k4 = "99999999-0000-4000-8000-000000000004"
        out = json.loads(pg.sql_db(db, f"begin; {sesi(U['admin_ok'])} {rpc('admin_ok', key=k4, cab=CAB_B)} commit;").splitlines()[-1])
        assert out["already_applied"] is False

    @kasus("H5 tabel log: tulis langsung (insert/update/delete) lewat klien ditolak; superuser tidak bisa ubah/hapus (append-only)")
    def _():
        ditolak("owner", "permission denied", f"insert into public.marketing_followup_log(customer_id,jenis,hasil,request_key) values ('{C['L2']}','grooming','Nanti',gen_random_uuid());")
        ditolak("owner", "permission denied", "update public.marketing_followup_log set hasil='Tertarik';")
        ditolak("owner", "permission denied", "delete from public.marketing_followup_log;")
        for perintah in ("update public.marketing_followup_log set hasil='Tertarik' where request_key='" + key + "';",
                         "delete from public.marketing_followup_log where request_key='" + key + "';"):
            try:
                pg.sql_db(db, "begin; " + perintah + " commit;")
                raise AssertionError("append-only dilanggar")
            except RuntimeError as e:
                assert "MARKETING_LOG_TETAP" in str(e), str(e)[:200]

    @kasus("H6 membaca log: Owner semua; admin berizin semua; staf A berizin hanya cabang A; tanpa izin 0; anon ditolak")
    def _():
        pg.sql_db(db, "begin; set local session_replication_role=replica; delete from role_settings_private.submenu_policies where role='STAFF'; "
                      "insert into role_settings_private.submenu_policies(role,module_id,allowed) values ('STAFF','crm',array['crm.follow-up-pelanggan']); commit;")
        try:
            total = int(pg.sql_db(db, "select count(*) from public.marketing_followup_log;"))
            def hitung(who, where=""):
                return int(pg.sql_db(db, f"begin; {sesi(U[who])} select count(*) from public.marketing_followup_log {where}; commit;").splitlines()[-1])
            assert hitung("owner") == total and hitung("admin_ok") == total
            sa = hitung("staff_a")
            nb = int(pg.sql_db(db, f"select count(*) from public.marketing_followup_log where branch_id='{CAB_B}';"))
            assert nb > 0 and sa == total - nb, (sa, total, nb)
            assert hitung("staff_a", f"where branch_id='{CAB_B}'") == 0
        finally:
            pg.sql_db(db, "begin; set local session_replication_role=replica; delete from role_settings_private.submenu_policies where role='STAFF'; "
                          "insert into role_settings_private.submenu_policies(role,module_id,allowed) values ('STAFF','crm',array['crm.pelanggan']); commit;")
        assert int(pg.sql_db(db, f"begin; {sesi(U['staff_no'])} select count(*) from public.marketing_followup_log; commit;").splitlines()[-1]) == 0
        assert int(pg.sql_db(db, f"begin; {sesi(U['finance'])} select count(*) from public.marketing_followup_log; commit;").splitlines()[-1]) == 0
        ditolak(None, "permission denied", "set local role anon; select count(*) from public.marketing_followup_log;")

    # ── I. ringkas, hanya baca, atribut
    @kasus("I1 ringkas: jumlah belum dihubungi per daftar sama dengan daftar; gerbang izin")
    def _():
        r = call(pg, db, "owner", "public.marketing_followup_ringkas", p_hari_ini=f"'{HARI}'")
        assert set(r) == {"lama", "grooming", "hari_ini", "baru"}, r
        assert r["lama"] == daftar(pg, db, tab="'lama'", hari=90, status="'belum'", limit=0)["total"]
        assert r["grooming"] == daftar(pg, db, tab="'grooming'", status="'belum'", limit=0)["total"]
        assert r["hari_ini"] == daftar(pg, db, tab="'hari_ini'", status="'belum'", limit=0)["total"]
        assert r["baru"] == daftar(pg, db, tab="'baru'", status="'belum'", limit=0)["total"]
        ditolak("staff_no", "MARKETING_DITOLAK", f"select public.marketing_followup_ringkas(p_hari_ini => '{HARI}');")

    @kasus("I2 hanya baca: STABLE, SECURITY DEFINER, search_path kosong; tidak mengubah tabel sumber; bawaan hari ini = tanggal WIB")
    def _():
        for fn in (DAFTAR, "public.marketing_followup_ringkas", "public.marketing_followup_allowed", "clinic_private.marketing_kandidat"):
            atr = pg.sql_db(db, f"select provolatile::text||'|'||prosecdef::text||'|'||coalesce(array_to_string(proconfig,','),'') from pg_proc where oid=(select oid from pg_proc where proname='{fn.split('.')[1]}' limit 1);")
            assert atr == 's|true|search_path=""', (fn, atr)
        snap = ("select (select md5(string_agg(t::text,'|' order by t::text)) from public.customers t)||(select md5(string_agg(t::text,'|' order by t::text)) from public.visits t)"
                "||(select md5(string_agg(t::text,'|' order by t::text)) from public.sales t)||(select md5(string_agg(t::text,'|' order by t::text)) from public.follow_ups t)"
                "||(select md5(string_agg(t::text,'|' order by t::text)) from public.marketing_followup_log t);")
        antes = pg.sql_db(db, snap)
        lama(); groom(); hari_ini()
        assert pg.sql_db(db, snap) == antes
        h = call(pg, db, "owner", DAFTAR, p_tab="'lama'")
        wib = pg.sql_db(db, "select (now() at time zone 'Asia/Jakarta')::date::text;")
        assert h["hari_ini"] == wib, (h["hari_ini"], wib)

    @kasus("I3 hak: authenticated boleh, anon tidak; fungsi/tabel/kebijakan terdaftar sesuai rancangan")
    def _():
        r = pg.sql_db(db, f"select has_function_privilege('authenticated','{DAFTAR}(text,integer,uuid,boolean,text,text,integer,integer,integer,integer,date)','execute')::text"
                          f"||'|'||has_function_privilege('anon','{DAFTAR}(text,integer,uuid,boolean,text,text,integer,integer,integer,integer,date)','execute')::text"
                          "||'|'||has_function_privilege('authenticated','public.marketing_log_contact(uuid,uuid,text,uuid,text,text,uuid)','execute')::text"
                          "||'|'||has_table_privilege('authenticated','public.marketing_followup_log','insert')::text"
                          "||'|'||has_table_privilege('authenticated','public.marketing_followup_log','select')::text"
                          "||'|'||has_table_privilege('service_role','public.marketing_followup_log','select')::text"
                          "||'|'||(select count(*) from pg_policies where tablename='marketing_followup_log')::text"
                          "||'|'||has_function_privilege('authenticated','clinic_private.marketing_kandidat(text,date,integer,integer)','execute')::text"
                          "||'|'||has_function_privilege('authenticated','clinic_private.marketing_grooming_jasa(text,text)','execute')::text;")
        assert r == "true|false|true|false|true|false|1|false|false", r

    @kasus("J1 katalog Akses Grup memuat crm.follow-up-pelanggan di modul crm (tepat satu baris)")
    def _():
        n = pg.sql_db(db, "select count(*) from role_settings_private.submenu_catalog where id='crm.follow-up-pelanggan' and module_id='crm';")
        assert n == "1", n

    @kasus("J2 atribut database: tabel log tanpa kunci asing ke pelanggan/hewan, kunci permintaan unik, RLS aktif")
    def _():
        r = pg.sql_db(db, "select (select count(*) from pg_constraint where conrelid='public.marketing_followup_log'::regclass and contype='f' and confrelid in ('public.customers'::regclass,'public.pets'::regclass))::text"
                          "||'|'||(select relrowsecurity::text from pg_class where oid='public.marketing_followup_log'::regclass)"
                          "||'|'||(select count(*) from pg_indexes where tablename='marketing_followup_log' and indexdef ilike '%unique%request_key%')::text;")
        assert r == "0|true|1", r

    return hasil


def digest(pg, db):
    return pg.sql_db(db, """select md5(string_agg(x, '|' order by x)) from (
      select p.oid::regprocedure::text||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,'') as x from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname in ('public','clinic_private','role_settings_private') and p.prokind='f' and p.proname not like 'marketing%' and p.proname not like 'guard_marketing%'
      union all select 'pol:'||schemaname||tablename||policyname||coalesce(qual,'') from pg_policies where schemaname in ('public','role_settings_private') and tablename<>'marketing_followup_log'
      union all select 'col:'||table_schema||table_name||column_name||data_type from information_schema.columns where table_schema in ('public','role_settings_private') and table_name<>'marketing_followup_log'
      union all select 'trg:'||tgrelid::regclass::text||tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text not like '%marketing_followup_log') s;""")


# nama mutan: (teks lama, teks baru) - tiap teks lama harus muncul TEPAT sekali; teks yang diwajibkan do $check$ tetap ada
ANCHORS = {
    "owner_tidak_selalu": ("if v_role = 'OWNER' then return true; end if;", "if v_role = 'OWNER' and false then return true; end if;"),
    "tanpa_kebijakan_boleh": ("    if not found then return false; end if;\n    return 'crm.follow-up-pelanggan' = any (v_allowed);", "    if not found then return true; end if;\n    return 'crm.follow-up-pelanggan' = any (v_allowed);"),
    "kebijakan_tidak_dicek": ("    return 'crm.follow-up-pelanggan' = any (v_allowed);", "    return true;"),
    "galat_kebijakan_boleh": ("  exception when others then return false;\n  end;\nend $fn$;\ncomment on function public.marketing_followup_allowed()", "  exception when others then return true;\n  end;\nend $fn$;\ncomment on function public.marketing_followup_allowed()"),
    "hp_620_tidak_dibuang": ("if d like '620%' then d := '62' || substr(d, 4);\n  elsif d like '0%'", "if false then d := '62' || substr(d, 4);\n  elsif d like '0%'"),
    "hp_terlalu_pendek_boleh": ("'^628[0-9]{7,11}$'", "'^628[0-9]{3,11}$'"),
    "hp_terlalu_panjang_boleh": ("'^628[0-9]{7,11}$'", "'^628[0-9]{7,13}$'"),
    "penjualan_batal_dihitung": ("from public.sales s where s.voided_at is null and s.customer_id is not null\n      union all\n      select v.customer_id, v.branch_id, 'Klinik'::text",
                                 "from public.sales s where s.customer_id is not null\n      union all\n      select v.customer_id, v.branch_id, 'Klinik'::text"),
    "kunjungan_arsip_dihitung": ("from public.visits v where v.archived_at is null and v.customer_id is not null\n    ),\n    agg as", "from public.visits v where v.customer_id is not null\n    ),\n    agg as"),
    "disembunyikan_ikut": ("     where c.hidden_at is null\n       and lower(btrim(c.name)) <> all (c_percobaan)\n       and case", "     where lower(btrim(c.name)) <> all (c_percobaan)\n       and case"),
    "nama_percobaan_ikut": ("     where c.hidden_at is null\n       and lower(btrim(c.name)) <> all (c_percobaan)\n       and case", "     where c.hidden_at is null\n       and case"),
    "cabang_terakhir_jadi_terlama": ("order by e.customer_id, e.t desc, e.jenis desc, e.branch_id", "order by e.customer_id, e.t asc, e.jenis desc, e.branch_id"),
    "periode_diabaikan": ("per as (select * from st0 where p_tab <> 'lama' or hari >= p_hari),", "per as (select * from st0),"),
    "batas_atas_lama_dihapus": ("c_batas_lama constant integer := 730;", "c_batas_lama constant integer := 7300;"),
    "kunjungan_terbuka_ikut": ("ok0 as (select * from kj where wa is not null and not kunjungan_terbuka and not hewan_tiada)", "ok0 as (select * from kj where wa is not null and not hewan_tiada)"),
    "hewan_tiada_ikut": ("ok0 as (select * from kj where wa is not null and not kunjungan_terbuka and not hewan_tiada)", "ok0 as (select * from kj where wa is not null and not kunjungan_terbuka)"),
    "tanpa_nomor_ikut": ("ok0 as (select * from kj where wa is not null and not kunjungan_terbuka and not hewan_tiada)", "ok0 as (select * from kj where not kunjungan_terbuka and not hewan_tiada)"),
    "tanpa_penyaring_cabang": ("     where (x.branch_id is null and v_null_ok) or x.branch_id = any (v_vis)", "     where true"),
    "tanpa_cabang_untuk_semua": ("v_null_ok := coalesce(public.user_can_access_branch(null::uuid), false);", "v_null_ok := true;"),
    "senyap_dipendekkan": ("c_senyap constant integer := 90;", "c_senyap constant integer := 1;"),
    "masa_tunggu_diabaikan": ("> v_hari - case when g.hasil in ('Tidak berminat', 'Nomor salah') then c_senyap else p_cooldown end)", "> v_hari - case when g.hasil in ('Tidak berminat', 'Nomor salah') then c_senyap else 1 end)"),
    "tidak_berminat_biasa": ("when g.hasil in ('Tidak berminat', 'Nomor salah') then c_senyap", "when g.hasil in ('Nomor salah') then c_senyap"),
    "grooming_konsultasi_dihitung": ("coalesce(p_nama, '') !~* '(konsultasi|registrasi)'", "true"),
    "grooming_sale_tanpa_tipe": ("         and (it.id is null or it.item_type in ('Jasa', 'Grup'))\n         and clinic_private.marketing_grooming_jasa(si.nama, it.tindakan_kategori)",
                                 "         and clinic_private.marketing_grooming_jasa(si.nama, it.tindakan_kategori)"),
    "grooming_obat_dihitung": ("where ii.jenis = 'jasa' and v.customer_id is not null", "where v.customer_id is not null"),
    "grooming_kategori_diabaikan": ("select p_kategori = 'Grooming'\n      or (", "select false\n      or ("),
    "jadwal_terpenuhi_diabaikan": ("(a.t at time zone 'Asia/Jakarta')::date < b.jadwal - 7", "(a.t at time zone 'Asia/Jakarta')::date < b.jadwal + 3650"),
    "seri_riwayat_dulu": ("order by g.cid, g.pid, g.t desc, (g.sumber = 'belanja') desc", "order by g.cid, g.pid, g.t desc, (g.sumber = 'belanja') asc"),
    "interval_tetap_30": ("(u.t at time zone 'Asia/Jakarta')::date + p_interval", "(u.t at time zone 'Asia/Jakarta')::date + 30"),
    "satu_hewan_tidak_dipetakan": ("coalesce(x.pid, case when h.hidup = 1 then h.satu end)", "x.pid"),
    "batas_grooming_setahun_dihapus": ("c_batas_grooming constant integer := 365;", "c_batas_grooming constant integer := 36500;"),
    "hari_ini_semua_status": ("where f.status = 'Menunggu' and f.tanggal <= p_hari_ini + p_depan and f.customer_id is not null", "where f.tanggal <= p_hari_ini + p_depan and f.customer_id is not null"),
    "hari_ini_tanpa_batas_tanggal": ("where f.status = 'Menunggu' and f.tanggal <= p_hari_ini + p_depan and f.customer_id is not null", "where f.status = 'Menunggu' and f.customer_id is not null"),
    "hari_ini_hewan_mati_ikut": ("from fu where not fu.mati group by fu.cid", "from fu group by fu.cid"),
    "baru_boleh_dua_kali": ("a.n = 1\n               and", "a.n <= 2\n               and"),
    "baru_batas_30_jadi_0": ("(p_hari_ini - (a.pertama at time zone 'Asia/Jakarta')::date) between 30 and 60", "(p_hari_ini - (a.pertama at time zone 'Asia/Jakarta')::date) between 0 and 60"),
    "log_boleh_diubah": ("create trigger marketing_followup_log_append_only before update or delete on public.marketing_followup_log", "create trigger marketing_followup_log_append_only before delete on public.marketing_followup_log"),
    "rpc_tanpa_gerbang_izin": ("language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s' as $fn$\ndeclare v_actor uuid := auth.uid(); v_catatan text; v_dup public.marketing_followup_log; v_id uuid; v_at timestamptz;\nbegin\n  if not public.marketing_followup_allowed() then",
                               "language plpgsql volatile security definer set search_path = '' set lock_timeout = '5s' as $fn$\ndeclare v_actor uuid := auth.uid(); v_catatan text; v_dup public.marketing_followup_log; v_id uuid; v_at timestamptz;\nbegin\n  if false then"),
    "rpc_tanpa_cek_cabang": ("  if not public.user_can_access_branch(p_branch_id) then\n    raise exception using errcode = '42501', message = 'MARKETING_CABANG_DITOLAK", "  if false then\n    raise exception using errcode = '42501', message = 'MARKETING_CABANG_DITOLAK"),
    "rpc_kunci_isi_beda_diterima": ("or v_dup.branch_id is distinct from p_branch_id or v_dup.hasil <> p_hasil or v_dup.catatan is distinct from v_catatan", "or false"),
    "rpc_tanpa_cek_hewan_pemilik": ("if p_pet_id is not null and not exists (select 1 from public.pets where id = p_pet_id and customer_id = p_customer_id) then", "if false then"),
    "rls_log_terbuka": ("using (public.marketing_followup_allowed() and public.user_can_access_branch(branch_id));", "using (true);"),
    "rls_log_tanpa_cabang": ("using (public.marketing_followup_allowed() and public.user_can_access_branch(branch_id));", "using (public.marketing_followup_allowed());"),
    "anon_boleh_baca": ("revoke all on function public.marketing_followup_daftar(text, integer, uuid, boolean, text, text, integer, integer, integer, integer, date) from public, anon, service_role;",
                        "revoke all on function public.marketing_followup_daftar(text, integer, uuid, boolean, text, text, integer, integer, integer, integer, date) from public, service_role;"),
    "tabel_log_bisa_ditulis_klien": ("grant select on table public.marketing_followup_log to authenticated;", "grant select, insert on table public.marketing_followup_log to authenticated;"),
    "kandidat_bisa_dipanggil_klien": ("revoke all on function clinic_private.marketing_kandidat(text, date, integer, integer) from public, anon, authenticated, service_role;", "grant execute on function clinic_private.marketing_kandidat(text, date, integer, integer) to authenticated;"),
    "cari_nama_diabaikan": ("            or k.nama ilike v_cari_like escape '\\'\n", "            or true\n"),
    "batas_per_cabang_diabaikan": ("top as (select * from rk where rn <= p_limit),", "top as (select * from rk),"),
    "urut_nilai_terbalik": ("-coalesce(c.total_spending, 0), -a.n::numeric", "coalesce(c.total_spending, 0), -a.n::numeric"),
    "wildcard_cari_tidak_diescape": ("v_cari_like := '%' || replace(replace(replace(v_cari, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%';", "v_cari_like := '%' || v_cari || '%';"),
    "bucket_180_jadi_90": ("'180', (select count(*) from st0 where hari >= 180)),", "'180', (select count(*) from st0 where hari >= 90)),"),
}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pg-bin", default=os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin"))
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--mutants", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--attach", default="")
    ap.add_argument("--json", default="")
    args = ap.parse_args()
    asli = MIGRASI.read_text()
    laporan = {"mode": "baseline" if args.baseline else "mutants" if args.mutants else "green"}
    pg_ctx = Attached(args.pg_bin, args.attach) if args.attach else DB(args.pg_bin)
    with pg_ctx as pg:
        if args.attach:
            pg.sql("drop database if exists dev with (force);")
            pg.sql("create database dev template tpl_base;")
            base = "dev"
            sebelum = None
        else:
            build_chain(pg)
            pg.sql("create database tpl_base template postgres;")
            base = "postgres"
        print("chain siap", flush=True)

        def kloning(nama, teks, fixture_ok=True):
            pg.sql(f"drop database if exists {nama} with (force);")
            pg.sql(f"create database {nama} template {'tpl_base'};")
            siapkan_fixture(pg, nama, teks)

        if args.baseline:
            kloning("run0", None)
            hasil = jalankan_kasus(pg, "run0")
            gagal = [h for h in hasil if not h[1]]
            for n, ok, _ in hasil:
                print(("PASS " if ok else "FAIL ") + n, flush=True)
            laporan.update(total=len(hasil), gagal=len(gagal))
            print(f"RED: {len(gagal)}/{len(hasil)} kasus gagal tanpa migrasi", flush=True)
        elif args.mutants:
            varian = [("kontrol", asli)]
            for nama, (lama, baru) in ANCHORS.items():
                assert asli.count(lama) == 1, f"jangkar mutan {nama} muncul {asli.count(lama)}x"
                varian.append((nama, asli.replace(lama, baru)))
            pilih = {x for x in args.only.split(",") if x}
            hasil_mutan = {}
            for i, (nama, teks) in enumerate(varian):
                if pilih and nama not in pilih and nama != "kontrol":
                    continue
                db = f"v_{i}"
                try:
                    try:
                        kloning(db, teks)
                    except RuntimeError as e:
                        hasil_mutan[nama] = {"gagal": ["PASANG: " + str(e)[:200]], "total": 0, "crash": True}
                        print(f"{'KONTROL RUSAK' if nama == 'kontrol' else 'MATI(pasang)'} {nama}", flush=True)
                        continue
                    h = jalankan_kasus(pg, db)
                    gagal = [x[0] for x in h if not x[1]]
                    hasil_mutan[nama] = {"gagal": gagal, "total": len(h)}
                    print(f"{'KONTROL' if nama == 'kontrol' else 'MUTAN'} {nama}: {len(gagal)} kasus gagal" + ("" if nama == "kontrol" else "  -> " + ("MATI" if gagal else "HIDUP!")), flush=True)
                finally:
                    pg.sql(f"drop database if exists {db} with (force);")
            hidup = [n for n, v in hasil_mutan.items() if n != "kontrol" and not v["gagal"]]
            ctrl = hasil_mutan.get("kontrol", {})
            laporan.update(mutan=hasil_mutan, hidup=hidup, kontrol_gagal=ctrl.get("gagal"))
            assert not ctrl.get("gagal"), f"kontrol harus 0 gagal: {ctrl}"
            assert not hidup, f"mutan hidup: {hidup}"
            print(f"MUTAN: {len(hasil_mutan) - 1} mutan, semua mati; kontrol 0 gagal", flush=True)
        else:
            # 'tidak ada yang lain berubah': sidik rantai tanpa migrasi vs sesudah pasang (fixture tidak mengubah fungsi/kebijakan/kolom/pemicu)
            pg.sql("drop database if exists run0 with (force); create database run0 template tpl_base;")
            sebelum = digest(pg, "run0")
            katalog_sebelum = int(pg.sql_db("run0", "select count(*) from role_settings_private.submenu_catalog;"))
            kloning("run0", asli)
            hasil = jalankan_kasus(pg, "run0")
            for n, ok, rinci in hasil:
                print(("PASS " if ok else "FAIL ") + n + (("" if ok else f"  [{rinci}]")), flush=True)
            gagal = [h for h in hasil if not h[1]]
            sesudah = digest(pg, "run0")
            tambah = int(pg.sql_db("run0", "select count(*) from role_settings_private.submenu_catalog;")) - katalog_sebelum
            ok_digest = sebelum == sesudah
            print(("PASS " if ok_digest else "FAIL ") + "M1 tidak ada fungsi/kebijakan/kolom/pemicu LAMA yang berubah (sidik sama sebelum-sesudah, tidak menghitung objek baru)", flush=True)
            print(("PASS " if tambah == 1 else "FAIL ") + f"M2 katalog Akses Grup bertambah tepat 1 baris: +{tambah}", flush=True)
            laporan.update(total=len(hasil) + 2, gagal=len(gagal) + (0 if ok_digest else 1) + (0 if tambah == 1 else 1))
            assert not gagal and ok_digest and tambah == 1, [g[0] for g in gagal]
            print(f"GREEN: {len(hasil) + 2} kasus lulus", flush=True)
    if args.json:
        Path(args.json).write_text(json.dumps(laporan, indent=1, ensure_ascii=False))
    print("SELESAI", flush=True)


if __name__ == "__main__":
    main()
