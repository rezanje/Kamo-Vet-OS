-- Peran "Admin Online" (ADMIN_ONLINE), Andri 17-18 Nov 2026: akun yang HANYA boleh memasukkan penjualan marketplace
-- (Impor pesanan Shopee). Berkas 2 dari 2 (nilai enum ada di 20261130100000_admin_online_enum.sql dan harus sudah ter-commit).
--
-- Pertahanan berlapis di DATABASE (aplikasi punya pagar sendiri: middleware, layout, server action):
--  1. PAGAR BACA  : kebijakan RESTRICTIVE `admin_online_fence_r` di setiap tabel public -> ADMIN_ONLINE tidak bisa SELECT apa pun kecuali
--                   2 tabel sesi yang sudah hanya-baris-sendiri (profiles, user_branches).
--  2. PAGAR TULIS : pemicu STATEMENT di setiap tabel -> ADMIN_ONLINE tidak bisa menulis APA PUN (juga lewat fungsi SECURITY DEFINER yang
--                   dipanggilnya langsung), kecuali di transaksi yang punya izin dari `admin_online_private.online_gate` (hanya dipanggil
--                   post_online_order).
--  3. PINTU MASUK : `post_online_order` -> satu-satunya jalur tulis; gerbang khusus peran ini (cabang, gudang ONLINE/RETAIL, channel marketplace,
--                   tanpa pelanggan, nomor pesanan wajib & tidak ganda). Peran lain: panggilan `unit_posting_access` yang lama, persis.
--  4. BACA TERBATAS: admin_online_import_gudang / _catalog / _existing (cabang+gudang akun, barang, satuan, stok satu gudang, isi paket, status "sudah diimpor"),
--                   tanpa HPP/harga beli/margin/pelanggan.
--  5. Daftar peran akun (preflight/configure/edit/get_for_edit) menerima ADMIN_ONLINE dengan penugasan cabang wajib.
-- Tidak disentuh: HPP/COST_MISSING/P03, aturan diskon manual, jurnal, stok, peran lama. Aditif; rollback: lihat ROLLBACK.sql di bukti.
set local lock_timeout = '3s';

create schema if not exists admin_online_private;
revoke all on schema admin_online_private from public, anon, authenticated, service_role;
grant usage on schema admin_online_private to authenticated;

create table if not exists admin_online_private.permits (
  xid text not null, actor uuid not null, created_at timestamptz not null default now(), primary key (xid, actor));
alter table admin_online_private.permits enable row level security;
revoke all on admin_online_private.permits from public, anon, authenticated, service_role;

-- Penanda peran (dipakai kebijakan RLS; SECURITY DEFINER agar tidak bergantung RLS profiles). Nonaktif tetap terpagar (gagal tertutup).
create or replace function admin_online_private.is_admin_online() returns boolean
language sql stable security definer set search_path = '' as $f$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'ADMIN_ONLINE');
$f$;

-- Pagar tulis. Pemicu statement: nilai kembalian diabaikan; menolak dengan exception.
create or replace function admin_online_private.write_fence() returns trigger
language plpgsql security definer set search_path = '' as $f$
declare v uuid := auth.uid();
begin
  if v is null then return null; end if;                                   -- jalur sistem (cron/DBA), bukan sesi pengguna
  if not exists (select 1 from public.profiles where id = v and role = 'ADMIN_ONLINE') then return null; end if;
  if exists (select 1 from admin_online_private.permits where xid = pg_current_xact_id()::text and actor = v) then return null; end if;
  raise exception 'ADMIN_ONLINE_WRITE_DENIED: peran Admin Online hanya boleh menyimpan impor penjualan marketplace (% pada %.%)', tg_op, tg_table_schema, tg_table_name
    using errcode = '42501';
end $f$;

