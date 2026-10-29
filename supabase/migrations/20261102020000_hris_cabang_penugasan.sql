-- AUDIT HRIS 2026-10-29 — temuan T1 & T2.
--
-- T1  Mayoritas karyawan aktif tidak punya cabang utama, dan form Edit Karyawan
--     tidak punya isian cabang sama sekali. Akibatnya mereka tidak pernah muncul
--     sebagai pilihan dokter/petugas/groomer di klinik maupun kasir.
--     Perbaikan: RPC baru set_employee_primary_branches() — dipakai Edit Karyawan
--     (satu orang) dan layar pembersihan massal (banyak orang sekaligus) — yang
--     memindahkan cabang utama, merapikan baris penugasan, dan mencatat riwayat.
--
-- T2  Penugasan lintas cabang tidak bisa diakhiri. Tabelnya hanya punya tanggal
--     mulai, jadi sekali ditugaskan seseorang selamanya ikut muncul sebagai
--     pilihan petugas di cabang itu.
--     Perbaikan: kolom end_date/ended_* + RPC end_employee_branch_assignment(),
--     dan SELURUH pembaca penugasan sekarang menyaring tanggal berakhir.
--
-- Riwayat penugasan: primary key tabelnya (employee_id, branch_id), jadi satu
-- pasangan orang+cabang hanya boleh punya SATU baris — tidak mungkin menyimpan
-- beberapa periode sebagai baris terpisah tanpa membongkar PK dan seluruh
-- pembacanya. Pilihan yang diambil: baris yang sama DIBUKA KEMBALI
-- (end_date dikosongkan, effective_date diisi tanggal mulai yang baru) dan
-- seluruh periode lama disimpan di tabel jejak employee_branch_change_log.
--
-- Semua tambalan pada fungsi yang sudah berjalan memakai jangkar eksak di atas
-- definisi berjalan (pg_get_functiondef + replace), gagal tertutup bila
-- definisinya sudah berubah, dan dilewati bila tambalannya sudah terpasang
-- (migrasi boleh dijalankan ulang). Migrasi lama tidak diubah.
--
-- Pra-pemeriksaan Production 29 Okt 2026 (hitungan saja, tanpa data pribadi):
-- 113 karyawan aktif, 88 tanpa cabang utama, 56 tanpa cabang utama sekaligus
-- tanpa penugasan; 204 baris penugasan (26 PRIMARY, 178 SECONDARY).
-- BELUM DITERAPKAN ke database mana pun selain klaster uji sekali pakai.
--
-- ---------------------------------------------------------------------------
-- CARA MEMERIKSA SETELAH DIPASANG (semua SELECT, aman dijalankan kapan saja)
-- ---------------------------------------------------------------------------
--  1. Kolom & aturan terpasang:
--       select column_name from information_schema.columns
--        where table_name='employee_branch_assignments'
--          and column_name in ('end_date','ended_at','ended_by','ended_reason');
--       -- harus 4 baris
--  2. Kolom pengakhiran terkunci dari tulis langsung:
--       select count(*) from information_schema.column_privileges
--        where grantee='authenticated' and table_name='employee_branch_assignments'
--          and column_name in ('end_date','ended_at','ended_by','ended_reason')
--          and privilege_type in ('INSERT','UPDATE');
--       -- harus 0
--  3. Seluruh pembaca menyaring tanggal berakhir:
--       select p.oid::regprocedure::text
--         from pg_proc p where p.proname in ('clinic_demo_care_staff','clinic_save_initial_record',
--              'set_visit_service_state','clinic_staff_name','normalize_service_performers',
--              'guard_clinic_line_salesperson','guard_clinic_record_seller','change_master_data_lifecycle')
--          and position('employee_assignment_current' in pg_get_functiondef(p.oid)) = 0;
--       -- harus 0 baris
--  4. Tidak ada data lama yang berubah: migrasi ini tidak melakukan UPDATE/DELETE
--     atas baris penugasan yang sudah ada. Pembandingnya:
--       select count(*), count(end_date) from public.employee_branch_assignments;
--       -- jumlah baris sama dengan sebelum pemasangan, count(end_date) = 0
--
-- ---------------------------------------------------------------------------
-- CARA MEMBATALKAN (rollback) — jalankan dalam SATU transaksi
-- ---------------------------------------------------------------------------
-- Migrasi ini hanya MENAMBAH kolom/tabel/fungsi dan menambahkan satu saringan
-- pada delapan fungsi; tidak ada baris data lama yang diubah. Pembatalannya:
--
--   begin;
--   -- a. kembalikan kedelapan fungsi + assign_employee_secondary_branches ke
--   --    definisi sebelum migrasi ini (jalankan ulang migrasi sumbernya:
--   --    20261012110000, 20261023121700, 20261006090000, 20261023143000,
--   --    20261027150000, 20261021134543, 20261005100000).
--   -- b. kembalikan hak tulis kolom:
--   grant insert, update on table public.employee_branch_assignments to authenticated;
--   -- c. lepas RPC dan tabel jejak:
--   drop function if exists public.set_employee_primary_branches(uuid[], uuid, text);
--   drop function if exists public.end_employee_branch_assignment(uuid, uuid, date, text);
--   drop function if exists public.reopen_employee_branch_assignments(uuid, uuid[], date);
--   drop table if exists public.employee_branch_change_log;
--   drop function if exists public.employee_assignment_current(date, date);
--   -- d. kolom end_date boleh DITINGGAL (aplikasi lama mengabaikannya). Hanya
--   --    bila benar-benar harus bersih — ini MENGHAPUS riwayat pengakhiran:
--   -- alter table public.employee_branch_assignments
--   --   drop column end_date, drop column ended_at, drop column ended_by, drop column ended_reason;
--   commit;
--
-- Kompatibilitas maju-mundur: aplikasi versi lama tidak mengenal end_date dan
-- akan menampilkan penugasan yang sudah berakhir seolah masih berjalan, tetapi
-- tidak akan error. Jadi migrasi boleh dipasang sebelum kode di-deploy.

