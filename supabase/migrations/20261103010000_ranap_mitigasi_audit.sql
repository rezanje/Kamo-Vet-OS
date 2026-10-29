-- Mitigasi audit tagihan berjalan rawat inap (#339).
--
-- Tiga audit pemakai (keuangan, akses, alur) menemukan tujuh cacat uang pada rilis
-- #339. Migrasi ini MAJU: migrasi lama tidak diubah, RPC berjalan ditambal dengan
-- jangkar eksak (pg_get_functiondef + replace) dan gagal tertutup bila jangkarnya
-- bergeser. Yang diperbaiki:
--
--   FIN-01  Pembatalan kwitansi campuran yang sebagian jadi uang muka membalik
--           rekening kas bagian PERTAMA, bukan rekening sisa yang benar-benar
--           diterima. Jurnalnya seimbang tetapi saldo Kas dan Bank salah.
--   FIN-02  Terbit ulang memutus hubungan kwitansi: pembatalan kwitansi tidak
--           mengurangi pembayaran pada tagihan pengganti yang aktif.
--   FIN-03  Uang muka yang sudah menempel pada tagihan tidak punya jalan keluar.
--           Sekarang ada pelepasan beralasan, berperan, dan berjejak.
--   FIN-04  Status bayar tidak mengikuti uang yang benar-benar diterima.
--   FIN-05  Pelunasan tagihan tahap lewat Keuangan -> Piutang melewati kwitansi
--           dan shift klinik.
--   FIN-06  Flag `min_dp_deferred` / kunci `split_payments` dari pemanggil bisa
--           mematikan uang muka minimal. ACCESS-02 sama.
--   FIN-07  Satu baris resep masih bisa masuk dua kali dalam SATU tagihan.
--   UF-04   Kepulangan menimpa jasa rawat inap yang diisi petugas secara manual.
--
-- Tidak disentuh: kasir petshop, promo/voucher/komisi, racikan, BMHP, permintaan
-- stok, impor, dan seluruh aturan akses/cabang/consent.

-- ---------------------------------------------------------------------------
-- 1. Konteks posting internal yang TIDAK bisa dipalsukan pemanggil (FIN-06/ACCESS-02)
-- ---------------------------------------------------------------------------
-- #339 memakai GUC `clinic.stage_visit` dan — lebih buruk — percaya pada isi JSON
-- `p_invoice` untuk menunda uang muka minimal. Keduanya berasal dari pemanggil.
-- Penandanya sekarang BARIS TABEL di skema privat: akun aplikasi tidak punya hak
-- apa pun di sana, jadi hanya fungsi security definer milik proyek yang bisa
-- membukanya, dan penandanya mati sendiri saat transaksi berakhir.
revoke all on schema clinic_private from public, anon, authenticated, service_role;

create unlogged table clinic_private.posting_ctx (
  txid bigint primary key,
  kind text not null check (kind in ('stage','split','demo')),
  visit_id uuid not null,
  opened_at timestamptz not null default now()
);
revoke all on table clinic_private.posting_ctx from public, anon, authenticated, service_role;

create function clinic_private.context_begin(p_kind text, p_visit_id uuid) returns void
language plpgsql set search_path = '' as $function$
begin
  insert into clinic_private.posting_ctx (txid, kind, visit_id)
  values (pg_catalog.txid_current(), p_kind, p_visit_id)
  on conflict (txid) do update set kind = excluded.kind, visit_id = excluded.visit_id;
end;
$function$;
revoke all on function clinic_private.context_begin(text, uuid) from public, anon, authenticated, service_role;

create function clinic_private.context_end() returns void
language plpgsql set search_path = '' as $function$
begin
  delete from clinic_private.posting_ctx where txid = pg_catalog.txid_current();
end;
$function$;
revoke all on function clinic_private.context_end() from public, anon, authenticated, service_role;

-- Tanpa xid yang sudah diberikan tidak mungkin ada konteks: kembalikan NULL, jangan
-- memaksa transaksi baca mengambil xid.
create function clinic_private.posting_context(p_visit_id uuid) returns text
language sql stable set search_path = '' as $$
  select c.kind from clinic_private.posting_ctx c
  where c.txid = pg_catalog.txid_current_if_assigned() and c.visit_id = p_visit_id;
$$;
revoke all on function clinic_private.posting_context(uuid) from public, anon, authenticated, service_role;

-- Penanda tahap tidak lagi dibaca dari GUC. Tanda tangan dipertahankan supaya
-- guard_open_inpatient_invoice dan clinic_post_invoice yang sudah menunjuk fungsi ini
-- tetap memakai definisi baru tanpa dikompilasi ulang.
create or replace function clinic_private.stage_billing(p_visit_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(clinic_private.posting_context(p_visit_id) = 'stage', false);
$$;

-- Hanya pembungkus internal yang boleh menunda uang muka minimal: tahap rawat inap
-- (menerapkan uang muka dulu), checkout campuran dan checkout DEMO (keduanya sudah
-- memvalidasi bahwa seluruh tagihan dibayar sebelum posting).
create function clinic_private.dp_deferred(p_visit_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(clinic_private.posting_context(p_visit_id) in ('stage','split','demo'), false);
$$;
revoke all on function clinic_private.dp_deferred(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Penanda tagihan tahap pada dokumennya (FIN-05)
-- ---------------------------------------------------------------------------
-- Tanpa penanda, jalur piutang lama tidak bisa membedakan tagihan tahap rawat inap
-- dari tagihan rawat jalan biasa, sehingga uang tahap bisa masuk tanpa kwitansi dan
-- tanpa shift klinik.
alter table public.invoices add column if not exists stage_billing boolean not null default false;

-- Baris lama yang jelas-jelas tagihan tahap ditandai sekali di sini. Ini klasifikasi
-- dokumen, bukan perubahan uang: tidak ada nominal, status bayar, atau jurnal yang
-- disentuh. Tagihan rawat jalan dan tagihan kepulangan lama (satu invoice, pasien
-- sudah pulang, belum pernah ada kwitansi) tidak ikut tertandai.
update public.invoices i set stage_billing = true
where i.request_key is not null
  and exists (select 1 from public.inpatient_records r where r.visit_id = i.visit_id)
  and (
    exists (select 1 from public.clinic_payment_receipts k where k.visit_id = i.visit_id)
    or exists (select 1 from public.inpatient_records r
      where r.visit_id = i.visit_id and r.discharged_at is null)
    or (select count(*) from public.invoices i2
      where i2.visit_id = i.visit_id and i2.voided_at is null) > 1
  );

-- ---------------------------------------------------------------------------
-- 3. Status bayar selalu dihitung dari uang yang benar-benar masuk (FIN-04)
-- ---------------------------------------------------------------------------
create function clinic_private.sync_paid_status(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = '' as $function$
declare v_total numeric(15,2); v_received numeric(15,2);
begin
  select i.total into v_total from public.invoices i
  where i.id = p_invoice_id and i.voided_at is null for update;
  if not found then return; end if;
  v_received := clinic_private.invoice_received(p_invoice_id)::numeric(15,2);
  if v_total <= 0 or v_received >= v_total then
    update public.invoices set paid_status = 'Lunas', paid_at = coalesce(paid_at, now())
    where id = p_invoice_id;
  elsif v_received > 0 then
    update public.invoices set paid_status = 'DP', paid_at = null where id = p_invoice_id;
  else
    update public.invoices set paid_status = 'Belum Lunas', paid_at = null where id = p_invoice_id;
  end if;
end;
$function$;
revoke all on function clinic_private.sync_paid_status(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Dokumen pengganti setelah terbit ulang (FIN-02)
-- ---------------------------------------------------------------------------
-- Terbit ulang mem-void tagihan lama dan menyalin isinya ke tagihan baru lewat
-- kolom reissued_from. Pembalik uang harus mengenai dokumen yang masih hidup.
create function clinic_private.active_invoice(p_invoice_id uuid) returns uuid
language plpgsql stable set search_path = '' as $function$
declare v_id uuid := p_invoice_id; v_voided timestamptz; v_next uuid; v_hop integer := 0;
begin
  loop
    select i.voided_at into v_voided from public.invoices i where i.id = v_id;
    if not found then return null; end if;
    if v_voided is null then return v_id; end if;
    select i.id into v_next from public.invoices i
    where i.reissued_from = v_id order by i.created_at, i.id limit 1;
    if v_next is null then return null; end if;
    v_id := v_next;
    v_hop := v_hop + 1;
    if v_hop > 20 then return null; end if;
  end loop;
end;
$function$;
revoke all on function clinic_private.active_invoice(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Pelepasan uang muka yang sudah dipakai (FIN-03)
-- ---------------------------------------------------------------------------
-- Kolom jejak. FK sengaja TIDAK ditambahkan ke profiles/cashier_shifts/invoice_payments:
-- tabel-tabel ini sudah punya FK ke sana, dan FK kedua membuat relasi embed PostgREST
-- jadi ambigu (PGRST201) sehingga layar riwayat diam-diam kosong.
alter table public.clinic_advance_applications
  add column released_at timestamptz,
  add column released_by uuid,
  add column release_reason text,
  add column release_payment_id uuid;

alter table public.clinic_customer_advances
  add column release_request_key text,
  add column released_at timestamptz,
  add column released_by uuid,
  add column release_reason text,
  add column release_shift_id uuid;
create unique index clinic_customer_advances_release_key
  on public.clinic_customer_advances(release_request_key) where release_request_key is not null;

create function public.clinic_release_advance_application(
  p_advance_id uuid, p_request_key text, p_reason text
) returns integer language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_adv public.clinic_customer_advances%rowtype;
  v_shift public.cashier_shifts%rowtype;
  v_key text := nullif(btrim(p_request_key), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_app record;
  v_target uuid;
  v_payment_id uuid;
  v_count integer := 0;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('role', true), 'none')) is distinct from 'authenticated' or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100 or v_reason is null or length(v_reason) > 500 then
    raise exception using errcode='P0001', message='RELEASE_INVALID: alasan pelepasan uang muka wajib diisi';
  end if;
  select p.role into v_role from public.profiles p where p.id = v_user and p.is_active;
  if v_role is null or v_role not in ('OWNER','ADMIN','FINANCE') then
    raise exception using errcode='P0001',
      message='ACCESS_DENIED: hanya OWNER, ADMIN, atau FINANCE boleh melepas uang muka';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('clinic-advance-release:' || v_key, 0));
  select * into v_adv from public.clinic_customer_advances where id = p_advance_id for update;
  if not found or not public.user_can_access_branch(v_adv.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: uang muka tidak ditemukan atau cabang tidak diizinkan';
  end if;
  -- Diulang dengan kunci yang sama: jawab apa adanya, jangan melepas dua kali.
  if v_adv.release_request_key is not null then
    if v_adv.release_request_key is distinct from v_key then
      raise exception using errcode='P0001', message='ADVANCE_RELEASED: uang muka ini sudah pernah dilepas';
    end if;
    return 0;
  end if;
  if v_adv.status <> 'aktif' then
    raise exception using errcode='P0001', message='RELEASE_INVALID: uang muka sudah dibatalkan';
  end if;
  select s.* into v_shift from public.cashier_shifts s
  where s.branch_id = v_adv.branch_id and s.opened_by = v_user
    and s.shift_type = 'klinik' and s.status = 'open' for update;
  if not found then
    raise exception using errcode='P0001', message='SHIFT_INVALID: shift klinik aktif tidak ditemukan';
  end if;

  for v_app in
    select a.* from public.clinic_advance_applications a
    where a.advance_id = p_advance_id and a.released_at is null
    order by a.created_at, a.id for update
  loop
    v_target := coalesce(clinic_private.active_invoice(v_app.invoice_id), v_app.invoice_id);
    insert into public.invoice_payments(
      invoice_id, tanggal, amount, metode, catatan, kas_code, created_by, reversal_of
    ) values (
      v_target, current_date, -v_app.amount, 'Uang Muka',
      'Pelepasan uang muka ' || v_adv.no_uang_muka, '2103', v_user, v_app.payment_id
    ) returning id into v_payment_id;
    -- Kebalikan persis jurnal pemakaian (2103 debit / 1201 kredit).
    perform public.clinic_write_journal(current_date,
      'Pelepasan uang muka ' || v_adv.no_uang_muka, 'klinik-ar',
      (select i.invoice_no from public.invoices i where i.id = v_target), v_adv.branch_id,
      jsonb_build_array(
        jsonb_build_object('code','1201','debit',v_app.amount,'credit',0),
        jsonb_build_object('code','2103','debit',0,'credit',v_app.amount)));
    update public.clinic_advance_applications
      set released_at = now(), released_by = v_user, release_reason = v_reason,
          release_payment_id = v_payment_id
    where id = v_app.id;
    update public.clinic_customer_advances
      set applied = greatest(applied - v_app.amount, 0) where id = p_advance_id;
    perform clinic_private.sync_paid_status(v_target);
    update public.visits set status = 'Pembayaran'
    where id = (select i.visit_id from public.invoices i where i.id = v_target)
      and status = 'Selesai'
      and exists (select 1 from public.invoices i2 where i2.visit_id = visits.id
        and i2.voided_at is null and i2.paid_status <> 'Lunas');
    v_count := v_count + 1;
  end loop;

  update public.clinic_customer_advances
    set release_request_key = v_key, released_at = now(), released_by = v_user,
        release_reason = v_reason, release_shift_id = v_shift.id
  where id = p_advance_id;
  return v_count;
end;
$function$;
revoke all on function public.clinic_release_advance_application(uuid, text, text)
  from public, anon, service_role;
grant execute on function public.clinic_release_advance_application(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Tagih sekarang: konteks internal + status bayar sebenarnya (FIN-04/FIN-05/FIN-06)
-- ---------------------------------------------------------------------------
create or replace function public.clinic_post_inpatient_stage_invoice(
  p_visit_id uuid, p_request_key text, p_invoice jsonb, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_visit public.visits%rowtype;
  v_key text := nullif(btrim(p_request_key), '');
  v_replay boolean;
  v_invoice_id uuid;
  v_invoice_no text;
  v_tanggal date;
  v_branch uuid;
  v_remaining numeric(15,2);
  v_apply numeric(15,2);
  v_payment_id uuid;
  v_adv record;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('role', true), 'none'));
  if v_role is distinct from 'authenticated' or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100 then
    raise exception using errcode='P0001', message='INVOICE_INVALID: kunci permintaan tidak valid';
  end if;
  select v.* into v_visit from public.visits v where v.id = p_visit_id;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: kunjungan tidak ditemukan atau cabang tidak diizinkan';
  end if;
  if not exists (select 1 from public.inpatient_records r where r.visit_id = p_visit_id) then
    raise exception using errcode='P0001', message='STAGE_INVALID: kunjungan ini bukan rawat inap';
  end if;
  v_branch := v_visit.branch_id;
  v_tanggal := nullif(p_invoice ->> 'tanggal', '')::date;
  v_replay := exists (select 1 from public.invoices i where i.request_key = v_key);

  -- Konteks tahap dibuka hanya selama posting berjalan lalu ditutup lagi: baris lain
  -- dalam transaksi yang sama tidak boleh ikut menembus penjaga INPATIENT_OPEN, dan
  -- penundaan uang muka minimal tidak pernah berasal dari isi permintaan pemanggil.
  perform clinic_private.context_begin('stage', p_visit_id);
  v_invoice_id := public.clinic_post_invoice(p_visit_id, v_key, p_invoice, p_lines);
  perform clinic_private.context_end();
  if v_replay then return v_invoice_id; end if;
  update public.invoices set stage_billing = true where id = v_invoice_id;

  select i.invoice_no, i.total - i.dp_amount into v_invoice_no, v_remaining
  from public.invoices i where i.id = v_invoice_id for update;

  -- Uang muka pemilik (uang yang masuk sebelum ada tagihan) otomatis memotong tahap ini,
  -- tertua lebih dulu. Ini bukan penerimaan kas baru: utang ke pemilik yang berkurang.
  if v_visit.customer_id is not null then
    for v_adv in
      select a.* from public.clinic_customer_advances a
      where a.customer_id = v_visit.customer_id and a.branch_id = v_branch
        and a.status = 'aktif' and a.amount > a.applied
      order by a.created_at, a.id
      for update
    loop
      exit when v_remaining <= 0;
      v_apply := least(v_adv.amount - v_adv.applied, v_remaining)::numeric(15,2);
      insert into public.invoice_payments(
        invoice_id, tanggal, amount, metode, catatan, kas_code, created_by
      ) values (
        v_invoice_id, v_tanggal, v_apply, 'Uang Muka',
        'Pemakaian uang muka ' || v_adv.no_uang_muka, '2103', v_user
      ) returning id into v_payment_id;
      insert into public.clinic_advance_applications(advance_id, invoice_id, payment_id, amount, created_by)
        values (v_adv.id, v_invoice_id, v_payment_id, v_apply, v_user);
      update public.clinic_customer_advances set applied = applied + v_apply where id = v_adv.id;
      perform public.clinic_write_journal(v_tanggal, 'Pemakaian uang muka ' || v_invoice_no,
        'klinik-ar', v_invoice_no, v_branch, jsonb_build_array(
          jsonb_build_object('code','2103','debit',v_apply,'credit',0),
          jsonb_build_object('code','1201','debit',0,'credit',v_apply)));
      v_remaining := v_remaining - v_apply;
    end loop;
  end if;
  -- Status bayar SELALU dihitung ulang dari uang yang benar-benar menempel, bukan dari
  -- dp_amount kepala invoice (tagihan tahap selalu mengirim dp_amount = 0).
  perform clinic_private.sync_paid_status(v_invoice_id);

  perform clinic_private.enforce_min_dp(v_invoice_id, p_invoice ->> 'dp_override_reason');
  return v_invoice_id;
end;
$function$;
revoke all on function public.clinic_post_inpatient_stage_invoice(uuid, text, jsonb, jsonb)
  from public, anon, service_role;
grant execute on function public.clinic_post_inpatient_stage_invoice(uuid, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Terima pembayaran: status bayar per langkah (FIN-04)
-- ---------------------------------------------------------------------------
create or replace function public.clinic_receive_visit_payment(
  p_visit_id uuid, p_request_key text, p_tanggal date, p_parts jsonb,
  p_invoice_id uuid default null, p_catatan text default null
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_visit public.visits%rowtype;
  v_shift public.cashier_shifts%rowtype;
  v_key text := nullif(btrim(p_request_key), '');
  v_hash text;
  v_existing public.clinic_payment_receipts%rowtype;
  v_receipt_id uuid;
  v_no text;
  v_part jsonb;
  v_index integer := 0;
  v_slot integer;
  v_total numeric(15,2) := 0;
  v_amount numeric;
  v_parts jsonb := '[]'::jsonb;
  v_kas text;
  v_inv record;
  v_sisa numeric(15,2);
  v_take numeric(15,2);
  v_payment_id uuid;
  v_left numeric(15,2);
  v_adv_lines jsonb := '[]'::jsonb;
  v_adv_total numeric(15,2) := 0;
  v_adv_no text;
  v_adv_id uuid;
  v_any_paid boolean := false;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('role', true), 'none'));
  if v_role is distinct from 'authenticated' or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100 or p_tanggal is null
     or jsonb_typeof(p_parts) is distinct from 'array'
     or jsonb_array_length(p_parts) not between 1 and 6 then
    raise exception using errcode='P0001', message='PAYMENT_INVALID: rincian pembayaran tidak lengkap';
  end if;
  select v.* into v_visit from public.visits v where v.id = p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: kunjungan tidak ditemukan atau cabang tidak diizinkan';
  end if;
  -- Addendum §1: uang klinik hanya boleh berpindah di dalam shift klinik milik kasirnya.
  select s.* into v_shift from public.cashier_shifts s
  where s.branch_id = v_visit.branch_id and s.opened_by = v_user
    and s.shift_type = 'klinik' and s.status = 'open' for update;
  if not found then
    raise exception using errcode='P0001', message='SHIFT_INVALID: shift klinik aktif tidak ditemukan';
  end if;

  v_hash := md5(jsonb_build_object('visit', p_visit_id, 'tanggal', p_tanggal,
    'parts', p_parts, 'invoice', p_invoice_id, 'catatan', nullif(btrim(p_catatan), ''))::text);
  perform pg_advisory_xact_lock(hashtextextended('clinic-receipt:' || v_key, 0));
  select * into v_existing from public.clinic_payment_receipts where request_key = v_key for update;
  if found then
    if v_existing.visit_id is distinct from p_visit_id or v_existing.request_hash is distinct from v_hash then
      raise exception using errcode='P0001', message='IDEMPOTENCY_CONFLICT: kunci pembayaran dipakai untuk data berbeda';
    end if;
    return v_existing.id;
  end if;

  for v_part in select value from jsonb_array_elements(p_parts) loop
    v_index := v_index + 1;
    if jsonb_typeof(v_part) is distinct from 'object'
      or coalesce(v_part ->> 'method', '') not in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') then
      raise exception using errcode='P0001', message='PAYMENT_INVALID: metode pembayaran tidak valid';
    end if;
    v_amount := nullif(v_part ->> 'amount', '')::numeric;
    if v_amount is null or v_amount <= 0 or v_amount <> trunc(v_amount) or v_amount > 9007199254740991 then
      raise exception using errcode='P0001', message='PAYMENT_INVALID: nominal pembayaran harus rupiah bulat positif';
    end if;
    v_kas := clinic_private.kas_code(v_part ->> 'method', v_visit.branch_id);
    v_total := v_total + v_amount;
    v_parts := v_parts || jsonb_build_array(jsonb_build_object(
      'urutan', v_index, 'metode', v_part ->> 'method', 'amount', v_amount, 'kas_code', v_kas, 'sisa', v_amount));
  end loop;

  v_no := clinic_private.next_no('KWT', 'KWT-{YYYY}{MM}-', 4, p_tanggal,
    'public.clinic_payment_receipts'::regclass, 'no_kwitansi');
  insert into public.clinic_payment_receipts(
    no_kwitansi, visit_id, customer_id, branch_id, tanggal, total, catatan,
    shift_id, created_by, request_key, request_hash
  ) values (
    v_no, p_visit_id, v_visit.customer_id, v_visit.branch_id, p_tanggal, v_total,
    nullif(btrim(p_catatan), ''), v_shift.id, v_user, v_key, v_hash
  ) returning id into v_receipt_id;
  insert into public.clinic_payment_receipt_parts(receipt_id, urutan, metode, amount, kas_code)
  select v_receipt_id, (e.value ->> 'urutan')::smallint, e.value ->> 'metode',
    (e.value ->> 'amount')::numeric, e.value ->> 'kas_code'
  from jsonb_array_elements(v_parts) e;

  -- Alokasi: invoice tahap tertua lebih dulu, atau tagihan yang dipilih kasir.
  for v_inv in
    select i.id, i.invoice_no, i.total, i.dp_amount
    from public.invoices i
    where i.visit_id = p_visit_id and i.voided_at is null and i.paid_status <> 'Lunas'
      and i.invoice_no is not null and i.request_key is not null and not i.correction_pending
    order by (i.id = p_invoice_id) desc, i.created_at, i.id
    for update
  loop
    exit when v_total <= 0;
    v_sisa := (v_inv.total - v_inv.dp_amount
      - coalesce((select sum(p.amount) from public.invoice_payments p where p.invoice_id = v_inv.id), 0))::numeric(15,2);
    if v_sisa <= 0 then continue; end if;
    for v_slot in 1 .. jsonb_array_length(v_parts) loop
      exit when v_sisa <= 0;
      v_take := least((v_parts -> (v_slot - 1) ->> 'sisa')::numeric, v_sisa)::numeric(15,2);
      if v_take <= 0 then continue; end if;
      insert into public.invoice_payments(
        invoice_id, tanggal, amount, metode, catatan, kas_code, created_by, receipt_id
      ) values (
        v_inv.id, p_tanggal, v_take, v_parts -> (v_slot - 1) ->> 'metode',
        'Kwitansi ' || v_no, v_parts -> (v_slot - 1) ->> 'kas_code', v_user, v_receipt_id
      ) returning id into v_payment_id;
      perform public.clinic_write_journal(p_tanggal, 'Pembayaran ' || v_inv.invoice_no || ' (' || v_no || ')',
        'klinik-ar', v_inv.invoice_no, v_visit.branch_id, jsonb_build_array(
          jsonb_build_object('code', v_parts -> (v_slot - 1) ->> 'kas_code', 'debit', v_take, 'credit', 0),
          jsonb_build_object('code','1201','debit',0,'credit',v_take)));
      v_parts := jsonb_set(v_parts, array[(v_slot - 1)::text, 'sisa'],
        to_jsonb((v_parts -> (v_slot - 1) ->> 'sisa')::numeric - v_take));
      v_sisa := v_sisa - v_take;
      v_total := v_total - v_take;
    end loop;
    -- Uang yang baru masuk sebagian membuat statusnya DP, bukan tetap Belum Lunas.
    perform clinic_private.sync_paid_status(v_inv.id);
    if v_sisa <= 0 then v_any_paid := true; end if;
  end loop;

  -- Sisa uang saat tidak ada tagihan yang belum lunas = uang muka penjualan (2103),
  -- bukan omzet. Ia otomatis memotong tahap berikutnya saat tagihannya terbit.
  select coalesce(sum((e.value ->> 'sisa')::numeric), 0) into v_left from jsonb_array_elements(v_parts) e;
  if v_left > 0 then
    if v_visit.customer_id is null then
      raise exception using errcode='P0001',
        message='ADVANCE_INVALID: kelebihan uang tidak dapat disimpan tanpa data pemilik';
    end if;
    v_adv_no := clinic_private.next_no('UMK', 'UMK-{YYYY}{MM}-', 4, p_tanggal,
      'public.clinic_customer_advances'::regclass, 'no_uang_muka');
    insert into public.clinic_customer_advances(
      no_uang_muka, receipt_id, customer_id, branch_id, visit_id, tanggal, amount, shift_id, created_by
    ) values (
      v_adv_no, v_receipt_id, v_visit.customer_id, v_visit.branch_id, p_visit_id, p_tanggal,
      v_left, v_shift.id, v_user
    ) returning id into v_adv_id;
    select coalesce(jsonb_agg(jsonb_build_object(
        'code', e.value ->> 'kas_code', 'debit', (e.value ->> 'sisa')::numeric, 'credit', 0)), '[]'::jsonb),
      coalesce(sum((e.value ->> 'sisa')::numeric), 0)
      into v_adv_lines, v_adv_total
    from jsonb_array_elements(v_parts) e where (e.value ->> 'sisa')::numeric > 0;
    perform public.clinic_write_journal(p_tanggal, 'Uang muka pemilik ' || v_adv_no,
      'klinik-uang-muka', v_adv_no, v_visit.branch_id,
      v_adv_lines || jsonb_build_array(jsonb_build_object('code','2103','debit',0,'credit',v_adv_total)));
  end if;

  -- Kunjungan baru ditutup kalau pasien sudah pulang DAN tidak ada tagihan aktif yang
  -- belum lunas. Pasien rawat inap yang baru membayar sebagian tetap berjalan.
  if v_any_paid then
    update public.visits set status = 'Selesai' where id = p_visit_id and status <> 'Selesai'
      and not exists (select 1 from public.inpatient_records r where r.visit_id = p_visit_id and r.discharged_at is null)
      and not exists (select 1 from public.invoices i where i.visit_id = p_visit_id
        and i.voided_at is null and i.paid_status <> 'Lunas');
  end if;
  return v_receipt_id;
end;
$function$;
revoke all on function public.clinic_receive_visit_payment(uuid, text, date, jsonb, uuid, text)
  from public, anon, service_role;
grant execute on function public.clinic_receive_visit_payment(uuid, text, date, jsonb, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Batalkan kwitansi: rekening asli per bagian + dokumen aktif (FIN-01/FIN-02/FIN-04)
-- ---------------------------------------------------------------------------
create or replace function public.clinic_void_payment_receipt(
  p_receipt_id uuid, p_request_key text, p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_receipt public.clinic_payment_receipts%rowtype;
  v_shift public.cashier_shifts%rowtype;
  v_key text := nullif(btrim(p_request_key), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_row record;
  v_target uuid;
  v_adv public.clinic_customer_advances%rowtype;
  v_lines jsonb;
  v_sisa_total numeric(15,2);
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('role', true), 'none')) is distinct from 'authenticated' or v_user is null then
    raise exception using errcode='P0001', message='ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100 or v_reason is null or length(v_reason) > 500 then
    raise exception using errcode='P0001', message='RECEIPT_INVALID: alasan pembatalan wajib diisi';
  end if;
  select p.role into v_role from public.profiles p where p.id = v_user and p.is_active;
  if v_role is null or v_role not in ('OWNER','ADMIN','FINANCE') then
    raise exception using errcode='P0001',
      message='ACCESS_DENIED: hanya OWNER, ADMIN, atau FINANCE boleh membatalkan kwitansi';
  end if;
  select * into v_receipt from public.clinic_payment_receipts where id = p_receipt_id for update;
  if not found or not public.user_can_access_branch(v_receipt.branch_id) then
    raise exception using errcode='P0001', message='ACCESS_DENIED: kwitansi tidak ditemukan atau cabang tidak diizinkan';
  end if;
  if v_receipt.status = 'batal' then
    if v_receipt.void_request_key is distinct from v_key then
      raise exception using errcode='P0001', message='RECEIPT_VOIDED: kwitansi sudah dibatalkan';
    end if;
    return v_receipt.id;
  end if;
  select s.* into v_shift from public.cashier_shifts s
  where s.branch_id = v_receipt.branch_id and s.opened_by = v_user
    and s.shift_type = 'klinik' and s.status = 'open' for update;
  if not found then
    raise exception using errcode='P0001', message='SHIFT_INVALID: shift klinik aktif tidak ditemukan';
  end if;
  select * into v_adv from public.clinic_customer_advances
  where receipt_id = p_receipt_id and status = 'aktif' for update;
  if found and v_adv.applied > 0 then
    -- Pesan ini menunjuk jalan keluar yang benar-benar ada: lepas dulu pemakaiannya
    -- lewat clinic_release_advance_application (OWNER/ADMIN/FINANCE, beralasan,
    -- berjejak), baru kwitansinya bisa dibatalkan. Jangan memulangkan pasien palsu.
    raise exception using errcode='P0001',
      message='ADVANCE_USED: lepas dulu pemakaian uang muka kwitansi ini, baru batalkan';
  end if;

  for v_row in
    select p.*, i.voided_at as invoice_voided
    from public.invoice_payments p
    join public.invoices i on i.id = p.invoice_id
    where p.receipt_id = p_receipt_id and p.reversal_of is null and p.amount > 0
    order by p.created_at, p.id
  loop
    -- Terbit ulang mem-void tagihan lama dan menyalin pembayarannya. Pembalik harus
    -- mengenai dokumen yang masih hidup, dan hanya SEKALI untuk tiap rupiah.
    v_target := clinic_private.active_invoice(v_row.invoice_id);
    if v_row.invoice_voided is not null and v_target is not null
       and exists (select 1 from public.invoice_payments q
         where q.receipt_id = p_receipt_id and q.reversal_of is null and q.amount > 0
           and q.invoice_id = v_target) then
      continue;
    end if;
    v_target := coalesce(v_target, v_row.invoice_id);
    insert into public.invoice_payments(
      invoice_id, tanggal, amount, metode, catatan, kas_code, created_by, receipt_id, reversal_of
    ) values (
      v_target, current_date, -v_row.amount, v_row.metode,
      'Pembatalan kwitansi ' || v_receipt.no_kwitansi, v_row.kas_code, v_user, p_receipt_id, v_row.id
    );
    perform public.clinic_write_journal(current_date,
      'Pembatalan pembayaran ' || v_receipt.no_kwitansi, 'klinik-ar',
      (select i.invoice_no from public.invoices i where i.id = v_target), v_receipt.branch_id,
      jsonb_build_array(
        jsonb_build_object('code','1201','debit',v_row.amount,'credit',0),
        jsonb_build_object('code', v_row.kas_code, 'debit', 0, 'credit', v_row.amount)));
    perform clinic_private.sync_paid_status(v_target);
    update public.visits set status = 'Pembayaran'
    where id = (select i.visit_id from public.invoices i where i.id = v_target)
      and status = 'Selesai'
      and exists (select 1 from public.invoices i2 where i2.visit_id = visits.id
        and i2.voided_at is null and i2.paid_status <> 'Lunas');
  end loop;

  if v_adv.id is not null then
    update public.clinic_customer_advances set status = 'batal' where id = v_adv.id;
    -- Uang muka adalah SISA tiap bagian kwitansi setelah dipakai melunasi tagihan.
    -- Pembaliknya harus mengkredit rekening sisa itu, bukan rekening bagian pertama:
    -- jurnal yang seimbang tetapi salah rekening membuat saldo Kas dan Bank meleset.
    select coalesce(jsonb_agg(jsonb_build_object('code', t.kas_code, 'debit', 0, 'credit', t.sisa)
             order by t.kas_code), '[]'::jsonb),
           coalesce(sum(t.sisa), 0)
      into v_lines, v_sisa_total
    from (
      select pt.kas_code,
        sum(pt.amount) - coalesce((select sum(p.amount) from public.invoice_payments p
          where p.receipt_id = p_receipt_id and p.reversal_of is null and p.amount > 0
            and p.kas_code = pt.kas_code), 0) as sisa
      from public.clinic_payment_receipt_parts pt
      where pt.receipt_id = p_receipt_id
      group by pt.kas_code
    ) t where t.sisa > 0;
    if v_sisa_total is distinct from v_adv.amount then
      raise exception using errcode='P0001',
        message='ADVANCE_IMBALANCE: sisa per rekening tidak cocok dengan saldo uang muka';
    end if;
    perform public.clinic_write_journal(current_date, 'Pembatalan uang muka ' || v_adv.no_uang_muka,
      'klinik-uang-muka-batal', v_adv.no_uang_muka, v_receipt.branch_id,
      jsonb_build_array(jsonb_build_object('code','2103','debit',v_adv.amount,'credit',0)) || v_lines);
  end if;

  update public.clinic_payment_receipts set status = 'batal', void_reason = v_reason,
    void_request_key = v_key, void_shift_id = v_shift.id, voided_by = v_user, voided_at = now()
  where id = p_receipt_id;
  return v_receipt.id;
end;
$function$;
revoke all on function public.clinic_void_payment_receipt(uuid, text, text) from public, anon, service_role;
grant execute on function public.clinic_void_payment_receipt(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Penjaga tagih-sekali yang juga menangkap duplikat di SATU tagihan (FIN-07)
-- ---------------------------------------------------------------------------
-- Penjaga BEFORE INSERT yang ada sengaja mengecualikan invoice yang sama: koreksi
-- tagihan (clinic_edit_invoice_core) menyisipkan baris baru LEBIH DULU, baru menghapus
-- baris lamanya, jadi dalam sekejap ada dua baris dengan sumber resep sama di invoice
-- yang sama. Karena itu duplikatnya diperiksa pada akhir transaksi: koreksi yang sah
-- lolos, sedangkan payload berisi dua salinan baris resep membatalkan seluruh
-- transaksi (invoice, stok, HPP, jurnal) sekaligus.
create function public.guard_invoice_item_billed_once_final() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if new.prescription_item_id is null then return null; end if;
  if (select count(*) from public.invoice_items ii
      join public.invoices i on i.id = ii.invoice_id
      where ii.prescription_item_id = new.prescription_item_id and i.voided_at is null) > 1 then
    raise exception using errcode='P0001',
      message=format('LINE_BILLED: %s sudah masuk tagihan aktif lain', coalesce(new.deskripsi, 'baris resep'));
  end if;
  return null;
end;
$function$;
revoke all on function public.guard_invoice_item_billed_once_final()
  from public, anon, authenticated, service_role;
create constraint trigger guard_invoice_item_billed_once_final
  after insert on public.invoice_items deferrable initially deferred
  for each row execute function public.guard_invoice_item_billed_once_final();

-- ---------------------------------------------------------------------------
-- 10. Tambalan pada RPC yang sudah berjalan
-- ---------------------------------------------------------------------------
do $patch$
declare p record; definition text; signature regprocedure; pending jsonb := '{}'::jsonb; k text;
begin
 for p in select * from (values
  -- FIN-06/ACCESS-02: penundaan uang muka minimal tidak boleh berasal dari isi
  -- permintaan. Hanya konteks internal (tahap/split/DEMO) yang boleh menundanya.
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'  if not coalesce((p_invoice ->> ''min_dp_deferred'')::boolean, false)\n     and not (p_invoice ? ''split_payments'') then\n    perform clinic_private.enforce_min_dp(v_invoice_id, p_invoice ->> ''dp_override_reason'');\n  end if;',
   E'  if not clinic_private.dp_deferred(p_visit_id) then\n    perform clinic_private.enforce_min_dp(v_invoice_id, p_invoice ->> ''dp_override_reason'');\n  end if;'),
  -- FIN-07: dua salinan baris resep dalam satu payload ditolak sebelum stok bergerak.
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'    raise exception using errcode = ''P0001'', message = ''RECIPE_LINKED: racikan tercantum lebih dari sekali'';\n  end if;',
   E'    raise exception using errcode = ''P0001'', message = ''RECIPE_LINKED: racikan tercantum lebih dari sekali'';\n  end if;\n\n  if exists (\n    select 1 from jsonb_array_elements(p_lines) as e(value)\n    where nullif(e.value ->> ''prescription_item_id'', '''') is not null\n    group by e.value ->> ''prescription_item_id'' having count(*) > 1\n  ) then\n    raise exception using errcode = ''P0001'', message = ''LINE_BILLED: baris resep tercantum lebih dari sekali dalam satu tagihan'';\n  end if;'),
  -- FIN-06: checkout campuran membuka konteks internal, bukan menitipkan kunci JSON.
  ('public.clinic_post_split_invoice(uuid,text,jsonb,jsonb,jsonb)',
   E'  v_invoice_id := public.clinic_post_invoice(p_visit_id,v_key,v_base,p_lines);',
   E'  perform clinic_private.context_begin(''split'',p_visit_id);\n  v_invoice_id := public.clinic_post_invoice(p_visit_id,v_key,v_base,p_lines);\n  perform clinic_private.context_end();'),
  -- Setelah seluruh bagian pembayaran tersimpan, minimumnya tetap diperiksa.
  ('public.clinic_post_split_invoice(uuid,text,jsonb,jsonb,jsonb)',
   E'  perform public.set_visit_service_state(p_visit_id,''checkout'');\n  return v_invoice_id;',
   E'  perform clinic_private.enforce_min_dp(v_invoice_id,p_invoice ->> ''dp_override_reason'');\n  perform public.set_visit_service_state(p_visit_id,''checkout'');\n  return v_invoice_id;'),
  -- Checkout DEMO juga memposting "Belum Lunas" lalu membayar penuh sesudahnya; tanpa
  -- konteks internal ia tertahan DP_MINIMAL sejak #339.
  ('public.clinic_post_demo_invoice(uuid,text,jsonb,jsonb,uuid,jsonb,uuid[])',
   E'  v_id:=public.clinic_post_invoice(p_visit_id,v_key,v_invoice,v_lines);',
   E'  perform clinic_private.context_begin(''demo'',p_visit_id);\n  v_id:=public.clinic_post_invoice(p_visit_id,v_key,v_invoice,v_lines);\n  perform clinic_private.context_end();'),
  -- FIN-05: uang tagihan tahap rawat inap hanya boleh masuk lewat kwitansi kunjungan
  -- di dalam shift klinik, bukan lewat layar piutang yang tidak membuat kwitansi.
  ('public.clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text)',
   E'    raise exception using errcode=''P0001'', message=''PAYMENT_INVALID: selesaikan koreksi tagihan sebelum menerima pembayaran'';\n  end if;',
   E'    raise exception using errcode=''P0001'', message=''PAYMENT_INVALID: selesaikan koreksi tagihan sebelum menerima pembayaran'';\n  end if;\n  if v_invoice.stage_billing then\n    raise exception using errcode=''P0001'', message=''STAGE_RECEIPT: terima uang tagihan tahap lewat layar Tagihan rawat inap'';\n  end if;'),
  -- FIN-04: pelunasan sebagian lewat piutang juga harus memindahkan status ke DP.
  ('public.clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text)',
   E'  if p_amount = v_remaining then\n    update public.invoices set paid_status=''Lunas'', paid_at=now()\n    where id = p_invoice_id;',
   E'  perform clinic_private.sync_paid_status(p_invoice_id);\n  if p_amount = v_remaining then'),
  -- FIN-02: kwitansi ikut pindah ke pembayaran tagihan pengganti.
  ('public.clinic_void_reissue_invoice_core(uuid,text,text)',
   E'    insert into public.invoice_payments(invoice_id,tanggal,amount,metode,catatan,\n      kas_code,created_by,transferred_from,checkout_payment)\n    select v_new_id,current_date,p.amount,p.metode,\n      ''Dialihkan dari ''||v_invoice.invoice_no,p.kas_code,v_user,p_invoice_id,p.checkout_payment\n    from public.invoice_payments p where p.invoice_id=p_invoice_id;',
   E'    insert into public.invoice_payments(invoice_id,tanggal,amount,metode,catatan,\n      kas_code,created_by,transferred_from,checkout_payment,receipt_id,reversal_of)\n    select v_new_id,current_date,p.amount,p.metode,\n      ''Dialihkan dari ''||v_invoice.invoice_no,p.kas_code,v_user,p_invoice_id,p.checkout_payment,\n      p.receipt_id,p.reversal_of\n    from public.invoice_payments p where p.invoice_id=p_invoice_id;'),
  -- FIN-03: tagihan tahap pasien yang MASIH dirawat boleh diterbitkan ulang. Konteks
  -- tahap dibuka hanya untuk baris invoice penggantinya, lalu ditutup lagi.
  ('public.clinic_void_reissue_invoice_core(uuid,text,text)',
   E'  update public.invoices set voided_at=now() where id=p_invoice_id;\n  insert into public.invoices(visit_id,invoice_no,subtotal,discount,tax,total,dp_amount,',
   E'  update public.invoices set voided_at=now() where id=p_invoice_id;\n  if v_invoice.stage_billing then perform clinic_private.context_begin(''stage'',v_visit.id); end if;\n  insert into public.invoices(visit_id,invoice_no,subtotal,discount,tax,total,dp_amount,'),
  ('public.clinic_void_reissue_invoice_core(uuid,text,text)',
   E'  returning id into v_new_id;\n  insert into public.invoice_items(invoice_id,deskripsi,qty,harga,jenis,diskon_persen,',
   E'  returning id into v_new_id;\n  if v_invoice.stage_billing then\n    perform clinic_private.context_end();\n    update public.invoices set stage_billing=true where id=v_new_id;\n  end if;\n  insert into public.invoice_items(invoice_id,deskripsi,qty,harga,jenis,diskon_persen,'),
  -- UF-04: hari rawat tidak dihitung ulang kalau petugas sudah mencatat jasa rawat
  -- inapnya sendiri. Kompatibilitas data lama (belum ada tagihan DAN belum ada baris
  -- Rawat Inap) tetap dipertahankan.
  ('public.clinic_change_inpatient_condition(uuid,text,text)',
   E'  if v_discharged_at is not null and not exists(select 1 from public.invoices i\n      where i.visit_id=v_record.visit_id and i.request_key is not null) then\n    select * into v_tariff from public.items',
   E'  if v_discharged_at is not null and not exists(select 1 from public.invoices i\n      where i.visit_id=v_record.visit_id and i.request_key is not null)\n     and not exists(select 1 from public.prescription_items pi\n      join public.medical_records mr on mr.id=pi.medical_record_id\n      where mr.visit_id=v_record.visit_id and pi.kategori=''Rawat Inap'') then\n    select * into v_tariff from public.items')
 ) as patches(sig, old_text, new_text) loop
  signature := to_regprocedure(p.sig);
  if signature is null then raise exception 'Mitigasi ranap: RPC wajib tidak ada: %', p.sig; end if;
  definition := coalesce(pending ->> p.sig, pg_get_functiondef(signature));
  if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then
   raise exception 'Mitigasi ranap: jangkar harus muncul tepat sekali di %; periksa definisi sebelum menerapkan', p.sig;
  end if;
  pending := jsonb_set(pending, array[p.sig], to_jsonb(replace(definition, p.old_text, p.new_text)));
 end loop;
 for k in select jsonb_object_keys(pending) loop
  execute pending ->> k;
 end loop;
end $patch$;

-- Hak akses fungsi yang ditambal tidak berubah; ditegaskan ulang karena CREATE OR
-- REPLACE mempertahankan pemilik tetapi migrasi ini harus eksplisit.
revoke all on function public.clinic_post_invoice(uuid, text, jsonb, jsonb) from public, anon, service_role;
grant execute on function public.clinic_post_invoice(uuid, text, jsonb, jsonb) to authenticated;
revoke all on function public.clinic_post_split_invoice(uuid,text,jsonb,jsonb,jsonb) from public, anon, service_role;
grant execute on function public.clinic_post_split_invoice(uuid,text,jsonb,jsonb,jsonb) to authenticated;
revoke all on function public.clinic_post_demo_invoice(uuid,text,jsonb,jsonb,uuid,jsonb,uuid[])
  from public, anon, service_role;
grant execute on function public.clinic_post_demo_invoice(uuid,text,jsonb,jsonb,uuid,jsonb,uuid[]) to authenticated;
revoke all on function public.clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text)
  from public, anon, service_role;
grant execute on function public.clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text) to authenticated;
revoke all on function public.clinic_void_reissue_invoice_core(uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.clinic_change_inpatient_condition(uuid,text,text) from public, anon, service_role;
grant execute on function public.clinic_change_inpatient_condition(uuid,text,text) to authenticated;
