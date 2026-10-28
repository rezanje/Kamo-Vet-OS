-- Tabel pengaturan satu baris: simpan dari layar harus bisa membuat baris yang hilang
-- (upsert), tetap dengan hak tulis lama: aturan gaji khusus OWNER, tier OWNER/ADMIN.
begin;
insert into auth.users(id,raw_user_meta_data)values
('5e100000-0000-4000-8000-000000000001','{"full_name":"Fiction owner"}'),
('5e100000-0000-4000-8000-000000000002','{"full_name":"Fiction admin"}'),
('5e100000-0000-4000-8000-000000000003','{"full_name":"Fiction finance"}'),
('5e100000-0000-4000-8000-000000000004','{"full_name":"Fiction staff"}');
update profiles set is_active=true,role=case id
  when '5e100000-0000-4000-8000-000000000001' then 'OWNER'
  when '5e100000-0000-4000-8000-000000000002' then 'ADMIN'
  when '5e100000-0000-4000-8000-000000000003' then 'FINANCE'
  else 'STAFF' end::user_role
where id in ('5e100000-0000-4000-8000-000000000001','5e100000-0000-4000-8000-000000000002',
             '5e100000-0000-4000-8000-000000000003','5e100000-0000-4000-8000-000000000004');
-- Kondisi produksi: baris tunggalnya hilang.
delete from payroll_settings;
delete from tier_settings;
delete from company_settings;

set local role authenticated;

-- Jebakan lama: OWNER update atas baris yang hilang = 0 baris, tanpa error.
select set_config('request.jwt.claims',json_build_object('sub','5e100000-0000-4000-8000-000000000001','role','authenticated')::text,true);
do $$ declare n int; begin
  update payroll_settings set lembur_per_jam=1 where id; get diagnostics n=row_count;
  if n<>0 then raise exception 'Expected the old update path to write 0 rows, wrote %',n; end if;
end $$;

-- ADMIN / FINANCE / STAFF tidak boleh membuat aturan gaji.
do $$ declare u uuid; begin
  foreach u in array array['5e100000-0000-4000-8000-000000000002','5e100000-0000-4000-8000-000000000003','5e100000-0000-4000-8000-000000000004']::uuid[] loop
    perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
    begin
      insert into payroll_settings(id,lembur_per_jam) values(true,1)
        on conflict(id) do update set lembur_per_jam=excluded.lembur_per_jam;
      raise exception 'Non-owner % created payroll settings',u;
    exception when insufficient_privilege then null; end;
  end loop;
end $$;

-- OWNER: upsert membuat baris, lalu upsert kedua mengubah baris yang sama.
select set_config('request.jwt.claims',json_build_object('sub','5e100000-0000-4000-8000-000000000001','role','authenticated')::text,true);
do $$ declare n int; v numeric; begin
  insert into payroll_settings(id,telat_mulai_menit,telat_blok_menit,telat_nominal_per_blok,telat_maks,bolos_per_hari,lembur_per_jam)
    values(true,1,5,0,0,0,0) on conflict(id) do update set lembur_per_jam=excluded.lembur_per_jam;
  get diagnostics n=row_count; if n<>1 then raise exception 'Owner upsert wrote % payroll rows',n; end if;
  insert into payroll_settings(id,lembur_per_jam) values(true,7)
    on conflict(id) do update set lembur_per_jam=excluded.lembur_per_jam;
  select count(*), max(lembur_per_jam) into n, v from payroll_settings;
  if n<>1 or v<>7 then raise exception 'Payroll singleton not updated in place: % rows, lembur %',n,v; end if;
end $$;

-- FINANCE tetap bisa membaca, tetapi tidak bisa mengubah.
select set_config('request.jwt.claims',json_build_object('sub','5e100000-0000-4000-8000-000000000003','role','authenticated')::text,true);
do $$ declare n int; begin
  if (select count(*) from payroll_settings)<>1 then raise exception 'Finance cannot read payroll settings'; end if;
  update payroll_settings set lembur_per_jam=99 where id; get diagnostics n=row_count;
  if n<>0 then raise exception 'Finance updated payroll settings'; end if;
end $$;

