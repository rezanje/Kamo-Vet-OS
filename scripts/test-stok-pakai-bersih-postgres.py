#!/usr/bin/env python3
"""Uji migrasi 20261128100000 (laporan_stok_analisis: pemakaian BERSIH) di PostgreSQL 17 sungguhan, data fiktif.

Masalah yang diuji: obat takaran/resep klinik dicatat 'klinik' (keluar) lalu langsung 'pesanan-selesai' (MASUK) pada tagihan,
gudang dan barang yang sama (clinic_private.job_order_complete): bersih nol, pemakaian nyata di 'klinik-bmhp' bahan dasarnya.
Fungsi lama menjumlah pengeluaran saja sehingga barang takaran terhitung terpakai.

Dasar: skema penuh repo (semua migrasi KECUALI migrasi ini; fungsi lama dari 20261117100000 terpasang), data fiktif ditanam,
hasil fungsi LAMA dipotret, lalu migrasi dipasang.
Mode:
  (default)    GREEN  - semua kasus harus lulus (+ regresi fungsi lama = baru untuk barang non-resep, ACL/atribut sama)
  --baseline   RED    - tanpa migrasi (fungsi lama); kasus perilaku-baru harus GAGAL
  --mutants    kloning database per mutan (>= 15); tiap mutan gagal di >= 1 kasus, kontrol 0 gagal
  --json FILE  tulis hasil
Jalankan dengan: flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-stok-pakai-bersih-postgres.py --pg-bin /opt/data/kamo-pg-harness/bin
Tidak pernah terhubung ke Production: klaster lokal sekali pakai, socket unix, dibuang di akhir.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

_spec = importlib.util.spec_from_file_location("hris", ROOT / "scripts/test-hris-cabang-postgres.py")
hris = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hris)

MIGRATIONS = ROOT / "supabase/migrations"
MIGRASI = MIGRATIONS / "20261128100000_stok_pakai_bersih.sql"
HARI = "2026-11-18"
FN = "public.laporan_stok_analisis"

CAB_A = "a0000000-0000-4000-8000-00000000000a"
CAB_B = "b0000000-0000-4000-8000-00000000000b"
WA = "11111111-0000-4000-8000-00000000000a"
WB = "11111111-0000-4000-8000-00000000000b"
U_OWNER = "10000000-0000-4000-8000-000000000001"
U_STAFF = "10000000-0000-4000-8000-000000000005"
KODE = ["JUAL", "RACIK", "RACIKS", "PARSIAL", "BMHP", "MIX", "VOID", "FUTURE", "WH", "OLD95", "REAL1", "REG", "ZERO", "STOKONLY", "INA", "JASA", "TRASH", "LAIN"]
ITEM = {k: f"22222222-0000-4000-8000-0000000000{n:02d}" for n, k in enumerate(KODE, 1)}
# barang yang perilakunya SENGAJA berubah (memakai sumber baru atau pasangan klinik+pesanan-selesai); sisanya harus identik dengan fungsi lama
BERUBAH = {"JUAL", "RACIK", "RACIKS", "PARSIAL", "MIX", "VOID", "OLD95", "REAL1"}


def d(n):
    """tanggal = HARI - n hari (SQL)."""
    return f"(date '{HARI}' - {n})"


MOVES = []  # (hari_mundur, gudang, barang, qty, biaya, sumber, referensi)


def mv(n, w, k, qty, cost, src, ref):
    MOVES.append((n, w, k, qty, cost, src, ref))


# ---- JUAL: kasir biasa, batal (sale-void), retur, batal retur; sumber bukan-pemakaian tidak boleh ikut
mv(2, WA, "JUAL", -10, 1000, "sale", "s1")
mv(1, WA, "JUAL", 10, 1000, "sale-void", "aud-1")         # struk s1 dibatalkan penuh
mv(3, WB, "JUAL", -5, 1100, "sale", "s2")
mv(4, WA, "JUAL", -6, 1000, "sale", "s4")
mv(1, WA, "JUAL", 2, 1000, "retur-jual", "rj1")
mv(1, WA, "JUAL", -2, 1000, "return-record-void", "aud-2")  # retur dibatalkan: keluar lagi
for src, qty in [("purchase", 100), ("transfer", -50), ("transfer-batal", 7), ("kirim-permintaan", -5), ("terima-permintaan", 5),
                 ("produksi", -20), ("opname", -1), ("penyesuaian", 3), ("saldo-awal-accurate", 40), ("stock-correction", -3),
                 ("stock-correct-reverse", -2), ("retur-beli", -5), ("purchase-invoice-void", -2), ("retur-permintaan", -1)]:
    mv(8, WA, "JUAL", qty, 800, src, "x-" + src)
# ---- RACIK: obat takaran murni (tanpa stok): pasangan klinik -/ pesanan-selesai + di tiga tagihan, dua gudang
mv(3, WA, "RACIK", -1, 100, "klinik", "K1"); mv(3, WA, "RACIK", 1, 100, "pesanan-selesai", "K1")
mv(2, WA, "RACIK", -2, 100, "klinik", "K2"); mv(2, WA, "RACIK", 2, 100, "pesanan-selesai", "K2")
mv(4, WB, "RACIK", -1, 100, "klinik", "K3"); mv(4, WB, "RACIK", 1, 100, "pesanan-selesai", "K3")
# ---- RACIKS: bertumpuk + satu pasangan + satu pengeluaran klinik nyata tanpa pasangan (tagihan lain)
mv(3, WA, "RACIKS", -1, 2000, "klinik", "K7"); mv(3, WA, "RACIKS", 1, 2000, "pesanan-selesai", "K7")
mv(5, WA, "RACIKS", -1, 2000, "klinik", "K9")
# ---- PARSIAL: klinik 3, pesanan-selesai 1 pada tagihan sama: sisa 2 terpakai nyata
mv(2, WA, "PARSIAL", -3, 500, "klinik", "K4"); mv(2, WA, "PARSIAL", 1, 500, "pesanan-selesai", "K4")
# ---- BMHP: bahan dasar dihitung lewat klinik-bmhp
mv(3, WA, "BMHP", -2, 300, "klinik-bmhp", "K1"); mv(2, WA, "BMHP", -1, 300, "klinik-bmhp", "K2")
# ---- MIX: satu barang, satu tagihan: pasangan (netral) + klinik-bmhp nyata di hari lain
mv(1, WA, "MIX", -1, 400, "klinik", "K6"); mv(1, WA, "MIX", 1, 400, "pesanan-selesai", "K6"); mv(4, WA, "MIX", -4, 400, "klinik-bmhp", "K6")
# ---- VOID: tagihan klinik dibatalkan (klinik-void mengembalikan stok)
mv(3, WA, "VOID", -3, 250, "klinik", "V1"); mv(3, WA, "VOID", -2, 250, "klinik-bmhp", "V1"); mv(1, WA, "VOID", 5, 250, "klinik-void", "V1")
# ---- FUTURE: pesanan-selesai BESOK tidak boleh membatalkan hari ini
mv(1, WA, "FUTURE", -1, 100, "klinik", "K8"); mv(-1, WA, "FUTURE", 1, 100, "pesanan-selesai", "K8")
# ---- WH: pasangan beda gudang bukan pasangan (kunci = tagihan + gudang + barang)
mv(2, WA, "WH", -1, 100, "klinik", "W1"); mv(2, WB, "WH", 1, 100, "pesanan-selesai", "W1")
# ---- OLD95: pasangan di luar jendela 90 hari
mv(95, WA, "OLD95", -1, 100, "klinik", "O1"); mv(95, WA, "OLD95", 1, 100, "pesanan-selesai", "O1")
# ---- REAL1: klinik nyata di tagihan K1 yang SAMA (gudang sama) dengan pasangan RACIK, barang beda
mv(5, WA, "REAL1", -1, 100, "klinik", "K1")
# ---- REG: tidak menyentuh sumber baru dan tidak ada pasangan: hasil lama harus = hasil baru
for n, q, src, ref in [(2, -5, "sale", "r1"), (1, 2, "sale-void", "aud-r"), (3, 1, "retur-jual", "rj"), (4, 1, "wholesale-return", "wr"),
                       (5, -1, "klinik-bmhp", "kb"), (4, -2, "racik", "rc"), (3, 1, "racik-kembali", "rk"), (6, -3, "sales-delivery", "sd"),
                       (5, -2, "klinik", "K5"), (5, 1, "klinik-edit", "ke"), (7, -1, "sale-group", "sg"), (8, -1, "sale-online", "so"),
                       (9, 50, "purchase", "p"), (9, -50, "transfer", "t"), (7, -20, "produksi", "pr")]:
    mv(n, WA, "REG", q, 1000, src, ref)
mv(2, WA, "LAIN", 10, 100, "purchase", "p2"); mv(2, WA, "LAIN", -4, 100, "transfer", "t2")
mv(2, WA, "JASA", -2, 100, "sale", "j1")
mv(2, WA, "TRASH", -2, 100, "sale", "tr1")
mv(97, WA, "TRASH", -1, 100, "sale", "tr0")  # awal riwayat = hari keluar pertama di SEMUA barang (juga yang tidak ikut daftar), bukan pergerakan masuk pertama

STOK = {  # barang: [(gudang, qty, biaya)]
    "JUAL": [(WA, 40, 1000), (WB, 10, 1000)], "RACIKS": [(WA, 5, 2000)], "PARSIAL": [(WA, 10, 500)], "BMHP": [(WA, 20, 300)],
    "MIX": [(WA, 6, 400)], "VOID": [(WA, 7, 250)], "FUTURE": [(WA, 3, 100)], "WH": [(WA, 5, 100)], "OLD95": [(WA, 2, 100)],
    "REAL1": [(WA, 4, 100)], "REG": [(WA, 30, 1000)], "STOKONLY": [(WA, 8, 100)], "INA": [(WA, 5, 100)], "JASA": [(WA, 5, 100)], "TRASH": [(WA, 5, 100)],
}


def fixture_sql():
    layers = ",\n  ".join(f"('{w}','{ITEM[k]}',{d(20)},{q},{q},{c},'purchase','x')" for k, v in STOK.items() for (w, q, c) in v)
    stocks = ",\n  ".join(f"('{w}','{ITEM[k]}',{q})" for k, v in STOK.items() for (w, q, c) in v)
    moves = ",\n  ".join(f"({d(n)},'{w}','{ITEM[k]}',{q},{c},'{s}','{r}')" for (n, w, k, q, c, s, r) in MOVES)
    return f"""
