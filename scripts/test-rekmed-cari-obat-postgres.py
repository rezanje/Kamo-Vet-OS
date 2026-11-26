#!/usr/bin/env python3
"""Uji migrasi 20261213100000 (daftar_rekam_medis_halaman + p_obat: cari rekam medis menurut obat/produk diberikan)
di PostgreSQL sungguhan, data fiktif. Tidak pernah terhubung ke Production.

Babak (semua memakai SELURUH rantai migrasi repo dari nol; migrasi ini terpasang TERAKHIR seperti di hosted):
  A. migrasi jalan + idempoten; fungsi lama daftar_rekam_medis(uuid) dan SEMUA fungsi lain tidak berubah (md5), tanpa tabel/indeks baru;
     prasyarat menolak overload asing.
  B. DIFERENSIAL tanpa filter: >=300 kombinasi acak (pengguna x cabang x header x cari x tampilan x hewan x batas x offset)
     hasil fungsi baru (p_obat null / kosong / hanya koma) == fungsi LAMA (salinan definisi hosted) bit demi bit; panggilan 6 argumen bernama jalan.
  C. FILTER: tiap pengguna x p_cabang x tampilan x p_cari x ~30 istilah obat == acuan Python (daftar lama sebagai pagar RLS + peta produk
     fixture): urutan, jumlah, ringkasan, dan keping `obat_cocok` (nama, qty, sumber).
  D. Aturan: nama_obat vs nama master, huruf besar/kecil, spasi, aksen, koma (SEMUA harus ada), kata (SEMUA pada nama yang sama),
     baris ditarik (record_withdrawn) tidak dicari tetapi billing_withdrawn tetap dicari, tagihan tanpa bertaut resep dihitung, bertaut tidak ganda,
     invoice batal diabaikan, % dan _ literal, arsip hanya per hewan, paginasi + filter.
  E. RLS/pagar: STAFF/DOCTOR cabang A tidak pernah melihat cabang B; impor tanpa cabang hanya untuk dokter aktif/OWNER/ADMIN; Admin Online 0 baris;
     anon ditolak; SECURITY INVOKER, STABLE, search_path kosong, ACL, hanya 1 overload.
  F. Masukan tidak sah ditolak 22023 (panjang, istilah 1 huruf, >5 istilah, batas/offset/tampilan).
  G. MUTAN: fungsi diganti varian salah di klaster yang sama; suite cepat harus gagal untuk tiap varian.

    python3 scripts/test-rekmed-cari-obat-postgres.py [--pg-bin DIR] [--mutan] [--json out.json]
"""
import argparse
import importlib.util
import json
import os
import random
import re
import sys
import time
import unicodedata
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402


def muat(nama, berkas):
    spec = importlib.util.spec_from_file_location(nama, ROOT / "scripts" / berkas)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


lap = muat("lap", "test-laporan-operasional-penjualan-postgres.py")   # build_chain, PRELUDE
base = muat("base", "test-daftar-rekam-medis-halaman-postgres.py")    # fixture kunjungan + pengguna

MIGRASI = ROOT / "supabase/migrations/20261213100000_daftar_rekam_medis_cari_obat.sql"
SIG = "public.daftar_rekam_medis_halaman(uuid,text,text,uuid,integer,integer,text)"
SIG_LAMA = "public.daftar_rekam_medis_halaman(uuid,text,text,uuid,integer,integer)"
OWNER, ADMIN, STAFF_A, DOKTER_A = base.OWNER, base.ADMIN, base.STAFF_A, base.DOKTER_A
DOKTER_B, DOKTER_NONAKTIF, FINANCE = base.DOKTER_B, base.DOKTER_NONAKTIF, base.FINANCE
AO = "20000000-0000-4000-8000-000000000008"
CAB_A, CAB_B, V = base.CAB_A, base.CAB_B, base.V
PET_1, PET_2, PET_3 = base.PET_1, base.PET_2, base.PET_3
PENGGUNA = [("OWNER", OWNER), ("ADMIN", ADMIN), ("STAFF_A", STAFF_A), ("DOKTER_A", DOKTER_A), ("DOKTER_B", DOKTER_B),
            ("DOKTER_NONAKTIF", DOKTER_NONAKTIF), ("FINANCE", FINANCE)]
HDR = {None: None, "A": {"x-kamo-operational-branch": CAB_A}, "B": {"x-kamo-operational-branch": CAB_B}}

HITUNG = {"n": 0}


def chk(kondisi, label):
    HITUNG["n"] += 1
    if not kondisi:
        raise AssertionError(label)


def lit(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def uid(kunci):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "kamo-cari-obat/" + kunci))


# ------------------------------------------------------------------------------------------------ fixture produk
ITEM = {  # kunci -> nama master
    "rc": "RC Recovery", "icare": "Icare Can Recovery", "amox": "Amoxicillin Tab", "kafe": "Café Crème Ünique",
    "vit": "Vit 100% Sehat_X", "vsu": "Vet Special Urinary CAT", "hc": "Happy Cat Recovery 100 gr",
}
# baris resep: visit, mr (0/1), item (kunci/None), nama_obat, qty, tarik (record_withdrawn), tagih_tarik (hanya billing_withdrawn), racik
PI = [
    dict(v="a_mr", mr=0, item="rc", nama="RC Recovery", qty=2),
    dict(v="a_mr", mr=1, item="rc", nama="RC Recovery", qty=1),
    dict(v="a_mr", mr=0, item="amox", nama="Amoxicillin Tab", qty=3),
    dict(v="a_mr2", mr=0, item="icare", nama="Icare Can Recovery", qty=1, id="icare_a_mr2"),
    dict(v="a_mr2", mr=0, item="rc", nama="RC Recovery", qty=1, tarik=True),
    dict(v="a_mr2", mr=0, item=None, nama="Obat Tetes Mata", qty=1),
    dict(v="b_mr", mr=0, item="rc", nama="RC Recovery", qty=1),
    dict(v="lama1", mr=0, item="rc", nama="RC Recovery", qty=1),
    dict(v="lama2", mr=0, item=None, nama="Obat Tetes Mata", qty=2),
    dict(v="nolbukanimpor", mr=0, item="rc", nama="RC Recovery", qty=1, tagih_tarik=True),
    dict(v="a_inap", mr=0, item="kafe", nama="Café Crème Ünique", qty=1),
    dict(v="a_inap_pulang", mr=0, item=None, nama="Obat Racik Kapsul Antibiotic", qty=1, racik=True),
    dict(v="a_arsip", mr=0, item="rc", nama="RC Recovery", qty=1),
    dict(v="b_lama_cab", mr=0, item="icare", nama="Icare Can Recovery", qty=1),
    dict(v="b_lama_cab", mr=0, item="rc", nama="Pakan pemulihan", qty=4),     # nama_obat beda dari nama master
    dict(v="a_persen", mr=0, item="vit", nama="Vit 100% Sehat_X", qty=1),
    dict(v="a_persen", mr=0, item="hc", nama="Happy Cat Recovery 100 gr", qty=1),
]
# baris tagihan: visit, item, deskripsi, qty, batal (invoice voided), tertaut (ke id resep)
II = [
    dict(v="a_mr2", item="vsu", desk="Vet Special Urinary CAT", qty=1),
    dict(v="a_mr2", item="icare", desk="Icare Can Recovery", qty=1, tertaut="icare_a_mr2"),
    dict(v="b_mr", item="rc", desk="RC Recovery", qty=5, batal=True),
    dict(v="a_persen", item="rc", desk="RC Recovery", qty=2),
    dict(v="a_mr", item=None, desk="Jasa Konsultasi Grooming", qty=1),
    dict(v="a_tanpa", item="rc", desk="RC Recovery", qty=1),   # kunjungan tanpa rekam medis: tidak pernah muncul
]


