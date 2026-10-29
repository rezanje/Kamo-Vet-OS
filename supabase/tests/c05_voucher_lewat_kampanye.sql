-- C05 lanjutan: voucher yang tertaut ke kode kampanye aktif hanya bisa dipakai lewat kode kampanye.
-- Fictional data only; everything rolls back.
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

insert into auth.users (id) values
  ('c5a00000-0000-4000-8000-000000000001'), ('c5a00000-0000-4000-8000-000000000003'), ('c5a00000-0000-4000-8000-000000000004');
update public.profiles set role = 'OWNER', is_active = true where id = 'c5a00000-0000-4000-8000-000000000001';
update public.profiles set role = 'STAFF', is_active = true where id = 'c5a00000-0000-4000-8000-000000000003';
update public.profiles set role = 'DOCTOR', is_active = true where id = 'c5a00000-0000-4000-8000-000000000004';
insert into public.branches (id, code, name, type) values
  ('c5a10000-0000-4000-8000-000000000001', 'C5AP', 'Petshop C05 lanjutan', 'PETSHOP'),
  ('c5a10000-0000-4000-8000-000000000002', 'C5AK', 'Klinik C05 lanjutan', 'KLINIK');
insert into public.user_branches (user_id, branch_id) values
  ('c5a00000-0000-4000-8000-000000000003', 'c5a10000-0000-4000-8000-000000000001'),
  ('c5a00000-0000-4000-8000-000000000004', 'c5a10000-0000-4000-8000-000000000002');
insert into public.warehouses (id, branch_id, code, name, type)
  values ('c5a20000-0000-4000-8000-000000000001', 'c5a10000-0000-4000-8000-000000000002', 'C5AK-WH', 'Gudang C05 lanjutan', 'VET');
insert into public.customers (id, name, phone) values ('c5a30000-0000-4000-8000-000000000001', 'Pelanggan C05 lanjutan', '081100000511');
insert into public.pets (id, customer_id, name) values ('c5a40000-0000-4000-8000-000000000001', 'c5a30000-0000-4000-8000-000000000001', 'Pasien C05 lanjutan');
insert into public.visits (id, branch_id, customer_id, pet_id)
  select ('c5a50000-0000-4000-8000-00000000000' || n)::uuid, 'c5a10000-0000-4000-8000-000000000002',
         'c5a30000-0000-4000-8000-000000000001', 'c5a40000-0000-4000-8000-000000000001'
  from generate_series(1, 5) n;
insert into public.medical_records (id, visit_id)
  select ('c5a60000-0000-4000-8000-00000000000' || n)::uuid, ('c5a50000-0000-4000-8000-00000000000' || n)::uuid
  from generate_series(1, 5) n;
insert into public.cashier_shifts (id, branch_id, opened_by, shift_type, status) values
  ('c5a70000-0000-4000-8000-000000000001', 'c5a10000-0000-4000-8000-000000000001', 'c5a00000-0000-4000-8000-000000000003', 'petshop', 'open'),
  ('c5a70000-0000-4000-8000-000000000002', 'c5a10000-0000-4000-8000-000000000002', 'c5a00000-0000-4000-8000-000000000004', 'klinik', 'open');
insert into public.coa_accounts (code, name, type, normal_balance, is_active, is_header) values
  ('1101','Kas','ASET','D',true,false), ('1201','Piutang','ASET','D',true,false),
  ('1301','Persediaan','ASET','D',true,false), ('2201','PPN Keluaran','LIABILITAS','K',true,false),
  ('4102','Diskon','PENDAPATAN','D',true,false), ('4201','Pendapatan Klinik','PENDAPATAN','K',true,false),
  ('5101','HPP','BEBAN','D',true,false)
on conflict (code) do update set is_active = true, is_header = false;
insert into public.cash_accounts (nama, jenis, coa_code) values ('Kas Uji C05 lanjutan', 'Kas', '1101')
  on conflict (coa_code) do update set is_active = true;
insert into public.vouchers (id, code, tipe, nilai) values
  ('c5a80000-0000-4000-8000-000000000001', 'TAUT10', 'persen', 10),   -- tertaut ke kampanye aktif
  ('c5a80000-0000-4000-8000-000000000002', 'BEBAS5K', 'nominal', 5000), -- tidak tertaut ke kampanye
  ('c5a80000-0000-4000-8000-000000000003', 'LAMA7K', 'nominal', 7000);  -- hanya tertaut ke kampanye nonaktif