insert into auth.users(id) values ('{U_OWNER}'), ('{U_STAFF}') on conflict do nothing;
insert into public.profiles(id, role, is_active, full_name) values
  ('{U_OWNER}','OWNER',true,'Uji Owner'), ('{U_STAFF}','STAFF',true,'Uji Staff')
  on conflict (id) do update set role=excluded.role, is_active=excluded.is_active;
insert into public.branches(id, code, name, type, is_active) values
  ('{CAB_A}','UJI-A','Cabang Uji A','KLINIK',true), ('{CAB_B}','UJI-B','Cabang Uji B','BOTH',true);
insert into public.user_branches(user_id, branch_id) values ('{U_STAFF}','{CAB_A}');
begin;
set local session_replication_role = replica;
insert into public.warehouses(id, branch_id, code, name, type, is_active) values
  ('{WA}','{CAB_A}','UJI-WA','Gudang A','RETAIL',true), ('{WB}','{CAB_B}','UJI-WB','Gudang B','RETAIL',true);
insert into public.items(id, code, name, unit, item_type, is_active, min_stock, trashed_at, min_buy, buy_price, sell_price) values
  ('{ITEM['JUAL']}','PB-JUAL','Barang Jual Biasa','PCS','Persediaan',true,0,null,0,0,0),
  ('{ITEM['RACIK']}','PB-RACIK','Suntik Takaran Murni','PCS','Persediaan',true,0,null,0,0,0),
  ('{ITEM['RACIKS']}','PB-RACIKS','Takaran Bertumpuk','PCS','Persediaan',true,0,null,0,0,0),
  ('{ITEM['PARSIAL']}','PB-PARSIAL','Takaran Sebagian','PCS','Persediaan',true,0,null,0,0,0),
  ('{ITEM['BMHP']}','PB-BMHP','Bahan Dasar BMHP','PCS','Persediaan',true,0,null,0,0,0),
  ('{ITEM['MIX']}','PB-MIX','Takaran dan BMHP','PCS','Persediaan',true,0,null,0,0,0),
  ('{ITEM['VOID']}','PB-VOID','Tagihan Klinik Batal','PCS','Persediaan',true,0,null,0,0,0),
  ('{ITEM['FUTURE']}','PB-FUTURE','Pasangan Besok','PCS','Persediaan',true,0,null,0,0,0),
  ('{ITEM['WH']}','PB-WH','Pasangan Beda Gudang','PCS','Persediaan',true,0,null,0,0,0),
  ('{ITEM['OLD95']}','PB-OLD95','Pasangan Lama','PCS','Persediaan',true,0,null,0,0,0),
  ('{ITEM['REAL1']}','PB-REAL1','Klinik Nyata Tagihan Sama','PCS','Persediaan',true,0,null,0,0,0),
  ('{ITEM['REG']}','PB-REG','Regresi Non Resep','PCS','Persediaan',true,0,null,0,0,0),
  ('{ITEM['ZERO']}','PB-ZERO','Tanpa Pemakaian','PCS','Persediaan',true,5,null,0,0,0),
  ('{ITEM['STOKONLY']}','PB-STOKONLY','Hanya Stok','PCS','Persediaan',true,0,null,0,0,0),
  ('{ITEM['INA']}','PB-INA','Nonaktif Bertumpuk','PCS','Persediaan',false,0,null,0,0,0),
  ('{ITEM['JASA']}','PB-JASA','Jasa','PCS','Jasa',true,0,null,0,0,0),
  ('{ITEM['TRASH']}','PB-TRASH','Dibuang','PCS','Persediaan',true,0,now(),0,0,0),
  ('{ITEM['LAIN']}','PB-LAIN','Hanya Sumber Lain','PCS','Persediaan',true,0,null,0,0,0);
