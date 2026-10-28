-- C05 follow-up: campaign codes in clinic group payment (rombongan) and back-office POS.
-- Fictional data only; everything rolls back. Runs after every migration (see
-- docs/evidence/2026-10-29-c05-coverage/run-native-pg.py).
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
  ('c6000000-0000-4000-8000-000000000001', '{"full_name":"Owner C05G"}'),
  ('c6000000-0000-4000-8000-000000000003', '{"full_name":"Kasir backoffice C05G"}'),
  ('c6000000-0000-4000-8000-000000000004', '{"full_name":"Dokter C05G"}');
update public.profiles set role = 'OWNER', is_active = true where id = 'c6000000-0000-4000-8000-000000000001';
update public.profiles set role = 'STAFF', is_active = true where id = 'c6000000-0000-4000-8000-000000000003';
update public.profiles set role = 'DOCTOR', is_active = true where id = 'c6000000-0000-4000-8000-000000000004';
insert into public.role_modules (role, module_id) values ('STAFF', 'pos') on conflict do nothing;
insert into public.branches (id, code, name, type) values
  ('c6100000-0000-4000-8000-000000000001', 'C05GP', 'Petshop C05G', 'PETSHOP'),
  ('c6100000-0000-4000-8000-000000000002', 'C05GK', 'Klinik C05G', 'KLINIK');
insert into public.user_branches (user_id, branch_id) values
  ('c6000000-0000-4000-8000-000000000003', 'c6100000-0000-4000-8000-000000000001'),
  ('c6000000-0000-4000-8000-000000000004', 'c6100000-0000-4000-8000-000000000002');
insert into public.warehouses (id, branch_id, code, name, type) values
  ('c6200000-0000-4000-8000-000000000001', 'c6100000-0000-4000-8000-000000000002', 'C05GK-WH', 'Gudang C05G', 'VET');
insert into public.customers (id, name, phone) values
  ('c6300000-0000-4000-8000-000000000001', 'Pemilik rombongan A', '081100000601'),
  ('c6300000-0000-4000-8000-000000000002', 'Pemilik rombongan B', '081100000602');
insert into public.pets (id, customer_id, name) values
  ('c6400000-0000-4000-8000-000000000001', 'c6300000-0000-4000-8000-000000000001', 'Alpha'),
  ('c6400000-0000-4000-8000-000000000002', 'c6300000-0000-4000-8000-000000000001', 'Beta'),
  ('c6400000-0000-4000-8000-000000000003', 'c6300000-0000-4000-8000-000000000001', 'Gamma'),
  ('c6400000-0000-4000-8000-000000000004', 'c6300000-0000-4000-8000-000000000002', 'Delta'),
  ('c6400000-0000-4000-8000-000000000005', 'c6300000-0000-4000-8000-000000000002', 'Epsilon');
insert into public.visits (id, branch_id, customer_id, pet_id)
  select ('c6500000-0000-4000-8000-00000000000' || n)::uuid, 'c6100000-0000-4000-8000-000000000002', c::uuid,
         ('c6400000-0000-4000-8000-00000000000' || p)::uuid
  from (values (1, 'c6300000-0000-4000-8000-000000000001', 1), (2, 'c6300000-0000-4000-8000-000000000001', 2),
               (3, 'c6300000-0000-4000-8000-000000000001', 3), (4, 'c6300000-0000-4000-8000-000000000002', 4),
               (5, 'c6300000-0000-4000-8000-000000000002', 5), (6, 'c6300000-0000-4000-8000-000000000001', 1),
               (7, 'c6300000-0000-4000-8000-000000000001', 2)) v(n, c, p);
insert into public.medical_records (visit_id) select id from public.visits where id::text like 'c6500000-%';
insert into public.cashier_shifts (id, branch_id, opened_by, shift_type, status) values
  ('c6700000-0000-4000-8000-000000000002', 'c6100000-0000-4000-8000-000000000002', 'c6000000-0000-4000-8000-000000000004', 'klinik', 'open');