-- Tier: STAFF / FINANCE ditolak, ADMIN boleh membuat baris lewat upsert.
do $$ declare u uuid; begin
  foreach u in array array['5e100000-0000-4000-8000-000000000003','5e100000-0000-4000-8000-000000000004']::uuid[] loop
    perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
    begin
      insert into tier_settings(id,bronze_min,silver_min,gold_min,platinum_min) values(1,1,2,3,4)
        on conflict(id) do update set bronze_min=excluded.bronze_min;
      raise exception 'Non-admin % created tier settings',u;
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
select set_config('request.jwt.claims',json_build_object('sub','5e100000-0000-4000-8000-000000000002','role','authenticated')::text,true);
do $$ declare n int; begin
  insert into tier_settings(id,bronze_min,silver_min,gold_min,platinum_min) values(1,10,20,30,40)
    on conflict(id) do update set bronze_min=excluded.bronze_min,silver_min=excluded.silver_min,
      gold_min=excluded.gold_min,platinum_min=excluded.platinum_min;
  get diagnostics n=row_count; if n<>1 then raise exception 'Admin tier upsert wrote % rows',n; end if;
  insert into tier_settings(id,bronze_min,silver_min,gold_min,platinum_min) values(1,11,21,31,41)
    on conflict(id) do update set bronze_min=excluded.bronze_min,silver_min=excluded.silver_min,
      gold_min=excluded.gold_min,platinum_min=excluded.platinum_min;
  if (select count(*) from tier_settings)<>1 or (select bronze_min from tier_settings)<>11 then
    raise exception 'Tier singleton not updated in place';
  end if;
  begin
    insert into tier_settings(id,bronze_min,silver_min,gold_min,platinum_min) values(2,1,2,3,4);
    raise exception 'Second tier settings row accepted';
  exception when check_violation then null; end;
end $$;
-- Pajak (company_settings): hanya OWNER yang boleh menulis; semua akun login tetap membaca.
do $$ declare u uuid; n int; begin
  foreach u in array array['5e100000-0000-4000-8000-000000000002','5e100000-0000-4000-8000-000000000003','5e100000-0000-4000-8000-000000000004']::uuid[] loop
    perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
    begin
      insert into company_settings(id,mode_pkp,ppn_rate) values(true,true,12)
        on conflict(id) do update set mode_pkp=excluded.mode_pkp,ppn_rate=excluded.ppn_rate;
      raise exception 'Non-owner % wrote company settings',u;
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
select set_config('request.jwt.claims',json_build_object('sub','5e100000-0000-4000-8000-000000000001','role','authenticated')::text,true);
do $$ declare n int; begin
  insert into company_settings(id,mode_pkp,ppn_rate) values(true,false,11)
    on conflict(id) do update set mode_pkp=excluded.mode_pkp,ppn_rate=excluded.ppn_rate;
  get diagnostics n=row_count; if n<>1 then raise exception 'Owner company settings upsert wrote % rows',n; end if;
  if (select count(*) from company_settings)<>1 then raise exception 'Owner upsert did not insert exactly one company settings row'; end if;
  insert into company_settings(id,mode_pkp,ppn_rate) values(true,true,12)
    on conflict(id) do update set mode_pkp=excluded.mode_pkp,ppn_rate=excluded.ppn_rate;
  if (select count(*) from company_settings)<>1 or (select ppn_rate from company_settings)<>12 then
    raise exception 'Company settings singleton not updated in place';
  end if;
end $$;
-- Akun non-OWNER tetap membaca, tetapi update langsung lewat API tidak mengubah apa pun.
do $$ declare u uuid; n int; begin
  foreach u in array array['5e100000-0000-4000-8000-000000000002','5e100000-0000-4000-8000-000000000003','5e100000-0000-4000-8000-000000000004']::uuid[] loop
    perform set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
    if (select count(*) from company_settings)<>1 then raise exception 'Role % lost read access to company settings',u; end if;
    update company_settings set mode_pkp=false,ppn_rate=1 where id; get diagnostics n=row_count;
    if n<>0 then raise exception 'Role % updated company settings',u; end if;
    begin
      delete from company_settings where id; get diagnostics n=row_count;
      if n<>0 then raise exception 'Role % deleted company settings',u; end if;
    end;
  end loop;
end $$;
reset role;
do $$ begin
  if (select ppn_rate from company_settings)<>12 or not (select mode_pkp from company_settings) then
    raise exception 'Company settings changed by a non-owner';
  end if;
end $$;
rollback;
