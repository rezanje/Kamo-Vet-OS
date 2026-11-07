#!/usr/bin/env python3
"""Native full schema: archive ("Diarsipkan") of clinic queue visits, fictional fixtures, throwaway local cluster, no network.

Andri 4 Nov 2026: stuck/trial visits must leave the working queue WITHOUT permanent deletion; only OWNER/ADMIN archive and
unarchive; archive is refused when money/clinical content/open inpatient exists. Every guard here is enforced in the DB.

  python3 -I scripts/test-antrian-arsip-postgres.py --pg-bin /opt/data/kamo-pg-harness/bin --json out.json
  --baseline   omit only the candidate migration (RED)
  --mutations  one chain, then each guard removed from the candidate in a cloned database; every mutant must be KILLED
  --attach DIR run against an already running cluster (development only; the DB `postgres` must hold the fixtures)
Heavy: wrap in `flock /opt/data/kamo-heavy-test.lock`.
"""
import argparse, contextlib, importlib.util, json, os, re, subprocess, sys, tempfile, time
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('medical', ROOT / 'scripts/test-rekam-full-edit-postgres.py'); assert spec and spec.loader
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
x, r, q, j = m.x, m.r, m.q, m.j
dp = x.dp
CANDIDATE = '20261106400000_antrian_arsip_kunjungan.sql'
FOLLOWUP = '20261107220000_antrian_arsip_paksa_dan_selesai_erp.sql'   # follow-up (Andri 4 Nov 2026): owner force-archive + Selesai only when ERP-origin
RESULTS = []
ADMIN2, ADMIN_OFF, OWNER_OFF = r.uid('a', 50), r.uid('a', 51), r.uid('a', 52)   # admin of another branch / inactive admin / inactive owner
REASON = 'Percobaan batal fiktif'


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:500], flush=True)


def arch(v, key, reason=REASON): return f"select public.clinic_archive_visit({q(v)},{q(reason) if reason is not None else 'null'},{q(key)});"
def unarch(v, key, reason=None): return f"select public.clinic_unarchive_visit({q(v)},{q(reason) if reason is not None else 'null'},{q(key)});"
def row(h, v): return json.loads(h.nilai(f"select to_jsonb(t) from (select status::text status,archived_at,archived_by,archive_reason,service_started_at,service_finished_at,checked_out_at from public.visits where id={q(v)}) t") or 'null')
def events(h, v=None): return h.angka(f"select count(*) from public.visit_archive_events{'' if v is None else f' where visit_id={q(v)}'}")
def logs(h, v): return h.angka(f"select count(*) from public.activity_log where entity='visits' and entity_id={q(v)}")
def is_archived(h, v): return row(h, v)['archived_at'] is not None
def jwt(user): return "select set_config('request.jwt.claims'," + q(json.dumps(dict(sub=user, role='authenticated'))) + ',false);\n'


def bare(h, n, status='Diperiksa', record=True, branch=None):
    """A visit that was never really examined (Andri: 'masih coba2 / batal'): optionally an EMPTY medical record draft."""
    cust = r.buat_pelanggan(h, n); v, pet, mr = r.uid(6, n), r.uid(5, n), r.uid(7, n)
    started = "now()-interval '30 minutes'" if status != 'Menunggu' else 'null'
    finished = "now()-interval '5 minutes'" if status == 'Pembayaran' else 'null'
    h.sql(f"insert into public.pets(id,customer_id,name) values({q(pet)},{q(cust['id'])},'Pasien Arsip {n}');"
          f"insert into public.visits(id,branch_id,customer_id,pet_id,status,queue_number,service_started_at,service_finished_at,checked_in_at)"
          f" values({q(v)},{q(branch or r.BRANCH)},{q(cust['id'])},{q(pet)},'{status}','A{n % 1000:03d}',{started},{finished},now()-interval '1 hour');")
    if record: h.sql(f"insert into public.medical_records(id,visit_id) values({q(mr)},{q(v)});")
    return v, mr


def force_archive(h, v, actor=r.OWNER):
    """The state the RPC refuses to create (e.g. a visit that already carries a pending cart) -- planted by hand to test the ENTRY guards."""
    h.sql(jwt(actor) + f"begin; insert into clinic_private.visit_archive_permits values(txid_current(),{q(actor)},{q(v)});"
          f"update public.visits set archived_at=now(),archived_by={q(actor)},archive_reason='Dipaksa untuk uji pelindung' where id={q(v)}; commit;")


def pay_lines(n): return r.baris(n, 1, 2, 3, 4)


def preflight(h):
    """Presence checks first so a baseline (RED) run reports what is missing instead of crashing on the first call."""
    have = dict(col=h.angka("select count(*) from information_schema.columns where table_schema='public' and table_name='visits' and column_name in ('archived_at','archived_by','archive_reason')") == 3,
                archive=h.angka("select count(*) from pg_proc where proname='clinic_archive_visit' and pronamespace='public'::regnamespace") == 1,
                unarchive=h.angka("select count(*) from pg_proc where proname='clinic_unarchive_visit' and pronamespace='public'::regnamespace") == 1,
                events=h.nilai("select to_regclass('public.visit_archive_events') is not null") == 't',
                guard=h.angka("select count(*) from pg_trigger where tgname in ('a0_guard_visit_archive','a0_refuse_archived_visit') and not tgisinternal") >= 1)
    for k, ok in have.items(): check(f'preflight: {k} exists', ok, {})
    return all(have.values())


