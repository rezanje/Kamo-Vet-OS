#!/usr/bin/env python3
"""Owned isolated PostgreSQL fixture; never connects to a production target."""
import importlib.util
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("isolated_fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

bootstrap = (ROOT / "supabase/tests/fixtures/unpaid_clinical_schema.sql").read_text()
bootstrap += "\nalter table invoices add column paid_at timestamptz;\n"
access = (ROOT / "supabase/migrations/20261017090000_role_capabilities.sql").read_text()
for name in ("has_role_capability", "user_can_access_branch"):
    bootstrap += "\n" + re.search(
        r"create (?:or replace )?function public\." + name + r"\(.*?\$\$;", access, re.S
    ).group(0)
bootstrap += """
create policy visit_all on visits for all to authenticated
  using(public.user_can_access_branch(branch_id)) with check(public.user_can_access_branch(branch_id));
create policy mr_all on medical_records for all to authenticated
  using(exists(select 1 from visits v where v.id=visit_id and public.user_can_access_branch(v.branch_id)))
  with check(exists(select 1 from visits v where v.id=visit_id and public.user_can_access_branch(v.branch_id)));
create policy invoice_all on invoices for all to authenticated
  using(exists(select 1 from visits v where v.id=visit_id and public.user_can_access_branch(v.branch_id)))
  with check(exists(select 1 from visits v where v.id=visit_id and public.user_can_access_branch(v.branch_id)));
"""
old = (ROOT / "supabase/migrations/20260924141000_atomic_initial_clinic_record.sql").read_text()
bootstrap += "\n" + old[
    old.index("create function public.protect_submitted_clinic_record"):
    old.index("create function public.clinic_save_initial_record")
]
with fixture.DisposablePostgres() as db:
    db.sql(bootstrap)
    db.sql((ROOT / "supabase/migrations/20261024074043_unpaid_clinical_correction.sql").read_text())
    db.sql((ROOT / "supabase/migrations/20261026103000_paid_clinical_addenda.sql").read_text())
    db.sql((ROOT / "supabase/tests/paid_clinical_addenda.sql").read_text())
    print("PASS paid clinical addenda: immutable clinical/payment/stock sources, audit, idempotency and access guards")
