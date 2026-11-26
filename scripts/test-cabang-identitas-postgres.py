#!/usr/bin/env python3
"""Identitas cabang untuk dokumen cetak (migrasi 20261213050000_cabang_identitas_dokumen.sql): rantai migrasi asli, PostgreSQL native, data fiktif.

  python3 -I scripts/test-cabang-identitas-postgres.py --pg-bin DIR --json out.json
  --baseline    rantai TANPA kandidat: suite dijalankan terus walau gagal; harus banyak GAGAL (MERAH)
  --diff        uji diferensial: matriks (peran x objek x baca/hapus/unggah/ubah) identik sebelum/sesudah untuk SEMUA objek bukan cabang-logo/
  --names FILE  (dengan --diff) daftar objek tambahan [{b,n,o}] (nama hosted yang dianonimkan; hanya SELECT nama)
  --rollback    kandidat + ROLLBACK buatan sendiri = sidik objek identik dengan sebelum kandidat
  --mutations   mutan pada teks migrasi (klon per mutan dari rantai tanpa kandidat); semua harus terbunuh oleh pernyataan uji
  --only a,b    batasi mutan
Tanpa mode: HIJAU = suite + diferensial + rollback + pemasangan ulang ditolak.
Persiapan storage.objects meniru hosted (shim bawaan tidak punya owner_id/RLS): kolom owner_id text, RLS aktif, hak authenticated.
"""
import argparse, importlib.util, json, sys, time, fcntl, os, subprocess
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('kp', ROOT / 'scripts/test-komplain-pelanggan-postgres.py')
kp = importlib.util.module_from_spec(spec); spec.loader.exec_module(kp)
mspec = importlib.util.spec_from_file_location('cmut', ROOT / 'scripts/test-cabang-identitas-mutants.py')
cmut = importlib.util.module_from_spec(mspec); mspec.loader.exec_module(cmut)
NativePostgres = kp.NativePostgres

CAND = '20261213050000_cabang_identitas_dokumen.sql'
MIGRATIONS = kp.MIGRATIONS
SUITE = ROOT / 'supabase/tests/cabang_identitas_dokumen.sql'
STORAGE_PREP = ("alter table storage.objects add column if not exists owner_id text; alter table storage.objects enable row level security;"
                "grant usage on schema storage to authenticated; grant select, insert, update, delete on storage.objects to authenticated;")
SEED_BRANCH = "insert into public.branches(id,code,name,type,is_active) values('c2000000-0000-4000-8000-0000000000fe','SEEDCID','CID seed sebelum migrasi','KLINIK',true);"
check, raw, clone, apply, strip_check = kp.check, kp.raw, kp.clone, kp.apply, kp.strip_check
RESULTS = kp.RESULTS


