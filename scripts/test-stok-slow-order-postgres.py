#!/usr/bin/env python3
"""Uji migrasi 20261117100000 (fungsi laporan_stok_analisis + 2 sub-menu Akses Grup) di PostgreSQL 17 sungguhan, data fiktif.

Dasar: skema penuh repo (semua migrasi KECUALI migrasi ini) diputar dari nol, lalu data fiktif ditanam, lalu migrasi dipasang.
Mode:
  (default)    GREEN  - semua kasus harus lulus
  --baseline   RED    - tanpa migrasi; kasus yang bergantung padanya harus GAGAL
  --mutants    kloning database per mutan (>= 10); tiap mutan harus gagal di >= 1 kasus, kontrol 0 gagal
  --json FILE  tulis hasil
Jalankan dengan: flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-stok-slow-order-postgres.py --pg-bin /opt/data/kamo-pg-harness/bin
Tidak pernah terhubung ke Production: klaster lokal sekali pakai, socket unix, dibuang di akhir.
"""
import argparse
import importlib.util
import json
import os
import re
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
MIGRASI = MIGRATIONS / "20261117100000_stok_slow_order_laporan.sql"
HARI = "2026-11-13"
FN = "public.laporan_stok_analisis"

CAB_A = "a0000000-0000-4000-8000-00000000000a"
CAB_B = "b0000000-0000-4000-8000-00000000000b"
WA = "11111111-0000-4000-8000-00000000000a"
WB = "11111111-0000-4000-8000-00000000000b"
U_OWNER = "10000000-0000-4000-8000-000000000001"
U_STAFF = "10000000-0000-4000-8000-000000000005"
ITEM = {k: f"22222222-0000-4000-8000-0000000000{n:02d}" for n, k in enumerate(["sold", "inaktif", "minonly", "inaktif0", "jasa", "trashed", "minus", "grup", "lain"], 1)}


def d(n):
    """tanggal = HARI - n hari (SQL)."""
    return f"(date '{HARI}' - {n})"


