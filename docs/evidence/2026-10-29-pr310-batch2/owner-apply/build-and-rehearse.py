#!/usr/bin/env python3
"""Regenerate apply.sql, preflight.sql and readback.sql for PR #310 batch 2 (ten migrations, P03/J02/N01/K08/K14/
C05/I09/M04), then rehearse the owner package on a throwaway native PostgreSQL cluster (no Docker, no database URL,
fictional data only). Production order is mimicked:

  every migration on main (all except batch 1 and batch 2) -> batch 1 through its own owner package apply.sql
  -> Supabase-like default privileges (new functions/tables executable/readable by anon, authenticated, service_role;
     a leftover service_role grant on the replaced functions whose grants batch 2 resets, so rollback must restore ACLs)
  -> batch 2: preflight -> apply -> readback (+ batch 1 readback still 0 failed) -> apply again (refused, nothing
  changes) -> rollback (whole public/clinic_private catalog fingerprint identical to before apply) -> preflight
  -> apply -> readback -> batch 2 SQL suites, each in a disposable copy of the database.

The expected md5 values in preflight.sql (definitions before apply) and readback.sql (definitions after apply) are
taken from this rehearsal; production must match them byte for byte.

Usage: LC_ALL=C.UTF-8 python3 -B docs/evidence/2026-10-29-pr310-batch2/owner-apply/build-and-rehearse.py [pg bin dir]
"""
from pathlib import Path
import difflib
import hashlib
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
BATCH1 = ROOT / "docs/evidence/2026-10-29-pr310-k08-a01-q01/owner-apply"
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

BIN = sys.argv[1] if len(sys.argv) > 1 else "/usr/lib/postgresql/16/bin"
BATCH1_VERSIONS = ["20261030110000", "20261030111000", "20261030112000"]
MIGRATIONS = ["20261101100000_p03_harga_bawah_hpp_kasir_klinik.sql",
              "20261101110000_j02_pos_correction_after_shift_finance.sql",
              "20261101111000_j02_clinic_payment_correction.sql",
              "20261101130000_n01_retur_faktur_grosir.sql",
              "20261101140000_k08_admission_requires_settled_invoice.sql",
              "20261101141000_k14_pet_hotel_checkin_tariff.sql",
              "20261101150000_c05_voucher_hanya_lewat_kampanye.sql",
              "20261101151000_i09_riwayat_induk_racikan.sql",
              "20261101152000_c05_rombongan_nota_pendamping.sql",
              "20261101160000_opening_stock_line_rupiah_rounding.sql"]
VERSIONS = [m[:14] for m in MIGRATIONS]
LAST_MAIN = "20261031210000"           # newest migration on main; production must already have it
AUTH_FIX = "20261031095000"            # main: inpatient condition reads auth.role()

# Grant expectation "a/n/s/p" = authenticated/anon/service_role/PUBLIC may execute; "unchanged" = the migration does
# not touch grants, so the ACL must equal the one saved before apply.
G_AUTH = "authenticated=true anon=false service_role=false public=false"
G_NONE = "authenticated=false anon=false service_role=false public=false"
UNCHANGED = "unchanged"
# Functions that exist before batch 2 and are replaced (CREATE OR REPLACE or anchored patch) -> saved for rollback.
REPLACED = [
    ("P03", "public.cashier_post_stock_atomic(uuid,uuid)", G_AUTH),
    ("P03+C05", "public.clinic_post_invoice(uuid,text,jsonb,jsonb)", G_AUTH),
    ("P03", "public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)", UNCHANGED),
    ("J02", "public.correct_pos_sale_payment(uuid,integer,text,text,numeric,numeric)", G_AUTH),
    ("J02", "public.pos_sale_journal_protected(uuid)", UNCHANGED),
    ("N01", "public.receive_wholesale_payment(text,uuid,date,numeric,text,uuid,uuid,text)", G_AUTH),
    ("N01", "public.cancel_wholesale_receipt(uuid,integer,text,text)", G_AUTH),
    ("N01", "public.get_wholesale_operation(uuid,text,text)", G_AUTH),
    ("N01", "public.inventory_record_valuation()", G_NONE),
    ("K08", "public.clinic_admit_inpatient(uuid,text,text)", G_AUTH),
    ("K08", "public.clinic_continue_visit_to_inpatient(uuid,text)", G_AUTH),
    ("K14", "public.protect_inpatient_care_staff()", G_NONE),
    ("K14", "public.clinic_admit_inpatient_typed(uuid,text,text,text)", G_AUTH),
    ("K14", "public.clinic_change_inpatient_condition(uuid,text,text)", G_AUTH),
    ("C05", "public.guard_campaign_code_use()", G_NONE),
    ("M04", "public.prepare_accurate_initial_stock(text,text,uuid,uuid,date,jsonb,text)", UNCHANGED),
]
# Functions created by batch 2 -> dropped by rollback.
NEW = [
    ("P03", "clinic_private.rupiah_text(numeric)", G_NONE),
    ("P03", "clinic_private.assert_invoice_price_floor(uuid,numeric,numeric)", G_NONE),
    ("J02", "public.guard_clinic_payment_corrected_invoice()", G_NONE),
    ("J02", "public.correct_clinic_invoice_payment(uuid,uuid,integer,text,text,text)", G_AUTH),
    ("N01", "public.guard_wholesale_return_record()", G_NONE),
    ("N01", "public.guard_wholesale_returned_ar()", G_NONE),
    ("N01", "public.guard_wholesale_invoice_with_return()", G_NONE),
    ("N01", "public.guard_wholesale_return_effect()", G_NONE),
    ("N01", "public.post_wholesale_return(text,uuid,date,uuid,text,jsonb)", G_AUTH),
    ("N01", "public.void_wholesale_return(uuid,integer,text,text)", G_AUTH),
    ("C05", "public.voucher_wajib_lewat_kampanye(text)", G_NONE),
    ("I09", "public.read_compound_parent_history(uuid,date,date,integer,integer)", G_AUTH),
]
NEW_TABLES = ["clinic_payment_corrections", "clinic_payment_correction_requests", "wholesale_returns", "wholesale_return_items"]
NEW_COLUMNS = [("sale_payment_corrections", "source_shift_status", "text"), ("sales_invoices", "returned_ar", "numeric(15,2)"),
               ("invoices", "campaign_carrier_id", "uuid")]
