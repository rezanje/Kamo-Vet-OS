-- I09 lanjutan: riwayat virtual SKU induk racikan nonstok. Fictional data only; everything rolls back.
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
  ('19a00000-0000-4000-8000-000000000001'), ('19a00000-0000-4000-8000-000000000002'),
  ('19a00000-0000-4000-8000-000000000003');
update public.profiles set role = 'OWNER', is_active = true where id = '19a00000-0000-4000-8000-000000000001';
update public.profiles set role = 'DOCTOR', is_active = true where id = '19a00000-0000-4000-8000-000000000002';
update public.profiles set role = 'FINANCE', is_active = true where id = '19a00000-0000-4000-8000-000000000003';
insert into public.branches (id, code, name, type) values
  ('19a10000-0000-4000-8000-000000000001', 'I9RA', 'Klinik Riwayat A', 'KLINIK'),
  ('19a10000-0000-4000-8000-000000000002', 'I9RB', 'Klinik Riwayat B', 'KLINIK');
insert into public.user_branches (user_id, branch_id) values
  ('19a00000-0000-4000-8000-000000000002', '19a10000-0000-4000-8000-000000000001'),
  ('19a00000-0000-4000-8000-000000000003', '19a10000-0000-4000-8000-000000000001');
insert into public.items (id, code, name, unit, item_type, sell_price, buy_price) values
  ('19a20000-0000-4000-8000-000000000001', 'I9RP', 'Obat Racik Puyer Riwayat', 'pcs', 'Persediaan', 25000, 0),
  ('19a20000-0000-4000-8000-000000000002', 'I9RQ', 'Obat Racik Sirup Lain', 'pcs', 'Persediaan', 30000, 0),
  ('19a20000-0000-4000-8000-000000000003', 'I9RX', 'Pakan Biasa Riwayat', 'pcs', 'Persediaan', 10000, 5000);
insert into public.customers (id, name, phone) values
  ('19a30000-0000-4000-8000-000000000001', 'Pemilik Riwayat A', '081100000901'),
  ('19a30000-0000-4000-8000-000000000002', 'Pemilik Riwayat B', '081100000902');
insert into public.pets (id, customer_id, name) values
  ('19a40000-0000-4000-8000-000000000001', '19a30000-0000-4000-8000-000000000001', 'Pasien Riwayat A'),
  ('19a40000-0000-4000-8000-000000000002', '19a30000-0000-4000-8000-000000000002', 'Pasien Riwayat B');
-- Visit 1 & 3 in branch A, visit 2 in branch B (the doctor cannot open branch B).
insert into public.visits (id, branch_id, customer_id, pet_id, created_at) values
  ('19a50000-0000-4000-8000-000000000001', '19a10000-0000-4000-8000-000000000001', '19a30000-0000-4000-8000-000000000001', '19a40000-0000-4000-8000-000000000001', '2026-10-10 02:00+00'),
  ('19a50000-0000-4000-8000-000000000002', '19a10000-0000-4000-8000-000000000002', '19a30000-0000-4000-8000-000000000002', '19a40000-0000-4000-8000-000000000002', '2026-10-11 02:00+00'),
  ('19a50000-0000-4000-8000-000000000003', '19a10000-0000-4000-8000-000000000001', '19a30000-0000-4000-8000-000000000001', '19a40000-0000-4000-8000-000000000001', '2026-09-01 02:00+00');
insert into public.medical_records (id, visit_id) values
  ('19a60000-0000-4000-8000-000000000001', '19a50000-0000-4000-8000-000000000001'),
  ('19a60000-0000-4000-8000-000000000002', '19a50000-0000-4000-8000-000000000002'),
  ('19a60000-0000-4000-8000-000000000003', '19a50000-0000-4000-8000-000000000003');
