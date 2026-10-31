#!/usr/bin/env python3
"""Uji migrasi 20261104350000 (RPC daftar_rekam_medis) di PostgreSQL sungguhan, data fiktif.

Seluruh migrasi repo diputar dari nol, lalu sebagai `authenticated` + klaim JWT (seperti PostgREST):
  1. Hasil RPC = hasil SELECT biasa padanannya (embed PostgREST lama: medical_records inner, pets, customers,
     branches, inpatient_records) untuk OWNER, STAFF cabang A, DOCTOR tanpa cabang, dan header cabang aktif —
     karena RPC SECURITY INVOKER, RLS pemanggil berlaku persis sama.
  2. STAFF cabang A tidak melihat kunjungan cabang B; kunjungan tanpa rekam medis tidak ikut; filter hewan jalan;
     urutan created_at desc, id; jumlah = panjang baris.
  3. anon tidak bisa memanggil; atribut fungsi (INVOKER, STABLE, search_path) benar; migrasi idempoten.

Tidak pernah terhubung ke Production.

    python3 scripts/test-daftar-rekam-medis-postgres.py [--pg-bin DIR]
"""
import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

_spec = importlib.util.spec_from_file_location("hris", ROOT / "scripts/test-hris-cabang-postgres.py")
hris = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hris)

MIGRATIONS = ROOT / "supabase/migrations"
MIGRASI = MIGRATIONS / "20261104350000_daftar_rekam_medis_sekali_baca.sql"

OWNER = "20000000-0000-4000-8000-000000000001"
STAFF_A = "20000000-0000-4000-8000-000000000002"
DOKTER_KOSONG = "20000000-0000-4000-8000-000000000003"
CAB_A = "a1000000-0000-4000-8000-00000000000a"
CAB_B = "b1000000-0000-4000-8000-00000000000b"
CUST = "c1000000-0000-4000-8000-000000000001"
PET_1 = "e1000000-0000-4000-8000-000000000001"
PET_2 = "e1000000-0000-4000-8000-000000000002"
V = {k: f"f1000000-0000-4000-8000-00000000000{i}" for i, k in enumerate(["a_mr", "a_tanpa", "b_mr", "lama", "a_inap", "a_mr2"], 1)}

DATA = f"""
insert into auth.users(id) values ('{OWNER}'),('{STAFF_A}'),('{DOKTER_KOSONG}');
insert into public.profiles(id, role, is_active, full_name) values
  ('{OWNER}','OWNER',true,'Pemilik Uji'),('{STAFF_A}','STAFF',true,'Staf A'),('{DOKTER_KOSONG}','DOCTOR',true,'Dokter Uji')
on conflict (id) do update set role=excluded.role, is_active=excluded.is_active;
insert into public.branches(id, code, name, type, is_active) values
  ('{CAB_A}','UJI-A','Cabang Uji A','KLINIK',true),('{CAB_B}','UJI-B','Cabang Uji B','KLINIK',true);
insert into public.user_branches(user_id, branch_id) values ('{STAFF_A}','{CAB_A}');
insert into public.customers(id, name, phone) values ('{CUST}','UJI PEMILIK','0800000001');
insert into public.pets(id, customer_id, name, species, breed) values
  ('{PET_1}','{CUST}','UJI KUCING','Kucing',null),('{PET_2}','{CUST}','UJI ANJING','Anjing','Lokal');
insert into public.visits(id, branch_id, customer_id, pet_id, created_at, dokter, keluhan, legacy_source_key) values
  ('{V['a_mr']}','{CAB_A}','{CUST}','{PET_1}','2026-01-03T01:00:00Z','drh. A','Keluhan A',null),
  ('{V['a_mr2']}','{CAB_A}','{CUST}','{PET_2}','2026-01-03T01:00:00Z','drh. A2','Keluhan A2',null),
  ('{V['a_tanpa']}','{CAB_A}','{CUST}','{PET_1}','2026-01-04T01:00:00Z','drh. A','Tanpa rekam',null),
  ('{V['b_mr']}','{CAB_B}','{CUST}','{PET_1}','2026-01-02T01:00:00Z','drh. B','Keluhan B',null),
  ('{V['lama']}',null,'{CUST}','{PET_1}','2025-06-01T01:00:00Z','drh. Lama','Keluhan lama','uji::lama-1'),
  ('{V['a_inap']}','{CAB_A}','{CUST}','{PET_2}','2026-01-05T01:00:00Z','drh. Inap','Rawat inap',null);
insert into public.medical_records(visit_id, diagnosis, anamnesis) values
  ('{V['a_mr']}','Dx A','Ana A'),('{V['a_mr2']}','Dx A2',null),('{V['b_mr']}','Dx B','Ana B'),
  ('{V['lama']}','Dx lama','Ana lama'),('{V['a_inap']}','Dx inap','Ana inap');
"""