NEW_INDEXES = ["clinic_compound_sales_sale_item_idx", "invoices_campaign_carrier_idx", "clinic_payment_corrections_invoice_idx"]
NEW_TRIGGERS = [  # (migration, table, trigger) on tables that exist before batch 2
    ("J02", "invoices", "clinic_payment_corrected_invoice_guard"),
    ("N01", "sales_invoices", "wholesale_returned_ar_guard"),
    ("N01", "sales_invoices", "wholesale_invoice_return_guard"),
    ("N01", "journal_entries", "wholesale_return_journal_guard"),
    ("N01", "journal_lines", "wholesale_return_journal_line_guard"),
    ("N01", "stock_moves", "wholesale_return_stock_move_guard"),
    ("N01", "stock_layers", "wholesale_return_stock_layer_guard"),
]
TOUCHED_TABLES = ["items", "invoices", "sales_invoices", "journal_entries", "journal_lines", "stock_moves", "stock_layers",
                  "wholesale_operation_requests", "sale_payment_corrections", "clinic_compound_sales", "activity_log_sources"]
HELPERS = ["user_can_access_branch", "sales_assert_access", "wholesale_access", "wholesale_period", "wholesale_write_journal",
           "wholesale_assert_journal", "stock_in_fifo", "clinic_write_journal", "campaign_code_used", "capture_activity_log",
           "pos_sale_protect_journal", "inpatient_clinic_module_access", "clinic_staff_name", "is_racikan_sku"]

q = lambda s: "'" + s.replace("'", "''") + "'"
sha = lambda text: hashlib.sha256(text.encode()).hexdigest()
in_list = lambda items: ",".join(q(i) for i in items)
sources = {m: (ROOT / "supabase/migrations" / m).read_text() for m in MIGRATIONS}

