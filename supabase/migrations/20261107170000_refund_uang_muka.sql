-- "Kembalikan saldo uang muka": sisa uang muka KLINIK (UMK) dikembalikan ke pelanggan lewat TRANSFER BANK, sebagian atau seluruhnya.
-- Dua langkah, mengikuti pola antrean refund finance (J03): OWNER/FINANCE mengajukan -> FINANCE/OWNER mengambil proses ("Ambil proses")
-- -> setelah transfer dilakukan, mencatat "selesai" (tanggal, rekening bank, referensi) -> jurnal Dr 314001 / Cr rekening bank. 7 Nov 2026
-- (kasus UMK-202611-0045 Keripik Tempe, Ciomas ranap: sesudah "tarik baris" Infus Refill sisa Rp30.000 harus ditransfer kembali dari Bank BCA 120002).
--
-- KEPUTUSAN RANCANGAN (bukti: pembaca saldo uang muka ada di 8 fungsi SQL + layar tagihan berjalan; semuanya membaca amount - applied):
--  * SALDO TIDAK DIPAKAI ULANG: pengajuan MENGURANGI clinic_customer_advances.amount sebesar jumlah yang diajukan (dicadangkan) dan menaikkan
--    refund_reserved. Semua pembaca yang ada (kasir ranap, pemakaian otomatis tahap berikutnya, pelepasan, tagihan berjalan, laporan)
--    langsung melihat saldo yang benar tanpa satu pun fungsi lama diganti. Selesai: refund_reserved -> refunded_amount. Batal: amount dikembalikan.
--    Jumlah yang diterima semula selalu = amount + refunded_amount + refund_reserved (dijaga trigger; tidak bisa diubah di luar fungsi ini).
--    Saldo belum terpakai = amount - applied (sama dengan amount_awal - applied - dikembalikan - dicadangkan). Uang muka yang SELURUHNYA
--    dikembalikan boleh amount = 0 (batasan amount > 0 diganti: amount >= 0 dan amount = 0 hanya bila ada pengembalian).
--  * BATALKAN KWITANSI: uang muka yang pernah/sedang dikembalikan TIDAK bisa dibatalkan kwitansinya (jurnal pembalik kwitansi akan
--    mengembalikan uang yang sudah ditransfer = dobel). Trigger pada clinic_customer_advances menolak status -> 'batal' dengan pesan
--    ADVANCE_REFUNDED (muncul SEBELUM pemeriksaan ADVANCE_IMBALANCE milik fungsi lama; semua efek fungsi lama ikut dibatalkan).
--    Sisa uang muka dikembalikan dengan pengembalian berikutnya, bukan dengan batal kwitansi. Uang muka tanpa pengembalian: tidak berubah.
--  * SHIFT: refund TRANSFER BANK tidak memerlukan shift kasir (aturan yang sama dengan refund klinik J03: hanya Tunai butuh shift). Tunai
--    tidak ditawarkan di v1 (kas laci perlu rekonsiliasi shift tersendiri).
--  * PERAN: hanya OWNER dan FINANCE aktif (konstanta clinic_private.advance_refund_roles); cabang uang muka dicek; pemohon boleh sama dengan
--    pemroses (keputusan terbuka bila Andri ingin dua orang berbeda).
--  * TANGGAL JURNAL: tanggal transfer yang diisi Finance (boleh hari ini atau sebelumnya, tidak lebih awal dari tanggal pengajuan, tidak di
--    periode yang sudah dikunci); kosong = hari ini (WIB). Sumber jurnal 'klinik-uang-muka-refund', source_ref = nomor refund (RUM-YYYYMM-nnnn,
--    unik per refund).
--  * URUTAN KUNCI (sama dengan kasir, tarik baris, pelepasan, batal kwitansi): koordinator tagihan (billing_keys_advance) -> kunci idempotensi
--    -> baris uang muka -> baris refund -> jurnal.
--
-- Hanya objek BARU (tidak ada fungsi lama diganti; clinic_void_payment_receipt, clinic_release_advance_application, clinic_receive_visit_payment,
-- clinic_save_inpatient_cashier, clinic_write_journal, owner_remove_invoice_lines tidak tersentuh). Satu-satunya perubahan pada objek lama:
-- dua kolom baru + batasan amount pada clinic_customer_advances dan satu trigger penjaga.
-- Objek baru: clinic_private.advance_refunds (permintaan/riwayat refund), clinic_private.advance_refund_events (jejak tambah-saja), 5 RPC publik.
-- Tanpa hak aplikasi pada tabel; layar membaca lewat get_clinic_advance_refunds.
--
-- MEMBACA JEJAK (SQL editor sebagai postgres):
-- BACA_JEJAK_MULAI
--   select e.created_at, e.event, p.full_name as petugas, r.no_refund, e.amount, e.balance_before, e.balance_after, e.journal_id
--   from clinic_private.advance_refund_events e join clinic_private.advance_refunds r on r.id = e.refund_id join public.profiles p on p.id = e.actor_id order by e.created_at desc limit 100;
-- BACA_JEJAK_SELESAI
--
-- Apply as ONE transaction (tanpa begin/commit sendiri). Tidak ada backfill (kolom baru default 0).