-- Gerbang post_online_order. Peran lain: pemeriksaan LAMA persis. ADMIN_ONLINE: pemeriksaan sempit + izin tulis per transaksi.
create or replace function admin_online_private.online_gate(p_wh uuid, p_branch uuid, p_header jsonb, p_items jsonb) returns void
language plpgsql security definer set search_path = '' as $f$
declare v_ref text; v_ch text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_active and role = 'ADMIN_ONLINE') then
    perform public.unit_posting_access('online', p_branch);
    return;
  end if;
  if auth.role() is distinct from 'authenticated' or not public.user_can_access_branch(p_branch) then
    raise exception 'ADMIN_ONLINE_GATE_BRANCH: cabang tidak ada dalam penugasan akun ini' using errcode = '42501'; end if;
  if not exists (select 1 from public.warehouses where id = p_wh and is_active and type in ('ONLINE', 'RETAIL')) then
    raise exception 'ADMIN_ONLINE_GATE_WAREHOUSE: gudang harus gudang Online atau Toko/Petshop yang aktif' using errcode = '42501'; end if;
  if jsonb_typeof(p_header) is distinct from 'object' or exists (select 1 from jsonb_object_keys(p_header) k
     where k not in ('channel', 'warehouse_id', 'buyer_name', 'external_ref', 'customer_id', 'tanggal')) then
    raise exception 'ADMIN_ONLINE_GATE_HEADER: kolom header tidak dikenal' using errcode = '42501'; end if;
  v_ch := p_header ->> 'channel';
  if v_ch is null or v_ch not in ('Shopee', 'Tokopedia', 'TikTok Shop') then
    raise exception 'ADMIN_ONLINE_GATE_CHANNEL: Admin Online hanya untuk channel Shopee, Tokopedia, atau TikTok Shop' using errcode = '42501'; end if;
  if nullif(p_header ->> 'customer_id', '') is not null then
    raise exception 'ADMIN_ONLINE_GATE_CUSTOMER: peran ini tidak bisa menautkan pelanggan' using errcode = '42501'; end if;
  v_ref := nullif(p_header ->> 'external_ref', '');
  if v_ref is null or v_ref !~ '^[A-Za-z0-9._-]{4,40}$' then
    raise exception 'ADMIN_ONLINE_GATE_REF: nomor pesanan marketplace wajib (4-40 huruf/angka)' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 or exists (
     select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e) <> 'object' or exists (
       select 1 from jsonb_object_keys(e) k where k not in ('item_id', 'qty', 'harga', 'satuan'))) then
    raise exception 'ADMIN_ONLINE_GATE_ITEMS: 1-100 baris barang dengan kolom item_id, qty, harga, satuan saja' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('vetos:admin-online-ref:' || v_ch || ':' || v_ref)::bigint);
  if exists (select 1 from public.sales where channel = v_ch and external_ref = v_ref and voided_at is null) then
    raise exception 'ADMIN_ONLINE_GATE_DUPLIKAT: pesanan % sudah tercatat', v_ref using errcode = '42501'; end if;
  delete from admin_online_private.permits where created_at < now() - interval '2 days';
  insert into admin_online_private.permits (xid, actor) values (pg_current_xact_id()::text, auth.uid()) on conflict do nothing;
end $f$;

-- Penjaga untuk fungsi SECURITY DEFINER lama yang membaca data tanpa gerbang peran (hanya dicek cabang/akun aktif): ADMIN_ONLINE ditolak
-- kecuali di dalam transaksi bergerbang (post_online_order). Peran lain: tidak berbuat apa-apa (mengembalikan true).
create or replace function admin_online_private.deny_admin_online() returns boolean
language plpgsql stable security definer set search_path = '' as $f$
begin
  if exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'ADMIN_ONLINE')
     and not exists (select 1 from admin_online_private.permits where xid = pg_current_xact_id()::text and actor = (select auth.uid())) then
    raise exception 'ADMIN_ONLINE_FUNCTION_DENIED: fungsi ini tidak tersedia untuk peran Admin Online' using errcode = '42501';
  end if;
  return true;
end $f$;

revoke all on all functions in schema admin_online_private from public, anon, authenticated, service_role;
grant execute on function admin_online_private.is_admin_online() to authenticated;

