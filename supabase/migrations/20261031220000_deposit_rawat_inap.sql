-- Deposit rawat inap — keputusan pemilik lewat Andri, 29 Oktober 2026 ("OK deposit ranap").
--
-- Selama pasien dirawat, pemilik boleh menitipkan uang. Titipan itu BUKAN omzet:
-- kas bertambah dan utang klinik ke pemilik (2103 Uang Muka Penjualan, akun yang
-- sama dengan Uang Muka Penjualan grosir) ikut bertambah. Saat pasien pulang dan
-- tagihan terbit, sisa titipan otomatis memotong tagihan: utang turun, piutang
-- lunas — bukan penerimaan kas kedua.
--
-- Penjaga INPATIENT_OPEN (20260929120000) TIDAK disentuh: deposit sengaja tidak
-- menerbitkan invoice, jadi pasien yang masih dirawat tetap tidak bisa difakturkan.
--
-- Posting tagihan memakai pembungkus clinic_post_invoice_with_deposit, bukan
-- tambalan pada clinic_post_invoice: tanda tangan RPC lama tetap utuh untuk
-- aplikasi yang sudah berjalan. Hanya clinic_void_reissue_invoice_core yang
-- ditambal (dengan jangkar eksak, gagal tertutup) supaya pembatalan tagihan
-- mengembalikan deposit ke saldo pemilik.

-- ---------------------------------------------------------------------------
-- 1. Tabel
-- ---------------------------------------------------------------------------