insert into public.stock_layers(warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost, source, source_ref) values
  {layers};
insert into public.stock(warehouse_id, item_id, qty) values
  {stocks};
insert into public.stock_moves(tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref) values
  {moves};
commit;
"""


ANCHORS = {  # nama mutan: (teks lama, teks baru) - tiap teks lama harus muncul TEPAT sekali di migrasi
    # --- inti perbaikan: sumber pembalik
    "tanpa_pesanan_selesai": ("    'pesanan-selesai', 'klinik-void', 'return-record-void'\n", "    'klinik-void', 'return-record-void'\n"),
    "tanpa_klinik_void": ("    'pesanan-selesai', 'klinik-void', 'return-record-void'\n", "    'pesanan-selesai', 'return-record-void'\n"),
    "tanpa_return_record_void": ("    'pesanan-selesai', 'klinik-void', 'return-record-void'\n", "    'pesanan-selesai', 'klinik-void'\n"),
    "ikut_stock_correction": ("    'pesanan-selesai', 'klinik-void', 'return-record-void'\n", "    'pesanan-selesai', 'klinik-void', 'return-record-void', 'stock-correction'\n"),
    "ikut_retur_beli": ("    'pesanan-selesai', 'klinik-void', 'return-record-void'\n", "    'pesanan-selesai', 'klinik-void', 'return-record-void', 'retur-beli'\n"),
    "ikut_transfer_batal": ("    'pesanan-selesai', 'klinik-void', 'return-record-void'\n", "    'pesanan-selesai', 'klinik-void', 'return-record-void', 'transfer-batal'\n"),
    # --- terakhir keluar tidak dihitung dari pasangan yang batal
    "psl_tanpa_pesanan_selesai": ("m.source in ('klinik', 'pesanan-selesai') and m.tanggal <= v_hari", "m.source in ('klinik') and m.tanggal <= v_hari"),
    # dua batas hari menjaga hal yang sama (luar: jumlah, dalam: daftar tagihan berpasangan): mutan harus melepas KEDUANYA
    "psl_tanpa_batas_hari": ("m.source in ('klinik', 'pesanan-selesai') and m.tanggal <= v_hari\n       and m.source_ref in (select x.source_ref from public.stock_moves x where x.source = 'pesanan-selesai' and x.tanggal <= v_hari)",
                             "m.source in ('klinik', 'pesanan-selesai')\n       and m.source_ref in (select x.source_ref from public.stock_moves x where x.source = 'pesanan-selesai')"),
    "psl_netral_bila_positif_saja": ("    having sum(m.qty) >= 0", "    having sum(m.qty) > 0"),
    "psl_netral_bila_sebagian": ("    having sum(m.qty) >= 0", "    having sum(m.qty) <= 0"),
    "psl_tanpa_cocok_gudang": ("p.source_ref = m.source_ref and p.warehouse_id = m.warehouse_id and p.item_id = m.item_id", "p.source_ref = m.source_ref and p.item_id = m.item_id"),
    "psl_tanpa_cocok_barang": ("p.source_ref = m.source_ref and p.warehouse_id = m.warehouse_id and p.item_id = m.item_id", "p.source_ref = m.source_ref and p.warehouse_id = m.warehouse_id"),
    "psl_tanpa_cocok_tagihan": ("p.source_ref = m.source_ref and p.warehouse_id = m.warehouse_id and p.item_id = m.item_id", "p.warehouse_id = m.warehouse_id and p.item_id = m.item_id"),
    "pengecualian_semua_sumber": ("and not (m.source = 'klinik' and exists (", "and not (true and exists ("),
    "pengecualian_dibuang": ("         and not (m.source = 'klinik' and exists (\n               select 1 from psl p where p.source_ref = m.source_ref and p.warehouse_id = m.warehouse_id and p.item_id = m.item_id))\n", ""),
    # --- dipertahankan dari fungsi lama
    "sumber_tanpa_sale_void": ("    'sale-void', 'retur-jual',", "    'retur-jual',"),
    "sumber_tanpa_retur_jual": ("    'sale-void', 'retur-jual', 'retur-jual-group', 'retur-klinik',", "    'sale-void', 'retur-jual-group', 'retur-klinik',"),
    "sumber_ikut_purchase": ("    'sale', 'sale-group', 'sale-online', 'sales-delivery',", "    'sale', 'purchase', 'sale-group', 'sale-online', 'sales-delivery',"),
    "sumber_ikut_transfer": ("    'racik', 'racik-koreksi', 'racik-kembali',", "    'racik', 'transfer', 'racik-koreksi', 'racik-kembali',"),
    "sumber_tanpa_klinik_bmhp": ("    'klinik', 'klinik-bmhp', 'klinik-edit',", "    'klinik', 'klinik-edit',"),
    "sumber_tanpa_klinik": ("    'klinik', 'klinik-bmhp', 'klinik-edit',", "    'klinik-bmhp', 'klinik-edit',"),
    "awal_riwayat_pakai_qty_positif": ("where m.source = any (v_sumber) and m.qty < 0 and m.tanggal <= v_hari;", "where m.source = any (v_sumber) and m.qty > 0 and m.tanggal <= v_hari;"),
    "jendela_geser_satu_hari": ("v_batas := v_hari - (p_jendela_hari - 1);", "v_batas := v_hari - p_jendela_hari;"),
    "pemakaian_tanpa_batas_hari_ini": ("where m.source = any (v_sumber) and m.tanggal between v_batas and v_hari", "where m.source = any (v_sumber) and m.tanggal >= v_batas"),
    "filter_gudang_dibuang": ("select w.id from public.warehouses w where p_gudang is null or w.id = p_gudang", "select w.id from public.warehouses w"),
    "modal_tanpa_biaya": ("-sum(m.qty * m.unit_cost) as modal", "-sum(m.qty) as modal"),
    "terakhir_ikut_masuk": ("where m.item_id = i.id and m.qty < 0 and m.source = any (v_sumber) and m.tanggal <= v_hari", "where m.item_id = i.id and m.source = any (v_sumber) and m.tanggal <= v_hari"),
    "tanpa_cek_login": ("  if auth.uid() is null then\n    raise exception 'LOGIN_DIPERLUKAN' using errcode = '28000';\n  end if;\n", ""),
    "jadi_security_definer": ("security invoker", "security definer"),
    "jadi_volatile": ("language plpgsql\nstable\n", "language plpgsql\nvolatile\n"),
    # (menghapus baris revoke setara di klaster ini: create or replace mempertahankan ACL fungsi lama; yang diuji = pemberian hak)
    "anon_diberi_hak": ("to authenticated, service_role;", "to authenticated, service_role, anon;"),
    "public_diberi_hak": ("to authenticated, service_role;", "to authenticated, service_role, public;"),
}


class DB(NativePostgres):
    def sql_db(self, db, source, uid=None):
        env = {**os.environ, "PSQLRC": "/dev/null"}
        r = subprocess.run(self.as_user + [self.psql, "-X", "-qAt", "-h", str(self.root), "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1"],
                           input=source, text=True, capture_output=True, env=env)
        if r.returncode:
            raise RuntimeError(r.stderr + r.stdout)
        return r.stdout.strip()


def call(pg, db, args="", uid=None, role="authenticated"):
    klaim = f"select set_config('request.jwt.claim.sub','{uid}',true);" if uid else ""
    out = pg.sql_db(db, f"begin; set local role {role}; {klaim} select {FN}({args})::text; commit;")
    return json.loads(out.splitlines()[-1])


def baris(hasil):
    return {r["kode"]: r for r in hasil["baris"]}


ATR_SQL = (f"select p.proacl::text||'|'||p.prosecdef::text||'|'||p.provolatile::text||'|'||coalesce(array_to_string(p.proconfig,','),'')||'|'||pg_get_userbyid(p.proowner)"
           f"||'|'||p.prorettype::regtype::text||'|'||pg_get_function_identity_arguments(p.oid)||'|'||(select count(*) from pg_proc q where q.proname='laporan_stok_analisis')::text"
           f" from pg_proc p where p.oid='{FN}(uuid,integer,date)'::regprocedure;")


def potret_lama(pg, db):
    """Hasil dan atribut fungsi LAMA pada fixture (sebelum migrasi dipasang)."""
    ow = lambda a: call(pg, db, a, uid=U_OWNER)  # noqa: E731
    return {
        "all": ow(f"null, 90, '{HARI}'"), "wa": ow(f"'{WA}', 90, '{HARI}'"), "wb": ow(f"'{WB}', 90, '{HARI}'"),
        "w3": ow(f"null, 3, '{HARI}'"), "staff": call(pg, db, f"null, 90, '{HARI}'", uid=U_STAFF),
        "atr": pg.sql_db(db, ATR_SQL),
        "komentar": pg.sql_db(db, f"select obj_description('{FN}(uuid,integer,date)'::regprocedure, 'pg_proc') is not null;"),
    }


def jalankan_kasus(pg, db, lama):
    """Kembalikan list (nama, lulus, rincian). Setiap kasus berdiri sendiri; galat apa pun = GAGAL."""
    hasil = []

    def kasus(nama):
        def dekor(fn):
            try:
                fn()
                hasil.append((nama, True, ""))
            except Exception as e:  # noqa: BLE001
                hasil.append((nama, False, str(e)[:300]))
            return fn
        return dekor

    cache = {}

    def pakai(args=""):
        if args not in cache:
            cache[args] = call(pg, db, args, uid=U_OWNER)
        return cache[args]

    sama = lambda a, b, pesan="": (_ for _ in ()).throw(AssertionError(f"{pesan} {a!r} != {b!r}")) if float(a) != float(b) else None  # noqa: E731
    semua = lambda: baris(pakai(f"null, 90, '{HARI}'"))  # noqa: E731
    gwa = lambda: baris(pakai(f"'{WA}', 90, '{HARI}'"))  # noqa: E731
    gwb = lambda: baris(pakai(f"'{WB}', 90, '{HARI}'"))  # noqa: E731
    stf = lambda: baris(call(pg, db, f"null, 90, '{HARI}'", uid=U_STAFF))  # noqa: E731

    def cek(nama, peta, kode, kolom, harapan):
        @kasus(nama)
        def _():
            r = peta()
            if harapan == "ABSEN":
                assert f"PB-{kode}" not in r, f"PB-{kode} seharusnya tidak ada"
                return
            row = r[f"PB-{kode}"]
            if isinstance(harapan, str) or harapan is None:
                assert row[kolom] == harapan, f"{kolom}: {row[kolom]!r} != {harapan!r}"
            else:
                sama(row[kolom], harapan, kolom)

    # --- meta: riwayat (pembagi) tidak berubah
    @kasus("A1 bentuk hasil sama: meta + baris")
    def _():
        h = pakai(f"null, 90, '{HARI}'")
        assert set(h) == {"hari_ini", "jendela_hari", "riwayat_mulai", "riwayat_hari", "gudang_id", "baris"}, set(h)

    @kasus("A2 awal riwayat dan hari riwayat (pembagi minimal 14 hari di aplikasi) sama dengan fungsi lama")
    def _():
        h = pakai(f"null, 90, '{HARI}'")
        assert h["riwayat_mulai"] == "2026-08-13" and h["riwayat_hari"] == 98, (h["riwayat_mulai"], h["riwayat_hari"])
        o = lama["all"]
        assert (h["riwayat_mulai"], h["riwayat_hari"], h["jendela_hari"], h["hari_ini"]) == (o["riwayat_mulai"], o["riwayat_hari"], o["jendela_hari"], o["hari_ini"])

    # --- kasir biasa, batal, retur, batal retur
    cek("B1 kasir: jual 10 lalu batal penuh + jual 6 + jual WB 5 + retur 2 + batal retur 2 = pemakaian bersih 11", semua, "JUAL", "keluar", 11)
    cek("B2 modal terjual memakai biaya tiap pergerakan (6000 WA + 5500 WB)", semua, "JUAL", "modal_keluar", 11500)
    cek("B3 sumber bukan pemakaian tidak ikut (pembelian, mutasi, produksi, opname, penyesuaian, koreksi, retur beli): stok tetap", semua, "JUAL", "stok", 50)
    cek("B4 terakhir keluar JUAL = hari batal retur (return-record-void keluar)", semua, "JUAL", "terakhir", "2026-11-17")
    cek("B5 gudang A: keluar bersih 6", gwa, "JUAL", "keluar", 6)
    cek("B6 gudang B: keluar 5 dan terakhir 15 Nov", gwb, "JUAL", "keluar", 5)
    cek("B7 gudang B: terakhir keluar = 15 Nov", gwb, "JUAL", "terakhir", "2026-11-15")

    # --- takaran murni: pasangan klinik + pesanan-selesai nol bersih
    cek("C1 takaran murni (tanpa stok, 4 satuan dalam 3 pasangan): tidak muncul sama sekali", semua, "RACIK", "keluar", "ABSEN")
    cek("C2 takaran murni tidak muncul di gudang A", gwa, "RACIK", "keluar", "ABSEN")
    cek("C3 takaran murni tidak muncul di gudang B", gwb, "RACIK", "keluar", "ABSEN")

    @kasus("C4 bukti masalah: fungsi LAMA menghitung takaran murni 4 satuan terpakai (RED bila memakai fungsi lama)")
    def _():
        assert baris(lama["all"])["PB-RACIK"]["keluar"] in (4, 4.0, "4.0000"), baris(lama["all"])["PB-RACIK"]["keluar"]

    cek("C5 takaran bertumpuk: satu pasangan nol + satu klinik nyata = 1 terpakai", semua, "RACIKS", "keluar", 1)
    cek("C6 takaran bertumpuk: modal 2000", semua, "RACIKS", "modal_keluar", 2000)
    cek("C7 takaran bertumpuk: terakhir = klinik nyata tanpa pasangan (13 Nov), bukan pasangan 15 Nov", semua, "RACIKS", "terakhir", "2026-11-13")
    cek("C8 takaran sebagian (klinik 3, pesanan-selesai 1): 2 terpakai", semua, "PARSIAL", "keluar", 2)
    cek("C9 takaran sebagian: modal 1000", semua, "PARSIAL", "modal_keluar", 1000)
    cek("C10 takaran sebagian: terakhir tetap 16 Nov (bukan netral)", semua, "PARSIAL", "terakhir", "2026-11-16")

    # --- BMHP dasar
    cek("D1 BMHP bahan dasar dihitung lewat klinik-bmhp: 3", semua, "BMHP", "keluar", 3)
    cek("D2 BMHP modal 900", semua, "BMHP", "modal_keluar", 900)
    cek("D3 BMHP terakhir 16 Nov", semua, "BMHP", "terakhir", "2026-11-16")
    cek("D4 pasangan + BMHP nyata pada satu tagihan dan satu barang: 4 (pasangan nol)", semua, "MIX", "keluar", 4)
    cek("D5 pasangan + BMHP: terakhir = hari BMHP (14 Nov), pasangan 17 Nov tidak dihitung", semua, "MIX", "terakhir", "2026-11-14")
    cek("D6 pasangan + BMHP: modal 1600", semua, "MIX", "modal_keluar", 1600)

    # --- tagihan klinik batal
    cek("E1 tagihan klinik dibatalkan (klinik 3 + BMHP 2, klinik-void 5): bersih 0", semua, "VOID", "keluar", 0)
    cek("E2 tagihan klinik dibatalkan: modal 0", semua, "VOID", "modal_keluar", 0)
    cek("E3 tagihan klinik dibatalkan: terakhir tetap hari keluar (sama perlakuan struk batal)", semua, "VOID", "terakhir", "2026-11-15")

    # --- batas pasangan
    cek("F1 pesanan-selesai BESOK tidak ikut: pemakaian hari ini tetap 1", semua, "FUTURE", "keluar", 1)
    cek("F2 pesanan-selesai besok tidak membatalkan klinik hari ini untuk terakhir keluar", semua, "FUTURE", "terakhir", "2026-11-17")
    cek("F3 pasangan di luar jendela 90 hari: keluar 0", semua, "OLD95", "keluar", 0)
    cek("F4 pasangan lama yang nol bersih: terakhir kosong (fungsi lama: 15 Agt)", semua, "OLD95", "terakhir", None)

    # --- gudang
    cek("G1 pasangan beda gudang BUKAN pasangan: semua gudang bersih 0", semua, "WH", "keluar", 0)
    cek("G2 pasangan beda gudang: gudang A tetap 1 terpakai", gwa, "WH", "keluar", 1)
    cek("G3 pasangan beda gudang: gudang B -1 (aplikasi menjepit ke 0)", gwb, "WH", "keluar", -1)
    cek("G4 pasangan beda gudang: terakhir tetap 16 Nov (tidak netral)", semua, "WH", "terakhir", "2026-11-16")
    cek("G5 pasangan beda gudang: gudang B tidak punya keluar -> terakhir kosong", gwb, "WH", "terakhir", None)
    cek("G6 klinik nyata di tagihan sama dengan pasangan tetapi BARANG beda: terakhir tetap 13 Nov", semua, "REAL1", "terakhir", "2026-11-13")
    cek("G7 klinik nyata barang beda: keluar 1", semua, "REAL1", "keluar", 1)

    @kasus("G8 hak cabang: STAFF cabang A hanya melihat gudang A (JUAL 40 stok, 6 keluar); WH 1 terpakai karena pasangan di gudang B tak terlihat")
    def _():
        k = stf()
        sama(k["PB-JUAL"]["stok"], 40); sama(k["PB-JUAL"]["keluar"], 6); sama(k["PB-WH"]["keluar"], 1)
        assert "PB-RACIK" not in k

    @kasus("G9 STAFF: semua baris non-resep identik dengan fungsi lama untuk peran yang sama")
    def _():
        a, b = baris(lama["staff"]), stf()
        for kode in ("PB-REG", "PB-ZERO", "PB-STOKONLY", "PB-INA", "PB-FUTURE", "PB-BMHP", "PB-WH"):
            assert a[kode] == b[kode], (kode, a[kode], b[kode])

    # --- barang tanpa pemakaian / ikut atau tidak
    cek("H1 tanpa pemakaian dengan minimum aktif: tetap ikut, keluar 0", semua, "ZERO", "keluar", 0)
    cek("H2 tanpa pemakaian: terakhir kosong", semua, "ZERO", "terakhir", None)
    cek("H3 hanya stok: keluar 0, nilai 800", semua, "STOKONLY", "nilai", 800)
    cek("H4 takaran dengan stok tetap ada (stok 5)", semua, "RACIKS", "stok", 5)
    cek("H5 jasa tidak ikut", semua, "JASA", "keluar", "ABSEN")
    cek("H6 barang dibuang tidak ikut", semua, "TRASH", "keluar", "ABSEN")
    cek("H7 hanya sumber lain tidak ikut", semua, "LAIN", "keluar", "ABSEN")
    cek("H8 nonaktif bertumpuk tetap ikut", semua, "INA", "nilai", 500)

    @kasus("H9 himpunan barang tepat yang diharapkan")
    def _():
        got = set(semua())
        want = {"PB-" + k for k in ("JUAL", "RACIKS", "PARSIAL", "BMHP", "MIX", "VOID", "FUTURE", "WH", "OLD95", "REAL1", "REG", "ZERO", "STOKONLY", "INA")}
        assert got == want, (sorted(got - want), sorted(want - got))

    # --- regresi: barang non-resep = fungsi lama
    cek("R1 regresi REG: pemakaian bersih 9 (kasir, batal, retur, grosir, klinik tanpa pasangan, racik)", semua, "REG", "keluar", 9)

    @kasus("R2 regresi: semua barang yang tidak menyentuh sumber baru identik dengan fungsi lama (semua gudang, gudang A, gudang B)")
    def _():
        for nama, kunci in (("all", semua), ("wa", gwa), ("wb", gwb)):
            a, b = baris(lama[nama]), kunci()
            for k in KODE:
                kode = "PB-" + k
                if k in BERUBAH:
                    continue
                assert (kode in a) == (kode in b) or k == "WH", (nama, kode)
                if kode in a and kode in b and k != "WH":
                    assert a[kode] == b[kode], (nama, kode, a[kode], b[kode])

    @kasus("R3 regresi: REG identik baris-per-baris dengan fungsi lama di tiga lingkup")
    def _():
        for nama, kunci in (("all", semua), ("wa", gwa), ("wb", gwb)):
            a, b = baris(lama[nama]), kunci()
            assert ("PB-REG" in a) == ("PB-REG" in b), nama
            if "PB-REG" in a:
                assert a["PB-REG"] == b["PB-REG"], (nama, a["PB-REG"], b["PB-REG"])

    @kasus("R4 regresi: jendela 3 hari sama dengan fungsi lama untuk barang non-resep; PARSIAL (jendela 3) = 2, jendela 2 = 0")
    def _():
        h = baris(pakai(f"null, 3, '{HARI}'")); o = baris(lama["w3"])
        for k in ("REG", "ZERO", "STOKONLY", "INA", "BMHP", "FUTURE"):
            assert h["PB-" + k] == o["PB-" + k], k
        sama(h["PB-PARSIAL"]["keluar"], 2)
        h2 = baris(pakai(f"null, 2, '{HARI}'"))
        sama(h2["PB-PARSIAL"]["keluar"], 0)
        assert h2["PB-PARSIAL"]["terakhir"] == "2026-11-16"

    # --- atribut, hak, hanya baca
    @kasus("I1 atribut: ACL, SECURITY INVOKER, STABLE, search_path kosong, pemilik, tipe hasil, argumen sama dengan fungsi lama; satu fungsi saja")
    def _():
        sekarang = pg.sql_db(db, ATR_SQL)
        assert sekarang == lama["atr"], (sekarang, lama["atr"])
        acl = sekarang.split("|")[0]
        assert "authenticated=X/postgres" in acl and "service_role=X/postgres" in acl and "anon" not in acl and "{=" not in acl and ",=" not in acl, acl
        assert sekarang.split("|")[1:4] == ["false", "s", 'search_path=""'], sekarang

    @kasus("I2 hanya baca: tabel stok tidak berubah setelah memanggil fungsi")
    def _():
        ringkas = "select (select md5(string_agg(t::text,'|' order by t::text)) from public.stock_moves t)||(select md5(string_agg(t::text,'|' order by t::text)) from public.stock_layers t)||(select md5(string_agg(t::text,'|' order by t::text)) from public.stock t)||(select md5(string_agg(t::text,'|' order by t::text)) from public.items t);"
        antes = pg.sql_db(db, ringkas)
        call(pg, db, f"null, 90, '{HARI}'", uid=U_OWNER)
        assert antes == pg.sql_db(db, ringkas)

    @kasus("I3 wajib login: tanpa sesi ditolak (LOGIN_DIPERLUKAN)")
    def _():
        try:
            pg.sql_db(db, f"begin; set local role authenticated; select {FN}(null, 90, '{HARI}'); commit;")
            raise AssertionError("tanpa sesi seharusnya ditolak")
        except RuntimeError as e:
            assert "LOGIN_DIPERLUKAN" in str(e), str(e)[:200]

    @kasus("I4 anon tidak punya hak EXECUTE")
    def _():
        try:
            pg.sql_db(db, f"begin; set local role anon; select {FN}(null, 90, '{HARI}'); commit;")
            raise AssertionError("anon seharusnya ditolak")
        except RuntimeError as e:
            assert "permission denied" in str(e), str(e)[:200]

    @kasus("I5 jendela tidak sah ditolak (0, 401, kosong)")
    def _():
        for nilai in ("0", "401", "null"):
            try:
                call(pg, db, f"null, {nilai}, '{HARI}'", uid=U_OWNER)
                raise AssertionError(f"jendela {nilai} seharusnya ditolak")
            except RuntimeError as e:
                assert "JENDELA_TIDAK_VALID" in str(e), str(e)[:200]

    @kasus("I6 hari ini bawaan = tanggal WIB")
    def _():
        h = call(pg, db, "null, 90", uid=U_OWNER)
        assert h["hari_ini"] == pg.sql_db(db, "select (now() at time zone 'Asia/Jakarta')::date::text;")

    @kasus("I7 komentar fungsi tetap ada dan mencatat pemakaian bersih")
    def _():
        c = pg.sql_db(db, f"select obj_description('{FN}(uuid,integer,date)'::regprocedure, 'pg_proc');")
        assert "bersih" in c and "pesanan-selesai" in c, c

    @kasus("I8 tidak ada pemicu/kebijakan/tabel baru: fungsi tidak menulis apa pun (sidik tabel stok sama)")
    def _():
        assert pg.sql_db(db, "select count(*) from pg_trigger t join pg_proc p on p.oid=t.tgfoid where p.proname='laporan_stok_analisis';") == "0"

    return hasil


def digest(pg, db):
    return pg.sql_db(db, """select md5(string_agg(x, '|' order by x)) from (
      select p.oid::regprocedure::text||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,'') as x from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname in ('public','clinic_private','role_settings_private') and p.prokind='f' and p.proname<>'laporan_stok_analisis'
      union all select 'pol:'||schemaname||tablename||policyname||coalesce(qual,'') from pg_policies where schemaname in ('public','role_settings_private')
      union all select 'col:'||table_schema||table_name||column_name||data_type from information_schema.columns where table_schema in ('public','role_settings_private')
      union all select 'trg:'||tgrelid::regclass::text||tgname from pg_trigger where not tgisinternal
      union all select 'cat:'||id from role_settings_private.submenu_catalog) s;""")


def pasang(pg, db, teks):
    pg.sql_db(db, "begin;\n" + teks + "\ncommit;")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pg-bin", default=os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin"))
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--mutants", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--json", default="")
    ap.add_argument("--rollback", default="", help="ROLLBACK.sql yang dihasilkan: setelah GREEN dipasang di atas migrasi; hasil fungsi dan ACL harus kembali = fungsi lama")
    args = ap.parse_args()
    asli = MIGRASI.read_text()
    laporan: dict = {"mode": "baseline" if args.baseline else "mutants" if args.mutants else "green"}
    with DB(args.pg_bin) as pg:
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
        print(f"PASS A: {len(lain)} migrasi repo (tanpa migrasi ini; fungsi lama terpasang) berjalan dari nol", flush=True)
        pg.sql(fixture_sql())
        sebelum = digest(pg, "postgres")
        lama = potret_lama(pg, "postgres")
        assert baris(lama["all"])["PB-RACIK"], "fixture: fungsi lama harus menghitung takaran murni (bukti masalah)"

        if args.baseline:
            hasil = jalankan_kasus(pg, "postgres", lama)
            gagal = [h for h in hasil if not h[1]]
            for n, ok, rinci in hasil:
                print(("PASS " if ok else "FAIL ") + n + ("" if ok else f"  [{rinci[:120]}]"), flush=True)
            laporan.update(total=len(hasil), gagal=len(gagal), gagal_nama=[g[0] for g in gagal])
            print(f"RED: {len(gagal)}/{len(hasil)} kasus gagal tanpa migrasi (fungsi lama)", flush=True)
        elif args.mutants:
            pg.sql("select pg_terminate_backend(pid) from pg_stat_activity where datname='postgres' and pid<>pg_backend_pid();")
            varian = [("kontrol", asli)]
            for nama, (lama_t, baru_t) in ANCHORS.items():
                assert asli.count(lama_t) == 1, f"jangkar mutan {nama} muncul {asli.count(lama_t)}x"
                varian.append((nama, asli.replace(lama_t, baru_t)))
            pilih = {x for x in args.only.split(",") if x}
            hasil_mutan = {}
            for i, (nama, teks) in enumerate(varian):
                if pilih and nama not in pilih and nama != "kontrol":
                    continue
                db = f"v_{i}"
                pg.sql(f"create database {db} template postgres;")
                try:
                    try:
                        pasang(pg, db, teks)
                    except RuntimeError as e:
                        hasil_mutan[nama] = {"gagal": ["PASANG: " + str(e)[:200]], "total": 0, "crash": True}
                        print(f"{'KONTROL RUSAK' if nama == 'kontrol' else 'MATI(pasang)'} {nama}", flush=True)
                        continue
                    h = jalankan_kasus(pg, db, lama)
                    gagal = [x[0] for x in h if not x[1]]
                    hasil_mutan[nama] = {"gagal": gagal, "total": len(h)}
                    print(f"{'KONTROL' if nama == 'kontrol' else 'MUTAN'} {nama}: {len(gagal)} kasus gagal" + ("" if nama == "kontrol" else "  -> " + ("MATI" if gagal else "HIDUP!")), flush=True)
                finally:
                    pg.sql(f"drop database if exists {db} with (force);")
            hidup = [n for n, v in hasil_mutan.items() if n != "kontrol" and not v["gagal"]]
            ctrl = hasil_mutan.get("kontrol", {})
            crash = [n for n, v in hasil_mutan.items() if v.get("crash")]
            laporan.update(mutan=hasil_mutan, hidup=hidup, crash=crash, kontrol_gagal=ctrl.get("gagal"), jumlah_mutan=len(hasil_mutan) - 1,
                           mati=len(hasil_mutan) - 1 - len(hidup))
            assert not ctrl.get("gagal"), f"kontrol harus 0 gagal: {ctrl}"
            assert not hidup, f"mutan hidup: {hidup}"
            print(f"MUTAN: {len(hasil_mutan) - 1} mutan, semua mati; kontrol 0 gagal; crash-saat-pasang: {crash}", flush=True)
        else:
            pasang(pg, "postgres", asli)
            hasil = jalankan_kasus(pg, "postgres", lama)
            for n, ok, rinci in hasil:
                print(("PASS " if ok else "FAIL ") + n + ("" if ok else f"  [{rinci}]"), flush=True)
            gagal = [h for h in hasil if not h[1]]
            pasang(pg, "postgres", asli)  # pasang kedua kali: idempoten
            sesudah = digest(pg, "postgres")
            ok_digest = sebelum == sesudah
            ok_acl = pg.sql(ATR_SQL) == lama["atr"]
            print(("PASS " if ok_digest else "FAIL ") + "M1 tidak ada fungsi/kebijakan/kolom/pemicu/katalog lain yang berubah (sidik sama sebelum-sesudah)", flush=True)
            print("PASS M2 pasang dua kali lolos (idempoten)", flush=True)
            if args.rollback:
                teks = "\n".join(b for b in Path(args.rollback).read_text().splitlines() if b.strip().lower() not in ("begin;", "commit;"))
                pasang(pg, "postgres", teks)
                kembali = potret_lama(pg, "postgres")
                ok_rb = kembali == lama and baris(kembali["all"])["PB-RACIK"]["keluar"] == baris(lama["all"])["PB-RACIK"]["keluar"]
                print(("PASS " if ok_rb else "FAIL ") + "M4 ROLLBACK.sql mengembalikan fungsi lama: hasil 5 lingkup + ACL/atribut + komentar sama dengan potret sebelum migrasi", flush=True)
                laporan["rollback_ok"] = ok_rb
                assert ok_rb
            print(("PASS " if ok_acl else "FAIL ") + "M3 ACL/atribut sama setelah pasang kedua", flush=True)
            laporan.update(total=len(hasil) + 3, gagal=len(gagal) + (0 if ok_digest else 1) + (0 if ok_acl else 1))
            assert not gagal and ok_digest and ok_acl
            print(f"GREEN: {len(hasil) + 3} kasus lulus", flush=True)
    if args.json:
        Path(args.json).write_text(json.dumps(laporan, indent=1, ensure_ascii=False))
    print("SELESAI", flush=True)


if __name__ == "__main__":
    main()
