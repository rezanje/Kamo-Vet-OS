-- C05 campaign codes. Fictional data only; everything rolls back.
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'Assertion failed: %', msg; end if; end $$;
create function pg_temp.rejects(stmt text, needle text, msg text) returns void language plpgsql as $$
declare hit boolean := false;
begin
  begin execute stmt; exception when others then
    hit := needle is null or position(needle in sqlerrm) > 0;
    if not hit then raise exception 'Wrong rejection for %: %', msg, sqlerrm; end if;
  end;
  if not hit then raise exception 'Expected rejection: %', msg; end if;
end $$;
grant execute on function pg_temp.ok(boolean, text) to authenticated;
grant execute on function pg_temp.rejects(text, text, text) to authenticated;

insert into auth.users (id, raw_user_meta_data) values
  ('c5000000-0000-4000-8000-000000000001', '{"full_name":"Owner C05"}'),
  ('c5000000-0000-4000-8000-000000000002', '{"full_name":"Admin C05"}'),
  ('c5000000-0000-4000-8000-000000000003', '{"full_name":"Kasir C05"}'),
  ('c5000000-0000-4000-8000-000000000004', '{"full_name":"Dokter C05"}');
update public.profiles set role = 'OWNER', is_active = true where id = 'c5000000-0000-4000-8000-000000000001';
update public.profiles set role = 'ADMIN', is_active = true where id = 'c5000000-0000-4000-8000-000000000002';
update public.profiles set role = 'STAFF', is_active = true where id = 'c5000000-0000-4000-8000-000000000003';
update public.profiles set role = 'DOCTOR', is_active = true where id = 'c5000000-0000-4000-8000-000000000004';
insert into public.branches (id, code, name, type) values
  ('c5100000-0000-4000-8000-000000000001', 'C05P', 'Petshop C05', 'PETSHOP'),
  ('c5100000-0000-4000-8000-000000000002', 'C05K', 'Klinik C05', 'KLINIK');
insert into public.user_branches (user_id, branch_id) values
  ('c5000000-0000-4000-8000-000000000003', 'c5100000-0000-4000-8000-000000000001'),
  ('c5000000-0000-4000-8000-000000000004', 'c5100000-0000-4000-8000-000000000002');
insert into public.warehouses (id, branch_id, code, name, type)
  values ('c5200000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000002', 'C05K-WH', 'Gudang C05', 'VET');
insert into public.customers (id, name, phone) values ('c5300000-0000-4000-8000-000000000001', 'Pelanggan C05', '081100000501');
insert into public.pets (id, customer_id, name) values ('c5400000-0000-4000-8000-000000000001', 'c5300000-0000-4000-8000-000000000001', 'Pasien C05');
insert into public.visits (id, branch_id, customer_id, pet_id) values
  ('c5500000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000002', 'c5300000-0000-4000-8000-000000000001', 'c5400000-0000-4000-8000-000000000001'),
  ('c5500000-0000-4000-8000-000000000002', 'c5100000-0000-4000-8000-000000000002', 'c5300000-0000-4000-8000-000000000001', 'c5400000-0000-4000-8000-000000000001');
insert into public.medical_records (id, visit_id) values
  ('c5600000-0000-4000-8000-000000000001', 'c5500000-0000-4000-8000-000000000001'),
  ('c5600000-0000-4000-8000-000000000002', 'c5500000-0000-4000-8000-000000000002');
insert into public.cashier_shifts (id, branch_id, opened_by, shift_type, status) values
  ('c5700000-0000-4000-8000-000000000001', 'c5100000-0000-4000-8000-000000000001', 'c5000000-0000-4000-8000-000000000003', 'petshop', 'open'),
  ('c5700000-0000-4000-8000-000000000002', 'c5100000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000004', 'klinik', 'open');
insert into public.coa_accounts (code, name, type, normal_balance, is_active, is_header) values
  ('1101','Kas','ASET','D',true,false), ('1201','Piutang','ASET','D',true,false),
  ('1301','Persediaan','ASET','D',true,false), ('2201','PPN Keluaran','LIABILITAS','K',true,false),
  ('4102','Diskon','PENDAPATAN','D',true,false), ('4201','Pendapatan Klinik','PENDAPATAN','K',true,false),
  ('5101','HPP','BEBAN','D',true,false)
on conflict (code) do update set is_active = true, is_header = false;
insert into public.cash_accounts (nama, jenis, coa_code) values ('Kas Uji C05', 'Kas', '1101')
  on conflict (coa_code) do update set is_active = true;
insert into public.vouchers (id, code, tipe, nilai) values
  ('c5800000-0000-4000-8000-000000000001', 'HEMAT10', 'persen', 10),
  ('c5800000-0000-4000-8000-000000000002', 'LAIN5K', 'nominal', 5000);
insert into public.promos (id, name, promo_type, is_active, auto_apply, discount_type, discount_value)
  values ('c5900000-0000-4000-8000-000000000001', 'Promo kode C05', 'diskon_produk', true, false, 'percent', 20);