# ───────────────────────────── apply.sql ─────────────────────────────
apply_sql = (
    "-- PR #310 batch 2 (P03/J02/N01/K08/K14/C05/I09/M04) APPLY — WRITES. Generated by build-and-rehearse.py; do not edit by hand.\n"
    "-- One transaction: saves everything it replaces (for rollback.sql) into vetos_release.pr310_batch2_backup, then the ten\n"
    "-- migrations verbatim, in filename order:\n"
    + "".join(f"--   supabase/migrations/{m} (sha256 {sha(sources[m])})\n" for m in MIGRATIONS)
    + "-- plus their history rows. Requires batch 1 (20261030110000/111000/112000) already applied. Any error, a lock wait\n"
    "-- over 5 s, or a role other than postgres rolls everything back.\n"
    "begin;\nset local lock_timeout = '5s';\nset local statement_timeout = '120s';\n"
    "do $guard$ begin\n"
    "  if current_user <> 'postgres' then raise exception 'PR310B2: must run as postgres'; end if;\n"
    f"  if (select count(*) from supabase_migrations.schema_migrations where version in ({in_list(BATCH1_VERSIONS)})) <> 3 then\n"
    "    raise exception 'PR310B2_BATCH1_MISSING: apply batch 1 first (docs/evidence/2026-10-29-pr310-k08-a01-q01/owner-apply)';\n  end if;\n"
    f"  if exists(select 1 from supabase_migrations.schema_migrations where version in ({in_list(VERSIONS)}))\n"
    "     or to_regclass('vetos_release.pr310_batch2_backup') is not null then\n"
    "    raise exception 'PR310B2_ALREADY_APPLIED: run readback.sql';\n  end if;\nend $guard$;\n"
    "create schema if not exists vetos_release;\n"
    "revoke all on schema vetos_release from public, anon, authenticated, service_role;\n"
    "create table vetos_release.pr310_batch2_backup(kind text not null, name text not null, payload text, primary key (kind, name));\n"
    "revoke all on table vetos_release.pr310_batch2_backup from public, anon, authenticated, service_role;\n"
    "-- Replaced functions: definition and ACL exactly as they are now.\n"
    "insert into vetos_release.pr310_batch2_backup(kind, name, payload)\n"
    " select k.kind, s.sig, case k.kind when 'function' then pg_get_functiondef(s.sig::regprocedure)\n"
    "   else (select proacl::text from pg_proc where oid = s.sig::regprocedure) end\n"
    f"  from unnest(array[{in_list(sig for _, sig, _ in REPLACED)}]) s(sig)\n"
    "  cross join (values ('function'), ('acl')) k(kind);\n"
    "-- C05 recreates this trigger with an extra column.\n"
    "insert into vetos_release.pr310_batch2_backup(kind, name, payload)\n"
    " select 'trigger', 'invoices.' || g.tgname, pg_get_triggerdef(g.oid) from pg_trigger g\n"
    "  where g.tgrelid = 'public.invoices'::regclass and g.tgname = 'c05_invoice_campaign_code';\n"
    "-- J02 swaps the read policy of sale_payment_corrections.\n"
    "insert into vetos_release.pr310_batch2_backup(kind, name, payload)\n"
    " select 'policy', p.polname, format('create policy %I on public.sale_payment_corrections as %s for %s to %s%s%s',\n"
    "   p.polname, case when p.polpermissive then 'permissive' else 'restrictive' end,\n"
    "   case p.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end,\n"
    "   (select string_agg(case when r = 0 then 'public' else quote_ident(pg_get_userbyid(r)) end, ', ') from unnest(p.polroles) r),\n"
    "   ' using (' || pg_get_expr(p.polqual, p.polrelid) || ')', ' with check (' || pg_get_expr(p.polwithcheck, p.polrelid) || ')')\n"
    "  from pg_policy p where p.polrelid = 'public.sale_payment_corrections'::regclass;\n"
    "-- K14 replaces the items tindakan_kategori check; N01 replaces the wholesale request kind check.\n"
    "insert into vetos_release.pr310_batch2_backup(kind, name, payload)\n"
    " select 'constraint', c.conrelid::regclass::text || '.' || c.conname, pg_get_constraintdef(c.oid) from pg_constraint c\n"
    "  where c.contype = 'c' and ((c.conrelid = 'public.items'::regclass and pg_get_constraintdef(c.oid) like '%tindakan_kategori%')\n"
    "    or (c.conrelid = 'public.wholesale_operation_requests'::regclass and c.conname = 'wholesale_operation_requests_kind_check'));\n"
    "-- Objects created with IF NOT EXISTS / ON CONFLICT DO NOTHING that may already be there (kept by rollback).\n"
    "insert into vetos_release.pr310_batch2_backup(kind, name)\n"
    " select 'source', entity from public.activity_log_sources where entity in ('wholesale_returns', 'wholesale_return_items')\n"
    f" union all select 'index', i from unnest(array[{in_list(NEW_INDEXES[:2])}]) i where to_regclass('public.' || i) is not null;\n\n"
    + "\n".join(sources[m] for m in MIGRATIONS)
    + "\n-- K14 seeded the Pet Hotel service (the value was not allowed before K14, so every such row is new).\n"
    "insert into vetos_release.pr310_batch2_backup(kind, name, payload)\n"
    " select 'seeded_item', id::text, code from public.items where tindakan_kategori = 'Pet Hotel';\n"
    "insert into supabase_migrations.schema_migrations(version, name) values\n"
    + ",\n".join(f" ('{m[:14]}', '{m[15:-4]}')" for m in MIGRATIONS) + ";\ncommit;\n")
(HERE / "apply.sql").write_text(apply_sql)

# ───────────────────────────── shared SQL fragments ─────────────────────────────
def fn_values(rows, expected):
    return ",\n    ".join(f"({q(mig)}, {q(sig)}, {q(expected[sig])}, {q(grants)})" for mig, sig, grants in rows)


GRANTS_ACTUAL = ("'authenticated=' || has_function_privilege('authenticated', f.oid, 'execute')::text"
                 " || ' anon=' || has_function_privilege('anon', f.oid, 'execute')::text"
                 " || ' service_role=' || has_function_privilege('service_role', f.oid, 'execute')::text"
                 " || ' public=' || exists(select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a"
                 " where p.oid = f.oid and a.grantee = 0)::text")
ATTRS_ACTUAL = ("(select 'definer=' || p.prosecdef::text || ' config=' || coalesce(p.proconfig::text, '{}') || ' owner='"
                " || pg_get_userbyid(p.proowner) from pg_proc p where p.oid = f.oid)")
SUMMARY = """select check_name, expected, actual, case when expected is null then null else actual is not distinct from expected end as ok
from checks
union all
select 'SUMMARY', null, (count(*) filter (where expected is not null and actual is distinct from expected))::text || ' failed', null
from checks;
rollback;
"""


