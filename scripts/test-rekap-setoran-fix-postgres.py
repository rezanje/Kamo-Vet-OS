#!/usr/bin/env python3
"""Rekap Setoran — perbaikan review (migrasi *_rekap_setoran_fix.sql). Native throwaway PostgreSQL only; never accepts a database URL.

  python3 -I scripts/test-rekap-setoran-fix-postgres.py --pg-bin DIR [--json out.json] [--baseline | --mutations | --conc | --digest | --upgrade]
  (default)   chain + candidate: suite regresi (suite lama yang disesuaikan, >= 300 asersi) + suite baru rekap_setoran_fix.sql (>= 80 asersi); second application fails closed.
  --baseline  chain WITHOUT the candidate: suite baru harus GAGAL dengan 0 lulus (RED) dan cacat B1 terbukti: STAFF membaca jurnal setoran (1 entri) di rantai lama, 0 di kandidat.
  --upgrade   data lama (setoran dengan lampiran lama, path ganda) sebelum kandidat dipasang: klaim berkas terisi (yang tertua menang), fungsi tetap jalan.
  --conc      dua sesi independen berebut berkas bukti yang sama (satu menang, satu ditolak PAKAI); dua sesi berebut setujui tidak merusak jurnal.
  --digest    'nothing else changed': md5 fungsi (+ACL) di luar yang diganti/baru, trigger, kolom, constraint, policy, index identik sebelum/sesudah.
  --mutations setiap mutan migrasi (scripts/rekap-setoran-fix-mutants.json) pada klon harus dibunuh oleh suite.
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
from pathlib import Path
import argparse, importlib.util, json, os, re, subprocess, sys, tempfile, threading, time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bpbase', ROOT / 'scripts/test-batalkan-penerimaan-petshop-postgres.py')
bp = importlib.util.module_from_spec(spec); sys.modules['bpbase'] = bp; spec.loader.exec_module(bp)
CAND = sorted(p.name for p in (ROOT / 'supabase/migrations').glob('*_rekap_setoran_fix.sql'))[0]
bp.CAND = CAND
MIGRATIONS, TESTS = bp.MIGRATIONS, bp.TESTS
SUITE_FIX, SUITE_REG = 'rekap_setoran_fix.sql', 'rekap_setoran_regresi.sql'
check, raw, clone, run_suite, build_chain, apply = bp.check, bp.raw, bp.clone, bp.run_suite, bp.build_chain, bp.apply
NativePostgres, RESULTS = bp.NativePostgres, bp.RESULTS

# Hosted Supabase gives every new public function/table EXECUTE/ALL to anon, authenticated and service_role by default privileges; the bare native chain does not.
PRELUDE = ("alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;\n"
           "alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;\n")
# storage.objects ala hosted (shim bawaan tidak punya owner_id/RLS)
STORAGE_PREP = ("alter table storage.objects add column if not exists owner_id text; alter table storage.objects enable row level security;\n"
                "grant usage on schema storage to authenticated; grant select, insert, update, delete on storage.objects to authenticated;\n")

SEED = ("insert into coa_accounts(code,name,type,normal_balance) select c,'Fiktif '||c,'BEBAN','D' from unnest(array['720002','720003','720004','740017','740005','720008','740021','740016','730002','720005','720006','720009','740002','740014','740013','740022','740012','760003']) c on conflict(code) do update set is_active=true,is_header=false;\n")
DATA_FIX_KEYS = ('koreksi_saldo_awal_fb', 'ralat_saldo_awal', 'sambung_jurnal_pengeluaran', 'saldo_awal_kas_toko_ke_cabang')
DATA_FIX = [f.read_text() for f in MIGRATIONS.glob('*.sql') if any(k in f.name for k in DATA_FIX_KEYS)]
SKIPPED = []


class Hook:
    """Wraps the native database during chain building: seeds expense accounts before the category migration and skips hosted-data fixes."""
    def __init__(self, db): self.db = db
    def __getattr__(self, k): return getattr(self.db, k)
    def sql(self, source):
        if source.startswith('begin;\n-- Kategori pengeluaran rinci'): source = SEED + source
        if any(t in source for t in DATA_FIX):
            try: return self.db.sql(source)
            except RuntimeError as e:
                SKIPPED.append(str(e)[:80]); return ''
        return self.db.sql(source)


def build_chain(db, exclude=()):
    tmp = Path(tempfile.mkdtemp(prefix='rsfchain.', dir='/opt/data'))
    try:
        (tmp / 'supabase/migrations').mkdir(parents=True)
        (tmp / 'supabase/tests/fixtures').mkdir(parents=True)
        fx = ROOT / 'supabase/tests/fixtures/hosted_auth_uid.sql'
        if fx.exists(): (tmp / 'supabase/tests/fixtures/hosted_auth_uid.sql').write_text(fx.read_text())
        for f in MIGRATIONS.glob('*.sql'):
            if f.name != CAND and f.name not in exclude and not f.name > CAND:
                (tmp / 'supabase/migrations' / f.name).symlink_to(f)
        old = bp.fixture.ROOT
        bp.fixture.ROOT = tmp
        try:
            bp.fixture.DisposablePostgres.bootstrap(Hook(db))
        finally:
            bp.fixture.ROOT = old
    finally:
        for f in (tmp / 'supabase/migrations').glob('*'): f.unlink()
        (tmp / 'supabase/migrations').rmdir()
        for f in (tmp / 'supabase/tests/fixtures').glob('*'): f.unlink()
        (tmp / 'supabase/tests/fixtures').rmdir(); (tmp / 'supabase/tests').rmdir(); (tmp / 'supabase').rmdir(); tmp.rmdir()


def fresh(db):
    build_chain(db)
    os.environ.pop('PGDATABASE', None)
    db.sql('create database tpl_base template postgres')


def cand_text(): return PRELUDE + STORAGE_PREP + (MIGRATIONS / CAND).read_text()


def run_green(db, a):
    fresh(db)
    clone(db, 'cand'); apply(db, 'cand', cand_text())
    ok, passes, why = run_suite(db, 'cand', SUITE_FIX)
    check('GREEN suite baru pada kandidat (%d asersi)' % len(passes), ok and len(passes) >= 80, why)
    clone(db, 'cand2'); apply(db, 'cand2', cand_text())
    ok, passes, why = run_suite(db, 'cand2', SUITE_REG)
    check('GREEN suite regresi (suite lama yang disesuaikan) pada kandidat (%d asersi)' % len(passes), ok and len(passes) >= 300, why)
    try:
        apply(db, 'cand', (MIGRATIONS / CAND).read_text(), later=False); twice = False
    except RuntimeError:
        twice = True
    check('second application of the migration fails closed (no silent re-apply)', twice)


DEFECT = r"""
begin;
insert into auth.users(id,raw_user_meta_data) values('d1000000-0000-4000-8000-000000000001','{"full_name":"Defect staff"}'),('d1000000-0000-4000-8000-000000000002','{"full_name":"Defect owner"}');
update profiles set role='STAFF',is_active=true where id='d1000000-0000-4000-8000-000000000001';
update profiles set role='OWNER',is_active=true where id='d1000000-0000-4000-8000-000000000002';
insert into branches(id,code,name,type) values('d2000000-0000-4000-8000-000000000001','DFB','Defect','PETSHOP');
insert into user_branches(user_id,branch_id) values('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001');
insert into journal_entries(id,no_jurnal,tanggal,branch_id,source,source_ref,deskripsi) values('d3000000-0000-4000-8000-000000000001','SJR-DEFECT-1',current_date,'d2000000-0000-4000-8000-000000000001','setoran','defect','Kelebihan kas setoran DEFECT');
insert into journal_lines(entry_id,account_id,debit,credit) select 'd3000000-0000-4000-8000-000000000001',id,1,0 from coa_accounts where code='182001';
insert into journal_lines(entry_id,account_id,debit,credit) select 'd3000000-0000-4000-8000-000000000001',id,0,1 from coa_accounts where code='810004';
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claims','{"role":"authenticated"}',true);
select 'STAFF_ENTRIES='||(select count(*) from journal_entries where source='setoran')||' STAFF_LINES='||(select count(*) from journal_lines where entry_id='d3000000-0000-4000-8000-000000000001')
  ||' STAFF_LEDGER='||(select count(*) from jsonb_array_elements(public.ledger_account_lines(null,null,array['d2000000-0000-4000-8000-000000000001'::uuid],null)) x where x->'journal_entries'->>'source'='setoran');
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
select 'OWNER_ENTRIES='||(select count(*) from journal_entries where source='setoran')||' OWNER_LINES='||(select count(*) from journal_lines where entry_id='d3000000-0000-4000-8000-000000000001')
  ||' OWNER_LEDGER='||(select count(*) from jsonb_array_elements(public.ledger_account_lines(null,null,array['d2000000-0000-4000-8000-000000000001'::uuid],null)) x where x->'journal_entries'->>'source'='setoran');
