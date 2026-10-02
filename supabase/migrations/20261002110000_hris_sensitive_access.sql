begin;
create function public.hris_owner()returns boolean language sql stable security definer set search_path='' as $$select coalesce(auth.role(),'')='authenticated' and exists(select 1 from public.profiles where id=auth.uid()and role='OWNER')$$;
create function public.hris_finance_employee(e uuid)returns boolean language sql stable security definer set search_path='' as $$
 select public.hris_manage_employee(e)or exists(select 1 from public.profiles p join public.employees emp on emp.id=e where p.id=auth.uid()and p.role='FINANCE'
 and exists(select 1 from public.employee_branch_assignments a join public.user_branches u on u.branch_id=a.branch_id and u.user_id=p.id where a.employee_id=e and a.branch_id=emp.branch_id and a.effective_date<=(statement_timestamp()at time zone'Asia/Jakarta')::date and u.effective_date<=(statement_timestamp()at time zone'Asia/Jakarta')::date)
 and not exists(select 1 from public.employee_branch_assignments a where a.employee_id=e and(a.effective_date>(statement_timestamp()at time zone'Asia/Jakarta')::date or not exists(select 1 from public.user_branches u where u.user_id=p.id and u.branch_id=a.branch_id and u.effective_date<=(statement_timestamp()at time zone'Asia/Jakarta')::date))))
$$;
create function public.hris_read_employee(e uuid)returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.employees where id=e and profile_id=auth.uid())or public.hris_finance_employee(e)$$;
revoke all on function public.hris_owner(),public.hris_finance_employee(uuid),public.hris_read_employee(uuid) from public,anon;
grant execute on function public.hris_owner(),public.hris_finance_employee(uuid),public.hris_read_employee(uuid) to authenticated;
drop policy employees_read on public.employees;
create policy employees_read on public.employees for select to authenticated using(public.hris_read_employee(id));
drop policy payrolls_all on public.payrolls;
create policy payroll_read on public.payrolls for select to authenticated using(public.hris_read_employee(employee_id));
-- Raw draft writes retained only for OWNER until next atomic settlement migration.
create policy payroll_owner_write on public.payrolls for all to authenticated using(public.hris_owner())with check(public.hris_owner());
drop policy if exists user_branches_admin_write on public.user_branches;
drop policy if exists user_branches_admin_insert on public.user_branches;
drop policy if exists user_branches_admin_update on public.user_branches;
drop policy if exists user_branches_admin_delete on public.user_branches;
create policy user_branch_owner_write on public.user_branches for all to authenticated using(public.hris_owner())with check(public.hris_owner());
drop policy employee_branch_assignments_select on public.employee_branch_assignments;
drop policy employee_branch_assignments_write on public.employee_branch_assignments;
create policy employee_assignment_read on public.employee_branch_assignments for select to authenticated using(public.hris_read_employee(employee_id));
create policy employee_assignment_write on public.employee_branch_assignments for all to authenticated using(public.hris_manage_employee(employee_id)and public.hris_manage_branch(branch_id))with check(public.hris_manage_branch(branch_id)and(public.hris_manage_employee(employee_id)or exists(select 1 from public.employees e where e.id=employee_id and e.branch_id=employee_branch_assignments.branch_id and not exists(select 1 from public.employee_branch_assignments a where a.employee_id=e.id))));
drop policy salary_components_all on public.salary_components;
create policy salary_component_read on public.salary_components for select to authenticated using(exists(select 1 from public.profiles where id=auth.uid()and role in('OWNER','ADMIN','FINANCE')));
create policy salary_component_write on public.salary_components for all to authenticated using(public.hris_owner())with check(public.hris_owner());
drop policy emp_salary_components_all on public.employee_salary_components;
create policy assigned_salary_read on public.employee_salary_components for select to authenticated using(public.hris_read_employee(employee_id));
create policy assigned_salary_write on public.employee_salary_components for all to authenticated using(public.hris_manage_employee(employee_id))with check(public.hris_manage_employee(employee_id));
drop policy payroll_settings_all on public.payroll_settings;
create policy payroll_settings_read on public.payroll_settings for select to authenticated using(exists(select 1 from public.profiles where id=auth.uid()and role in('OWNER','ADMIN','FINANCE')));
create policy payroll_settings_write on public.payroll_settings for all to authenticated using(public.hris_owner())with check(public.hris_owner());

