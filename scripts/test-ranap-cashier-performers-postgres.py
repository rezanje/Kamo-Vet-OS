#!/usr/bin/env python3
"""Native full schema: rawat inap cashier changes Dokter / Non-dokter on ALREADY-ENTERED pending lines.

Andri 4 Nov 2026: "kasir boleh mengganti dokter di rawat inap". Only the visit's current pending
cart (unpaid, not invoiced) may change; the saved invoice/komisi snapshot, other lines, DOCTOR
role and invalid people stay refused. Fictional fixtures, throwaway local cluster, no network.
--baseline omits only the candidate migration so RED can be reproduced.
"""
import argparse, contextlib, importlib.util, json, sys, tempfile
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('medical', ROOT / 'scripts/test-rekam-full-edit-postgres.py'); assert spec and spec.loader
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
x, r, q, j = m.x, m.r, m.q, m.j
CANDIDATE = '20261106200000_ranap_cashier_change_performers.sql'
RESULTS = []
D1, D2, D3 = r.DOKTER_PEGAWAI, r.uid('a', 2), r.uid('a', 8)      # active doctors (branch)
N1, N2 = r.uid('a', 3), r.uid('a', 4)                             # active non-doctors (branch)
N_OFF, N_OTHER = r.uid('a', 5), r.uid('a', 6)                     # inactive / other branch


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:600], flush=True)


def read(h, v, stay, user=r.STAFF): return json.loads(h.nilai(f'select clinic_read_inpatient_cashier({q(stay)},{q(v)});', user))
def save(v, stay, snapshot, rows, parts, key, user_reason='Ganti pelaksana kasir Fiktif'):
    return f"select clinic_save_inpatient_cashier({q(stay)},{q(v)},{q(key)},'2026-11-03',{q(snapshot)},{j(rows)},{j(parts)},null,false,null,{q(user_reason)});"
def perf(doctor=None, staff=None): return dict(doctor_id=doctor, staff_id=staff)
def stay_of(h, v): return h.nilai(f'select id from inpatient_records where visit_id={q(v)}')
def stored(h, rid): return json.loads(h.nilai(f"select coalesce(service_performers::text,'null') from prescription_items where id={q(rid)}"))
def line_perf(h, rid): return json.loads(h.nilai(f"select coalesce(jsonb_agg(service_performers),'[]') from invoice_items where prescription_item_id={q(rid)}"))
def ids(p): return None if p is None else (p.get('doctor_id'), p.get('staff_id'))
def audits(h, v): return h.angka(f'select count(*) from clinic_pending_cart_edits where visit_id={q(v)}')
def invoices(h, v): return h.angka(f'select count(*) from invoices where visit_id={q(v)}')
def pending_visit(h, n, extra_performers=None, jenis='jasa'):
    v, mr = m.visit(h, n); stay = stay_of(h, v); extra = None
    if extra_performers is not None:
        extra = r.uid('e', n)
        nama, kategori = ('Jasa Pelaksana Lama Fiktif', "'Tindakan'") if jenis == 'jasa' else ('Obat Khusus Lama Fiktif', 'null')
        h.sql(f"insert into prescription_items(id,medical_record_id,nama_obat,qty,harga,satuan,jenis,kategori,faktor,service_performers) values({q(extra)},{q(mr)},'{nama}',1,30000,'kali','{jenis}',{kategori},1,{q(json.dumps(extra_performers))}::jsonb);")
    return v, mr, stay, extra
def pay_all(h, v, stay, rows_, cart, key, user=r.STAFF): return h.gagal(save(v, stay, cart['snapshot'], rows_, [dict(method='Tunai', amount=total(cart))], key), user)
def with_perf(cart, row_id, value):
    rows_ = json.loads(json.dumps(cart['rows'])); next(row for row in rows_ if row['id'] == row_id)['service_performers'] = value; return rows_