-- Structural contract.
select pg_temp.ok(not has_function_privilege('authenticated', 'public.guard_campaign_code_use()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.guard_campaign_code_collision()', 'EXECUTE'),
  'trigger functions are not callable directly');
select pg_temp.ok(has_function_privilege('authenticated', 'public.clinic_post_invoice(uuid,text,jsonb,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.clinic_post_invoice(uuid,text,jsonb,jsonb)', 'EXECUTE'),
  'clinic posting ACL unchanged by the C05 patch');
select pg_temp.ok(position('campaign_code' in pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure)) > 0,
  'clinic posting stores the campaign code in its atomic insert');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Only OWNER/ADMIN manage codes; every signed-in user can read them.
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000003', true);
select pg_temp.rejects($$insert into public.campaign_codes(code, voucher_id) values ('KASIRBUAT', 'c5800000-0000-4000-8000-000000000001')$$,
  'row-level security', 'cashier cannot create a campaign code');
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000002', true);
insert into public.campaign_codes (code, voucher_id, max_uses) values ('PROMO10', 'c5800000-0000-4000-8000-000000000001', 2);
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000001', true);
insert into public.campaign_codes (code, promo_id) values ('DISKON20', 'c5900000-0000-4000-8000-000000000001');
insert into public.campaign_codes (code, voucher_id, is_active) values ('MATI', 'c5800000-0000-4000-8000-000000000002', false);
select pg_temp.rejects($$insert into public.campaign_codes(code, voucher_id, promo_id) values ('DUA', 'c5800000-0000-4000-8000-000000000001', 'c5900000-0000-4000-8000-000000000001')$$,
  'campaign_codes_one_target', 'a code targets exactly one voucher or promo');
select pg_temp.rejects($$insert into public.campaign_codes(code, voucher_id) values ('HEMAT10', 'c5800000-0000-4000-8000-000000000002')$$,
  'sudah dipakai sebagai kode voucher', 'campaign code cannot reuse a voucher code');
select pg_temp.rejects($$insert into public.vouchers(code, tipe, nilai) values ('PROMO10', 'nominal', 1)$$,
  'sudah dipakai sebagai kode kampanye', 'voucher cannot reuse a campaign code');
select pg_temp.rejects($$insert into public.campaign_codes(code, voucher_id, max_uses) values ('NOL', 'c5800000-0000-4000-8000-000000000001', 0)$$,
  'campaign_codes_max_uses_positive', 'cap must be positive');
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000003', true);
select pg_temp.ok((select count(*) from public.campaign_codes where code in ('PROMO10','DISKON20','MATI')) = 3, 'cashier can read codes');
update public.campaign_codes set max_uses = 99 where code = 'PROMO10';  -- RLS: silently matches no row
select pg_temp.ok((select max_uses from public.campaign_codes where code = 'PROMO10') = 2, 'cap unchanged by cashier');
select pg_temp.rejects($$select * from public.campaign_code_usage()$$, 'Akses ditolak', 'cashier cannot read usage report');

-- POS receipts (the checkout inserts the header as the signed-in cashier).
create function pg_temp.sale(no text, campaign text, voucher text) returns uuid language plpgsql as $$
declare id uuid;
begin
  insert into public.sales (branch_id, customer_id, no_struk, subtotal, total, bayar, cashier_id, shift_id, campaign_code, voucher_code)
  values ('c5100000-0000-4000-8000-000000000001', 'c5300000-0000-4000-8000-000000000001', no, 100000, 90000, 90000,
          'c5000000-0000-4000-8000-000000000003', 'c5700000-0000-4000-8000-000000000001', campaign, voucher)
  returning sales.id into id;
  return id;
end $$;
grant execute on function pg_temp.sale(text, text, text) to authenticated;

select pg_temp.rejects($$select pg_temp.sale('C05-MISMATCH', 'PROMO10', 'LAIN5K')$$, 'harus memakai voucher HEMAT10', 'campaign code must carry its own voucher');
select pg_temp.rejects($$select pg_temp.sale('C05-NOVOUCHER', 'PROMO10', null)$$, 'harus memakai voucher HEMAT10', 'voucher-bound code without voucher is rejected');
select pg_temp.rejects($$select pg_temp.sale('C05-OFF', 'MATI', 'LAIN5K')$$, 'sedang dinonaktifkan', 'inactive code is rejected');
select pg_temp.rejects($$select pg_temp.sale('C05-UNKNOWN', 'TIDAKADA', null)$$, 'tidak ditemukan', 'unknown code is rejected');
select pg_temp.rejects($$select pg_temp.sale('C05-PROMO-V', 'DISKON20', 'HEMAT10')$$, 'tidak bisa digabung', 'promo code cannot carry a voucher');
select pg_temp.sale('C05-PROMO-1', 'DISKON20', null);
select pg_temp.sale('C05-USE-1', 'PROMO10', 'HEMAT10');
select pg_temp.rejects($$update public.sales set campaign_code = null where no_struk = 'C05-USE-1'$$, null, 'campaign snapshot is immutable');
reset role;