rollback;
"""


def run_baseline(db, a):
    fresh(db)
    clone(db, 'base')
    ok, passes, why = run_suite(db, 'base', SUITE_FIX)
    check('RED baseline: suite baru gagal tanpa kandidat (lulus sebelum gagal: %d)' % len(passes), (not ok) and len(passes) == 0, why)
    rc, out, err = raw(db, "select count(*) from pg_class where relname='setoran_lampiran_pakai' and relnamespace='public'::regnamespace", 'base')
    check('BASELINE: tabel klaim berkas belum ada sebelum kandidat', out.strip() == '0', out)
    rc, out, err = raw(db, DEFECT, 'base')
    check('BASELINE CACAT B1: STAFF membaca jurnal setoran di rantai lama (%s)' % out.replace('\n', ' ').strip(), 'STAFF_ENTRIES=1 STAFF_LINES=2 STAFF_LEDGER=2' in out.replace('\n', ' ') and 'OWNER_ENTRIES=1' in out, err[-300:])
    clone(db, 'cand'); apply(db, 'cand', cand_text())
    rc, out, err = raw(db, DEFECT, 'cand')
    o = out.replace('\n', ' ')
    check('KANDIDAT: STAFF 0 entri / 0 baris / 0 buku besar, OWNER tetap 1 / 2 / 2 (%s)' % o.strip(), 'STAFF_ENTRIES=0 STAFF_LINES=0 STAFF_LEDGER=0' in o and 'OWNER_ENTRIES=1 OWNER_LINES=2 OWNER_LEDGER=2' in o, err[-300:])


NEW_FN = ('setoran_jurnal_boleh', 'setoran_jurnal_tersembunyi', 'setoran_tulis_jurnal', 'setoran_konflik_tugas', 'setoran_peringatan', 'setoran_lampiran_cek', 'setoran_lampiran_klaim',
          'setoran_berkas_cabang', 'setoran_berkas_boleh', 'setoran_berkas_boleh_hapus', 'guard_setoran_pakai', 'guard_shift_tutup_uang')
REPLACED_FN = ('setoran_tambah_pengeluaran', 'setoran_hapus_pengeluaran', 'setoran_tambah_transfer', 'setoran_hapus_transfer', 'setoran_setujui', 'setoran_void', 'setoran_daftar', 'setoran_detail',
               'ledger_account_lines', 'ledger_account_totals')
SKIP = ", ".join("'%s'" % x for x in NEW_FN + REPLACED_FN)
DIGEST = r"""
with f as (select p.oid::regprocedure::text k, md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')) h from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname in ('public','clinic_private','admin_online_private','role_settings_private') and p.prokind='f' and p.proname not in (%(skip)s)),
t as (select tg.tgrelid::regclass::text||'.'||tg.tgname k, md5(pg_get_triggerdef(tg.oid)) h from pg_trigger tg where not tg.tgisinternal and tg.tgrelid::regclass::text <> 'setoran_lampiran_pakai' and tg.tgname <> 'cashier_shift_tutup_uang_guard'),
c as (select table_name||'.'||column_name k, md5(data_type||is_nullable||coalesce(column_default,'')) h from information_schema.columns where table_schema='public' and table_name <> 'setoran_lampiran_pakai'),
k as (select conrelid::regclass::text||'.'||conname k, md5(pg_get_constraintdef(oid)) h from pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text <> 'setoran_lampiran_pakai'),
po as (select polrelid::regclass::text||'.'||polname k, md5(coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'')||polcmd::text||polpermissive::text) h from pg_policy where polname not in ('setoran_jurnal_tertutup','setoran_berkas_baca_ketat','setoran_berkas_tulis_ketat','setoran_berkas_hapus_ketat','setoran_berkas_ubah_ketat') and polrelid::regclass::text <> 'setoran_lampiran_pakai'),
ix as (select schemaname||'.'||indexname k, md5(indexdef) h from pg_indexes where schemaname='public' and tablename <> 'setoran_lampiran_pakai'),
a as (select 'F'||k k,h from f union all select 'T'||k,h from t union all select 'C'||k,h from c union all select 'K'||k,h from k union all select 'P'||k,h from po union all select 'I'||k,h from ix)
select count(*)||' '||md5(string_agg(k||h,',' order by k)) from a;
""" % dict(skip=SKIP)


def run_digest(db, a):
    fresh(db)
    clone(db, 'old'); apply(db, 'old', PRELUDE + STORAGE_PREP, later=False); clone(db, 'new'); apply(db, 'new', cand_text())
    ro = raw(db, DIGEST, 'old'); rn = raw(db, DIGEST, 'new')
    o = ro[1].strip() or '0 ERR'; n = rn[1].strip() or '0 ERR'
    if o == '0 ERR' or n == '0 ERR': print('DIGEST SQL error:', (ro[2] or rn[2])[:400], flush=True)
    check('DIGEST objek di luar yang baru/diganti identik sebelum dan sesudah (%s | %s)' % (o, n), o == n and int(o.split()[0]) > 1000, '')
    rc, out, err = raw(db, "select count(*) from journal_entries; select count(*) from expenses; select count(*) from cash_advances", 'new')
    check('DIGEST migrasi tidak menulis baris jurnal, pengeluaran, atau kasbon', out.split() == ['0', '0', '0'], out)
    rc, out, err = raw(db, "select (select count(*) from setoran)+(select count(*) from setoran_lampiran_pakai)", 'new')
    check('DIGEST tabel setoran dan klaim kosong sesudah pasang', out.strip() == '0', out)
    # fungsi yang diganti: hanya yang disengaja (10) berubah definisi; ACL tidak berubah
    q = ("select string_agg(p.proname||':'||coalesce(p.proacl::text,''),',' order by p.proname) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (%s)" % ", ".join("'%s'" % x for x in REPLACED_FN))
    ro = raw(db, q, 'old'); rn = raw(db, q, 'new')
    check('10 fungsi yang diganti: ACL identik sebelum/sesudah (tidak ada hak baru)', ro[1].strip() == rn[1].strip() and ro[1].strip() != '', ro[1][:200])


# ------------------------------------------------------------------------------------------------ upgrade with data
UP_FIX = r"""
begin;
insert into auth.users(id,raw_user_meta_data) select ('c7100000-0000-4000-8000-0000000000'||n)::uuid,jsonb_build_object('full_name','UP '||n) from unnest(array['01','02','03']) n;
update profiles set role='STAFF',is_active=true where id='c7100000-0000-4000-8000-000000000001';
update profiles set role='FINANCE',is_active=true where id='c7100000-0000-4000-8000-000000000002';
update profiles set role='OWNER',is_active=true where id='c7100000-0000-4000-8000-000000000003';
insert into role_capabilities(role,all_branches,create_accounts) values('FINANCE',false,false) on conflict(role) do update set all_branches=false;
insert into branches(id,code,name,type) values('c7200000-0000-4000-8000-000000000001','UPB','Upgrade','PETSHOP');
insert into user_branches(user_id,branch_id) select ('c7100000-0000-4000-8000-0000000000'||n)::uuid,'c7200000-0000-4000-8000-000000000001' from unnest(array['01','02']) n;
insert into employees(id,nama,profile_id,status) values('c7300000-0000-4000-8000-000000000001','Up Kasir','c7100000-0000-4000-8000-000000000001','Aktif');
insert into coa_accounts(code,name,type,normal_balance,is_header,is_active) values('119901','Up kas','ASET','D',false,true) on conflict(code) do update set is_active=true,is_header=false;
insert into cash_accounts(id,nama,jenis,coa_code,is_active) values('c7500000-0000-4000-8000-000000000001','Up kas','Kas','119901',true) on conflict do nothing;
update accounting_locks set closed_until=null;
insert into cashier_shifts(id,branch_id,opened_by,shift_type,opening_balance,opened_at,closing_balance,expected_cash,selisih,closed_at,status,closing_breakdown)
 values('c7400000-0000-4000-8000-000000000001','c7200000-0000-4000-8000-000000000001','c7100000-0000-4000-8000-000000000001','petshop',0,
  (((now() at time zone 'Asia/Jakarta')::date-3)::timestamp+time '08:00') at time zone 'Asia/Jakarta',500000,500000,0,(((now() at time zone 'Asia/Jakarta')::date-3)::timestamp+time '17:00') at time zone 'Asia/Jakarta','closed','{"Tunai":500000}');