do $guard$
begin
  if to_regclass('clinic_private.advance_refunds') is not null or to_regclass('clinic_private.advance_refund_events') is not null
     or to_regprocedure('public.clinic_advance_refund_request(uuid,numeric,text,jsonb,text)') is not null then
    raise exception 'Refund uang muka: objek sudah ada; periksa urutan migrasi';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinic_customer_advances' and column_name in ('refunded_amount', 'refund_reserved')) then
    raise exception 'Refund uang muka: kolom sudah ada; periksa urutan migrasi';
  end if;
  if to_regclass('public.clinic_customer_advances') is null or to_regclass('public.cash_accounts') is null or to_regclass('public.accounting_locks') is null
     or to_regprocedure('public.clinic_record_correction_immutable()') is null
     or to_regprocedure('clinic_private.billing_lock(text[])') is null
     or to_regprocedure('clinic_private.billing_keys_advance(uuid)') is null
     or to_regprocedure('clinic_private.kas_code(text,uuid)') is null
     or to_regprocedure('clinic_private.next_no(text,text,integer,date,regclass,text)') is null
     or to_regprocedure('public.clinic_write_journal(date,text,text,text,uuid,jsonb)') is null
     or to_regprocedure('public.user_can_access_branch(uuid)') is null then
    raise exception 'Refund uang muka: prasyarat tidak ditemukan';
  end if;
end $guard$;

-- 1. Kolom baru + batasan pada uang muka ------------------------------------------------------------------------------------------------
alter table public.clinic_customer_advances
  add column refunded_amount numeric(15,2) not null default 0 check (refunded_amount >= 0),
  add column refund_reserved numeric(15,2) not null default 0 check (refund_reserved >= 0);
alter table public.clinic_customer_advances drop constraint clinic_customer_advances_amount_check;
alter table public.clinic_customer_advances add constraint clinic_customer_advances_amount_check
  check (amount >= 0 and (amount > 0 or refunded_amount + refund_reserved > 0));

-- 2. Tabel: permintaan refund + jejak tambah-saja ----------------------------------------------------------------------------------------
create table clinic_private.advance_refunds (
  id uuid primary key default gen_random_uuid(),
  no_refund text not null unique,
  advance_id uuid not null references public.clinic_customer_advances(id),
  branch_id uuid not null references public.branches(id),
  amount numeric(15,2) not null check (amount > 0),
  reason text not null check (length(regexp_replace(btrim(reason), '\s', '', 'g')) >= 5 and length(btrim(reason)) <= 500),
  destination jsonb not null,
  request_key text not null unique check (length(request_key) between 1 and 100),
  request_hash text not null,
  status text not null check (status in ('pending', 'diproses', 'selesai', 'batal')),
  requested_by uuid not null references public.profiles(id),
  requested_at timestamptz not null default clock_timestamp(),
  processed_by uuid references public.profiles(id),
  processed_at timestamptz,
  completed_by uuid references public.profiles(id),
  completed_at timestamptz,
  tanggal date,
  cash_account_id uuid references public.cash_accounts(id),
  coa_code text,
  bank_reference text,
  journal_id uuid unique references public.journal_entries(id),
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text,
  constraint advance_refunds_state_consistent check (
    (status = 'pending' and processed_by is null and completed_by is null and journal_id is null and cancelled_by is null)
    or (status = 'diproses' and processed_by is not null and completed_by is null and journal_id is null and cancelled_by is null)
    or (status = 'selesai' and processed_by is not null and completed_by is not null and journal_id is not null and bank_reference is not null and coa_code is not null and tanggal is not null and cancelled_by is null)
    or (status = 'batal' and cancelled_by is not null and cancel_reason is not null and completed_by is null and journal_id is null))
);
create index advance_refunds_advance_idx on clinic_private.advance_refunds(advance_id, status);
create index advance_refunds_queue_idx on clinic_private.advance_refunds(status, requested_at);
alter table clinic_private.advance_refunds enable row level security;
revoke all on clinic_private.advance_refunds from public, anon, authenticated, service_role;

