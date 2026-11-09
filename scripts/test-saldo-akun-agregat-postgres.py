#!/usr/bin/env python3
"""Uji migrasi 20261109084230 (saldo per akun dihitung di database) di PostgreSQL sungguhan, data fiktif.

Babak:
  A. SKEMA PENUH — seluruh migrasi repo diputar dari nol, termasuk migrasi ini (dua kali: idempoten).
  B. KESETARAAN HAK BACA — untuk tiap pengguna x header cabang operasional x filter (periode/cabang),
     hasil public.ledger_account_totals() == agregat yang sama lewat tabel langsung sebagai
     `authenticated` (RLS jl_all/je_all yang berlaku). Harus identik di semua kombinasi.
  C. PAGAR — anon tidak bisa memanggil; fungsi STABLE, SECURITY DEFINER, search_path kosong.
  D. KECEPATAN — 60.000 baris jurnal: RPC jauh lebih cepat daripada membaca baris lewat RLS.

Tidak pernah terhubung ke Production: klaster lokal sekali pakai, socket unix, dibuang di akhir.

    python3 scripts/test-saldo-akun-agregat-postgres.py [--pg-bin DIR]
"""
import argparse
import importlib.util
import itertools
import json
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
MIGRASI = MIGRATIONS / "20261109084230_saldo_akun_agregat.sql"

CAB_A = "a0000000-0000-4000-8000-00000000000a"
CAB_B = "b0000000-0000-4000-8000-00000000000b"
CAB_X = "c0000000-0000-4000-8000-00000000000c"   # cabang nonaktif
PENGGUNA = {
    "owner": ("10000000-0000-4000-8000-000000000001", "OWNER", True, []),
    "admin_a": ("10000000-0000-4000-8000-000000000003", "ADMIN", True, [CAB_A]),
    "staff_a": ("10000000-0000-4000-8000-000000000005", "STAFF", True, [CAB_A]),
    "staff_ax": ("10000000-0000-4000-8000-000000000006", "STAFF", True, [CAB_A, CAB_X]),
    "dokter_kosong": ("10000000-0000-4000-8000-000000000007", "DOCTOR", True, []),
    "staff_nonaktif": ("10000000-0000-4000-8000-000000000008", "STAFF", False, [CAB_A]),
}
TANPA_PROFIL = "10000000-0000-4000-8000-0000000000ff"
HEADER = [None, '{"x-kamo-operational-branch":"%s"}' % CAB_A, '{"x-kamo-operational-branch":"%s"}' % CAB_B]
# (p_from, p_to, p_branch_ids) — None = tanpa filter
FILTER = [(None, None, None), ("2026-02-01", None, None), (None, "2026-02-28", None), ("2026-02-01", "2026-03-31", None),
          (None, None, [CAB_A]), (None, None, [CAB_A, CAB_B]), ("2026-01-15", "2026-03-15", [CAB_B, CAB_X])]
AKUN = [f"e{n:07d}-0000-4000-8000-000000000000" for n in range(1, 5)]


def q(v):
    return "null" if v is None else "'" + v.replace("'", "''") + "'"


def arr(ids):
    return "null" if ids is None else "array[" + ",".join(f"'{i}'" for i in ids) + "]::uuid[]"


def data(pg, per_entry=1):
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
    pg.sql("insert into public.coa_accounts(id, code, name, type, normal_balance) values "
           + ",".join(f"('{a}','UJI{i}','Akun Uji {i}','{t}','{n}')"
                      for i, (a, (t, n)) in enumerate(zip(AKUN, [("ASET", "D"), ("PENDAPATAN", "K"), ("BEBAN", "D"), ("LIABILITAS", "K")])))
           + ";")


def isi_jurnal(pg, jumlah, mulai=1):
    """`jumlah` jurnal seimbang (2 baris), tersebar di 3 cabang + tanpa cabang, Jan–Apr 2026, nominal pecahan."""
    pg.sql(f"""
      with e as (
        insert into public.journal_entries(id, no_jurnal, tanggal, deskripsi, source, branch_id)
        select gen_random_uuid(), 'UJI-' || g, date '2026-01-01' + (g % 120), 'uji', 'manual',
               (array['{CAB_A}','{CAB_B}','{CAB_X}',null]::uuid[])[1 + g % 4]
        from generate_series({mulai}, {mulai} + {jumlah} - 1) g
        returning id, no_jurnal
      ), n as (select id, substr(no_jurnal, 5)::int g from e)
      insert into public.journal_lines(entry_id, account_id, debit, credit)
      select id, (array['{AKUN[0]}','{AKUN[2]}']::uuid[])[1 + g % 2], (g % 997) + 0.25, 0 from n
      union all
      select id, (array['{AKUN[1]}','{AKUN[3]}']::uuid[])[1 + g % 2], 0, (g % 997) + 0.25 from n;""")


def sesi(uid, header):
    s = "begin; set local role authenticated;\n"
    if uid is not None:
        s += f"select set_config('request.jwt.claim.sub', '{uid}', true);\n"
    if header is not None:
        s += f"select set_config('request.headers', {q(header)}, true);\n"
    return s


