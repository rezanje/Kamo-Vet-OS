#!/usr/bin/env python3
"""Native PG17 proof of sub-menu access for ROLE settings (ROLE ADMIN first-class). Local socket only, no hosted DB.

  flock-free: this script takes /opt/data/kamo-heavy-test.lock itself.
  python3 -I scripts/test-role-submenu-postgres.py --pg-bin /opt/data/kamo-pg-harness/bin [--baseline] [--mutations] --json out.json

--baseline  : omit ONLY the candidate migration (RED: every new-object case must FAIL)
default     : candidate applied (GREEN: 0 FAIL)
--mutations : control + clone-per-mutant runs; every mutant must have >= 1 FAIL
"""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres  # noqa: E402

CANDIDATE = '20261108110000_role_submenu_access.sql'
EVIDENCE = Path('/opt/data/kamo-role-settings-evidence')
IDS = {r: str(uuid.UUID(int=i + 1)) for i, r in enumerate(['OWNER', 'ADMIN', 'FINANCE', 'STAFF', 'DOCTOR', 'OWNER_OFF', 'ADMIN_OFF'])}
ALL_MODULES = ['dashboard', 'klinik', 'crm', 'hris', 'pengaturan', 'perusahaan', 'buku-besar', 'kas-bank', 'penjualan', 'pembelian', 'pos',
               'aset-tetap', 'pajak', 'laporan', 'kasir', 'quest-staff', 'pos-shift']
ADMIN_POLICY = {'klinik': ['klinik.registrasi', 'klinik.antrian', 'klinik.pembayaran'],
                'pos': ['pos.stok', 'pos.kartu-stok'],
                'laporan': ['laporan.laba-rugi', 'laporan.penjualan-rinci']}


def registry():
    """module -> [ids] parsed from the TypeScript registry (single source of truth for labels/routes)."""
    text = (ROOT / 'src/lib/submenu-access.ts').read_text()
    out = {}
    for m, slug in re.findall(r'\be\("([a-z-]+)",\s*"([a-z0-9-]+)"', text):
        out.setdefault(m, []).append(f'{m}.{slug}')
    return out


