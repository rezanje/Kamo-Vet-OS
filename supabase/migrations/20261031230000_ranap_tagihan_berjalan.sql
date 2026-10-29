-- Tagihan berjalan rawat inap + uang muka minimal (keputusan Andri, 29 Oktober 2026).
--
-- Sebelum ini pasien yang masih dirawat TIDAK BISA ditagih sama sekali: pemicu
-- guard_open_inpatient_invoice menolak setiap invoice untuk kunjungan yang
-- inpatient_records.discharged_at-nya masih kosong. Akibatnya seluruh biaya baru
-- muncul saat pasien pulang, dan uang yang diterima di tengah perawatan tidak punya
-- dokumen omzet.
--
-- Sekarang:
--   * Staf menekan "Tagih sekarang" kapan saja. Baris resep yang BELUM ditagih jadi satu
--     invoice tahap lewat clinic_post_inpatient_stage_invoice. Posting tetap memakai
--     clinic_post_invoice yang sama (omzet, stok keluar, HPP, jurnal, piutang).
--   * Satu baris resep hanya boleh menempel pada SATU invoice aktif
--     (guard_invoice_item_billed_once). Setelah di-void, baris itu bisa ditagih lagi.
--   * Pembayaran dicatat sebagai KWITANSI per kunjungan: boleh berkali-kali, boleh
--     campuran metode, dialokasikan ke invoice tahap tertua lebih dulu. Sisanya jadi
--     uang muka penjualan (2103) yang otomatis memotong invoice tahap berikutnya.
--   * Uang muka minimal berlaku untuk SEMUA tagihan klinik (rawat jalan + tahap rawat
--     inap), ditegakkan di dalam RPC posting, bukan hanya di layar. OWNER/ADMIN/FINANCE
--     boleh menerobos dengan alasan yang dicatat.
--   * Kepulangan pasien tidak lagi diblokir oleh tagihan yang sudah terbit, dan tarif
--     rawat inap tidak lagi dihitung otomatis untuk kunjungan yang sudah ditagih tahap.
--
-- Kasir petshop, promo/voucher/komisi, waktu potong stok racikan, aturan BMHP, serta
-- permintaan/pemindahan stok tidak disentuh. Migrasi lama tidak diubah; perubahan pada
-- RPC berjalan memakai jangkar eksak (pg_get_functiondef + replace) dan gagal tertutup.

create schema if not exists clinic_private;

-- ---------------------------------------------------------------------------
-- 1. Pengaturan uang muka minimal (satu baris, global)
-- ---------------------------------------------------------------------------
create table public.clinic_billing_settings (
  id boolean primary key default true check (id),
  min_dp_percent numeric(5,2) not null default 50 check (min_dp_percent >= 0 and min_dp_percent <= 100),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.clinic_billing_settings (id) values (true);
alter table public.clinic_billing_settings enable row level security;
-- Dibaca semua akun login (layar kasir perlu menampilkan minimalnya sebelum menyimpan);
-- ditulis OWNER/ADMIN saja.
create policy clinic_billing_settings_read on public.clinic_billing_settings
  for select to authenticated using (true);
create policy clinic_billing_settings_write on public.clinic_billing_settings
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role in ('OWNER','ADMIN')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role in ('OWNER','ADMIN')));
-- Hak tabel ditulis eksplisit (bukan mengandalkan hak bawaan proyek) supaya baris ini
-- juga benar di klaster uji: RLS di atas yang menentukan siapa boleh menulis.
grant select, insert, update on public.clinic_billing_settings to authenticated;

