-- Fictional fixtures only; never execute on a production database.
-- 20261107040000: golongan pelanggan otomatis mengikuti level (tier).
begin;
create temporary table hasil(kasus text primary key, ok boolean, detail text) on commit drop;
grant all on hasil to authenticated;

insert into customer_categories(id,nama,diskon_persen,khusus,tier_otomatis) values
('d1000000-0000-4000-8000-000000000001','Level Silver fiktif',5,false,'Silver'),
('d1000000-0000-4000-8000-000000000002','Level Gold fiktif',10,false,'Gold'),
('d1000000-0000-4000-8000-000000000003','Reseller fiktif',15,true,null);
insert into category_discounts(customer_category_id,item_category_id,diskon_persen)
select 'd1000000-0000-4000-8000-000000000002',id,20 from item_categories limit 1;

-- Golongan lama hasil migrasi: Umum bukan khusus, Member/B2B/Rescuer khusus.
insert into hasil select 'backfill: Umum bukan khusus, Member khusus',
  (select not khusus from customer_categories where nama='Umum') and (select khusus from customer_categories where nama='Member'), '';

insert into customers(id,name,phone,tier,category_id) values
('d2000000-0000-4000-8000-000000000001','Pelanggan biasa','000-lvl-1','Bronze',null),
('d2000000-0000-4000-8000-000000000002','Pelanggan umum','000-lvl-2','Bronze',(select id from customer_categories where nama='Umum')),
('d2000000-0000-4000-8000-000000000003','Pelanggan reseller','000-lvl-3','Bronze','d1000000-0000-4000-8000-000000000003');
create function pg_temp.gol(p uuid) returns text language sql as $$
  select coalesce((select k.nama from customers c join customer_categories k on k.id=c.category_id where c.id=p),'-') $$;

update customers set tier='Silver' where id in ('d2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000003');
insert into hasil select 'naik ke Silver: tanpa golongan & Umum ikut level',
  pg_temp.gol('d2000000-0000-4000-8000-000000000001')='Level Silver fiktif' and pg_temp.gol('d2000000-0000-4000-8000-000000000002')='Level Silver fiktif',
  pg_temp.gol('d2000000-0000-4000-8000-000000000001')||'/'||pg_temp.gol('d2000000-0000-4000-8000-000000000002');
insert into hasil select 'golongan khusus (Reseller) tidak ditimpa level',
  pg_temp.gol('d2000000-0000-4000-8000-000000000003')='Reseller fiktif', pg_temp.gol('d2000000-0000-4000-8000-000000000003');

update customers set tier='Gold' where id='d2000000-0000-4000-8000-000000000001';
insert into hasil select 'naik ke Gold: pindah ke golongan Gold (diskon per kategori ikut)',
  pg_temp.gol('d2000000-0000-4000-8000-000000000001')='Level Gold fiktif', pg_temp.gol('d2000000-0000-4000-8000-000000000001');

update customers set tier='Platinum' where id='d2000000-0000-4000-8000-000000000001';
insert into hasil select 'level tanpa golongan: golongan level lama dilepas',
  pg_temp.gol('d2000000-0000-4000-8000-000000000001')='-', pg_temp.gol('d2000000-0000-4000-8000-000000000001');

update customers set tier='Bronze' where id='d2000000-0000-4000-8000-000000000002';
insert into hasil select 'turun ke level tanpa golongan dari golongan level: dilepas',
  pg_temp.gol('d2000000-0000-4000-8000-000000000002')='-', pg_temp.gol('d2000000-0000-4000-8000-000000000002');

update customers set tier='Gold', category_id='d1000000-0000-4000-8000-000000000003' where id='d2000000-0000-4000-8000-000000000002';
insert into hasil select 'ganti golongan + level di perintah yang sama: pilihan admin dipakai',
  pg_temp.gol('d2000000-0000-4000-8000-000000000002')='Reseller fiktif', pg_temp.gol('d2000000-0000-4000-8000-000000000002');

update customers set points=points+1 where id='d2000000-0000-4000-8000-000000000003';
insert into hasil select 'update tanpa ganti level tidak menyentuh golongan',
  pg_temp.gol('d2000000-0000-4000-8000-000000000003')='Reseller fiktif', '';