-- Baca terbatas untuk layar impor (hanya ADMIN_ONLINE aktif; gudang harus ONLINE/RETAIL dan dalam cabang akun).
create or replace function public.admin_online_import_catalog(p_warehouse uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $f$
declare w public.warehouses;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and is_active and role = 'ADMIN_ONLINE') then
    raise exception 'ADMIN_ONLINE_ONLY: hanya untuk peran Admin Online' using errcode = '42501'; end if;
  select * into w from public.warehouses where id = p_warehouse and is_active and type in ('ONLINE', 'RETAIL');
  if not found or not public.user_can_access_branch(w.branch_id) then
    raise exception 'ADMIN_ONLINE_GATE_WAREHOUSE: gudang tidak dapat dipakai akun ini' using errcode = '42501'; end if;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'code', i.code, 'name', i.name, 'unit', i.unit, 'sell_price', i.sell_price,
        'item_type', i.item_type) order by i.name, i.id), '[]'::jsonb)
      from public.items i where i.is_active and coalesce(i.item_type, 'Persediaan') in ('Persediaan', 'Grup')),
    'stock', (select coalesce(jsonb_agg(jsonb_build_object('item_id', s.item_id, 'qty', s.qty)), '[]'::jsonb)
      from public.stock s where s.warehouse_id = w.id),
    'units', (select coalesce(jsonb_agg(jsonb_build_object('item_id', u.item_id, 'unit', u.unit, 'factor', u.factor, 'sell_price', u.sell_price) order by u.factor, u.item_id, u.unit), '[]'::jsonb)
      from public.item_units u join public.items i on i.id = u.item_id and i.is_active),
    'group_components', (select coalesce(jsonb_agg(jsonb_build_object('group_item_id', g.group_item_id, 'component_item_id', g.component_item_id,
        'qty', g.qty, 'unit', g.unit, 'factor', g.factor, 'code', c.code, 'name', c.name, 'item_type', c.item_type, 'is_active', c.is_active)
        order by g.sort_order, g.id), '[]'::jsonb)
      from public.item_group_components g join public.items gi on gi.id = g.group_item_id and gi.is_active and gi.item_type = 'Grup'
      left join public.items c on c.id = g.component_item_id));
end $f$;

-- Cabang + gudang yang boleh dipakai akun ini (ONLINE/RETAIL aktif, cabang aktif dalam penugasan akun). Bentuk = GudangOnline di aplikasi.
create or replace function public.admin_online_import_gudang() returns jsonb
language plpgsql stable security definer set search_path = '' as $f$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and is_active and role = 'ADMIN_ONLINE') then
    raise exception 'ADMIN_ONLINE_ONLY: hanya untuk peran Admin Online' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'branch_id', w.branch_id, 'type', w.type::text, 'branch_name', b.name)
      order by b.name, w.name, w.id), '[]'::jsonb)
    from public.warehouses w join public.branches b on b.id = w.branch_id
    where w.is_active and b.is_active and w.type in ('ONLINE', 'RETAIL') and public.user_can_access_branch(w.branch_id));
end $f$;

create or replace function public.admin_online_import_existing(p_refs text[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $f$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and is_active and role = 'ADMIN_ONLINE') then
    raise exception 'ADMIN_ONLINE_ONLY: hanya untuk peran Admin Online' using errcode = '42501'; end if;
  if p_refs is null or cardinality(p_refs) > 500 then raise exception 'ADMIN_ONLINE_GATE_REF: maksimal 500 nomor pesanan' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('external_ref', s.external_ref, 'no_struk', s.no_struk, 'voided', s.voided_at is not null)), '[]'::jsonb)
    from public.sales s where s.channel = 'Shopee' and s.external_ref = any (p_refs));
end $f$;

revoke all on function public.admin_online_import_gudang() from public, anon;
revoke all on function public.admin_online_import_catalog(uuid) from public, anon;
revoke all on function public.admin_online_import_existing(text[]) from public, anon;
grant execute on function public.admin_online_import_gudang() to authenticated;
grant execute on function public.admin_online_import_catalog(uuid) to authenticated;
grant execute on function public.admin_online_import_existing(text[]) to authenticated;

-- Tambalan berjangkar (jumlah kemunculan harus tepat 1; selain itu gagal tertutup dan seluruh migrasi batal).
create or replace function pg_temp.admin_online_patch(p_sig text, p_from text[], p_to text[]) returns void language plpgsql as $f$
declare v text; i int; n int;
begin
  v := pg_get_functiondef(p_sig::regprocedure);
  for i in 1 .. cardinality(p_from) loop
    n := (length(v) - length(replace(v, p_from[i], ''))) / length(p_from[i]);
    if n <> 1 then raise exception 'ADMIN_ONLINE_PATCH_ANCHOR: % jangkar % muncul % kali (harus 1)', p_sig, i, n; end if;
    v := replace(v, p_from[i], p_to[i]);
  end loop;
  execute v;
end $f$;

select pg_temp.admin_online_patch('public.post_online_order(text,jsonb,jsonb)',
  array['perform public.unit_posting_access(''online'',wh.branch_id);'],
  array['perform admin_online_private.online_gate(wh.id,wh.branch_id,p_header,p_items);']);
