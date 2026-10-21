#!/usr/bin/env python3
"""Install the guard over fictional unreconciled stock without activating it.

Only the owned network-none PostgreSQL16 harness is used; no external DSN,
credentials, production target or activation request is accepted.
"""
import importlib.util
from pathlib import Path
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
GUARD = '20261021170000_average_activation_accounting_guard.sql'
spec = importlib.util.spec_from_file_location('owned_install_fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
with tempfile.TemporaryDirectory(prefix='kamo-guard-install-') as directory:
    target = Path(directory) / 'supabase/migrations'
    target.mkdir(parents=True)
    for migration in (ROOT / 'supabase/migrations').glob('*.sql'):
        if migration.name != GUARD:
            (target / migration.name).write_bytes(migration.read_bytes())
    harness.ROOT = Path(directory)
    with harness.DisposablePostgres() as db:
        db.bootstrap()
        fixture = (ROOT / 'supabase/tests/average_activation_accounting.sql').read_text().split('-- FUNCTIONAL CASES')[0]
        fixture += """
select stock_in_fifo(md5('ag-wh')::uuid,md5('ag-item')::uuid,10,16,'manual','AG.UNRECONCILED.INSTALL');
create temp table guard_install_snapshot as select pg_temp.activation_state() before_state;
"""
        fixture += (ROOT / 'supabase/migrations' / GUARD).read_text()
        fixture += """
do $$begin
 if to_regprocedure('public.inventory_assert_average_activation_accounting()') is null then raise exception 'Guard was not installed';end if;
 if pg_temp.activation_state() is distinct from (select before_state from guard_install_snapshot) then raise exception 'Installing guard changed mode, stock, cost events or GL';end if;
 if (select method from inventory_costing_settings where id)<>'fifo' then raise exception 'Guard install activated average';end if;
 if (select sum(qty_left*unit_cost) from stock_layers)<>160 or exists(select 1 from journal_lines) then raise exception 'Unreconciled fixture was altered';end if;
end$$;
set local role authenticated;
select pg_temp.activation_denied('rekonsiliasi');
rollback;
"""
        db.sql(fixture)
        print('PASS guard installs over stock160/GL0 without mode/data/history changes; later activation fails closed.', flush=True)
