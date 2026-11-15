-- "Batalkan penerimaan" KLINIK, gaya Accurate (permintaan Andri 11 Nov 2026): uang yang sudah DITERIMA pada satu tagihan klinik
-- (rawat jalan DAN rawat inap; tunai/QRIS/transfer/debit/kredit/e-wallet/uang muka) dibatalkan dalam SATU transaksi:
--   uang keluar dari kas/bank (jurnal pembalik), tagihan kembali "Belum Lunas" dengan nomor yang sama dan terbuka untuk
--   dikoreksi lewat jalur koreksi yang ada (Owner ubah harga/qty/baris/BMHP), lalu diterima lagi sesuai tagihan baru.
--
-- Hanya objek BARU. Tidak ada fungsi lama yang diganti: clinic_void_payment_receipt, clinic_release_advance_application,
-- clinic_edit_invoice_core, clinic_write_journal, sync_paid_status tidak tersentuh (dipanggil/ditiru saja).
--   * public.clinic_receipt_cancellations  : jejak pembatalan tambah-saja (alasan, pelaku, waktu, kunci, efek shift, rincian).
--   * role_settings_private.action_catalog : 'klinik.batalkan_penerimaan' (izin untuk peran selain Owner; bawaan MATI).
--   * clinic_private.cancel_receipt_actor  : Owner selalu boleh (tanpa membaca tabel kebijakan); peran lain HANYA bila izinnya
--                                            tertulis eksplisit di kebijakan aksi peran itu (bukan "bawaan lama = semua").
--   * clinic_private.cancel_receipt_scan   : membaca (tanpa ubah) apa yang bisa dibatalkan + penolakan dengan bahasa biasa.
--   * public.clinic_cancel_receipt_allowed()                                -> boolean (untuk layar: tampilkan tombol atau tidak)
--   * public.clinic_cancel_invoice_receipt_preview(p_invoice_id)            -> jsonb (pratinjau baca-saja)
--   * public.clinic_cancel_invoice_receipt(p_invoice_id, p_request_key, p_reason) -> jsonb (eksekusi atomik)
--
-- ATURAN (keputusan, mudah dibalik di bagian declare/komentar):
--   * Jurnal pembalik bertanggal HARI INI (WIB). Tidak ada tanggal mundur (periode terkunci ditolak oleh pagar jurnal).
--   * Stok, HPP, jurnal penjualan TIDAK disentuh. Pembatalan penerimaan bukan void tagihan.
--   * Penerimaan langsung (lunas sekali bayar / DP di kepala tagihan): Dr 150001 Piutang / Cr rekening penerimaan asal, sumber 'klinik-edit'
--     (sama dengan jurnal koreksi, sehingga koreksi tagihan berikutnya membalikkannya bersih). Pembayaran bertabel (kwitansi,
--     pelunasan piutang, bagian checkout): baris pembalik (jumlah negatif, reversal_of) + Dr 150001 / Cr rekening, sumber 'klinik-ar'.
--   * Kwitansi dibatalkan UTUH (semua tagihan yang dilunasinya kembali belum lunas; daftar tagihan itu dikembalikan ke layar).
--     Uang muka yang dibuat kwitansi itu ikut batal BILA belum terpakai; bila sudah terpakai tagihan lain: ditolak dengan petunjuk.
--   * Pemakaian uang muka pada tagihan dibatalkan: jumlahnya kembali ke saldo uang muka pasien (tetap aktif, bisa dipakai lagi).
--   * Shift: bila shift asal masih TERBUKA, efeknya otomatis di sana; bila sudah TUTUP, rekaman shift lama TIDAK diubah dan
--     koreksi tunai dicatat di shift Owner yang sedang terbuka; tanpa shift terbuka tetap boleh (Owner tidak dikunci) dan
--     ditandai 'tanpa_shift' untuk Finance.
--   * Poin loyalti dicatat aplikasi saat tagihan terbit; pembatalan penerimaan TIDAK mengubahnya (sama dengan Void/Koreksi).
create table public.clinic_receipt_cancellations (
  id uuid primary key default gen_random_uuid(),
  request_key text not null,
  request_hash text not null,
  actor_id uuid not null,
  actor_role text not null,
  invoice_id uuid not null references public.invoices(id),
  invoice_no text not null,
  visit_id uuid not null,
  branch_id uuid not null,
  reason text not null,
  tanggal date not null,
  total_amount numeric(15,2) not null,
  direct_amount numeric(15,2) not null default 0,
  cash_amount numeric(15,2) not null default 0,
  shift_mode text not null,
  source_shift_id uuid,
  source_shift_status text,
  cancel_shift_id uuid,
  detail jsonb not null,
  journal_ids uuid[] not null default '{}',
  before_invoice jsonb not null,
  after_invoice jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint clinic_receipt_cancellations_key unique (request_key),
  constraint clinic_receipt_cancellations_reason check (length(btrim(reason)) between 3 and 500),
  constraint clinic_receipt_cancellations_amount check (total_amount > 0 and direct_amount >= 0 and cash_amount >= 0),
  constraint clinic_receipt_cancellations_mode check (shift_mode in ('nonkas', 'shift_asal_terbuka', 'shift_berjalan', 'tanpa_shift'))
);
create index clinic_receipt_cancellations_invoice on public.clinic_receipt_cancellations (invoice_id, created_at);
create index clinic_receipt_cancellations_shift on public.clinic_receipt_cancellations (cancel_shift_id) where cancel_shift_id is not null;
alter table public.clinic_receipt_cancellations enable row level security;
create policy clinic_receipt_cancellations_read on public.clinic_receipt_cancellations for select to authenticated
  using (public.user_can_access_branch(branch_id));
