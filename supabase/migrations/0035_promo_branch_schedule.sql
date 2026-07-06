-- Daftar Promo: target cabang + masa berlaku. null/empty branch_ids = semua cabang.
alter table promos
  add column branch_ids uuid[],
  add column valid_from date,
  add column valid_until date;

-- Demo: dua promo existing berlaku hari ini utk semua cabang selama 30 hari.
update promos set valid_from = current_date, valid_until = current_date + 30
where valid_from is null and valid_until is null;

-- Demo: satu promo khusus cabang tempat karyawan tertaut staff@vetos.local bertugas.
insert into promos (name, promo_type, rule, is_active, branch_ids, valid_from, valid_until)
select 'Diskon Grooming Cabang', 'diskon_produk',
  '{"suggest":"Diskon 15% jasa grooming hari ini di cabang ini","discount_type":"percent","discount_value":15}'::jsonb,
  true, array[e.branch_id], current_date, current_date + 7
from employees e
where e.profile_id = (select id from auth.users where email = 'staff@vetos.local')
  and e.branch_id is not null
  and not exists (select 1 from promos where name = 'Diskon Grooming Cabang');