create table clinic_private.advance_refund_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  refund_id uuid not null references clinic_private.advance_refunds(id),
  advance_id uuid not null references public.clinic_customer_advances(id),
  event text not null check (event in ('request', 'claim', 'complete', 'cancel')),
  actor_id uuid not null references public.profiles(id),
  amount numeric(15,2) not null,
  balance_before numeric(15,2) not null,
  balance_after numeric(15,2) not null,
  refunded_total_after numeric(15,2) not null,
  reserved_after numeric(15,2) not null,
  journal_id uuid references public.journal_entries(id),
  payload jsonb not null default '{}'::jsonb
);
create index advance_refund_events_refund_idx on clinic_private.advance_refund_events(refund_id, created_at);
alter table clinic_private.advance_refund_events enable row level security;
revoke all on clinic_private.advance_refund_events from public, anon, authenticated, service_role;
create trigger advance_refund_events_immutable before update or delete on clinic_private.advance_refund_events
  for each row execute function public.clinic_record_correction_immutable();
create trigger advance_refund_events_no_truncate before truncate on clinic_private.advance_refund_events
  for each statement execute function public.clinic_record_correction_immutable();

-- izin per-transaksi: hanya fungsi refund yang boleh menggeser amount / refunded_amount / refund_reserved
create table clinic_private.advance_refund_permits (transaction_id bigint primary key);
alter table clinic_private.advance_refund_permits enable row level security;
revoke all on clinic_private.advance_refund_permits from public, anon, authenticated, service_role;

-- Penjaga baris refund: tidak dihapus, kolom permintaan tetap, status hanya maju (pending -> diproses -> selesai; pending/diproses -> batal).
create function clinic_private.advance_refund_row_guard() returns trigger language plpgsql set search_path = '' as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Pengembalian saldo uang muka tidak dapat dihapus';
  end if;
  if (to_jsonb(new) - array['status', 'processed_by', 'processed_at', 'completed_by', 'completed_at', 'tanggal', 'cash_account_id', 'coa_code', 'bank_reference', 'journal_id', 'cancelled_by', 'cancelled_at', 'cancel_reason'])
     is distinct from (to_jsonb(old) - array['status', 'processed_by', 'processed_at', 'completed_by', 'completed_at', 'tanggal', 'cash_account_id', 'coa_code', 'bank_reference', 'journal_id', 'cancelled_by', 'cancelled_at', 'cancel_reason']) then
    raise exception using errcode = '42501', message = 'Pengembalian saldo uang muka: jumlah, alasan, tujuan dan identitas permintaan tidak dapat diubah';
  end if;
  if not ((old.status = 'pending' and new.status in ('diproses', 'batal')) or (old.status = 'diproses' and new.status in ('selesai', 'batal'))) then
    raise exception using errcode = '42501', message = format('Pengembalian saldo uang muka: perubahan status %s -> %s tidak diizinkan', old.status, new.status);
  end if;
  return new;
end;
$function$;
revoke all on function clinic_private.advance_refund_row_guard() from public, anon, authenticated, service_role;
create trigger advance_refunds_guard before update or delete on clinic_private.advance_refunds
  for each row execute function clinic_private.advance_refund_row_guard();
create trigger advance_refunds_no_truncate before truncate on clinic_private.advance_refunds
  for each statement execute function public.clinic_record_correction_immutable();

-- 3. Penjaga uang muka ------------------------------------------------------------------------------------------------------------------
create function clinic_private.advance_refund_fence() returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.status = 'batal' and old.status is distinct from 'batal' and (old.refunded_amount > 0 or old.refund_reserved > 0) then
    raise exception using errcode = 'P0001',
      message = 'ADVANCE_REFUNDED: uang muka ini sudah/sedang dikembalikan ke pelanggan, kwitansinya tidak bisa dibatalkan (uang yang sudah ditransfer akan terhitung dua kali); kembalikan sisanya lewat "Kembalikan saldo uang muka"';
  end if;
  if new.amount is distinct from old.amount or new.refunded_amount is distinct from old.refunded_amount or new.refund_reserved is distinct from old.refund_reserved then
    if not exists (select 1 from clinic_private.advance_refund_permits p where p.transaction_id = txid_current()) then
      raise exception using errcode = 'P0001', message = 'ADVANCE_FENCE: jumlah uang muka dan pengembaliannya hanya boleh berubah lewat fungsi pengembalian saldo uang muka';
    end if;
    if new.amount + new.refunded_amount + new.refund_reserved is distinct from old.amount + old.refunded_amount + old.refund_reserved then
      raise exception using errcode = 'P0001', message = 'ADVANCE_FENCE: jumlah uang muka yang diterima tidak boleh berubah';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function clinic_private.advance_refund_fence() from public, anon, authenticated, service_role;
create trigger advance_refund_fence before update on public.clinic_customer_advances
  for each row execute function clinic_private.advance_refund_fence();

-- 4. Pembantu internal ------------------------------------------------------------------------------------------------------------------
create function clinic_private.advance_refund_roles() returns text[] language sql immutable set search_path = '' as $function$
  select array['OWNER', 'FINANCE']::text[];
$function$;
revoke all on function clinic_private.advance_refund_roles() from public, anon, authenticated, service_role;

