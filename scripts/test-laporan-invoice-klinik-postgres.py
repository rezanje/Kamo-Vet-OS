#!/usr/bin/env python3
"""Uji migrasi 20261203100000 (invoice klinik + item dibaca di database) di PostgreSQL sungguhan, data fiktif.

Babak:
  A. SKEMA PENUH — seluruh migrasi repo diputar dari nol, termasuk migrasi ini (dua kali: idempoten).
  B. KESETARAAN HAK BACA — untuk tiap pengguna x header cabang operasional x filter (periode/cabang/dengan-item),
     hasil public.laporan_invoice_klinik() == baris yang sama lewat tabel langsung sebagai `authenticated`
     (RLS invoices/invoice_items/visits/clinic_demo_invoice_snapshots/medical_records/compounding_recipes/clinic_refunds/
     clinic_refund_items/branches/customers/pets yang berlaku): isi, urutan, dan hitungan. Harus identik di semua kombinasi.
  C. PAGAR — anon dan Admin Online ditolak; STABLE, SECURITY DEFINER, search_path kosong; hanya authenticated punya EXECUTE.
  D. MUTAN — fungsi diganti varian yang salah (hak baca dilonggarkan, batas periode, cabang, item, snapshot, refund,
     racikan) dan matriks B harus gagal untuk tiap varian; fungsi asli dipulihkan sesudahnya.
  E. KECEPATAN — ribuan invoice: satu panggilan jauh lebih sedikit query daripada pembaca lama (invoice halaman 500 +
     item/snapshot per 100 id).

Tidak pernah terhubung ke Production: klaster lokal sekali pakai, socket unix, dibuang di akhir.

    python3 scripts/test-laporan-invoice-klinik-postgres.py [--pg-bin DIR] [--json out.json]
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
MIGRASI = MIGRATIONS / "20261203100000_laporan_invoice_klinik_cepat.sql"
FUNGSI = "public.laporan_invoice_klinik(timestamptz,timestamptz,uuid,boolean)"

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
# (p_from, p_to, p_branch_id, p_dengan_item)
FILTER = [
    ("2026-01-01T00:00:00+07:00", "2026-12-31T23:59:59.999999+07:00", None, True),
    ("2026-02-01T00:00:00+07:00", "2026-02-07T23:59:59.999999+07:00", None, True),     # batas persis: invoice di tepi harus ikut
    ("2026-02-08T00:00:00+07:00", "2026-02-14T23:59:59.999999+07:00", None, True),
    ("2026-02-01T00:00:00+07:00", "2026-03-31T23:59:59.999999+07:00", CAB_A, True),
    ("2026-02-01T00:00:00+07:00", "2026-03-31T23:59:59.999999+07:00", CAB_B, True),
    ("2026-01-15T00:00:00+07:00", "2026-03-15T23:59:59.999999+07:00", CAB_X, True),
    ("2026-01-01T00:00:00+07:00", "2026-12-31T23:59:59.999999+07:00", None, False),
    ("2026-06-01T00:00:00+07:00", "2026-06-02T23:59:59.999999+07:00", None, True),    # tanpa invoice
]


def q(v):
    return "null" if v is None else "'" + v.replace("'", "''") + "'"


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
      insert into public.pets(id, customer_id, name) select {uid('d1000000', 'g')}, {uid('d0000000', 'g')}, 'Hewan Uji ' || g from generate_series(1, 20) g;""")


