-- Schedule mutations enter the source boundary BEFORE any identity, request,
-- employee or schedule row lock. The board, source writers and payroll already
-- take this lock first. Preserve the existing permissions and snapshot rules.
begin;

create or replace function public.hris_request_schedule_change(
  p_schedule_id uuid,
  p_expected_updated_at timestamptz,
  p_shift_id uuid,
  p_branch_id uuid,
  p_reason text
)
returns public.schedule_change_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid:=auth.uid();
  v_emp uuid;
  v_count int;
  v_row public.employee_schedules;
  v_shift public.work_shifts;
  v_old public.work_shifts;
  v_request public.schedule_change_requests;
  v_now timestamptz:=public.hris_schedule_now();
begin
  if v_uid is null
    or coalesce(auth.role(),'')<>'authenticated' then
    raise exception 'JADWAL: Silakan login kembali';
  end if;
  if p_reason is null
    or length(trim(p_reason)) not between 3 and 1000 then
    raise exception 'JADWAL: Alasan wajib 3–1000 karakter';
  end if;
  perform pg_advisory_xact_lock(72310402);
  perform 1
    from public.profiles
    where id=v_uid for share;
  if not found then
    raise exception 'JADWAL: Silakan login kembali';
  end if;
  select count(*),min(id::text)::uuid into v_count,v_emp
    from public.employees
    where profile_id=v_uid
    and status='Aktif';
  if v_count<>1 then
    raise exception 'JADWAL: Akun harus tertaut tepat satu karyawan aktif';
  end if;
  select id into v_emp
    from public.employees
    where id=v_emp
    and profile_id=v_uid
    and status='Aktif' for update;
  if not found then
    raise exception 'JADWAL: Tautan karyawan berubah. Muat ulang';
  end if;
  select count(*) into v_count
    from public.employees
    where profile_id=v_uid
    and status='Aktif';
  if v_count<>1 then
    raise exception 'JADWAL: Akun harus tertaut tepat satu karyawan aktif';
  end if;
  select * into v_row
    from public.employee_schedules
    where id=p_schedule_id
    and employee_id=v_emp for share;
  if not found then
    raise exception 'JADWAL: Jadwal sendiri tidak ditemukan';
  end if;
  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'JADWAL: Jadwal berubah. Muat ulang sebelum mengajukan';
  end if;
  if v_row.tanggal<(v_now at time zone 'Asia/Jakarta')::date then
    raise exception 'JADWAL: Pengajuan hanya untuk hari ini atau berikutnya';
  end if;
  if exists(select 1
    from public.attendance
    where employee_id=v_emp
    and tanggal=v_row.tanggal
    and not is_void) then
    raise exception 'JADWAL: Absensi sudah tercatat; hubungi HR untuk koreksi';
  end if;
  if exists(select 1
    from public.payrolls
    where employee_id=v_emp
    and periode=to_char(v_row.tanggal,'YYYY-MM')
    and status='final') then
    raise exception 'JADWAL: Periode gaji sudah final';
  end if;
  perform 1
    from public.branches
    where id=p_branch_id for share;
  perform 1
    from public.work_shifts
    where id in(v_row.shift_id,p_shift_id) order by id for share;
  select * into v_old
    from public.work_shifts
    where id=v_row.shift_id;
  select * into v_shift
    from public.work_shifts
    where id=p_shift_id;
  if p_branch_id is null
    or not public.hris_valid_schedule_shift(v_emp,v_row.tanggal,p_shift_id,p_branch_id)
    or (v_old.branch_id is not null
    and v_old.branch_id<>p_branch_id) then
    raise exception 'JADWAL: Cabang/shift tidak sesuai penugasan pada tanggal jadwal';
  end if;
  if v_row.shift_id=p_shift_id then
    raise exception 'JADWAL: Shift usulan sama dengan jadwal saat ini';
  end if;
  if exists(select 1
    from public.schedule_change_requests
    where employee_id=v_emp
    and tanggal=v_row.tanggal
    and status='Menunggu') then
    raise exception 'JADWAL: Masih ada pengajuan menunggu untuk tanggal ini';
  end if;
  insert into public.schedule_change_requests(employee_id,
    branch_id,
    tanggal,
    schedule_id,
    expected_updated_at,
    proposed_shift_id,
    old_schedule,
    old_shift,
    proposed_shift,
    requested_by,
    reason,
    created_at)
  values(v_emp,
    p_branch_id,
    v_row.tanggal,
    v_row.id,
    v_row.updated_at,
    p_shift_id,
    to_jsonb(v_row),
    to_jsonb(v_old),
    to_jsonb(v_shift),
    v_uid,
    trim(p_reason),
    v_now)
    returning * into v_request;
  insert into public.schedule_request_events(request_id,
    employee_id,
    branch_id,
    actor_id,
    reason,
    old_values,
    new_values,
    created_at)
  values(v_request.id,v_emp,p_branch_id,v_uid,trim(p_reason),'{}',to_jsonb(v_request),v_now);
  return v_request;