-- Setiap penerobosan uang muka minimal tercatat: siapa, kapan, alasan, berapa kurangnya.
create table public.clinic_dp_overrides (
  invoice_id uuid primary key references public.invoices(id),
  min_percent numeric(5,2) not null,
  required_amount numeric(15,2) not null,
  received_amount numeric(15,2) not null,
  reason text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.clinic_dp_overrides enable row level security;
revoke all on public.clinic_dp_overrides from public, anon, authenticated, service_role;
grant select on public.clinic_dp_overrides to authenticated;
create policy clinic_dp_overrides_read on public.clinic_dp_overrides for select to authenticated
  using (exists (select 1 from public.invoices i join public.visits v on v.id = i.visit_id
    where i.id = clinic_dp_overrides.invoice_id and public.user_can_access_branch(v.branch_id)));

-- ---------------------------------------------------------------------------
-- 2. Kwitansi pembayaran per kunjungan (riwayat DP 1, DP 2, …)
-- ---------------------------------------------------------------------------
create table public.clinic_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  no_kwitansi text not null unique,
  visit_id uuid not null references public.visits(id),
  customer_id uuid references public.customers(id),
  branch_id uuid not null references public.branches(id),
  tanggal date not null,
  total numeric(15,2) not null check (total > 0),
  catatan text,
  shift_id uuid references public.cashier_shifts(id),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  status text not null default 'aktif' check (status in ('aktif','batal')),
  void_reason text,
  void_request_key text,
  void_shift_id uuid references public.cashier_shifts(id),
  voided_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  request_key text not null unique,
  request_hash text not null
);
create index clinic_payment_receipts_visit on public.clinic_payment_receipts(visit_id, created_at);
create index clinic_payment_receipts_customer on public.clinic_payment_receipts(customer_id, created_at);

