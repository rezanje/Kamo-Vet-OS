-- 20261108090000: rincian promo per barang di invoice klinik. Fictional data only; rolls back.
begin;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'Assertion failed: %', msg; end if; raise notice 'PASS %', msg; end $$;
create function pg_temp.rejects(stmt text, needle text, msg text) returns void language plpgsql as $$
declare hit boolean := false;
begin
  begin execute stmt; exception when others then
    hit := needle is null or position(needle in sqlerrm) > 0;
    if not hit then raise exception 'Wrong rejection for %: %', msg, sqlerrm; end if;
  end;
  if not hit then raise exception 'Expected rejection: %', msg; end if;
  raise notice 'PASS %', msg;
end $$;
grant execute on function pg_temp.ok(boolean, text) to authenticated;
grant execute on function pg_temp.rejects(text, text, text) to authenticated;

insert into auth.users (id, raw_user_meta_data) values
  ('e8000000-0000-4000-8000-000000000001', '{"full_name":"Kasir klinik fiktif"}'),
  ('e8000000-0000-4000-8000-000000000002', '{"full_name":"Kasir cabang lain fiktif"}');
update public.profiles set role = 'STAFF', is_active = true
  where id in ('e8000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000002');
insert into public.branches (id, code, name, type) values
  ('e8100000-0000-4000-8000-000000000001', 'RPK1', 'Klinik promo fiktif', 'KLINIK'),
  ('e8100000-0000-4000-8000-000000000002', 'RPK2', 'Klinik lain fiktif', 'KLINIK');
insert into public.user_branches (user_id, branch_id) values
  ('e8000000-0000-4000-8000-000000000001', 'e8100000-0000-4000-8000-000000000001'),
  ('e8000000-0000-4000-8000-000000000002', 'e8100000-0000-4000-8000-000000000002');
insert into public.customers (id, name, phone) values ('e8300000-0000-4000-8000-000000000001', 'Pemilik fiktif', '081100008081');
insert into public.pets (id, customer_id, name) values ('e8400000-0000-4000-8000-000000000001', 'e8300000-0000-4000-8000-000000000001', 'Kucing fiktif');
insert into public.visits (id, branch_id, customer_id, pet_id) values
  ('e8500000-0000-4000-8000-000000000001', 'e8100000-0000-4000-8000-000000000001', 'e8300000-0000-4000-8000-000000000001', 'e8400000-0000-4000-8000-000000000001'),
  ('e8500000-0000-4000-8000-000000000002', 'e8100000-0000-4000-8000-000000000001', 'e8300000-0000-4000-8000-000000000001', 'e8400000-0000-4000-8000-000000000001');
-- Invoice fiktif langsung (pagar posting dilewati hanya untuk fixture ini).
set local session_replication_role = replica;
insert into public.invoices (id, visit_id, invoice_no, subtotal, discount, tax, total, paid_status) values
  ('e8600000-0000-4000-8000-000000000001', 'e8500000-0000-4000-8000-000000000001', 'INV-RPK-1', 100000, 30000, 0, 70000, 'Lunas'),
  ('e8600000-0000-4000-8000-000000000002', 'e8500000-0000-4000-8000-000000000002', 'INV-RPK-2', 100000, 30000, 0, 70000, 'Lunas');
update public.invoices set voided_at = now() where id = 'e8600000-0000-4000-8000-000000000002';
set local session_replication_role = origin;

-- Kontrak struktur.
select pg_temp.ok(not has_function_privilege('authenticated', 'public.guard_invoice_promo_lines()', 'EXECUTE'),
  'fungsi pagar tidak bisa dipanggil langsung');
