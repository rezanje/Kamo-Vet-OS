-- HRIS pilot access (keputusan owner 27 Okt 2026, opsi A).
--
-- Sebelumnya setiap tabel HRIS punya satu policy `*_all using (true)`: akun mana pun yang
-- login bisa membaca dan mengubah gaji, slip, kasbon, dan reimburse lewat Data API.
--
-- Aturan baru:
--   OWNER   : semua.
--   FINANCE : baca semua data HRIS dan uang (pembukuan, sinkron, laporan gaji); tidak mengubah.
--   ADMIN   : kelola direktori karyawan, absensi, cuti, lembur, jadwal, shift, KPI untuk cabang
--             yang boleh ia akses; TIDAK melihat angka gaji, slip, kasbon, reimburse.
--   STAFF / DOCTOR : data dirinya sendiri (absen, ajukan cuti/lembur/kasbon/reimburse).
--   Semua akun login: direktori karyawan tanpa gaji (pemilih dokter/petugas/penjual),
--             shift & jadwal (jadwal dokter klinik), aturan komisi & target (layar operasional).
--
-- Gaji pokok dipindah dari `employees.gaji_pokok` (tabel direktori yang dibaca semua orang)
-- ke `employee_base_salaries`. Kolom lama dipaku 0 dengan constraint supaya tidak bisa
-- terisi lagi tanpa sengaja.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------- helper peran
create or replace function private.hris_role()
returns text language sql security definer stable set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid()) and p.is_active;
$$;

create or replace function private.is_hris_owner()
returns boolean language sql security definer stable set search_path = '' as $$
  select coalesce(private.hris_role() = 'OWNER', false);
$$;

create or replace function private.can_read_hris_money()
returns boolean language sql security definer stable set search_path = '' as $$
  select coalesce(private.hris_role() in ('OWNER', 'FINANCE'), false);
$$;

