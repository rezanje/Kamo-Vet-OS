"""Generate the one-transaction KAMO transaction/stock reset script.

usage: gen_reset.py MODE OUT.sql   (MODE = DRYRUN | EXECUTE)

DRYRUN runs every step and every verification, then raises KAMO_RESET_DRYRUN_OK so the
whole transaction rolls back. EXECUTE commits only if every verification passes.
Guards stay ENABLED. Row-level BEFORE DELETE guard functions attached to reset tables get,
for the lifetime of this one uncommitted transaction only, a first line that lets DELETE
through for the reset tables; their exact original definition is re-created before the end
and its md5 is checked. Other sessions never see the patched definition (uncommitted catalog).
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scope import RESET, RESET_SIDE, KEEP

mode, out = sys.argv[1], sys.argv[2]
assert mode in ('DRYRUN', 'EXECUTE')

def arr(xs):
    return "array[" + ",".join("'" + x + "'" for x in xs) + "]::text[]"

ALL_PUBLIC = sorted(RESET + KEEP)
SQL = r"""
do $kamo_reset$
declare
 v_mode text := '__MODE__';
 v_reset text[] := __RESET__;
 v_side text[] := __SIDE__;
 v_all text[] := __ALL__;
 v_keep text[] := __KEEP__;
 v_now timestamptz := clock_timestamp();
 v_tables text[]; v_remaining text[]; v_ready text[]; v_t text; v_n bigint; v_counts jsonb := '{}';
 v_fp_before jsonb; v_fp_after jsonb; v_al_max bigint; v_al_n bigint; v_al_h text; v_al_h2 text; v_al_n2 bigint;
 v_patch record; v_def text; v_new text; v_cnt int := 0; v_bad text; v_manifest jsonb; v_receipt jsonb;
 v_expense_ids uuid[]; v_att jsonb; v_cust jsonb; v_pos int; v_idx int;
