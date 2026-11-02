#!/usr/bin/env python3
"""Fictional native proof: hiding package BMHP never changes stock/FIFO/HPP/journals.
Socket-only full original schema; original public invoice RPC; no hosted credentials.
"""
import fcntl
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres
OUT = Path('/opt/data/kamo-package-bmhp-evidence')
BASE = '9d4d6a95edbd25edad41fbaaeb35ed1e3a2b9e5f'

def main():
    report = {'base': BASE, 'checks': [], 'native_green': False}
    snapshot_context = None
    def passed(name):
        report['checks'].append(name)
        print('PASS', name, flush=True)
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=ROOT)
    OUT.mkdir(exist_ok=True)
    try:
        originals = {}
        original_bytes = {}
        for line in git('ls-tree', '-r', BASE, '--', 'supabase/migrations').decode().splitlines():
            meta, path = line.split('\t')
            if not path.endswith('.sql'):
                continue
            raw = git('cat-file', 'blob', meta.split()[2])
            assert raw == (ROOT/path).read_bytes(), path
            originals[Path(path).name] = hashlib.sha256(raw).hexdigest()
            original_bytes[Path(path).name] = raw
        assert len(originals) == 363
        report['original_hashes'] = originals
        spec = importlib.util.spec_from_file_location('package_fullschema', ROOT/'scripts/test-accurate-inventory-accounting-postgres.py')
        assert spec is not None and spec.loader is not None
        fixture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fixture)
        # Freeze ONLY selected original bytes. New in-progress candidates in this
        # worktree must never be silently loaded as original business definitions.
        snapshot_context = tempfile.TemporaryDirectory(prefix='package-stock-originals-', dir='/opt/data')
        snapshot = Path(snapshot_context.name)
        (snapshot/'supabase/migrations').mkdir(parents=True)
        for name, raw in original_bytes.items():
            (snapshot/'supabase/migrations'/name).write_bytes(raw)
        setattr(fixture, 'ROOT', snapshot)
        report['runner_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
        report['selected_scope'] = 'Frozen exact-base originals only; pending candidate package-provenance migration is tested by its separate native runner'
        report['excluded_candidates_at_start'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'supabase/migrations').glob('*.sql') if p.name not in original_bytes}
        with open('/opt/data/kamo-heavy-test.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with NativePostgres('/opt/data/kamo-pg-harness/bin') as db:
                fixture.DisposablePostgres.bootstrap(db)
                report['server_version'] = db.last('show server_version')
                passed('363 byte-verified original migrations; PG17 socket-only official Auth/storage fixtures')
                original_fixture = (ROOT/'supabase/tests/clinic_invoice_post.sql').read_text()
                setup = original_fixture.split('set local role authenticated;', 1)[0]
                db.sql(setup + """
insert into public.items(id,code,name,unit,item_type,is_active) values('fa000000-0000-4000-8000-000000000001','PKG-FICTION','Paket fiktif','paket','Grup',true);
insert into public.item_group_components(group_item_id,component_item_id,qty,unit,factor) values('fa000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000001',1,'pcs',1);
-- Fixture opening is explicit in both balance/FIFO (original setup) and card ledger.
insert into public.stock_moves(warehouse_id,item_id,tanggal,qty,unit_cost,source,source_ref) values('d3000000-0000-4000-8000-000000000001','d8000000-0000-4000-8000-000000000001',current_date-1,30,0,'saldo-awal','FICTION-OPENING');
commit;
""")
                header = "jsonb_build_object('tanggal',current_date::text,'subtotal',80,'discount',0,'tax',0,'total',80,'dp_amount',0,'dp_date',null,'paid_status','Lunas','metode_bayar','Tunai','shift_id','da000000-0000-4000-8000-000000000001')"
                lines = """jsonb_build_array(
jsonb_build_object('description','Bahan paket fiktif','qty',3,'price',20,'kind','obat','item_id','d8000000-0000-4000-8000-000000000001','unit','pcs','discount_percent',0,'package_item_id','fa000000-0000-4000-8000-000000000001','package_qty',3),
jsonb_build_object('description','Barang dijual satuan','qty',1,'price',20,'kind','obat','item_id','d8000000-0000-4000-8000-000000000001','unit','pcs','discount_percent',0))"""
                # Real committed transactions in this disposable local cluster prove durable replay.
                auth = "begin;set local role authenticated;set local request.jwt.claim.sub='d1000000-0000-4000-8000-000000000001';set local request.jwt.claim.role='authenticated';"
                statement = f"select public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001','bmhp-display-stock',{header},{lines})"
                inv = db.last(auth + statement + ";commit;")
                no = db.last(f"select invoice_no from invoices where id='{inv}'")
                snapshot = "select public.test_clinic_invoice_state()"
                before_replay = db.last(snapshot)
                assert db.last(auth + statement + ";commit;") == inv
                assert before_replay == db.last(snapshot)
                passed('original authenticated public clinic_post_invoice replay returns same invoice with zero duplicate stock/journal effects')
                assert db.last("select qty from stock where warehouse_id='d3000000-0000-4000-8000-000000000001' and item_id='d8000000-0000-4000-8000-000000000001'") == '26.0000'
                assert db.last(f"select sum(qty) from stock_moves where source='klinik' and source_ref='{no}'") == '-4.0000'
                assert db.last(f"select count(*) from stock_moves where source='klinik' and source_ref='{no}'") == '2'
                assert db.last("select sum(qty_left) from stock_layers where warehouse_id='d3000000-0000-4000-8000-000000000001' and item_id='d8000000-0000-4000-8000-000000000001'") == '26.0000'
                assert db.last("select count(*) from stock_moves where item_id='fa000000-0000-4000-8000-000000000001'") == '0'
                passed('three package materials plus one standalone SKU deduct exactly four base units once; FIFO=stock=26; Grup has no fictitious stock issue')
                assert db.last(f"select sum(hpp) from invoice_items where invoice_id='{inv}'") == '8.00'
                assert db.last(f"select count(*)=2 and bool_and(debit=credit) from (select sum(l.debit) debit,sum(l.credit) credit from journal_entries e join journal_lines l on l.entry_id=e.id where e.source in('klinik','klinik-hpp') and e.source_ref='{no}' group by e.id) q") == 't'
                assert db.last(f"select sum(l.debit) from journal_entries e join journal_lines l on l.entry_id=e.id join coa_accounts c on c.id=l.account_id where e.source='klinik-hpp' and e.source_ref='{no}' and c.code='600001'") == '8.00'
                assert db.last(f"select total from invoices where id='{inv}'") == '80.00'
                passed('saved package origin and original invoice total=80; exact FIFO HPP=8 with two balanced revenue/HPP journals')
                report['stockcard_rows'] = json.loads(db.last("select jsonb_agg(jsonb_build_object('tanggal',tanggal,'qty',qty,'unit_cost',unit_cost,'source',source,'source_ref',source_ref,'gudang','INVTEST-WH') order by tanggal,created_at,id) from stock_moves where warehouse_id='d3000000-0000-4000-8000-000000000001' and item_id='d8000000-0000-4000-8000-000000000001'"))
                report['persisted_display_sources'] = json.loads(db.last(f"select jsonb_agg(jsonb_build_object('deskripsi',ii.deskripsi,'qty',ii.qty,'harga',ii.harga,'package_item_id',ii.package_item_id,'package_qty',ii.package_qty,'package',case when g.id is not null then jsonb_build_object('name',g.name) end) order by ii.id) from invoice_items ii left join items g on g.id=ii.package_item_id where ii.invoice_id='{inv}'"))
                report['invoice_total'] = 80
                report['hpp'] = 8
                report['stock_balance'] = 26
                report['fixture_scope'] = 'Fictional committed transactions only inside owned disposable cluster, removed on exit'
                report['native_green'] = True
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        (OUT/'native-stock-report.json').write_text(json.dumps(report, indent=2)+'\n')
        if snapshot_context is not None:
            snapshot_context.cleanup()

if __name__ == '__main__':
    main()