revoke all on public.clinic_receipt_cancellations from public, anon, authenticated, service_role;
grant select on public.clinic_receipt_cancellations to authenticated;

create function clinic_private.receipt_cancellation_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = 'AUDIT_IMMUTABLE: jejak pembatalan penerimaan tidak dapat diubah atau dihapus';
end $$;
revoke all on function clinic_private.receipt_cancellation_immutable() from public, anon, authenticated, service_role;
create trigger clinic_receipt_cancellations_immutable before update or delete on public.clinic_receipt_cancellations
  for each row execute function clinic_private.receipt_cancellation_immutable();
create trigger clinic_receipt_cancellations_truncate before truncate on public.clinic_receipt_cancellations
  for each statement execute function clinic_private.receipt_cancellation_immutable();

-- Izin untuk peran selain Owner (bawaan MATI: lihat clinic_private.cancel_receipt_actor).
insert into role_settings_private.action_catalog(id, label, "group", enforced)
values ('klinik.batalkan_penerimaan', 'Batalkan penerimaan — Pembayaran klinik', 'Klinik', true)
on conflict (id) do nothing;
insert into role_settings_private.action_modules(id, module_id)
values ('klinik.batalkan_penerimaan', 'klinik')
on conflict (id) do nothing;

create function clinic_private.cancel_receipt_actor() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.user_role; v_ok boolean := false;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then return null; end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_role is null then return null; end if;
  -- Owner tidak pernah dikunci oleh tabel kebijakan: tidak ada pembacaan yang bisa menolaknya.
  if v_role = 'OWNER' then return 'OWNER'; end if;
  begin
    -- Peran lain: HARUS ada izin tertulis eksplisit (kebijakan "bawaan lama" = semua aksi bukan izin tertulis) dan lolos pagar modul/epoch.
    v_ok := exists (select 1 from role_settings_private.action_policies a
                    where a.role = v_role and 'klinik.batalkan_penerimaan' = any (a.allowed))
            and public.role_action_allowed('klinik.batalkan_penerimaan');
  exception when others then
    v_ok := false;   -- gagal baca untuk peran lain = ditolak
  end;
  return case when v_ok then 'GRANT' else null end;
end $$;
revoke all on function clinic_private.cancel_receipt_actor() from public, anon, authenticated, service_role;