create function clinic_private.advance_refund_role_ok(p_user uuid) returns boolean language sql stable set search_path = '' as $function$
  select exists (select 1 from public.profiles p where p.id = p_user and p.is_active and p.role::text = any(clinic_private.advance_refund_roles()));
$function$;
revoke all on function clinic_private.advance_refund_role_ok(uuid) from public, anon, authenticated, service_role;

create function clinic_private.advance_refund_json(p_id uuid) returns jsonb language sql stable set search_path = '' as $function$
  select jsonb_build_object('refund_id', r.id, 'no_refund', r.no_refund, 'status', r.status, 'amount', r.amount, 'advance_id', r.advance_id, 'no_uang_muka', a.no_uang_muka,
    'journal_id', r.journal_id, 'bank_reference', r.bank_reference, 'tanggal', r.tanggal, 'balance_now', a.amount - a.applied)
  from clinic_private.advance_refunds r join public.clinic_customer_advances a on a.id = r.advance_id where r.id = p_id;
$function$;
revoke all on function clinic_private.advance_refund_json(uuid) from public, anon, authenticated, service_role;

-- jejak: dipanggil SESUDAH uang muka diubah (saldo sesudah dibaca dari barisnya)
create function clinic_private.advance_refund_event(p_refund uuid, p_event text, p_actor uuid, p_balance_before numeric, p_journal uuid, p_payload jsonb)
returns void language plpgsql set search_path = '' as $function$
begin
  insert into clinic_private.advance_refund_events (refund_id, advance_id, event, actor_id, amount, balance_before, balance_after, refunded_total_after, reserved_after, journal_id, payload)
  select r.id, r.advance_id, p_event, p_actor, r.amount, p_balance_before, a.amount - a.applied, a.refunded_amount, a.refund_reserved, p_journal, coalesce(p_payload, '{}'::jsonb)
  from clinic_private.advance_refunds r join public.clinic_customer_advances a on a.id = r.advance_id where r.id = p_refund;
end;
$function$;
revoke all on function clinic_private.advance_refund_event(uuid, text, uuid, numeric, uuid, jsonb) from public, anon, authenticated, service_role;

-- pergeseran jumlah uang muka (izin per-transaksi; jumlah diterima = amount + refunded + reserved tetap)
create function clinic_private.advance_refund_move(p_advance uuid, p_d_amount numeric, p_d_reserved numeric, p_d_refunded numeric)
returns void language plpgsql set search_path = '' as $function$
begin
  insert into clinic_private.advance_refund_permits (transaction_id) values (txid_current()) on conflict do nothing;
  update public.clinic_customer_advances set amount = amount + p_d_amount, refund_reserved = refund_reserved + p_d_reserved, refunded_amount = refunded_amount + p_d_refunded where id = p_advance;
  delete from clinic_private.advance_refund_permits where transaction_id = txid_current();
end;
$function$;
revoke all on function clinic_private.advance_refund_move(uuid, numeric, numeric, numeric) from public, anon, authenticated, service_role;

