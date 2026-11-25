#!/usr/bin/env python3
"""Komplain Pelanggan (migrasi 20261211100000_komplain_pelanggan.sql) — rantai migrasi asli, PostgreSQL native, data fiktif.

  python3 -I scripts/test-komplain-pelanggan-postgres.py --pg-bin DIR --json out.json
  --baseline    rantai TANPA kandidat: suite SQL harus GAGAL (MERAH)
  --mutations   rantai tanpa kandidat sekali, lalu tiap mutan di salinan database; semua harus terbunuh oleh pernyataan uji
  --only a,b    batasi mutan yang dijalankan
Bagian GREEN: suite SQL (supabase/tests/komplain_pelanggan.sql) + balapan nyata (sesi terpisah): nomor unik tanpa celah, kunci anti-dobel
serentak, dua perubahan status serentak, pemasangan ulang ditolak.
"""
import argparse, concurrent.futures as cf, importlib.util, json, os, re, subprocess, sys, tempfile, time, fcntl
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
from native_postgres import NativePostgres  # noqa: E402
mspec = importlib.util.spec_from_file_location('mutants', ROOT / 'scripts/test-komplain-pelanggan-mutants.py')
mutmod = importlib.util.module_from_spec(mspec); mspec.loader.exec_module(mutmod)

CAND = '20261211100000_komplain_pelanggan.sql'
MIGRATIONS = ROOT / 'supabase/migrations'
SUITE = ROOT / 'supabase/tests/komplain_pelanggan.sql'
PRELUDE = ("alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;"
           "alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;")
RESULTS = []
HEAVY = '/opt/data/kamo-heavy-test.lock'


def check(name, ok, detail=''):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=str(detail)[:700]))
    print(RESULTS[-1]['status'], name, str(detail)[:300], flush=True)
    return ok


# Migrasi 20261123084004 memeriksa akun beban yang hanya ada di COA hosted: dibuatkan akun fiktif untuk rantai sekali pakai.
SEED = ("insert into coa_accounts(code,name,type,normal_balance) select c,'Fiktif '||c,'BEBAN','D' from unnest(array['720002','720003','720004','740017','740005','720008','740021','740016','730002','720005','720006','720009','740002','740014','740013','740022','740012','760003']) c on conflict(code) do update set is_active=true,is_header=false;\n")
# Migrasi koreksi data khusus hosted gagal di rantai kosong; ditoleransi dan tidak pernah menjadi bagian bukti.
DATA_FIX = [f.read_text() for f in MIGRATIONS.glob('*.sql') if any(k in f.name for k in ('koreksi_saldo_awal_fb', 'ralat_saldo_awal', 'sambung_jurnal_pengeluaran', 'saldo_awal_kas_toko_ke_cabang'))]
SKIPPED = []


class Hook:
    def __init__(self, db): self.db = db
    def __getattr__(self, k): return getattr(self.db, k)
    def sql(self, source):
        if source.startswith('begin;\n-- Kategori pengeluaran rinci'): source = SEED + source
        if any(t in source for t in DATA_FIX):
            try: return self.db.sql(source)
            except RuntimeError as e:
                SKIPPED.append(str(e)[:80]); return ''
        return self.db.sql(source)


def build_chain(db, exclude):
    tmp = Path(tempfile.mkdtemp(prefix='kplchain.', dir='/opt/data'))
    try:
        (tmp / 'supabase/migrations').mkdir(parents=True)
        for f in MIGRATIONS.glob('*.sql'):
            if f.name not in exclude:
                (tmp / 'supabase/migrations' / f.name).symlink_to(f)
        old = fixture.ROOT; fixture.ROOT = tmp
        try: fixture.DisposablePostgres.bootstrap(Hook(db))
        finally: fixture.ROOT = old
    finally:
        for f in (tmp / 'supabase/migrations').glob('*'): f.unlink()
        (tmp / 'supabase/migrations').rmdir(); (tmp / 'supabase').rmdir(); tmp.rmdir()


def raw(db, sql, dbname=None, timeout=600):
    env = {**os.environ, 'PSQLRC': '/dev/null'}
    if dbname: env['PGDATABASE'] = dbname
    r = subprocess.run(db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True, env=env, timeout=timeout)
    return r.returncode, r.stdout, r.stderr


def clone(db, name, template='tpl_base'):
    os.environ.pop('PGDATABASE', None)
    db.sql('drop database if exists %s' % name); db.sql('create database %s template %s' % (name, template))


def strip_check(text):
    i = text.index('do $check$'); j = text.index('end $check$;', i) + len('end $check$;')
    return text[:i] + text[j:]


def apply(db, dbname, text):
    rc, out, err = raw(db, PRELUDE + 'begin;\n' + text + '\ncommit;', dbname)
    if rc: raise RuntimeError((err + out)[-600:])