insert into public.coa_accounts (code, name, type, normal_balance, is_active, is_header) values
  ('1101','Kas','ASET','D',true,false), ('1102','Bank','ASET','D',true,false), ('1201','Piutang','ASET','D',true,false),
  ('1301','Persediaan','ASET','D',true,false), ('2201','PPN Keluaran','LIABILITAS','K',true,false),
  ('4101','Penjualan','PENDAPATAN','K',true,false), ('4102','Diskon','PENDAPATAN','D',true,false),
  ('4201','Pendapatan Klinik','PENDAPATAN','K',true,false), ('5101','HPP','BEBAN','D',true,false)
on conflict (code) do update set is_active = true, is_header = false;
insert into public.cash_accounts (id, nama, jenis, coa_code) values
  ('c6800000-0000-4000-8000-000000000001', 'Kas Uji C05G', 'Kas', '1101')
  on conflict (coa_code) do update set is_active = true;
insert into public.payment_account_map (metode, branch_id, cash_account_id)
  select 'Tunai', 'c6100000-0000-4000-8000-000000000001', id from public.cash_accounts where coa_code = '1101'
  on conflict do nothing;
update public.accounting_locks set closed_until = null;
insert into public.items (id, code, name, unit, item_type) values
  ('c6900000-0000-4000-8000-000000000001', 'C05GJASA', 'Jasa uji C05G', 'pcs', 'Jasa');
insert into public.vouchers (id, code, tipe, nilai) values
  ('c6a00000-0000-4000-8000-000000000001', 'GRPHEMAT', 'persen', 10);
insert into public.promos (id, name, promo_type, is_active, auto_apply, discount_type, discount_value)
  values ('c6b00000-0000-4000-8000-000000000001', 'Promo kode grup C05G', 'diskon_produk', true, false, 'percent', 20);
insert into public.campaign_codes (code, voucher_id, max_uses) values
  ('GRUP1', 'c6a00000-0000-4000-8000-000000000001', 1),
  ('BACKOFF1', 'c6a00000-0000-4000-8000-000000000001', 1);
insert into public.campaign_codes (code, promo_id, max_uses) values ('GRUPPROMO', 'c6b00000-0000-4000-8000-000000000001', 1);

-- Structural contract.
select pg_temp.ok(position('campaign_group' in pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure)) > 0
  and position('campaign_code' in pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure)) > 0,
  'clinic posting stores both the code and the group key in its atomic insert');
select pg_temp.ok(has_function_privilege('authenticated', 'public.clinic_post_invoice(uuid,text,jsonb,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.clinic_post_invoice(uuid,text,jsonb,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.campaign_code_used(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.guard_campaign_code_use()', 'EXECUTE'),
  'ACLs unchanged by the follow-up patch');

-- Group key of an owner for today (WIB), exactly what the app sends.
create function pg_temp.grp(customer text) returns text language sql stable as $$
  select customer || ':' || to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM-DD') $$;
grant execute on function pg_temp.grp(text) to authenticated;
-- One clinic invoice, posted exactly like bayarRombongan posts each pet.
create function pg_temp.post(visit text, key text, campaign text, voucher text, grp text) returns uuid language sql as $$
  select public.clinic_post_invoice(('c6500000-0000-4000-8000-00000000000' || visit)::uuid, key,
    jsonb_strip_nulls(jsonb_build_object('tanggal', (now() at time zone 'Asia/Jakarta')::date::text, 'subtotal', 100000, 'discount', 10000,
      'tax', 0, 'total', 90000, 'dp_amount', 0, 'paid_status', 'Lunas', 'metode_bayar', 'Tunai',
      'shift_id', 'c6700000-0000-4000-8000-000000000002', 'voucher_code', voucher, 'campaign_code', campaign,
      'campaign_group', grp, 'service_pricing_version', 1))
    || jsonb_build_object('dp_date', null, 'salesperson_id', null),
    jsonb_build_array(jsonb_build_object('description', 'Konsultasi', 'qty', 1, 'price', 100000, 'kind', 'jasa', 'discount_percent', 0))) $$;
