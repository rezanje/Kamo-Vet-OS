#!/usr/bin/env python3
"""Uji migrasi 20261105010000 (percepatan user_can_access_branch) di PostgreSQL sungguhan, data fiktif.

Babak:
  A. SKEMA PENUH — seluruh migrasi repo (kecuali migrasi ini) diputar dari nol. Sidik isi fungsi lama
     (user_can_access_branch & has_role_capability) harus sama dengan yang dikunci migrasi = yang dibaca
     dari Production 31 Okt 2026.
  B. GERBANG — migrasi menolak (gagal tertutup, tanpa perubahan) bila has_role_capability berbeda.
  C. KESETARAAN — salinan fungsi lama vs fungsi baru dibandingkan di matriks pengguna x cabang x header
     cabang operasional x pengaturan role_capabilities. Harus identik di semua kombinasi.
  D. IDEMPOTEN & ATRIBUT — migrasi kedua kalinya lolos; SECURITY DEFINER/STABLE/search_path/hak tetap.
  E. KECEPATAN — panggilan per baris sebagai `authenticated`: fungsi baru wajib jauh lebih cepat.

Tidak pernah terhubung ke Production: klaster lokal sekali pakai, socket unix, dibuang di akhir.

    python3 scripts/test-akses-cabang-cepat-postgres.py [--pg-bin DIR]
"""
import argparse
import importlib.util
import itertools
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

_spec = importlib.util.spec_from_file_location("hris", ROOT / "scripts/test-hris-cabang-postgres.py")
hris = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hris)

MIGRATIONS = ROOT / "supabase/migrations"
MIGRASI = MIGRATIONS / "20261105010000_akses_cabang_cepat.sql"
SIDIK_LAMA = {"public.user_can_access_branch(uuid)": "732c83442a975e7725c94de592e2b836",
              "public.has_role_capability(text)": "c5f1cee77a8984555bfcafaacb7b226e"}

CAB_A = "a0000000-0000-4000-8000-00000000000a"
CAB_B = "b0000000-0000-4000-8000-00000000000b"
CAB_X = "c0000000-0000-4000-8000-00000000000c"   # cabang nonaktif
TAK_ADA = "f0000000-0000-4000-8000-00000000000f"  # bukan cabang
PENGGUNA = {
    "owner": ("10000000-0000-4000-8000-000000000001", "OWNER", True, []),
    "owner_nonaktif": ("10000000-0000-4000-8000-000000000002", "OWNER", False, []),
    "admin": ("10000000-0000-4000-8000-000000000003", "ADMIN", True, [CAB_A]),
    "finance": ("10000000-0000-4000-8000-000000000004", "FINANCE", True, []),
    "staff_a": ("10000000-0000-4000-8000-000000000005", "STAFF", True, [CAB_A]),
    "staff_ax": ("10000000-0000-4000-8000-000000000006", "STAFF", True, [CAB_A, CAB_X]),
    "dokter_kosong": ("10000000-0000-4000-8000-000000000007", "DOCTOR", True, []),
    "staff_nonaktif": ("10000000-0000-4000-8000-000000000008", "STAFF", False, [CAB_A]),
}
TANPA_PROFIL = "10000000-0000-4000-8000-0000000000ff"
CABANG = [CAB_A, CAB_B, CAB_X, TAK_ADA, None]
HEADER = [None, "", "{}", '{"x-kamo-operational-branch":""}'] + [
    '{"x-kamo-operational-branch":"%s"}' % c for c in (CAB_A, CAB_B, CAB_X, TAK_ADA)]
# role_capabilities: tanpa baris (bawaan), dan baris yang membalik bawaan per role.
KAPABILITAS = [
    "delete from public.role_capabilities;",
    "delete from public.role_capabilities; insert into public.role_capabilities(role, all_branches, create_accounts) values"
    " ('ADMIN', false, false), ('FINANCE', true, false), ('STAFF', true, false), ('DOCTOR', false, false);",
    "delete from public.role_capabilities; insert into public.role_capabilities(role, all_branches, create_accounts) values"
    " ('ADMIN', true, false), ('FINANCE', false, false), ('OWNER', false, false), ('DOCTOR', true, false);",
]


def q(v):
    return "null" if v is None else "'" + v.replace("'", "''") + "'"


def data(pg):
    users = list(PENGGUNA.values())
    pg.sql("insert into auth.users(id) values " + ",".join(f"('{u[0]}')" for u in users) + " on conflict do nothing;")
    pg.sql("insert into public.profiles(id, role, is_active, full_name) values "
           + ",".join(f"('{u[0]}','{u[1]}',{str(u[2]).lower()},'Uji {n}')" for n, u in PENGGUNA.items())
           + " on conflict (id) do update set role=excluded.role, is_active=excluded.is_active;")
    pg.sql(f"""insert into public.branches(id, code, name, type, is_active) values
      ('{CAB_A}','UJI-A','Cabang Uji A','KLINIK',true), ('{CAB_B}','UJI-B','Cabang Uji B','BOTH',true),
      ('{CAB_X}','UJI-X','Cabang Uji X','KLINIK',false);""")
    pg.sql("insert into public.user_branches(user_id, branch_id) values "
           + ",".join(f"('{u[0]}','{b}')" for u in users for b in u[3]) + ";")