def isi_invoice(pg, jumlah, mulai=1):
    """`jumlah` invoice fiktif (tiap invoice satu kunjungan), 0-3 item, tersebar di 3 cabang + kunjungan impor tanpa cabang,
    Jan–Apr 2026 (tepi rentang ikut), campur batal/racikan/jasa/barang/snapshot DEMO/refund (cabang refund & snapshot kadang beda)."""
    pg.sql(f"""set session_replication_role = replica;
      insert into public.visits(id, branch_id, customer_id, pet_id, poli, doctor_id, status, source, legacy_source_key, legacy_source_hash, created_at)
      select {uid('a1000000', 'g')},
             (array['{CAB_A}','{CAB_B}','{CAB_X}','{CAB_A}',null]::uuid[])[1 + g % 5],
             {uid('d0000000', '1 + g % 20')}, {uid('d1000000', '1 + g % 20')}, 'Umum',
             case when g % 3 = 0 then {uid('f2000000', '1 + g % 4')} else null end, 'Selesai', 'walk_in',
             case when g % 5 = 4 then 'LEG-' || g else null end, case when g % 5 = 4 then 'h' || g else null end,
             timestamptz '2026-01-01 00:00:00+07' + (g % 120) * interval '1 day'
      from generate_series({mulai}, {mulai} + {jumlah} - 1) g;
      insert into public.invoices(id, visit_id, invoice_no, subtotal, discount, total, paid_status, created_at, voided_at, salesperson_id)
      select {uid('e0000000', 'g')}, {uid('a1000000', 'g')}, 'UJI-I-' || g, 100 + g % 50, g % 7, 100 + g % 50 - g % 7, 'paid',
             case when g % 10 = 0 then timestamptz '2026-02-01 00:00:00+07' + ((g / 10) % 3) * interval '7 day'              -- tepi awal rentang
                  when g % 10 = 5 then timestamptz '2026-02-07 23:59:59.999999+07' + ((g / 10) % 3) * interval '7 day'        -- tepi akhir rentang
                  else timestamptz '2026-01-01 00:00:00+07' + (g % 120) * interval '1 day' + (g % 24) * interval '1 hour' end,
             case when g % 17 = 0 then now() else null end,
             case when g % 4 = 1 then {uid('f3000000', '1 + g % 3')} else null end
      from generate_series({mulai}, {mulai} + {jumlah} - 1) g;
      insert into public.invoice_items(id, invoice_id, deskripsi, qty, harga, jenis, item_id, diskon_persen, compound_recipe_id, bmhp_components, service_performers, salesperson_id)
      select {uid('11000000', 'g * 10 + j')}, {uid('e0000000', 'g')},
             case when j = 1 then 'Racikan Z' || (g % 5) when j = 2 then 'racikan  z' || (g % 5) else 'Barang ' || (g % 9) end,
             1 + j, 1000.25 * (1 + j),
             (array['obat','jasa','produk','obat'])[1 + (g + j) % 4],
             case when (g + j) % 3 = 1 then {uid('f4000000', '1 + g % 6')} else null end,
             (g + j) % 7, case when j = 2 and g % 9 = 0 then {uid('f5000000', 'g')} else null end,
             case when g % 6 = 0 then '[{{"item_id":"x","qty":1}}]'::jsonb else null end,
             case when (g + j) % 4 = 1 then '{{"staff_id":"x"}}'::jsonb else null end,
             case when j = 0 and g % 8 = 0 then {uid('f3000000', '1 + g % 3')} else null end
      from generate_series({mulai}, {mulai} + {jumlah} - 1) g, generate_series(0, 2) j
      where j < g % 4;
      insert into public.medical_records(id, visit_id) select {uid('12000000', 'g')}, {uid('a1000000', 'g')}
      from generate_series({mulai}, {mulai} + {jumlah} - 1) g where g % 3 = 0 or g % 6 = 2;
      insert into public.compounding_recipes(id, medical_record_id, recipe_name)
      select {uid('13000000', 'g')}, {uid('12000000', 'g')}, 'Racikan Z' || (g % 5) from generate_series({mulai}, {mulai} + {jumlah} - 1) g where g % 6 in (0, 2, 3);
      insert into public.clinic_demo_invoice_snapshots(invoice_id, policy_id, branch_id, request_key, request_hash, base_total, fee_amount, fee_bearer, payments, service_basis, incentive_pool)
      select {uid('e0000000', 'g')}, gen_random_uuid(), case when g % 26 = 0 then '{CAB_B}'::uuid else coalesce((select v.branch_id from public.visits v where v.id = {uid('a1000000', 'g')}), '{CAB_A}'::uuid) end,
             'k' || g, 'h' || g, 100, 2.5 + g % 3, case when g % 2 = 0 then 'customer' else 'clinic' end, '[]'::jsonb, 0, 0
      from generate_series({mulai}, {mulai} + {jumlah} - 1) g where g % 13 = 0;
      insert into public.clinic_refunds(id, no_refund, invoice_id, visit_id, branch_id, tanggal, total, method, cash_account_id, account_snapshot, expense_id, request_id, created_by)
      select {uid('14000000', 'g')}, 'UJI-R-' || g, {uid('e0000000', 'g')}, {uid('a1000000', 'g')},
             case when g % 38 = 0 then '{CAB_B}'::uuid else coalesce((select v.branch_id from public.visits v where v.id = {uid('a1000000', 'g')}), '{CAB_A}'::uuid) end,
             date '2026-02-01' + g % 60, 10 + g % 5, 'Tunai', gen_random_uuid(), '{{}}'::jsonb, gen_random_uuid(), gen_random_uuid(), '{PENGGUNA["owner"][0]}'::uuid
      from generate_series({mulai}, {mulai} + {jumlah} - 1) g where g % 19 = 0;
      insert into public.clinic_refund_items(id, refund_id, invoice_item_id, deskripsi, jenis, qty, amount, restock)
      select {uid('15000000', 'g')}, {uid('14000000', 'g')}, {uid('11000000', 'g * 10')}, 'Barang', 'obat', 1, 10, false
      from generate_series({mulai}, {mulai} + {jumlah} - 1) g where g % 19 = 0 and g % 4 > 0;
      set session_replication_role = origin;""")


