#!/usr/bin/env python3
"""Native full schema: pelanggan nonaktif (Aldi 5 Nov 2026), fictional fixtures, throwaway local cluster, no network.

Kasir cabang memilih pelanggan "CS pusat" untuk penjualan yang seharusnya atas nama pelanggan asli. Pelanggan kini bisa
dinonaktifkan (OWNER/ADMIN aktif saja); transaksi BARU atas pelanggan nonaktif ditolak DATABASE, sedangkan riwayat lama,
impor rekam medis, lanjutan rawat inap, dan faktur pengganti tetap boleh.

  python3 -I scripts/test-pelanggan-nonaktif-postgres.py --pg-bin /usr/lib/postgresql/16/bin --json out.json
  --baseline   omit only the candidate migration (RED: preflight must fail)
  --mutations  each guard removed from the candidate in a cloned database; every mutant must be KILLED
"""
import argparse, contextlib, importlib.util, json, os, sys, tempfile
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('medical', ROOT / 'scripts/test-rekam-full-edit-postgres.py'); assert spec and spec.loader
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
x, r, q = m.x, m.r, m.q
CANDIDATE = '20261107100000_pelanggan_nonaktif.sql'
TABLES = ['sales', 'visits', 'sales_quotations', 'sales_orders', 'sales_invoices', 'sales_advances']
PESAN = 'Pelanggan ini sudah dinonaktifkan, pilih pelanggan asli'
RESULTS = []
ADMIN_OFF = r.uid('a', 61)
SEQ = [0]


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:400], flush=True)


def nomor(prefix): SEQ[0] += 1; return f'{prefix}-UJI-{SEQ[0]:05d}'


def cust(h, n, name=None):
    c = r.uid(4, n); h.sql(f"insert into public.customers(id,name,phone) values({q(c)},{q(name or f'Pelanggan Fiktif {n}')},'0811{n:07d}');"); return c


def status(h, c): return json.loads(h.nilai(f"select to_jsonb(t) from (select is_active,deactivated_at,deactivated_by,deactivation_reason,name from public.customers where id={q(c)}) t"))


def nonaktifkan(h, c, user=r.OWNER, reason='Akun penampung CS pusat'):
    return h.gagal(f"update public.customers set is_active=false, deactivation_reason={q(reason) if reason is not None else 'null'} where id={q(c)};", user)


def aktifkan(h, c, user=r.OWNER): return h.gagal(f"update public.customers set is_active=true where id={q(c)};", user)


def pet(h, c, n):
    p = r.uid(5, n); h.sql(f"insert into public.pets(id,customer_id,name) values({q(p)},{q(c)},'Anabul Fiktif {n}');"); return p


def insert_sql(table, c, h=None, n=0, extra=None):
    """Satu dokumen baru minimal per tabel; extra = kolom tambahan (pengecualian)."""
    e = extra or {}
    cols = ', '.join(e.keys()); vals = ', '.join(e.values())
    cols = (', ' + cols) if cols else ''; vals = (', ' + vals) if vals else ''
    if table == 'sales':
        return f"insert into public.sales(branch_id,customer_id,no_struk,total{cols}) values({q(r.BRANCH)},{q(c)},{q(nomor('POS'))},1000{vals}) returning id;"
    if table == 'visits':
        return f"insert into public.visits(branch_id,customer_id,pet_id,status{cols}) values({q(r.BRANCH)},{q(c)},{q(pet(h, c, n))},'Menunggu'{vals}) returning id;"
    if table == 'sales_quotations':
        return f"insert into public.sales_quotations(no_penawaran,customer_id,branch_id{cols}) values({q(nomor('SQ'))},{q(c)},{q(r.BRANCH)}{vals}) returning id;"
    if table == 'sales_orders':
        return f"insert into public.sales_orders(no_pesanan,customer_id,branch_id{cols}) values({q(nomor('SO'))},{q(c)},{q(r.BRANCH)}{vals}) returning id;"
    if table == 'sales_invoices':
        return f"insert into public.sales_invoices(no_faktur,customer_id,branch_id,total{cols}) values({q(nomor('FJ'))},{q(c)},{q(r.BRANCH)},1000{vals}) returning id;"
    if table == 'sales_advances':
        return f"insert into public.sales_advances(no_um,customer_id,jumlah{cols}) values({q(nomor('UM'))},{q(c)},5000{vals}) returning id;"
    raise ValueError(table)


def count_docs(h, c):
    return {t: h.angka(f"select count(*) from public.{t} where customer_id={q(c)}") for t in TABLES}


