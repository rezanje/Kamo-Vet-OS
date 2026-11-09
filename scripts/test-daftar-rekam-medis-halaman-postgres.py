#!/usr/bin/env python3
"""Uji migrasi 20261109100000 (RPC daftar_rekam_medis_halaman) di PostgreSQL sungguhan, data fiktif.

Seluruh migrasi repo diputar dari nol (termasuk migrasi ini), lalu sebagai `authenticated` + klaim JWT
(seperti PostgREST), TANPA header cabang (seperti aplikasi memanggil RPC ini):
  A. migrasi berjalan dan idempoten; fungsi lama `daftar_rekam_medis(uuid)` tidak berubah (md5 definisi + ACL).
  B. Kesetaraan: untuk OWNER, ADMIN, STAFF cabang A, DOKTER cabang A x p_cabang (null/A/B) x tampilan x hewan x cari,
     gabungan semua halaman RPC = acuan yang dihitung dari fungsi lama (RLS pemanggil yang sama) + saringan yang
     didokumentasikan (cabang + impor tanpa cabang, rawat inap aktif, arsip, cari pemilik/telepon/hewan).
  C. Tidak melebarkan akses: tiap baris RPC juga terlihat lewat SELECT biasa pemanggil yang sama; DOKTER/STAFF
     cabang A tidak pernah melihat impor tanpa cabang maupun cabang B, dengan p_cabang apa pun.
  D. Filter cabang: OWNER/ADMIN dengan p_cabang=A melihat baris A + impor (branch_id null + legacy_source_key),
     tidak melihat B maupun kunjungan tanpa cabang yang bukan impor.
  E. Paginasi: jumlah konsisten, halaman tidak tumpang tindih, offset di luar = baris kosong; masukan tidak sah
     ditolak 22023; cari memakai strpos (% dan _ bukan wildcard).
  F. >10.000 baris: 10.050 impor tambahan -> jumlah > 10.000 dan halaman tetap terisi (fungsi lama: baris null).
  G. anon ditolak; SECURITY INVOKER, STABLE, search_path kosong.
Migrasi 20261109100100 (DOKTER aktif boleh MEMBACA riwayat impor tanpa cabang, keputusan owner 9 Nov 2026):
  H. Sebelum migrasi: DOKTER tidak melihat impor. Sesudah: DOKTER aktif (cabang A maupun B, dengan/tanpa header) melihat
     impor tanpa cabang; TIDAK melihat kunjungan tanpa cabang yang bukan impor, impor bercabang B, atau cabang lain.
     STAFF dan DOKTER nonaktif tetap tidak melihat impor. OWNER/ADMIN tidak berubah.
  I. DOKTER tidak bisa menulis: UPDATE/DELETE visits & medical_records impor = 0 baris; INSERT medical_records,
     consents, kunjungan impor, atau kunjungan lanjutan dari impor ditolak RLS; data tetap utuh.
  J. Hanya satu kebijakan berubah (sidik kebijakan lain sama); helper SECURITY INVOKER; migrasi idempoten.

Tidak pernah terhubung ke Production.

    python3 scripts/test-daftar-rekam-medis-halaman-postgres.py [--pg-bin DIR] [--mutations]
"""
import argparse
import importlib.util
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

_spec = importlib.util.spec_from_file_location("hris", ROOT / "scripts/test-hris-cabang-postgres.py")
hris = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hris)

MIGRATIONS = ROOT / "supabase/migrations"
MIGRASI = MIGRATIONS / "20261109100000_daftar_rekam_medis_halaman.sql"
MIGRASI2 = MIGRATIONS / "20261109100100_dokter_baca_riwayat_impor.sql"
SIG = "public.daftar_rekam_medis_halaman(uuid,text,text,uuid,integer,integer)"
DOKTER_NONAKTIF = "20000000-0000-4000-8000-000000000005"
DOKTER_B = "20000000-0000-4000-8000-000000000006"
SIDIK_KEBIJAKAN = """select md5(string_agg(pol.polrelid::regclass::text || '|' || pol.polname || '|' || pol.polcmd::text || '|' ||
  pol.polpermissive::text || '|' || array_to_string(array(select r::regrole::text from unnest(pol.polroles) r order by 1), ',') || '|' ||
  coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || '|' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
  E'\\n' order by pol.polrelid::regclass::text, pol.polname)) from pg_policy pol join pg_class c on c.oid = pol.polrelid
  where c.relnamespace = 'public'::regnamespace and (pol.polrelid::regclass::text, pol.polname::text) not in
  (('visits', 'operational_branch_isolation'), ('visits', 'visits_select'), ('medical_records', 'mr_select'))"""

OWNER = "20000000-0000-4000-8000-000000000001"
ADMIN = "20000000-0000-4000-8000-000000000004"
STAFF_A = "20000000-0000-4000-8000-000000000002"
DOKTER_A = "20000000-0000-4000-8000-000000000003"
CAB_A = "a1000000-0000-4000-8000-00000000000a"
CAB_B = "b1000000-0000-4000-8000-00000000000b"
CUST1 = "c1000000-0000-4000-8000-000000000001"
CUST2 = "c1000000-0000-4000-8000-000000000002"
CUST3 = "c1000000-0000-4000-8000-000000000003"
PET_1 = "e1000000-0000-4000-8000-000000000001"
PET_2 = "e1000000-0000-4000-8000-000000000002"
PET_3 = "e1000000-0000-4000-8000-000000000003"
NAMA = ["a_mr", "a_tanpa", "b_mr", "lama1", "a_inap", "a_mr2", "lama2", "nolbukanimpor", "a_arsip", "a_inap_pulang", "b_lama_cab", "a_persen"]
V = {k: f"f1000000-0000-4000-8000-{i:012d}" for i, k in enumerate(NAMA, 1)}
FINANCE = "20000000-0000-4000-8000-000000000007"
SEMUA_USER = (OWNER, ADMIN, STAFF_A, DOKTER_A, DOKTER_B, DOKTER_NONAKTIF, FINANCE)
HDR = {None: None, "A": {"x-kamo-operational-branch": CAB_A}, "B": {"x-kamo-operational-branch": CAB_B}}