def preflight_sql(pre_md5):
    return f"""-- PR #310 batch 2 PREFLIGHT — READ ONLY. Generated by build-and-rehearse.py; do not edit by hand.
-- Nothing here writes; the transaction is read only and ends with rollback.
-- In the Supabase SQL editor select only the `with … select …` statement and Run it.
-- Every row with an expected value must show ok = true and the last row SUMMARY must say "0 failed".
-- Rows with expected = null are information only.
begin read only;
with f(mig, sig, md5_expected, grants_expected) as (values
    {fn_values(REPLACED, pre_md5)}
), fx as (
  select f.*, to_regprocedure(f.sig) as oid from f
), checks(check_name, expected, actual) as (
  select 'info: server version', null, current_setting('server_version')
  union all select 'role: running as postgres (apply requires it)', 'postgres', current_user::text
  union all select 'server: PostgreSQL 16+', 'true', (current_setting('server_version_num')::int >= 160000)::text
  union all select 'history: table supabase_migrations.schema_migrations', 'true', (to_regclass('supabase_migrations.schema_migrations') is not null)::text
  union all select 'history: main is applied (newest main migration {LAST_MAIN} recorded)', '1',
      (select count(*) from supabase_migrations.schema_migrations where version = '{LAST_MAIN}')::text
  union all select 'history: main fix {AUTH_FIX} (inpatient role via auth.role()) recorded', '1',
      (select count(*) from supabase_migrations.schema_migrations where version = '{AUTH_FIX}')::text
  union all select 'history: batch 1 (20261030110000/111000/112000) recorded', '3',
      (select count(*) from supabase_migrations.schema_migrations where version in ({in_list(BATCH1_VERSIONS)}))::text
  union all select 'history: none of the 10 batch 2 versions recorded', '0',
      (select count(*) from supabase_migrations.schema_migrations where version in ({in_list(VERSIONS)}))::text
  union all select 'not yet applied: backup vetos_release.pr310_batch2_backup absent', 'true', (to_regclass('vetos_release.pr310_batch2_backup') is null)::text
  -- Every replaced function is exactly the repository version (anchored patches and full replaces both rely on it).
  union all select 'before apply: ' || fx.mig || ' ' || fx.sig || ' (md5, owner)', fx.md5_expected || ' owner=postgres',
      coalesce(md5(pg_get_functiondef(fx.oid)) || ' owner=' || (select pg_get_userbyid(proowner) from pg_proc where oid = fx.oid), 'missing')
    from fx
  union all select 'K08/K14: clinic_change_inpatient_condition already uses auth.role() (batch 1 + {AUTH_FIX})', 'true false',
      (position($m$coalesce(auth.role(), '')$m$ in pg_get_functiondef(to_regprocedure('public.clinic_change_inpatient_condition(uuid,text,text)'))) > 0)::text
      || ' ' || (position('request.jwt.claim.role' in pg_get_functiondef(to_regprocedure('public.clinic_change_inpatient_condition(uuid,text,text)'))) > 0)::text
  union all select 'new functions absent (12)', '0',
      (select count(*) from unnest(array[{in_list(sig for _, sig, _ in NEW)}]) s where to_regprocedure(s) is not null)::text
  union all select 'new tables absent (4)', '0',
      (select count(*) from unnest(array[{in_list(NEW_TABLES)}]) t where to_regclass('public.' || t) is not null)::text
  union all select 'new columns absent (3)', '0',
      (select count(*) from information_schema.columns where table_schema = 'public' and (table_name, column_name) in
        ({", ".join(f"({q(t)}, {q(c)})" for t, c, _ in NEW_COLUMNS)}))::text
  union all select 'new indexes absent (3)', '0',
      (select count(*) from unnest(array[{in_list(NEW_INDEXES)}]) i where to_regclass('public.' || i) is not null)::text
  union all select 'new triggers absent (7 on existing tables)', '0',
      (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid where c.relnamespace = 'public'::regnamespace
        and (c.relname, g.tgname) in ({", ".join(f"({q(t)}, {q(g)})" for _, t, g in NEW_TRIGGERS)}))::text
  union all select 'C05: trigger invoices.c05_invoice_campaign_code exists (recreated by apply)', '1',
      (select count(*) from pg_trigger where tgrelid = 'public.invoices'::regclass and tgname = 'c05_invoice_campaign_code')::text
  union all select 'J02: policy sale_payment_corrections_owner_read present, _finance_read absent', '1 0',
      (select count(*) from pg_policy where polrelid = 'public.sale_payment_corrections'::regclass and polname = 'sale_payment_corrections_owner_read')::text
      || ' ' || (select count(*) from pg_policy where polrelid = 'public.sale_payment_corrections'::regclass and polname = 'sale_payment_corrections_finance_read')::text
  union all select 'N01: constraint wholesale_operation_requests_kind_check exists', '1',
      (select count(*) from pg_constraint where conrelid = 'public.wholesale_operation_requests'::regclass and conname = 'wholesale_operation_requests_kind_check')::text
  union all select 'K14: no item uses tindakan_kategori Pet Hotel yet', '0',
      (select count(*) from public.items where tindakan_kategori = 'Pet Hotel')::text
  union all select 'info: items checks mentioning tindakan_kategori (K14 replaces them; rollback restores)', null,
      (select string_agg(conname, ', ' order by conname) from pg_constraint where conrelid = 'public.items'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%tindakan_kategori%')
  union all select 'N01/A01: activity_log_sources + capture_activity_log() exist', 'true',
      (to_regclass('public.activity_log_sources') is not null and to_regprocedure('public.capture_activity_log()') is not null)::text
  union all select 'schema clinic_private exists (P03 helpers)', 'true', (to_regnamespace('clinic_private') is not null)::text
  union all select 'helper functions used by batch 2 exist ({len(HELPERS)})', '{len(HELPERS)}',
      (select count(distinct proname) from pg_proc where pronamespace in ('public'::regnamespace, 'clinic_private'::regnamespace)
        and proname in ({in_list(HELPERS)}))::text
  union all select 'touched tables exist and are owned by postgres ({len(TOUCHED_TABLES)})', '{len(TOUCHED_TABLES)}',
      (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p')
        and relname in ({in_list(TOUCHED_TABLES)}) and pg_get_userbyid(relowner) = 'postgres')::text
)
{SUMMARY}"""


