#!/usr/bin/env python3
"""Uji migrasi 20261202200000 (struk kasir + item dibaca di database) di PostgreSQL sungguhan, data fiktif.

Babak:
  A. SKEMA PENUH — seluruh migrasi repo diputar dari nol, termasuk migrasi ini (dua kali: idempoten).
  B. KESETARAAN HAK BACA — untuk tiap pengguna x header cabang operasional x filter (periode/cabang/dengan-item),
     hasil public.laporan_struk_kasir() == baris yang sama lewat tabel langsung sebagai `authenticated`
     (RLS sales/sale_items/branches/customers yang berlaku): isi, urutan, dan hitungan. Harus identik di semua kombinasi.
  C. PAGAR — anon dan Admin Online ditolak; STABLE, SECURITY DEFINER, search_path kosong; hanya authenticated punya EXECUTE.
  D. MUTAN — fungsi diganti varian yang salah (hak baca dilonggarkan, batas periode, cabang, item) dan matriks B
     harus gagal untuk tiap varian; fungsi asli dipulihkan sesudahnya.
  E. KECEPATAN — puluhan ribu struk: satu panggilan jauh lebih sedikit query daripada pembaca lama (halaman 500 + item per 100 id).

Tidak pernah terhubung ke Production: klaster lokal sekali pakai, socket unix, dibuang di akhir.

    python3 scripts/test-laporan-struk-kasir-postgres.py [--pg-bin DIR] [--json out.json]
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
MIGRASI = MIGRATIONS / "20261202200000_laporan_struk_kasir_cepat.sql"

CAB_A = "a0000000-0000-4000-8000-00000000000a"
CAB_B = "b0000000-0000-4000-8000-00000000000b"
CAB_X = "c0000000-0000-4000-8000-00000000000c"   # cabang nonaktif
PENGGUNA = {
    "owner": ("10000000-0000-4000-8000-000000000001", "OWNER", True, []),
    "admin_a": ("10000000-0000-4000-8000-000000000003", "ADMIN", True, [CAB_A]),
    "staff_a": ("10000000-0000-4000-8000-000000000005", "STAFF", True, [CAB_A]),
    "staff_ax": ("10000000-0000-4000-8000-000000000006", "STAFF", True, [CAB_A, CAB_X]),
    "staff_b": ("10000000-0000-4000-8000-00000000000b", "STAFF", True, [CAB_B]),
    "dokter_kosong": ("10000000-0000-4000-8000-000000000007", "DOCTOR", True, []),
    "staff_nonaktif": ("10000000-0000-4000-8000-000000000008", "STAFF", False, [CAB_A]),
    "admin_online": ("10000000-0000-4000-8000-000000000009", "ADMIN_ONLINE", True, [CAB_A]),
}
TANPA_PROFIL = "10000000-0000-4000-8000-0000000000ff"
HEADER = [None, '{"x-kamo-operational-branch":"%s"}' % CAB_A, '{"x-kamo-operational-branch":"%s"}' % CAB_B]
WIB = "+07:00"
# (p_from, p_to, p_branch_id, p_dengan_item)
FILTER = [
    ("2026-01-01T00:00:00+07:00", "2026-12-31T23:59:59.999999+07:00", None, True),
    ("2026-02-01T00:00:00+07:00", "2026-02-07T23:59:59.999999+07:00", None, True),     # batas persis: struk di tepi harus ikut
    ("2026-02-08T00:00:00+07:00", "2026-02-14T23:59:59.999999+07:00", None, True),
    ("2026-02-01T00:00:00+07:00", "2026-03-31T23:59:59.999999+07:00", CAB_A, True),
    ("2026-02-01T00:00:00+07:00", "2026-03-31T23:59:59.999999+07:00", CAB_B, True),
    ("2026-01-15T00:00:00+07:00", "2026-03-15T23:59:59.999999+07:00", CAB_X, True),
    ("2026-01-01T00:00:00+07:00", "2026-12-31T23:59:59.999999+07:00", None, False),
    ("2026-06-01T00:00:00+07:00", "2026-06-02T23:59:59.999999+07:00", None, True),    # tanpa struk
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
    pg.sql("insert into public.customers(id, name, phone) select ('d0000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'Pelanggan Uji ' || g, '0800000' || g from generate_series(1, 20) g;")


def isi_struk(pg, jumlah, mulai=1, tersebar=True):
    """`jumlah` struk fiktif, 1-3 item, tersebar di 3 cabang, Jan–Apr 2026 (tengah malam WIB ikut), campur batal/online/rencana bayar."""
    pg.sql(f"""set session_replication_role = replica;
      with s as (
        insert into public.sales(id, branch_id, customer_id, no_struk, subtotal, total, created_at, channel, merchant_fee_total,
                                 payment_plan, payments_finalized_at, voided_at)
        select ('e0000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
               (array['{CAB_A}','{CAB_B}','{CAB_X}']::uuid[])[1 + g % 3],
               case when g % 3 = 0 then null else ('d0000000-0000-4000-8000-' || lpad((1 + g % 20)::text, 12, '0'))::uuid end,
               'UJI-S-' || g, 100 + g % 50, 100 + g % 50,
               case when g % 10 = 0 then timestamptz '2026-02-01 00:00:00+07' + ((g / 10) % 3) * interval '7 day'              -- tepi awal rentang
                    when g % 10 = 5 then timestamptz '2026-02-07 23:59:59.999999+07' + ((g / 10) % 3) * interval '7 day'        -- tepi akhir rentang
                    else timestamptz '2026-01-01 00:00:00+07' + (g % 120) * interval '1 day' + (g % 24) * interval '1 hour' end,
               case when g % 11 = 0 then 'Shopee' else null end, case when g % 7 = 0 then 1.5 else 0 end,
               case when g % 23 = 0 then '[{{"method":"Tunai","amount":1}}]'::jsonb else null end,
               case when g % 23 = 0 and g % 2 = 0 then now() else null end,
               case when g % 17 = 0 then now() else null end
        from generate_series({mulai}, {mulai} + {jumlah} - 1) g
        returning id, no_struk
      )
      insert into public.sale_items(id, sale_id, nama, qty, harga, satuan, faktor, item_discount_type, item_discount_value, promo_discount, service_performers)
      select gen_random_uuid(), s.id, 'Barang ' || j, 1 + j, 1000.25 * (1 + j), 'pcs', 1,
             (array['nominal','percent',null])[1 + (substr(s.no_struk, 7)::int + j) % 3], (substr(s.no_struk, 7)::int + j) % 7, case when j = 1 then 0.5 else 0 end,
             case when substr(s.no_struk, 7)::int % 5 = 0 and j = 0 then '{{"staff_id":"x"}}'::jsonb else null end
      from s, generate_series(0, 2) j
      where j <= substr(s.no_struk, 7)::int % 3;
      set session_replication_role = origin;""")


def sesi(uid, header):
    s = "begin; set local role authenticated;\n"
    if uid is not None:
        s += f"select set_config('request.jwt.claim.sub', '{uid}', true);\n"
    if header is not None:
        s += f"select set_config('request.headers', {q(header)}, true);\n"
    return s


REF_SALES = ("coalesce(jsonb_agg(jsonb_build_object('id',s.id,'branch_id',s.branch_id,'customer_id',s.customer_id,'no_struk',s.no_struk,'created_at',s.created_at,"
             "'channel',s.channel,'total',s.total,'merchant_fee_total',s.merchant_fee_total,'payment_plan',s.payment_plan,'payments_finalized_at',s.payments_finalized_at,"
             "'voided_at',s.voided_at,'salesperson_id',s.salesperson_id,'cashier_id',s.cashier_id,"
             "'branches',(select jsonb_build_object('name',b.name) from public.branches b where b.id=s.branch_id),"
             "'customers',(select jsonb_build_object('name',c.name) from public.customers c where c.id=s.customer_id)) order by s.id),'[]'::jsonb)")
REF_ITEMS = ("coalesce(jsonb_agg(jsonb_build_object('id',i.id,'sale_id',i.sale_id,'nama',i.nama,'qty',i.qty,'harga',i.harga,'item_id',i.item_id,'satuan',i.satuan,"
             "'faktor',i.faktor,'item_discount_type',i.item_discount_type,'item_discount_value',i.item_discount_value,'promo_discount',i.promo_discount,"
             "'service_performers',i.service_performers) order by i.id),'[]'::jsonb)")


def lewat_rls(pg, uid, header, f):
    dari, sampai, cabang, dengan_item = f
    cab = f"and x.branch_id = '{cabang}'" if cabang else ""
    out = pg.sql(sesi(uid, header) + f"""with s as (select x.* from public.sales x where x.created_at >= '{dari}' and x.created_at <= '{sampai}' {cab})
      select jsonb_build_object(
        'sales', (select {REF_SALES} from s),
        'items', (select {REF_ITEMS} from public.sale_items i where {'true' if dengan_item else 'false'} and i.sale_id in (select id from s)));
      commit;""")
    j = json.loads(out.splitlines()[-1])
    return {"n_struk": len(j["sales"]), "n_item": len(j["items"]), **j}


def lewat_rpc(pg, uid, header, f):
    dari, sampai, cabang, dengan_item = f
    out = pg.sql(sesi(uid, header) + f"select public.laporan_struk_kasir({q(dari)}::timestamptz, {q(sampai)}::timestamptz, {q(cabang)}::uuid, {str(dengan_item).lower()});\ncommit;")
    return json.loads(out.splitlines()[-1])


def matriks(pg, uids):
    total, berisi, beda_isi, beda = 0, 0, set(), []
    for uid, header, f in itertools.product(uids, HEADER, FILTER):
        rls, rpc = lewat_rls(pg, uid, header, f), lewat_rpc(pg, uid, header, f)
        total += 1
        berisi += bool(rpc["sales"])
        beda_isi.add(json.dumps(rpc, sort_keys=True)[:6000])
        if rls != rpc:
            beda.append((uid, header, f))
    return total, berisi, beda_isi, beda


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pg-bin", default=os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin"))
    parser.add_argument("--json", default=None)
    args = parser.parse_args()
    laporan = {}
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
        isi_struk(pg, 600)
        jumlah_struk = int(pg.last("select count(*) from public.sales;"))
        jumlah_item = int(pg.last("select count(*) from public.sale_items;"))
        assert jumlah_struk == 600 and jumlah_item > 600, (jumlah_struk, jumlah_item)

        # B. kesetaraan hak baca
        uids = [u[0] for n, u in PENGGUNA.items() if n != "admin_online"] + [TANPA_PROFIL]
        total, berisi, beda_isi, beda = matriks(pg, uids)
        assert not beda, f"BEDA dengan RLS pada {len(beda)} kombinasi, mis. {beda[:2]}"
        assert 0 < berisi < total and len(beda_isi) > 8, "matriks tidak menguji cukup variasi hak baca/filter"
        print(f"PASS B: {total} kombinasi (pengguna x header cabang x filter) identik dengan RLS tabel langsung;"
              f" {len(beda_isi)} hasil berbeda, {total - berisi} kosong; fixture {jumlah_struk} struk / {jumlah_item} item", flush=True)
        laporan["B"] = {"kombinasi": total, "hasil_berbeda": len(beda_isi), "kosong": total - berisi, "struk": jumlah_struk, "item": jumlah_item}

        # C. pagar
        try:
            pg.sql("begin; set local role anon; select public.laporan_struk_kasir('2026-01-01','2026-01-02'); commit;")
            raise AssertionError("anon seharusnya ditolak")
        except RuntimeError as error:
            assert "permission denied" in str(error), str(error)[:300]
        attr = pg.last("select prosecdef::text||'|'||provolatile::text||'|'||array_to_string(proconfig,',')"
                       " from pg_proc where oid='public.laporan_struk_kasir(timestamptz,timestamptz,uuid,boolean)'::regprocedure;")
        assert attr == 'true|s|search_path=""', attr
        acl = pg.last("select coalesce(proacl::text,'') from pg_proc where oid='public.laporan_struk_kasir(timestamptz,timestamptz,uuid,boolean)'::regprocedure;")
        assert "authenticated=X" in acl and "anon" not in acl and not acl.startswith("=") and ",=X" not in acl, acl
        for uid in (PENGGUNA["admin_online"][0],):
            try:
                pg.sql(sesi(uid, None) + "select public.laporan_struk_kasir('2026-01-01','2026-12-31');\ncommit;")
                raise AssertionError("Admin Online seharusnya ditolak")
            except RuntimeError as error:
                assert "ADMIN_ONLINE_FUNCTION_DENIED" in str(error), str(error)[:300]
        try:
            pg.sql(sesi(PENGGUNA["owner"][0], None) + "select public.laporan_struk_kasir(null,'2026-12-31');\ncommit;")
            raise AssertionError("periode kosong seharusnya ditolak")
        except RuntimeError as error:
            assert "LAPORAN_STRUK_PERIODE" in str(error), str(error)[:300]
        # fungsi tidak menulis apa pun (STABLE di transaksi read only)
        pg.sql(sesi(PENGGUNA["owner"][0], None) + "set transaction read only;\nselect public.laporan_struk_kasir('2026-01-01','2026-12-31');\ncommit;")
        print("PASS C: anon dan Admin Online ditolak, periode kosong ditolak; SECURITY DEFINER, STABLE, search_path kosong; EXECUTE hanya authenticated; jalan di transaksi read-only", flush=True)

        # D. mutan: tiap varian salah harus ketahuan matriks B
        asli = MIGRASI.read_text()
        mutan = {
            "tanpa pagar cabang (semua struk terlihat)": ("      and x.branch_id = any(v_boleh)\n", "      and true\n"),
            "batas awal eksklusif": ("x.created_at >= p_from", "x.created_at > p_from"),
            "batas akhir eksklusif": ("x.created_at <= p_to", "x.created_at < p_to"),
            "filter cabang diabaikan": ("(p_branch_id is null or x.branch_id = p_branch_id)", "true"),
            "item semua struk (bukan hanya yang terlihat)": ("       join s on s.id = i.sale_id)", "       where true)"),
            "item tanpa urutan id": ("        ) order by i.id), '[]'::jsonb)", "        )), '[]'::jsonb)"),
            "struk tanpa urutan id": ("      ) order by s.id), '[]'::jsonb)", "      )), '[]'::jsonb)"),
            "p_dengan_item diabaikan": ("case when p_dengan_item then", "case when true then"),
            "nama pelanggan dibuang": ("case when c.id is null then null else jsonb_build_object('name', c.name) end", "null"),
            "cabang hanya yang aktif": ("  from public.branches b\n  where public.user_can_access_branch(b.id);", "  from public.branches b\n  where public.user_can_access_branch(b.id) and b.is_active;"),
        }
        hidup = []
        for nama, (a, b) in mutan.items():
            assert asli.count(a) == 1, f"jangkar mutan '{nama}' tidak tepat satu kali: {asli.count(a)}"
            pg.sql("begin;\n" + asli.replace(a, b) + "\ncommit;")
            _, _, _, beda_m = matriks(pg, uids)
            if not beda_m:
                hidup.append(nama)
        # tanpa deny_admin_online: tidak terlihat di matriks (Admin Online tidak ada di sana), diuji langsung.
        a = "  perform admin_online_private.deny_admin_online();\n"
        assert asli.count(a) == 1
        pg.sql("begin;\n" + asli.replace(a, "  null;\n") + "\ncommit;")
        try:
            pg.sql(sesi(PENGGUNA["admin_online"][0], None) + "select public.laporan_struk_kasir('2026-01-01','2026-12-31');\ncommit;")
            # tanpa penjaga Admin Online dapat membaca => pengujian pagar (babak C) memang akan mendeteksinya: mutan mati.
        except RuntimeError:
            hidup.append("tanpa pagar Admin Online (mutan masih menolak)")
        pg.sql("begin;\n" + asli + "\ncommit;")  # pulihkan
        assert not hidup, f"mutan lolos: {hidup}"
        _, _, _, beda_pulih = matriks(pg, uids[:3])
        assert not beda_pulih
        print(f"PASS D: {len(mutan) + 1} mutan semuanya ketahuan (matriks B/pagar); fungsi asli dipulihkan dan hijau lagi", flush=True)
        laporan["D"] = {"mutan": len(mutan) + 1, "hidup": 0}

        # E. kecepatan sebagai staff cabang A (RLS per baris benar-benar bekerja)
        isi_struk(pg, 30000, mulai=1000)
        staff = PENGGUNA["staff_a"][0]
        besar = ("2026-01-01T00:00:00+07:00", "2026-12-31T23:59:59.999999+07:00")

        def ukur(sql):
            mulai = time.perf_counter()
            pg.sql(sesi(staff, None) + sql + "\ncommit;")
            return time.perf_counter() - mulai
        W = f"created_at >= '{besar[0]}' and created_at <= '{besar[1]}'"
        # Pembaca lama: per halaman = count exact + 500 struk; lalu item per 100 id struk (di sini satu halaman dan satu kelompok yang diukur).
        t_halaman = min(ukur(f"select count(*) from public.sales where {W}; select id from public.sales where {W} order by id limit 500;") for _ in range(2))
        ids = "(select id from public.sales where %s order by id limit 100)" % W
        t_kelompok = min(ukur(f"select count(*) from public.sale_items where sale_id in {ids}; select id from public.sale_items where sale_id in {ids} order by id limit 500;") for _ in range(2))
        n_struk_staf = int(pg.last(sesi(staff, None) + f"select count(*) from public.sales where {W};\ncommit;"))
        halaman = -(-n_struk_staf // 500)
        kelompok = -(-n_struk_staf // 100)
        lama_est = halaman * t_halaman + kelompok * t_kelompok
        t_rpc = min(ukur(f"select public.laporan_struk_kasir('{besar[0]}', '{besar[1]}', null, true);") for _ in range(2))
        query_lama = halaman * 2 + kelompok * 2
        assert t_rpc < lama_est, f"tidak lebih cepat: rpc {t_rpc:.2f}s vs lama ±{lama_est:.1f}s ({query_lama} query)"
        print(f"PASS E: {n_struk_staf} struk terlihat staff: RPC {t_rpc:.2f}s dalam 1 query; pembaca lama ±{lama_est:.1f}s dalam ±{query_lama} query "
              f"({halaman} halaman x {t_halaman:.2f}s + {kelompok} kelompok x {t_kelompok:.2f}s)", flush=True)
        laporan["E"] = {"struk": n_struk_staf, "rpc_s": round(t_rpc, 3), "lama_est_s": round(lama_est, 2), "query_lama": query_lama}
    if args.json:
        Path(args.json).write_text(json.dumps(laporan, indent=1))
    print("SEMUA PASS", flush=True)


if __name__ == "__main__":
    main()
