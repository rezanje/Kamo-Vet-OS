-- Appended to the clinic_invoice_post.sql fixture prefix (fictional rows, all rolled back).
-- UPDATEs of clinic/POS lines must no longer trip zz_grooming_requirement, and the
-- grooming performer rule must still hold on INSERT and on key-changing UPDATEs.
create function pg_temp.ok(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', label; end if; end $$;
create function pg_temp.reject(statement text, expected text, label text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlerrm not like '%' || expected || '%' then raise exception 'Wrong rejection for %: %', label, sqlerrm; end if;
    return;
  end;
  raise exception 'Expected rejection: %', label;
end $$;

insert into public.items(id, code, name, unit, item_type, tindakan_kategori, is_active) values
  ('fa300000-0000-4000-8000-000000000001', 'GTU-GROOM', 'Fictional grooming', 'pcs', 'Jasa', 'Grooming', true),
  ('fa300000-0000-4000-8000-000000000002', 'GTU-OTHER', 'Fictional consult', 'pcs', 'Jasa', 'Konsultasi', true);
insert into public.employees(id, nama, jabatan, branch_id, status) values
  ('fa400000-0000-4000-8000-000000000001', 'Fictional groomer', 'Groomer', 'd2000000-0000-4000-8000-000000000001', 'Aktif'),
  ('fa400000-0000-4000-8000-000000000002', 'Fictional doctor', 'Dokter', 'd2000000-0000-4000-8000-000000000001', 'Aktif');
insert into public.sales(id, branch_id, no_struk, subtotal, total, cashier_id) values
  ('fa500000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'GTU.SALE', 0, 0, 'd1000000-0000-4000-8000-000000000002');

-- 1. The reported failure: plain UPDATE of an existing (non-grooming) prescription line.
update public.prescription_items set qty = 3 where id = 'd9000000-0000-4000-8000-000000000001';
select pg_temp.ok((select qty = 3 from public.prescription_items where id = 'd9000000-0000-4000-8000-000000000001'), 'prescription UPDATE succeeds');

-- 2. Grooming prescription INSERT still enforced (KLINIK: groomer + doctor).
select pg_temp.reject($q$insert into public.prescription_items(id, medical_record_id, nama_obat, qty, harga, jenis, item_id)
  values ('fa900000-0000-4000-8000-000000000009', 'd7000000-0000-4000-8000-000000000002', 'Groom no staff', 1, 50, 'jasa', 'fa300000-0000-4000-8000-000000000001')$q$,
  'groomer wajib', 'prescription INSERT without groomer');
select pg_temp.reject($q$insert into public.prescription_items(id, medical_record_id, nama_obat, qty, harga, jenis, item_id, service_performers)
  values ('fa900000-0000-4000-8000-000000000009', 'd7000000-0000-4000-8000-000000000002', 'Groom no doctor', 1, 50, 'jasa', 'fa300000-0000-4000-8000-000000000001',
  '{"staff_id":"fa400000-0000-4000-8000-000000000001"}')$q$,
  'dokter wajib', 'clinic prescription INSERT without doctor');
insert into public.prescription_items(id, medical_record_id, nama_obat, qty, harga, jenis, item_id, kategori, service_performers)
  values ('fa900000-0000-4000-8000-000000000001', 'd7000000-0000-4000-8000-000000000002', 'Groom valid', 1, 50, 'jasa',
  'fa300000-0000-4000-8000-000000000001', 'Grooming',
  '{"staff_id":"fa400000-0000-4000-8000-000000000001","doctor_id":"fa400000-0000-4000-8000-000000000002"}');

-- 3. Non-key UPDATE of a grooming line succeeds; protected changes are still rejected.
update public.prescription_items set qty = 2, harga = 60 where id = 'fa900000-0000-4000-8000-000000000001';
select pg_temp.ok((select qty = 2 and harga = 60 from public.prescription_items where id = 'fa900000-0000-4000-8000-000000000001'), 'grooming prescription UPDATE succeeds');
select pg_temp.reject($q$update public.prescription_items set kategori = 'Konsultasi' where id = 'fa900000-0000-4000-8000-000000000001'$q$,
  'kategori Grooming tersimpan', 'saved Grooming category cannot be changed');
-- Key change of a plain line into grooming re-runs the rule.
select pg_temp.reject($q$update public.prescription_items set item_id = 'fa300000-0000-4000-8000-000000000001', jenis = 'jasa'
  where id = 'd9000000-0000-4000-8000-000000000001'$q$, 'groomer wajib', 'switching a line to grooming without groomer');

-- 4. invoice_items: a posted invoice line can be updated; manual grooming line INSERT still enforced.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare inv uuid;
  header jsonb := jsonb_build_object('tanggal', current_date::text, 'subtotal', 100, 'discount', 0, 'tax', 0, 'total', 100,
    'dp_amount', 0, 'dp_date', null, 'paid_status', 'Belum Lunas', 'metode_bayar', 'Tunai', 'shift_id', 'da000000-0000-4000-8000-000000000001');
begin
  begin
    perform public.clinic_post_invoice('d6000000-0000-4000-8000-000000000003', 'GTU.groom.missing', header,
      jsonb_build_array(jsonb_build_object('description', 'Groom', 'qty', 1, 'price', 100, 'kind', 'jasa',
        'item_id', 'fa300000-0000-4000-8000-000000000001', 'unit', 'pcs', 'discount_percent', 0)));
    raise exception 'Expected manual grooming invoice line rejection';
  exception when others then if sqlerrm not like '%groomer wajib%' then raise; end if; end;
  inv := public.clinic_post_invoice('d6000000-0000-4000-8000-000000000004', 'GTU.consult', header,
    jsonb_build_array(jsonb_build_object('description', 'Consult', 'qty', 1, 'price', 100, 'kind', 'jasa',
      'item_id', 'fa300000-0000-4000-8000-000000000002', 'unit', 'pcs', 'discount_percent', 0)));
  perform pg_temp.ok(inv is not null, 'non-grooming invoice posts');
end $$;
reset role;
update public.invoice_items set deskripsi = 'Consult (renamed)'
  where invoice_id = (select id from public.invoices where request_key = 'GTU.consult');
select pg_temp.ok((select deskripsi = 'Consult (renamed)' from public.invoice_items
  where invoice_id = (select id from public.invoices where request_key = 'GTU.consult')), 'invoice line UPDATE succeeds');

-- 5. sale_items: changing item_id falls through to the rule without touching invoice-only fields.
insert into public.sale_items(id, sale_id, item_id, nama, qty, harga) values
  ('fa600000-0000-4000-8000-000000000001', 'fa500000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001', 'Goods', 1, 0);
update public.sale_items set item_id = 'd8000000-0000-4000-8000-000000000004' where id = 'fa600000-0000-4000-8000-000000000001';
select pg_temp.ok((select item_id = 'd8000000-0000-4000-8000-000000000004' from public.sale_items where id = 'fa600000-0000-4000-8000-000000000001'),
  'sale line item change succeeds');
select pg_temp.reject($q$update public.sale_items set item_id = 'fa300000-0000-4000-8000-000000000001' where id = 'fa600000-0000-4000-8000-000000000001'$q$,
  'groomer wajib', 'sale line switched to grooming without groomer');
rollback;