begin
 perform set_config('lock_timeout','20s',true);
 -- 0. Scope: the table set must equal the reviewed classification exactly.
 select array_agg(c.relname::text order by c.relname) into v_tables from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p');
 if v_tables is distinct from v_all then
  raise exception 'KAMO_RESET_ABORT: daftar tabel berubah sejak manifest ditinjau (baru: %, hilang: %)',
   (select array_agg(x) from unnest(v_tables) x where x<>all(v_all)), (select array_agg(x) from unnest(v_all) x where x<>all(v_tables));
 end if;

 -- 1. Freeze writes for the whole reset (reads stay possible). Lock waits fail fast.
 lock table auth.users in share mode;
 execute (select 'lock table '||string_agg(format('%I.%I',n.nspname,c.relname),',')||' in exclusive mode'
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and n.nspname in ('public','clinic_private','kamo_import','kamo_maintenance','arsip_20260801') and has_table_privilege(c.oid,'UPDATE'));
 -- Tables this role may only read (import staging) are read-locked; their fingerprint is verified below.
 execute coalesce((select 'lock table '||string_agg(format('%I.%I',n.nspname,c.relname),',')||' in access share mode'
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and n.nspname in ('public','clinic_private','kamo_import','kamo_maintenance','arsip_20260801') and not has_table_privilege(c.oid,'UPDATE')),'select 1');

 -- 2. Fingerprints of everything that must stay identical.
 create temp table kr_fp(tbl text primary key, n bigint, h text) on commit drop;
 select coalesce(array_agg(id),'{}') into v_expense_ids from public.expenses;
 for v_t in select format('%I.%I',n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where c.relkind in ('r','p') and ((n.nspname='public' and c.relname<>all(v_reset) and c.relname not in ('activity_log','customers','document_attachments'))
     or n.nspname in ('kamo_import','kamo_maintenance','arsip_20260801')
     or (n.nspname='clinic_private' and format('%I.%I',n.nspname,c.relname)<>all(v_side))) loop
  execute format('insert into kr_fp select %L,count(*),md5(coalesce(string_agg(h,'','' order by h),'''')) from (select md5(to_jsonb(t)::text) h from %s t) s',v_t,v_t);
 end loop;
 insert into kr_fp select 'public.customers*',count(*),md5(coalesce(string_agg(h,',' order by h),'')) from
  (select md5((to_jsonb(t)-array['points','total_spending','tier','tier_downgraded_at'])::text) h from public.customers t) s;
 insert into kr_fp select 'public.document_attachments*',count(*),md5(coalesce(string_agg(h,',' order by h),'')) from
  (select md5(to_jsonb(t)::text) h from public.document_attachments t where t.modul<>'pengeluaran') s;
 insert into kr_fp select 'auth.users.id',count(*),md5(coalesce(string_agg(id::text,',' order by id),'')) from auth.users;
 insert into kr_fp select 'storage.objects',count(*),md5(coalesce(string_agg(bucket_id||'/'||name,',' order by bucket_id,name),'')) from storage.objects;
 select max(id),count(*) into v_al_max,v_al_n from public.activity_log;
 select md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by id),'')) into v_al_h from public.activity_log t;
 v_fp_before := __SCHEMA_FP__;

 -- 3. Manifest (what is about to be emptied) recorded in the receipt.
 v_manifest := '{}';
 foreach v_t in array v_reset loop
  execute format('select count(*) from public.%I',v_t) into v_n; v_manifest := v_manifest||jsonb_build_object(v_t,v_n);
 end loop;
 foreach v_t in array v_side loop
  execute format('select count(*) from %s',v_t) into v_n; v_manifest := v_manifest||jsonb_build_object(v_t,v_n);
 end loop;
 select jsonb_agg(to_jsonb(t)) into v_att from public.document_attachments t where t.modul='pengeluaran';
 select jsonb_agg(jsonb_build_object('id',id,'points',points,'total_spending',total_spending,'tier',tier,'tier_downgraded_at',tier_downgraded_at))
  into v_cust from public.customers where points<>0 or total_spending<>0 or tier is distinct from 'New' or tier_downgraded_at is not null;

 -- 4. Scoped, transaction-local delete permission on guard functions of reset tables.
 create temp table kr_patch(oid oid primary key, fn text, def text, md5_orig text) on commit drop;
 insert into kr_patch select distinct p.oid, p.oid::regprocedure::text, pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid))
  from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=g.tgfoid
  where not g.tgisinternal and g.tgenabled<>'D' and (g.tgtype & 1)=1 and (g.tgtype & 2)=2 and (g.tgtype & 8)=8
   and ((n.nspname='public' and c.relname=any(v_reset)) or format('%I.%I',n.nspname,c.relname)=any(v_side))
   and p.proname<>'capture_activity_log' and (__PATCH_ONLY__ is null or p.proname=any(__PATCH_ONLY__));
 for v_patch in select * from kr_patch order by fn loop
  v_pos := strpos(v_patch.def, 'AS $function$') + 13;
  v_idx := regexp_instr(substr(v_patch.def, v_pos), '\mbegin\M', 1, 1, 0, 'i');
  if v_pos<=13 or v_idx=0 then raise exception 'KAMO_RESET_ABORT: badan fungsi % tidak dikenali',v_patch.fn; end if;
  v_new := left(v_patch.def, v_pos+v_idx-2)||'begin if tg_op=''DELETE'' and tg_table_name=any('||__RESET_LIT__||') then return old; end if; '||substr(v_patch.def, v_pos+v_idx+4);
  if v_new=v_patch.def then raise exception 'KAMO_RESET_ABORT: tidak dapat menyiapkan izin hapus untuk %',v_patch.fn; end if;
  execute v_new; v_cnt := v_cnt+1;
 end loop;

 -- 5. Delete reset tables, children before parents (FKs, triggers and audit stay active).
 v_remaining := v_reset;
 while cardinality(v_remaining)>0 loop
  select array_agg(t order by t) into v_ready from unnest(v_remaining) t where not exists(
   select 1 from pg_constraint c where c.contype='f' and c.confrelid=format('public.%I',t)::regclass
    and c.conrelid<>c.confrelid and c.conrelid in (select format('public.%I',x)::regclass from unnest(v_remaining) x));
  if v_ready is null then
   -- An empty table in a reference cycle can be removed from the ordering safely.
   v_ready := '{}';
   foreach v_t in array v_remaining loop
    execute format('select count(*) from public.%I',v_t) into v_n;
    if v_n=0 then v_ready := v_ready||v_t; end if;
   end loop;
   if cardinality(v_ready)=0 then raise exception 'KAMO_RESET_ABORT: ketergantungan melingkar %',v_remaining; end if;
  end if;
  foreach v_t in array v_ready loop
   execute format('delete from public.%I',v_t); get diagnostics v_n=row_count;
   v_counts := v_counts||jsonb_build_object(v_t,v_n);
  end loop;
  select coalesce(array_agg(t),'{}') into v_remaining from unnest(v_remaining) t where t<>all(v_ready);
 end loop;
 foreach v_t in array v_side loop
  execute format('delete from %s',v_t); get diagnostics v_n=row_count; v_counts := v_counts||jsonb_build_object(v_t,v_n);
 end loop;

 -- 6. Derived effects of the removed transactions.
 update public.customers set points=0,total_spending=0,tier='New',tier_downgraded_at=null
  where points<>0 or total_spending<>0 or tier is distinct from 'New' or tier_downgraded_at is not null;
 get diagnostics v_n=row_count; v_counts := v_counts||jsonb_build_object('customers(poin/belanja/tier)',v_n);
 delete from public.document_attachments where modul='pengeluaran';
 get diagnostics v_n=row_count; v_counts := v_counts||jsonb_build_object('document_attachments(bukti pengeluaran)',v_n);

 -- 7. Re-create the exact original guard definitions.
 for v_patch in select * from kr_patch order by fn loop
  execute v_patch.def;
  if md5(pg_get_functiondef(v_patch.oid)) is distinct from v_patch.md5_orig then
   raise exception 'KAMO_RESET_ABORT: definisi pengaman % tidak kembali identik',v_patch.fn; end if;
 end loop;

 -- 8. Verification. Any failure raises and rolls everything back.
 foreach v_t in array v_reset loop
  execute format('select count(*) from public.%I',v_t) into v_n;
  if v_n<>0 then raise exception 'KAMO_RESET_VERIFY: % masih berisi % baris',v_t,v_n; end if;
 end loop;
 foreach v_t in array v_side loop
  execute format('select count(*) from %s',v_t) into v_n;
  if v_n<>0 then raise exception 'KAMO_RESET_VERIFY: % masih berisi % baris',v_t,v_n; end if;
 end loop;
 for v_t in select tbl from kr_fp loop
  if v_t='public.customers*' then
   select md5(coalesce(string_agg(h,',' order by h),'')) into v_bad from (select md5((to_jsonb(t)-array['points','total_spending','tier','tier_downgraded_at'])::text) h from public.customers t) s;
  elsif v_t='public.document_attachments*' then
   select md5(coalesce(string_agg(h,',' order by h),'')) into v_bad from (select md5(to_jsonb(t)::text) h from public.document_attachments t) s;
  elsif v_t='auth.users.id' then
   select md5(coalesce(string_agg(id::text,',' order by id),'')) into v_bad from auth.users;
  elsif v_t='storage.objects' then
   select md5(coalesce(string_agg(bucket_id||'/'||name,',' order by bucket_id,name),'')) into v_bad from storage.objects;
  else
   execute format('select md5(coalesce(string_agg(h,'','' order by h),'''')) from (select md5(to_jsonb(t)::text) h from %s t) s',v_t) into v_bad;
  end if;
  if v_bad is distinct from (select h from kr_fp where tbl=v_t) then raise exception 'KAMO_RESET_VERIFY: data yang dilindungi berubah: %',v_t; end if;
 end loop;
 if exists(select 1 from public.customers where points<>0 or total_spending<>0 or tier is distinct from 'New' or tier_downgraded_at is not null) then
  raise exception 'KAMO_RESET_VERIFY: poin/belanja pelanggan belum bersih'; end if;
 select md5(coalesce(string_agg(md5(to_jsonb(t)::text),',' order by id),'')),count(*) into v_al_h2,v_al_n2 from public.activity_log t where id<=v_al_max;
 if v_al_h2 is distinct from v_al_h or v_al_n2<>v_al_n then raise exception 'KAMO_RESET_VERIFY: log aktivitas lama berubah'; end if;
 v_fp_after := __SCHEMA_FP__;
 if v_fp_after is distinct from v_fp_before then raise exception 'KAMO_RESET_VERIFY: struktur/pengaman/RLS berubah'; end if;
 if exists(select 1 from pg_trigger g join pg_class c on c.oid=g.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','clinic_private','kamo_import') and not g.tgisinternal and g.tgenabled<>'O') then
  raise exception 'KAMO_RESET_VERIFY: ada trigger yang tidak aktif'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity) then
  raise exception 'KAMO_RESET_VERIFY: ada tabel tanpa RLS'; end if;

 v_receipt := jsonb_build_object('mode',v_mode,'started_at',v_now,'finished_at',clock_timestamp(),'database',current_database(),
  'manifest_before',v_manifest,'deleted',v_counts,'guards_scoped',v_cnt,'protected_tables_checked',(select count(*) from kr_fp),
  'protected_fingerprint',(select md5(string_agg(tbl||':'||n||':'||h,',' order by tbl)) from kr_fp),
  'activity_log_preserved_rows',v_al_n,'activity_log_rows_added',(select count(*) from public.activity_log where id>v_al_max),
  'customer_derived_before',coalesce(v_cust,'[]'),'expense_attachments_removed',coalesce(v_att,'[]'),
  'schema_fingerprint',md5(v_fp_before::text));
 if v_mode='DRYRUN' then raise exception 'KAMO_RESET_DRYRUN_OK %',v_receipt::text; end if;
 create table if not exists kamo_maintenance.transaction_reset_runs(id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),receipt jsonb not null);
 insert into kamo_maintenance.transaction_reset_runs(receipt) values(v_receipt);