-- Racikan: R1 (A, ditagih), R2 (B, ditagih lalu invoice dibatalkan), R3 (A, bulan lalu), R4 (SKU lain).
insert into public.compounding_recipes (id, medical_record_id, recipe_name, dosage_form, status, created_by, request_key, created_at) values
  ('19a70000-0000-4000-8000-000000000001', '19a60000-0000-4000-8000-000000000001', 'Puyer batuk A', 'puyer', 'handed_over', '19a00000-0000-4000-8000-000000000002', 'i9r-1', '2026-10-10 03:00+00'),
  ('19a70000-0000-4000-8000-000000000002', '19a60000-0000-4000-8000-000000000002', 'Puyer batuk B', 'puyer', 'ready', '19a00000-0000-4000-8000-000000000001', 'i9r-2', '2026-10-11 03:00+00'),
  ('19a70000-0000-4000-8000-000000000003', '19a60000-0000-4000-8000-000000000003', 'Puyer lama', 'puyer', 'void', '19a00000-0000-4000-8000-000000000002', 'i9r-3', '2026-09-01 03:00+00'),
  ('19a70000-0000-4000-8000-000000000004', '19a60000-0000-4000-8000-000000000001', 'Sirup lain', 'sirup', 'pending', '19a00000-0000-4000-8000-000000000002', 'i9r-4', '2026-10-10 04:00+00');
insert into public.clinic_compound_sales (request_key, request_hash, recipe_id, visit_id, medical_record_id, actor_id, sale_item_id, sale_name, sale_price, sale_unit) values
  ('i9r-1', 'h1', '19a70000-0000-4000-8000-000000000001', '19a50000-0000-4000-8000-000000000001', '19a60000-0000-4000-8000-000000000001', '19a00000-0000-4000-8000-000000000002', '19a20000-0000-4000-8000-000000000001', 'Obat Racik Puyer Riwayat', 25000, 'pcs'),
  ('i9r-2', 'h2', '19a70000-0000-4000-8000-000000000002', '19a50000-0000-4000-8000-000000000002', '19a60000-0000-4000-8000-000000000002', '19a00000-0000-4000-8000-000000000001', '19a20000-0000-4000-8000-000000000001', 'Obat Racik Puyer Riwayat', 25000, 'pcs'),
  ('i9r-3', 'h3', '19a70000-0000-4000-8000-000000000003', '19a50000-0000-4000-8000-000000000003', '19a60000-0000-4000-8000-000000000003', '19a00000-0000-4000-8000-000000000002', '19a20000-0000-4000-8000-000000000001', 'Obat Racik Puyer Riwayat', 25000, 'pcs'),
  ('i9r-4', 'h4', '19a70000-0000-4000-8000-000000000004', '19a50000-0000-4000-8000-000000000001', '19a60000-0000-4000-8000-000000000001', '19a00000-0000-4000-8000-000000000002', '19a20000-0000-4000-8000-000000000002', 'Obat Racik Sirup Lain', 30000, 'pcs');
insert into public.invoices (id, visit_id, invoice_no, subtotal, total, paid_status, created_at) values
  ('19a80000-0000-4000-8000-000000000001', '19a50000-0000-4000-8000-000000000001', 'INV.I9R.00001', 25000, 25000, 'Lunas', '2026-10-10 05:00+00'),
  ('19a80000-0000-4000-8000-000000000002', '19a50000-0000-4000-8000-000000000002', 'INV.I9R.00002', 25000, 25000, 'Lunas', '2026-10-11 05:00+00');
insert into public.invoice_items (id, invoice_id, deskripsi, qty, harga, hpp, satuan, compound_recipe_id) values
  ('19a90000-0000-4000-8000-000000000001', '19a80000-0000-4000-8000-000000000001', 'Obat Racik Puyer Riwayat', 1, 25000, 4321, 'racikan', '19a70000-0000-4000-8000-000000000001'),
  ('19a90000-0000-4000-8000-000000000002', '19a80000-0000-4000-8000-000000000002', 'Obat Racik Puyer Riwayat', 1, 25000, 4321, 'racikan', '19a70000-0000-4000-8000-000000000002');
set local session_replication_role = replica;   -- fixture step only: void invoice 2
update public.invoices set voided_at = '2026-10-12 01:00+00' where id = '19a80000-0000-4000-8000-000000000002';
set local session_replication_role = origin;