insert into customers(id,name,phone,tier) values ('d2000000-0000-4000-8000-000000000004','Pelanggan baru Gold','000-lvl-4','Gold');
insert into hasil select 'pelanggan baru langsung dapat golongan levelnya',
  pg_temp.gol('d2000000-0000-4000-8000-000000000004')='Level Gold fiktif', pg_temp.gol('d2000000-0000-4000-8000-000000000004');

-- Golongan level dinonaktifkan: tidak dipakai untuk pelanggan baru.
update customer_categories set is_active=false where id='d1000000-0000-4000-8000-000000000001';
insert into customers(id,name,phone,tier) values ('d2000000-0000-4000-8000-000000000005','Pelanggan Silver baru','000-lvl-5','Silver');
insert into hasil select 'golongan level nonaktif tidak dipasang',
  pg_temp.gol('d2000000-0000-4000-8000-000000000005')='-', pg_temp.gol('d2000000-0000-4000-8000-000000000005');
update customer_categories set is_active=true where id='d1000000-0000-4000-8000-000000000001';

-- Aturan data.
do $$ begin
  begin insert into customer_categories(nama,khusus,tier_otomatis) values('Ganda Gold',false,'Gold');
    insert into hasil values('satu golongan per level',false,'duplikat diterima');
  exception when unique_violation then insert into hasil values('satu golongan per level',true,''); end;
  begin insert into customer_categories(nama,khusus,tier_otomatis) values('Khusus+level',true,'Bronze');
    insert into hasil values('golongan level tidak boleh khusus',false,'diterima');
  exception when check_violation then insert into hasil values('golongan level tidak boleh khusus',true,''); end;
  begin insert into customer_categories(nama,khusus,tier_otomatis) values('Level ngawur',false,'Diamond');
    insert into hasil values('nama level divalidasi',false,'diterima');
  exception when check_violation then insert into hasil values('nama level divalidasi',true,''); end;
end $$;

-- Terapkan ke pelanggan lama: pelanggan Silver yang dibuat sebelum pemetaan ikut pindah.
update customer_categories set tier_otomatis=null where id='d1000000-0000-4000-8000-000000000001';
insert into customers(id,name,phone,tier) values ('d2000000-0000-4000-8000-000000000006','Silver lama','000-lvl-6','Silver');
update customer_categories set tier_otomatis='Silver' where id='d1000000-0000-4000-8000-000000000001';
insert into hasil select 'sebelum diterapkan: pelanggan lama belum pindah',
  pg_temp.gol('d2000000-0000-4000-8000-000000000006')='-', '';

insert into auth.users(id,raw_user_meta_data) values
('d3000000-0000-4000-8000-000000000001','{"full_name":"Owner level"}'),
('d3000000-0000-4000-8000-000000000002','{"full_name":"Staf level"}');
update profiles set role='OWNER' where id='d3000000-0000-4000-8000-000000000001';
update profiles set role='STAFF' where id='d3000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d3000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','d3000000-0000-4000-8000-000000000002',true);
do $$ begin
  perform public.terapkan_golongan_level();
  insert into hasil values('staf tidak boleh menerapkan',false,'diterima');
exception when insufficient_privilege then insert into hasil values('staf tidak boleh menerapkan',true,''); end $$;
select set_config('request.jwt.claims','{"sub":"d3000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','d3000000-0000-4000-8000-000000000001',true);
do $$ declare n int; begin
  n := public.terapkan_golongan_level();
  insert into hasil values('owner menerapkan: pelanggan lama pindah, khusus aman',
    n >= 1 and pg_temp.gol('d2000000-0000-4000-8000-000000000006')='Level Silver fiktif'
      and pg_temp.gol('d2000000-0000-4000-8000-000000000003')='Reseller fiktif', n::text);
  n := public.terapkan_golongan_level();
  insert into hasil values('menerapkan ulang tidak mengubah apa pun', n = 0, n::text);
end $$;
reset role;

select kasus||' => '||case when ok then 'PASS' else 'FAIL' end||' :: '||coalesce(detail,'') from hasil order by kasus;
do $$ begin if exists(select 1 from hasil where not ok) then raise exception 'golongan_ikut_level: ada kasus gagal'; end if; end $$;
rollback;