-- Money-related request rows are only written through authenticated transitions.
drop policy leave_all on public.leave_requests;
drop policy overtime_requests_all on public.overtime_requests;
drop policy cash_advances_all on public.cash_advances;
drop policy reimbursements_all on public.reimbursements;
drop policy cash_advance_inst_all on public.cash_advance_installments;
create policy leave_read on public.leave_requests for select to authenticated using(public.hris_read_employee(employee_id));
create policy overtime_read on public.overtime_requests for select to authenticated using(public.hris_read_employee(employee_id));
create policy advance_read on public.cash_advances for select to authenticated using(public.hris_read_employee(employee_id));
create policy reimbursement_read on public.reimbursements for select to authenticated using(public.hris_read_employee(employee_id));
create policy installment_read on public.cash_advance_installments for select to authenticated using(exists(select 1 from public.cash_advances a where a.id=advance_id));
-- Settlement writes move to an atomic RPC in the following migration too.
create policy installment_owner_write on public.cash_advance_installments for all to authenticated using(public.hris_owner())with check(public.hris_owner());
create policy advance_owner_update on public.cash_advances for update to authenticated using(public.hris_owner())with check(public.hris_owner());
create policy reimbursement_owner_update on public.reimbursements for update to authenticated using(public.hris_owner())with check(public.hris_owner());
revoke insert,delete on public.leave_requests,public.overtime_requests,public.cash_advances,public.reimbursements from authenticated,anon;
revoke update on public.leave_requests,public.overtime_requests from authenticated,anon;

create table public.hris_request_events(id uuid primary key default gen_random_uuid(),kind text not null,request_id uuid not null,employee_id uuid not null references public.employees(id),actor_id uuid not null references public.profiles(id),reason text not null,old_values jsonb not null,new_values jsonb not null,created_at timestamptz not null default now());
alter table public.hris_request_events enable row level security;
create policy request_event_read on public.hris_request_events for select to authenticated using(public.hris_read_employee(employee_id));
revoke insert,update,delete on public.hris_request_events from authenticated,anon;
grant select on public.hris_request_events to authenticated;

create function public.hris_request_employee(p_employee uuid default null)returns uuid language plpgsql security definer set search_path='' as $$
declare e uuid;n int;u uuid:=auth.uid();begin
 if u is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'HRIS: Silakan login kembali';end if;
 perform 1 from public.profiles where id=u for share;
 if p_employee is null then select count(*),min(id::text)::uuid into n,e from public.employees where profile_id=u and status='Aktif';if n<>1 then raise exception 'HRIS: Akun harus tertaut tepat satu karyawan aktif';end if;
 else e:=p_employee;if not public.hris_manage_employee(e)then raise exception 'HRIS: Karyawan tidak diizinkan';end if;end if;
 perform 1 from public.employees where id=e for update;
 if p_employee is null then if(select count(*)from public.employees where profile_id=u and status='Aktif')<>1 or not exists(select 1 from public.employees where id=e and profile_id=u and status='Aktif')then raise exception 'HRIS: Tautan karyawan berubah. Muat ulang';end if;
 elsif not public.hris_manage_employee(e)or not exists(select 1 from public.employees where id=e and status='Aktif')then raise exception 'HRIS: Karyawan tidak diizinkan';end if;
 return e;