def readback_sql(post_md5, attrs):
    rows = REPLACED + NEW
    return f"""-- PR #310 batch 2 READBACK — READ ONLY. Generated by build-and-rehearse.py; do not edit by hand.
-- Run after apply.sql; select only the `with … select …` statement in the SQL editor.
-- Every row must show ok = true and the last row SUMMARY must say "0 failed".
begin read only;
with f(mig, sig, md5_expected, grants_expected) as (values
    {fn_values(rows, post_md5)}
), a(sig, attrs_expected) as (values
    {",\n    ".join(f"({q(sig)}, {q(attrs[sig])})" for _, sig, _ in rows)}
), fx as (
  select f.*, a.attrs_expected, to_regprocedure(f.sig) as oid from f join a using (sig)
), fn(name, def) as (
  select s, pg_get_functiondef(to_regprocedure(s)) from unnest(array[{in_list(sig for _, sig, _ in REPLACED)}]) s
), checks(check_name, expected, actual) as (
  select 'history: 10 batch 2 versions recorded', '10',
      (select count(*) from supabase_migrations.schema_migrations where version in ({in_list(VERSIONS)}))::text
  union all select 'history: batch 1 still recorded', '3',
      (select count(*) from supabase_migrations.schema_migrations where version in ({in_list(BATCH1_VERSIONS)}))::text
  union all select 'rollback backup: {len(REPLACED)} functions + {len(REPLACED)} ACLs saved', '{len(REPLACED)} {len(REPLACED)}',
      (select count(*) from vetos_release.pr310_batch2_backup where kind = 'function')::text || ' ' ||
      (select count(*) from vetos_release.pr310_batch2_backup where kind = 'acl')::text
  union all select 'rollback backup: trigger, policy, 2 constraints, seeded Pet Hotel item saved', '1 1 2 1',
      (select count(*) from vetos_release.pr310_batch2_backup where kind = 'trigger')::text || ' ' ||
      (select count(*) from vetos_release.pr310_batch2_backup where kind = 'policy')::text || ' ' ||
      (select count(*) from vetos_release.pr310_batch2_backup where kind = 'constraint')::text || ' ' ||
      (select count(*) from vetos_release.pr310_batch2_backup where kind = 'seeded_item')::text
  union all select 'rollback backup: not readable by authenticated', 'false', has_schema_privilege('authenticated', 'vetos_release', 'usage')::text
  -- Functions: exact definition (md5), SECURITY DEFINER / search_path / owner, grants.
  union all select 'md5: ' || fx.mig || ' ' || fx.sig, fx.md5_expected, coalesce(md5(pg_get_functiondef(fx.oid)), 'missing') from fx
  union all select 'definer/config/owner: ' || f.sig, f.attrs_expected, coalesce({ATTRS_ACTUAL}, 'missing') from fx f
  union all select 'grants: ' || f.sig, f.grants_expected,
      coalesce(case when f.grants_expected = '{UNCHANGED}' then
        case when (select proacl::text from pg_proc where oid = f.oid) is not distinct from
                  (select payload from vetos_release.pr310_batch2_backup where kind = 'acl' and name = f.sig)
             then '{UNCHANGED}' else (select coalesce(proacl::text, 'default') from pg_proc where oid = f.oid) end
        else {GRANTS_ACTUAL} end, 'missing') from fx f
  -- Content markers (explain an md5 mismatch) and dependencies between migrations.
  union all select 'P03: cashier Grup floor', 'true', (position('P03_GRUP_FLOOR' in (select def from fn where name like '%cashier_post_stock_atomic%')) > 0)::text
  union all select 'P03+C05 152000: clinic_post_invoice has price floor AND campaign_carrier_id', 'true true',
      (position('P03_PRICE_FLOOR' in (select def from fn where name like '%clinic_post_invoice%')) > 0)::text || ' ' ||
      (position('campaign_carrier_id' in (select def from fn where name like '%clinic_post_invoice%')) > 0)::text
  union all select 'P03: clinic_edit_invoice_core price floor', 'true', (position('P03_PRICE_FLOOR' in (select def from fn where name like '%clinic_edit_invoice_core%')) > 0)::text
  union all select 'J02: POS correction after shift (OWNER/FINANCE)', 'true', (position('J02_AFTER_SHIFT' in (select def from fn where name like '%correct_pos_sale_payment%')) > 0)::text
  union all select 'J02 111000: clinic correction journals protected', 'true', (position('clinic_payment_corrections' in (select def from fn where name like '%pos_sale_journal_protected%')) > 0)::text
  union all select 'N01: receipts/cancel count returned_ar', 'true true',
      (position('inv.returned_ar' in (select def from fn where name like '%receive_wholesale_payment%')) > 0)::text || ' ' ||
      (position('inv.returned_ar' in (select def from fn where name like '%cancel_wholesale_receipt%')) > 0)::text
  union all select 'N01: get_wholesale_operation / inventory_record_valuation know returns', 'true true',
      (position('return-void' in (select def from fn where name like '%get_wholesale_operation%')) > 0)::text || ' ' ||
      (position('wholesale-return-void' in (select def from fn where name like '%inventory_record_valuation%')) > 0)::text
  union all select 'K08: direct admission refuses active invoice', 'true',
      (position('tagihan kunjungan ini belum lunas' in (select def from fn where name like '%clinic_admit_inpatient(uuid,text,text)%')) > 0)::text
  union all select 'K14: pet hotel check-in + tariff in discharge', 'true true',
      (position('pet_hotel_check_in' in (select def from fn where name like '%clinic_admit_inpatient_typed%')) > 0)::text || ' ' ||
      (position($m$tindakan_kategori='Pet Hotel'$m$ in (select def from fn where name like '%clinic_change_inpatient_condition%')) > 0)::text
  union all select 'K14 keeps batch 1 K08: re-discharge bills every period (v_billed_days)', 'true',
      (position('v_billed_days' in (select def from fn where name like '%clinic_change_inpatient_condition%')) > 0)::text
  union all select 'K14 keeps {AUTH_FIX}: clinic_change_inpatient_condition uses auth.role()', 'true',
      (position($m$coalesce(auth.role(), '')$m$ in (select def from fn where name like '%clinic_change_inpatient_condition%')) > 0)::text
  union all select 'K08/K14: legacy request.jwt.claim.role absent in the 5 inpatient functions', '0',
      (select count(*) from fn where (name like '%inpatient%') and position('request.jwt.claim.role' in def) > 0)::text
  union all select 'C05 152000 patches 150000: guard uses voucher_wajib_lewat_kampanye AND campaign_carrier_id', 'true true',
      (position('voucher_wajib_lewat_kampanye' in (select def from fn where name like '%guard_campaign_code_use%')) > 0)::text || ' ' ||
      (position('campaign_carrier_id' in (select def from fn where name like '%guard_campaign_code_use%')) > 0)::text
  union all select 'M04: ROUND_LINE_RUPIAH_V1 policy', 'true',
      (position('ROUND_LINE_RUPIAH_V1' in (select def from fn where name like '%prepare_accurate_initial_stock%')) > 0)::text
  -- Tables, RLS, policies, grants.
  union all select 'table ' || t || ': exists, RLS on', 'true true',
      (to_regclass('public.' || t) is not null)::text || ' ' ||
      coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || t))::text, 'missing')
    from unnest(array[{in_list(NEW_TABLES)}]) t
  union all select 'table ' || t || ': authenticated select/insert, anon select, service_role select', e,
      has_table_privilege('authenticated', 'public.' || t, 'select')::text || ' ' || has_table_privilege('authenticated', 'public.' || t, 'insert')::text
      || ' ' || has_table_privilege('anon', 'public.' || t, 'select')::text || ' ' || has_table_privilege('service_role', 'public.' || t, 'select')::text
    from (values ('clinic_payment_corrections', 'true false false false'), ('clinic_payment_correction_requests', 'false false false false'),
                 ('wholesale_returns', 'true false false false'), ('wholesale_return_items', 'true false false false')) v(t, e)
  union all select 'policies: J02 clinic finance read, N01 two read, POS finance read (owner_read gone)', '1 1 1 1 0',
      (select count(*) from pg_policy where polrelid = 'public.clinic_payment_corrections'::regclass and polname = 'clinic_payment_corrections_finance_read')::text
      || ' ' || (select count(*) from pg_policy where polrelid = 'public.wholesale_returns'::regclass and polname = 'wholesale_returns_read')::text
      || ' ' || (select count(*) from pg_policy where polrelid = 'public.wholesale_return_items'::regclass and polname = 'wholesale_return_items_read')::text
      || ' ' || (select count(*) from pg_policy where polrelid = 'public.sale_payment_corrections'::regclass and polname = 'sale_payment_corrections_finance_read')::text
      || ' ' || (select count(*) from pg_policy where polrelid = 'public.sale_payment_corrections'::regclass and polname = 'sale_payment_corrections_owner_read')::text
  -- Columns, indexes, constraints, seeded master data.
  union all select 'column ' || t || '.' || c, e,
      (select format_type(atttypid, atttypmod) from pg_attribute where attrelid = ('public.' || t)::regclass and attname = c and not attisdropped)
    from (values {", ".join(f"({q(t)}, {q(c)}, {q(e)})" for t, c, e in NEW_COLUMNS)}) v(t, c, e)
  union all select 'index ' || i, 'true', (to_regclass('public.' || i) is not null)::text from unnest(array[{in_list(NEW_INDEXES)}]) i
  union all select 'N01: request kinds include return/return-void', 'true',
      (select pg_get_constraintdef(oid) like '%return-void%' from pg_constraint
        where conrelid = 'public.wholesale_operation_requests'::regclass and conname = 'wholesale_operation_requests_kind_check')::text
  union all select 'K14: items tindakan_kategori check allows Pet Hotel', 'true',
      (select pg_get_constraintdef(oid) like '%Pet Hotel%' from pg_constraint
        where conrelid = 'public.items'::regclass and conname = 'items_tindakan_kategori_check')::text
  union all select 'K14: Pet Hotel service item exists (price 0 = not set yet)', 'true',
      exists(select 1 from public.items where tindakan_kategori = 'Pet Hotel')::text
  -- Triggers.
  union all select 'trigger ' || t || '.' || g || ' enabled', 'true',
      exists(select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass and tgname = g and tgenabled <> 'D')::text
    from (values {", ".join(f"({q(t)}, {q(g)})" for _, t, g in NEW_TRIGGERS)},
      ('wholesale_returns', 'wholesale_return_record_guard'), ('wholesale_return_items', 'wholesale_return_item_guard'),
      ('wholesale_returns', 'a01_activity_change'), ('wholesale_returns', 'a01_activity_delete'),
      ('wholesale_return_items', 'a01_activity_change'), ('wholesale_return_items', 'a01_activity_delete'),
      ('invoices', 'c05_invoice_campaign_code')) v(t, g)
  union all select 'C05: invoices.c05_invoice_campaign_code fires on campaign_carrier_id', 'true',
      (select pg_get_triggerdef(oid) like '%campaign_carrier_id%' from pg_trigger
        where tgrelid = 'public.invoices'::regclass and tgname = 'c05_invoice_campaign_code')::text
  union all select 'N01/A01: wholesale_returns + wholesale_return_items registered in activity log', '2',
      (select count(*) from public.activity_log_sources where entity in ('wholesale_returns', 'wholesale_return_items'))::text
)
{SUMMARY}"""


