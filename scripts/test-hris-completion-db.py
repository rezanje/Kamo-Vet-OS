#!/usr/bin/env python3
"""Run prepared HRIS migrations/tests in fictional isolated PostgreSQL only."""
from pathlib import Path
import os
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[1]
env = {k: v for k, v in os.environ.items() if k not in
       ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']}
command = ['docker', '--host=unix:///var/run/docker.sock']
def docker(*args, **kwargs):
    return subprocess.run([*command, *args], env=env, text=True, **kwargs)
container = docker('run', '--rm', '-d', '--network', 'none', '-e',
                   'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16', capture_output=True, check=True).stdout.strip()
try:
    for _ in range(100):
        if docker('exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', capture_output=True).returncode == 0:
            break
        time.sleep(.1)
    else:
        raise RuntimeError('Fictional PostgreSQL not ready')
    code = (root / 'scripts/test-hris-schedule-db.sh').read_text().split("<<'PY'", 1)[1].split('\nPY\n', 1)[0]
    code = code[code.index('\n') + 1:]
    bootstrap = subprocess.run(['python3', '-c', code], cwd=root, text=True,
                               capture_output=True, check=True).stdout
    bootstrap += '\n' + (root / 'supabase/migrations/0019_leave.sql').read_text()
    bootstrap += '\n' + (root / 'supabase/migrations/0015_keuangan.sql').read_text()
    bootstrap += "\ninsert into coa_accounts(code,name,type,normal_balance)values('1101','Fiction cash','ASET','D'),('1102','Fiction bank','ASET','D');\n"
    bootstrap += '\n' + (root / 'supabase/migrations/0068_kas_bank.sql').read_text()
    bootstrap += '\n' + (root / 'supabase/migrations/0089_hris_pengajuan_staf.sql').read_text()
    bootstrap += '\n' + 'grant all on public.leave_requests,public.coa_accounts,public.journal_entries,public.journal_lines,public.cash_accounts,public.cash_transfers,public.overtime_requests,public.cash_advances,public.cash_advance_installments,public.reimbursements to authenticated;'
    bootstrap += '\n'.join(p.read_text() for p in sorted((root / 'supabase/migrations').glob('20261002*.sql')))
    result = docker('exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1',
                    input=bootstrap, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    docker('cp', str(root / 'supabase/tests'), container + ':/tests', check=True, capture_output=True)
    suites = sys.argv[1:] or ['hris_schedule_swaps.sql']
    for suite in suites:
        source = root / 'supabase/tests' / suite
        if source.parent != root / 'supabase/tests':
            raise ValueError('Only local test suite filenames accepted')
        result = docker('exec', '-i', '-w', '/tests', container, 'psql', '-U', 'postgres', '-v',
                        'ON_ERROR_STOP=1', input=source.read_text(), capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stdout[-4000:] + result.stderr)
        print('PASS: ' + suite, flush=True)
    # Independent connections and the production clock prove one atomic winner.
    if 'hris_schedule_swaps.sql' in suites:
        def sql(query):
            r = docker('exec', '-i', container, 'psql', '-U', 'postgres', '-At', '-v',
                       'ON_ERROR_STOP=1', input=query, capture_output=True)
            if r.returncode:
                raise RuntimeError(r.stderr)
            return r.stdout.strip()
        seed = (root / 'supabase/tests/hris_attendance_review_setup.sql').read_text().replace('\\set ON_ERROR_STOP on', '')
        seed = '\n'.join(line for line in seed.splitlines() if 'create or replace function public.hris_attendance_now' not in line)
        sql(seed + """
insert into auth.users(id)values('90000000-0000-0000-0000-000000000004');
update employees set profile_id='90000000-0000-0000-0000-000000000004' where id='92000000-0000-0000-0000-000000000002';
insert into work_shifts(id,nama,jam_masuk,jam_pulang,branch_id)values('94000000-0000-0000-0000-000000000001','Fiction concurrent07','07:00','15:00','91000000-0000-0000-0000-000000000001'),('94000000-0000-0000-0000-000000000002','Fiction concurrent08','08:00','16:00','91000000-0000-0000-0000-000000000001');
insert into employee_schedules(employee_id,tanggal,shift_id)select id,(statement_timestamp() at time zone 'Asia/Jakarta')::date+1,case when id='92000000-0000-0000-0000-000000000001' then '94000000-0000-0000-0000-000000000001'::uuid else '94000000-0000-0000-0000-000000000002'::uuid end from employees;
commit;
""")
        def auth(index):
            return f"begin;set local role authenticated;select set_config('request.jwt.claim.role','authenticated',true);select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-00000000000{index}',true);"
        pair = sql("select string_agg(id::text||'|'||updated_at::text,',' order by employee_id)from employee_schedules").split(',')
        a, av = pair[0].split('|'); b, bv = pair[1].split('|')
        def race(query, label):
            jobs = [subprocess.Popen([*command, 'exec', '-i', container, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], env=env, text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(2)]
            results = []
            for job in jobs:
                job.stdin.write(query); job.stdin.close()
            for job in jobs:
                job.wait(timeout=20)
                results.append(job.returncode)
                if job.returncode and 'JADWAL:' not in job.stderr.read():
                    raise RuntimeError('Unexpected concurrent SQL failure')
            if sum(code == 0 for code in results) != 1:
                raise RuntimeError(label + ' must accept exactly one transaction')
            print('PASS: ' + label, flush=True)
        race(auth(1) + f"select hris_request_schedule_swap('{a}','{av}','{b}','{bv}','91000000-0000-0000-0000-000000000001','Fiction concurrent submission');select pg_sleep(1);commit;", 'concurrent swap submission has one pending pair')
        request_id = sql('select id from schedule_swap_requests')
        sql(auth(4) + f"select hris_respond_schedule_swap('{request_id}',true,'Fiction peer consent');commit;")
        race(auth(2) + f"select hris_decide_schedule_swap('{request_id}',true,'Fiction concurrent approval');select pg_sleep(1);commit;", 'concurrent swap approval has one decision')
        if sql("select count(*) from schedule_swap_requests r join employee_schedules a on a.id=r.schedule_a join employee_schedules b on b.id=r.schedule_b where r.status='Disetujui' and a.shift_id=(r.shift_b->>'id')::uuid and b.shift_id=(r.shift_a->>'id')::uuid and (select count(*)from schedule_swap_events)=3") != '1':
            raise RuntimeError('Concurrent approval left inconsistent cells or events')
        print('PASS: both effective cells and exactly three audit events', flush=True)

finally:
    docker('rm', '-f', container, capture_output=True)