# Padanan embed PostgREST lama, dijalankan sebagai pemanggil yang sama (RLS sama).
SELECT_BIASA = """
select coalesce(jsonb_agg(jsonb_build_object(
  'id', v.id, 'pet_id', v.pet_id, 'branch_id', v.branch_id, 'created_at', v.created_at, 'dokter', v.dokter,
  'keluhan', v.keluhan, 'legacy_source_key', v.legacy_source_key,
  'pets', (select jsonb_build_object('name', p.name, 'species', p.species, 'breed', p.breed) from public.pets p where p.id = v.pet_id),
  'customers', (select jsonb_build_object('name', c.name, 'phone', c.phone) from public.customers c where c.id = v.customer_id),
  'branches', (select jsonb_build_object('code', b.code) from public.branches b where b.id = v.branch_id),
  'medical_records', (select jsonb_agg(jsonb_build_object('diagnosis', m.diagnosis, 'anamnesis', m.anamnesis) order by m.id) from public.medical_records m where m.visit_id = v.id),
  'inpatient_records', coalesce((select jsonb_agg(jsonb_build_object('created_at', i.created_at, 'discharged_at', i.discharged_at, 'condition_status', i.condition_status) order by i.created_at, i.id) from public.inpatient_records i where i.visit_id = v.id), '[]'::jsonb)
) order by v.created_at desc, v.id), '[]'::jsonb)
from public.visits v where (PET is null or v.pet_id = PET) and exists (select 1 from public.medical_records m where m.visit_id = v.id)
"""


def sebagai(pg, perintah, user, header=None):
    hdr = "" if header is None else f"select set_config('request.headers', '{json.dumps(header)}', true);\n"
    return pg.sql("begin;\nset local role authenticated;\n"
                  f"select set_config('request.jwt.claim.sub', '{user}', true);\n" + hdr + perintah + "\ncommit;").splitlines()[-1]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pg-bin", default=os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin"))
    args = parser.parse_args()
    with NativePostgres(args.pg_bin) as pg:
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
        pg.sql(DATA)
        pg.sql(f"""begin; set local session_replication_role = replica;  -- fixture saja: lewati trigger alur rawat inap
                   insert into public.inpatient_records(visit_id, branch_id, created_at, condition_status)
                   select '{V['a_inap']}', '{CAB_A}', '2026-01-05T02:00:00Z', 'stabil'; commit;""")
        pg.sql("begin;\n" + MIGRASI.read_text() + "\ncommit;")
        pg.sql("begin;\n" + MIGRASI.read_text() + "\ncommit;")
        print("PASS B: migrasi berjalan dan idempoten (dua kali)", flush=True)

        kasus = [("OWNER", OWNER, None), ("STAFF cabang A", STAFF_A, None), ("DOKTER tanpa cabang", DOKTER_KOSONG, None),
                 ("OWNER header cabang A", OWNER, {"x-kamo-operational-branch": CAB_A}),
                 ("STAFF header cabang B", STAFF_A, {"x-kamo-operational-branch": CAB_B})]
        lihat = {}
        for label, user, header in kasus:
            for pet in (None, PET_1):
                p = "null::uuid" if pet is None else f"'{pet}'::uuid"
                rpc = json.loads(sebagai(pg, f"select public.daftar_rekam_medis({p})::text;", user, header))
                biasa = json.loads(sebagai(pg, "select (" + SELECT_BIASA.replace("PET", p) + ")::text;", user, header))
                assert rpc["baris"] == biasa, f"{label} pet={pet}: RPC berbeda dari SELECT biasa\n{rpc}\n{biasa}"
                assert rpc["jumlah"] == len(rpc["baris"]), f"{label}: jumlah tidak cocok"
                lihat[(label, pet)] = [r["id"] for r in rpc["baris"]]
        print(f"PASS C: {len(kasus) * 2} kombinasi pemanggil x filter hewan: RPC = SELECT biasa (RLS sama)", flush=True)

        semua = lihat[("OWNER", None)]
        assert V["a_tanpa"] not in semua, "kunjungan tanpa rekam medis ikut"
        assert semua == [V["a_inap"], V["a_mr"], V["a_mr2"], V["b_mr"], V["lama"]], f"urutan/isi OWNER salah: {semua}"
        assert V["b_mr"] not in lihat[("STAFF cabang A", None)], "STAFF A melihat cabang B"
        assert V["a_mr"] in lihat[("STAFF cabang A", None)]
        assert set(lihat[("OWNER", PET_1)]) == {V["a_mr"], V["b_mr"], V["lama"]}, lihat[("OWNER", PET_1)]
        assert V["b_mr"] not in lihat[("OWNER header cabang A", None)], "header cabang A masih melihat cabang B"
        inap = json.loads(sebagai(pg, f"select public.daftar_rekam_medis('{PET_2}')::text;", OWNER))["baris"][0]
        assert inap["inpatient_records"] and inap["inpatient_records"][0]["condition_status"] == "stabil", inap
        print(f"PASS D: isi & batas akses benar (OWNER {len(semua)}, STAFF A {len(lihat[('STAFF cabang A', None)])},"
              f" DOKTER tanpa cabang {len(lihat[('DOKTER tanpa cabang', None)])}, tanpa rekam medis tidak ikut, urutan benar)", flush=True)

        try:
            pg.sql("begin; set local role anon; select public.daftar_rekam_medis(null); commit;")
            raise AssertionError("anon seharusnya ditolak")
        except RuntimeError as error:
            assert "permission denied" in str(error), str(error)[:300]
        attr = pg.last("select prosecdef::text||'|'||provolatile::text||'|'||array_to_string(proconfig,',')"
                       " from pg_proc where oid='public.daftar_rekam_medis(uuid)'::regprocedure;")
        assert attr == 'false|s|search_path=""', attr
        print("PASS E: anon ditolak; SECURITY INVOKER, STABLE, search_path kosong", flush=True)
    print("SEMUA PASS", flush=True)


if __name__ == "__main__":
    main()
