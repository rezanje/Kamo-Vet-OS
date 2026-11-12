#!/usr/bin/env python3
"""Uji migrasi 20261115100000 (diskon manual hanya Owner/Admin) di PostgreSQL sungguhan, data fiktif.

Permintaan Aldi (grup Kamo, 12 Nov 2026): "Yg diskon jangan dikasih ke karyawan mas biar akun admin ajh".

Seluruh migrasi repo diputar dari nol TANPA migrasi ini, lalu:
  A. Sebelum: fungsi pemeriksa belum ada (aplikasi baru membacanya sesudah migrasi).
  B. Migrasi dipasang; pasang ulang gagal ("already exists"); katalog enforced; hanya authenticated yang boleh memanggil.
  C. Bawaan (tanpa kebijakan tersimpan): OWNER boleh, ADMIN boleh, STAFF/DOCTOR/FINANCE tidak, akun nonaktif tidak, tanpa login tidak.
  D. Owner mencentang izin untuk STAFF lewat simpan Akses Grup resmi -> STAFF boleh; Owner menyimpan ADMIN tanpa izin ini -> ADMIN
     tidak boleh; OWNER tetap boleh.
  E. Non-owner tidak bisa mengubah kebijakan (ROLE_OWNER_REQUIRED).

Tidak pernah terhubung ke Production.

    python3 scripts/test-diskon-manual-postgres.py [--pg-bin DIR]
"""
import argparse
import importlib.util
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

_spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fixture)

MIGRASI = ROOT / "supabase/migrations/20261115100000_diskon_manual_owner_admin.sql"


def uid(n):
    return f"0d150000-0000-4000-8000-{n:012d}"


USERS = {"OWNER": uid(1), "ADMIN": uid(2), "STAFF": uid(3), "DOCTOR": uid(4), "FINANCE": uid(5), "ADMIN_NONAKTIF": uid(6)}

FIXTURES = "begin;\n" + "".join(
    f"insert into auth.users(id,raw_user_meta_data) values('{u}','{{\"full_name\":\"Akun fiktif {k}\"}}');\n"
    f"update profiles set role='{k.split('_')[0]}',is_active={'false' if k.endswith('NONAKTIF') else 'true'} where id='{u}';\n"
    for k, u in USERS.items()) + "commit;\n"


def sebagai(key):
    u = USERS[key]
    return (f"set local role authenticated;\nselect set_config('request.jwt.claim.sub','{u}',true);\n"
            f"select set_config('request.jwt.claims','{{\"role\":\"authenticated\",\"sub\":\"{u}\"}}',true);\n")


def boleh(pg, key):
    return pg.last("begin;\n" + sebagai(key) + "select public.manual_discount_allowed();\ncommit;")


def simpan_aksi(pg, aktor, role, actions):
    return pg.last("begin;\n" + sebagai(aktor) + f"""select public.save_role_access_config(
 '{role}', (public.get_role_access_config('{role}')->>'revision'), gen_random_uuid(), 'custom',
 public.get_role_access_config('{role}')->'modules', public.get_role_access_config('{role}')->'capabilities',
 'Uji diskon manual', '{actions}'::jsonb)->>'role';
commit;""")


def gagal(pg, sql, potongan):
    try:
        pg.sql(sql)
    except RuntimeError as error:
        assert potongan in str(error), str(error)
        return
    raise AssertionError(f"seharusnya gagal: {potongan}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg-bin", default=os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin"))
    args = ap.parse_args()
    Path("/opt/data").mkdir(parents=True, exist_ok=True)
    with NativePostgres(args.pg_bin) as pg:
        teks = MIGRASI.read_text()

        class TanpaMigrasiIni:
            def sql(self, source):
                return "" if teks in source else pg.sql(source)

        fixture.DisposablePostgres.bootstrap(TanpaMigrasiIni())
        pg.sql(FIXTURES)

        assert pg.last("select to_regprocedure('public.manual_discount_allowed()') is null;") == "t"
        print("PASS A: sebelum migrasi, pemeriksa izin diskon manual belum ada", flush=True)

        pg.sql("begin;\n" + teks + "\ncommit;")
        gagal(pg, "begin;\n" + teks + "\ncommit;", "already exists")
        assert pg.last("select enforced from role_settings_private.action_catalog where id='kasir.diskon_manual';") == "t"
        assert pg.last("select module_id from role_settings_private.action_modules where id='kasir.diskon_manual';") == "kasir"
        hak = pg.last("""select has_function_privilege('authenticated','public.manual_discount_allowed()','EXECUTE')||'|'||
 has_function_privilege('anon','public.manual_discount_allowed()','EXECUTE');""")
        assert hak == "true|false", hak
        print("PASS B: migrasi terpasang, pasang ulang gagal, katalog enforced (modul kasir), anon tidak bisa memanggil", flush=True)

        hasil = {k: boleh(pg, k) for k in USERS}
        assert hasil == {"OWNER": "t", "ADMIN": "t", "STAFF": "f", "DOCTOR": "f", "FINANCE": "f", "ADMIN_NONAKTIF": "f"}, hasil
        assert pg.last("select public.manual_discount_allowed();") == "f"
        print(f"PASS C: bawaan {hasil}; tanpa login = f", flush=True)

        assert simpan_aksi(pg, "OWNER", "STAFF", '["kasir.diskon_manual"]') == "STAFF"
        assert boleh(pg, "STAFF") == "t"
        assert simpan_aksi(pg, "OWNER", "ADMIN", "[]") == "ADMIN"
        assert boleh(pg, "ADMIN") == "f"
        assert boleh(pg, "OWNER") == "t"
        assert boleh(pg, "DOCTOR") == "f"
        print("PASS D: Owner mencentang STAFF -> boleh; Owner melepas ADMIN -> tidak boleh; OWNER tetap boleh", flush=True)

        gagal(pg, "begin;\n" + sebagai("ADMIN") + """select public.save_role_access_config('STAFF',
 (public.get_role_access_config('STAFF')->>'revision'), gen_random_uuid(), 'custom', '[]'::jsonb, null, 'coba', '[]'::jsonb);
commit;""", "ROLE_OWNER_REQUIRED")
        print("PASS E: selain Owner tidak bisa mengubah izin", flush=True)
    print("SEMUA LULUS", flush=True)


if __name__ == "__main__":
    main()