DATA = f"""
insert into auth.users(id) values ('{OWNER}'),('{ADMIN}'),('{STAFF_A}'),('{DOKTER_A}'),('{DOKTER_NONAKTIF}'),('{DOKTER_B}'),('{FINANCE}');
insert into public.profiles(id, role, is_active, full_name) values
  ('{OWNER}','OWNER',true,'Pemilik Uji'),('{ADMIN}','ADMIN',true,'Admin Uji'),('{FINANCE}','FINANCE',true,'Keuangan Uji'),
  ('{STAFF_A}','STAFF',true,'Staf A'),('{DOKTER_A}','DOCTOR',true,'Dokter A'),
  ('{DOKTER_NONAKTIF}','DOCTOR',false,'Dokter Nonaktif'),('{DOKTER_B}','DOCTOR',true,'Dokter B')
on conflict (id) do update set role=excluded.role, is_active=excluded.is_active;
insert into public.branches(id, code, name, type, is_active) values
  ('{CAB_A}','UJI-A','Cabang Uji A','KLINIK',true),('{CAB_B}','UJI-B','Cabang Uji B','KLINIK',true);
insert into public.user_branches(user_id, branch_id) values ('{STAFF_A}','{CAB_A}'),('{DOKTER_A}','{CAB_A}'),
  ('{DOKTER_NONAKTIF}','{CAB_A}'),('{DOKTER_B}','{CAB_B}');
insert into public.customers(id, name, phone) values
  ('{CUST1}','Budi Santoso','0811111111'),('{CUST2}','Ani Wijaya','0822222222'),('{CUST3}','Toko 100% Sehat','0833_333');
insert into public.pets(id, customer_id, name, species, breed) values
  ('{PET_1}','{CUST1}','Mochi','Kucing',null),('{PET_2}','{CUST2}','Bruno','Anjing','Lokal'),('{PET_3}','{CUST3}','Kiko','Kucing',null);
insert into public.visits(id, branch_id, customer_id, pet_id, created_at, dokter, keluhan, legacy_source_key) values
  -- Dua kunjungan dengan created_at sama, disisipkan berlawanan dengan urutan id (urutan wajib created_at desc, id).
  ('{V['a_mr2']}','{CAB_A}','{CUST2}','{PET_2}','2026-01-03T01:00:00Z','drh. A2','Keluhan A2',null),
  ('{V['a_mr']}','{CAB_A}','{CUST1}','{PET_1}','2026-01-03T01:00:00Z','drh. A','Keluhan A',null),
  ('{V['a_tanpa']}','{CAB_A}','{CUST1}','{PET_1}','2026-01-04T01:00:00Z','drh. A','Tanpa rekam',null),
  ('{V['b_mr']}','{CAB_B}','{CUST1}','{PET_1}','2026-01-02T01:00:00Z','drh. B','Keluhan B',null),
  ('{V['lama1']}',null,'{CUST1}','{PET_1}','2025-06-01T01:00:00Z','drh. Lama','Keluhan lama','uji::lama-1'),
  ('{V['lama2']}',null,'{CUST2}','{PET_2}','2025-07-01T01:00:00Z','drh. Lama2','Keluhan lama 2','uji::lama-2'),
  ('{V['nolbukanimpor']}',null,'{CUST2}','{PET_2}','2025-08-01T01:00:00Z','drh. X','Tanpa cabang bukan impor',null),
  ('{V['a_inap']}','{CAB_A}','{CUST2}','{PET_2}','2026-01-05T01:00:00Z','drh. Inap','Rawat inap',null),
  ('{V['a_inap_pulang']}','{CAB_A}','{CUST2}','{PET_2}','2026-01-06T01:00:00Z','drh. Inap','Rawat inap pulang',null),
  ('{V['a_arsip']}','{CAB_A}','{CUST1}','{PET_1}','2026-01-07T01:00:00Z','drh. A','Diarsipkan',null),
  ('{V['b_lama_cab']}','{CAB_B}','{CUST3}','{PET_3}','2025-05-01T01:00:00Z','drh. B','Impor bercabang B','uji::lama-b'),
  ('{V['a_persen']}','{CAB_A}','{CUST3}','{PET_3}','2026-01-08T01:00:00Z','drh. A','Persen',null);
insert into public.medical_records(visit_id, diagnosis, anamnesis) values
  ('{V['a_mr2']}','Dx A2',null),('{V['a_mr']}','Dx A','Ana A'),('{V['b_mr']}','Dx B','Ana B'),
  ('{V['lama1']}','Dx lama','Ana lama'),('{V['lama2']}','Dx lama2',null),('{V['nolbukanimpor']}','Dx nol',null),
  ('{V['a_inap']}','Dx inap','Ana inap'),('{V['a_inap_pulang']}','Dx pulang',null),('{V['a_arsip']}','Dx arsip',null),
  ('{V['b_lama_cab']}','Dx b lama',null),('{V['a_persen']}','Dx persen',null);
"""