-- 5. RPC publik -------------------------------------------------------------------------------------------------------------------------
-- 5a. Ajukan (OWNER/FINANCE): mencadangkan jumlah supaya tidak terpakai di tempat lain
create function public.clinic_advance_refund_request(p_advance_id uuid, p_amount numeric, p_reason text, p_destination jsonb, p_request_key text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $function$
declare
  c_min_reason constant int := 5;
  v_user uuid := auth.uid(); v_role text;
  v_reason text := btrim(coalesce(p_reason, '')); v_key text := btrim(coalesce(p_request_key, ''));
  v_dest jsonb; v_hash text; v_prior clinic_private.advance_refunds%rowtype; v_adv public.clinic_customer_advances%rowtype;
  v_id uuid := gen_random_uuid(); v_no text; v_before numeric(15,2);
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('role', true), 'none'));
  if v_role is distinct from 'authenticated' or v_user is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  -- peran diperiksa SEBELUM kunci apa pun (peran lain tidak boleh membuat Owner/Finance menunggu)
  if not clinic_private.advance_refund_role_ok(v_user) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengembalian saldo uang muka hanya untuk Owner atau Finance';
  end if;
  if v_key = '' or length(v_key) > 100 then
    raise exception using errcode = 'P0001', message = 'KEY_REQUIRED: kunci permintaan wajib diisi (1-100 karakter)';
  end if;
  if p_amount is null or p_amount::text in ('NaN', 'Infinity', '-Infinity') or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount >= 10000000000000 then
    raise exception using errcode = 'P0001', message = 'AMOUNT_INVALID: jumlah pengembalian harus lebih dari 0, paling banyak 2 desimal';
  end if;
  if length(regexp_replace(v_reason, '\s', '', 'g')) < c_min_reason or length(v_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED: alasan wajib diisi (minimal 5 huruf, maksimal 500)';
  end if;
  v_dest := jsonb_build_object('bank', btrim(coalesce(p_destination ->> 'bank', '')), 'account', btrim(coalesce(p_destination ->> 'account', '')), 'name', btrim(coalesce(p_destination ->> 'name', '')));
  if jsonb_typeof(p_destination) is distinct from 'object' or length(v_dest ->> 'bank') not between 1 and 80 or length(v_dest ->> 'name') not between 1 and 120 or (v_dest ->> 'account') !~ '^[A-Za-z0-9 -]{3,40}$' then
    raise exception using errcode = 'P0001', message = 'DESTINATION_INVALID: lengkapi bank, nomor rekening dan nama tujuan pengembalian';
  end if;
  p_amount := round(p_amount, 2);

  select * into v_adv from public.clinic_customer_advances a where a.id = p_advance_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: uang muka tidak ditemukan';
  end if;
  if not public.user_can_access_branch(v_adv.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang uang muka tidak diizinkan';
  end if;
  -- koordinator tagihan (kunci yang sama dengan kasir ranap, tarik baris, pelepasan uang muka, batal kwitansi), lalu kunci idempotensi
  perform clinic_private.billing_lock(clinic_private.billing_keys_advance(p_advance_id));
  perform pg_advisory_xact_lock(hashtextextended('clinic-advance-refund:' || v_key, 0));
  if not clinic_private.advance_refund_role_ok(v_user) or not public.user_can_access_branch(v_adv.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengembalian saldo uang muka tidak diizinkan';
  end if;
  v_hash := md5(jsonb_build_array(p_advance_id::text, p_amount::text, v_reason, v_dest)::text);
  select * into v_prior from clinic_private.advance_refunds where request_key = v_key;
  if found then
    if v_prior.requested_by is distinct from v_user or v_prior.advance_id is distinct from p_advance_id or v_prior.request_hash is distinct from v_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci permintaan sudah dipakai untuk pengembalian yang berbeda';
    end if;
    return clinic_private.advance_refund_json(v_prior.id) || jsonb_build_object('replayed', true);
  end if;
  select * into v_adv from public.clinic_customer_advances a where a.id = p_advance_id for update;
  if v_adv.status is distinct from 'aktif' then
    raise exception using errcode = 'P0001', message = 'ADVANCE_INVALID: uang muka sudah dibatalkan';
  end if;
  v_before := v_adv.amount - v_adv.applied;
  if p_amount > v_before then
    raise exception using errcode = 'P0001', message = format('AMOUNT_EXCEEDS: jumlah %s melebihi saldo uang muka yang belum terpakai (%s)', p_amount, v_before);
  end if;
  v_no := clinic_private.next_no('RUM', 'RUM-{YYYY}{MM}-', 4, (now() at time zone 'Asia/Jakarta')::date, 'clinic_private.advance_refunds'::regclass, 'no_refund');
  insert into clinic_private.advance_refunds (id, no_refund, advance_id, branch_id, amount, reason, destination, request_key, request_hash, status, requested_by)
    values (v_id, v_no, p_advance_id, v_adv.branch_id, p_amount, v_reason, v_dest, v_key, v_hash, 'pending', v_user);
  perform clinic_private.advance_refund_move(p_advance_id, -p_amount, p_amount, 0);
  perform clinic_private.advance_refund_event(v_id, 'request', v_user, v_before, null, jsonb_build_object('destination', v_dest, 'reason', v_reason));
  return clinic_private.advance_refund_json(v_id) || jsonb_build_object('balance_before', v_before, 'balance_after', v_before - p_amount);
end;
$function$;
revoke all on function public.clinic_advance_refund_request(uuid, numeric, text, jsonb, text) from public, anon, service_role;
grant execute on function public.clinic_advance_refund_request(uuid, numeric, text, jsonb, text) to authenticated;

-- 5b. Ambil proses (FINANCE/OWNER): satu petugas memegang pengajuan supaya tidak ada dua transfer
create function public.clinic_advance_refund_claim(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $function$
declare
  v_user uuid := auth.uid(); v_role text; v_ref clinic_private.advance_refunds%rowtype; v_adv public.clinic_customer_advances%rowtype;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('role', true), 'none'));
  if v_role is distinct from 'authenticated' or v_user is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if not clinic_private.advance_refund_role_ok(v_user) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengembalian saldo uang muka hanya untuk Owner atau Finance';
  end if;
  select * into v_ref from clinic_private.advance_refunds where id = p_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'REFUND_NOT_FOUND: permintaan pengembalian tidak ditemukan';
  end if;
  if not public.user_can_access_branch(v_ref.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang uang muka tidak diizinkan';
  end if;
  perform clinic_private.billing_lock(clinic_private.billing_keys_advance(v_ref.advance_id));
  if not clinic_private.advance_refund_role_ok(v_user) or not public.user_can_access_branch(v_ref.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengembalian saldo uang muka tidak diizinkan';
  end if;
  select * into v_adv from public.clinic_customer_advances a where a.id = v_ref.advance_id for update;
  select * into v_ref from clinic_private.advance_refunds where id = p_id for update;
  if v_ref.status = 'diproses' and v_ref.processed_by = v_user then
    return clinic_private.advance_refund_json(p_id) || jsonb_build_object('replayed', true);
  end if;
  if v_ref.status = 'diproses' then
    raise exception using errcode = 'P0001', message = 'CLAIM_TAKEN: pengembalian ini sedang ditangani petugas lain; jangan transfer ulang';
  end if;
  if v_ref.status <> 'pending' then
    raise exception using errcode = 'P0001', message = format('CLAIM_STATE: pengembalian berstatus %s, tidak bisa diambil proses', v_ref.status);
  end if;
  update clinic_private.advance_refunds set status = 'diproses', processed_by = v_user, processed_at = clock_timestamp() where id = p_id;
  perform clinic_private.advance_refund_event(p_id, 'claim', v_user, v_adv.amount - v_adv.applied, null, '{}'::jsonb);
  return clinic_private.advance_refund_json(p_id);
end;
$function$;
revoke all on function public.clinic_advance_refund_claim(uuid) from public, anon, service_role;
grant execute on function public.clinic_advance_refund_claim(uuid) to authenticated;

-- 5c. Selesaikan (petugas yang mengambil proses): transfer sudah dilakukan -> jurnal Dr 314001 / Cr rekening bank
create function public.clinic_advance_refund_complete(p_id uuid, p_date date, p_account uuid, p_reference text)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $function$
declare
  v_user uuid := auth.uid(); v_role text; v_ref clinic_private.advance_refunds%rowtype; v_adv public.clinic_customer_advances%rowtype;
  v_reference text := btrim(coalesce(p_reference, '')); v_today date := (now() at time zone 'Asia/Jakarta')::date; v_date date;
  v_acc public.cash_accounts%rowtype; v_code text; v_closed date; v_jid uuid;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('role', true), 'none'));
  if v_role is distinct from 'authenticated' or v_user is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if not clinic_private.advance_refund_role_ok(v_user) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengembalian saldo uang muka hanya untuk Owner atau Finance';
  end if;
  select * into v_ref from clinic_private.advance_refunds where id = p_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'REFUND_NOT_FOUND: permintaan pengembalian tidak ditemukan';
  end if;
  if not public.user_can_access_branch(v_ref.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang uang muka tidak diizinkan';
  end if;
  if length(v_reference) not between 1 and 120 then
    raise exception using errcode = 'P0001', message = 'REFERENCE_REQUIRED: isi referensi transfer bank (1-120 karakter)';
  end if;
  v_date := coalesce(p_date, v_today);
  if v_date > v_today or v_date < (v_ref.requested_at at time zone 'Asia/Jakarta')::date then
    raise exception using errcode = 'P0001', message = 'DATE_INVALID: tanggal transfer tidak boleh di masa depan atau lebih awal dari tanggal pengajuan';
  end if;
  perform clinic_private.billing_lock(clinic_private.billing_keys_advance(v_ref.advance_id));
  if not clinic_private.advance_refund_role_ok(v_user) or not public.user_can_access_branch(v_ref.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengembalian saldo uang muka tidak diizinkan';
  end if;
  select * into v_adv from public.clinic_customer_advances a where a.id = v_ref.advance_id for update;
  select * into v_ref from clinic_private.advance_refunds where id = p_id for update;
  if v_ref.status = 'selesai' then
    if v_ref.tanggal is distinct from v_date or v_ref.bank_reference is distinct from v_reference or (p_account is not null and v_ref.cash_account_id is distinct from p_account) then
      raise exception using errcode = 'P0001', message = 'ALREADY_DONE: transfer sudah dicatat dengan rincian berbeda; tidak dicatat dua kali';
    end if;
    return clinic_private.advance_refund_json(p_id) || jsonb_build_object('replayed', true);
  end if;
  if v_ref.status = 'batal' then
    raise exception using errcode = 'P0001', message = 'REFUND_CANCELLED: permintaan pengembalian ini sudah dibatalkan';
  end if;
  if v_ref.status <> 'diproses' or v_ref.processed_by is distinct from v_user then
    raise exception using errcode = 'P0001', message = 'CLAIM_REQUIRED: ambil proses pengembalian ini lebih dulu (hanya petugas yang mengambil yang bisa menyelesaikan)';
  end if;
  -- rekening sumber: bank terpilih, atau pemetaan Transfer (default 120002)
  if p_account is not null then
    select * into v_acc from public.cash_accounts c where c.id = p_account for share;
    if not found or not v_acc.is_active or v_acc.jenis is distinct from 'Bank' or (v_acc.branch_id is not null and v_acc.branch_id is distinct from v_ref.branch_id) then
      raise exception using errcode = 'P0001', message = 'ACCOUNT_INVALID: rekening sumber harus rekening bank yang aktif dan berlaku untuk cabang ini';
    end if;
    v_code := v_acc.coa_code;
  else
    v_code := clinic_private.kas_code('Transfer', v_ref.branch_id);
    select * into v_acc from public.cash_accounts c where c.coa_code = v_code and c.is_active and c.jenis = 'Bank' and (c.branch_id is null or c.branch_id = v_ref.branch_id) order by c.branch_id nulls last limit 1;
  end if;
  if not exists (select 1 from public.coa_accounts a where a.code = v_code and a.type = 'ASET' and a.is_active and not a.is_header) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_INVALID: akun bank tidak valid di bagan akun';
  end if;
  select l.closed_until into v_closed from public.accounting_locks l where l.id;
  if v_closed is not null and v_date <= v_closed then
    raise exception using errcode = 'P0001', message = format('PERIOD_LOCKED: periode akuntansi sampai %s sudah ditutup', v_closed);
  end if;
  if v_adv.refund_reserved < v_ref.amount then
    raise exception using errcode = 'P0001', message = 'ADVANCE_FENCE: cadangan uang muka lebih kecil dari pengembalian; periksa data';
  end if;
  v_jid := public.clinic_write_journal(v_date, 'Pengembalian saldo uang muka ' || v_adv.no_uang_muka || ' (' || v_ref.no_refund || ')', 'klinik-uang-muka-refund', v_ref.no_refund, v_ref.branch_id,
    jsonb_build_array(jsonb_build_object('code', '314001', 'debit', v_ref.amount, 'credit', 0), jsonb_build_object('code', v_code, 'debit', 0, 'credit', v_ref.amount)));
  perform clinic_private.advance_refund_move(v_ref.advance_id, 0, -v_ref.amount, v_ref.amount);
  update clinic_private.advance_refunds set status = 'selesai', completed_by = v_user, completed_at = clock_timestamp(), tanggal = v_date, cash_account_id = v_acc.id, coa_code = v_code,
    bank_reference = v_reference, journal_id = v_jid where id = p_id;
  perform clinic_private.advance_refund_event(p_id, 'complete', v_user, v_adv.amount - v_adv.applied, v_jid, jsonb_build_object('tanggal', v_date, 'coa_code', v_code, 'bank_reference', v_reference));
  return clinic_private.advance_refund_json(p_id);
end;
$function$;
revoke all on function public.clinic_advance_refund_complete(uuid, date, uuid, text) from public, anon, service_role;
grant execute on function public.clinic_advance_refund_complete(uuid, date, uuid, text) to authenticated;

-- 5d. Batalkan permintaan yang BELUM dibayar: cadangan dilepas persis
create function public.clinic_advance_refund_cancel(p_id uuid, p_reason text, p_unpaid_confirmed boolean)
returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $function$
declare
  v_user uuid := auth.uid(); v_role text; v_ref clinic_private.advance_refunds%rowtype; v_adv public.clinic_customer_advances%rowtype; v_reason text := btrim(coalesce(p_reason, ''));
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('role', true), 'none'));
  if v_role is distinct from 'authenticated' or v_user is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if not clinic_private.advance_refund_role_ok(v_user) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengembalian saldo uang muka hanya untuk Owner atau Finance';
  end if;
  if p_unpaid_confirmed is distinct from true then
    raise exception using errcode = 'P0001', message = 'CANCEL_CONFIRM_REQUIRED: konfirmasi bahwa pengembalian ini belum ditransfer';
  end if;
  if length(regexp_replace(v_reason, '\s', '', 'g')) < 5 or length(v_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'REASON_REQUIRED: alasan pembatalan wajib diisi (minimal 5 huruf, maksimal 500)';
  end if;
  select * into v_ref from clinic_private.advance_refunds where id = p_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'REFUND_NOT_FOUND: permintaan pengembalian tidak ditemukan';
  end if;
  if not public.user_can_access_branch(v_ref.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang uang muka tidak diizinkan';
  end if;
  perform clinic_private.billing_lock(clinic_private.billing_keys_advance(v_ref.advance_id));
  if not clinic_private.advance_refund_role_ok(v_user) or not public.user_can_access_branch(v_ref.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengembalian saldo uang muka tidak diizinkan';
  end if;
  select * into v_adv from public.clinic_customer_advances a where a.id = v_ref.advance_id for update;
  select * into v_ref from clinic_private.advance_refunds where id = p_id for update;
  if v_ref.status = 'batal' then
    return clinic_private.advance_refund_json(p_id) || jsonb_build_object('replayed', true);
  end if;
  if v_ref.status = 'selesai' then
    raise exception using errcode = 'P0001', message = 'REFUND_DONE: pengembalian ini sudah ditransfer dan dijurnal; tidak bisa dibatalkan';
  end if;
  if v_ref.status = 'diproses' and v_ref.processed_by is distinct from v_user
     and not exists (select 1 from public.profiles p where p.id = v_user and p.is_active and p.role = 'OWNER') then
    raise exception using errcode = 'P0001', message = 'CLAIM_TAKEN: pengembalian ini sedang ditangani petugas lain; hubungi petugas itu atau Owner';
  end if;
  if v_adv.refund_reserved < v_ref.amount then
    raise exception using errcode = 'P0001', message = 'ADVANCE_FENCE: cadangan uang muka lebih kecil dari pengembalian; periksa data';
  end if;
  perform clinic_private.advance_refund_move(v_ref.advance_id, v_ref.amount, -v_ref.amount, 0);
  update clinic_private.advance_refunds set status = 'batal', cancelled_by = v_user, cancelled_at = clock_timestamp(), cancel_reason = v_reason where id = p_id;
  perform clinic_private.advance_refund_event(p_id, 'cancel', v_user, v_adv.amount - v_adv.applied, null, jsonb_build_object('reason', v_reason));
  return clinic_private.advance_refund_json(p_id);
end;
$function$;
revoke all on function public.clinic_advance_refund_cancel(uuid, text, boolean) from public, anon, service_role;
grant execute on function public.clinic_advance_refund_cancel(uuid, text, boolean) to authenticated;

-- 5e. Daftar (antrean finance dan panel uang muka). Hanya OWNER/FINANCE; tujuan transfer ikut terbaca karena memang dipakai untuk transfer.
create function public.get_clinic_advance_refunds(p_advance uuid default null, p_office boolean default false, p_status text default '', p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' or not clinic_private.advance_refund_role_ok(auth.uid()) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengembalian saldo uang muka hanya untuk Owner atau Finance';
  end if;
  if not p_office and p_advance is null then
    raise exception using errcode = 'P0001', message = 'LINE_INVALID: pilih uang muka';
  end if;
  if p_status not in ('', 'pending', 'diproses', 'selesai', 'batal') or p_offset is null or p_offset < 0 or p_offset > 100000 then
    raise exception using errcode = 'P0001', message = 'LINE_INVALID: filter tidak valid';
  end if;
  select coalesce(jsonb_agg(t.j order by t.requested_at desc, t.id), '[]'::jsonb) into v_result from (
    select r.id, r.requested_at, jsonb_build_object('id', r.id, 'no_refund', r.no_refund, 'advance_id', r.advance_id, 'no_uang_muka', a.no_uang_muka, 'visit_id', a.visit_id,
      'customer_id', a.customer_id, 'customer_name', cu.name, 'branch_id', r.branch_id, 'amount', r.amount, 'status', r.status, 'reason', r.reason, 'destination', r.destination,
      'requested_by', r.requested_by, 'requested_by_name', rp.full_name, 'requested_at', r.requested_at, 'processed_by', r.processed_by, 'completed_at', r.completed_at, 'tanggal', r.tanggal,
      'bank_reference', r.bank_reference, 'journal_id', r.journal_id, 'cancel_reason', r.cancel_reason) as j
    from clinic_private.advance_refunds r join public.clinic_customer_advances a on a.id = r.advance_id
      left join public.customers cu on cu.id = a.customer_id left join public.profiles rp on rp.id = r.requested_by
    where public.user_can_access_branch(r.branch_id) and (p_advance is null or r.advance_id = p_advance) and (p_status = '' or r.status = p_status)
    order by r.requested_at desc, r.id limit 100 offset p_offset) t;
  return v_result;
end;
$function$;
revoke all on function public.get_clinic_advance_refunds(uuid, boolean, text, integer) from public, anon, service_role;
grant execute on function public.get_clinic_advance_refunds(uuid, boolean, text, integer) to authenticated;

do $check$
declare d text;
begin
  d := pg_get_functiondef('public.clinic_advance_refund_complete(uuid,date,uuid,text)'::regprocedure);
  if position('billing_lock' in d) = 0 or position('clinic_write_journal' in d) = 0 or position('accounting_locks' in d) = 0 or position('314001' in d) = 0 or position('advance_refund_role_ok' in d) = 0 then
    raise exception 'Refund uang muka: definisi complete tidak sesuai setelah dipasang';
  end if;
  d := pg_get_functiondef('public.clinic_advance_refund_request(uuid,numeric,text,jsonb,text)'::regprocedure);
  if position('billing_lock' in d) = 0 or position('advance_refund_role_ok' in d) = 0 or position('AMOUNT_EXCEEDS' in d) = 0 or position('advance_refund_move' in d) = 0 then
    raise exception 'Refund uang muka: definisi request tidak sesuai setelah dipasang';
  end if;
  if clinic_private.advance_refund_roles() is distinct from array['OWNER', 'FINANCE']::text[] then
    raise exception 'Refund uang muka: peran tidak sesuai';
  end if;
end $check$;