end$$;
create function public.hris_submit_staff_request(p_kind text,p_payload jsonb,p_employee uuid default null)returns jsonb language plpgsql security definer set search_path='' as $$
declare e uuid:=public.hris_request_employee(p_employee);r jsonb;v_reason text:=trim(coalesce(p_payload->>'alasan',p_payload->>'keterangan',''));d date;z date;v_id uuid;v_amount numeric;v_tenor int;v_jenis text;
begin
 if length(v_reason)not between 3 and 1000 then raise exception 'HRIS: Alasan wajib 3–1000 karakter';end if;
 if p_kind='leave'then
  v_jenis:=p_payload->>'jenis';d:=(p_payload->>'tanggal_mulai')::date;z:=coalesce(nullif(p_payload->>'tanggal_selesai','')::date,d);
  if v_jenis not in('Cuti','Izin','Sakit')or v_jenis is null or d is null or z<d or z-d>365 then raise exception 'HRIS: Jenis/tanggal cuti tidak valid; lembur gunakan pengajuan lembur';end if;
  if exists(select 1 from public.payrolls where employee_id=e and status='final'and periode between to_char(d,'YYYY-MM')and to_char(z,'YYYY-MM'))then raise exception 'HRIS: Cuti tidak dapat mengubah periode gaji final';end if;
  insert into public.leave_requests(employee_id,jenis,tanggal_mulai,tanggal_selesai,durasi,alasan)values(e,v_jenis,d,z,z-d+1,v_reason)returning to_jsonb(leave_requests.*)into r;
 elsif p_kind='overtime'then
  d:=(p_payload->>'tanggal')::date;v_amount:=(p_payload->>'jam')::numeric;
  if d is null or d>(statement_timestamp()at time zone'Asia/Jakarta')::date or v_amount is null or v_amount<=0 or v_amount>24 then raise exception 'HRIS: Tanggal/jam lembur tidak valid';end if;
  if exists(select 1 from public.payrolls where employee_id=e and periode=to_char(d,'YYYY-MM')and status='final')then raise exception 'HRIS: Periode gaji sudah final';end if;
  insert into public.overtime_requests(employee_id,tanggal,jam,alasan)values(e,d,v_amount,v_reason)returning to_jsonb(overtime_requests.*)into r;
 elsif p_kind='cash'then
  if v_reason like 'Selisih kas kurang saat tutup shift%'then raise exception 'HRIS: Selisih kas hanya dari tutup shift terverifikasi';end if;
  v_amount:=(p_payload->>'jumlah')::numeric;v_tenor:=coalesce((p_payload->>'tenor_bulan')::int,1);d:=(statement_timestamp()at time zone'Asia/Jakarta')::date;
  if v_amount is null or v_amount<=0 or v_amount>1000000000000 or v_tenor not between 1 and 24 then raise exception 'HRIS: Nominal/tenor kasbon tidak valid';end if;
  if exists(select 1 from public.cash_advances where employee_id=e and status in('Menunggu','Disetujui')and coalesce(alasan,'')not like 'Selisih kas kurang saat tutup shift%')then raise exception 'HRIS: Masih ada kasbon pribadi yang belum lunas';end if;
  insert into public.cash_advances(employee_id,tanggal,jumlah,tenor_bulan,alasan)values(e,d,v_amount,v_tenor,v_reason)returning to_jsonb(cash_advances.*)into r;
 elsif p_kind='reimburse'then
  d:=coalesce(nullif(p_payload->>'tanggal','')::date,(statement_timestamp()at time zone'Asia/Jakarta')::date);v_amount:=(p_payload->>'jumlah')::numeric;
  if d>(statement_timestamp()at time zone'Asia/Jakarta')::date or v_amount is null or v_amount<=0 or v_amount>1000000000000 or length(trim(coalesce(p_payload->>'kategori','')))not between 1 and 40 then raise exception 'HRIS: Tanggal/kategori/nominal reimburse tidak valid';end if;
  insert into public.reimbursements(employee_id,tanggal,kategori,jumlah,keterangan)values(e,d,trim(p_payload->>'kategori'),v_amount,v_reason)returning to_jsonb(reimbursements.*)into r;
 else raise exception 'HRIS: Jenis pengajuan tidak dikenal';end if;
 insert into public.hris_request_events(kind,request_id,employee_id,actor_id,reason,old_values,new_values)values(p_kind,(r->>'id')::uuid,e,auth.uid(),v_reason,'{}',r);return r;
 exception when invalid_text_representation or datetime_field_overflow then raise exception 'HRIS: Nilai tanggal/angka pengajuan tidak valid';