def run(h, setup=True):
    if setup: x.setup(h)
    if not preflight(h): return
    h.sql(f"""insert into auth.users(id,raw_user_meta_data) values({q(ADMIN2)},'{{"full_name":"Admin Cabang Lain Fiktif"}}'),({q(ADMIN_OFF)},'{{"full_name":"Admin Nonaktif Fiktif"}}'),({q(OWNER_OFF)},'{{"full_name":"Owner Nonaktif Fiktif"}}');
update public.profiles set role='ADMIN' where id in({q(ADMIN2)},{q(ADMIN_OFF)}); update public.profiles set role='OWNER' where id={q(OWNER_OFF)};
update public.profiles set is_active=false where id in({q(ADMIN_OFF)},{q(OWNER_OFF)});
insert into public.user_branches(user_id,branch_id) values({q(ADMIN2)},{q(r.BRANCH2)}),({q(ADMIN_OFF)},{q(r.BRANCH)});""")
    ids = []; keyn = [0]
    def key(prefix='arsip'): keyn[0] += 1; return f'{prefix}-key-{keyn[0]:04d}'
    if os.environ.get('ARSIP_PARTS'):   # development / targeted mutation runs only: just the named follow-up parts (comma-separated function names)
        for part in os.environ['ARSIP_PARTS'].split(','):
            try: globals()[part](h, key)
            except Exception as e: check(f'HARNESS follow-up {part}', False, str(e)[:500])
        return

    # ---------------------------------------------------------------- 1. roles
    v, mr = bare(h, 3001, 'Diperiksa'); before = row(h, v); k = key()
    out = h.nilai(arch(v, k), r.OWNER); after = row(h, v); ev = json.loads(h.nilai(f"select to_jsonb(e) from public.visit_archive_events e where visit_id={q(v)}") or 'null')
    check('OWNER archives a bare Diperiksa visit (empty medical-record draft): hidden-state set, status/timestamps/record untouched, row still exists',
          bool(after) and after['archived_at'] and after['archived_by'] == r.OWNER and after['archive_reason'] == REASON and after['status'] == 'Diperiksa'
          and after['service_started_at'] == before['service_started_at'] and h.angka(f"select count(*) from public.medical_records where visit_id={q(v)}") == 1, dict(out=out, after=after))
    check('append-only audit event written: action, reason, actor, name, status at the time, request key', bool(ev) and ev['action'] == 'archive' and ev['reason'] == REASON
          and ev['created_by'] == r.OWNER and ev['visit_status'] == 'Diperiksa' and ev['request_key'] == k and ev['created_by_name'] == 'Pengguna Fiktif 1' and events(h, v) == 1, dict(event=ev))
    act = json.loads(h.nilai(f"select to_jsonb(a) from public.activity_log a where entity='visits' and entity_id={q(v)} and 'archived_at'=any(changed_fields) order by id desc limit 1") or 'null')
    check('existing activity_log also captured the visits update (actor + archived_at in changed_fields; reason text NOT copied)', bool(act) and act['actor_id'] == r.OWNER and 'archived_at' in act['changed_fields']
          and 'archive_reason' not in json.dumps(act['after_state']), dict(act=act))
    arch_owner = v
    for who, label, n, st in [(r.ADMIN, 'ADMIN', 3002, 'Menunggu'), (r.ADMIN, 'ADMIN', 3003, 'Pembayaran')]:
        vv, _ = bare(h, n, st); err = h.gagal(arch(vv, key()), who)
        check(f'{label} archives a bare {st} visit (nothing financial exists)', not err and is_archived(h, vv) and row(h, vv)['status'] == st, dict(error=err))
    for who, label in [(r.STAFF, 'STAFF'), (r.DOCTOR, 'DOCTOR'), (r.FINANCE, 'FINANCE')]:
        vv, _ = bare(h, 3010 + len(ids), 'Diperiksa'); ids.append(vv); e0 = events(h)
        err = h.gagal(arch(vv, key()), who)
        check(f'{label} cannot archive: ACCESS_DENIED inside the DB, nothing changed, no event', bool(err and 'ACCESS_DENIED' in err) and not is_archived(h, vv) and events(h) == e0, dict(error=(err or '')[:160]))
    for who, label in [(ADMIN_OFF, 'inactive ADMIN'), (OWNER_OFF, 'inactive OWNER')]:
        err = h.gagal(arch(ids[0], key()), who)
        check(f'{label} cannot archive (active account required)', bool(err and 'ACCESS_DENIED' in err) and not is_archived(h, ids[0]), dict(error=(err or '')[:160]))
    err = h.gagal(arch(ids[0], key()), ADMIN2)
    check('ADMIN of ANOTHER branch cannot archive this branch visit (not found / branch not accessible)', bool(err and 'ARCHIVE_NOT_FOUND' in err) and not is_archived(h, ids[0]), dict(error=(err or '')[:160]))
    err = h.gagal("set role anon;\n" + arch(ids[0], key()))
    check('anon cannot call the RPC at all (ACL)', bool(err and 'permission denied' in err) and not is_archived(h, ids[0]), dict(error=(err or '')[:160]))
    err = h.gagal("set role authenticated; select set_config('request.jwt.claims','',false);\n" + arch(ids[0], key()))
    check('authenticated without a JWT subject is refused', bool(err and 'ACCESS_DENIED' in err) and not is_archived(h, ids[0]), dict(error=(err or '')[:160]))
    err = h.gagal(arch(r.uid(6, 99999), key()), r.OWNER)
    check('unknown visit -> ARCHIVE_NOT_FOUND', bool(err and 'ARCHIVE_NOT_FOUND' in err), dict(error=(err or '')[:160]))

    # ---------------------------------------------------------------- 2. reason mandatory
    v, _ = bare(h, 3020, 'Diperiksa'); e0 = events(h)
    for label, reason in [('null', None), ('empty', ''), ('blank spaces', '      '), ('4 characters', 'abcd'), ('501 characters', 'x' * 501)]:
        err = h.gagal(arch(v, key(), reason), r.OWNER)
        check(f'archive reason {label} refused (ARCHIVE_INVALID); nothing written', bool(err and 'ARCHIVE_INVALID' in err) and not is_archived(h, v) and events(h) == e0, dict(error=(err or '')[:160]))
    err = h.gagal(arch(v, 'short', REASON), r.OWNER)
    check('request key shorter than 8 characters refused', bool(err and 'ARCHIVE_INVALID' in err) and not is_archived(h, v), dict(error=(err or '')[:160]))
    err = h.gagal(arch(v, key(), '   Uji dipangkas fiktif   '), r.ADMIN)
    check('reason is trimmed before it is stored', not err and row(h, v)['archive_reason'] == 'Uji dipangkas fiktif', dict(error=err))

    # ---------------------------------------------------------------- 3. refusals (each one alone, then the real flows)
    def refused(label, vv, phrase, user=r.OWNER):
        e0, a0 = events(h), h.angka('select count(*) from public.visits where archived_at is not null'); err = h.gagal(arch(vv, key()), user)
        check(f'refused: {label}', bool(err and 'ARCHIVE_BLOCKED' in err and phrase in err) and not is_archived(h, vv) and events(h) == e0
              and h.angka('select count(*) from public.visits where archived_at is not null') == a0, dict(error=(err or '')[:300]))
    v, mr = bare(h, 3030, 'Diperiksa'); h.sql(f"insert into public.prescription_items(medical_record_id,nama_obat,qty,harga,satuan,jenis,kategori,faktor) values({q(mr)},'Jasa Pending Fiktif',1,50000,'kali','jasa','Tindakan',1);")
    refused('pending (unpaid, not yet invoiced) billing cart row', v, 'tagihan tertunda')
    v, mr = bare(h, 3031, 'Diperiksa'); h.sql(f"update public.medical_records set diagnosis='Diagnosis Fiktif' where id={q(mr)};")
    refused('saved clinical content (diagnosis) in the medical record', v, 'data klinis')
    v, mr = bare(h, 3032, 'Diperiksa'); h.sql(f"update public.medical_records set submission_key='initial-3032',submitted_by={q(r.DOCTOR)} where id={q(mr)};")
    refused('medical record already submitted by a doctor (even with empty fields)', v, 'data klinis')
    v, mr = bare(h, 3033, 'Diperiksa'); cid = r.uid('d', 3033)
    h.sql(f"insert into public.consents(id,visit_id,template_id,tindakan,isi_snapshot) values({q(cid)},{q(v)},{q(r.TEMPLATE_CONSENT)},'Fiktif','Fiktif');")
    ok_unsigned = not h.gagal(arch(v, key()), r.OWNER) and is_archived(h, v)
    check('control: an UNSIGNED consent draft does not block archiving', ok_unsigned, {})
    v, mr = bare(h, 3034, 'Diperiksa'); cid = r.uid('d', 3034)
    h.sql(f"insert into public.consents(id,visit_id,template_id,tindakan,isi_snapshot) values({q(cid)},{q(v)},{q(r.TEMPLATE_CONSENT)},'Fiktif','Fiktif');", r.OWNER)
    h.sql(f"update public.consents set status='sudah_ttd',signer_name='Fiktif',signature_data='data:image/png;base64,ZmlrdGlm',signed_at=now() where id={q(cid)};", r.OWNER)
    refused('signed consent', v, 'persetujuan yang sudah ditandatangani')
    v, mr = bare(h, 3035, 'Selesai'); h.sql(f"update public.visits set checked_out_at=now(),legacy_source_key='fiktif::0800::pasien::01012026' where id={q(v)};")
    refused('visit already Selesai that was IMPORTED (legacy_source_key set) = history, not archivable (follow-up rule: Selesai only when ERP-origin)', v, 'sudah selesai')
    v, mr = bare(h, 3036, 'Diperiksa'); h.sql(f"insert into public.invoices(visit_id,subtotal,total,paid_status,shift_id) values({q(v)},0,0,'Belum Lunas',{q(r.SHIFT[r.STAFF])});")
    refused('invoice bound to a cashier shift (even an empty one)', v, 'tagihan/invoice')
    v, mr = bare(h, 3037, 'Diperiksa'); h.sql(f"insert into public.invoices(visit_id,subtotal,total,paid_status,voided_at) values({q(v)},0,0,'Belum Lunas',now());")
    refused('VOIDED invoice still counts as financial history', v, 'tagihan/invoice')
    # real flows: ranap admitted (open inpatient + signed consent + pending cart)
    cust = r.buat_pelanggan(h, 3040); v = r.buat_kunjungan(h, 3040, cust, admitted=True)
    refused('open inpatient admission (+ signed consent + pending items)', v, 'rawat inap masih berjalan')
    err = h.gagal(arch(v, key()), r.OWNER); lst = err or ''
    check('the refusal names every blocker (open inpatient, signed consent, pending items) so staff can read it', all(w in lst for w in ['rawat inap masih berjalan', 'persetujuan yang sudah ditandatangani', 'tagihan tertunda']), dict(error=lst[:400]))
    v = dp.visit(h, 3041); err = h.gagal(r.tagih_biasa_sql(v, 'inv-3041', pay_lines(3041), r.OWNER, dp=0, alasan='Uji fiktif'), r.OWNER)
    refused('real invoice posted through clinic_post_invoice (unpaid)', v, 'tagihan/invoice')
    inv = h.aktif(v); err = h.gagal(f"select public.clinic_receive_invoice_payment({q(inv)},'2026-11-03',{int(r.nilai_baris(pay_lines(3041)))},'Tunai','110003','Fiktif','settle-3041');", r.OWNER)
    refused('real payment received on that invoice', v, 'sudah ada pembayaran')
    shift_linked = h.angka(f"select count(*) from public.invoices where visit_id={q(v)} and shift_id is not null")
    check('(fixture sanity) the paid invoice is shift-linked', shift_linked == 1 and not err, dict(error=err))
    v, mr = bare(h, 3042, 'Pembayaran')
    h.sql(f"insert into public.invoices(id,visit_id,subtotal,total,paid_status) values({q(r.uid('f', 3042))},{q(v)},0,0,'Lunas');")

    # ---------------------------------------------------------------- 4. idempotent replay / stale state
    v, _ = bare(h, 3050, 'Diperiksa'); k = key('replay')
    first = json.loads(h.nilai(arch(v, k), r.OWNER)); a1 = row(h, v)['archived_at']; l1 = logs(h, v)
    second = json.loads(h.nilai(arch(v, k), r.OWNER))
    check('exact replay (same key) returns the stored result and writes NOTHING: one event, same archived_at, no extra activity_log row', first['replay'] is False and second['replay'] is True
          and second['event_id'] == first['event_id'] and events(h, v) == 1 and row(h, v)['archived_at'] == a1 and logs(h, v) == l1, dict(first=first, second=second))
    err = h.gagal(arch(v, key(), 'Alasan lain fiktif'), r.ADMIN)
    check('stale state: a NEW request on an already archived visit -> ARCHIVE_STALE, no second event', bool(err and 'ARCHIVE_STALE' in err) and events(h, v) == 1, dict(error=(err or '')[:160]))
    other, _ = bare(h, 3051, 'Diperiksa')
    err = h.gagal(arch(other, k), r.OWNER)
    check('the same key cannot archive a DIFFERENT visit (key reuse refused)', bool(err and 'ARCHIVE_INVALID' in err) and not is_archived(h, other), dict(error=(err or '')[:160]))
    err = h.gagal(arch(v, k), r.ADMIN)
    check('the same key replayed by ANOTHER actor is refused, not answered', bool(err and 'ARCHIVE_INVALID' in err) and events(h, v) == 1, dict(error=(err or '')[:160]))
    for who, label in [(r.STAFF, 'STAFF'), (r.DOCTOR, 'DOCTOR'), (r.FINANCE, 'FINANCE')]:
        err = h.gagal(unarch(v, key()), who)
        check(f'{label} cannot unarchive', bool(err and 'ACCESS_DENIED' in err) and is_archived(h, v), dict(error=(err or '')[:160]))
    kun = key('unarch'); st0 = row(h, v)['status']
    out = json.loads(h.nilai(unarch(v, kun, 'Salah arsip fiktif'), r.ADMIN)); after = row(h, v)
    check('ADMIN unarchives: columns cleared, status untouched (the visit returns to its previous list), unarchive event with reason', after['archived_at'] is None and after['archived_by'] is None and after['archive_reason'] is None
          and after['status'] == st0 and events(h, v) == 2 and h.nilai(f"select reason from public.visit_archive_events where visit_id={q(v)} and action='unarchive'") == 'Salah arsip fiktif', dict(out=out, after=after))
    again = json.loads(h.nilai(unarch(v, kun, 'Salah arsip fiktif'), r.ADMIN))
    check('unarchive replay is idempotent', again['replay'] is True and events(h, v) == 2, dict(again=again))
    err = h.gagal(unarch(v, key()), r.OWNER)
    check('stale unarchive of a visit that is not archived -> ARCHIVE_STALE', bool(err and 'ARCHIVE_STALE' in err) and events(h, v) == 2, dict(error=(err or '')[:160]))
    err = h.gagal(arch(v, kun), r.OWNER)
    check('a key used for unarchive cannot be reused to archive', bool(err and 'ARCHIVE_INVALID' in err) and not is_archived(h, v), dict(error=(err or '')[:160]))
    check('archive again after unarchive works with a fresh key (the cycle is repeatable)', not h.gagal(arch(v, key()), r.OWNER) and is_archived(h, v) and events(h, v) == 3, {})
    v_cycle = v

    # ---------------------------------------------------------------- 5. row lock + re-check under the lock
    v, _ = bare(h, 3060, 'Diperiksa'); barriers = []; kk = key('race')
    with contextlib.ExitStack() as stack:
        obs = stack.enter_context(x.c.Session(h.db, 'arsip-observer')); a = stack.enter_context(x.c.Session(h.db, 'arsip-a')); b = stack.enter_context(x.c.Session(h.db, 'arsip-b'))
        a.sql(x.claims(r.OWNER)); b.sql(x.claims(r.ADMIN))
        a.sql('begin;' + arch(v, kk)); b.send('begin;' + arch(v, key('race')))
        x.c.wait_block(obs, b, a, barriers); a.sql('commit;'); out = x.c.attempt(b, commit=False)   # psql stops at the first error (ON_ERROR_STOP): nothing may be sent afterwards
    check('two admins at once: the second WAITS on the visit row lock, then is refused ARCHIVE_STALE; exactly one event', (not out['ok']) and 'ARCHIVE_STALE' in out.get('error', '') and events(h, v) == 1 and len(barriers) == 1, dict(outcome=str(out)[:200], barriers=len(barriers)))
    v, _ = bare(h, 3061, 'Diperiksa'); barriers = []; kk = key('race')
    with contextlib.ExitStack() as stack:
        obs = stack.enter_context(x.c.Session(h.db, 'arsip-observer2')); a = stack.enter_context(x.c.Session(h.db, 'arsip-a2')); b = stack.enter_context(x.c.Session(h.db, 'arsip-b2'))
        a.sql(x.claims(r.OWNER)); b.sql(x.claims(r.OWNER))
        a.sql('begin;' + arch(v, kk)); b.send('begin;' + arch(v, kk))
        x.c.wait_block(obs, b, a, barriers); a.sql('commit;'); out = x.c.attempt(b, commit=False)
        if out['ok']: b.sql('commit;')
    check('the SAME request fired twice concurrently: the second waits, then answers replay=true; one event, one log row', out['ok'] and '"replay": true' in json.dumps(out) .replace('\\"', '"') + json.dumps(out.get('result')) and events(h, v) == 1 and len(barriers) == 1, dict(outcome=str(out)[:200]))
    # a cashier/other transaction holds the visit lock and commits an invoice; the archive then RE-CHECKS under the lock
    v, _ = bare(h, 3062, 'Diperiksa'); barriers = []
    with contextlib.ExitStack() as stack:
        obs = stack.enter_context(x.c.Session(h.db, 'arsip-observer3')); holder = stack.enter_context(x.c.Session(h.db, 'arsip-holder')); waiter = stack.enter_context(x.c.Session(h.db, 'arsip-waiter'))
        waiter.sql(x.claims(r.OWNER))
        holder.sql(f"begin; select id from public.visits where id={q(v)} for update;")
        waiter.send('begin;' + arch(v, key('lock')))
        x.c.wait_block(obs, waiter, holder, barriers)
        holder.sql(f"insert into public.invoices(visit_id,subtotal,total,paid_status) values({q(v)},100,100,'Belum Lunas'); commit;")
        out = x.c.attempt(waiter, commit=False)
    check('archive blocked behind another transaction that then commits an invoice: the rule is RE-CHECKED under the lock -> ARCHIVE_BLOCKED, not archived', (not out['ok']) and 'ARCHIVE_BLOCKED' in out.get('error', '') and not is_archived(h, v) and events(h, v) == 0 and len(barriers) == 1, dict(outcome=str(out)[:240]))

    # ---------------------------------------------------------------- 6. archive columns cannot be written around the RPC
    v, _ = bare(h, 3070, 'Diperiksa'); archv, _ = bare(h, 3071, 'Diperiksa'); h.sql(arch(archv, key()), r.OWNER)
    for who, label in [(r.STAFF, 'STAFF'), (r.DOCTOR, 'DOCTOR'), (r.FINANCE, 'FINANCE'), (r.ADMIN, 'ADMIN'), (r.OWNER, 'OWNER')]:
        e1 = h.gagal(f"update public.visits set archived_at=now(),archived_by={q(who)},archive_reason='Langsung fiktif' where id={q(v)};", who)
        e2 = h.gagal(f"update public.visits set archived_at=null,archived_by=null,archive_reason=null where id={q(archv)};", who)
        check(f'{label}: direct UPDATE of the archive columns (archive and unarchive) is refused by the visits guard', bool(e1 and 'ARCHIVE_LOCKED' in e1) and bool(e2 and 'ARCHIVE_LOCKED' in e2) and not is_archived(h, v) and is_archived(h, archv), dict(e1=(e1 or '')[:100], e2=(e2 or '')[:100]))
    e = h.gagal(f"update public.visits set archive_reason='Ganti alasan fiktif' where id={q(archv)};", r.OWNER)
    check('the archive reason cannot be rewritten directly either', bool(e and 'ARCHIVE_LOCKED' in e) and row(h, archv)['archive_reason'] == REASON, dict(error=(e or '')[:100]))
    e = h.gagal(f"insert into public.visits(branch_id,customer_id,pet_id,status,archived_at,archived_by,archive_reason) select branch_id,customer_id,pet_id,'Menunggu',now(),{q(r.OWNER)},'Lahir diarsipkan' from public.visits where id={q(v)};", r.OWNER)
    check('a new visit cannot be born archived', bool(e and 'ARCHIVE_LOCKED' in e), dict(error=(e or '')[:100]))
    e = h.gagal(f"insert into clinic_private.visit_archive_permits values(txid_current(),{q(r.STAFF)},{q(v)});", r.STAFF)
    check('the permit table is not writable by clients', bool(e), dict(error=(e or '')[:100]))
    e = h.gagal(f"insert into public.visit_archive_events(visit_id,action,reason,visit_status,request_key,created_by,created_by_name) values({q(v)},'archive','Palsu fiktif','Diperiksa','palsu-key-0001',{q(r.STAFF)},'x');", r.STAFF)
    check('the event table is not writable by clients (no grant)', bool(e and 'permission denied' in e), dict(error=(e or '')[:100]))
    e1 = h.gagal(f"update public.visit_archive_events set reason='Ubah fiktif';"); e2 = h.gagal("delete from public.visit_archive_events;"); e3 = h.gagal("truncate public.visit_archive_events;")
    check('events are append-only even for the superuser: UPDATE / DELETE / TRUNCATE refused', all(bool(e and 'tetap' in e) for e in (e1, e2, e3)), dict(e1=(e1 or '')[:80], e2=(e2 or '')[:80], e3=(e3 or '')[:80]))
    counts = {who: h.angka(f"select count(*) from public.visit_archive_events", who) for who in (r.STAFF, r.DOCTOR, r.FINANCE, r.ADMIN, r.OWNER, ADMIN2)}
    check('events readable only by OWNER/ADMIN of the branch (STAFF/DOCTOR/FINANCE/other-branch admin see 0)', counts[r.OWNER] > 0 and counts[r.ADMIN] == counts[r.OWNER] and all(counts[w] == 0 for w in (r.STAFF, r.DOCTOR, r.FINANCE, ADMIN2)), counts)

    # ---------------------------------------------------------------- 7. archived visit cannot be examined / paid / get records
    def blocked(label, sql, user, vv, phrase='VISIT_ARCHIVED'):
        e = h.gagal(sql, user); check(label, bool(e and phrase in e), dict(error=(e or '')[:220])); return e
    vw, _ = bare(h, 3080, 'Menunggu', record=False); h.sql(arch(vw, key()), r.OWNER); w0 = row(h, vw)
    for who, label in [(r.STAFF, 'STAFF'), (r.DOCTOR, 'DOCTOR'), (r.OWNER, 'OWNER')]:
        blocked(f'{label}: START examination (Panggil) on an archived Menunggu visit is refused with a clear message', f"select public.set_visit_service_state({q(vw)},'start');", who, vw)
    blocked('direct UPDATE status=Diperiksa on an archived visit refused', f"update public.visits set status='Diperiksa' where id={q(vw)};", r.STAFF, vw)
    check('archived Menunggu visit unchanged after the attempts (status, timestamps)', row(h, vw) == w0, dict(row=row(h, vw)))
    vd, _ = bare(h, 3081, 'Diperiksa'); h.sql(arch(vd, key()), r.OWNER); d0 = row(h, vd)
    blocked('finish on an archived Diperiksa visit refused (set_visit_service_state)', f"select public.set_visit_service_state({q(vd)},'finish');", r.DOCTOR, vd)
    blocked('checkout on an archived visit refused', f"select public.set_visit_service_state({q(vd)},'checkout');", r.OWNER, vd)
    blocked('provider assignment on an archived visit refused', f"select public.set_visit_service_state({q(vd)},'provider',{q(r.DOKTER_PEGAWAI)});", r.OWNER, vd)
    check('archived Diperiksa visit unchanged after the attempts', row(h, vd) == d0, dict(row=row(h, vd)))
    for label, sql in [('medical record', f"insert into public.medical_records(visit_id) values({q(vd)});"),
                       ('invoice', f"insert into public.invoices(visit_id,subtotal,total) values({q(vd)},0,0);"),
                       ('prescription item', f"insert into public.prescription_items(medical_record_id,nama_obat,qty,harga,satuan,jenis,kategori,faktor) values({q(r.uid(7, 3081))},'Jasa Fiktif',1,1000,'kali','jasa','Tindakan',1);"),
                       ('inpatient admission row', f"insert into public.inpatient_records(visit_id,branch_id) select id,branch_id from public.visits where id={q(vd)};"),
                       ('consent', f"insert into public.consents(visit_id,template_id,tindakan,isi_snapshot) values({q(vd)},{q(r.TEMPLATE_CONSENT)},'Fiktif','Fiktif');")]:
        blocked(f'new {label} for an archived visit refused (VISIT_ARCHIVED)', sql, None, vd)
    vr, mrr = bare(h, 3082, 'Diperiksa')
    force_archive(h, vr)
    e = h.gagal(f"select public.clinic_save_initial_record({q(vr)},(select pet_id from public.visits where id={q(vr)}),'{{\"diagnosis\":\"Uji fiktif\",\"anamnesis\":\"Uji\"}}'::jsonb,'[]','[]','[]',null,{q(r.DOKTER_PEGAWAI)},'Dokter Hewan Fiktif','Keluhan','rekam-arsip-3082');", r.DOCTOR)
    check('the real record-saving RPC (clinic_save_initial_record) is refused for an archived visit; nothing saved', bool(e and 'VISIT_ARCHIVED' in e) and h.angka(f"select count(*) from public.medical_records where visit_id={q(vr)} and submission_key is not null") == 0 and row(h, vr)['status'] == 'Diperiksa', dict(error=(e or '')[:200]))
    vp = dp.visit(h, 3083); force_archive(h, vp); inv0 = h.angka('select count(*) from public.invoices')
    e = h.gagal(r.tagih_biasa_sql(vp, 'inv-3083', pay_lines(3083), r.OWNER, dp=0, alasan='Uji fiktif'), r.OWNER)
    check('the real cashier RPC (clinic_post_invoice) is refused for an archived visit with a pending cart: no invoice, no payment', bool(e and 'VISIT_ARCHIVED' in e) and h.angka('select count(*) from public.invoices') == inv0 and h.angka(f"select count(*) from public.invoices where visit_id={q(vp)}") == 0, dict(error=(e or '')[:200]))
    out = h.gagal(unarch(vw, key()), r.OWNER)
    check('unarchive restores the visit to its previous list: START examination works again on the Menunggu visit', not out and not h.gagal(f"select public.set_visit_service_state({q(vw)},'start');", r.STAFF) and row(h, vw)['status'] == 'Diperiksa', dict(error=out))
    # --- the stuck status must not keep blocking the patient: a NEW visit for the same pet/owner can be registered, called and examined
    vs, _ = bare(h, 3086, 'Diperiksa'); h.sql(arch(vs, key()), r.OWNER); nv = r.uid(6, 3087)
    e_ins = h.gagal(f"insert into public.visits(id,branch_id,customer_id,pet_id,status,queue_number,checked_in_at) select {q(nv)},branch_id,customer_id,pet_id,'Menunggu','A987',now() from public.visits where id={q(vs)};", r.STAFF)
    e_start = h.gagal(f"select public.set_visit_service_state({q(nv)},'start');", r.STAFF)
    check('a stuck Diperiksa visit that is archived no longer blocks the patient: a new visit for the SAME pet/owner registers and starts; the archived one stays untouched',
          not e_ins and not e_start and row(h, nv)['status'] == 'Diperiksa' and is_archived(h, vs) and row(h, vs)['status'] == 'Diperiksa', dict(insert=e_ins, start=e_start))
    # --- ordinary flows on a never-archived visit are unchanged (the guards only react to archived visits)
    vn, mrn = bare(h, 3084, 'Menunggu', record=False)
    steps = [h.gagal(f"select public.set_visit_service_state({q(vn)},'start');", r.STAFF), h.gagal(f"select public.set_visit_service_state({q(vn)},'provider',{q(r.DOKTER_PEGAWAI)});", r.STAFF),
             h.gagal(f"select public.set_visit_service_state({q(vn)},'finish');", r.STAFF)]
    check('existing flow unchanged: a normal visit still goes Menunggu -> Diperiksa -> provider -> Pembayaran', not any(steps) and row(h, vn)['status'] == 'Pembayaran', dict(errors=steps))
    vn2, _ = bare(h, 3085, 'Menunggu', record=False); err = h.gagal(f"delete from public.visits where id={q(vn2)};", r.STAFF)
    check('existing flow unchanged: cancelling (deleting) an ordinary Menunggu visit still works', not err and h.angka(f"select count(*) from public.visits where id={q(vn2)}") == 0, dict(error=err))

    # ---------------------------------------------------------------- 8. other branches / other visits untouched, patient history untouched
    vo, _ = bare(h, 3090, 'Diperiksa', branch=r.BRANCH2); e = h.gagal(arch(vo, key()), r.OWNER)
    check('OWNER (all branches) may archive another branch visit with its own record; only that row changes', not e and is_archived(h, vo), dict(error=e))
    total_arch = h.angka('select count(*) from public.visits where archived_at is not null'); expected = h.angka("select count(*) from public.visit_archive_events e where action='archive' and not exists(select 1 from public.visit_archive_events u where u.visit_id=e.visit_id and u.action='unarchive' and u.created_at>e.created_at)")
    check('the number of archived visits equals the net events (nothing archived silently: no backfill, no side effect on other rows)', total_arch == expected + 2, dict(total=total_arch, from_events=expected))  # +2 force_archive fixtures
    hist = h.angka(f"select count(*) from public.medical_records where visit_id={q(arch_owner)}"); v_hist = h.angka(f"select count(*) from public.visits where pet_id=(select pet_id from public.visits where id={q(arch_owner)})")
    check("the patient's own medical history is not hidden at the DB level: archived visit and its record still selectable by clinical staff (RLS unchanged)", hist == 1 and v_hist == 1 and h.angka(f"select count(*) from public.visits where id={q(arch_owner)}", r.DOCTOR) == 1 and h.angka(f"select count(*) from public.medical_records where visit_id={q(arch_owner)}", r.DOCTOR) == 1, dict(hist=hist))

    lst = lambda pet=None, user=r.DOCTOR: json.loads(h.nilai(f"select public.daftar_rekam_medis({q(pet) if pet else 'null'})->'baris';", user) or '[]')
    ids_all = {b['id'] for b in lst()}
    pet_of = h.nilai(f"select pet_id from public.visits where id={q(arch_owner)}")
    check('Rekam Medis list RPC (no pet filter) excludes archived visits but keeps ordinary ones', arch_owner not in ids_all and r.uid(6, 3031) in ids_all, dict(n=len(ids_all)))
    check("a pet's OWN history (pet filter) still lists its archived visit: archive never hides patient history", arch_owner in {b['id'] for b in lst(pet_of)}, {})
    h.sql(unarch(arch_owner, key()), r.OWNER)
    check('after unarchive the visit is back in the Rekam Medis list', arch_owner in {b['id'] for b in lst()}, {})
    h.sql(arch(arch_owner, key()), r.OWNER)

    # ---------------------------------------------------------------- 9. shape: SECURITY DEFINER, search_path, ACL, coverage of every visit_id table
    meta = json.loads(h.nilai("""select json_agg(json_build_object('f',p.pronamespace::regnamespace::text||'.'||p.proname,'def',p.prosecdef,'cfg',p.proconfig,'anon',has_function_privilege('anon',p.oid,'execute'),
 'auth',has_function_privilege('authenticated',p.oid,'execute'),'pub',has_function_privilege('public',p.oid,'execute'),'svc',has_function_privilege('service_role',p.oid,'execute')) order by p.proname)
 from pg_proc p where p.proname in ('clinic_archive_visit','clinic_unarchive_visit','clinic_force_archive_visit','change_visit_archive','visit_archive_blockers','visit_archive_classify','visit_archive_origin','guard_visit_archive','refuse_archived_visit') and p.pronamespace in ('public'::regnamespace,'clinic_private'::regnamespace)"""))
    pubs = [e for e in meta if e['f'].startswith('public.')]; priv = [e for e in meta if e['f'].startswith('clinic_private.')]
    check('public RPCs (archive, unarchive, force-archive): SECURITY DEFINER, search_path empty, EXECUTE for authenticated only (not anon/public/service_role)', len(pubs) == 3 and all(e['def'] and e['cfg'] == ['search_path=""'] and e['auth'] and not (e['anon'] or e['pub'] or e['svc']) for e in pubs), pubs)
    check('private helpers/guards: SECURITY DEFINER, search_path empty, executable by nobody client-side', len(priv) == 7 and all(e['def'] and e['cfg'] in (['search_path=""'], ['search_path=""', 'lock_timeout=5s']) and not (e['anon'] or e['pub'] or e['svc'] or e['auth']) for e in priv), priv)
    check('RLS stays on for the new event table; the visits policy set is exactly the pre-existing one (RLS unchanged)', h.nilai("select relrowsecurity from pg_class where oid='public.visit_archive_events'::regclass") == 't'
          and sorted(h.nilai("select string_agg(polname,',' order by polname) from pg_policy where polrelid='public.visits'::regclass").split(',')) == sorted(['kamo_import_baca', 'kamo_import_tulis', 'operational_branch_isolation', 'riwayat_bersama_terkunci_delete', 'riwayat_bersama_terkunci_insert', 'riwayat_bersama_terkunci_update', 'visits_select', 'visits_write']), {})
    known = {'public.invoices', 'public.clinic_payment_receipts', 'public.clinic_customer_advances', 'public.clinic_refunds', 'public.clinic_compound_sales', 'public.clinic_inpatient_billable_entries',
             'clinic_private.inpatient_bill_pay_requests', 'clinic_private.inpatient_cashier_requests', 'public.clinic_pending_cart_edits', 'public.clinic_record_item_additions', 'public.clinic_record_addenda',
             'public.inpatient_rx_evidence', 'public.inpatient_records', 'public.consents', 'public.follow_ups', 'public.visit_referrals', 'public.medical_records',
             'public.bookings', 'public.visit_operational_events', 'public.visit_archive_events', 'clinic_private.posting_ctx', 'clinic_private.record_edit_permits', 'clinic_private.visit_archive_permits'}
    present = set(json.loads(h.nilai("select coalesce(json_agg(table_schema||'.'||table_name),'[]') from information_schema.columns c where table_schema in ('public','clinic_private') and column_name='visit_id' and table_name in (select relname from pg_class where relkind='r')")))
    check('coverage: every table that carries a visit_id is classified (blocker / guarded / explicitly allowed); a NEW unclassified table fails this test', present <= known, dict(unclassified=sorted(present - known)))
    guarded = {'public.medical_records', 'public.prescription_items', 'public.invoices', 'public.clinic_payment_receipts', 'public.clinic_customer_advances', 'public.clinic_compound_sales', 'public.clinic_inpatient_billable_entries', 'public.inpatient_records', 'public.consents'}
    trg = set(json.loads(h.nilai("select coalesce(json_agg(c.relnamespace::regnamespace::text||'.'||c.relname),'[]') from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgname='a0_refuse_archived_visit' and not t.tgisinternal")))
    check('entry guard installed (BEFORE INSERT) on every guarded working table', trg == guarded, dict(missing=sorted(guarded - trg), extra=sorted(trg - guarded)))

    # ---------------------------------------------------------------- follow-up: owner force-archive, Selesai only when ERP-origin, bulk plan
    followup_preflight(h)
    for part in (followup, followup_selesai, followup_events, followup_origin, bulk, bulk_safety):   # each part reports on its own; a baseline (RED) run shows every part failing, not just the first
        try: part(h, key)
        except Exception as e: check(f'HARNESS follow-up {part.__name__}', False, str(e)[:500])