commit;
"""
UP_STEPS = r"""
set role authenticated;
select set_config('request.jwt.claim.sub','c7100000-0000-4000-8000-000000000001',false);select set_config('request.jwt.claims','{"role":"authenticated"}',false);
create temp table r(k text,v jsonb);
insert into r select 'p',public.setoran_buat('c7200000-0000-4000-8000-000000000001',((now() at time zone 'Asia/Jakarta')::date-3),((now() at time zone 'Asia/Jakarta')::date-3),((now() at time zone 'Asia/Jakarta')::date-2),'12:00','c7600000-0000-4000-8000-000000000001');
insert into r select 'e1',public.setoran_tambah_pengeluaran((select (v->>'id')::uuid from r where k='p'),((now() at time zone 'Asia/Jakarta')::date-3),'Operasional',1000,'lama 1','[{"path":"setoran/lama-ganda.jpg","nama":"a.jpg"}]'::jsonb,0,'c7600000-0000-4000-8000-000000000002');
insert into r select 'e2',public.setoran_tambah_pengeluaran((select (v->>'id')::uuid from r where k='p'),((now() at time zone 'Asia/Jakarta')::date-3),'Operasional',2000,'lama 2','[{"path":"setoran/lama-ganda.jpg","nama":"a.jpg"},{"path":"setoran/lama-unik.jpg","nama":"b.jpg"}]'::jsonb,1,'c7600000-0000-4000-8000-000000000003');
insert into r select 't1',public.setoran_tambah_transfer((select (v->>'id')::uuid from r where k='p'),((now() at time zone 'Asia/Jakarta')::date-2),100000,'Transfer',(select id from public.cash_accounts where nama='Up kas' limit 1),'[{"path":"setoran/lama-transfer.jpg","nama":"c.jpg"}]'::jsonb,null,2,'c7600000-0000-4000-8000-000000000004');
select 'PID '||(v->>'id') from r where k='p';
"""
UP_AFTER = r"""
select 'CLAIMS='||(select count(*) from setoran_lampiran_pakai)||' GANDA_JENIS='||(select jenis from setoran_lampiran_pakai where path='setoran/lama-ganda.jpg')
  ||' GANDA_OLEH='||(select dipakai_oleh from setoran_lampiran_pakai where path='setoran/lama-ganda.jpg')||' TRANSFER='||(select count(*) from setoran_lampiran_pakai where jenis='transfer');
