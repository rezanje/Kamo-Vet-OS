-- TANGGAL EFEKTIF (backdate) untuk "Batalkan penerimaan" KLINIK, gaya Accurate (Andri 11 Nov 2026: "kita bisa pilih tgl backdate dong biar bisa
-- kebaca di omset tgl aslinya, karena Accurate bisa seperti itu"). Owner memilih tanggal pembukuan (default hari ini; paling awal tanggal penerimaan
-- asli; tidak boleh masa depan). Tanggal itu dipakai oleh: jurnal pembalik pembatalan, baris pembayaran pembalik, lalu SELAMA jendela terbuka juga
-- koreksi tagihan (jurnal penjualan/HPP koreksi) dan penerimaan ulang (kwitansi, baris pembayaran, jurnal kas/bank, paid_at).
--
-- Apply as ONE transaction (tanpa begin/commit sendiri). Semua tambalan berjangkar eksak atas definisi HIDUP dan GAGAL TERTUTUP bila berbeda.
-- Tidak ada baris data yang diubah/ditulis ulang (tabel jejak lama kosong di produksi; kolom baru nullable). Tanpa tanggal = perilaku lama persis.
--
-- Uang fisik tetap pada hari kejadian: laci shift (tunai/QRIS) mengikuti shift TERBUKA pelaku (shift_id), bukan tanggal efektif. Shift lama yang sudah
-- tutup TIDAK diubah. Yang bertanggal efektif hanyalah pembukuan (jurnal, baris pembayaran, kwitansi, paid_at).
--
-- ATURAN:
--   * Tanggal mundur (< hari ini WIB) hanya Owner, atau peran yang diberi izin tertulis 'klinik.batalkan_penerimaan_tanggal' (bawaan MATI).
--   * Batas bawah = tanggal penerimaan asli terbesar yang dibatalkan (jurnal penjualan, DP, pembayaran, kwitansi); tidak boleh masa depan.
--   * Periode akuntansi atau persediaan tertutup pada tanggal itu = ditolak dengan petunjuk membuka kembali di Tutup Buku (tidak pernah dilewati).
--   * Penggajian sudah dibuat untuk bulan tanggal itu (atau bulan penerimaan asli, dasar komisi klinik = paid_at) = ditolak (pola grosir).
--   * Jendela tanggal efektif per tagihan: terbuka sesudah pembatalan bertanggal mundur; koreksi tagihan (Koreksi tagihan) dan penerimaan ulang
--     memakai tanggalnya; menutup sendiri saat tagihan Lunas lagi; Owner bisa melepasnya (clinic_backdate_release) kapan pun.
--   * Stok, HPP fisik (gerakan stok), poin loyalti: tidak berubah. Jurnal HPP koreksi mengikuti tanggal efektif (laba kotor hari itu utuh).

alter table public.clinic_receipt_cancellations add column effective_date date;
alter table public.clinic_receipt_cancellations add constraint clinic_receipt_cancellations_effective check (effective_date is null or effective_date <= tanggal);
comment on column public.clinic_receipt_cancellations.effective_date is 'Tanggal pembukuan yang dipilih (jurnal pembalik). tanggal = tanggal pencatatan sebenarnya (WIB), created_at = waktu sebenarnya.';

create table public.clinic_backdate_windows (
  invoice_id uuid primary key references public.invoices(id),
  cancellation_id uuid not null,
  branch_id uuid not null,
  effective_date date not null,
  status text not null default 'terbuka',
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid,
  close_reason text,
  constraint clinic_backdate_windows_status check (status in ('terbuka', 'selesai', 'dilepas', 'diganti')),
  constraint clinic_backdate_windows_closed check ((status = 'terbuka') = (closed_at is null))
);
create index clinic_backdate_windows_branch on public.clinic_backdate_windows (branch_id, status);
alter table public.clinic_backdate_windows enable row level security;
create policy clinic_backdate_windows_read on public.clinic_backdate_windows for select to authenticated
  using (public.user_can_access_branch(branch_id));
revoke all on public.clinic_backdate_windows from public, anon, authenticated, service_role;
grant select on public.clinic_backdate_windows to authenticated;