# ====================================================================================================== follow-up (Andri 4 Nov 2026)
FREASON = 'Percobaan paksa fiktif'
BULK_REASON = 'data percobaan sebelum 1 Nov 2026'
BULK_DIR = ROOT / 'scripts/sql'
BULK_OVERRIDE = {}   # mutation runs: mutated text of the bulk script


def force(v, key, reason=FREASON, confirm='PAKSA'):
    return f"select public.clinic_force_archive_visit({q(v)},{q(reason) if reason is not None else 'null'},{q(key)},{q(confirm) if confirm is not None else 'null'});"
def last_event(h, v, action='archive'):
    t = h.nilai(f"select to_jsonb(e) from (select action,reason,visit_status,forced,overridden,created_by,request_key from public.visit_archive_events where visit_id={q(v)} and action='{action}' order by created_at desc limit 1) e")
    return json.loads(t) if t else None
def money_snapshot(h): return [h.angka(f'select count(*) from public.{t}') for t in ('invoices', 'invoice_payments', 'stock_moves', 'journal_entries', 'clinic_payment_receipts')] + [h.angka('select coalesce(sum(qty),0) from public.stock')]
def soft_visit(h, n, status='Pembayaran'):
    """A visit stuck in Pembayaran/Diperiksa with saved clinical content + a pending (unbilled) cart row + a signed consent: refused by the plain RPC, forceable by the owner."""
    v, mr = bare(h, n, status); cid = r.uid('d', n)
    h.sql(f"update public.medical_records set diagnosis='Diagnosis Fiktif',anamnesis='Anamnesis Fiktif' where id={q(mr)};"
          f"insert into public.prescription_items(medical_record_id,nama_obat,qty,harga,satuan,jenis,kategori,faktor) values({q(mr)},'Jasa Pending Fiktif',1,50000,'kali','jasa','Tindakan',1);"
          f"insert into public.consents(id,visit_id,template_id,tindakan,isi_snapshot) values({q(cid)},{q(v)},{q(r.TEMPLATE_CONSENT)},'Fiktif','Fiktif');", r.OWNER)
    h.sql(f"update public.consents set status='sudah_ttd',signer_name='Fiktif',signature_data='data:image/png;base64,ZmlrdGlm',signed_at=now() where id={q(cid)};", r.OWNER)
    return v, mr


def followup_preflight(h):
    have = dict(force_rpc=h.angka("select count(*) from pg_proc where proname='clinic_force_archive_visit' and pronamespace='public'::regnamespace") == 1,
                classify=h.angka("select count(*) from pg_proc where proname='visit_archive_classify' and pronamespace='clinic_private'::regnamespace") == 1,
                origin=h.angka("select count(*) from pg_proc where proname='visit_archive_origin' and pronamespace='clinic_private'::regnamespace") == 1,
                forced_col=h.angka("select count(*) from information_schema.columns where table_schema='public' and table_name='visit_archive_events' and column_name in ('forced','overridden')") == 2)
    for k, ok in have.items(): check(f'follow-up preflight: {k} exists', ok, {})
    return all(have.values())