end$$;


-- Existing invoker triggers must resolve tables when called by empty-path RPCs.
create or replace function public.check_period_lock()returns trigger language plpgsql set search_path=''as $$
declare v_closed date;begin
 select closed_until into v_closed from public.accounting_locks where id;
 if v_closed is not null and((tg_op in('INSERT','UPDATE')and new.tanggal<=v_closed)or(tg_op in('UPDATE','DELETE')and old.tanggal<=v_closed))then raise exception 'HRIS: Periode pembukuan sudah ditutup';end if;
 return coalesce(new,old);
end$$;
create or replace function public.check_period_lock_lines()returns trigger language plpgsql set search_path=''as $$
declare v_closed date;v_date date;begin
 select closed_until into v_closed from public.accounting_locks where id;
 select tanggal into v_date from public.journal_entries where id=coalesce(new.entry_id,old.entry_id);
 if v_closed is not null and v_date<=v_closed then raise exception 'HRIS: Periode pembukuan sudah ditutup';end if;return coalesce(new,old);
end$$;
create or replace function public.tolak_jurnal_ke_akun_header()returns trigger language plpgsql set search_path=''as $$begin
 if exists(select 1 from public.coa_accounts where id=new.account_id and is_header)then raise exception 'HRIS: Akun induk tidak boleh dipakai memposting jurnal';end if;return new;
end$$;

-- Private atomic posting shared by disbursement and next payroll settlement RPC.
create function public.hris_post_financial_journal(p_source text,p_ref text,p_branch uuid,p_date date,p_description text,p_lines jsonb)returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_closed date;v_debit numeric;v_credit numeric;v_line jsonb;v_account uuid;
begin
 select closed_until into v_closed from public.accounting_locks where id for share;
 if not found or(p_date<=v_closed)then raise exception 'HRIS: Periode pembukuan sudah ditutup atau status tidak tersedia';end if;
 if p_source not in('kasbon','payroll','shift')or p_ref is null or jsonb_typeof(p_lines)<>'array'then raise exception 'HRIS: Sumber jurnal tidak valid';end if;
 select sum((x->>'debit')::numeric),sum((x->>'credit')::numeric)into v_debit,v_credit from jsonb_array_elements(p_lines)x;
 if v_debit is null or v_debit<=0 or v_debit>1000000000000000 or v_debit is distinct from v_credit then raise exception 'HRIS: Jurnal tidak seimbang';end if;
 if exists(select 1 from public.journal_entries where source=p_source and source_ref=p_ref)then raise exception 'HRIS: Sumber sudah memiliki jurnal; tidak diposting dua kali';end if;
 insert into public.journal_entries(no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)values('JRN-'||to_char(p_date,'YYYYMM')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,11),p_date,p_description,p_source,p_ref,p_branch)returning id into v_id;
 for v_line in select * from jsonb_array_elements(p_lines)loop
  if coalesce((v_line->>'debit')::numeric,-1)<0 or coalesce((v_line->>'credit')::numeric,-1)<0 or((v_line->>'debit')::numeric>0 and(v_line->>'credit')::numeric>0)then raise exception 'HRIS: Baris jurnal tidak valid';end if;
  select id into v_account from public.coa_accounts where code=v_line->>'code'and is_active and not is_header for share;
  if not found then raise exception 'HRIS: Akun jurnal tidak tersedia/aktif atau merupakan akun induk';end if;
  if(v_line->>'debit')::numeric>0 or(v_line->>'credit')::numeric>0 then insert into public.journal_lines(entry_id,account_id,debit,credit)values(v_id,v_account,(v_line->>'debit')::numeric,(v_line->>'credit')::numeric);end if;
 end loop;return v_id;
