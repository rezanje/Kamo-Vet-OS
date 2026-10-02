#!/usr/bin/env bash
# Disposable LOCAL PostgreSQL only: does not read Supabase credentials.
set -euo pipefail
cd "$(dirname "$0")/.."
dkr() { env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"; }
hris_test_container=$(dkr run --rm -d --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16)
hris_test_logs=$(mktemp -d)
trap 'dkr rm -f "$hris_test_container" >/dev/null 2>&1 || true; rm -rf "$hris_test_logs"' EXIT
for attempt in $(seq 1 30); do
 if dkr exec "$hris_test_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
 sleep 1
done
if ! python3 - <<'PY' | dkr exec -i "$hris_test_container" psql -U postgres -v ON_ERROR_STOP=1 > "$hris_test_logs/bootstrap.log" 2>&1
from pathlib import Path
print(Path('supabase/tests/hris_attendance_fixture.sql').read_text())
for migration in ['0001_core','0002_rls','0004_perf_security_fixes','0016_hris','0017_payroll','0018_attendance','0087_hris_jadwal_komponen_gaji']:
 print(Path(f'supabase/migrations/{migration}.sql').read_text())
print('alter table employees add column profile_id uuid references profiles(id);')
print(Path('supabase/migrations/0090_payroll_rincian.sql').read_text())
print(Path('supabase/migrations/0135_employee_branch_assignments.sql').read_text())
# Same self-role guard from the existing production migration; no clinical tables needed.
source=Path('supabase/migrations/20260924140000_official_compound_catalog.sql').read_text()
a=source.index('create function public.prevent_self_role_change()')
b=source.index('-- The historic clinical RLS',a)
print(source[a:b])
print('grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid() to authenticated; grant all on all tables in schema public to authenticated;')
print(Path('supabase/migrations/20261001090000_attendance_sessions.sql').read_text())
p=Path('supabase/migrations/20261001100000_schedule_change_requests.sql')
if p.exists(): print(p.read_text())
PY
then cat "$hris_test_logs/bootstrap.log"; exit 1; fi
dkr cp supabase/tests "$hris_test_container:/tests"
if ! dkr exec -i -w /tests "$hris_test_container" psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/hris_schedule_requests.sql > "$hris_test_logs/schedule.log" 2>&1; then cat "$hris_test_logs/schedule.log"; exit 1; fi
printf 'PASS: local PostgreSQL request, approval, stale snapshot, access and audit checks\n'
# Prior attendance contract must still pass with the new schedule migration.
for hris_suite in sessions json_claims final_resolution legacy_correction; do
 if ! dkr exec -i -w /tests "$hris_test_container" psql -U postgres -v ON_ERROR_STOP=1 < "supabase/tests/hris_attendance_$hris_suite.sql" > "$hris_test_logs/$hris_suite.log" 2>&1; then cat "$hris_test_logs/$hris_suite.log"; exit 1; fi
 printf 'PASS: prior attendance %s contract with schedule migration\n' "$hris_suite"
done
# Concurrent approvals on independent connections, using the production clock.
dkr exec -i "$hris_test_container" psql -U postgres -v ON_ERROR_STOP=1 > "$hris_test_logs/race-seed.log" 2>&1 <<'SQL'
insert into auth.users(id) values('80000000-0000-0000-0000-000000000001'),('80000000-0000-0000-0000-000000000002');
update profiles set role='OWNER' where id='80000000-0000-0000-0000-000000000002';
insert into branches(id,code,name,type) values('81000000-0000-0000-0000-000000000001','RACE-REQ-FIC','Fiction approval race','KLINIK');
insert into employees(id,nama,profile_id,branch_id) values('82000000-0000-0000-0000-000000000001','Fiction requester','80000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001');
insert into employee_branch_assignments(employee_id,branch_id,effective_date) values('82000000-0000-0000-0000-000000000001','81000000-0000-0000-0000-000000000001','2026-01-01');
insert into work_shifts(id,nama,jam_masuk,jam_pulang,branch_id) values('84000000-0000-0000-0000-000000000001','Fiction race07','07:00','15:00','81000000-0000-0000-0000-000000000001'),('84000000-0000-0000-0000-000000000002','Fiction race08','08:00','16:00','81000000-0000-0000-0000-000000000001');
insert into employee_schedules(employee_id,tanggal,shift_id) values('82000000-0000-0000-0000-000000000001',(statement_timestamp() at time zone 'Asia/Jakarta')::date+1,'84000000-0000-0000-0000-000000000001');
begin;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','80000000-0000-0000-0000-000000000001',true);
select public.hris_request_schedule_change(id,updated_at,'84000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000001','Fiction approval race request') from employee_schedules;
commit;
SQL
hris_request_id=$(dkr exec "$hris_test_container" psql -U postgres -Atc 'select id from schedule_change_requests')
hris_approve_race() {
 local index="$1"
 dkr exec -i "$hris_test_container" psql -U postgres -v ON_ERROR_STOP=1 > "$hris_test_logs/approve-$index.log" 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','80000000-0000-0000-0000-000000000002',true);
select public.hris_decide_schedule_change('$hris_request_id',true,'Fiction concurrent approval');
select pg_sleep(1);
commit;
SQL
}
hris_approve_race 1 & hris_job_one=$!
hris_approve_race 2 & hris_job_two=$!
hris_code_one=0; wait "$hris_job_one" || hris_code_one=$?
hris_code_two=0; wait "$hris_job_two" || hris_code_two=$?
if ! (( (hris_code_one==0 && hris_code_two!=0) || (hris_code_two==0 && hris_code_one!=0) )); then cat "$hris_test_logs/approve-1.log" "$hris_test_logs/approve-2.log"; exit 1; fi
hris_integrity=$(dkr exec "$hris_test_container" psql -U postgres -Atc "select count(*) from schedule_change_requests r join employee_schedules s on s.id=r.schedule_id where r.status='Disetujui' and s.shift_id=r.proposed_shift_id and (select count(*) from schedule_request_events)=2")
[ "$hris_integrity" = 1 ] || { printf 'FAIL: concurrent approval integrity\n'; exit 1; }
printf 'PASS: concurrent approval accepts exactly one decision and one effective change\n'