def raw_nostop(db, sql, dbname):
    env = {**os.environ, 'PSQLRC': '/dev/null', 'PGDATABASE': dbname}
    r = subprocess.run(db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=0', '-v', 'ON_ERROR_ROLLBACK=on'], input=sql, text=True, capture_output=True, env=env, timeout=900)
    return r.returncode, r.stdout, r.stderr


def suite_run(db, dbname, path, stop=True):
    text = path.read_text()
    rc, out, err = raw(db, text, dbname) if stop else raw_nostop(db, text, dbname)
    passes = [l for l in err.splitlines() if 'BP_PASS ' in l]
    fails = [l for l in err.splitlines() if 'Assertion failed' in l or 'Unexpected result' in l or 'Expected rejection' in l]
    why = ''
    if rc or fails:
        errs = [l for l in err.splitlines() if 'ERROR' in l]
        why = (errs[0] if errs else (err.strip().splitlines() or ['error'])[-1])[:500]
    return (rc == 0 and not fails), len(passes), len(fails), why


def kq(s): return "'" + s.replace("'", "''") + "'"


BR_A = 'c2000000-0000-4000-8000-000000000001'


def matrix_sql(extra):
    """Fixture suite (pengguna, cabang) + objek, lalu untuk tiap peran x objek: baca/hapus/unggah/ubah (semua dibatalkan)."""
    text = SUITE.read_text()
    i = text.index('begin;'); j = text.index("select pg_temp.ok(exists(select 1 from information_schema.columns where table_schema='storage'")
    pre = text[i:j]
    synth = [('dokumen', 'pengeluaran/1700000000001-nota.jpg', 0), ('dokumen', 'pembelian/1700000000002-faktur.pdf', 1), ('dokumen', 'pembelian/c1000000-0000-4000-8000-0000000000aa/1700000000003-x.pdf', 2),
             ('dokumen', 'penjualan-online/1700000000004-b.jpg', 3), ('dokumen', 'komplain/1700000000005-k.jpg', 4), ('dokumen', 'cabang-logoX/a.png', 5), ('dokumen', 'Cabang-Logo/a.png', 6),
             ('dokumen', 'x/cabang-logo/a.png', 7), ('dokumen', 'cabang-logo', 8), ('dokumen', 'cabang-logo-1/a.png', 9), ('dokumen', ' cabang-logo/a.png', 0), ('dokumen', '/cabang-logo/a.png', 1),
             ('dokumen', 'CABANG-LOGO/a.png', 2), ('dokumen', 'cabang-logo.png', 3), ('medical-docs', f'cabang-logo/{BR_A}/m.png', 4), ('medical-docs', 'penunjang/1700000000006-m.pdf', 5),
             ('pet-photos', f'cabang-logo/{BR_A}/p.png', 6), ('pet-photos', '1700000000007-pet.jpg', 7), ('absensi-foto', f'cabang-logo/{BR_A}/a.png', 8), ('kamo-backup-internal', 'reset/1.json', -1),
             # berkas cabang-logo/ sungguhan (HARUS berbeda sebelum/sesudah)
             ('dokumen', f'cabang-logo/{BR_A}/logo.png', 0), ('dokumen', f'cabang-logo/{BR_A}/logo2.webp', 3), ('dokumen', 'cabang-logo/c2000000-0000-4000-8000-000000000002/papan.jpg', 6)]
    objs = synth + [(x['b'], x['n'], x['o']) for x in extra]
    vals = ',\n'.join("(%s,%s,%d)" % (kq(b), kq(n), o) for b, n, o in objs)
    return pre + f"""
insert into storage.buckets(id,name,public) values('dokumen','dokumen',false),('medical-docs','medical-docs',false),('pet-photos','pet-photos',true),('absensi-foto','absensi-foto',false),('kamo-backup-internal','kamo-backup-internal',false) on conflict do nothing;
create temp table mx_obj(b text, n text, o int);
insert into mx_obj values
{vals};
create temp table uurow as select id, n, row_number() over (order by n) r from uu where n <> 'nobody';
insert into storage.objects(bucket_id,name,owner,owner_id)
 select b,n,case when o<0 then null else (select id from uurow where r=(o%(select count(*) from uurow))+1) end,
        case when o<0 then null else (select id::text from uurow where r=(o%(select count(*) from uurow))+1) end from mx_obj;
create policy tmp_dokumen_ubah on storage.objects for update to authenticated using (true) with check (true);
create function pg_temp.mx(un text) returns setof text language plpgsql as $$
declare r record; v_uid text; v_sel text; v_del text; v_ins text; v_upd text; v_n int;
begin
 select id::text into v_uid from uu where uu.n=un;
 for r in select b,n from mx_obj order by b,n loop
  perform set_config('request.jwt.claim.sub',v_uid,true); perform set_config('request.jwt.claims','{{"role":"authenticated"}}',true);
  begin execute 'set local role authenticated'; select count(*) into v_n from storage.objects where bucket_id=r.b and name=r.n; execute 'reset role'; v_sel:=v_n::text;
  exception when others then execute 'reset role'; v_sel:='ERR:'||sqlstate; end;
  begin execute 'set local role authenticated'; delete from storage.objects where bucket_id=r.b and name=r.n; get diagnostics v_n=row_count; raise exception 'BATAL_%', v_n;
  exception when others then execute 'reset role'; v_del:=case when sqlerrm like 'BATAL\\_%' then substr(sqlerrm,7) else 'ERR:'||sqlstate end; end;
  begin execute 'set local role authenticated'; insert into storage.objects(bucket_id,name,owner,owner_id) values(r.b,r.n||'#ins',v_uid::uuid,v_uid); raise exception 'BATAL_ok';
  exception when others then execute 'reset role'; v_ins:=case when sqlerrm='BATAL_ok' then 'ok' else 'ERR:'||sqlstate end; end;
  begin execute 'set local role authenticated'; update storage.objects set name=name where bucket_id=r.b and name=r.n; get diagnostics v_n=row_count; raise exception 'BATAL_%', v_n;
  exception when others then execute 'reset role'; v_upd:=case when sqlerrm like 'BATAL\\_%' then substr(sqlerrm,7) else 'ERR:'||sqlstate end; end;
  return next 'MX|'||un||'|'||r.b||'|'||r.n||'|'||v_sel||'|'||v_del||'|'||v_ins||'|'||v_upd;
 end loop;
end$$;
select pg_temp.mx(n) from (values('own'),('adm'),('fin'),('st'),('st2'),('kk'),('ao'),('off'),('adm2')) v(n);
rollback;
"""


def run_matrix(db, dbname, extra):
    rc, out, err = raw(db, matrix_sql(extra), dbname, timeout=1800)
    if rc: raise RuntimeError(err[-500:])
    return [l for l in out.splitlines() if l.startswith('MX|')]


def is_cl(line):
    p = line.split('|')
    return p[2] == 'dokumen' and p[3].startswith('cabang-logo/')


def diff_test(db, extra):
    clone(db, 'dbase', 'tpl_s'); clone(db, 'dcand', 'tpl_s'); apply(db, 'dcand', (MIGRATIONS / CAND).read_text())
    a = run_matrix(db, 'dbase', extra); b = run_matrix(db, 'dcand', extra)
    check('diferensial: jumlah baris matriks sama sebelum/sesudah', len(a) == len(b) and len(a) > 0, f'{len(a)} vs {len(b)} baris')
    na = [l for l in a if not is_cl(l)]; nb = [l for l in b if not is_cl(l)]
    bad = [(x, y) for x, y in zip(na, nb) if x != y]
    objs = len({(l.split('|')[2], l.split('|')[3]) for l in na})
    check(f'diferensial: SEMUA {len(na)} baris bukan-cabang-logo/ identik ({objs} objek x peran x baca/hapus/unggah/ubah)', len(na) == len(nb) and not bad, bad[:2])
    ka = [l for l in a if is_cl(l)]; kb = [l for l in b if is_cl(l)]
    check('diferensial: berkas cabang-logo/ BERBEDA (kontrol: kebijakan benar-benar bekerja)', ka != kb and len(ka) > 0, f'{len(ka)} baris cabang-logo/')

    def agg(lines, who, col, only_real=True):
        return sum(1 for l in lines if l.split('|')[1] == who and (not only_real or l.split('|')[3].endswith(('/logo.png', '/logo2.webp', '/papan.jpg')))
                   and l.split('|')[col] not in ('0', '') and not l.split('|')[col].startswith('ERR'))
    check('MERAH sebelum: staf (st) menghapus semua 3 logo cabang (kebijakan lama dokumen_delete terlalu longgar)', agg(ka, 'st', 5) == 3, [l for l in ka if '|st|' in l][:2])
    check('HIJAU sesudah: staf (st) tidak menghapus satu pun logo', agg(kb, 'st', 5) == 0, [l for l in kb if '|st|' in l][:2])
    check('HIJAU sesudah: OWNER (own) dan ADMIN (adm) menghapus ketiganya', agg(kb, 'own', 5) == 3 and agg(kb, 'adm', 5) == 3, [l for l in kb if '|own|' in l][:2])
    check('HIJAU sesudah: semua akun internal non-Admin Online (own, adm, fin, st, kk) masih membaca logo; Admin Online (ao) tidak',
          all(agg(kb, w, 4) == 3 for w in ('own', 'adm', 'fin', 'st', 'st2', 'kk', 'off', 'adm2')) and agg(kb, 'ao', 4) == 0, [l for l in kb if '|ao|' in l][:2])
    check('HIJAU sesudah: tidak seorang pun mengubah objek logo (UPDATE) walau ada kebijakan UPDATE permisif', all(agg(kb, w, 7) == 0 for w in ('own', 'adm', 'fin', 'st')), '')
    return a, b


# ------------------------------------------------------------------ rollback
ROLLBACK_SQL = """begin;
set local lock_timeout = '5s';
drop policy if exists cabang_logo_tulis_ketat on storage.objects; drop policy if exists cabang_logo_hapus_ketat on storage.objects; drop policy if exists cabang_logo_ubah_ketat on storage.objects;
drop trigger if exists a00_guard_branch_identity_edit on public.branches;
drop function public.guard_branch_identity_direct_edit();
drop function public.update_branch_identity(uuid, text, text, text, boolean);
drop function public.cabang_logo_boleh_tulis(text); drop function public.cabang_logo_boleh_hapus(text);
alter table public.branches drop constraint branches_identitas_cek;
alter table public.branches drop column alamat, drop column telepon, drop column logo_path;
select admin_online_private.guard_all();
notify pgrst, 'reload schema';
commit;
"""
DIGEST = ("select md5(string_agg(p.oid::regprocedure::text||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,''),'|' order by p.oid::regprocedure::text)) || '|' || count(*) "
          "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private','admin_online_private','role_settings_private') and p.prokind in ('f','p')")
DIGEST2 = ("select coalesce(string_agg(schemaname||'.'||tablename||'.'||policyname||':'||permissive||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,''),'|' order by schemaname,tablename,policyname),'') from pg_policies where schemaname in ('public','storage')")
DIGEST3 = ("select md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable,'|' order by table_name,column_name))||'|'||(select count(*) from pg_trigger t where not t.tgisinternal and t.tgrelid='public.branches'::regclass)"
           "||'|'||(select count(*) from pg_constraint where conrelid='public.branches'::regclass) from information_schema.columns where table_schema='public' and table_name='branches'")


def digests(db, dbn):
    return '#'.join(raw(db, q + ';', dbn)[1].strip() for q in (DIGEST, DIGEST2, DIGEST3))


def rollback_test(db):
    clone(db, 'rb', 'tpl_s')
    before = digests(db, 'rb')
    apply(db, 'rb', (MIGRATIONS / CAND).read_text())
    mid = digests(db, 'rb')
    check('rollback: kandidat memang mengubah sidik objek (kontrol)', mid != before)
    rc, out, err = raw(db, ROLLBACK_SQL, 'rb'); check('rollback: ROLLBACK dijalankan tanpa galat', rc == 0, err[-300:])
    after = digests(db, 'rb')
    check('rollback: sidik fungsi (+ACL), kebijakan, kolom/pemicu/batasan cabang identik dengan sebelum kandidat', after == before, (before[:90], after[:90]))
    return ROLLBACK_SQL


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', required=True); ap.add_argument('--json'); ap.add_argument('--baseline', action='store_true'); ap.add_argument('--diff', action='store_true')
    ap.add_argument('--rollback', action='store_true'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--only'); ap.add_argument('--names')
    ap.add_argument('--write-rollback')
    a = ap.parse_args()
    t0 = time.time()
    extra = json.loads(Path(a.names).read_text()) if a.names else []
    with NativePostgres(a.pg_bin) as db:
        lk = open(kp.HEAVY, 'a'); fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            kp.build_chain(db, {f.name for f in MIGRATIONS.glob('*.sql') if f.name >= CAND}); db.sql('create database tpl_base template postgres')
        finally:
            fcntl.flock(lk, fcntl.LOCK_UN); lk.close()
        clone(db, 'tpl_s', 'tpl_base'); raw(db, STORAGE_PREP + SEED_BRANCH, 'tpl_s')
        text = (MIGRATIONS / CAND).read_text()
        if a.baseline:
            clone(db, 'b', 'tpl_s')
            ok, n, f, why = suite_run(db, 'b', SUITE, stop=False)
            check('RED: suite GAGAL tanpa kandidat', not ok and f >= 20, f'{n} lulus, {f} GAGAL; contoh: {why}')
        elif a.diff:
            diff_test(db, extra)
        elif a.rollback:
            sql = rollback_test(db)
            if a.write_rollback: Path(a.write_rollback).write_text(sql)
        elif a.mutations:
            base = strip_check(text)
            only = set(a.only.split(',')) if a.only else None
            clone(db, 'm', 'tpl_s'); apply(db, 'm', base); ok, n, f, why = suite_run(db, 'm', SUITE)
            check('kontrol (tanpa mutasi, tanpa pemeriksaan pasang) hijau', ok, f'{n} pernyataan lulus; {why}')
            detail = {}
            for name, subs in cmut.MUTANTS:
                if only and name not in only: continue
                t = base
                for old, new, cnt in subs:
                    assert t.count(old) == cnt, (name, 'jangkar muncul %d kali' % t.count(old), old[:90])
                    t = t.replace(old, new)
                clone(db, 'm', 'tpl_s')
                try:
                    apply(db, 'm', t); ok, n, f, why = suite_run(db, 'm', SUITE)
                except RuntimeError as e:
                    check('mutan ' + name, False, 'GALAT PASANG (bukan pembunuhan sah): ' + str(e)[:200]); detail[name] = 'crash'; continue
                real = (not ok) and any(w in why for w in ('Assertion failed', 'Unexpected result', 'Expected rejection'))
                check('mutan ' + name + ' terbunuh', real, f'lulus {n} lalu: {why[:200]}' if not ok else 'SELAMAT: suite hijau')
                detail[name] = 'killed' if real else ('survived' if ok else 'crash-bukan-uji')
            print('MUTAN', sum(1 for v in detail.values() if v == 'killed'), '/', len(detail), flush=True)
        else:
            clone(db, 'g', 'tpl_s'); apply(db, 'g', text)
            ok, n, f, why = suite_run(db, 'g', SUITE); check('suite hijau', ok, f'{n} pernyataan lulus; {why}')
            clone(db, 'g2', 'tpl_s'); apply(db, 'g2', text)
            ok, n, f, why = suite_run(db, 'g2', SUITE)
            check('pemasangan ulang di klon baru menghasilkan hasil sama (deterministik)', ok, f'{n} lulus')
            rc, out, err = raw(db, 'begin;\n' + text + '\ncommit;', 'g'); check('pemasangan ulang migrasi ditolak (kolom/fungsi sudah ada)', rc != 0 and 'already exists' in err, err[-160:])
            diff_test(db, extra); rollback_test(db)
    total = len(RESULTS); fails = [r for r in RESULTS if r['status'] != 'PASS']
    print(f'SUMMARY total={total} fail={len(fails)} detik={time.time() - t0:.0f}')
    if a.json: Path(a.json).write_text(json.dumps(dict(results=RESULTS, fail=len(fails)), indent=1, ensure_ascii=False))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
