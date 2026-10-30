-- Promo/voucher lewat masa berlaku = nonaktif otomatis (keputusan Andri, 29 Okt 2026).
-- Data fiktif saja; seluruh transaksi di-rollback di akhir. Tidak pernah
-- menyentuh database nyata dan tidak menerima URL database.
begin;
create temporary table promo_native_assertions(n int);
insert into promo_native_assertions values (0);
grant select, update on promo_native_assertions to authenticated;
create function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
 if cond is distinct from true then raise exception 'Assertion failed: %', msg; end if;
 update pg_temp.promo_native_assertions set n=n+1;
end $$;
create function pg_temp.rejects(stmt text, needle text, msg text) returns void language plpgsql as $$
declare hit boolean := false;
begin
  begin execute stmt; exception when others then
    hit := needle is null or position(needle in sqlerrm) > 0;
    if not hit then raise exception 'Wrong rejection for %: %', msg, sqlerrm; end if;
  end;
  if not hit then raise exception 'Expected rejection: %', msg; end if;
  update pg_temp.promo_native_assertions set n=n+1;
end $$;
grant execute on function pg_temp.ok(boolean, text) to authenticated;
grant execute on function pg_temp.rejects(text, text, text) to authenticated;

-- Tanggal acuan = tanggal Asia/Jakarta, sama dengan yang dipakai fungsinya.
create function pg_temp.wib() returns date language sql stable as $$select (now() at time zone 'Asia/Jakarta')::date$$;
grant execute on function pg_temp.wib() to authenticated;

insert into auth.users (id, raw_user_meta_data) values
  ('ec000000-0000-4000-8000-000000000001', '{"full_name":"Owner Kadaluarsa"}'),
  ('ec000000-0000-4000-8000-000000000002', '{"full_name":"Kasir Kadaluarsa"}'),
  ('ec000000-0000-4000-8000-000000000003', '{"full_name":"Doctor Kadaluarsa"}'),
  ('ec000000-0000-4000-8000-000000000004', '{"full_name":"Admin Kadaluarsa"}');
update public.profiles set role = 'DOCTOR', is_active = true where id = 'ec000000-0000-4000-8000-000000000003';
update public.profiles set role = 'ADMIN', is_active = true where id = 'ec000000-0000-4000-8000-000000000004';
update public.profiles set role = 'OWNER', is_active = true where id = 'ec000000-0000-4000-8000-000000000001';
update public.profiles set role = 'STAFF', is_active = true where id = 'ec000000-0000-4000-8000-000000000002';
insert into public.branches (id, code, name, type)
  values ('ec100000-0000-4000-8000-000000000001', 'ECP', 'Petshop Kadaluarsa', 'PETSHOP');
insert into public.user_branches (user_id, branch_id)
  values ('ec000000-0000-4000-8000-000000000002', 'ec100000-0000-4000-8000-000000000001');

-- Baris "aktif tapi sudah lewat tanggal" adalah keadaan warisan yang justru mau
-- dibereskan; pagar baru menolak menuliskannya, jadi fixture-nya dipasang
-- dengan trigger dimatikan sebentar — persis seperti data lama di Production.
set local session_replication_role = replica;
insert into public.promos (id, name, promo_type, is_active, auto_apply, discount_type, discount_value, valid_until) values
  ('ec200000-0000-4000-8000-000000000001', 'Lewat tanggal, masih hijau', 'diskon_produk', true,  true,  'percent', 10, pg_temp.wib() - 1),
  ('ec200000-0000-4000-8000-000000000002', 'Hari terakhir',              'diskon_produk', true,  true,  'percent', 10, pg_temp.wib()),
  ('ec200000-0000-4000-8000-000000000003', 'Tanpa tanggal akhir',        'diskon_produk', true,  false, 'percent', 10, null),
  ('ec200000-0000-4000-8000-000000000004', 'Lewat tanggal, sudah mati',  'diskon_produk', false, true,  'percent', 10, pg_temp.wib() - 10);
