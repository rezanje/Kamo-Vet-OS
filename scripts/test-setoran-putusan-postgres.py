#!/usr/bin/env python3
"""Rekap Setoran — keputusan hanya Owner/Finance (migrasi *_setoran_putusan_owner_finance.sql). Native throwaway PostgreSQL only; never accepts a database URL.

  python3 -I scripts/test-setoran-putusan-postgres.py --pg-bin DIR [--json out.json] [--baseline | --mutations | --digest]
  (default)   rantai (fix rekap setoran + migrasi sesudahnya) + kandidat: suite supabase/tests/setoran_putusan_owner_finance.sql (>= 90 asersi) lulus.
  --baseline  rantai TANPA kandidat: suite harus GAGAL pada asersi pertama (0 lulus) = RED.
  --digest    'nothing else changed': md5 fungsi (+ACL) di luar 6 fungsi yang diganti + 1 baru, trigger, kolom, constraint, policy, index identik; tidak ada baris data berubah.
  --mutations tiap mutan migrasi pada klon harus dibunuh oleh suite (atau gagal terpasang karena pemeriksaan pasang).
Suite lama (rekap_setoran*, regresi, fix) dijalankan oleh skrip masing-masing (test-rekap-setoran[-fix]-postgres.py) setelah disesuaikan.
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
from pathlib import Path
import argparse, importlib.util, json, os, sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fxbase', ROOT / 'scripts/test-rekap-setoran-fix-postgres.py')
fx = importlib.util.module_from_spec(spec); sys.modules['fxbase'] = fx; spec.loader.exec_module(fx)
bp = fx.bp
MINE = sorted(p.name for p in (ROOT / 'supabase/migrations').glob('*_setoran_putusan_owner_finance.sql'))[0]
MIGRATIONS, TESTS = fx.MIGRATIONS, fx.TESTS
SUITE = 'setoran_putusan_owner_finance.sql'
check, raw, clone, run_suite, apply = fx.check, fx.raw, fx.clone, fx.run_suite, fx.apply
NativePostgres, RESULTS = fx.NativePostgres, fx.RESULTS
PRELUDE, STORAGE_PREP = fx.PRELUDE, fx.STORAGE_PREP


def mine_text(): return (MIGRATIONS / MINE).read_text()


def build_base(db, name):
    """Klon rantai: fix rekap setoran + semua migrasi sesudahnya KECUALI kandidat (keadaan hosted sebelum pasang)."""
    clone(db, name)
    apply(db, name, fx.cand_text(), later=False)
    for later in sorted(p for p in MIGRATIONS.glob('*.sql') if p.name > fx.CAND and p.name < MINE):
        rc, out, err = raw(db, 'begin;\n' + later.read_text() + '\ncommit;', name)
        if rc: raise RuntimeError(later.name + ': ' + err + out)


def build_cand(db, name, text=None):
    build_base(db, name)
    apply(db, name, text if text is not None else mine_text(), later=False)


def fresh(db):
    fx.fresh(db)


def run_green(db, a):
    fresh(db)
    build_cand(db, 'cand')
    ok, passes, why = run_suite(db, 'cand', SUITE)
    check('GREEN suite putusan Owner/Finance pada kandidat (%d asersi)' % len(passes), ok and len(passes) >= 90, why)
    try:
        apply(db, 'cand', mine_text(), later=False); twice = False
    except RuntimeError:
        twice = True
    check('pemasangan kedua gagal tertutup (tidak diam-diam terpasang ulang)', twice)


def run_baseline(db, a):
    fresh(db)
    build_base(db, 'base')
    ok, passes, why = run_suite(db, 'base', SUITE)
    check('RED baseline: suite gagal tanpa kandidat pada asersi pertama (lulus sebelum gagal: %d)' % len(passes), (not ok) and len(passes) == 0 and 'Assertion failed' in why, why)
    rc, out, err = raw(db, "select to_regprocedure('public.setoran_pemutus()') is null", 'base')
    check('BASELINE: setoran_pemutus() belum ada', out.strip() == 't', out + err)
    # cacat yang diperbaiki: Admin dan Admin Umum dapat menyetujui di rantai lama
    rc, out, err = raw(db, "select pg_get_functiondef('public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)'::regprocedure) ~ 'hanya Owner, Finance, atau Admin cabang'", 'base')
    check('BASELINE CACAT: rantai lama menyebut Admin cabang boleh menyetujui', out.strip() == 't', out + err)


NEW_FN = ('setoran_pemutus',)
REPLACED_FN = ('setoran_setujui', 'setoran_tolak', 'setoran_putuskan_transfer', 'setoran_peringatan', 'setoran_detail', 'setoran_akses')
SKIP = ", ".join("'%s'" % x for x in NEW_FN + REPLACED_FN)


def run_digest(db, a):
    fresh(db)
    build_base(db, 'old'); build_cand(db, 'new')
    d = fx.DIGEST.replace(fx.SKIP, SKIP)
    ro = raw(db, d, 'old'); rn = raw(db, d, 'new')
    o = ro[1].strip() or '0 ERR'; n = rn[1].strip() or '0 ERR'
    if o == '0 ERR' or n == '0 ERR': print('DIGEST SQL error:', (ro[2] or rn[2])[:400], flush=True)
    check('DIGEST objek di luar 6 fungsi diganti + 1 baru identik sebelum dan sesudah (%s | %s)' % (o, n), o == n and int(o.split()[0]) > 1000, '')
    q = ("select string_agg(p.proname||':'||coalesce(p.proacl::text,'')||':'||coalesce(p.proconfig::text,'')||':'||pg_get_userbyid(p.proowner)||':'||p.prosecdef||':'||p.provolatile::text,',' order by p.proname) from pg_proc p "
         "where p.pronamespace='public'::regnamespace and p.proname in (%s)" % ", ".join("'%s'" % x for x in REPLACED_FN))
    ro = raw(db, q, 'old'); rn = raw(db, q, 'new')
    check('6 fungsi yang diganti: ACL, pemilik, setelan, SECURITY DEFINER, volatilitas identik sebelum/sesudah (tidak ada hak baru)', ro[1].strip() == rn[1].strip() and ro[1].strip() != '', ro[1][:200])
    q = "select md5(pg_get_functiondef('public.setoran_penyetuju()'::regprocedure)) || ' ' || md5(pg_get_functiondef('public.setoran_jurnal_boleh()'::regprocedure))"
    ro = raw(db, q, 'old'); rn = raw(db, q, 'new')
    check('predikat BACA setoran_penyetuju() dan setoran_jurnal_boleh() identik (hak baca tidak berubah)', ro[1].strip() == rn[1].strip() and len(ro[1].strip()) > 60, ro[1])
    # perbedaan fungsi yang diganti hanyalah yang disengaja: balikkan penggantian pada teks baru dan bandingkan dengan teks lama
    import base64
    q = ("select p.proname||' '||encode(convert_to(pg_get_functiondef(p.oid),'UTF8'),'base64') from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (%s) order by 1"
         % ", ".join("'%s'" % x for x in REPLACED_FN))
    def defs(dbname):
        rc, out, err = raw(db, q, dbname)
        res = {}
        for ln in out.splitlines():
            if ' ' in ln: k, v = ln.split(' ', 1); res.setdefault(k, '')
            else: v = ln; k = None
            if k: cur = k; res[cur] = v
            else: res[cur] += v
        return {k: base64.b64decode(v).decode() for k, v in res.items()}
    old, new = defs('old'), defs('new')
    back = [("setoran_pemutus()", "setoran_penyetuju()"), ("Owner atau Finance yang dapat menyetujui", "Owner, Finance, atau Admin cabang yang dapat menyetujui"),
            ("Owner atau Finance yang dapat menolak", "Owner, Finance, atau Admin cabang yang dapat menolak"), ("Owner atau Finance yang dapat mengonfirmasi", "Owner, Finance, atau Admin cabang yang dapat mengonfirmasi"),
            ("Owner atau Finance lain yang menyetujui", "Owner/Finance/Admin lain yang menyetujui"), ("Minta Owner atau Finance lain.", "Minta Owner/Finance/Admin lain."),
            (" 'pemutus', public.setoran_penyetuju(),", ""), (", 'pemutus', false", "")]
    diff = []
    for k in REPLACED_FN:
        t = new.get(k, '')
        for x, y in back: t = t.replace(x, y)
        if t != old.get(k): diff.append(k)
    check('6 fungsi diganti: setelah membalik penggantian yang disengaja, definisinya IDENTIK dengan yang lama (selisih: %s)' % diff, len(old) == 6 and len(new) == 6 and not diff, '')
    rc, out, err = raw(db, "select (select count(*) from setoran)||' '||(select count(*) from journal_entries)||' '||(select count(*) from expenses)||' '||(select count(*) from cash_advances)", 'new')
    ro2 = raw(db, "select (select count(*) from setoran)||' '||(select count(*) from journal_entries)||' '||(select count(*) from expenses)||' '||(select count(*) from cash_advances)", 'old')
    check('DIGEST migrasi tidak mengubah jumlah baris setoran, jurnal, pengeluaran, kasbon (%s)' % out.strip(), out.strip() == ro2[1].strip() and out.strip() != '', out)


# ------------------------------------------------------------------------------------------------ mutations
GATE_SETUJUI = '"sig":"public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)","rep":[\n      ["if not public.setoran_penyetuju() then","if not public.setoran_pemutus() then"]'
GATE_TOLAK = '"sig":"public.setoran_tolak(uuid,text,uuid)","rep":[\n      ["if not public.setoran_penyetuju() then","if not public.setoran_pemutus() then"]'
GATE_PUTUS = '"sig":"public.setoran_putuskan_transfer(uuid,uuid,boolean,text,uuid)","rep":[\n      ["if not public.setoran_penyetuju() then","if not public.setoran_pemutus() then"]'


def gate(g, repl): return (g, g.replace('"if not public.setoran_pemutus() then"]', '"%s"]' % repl))


MUTANTS = [
    # name, old, new   (anchor harus tepat satu kali)
    ('M01 pemutus: ADMIN ikut', "select coalesce(public.setoran_role() in ('OWNER','FINANCE'), false) $$;", "select coalesce(public.setoran_role() in ('OWNER','FINANCE') or public.setoran_role() = 'ADM'||'IN', false) $$;"),
    ('M02 pemutus: ADMIN_UMUM ikut', "select coalesce(public.setoran_role() in ('OWNER','FINANCE'), false) $$;", "select coalesce(public.setoran_role() in ('OWNER','FINANCE') or public.setoran_role() = 'ADM'||'IN_UMUM', false) $$;"),
    ('M03 pemutus: STAFF ikut', "select coalesce(public.setoran_role() in ('OWNER','FINANCE'), false) $$;", "select coalesce(public.setoran_role() in ('OWNER','FINANCE','STAFF'), false) $$;"),
    ('M04 pemutus: hanya OWNER (Finance dikunci)', "select coalesce(public.setoran_role() in ('OWNER','FINANCE'), false) $$;", "select coalesce(public.setoran_role() in ('OWNER') /* 'OWNER','FINANCE' */, false) $$;"),
    ('M05 pemutus: selalu benar', "select coalesce(public.setoran_role() in ('OWNER','FINANCE'), false) $$;", "select coalesce(public.setoran_role() in ('OWNER','FINANCE'), false) or true $$;"),
    ('M06 pemutus: peran nonaktif/tanpa peran lolos', "select coalesce(public.setoran_role() in ('OWNER','FINANCE'), false) $$;", "select coalesce(public.setoran_role() in ('OWNER','FINANCE'), true) $$;"),
    ('M07 setujui: gerbang memakai peran lama (Admin ikut)', *gate(GATE_SETUJUI, "if not (public.setoran_role() in ('OWNER','FINANCE','ADMIN')) then /* setoran_pemutus() */")),
    ('M08 tolak: gerbang memakai peran lama (Admin Umum ikut)', *gate(GATE_TOLAK, "if not (public.setoran_role() in ('OWNER','FINANCE','ADMIN_UMUM')) then /* setoran_pemutus() */")),
    ('M09 putuskan transfer: gerbang memakai peran lama (Admin ikut)', *gate(GATE_PUTUS, "if not (public.setoran_role() in ('OWNER','FINANCE','ADMIN','ADMIN_UMUM')) then /* setoran_pemutus() */")),
    ('M10 setujui: gerbang dihapus', *gate(GATE_SETUJUI, "if false then /* setoran_pemutus() */")),
    ('M11 tolak: gerbang dihapus', *gate(GATE_TOLAK, "if false then /* setoran_pemutus() */")),
    ('M12 putuskan transfer: gerbang dihapus', *gate(GATE_PUTUS, "if false then /* setoran_pemutus() */")),
    ('M13 setujui: pesan lama dipertahankan', '["SETORAN_DITOLAK_PERAN: hanya Owner, Finance, atau Admin cabang yang dapat menyetujui setoran.","SETORAN_DITOLAK_PERAN: hanya Owner atau Finance yang dapat menyetujui setoran."]',
     '["SETORAN_DITOLAK_PERAN: hanya Owner, Finance, atau Admin cabang yang dapat menyetujui setoran.","SETORAN_DITOLAK_PERAN: hanya Owner, Finance, atau Admin cabang yang dapat menyetujui setoran."]'),
    ('M14 tolak: pesan lama dipertahankan', '["SETORAN_DITOLAK_PERAN: hanya Owner, Finance, atau Admin cabang yang dapat menolak setoran.","SETORAN_DITOLAK_PERAN: hanya Owner atau Finance yang dapat menolak setoran."]',
     '["SETORAN_DITOLAK_PERAN: hanya Owner, Finance, atau Admin cabang yang dapat menolak setoran.","SETORAN_DITOLAK_PERAN: hanya Owner, Finance, atau Admin cabang yang dapat menolak setoran."]'),
    ('M15 konfirmasi transfer: pesan lama dipertahankan', '["SETORAN_DITOLAK_PERAN: hanya Owner, Finance, atau Admin cabang yang dapat mengonfirmasi transfer.","SETORAN_DITOLAK_PERAN: hanya Owner atau Finance yang dapat mengonfirmasi transfer."]',
     '["SETORAN_DITOLAK_PERAN: hanya Owner, Finance, atau Admin cabang yang dapat mengonfirmasi transfer.","SETORAN_DITOLAK_PERAN: hanya Owner, Finance, atau Admin cabang yang dapat mengonfirmasi transfer."]'),
    ('M16 setoran_akses: kunci pemutus memakai predikat BACA', "'penyetuju', public.setoran_penyetuju(), 'pemutus', public.setoran_pemutus(), 'void'", "'penyetuju', public.setoran_penyetuju(), 'pemutus', public.setoran_penyetuju(), 'void'"),
    ('M17 setoran_akses: pemutus selalu false', "'penyetuju', public.setoran_penyetuju(), 'pemutus', public.setoran_pemutus(), 'void'", "'penyetuju', public.setoran_penyetuju(), 'pemutus', false and public.setoran_pemutus(), 'void'"),
    ('M18 setoran_detail: pemutus memakai predikat BACA', "\"'penyetuju', v_app, 'pemutus', public.setoran_pemutus(),\"", "\"'penyetuju', v_app, 'pemutus', v_app and public.setoran_pemutus() or v_app,\""),
    ('M19 setoran_detail: pemutus selalu true', "\"'penyetuju', v_app, 'pemutus', public.setoran_pemutus(),\"", "\"'penyetuju', v_app, 'pemutus', true or public.setoran_pemutus(),\""),
    ('M20 peringatan: saran lama dipertahankan', '["Minta Owner/Finance/Admin lain.","Minta Owner atau Finance lain."]', '["Minta Owner/Finance/Admin lain.","Minta Owner/Finance/Admin lain., "]'),
    ('M21 predikat BACA dipersempit (Admin kehilangan hak baca)', "create function public.setoran_pemutus()",
     "create or replace function public.setoran_penyetuju() returns boolean language sql stable security definer set search_path = '' as $f$ select coalesce(public.setoran_role() in ('OWNER','FINANCE') /* 'OWNER','FINANCE','ADMIN','ADMIN_UMUM' */, false) $f$;\ncreate function public.setoran_pemutus()"),
    ('M22 ACL: pemutus dapat dipanggil klien', "revoke all on function public.setoran_pemutus() from public, anon, authenticated, service_role;", "revoke all on function public.setoran_pemutus() from public, anon, service_role;"),
    ('M23 hak buat Admin dicabut: setoran_buat dipaksa Owner/Finance', "create function public.setoran_pemutus()",
     "do $m$ declare d text; begin d := replace(pg_get_functiondef('public.setoran_ajukan(uuid,integer,uuid)'::regprocedure), 'begin'||chr(10), 'begin'||chr(10)||'  if public.setoran_role() in (''ADMIN'',''ADMIN_UMUM'') then raise exception ''SETORAN_DITOLAK_PERAN: mutan''; end if;'||chr(10)); execute d; end $m$;\ncreate function public.setoran_pemutus()"),
    ('M24 transfer: pemisahan tugas pencatat dihapus', "create function public.setoran_pemutus()",
     "do $m$ declare d text; n int; begin d := pg_get_functiondef('public.setoran_putuskan_transfer(uuid,uuid,boolean,text,uuid)'::regprocedure); n := (length(d)-length(replace(d,'if auth.uid() = v_t.entered_by then','')))/length('if auth.uid() = v_t.entered_by then'); if n<>1 then raise exception 'anchor %', n; end if; execute replace(d,'if auth.uid() = v_t.entered_by then','if false then'); end $m$;\ncreate function public.setoran_pemutus()"),
    ('M25 setujui: pemisahan tugas pembuat dihapus', "create function public.setoran_pemutus()",
     "do $m$ declare d text; n int; a text := 'if v_uid in (v_s.created_by, v_s.submitted_by) then'; begin d := pg_get_functiondef('public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)'::regprocedure); n := (length(d)-length(replace(d,a,'')))/length(a); if n<>1 then raise exception 'anchor %', n; end if; execute replace(d,a,'if false then'); end $m$;\ncreate function public.setoran_pemutus()"),
    ('M26 setoran_void dibuka untuk Admin', "create function public.setoran_pemutus()",
     "do $m$ declare d text; n int; a text := 'not in (''OWNER'',''FINANCE'')'; begin d := pg_get_functiondef('public.setoran_void(uuid,text,uuid)'::regprocedure); n := (length(d)-length(replace(d,a,'')))/length(a); if n<>1 then raise exception 'anchor %', n; end if; execute replace(d,a,'not in (''OWNER'',''FINANCE'',''ADMIN'')'); end $m$;\ncreate function public.setoran_pemutus()"),
]
# Mutan yang SENGAJA gagal terpasang (pemeriksaan pasang membunuhnya) dihitung terbunuh; M01-M05 menyimpan token yang diperiksa supaya sampai ke suite.


def run_mutations(db, a):
    fresh(db)
    build_base(db, 'basecand')
    base = mine_text()
    clone(db, 'ctl', 'basecand'); apply(db, 'ctl', base, later=False)
    ok, passes, why = run_suite(db, 'ctl', SUITE)
    check('CONTROL: kandidat tanpa mutasi lulus suite (%d asersi)' % len(passes), ok, why)
    want = len(passes)
    only = os.environ.get('BP_ONLY')
    killed_n = total = 0
    for name, old, new in MUTANTS:
        if only and not any(name.startswith(o) for o in only.split(',')): continue
        total += 1
        n = base.count(old)
        if n != 1:
            check('MUTANT ' + name + ' (jangkar tepat satu kali)', False, 'jangkar ditemukan %d kali' % n); continue
        mutated = base.replace(old, new)
        clone(db, 'mut', 'basecand')
        try:
            apply(db, 'mut', mutated, later=False)
        except RuntimeError as e:
            killed_n += 1
            check('MUTANT ' + name + ' -> terbunuh (tidak terpasang: %s)' % str(e)[:110].replace('\n', ' '), True); continue
        ok, passes, why = run_suite(db, 'mut', SUITE)
        killed = (not ok) or len(passes) < want
        killed_n += 1 if killed else 0
        check('MUTANT ' + name + ' -> %s' % ('TERBUNUH oleh suite: %s' % why[:100] if killed else 'SELAMAT (suite hijau)'), killed, why)
    print('MUTANTS terbunuh %d / %d' % (killed_n, total), flush=True)
    RESULTS.append(dict(case='MUTANT TOTAL terbunuh %d dari %d' % (killed_n, total), status='PASS' if killed_n == total and (total >= 20 or only) else 'FAIL', detail=''))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', required=True); ap.add_argument('--json')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--digest', action='store_true')
    a = ap.parse_args()
    fn = run_baseline if a.baseline else run_green
    if a.mutations: fn = run_mutations
    if a.digest: fn = run_digest
    with NativePostgres(a.pg_bin) as db:
        fn(db, a)
    if a.json:
        Path(a.json).write_text(json.dumps(dict(mode=fn.__name__, results=RESULTS), indent=1))
    fails = [r for r in RESULTS if r['status'] == 'FAIL']
    print('SUMMARY mode=%s pass=%d fail=%d' % (fn.__name__, len(RESULTS) - len(fails), len(fails)))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