# ───────────────────────────── rehearsal ─────────────────────────────
b1_src = (BATCH1 / "build-and-rehearse.py").read_text()
SHIM = b1_src.split('SHIM = """')[1].split('"""')[0]
SUPABASE_DEFAULTS = """alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
""" + "".join(  # Production functions may still carry a default service_role grant that batch 2 revokes; rollback must restore it.
    f"grant execute on function {sig} to service_role;\n" for _, sig, grants in REPLACED if grants != UNCHANGED)
FUNCS_SQL = "select s, coalesce(md5(pg_get_functiondef(to_regprocedure(s))), 'missing') from unnest(array[@SIGS@]) s;"
ATTRS_SQL = ("select s, 'definer=' || p.prosecdef::text || ' config=' || coalesce(p.proconfig::text, '{}') || ' owner=' || pg_get_userbyid(p.proowner)"
             " from unnest(array[@SIGS@]) s join pg_proc p on p.oid = to_regprocedure(s);")
# Whole-catalog fingerprint of public/clinic_private/vetos_release plus the data rows batch 2 touches.
STATE = """
select 'fn|' || p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid)) || '|' || pg_get_userbyid(p.proowner) || '|'
  || coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by 1)
     from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a), '') || '|' || coalesce(obj_description(p.oid, 'pg_proc'), '')
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'clinic_private'::regnamespace) and p.prokind in ('f', 'p')
union all select 'rel|' || c.oid::regclass::text || '|' || c.relkind::text || '|' || c.relrowsecurity || '|' || coalesce(c.relacl::text, '')
  || '|' || coalesce(obj_description(c.oid, 'pg_class'), '')
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'clinic_private'::regnamespace) and c.relkind in ('r', 'p', 'v', 'm', 'i', 'S')
union all select 'col|' || a.attrelid::regclass::text || '.' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull
  || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || '|' || coalesce(col_description(a.attrelid, a.attnum), '')
  from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
union all select 'con|' || conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid)
  from pg_constraint where connamespace = 'public'::regnamespace
union all select 'trg|' || tgrelid::regclass::text || '|' || tgname || '|' || pg_get_triggerdef(oid) || '|' || tgenabled::text
  from pg_trigger where not tgisinternal
union all select 'pol|' || polrelid::regclass::text || '|' || polname || '|' || polcmd::text || '|' || polroles::regrole[]::text || '|'
  || coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), '') from pg_policy
union all select 'idx|' || pg_get_indexdef(indexrelid) from pg_index i join pg_class c on c.oid = i.indrelid
  where c.relnamespace = 'public'::regnamespace
union all select 'src|' || entity from public.activity_log_sources
union all select 'items|' || count(*) || '|' || count(*) filter (where tindakan_kategori = 'Pet Hotel') from public.items
union all select 'hist|' || version from supabase_migrations.schema_migrations
union all select 'nsp|' || nspname from pg_namespace where nspname in ('vetos_release', 'clinic_private')
union all select 'rel|' || c.oid::regclass::text from pg_class c where c.relnamespace = to_regnamespace('vetos_release')
order by 1;"""
SUITES = ["p03_price_floor.sql", "pos_payment_method_corrections.sql", "clinic_payment_method_corrections.sql",
          "wholesale_returns.sql", "clinic_inpatient_discharge.sql", "inpatient_continuation_pet_hotel.sql",
          "c05_campaign_codes.sql", "c05_voucher_lewat_kampanye.sql", "c05_q01_followup.sql",
          "i09_riwayat_induk_racikan.sql", "accurate_inventory_line_rupiah_rounding.sql", "activity_audit_coverage.sql"]


