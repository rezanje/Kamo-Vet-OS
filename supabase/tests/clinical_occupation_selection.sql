-- Isolated fictional employees only. Verify existing care eligibility against
-- the exact job labels supplied by the explicit HR occupation selector.
begin;
insert into public.branches(id,code,name,type) values
 ('ed200000-0000-4000-8000-000000000001','JOB-A','Occupation test branch','KLINIK'),
 ('ed200000-0000-4000-8000-000000000002','JOB-B','Other occupation branch','KLINIK');
insert into public.employees(id,nama,jabatan,branch_id,status) values
 ('ed100000-0000-4000-8000-000000000001','Test doctor','Dokter','ed200000-0000-4000-8000-000000000001','Aktif'),
 ('ed100000-0000-4000-8000-000000000002','Test paramedic','Paramedis','ed200000-0000-4000-8000-000000000001','Aktif'),
 ('ed100000-0000-4000-8000-000000000003','Test groomer','Groomer','ed200000-0000-4000-8000-000000000001','Aktif'),
 ('ed100000-0000-4000-8000-000000000004','Drh Test label','PCA','ed200000-0000-4000-8000-000000000001','Aktif');
do $$
declare failed boolean;
begin
 if public.clinic_employee_roles('Paramedis') is distinct from array['paramedic']::text[]
   or public.clinic_employee_roles('Groomer') is distinct from array['groomer']::text[]
   or public.clinic_employee_roles('Dokter') is distinct from array['doctor']::text[]
   or public.clinic_employee_roles('PCA') is distinct from array[]::text[] then raise exception 'occupation classification differs from explicit HR labels'; end if;
 if public.clinic_staff_name('ed100000-0000-4000-8000-000000000002','ed200000-0000-4000-8000-000000000001','paramedic')<>'Test paramedic'
   or public.clinic_staff_name('ed100000-0000-4000-8000-000000000003','ed200000-0000-4000-8000-000000000001','groomer')<>'Test groomer' then raise exception 'explicit care staff not eligible'; end if;
 failed:=false;
 begin perform public.clinic_staff_name('ed100000-0000-4000-8000-000000000002','ed200000-0000-4000-8000-000000000001','doctor');
 exception when sqlstate 'P0001' then failed:=true; end;
 if not failed then raise exception 'paramedic accepted as visit doctor'; end if;
 failed:=false;
 begin perform public.clinic_staff_name('ed100000-0000-4000-8000-000000000004','ed200000-0000-4000-8000-000000000001','doctor');
 exception when sqlstate 'P0001' then failed:=true; end;
 if not failed then raise exception 'PCA or employee name inferred a clinical occupation'; end if;
 failed:=false;
 begin perform public.clinic_staff_name('ed100000-0000-4000-8000-000000000003','ed200000-0000-4000-8000-000000000002','groomer');
 exception when sqlstate 'P0001' then failed:=true; end;
 if not failed then raise exception 'unassigned groomer accepted at another branch'; end if;
 insert into public.employee_branch_assignments(employee_id,branch_id,role,effective_date)
 values('ed100000-0000-4000-8000-000000000003','ed200000-0000-4000-8000-000000000002','SECONDARY',current_date-1);
 if public.clinic_staff_name('ed100000-0000-4000-8000-000000000003','ed200000-0000-4000-8000-000000000002','groomer')<>'Test groomer' then raise exception 'effective secondary branch not recognized'; end if;
 update public.employees set status='Nonaktif' where id='ed100000-0000-4000-8000-000000000003';
 failed:=false;
 begin perform public.clinic_staff_name('ed100000-0000-4000-8000-000000000003','ed200000-0000-4000-8000-000000000002','groomer');
 exception when sqlstate 'P0001' then failed:=true; end;
 if not failed then raise exception 'inactive groomer accepted'; end if;
end;
$$;
rollback;