insert into public.vouchers (id, code, tipe, nilai, is_active, valid_until) values
  ('ec300000-0000-4000-8000-000000000001', 'ECEXP', 'nominal', 5000, true,  pg_temp.wib() - 1),
  ('ec300000-0000-4000-8000-000000000002', 'ECOK',  'nominal', 5000, true,  pg_temp.wib());
insert into public.campaign_codes (id, code, promo_id, voucher_id, is_active) values
  ('ec400000-0000-4000-8000-000000000001', 'ECKODEEXP',  'ec200000-0000-4000-8000-000000000001', null, true),
  ('ec400000-0000-4000-8000-000000000002', 'ECKODEOK',   'ec200000-0000-4000-8000-000000000002', null, true),
  ('ec400000-0000-4000-8000-000000000003', 'ECKODEMATI', 'ec200000-0000-4000-8000-000000000001', null, false),
  ('ec400000-0000-4000-8000-000000000004', 'ECKODEVEXP', null, 'ec300000-0000-4000-8000-000000000001', true);
set local session_replication_role = origin;

-- ── Kontrak struktural ──────────────────────────────────────────────────────
select pg_temp.ok(has_function_privilege('authenticated', 'public.nonaktifkan_promo_kadaluarsa()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.nonaktifkan_promo_kadaluarsa()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.nonaktifkan_promo_kadaluarsa()', 'EXECUTE'),
  'sweeper is callable by signed-in users only');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.guard_aktivasi_kadaluarsa()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.guard_aktivasi_kadaluarsa()', 'EXECUTE'),
  'trigger function is not callable directly');
select pg_temp.ok((select prosecdef and proconfig @> array['search_path=""']::text[]
    from pg_proc where oid = 'public.nonaktifkan_promo_kadaluarsa()'::regprocedure),
  'sweeper is SECURITY DEFINER with an empty search_path');
select pg_temp.ok(
  position('KADALUARSA_SWEEP' in pg_get_functiondef('public.guard_promo_configuration()'::regprocedure)) > 0
  and position('assert_promo_manager' in pg_get_functiondef('public.guard_promo_configuration()'::regprocedure)) > 0,
  'promo configuration guard was patched WITHOUT losing the OWNER/ADMIN check');
select pg_temp.ok((select count(*) from pg_extension where extname = 'pg_cron') = 0,
  'this cluster has no pg_cron, so the lazy path is the one under test');

-- ── Kasir (STAFF): boleh memicu penyapu, tidak boleh menulis master ─────────
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000002', true);

-- Trigger guard jalan sebelum WITH CHECK RLS, jadi pesannya datang dari sana.
select pg_temp.rejects($$insert into public.promos (name, promo_type, discount_type, discount_value)
  values ('Promo bikinan kasir', 'diskon_produk', 'percent', 100)$$,
  'Hanya owner/manajer aktif', 'cashier cannot create a promo');
select pg_temp.rejects($$insert into public.vouchers (code, tipe, nilai) values ('ECKASIR', 'persen', 100)$$,
  'row-level security', 'cashier cannot create a voucher');
select pg_temp.rejects($$insert into public.campaign_codes (code, promo_id)
  values ('ECKASIRKODE', 'ec200000-0000-4000-8000-000000000002')$$,
  'row-level security', 'cashier cannot create a campaign code');
update public.promos set is_active = false where id = 'ec200000-0000-4000-8000-000000000002';
select pg_temp.ok((select is_active from public.promos where id = 'ec200000-0000-4000-8000-000000000002'),
  'cashier cannot switch off a promo that is still valid');
update public.promos set is_active = true where id = 'ec200000-0000-4000-8000-000000000004';
select pg_temp.ok(not (select is_active from public.promos where id = 'ec200000-0000-4000-8000-000000000004'),
  'cashier cannot switch a promo back on');
update public.promos set name = 'Dirampas kasir' where id = 'ec200000-0000-4000-8000-000000000001';
select pg_temp.ok((select name from public.promos where id = 'ec200000-0000-4000-8000-000000000001') = 'Lewat tanggal, masih hijau',
  'cashier cannot rename a promo');