def preflight(h):
    have = dict(
        columns=h.angka("select count(*) from information_schema.columns where table_schema='public' and table_name='customers' and column_name in ('is_active','deactivated_at','deactivated_by','deactivation_reason')") == 4,
        status_guard=h.angka("select count(*) from pg_trigger where tgname='customers_status_guard' and not tgisinternal") == 1,
        tx_guards=h.angka("select count(*) from pg_trigger where tgname='customer_active_guard' and not tgisinternal") == len(TABLES))
    for k, ok in have.items(): check(f'preflight: {k} installed', ok, {})
    return all(have.values())


def run(h, setup=True):
    if setup: x.setup(h)
    if not preflight(h): return
    h.sql(f"""insert into auth.users(id,raw_user_meta_data) values({q(ADMIN_OFF)},'{{"full_name":"Admin Nonaktif Fiktif"}}');
update public.profiles set role='ADMIN', is_active=false where id={q(ADMIN_OFF)};""")

    # ---------------------------------------------------------------- 1. default & who may change the status
    a = cust(h, 4001, 'CS Pusat Fiktif')
    check('existing and new customers are active by default with no deactivation trail', status(h, a) == dict(is_active=True, deactivated_at=None, deactivated_by=None, deactivation_reason=None, name='CS Pusat Fiktif'), status(h, a))
    for who, label in [(r.STAFF, 'STAFF'), (r.DOCTOR, 'DOCTOR'), (r.FINANCE, 'FINANCE'), (ADMIN_OFF, 'inactive ADMIN')]:
        err = nonaktifkan(h, a, who)
        check(f'{label} cannot deactivate a customer (refused in the DB, still active)', bool(err and 'owner/admin' in err) and status(h, a)['is_active'] is True, dict(error=(err or '')[:200]))
    err = h.gagal(f"update public.customers set name='CS Pusat Fiktif (ubah)' where id={q(a)};", r.STAFF)
    check('STAFF may still edit ordinary customer fields (status untouched)', not err and status(h, a)['name'] == 'CS Pusat Fiktif (ubah)' and status(h, a)['is_active'] is True, dict(error=err))

    pos_lama = h.nilai(insert_sql('sales', a))
    sv_lama = h.nilai(insert_sql('sales_invoices', a))
    before = count_docs(h, a)
    err = h.gagal(f"update public.customers set is_active=false, deactivation_reason='   Akun penampung CS pusat   ', deactivated_by={q(r.STAFF)}, deactivated_at='2020-01-01' where id={q(a)};", r.OWNER)
    st = status(h, a)
    check('OWNER deactivates: timestamp & actor set by the DB (client spoof ignored), reason trimmed', not err and st['is_active'] is False and st['deactivated_by'] == r.OWNER
          and st['deactivated_at'] and not st['deactivated_at'].startswith('2020') and st['deactivation_reason'] == 'Akun penampung CS pusat', dict(error=err, st=st))
    check('history intact: every existing document of the customer still there, unchanged count', count_docs(h, a) == before, dict(before=before, after=count_docs(h, a)))
    err = h.gagal(f"update public.customers set deactivated_by={q(r.ADMIN)}, deactivated_at='2021-01-01', deactivation_reason='Alasan diperbaiki' where id={q(a)};", r.OWNER)
    st2 = status(h, a)
    check('while inactive the deactivation trail cannot be rewritten; only the reason may be corrected', not err and st2['deactivated_by'] == r.OWNER and st2['deactivated_at'] == st['deactivated_at'] and st2['deactivation_reason'] == 'Alasan diperbaiki', dict(error=err, st=st2))
    err = h.gagal(f"update public.customers set deactivation_reason='Iseng' where id={q(a)};", r.STAFF)
    check('STAFF cannot change the reason of an inactive customer either', bool(err and 'owner/admin' in err) and status(h, a)['deactivation_reason'] == 'Alasan diperbaiki', dict(error=(err or '')[:200]))
    err = h.gagal(f"update public.customers set points=points+5 where id={q(a)};", r.STAFF)
    check('ordinary updates on an inactive customer still allowed (e.g. points), status untouched', not err and status(h, a)['is_active'] is False, dict(error=err))

    # ---------------------------------------------------------------- 2. new transactions refused, for every guarded table
    for i, t in enumerate(TABLES):
        e0 = count_docs(h, a)[t]; err = h.gagal(insert_sql(t, a, h, 4100 + i))
        check(f'new {t} for an inactive customer refused with a clear message', bool(err and PESAN in err) and count_docs(h, a)[t] == e0, dict(error=(err or '')[:200]))
        ok_c = cust(h, 4200 + i); err = h.gagal(insert_sql(t, ok_c, h, 4300 + i))
        check(f'control: the same new {t} for an ACTIVE customer is accepted', not err and count_docs(h, ok_c)[t] == 1, dict(error=(err or '')[:300]))
    walkin = h.gagal(f"insert into public.sales(branch_id,customer_id,no_struk,total) values({q(r.BRANCH)},null,{q(nomor('POS'))},1000);")
    check('walk-in sale without a customer is unaffected', not walkin, dict(error=walkin))
    err = h.gagal(insert_sql('sales', a), r.STAFF)
    check('also refused when a cashier (authenticated STAFF) posts directly', bool(err and (PESAN in err or 'row-level security' in err)) and count_docs(h, a)['sales'] == before['sales'], dict(error=(err or '')[:200]))

    # ---------------------------------------------------------------- 3. switching an existing document to an inactive customer
    other = cust(h, 4400); s_other = h.nilai(insert_sql('sales', other)); v_other = h.nilai(insert_sql('visits', other, h, 4401))
    for t, doc in [('sales', s_other), ('visits', v_other)]:
        err = h.gagal(f"update public.{t} set customer_id={q(a)} where id={q(doc)};")
        check(f'moving an existing {t} onto an inactive customer is refused', bool(err and PESAN in err) and h.nilai(f"select customer_id from public.{t} where id={q(doc)}") == other, dict(error=(err or '')[:200]))
    err = h.gagal(f"update public.sales set total=total+0, catatan='koreksi catatan' where id={q(pos_lama)};") if h.angka("select count(*) from information_schema.columns where table_name='sales' and column_name='catatan'") else h.gagal(f"update public.sales set total=total where id={q(pos_lama)};")
    check('old documents of the inactive customer can still be updated (e.g. payment/void bookkeeping)', not err, dict(error=err))

    # ---------------------------------------------------------------- 4. not new transactions: allowed
    err = h.gagal(insert_sql('visits', a, h, 4500, {'legacy_source_key': q('impor-lama-fiktif-4500')}))
    check('imported historical medical record (legacy_source_key) still lands on the inactive customer', not err, dict(error=(err or '')[:200]))
    cont = h.nilai(f"select id from public.visits where customer_id={q(a)} and legacy_source_key is not null limit 1")
    err = h.gagal(insert_sql('visits', a, h, 4501, {'continued_from_visit_id': q(cont)}))
    check('continuation of an ongoing inpatient stay (continued_from_visit_id) still allowed', not err, dict(error=(err or '')[:200]))
    err = h.gagal(insert_sql('sales_invoices', a, extra={'replaces_invoice_id': q(sv_lama)}))
    check('replacement invoice that corrects an OLD invoice (replaces_invoice_id) still allowed', not err, dict(error=(err or '')[:200]))
    batch = r.uid('f', 4600)
    je = r.uid('f', 4601)
    try:
        # Fixture only (the real batch comes from the opening-balance import RPC): the minimum rows its FKs need.
        h.sql(f"insert into public.journal_entries(id,no_jurnal,deskripsi,source) values({q(je)},'JRN-UJI-4601','Saldo awal fiktif','manual');"
              f"insert into public.opening_invoice_batches(id,source_hash,source_name,as_of,branch_id,journal_id,ap_count,ap_total,ar_count,ar_total,reason,created_by)"
              f" values({q(batch)},repeat('a',64),'saldo-awal-fiktif.xlsx',current_date,{q(r.BRANCH)},{q(je)},0,0,1,1000,'Saldo awal piutang fiktif',{q(r.OWNER)});")
        # The import RPC marks its own transaction with this setting; the same marker is set here.
        err = h.gagal(f"begin; select set_config('vetos.opening_invoice_batch',{q(batch)},true);\n" + insert_sql('sales_invoices', a, extra={'opening_batch_id': q(batch)}) + "\ncommit;")
        check('opening AR balance (opening_batch_id) still allowed', not err, dict(error=(err or '')[:200]))
    except RuntimeError as e:
        check('opening AR balance (opening_batch_id) still allowed', False, dict(fixture_error=str(e)[:300]))

    # ---------------------------------------------------------------- 5. reactivate
    err = aktifkan(h, a, r.ADMIN); st = status(h, a)
    check('ADMIN reactivates: trail cleared', not err and st['is_active'] is True and st['deactivated_at'] is None and st['deactivated_by'] is None and st['deactivation_reason'] is None, dict(error=err, st=st))
    err = h.gagal(insert_sql('sales', a))
    check('after reactivation new sales are accepted again', not err, dict(error=err))

    # ---------------------------------------------------------------- 6. insert as inactive
    nid = r.uid(4, 4700)
    err = h.gagal(f"insert into public.customers(id,name,phone,is_active) values({q(nid)},'Baru Nonaktif Fiktif','08119994700',false);", r.STAFF)
    check('STAFF cannot create a customer that is already inactive', bool(err and ('owner/admin' in err or 'row-level' in err)) and h.angka(f"select count(*) from public.customers where id={q(nid)}") == 0, dict(error=(err or '')[:200]))

    # ---------------------------------------------------------------- 7. privileges
    acl = json.loads(h.nilai("""select jsonb_agg(jsonb_build_object('f',p.proname,'def',p.prosecdef,'cfg',p.proconfig,
      'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'auth',has_function_privilege('authenticated',p.oid,'EXECUTE'),'pub',has_function_privilege('public',p.oid,'EXECUTE')) order by p.proname)
      from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('customer_status_manager','guard_customer_status','guard_new_transaction_customer_active')"""))
    byname = {a_['f']: a_ for a_ in acl}
    check('trigger functions are not callable by clients; search_path pinned', all(not byname[f]['anon'] and not byname[f]['auth'] and not byname[f]['pub'] and byname[f]['cfg'] == ['search_path=""'] for f in ['guard_customer_status', 'guard_new_transaction_customer_active']), acl)
    check('role helper is SECURITY DEFINER, callable by authenticated only', byname['customer_status_manager']['def'] and byname['customer_status_manager']['auth'] and not byname['customer_status_manager']['anon'], byname['customer_status_manager'])