def sebagai(pg, perintah, user, header=None):
    hdr = f"select set_config('request.headers', '{json.dumps(header or {})}', true);\n"
    return pg.sql("begin;\nset local role authenticated;\n"
                  f"select set_config('request.jwt.claim.sub', '{user}', true);\n" + hdr + perintah + "\ncommit;").splitlines()[-1]


def ditolak(pg, perintah, user, potongan):
    try:
        sebagai(pg, perintah, user)
    except RuntimeError as error:
        assert potongan in str(error), str(error)[:400]
        return
    raise AssertionError(f"seharusnya ditolak: {perintah}")


def lit(v):
    return "null" if v is None else ("'" + str(v).replace("'", "''") + "'")


def rpc(pg, user, cabang=None, cari=None, tampilan="semua", pet=None, batas=50, offset=0, header=None):
    q = (f"select public.daftar_rekam_medis_halaman({lit(cabang)}::uuid, {lit(cari)}::text, {lit(tampilan)}::text,"
         f" {lit(pet)}::uuid, {batas}, {offset})::text;")
    return json.loads(sebagai(pg, q, user, header))


def semua_halaman(pg, user, batas=3, **kw):
    hasil, offset, jumlah = [], 0, None
    while True:
        r = rpc(pg, user, batas=batas, offset=offset, **kw)
        assert r["batas"] == batas and r["offset"] == offset, r
        if jumlah is None:
            jumlah = r["jumlah"]
        assert r["jumlah"] == jumlah, "jumlah berubah antar halaman"
        assert len(r["baris"]) == max(0, min(batas, jumlah - offset)), (len(r["baris"]), jumlah, offset)
        hasil += r["baris"]
        offset += batas
        if offset >= jumlah:
            break
    ids = [b["id"] for b in hasil]
    assert len(ids) == len(set(ids)), "halaman tumpang tindih"
    assert len(ids) == jumlah
    return hasil, r["ringkasan"]


def acuan(lama, cabang, cari, tampilan):
    """Acuan dari fungsi lama (RLS pemanggil yang sama, urutan created_at desc, id) + saringan yang didokumentasikan."""
    keluar = []
    for b in lama:
        if cabang is not None and not (b["branch_id"] == cabang or (b["branch_id"] is None and b["legacy_source_key"])):
            continue
        if tampilan == "rawat-jalan" and any(i["discharged_at"] is None for i in b["inpatient_records"]):
            continue
        if cari:
            c = cari.strip().lower()
            teks = [(b["customers"] or {}).get("name") or "", (b["customers"] or {}).get("phone") or "", (b["pets"] or {}).get("name") or ""]
            if c and not any(c in t.lower() for t in teks):
                continue
        keluar.append(b)
    return keluar


def impor_terlihat(pg, user, header=None):
    """ID impor tanpa cabang yang terlihat lewat SELECT biasa (visits dan medical_records) pemanggil."""
    v = json.loads(sebagai(pg, "select coalesce(jsonb_agg(id order by id),'[]')::text from public.visits"
                               " where branch_id is null and legacy_source_key is not null;", user, header))
    m = json.loads(sebagai(pg, "select coalesce(jsonb_agg(m.visit_id order by m.visit_id),'[]')::text from public.medical_records m"
                               f" where m.visit_id in ('{V['lama1']}','{V['lama2']}');", user, header))
    return set(v), set(m)


def terlihat_semua(pg, user, header=None):
    """Seluruh ID visits dan medical_records yang terlihat lewat SELECT biasa pemanggil."""
    return (frozenset(json.loads(sebagai(pg, "select coalesce(jsonb_agg(id),'[]')::text from public.visits;", user, header))),
            frozenset(json.loads(sebagai(pg, "select coalesce(jsonb_agg(id),'[]')::text from public.medical_records;", user, header))))


