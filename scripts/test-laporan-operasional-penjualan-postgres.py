#!/usr/bin/env python3
"""Uji migrasi 20261212100000 (Operation & Sales: data mentah dibaca di database) di PostgreSQL sungguhan, data fiktif acak.

Babak:
  A. SKEMA PENUH — seluruh migrasi repo diputar dari nol (hak bawaan Supabase anon/authenticated/service_role dipasang SEBELUM
     migrasi ini), migrasi ini dua kali (idempoten).
  B. KESETARAAN — untuk tiap pengguna x header cabang operasional x filter x bagian (dokumen, grooming, pelanggan, stok, klinik,
     nilai_stok), hasil public.laporan_operasional_penjualan() == baris yang sama dibaca lewat tabel langsung sebagai `authenticated`
     (RLS berlaku; ini tiruan SQL dari query pembaca lama): isi, urutan, hitungan. Data acak (seed berbeda tiap putaran).
  C. PAGAR — anon dan Admin Online ditolak; bagian tak dikenal dan periode kosong ditolak; STABLE, SECURITY DEFINER, search_path kosong;
     EXECUTE hanya authenticated; jalan di transaksi read-only; tidak menulis apa pun.
  D. MUTAN — fungsi diganti varian yang salah dan matriks B harus gagal untuk tiap varian; fungsi asli dipulihkan.
  E. KECEPATAN — puluhan ribu baris: satu panggilan dibanding pembacaan halaman 500 + hitungan pasti lewat RLS.

Tidak pernah terhubung ke Production: klaster lokal sekali pakai, socket unix, dibuang di akhir.

    python3 scripts/test-laporan-operasional-penjualan-postgres.py [--pg-bin DIR] [--json out.json] [--seed N] [--lewati-mutan]
"""
import argparse
import importlib.util
import itertools
import json
import os
import random
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

import tempfile  # noqa: E402

_spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fixture)

MIGRATIONS = ROOT / "supabase/migrations"
# Migrasi 20261123084004 memeriksa akun beban yang hanya ada di COA hosted: dibuatkan akun fiktif untuk rantai sekali pakai.
SEED = ("insert into coa_accounts(code,name,type,normal_balance) select c,'Fiktif '||c,'BEBAN','D' from unnest(array['720002','720003','720004','740017','740005','720008','740021','740016','730002','720005','720006','720009','740002','740014','740013','740022','740012','760003']) c on conflict(code) do update set is_active=true,is_header=false;\n")
# Migrasi koreksi data khusus hosted gagal di rantai kosong; ditoleransi (tidak menyangkut fungsi ini).
DATA_FIX = [f.read_text() for f in MIGRATIONS.glob("*.sql") if any(k in f.name for k in ("koreksi_saldo_awal_fb", "ralat_saldo_awal", "sambung_jurnal_pengeluaran", "saldo_awal_kas_toko_ke_cabang"))]
SKIPPED = []
PRELUDE = ("alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;"
           "alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;")


class Hook:
    def __init__(self, db):
        self.db = db

    def __getattr__(self, k):
        return getattr(self.db, k)

    def sql(self, source):
        if source.startswith("begin;\n-- Kategori pengeluaran rinci"):
            source = SEED + source
        if any(t in source for t in DATA_FIX):
            try:
                return self.db.sql(source)
            except RuntimeError as e:
                SKIPPED.append(str(e)[:80])
                return ""
        return self.db.sql(source)


def build_chain(db, exclude):
    tmp = Path(tempfile.mkdtemp(prefix="oplchain.", dir="/opt/data"))
    try:
        (tmp / "supabase/migrations").mkdir(parents=True)
        for f in MIGRATIONS.glob("*.sql"):
            if f.name not in exclude:
                (tmp / "supabase/migrations" / f.name).symlink_to(f)
        old = fixture.ROOT
        fixture.ROOT = tmp
        try:
            fixture.DisposablePostgres.bootstrap(Hook(db))
        finally:
            fixture.ROOT = old
    finally:
        for f in (tmp / "supabase/migrations").glob("*"):
            f.unlink()
        (tmp / "supabase/migrations").rmdir()
        (tmp / "supabase").rmdir()
        tmp.rmdir()


MIGRASI = MIGRATIONS / "20261212100000_laporan_operasional_penjualan_cepat.sql"
FUNGSI = "public.laporan_operasional_penjualan(text,timestamptz,timestamptz,date,date,uuid[],text,boolean)"

CAB_A = "a0000000-0000-4000-8000-00000000000a"
CAB_B = "b0000000-0000-4000-8000-00000000000b"
CAB_X = "c0000000-0000-4000-8000-00000000000c"   # cabang nonaktif
CAB_C = "d0000000-0000-4000-8000-00000000000d"   # cabang tanpa pengguna biasa
SEMUA = [CAB_A, CAB_B, CAB_X, CAB_C]
PENGGUNA = {
    "owner": ("10000000-0000-4000-8000-000000000001", "OWNER", True, []),
    "admin_a": ("10000000-0000-4000-8000-000000000003", "ADMIN", True, [CAB_A]),
    "finance": ("10000000-0000-4000-8000-000000000004", "FINANCE", True, []),
    "staff_a": ("10000000-0000-4000-8000-000000000005", "STAFF", True, [CAB_A]),
    "staff_ax": ("10000000-0000-4000-8000-000000000006", "STAFF", True, [CAB_A, CAB_X]),
    "staff_b": ("10000000-0000-4000-8000-00000000000b", "STAFF", True, [CAB_B]),
    "dokter_a": ("10000000-0000-4000-8000-000000000007", "DOCTOR", True, [CAB_A]),
    "dokter_kosong": ("10000000-0000-4000-8000-000000000010", "DOCTOR", True, []),
    "staff_nonaktif": ("10000000-0000-4000-8000-000000000008", "STAFF", False, [CAB_A]),
    "admin_online": ("10000000-0000-4000-8000-000000000009", "ADMIN_ONLINE", True, [CAB_A]),
}
TANPA_PROFIL = "10000000-0000-4000-8000-0000000000ff"
HEADER = [None, '{"x-kamo-operational-branch":"%s"}' % CAB_A, '{"x-kamo-operational-branch":"%s"}' % CAB_B]
WIB = "+07:00"