def checked(db, name, text):
    out = db.sql(text)
    rows = [r.split("|") for r in out.splitlines() if r.strip()]
    summary = [r for r in rows if r[0] == "SUMMARY"]
    bad = [r for r in rows if r[0] != "SUMMARY" and r[-1] == "f"]
    if bad or not summary or summary[0][2] != "0 failed":
        raise RuntimeError(f"{name} not ok: {bad or summary}")
    print(f"{name}: {len(rows) - 1} checks, 0 failed", flush=True)


def state(db):
    return db.sql(STATE).splitlines()


def same(label, before, after):
    if before != after:
        diff = "\n".join(list(difflib.unified_diff(before, after, lineterm="", n=0))[:60])
        raise SystemExit(f"{label}: catalog differs\n{diff}")


def pairs(db, template, sigs):
    return dict(r.split("|", 1) for r in db.sql(template.replace("@SIGS@", in_list(sigs))).splitlines())


with NativePostgres(BIN) as db:
    db.sql(SHIM)
    batch1 = set(BATCH1_VERSIONS)
    rest = [m for m in sorted((ROOT / "supabase/migrations").glob("*.sql"))
            if m.name not in MIGRATIONS and m.name[:14] not in batch1]
    for m in rest:
        if m.name.startswith("0068"):
            db.sql("insert into coa_accounts(code,name,type,normal_balance) values('1101','Test cash','ASET','D'),('1102','Test bank','ASET','D') on conflict do nothing;")
        try:
            db.sql("begin;\n" + m.read_text() + "\ncommit;")
        except RuntimeError as error:
            raise RuntimeError(m.name + ": " + str(error)) from error
        db.sql(f"insert into supabase_migrations.schema_migrations(version, name) values ('{m.name.split('_')[0]}', '{m.stem}') on conflict do nothing;")
    assert rest[-1].name.startswith(LAST_MAIN), rest[-1].name
    print(f"baseline: {len(rest)} main migrations applied ({db.sql('show server_version')})", flush=True)
    checked(db, "batch 1 preflight", (BATCH1 / "preflight.sql").read_text())
    db.sql((BATCH1 / "apply.sql").read_text())
    checked(db, "batch 1 readback", (BATCH1 / "readback.sql").read_text())
    db.sql(SUPABASE_DEFAULTS)
    print("Supabase-like default privileges set (new functions/tables granted to anon, authenticated, service_role);"
          " service_role granted on the 13 replaced functions whose grants batch 2 resets", flush=True)

    pre_md5 = pairs(db, FUNCS_SQL, [s for _, s, _ in REPLACED])
    assert "missing" not in pre_md5.values(), pre_md5
    preflight = preflight_sql(pre_md5)
    (HERE / "preflight.sql").write_text(preflight)
    try:
        # Simulate "batch 1 missing" by hiding one batch 1 history row inside a transaction that is rolled back.
        db.sql("begin;\ndelete from supabase_migrations.schema_migrations where version = '20261030112000';\n"
               + apply_sql.replace("begin;\n", "", 1))
        raise SystemExit("apply without batch 1 must be refused")
    except RuntimeError as error:
        assert "PR310B2_BATCH1_MISSING" in str(error), error
    base = state(db)
    assert db.sql("select count(*) from supabase_migrations.schema_migrations where version = '20261030112000'") == "1"
    print("apply without batch 1: refused with PR310B2_BATCH1_MISSING", flush=True)
    checked(db, "preflight", preflight)
    db.sql(apply_sql)
    post_md5 = pairs(db, FUNCS_SQL, [s for _, s, _ in REPLACED + NEW])
    attrs = pairs(db, ATTRS_SQL, [s for _, s, _ in REPLACED + NEW])
    readback = readback_sql(post_md5, attrs)
    (HERE / "readback.sql").write_text(readback)
    checked(db, "readback", readback)
    checked(db, "batch 1 readback after batch 2", (BATCH1 / "readback.sql").read_text())
    after = state(db)
    try:
        db.sql(apply_sql)
        raise SystemExit("second apply must be refused")
    except RuntimeError as error:
        assert "PR310B2_ALREADY_APPLIED" in str(error), error
    same("refused re-apply", after, state(db))
    print("apply again: refused with PR310B2_ALREADY_APPLIED, nothing changed", flush=True)
    db.sql((HERE / "rollback.sql").read_text())
    same("rollback", base, state(db))
    print(f"rollback: catalog fingerprint ({len(base)} lines: functions+ACLs, tables, columns, constraints, triggers, policies,"
          " indexes, log sources, items, history, schemas) identical to before apply", flush=True)
    checked(db, "preflight after rollback", preflight)
    db.sql(apply_sql)
    checked(db, "readback after re-apply", readback)
    same("re-apply", after, state(db))
    print("re-apply: catalog fingerprint identical to first apply", flush=True)
    for suite in SUITES:
        clone = "b2_" + suite.removesuffix(".sql")
        db.sql(f"create database {clone} template postgres;")
        try:
            db.sql(f"\\connect {clone}\n" + (ROOT / "supabase/tests" / suite).read_text())
        finally:
            db.sql(f"drop database {clone} with (force);")
        print("PASS", suite, flush=True)
    rollback_sql = (HERE / "rollback.sql").read_text()
    # Once a batch 2 feature holds a record, rollback refuses instead of dropping it (checked on a disposable copy).
    db.sql("create database b2_has_data template postgres;")
    try:
        db.sql("\\connect b2_has_data\ninsert into public.items(code, name, unit, item_type, is_active, tindakan_kategori, sell_price)"
               " values ('JASA-PET-HOTEL-VIP', 'Pet Hotel VIP', 'hari', 'Jasa', true, 'Pet Hotel', 1);")
        before = db.sql("\\connect b2_has_data\n" + STATE)
        try:
            db.sql("\\connect b2_has_data\n" + rollback_sql)
            raise SystemExit("rollback with batch 2 data must be refused")
        except RuntimeError as error:
            assert "PR310B2_ROLLBACK_HAS_DATA" in str(error), error
        assert db.sql("\\connect b2_has_data\n" + STATE) == before, "refused rollback changed state"
    finally:
        db.sql("drop database b2_has_data with (force);")
    print("rollback with a batch 2 record present: refused with PR310B2_ROLLBACK_HAS_DATA, nothing changed", flush=True)
    for name, text in [("preflight.sql", preflight), ("apply.sql", apply_sql), ("readback.sql", readback), ("rollback.sql", rollback_sql)]:
        print(f"{name} sha256 {sha(text)}", flush=True)
    for m in MIGRATIONS:
        print(f"{m} sha256 {sha(sources[m])}", flush=True)
