#!/usr/bin/env python3
"""Uji migrasi 20261219100000 (Anamnesa + Nilai Persediaan Historis dibaca di database) di PostgreSQL sungguhan, data fiktif.

Babak:
  A. SKEMA PENUH — seluruh migrasi repo diputar dari nol, termasuk migrasi ini (dua kali: idempoten).
  B. KESETARAAN HAK BACA — untuk tiap pengguna x header cabang operasional x filter, hasil tiga fungsi
     (public.laporan_anamnesa, laporan_persediaan_lapisan, laporan_persediaan_buku_besar) == hasil yang sama dibaca lewat
     tabel langsung sebagai `authenticated` (RLS medical_records/visits/branches/pets/customers, warehouses/stock/stock_layers,
     journal_entries/journal_lines yang berlaku). Isi, urutan, dan angka harus identik di semua kombinasi.
  C. PAGAR — anon dan Admin Online ditolak di ketiga fungsi; atribut (INVOKER/DEFINER, STABLE, search_path kosong);
     hanya authenticated punya EXECUTE; berjalan di transaksi read-only; tidak ada tulis.
  D. MUTAN — tiap fungsi diganti varian yang salah dan matriks B (atau pagar C) harus gagal; fungsi asli dipulihkan.
  E. KECEPATAN — saldo buku besar 170001 puluhan ribu baris sebagai staf: satu panggilan vs pembaca lama (halaman 500 + hitungan pasti).

Tidak pernah terhubung ke Production: klaster lokal sekali pakai, socket unix, dibuang di akhir.

    python3 scripts/test-laporan-anamnesa-persediaan-postgres.py [--pg-bin DIR] [--json out.json]
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

# Rantai migrasi dari nol memakai pembantu yang sama dengan uji laporan Operation & Sales (akun beban fiktif untuk migrasi yang memeriksa COA hosted,
# koreksi data khusus hosted ditoleransi, hak bawaan Supabase dipasang sebelum migrasi ini).
_spec = importlib.util.spec_from_file_location("opl", ROOT / "scripts/test-laporan-operasional-penjualan-postgres.py")
opl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(opl)

MIGRATIONS = ROOT / "supabase/migrations"
MIGRASI = MIGRATIONS / "20261219100000_laporan_anamnesa_persediaan_cepat.sql"
F_ANAMNESA = "public.laporan_anamnesa(timestamptz,timestamptz,uuid,boolean)"
F_LAPISAN = "public.laporan_persediaan_lapisan(uuid[])"
F_BUKU = "public.laporan_persediaan_buku_besar(date,uuid[],boolean)"

CAB_A = "a0000000-0000-4000-8000-00000000000a"
CAB_B = "b0000000-0000-4000-8000-00000000000b"
CAB_X = "c0000000-0000-4000-8000-00000000000c"   # cabang nonaktif
PENGGUNA = {
    "owner": ("10000000-0000-4000-8000-000000000001", "OWNER", True, []),
    "finance": ("10000000-0000-4000-8000-000000000002", "FINANCE", True, [CAB_A]),
    "admin_a": ("10000000-0000-4000-8000-000000000003", "ADMIN", True, [CAB_A]),
    "staff_a": ("10000000-0000-4000-8000-000000000005", "STAFF", True, [CAB_A]),
    "staff_ax": ("10000000-0000-4000-8000-000000000006", "STAFF", True, [CAB_A, CAB_X]),
    "staff_b": ("10000000-0000-4000-8000-00000000000b", "STAFF", True, [CAB_B]),
    "dokter_kosong": ("10000000-0000-4000-8000-000000000007", "DOCTOR", True, []),
    "dokter_a": ("10000000-0000-4000-8000-000000000004", "DOCTOR", True, [CAB_A]),
    "staff_nonaktif": ("10000000-0000-4000-8000-000000000008", "STAFF", False, [CAB_A]),
    "admin_online": ("10000000-0000-4000-8000-000000000009", "ADMIN_ONLINE", True, [CAB_A]),
}
TANPA_PROFIL = "10000000-0000-4000-8000-0000000000ff"
HEADER = [None, '{"x-kamo-operational-branch":"%s"}' % CAB_A, '{"x-kamo-operational-branch":"%s"}' % CAB_B]
SEMUA_CAB = [CAB_A, CAB_B, CAB_X]
# (p_from, p_to, p_branch_id, p_to_eksklusif) — tepi persis: baris pada 2026-02-01 00:00:00+07 dan 2026-02-07 23:59:59+07 ada
F_ANAM = [
    ("2026-01-01T00:00:00+07:00", "2026-12-31T23:59:59+07:00", None, False),
    ("2026-02-01T00:00:00+07:00", "2026-02-07T23:59:59+07:00", None, False),
    ("2026-02-01T00:00:00+07:00", "2026-02-08T00:00:00+07:00", None, True),    # jendela eksklusif: baris tepat 08 Feb 00:00 tidak ikut
    ("2026-02-01T00:00:00+07:00", "2026-02-08T00:00:00+07:00", None, False),   # inklusif: ikut
    ("2026-02-08T00:00:00+07:00", "2026-03-15T23:59:59+07:00", CAB_A, False),
    ("2026-01-01T00:00:00+07:00", "2026-04-30T23:59:59+07:00", CAB_B, False),
    ("2026-01-01T00:00:00+07:00", "2026-04-30T23:59:59+07:00", CAB_X, False),
    ("2026-06-01T00:00:00+07:00", "2026-06-02T23:59:59+07:00", None, False),   # tanpa baris
]
DAFTAR_CAB = [SEMUA_CAB, [CAB_A], [CAB_B], [CAB_X], [CAB_A, CAB_B], [], [CAB_A, CAB_A]]
# (as_of, branch_ids, tak_teralokasi)
F_BUKU_B = [(d, c, t) for d in ("2026-04-30", "2026-02-15", "2025-12-31") for c in (SEMUA_CAB, [CAB_A], [CAB_B, CAB_X], []) for t in (False, True)]


def q(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def arr(ids):
    return "array[" + ",".join(f"'{i}'" for i in ids) + "]::uuid[]"


def uid(prefix, expr):
    return f"('{prefix}-0000-4000-8000-' || lpad(({expr})::text, 12, '0'))::uuid"


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
    pg.sql(f"""insert into public.customers(id, name, phone) select {uid('d0000000', 'g')}, 'Pelanggan Uji ' || g, '0800000' || g from generate_series(1, 20) g;
      insert into public.pets(id, customer_id, name, species, breed) select {uid('d1000000', 'g')}, {uid('d0000000', 'g')}, 'Hewan Uji ' || g,
        case when g % 3 = 0 then null else (array['Kucing','Anjing'])[1 + g % 2] end, case when g % 4 = 0 then null else 'Ras ' || (g % 5) end from generate_series(1, 20) g;""")


def isi_rekam(pg, jumlah, mulai=1):
    """Rekam medis fiktif di 3 cabang + kunjungan impor tanpa cabang (kunci legacy), Jan–Apr 2026, dengan waktu kembar (uji urutan id),
    tepi rentang persis, teks kosong/null, dan beberapa kunjungan dengan dua rekam medis."""
    pg.sql(f"""set session_replication_role = replica;
      insert into public.visits(id, branch_id, customer_id, pet_id, poli, dokter, status, source, legacy_source_key, legacy_source_hash, created_at)
      select {uid('a1000000', 'g')},
             (array['{CAB_A}','{CAB_B}','{CAB_X}','{CAB_A}',null]::uuid[])[1 + g % 5],
             {uid('d0000000', '1 + g % 20')}, {uid('d1000000', '1 + g % 20')}, 'Umum',
             case when g % 6 = 0 then null else 'drh Uji ' || (g % 4) end, 'Selesai', 'walk_in',
             case when g % 5 = 4 then 'LEG-' || g else null end, case when g % 5 = 4 then 'h' || g else null end,
             timestamptz '2026-01-01 00:00:00+07' + (g % 120) * interval '1 day'
      from generate_series({mulai}, {mulai} + {jumlah} - 1) g;
      insert into public.medical_records(id, visit_id, diagnosis, anamnesis, gejala_klinis, follow_up, created_at)
      select {uid('12000000', 'g')}, {uid('a1000000', 'g')},
             case when g % 7 = 0 then null when g % 7 = 1 then '  Scabies ' else 'Dx ' || (g % 9) end,
             case when g % 5 = 0 then null else 'anamnesa ' || g end, case when g % 3 = 0 then '' else 'gejala ' || g end,
             case when g % 11 = 0 then 'kontrol' else null end,
             case when g % 10 = 0 then timestamptz '2026-02-01 00:00:00+07' + ((g / 10) % 3) * interval '7 day'                 -- tepi awal
                  when g % 10 = 5 then timestamptz '2026-02-07 23:59:59+07' + ((g / 10) % 3) * interval '7 day'                 -- tepi akhir
                  when g % 10 = 3 then timestamptz '2026-02-08 00:00:00+07'                                                      -- tepi jendela (banyak baris kembar)
                  else timestamptz '2026-01-01 00:00:00+07' + (g % 120) * interval '1 day' + (g % 24) * interval '1 hour' end
      from generate_series({mulai}, {mulai} + {jumlah} - 1) g;
      set session_replication_role = origin;""")


def isi_persediaan(pg):
    """Gudang (termasuk DC bersama dan gudang nonaktif), item, lapisan FIFO (qty_left 0/>0, biaya pecahan), stok minus, jurnal 170001."""
    pg.sql(f"""set session_replication_role = replica;
      insert into public.warehouses(id, branch_id, code, name, type, is_active) values
        ({uid('90000000', 1)}, '{CAB_A}', 'UJ-A1', 'Toko A', 'RETAIL', true),
        ({uid('90000000', 2)}, '{CAB_A}', 'UJ-A2', 'Klinik A', 'VET', true),
        ({uid('90000000', 3)}, '{CAB_A}', 'UJ-A3', 'DC bersama A', 'DC', true),
        ({uid('90000000', 4)}, '{CAB_B}', 'UJ-B1', 'Toko B', 'RETAIL', true),
        ({uid('90000000', 5)}, '{CAB_B}', 'UJ-B2', 'Transit B', 'TRANSIT', false),
        ({uid('90000000', 6)}, '{CAB_X}', 'UJ-X1', 'Toko X', 'RETAIL', false);
      insert into public.items(id, code, name, unit, buy_price, sell_price, item_type)
        select {uid('91000000', 'g')}, 'UJITEM' || g, 'Barang Uji ' || g, 'pcs', 1, 2, 'Persediaan' from generate_series(1, 30) g;
      insert into public.stock(warehouse_id, item_id, qty)
        select w, i, case when (wi + ii) % 11 = 0 then -(1 + ii % 3) when (wi + ii) % 13 = 0 then 0 else 5 + ii end
        from (select {uid('90000000', 'k')} w, k wi from generate_series(1, 6) k) a,
             (select {uid('91000000', 'g')} i, g ii from generate_series(1, 30) g) b;
      insert into public.stock_layers(warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost, source)
        select w, i, date '2026-01-01' + (wi * ii) % 90, 10 + ii, case when (wi + ii) % 4 = 0 then 0 else (ii % 9) + 0.125 * (wi % 5) end,
               1000.0625 * (1 + (ii % 7)) + wi * 0.0001, 'purchase'
        from (select {uid('90000000', 'k')} w, k wi from generate_series(1, 6) k) a,
             (select {uid('91000000', 'g')} i, g ii from generate_series(1, 30) g) b;
      -- lapisan berbiaya negatif: qty_left = 0 (tidak dihitung) di cabang A, dan qty_left > 0 di cabang X (hanya terlihat bila X diminta)
      insert into public.stock_layers(warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost, source) values
        ({uid('90000000', 2)}, {uid('91000000', 1)}, '2026-03-01', 1, 0, -7, 'purchase'),
        ({uid('90000000', 6)}, {uid('91000000', 2)}, '2026-03-01', 2, 2, -3, 'purchase');
      set session_replication_role = origin;""")
    if int(pg.last("select count(*) from public.coa_accounts where code = '170001';")) == 0:
        pg.sql("insert into public.coa_accounts(code, name, type, normal_balance) values ('170001', 'Persediaan Uji', 'ASET', 'D'), ('199999', 'Lawan Uji', 'LIABILITAS', 'K');")
    elif int(pg.last("select count(*) from public.coa_accounts where code = '199999';")) == 0:
        pg.sql("insert into public.coa_accounts(code, name, type, normal_balance) values ('199999', 'Lawan Uji', 'LIABILITAS', 'K');")


def isi_jurnal(pg, jumlah, mulai=1):
    """Jurnal seimbang (2 baris) pada 170001 dan akun lawan, 3 cabang + tanpa cabang, Jan–Apr 2026, nominal pecahan, ±1/10 baris ke akun lain."""
    pg.sql(f"""
      with a as (select (select id from public.coa_accounts where code = '170001') p, (select id from public.coa_accounts where code = '199999') l),
      e as (
        insert into public.journal_entries(id, no_jurnal, tanggal, deskripsi, source, branch_id)
        select gen_random_uuid(), 'UJP-' || g, date '2026-01-01' + (g % 120), 'uji', 'manual',
               (array['{CAB_A}','{CAB_B}','{CAB_X}',null]::uuid[])[1 + g % 4]
        from generate_series({mulai}, {mulai} + {jumlah} - 1) g
        returning id, no_jurnal
      ), n as (select id, substr(no_jurnal, 5)::int g from e)
      insert into public.journal_lines(entry_id, account_id, debit, credit)
      select id, case when g % 10 = 9 then (select l from a) else (select p from a) end, case when g % 3 = 0 then 0 else (g % 997) + 0.25 end, case when g % 3 = 0 then (g % 491) + 0.5 else 0 end from n
      union all
      select id, (select l from a), case when g % 3 = 0 then (g % 491) + 0.5 else 0 end, case when g % 3 = 0 then 0 else (g % 997) + 0.25 end from n;""")


def sesi(u, header):
    s = "begin; set local role authenticated;\n"
    if u is not None:
        s += f"select set_config('request.jwt.claim.sub', '{u}', true);\n"
    if header is not None:
        s += f"select set_config('request.headers', {q(header)}, true);\n"
    return s


# ---------- referensi: tabel langsung (RLS berlaku) ----------
def ref_anamnesa(f):
    dari, sampai, cabang, eks = f
    batas = f"mr.created_at < '{sampai}'" if eks else f"mr.created_at <= '{sampai}'"
    cab = f"and exists (select 1 from public.visits v where v.id = mr.visit_id and v.branch_id = '{cabang}')" if cabang else ""
    return f"""with m as (select mr.* from public.medical_records mr where mr.created_at >= '{dari}' and {batas} {cab}),
      r as (select m.id, m.created_at, jsonb_build_object('id',m.id,'diagnosis',m.diagnosis,'anamnesis',m.anamnesis,'gejala_klinis',m.gejala_klinis,
        'follow_up',m.follow_up,'created_at',m.created_at,
        'visits',(select jsonb_build_object('branch_id',v.branch_id,'dokter',v.dokter,
           'branches',(select jsonb_build_object('name',b.name) from public.branches b where b.id=v.branch_id),
           'pets',(select jsonb_build_object('name',p.name,'species',p.species,'breed',p.breed) from public.pets p where p.id=v.pet_id),
           'customers',(select jsonb_build_object('name',c.name) from public.customers c where c.id=v.customer_id))
           from public.visits v where v.id = m.visit_id)) j from m)
      select jsonb_build_object('n',(select count(*) from r),'rows',(select coalesce(jsonb_agg(j order by created_at desc, id),'[]'::jsonb) from r));"""


def ref_lapisan(ids):
    return f"""with w as (select id, branch_id from public.warehouses where branch_id = any({arr(ids)}))
      select jsonb_build_object('per_cabang', coalesce((select jsonb_object_agg(b::text, jsonb_build_object(
          'nilai', coalesce((select sum(sl.qty_left*sl.unit_cost) from public.stock_layers sl where sl.qty_left > 0 and sl.warehouse_id in (select id from w where branch_id = b)),0)::text,
          'minus', (select count(*) from public.stock s where s.qty < 0 and s.warehouse_id in (select id from w where branch_id = b))))
          from (select distinct unnest({arr(ids)}) b) d), '{{}}'::jsonb),
        'biaya_negatif', (select count(*) from public.stock_layers sl where sl.warehouse_id in (select id from w) and sl.qty_left > 0 and sl.unit_cost < 0));"""


def ref_buku(f):
    d, ids, tak = f
    akun = "(select id from public.coa_accounts where code = '170001')"
    return f"""select jsonb_build_object('akun_ada', true,
        'per_cabang', coalesce((select jsonb_object_agg(g.b::text, g.s::text) from (select e.branch_id b, sum(l.debit - l.credit) s
            from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
            where l.account_id = {akun} and e.tanggal <= '{d}' and e.branch_id = any({arr(ids)}) group by 1) g), '{{}}'::jsonb),
        'tak_teralokasi', coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
            where {str(tak).lower()} and l.account_id = {akun} and e.tanggal <= '{d}' and e.branch_id is null), 0)::text,
        'negatif', (select count(*) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
            where l.account_id = {akun} and e.tanggal <= '{d}' and (e.branch_id = any({arr(ids)}) or ({str(tak).lower()} and e.branch_id is null)) and (l.debit < 0 or l.credit < 0)));"""


def rpc_anamnesa(f):
    dari, sampai, cabang, eks = f
    return f"select public.laporan_anamnesa({q(dari)}::timestamptz, {q(sampai)}::timestamptz, {q(cabang)}::uuid, {str(eks).lower()});"


def rpc_lapisan(ids):
    return f"select public.laporan_persediaan_lapisan({arr(ids)});"


def rpc_buku(f):
    d, ids, tak = f
    return f"select public.laporan_persediaan_buku_besar('{d}'::date, {arr(ids)}, {str(tak).lower()});"


_cache = {}


def jalan(pg, u, header, sql):
    out = pg.sql(sesi(u, header) + sql + "\ncommit;")
    return json.loads(out.splitlines()[-1])


def banding(pg, u, header, jenis, f):
    ref = {"a": ref_anamnesa, "l": ref_lapisan, "b": ref_buku}[jenis](f)
    rpc = {"a": rpc_anamnesa, "l": rpc_lapisan, "b": rpc_buku}[jenis](f)
    kunci = (u, header, jenis, json.dumps(f, default=str))
    if kunci not in _cache:
        _cache[kunci] = jalan(pg, u, header, ref)
    return _cache[kunci], jalan(pg, u, header, rpc)


def matriks(pg, uids, jenis, berhenti_pertama=False):
    filt = {"a": F_ANAM, "l": DAFTAR_CAB, "b": F_BUKU_B}[jenis]
    total, berisi, beda_isi, beda = 0, 0, set(), []
    for u, header, f in itertools.product(uids, HEADER, filt):
        rls, rpc = banding(pg, u, header, jenis, f)
        total += 1
        berisi += bool(rpc.get("rows") if jenis == "a" else (rpc.get("per_cabang") or rpc.get("tak_teralokasi") not in (None, "0")))
        beda_isi.add(json.dumps(rpc, sort_keys=True)[:6000])
        if rls != rpc:
            beda.append((u, header, f))
            if berhenti_pertama:
                break
    return total, berisi, beda_isi, beda


def muat(pg, kode):
    pg.sql("begin;\n" + kode + "\ncommit;")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pg-bin", default=os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin"))
    parser.add_argument("--json", default=None)
    args = parser.parse_args()
    laporan = {}
    with NativePostgres(args.pg_bin) as pg:
        # A. skema penuh
        semua = sorted(MIGRATIONS.glob("*.sql"))
        assert MIGRASI in semua
        opl.build_chain(pg, {MIGRASI.name})
        pg.sql(opl.PRELUDE)   # hak bawaan Supabase: objek baru otomatis dapat hak anon/authenticated (tanpa ini mutan ACL hidup palsu)
        muat(pg, MIGRASI.read_text())
        muat(pg, MIGRASI.read_text())
        print(f"PASS A: {len(semua)} migrasi repo berjalan dari nol; migrasi ini idempoten (dua kali)", flush=True)

        data(pg)
        isi_rekam(pg, 400)
        isi_persediaan(pg)
        isi_jurnal(pg, 800)
        n_mr = int(pg.last("select count(*) from public.medical_records;"))
        n_lay = int(pg.last("select count(*) from public.stock_layers;"))
        n_jl = int(pg.last("select count(*) from public.journal_lines;"))
        assert n_mr == 400 and n_lay == 182 and n_jl >= 1600, (n_mr, n_lay, n_jl)

        # B. kesetaraan hak baca
        uids = [u[0] for n, u in PENGGUNA.items() if n != "admin_online"] + [TANPA_PROFIL]
        hasil_b = {}
        for jenis, nama in (("a", "anamnesa"), ("l", "lapisan"), ("b", "buku_besar")):
            total, berisi, beda_isi, beda = matriks(pg, uids, jenis)
            assert not beda, f"{nama}: BEDA dengan RLS pada {len(beda)} kombinasi, mis. {beda[:2]}"
            assert 0 < berisi < total and len(beda_isi) > 6, f"{nama}: matriks tidak menguji cukup variasi hak baca/filter ({berisi}/{total}, {len(beda_isi)} hasil berbeda)"
            hasil_b[nama] = {"kombinasi": total, "hasil_berbeda": len(beda_isi), "kosong": total - berisi}
        # fixture benar-benar memuat unsur yang dibaca
        besar = jalan(pg, PENGGUNA["owner"][0], None, rpc_anamnesa(F_ANAM[0]))
        assert besar["n"] == len(besar["rows"]) == 400, besar["n"]
        assert any(r["visits"]["branch_id"] is None for r in besar["rows"]) and any(r["diagnosis"] is None for r in besar["rows"]), "fixture kurang variasi"
        assert any(r["visits"]["pets"]["breed"] is None for r in besar["rows"]) and any(r["visits"]["dokter"] is None for r in besar["rows"])
        waktu = {}
        for r in besar["rows"]:
            waktu.setdefault(r["created_at"], []).append(r["id"])
        assert any(len(v) > 3 for v in waktu.values()), "fixture tanpa waktu kembar"
        for v in waktu.values():
            assert v == sorted(v), "waktu kembar harus berurut id"
        assert [r["created_at"] for r in besar["rows"]] == sorted([r["created_at"] for r in besar["rows"]], reverse=True)
        lap = jalan(pg, PENGGUNA["owner"][0], None, rpc_lapisan(SEMUA_CAB))
        assert lap["per_cabang"] and all(int(v["minus"]) > 0 for v in lap["per_cabang"].values()) and lap["biaya_negatif"] == 1, lap
        assert jalan(pg, PENGGUNA["owner"][0], None, rpc_lapisan([CAB_A, CAB_B]))["biaya_negatif"] == 0   # qty_left = 0 tidak dihitung; cabang X tidak diminta
        bk = jalan(pg, PENGGUNA["owner"][0], None, rpc_buku(("2026-04-30", SEMUA_CAB, True)))
        assert bk["akun_ada"] is True and len(bk["per_cabang"]) == 3 and bk["tak_teralokasi"] not in ("0", None), bk
        print(f"PASS B: kombinasi identik dengan RLS tabel langsung — {hasil_b}; fixture {n_mr} rekam medis / {n_lay} lapisan / {n_jl} baris jurnal", flush=True)
        laporan["B"] = {**hasil_b, "rekam_medis": n_mr, "lapisan": n_lay, "baris_jurnal": n_jl}

        # B2. akun 170001 tidak ada -> akun_ada=false (jalur 'ledger null' pembaca lama)
        pg.sql("set session_replication_role = replica; update public.coa_accounts set code = '170001X' where code = '170001'; set session_replication_role = origin;")
        tanpa = jalan(pg, PENGGUNA["owner"][0], None, rpc_buku(("2026-04-30", SEMUA_CAB, True)))
        assert tanpa == {"akun_ada": False}, tanpa
        pg.sql("set session_replication_role = replica; update public.coa_accounts set code = '170001' where code = '170001X'; set session_replication_role = origin;")
        print("PASS B2: akun 170001 tidak ada -> {akun_ada:false}", flush=True)

        # B3. nilai negatif: pembaca lama menolak laporan; fungsi melaporkan hitungannya (bila tabel mengizinkan nilai negatif)
        negatif_ok = {}
        for nama, ins in (("lapisan", f"insert into public.stock_layers(warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost, source) values ({uid('90000000', 1)}, {uid('91000000', 1)}, '2026-03-01', 1, 1, -5, 'purchase')"),
                          ("jurnal", "insert into public.journal_lines(entry_id, account_id, debit, credit) select entry_id, account_id, -3, 0 from public.journal_lines l where account_id = (select id from public.coa_accounts where code = '170001') limit 1")):
            try:
                pg.sql(f"set session_replication_role = replica; {ins}; set session_replication_role = origin;")
                negatif_ok[nama] = True
            except RuntimeError:
                negatif_ok[nama] = False
        if negatif_ok["lapisan"]:
            assert jalan(pg, PENGGUNA["owner"][0], None, rpc_lapisan(SEMUA_CAB))["biaya_negatif"] == 2
            pg.sql("delete from public.stock_layers where unit_cost = -5;")
        if negatif_ok["jurnal"]:
            assert jalan(pg, PENGGUNA["owner"][0], None, rpc_buku(("2026-04-30", SEMUA_CAB, True)))["negatif"] >= 1
            pg.sql("set session_replication_role = replica; delete from public.journal_lines where debit < 0; set session_replication_role = origin;")
        print(f"PASS B3: hitungan nilai negatif dilaporkan fungsi ({negatif_ok}); data dipulihkan", flush=True)

        # C. pagar
        for fungsi, sql, definer in ((F_ANAMNESA, "select public.laporan_anamnesa('2026-01-01','2026-01-02');", False),
                                     (F_LAPISAN, f"select public.laporan_persediaan_lapisan({arr([CAB_A])});", False),
                                     (F_BUKU, f"select public.laporan_persediaan_buku_besar('2026-01-02', {arr([CAB_A])}, false);", True)):
            try:
                pg.sql(f"begin; set local role anon; {sql} commit;")
                raise AssertionError(f"anon seharusnya ditolak: {fungsi}")
            except RuntimeError as error:
                assert "permission denied" in str(error), str(error)[:300]
            attr = pg.last(f"select prosecdef::text||'|'||provolatile::text||'|'||array_to_string(proconfig,',') from pg_proc where oid='{fungsi}'::regprocedure;")
            assert attr == f'{str(definer).lower()}|s|search_path=""', (fungsi, attr)
            acl = pg.last(f"select coalesce(proacl::text,'') from pg_proc where oid='{fungsi}'::regprocedure;")
            assert "authenticated=X" in acl and "anon" not in acl and not acl.startswith("=") and ",=X" not in acl, acl
            try:
                pg.sql(sesi(PENGGUNA["admin_online"][0], None) + sql + "\ncommit;")
                raise AssertionError(f"Admin Online seharusnya ditolak: {fungsi}")
            except RuntimeError as error:
                assert "ADMIN_ONLINE_FUNCTION_DENIED" in str(error), str(error)[:300]
            pg.sql(sesi(PENGGUNA["owner"][0], None) + "set transaction read only;\n" + sql + "\ncommit;")
        for sql, kode in (("select public.laporan_anamnesa(null,'2026-12-31');", "LAPORAN_ANAMNESA_PERIODE"),
                          ("select public.laporan_persediaan_lapisan(null);", "LAPORAN_PERSEDIAAN_CABANG"),
                          ("select public.laporan_persediaan_buku_besar(null, array[]::uuid[], false);", "LAPORAN_PERSEDIAAN_BUKU_BESAR")):
            try:
                pg.sql(sesi(PENGGUNA["owner"][0], None) + sql + "\ncommit;")
                raise AssertionError(f"masukan kosong seharusnya ditolak: {kode}")
            except RuntimeError as error:
                assert kode in str(error), str(error)[:300]
        # tidak ada tulis: jumlah baris tabel sama sebelum/sesudah semua panggilan (read-only transaction juga menolak tulis)
        assert int(pg.last("select count(*) from public.medical_records;")) == n_mr
        print("PASS C: anon dan Admin Online ditolak di 3 fungsi; INVOKER/DEFINER + STABLE + search_path kosong sesuai; EXECUTE hanya authenticated; "
              "jalan di transaksi read-only; masukan kosong ditolak", flush=True)

        # D. mutan
        asli = MIGRASI.read_text()
        mutan = {
            # --- anamnesa ---
            "anamnesa: SECURITY DEFINER (RLS terlewati)": ("a", [("returns jsonb\nlanguage plpgsql\nstable\nsecurity invoker\nset search_path = ''\nas $$\ndeclare\n  v_rows jsonb;", "returns jsonb\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = ''\nas $$\ndeclare\n  v_rows jsonb;")]),
            "anamnesa: batas awal eksklusif": ("a", [("where mr.created_at >= p_from", "where mr.created_at > p_from")]),
            "anamnesa: batas akhir inklusif diganti eksklusif": ("a", [("else mr.created_at <= p_to end", "else mr.created_at < p_to end")]),
            "anamnesa: p_to_eksklusif diabaikan": ("a", [("case when p_to_eksklusif then", "case when false then")]),
            "anamnesa: filter cabang diabaikan": ("a", [("(p_branch_id is null or (v.id is not null and v.branch_id = p_branch_id))", "true")]),
            "anamnesa: urutan tanpa pemutus id": ("a", [("order by x.created_at desc, x.id)", "order by x.created_at desc)")]),
            "anamnesa: urutan naik": ("a", [("order by x.created_at desc, x.id)", "order by x.created_at, x.id)")]),
            "anamnesa: ras hewan dibuang": ("a", [("'breed', p.breed", "'breed', null")]),
            "anamnesa: nama cabang dibuang": ("a", [("case when b.id is null then null else jsonb_build_object('name', b.name) end", "null")]),
            "anamnesa: nama pemilik dibuang": ("a", [("'customers', case when c.id is null then null else jsonb_build_object('name', c.name) end", "'customers', null")]),
            "anamnesa: hitungan salah (selalu 0)": ("a", [("jsonb_build_object('n', v_n, 'rows', v_rows)", "jsonb_build_object('n', 0, 'rows', v_rows)")]),
            "anamnesa: dokter dibuang": ("a", [("'dokter', v.dokter,", "'dokter', null,")]),
            # --- lapisan ---
            "lapisan: SECURITY DEFINER (RLS gudang terlewati)": ("l", [("returns jsonb\nlanguage plpgsql\nstable\nsecurity invoker\nset search_path = ''\nas $$\ndeclare\n  v_per jsonb;\n  v_negatif bigint;", "returns jsonb\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = ''\nas $$\ndeclare\n  v_per jsonb;\n  v_negatif bigint;")]),
            "lapisan: biaya negatif ikut walau qty_left = 0": ("l", [("where w.branch_id = any(p_branch_ids) and sl.qty_left > 0 and sl.unit_cost < 0;", "where w.branch_id = any(p_branch_ids) and sl.qty_left >= 0 and sl.unit_cost < 0;")]),
            "lapisan: nilai tanpa biaya (hanya qty)": ("l", [("sum(sl.qty_left * sl.unit_cost)", "sum(sl.qty_left)")]),
            "lapisan: stok minus termasuk nol": ("l", [("where s.qty < 0\n", "where s.qty <= 0\n")]),
            "lapisan: hitungan biaya negatif lintas cabang": ("l", [("where w.branch_id = any(p_branch_ids) and sl.qty_left > 0 and sl.unit_cost < 0;", "where sl.qty_left > 0 and sl.unit_cost < 0;")]),
            "lapisan: cabang tanpa gudang hilang": ("l", [("left join lay on lay.branch_id = b.id", "join lay on lay.branch_id = b.id")]),
            # --- buku besar ---
            "buku besar: tanpa cek akses cabang": ("b", [("or (p_tak_teralokasi and e.branch_id is null))", "or (p_tak_teralokasi and e.branch_id is null)) or e.branch_id = any(p_branch_ids)")]),
            "buku besar: akses cabang diabaikan seluruhnya": ("b", [("(e.branch_id = any(p_branch_ids) and e.branch_id = any(v_boleh))", "(e.branch_id = any(p_branch_ids))")]),
            "buku besar: tanggal eksklusif": ("b", [("and e.tanggal <= p_as_of", "and e.tanggal < p_as_of")]),
            "buku besar: tanpa cabang selalu ikut": ("b", [("(p_tak_teralokasi and e.branch_id is null)", "e.branch_id is null")]),
            "buku besar: tanpa cabang tidak pernah ikut": ("b", [("(p_tak_teralokasi and e.branch_id is null)", "false")]),
            "buku besar: debit-kredit terbalik": ("b", [("sum(debit - credit) as saldo", "sum(credit - debit) as saldo")]),
            "buku besar: hanya debit": ("b", [("sum(debit - credit) as saldo", "sum(debit) as saldo")]),
            "buku besar: akun salah": ("b", [("where a.code = '170001'", "where a.code = '199999'")]),
            "buku besar: filter cabang diabaikan": ("b", [("e.branch_id = any(p_branch_ids) and e.branch_id = any(v_boleh)", "e.branch_id = any(v_boleh)")]),
            "buku besar: saldo tanpa cabang selalu 0": ("b", [("coalesce((select sum(debit - credit) from l where branch_id is null), 0)", "0")]),
            "buku besar: cabang boleh hanya yang aktif": ("b", [("  from public.branches b\n  where public.user_can_access_branch(b.id);\n\n  with l", "  from public.branches b\n  where public.user_can_access_branch(b.id) and b.is_active;\n\n  with l")]),
        }
        hidup = []
        for nama, (jenis, ganti) in mutan.items():
            kode = asli
            for a, b in ganti:
                assert asli.count(a) == 1, f"jangkar mutan '{nama}' tidak tepat satu kali: {asli.count(a)}"
                kode = kode.replace(a, b)
            muat(pg, kode)
            _, _, _, beda_m = matriks(pg, uids, jenis, berhenti_pertama=True)
            if not beda_m:
                hidup.append(nama)
        # mutan pagar Admin Online: pagar dibuang => Admin Online TIDAK ditolak lagi (babak C akan merah)
        for nama, a, b, sql in (
            ("buku besar: tanpa pagar Admin Online", "  perform admin_online_private.deny_admin_online();\n", "  null;\n", f"select public.laporan_persediaan_buku_besar('2026-01-02', {arr([CAB_A])}, false);"),
            ("anamnesa: tanpa pagar Admin Online", "  if admin_online_private.is_admin_online() then\n    raise exception 'ADMIN_ONLINE_FUNCTION_DENIED: fungsi ini tidak tersedia untuk peran Admin Online' using errcode = '42501';\n  end if;\n  if p_from is null", "  if p_from is null", "select public.laporan_anamnesa('2026-01-01','2026-01-02');"),
        ):
            assert asli.count(a) == 1, nama
            muat(pg, asli.replace(a, b))
            try:
                pg.sql(sesi(PENGGUNA["admin_online"][0], None) + sql + "\ncommit;")
                # pagar dibuang dan Admin Online lolos: ini yang harus ditangkap babak C (penolakan ADMIN_ONLINE_FUNCTION_DENIED)
            except RuntimeError as error:
                if "ADMIN_ONLINE_FUNCTION_DENIED" in str(error):
                    hidup.append(nama + " (masih ditolak: mutan tidak mengubah apa pun)")
        muat(pg, asli)  # pulihkan
        assert not hidup, f"mutan lolos: {hidup}"
        for jenis in ("a", "l", "b"):
            _, _, _, beda_pulih = matriks(pg, uids[:3], jenis)
            assert not beda_pulih
        print(f"PASS D: {len(mutan) + 2} mutan semuanya ketahuan (matriks B/pagar); fungsi asli dipulihkan dan hijau lagi", flush=True)
        laporan["D"] = {"mutan": len(mutan) + 2, "hidup": 0}

        # E. kecepatan sebagai staf cabang A (RLS per baris benar-benar bekerja)
        isi_jurnal(pg, 15000, mulai=2000)
        staff = PENGGUNA["staff_a"][0]
        pg.sql("update public.user_branches set branch_id = branch_id;")  # no-op, memastikan tidak ada transaksi menggantung

        def ukur(sql):
            mulai = time.perf_counter()
            pg.sql(sesi(staff, None) + sql + "\ncommit;")
            return time.perf_counter() - mulai
        akun = "(select id from public.coa_accounts where code = '170001')"
        n_staf = int(pg.last(sesi(staff, None) + f"select count(*) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id where l.account_id = {akun} and e.tanggal <= '2026-04-30' and e.branch_id = '{CAB_A}';\ncommit;"))
        halaman = max(1, -(-n_staf // 500))
        t_halaman = min(ukur(f"select count(*) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id where l.account_id = {akun} and e.tanggal <= '2026-04-30' and e.branch_id = '{CAB_A}';"
                             f" select l.id, l.debit::text, l.credit::text, e.tanggal, e.branch_id from public.journal_lines l join public.journal_entries e on e.id = l.entry_id where l.account_id = {akun} and e.tanggal <= '2026-04-30' and e.branch_id = '{CAB_A}' order by l.id limit 500;") for _ in range(2))
        lama_est = halaman * t_halaman
        t_rpc = min(ukur(f"select public.laporan_persediaan_buku_besar('2026-04-30', {arr([CAB_A])}, false);") for _ in range(2))
        assert t_rpc < lama_est, f"tidak lebih cepat: rpc {t_rpc:.2f}s vs lama ±{lama_est:.1f}s ({halaman * 2} query)"
        print(f"PASS E: {n_staf} baris jurnal 170001 terlihat staf cabang A: RPC {t_rpc:.2f}s dalam 1 query; pembaca lama ±{lama_est:.1f}s dalam ±{halaman * 2} query "
              f"({halaman} halaman x {t_halaman:.2f}s)", flush=True)
        laporan["E"] = {"baris": n_staf, "rpc_s": round(t_rpc, 3), "lama_est_s": round(lama_est, 2), "query_lama": halaman * 2}
    if args.json:
        Path(args.json).write_text(json.dumps(laporan, indent=1))
    print("SEMUA PASS", flush=True)


if __name__ == "__main__":
    main()