FIXTURE = f"""
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
  ('{ITEM['sold']}','UJ-SOLD','Barang Laku','PCS','Persediaan',true,0,null,0,0,0),
  ('{ITEM['inaktif']}','UJ-INA','Nonaktif Bertumpuk','PCS','Persediaan',false,0,null,0,0,0),
  ('{ITEM['minonly']}','UJ-MIN','Hanya Minimum','PCS','Persediaan',true,10,null,0,0,0),
  ('{ITEM['inaktif0']}','UJ-IN0','Nonaktif Kosong','PCS','Persediaan',false,5,null,0,0,0),
  ('{ITEM['jasa']}','UJ-JAS','Jasa Grooming','PCS','Jasa',true,0,null,0,0,0),
  ('{ITEM['trashed']}','UJ-TRS','Dibuang','PCS','Persediaan',true,0,now(),0,0,0),
  ('{ITEM['minus']}','UJ-MNS','Stok Minus','PCS','Persediaan',true,0,null,0,0,0),
  ('{ITEM['grup']}','UJ-GRP','Paket','PCS','Grup',true,0,null,0,0,0),
  ('{ITEM['lain']}','UJ-LAIN','Hanya Sumber Lain','PCS','Persediaan',true,0,null,0,0,0);

insert into public.stock_layers(warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost, source, source_ref) values
  ('{WA}','{ITEM['sold']}',{d(20)},30,30,1000,'purchase','x'),
  ('{WA}','{ITEM['sold']}',{d(5)},20,20,1200,'purchase','x'),
  ('{WB}','{ITEM['sold']}',{d(20)},10,10,1000,'purchase','x'),
  ('{WA}','{ITEM['sold']}',{d(40)},9,0,999,'purchase','x'),
  ('{WA}','{ITEM['inaktif']}',{d(3)},5,5,100,'purchase','x'),
  ('{WA}','{ITEM['jasa']}',{d(3)},5,5,100,'purchase','x'),
  ('{WA}','{ITEM['trashed']}',{d(3)},5,5,100,'purchase','x');
insert into public.stock(warehouse_id, item_id, qty) values
  ('{WA}','{ITEM['sold']}',50), ('{WB}','{ITEM['sold']}',10), ('{WA}','{ITEM['inaktif']}',5),
  ('{WA}','{ITEM['jasa']}',5), ('{WA}','{ITEM['trashed']}',5), ('{WA}','{ITEM['minus']}',-3);

-- pemakaian barang laku (sumber yang dihitung)
insert into public.stock_moves(tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref) values
  ({d(2)},'{WA}','{ITEM['sold']}',-10,1000,'sale','s1'),
  ({d(3)},'{WB}','{ITEM['sold']}',-5,1100,'sale','s2'),
  ({d(1)},'{WA}','{ITEM['sold']}',4,1000,'sale-void','s1'),
  ({d(4)},'{WA}','{ITEM['sold']}',-3,1000,'klinik','k1'),
  ({d(4)},'{WA}','{ITEM['sold']}',-1,1000,'klinik-bmhp','k1'),
  ({d(4)},'{WA}','{ITEM['sold']}',-2,1000,'racik','r1'),
  ({d(6)},'{WB}','{ITEM['sold']}',-6,1000,'sales-delivery','g1'),
  ({d(89)},'{WA}','{ITEM['sold']}',-7,1000,'sale','batas-dalam'),
  ({d(90)},'{WA}','{ITEM['sold']}',-9,1000,'sale','batas-luar'),
  ({d(-1)},'{WA}','{ITEM['sold']}',-100,1000,'sale','besok'),
  -- bukan pemakaian: tidak boleh ikut
  ({d(10)},'{WA}','{ITEM['sold']}',100,800,'purchase','p1'),
  ({d(9)},'{WA}','{ITEM['sold']}',-50,1000,'transfer','t1'),
  ({d(9)},'{WB}','{ITEM['sold']}',50,1050,'transfer','t1'),
  ({d(8)},'{WA}','{ITEM['sold']}',-20,1000,'produksi','pr1'),
  ({d(7)},'{WA}','{ITEM['sold']}',-1,1000,'opname','o1'),
  ({d(5)},'{WA}','{ITEM['sold']}',-5,1000,'kirim-permintaan','kp1'),
  -- stok minus yang terjual kemarin
  ({d(1)},'{WA}','{ITEM['minus']}',-3,500,'sale','s9'),
  -- hanya sumber lain
  ({d(3)},'{WA}','{ITEM['lain']}',10,100,'purchase','p2'),
  ({d(2)},'{WA}','{ITEM['lain']}',-4,100,'transfer','t2');
commit;
"""