-- ADMIN mengelola cabang yang ia pegang. Tanpa header cabang operasional: layar HRIS
-- melihat seluruh cabang miliknya sekaligus. Karyawan tanpa cabang (data lama) ikut terkelola.
create or replace function private.can_manage_hris_branch(target_branch uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select private.is_hris_owner()
    or (private.hris_role() = 'ADMIN' and (
      target_branch is null
      or public.has_role_capability('all_branches')
      or exists (
        select 1 from public.user_branches ub
        where ub.user_id = (select auth.uid()) and ub.branch_id = target_branch
      )
    ));
$$;

create or replace function private.can_manage_hris_employee(target_employee uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select private.is_hris_owner()
    or exists (
      select 1 from public.employees e
      where e.id = target_employee
        and (
          private.can_manage_hris_branch(e.branch_id)
          or exists (
            select 1 from public.employee_branch_assignments a
            where a.employee_id = e.id and a.branch_id is not null
              and private.can_manage_hris_branch(a.branch_id)
          )
        )
    );
$$;

create or replace function private.is_own_employee(target_employee uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.employees e
    where e.id = target_employee and e.profile_id = (select auth.uid())
  );
$$;

-- Lihat data kerja (absen, cuti, lembur, KPI): diri sendiri, pengelola cabang, atau FINANCE.
create or replace function private.can_read_hris_work(target_employee uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select private.can_read_hris_money()
    or private.is_own_employee(target_employee)
    or private.can_manage_hris_employee(target_employee);
$$;

-- Uang (kasbon, reimburse): diri sendiri, OWNER, atau FINANCE. ADMIN tidak.
create or replace function private.can_read_hris_own_money(target_employee uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select private.can_read_hris_money() or private.is_own_employee(target_employee);
$$;

create or replace function private.can_manage_hris_schedule(target_employee uuid, target_shift uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select private.is_hris_owner()
    or (
      private.can_manage_hris_employee(target_employee)
      and exists (
        select 1 from public.work_shifts ws
        where ws.id = target_shift and private.can_manage_hris_branch(ws.branch_id)
      )
    );
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'private.hris_role()', 'private.is_hris_owner()', 'private.can_read_hris_money()',
    'private.can_manage_hris_branch(uuid)', 'private.can_manage_hris_employee(uuid)',
    'private.is_own_employee(uuid)', 'private.can_read_hris_work(uuid)',
    'private.can_read_hris_own_money(uuid)', 'private.can_manage_hris_schedule(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- gaji pokok
create table if not exists public.employee_base_salaries (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  gaji_pokok numeric not null default 0 check (gaji_pokok >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.employee_base_salaries enable row level security;
grant select, insert, update, delete on public.employee_base_salaries to authenticated;

insert into public.employee_base_salaries (employee_id, gaji_pokok, updated_by)
select id, gaji_pokok, null from public.employees where gaji_pokok <> 0
on conflict (employee_id) do update set gaji_pokok = excluded.gaji_pokok;

do $$
declare moved numeric; source numeric;
begin
  select coalesce(sum(gaji_pokok), 0) into source from public.employees;
  select coalesce(sum(s.gaji_pokok), 0) into moved
  from public.employee_base_salaries s join public.employees e on e.id = s.employee_id;
  if moved <> source then
    raise exception 'HRIS_SALARY_COPY_MISMATCH source=% moved=%', source, moved;
  end if;
end $$;

update public.employees set gaji_pokok = 0 where gaji_pokok <> 0;
alter table public.employees drop constraint if exists employees_gaji_pokok_moved;
alter table public.employees add constraint employees_gaji_pokok_moved check (gaji_pokok = 0);
comment on column public.employees.gaji_pokok is
  'Tidak dipakai lagi (selalu 0). Gaji pokok ada di employee_base_salaries (OWNER/FINANCE).';

-- ---------------------------------------------------------------- kasbon selisih kas
-- Kasir (STAFF) yang menutup shift dengan kas kurang mencatat kasbon atas nama pembuka shift.
-- Dulu lewat insert langsung; sekarang lewat fungsi yang memeriksa shift-nya sungguh baru
-- ditutup dengan selisih minus, supaya akun biasa tidak bisa membuat utang karyawan lain.
create or replace function public.record_shift_cash_shortage(p_shift_id uuid)
returns table (advance_id uuid, employee_id uuid, employee_name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_shift public.cashier_shifts%rowtype;
  v_emp record;
  v_alasan text;
  v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'HRIS_SHORTAGE_AUTH'; end if;
  select * into v_shift from public.cashier_shifts where id = p_shift_id for update;
  if not found then raise exception 'HRIS_SHORTAGE_SHIFT_NOT_FOUND'; end if;
  if not (
    public.has_role_capability('all_branches')
    or exists (select 1 from public.user_branches ub
               where ub.user_id = (select auth.uid()) and ub.branch_id = v_shift.branch_id)
  ) then
    raise exception 'HRIS_SHORTAGE_BRANCH_DENIED';
  end if;
  if v_shift.status <> 'closed' or v_shift.closed_at is null
     or v_shift.closed_at < now() - interval '15 minutes'
     or coalesce(v_shift.selisih, 0) >= 0 then
    raise exception 'HRIS_SHORTAGE_NOT_ELIGIBLE';
  end if;

  select e.id, e.nama into v_emp from public.employees e
  where e.profile_id = v_shift.opened_by and e.status = 'Aktif' and e.trashed_at is null
  limit 1;
  if v_emp.id is null then return; end if;

  v_alasan := 'Selisih kas kurang saat tutup shift ' || left(p_shift_id::text, 8);
  if exists (select 1 from public.cash_advances ca where ca.alasan = v_alasan) then
    raise exception 'HRIS_SHORTAGE_DUPLICATE';
  end if;

  insert into public.cash_advances (employee_id, tanggal, jumlah, tenor_bulan, status, alasan, disbursed_at)
  values (v_emp.id, (now() at time zone 'Asia/Jakarta')::date, abs(v_shift.selisih), 1, 'Disetujui', v_alasan, now())
  returning id into v_id;

  return query select v_id, v_emp.id, v_emp.nama::text;
end $$;

-- Jurnal selisih gagal → kasbonnya dibatalkan lagi oleh kasir yang sama.
create or replace function public.cancel_shift_cash_shortage(p_shift_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_shift public.cashier_shifts%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'HRIS_SHORTAGE_AUTH'; end if;
  select * into v_shift from public.cashier_shifts where id = p_shift_id;
  if not found then raise exception 'HRIS_SHORTAGE_SHIFT_NOT_FOUND'; end if;
  if not (
    public.has_role_capability('all_branches')
    or exists (select 1 from public.user_branches ub
               where ub.user_id = (select auth.uid()) and ub.branch_id = v_shift.branch_id)
  ) then
    raise exception 'HRIS_SHORTAGE_BRANCH_DENIED';
  end if;
  if exists (select 1 from public.journal_entries j where j.source = 'shift' and j.source_ref = p_shift_id::text) then
    raise exception 'HRIS_SHORTAGE_JOURNAL_EXISTS';
  end if;
  delete from public.cash_advances ca
  where ca.alasan = 'Selisih kas kurang saat tutup shift ' || left(p_shift_id::text, 8)
    and ca.status = 'Disetujui'
    and not exists (select 1 from public.cash_advance_installments i where i.advance_id = ca.id);
end $$;

revoke all on function public.record_shift_cash_shortage(uuid) from public, anon;
revoke all on function public.cancel_shift_cash_shortage(uuid) from public, anon;
grant execute on function public.record_shift_cash_shortage(uuid) to authenticated;
grant execute on function public.cancel_shift_cash_shortage(uuid) to authenticated;

-- ---------------------------------------------------------------- policies
drop policy if exists employees_all on public.employees;
drop policy if exists attendance_all on public.attendance;
drop policy if exists leave_all on public.leave_requests;
drop policy if exists payrolls_all on public.payrolls;
drop policy if exists work_shifts_all on public.work_shifts;
drop policy if exists employee_schedules_all on public.employee_schedules;
drop policy if exists salary_components_all on public.salary_components;
drop policy if exists emp_salary_components_all on public.employee_salary_components;
drop policy if exists payroll_settings_all on public.payroll_settings;
drop policy if exists overtime_requests_all on public.overtime_requests;
drop policy if exists cash_advances_all on public.cash_advances;
drop policy if exists cash_advance_inst_all on public.cash_advance_installments;
drop policy if exists reimbursements_all on public.reimbursements;
drop policy if exists kpi_all on public.kpi_records;
drop policy if exists commission_rules_all on public.commission_rules;
drop policy if exists sales_targets_all on public.sales_targets;

-- Direktori karyawan: dibaca semua akun login (tanpa gaji); dikelola OWNER/ADMIN cabang.
create policy employees_select_directory on public.employees
  for select to authenticated using (true);
create policy employees_insert_manager on public.employees
  for insert to authenticated
  with check ((select private.can_manage_hris_branch(branch_id)));
create policy employees_update_manager on public.employees
  for update to authenticated
  using ((select private.can_manage_hris_employee(id)))
  with check ((select private.can_manage_hris_branch(branch_id)) or (select private.can_manage_hris_employee(id)));
-- `select ... for share` dari fungsi klinik (set_visit_service_state, dsb.) wajib lolos
-- USING policy UPDATE. Policy ini hanya membuka penguncian baris; WITH CHECK false
-- membuat UPDATE nyata oleh non-pengelola tetap ditolak.
create policy employees_lock_directory on public.employees
  for update to authenticated using (true) with check (false);
create policy employees_delete_owner on public.employees
  for delete to authenticated using ((select private.is_hris_owner()));

create policy employee_base_salaries_owner_all on public.employee_base_salaries
  for all to authenticated
  using ((select private.is_hris_owner())) with check ((select private.is_hris_owner()));
create policy employee_base_salaries_select_finance on public.employee_base_salaries
  for select to authenticated using ((select private.can_read_hris_money()));

-- Uang murni: OWNER kelola, FINANCE baca.
do $$
declare t text;
begin
  foreach t in array array['payrolls', 'salary_components', 'employee_salary_components', 'cash_advance_installments'] loop
    execute format('create policy %I on public.%I for all to authenticated using ((select private.is_hris_owner())) with check ((select private.is_hris_owner()))', t || '_owner_all', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.can_read_hris_money()))', t || '_select_finance', t);
  end loop;
end $$;

-- Aturan gaji (tarif lembur, potongan telat): dibaca pengelola & FINANCE, diubah OWNER.
create policy payroll_settings_owner_all on public.payroll_settings
  for all to authenticated
  using ((select private.is_hris_owner())) with check ((select private.is_hris_owner()));
create policy payroll_settings_select_manager on public.payroll_settings
  for select to authenticated
  using ((select private.hris_role()) in ('ADMIN', 'FINANCE'));

-- Kasbon & reimburse: karyawan sendiri / OWNER / FINANCE. ADMIN tidak melihat.
create policy cash_advances_owner_all on public.cash_advances
  for all to authenticated
  using ((select private.is_hris_owner())) with check ((select private.is_hris_owner()));
create policy cash_advances_select_allowed on public.cash_advances
  for select to authenticated
  using ((select private.can_read_hris_own_money(employee_id)));
create policy cash_advances_insert_self on public.cash_advances
  for insert to authenticated
  with check (
    (select private.is_own_employee(employee_id))
    and status = 'Menunggu' and approved_by is null and approved_at is null
    and disbursed_at is null and cash_account_id is null
  );

create policy reimbursements_owner_all on public.reimbursements
  for all to authenticated
  using ((select private.is_hris_owner())) with check ((select private.is_hris_owner()));
create policy reimbursements_select_allowed on public.reimbursements
  for select to authenticated
  using ((select private.can_read_hris_own_money(employee_id)));
create policy reimbursements_insert_self on public.reimbursements
  for insert to authenticated
  with check (
    (select private.is_own_employee(employee_id))
    and status = 'Menunggu' and approved_by is null and approved_at is null and paid_periode is null
  );

-- Data kerja.
create policy attendance_owner_all on public.attendance
  for all to authenticated
  using ((select private.is_hris_owner())) with check ((select private.is_hris_owner()));
create policy attendance_select_allowed on public.attendance
  for select to authenticated using ((select private.can_read_hris_work(employee_id)));
create policy attendance_insert_self on public.attendance
  for insert to authenticated
  with check ((select private.is_own_employee(employee_id)) and status = 'Hadir');
create policy attendance_update_self on public.attendance
  for update to authenticated
  using ((select private.is_own_employee(employee_id)))
  with check ((select private.is_own_employee(employee_id)) and status = 'Hadir');
create policy attendance_write_manager on public.attendance
  for all to authenticated
  using ((select private.can_manage_hris_employee(employee_id)))
  with check ((select private.can_manage_hris_employee(employee_id)));

create policy leave_requests_owner_all on public.leave_requests
  for all to authenticated
  using ((select private.is_hris_owner())) with check ((select private.is_hris_owner()));
create policy leave_requests_select_allowed on public.leave_requests
  for select to authenticated using ((select private.can_read_hris_work(employee_id)));
create policy leave_requests_insert_self on public.leave_requests
  for insert to authenticated
  with check ((select private.is_own_employee(employee_id)) and status = 'Menunggu');
create policy leave_requests_write_manager on public.leave_requests
  for all to authenticated
  using ((select private.can_manage_hris_employee(employee_id)))
  with check ((select private.can_manage_hris_employee(employee_id)));

create policy overtime_requests_owner_all on public.overtime_requests
  for all to authenticated
  using ((select private.is_hris_owner())) with check ((select private.is_hris_owner()));
create policy overtime_requests_select_allowed on public.overtime_requests
  for select to authenticated using ((select private.can_read_hris_work(employee_id)));
create policy overtime_requests_insert_self on public.overtime_requests
  for insert to authenticated
  with check (
    (select private.is_own_employee(employee_id))
    and status = 'Menunggu' and approved_by is null and approved_at is null
  );
create policy overtime_requests_update_manager on public.overtime_requests
  for update to authenticated
  using ((select private.can_manage_hris_employee(employee_id)))
  with check ((select private.can_manage_hris_employee(employee_id)));

create policy kpi_records_owner_all on public.kpi_records
  for all to authenticated
  using ((select private.is_hris_owner())) with check ((select private.is_hris_owner()));
create policy kpi_records_select_allowed on public.kpi_records
  for select to authenticated using ((select private.can_read_hris_work(employee_id)));
create policy kpi_records_write_manager on public.kpi_records
  for all to authenticated
  using ((select private.can_manage_hris_employee(employee_id)))
  with check ((select private.can_manage_hris_employee(employee_id)));

-- Shift & jadwal: dibaca semua (jadwal dokter klinik), dikelola OWNER/ADMIN cabang.
create policy work_shifts_select_all on public.work_shifts
  for select to authenticated using (true);
create policy work_shifts_write_manager on public.work_shifts
  for all to authenticated
  using ((select private.can_manage_hris_branch(branch_id)))
  with check ((select private.can_manage_hris_branch(branch_id)));

create policy employee_schedules_select_all on public.employee_schedules
  for select to authenticated using (true);
create policy employee_schedules_write_manager on public.employee_schedules
  for all to authenticated
  using ((select private.can_manage_hris_schedule(employee_id, shift_id)))
  with check ((select private.can_manage_hris_schedule(employee_id, shift_id)));

-- Aturan komisi & target: konfigurasi operasional, dibaca semua, diubah OWNER/ADMIN.
create policy commission_rules_select_all on public.commission_rules
  for select to authenticated using (true);
create policy commission_rules_write_admin on public.commission_rules
  for all to authenticated
  using ((select private.hris_role()) in ('OWNER', 'ADMIN'))
  with check ((select private.hris_role()) in ('OWNER', 'ADMIN'));

create policy sales_targets_select_all on public.sales_targets
  for select to authenticated using (true);
create policy sales_targets_write_admin on public.sales_targets
  for all to authenticated
  using ((select private.hris_role()) in ('OWNER', 'ADMIN'))
  with check ((select private.hris_role()) in ('OWNER', 'ADMIN'));