-- Structural contract.
select pg_temp.ok(has_function_privilege('authenticated', 'public.read_compound_parent_history(uuid,date,date,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.read_compound_parent_history(uuid,date,date,integer,integer)', 'EXECUTE'),
  'only signed-in users may call the history');
select pg_temp.ok((select provolatile = 's' and prosecdef from pg_proc where oid = 'public.read_compound_parent_history(uuid,date,date,integer,integer)'::regprocedure),
  'history RPC is STABLE (read-only) security definer');
create temp table i9r_before as select (select count(*) from public.stock_moves) moves, (select count(*) from public.stock) stock_rows,
  (select count(*) from public.stock_layers) layers, (select count(*) from public.compounding_recipes) recipes, (select count(*) from public.invoice_items) lines;
grant select on i9r_before to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Owner: whole history of the parent SKU in October (R3 is in September, R4 is another SKU).
select set_config('request.jwt.claim.sub', '19a00000-0000-4000-8000-000000000001', true);
create temp table i9r_owner as select * from public.read_compound_parent_history('19a20000-0000-4000-8000-000000000001', '2026-10-01', '2026-10-31', 0, 500);
select pg_temp.ok((select count(*) from i9r_owner) = 4 and (select bool_and(total_baris = 4) from i9r_owner), 'owner: 2 made + 2 sold in October, count reported on every row');
select pg_temp.ok((select array_agg(id order by waktu, id) from i9r_owner) = array[
  'masuk:19a70000-0000-4000-8000-000000000001', 'keluar:19a90000-0000-4000-8000-000000000001',
  'masuk:19a70000-0000-4000-8000-000000000002', 'keluar:19a90000-0000-4000-8000-000000000002'], 'chronological order with unique ids');
select pg_temp.ok((select arah = 'masuk' and qty = 1 and satuan = 'pcs' and tanggal = '2026-10-10' and recipe_id = '19a70000-0000-4000-8000-000000000001'
  and nomor_racikan = 'R/2026/1010/19A' and nama_racikan = 'Puyer batuk A' and status_racikan = 'handed_over'
  and sumber = 'Racikan bebas dari rekam medis' and visit_id = '19a50000-0000-4000-8000-000000000001'
  and pasien = 'Pasien Riwayat A' and pelanggan = 'Pemilik Riwayat A' and cabang = 'Klinik Riwayat A' and invoice_id is null and bisa_dibuka
  from i9r_owner where id = 'masuk:19a70000-0000-4000-8000-000000000001'), 'Masuk row: date, qty, compound number, source, visit/patient');
select pg_temp.ok((select arah = 'keluar' and qty = 1 and satuan = 'racikan' and invoice_id = '19a80000-0000-4000-8000-000000000001'
  and nomor_invoice = 'INV.I9R.00001' and not invoice_batal and pelanggan = 'Pemilik Riwayat A' and nomor_racikan = 'R/2026/1010/19A'
  from i9r_owner where id = 'keluar:19a90000-0000-4000-8000-000000000001'), 'Keluar row: invoice link and customer');
select pg_temp.ok((select invoice_batal from i9r_owner where id = 'keluar:19a90000-0000-4000-8000-000000000002'), 'voided invoice is flagged, not hidden');
select pg_temp.ok((select bool_and(position('harga' in to_jsonb(o)::text) = 0 and position('hpp' in to_jsonb(o)::text) = 0
  and position('25000' in to_jsonb(o)::text) = 0 and position('4321' in to_jsonb(o)::text) = 0) from i9r_owner o), 'no prices or costs returned');

-- Date range, paging and count verification inputs.
select pg_temp.ok((select count(*) = 1 and bool_and(status_racikan = 'void' and total_baris = 1)
  from public.read_compound_parent_history('19a20000-0000-4000-8000-000000000001', '2026-09-01', '2026-09-30')), 'September holds only the void racikan R3');
select pg_temp.ok((select array_agg(id order by waktu, id) from public.read_compound_parent_history('19a20000-0000-4000-8000-000000000001', '2026-10-01', '2026-10-31', 1, 2))
  = array['keluar:19a90000-0000-4000-8000-000000000001', 'masuk:19a70000-0000-4000-8000-000000000002'], 'offset/limit pages are stable slices');
