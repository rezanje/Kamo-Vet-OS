#!/usr/bin/env python3
"""Gladi bersih paket owner-apply pelanggan nonaktif di PostgreSQL lokal sekali pakai (data fiktif, tanpa jaringan).

Urutan: semua migrasi lama (tanpa kandidat) -> preflight -> apply -> readback -> apply ulang -> satu pelanggan dinonaktifkan
-> rollback tanpa flag (penjaga dicabut, kolom disimpan) -> apply lagi -> rollback dengan flag owner (kolom dihapus)
-> preflight -> apply -> readback. Juga memeriksa apply.sql identik dengan migrasinya.

  python3 -I docs/evidence/2026-11-05-pelanggan-nonaktif/owner-apply/build-and-rehearse.py --pg-bin /usr/lib/postgresql/16/bin
"""
import argparse, contextlib, hashlib, importlib.util, sys
from pathlib import Path
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent; ROOT = HERE.parents[3]
spec = importlib.util.spec_from_file_location('nonaktif', ROOT / 'scripts/test-pelanggan-nonaktif-postgres.py'); assert spec and spec.loader
t = importlib.util.module_from_spec(spec); spec.loader.exec_module(t)
r, q = t.r, t.q
LOG = []


def step(name, ok, detail=''):
    LOG.append(f"{'PASS' if ok else 'FAIL'} {name} {detail}".rstrip()); print(LOG[-1], flush=True)


def oks(out): return [line.rsplit('|', 1)[-1] for line in out.splitlines() if line.endswith('|t') or line.endswith('|f')]


def main():
    p = argparse.ArgumentParser(); p.add_argument('--pg-bin'); a = p.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    migration = (ROOT / 'supabase/migrations' / t.CANDIDATE).read_text()
    apply_sql = (HERE / 'apply.sql').read_text()
    step('apply.sql = migrasi dalam satu transaksi', migration in apply_sql and apply_sql.count('begin;') == 1 and apply_sql.rstrip().endswith('commit;'))
    step('rollback.sql = docs/rollback salinan identik', (HERE / 'rollback.sql').read_text() == (ROOT / 'docs/rollback/2026-11-05-pelanggan-nonaktif.sql').read_text())
    sources = [s for s in sorted((ROOT / 'supabase/migrations').glob('*.sql')) if s.name != t.CANDIDATE]
    with contextlib.ExitStack() as stack:
        db = t.build_chain(stack, sources, r.NativePostgres); r.fixture.DisposablePostgres.bootstrap(db)
        h = t.x.Harness(db); t.x.setup(h)
        c = t.cust(h, 9001, 'CS Pusat Fiktif')
        def run(file): return db.sql((HERE / file).read_text())
        pre = run('preflight.sql'); step('preflight: semua ok', oks(pre) and all(v == 't' for v in oks(pre)), str(oks(pre)))
        run('apply.sql'); rb = run('readback.sql'); step('readback setelah apply: semua ok', all(v == 't' for v in oks(rb)), str(oks(rb)))
        run('apply.sql'); rb2 = run('readback.sql'); step('apply ulang aman, readback sama', rb2 == rb)
        h.sql(f"update public.customers set is_active=false where id={q(c)};", r.OWNER)
        err = h.gagal(t.insert_sql('sales', c)); step('setelah dinonaktifkan: struk baru ditolak', bool(err and t.PESAN in err))
        out = db.sql((HERE / 'rollback.sql').read_text())
        kept = db.sql("select count(*) from information_schema.columns where table_name='customers' and column_name='is_active'") == '1'
        step('rollback tanpa flag: penjaga dicabut, kolom status disimpan', kept and not h.gagal(t.insert_sql('sales', c)), out[-200:])
        run('apply.sql'); err = h.gagal(t.insert_sql('sales', c))
        step('apply lagi: pelanggan tetap nonaktif, struk baru ditolak lagi', bool(err and t.PESAN in err))
        db.sql("select set_config('vetos.rollback_drop_data','yes',false);\n" + (HERE / 'rollback.sql').read_text())
        gone = db.sql("select count(*) from information_schema.columns where table_name='customers' and column_name in ('is_active','deactivated_at','deactivated_by','deactivation_reason')") == '0'
        fns = db.sql("select count(*) from pg_proc where proname in ('customer_status_manager','guard_customer_status','guard_new_transaction_customer_active')") == '0'
        step('rollback dengan flag owner: kolom & fungsi bersih', gone and fns)
        pre2 = run('preflight.sql'); step('preflight setelah rollback penuh: semua ok', all(v == 't' for v in oks(pre2)), str(oks(pre2)))
        run('apply.sql'); rb3 = run('readback.sql'); step('apply terakhir: readback semua ok', all(v == 't' for v in oks(rb3)), str(oks(rb3)))
    step('sha256 apply.sql', True, hashlib.sha256(apply_sql.encode()).hexdigest())
    return int(any(line.startswith('FAIL') for line in LOG))


if __name__ == '__main__': sys.exit(main())