def followup(h, key):
    # ---------------------------------------------------------------- 10. OWNER force-archive
    v, mr = soft_visit(h, 3100, 'Pembayaran'); k = key('force')
    e0 = h.gagal(arch(v, key()), r.OWNER)
    check('plain archive of a Pembayaran visit with record content/pending item/signed consent is refused for OWNER, message says only the owner can force', bool(e0 and 'ARCHIVE_BLOCKED' in e0 and 'data klinis' in e0 and 'Pemilik dapat memaksa' in e0) and not is_archived(h, v), dict(error=(e0 or '')[:300]))
    e0 = h.gagal(arch(v, key()), r.ADMIN)
    check('plain archive is refused for ADMIN too (same blockers)', bool(e0 and 'ARCHIVE_BLOCKED' in e0) and not is_archived(h, v), dict(error=(e0 or '')[:200]))
    snap = money_snapshot(h); mr_n = h.angka(f"select count(*) from public.medical_records where visit_id={q(v)}"); items_n = h.angka(f"select count(*) from public.prescription_items where medical_record_id={q(mr)}")
    err = h.gagal(force(v, k), r.OWNER); after = row(h, v) if not err else None; ev = last_event(h, v) if not err else None
    check('OWNER FORCE-archives the Pembayaran visit with record content + pending item + signed consent: archived, status untouched, record/items/consent all still there',
          not err and bool(after) and after['archived_at'] and after['archived_by'] == r.OWNER and after['archive_reason'] == FREASON and after['status'] == 'Pembayaran'
          and h.angka(f"select count(*) from public.medical_records where visit_id={q(v)}") == mr_n and h.angka(f"select count(*) from public.prescription_items where medical_record_id={q(mr)}") == items_n == 1
          and h.angka(f"select count(*) from public.consents where visit_id={q(v)} and status='sudah_ttd'") == 1, dict(error=err, after=after))
    check('forced event is append-only audited: forced=true, reason, actor, status at the time and the list of overridden blockers (clinical data, pending items, signed consent)',
          bool(ev) and ev['forced'] is True and ev['reason'] == FREASON and ev['created_by'] == r.OWNER and ev['visit_status'] == 'Pembayaran'
          and any('data klinis' in o for o in ev['overridden']) and any('tagihan tertunda' in o for o in ev['overridden']) and any('ditandatangani' in o for o in ev['overridden']), dict(event=ev))
    check('force changes NO money/stock: invoices, payments, stock_moves, journal entries, receipts and stock quantity unchanged', money_snapshot(h) == snap, dict(before=snap, after=money_snapshot(h)))
    check('forced visit stays frozen (VISIT_ARCHIVED on checkout) like any archived visit', 'VISIT_ARCHIVED' in (h.gagal(f"update public.visits set checked_out_at=now() where id={q(v)};", r.STAFF) or ''), {})
    out = json.loads(h.nilai(force(v, k), r.OWNER))
    check('exact replay of the force request answers replay=true/forced=true and writes nothing (one archive event)', out['replay'] is True and out['forced'] is True and events(h, v) == 1, dict(out=out))
    err = h.gagal(arch(v, k), r.OWNER)
    check('the force key cannot be replayed through the plain archive RPC (forced mismatch -> key reuse refused)', bool(err and 'ARCHIVE_INVALID' in err) and events(h, v) == 1, dict(error=(err or '')[:160]))
    err = h.gagal(force(v, key()), r.OWNER)
    check('force on an already archived visit -> ARCHIVE_STALE', bool(err and 'ARCHIVE_STALE' in err) and events(h, v) == 1, dict(error=(err or '')[:160]))
    kun = key('unf'); err = h.gagal(unarch(v, kun, 'Salah arsip fiktif'), r.ADMIN); ue = last_event(h, v, 'unarchive') if not err else None
    check('ADMIN can restore a force-archived visit; the unarchive event is not forced and carries no override list', not err and not is_archived(h, v) and bool(ue) and ue['forced'] is False and ue['overridden'] == [] and row(h, v)['status'] == 'Pembayaran', dict(error=err, event=ue))
    vd, _ = soft_visit(h, 3101, 'Diperiksa'); err = h.gagal(force(vd, key()), r.OWNER)
    check('OWNER force also works on a stuck Diperiksa visit with record content', not err and is_archived(h, vd) and row(h, vd)['status'] == 'Diperiksa', dict(error=err))
    vn, _ = bare(h, 3102, 'Diperiksa'); err = h.gagal(force(vn, key()), r.OWNER); evn = last_event(h, vn) if not err else None
    check('force on a visit that has nothing to override works and records an empty override list', not err and is_archived(h, vn) and bool(evn) and evn['forced'] is True and evn['overridden'] == [], dict(error=err, event=evn))

    # ---------------------------------------------------------------- roles for force
    vv, _ = soft_visit(h, 3103, 'Pembayaran'); e1 = events(h)
    err = h.gagal(force(vv, key()), r.ADMIN)
    check('ADMIN may NOT force: FORCE_DENIED inside the DB, nothing archived, no event', bool(err and 'FORCE_DENIED' in err) and not is_archived(h, vv) and events(h) == e1, dict(error=(err or '')[:160]))
    for who, label in [(r.STAFF, 'STAFF'), (r.DOCTOR, 'DOCTOR'), (r.FINANCE, 'FINANCE'), (OWNER_OFF, 'inactive OWNER'), (ADMIN_OFF, 'inactive ADMIN')]:
        err = h.gagal(force(vv, key()), who)
        check(f'{label} cannot force-archive (ACCESS_DENIED)', bool(err and 'ACCESS_DENIED' in err) and not is_archived(h, vv) and events(h) == e1, dict(error=(err or '')[:160]))
    err = h.gagal("set role anon;\n" + force(vv, key()))
    check('anon cannot call the force RPC (ACL)', bool(err and 'permission denied' in err) and not is_archived(h, vv), dict(error=(err or '')[:160]))
    err = h.gagal(force(r.uid(6, 99998), key()), r.OWNER)
    check('force on an unknown visit -> ARCHIVE_NOT_FOUND', bool(err and 'ARCHIVE_NOT_FOUND' in err), dict(error=(err or '')[:160]))
    for label, kw in [('no confirmation (null)', dict(confirm=None)), ('empty confirmation', dict(confirm='')), ('wrong word', dict(confirm='YA')), ('lowercase paksa', dict(confirm='paksa')), ('padded PAKSA ', dict(confirm='PAKSA '))]:
        err = h.gagal(force(vv, key(), **kw), r.OWNER)
        check(f'force refused without the exact confirmation word: {label} (FORCE_CONFIRM), nothing written', bool(err and 'FORCE_CONFIRM' in err) and not is_archived(h, vv) and events(h) == e1, dict(error=(err or '')[:140]))
    for label, reason in [('null', None), ('empty', ''), ('blank', '      '), ('4 characters', 'abcd'), ('only punctuation (5 dots)', '.....'), ('4 letters padded with symbols', 'a-b-c-d---'), ('501 characters', 'x' * 501)]:
        err = h.gagal(force(vv, key(), reason), r.OWNER)
        check(f'force reason {label} refused (ARCHIVE_INVALID), nothing written', bool(err and 'ARCHIVE_INVALID' in err) and not is_archived(h, vv) and events(h) == e1, dict(error=(err or '')[:160]))
    err = h.gagal(force(vv, key(), '  ab cde  '), r.OWNER)
    check('force reason with exactly 5 significant characters (letters/digits) passes and is stored trimmed', not err and row(h, vv)['archive_reason'] == 'ab cde', dict(error=err))

    # ---------------------------------------------------------------- hard blockers: never forceable
    def hard(label, vv_, phrase):
        e2 = events(h); err = h.gagal(force(vv_, key()), r.OWNER)
        check(f'force refused (not overridable): {label}', bool(err and 'ARCHIVE_BLOCKED' in err and 'walau dipaksa' in err and phrase in err) and not is_archived(h, vv_) and events(h) == e2, dict(error=(err or '')[:300]))
    vh, _ = soft_visit(h, 3110, 'Pembayaran'); h.sql(f"insert into public.invoices(visit_id,subtotal,total,paid_status,voided_at) values({q(vh)},0,0,'Belum Lunas',now());")
    hard('voided invoice', vh, 'tagihan/invoice')
    vh = dp.visit(h, 3111); h.sql(r.tagih_biasa_sql(vh, 'inv-3111', pay_lines(3111), r.OWNER, dp=0, alasan='Uji fiktif'), r.OWNER)
    hard('real invoice posted through clinic_post_invoice (stock + HPP booked)', vh, 'tagihan/invoice')
    inv = h.aktif(vh); h.sql(f"select public.clinic_receive_invoice_payment({q(inv)},'2026-11-03',{int(r.nilai_baris(pay_lines(3111)))},'Tunai','110003','Fiktif','settle-3111');", r.OWNER)
    hard('real payment received', vh, 'sudah ada pembayaran')
    vh, _ = bare(h, 3112, 'Pembayaran'); h.sql(f"insert into public.clinic_customer_advances(no_uang_muka,customer_id,branch_id,visit_id,tanggal,amount) select 'DP-F-3112',customer_id,branch_id,id,current_date,1000 from public.visits where id={q(vh)};")
    hard('advance payment (DP)', vh, 'uang muka')
    vh, mrh = bare(h, 3113, 'Pembayaran')
    h.sql(f"set session_replication_role=replica; insert into public.clinic_refunds(no_refund,invoice_id,visit_id,branch_id,tanggal,total,method,cash_account_id,account_snapshot,expense_id,request_id,created_by) values('RF-F-3113',gen_random_uuid(),{q(vh)},{q(r.BRANCH)},current_date,1000,'Tunai',gen_random_uuid(),'{{}}',gen_random_uuid(),gen_random_uuid(),{q(r.OWNER)}); reset session_replication_role;")
    hard('refund', vh, 'refund')
    vh, mrh = bare(h, 3114, 'Pembayaran')
    h.sql(f"set session_replication_role=replica; insert into public.clinic_compound_sales(request_key,request_hash,visit_id,medical_record_id,actor_id,sale_item_id,sale_name,sale_price,sale_unit) values('cs-f-3114','h',{q(vh)},{q(mrh)},{q(r.OWNER)},gen_random_uuid(),'Racik Fiktif',1000,'pcs'); reset session_replication_role;")
    hard('sold compound (stock consumed)', vh, 'penjualan racikan')
    cust = r.buat_pelanggan(h, 3115); vh = r.buat_kunjungan(h, 3115, cust, admitted=True)
    hard('open inpatient admission (+ signed consent + pending items)', vh, 'rawat inap masih berjalan')
    h.sql(jwt(r.OWNER) + f"update public.inpatient_records set discharged_at=now() where visit_id={q(vh)};")
    err = h.gagal(force(vh, key()), r.OWNER)
    check('force refused: discharged inpatient history is also not overridable', bool(err and 'riwayat rawat inap' in err and 'walau dipaksa' in err) and not is_archived(h, vh), dict(error=(err or '')[:300]))
    vr, _ = soft_visit(h, 3116, 'Pembayaran'); barriers = []
    with contextlib.ExitStack() as stack:
        obs = stack.enter_context(x.c.Session(h.db, 'fa-observer')); holder = stack.enter_context(x.c.Session(h.db, 'fa-holder')); waiter = stack.enter_context(x.c.Session(h.db, 'fa-waiter'))
        waiter.sql(x.claims(r.OWNER)); holder.sql(f"begin; select id from public.visits where id={q(vr)} for update;")
        waiter.send('begin;' + force(vr, key('lock'))); x.c.wait_block(obs, waiter, holder, barriers)
        holder.sql(f"insert into public.invoices(visit_id,subtotal,total,paid_status) values({q(vr)},100,100,'Belum Lunas'); commit;"); out = x.c.attempt(waiter, commit=False)
    check('force waits on the visit row lock and RE-CHECKS under it: an invoice committed meanwhile makes it ARCHIVE_BLOCKED (not archived)', (not out['ok']) and 'ARCHIVE_BLOCKED' in out.get('error', '') and not is_archived(h, vr) and events(h, vr) == 0 and len(barriers) == 1, dict(outcome=str(out)[:240]))
    # lock_timeout (review S1): a visit locked longer than 5s makes the RPC fail fast instead of hanging behind a long transaction
    vt, _ = bare(h, 3117, 'Diperiksa'); barriers = []
    cfg = h.nilai("select p.proconfig::text from pg_proc p where p.proname='change_visit_archive' and p.pronargs=6 and p.pronamespace='clinic_private'::regnamespace")
    with contextlib.ExitStack() as stack:
        obs = stack.enter_context(x.c.Session(h.db, 'lt-observer')); holder = stack.enter_context(x.c.Session(h.db, 'lt-holder')); waiter = stack.enter_context(x.c.Session(h.db, 'lt-waiter'))
        waiter.sql(x.claims(r.OWNER)); holder.sql(f"begin; select id from public.visits where id={q(vt)} for update;")
        t0 = time.time(); waiter.send('begin;' + arch(vt, key('lt'))); x.c.wait_block(obs, waiter, holder, barriers); out = x.c.attempt(waiter, commit=False); waited = time.time() - t0; holder.sql('rollback;')
    check('archive RPC carries lock_timeout=5s: a visit row locked by another transaction makes it fail with lock_not_available after ~5s (not hang; the 6s session timeout of the harness is NOT what fires), nothing archived', 'lock_timeout=5s' in cfg and (not out['ok']) and ('lock timeout' in out.get('error', '').lower() or '55P03' in out.get('error', '')) and 4.3 <= waited < 5.8 and not is_archived(h, vt), dict(cfg=cfg, waited=round(waited, 1), outcome=str(out)[:200]))