-- Pembacaan tanpa ubah. Mengembalikan jsonb:
--   refuse  : null atau {code, message}  (penolakan dengan bahasa biasa)
--   direct  : null atau {amount, kas_code, metode}
--   payments: pembayaran bertabel tanpa kwitansi/uang muka [{id, amount, metode, kas_code, checkout}]
--   apps    : pemakaian uang muka [{application_id, advance_id, advance_no, payment_id, amount}]
--   receipts: kwitansi [{id, no, tanggal, total, shift_id, parts, other_invoices, advance}]
create function clinic_private.cancel_receipt_scan(p_invoice_id uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_inv public.invoices%rowtype; v_vis public.visits%rowtype;
  v_direct numeric(15,2) := 0; v_code text; v_ncode integer; v_debit numeric;
  v_pays jsonb := '[]'::jsonb; v_apps jsonb := '[]'::jsonb; v_rcpts jsonb := '[]'::jsonb;
  v_p record; v_app public.clinic_advance_applications%rowtype; v_adv public.clinic_customer_advances%rowtype;
  v_r public.clinic_payment_receipts%rowtype; v_others jsonb; v_advj jsonb; v_used text;
  v_refuse jsonb := null; v_seen uuid[] := array[]::uuid[];
  v_out jsonb;
begin
  select * into v_inv from public.invoices where id = p_invoice_id;
  if not found then
    return jsonb_build_object('refuse', jsonb_build_object('code', 'TAGIHAN', 'message', 'Tagihan tidak ditemukan.'));
  end if;
  select * into v_vis from public.visits where id = v_inv.visit_id;
  if v_inv.voided_at is not null then
    v_refuse := jsonb_build_object('code', 'TAGIHAN_BATAL', 'message', 'Tagihan ini sudah dibatalkan (void); tidak ada penerimaan yang bisa dibatalkan.');
  elsif v_inv.request_key is null or v_inv.invoice_no is null then
    v_refuse := jsonb_build_object('code', 'TAGIHAN_BELUM_TERBIT', 'message', 'Tagihan belum selesai tersimpan.');
  elsif v_inv.correction_pending then
    v_refuse := jsonb_build_object('code', 'KOREKSI_BERJALAN', 'message', 'Tagihan ini sedang dalam koreksi (hasil Void & Terbitkan Ulang). Selesaikan koreksinya lebih dulu.');
  elsif v_inv.reissued_from is not null then
    v_refuse := jsonb_build_object('code', 'TERBIT_ULANG', 'message', 'Tagihan ini hasil Void & Terbitkan Ulang; uangnya berasal dari tagihan lama sehingga belum bisa dibatalkan dari sini. Hubungi tim pengembang.');
  elsif exists (select 1 from public.clinic_refunds where invoice_id = v_inv.id)
     or exists (select 1 from public.clinic_refund_requests where invoice_id = v_inv.id and status in ('pending', 'diproses')) then
    v_refuse := jsonb_build_object('code', 'SUDAH_REFUND', 'message', 'Tagihan ini sudah/sedang direfund. Selesaikan atau batalkan refund-nya dulu, lalu batalkan penerimaan.');
  elsif exists (select 1 from public.clinic_demo_invoice_snapshots where invoice_id = v_inv.id) then
    v_refuse := jsonb_build_object('code', 'DEMO', 'message', 'Uang dan pembagian insentif tagihan DEMO terkunci; penerimaannya tidak bisa dibatalkan dari sini.');
  elsif exists (select 1 from public.invoice_payments where invoice_id = v_inv.id and transferred_from is not null) then
    v_refuse := jsonb_build_object('code', 'PINDAHAN', 'message', 'Sebagian pembayaran tagihan ini berasal dari tagihan lama (pindahan terbit ulang); belum bisa dibatalkan dari sini.');
  end if;
  if v_refuse is not null then
    return jsonb_build_object('refuse', v_refuse, 'invoice', jsonb_build_object('id', v_inv.id, 'no', v_inv.invoice_no,
      'total', v_inv.total, 'paid_status', v_inv.paid_status, 'metode_bayar', v_inv.metode_bayar, 'dp_amount', v_inv.dp_amount,
      'shift_id', v_inv.shift_id, 'visit_id', v_inv.visit_id, 'branch_id', v_vis.branch_id, 'customer_id', v_vis.customer_id));
  end if;

  -- 1) penerimaan langsung di kepala tagihan (lunas sekali bayar / DP)
  v_direct := case when v_inv.paid_status = 'Lunas' and not exists (select 1 from public.invoice_payments where invoice_id = v_inv.id)
                   then v_inv.total else coalesce(v_inv.dp_amount, 0) end;
  if v_direct > 0 then
    -- Rekening penerimaan = SATU rekening kas/bank yang saldo bersih debitnya sama dengan uang yang diterima, dihitung dari seluruh
    -- jurnal tagihan ini (terbit, koreksi, koreksi metode bayar). Cara ini juga benar untuk tagihan yang pernah dikoreksi dengan
    -- skrip sekali-jalan (jurnal 'klinik' asli masih memuat total lama). Tidak tunggal / tidak sama = ditolak, tidak menebak.
    select count(*), min(x.code), min(x.net) into v_ncode, v_code, v_debit
    from (select a.code, sum(l.debit - l.credit) as net
          from public.journal_entries e join public.journal_lines l on l.entry_id = e.id
          join public.coa_accounts a on a.id = l.account_id
          where e.source_ref = v_inv.invoice_no and e.voided_at is null
            and e.source in ('klinik', 'klinik-edit', 'klinik-reissue', 'klinik-koreksi-bayar')
            and a.type = 'ASET' and a.code <> '150001'
          group by a.code having sum(l.debit - l.credit) <> 0) x;
    if v_ncode <> 1 or v_debit is distinct from v_direct then
      v_refuse := jsonb_build_object('code', 'REKENING', 'message', 'Rekening penerimaan awal tagihan ini tidak bisa dipastikan dari jurnalnya. Tidak ada yang diubah; hubungi tim pengembang.');
    end if;
    if v_refuse is null and v_inv.dp_amount > 0
       and exists (select 1 from public.clinic_payment_corrections where invoice_id = v_inv.id) then
      v_refuse := jsonb_build_object('code', 'DP_DIKOREKSI', 'message', 'DP tagihan ini pernah dikoreksi metode bayarnya; belum bisa dibatalkan dari sini.');
    end if;
  end if;

  -- 2) pembayaran bertabel yang belum dibalik
  for v_p in
    select p.* from public.invoice_payments p
    where p.invoice_id = v_inv.id and p.amount > 0 and p.reversal_of is null
      and not exists (select 1 from public.invoice_payments r where r.reversal_of = p.id)
    order by p.created_at, p.id
  loop
    select * into v_app from public.clinic_advance_applications a where a.payment_id = v_p.id and a.released_at is null;
    if found then
      select * into v_adv from public.clinic_customer_advances where id = v_app.advance_id;
      v_apps := v_apps || jsonb_build_array(jsonb_build_object('application_id', v_app.id, 'advance_id', v_app.advance_id,
        'advance_no', v_adv.no_uang_muka, 'payment_id', v_p.id, 'amount', v_p.amount));
    elsif v_p.metode = 'Uang Muka' then
      v_refuse := coalesce(v_refuse, jsonb_build_object('code', 'DATA_UANG_MUKA', 'message', 'Pembayaran uang muka pada tagihan ini tidak punya catatan pemakaian yang lengkap; tidak ada yang diubah. Hubungi tim pengembang.'));
    elsif v_p.receipt_id is not null then
      if not (v_p.receipt_id = any (v_seen)) then
        v_seen := v_seen || v_p.receipt_id;
        select * into v_r from public.clinic_payment_receipts where id = v_p.receipt_id;
        if not found or v_r.status <> 'aktif' then
          v_refuse := coalesce(v_refuse, jsonb_build_object('code', 'DATA_KWITANSI', 'message', 'Pembayaran tagihan ini menunjuk kwitansi yang tidak aktif; tidak ada yang diubah. Hubungi tim pengembang.'));
        else
          select coalesce(jsonb_agg(jsonb_build_object('invoice_id', x.invoice_id, 'no', x.no, 'amount', x.amount) order by x.no), '[]'::jsonb)
            into v_others
          from (select o.invoice_id, i.invoice_no as no, sum(o.amount) as amount from public.invoice_payments o
                join public.invoices i on i.id = o.invoice_id
                where o.receipt_id = v_r.id and o.amount > 0 and o.reversal_of is null and o.invoice_id <> v_inv.id
                group by o.invoice_id, i.invoice_no) x;
          v_advj := null;
          select * into v_adv from public.clinic_customer_advances where receipt_id = v_r.id and status = 'aktif';
          if found then
            v_advj := jsonb_build_object('id', v_adv.id, 'no', v_adv.no_uang_muka, 'amount', v_adv.amount, 'applied', v_adv.applied,
              'refunded', v_adv.refunded_amount, 'reserved', v_adv.refund_reserved);
            if v_adv.refunded_amount > 0 or v_adv.refund_reserved > 0 then
              v_refuse := coalesce(v_refuse, jsonb_build_object('code', 'UANG_MUKA_DIKEMBALIKAN', 'message',
                format('Uang muka %s dari kwitansi %s sudah/sedang dikembalikan ke pelanggan, jadi kwitansinya tidak bisa dibatalkan. Batalkan pengembaliannya lebih dulu.', v_adv.no_uang_muka, v_r.no_kwitansi)));
            elsif v_adv.applied > 0 then
              select string_agg(distinct i.invoice_no, ', ') into v_used
              from public.clinic_advance_applications a join public.invoices i on i.id = a.invoice_id
              where a.advance_id = v_adv.id and a.released_at is null;
              v_refuse := coalesce(v_refuse, jsonb_build_object('code', 'UANG_MUKA_DIPAKAI', 'message',
                format('Kwitansi %s membuat uang muka %s yang sudah dipakai melunasi tagihan %s. Batalkan penerimaan tagihan itu lebih dulu (uangnya kembali ke saldo), lalu batalkan penerimaan ini.',
                  v_r.no_kwitansi, v_adv.no_uang_muka, coalesce(v_used, '-'))));
            end if;
          end if;
          v_rcpts := v_rcpts || jsonb_build_array(jsonb_build_object('id', v_r.id, 'no', v_r.no_kwitansi, 'tanggal', v_r.tanggal,
            'total', v_r.total, 'shift_id', v_r.shift_id, 'branch_id', v_r.branch_id,
            'parts', (select coalesce(jsonb_agg(jsonb_build_object('metode', pt.metode, 'amount', pt.amount, 'kas_code', pt.kas_code) order by pt.urutan), '[]'::jsonb)
                      from public.clinic_payment_receipt_parts pt where pt.receipt_id = v_r.id),
            'other_invoices', v_others, 'advance', v_advj));
        end if;
      end if;
    else
      v_pays := v_pays || jsonb_build_array(jsonb_build_object('id', v_p.id, 'amount', v_p.amount, 'metode', v_p.metode,
        'kas_code', v_p.kas_code, 'checkout', v_p.checkout_payment, 'receipt_id', null));
    end if;
  end loop;

  if v_refuse is null and v_direct <= 0 and jsonb_array_length(v_pays) = 0 and jsonb_array_length(v_apps) = 0 and jsonb_array_length(v_rcpts) = 0 then
    v_refuse := jsonb_build_object('code', 'BELUM_ADA_PENERIMAAN', 'message', 'Tagihan ini tidak punya penerimaan yang bisa dibatalkan (belum ada uang yang diterima, atau sudah dibatalkan).');
  end if;

  v_out := jsonb_build_object('refuse', v_refuse,
    'invoice', jsonb_build_object('id', v_inv.id, 'no', v_inv.invoice_no, 'total', v_inv.total, 'paid_status', v_inv.paid_status,
      'metode_bayar', v_inv.metode_bayar, 'dp_amount', v_inv.dp_amount, 'shift_id', v_inv.shift_id, 'visit_id', v_inv.visit_id,
      'branch_id', v_vis.branch_id, 'customer_id', v_vis.customer_id),
    'direct', case when v_direct > 0 then jsonb_build_object('amount', v_direct, 'kas_code', v_code, 'metode', v_inv.metode_bayar) else null end,
    'payments', v_pays, 'apps', v_apps, 'receipts', v_rcpts);
  return v_out;