def update_perf(row_id, value): return f"update prescription_items set service_performers={q(json.dumps(value))}::jsonb where id={q(row_id)};"
def jwt(user): return "select set_config('request.jwt.claims'," + q(json.dumps(dict(sub=user, role='authenticated'))) + ',false);\n'
def direct(h, user, permit_actor, permit_row, body, end='commit'):
    """One transaction in the SECURITY DEFINER context the cashier RPC runs in (superuser session, signed-in claims) so the
    TRIGGER-level conditions are tested without the RPC's own pre-checks in front of them. A client role would be stopped even
    earlier by guard_full_record_prescription (finished visits), which says nothing about this guard. The permit row is planted by
    hand first, i.e. the RPC's own job."""
    plant = f"insert into clinic_private.performer_change_permits values(txid_current(),{q(permit_actor)},{q(permit_row)});" if permit_row else ''
    return h.gagal('begin;' + plant + jwt(user) + body + end + ';')
def total(cart): return sum(row['qty'] * row['harga'] for row in cart['rows'])
def row_named(cart, name): return next(row for row in cart['rows'] if row['nama_obat'] == name)


def run(h):
    x.setup(h)
    h.sql(f"""insert into public.employees(id,nama,jabatan,branch_id,status) values
 ({q(D2)},'Dokter Dua Fiktif','Dokter Hewan',{q(r.BRANCH)},'Aktif'),({q(D3)},'Dokter Tiga Fiktif','Dokter Hewan',{q(r.BRANCH)},'Aktif'),
 ({q(N1)},'Perawat Satu Fiktif','Perawat',{q(r.BRANCH)},'Aktif'),({q(N2)},'Paramedis Dua Fiktif','Paramedis',{q(r.BRANCH)},'Aktif'),
 ({q(N_OFF)},'Perawat Nonaktif Fiktif','Perawat',{q(r.BRANCH)},'Nonaktif'),({q(N_OTHER)},'Perawat Cabang Lain Fiktif','Perawat',{q(r.BRANCH2)},'Aktif');""")

    h.sql("insert into public.role_modules(role,module_id) values('FINANCE','klinik') on conflict do nothing;")
    # 1. Kasir (STAFF) mengganti pelaksana baris pending yang belum punya atribusi; baris lain & tagihan tetap.
    v, mr, stay, _ = pending_visit(h, 2100); cart = read(h, v, stay); target = row_named(cart, 'Jasa Rawat Inap Fiktif')
    others = {row['id']: stored(h, row['id']) for row in cart['rows'] if row['id'] != target['id']}
    rows = cart['rows']; next(row for row in rows if row['id'] == target['id'])['service_performers'] = perf(D2, N1)
    err = h.gagal(save(v, stay, cart['snapshot'], rows, [dict(method='Tunai', amount=total(cart))], 'perf-staff-null'), r.STAFF)
    now = stored(h, target['id'])
    check('STAFF changes performers on an entered pending row (empty -> Dokter+Non-dokter), normalized snapshot with names',
          not err and ids(now) == (D2, N1) and now.get('doctor_name') == 'Dokter Dua Fiktif' and now.get('staff_name') == 'Perawat Satu Fiktif', dict(error=err, stored=now))
    check('other pending rows keep their attribution; invoice line carries the NEW performers; total unchanged',
          all(stored(h, k) == val for k, val in others.items()) and [ids(p) for p in line_perf(h, target['id'])] == [(D2, N1)]
          and h.angka(f'select total from invoices where visit_id={q(v)}') == total(cart), dict(others=others))
    row = json.loads(h.nilai(f'select to_jsonb(e) from clinic_pending_cart_edits e where visit_id={q(v)}') or 'null')
    check('audit trail: clinic_pending_cart_edits records actor, reason, BEFORE (empty snapshot) and AFTER (new performers)',
          bool(row) and audits(h, v) == 1 and row['created_by'] == r.STAFF and row['reason'] == 'Ganti pelaksana kasir Fiktif'
          and ids(next(b for b in row['before_rows'] if b['id'] == target['id'])['service_performers']) == (None, None)
          and ids(next(a for a in row['after_rows'] if a['id'] == target['id'])['service_performers']) == (D2, N1), dict(row=row))
    check('generic activity_log also captured the prescription_items UPDATE',
          h.angka(f"select count(*) from activity_log where row_entity='prescription_items' and row_id={q(target['id'])} and action='update' and actor_id={q(r.STAFF)}") >= 1, {})
    snap = json.dumps([stored(h, target['id']), line_perf(h, target['id'])], sort_keys=True); audit_before = audits(h, v)
    err = h.gagal(save(v, stay, cart['snapshot'], rows, [dict(method='Tunai', amount=total(cart))], 'perf-staff-null'), r.STAFF)
    check('exact replay is idempotent: no second audit/invoice/performer write', not err and audits(h, v) == audit_before and invoices(h, v) == 1
          and json.dumps([stored(h, target['id']), line_perf(h, target['id'])], sort_keys=True) == snap, dict(error=err))
    paid_visit, paid_target, paid_stay, paid_rows_snapshot = v, target['id'], stay, json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') from invoice_items l join invoices i on i.id=l.invoice_id where i.visit_id={q(v)}"))

    # 2. Mengganti pelaksana TERSIMPAN (Dokter lama -> baru) oleh ADMIN; baris lain tidak berubah.
    v, mr, stay, extra = pending_visit(h, 2101, perf(D1)); cart = read(h, v, stay, r.ADMIN)
    before_other = {row['id']: stored(h, row['id']) for row in cart['rows'] if row['id'] != extra}
    rows = cart['rows']; next(row for row in rows if row['id'] == extra)['service_performers'] = perf(D2, N2)
    err = h.gagal(save(v, stay, cart['snapshot'], rows, [dict(method='Tunai', amount=total(cart))], 'perf-admin-replace'), r.ADMIN)
    check('ADMIN replaces a STORED performer on a pending row (D1 -> D2 + N2) and it is invoiced with the new people',
          not err and ids(stored(h, extra)) == (D2, N2) and [ids(p) for p in line_perf(h, extra)] == [(D2, N2)]
          and all(stored(h, k) == val for k, val in before_other.items()), dict(error=err))
    for who, label, n in [(r.OWNER, 'OWNER', 2102), (r.FINANCE, 'FINANCE', 2103)]:
        v, mr, stay, extra = pending_visit(h, n, perf(D1)); cart = read(h, v, stay, who); rows = cart['rows']
        next(row for row in rows if row['id'] == extra)['service_performers'] = perf(D3, None)
        err = h.gagal(save(v, stay, cart['snapshot'], rows, [dict(method='Tunai', amount=total(cart))], f'perf-{label}'), who)
        check(f'{label} may change performers', not err and ids(stored(h, extra)) == (D3, None), dict(error=err))

    # 3. DOCTOR ditolak (keputusan Andri: dokter tidak melakukan pembayaran).
    v, mr, stay, extra = pending_visit(h, 2104, perf(D1)); cart = read(h, v, stay, r.DOCTOR); rows = cart['rows']
    next(row for row in rows if row['id'] == extra)['service_performers'] = perf(D2, None); a0 = audits(h, v)
    err = h.gagal(save(v, stay, cart['snapshot'], rows, [dict(method='Tunai', amount=total(cart))], 'perf-doctor'), r.DOCTOR)
    check('DOCTOR role cannot change performers: ACCESS_DENIED, nothing written/invoiced/audited',
          bool(err and 'ACCESS_DENIED' in err) and ids(stored(h, extra)) == (D1, None) and invoices(h, v) == 0 and audits(h, v) == a0, dict(error=err))

    # 4. Pelaksana tidak valid ditolak seperti baris baru; seluruh simpan dibatalkan.
    v, mr, stay, extra = pending_visit(h, 2105, perf(D1)); cart = read(h, v, stay); amount = total(cart)
    bad = {'inactive employee': perf(D2, N_OFF), 'other-branch employee': perf(D2, N_OTHER), 'non-doctor in doctor slot': perf(N1, None),
           'doctor in staff slot': perf(None, D2), 'same person twice': perf(D2, D2), 'unknown id': perf(r.uid('a', 99), None), 'not a uuid': perf('bukan-uuid', None)}
    for label, value in bad.items():
        rows = json.loads(json.dumps(cart['rows'])); next(row for row in rows if row['id'] == extra)['service_performers'] = value
        err = h.gagal(save(v, stay, cart['snapshot'], rows, [dict(method='Tunai', amount=amount)], 'perf-bad-' + label.replace(' ', '-')), r.STAFF)
        check(f'invalid performer refused ({label}); row, invoice and audit unchanged', bool(err and 'CARE_INVALID' in err) and ids(stored(h, extra)) == (D1, None) and invoices(h, v) == 0 and audits(h, v) == 0, dict(error=(err or '')[:160]))
    rows = json.loads(json.dumps(cart['rows'])); next(row for row in rows if row['id'] == extra)['service_performers'] = None
    err = h.gagal(save(v, stay, cart['snapshot'], rows, [dict(method='Tunai', amount=amount)], 'perf-null-payload'), r.STAFF)
    check('omitted/null performers on an existing row means UNCHANGED (never clears stored attribution)', not err and ids(stored(h, extra)) == (D1, None), dict(error=err))

    # 5. Baris yang sudah tertagih/lunas tidak dapat diubah: lewat RPC maupun DML langsung; snapshot invoice utuh.
    fresh = read(h, paid_visit, paid_stay); rows = [dict(id=paid_target, item_id=None, nama_obat='Jasa Rawat Inap Fiktif', qty=1, harga=100000, satuan='hari', jenis='jasa', service_performers=perf(D3, N2), diskon_persen=0)]
    err = h.gagal(save(paid_visit, paid_stay, fresh['snapshot'], rows, [], 'perf-invoiced-rpc'), r.STAFF)
    check('invoiced/paid row refused through the cashier RPC (CART_INVALID)', bool(err and 'CART_INVALID' in err), dict(error=(err or '')[:160]))
    e1 = h.gagal(f"update prescription_items set service_performers={q(json.dumps(perf(D3, N2)))}::jsonb where id={q(paid_target)};", r.STAFF)
    e2 = h.gagal(f"update invoice_items set service_performers={q(json.dumps(perf(D3, N2)))}::jsonb where prescription_item_id={q(paid_target)};", r.STAFF)
    after = json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') from invoice_items l join invoices i on i.id=l.invoice_id where i.visit_id={q(paid_visit)}"))
    check('direct DML on invoiced prescription/invoice line performers refused; invoice lines byte-identical', bool(e1) and bool(e2) and after == paid_rows_snapshot and ids(stored(h, paid_target)) == (D2, N1), dict(e1=(e1 or '')[:100], e2=(e2 or '')[:100]))

    # 6. Tanpa izin RPC, DML langsung pada baris pending tetap ditolak; tabel izin tidak dapat dipalsukan.
    v, mr, stay, extra = pending_visit(h, 2106, perf(D1)); cart = read(h, v, stay)
    e1 = h.gagal(f"update prescription_items set service_performers={q(json.dumps(perf(D2, N1)))}::jsonb where id={q(extra)};", r.STAFF)
    e2 = h.gagal(f"insert into clinic_private.performer_change_permits values(txid_current(),{q(r.STAFF)},{q(extra)});", r.STAFF)
    check('direct DML on a PENDING row without the RPC permit is still refused; permit table not writable by clients', bool(e1) and bool(e2) and ids(stored(h, extra)) == (D1, None), dict(e1=(e1 or '')[:100], e2=(e2 or '')[:100]))

    # 7. Baris yang ditarik dari penagihan (void) tidak dapat diubah.
    v, mr, stay, extra = pending_visit(h, 2107, perf(D1)); cart = read(h, v, stay); keep = [row for row in cart['rows'] if row['id'] != extra]
    err = h.gagal(save(v, stay, cart['snapshot'], keep, [dict(method='Tunai', amount=total(cart) - 30000)], 'perf-withdraw'), r.STAFF)
    fresh = read(h, v, stay); rows = [dict(id=extra, item_id=None, nama_obat='Jasa Pelaksana Lama Fiktif', qty=1, harga=30000, satuan='kali', jenis='jasa', service_performers=perf(D2, N1), diskon_persen=0)]
    err2 = h.gagal(save(v, stay, fresh['snapshot'], rows, [], 'perf-withdrawn-try'), r.STAFF)
    check('withdrawn (void) pending row cannot get new performers', not err and bool(err2 and 'CART_INVALID' in err2) and ids(stored(h, extra)) == (D1, None), dict(error=err, error2=(err2 or '')[:140]))

    # 8. Racikan (compound) tetap terkunci.
    v7, mr7, stay7, _ = pending_visit(h, 2108)
    h.sql(x.issue(v7, mr7, x.payload(h.nilai('select id from compound_formula_versions limit 1'), 'perf-compound')), r.DOCTOR)
    cart = read(h, v7, stay7); comp = next(row for row in cart['rows'] if row.get('compound_recipe_id'))
    rows = json.loads(json.dumps(cart['rows'])); next(row for row in rows if row['id'] == comp['id'])['service_performers'] = perf(D2, N1)
    err = h.gagal(save(v7, stay7, cart['snapshot'], rows, [dict(method='Tunai', amount=total(cart))], 'perf-compound'), r.STAFF)
    check('compound (racikan) row performers cannot be changed from the cashier (COMPOUND_LOCKED)', bool(err and 'COMPOUND_LOCKED' in err) and invoices(h, v7) == 0, dict(error=(err or '')[:160]))

    # 9. Kunci: dua kasir bersamaan, kunci permintaan berbeda -> satu menang, yang kedua CART_STALE; tanpa deadlock.
    v, mr, stay, extra = pending_visit(h, 2109, perf(D1)); cart = read(h, v, stay); amount = total(cart); barriers = []
    rows_a = json.loads(json.dumps(cart['rows'])); next(row for row in rows_a if row['id'] == extra)['service_performers'] = perf(D2, N1)
    rows_b = json.loads(json.dumps(cart['rows'])); next(row for row in rows_b if row['id'] == extra)['service_performers'] = perf(D3, N2)
    with contextlib.ExitStack() as stack:
        observer = stack.enter_context(x.c.Session(h.db, 'perf-observer')); first = stack.enter_context(x.c.Session(h.db, 'perf-first')); first.sql(x.claims(r.STAFF))
        second = stack.enter_context(x.c.Session(h.db, 'perf-second')); second.sql(x.claims(r.ADMIN))
        first.sql('begin;' + save(v, stay, cart['snapshot'], rows_a, [dict(method='Tunai', amount=amount)], 'perf-race-a'))
        second.send('begin;' + save(v, stay, cart['snapshot'], rows_b, [dict(method='Tunai', amount=amount)], 'perf-race-b'))
        x.c.wait_block(observer, second, first, barriers); first.sql('commit;'); out = x.c.attempt(second)
    check('concurrent cashiers: second waits on the SAME coordinator, then CART_STALE; first writer wins; one invoice; no deadlock',
          (not out['ok']) and 'CART_STALE' in out.get('error', '') and ids(stored(h, extra)) == (D2, N1) and invoices(h, v) == 1 and len(barriers) == 1, dict(outcome=out, barriers=len(barriers)))

    # 10. Kunci karyawan: jabatan pelaksana berubah (bukan dokter lagi) saat kasir menunggu -> ditolak dengan pesan aktif, tanpa tagihan.
    v, mr, stay, extra = pending_visit(h, 2110, perf(D1)); cart = read(h, v, stay); amount = total(cart); barriers = []
    rows = json.loads(json.dumps(cart['rows'])); next(row for row in rows if row['id'] == extra)['service_performers'] = perf(D3, None)
    with contextlib.ExitStack() as stack:
        observer = stack.enter_context(x.c.Session(h.db, 'emp-observer')); gate = stack.enter_context(x.c.Session(h.db, 'emp-gate'))
        waiter = stack.enter_context(x.c.Session(h.db, 'emp-waiter')); waiter.sql(x.claims(r.STAFF))
        gate.sql(f'begin;select id from employees where id={q(D3)} for update;')
        waiter.send('begin;' + save(v, stay, cart['snapshot'], rows, [dict(method='Tunai', amount=amount)], 'perf-emp-lock'))
        x.c.wait_block(observer, waiter, gate, barriers); gate.sql(f"update employees set jabatan='Perawat' where id={q(D3)};commit;"); out = x.c.attempt(waiter)
    check('employee row lock order is the same as for new rows: a job change during the wait refuses the change, nothing invoiced',
          (not out['ok']) and 'CARE_INVALID' in out.get('error', '') and ids(stored(h, extra)) == (D1, None) and invoices(h, v) == 0, dict(outcome=out, barriers=len(barriers)))

    # ================= review fixes (F1-F4) =================
    # F1. Kosong = TIDAK berubah: {} / pasangan null / string kosong tidak pernah menghapus atribusi tersimpan.
    for label, n, value in [('empty object {}', 2120, {}), ('null/null pair', 2121, perf(None, None)), ('blank-string pair', 2122, dict(doctor_id='', staff_id=''))]:
        v, mr, stay, extra = pending_visit(h, n, perf(D1, N1)); cart = read(h, v, stay); before = stored(h, extra)
        err = pay_all(h, v, stay, with_perf(cart, extra, value), cart, f'perf-empty-{n}')
        check(f'payload {label} over a stored Dokter+Non-dokter is UNCHANGED (never clears attribution); invoice carries the stored people',
              not err and stored(h, extra) == before and [ids(p) for p in line_perf(h, extra)] == [(D1, N1)] and audits(h, v) == 0, dict(error=err, stored=stored(h, extra)))
    v, mr, stay, extra = pending_visit(h, 2123, perf(D1), jenis='obat'); cart = read(h, v, stay); before = stored(h, extra)
    err = pay_all(h, v, stay, with_perf(cart, extra, {}), cart, 'perf-empty-obat')
    check('goods (Obat Khusus) row: {} payload over a stored Dokter is UNCHANGED, not cleared to NULL', not err and stored(h, extra) == before and [ids(p) for p in line_perf(h, extra)] == [(D1, None)], dict(error=err, stored=stored(h, extra)))
    for label, n, jenis, value in [('string over goods row', 2124, 'obat', 'bukan-objek'), ('array over service row', 2125, 'jasa', []), ('number over goods row', 2126, 'obat', 7)]:
        v, mr, stay, extra = pending_visit(h, n, perf(D1), jenis=jenis); cart = read(h, v, stay); before = stored(h, extra)
        err = pay_all(h, v, stay, with_perf(cart, extra, value), cart, f'perf-nonobj-{n}')
        check(f'non-object performers payload refused ({label}): CARE_INVALID, stored attribution kept, nothing invoiced', bool(err and 'CARE_INVALID' in err) and stored(h, extra) == before and invoices(h, v) == 0, dict(error=(err or '')[:160]))
    v, mr, stay, extra = pending_visit(h, 2127, perf(D1)); cart = read(h, v, stay)
    check('control: explicit change to another valid pair still counts as a change', not pay_all(h, v, stay, with_perf(cart, extra, perf(D2, N2)), cart, 'perf-explicit-change') and ids(stored(h, extra)) == (D2, N2), {})

    # F2. Baris pending yang masih punya invoice_items ke invoice yang DIBATALKAN: tersegel, jelas, tertutup.
    v, mr, stay, extra = pending_visit(h, 2130, perf(D1)); cart = read(h, v, stay)
    err = pay_all(h, v, stay, cart['rows'], cart, 'perf-void-pay'); voided_row, voided_visit = extra, v
    h.sql(f"update invoices set voided_at=now() where visit_id={q(v)};")
    fresh_row = r.uid('f', 2130)
    h.sql(f"insert into prescription_items(id,medical_record_id,nama_obat,qty,harga,satuan,jenis,faktor) values({q(fresh_row)},{q(mr)},'Obat Baru Setelah Void Fiktif',1,10000,'kali','obat',1);")
    cart = read(h, v, stay); flags = {row['id']: row.get('performers_sealed') for row in cart['rows']}
    check('read RPC marks rows that still reference an invoice (voided) as performers_sealed=true and clean pending rows false',
          not err and flags.get(voided_row) is True and flags.get(fresh_row) is False and all(isinstance(f, bool) for f in flags.values()), dict(error=err, flags=flags))
    a0, i0 = audits(h, v), invoices(h, v)
    err = h.gagal(save(v, stay, cart['snapshot'], with_perf(cart, voided_row, perf(D2, N1)), [dict(method='Tunai', amount=total(cart))], 'perf-void-change'), r.STAFF)
    check('changing performers of a voided-invoice row is refused with a SPECIFIC message (row name, reason, what to do), not the generic guard text; nothing written',
          bool(err and 'CARE_INVALID' in err and 'Jasa Pelaksana Lama Fiktif' in err and 'koreksi dokumen invoice' in err and 'ditulis ulang' not in err)
          and ids(stored(h, voided_row)) == (D1, None) and audits(h, v) == a0 and invoices(h, v) == i0 and stored(h, fresh_row) is None, dict(error=(err or '')[:400]))
    err = h.gagal(save(v, stay, cart['snapshot'], with_perf(cart, voided_row, perf(D1, None)), [dict(method='Tunai', amount=total(cart))], 'perf-void-same'), r.STAFF)
    check('sealed row with its STORED performers sent back unchanged still saves (no silent regression for stale values)', not err and ids(stored(h, voided_row)) == (D1, None), dict(error=(err or '')[:300]))

    # F3. Pelindung tingkat-trigger, dicoba lewat jalur langsung (izin ditanam manual) agar pra-cek RPC tidak menutupi.
    check('no permit row survives any earlier RPC run (success, refusal, P0409)', h.angka('select count(*) from clinic_private.performer_change_permits') == 0, {})
    v, mr, stay, extra = pending_visit(h, 2140, perf(D1)); target = perf(D2, N1)
    err = direct(h, r.STAFF, r.STAFF, extra, update_perf(extra, target)); now = stored(h, extra)
    check('control: a valid permit for THIS row, THIS txn, THIS user lets the trigger write normalized performers', not err and ids(now) == (D2, N1) and now.get('doctor_name') == 'Dokter Dua Fiktif', dict(error=(err or '')[:200]))
    h.sql('delete from clinic_private.performer_change_permits;')
    v, mr, stay, extra = pending_visit(h, 2139, perf(D1))
    err = direct(h, r.STAFF, None, None, update_perf(extra, target))
    check('control: the same trigger-level UPDATE WITHOUT any permit is refused (attribution cannot be rewritten)', bool(err and 'ditulis ulang' in err) and ids(stored(h, extra)) == (D1, None), dict(error=(err or '')[:200]))
    v, mr, stay, extra = pending_visit(h, 2138, perf(D1))
    h.sql(f"insert into clinic_private.performer_change_permits values(1,{q(r.STAFF)},{q(extra)});")  # leftover of some OTHER transaction
    err = direct(h, r.STAFF, None, None, update_perf(extra, target)); h.sql('delete from clinic_private.performer_change_permits;')
    check('a permit row left by ANOTHER transaction (right user, right row) is not usable (permit is bound to txid_current())', bool(err and 'ditulis ulang' in err) and ids(stored(h, extra)) == (D1, None), dict(error=(err or '')[:200]))
    v, mr, stay, extra = pending_visit(h, 2141, perf(D1))
    err = direct(h, r.STAFF, r.ADMIN, extra, update_perf(extra, target))
    check("another user's permit cannot be used (permit actor must equal auth.uid())", bool(err and 'ditulis ulang' in err) and ids(stored(h, extra)) == (D1, None), dict(error=(err or '')[:200]))
    v, mr, stay, extra = pending_visit(h, 2142, perf(D1)); cart = read(h, v, stay); other = next(row['id'] for row in cart['rows'] if row['id'] != extra); other_before = stored(h, other)
    err = direct(h, r.STAFF, r.STAFF, extra, update_perf(other, target))
    err2 = direct(h, r.STAFF, r.STAFF, extra, update_perf(extra, target) + update_perf(other, target))
    check('a permit for row A cannot be used for row B (same transaction, same user)', bool(err and 'ditulis ulang' in err) and bool(err2) and ids(stored(h, extra)) == (D1, None) and stored(h, other) == other_before, dict(error=(err or '')[:160], error2=(err2 or '')[:160]))
    err = direct(h, r.STAFF, r.STAFF, voided_row, update_perf(voided_row, target))
    check('trigger itself refuses a row that still references an invoice (voided) even with a valid permit', bool(err and 'ditulis ulang' in err) and ids(stored(h, voided_row)) == (D1, None), dict(error=(err or '')[:200]))
    v, mr, stay, extra = pending_visit(h, 2143, perf(D1)); cart = read(h, v, stay)
    err = h.gagal(save(v, stay, cart['snapshot'], [row for row in cart['rows'] if row['id'] != extra], [dict(method='Tunai', amount=total(cart) - 30000)], 'perf-withdraw-direct'), r.STAFF)
    err2 = direct(h, r.STAFF, r.STAFF, extra, update_perf(extra, target))
    check('trigger itself refuses a withdrawn (billing_withdrawn_at) row even with a valid permit', not err and bool(err2 and 'ditulis ulang' in err2) and ids(stored(h, extra)) == (D1, None), dict(error=err, error2=(err2 or '')[:200]))
    # official_prescription_snapshot (RECIPE_LINKED) fires first on official racikan rows; switch it off inside a rolled-back
    # transaction so THIS guard's own compound condition is what is being tested.
    err = direct(h, r.STAFF, r.STAFF, comp['id'], 'alter table public.prescription_items disable trigger official_prescription_snapshot;' + update_perf(comp['id'], target), end='rollback')
    check('trigger itself refuses a compound (racikan) row even with a valid permit (other racikan trigger disabled in a rolled-back txn)', bool(err and 'ditulis ulang' in err) and ids(stored(h, comp['id'])) != (D2, N1), dict(error=(err or '')[:200]))
    v, mr, stay, extra = pending_visit(h, 2144, perf(D1))
    err = direct(h, r.STAFF, r.STAFF, extra, update_perf(extra, {}))
    err2 = direct(h, r.STAFF, r.STAFF, extra, update_perf(extra, perf(None, None)))
    err3 = direct(h, r.STAFF, r.STAFF, extra, f"update prescription_items set service_performers=null where id={q(extra)};")
    check('trigger itself refuses to CLEAR stored attribution ({} / null pair / SQL NULL) even with a valid permit',
          all(bool(e and 'dikosongkan' in e) for e in (err, err2, err3)) and ids(stored(h, extra)) == (D1, None), dict(error=(err or '')[:200], error2=(err2 or '')[:200], error3=(err3 or '')[:200]))
    v, mr, stay, extra = pending_visit(h, 2145, perf(D1)); cart = read(h, v, stay)
    script = 'begin;' + x.claims(r.STAFF) + save(v, stay, cart['snapshot'], with_perf(cart, extra, perf(D2, N1)), [dict(method='Tunai', amount=total(cart))], 'perf-permit-consumed') \
        + 'reset role; select count(*) from clinic_private.performer_change_permits; commit;'
    left = h.nilai(script)
    check('RPC deletes the per-row permit right after the UPDATE (zero permit rows inside the same transaction, and after commit)',
          left == '0' and ids(stored(h, extra)) == (D2, N1) and h.angka('select count(*) from clinic_private.performer_change_permits') == 0, dict(left=left))
    v, mr, stay, extra = pending_visit(h, 2146, perf(D1)); cart = read(h, v, stay)
    err = h.gagal('begin;' + x.claims(r.STAFF) + save(v, stay, cart['snapshot'], with_perf(cart, extra, perf(D2, N1)), [dict(method='Tunai', amount=total(cart))], 'perf-reuse-after') + 'reset role;' + update_perf(extra, perf(D3, N2)) + 'commit;')
    check('after the RPC wrote the row, a second UPDATE of it in the same transaction is refused (permit not reusable)', bool(err and 'ditulis ulang' in err) and ids(stored(h, extra)) == (D1, None), dict(error=(err or '')[:200]))

    # F4. Kasir cabang lain tidak dapat mengganti pelaksana kunjungan cabang ini.
    v, mr, stay, extra = pending_visit(h, 2150, perf(D1)); cart = read(h, v, stay); a0 = audits(h, v)
    err = h.gagal(save(v, stay, cart['snapshot'], with_perf(cart, extra, perf(D2, N1)), [dict(method='Tunai', amount=total(cart))], 'perf-other-branch'), r.FIN_LUAR)
    check('FINANCE cashier of ANOTHER branch cannot change performers of this branch visit (ACCESS_DENIED); nothing written/invoiced/audited',
          bool(err and 'ACCESS_DENIED' in err) and ids(stored(h, extra)) == (D1, None) and invoices(h, v) == 0 and audits(h, v) == a0, dict(error=(err or '')[:200]))


def main():
    p = argparse.ArgumentParser(); p.add_argument('--baseline', action='store_true'); p.add_argument('--json', type=Path, required=True); a = p.parse_args()
    sources = sorted((ROOT / 'supabase/migrations').glob('*.sql')); selected = [s for s in sources if not (a.baseline and s.name == CANDIDATE)]
    try:
        with tempfile.TemporaryDirectory(prefix='chain.', dir=ROOT) as d:
            target = Path(d) / 'supabase/migrations'; target.mkdir(parents=True)
            for s in selected: (target / s.name).symlink_to(s)
            r.fixture.ROOT = Path(d)
            with r.NativePostgres(r.BIN) as db: r.fixture.DisposablePostgres.bootstrap(db); run(x.Harness(db))
    except Exception as e: check('HARNESS', False, str(e))
    totals = {s: sum(c['status'] == s for c in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='RED' if a.baseline else 'candidate', migration_count=len(selected), cases=RESULTS, totals=totals), indent=2, default=str)); print(totals)
    return int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
