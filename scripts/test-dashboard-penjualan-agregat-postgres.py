#!/usr/bin/env python3
"""Uji migrasi 20261118045543 (Dashboard: penjualan kasir & tagihan klinik dijumlah di database), data fiktif.

Babak:
  A. SKEMA PENUH — seluruh migrasi repo diputar dari nol, termasuk migrasi ini (dua kali: idempoten).
  B. KESETARAAN — untuk tiap pengguna x pilihan cabang operasional x tanggal "hari ini", hasil public.dashboard_penjualan_ringkas()
     == aturan pembaca lama di src/lib/dashboard.ts (ditulis ulang di sini dalam Python) yang dijalankan atas
     baris yang terbaca pengguna itu lewat tabel langsung (RLS yang berlaku). Harus identik.
  C. PAGAR — anon tidak bisa memanggil; fungsi utama SECURITY INVOKER, pembantu kasir SECURITY DEFINER
     (cek cabang sekali per cabang); keduanya STABLE, search_path kosong.
  D. KECEPATAN — 150.000 struk kasir (±1 tahun): RPC jauh lebih cepat daripada pembaca lama
     (500 baris + count exact per permintaan, berurutan).

Tidak pernah terhubung ke Production: klaster lokal sekali pakai, socket unix, dibuang di akhir.

    python3 -I scripts/test-dashboard-penjualan-agregat-postgres.py [--pg-bin DIR]
"""
import argparse
import importlib.util
import itertools
import json
import os
import sys
import time
from decimal import Decimal
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

_spec = importlib.util.spec_from_file_location("hris", ROOT / "scripts/test-hris-cabang-postgres.py")
hris = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hris)

MIGRATIONS = ROOT / "supabase/migrations"
MIGRASI = MIGRATIONS / "20261118045543_dashboard_penjualan_agregat.sql"
FUNGSI = "public.dashboard_penjualan_ringkas"

CAB_A = "a0000000-0000-4000-8000-00000000000a"
CAB_B = "b0000000-0000-4000-8000-00000000000b"
CAB_X = "c0000000-0000-4000-8000-00000000000c"   # cabang nonaktif
PENGGUNA = {
    "owner": ("10000000-0000-4000-8000-000000000001", "OWNER", True, []),
    "staff_a": ("10000000-0000-4000-8000-000000000005", "STAFF", True, [CAB_A]),
    "staff_b": ("10000000-0000-4000-8000-000000000006", "STAFF", True, [CAB_B]),
    "staff_ax": ("10000000-0000-4000-8000-000000000008", "STAFF", True, [CAB_A, CAB_X]),
    "admin": ("10000000-0000-4000-8000-000000000003", "ADMIN", True, []),
    "dokter_kosong": ("10000000-0000-4000-8000-000000000007", "DOCTOR", True, []),
    "staff_nonaktif": ("10000000-0000-4000-8000-000000000009", "STAFF", False, [CAB_A]),
}
TANPA_PROFIL = "10000000-0000-4000-8000-0000000000ff"
# Pilihan cabang operasional di header (layar "pilih cabang"), termasuk cabang nonaktif.
HEADER = [None] + ['{"x-kamo-operational-branch":"%s"}' % c for c in (CAB_A, CAB_B, CAB_X)]
# (hari ini, awal tahun, awal 7 hari) — termasuk jendela 7 hari yang menyeberang ke tahun lalu.
HARI = [("2026-11-09", "2026-01-01", "2026-11-03"), ("2026-01-02", "2026-01-01", "2025-12-27")]