end;
$$;

create or replace function public.hris_decide_schedule_change(
  p_request_id uuid,
  p_approve boolean,
  p_reason text
)
returns public.schedule_change_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid:=auth.uid();
  v_r public.schedule_change_requests;
  v_row public.employee_schedules;
  v_before jsonb;
  v_new jsonb;
  v_shift public.work_shifts;
  v_old public.work_shifts;
  v_now timestamptz:=public.hris_schedule_now();
begin
  if v_uid is null
    or coalesce(auth.role(),'')<>'authenticated' then
    raise exception 'JADWAL: Silakan login kembali';
  end if;
  if p_reason is null
    or length(trim(p_reason)) not between 3 and 1000
    or p_approve is null then
    raise exception 'JADWAL: Keputusan dan alasan wajib diisi';
  end if;
  perform pg_advisory_xact_lock(72310402);
  perform 1
    from public.profiles
    where id=v_uid for share;
  if not found then
    raise exception 'JADWAL: Silakan login kembali';
  end if;
  select * into v_r
    from public.schedule_change_requests
    where id=p_request_id for update;
  if not found
    or not public.hris_manage_employee(v_r.employee_id)
    or not public.hris_manage_branch(v_r.branch_id) then
    raise exception 'JADWAL: Pengajuan tidak diizinkan';
  end if;
  if v_r.status<>'Menunggu' then
    raise exception 'JADWAL: Pengajuan sudah diputuskan. Muat ulang';
  end if;
  v_before:=to_jsonb(v_r);
  perform 1
    from public.employees
    where id=v_r.employee_id for update;
  if not public.hris_manage_employee(v_r.employee_id)
    or not public.hris_manage_branch(v_r.branch_id) then
    raise exception 'JADWAL: Akses karyawan/cabang berubah. Muat ulang';
  end if;
  if p_approve then
    if not exists(select 1
      from public.employees
      where id=v_r.employee_id
      and status='Aktif') then
      raise exception 'JADWAL: Karyawan tidak aktif';
    end if;
    if v_r.tanggal<(v_now at time zone 'Asia/Jakarta')::date then
      raise exception 'JADWAL: Tanggal pengajuan sudah lewat; tolak dan ajukan ulang';
    end if;
    if exists(select 1
      from public.attendance
      where employee_id=v_r.employee_id
      and tanggal=v_r.tanggal
      and not is_void) then
      raise exception 'JADWAL: Absensi sudah tercatat; jadwal tidak diubah';
    end if;
    if exists(select 1
      from public.payrolls
      where employee_id=v_r.employee_id
      and periode=to_char(v_r.tanggal,'YYYY-MM')
      and status='final') then
      raise exception 'JADWAL: Periode gaji sudah final';
    end if;
    select * into v_row
      from public.employee_schedules
      where id=v_r.schedule_id
      and employee_id=v_r.employee_id
      and tanggal=v_r.tanggal for update;
    if not found
      or v_row.updated_at is distinct from v_r.expected_updated_at
      or to_jsonb(v_row)<>v_r.old_schedule then
      raise exception 'JADWAL: Jadwal berubah sejak diajukan; tolak dan ajukan ulang';
    end if;
    perform 1
      from public.branches
      where id=v_r.branch_id for share;
    perform 1
      from public.work_shifts
      where id in(v_row.shift_id,v_r.proposed_shift_id) order by id for share;
    select * into v_old
      from public.work_shifts
      where id=v_row.shift_id;
    select * into v_shift
      from public.work_shifts
      where id=v_r.proposed_shift_id;
    if not public.hris_valid_schedule_shift(v_r.employee_id,v_r.tanggal,v_r.proposed_shift_id,v_r.branch_id)
      or to_jsonb(v_shift) is distinct from v_r.proposed_shift
      or to_jsonb(v_old) is distinct from v_r.old_shift then
      raise exception 'JADWAL: Shift atau penugasan berubah sejak diajukan; tolak dan ajukan ulang';
    end if;
    update public.employee_schedules set shift_id=v_r.proposed_shift_id
      where id=v_row.id
      returning to_jsonb(employee_schedules.*) into v_new;
  end if;
  update public.schedule_change_requests set status=case when p_approve then 'Disetujui' else 'Ditolak' end,
    decided_by=v_uid,
    decided_at=v_now,
    decision_reason=trim(p_reason)
    where id=v_r.id
    returning * into v_r;
  insert into public.schedule_request_events(request_id,
    employee_id,
    branch_id,
    actor_id,
    reason,
    old_values,
    new_values,
    created_at)
  values(v_r.id,
    v_r.employee_id,
    v_r.branch_id,
    v_uid,
    trim(p_reason),
    v_before,
    jsonb_build_object('request',to_jsonb(v_r),'effective_schedule',v_new),
    v_now);
  return v_r;
