#!/usr/bin/env python3
"""Uji migrasi 20261203100000 (laporan_stok_analisis: parameter p_gudang_daftar untuk "Semua petshop" / "Semua klinik")
di PostgreSQL sungguhan, data fiktif.

Dasar: skema penuh repo (semua migrasi KECUALI migrasi ini; fungsi 20261128100000 terpasang), data fiktif suite
test-stok-slow-order-postgres.py + satu gudang klinik (WC), hasil fungsi LAMA dipotret, lalu migrasi dipasang.
Mode:
  (default)    GREEN  - semua kasus lulus (+ regresi: panggilan lama = hasil lama, sidik objek lain tidak berubah)
  --baseline   RED    - tanpa migrasi; kasus perilaku-baru harus GAGAL
  --mutants    kloning database per mutan; tiap mutan gagal di >= 1 kasus, kontrol 0 gagal
  --json FILE  tulis hasil
Jalankan dengan: python3 -I scripts/test-stok-grup-gudang-postgres.py --pg-bin /usr/lib/postgresql/16/bin
Tidak pernah terhubung ke Production: klaster lokal sekali pakai, socket unix, dibuang di akhir.
"""
import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))


def _muat(nama, berkas):
    spec = importlib.util.spec_from_file_location(nama, ROOT / "scripts" / berkas)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


hris = _muat("hris", "test-hris-cabang-postgres.py")
dasar = _muat("stok_dasar", "test-stok-slow-order-postgres.py")  # fixture + pembantu (DB, call, baris)

MIGRATIONS = ROOT / "supabase/migrations"
MIGRASI = MIGRATIONS / "20261203100000_stok_grup_gudang.sql"
HARI, FN = dasar.HARI, dasar.FN
WA, WB, ITEM, U_OWNER, U_STAFF, d = dasar.WA, dasar.WB, dasar.ITEM, dasar.U_OWNER, dasar.U_STAFF, dasar.d
CAB_C = "c0000000-0000-4000-8000-00000000000c"
WC = "11111111-0000-4000-8000-00000000000c"
SIG_LAMA = f"{FN}(uuid,integer,date)"
SIG_BARU = f"{FN}(uuid,integer,date,uuid[])"

# Gudang klinik C (cabang lain): stok + penjualan barang laku sendiri, supaya kelompok WA+WB terbukti TIDAK ikut menghitung C.
FIXTURE_C = f"""
insert into public.branches(id, code, name, type, is_active) values ('{CAB_C}','UJI-C','Klinik Uji C','KLINIK',true);
begin;
set local session_replication_role = replica;
insert into public.warehouses(id, branch_id, code, name, type, is_active) values ('{WC}','{CAB_C}','UJI-WC','Gudang Klinik C','VET',true);
insert into public.stock_layers(warehouse_id, item_id, tanggal, qty_in, qty_left, unit_cost, source, source_ref) values
  ('{WC}','{ITEM['sold']}',{d(15)},7,7,2000,'purchase','x');
insert into public.stock(warehouse_id, item_id, qty) values ('{WC}','{ITEM['sold']}',7);
insert into public.stock_moves(tanggal, warehouse_id, item_id, qty, unit_cost, source, source_ref) values
  ({d(0)},'{WC}','{ITEM['sold']}',-2,2000,'klinik-bmhp','kc1');
commit;
"""

ANCHORS = {  # nama mutan: (teks lama, teks baru) - tiap teks lama harus muncul TEPAT sekali di migrasi
    "daftar_diabaikan": ("       and (p_gudang_daftar is null or w.id = any (p_gudang_daftar))\n", ""),
    "daftar_dibalik": ("w.id = any (p_gudang_daftar)", "not (w.id = any (p_gudang_daftar))"),
    "satu_gudang_diabaikan": ("     where (p_gudang is null or w.id = p_gudang)\n       and", "     where"),
    "gabung_pakai_or": ("     where (p_gudang is null or w.id = p_gudang)\n       and (p_gudang_daftar", "     where (p_gudang is null or w.id = p_gudang)\n       or (p_gudang_daftar"),
    "tanda_tangan_lama_tetap": ("drop function if exists public.laporan_stok_analisis(uuid, integer, date);\n", ""),
    "anon_boleh": ("revoke all on function public.laporan_stok_analisis(uuid, integer, date, uuid[]) from public, anon;\n", ""),
    "jadi_definer": ("security invoker", "security definer"),
    "tanpa_meta_daftar": ("    'gudang_daftar', to_jsonb(p_gudang_daftar),\n", ""),
    "terakhir_semua_gudang": ("         and m.warehouse_id in (select id from gud)\n", ""),
}


def arr(*ids):
    return "array[" + ",".join(f"'{i}'" for i in ids) + "]::uuid[]"


def potret_lama(pg, db):
    ow = lambda a: dasar.call(pg, db, a, uid=U_OWNER)  # noqa: E731
    return {
        "all": ow(f"null, 90, '{HARI}'"), "wa": ow(f"'{WA}', 90, '{HARI}'"), "wb": ow(f"'{WB}', 90, '{HARI}'"), "wc": ow(f"'{WC}', 90, '{HARI}'"),
        "staff": dasar.call(pg, db, f"null, 90, '{HARI}'", uid=U_STAFF),
    }