def followup_selesai(h, key):
    # ---------------------------------------------------------------- 10b. Selesai only when ERP-origin
    def selesai(n, **extra):
        vv_, mm_ = bare(h, n, 'Selesai'); sets = ["checked_out_at=now()"] + [f"{c}={q(val) if isinstance(val, str) else 'null'}" for c, val in extra.items()]
        h.sql(f"set session_replication_role=replica;\nupdate public.visits set {','.join(sets)} where id={q(vv_)};"); return vv_, mm_   # replica role = fixture only: the origin-evidence trigger forbids this edit for every role
    vs, _ = selesai(3120); err = h.gagal(arch(vs, key()), r.OWNER); ev3 = last_event(h, vs) if not err else None
    check('Selesai visit created by the ERP flow (no import marker, checked_in_at set, nothing financial) CAN be archived by OWNER; status/checkout untouched', not err and is_archived(h, vs) and row(h, vs)['status'] == 'Selesai' and row(h, vs)['checked_out_at'] is not None and ev3['visit_status'] == 'Selesai' and ev3['forced'] is False, dict(error=err))
    vs, _ = selesai(3121); err = h.gagal(arch(vs, key()), r.ADMIN)
    check('...and by ADMIN (plain archive, no force)', not err and is_archived(h, vs), dict(error=err))
    vs, mrs = selesai(3122); h.sql(f"update public.medical_records set diagnosis='Diagnosis Fiktif' where id={q(mrs)};"); err = h.gagal(arch(vs, key()), r.OWNER)
    check('ERP Selesai visit with saved clinical content: plain archive refused (data klinis), force by OWNER allowed', bool(err and 'data klinis' in err) and not is_archived(h, vs) and not h.gagal(force(vs, key()), r.OWNER) and is_archived(h, vs), dict(error=(err or '')[:200]))
    vs, _ = selesai(3123); h.sql(f"insert into public.invoices(visit_id,subtotal,total,paid_status) values({q(vs)},0,0,'Lunas');")
    err = h.gagal(arch(vs, key()), r.OWNER); err2 = h.gagal(force(vs, key()), r.OWNER)
    check('ERP Selesai visit WITH an invoice stays unarchivable, even forced', bool(err and 'tagihan/invoice' in err) and bool(err2 and 'walau dipaksa' in err2) and not is_archived(h, vs), dict(e1=(err or '')[:120], e2=(err2 or '')[:120]))
    for n, marker, val in [(3124, 'legacy_source_key', 'fiktif::0800::pasien-3124::01012026'), (3125, 'legacy_record_no', 'RM-FIKTIF-3125'), (3126, 'legacy_source_hash', 'abcdef0123456789')]:
        vs, _ = selesai(n, **{marker: val}); e1_, e2_ = h.gagal(arch(vs, key()), r.OWNER), h.gagal(force(vs, key()), r.OWNER)
        check(f'imported Selesai visit (only {marker} set) is NOT archivable: plain and forced both refused, "impor" named', bool(e1_ and 'impor' in e1_ and 'sudah selesai' in e1_) and bool(e2_ and 'impor' in e2_ and 'walau dipaksa' in e2_) and not is_archived(h, vs), dict(e1=(e1_ or '')[:140], e2=(e2_ or '')[:140]))
    vs, _ = selesai(3127, legacy_source_key='fiktif::0800::bersama::01012026', checked_in_at=None)
    e1_ = h.gagal(arch(vs, key()), r.OWNER)
    check('imported Selesai with NO checked_in_at (shape of the real import writers) is refused', bool(e1_ and 'impor' in e1_) and not is_archived(h, vs), dict(error=(e1_ or '')[:160]))
    vs, _ = selesai(3128, checked_in_at=None); e1_, e2_ = h.gagal(arch(vs, key()), r.OWNER), h.gagal(force(vs, key()), r.OWNER)
    check('Selesai with NO import marker but ALSO no ERP evidence (checked_in_at empty) = origin uncertain -> refused fail-closed, even forced', bool(e1_ and 'tidak dapat dipastikan' in e1_) and bool(e2_ and 'walau dipaksa' in e2_) and not is_archived(h, vs), dict(e1=(e1_ or '')[:160]))
    vs, _ = selesai(3129, legacy_source_key='fiktif::0800::tanpa-cabang::01012026'); h.sql(f"update public.visits set branch_id=null where id={q(vs)};")
    e1_ = h.gagal(arch(vs, key()), r.OWNER); e2_ = h.gagal(force(vs, key()), r.OWNER)
    check('imported visit with NO branch (shared history) is refused too', bool(e1_ and 'ARCHIVE_' in e1_) and bool(e2_ and 'ARCHIVE_' in e2_) and not is_archived(h, vs), dict(e1=(e1_ or '')[:100]))
    origin = lambda vid: h.nilai(f"select clinic_private.visit_archive_origin({q(vid)})")
    vs, _ = selesai(3130); vi, _ = selesai(3131, legacy_record_no='RM-3131'); vu, _ = selesai(3132, checked_in_at=None)
    check('origin classifier: erp / impor / tidak_pasti', (origin(vs), origin(vi), origin(vu)) == ('erp', 'impor', 'tidak_pasti'), dict(got=(origin(vs), origin(vi), origin(vu))))
    vs, _ = bare(h, 3133, 'Diperiksa'); h.sql(f"update public.visits set legacy_source_key='fiktif::x::y::z' where id={q(vs)};")
    e1_, e2_ = h.gagal(arch(vs, key()), r.OWNER), h.gagal(force(vs, key()), r.OWNER)
    check('the import marker matters for EVERY status (review: status could be flipped away from Selesai to dodge the origin rule): a marked Diperiksa visit is history, refused plain and forced', bool(e1_ and 'impor' in e1_) and bool(e2_ and 'impor' in e2_) and not is_archived(h, vs), dict(e1=(e1_ or '')[:140]))
    bad = h.nilai("select coalesce(string_agg(p.pronamespace::regnamespace::text||'.'||p.proname,','),'') from pg_proc p where p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+(public[.])?visits[[:space:]]*[(][^;]*''Selesai''' and p.prosrc !~* 'legacy_source_key'")
    check("coverage: EVERY function that inserts a finished ('Selesai') visit sets legacy_source_key (all import writers carry the marker; a future importer without it fails here)", bad == '', dict(unmarked=bad))


def followup_events(h, key):
    # ---------------------------------------------------------------- event table shape
    v, _ = bare(h, 3139, 'Diperiksa')
    e = h.gagal(f"insert into public.visit_archive_events(visit_id,action,reason,visit_status,request_key,created_by,created_by_name,forced,overridden) values({q(v)},'archive','Palsu fiktif','Diperiksa','palsu-key-0002',{q(r.OWNER)},'x',false,array['x']);")
    check('event check: a non-forced event cannot carry an override list', bool(e and 'forced_consistent' in e), dict(error=(e or '')[:140]))
    n_forced = h.angka("select count(*) from public.visit_archive_events where forced"); n_other = h.angka("select count(*) from public.visit_archive_events where forced and created_by<>" + q(r.OWNER))
    check('every forced event in the whole run was written by the OWNER', n_forced > 0 and n_other == 0, dict(forced=n_forced, other=n_other))
    check('plain archive of an ordinary bare visit is unchanged and records forced=false', not h.gagal(arch(bare(h, 3140, 'Diperiksa')[0], key()), r.OWNER) and h.angka("select count(*) from public.visit_archive_events where not forced and action='archive'") > 0, {})
    fn = h.nilai("select (select count(*) from pg_proc where proname='change_visit_archive' and pronamespace='clinic_private'::regnamespace)||'/'||(select count(*) from pg_proc where proname in ('clinic_archive_visit','clinic_unarchive_visit') and pronamespace='public'::regnamespace)")
    check('backward compatible: public clinic_archive_visit/clinic_unarchive_visit unchanged and the 4-arg private entry still exists next to the 6-arg one', fn == '2/2', dict(fn=fn))


def bulk(h, key):
    """Bulk plan (scripts/sql/bulk-arsip-antrian-*.sql): tested here on fictional fixtures only; never run on a real database."""
    run_sql = BULK_OVERRIDE.get('run') or (BULK_DIR / 'bulk-arsip-antrian-jalankan.sql').read_text(); preview = (BULK_DIR / 'bulk-arsip-antrian-pratinjau.sql').read_text()
    marker = 'select * from pg_temp.bulk_arsip_antrian('
    assert run_sql.count(marker) == 1; defn = run_sql.split(marker)[0]
    def call(owner, execute, batas=500, cutoff="timestamptz '2026-11-01 00:00:00+07'", reason=BULK_REASON):
        ex = 'null::boolean' if execute is None else 'true' if execute else 'false'
        return defn + f"select visit_id,status,hasil,detail,ringkasan from pg_temp.bulk_arsip_antrian({q(owner)}::uuid,{cutoff},{q(reason)},{ex},{'null::integer' if batas is None else batas});"
    def result(sql_): return [l.split('|') for l in h.sql(sql_).splitlines() if '|' in l]
    def summ(rows_): return json.loads([rw[4] for rw in rows_ if rw[2] == 'RINGKASAN'][0])
    old = "'2026-10-15 03:00:00+07'"
    def old_visit(n, status='Diperiksa', record=True):
        vv, mm = bare(h, n, status, record); h.sql(f"update public.visits set created_at={old} where id={q(vv)};"); return vv, mm
    plain = [old_visit(3200 + i, st)[0] for i, st in enumerate(['Menunggu', 'Diperiksa', 'Pembayaran'])]
    soft_v, _ = soft_visit(h, 3210, 'Pembayaran'); h.sql(f"update public.visits set created_at={old} where id={q(soft_v)};")
    erp_sel, _ = old_visit(3211, 'Selesai'); h.sql(f"update public.visits set checked_out_at=now() where id={q(erp_sel)};")
    imp_sel, _ = old_visit(3212, 'Selesai'); h.sql(f"update public.visits set checked_out_at=now(),legacy_source_key='fiktif::bulk::3212' where id={q(imp_sel)};")
    unc_sel, _ = old_visit(3213, 'Selesai'); h.sql(f"set session_replication_role=replica;\nupdate public.visits set checked_out_at=now(),checked_in_at=null where id={q(unc_sel)};")
    inv_v, _ = old_visit(3214, 'Pembayaran'); h.sql(f"insert into public.invoices(visit_id,subtotal,total,paid_status) values({q(inv_v)},0,0,'Belum Lunas');")
    pay_v = dp.visit(h, 3215); h.sql(r.tagih_biasa_sql(pay_v, 'inv-3215', pay_lines(3215), r.OWNER, dp=0, alasan='Uji fiktif'), r.OWNER)
    h.sql(f"select public.clinic_receive_invoice_payment({q(h.aktif(pay_v))},'2026-11-03',{int(r.nilai_baris(pay_lines(3215)))},'Tunai','110003','Fiktif','settle-3215');", r.OWNER); h.sql(f"update public.visits set created_at={old} where id={q(pay_v)};")
    dp_v, _ = old_visit(3216, 'Pembayaran'); h.sql(f"insert into public.clinic_customer_advances(no_uang_muka,customer_id,branch_id,visit_id,tanggal,amount) select 'DP-F-3216',customer_id,branch_id,id,current_date,1000 from public.visits where id={q(dp_v)};")
    ranap_v = r.buat_kunjungan(h, 3217, r.buat_pelanggan(h, 3217), admitted=True); h.sql(f"update public.visits set created_at={old} where id={q(ranap_v)};")
    new_v, _ = bare(h, 3218, 'Diperiksa'); h.sql(f"update public.visits set created_at='2026-11-02 08:00:00+07' where id={q(new_v)};")
    pre_arch, _ = old_visit(3219, 'Diperiksa'); h.sql(arch(pre_arch, key()), r.OWNER); pre_events = events(h, pre_arch)
    should = set(plain + [soft_v, erp_sel]); skipped = {inv_v, pay_v, dp_v, ranap_v, imp_sel, unc_sel}
    manual = {i for i in skipped if h.nilai(f"select (status::text<>'Selesai' and checked_out_at is null)::text from public.visits where id={q(i)}") == 'true'}   # still in the live queue + hard blocker
    def digest(): return h.nilai("select md5(coalesce((select string_agg(v::text,'|' order by id) from public.visits v),'')||(select count(*)::text from public.visit_archive_events)||(select count(*)::text from public.invoices)||(select count(*)::text from public.stock_moves))")
    # (0) the read-only preview
    d0 = digest(); cut = preview.index('-- [1] jumlah per status'); pre = preview[:cut]
    cats = json.loads(h.nilai(pre + "select json_object_agg(id,kategori) from bulk_arsip_pratinjau;"))
    check('preview SQL (read-only): classifies each fixture (bare->ARSIP_BIASA, content->ARSIP_PERLU_PAKSA, invoice/payment/DP/ranap->DILEWATI_UANG_STOK, imported->DILEWATI_IMPOR, uncertain->DILEWATI_ASAL_TIDAK_PASTI); already-archived and post-cutoff visits excluded',
          all(cats.get(i) == 'ARSIP_BIASA' for i in plain + [erp_sel]) and cats.get(soft_v) == 'ARSIP_PERLU_PAKSA' and all(cats.get(i) == 'DILEWATI_UANG_STOK' for i in (inv_v, pay_v, dp_v, ranap_v))
          and cats.get(imp_sel) == 'DILEWATI_IMPOR' and cats.get(unc_sel) == 'DILEWATI_ASAL_TIDAK_PASTI' and new_v not in cats and pre_arch not in cats, dict(cats={k[-6:]: c for k, c in cats.items()}))
    out_all = h.sql(preview)
    check('the full preview script (all three result sets) runs on the live schema and writes nothing (digest of visits/events/invoices/stock_moves unchanged)', d0 == digest() and 'DILEWATI_UANG_STOK' in out_all, {})
    # (1) dry run
    d0 = digest(); rows_ = result(call(r.OWNER, False)); by = {rw[0]: rw[2] for rw in rows_}
    check('dry run (p_jalankan=false): AKAN_DIARSIPKAN for archivable; live-queue visits blocked by money/inpatient are PERLU_MANUAL; permanently skipped (imported/uncertain Selesai) are NOT re-listed (only counted); NOTHING is written',
          all(by.get(i) == 'AKAN_DIARSIPKAN' for i in should) and all(by.get(i) == 'PERLU_MANUAL' for i in manual) and not any(i in by for i in skipped - manual) and new_v not in by and pre_arch not in by and d0 == digest(), dict(by={k[-6:]: c for k, c in by.items()}))
    # (2) refusals before anything runs
    for label, owner, kw in [('ADMIN uuid (not OWNER)', r.ADMIN, {}), ('inactive OWNER', OWNER_OFF, {}), ('STAFF uuid', r.STAFF, {}), ('unknown uuid', r.uid('9', 1), {}),
                             ('cutoff after 1 Nov 2026', r.OWNER, dict(cutoff="timestamptz '2026-11-03 00:00:00+07'")), ('reason without 5 significant characters', r.OWNER, dict(reason='....'))]:
        err = h.gagal(call(owner, True, **kw)); check(f'bulk script refuses to run: {label}; nothing archived', bool(err) and d0 == digest(), dict(error=(err or '')[:120]))
    # (3) real run
    snap = money_snapshot(h); rows_ = result(call(r.OWNER, True)); by = {rw[0]: rw[2] for rw in rows_}
    arch_ok = [i for i in should if is_archived(h, i)]
    check('bulk run archives every archivable test visit (Pembayaran with content via the forced path, ERP Selesai, plain ones) with the fixed reason and OWNER as actor',
          len(arch_ok) == len(should) and all(by.get(i) == 'DIARSIPKAN' for i in should) and all(row(h, i)['archive_reason'] == BULK_REASON and row(h, i)['archived_by'] == r.OWNER for i in should), dict(archived=len(arch_ok), expected=len(should)))
    check('bulk run SKIPS invoices, payments, DP, inpatient, imported Selesai, uncertain Selesai: untouched (live-queue ones listed PERLU_MANUAL, the rest only counted)', all(not is_archived(h, i) for i in skipped) and all(by.get(i) == 'PERLU_MANUAL' for i in manual) and not any(i in by for i in skipped - manual), dict(by={k[-6:]: c for k, c in by.items() if k in skipped}))
    check('post-cutoff visit and the already-archived visit are untouched (no new event for the latter)', not is_archived(h, new_v) and events(h, pre_arch) == pre_events and pre_arch not in by, {})
    evs = [last_event(h, i) for i in should]
    check('same audit path: every bulk archive wrote an append-only forced event with reason and request key bulk-arsip-20261101-<id>; the stuck Pembayaran one lists its overridden blockers',
          all(e_ and e_['reason'] == BULK_REASON and e_['forced'] and e_['created_by'] == r.OWNER and e_['request_key'].startswith('bulk-arsip-20261101-') for e_ in evs) and any(o for e_ in evs for o in e_['overridden'])
          and h.angka(f"select count(*) from public.visit_archive_events where reason={q(BULK_REASON)}") == len(should), {})
    check('bulk run changed no money/stock (invoices/payments/stock_moves/journal entries/receipts/stock quantity identical before and after)', money_snapshot(h) == snap, dict(before=snap, after=money_snapshot(h)))
    # (4) idempotent + manual restore respected
    d1 = digest(); by2 = {rw[0]: rw[2] for rw in result(call(r.OWNER, True))}
    check('re-running the bulk script is idempotent: nothing new archived, no new event', d1 == digest() and not any(c in ('DIARSIPKAN', 'AKAN_DIARSIPKAN') for c in by2.values()), dict(by={k[-6:]: c for k, c in by2.items()}))
    h.sql(unarch(plain[0], key('bulk-un')), r.ADMIN); d2 = digest(); by3 = {rw[0]: rw[2] for rw in result(call(r.OWNER, True))}
    rows3 = result(call(r.OWNER, False)); sp = summ(rows3)['skipped_by_reason']
    check('a visit restored by hand after the bulk run is NOT re-archived by a re-run, and is counted (SUDAH_PERNAH) instead of being re-listed forever', not is_archived(h, plain[0]) and plain[0] not in by3 and sum(v for k, v in sp.items() if 'SUDAH_PERNAH' in k) >= 1 and d2 == digest(), dict(skipped=sp))
    # (5) batch limit
    b1, _ = old_visit(3220, 'Diperiksa'); b2, _ = old_visit(3221, 'Diperiksa'); b3, _ = old_visit(3222, 'Diperiksa')
    n0 = h.angka("select count(*) from public.visits where archived_at is not null"); result(call(r.OWNER, True, batas=2)); n1 = h.angka("select count(*) from public.visits where archived_at is not null")
    result(call(r.OWNER, True, batas=2))
    check('batch limit p_batas=2 archives exactly two per run; the next run continues with the rest', n1 - n0 == 2 and all(is_archived(h, i) for i in (b1, b2, b3)), dict(delta=n1 - n0))