-- STAFF/DOCTOR cannot elevate the persisted profile role via caller JWT metadata.
-- These are real table writes with RLS/triggers enabled, not simulated clients.
do $matrix$
declare actor uuid;
begin
 foreach actor in array array['ec000000-0000-4000-8000-000000000002'::uuid,
                             'ec000000-0000-4000-8000-000000000003'::uuid] loop
  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', actor, 'role', 'OWNER',
    'app_metadata', jsonb_build_object('role','ADMIN'))::text, true);
  perform pg_temp.rejects($q$insert into public.promos(name,promo_type,discount_type,discount_value)
    values('Spoof master','diskon_produk','percent',99)$q$, 'Hanya owner/manajer aktif', 'spoofed role cannot insert promo');
  perform pg_temp.rejects($q$insert into public.vouchers(code,tipe,nilai)
    values('ECSPOOF','nominal',99)$q$, 'row-level security', 'spoofed role cannot insert voucher');
  perform pg_temp.rejects($q$insert into public.campaign_codes(code,promo_id)
    values('ECSPOOF','ec200000-0000-4000-8000-000000000002')$q$, 'row-level security', 'spoofed role cannot insert campaign');
  update public.promos set name='Spoof', is_active=false where id='ec200000-0000-4000-8000-000000000002';
  perform pg_temp.ok((select name='Hari terakhir' and is_active from public.promos
    where id='ec200000-0000-4000-8000-000000000002'), 'spoofed role cannot change valid promo');
  update public.vouchers set nilai=99999, is_active=false where id='ec300000-0000-4000-8000-000000000002';
  perform pg_temp.ok((select nilai=5000 and is_active from public.vouchers
    where id='ec300000-0000-4000-8000-000000000002'), 'spoofed role cannot change valid voucher');
  update public.campaign_codes set code='SPOOF', is_active=false where id='ec400000-0000-4000-8000-000000000002';
  perform pg_temp.ok((select code='ECKODEOK' and is_active from public.campaign_codes
    where id='ec400000-0000-4000-8000-000000000002'), 'spoofed role cannot change valid campaign');
  delete from public.promos where id='ec200000-0000-4000-8000-000000000002';
  perform pg_temp.ok(exists(select from public.promos where id='ec200000-0000-4000-8000-000000000002'), 'spoofed role cannot delete promo');
  delete from public.vouchers where id='ec300000-0000-4000-8000-000000000002';
  perform pg_temp.ok(exists(select from public.vouchers where id='ec300000-0000-4000-8000-000000000002'), 'spoofed role cannot delete voucher');
  delete from public.campaign_codes where id='ec400000-0000-4000-8000-000000000002';
  perform pg_temp.ok(exists(select from public.campaign_codes where id='ec400000-0000-4000-8000-000000000002'), 'spoofed role cannot delete campaign');
 end loop;
end $matrix$;
select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000002', true);

-- Penyapu: satu panggilan, hanya yang benar-benar lewat tanggal yang mati.
select pg_temp.ok(
  (select public.nonaktifkan_promo_kadaluarsa()) = jsonb_build_object('tanggal', pg_temp.wib(), 'promo', 1, 'voucher', 1, 'kode', 2),
  'cashier may run the sweeper; it reports 1 promo, 1 voucher, 2 campaign codes');
select pg_temp.ok(not (select is_active from public.promos where id = 'ec200000-0000-4000-8000-000000000001'), 'expired promo is off');
select pg_temp.ok((select is_active from public.promos where id = 'ec200000-0000-4000-8000-000000000002'), 'last valid day stays on');
select pg_temp.ok((select is_active from public.promos where id = 'ec200000-0000-4000-8000-000000000003'), 'promo without an end date stays on');
select pg_temp.ok(not (select is_active from public.vouchers where id = 'ec300000-0000-4000-8000-000000000001'), 'expired voucher is off');
select pg_temp.ok((select is_active from public.vouchers where id = 'ec300000-0000-4000-8000-000000000002'), 'voucher on its last day stays on');
select pg_temp.ok(not (select is_active from public.campaign_codes where code = 'ECKODEEXP'), 'code of an expired promo is off');
select pg_temp.ok(not (select is_active from public.campaign_codes where code = 'ECKODEVEXP'), 'code of an expired voucher is off');
select pg_temp.ok((select is_active from public.campaign_codes where code = 'ECKODEOK'), 'code of a valid promo stays on');
select pg_temp.ok(not (select is_active from public.campaign_codes where code = 'ECKODEMATI'), 'manually disabled code is left alone');
select pg_temp.ok((select name from public.promos where id = 'ec200000-0000-4000-8000-000000000001') = 'Lewat tanggal, masih hijau',
  'the sweeper changed nothing but is_active');