def apply_candidate(db, text): db.sql('begin;\n' + text + '\ncommit;')


MUTANTS = {
    'role check removed (STAFF may deactivate)': ("    if v_client and not public.customer_status_manager() then\n      raise exception using errcode = '42501',\n        message = 'Hanya owner/admin yang bisa menonaktifkan atau mengaktifkan pelanggan.';\n    end if;\n    if new.is_active then", "    if new.is_active then"),
    'inactive profiles count as managers': ("where p.id = auth.uid() and p.is_active and p.role in ('OWNER','ADMIN')", "where p.id = auth.uid() and p.role in ('OWNER','ADMIN')"),
    'client spoof of deactivated_by accepted': ("new.deactivated_at := now(); new.deactivated_by := auth.uid();", "new.deactivated_at := coalesce(new.deactivated_at, now()); new.deactivated_by := coalesce(new.deactivated_by, auth.uid());"),
    'transaction guard no longer checks status': ("where c.id = new.customer_id and not c.is_active)", "where c.id = new.customer_id and false)"),
    'customer switch on UPDATE not guarded': ("before insert or update of customer_id on public.%I", "before insert on public.%I"),
    'sales_advances not guarded': ("'sales_invoices','sales_advances']", "'sales_invoices']"),
    'visits not guarded': ("array['sales','visits',", "array['sales',"),
    'import exemption removed': ("(v_row->>'legacy_source_key' is not null or v_row->>'continued_from_visit_id' is not null)", "(v_row->>'continued_from_visit_id' is not null)"),
    'replacement invoice exemption removed': ("(v_row->>'replaces_invoice_id' is not null or v_row->>'opening_batch_id' is not null)", "(v_row->>'opening_batch_id' is not null)"),
}


