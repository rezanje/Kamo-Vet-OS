-- Personal dashboard (/me): tautkan akun login (profiles) ke record karyawan (employees).
alter table employees add column profile_id uuid references profiles(id) on delete set null;
create index on employees(profile_id);

-- Demo: tautkan staff@vetos.local ke satu karyawan berjabatan Kasir yang belum tertaut.
update employees set profile_id = (select id from auth.users where email = 'staff@vetos.local')
where id = (select id from employees where jabatan = 'Kasir' and profile_id is null order by nama limit 1);

-- Demo KPI bulan berjalan untuk karyawan tertaut (idempotent: skip kalau sudah ada metrik sama).
insert into kpi_records (employee_id, periode, metrik, target, realisasi, skor, catatan)
select e.id, to_char(now(), 'YYYY-MM'), 'Target Penjualan', 20000000, 14500000, 72, 'Progres bulan berjalan'
from employees e
where e.profile_id = (select id from auth.users where email = 'staff@vetos.local')
  and not exists (
    select 1 from kpi_records k
    where k.employee_id = e.id and k.periode = to_char(now(), 'YYYY-MM') and k.metrik = 'Target Penjualan'
  );

-- Demo pengajuan cuti (status Menunggu) untuk list.
insert into leave_requests (employee_id, jenis, tanggal_mulai, tanggal_selesai, durasi, alasan, status)
select e.id, 'Cuti', (now() + interval '7 day')::date, (now() + interval '8 day')::date, 2, 'Acara keluarga', 'Menunggu'
from employees e
where e.profile_id = (select id from auth.users where email = 'staff@vetos.local')
  and not exists (
    select 1 from leave_requests l where l.employee_id = e.id and l.alasan = 'Acara keluarga'
  );