def q(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def uid(prefix, n):
    return f"{prefix}000000-0000-4000-8000-{n:012d}"


def data(pg):
    users = list(PENGGUNA.values())
    pg.sql("insert into auth.users(id) values " + ",".join(f"('{u[0]}')" for u in users) + " on conflict do nothing;")
    pg.sql("insert into public.profiles(id, role, is_active, full_name) values "
           + ",".join(f"('{u[0]}','{u[1]}',{str(u[2]).lower()},'Uji {n}')" for n, u in PENGGUNA.items())
           + " on conflict (id) do update set role=excluded.role, is_active=excluded.is_active;")
    pg.sql(f"""insert into public.branches(id, code, name, type, is_active) values
      ('{CAB_A}','UJI-A','Cabang Uji A','BOTH',true), ('{CAB_B}','UJI-B','Cabang Uji B','BOTH',true),
      ('{CAB_X}','UJI-X','Cabang Uji X','BOTH',false);""")
    pg.sql("insert into public.user_branches(user_id, branch_id) values "
           + ",".join(f"('{u[0]}','{b}')" for u in users for b in u[3]) + ";")

    # Struk kasir: (created_at UTC, total, voided_at, payment_plan, finalized_at, marketplace_status, cabang)
    plan = "'[{\"method\":\"Tunai\",\"amount\":1}]'::jsonb"
    struk = [
        ("2026-11-09 03:00", "100000.25", None, None, None, None, CAB_A),             # lama, selesai
        ("2026-11-09 04:00", "50000", "2026-11-09 05:00", None, None, None, CAB_A),   # batal
        ("2026-11-09 06:00", "70000", None, plan, None, None, CAB_A),                 # rencana bayar belum selesai
        ("2026-11-08 23:59:59", "30000", None, plan, "2026-11-09 00:10", None, CAB_B),  # rencana selesai; tanggal UTC 8 Nov
        ("2026-11-07 10:00", "20000", None, "'null'::jsonb", None, None, CAB_B),      # payment_plan = JSON null → selesai
        ("2026-11-06 10:00", "45000", None, None, None, "piutang", CAB_A),            # marketplace belum cair
        ("2026-11-05 10:00", "15000", None, None, None, "cair", CAB_B),
        ("2026-11-02 23:00", "9999", None, None, None, None, CAB_A),                  # di luar 7 hari, tahun ini
        ("2026-06-15 10:00", "250000", None, None, None, "piutang", CAB_B),
        ("2026-01-01 00:00", "1111", None, None, None, None, CAB_A),                  # tepat awal tahun
        ("2025-12-31 23:59:59", "2222", None, None, None, None, CAB_A),               # tahun lalu, jendela lintas tahun
        ("2025-12-27 08:00", "3333", None, None, None, "piutang", CAB_B),
        ("2025-12-26 08:00", "4444", None, None, None, None, CAB_A),                  # di luar semua jendela
        ("2026-01-02 12:00", "5555", None, plan, "2026-01-02 12:01", None, CAB_B),
        ("2026-12-01 10:00", "7777", None, None, None, None, CAB_A),                  # "masa depan": pembaca lama tanpa batas atas
        ("2026-11-09 07:00", "6666", None, None, None, None, CAB_X),                  # cabang nonaktif
        ("2026-11-04 07:00", "1234.5", None, None, None, "piutang", CAB_X),
    ]
    rows = []
    for n, (ca, total, void, pp, fin, mp, cab) in enumerate(struk, 1):
        rows.append(f"({q(uid('5a', n))},{q(cab)},'UJI-S{n}',{total},{total},{q(ca + '+00')}::timestamptz,"
                    f"{q(void and void + '+00')}::timestamptz,{pp or 'null'},{q(fin and fin + '+00')}::timestamptz,{q(mp)})")
    # Tagihan klinik + kunjungan (RLS tagihan lewat cabang kunjungan).
    tagihan = [  # (created_at, total, dp, voided, cabang, [pembayaran])
        ("2026-11-09 02:00", "200000", "50000", None, CAB_A, ["25000", "25000.5"]),
        ("2026-10-01 02:00", "80000", "0", None, CAB_B, ["100000"]),     # lebih bayar → sisa 0
        ("2026-03-01 02:00", "60000", "0", "2026-03-02 00:00", CAB_A, ["10000"]),  # batal
        ("2025-12-31 23:00", "90000", "0", None, CAB_A, []),             # tahun lalu
        ("2026-01-01 00:00", "40000", "10000", None, CAB_B, []),
        ("2026-07-07 07:00", "0", "0", None, CAB_A, []),
        ("2026-11-08 07:00", "33000", "0", None, CAB_X, ["3000"]),
    ]
    vis, inv, pay = [], [], []
    for n, (ca, total, dp, void, cab, bayar) in enumerate(tagihan, 1):
        v, i = uid("7b", n), uid("8c", n)
        vis.append(f"({q(v)},{q(cab)},{q(uid('c1', n))},{q(uid('d2', n))},'Selesai')")
        inv.append(f"({q(i)},{q(v)},{total},{total},{dp},{q(ca + '+00')}::timestamptz,{q(void and void + '+00')}::timestamptz)")
        for k, amt in enumerate(bayar, 1):
            pay.append(f"({q(uid('9d', n * 10 + k))},{q(i)},{amt})")
    pg.sql("begin; set local session_replication_role = replica;\n"
           "insert into public.sales(id,branch_id,no_struk,subtotal,total,created_at,voided_at,payment_plan,payments_finalized_at,marketplace_status) values "
           + ",".join(rows) + ";\n"
           "insert into public.visits(id,branch_id,customer_id,pet_id,status) values " + ",".join(vis) + ";\n"
           "insert into public.invoices(id,visit_id,subtotal,total,dp_amount,created_at,voided_at) values " + ",".join(inv) + ";\n"
           "insert into public.invoice_payments(id,invoice_id,amount) values " + ",".join(pay) + ";\ncommit;")


def sesi(uid_, header=None):
    s = "begin; set local role authenticated;\n"
    if uid_ is not None:
        s += f"select set_config('request.jwt.claim.sub', '{uid_}', true);\n"
    if header is not None:
        s += f"select set_config('request.headers', {q(header)}, true);\n"
    return s


def baca(pg, uid_, sql, header=None):
    return json.loads(pg.sql(sesi(uid_, header) + sql + "\ncommit;").splitlines()[-1], parse_float=Decimal, parse_int=Decimal)


def pembaca_lama(pg, uid_, header, hari, awal_tahun, awal7):
    """Aturan src/lib/dashboard.ts (jalur cadangan) atas baris yang terbaca lewat tabel langsung."""
    awal_baca = min(awal7, awal_tahun)
    sales = baca(pg, uid_, "select coalesce(json_agg(json_build_object('total',total,'created_at',created_at,'voided_at',voided_at,"
                 "'payment_plan',payment_plan,'payments_finalized_at',payments_finalized_at,'marketplace_status',marketplace_status)),'[]')"
                 f" from public.sales where created_at >= '{awal_baca}';", header)
    inv = baca(pg, uid_, "select coalesce(json_agg(json_build_object('id',id,'total',total,'dp_amount',dp_amount,'created_at',created_at)),'[]')"
               f" from public.invoices where voided_at is null and created_at >= '{awal_tahun}';", header)
    pays = baca(pg, uid_, "select coalesce(json_agg(json_build_object('invoice_id',invoice_id,'amount',amount)),'[]') from public.invoice_payments;", header)
    selesai = [s for s in sales if not s["voided_at"] and (s["payment_plan"] is None or s["payments_finalized_at"])]
    tahun_ini = [s for s in selesai if s["created_at"] >= awal_tahun]
    harian = {}
    from datetime import date, timedelta
    d0, d1 = date.fromisoformat(awal7), date.fromisoformat(hari)
    hari7 = {(d0 + timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)}
    for s in selesai:
        t = s["created_at"][:10]
        if t in hari7:
            harian[t] = harian.get(t, Decimal(0)) + Decimal(s["total"] or 0)
    dibayar = {}
    for p in pays:
        dibayar[p["invoice_id"]] = dibayar.get(p["invoice_id"], Decimal(0)) + Decimal(p["amount"] or 0)
    kt, kb = Decimal(0), Decimal(0)
    for i in inv:
        if i["created_at"][:10] < awal_tahun:
            continue
        total = Decimal(i["total"] or 0)
        kt += total
        kb += max(Decimal(0), total - (Decimal(i["dp_amount"] or 0) + dibayar.get(i["id"], Decimal(0))))
    return {
        "kasir_total": sum((Decimal(s["total"] or 0) for s in tahun_ini), Decimal(0)),
        "kasir_piutang": sum((Decimal(s["total"] or 0) for s in tahun_ini if s["marketplace_status"] == "piutang"), Decimal(0)),
        "kasir_harian": [{"tanggal": t, "total": harian[t]} for t in sorted(harian)],
        "klinik_total": kt, "klinik_belum": kb,
    }


def lewat_rpc(pg, uid_, header, hari, awal_tahun, awal7):
    r = baca(pg, uid_, f"select {FUNGSI}('{awal_tahun}'::date, '{awal7}'::date, '{hari}'::date);", header)
    return {k: (v if k == "kasir_harian" else Decimal(v)) for k, v in r.items()}


def norm(x):
    """Decimal('5.0') == Decimal('5'); bandingkan nilai, bukan teks."""
    return json.loads(json.dumps(x, default=lambda d: format(d.normalize(), "f")))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pg-bin", default=os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin"))
    args = parser.parse_args()
    os.makedirs("/opt/data", exist_ok=True)
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

        # B. kesetaraan
        total, hasil, kosong = 0, set(), 0
        uids = [(n, u[0]) for n, u in PENGGUNA.items()] + [("tanpa_profil", TANPA_PROFIL), ("tanpa_login", None)]
        for (nama, u), header, (hari, awal_tahun, awal7) in itertools.product(uids, HEADER, HARI):
            lama, rpc = norm(pembaca_lama(pg, u, header, hari, awal_tahun, awal7)), norm(lewat_rpc(pg, u, header, hari, awal_tahun, awal7))
            assert lama == rpc, f"BEDA pengguna={nama} header={header} hari={hari}:\n lama={lama}\n rpc ={rpc}"
            total += 1
            kosong += rpc["kasir_total"] == "0"
            hasil.add(json.dumps(rpc, sort_keys=True))
        owner = norm(lewat_rpc(pg, PENGGUNA["owner"][0], None, *HARI[0]))
        # Angka owner 9 Nov dihitung tangan dari data fiktif di atas.
        assert owner["kasir_total"] == "492342.75", owner
        assert owner["kasir_piutang"] == "296234.5", owner
        assert owner["kasir_harian"] == [{"tanggal": "2026-11-04", "total": "1234.5"}, {"tanggal": "2026-11-05", "total": "15000"}, {"tanggal": "2026-11-06", "total": "45000"},
                                         {"tanggal": "2026-11-07", "total": "20000"}, {"tanggal": "2026-11-08", "total": "30000"},
                                         {"tanggal": "2026-11-09", "total": "106666.25"}], owner
        assert owner["klinik_total"] == "353000" and owner["klinik_belum"] == "159999.5", owner
        assert len(hasil) >= 8 and 0 < kosong < total, "matriks tidak menguji cukup variasi hak baca/cabang/tanggal"
        print(f"PASS B: {total} kombinasi (pengguna x pilihan cabang x tanggal) identik dengan aturan pembaca lama atas baris RLS;"
              f" {len(hasil)} hasil berbeda, {kosong} tanpa struk terlihat", flush=True)

        # C. pagar
        try:
            pg.sql(f"begin; set local role anon; select {FUNGSI}('2026-01-01','2026-11-03','2026-11-09'); commit;")
            raise AssertionError("anon seharusnya ditolak")
        except RuntimeError as error:
            assert "permission denied" in str(error), str(error)[:300]
        for fungsi, harap in ((FUNGSI, 'false|s|search_path=""'), ("public.dashboard_kasir_ringkas", 'true|s|search_path=""')):
            attr = pg.last("select prosecdef::text||'|'||provolatile::text||'|'||array_to_string(proconfig,',')"
                           f" from pg_proc where oid='{fungsi}(date,date,date)'::regprocedure;")
            assert attr == harap, (fungsi, attr)
            assert pg.last(f"select has_function_privilege('anon', '{fungsi}(date,date,date)', 'execute')::text;") == "false", fungsi
        print("PASS C: anon ditolak; fungsi utama SECURITY INVOKER, pembantu kasir SECURITY DEFINER; STABLE, search_path kosong", flush=True)

        # D. kecepatan: ±150.000 struk tersebar sepanjang 2026, dibaca sebagai staff cabang A (RLS bekerja).
        pg.sql(f"""begin; set local session_replication_role = replica;
          insert into public.sales(branch_id,no_struk,subtotal,total,created_at,payment_plan,payments_finalized_at,marketplace_status)
          select (array['{CAB_A}','{CAB_B}']::uuid[])[1 + g % 2], 'UJI-B' || g, 10000 + g % 997, 10000 + g % 997,
                 timestamptz '2026-01-01 00:00+00' + (g % 313) * interval '1 day' + (g % 86400) * interval '1 second',
                 case when g % 10 = 0 then '[]'::jsonb end, case when g % 20 = 0 then now() end,
                 case when g % 50 = 0 then 'piutang' end
            from generate_series(1, 150000) g;
          commit; analyze public.sales;""")
        staff = PENGGUNA["staff_a"][0]

        def ukur(sql):
            mulai = time.perf_counter()
            pg.sql(sesi(staff) + sql + "\ncommit;")
            return time.perf_counter() - mulai
        # Pembaca lama per permintaan: count exact + satu halaman 500 baris (di sini cukup SATU halaman diukur).
        t_halaman = min(ukur("select count(*) from public.sales where created_at >= '2026-01-01';"
                             " select id,total,created_at,marketplace_status,payment_plan,payments_finalized_at,voided_at"
                             " from public.sales where created_at >= '2026-01-01' order by id limit 500;") for _ in range(2))
        t_rpc = min(ukur(f"select {FUNGSI}('2026-01-01','2026-11-03','2026-11-09');") for _ in range(2))
        baris = int(pg.last("select count(*) from public.sales;"))
        halaman = -(-baris // 500)
        assert t_rpc < t_halaman * halaman / 5, f"tidak cukup cepat: rpc {t_rpc:.2f}s vs {halaman} halaman x {t_halaman:.3f}s"
        print(f"PASS D: {baris} struk: RPC {t_rpc:.2f}s, pembaca lama ±{halaman} permintaan x {t_halaman:.3f}s"
              f" = ±{halaman * t_halaman:.0f}s di database saja (belum termasuk jeda jaringan tiap permintaan)", flush=True)
    print("SEMUA PASS", flush=True)


if __name__ == "__main__":
    main()