create table public.clinic_backdate_receipts (
  receipt_id uuid primary key references public.clinic_payment_receipts(id),
  branch_id uuid not null,
  invoice_id uuid,
  effective_date date not null,
  actual_date date not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
alter table public.clinic_backdate_receipts enable row level security;
create policy clinic_backdate_receipts_read on public.clinic_backdate_receipts for select to authenticated
  using (public.user_can_access_branch(branch_id));
revoke all on public.clinic_backdate_receipts from public, anon, authenticated, service_role;
grant select on public.clinic_backdate_receipts to authenticated;

create function clinic_private.backdate_tables_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.invoice_id is not distinct from old.invoice_id and new.branch_id is not distinct from old.branch_id then
    return new;
  end if;
  raise exception using errcode = 'P0001', message = 'AUDIT_IMMUTABLE: catatan tanggal efektif tidak dapat dihapus atau dipindahkan';
end $$;
revoke all on function clinic_private.backdate_tables_guard() from public, anon, authenticated, service_role;
create trigger clinic_backdate_windows_guard before update or delete on public.clinic_backdate_windows
  for each row execute function clinic_private.backdate_tables_guard();
create trigger clinic_backdate_windows_truncate before truncate on public.clinic_backdate_windows
  for each statement execute function clinic_private.receipt_cancellation_immutable();
create function clinic_private.backdate_receipts_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = 'AUDIT_IMMUTABLE: catatan kwitansi bertanggal efektif tidak dapat diubah atau dihapus';
end $$;
revoke all on function clinic_private.backdate_receipts_guard() from public, anon, authenticated, service_role;
create trigger clinic_backdate_receipts_guard before update or delete on public.clinic_backdate_receipts
  for each row execute function clinic_private.backdate_receipts_guard();
create trigger clinic_backdate_receipts_truncate before truncate on public.clinic_backdate_receipts
  for each statement execute function clinic_private.receipt_cancellation_immutable();

-- Izin untuk peran selain Owner (bawaan MATI).
insert into role_settings_private.action_catalog(id, label, "group", enforced)
values ('klinik.batalkan_penerimaan_tanggal', 'Pilih tanggal mundur saat batalkan penerimaan — Pembayaran klinik', 'Klinik', true)
on conflict (id) do nothing;
insert into role_settings_private.action_modules(id, module_id)
values ('klinik.batalkan_penerimaan_tanggal', 'klinik')
on conflict (id) do nothing;

-- ───────────────────────── helper murni ─────────────────────────
create function clinic_private.backdate_date(p_invoice_id uuid) returns date
language sql stable security definer set search_path = '' as $$
  select w.effective_date from public.clinic_backdate_windows w where w.invoice_id = p_invoice_id and w.status = 'terbuka'
$$;
revoke all on function clinic_private.backdate_date(uuid) from public, anon, authenticated, service_role;

create function clinic_private.backdate_paid_at(p_invoice_id uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select (w.effective_date::text || ' 12:00:00+07')::timestamptz from public.clinic_backdate_windows w
  where w.invoice_id = p_invoice_id and w.status = 'terbuka'
$$;
revoke all on function clinic_private.backdate_paid_at(uuid) from public, anon, authenticated, service_role;

create function clinic_private.backdate_receipt_date(p_visit_id uuid, p_invoice_id uuid) returns date
language sql stable security definer set search_path = '' as $$
  select clinic_private.backdate_date(coalesce(p_invoice_id, (
    select i.id from public.invoices i
    where i.visit_id = p_visit_id and i.voided_at is null and i.paid_status <> 'Lunas'
      and i.invoice_no is not null and i.request_key is not null and not i.correction_pending
    order by i.created_at, i.id limit 1)))
$$;
revoke all on function clinic_private.backdate_receipt_date(uuid, uuid) from public, anon, authenticated, service_role;

create function clinic_private.backdate_window_close(p_invoice_id uuid, p_status text, p_by uuid, p_reason text) returns void
language sql volatile security definer set search_path = '' as $$
  update public.clinic_backdate_windows set status = p_status, closed_at = now(), closed_by = p_by, close_reason = p_reason
  where invoice_id = p_invoice_id and status = 'terbuka'
$$;
revoke all on function clinic_private.backdate_window_close(uuid, text, uuid, text) from public, anon, authenticated, service_role;

-- Periode akuntansi / persediaan: pesan bahasa biasa dengan petunjuk membuka kembali (tidak pernah dilewati).
create function clinic_private.backdate_assert_open(p_date date) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_acc date; v_inv date;
begin
  select l.closed_until into v_acc from public.accounting_locks l where l.id;
  if v_acc is not null and p_date <= v_acc then
    raise exception using errcode = 'P0001', message = format('PERIODE_TERKUNCI: periode akuntansi sampai %s sudah ditutup, jadi tanggal %s tidak bisa dibukukan. Owner perlu membuka kembali periodenya di Keuangan > Tutup Buku, atau pilih tanggal setelah %s', v_acc, p_date, v_acc);
  end if;
  select s.closed_through into v_inv from public.inventory_costing_settings s where s.id;
  if v_inv is not null and p_date <= v_inv then
    raise exception using errcode = 'P0001', message = format('PERSEDIAAN_TERKUNCI: periode persediaan sampai %s sudah ditutup, jadi tanggal %s tidak bisa dipakai untuk koreksi tagihan. Owner perlu membuka kembali periode persediaan, atau pilih tanggal setelah %s', v_inv, p_date, v_inv);
  end if;
end $$;
revoke all on function clinic_private.backdate_assert_open(date) from public, anon, authenticated, service_role;

create function clinic_private.cancel_receipt_backdate_ok(p_actor text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.user_role; v_ok boolean := false;
begin
  if p_actor = 'OWNER' then return true; end if;
  if p_actor is distinct from 'GRANT' then return false; end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_role is null then return false; end if;
  begin
    v_ok := exists (select 1 from role_settings_private.action_policies a
                    where a.role = v_role and 'klinik.batalkan_penerimaan_tanggal' = any (a.allowed))
            and public.role_action_allowed('klinik.batalkan_penerimaan_tanggal');
  exception when others then
    v_ok := false;
  end;
  return v_ok;
end $$;
revoke all on function clinic_private.cancel_receipt_backdate_ok(text) from public, anon, authenticated, service_role;

-- Batas bawah tanggal: yang terbesar dari tanggal jurnal penjualan, DP, pembayaran, pemakaian uang muka, kwitansi yang dibatalkan.
create function clinic_private.cancel_receipt_orig_date(p_invoice_id uuid, p_scan jsonb) returns date
language plpgsql stable security definer set search_path = '' as $$
declare v_inv public.invoices%rowtype; v_d date; v_x date;
begin
  select * into v_inv from public.invoices where id = p_invoice_id;
  if not found then return null; end if;
  select min(e.tanggal) into v_d from public.journal_entries e
  where e.source = 'klinik' and e.source_ref = v_inv.invoice_no and e.voided_at is null;
  v_d := coalesce(v_d, (v_inv.created_at at time zone 'Asia/Jakarta')::date);
  if coalesce(v_inv.dp_amount, 0) > 0 and v_inv.dp_date is not null then v_d := greatest(v_d, v_inv.dp_date); end if;
  select max(p.tanggal) into v_x from public.invoice_payments p
  where p.id in (select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(p_scan -> 'payments', '[]'::jsonb)) e
                 union select (e ->> 'payment_id')::uuid from jsonb_array_elements(coalesce(p_scan -> 'apps', '[]'::jsonb)) e);
  v_d := greatest(v_d, v_x);
  select max((e ->> 'tanggal')::date) into v_x from jsonb_array_elements(coalesce(p_scan -> 'receipts', '[]'::jsonb)) e;
  return greatest(v_d, v_x);
end $$;
revoke all on function clinic_private.cancel_receipt_orig_date(uuid, jsonb) from public, anon, authenticated, service_role;

-- Satu sumber kebenaran untuk pratinjau dan eksekusi: null = tanggal boleh; atau {code, message}.
create function clinic_private.cancel_receipt_date_check(p_eff date, p_today date, p_min date, p_actor text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_acc date; v_inv date; v_months text[];
begin
  if p_eff > p_today then
    return jsonb_build_object('code', 'TANGGAL_MASA_DEPAN', 'message', format('Tanggal efektif %s belum tiba; paling jauh hari ini (%s).', p_eff, p_today));
  end if;
  if p_eff = p_today then return null; end if;
  if not clinic_private.cancel_receipt_backdate_ok(p_actor) then
    return jsonb_build_object('code', 'TANGGAL_MUNDUR_DITOLAK', 'message', 'Memilih tanggal sebelum hari ini hanya untuk Owner (atau peran yang diberi izin "Pilih tanggal mundur" di Akses Grup). Pilih hari ini.');
  end if;
  if p_min is not null and p_eff < p_min then
    return jsonb_build_object('code', 'TANGGAL_SEBELUM_PENERIMAAN', 'message', format('Tanggal efektif %s lebih awal dari tanggal penerimaan asli (%s). Pilih tanggal %s atau sesudahnya.', p_eff, p_min, p_min));
  end if;
  select l.closed_until into v_acc from public.accounting_locks l where l.id;
  if v_acc is not null and p_eff <= v_acc then
    return jsonb_build_object('code', 'PERIODE_TERKUNCI', 'message', format('Periode akuntansi sampai %s sudah ditutup, jadi tanggal %s tidak bisa dibukukan. Owner perlu membuka kembali periodenya di Keuangan > Tutup Buku, atau pilih tanggal setelah %s.', v_acc, p_eff, v_acc));
  end if;
  select s.closed_through into v_inv from public.inventory_costing_settings s where s.id;
  if v_inv is not null and p_eff <= v_inv then
    return jsonb_build_object('code', 'PERSEDIAAN_TERKUNCI', 'message', format('Periode persediaan sampai %s sudah ditutup, jadi tanggal %s tidak bisa dipakai (koreksi tagihan sesudahnya ikut bertanggal itu). Owner perlu membuka kembali periode persediaan, atau pilih tanggal setelah %s.', v_inv, p_eff, v_inv));
  end if;
  v_months := array(select distinct to_char(d, 'YYYY-MM') from unnest(array[p_eff, p_min]) d where d is not null);
  if exists (select 1 from public.payrolls pr where pr.periode = any (v_months)) then
    return jsonb_build_object('code', 'GAJI_SUDAH_DIBUAT', 'message', format('Penggajian untuk bulan %s sudah dibuat; komisi klinik dihitung dari tanggal lunas, jadi tanggal itu tidak bisa diubah sekarang. Hitung ulang/hapus penggajiannya lebih dulu atau pilih tanggal di bulan berjalan.', array_to_string(v_months, ' / ')));
  end if;
  return null;
end $$;
revoke all on function clinic_private.cancel_receipt_date_check(date, date, date, text) from public, anon, authenticated, service_role;

-- ───────────────────────── tambalan berjangkar atas definisi hidup ─────────────────────────
create temp table bd_patch(n serial primary key, sig text not null, old_text text not null, new_text text not null, times integer not null default 1) on commit drop;
insert into bd_patch(sig, old_text, new_text, times) values
-- ============================== sync_paid_status: paid_at = tanggal efektif bila jendela terbuka ==============================
('clinic_private.sync_paid_status(uuid)',
 $old$    update public.invoices set paid_status = 'Lunas', paid_at = coalesce(paid_at, now())
    where id = p_invoice_id;$old$,
 $new$    -- BACKDATE_KLINIK: paid_at (dasar komisi dokter dan buku pembantu piutang) mengikuti tanggal efektif; jendela menutup sendiri saat Lunas.
    update public.invoices set paid_status = 'Lunas', paid_at = coalesce(paid_at, clinic_private.backdate_paid_at(p_invoice_id), now())
    where id = p_invoice_id;
    perform clinic_private.backdate_window_close(p_invoice_id, 'selesai', null, 'tagihan Lunas kembali');$new$, 1),
-- ============================== clinic_edit_invoice_core: jurnal koreksi bertanggal efektif ==============================
('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
 $old$  v_credit numeric;
begin
  perform public.inventory_assert_open_date(current_date);$old$,
 $new$  v_credit numeric;
  v_jdate date;
begin
  perform public.inventory_assert_open_date(current_date);$new$, 1),
('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
 $old$  v_reverse := public.clinic_reverse_journal_lines(v_invoice.invoice_no,array['klinik','klinik-reissue','klinik-edit']);$old$,
 $new$  -- BACKDATE_KLINIK: tanggal pembukuan koreksi = tanggal efektif jendela (dipilih Owner saat Batalkan penerimaan); tanpa jendela = hari ini seperti dulu.
  -- Gerakan stok fisik tetap hari ini; hanya jurnal (penjualan dan HPP koreksi) memakai tanggal efektif.
  v_jdate := coalesce(clinic_private.backdate_date(p_invoice_id), current_date);
  if v_jdate <> current_date then perform clinic_private.backdate_assert_open(v_jdate); end if;
  v_reverse := public.clinic_reverse_journal_lines(v_invoice.invoice_no,array['klinik','klinik-reissue','klinik-edit']);$new$, 1),
('public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)',
 $old$public.clinic_write_journal(current_date,$old$, $new$public.clinic_write_journal(v_jdate,$new$, 4),
-- ============================== clinic_receive_visit_payment: kwitansi/jurnal/pembayaran bertanggal efektif ==============================
('public.clinic_receive_visit_payment(uuid,text,date,jsonb,uuid,text)',
 $old$  v_any_paid boolean := false;
begin$old$,
 $new$  v_any_paid boolean := false;
  v_bd date; v_bd_used boolean := false;
begin$new$, 1),
('public.clinic_receive_visit_payment(uuid,text,date,jsonb,uuid,text)',
 $old$  v_hash := md5(jsonb_build_object('visit', p_visit_id, 'tanggal', p_tanggal,$old$,
 $new$  -- BACKDATE_KLINIK: tagihan yang sedang punya jendela tanggal efektif (dipilih Owner saat Batalkan penerimaan) dibukukan pada tanggal itu: kwitansi,
  -- baris pembayaran dan jurnal kas/bank. Uang fisik tetap masuk shift terbuka kasir ini (v_shift di atas). Ulangan kunci yang sama memakai
  -- tanggal kwitansi yang tercatat bertanggal efektif (hasil lama dikembalikan, tidak bentrok walau jendela sudah menutup).
  select r.tanggal into v_bd from public.clinic_payment_receipts r
   where r.request_key = v_key and exists (select 1 from public.clinic_backdate_receipts b where b.receipt_id = r.id);
  if found then
    p_tanggal := v_bd; v_bd_used := true;
  else
    v_bd := clinic_private.backdate_receipt_date(p_visit_id, p_invoice_id);
    if v_bd is not null then
      perform clinic_private.backdate_assert_open(v_bd);
      p_tanggal := v_bd; v_bd_used := true;
    end if;
  end if;
  v_hash := md5(jsonb_build_object('visit', p_visit_id, 'tanggal', p_tanggal,$new$, 1),
('public.clinic_receive_visit_payment(uuid,text,date,jsonb,uuid,text)',
 $old$  ) returning id into v_receipt_id;
$old$,
 $new$  ) returning id into v_receipt_id;
  if v_bd_used then
    insert into public.clinic_backdate_receipts(receipt_id, branch_id, invoice_id, effective_date, actual_date, created_by)
    values (v_receipt_id, v_visit.branch_id, p_invoice_id, p_tanggal, (now() at time zone 'Asia/Jakarta')::date, v_user);
  end if;
$new$, 1),
('public.clinic_receive_visit_payment(uuid,text,date,jsonb,uuid,text)',
 $old$    if v_sisa <= 0 then continue; end if;
    for v_slot in 1 .. jsonb_array_length(v_parts) loop$old$,
 $new$    if v_sisa <= 0 then continue; end if;
    if clinic_private.backdate_date(v_inv.id) is distinct from (case when v_bd_used then p_tanggal else null end) then
      raise exception using errcode='P0001', message='BACKDATE_CAMPUR: uang ini akan melunasi tagihan dengan tanggal efektif yang berbeda; terima pembayaran satu tagihan dalam satu kwitansi (pilih tagihannya), atau Owner melepas tanggal efektifnya';
    end if;
    for v_slot in 1 .. jsonb_array_length(v_parts) loop$new$, 1),
('public.clinic_receive_visit_payment(uuid,text,date,jsonb,uuid,text)',
 $old$  if v_left > 0 then
    if v_visit.customer_id is null then$old$,
 $new$  if v_bd_used and v_left > 0 then
    raise exception using errcode='P0001', message='BACKDATE_SISA: nominal melebihi sisa tagihan bertanggal efektif; kelebihan uang tidak boleh dicatat sebagai uang muka pada tanggal mundur. Kurangi nominalnya';
  end if;
  if v_left > 0 then
    if v_visit.customer_id is null then$new$, 1),
-- ============================== pratinjau: tanggal efektif, batas, hak, penolakan tanggal ==============================
('public.clinic_cancel_invoice_receipt_preview(uuid)',
 $old$CREATE OR REPLACE FUNCTION public.clinic_cancel_invoice_receipt_preview(p_invoice_id uuid)$old$,
 $new$CREATE OR REPLACE FUNCTION public.clinic_cancel_invoice_receipt_preview(p_invoice_id uuid, p_effective_date date DEFAULT NULL::date)$new$, 1),
('public.clinic_cancel_invoice_receipt_preview(uuid)',
 $old$  v_cash numeric := 0; v_mode text; v_el jsonb; v_rc numeric := 0;
begin$old$,
 $new$  v_cash numeric := 0; v_mode text; v_el jsonb; v_rc numeric := 0;
  v_today date := (now() at time zone 'Asia/Jakarta')::date; v_min date; v_dchk jsonb;
begin$new$, 1),
('public.clinic_cancel_invoice_receipt_preview(uuid)',
 $old$  return v_scan || jsonb_build_object('actor', v_actor, 'cash_amount', v_cash, 'shift_mode', v_mode, 'kwitansi_tunai_tanpa_shift', v_rc, 'today', (now() at time zone 'Asia/Jakarta')::date);$old$,
 $new$  -- BACKDATE_KLINIK: batas tanggal, hak memilih tanggal mundur, dan alasan tanggal yang dipilih ditolak (periode/persediaan/gaji) untuk layar.
  v_min := case when v_scan -> 'refuse' is not null and jsonb_typeof(v_scan -> 'refuse') = 'object' then null
                else clinic_private.cancel_receipt_orig_date(p_invoice_id, v_scan) end;
  v_dchk := case when p_effective_date is null then null
                 else clinic_private.cancel_receipt_date_check(p_effective_date, v_today, v_min, v_actor) end;
  return v_scan || jsonb_build_object('actor', v_actor, 'cash_amount', v_cash, 'shift_mode', v_mode, 'kwitansi_tunai_tanpa_shift', v_rc, 'today', v_today,
    'min_date', v_min, 'max_date', v_today, 'can_backdate', clinic_private.cancel_receipt_backdate_ok(v_actor),
    'effective_date', coalesce(p_effective_date, v_today), 'date_refuse', v_dchk,
    'window', (select jsonb_build_object('effective_date', w.effective_date, 'opened_at', w.opened_at)
               from public.clinic_backdate_windows w where w.invoice_id = p_invoice_id and w.status = 'terbuka'));$new$, 1),
-- ============================== executor: p_effective_date ==============================
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$CREATE OR REPLACE FUNCTION public.clinic_cancel_invoice_receipt(p_invoice_id uuid, p_request_key text, p_reason text)$old$,
 $new$CREATE OR REPLACE FUNCTION public.clinic_cancel_invoice_receipt(p_invoice_id uuid, p_request_key text, p_reason text, p_effective_date date DEFAULT NULL::date)$new$, 1),
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$  v_audit uuid; v_result jsonb; v_ids uuid[];
begin$old$,
 $new$  v_audit uuid; v_result jsonb; v_ids uuid[];
  v_eff date; v_min date; v_dchk jsonb;
begin$new$, 1),
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$  v_hash := md5(jsonb_build_object('invoice', p_invoice_id, 'reason', v_reason)::text);$old$,
 $new$  -- BACKDATE_KLINIK: tanpa tanggal, sidik sama persis dengan versi lama (ulang kirim lama tetap aman); dengan tanggal, tanggal ikut sidik.
  v_hash := md5((jsonb_build_object('invoice', p_invoice_id, 'reason', v_reason)
                 || case when p_effective_date is null then '{}'::jsonb else jsonb_build_object('effective', p_effective_date) end)::text);$new$, 1),
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$  select l.closed_until into v_closed from public.accounting_locks l where l.id;
  if v_closed is not null and v_today <= v_closed then$old$,
 $new$  v_eff := coalesce(p_effective_date, v_today);
  if v_eff > v_today then
    raise exception using errcode = 'P0001', message = format('BATAL_PENERIMAAN_TANGGAL_MASA_DEPAN: tanggal efektif %s belum tiba; paling jauh hari ini (%s)', v_eff, v_today);
  end if;
  select l.closed_until into v_closed from public.accounting_locks l where l.id;
  if v_eff = v_today and v_closed is not null and v_today <= v_closed then$new$, 1),
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$  v_branch := v_vis.branch_id;
$old$,
 $new$  v_branch := v_vis.branch_id;
  if v_eff < v_today then
    -- Tanggal mundur: batas bawah = tanggal penerimaan asli; periode akuntansi/persediaan/gaji tidak tertutup; hak Owner atau izin tertulis.
    v_min := clinic_private.cancel_receipt_orig_date(p_invoice_id, v_scan);
    v_dchk := clinic_private.cancel_receipt_date_check(v_eff, v_today, v_min, v_actor);
    if v_dchk is not null then
      raise exception using errcode = 'P0001', message = 'BATAL_PENERIMAAN_' || (v_dchk ->> 'code') || ': ' || (v_dchk ->> 'message');
    end if;
  end if;
$new$, 1),
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$values (v_inv.id, v_today, -v_app.amount, 'Uang Muka',$old$, $new$values (v_inv.id, v_eff, -v_app.amount, 'Uang Muka',$new$, 1),
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$values (v_inv.id, v_today, -(v_el ->> 'amount')::numeric,$old$, $new$values (v_inv.id, v_eff, -(v_el ->> 'amount')::numeric,$new$, 1),
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$values (v_target, v_today, -v_row.amount,$old$, $new$values (v_target, v_eff, -v_row.amount,$new$, 1),
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$public.clinic_write_journal(v_today,$old$, $new$public.clinic_write_journal(v_eff,$new$, 5),
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$'applications_released', jsonb_array_length(v_detail -> 'applications'), 'tanggal', v_today);$old$,
 $new$'applications_released', jsonb_array_length(v_detail -> 'applications'), 'tanggal', v_eff,
    'effective_date', v_eff, 'actual_date', v_today, 'recorded_at', now(), 'backdated', v_eff < v_today);$new$, 1),
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$    detail, journal_ids, before_invoice, after_invoice, result)$old$,
 $new$    detail, journal_ids, before_invoice, after_invoice, result, effective_date)$new$, 1),