def tanpa_meta_baru(h):
    return {k: v for k, v in h.items() if k != "gudang_daftar"}


def jalankan_kasus(pg, db, lama):
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

    pakai = lambda args="", **kw: dasar.call(pg, db, args, uid=U_OWNER, **kw)  # noqa: E731

    def sama(a, b, pesan=""):
        if float(a) != float(b):
            raise AssertionError(f"{pesan} {a!r} != {b!r}")

    @kasus("R1 regresi: panggilan lama (semua / satu gudang / staf cabang) memberi hasil yang PERSIS sama dengan fungsi lama")
    def _():
        baru = potret_lama(pg, db)
        for k in lama:
            assert tanpa_meta_baru(baru[k]) == lama[k], k

    @kasus("R2 panggilan bernama ala aplikasi lama (p_gudang, p_jendela_hari) tetap jalan")
    def _():
        h = pakai(f"p_gudang => null, p_jendela_hari => 90, p_hari_ini => '{HARI}'")
        assert tanpa_meta_baru(h) == lama["all"]

    @kasus("N1 kelompok WA+WB (toko): stok, nilai, pemakaian, modal = jumlah WA + WB; gudang klinik C tidak ikut")
    def _():
        h = pakai(f"p_jendela_hari => 90, p_hari_ini => '{HARI}', p_gudang_daftar => {arr(WA, WB)}")
        r = dasar.baris(h)["UJ-SOLD"]
        sama(r["stok"], 60, "stok"); sama(r["nilai"], 64000, "nilai"); sama(r["keluar"], 30, "keluar"); sama(r["modal_keluar"], 30500, "modal")
        assert r["terakhir"] == "2026-11-11", r["terakhir"]
        semua = dasar.baris(lama["all"])["UJ-SOLD"]
        sama(semua["stok"], 67, "semua gudang termasuk C"); sama(semua["keluar"], 32, "semua gudang termasuk C")

    @kasus("N2 kelompok satu gudang [WA] = hasil satu gudang WA (baris sama persis)")
    def _():
        h = pakai(f"p_jendela_hari => 90, p_hari_ini => '{HARI}', p_gudang_daftar => {arr(WA)}")
        assert h["baris"] == lama["wa"]["baris"]

    @kasus("N3 kelompok klinik [WC]: hanya stok/penjualan C; terakhir keluar = tanggal penjualan C")
    def _():
        h = pakai(f"p_jendela_hari => 90, p_hari_ini => '{HARI}', p_gudang_daftar => {arr(WC)}")
        r = dasar.baris(h)["UJ-SOLD"]
        sama(r["stok"], 7); sama(r["nilai"], 14000); sama(r["keluar"], 2); sama(r["modal_keluar"], 4000)
        assert r["terakhir"] == HARI, r["terakhir"]
        assert h["baris"] == lama["wc"]["baris"]

    @kasus("N4 meta: gudang_daftar ikut dikembalikan; awal riwayat tetap global")
    def _():
        h = pakai(f"p_jendela_hari => 90, p_hari_ini => '{HARI}', p_gudang_daftar => {arr(WC)}")
        assert h["gudang_daftar"] == [WC] and h["gudang_id"] is None, (h["gudang_daftar"], h["gudang_id"])
        assert h["riwayat_mulai"] == lama["all"]["riwayat_mulai"] and h["riwayat_hari"] == lama["all"]["riwayat_hari"]

    @kasus("N5 daftar kosong = tidak ada gudang (stok/pemakaian nol), bukan semua gudang")
    def _():
        h = pakai(f"p_jendela_hari => 90, p_hari_ini => '{HARI}', p_gudang_daftar => '{{}}'::uuid[]")
        for r in h["baris"]:
            sama(r["stok"], 0, r["kode"]); sama(r["keluar"], 0, r["kode"]); sama(r["nilai"], 0, r["kode"])

    @kasus("N6 satu gudang + daftar sekaligus: keduanya harus cocok (WA dan [WB] = kosong)")
    def _():
        h = pakai(f"p_gudang => '{WA}', p_jendela_hari => 90, p_hari_ini => '{HARI}', p_gudang_daftar => {arr(WB)}")
        assert "UJ-SOLD" not in dasar.baris(h), "WA ∩ [WB] seharusnya tidak punya stok/pemakaian"

    @kasus("S1 hak cabang tetap berlaku: STAFF cabang A dengan daftar [WA,WB,WC] hanya melihat WA")
    def _():
        h = dasar.call(pg, db, f"p_jendela_hari => 90, p_hari_ini => '{HARI}', p_gudang_daftar => {arr(WA, WB, WC)}", uid=U_STAFF)
        r = dasar.baris(h)["UJ-SOLD"]
        sama(r["stok"], 50); sama(r["keluar"], 19)

    @kasus("S2 wajib login: tanpa sesi ditolak")
    def _():
        try:
            pg.sql_db(db, f"begin; set local role authenticated; select {FN}(p_gudang_daftar => {arr(WA)}); commit;")
            raise AssertionError("tanpa sesi seharusnya ditolak")
        except RuntimeError as e:
            assert "LOGIN_DIPERLUKAN" in str(e), str(e)[:200]

    @kasus("S3 satu fungsi saja (tanda tangan baru), STABLE + SECURITY INVOKER + search_path kosong; authenticated boleh, anon/public tidak")
    def _():
        r = pg.sql_db(db, f"select (select count(*) from pg_proc where proname='laporan_stok_analisis')::text||'|'||provolatile::text||'|'||prosecdef::text"
                          f"||'|'||coalesce(array_to_string(proconfig,','),'')||'|'||has_function_privilege('authenticated',oid,'execute')::text"
                          f"||'|'||has_function_privilege('anon',oid,'execute')::text||'|'||coalesce(proacl::text,'') from pg_proc where oid='{SIG_BARU}'::regprocedure;")
        bagian = r.split("|")
        assert bagian[:6] == ["1", "s", "false", 'search_path=""', "true", "false"], r
        assert "=X/" not in bagian[6].replace("authenticated=X/", "").replace("service_role=X/", "").replace("postgres=X/", ""), r

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
    ap.add_argument("--json", default="")
    args = ap.parse_args()
    asli = MIGRASI.read_text()
    laporan: dict = {"mode": "baseline" if args.baseline else "mutants" if args.mutants else "green"}
    with dasar.DB(args.pg_bin) as pg:
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
        pg.sql(dasar.FIXTURE)
        pg.sql(FIXTURE_C)
        sebelum = digest(pg, "postgres")
        lama = potret_lama(pg, "postgres")

        if args.baseline:
            hasil = jalankan_kasus(pg, "postgres", lama)
            gagal = [h for h in hasil if not h[1]]
            for n, ok, _ in hasil:
                print(("PASS " if ok else "FAIL ") + n, flush=True)
            laporan.update(total=len(hasil), gagal=len(gagal), gagal_nama=[g[0] for g in gagal])
            print(f"RED: {len(gagal)}/{len(hasil)} kasus gagal tanpa migrasi", flush=True)
        elif args.mutants:
            pg.sql("select pg_terminate_backend(pid) from pg_stat_activity where datname='postgres' and pid<>pg_backend_pid();")
            varian = [("kontrol", asli)]
            for nama, (lama_t, baru_t) in ANCHORS.items():
                assert asli.count(lama_t) == 1, f"jangkar mutan {nama} muncul {asli.count(lama_t)}x"
                varian.append((nama, asli.replace(lama_t, baru_t)))
            hasil_mutan = {}
            for i, (nama, teks) in enumerate(varian):
                db = f"v_{i}"
                pg.sql(f"create database {db} template postgres;")
                try:
                    try:
                        pasang(pg, db, teks)
                    except RuntimeError as e:
                        hasil_mutan[nama] = {"gagal": ["PASANG: " + str(e)[:200]], "crash": True}
                        print(f"{'KONTROL RUSAK' if nama == 'kontrol' else 'MATI(pasang)'} {nama}", flush=True)
                        continue
                    h = jalankan_kasus(pg, db, lama)
                    gagal = [x[0] for x in h if not x[1]]
                    hasil_mutan[nama] = {"gagal": gagal}
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
            hasil = jalankan_kasus(pg, "postgres", lama)
            for n, ok, rinci in hasil:
                print(("PASS " if ok else "FAIL ") + n + ("" if ok else f"  [{rinci}]"), flush=True)
            gagal = [h for h in hasil if not h[1]]
            pasang(pg, "postgres", asli)  # pasang kedua kali: idempoten
            ok_digest = sebelum == digest(pg, "postgres")
            print(("PASS " if ok_digest else "FAIL ") + "M1 tidak ada fungsi/kebijakan/kolom/pemicu lain yang berubah (sidik sama sebelum-sesudah)", flush=True)
            print("PASS M2 pasang dua kali lolos (idempoten)", flush=True)
            # Batal: drop tanda tangan baru + pasang lagi 20261128100000 => hasil kembali sama dengan fungsi lama.
            pasang(pg, "postgres", f"drop function {SIG_BARU};\n" + (MIGRATIONS / "20261128100000_stok_pakai_bersih.sql").read_text())
            ok_rb = potret_lama(pg, "postgres") == lama
            print(("PASS " if ok_rb else "FAIL ") + "M3 langkah batal mengembalikan fungsi lama (hasil sama dengan potret sebelum migrasi)", flush=True)
            laporan.update(total=len(hasil) + 3, gagal=len(gagal) + (0 if ok_digest else 1) + (0 if ok_rb else 1))
            assert not gagal and ok_digest and ok_rb
            print(f"GREEN: {len(hasil) + 3} kasus lulus", flush=True)
    if args.json:
        Path(args.json).write_text(json.dumps(laporan, indent=1, ensure_ascii=False))
    print("SELESAI", flush=True)


if __name__ == "__main__":
    main()