-- Idempoten: panggilan kedua tidak mengerjakan apa pun.
select pg_temp.ok(
  (select public.nonaktifkan_promo_kadaluarsa()) = jsonb_build_object('tanggal', pg_temp.wib(), 'promo', 0, 'voucher', 0, 'kode', 0),
  'second sweep is a no-op');

-- Jejak audit atas nama sistem, bukan atas nama kasir yang kebetulan membuka layar.
-- Dibaca sebagai pemilik database supaya yang diuji isinya, bukan RLS activity_log.
reset role;
select pg_temp.ok((select actor_id is null and actor_kind = 'system' and actor_name = 'Sistem / database'
    and 'is_active' = any(changed_fields)
  from public.activity_log where row_entity = 'promos' and row_id = 'ec200000-0000-4000-8000-000000000001' and action = 'update'
  order by id desc limit 1),
  'sweep is audited as a system change, not as the cashier');
select pg_temp.ok((select count(*) from public.activity_log
    where row_entity in ('promos','vouchers') and actor_id = 'ec000000-0000-4000-8000-000000000002') = 0,
  'no sweep row is attributed to the cashier');
set local role authenticated;

-- ── Pemilik (OWNER): perpanjang dulu, baru boleh dihidupkan ─────────────────
select set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000001', true);
select pg_temp.rejects($$update public.promos set is_active = true where id = 'ec200000-0000-4000-8000-000000000001'$$,
  'KADALUARSA', 'owner cannot switch an expired promo back on');
select pg_temp.rejects($$update public.vouchers set is_active = true where id = 'ec300000-0000-4000-8000-000000000001'$$,
  'KADALUARSA', 'owner cannot switch an expired voucher back on');
select pg_temp.rejects($$insert into public.promos (name, promo_type, discount_type, discount_value, valid_until)
  values ('Lahir sudah mati', 'diskon_produk', 'percent', 10, (now() at time zone 'Asia/Jakarta')::date - 1)$$,
  'KADALUARSA', 'a new promo cannot start out already expired');
select pg_temp.rejects($$insert into public.vouchers (code, tipe, nilai, valid_until)
  values ('ECLAHIRMATI', 'nominal', 1000, (now() at time zone 'Asia/Jakarta')::date - 1)$$,
  'KADALUARSA', 'a new voucher cannot start out already expired');

update public.promos set valid_until = pg_temp.wib() + 7 where id = 'ec200000-0000-4000-8000-000000000001';
update public.promos set is_active = true where id = 'ec200000-0000-4000-8000-000000000001';
select pg_temp.ok((select is_active from public.promos where id = 'ec200000-0000-4000-8000-000000000001'),
  'extending the end date first makes reactivation work');
update public.vouchers set valid_until = pg_temp.wib() + 7, is_active = true where id = 'ec300000-0000-4000-8000-000000000001';
select pg_temp.ok((select is_active from public.vouchers where id = 'ec300000-0000-4000-8000-000000000001'),
  'same for a voucher, in one statement');

-- Tanggal akhir digeser ke masa lalu pada baris yang sedang aktif: mati di tempat.
update public.promos set valid_until = pg_temp.wib() - 1 where id = 'ec200000-0000-4000-8000-000000000001';
select pg_temp.ok(not (select is_active from public.promos where id = 'ec200000-0000-4000-8000-000000000001'),
  'moving the end date into the past switches an active promo off in the same statement');
update public.vouchers set valid_until = pg_temp.wib() - 1 where id = 'ec300000-0000-4000-8000-000000000001';
select pg_temp.ok(not (select is_active from public.vouchers where id = 'ec300000-0000-4000-8000-000000000001'),
  'same for a voucher');

