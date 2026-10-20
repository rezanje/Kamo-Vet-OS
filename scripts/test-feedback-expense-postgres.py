#!/usr/bin/env python3
"""Run feedback finance acceptance in an owned, disposable PostgreSQL database.

Only unrelated sales/invoice dependency tables use minimal shapes. All finance
functions, triggers and policies are loaded verbatim from production migrations.
Every migration and test error stops the run. No production connection is used.
"""
from pathlib import Path
import os
import subprocess
import time
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
DB = f"vetos_feedback_acceptance_{os.getpid()}_{int(time.time())}"
PSQL = ["psql", "-q", "-h127.0.0.1", "-p5432", "-v", "ON_ERROR_STOP=1"]
PG_ENV = {**os.environ, "PGOPTIONS": "-c client_min_messages=warning"}
REQUIRED_MIGRATIONS = (
    "0001_core.sql", "0002_rls.sql", "0011_cashier_shifts.sql", "0012_expenses.sql",
    "0015_keuangan.sql", "0016_hris.sql", "0022_bank_rec.sql", "0026_shift_type_breakdown.sql",
    "0046_expenses_shift.sql", "0055_tutup_buku.sql",
    "0060_user_admin.sql", "0068_kas_bank.sql", "0071_dokumen_lampiran.sql",
    "0072_kas_masuk_keluar.sql", "0085_peta_rekening_pembayaran.sql", "0101_akses_grup.sql",
    "0113_coa_header_detail.sql", "0128_penomoran_dokumen.sql",
    "20261015051000_fix_pos_expense_workflow.sql",
    "20261020112110_manual_journal_corrections.sql", "20261020112715_cash_entry_corrections.sql",
    "20261020130000_expense_backoffice_account.sql",
)


def run(*args: str, check: bool = True, input: Optional[str] = None) -> None:
    subprocess.run([*args], cwd=ROOT, check=check, input=input, text=True, env=PG_ENV)


BOOTSTRAP = r"""
create extension if not exists pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'anon') $$;
create schema storage;
create table storage.buckets(id text primary key, name text not null, public boolean not null default false);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
-- 0011 adds shift_id to the historical sales table; the expense fixture only
-- needs that dependency, so keep its smallest compatible shape here.
create table public.sales(id uuid primary key default gen_random_uuid());
create table public.invoices(id uuid primary key default gen_random_uuid());
grant usage on schema auth, storage to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function auth.role() to authenticated;
"""

def production_section(name: str, start: str, end: str) -> str:
    source = (ROOT / "supabase/migrations" / name).read_text()
    first = source.index(start)
    last = source.index(end, first)
    return source[first:last]


def apply_section(name: str, start: str, end: str) -> None:
    run(*PSQL, "-d", DB, input=production_section(name, start, end))


created = False
try:
    run("createdb", "-h127.0.0.1", "-p5432", DB)
    created = True
    run(*PSQL, "-d", DB, input=BOOTSTRAP)
    for name in REQUIRED_MIGRATIONS:
        path = ROOT / "supabase/migrations" / name
        if not path.is_file():
            raise RuntimeError(f"Required migration missing: {name}")
        run(*PSQL, "-d", DB, "-f", str(path))
        if name == "0015_keuangan.sql":
            run(*PSQL, "-d", DB, input="""
insert into public.coa_accounts(code,name,type,normal_balance) values
  ('1101','Test cash','ASET','D'),('1102','Test bank','ASET','D'),
  ('5301','Utilities','BEBAN','D'),('5302','Supplies','BEBAN','D'),
  ('5303','Transport','BEBAN','D'),('5304','Maintenance','BEBAN','D'),
  ('5401','Operations','BEBAN','D'),('4101','Income','PENDAPATAN','K') on conflict (code) do nothing;
""")
        if name == "0016_hris.sql":
            apply_section("0034_employee_profile_link.sql", "alter table employees add column", "-- Demo:")
        if name == "0113_coa_header_detail.sql":
            apply_section("20260924125000_clinic_invoice_post.sql",
                          "create or replace function public.check_period_lock()",
                          "-- Each successfully issued compound")
            apply_section("20261014052234_employee_account_operational_context.sql",
                          "create function public.guard_employee_account_identity()",
                          "create function public.link_employee_account")
        if name == "0128_penomoran_dokumen.sql":
            apply_section("20261004150000_sales_safe_posting.sql",
                          "create function public.sales_next_number(",
                          "create function public.sales_post_order(")
            apply_section("20261007110000_online_return_unit_posting.sql",
                          "create function public.unit_posting_cash(",
                          "create function public.post_online_order(")
    run(*PSQL, "-d", DB, input="""
grant select, insert on public.expenses, public.document_attachments to authenticated;
grant select, insert, update, delete on public.cash_entries,
  public.journal_entries, public.journal_lines to authenticated;
grant select, update on public.profiles, public.accounting_locks, public.coa_accounts, public.cash_accounts to authenticated;
grant select on
  public.coa_accounts, public.profiles, public.branches, public.user_branches, public.cash_accounts,
  public.accounting_locks, public.cashier_shifts, public.payment_account_map to authenticated;
""")
    for suite in ("expense-workflow.sql", "manual-journal-corrections.sql", "cash-entry-corrections.sql"):
        run(*PSQL, "-d", DB, "-o", os.devnull, "-f", str(ROOT / "supabase/tests" / suite))
        print(f"PASS {suite}")
    print(f"feedback finance SQL acceptance passed ({len(REQUIRED_MIGRATIONS)} required migrations)")
finally:
    if created:
        subprocess.run(["dropdb", "-h127.0.0.1", "-p5432", DB], check=True)
