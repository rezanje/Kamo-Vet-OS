#!/usr/bin/env python3
"""Migrasi kartu medis (runner) — integrasi di PostgreSQL sekali pakai, data fiktif.

Rantai migrasi repo TERKINI (termasuk 20261101120000 D1/D2/RS-1, 20261104010000 RS-2, dan migrasi ranap/promo yang lebih baru)
dipasang di cluster lokal; eksekutor ASLI (TypeScript, ditranspilasi) memanggil RPC yang sama lewat adaptor `psql` yang meniru
PostgREST (scripts/test-migrasi-kartu-medis-node.mjs). Bukti ini hanya untuk DB SINTETIS — bukan bukti PostgREST/auth/jaringan
hosted. Tidak menerima URL database, tidak pernah terhubung ke Production.

Invarian sebelum/sesudah: tabel keuangan/stok/resep tidak berubah, riwayat migrasi tanpa cabang + tepat satu rekam medis,
D2 menolak ubah langsung, katalog (kebijakan + fungsi impor) tidak berubah.

Usage: python3 scripts/test-migrasi-kartu-medis-postgres.py --pg-bin DIR [--json OUT]
"""
from pathlib import Path
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('rs2', ROOT / 'scripts/test-riwayat-bersama-hewan-postgres.py')
rs2 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rs2)
rls = rs2.rls
record = rls.record

FINANSIAL = r"(sale|invoice|payment|stock|journal|prescription|compound|inventory|ledger|cash|kas|deposit|refund|voucher|quest)"
KATALOG = """select md5(concat_ws('#',
 (select string_agg(pol.polrelid::regclass::text||pol.polname||coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),''), E'\\n' order by pol.polrelid::regclass::text, pol.polname)
    from pg_policy pol join pg_class c on c.oid=pol.polrelid where c.relnamespace='public'::regnamespace),
 (select string_agg(p.oid::regprocedure::text||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,''), ',' order by p.oid::regprocedure::text)
    from pg_proc p where p.pronamespace='kamo_import'::regnamespace or p.proname like 'import_legacy%' or p.proname in ('riwayat_bersama_hewan','detail_riwayat_bersama','hasil_impor_rekam_medis'))))"""