def norm(s):
    s = unicodedata.normalize("NFD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def peta_produk():
    """visit-key -> [(teks_cari_ternormalisasi, nama_tampil, qty, sumber)]"""
    hasil = {}
    for p in PI:
        if p.get("tarik"):
            continue
        teks = norm(ITEM[p["item"]]) if p["item"] else norm(p["nama"])
        sumber = "racikan" if p.get("racik") else "resep"
        hasil.setdefault(p["v"], []).append((teks, p["nama"], p["qty"], sumber))
    for i in II:
        if i.get("batal") or i.get("tertaut"):
            continue
        teks = norm(ITEM[i["item"]]) if i["item"] else norm(i["desk"])
        hasil.setdefault(i["v"], []).append((teks, i["desk"], i["qty"], "tagihan"))
    return hasil


PRODUK = peta_produk()
V_ID = {v: k for k, v in V.items()}   # id visit -> kunci


def urai(obat):
    """Aturan p_obat. Mengembalikan None (tanpa filter), daftar istilah (list kata), atau 'ERR'."""
    mentah = (obat or "").strip()
    if not mentah:
        return None
    if len(mentah) > 100:
        return "ERR"
    istilah = []
    for t in mentah.split(","):
        t = re.sub(r"\s+", " ", norm(t)).strip()
        if t:
            istilah.append(t.split(" "))
    if not istilah:
        return None
    if len(istilah) > 5:
        return "ERR"
    if any(len(" ".join(k)) < 2 for k in istilah):
        return "ERR"
    return istilah


def cocok_visit(kunci_visit, istilah):
    """(cocok?, keping) — keping = baris produk yang cocok minimal satu istilah, dijumlah per (sumber, nama)."""
    produk = PRODUK.get(kunci_visit, [])
    untuk = [any(all(w in teks for w in kata) for teks, _, _, _ in produk) for kata in istilah]
    if not all(untuk):
        return False, []
    agregat = {}
    for teks, nama, qty, sumber in produk:
        if any(all(w in teks for w in kata) for kata in istilah):
            agregat[(nama, sumber)] = agregat.get((nama, sumber), 0) + qty
    return True, [{"nama": n, "qty": q, "sumber": s} for (n, s), q in sorted(agregat.items())][:20]


# ------------------------------------------------------------------------------------------------ sesi psql
def sesi(user, header=None):
    s = "begin;\nset local role authenticated;\n"
    if user is not None:
        s += f"select set_config('request.jwt.claim.sub', '{user}', true);\n"
    s += f"select set_config('request.headers', '{json.dumps(header or {})}', true);\n"
    return s


def rpc_sql(fn, cabang, cari, tampilan, pet, batas, offset, obat=None, sertakan_obat=True):
    ekspr = (f"public.{fn}(p_cabang => {lit(cabang)}::uuid, p_cari => {lit(cari)}::text, p_tampilan => {lit(tampilan)}::text,"
             f" p_pet => {lit(pet)}::uuid, p_batas => {batas}, p_offset => {offset}")
    if sertakan_obat:
        ekspr += f", p_obat => {lit(obat)}::text"
    return ekspr + ")::text"


def batch(pg, user, ekspresi, header=None):
    sql = sesi(user, header)
    for i, e in enumerate(ekspresi):
        sql += f"select 'K{i}|' || ({e});\n"
    sql += "commit;"
    keluar = pg.sql(sql)
    hasil = {}
    for baris in keluar.splitlines():
        if baris.startswith("K"):
            kode, _, isi = baris.partition("|")
            hasil[int(kode[1:])] = isi
    assert len(hasil) == len(ekspresi), keluar[:400]
    return [hasil[i] for i in range(len(ekspresi))]


def ditolak(pg, perintah, user, potongan, header=None):
    try:
        pg.sql(sesi(user, header) + perintah + "\ncommit;")
    except RuntimeError as error:
        assert potongan in str(error), str(error)[:400]
        return str(error)
    raise AssertionError(f"seharusnya ditolak: {perintah}")


# ------------------------------------------------------------------------------------------------ fixture db
def pasang_fixture(pg):
    pg.sql("set session_replication_role = replica;\n" + base.DATA)
    pg.sql(f"""set session_replication_role = replica;
      insert into auth.users(id) values ('{AO}') on conflict do nothing;
      insert into public.profiles(id, role, is_active, full_name) values ('{AO}','ADMIN_ONLINE',true,'Admin Online Uji')
        on conflict (id) do update set role = excluded.role, is_active = excluded.is_active;
      insert into public.user_branches(user_id, branch_id) values ('{AO}','{CAB_A}');
      insert into public.inpatient_records(visit_id, branch_id, created_at, condition_status, discharged_at) values
        ('{V['a_inap']}', '{CAB_A}', '2026-01-05T02:00:00Z', 'stabil', null),
        ('{V['a_inap_pulang']}', '{CAB_A}', '2026-01-06T02:00:00Z', 'stabil', '2026-01-06T05:00:00Z');
      update public.visits set archived_at = '2026-01-07T02:00:00Z', archived_by = '{OWNER}', archive_reason = 'Draf uji arsip'
       where id = '{V['a_arsip']}';
      insert into public.medical_records(id, visit_id, diagnosis) values ('{uid('mr2-a_mr')}', '{V['a_mr']}', 'Dx A tambahan');
      insert into public.items(id, code, name, item_type, is_active) values
        {", ".join(f"('{uid('item-' + k)}', 'COBA-{k.upper()}', {lit(n)}, 'Persediaan', true)" for k, n in ITEM.items())};""")
    mr = {}
    for baris in pg.sql("select visit_id || '|' || id from public.medical_records order by visit_id, created_at, id;").splitlines():
        v, _, m = baris.partition("|")
        mr.setdefault(V_ID[v], []).append(m)
    chk(len(mr["a_mr"]) == 2, "a_mr punya dua rekam medis")
    rows, racik = [], ""
    for n, p in enumerate(PI):
        pid = uid("pi-" + p.get("id", str(n)))
        resep = f"'{uid('recipe-' + str(n))}'" if p.get("racik") else "null"
        if p.get("racik"):
            racik += (f"insert into public.compounding_recipes(id, medical_record_id, recipe_name) values ({resep}, '{mr[p['v']][0]}', 'Racik uji');"
                      f"insert into public.compounding_ingredients(recipe_id, ingredient_name, quantity, unit, item_id) values"
                      f" ({resep}, 'Amoxicillin Tab', 1, 'tab', '{uid('item-amox')}');")
        item = f"'{uid('item-' + p['item'])}'" if p["item"] else "null"
        tarik = "now()" if (p.get("tarik") or p.get("tagih_tarik")) else "null"
        rec = "now()" if p.get("tarik") else "null"
        rows.append(f"('{pid}', '{mr[p['v']][p['mr']]}', {lit(p['nama'])}, {p['qty']}, 'obat', {item}, {resep}, {rec}, {tarik})")
    pg.sql("set session_replication_role = replica;\n" + racik
           + "insert into public.prescription_items(id, medical_record_id, nama_obat, qty, jenis, item_id, compound_recipe_id,"
             " record_withdrawn_at, billing_withdrawn_at) values\n" + ",\n".join(rows) + ";")
    inv, ii = [], []
    for n, i in enumerate(II):
        iid = uid("inv-" + str(n))
        inv.append(f"('{iid}', '{V[i['v']]}', 1000, {'now()' if i.get('batal') else 'null'})")
        item = f"'{uid('item-' + i['item'])}'" if i["item"] else "null"
        tert = f"'{uid('pi-' + i['tertaut'])}'" if i.get("tertaut") else "null"
        ii.append(f"('{uid('ii-' + str(n))}', '{iid}', {lit(i['desk'])}, {i['qty']}, 1000, {item}, {tert})")
    pg.sql("set session_replication_role = replica;\ninsert into public.invoices(id, visit_id, total, voided_at) values\n" + ",\n".join(inv)
           + ";\ninsert into public.invoice_items(id, invoice_id, deskripsi, qty, harga, item_id, prescription_item_id) values\n" + ",\n".join(ii) + ";")
    # PostgREST/RLS tidak peduli statistik, tetapi planner: analyze.
    pg.sql("analyze;")


def teks_fungsi(sumber):
    a = sumber.index("create or replace function public.daftar_rekam_medis_halaman(")
    b = sumber.index("\n$$;", a) + len("\n$$;")
    return sumber[a:b]


def snapshot_lama(pg):
    d = pg.sql(f"select pg_get_functiondef('{SIG_LAMA}'::regprocedure);")
    d = d.replace("public.daftar_rekam_medis_halaman(", "public.zz_old_halaman(", 1)
    pg.sql(d + ";\ngrant execute on function public.zz_old_halaman(uuid,text,text,uuid,integer,integer) to authenticated;")


# ------------------------------------------------------------------------------------------------ pemeriksaan
ISTILAH_UJI = [
    "RC Recovery", "rc recovery", "  RC   RECOVERY  ", "recovery rc", "recovery", "rc recovery, icare", "icare, rc recovery",
    "rc recovery,icare", "cafe creme", "CAFÉ CRÈME", "ünique", "amoxicillin", "vit 100%", "100%", "_x", "%%", "obat tetes",
    "racik", "antibiotic", "grooming", "vet special", "pakan", "rekov", "xx-tidak-ada", "re, rc", "rc,", "  ,  ", " ,rc recovery, ,",
    "recovery, amoxicillin", "icare recovery, vit, rc", "happy cat",
]


def acuan_baseline(pg, user, header, cabang, cari, tampilan, pet):
    """Daftar lama (RLS pemanggil) tanpa filter obat: urutan + ringkasan."""
    raw = batch(pg, user, [rpc_sql("zz_old_halaman", cabang, cari, tampilan, pet, 200, 0, sertakan_obat=False)], header)[0]
    return json.loads(raw)


def periksa_filter(pg, user, header, cabang, tampilan, cari, pet=None, istilah_list=ISTILAH_UJI, hitung=True):
    lama = acuan_baseline(pg, user, header, cabang, cari, tampilan, pet)
    ids_lama = [b["id"] for b in lama["baris"]]
    panggilan = [rpc_sql("daftar_rekam_medis_halaman", cabang, cari, tampilan, pet, 200, 0, t) for t in istilah_list]
    keluar = batch(pg, user, panggilan, header) if panggilan else []
    kosong = berisi = 0
    for obat, raw in zip(istilah_list, keluar):
        r = json.loads(raw)
        istilah = urai(obat)
        assert istilah != "ERR", obat
        if istilah is None:
            harap_ids, harap_keping = ids_lama, None
        else:
            harap_ids, harap_keping = [], {}
            for vid in ids_lama:
                ok, keping = cocok_visit(V_ID[vid], istilah)
                if ok:
                    harap_ids.append(vid)
                    harap_keping[vid] = keping
        label = f"{user[-1]} hdr={header and list(header.values())[0][0]} cab={cabang and cabang[0]} {tampilan} cari={cari!r} pet={pet and pet[-1]} obat={obat!r}"
        ids = [b["id"] for b in r["baris"]]
        chk(ids == harap_ids, f"urutan/isi beda: {label}\nRPC={[V_ID[i] for i in ids]}\nACUAN={[V_ID[i] for i in harap_ids]}") if hitung else None
        assert ids == harap_ids, f"urutan/isi beda: {label}\nRPC={[V_ID[i] for i in ids]}\nACUAN={[V_ID[i] for i in harap_ids]}"
        assert r["jumlah"] == len(harap_ids), (label, r["jumlah"])
        assert r["ringkasan"] == lama["ringkasan"], ("ringkasan berubah", label)
        for b in r["baris"]:
            if harap_keping is None:
                assert "obat_cocok" not in b, ("kunci obat_cocok muncul tanpa filter", label)
            else:
                assert b["obat_cocok"] == harap_keping[b["id"]], (label, V_ID[b["id"]], b["obat_cocok"], harap_keping[b["id"]])
        kosong += not ids
        berisi += bool(ids)
    return kosong, berisi


def atribut_dan_acl(pg):
    a = pg.last(f"select prosecdef::text||'|'||provolatile::text||'|'||array_to_string(proconfig,',')||'|'||"
                f"(select count(*) from pg_proc where proname='daftar_rekam_medis_halaman' and pronamespace='public'::regnamespace)::text||'|'||"
                f"has_function_privilege('anon','{SIG}','execute')::text||'|'||has_function_privilege('authenticated','{SIG}','execute')::text||'|'||"
                f"has_function_privilege('public','{SIG}','execute')::text||'|'||coalesce(to_regprocedure('{SIG_LAMA}')::text,'tidak ada')"
                f" from pg_proc where oid='{SIG}'::regprocedure;")
    return a


ATRIBUT_HARAP = 'false|s|search_path=""|1|false|true|false|tidak ada'


def diferensial(pg, seed, jumlah, variasi_obat=(None,)):
    rng = random.Random(seed)
    cari_pool = [None, "", "budi", " BUDI ", "08", "bruno", "mochi", "%", "_", "kiko", "tidak-ada", "ani"]
    total = 0
    for nama, user in PENGGUNA + [("AO", AO)]:
        per = max(1, jumlah // 8)
        kombinasi = []
        for _ in range(per):
            kombinasi.append((rng.choice([None, CAB_A, CAB_B, uid("cab-lain")]), rng.choice(cari_pool), rng.choice(["semua", "rawat-jalan"]),
                              rng.choice([None, None, PET_1, PET_2, PET_3]), rng.choice([1, 2, 3, 5, 50, 200]), rng.choice([0, 0, 1, 2, 4, 9, 40]),
                              rng.choice([None, "A", "B"])))
        for h in (None, "A", "B"):
            sub = [k for k in kombinasi if k[6] == h] if h is not None else [k for k in kombinasi if k[6] is None]
            if not sub:
                continue
            lama = batch(pg, user, [rpc_sql("zz_old_halaman", c, ca, t, p, b, o, sertakan_obat=False) for c, ca, t, p, b, o, _ in sub], HDR[h])
            for obat in variasi_obat:
                baru = batch(pg, user, [rpc_sql("daftar_rekam_medis_halaman", c, ca, t, p, b, o, obat) for c, ca, t, p, b, o, _ in sub], HDR[h])
                for k, x, y in zip(sub, lama, baru):
                    assert x == y, f"BEDA dari fungsi lama: user={nama} {k} obat={obat!r}\nlama={x[:300]}\nbaru={y[:300]}"
                    total += 1
    # panggilan 6 argumen posisional + bernama (tanpa p_obat) jalan dan sama dengan lama
    o6 = batch(pg, OWNER, ["public.daftar_rekam_medis_halaman(null, null, 'semua', null, 50, 0)::text",
                           "public.daftar_rekam_medis_halaman(p_cabang => null, p_tampilan => 'semua', p_batas => 50)::text",
                           "public.zz_old_halaman(null, null, 'semua', null, 50, 0)::text"])
    assert o6[0] == o6[1] == o6[2], "panggilan 6 argumen tidak sama dengan lama"
    return total + 2


# ------------------------------------------------------------------------------------------------ suite
def suite_cepat(pg):
    """Dipakai untuk membunuh mutan: ringkas tetapi mencakup tiap perilaku."""
    assert atribut_dan_acl(pg) == ATRIBUT_HARAP, atribut_dan_acl(pg)
    diferensial(pg, 7, 40, variasi_obat=(None, "", "  ,  "))
    for user, header, cabang, tampilan, cari in ((OWNER, None, None, "semua", None), (OWNER, None, None, "semua", "budi"),
                                                  (OWNER, None, CAB_A, "rawat-jalan", None), (DOKTER_A, None, CAB_A, "semua", None),
                                                  (STAFF_A, None, None, "semua", None), (OWNER, None, None, "rawat-jalan", "ani")):
        periksa_filter(pg, user, header, cabang, tampilan, cari, hitung=False)
    periksa_filter(pg, OWNER, None, None, "semua", None, pet=PET_1, hitung=False)
    for perintah, potongan in (("select public.daftar_rekam_medis_halaman(null,null,'semua',null,50,0,'" + "x" * 101 + "');", "terlalu panjang"),
                               ("select public.daftar_rekam_medis_halaman(null,null,'semua',null,50,0,'r');", "minimal 2"),
                               ("select public.daftar_rekam_medis_halaman(null,null,'semua',null,50,0,'aa,bb,cc,dd,ee,ff');", "maksimal 5")):
        ditolak(pg, perintah, OWNER, potongan)
    ao = json.loads(batch(pg, AO, [rpc_sql("daftar_rekam_medis_halaman", None, None, "semua", None, 50, 0, "rc recovery")])[0])
    assert ao["jumlah"] == 0 and ao["baris"] == [], "Admin Online melihat baris"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pg-bin", default=os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin"))
    parser.add_argument("--mutan", action="store_true")
    parser.add_argument("--json", default=None)
    parser.add_argument("--only", default="")
    parser.add_argument("--lewati-bc", action="store_true", help="hanya untuk pengembangan: lewati babak B dan C")
    args = parser.parse_args()
    asli = MIGRASI.read_text()
    laporan = {}
    with NativePostgres(args.pg_bin) as pg:
        lap.build_chain(pg, {MIGRASI.name})
        pg.sql(lap.PRELUDE)
        pasang_fixture(pg)
        snapshot_lama(pg)
        sebelum = {
            "fungsi": pg.last("select md5(string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''), E'\\n' order by p.oid::regprocedure::text))"
                              " from pg_proc p where p.pronamespace in ('public'::regnamespace) and p.prokind='f'"
                              " and p.proname not in ('daftar_rekam_medis_halaman','zz_old_halaman')"),
            "lama_fn": pg.last("select md5(pg_get_functiondef('public.daftar_rekam_medis(uuid)'::regprocedure)) from pg_proc limit 1"),
            "objek": pg.last("select count(*)::text||'|'||(select count(*) from pg_indexes where schemaname='public')::text||'|'||(select count(*) from pg_trigger where not tgisinternal)::text"
                             " from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v','m','S')"),
            "kebijakan": pg.last("select count(*)::text||'|'||md5(string_agg(polname||polrelid::regclass::text, ',' order by polname, polrelid::regclass::text)) from pg_policy"),
        }
        # ---------------------------------------------------------------- A
        # prasyarat menolak overload asing (transaksi dibatalkan)
        galat = pg.sql("begin; create function public.daftar_rekam_medis_halaman(integer) returns integer language sql as 'select 1';\n" + asli + "\nrollback;") if False else None
        try:
            pg.sql("begin; create function public.daftar_rekam_medis_halaman(integer) returns integer language sql as 'select 1';\n" + asli + "\nrollback;")
            raise AssertionError("migrasi seharusnya menolak overload asing")
        except RuntimeError as error:
            chk("overload lain" in str(error), "prasyarat overload asing: " + str(error)[:200])
        chk(atribut_dan_acl_sebelum(pg) == "ada", "tanda tangan lama ada sebelum migrasi")
        pg.sql("begin;\n" + asli + "\ncommit;")
        pg.sql("begin;\n" + asli + "\ncommit;")
        chk(True, "migrasi dua kali (idempoten) tanpa galat")
        chk(atribut_dan_acl(pg) == ATRIBUT_HARAP, "atribut/ACL: " + atribut_dan_acl(pg))
        sesudah_fungsi = pg.last("select md5(string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''), E'\\n' order by p.oid::regprocedure::text))"
                                 " from pg_proc p where p.pronamespace in ('public'::regnamespace) and p.prokind='f'"
                                 " and p.proname not in ('daftar_rekam_medis_halaman','zz_old_halaman')")
        chk(sesudah_fungsi == sebelum["fungsi"], "fungsi lain di schema public berubah")
        chk(pg.last("select md5(pg_get_functiondef('public.daftar_rekam_medis(uuid)'::regprocedure)) from pg_proc limit 1") == sebelum["lama_fn"], "fungsi lama daftar_rekam_medis(uuid) berubah")
        chk(pg.last("select count(*)::text||'|'||(select count(*) from pg_indexes where schemaname='public')::text||'|'||(select count(*) from pg_trigger where not tgisinternal)::text"
                    " from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v','m','S')") == sebelum["objek"], "tabel/indeks/pemicu baru muncul")
        chk(pg.last("select count(*)::text||'|'||md5(string_agg(polname||polrelid::regclass::text, ',' order by polname, polrelid::regclass::text)) from pg_policy") == sebelum["kebijakan"], "kebijakan RLS berubah")
        chk(pg.last("select count(*) from pg_depend d join pg_proc p on p.oid=d.objid where d.classid='pg_proc'::regclass and d.refobjsubid=0 and p.proname='daftar_rekam_medis_halaman' and d.deptype='e'") == "0", "fungsi anggota ekstensi")
        print(f"PASS A: rantai repo penuh dari nol + migrasi terakhir, idempoten; fungsi lain, daftar_rekam_medis(uuid), tabel/indeks/pemicu/kebijakan tidak berubah; overload asing ditolak [{HITUNG['n']} cek]", flush=True)

        # ---------------------------------------------------------------- B
        t0 = time.monotonic()
        n_dif = 0 if args.lewati_bc else diferensial(pg, 20261126, 320, variasi_obat=(None, "", "   ", ",", " , , "))
        chk(args.lewati_bc or n_dif >= 100 * 5, f"diferensial terlalu sedikit: {n_dif}")
        HITUNG["n"] += n_dif
        print(f"PASS B: diferensial {n_dif} perbandingan baru(p_obat null/kosong/spasi/koma) == fungsi lama bit demi bit; 6 argumen jalan ({time.monotonic() - t0:.0f} dtk)", flush=True)

        # ---------------------------------------------------------------- C
        total_kosong = total_isi = 0
        n0 = HITUNG["n"]
        for nama, user in ([] if args.lewati_bc else PENGGUNA):
            for h in ("A", None):
                for cabang in (None, CAB_A, CAB_B):
                    for tampilan in ("semua", "rawat-jalan"):
                        for cari in (None, "budi"):
                            if h == "A" and (cabang is not None):   # header cabang aktif hanya dipakai tanpa p_cabang? uji keduanya secukupnya
                                continue
                            k, i = periksa_filter(pg, user, HDR[h], cabang, tampilan, cari)
                            total_kosong += k
                            total_isi += i
                            HITUNG["n"] += len(ISTILAH_UJI)
        for pet in (PET_1, PET_2, PET_3):
            for user in (OWNER, DOKTER_A, STAFF_A):
                periksa_filter(pg, user, None, None, "semua", None, pet=pet)
                HITUNG["n"] += len(ISTILAH_UJI)
        print(f"PASS C: {HITUNG['n'] - n0} perbandingan (pengguna x header x cabang x tampilan x cari x hewan x istilah) == acuan; {total_isi} berisi, {total_kosong} kosong", flush=True)

        # ---------------------------------------------------------------- D (contoh eksplisit)
        def ids_obat(user, obat, cabang=None, tampilan="semua", cari=None, pet=None, header=None):
            r = json.loads(batch(pg, user, [rpc_sql("daftar_rekam_medis_halaman", cabang, cari, tampilan, pet, 200, 0, obat)], header)[0])
            return [V_ID[b["id"]] for b in r["baris"]], r

        ids, r = ids_obat(OWNER, "RC Recovery")
        # a_mr (resep), b_mr, lama1, b_lama_cab (nama beda tetapi master RC), nolbukanimpor (billing_withdrawn tetap), a_persen (tagihan)
        chk(set(ids) == {"a_persen", "a_mr", "nolbukanimpor", "b_mr", "lama1", "b_lama_cab"} and len(ids) == 6, f"RC Recovery: {ids}")
        chk("a_mr2" not in ids, "baris ditarik dari rekam medis (record_withdrawn) tidak dicari")
        chk("a_arsip" not in ids and "a_tanpa" not in ids, "arsip hanya per hewan; kunjungan tanpa rekam medis tidak muncul")
        chk(r["jumlah"] == 6 and len(r["baris"]) == 6, "jumlah RC Recovery")
        kep = {V_ID[b["id"]]: b["obat_cocok"] for b in r["baris"]}
        chk(kep["a_mr"] == [{"nama": "RC Recovery", "qty": 3, "sumber": "resep"}], f"qty dijumlah per produk (2+1) dua rekam medis: {kep['a_mr']}")
        chk(kep["a_persen"] == [{"nama": "RC Recovery", "qty": 2, "sumber": "tagihan"}], f"tagihan tanpa resep: {kep['a_persen']}")
        chk(kep["b_lama_cab"] == [{"nama": "Pakan pemulihan", "qty": 4, "sumber": "resep"}], f"nama tampil = nama_obat, cocok lewat master: {kep['b_lama_cab']}")
        chk(kep["nolbukanimpor"] == [{"nama": "RC Recovery", "qty": 1, "sumber": "resep"}], "billing_withdrawn tetap tampil")
        chk(ids_obat(OWNER, "rc recovery")[0] == ids and ids_obat(OWNER, "  RC   RECOVERY ")[0] == ids and ids_obat(OWNER, "recovery rc")[0] == ids,
            "huruf besar/kecil, spasi ganda, urutan kata tidak berpengaruh")
        chk(set(ids_obat(OWNER, "recovery")[0]) == set(ids) | {"a_mr2"} , "recovery juga cocok Icare/Happy Cat (a_mr2 lewat Icare Can Recovery)")
        chk(set(ids_obat(OWNER, "cafe creme")[0]) == {"a_inap"} and set(ids_obat(OWNER, "CAFÉ CRÈME")[0]) == {"a_inap"} and set(ids_obat(OWNER, "ünique")[0]) == {"a_inap"},
            "aksen: dengan/tanpa aksen sama")
        chk(ids_obat(OWNER, "cafe creme", tampilan="rawat-jalan")[0] == [], "rawat inap aktif tidak tampil di rawat-jalan")
        chk(set(ids_obat(OWNER, "rc recovery, icare")[0]) == {"b_lama_cab"}, "koma = KEDUANYA (rc recovery DAN icare)")
        chk(set(ids_obat(OWNER, "icare, rc recovery")[0]) == {"b_lama_cab"}, "koma urutan tidak berpengaruh")
        chk(set(ids_obat(OWNER, "amoxicillin")[0]) == {"a_mr"}, "isi racikan TIDAK dicari (batasan terdokumentasi); a_mr lewat resep Amoxicillin")
        chk(set(ids_obat(OWNER, "racik")[0]) == {"a_inap_pulang"}, "nama racikan dicari")
        chk(ids_obat(OWNER, "racik")[1]["baris"][0]["obat_cocok"] == [{"nama": "Obat Racik Kapsul Antibiotic", "qty": 1, "sumber": "racikan"}], "sumber racikan")
        chk(set(ids_obat(OWNER, "obat tetes")[0]) == {"a_mr2", "lama2"}, "tanpa master: nama_obat")
        chk(set(ids_obat(OWNER, "grooming")[0]) == {"a_mr"}, "tagihan tanpa master (deskripsi saja)")
        chk(set(ids_obat(OWNER, "vet special")[0]) == {"a_mr2"}, "tagihan lewat master tidak bertaut resep")
        chk(ids_obat(OWNER, "vet special")[1]["baris"][0]["obat_cocok"] == [{"nama": "Vet Special Urinary CAT", "qty": 1, "sumber": "tagihan"}], "chip tagihan")
        chk([k for b in ids_obat(OWNER, "icare")[1]["baris"] for k in b["obat_cocok"] if V_ID[b["id"]] == "a_mr2"] == [{"nama": "Icare Can Recovery", "qty": 1, "sumber": "resep"}], "a_mr2 Icare tepat sekali (tidak ganda dari tagihan)")
        chk("b_mr" in ids_obat(OWNER, "rc recovery")[0], "b_mr cocok lewat resep walau invoice batal")
        pet1 = ids_obat(OWNER, "rc recovery", pet=PET_1)[0]
        chk("a_arsip" in pet1 and "lama1" in pet1 and "a_mr" in pet1 and "b_mr" in pet1, f"per hewan: arsip ikut: {pet1}")
        chk(set(ids_obat(OWNER, "vit 100%")[0]) == {"a_persen"} and set(ids_obat(OWNER, "_x")[0]) == {"a_persen"}, "% dan _ literal")
        chk(ids_obat(OWNER, "%%")[0] == [] and ids_obat(OWNER, "__")[0] == [], "wildcard tidak berlaku")
        chk(ids_obat(OWNER, "rekov")[0] == [] and ids_obat(OWNER, "pakan")[0] == [], "nama_obat yang beda dari master (bertaut master) tidak dicari: batasan terdokumentasi")
        chk(ids_obat(OWNER, "rc,")[1]["jumlah"] == ids_obat(OWNER, "rc")[1]["jumlah"], "koma di ujung diabaikan")
        chk(ids_obat(OWNER, "  ,  ")[1]["jumlah"] == 10 and "obat_cocok" not in ids_obat(OWNER, "  ,  ")[1]["baris"][0], "hanya koma = tanpa filter")
        gabung = ids_obat(OWNER, "rc recovery", cari="BUDI")[0]
        chk(set(gabung) == {"a_mr", "b_mr", "lama1"} and len(gabung) == 3, f"cari pemilik + obat digabung (AND): {gabung}")
        chk(ids_obat(OWNER, "rc recovery", cari="bruno")[0] == ["nolbukanimpor"], "cari nama hewan + obat")
        chk(set(ids_obat(OWNER, "rc recovery", cari="0833")[0]) == {"b_lama_cab", "a_persen"}, "cari telepon + obat")
        chk(set(ids_obat(OWNER, "rc recovery", cabang=CAB_A)[0]) == {"a_mr", "a_persen", "lama1"}, f"p_cabang A + impor tanpa cabang: {ids_obat(OWNER, 'rc recovery', cabang=CAB_A)[0]}")
        chk(set(ids_obat(OWNER, "rc recovery", cabang=CAB_B)[0]) == {"b_mr", "b_lama_cab", "lama1"}, "p_cabang B + impor tanpa cabang")
        # paginasi + filter
        halaman, off = [], 0
        while True:
            rr = json.loads(batch(pg, OWNER, [rpc_sql("daftar_rekam_medis_halaman", None, None, "semua", None, 2, off, "recovery")])[0])
            halaman += [b["id"] for b in rr["baris"]]
            off += 2
            if off >= rr["jumlah"]:
                break
        chk(len(halaman) == len(set(halaman)) == rr["jumlah"] == len(ids_obat(OWNER, "recovery")[0]), "paginasi + filter: tanpa tumpang tindih, lengkap")
        r_besar = json.loads(batch(pg, OWNER, [rpc_sql("daftar_rekam_medis_halaman", None, None, "semua", None, 5, 500, "recovery")])[0])
        chk(r_besar["baris"] == [] and r_besar["jumlah"] > 0, "offset di luar = kosong, jumlah benar")
        print(f"PASS D: aturan filter (nama/master, huruf, spasi, aksen, koma, kata, ditarik, tagihan, batal, %/_, arsip, paginasi) [{HITUNG['n']} cek]", flush=True)

        # ---------------------------------------------------------------- E
        for user, hdr in ((STAFF_A, None), (STAFF_A, HDR["A"]), (DOKTER_NONAKTIF, None)):
            for cabang in (None, CAB_A, CAB_B):
                got, _ = ids_obat(user, "recovery", cabang=cabang, header=hdr)
                chk(not set(got) & {"b_mr", "b_lama_cab", "lama1", "lama2", "nolbukanimpor"}, f"STAFF/dokter nonaktif melihat cabang B/impor: {user[-1]} {got}")
        for hdr in (None, HDR["A"]):
            got, _ = ids_obat(DOKTER_A, "recovery", header=hdr)
            chk(not set(got) & {"b_mr", "b_lama_cab", "nolbukanimpor"} and "lama1" in got, f"DOKTER A (impor terbaca dokter aktif): {got}")
        got_a = ids_obat(DOKTER_A, "rc recovery", cabang=CAB_B)[0]
        chk(not set(got_a) & {"b_mr", "b_lama_cab"}, "DOKTER A dengan p_cabang B tidak melihat cabang B")
        chk(set(ids_obat(DOKTER_B, "rc recovery")[0]) == {"b_mr", "b_lama_cab", "lama1"}, f"DOKTER B: cabang B + impor, tidak cabang A: {ids_obat(DOKTER_B, 'rc recovery')[0]}")
        chk(set(ids_obat(STAFF_A, "rc recovery")[0]) == {"a_mr", "a_persen"}, f"STAFF A: {ids_obat(STAFF_A, 'rc recovery')[0]}")
        for user in (OWNER, ADMIN, FINANCE):
            chk({"a_mr", "b_mr", "a_persen"} <= set(ids_obat(user, "rc recovery")[0]), f"{user[-1]} melihat lintas cabang")
        ao = json.loads(batch(pg, AO, [rpc_sql("daftar_rekam_medis_halaman", None, None, "semua", None, 50, 0, "rc recovery")])[0])
        ao2 = json.loads(batch(pg, AO, [rpc_sql("daftar_rekam_medis_halaman", CAB_A, None, "semua", None, 50, 0, None)])[0])
        chk(ao["jumlah"] == 0 and ao["baris"] == [] and ao2["jumlah"] == 0 and ao2["ringkasan"]["riwayat"] == 0, "ADMIN_ONLINE ditolak pagar (0 baris, dengan/tanpa filter)")
        chk(pg.last(sesi(AO) + "select count(*) from public.prescription_items;\ncommit;") == "0", "ADMIN_ONLINE tidak membaca prescription_items (pagar tabel)")
        try:
            pg.sql("begin; set local role anon; select public.daftar_rekam_medis_halaman(null,null,'semua',null,50,0,'rc recovery'); commit;")
            raise AssertionError("anon seharusnya ditolak")
        except RuntimeError as error:
            chk("permission denied" in str(error), "anon ditolak: " + str(error)[:120])
        chk(atribut_dan_acl(pg) == ATRIBUT_HARAP, "INVOKER, STABLE, search_path kosong, ACL, 1 overload")
        # tidak ada baris di luar SELECT biasa pemanggil
        for nama, user in PENGGUNA:
            terlihat = set(json.loads(pg.last(sesi(user) + "select coalesce(jsonb_agg(id),'[]')::text from public.visits;\ncommit;")))
            got, _ = ids_obat(user, "recovery")
            chk({V[k] for k in got} <= terlihat, f"{nama} melihat lebih dari SELECT biasa")
        # fungsi tidak menulis apa pun (transaksi read-only)
        pg.sql(sesi(OWNER) + "set transaction read only;\nselect public.daftar_rekam_medis_halaman(null,null,'semua',null,50,0,'rc recovery');\ncommit;")
        chk(True, "jalan di transaksi read-only")
        print(f"PASS E: RLS (STAFF/DOKTER/OWNER/ADMIN/FINANCE), impor, Admin Online 0 baris, anon ditolak, atribut/ACL [{HITUNG['n']} cek]", flush=True)

        # ---------------------------------------------------------------- F
        for perintah, potongan, label in (
                ("select public.daftar_rekam_medis_halaman(null,null,'semua',null,50,0,'" + "x" * 101 + "');", "terlalu panjang", "101 huruf"),
                ("select public.daftar_rekam_medis_halaman(null,null,'semua',null,50,0,'r');", "minimal 2", "1 huruf"),
                ("select public.daftar_rekam_medis_halaman(null,null,'semua',null,50,0,'rc recovery, a');", "minimal 2", "istilah kedua 1 huruf"),
                ("select public.daftar_rekam_medis_halaman(null,null,'semua',null,50,0,'aa,bb,cc,dd,ee,ff');", "maksimal 5", "6 istilah"),
                ("select public.daftar_rekam_medis_halaman(null,null,'lain',null,50,0,'rc recovery');", "tampilan", "tampilan"),
                ("select public.daftar_rekam_medis_halaman(null,null,'semua',null,0,0,'rc recovery');", "batas", "batas"),
                ("select public.daftar_rekam_medis_halaman(null,null,'semua',null,50,-1,'rc recovery');", "offset", "offset")):
            ditolak(pg, perintah, OWNER, potongan)
            chk(True, "ditolak: " + label)
        kode = pg.sql("""do $t$ begin begin perform public.daftar_rekam_medis_halaman(null,null,'semua',null,50,0,'r');
                         raise exception 'TIDAK_DITOLAK'; exception when sqlstate '22023' then null; end; end $t$; select 'ok';""")
        chk(kode.splitlines()[-1] == "ok", "kode SQLSTATE 22023")
        chk(len(json.loads(batch(pg, OWNER, [rpc_sql("daftar_rekam_medis_halaman", None, None, "semua", None, 50, 0, "x" * 100)])[0])["baris"]) == 0, "100 huruf persis diterima")
        print(f"PASS F: masukan tidak sah ditolak 22023 (panjang, istilah, jumlah istilah, batas, offset, tampilan) [{HITUNG['n']} cek]", flush=True)

        # ---------------------------------------------------------------- G mutan
        laporan["cek"] = HITUNG["n"]
        if args.mutan:
            fungsi_asli = teks_fungsi(asli)
            NORM_DARI = "'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ'"
            MUTAN = [
                ("baris record_withdrawn ikut dicari", "pi.record_withdrawn_at is null", "true"),
                ("aksen tidak dinormalkan", NORM_DARI, "'ÿ'"),
                ("tanpa lower (huruf besar/kecil)", "lower(translate(", "(translate("),
                ("koma = ATAU (bukan semua istilah)", "having count(distinct c.n) = (select count(*) from istilah)", "having count(distinct c.n) >= 1"),
                ("kata = ATAU (bukan semua kata)", "join istilah i on not exists (select 1 from unnest(i.kata) w where strpos(b.f, w) = 0)",
                 "join istilah i on exists (select 1 from unnest(i.kata) w where strpos(b.f, w) > 0)"),
                ("SECURITY DEFINER", "stable security invoker", "stable security definer"),
                ("tagihan tidak dicari", "where v_istilah is not null and i0.item_id = any(", "where false and i0.item_id = any("),
                ("tagihan tanpa master tidak dicari", "where v_istilah is not null and i0.item_id is null", "where false and i0.item_id is null"),
                ("invoice batal ikut", "inv.voided_at is null", "true"),
                ("tagihan bertaut resep ikut (ganda)", "and i0.prescription_item_id is null and i0.compound_recipe_id is null offset 0) ii\n            join public.items it",
                 "and i0.compound_recipe_id is null offset 0) ii\n            join public.items it"),
                ("p_cari diabaikan", "where (p_tampilan = 'semua'\n              or not exists (select 1 from public.inpatient_records i where i.visit_id = l.id and i.discharged_at is null))\n         and (v_cari is null",
                 "where (p_tampilan = 'semua'\n              or not exists (select 1 from public.inpatient_records i where i.visit_id = l.id and i.discharged_at is null))\n         and (true"),
                ("tampilan rawat-jalan diabaikan", "where (p_tampilan = 'semua'\n", "where (true\n"),
                ("qty tidak dijumlah", "sum(c.qty) as qty", "max(c.qty) as qty"),
                ("keping obat_cocok hilang", "case when v_istilah is null then '{}'::jsonb else jsonb_build_object('obat_cocok'", "case when true then '{}'::jsonb else jsonb_build_object('obat_cocok'"),
                ("kunci obat_cocok selalu ada (beda dari lama)", "case when v_istilah is null then '{}'::jsonb else jsonb_build_object('obat_cocok'",
                 "case when false then '{}'::jsonb else jsonb_build_object('obat_cocok'"),
                ("batas minimal 2 huruf dilonggarkan", "length(t) < 2", "length(t) < 0"),
                ("batas panjang 100 dilonggarkan", "length(v_obat_mentah) > 100", "length(v_obat_mentah) > 1000"),
                ("batas 5 istilah dilonggarkan", "array_length(v_istilah, 1) > 5", "array_length(v_istilah, 1) > 50"),
                ("resep tanpa master tidak dicari", "where v_istilah is not null and pi.item_id is null and pi.record_withdrawn_at is null",
                 "where false and pi.item_id is null and pi.record_withdrawn_at is null"),
                ("jalur master produk dimatikan", "pi.item_id = any(coalesce(v_item_ids, array[]::uuid[]))", "false"),
                ("urutan hasil terbalik", "order by s.created_at desc, s.id limit", "order by s.created_at asc, s.id limit"),
                ("search_path bukan kosong", "set search_path = ''", "set search_path = 'public'"),
                ("ACL anon diberi EXECUTE", None, f"grant execute on function {SIG} to anon;"),
                ("jumlah menghitung semua (bukan hasil saring)", "'jumlah', (select count(*)::integer from saring)", "'jumlah', (select count(*)::integer from saring0)"),
                ("kunjungan lolos bila SATU istilah cocok di mana saja (tanpa per kunjungan)", "group by c.visit_id having", "group by c.visit_id, c.kunci having"),
                ("filter hewan (p_pet) diabaikan", "where (p_pet is null or v.pet_id = p_pet)", "where (true)"),
                ("arsip ikut di daftar umum", "and (p_pet is not null or v.archived_at is null)", ""),
                ("kunjungan tanpa rekam medis ikut", "and exists (select 1 from public.medical_records m where m.visit_id = v.id)", ""),
                ("filter cabang (p_cabang) diabaikan", "and (p_cabang is null or v.branch_id = p_cabang\n              or (v.branch_id is null and v.legacy_source_key is not null))", ""),
                ("impor tanpa cabang tidak ikut p_cabang", "or (v.branch_id is null and v.legacy_source_key is not null))\n         and exists", ")\n         and exists"),
            ]
            hidup = []
            for label, lama, baru in MUTAN:
                if args.only not in label:
                    continue
                if lama is None:
                    pg.sql(baru)
                else:
                    if lama not in fungsi_asli:
                        # pola beda per bentuk teks: laporkan sebagai kesalahan jangkar
                        raise SystemExit(f"jangkar mutan tidak ditemukan: {label}")
                    pg.sql(fungsi_asli.replace(lama, baru))
                try:
                    suite_cepat(pg)
                    hidup.append(label)
                    print(f"MUTAN HIDUP: {label}", flush=True)
                except (AssertionError, RuntimeError) as error:
                    print(f"MUTAN MATI: {label} -> {str(error).splitlines()[0][:150]}", flush=True)
                # pulihkan fungsi + ACL asli
                pg.sql(fungsi_asli + f"\nrevoke all on function {SIG} from public, anon;\ngrant execute on function {SIG} to authenticated;")
                assert atribut_dan_acl(pg) == ATRIBUT_HARAP, "pemulihan gagal"
            assert not hidup, f"mutan hidup: {hidup}"
            print(f"SEMUA MUTAN MATI ({len(MUTAN)})", flush=True)
            laporan["mutan"] = len(MUTAN)
        suite_cepat(pg)   # fungsi asli tetap lolos setelah pemulihan
        # ---------------------------------------------------------------- kecepatan (data besar)
        pg.sql(f"""set session_replication_role = replica;
          insert into public.visits(id, branch_id, customer_id, pet_id, created_at, dokter, keluhan, legacy_source_key)
          select ('f2000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, null, '{base.CUST2}', '{PET_2}',
                 timestamptz '2024-01-01' + g * interval '1 minute', 'drh. Massal', 'Impor massal', 'uji::massal-' || g from generate_series(1, 9600) g;
          insert into public.medical_records(id, visit_id, diagnosis) select ('f4000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
                 ('f2000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'Dx massal' from generate_series(1, 9600) g;
          insert into public.prescription_items(medical_record_id, nama_obat, qty, jenis, item_id)
          select ('f4000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'RC Recovery', 1, 'obat', '{uid('item-rc')}' from generate_series(1, 9600, 7) g;
          insert into public.prescription_items(medical_record_id, nama_obat, qty, jenis, item_id)
          select ('f4000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'Obat lain ' || g, 1, 'obat', null from generate_series(1, 9600, 3) g;
          analyze;""")
        waktu = {}
        for nama, user in (("OWNER", OWNER), ("DOKTER_A", DOKTER_A)):
            for label, obat in (("tanpa filter", None), ("RC Recovery", "RC Recovery"), ("2 istilah", "rc recovery, obat lain")):
                t0 = time.monotonic()
                r = json.loads(batch(pg, user, [rpc_sql("daftar_rekam_medis_halaman", None, None, "rawat-jalan", None, 50, 0, obat)])[0])
                waktu[f"{nama} {label}"] = round((time.monotonic() - t0) * 1000)
                if obat == "RC Recovery":
                    chk(r["jumlah"] >= 1371, f"{nama} jumlah RC Recovery besar: {r['jumlah']}")
        print(f"INFO kecepatan native (ms, 19 ribu kunjungan, satu panggilan): {waktu}", flush=True)
        laporan["kecepatan_ms"] = waktu

    print(f"SEMUA PASS ({HITUNG['n']} cek)", flush=True)
    laporan["cek"] = HITUNG["n"]
    if args.json:
        Path(args.json).write_text(json.dumps(laporan, indent=1))


def atribut_dan_acl_sebelum(pg):
    return "ada" if pg.last(f"select to_regprocedure('{SIG_LAMA}') is not null") == "t" else "tidak"


if __name__ == "__main__":
    main()
