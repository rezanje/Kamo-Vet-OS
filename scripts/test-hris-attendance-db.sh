#!/usr/bin/env bash
# Disposable LOCAL PostgreSQL only: does not read Supabase credentials.
set -euo pipefail
cd "$(dirname "$0")/.."
dkr() { env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"; }
hris_test_container=$(dkr run --rm -d --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16)
hris_test_logs=$(mktemp -d)
trap 'dkr rm -f "$hris_test_container" >/dev/null 2>&1 || true; rm -rf "$hris_test_logs"' EXIT
for attempt in $(seq 1 30); do
 if dkr exec "$hris_test_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
 sleep 1
done
python3 - <<'PY' | dkr exec -i "$hris_test_container" psql -U postgres -v ON_ERROR_STOP=1 > "$hris_test_logs/bootstrap.log" 2>&1
from pathlib import Path
print(Path('supabase/tests/hris_attendance_fixture.sql').read_text())
for migration in ['0001_core','0002_rls','0004_perf_security_fixes','0016_hris','0017_payroll','0018_attendance']:
 print(Path(f'supabase/migrations/{migration}.sql').read_text())
print('alter table employees add column profile_id uuid references profiles(id);')
print(Path('supabase/migrations/0090_payroll_rincian.sql').read_text())
print('alter table branches add column lat numeric, add column lng numeric, add column radius_m integer not null default 500;')
print(Path('supabase/migrations/0135_employee_branch_assignments.sql').read_text())
# Same self-role guard from the existing production migration; no clinical tables needed.
source=Path('supabase/migrations/20260924140000_official_compound_catalog.sql').read_text()
a=source.index('create function public.prevent_self_role_change()')
b=source.index('-- The historic clinical RLS',a)
print(source[a:b])
print('grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid() to authenticated; grant all on all tables in schema public to authenticated;')
print(Path('supabase/migrations/20261001090000_attendance_sessions.sql').read_text())
PY
dkr cp supabase/tests "$hris_test_container:/tests"
hris_suite_failed=0
for hris_suite in sessions json_claims final_resolution legacy_correction; do
 if dkr exec -i -w /tests "$hris_test_container" psql -U postgres -v ON_ERROR_STOP=1 < "supabase/tests/hris_attendance_$hris_suite.sql" > "$hris_test_logs/$hris_suite.log" 2>&1; then
  printf 'PASS: local PostgreSQL %s checks\n' "$hris_suite"
 else cat "$hris_test_logs/$hris_suite.log"; hris_suite_failed=1; fi
done
[ "$hris_suite_failed" = 0 ] || exit 1
# Persist fictional concurrency fixtures only in this disposable database.
dkr exec -i "$hris_test_container" psql -U postgres -v ON_ERROR_STOP=1 > "$hris_test_logs/concurrency-seed.log" 2>&1 <<'SQL'
insert into auth.users(id) values ('80000000-0000-0000-0000-000000000001');
insert into branches(id,code,name,type) values('80000000-0000-0000-0000-000000000002','CONC-FIC','Fiction concurrency','KLINIK');
insert into employees(id,nama,profile_id,branch_id) values('80000000-0000-0000-0000-000000000003','Fiction race','80000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000002');
insert into employee_branch_assignments(employee_id,branch_id,effective_date) values('80000000-0000-0000-0000-000000000003','80000000-0000-0000-0000-000000000002','2026-01-01');
SQL
hris_race() {
 local action="$1" index="$2"
 dkr exec -i "$hris_test_container" psql -U postgres -v ON_ERROR_STOP=1 > "$hris_test_logs/$action-$index.log" 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','80000000-0000-0000-0000-000000000001',true);
select public.hris_clock_attendance('$action','80000000-0000-0000-0000-000000000002',null,null);
select pg_sleep(1);
commit;
SQL
}
for action in in out; do
 hris_race "$action" 1 & hris_job_one=$!
 hris_race "$action" 2 & hris_job_two=$!
 hris_code_one=0; wait "$hris_job_one" || hris_code_one=$?
 hris_code_two=0; wait "$hris_job_two" || hris_code_two=$?
 if (( (hris_code_one == 0 && hris_code_two != 0) || (hris_code_two == 0 && hris_code_one != 0) )); then
  printf 'PASS: concurrent clock %s accepts exactly one session transition\n' "$action"
 else cat "$hris_test_logs/$action-1.log" "$hris_test_logs/$action-2.log"; exit 1; fi
done
hris_rows=$(dkr exec "$hris_test_container" psql -U postgres -Atc "select count(*) from attendance where employee_id='80000000-0000-0000-0000-000000000003' and checked_out_at >= checked_in_at")
[ "$hris_rows" = 1 ] || { printf 'FAIL: concurrent session integrity\n'; exit 1; }