def followup_origin(h, key):
    """Review condition 1: ERP-origin evidence must not be editable by staff (spoof -> OWNER force-archives an imported visit)."""
    def evid(v): return json.loads(h.nilai(f"select to_jsonb(t) from (select legacy_source_key,legacy_record_no,legacy_source_hash,checked_in_at from public.visits where id={q(v)}) t"))
    def mk(n, markers=False, checked_in=True, status='Selesai'):
        v, mr = bare(h, n, status)
        sets = ["checked_out_at=now()"] if status == 'Selesai' else []
        if markers: sets += [f"legacy_source_key='fiktif::0800::asal::{n}'", f"legacy_record_no='RM-ASAL-{n}'", f"legacy_source_hash='hash{n:08d}'"]
        if sets: h.sql(f"update public.visits set {','.join(sets)} where id={q(v)};")
        if not checked_in: h.sql(f"set session_replication_role=replica;\nupdate public.visits set checked_in_at=null where id={q(v)};")   # fixture only
        return v
    ctr = [3700]
    def nxt(): ctr[0] += 1; return ctr[0]
    def upd(v, sets, who): return h.gagal(f"update public.visits set {sets} where id={q(v)};", who)
    locked = lambda e: bool(e and 'ORIGIN_LOCKED' in e)
    # --- the two confirmed attacks (review B1-B4), end to end
    v = mk(3300, markers=False, checked_in=False); e0 = evid(v)
    err = upd(v, "checked_in_at=now()", r.STAFF); e1 = evid(v)
    f1 = h.gagal(force(v, key()), r.OWNER)
    check('SPOOF 1 closed: branch STAFF cannot stamp checked_in_at on an uncertain Selesai visit; the OWNER still cannot archive/force it (origin stays tidak_pasti)', locked(err) and e1 == e0 and e1['checked_in_at'] is None and bool(f1 and 'tidak dapat dipastikan' in f1) and not is_archived(h, v), dict(error=(err or '')[:140], evidence=e1))
    v = mk(3301, markers=True, checked_in=False); e0 = evid(v)
    err = upd(v, "legacy_source_key=null,legacy_record_no=null,legacy_source_hash=null,checked_in_at=now()", r.STAFF); e1 = evid(v)
    f1, f2 = h.gagal(arch(v, key()), r.OWNER), h.gagal(force(v, key()), r.OWNER)
    check('SPOOF 2 closed: branch STAFF cannot null all three import markers + stamp checked_in_at on a branch-scoped imported visit; OWNER archive AND force still refused (impor)', locked(err) and e1 == e0 and bool(f1 and 'impor' in f1) and bool(f2 and 'impor' in f2) and not is_archived(h, v), dict(error=(err or '')[:140], evidence=e1))
    # --- markers: once set, no role can null or change them (normal UPDATE); superuser too
    fails = []
    for who, label in [(r.STAFF, 'STAFF'), (r.DOCTOR, 'DOCTOR'), (r.ADMIN, 'ADMIN'), (r.OWNER, 'OWNER'), (None, 'postgres')]:
        for col in ('legacy_source_key', 'legacy_record_no', 'legacy_source_hash'):
            for how, expr in (('null', 'null'), ('change', "'andre-lain'"), ('empty', "''")):
                v = mk(nxt(), markers=True, checked_in=False)
                before = evid(v); err = upd(v, f"{col}={expr}", who)
                if not locked(err) or evid(v) != before: fails.append((label, col, how, (err or 'NO ERROR')[:60]))
    check('every role (STAFF/DOCTOR/ADMIN/OWNER and postgres) is refused (ORIGIN_LOCKED) when nulling, blanking or changing any set import marker (3 markers x 3 ways x 5 roles); values unchanged', not fails, dict(fails=fails[:6]))
    # --- checked_in_at: once set, immutable; never settable later by an API role
    erp = mk(3303, markers=False, checked_in=True); e0 = evid(erp); fails = []
    for who, label in [(r.STAFF, 'STAFF'), (r.OWNER, 'OWNER'), (r.ADMIN, 'ADMIN'), (None, 'postgres')]:
        for how, expr in (('null', 'null'), ('change', "now()+interval '1 day'")):
            err = upd(erp, f"checked_in_at={expr}", who)
            if not locked(err) or evid(erp) != e0: fails.append((label, how, (err or 'NO ERROR')[:60]))
    check('checked_in_at, once set, cannot be nulled or moved by STAFF/OWNER/ADMIN/postgres', not fails, dict(fails=fails))
    fails = []
    for who, label in [(r.STAFF, 'STAFF'), (r.DOCTOR, 'DOCTOR'), (r.ADMIN, 'ADMIN'), (r.OWNER, 'OWNER')]:
        for col, val in (('checked_in_at', 'now()'), ('legacy_source_key', "'x::y::z'"), ('legacy_record_no', "'RM-9'"), ('legacy_source_hash', "'h9'")):
            v = mk(nxt(), markers=False, checked_in=False); err = upd(v, f"{col}={val}", who)
            if not locked(err) or evid(v)[col] is not None: fails.append((label, col, (err or 'NO ERROR')[:60]))
    check('no API role (STAFF/DOCTOR/ADMIN/OWNER) can SET an empty origin column on an existing visit either (markers/evidence exist from INSERT only)', not fails, dict(fails=fails[:6]))
    # --- the deliberate classification path (Reza as postgres) still works: empty -> value, then the OWNER may archive
    v = mk(3305, markers=False, checked_in=False); err = upd(v, "checked_in_at=now()", None)
    check('classification path: postgres (DB admin, SQL editor) can still stamp checked_in_at on an EMPTY origin; afterwards origin = erp and the OWNER can archive it', not err and h.nilai(f"select clinic_private.visit_archive_origin({q(v)})") == 'erp' and not h.gagal(arch(v, key()), r.OWNER) and is_archived(h, v), dict(error=err))
    # --- no regression of normal writes
    imp = mk(3306, markers=True, checked_in=False); erpv = mk(3307, markers=False, checked_in=True); bad = []
    for who, label in [(r.STAFF, 'STAFF'), (r.DOCTOR, 'DOCTOR')]:
        for vv in (imp, erpv):
            e1 = upd(vv, "keluhan='Keluhan fiktif diubah',poli=poli", who); e2 = upd(vv, "checked_in_at=checked_in_at,legacy_source_key=legacy_source_key,legacy_record_no=legacy_record_no,legacy_source_hash=legacy_source_hash", who)
            if e1 or e2: bad.append((label, (e1 or e2)[:80]))
    check('ordinary UPDATEs keep working for STAFF/DOCTOR (other columns; and a no-op write that lists the origin columns unchanged)', not bad and h.nilai(f"select keluhan from public.visits where id={q(imp)}") == 'Keluhan fiktif diubah', dict(bad=bad))
    st = bare(h, 3308, 'Menunggu')[0]; e1 = upd(st, "status='Diperiksa',service_started_at=now()", r.STAFF); e2 = upd(st, "status='Pembayaran',service_finished_at=now()", r.DOCTOR)
    check('normal clinic lifecycle updates (Menunggu -> Diperiksa -> Pembayaran) are not affected', not e1 and not e2 and row(h, st)['status'] == 'Pembayaran', dict(e1=e1, e2=e2))
    cust = r.buat_pelanggan(h, 3309); pet, vn = r.uid(5, 3309), r.uid(6, 3309)
    h.sql(f"insert into public.pets(id,customer_id,name) values({q(pet)},{q(cust['id'])},'Pasien Origin 3309');")
    e1 = h.gagal(f"insert into public.visits(id,branch_id,customer_id,pet_id,status,queue_number,checked_in_at) values({q(vn)},{q(r.BRANCH)},{q(cust['id'])},{q(pet)},'Menunggu','A309',now());", r.STAFF)
    vi = r.uid(6, 3310)
    e2 = h.gagal(f"insert into public.visits(id,customer_id,pet_id,status,legacy_source_key,legacy_record_no,legacy_source_hash) values({q(vi)},{q(cust['id'])},{q(pet)},'Selesai','fiktif::impor::3310','RM-3310','hash3310');")
    check('INSERT is untouched: registration-style insert (checked_in_at set) and import-style insert (all three markers at INSERT) both work', not e1 and not e2 and evid(vn)['checked_in_at'] and evid(vi)['legacy_source_hash'] == 'hash3310', dict(e1=e1, e2=e2))
    # --- the status-flip bypass: an imported visit made non-Selesai by staff is still history
    v = mk(3311, markers=True, checked_in=False); err = upd(v, "status='Diperiksa',checked_out_at=null", r.STAFF)
    f1, f2 = h.gagal(arch(v, key()), r.OWNER), h.gagal(force(v, key()), r.OWNER)
    check('status-flip bypass closed: STAFF flips an imported Selesai visit back to Diperiksa/no checkout -> OWNER archive and force are STILL refused (impor)', not err and row(h, v)['status'] == 'Diperiksa' and bool(f1 and 'impor' in f1) and bool(f2 and 'impor' in f2) and not is_archived(h, v), dict(error=err, f1=(f1 or '')[:100]))
    # --- shape
    t = h.angka("select count(*) from pg_trigger where tgrelid='public.visits'::regclass and tgname='a1_guard_visit_origin_evidence' and tgenabled='O' and (tgtype & 1)=1 and (tgtype & 2)=2 and (tgtype & 16)=16 and tgfoid='clinic_private.guard_visit_origin_evidence'::regproc")
    api = h.nilai("select coalesce(has_function_privilege('authenticated','clinic_private.guard_visit_origin_evidence()','EXECUTE')::text,'x')||coalesce(has_function_privilege('anon','clinic_private.guard_visit_origin_evidence()','EXECUTE')::text,'x')")
    secdef = h.nilai("select prosecdef::text||':'||coalesce(array_to_string(proconfig,','),'') from pg_proc where proname='guard_visit_origin_evidence'")
    check('shape: one enabled ROW + BEFORE UPDATE trigger on public.visits runs clinic_private.guard_visit_origin_evidence (EXECUTE revoked from API roles; SECURITY DEFINER + search_path empty, as the import-writer migration gate requires)', t == 1 and api == 'falsefalse' and secdef == "true:search_path=\"\"", dict(trigger=t, api=api, secdef=secdef))
    # --- the read-only classification SQL for Reza (docs) stays accurate
    doc = (ROOT / 'docs/2026-11-04-antrian-arsip-lanjutan.md').read_text(); blocks = re.findall(r"```sql\n(.*?)```", doc, re.S)
    summary_sql = [b for b in blocks if 'tidak_pasti' in b and 'group by' in b][0]
    got = {l.split('|')[0]: int(l.split('|')[1]) for l in h.sql(summary_sql).splitlines() if '|' in l}
    exp = {l.split('|')[0]: int(l.split('|')[1]) for l in h.sql("select clinic_private.visit_archive_origin(id),count(*) from public.visits where status::text='Selesai' or checked_out_at is not null group by 1;").splitlines() if '|' in l}
    check('docs: the read-only classification SQL for Reza gives exactly the counts of the live origin function (impor / erp / tidak_pasti) on the fixtures', got == exp and {'impor', 'erp', 'tidak_pasti'} <= set(got), dict(doc=got, live=exp))
    list_sql = [b for b in blocks if 'tidak_pasti' in b.lower() or 'limit 500' in b][-1]
    ids = {l.split('|')[0] for l in h.sql(list_sql).splitlines() if '|' in l}
    unc = set(h.sql("select id from public.visits where (status::text='Selesai' or checked_out_at is not null) and clinic_private.visit_archive_origin(id)='tidak_pasti';").split())
    check('docs: the list query for Reza returns exactly the visits whose origin is tidak_pasti', ids == unc and len(unc) >= 3, dict(n_doc=len(ids), n_live=len(unc)))


