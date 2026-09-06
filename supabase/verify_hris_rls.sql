-- Jalankan HANYA di database demo lokal atau proyek demo terkonfirmasi.
-- Contoh:
-- psql ... -v owner_id=<uuid> -v admin_a_id=<uuid> -v staff_a_id=<uuid> \
--   -v staff_b_id=<uuid> -v employee_a_id=<uuid> -v employee_b_id=<uuid> \
--   -v branch_a=<uuid> -v branch_b=<uuid> -v employee_count=2 -f supabase/verify_hris_rls.sql
-- Script ini tidak membuat, mengubah, atau menghapus fixture apa pun.

\if :{?owner_id}
\else
  \echo 'owner_id wajib diisi'
  \quit
\endif
\if :{?admin_a_id}
\else
  \echo 'admin_a_id wajib diisi'
  \quit
\endif
\if :{?staff_a_id}
\else
  \echo 'staff_a_id wajib diisi'
  \quit
\endif
\if :{?staff_b_id}
\else
  \echo 'staff_b_id wajib diisi'
  \quit
\endif
\if :{?employee_a_id}
\else
  \echo 'employee_a_id wajib diisi'
  \quit
\endif
\if :{?employee_b_id}
\else
  \echo 'employee_b_id wajib diisi'
  \quit
\endif
\if :{?branch_a}
\else
  \echo 'branch_a wajib diisi'
  \quit
\endif
\if :{?branch_b}
\else
  \echo 'branch_b wajib diisi'
  \quit
\endif
\if :{?employee_count}
\else
  \echo 'employee_count wajib diisi'
  \quit
\endif

begin;

create or replace function pg_temp.assert_count(label text, actual bigint, expected bigint)
returns void
language plpgsql
as $$
begin
  if actual <> expected then
    raise exception '%: expected %, got %', label, expected, actual;
  end if;
end;
$$;

create or replace function pg_temp.assert_false(label text, actual boolean)
returns void
language plpgsql
as $$
begin
  if actual then
    raise exception '%: expected false', label;
  end if;
end;
$$;

select pg_temp.assert_false(
  'anon tidak boleh memanggil helper HRIS',
  has_function_privilege('anon', 'private.is_hris_owner()', 'execute')
);
select pg_temp.assert_false(
  'anon tidak boleh memanggil helper cabang HRIS',
  has_function_privilege('anon', 'private.can_manage_hris_branch(uuid)', 'execute')
);

set local role authenticated;

-- STAFF Cabang A: hanya melihat data diri sendiri, tidak melihat payroll atau Cabang B.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'staff_a_id', 'role', 'authenticated')::text,
  true
);
select pg_temp.assert_count(
  'STAFF Cabang A hanya melihat satu karyawan',
  (select count(*) from public.employees),
  1
);
select pg_temp.assert_count(
  'STAFF Cabang A tidak melihat payroll',
  (select count(*) from public.payrolls),
  0
);
select pg_temp.assert_count(
  'STAFF Cabang A tidak melihat karyawan Cabang B',
  (select count(*) from public.employees where id = :'employee_b_id'::uuid),
  0
);

-- STAFF Cabang B: bukti pemisahan berjalan dua arah.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'staff_b_id', 'role', 'authenticated')::text,
  true
);
select pg_temp.assert_count(
  'STAFF Cabang B tidak melihat karyawan Cabang A',
  (select count(*) from public.employees where id = :'employee_a_id'::uuid),
  0
);

-- ADMIN Cabang A: dapat melihat Cabang A, tidak Cabang B, dan tidak payroll.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'admin_a_id', 'role', 'authenticated')::text,
  true
);
select pg_temp.assert_count(
  'ADMIN Cabang A tidak melihat karyawan Cabang B',
  (select count(*) from public.employees where branch_id = :'branch_b'::uuid),
  0
);
select pg_temp.assert_count(
  'ADMIN Cabang A tidak melihat payroll',
  (select count(*) from public.payrolls),
  0
);
select pg_temp.assert_count(
  'ADMIN Cabang A melihat karyawan Cabang A',
  (select count(*) from public.employees where branch_id = :'branch_a'::uuid),
  1
);

-- OWNER: dapat melihat seluruh fixture HRIS.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', :'owner_id', 'role', 'authenticated')::text,
  true
);
select pg_temp.assert_count(
  'OWNER melihat seluruh karyawan fixture',
  (select count(*) from public.employees),
  :employee_count
);
select pg_temp.assert_count(
  'OWNER melihat kedua cabang fixture',
  (select count(*) from public.employees where branch_id in (:'branch_a'::uuid, :'branch_b'::uuid)),
  2
);

rollback;