def jalankan(pg, migrasi_teks, migrasi2_teks=None):
    migrasi2_teks = MIGRASI2.read_text() if migrasi2_teks is None else migrasi2_teks
    pg.sql(hris.PLATFORM)
    pg.sql(hris.PERAN)
    semua = sorted(MIGRATIONS.glob("*.sql"))
    lama_md5 = None
    sidik_awal = None
    pandangan_awal = {}
    for berkas in semua:
        if berkas.name in hris.SEBELUM:
            pg.sql(hris.SEBELUM[berkas.name])
        if berkas.name == MIGRASI2.name:
            # Sebelum migrasi akses: DOKTER (dan STAFF) tidak melihat impor sama sekali.
            for user in (DOKTER_A, DOKTER_B, STAFF_A):
                assert impor_terlihat(pg, user) == (set(), set()), ("sebelum migrasi", user)
            sidik_awal = pg.last(SIDIK_KEBIJAKAN)
            pandangan_awal = {(u, h): terlihat_semua(pg, u, HDR.get(h)) for u in SEMUA_USER for h in HDR}
            teks = migrasi2_teks
        elif berkas.name == MIGRASI.name:
            pg.sql(DATA)
            pg.sql(f"""begin; set local session_replication_role = replica;  -- fixture saja: lewati trigger alur rawat inap
                       insert into public.inpatient_records(visit_id, branch_id, created_at, condition_status, discharged_at) values
                       ('{V['a_inap']}', '{CAB_A}', '2026-01-05T02:00:00Z', 'stabil', null),
                       ('{V['a_inap_pulang']}', '{CAB_A}', '2026-01-06T02:00:00Z', 'stabil', '2026-01-06T05:00:00Z');
                       update public.visits set archived_at = '2026-01-07T02:00:00Z', archived_by = '{OWNER}', archive_reason = 'Draf uji arsip' where id = '{V['a_arsip']}'; commit;""")
            lama_md5 = pg.last("select md5(pg_get_functiondef('public.daftar_rekam_medis(uuid)'::regprocedure))||'|'||"
                               "coalesce((select proacl::text from pg_proc where oid='public.daftar_rekam_medis(uuid)'::regprocedure),'')")
            teks = migrasi_teks
        else:
            teks = berkas.read_text()
        try:
            pg.sql("begin;\n" + teks + "\ncommit;")
        except RuntimeError as error:
            raise AssertionError(f"Migrasi {berkas.name} gagal di klaster bersih:\n{str(error)[:2000]}") from None
    assert sidik_awal is not None, "migrasi akses dokter tidak ditemukan"
    pg.sql("begin;\n" + migrasi_teks + "\ncommit;")
    pg.sql("begin;\n" + migrasi2_teks + "\ncommit;")
    assert pg.last(SIDIK_KEBIJAKAN) == sidik_awal, "kebijakan lain ikut berubah"
    # Himpunan baris terlihat (visits + medical_records) per peran x header: non-dokter-aktif identik; dokter aktif =
    # sebelum + persis impor tanpa cabang (dan rekam medisnya), tidak lebih.
    impor_v = frozenset(json.loads(pg.last("select coalesce(jsonb_agg(id),'[]')::text from public.visits where branch_id is null and legacy_source_key is not null")))
    impor_m = frozenset(json.loads(pg.last("select coalesce(jsonb_agg(m.id),'[]')::text from public.medical_records m join public.visits v on v.id = m.visit_id"
                                           " where v.branch_id is null and v.legacy_source_key is not null")))
    for (u, h), (v0, m0) in pandangan_awal.items():
        v1, m1 = terlihat_semua(pg, u, HDR.get(h))
        if u in (DOKTER_A, DOKTER_B):
            assert v1 == v0 | impor_v and m1 == m0 | impor_m, ("dokter: bukan sebelum + impor", u, h, v1 - v0 - impor_v, v0 - v1)
        else:
            assert (v1, m1) == (v0, m0), ("pandangan peran berubah", u, h, v1 ^ v0, m1 ^ m0)
    print(f"PASS K: {len(pandangan_awal)} pandangan peran x header: non-dokter identik; dokter = sebelum + {len(impor_v)} impor", flush=True)
    baru_md5 = pg.last("select md5(pg_get_functiondef('public.daftar_rekam_medis(uuid)'::regprocedure))||'|'||"
                       "coalesce((select proacl::text from pg_proc where oid='public.daftar_rekam_medis(uuid)'::regprocedure),'')")
    assert lama_md5 == baru_md5, "fungsi lama daftar_rekam_medis berubah"
    print(f"PASS A: {len(semua)} migrasi repo berjalan dari nol; migrasi ini idempoten (2x); fungsi lama tidak berubah", flush=True)

    pemanggil = [("OWNER", OWNER), ("ADMIN", ADMIN), ("STAFF A", STAFF_A), ("DOKTER A", DOKTER_A),
                 ("DOKTER B", DOKTER_B), ("DOKTER NONAKTIF", DOKTER_NONAKTIF)]
    n = 0
    for label, user in pemanggil:
        for pet in (None, PET_1, PET_2):
            lama = json.loads(sebagai(pg, f"select public.daftar_rekam_medis({lit(pet)}::uuid)::text;", user))["baris"]
            for cabang in (None, CAB_A, CAB_B):
                for tampilan in ("semua", "rawat-jalan"):
                    for cari in (None, "", "  BUDI ", "08222", "bru", "100%", "0833_", "%", "_", "tidak-ada"):
                        baris, ringkasan = semua_halaman(pg, user, cabang=cabang, cari=cari, tampilan=tampilan, pet=pet)
                        harap = acuan(lama, cabang, cari, tampilan)
                        assert baris == harap, f"{label} pet={pet} cabang={cabang} {tampilan} cari={cari!r}\nRPC={[b['id'] for b in baris]}\nACUAN={[b['id'] for b in harap]}"
                        lingkup = acuan(lama, cabang, None, "semua")
                        assert ringkasan == {"riwayat": len(lingkup), "hewan": len({b["pet_id"] for b in lingkup}),
                                             "impor": sum(1 for b in lingkup if b["legacy_source_key"])}, (label, ringkasan)
                        n += 1
    print(f"PASS B: {n} kombinasi pemanggil x hewan x cabang x tampilan x cari = acuan (semua halaman, ringkasan)", flush=True)

    for label, user in pemanggil:
        terlihat = set(json.loads(sebagai(pg, "select coalesce(jsonb_agg(id),'[]')::text from public.visits;", user)))
        for cabang in (None, CAB_A, CAB_B):
            ids = {b["id"] for b in semua_halaman(pg, user, batas=200, cabang=cabang, pet=None)[0]}
            assert ids <= terlihat, f"{label} melihat lebih dari SELECT biasa: {ids - terlihat}"
    impor = {V["lama1"], V["lama2"]}
    for user in (STAFF_A, DOKTER_NONAKTIF, DOKTER_A):
        for cabang in (None, CAB_A, CAB_B):
            for pet in (None, PET_1, PET_2):
                ids = {b["id"] for b in semua_halaman(pg, user, batas=200, cabang=cabang, pet=pet)[0]}
                assert not ids & {V["nolbukanimpor"], V["b_mr"], V["b_lama_cab"]}, (user, cabang, ids)
                if user == DOKTER_A:
                    harap_impor = impor if pet is None else {i for i, p in ((V["lama1"], PET_1), (V["lama2"], PET_2)) if p == pet}
                    assert ids & impor == harap_impor, ("dokter aktif wajib melihat impor", cabang, pet, ids)
                else:
                    assert not ids & impor, ("non-dokter / dokter nonaktif melihat impor", user, cabang, ids)
        cab_b = {b["id"] for b in semua_halaman(pg, user, batas=50, cabang=CAB_B)[0]}
        assert cab_b == (impor if user == DOKTER_A else set()), ("user cabang A melihat cabang B", user, cab_b)
    print("PASS C: tidak ada baris di luar SELECT biasa; STAFF A & dokter nonaktif tanpa impor; DOKTER A = cabang A + impor,"
          " tidak pernah cabang B / tanpa-cabang-bukan-impor / impor bercabang B", flush=True)

    for user in (OWNER, ADMIN):
        ids = [b["id"] for b in semua_halaman(pg, user, batas=50, cabang=CAB_A)[0]]
        assert ids == [V["a_persen"], V["a_inap_pulang"], V["a_inap"], V["a_mr"], V["a_mr2"], V["lama2"], V["lama1"]], ids
        rj = [b["id"] for b in semua_halaman(pg, user, batas=50, cabang=CAB_A, tampilan="rawat-jalan")[0]]
        assert V["a_inap"] not in rj and V["a_inap_pulang"] in rj, rj
        semua = [b["id"] for b in semua_halaman(pg, user, batas=50)[0]]
        assert V["nolbukanimpor"] in semua and V["b_mr"] in semua and V["a_arsip"] not in semua and V["a_tanpa"] not in semua, semua
        perhewan = [b["id"] for b in semua_halaman(pg, user, batas=50, pet=PET_1, cabang=CAB_A)[0]]
        assert perhewan == [V["a_arsip"], V["a_mr"], V["lama1"]], perhewan
        # Dengan header cabang aktif, RLS menyembunyikan impor: alasan aplikasi memanggil RPC ini tanpa header.
        hdr = rpc(pg, user, cabang=CAB_A, header={"x-kamo-operational-branch": CAB_A})
        assert V["lama1"] not in [b["id"] for b in hdr["baris"]], "header cabang ternyata tidak menyembunyikan impor"
    print("PASS D: p_cabang=A -> baris A + impor tanpa cabang (urutan benar); B & tanpa-cabang-bukan-impor tidak ikut; arsip hanya per hewan", flush=True)

    r = rpc(pg, OWNER, batas=5, offset=500)
    assert r["baris"] == [] and r["jumlah"] == 10, r["jumlah"]
    for args, label in ((dict(batas=0), "batas 0"), (dict(batas=201), "batas 201"), (dict(offset=-1), "offset -1")):
        a = {"batas": 50, "offset": 0, **args}
        ditolak(pg, f"select public.daftar_rekam_medis_halaman(null, null, 'semua', null, {a['batas']}, {a['offset']});", OWNER,
                "batas" if "batas" in label else "offset")
    ditolak(pg, "select public.daftar_rekam_medis_halaman(null, null, 'semua', null, null, 0);", OWNER, "batas")
    ditolak(pg, "select public.daftar_rekam_medis_halaman(null, null, 'semua', null, 50, null);", OWNER, "offset")
    ditolak(pg, "select public.daftar_rekam_medis_halaman(null, null, 'lain', null, 50, 0);", OWNER, "tampilan")
    ditolak(pg, "select public.daftar_rekam_medis_halaman(null, null, null, null, 50, 0);", OWNER, "tampilan")
    ditolak(pg, f"select public.daftar_rekam_medis_halaman(null, '{'x' * 101}', 'semua', null, 50, 0);", OWNER, "terlalu panjang")
    hasil_kode = pg.sql("""do $t$ begin begin perform public.daftar_rekam_medis_halaman(null, null, 'semua', null, 0, 0);
                           raise exception 'TIDAK_DITOLAK'; exception when sqlstate '22023' then null; end; end $t$; select 'ok';""")
    assert hasil_kode.splitlines()[-1] == "ok"
    persen = [b["id"] for b in semua_halaman(pg, OWNER, cari="%")[0]]
    assert persen == [V["a_persen"], V["b_lama_cab"]], persen
    garis = [b["id"] for b in semua_halaman(pg, OWNER, cari="_")[0]]
    assert garis == [V["a_persen"], V["b_lama_cab"]], garis
    print("PASS E: offset di luar = kosong + jumlah benar; masukan tidak sah ditolak (22023); % dan _ literal", flush=True)

    pg.sql(f"""begin;
      insert into public.visits(id, branch_id, customer_id, pet_id, created_at, dokter, keluhan, legacy_source_key)
      select ('f2000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, null, '{CUST2}', '{PET_2}',
             timestamptz '2024-01-01' + g * interval '1 minute', 'drh. Massal', 'Impor massal', 'uji::massal-' || g
        from generate_series(1, 10050) g;
      insert into public.medical_records(visit_id, diagnosis) select ('f2000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'Dx massal'
        from generate_series(1, 10050) g;
      commit; analyze public.visits; analyze public.medical_records;""")
    for user, cabang in ((OWNER, None), (OWNER, CAB_A), (ADMIN, CAB_A)):
        t0 = time.monotonic()
        r = rpc(pg, user, cabang=cabang, tampilan="rawat-jalan")
        ms = (time.monotonic() - t0) * 1000
        assert r["jumlah"] > 10000 and len(r["baris"]) == 50, (r["jumlah"], len(r["baris"]))
        terakhir = rpc(pg, user, cabang=cabang, tampilan="rawat-jalan", offset=(r["jumlah"] - 1) // 50 * 50)
        assert len(terakhir["baris"]) == r["jumlah"] - (r["jumlah"] - 1) // 50 * 50
        print(f"  >10.000: user={user[-1]} cabang={'A' if cabang else 'semua'} jumlah={r['jumlah']} halaman pertama {ms:.0f} ms", flush=True)
    lama = json.loads(sebagai(pg, "select public.daftar_rekam_medis(null)::text;", OWNER))
    assert lama["jumlah"] > 10000 and lama["baris"] is None
    for user in (DOKTER_A, DOKTER_B):
        t0 = time.monotonic()
        dokter = rpc(pg, user, cabang=CAB_A, tampilan="rawat-jalan")
        ms = (time.monotonic() - t0) * 1000
        assert dokter["jumlah"] > 10000 and len(dokter["baris"]) == 50, dokter["jumlah"]
        assert all(b["branch_id"] in (CAB_A if user == DOKTER_A else None, None) and (b["branch_id"] or b["legacy_source_key"])
                   for b in dokter["baris"]), "dokter melihat baris di luar cabangnya / impor"
        print(f"  >10.000: dokter={user[-1]} cabang=A jumlah={dokter['jumlah']} halaman pertama {ms:.0f} ms", flush=True)
    staf = rpc(pg, STAFF_A, cabang=CAB_A)
    assert staf["jumlah"] < 20 and all(b["branch_id"] == CAB_A for b in staf["baris"]), staf["jumlah"]
    print("PASS F: >10.000 baris: jumlah benar, halaman pertama & terakhir terisi (fungsi lama: baris null); dokter = cabang + impor; staf tetap hanya cabang A", flush=True)

    try:
        pg.sql(f"begin; set local role anon; select public.daftar_rekam_medis_halaman(); commit;")
        raise AssertionError("anon seharusnya ditolak")
    except RuntimeError as error:
        assert "permission denied" in str(error), str(error)[:300]
    attr = pg.last("select prosecdef::text||'|'||provolatile::text||'|'||array_to_string(proconfig,',')"
                   f" from pg_proc where oid='{SIG}'::regprocedure;")
    assert attr == 'false|s|search_path=""', attr
    print("PASS G: anon ditolak; SECURITY INVOKER, STABLE, search_path kosong", flush=True)

    impor = {V["lama1"], V["lama2"]}
    hdr_a, hdr_b = {"x-kamo-operational-branch": CAB_A}, {"x-kamo-operational-branch": CAB_B}
    for user, header in ((DOKTER_A, None), (DOKTER_A, hdr_a), (DOKTER_B, None), (DOKTER_B, hdr_b)):
        v, m = impor_terlihat(pg, user, header)
        assert impor <= v and m == impor, ("dokter aktif wajib membaca impor + rekam medisnya", user, header)
        lain = set(json.loads(sebagai(pg, "select coalesce(jsonb_agg(id),'[]')::text from public.visits"
                                          f" where id in ('{V['nolbukanimpor']}','{V['b_lama_cab']}','{V['b_mr']}','{V['a_mr']}');", user, header)))
        harap = ({V["a_mr"]} if user == DOKTER_A else {V["b_mr"], V["b_lama_cab"]})
        assert lain == harap, ("dokter melihat baris di luar cabang/impor", user, header, lain)
        # Relasi yang perlu untuk tampil ikut terbaca (pets/customers memang terbuka untuk authenticated).
        rel = sebagai(pg, f"select count(*) from public.visits v join public.pets p on p.id = v.pet_id join public.customers c on c.id = v.customer_id where v.id = '{V['lama1']}';", user, header)
        assert rel == "1", rel
    for user, header in ((STAFF_A, None), (STAFF_A, hdr_a), (DOKTER_NONAKTIF, None), (DOKTER_NONAKTIF, hdr_a)):
        assert impor_terlihat(pg, user, header) == (set(), set()), ("non-dokter / dokter nonaktif melihat impor", user, header)
    for user in (OWNER, ADMIN):
        assert impor_terlihat(pg, user)[1] == impor and impor_terlihat(pg, user, hdr_a) == (set(), set()), ("OWNER/ADMIN berubah", user)
    print("PASS H: DOKTER aktif (A/B, dengan/tanpa header) membaca impor + rekam medis; tanpa-cabang-bukan-impor, impor bercabang B,"
          " cabang lain tetap tertutup; STAFF & dokter nonaktif tanpa impor; OWNER/ADMIN tidak berubah", flush=True)

    sebelum = pg.last(f"select md5(string_agg(v::text, ',' order by v.id)) from public.visits v where v.id in ('{V['lama1']}','{V['lama2']}')")
    sebelum_m = pg.last(f"select md5(string_agg(m::text, ',' order by m.id)) from public.medical_records m where m.visit_id in ('{V['lama1']}','{V['lama2']}')")
    for user, header in ((DOKTER_A, None), (DOKTER_A, hdr_a)):
        for dml in (f"update public.visits set keluhan = 'diubah dokter' where id = '{V['lama1']}'",
                    f"update public.visits set branch_id = '{CAB_A}' where id = '{V['lama1']}'",
                    f"delete from public.visits where id = '{V['lama1']}'",
                    f"update public.medical_records set diagnosis = 'diubah dokter' where visit_id = '{V['lama1']}'",
                    f"delete from public.medical_records where visit_id = '{V['lama1']}'"):
            n = sebagai(pg, f"with u as ({dml} returning 1) select count(*) from u;", user, header)
            assert n == "0", (dml, user, header, n)
        for dml in (f"insert into public.medical_records(visit_id, diagnosis) values ('{V['lama1']}', 'tulisan dokter')",
                    f"insert into public.consents(visit_id, tindakan, isi_snapshot) values ('{V['lama1']}', 'Uji', 'Uji')",
                    f"insert into public.visits(id, branch_id, customer_id, pet_id, legacy_source_key, legacy_source_hash) values"
                    f" ('f3000000-0000-4000-8000-000000000001', null, '{CUST1}', '{PET_1}', 'uji::dokter', 'x')",
                    f"insert into public.visits(id, branch_id, customer_id, pet_id, continued_from_visit_id) values"
                    f" ('f3000000-0000-4000-8000-000000000002', '{CAB_A}', '{CUST1}', '{PET_1}', '{V['lama1']}')"):
            try:
                sebagai(pg, dml + ";", user, header)
            except RuntimeError as error:
                # Ditolak RLS, hak, atau pemicu penjaga akses yang sudah ada (mis. guard_consent_document) — bukan galat lain.
                assert any(t in str(error) for t in ("row-level security", "permission denied", "ACCESS_DENIED", "CONTINUATION_LOCKED")), str(error)[:300]
                continue
            raise AssertionError(f"dokter seharusnya ditolak: {dml}")
    assert pg.last(f"select md5(string_agg(v::text, ',' order by v.id)) from public.visits v where v.id in ('{V['lama1']}','{V['lama2']}')") == sebelum
    assert pg.last(f"select md5(string_agg(m::text, ',' order by m.id)) from public.medical_records m where m.visit_id in ('{V['lama1']}','{V['lama2']}')") == sebelum_m
    assert pg.last(f"select count(*) from public.consents where visit_id in ('{V['lama1']}','{V['lama2']}')") == "0"
    print("PASS I: DOKTER tidak bisa menulis impor (UPDATE/DELETE 0 baris; INSERT rekam medis/consent/kunjungan impor/lanjutan ditolak RLS); data utuh", flush=True)

    attr = pg.last("select prosecdef::text||'|'||provolatile::text||'|'||array_to_string(proconfig,',')||'|'||"
                   "has_function_privilege('anon','public.dokter_aktif_baca_impor()','execute')::text"
                   " from pg_proc where oid='public.dokter_aktif_baca_impor()'::regprocedure;")
    assert attr == 'false|s|search_path=""|false', attr
    # (Review Wowo c) Detail impor untuk dokter tidak membuka tagihan / rawat inap / follow-up kunjungan impor.
    pg.sql(f"""begin; set local session_replication_role = replica;  -- fixture saja (superuser): baris anak pada kunjungan impor
      insert into public.invoices(visit_id, total) values ('{V['lama1']}', 12345);
      insert into public.inpatient_records(visit_id, branch_id, created_at, condition_status) values ('{V['lama1']}', '{CAB_B}', '2025-06-01T02:00:00Z', 'stabil');
      commit;""")
    # inpatient_records wajib bercabang dan dibatasi cabangnya sendiri (ir_all): rawat inap cabang B pada kunjungan impor
    # tidak terbuka bagi dokter/staf cabang A. (Produksi: 0 rawat inap/tagihan pada kunjungan impor; tulisnya terkunci.)
    for user, header in ((DOKTER_A, None), (DOKTER_A, hdr_a), (STAFF_A, None), (DOKTER_NONAKTIF, None)):
        n = sebagai(pg, f"select (select count(*) from public.invoices where visit_id = '{V['lama1']}') + (select count(*) from public.inpatient_records"
                        f" where visit_id = '{V['lama1']}') + (select count(*) from public.follow_ups where visit_id = '{V['lama1']}');", user, header)
        assert n == "0", ("dokter/staf membuka tagihan/rawat inap kunjungan impor", user, header, n)
    assert sebagai(pg, f"select count(*) from public.invoices where visit_id = '{V['lama1']}';", OWNER) == "1", "fixture tagihan tidak terlihat OWNER"
    # (Review Wowo a) STAFF dengan p_cabang cabang lain = 0 baris; FINANCE (lintas cabang) tidak berubah (PASS K).
    for cabang in (CAB_B, "c9000000-0000-4000-8000-000000000099"):
        assert rpc(pg, STAFF_A, cabang=cabang)["jumlah"] == 0, ("staf melihat cabang lain", cabang)
    print("PASS L: dokter/staf tidak membuka tagihan/rawat inap/follow-up kunjungan impor; staf p_cabang lain = 0 baris", flush=True)

    print("PASS J: hanya 3 kebijakan (isolasi USING + visits_select/mr_select setara logika) berubah; helper SECURITY INVOKER/STABLE,"
          " anon tanpa EXECUTE; idempoten", flush=True)


MUTASI = [
    ("impor tanpa cabang hilang dari filter cabang", "\n              or (v.branch_id is null and v.legacy_source_key is not null))", ")"),
    ("impor tanpa syarat legacy", "(v.branch_id is null and v.legacy_source_key is not null)", "(v.branch_id is null)"),
    ("arsip ikut di daftar umum", "and (p_pet is not null or v.archived_at is null)", ""),
    ("rawat inap aktif tidak disaring", "i.discharged_at is null", "false"),
    ("cari telepon hilang", " or strpos(lower(coalesce(c.phone, '')), v_cari) > 0", ""),
    ("urutan tanpa id", "order by s.created_at desc, s.id limit", "order by s.created_at desc limit"),
    ("SECURITY DEFINER", "stable security invoker", "stable security definer"),
    ("tanpa rekam medis ikut", "and exists (select 1 from public.medical_records m where m.visit_id = v.id)", ""),
]
# Mutasi migrasi akses dokter: (label, [(jangkar, ganti), ...]). Pra/pasca-cek bentuk kebijakan dilonggarkan (LONGGAR)
# supaya yang diuji adalah PERILAKU (tes di atas), bukan sekadar teks kebijakan yang ditolak pasca-cek.
LONGGAR = [("if v_k is null or v_k not in", "if false and v_k not in"),
           ("if v_k is distinct from pg_temp.dbi_bentuk", "if false and v_k is distinct from pg_temp.dbi_bentuk")]
POL_SQL = "branch_id is null and legacy_source_key is not null and (select public.dokter_aktif_baca_impor())"
MUTASI2 = [
    ("dokter nonaktif ikut", [(" and p.is_active", "")]),
    ("staf ikut membaca impor", [("p.role = 'DOCTOR'", "p.role in ('DOCTOR', 'STAFF')")]),
    # Mutan SETARA (tidak dimasukkan): membuang `legacy_source_key is not null` dari cabang dokter di restrictive tidak
    # mengubah perilaku karena permissive visits_select tetap mensyaratkan legacy untuk baris tanpa cabang. Dijaga oleh
    # pasca-cek bentuk kebijakan (teks persis), bukan oleh tes perilaku.
    ("tanpa syarat branch null (impor bercabang lain ikut)", LONGGAR + [(POL_SQL, POL_SQL.replace("branch_id is null and ", ""))]),
    ("visits_select kehilangan cabang impor", LONGGAR + [("using ((legacy_source_key is not null and (select public.can_read_legacy_medical_history()))", "using ((false)")]),
    # Mutan SETARA (tidak dimasukkan): "visits_select kehilangan ucab" — permissive visits_write (FOR ALL) sudah memberi
    # SELECT kunjungan bercabang lewat user_can_access_branch.
    ("mr_select kehilangan cabang impor", LONGGAR + [("(v.legacy_source_key is not null and (select public.can_read_legacy_medical_history()))", "(false)")]),
    # Mutan SETARA (tidak dimasukkan): "mr_select kehilangan ucab" — permissive mr_write (FOR ALL) sudah memberi SELECT
    # rekam medis bercabang lewat user_can_access_branch, jadi himpunan baris terlihat tidak berubah.
    ("helper SECURITY DEFINER", [("language sql stable security invoker", "language sql stable security definer")]),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pg-bin", default=os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin"))
    parser.add_argument("--mutations", action="store_true")
    parser.add_argument("--only", default="", help="hanya mutan yang labelnya memuat teks ini")
    args = parser.parse_args()
    asli = MIGRASI.read_text()
    if not args.mutations:
        with NativePostgres(args.pg_bin) as pg:
            jalankan(pg, asli)
        print("SEMUA PASS", flush=True)
        return
    gagal = []
    for label, lama, baru in MUTASI:
        if args.only not in label:
            continue
        assert asli.count(lama) == 1, f"jangkar mutasi tidak unik: {label}"
        teks = asli.replace(lama, baru)
        try:
            with NativePostgres(args.pg_bin) as pg:
                jalankan(pg, teks)
            gagal.append(label)
            print(f"MUTAN HIDUP: {label}", flush=True)
        except (AssertionError, RuntimeError) as error:
            print(f"MUTAN MATI: {label} -> {str(error).splitlines()[0][:160]}", flush=True)
    asli2 = MIGRASI2.read_text()
    for label, pasangan in MUTASI2:
        if args.only not in label:
            continue
        teks2 = asli2
        for lama, baru in pasangan:
            assert teks2.count(lama) >= 1, f"jangkar mutasi tidak ada: {label}"
            teks2 = teks2.replace(lama, baru)
        try:
            with NativePostgres(args.pg_bin) as pg:
                jalankan(pg, asli, teks2)
            gagal.append(label)
            print(f"MUTAN HIDUP: {label}", flush=True)
        except (AssertionError, RuntimeError) as error:
            print(f"MUTAN MATI: {label} -> {str(error).splitlines()[0][:160]}", flush=True)
    assert not gagal, f"mutan hidup: {gagal}"
    print(f"SEMUA MUTAN MATI ({len(MUTASI) + len(MUTASI2)})", flush=True)


if __name__ == "__main__":
    main()