def bulk_safety(h, key):
    """Review conditions 2 + 4: NULL p_jalankan = dry run, NULL/odd p_batas never unlimited, repeated runs converge, summary row, manual section."""
    run_sql = BULK_OVERRIDE.get('run') or (BULK_DIR / 'bulk-arsip-antrian-jalankan.sql').read_text(); preview = (BULK_DIR / 'bulk-arsip-antrian-pratinjau.sql').read_text()
    marker = 'select * from pg_temp.bulk_arsip_antrian('; assert run_sql.count(marker) == 1; defn = run_sql.split(marker)[0]
    def call(execute, batas, owner=r.OWNER, reason=BULK_REASON):
        ex = 'null::boolean' if execute is None else 'true' if execute else 'false'
        return defn + f"select hasil,coalesce(visit_id::text,''),status,detail,coalesce(ringkasan::text,'') from pg_temp.bulk_arsip_antrian({q(owner)}::uuid,timestamptz '2026-11-01 00:00:00+07',{q(reason)},{ex},{'null::integer' if batas is None else batas});"
    def result(sql_): return [l.split('|') for l in h.sql(sql_).splitlines() if '|' in l]
    def summ(rows_): return json.loads([rw[4] for rw in rows_ if rw[0] == 'RINGKASAN'][0])
    old = "'2026-10-14 03:00:00+07'"
    def old_visit(n, status='Diperiksa'):
        vv, mm = bare(h, n, status); h.sql(f"update public.visits set created_at={old} where id={q(vv)};"); return vv, mm
    def digest(): return h.nilai("select md5(coalesce((select string_agg(v::text,'|' order by id) from public.visits v),'')||(select count(*)::text from public.visit_archive_events)||(select count(*)::text from public.invoices))")
    n_arch = lambda: h.angka("select count(*) from public.visits where archived_at is not null")
    # (1) p_jalankan NULL must never run for real
    ids = [old_visit(3400 + i)[0] for i in range(60)]
    d0 = digest(); rows_ = result(call(None, 5)); s = summ(rows_)
    check('p_jalankan NULL is a DRY RUN (never a real run): nothing written, summary says dry_run, rows are AKAN_DIARSIPKAN', d0 == digest() and s.get('dry_run') is True and s.get('archived_this_run') == 0 and any(rw[0] == 'AKAN_DIARSIPKAN' for rw in rows_) and not any(rw[0] == 'DIARSIPKAN' for rw in rows_), dict(summary=s))
    # (2) p_batas
    d0 = digest(); errs = {b: h.gagal(call(True, b)) for b in (0, -1, 501, 100000)}
    check('p_batas 0 / -1 / 501 / 100000 refused for a REAL run (hard cap 500, minimum 1); nothing written', all(errs.values()) and d0 == digest(), dict(errors={k: (v or '')[:80] for k, v in errs.items()}))
    check('p_batas 500 is accepted (the cap itself)', not h.gagal(call(False, 500)), {})
    a0 = n_arch(); rows_ = result(call(True, None)); a1 = n_arch(); s = summ(rows_)
    check('p_batas NULL is NOT unlimited: a real run archives exactly the default 50 (60 eligible), the summary reports 50 archived and 10 remaining', a1 - a0 == 50 and s.get('archived_this_run') == 50 and s.get('remaining_archivable') == 10, dict(delta=a1 - a0, summary=s))
    # (3) summary shape + convergence with skipped rows that never go away
    for i in range(25): vv, _ = old_visit(3500 + i, 'Selesai'); h.sql(f"update public.visits set checked_out_at=now(),legacy_source_key='fiktif::konv::{i}' where id={q(vv)};")
    inv_v, _ = old_visit(3530, 'Pembayaran'); h.sql(f"insert into public.invoices(visit_id,subtotal,total,paid_status) values({q(inv_v)},0,0,'Belum Lunas');")
    soft, _ = soft_visit(h, 3531, 'Pembayaran'); h.sql(f"update public.visits set created_at={old} where id={q(soft)};")
    sel_c, mrc = old_visit(3532, 'Selesai'); h.sql(f"update public.visits set checked_out_at=now() where id={q(sel_c)};update public.medical_records set diagnosis='Diagnosis Fiktif Selesai' where id={q(mrc)};")
    s0 = summ(result(call(False, 5)))
    check('summary row carries archived_this_run, remaining_archivable, skipped_total and skipped_by_reason (with the imported reason counted) after the fixtures', all(k in s0 for k in ('archived_this_run', 'remaining_archivable', 'skipped_total', 'skipped_by_reason')) and s0['skipped_total'] >= 26 and any('impor' in k for k in s0['skipped_by_reason']) and s0['remaining_archivable'] == 12, dict(summary=s0))
    loops, listed_skip, last = 0, 0, None
    while loops < 10:
        loops += 1; rows_ = result(call(True, 5)); last = summ(rows_); listed_skip += sum(1 for rw in rows_ if rw[0] in ('DILEWATI', 'SUDAH_PERNAH'))
        if last['remaining_archivable'] == 0: break
    check('repeated REAL runs (batch 5) converge: remaining_archivable reaches 0 within 3 runs although 26+ permanently-skipped rows exist; skipped rows are never re-listed per run', last['remaining_archivable'] == 0 and loops <= 3 and listed_skip == 0, dict(loops=loops, last=last, listed_skip=listed_skip))
    rows_ = result(call(True, 5)); s = summ(rows_)
    check('after convergence a further run archives nothing, remaining_archivable=0 and the only per-visit rows are PERLU_MANUAL (no endless list)', s['archived_this_run'] == 0 and s['remaining_archivable'] == 0 and {rw[0] for rw in rows_} <= {'RINGKASAN', 'PERLU_MANUAL'}, dict(summary=s, kinds=sorted({rw[0] for rw in rows_})))
    check('imported rows were never archived by the loop; the stuck Pembayaran visit with an unpaid invoice stays in the live queue', h.angka("select count(*) from public.visits where legacy_source_key like 'fiktif::konv::%' and archived_at is not null") == 0 and not is_archived(h, inv_v), {})
    # (4) manual section (BC4) + clinical content rows visible in the dry run (BC3)
    inv2, _ = old_visit(3533, 'Pembayaran'); h.sql(f"insert into public.invoices(visit_id,subtotal,total,paid_status) values({q(inv2)},0,0,'Belum Lunas');")
    d0 = digest(); rows_ = result(call(False, 1)); by = {rw[1]: rw for rw in rows_ if rw[1]}; s = summ(rows_)
    check('dry run lists Pembayaran visits with a draft/unpaid invoice in a SEPARATE section (PERLU_MANUAL), named as needing manual handling, even when the batch is 1; the summary counts them; nothing is archived', all(by.get(i, [''])[0] == 'PERLU_MANUAL' for i in (inv_v, inv2)) and 'manual' in by[inv2][3].lower() and s.get('manual_total', 0) >= 2 and d0 == digest(), dict(row=by.get(inv2), manual_total=s.get('manual_total')))
    soft_fix, _ = soft_visit(h, 3534, 'Pembayaran'); h.sql(f"update public.visits set created_at={old} where id={q(soft_fix)};")
    sel_d, mrd = old_visit(3535, 'Selesai'); h.sql(f"update public.visits set checked_out_at=now() where id={q(sel_d)};update public.medical_records set diagnosis='Diagnosis Fiktif Selesai 2' where id={q(mrd)};")
    rows_ = result(call(False, 50)); by = {rw[1]: rw for rw in rows_ if rw[1]}; s = summ(rows_)
    check('BC3: the dry run shows the clinical content that WILL be force-archived for Pembayaran and Selesai rows (detail "dipaksa: ... data klinis"), and the summary counts forced rows per status', all(by.get(i, ['', '', '', ''])[0] == 'AKAN_DIARSIPKAN' and 'dipaksa' in by[i][3] and 'data klinis' in by[i][3] for i in (soft_fix, sel_d)) and s.get('akan_dipaksa_per_status', {}).get('Pembayaran', 0) >= 1 and s.get('akan_dipaksa_per_status', {}).get('Selesai', 0) >= 1, dict(rows={k[-6:]: v[3][:80] for k, v in by.items() if k in (soft_fix, sel_d)}, forced=s.get('akan_dipaksa_per_status')))
    # (5) preview SQL: manual section, branch-scoped imports, impor for every status
    out = h.sql(preview)
    check('preview SQL has the separate "perlu ditangani manual" result set and the branch-scoped-import check (read-only)', 'perlu ditangani manual' in preview.lower() and 'branch_id is not null' in preview and inv2 in out, dict(has_manual='perlu ditangani manual' in preview.lower()))
    plan = (BULK_DIR / 'bulk-archive-plan.md').read_text() if (BULK_DIR / 'bulk-archive-plan.md').exists() else ''
    need = ['remaining_archivable', 'p_jalankan', 'perlu ditangani manual', 'baris demi baris', 'dry run', 'skipped_by_reason', '500']
    check('bulk-archive-plan.md documents the exact safe usage (dry run -> read the list row by row -> run batches until remaining_archivable = 0; manual Pembayaran section; owner reads clinical-content rows)', all(w.lower() in plan.lower() for w in need), dict(missing=[w for w in need if w.lower() not in plan.lower()]))


def footprint(db):
    return db.sql("""select 'cols='||(select count(*) from information_schema.columns where table_schema='public' and table_name='visit_archive_events' and column_name in ('forced','overridden'))
 ||'|new='||(select count(*) from pg_proc where proname in ('visit_archive_origin','visit_archive_classify','clinic_force_archive_visit','guard_visit_origin_evidence'))
 ||'|six='||(select count(*) from pg_proc where proname='change_visit_archive' and pronargs=6)
 ||'|blk='||md5(pg_get_functiondef('clinic_private.visit_archive_blockers(uuid)'::regprocedure))
 ||'|chg4='||md5(pg_get_functiondef('clinic_private.change_visit_archive(uuid,text,text,boolean)'::regprocedure))
 ||'|trg='||(select count(*) from pg_trigger where tgrelid='public.visits'::regclass and tgname like '%origin%' and not tgisinternal);""")


def footprint_for(db, name):
    old = os.environ.get('PGDATABASE'); os.environ['PGDATABASE'] = name
    try: return footprint(db)
    finally:
        if old is None: os.environ.pop('PGDATABASE', None)
        else: os.environ['PGDATABASE'] = old


def psql_env(db, dbname): return {**os.environ, 'PSQLRC': '/dev/null', 'PGDATABASE': dbname}


def psql_timed(db, dbname, source, timeout=60):
    t = time.monotonic()
    try: res = subprocess.run(db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], input=source, text=True, capture_output=True, env=psql_env(db, dbname), timeout=timeout)
    except subprocess.TimeoutExpired: return -1, f'BLOCKED: no result within {timeout}s (unbounded lock wait)', time.monotonic() - t
    return res.returncode, res.stderr, time.monotonic() - t