-- ---------------------------------------------------------------------------
-- 1. Kolom akhir penugasan
-- ---------------------------------------------------------------------------
alter table public.employee_branch_assignments
  add column if not exists end_date date,
  add column if not exists ended_at timestamptz,
  add column if not exists ended_by uuid, -- tanpa FK berantai: jejak bertahan saat akun dirapikan
  add column if not exists ended_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employee_branch_assignment_end_after_start') then
    alter table public.employee_branch_assignments
      add constraint employee_branch_assignment_end_after_start
      check (end_date is null or end_date >= effective_date);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employee_branch_assignment_end_needs_reason') then
    -- Penugasan yang diakhiri wajib punya pelaku dan alasan; baris yang masih
    -- berjalan tidak boleh menyimpan sisa jejak pengakhiran.
    alter table public.employee_branch_assignments
      add constraint employee_branch_assignment_end_needs_reason
      check (
        (end_date is null and ended_at is null and ended_by is null and ended_reason is null)
        or (end_date is not null and ended_by is not null and length(btrim(ended_reason)) between 3 and 300)
      );
  end if;
end $$;

comment on column public.employee_branch_assignments.end_date is
  'Hari terakhir penugasan berlaku. Null = masih berjalan. Boleh bertanggal depan.';

create index if not exists employee_branch_assignments_current
  on public.employee_branch_assignments(branch_id, employee_id) where end_date is null;