end$$;
create function public.hris_cash_code(p_method text,p_branch uuid,p_account uuid default null)returns text language plpgsql security definer set search_path='' as $$
declare a public.cash_accounts;v_account uuid;begin
 v_account:=p_account;
 if v_account is null then select cash_account_id into v_account from public.payment_account_map where metode=p_method and(branch_id=p_branch or branch_id is null)order by branch_id nulls last limit 1 for share;end if;
 select * into a from public.cash_accounts where is_active and((v_account is not null and id=v_account)or(v_account is null and coa_code=case when p_method='Tunai'then'1101'else'1102'end))for share;
 if not found or(a.branch_id is not null and a.branch_id is distinct from p_branch and not public.hris_owner())then raise exception 'HRIS: Rekening pembayaran tidak diizinkan';end if;return a.coa_code;
end$$;
create function public.hris_decide_staff_request(p_kind text,p_id uuid,p_approve boolean,p_reason text,p_tenor int default 1,p_account uuid default null)returns jsonb language plpgsql security definer set search_path='' as $$
declare old_r jsonb;r jsonb;e uuid;v_code text;v_id uuid;begin
 if auth.uid() is null or coalesce(auth.role(),'')<>'authenticated'or p_approve is null or p_reason is null or length(trim(p_reason))not between 3 and 1000 then raise exception 'HRIS: Keputusan/alasan wajib diisi oleh HR';end if;
 perform 1 from public.profiles where id=auth.uid()for share;
 -- Lock employee before request, same order as source collectors/settlement.
 if p_kind='leave'then select employee_id into e from public.leave_requests where id=p_id;
 elsif p_kind='overtime'then select employee_id into e from public.overtime_requests where id=p_id;
 elsif p_kind='cash'then select employee_id into e from public.cash_advances where id=p_id;
 elsif p_kind='reimburse'then select employee_id into e from public.reimbursements where id=p_id;
 else raise exception 'HRIS: Jenis pengajuan tidak dikenal';end if;
 perform 1 from public.employees where id=e for update;
 if e is null or not public.hris_manage_employee(e)then raise exception 'HRIS: Karyawan tidak diizinkan';end if;
 if p_kind='leave'then select to_jsonb(x)into old_r from public.leave_requests x where id=p_id for update;
 elsif p_kind='overtime'then select to_jsonb(x)into old_r from public.overtime_requests x where id=p_id for update;
 elsif p_kind='cash'then select to_jsonb(x)into old_r from public.cash_advances x where id=p_id for update;
 else select to_jsonb(x)into old_r from public.reimbursements x where id=p_id for update;end if;
 if old_r->>'status'<>'Menunggu'then raise exception 'HRIS: Pengajuan sudah diputuskan';end if;
 if p_approve and p_kind in('leave','overtime')and exists(select 1 from public.payrolls where employee_id=e and status='final'and periode between to_char(coalesce((old_r->>'tanggal_mulai')::date,(old_r->>'tanggal')::date),'YYYY-MM')and to_char(coalesce((old_r->>'tanggal_selesai')::date,(old_r->>'tanggal_mulai')::date,(old_r->>'tanggal')::date),'YYYY-MM'))then raise exception 'HRIS: Periode gaji sudah final';end if;
 if p_kind='cash'and p_approve then
  if p_tenor is null or p_tenor not between 1 and 24 then raise exception 'HRIS: Tenor harus 1–24 bulan';end if;
  v_code:=public.hris_cash_code('Transfer',(select branch_id from public.employees where id=e),p_account);
  v_id:=public.hris_post_financial_journal('kasbon','KSB-'||p_id::text,(select branch_id from public.employees where id=e),(statement_timestamp()at time zone'Asia/Jakarta')::date,'Kasbon disetujui',jsonb_build_array(jsonb_build_object('code','1203','debit',(old_r->>'jumlah')::numeric,'credit',0),jsonb_build_object('code',v_code,'debit',0,'credit',(old_r->>'jumlah')::numeric)));
 end if;
 if p_kind='leave'then update public.leave_requests set status=case when p_approve then'Disetujui'::public.leave_status else'Ditolak'::public.leave_status end where id=p_id returning to_jsonb(leave_requests.*)into r;
 elsif p_kind='overtime'then update public.overtime_requests set status=case when p_approve then'Disetujui'else'Ditolak'end,catatan_penyetuju=trim(p_reason),approved_by=auth.uid(),approved_at=statement_timestamp()where id=p_id returning to_jsonb(overtime_requests.*)into r;
 elsif p_kind='cash'then update public.cash_advances set status=case when p_approve then'Disetujui'else'Ditolak'end,catatan_penyetuju=trim(p_reason),approved_by=auth.uid(),approved_at=statement_timestamp(),tenor_bulan=case when p_approve then p_tenor else tenor_bulan end,disbursed_at=case when p_approve then statement_timestamp()end,cash_account_id=case when p_approve then p_account end where id=p_id returning to_jsonb(cash_advances.*)into r;
 else update public.reimbursements set status=case when p_approve then'Disetujui'else'Ditolak'end,catatan_penyetuju=trim(p_reason),approved_by=auth.uid(),approved_at=statement_timestamp()where id=p_id returning to_jsonb(reimbursements.*)into r;end if;
 insert into public.hris_request_events(kind,request_id,employee_id,actor_id,reason,old_values,new_values)values(p_kind,p_id,e,auth.uid(),trim(p_reason),old_r,r);return r;