def sesi(u, header):
    s = "begin; set local role authenticated;\n"
    if u is not None:
        s += f"select set_config('request.jwt.claim.sub', '{u}', true);\n"
    if header is not None:
        s += f"select set_config('request.headers', {q(header)}, true);\n"
    return s


def referensi(dari, sampai, cabang, dengan_item):
    """Bentuk hasil yang sama, dibaca lewat tabel langsung (RLS berlaku), seperti embed PostgREST pembaca lama."""
    cab = f"and (select v.branch_id from public.visits v where v.id = x.visit_id) = '{cabang}'" if cabang else ""
    di = "true" if dengan_item else "false"
    return f"""with s as (
        select x.* from public.invoices x
        where x.created_at >= '{dari}' and x.created_at <= '{sampai}' and x.voided_at is null {cab}
      ), ix as (select i.* from public.invoice_items i where i.invoice_id in (select id from s)),
      inv as (select jsonb_build_object('id',x.id,'visit_id',x.visit_id,'invoice_no',x.invoice_no,'created_at',x.created_at,'paid_status',x.paid_status,
          'subtotal',x.subtotal,'discount',x.discount,'total',x.total,'salesperson_id',x.salesperson_id,'voided_at',x.voided_at,
          'n_item',(select count(*) from public.invoice_items i where i.invoice_id = x.id),
          'visits',(select jsonb_build_object('branch_id',v.branch_id,'customer_id',v.customer_id,'doctor_id',v.doctor_id,
             'branches',(select jsonb_build_object('name',b.name) from public.branches b where b.id=v.branch_id),
             'customers',(select jsonb_build_object('name',c.name) from public.customers c where c.id=v.customer_id),
             'pets',(select jsonb_build_object('name',p.name) from public.pets p where p.id=v.pet_id)) from public.visits v where v.id = x.visit_id)) j, x.id from s x),
      itm as (select jsonb_build_object('id',i.id,'invoice_id',i.invoice_id,'deskripsi',i.deskripsi,'qty',i.qty,'harga',i.harga,'diskon_persen',i.diskon_persen,
          'jenis',i.jenis,'item_id',i.item_id,'compound_recipe_id',i.compound_recipe_id,'bmhp_components',i.bmhp_components,
          'service_performers',i.service_performers,'salesperson_id',i.salesperson_id) j, i.id from ix i where {di}),
      kand as (select distinct s.visit_id from s join ix on ix.invoice_id = s.id
               where {di} and ix.compound_recipe_id is null and ix.jenis is distinct from 'jasa' and ix.item_id is null),
      rck as (select jsonb_build_object('visit_id',mr.visit_id,'recipe_name',cr.recipe_name) j, mr.visit_id, cr.id
              from public.medical_records mr join public.compounding_recipes cr on cr.medical_record_id = mr.id
              where mr.visit_id in (select visit_id from kand)),
      dmo as (select jsonb_build_object('invoice_id',d.invoice_id,'fee_amount',d.fee_amount,'fee_bearer',d.fee_bearer) j, d.invoice_id
              from public.clinic_demo_invoice_snapshots d where d.invoice_id in (select id from s) and {di}),
      rf as (select jsonb_build_object('id',r.id,'invoice_id',r.invoice_id,'tanggal',r.tanggal,'clinic_refund_items',
              coalesce((select jsonb_agg(jsonb_build_object('id',ri.id,'invoice_item_id',ri.invoice_item_id,'qty',ri.qty) order by ri.id)
                        from public.clinic_refund_items ri where ri.refund_id = r.id),'[]'::jsonb)) j, r.id
             from public.clinic_refunds r where r.invoice_id in (select id from s) and {di})
      select jsonb_build_object('n_invoice',(select count(*) from inv),'n_item',(select count(*) from itm),
        'invoices',(select coalesce(jsonb_agg(j order by id),'[]'::jsonb) from inv),
        'items',(select coalesce(jsonb_agg(j order by id),'[]'::jsonb) from itm),
        'demo',(select coalesce(jsonb_agg(j order by invoice_id),'[]'::jsonb) from dmo),
        'racikan',(select coalesce(jsonb_agg(j order by visit_id, id),'[]'::jsonb) from rck),
        'refunds',(select coalesce(jsonb_agg(j order by id),'[]'::jsonb) from rf));"""