-- Mengakhiri penugasan HANYA boleh lewat RPC beraudit di bawah.
--
-- Policy tabel ini `for all to authenticated` untuk OWNER/ADMIN, jadi tanpa
-- penguncian kolom seorang ADMIN bisa mengisi end_date langsung lewat PostgREST
-- dan tidak ada satu pun baris jejak yang tertulis — "penugasan diakhiri dan
-- tercatat pelakunya" jadi tidak bisa dipegang. Hak kolom tidak bisa dicabut
-- sebagian dari hak setingkat tabel, jadi INSERT/UPDATE dicabut dulu lalu
-- diberikan ulang hanya untuk kolom yang memang diisi aplikasi
-- (Tambah Karyawan, impor Excel, dan penugasan lintas cabang).
-- SELECT/DELETE tidak diubah; fungsi SECURITY DEFINER berjalan sebagai pemilik
-- fungsi sehingga tidak terpengaruh pencabutan ini.
do $acl$
begin
  revoke insert, update on table public.employee_branch_assignments from authenticated, anon;
  grant insert (employee_id, branch_id, role, effective_date, created_at)
    on table public.employee_branch_assignments to authenticated;
  grant update (employee_id, branch_id, role, effective_date)
    on table public.employee_branch_assignments to authenticated;
end $acl$;