select pg_temp.admin_online_patch('public.preflight_employee_account(uuid,text,uuid[])',
  array['p_role not in(''OWNER'',''ADMIN'',''FINANCE'',''DOCTOR'',''STAFF'')', '(p_role in(''DOCTOR'',''STAFF'') and cardinality(p_branch_ids)=0)'],
  array['p_role not in(''OWNER'',''ADMIN'',''FINANCE'',''DOCTOR'',''STAFF'',''ADMIN_ONLINE'')', '(p_role in(''DOCTOR'',''STAFF'',''ADMIN_ONLINE'') and cardinality(p_branch_ids)=0)']);
select pg_temp.admin_online_patch('public.configure_employee_account(uuid,uuid,text,text,uuid[])',
  array['p_role not in (''OWNER'',''ADMIN'',''FINANCE'',''STAFF'',''DOCTOR'')', '(p_role in (''STAFF'',''DOCTOR'') and cardinality(p_branch_ids)=0)'],
  array['p_role not in (''OWNER'',''ADMIN'',''FINANCE'',''STAFF'',''DOCTOR'',''ADMIN_ONLINE'')', '(p_role in (''STAFF'',''DOCTOR'',''ADMIN_ONLINE'') and cardinality(p_branch_ids)=0)']);
select pg_temp.admin_online_patch('public.edit_user_account(uuid,text,text,uuid[],text,uuid)',
  array['p_role not in(''OWNER'',''ADMIN'',''FINANCE'',''DOCTOR'',''STAFF'')', 'if p_role in(''STAFF'',''DOCTOR'') and cardinality(new_ids)=0'],
  array['p_role not in(''OWNER'',''ADMIN'',''FINANCE'',''DOCTOR'',''STAFF'',''ADMIN_ONLINE'')', 'if p_role in(''STAFF'',''DOCTOR'',''ADMIN_ONLINE'') and cardinality(new_ids)=0']);
select pg_temp.admin_online_patch('public.get_user_account_for_edit(uuid)',
  array['array[''OWNER'',''ADMIN'',''FINANCE'',''DOCTOR'',''STAFF'']'],
  array['array[''OWNER'',''ADMIN'',''FINANCE'',''DOCTOR'',''STAFF'',''ADMIN_ONLINE'']']);