_cache_ref = {}


def lewat_rls(pg, u, header, f):
    kunci = (u, header, f)
    if kunci not in _cache_ref:
        out = pg.sql(sesi(u, header) + referensi(*f) + "\ncommit;")
        _cache_ref[kunci] = json.loads(out.splitlines()[-1])
    return _cache_ref[kunci]


def lewat_rpc(pg, u, header, f):
    dari, sampai, cabang, dengan_item = f
    out = pg.sql(sesi(u, header) + f"select public.laporan_invoice_klinik({q(dari)}::timestamptz, {q(sampai)}::timestamptz, {q(cabang)}::uuid, {str(dengan_item).lower()});\ncommit;")
    return json.loads(out.splitlines()[-1])


def matriks(pg, uids, berhenti_pertama=False):
    total, berisi, beda_isi, beda = 0, 0, set(), []
    for u, header, f in itertools.product(uids, HEADER, FILTER):
        rls, rpc = lewat_rls(pg, u, header, f), lewat_rpc(pg, u, header, f)
        total += 1
        berisi += bool(rpc["invoices"])
        beda_isi.add(json.dumps(rpc, sort_keys=True)[:6000])
        if rls != rpc:
            beda.append((u, header, f))
            if berhenti_pertama:
                break
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
        isi_invoice(pg, 600)
        jumlah_invoice = int(pg.last("select count(*) from public.invoices;"))
        jumlah_item = int(pg.last("select count(*) from public.invoice_items;"))
        fx = {t: int(pg.last(f"select count(*) from public.{t};")) for t in ("clinic_demo_invoice_snapshots", "clinic_refunds", "clinic_refund_items", "compounding_recipes")}
        assert jumlah_invoice == 600 and jumlah_item > 600 and all(fx.values()), (jumlah_invoice, jumlah_item, fx)

        # B. kesetaraan hak baca
        uids = [u[0] for n, u in PENGGUNA.items() if n != "admin_online"] + [TANPA_PROFIL]
        total, berisi, beda_isi, beda = matriks(pg, uids)
        assert not beda, f"BEDA dengan RLS pada {len(beda)} kombinasi, mis. {beda[:2]}"
        assert 0 < berisi < total and len(beda_isi) > 8, "matriks tidak menguji cukup variasi hak baca/filter"
        # fixture benar-benar memuat unsur yang dibaca (supaya kesamaan bukan kesamaan kosong)
        besar = json.loads(pg.last(sesi(PENGGUNA["owner"][0], None) + "select public.laporan_invoice_klinik('2026-01-01T00:00:00+07:00','2026-12-31T23:59:59.999999+07:00', null, true);\ncommit;"))
        assert besar["demo"] and besar["racikan"] and besar["refunds"] and any(r["clinic_refund_items"] for r in besar["refunds"]), {k: len(v) for k, v in besar.items() if isinstance(v, list)}
        assert any(i["visits"]["branch_id"] is None for i in besar["invoices"]), "fixture tanpa kunjungan tanpa cabang"
        assert any(i["n_item"] == 0 for i in besar["invoices"]), "fixture tanpa invoice tanpa item"
        print(f"PASS B: {total} kombinasi (pengguna x header cabang x filter) identik dengan RLS tabel langsung;"
              f" {len(beda_isi)} hasil berbeda, {total - berisi} kosong; fixture {jumlah_invoice} invoice / {jumlah_item} item / {fx}", flush=True)
        laporan["B"] = {"kombinasi": total, "hasil_berbeda": len(beda_isi), "kosong": total - berisi, "invoice": jumlah_invoice, "item": jumlah_item, **fx}

        # C. pagar
        try:
            pg.sql("begin; set local role anon; select public.laporan_invoice_klinik('2026-01-01','2026-01-02'); commit;")
            raise AssertionError("anon seharusnya ditolak")
        except RuntimeError as error:
            assert "permission denied" in str(error), str(error)[:300]
        attr = pg.last(f"select prosecdef::text||'|'||provolatile::text||'|'||array_to_string(proconfig,',') from pg_proc where oid='{FUNGSI}'::regprocedure;")
        assert attr == 'true|s|search_path=""', attr
        acl = pg.last(f"select coalesce(proacl::text,'') from pg_proc where oid='{FUNGSI}'::regprocedure;")
        assert "authenticated=X" in acl and "anon" not in acl and not acl.startswith("=") and ",=X" not in acl, acl
        try:
            pg.sql(sesi(PENGGUNA["admin_online"][0], None) + "select public.laporan_invoice_klinik('2026-01-01','2026-12-31');\ncommit;")
            raise AssertionError("Admin Online seharusnya ditolak")
        except RuntimeError as error:
            assert "ADMIN_ONLINE_FUNCTION_DENIED" in str(error), str(error)[:300]
        try:
            pg.sql(sesi(PENGGUNA["owner"][0], None) + "select public.laporan_invoice_klinik(null,'2026-12-31');\ncommit;")
            raise AssertionError("periode kosong seharusnya ditolak")
        except RuntimeError as error:
            assert "LAPORAN_INVOICE_PERIODE" in str(error), str(error)[:300]
        pg.sql(sesi(PENGGUNA["owner"][0], None) + "set transaction read only;\nselect public.laporan_invoice_klinik('2026-01-01','2026-12-31');\ncommit;")
        print("PASS C: anon dan Admin Online ditolak, periode kosong ditolak; SECURITY DEFINER, STABLE, search_path kosong; EXECUTE hanya authenticated; jalan di transaksi read-only", flush=True)

        # D. mutan: tiap varian salah harus ketahuan matriks B
        asli = MIGRASI.read_text()
        mutan = {
            "tanpa pagar cabang (semua invoice terlihat)": [("      and (v.branch_id = any(v_boleh) or (v.branch_id is null and v_null_ok))\n", "      and true\n")],
            "kunjungan tanpa cabang dianggap boleh": [("(v.branch_id is null and v_null_ok)", "(v.branch_id is null)")],
            "batas awal eksklusif": [("i.created_at >= p_from", "i.created_at > p_from")],
            "batas akhir eksklusif": [("i.created_at <= p_to", "i.created_at < p_to")],
            "invoice dibatalkan ikut": [("      and i.voided_at is null\n", "")],
            "filter cabang diabaikan": [("(p_branch_id is null or v.branch_id = p_branch_id)", "true")],
            "item semua invoice (bukan hanya yang terlihat)": [("    join s on s.id = x.invoice_id\n  ), n as", "    where true\n  ), n as")],
            "item tanpa urutan id": [("        ) order by ix.id), '[]'::jsonb)", "        )), '[]'::jsonb)")],
            "invoice tanpa urutan id": [("      ) order by s.id), '[]'::jsonb)", "      )), '[]'::jsonb)")],
            "p_dengan_item diabaikan": [("case when p_dengan_item then", "case when true then")],
            "nama pelanggan dibuang": [("case when c.id is null then null else jsonb_build_object('name', c.name) end", "null")],
            "nama hewan dibuang": [("case when p.id is null then null else jsonb_build_object('name', p.name) end", "null")],
            "jumlah item salah (selalu 0)": [("'n_item', coalesce(n.c, 0),", "'n_item', 0,")],
            "cabang hanya yang aktif": [("  from public.branches b\n  where public.user_can_access_branch(b.id);", "  from public.branches b\n  where public.user_can_access_branch(b.id) and b.is_active;")],
            "snapshot DEMO tanpa cek cabang": [("       where public.user_can_access_branch(d.branch_id))", "       where true)")],
            "refund tanpa cek cabang": [("       where public.user_can_access_branch(r.branch_id))", "       where true)")],
            "resep racikan semua kunjungan": [("         where ix.compound_recipe_id is null and ix.jenis is distinct from 'jasa' and ix.item_id is null)", "         where true)")],
            "refund tanpa item": [("coalesce((select jsonb_agg(jsonb_build_object(\n              'id', ri.id, 'invoice_item_id', ri.invoice_item_id, 'qty', ri.qty) order by ri.id)\n            from public.clinic_refund_items ri where ri.refund_id = r.id), '[]'::jsonb)", "'[]'::jsonb")],
        }
        hidup = []
        for nama, ganti in mutan.items():
            kode = asli
            for a, b in ganti:
                assert asli.count(a) >= 1, f"jangkar mutan '{nama}' tidak ditemukan"
                if nama != "p_dengan_item diabaikan":
                    assert asli.count(a) == 1, f"jangkar mutan '{nama}' tidak tepat satu kali: {asli.count(a)}"
                kode = kode.replace(a, b)
            pg.sql("begin;\n" + kode + "\ncommit;")
            _, _, _, beda_m = matriks(pg, uids, berhenti_pertama=True)
            if not beda_m:
                hidup.append(nama)
        a = "  perform admin_online_private.deny_admin_online();\n"
        assert asli.count(a) == 1
        pg.sql("begin;\n" + asli.replace(a, "  null;\n") + "\ncommit;")
        try:
            pg.sql(sesi(PENGGUNA["admin_online"][0], None) + "select public.laporan_invoice_klinik('2026-01-01','2026-12-31');\ncommit;")
            # tanpa penjaga Admin Online dapat membaca => babak C mendeteksinya: mutan mati.
        except RuntimeError:
            hidup.append("tanpa pagar Admin Online (mutan masih menolak)")
        pg.sql("begin;\n" + asli + "\ncommit;")  # pulihkan
        assert not hidup, f"mutan lolos: {hidup}"
        _, _, _, beda_pulih = matriks(pg, uids[:3])
        assert not beda_pulih
        print(f"PASS D: {len(mutan) + 1} mutan semuanya ketahuan (matriks B/pagar); fungsi asli dipulihkan dan hijau lagi", flush=True)
        laporan["D"] = {"mutan": len(mutan) + 1, "hidup": 0}

        # E. kecepatan sebagai staff cabang A (RLS per baris benar-benar bekerja)
        isi_invoice(pg, 12000, mulai=1000)
        staff = PENGGUNA["staff_a"][0]
        besar_r = ("2026-01-01T00:00:00+07:00", "2026-12-31T23:59:59.999999+07:00")

        def ukur(sql):
            mulai = time.perf_counter()
            pg.sql(sesi(staff, None) + sql + "\ncommit;")
            return time.perf_counter() - mulai
        W = f"x.created_at >= '{besar_r[0]}' and x.created_at <= '{besar_r[1]}' and x.voided_at is null"
        # Pembaca lama: invoice per halaman = count exact + 500 invoice (dengan kunjungan, cabang, pelanggan, hewan);
        # item + snapshot per 100 id invoice (di sini satu kelompok yang diukur).
        t_halaman = min(ukur(f"select count(*) from public.invoices x where {W}; select x.id, (select to_jsonb(v) from public.visits v where v.id = x.visit_id) from public.invoices x where {W} order by x.id limit 500;") for _ in range(2))
        ids = "(select x.id from public.invoices x where %s order by x.id limit 100)" % W
        t_kelompok = min(ukur(f"select count(*) from public.invoice_items where invoice_id in {ids}; select id from public.invoice_items where invoice_id in {ids} order by id limit 500;"
                              f" select count(*) from public.clinic_demo_invoice_snapshots where invoice_id in {ids};") for _ in range(2))
        n_staf = int(pg.last(sesi(staff, None) + f"select count(*) from public.invoices x where {W};\ncommit;"))
        halaman = -(-n_staf // 500)
        kelompok = -(-n_staf // 100)
        lama_est = halaman * t_halaman + kelompok * t_kelompok
        t_rpc = min(ukur(f"select public.laporan_invoice_klinik('{besar_r[0]}', '{besar_r[1]}', null, true);") for _ in range(2))
        query_lama = halaman * 2 + kelompok * 4
        assert t_rpc < lama_est, f"tidak lebih cepat: rpc {t_rpc:.2f}s vs lama ±{lama_est:.1f}s ({query_lama} query)"
        print(f"PASS E: {n_staf} invoice terlihat staff: RPC {t_rpc:.2f}s dalam 1 query; pembaca lama ±{lama_est:.1f}s dalam ±{query_lama} query "
              f"({halaman} halaman x {t_halaman:.2f}s + {kelompok} kelompok x {t_kelompok:.2f}s)", flush=True)
        laporan["E"] = {"invoice": n_staf, "rpc_s": round(t_rpc, 3), "lama_est_s": round(lama_est, 2), "query_lama": query_lama}
    if args.json:
        Path(args.json).write_text(json.dumps(laporan, indent=1))
    print("SEMUA PASS", flush=True)


if __name__ == "__main__":
    main()