def build_chain(stack, selected, db_cls):
    d = stack.enter_context(tempfile.TemporaryDirectory(prefix='chain.', dir='/opt/data')); target = Path(d) / 'supabase/migrations'; target.mkdir(parents=True)
    for s in selected: (target / s.name).symlink_to(s)
    r.fixture.ROOT = Path(d)
    return stack.enter_context(db_cls(r.BIN))


def run_in_clone(db, name, template, setup, variant_text=None):
    db.sql(f'create database {name} template {template};'); os.environ['PGDATABASE'] = name
    if variant_text is not None: apply_candidate(db, variant_text)
    start = len(RESULTS); SEQ[0] = 0
    try: run(x.Harness(db), setup=setup)
    except Exception as e: check('HARNESS', False, str(e)[:400])
    os.environ.pop('PGDATABASE', None); return RESULTS[start:]


def main():
    p = argparse.ArgumentParser(); p.add_argument('--baseline', action='store_true'); p.add_argument('--mutations', action='store_true'); p.add_argument('--pg-bin')
    p.add_argument('--json', type=Path, required=True); a = p.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    sources = sorted((ROOT / 'supabase/migrations').glob('*.sql')); candidate_text = (ROOT / 'supabase/migrations' / CANDIDATE).read_text()
    extra = {}
    try:
        if a.mutations:
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
    a.json.write_text(json.dumps(dict(mode='MUTATIONS' if a.mutations else 'RED' if a.baseline else 'candidate', migration_count=len(selected), cases=RESULTS, totals=totals, **extra), indent=2, default=str))
    print(totals, extra.get('mutants') and {k: v['killed'] for k, v in extra['mutants'].items()})
    if a.mutations: return int(extra.get('control_fail', 1) > 0 or not all(v['killed'] for v in extra.get('mutants', {}).values()))
    return int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