def lewat_rls(pg, uid, header, f):
    dari, sampai, cabang = f
    where = ["true"]
    if dari:
        where.append(f"e.tanggal >= '{dari}'")
    if sampai:
        where.append(f"e.tanggal <= '{sampai}'")
    if cabang is not None:
        where.append(f"e.branch_id = any({arr(cabang)})")
    out = pg.sql(sesi(uid, header) + "select coalesce(jsonb_agg(jsonb_build_object('account_id',account_id,'debit',debit,'credit',credit) order by account_id),'[]')"
                 " from (select l.account_id, sum(l.debit) debit, sum(l.credit) credit from public.journal_lines l"
                 " join public.journal_entries e on e.id = l.entry_id where " + " and ".join(where) + " group by l.account_id) t;\ncommit;")
    return json.loads(out.splitlines()[-1])


def lewat_rpc(pg, uid, header, f):
    dari, sampai, cabang = f
    out = pg.sql(sesi(uid, header) + f"select public.ledger_account_totals({q(dari)}::date, {q(sampai)}::date, {arr(cabang)});\ncommit;")
    return json.loads(out.splitlines()[-1])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pg-bin", default=os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin"))
    args = parser.parse_args()
    with NativePostgres(args.pg_bin) as pg:
        # A. skema penuh
        pg.sql(hris.PLATFORM)
        pg.sql(hris.PERAN)
        semua = sorted(MIGRATIONS.glob("*.sql"))
        assert MIGRASI in semua
        for berkas in semua:
            if berkas.name in hris.SEBELUM:
                pg.sql(hris.SEBELUM[berkas.name])
            try:
                pg.sql("begin;\n" + berkas.read_text() + "\ncommit;")
            except RuntimeError as error:
                raise AssertionError(f"Migrasi {berkas.name} gagal di klaster bersih:\n{str(error)[:2000]}") from None
        pg.sql("begin;\n" + MIGRASI.read_text() + "\ncommit;")
        print(f"PASS A: {len(semua)} migrasi repo berjalan dari nol; migrasi ini idempoten (dua kali)", flush=True)

        data(pg)
        isi_jurnal(pg, 400)

        # B. kesetaraan hak baca
        uids = [u[0] for u in PENGGUNA.values()] + [TANPA_PROFIL]
        total, berisi, beda_isi = 0, 0, set()
        for uid, header, f in itertools.product(uids, HEADER, FILTER):
            rls, rpc = lewat_rls(pg, uid, header, f), lewat_rpc(pg, uid, header, f)
            assert rls == rpc, f"BEDA uid={uid} header={header} filter={f}:\n rls={rls}\n rpc={rpc}"
            total += 1
            berisi += bool(rpc)
            beda_isi.add(json.dumps(rpc))
        assert 0 < berisi < total and len(beda_isi) > 5, "matriks tidak menguji cukup variasi hak baca/filter"
        print(f"PASS B: {total} kombinasi (pengguna x header cabang x filter) identik dengan RLS tabel langsung;"
              f" {len(beda_isi)} hasil berbeda, {total - berisi} kosong", flush=True)

        # C. pagar
        try:
            pg.sql("begin; set local role anon; select public.ledger_account_totals(); commit;")
            raise AssertionError("anon seharusnya ditolak")
        except RuntimeError as error:
            assert "permission denied" in str(error), str(error)[:300]
        attr = pg.last("select prosecdef::text||'|'||provolatile::text||'|'||array_to_string(proconfig,',')"
                       " from pg_proc where oid='public.ledger_account_totals(date,date,uuid[])'::regprocedure;")
        assert attr == 'true|s|search_path=""', attr
        print("PASS C: anon ditolak; SECURITY DEFINER, STABLE, search_path kosong", flush=True)

        # D. kecepatan, sebagai staff cabang A (RLS per baris benar-benar bekerja)
        isi_jurnal(pg, 30000, mulai=1000)  # +60.000 baris
        staff = PENGGUNA["staff_a"][0]

        def ukur(sql):
            mulai = time.perf_counter()
            pg.sql(sesi(staff, None) + sql + "\ncommit;")
            return time.perf_counter() - mulai
        # Pembaca lama: count exact + satu halaman 500 baris, per halaman (di sini cukup SATU halaman).
        t_halaman = min(ukur("select count(*) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id;"
                             " select l.id from public.journal_lines l join public.journal_entries e on e.id=l.entry_id order by l.id limit 500;")
                        for _ in range(2))
        t_rpc = min(ukur("select public.ledger_account_totals();") for _ in range(2))
        baris = int(pg.last("select count(*) from public.journal_lines;"))
        halaman = -(-baris // 500)
        assert t_rpc < t_halaman * halaman / 5, f"tidak cukup cepat: rpc {t_rpc:.2f}s vs {halaman} halaman x {t_halaman:.2f}s"
        print(f"PASS D: {baris} baris jurnal: RPC {t_rpc:.2f}s, pembaca lama ±{halaman} halaman x {t_halaman:.2f}s"
              f" = ±{halaman * t_halaman:.0f}s", flush=True)
    print("SEMUA PASS", flush=True)


if __name__ == "__main__":
    main()
