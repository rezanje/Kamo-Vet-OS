#!/usr/bin/env python3
"""Uji migrasi 20261118200000 (ubah cabang, ubah/nonaktifkan/hapus gudang) di PostgreSQL sungguhan, data fiktif.

Dasar: skema penuh repo (semua migrasi KECUALI migrasi ini) diputar dari nol, data fiktif ditanam, lalu migrasi dipasang.
Mode:
  (default)    GREEN  - semua kasus harus lulus
  --baseline   RED    - tanpa migrasi; kasus yang bergantung padanya harus GAGAL
  --mutants    kloning database per mutan (>= 10); tiap mutan gagal di >= 1 kasus, kontrol 0 gagal
  --json FILE  tulis hasil
Jalankan: flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-cabang-gudang-ubah-postgres.py --pg-bin /opt/data/kamo-pg-harness/bin
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
MIGRASI = MIGRATIONS / "20261118200000_cabang_gudang_ubah_hapus.sql"

U = {k: f"10000000-0000-4000-8000-0000000000{n:02d}" for n, k in enumerate(["owner", "admin", "staff", "finance", "owner_off", "admin_off"], 1)}
CAB = {k: f"a0000000-0000-4000-8000-0000000000{n:02d}" for n, k in enumerate(["a", "b", "c", "d", "e", "f"], 1)}
WH = {k: f"b0000000-0000-4000-8000-0000000000{n:02d}" for n, k in enumerate(["a1", "a2", "a3", "a4", "b1", "b2", "e1", "f1", "f2"], 1)}

FIXTURE = f"""
create schema zz_test;
-- tanam satu baris minimal ke tabel apa pun (FK dilewati lewat peran replica), hanya kolom NOT NULL tanpa bawaan
create function zz_test.plant(p_rel regclass, p_cols text[], p_vals text[]) returns void language plpgsql as $f$
declare a record; cols text := ''; vals text := ''; v text; i int;
begin
  perform set_config('session_replication_role','replica',true);
  for a in select att.attname, att.attnotnull, att.atthasdef, t.typname, t.typcategory, t.typtype, att.atttypid
             from pg_attribute att join pg_type t on t.oid=att.atttypid
            where att.attrelid=p_rel and att.attnum>0 and not att.attisdropped and att.attgenerated='' and att.attidentity=''
            order by att.attnum loop
    i := array_position(p_cols, a.attname::text);
    if i is not null then v := p_vals[i];
    elsif a.attnotnull and not a.atthasdef then
      v := case when a.typtype='e' then format('(select e.enumlabel::text from pg_enum e where e.enumtypid=%s order by e.enumsortorder limit 1)::%s', a.atttypid, a.atttypid::regtype)
                when a.typname='uuid' then 'gen_random_uuid()'
                when a.typname in ('json','jsonb') then '''{{}}'''
                when a.typname='date' then 'current_date'
                when a.typname in ('timestamptz','timestamp') then 'now()'
                when a.typname in ('time','timetz') then '''00:00'''
                when a.typcategory='N' then '1'
                when a.typcategory='B' then 'false'
                when a.typcategory='A' then '''{{}}'''
                when a.typcategory='T' then '''0 seconds'''
                when a.typcategory='S' then '''xyz''||substr(md5(random()::text),1,6)'
                else '''x''' end;
    else continue; end if;
    cols := cols || case when cols='' then '' else ',' end || quote_ident(a.attname);
    vals := vals || case when vals='' then '' else ',' end || v;
  end loop;
  execute format('insert into %s(%s) values(%s)', p_rel, cols, vals);
  perform set_config('session_replication_role','origin',true);
end $f$;

insert into auth.users(id) values ('{U['owner']}'),('{U['admin']}'),('{U['staff']}'),('{U['finance']}'),('{U['owner_off']}'),('{U['admin_off']}') on conflict do nothing;
insert into public.profiles(id, role, is_active, full_name) values
 ('{U['owner']}','OWNER',true,'Uji Owner'),('{U['admin']}','ADMIN',true,'Uji Admin'),('{U['staff']}','STAFF',true,'Uji Staff'),
 ('{U['finance']}','FINANCE',true,'Uji Finance'),('{U['owner_off']}','OWNER',false,'Uji Owner Off'),('{U['admin_off']}','ADMIN',false,'Uji Admin Off')
 on conflict (id) do update set role=excluded.role, is_active=excluded.is_active;
insert into public.branches(id, code, name, type, is_active) values
 ('{CAB['a']}','UJI-A','Cabang Uji A','KLINIK',true),
 ('{CAB['b']}','UJI-B','Cabang Uji B','BOTH',true),
 ('{CAB['c']}','UJI-C','Cabang Uji C','PETSHOP',true),
 ('{CAB['d']}','UJI-D','Cabang Uji D','KLINIK',true),
 ('{CAB['e']}','UJI-E','Hpy Pet Clinic Lengkong','KLINIK',true),
 ('{CAB['f']}','UJI-F','Cabang Uji F','KLINIK',false);
insert into public.user_branches(user_id, branch_id) values ('{U['staff']}','{CAB['a']}'),('{U['admin']}','{CAB['a']}');
insert into public.warehouses(id, branch_id, code, name, type, is_active) values
 ('{WH['a1']}','{CAB['a']}','UJI-WA1','Gudang Uji A1','RETAIL',true),
 ('{WH['a2']}','{CAB['a']}','UJI-WA2','Gudang Uji A2','VET',true),
 ('{WH['a3']}','{CAB['a']}','UJI-WA3','Gudang Uji A3','RETAIL',true),
 ('{WH['a4']}','{CAB['a']}','DC-UJI','Gudang Uji DC','DC',true),
 ('{WH['b1']}','{CAB['b']}','UJI-WB1','Gudang Uji B1','VET',true),
 ('{WH['b2']}','{CAB['b']}','UJI-WB2','Gudang Uji B2','RETAIL',true),
 ('{WH['e1']}','{CAB['e']}','VET_UJI-E','VET UJI E','VET',true),
 ('{WH['f1']}','{CAB['f']}','UJI-WF1','Gudang Uji F1','RETAIL',false),
 ('{WH['f2']}','{CAB['f']}','UJI-WF2','Gudang Uji F2','RETAIL',false);
-- A2 dipakai (satu baris stok qty 0), A3 berstok 5
select zz_test.plant('public.stock','{{warehouse_id,qty}}','{{''{WH['a2']}'',0}}'::text[]);
select zz_test.plant('public.stock','{{warehouse_id,qty}}','{{''{WH['a3']}'',5}}'::text[]);
-- cabang B punya transaksi (shift sudah ditutup); cabang C shift terbuka; cabang D kunjungan belum selesai
select zz_test.plant('public.cashier_shifts','{{branch_id,status}}','{{''{CAB['b']}'',''closed''}}'::text[]);
select zz_test.plant('public.cashier_shifts','{{branch_id,status}}','{{''{CAB['c']}'',''open''}}'::text[]);
select zz_test.plant('public.visits','{{branch_id,status}}','{{''{CAB['d']}'',''Menunggu''}}'::text[]);
"""


def sql_lit(v):
    return "'" + str(v).replace("'", "''") + "'"


class DB(NativePostgres):
    def sql_db(self, db, source):
        env = {**os.environ, "PSQLRC": "/dev/null"}
        r = subprocess.run(self.as_user + [self.psql, "-X", "-qAt", "-h", str(self.root), "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"],
                           input=source, text=True, capture_output=True, env=env)
        if r.returncode:
            raise RuntimeError(r.stderr + r.stdout)
        return r.stdout.strip()


class Galat(Exception):
    def __init__(self, kode, pesan):
        super().__init__(f"{kode}: {pesan}")
        self.kode, self.pesan = kode, pesan


def jalankan(pg, db, uid, sql, role="authenticated"):
    """Satu transaksi sebagai peran klien dengan klaim JWT; kembalikan keluaran baris terakhir atau lempar Galat(sqlstate, pesan)."""
    klaim = f"select set_config('request.jwt.claim.sub','{uid}',true);" if uid else ""
    try:
        out = pg.sql_db(db, f"begin; set local role {role}; {klaim} {sql} commit;")
    except RuntimeError as e:
        m = re.search(r"ERROR:\s+([0-9A-Z]{5}):\s+(.*)", str(e))
        raise Galat(m.group(1), m.group(2).strip()) if m else Galat("?????", str(e)[:300])
    return out.splitlines()[-1] if out else ""


def ditolak(kode, potongan, fn):
    try:
        fn()
    except Galat as g:
        assert g.kode == kode and potongan in g.pesan, f"diharapkan {kode} '{potongan}', dapat {g.kode}: {g.pesan}"
        return
    raise AssertionError(f"seharusnya ditolak ({kode} {potongan})")


def ubah_cabang(pg, db, uid, cab, nama, kode="null", aktif="null"):
    kd = "null" if kode == "null" else sql_lit(kode)
    return json.loads(jalankan(pg, db, uid, f"select public.update_branch_info({sql_lit(CAB.get(cab, cab))}, {sql_lit(nama)}, {kd}, {aktif})::text;"))


def ubah_gudang(pg, db, uid, wh, nama, kode="null", tipe="null", aktif="null"):
    kd = "null" if kode == "null" else sql_lit(kode)
    tp = "null" if tipe == "null" else sql_lit(tipe)
    return json.loads(jalankan(pg, db, uid, f"select public.update_warehouse_info({sql_lit(WH.get(wh, wh))}, {sql_lit(nama)}, {kd}, {tp}, {aktif})::text;"))


def hapus_gudang(pg, db, uid, wh, alasan):
    return json.loads(jalankan(pg, db, uid, f"select public.delete_warehouse({sql_lit(WH.get(wh, wh))}, {sql_lit(alasan)})::text;"))


EXTRA = {  # kolom penentu yang harus bernilai sah supaya baris contoh lolos CHECK atau terhitung "terbuka"
    "import_runs": [("kind", "initial_stock")], "inventory_adjustments": [("alasan", "rusak")], "stock_transfers": [("status", "Sedang dikirim")],
    "production_orders": [("output_item_id", "=gen_random_uuid()")], "stock_document_corrections": [("kind", "adjustment")],
    "wholesale_returns": [("customer_credit", "=0")],
}


def plant_sql(tabel, kolom, wid):
    kol, val = [kolom], [f"''{wid}''"]
    for k, v in EXTRA.get(tabel.split(".")[-1], []):
        kol.append(k); val.append(v[1:] if v.startswith("=") else f"''{v}''")
    return f"select zz_test.plant('{tabel}','{{{','.join(kol)}}}','{{{','.join(val)}}}'::text[]);"


def baca(pg, db, q):
    return pg.sql_db(db, q)


def jalankan_kasus(pg, db):
    hasil = []

    def kasus(nama):
        def dekor(fn):
            try:
                fn()
                hasil.append((nama, True, ""))
            except Exception as e:  # noqa: BLE001
                hasil.append((nama, False, str(e)[:3000]))
            return fn
        return dekor

    O, A, S, F = U["owner"], U["admin"], U["staff"], U["finance"]

    @kasus("A1 ubah cabang: STAFF, FINANCE, OWNER nonaktif, ADMIN nonaktif, tanpa sesi ditolak 42501")
    def _():
        for uid in (S, F, U["owner_off"], U["admin_off"], None):
            ditolak("42501", "OWNER/ADMIN", lambda uid=uid: ubah_cabang(pg, db, uid, "a", "Nama Baru Uji"))
        assert baca(pg, db, f"select name from public.branches where id='{CAB['a']}'") == "Cabang Uji A"

    @kasus("A2 ADMIN mengganti nama cabang: tersimpan rapi (spasi), jejak sebelum/sesudah, Log Aktifitas mencatat update oleh ADMIN")
    def _():
        h = ubah_cabang(pg, db, A, "e", "  Kamo  Pets Clinic   Lengkong ")
        assert h["changed"] is True and h["name"] == "Kamo Pets Clinic Lengkong", h
        assert baca(pg, db, f"select name||'|'||code||'|'||is_active from public.branches where id='{CAB['e']}'") == "Kamo Pets Clinic Lengkong|UJI-E|true"
        au = baca(pg, db, f"select (before_state->>'name')||'>'||(after_state->>'name')||'|'||actor_id from clinic_private.master_edit_audit where entity='branches' and entity_id='{CAB['e']}'")
        assert au == f"Hpy Pet Clinic Lengkong>Kamo Pets Clinic Lengkong|{A}", au
        n = baca(pg, db, f"select count(*) from public.activity_log where row_entity='branches' and row_id='{CAB['e']}' and action='update' and actor_id='{A}'")
        assert n == "1", n

    @kasus("A3 OWNER boleh mengganti nama cabang")
    def _():
        h = ubah_cabang(pg, db, O, "c", "Cabang Uji C Baru")
        assert h["name"] == "Cabang Uji C Baru"

    @kasus("B1 nama kembar (tanpa beda huruf besar/kecil, spasi ganda) ditolak 23505; huruf besar/kecil diri sendiri boleh")
    def _():
        ditolak("23505", "Nama cabang sudah dipakai", lambda: ubah_cabang(pg, db, A, "a", "CABANG   Uji b"))
        h = ubah_cabang(pg, db, A, "a", "cabang uji a")
        assert h["name"] == "cabang uji a"
        ubah_cabang(pg, db, A, "a", "Cabang Uji A")

    @kasus("B2 nama kosong, 1 karakter, 81 karakter, karakter kontrol ditolak 22023; 80 karakter boleh")
    def _():
        for nm in ("", "   ", "x", "x" * 81, "Uji\x01Kontrol"):
            ditolak("22023", "Nama cabang 2 sampai 80", lambda nm=nm: ubah_cabang(pg, db, A, "a", nm))
        assert len(ubah_cabang(pg, db, A, "a", "K" * 80)["name"]) == 80
        ubah_cabang(pg, db, A, "a", "Cabang Uji A")

    @kasus("B3 tanpa perubahan: changed=false, tidak ada baris jejak baru")
    def _():
        antes = baca(pg, db, "select count(*) from clinic_private.master_edit_audit")
        h = ubah_cabang(pg, db, A, "a", "Cabang Uji A")
        assert h["changed"] is False
        assert baca(pg, db, "select count(*) from clinic_private.master_edit_audit") == antes

    @kasus("C1 kode cabang tanpa transaksi boleh diganti; format salah 22023; kembar beda huruf 23505; cabang punya penugasan+gudang tetap boleh")
    def _():
        ditolak("22023", "Kode cabang 1 sampai 15", lambda: ubah_cabang(pg, db, A, "a", "Cabang Uji A", kode="BAD/CODE"))
        ditolak("22023", "Kode cabang 1 sampai 15", lambda: ubah_cabang(pg, db, A, "a", "Cabang Uji A", kode="ABCDEFGHIJKLMNOP"))
        ditolak("23505", "Kode cabang sudah dipakai", lambda: ubah_cabang(pg, db, A, "a", "Cabang Uji A", kode="uji-b"))
        h = ubah_cabang(pg, db, A, "a", "Cabang Uji A", kode="UJI-A2")
        assert h["code"] == "UJI-A2"
        ubah_cabang(pg, db, A, "a", "Cabang Uji A", kode="UJI-A")

    @kasus("C2 kode cabang terkunci (CG001) bila cabang sudah punya transaksi (shift tertutup), nama tetap boleh")
    def _():
        ditolak("CG001", "Kode cabang terkunci", lambda: ubah_cabang(pg, db, A, "b", "Cabang Uji B", kode="UJI-B2"))
        assert ubah_cabang(pg, db, A, "b", "Cabang Uji B Baru")["name"] == "Cabang Uji B Baru"
        ubah_cabang(pg, db, A, "b", "Cabang Uji B")
        assert baca(pg, db, f"select code from public.branches where id='{CAB['b']}'") == "UJI-B"

    @kasus("C3 kode yang sama (tanpa perubahan) pada cabang bertransaksi tidak ditolak")
    def _():
        assert ubah_cabang(pg, db, A, "b", "Cabang Uji B", kode="UJI-B")["changed"] is False

    @kasus("D1 nonaktifkan cabang ditolak bila ada shift kasir terbuka (CG001)")
    def _():
        ditolak("CG001", "shift kasir yang terbuka", lambda: ubah_cabang(pg, db, A, "c", "Cabang Uji C Baru", aktif="false"))

    @kasus("D2 nonaktifkan cabang ditolak bila ada kunjungan klinik belum selesai (CG001)")
    def _():
        ditolak("CG001", "kunjungan klinik yang belum selesai", lambda: ubah_cabang(pg, db, A, "d", "Cabang Uji D", aktif="false"))

    @kasus("D3 cabang tanpa shift terbuka/antrian boleh dinonaktifkan lalu diaktifkan lagi (shift tertutup tidak menghalangi)")
    def _():
        assert ubah_cabang(pg, db, A, "b", "Cabang Uji B", aktif="false")["is_active"] is False
        assert baca(pg, db, f"select is_active from public.branches where id='{CAB['b']}'") == "f"
        assert ubah_cabang(pg, db, O, "b", "Cabang Uji B", aktif="true")["is_active"] is True

    @kasus("D4 satu-satunya cabang aktif tidak boleh dinonaktifkan")
    def _():
        try:
            pg.sql_db(db, f"begin; update public.branches set is_active=false where id<>'{CAB['a']}';"
                          f" set local role authenticated; select set_config('request.jwt.claim.sub','{O}',true); select public.update_branch_info('{CAB['a']}','Cabang Uji A',null,false); commit;")
            raise AssertionError("seharusnya ditolak")
        except RuntimeError as e:
            assert "CG001" in str(e) and "satu-satunya cabang aktif" in str(e), str(e)[:300]

    @kasus("E1 penulisan langsung nama/kode/jenis/status cabang oleh akun login ditolak 42501 (juga OWNER); lat/lng/radius tetap bisa")
    def _():
        for uid in (S, A, O):
            for kol in ("name='X Langsung'", "code='XLANGSUNG'", "type='PETSHOP'", "is_active=false"):
                ditolak("42501", "hanya bisa diubah lewat menu", lambda uid=uid, kol=kol: jalankan(pg, db, uid, f"update public.branches set {kol} where id='{CAB['a']}'; select 1;"))
        jalankan(pg, db, A, f"update public.branches set lat=-6.6, lng=106.8, radius_m=300 where id='{CAB['a']}'; select 1;")
        assert baca(pg, db, f"select lat::float8||'|'||lng::float8||'|'||radius_m from public.branches where id='{CAB['a']}'") == "-6.6|106.8|300"

    @kasus("F1 ubah gudang: STAFF/FINANCE/nonaktif/tanpa sesi ditolak 42501")
    def _():
        for uid in (S, F, U["owner_off"], None):
            ditolak("42501", "OWNER/ADMIN", lambda uid=uid: ubah_gudang(pg, db, uid, "a1", "Nama Baru"))

    @kasus("F2 ADMIN mengganti nama gudang; kembar dalam cabang ditolak 23505; nama sama di cabang lain boleh; panjang 2..100")
    def _():
        assert ubah_gudang(pg, db, A, "a1", "Gudang Retail Baru")["name"] == "Gudang Retail Baru"
        ditolak("23505", "Nama gudang sudah dipakai", lambda: ubah_gudang(pg, db, A, "a1", "GUDANG Uji  a3"))
        assert ubah_gudang(pg, db, A, "a1", "Gudang Uji B2")["name"] == "Gudang Uji B2"   # sama dengan gudang cabang B: boleh
        ditolak("22023", "Nama gudang 2 sampai 100", lambda: ubah_gudang(pg, db, A, "a1", "x"))
        ditolak("22023", "Nama gudang 2 sampai 100", lambda: ubah_gudang(pg, db, A, "a1", "x" * 101))
        ubah_gudang(pg, db, A, "a1", "Gudang Uji A1")
        au = baca(pg, db, f"select count(*) from clinic_private.master_edit_audit where entity='warehouses' and entity_id='{WH['a1']}'")
        assert int(au) >= 2, au

    @kasus("F3 kode gudang: boleh bila belum dipakai; terkunci bila ada baris stok (walau qty 0) atau stok; format 22023; kembar beda huruf 23505")
    def _():
        assert ubah_gudang(pg, db, A, "a1", "Gudang Uji A1", kode="UJI-WA1X")["code"] == "UJI-WA1X"
        ubah_gudang(pg, db, A, "a1", "Gudang Uji A1", kode="UJI-WA1")
        ditolak("22023", "Kode gudang 1 sampai 20", lambda: ubah_gudang(pg, db, A, "a1", "Gudang Uji A1", kode="a/b"))
        ditolak("23505", "Kode gudang sudah dipakai", lambda: ubah_gudang(pg, db, A, "a1", "Gudang Uji A1", kode="uji-wb1"))
        ditolak("CG001", "Kode gudang terkunci", lambda: ubah_gudang(pg, db, A, "a2", "Gudang Uji A2", kode="UJI-WA2X"))
        ditolak("CG001", "Kode gudang terkunci", lambda: ubah_gudang(pg, db, A, "a3", "Gudang Uji A3", kode="UJI-WA3X"))
        assert baca(pg, db, f"select code from public.warehouses where id='{WH['a2']}'") == "UJI-WA2"

    @kasus("F4 awalan DC pada kode tidak boleh ditambah/dihapus (dipakai pemilih gudang distribusi)")
    def _():
        ditolak("22023", "Awalan DC", lambda: ubah_gudang(pg, db, A, "a4", "Gudang Uji DC", kode="XX-UJI"))
        ditolak("22023", "Awalan DC", lambda: ubah_gudang(pg, db, A, "a1", "Gudang Uji A1", kode="DC-BARU"))
        assert ubah_gudang(pg, db, A, "a4", "Gudang Uji DC", kode="DC-UJI2")["code"] == "DC-UJI2"
        ubah_gudang(pg, db, A, "a4", "Gudang Uji DC", kode="DC-UJI")

    @kasus("F5 jenis gudang: boleh bila belum dipakai; terkunci bila dipakai; jenis asing 22023")
    def _():
        assert ubah_gudang(pg, db, A, "a1", "Gudang Uji A1", tipe="EXPIRED")["type"] == "EXPIRED"
        ubah_gudang(pg, db, A, "a1", "Gudang Uji A1", tipe="RETAIL")
        ditolak("CG001", "Jenis gudang terkunci", lambda: ubah_gudang(pg, db, A, "a2", "Gudang Uji A2", tipe="RETAIL"))
        ditolak("22023", "Jenis gudang tidak dikenal", lambda: ubah_gudang(pg, db, A, "a1", "Gudang Uji A1", tipe="MOBIL"))

    @kasus("G1 nonaktifkan gudang: ditolak bila masih ada stok (CG001); stok 0 boleh")
    def _():
        ditolak("CG001", "masih punya stok", lambda: ubah_gudang(pg, db, A, "a3", "Gudang Uji A3", aktif="false"))
        assert ubah_gudang(pg, db, A, "a1", "Gudang Uji A1", aktif="false")["is_active"] is False
        assert ubah_gudang(pg, db, A, "a1", "Gudang Uji A1", aktif="true")["is_active"] is True

    @kasus("G2 nonaktifkan gudang ditolak bila ada transfer berjalan, permintaan terbuka, atau opname terbuka")
    def _():
        for tabel, kolom in (("stock_transfers", "from_warehouse_id"), ("stock_transfers", "to_warehouse_id"), ("stock_requests", "to_warehouse_id"),
                             ("stock_requests", "transit_warehouse_id"), ("opname_orders", "warehouse_id")):
            pg.sql_db(db, plant_sql(f"public.{tabel}", kolom, WH['a1']))
            try:
                ditolak("CG001", "dokumen yang belum selesai", lambda: ubah_gudang(pg, db, A, "a1", "Gudang Uji A1", aktif="false"))
            except AssertionError as e:
                pg.sql_db(db, f"update public.warehouses set is_active=true where id='{WH['a1']}';")
                raise AssertionError(f"{tabel}.{kolom}: {e}") from None
            pg.sql_db(db, f"begin; set local session_replication_role=replica; delete from public.{tabel} where {kolom}='{WH['a1']}'; commit;")
        assert ubah_gudang(pg, db, A, "a1", "Gudang Uji A1", aktif="false")["is_active"] is False
        ubah_gudang(pg, db, A, "a1", "Gudang Uji A1", aktif="true")

    @kasus("G3 satu-satunya gudang VET/RETAIL aktif di cabang aktif tidak boleh dinonaktifkan; cabang nonaktif boleh")
    def _():
        ditolak("CG001", "satu-satunya gudang", lambda: ubah_gudang(pg, db, A, "b1", "Gudang Uji B1", aktif="false"))
        ditolak("CG001", "satu-satunya gudang", lambda: ubah_gudang(pg, db, A, "e1", "VET UJI E", aktif="false"))
        # cabang F nonaktif: gudangnya sudah nonaktif; aktifkan satu butuh cabang aktif
        ditolak("CG001", "Aktifkan cabangnya dulu", lambda: ubah_gudang(pg, db, A, "f1", "Gudang Uji F1", aktif="true"))

    @kasus("G4 gudang boleh diaktifkan lagi setelah cabangnya diaktifkan")
    def _():
        ubah_cabang(pg, db, O, "f", "Cabang Uji F", aktif="true")
        assert ubah_gudang(pg, db, A, "f1", "Gudang Uji F1", aktif="true")["is_active"] is True
        assert ubah_gudang(pg, db, A, "f2", "Gudang Uji F2", aktif="true")["is_active"] is True
        ubah_gudang(pg, db, A, "f2", "Gudang Uji F2", aktif="false")

    @kasus("H1 hapus gudang: ADMIN, STAFF, FINANCE, OWNER nonaktif, tanpa sesi ditolak 42501; baris tetap ada")
    def _():
        for uid in (A, S, F, U["owner_off"], None):
            ditolak("42501", "Hanya OWNER aktif", lambda uid=uid: hapus_gudang(pg, db, uid, "f2", "Alasan uji hapus"))
        assert baca(pg, db, f"select count(*) from public.warehouses where id='{WH['f2']}'") == "1"

    @kasus("H2 hapus gudang oleh OWNER wajib alasan (5..300 karakter)")
    def _():
        for alasan in ("", "   ", "abcd", "x" * 301):
            ditolak("22023", "Alasan hapus wajib", lambda alasan=alasan: hapus_gudang(pg, db, O, "f2", alasan))
        assert baca(pg, db, f"select count(*) from public.warehouses where id='{WH['f2']}'") == "1"

    @kasus("H3 hapus ditolak (CG001 'Sudah dipakai, nonaktifkan saja') untuk SETIAP tabel yang menunjuk gudang; gudang dan baris rujukan utuh")
    def _():
        fks = baca(pg, db, "select c.oid::regclass::text||'.'||a.attname from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1] where k.contype='f' and k.confrelid='public.warehouses'::regclass order by 1").splitlines()
        assert len(fks) >= 26, len(fks)
        gagal = []
        for n, ref in enumerate(fks):
            tabel, kolom = ref.rsplit(".", 1)
            wid = f"c0000000-0000-4000-8000-{n:012d}"
            pg.sql_db(db, f"insert into public.warehouses(id,branch_id,code,name,type,is_active) values('{wid}','{CAB['a']}','ZZ{n}','Gudang Uji Ref {n}','RETAIL',true);")
            try:
                pg.sql_db(db, plant_sql(tabel, kolom, wid))
            except RuntimeError as e:
                gagal.append(f"{ref}: PLANT " + re.sub(r"\s+", " ", str(e))[:150])
                continue
            try:
                hapus_gudang(pg, db, O, wid, "Uji hapus gudang terpakai")
                gagal.append(ref + ": terhapus")
            except Galat as g:
                if g.kode != "CG001" or "Sudah dipakai, nonaktifkan saja" not in g.pesan:
                    gagal.append(f"{ref}: {g}")
            ada = baca(pg, db, f"select (select count(*) from public.warehouses where id='{wid}')||'|'||(select count(*) from {tabel} where {kolom}='{wid}')")
            if ada != "1|1":
                gagal.append(f"{ref}: baris hilang {ada}")
        assert not gagal, "\n" + "\n".join(gagal)

    @kasus("H4 hapus gudang yang tidak dipakai oleh OWNER berhasil; jejak hapus dengan alasan tersimpan; Log Aktifitas mencatat delete")
    def _():
        h = hapus_gudang(pg, db, O, "f2", "  Salah buat gudang  ")
        assert h["deleted"] is True
        assert baca(pg, db, f"select count(*) from public.warehouses where id='{WH['f2']}'") == "0"
        au = baca(pg, db, f"select action||'|'||reason||'|'||actor_id||'|'||(before_state->>'code') from clinic_private.master_edit_audit where entity_id='{WH['f2']}' and action='delete'")
        assert au == f"delete|Salah buat gudang|{O}|UJI-WF2", au
        n = baca(pg, db, f"select count(*) from public.activity_log where row_entity='warehouses' and row_id='{WH['f2']}' and action='delete'")
        assert n == "1", n
        ditolak("CG002", "Gudang tidak ditemukan", lambda: hapus_gudang(pg, db, O, "f2", "Alasan uji hapus"))

    @kasus("H5 DELETE langsung oleh akun login ditolak 42501 (tanpa pemicu ini stok ikut terhapus lewat CASCADE); stok utuh")
    def _():
        for uid in (S, A, O):
            ditolak("42501", "hanya bisa dihapus lewat menu", lambda uid=uid: jalankan(pg, db, uid, f"delete from public.warehouses where id='{WH['a3']}'; select 1;"))
        assert baca(pg, db, f"select (select count(*) from public.warehouses where id='{WH['a3']}')||'|'||(select count(*) from public.stock where warehouse_id='{WH['a3']}')") == "1|1"

    @kasus("H6 penulisan langsung nama/kode/jenis/status/cabang gudang ditolak 42501; INSERT gudang baru lewat form lama tetap jalan")
    def _():
        for uid in (S, A, O):
            for kol in ("name='X'", "code='XLANGSUNG'", "type='VET'", "is_active=false", f"branch_id='{CAB['b']}'"):
                ditolak("42501", "hanya bisa diubah lewat menu", lambda uid=uid, kol=kol: jalankan(pg, db, uid, f"update public.warehouses set {kol} where id='{WH['a1']}'; select 1;"))
        jalankan(pg, db, O, f"insert into public.warehouses(branch_id,code,name,type,is_active) values('{CAB['a']}','UJI-NEW','Gudang Baru Form Lama','RETAIL',true); select 1;")
        assert baca(pg, db, "select count(*) from public.warehouses where code='UJI-NEW'") == "1"
        pg.sql_db(db, "delete from public.warehouses where code='UJI-NEW';")

    @kasus("I1 hak eksekusi: authenticated boleh ke 5 fungsi baru, anon tidak; pembantu clinic_private tidak untuk authenticated")
    def _():
        fns = ["public.read_branch_usage()", "public.read_warehouse_usage()", "public.update_branch_info(uuid,text,text,boolean)",
               "public.update_warehouse_info(uuid,text,text,text,boolean)", "public.delete_warehouse(uuid,text)"]
        for f in fns:
            r = baca(pg, db, f"select has_function_privilege('authenticated','{f}','execute')||'|'||has_function_privilege('anon','{f}','execute')||'|'||has_function_privilege('service_role','{f}','execute')")
            assert r == "true|false|false", (f, r, baca(pg, db, f"select proacl::text from pg_proc where oid='{f}'::regprocedure"))
        for f in ("clinic_private.fk_referencing_tables('public.warehouses'::regclass,gen_random_uuid(),'{}')", "clinic_private.fk_usage_map('public.warehouses'::regclass,'{}')", "clinic_private.master_actor_role()"):
            ditolak("42501", "permission denied", lambda f=f: jalankan(pg, db, O, f"select {f}::text;"))
        acl = baca(pg, db, "select string_agg(proname||'='||coalesce(proacl::text,'NULL'), ';') from pg_proc where pronamespace='clinic_private'::regnamespace and proname in ('fk_referencing_tables','fk_usage_map','master_actor_role','branch_config_tables')")
        assert "NULL" not in acl and "authenticated" not in acl and "anon" not in acl and not re.search(r"[{,;]=", acl), acl  # NULL = hak bawaan PUBLIC
        assert baca(pg, db, "select has_table_privilege('authenticated','clinic_private.master_edit_audit','select')::text||has_table_privilege('anon','clinic_private.master_edit_audit','insert')::text") == "falsefalse"

    @kasus("I2 anon tidak bisa memanggil (permission denied)")
    def _():
        try:
            jalankan(pg, db, None, f"select public.delete_warehouse('{WH['a1']}','Alasan uji hapus');", role="anon")
            raise AssertionError("anon seharusnya ditolak")
        except Galat as g:
            assert "permission denied" in g.pesan, g

    @kasus("J1 fungsi SECURITY DEFINER dengan search_path kosong; pemicu penjaga terpasang")
    def _():
        r = baca(pg, db, "select string_agg(proname||':'||prosecdef||':'||coalesce(array_to_string(proconfig,','),''), ';' order by proname) from pg_proc where proname in ('update_branch_info','update_warehouse_info','delete_warehouse','read_branch_usage','read_warehouse_usage')")
        assert r == ('delete_warehouse:true:search_path=""' + ';read_branch_usage:true:search_path=""' + ';read_warehouse_usage:true:search_path=""'
                     + ';update_branch_info:true:search_path=""' + ';update_warehouse_info:true:search_path=""'), r
        t = baca(pg, db, "select string_agg(tgname,',' order by tgname) from pg_trigger where tgname like 'a00_guard_%' and not tgisinternal")
        assert t == "a00_guard_branch_direct_edit,a00_guard_warehouse_direct_delete,a00_guard_warehouse_direct_edit", t

    @kasus("K1 pembaca pemakaian: OWNER/ADMIN dapat peta; STAFF ditolak; kolom pemakaian benar (cabang tanpa transaksi tidak muncul)")
    def _():
        ditolak("42501", "OWNER/ADMIN", lambda: jalankan(pg, db, S, "select public.read_branch_usage()::text;"))
        ditolak("42501", "OWNER/ADMIN", lambda: jalankan(pg, db, S, "select public.read_warehouse_usage()::text;"))
        bm = json.loads(jalankan(pg, db, A, "select public.read_branch_usage()::text;"))
        assert CAB["b"] in bm and "public.cashier_shifts" in bm[CAB["b"]], bm.get(CAB["b"])
        assert CAB["a"] not in bm and CAB["e"] not in bm, [k for k in bm if k in (CAB["a"], CAB["e"])]
        assert "public.user_branches" not in str(bm) and "public.warehouses" not in str(bm)
        wm = json.loads(jalankan(pg, db, O, "select public.read_warehouse_usage()::text;"))
        assert "public.stock" in wm[WH["a2"]] and "public.stock" in wm[WH["a3"]] and WH["e1"] not in wm and WH["a4"] not in wm

    @kasus("L1 skenario Lengkong: cabang & gudang tanpa transaksi, nama diperbaiki oleh ADMIN, kode tetap, jenis tetap, gudang tetap terhubung")
    def _():
        assert baca(pg, db, f"select name||'|'||code||'|'||type from public.branches where id='{CAB['e']}'") == "Kamo Pets Clinic Lengkong|UJI-E|KLINIK"
        assert baca(pg, db, f"select count(*) from public.warehouses where branch_id='{CAB['e']}' and id='{WH['e1']}'") == "1"

    return hasil


def digest(pg, db):
    return pg.sql_db(db, """select md5(string_agg(x, '|' order by x)) from (
      select p.oid::regprocedure::text||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,'') as x from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname in ('public','clinic_private','role_settings_private') and p.prokind='f'
         and p.proname not in ('read_branch_usage','read_warehouse_usage','update_branch_info','update_warehouse_info','delete_warehouse','guard_branch_direct_edit','guard_warehouse_direct_edit','guard_warehouse_direct_delete','master_actor_role','fk_referencing_tables','fk_usage_map','branch_config_tables')
      union all select 'pol:'||schemaname||tablename||policyname||coalesce(qual,'')||coalesce(with_check,'') from pg_policies where schemaname in ('public','clinic_private','role_settings_private')
      union all select 'col:'||table_schema||table_name||column_name||data_type from information_schema.columns where table_schema in ('public','role_settings_private') 
      union all select 'trg:'||tgrelid::regclass::text||tgname from pg_trigger where not tgisinternal and tgname not like 'a00_guard_%'
      union all select 'con:'||conrelid::regclass::text||conname||pg_get_constraintdef(oid) from pg_constraint where connamespace in ('public'::regnamespace,'role_settings_private'::regnamespace)) s;""")


def pasang(pg, db, teks):
    pg.sql_db(db, "begin;\n" + teks + "\ncommit;")


ANCHORS = {  # nama mutan: (teks lama, teks baru); teks lama harus muncul TEPAT sekali
    "ubah_cabang_tanpa_cek_peran": ("  if v_role is null or v_role not in ('OWNER', 'ADMIN') then\n    raise exception 'Hanya OWNER/ADMIN aktif yang dapat mengubah cabang'", "  if false then\n    raise exception 'Hanya OWNER/ADMIN aktif yang dapat mengubah cabang'"),
    "ubah_gudang_tanpa_cek_peran": ("  if v_role is null or v_role not in ('OWNER', 'ADMIN') then\n    raise exception 'Hanya OWNER/ADMIN aktif yang dapat mengubah gudang'", "  if false then\n    raise exception 'Hanya OWNER/ADMIN aktif yang dapat mengubah gudang'"),
    "admin_boleh_hapus_gudang": ("if v_role is distinct from 'OWNER' then", "if v_role is null or v_role not in ('OWNER', 'ADMIN') then"),
    "hapus_tanpa_cek_pemakaian": ("  if cardinality(v_used) > 0 then\n    raise exception 'Sudah dipakai, nonaktifkan saja'", "  if false then\n    raise exception 'Sudah dipakai, nonaktifkan saja'"),
    "hapus_tanpa_alasan": ("length(v_reason) not between 5 and 300", "length(v_reason) not between 0 and 300"),
    "nama_cabang_kembar_peka_huruf": ("= lower(v_name)) then\n      raise exception 'Nama cabang sudah", "= v_name) then\n      raise exception 'Nama cabang sudah"),
    "nama_gudang_kembar_peka_huruf": ("= lower(v_name)) then\n      raise exception 'Nama gudang sudah", "= v_name) then\n      raise exception 'Nama gudang sudah"),
    "nama_cabang_batas_80_jadi_800": ("length(v_name) not between 2 and 80", "length(v_name) not between 2 and 800"),
    "kode_cabang_tanpa_kunci_transaksi": ("    if cardinality(clinic_private.fk_referencing_tables('public.branches'::regclass, b.id, clinic_private.branch_config_tables())) > 0 then", "    if false then"),
    "kode_cabang_kunci_hitung_penugasan": ("array['public.user_branches','public.warehouses',", "array["),
    "kode_gudang_tanpa_kunci_pemakaian": ("      if v_used then\n        raise exception 'Kode gudang terkunci", "      if false then\n        raise exception 'Kode gudang terkunci"),
    "jenis_gudang_tanpa_kunci_pemakaian": ("      if v_used then\n        raise exception 'Jenis gudang terkunci", "      if false then\n        raise exception 'Jenis gudang terkunci"),
    "awalan_dc_dibiarkan": ("      if (lower(v_code) like 'dc%') is distinct from (lower(w.code) like 'dc%') then", "      if false then"),
    "nonaktif_cabang_tanpa_cek_shift": ("    if v_n > 0 then\n      raise exception 'Cabang masih punya % shift kasir", "    if false then\n      raise exception 'Cabang masih punya % shift kasir"),
    "nonaktif_cabang_tanpa_cek_kunjungan": ("    if v_n > 0 then\n      raise exception 'Cabang masih punya % kunjungan", "    if false then\n      raise exception 'Cabang masih punya % kunjungan"),
    "nonaktif_cabang_terakhir_boleh": ("    if not exists (select 1 from public.branches x where x.id <> b.id and x.is_active) then", "    if false then"),
    "nonaktif_gudang_tanpa_cek_stok": ("      if v_n > 0 then\n        raise exception 'Gudang masih punya stok", "      if false then\n        raise exception 'Gudang masih punya stok"),
    "nonaktif_gudang_tanpa_cek_dokumen": ("      if v_n > 0 then\n        raise exception 'Gudang masih dipakai", "      if false then\n        raise exception 'Gudang masih dipakai"),
    "nonaktif_gudang_terakhir_boleh": ("      if v_branch_active and w.type::text in ('VET', 'RETAIL') and not exists (", "      if false and not exists ("),
    "aktifkan_gudang_di_cabang_mati": ("      if not v_branch_active then\n        raise exception 'Cabang gudang ini nonaktif", "      if false then\n        raise exception 'Cabang gudang ini nonaktif"),
    "nama_gudang_kembar_lintas_cabang": ("where x.id <> w.id and x.branch_id = w.branch_id\n                and lower(", "where x.id <> w.id\n                and lower("),
    "pindai_katalog_lewati_stok": ("    if v_hit and not (r.tbl = any (v)) then v := v || r.tbl; end if;", "    if v_hit and r.tbl <> 'public.stock' and not (r.tbl = any (v)) then v := v || r.tbl; end if;"),
    "pemicu_cabang_langsung_dibuka": ("  if current_user in ('authenticated', 'anon')\n     and (new.id is distinct from old.id or new.name is distinct from old.name or new.code", "  if false\n     and (new.id is distinct from old.id or new.name is distinct from old.name or new.code"),
    "pemicu_gudang_edit_langsung_dibuka": ("  if current_user in ('authenticated', 'anon')\n     and (new.id is distinct from old.id or new.branch_id", "  if false\n     and (new.id is distinct from old.id or new.branch_id"),
    "pemicu_gudang_hapus_langsung_dibuka": ("  if current_user in ('authenticated', 'anon') then\n    raise exception 'Gudang hanya bisa dihapus", "  if false then\n    raise exception 'Gudang hanya bisa dihapus"),
    "anon_boleh_hapus_gudang": ("grant execute on function public.delete_warehouse(uuid, text) to authenticated;", "grant execute on function public.delete_warehouse(uuid, text) to authenticated, anon;"),
    "pembantu_tanpa_cabut_hak": ("revoke all on function clinic_private.master_actor_role() from public, anon, authenticated, service_role;\n", ""),
    "pembaca_pemakaian_tanpa_cek_peran": ("raise exception 'Hanya OWNER/ADMIN aktif yang dapat melihat pemakaian cabang' using errcode = '42501';", "null;"),
    "jejak_hapus_tanpa_alasan": ("            null, v_reason, auth.uid());", "            null, null, auth.uid());"),
    "ubah_tanpa_perubahan_tetap_menulis": ("  if v_name is not distinct from b.name and (v_code is null or v_code is not distinct from b.code)\n     and (p_is_active is null or p_is_active is not distinct from b.is_active) then", "  if false then"),
}


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

        if args.baseline:
            hasil = jalankan_kasus(pg, "postgres")
            gagal = [h for h in hasil if not h[1]]
            for n, ok, _ in hasil:
                print(("PASS " if ok else "FAIL ") + n, flush=True)
            laporan.update(total=len(hasil), gagal=len(gagal), kasus=[dict(nama=n, lulus=ok) for n, ok, _ in hasil])
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
            pasang(pg, "postgres", asli)  # pasang kedua: idempoten
            sesudah = digest(pg, "postgres")
            ok_digest = sebelum == sesudah
            print(("PASS " if ok_digest else "FAIL ") + "M1 fungsi/kebijakan/kolom/pemicu/constraint lain tidak berubah (sidik sama sebelum-sesudah)", flush=True)
            print("PASS M2 pasang dua kali lolos (idempoten)", flush=True)
            laporan.update(total=len(hasil) + 2, gagal=len(gagal) + (0 if ok_digest else 1), kasus=[dict(nama=n, lulus=ok, rinci=r) for n, ok, r in hasil])
            assert not gagal and ok_digest
            print(f"GREEN: {len(hasil) + 2} kasus lulus", flush=True)
    if args.json:
        Path(args.json).write_text(json.dumps(laporan, indent=1, ensure_ascii=False))
    print("SELESAI", flush=True)


if __name__ == "__main__":
    main()
