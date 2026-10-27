#!/usr/bin/env python3
"""A02/P01 purchase correction requests: fictional fixture in an owned network-none PostgreSQL 16.

Never accepts a database URL. Applies every repository migration, then runs the
rolled-back SQL suite supabase/tests/purchase_correction_requests.sql.
"""
from pathlib import Path
import importlib.util
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def main():
    with fixture.DisposablePostgres() as db:
        db.bootstrap()
        for name in ['purchase_correction_requests.sql']:
            db.sql((ROOT / 'supabase/tests' / name).read_text())
            print('PASS ' + name, flush=True)
        left = db.sql('select count(*) from purchase_correction_requests;')
        assert left == '0', 'Fixture rows leaked: ' + left
        print('PASS fixture rolled back (0 request rows remain)', flush=True)
        # Rehearse the owner package freeze exactly as written: writes refused, stored requests readable.
        suite = (ROOT / 'supabase/tests/purchase_correction_requests.sql').read_text()
        fixture_sql = suite[:suite.index('set local role authenticated;')]
        doc = (ROOT / 'docs/evidence/2026-10-27-a02-correction-requests/owner-apply/04-freeze-if-decided.sql').read_text()
        freeze = doc[doc.index('begin;') + len('begin;'):doc.index('commit;')]
        db.sql(fixture_sql + """
set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',md5('a02-staff')::uuid::text,true);
select create_purchase_correction_request('purchase_order',md5('a02-po')::uuid,'a02-rollback-01','Rincian sebelum rollback dibekukan');
reset role;
""" + freeze + """
set local role authenticated;
do $$declare blocked boolean:=false;begin
 begin perform create_purchase_correction_request('purchase_order',md5('a02-po')::uuid,'a02-rollback-02','Rincian setelah rollback dibekukan');
 exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Rollback freeze still accepts new requests';end if;
 if (select count(*) from purchase_correction_requests where status='pending')<>1 then raise exception 'Rollback freeze lost the stored request';end if;
end$$;
select set_config('request.jwt.claim.sub',md5('a02-owner')::uuid::text,true);
do $$declare blocked boolean:=false;begin
 begin perform process_purchase_correction_request((select id from purchase_correction_requests limit 1),'Setelah dibekukan');
 exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Rollback freeze still allows processing';end if;
end$$;
rollback;
""")
        print('PASS owner package freeze (04) refuses writes and keeps stored requests readable', flush=True)


if __name__ == '__main__':
    main()