('public.clinic_cancel_invoice_receipt(uuid,text,text)',
 $old$    v_detail, v_journals, to_jsonb(v_inv), to_jsonb(v_after), v_result);
  return v_result;$old$,
 $new$    v_detail, v_journals, to_jsonb(v_inv), to_jsonb(v_after), v_result, v_eff);
  -- Jendela tanggal efektif: sampai tagihan ini Lunas lagi (atau Owner melepasnya), koreksi tagihan dan penerimaan ulang dibukukan pada tanggal itu.
  foreach v_t in array v_targets loop
    if v_eff < v_today then
      insert into public.clinic_backdate_windows(invoice_id, cancellation_id, branch_id, effective_date, status, opened_by)
      values (v_t, v_audit, v_branch, v_eff, 'terbuka', v_user)
      on conflict (invoice_id) do update set cancellation_id = excluded.cancellation_id, branch_id = excluded.branch_id,
        effective_date = excluded.effective_date, status = 'terbuka', opened_by = excluded.opened_by, opened_at = now(),
        closed_at = null, closed_by = null, close_reason = null;
    else
      perform clinic_private.backdate_window_close(v_t, 'diganti', v_user, 'pembatalan penerimaan baru bertanggal hari ini');
    end if;
  end loop;
  return v_result;$new$, 1);