-- PENJAGA FUNGSI SECURITY DEFINER (deny-by-default). Fungsi DEFINER berjalan sebagai pemilik dan melewati RLS, dan banyak yang hanya memeriksa
-- "akun aktif + cabang" (bukan peran) — peran baru yang tak ada di daftar lama bisa lolos. Maka SETIAP fungsi public SECURITY DEFINER bahasa plpgsql
-- yang dapat dieksekusi `authenticated` diberi satu baris di awal badan: `perform admin_online_private.deny_admin_online();` (menolak ADMIN_ONLINE
-- kecuali di transaksi bergerbang post_online_order; untuk peran lain mengembalikan true tanpa efek). Dikecualikan: post_online_order (gerbangnya
-- sendiri), fungsi yang dipakai kebijakan RLS (harus tetap bisa dievaluasi), dan yang sudah punya penjaga. Gagal tertutup bila posisi sisip meragukan.
-- Dibungkus fungsi admin_online_private.guard_all() (hanya pemilik) agar bisa dijalankan ulang sesudah migrasi lain menambah fungsi DEFINER.
create or replace function admin_online_private.guard_all() returns integer
language plpgsql as $guard$
declare f record; v text; v_pos int; v_body text; v_prefix text; v_last text; v_n int := 0;
begin
  for f in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and l.lanname = 'plpgsql' and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not exists (select 1 from pg_depend e where e.classid = 'pg_proc'::regclass and e.objid = p.oid and e.deptype = 'e')   -- fungsi milik ekstensi: bukan kode kita
      and p.proname <> 'post_online_order' and p.proname not like 'admin\_online\_%'
      and p.prosrc !~ 'admin_online_private\.deny_admin_online'
      and not exists (select 1 from pg_depend d join pg_policy pol on d.classid = 'pg_policy'::regclass and d.objid = pol.oid
                      where d.refclassid = 'pg_proc'::regclass and d.refobjid = p.oid)
    order by p.oid::regprocedure::text
  loop
    v := pg_get_functiondef(f.oid);
    v_pos := strpos(v, 'AS $function$');
    if v_pos = 0 then raise exception 'ADMIN_ONLINE_GUARD_ANCHOR: % tanpa pembatas dolar', f.sig; end if;
    v_body := substr(v, v_pos + 13);
    v_prefix := (regexp_match(v_body, '^(.*?)\mbegin\M', 'is'))[1];   -- teks sebelum kemunculan pertama kata begin (kata utuh)
    if v_prefix is null then raise exception 'ADMIN_ONLINE_GUARD_ANCHOR: % tanpa kata begin', f.sig; end if;
    v_last := substr(v_prefix, length(v_prefix) - strpos(reverse(v_prefix), E'\n') + 2);
    if v_last like '%--%' or (length(v_prefix) - length(replace(v_prefix, '''', ''))) % 2 = 1
       or (length(v_prefix) - length(replace(v_prefix, '/*', ''))) <> (length(v_prefix) - length(replace(v_prefix, '*/', ''))) then
      raise exception 'ADMIN_ONLINE_GUARD_ANCHOR: % kata begin pertama berada dalam komentar/string', f.sig; end if;
    execute substr(v, 1, v_pos + 12) || regexp_replace(v_body, '\mbegin\M', E'begin\n  perform admin_online_private.deny_admin_online();', 'i');
    if (select p.prosrc from pg_proc p where p.oid = f.oid) !~ 'admin_online_private\.deny_admin_online' then
      raise exception 'ADMIN_ONLINE_GUARD_ANCHOR: % penjaga tidak terpasang', f.sig; end if;
    v_n := v_n + 1;
  end loop;
  raise notice 'admin_online: % fungsi SECURITY DEFINER diberi penjaga', v_n;
  return v_n;
end $guard$;
revoke all on function admin_online_private.guard_all() from public, anon, authenticated, service_role;
-- Dapat dijalankan ulang (idempotent) oleh pemilik: migrasi sesudah ini yang menambah fungsi SECURITY DEFINER baru memanggil `select admin_online_private.guard_all();` di akhirnya.
select admin_online_private.guard_all();

-- Fungsi DEFINER berbahasa sql (tidak bisa diberi perform): dibungkus case. Pemeriksaan jangkar: harus tepat 1 kemunculan.
select pg_temp.admin_online_patch('public.preview_clinic_refund_source(uuid)',
  array['select public.clinic_refund_source_core(p_invoice)-''internal_snapshot'''],
  array['select case when admin_online_private.deny_admin_online() then public.clinic_refund_source_core(p_invoice)-''internal_snapshot'' end']);
select pg_temp.admin_online_patch('public.clinic_quote_inpatient_payment(uuid,uuid,jsonb)',
  array['select clinic_private.inpatient_payment_quote(p_record_id,p_visit_id,p_parts)-''lines''-''shift_id'''],
  array['select case when admin_online_private.deny_admin_online() then clinic_private.inpatient_payment_quote(p_record_id,p_visit_id,p_parts)-''lines''-''shift_id'' end']);

-- Pagar baca + tulis di semua tabel. Pemilik tabel harus sama dengan penjalan migrasi (jika tidak: gagal tertutup, bukan dilewati).
do $fence$
declare t record; v_skip text[] := array['profiles','user_branches'];
begin
  for t in
    select c.oid, n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner) owner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'auth', 'storage', 'extensions', 'graphql',
      'graphql_public', 'vault', 'realtime', 'supabase_functions', 'supabase_migrations', 'cron', 'net', 'pgsodium', 'pgsodium_masks', 'pgbouncer',
      '_realtime', '_analytics', 'admin_online_private', 'kamo_import')  -- kamo_import: tabel milik peran impor terpisah, tanpa hak untuk authenticated (diuji)
    order by n.nspname, c.relname
  loop
    if t.owner <> current_user then raise exception 'ADMIN_ONLINE_FENCE_OWNER: %.% dimiliki % (bukan %)', t.nspname, t.relname, t.owner, current_user; end if;
    execute format('drop trigger if exists zz_admin_online_write_fence on %I.%I', t.nspname, t.relname);
    execute format('create trigger zz_admin_online_write_fence before insert or update or delete or truncate on %I.%I for each statement execute function admin_online_private.write_fence()', t.nspname, t.relname);
    if t.nspname = 'public' and not (t.relname = any (v_skip)) then
      execute format('drop policy if exists admin_online_fence_r on %I.%I', t.nspname, t.relname);
      execute format('create policy admin_online_fence_r on %I.%I as restrictive for select to authenticated using (not (select admin_online_private.is_admin_online()))', t.nspname, t.relname);
    end if;
  end loop;