-- Legacy documents written BEFORE the voucher was linked to a campaign (raw voucher, allowed then).
create temp table c5a_legacy_sale as select gen_random_uuid() id;
insert into public.sales (id, branch_id, customer_id, no_struk, subtotal, total, bayar, cashier_id, shift_id, voucher_code)
  select id, 'c5a10000-0000-4000-8000-000000000001', 'c5a30000-0000-4000-8000-000000000001', 'C5A-LEGACY', 100000, 90000, 90000,
         'c5a00000-0000-4000-8000-000000000003', 'c5a70000-0000-4000-8000-000000000001', 'TAUT10' from c5a_legacy_sale;
insert into public.invoices (id, visit_id, invoice_no, subtotal, discount, tax, total, paid_status, voucher_code)
  values ('c5a90000-0000-4000-8000-000000000001', 'c5a50000-0000-4000-8000-000000000005', 'INV.C5A.LEGACY', 100000, 10000, 0, 90000, 'Belum Lunas', 'TAUT10');

insert into public.campaign_codes (code, voucher_id) values ('KAMPTAUT', 'c5a80000-0000-4000-8000-000000000001');
insert into public.campaign_codes (code, voucher_id, is_active) values ('KAMPMATI', 'c5a80000-0000-4000-8000-000000000003', false);

-- Structural contract.
select pg_temp.ok(not has_function_privilege('authenticated', 'public.voucher_wajib_lewat_kampanye(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.voucher_wajib_lewat_kampanye(text)', 'EXECUTE'),
  'helper is internal (not callable by clients)');
select pg_temp.ok(public.voucher_wajib_lewat_kampanye('TAUT10') and public.voucher_wajib_lewat_kampanye(' taut10 ')
  and not public.voucher_wajib_lewat_kampanye('BEBAS5K') and not public.voucher_wajib_lewat_kampanye('LAMA7K')
  and not public.voucher_wajib_lewat_kampanye(null), 'helper: only vouchers linked to an ACTIVE campaign');

-- POS (/kasir): the cashier inserts the receipt header.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'c5a00000-0000-4000-8000-000000000003', true);
create function pg_temp.sale(no text, campaign text, voucher text) returns uuid language plpgsql as $$
declare id uuid;
begin
  insert into public.sales (branch_id, customer_id, no_struk, subtotal, total, bayar, cashier_id, shift_id, campaign_code, voucher_code)
  values ('c5a10000-0000-4000-8000-000000000001', 'c5a30000-0000-4000-8000-000000000001', no, 100000, 90000, 90000,
          'c5a00000-0000-4000-8000-000000000003', 'c5a70000-0000-4000-8000-000000000001', campaign, voucher)
  returning sales.id into id;
  return id;
end $$;
select pg_temp.rejects($$select pg_temp.sale('C5A-RAW', null, 'TAUT10')$$,
  'KODE_KAMPANYE: Voucher ini hanya bisa dipakai lewat kode kampanye', 'POS: raw linked voucher is blocked');
select pg_temp.rejects($$select pg_temp.sale('C5A-RAW-LOWER', null, 'taut10')$$,
  'Voucher ini hanya bisa dipakai lewat kode kampanye', 'POS: case does not bypass the block');
select pg_temp.ok(not exists (select 1 from public.sales where no_struk like 'C5A-RAW%'), 'blocked receipts left nothing behind');
select pg_temp.sale('C5A-CAMPAIGN', 'KAMPTAUT', 'TAUT10');
select pg_temp.sale('C5A-FREE', null, 'BEBAS5K');
select pg_temp.sale('C5A-INACTIVE-LINK', null, 'LAMA7K');
select pg_temp.ok((select count(*) from public.sales where no_struk in ('C5A-CAMPAIGN','C5A-FREE','C5A-INACTIVE-LINK')) = 3,
  'campaign code, unlinked voucher, and voucher of an inactive campaign all still work');

-- A correction may keep a legacy voucher, but may not newly attach a linked one.
update public.sales set total = total where no_struk = 'C5A-LEGACY';
select pg_temp.rejects($$update public.sales set voucher_code = 'TAUT10' where no_struk = 'C5A-FREE'$$,
  'Voucher ini hanya bisa dipakai lewat kode kampanye', 'POS: attaching a linked voucher by update is blocked');
