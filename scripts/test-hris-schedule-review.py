#!/usr/bin/env python3
"""Fictional PostgreSQL regressions for the three final-review findings."""
from pathlib import Path
import os
import subprocess
import time
import sys

root = Path(__file__).resolve().parents[1]
env = {k: v for k, v in os.environ.items() if k not in
       ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']}
command = ['docker', '--host=unix:///var/run/docker.sock']
def docker(*args, **kwargs):
    return subprocess.run([*command, *args], env=env, text=True, **kwargs)
container = docker('run', '--rm', '-d', '--network', 'none', '-e',
                   'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16', capture_output=True, check=True).stdout.strip()
failed = []
def sql(query, check=True):
    result = docker('exec', '-i', container, 'psql', '-U', 'postgres', '-At', '-v',
                    'ON_ERROR_STOP=1', input=query, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr)
    return result
def background(query):
    process = subprocess.Popen([*command, 'exec', '-i', container, 'psql', '-U', 'postgres',
                                '-At', '-v', 'ON_ERROR_STOP=1'], env=env, text=True,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    process.stdin.write(query)
    process.stdin.close()
    return process

def wait_mutator():
    for _ in range(100):
        count = sql("select count(*) from pg_stat_activity where application_name='hris_fiction_mutator' and wait_event='PgSleep'").stdout.strip()
        if count == '1':
            return
        time.sleep(.02)
    raise RuntimeError('Fictional mutator did not reach its lock barrier')
def verify(ok, label):
    print(('PASS: ' if ok else 'FAIL: ') + label, flush=True)
    if not ok:
        failed.append(label)
def auth(index):
    return f"begin;set local role authenticated;select set_config('request.jwt.claim.role','authenticated',true);select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-00000000000{index}',true);"
def finish(process):
    process.wait(timeout=15)
    if process.returncode:
        raise RuntimeError(process.stderr.read())
try:
    for _ in range(100):
        # The image's temporary initialization server listens only on a Unix
        # socket. Wait for TCP on loopback so bootstrap cannot race its restart.
        if docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', capture_output=True).returncode == 0:
            break
        time.sleep(.1)
    else:
        raise RuntimeError('Fictional PostgreSQL did not become ready')
    # Same exact baseline sources and new migration as the main local runner.
    runner = (root / 'scripts/test-hris-schedule-db.sh').read_text()
    code = runner.split("<<'PY'", 1)[1].split('\nPY\n', 1)[0]
    code = code[code.index('\n') + 1:]
    # Optional pre-fix source allows the same regressions to prove RED without
    # replacing the working migration or touching any remote database.
    if len(sys.argv) > 1:
        baseline = str(Path(sys.argv[1]).resolve())
        code = code.replace("p=Path('supabase/migrations/20261001100000_schedule_change_requests.sql')",
                            f'p=Path({baseline!r})')
    bootstrap = subprocess.run(['python3', '-c', code], cwd=root, capture_output=True,
                               text=True, check=True).stdout
    sql(bootstrap)
    seed = (root / 'supabase/tests/hris_attendance_review_setup.sql').read_text().replace('\\set ON_ERROR_STOP on', '')
    seed = '\n'.join(line for line in seed.splitlines() if 'create or replace function public.hris_attendance_now' not in line)
    today = "(statement_timestamp() at time zone 'Asia/Jakarta')::date"
    sql(seed + f"""
insert into auth.users(id) values('90000000-0000-0000-0000-000000000004');
insert into branches(id,code,name,type) values('91000000-0000-0000-0000-000000000002','REVIEW-B-FIC','Fiction B','KLINIK');
insert into user_branches(user_id,branch_id,effective_date) values('90000000-0000-0000-0000-000000000003','91000000-0000-0000-0000-000000000001','2026-01-01');
insert into work_shifts(id,nama,jam_masuk,jam_pulang,branch_id) values('94000000-0000-0000-0000-000000000001','Fiction 07','07:00','15:00','91000000-0000-0000-0000-000000000001'),('94000000-0000-0000-0000-000000000002','Fiction 08','08:00','16:00','91000000-0000-0000-0000-000000000001');
insert into employee_schedules(employee_id,tanggal,shift_id) select '92000000-0000-0000-0000-000000000001',{today}+i,'94000000-0000-0000-0000-000000000001' from generate_series(1,6)i;
commit;
""")
    request = "select hris_request_schedule_change(id,updated_at,'94000000-0000-0000-0000-000000000002','91000000-0000-0000-0000-000000000001','Fiction review regression') from employee_schedules where tanggal="
    sql(auth(1) + request + today + '+1;commit;')
    request_id = sql('select id from schedule_change_requests').stdout.strip()
    mutator = background("""set application_name='hris_fiction_mutator';begin;
update employees set branch_id='91000000-0000-0000-0000-000000000002' where id='92000000-0000-0000-0000-000000000001';
insert into employee_branch_assignments(employee_id,branch_id,effective_date) values('92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002','2026-01-01');
select pg_sleep(1.2);commit;""")
    wait_mutator()
    result = sql(auth(3) + f"select hris_decide_schedule_change('{request_id}',true,'Fiction transfer approval');commit;", check=False)
    finish(mutator)
    state = sql(f"select status from schedule_change_requests where id='{request_id}'").stdout.strip()
    verify(result.returncode != 0 and 'JADWAL:' in result.stderr and state == 'Menunggu',
           'approval rechecks scope after a concurrent branch transfer')
    sql("""update employees set branch_id='91000000-0000-0000-0000-000000000001' where id='92000000-0000-0000-0000-000000000001';
delete from employee_branch_assignments where branch_id='91000000-0000-0000-0000-000000000002';
update work_shifts set branch_id='91000000-0000-0000-0000-000000000002' where id='94000000-0000-0000-0000-000000000001';""")
    result = sql(auth(3) + 'select hris_assert_payroll_scope();commit;', check=False)
    verify(result.returncode != 0 and 'HRIS:' in result.stderr,
           'whole-company payroll refuses an admin whose historical shift sources are hidden')
    sql("update work_shifts set branch_id='91000000-0000-0000-0000-000000000001' where id='94000000-0000-0000-0000-000000000001';")
    for index, (label, mutation) in enumerate([
            ('unlink', 'profile_id=null'),
            ('rebind', "profile_id='90000000-0000-0000-0000-000000000004'"),
            ('deactivation', "status='Nonaktif'")], start=2):
        sql("update employees set profile_id='90000000-0000-0000-0000-000000000001',status='Aktif' where id='92000000-0000-0000-0000-000000000001';")
        mutator = background(f"set application_name='hris_fiction_mutator';begin;update employees set {mutation} where id='92000000-0000-0000-0000-000000000001';select pg_sleep(1.2);commit;")
        wait_mutator()
        result = sql(auth(1) + request + today + f'+{index};commit;', check=False)
        finish(mutator)
        rows = sql(f"select count(*) from schedule_change_requests where tanggal={today}+{index}").stdout.strip()
        verify(result.returncode != 0 and 'JADWAL:' in result.stderr and rows == '0',
               f'request denies old identity after concurrent {label}')
    for index, (label, mutation) in enumerate([
            ('employee assignment', "insert into employee_branch_assignments(employee_id,branch_id,effective_date) values('92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000002','2026-01-01')"),
            ('actor branch access', "delete from user_branches where user_id='90000000-0000-0000-0000-000000000003'")], start=5):
        sql("update employees set profile_id='90000000-0000-0000-0000-000000000001',status='Aktif',branch_id='91000000-0000-0000-0000-000000000001' where id='92000000-0000-0000-0000-000000000001';delete from employee_branch_assignments where branch_id='91000000-0000-0000-0000-000000000002';")
        sql(auth(1) + request + today + f'+{index};commit;')
        request_id = sql(f'select id from schedule_change_requests where tanggal={today}+{index}').stdout.strip()
        approval = background("set application_name='hris_fiction_mutator';" + auth(3) +
                              f"select hris_decide_schedule_change('{request_id}',true,'Fiction serialization approval');select pg_sleep(1.2);commit;")
        wait_mutator()
        writer = background("set application_name='hris_fiction_writer';" + mutation + ';')
        blocked = False
        for _ in range(30):
            if sql("select count(*) from pg_stat_activity where application_name='hris_fiction_writer' and wait_event_type='Lock'").stdout.strip() == '1':
                blocked = True
                break
            if writer.poll() is not None:
                break
            time.sleep(.02)
        finish(approval)
        finish(writer)
        state = sql(f"select status from schedule_change_requests where id='{request_id}'").stdout.strip()
        verify(blocked and state == 'Disetujui',
               f'concurrent {label} writer waits until approval commits')
finally:
    docker('rm', '-f', container, capture_output=True)
if failed:
    sys.exit(1)