create table public.inpatient_deposits (
  id uuid primary key default gen_random_uuid(),
  no_deposit text not null unique,
  visit_id uuid not null references public.visits(id),
  inpatient_record_id uuid not null references public.inpatient_records(id),
  customer_id uuid references public.customers(id),
  branch_id uuid not null references public.branches(id),
  shift_id uuid references public.cashier_shifts(id),
  tanggal date not null default current_date,
  jumlah numeric(15,2) not null check (jumlah > 0),
  terpakai numeric(15,2) not null default 0 check (terpakai >= 0),
  dikembalikan numeric(15,2) not null default 0 check (dikembalikan >= 0),
  metode text not null check (metode in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet')),
  kas_code text not null,
  catatan text,
  status text not null default 'aktif' check (status in ('aktif','batal')),
  journal_id uuid references public.journal_entries(id),
  request_key text not null,
  request_hash text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  -- Pembatalan: hanya selama belum terpakai sama sekali. Barisnya tetap disimpan.
  voided_at timestamptz,
  void_reason text,
  voided_by uuid references auth.users(id),
  void_shift_id uuid references public.cashier_shifts(id),
  void_request_key text,
  -- Pengembalian sisa: boleh setelah sebagian terpakai, sekali per deposit.
  refunded_at timestamptz,
  refund_reason text,
  refunded_by uuid references auth.users(id),
  refund_shift_id uuid references public.cashier_shifts(id),
  refund_request_key text,
  constraint inpatient_deposits_saldo_wajar check (terpakai + dikembalikan <= jumlah)
);
create unique index inpatient_deposits_request_key_unique on public.inpatient_deposits(request_key);
create unique index inpatient_deposits_void_key_unique on public.inpatient_deposits(void_request_key)
  where void_request_key is not null;
create unique index inpatient_deposits_refund_key_unique on public.inpatient_deposits(refund_request_key)
  where refund_request_key is not null;
create index inpatient_deposits_visit_idx on public.inpatient_deposits(visit_id);
create index inpatient_deposits_record_idx on public.inpatient_deposits(inpatient_record_id);
create index inpatient_deposits_shift_idx on public.inpatient_deposits(shift_id);

-- Satu tagihan bisa menyerap beberapa deposit; satu deposit bisa terpakai di
-- beberapa tagihan (mis. setelah terbit ulang). Barisnya tidak pernah dihapus:
-- pelepasan ditandai released_at supaya jejaknya tetap terbaca.
create table public.inpatient_deposit_applications (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references public.inpatient_deposits(id),
  invoice_id uuid not null references public.invoices(id),
  payment_id uuid references public.invoice_payments(id),
  amount numeric(15,2) not null check (amount > 0),
  request_key text not null unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text
);
create index inpatient_deposit_applications_invoice_idx on public.inpatient_deposit_applications(invoice_id);
create index inpatient_deposit_applications_deposit_idx on public.inpatient_deposit_applications(deposit_id);

alter table public.inpatient_deposits enable row level security;
alter table public.inpatient_deposit_applications enable row level security;
revoke all on public.inpatient_deposits from public, anon, authenticated;
revoke all on public.inpatient_deposit_applications from public, anon, authenticated;
grant select on public.inpatient_deposits to authenticated;
grant select on public.inpatient_deposit_applications to authenticated;

-- Dibaca seperti invoice: pengguna yang berhak atas cabangnya. Semua penulisan
-- hanya lewat RPC SECURITY DEFINER di bawah.
create policy inpdep_sel on public.inpatient_deposits for select to authenticated
  using (public.user_can_access_branch(branch_id));
create policy inpdepapp_sel on public.inpatient_deposit_applications for select to authenticated
  using (exists (
    select 1 from public.inpatient_deposits d
    where d.id = inpatient_deposit_applications.deposit_id
      and public.user_can_access_branch(d.branch_id)));

-- ---------------------------------------------------------------------------
-- 2. Penolong internal
-- ---------------------------------------------------------------------------
create schema if not exists clinic_private;
revoke all on schema clinic_private from public, anon, authenticated, service_role;

-- Rekening penerimaan per metode & cabang — aturan sama persis dengan posting
-- tagihan klinik (peta cabang → peta pusat → bawaan 1101/1102).
create function clinic_private.deposit_cash_account(p_metode text, p_branch uuid)
returns text language plpgsql stable set search_path = '' as $$
declare v_code text; v_active boolean;
begin
  select ca.coa_code, ca.is_active into v_code, v_active
  from public.payment_account_map pam
  join public.cash_accounts ca on ca.id = pam.cash_account_id
  where pam.metode = p_metode and pam.branch_id = p_branch limit 1;
  if v_code is null then
    select ca.coa_code, ca.is_active into v_code, v_active
    from public.payment_account_map pam
    join public.cash_accounts ca on ca.id = pam.cash_account_id
    where pam.metode = p_metode and pam.branch_id is null limit 1;
  end if;
  if v_code is not null and v_active is distinct from true then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_INVALID: rekening pembayaran tidak aktif';
  end if;
  if v_code is null then
    v_code := case when p_metode = 'Tunai' then '1101' else '1102' end;
  end if;
  if not exists (select 1 from public.coa_accounts a where a.code = v_code and a.is_active and not a.is_header) then
    raise exception using errcode = 'P0001', message = format('ACCOUNT_INVALID: akun penerimaan %s tidak tersedia', v_code);
  end if;
  return v_code;
end $$;
revoke all on function clinic_private.deposit_cash_account(text, uuid) from public, anon, authenticated, service_role;

-- Nomor dokumen deposit, memakai format yang bisa diatur sendiri (jenis DEP).
-- Dikunci per awalan seperti nomor invoice, jadi dua kasir berbarengan tidak
-- pernah mendapat nomor yang sama.
create function clinic_private.deposit_next_no(p_tanggal date)
returns text language plpgsql set search_path = '' as $$
declare v_pattern text; v_digits integer := 4; v_prefix text; v_seq bigint; v_no text;
begin
  select n.pola, n.digit into v_pattern, v_digits
  from public.document_numbering n where n.jenis = 'DEP';
  if not found then v_pattern := 'DEP-{YYYY}{MM}{DD}-'; v_digits := 4; end if;
  v_prefix := replace(replace(replace(replace(v_pattern, '{YYYY}', to_char(p_tanggal, 'YYYY')),
    '{YY}', to_char(p_tanggal, 'YY')), '{MM}', to_char(p_tanggal, 'MM')), '{DD}', to_char(p_tanggal, 'DD'));
  if v_prefix ~ '\{[^}]+\}' or length(v_prefix) = 0 then
    raise exception using errcode = 'P0001', message = 'DEPOSIT_NO_INVALID: format nomor deposit tidak valid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('clinic-deposit-number:' || v_prefix, 0));
  select coalesce(max(substring(d.no_deposit, length(v_prefix) + 1)::bigint), 0) + 1 into v_seq
  from public.inpatient_deposits d
  where left(d.no_deposit, length(v_prefix)) = v_prefix
    and substring(d.no_deposit, length(v_prefix) + 1) ~ '^[0-9]+$';
  v_no := v_prefix || case when length(v_seq::text) > v_digits then v_seq::text
    else lpad(v_seq::text, v_digits, '0') end;
  if length(v_no) > 32 then
    raise exception using errcode = 'P0001', message = 'DEPOSIT_NO_INVALID: nomor deposit melebihi batas';
  end if;
  return v_no;
end $$;
revoke all on function clinic_private.deposit_next_no(date) from public, anon, authenticated, service_role;

-- Shift klinik milik pengguna ini yang masih terbuka di cabang tersebut.
-- Uang titipan masuk laci kasir, jadi tanpa shift terbuka kas fisik tidak pernah
-- cocok saat tutup shift.
create function clinic_private.deposit_open_shift(p_branch uuid)
returns uuid language sql stable set search_path = '' as $$
  select s.id from public.cashier_shifts s
  where s.branch_id = p_branch and s.opened_by = auth.uid()
    and s.shift_type = 'klinik' and s.status = 'open'
  order by s.opened_at desc limit 1;
$$;
revoke all on function clinic_private.deposit_open_shift(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Catat deposit
-- ---------------------------------------------------------------------------
create function public.clinic_record_inpatient_deposit(
  p_record_id uuid, p_request_key text, p_tanggal date, p_amount numeric,
  p_metode text, p_catatan text
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_active boolean;
  v_record public.inpatient_records%rowtype;
  v_visit public.visits%rowtype;
  v_key text := nullif(btrim(p_request_key), '');
  v_catatan text := nullif(btrim(p_catatan), '');
  v_amount numeric(15,2);
  v_hash text;
  v_existing public.inpatient_deposits%rowtype;
  v_shift uuid;
  v_kas text;
  v_no text;
  v_entry uuid;
  v_id uuid;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(auth.role(), '')) is distinct from 'authenticated'
     or v_user is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  select p.role, p.is_active into v_role, v_active from public.profiles p where p.id = v_user;
  if v_role is null or v_active is distinct from true then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: akun tidak aktif';
  end if;
  if v_key is null or length(v_key) > 100 then
    raise exception using errcode = 'P0001', message = 'DEPOSIT_INVALID: kunci permintaan tidak valid';
  end if;
  v_amount := round(coalesce(p_amount, 0), 2);
  if p_amount is null or v_amount <> p_amount or v_amount <= 0 or v_amount > 1000000000000
     or p_metode not in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet')
     or p_tanggal is null or length(coalesce(v_catatan, '')) > 300 then
    raise exception using errcode = 'P0001', message = 'DEPOSIT_INVALID: nominal, metode, atau tanggal deposit tidak valid';
  end if;

  v_hash := md5(jsonb_build_object('record', p_record_id, 'tanggal', p_tanggal,
    'amount', v_amount, 'metode', p_metode, 'catatan', v_catatan)::text);
  perform pg_advisory_xact_lock(hashtextextended('clinic-deposit-request:' || v_key, 0));
  select * into v_existing from public.inpatient_deposits where request_key = v_key for update;
  if found then
    if v_existing.inpatient_record_id is distinct from p_record_id
       or v_existing.request_hash is distinct from v_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci deposit dipakai untuk data berbeda';
    end if;
    if not public.user_can_access_branch(v_existing.branch_id) then
      raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang tidak diizinkan';
    end if;
    return v_existing.id;
  end if;

  select * into v_record from public.inpatient_records where id = p_record_id for update;
  if not found or not public.user_can_access_branch(v_record.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: rawat inap tidak dapat diakses';
  end if;
  -- Titipan hanya selama pasien MASIH dirawat; setelah pulang uangnya adalah
  -- pembayaran tagihan biasa lewat layar Pembayaran, bukan deposit baru.
  if v_record.discharged_at is not null then
    raise exception using errcode = 'P0001', message = 'DEPOSIT_CLOSED: pasien sudah pulang — terima uangnya di layar pembayaran';
  end if;
  select * into v_visit from public.visits where id = v_record.visit_id for update;
  if not found or v_visit.branch_id is distinct from v_record.branch_id then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang kunjungan tidak cocok';
  end if;

  v_shift := clinic_private.deposit_open_shift(v_record.branch_id);
  if v_shift is null then
    raise exception using errcode = 'P0001', message = 'SHIFT_INVALID: shift klinik aktif tidak ditemukan';
  end if;
  v_kas := clinic_private.deposit_cash_account(p_metode, v_record.branch_id);
  v_no := clinic_private.deposit_next_no(p_tanggal);

  insert into public.inpatient_deposits(
    no_deposit, visit_id, inpatient_record_id, customer_id, branch_id, shift_id,
    tanggal, jumlah, metode, kas_code, catatan, request_key, request_hash, created_by
  ) values (
    v_no, v_visit.id, p_record_id, v_visit.customer_id, v_record.branch_id, v_shift,
    p_tanggal, v_amount, p_metode, v_kas, v_catatan, v_key, v_hash, v_user
  ) returning id into v_id;

  -- Titipan bukan pendapatan: kas naik, utang ke pemilik naik.
  v_entry := public.clinic_write_journal(p_tanggal, 'Deposit rawat inap ' || v_no,
    'klinik-deposit', v_no, v_record.branch_id,
    jsonb_build_array(
      jsonb_build_object('code', v_kas, 'debit', v_amount, 'credit', 0),
      jsonb_build_object('code', '2103', 'debit', 0, 'credit', v_amount)));
  if v_entry is null then
    raise exception using errcode = 'P0001', message = 'JOURNAL_MISSING: jurnal deposit tidak terbentuk';
  end if;
  update public.inpatient_deposits set journal_id = v_entry where id = v_id;
  return v_id;
end;
$function$;
revoke all on function public.clinic_record_inpatient_deposit(uuid,text,date,numeric,text,text)
  from public, anon, service_role;
grant execute on function public.clinic_record_inpatient_deposit(uuid,text,date,numeric,text,text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Batal & kembalikan
-- ---------------------------------------------------------------------------
create function public.clinic_cancel_inpatient_deposit(
  p_deposit_id uuid, p_request_key text, p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_role text; v_active boolean;
  v_dep public.inpatient_deposits%rowtype;
  v_key text := nullif(btrim(p_request_key), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_shift uuid;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(auth.role(), '')) is distinct from 'authenticated'
     or v_user is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  select p.role, p.is_active into v_role, v_active from public.profiles p where p.id = v_user;
  if v_role is null or v_active is distinct from true or v_role not in ('OWNER','ADMIN','FINANCE') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pembatalan deposit hanya untuk pemilik, admin, atau keuangan';
  end if;
  if v_key is null or length(v_key) > 100 or v_reason is null or length(v_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'DEPOSIT_INVALID: alasan pembatalan wajib diisi';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('clinic-deposit-void:' || v_key, 0));
  select * into v_dep from public.inpatient_deposits where void_request_key = v_key for update;
  if found then
    if v_dep.id is distinct from p_deposit_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci pembatalan dipakai untuk data berbeda';
    end if;
    if not public.user_can_access_branch(v_dep.branch_id) then
      raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang tidak diizinkan';
    end if;
    return v_dep.id;
  end if;
  select * into v_dep from public.inpatient_deposits where id = p_deposit_id for update;
  if not found or not public.user_can_access_branch(v_dep.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: deposit tidak dapat diakses';
  end if;
  -- Deposit yang sudah menempel di tagihan hanya boleh dibalik lewat void tagihan.
  if v_dep.status <> 'aktif' or v_dep.terpakai <> 0 or v_dep.dikembalikan <> 0 then
    raise exception using errcode = 'P0001', message = 'DEPOSIT_USED: deposit sudah terpakai atau sudah dibatalkan — batalkan lewat tagihannya';
  end if;
  v_shift := clinic_private.deposit_open_shift(v_dep.branch_id);
  if v_shift is null then
    raise exception using errcode = 'P0001', message = 'SHIFT_INVALID: shift klinik aktif tidak ditemukan';
  end if;

  perform public.clinic_write_journal(current_date, 'Pembatalan deposit ' || v_dep.no_deposit,
    'klinik-deposit-batal', v_dep.no_deposit, v_dep.branch_id,
    jsonb_build_array(
      jsonb_build_object('code', '2103', 'debit', v_dep.jumlah, 'credit', 0),
      jsonb_build_object('code', v_dep.kas_code, 'debit', 0, 'credit', v_dep.jumlah)));
  update public.inpatient_deposits set status = 'batal', voided_at = now(), void_reason = v_reason,
    voided_by = v_user, void_shift_id = v_shift, void_request_key = v_key
  where id = p_deposit_id;
  return p_deposit_id;
end;
$function$;
revoke all on function public.clinic_cancel_inpatient_deposit(uuid,text,text) from public, anon, service_role;
grant execute on function public.clinic_cancel_inpatient_deposit(uuid,text,text) to authenticated;

create function public.clinic_refund_inpatient_deposit(
  p_deposit_id uuid, p_request_key text, p_reason text
) returns numeric language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_role text; v_active boolean;
  v_dep public.inpatient_deposits%rowtype;
  v_key text := nullif(btrim(p_request_key), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_shift uuid;
  v_sisa numeric(15,2);
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(auth.role(), '')) is distinct from 'authenticated'
     or v_user is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  select p.role, p.is_active into v_role, v_active from public.profiles p where p.id = v_user;
  if v_role is null or v_active is distinct from true or v_role not in ('OWNER','ADMIN','FINANCE') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengembalian deposit hanya untuk pemilik, admin, atau keuangan';
  end if;
  if v_key is null or length(v_key) > 100 or v_reason is null or length(v_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'DEPOSIT_INVALID: alasan pengembalian wajib diisi';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('clinic-deposit-refund:' || v_key, 0));
  select * into v_dep from public.inpatient_deposits where refund_request_key = v_key for update;
  if found then
    if v_dep.id is distinct from p_deposit_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci pengembalian dipakai untuk data berbeda';
    end if;
    if not public.user_can_access_branch(v_dep.branch_id) then
      raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang tidak diizinkan';
    end if;
    return v_dep.dikembalikan;
  end if;
  select * into v_dep from public.inpatient_deposits where id = p_deposit_id for update;
  if not found or not public.user_can_access_branch(v_dep.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: deposit tidak dapat diakses';
  end if;
  v_sisa := v_dep.jumlah - v_dep.terpakai - v_dep.dikembalikan;
  if v_dep.status <> 'aktif' or v_sisa <= 0 then
    raise exception using errcode = 'P0001', message = 'DEPOSIT_EMPTY: tidak ada sisa deposit yang bisa dikembalikan';
  end if;
  v_shift := clinic_private.deposit_open_shift(v_dep.branch_id);
  if v_shift is null then
    raise exception using errcode = 'P0001', message = 'SHIFT_INVALID: shift klinik aktif tidak ditemukan';
  end if;

  perform public.clinic_write_journal(current_date, 'Pengembalian sisa deposit ' || v_dep.no_deposit,
    'klinik-deposit-kembali', v_dep.no_deposit, v_dep.branch_id,
    jsonb_build_array(
      jsonb_build_object('code', '2103', 'debit', v_sisa, 'credit', 0),
      jsonb_build_object('code', v_dep.kas_code, 'debit', 0, 'credit', v_sisa)));
  update public.inpatient_deposits set dikembalikan = dikembalikan + v_sisa, refunded_at = now(),
    refund_reason = v_reason, refunded_by = v_user, refund_shift_id = v_shift, refund_request_key = v_key
  where id = p_deposit_id;
  return v_sisa;
end;
$function$;
revoke all on function public.clinic_refund_inpatient_deposit(uuid,text,text) from public, anon, service_role;
grant execute on function public.clinic_refund_inpatient_deposit(uuid,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Pakai deposit pada tagihan
-- ---------------------------------------------------------------------------
-- Satu baris invoice_payments bermetode 'Deposit' dengan rekening 2103 mewakili
-- seluruh potongan deposit pada tagihan itu. Dengan begitu semua perhitungan sisa
-- piutang yang sudah ada (layar piutang, pelunasan, aging) ikut benar tanpa
-- diubah, dan tutup shift tidak menghitungnya sebagai uang laci (kas saat terbit
-- tetap dari dp_amount).
create function clinic_private.apply_inpatient_deposit(p_invoice_id uuid, p_request_key text)
returns numeric language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_invoice public.invoices%rowtype;
  v_branch uuid;
  v_key text := nullif(btrim(p_request_key), '');
  v_paid numeric(15,2);
  v_sisa numeric(15,2);
  v_awal numeric(15,2);
  v_applied numeric(15,2) := 0;
  v_take numeric(15,2);
  v_dep record;
  v_pick jsonb;
  v_picks jsonb := '[]'::jsonb;
  v_payment uuid;
  v_existing public.invoice_payments%rowtype;
  v_index integer := 0;
begin
  if v_key is null or length(v_key) > 100 then
    raise exception using errcode = 'P0001', message = 'DEPOSIT_INVALID: kunci pemakaian deposit tidak valid';
  end if;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found or v_invoice.voided_at is not null or v_invoice.invoice_no is null then
    raise exception using errcode = 'P0001', message = 'DEPOSIT_INVALID: tagihan tidak dapat memakai deposit';
  end if;
  select v.branch_id into v_branch from public.visits v where v.id = v_invoice.visit_id;

  select * into v_existing from public.invoice_payments where request_key = v_key for update;
  if found then
    if v_existing.invoice_id is distinct from p_invoice_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci deposit dipakai untuk tagihan berbeda';
    end if;
    return v_existing.amount;
  end if;
  if v_invoice.correction_pending then
    raise exception using errcode = 'P0001', message = 'DEPOSIT_INVALID: selesaikan koreksi tagihan sebelum memakai deposit';
  end if;

  select coalesce(sum(amount), 0) into v_paid from public.invoice_payments where invoice_id = p_invoice_id;
  v_sisa := v_invoice.total - v_invoice.dp_amount - v_paid;
  if v_sisa <= 0 then return 0; end if;
  v_awal := v_sisa;

  for v_dep in
    select d.id, d.jumlah - d.terpakai - d.dikembalikan as saldo
    from public.inpatient_deposits d
    where d.visit_id = v_invoice.visit_id and d.status = 'aktif'
      and d.jumlah - d.terpakai - d.dikembalikan > 0
    order by d.tanggal, d.created_at, d.id
    for update
  loop
    exit when v_sisa <= 0;
    v_take := least(v_dep.saldo, v_sisa);
    if v_take <= 0 then continue; end if;
    update public.inpatient_deposits set terpakai = terpakai + v_take where id = v_dep.id;
    v_picks := v_picks || jsonb_build_array(jsonb_build_object('id', v_dep.id, 'amount', v_take));
    v_applied := v_applied + v_take;
    v_sisa := v_sisa - v_take;
  end loop;
  if v_applied <= 0 then return 0; end if;

  insert into public.invoice_payments(
    invoice_id, tanggal, amount, metode, catatan, kas_code, created_by, request_key, request_hash
  ) values (
    p_invoice_id, current_date, v_applied, 'Deposit', 'Deposit rawat inap dipakai',
    '2103', v_user, v_key, md5(jsonb_build_object('invoice', p_invoice_id, 'deposit', v_applied)::text)
  ) returning id into v_payment;

  for v_pick in select value from jsonb_array_elements(v_picks) loop
    v_index := v_index + 1;
    insert into public.inpatient_deposit_applications(
      deposit_id, invoice_id, payment_id, amount, request_key, created_by
    ) values (
      (v_pick->>'id')::uuid, p_invoice_id, v_payment, (v_pick->>'amount')::numeric,
      v_key || ':' || v_index::text, v_user
    );
  end loop;

  -- Utang titipan turun, piutang tagihan lunas sebesar itu. Bukan kas kedua.
  perform public.clinic_write_journal(current_date,
    'Deposit rawat inap dipakai ' || v_invoice.invoice_no, 'klinik-ar', v_invoice.invoice_no, v_branch,
    jsonb_build_array(
      jsonb_build_object('code', '2103', 'debit', v_applied, 'credit', 0),
      jsonb_build_object('code', '1201', 'debit', 0, 'credit', v_applied)));

  if v_applied >= v_awal then
    update public.invoices set paid_status = 'Lunas', paid_at = now() where id = p_invoice_id;
    perform public.set_visit_service_state(v_invoice.visit_id, 'checkout');
  elsif v_invoice.paid_status = 'Belum Lunas' then
    update public.invoices set paid_status = 'DP' where id = p_invoice_id;
  end if;
  return v_applied;
end;
$function$;
revoke all on function clinic_private.apply_inpatient_deposit(uuid,text) from public, anon, authenticated, service_role;

create function public.clinic_apply_inpatient_deposit(p_invoice_id uuid, p_request_key text)
returns numeric language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_visit public.visits%rowtype;
  v_active boolean;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(auth.role(), '')) is distinct from 'authenticated'
     or v_user is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  select p.is_active into v_active from public.profiles p where p.id = v_user;
  if v_active is distinct from true then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: akun tidak aktif';
  end if;
  select v.* into v_visit from public.visits v
  join public.invoices i on i.visit_id = v.id where i.id = p_invoice_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'DEPOSIT_INVALID: tagihan tidak ditemukan';
  end if;
  perform 1 from public.visits where id = v_visit.id for update;
  if not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang tidak diizinkan';
  end if;
  return clinic_private.apply_inpatient_deposit(p_invoice_id, p_request_key);
end;
$function$;
revoke all on function public.clinic_apply_inpatient_deposit(uuid,text) from public, anon, service_role;
grant execute on function public.clinic_apply_inpatient_deposit(uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Posting tagihan pulang + pakai deposit dalam satu transaksi
-- ---------------------------------------------------------------------------
-- Tanda tangan clinic_post_invoice TIDAK berubah: pembungkus ini menghitung
-- sendiri berapa deposit yang terpakai (server, bukan layar), lalu mengirim
-- status bayar & uang muka yang hanya berisi UANG DI MEJA ke RPC lama.
create function public.clinic_post_invoice_with_deposit(
  p_visit_id uuid, p_request_key text, p_invoice jsonb, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_user uuid := auth.uid();
  v_key text := nullif(btrim(p_request_key), '');
  v_visit public.visits%rowtype;
  v_existing public.invoices%rowtype;
  v_total numeric(15,2);
  v_saldo numeric(15,2);
  v_apply numeric(15,2);
  v_cash numeric(15,2);
  v_status text;
  v_base jsonb;
  v_invoice_id uuid;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(auth.role(), '')) is distinct from 'authenticated'
     or v_user is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: pengguna tidak terautentikasi';
  end if;
  if v_key is null or length(v_key) > 100 or jsonb_typeof(p_invoice) is distinct from 'object' then
    raise exception using errcode = 'P0001', message = 'INVOICE_INVALID: data invoice tidak lengkap';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('clinic-invoice-request:' || v_key, 0));
  -- Pengulangan setelah berhasil: deposit sudah terpakai, jadi menghitung ulang
  -- akan menghasilkan status bayar berbeda dan ditolak sebagai konflik idempotensi.
  -- Karena itu jawabannya diambil dari invoice yang sudah ada, bukan dihitung lagi.
  select i.* into v_existing from public.invoices i where i.request_key = v_key;
  if found then
    if v_existing.visit_id is distinct from p_visit_id then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci invoice telah dipakai untuk data berbeda';
    end if;
    if not exists (select 1 from public.visits v where v.id = v_existing.visit_id
      and public.user_can_access_branch(v.branch_id)) then
      raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: cabang tidak diizinkan';
    end if;
    return v_existing.id;
  end if;
  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found or not public.user_can_access_branch(v_visit.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: kunjungan tidak ditemukan atau cabang tidak diizinkan';
  end if;

  v_total := round(coalesce((p_invoice->>'total')::numeric, 0), 2);
  select round(coalesce(sum(d.jumlah - d.terpakai - d.dikembalikan), 0), 2) into v_saldo
  from public.inpatient_deposits d where d.visit_id = p_visit_id and d.status = 'aktif';
  v_apply := least(greatest(v_saldo, 0), greatest(v_total, 0));
  v_cash := round(coalesce(nullif(p_invoice->>'cash_received', '')::numeric, 0), 2);
  if v_cash < 0 then
    raise exception using errcode = 'P0001', message = 'INVOICE_INVALID: uang diterima tidak boleh negatif';
  end if;
  -- Kembalian bukan pembayaran: uang di meja dibatasi sisa setelah deposit.
  v_cash := least(v_cash, v_total - v_apply);
  v_status := case when v_total > 0 and v_cash >= v_total then 'Lunas'
                   when v_cash > 0 then 'DP' else 'Belum Lunas' end;
  v_base := (p_invoice - 'cash_received') || jsonb_build_object(
    'paid_status', v_status,
    'dp_amount', case when v_status = 'DP' then v_cash else 0 end,
    'dp_date', case when v_status = 'DP'
      then coalesce(nullif(p_invoice->>'dp_date', ''), to_char(current_date, 'YYYY-MM-DD')) end);

  v_invoice_id := public.clinic_post_invoice(p_visit_id, v_key, v_base, p_lines);
  if v_apply > 0 then
    perform clinic_private.apply_inpatient_deposit(v_invoice_id, 'dep:' || md5(v_key));
  end if;
  return v_invoice_id;
end;
$function$;
revoke all on function public.clinic_post_invoice_with_deposit(uuid,text,jsonb,jsonb) from public, anon, service_role;
grant execute on function public.clinic_post_invoice_with_deposit(uuid,text,jsonb,jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Void tagihan mengembalikan deposit ke saldo pemilik
-- ---------------------------------------------------------------------------
create function clinic_private.release_inpatient_deposit(
  p_invoice_id uuid, p_branch uuid, p_invoice_no text, p_reason text
) returns numeric language plpgsql security definer set search_path = '' as $function$
declare v_row record; v_total numeric(15,2) := 0;
begin
  for v_row in
    select a.id, a.deposit_id, a.amount from public.inpatient_deposit_applications a
    where a.invoice_id = p_invoice_id and a.released_at is null
    order by a.created_at, a.id for update
  loop
    update public.inpatient_deposits set terpakai = greatest(terpakai - v_row.amount, 0)
    where id = v_row.deposit_id;
    update public.inpatient_deposit_applications set released_at = now(), release_reason = p_reason
    where id = v_row.id;
    v_total := v_total + v_row.amount;
  end loop;
  if v_total <= 0 then return 0; end if;
  -- Kebalikan dari pemakaian: piutang hidup lagi, utang titipan kembali.
  perform public.clinic_write_journal(current_date,
    'Deposit dikembalikan ke saldo ' || coalesce(p_invoice_no, ''), 'klinik-deposit-lepas',
    coalesce(p_invoice_no, p_invoice_id::text), p_branch,
    jsonb_build_array(
      jsonb_build_object('code', '1201', 'debit', v_total, 'credit', 0),
      jsonb_build_object('code', '2103', 'debit', 0, 'credit', v_total)));
  return v_total;
end;
$function$;
revoke all on function clinic_private.release_inpatient_deposit(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;

do $patch$
-- Semua tambalan satu fungsi diterapkan pada teksnya dulu, baru dikompilasi SEKALI.
declare p record; definition text; signature regprocedure;
begin
 signature := to_regprocedure('public.clinic_void_reissue_invoice_core(uuid,text,text)');
 if signature is null then
   raise exception 'Deposit ranap: RPC pembatalan tagihan tidak ditemukan';
 end if;
 definition := pg_get_functiondef(signature);
 for p in select * from (values
  -- Nilai deposit yang menempel di tagihan ini.
  (E'  v_lines jsonb;\nbegin',
   E'  v_lines jsonb; v_deposit numeric(15,2) := 0;\nbegin'),
  -- v_direct (uang tunai saat terbit) tetap dihitung dari pembayaran TERMASUK
  -- deposit; yang dikurangi hanyalah uang yang dibawa ke tagihan pengganti.
  (E'  v_paid := v_paid + v_direct;\n  if v_paid>v_invoice.total then',
   E'  v_paid := v_paid + v_direct;\n  select coalesce(sum(p.amount),0) into v_deposit from public.invoice_payments p\n    where p.invoice_id=p_invoice_id and p.metode=''Deposit'' and p.transferred_from is null;\n  v_paid := v_paid - v_deposit;\n  if v_paid>v_invoice.total then'),
  -- Deposit dilepas sebelum tagihan ditandai batal, supaya saldonya kembali ke pemilik.
  (E'  update public.invoices set voided_at=now() where id=p_invoice_id;',
   E'  if v_deposit>0 then\n    perform clinic_private.release_inpatient_deposit(p_invoice_id,v_visit.branch_id,v_invoice.invoice_no,v_reason);\n  end if;\n  update public.invoices set voided_at=now() where id=p_invoice_id;'),
  -- Tagihan yang hanya tertutup deposit (tanpa uang tunai) tetap boleh di-void:
  -- tanpa ini ia tidak bisa dikoreksi (ada baris pembayaran) maupun dibatalkan.
  (E'  if v_invoice.paid_status<>\'Lunas\' and v_paid=0 then',
   E'  if v_invoice.paid_status<>\'Lunas\' and v_paid=0 and v_deposit=0 then'),
  -- Baris deposit TIDAK ikut dialihkan: uangnya sudah kembali jadi saldo deposit.
  (E'    from public.invoice_payments p where p.invoice_id=p_invoice_id;',
   E'    from public.invoice_payments p where p.invoice_id=p_invoice_id and p.metode is distinct from ''Deposit'';')
 ) as patches(old_text, new_text) loop
  if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then
   raise exception 'Deposit ranap: jangkar harus muncul tepat sekali di clinic_void_reissue_invoice_core; periksa definisinya';
  end if;
  definition := replace(definition, p.old_text, p.new_text);
 end loop;
 execute definition;
end $patch$;
revoke all on function public.clinic_void_reissue_invoice_core(uuid,text,text)
  from public, anon, authenticated, service_role;

-- Format nomor deposit (jenis DEP) tidak di-seed: tabel penomoran kosong berarti
-- bawaan 'DEP-{YYYY}{MM}{DD}-' dengan 4 digit, sama dengan daftar bawaan aplikasi.
-- Pemilik/admin boleh menimpanya sendiri lewat Pengaturan -> Penomoran Dokumen.