reset role;
-- Owner deactivates the campaign: the raw voucher works again; reactivating blocks it again.
update public.campaign_codes set is_active = false where code = 'KAMPTAUT';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c5a00000-0000-4000-8000-000000000003', true);
select pg_temp.sale('C5A-AFTER-DEACTIVATE', null, 'TAUT10');
reset role;
update public.campaign_codes set is_active = true where code = 'KAMPTAUT';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c5a00000-0000-4000-8000-000000000003', true);
select pg_temp.rejects($$select pg_temp.sale('C5A-AFTER-REACTIVATE', null, 'TAUT10')$$,
  'Voucher ini hanya bisa dipakai lewat kode kampanye', 'POS: reactivated campaign blocks the raw voucher again');
reset role;

-- Clinic checkout (single visit) and clinic group payment both post through clinic_post_invoice.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c5a00000-0000-4000-8000-000000000004', true);
create function pg_temp.clinic(visit_no int, campaign text, voucher text) returns void language plpgsql as $$
begin
  perform public.clinic_post_invoice(('c5a50000-0000-4000-8000-00000000000' || visit_no)::uuid, 'c5a-clinic-' || visit_no || '-' || coalesce(campaign, voucher, '-'),
    jsonb_build_object('tanggal', current_date::text, 'subtotal', 100000, 'discount', 10000, 'tax', 0, 'total', 90000,
      'dp_amount', 0, 'dp_date', null, 'paid_status', 'Lunas', 'metode_bayar', 'Tunai',
      'shift_id', 'c5a70000-0000-4000-8000-000000000002', 'voucher_code', voucher, 'campaign_code', campaign, 'salesperson_id', null),
    jsonb_build_array(jsonb_build_object('description', 'Konsultasi', 'qty', 1, 'price', 100000, 'kind', 'jasa', 'discount_percent', 0)));
end $$;
select pg_temp.rejects($$select pg_temp.clinic(1, null, 'TAUT10')$$,
  'KODE_KAMPANYE: Voucher ini hanya bisa dipakai lewat kode kampanye', 'clinic: raw linked voucher is blocked');
-- Group payment = one clinic_post_invoice per pet carrying the raw voucher: the second pet is blocked the same way.
select pg_temp.rejects($$select pg_temp.clinic(2, null, 'TAUT10')$$,
  'Voucher ini hanya bisa dipakai lewat kode kampanye', 'clinic group payment: raw linked voucher is blocked');
select pg_temp.ok(not exists (select 1 from public.invoices where visit_id in
  ('c5a50000-0000-4000-8000-000000000001', 'c5a50000-0000-4000-8000-000000000002')), 'blocked clinic posting left no invoice');
select pg_temp.clinic(1, 'KAMPTAUT', 'TAUT10');
select pg_temp.clinic(2, null, 'BEBAS5K');
select pg_temp.clinic(3, null, 'LAMA7K');
select pg_temp.ok((select count(*) from public.invoices where visit_id in ('c5a50000-0000-4000-8000-000000000001',
  'c5a50000-0000-4000-8000-000000000002', 'c5a50000-0000-4000-8000-000000000003') and voided_at is null) = 3,
  'clinic: campaign code, unlinked voucher, and inactive-campaign voucher all still post');
select pg_temp.ok((select campaign_code = 'KAMPTAUT' and voucher_code = 'TAUT10' from public.invoices
  where visit_id = 'c5a50000-0000-4000-8000-000000000001'), 'clinic invoice via campaign keeps both codes');
reset role;

-- Reissue of a legacy invoice keeps its voucher; switching the reissue to a linked voucher is blocked.
set local session_replication_role = replica;   -- fixture step only: void the legacy original
update public.invoices set voided_at = now() where id = 'c5a90000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
insert into public.invoices (visit_id, invoice_no, subtotal, discount, tax, total, paid_status, voucher_code, reissued_from)
  values ('c5a50000-0000-4000-8000-000000000005', 'INV.C5A.LEGACY-R', 100000, 10000, 0, 90000, 'Belum Lunas', 'TAUT10',
          'c5a90000-0000-4000-8000-000000000001');
select pg_temp.ok((select campaign_code is null and voucher_code = 'TAUT10' from public.invoices where invoice_no = 'INV.C5A.LEGACY-R'),
  'legacy reissue keeps its original voucher');
update public.invoices set voucher_code = 'BEBAS5K' where invoice_no = 'INV.C5A.LEGACY-R';
select pg_temp.rejects($$update public.invoices set voucher_code = 'TAUT10' where invoice_no = 'INV.C5A.LEGACY-R'$$,
  'Voucher ini hanya bisa dipakai lewat kode kampanye', 'clinic correction cannot attach a linked voucher');

select 'C05 voucher hanya lewat kode kampanye: passed';
rollback;