end;
$$;

create or replace function public.hris_request_schedule_swap(
  p_own_id uuid,
  p_own_version timestamptz,
  p_peer_id uuid,
  p_peer_version timestamptz,
  p_branch_id uuid,
  p_reason text
)
returns public.schedule_swap_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  e uuid;
  r public.schedule_swap_requests;
  a public.employee_schedules;
  b public.employee_schedules;
begin
  if auth.uid() is null
    or coalesce(auth.role(),'')<>'authenticated' then
    raise exception 'JADWAL: Silakan login kembali';
  end if;
  if p_reason is null
    or length(trim(p_reason)) not between 3 and 1000 then
    raise exception 'JADWAL: Alasan wajib 3–1000 karakter';
  end if;
  perform pg_advisory_xact_lock(72310402);
  e:=public.hris_swap_actor();
  select * into a
    from public.employee_schedules
    where id=p_own_id
    and employee_id=e;
  select * into b
    from public.employee_schedules
    where id=p_peer_id;
  if a.id is null
    or b.id is null
    or a.employee_id=b.employee_id
    or a.shift_id=b.shift_id
    or p_branch_id is null then
    raise exception 'JADWAL: Pilih dua karyawan dan shift berbeda pada cabang yang sesuai';
  end if;
  if a.updated_at is distinct from p_own_version
    or b.updated_at is distinct from p_peer_version then
    raise exception 'JADWAL: Jadwal berubah. Muat ulang';
  end if;
  r.employee_a:=e;
  r.employee_b:=b.employee_id;
  r.profile_a:=auth.uid();
  select profile_id into r.profile_b
    from public.employees
    where id=b.employee_id;
  if r.profile_b is null
    or r.profile_b=r.profile_a then
    raise exception 'JADWAL: Akun rekan belum tertaut unik';
  end if;
  r.schedule_a:=a.id;
  r.schedule_b:=b.id;
  r.date_a:=a.tanggal;
  r.date_b:=b.tanggal;
  r.branch_id:=p_branch_id;
  r.snapshot_a:=to_jsonb(a);
  r.snapshot_b:=to_jsonb(b);
  select to_jsonb(w) into r.shift_a
    from public.work_shifts w
    where id=a.shift_id;
  select to_jsonb(w) into r.shift_b
    from public.work_shifts w
    where id=b.shift_id;
  perform public.hris_assert_swap(r);
  if public.hris_swap_pending(e,a.tanggal)
    or public.hris_swap_pending(b.employee_id,b.tanggal)
    or exists(select 1
    from public.schedule_change_requests
    where status='Menunggu'
    and ((employee_id=e
    and tanggal=a.tanggal)or(employee_id=b.employee_id
    and tanggal=b.tanggal))) then
    raise exception 'JADWAL: Salah satu jadwal masih memiliki pengajuan menunggu';
  end if;
  insert into public.schedule_swap_requests(employee_a,
    employee_b,
    profile_a,
    profile_b,
    schedule_a,
    schedule_b,
    date_a,
    date_b,
    branch_id,
    snapshot_a,
    snapshot_b,
    shift_a,
    shift_b,
    reason,
    name_a,
    name_b)
  values(r.employee_a,
    r.employee_b,
    r.profile_a,
    r.profile_b,
    r.schedule_a,
    r.schedule_b,
    r.date_a,
    r.date_b,
    r.branch_id,
    r.snapshot_a,
    r.snapshot_b,
    r.shift_a,
    r.shift_b,
    trim(p_reason),
    (select nama
    from public.employees
    where id=r.employee_a),(select nama
    from public.employees
    where id=r.employee_b))
    returning * into r;
  insert into public.schedule_swap_events(request_id,
    actor_id,
    reason,
    old_values,
    new_values)values(r.id,
    auth.uid(),
    trim(p_reason),
    '{}',
    to_jsonb(r));
  return r;