def run_suite(db, dbname):
    rc, out, err = raw(db, SUITE.read_text(), dbname)
    passes = [l for l in err.splitlines() if 'BP_PASS ' in l]
    why = ''
    if rc:
        errs = [l for l in err.splitlines() if 'ERROR' in l]
        why = (errs[0] if errs else (err.strip().splitlines() or ['error'])[-1])[:500]
    return rc == 0, len(passes), why


# ------------------------------------------------------------------ balapan: sesi terpisah dan kunci nyata
RACE_FIX = r"""
begin;
insert into auth.users(id,raw_user_meta_data) values ('bb000000-0000-4000-8000-0000000000a1','{"full_name":"Race owner"}'),('bb000000-0000-4000-8000-0000000000a2','{"full_name":"Race staff"}'),('bb000000-0000-4000-8000-0000000000a3','{"full_name":"Race staff dua"}');
update profiles set role='OWNER',is_active=true where id='bb000000-0000-4000-8000-0000000000a1';
update profiles set role='STAFF',is_active=true where id in('bb000000-0000-4000-8000-0000000000a2','bb000000-0000-4000-8000-0000000000a3');
insert into branches(id,code,name,type) values('bb010000-0000-4000-8000-000000000001','RACEBR','Race','PETSHOP');
insert into user_branches(user_id,branch_id) values('bb000000-0000-4000-8000-0000000000a2','bb010000-0000-4000-8000-000000000001'),('bb000000-0000-4000-8000-0000000000a3','bb010000-0000-4000-8000-000000000001');
commit;
"""


def create_sql(user, key, desc='Balapan nomor komplain'):
    return (f"begin; select set_config('request.jwt.claim.sub','{user}',true); select set_config('request.jwt.claims','{{\"role\":\"authenticated\"}}',true); set local role authenticated;\n"
            f"select public.komplain_buat('{key}'::uuid,'bb010000-0000-4000-8000-000000000001'::uuid,'Petshop',null,null,null,null,null,null,null,(select id from public.complaint_categories order by sort_order limit 1),'Sedang','{desc}',null,null,null,null,'[]'::jsonb)->>'nomor';\ncommit;")