end $fence$;

-- Berkas unggahan (storage): pagar RESTRICTIVE agar ADMIN_ONLINE tidak bisa mengunggah/membaca lewat API Storage.
do $stor$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists admin_online_fence_storage on storage.objects';
    execute 'create policy admin_online_fence_storage on storage.objects as restrictive for all to authenticated using (not (select admin_online_private.is_admin_online())) with check (not (select admin_online_private.is_admin_online()))';
  end if;
end $stor$;

-- Penanda role_modules: peran ini TIDAK punya modul apa pun yang dikenal. Banyak gerbang lama memperlakukan "peran tanpa baris role_modules" sebagai
-- "semua modul" (seperti ADMIN/DOCTOR bawaan) dan gerbang modul lain menolak peran yang punya baris tetapi tanpa modul itu. Satu baris dengan id yang
-- tidak dikenal modul mana pun membuat semua gerbang jenis kedua menolak, tanpa memberi akses ke apa pun. Penjaga Akses Grup (role_settings_atomic_guard)
-- hanya dimatikan untuk insert ini di dalam transaksi migrasi yang sama dan DINYALAKAN LAGI (dicek di bawah). Simpan Akses Grup menolak peran ini.
alter table public.role_modules disable trigger role_settings_atomic_guard;
insert into public.role_modules (role, module_id) values ('ADMIN_ONLINE', 'admin-online-only') on conflict do nothing;
alter table public.role_modules enable trigger role_settings_atomic_guard;

-- Pemeriksaan pasang: gagal = seluruh migrasi batal.
do $check$
declare n_tbl int; n_trg int; n_pol int; n_pub int;
begin
  select count(*) into n_tbl from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and n.nspname = 'public';
  select count(*) into n_pub from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r', 'p') and n.nspname = 'public'
    and c.relname not in ('profiles','user_branches');
  select count(*) into n_trg from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where g.tgname = 'zz_admin_online_write_fence' and n.nspname = 'public';
  select count(*) into n_pol from pg_policies where policyname = 'admin_online_fence_r' and schemaname = 'public' and cmd = 'SELECT' and permissive = 'RESTRICTIVE';
  if n_trg <> n_tbl then raise exception 'ADMIN_ONLINE_CHECK: pemicu tulis % dari % tabel public', n_trg, n_tbl; end if;
  if n_pol <> n_pub then raise exception 'ADMIN_ONLINE_CHECK: kebijakan baca % dari % tabel public', n_pol, n_pub; end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity) then
    raise exception 'ADMIN_ONLINE_CHECK: ada tabel public tanpa RLS'; end if;
  if (select count(*) from pg_proc where oid = 'public.post_online_order(text,jsonb,jsonb)'::regprocedure and prosrc like '%admin_online_private.online_gate(wh.id,wh.branch_id,p_header,p_items)%'
        and prosrc not like '%perform public.unit_posting_access(''online'',wh.branch_id)%') <> 1 then
    raise exception 'ADMIN_ONLINE_CHECK: gerbang post_online_order tidak terpasang'; end if;
  if (select array_agg(module_id::text) from public.role_modules where role = 'ADMIN_ONLINE') is distinct from array['admin-online-only'] then
    raise exception 'ADMIN_ONLINE_CHECK: penanda role_modules tidak tepat'; end if;
  if (select tgenabled from pg_trigger where tgrelid = 'public.role_modules'::regclass and tgname = 'role_settings_atomic_guard') is distinct from 'O' then
    raise exception 'ADMIN_ONLINE_CHECK: penjaga Akses Grup tidak menyala'; end if;
  if has_table_privilege('authenticated', 'admin_online_private.permits', 'select,insert,update,delete')
     or has_function_privilege('authenticated', 'admin_online_private.online_gate(uuid,uuid,jsonb,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'admin_online_private.write_fence()', 'execute')
     or has_function_privilege('authenticated', 'admin_online_private.guard_all()', 'execute')
     or has_function_privilege('anon', 'admin_online_private.guard_all()', 'execute')
     or has_function_privilege('anon', 'public.admin_online_import_catalog(uuid)', 'execute') then
    raise exception 'ADMIN_ONLINE_CHECK: hak akses privat bocor'; end if;
end $check$;