do $bd$
declare
  p record; q record; definition text; pre text; n_found integer; newsig text;
begin
  for p in select distinct sig from bd_patch order by sig loop
    definition := pg_get_functiondef(p.sig::regprocedure);
    if position('BACKDATE_KLINIK' in definition) > 0 then
      raise exception 'BACKDATE_KLINIK already applied to %; inspect before re-running', p.sig;
    end if;
    pre := (select format('%s|%s|%s|%s|%s|%s', proowner, proacl, prosecdef, proconfig, prorettype, provolatile) from pg_proc where oid = p.sig::regprocedure);
    for q in select * from bd_patch where sig = p.sig order by n loop
      n_found := (length(definition) - length(replace(definition, q.old_text, ''))) / length(q.old_text);
      if n_found <> q.times then
        raise exception 'BACKDATE_KLINIK_DRIFT: % changed (anchor % found % times, expected %); review before release', p.sig, q.n, n_found, q.times;
      end if;
      definition := replace(definition, q.old_text, q.new_text);
    end loop;
    if p.sig in ('public.clinic_cancel_invoice_receipt(uuid,text,text)', 'public.clinic_cancel_invoice_receipt_preview(uuid)') then
      -- tanda tangan baru (parameter bertanggal, default null): fungsi lama dibuang agar tidak ada overload ganda; panggilan lama (tanpa tanggal) tetap sah.
      execute definition;
      execute 'drop function ' || p.sig;
    else
      execute definition;
      if pre is distinct from (select format('%s|%s|%s|%s|%s|%s', proowner, proacl, prosecdef, proconfig, prorettype, provolatile) from pg_proc where oid = p.sig::regprocedure) then
        raise exception 'BACKDATE_KLINIK: pemilik/ACL/definer/config % berubah setelah ditambal', p.sig;
      end if;
      if position('BACKDATE_KLINIK' in pg_get_functiondef(p.sig::regprocedure)) = 0 then
        raise exception 'BACKDATE_KLINIK: definisi % tidak sesuai setelah ditambal', p.sig;
      end if;
    end if;
  end loop;