def races(db):
    clone(db, 'race')
    apply(db, 'race', (MIGRATIONS / CAND).read_text())
    rc, out, err = raw(db, RACE_FIX, 'race'); check('balapan: fixture', rc == 0, err)
    users = ['bb000000-0000-4000-8000-0000000000a2', 'bb000000-0000-4000-8000-0000000000a3', 'bb000000-0000-4000-8000-0000000000a1']
    jobs = [(users[i % 3], f'bb0000{i:02d}-0000-4000-8000-000000000001') for i in range(24)]
    with cf.ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda j: raw(db, create_sql(*j), 'race'), jobs))
    nums = [o.strip().splitlines()[-1] for rc, o, e in res if rc == 0 and o.strip()]
    bad = [e[-200:] for rc, o, e in res if rc]
    check('balapan: 24 pembuatan serentak (8 sesi) semuanya berhasil', len(nums) == 24 and not bad, bad[:2])
    check('balapan: 24 nomor berbeda', len(set(nums)) == 24, len(set(nums)))
    sufs = sorted(int(n.rsplit('-', 1)[1]) for n in nums)
    check('balapan: nomor berurutan 1..24 tanpa celah', sufs == list(range(1, 25)), sufs)
    # kunci anti-dobel serentak: 6 sesi, kunci sama, pembuat sama
    key = 'bb0000ff-0000-4000-8000-0000000000ff'
    with cf.ThreadPoolExecutor(6) as ex:
        res = list(ex.map(lambda _: raw(db, create_sql(users[0], key, 'Kunci sama serentak'), 'race'), range(6)))
    got = {o.strip().splitlines()[-1] for rc, o, e in res if rc == 0 and o.strip()}
    n_rows = int(raw(db, f"select count(*) from public.customer_complaints where request_key='{key}'", 'race')[1].strip())
    check('balapan: kunci sama serentak = tepat satu baris', n_rows == 1, n_rows)
    check('balapan: semua sesi mendapat nomor yang sama', len(got) == 1 and all(rc == 0 for rc, o, e in res), (got, [e[-120:] for rc, o, e in res if rc]))
    # dua perubahan status serentak pada komplain yang sama, kunci beda: urutan jejak unik dan status akhir konsisten
    cid = raw(db, "select id from public.customer_complaints order by complaint_no limit 1", 'race')[1].strip()
    def st(status, k, user=users[2], note='Selesai dengan catatan', tipe='Maaf/penjelasan'):
        t = f"'{tipe}'" if status in ('Selesai',) else 'null'
        n = f"'{note}'" if status in ('Selesai',) else 'null'
        return raw(db, f"begin; select set_config('request.jwt.claim.sub','{user}',true); select set_config('request.jwt.claims','{{\"role\":\"authenticated\"}}',true); set local role authenticated;\n"
                       f"select public.komplain_ubah_status('{cid}'::uuid,'{status}',{n},{t},'{k}'::uuid);\ncommit;", 'race')
    with cf.ThreadPoolExecutor(4) as ex:
        f = [ex.submit(st, s, f'bb0001{i:02d}-0000-4000-8000-000000000001') for i, s in enumerate(['Dicek', 'Dalam penanganan', 'Selesai', 'Menunggu pelanggan'])]
        outs = [x.result() for x in f]
    seqs = [int(x) for x in raw(db, f"select seq from public.customer_complaint_history where complaint_id='{cid}' order by seq", 'race')[1].split()]
    check('balapan: perubahan status serentak: seq jejak unik berurutan', seqs == list(range(1, len(seqs) + 1)), seqs)
    ok_n = sum(1 for rc, o, e in outs if rc == 0)
    final = raw(db, f"select status||'|'||(closed_at is not null)::text||'|'||coalesce(resolution_type,'-') from public.customer_complaints where id='{cid}'", 'race')[1].strip()
    check('balapan: status akhir koheren dengan jumlah perubahan yang berhasil', ok_n >= 1 and len(seqs) == 1 + ok_n and (final.startswith('Selesai|true|Maaf') or not final.startswith('Selesai')), (ok_n, final, seqs))
    check('balapan: galat yang muncul hanya penolakan transisi/status (bukan galat kunci/keterkaitan)', all(('KOMPLAIN_TRANSISI' in e or 'KOMPLAIN_STATUS' in e or 'KOMPLAIN_BUKA' in e or 'KOMPLAIN_ALASAN_BUKA' in e) for rc, o, e in outs if rc), [re.sub(r'\s+', ' ', e)[:200] for rc, o, e in outs if rc])
    # pemasangan ulang ditolak
    rc, out, err = raw(db, 'begin;\n' + (MIGRATIONS / CAND).read_text() + '\ncommit;', 'race')
    check('pemasangan ulang migrasi ditolak (KOMPLAIN_DRIFT)', rc != 0 and 'KOMPLAIN_DRIFT' in err, err[-160:])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', required=True); ap.add_argument('--json'); ap.add_argument('--baseline', action='store_true')
    ap.add_argument('--mutations', action='store_true'); ap.add_argument('--only'); ap.add_argument('--skip-races', action='store_true')
    a = ap.parse_args()
    t0 = time.time()
    with NativePostgres(a.pg_bin) as db:
        lk = open(HEAVY, 'a'); fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            build_chain(db, {f.name for f in MIGRATIONS.glob('*.sql') if f.name >= CAND}); db.sql('create database tpl_base template postgres')  # migrasi sesudah kandidat (mis. tambalan lampiran) tidak ikut: urutan nomor
        finally:
            fcntl.flock(lk, fcntl.LOCK_UN); lk.close()
        text = (MIGRATIONS / CAND).read_text()
        if a.baseline:
            clone(db, 'b')
            ok, n, why = run_suite(db, 'b')
            check('RED: suite SQL gagal tanpa kandidat', not ok, f'{n} lulus sebelum gagal; {why}')
        elif a.mutations:
            base = strip_check(text)
            only = set(a.only.split(',')) if a.only else None
            clone(db, 'm'); apply(db, 'm', base); ok, n, why = run_suite(db, 'm')
            check('kontrol (tanpa mutasi, tanpa pemeriksaan pasang) hijau', ok, f'{n} pernyataan lulus; {why}')
            detail = {}
            for name, subs in mutmod.MUTANTS:
                if only and name not in only: continue
                t = base
                for old, new, cnt in subs:
                    assert t.count(old) == cnt, (name, 'jangkar muncul %d kali' % t.count(old), old[:80])
                    t = t.replace(old, new)
                clone(db, 'm')
                try:
                    apply(db, 'm', t); ok, n, why = run_suite(db, 'm')
                except RuntimeError as e:
                    check('mutan ' + name, False, 'GALAT PASANG (bukan pembunuhan sah): ' + str(e)[:200]); detail[name] = 'crash'; continue
                real = (not ok) and any(w in why for w in ('Assertion failed', 'Unexpected result', 'Expected rejection'))
                check('mutan ' + name + ' terbunuh', real, f'lulus {n} lalu: {why[:200]}' if not ok else 'SELAMAT: suite hijau')
                detail[name] = 'killed' if real else ('survived' if ok else 'crash-bukan-uji')
            print('MUTAN', sum(1 for v in detail.values() if v == 'killed'), '/', len(detail), flush=True)
        else:
            clone(db, 'g'); apply(db, 'g', text)
            ok, n, why = run_suite(db, 'g')
            check('suite SQL hijau', ok, f'{n} pernyataan lulus; {why}')
            if not a.skip_races: races(db)
    total = len(RESULTS); fails = [r for r in RESULTS if r['status'] != 'PASS']
    print(f'SUMMARY total={total} fail={len(fails)} detik={time.time() - t0:.0f}')
    if a.json: Path(a.json).write_text(json.dumps(dict(results=RESULTS, fail=len(fails)), indent=1, ensure_ascii=False))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
