-- Simpan kolom matriks yang belum menjadi field HRIS tanpa membukanya ke staf.
create table public.employee_import_details (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  fields jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now()
);

alter table public.employee_import_details enable row level security;
revoke all on public.employee_import_details from public, anon, authenticated;
grant select, insert on public.employee_import_details to authenticated;
grant all on public.employee_import_details to service_role;

create policy employee_import_details_admin_read
  on public.employee_import_details for select to authenticated
  using ((select public.is_admin()));

create policy employee_import_details_admin_insert
  on public.employee_import_details for insert to authenticated
  with check ((select public.is_admin()));

-- Satu panggilan = satu transaksi. Jika rincian atau penugasan gagal, data dasar ikut batal.
create function public.import_employee_excel(p_rows jsonb, p_branch_id uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_nik text;
  v_nama text;
  v_id uuid;
  v_inserted integer := 0;
  v_skipped integer := 0;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Hanya pemilik atau admin yang boleh mengimpor karyawan';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Isi file tidak sah atau terlalu besar';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 500
     or octet_length(p_rows::text) > 1048576 then
    raise exception 'Isi file tidak sah atau terlalu besar';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and is_active = true
  ) then
    raise exception 'Cabang tidak aktif atau tidak ditemukan';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) as t(value) loop
    if jsonb_typeof(v_row) is distinct from 'object'
       or jsonb_typeof(v_row->'details') is distinct from 'object' then
      raise exception 'Baris karyawan tidak sah';
    end if;
    v_nik := btrim(v_row->>'nik');
    v_nama := btrim(v_row->>'nama');
    if v_nik is null or v_nik = '' or length(v_nik) > 20
       or v_nama is null or v_nama = '' or length(v_nama) > 100
       or (v_row->>'status') not in ('Aktif', 'Nonaktif') then
      raise exception 'Identitas atau status karyawan tidak sah';
    end if;

    if exists (select 1 from public.employees where lower(nik) = lower(v_nik)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_id := null;
    insert into public.employees (nik, nama, jabatan, phone, email, tgl_masuk, status, branch_id)
    values (
      v_nik, v_nama, nullif(v_row->>'jabatan', ''), nullif(v_row->>'phone', ''),
      nullif(v_row->>'email', ''), nullif(v_row->>'tgl_masuk', '')::date,
      v_row->>'status', p_branch_id
    )
    on conflict (nik) do nothing
    returning id into v_id;

    if v_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.employee_import_details (employee_id, fields)
    values (v_id, v_row->'details');
    if p_branch_id is not null then
      insert into public.employee_branch_assignments (employee_id, branch_id, role, effective_date)
      values (v_id, p_branch_id, 'PRIMARY', coalesce(nullif(v_row->>'tgl_masuk', '')::date, current_date));
    end if;
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
end;
$$;

revoke all on function public.import_employee_excel(jsonb, uuid) from public, anon;
grant execute on function public.import_employee_excel(jsonb, uuid) to authenticated, service_role;