-- Bagian metode satu kwitansi (pembayaran campuran).
create table public.clinic_payment_receipt_parts (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.clinic_payment_receipts(id),
  urutan smallint not null check (urutan between 1 and 6),
  metode text not null check (metode in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet')),
  amount numeric(15,2) not null check (amount > 0),
  kas_code text not null,
  unique (receipt_id, urutan)
);
create index clinic_payment_receipt_parts_receipt on public.clinic_payment_receipt_parts(receipt_id);

alter table public.clinic_payment_receipts enable row level security;
alter table public.clinic_payment_receipt_parts enable row level security;
revoke all on public.clinic_payment_receipts, public.clinic_payment_receipt_parts
  from public, anon, authenticated, service_role;
grant select on public.clinic_payment_receipts, public.clinic_payment_receipt_parts to authenticated;
create policy clinic_payment_receipts_read on public.clinic_payment_receipts for select to authenticated
  using (public.user_can_access_branch(branch_id));
create policy clinic_payment_receipt_parts_read on public.clinic_payment_receipt_parts for select to authenticated
  using (exists (select 1 from public.clinic_payment_receipts r
    where r.id = clinic_payment_receipt_parts.receipt_id and public.user_can_access_branch(r.branch_id)));

-- ---------------------------------------------------------------------------
-- 3. Uang muka penjualan pelanggan (2103) dan pemakaiannya
-- ---------------------------------------------------------------------------
create table public.clinic_customer_advances (
  id uuid primary key default gen_random_uuid(),
  no_uang_muka text not null unique,
  receipt_id uuid references public.clinic_payment_receipts(id),
  customer_id uuid not null references public.customers(id),
  branch_id uuid not null references public.branches(id),
  visit_id uuid references public.visits(id),
  tanggal date not null,
  amount numeric(15,2) not null check (amount > 0),
  applied numeric(15,2) not null default 0 check (applied >= 0),
  status text not null default 'aktif' check (status in ('aktif','batal')),
  shift_id uuid references public.cashier_shifts(id),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint clinic_customer_advances_applied_cap check (applied <= amount)
);
create index clinic_customer_advances_saldo on public.clinic_customer_advances(customer_id, branch_id, status, created_at);

create table public.clinic_advance_applications (
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.clinic_customer_advances(id),
  invoice_id uuid not null references public.invoices(id),
  payment_id uuid references public.invoice_payments(id),
  amount numeric(15,2) not null check (amount > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index clinic_advance_applications_invoice on public.clinic_advance_applications(invoice_id);
create index clinic_advance_applications_advance on public.clinic_advance_applications(advance_id);

alter table public.clinic_customer_advances enable row level security;
alter table public.clinic_advance_applications enable row level security;
revoke all on public.clinic_customer_advances, public.clinic_advance_applications
  from public, anon, authenticated, service_role;
grant select on public.clinic_customer_advances, public.clinic_advance_applications to authenticated;
create policy clinic_customer_advances_read on public.clinic_customer_advances for select to authenticated
  using (public.user_can_access_branch(branch_id));
create policy clinic_advance_applications_read on public.clinic_advance_applications for select to authenticated
  using (exists (select 1 from public.clinic_customer_advances a
    where a.id = clinic_advance_applications.advance_id and public.user_can_access_branch(a.branch_id)));

-- Kwitansi menempel pada barisnya di invoice_payments supaya satu struk bisa dicetak
-- ulang persis seperti saat uangnya diterima; baris pembalik menunjuk baris aslinya.
alter table public.invoice_payments
  add column receipt_id uuid references public.clinic_payment_receipts(id),
  add column reversal_of uuid references public.invoice_payments(id);
create index invoice_payments_receipt on public.invoice_payments(receipt_id);

-- ---------------------------------------------------------------------------
-- 4. Satu kunjungan boleh punya beberapa tagihan aktif
-- ---------------------------------------------------------------------------
-- Sejak migrasi 0028 ada UNIQUE INDEX invoices_visit_active_key: satu kunjungan hanya
-- boleh punya SATU invoice yang belum di-void. Aturan itulah yang memaksa seluruh biaya
-- rawat inap keluar sekali saat pasien pulang. Indeksnya diganti indeks biasa (pencarian
-- tagihan per kunjungan tetap cepat); keunikan untuk jalur NON-tahap tetap ditegakkan di
-- dalam clinic_post_invoice (INVOICE_EXISTS) dan penulisan langsung oleh akun aplikasi
-- memang sudah dicabut sejak migrasi 20260929120000.
drop index if exists public.invoices_visit_active_key;
create index if not exists invoices_visit_active_idx on public.invoices(visit_id) where voided_at is null;

-- ---------------------------------------------------------------------------
-- 5. Penanda tagihan tahap + penjaga tagih-sekali
-- ---------------------------------------------------------------------------
-- Penanda hanya hidup di dalam transaksi RPC tahap. Jalur invoice tunggal yang lama
-- tetap diblokir untuk pasien yang masih dirawat, supaya tidak ada tagihan dobel.
-- Selalu mengembalikan true/false, tidak pernah NULL: `... and not null` membuat IF di
-- penjaga ikut NULL, dan penjaganya diam-diam berhenti menolak.
create function clinic_private.stage_billing(p_visit_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('clinic.stage_visit', true), '') = p_visit_id::text, false);
$$;
revoke all on function clinic_private.stage_billing(uuid) from public, anon, authenticated, service_role;

create or replace function public.guard_open_inpatient_invoice() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  -- Tagihan tahap rawat inap memang diterbitkan selagi pasien dirawat. Jalur lain
  -- (checkout rawat jalan, bayar rombongan) tetap ditolak seperti sebelumnya, dan
  -- `for share` tetap menyerikalkan kepulangan terhadap posting yang berjalan.
  if exists(select 1 from public.inpatient_records r
    where r.visit_id=new.visit_id and r.discharged_at is null for share)
    and not clinic_private.stage_billing(new.visit_id) then
    raise exception using errcode='P0001', message='INPATIENT_OPEN: biaya rawat inap belum dihitung';
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_open_inpatient_invoice() from public,anon,authenticated,service_role;

-- Satu baris resep hanya boleh ditagih sekali. Dulu aturan ini ditegakkan secara tidak
-- langsung oleh "satu invoice aktif per kunjungan"; tagihan tahap mencabut aturan itu
-- untuk rawat inap, jadi penjaganya harus eksplisit.
create function public.guard_invoice_item_billed_once() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if new.prescription_item_id is null then return new; end if;
  if exists (
    select 1 from public.invoice_items ii
    join public.invoices i on i.id = ii.invoice_id
    where ii.prescription_item_id = new.prescription_item_id
      and ii.id is distinct from new.id
      and ii.invoice_id is distinct from new.invoice_id
      and i.voided_at is null
  ) then
    raise exception using errcode='P0001',
      message=format('LINE_BILLED: %s sudah masuk tagihan aktif lain', coalesce(new.deskripsi, 'baris resep'));
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_invoice_item_billed_once() from public,anon,authenticated,service_role;
create trigger guard_invoice_item_billed_once before insert on public.invoice_items
  for each row execute function public.guard_invoice_item_billed_once();

-- ---------------------------------------------------------------------------
-- 6. Uang muka minimal
-- ---------------------------------------------------------------------------
create function clinic_private.min_dp_percent() returns numeric
language sql stable set search_path = '' as $$
  select coalesce((select s.min_dp_percent from public.clinic_billing_settings s where s.id), 50);
$$;
revoke all on function clinic_private.min_dp_percent() from public, anon, authenticated, service_role;

-- Uang yang sudah masuk untuk satu tagihan: uang muka di kepala invoice + seluruh
-- baris pembayaran (termasuk pemakaian uang muka dan baris pembalik yang negatif).
create function clinic_private.invoice_received(p_invoice_id uuid) returns numeric
language sql stable set search_path = '' as $$
  select coalesce((select i.dp_amount from public.invoices i where i.id = p_invoice_id), 0)
    + coalesce((select sum(p.amount) from public.invoice_payments p where p.invoice_id = p_invoice_id), 0);
$$;
revoke all on function clinic_private.invoice_received(uuid) from public, anon, authenticated, service_role;

create function clinic_private.enforce_min_dp(p_invoice_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  v_invoice public.invoices%rowtype;
  v_pct numeric;
  v_min numeric(15,2);
  v_received numeric(15,2);
  v_role text;
  v_reason text := nullif(btrim(p_reason), '');
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if not found or v_invoice.total <= 0 then return; end if;
  v_pct := clinic_private.min_dp_percent();
  if v_pct <= 0 then return; end if;
  v_received := clinic_private.invoice_received(p_invoice_id)::numeric(15,2);
  if v_invoice.paid_status = 'Lunas' or v_received >= v_invoice.total then return; end if;
  v_min := ceil(v_invoice.total * v_pct / 100)::numeric(15,2);
  if v_received >= v_min then return; end if;
  if v_reason is null then
    -- Pesan dijaga pendek (<100 karakter) supaya penerjemah galat di aplikasi bisa
    -- menampilkan rinciannya apa adanya, bukan jatuh ke pesan umum.
    raise exception using errcode='P0001', message=format(
      'DP_MINIMAL: minimal %s%% = Rp %s, baru diterima Rp %s',
      trim(to_char(v_pct, 'FM999990.99')), trim(to_char(v_min, 'FM999999999990')),
      trim(to_char(v_received, 'FM999999999990')));
  end if;
  if length(v_reason) > 500 then
    raise exception using errcode='P0001', message='DP_MINIMAL: alasan penerobosan terlalu panjang';
  end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_role is null or v_role not in ('OWNER','ADMIN','FINANCE') then
    raise exception using errcode='P0001',
      message='DP_OVERRIDE_DENIED: hanya OWNER, ADMIN, atau FINANCE boleh menerima di bawah uang muka minimal';
  end if;
  insert into public.clinic_dp_overrides(
    invoice_id, min_percent, required_amount, received_amount, reason, created_by
  ) values (p_invoice_id, v_pct, v_min, v_received, v_reason, auth.uid())
  on conflict (invoice_id) do nothing;
end;
$function$;
revoke all on function clinic_private.enforce_min_dp(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Penolong: rekening kas per metode, dan nomor dokumen
-- ---------------------------------------------------------------------------
create function clinic_private.kas_code(p_metode text, p_branch_id uuid) returns text
language plpgsql stable set search_path = '' as $function$
declare v_code text; v_active boolean;
begin
  select ca.coa_code, ca.is_active into v_code, v_active
  from public.payment_account_map pam
  join public.cash_accounts ca on ca.id = pam.cash_account_id
  where pam.metode = p_metode and pam.branch_id = p_branch_id limit 1;
  if v_code is null then
    select ca.coa_code, ca.is_active into v_code, v_active
    from public.payment_account_map pam
    join public.cash_accounts ca on ca.id = pam.cash_account_id
    where pam.metode = p_metode and pam.branch_id is null limit 1;
  end if;
  if v_code is not null and v_active is distinct from true then
    raise exception using errcode='P0001', message='ACCOUNT_INVALID: rekening pembayaran tidak aktif';
  end if;
  if v_code is null then
    v_code := case when p_metode = 'Tunai' then '1101' else '1102' end;
  end if;
  if not exists (select 1 from public.coa_accounts a where a.code = v_code and a.is_active and not a.is_header) then
    raise exception using errcode='P0001', message=format('ACCOUNT_INVALID: akun penerimaan %s tidak tersedia', v_code);
  end if;
  return v_code;
end;
$function$;
revoke all on function clinic_private.kas_code(text, uuid) from public, anon, authenticated, service_role;

-- Nomor berurutan gaya dokumen lain: pola dari document_numbering, tertinggi + 1,
-- di bawah advisory lock supaya dua kasir tidak mengambil nomor yang sama.
create function clinic_private.next_no(
  p_jenis text, p_default_pattern text, p_default_digits integer, p_tanggal date, p_table regclass, p_column text
) returns text language plpgsql set search_path = '' as $function$
declare v_pattern text; v_digits integer; v_prefix text; v_seq bigint; v_no text;
begin
  select n.pola, n.digit into v_pattern, v_digits from public.document_numbering n where n.jenis = p_jenis;
  if not found then v_pattern := p_default_pattern; v_digits := p_default_digits; end if;
  v_prefix := replace(replace(replace(replace(v_pattern, '{YYYY}', to_char(p_tanggal, 'YYYY')),
    '{YY}', to_char(p_tanggal, 'YY')), '{MM}', to_char(p_tanggal, 'MM')), '{DD}', to_char(p_tanggal, 'DD'));
  if v_prefix ~ '\{[^}]+\}' or length(v_prefix) = 0 then
    raise exception using errcode='P0001', message='DOC_NO_INVALID: format nomor dokumen tidak valid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('clinic-doc-number:' || v_prefix, 0));
  execute format(
    'select coalesce(max(substring(t.%I, $2)::bigint), 0) + 1 from %s t where left(t.%I, $1) = $3 and substring(t.%I, $2) ~ ''^[0-9]+$''',
    p_column, p_table::text, p_column, p_column)
    into v_seq using length(v_prefix), length(v_prefix) + 1, v_prefix;
  v_no := v_prefix || case when length(v_seq::text) > v_digits then v_seq::text
    else lpad(v_seq::text, v_digits, '0') end;
  if length(v_no) > 32 then
    raise exception using errcode='P0001', message='DOC_NO_INVALID: nomor dokumen terlalu panjang';
  end if;
  return v_no;
end;
$function$;
revoke all on function clinic_private.next_no(text, text, integer, date, regclass, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Tagih sekarang — invoice tahap untuk pasien yang masih dirawat
-- ---------------------------------------------------------------------------
create function public.clinic_post_inpatient_stage_invoice(
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
  v_used numeric(15,2) := 0;
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

  -- Penanda dibuka hanya selama posting berjalan, lalu ditutup lagi: baris lain dalam
  -- transaksi yang sama tidak boleh ikut menembus penjaga INPATIENT_OPEN.
  perform set_config('clinic.stage_visit', p_visit_id::text, true);
  v_invoice_id := public.clinic_post_invoice(p_visit_id, v_key,
    p_invoice || jsonb_build_object('min_dp_deferred', true), p_lines);
  perform set_config('clinic.stage_visit', '', true);
  if v_replay then return v_invoice_id; end if;

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
      v_used := v_used + v_apply;
    end loop;
  end if;
  if v_used > 0 and v_remaining <= 0 then
    update public.invoices set paid_status = 'Lunas', paid_at = now() where id = v_invoice_id;
  end if;

  perform clinic_private.enforce_min_dp(v_invoice_id, p_invoice ->> 'dp_override_reason');
  return v_invoice_id;
end;
$function$;
revoke all on function public.clinic_post_inpatient_stage_invoice(uuid, text, jsonb, jsonb)
  from public, anon, service_role;
grant execute on function public.clinic_post_inpatient_stage_invoice(uuid, text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Terima pembayaran (kwitansi per kunjungan, boleh campuran metode)
-- ---------------------------------------------------------------------------
create function public.clinic_receive_visit_payment(
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
    if v_sisa <= 0 then
      update public.invoices set paid_status = 'Lunas', paid_at = now() where id = v_inv.id;
      v_any_paid := true;
    end if;
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
-- 10. Batalkan kwitansi (tidak pernah dihapus — dibalik dan beralasan)
-- ---------------------------------------------------------------------------
create function public.clinic_void_payment_receipt(
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
  v_adv public.clinic_customer_advances%rowtype;
  v_lines jsonb;
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
    raise exception using errcode='P0001',
      message='ADVANCE_USED: uang muka dari kwitansi ini sudah dipakai; batalkan tagihannya lebih dulu';
  end if;

  for v_row in
    select p.* from public.invoice_payments p
    where p.receipt_id = p_receipt_id and p.reversal_of is null and p.amount > 0
    order by p.created_at, p.id
  loop
    insert into public.invoice_payments(
      invoice_id, tanggal, amount, metode, catatan, kas_code, created_by, receipt_id, reversal_of
    ) values (
      v_row.invoice_id, current_date, -v_row.amount, v_row.metode,
      'Pembatalan kwitansi ' || v_receipt.no_kwitansi, v_row.kas_code, v_user, p_receipt_id, v_row.id
    );
    perform public.clinic_write_journal(current_date,
      'Pembatalan pembayaran ' || v_receipt.no_kwitansi, 'klinik-ar',
      (select i.invoice_no from public.invoices i where i.id = v_row.invoice_id), v_receipt.branch_id,
      jsonb_build_array(
        jsonb_build_object('code','1201','debit',v_row.amount,'credit',0),
        jsonb_build_object('code', v_row.kas_code, 'debit', 0, 'credit', v_row.amount)));
    update public.invoices set paid_status = case when dp_amount > 0 then 'DP' else 'Belum Lunas' end,
      paid_at = null
    where id = v_row.invoice_id and voided_at is null
      and clinic_private.invoice_received(v_row.invoice_id) < total;
    update public.visits set status = 'Pembayaran'
    where id = (select i.visit_id from public.invoices i where i.id = v_row.invoice_id)
      and status = 'Selesai'
      and exists (select 1 from public.invoices i2 where i2.visit_id = visits.id
        and i2.voided_at is null and i2.paid_status <> 'Lunas');
  end loop;

  if v_adv.id is not null then
    update public.clinic_customer_advances set status = 'batal' where id = v_adv.id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'code', t.kas_code, 'debit', 0, 'credit', t.amount)), '[]'::jsonb) into v_lines
    from (
      select pt.kas_code, sum(pt.amount) as amount
      from public.clinic_payment_receipt_parts pt where pt.receipt_id = p_receipt_id
      group by pt.kas_code
    ) t;
    -- Baris kas dipotong proporsional hanya bila sebagian kwitansi sudah teralokasi;
    -- kwitansi yang seluruhnya jadi uang muka membalik persis sebesar nominalnya.
    perform public.clinic_write_journal(current_date, 'Pembatalan uang muka ' || v_adv.no_uang_muka,
      'klinik-uang-muka-batal', v_adv.no_uang_muka, v_receipt.branch_id,
      case when v_adv.amount = v_receipt.total then
        jsonb_build_array(jsonb_build_object('code','2103','debit',v_adv.amount,'credit',0)) || v_lines
      else jsonb_build_array(
        jsonb_build_object('code','2103','debit',v_adv.amount,'credit',0),
        jsonb_build_object('code', (select pt.kas_code from public.clinic_payment_receipt_parts pt
          where pt.receipt_id = p_receipt_id order by pt.urutan limit 1), 'debit', 0, 'credit', v_adv.amount))
      end);
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
-- 11. Void & terbit ulang: uang muka ikut pindah ke tagihan penggantinya
-- ---------------------------------------------------------------------------
create function clinic_private.remap_advance_applications(p_old uuid, p_new uuid)
returns void language plpgsql set search_path = '' as $function$
begin
  update public.clinic_advance_applications set invoice_id = p_new where invoice_id = p_old;
end;
$function$;
revoke all on function clinic_private.remap_advance_applications(uuid, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. Tambalan pada RPC yang sudah berjalan
-- ---------------------------------------------------------------------------
-- Semua tambalan satu fungsi diterapkan pada teksnya dulu, baru dikompilasi SEKALI:
-- beberapa tambalan (if … else … end if) hanya valid bila diterapkan bersama.
do $patch$
declare p record; definition text; signature regprocedure; pending jsonb := '{}'::jsonb; k text;
begin
 for p in select * from (values
  -- Posting tagihan: beberapa invoice aktif per kunjungan hanya boleh lewat jalur tahap.
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'  if exists (select 1 from public.invoices i where i.visit_id = p_visit_id and i.voided_at is null) then\n    raise exception using errcode = ''P0001'', message = ''INVOICE_EXISTS: kunjungan sudah memiliki invoice aktif'';\n  end if;',
   E'  if exists (select 1 from public.invoices i where i.visit_id = p_visit_id and i.voided_at is null)\n     and not clinic_private.stage_billing(p_visit_id) then\n    raise exception using errcode = ''P0001'', message = ''INVOICE_EXISTS: kunjungan sudah memiliki invoice aktif'';\n  end if;'),
  -- Uang muka minimal ditegakkan di database untuk SEMUA tagihan klinik. Checkout
  -- campuran selalu lunas, dan tagihan tahap memeriksanya setelah uang muka dipakai.
  ('public.clinic_post_invoice(uuid,text,jsonb,jsonb)',
   E'  update public.invoices set request_key = v_request_key, request_hash = v_hash\n  where id = v_invoice_id;',
   E'  update public.invoices set request_key = v_request_key, request_hash = v_hash\n  where id = v_invoice_id;\n\n  if not coalesce((p_invoice ->> ''min_dp_deferred'')::boolean, false)\n     and not (p_invoice ? ''split_payments'') then\n    perform clinic_private.enforce_min_dp(v_invoice_id, p_invoice ->> ''dp_override_reason'');\n  end if;'),
  -- Pelunasan piutang tidak boleh menutup kunjungan yang pasiennya masih dirawat atau
  -- yang masih punya tagihan tahap lain yang belum lunas.
  ('public.clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text)',
   E'    update public.visits set status=''Selesai'' where id = v_visit.id;',
   E'    update public.visits set status=''Selesai'' where id = v_visit.id\n      and not exists(select 1 from public.inpatient_records r\n        where r.visit_id = v_visit.id and r.discharged_at is null)\n      and not exists(select 1 from public.invoices i2 where i2.visit_id = v_visit.id\n        and i2.voided_at is null and i2.paid_status <> ''Lunas'' and i2.id <> p_invoice_id);'),
  -- Kwitansi yang dibatalkan meninggalkan baris pembayaran negatif; itu bukan tanda
  -- rekening cicilan yang hilang, jadi hanya nominal NOL yang menahan terbit ulang.
  ('public.clinic_void_reissue_invoice_core(uuid,text,text)',
   E'      and (kas_code is null or amount<=0)) then',
   E'      and (kas_code is null or amount=0)) then'),
  -- Uang muka yang sudah menempel ikut pindah ke tagihan pengganti: saldo pemilik tidak
  -- pernah hilang, dan tidak pernah tercatat dipakai dua kali.
  ('public.clinic_void_reissue_invoice_core(uuid,text,text)',
   E'  perform public.clinic_write_journal(current_date,''Terbit ulang ''||v_no,\n    ''klinik-reissue'',v_no,v_visit.branch_id,v_lines);',
   E'  perform public.clinic_write_journal(current_date,''Terbit ulang ''||v_no,\n    ''klinik-reissue'',v_no,v_visit.branch_id,v_lines);\n  perform clinic_private.remap_advance_applications(p_invoice_id,v_new_id);'),
  -- Kepulangan pasien tidak lagi diblokir oleh tagihan yang sudah terbit.
  ('public.clinic_change_inpatient_condition(uuid,text,text)',
   E'  if v_discharged_at is not null and exists(select 1 from public.invoices\n      where visit_id=v_record.visit_id and voided_at is null) then\n    raise exception using errcode=''P0001'', message=''INVOICE_EXISTS: tagihan sudah terbit sebelum biaya rawat inap dihitung'';\n  end if;',
   E'  -- Tagihan berjalan: pasien boleh pulang walau tagihannya sudah terbit dan belum\n  -- lunas. Sisanya diselesaikan lewat layar tagihan rawat inap atau menjadi piutang.'),
  -- Tarif rawat inap tetap manual bila kunjungan sudah pernah ditagih tahap; baris
  -- otomatis hanya dipertahankan untuk kunjungan lama yang belum punya tagihan.
  ('public.clinic_change_inpatient_condition(uuid,text,text)',
   E'  if v_discharged_at is not null then\n    select * into v_tariff from public.items',
   E'  if v_discharged_at is not null and not exists(select 1 from public.invoices i\n      where i.visit_id=v_record.visit_id and i.request_key is not null) then\n    select * into v_tariff from public.items')
 ) as patches(sig, old_text, new_text) loop
  signature := to_regprocedure(p.sig);
  if signature is null then raise exception 'Tagihan berjalan: RPC wajib tidak ada: %', p.sig; end if;
  definition := coalesce(pending ->> p.sig, pg_get_functiondef(signature));
  if (length(definition) - length(replace(definition, p.old_text, ''))) / length(p.old_text) <> 1 then
   raise exception 'Tagihan berjalan: jangkar harus muncul tepat sekali di %; periksa definisi sebelum menerapkan', p.sig;
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
revoke all on function public.clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text)
  from public, anon, service_role;
grant execute on function public.clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text) to authenticated;
revoke all on function public.clinic_void_reissue_invoice_core(uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.clinic_change_inpatient_condition(uuid,text,text) from public, anon, service_role;
grant execute on function public.clinic_change_inpatient_condition(uuid,text,text) to authenticated;