grant execute on function pg_temp.post(text, text, text, text, text) to authenticated;
create function pg_temp.used(code text) returns bigint language sql security definer set search_path = '' as $$
  select public.campaign_code_used(code) $$;
grant execute on function pg_temp.used(text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'c6000000-0000-4000-8000-000000000004', true);

-- ---- (a) Group payment: one owner, several pets, one code, cap 1 -> one use ----
select pg_temp.post('1', 'grp-a:pet1', 'GRUP1', 'GRPHEMAT', pg_temp.grp('c6300000-0000-4000-8000-000000000001'));
select pg_temp.ok(pg_temp.used('GRUP1') = 1, 'first group invoice takes the single use');
select pg_temp.post('2', 'grp-a:pet2', 'GRUP1', 'GRPHEMAT', pg_temp.grp('c6300000-0000-4000-8000-000000000001'));
select pg_temp.ok(pg_temp.used('GRUP1') = 1, 'second pet of the same group joins the use (not refused by cap 1)');
select pg_temp.ok((select count(*) from public.invoices where campaign_code = 'GRUP1'
  and campaign_group = pg_temp.grp('c6300000-0000-4000-8000-000000000001') and voucher_code = 'GRPHEMAT') = 2,
  'both group invoices store code, bound voucher and group key');
-- Idempotent retry: same request key + same payload replays the stored invoice.
select pg_temp.ok(pg_temp.post('1', 'grp-a:pet1', 'GRUP1', 'GRPHEMAT', pg_temp.grp('c6300000-0000-4000-8000-000000000001'))
  = (select id from public.invoices where visit_id = 'c6500000-0000-4000-8000-000000000001' and voided_at is null),
  'retry returns the same invoice');
select pg_temp.ok(pg_temp.used('GRUP1') = 1 and (select count(*) from public.invoices where campaign_code = 'GRUP1') = 2,
  'retry adds neither an invoice nor a use');
-- Another owner's group and an ordinary per-visit checkout are new uses -> refused at cap.
select pg_temp.rejects($$select pg_temp.post('4', 'grp-b:pet4', 'GRUP1', 'GRPHEMAT', pg_temp.grp('c6300000-0000-4000-8000-000000000002'))$$,
  'sudah mencapai batas pemakaian (1 kali)', 'another owner''s group is a new use');
select pg_temp.rejects($$select pg_temp.post('3', 'single:pet3', 'GRUP1', 'GRPHEMAT', null)$$,
  'sudah mencapai batas pemakaian (1 kali)', 'a per-visit checkout of the same owner is still its own use');
-- The key cannot be borrowed: owner B cannot join owner A's group, nor use another day.
select pg_temp.rejects($$select pg_temp.post('4', 'grp-b:forged', 'GRUP1', 'GRPHEMAT', pg_temp.grp('c6300000-0000-4000-8000-000000000001'))$$,
  'tidak cocok dengan pemilik atau tanggal', 'group key of another owner is refused');
select pg_temp.rejects($$select pg_temp.post('3', 'grp-a:yesterday', 'GRUP1', 'GRPHEMAT',
  'c6300000-0000-4000-8000-000000000001:' || to_char((now() at time zone 'Asia/Jakarta') - interval '1 day', 'YYYY-MM-DD'))$$,
  'tidak cocok dengan pemilik atau tanggal', 'group key of another day is refused');
select pg_temp.rejects($$select pg_temp.post('3', 'grp-a:nocode', null, null, pg_temp.grp('c6300000-0000-4000-8000-000000000001'))$$,
  'invoices_campaign_group_needs_code', 'a group key without a campaign code is refused');
select pg_temp.ok(not exists (select 1 from public.invoices where visit_id in
  ('c6500000-0000-4000-8000-000000000003', 'c6500000-0000-4000-8000-000000000004')), 'refusals left no invoice behind');
-- Group key is immutable on the document, even for the database owner (clients cannot update invoices at all).
reset role;
select pg_temp.rejects($$update public.invoices set campaign_group = null where visit_id = 'c6500000-0000-4000-8000-000000000002'$$,
  'Grup pemakaian kode kampanye tidak boleh diubah', 'group key cannot be removed');