end $$;
revoke all on function clinic_private.cancel_receipt_scan(uuid) from public, anon, authenticated, service_role;

-- Untuk layar: apakah akun ini boleh melihat/memakai tombol "Batalkan penerimaan" (bukan otorisasi; RPC memeriksa lagi).
create function public.clinic_cancel_receipt_allowed() returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  return clinic_private.cancel_receipt_actor() is not null;
end $$;
revoke all on function public.clinic_cancel_receipt_allowed() from public, anon, service_role;
grant execute on function public.clinic_cancel_receipt_allowed() to authenticated;

create function public.clinic_cancel_invoice_receipt_preview(p_invoice_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor text := clinic_private.cancel_receipt_actor(); v_scan jsonb; v_branch uuid; v_open boolean := false; v_src_open boolean := false;
  v_cash numeric := 0; v_mode text; v_el jsonb;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: hanya Owner (atau peran yang diberi izin "Batalkan penerimaan" di Akses Grup) yang boleh membatalkan penerimaan';
  end if;
  v_scan := clinic_private.cancel_receipt_scan(p_invoice_id);
  v_branch := nullif(v_scan #>> '{invoice,branch_id}', '')::uuid;
  if v_branch is null or not public.user_can_access_branch(v_branch) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: tagihan tidak ditemukan atau cabang tidak diizinkan';
  end if;
  v_cash := case when v_scan #>> '{invoice,metode_bayar}' = 'Tunai' then coalesce((v_scan #>> '{direct,amount}')::numeric, 0) else 0 end
    + coalesce((select sum((e ->> 'amount')::numeric) from jsonb_array_elements(v_scan -> 'payments') e
                where e ->> 'metode' = 'Tunai' and (e ->> 'checkout')::boolean), 0);
  select exists (select 1 from public.cashier_shifts s where s.id = nullif(v_scan #>> '{invoice,shift_id}', '')::uuid and s.status = 'open') into v_src_open;
  select exists (select 1 from public.cashier_shifts s where s.branch_id = v_branch and s.opened_by = auth.uid()
                 and s.shift_type = 'klinik' and s.status = 'open') into v_open;
  v_mode := case when v_cash <= 0 then 'nonkas' when v_src_open then 'shift_asal_terbuka' when v_open then 'shift_berjalan' else 'tanpa_shift' end;
  return v_scan || jsonb_build_object('actor', v_actor, 'cash_amount', v_cash, 'shift_mode', v_mode, 'today', (now() at time zone 'Asia/Jakarta')::date);
end $$;
revoke all on function public.clinic_cancel_invoice_receipt_preview(uuid) from public, anon, service_role;
grant execute on function public.clinic_cancel_invoice_receipt_preview(uuid) to authenticated;

create function public.clinic_cancel_invoice_receipt(p_invoice_id uuid, p_request_key text, p_reason text) returns jsonb
language plpgsql volatile security definer set search_path = '' set lock_timeout = '8s' as $$
declare
  v_user uuid := auth.uid();
  v_actor text := clinic_private.cancel_receipt_actor();
  v_role text;
  v_key text := nullif(btrim(p_request_key), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_hash text;
  v_prior public.clinic_receipt_cancellations%rowtype;
  v_vis public.visits%rowtype; v_inv public.invoices%rowtype; v_after public.invoices%rowtype;
  v_scan jsonb; v_el jsonb; v_branch uuid;
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_closed date;
  v_src_shift public.cashier_shifts%rowtype; v_my_shift public.cashier_shifts%rowtype; v_rshift public.cashier_shifts%rowtype;
  v_cash numeric(15,2) := 0; v_mode text; v_cancel_shift uuid; v_src_status text;
  v_direct numeric(15,2) := 0; v_total numeric(15,2) := 0; v_code text;
  v_pay_id uuid; v_journal uuid; v_journals uuid[] := array[]::uuid[];
  v_rec public.clinic_payment_receipts%rowtype; v_adv public.clinic_customer_advances%rowtype; v_app public.clinic_advance_applications%rowtype;
  v_row record; v_void_shift uuid; v_lines jsonb; v_sisa numeric(15,2); v_target uuid;
  v_targets uuid[] := array[p_invoice_id]; v_t uuid;
  v_detail jsonb := jsonb_build_object('receipts', '[]'::jsonb, 'applications', '[]'::jsonb, 'payments', '[]'::jsonb, 'direct', null);
  v_rcpt_nos text[] := array[]::text[]; v_other_nos text[] := array[]::text[]; v_nrec jsonb;
  v_audit uuid; v_result jsonb; v_ids uuid[];
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: hanya Owner (atau peran yang diberi izin "Batalkan penerimaan" di Akses Grup) yang boleh membatalkan penerimaan';
  end if;
  if p_invoice_id is null or v_key is null or length(v_key) > 100 or v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception using errcode = 'P0001', message = 'RECEIPT_INVALID: alasan pembatalan wajib diisi (3 sampai 500 huruf)';
  end if;
  select p.role::text into v_role from public.profiles p where p.id = v_user;
  v_hash := md5(jsonb_build_object('invoice', p_invoice_id, 'reason', v_reason)::text);

  -- LOCK-01: pembacaan tanpa kunci hanya untuk cabang, lalu koordinator, lalu kunci idempotensi, baru baris.
  select v.* into v_vis from public.visits v join public.invoices i on i.visit_id = v.id where i.id = p_invoice_id;
  if not found or not public.user_can_access_branch(v_vis.branch_id) then
    raise exception using errcode = 'P0001', message = 'ACCESS_DENIED: tagihan tidak ditemukan atau cabang tidak diizinkan';
  end if;
  perform clinic_private.billing_lock(clinic_private.billing_keys_invoice(p_invoice_id));
  perform pg_advisory_xact_lock(hashtextextended('clinic-receipt-cancel:' || v_key, 0));
  select * into v_prior from public.clinic_receipt_cancellations where request_key = v_key;
  if found then
    if v_prior.invoice_id is distinct from p_invoice_id or v_prior.request_hash is distinct from v_hash or v_prior.actor_id is distinct from v_user then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci pembatalan dipakai untuk permintaan berbeda';
    end if;
    return v_prior.result;
  end if;
  perform 1 from public.visits where id = v_vis.id for update;
  select * into v_inv from public.invoices where id = p_invoice_id for update;

  select l.closed_until into v_closed from public.accounting_locks l where l.id;
  if v_closed is not null and v_today <= v_closed then
    raise exception using errcode = 'P0001', message = format('PERIODE_TERKUNCI: periode akuntansi sampai %s sudah ditutup; pembalikan hari ini (%s) tidak bisa dibukukan', v_closed, v_today);
  end if;

  v_scan := clinic_private.cancel_receipt_scan(p_invoice_id);
  if v_scan -> 'refuse' is not null and jsonb_typeof(v_scan -> 'refuse') = 'object' then
    raise exception using errcode = 'P0001', message = 'BATAL_PENERIMAAN_' || (v_scan #>> '{refuse,code}') || ': ' || (v_scan #>> '{refuse,message}');
  end if;
  v_branch := v_vis.branch_id;
  v_direct := coalesce((v_scan #>> '{direct,amount}')::numeric, 0);
  v_code := v_scan #>> '{direct,kas_code}';

  -- Tunai yang menyangkut laci: penerimaan langsung bermetode Tunai + bagian checkout Tunai.
  v_cash := (case when v_inv.metode_bayar = 'Tunai' then v_direct else 0 end
    + coalesce((select sum((e ->> 'amount')::numeric) from jsonb_array_elements(v_scan -> 'payments') e
                where e ->> 'metode' = 'Tunai' and (e ->> 'checkout')::boolean), 0))::numeric(15,2);

  -- Shift (urutan kunci: tagihan -> kwitansi -> shift -> uang muka). Shift asal hanya dikunci (serialisasi dengan tutup shift).
  if v_inv.shift_id is not null then
    select * into v_src_shift from public.cashier_shifts where id = v_inv.shift_id for update;
    v_src_status := v_src_shift.status;
  end if;
  select * into v_my_shift from public.cashier_shifts s
   where s.branch_id = v_branch and s.opened_by = v_user and s.shift_type = 'klinik' and s.status = 'open' for update;
  v_mode := case when v_cash <= 0 then 'nonkas'
                 when v_src_status = 'open' then 'shift_asal_terbuka'
                 when v_my_shift.id is not null then 'shift_berjalan'
                 else 'tanpa_shift' end;
  v_cancel_shift := case v_mode when 'shift_asal_terbuka' then v_src_shift.id when 'shift_berjalan' then v_my_shift.id else null end;

  -- (A) pemakaian uang muka pada tagihan ini: kembali ke saldo uang muka pasien (uang muka tetap aktif).
  for v_el in select e from jsonb_array_elements(v_scan -> 'apps') e loop
    select * into v_adv from public.clinic_customer_advances where id = (v_el ->> 'advance_id')::uuid for update;
    select * into v_app from public.clinic_advance_applications where id = (v_el ->> 'application_id')::uuid for update;
    if v_app.released_at is not null or v_adv.status <> 'aktif' then
      raise exception using errcode = 'P0001', message = 'BATAL_PENERIMAAN_BERUBAH: pemakaian uang muka berubah saat diproses; muat ulang halaman lalu coba lagi';
    end if;
    insert into public.invoice_payments(invoice_id, tanggal, amount, metode, catatan, kas_code, created_by, reversal_of)
    values (v_inv.id, v_today, -v_app.amount, 'Uang Muka', 'Pembatalan penerimaan: pemakaian uang muka ' || v_adv.no_uang_muka,
      '314001', v_user, v_app.payment_id) returning id into v_pay_id;
    v_journal := public.clinic_write_journal(v_today, 'Pembatalan penerimaan ' || v_inv.invoice_no || ' (uang muka ' || v_adv.no_uang_muka || ')',
      'klinik-ar', v_inv.invoice_no, v_branch, jsonb_build_array(
        jsonb_build_object('code', '150001', 'debit', v_app.amount, 'credit', 0),
        jsonb_build_object('code', '314001', 'debit', 0, 'credit', v_app.amount)));
    v_journals := v_journals || v_journal;
    update public.clinic_advance_applications set released_at = now(), released_by = v_user, release_reason = v_reason,
      release_payment_id = v_pay_id where id = v_app.id;
    update public.clinic_customer_advances set applied = greatest(applied - v_app.amount, 0) where id = v_adv.id;
    v_total := v_total + v_app.amount;
    v_detail := jsonb_set(v_detail, '{applications}', (v_detail -> 'applications') || jsonb_build_array(jsonb_build_object(
      'advance_id', v_adv.id, 'advance_no', v_adv.no_uang_muka, 'amount', v_app.amount)));
  end loop;

  -- (B) pembayaran bertabel tanpa kwitansi (bagian checkout, pelunasan piutang).
  for v_el in select e from jsonb_array_elements(v_scan -> 'payments') e loop
    insert into public.invoice_payments(invoice_id, tanggal, amount, metode, catatan, kas_code, created_by, reversal_of, checkout_payment)
    values (v_inv.id, v_today, -(v_el ->> 'amount')::numeric, v_el ->> 'metode', 'Pembatalan penerimaan ' || v_inv.invoice_no,
      v_el ->> 'kas_code', v_user, (v_el ->> 'id')::uuid, (v_el ->> 'checkout')::boolean);
    v_journal := public.clinic_write_journal(v_today, 'Pembatalan penerimaan ' || v_inv.invoice_no, 'klinik-ar', v_inv.invoice_no, v_branch,
      jsonb_build_array(jsonb_build_object('code', '150001', 'debit', (v_el ->> 'amount')::numeric, 'credit', 0),
                        jsonb_build_object('code', v_el ->> 'kas_code', 'debit', 0, 'credit', (v_el ->> 'amount')::numeric)));
    v_journals := v_journals || v_journal;
    v_total := v_total + (v_el ->> 'amount')::numeric;
    v_detail := jsonb_set(v_detail, '{payments}', (v_detail -> 'payments') || jsonb_build_array(jsonb_build_object(
      'metode', v_el ->> 'metode', 'amount', (v_el ->> 'amount')::numeric, 'kas_code', v_el ->> 'kas_code')));
  end loop;

  -- (C) kwitansi: dibatalkan UTUH (urutan tetap menurut id supaya dua pembatalan bersamaan tidak saling menunggu berputar).
  for v_el in select e from jsonb_array_elements(v_scan -> 'receipts') e order by e ->> 'id' loop
    select * into v_rec from public.clinic_payment_receipts where id = (v_el ->> 'id')::uuid for update;
    if v_rec.status <> 'aktif' then
      raise exception using errcode = 'P0001', message = 'BATAL_PENERIMAAN_BERUBAH: kwitansi berubah saat diproses; muat ulang halaman lalu coba lagi';
    end if;
    -- shift pembatalan: shift asal kwitansi bila masih terbuka (saling meniadakan), kalau tidak shift Owner yang terbuka, kalau tidak kosong.
    v_void_shift := null;
    if v_rec.shift_id is not null then
      select * into v_rshift from public.cashier_shifts where id = v_rec.shift_id for update;
      if v_rshift.status = 'open' then v_void_shift := v_rshift.id; end if;
    end if;
    if v_void_shift is null and v_my_shift.id is not null and v_my_shift.branch_id = v_rec.branch_id then v_void_shift := v_my_shift.id; end if;
    select * into v_adv from public.clinic_customer_advances where receipt_id = v_rec.id and status = 'aktif' for update;
    if found and v_adv.applied > 0 then
      raise exception using errcode = 'P0001', message = 'BATAL_PENERIMAAN_UANG_MUKA_DIPAKAI: uang muka kwitansi ini sudah dipakai tagihan lain; batalkan penerimaan tagihan itu lebih dulu';
    end if;
    for v_row in select * from clinic_private.receipt_allocations(v_rec.id) loop
      v_target := v_row.target_invoice_id;
      insert into public.invoice_payments(invoice_id, tanggal, amount, metode, catatan, kas_code, created_by, receipt_id, reversal_of)
      values (v_target, v_today, -v_row.amount, v_row.metode, 'Pembatalan kwitansi ' || v_rec.no_kwitansi, v_row.kas_code, v_user, v_rec.id, v_row.payment_id);
      v_journal := public.clinic_write_journal(v_today, 'Pembatalan penerimaan ' || v_rec.no_kwitansi, 'klinik-ar',
        (select i.invoice_no from public.invoices i where i.id = v_target), v_branch,
        jsonb_build_array(jsonb_build_object('code', '150001', 'debit', v_row.amount, 'credit', 0),
                          jsonb_build_object('code', v_row.kas_code, 'debit', 0, 'credit', v_row.amount)));
      v_journals := v_journals || v_journal;
      if not (v_target = any (v_targets)) then v_targets := v_targets || v_target; end if;
      if v_target is distinct from v_inv.id then
        v_other_nos := v_other_nos || (select i.invoice_no::text from public.invoices i where i.id = v_target);
      else
        v_total := v_total + v_row.amount;
      end if;
    end loop;
    if v_adv.id is not null then
      update public.clinic_customer_advances set status = 'batal' where id = v_adv.id;
      select coalesce(jsonb_agg(jsonb_build_object('code', t.kas_code, 'debit', 0, 'credit', t.sisa) order by t.kas_code) filter (where t.sisa > 0), '[]'::jsonb),
             coalesce(sum(t.sisa), 0)
        into v_lines, v_sisa
      from (select pt.kas_code, sum(pt.amount) - coalesce((select sum(a.amount) from clinic_private.receipt_allocations(v_rec.id) a
                                                            where a.kas_code = pt.kas_code), 0) as sisa
            from public.clinic_payment_receipt_parts pt where pt.receipt_id = v_rec.id group by pt.kas_code) t;
      if v_sisa is distinct from v_adv.amount then
        raise exception using errcode = 'P0001', message = 'BATAL_PENERIMAAN_UANG_MUKA_TIDAK_COCOK: sisa per rekening tidak cocok dengan saldo uang muka; tidak ada yang diubah';
      end if;
      v_journal := public.clinic_write_journal(v_today, 'Pembatalan uang muka ' || v_adv.no_uang_muka, 'klinik-uang-muka-batal',
        v_adv.no_uang_muka, v_branch,
        jsonb_build_array(jsonb_build_object('code', '314001', 'debit', v_adv.amount, 'credit', 0)) || v_lines);
      v_journals := v_journals || v_journal;
    end if;
    update public.clinic_payment_receipts set status = 'batal', void_reason = v_reason, void_request_key = v_key,
      void_shift_id = v_void_shift, voided_by = v_user, voided_at = now() where id = v_rec.id;
    v_rcpt_nos := v_rcpt_nos || v_rec.no_kwitansi::text;
    v_detail := jsonb_set(v_detail, '{receipts}', (v_detail -> 'receipts') || jsonb_build_array(jsonb_build_object(
      'id', v_rec.id, 'no', v_rec.no_kwitansi, 'total', v_rec.total, 'void_shift_id', v_void_shift,
      'advance_cancelled', v_adv.no_uang_muka, 'parts', v_el -> 'parts')));
  end loop;

  -- (D) penerimaan langsung di kepala tagihan: piutang kembali, rekening asal dikeluarkan.
  if v_direct > 0 then
    v_journal := public.clinic_write_journal(v_today, 'Pembatalan penerimaan ' || v_inv.invoice_no, 'klinik-edit', v_inv.invoice_no, v_branch,
      jsonb_build_array(jsonb_build_object('code', '150001', 'debit', v_direct, 'credit', 0),
                        jsonb_build_object('code', v_code, 'debit', 0, 'credit', v_direct)));
    v_journals := v_journals || v_journal;
    if v_inv.dp_amount > 0 then
      update public.invoices set dp_amount = 0, dp_date = null where id = v_inv.id;
    end if;
    v_total := v_total + v_direct;
    v_detail := jsonb_set(v_detail, '{direct}', jsonb_build_object('amount', v_direct, 'kas_code', v_code, 'metode', v_inv.metode_bayar));
  end if;

  -- status bayar dihitung ulang dari uang yang MASIH tercatat; kunjungan yang sudah "Selesai" kembali "Pembayaran".
  foreach v_t in array v_targets loop
    perform clinic_private.sync_paid_status(v_t);
    update public.visits set status = 'Pembayaran'
     where id = (select i.visit_id from public.invoices i where i.id = v_t) and status = 'Selesai' and archived_at is null
       and exists (select 1 from public.invoices i2 where i2.visit_id = visits.id and i2.voided_at is null and i2.paid_status <> 'Lunas');
  end loop;
  select * into v_after from public.invoices where id = v_inv.id;
  if v_after.paid_status = 'Lunas' and v_after.total > 0 then
    raise exception using errcode = 'P0001', message = 'BATAL_PENERIMAAN_MASIH_LUNAS: status bayar tagihan tidak kembali ke belum lunas; tidak ada yang diubah';
  end if;
  if coalesce((select sum(l.debit - l.credit) from public.journal_lines l where l.entry_id = any (v_journals)), 0) <> 0 then
    raise exception using errcode = 'P0001', message = 'JOURNAL_UNBALANCED: jurnal pembatalan tidak seimbang; tidak ada yang diubah';
  end if;

  v_audit := gen_random_uuid();
  v_result := jsonb_build_object('status', 'CANCELLED', 'cancellation_id', v_audit, 'invoice_id', v_inv.id, 'invoice_no', v_inv.invoice_no,
    'paid_status', v_after.paid_status, 'amount', v_total, 'direct_amount', v_direct, 'cash_amount', v_cash, 'shift_mode', v_mode,
    'cancel_shift_id', v_cancel_shift, 'receipts', to_jsonb(v_rcpt_nos), 'other_invoices_unpaid', to_jsonb(v_other_nos),
    'applications_released', jsonb_array_length(v_detail -> 'applications'), 'tanggal', v_today);
  insert into public.clinic_receipt_cancellations(id, request_key, request_hash, actor_id, actor_role, invoice_id, invoice_no, visit_id, branch_id,
    reason, tanggal, total_amount, direct_amount, cash_amount, shift_mode, source_shift_id, source_shift_status, cancel_shift_id,
    detail, journal_ids, before_invoice, after_invoice, result)
  values (v_audit, v_key, v_hash, v_user, coalesce(v_role, '?'), v_inv.id, v_inv.invoice_no, v_inv.visit_id, v_branch,
    v_reason, v_today, v_total, v_direct, v_cash, v_mode, v_inv.shift_id, v_src_status, v_cancel_shift,
    v_detail, v_journals, to_jsonb(v_inv), to_jsonb(v_after), v_result);
  return v_result;
end $$;
revoke all on function public.clinic_cancel_invoice_receipt(uuid, text, text) from public, anon, service_role;
grant execute on function public.clinic_cancel_invoice_receipt(uuid, text, text) to authenticated;