def load_fixture():
    spec = importlib.util.spec_from_file_location('fullschema', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_cases(db, candidate_applied, ctx):
    """Returns [(name, ok, detail)]. Never raises: a crash inside a case is that case's FAIL."""
    cases = []
    reg = registry()
    lit = lambda x: "'" + json.dumps(x).replace("'", "''") + "'::jsonb"

    def actor(who, sql):
        ident = IDS.get(who, who)
        return (f"begin; set local role authenticated; set local request.jwt.claim.sub='{ident}'; set local request.jwt.claim.role='authenticated'; "
                f"set local request.jwt.claims='{{\"sub\":\"{ident}\",\"role\":\"authenticated\"}}'; {sql}; commit;")

    def call(who, sql):
        return db.sql(actor(who, sql))

    def config(role, who='OWNER'):
        return json.loads(call(who, f"select public.get_role_access_config('{role}')"))

    def policy(who):
        return json.loads(call(who, "select public.get_my_submenu_policy()"))

    def save(role, rev, key=None, modules=None, submenus='OMIT', mode='custom', reason='native proof', who='OWNER', caps=None):
        key = key or str(uuid.uuid4())
        modules = ALL_MODULES if modules is None else modules
        caps = {'all_branches': True, 'create_accounts': True} if caps is None and mode == 'custom' else caps
        args = f"'{role}','{rev}','{key}','{mode}',{lit(modules)},{lit(caps)},'{reason}',null"
        if submenus != 'OMIT':
            args += f",{lit(submenus)}"
        return call(who, f"select public.save_role_access_config({args})")

    def raises(fn, match):
        try:
            fn()
        except RuntimeError as e:
            assert match in str(e), f'expected {match!r} in {str(e)[-300:]!r}'
            return
        raise AssertionError(f'expected refusal {match!r}')

    def case(name, fn):
        try:
            fn()
            cases.append((name, True, ''))
            print('PASS', name, flush=True)
        except Exception as e:  # noqa: BLE001
            cases.append((name, False, str(e)[-400:]))
            print('FAIL', name, '::', str(e)[-200:].replace('\n', ' '), flush=True)

    def state():
        return db.last("select md5(coalesce((select jsonb_agg(to_jsonb(m) order by role,module_id) from public.role_modules m),'[]')::text||"
                       "coalesce((select jsonb_agg(to_jsonb(c) order by role) from public.role_capabilities c),'[]')::text||"
                       "coalesce((select jsonb_agg(to_jsonb(a) order by role) from role_settings_private.action_policies a),'[]')::text||"
                       "(select count(*) from role_settings_private.audit)::text||"
                       "(select string_agg(role||':'||epoch,',' order by role) from role_settings_private.epochs))")

    def policies_rows():
        if not candidate_applied:
            return 'n/a'
        return db.last("select coalesce(jsonb_agg(to_jsonb(p) order by role,module_id),'[]') from role_settings_private.submenu_policies p")

    # ── preflight: the new objects (RED on baseline) ──────────────────────────────────────────────
    def objects():
        have = db.last("select (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='role_settings_private' and c.relname in ('submenu_catalog','submenu_policies'))"
                       "||'/'||(select count(*) from pg_proc where proname='get_my_submenu_policy')"
                       "||'/'||(select count(*) from pg_proc where proname='save_role_access_config')"
                       "||'/'||(select max(pronargs) from pg_proc where proname='save_role_access_config')")
        assert have == '2/1/1/9', have
    case('new objects exist: catalog + policies tables, get_my_submenu_policy, ONE 9-argument save_role_access_config', objects)

    def static_header():
        text = (ROOT / 'supabase/migrations' / CANDIDATE).read_text()
        head = '\n'.join(text.splitlines()[:12]).lower()
        assert 'apply as one transaction' in head
        assert "set local lock_timeout='5s'" in text or "set local lock_timeout = '5s'" in text
        body = re.sub(r'--.*', '', text)
        assert not re.search(r'^\s*(begin|commit|rollback)\s*;', body, re.M | re.I), 'migration must not own begin/commit'
    case('migration header "apply as ONE transaction", set local lock_timeout=5s, no own begin/commit', static_header)

    def catalog_matches_registry():
        want = sorted(i for ids in reg.values() for i in ids)
        got = json.loads(db.last("select jsonb_agg(id order by id) from role_settings_private.submenu_catalog"))
        assert got == want, (len(got), len(want), sorted(set(got) ^ set(want))[:6])
        mods = json.loads(db.last("select jsonb_agg(distinct module_id order by module_id) from role_settings_private.submenu_catalog"))
        assert mods == sorted(reg), mods
    case('DB catalog == TypeScript registry (every id, every module)', catalog_matches_registry)

    # ── legacy default unchanged ─────────────────────────────────────────────────────────────────
    def legacy_unchanged():
        for role in ['ADMIN', 'FINANCE', 'STAFF', 'DOCTOR']:
            now = config(role)
            assert now['revision'] == ctx['legacy_revisions'][role], f'{role} revision changed by install'
            assert now.get('submenus') == {}, now.get('submenus')
            assert now['source'] == ctx['legacy_sources'][role]
            assert now['modules'] == ctx['legacy_modules'][role]
        assert state() == ctx['state_before'], 'installation rewrote role configuration'
        assert policy('ADMIN') == [] and policy('STAFF') == [] and policy('OWNER') == []
    case('install is additive: revisions/modules/source of every role unchanged, no policy anywhere, state hash identical', legacy_unchanged)

    def fn_drift():
        after = json.loads(db.last(ctx['funcs_sql']))
        changed = sorted(k for k, v in ctx['funcs_before'].items() if after.get(k) != v)
        added = sorted(set(after) - set(ctx['funcs_before']))
        old_save = 'save_role_access_config(text,text,uuid,text,jsonb,jsonb,text,jsonb)'
        new_save = 'save_role_access_config(text,text,uuid,text,jsonb,jsonb,text,jsonb,jsonb)'
        assert changed == [old_save], changed  # the old 8-argument overload is gone (replaced); nothing else differs
        assert old_save not in after
        assert added == sorted(['get_my_submenu_policy()', new_save]), added
        assert ctx['funcs_before'].get('role_action_allowed(text)') == after.get('role_action_allowed(text)')
    case('no other public function changed (money/RLS/action gate untouched); exactly the save RPC replaced + the read RPC added', fn_drift)

    # ── ADMIN: restrict a few sub-menus in several modules ──────────────────────────────────────
    cur = {}

    def admin_restrict():
        c = config('ADMIN')
        key = str(uuid.uuid4())
        r = json.loads(save('ADMIN', c['revision'], key=key, submenus=ADMIN_POLICY, reason='ADMIN hanya sub-menu tertentu'))
        assert r['already_applied'] is False and r['revision'] != c['revision']
        n = config('ADMIN')
        assert n['submenus'] == {k: sorted(v) for k, v in ADMIN_POLICY.items()}, n.get('submenus')
        assert n['revision'] == r['revision']
        assert n['source'] == 'custom'
        a = n['audit'][0]
        assert a['reason'] == 'ADMIN hanya sub-menu tertentu' and a['before']['submenus'] == {} and a['after']['submenus'] == n['submenus']
        cur.update(key=key, result=r, revision=n['revision'])
    case('ADMIN restricted in 3 modules: stored sorted, snapshot+revision updated, audit row has before/after', admin_restrict)

    def admin_reads_own():
        rows = policy('ADMIN')
        assert sorted((r['module_id'], tuple(r['allowed'])) for r in rows) == sorted((m, tuple(sorted(v))) for m, v in ADMIN_POLICY.items()), rows
        assert all(r['role'] == 'ADMIN' for r in rows)
    case('get_my_submenu_policy returns ADMIN its own rows', admin_reads_own)

    def others_unaffected():
        for who in ['OWNER', 'FINANCE', 'STAFF', 'DOCTOR', 'OWNER_OFF', 'ADMIN_OFF']:
            assert policy(who) == [], (who, policy(who))
        assert call('OWNER', "select public.get_my_submenu_policy()") == '[]'
        for role in ['FINANCE', 'STAFF', 'DOCTOR']:
            assert config(role)['revision'] == ctx['legacy_revisions'][role]
    case('other roles, OWNER and an inactive ADMIN see no policy; other roles revisions unchanged', others_unaffected)

    def anon_none():
        try:
            db.sql("begin; set local role anon; select public.get_my_submenu_policy(); commit;")
        except RuntimeError as e:
            assert 'permission denied' in str(e)
            return
        raise AssertionError('anon executed get_my_submenu_policy')
    case('anon cannot execute the read RPC', anon_none)

    def replay():
        before = state()
        again = json.loads(save('ADMIN', ctx['legacy_revisions']['ADMIN'], key=cur['key'], submenus=ADMIN_POLICY, reason='ADMIN hanya sub-menu tertentu'))
        assert again == {**cur['result'], 'already_applied': True}, again
        assert state() == before, 'replay wrote something'
    case('replay of the same request key is idempotent (already_applied, nothing written)', replay)

    def key_reuse():
        before = state()
        raises(lambda: save('ADMIN', ctx['legacy_revisions']['ADMIN'], key=cur['key'], submenus={'klinik': ['klinik.antrian']}, reason='ADMIN hanya sub-menu tertentu'), 'ROLE_REQUEST_KEY_REUSED')
        assert state() == before
    case('same key with different sub-menus is refused (ROLE_REQUEST_KEY_REUSED)', key_reuse)

    def stale():
        before = state()
        raises(lambda: save('ADMIN', ctx['legacy_revisions']['ADMIN'], submenus={'klinik': ['klinik.antrian']}), 'ROLE_REVISION_CONFLICT')
        assert state() == before and policies_rows() == cur.setdefault('rows', policies_rows())
    case('stale revision is refused and nothing changes', stale)

    def nonowner():
        rev = config('ADMIN')['revision']
        before = state(); rows = policies_rows()
        for who in ['ADMIN', 'FINANCE', 'STAFF', 'DOCTOR', 'OWNER_OFF', 'ADMIN_OFF']:
            raises(lambda who=who: save('ADMIN', rev, submenus={'klinik': ['klinik.antrian']}, who=who), 'ROLE_OWNER_REQUIRED')
        assert state() == before and policies_rows() == rows
    case('non-owner (ADMIN itself, FINANCE, STAFF, DOCTOR, inactive owner/admin) is refused; nothing changes', nonowner)

    def invalid():
        rev = config('ADMIN')['revision']
        before = state(); rows = policies_rows()
        bad = [
            ('unknown id', {'klinik': ['klinik.tidak-ada']}),
            ('id of another module', {'klinik': ['pos.stok']}),
            ('duplicate id', {'klinik': ['klinik.antrian', 'klinik.antrian']}),
            ('module without sub-menus', {'dashboard': ['dashboard.x']}),
            ('unknown module', {'tidak-ada': []}),
            ('value not an array', {'klinik': 'klinik.antrian'}),
            ('null element', {'klinik': [None]}),
            ('number element', {'klinik': [1]}),
            ('payload not an object', ['klinik.antrian']),
            ('module not granted in p_modules', {'klinik': ['klinik.antrian']}),
        ]
        for label, payload in bad:
            mods = [m for m in ALL_MODULES if m != 'klinik'] if label == 'module not granted in p_modules' else None
            raises(lambda payload=payload, mods=mods: save('ADMIN', rev, submenus=payload, modules=mods), 'ROLE_SUBMENU_INVALID')
        raises(lambda: save('ADMIN', rev, mode='reset', modules=[], caps=None, submenus={'klinik': []}), 'ROLE_RESET_INVALID')
        assert state() == before and policies_rows() == rows, 'a refused save wrote something'
    case('invalid payloads (10 shapes) refused with ROLE_SUBMENU_INVALID; reset+submenus refused; nothing written', invalid)

    def full_set_canonical_and_empty():
        c = config('ADMIN')
        save('ADMIN', c['revision'], submenus={'klinik': reg['klinik'], 'pos': [], 'crm': ['crm.pelanggan']})
        n = config('ADMIN')
        assert 'klinik' not in n['submenus'], 'a fully-checked module must not be stored as a restriction'
        assert n['submenus'] == {'pos': [], 'crm': ['crm.pelanggan']}, n['submenus']
        assert db.last("select count(*) from role_settings_private.submenu_policies where role='ADMIN'") == '2'
    case('full set = unrestricted (no row); empty list stored (module not accessible)', full_set_canonical_and_empty)

    def every_id_accepted():
        c = config('ADMIN')
        save('ADMIN', c['revision'], submenus={m: ids[:1] for m, ids in reg.items()})
        n = config('ADMIN')
        assert {m: v[0] for m, v in n['submenus'].items()} == {m: ids[0] for m, ids in reg.items() if len(ids) > 1}
        for m, ids in reg.items():
            for i in ids:
                save('ADMIN', config('ADMIN')['revision'], submenus={m: [i]})
                assert config('ADMIN')['submenus'].get(m, ids) in ([i], ids)
    case('every registry id is accepted by the DB catalog (one save per id)', every_id_accepted)

    def omitted_preserves_and_prunes():
        c = config('ADMIN')
        save('ADMIN', c['revision'], submenus={'klinik': ['klinik.antrian'], 'pos': ['pos.stok'], 'crm': ['crm.pelanggan']})
        # a save from an OLD page (no p_submenus): modules kept keep policy, a removed module loses it
        save('ADMIN', config('ADMIN')['revision'], modules=[m for m in ALL_MODULES if m != 'pos'])
        n = config('ADMIN')
        assert n['submenus'] == {'klinik': ['klinik.antrian'], 'crm': ['crm.pelanggan']}, n['submenus']
        save('ADMIN', config('ADMIN')['revision'])  # pos re-added without p_submenus: must NOT resurrect
        assert 'pos' not in config('ADMIN')['submenus']
    case('p_submenus omitted: kept modules keep their policy, a removed module is pruned (no resurrection)', omitted_preserves_and_prunes)

    def explicit_empty_object_clears():
        save('ADMIN', config('ADMIN')['revision'], submenus={})
        assert config('ADMIN')['submenus'] == {} and policy('ADMIN') == []
        assert db.last("select count(*) from role_settings_private.submenu_policies") == '0'
    case("p_submenus = '{}' clears every restriction", explicit_empty_object_clears)

    def reset_clears():
        save('ADMIN', config('ADMIN')['revision'], submenus=ADMIN_POLICY)
        assert len(policy('ADMIN')) == 3
        e0 = db.last("select epoch from role_settings_private.epochs where role='ADMIN'")
        save('ADMIN', config('ADMIN')['revision'], mode='reset', modules=[], caps=None)
        n = config('ADMIN')
        assert n['submenus'] == {} and n['source'] == 'defaults' and policy('ADMIN') == []
        assert int(db.last("select epoch from role_settings_private.epochs where role='ADMIN'")) == int(e0) + 1
        assert n['revision'] != ctx['legacy_revisions']['ADMIN'], 'ABA: reset must not restore an old revision'
    case('reset clears sub-menu policy together with modules; epoch advances (no ABA revision)', reset_clears)

    def direct_writes_denied():
        for who_sql in ["insert into role_settings_private.submenu_policies(role,module_id,allowed) values('ADMIN','klinik','{klinik.antrian}')",
                        "update role_settings_private.submenu_policies set allowed='{}'",
                        "delete from role_settings_private.submenu_policies",
                        "truncate role_settings_private.submenu_policies",
                        "insert into role_settings_private.submenu_catalog(id,module_id) values('klinik.x','klinik')",
                        "select * from role_settings_private.submenu_policies"]:
            raises(lambda s=who_sql: call('OWNER', s), 'permission denied')
        # a session that looks like an app user (JWT sub set) but owns no permit is refused by the guard trigger itself
        raises(lambda: db.sql(f"begin; set local request.jwt.claim.sub='{IDS['OWNER']}'; "
                              "insert into role_settings_private.submenu_policies(role,module_id,allowed) values('ADMIN','klinik','{klinik.antrian}'); commit;"),
               'Pengaturan akses berubah')
        raises(lambda: db.sql(f"begin; set local request.jwt.claim.sub='{IDS['OWNER']}'; truncate role_settings_private.submenu_policies; commit;"), 'Pengaturan akses berubah')
        assert db.last("select count(*) from role_settings_private.submenu_policies") == '0'
    case('direct writes/reads of the private tables are refused for API roles; permit-less app-like writes and TRUNCATE hit the guard trigger', direct_writes_denied)

    def check_constraints():
        raises(lambda: db.sql("insert into role_settings_private.submenu_policies(role,module_id,allowed) values('OWNER','klinik','{}')"), 'violates check constraint')
        raises(lambda: db.sql("insert into role_settings_private.submenu_catalog(id,module_id) values('klinik.zzz','pos')"), 'violates check constraint')
    case('OWNER can never hold a policy row; catalog id must be prefixed by its module (table constraints)', check_constraints)

    def revision_covers_policy():
        save('ADMIN', config('ADMIN')['revision'], submenus={'klinik': ['klinik.antrian']})
        r1 = config('ADMIN')['revision']
        # a maintenance edit (no epoch bump) of ONLY the policy must still change the revision
        db.sql("update role_settings_private.submenu_policies set allowed=array['klinik.registrasi'] where role='ADMIN' and module_id='klinik'")
        assert config('ADMIN')['revision'] != r1, 'revision does not cover sub-menu policy'
        db.sql("update role_settings_private.submenu_policies set allowed=array['klinik.antrian'] where role='ADMIN' and module_id='klinik'")
        assert config('ADMIN')['revision'] == r1
    case('revision hash covers the sub-menu policy (maintenance edit changes it, restoring returns it)', revision_covers_policy)

    def other_function_unchanged():
        # the action gate still obeys module ceilings exactly as before: v2 ADMIN without kas-bank is refused
        db.sql("update role_settings_private.action_catalog set enforced=true where id='bank.cash_accounts.create'")
        save('ADMIN', config('ADMIN')['revision'], modules=['kas-bank'], submenus={'kas-bank': ['kas-bank.rekening']})
        assert call('ADMIN', "select public.role_action_allowed('bank.cash_accounts.create')") == 't'
        save('ADMIN', config('ADMIN')['revision'], modules=['crm'])
        assert call('ADMIN', "select public.role_action_allowed('bank.cash_accounts.create')") == 'f'
        db.sql("update role_settings_private.action_catalog set enforced=false where id='bank.cash_accounts.create'")
    case('DB action gate (role_action_allowed) unaffected by sub-menu policy: module ceiling still decides', other_function_unchanged)

    def final_restrict_for_bridge():
        save('ADMIN', config('ADMIN')['revision'], submenus=ADMIN_POLICY)
        rules = json.loads(call('ADMIN', "select coalesce(jsonb_agg(jsonb_build_object('role',role,'module_id',module_id)),'[]') from public.role_modules"))
        pol = policy('ADMIN')
        assert len(pol) == 3 and len([r for r in rules if r['role'] == 'ADMIN']) == len(ALL_MODULES) + 1, (len(pol), len(rules))
    case('ADMIN left restricted (3 modules) with v2 marker + 17 module rows for the DB -> TypeScript bridge', final_restrict_for_bridge)

    def reapply_fails_closed():
        before = state(); rows = policies_rows()
        text = (ROOT / 'supabase/migrations' / CANDIDATE).read_text()
        try:
            db.sql('begin;\n' + text + '\ncommit;')
        except RuntimeError:
            assert state() == before and policies_rows() == rows
            return
        raise AssertionError('re-applying the migration silently succeeded')
    case('re-applying the migration fails closed (one transaction, nothing changes)', reapply_fails_closed)
    return cases


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--pg-bin', default='/opt/data/kamo-pg-harness/bin')
    ap.add_argument('--baseline', action='store_true')
    ap.add_argument('--mutations', action='store_true')
    ap.add_argument('--json')
    args = ap.parse_args()
    candidate_path = ROOT / 'supabase/migrations' / CANDIDATE
    candidate = candidate_path.read_text() if candidate_path.exists() else None
    report = {'candidate': CANDIDATE, 'candidate_sha256': hashlib.sha256(candidate.encode()).hexdigest() if candidate else None,
              'baseline': args.baseline, 'control': [], 'mutants': []}
    with open('/opt/data/kamo-heavy-test.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        fixture = load_fixture()
        with tempfile.TemporaryDirectory(prefix='submenu-chain-', dir='/opt/data') as tmp:
            migrations = Path(tmp) / 'supabase/migrations'
            migrations.mkdir(parents=True)
            names = sorted(p.name for p in (ROOT / 'supabase/migrations').glob('*.sql') if p.name != CANDIDATE)
            for n in names:
                (migrations / n).symlink_to(ROOT / 'supabase/migrations' / n)
            fixture.ROOT = Path(tmp)
            report['chain_migrations'] = len(names)
            with NativePostgres(args.pg_bin) as db:
                fixture.DisposablePostgres.bootstrap(db)
                assert 170000 <= int(db.last('show server_version_num')) < 180000
                for role, ident in IDS.items():
                    base = role.split('_')[0]
                    db.sql(f"insert into auth.users(id,email) values('{ident}','{role.lower()}@fiction.invalid') on conflict do nothing; "
                           f"update profiles set role='{base}',is_active={'false' if role.endswith('_OFF') else 'true'} where id='{ident}';")
                # legacy fixtures that must survive installation untouched
                db.sql("insert into role_modules(role,module_id) values('STAFF','klinik'),('FINANCE','dashboard'),('DOCTOR','crm') on conflict do nothing;")
                funcs_sql = ("select jsonb_object_agg(p.oid::regprocedure::text, md5(concat_ws('|',pg_get_functiondef(p.oid),p.proacl::text,p.proconfig::text,p.prosecdef))) "
                             "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'")
                ctx_base = {'funcs_sql': funcs_sql}
                # snapshot() is private; read via the existing OWNER reader for the pre-install legacy view
                def owner_cfg(role):
                    ident = IDS['OWNER']
                    return json.loads(db.last(f"begin; set local role authenticated; set local request.jwt.claim.sub='{ident}'; set local request.jwt.claim.role='authenticated'; select public.get_role_access_config('{role}'); commit;"))
                ctx_base['legacy_revisions'] = {r: owner_cfg(r)['revision'] for r in ['ADMIN', 'FINANCE', 'STAFF', 'DOCTOR']}
                ctx_base['legacy_sources'] = {r: owner_cfg(r)['source'] for r in ['ADMIN', 'FINANCE', 'STAFF', 'DOCTOR']}
                ctx_base['legacy_modules'] = {r: owner_cfg(r)['modules'] for r in ['ADMIN', 'FINANCE', 'STAFF', 'DOCTOR']}
                ctx_base['funcs_before'] = json.loads(db.last(funcs_sql))
                ctx_base['state_before'] = db.last(
                    "select md5(coalesce((select jsonb_agg(to_jsonb(m) order by role,module_id) from public.role_modules m),'[]')::text||"
                    "coalesce((select jsonb_agg(to_jsonb(c) order by role) from public.role_capabilities c),'[]')::text||"
                    "coalesce((select jsonb_agg(to_jsonb(a) order by role) from role_settings_private.action_policies a),'[]')::text||"
                    "(select count(*) from role_settings_private.audit)::text||"
                    "(select string_agg(role||':'||epoch,',' order by role) from role_settings_private.epochs))")
                db.sql('create database tpl_submenu_base template postgres;') if args.mutations else None

                def apply(text, database=None):
                    if database:
                        os.environ['PGDATABASE'] = database
                    try:
                        db.sql('begin;\n' + text + '\ncommit;')
                    finally:
                        if database:
                            os.environ.pop('PGDATABASE', None)

                if candidate and not args.baseline:
                    apply(candidate)
                report['control'] = run_cases(db, bool(candidate and not args.baseline), dict(ctx_base))
                fails = [c for c in report['control'] if not c[1]]
                report['control_fail'] = len(fails)
                # DB -> TypeScript bridge (ADMIN reach through the real middleware resolver)
                if candidate and not args.baseline and not fails:
                    # the control run left ADMIN restricted with ADMIN_POLICY
                    sq = lambda who, s: json.loads(db.last(f"begin; set local role authenticated; set local request.jwt.claim.sub='{IDS[who]}'; set local request.jwt.claim.role='authenticated'; {s}; commit;"))
                    rules = sq('ADMIN', "select coalesce(jsonb_agg(jsonb_build_object('role',role,'module_id',module_id)),'[]') from public.role_modules")
                    fixture_json = {'rules': rules, 'policy': sq('ADMIN', 'select public.get_my_submenu_policy()'),
                                    'staff_policy': sq('STAFF', 'select public.get_my_submenu_policy()'), 'owner_policy': sq('OWNER', 'select public.get_my_submenu_policy()')}
                    EVIDENCE.mkdir(parents=True, exist_ok=True)
                    fx = EVIDENCE / 'submenu-bridge-fixture.json'
                    fx.write_text(json.dumps(fixture_json, indent=1))
                    r = subprocess.run(['npx', 'vitest', 'run', 'src/lib/__tests__/submenu-pg-bridge.test.ts'], cwd=ROOT, env={**os.environ, 'SUBMENU_PG_FIXTURE': str(fx)}, capture_output=True, text=True, timeout=240)
                    bridge = {'returncode': r.returncode, 'tail': (r.stdout + r.stderr)[-600:]}
                    report['bridge'] = bridge
                    print('BRIDGE', 'PASS' if r.returncode == 0 else 'FAIL', flush=True)
                if args.mutations:
                    from submenu_mutants import MUTANTS  # local module next to this script
                    for name, old, new in MUTANTS:
                        assert candidate.count(old) == 1, f'mutation anchor must occur exactly once: {name}: {candidate.count(old)}'
                        variant = 'v_' + re.sub(r'[^a-z0-9]', '_', name.lower())[:40]
                        db.sql(f'create database {variant} template tpl_submenu_base;')
                        apply(candidate.replace(old, new), variant)
                        os.environ['PGDATABASE'] = variant
                        try:
                            res = run_cases(db, True, dict(ctx_base))
                        finally:
                            os.environ.pop('PGDATABASE', None)
                        failed = [c[0] for c in res if not c[1]]
                        report['mutants'].append({'name': name, 'killed': bool(failed), 'failed_cases': failed})
                        print('MUTANT', 'KILLED' if failed else 'SURVIVED', name, flush=True)
    report['summary'] = {'control_pass': sum(1 for c in report['control'] if c[1]), 'control_fail': sum(1 for c in report['control'] if not c[1]),
                         'mutants_killed': sum(1 for m in report['mutants'] if m['killed']), 'mutants_total': len(report['mutants'])}
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=1))
    print(json.dumps(report['summary']))
    if args.baseline:
        sys.exit(0 if report['summary']['control_fail'] > 0 else 1)
    ok = report['summary']['control_fail'] == 0 and all(m['killed'] for m in report['mutants']) and (report.get('bridge') or {}).get('returncode', 0) == 0
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