-- Clinic checkout (doctor) consumes the same code; one invoice = one use.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000004', true);
select public.clinic_post_invoice('c5500000-0000-4000-8000-000000000001', 'c05-clinic-1',
  jsonb_build_object('tanggal', current_date::text, 'subtotal', 100000, 'discount', 10000, 'tax', 0, 'total', 90000,
    'dp_amount', 0, 'dp_date', null, 'paid_status', 'Lunas', 'metode_bayar', 'Tunai',
    'shift_id', 'c5700000-0000-4000-8000-000000000002', 'voucher_code', 'HEMAT10', 'campaign_code', 'PROMO10', 'salesperson_id', null),
  jsonb_build_array(jsonb_build_object('description', 'Konsultasi', 'qty', 1, 'price', 100000, 'kind', 'jasa', 'discount_percent', 0)));
select pg_temp.ok((select campaign_code = 'PROMO10' and voucher_code = 'HEMAT10' from public.invoices
  where visit_id = 'c5500000-0000-4000-8000-000000000001' and voided_at is null), 'clinic invoice keeps the campaign code');

-- Cap 2 reached (1 receipt + 1 invoice): both channels are refused, including the clinic RPC.
select pg_temp.rejects($$select public.clinic_post_invoice('c5500000-0000-4000-8000-000000000002', 'c05-clinic-2',
  jsonb_build_object('tanggal', current_date::text, 'subtotal', 100000, 'discount', 10000, 'tax', 0, 'total', 90000,
    'dp_amount', 0, 'dp_date', null, 'paid_status', 'Lunas', 'metode_bayar', 'Tunai',
    'shift_id', 'c5700000-0000-4000-8000-000000000002', 'voucher_code', 'HEMAT10', 'campaign_code', 'PROMO10', 'salesperson_id', null),
  jsonb_build_array(jsonb_build_object('description', 'Konsultasi', 'qty', 1, 'price', 100000, 'kind', 'jasa', 'discount_percent', 0)))$$,
  'sudah mencapai batas pemakaian (2 kali)', 'clinic checkout respects the cap');
select pg_temp.ok(not exists (select 1 from public.invoices where visit_id = 'c5500000-0000-4000-8000-000000000002'),
  'refused clinic checkout left no invoice behind');
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000003', true);
select pg_temp.rejects($$select pg_temp.sale('C05-USE-3', 'PROMO10', 'HEMAT10')$$, 'sudah mencapai batas pemakaian', 'POS respects the cap');
-- The underlying voucher itself is not capped by the campaign.
select pg_temp.sale('C05-PLAIN', null, 'HEMAT10');
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000001', true);
select pg_temp.ok((select used from public.campaign_code_usage() where code = 'PROMO10') = 2
  and (select used from public.campaign_code_usage() where code = 'DISKON20') = 1, 'usage report counts both channels');
reset role;

-- A voided receipt frees its use (the approved cancellation flow sets voided_at).
update public.sales set voided_at = now(), void_reason = 'uji C05' where no_struk = 'C05-USE-1';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000003', true);
select pg_temp.sale('C05-USE-AFTER-VOID', 'PROMO10', 'HEMAT10');
select pg_temp.rejects($$select pg_temp.sale('C05-USE-4', 'PROMO10', 'HEMAT10')$$, 'sudah mencapai batas pemakaian', 'cap holds again after the freed use');
-- Raising the cap (manager) re-opens the code.
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000001', true);
update public.campaign_codes set max_uses = null where code = 'PROMO10';
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000003', true);
select pg_temp.sale('C05-UNLIMITED', 'PROMO10', 'HEMAT10');
reset role;

-- A clinic reissue inherits the original code and is not counted twice.
-- Same order as clinic_void_reissue_invoice_core: void the original, then insert the reissue.
update public.campaign_codes set max_uses = 2 where code = 'PROMO10';   -- 2 live receipts: a new use would be refused
create temp table c05_src as select * from public.invoices
  where visit_id = 'c5500000-0000-4000-8000-000000000001' and voided_at is null;
set local session_replication_role = replica;   -- bypass posted-invoice guards for this fixture step only
update public.invoices set voided_at = now() where id = (select id from c05_src);
set local session_replication_role = origin;
insert into public.invoices (visit_id, invoice_no, subtotal, discount, tax, total, paid_status, voucher_code, reissued_from)
  select visit_id, invoice_no || '-R', subtotal, discount, tax, total, 'Belum Lunas', voucher_code, id from c05_src;
select pg_temp.ok((select count(*) from public.invoices where visit_id = 'c5500000-0000-4000-8000-000000000001' and campaign_code = 'PROMO10') = 2,
  'reissued invoice inherits the campaign code even above the cap');
select pg_temp.rejects($$insert into public.sales (branch_id, no_struk, subtotal, total, bayar, campaign_code, voucher_code)
  values ('c5100000-0000-4000-8000-000000000001', 'C05-AFTER-REISSUE', 1, 1, 1, 'PROMO10', 'HEMAT10')$$,
  'sudah mencapai batas pemakaian', 'reissue did not free or add a use');

select 'C05 campaign codes: passed';
rollback;
