"""Deterministic, fictional PostgreSQL races for the schedule source boundary."""
import json
import subprocess
import time


def run_schedule_lock_races(command, env, container, docker):
    def sql(query):
        result = docker('exec', '-i', container, 'psql', '-U', 'postgres', '-At',
                        '-v', 'ON_ERROR_STOP=1', input=query, capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    def literal(value):
        return "'" + value.replace("'", "''") + "'"

    def auth(actor):
        return ("begin;set local role authenticated;"
                "select set_config('request.jwt.claim.role','authenticated',true);"
                f"select set_config('request.jwt.claim.sub','{actor}',true);")

    def start(name, query):
        job = subprocess.Popen(
            [*command, 'exec', '-i', container, 'psql', '-U', 'postgres', '-At',
             '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
            env=env, text=True, stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        job.stdin.write(f"set application_name={literal(name)};\n{query}\n")
        job.stdin.flush()
        return job

    def wait_lock(name, granted, job):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if job.poll() is not None:
                raise RuntimeError(f'{name} finished before the source lock boundary')
            if sql("select exists(select 1 from pg_locks l join pg_stat_activity a "
                   "on a.pid=l.pid where l.locktype='advisory' and l.objid=72310402 "
                   f"and l.granted={'true' if granted else 'false'} "
                   f"and a.application_name={literal(name)})") == 't':
                return
            time.sleep(.02)
        raise RuntimeError(f'{name} did not reach the source lock boundary')

    actor_a = '60000000-0000-0000-0000-000000000001'
    owner = '60000000-0000-0000-0000-000000000002'
    actor_b = '60000000-0000-0000-0000-000000000004'
    branch = '61000000-0000-0000-0000-000000000001'
    emp_a = '62000000-0000-0000-0000-000000000001'
    emp_b = '62000000-0000-0000-0000-000000000002'
    shift_a = '64000000-0000-0000-0000-000000000001'
    shift_b = '64000000-0000-0000-0000-000000000002'
    sql(f"""
insert into auth.users(id)values('{actor_a}'),('{owner}'),('{actor_b}');
update profiles set role='OWNER'where id='{owner}';
insert into branches(id,code,name,type)values('{branch}','LOCK-FICT','Fiction lock order','KLINIK');
insert into employees(id,nama,profile_id,branch_id)values
('{emp_a}','Fiction lock A','{actor_a}','{branch}'),('{emp_b}','Fiction lock B','{actor_b}','{branch}');
insert into employee_branch_assignments(employee_id,branch_id,effective_date)values
('{emp_a}','{branch}','2026-01-01'),('{emp_b}','{branch}','2026-01-01');
insert into work_shifts(id,nama,jam_masuk,jam_pulang,branch_id)values
('{shift_a}','Fiction lock07','07:00','15:00','{branch}'),('{shift_b}','Fiction lock08','08:00','16:00','{branch}');
""")

    signatures = [
        'hris_request_schedule_change(uuid,timestamptz,uuid,uuid,text)',
        'hris_decide_schedule_change(uuid,boolean,text)',
        'hris_request_schedule_swap(uuid,timestamptz,uuid,timestamptz,uuid,text)',
        'hris_transition_schedule_swap(uuid,text,boolean,text)',
    ]
    for signature in signatures:
        if sql(f"select has_function_privilege('anon',{literal('public.' + signature)},'EXECUTE')") != 'f':
            raise RuntimeError('Migration exposed a schedule function to anonymous users')
    if sql("select has_function_privilege('authenticated','public.hris_transition_schedule_swap(uuid,text,boolean,text)','EXECUTE')") != 'f':
        raise RuntimeError('Migration exposed the private swap transition')

    cases = ['single approve', 'single submit', 'swap approve', 'swap submit',
             'peer consent', 'swap cancel', 'single reject', 'swap reject']
    for index, case in enumerate(cases, 10):
        day = sql(f"select (statement_timestamp()at time zone 'Asia/Jakarta')::date+{index}")
        sql(f"insert into employee_schedules(employee_id,tanggal,shift_id)values"
            f"('{emp_a}','{day}','{shift_a}'),('{emp_b}','{day}','{shift_b}');")
        cells = json.loads(sql(f"select jsonb_agg(to_jsonb(s)order by employee_id)"
                               f"from employee_schedules s where tanggal='{day}'and employee_id in('{emp_a}','{emp_b}')"))
        a, b = cells
        swap_submit = (f"select hris_request_schedule_swap('{a['id']}','{a['updated_at']}',"
                       f"'{b['id']}','{b['updated_at']}','{branch}','Fiction lock swap');")
        single_submit = (f"select hris_request_schedule_change('{b['id']}','{b['updated_at']}',"
                         f"'{shift_a}','{branch}','Fiction lock single');")
        request = None
        if case.startswith('single'):
            if case != 'single submit':
                sql(auth(actor_b) + single_submit + 'commit;')
                request = sql(f"select id from schedule_change_requests where employee_id='{emp_b}'and tanggal='{day}'")
            query = (single_submit if case == 'single submit' else
                     f"select hris_decide_schedule_change('{request}',{str(case == 'single approve').lower()},'Fiction lock decision');")
            contender_actor = actor_b if case == 'single submit' else owner
        else:
            if case != 'swap submit':
                sql(auth(actor_a) + swap_submit + 'commit;')
                request = sql(f"select id from schedule_swap_requests where employee_a='{emp_a}'and date_a='{day}'")
                if case == 'swap approve':
                    sql(auth(actor_b) + f"select hris_respond_schedule_swap('{request}',true,'Fiction peer accepts');commit;")
            query = {
                'swap submit': swap_submit,
                'swap approve': f"select hris_decide_schedule_swap('{request}',true,'Fiction lock approval');",
                'peer consent': f"select hris_respond_schedule_swap('{request}',true,'Fiction lock consent');",
                'swap cancel': f"select hris_cancel_schedule_swap('{request}','Fiction lock cancellation');",
                'swap reject': f"select hris_decide_schedule_swap('{request}',false,'Fiction lock rejection');",
            }[case]
            contender_actor = actor_a if case in ('swap submit', 'swap cancel') else actor_b if case == 'peer consent' else owner

        rows = [dict(employee_id=c['employee_id'], tanggal=day, branch_id=branch,
                     shift_id='' if c['employee_id'] == emp_a else shift_a,
                     expected={key: c[key] for key in ('id', 'updated_at', 'shift_id')}) for c in cells]
        board = (f"select hris_save_schedule_batch('{branch}','{day}','{day}',"
                 f"{literal(json.dumps(rows))}::jsonb);commit;")
        event_table = 'schedule_request_events' if case.startswith('single') else 'schedule_swap_events'
        before_events = int(sql(f'select count(*)from {event_table}'))
        holder = start('fiction_source_holder', auth(owner) + 'select pg_advisory_xact_lock(72310402);')
        contender = None
        try:
            wait_lock('fiction_source_holder', True, holder)
            contender = start('fiction_schedule_contender', auth(contender_actor) + query + 'commit;')
            contender.stdin.close()
            wait_lock('fiction_schedule_contender', False, contender)
            # The queued RPC must hold no identity/request/cell locks preventing
            # this real board RPC from completing while it owns the source lock.
            holder.stdin.write(board + '\n'); holder.stdin.close()
            holder.wait(timeout=10); contender.wait(timeout=10)
            errors = holder.stderr.read() + contender.stderr.read()
            if '40P01' in errors or holder.returncode:
                raise RuntimeError(f'{case}: source/row lock inversion: ' + errors)
            allowed = case in ('swap cancel', 'single reject', 'swap reject')
            if (contender.returncode == 0) != allowed or (not allowed and 'JADWAL:' not in errors):
                raise RuntimeError(f'{case}: unexpected stale/cancellation result: ' + errors)
            if sql(f"select count(*)from employee_schedules where tanggal='{day}'and employee_id in('{emp_a}','{emp_b}')") != '1':
                raise RuntimeError(f'{case}: board was only partly saved')
            if sql(f"select employee_id='{emp_b}'::uuid and shift_id='{shift_a}'::uuid from employee_schedules where tanggal='{day}'and employee_id in('{emp_a}','{emp_b}')") != 't':
                raise RuntimeError(f'{case}: the remaining effective schedule is wrong')
            if sql(f"select count(*)from schedule_board_events where branch_id='{branch}'and changes->0->>'tanggal'='{day}'and jsonb_array_length(changes)=2") != '1':
                raise RuntimeError(f'{case}: missing/duplicate board audit')
            table = 'schedule_change_requests' if case.startswith('single') else 'schedule_swap_requests'
            if request:
                expected = 'Dibatalkan' if case == 'swap cancel' else 'Ditolak' if case.endswith('reject') else 'Menunggu' if case.startswith('single') else 'Menunggu HR' if case == 'swap approve' else 'Menunggu rekan'
                if sql(f"select status from {table} where id='{request}'") != expected:
                    raise RuntimeError(f'{case}: false approval or request state')
            elif sql(f"select count(*)from {table} where {'employee_id' if case.startswith('single') else 'employee_a'}='{emp_b if case.startswith('single') else emp_a}'and {'tanggal' if case.startswith('single') else 'date_a'}='{day}'") != '0':
                raise RuntimeError(f'{case}: stale submission was committed')
            if int(sql(f'select count(*)from {event_table}')) != before_events + int(allowed):
                raise RuntimeError(f'{case}: false or missing request decision audit')
            print(f'PASS: source-first {case} waits without deadlock or false state', flush=True)
        finally:
            for job in (holder, contender):
                if job is not None and job.poll() is None:
                    job.kill()
                    job.wait(timeout=5)
