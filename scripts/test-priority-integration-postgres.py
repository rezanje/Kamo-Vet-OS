#!/usr/bin/env python3
"""PR74/76 interaction using only the owned network-none fixture harness."""
import importlib.util
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("priority_fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

# Reuse the exact PR74 fixture, adding real code-bearing provenance before its
# existing preview/post/retry/immutable-journal checks. No remote DB is accepted.
fixture = (ROOT / "supabase/tests/accurate_inventory_accounting.sql").read_text()
fixture = fixture.replace("set local role authenticated;", """
update import_run_rows set source_code='AI-I' where run_id=md5('ai-run')::uuid and source_row=1;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
""")
fixture = fixture.replace("rollback;", """
do $$ declare message text; begin
 begin
  update items set code='AI-RENAMED' where id=md5('ai-item')::uuid;
  raise exception 'Expected code-bearing import to block rename';
 exception when others then
  get stacked diagnostics message=message_text;
  if message not like 'Kode SKU sudah memiliki riwayat%' then raise; end if;
 end;
 begin
  perform change_master_data_lifecycle('items',md5('ai-item')::uuid,'trash',0,'Fictional trash attempt');
  raise exception 'Expected posted import to block trash';
 exception when others then
  get stacked diagnostics message=message_text;
  if message not like 'Data masih memiliki pemakaian atau riwayat%' then raise; end if;
 end;
 update items set name='Fiction renamed label' where id=md5('ai-item')::uuid;
 perform change_master_data_lifecycle('items',md5('ai-item')::uuid,'archive',0,'Fiction explicit archive');
 if not exists(select 1 from items where id=md5('ai-item')::uuid and code='AI-I' and not is_active and trashed_at is null) then
  raise exception 'Archive changed identity or lost original code';
 end if;
 if (select count(*) from journal_entries where source='accurate-stock-opening' and source_ref=md5('ai-run')::uuid::text)<>1 then
  raise exception 'Master changes altered import journal';
 end if;
end $$;
rollback;
""")
with harness.DisposablePostgres() as database:
    database.bootstrap()
    database.sql(fixture)
    print("PASS PR74 posting/retry/protected basis + PR76 code rename/trash denial, label edit and archive preserve identity/journal.", flush=True)
