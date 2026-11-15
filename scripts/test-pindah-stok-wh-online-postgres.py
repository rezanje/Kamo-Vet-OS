#!/usr/bin/env python3
"""E4 bagian 2 (meeting 12 Nov 2026, keputusan owner 2A): sisa stok WH ONLINE PDRY/TKI dipindah ke gudang toko
cabang yang sama lewat dokumen Pemindahan Barang resmi, lalu kedua gudang online dinonaktifkan
(migrasi 20261117300000_e4_pindah_stok_wh_online.sql).

Native throwaway PostgreSQL only (full migration chain, fictional fixtures shaped like production:
31 barang / 230 unit di WH ONLINE PDRY, 3 barang / 16 unit di WH ONLINE TKI, plus WH B2C yang tidak boleh
disentuh). Never accepts a database URL, no network.

  python3 -I scripts/test-pindah-stok-wh-online-postgres.py [--pg-bin DIR] [--json out.json] [--baseline]
  (default)   chain without candidate -> fixtures (FIFO and moving-average) -> candidate applied as a migration;
              asserts balances, per-item value, FIFO layers / average cost, documents, numbering, note, activity log,
              warehouses inactive, B2C untouched, no journal; then every precondition refusal (nothing changed).
  --baseline  same fixtures WITHOUT the candidate: every feature case must FAIL (RED).
"""
from pathlib import Path
import argparse, hashlib, importlib.util, json, os, re, subprocess, sys, tempfile
from decimal import Decimal

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
from native_postgres import NativePostgres  # noqa: E402

CAND = '20261117300000_e4_pindah_stok_wh_online.sql'
MIGRATIONS = ROOT / 'supabase/migrations'
NOTE = 'E4 meeting 12 Nov 2026: pemindahan sisa stok WH Online ke gudang toko'
RESULTS = []

OWNER = 'e4000000-0000-4000-8000-000000000001'
BR = dict(pdry='e4010000-0000-4000-8000-000000000001', tki='e4010000-0000-4000-8000-000000000002', b2c='e4010000-0000-4000-8000-000000000003')
WH = dict(on_pdry='e4020000-0000-4000-8000-000000000001', pdry='e4020000-0000-4000-8000-000000000002',
          on_tki='e4020000-0000-4000-8000-000000000003', tki='e4020000-0000-4000-8000-000000000004',
          b2c='e4020000-0000-4000-8000-000000000005')
ONLINE = (WH['on_pdry'], WH['on_tki'])
STORE = {WH['on_pdry']: WH['pdry'], WH['on_tki']: WH['tki']}


def item_id(kind, n):
    return 'e4030000-0000-4000-8%03d-%012d' % ({'P': 1, 'T': 2, 'B': 3, 'Z': 4}[kind], n)


def check(name, ok, detail='', kind='feature'):
    """kind: 'feature' (must be RED under --baseline), 'invariant' (must hold with and without the candidate), 'setup'."""
    RESULTS.append(dict(case=name, kind=kind, status='PASS' if ok else 'FAIL', detail=str(detail)[:700]))
    print(RESULTS[-1]['status'], name, str(detail)[:300], flush=True)
    return ok