select 'GANDA_BARIS='||(select (b.jumlah)::int from setoran_lampiran_pakai u join setoran_pengeluaran b on b.id=u.baris_id where u.path='setoran/lama-ganda.jpg');
set role authenticated;
select set_config('request.jwt.claim.sub','c7100000-0000-4000-8000-000000000001',false);select set_config('request.jwt.claims','{"role":"authenticated"}',false);
select 'DETAIL_OK='||(public.setoran_detail('%s'::uuid)->>'status')||' ROWS='||jsonb_array_length(public.setoran_detail('%s'::uuid)->'pengeluaran_baris');
"""


def run_upgrade(db, a):
    fresh(db)
    clone(db, 'up'); apply(db, 'up', PRELUDE + STORAGE_PREP, later=False)
    rc, out, err = raw(db, UP_FIX, 'up'); check('UPGRADE fixture data lama dikomit', rc == 0, err[-300:])
    rc, out, err = raw(db, UP_STEPS, 'up'); pid = re.search(r'PID ([0-9a-f-]{36})', out)
    check('UPGRADE data lama dibuat dengan fungsi lama (3 baris, path ganda lama-ganda.jpg di dua baris)', rc == 0 and bool(pid), (err or out)[-400:])
    if not pid: return
    rc, out, err = raw(db, "select (select count(*) from setoran_pengeluaran)||' '||(select count(*) from setoran_transfer)", 'up')
    check('UPGRADE sebelum kandidat: 2 pengeluaran + 1 transfer tersimpan (%s)' % out.strip(), out.strip() == '2 1', out)
    apply(db, 'up', (MIGRATIONS / CAND).read_text(), later=False)
    rc, out, err = raw(db, UP_AFTER % (pid.group(1), pid.group(1)), 'up')
    o = out.replace('\n', ' ')
    check('UPGRADE klaim terisi dari data lama: 3 path unik, path ganda diklaim baris tertua (jumlah 1000), 1 klaim transfer (%s)' % o.strip(),
          rc == 0 and 'CLAIMS=3' in o and 'GANDA_JENIS=pengeluaran' in o and 'GANDA_OLEH=c7100000-0000-4000-8000-000000000001' in o and 'TRANSFER=1' in o and 'GANDA_BARIS=1000' in o, err[-300:])
    check('UPGRADE fungsi baru membaca data lama: setoran_detail tetap jalan (%s)' % o.strip(), 'DETAIL_OK=Draft ROWS=2' in o, err[-300:])


# ------------------------------------------------------------------------------------------------ concurrency
CONC_FIX = r"""
begin;
insert into auth.users(id,raw_user_meta_data) select ('c5100000-0000-4000-8000-0000000000'||n)::uuid,jsonb_build_object('full_name','CONC '||n) from unnest(array['01','02','03']) n;
update profiles set role='STAFF',is_active=true where id in('c5100000-0000-4000-8000-000000000001','c5100000-0000-4000-8000-000000000002');
update profiles set role='OWNER',is_active=true where id='c5100000-0000-4000-8000-000000000003';
insert into role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into branches(id,code,name,type) values('c5200000-0000-4000-8000-000000000001','CNC','Conc','PETSHOP');
insert into user_branches(user_id,branch_id) select ('c5100000-0000-4000-8000-0000000000'||n)::uuid,'c5200000-0000-4000-8000-000000000001' from unnest(array['01','02','03']) n;
update accounting_locks set closed_until=null;
insert into storage.buckets(id,name,public) values('dokumen','dokumen',false) on conflict do nothing;
insert into storage.objects(bucket_id,name,owner_id) values('dokumen','setoran/c5200000-0000-4000-8000-000000000001/rebut.jpg','c5100000-0000-4000-8000-000000000001');
commit;
"""
CONC_STEPS = r"""
set role authenticated;
select set_config('request.jwt.claim.sub','c5100000-0000-4000-8000-000000000001',false);select set_config('request.jwt.claims','{"role":"authenticated"}',false);
create temp table r(k text,v jsonb);
insert into r select 'a',public.setoran_buat('c5200000-0000-4000-8000-000000000001',((now() at time zone 'Asia/Jakarta')::date-3),((now() at time zone 'Asia/Jakarta')::date-3),((now() at time zone 'Asia/Jakarta')::date-2),'12:00','c5600000-0000-4000-8000-000000000001');
insert into r select 'b',public.setoran_buat('c5200000-0000-4000-8000-000000000001',((now() at time zone 'Asia/Jakarta')::date-6),((now() at time zone 'Asia/Jakarta')::date-6),((now() at time zone 'Asia/Jakarta')::date-5),'12:00','c5600000-0000-4000-8000-000000000002');
select 'AID '||(v->>'id') from r where k='a';
select 'BID '||(v->>'id') from r where k='b';
"""


def psql_session(db, sql, dbname, results, key, delay=0):
    time.sleep(delay)
    t0 = time.time()
    rc, out, err = raw(db, sql, dbname)
    results[key] = (rc, out, err, time.time() - t0)


def run_conc(db, a):
    fresh(db)
    clone(db, 'conc'); apply(db, 'conc', cand_text())
    rc, out, err = raw(db, CONC_FIX, 'conc')
    check('CONC fixture committed', rc == 0, err[-300:])
    rc, out, err = raw(db, CONC_STEPS, 'conc')
    ida = re.search(r'AID ([0-9a-f-]{36})', out); idb = re.search(r'BID ([0-9a-f-]{36})', out)
    check('CONC dua setoran Draft siap (periode berbeda, cabang sama)', rc == 0 and bool(ida) and bool(idb), (err or out)[-400:])
    if not (ida and idb): return
    head = "set role authenticated;select set_config('request.jwt.claim.sub','c5100000-0000-4000-8000-00000000000%s',false);select set_config('request.jwt.claims','{\"role\":\"authenticated\"}',false);\nbegin;\n"
    add = "select public.setoran_tambah_pengeluaran('%s'::uuid,((now() at time zone 'Asia/Jakarta')::date-%d),'Operasional',1000,'rebutan','[{\"path\":\"setoran/c5200000-0000-4000-8000-000000000001/rebut.jpg\",\"nama\":\"r.jpg\"}]'::jsonb,0,'c5600000-0000-4000-8000-0000000000%s');\n"
    s1 = head % '1' + add % (ida.group(1), 3, 'c1') + "select pg_sleep(3);\ncommit;\n"
    s2 = head % '2' + add % (idb.group(1), 6, 'c2') + "commit;\n"
    res = {}
    t1 = threading.Thread(target=psql_session, args=(db, s1, 'conc', res, 's1')); t2 = threading.Thread(target=psql_session, args=(db, s2, 'conc', res, 's2', 1.2))
    t1.start(); t2.start(); t1.join(); t2.join()
    rc1, o1, e1, d1 = res['s1']; rc2, o2, e2, d2 = res['s2']
    check('CONC sesi 1 (memegang berkas 3 detik) berhasil', rc1 == 0, e1[-300:])
    check('CONC sesi 2 menunggu sesi 1 lalu ditolak SETORAN_LAMPIRAN_PAKAI (tunggu %.1fs; satu berkas = satu baris)' % d2, rc2 != 0 and 'SETORAN_LAMPIRAN_PAKAI' in e2 and d2 >= 1.5, e2[-300:])
    rc, out, err = raw(db, "select (select count(*) from setoran_lampiran_pakai where path like '%rebut.jpg')||' '||(select count(*) from setoran_pengeluaran)", 'conc')
    check('CONC tepat satu klaim dan satu baris pengeluaran (%s)' % out.strip(), out.strip() == '1 1', out)
    # sesudah sesi 1 commit, sesi 2 dengan berkas lain tetap bisa
    rc, out, err = raw(db, "insert into storage.objects(bucket_id,name,owner_id) values('dokumen','setoran/c5200000-0000-4000-8000-000000000001/lain.jpg','c5100000-0000-4000-8000-000000000002')", 'conc')
    s3 = head % '2' + add.replace('rebut.jpg', 'lain.jpg') % (idb.group(1), 6, 'c3') + "commit;\n"
    rc, out, err = raw(db, s3, 'conc')
    check('CONC berkas berbeda untuk setoran lain tetap berhasil', rc == 0, err[-300:])


# ------------------------------------------------------------------------------------------------ mutations
def run_mutations(db, a):
    fresh(db)
    base = (MIGRATIONS / CAND).read_text()
    clone(db, 'ctl'); apply(db, 'ctl', PRELUDE + STORAGE_PREP + base, later=False)
    ok, passes, why = run_suite(db, 'ctl', SUITE_FIX)
    check('CONTROL: kandidat tanpa mutasi lulus suite baru (%d asersi)' % len(passes), ok, why)
    want = len(passes)
    ok2, passes2, why2 = (True, [], '')
    clone(db, 'ctl2'); apply(db, 'ctl2', PRELUDE + STORAGE_PREP + base, later=False)
    ok2, passes2, why2 = run_suite(db, 'ctl2', SUITE_REG)
    check('CONTROL: kandidat tanpa mutasi lulus suite regresi (%d asersi)' % len(passes2), ok2, why2)
    want2 = len(passes2)
    only = os.environ.get('BP_ONLY')
    killed_n = total = 0
    muts = json.loads((ROOT / 'scripts/rekap-setoran-fix-mutants.json').read_text())
    for name, old, new in muts:
        if only and not any(name.startswith(o) for o in only.split(',')): continue
        total += 1
        n = base.count(old)
        if n != 1:
            check('MUTANT ' + name + ' (anchor found exactly once)', False, 'anchor count %d' % n); continue
        mutated = base.replace(old, new)
        clone(db, 'mut')
        try:
            apply(db, 'mut', PRELUDE + STORAGE_PREP + mutated, later=False)
        except RuntimeError as e:
            killed_n += 1
            check('MUTANT ' + name + ' -> killed (does not even apply: %s)' % str(e)[:80].replace('\n', ' '), True); continue
        ok, passes, why = run_suite(db, 'mut', SUITE_FIX)
        killed = (not ok) or len(passes) < want
        by = 'suite baru'
        if not killed:
            clone(db, 'mut2'); apply(db, 'mut2', PRELUDE + STORAGE_PREP + mutated, later=False)
            ok, passes, why = run_suite(db, 'mut2', SUITE_REG)
            killed = (not ok) or len(passes) < want2; by = 'suite regresi'
        killed_n += 1 if killed else 0
        check('MUTANT ' + name + ' -> %s' % ('KILLED by %s: %s' % (by, why[:90]) if killed else 'SURVIVED (kedua suite hijau)'), killed, why)
    print('MUTANTS killed %d / %d' % (killed_n, total), flush=True)
    RESULTS.append(dict(case='MUTANT TOTAL killed %d of %d' % (killed_n, total), status='PASS' if killed_n == total and (total >= 20 or only) else 'FAIL', detail=''))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', required=True); ap.add_argument('--json')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--conc', action='store_true')
    ap.add_argument('--digest', action='store_true'); ap.add_argument('--upgrade', action='store_true')
    a = ap.parse_args()
    fn = run_baseline if a.baseline else run_green
    if a.mutations: fn = run_mutations
    if a.conc: fn = run_conc
    if a.digest: fn = run_digest
    if a.upgrade: fn = run_upgrade
    with NativePostgres(a.pg_bin) as db:
        fn(db, a)
    if a.json:
        Path(a.json).write_text(json.dumps(dict(mode=fn.__name__, results=RESULTS), indent=1))
    fails = [r for r in RESULTS if r['status'] == 'FAIL']
    print('SUMMARY mode=%s pass=%d fail=%d' % (fn.__name__, len(RESULTS) - len(fails), len(fails)))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