ANCHORS = {  # nama mutan: (teks lama, teks baru) - tiap teks lama harus muncul TEPAT sekali
    "sumber_tanpa_sale_void": ("    'sale-void', 'retur-jual',", "    'retur-jual',"),
    "sumber_ikut_purchase": ("    'sale', 'sale-group', 'sale-online', 'sales-delivery',", "    'sale', 'purchase', 'sale-group', 'sale-online', 'sales-delivery',"),
    "sumber_ikut_transfer": ("    'racik', 'racik-koreksi', 'racik-kembali',", "    'racik', 'transfer', 'racik-koreksi', 'racik-kembali',"),
    "sumber_tanpa_klinik_bmhp": ("    'klinik', 'klinik-bmhp', 'klinik-edit',", "    'klinik', 'klinik-edit',"),
    "awal_riwayat_pakai_qty_positif": ("where m.source = any (v_sumber) and m.qty < 0 and m.tanggal <= v_hari;", "where m.source = any (v_sumber) and m.qty > 0 and m.tanggal <= v_hari;"),
    "jendela_geser_satu_hari": ("v_batas := v_hari - (p_jendela_hari - 1);", "v_batas := v_hari - p_jendela_hari;"),
    "pemakaian_tanpa_batas_hari_ini": ("where m.source = any (v_sumber) and m.tanggal between v_batas and v_hari", "where m.source = any (v_sumber) and m.tanggal >= v_batas"),
    "lapisan_habis_ikut": ("     where l.qty_left > 0\n     group by l.item_id", "     group by l.item_id"),
    "filter_gudang_dibuang": ("select w.id from public.warehouses w where p_gudang is null or w.id = p_gudang", "select w.id from public.warehouses w"),
    "barang_dibuang_ikut": ("where i.item_type = 'Persediaan' and i.trashed_at is null", "where i.item_type = 'Persediaan'"),
    "jasa_ikut": ("where i.item_type = 'Persediaan' and i.trashed_at is null", "where i.trashed_at is null"),
    "tanpa_cek_login": ("  if auth.uid() is null then\n    raise exception 'LOGIN_DIPERLUKAN' using errcode = '28000';\n  end if;\n", ""),
    "jadi_security_definer": ("security invoker", "security definer"),
    "jadi_volatile": ("language plpgsql\nstable\n", "language plpgsql\nvolatile\n"),
    "modal_tanpa_biaya": ("-sum(m.qty * m.unit_cost) as modal", "-sum(m.qty) as modal"),
    "terakhir_ikut_masuk": ("where m.item_id = i.id and m.qty < 0 and m.source = any (v_sumber) and m.tanggal <= v_hari", "where m.item_id = i.id and m.source = any (v_sumber) and m.tanggal <= v_hari"),
    "tanpa_cek_jendela": ("  if p_jendela_hari is null or p_jendela_hari < 1 or p_jendela_hari > 400 then\n    raise exception 'JENDELA_TIDAK_VALID' using errcode = '22023';\n  end if;\n", ""),
    "anon_boleh_eksekusi": ("revoke all on function public.laporan_stok_analisis(uuid, integer, date) from public, anon;\n", ""),
    "stok_sejak_terbaru": ("min(l.tanggal) as sejak", "max(l.tanggal) as sejak"),
    "min_stock_aktif_dibuang": ("          or (i.is_active and i.min_stock > 0));", "          );"),
    "biaya_terakhir_terlama": ("order by m.tanggal desc, m.created_at desc", "order by m.tanggal asc, m.created_at asc"),
    "katalog_satu_baris": ("('laporan.stok-slow-moving','laporan'),\n('laporan.stok-harus-order','laporan')", "('laporan.stok-slow-moving','laporan')"),
    "terakhir_semua_gudang_saat_filter": ("         and m.warehouse_id in (select id from gud)\n", ""),
    "sumber_tanpa_klinik": ("    'klinik', 'klinik-bmhp', 'klinik-edit',", "    'klinik-bmhp', 'klinik-edit',"),
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


def jalankan_kasus(pg, db):
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

    pakai = lambda args="", **kw: call(pg, db, args, uid=U_OWNER, **kw)  # noqa: E731
    sama = lambda a, b, pesan="": (_ for _ in ()).throw(AssertionError(f"{pesan} {a!r} != {b!r}")) if float(a) != float(b) else None  # noqa: E731

    @kasus("A1 bentuk hasil: meta + baris, awal riwayat global")
    def _():
        h = pakai(f"null, 90, '{HARI}'")
        assert set(h) == {"hari_ini", "jendela_hari", "riwayat_mulai", "riwayat_hari", "gudang_id", "baris"}, set(h)
        assert h["hari_ini"] == HARI and h["jendela_hari"] == 90 and h["gudang_id"] is None
        assert h["riwayat_mulai"] == "2026-08-15", h["riwayat_mulai"]  # HARI - 90
        assert h["riwayat_hari"] == 91, h["riwayat_hari"]

    @kasus("B1 barang laku: stok, nilai FIFO (lapisan habis tidak ikut), stok_sejak")
    def _():
        r = baris(pakai(f"null, 90, '{HARI}'"))["UJ-SOLD"]
        sama(r["stok"], 60, "stok"); sama(r["nilai"], 64000, "nilai")
        assert r["stok_sejak"] == "2026-10-24", r["stok_sejak"]  # HARI - 20

    @kasus("B2 pemakaian bersih: kasir+klinik+BMHP+racik+grosir, batal mengurangi, bukan-pemakaian tidak ikut, besok dan di luar jendela tidak ikut")
    def _():
        r = baris(pakai(f"null, 90, '{HARI}'"))["UJ-SOLD"]
        sama(r["keluar"], 30, "keluar")  # 10+5-4+3+1+2+6+7

    @kasus("B3 modal terjual memakai biaya per satuan dasar tiap pergerakan")
    def _():
        r = baris(pakai(f"null, 90, '{HARI}'"))["UJ-SOLD"]
        sama(r["modal_keluar"], 30500, "modal")

    @kasus("B4 terakhir keluar = hari terakhir ada barang KELUAR (pembatalan di hari lebih baru tidak mengubahnya), dan masuk terakhir untuk biaya")
    def _():
        r = baris(pakai(f"null, 90, '{HARI}'"))["UJ-SOLD"]
        assert r["terakhir"] == "2026-11-11", r["terakhir"]  # HARI - 2
        sama(r["biaya_terakhir"], 1000, "biaya_terakhir")  # masuk terakhir = pembatalan d1 @1000

    @kasus("C1 jendela 30 hari: keluar di luar jendela tidak dihitung, terakhir tetap")
    def _():
        r = baris(pakai(f"null, 30, '{HARI}'"))["UJ-SOLD"]
        sama(r["keluar"], 23, "keluar30"); sama(r["modal_keluar"], 23500, "modal30")

    @kasus("C2 batas jendela tepat: hari ke-90 masuk, hari ke-91 tidak")
    def _():
        r = baris(pakai(f"null, 90, '{HARI}'"))["UJ-SOLD"]
        sama(r["keluar"], 30, "d89 masuk, d90 tidak")

    @kasus("D1 satu gudang: hanya stok/lapisan/pergerakan gudang itu; awal riwayat tetap global")
    def _():
        a = pakai(f"'{WA}', 90, '{HARI}'")
        ra = baris(a)["UJ-SOLD"]
        sama(ra["stok"], 50); sama(ra["nilai"], 54000); sama(ra["keluar"], 19); sama(ra["modal_keluar"], 19000)
        assert ra["terakhir"] == "2026-11-11" and a["gudang_id"] == WA and a["riwayat_hari"] == 91
        rb = baris(pakai(f"'{WB}', 90, '{HARI}'"))["UJ-SOLD"]
        sama(rb["stok"], 10); sama(rb["nilai"], 10000); sama(rb["keluar"], 11); sama(rb["modal_keluar"], 11500)
        assert rb["terakhir"] == "2026-11-10", rb["terakhir"]

    @kasus("E1 barang yang ikut: nonaktif bertumpuk, hanya-minimum aktif, stok minus; jasa/paket/dibuang/nonaktif kosong/hanya-sumber-lain tidak")
    def _():
        k = baris(pakai(f"null, 90, '{HARI}'"))
        assert set(k) == {"UJ-SOLD", "UJ-INA", "UJ-MIN", "UJ-MNS"}, sorted(k)
        sama(k["UJ-INA"]["nilai"], 500); assert k["UJ-INA"]["aktif"] is False
        sama(k["UJ-MIN"]["stok"], 0); sama(k["UJ-MIN"]["min_stock"], 10)
        sama(k["UJ-MNS"]["stok"], -3); sama(k["UJ-MNS"]["nilai"], 0); sama(k["UJ-MNS"]["keluar"], 3)

    @kasus("F1 hak cabang: STAFF cabang A hanya melihat gudang cabang A (RLS pemanggil tetap berlaku)")
    def _():
        h = call(pg, db, f"null, 90, '{HARI}'", uid=U_STAFF)
        r = baris(h)["UJ-SOLD"]
        sama(r["stok"], 50); sama(r["nilai"], 54000); sama(r["keluar"], 19)

    @kasus("G1 wajib login: tanpa sesi ditolak; peran anon tidak boleh menjalankan")
    def _():
        try:
            pg.sql_db(db, f"begin; set local role authenticated; select {FN}(null, 90, '{HARI}'); commit;")
            raise AssertionError("tanpa sesi seharusnya ditolak")
        except RuntimeError as e:
            assert "LOGIN_DIPERLUKAN" in str(e), str(e)[:200]

    @kasus("G2 anon tidak punya hak EXECUTE")
    def _():
        try:
            pg.sql_db(db, f"begin; set local role anon; select {FN}(null, 90, '{HARI}'); commit;")
            raise AssertionError("anon seharusnya ditolak")
        except RuntimeError as e:
            assert "permission denied" in str(e), str(e)[:200]

    @kasus("H1 jendela tidak sah ditolak (0, 401, kosong)")
    def _():
        for nilai in ("0", "401", "null"):
            try:
                pakai(f"null, {nilai}, '{HARI}'")
                raise AssertionError(f"jendela {nilai} seharusnya ditolak")
            except RuntimeError as e:
                assert "JENDELA_TIDAK_VALID" in str(e), str(e)[:200]

    @kasus("I1 hanya baca: STABLE, SECURITY INVOKER, search_path kosong; data tidak berubah")
    def _():
        atr = pg.sql_db(db, f"select provolatile::text||'|'||prosecdef::text||'|'||coalesce(array_to_string(proconfig,','),'') from pg_proc where oid='{FN}(uuid,integer,date)'::regprocedure;")
        assert atr == 's|false|search_path=""', atr
        antes = pg.sql_db(db, "select (select md5(string_agg(t::text,'|' order by t::text)) from public.stock_moves t)||(select md5(string_agg(t::text,'|' order by t::text)) from public.stock_layers t)||(select md5(string_agg(t::text,'|' order by t::text)) from public.stock t)||(select md5(string_agg(t::text,'|' order by t::text)) from public.items t);")
        pakai(f"null, 90, '{HARI}'")
        sesudah = pg.sql_db(db, "select (select md5(string_agg(t::text,'|' order by t::text)) from public.stock_moves t)||(select md5(string_agg(t::text,'|' order by t::text)) from public.stock_layers t)||(select md5(string_agg(t::text,'|' order by t::text)) from public.stock t)||(select md5(string_agg(t::text,'|' order by t::text)) from public.items t);")
        assert antes == sesudah

    @kasus("J1 hari ini bawaan = tanggal WIB")
    def _():
        h = pakai("null, 90")
        wib = pg.sql_db(db, "select (now() at time zone 'Asia/Jakarta')::date::text;")
        assert h["hari_ini"] == wib, (h["hari_ini"], wib)

    @kasus("K1 katalog Akses Grup memuat dua sub-menu baru di modul laporan")
    def _():
        n = pg.sql_db(db, "select count(*) from role_settings_private.submenu_catalog where id in ('laporan.stok-slow-moving','laporan.stok-harus-order') and module_id='laporan';")
        assert n == "2", n

    @kasus("L1 hak: authenticated boleh, anon tidak; fungsi terdaftar satu kali")
    def _():
        r = pg.sql_db(db, f"select has_function_privilege('authenticated','{FN}(uuid,integer,date)','execute')::text||'|'||has_function_privilege('anon','{FN}(uuid,integer,date)','execute')::text||'|'||(select count(*) from pg_proc where proname='laporan_stok_analisis')::text;")
        assert r == "true|false|1", r

    return hasil


def digest(pg, db):
    return pg.sql_db(db, """select md5(string_agg(x, '|' order by x)) from (
      select p.oid::regprocedure::text||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,'') as x from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname in ('public','clinic_private','role_settings_private') and p.prokind='f' and p.proname<>'laporan_stok_analisis'
      union all select 'pol:'||schemaname||tablename||policyname||coalesce(qual,'') from pg_policies where schemaname in ('public','role_settings_private')
      union all select 'col:'||table_schema||table_name||column_name||data_type from information_schema.columns where table_schema in ('public','role_settings_private')
      union all select 'trg:'||tgrelid::regclass::text||tgname from pg_trigger where not tgisinternal) s;""")


def pasang(pg, db, teks):
    pg.sql_db(db, "begin;\n" + teks + "\ncommit;")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pg-bin", default=os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin"))
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--mutants", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--json", default="")
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
        print(f"PASS A: {len(lain)} migrasi repo (tanpa migrasi ini) berjalan dari nol", flush=True)
        pg.sql(FIXTURE)
        sebelum = digest(pg, "postgres")
        katalog_sebelum = pg.sql("select count(*) from role_settings_private.submenu_catalog;")

        if args.baseline:
            hasil = jalankan_kasus(pg, "postgres")
            gagal = [h for h in hasil if not h[1]]
            for n, ok, _ in hasil:
                print(("PASS " if ok else "FAIL ") + n, flush=True)
            laporan.update(total=len(hasil), gagal=len(gagal))
            print(f"RED: {len(gagal)}/{len(hasil)} kasus gagal tanpa migrasi", flush=True)
        elif args.mutants:
            pg.sql("select pg_terminate_backend(pid) from pg_stat_activity where datname='postgres' and pid<>pg_backend_pid();")
            varian = [("kontrol", asli)]
            for nama, (lama, baru) in ANCHORS.items():
                assert asli.count(lama) == 1, f"jangkar mutan {nama} muncul {asli.count(lama)}x"
                varian.append((nama, asli.replace(lama, baru)))
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
                    h = jalankan_kasus(pg, db)
                    gagal = [x[0] for x in h if not x[1]]
                    hasil_mutan[nama] = {"gagal": gagal, "total": len(h)}
                    print(f"{'KONTROL' if nama == 'kontrol' else 'MUTAN'} {nama}: {len(gagal)} kasus gagal" + ("" if nama == "kontrol" else "  -> " + ("MATI" if gagal else "HIDUP!")), flush=True)
                finally:
                    pg.sql(f"drop database if exists {db} with (force);")
            hidup = [n for n, v in hasil_mutan.items() if n != "kontrol" and not v["gagal"]]
            ctrl = hasil_mutan.get("kontrol", {})
            laporan.update(mutan=hasil_mutan, hidup=hidup, kontrol_gagal=ctrl.get("gagal"))
            assert not ctrl.get("gagal"), f"kontrol harus 0 gagal: {ctrl}"
            assert not hidup, f"mutan hidup: {hidup}"
            print(f"MUTAN: {len(hasil_mutan) - 1} mutan, semua mati; kontrol 0 gagal", flush=True)
        else:
            pasang(pg, "postgres", asli)
            hasil = jalankan_kasus(pg, "postgres")
            for n, ok, rinci in hasil:
                print(("PASS " if ok else "FAIL ") + n + ("" if ok else f"  [{rinci}]"), flush=True)
            gagal = [h for h in hasil if not h[1]]
            # pasang kedua kali: idempoten
            pasang(pg, "postgres", asli)
            sesudah = digest(pg, "postgres")
            katalog = pg.sql("select count(*) from role_settings_private.submenu_catalog;")
            tambah = int(katalog) - int(katalog_sebelum)
            ok_digest = sebelum == sesudah
            print(("PASS " if ok_digest else "FAIL ") + "M1 tidak ada fungsi/kebijakan/kolom/pemicu lain yang berubah (sidik sama sebelum-sesudah)", flush=True)
            print(("PASS " if tambah == 2 else "FAIL ") + f"M2 katalog Akses Grup bertambah tepat 2 baris (dan pasang kedua kalinya tidak menggandakan): +{tambah}", flush=True)
            print("PASS M3 pasang dua kali lolos (idempoten)", flush=True)
            laporan.update(total=len(hasil) + 3, gagal=len(gagal) + (0 if ok_digest else 1) + (0 if tambah == 2 else 1))
            assert not gagal and ok_digest and tambah == 2
            print(f"GREEN: {len(hasil) + 3} kasus lulus", flush=True)
    if args.json:
        Path(args.json).write_text(json.dumps(laporan, indent=1, ensure_ascii=False))
    print("SELESAI", flush=True)


if __name__ == "__main__":
    main()
