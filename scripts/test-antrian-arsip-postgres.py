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
import argparse, contextlib, importlib.util, json, os, re, sys, tempfile, time
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('medical', ROOT / 'scripts/test-rekam-full-edit-postgres.py'); assert spec and spec.loader
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
x, r, q, j = m.x, m.r, m.q, m.j
dp = x.dp
CANDIDATE = '20261106400000_antrian_arsip_kunjungan.sql'
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
    v, mr = bare(h, 3035, 'Selesai'); h.sql(f"update public.visits set checked_out_at=now() where id={q(v)};")
    refused('visit already Selesai (history)', v, 'sudah selesai')
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
 from pg_proc p where p.proname in ('clinic_archive_visit','clinic_unarchive_visit','change_visit_archive','visit_archive_blockers','guard_visit_archive','refuse_archived_visit') and p.pronamespace in ('public'::regnamespace,'clinic_private'::regnamespace)"""))
    pubs = [e for e in meta if e['f'].startswith('public.')]; priv = [e for e in meta if e['f'].startswith('clinic_private.')]
    check('public RPCs: SECURITY DEFINER, search_path empty, EXECUTE for authenticated only (not anon/public/service_role)', len(pubs) == 2 and all(e['def'] and e['cfg'] == ['search_path=""'] and e['auth'] and not (e['anon'] or e['pub'] or e['svc']) for e in pubs), pubs)
    check('private helpers/guards: SECURITY DEFINER, search_path empty, executable by nobody client-side', len(priv) == 4 and all(e['def'] and e['cfg'] == ['search_path=""'] and not (e['anon'] or e['pub'] or e['svc'] or e['auth']) for e in priv), priv)
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


def apply_candidate(db, text): db.sql('begin;\n' + text + '\ncommit;')


MUTANTS = {  # name -> (anchor, replacement): each guard removed from the migration; the suite must FAIL for every one
    'role check lets STAFF/DOCTOR/FINANCE through': ("p.is_active and p.role in ('OWNER','ADMIN')) then\n  raise exception using errcode='P0001',message='ACCESS_DENIED", "p.is_active and p.role in ('OWNER','ADMIN','STAFF','DOCTOR','FINANCE')) then\n  raise exception using errcode='P0001',message='ACCESS_DENIED"),
    'visit row is not locked (no FOR UPDATE)': ("select * into v from public.visits where id=p_visit_id for update;", "select * into v from public.visits where id=p_visit_id;"),
    'invoice no longer blocks archiving': ("if exists(select 1 from public.invoices i where i.visit_id=p_visit) then b:=b||", "if false then b:=b||"),
    'pending billing cart no longer blocks': ("and not exists(select 1 from public.invoice_items ii where ii.prescription_item_id=pi.id)) then\n  b:=b||'ada tagihan tertunda (item/layanan belum ditagih)'::text;\n elsif exists(select 1 from public.prescription_items pi join public.medical_records mr on mr.id=pi.medical_record_id where mr.visit_id=p_visit) then\n  b:=b||'ada item resep/layanan pada rekam medis'::text;\n end if;", "and false) then null;\n end if;"),
    'open inpatient no longer blocks': ("if exists(select 1 from public.inpatient_records s where s.visit_id=p_visit and s.discharged_at is null) then b:=b||'rawat inap masih berjalan'::text;\n elsif", "if false then null;\n elsif"),
    'reason no longer mandatory': ("if p_archive and (v_reason is null or length(v_reason)<5 or length(v_reason)>500) then", "if false then"),
    'replay is not recognised (double write)': ("if v_event.visit_id=p_visit_id and v_event.action=v_action and v_event.created_by=v_actor then", "if false then"),
    'stale already-archived check removed': ("  if v.archived_at is not null then\n   raise exception using errcode='P0001',message='ARCHIVE_STALE: kunjungan ini sudah diarsipkan", "  if false then\n   raise exception using errcode='P0001',message='ARCHIVE_STALE: kunjungan ini sudah diarsipkan"),
    'direct archive-column writes are no longer guarded': ("if not exists(select 1 from clinic_private.visit_archive_permits p\n   where p.transaction_id=txid_current() and p.visit_id=old.id and p.actor=auth.uid()) then", "if false then"),
    'archived visit lifecycle is no longer frozen (start/finish/checkout)': ("if old.archived_at is not null and (new.status,", "if false and (new.status,"),
    'no entry guard on invoices/records (payment on an archived visit)': ("foreach t in array array['medical_records','prescription_items','invoices',", "foreach t in array array['prescription_items',"),
    'signed consent no longer blocks': ("c.status='sudah_ttd') then b:=b||", "c.status='sudah_ttd' and false) then b:=b||"),
    'archived visits are no longer excluded from the Rekam Medis list': ("\n       and (p_pet is not null or v.archived_at is null)$new$;", "$new$;"),
    'clinical content no longer blocks': ("or mr.submission_key is not null or mr.submitted_by is not null or mr.clinical_revision>0 or mr.continued_from_record_id is not null)) then", "or false)) then"),
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


def run_in_clone(db, name, template, setup, variant_text=None):
    db.sql(f'create database {name} template {template};'); os.environ['PGDATABASE'] = name
    if variant_text is not None: apply_candidate(db, variant_text)
    start = len(RESULTS)
    try: run(x.Harness(db), setup=setup)
    except Exception as e: check('HARNESS', False, str(e)[:400])
    os.environ.pop('PGDATABASE', None); return RESULTS[start:]


def main():
    p = argparse.ArgumentParser(); p.add_argument('--baseline', action='store_true'); p.add_argument('--mutations', action='store_true'); p.add_argument('--attach'); p.add_argument('--pg-bin')
    p.add_argument('--json', type=Path, required=True); a = p.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    sources = sorted((ROOT / 'supabase/migrations').glob('*.sql')); candidate_text = (ROOT / 'supabase/migrations' / CANDIDATE).read_text()
    extra = {}
    try:
        if a.attach:
            with Attached(r.BIN, a.attach) as db:
                run_in_clone(db, 'arsip_run_%d' % int(time.time()), 'postgres', False)
            selected = sources
        elif a.mutations:
            selected = [s for s in sources if s.name != CANDIDATE]
            with contextlib.ExitStack() as stack:
                db = build_chain(stack, selected, r.NativePostgres); r.fixture.DisposablePostgres.bootstrap(db); x.setup(x.Harness(db))
                control = run_in_clone(db, 'mut_control', 'postgres', False, candidate_text); extra['control_fail'] = sum(c['status'] == 'FAIL' for c in control)
                extra['mutants'] = {}
                for i, (name, (anchor, repl)) in enumerate(MUTANTS.items()):
                    assert candidate_text.count(anchor) == 1, f'mutant anchor not unique/stale: {name}'
                    res = run_in_clone(db, f'mut_{i}', 'postgres', False, candidate_text.replace(anchor, repl))
                    failed = [c['case'] for c in res if c['status'] == 'FAIL']; extra['mutants'][name] = dict(killed=bool(failed), failing_cases=failed)
                    print('MUTANT', 'KILLED' if failed else 'SURVIVED', name, len(failed), flush=True)
        else:
            selected = [s for s in sources if not (a.baseline and s.name == CANDIDATE)]
            with contextlib.ExitStack() as stack:
                db = build_chain(stack, selected, r.NativePostgres); r.fixture.DisposablePostgres.bootstrap(db); run(x.Harness(db))
    except Exception as e: check('HARNESS', False, str(e)[:600])
    totals = {s: sum(c['status'] == s for c in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='MUTATIONS' if a.mutations else 'RED' if a.baseline else 'candidate', migration_count=len(selected), cases=RESULTS, totals=totals, **extra), indent=2, default=str)); print(totals, extra.get('mutants') and {k: v['killed'] for k, v in extra['mutants'].items()})
    if a.mutations: return int(extra.get('control_fail', 1) > 0 or not all(v['killed'] for v in extra.get('mutants', {}).values()))
    return int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