-- Jalur normal pemilik tidak berubah.
update public.promos set is_active = false where id = 'ec200000-0000-4000-8000-000000000003';
select pg_temp.ok(not (select is_active from public.promos where id = 'ec200000-0000-4000-8000-000000000003'),
  'owner can still switch a non-expired promo off');
update public.promos set is_active = true, name = 'Tanpa tanggal akhir' where id = 'ec200000-0000-4000-8000-000000000003';
select pg_temp.ok((select is_active from public.promos where id = 'ec200000-0000-4000-8000-000000000003'),
  'owner can still switch it back on');

-- ADMIN retains valid-master write access; no role or grant is broadened.
select set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000004', true);
update public.promos set name='Admin valid promo' where id='ec200000-0000-4000-8000-000000000002';
select pg_temp.ok((select name='Admin valid promo' from public.promos where id='ec200000-0000-4000-8000-000000000002'), 'ADMIN can edit valid promo');
update public.vouchers set nilai=6000 where id='ec300000-0000-4000-8000-000000000002';
select pg_temp.ok((select nilai=6000 from public.vouchers where id='ec300000-0000-4000-8000-000000000002'), 'ADMIN can edit valid voucher');
update public.campaign_codes set note='Admin valid campaign' where id='ec400000-0000-4000-8000-000000000002';
select pg_temp.ok((select note='Admin valid campaign' from public.campaign_codes where id='ec400000-0000-4000-8000-000000000002'), 'ADMIN can edit valid campaign');

-- ── Pagar trigger berdiri sendiri, bukan hanya RLS ─────────────────────────
-- RLS dimatikan sebentar supaya yang diuji benar-benar cabang baru di dalam
-- guard_promo_configuration: kasir tetap harus ditolak untuk APA PUN selain
-- menonaktifkan baris yang memang sudah lewat tanggal. SQL-text saja tidak
-- membuktikan ini; yang di bawah benar-benar dieksekusi sebagai `authenticated`.
reset role;
-- Constraint trigger paket promo bersifat deferred; dituntaskan dulu supaya
-- ALTER TABLE di bawah tidak menabrak "pending trigger events".
set constraints all immediate;
alter table public.promos disable row level security;
set local session_replication_role = replica;
insert into public.promos (id, name, promo_type, is_active, auto_apply, discount_type, discount_value, valid_until)
  values ('ec200000-0000-4000-8000-000000000005', 'Warisan lewat tanggal', 'diskon_produk', true, true, 'percent', 10, pg_temp.wib() - 3);
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ec000000-0000-4000-8000-000000000002', true);
select pg_temp.rejects($$update public.promos set name = 'Tanpa RLS pun tidak boleh' where id = 'ec200000-0000-4000-8000-000000000002'$$,
  'Hanya owner/manajer aktif', 'without RLS the trigger still refuses a cashier rename');
select pg_temp.rejects($$update public.promos set is_active = false where id = 'ec200000-0000-4000-8000-000000000002'$$,
  'Hanya owner/manajer aktif', 'without RLS the trigger still refuses switching off a promo that is still valid');
select pg_temp.rejects($$update public.promos set is_active = true where id = 'ec200000-0000-4000-8000-000000000004'$$,
  'Hanya owner/manajer aktif', 'without RLS the trigger still refuses switching a promo on');
select pg_temp.rejects($$update public.promos set is_active = false, discount_value = 99 where id = 'ec200000-0000-4000-8000-000000000005'$$,
  'Hanya owner/manajer aktif', 'the expiry branch does not cover a second column changed in the same statement');
-- Satu-satunya yang lolos: mematikan baris yang memang sudah lewat tanggal.
update public.promos set is_active = false where id = 'ec200000-0000-4000-8000-000000000005';
select pg_temp.ok(not (select is_active from public.promos where id = 'ec200000-0000-4000-8000-000000000005'),
  'the expiry branch allows exactly one thing: switching off a row that is genuinely past its end date');
reset role;
set constraints all immediate;
alter table public.promos enable row level security;

select 'PROMO_NATIVE_ASSERTIONS=' || n from pg_temp.promo_native_assertions;
select 'Promo kadaluarsa: passed';
rollback;