set local role authenticated;
-- Promo-bound code in a group (no voucher on any invoice): also one use.
select pg_temp.post('6', 'grp-a2:pet6', 'GRUPPROMO', null, pg_temp.grp('c6300000-0000-4000-8000-000000000001'));
select pg_temp.post('7', 'grp-a2:pet7', 'GRUPPROMO', null, pg_temp.grp('c6300000-0000-4000-8000-000000000001'));
select pg_temp.ok(pg_temp.used('GRUPPROMO') = 1, 'promo-bound code: group of two pets = one use');
reset role;

-- Manager report counts the group once.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c6000000-0000-4000-8000-000000000001', true);
select pg_temp.ok((select used from public.campaign_code_usage() where code = 'GRUP1') = 1
  and (select used from public.campaign_code_usage() where code = 'GRUPPROMO') = 1, 'usage report counts each group once');
reset role;

-- Void frees the group's use only when no live invoice of that group still carries the code.
set local session_replication_role = replica;   -- fixture step: bypass posted-invoice guards (as in c05_campaign_codes.sql)
update public.invoices set voided_at = now() where visit_id = 'c6500000-0000-4000-8000-000000000001' and voided_at is null;
set local session_replication_role = origin;
select pg_temp.ok(pg_temp.used('GRUP1') = 1, 'one pet voided: the other pet still holds the group''s use');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c6000000-0000-4000-8000-000000000004', true);
select pg_temp.rejects($$select pg_temp.post('4', 'grp-b:pet4', 'GRUP1', 'GRPHEMAT', pg_temp.grp('c6300000-0000-4000-8000-000000000002'))$$,
  'sudah mencapai batas pemakaian', 'cap still holds while part of the group is live');
reset role;
set local session_replication_role = replica;
update public.invoices set voided_at = now() where visit_id = 'c6500000-0000-4000-8000-000000000002' and voided_at is null;
set local session_replication_role = origin;
select pg_temp.ok(pg_temp.used('GRUP1') = 0, 'whole group voided: the use is free again');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c6000000-0000-4000-8000-000000000004', true);
select pg_temp.post('4', 'grp-b:pet4', 'GRUP1', 'GRPHEMAT', pg_temp.grp('c6300000-0000-4000-8000-000000000002'));
select pg_temp.post('5', 'grp-b:pet5', 'GRUP1', 'GRPHEMAT', pg_temp.grp('c6300000-0000-4000-8000-000000000002'));
select pg_temp.ok(pg_temp.used('GRUP1') = 1, 'freed use taken by owner B''s group (two pets, one use)');
reset role;

-- Clinic void+reissue of a group invoice inherits code and group: never counted twice.
create temp table c05g_src as select * from public.invoices
  where visit_id = 'c6500000-0000-4000-8000-000000000004' and voided_at is null;
set local session_replication_role = replica;
update public.invoices set voided_at = now() where id = (select id from c05g_src);
set local session_replication_role = origin;
insert into public.invoices (visit_id, invoice_no, subtotal, discount, tax, total, paid_status, voucher_code, reissued_from)
  select visit_id, invoice_no || '-R', subtotal, discount, tax, total, 'Belum Lunas', voucher_code, id from c05g_src;
select pg_temp.ok((select campaign_code = 'GRUP1' and campaign_group = pg_temp.grp('c6300000-0000-4000-8000-000000000002')
  from public.invoices where reissued_from = (select id from c05g_src)), 'reissue inherits code and group key');
select pg_temp.ok(pg_temp.used('GRUP1') = 1, 'reissue keeps the single group use');
select pg_temp.rejects($$insert into public.invoices (visit_id, invoice_no, subtotal, discount, tax, total, paid_status, voucher_code, reissued_from, campaign_group)
  select visit_id, invoice_no || '-X', subtotal, discount, tax, total, 'Belum Lunas', voucher_code, id, 'lain:2000-01-01' from c05g_src$$,
  'tidak boleh mengganti grup', 'reissue cannot switch group');