def matriks(pg, fungsi):
    """Satu query besar: tiap kombinasi pengguna x cabang x header -> hasil fungsi."""
    hasil = {}
    uids = [u[0] for u in PENGGUNA.values()] + [TANPA_PROFIL, None]
    for uid, header in itertools.product(uids, HEADER):
        klaim = "" if uid is None else f"select set_config('request.jwt.claim.sub', '{uid}', true);"
        baris = pg.sql(
            "begin; set local role authenticated;\n" + klaim
            + ("" if header is None else f"select set_config('request.headers', {q(header)}, true);\n")
            + "select string_agg(coalesce(b::text,'null') || '=' || coalesce(" + fungsi + "(b)::text,'NULL'), ',' order by n) from unnest(array["
            + ",".join(f"{q(c)}::uuid" for c in CABANG) + "]) with ordinality as t(b, n);\ncommit;")
        hasil[(uid, header)] = baris.splitlines()[-1]
    return hasil


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pg-bin", default=os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin"))
    args = parser.parse_args()
    with NativePostgres(args.pg_bin) as pg:
        # A. skema penuh
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
        print(f"PASS A1: {len(lain)} migrasi repo (tanpa migrasi ini) berjalan dari nol", flush=True)
        for sig, sidik in SIDIK_LAMA.items():
            nyata = pg.last(f"select md5(prosrc) from pg_proc where oid='{sig}'::regprocedure;")
            assert nyata == sidik, f"{sig}: sidik lokal {nyata} != sidik Production yang dikunci {sidik}"
        print("PASS A2: isi fungsi lama hasil skema penuh = sidik Production yang dikunci migrasi", flush=True)
        acl_lama = pg.last("select proacl::text from pg_proc where oid='public.user_can_access_branch(uuid)'::regprocedure;")

        # salinan fungsi lama untuk pembanding (definisi persis, nama berbeda)
        pg.sql(pg.sql("select replace(pg_get_functiondef('public.user_can_access_branch(uuid)'::regprocedure),"
                      " 'public.user_can_access_branch(', 'public.uji_akses_lama(');")
               + ";\ngrant execute on function public.uji_akses_lama(uuid) to authenticated;")
        data(pg)

        # B. gerbang
        try:
            pg.sql("begin;\ncreate or replace function public.has_role_capability(capability text) returns boolean"
                   " language sql stable security definer set search_path='' as $f$ select true $f$;\n"
                   + MIGRASI.read_text() + "\ncommit;")
            raise AssertionError("Migrasi seharusnya menolak has_role_capability yang berbeda")
        except RuntimeError as error:
            assert "definisi has_role_capability berbeda" in str(error), str(error)[:500]
        assert pg.last("select md5(prosrc) from pg_proc where oid='public.has_role_capability(text)'::regprocedure;") \
            == SIDIK_LAMA["public.has_role_capability(text)"]
        assert pg.last("select md5(prosrc) from pg_proc where oid='public.user_can_access_branch(uuid)'::regprocedure;") \
            == SIDIK_LAMA["public.user_can_access_branch(uuid)"]
        print("PASS B: has_role_capability berbeda -> migrasi gagal tertutup, tidak ada yang berubah", flush=True)

        # Hasil lama (fungsi asli sebelum migrasi) per pengaturan kapabilitas.
        lama = []
        for kap in KAPABILITAS:
            pg.sql(kap)
            lama.append(matriks(pg, "public.user_can_access_branch"))

        pg.sql("begin;\n" + MIGRASI.read_text() + "\ncommit;")
        print("PASS D1: migrasi berjalan di atas skema penuh", flush=True)

        # C. kesetaraan
        total = 0
        for kap, sebelum in zip(KAPABILITAS, lama):
            pg.sql(kap)
            baru = matriks(pg, "public.user_can_access_branch")
            salinan = matriks(pg, "public.uji_akses_lama")
            for kunci in sebelum:
                assert baru[kunci] == sebelum[kunci] == salinan[kunci], \
                    f"BEDA {kunci}: lama={sebelum[kunci]} baru={baru[kunci]} salinan={salinan[kunci]}"
                total += len(CABANG)
        benar = sum(v.count("=true") for m in lama for v in m.values())
        assert 0 < benar < total, "matriks tidak menguji kedua hasil"
        print(f"PASS C: {total} kombinasi (pengguna x cabang x header x kapabilitas) identik; {benar} diizinkan,"
              f" {total - benar} ditolak", flush=True)

        # D. idempoten & atribut
        pg.sql("begin;\n" + MIGRASI.read_text() + "\ncommit;")
        attr = pg.last("select prosecdef::text||'|'||provolatile::text||'|'||array_to_string(proconfig,',')||'|'||proacl::text"
                       " from pg_proc where oid='public.user_can_access_branch(uuid)'::regprocedure;")
        assert attr == f'true|s|search_path=""|{acl_lama}', attr
        print("PASS D2: migrasi kedua kalinya lolos; SECURITY DEFINER, STABLE, search_path, hak EXECUTE tetap", flush=True)

        # E. kecepatan (per baris, seperti RLS), sebagai OWNER tanpa header
        pg.sql(KAPABILITAS[0])
        owner = PENGGUNA["owner"][0]

        def ukur(fungsi):
            mulai = time.perf_counter()
            pg.sql(f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{owner}',true);"
                   f" select count(*) from generate_series(1,20000) g where {fungsi}(case when g>0 then '{CAB_A}'::uuid end); commit;")
            return time.perf_counter() - mulai
        t_lama, t_baru = min(ukur("public.uji_akses_lama") for _ in range(2)), min(ukur("public.user_can_access_branch") for _ in range(2))
        assert t_baru * 3 < t_lama, f"tidak cukup cepat: lama {t_lama:.2f}s, baru {t_baru:.2f}s"
        print(f"PASS E: 20.000 panggilan per baris: lama {t_lama:.2f}s -> baru {t_baru:.2f}s ({t_lama / t_baru:.1f}x)", flush=True)
    print("SEMUA PASS", flush=True)


if __name__ == "__main__":
    main()