def q(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def arr(ids):
    return "array[" + ",".join(f"'{i}'" for i in ids) + "]::uuid[]" if ids else "'{}'::uuid[]"


def ts(tanggal, jam="00:00:00"):
    return f"{tanggal}T{jam}{WIB}"


# ---------------------------------------------------------------------------------------------------------- filter
# (bagian, mulai, akhir, dari, sampai, cabang, kanal, rata_rata)
JAN, DES = "2026-01-01", "2026-12-31"
F_DOKUMEN = [
    (ts(JAN), ts(DES, "23:59:59.999999"), JAN, DES, SEMUA, "all"),
    (ts("2026-02-01"), ts("2026-02-07", "23:59:59.999999"), "2026-02-01", "2026-02-07", SEMUA, "all"),   # tepi persis
    (ts("2026-02-01"), ts("2026-02-28", "23:59:59.999999"), "2026-02-01", "2026-02-28", SEMUA, "pos"),
    (ts("2026-02-01"), ts("2026-02-28", "23:59:59.999999"), "2026-02-01", "2026-02-28", [CAB_A], "online"),
    (ts(JAN), ts("2026-03-31", "23:59:59.999999"), JAN, "2026-03-31", SEMUA, "klinik"),
    (ts(JAN), ts("2026-03-31", "23:59:59.999999"), JAN, "2026-03-31", [CAB_B, CAB_X], "reseller"),
    (ts(JAN), ts("2026-03-31", "23:59:59.999999"), JAN, "2026-03-31", [], "all"),
    (ts("2026-08-01"), ts("2026-08-02", "23:59:59.999999"), "2026-08-01", "2026-08-02", SEMUA, "all"),    # tanpa data
    (ts("2026-03-01"), ts("2026-03-31", "23:59:59.999999"), "2026-03-01", "2026-03-31", [CAB_A, CAB_B], "all"),
]
F_GROOMING = [
    (ts(JAN), ts(DES, "23:59:59.999999"), JAN, DES, SEMUA, "all"),
    (ts("2026-02-01"), ts("2026-02-14", "23:59:59.999999"), "2026-02-01", "2026-02-14", SEMUA, "all"),
    (ts(JAN), ts(DES, "23:59:59.999999"), JAN, DES, [CAB_A], "all"),
    (ts(JAN), ts(DES, "23:59:59.999999"), JAN, DES, [], "all"),
]
F_PELANGGAN = [
    (ts(JAN), ts(DES, "23:59:59.999999"), JAN, DES, SEMUA, "all"),
    (ts(JAN), ts("2026-02-07", "23:59:59.999999"), JAN, "2026-02-07", SEMUA, "all"),                      # akhir persis di tepi
    (ts(JAN), ts(DES, "23:59:59.999999"), JAN, DES, [CAB_A], "all"),
]
F_STOK = [
    (ts(JAN), ts(DES, "23:59:59.999999"), JAN, DES, SEMUA, "all"),
    (ts("2026-02-01"), ts("2026-02-15", "23:59:59.999999"), "2026-02-01", "2026-02-15", SEMUA, "all"),
    (ts(JAN), ts("2026-03-10", "23:59:59.999999"), JAN, "2026-03-10", [CAB_B, CAB_X], "all"),
    (ts(JAN), ts(DES, "23:59:59.999999"), JAN, DES, [], "all"),
]
F_KLINIK = [
    (ts(JAN), ts(DES, "23:59:59.999"), JAN, DES, SEMUA, "all"),
    (ts("2026-02-01"), ts("2026-02-14", "23:59:59.999"), "2026-02-01", "2026-02-14", SEMUA, "all"),
    (ts(JAN), ts(DES, "23:59:59.999"), JAN, DES, [CAB_A], "all"),
    (ts(JAN), ts(DES, "23:59:59.999"), JAN, DES, [CAB_B, CAB_X, CAB_C], "all"),
]
F_NILAI = [
    (ts("2026-02-15"), ts("2026-02-15", "23:59:59.999999"), "2026-02-15", "2026-01-15", SEMUA, "all", False),
    (ts("2026-02-15"), ts("2026-02-15", "23:59:59.999999"), "2026-02-15", "2026-01-15", SEMUA, "all", True),
    (ts("2026-03-10"), ts("2026-03-10", "23:59:59.999999"), "2026-03-10", "2026-02-10", [CAB_A], "all", False),
    (ts("2026-03-10"), ts("2026-03-10", "23:59:59.999999"), "2026-03-10", "2026-03-01", [CAB_B, CAB_X], "all", True),
]
FILTER = {"dokumen": F_DOKUMEN, "grooming": F_GROOMING, "pelanggan": F_PELANGGAN, "stok": F_STOK, "klinik": F_KLINIK, "nilai_stok": F_NILAI}


def panggil(bagian, f):
    rata = f[6] if bagian == "nilai_stok" else False
    return (f"public.laporan_operasional_penjualan('{bagian}', {q(f[0])}::timestamptz, {q(f[1])}::timestamptz, {q(f[2])}::date, {q(f[3])}::date, "
            f"{arr(f[4])}, {q(f[5])}, {str(rata).lower()})")


# ---------------------------------------------------------------------------------------------------------- referensi
SELESAI = "{a}.voided_at is null and ({a}.payment_plan is null or jsonb_typeof({a}.payment_plan) = 'null' or {a}.payments_finalized_at is not null)"


def referensi(bagian, f):
    """Tiruan SQL dari query pembaca lama, dijalankan lewat tabel langsung (RLS berlaku untuk `authenticated`)."""
    mulai, akhir, dari, sampai, cab, kanal = f[:6]
    C = arr(cab)
    if bagian == "dokumen":
        chan = {"pos": "x.channel is null", "online": "x.channel is not null"}.get(kanal, "true")
        sales_on = kanal not in ("klinik", "reseller")
        klinik_on = kanal not in ("pos", "online", "reseller")
        reseller_on = kanal in ("all", "reseller")
        s = f"""(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'branch_id',x.branch_id,'customer_id',x.customer_id,'total',x.total,
             'merchant_fee_total',x.merchant_fee_total,'channel',x.channel,'created_at',x.created_at,'payment_plan',x.payment_plan,
             'payments_finalized_at',x.payments_finalized_at,'voided_at',x.voided_at,
             'sale_items',coalesce((select jsonb_agg(jsonb_build_object('item_id',si.item_id,'qty',si.qty,'hpp',si.hpp,'harga',si.harga,
                 'items',(select jsonb_build_object('item_type',it.item_type,'tindakan_kategori',it.tindakan_kategori) from public.items it where it.id = si.item_id)) order by si.ctid)
                 from public.sale_items si where si.sale_id = x.id),'[]'::jsonb)) order by x.id),'[]'::jsonb)
           from public.sales x where x.branch_id = any({C}) and x.created_at >= '{mulai}' and x.created_at <= '{akhir}' and {chan}) """
        r = f"""(select coalesce(jsonb_agg(jsonb_build_object('sale_id',r.sale_id,'total',r.total) order by r.id),'[]'::jsonb)
           from public.sales_returns r where r.voided_at is null and r.sale_id in (
             select x.id from public.sales x where x.branch_id = any({C}) and x.created_at >= '{mulai}' and x.created_at <= '{akhir}' and {chan}
               and {SELESAI.format(a='x')})) """
        iv_where = f"v.branch_id = any({C}) and i.voided_at is null and i.created_at >= '{mulai}' and i.created_at <= '{akhir}'"
        inv = f"""(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'visit_id',i.visit_id,'total',i.total,'created_at',i.created_at,'voided_at',i.voided_at,
             'visits',jsonb_build_object('branch_id',v.branch_id,'customer_id',v.customer_id),
             'invoice_items',coalesce((select jsonb_agg(jsonb_build_object('item_id',x.item_id,'qty',x.qty,'hpp',x.hpp,'harga',x.harga,'jenis',x.jenis) order by x.ctid)
                 from public.invoice_items x where x.invoice_id = i.id),'[]'::jsonb)) order by i.id),'[]'::jsonb)
           from public.invoices i join public.visits v on v.id = i.visit_id where {iv_where}) """
        ref = f"""(select coalesce(jsonb_agg(jsonb_build_object('invoice_id',r.invoice_id,'total',r.total) order by r.id),'[]'::jsonb)
           from public.clinic_refunds r where r.invoice_id in (select i.id from public.invoices i join public.visits v on v.id = i.visit_id where {iv_where})) """
        res = f"""(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'branch_id',q.branch_id,'customer_id',q.customer_id,'dpp',q.dpp,'tanggal',q.tanggal,'status',q.status,
             'sales_invoice_items',coalesce((select jsonb_agg(jsonb_build_object('item_id',x.item_id,'qty',x.qty,'harga',x.harga) order by x.ctid)
                 from public.sales_invoice_items x where x.invoice_id = q.id),'[]'::jsonb)) order by q.id),'[]'::jsonb)
           from public.sales_invoices q where q.branch_id = any({C}) and q.status <> 'batal' and q.opening_batch_id is null and q.tanggal >= '{dari}' and q.tanggal <= '{sampai}') """
        kosong = "'[]'::jsonb"
        a, b = (s, r) if sales_on else (kosong, kosong)
        c, d = (inv, ref) if klinik_on else (kosong, kosong)
        e = res if reseller_on else kosong
        return f"""(select jsonb_build_object('n_sales',jsonb_array_length(a),'n_retur',jsonb_array_length(b),'n_invoice',jsonb_array_length(c),
             'n_refund',jsonb_array_length(d),'n_reseller',jsonb_array_length(e),'sales',a,'returns',b,'invoices',c,'refunds',d,'reseller',e)
             from (select {a} as a, {b} as b, {c} as c, {d} as d, {e} as e) z)"""
    if bagian == "grooming":
        return f"""(select jsonb_build_object('n_visits',jsonb_array_length(a),'n_kasir',jsonb_array_length(b),'visits',a,'kasir',b) from (select
          (select coalesce(jsonb_agg(jsonb_build_array(v.branch_id) order by v.id),'[]'::jsonb) from public.visits v
            where v.archived_at is null and v.poli ilike '%grooming%' and v.branch_id = any({C}) and v.created_at >= '{mulai}' and v.created_at <= '{akhir}') as a,
          (select coalesce(jsonb_agg(jsonb_build_array(s.branch_id, si.qty) order by si.id),'[]'::jsonb) from public.sale_items si
            join public.sales s on s.id = si.sale_id join public.items it on it.id = si.item_id
            where it.item_type = 'Jasa' and it.tindakan_kategori = 'Grooming' and s.voided_at is null and s.branch_id = any({C})
              and s.created_at >= '{mulai}' and s.created_at <= '{akhir}') as b) z)"""
    if bagian == "pelanggan":
        # pembaca lama membaca SEMUA struk selesai; struk tanpa pelanggan tidak berpengaruh dan dibuang di sini (aplikasi mengabaikannya).
        return f"""(select jsonb_build_object('n',jsonb_array_length(a),'rows',a) from (select coalesce(jsonb_agg(jsonb_build_array(s.id,s.customer_id,s.created_at,s.total,s.merchant_fee_total) order by s.id),'[]'::jsonb) as a
          from public.sales s where s.branch_id = any({C}) and s.created_at <= '{akhir}' and s.customer_id is not null and {SELESAI.format(a='s')}) z)"""
    if bagian == "stok":
        return f"""(select jsonb_build_object('n_stok',jsonb_array_length(a),'n_mutasi',jsonb_array_length(b),'stok',a,'mutasi',b,'barang',c) from (select
          (select coalesce(jsonb_agg(jsonb_build_array(s.item_id,s.qty) order by s.id),'[]'::jsonb) from public.stock s
            where s.warehouse_id in (select w.id from public.warehouses w where w.branch_id = any({C}) and w.is_active) and s.updated_at <= '{akhir}') as a,
          (select coalesce(jsonb_agg(jsonb_build_array(m.item_id,m.qty,m.tanggal) order by m.id),'[]'::jsonb) from public.return_record_effective_stock_moves m
            where m.warehouse_id in (select w.id from public.warehouses w where w.branch_id = any({C}) and w.is_active)
              and m.tanggal >= '{dari}' and m.tanggal <= '{sampai}' and m.qty < 0) as b,
          (select coalesce(jsonb_agg(jsonb_build_array(i.id,i.min_stock) order by i.id),'[]'::jsonb) from public.items i
            where i.is_active and i.id in (select s.item_id from public.stock s
              where s.warehouse_id in (select w.id from public.warehouses w where w.branch_id = any({C}) and w.is_active) and s.updated_at <= '{akhir}')) as c) z)"""
    if bagian == "klinik":
        return f"""(select jsonb_build_object('n_visits',jsonb_array_length(b),'bookings',a,'visits',b,'follow_ups',c,'referrals',d,'admissions',e,'capacities',g) from (select
          (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'branch_id',x.branch_id,'status',x.status,'attendance_outcome',x.attendance_outcome,'tanggal',x.tanggal) order by x.id),'[]'::jsonb)
             from public.bookings x where x.branch_id = any({C}) and x.tanggal >= '{dari}' and x.tanggal <= '{sampai}') as a,
          (select coalesce(jsonb_agg(jsonb_build_array(x.branch_id,x.status,x.checked_in_at,x.service_started_at,x.service_finished_at,x.checked_out_at) order by x.id),'[]'::jsonb)
             from public.visits x where x.branch_id = any({C}) and x.archived_at is null and x.created_at >= '{mulai}' and x.created_at <= '{akhir}') as b,
          (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'branch_id',x.branch_id,'status',x.status,'tanggal',x.tanggal,'completed_at',x.completed_at) order by x.id),'[]'::jsonb)
             from public.follow_ups x where x.branch_id = any({C}) and x.tanggal <= '{sampai}') as c,
          (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'branch_id',x.branch_id,'direction',x.direction,'referred_at',x.referred_at) order by x.id),'[]'::jsonb)
             from public.visit_referrals x where x.branch_id = any({C}) and x.referred_at >= '{mulai}' and x.referred_at <= '{akhir}') as d,
          (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'branch_id',x.branch_id,'admitted_at',x.admitted_at,'discharged_at',x.discharged_at) order by x.id),'[]'::jsonb)
             from public.inpatient_records x where x.branch_id = any({C}) and x.admitted_at < '{akhir}') as e,
          (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'branch_id',x.branch_id,'capacity',x.capacity,'valid_from',x.valid_from,'valid_until',x.valid_until) order by x.id),'[]'::jsonb)
             from public.branch_capacity_periods x where x.branch_id = any({C}) and x.valid_from <= '{sampai}') as g) z)"""
    # nilai_stok
    rata = f[6]
    return f"""(select jsonb_build_object('n_stok',jsonb_array_length(b),'n_lapisan',jsonb_array_length(c),'n_mutasi',jsonb_array_length(d),'gudang',a,'stok',b,'lapisan',c,'mutasi',d) from (select
      (select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'branch_id',w.branch_id,'type',w.type) order by w.id),'[]'::jsonb) from public.warehouses w where w.branch_id = any({C})) as a,
      (select coalesce(jsonb_agg(jsonb_build_array(s.warehouse_id,s.item_id,s.qty,{'s.average_cost' if rata else 'null::numeric'}) order by s.warehouse_id,s.id),'[]'::jsonb) from public.stock s
         where s.warehouse_id in (select w.id from public.warehouses w where w.branch_id = any({C}) and w.type::text in ('VET','RETAIL','ONLINE'))) as b,
      (select coalesce(jsonb_agg(jsonb_build_array(l.warehouse_id,l.item_id,l.qty_left,l.unit_cost) order by l.warehouse_id,l.id),'[]'::jsonb) from public.stock_layers l
         where l.warehouse_id in (select w.id from public.warehouses w where w.branch_id = any({C}) and w.type::text in ('VET','RETAIL','ONLINE')) and l.qty_left > 0) as c,
      (select coalesce(jsonb_agg(jsonb_build_array(m.warehouse_id,m.tanggal,m.qty,m.unit_cost,m.valuation_adjustment) order by m.warehouse_id,m.id),'[]'::jsonb) from public.stock_moves m
         where m.warehouse_id in (select w.id from public.warehouses w where w.branch_id = any({C}) and w.type::text in ('VET','RETAIL','ONLINE')) and m.tanggal > '{sampai}') as d) z)"""


# ---------------------------------------------------------------------------------------------------------- data acak
def sisip(pg, tabel, kolom, baris, batch=400):
    for i in range(0, len(baris), batch):
        potong = baris[i:i + batch]
        pg.sql(f"set session_replication_role = replica; insert into public.{tabel}({','.join(kolom)}) values " + ",".join("(" + ",".join(q(v) if not (isinstance(v, str) and v.startswith("@")) else v[1:] for v in b) + ")" for b in potong) + ";")


def waktu(rng, awal="2026-01-01", akhir="2026-04-30"):
    import datetime
    a = datetime.date.fromisoformat(awal)
    n = (datetime.date.fromisoformat(akhir) - a).days
    d = a + datetime.timedelta(days=rng.randint(0, n))
    return f"{d.isoformat()}T{rng.randint(0, 23):02d}:{rng.randint(0, 59):02d}:{rng.randint(0, 59):02d}{WIB}"


def tepi(rng):
    """Waktu persis di tepi rentang uji (supaya batas awal/akhir inklusif ikut diuji)."""
    return rng.choice([ts("2026-02-01"), ts("2026-02-07", "23:59:59.999999"), ts("2026-02-28", "23:59:59.999999"), ts("2026-03-31", "23:59:59.999999"),
                       ts("2026-02-14", "23:59:59.999"), ts("2026-02-15", "23:59:59.999999"), ts("2026-03-10", "23:59:59.999999"), ts(JAN), ts("2026-03-01")])


def data(pg, seed, skala=1.0):
    rng = random.Random(seed)
    uid = lambda: str(uuid.UUID(int=rng.getrandbits(128), version=4))
    users = list(PENGGUNA.values())
    pg.sql("insert into auth.users(id) values " + ",".join(f"('{u[0]}')" for u in users) + " on conflict do nothing;")
    pg.sql("insert into public.profiles(id, role, is_active, full_name) values "
           + ",".join(f"('{u[0]}','{u[1]}',{str(u[2]).lower()},'Uji {n}')" for n, u in PENGGUNA.items())
           + " on conflict (id) do update set role=excluded.role, is_active=excluded.is_active;")
    pg.sql(f"""insert into public.branches(id, code, name, type, is_active) values
      ('{CAB_A}','UJI-A','Cabang Uji A','KLINIK',true), ('{CAB_B}','UJI-B','Cabang Uji B','BOTH',true),
      ('{CAB_X}','UJI-X','Cabang Uji X','KLINIK',false), ('{CAB_C}','UJI-C','Cabang Uji C','BOTH',true);""")
    pg.sql("insert into public.user_branches(user_id, branch_id) values " + ",".join(f"('{u[0]}','{b}')" for u in users for b in u[3]) + ";")
    pelanggan = [uid() for _ in range(15)]
    hewan = [uid() for _ in range(15)]
    sisip(pg, "customers", ["id", "name", "phone"], [(c, f"Pelanggan {i}", f"0800{i:04d}") for i, c in enumerate(pelanggan)])
    sisip(pg, "pets", ["id", "customer_id", "name"], [(h, pelanggan[i], f"Hewan {i}") for i, h in enumerate(hewan)])
    # pemicu pengguna (pagar POS/stok/opname) tetap aktif di sesi replica: dimatikan hanya untuk memuat fixture, data fiktif mentah
    for t in ("sales", "sale_items", "sales_returns", "stock", "stock_layers", "stock_moves", "visits", "invoices", "invoice_items", "clinic_refunds", "sales_invoices",
              "sales_invoice_items", "bookings", "follow_ups", "visit_referrals", "inpatient_records", "branch_capacity_periods", "items", "warehouses"):
        pg.sql(f"alter table public.{t} disable trigger user;")
    pg.sql("set session_replication_role = replica;")
    # barang
    items = []
    for i in range(40):
        items.append((uid(), f"UJI-{i}", f"Barang Uji {i}", rng.choice(["Persediaan", "Persediaan", "Jasa", "Jasa", "Non-Persediaan"]), rng.choice([None, "Grooming", "Grooming", "Lab", "Konsultasi"]),
                      rng.random() < 0.85, rng.choice([0, 0, 5, 12, 20.5])))
    sisip(pg, "items", ["id", "code", "name", "item_type", "tindakan_kategori", "is_active", "min_stock"], items)
    item_ids = [i[0] for i in items]
    # stok/lapisan/mutasi hanya boleh untuk barang Persediaan (pemicu tolak_stok_non_persediaan tetap aktif di sesi replica)
    stok_ids = [i[0] for i in items if i[3] == "Persediaan"]
    assert len(stok_ids) >= 12, len(stok_ids)
    # gudang
    gudang = []
    n = 0
    for cab in SEMUA:
        for tipe in ["VET", "RETAIL", "ONLINE", "DC", "TRANSIT"] if cab != CAB_X else ["RETAIL", "VET"]:
            n += 1
            gudang.append((uid(), cab, f"UJI-W{n}", f"Gudang Uji {n}", tipe, rng.random() < 0.9))
    sisip(pg, "warehouses", ["id", "branch_id", "code", "name", "type", "is_active"], gudang)
    stok, lapisan, mutasi = [], [], []
    for (gid, cab, _, _, tipe, _) in gudang:
        for item in rng.sample(stok_ids, rng.randint(6, min(14, len(stok_ids)))):
            stok.append((uid(), gid, item, rng.choice([round(rng.uniform(-3, 60), 3), 0, rng.randint(1, 30)]), tepi(rng) if rng.random() < 0.15 else waktu(rng, "2026-01-01", "2026-06-30"),
                         rng.choice([None, round(rng.uniform(1000, 90000), 2)])))
            if rng.random() < 0.7:
                lapisan.append((uid(), gid, item, 10, rng.choice([0, 0, round(rng.uniform(0.5, 30), 3)]), round(rng.uniform(500, 50000), 2), "seed", waktu(rng)[:10]))
        for _ in range(int(rng.randint(30, 60) * skala)):
            tgl = rng.choice([waktu(rng)[:10], "2026-01-15", "2026-02-15", "2026-03-10", "2026-02-10", "2026-02-01", "2026-02-07"])
            sumber = rng.choice(["sale", "sale", "adjust", "purchase", "return-record-void", "retur-jual", "retur-beli"])
            mutasi.append((uid(), gid, rng.choice(stok_ids), rng.choice([round(rng.uniform(-9, -0.1), 3), round(rng.uniform(0.1, 20), 3), -1, 0]),
                           round(rng.uniform(100, 9000), 2), sumber, f"REF-{rng.randint(1, 30)}", tgl, rng.choice([0, 0, round(rng.uniform(-50, 50), 2)])))
    sisip(pg, "stock", ["id", "warehouse_id", "item_id", "qty", "updated_at", "average_cost"], stok)
    sisip(pg, "stock_layers", ["id", "warehouse_id", "item_id", "qty_in", "qty_left", "unit_cost", "source", "tanggal"], lapisan)
    sisip(pg, "stock_moves", ["id", "warehouse_id", "item_id", "qty", "unit_cost", "source", "source_ref", "tanggal", "valuation_adjustment"], mutasi)
    # struk kasir
    sales, sitems, retur, final = [], [], [], []
    for k in range(int(380 * skala)):
        cab = rng.choice([CAB_A, CAB_A, CAB_B, CAB_B, CAB_X, CAB_C])
        plan = rng.choice([None, None, None, '{"p":1}', "null"])
        fin = None
        if plan == '{"p":1}':
            fin = rng.choice([None, waktu(rng)])
        sid = uid()
        # pemicu pos_sale_protect_header menolak payments_finalized_at saat INSERT: diisi lewat UPDATE sesudahnya (sebagai postgres)
        if fin is not None:
            final.append((sid, fin))
        sales.append((sid, cab, rng.choice(pelanggan + [None, None]), round(rng.uniform(10, 900), 2), rng.choice([0, 0, round(rng.uniform(1, 9), 2)]),
                      rng.choice([None, None, None, "Shopee", "Tokopedia"]), tepi(rng) if rng.random() < 0.2 else waktu(rng),
                      None if plan is None else "@" + q(plan) + "::jsonb", None, waktu(rng) if rng.random() < 0.08 else None))
        for _ in range(rng.randint(0, 4)):
            sitems.append((uid(), sid, f"Baris {k}", rng.choice(item_ids + [None]), rng.choice([1, 2, 3, 0.5, round(rng.uniform(0.1, 5), 3)]),
                           round(rng.uniform(5, 300), 2), rng.choice([None, round(rng.uniform(1, 200), 2)])))
        if rng.random() < 0.18:
            retur.append((uid(), f"UJI-RJ-{k}", sid, round(rng.uniform(5, 100), 2), rng.choice([None, None, waktu(rng)])))
    sisip(pg, "sales", ["id", "branch_id", "customer_id", "total", "merchant_fee_total", "channel", "created_at", "payment_plan", "payments_finalized_at", "voided_at"], sales)
    if final:
        pg.sql("set session_replication_role = replica; update public.sales s set payments_finalized_at = v.t::timestamptz from (values " + ",".join(f"('{a}','{b}')" for a, b in final) + ") v(id, t) where s.id = v.id::uuid;")
    sisip(pg, "sale_items", ["id", "sale_id", "nama", "item_id", "qty", "harga", "hpp"], sitems)
    sisip(pg, "sales_returns", ["id", "no_retur", "sale_id", "total", "voided_at"], retur)
    # kunjungan + invoice klinik
    visits, invoices, iitems, refunds = [], [], [], []
    for k in range(int(260 * skala)):
        cab = rng.choice([CAB_A, CAB_A, CAB_B, CAB_X, CAB_C, None])
        legacy = cab is None
        vid = uid()
        lahir = waktu(rng)
        arsip = rng.random() < 0.1
        visits.append((vid, cab, rng.choice(pelanggan), rng.choice(hewan), rng.choice(["Umum", "Grooming", "grooming kucing", "Bedah", "GROOMING"]), "Selesai", "walk_in",
                       f"LEG-{k}" if legacy else None, f"h{k}" if legacy else None, tepi(rng) if rng.random() < 0.15 else lahir,
                       lahir if arsip else None, PENGGUNA["owner"][0] if arsip else None, "Arsip uji fiktif" if arsip else None, lahir, lahir, lahir, lahir))
        if rng.random() < 0.8:
            iid = uid()
            invoices.append((iid, vid, round(rng.uniform(20, 800), 2), tepi(rng) if rng.random() < 0.2 else waktu(rng), waktu(rng) if rng.random() < 0.08 else None))
            for _ in range(rng.randint(0, 3)):
                iitems.append((uid(), iid, f"Layanan {k}", rng.choice(item_ids + [None]), rng.choice([1, 2, 0.5]), round(rng.uniform(5, 300), 2),
                               rng.choice([None, round(rng.uniform(1, 100), 2)]), rng.choice(["obat", "jasa", "produk"])))
            if rng.random() < 0.15:
                refunds.append((uid(), f"UJI-RF-{k}", iid, vid, rng.choice([cab or CAB_A, CAB_A, CAB_B, CAB_C]), "2026-02-10", round(rng.uniform(5, 60), 2),
                                "Tunai", uid(), "@'{}'::jsonb", uid(), uid(), PENGGUNA["owner"][0]))
    sisip(pg, "visits", ["id", "branch_id", "customer_id", "pet_id", "poli", "status", "source", "legacy_source_key", "legacy_source_hash", "created_at", "archived_at", "archived_by", "archive_reason",
                         "checked_in_at", "service_started_at", "service_finished_at", "checked_out_at"], visits)
    sisip(pg, "invoices", ["id", "visit_id", "total", "created_at", "voided_at"], invoices)
    sisip(pg, "invoice_items", ["id", "invoice_id", "deskripsi", "item_id", "qty", "harga", "hpp", "jenis"], iitems)
    sisip(pg, "clinic_refunds", ["id", "no_refund", "invoice_id", "visit_id", "branch_id", "tanggal", "total", "method", "cash_account_id", "account_snapshot", "expense_id", "request_id", "created_by"], refunds)
    # faktur reseller
    fak, fitems = [], []
    for k in range(int(60 * skala)):
        fid = uid()
        tgl_f = rng.choice(["2026-02-01", "2026-02-07", "2026-02-28", "2026-03-31", "2026-03-01", JAN, waktu(rng)[:10], waktu(rng)[:10]])
        fak.append((fid, f"UJI-F-{k}", rng.choice([CAB_A, CAB_B, CAB_X, CAB_C]), rng.choice(pelanggan), round(rng.uniform(100, 5000), 2), tgl_f, tgl_f,
                    rng.choice(["berjalan", "berjalan", "lunas", "batal"]), rng.choice([None, None, None, uid()])))
        for _ in range(rng.randint(0, 3)):
            fitems.append((uid(), fid, f"Item faktur {k}", rng.choice(item_ids + [None]), rng.choice([1, 2, 10]), round(rng.uniform(100, 900), 2)))
    sisip(pg, "sales_invoices", ["id", "no_faktur", "branch_id", "customer_id", "dpp", "tanggal", "jatuh_tempo", "status", "opening_batch_id"], fak)
    sisip(pg, "sales_invoice_items", ["id", "invoice_id", "nama", "item_id", "qty", "harga"], fitems)
    # klinik
    vids = [v[0] for v in visits]
    vcab = {v[0]: v[1] for v in visits}
    bk, fu, rf, ip, kap = [], [], [], [], []
    for k in range(int(90 * skala)):
        cab = rng.choice([CAB_A, CAB_B, CAB_C, CAB_X])
        bk.append((uid(), cab, rng.choice(["2026-01-01", "2026-02-01", "2026-02-14", waktu(rng)[:10]]), "10:00", "Pemilik", "0800", "Hewan", rng.choice(["hadir", "no_show", "pending", "pending"]), rng.choice(["baru", "dikonfirmasi", "ditolak", "batal"])))
        fu.append((uid(), rng.choice(hewan), waktu(rng)[:10], rng.choice([CAB_A, CAB_B, CAB_C, None]), rng.choice(vids), rng.choice(["Menunggu", "Terkirim", "Selesai", "Batal"]), rng.choice([None, waktu(rng)])))
        v = rng.choice(vids)
        rf.append((uid(), v, rng.choice([CAB_A, CAB_B, CAB_C, CAB_X]), rng.choice(["masuk", "keluar"]), "Fasilitas", "Alasan", PENGGUNA["owner"][0], tepi(rng) if rng.random() < 0.2 else waktu(rng)))
        ip.append((uid(), rng.choice([CAB_A, CAB_B, CAB_C]), rng.choice(vids), tepi(rng) if rng.random() < 0.2 else waktu(rng), rng.choice([None, waktu(rng)])))
    for cab in SEMUA:
        for tgl_b in ("2026-01-01", "2026-02-01", "2026-02-14"):      # booking tepat di batas awal/akhir filter klinik
            bk.append((uid(), cab, tgl_b, "10:00", "Pemilik", "0800", "Hewan", "hadir", "baru"))
    for cab in SEMUA:
        kap.append((uid(), cab, 5, "2026-01-01", "2026-02-13"))
        kap.append((uid(), cab, 6, "2026-02-14", "2026-02-14"))      # valid_from tepat di tanggal akhir filter klinik
        kap.append((uid(), cab, 8, "2026-02-15", None))
        # rawat inap tepat di batas akhir (inklusif/eksklusif) dua filter klinik; kunjungan induk milik cabang yang sama
        for batas in (ts("2026-02-14", "23:59:59.999"), ts(DES, "23:59:59.999")):
            induk = [v[0] for v in visits if v[1] == cab][:1]
            if induk:
                ip.append((uid(), cab, induk[0], batas, None))
    sisip(pg, "bookings", ["id", "branch_id", "tanggal", "jam", "nama_pemilik", "phone", "nama_hewan", "attendance_outcome", "status"], bk)
    sisip(pg, "follow_ups", ["id", "pet_id", "tanggal", "branch_id", "visit_id", "status", "completed_at"], fu)
    sisip(pg, "visit_referrals", ["id", "visit_id", "branch_id", "direction", "facility", "reason", "created_by", "referred_at"], rf)
    sisip(pg, "inpatient_records", ["id", "branch_id", "visit_id", "admitted_at", "discharged_at"], ip)
    sisip(pg, "branch_capacity_periods", ["id", "branch_id", "capacity", "valid_from", "valid_until"], kap)
    pg.sql("set session_replication_role = origin;")
    return {"sales": len(sales), "sale_items": len(sitems), "invoices": len(invoices), "visits": len(visits), "stock": len(stok), "moves": len(mutasi)}


def sesi(u, header):
    s = "begin; set local role authenticated;\n"
    if u is not None:
        s += f"select set_config('request.jwt.claim.sub', '{u}', true);\n"
    if header is not None:
        s += f"select set_config('request.headers', {q(header)}, true);\n"
    return s


_cache = {}


def jalankan(pg, u, header, bagian, mode, filters=None, rentang=None):
    """Satu sesi psql untuk semua filter sebuah bagian. mode: 'ref' (tabel langsung, RLS) atau 'rpc'."""
    filters = FILTER[bagian] if filters is None else filters
    kunci = (u, header, bagian, mode)
    if mode == "ref" and kunci in _cache:
        return _cache[kunci]
    if bagian in ("stok", "nilai_stok"):
        # Aplikasi hanya mengirim cabang yang sudah lolos pemeriksaan akses (scope). RLS membuka gudang bersama DC/TRANSIT cabang lain
        # untuk semua pengguna, fungsi tidak: untuk cabang yang tidak boleh diakses fungsi lebih ketat. Maka cabang yang dikirim = irisan dengan cabang boleh.
        boleh = set(json.loads(pg.last(sesi(u, header) + "select coalesce(jsonb_agg(id), '[]'::jsonb)::text from public.branches where public.user_can_access_branch(id);\ncommit;")))
        filters = [tuple(list(f[:4]) + [[c for c in f[4] if c in boleh]] + list(f[5:])) for f in filters]
    sql = sesi(u, header)
    for i, f in enumerate(filters):
        ekspr = referensi(bagian, f) if mode == "ref" else panggil(bagian, f)
        sql += f"select 'K{i}|' || ({ekspr})::text;\n"
    sql += "commit;"
    keluar = pg.sql(sql)
    hasil = {}
    for baris in keluar.splitlines():
        if baris.startswith("K"):
            kode, _, isi = baris.partition("|")
            hasil[int(kode[1:])] = json.loads(isi)
    assert len(hasil) == len(filters), (bagian, mode, keluar[:300])
    if mode == "ref":
        _cache[kunci] = hasil
    return hasil


def matriks(pg, uids, bagian_list, berhenti_pertama=False):
    total, berisi, beda_isi, beda = 0, 0, set(), []
    for bagian in bagian_list:
        for u, header in itertools.product(uids, HEADER):
            ref, rpc = jalankan(pg, u, header, bagian, "ref"), jalankan(pg, u, header, bagian, "rpc")
            for i in range(len(FILTER[bagian])):
                total += 1
                isi = json.dumps(rpc[i], sort_keys=True)
                berisi += any(isinstance(v, list) and v for v in rpc[i].values())
                beda_isi.add(isi[:4000])
                if ref[i] != rpc[i]:
                    beda.append((bagian, u, header, i))
                    if berhenti_pertama:
                        return total, berisi, beda_isi, beda
    return total, berisi, beda_isi, beda


def galat(pg, sql):
    try:
        pg.sql(sql)
    except RuntimeError as error:
        return str(error)
    return None


# ---------------------------------------------------------------------------------------------------------- mutan
# (nama, bagian terdampak, [(jangkar, ganti)])  — tiap jangkar harus muncul tepat satu kali kecuali ditandai banyak
MUTAN = [
    ("cabang: tanpa pagar user_can_access_branch", ["dokumen", "stok", "klinik"], [("  from public.branches b\n  where public.user_can_access_branch(b.id);", "  from public.branches b;")]),
    ("cabang: p_cabang diabaikan", ["dokumen", "grooming"], [("  where x = any (coalesce(p_cabang, '{}'::uuid[]));", "  where true;")]),
    ("dokumen: struk tanpa pagar cabang", ["dokumen"], [("        where x.branch_id = any (v_boleh)\n          and x.created_at >= p_mulai", "        where true\n          and x.created_at >= p_mulai")]),
    ("dokumen: struk batas awal eksklusif", ["dokumen"], [("          and x.created_at >= p_mulai and x.created_at <= p_akhir\n          and case when v_kanal = 'pos'", "          and x.created_at > p_mulai and x.created_at <= p_akhir\n          and case when v_kanal = 'pos'")]),
    ("dokumen: struk batas akhir eksklusif", ["dokumen"], [("          and x.created_at >= p_mulai and x.created_at <= p_akhir\n          and case when v_kanal = 'pos'", "          and x.created_at >= p_mulai and x.created_at < p_akhir\n          and case when v_kanal = 'pos'")]),
    ("dokumen: kanal pos terbalik", ["dokumen"], [("when v_kanal = 'pos' then x.channel is null", "when v_kanal = 'pos' then x.channel is not null")]),
    ("dokumen: kanal online terbalik", ["dokumen"], [("when v_kanal = 'online' then x.channel is not null", "when v_kanal = 'online' then x.channel is null")]),
    ("dokumen: item struk urut id (bukan urutan fisik)", ["dokumen"], [("              ) order by si.ctid)", "              ) order by si.id)")]),
    ("dokumen: retur batal ikut", ["dokumen"], [("         where r.voided_at is null\n           and r.sale_id in", "         where true\n           and r.sale_id in")]),
    ("dokumen: retur semua struk (bukan hanya yang selesai)", ["dokumen"], [("           and r.sale_id in (select s2.id from s s2\n                             where s2.voided_at is null\n                               and (s2.payment_plan is null or jsonb_typeof(s2.payment_plan) = 'null' or s2.payments_finalized_at is not null)))", "           and r.sale_id in (select s2.id from s s2))")]),
    ("dokumen: rencana bayar jsonb null dianggap belum selesai", ["dokumen"], [(" or jsonb_typeof(s2.payment_plan) = 'null' or s2.payments_finalized_at is not null)))", " or s2.payments_finalized_at is not null)))")]),
    ("dokumen: invoice batal ikut", ["dokumen"], [("          and i.voided_at is null\n          and i.created_at >= p_mulai", "          and i.created_at >= p_mulai")]),
    ("dokumen: invoice tanpa pagar cabang", ["dokumen"], [("        where v.branch_id = any (v_boleh)\n          and i.voided_at is null", "        where true\n          and i.voided_at is null")]),
    ("dokumen: refund tanpa cek cabang refund", ["dokumen"], [("           and (r.branch_id = any (v_semua) or (r.branch_id is null and v_null_ok)))", "           and true)")]),
    ("dokumen: faktur reseller batal ikut", ["dokumen"], [("          and q.status <> 'batal'\n", "")]),
    ("dokumen: faktur saldo awal ikut", ["dokumen"], [("          and q.opening_batch_id is null\n", "")]),
    ("dokumen: faktur batas awal eksklusif", ["dokumen"], [("and q.tanggal >= p_dari and q.tanggal <= p_sampai;", "and q.tanggal > p_dari and q.tanggal <= p_sampai;")]),
    ("dokumen: reseller selalu dibaca", ["dokumen"], [("    if v_kanal in ('all', 'reseller') then", "    if true then")]),
    ("dokumen: klinik selalu dibaca", ["dokumen"], [("    if v_kanal not in ('pos', 'online', 'reseller') then", "    if true then")]),
    ("dokumen: struk selalu dibaca", ["dokumen"], [("    if v_kanal not in ('klinik', 'reseller') then", "    if true then")]),
    ("grooming: kunjungan diarsipkan ikut", ["grooming"], [("    where v.archived_at is null and v.poli ilike '%grooming%'", "    where v.poli ilike '%grooming%'")]),
    ("grooming: poli peka huruf besar", ["grooming"], [("v.poli ilike '%grooming%'\n      and v.branch_id", "v.poli like '%grooming%'\n      and v.branch_id")]),
    ("grooming: struk batal ikut", ["grooming"], [("      and s.voided_at is null\n      and s.branch_id = any (v_boleh)\n      and s.created_at >= p_mulai and s.created_at <= p_akhir;", "      and s.branch_id = any (v_boleh)\n      and s.created_at >= p_mulai and s.created_at <= p_akhir;")]),
    ("grooming: semua kategori tindakan", ["grooming"], [("it.tindakan_kategori = 'Grooming'", "it.tindakan_kategori is not null")]),
    ("pelanggan: batas akhir eksklusif", ["pelanggan"], [("      and s.created_at <= p_akhir\n      and s.customer_id is not null", "      and s.created_at < p_akhir\n      and s.customer_id is not null")]),
    ("pelanggan: struk tanpa pelanggan ikut", ["pelanggan"], [("      and s.customer_id is not null\n", "")]),
    ("pelanggan: struk batal ikut", ["pelanggan"], [("      and s.customer_id is not null\n      and s.voided_at is null\n", "      and s.customer_id is not null\n")]),
    ("pelanggan: rencana bayar belum final ikut", ["pelanggan"], [("      and (s.payment_plan is null or jsonb_typeof(s.payment_plan) = 'null' or s.payments_finalized_at is not null);\n    return jsonb_build_object('n', jsonb_array_length(v_a), 'rows', v_a);", "      and true;\n    return jsonb_build_object('n', jsonb_array_length(v_a), 'rows', v_a);")]),
    ("stok: gudang nonaktif ikut", ["stok"], [("select g.id from public.warehouses g where g.branch_id = any (v_boleh) and g.is_active\n    ), st as", "select g.id from public.warehouses g where g.branch_id = any (v_boleh)\n    ), st as")]),
    ("stok: tanpa batas updated_at", ["stok"], [("where s.warehouse_id in (select w.id from w) and s.updated_at <= p_akhir", "where s.warehouse_id in (select w.id from w)")]),
    ("stok: mutasi masuk ikut", ["stok"], [("         and m.tanggal >= p_dari and m.tanggal <= p_sampai\n         and m.qty < 0),", "         and m.tanggal >= p_dari and m.tanggal <= p_sampai),")]),
    ("stok: mutasi dari tabel mentah (retur batal ikut)", ["stok"], [("       from public.return_record_effective_stock_moves m\n       where m.warehouse_id in (select w.id from w)", "       from public.stock_moves m\n       where m.warehouse_id in (select w.id from w)")]),
    ("stok: batas awal mutasi eksklusif", ["stok"], [("and m.tanggal >= p_dari and m.tanggal <= p_sampai\n         and m.qty < 0", "and m.tanggal > p_dari and m.tanggal <= p_sampai\n         and m.qty < 0")]),
    ("stok: barang nonaktif ikut", ["stok"], [("       where it.is_active and it.id in (select st2.item_id from st st2))", "       where it.id in (select st2.item_id from st st2))")]),
    ("klinik: kunjungan diarsipkan ikut", ["klinik"], [("       where x.branch_id = any (v_boleh) and x.archived_at is null\n         and x.created_at >= p_mulai", "       where x.branch_id = any (v_boleh)\n         and x.created_at >= p_mulai")]),
    ("klinik: tindak lanjut batas eksklusif", ["klinik"], [("where x.branch_id = any (v_boleh) and x.tanggal <= p_sampai),", "where x.branch_id = any (v_boleh) and x.tanggal < p_sampai),")]),
    ("klinik: rujukan tanpa cek kunjungan induk", ["klinik"], [("         and x.referred_at >= p_mulai and x.referred_at <= p_akhir\n         and exists (select 1 from public.visits pv\n                     where pv.id = x.visit_id\n                       and (pv.branch_id = any (v_semua)\n                            or (pv.branch_id is null and (v_null_ok or (pv.legacy_source_key is not null and v_legacy_ok and v_dok_ok)))))),", "         and x.referred_at >= p_mulai and x.referred_at <= p_akhir),")]),
    ("klinik: rawat inap tanpa cek kunjungan induk", ["klinik"], [("         and x.admitted_at < p_akhir\n         and exists (select 1 from public.visits pv\n                     where pv.id = x.visit_id\n                       and (pv.branch_id = any (v_semua)\n                            or (pv.branch_id is null and (v_null_ok or (pv.legacy_source_key is not null and v_legacy_ok and v_dok_ok)))))),", "         and x.admitted_at < p_akhir),")]),
    ("klinik: rawat inap batas akhir ikut", ["klinik"], [("         and x.admitted_at < p_akhir\n", "         and x.admitted_at <= p_akhir\n")]),
    ("klinik: kapasitas batas eksklusif", ["klinik"], [("where x.branch_id = any (v_boleh) and x.valid_from <= p_sampai)", "where x.branch_id = any (v_boleh) and x.valid_from < p_sampai)")]),
    ("klinik: booking batas awal eksklusif", ["klinik"], [("where x.branch_id = any (v_boleh) and x.tanggal >= p_dari and x.tanggal <= p_sampai),", "where x.branch_id = any (v_boleh) and x.tanggal > p_dari and x.tanggal <= p_sampai),")]),
    ("klinik: kunjungan induk cabang non-aksesibel ikut", ["klinik"], [("                       and (pv.branch_id = any (v_semua)\n                            or (pv.branch_id is null and (v_null_ok or (pv.legacy_source_key is not null and v_legacy_ok and v_dok_ok)))))),\n      (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'branch_id', x.branch_id, 'admitted_at'", "                       and true)),\n      (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'branch_id', x.branch_id, 'admitted_at'")]),
    ("nilai_stok: gudang DC ikut", ["nilai_stok"], [("w.type::text in ('VET', 'RETAIL', 'ONLINE')", "w.type::text in ('VET', 'RETAIL', 'ONLINE', 'DC')")]),
    ("nilai_stok: lapisan kosong ikut", ["nilai_stok"], [("where l.warehouse_id in (select wd.id from wd) and l.qty_left > 0)", "where l.warehouse_id in (select wd.id from wd))")]),
    ("nilai_stok: mutasi batas eksklusif terbalik (>=)", ["nilai_stok"], [("m.tanggal > p_sampai)", "m.tanggal >= p_sampai)")]),
    ("nilai_stok: biaya rata-rata selalu kosong", ["nilai_stok"], [("case when p_rata_rata then s.average_cost else null end", "null")]),
    ("nilai_stok: biaya rata-rata selalu terisi", ["nilai_stok"], [("case when p_rata_rata then s.average_cost else null end", "s.average_cost")]),
    ("nilai_stok: gudang nonaktif disaring", ["nilai_stok"], [("      from public.warehouses g\n      where g.branch_id = any (v_boleh)\n    ), wd as", "      from public.warehouses g\n      where g.branch_id = any (v_boleh) and g.is_active\n    ), wd as")]),
    ("nilai_stok: mutasi tanpa urutan gudang", ["nilai_stok"], [("m.valuation_adjustment) order by m.warehouse_id, m.id)", "m.valuation_adjustment) order by m.id)")]),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pg-bin", default=os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin"))
    parser.add_argument("--json", default=None)
    parser.add_argument("--seed", type=int, default=20261125)
    parser.add_argument("--lewati-mutan", action="store_true")
    args = parser.parse_args()
    laporan = {}
    asli = MIGRASI.read_text()
    with NativePostgres(args.pg_bin) as pg:
        # A. skema penuh
        semua = sorted(MIGRATIONS.glob("*.sql"))
        assert MIGRASI in semua
        build_chain(pg, {MIGRASI.name})
        # hak bawaan Supabase: objek baru otomatis dapat hak untuk anon/authenticated/service_role (tanpa ini mutan ACL hidup palsu)
        pg.sql(PRELUDE)
        pg.sql("begin;\n" + asli + "\ncommit;")
        pg.sql("begin;\n" + asli + "\ncommit;")
        print(f"PASS A: {len(semua)} migrasi repo berjalan dari nol; migrasi ini idempoten (dua kali)", flush=True)

        fx = data(pg, args.seed)
        assert fx["sales"] > 300 and fx["stock"] > 100, fx
        pg.sql("analyze;")

        # B. kesetaraan hak baca + isi
        uids = [u[0] for n, u in PENGGUNA.items() if n != "admin_online"] + [TANPA_PROFIL]
        bagian_semua = list(FILTER)
        total, berisi, beda_isi, beda = matriks(pg, uids, bagian_semua)
        assert not beda, f"BEDA dengan RLS pada {len(beda)} kombinasi, mis. {beda[:3]}"
        assert total > 600 and berisi > 100 and len(beda_isi) > 60, (total, berisi, len(beda_isi))
        # fixture benar-benar memuat unsur yang dibaca (supaya kesamaan bukan kesamaan kosong)
        o = PENGGUNA["owner"][0]
        besar = jalankan(pg, o, None, "dokumen", "rpc", [F_DOKUMEN[0]])[0]
        assert besar["sales"] and besar["returns"] and besar["invoices"] and besar["refunds"] and besar["reseller"], {k: len(v) for k, v in besar.items() if isinstance(v, list)}
        assert any(not s["sale_items"] for s in besar["sales"]) and any(s["sale_items"] for s in besar["sales"]), "fixture tanpa variasi item"
        assert any(s["payment_plan"] is None for s in besar["sales"]) and any(s["voided_at"] for s in besar["sales"]), "fixture tanpa variasi struk"
        assert all(i["visits"]["branch_id"] is not None for i in besar["invoices"]), "kunjungan tanpa cabang tidak boleh ikut (pembaca lama memakai in(branch_id))"
        gro = jalankan(pg, o, None, "grooming", "rpc", [F_GROOMING[0]])[0]
        assert gro["visits"] and gro["kasir"], "fixture grooming kosong"
        kl = jalankan(pg, o, None, "klinik", "rpc", [F_KLINIK[0]])[0]
        assert all(kl[k] for k in ("bookings", "visits", "follow_ups", "referrals", "admissions", "capacities")), {k: len(v) for k, v in kl.items() if isinstance(v, list)}
        nv = jalankan(pg, o, None, "nilai_stok", "rpc", [F_NILAI[1]])[0]
        assert nv["gudang"] and nv["stok"] and nv["lapisan"] and nv["mutasi"] and any(r[3] is not None for r in nv["stok"]), "fixture nilai stok kosong"
        stk = jalankan(pg, o, None, "stok", "rpc", [F_STOK[0]])[0]
        assert stk["stok"] and stk["mutasi"] and stk["barang"], "fixture stok kosong"
        print(f"PASS B: {total} kombinasi (pengguna x header cabang x filter x bagian) identik dengan tabel langsung lewat RLS; "
              f"{len(beda_isi)} hasil berbeda, {total - berisi} kosong; fixture {fx}", flush=True)
        laporan["B"] = {"kombinasi": total, "hasil_berbeda": len(beda_isi), "kosong": total - berisi, **fx}

        # data acak seed lain: ulangi pada pengguna inti (bukti bukan kebetulan satu data)
        tambahan = 0
        for seed in (args.seed + 1, args.seed + 2):
            pg.sql("set session_replication_role = replica; truncate public.stock, public.stock_layers, public.stock_moves, public.sale_items, public.sales_returns, public.sales, "
                   "public.invoice_items, public.clinic_refunds, public.invoices, public.sales_invoice_items, public.sales_invoices, public.bookings, public.follow_ups, "
                   "public.visit_referrals, public.inpatient_records, public.branch_capacity_periods, public.visits, public.warehouses, public.items, public.pets, public.customers cascade;"
                   " delete from public.user_branches; delete from public.profiles; delete from public.branches; set session_replication_role = origin;")
            _cache.clear()
            data(pg, seed, 0.6)
            t2, _, _, beda2 = matriks(pg, [PENGGUNA[n][0] for n in ("owner", "staff_a", "staff_ax", "dokter_kosong")], bagian_semua)
            assert not beda2, f"seed {seed}: BEDA {beda2[:3]}"
            tambahan += t2
        print(f"PASS B2: 2 data acak lain (seed {args.seed + 1}, {args.seed + 2}): {tambahan} kombinasi tambahan identik", flush=True)
        laporan["B2"] = {"kombinasi": tambahan}
        # kembali ke data utama untuk babak berikutnya
        pg.sql("set session_replication_role = replica; truncate public.stock, public.stock_layers, public.stock_moves, public.sale_items, public.sales_returns, public.sales, "
               "public.invoice_items, public.clinic_refunds, public.invoices, public.sales_invoice_items, public.sales_invoices, public.bookings, public.follow_ups, "
               "public.visit_referrals, public.inpatient_records, public.branch_capacity_periods, public.visits, public.warehouses, public.items, public.pets, public.customers cascade;"
               " delete from public.user_branches; delete from public.profiles; delete from public.branches; set session_replication_role = origin;")
        _cache.clear()
        data(pg, args.seed)
        pg.sql("analyze;")

        # C. pagar
        for bagian in FILTER:
            f = FILTER[bagian][0]
            s_anon = galat(pg, f"begin; set local role anon; select {panggil(bagian, f)}; commit;")
            assert s_anon and "permission denied" in s_anon, (bagian, str(s_anon)[:200])
            s_ao = galat(pg, sesi(PENGGUNA["admin_online"][0], None) + f"select {panggil(bagian, f)};\ncommit;")
            assert s_ao and "ADMIN_ONLINE_FUNCTION_DENIED" in s_ao, (bagian, str(s_ao)[:200])
        s_x = galat(pg, sesi(o, None) + "select public.laporan_operasional_penjualan('tidak-ada', now(), now(), current_date, current_date, '{}'::uuid[]);\ncommit;")
        assert s_x and "LAPORAN_OPERASIONAL_BAGIAN" in s_x, str(s_x)[:200]
        s_n = galat(pg, sesi(o, None) + "select public.laporan_operasional_penjualan('dokumen', null, now(), current_date, current_date, '{}'::uuid[]);\ncommit;")
        assert s_n and "LAPORAN_OPERASIONAL_PERIODE" in s_n, str(s_n)[:200]
        s_b = galat(pg, sesi(o, None) + "select public.laporan_operasional_penjualan(null, now(), now(), current_date, current_date, '{}'::uuid[]);\ncommit;")
        assert s_b and "LAPORAN_OPERASIONAL_BAGIAN" in s_b, str(s_b)[:200]
        attr = pg.last(f"select prosecdef::text||'|'||provolatile::text||'|'||array_to_string(proconfig,',') from pg_proc where oid='{FUNGSI}'::regprocedure;")
        assert attr == 'true|s|search_path=""', attr
        acl = pg.last(f"select coalesce(proacl::text,'') from pg_proc where oid='{FUNGSI}'::regprocedure;")
        assert "authenticated=X" in acl and "anon" not in acl and not acl.startswith("=") and ",=X" not in acl, acl
        assert pg.last("select count(*) from pg_proc where proname = 'laporan_operasional_penjualan' and pronamespace = 'public'::regnamespace;") == "1"
        for bagian in FILTER:
            hasil = pg.sql(sesi(o, None) + f"set transaction read only;\nselect length(({panggil(bagian, FILTER[bagian][0])})::text);\ncommit;")
            assert int(hasil.splitlines()[-1]) > 20
        # tidak menulis apa pun
        sebelum = pg.last("select count(*) from (select 1 from public.sales union all select 1 from public.stock union all select 1 from public.visits) x;")
        for bagian in FILTER:
            pg.sql(sesi(o, None) + f"select {panggil(bagian, FILTER[bagian][0])};\ncommit;")
        assert pg.last("select count(*) from (select 1 from public.sales union all select 1 from public.stock union all select 1 from public.visits) x;") == sebelum
        print("PASS C: anon dan Admin Online ditolak di keenam bagian; bagian tak dikenal/null dan periode kosong ditolak; SECURITY DEFINER, STABLE, search_path kosong; "
              "EXECUTE hanya authenticated (anon dan PUBLIC tanpa hak; service_role/postgres bawaan Supabase); jalan di transaksi read-only; satu fungsi saja; tidak menulis", flush=True)
        laporan["C"] = {"bagian": len(FILTER)}

        # D. mutan
        if not args.lewati_mutan:
            hidup = []
            hitung = 0
            for nama, bagian_list, ganti in MUTAN:
                kode = asli
                for a, b in ganti:
                    assert asli.count(a) == 1, f"jangkar mutan '{nama}' tidak tepat satu kali: {asli.count(a)}"
                    kode = kode.replace(a, b)
                assert kode != asli, nama
                pg.sql("begin;\n" + kode + "\ncommit;")
                _, _, _, beda_m = matriks(pg, uids, bagian_list, berhenti_pertama=True)
                hitung += 1
                if not beda_m:
                    hidup.append(nama)
            # penjaga Admin Online dibuang: Admin Online harus lolos baca (bukti mutan terdeteksi oleh babak C)
            a = "  perform admin_online_private.deny_admin_online();\n"
            assert asli.count(a) == 1
            pg.sql("begin;\n" + asli.replace(a, "  null;\n") + "\ncommit;")
            hitung += 1
            if galat(pg, sesi(PENGGUNA["admin_online"][0], None) + f"select {panggil('dokumen', F_DOKUMEN[0])};\ncommit;"):
                hidup.append("tanpa pagar Admin Online (mutan masih menolak)")
            # hak: EXECUTE untuk anon ikut diberikan -> pemeriksaan ACL babak C harus gagal
            pg.sql("begin;\n" + asli + "\ngrant execute on function " + FUNGSI + " to anon;\ncommit;")
            hitung += 1
            acl_m = pg.last(f"select coalesce(proacl::text,'') from pg_proc where oid='{FUNGSI}'::regprocedure;")
            if "anon" not in acl_m:
                hidup.append("hak anon diberikan (ACL tidak berubah)")
            # SECURITY INVOKER: babak C (atribut) harus gagal
            pg.sql("begin;\n" + asli.replace("security definer\nset search_path = ''", "security invoker\nset search_path = ''") + "\ncommit;")
            hitung += 1
            attr_m = pg.last(f"select prosecdef::text||'|'||provolatile::text||'|'||array_to_string(proconfig,',') from pg_proc where oid='{FUNGSI}'::regprocedure;")
            if attr_m == 'true|s|search_path=""':
                hidup.append("SECURITY INVOKER (atribut tidak berubah)")
            # VOLATILE
            pg.sql("begin;\n" + asli.replace("language plpgsql\nstable\nsecurity definer", "language plpgsql\nvolatile\nsecurity definer") + "\ncommit;")
            hitung += 1
            attr_m = pg.last(f"select prosecdef::text||'|'||provolatile::text||'|'||array_to_string(proconfig,',') from pg_proc where oid='{FUNGSI}'::regprocedure;")
            if attr_m == 'true|s|search_path=""':
                hidup.append("VOLATILE (atribut tidak berubah)")
            pg.sql("begin;\n" + asli + "\ncommit;")  # pulihkan
            assert not hidup, f"mutan lolos: {hidup}"
            _, _, _, beda_pulih = matriks(pg, uids[:3], bagian_semua)
            assert not beda_pulih
            acl_p = pg.last(f"select coalesce(proacl::text,'') from pg_proc where oid='{FUNGSI}'::regprocedure;")
            assert "anon" not in acl_p, acl_p
            print(f"PASS D: {hitung} mutan semuanya ketahuan (matriks B/pagar); fungsi asli dipulihkan dan hijau lagi", flush=True)
            laporan["D"] = {"mutan": hitung, "hidup": 0}

        # E. kecepatan sebagai staff cabang A (RLS per baris benar-benar bekerja)
        pg.sql("set session_replication_role = replica;")
        staff = PENGGUNA["staff_a"][0]
        rng = random.Random(7)
        uid2 = lambda: str(uuid.UUID(int=rng.getrandbits(128), version=4))
        besar = []
        for k in range(30000):
            besar.append((uid2(), CAB_A, None, 100 + k % 50, 0, None, ts("2026-02-01", "10:00:00"), None, None, None))
        sisip(pg, "sales", ["id", "branch_id", "customer_id", "total", "merchant_fee_total", "channel", "created_at", "payment_plan", "payments_finalized_at", "voided_at"], besar, batch=2000)
        pg.sql("set session_replication_role = origin; analyze public.sales;")
        W = f"x.branch_id = any({arr([CAB_A])}) and x.created_at >= '{ts(JAN)}' and x.created_at <= '{ts(DES, '23:59:59.999999')}'"

        def ukur(sql):
            mulai = time.perf_counter()
            pg.sql(sesi(staff, None) + sql + "\ncommit;")
            return time.perf_counter() - mulai
        t_halaman = min(ukur(f"select count(*) from public.sales x where {W}; select x.id, x.total from public.sales x where {W} order by x.id limit 500;") for _ in range(2))
        n_staf = int(pg.last(sesi(staff, None) + f"select count(*) from public.sales x where {W};\ncommit;"))
        halaman = -(-n_staf // 500)
        lama_est = halaman * t_halaman
        f_besar = (ts(JAN), ts(DES, "23:59:59.999999"), JAN, DES, [CAB_A], "all")
        t_rpc = min(ukur(f"select {panggil('pelanggan', f_besar)};") for _ in range(2))
        t_dok = min(ukur(f"select {panggil('dokumen', f_besar)};") for _ in range(2))
        assert t_dok < lama_est, f"tidak lebih cepat: rpc {t_dok:.2f}s vs lama ±{lama_est:.1f}s ({halaman} halaman)"
        print(f"PASS E: {n_staf} struk terlihat staff: bagian dokumen {t_dok:.2f}s dalam 1 query (pelanggan {t_rpc:.2f}s); pembaca lama ±{lama_est:.1f}s "
              f"dalam {halaman} halaman x {t_halaman:.2f}s (hanya kolom struk, belum item/retur)", flush=True)
        laporan["E"] = {"struk": n_staf, "rpc_dokumen_s": round(t_dok, 3), "rpc_pelanggan_s": round(t_rpc, 3), "lama_est_s": round(lama_est, 2), "halaman_lama": halaman}
    if args.json:
        Path(args.json).write_text(json.dumps(laporan, indent=1))
    print("SEMUA PASS", flush=True)


if __name__ == "__main__":
    main()