select pg_temp.ok(has_table_privilege('authenticated', 'public.invoice_promo_lines', 'SELECT')
  and has_table_privilege('authenticated', 'public.invoice_promo_lines', 'INSERT')
  and not has_table_privilege('authenticated', 'public.invoice_promo_lines', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.invoice_promo_lines', 'DELETE')
  and not has_table_privilege('anon', 'public.invoice_promo_lines', 'SELECT'),
  'pengguna hanya bisa membaca & menambah, tidak mengubah/menghapus; anon tidak bisa apa-apa');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000001', true);

insert into public.invoice_promo_lines (invoice_id, item_id, promo_id, promo_name, potongan, created_by) values
  ('e8600000-0000-4000-8000-000000000001', 'e8700000-0000-4000-8000-000000000001', 'e8800000-0000-4000-8000-000000000001', 'Icarae MBC', 27000,
   'e8000000-0000-4000-8000-000000000002');
select pg_temp.ok((select count(*) = 1 and min(created_by::text) = 'e8000000-0000-4000-8000-000000000001'
    from public.invoice_promo_lines where invoice_id = 'e8600000-0000-4000-8000-000000000001'),
  'kasir cabangnya mencatat promo; pencatat dipaksa = pengguna yang login');

insert into public.invoice_promo_lines (invoice_id, item_id, promo_id, promo_name, potongan) values
  ('e8600000-0000-4000-8000-000000000001', 'e8700000-0000-4000-8000-000000000001', 'e8800000-0000-4000-8000-000000000001', 'Icarae MBC', 27000);
select pg_temp.ok((select count(*) = 1 and sum(potongan) = 27000 from public.invoice_promo_lines where invoice_id = 'e8600000-0000-4000-8000-000000000001'),
  'kirim ulang baris yang sama dilewati, tidak dobel');

select pg_temp.rejects($$insert into public.invoice_promo_lines (invoice_id, item_id, promo_id, promo_name, potongan) values
  ('e8600000-0000-4000-8000-000000000001', 'e8700000-0000-4000-8000-000000000002', 'e8800000-0000-4000-8000-000000000001', 'Icarae MBC', 3001)$$,
  'PROMO_LINE_LEBIH', 'total promo tidak boleh melebihi diskon invoice');
insert into public.invoice_promo_lines (invoice_id, item_id, promo_id, promo_name, potongan) values
  ('e8600000-0000-4000-8000-000000000001', 'e8700000-0000-4000-8000-000000000002', 'e8800000-0000-4000-8000-000000000001', 'Icarae MBC', 3000);
select pg_temp.ok((select sum(potongan) = 30000 from public.invoice_promo_lines where invoice_id = 'e8600000-0000-4000-8000-000000000001'),
  'promo tepat sebesar diskon invoice diterima');

select pg_temp.rejects($$insert into public.invoice_promo_lines (invoice_id, item_id, promo_id, promo_name, potongan) values
  ('e8600000-0000-4000-8000-000000000002', 'e8700000-0000-4000-8000-000000000001', 'e8800000-0000-4000-8000-000000000001', 'Icarae MBC', 1000)$$,
  null, 'invoice yang dibatalkan tidak bisa diberi rincian promo');
select pg_temp.rejects($$insert into public.invoice_promo_lines (invoice_id, item_id, promo_id, promo_name, potongan) values
  ('e8600000-0000-4000-8000-000000000001', 'e8700000-0000-4000-8000-000000000003', 'e8800000-0000-4000-8000-000000000001', 'Icarae MBC', 0)$$,
  null, 'potongan nol ditolak');
select pg_temp.rejects($$update public.invoice_promo_lines set potongan = 1$$, null, 'baris tidak bisa diubah');
select pg_temp.rejects($$delete from public.invoice_promo_lines$$, null, 'baris tidak bisa dihapus');

select set_config('request.jwt.claim.sub', 'e8000000-0000-4000-8000-000000000002', true);
select pg_temp.ok((select count(*) = 0 from public.invoice_promo_lines), 'kasir cabang lain tidak melihat rincian promo');
select pg_temp.rejects($$insert into public.invoice_promo_lines (invoice_id, item_id, promo_id, promo_name, potongan) values
  ('e8600000-0000-4000-8000-000000000001', 'e8700000-0000-4000-8000-000000000009', 'e8800000-0000-4000-8000-000000000009', 'Promo lain', 1)$$,
  null, 'kasir cabang lain tidak bisa menambah rincian promo');

reset role;
select 'rincian_promo_baris_klinik: passed';
rollback;
