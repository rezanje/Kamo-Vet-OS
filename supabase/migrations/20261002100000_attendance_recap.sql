begin;
-- One scoped JSON response: complete month, no silent relation row-limit loss.
create function public.hris_attendance_recap(p_start date,p_end date,p_branch_id uuid default null)returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[];result jsonb;is_owner boolean;
begin
 if auth.uid() is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'HRIS: Silakan login kembali';end if;
 perform 1 from public.profiles where id=auth.uid() for share;
 select role='OWNER' into is_owner from public.profiles where id=auth.uid() and role in('OWNER','ADMIN');
 if is_owner is null then raise exception 'HRIS: Rekap hanya untuk HR yang diizinkan';end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>61 then raise exception 'HRIS: Rentang rekap maksimal 62 hari';end if;
 if (p_branch_id is null and not is_owner)or(p_branch_id is not null and not public.hris_manage_branch(p_branch_id)) then raise exception 'HRIS: Pilih cabang yang diizinkan';end if;
 select coalesce(array_agg(e.id),'{}'::uuid[]) into ids from public.employees e where public.hris_manage_employee(e.id)
 and(p_branch_id is null or exists(select 1 from public.employee_branch_assignments a where a.employee_id=e.id and a.branch_id=p_branch_id and a.effective_date<=p_end));
 if cardinality(ids)>5000 then raise exception 'HRIS: Karyawan terlalu banyak; persempit cabang';end if;
 perform 1 from public.employees where id=any(ids) order by id for share;
 if exists(select 1 from public.employees where id=any(ids) and not public.hris_manage_employee(id)) then raise exception 'HRIS: Akses karyawan berubah. Muat ulang';end if;
 perform 1 from public.employee_schedules where employee_id=any(ids) and tanggal between p_start and p_end order by id for share;
 perform 1 from public.attendance where employee_id=any(ids) and tanggal between p_start and p_end order by id for share;
 perform 1 from public.work_shifts where id in(select shift_id from public.employee_schedules where employee_id=any(ids) and tanggal between p_start and p_end) order by id for share;
 if not is_owner and(exists(select 1 from public.employee_schedules s join public.work_shifts w on w.id=s.shift_id where s.employee_id=any(ids) and s.tanggal between p_start and p_end and w.branch_id is not null and not public.hris_manage_branch(w.branch_id))
 or exists(select 1 from public.attendance where employee_id=any(ids) and tanggal between p_start and p_end and branch_id is not null and not public.hris_manage_branch(branch_id))) then raise exception 'HRIS: Riwayat sumber berada di cabang lain. Gunakan OWNER untuk rekap lengkap';end if;
 if(select count(*) from public.employee_schedules where employee_id=any(ids) and tanggal between p_start and p_end)>100000 then raise exception 'HRIS: Rekap terlalu besar; persempit periode/cabang';end if;
 return jsonb_build_object('start',p_start,'end',p_end,'branch_id',p_branch_id,
 'employees',coalesce((select jsonb_agg(jsonb_build_object('id',id,'nama',nama)order by nama,id)from public.employees where id=any(ids)),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(jsonb_build_object('employee_id',employee_id,'branch_id',branch_id,'effective_date',effective_date))from public.employee_branch_assignments where employee_id=any(ids)and effective_date<=p_end),'[]'::jsonb),
 'schedules',coalesce((select jsonb_agg(jsonb_build_object('employee_id',s.employee_id,'tanggal',s.tanggal,'shift',to_jsonb(w))order by s.employee_id,s.tanggal)from public.employee_schedules s join public.work_shifts w on w.id=s.shift_id where s.employee_id=any(ids)and s.tanggal between p_start and p_end),'[]'::jsonb),
 'attendance',coalesce((select jsonb_agg(jsonb_build_object('id',id,'employee_id',employee_id,'tanggal',tanggal,'jam_masuk',jam_masuk,'jam_pulang',jam_pulang,'checked_in_at',checked_in_at,'checked_out_at',checked_out_at,'branch_id',branch_id,'is_void',is_void,'status',status)order by employee_id,tanggal)from public.attendance where employee_id=any(ids)and tanggal between p_start and p_end and not is_void),'[]'::jsonb),
 'leave',coalesce((select jsonb_agg(jsonb_build_object('employee_id',employee_id,'jenis',jenis,'tanggal_mulai',tanggal_mulai,'tanggal_selesai',tanggal_selesai))from public.leave_requests where employee_id=any(ids)and status='Disetujui' and jenis in('Cuti','Izin','Sakit') and tanggal_mulai<=p_end and coalesce(tanggal_selesai,tanggal_mulai)>=p_start),'[]'::jsonb),
 'overtime',coalesce((select jsonb_agg(jsonb_build_object('employee_id',employee_id,'tanggal',tanggal,'jam',jam))from public.overtime_requests where employee_id=any(ids)and status='Disetujui'and tanggal between p_start and p_end),'[]'::jsonb));
end$$;
revoke all on function public.hris_attendance_recap(date,date,uuid) from public,anon;
grant execute on function public.hris_attendance_recap(date,date,uuid) to authenticated;
commit;