end $bd$;

-- fungsi baru bertanda tangan baru: izin sama seperti yang lama (hanya authenticated, bukan anon/service_role)
revoke all on function public.clinic_cancel_invoice_receipt(uuid, text, text, date) from public, anon, service_role;
grant execute on function public.clinic_cancel_invoice_receipt(uuid, text, text, date) to authenticated;
revoke all on function public.clinic_cancel_invoice_receipt_preview(uuid, date) from public, anon, service_role;
grant execute on function public.clinic_cancel_invoice_receipt_preview(uuid, date) to authenticated;

-- ───────────────────────── Owner melepas tanggal efektif ─────────────────────────
create function public.clinic_backdate_release(p_invoice_id uuid, p_reason text) returns jsonb
language plpgsql volatile security definer set search_path = '' set lock_timeout = '8s' as $$
declare
  v_actor text := clinic_private.cancel_receipt_actor(); v_reason text := nullif(btrim(p_reason), ''); v_w public.clinic_backdate_windows%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: hanya Owner (atau peran yang diberi izin "Batalkan penerimaan" di Akses Grup) yang boleh melepas tanggal efektif';
  end if;
  if p_invoice_id is null or v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'RECEIPT_INVALID: alasan wajib diisi (3 sampai 500 huruf)';
  end if;
  perform clinic_private.billing_lock(clinic_private.billing_keys_invoice(p_invoice_id));
  select * into v_w from public.clinic_backdate_windows where invoice_id = p_invoice_id for update;
  if not found or not public.user_can_access_branch(v_w.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: tagihan tidak ditemukan atau cabang tidak diizinkan';
  end if;
  if v_w.status <> 'terbuka' then
    raise exception using errcode = 'P0001', message = 'BACKDATE_TIDAK_ADA: tagihan ini tidak sedang memakai tanggal efektif';
  end if;
  perform clinic_private.backdate_window_close(p_invoice_id, 'dilepas', auth.uid(), v_reason);
  return jsonb_build_object('status', 'DILEPAS', 'invoice_id', p_invoice_id, 'effective_date', v_w.effective_date);
end $$;
revoke all on function public.clinic_backdate_release(uuid, text) from public, anon, service_role;
grant execute on function public.clinic_backdate_release(uuid, text) to authenticated;

-- ───────────────────────── Finance: jurnal klinik yang tanggalnya lebih awal dari saat dicatat ─────────────────────────
create function public.clinic_backdated_entries(p_from date, p_to date, p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.user_role;
begin
  select p.role into v_role from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_role is null or v_role not in ('OWNER', 'ADMIN', 'FINANCE') then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: hanya Owner, Admin, atau Finance';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception using errcode = 'P0001', message = 'RANGE_INVALID: rentang tanggal tidak valid (paling lama 1 tahun)';
  end if;
  return coalesce((select jsonb_agg(x order by x ->> 'tanggal', x ->> 'dicatat_pada') from (
    select jsonb_build_object('no_jurnal', e.no_jurnal, 'tanggal', e.tanggal, 'dicatat_pada', e.created_at, 'sumber', e.source, 'ref', e.source_ref,
      'branch_id', e.branch_id, 'jumlah', (select coalesce(sum(l.debit), 0) from public.journal_lines l where l.entry_id = e.id),
      'rekening', (select string_agg(distinct a.code, ',' order by a.code) from public.journal_lines l join public.coa_accounts a on a.id = l.account_id
                   where l.entry_id = e.id and a.type = 'ASET' and a.code <> '150001')) as x
    from public.journal_entries e
    where e.source like 'klinik%' and e.voided_at is null and e.tanggal between p_from and p_to
      and e.tanggal < (e.created_at at time zone 'Asia/Jakarta')::date
      and e.branch_id is not null and public.user_can_access_branch(e.branch_id) and (p_branch is null or e.branch_id = p_branch)
    order by e.tanggal, e.created_at limit 1000) s), '[]'::jsonb);
end $$;
revoke all on function public.clinic_backdated_entries(date, date, uuid) from public, anon, service_role;
grant execute on function public.clinic_backdated_entries(date, date, uuid) to authenticated;