# ------------------------------------------------------------------ database plumbing
def raw(db, sql, dbname):
    env = {**os.environ, 'PSQLRC': '/dev/null', 'PGDATABASE': dbname}
    r = subprocess.run(db.as_user + [db.psql, '-X', '-qAt', '-h', str(db.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                       input=sql, text=True, capture_output=True, env=env)
    return r.returncode, r.stdout.strip(), r.stderr


def q(db, dbname, sql):
    rc, out, err = raw(db, sql, dbname)
    if rc: raise RuntimeError(err + out)
    return out


def js(db, dbname, sql):
    return json.loads(q(db, dbname, sql).splitlines()[-1], parse_float=Decimal)


def clone(db, name, template):
    q(db, 'postgres', 'drop database if exists %s' % name)
    q(db, 'postgres', 'create database %s template %s' % (name, template))


def build_chain(db):
    """Full repository chain WITHOUT the candidate (and nothing written after it) into database `postgres`."""
    tmp = Path(tempfile.mkdtemp(prefix='e4chain.', dir='/opt/data'))
    try:
        (tmp / 'supabase/migrations').mkdir(parents=True)
        for f in MIGRATIONS.glob('*.sql'):
            if f.name < CAND:
                (tmp / 'supabase/migrations' / f.name).symlink_to(f)
        old = fixture.ROOT
        fixture.ROOT = tmp
        try:
            fixture.DisposablePostgres.bootstrap(db)
        finally:
            fixture.ROOT = old
    finally:
        for f in (tmp / 'supabase/migrations').glob('*'):
            f.unlink()
        (tmp / 'supabase/migrations').rmdir(); (tmp / 'supabase').rmdir(); tmp.rmdir()


def apply_candidate(db, dbname):
    rc, out, err = raw(db, 'begin;\n' + (MIGRATIONS / CAND).read_text() + '\ncommit;', dbname)
    if rc:
        errs = [l for l in err.splitlines() if l.startswith('ERROR')]
        return (errs[0] if errs else err.strip())[:600]
    for later in sorted(p for p in MIGRATIONS.glob('*.sql') if p.name > CAND):
        rc, out, err = raw(db, 'begin;\n' + later.read_text() + '\ncommit;', dbname)
        if rc: raise RuntimeError(later.name + ': ' + err)
    return None


# ------------------------------------------------------------------ fictional fixtures (production shape)
def fixtures(db, dbname, average):
    sql = [f"""
insert into auth.users(id,raw_user_meta_data) values('{OWNER}','{{"full_name":"Owner Fiktif E4"}}');
update public.profiles set role='OWNER',is_active=true where id='{OWNER}';
insert into public.branches(id,code,name,type) values
 ('{BR['pdry']}','E4PDRY','Kamo Petshop Panduraya','PETSHOP'),
 ('{BR['tki']}','E4TKI','Kamo Petshop TKI/Kopo','PETSHOP'),
 ('{BR['b2c']}','E4B2C','B2C','ONLINE');
insert into public.warehouses(id,branch_id,code,name,type) values
 ('{WH['on_pdry']}','{BR['pdry']}','WH_ONLINE_PDRY','WH ONLINE PDRY','ONLINE'),
 ('{WH['pdry']}','{BR['pdry']}','WH_PDRY','WH PDRY','RETAIL'),
 ('{WH['on_tki']}','{BR['tki']}','WH_ONLINE_TKI','WH ONLINE TKI','ONLINE'),
 ('{WH['tki']}','{BR['tki']}','WH_TKI','WH TKI','RETAIL'),
 ('{WH['b2c']}','{BR['b2c']}','WH_B2C','WH B2C','ONLINE');
"""]
    items = [('P', n) for n in range(1, 32)] + [('T', n) for n in range(1, 4)] + [('B', 1), ('B', 2), ('Z', 1)]
    sql.append('insert into public.items(id,code,name,unit,item_type,is_active,sell_price,buy_price) values ' + ','.join(
        f"('{item_id(k, n)}','E4-{k}{n:02d}','Barang Fiktif {k}{n:02d}','pcs','Persediaan',true,50000,{1000 + n})" for k, n in items) + ';')
    if average:  # moving average active BEFORE any stock exists, like production after 21 Oct
        sql.append(f"""set role authenticated; select set_config('request.jwt.claim.sub','{OWNER}',false);
select public.activate_moving_average(); reset role; select set_config('request.jwt.claim.sub','',false);""")

    def rin(wh, it, qty, cost, day, exp='null', ref='PO-E4'):
        return f"select public.stock_in_fifo('{wh}','{it}',{qty},{cost},'purchase','{ref}','2026-{day}',{exp});"

    def rout(wh, it, qty, day):
        return f"select * from public.stock_out_fifo('{wh}','{it}',{qty},'sale-online','SO-E4','2026-{day}');"
    # WH ONLINE PDRY: 31 barang / 230 unit. Ganjil = dua lapisan beda harga & kedaluwarsa; P31 = tiga lapisan + terjual 5.
    for n in range(1, 31):
        it = item_id('P', n)
        if n % 2:
            sql.append(rin(WH['on_pdry'], it, 4, '%d.25' % (10000 + 100 * n), '10-20', "'2027-01-31'"))
            sql.append(rin(WH['on_pdry'], it, 3, '%d.75' % (10500 + 100 * n), '10-28', "'2027-06-30'"))
        else:
            sql.append(rin(WH['on_pdry'], it, 7, 12000 + 50 * n, '10-22'))
    p31 = item_id('P', 31)
    sql += [rin(WH['on_pdry'], p31, 10, '8700.50', '10-01', "'2026-12-31'"), rin(WH['on_pdry'], p31, 10, '9100.25', '10-15', "'2027-03-31'"),
            rin(WH['on_pdry'], p31, 5, '9500', '11-01'), rout(WH['on_pdry'], p31, 5, '11-04')]
    # barang yang saldonya habis di gudang online: tidak ikut dokumen
    sql += [rin(WH['on_pdry'], item_id('Z', 1), 2, 5000, '10-20'), rout(WH['on_pdry'], item_id('Z', 1), 2, '11-02')]
    # gudang toko sudah punya sebagian barang yang sama dengan harga berbeda (average/FIFO tercampur di tujuan)
    for n in range(1, 6):
        sql.append(rin(WH['pdry'], item_id('P', n), 3, 15000 + n, '10-25', ref='PO-E4-TOKO'))
    # WH ONLINE TKI: 3 barang / 16 unit
    sql += [rin(WH['on_tki'], item_id('T', 1), 2, '20000.10', '10-10', "'2027-02-28'"), rin(WH['on_tki'], item_id('T', 1), 3, '21000.20', '10-30', "'2027-04-30'"),
            rin(WH['on_tki'], item_id('T', 2), 5, 7000, '10-12'), rin(WH['on_tki'], item_id('T', 3), 6, 3333.33, '11-03')]
    sql.append(rin(WH['tki'], item_id('T', 2), 4, 7400, '10-26', ref='PO-E4-TOKO'))
    # WH B2C (cabang B2C): tidak boleh tersentuh
    sql += [rin(WH['b2c'], item_id('B', 1), 10, 4000, '10-05'), rin(WH['b2c'], item_id('B', 2), 4, 6000, '10-05'),
            rin(WH['b2c'], item_id('P', 1), 2, 11111, '10-05'), rout(WH['b2c'], item_id('B', 1), 3, '11-04')]
    q(db, dbname, '\n'.join(sql))


# ------------------------------------------------------------------ observations
VALUE_SQL = """(case when (select method='moving_average' from public.inventory_costing_settings where id)
 then (select coalesce(sum(case when s.qty=0 then 0 else s.qty*s.average_cost end),0) from public.stock s where s.warehouse_id=w.id and s.item_id=i.id)
 else (select coalesce(sum(l.qty_left*l.unit_cost),0) from public.stock_layers l where l.warehouse_id=w.id and l.item_id=i.id) end)"""


def snapshot(db, dbname):
    """{(wh, item): [qty, value]} for every stock row."""
    rows = js(db, dbname, f"""select coalesce(jsonb_agg(jsonb_build_array(w.id,i.id,s.qty,{VALUE_SQL})),'[]') from public.stock s
 join public.warehouses w on w.id=s.warehouse_id join public.items i on i.id=s.item_id;""")
    return {(r[0], r[1]): [Decimal(r[2]), Decimal(r[3])] for r in rows}


def layers(db, dbname, wh, extra=''):
    return js(db, dbname, f"""select coalesce(jsonb_agg(jsonb_build_array(item_id,unit_cost,exp_date,qty_left) order by item_id,unit_cost,exp_date),'[]')
 from (select item_id,unit_cost,exp_date,sum(qty_left) qty_left from public.stock_layers where warehouse_id='{wh}' and qty_left>0 {extra}
 group by 1,2,3) x;""")


def fingerprint(db, dbname):
    return q(db, dbname, """select md5(concat_ws('|',
 (select string_agg(concat_ws(',',warehouse_id,item_id,qty,average_cost),';' order by warehouse_id,item_id) from public.stock),
 (select string_agg(concat_ws(',',id,qty_left,unit_cost),';' order by id) from public.stock_layers),
 (select count(*) from public.stock_moves),(select count(*) from public.stock_transfers),(select count(*) from public.journal_entries),
 (select count(*) from public.activity_log),
 (select string_agg(concat_ws(',',id,is_active),';' order by id) from public.warehouses)));""")


def b2c_print(db, dbname):
    return q(db, dbname, f"""select md5(concat_ws('|',
 (select string_agg(concat_ws(',',item_id,qty,average_cost),';' order by item_id) from public.stock where warehouse_id='{WH['b2c']}'),
 (select string_agg(concat_ws(',',id,qty_left,unit_cost),';' order by id) from public.stock_layers where warehouse_id='{WH['b2c']}'),
 (select count(*) from public.stock_moves where warehouse_id='{WH['b2c']}'),
 (select is_active from public.warehouses where id='{WH['b2c']}')));""")


# ------------------------------------------------------------------ main scenario
def main_scenario(db, dbname, mode, baseline):
    before = snapshot(db, dbname)
    before_layers = {wh: layers(db, dbname, wh) for wh in ONLINE}
    b2c = b2c_print(db, dbname)
    journals = q(db, dbname, 'select count(*) from public.journal_entries')
    today = q(db, dbname, "select to_char((now() at time zone 'Asia/Jakarta')::date,'YYYY-MM-DD')")
    moved = {(wh, it): v[0] for (wh, it), v in before.items() if wh in ONLINE and v[0] != 0}
    check(f'[{mode}] fixture: 31 barang/230 unit di WH ONLINE PDRY, 3/16 di WH ONLINE TKI',
          [(sum(1 for (w, _) in moved if w == o), sum(v for (w, _), v in moved.items() if w == o)) for o in ONLINE] == [(31, 230), (3, 16)],
          [(sum(1 for (w, _) in moved if w == o), str(sum(v for (w, _), v in moved.items() if w == o))) for o in ONLINE], 'setup')
    if not baseline:
        err = apply_candidate(db, dbname)
        check(f'[{mode}] migrasi berjalan tanpa error', err is None, err)
    after = snapshot(db, dbname)

    check(f'[{mode}] saldo gudang online jadi 0 (semua baris, termasuk lapisan)',
          all(v[0] == 0 for (w, _), v in after.items() if w in ONLINE) and all(not layers(db, dbname, w) for w in ONLINE),
          {str(k): str(v[0]) for k, v in after.items() if k[0] in ONLINE and v[0] != 0})
    bad = {f'{it[-6:]}': (str(before.get((STORE[w], it), [0])[0]), str(q_), str(after.get((STORE[w], it), [0])[0]))
           for (w, it), q_ in moved.items() if after.get((STORE[w], it), [0])[0] != before.get((STORE[w], it), [0])[0] + q_}
    check(f'[{mode}] saldo gudang toko naik tepat sebesar saldo online', not bad, bad)
    bad = {}
    for (w, it) in moved:
        b_val = before[(w, it)][1] + before.get((STORE[w], it), [0, Decimal(0)])[1]
        a_val = after.get((STORE[w], it), [0, Decimal(0)])[1] + after.get((w, it), [0, Decimal(0)])[1]
        if abs(a_val - b_val) > Decimal('0.01'): bad[it[-6:]] = (str(b_val), str(a_val))
    check(f'[{mode}] nilai persediaan per barang tetap (online+toko sebelum = toko sesudah)', not bad, bad, 'invariant')
    tb = sum(v[1] for v in before.values()); ta = sum(v[1] for v in after.values())
    check(f'[{mode}] total nilai persediaan seluruh gudang tetap', abs(tb - ta) <= Decimal('0.05'), (str(tb), str(ta)), 'invariant')
    check(f'[{mode}] tidak ada jurnal baru', q(db, dbname, 'select count(*) from public.journal_entries') == journals, '', 'invariant')
    check(f'[{mode}] WH B2C tidak tersentuh (saldo, lapisan, mutasi, status aktif)', b2c_print(db, dbname) == b2c, '', 'invariant')

    docs = js(db, dbname, f"""select coalesce(jsonb_agg(jsonb_build_object('id',id,'no',no_pemindahan,'proses',proses,'status',status,'from',from_warehouse_id,
 'to',to_warehouse_id,'src',source_transfer_id,'note',keterangan,'tgl',tanggal,'by',created_by,'key',request_key,'payload_notes',posting_payload->>'notes',
 'items',(select jsonb_object_agg(item_id,jsonb_build_array(qty,selected_qty,satuan,faktor)) from public.stock_transfer_items where transfer_id=t.id)) order by no_pemindahan),'[]')
 from public.stock_transfers t where keterangan like '{NOTE}%';""")
    kirim = [d for d in docs if d['proses'] == 'Kirim Barang']; terima = [d for d in docs if d['proses'] == 'Terima Barang']
    shape = (len(docs) == 4 and len(kirim) == 2 and len(terima) == 2
             and sorted((d['from'], d['to']) for d in kirim) == sorted(STORE.items())
             and all(d['status'] == 'Diterima Seluruhnya' for d in kirim)
             and all(d['status'] is None and d['src'] in [k['id'] for k in kirim] for d in terima)
             and len({d['src'] for d in terima}) == 2)
    check(f'[{mode}] dokumen: per gudang online satu Kirim Barang (Diterima Seluruhnya) + satu Terima Barang yang merujuknya', shape,
          [(d['no'], d['proses'], d['status']) for d in docs])
    prefix = 'IT.%s.%s.' % (today[:4], today[5:7])
    nums = [d['no'] for d in docs]
    seq = sorted(int(n[len(prefix):]) for n in nums if n.startswith(prefix) and re.fullmatch(r'\d{5}', n[len(prefix):]))
    check(f'[{mode}] penomoran resmi IT.YYYY.MM.NNNNN berurutan', len(seq) == 4 and seq == list(range(seq[0], seq[0] + 4)) if seq else False, nums)
    check(f'[{mode}] catatan E4 di keterangan & payload, tanggal hari ini (WIB), aktor sistem, kunci kiriman terisi',
          bool(docs) and all(d['note'].startswith(NOTE) and d['payload_notes'] == d['note'] and d['tgl'] == today and d['by'] is None and d['key'] for d in docs),
          [(d['tgl'], d['by']) for d in docs])
    ok = bool(docs)
    for d in docs:
        o = d['from'] if d['proses'] == 'Kirim Barang' else next(k['from'] for k in kirim if k['id'] == d['src'])
        want = {it: q_ for (w, it), q_ in moved.items() if w == o}
        got = d['items'] or {}
        ok &= set(got) == set(want) and all(Decimal(str(got[it][0])) == want[it] and Decimal(str(got[it][1])) == want[it]
                                            and got[it][2] == 'pcs' and Decimal(str(got[it][3])) == 1 for it in want)
    check(f'[{mode}] isi dokumen = semua barang bersaldo positif, qty penuh, satuan dasar (barang bersaldo 0 tidak ikut)',
          ok and item_id('Z', 1) not in json.dumps(docs))
    # one movement per FIFO layer taken, so compare the per-(document, warehouse, item, direction) sums
    moves = js(db, dbname, f"""select coalesce(jsonb_agg(jsonb_build_array(ref,typ,wh,item,qty)),'[]') from (select m.source_ref ref,w.type typ,m.warehouse_id wh,m.item_id item,sum(m.qty) qty
 from public.stock_moves m join public.warehouses w on w.id=m.warehouse_id join public.stock_transfers t on t.no_pemindahan=m.source_ref
 where m.source='transfer' and t.keterangan like '{NOTE}%' group by 1,2,3,4,sign(m.qty)) x;""")
    ok = bool(kirim) and len(moves) == 4 * len(moved)
    for k in kirim:
        tr = next(d for d in terima if d['src'] == k['id'])
        for (w, it), q_ in moved.items():
            if w != k['from']: continue
            exp = {(k['no'], 'ONLINE', w, -q_), (k['no'], 'TRANSIT', None, q_), (tr['no'], 'TRANSIT', None, -q_), (tr['no'], 'RETAIL', STORE[w], q_)}
            got = {(m[0], m[1], m[2] if m[1] != 'TRANSIT' else None, Decimal(str(m[4]))) for m in moves if m[3] == it}
            ok &= got == exp
    check(f'[{mode}] kartu stok: online -> Transit -> toko, sumber transfer, nomor dokumen', ok, len(moves))
    check(f'[{mode}] Transit kosong lagi untuk barang yang dipindah',
          q(db, dbname, "select count(*) from public.stock s join public.warehouses w on w.id=s.warehouse_id where w.type='TRANSIT' and s.qty<>0") == '0', '', 'invariant')
    if mode == 'fifo':
        ok = True; detail = {}
        for w in ONLINE:
            terima_no = next(d['no'] for d in terima if any(k['id'] == d['src'] and k['from'] == w for k in kirim)) if terima else 'x'
            got = layers(db, dbname, STORE[w], f"and source='transfer' and source_ref='{terima_no}'")
            want = before_layers[w]
            ok &= [[g[0], Decimal(str(g[1])), g[2], Decimal(str(g[3]))] for g in got] == [[x[0], Decimal(str(x[1])), x[2], Decimal(str(x[3]))] for x in want]
            detail[w[-2:]] = (len(want), len(got))
        check('[fifo] lapisan FIFO pindah utuh: harga pokok, kedaluwarsa dan qty per lapisan sama', ok and bool(kirim), detail)
    else:
        bad = {}
        for (w, it), q_ in moved.items():
            s_b = before.get((STORE[w], it), [Decimal(0), Decimal(0)])
            exp = (s_b[1] + before[(w, it)][1]) / (s_b[0] + q_)
            got = q(db, dbname, f"select average_cost from public.stock where warehouse_id='{STORE[w]}' and item_id='{it}'")
            if not got or abs(Decimal(got) - exp) > Decimal('0.000001'): bad[it[-6:]] = (str(exp), got)
        check('[average] average gudang toko = gabungan nilai toko + nilai online (harga pokok asal ikut)', not bad, bad)
    act = js(db, dbname, f"""select jsonb_build_object(
 'docs',(select count(*) from public.activity_log a where a.entity='stock_transfers' and a.row_entity='stock_transfers' and a.action='create' and a.actor_kind='system'
   and a.entity_id in (select id::text from public.stock_transfers where keterangan like '{NOTE}%')),
 'wh',(select count(*) from public.activity_log a where a.entity='warehouses' and a.action='update' and a.actor_kind='system'
   and a.entity_id in ('{ONLINE[0]}','{ONLINE[1]}')));  -- warehouses is metadata_only in activity_log_sources""")
    check(f'[{mode}] log aktivitas: 4 dokumen + 2 gudang dinonaktifkan, aktor "Sistem / database"', act == {'docs': 4, 'wh': 2}, act)
    st = js(db, dbname, "select jsonb_object_agg(name,is_active) from public.warehouses where type<>'TRANSIT';")
    check(f'[{mode}] WH ONLINE PDRY & TKI nonaktif; WH PDRY, WH TKI, WH B2C tetap aktif',
          st == {'WH ONLINE PDRY': False, 'WH ONLINE TKI': False, 'WH PDRY': True, 'WH TKI': True, 'WH B2C': True}, st)
    fp = fingerprint(db, dbname)
    err = apply_candidate(db, dbname) if not baseline else None
    check(f'[{mode}] dijalankan ulang: ditolak, tidak ada yang berubah',
          bool(err) and 'sudah tidak aktif' in err and fingerprint(db, dbname) == fp, err)


# ------------------------------------------------------------------ refusals
def refusals(db, template, baseline):
    pz = item_id('P', 7)
    cases = [
        ('saldo minus di gudang online', f"select * from public.stock_out_fifo('{WH['on_pdry']}','{pz}',9,'sale-online','SO-E4-X','2026-11-04');", 'saldo minus'),
        ('gudang toko tujuan tidak aktif', f"update public.warehouses set is_active=false where id='{WH['tki']}';", 'WH TKI'),
        ('gudang online tidak ditemukan (nama berubah)', f"update public.warehouses set name='WH ONLINE PDRY LAMA' where id='{WH['on_pdry']}';", 'harus tepat satu'),
        ('ada mutasi sesudah 4 Nov (saldo sama)', f"select public.stock_in_fifo('{WH['on_tki']}','{item_id('T', 2)}',1,7000,'purchase','PO-E4-X','2026-11-05');"
         f"select * from public.stock_out_fifo('{WH['on_tki']}','{item_id('T', 2)}',1,'sale-online','SO-E4-X','2026-11-05');", 'sesudah 2026-11-04'),
        ('saldo berubah sejak dicek (total unit lain)', f"select public.stock_in_fifo('{WH['on_pdry']}','{pz}',1,9000,'purchase','PO-E4-X','2026-11-03');", 'berubah sejak dicek'),
        ('opname terbuka di gudang online', f"insert into public.opname_orders(no_opname,warehouse_id,penanggung_jawab,status) values('OP-E4-X','{WH['on_tki']}','Fiktif','Terbuka');", 'dokumen terbuka'),
        ('periode akuntansi hari ini terkunci', "update public.accounting_locks set closed_until=(now() at time zone 'Asia/Jakarta')::date;", 'Periode akuntansi'),
        ('barang bersaldo sudah nonaktif', f"set session_replication_role=replica; update public.items set is_active=false where id='{pz}'; set session_replication_role=origin;", 'tidak aktif'),
        ('Transit masih memegang barang yang sama', f"insert into public.warehouses(id,branch_id,code,name,type) values('e4020000-0000-4000-8000-000000000009','{BR['pdry']}','TRANSIT','Transit','TRANSIT');"
         f"select public.stock_in_fifo('e4020000-0000-4000-8000-000000000009','{pz}',1,9000,'transfer','IT-E4-X','2026-11-03');", 'Transit'),
        ('lapisan FIFO tidak sama dengan saldo (mode FIFO)', f"update public.stock_layers set qty_left=qty_left-1 where warehouse_id='{WH['on_pdry']}' and item_id='{pz}' and qty_left>=1 and id=(select id from public.stock_layers where warehouse_id='{WH['on_pdry']}' and item_id='{pz}' and qty_left>=1 order by id limit 1);", 'lapisan FIFO'),
        ('fungsi posting resmi berubah (drift)', """do $d$ declare v text:=pg_get_functiondef('public.post_stock_transfer_atomic(uuid,uuid,uuid,uuid,date,text,jsonb)'::regprocedure);
begin execute replace(v,'''transfer'',v_number,p_date);','''transfer'',v_number,p_date+0);');end $d$;""", 'E4_DRIFT'),
    ]
    for i, (name, setup, phrase) in enumerate(cases):
        dbn = 'ref_%d' % i
        clone(db, dbn, template)
        q(db, dbn, setup)
        fp = fingerprint(db, dbn)
        err = None if baseline else apply_candidate(db, dbn)
        check('[tolak] ' + name, bool(err) and phrase in err and ('Tidak ada yang diubah' in err) and fingerprint(db, dbn) == fp, err)
        q(db, 'postgres', 'drop database %s' % dbn)


def negative_destination(db, template, mode, baseline):
    """Informasi: gudang toko sedang minus untuk satu barang -> perilaku normal penerimaan ke stok minus."""
    dbn = 'neg_' + mode
    clone(db, dbn, template)
    it = item_id('P', 10)
    q(db, dbn, "insert into public.coa_accounts(code,name,type,normal_balance,is_header) values('5101','HPP fiktif','BEBAN','D',false),('1301','Persediaan fiktif','ASET','D',false) on conflict(code) do update set is_active=true,is_header=false;"
          f"select * from public.stock_out_fifo('{WH['pdry']}','{it}',2,'sale-online','SO-E4-NEG','2026-11-04');")
    err = None if baseline else apply_candidate(db, dbn)
    qty = q(db, dbn, f"select qty from public.stock where warehouse_id='{WH['pdry']}' and item_id='{it}'")
    var = q(db, dbn, "select count(*) from public.journal_entries where source='inventory-variance'")
    check(f'[{mode}] gudang toko minus 2 untuk satu barang: tetap jalan, saldo toko 7-2=5 (jurnal penyesuaian HPP stok minus: {var})',
          err is None and qty == '5' and (var == ('1' if mode == 'average' else '0')), (err, qty, var))
    q(db, 'postgres', 'drop database %s' % dbn)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--pg-bin', default='/usr/lib/postgresql/16/bin')
    p.add_argument('--json')
    p.add_argument('--baseline', action='store_true')
    a = p.parse_args()
    with NativePostgres(a.pg_bin) as db:
        build_chain(db)
        print('Chain built (without candidate).', flush=True)
        q(db, 'postgres', 'create database tpl_chain template postgres')
        # Database tanpa gudang online produksi (rantai migrasi bersih, seperti harness lain): migrasi tidak boleh gagal
        # dan tidak boleh mengubah apa pun — supaya harness lain yang memasang seluruh rantai tetap jalan.
        clone(db, 'kosong', 'tpl_chain')
        before = q(db, 'kosong', 'select count(*) from public.stock_transfers')
        err = apply_candidate(db, 'kosong')
        after = q(db, 'kosong', 'select count(*) from public.stock_transfers')
        check('database tanpa WH ONLINE PDRY/TKI: migrasi selesai tanpa perubahan (tidak ada dokumen baru)',
              err is None and before == after, dict(err=err, before=before, after=after), 'setup')
        for mode in ('fifo', 'average'):
            fx = 'fx_' + mode
            clone(db, fx, 'tpl_chain')
            fixtures(db, fx, mode == 'average')
            check(f'[{mode}] metode biaya fixture', q(db, fx, 'select method from public.inventory_costing_settings') == ('moving_average' if mode == 'average' else 'fifo'), '', 'setup')
            run = 'run_' + mode
            clone(db, run, fx)
            main_scenario(db, run, mode, a.baseline)
            negative_destination(db, fx, mode, a.baseline)
            if mode == 'fifo':
                refusals(db, fx, a.baseline)
    feature = [r for r in RESULTS if r['kind'] == 'feature']
    if a.baseline:
        red = [r for r in feature if r['status'] == 'FAIL']
        print(f'BASELINE: {len(red)}/{len(feature)} feature cases RED without the candidate; '
              f"{sum(r['status'] == 'PASS' for r in RESULTS if r['kind'] != 'feature')}/{len(RESULTS) - len(feature)} setup/invariant cases PASS.", flush=True)
        ok = len(red) == len(feature) and all(r['status'] == 'PASS' for r in RESULTS if r['kind'] != 'feature')
    else:
        ok = all(r['status'] == 'PASS' for r in RESULTS)
        print(f"{sum(r['status'] == 'PASS' for r in RESULTS)}/{len(RESULTS)} PASS", flush=True)
    if a.json:
        Path(a.json).write_text(json.dumps(dict(candidate=CAND, baseline=a.baseline, ok=ok, results=RESULTS), indent=1, default=str))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