end$$;

-- Preserve cashier automatic debt without permitting arbitrary approved inserts.
alter table public.cash_advances add column source_shift_id uuid references public.cashier_shifts(id);
create unique index advance_source_shift_unique on public.cash_advances(source_shift_id)where source_shift_id is not null;
create function public.hris_record_shift_shortage(p_shift uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.cashier_shifts;e public.employees;r jsonb;v_code text;v_journal uuid;
begin
 if auth.uid() is null or coalesce(auth.role(),'')<>'authenticated'then raise exception 'HRIS: Silakan login kembali';end if;
 perform 1 from public.profiles where id=auth.uid()for share;
 select * into s from public.cashier_shifts where id=p_shift for update;
 if s.id is null or(s.opened_by is distinct from auth.uid()and not public.hris_manage_branch(s.branch_id))or s.status<>'closed'or s.selisih is null or s.selisih>=0 or s.selisih is distinct from(s.closing_balance-s.expected_cash)then raise exception 'HRIS: Selisih shift tidak sah';end if;
 perform 1 from public.profiles where id=s.opened_by for share;
 select * into e from public.employees where profile_id=s.opened_by and status='Aktif'for update;
 if e.id is null or(select count(*)from public.employees where profile_id=s.opened_by and status='Aktif')<>1 or not exists(select 1 from public.employee_branch_assignments where employee_id=e.id and branch_id=s.branch_id and effective_date<=(s.closed_at at time zone'Asia/Jakarta')::date)then raise exception 'HRIS: Kasir belum tertaut unik/ditugaskan ke cabang shift';end if;
 if s.opened_by is distinct from auth.uid()and not public.hris_manage_employee(e.id)then raise exception 'HRIS: Karyawan shift tidak diizinkan';end if;
 if exists(select 1 from public.cash_advances where source_shift_id=s.id)then raise exception 'HRIS: Selisih shift sudah dibebankan';end if;
 v_code:=public.hris_cash_code('Tunai',s.branch_id,null);
 v_journal:=public.hris_post_financial_journal('shift',s.id::text,s.branch_id,(statement_timestamp()at time zone'Asia/Jakarta')::date,'Selisih kas kurang — ditanggung '||e.nama,jsonb_build_array(jsonb_build_object('code','1203','debit',abs(s.selisih),'credit',0),jsonb_build_object('code',v_code,'debit',0,'credit',abs(s.selisih))));
 insert into public.cash_advances(employee_id,tanggal,jumlah,tenor_bulan,status,alasan,disbursed_at,source_shift_id,approved_by,approved_at)values(e.id,(statement_timestamp()at time zone'Asia/Jakarta')::date,abs(s.selisih),1,'Disetujui','Selisih kas kurang saat tutup shift '||s.id::text,statement_timestamp(),s.id,auth.uid(),statement_timestamp())returning to_jsonb(cash_advances.*)into r;
 insert into public.hris_request_events(kind,request_id,employee_id,actor_id,reason,old_values,new_values)values('shift_shortage',(r->>'id')::uuid,e.id,auth.uid(),r->>'alasan','{}',r);
 return jsonb_build_object('name',e.nama,'advance',r,'journal_id',v_journal);
end$$;
revoke all on function public.hris_request_employee(uuid),public.hris_post_financial_journal(text,text,uuid,date,text,jsonb),public.hris_cash_code(text,uuid,uuid)from public,anon,authenticated;
revoke all on function public.hris_submit_staff_request(text,jsonb,uuid),public.hris_decide_staff_request(text,uuid,boolean,text,int,uuid),public.hris_record_shift_shortage(uuid)from public,anon;
grant execute on function public.hris_submit_staff_request(text,jsonb,uuid),public.hris_decide_staff_request(text,uuid,boolean,text,int,uuid),public.hris_record_shift_shortage(uuid)to authenticated;

-- Operational name selectors do not expose salary, identity, bank or contact fields.
create view public.employee_directory with(security_barrier=true)as
 select e.id,e.nama,e.jabatan,e.status,e.branch_id,
 array(select a.branch_id from public.employee_branch_assignments a where a.employee_id=e.id and a.effective_date<=(statement_timestamp()at time zone'Asia/Jakarta')::date)as assigned_branch_ids
 from public.employees e where coalesce(auth.role(),'')='authenticated'and
 (e.profile_id=auth.uid()or public.hris_owner()or public.user_can_access_branch(e.branch_id)
 or exists(select 1 from public.employee_branch_assignments a where a.employee_id=e.id and a.effective_date<=(statement_timestamp()at time zone'Asia/Jakarta')::date and public.user_can_access_branch(a.branch_id)));
create view public.employee_schedule_directory with(security_barrier=true)as
 select s.employee_id,s.tanggal,s.shift_id,w.is_libur from public.employee_schedules s join public.work_shifts w on w.id=s.shift_id
 join public.employee_directory e on e.id=s.employee_id
 where w.branch_id is null or public.user_can_access_branch(w.branch_id);
revoke all on public.employee_directory,public.employee_schedule_directory from public,anon;
grant select on public.employee_directory,public.employee_schedule_directory to authenticated;

-- Existing branch-null accounting policies also covered company salary totals.
create function public.hris_read_journal(p_entry uuid)returns boolean language sql stable security definer set search_path=''as $$
 select coalesce(auth.role(),'')='authenticated'and exists(select 1 from public.journal_entries j where j.id=p_entry and
 (case when j.source='payroll'then public.hris_owner()
 when j.source='kasbon'then public.hris_owner()or exists(select 1 from public.cash_advances a where (j.source_ref='KSB-'||a.id::text or j.source_ref='KSB-'||left(a.id::text,8))and public.hris_read_employee(a.employee_id))
 else true end))
$$;
revoke all on function public.hris_read_journal(uuid)from public,anon;
grant execute on function public.hris_read_journal(uuid)to authenticated;
create policy hris_journal_privacy on public.journal_entries as restrictive for select to authenticated using(public.hris_read_journal(id));
create policy hris_journal_line_privacy on public.journal_lines as restrictive for select to authenticated using(public.hris_read_journal(entry_id));

-- Keep established treasury roles, close raw API writes by STAFF.
create function public.hris_treasury_role()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce(auth.role(),'')='authenticated'and exists(select 1 from public.profiles where id=auth.uid()and role in('OWNER','ADMIN','FINANCE'))
$$;
revoke all on function public.hris_treasury_role()from public,anon;
grant execute on function public.hris_treasury_role()to authenticated;
do $$declare t text;begin foreach t in array array['coa_accounts','cash_accounts','payment_account_map','accounting_locks']loop
 execute format('create policy hris_treasury_insert on public.%I as restrictive for insert to authenticated with check(public.hris_treasury_role())',t);
 execute format('create policy hris_treasury_update on public.%I as restrictive for update to authenticated using(public.hris_treasury_role())with check(public.hris_treasury_role())',t);
 execute format('create policy hris_treasury_delete on public.%I as restrictive for delete to authenticated using(public.hris_treasury_role())',t);
 end loop;end$$;

-- Recheck direct HR configuration writes after participant/actor locks.
create function public.hris_guard_configuration()returns trigger language plpgsql security definer set search_path=''as $$
declare e uuid;b uuid;begin
 if coalesce(auth.role(),'')='authenticated'and current_setting('role',true)='authenticated'then
 perform 1 from public.profiles where id=auth.uid()for share;
 if tg_table_name='employees'then
  if tg_op<>'INSERT'and not public.hris_manage_employee(old.id)then raise exception 'HRIS: Akses karyawan berubah';end if;
  if tg_op<>'DELETE'and not public.hris_manage_branch(new.branch_id)then raise exception 'HRIS: Cabang karyawan tidak diizinkan';end if;
 else
  perform 1 from public.employees where id in(case when tg_op<>'INSERT'then old.employee_id end,case when tg_op<>'DELETE'then new.employee_id end)order by id for update;
  if tg_op<>'INSERT'and not public.hris_manage_employee(old.employee_id)then raise exception 'HRIS: Akses karyawan berubah';end if;
  if tg_op<>'DELETE'then
   if tg_table_name='employee_branch_assignments'then
    if not public.hris_manage_branch(new.branch_id)or not(public.hris_manage_employee(new.employee_id)or exists(select 1 from public.employees emp where emp.id=new.employee_id and emp.branch_id=new.branch_id and not exists(select 1 from public.employee_branch_assignments a where a.employee_id=emp.id)))then raise exception 'HRIS: Penugasan tidak diizinkan';end if;
   elsif not public.hris_manage_employee(new.employee_id)then raise exception 'HRIS: Komponen karyawan tidak diizinkan';end if;
  end if;
 end if;end if;
 if tg_op='DELETE'then return old;else return new;end if;
end$$;
create trigger hris_a_configuration_guard before insert or update or delete on public.employees for each row execute function public.hris_guard_configuration();
create trigger hris_a_configuration_guard before insert or update or delete on public.employee_branch_assignments for each row execute function public.hris_guard_configuration();
create trigger hris_a_configuration_guard before insert or update or delete on public.employee_salary_components for each row execute function public.hris_guard_configuration();
revoke all on function public.hris_guard_configuration()from public,anon,authenticated;

create function public.hris_pending_shift_shortages()returns jsonb language plpgsql security definer set search_path=''as $$
declare result jsonb;begin
 if coalesce(auth.role(),'')<>'authenticated'or not exists(select 1 from public.profiles where id=auth.uid()and role in('OWNER','ADMIN'))then raise exception 'HRIS: Hanya HR dapat memproses selisih tertunda';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'closed_at',s.closed_at,'amount',abs(s.selisih),'name',e.nama)order by s.closed_at),'[]')into result
 from public.cashier_shifts s join public.employees e on e.profile_id=s.opened_by and e.status='Aktif'
 where s.status='closed'and s.selisih<0 and public.hris_manage_branch(s.branch_id)and public.hris_manage_employee(e.id)
 and not exists(select 1 from public.cash_advances a where a.source_shift_id=s.id)
 and not exists(select 1 from public.journal_entries j where j.source='shift'and j.source_ref=s.id::text);
 return result;
end$$;
revoke all on function public.hris_pending_shift_shortages()from public,anon;
grant execute on function public.hris_pending_shift_shortages()to authenticated;
commit;