def hitung_finansial(d):
    tabel = d.sql(f"select string_agg(c.relname, ',' order by c.relname) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname ~ '{FINANSIAL}'").split(',')
    tabel = [t for t in tabel if t]
    if not tabel:
        return {}
    union = ' union all '.join(f"select '{t}' t, count(*) n from public.{t}" for t in tabel)
    return {row.split('|')[0]: int(row.split('|')[1]) for row in d.sql(f"select t||'|'||n from ({union}) x order by t").splitlines()}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--pg-bin', required=True)
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT / 'scripts'))
    from native_postgres import NativePostgres
    with NativePostgres(args.pg_bin) as db:
        rls.fresh_without_new(args.pg_bin, db)
        ok, msg, _ = rls.apply_new(db)
        record('Prasyarat: 20261101120000 terpasang', ok, msg[:120] if not ok else 'ok')
        ok, msg = rs2.apply_sql(db, rs2.RS2.read_text())
        record('Prasyarat: 20261104010000 (RS-2) terpasang', ok, msg[:120] if not ok else 'ok')
        d = rls.Db(db)
        terbaru = sorted(p.name for p in (ROOT / 'supabase/migrations').glob('*.sql'))[-1]
        ada = d.last("select (to_regproc('public.clinic_bill_and_pay_inpatient') is not null"
                     " and to_regproc('public.nonaktifkan_promo_kadaluarsa') is not null"
                     " and to_regproc('public.set_employee_primary_branches') is not null)::text")
        record('Rantai migrasi repo terkini terpasang (objek 20261104040000 + 050000 + 060000 ada)', ada == 'true', terbaru)
        h = rls.base.Harness(db, None)
        rls.base.bootstrap_fixture(h)
        rls.bootstrap(d)

        katalog_awal = d.last(KATALOG)
        finansial_awal = hitung_finansial(d)
        cfg = {
            'psql': db.as_user + [str(db.psql), '-h', str(db.root), '-U', 'postgres', '-d', 'postgres'],
            'aktor': {'OWNER': rls.OWNER, 'ADMIN': rls.ADMIN, 'DOCTOR': rls.DOCTOR, 'OWNER_OFF': rls.OWNER_OFF},
            'cabang': {'A': rls.BR_A, 'C': rls.BR_C},
        }
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
            json.dump(cfg, f)
            cfg_path = f.name
        os.chmod(cfg_path, 0o644)
        r = subprocess.run(['node', str(ROOT / 'scripts/test-migrasi-kartu-medis-node.mjs'), cfg_path], cwd=ROOT, capture_output=True, text=True, timeout=1500)
        os.unlink(cfg_path)
        baris = [l for l in r.stdout.splitlines() if l.startswith('{')]
        if not baris:
            record('Harness Node berjalan', False, (r.stderr or r.stdout)[-400:])
        for l in baris:
            item = json.loads(l)
            record(f"Runner: {item['kasus']}", item['ok'], item['detail'])

        # Invarian sesudah.
        record('Tidak ada efek keuangan/stok/resep (hitungan tabel sama persis)', hitung_finansial(d) == finansial_awal, json.dumps(finansial_awal)[:200])
        record('Katalog kebijakan + fungsi impor tidak berubah', d.last(KATALOG) == katalog_awal, 'md5 equal')
        cek = d.last("""select json_build_object(
          'visits', count(*),
          'bercabang', count(*) filter (where v.branch_id is not null),
          'mr_bukan_satu', count(*) filter (where (select count(*) from public.medical_records m where m.visit_id=v.id) <> 1),
          'resep', (select count(*) from public.prescription_items p join public.medical_records m on m.id=p.medical_record_id join public.visits x on x.id=m.visit_id
                    where x.legacy_source_key ~ '(^uji pemilik::|^R[45]\\.xlsx|^putus-|^atom-|^baris-1|^cabang\\.xlsx)'))
          from public.visits v where v.legacy_source_key ~ '(^uji pemilik::|^R[45]\\.xlsx|^putus-|^atom-|^baris-1|^cabang\\.xlsx)'""")
        c = json.loads(cek)
        record('D1: semua riwayat migrasi tanpa cabang, tepat satu rekam medis, tanpa resep/stok', c['visits'] >= 15 and c['bercabang'] == 0 and c['mr_bukan_satu'] == 0 and c['resep'] == 0, cek)
        visit = d.last("select id from public.visits where legacy_source_key='R4.xlsx::Sheet1'")
        d.try_(rls.actor(f"update public.medical_records set diagnosis='DIUBAH' where visit_id='{visit}';", rls.OWNER))
        d.try_(rls.actor(f"delete from public.visits where id='{visit}';", rls.OWNER))
        record('D2: OWNER tetap tidak bisa mengubah/menghapus riwayat hasil migrasi secara langsung',
               d.last(f"select m.diagnosis from public.visits v join public.medical_records m on m.visit_id=v.id where v.id='{visit}'") == 'Dx R4', visit)
        record('F3 (risiko yang ada, terdokumentasi): pelanggan baru hasil migrasi berpenanda imported_at NULL',
               d.last("select bool_and(imported_at is null)::text from public.customers where name like 'UJI PEMILIK%'") == 'true', 'perilaku RPC yang ada; keputusan K8')
    fails = [x for x in rls.RESULTS if x['status'] != 'PASS']
    print(f"TOTAL pass={len(rls.RESULTS) - len(fails)} fail={len(fails)}", flush=True)
    if args.json:
        args.json.write_text(json.dumps({'results': rls.RESULTS}, indent=2))
    sys.exit(0 if not fails else 1)


if __name__ == '__main__':
    main()
