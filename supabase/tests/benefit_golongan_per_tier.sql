-- Fictional fixtures only; never execute on a production database.
-- Benefit golongan per level (migrasi 20261106610000, opsi A: golongan khusus menang).
begin;
do $$ begin
 if to_regprocedure('public.tier_benefit_category(text)') is null then raise exception 'tier_benefit_category missing'; end if;
end $$;

insert into customer_categories(id,nama,diskon_persen) values
 ('b1000000-0000-4000-8000-000000000001','Fiktif Benefit Gold',5),
 ('b1000000-0000-4000-8000-000000000002','Fiktif Benefit Gold Baru',7),
 ('b1000000-0000-4000-8000-000000000003','Fiktif Reseller',15),
 ('b1000000-0000-4000-8000-000000000004','Fiktif Benefit Bronze',2);

-- Produksi pernah tanpa baris tier_settings: tanpa pemetaan semuanya tetap seperti dulu.
delete from tier_settings;
insert into customers(id,name,phone,tier) values
 ('b2000000-0000-4000-8000-000000000001','Fiktif ikut level','000-tier-1','Gold'),
 ('b2000000-0000-4000-8000-000000000003','Fiktif New','000-tier-3','New');
insert into customers(id,name,phone,tier,category_id) values
 ('b2000000-0000-4000-8000-000000000002','Fiktif reseller','000-tier-2','Gold','b1000000-0000-4000-8000-000000000003');
do $$ begin
 if (select category_id from customers where id='b2000000-0000-4000-8000-000000000001') is not null then raise exception 'no mapping must leave category empty'; end if;
 if (select not category_manual or category_id is distinct from 'b1000000-0000-4000-8000-000000000003' from customers where id='b2000000-0000-4000-8000-000000000002') then raise exception 'insert with golongan must be manual'; end if;
end $$;

-- Pemetaan dibuat lewat INSERT (pola upsert layar): pelanggan ikut level langsung diselaraskan.
insert into tier_settings(id,bronze_category_id,gold_category_id) values
 (1,'b1000000-0000-4000-8000-000000000004','b1000000-0000-4000-8000-000000000001');
do $$ begin
 if (select category_id from customers where id='b2000000-0000-4000-8000-000000000001') is distinct from 'b1000000-0000-4000-8000-000000000001' then raise exception 'Gold customer must get Gold benefit'; end if;
 if (select category_manual from customers where id='b2000000-0000-4000-8000-000000000001') then raise exception 'level benefit must not be manual'; end if;
 if (select category_id from customers where id='b2000000-0000-4000-8000-000000000002') is distinct from 'b1000000-0000-4000-8000-000000000003' then raise exception 'manual golongan must win over level'; end if;
 if (select category_id from customers where id='b2000000-0000-4000-8000-000000000003') is not null then raise exception 'New has no level benefit'; end if;
end $$;

-- Naik / turun level (jalur refresh_customer_spending & downgrade sama-sama UPDATE tier).
update customers set tier='Bronze' where id in ('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002');
update customers set tier='Silver' where id='b2000000-0000-4000-8000-000000000003';
do $$ begin
 if (select category_id from customers where id='b2000000-0000-4000-8000-000000000001') is distinct from 'b1000000-0000-4000-8000-000000000004' then raise exception 'downgrade must move to Bronze benefit'; end if;
 if (select category_id from customers where id='b2000000-0000-4000-8000-000000000002') is distinct from 'b1000000-0000-4000-8000-000000000003' then raise exception 'manual golongan must survive downgrade'; end if;
 if (select category_id from customers where id='b2000000-0000-4000-8000-000000000003') is not null then raise exception 'unmapped Silver has no benefit'; end if;
end $$;

-- Perubahan saldo poin / total belanja tidak menggeser golongan.
update customers set points=points+10, total_spending=total_spending+1 where id='b2000000-0000-4000-8000-000000000001';
do $$ begin
 if (select category_id from customers where id='b2000000-0000-4000-8000-000000000001') is distinct from 'b1000000-0000-4000-8000-000000000004' then raise exception 'points update must keep level benefit'; end if;
end $$;

-- Pemetaan diganti: hanya pelanggan ikut level yang pindah.
update customers set tier='Gold' where id in ('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002');
update tier_settings set gold_category_id='b1000000-0000-4000-8000-000000000002' where id=1;
do $$ begin
 if (select category_id from customers where id='b2000000-0000-4000-8000-000000000001') is distinct from 'b1000000-0000-4000-8000-000000000002' then raise exception 'mapping change must resync level customers'; end if;
 if (select category_id from customers where id='b2000000-0000-4000-8000-000000000002') is distinct from 'b1000000-0000-4000-8000-000000000003' then raise exception 'mapping change must not touch manual golongan'; end if;
end $$;

-- Layar CRM: "ikut level" mengembalikan pelanggan manual ke benefit level.
update customers set category_id=null, category_manual=false where id='b2000000-0000-4000-8000-000000000002';
do $$ begin
 if (select category_manual or category_id is distinct from 'b1000000-0000-4000-8000-000000000002' from customers where id='b2000000-0000-4000-8000-000000000002') then raise exception 'follow-level must restore level benefit'; end if;
end $$;

-- Layar CRM memilih golongan khusus (manual=true) → menang; penulis lama yang hanya menulis
-- category_id juga dihormati sebagai pilihan admin.
update customers set category_id='b1000000-0000-4000-8000-000000000003', category_manual=true where id='b2000000-0000-4000-8000-000000000002';
update customers set category_id='b1000000-0000-4000-8000-000000000003' where id='b2000000-0000-4000-8000-000000000001';
update customers set tier='Bronze' where id in ('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002');
do $$ begin
 if (select count(*) from customers where id in ('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002')
      and category_manual and category_id='b1000000-0000-4000-8000-000000000003')<>2 then raise exception 'explicit golongan must stay manual'; end if;
end $$;

-- Golongan benefit dihapus → pemetaan kosong, pelanggan ikut level kehilangan benefitnya.
update customers set category_id=null, category_manual=false where id='b2000000-0000-4000-8000-000000000001';
delete from customer_categories where id='b1000000-0000-4000-8000-000000000004';
do $$ begin
 if (select bronze_category_id from tier_settings where id=1) is not null then raise exception 'deleted golongan must clear mapping'; end if;
 if (select category_id from customers where id='b2000000-0000-4000-8000-000000000001') is not null then raise exception 'deleted golongan must clear level benefit'; end if;
end $$;

-- Akun login biasa (bukan admin) tetap bisa memperbarui pelanggan seperti di kasir.
insert into auth.users(id,raw_user_meta_data) values ('b3000000-0000-4000-8000-000000000001','{"full_name":"Fiktif kasir"}');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true), set_config('request.jwt.claim.sub','b3000000-0000-4000-8000-000000000001',true);
update customers set tier='Gold' where id='b2000000-0000-4000-8000-000000000001';
reset role;
do $$ begin
 if (select category_id from customers where id='b2000000-0000-4000-8000-000000000001') is distinct from 'b1000000-0000-4000-8000-000000000002' then raise exception 'authenticated update must apply level benefit'; end if;
end $$;
rollback;