-- ---- (b) Back-office POS (/pos/transaksi): no shift, finalized by finalize_pos_sale ----
create function pg_temp.bo_sale(ref text, campaign text, voucher text) returns uuid language plpgsql as $$
declare doc uuid;
begin
  insert into public.sales (branch_id, no_struk, subtotal, discount, total, metode_bayar, bayar, cashier_id, payment_plan,
                            checkout_key, checkout_fingerprint, campaign_code, voucher_code)
  values ('c6100000-0000-4000-8000-000000000001', ref, 100000, 10000, 90000, 'Tunai', 90000, auth.uid(),
          '[{"method":"Tunai","amount":90000}]', 'bo:' || ref, repeat('b', 64), campaign, voucher)
  returning id into doc;
  insert into public.sale_items (sale_id, item_id, nama, qty, harga, satuan, faktor, hpp)
    values (doc, 'c6900000-0000-4000-8000-000000000001', 'Jasa uji', 1, 100000, 'pcs', 1, 0);
  return doc;
end $$;
grant execute on function pg_temp.bo_sale(text, text, text) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c6000000-0000-4000-8000-000000000003', true);
-- Two drafts written while the code is still free: writing does not use the code.
select pg_temp.bo_sale('BO-1', 'BACKOFF1', 'GRPHEMAT');
select pg_temp.bo_sale('BO-2', 'BACKOFF1', 'GRPHEMAT');
select pg_temp.ok(pg_temp.used('BACKOFF1') = 0, 'unfinalized back-office receipts do not use the code');
select public.finalize_pos_sale((select id from public.sales where no_struk = 'BO-1'));
select pg_temp.ok(pg_temp.used('BACKOFF1') = 1, 'finalized back-office receipt uses the code');
-- Idempotent retry of the finalizer: no second use, same answer.
select pg_temp.ok((public.finalize_pos_sale((select id from public.sales where no_struk = 'BO-1')) ->> 'finalized')::boolean
  and pg_temp.used('BACKOFF1') = 1, 'finalizer retry adds no use');
select pg_temp.rejects($$insert into public.sales (branch_id, no_struk, subtotal, total, metode_bayar, bayar, cashier_id, payment_plan, checkout_key, checkout_fingerprint)
  values ('c6100000-0000-4000-8000-000000000001', 'BO-1-DUP', 1, 1, 'Tunai', 1, auth.uid(), '[{"method":"Tunai","amount":1}]', 'bo:BO-1', repeat('b', 64))$$,
  'duplicate key', 'same checkout key cannot write a second receipt');
-- Authoritative cap check at payment: the second draft cannot be finalized.
select pg_temp.rejects($$select public.finalize_pos_sale((select id from public.sales where no_struk = 'BO-2'))$$,
  'sudah mencapai batas pemakaian (1 kali)', 'second back-office receipt refused at payment');
select pg_temp.rejects($$select pg_temp.bo_sale('BO-3', 'BACKOFF1', 'GRPHEMAT')$$,
  'sudah mencapai batas pemakaian (1 kali)', 'new back-office receipt refused at write once cap is reached');
select pg_temp.rejects($$select pg_temp.bo_sale('BO-WRONG', 'BACKOFF1', null)$$,
  'harus memakai voucher GRPHEMAT', 'back-office receipt must carry the bound voucher');
reset role;
-- A voided receipt frees its use (owner-approved void sets voided_at, as in c05_campaign_codes.sql).
update public.sales set voided_at = now(), void_reason = 'uji C05G' where no_struk = 'BO-1';
select pg_temp.ok(pg_temp.used('BACKOFF1') = 0, 'void frees the back-office use');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c6000000-0000-4000-8000-000000000003', true);
select public.finalize_pos_sale((select id from public.sales where no_struk = 'BO-2'));
select pg_temp.ok(pg_temp.used('BACKOFF1') = 1, 'pending draft can now be paid with the freed use');
reset role;

select 'C05 campaign codes in group payment and back-office POS: passed';
rollback;