-- ---------------------------------------------------------------------------
-- 2. Jejak perubahan cabang karyawan
-- ---------------------------------------------------------------------------
create table if not exists public.employee_branch_change_log (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  action text not null check (action in ('primary_branch', 'assignment_ended', 'assignment_reopened')),
  branch_id uuid references public.branches(id),
  old_branch_id uuid references public.branches(id),
  new_branch_id uuid references public.branches(id),
  effective_date date,
  end_date date,
  reason text check (reason is null or length(btrim(reason)) between 3 and 300),
  actor_id uuid not null, -- tanpa FK berantai: jejak bertahan saat akun dirapikan
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists employee_branch_change_log_employee
  on public.employee_branch_change_log(employee_id, created_at desc);

comment on table public.employee_branch_change_log is
  'Siapa mengubah cabang utama / mengakhiri / membuka kembali penugasan, kapan, dari mana ke mana, dan alasannya.';

alter table public.employee_branch_change_log enable row level security;
drop policy if exists employee_branch_change_log_read on public.employee_branch_change_log;
create policy employee_branch_change_log_read on public.employee_branch_change_log
  for select to authenticated using (
    exists (select 1 from public.profiles where id = auth.uid() and is_active and role in ('OWNER', 'ADMIN'))
    and (select private.can_manage_hris_employee(employee_id))
  );
-- Hanya RPC SECURITY DEFINER di bawah yang menulis jejak ini.
revoke all on table public.employee_branch_change_log from anon, authenticated;
grant select on table public.employee_branch_change_log to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Satu definisi "penugasan sedang berlaku", dipakai seluruh pembaca
-- ---------------------------------------------------------------------------
create or replace function public.employee_assignment_current(p_effective date, p_end date)
returns boolean language sql stable set search_path = '' as $$
  select p_effective <= (now() at time zone 'Asia/Jakarta')::date
    and (p_end is null or p_end >= (now() at time zone 'Asia/Jakarta')::date)
$$;
revoke all on function public.employee_assignment_current(date, date) from public, anon, service_role;
grant execute on function public.employee_assignment_current(date, date) to authenticated;
comment on function public.employee_assignment_current(date, date) is
  'True bila penugasan sudah mulai dan belum berakhir menurut tanggal WIB hari ini.';

-- ---------------------------------------------------------------------------
-- 4. RPC: pindahkan cabang utama (satu orang maupun massal)
-- ---------------------------------------------------------------------------
create or replace function public.set_employee_primary_branches(
  p_employee_ids uuid[], p_branch_id uuid, p_reason text default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ids uuid[];
  v_id uuid;
  v_employee public.employees%rowtype;
  v_branch public.branches%rowtype;
  v_old uuid;
  v_changed integer := 0;
begin
  if auth.uid() is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  perform 1 from public.profiles where id = auth.uid() and role in ('OWNER', 'ADMIN') and is_active = true for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: hanya pemilik atau admin aktif yang boleh mengubah cabang utama';
  end if;
  if p_employee_ids is null or p_branch_id is null
    or array_ndims(p_employee_ids) is distinct from 1
    or cardinality(p_employee_ids) not between 1 and 200
    or array_position(p_employee_ids, null) is not null then
    raise exception using errcode = 'P0001', message = 'BRANCH_INVALID: pilih satu sampai 200 karyawan dan satu cabang tujuan';
  end if;
  if v_reason is not null and length(v_reason) not between 3 and 300 then
    raise exception using errcode = 'P0001', message = 'BRANCH_INVALID: alasan harus 3 sampai 300 karakter';
  end if;
  select array_agg(id order by id) into v_ids from (select distinct unnest(p_employee_ids) id) selected;

  select * into v_branch from public.branches where id = p_branch_id for share;
  if not found or not v_branch.is_active then
    raise exception using errcode = 'P0001', message = 'BRANCH_INVALID: cabang tujuan harus aktif';
  end if;
  if not public.user_can_access_branch(p_branch_id) or not private.can_manage_hris_branch(p_branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang tujuan tidak diizinkan';
  end if;

  foreach v_id in array v_ids loop
    select * into v_employee from public.employees where id = v_id for update;
    if not found or v_employee.trashed_at is not null then
      raise exception using errcode = 'P0001', message = 'BRANCH_INVALID: karyawan tidak ditemukan atau berada di Sampah';
    end if;
    if not private.can_manage_hris_employee(v_id) then
      raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: ada karyawan di luar cabang yang diizinkan';
    end if;
    v_old := v_employee.branch_id;
    if v_old is not distinct from p_branch_id then
      continue; -- sudah di cabang itu: tidak ada perubahan, tidak ada jejak palsu
    end if;

    -- Cabang utama lama turun jadi penugasan tambahan yang berakhir hari ini,
    -- supaya riwayatnya tetap terbaca tetapi pemilih klinik berhenti memakainya.
    update public.employee_branch_assignments
      set role = 'SECONDARY'::public.branch_assignment_role,
          end_date = greatest(v_today, effective_date),
          ended_at = now(),
          ended_by = auth.uid(),
          ended_reason = coalesce(v_reason, 'Cabang utama dipindahkan')
      where employee_id = v_id and role = 'PRIMARY';

    update public.employees set branch_id = p_branch_id where id = v_id;

    insert into public.employee_branch_assignments (employee_id, branch_id, role, effective_date)
      values (v_id, p_branch_id, 'PRIMARY'::public.branch_assignment_role, v_today)
      on conflict (employee_id, branch_id) do update
        set role = 'PRIMARY'::public.branch_assignment_role,
            effective_date = least(public.employee_branch_assignments.effective_date, v_today),
            end_date = null, ended_at = null, ended_by = null, ended_reason = null;

    insert into public.employee_branch_change_log
      (employee_id, action, branch_id, old_branch_id, new_branch_id, effective_date, reason, actor_id)
      values (v_id, 'primary_branch', p_branch_id, v_old, p_branch_id, v_today, v_reason, auth.uid());
    v_changed := v_changed + 1;
  end loop;
  return v_changed;
end $$;
revoke all on function public.set_employee_primary_branches(uuid[], uuid, text) from public, anon, service_role;
grant execute on function public.set_employee_primary_branches(uuid[], uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPC: akhiri penugasan lintas cabang
-- ---------------------------------------------------------------------------
create or replace function public.end_employee_branch_assignment(
  p_employee_id uuid, p_branch_id uuid, p_end_date date, p_reason text
) returns date language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_end date := coalesce(p_end_date, (now() at time zone 'Asia/Jakarta')::date);
  v_row public.employee_branch_assignments%rowtype;
begin
  if auth.uid() is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  perform 1 from public.profiles where id = auth.uid() and role in ('OWNER', 'ADMIN') and is_active = true for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: hanya pemilik atau admin aktif yang boleh mengakhiri penugasan';
  end if;
  if p_employee_id is null or p_branch_id is null then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_INVALID: pilih karyawan dan cabang penugasan';
  end if;
  if v_reason is null or length(v_reason) not between 3 and 300 then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_INVALID: alasan wajib diisi 3 sampai 300 karakter';
  end if;
  if v_end > v_today + 730 then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_INVALID: tanggal berakhir terlalu jauh ke depan';
  end if;

  select * into v_row from public.employee_branch_assignments
    where employee_id = p_employee_id and branch_id = p_branch_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_INVALID: penugasan tidak ditemukan';
  end if;
  if not public.user_can_access_branch(p_branch_id) or not private.can_manage_hris_employee(p_employee_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: penugasan di luar cabang yang diizinkan';
  end if;
  if v_row.role = 'PRIMARY' then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_INVALID: cabang utama diubah lewat Edit Karyawan, bukan diakhiri di sini';
  end if;
  if v_row.end_date is not null then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_INVALID: penugasan ini sudah diakhiri';
  end if;
  if v_end < v_row.effective_date then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_INVALID: tanggal berakhir tidak boleh sebelum tanggal mulai';
  end if;

  update public.employee_branch_assignments
    set end_date = v_end, ended_at = now(), ended_by = auth.uid(), ended_reason = v_reason
    where employee_id = p_employee_id and branch_id = p_branch_id;

  insert into public.employee_branch_change_log
    (employee_id, action, branch_id, old_branch_id, effective_date, end_date, reason, actor_id)
    values (p_employee_id, 'assignment_ended', p_branch_id, p_branch_id, v_row.effective_date, v_end, v_reason, auth.uid());
  return v_end;
end $$;
revoke all on function public.end_employee_branch_assignment(uuid, uuid, date, text) from public, anon, service_role;
grant execute on function public.end_employee_branch_assignment(uuid, uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Membuka kembali penugasan yang pernah berakhir, berikut jejaknya
-- ---------------------------------------------------------------------------
-- assign_employee_secondary_branches() berjalan sebagai pengguna (security
-- invoker): ia tidak boleh menulis tabel jejak, dan sejak kolom end_date dikunci
-- ia juga tidak boleh mengosongkan end_date sendiri. Penolong SECURITY DEFINER
-- ini yang mengerjakan keduanya, dipanggil tepat sebelum penugasan disimpan.
--
-- Karena ia bisa dipanggil langsung oleh `authenticated`, jangkauan pengelolaan
-- diperiksa di sini juga — bukan hanya di pemanggilnya. Tanpa itu, ADMIN satu
-- cabang bisa menghidupkan kembali penugasan di cabang yang bukan wewenangnya.
create or replace function public.reopen_employee_branch_assignments(
  p_employee_id uuid, p_branch_ids uuid[], p_effective_date date
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0; v_branch uuid;
begin
  perform 1 from public.profiles where id = auth.uid() and role in ('OWNER', 'ADMIN') and is_active = true;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: hanya pemilik atau admin aktif yang boleh mengubah penugasan';
  end if;
  if p_employee_id is null or p_branch_ids is null
    or array_ndims(p_branch_ids) is distinct from 1
    or cardinality(p_branch_ids) not between 1 and 50
    or array_position(p_branch_ids, null) is not null
    or p_effective_date is null then
    raise exception using errcode = 'P0001', message = 'ASSIGNMENT_INVALID: pilih karyawan, cabang, dan tanggal mulai yang valid';
  end if;
  if not private.can_manage_hris_employee(p_employee_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: karyawan di luar cabang yang diizinkan';
  end if;
  foreach v_branch in array p_branch_ids loop
    if not public.user_can_access_branch(v_branch) or not private.can_manage_hris_branch(v_branch) then
      raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: ada cabang yang tidak diizinkan';
    end if;
  end loop;

  insert into public.employee_branch_change_log
    (employee_id, action, branch_id, old_branch_id, new_branch_id, effective_date, end_date, actor_id)
  select p_employee_id, 'assignment_reopened', a.branch_id, a.branch_id, a.branch_id, p_effective_date, a.end_date, auth.uid()
  from public.employee_branch_assignments a
  where a.employee_id = p_employee_id and a.branch_id = any(p_branch_ids)
    and a.role = 'SECONDARY' and a.end_date is not null
  for update of a;
  get diagnostics v_count = row_count;

  update public.employee_branch_assignments a
    set end_date = null, ended_at = null, ended_by = null, ended_reason = null
    where a.employee_id = p_employee_id and a.branch_id = any(p_branch_ids)
      and a.role = 'SECONDARY' and a.end_date is not null;
  return v_count;
end $$;
revoke all on function public.reopen_employee_branch_assignments(uuid, uuid[], date) from public, anon, service_role;
grant execute on function public.reopen_employee_branch_assignments(uuid, uuid[], date) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Tambalan jangkar eksak pada fungsi yang sudah berjalan
-- ---------------------------------------------------------------------------
do $patch$
-- Semua tambalan satu fungsi diterapkan pada teksnya dulu, baru dikompilasi SEKALI.
declare p record; definition text; signature regprocedure; pending jsonb := '{}'::jsonb; k text;
begin
 for p in select * from (values
  -- (a) Pemilih dokter/non-dokter/groomer di klinik & kasir.
  ('public.clinic_demo_care_staff(uuid)',
   E'a.effective_date<=(now() at time zone ''Asia/Jakarta'')::date',
   E'public.employee_assignment_current(a.effective_date,a.end_date)'),
  ('public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text)',
   E'a.effective_date <= (now() at time zone ''Asia/Jakarta'')::date',
   E'public.employee_assignment_current(a.effective_date,a.end_date)'),
  ('public.set_visit_service_state(uuid,text,uuid)',
   E'a.effective_date <= (now() at time zone ''Asia/Jakarta'')::date',
   E'public.employee_assignment_current(a.effective_date,a.end_date)'),
  -- (b) Penjaga penulisan: petugas rawat inap, pelaksana jasa, penjual SKU & resep.
  ('public.clinic_staff_name(uuid,uuid,text)',
   E'effective_date <= (now() at time zone ''Asia/Jakarta'')::date for share;',
   E'public.employee_assignment_current(effective_date,end_date) for share;'),
  ('public.normalize_service_performers(jsonb,uuid)',
   E'effective_date <= (now() at time zone ''Asia/Jakarta'')::date for share;',
   E'public.employee_assignment_current(effective_date,end_date) for share;'),
  ('public.guard_clinic_line_salesperson()',
   E'effective_date <= (now() at time zone ''Asia/Jakarta'')::date for share;',
   E'public.employee_assignment_current(effective_date,end_date) for share;'),
  ('public.guard_clinic_record_seller()',
   E'effective_date <= (now() at time zone ''Asia/Jakarta'')::date for share;',
   E'public.employee_assignment_current(effective_date,end_date) for share;'),
  -- (c) Penugasan yang sudah berakhir tidak lagi mengunci Nonaktifkan/Sampah.
  ('public.change_master_data_lifecycle(text,uuid,text,bigint,text)',
   E'exists(select 1 from public.employee_branch_assignments where employee_id=p_id and not public.user_can_access_branch(branch_id))',
   E'exists(select 1 from public.employee_branch_assignments where employee_id=p_id and public.employee_assignment_current(effective_date,end_date) and not public.user_can_access_branch(branch_id))'),
  -- (d) Menugaskan ulang cabang yang pernah diakhiri membuka kembali barisnya.
  --     Pengosongan end_date dikerjakan penolong SECURITY DEFINER, bukan di sini:
  --     fungsi ini security invoker dan kolom end_date tidak lagi boleh ditulis
  --     langsung oleh `authenticated`.
  ('public.assign_employee_secondary_branches(uuid,uuid[],date)',
   E'  insert into public.employee_branch_assignments(employee_id,branch_id,role,effective_date)',
   E'  perform public.reopen_employee_branch_assignments(p_employee_id,v_ids,p_effective_date);\n  insert into public.employee_branch_assignments(employee_id,branch_id,role,effective_date)')
 ) as patches(sig, old_text, new_text) loop
  signature := to_regprocedure(p.sig);
  if signature is null then raise exception 'Cabang HRIS: fungsi wajib tidak ada: %', p.sig; end if;
  definition := coalesce(pending->>p.sig, pg_get_functiondef(signature));
  -- Migrasi boleh dijalankan ulang: tambalan yang sudah terpasang dilewati.
  if position(p.new_text in definition) = 0 then
   if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then
    raise exception 'Cabang HRIS: jangkar harus muncul tepat sekali di %: %', p.sig, left(p.old_text, 80);
   end if;
   pending := pending || jsonb_build_object(p.sig, replace(definition, p.old_text, p.new_text));
  end if;
 end loop;
 for k in select jsonb_object_keys(pending) loop
  execute pending->>k;
 end loop;
end $patch$;

-- ACL fungsi privat tidak berubah oleh create or replace, tetapi ditegaskan ulang.
revoke all on function public.guard_clinic_line_salesperson() from public, anon, authenticated;
revoke all on function public.guard_clinic_record_seller() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Pemeriksaan akhir — gagal tertutup bila satu invarian hilang
-- ---------------------------------------------------------------------------
do $check$
declare s text; d text;
begin
 foreach s in array array[
  'public.clinic_demo_care_staff(uuid)',
  'public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text)',
  'public.set_visit_service_state(uuid,text,uuid)',
  'public.clinic_staff_name(uuid,uuid,text)',
  'public.normalize_service_performers(jsonb,uuid)',
  'public.guard_clinic_line_salesperson()',
  'public.guard_clinic_record_seller()',
  'public.change_master_data_lifecycle(text,uuid,text,bigint,text)'
 ] loop
  d := pg_get_functiondef(s::regprocedure);
  if position('employee_assignment_current' in d) = 0 then
   raise exception 'Cabang HRIS: % masih mengabaikan tanggal berakhir penugasan', s;
  end if;
 end loop;
 d := pg_get_functiondef('public.assign_employee_secondary_branches(uuid,uuid[],date)'::regprocedure);
 if position('reopen_employee_branch_assignments' in d) = 0 then
  raise exception 'Cabang HRIS: penugasan ulang belum membuka kembali baris yang berakhir';
 end if;
 if to_regprocedure('public.set_employee_primary_branches(uuid[],uuid,text)') is null
  or to_regprocedure('public.end_employee_branch_assignment(uuid,uuid,date,text)') is null
  or to_regprocedure('public.reopen_employee_branch_assignments(uuid,uuid[],date)') is null then
  raise exception 'Cabang HRIS: RPC cabang utama / akhiri penugasan tidak terpasang';
 end if;
 if to_regclass('public.employee_branch_change_log') is null then
  raise exception 'Cabang HRIS: tabel jejak perubahan cabang tidak terpasang';
 end if;
 -- Kolom pengakhiran harus tetap terkunci: kalau `authenticated` bisa menulisnya
 -- langsung, penugasan bisa diakhiri tanpa jejak siapa pun.
 if exists (
   select 1 from information_schema.column_privileges
   where grantee = 'authenticated' and table_schema = 'public'
     and table_name = 'employee_branch_assignments'
     and column_name in ('end_date', 'ended_at', 'ended_by', 'ended_reason')
     and privilege_type in ('INSERT', 'UPDATE')
 ) then
  raise exception 'Cabang HRIS: kolom tanggal berakhir masih bisa ditulis langsung oleh authenticated';
 end if;
end $check$;