end $kamo_reset$;
"""

SCHEMA_FP = r"""(select jsonb_object_agg(k,h) from (
 select 'col:'||c.table_schema||'.'||c.table_name||'.'||c.column_name k, md5(c.data_type||'|'||c.udt_name||'|'||c.is_nullable||'|'||coalesce(c.column_default,'')) h from information_schema.columns c where c.table_schema in ('public','clinic_private','kamo_import','private')
 union all select 'con:'||n.nspname||'.'||t.relname||'.'||x.conname, md5(pg_get_constraintdef(x.oid)) from pg_constraint x join pg_class t on t.oid=x.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname in ('public','clinic_private','kamo_import','private')
 union all select 'trg:'||n.nspname||'.'||t.relname||'.'||g.tgname, md5(pg_get_triggerdef(g.oid)||g.tgenabled::text) from pg_trigger g join pg_class t on t.oid=g.tgrelid join pg_namespace n on n.oid=t.relnamespace where not g.tgisinternal and n.nspname in ('public','clinic_private','kamo_import','private')
 union all select 'fn:'||p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private','kamo_import','private') and p.prokind in ('f','p')
 union all select 'rls:'||n.nspname||'.'||t.relname, md5(t.relrowsecurity::text||t.relforcerowsecurity::text) from pg_class t join pg_namespace n on n.oid=t.relnamespace where t.relkind='r' and n.nspname in ('public','clinic_private','kamo_import','private')
 union all select 'pol:'||schemaname||'.'||tablename||'.'||policyname, md5(coalesce(qual,'')||coalesce(with_check,'')||cmd||array_to_string(roles,',')) from pg_policies where schemaname in ('public','clinic_private','kamo_import','private')
) s)"""

reset_lit = "array[" + ",".join("'" + x + "'" for x in RESET) + "]"
sql = (SQL.replace('__MODE__', mode).replace('__RESET__', arr(RESET)).replace('__SIDE__', arr(RESET_SIDE))
       .replace('__ALL__', arr(ALL_PUBLIC)).replace('__KEEP__', arr(KEEP)).replace('__SCHEMA_FP__', SCHEMA_FP)
       .replace('__RESET_LIT__', "'" + reset_lit.replace("'", "''") + "'"))
# The ten guards that blocked the reset on the replica (find_needed.sh). Only these get the scoped permission.
NEEDED='guard_accurate_inventory_accounting,guard_completed_opname_counts,guard_po_receipt_closure_immutable,guard_purchase_receipt_cancellation_immutable,pos_sale_allocation_immutable,sales_allocations_immutable,guard_cancelled_opname_children,unit_posted_sale_source_immutable,guard_posted_sale_movement,guard_opening_invoice'
po=os.environ.get('PATCH_ONLY', NEEDED)
sql=sql.replace('__PATCH_ONLY__', 'null::text[]' if po is None else arr([x for x in po.split(',') if x]))
open(out, 'w').write(sql)
print('written', out, len(sql))
