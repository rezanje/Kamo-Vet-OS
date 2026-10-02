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
    bootstrap += '\n' + (root / 'supabase/migrations/0055_tutup_buku.sql').read_text()
    bootstrap += '\n' + (root / 'supabase/migrations/0113_coa_header_detail.sql').read_text()
    shift = (root / 'supabase/migrations/0011_cashier_shifts.sql').read_text()
    bootstrap += '\n' + shift[:shift.index('alter table sales')] + shift[shift.index('alter table cashier_shifts enable row level security'): ]
    mapping = (root / 'supabase/migrations/0085_peta_rekening_pembayaran.sql').read_text()
    bootstrap += '\n' + mapping[:mapping.index('alter table bank_reconciliations')]
    bootstrap += '\ngrant all on public.cashier_shifts,public.accounting_locks,public.payment_account_map to authenticated;'
    bootstrap += '\n' + 'grant all on public.leave_requests,public.coa_accounts,public.journal_entries,public.journal_lines,public.cash_accounts,public.cash_transfers,public.overtime_requests,public.cash_advances,public.cash_advance_installments,public.reimbursements to authenticated;'
    for name in ['0005_klinik_visits','0008_klinik_pembayaran','0010_pos_sales','0006_rekam_medis','0027_item_discount_promos','0028_invoice_edit_log','0084_klinik_stok_hpp','0091_komisi_target','0092_komisi_klinik','0098_rantai_penjualan','0102_komisi_reseller','20260915190000_salesperson_and_sales_discount']:
        bootstrap += '\n' + (root / ('supabase/migrations/' + name + '.sql')).read_text()
    returns = (root / 'supabase/migrations/0053_returns.sql').read_text()
    bootstrap += '\n' + returns[returns.index('create table sales_returns'):returns.index('alter table purchase_returns')]
    bootstrap += '\n' + returns[returns.index('alter table sales_returns'):returns.index('-- demo posture')]
    bootstrap += '\n' + returns[returns.index('create policy sr2_all'):]
    bootstrap += '\ngrant all on public.sales,public.sale_items,public.visits,public.invoices,public.invoice_items,public.sales_returns,public.sales_return_items,public.sales_invoices,public.sales_invoice_items,public.sales_delivery_items,public.commission_rules,public.sales_targets to authenticated;'
    bootstrap += '\n' + (root / 'supabase/migrations/20260930030129_employee_excel_import.sql').read_text()
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

        if 'hris_schedule_board_batch.sql' in suites:
            # Reuse the two fictional employees; no extra payroll participants.
            branch = '91000000-0000-0000-0000-000000000001'
            shift = '94000000-0000-0000-0000-000000000002'
            def board_seed(days):
                sql(f"insert into employee_schedules(employee_id,tanggal,shift_id)select id,(statement_timestamp()at time zone 'Asia/Jakarta')::date+{days},'94000000-0000-0000-0000-000000000001'from employees;")
            def board_query(days):
                payload = sql(f"select jsonb_agg(jsonb_build_object('employee_id',employee_id,'tanggal',tanggal,'shift_id',case when employee_id='92000000-0000-0000-0000-000000000001'then ''else '{shift}'end,'branch_id','{branch}','expected',jsonb_build_object('id',id,'updated_at',updated_at,'shift_id',shift_id))order by employee_id)from employee_schedules where tanggal=(statement_timestamp()at time zone 'Asia/Jakarta')::date+{days}")
                return auth(2) + f"select hris_save_schedule_batch('{branch}',(statement_timestamp()at time zone 'Asia/Jakarta')::date+{days},(statement_timestamp()at time zone 'Asia/Jakarta')::date+{days},'{payload.replace(chr(39),chr(39)*2)}'::jsonb);select pg_sleep(1);commit;"
            def board_race(queries, label):
                jobs = [subprocess.Popen([*command,'exec','-i',container,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1'],env=env,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE) for _ in queries]
                for job, query in zip(jobs, queries):
                    job.stdin.write(query); job.stdin.close()
                codes=[]
                for job in jobs:
                    job.wait(timeout=20); codes.append(job.returncode)
                    error=job.stderr.read()
                    if job.returncode and 'JADWAL:' not in error:
                        raise RuntimeError('Unexpected board race failure: '+error)
                if sum(code==0 for code in codes)!=1:
                    raise RuntimeError(label+': expected one complete winner '+str(codes))
                print('PASS: '+label,flush=True)
            board_seed(2)
            batch=board_query(2)
            board_race([batch,batch],'concurrent boards accept one complete batch')
            if sql("select count(*)from schedule_board_events where jsonb_array_length(changes)=2")!='1' or sql(f"select count(*)from employee_schedules where tanggal=(statement_timestamp()at time zone 'Asia/Jakarta')::date+2 and shift_id='{shift}'")!='1':
                raise RuntimeError('Concurrent board save left partial cells or duplicate audit')
            board_seed(3)
            sql(auth(4)+f"select hris_request_schedule_change(id,updated_at,'{shift}','{branch}','Fiction board versus approval')from employee_schedules where employee_id='92000000-0000-0000-0000-000000000002'and tanggal=(statement_timestamp()at time zone 'Asia/Jakarta')::date+3;commit;")
            request=sql("select id from schedule_change_requests")
            approval=auth(2)+f"select hris_decide_schedule_change('{request}',true,'Fiction concurrent board approval');select pg_sleep(1);commit;"
            board_race([board_query(3),approval],'board versus approval accepts one complete transaction')
            if sql(f"select case when r.status='Disetujui'then (select count(*)from employee_schedules where tanggal=r.tanggal)=2 and (select count(*)from schedule_board_events)=1 else r.status='Menunggu'and (select count(*)from employee_schedules where tanggal=r.tanggal)=1 and (select count(*)from schedule_board_events)=2 end from schedule_change_requests r where id='{request}'")!='t' or sql(f"select shift_id='{shift}'::uuid from employee_schedules where employee_id='92000000-0000-0000-0000-000000000002'and tanggal=(statement_timestamp()at time zone 'Asia/Jakarta')::date+3")!='t':
                raise RuntimeError('Board/approval race left partial deletion or false approval')
            print('PASS: losing board/approval leaves no partial cells or decision audit',flush=True)

            # A real access writer holds the shared source boundary first. The
            # queued ADMIN call must use the post-revocation permissions.
            board_seed(4)
            sql(f"insert into user_branches(user_id,branch_id,effective_date)values('90000000-0000-0000-0000-000000000003','{branch}','2026-01-01');")
            stale_admin_batch=board_query(4).replace(auth(2),auth(3),1)
            before_audits=sql('select count(*)from schedule_board_events')
            revoke_job=subprocess.Popen([*command,'exec','-i',container,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1'],env=env,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            revoke_job.stdin.write("begin;delete from user_branches where user_id='90000000-0000-0000-0000-000000000003';select pg_sleep(2);commit;");revoke_job.stdin.close()
            for _ in range(100):
                if sql("select count(*)from pg_locks where locktype='advisory'and objid=72310402 and granted")=='1':
                    break
                time.sleep(.02)
            else:
                raise RuntimeError('Access writer did not acquire the source lock')
            denied=docker('exec','-i',container,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1',input=stale_admin_batch,capture_output=True)
            revoke_job.wait(timeout=20)
            if revoke_job.returncode:
                raise RuntimeError(revoke_job.stderr.read())
            if denied.returncode==0 or 'JADWAL: Cabang tidak diizinkan' not in denied.stderr:
                raise RuntimeError('Queued board used revoked ADMIN membership')
            if sql('select count(*)from schedule_board_events')!=before_audits or sql("select count(*)from employee_schedules where tanggal=(statement_timestamp()at time zone 'Asia/Jakarta')::date+4 and shift_id='94000000-0000-0000-0000-000000000001'")!='2':
                raise RuntimeError('Revoked queued board left partial cells or audit')
            print('PASS: queued board rechecks revoked access and leaves all cells unchanged',flush=True)

    if 'hris_payroll_settlement.sql' in suites:
        def payroll_sql(query):
            r = docker('exec', '-i', container, 'psql', '-U', 'postgres', '-At', '-v',
                       'ON_ERROR_STOP=1', input=query, capture_output=True)
            if r.returncode:
                raise RuntimeError(r.stderr)
            return r.stdout.strip()
        def owner_sql(query):
            return "begin;set local role authenticated;select set_config('request.jwt.claim.role','authenticated',true);select set_config('request.jwt.claim.sub','90000000-0000-0000-0000-000000000002',true);" + query
        if 'hris_schedule_swaps.sql' not in suites:
            seed = (root / 'supabase/tests/hris_attendance_review_setup.sql').read_text()
            payroll_sql(seed + '\ncommit;')
        payroll_sql("""
insert into coa_accounts(code,name,type,normal_balance)values('5201','Fiction concurrent salary','BEBAN','D')on conflict(code)do nothing;
update employees set gaji_pokok=100;
insert into cash_advances(id,employee_id,jumlah,tenor_bulan,status,disbursed_at)values('97000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001',100,2,'Disetujui',statement_timestamp());
insert into reimbursements(id,employee_id,kategori,jumlah,status)values('97100000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','Fiction race travel',20,'Disetujui');
create function public.fixture_salary_rows(p_period text)returns jsonb language sql as $$
with loans as(select a.*,greatest(0,round(a.jumlah-coalesce((select sum(jumlah)from cash_advance_installments where advance_id=a.id),0)))remaining,floor(round(a.jumlah)/a.tenor_bulan)due from cash_advances a where status='Disetujui'),
inst as(select employee_id,id,case when due<=0 or remaining-due<due then remaining else due end amount from loans where remaining>0),
inputs as(select e.id,e.gaji_pokok,coalesce((select sum(amount)from inst where employee_id=e.id),0)cicilan,coalesce((select jsonb_agg(jsonb_build_object('id',id,'jumlah',amount)order by id)from inst where employee_id=e.id),'[]'::jsonb)plans,
coalesce((select sum(jumlah)from reimbursements where employee_id=e.id and status='Disetujui'and paid_periode is null),0)reim,
coalesce((select jsonb_agg(id order by id)from reimbursements where employee_id=e.id and status='Disetujui'and paid_periode is null),'[]'::jsonb)reim_ids from employees e where status='Aktif'),
rows as(select *,jsonb_build_object('gajiPokok',gaji_pokok,'tunjangan',0,'upahLembur',0,'reimburse',reim,'komisi',0,'potonganTetap',0,'potonganTelat',0,'potonganBolos',0,'cicilanKasbon',cicilan,'penyesuaian',0,'total',gaji_pokok+reim-cicilan,'hariKerja',0,'hariHadir',0,'hariBolos',0,'menitTelat',0,'jamLembur',0)r from inputs)
select jsonb_agg(jsonb_build_object('employeeId',id,'rincian',r,'sourceSnapshot',jsonb_build_object('rincian',r,'period',p_period),'cicilanKasbon',plans,'reimburseIds',reim_ids,'catatan','')order by id)from rows
$$;
""")
        def payroll_race(queries, label, expected_successes=1):
            jobs = [subprocess.Popen([*command, 'exec', '-i', container, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], env=env, text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in queries]
            for job, query in zip(jobs, queries):
                job.stdin.write(query); job.stdin.close()
            codes=[]
            for job in jobs:
                job.wait(timeout=30); codes.append(job.returncode)
                error=job.stderr.read()
                if job.returncode and 'HRIS:' not in error:
                    raise RuntimeError('Unexpected payroll race failure: ' + error)
            if sum(c == 0 for c in codes) != expected_successes:
                raise RuntimeError(label + ': unexpected winners ' + str(codes))
            print('PASS: '+label, flush=True)
        prepare = owner_sql("select hris_prepare_payroll('2026-10',(hris_payroll_source_state('2026-10')->>'revision')::bigint,0,fixture_salary_rows('2026-10'),'Fiction concurrent preparation');select pg_sleep(1);commit;")
        payroll_race([prepare,prepare],'concurrent draft preparation has one complete version')
        finalize=owner_sql("select hris_finalize_payroll('2026-10',1,null,'Fiction concurrent finalization');select pg_sleep(1);commit;")
        payroll_race([finalize,finalize],'concurrent finalization has one payment journal and settlement')
        if payroll_sql("select count(*)from journal_entries where source='payroll'and source_ref='2026-10'")!='1' or payroll_sql("select count(*)from payrolls where periode='2026-10'and status='final'")!='2' or payroll_sql("select jumlah from cash_advance_installments where periode='2026-10'")!='50.00' or payroll_sql("select status from reimbursements")!='Dibayar':
            raise RuntimeError('Concurrent finalization left incomplete/duplicate money')
        print('PASS: final slips, one 50 installment, paid reimbursement and one balanced journal',flush=True)
        payroll_sql(owner_sql("select hris_prepare_payroll('2026-11',(hris_payroll_source_state('2026-11')->>'revision')::bigint,0,fixture_salary_rows('2026-11'),'Fiction before period close');commit;"))
        # Force the closing writer to hold its real source/accounting lock first.
        close_job=subprocess.Popen([*command,'exec','-i',container,'psql','-U','postgres','-At','-v','ON_ERROR_STOP=1'],env=env,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        close_job.stdin.write(owner_sql("update accounting_locks set closed_until='2026-11-30';select pg_sleep(2);commit;"));close_job.stdin.close()
        for _ in range(100):
            if payroll_sql("select count(*)from pg_locks where locktype='advisory'and objid=72310402 and granted")=='1':
                break
            time.sleep(.02)
        else:
            raise RuntimeError('Close writer did not acquire the source lock')
        blocked=owner_sql("select hris_finalize_payroll('2026-11',1,null,'Fiction racing closed period');commit;")
        payroll_race([blocked],'period close wins and payroll finalization rejects atomically',0)
        close_job.wait(timeout=20)
        if close_job.returncode:
            raise RuntimeError(close_job.stderr.read())
        if payroll_sql("select count(*)from payrolls where periode='2026-11'and status='draft'")!='2' or payroll_sql("select count(*)from journal_entries where source='payroll'and source_ref='2026-11'")!='0' or payroll_sql("select count(*)from cash_advance_installments where periode='2026-11'")!='0':
            raise RuntimeError('Period-close race partially settled money')
        print('PASS: period-close race leaves every draft and debt unchanged',flush=True)

    if 'hris_schedule_swaps.sql' in suites and 'hris_schedule_board_batch.sql' in suites:
        from hris_schedule_lock_tests import run_schedule_lock_races
        run_schedule_lock_races(command, env, container, docker)

finally:
    docker('rm', '-f', container, capture_output=True)