def atomic_checks(db, text, tag='', tpl='postgres'):
    """Review condition 3: the file is ONE transaction (the wrapper provides it), waits <= 5s for locks, re-run fails closed, a forced failure leaves nothing."""
    code = [l for l in text.splitlines() if l.strip() and not l.lstrip().startswith('--')]
    check('static: first statement of the file is `set local lock_timeout` <= 10s (before any DDL)', bool(re.match(r"set\s+local\s+lock_timeout\s*=\s*'([1-9]|10)s'\s*;\s*$", code[0], re.I)), dict(first=code[0][:120]))
    check('static: no top-level begin/commit/rollback in the file (the apply wrapper provides the transaction)', not any(re.match(r'(begin|start\s+transaction|commit|rollback|end)\s*;\s*$', l.strip(), re.I) for l in code), {})
    check('static: the file header says it must be applied as ONE TRANSACTION', 'ONE TRANSACTION' in text, {})
    mk = lambda name: (db.sql(f'create database {name} template {tpl};'), os.environ.__setitem__('PGDATABASE', name))
    wrap = lambda body: 'begin;\n' + body + '\ncommit;'
    def attempt(src):
        try: db.sql(src); return None
        except RuntimeError as e: return str(e)
    try:
        mk(('atom_base'+tag)); base = footprint(db)
        check('baseline cluster has none of the follow-up objects', base.startswith('cols=0|new=0|six=0|') and base.endswith('|trg=0'), dict(base=base))
        a1, a2 = 'create function clinic_private.visit_archive_classify(', 'revoke all on function public.clinic_force_archive_visit(uuid,text,text,text) from public,anon,service_role;'
        if text.count(a1) != 1 or text.count(a2) != 1: check('mid-file failure anchors exist', False, dict(a1=text.count(a1), a2=text.count(a2)))
        else:
            for label, mid in (('after the column + origin helper, before classify', text.replace(a1, 'select 1/0;\n' + a1)), ('at the very end, after the 6-arg entry, the force RPC and the trigger', text + '\nselect 1/0;\n')):
                err = attempt(wrap(mid)); after = footprint(db)
                check(f'forced failure {label}: NOTHING applied (no column, no new function, patched functions byte-identical, no trigger)', has(err, 'division by zero') and after == base, dict(error=(err or '')[:140], after=after))
        mk(('atom_lock'+tag)); holder = subprocess.Popen(db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=psql_env(db, ('atom_lock'+tag)))
        try:
            holder.stdin.write("begin;\nlock table public.visit_archive_events in access share mode;\nselect 'held';\nselect pg_sleep(60);\n"); holder.stdin.flush()
            assert holder.stdout.readline().strip() == 'held'
            rc, stderr, secs = psql_timed(db, ('atom_lock'+tag), wrap(text), timeout=25)
        finally: holder.kill(); holder.wait()
        check('lock wait is bounded: with visit_archive_events held by another transaction the migration fails with lock timeout in ~5s (not blocked), nothing applied', rc != 0 and 'lock timeout' in stderr and 3.5 <= secs <= 12 and footprint(db) == base, dict(rc=rc, seconds=round(secs, 1), stderr=stderr[:140]))
        mk(('atom_visits'+tag)); holder = subprocess.Popen(db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=psql_env(db, ('atom_visits'+tag)))
        try:
            holder.stdin.write("begin;\nlock table public.visits in row exclusive mode;\nselect 'held';\nselect pg_sleep(60);\n"); holder.stdin.flush()
            assert holder.stdout.readline().strip() == 'held'
            rc, stderr, secs = psql_timed(db, ('atom_visits'+tag), wrap(text), timeout=25)
        finally: holder.kill(); holder.wait()
        check('lock wait on public.visits (trigger creation) is bounded too: fails with lock timeout in ~5s, nothing applied', rc != 0 and 'lock timeout' in stderr and 3.5 <= secs <= 12 and footprint(db) == base, dict(rc=rc, seconds=round(secs, 1), stderr=stderr[:140]))
        mk(('atom_ok'+tag)); err = attempt(wrap(text)); applied = footprint(db)
        check('applies in one transaction on a clean database: column, 5 new functions (origin, classify, 6-arg, force RPC, guard), trigger present; patched bodies changed', err is None and applied != base and applied.startswith('cols=2|new=4|six=1|') and applied.endswith('|trg=1') and applied.split('|')[3] != base.split('|')[3], dict(error=(err or '')[:160], applied=applied))
        err = attempt(wrap(text))
        check('re-run on the migrated database FAILS CLOSED (objects already exist) and changes nothing', has(err, 'objek sudah ada') and footprint(db) == applied, dict(error=(err or '')[:160]))
        mk(('atom_1'+tag)); rc, stderr, _ = psql_timed(db, ('atom_1'+tag), text + '\nselect 1/0;\n'); partial = footprint(db)
        res = subprocess.run(db.as_user + [db.psql, '-X', '-qAt', '-1', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-d', ('atom_base'+tag)], input=text + '\nselect 1/0;\n', text=True, capture_output=True, env=psql_env(db, ('atom_base'+tag)))
        check('psql -1 (single transaction) on the failing file leaves nothing applied', res.returncode != 0 and footprint_for(db, ('atom_base'+tag)) == base, dict(rc=res.returncode, stderr=res.stderr[:100]))
        check('control (documents the hazard): the same failing file applied statement by statement leaves a partial apply, which is why ONE transaction is required', rc != 0 and partial != base, dict(partial=partial))
    finally: os.environ.pop('PGDATABASE', None)


def has(err, *words): return bool(err) and all(w in err for w in words)


def apply_candidate(db, text): db.sql('begin;\n' + text + '\ncommit;')


MUTANTS = {  # name -> (target, anchor, replacement): each guard removed; 'old' = PR #438 migration text, 'new' = follow-up migration text. Every mutant must be KILLED by the suite
    # --- guards that live in the PR #438 migration and survive the follow-up unchanged
    'direct archive-column writes are no longer guarded': ('old', "if not exists(select 1 from clinic_private.visit_archive_permits p\n   where p.transaction_id=txid_current() and p.visit_id=old.id and p.actor=auth.uid()) then", "if false then"),
    'archived visit lifecycle is no longer frozen (start/finish/checkout)': ('old', "if old.archived_at is not null and (new.status,", "if false and (new.status,"),
    'no entry guard on invoices/records (payment on an archived visit)': ('old', "foreach t in array array['medical_records','prescription_items','invoices',", "foreach t in array array['prescription_items',"),
    'archived visits are no longer excluded from the Rekam Medis list': ('old', "\n       and (p_pet is not null or v.archived_at is null)$new$;", "$new$;"),
    # --- the archive/unarchive entry point and blockers (redefined by the follow-up)
    'role check lets STAFF/DOCTOR/FINANCE through': ('new', "p.is_active and p.role in ('OWNER','ADMIN')) then\n  raise exception using errcode='P0001',message='ACCESS_DENIED", "p.is_active and p.role in ('OWNER','ADMIN','STAFF','DOCTOR','FINANCE')) then\n  raise exception using errcode='P0001',message='ACCESS_DENIED"),
    'visit row is not locked (no FOR UPDATE)': ('new', "select * into v from public.visits where id=p_visit_id for update;", "select * into v from public.visits where id=p_visit_id;"),
    'invoice no longer blocks archiving': ('new', "if exists(select 1 from public.invoices i where i.visit_id=p_visit) then hard:=hard||", "if false then hard:=hard||"),
    'pending billing cart no longer blocks': ('new', "and not exists(select 1 from public.invoice_items ii where ii.prescription_item_id=pi.id)) then\n  soft:=soft||'ada tagihan tertunda (item/layanan belum ditagih)'::text;\n elsif exists(select 1 from public.prescription_items pi join public.medical_records mr on mr.id=pi.medical_record_id where mr.visit_id=p_visit) then\n  soft:=soft||'ada item resep/layanan pada rekam medis'::text;\n end if;", "and false) then null;\n end if;"),
    'open inpatient no longer blocks': ('new', "then hard:=hard||'rawat inap masih berjalan'::text;\n elsif", "then null;\n elsif"),
    'reason no longer mandatory': ('new', "if p_archive and (v_reason is null or length(v_reason)<5 or length(v_reason)>500) then", "if false then"),
    'replay is not recognised (double write)': ('new', "if v_event.visit_id=p_visit_id and v_event.action=v_action and v_event.created_by=v_actor and v_event.forced=p_force then", "if false then"),
    'stale already-archived check removed': ('new', "  if v.archived_at is not null then\n   raise exception using errcode='P0001',message='ARCHIVE_STALE: kunjungan ini sudah diarsipkan", "  if false then\n   raise exception using errcode='P0001',message='ARCHIVE_STALE: kunjungan ini sudah diarsipkan"),
    'signed consent no longer blocks': ('new', "c.status='sudah_ttd') then soft:=soft||", "c.status='sudah_ttd' and false) then soft:=soft||"),
    'clinical content no longer blocks': ('new', "or mr.submission_key is not null or mr.submitted_by is not null or mr.clinical_revision>0 or mr.continued_from_record_id is not null)) then", "or false)) then"),
    # --- follow-up: force-archive
    'ADMIN may force (owner-only check removed)': ('new', "if p_force and not exists(select 1 from public.profiles p where p.id=v_actor and p.is_active and p.role='OWNER') then", "if false then"),
    'force without the confirmation word': ('new', "if p_force and p_confirm is distinct from 'PAKSA' then", "if false then"),
    'force reason may be punctuation only': ('new', "if p_force and length(regexp_replace(v_reason,'[^[:alnum:]]','','g'))<5 then", "if false then"),
    'hard blockers (money/stock/inpatient) can be forced': ('new', "if cardinality(v_hard)>0 then", "if false then"),
    'soft blockers no longer need force (plain archive passes)': ('new', "   if not p_force then\n    raise exception using errcode='P0001',message='ARCHIVE_BLOCKED: kunjungan tidak dapat diarsipkan karena '||array_to_string(v_soft,'; ')", "   if false then\n    raise exception using errcode='P0001',message='ARCHIVE_BLOCKED: kunjungan tidak dapat diarsipkan karena '||array_to_string(v_soft,'; ')"),
    'overridden blockers are not recorded in the audit event': ('new', "v_now,p_force,v_over) returning * into v_event;", "v_now,p_force,'{}') returning * into v_event;"),
    'replay ignores the forced flag (plain call can replay a force key)': ('new', " and v_event.created_by=v_actor and v_event.forced=p_force then", " and v_event.created_by=v_actor then"),
    'lock_timeout removed from the archive RPC': ('new', "returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$", "returns jsonb language plpgsql security definer set search_path='' as $$"),
    # --- follow-up: Selesai only when ERP-origin
    'imported Selesai visits can be archived': ('new', "if o='impor' then hard:=hard||", "if false then hard:=hard||"),
    'Selesai of uncertain origin can be archived': ('new', "and o<>'erp' then hard:=hard||", "and false then hard:=hard||"),
    'ERP-origin Selesai is never archivable (old rule)': ('new', "and o<>'erp' then hard:=hard||", "and true then hard:=hard||"),
    'legacy_record_no is not an import marker': ('new', " or v.legacy_record_no is not null or v.legacy_source_hash is not null then 'impor'", " or v.legacy_source_hash is not null then 'impor'"),
    'legacy_source_hash is not an import marker': ('new', " or v.legacy_record_no is not null or v.legacy_source_hash is not null then 'impor'", " or v.legacy_record_no is not null then 'impor'"),
    'legacy_source_key is not an import marker': ('new', "when v.legacy_source_key is not null or v.legacy_record_no is not null", "when v.legacy_record_no is not null"),
    'checked_in_at no longer needed as ERP evidence': ('new', "when v.checked_in_at is not null then 'erp'", "when true then 'erp'"),
    # --- review conditions: tamper-proof origin evidence
    'origin trigger disabled (evidence editable by staff)': ('new', "execute function clinic_private.guard_visit_origin_evidence();", "execute function clinic_private.guard_visit_origin_evidence();\nalter table public.visits disable trigger a1_guard_visit_origin_evidence;"),
    'legacy_source_key can be nulled/changed once set': ('new', " if (old.legacy_source_key is not null and new.legacy_source_key is distinct from old.legacy_source_key)", " if (false)"),
    'legacy_record_no can be nulled/changed once set': ('new', "  or (old.legacy_record_no is not null and new.legacy_record_no is distinct from old.legacy_record_no)", "  or false"),
    'legacy_source_hash can be nulled/changed once set': ('new', "  or (old.legacy_source_hash is not null and new.legacy_source_hash is distinct from old.legacy_source_hash)", "  or false"),
    'checked_in_at can be nulled/changed once set': ('new', "  or (old.checked_in_at is not null and new.checked_in_at is distinct from old.checked_in_at) then", "  or false then"),
    'API roles may fill an empty origin column after INSERT': ('new', "if coalesce(current_setting('role',true),'none') in ('authenticated','anon','service_role')", "if false"),
    'API roles may stamp checked_in_at on an existing visit': ('new', "    or (old.checked_in_at is null and new.checked_in_at is not null)) then", "    or false) then"),
    'import marker only counts for finished visits (status-flip bypass)': ('new', "o:=clinic_private.visit_archive_origin(p_visit);\n if o='impor' then", "o:=case when v.status::text='Selesai' or v.checked_out_at is not null then clinic_private.visit_archive_origin(p_visit) else 'erp' end;\n if o='impor' then"),
    # --- review conditions: bulk script safety
    'bulk: NULL p_jalankan runs for real': ('bulk', "v_run boolean:=(p_jalankan is true);", "v_run boolean:=coalesce(p_jalankan,true);"),
    'bulk: NULL p_batas means 500 (not the default 50)': ('bulk', "coalesce(p_batas,50)", "coalesce(p_batas,500)"),
    'bulk: no hard cap of 500': ('bulk', "if v_batas<1 or v_batas>500 then", "if v_batas<1 then"),
    'bulk: p_batas below 1 accepted': ('bulk', "if v_batas<1 or v_batas>500 then", "if v_batas>500 then"),
    'bulk: permanently skipped rows are listed on every run (never converges)': ('bulk', "if r.antrean_hidup then", "if true then"),
    'bulk: no PERLU_MANUAL section': ('bulk', "if r.antrean_hidup then", "if false then"),
    'bulk: remaining_archivable always 0': ('bulk', "'remaining_archivable',v_actionable-v_ok", "'remaining_archivable',0"),
    'bulk: forced rows per status not counted (clinical content hidden from the summary)': ('bulk', "if jsonb_array_length(c->'soft')>0 then\n   v_forced", "if false then\n   v_forced"),
    # --- follow-up: bulk plan (script text, not a migration)
    'bulk script archives hard-blocked visits (skip removed)': ('bulk', "if jsonb_array_length(c->'hard')>0 then", "if false then"),
    'bulk script does not check the OWNER profile': ('bulk', "not exists(select 1 from public.profiles pr where pr.id=p_owner and pr.is_active and pr.role='OWNER')", "false"),
    'bulk script ignores the batch limit': ('bulk', "if n<v_batas then", "if true then"),
    'bulk script has no dry-run mode': ('bulk', "if not v_run then", "if false then"),
    'bulk script keys are not stable (re-run archives restored visits again)': ('bulk', "k:='bulk-arsip-20261101-'||r.vid::text;", "k:='bulk-arsip-20261101-'||gen_random_uuid()::text;"),
    'bulk script allows a cutoff after 1 Nov 2026': ('bulk', "if p_cutoff is null or p_cutoff > timestamptz '2026-11-01 00:00:00+07' then", "if false then"),
}


ATOMIC_MUTANTS = {  # applied to the follow-up file text; must be KILLED by atomic_checks (review condition 3)
    'migration has no `set local lock_timeout`': ("set local lock_timeout = '5s';\n", ""),
    'migration lock_timeout is 60s (unbounded in practice)': ("set local lock_timeout = '5s';", "set local lock_timeout = '60s';"),
    'migration commits by itself (defeats the wrapper rollback)': ("execute function clinic_private.guard_visit_origin_evidence();", "execute function clinic_private.guard_visit_origin_evidence();\ncommit;"),
    'migration lost its re-run guard (fail closed -> noisy partial error)': ("raise exception 'Arsip lanjutan: objek sudah ada; periksa urutan migrasi';", "null;"),
    'migration header no longer says ONE TRANSACTION': ("ONE TRANSACTION", "one tx"),
}


def build_chain(stack, selected, db_cls):
    d = stack.enter_context(tempfile.TemporaryDirectory(prefix='chain.', dir=ROOT)); target = Path(d) / 'supabase/migrations'; target.mkdir(parents=True)
    for s in selected: (target / s.name).symlink_to(s)
    r.fixture.ROOT = Path(d)
    return stack.enter_context(db_cls(r.BIN))


class Attached(r.NativePostgres):
    def __init__(self, bin_dir, root):
        super().__init__(bin_dir); self.root = Path(root); self.as_user = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
    def __enter__(self): return self
    def __exit__(self, *_): return None


def run_in_clone(db, name, template, setup, variant_texts=None):
    db.sql(f'create database {name} template {template};'); os.environ['PGDATABASE'] = name
    for text in variant_texts or []: apply_candidate(db, text)
    start = len(RESULTS)
    try: run(x.Harness(db), setup=setup)
    except Exception as e: check('HARNESS', False, str(e)[:400])
    os.environ.pop('PGDATABASE', None); return RESULTS[start:]


def main():
    p = argparse.ArgumentParser(); p.add_argument('--baseline', action='store_true'); p.add_argument('--mutations', action='store_true'); p.add_argument('--atomic-only', action='store_true'); p.add_argument('--migration', type=Path, help='override the follow-up file text (mutation / RED evidence)'); p.add_argument('--attach'); p.add_argument('--pg-bin')
    p.add_argument('--json', type=Path, required=True); a = p.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    sources = sorted((ROOT / 'supabase/migrations').glob('*.sql')); candidate_text = (ROOT / 'supabase/migrations' / CANDIDATE).read_text(); followup_text = (a.migration or ROOT / 'supabase/migrations' / FOLLOWUP).read_text(); bulk_text = (BULK_DIR / 'bulk-arsip-antrian-jalankan.sql').read_text()
    extra = {}
    try:
        if a.attach:
            with Attached(r.BIN, a.attach) as db:
                run_in_clone(db, 'arsip_run_%d' % int(time.time()), 'postgres', False)
            selected = sources
        elif a.atomic_only:
            selected = [s for s in sources if s.name != FOLLOWUP]
            with contextlib.ExitStack() as stack:
                db = build_chain(stack, selected, r.NativePostgres); r.fixture.DisposablePostgres.bootstrap(db); atomic_checks(db, followup_text)
        elif a.mutations:
            selected = [s for s in sources if s.name not in (CANDIDATE, FOLLOWUP)]
            only = os.environ.get('MUTANT_FILTER')   # development: comma-separated name fragments
            with contextlib.ExitStack() as stack:
                db = build_chain(stack, selected, r.NativePostgres); r.fixture.DisposablePostgres.bootstrap(db); x.setup(x.Harness(db))
                control = run_in_clone(db, 'mut_control', 'postgres', False, [candidate_text, followup_text]); extra['control_fail'] = sum(c['status'] == 'FAIL' for c in control)
                extra['mutants'] = {}
                for i, (name, (target, anchor, repl)) in enumerate(MUTANTS.items()):
                    if only and not any(f in name for f in only.split(',')): continue
                    texts = dict(old=candidate_text, new=followup_text, bulk=bulk_text)
                    assert texts[target].count(anchor) == 1, f'mutant anchor not unique/stale: {name}'
                    mutated = texts[target].replace(anchor, repl)
                    BULK_OVERRIDE.clear()
                    if target == 'bulk': BULK_OVERRIDE['run'] = mutated
                    res = run_in_clone(db, f'mut_{i}', 'postgres', False, [mutated if target == 'old' else candidate_text, mutated if target == 'new' else followup_text])
                    BULK_OVERRIDE.clear()
                    failed = [c['case'] for c in res if c['status'] == 'FAIL']; extra['mutants'][name] = dict(killed=bool(failed), failing_cases=failed)
                    print('MUTANT', 'KILLED' if failed else 'SURVIVED', name, len(failed), flush=True)
                if not only or any(f in 'migration' for f in only.split(',')):   # atomic (file-level) mutants: a clean chain with only the first migration applied
                    db.sql('create database mut_atom_tpl template postgres;'); os.environ['PGDATABASE'] = 'mut_atom_tpl'; apply_candidate(db, candidate_text); os.environ.pop('PGDATABASE', None)
                    start = len(RESULTS); atomic_checks(db, followup_text, tag='_c', tpl='mut_atom_tpl'); extra['control_fail'] += sum(c['status'] == 'FAIL' for c in RESULTS[start:])
                    for j, (name, (anchor, repl)) in enumerate(ATOMIC_MUTANTS.items()):
                        assert followup_text.count(anchor) == 1, f'atomic mutant anchor not unique/stale: {name}'
                        start = len(RESULTS); atomic_checks(db, followup_text.replace(anchor, repl), tag=f'_{j}', tpl='mut_atom_tpl')
                        failed = [c['case'] for c in RESULTS[start:] if c['status'] == 'FAIL']; extra['mutants'][name] = dict(killed=bool(failed), failing_cases=failed)
                        print('MUTANT', 'KILLED' if failed else 'SURVIVED', name, len(failed), flush=True)
        else:
            selected = [s for s in sources if not (a.baseline and s.name == FOLLOWUP)]
            with contextlib.ExitStack() as stack:
                db = build_chain(stack, selected, r.NativePostgres); r.fixture.DisposablePostgres.bootstrap(db); run(x.Harness(db))
            if not a.attach:   # the migration FILE on a database that does not have it yet (a clean chain without the follow-up)
                with contextlib.ExitStack() as stack2:
                    db2 = build_chain(stack2, [s for s in sources if s.name != FOLLOWUP], r.NativePostgres); r.fixture.DisposablePostgres.bootstrap(db2); atomic_checks(db2, followup_text)
    except Exception as e: check('HARNESS', False, str(e)[:600])
    totals = {s: sum(c['status'] == s for c in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='MUTATIONS' if a.mutations else 'RED' if a.baseline else 'candidate', migration_count=len(selected), cases=RESULTS, totals=totals, **extra), indent=2, default=str)); print(totals, extra.get('mutants') and {k: v['killed'] for k, v in extra['mutants'].items()})
    if a.mutations: return int(extra.get('control_fail', 1) > 0 or not all(v['killed'] for v in extra.get('mutants', {}).values()))
    return int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
