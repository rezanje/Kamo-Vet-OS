#!/usr/bin/env python3
"""Bukti native PG17: 'Cabang pembukuan' pembayaran faktur pembelian (jurnal ke cabang pilihan, hutang tetap di cabang faktur).
Hanya soket lokal, tanpa DB hosted. Mengambil /opt/data/kamo-heavy-test.lock sendiri (jangan dibungkus flock).

  python3 -I scripts/test-purchase-journal-branch-postgres.py --pg-bin /opt/data/kamo-pg-harness/bin [--baseline] [--json out.json]

--baseline : rantai migrasi TANPA kandidat (RED: pemeriksaan perilaku baru harus GAGAL)
default    : kandidat terpasang (GREEN: 0 gagal)
"""
import argparse
import fcntl
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres  # noqa: E402

CANDIDATE = 'pembelian_cabang_pembukuan'
TEST = ROOT / 'supabase/tests/purchase_payment_journal_branch.sql'
os.environ.setdefault('PGTZ', 'UTC')
# Seperti suite neighbour: kategori pengeluaran rinci butuh akun beban fiktif; migrasi data-fix produksi dilewati bila tabel kosong.
SEED = ("insert into coa_accounts(code,name,type,normal_balance) select c,'Fiktif '||c,'BEBAN','D' from unnest(array['720002','720003','720004','740017','740005','720008','740021','740016','730002','720005','720006','720009','740002','740014','740013','740022','740012','760003']) c on conflict(code) do update set is_active=true,is_header=false;\n")
PRELUDE = ("alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;"
           "alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;")


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pg-bin', default='/opt/data/kamo-pg-harness/bin')
    ap.add_argument('--baseline', action='store_true')
    ap.add_argument('--json')
    args = ap.parse_args()
    fixture = load('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
    posted = load('posted', ROOT / 'scripts/test-posted-sales-postgres.py')
    migrations = ROOT / 'supabase/migrations'
    data_fix = [f.read_text() for f in migrations.glob('*.sql') if any(k in f.name for k in ('koreksi_saldo_awal_fb', 'ralat_saldo_awal', 'sambung_jurnal_pengeluaran', 'saldo_awal_kas_toko_ke_cabang'))]

    lock = open('/opt/data/kamo-heavy-test.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX)
    tracked = subprocess.run(['git', '-C', str(ROOT), 'ls-files', 'supabase/migrations'], capture_output=True, text=True, check=True).stdout.split()
    with NativePostgres(args.pg_bin) as db:
        class Hook:
            def __getattr__(self, name):
                return getattr(db, name)

            def sql(self, source):
                if source.startswith('begin;\n-- Kategori pengeluaran rinci'):
                    source = SEED + source
                if any(t in source for t in data_fix):
                    try:
                        return db.sql(source)
                    except RuntimeError as exc:
                        print('SKIPPED data-fix pada rantai kosong:', str(exc)[:80], flush=True)
                        return ''
                return db.sql(source)

        tmp = Path(tempfile.mkdtemp(prefix='pjbchain.', dir=os.environ.get('TMPDIR', '/tmp')))
        (tmp / 'supabase/migrations').mkdir(parents=True)
        candidate_files = []
        for rel in tracked:
            if not rel.endswith('.sql'):
                continue
            if CANDIDATE in rel:
                continue
            (tmp / 'supabase/migrations' / Path(rel).name).symlink_to(ROOT / rel)
        fixture.ROOT = tmp
        fixture.DisposablePostgres.bootstrap(Hook())
        db.sql(PRELUDE)
        if not args.baseline:
            candidate_files = sorted(migrations.glob(f'*_{CANDIDATE}.sql'))
            assert len(candidate_files) == 1, candidate_files
            db.sql('begin;\n' + candidate_files[0].read_text() + '\ncommit;')
        env = {**{k: v for k, v in os.environ.items() if not k.startswith('PG')}, 'PGOPTIONS': '-c client_min_messages=notice -c TimeZone=UTC', 'PSQLRC': '/dev/null'}
        source = posted.fixture_owner_updates(TEST.read_text())
        run = subprocess.run([db.psql, '-X', '-q', '-At', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=source, text=True, capture_output=True, env=env)
    output = run.stdout + run.stderr
    summary = re.search(r'PJB_SUMMARY pass=(\d+) fail=(\d+)', output)
    failed = re.findall(r'^(\S[^\n]*?) => ', output, re.M)
    result = {'mode': 'baseline' if args.baseline else 'candidate', 'pass': int(summary.group(1)) if summary else None, 'fail': int(summary.group(2)) if summary else None,
              'failed_checks': failed, 'returncode': run.returncode}
    print(json.dumps(result, ensure_ascii=False, indent=1))
    if args.json:
        Path(args.json).write_text(json.dumps(result, ensure_ascii=False, indent=1))
    if args.baseline:
        # RED: kandidat belum ada, jadi pemeriksaan perilaku baru HARUS gagal.
        sys.exit(0 if result['fail'] else 1)
    sys.exit(0 if summary and result['fail'] == 0 and run.returncode == 0 else 1)


if __name__ == '__main__':
    main()