select pg_temp.ok((select count(*) = 0 from public.read_compound_parent_history('19a20000-0000-4000-8000-000000000001', '2026-10-01', '2026-10-31', 4, 2)),
  'page past the end is empty');
select pg_temp.ok((select count(*) = 1 and bool_and(id = 'masuk:19a70000-0000-4000-8000-000000000004')
  from public.read_compound_parent_history('19a20000-0000-4000-8000-000000000002', '2026-10-01', '2026-10-31')), 'another parent SKU has its own history');
select pg_temp.rejects($$select * from public.read_compound_parent_history('19a20000-0000-4000-8000-000000000001', '2026-10-31', '2026-10-01')$$,
  'RIWAYAT_TIDAK_VALID', 'reversed date range rejected');
select pg_temp.rejects($$select * from public.read_compound_parent_history('19a20000-0000-4000-8000-000000000001', '2026-10-01', '2026-10-31', 0, 0)$$,
  'RIWAYAT_TIDAK_VALID', 'zero page size rejected');
select pg_temp.rejects($$select * from public.read_compound_parent_history('19a20000-0000-4000-8000-000000000003', '2026-10-01', '2026-10-31')$$,
  'bukan induk racikan', 'ordinary stock item rejected');

-- Doctor limited to branch A: branch B rows keep their numbers but lose links and names.
select set_config('request.jwt.claim.sub', '19a00000-0000-4000-8000-000000000002', true);
create temp table i9r_doctor as select * from public.read_compound_parent_history('19a20000-0000-4000-8000-000000000001', '2026-10-01', '2026-10-31');
select pg_temp.ok((select count(*) = 4 from i9r_doctor), 'doctor sees the same 4 movements (totals stay complete)');
select pg_temp.ok((select bool_and(bisa_dibuka and recipe_id is not null and visit_id is not null) from i9r_doctor where cabang = 'Klinik Riwayat A'),
  'own-branch rows are linkable');
select pg_temp.ok((select bool_and(not bisa_dibuka and recipe_id is null and visit_id is null and invoice_id is null and pasien is null
  and pelanggan is null and nama_racikan is null and nomor_racikan = 'R/2026/1011/19A') from i9r_doctor where cabang = 'Klinik Riwayat B'),
  'other-branch rows: number only, no link, no names');
select pg_temp.ok((select nomor_invoice = 'INV.I9R.00002' from i9r_doctor where id = 'keluar:19a90000-0000-4000-8000-000000000002'),
  'other-branch invoice number still shown');

-- FINANCE (default modules have neither Persediaan nor Klinik) and anonymous callers are denied.
select set_config('request.jwt.claim.sub', '19a00000-0000-4000-8000-000000000003', true);
select pg_temp.rejects($$select * from public.read_compound_parent_history('19a20000-0000-4000-8000-000000000001', '2026-10-01', '2026-10-31')$$,
  'Akses riwayat racikan ditolak', 'finance without inventory/clinic module denied');
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.rejects($$select * from public.read_compound_parent_history('19a20000-0000-4000-8000-000000000001', '2026-10-01', '2026-10-31')$$,
  'Akses riwayat racikan ditolak', 'anonymous denied');
reset role;

-- Read-only: nothing written, and the non-stock parent still has no stock.
select pg_temp.ok((select moves from i9r_before) = (select count(*) from public.stock_moves)
  and (select stock_rows from i9r_before) = (select count(*) from public.stock)
  and (select layers from i9r_before) = (select count(*) from public.stock_layers)
  and (select recipes from i9r_before) = (select count(*) from public.compounding_recipes)
  and (select lines from i9r_before) = (select count(*) from public.invoice_items), 'history writes nothing');
select pg_temp.ok(not exists (select 1 from public.stock where item_id = '19a20000-0000-4000-8000-000000000001')
  and not exists (select 1 from public.stock_moves where item_id = '19a20000-0000-4000-8000-000000000001'), 'non-stock parent never gets stock');

select 'I09 riwayat induk racikan: passed';
rollback;