end;
$$;

create or replace function public.hris_transition_schedule_swap(
  p_id uuid,
  p_action text,
  p_accept boolean,
  p_reason text
)
returns public.schedule_swap_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.schedule_swap_requests;
  old_r jsonb;
  new_a jsonb;
  new_b jsonb;
  u uuid:=auth.uid();
begin
  if u is null
    or coalesce(auth.role(),'')<>'authenticated' then
    raise exception 'JADWAL: Silakan login kembali';
  end if;
  if p_reason is null
    or length(trim(p_reason)) not between 3 and 1000
    or p_accept is null then
    raise exception 'JADWAL: Keputusan dan alasan wajib diisi';
  end if;
  perform pg_advisory_xact_lock(72310402);
  perform 1
    from public.profiles
    where id=u for share;
  select * into r
    from public.schedule_swap_requests
    where id=p_id for update;
  if not found then
    raise exception 'JADWAL: Pengajuan tidak diizinkan';
  end if;
  old_r:=to_jsonb(r);
  if p_action='peer' then
    if u<>r.profile_b
      or r.status<>'Menunggu rekan' then
      raise exception 'JADWAL: Hanya rekan yang diminta dapat menjawab pengajuan menunggu';
    end if;
    if p_accept then
      perform public.hris_assert_swap(r);
    end if;
    r.status:=case when p_accept then 'Menunggu HR' else 'Ditolak' end;
    r.peer_reason:=trim(p_reason);
    r.peer_at:=public.hris_schedule_now();
  elsif p_action='cancel' then
    if u<>r.profile_a
      or r.status not in('Menunggu rekan','Menunggu HR') then
      raise exception 'JADWAL: Pengajuan tidak dapat dibatalkan';
    end if;
    r.status:='Dibatalkan';
  elsif p_action='hr' then
    perform 1
      from public.employees
      where id in(r.employee_a,r.employee_b) order by id for update;
    if not public.hris_manage_employee(r.employee_a)
      or not public.hris_manage_employee(r.employee_b)
      or not public.hris_manage_branch(r.branch_id) then
      raise exception 'JADWAL: Pengajuan cabang/karyawan tidak diizinkan';
    end if;
    if r.status not in('Menunggu rekan','Menunggu HR') then
      raise exception 'JADWAL: Pengajuan sudah diputuskan';
    end if;
    if p_accept then
      if r.status<>'Menunggu HR' then
        raise exception 'JADWAL: Tunggu persetujuan rekan';
      end if;
      perform public.hris_assert_swap(r);
      update public.employee_schedules set shift_id=(r.shift_b->>'id')::uuid
        where id=r.schedule_a
        returning to_jsonb(employee_schedules.*)into new_a;
      update public.employee_schedules set shift_id=(r.shift_a->>'id')::uuid
        where id=r.schedule_b
        returning to_jsonb(employee_schedules.*)into new_b;
    end if;
    r.status:=case when p_accept then 'Disetujui' else 'Ditolak' end;
  else
    raise exception 'JADWAL: Tindakan tidak valid';
  end if;
  if r.status in('Disetujui','Ditolak','Dibatalkan') then
    r.decided_by:=u;
    r.decision_reason:=trim(p_reason);
    r.decided_at:=public.hris_schedule_now();
  end if;
  update public.schedule_swap_requests set status=r.status,
    peer_at=r.peer_at,
    peer_reason=r.peer_reason,
    decided_by=r.decided_by,
    decided_at=r.decided_at,
    decision_reason=r.decision_reason
    where id=r.id
    returning * into r;
  insert into public.schedule_swap_events(request_id,
    actor_id,
    reason,
    old_values,
    new_values)values(r.id,
    u,
    trim(p_reason),
    old_r,
    jsonb_build_object('request',to_jsonb(r),'schedule_a',new_a,'schedule_b',new_b));
  return r;
end;
$$;

-- CREATE OR REPLACE keeps the existing function ACLs: public single/swap RPCs
-- remain authenticated-only and the shared transition stays private.
commit;
