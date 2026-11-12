-- UBAH METODE BAYAR (Andri 12 Nov 2026: "Ubah metode payment proses ya"). Paket gabungan:
--  (A) koreksi metode ke SEMUA metode (Tunai, Transfer, Debit, Kredit, QRIS, E-Wallet) untuk invoice klinik rawat jalan
--      (correct_clinic_invoice_payment diperlebar). Dari paket "Koreksi metode semua metode" (review PASS-dengan-syarat) yang tertahan
--      sejak 7 Nov; isinya dipakai ulang, bukan ditulis ulang. BAGIAN PETSHOP paket itu SENGAJA TIDAK DIIKUTKAN: sedang dikerjakan sesi lain
--      (PR #412 semua-metode POS, PR #510 struk lama akun Kas Kecil); jangan duplikasi.
--  (B) BARU: koreksi metode satu BAGIAN KWITANSI klinik (rawat inap / pelunasan / uang muka): public.correct_clinic_receipt_part_method.
--      Kasus "pemilik bayar QRIS, kasir mengetik Tunai". Mengubah metode+rekening bagian kwitansi dan baris pembayaran turunannya,
--      jurnal reklas Dr rekening baru / Cr rekening lama bertanggal HARI INI, nomor kwitansi/tagihan sama, nominal/stok/poin/komisi tidak berubah.
--  (C) Izin khusus "Ubah metode bayar" (klinik.ubah_metode_bayar): bawaan MATI untuk peran selain Owner/Finance
--      (OWNER tidak pernah dikunci; FINANCE tetap boleh seperti aturan koreksi yang sudah live sejak Okt 2026).
-- Rekening tujuan memakai aturan penerimaan yang SUDAH live: clinic_private.kas_code / unit_posting_cash (peta rekening; tanpa peta:
-- Tunai -> 110003 dan Debit/Kredit/QRIS/Transfer/E-Wallet -> 120002). Tidak ada akun baru, tidak ada peta baru.
-- Kontrak lengkap: docs/superpowers/plans/2026-11-12-ubah-metode-bayar.md
-- Peran koreksi lama (OWNER/FINANCE, ditanam di fungsi) diganti satu aturan: clinic_private.ubah_metode_actor().

do $$ begin
 if to_regclass('public.clinic_payment_corrections') is null
  or to_regclass('public.clinic_demo_invoice_snapshots') is null
  or to_regprocedure('public.correct_clinic_invoice_payment(uuid,uuid,integer,text,text,text)') is null
  or to_regprocedure('public.role_action_allowed(text)') is null
  or to_regprocedure('clinic_private.kas_code(text,uuid)') is null
  or to_regprocedure('clinic_private.billing_lock(text[])') is null
  or to_regprocedure('clinic_private.billing_keys_receipt(uuid)') is null
  or to_regprocedure('public.clinic_write_journal(date,text,text,text,uuid,jsonb)') is null
  or to_regclass('public.clinic_payment_receipt_parts') is null
  or to_regclass('role_settings_private.action_catalog') is null
  or to_regclass('public.clinic_receipt_method_corrections') is not null then
  raise exception 'UBAH_METODE_SOURCE_CHANGED: tinjau kontrak ubah metode sebelum migrasi ini';end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Klinik: tabel audit menerima 6 metode dan koreksi label (rekening sama, tanpa jurnal).
-- ---------------------------------------------------------------------------
do $$
declare c record;dropped integer:=0;
begin
 for c in select conname from pg_constraint where conrelid='public.clinic_payment_corrections'::regclass and contype='c'
  and (pg_get_constraintdef(oid) like '%from_method%' or pg_get_constraintdef(oid) like '%to_method%'
   or pg_get_constraintdef(oid) like '%from_code%') loop
  execute format('alter table public.clinic_payment_corrections drop constraint %I',c.conname);
  dropped:=dropped+1;
 end loop;
 if dropped<>3 then raise exception 'KOREKSI_METODE_SOURCE_CHANGED: constraint audit klinik berubah (% ditemukan, 3 diharapkan)',dropped;end if;
end $$;
alter table public.clinic_payment_corrections
 add constraint clinic_payment_corrections_methods_chk check(
  from_method in('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet')
  and to_method in('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') and from_method<>to_method),
 -- Rekening beda = ada jurnal koreksi; rekening sama (peta bersama) = hanya label, tanpa jurnal.
 add constraint clinic_payment_corrections_journal_chk check((from_code=to_code)=(journal_id is null));
alter table public.clinic_payment_corrections alter column journal_id drop not null;

-- ---------------------------------------------------------------------------
-- 4. Klinik: correct_clinic_invoice_payment diperlebar (patch berjangkar, gagal-tertutup).
-- ---------------------------------------------------------------------------
do $patch$
declare
 signature regprocedure:='public.correct_clinic_invoice_payment(uuid,uuid,integer,text,text,text)'::regprocedure;
 body text;i integer;
 anchors text[]:=array[
  -- 1. metode tujuan: 6 metode
  $a$p_new_method not in('Tunai','Transfer')$a$,
  -- 2. metode sumber: 6 metode
  $a$old_method not in('Tunai','Transfer') then
  raise exception 'Hanya pembayaran Tunai atau Transfer yang dapat dikoreksi';end if;$a$,
  -- 3. invoice DEMO ditolak (setelah cek refund)
  $a$  raise exception 'Invoice sudah memiliki refund atau permintaan refund; rekonsiliasi sumber diperlukan';end if;$a$,
  -- 4. bagian milik kwitansi rawat inap ditolak
  $a$   raise exception 'Bagian pembayaran pindahan atau tanpa rekening memerlukan rekonsiliasi';end if;$a$,
  -- 5. rekening sama diizinkan (label saja)
  $a$if to_code is null or to_code=from_code then raise exception 'Rekening asal dan tujuan sama; periksa peta akun Tunai dan Transfer';end if;$a$,
  -- 6. akun aset: satu bila asal=tujuan
  $a$and type='ASET' and normal_balance='D')<>2 then raise exception 'Akun asal/tujuan bukan aset detail aktif';end if;$a$,
  -- 7. jurnal hanya bila rekening berbeda (awal)
  $a$ journal:=public.clinic_write_journal(today,'Koreksi metode pembayaran '$a$,
  -- 8. jurnal hanya bila rekening berbeda (akhir)
  $a$  raise exception 'Jurnal koreksi tidak lengkap atau tidak seimbang';end if;$a$,
  -- 9. peran: Owner/Finance/izin khusus
  $a$ perform 1 from public.profiles where id=actor and is_active and role in('OWNER','FINANCE') for share;
 if not found then raise exception 'Hanya Owner atau Finance aktif dapat mengoreksi metode pembayaran' using errcode='42501';end if;$a$,
  -- 10. rekening tujuan: aturan penerimaan live (clinic_private.kas_code), bukan baca peta mentah
  $a$ select ca.* into to_account from public.payment_account_map m join public.cash_accounts ca on ca.id=m.cash_account_id
  where m.metode=p_new_method and (m.branch_id=vis.branch_id or m.branch_id is null)
  order by m.branch_id nulls last limit 1;
 if not found or not to_account.is_active or (to_account.branch_id is not null and to_account.branch_id<>vis.branch_id) then
  raise exception 'Rekening % belum dipetakan atau tidak aktif untuk cabang ini',p_new_method;end if;
 to_code:=to_account.coa_code;$a$
 ];
 replacements text[]:=array[
  $r$p_new_method not in('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet')$r$,
  $r$old_method not in('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') then
  raise exception 'Metode pembayaran sumber tidak dikenal; rekonsiliasi diperlukan';end if;$r$,
  $r$  raise exception 'Invoice sudah memiliki refund atau permintaan refund; rekonsiliasi sumber diperlukan';end if;
 -- KOREKSI_SEMUA_METODE: fee per metode DEMO terkunci di snapshotnya; mengganti metode merusaknya.
 if exists(select 1 from public.clinic_demo_invoice_snapshots where invoice_id=inv.id) then
  raise exception 'Invoice DEMO memuat fee per metode dan insentif; metode tidak bisa diganti. Void dan terbitkan ulang invoice, atau hubungi Finance';end if;$r$,
  $r$   raise exception 'Bagian pembayaran pindahan atau tanpa rekening memerlukan rekonsiliasi';end if;
  if pay.receipt_id is not null then
   raise exception 'Pembayaran ini bagian dari kwitansi rawat inap; batalkan kwitansi lalu terima ulang dengan metode yang benar';end if;$r$,
  $r$if to_code is null then raise exception 'Rekening % belum dipetakan atau tidak aktif untuk cabang ini',p_new_method;end if;$r$,
  $r$and type='ASET' and normal_balance='D')<>(case when from_code=to_code then 1 else 2 end) then raise exception 'Akun asal/tujuan bukan aset detail aktif';end if;$r$,
  $r$ if from_code<>to_code then
 journal:=public.clinic_write_journal(today,'Koreksi metode pembayaran '$r$,
  $r$  raise exception 'Jurnal koreksi tidak lengkap atau tidak seimbang';end if;
 end if;$r$,
  $r$ perform 1 from public.profiles where id=actor and is_active for share;
 if not found or clinic_private.ubah_metode_actor('klinik.ubah_metode_bayar') is null then
  raise exception 'Hanya Owner atau Finance aktif, atau peran yang diberi izin Ubah metode bayar, dapat mengoreksi metode pembayaran' using errcode='42501';end if;$r$,
  $r$ begin to_code:=clinic_private.kas_code(p_new_method,vis.branch_id);
 exception when others then
  raise exception 'Rekening % belum dipetakan atau tidak aktif untuk cabang ini',p_new_method;end;$r$
 ];
 expected integer[]:=array[1,1,1,1,1,1,1,1,1,1];
 found_count integer;
begin
 body:=pg_get_functiondef(signature);
 if position('KOREKSI_SEMUA_METODE' in body)>0 then
  raise exception 'KOREKSI_SEMUA_METODE patch already present; verify migration history';end if;
 for i in 1..array_length(anchors,1) loop
  found_count:=(length(body)-length(replace(body,anchors[i],'')))/length(anchors[i]);
  if found_count<>expected[i] then
   raise exception 'KOREKSI_SEMUA_METODE anchor % found % time(s), expected %; review correct_clinic_invoice_payment',i,found_count,expected[i];end if;
  body:=replace(body,anchors[i],replacements[i]);
 end loop;
 execute body;
end $patch$;
revoke all on function public.correct_clinic_invoice_payment(uuid,uuid,integer,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.correct_clinic_invoice_payment(uuid,uuid,integer,text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. IZIN KHUSUS "Ubah metode bayar" (bawaan MATI untuk peran selain Owner/Finance). Owner tidak pernah dikunci oleh tabel kebijakan.
--    FINANCE: aturan koreksi metode yang SUDAH live (Owner 29 Okt) menanamkan OWNER+FINANCE di fungsinya; tetap dipertahankan agar tidak ada
--    kemunduran. Peran lain (ADMIN, KASIR, ...) HANYA bila izinnya tertulis eksplisit di kebijakan aksi perannya (bukan "bawaan lama = semua").
-- ---------------------------------------------------------------------------
insert into role_settings_private.action_catalog(id, label, "group", enforced) values
 ('klinik.ubah_metode_bayar', 'Ubah metode bayar — Pembayaran klinik (rawat jalan, rawat inap, uang muka)', 'Klinik', true)
on conflict (id) do nothing;
insert into role_settings_private.action_modules(id, module_id) values ('klinik.ubah_metode_bayar', 'klinik')
on conflict do nothing;

create function clinic_private.ubah_metode_actor(p_action text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.user_role; v_ok boolean := false;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then return null; end if;
  select p.role into v_role from public.profiles p where p.id = auth.uid() and p.is_active;
  if v_role is null then return null; end if;
  if v_role = 'OWNER' then return 'OWNER'; end if;
  if v_role = 'FINANCE' then return 'FINANCE'; end if;
  begin
    v_ok := p_action = 'klinik.ubah_metode_bayar'
            and exists (select 1 from role_settings_private.action_policies a where a.role = v_role and p_action = any (a.allowed))
            and public.role_action_allowed(p_action);
  exception when others then
    v_ok := false;
  end;
  return case when v_ok then 'GRANT' else null end;
end $$;
revoke all on function clinic_private.ubah_metode_actor(text) from public, anon, authenticated, service_role;

-- Untuk layar: tampilkan tombol atau tidak (bukan otorisasi; RPC memeriksa lagi).
create function public.ubah_metode_allowed(p_domain text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_action text := case p_domain when 'klinik' then 'klinik.ubah_metode_bayar' else null end;
begin
  if v_action is null then return false; end if;
  return clinic_private.ubah_metode_actor(v_action) is not null;
end $$;
revoke all on function public.ubah_metode_allowed(text) from public, anon, service_role;
grant execute on function public.ubah_metode_allowed(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. KLINIK: koreksi metode SATU BAGIAN KWITANSI (rawat inap, pelunasan, uang muka). Jejak tambah-saja.
-- ---------------------------------------------------------------------------
create table public.clinic_receipt_method_corrections (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.clinic_payment_receipts(id),
  part_id uuid not null references public.clinic_payment_receipt_parts(id),
  branch_id uuid not null,
  revision integer not null,
  request_key text not null,
  request_hash text not null,
  amount numeric(15,2) not null,
  from_method text not null,
  to_method text not null,
  from_code text not null,
  to_code text not null,
  reason text not null,
  effective_date date not null,
  actor_role text not null,
  source_shift_id uuid,
  source_shift_status text,
  cash_effect numeric(15,2) not null,
  payment_ids uuid[] not null,
  advance_amount numeric(15,2) not null default 0,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  journal_id uuid,
  result jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint clinic_receipt_method_corrections_key unique (created_by, request_key),
  constraint clinic_receipt_method_corrections_rev unique (receipt_id, revision),
  constraint clinic_receipt_method_corrections_amount check (amount > 0),
  constraint clinic_receipt_method_corrections_reason check (length(btrim(reason)) between 3 and 500),
  constraint clinic_receipt_method_corrections_methods check (
    from_method in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') and to_method in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') and from_method <> to_method),
  constraint clinic_receipt_method_corrections_journal check ((from_code = to_code) = (journal_id is null))
);
create index clinic_receipt_method_corrections_receipt on public.clinic_receipt_method_corrections (receipt_id, revision);
alter table public.clinic_receipt_method_corrections enable row level security;
create policy clinic_receipt_method_corrections_read on public.clinic_receipt_method_corrections for select to authenticated
  using (public.user_can_access_branch(branch_id)
         and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.role in ('OWNER','FINANCE','ADMIN')));
revoke all on public.clinic_receipt_method_corrections from public, anon, authenticated, service_role;
grant select on public.clinic_receipt_method_corrections to authenticated;
create function clinic_private.receipt_method_correction_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = 'IMMUTABLE: jejak koreksi metode kwitansi tidak boleh diubah atau dihapus';
end $$;
revoke all on function clinic_private.receipt_method_correction_immutable() from public, anon, authenticated, service_role;
create trigger clinic_receipt_method_corrections_immutable before update or delete on public.clinic_receipt_method_corrections
  for each row execute function clinic_private.receipt_method_correction_immutable();
create trigger clinic_receipt_method_corrections_wipe before truncate on public.clinic_receipt_method_corrections
  for each statement execute function clinic_private.receipt_method_correction_immutable();

create function public.correct_clinic_receipt_part_method(
  p_receipt_id uuid, p_part_id uuid, p_request_key text, p_reason text, p_new_method text
) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '8s' as $$
declare
  v_user uuid := auth.uid();
  v_actor text;
  v_key text := nullif(btrim(p_request_key), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_hash text;
  v_prior public.clinic_receipt_method_corrections%rowtype;
  v_vis public.visits%rowtype; v_rec public.clinic_payment_receipts%rowtype; v_part public.clinic_payment_receipt_parts%rowtype;
  v_adv public.clinic_customer_advances%rowtype;
  v_today date := (now() at time zone 'Asia/Jakarta')::date; v_closed date; v_shift_status text;
  v_pay_ids uuid[]; v_pay_sum numeric(15,2); v_total_parts numeric(15,2); v_total_pay numeric(15,2); v_adv_amount numeric(15,2);
  v_inv_ids uuid[];
  v_from_code text; v_to_code text; v_rev integer; v_journal uuid; v_audit uuid := gen_random_uuid();
  v_before jsonb; v_after jsonb; v_result jsonb; v_cash numeric(15,2); v_n integer;
begin
  if v_user is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode = '42501', message = 'ACCESS_DENIED: sesi login diperlukan';
  end if;
  v_actor := clinic_private.ubah_metode_actor('klinik.ubah_metode_bayar');
  if v_actor is null then
    raise exception using errcode = '42501', message = 'ACCESS_DENIED: hanya Owner, Finance, atau peran yang diberi izin "Ubah metode bayar" di Akses Grup yang boleh mengubah metode bayar';
  end if;
  if p_receipt_id is null or p_part_id is null or v_key is null or length(v_key) > 100
     or v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'UBAH_METODE_INVALID: alasan wajib diisi (3 sampai 500 huruf) dan identitas kwitansi/bagian harus lengkap';
  end if;
  if p_new_method is null or p_new_method not in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') then
    raise exception using errcode = '22023', message = 'UBAH_METODE_INVALID: metode tidak dikenal. Pilih salah satu: Tunai, Transfer, Debit, Kredit, QRIS, E-Wallet.';
  end if;
  select v.* into v_vis from public.visits v join public.clinic_payment_receipts r on r.visit_id = v.id where r.id = p_receipt_id;
  if not found or not public.user_can_access_branch(v_vis.branch_id) then
    raise exception using errcode = '42501', message = 'ACCESS_DENIED: kwitansi tidak ditemukan atau cabang tidak diizinkan';
  end if;
  perform clinic_private.billing_lock(clinic_private.billing_keys_receipt(p_receipt_id));
  perform pg_advisory_xact_lock(hashtextextended('clinic-receipt-method:' || v_user::text || ':' || v_key, 0));
  v_hash := md5(jsonb_build_object('receipt', p_receipt_id, 'part', p_part_id, 'method', p_new_method, 'reason', v_reason)::text);
  select * into v_prior from public.clinic_receipt_method_corrections where created_by = v_user and request_key = v_key;
  if found then
    if v_prior.request_hash is distinct from v_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci dipakai untuk permintaan berbeda';
    end if;
    return v_prior.result;
  end if;
  perform 1 from public.visits where id = v_vis.id for update;
  select * into v_rec from public.clinic_payment_receipts where id = p_receipt_id for update;
  if v_rec.status is distinct from 'aktif' then
    raise exception using errcode = 'P0001', message = 'UBAH_METODE_KWITANSI: kwitansi ini sudah dibatalkan; metodenya tidak bisa diubah.';
  end if;
  select * into v_part from public.clinic_payment_receipt_parts where id = p_part_id and receipt_id = v_rec.id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'UBAH_METODE_BAGIAN: bagian pembayaran tidak ditemukan pada kwitansi ini';
  end if;
  if v_part.metode = p_new_method then
    raise exception using errcode = 'P0001', message = 'UBAH_METODE_SAMA: metode baru sama dengan metode sekarang; pilih metode lain';
  end if;
  if exists (select 1 from public.clinic_payment_receipt_parts o where o.receipt_id = v_rec.id and o.id <> v_part.id and o.metode = v_part.metode and o.kas_code = v_part.kas_code) then
    raise exception using errcode = 'P0001', message = 'UBAH_METODE_GANDA: kwitansi ini punya dua bagian bermetode sama sehingga pembayaran turunannya tidak bisa dipisahkan; gunakan Batalkan penerimaan lalu terima ulang dengan metode yang benar';
  end if;
  select coalesce(array_agg(distinct p.invoice_id), array[]::uuid[]) into v_inv_ids from public.invoice_payments p where p.receipt_id = v_rec.id;
  perform 1 from public.invoices i where i.id = any (v_inv_ids) order by i.id for update;
  if exists (select 1 from public.invoice_payments p where p.receipt_id = v_rec.id and p.reversal_of is not null) then
    raise exception using errcode = 'P0001', message = 'UBAH_METODE_DIBALIK: pembayaran kwitansi ini pernah dibalik; gunakan Batalkan penerimaan lalu terima ulang';
  end if;
  if exists (select 1 from public.invoices i where i.id = any (v_inv_ids) and (i.voided_at is not null or i.correction_pending)) then
    raise exception using errcode = 'P0001', message = 'UBAH_METODE_TAGIHAN: tagihan yang dilunasi kwitansi ini batal atau sedang dikoreksi; selesaikan dulu, atau gunakan Batalkan penerimaan';
  end if;
  if exists (select 1 from public.clinic_refunds f where f.invoice_id = any (v_inv_ids))
     or exists (select 1 from public.clinic_refund_requests f where f.invoice_id = any (v_inv_ids) and f.status in ('pending','diproses')) then
    raise exception using errcode = 'P0001', message = 'UBAH_METODE_REFUND: tagihan terkait sudah/sedang direfund; rekonsiliasi dulu';
  end if;
  if exists (select 1 from public.clinic_demo_invoice_snapshots s where s.invoice_id = any (v_inv_ids)) then
    raise exception using errcode = 'P0001', message = 'UBAH_METODE_DEMO: tagihan DEMO memuat fee per metode dan insentif; metode tidak bisa diganti';
  end if;
  select coalesce(array_agg(p.id order by p.created_at, p.id), array[]::uuid[]), coalesce(sum(p.amount), 0)
    into v_pay_ids, v_pay_sum
    from public.invoice_payments p
   where p.receipt_id = v_rec.id and p.reversal_of is null and p.amount > 0 and p.metode = v_part.metode and p.kas_code = v_part.kas_code;
  select coalesce(sum(pt.amount), 0) into v_total_parts from public.clinic_payment_receipt_parts pt where pt.receipt_id = v_rec.id;
  select coalesce(sum(p.amount), 0) into v_total_pay from public.invoice_payments p where p.receipt_id = v_rec.id and p.reversal_of is null and p.amount > 0;
  select * into v_adv from public.clinic_customer_advances a where a.receipt_id = v_rec.id and a.status = 'aktif';
  v_adv_amount := case when found then v_adv.amount else 0 end;
  if v_pay_sum > v_part.amount or v_total_parts <> v_total_pay + v_adv_amount
     or exists (select 1 from public.invoice_payments p where p.receipt_id = v_rec.id and p.reversal_of is null and p.amount > 0
                and not exists (select 1 from public.clinic_payment_receipt_parts pt where pt.receipt_id = v_rec.id and pt.metode = p.metode and pt.kas_code = p.kas_code)) then
    raise exception using errcode = 'P0001', message = 'UBAH_METODE_REKONSILIASI: rincian kwitansi tidak cocok dengan pembayaran dan uang muka yang tercatat; tidak ada yang diubah. Hubungi tim pengembang.';
  end if;
  v_from_code := v_part.kas_code;
  v_to_code := clinic_private.kas_code(p_new_method, v_rec.branch_id);
  if v_to_code is null or (select count(*) from public.coa_accounts a where a.code in (v_from_code, v_to_code) and a.is_active and not a.is_header
        and a.type = 'ASET' and a.normal_balance = 'D') <> (case when v_from_code = v_to_code then 1 else 2 end) then
    raise exception using errcode = 'P0001', message = 'UBAH_METODE_AKUN: akun asal/tujuan bukan aset detail aktif; tidak ada yang diubah';
  end if;
  select l.closed_until into v_closed from public.accounting_locks l where l.id;
  if v_rec.tanggal > v_today or (v_closed is not null and (v_rec.tanggal <= v_closed or v_today <= v_closed)) then
    raise exception using errcode = 'P0001', message = format('PERIODE_TERKUNCI: periode akuntansi sampai %s sudah ditutup (kwitansi tanggal %s); metode tidak bisa diubah. Buka periodenya lewat Tutup Buku bila perlu.', v_closed, v_rec.tanggal);
  end if;
  if v_rec.shift_id is not null then
    select s.status into v_shift_status from public.cashier_shifts s where s.id = v_rec.shift_id for update;
  end if;
  if v_from_code <> v_to_code then
    lock table public.journal_entries, public.journal_lines in share row exclusive mode;
    if exists (select 1 from public.bank_reconciliations r left join public.cash_accounts a on a.id = r.cash_account_id
               left join public.coa_accounts c on c.code = coalesce(r.bank_coa_code, a.coa_code)
               where r.voided_at is null and r.tanggal >= v_rec.tanggal and (c.id is null or c.code in (v_from_code, v_to_code))) then
      raise exception using errcode = 'P0001', message = 'UBAH_METODE_REKON_BANK: rekonsiliasi bank sudah mencakup rekening asal atau tujuan; koreksi rekonsiliasinya dahulu';
    end if;
  end if;
  select coalesce(max(c.revision), 0) + 1 into v_rev from public.clinic_receipt_method_corrections c where c.receipt_id = v_rec.id;
  v_before := jsonb_build_object('receipt', to_jsonb(v_rec), 'part', to_jsonb(v_part),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at, p.id) from public.invoice_payments p where p.id = any (v_pay_ids)), '[]'::jsonb));
  if v_from_code <> v_to_code then
    v_journal := public.clinic_write_journal(v_today, 'Koreksi metode pembayaran kwitansi ' || v_rec.no_kwitansi || ' (' || v_part.metode || ' ke ' || p_new_method || ')',
      'klinik-koreksi-bayar', v_rec.no_kwitansi, v_rec.branch_id, jsonb_build_array(
        jsonb_build_object('code', v_to_code, 'debit', v_part.amount, 'credit', 0),
        jsonb_build_object('code', v_from_code, 'debit', 0, 'credit', v_part.amount)));
    if v_journal is null or (select count(*) from public.journal_lines where entry_id = v_journal) <> 2
       or (select coalesce(sum(debit - credit), 0) from public.journal_lines where entry_id = v_journal) <> 0 then
      raise exception using errcode = 'P0001', message = 'UBAH_METODE_JURNAL: jurnal koreksi tidak lengkap atau tidak seimbang';
    end if;
  end if;
  update public.clinic_payment_receipt_parts set metode = p_new_method, kas_code = v_to_code where id = v_part.id;
  update public.invoice_payments set metode = p_new_method, kas_code = v_to_code where id = any (v_pay_ids);
  get diagnostics v_n = row_count;
  if v_n <> coalesce(array_length(v_pay_ids, 1), 0) then
    raise exception using errcode = 'P0001', message = 'UBAH_METODE_JUMLAH_BARIS: jumlah baris pembayaran yang berubah tidak sesuai; dibatalkan';
  end if;
  v_after := jsonb_build_object('receipt', to_jsonb(v_rec),
    'part', (select to_jsonb(pt) from public.clinic_payment_receipt_parts pt where pt.id = v_part.id),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at, p.id) from public.invoice_payments p where p.id = any (v_pay_ids)), '[]'::jsonb));
  v_cash := case when v_part.metode = 'Tunai' then -v_part.amount when p_new_method = 'Tunai' then v_part.amount else 0 end;
  v_result := jsonb_build_object('receipt_id', v_rec.id, 'part_id', v_part.id, 'audit_id', v_audit, 'revision', v_rev, 'journal_id', v_journal,
    'from_method', v_part.metode, 'to_method', p_new_method, 'from_code', v_from_code, 'to_code', v_to_code, 'amount', v_part.amount,
    'effective_date', v_today, 'source_shift_status', v_shift_status, 'cash_effect', v_cash);
  insert into public.clinic_receipt_method_corrections(id, receipt_id, part_id, branch_id, revision, request_key, request_hash, amount, from_method, to_method,
    from_code, to_code, reason, effective_date, actor_role, source_shift_id, source_shift_status, cash_effect, payment_ids, advance_amount,
    before_snapshot, after_snapshot, journal_id, result, created_by)
  values (v_audit, v_rec.id, v_part.id, v_rec.branch_id, v_rev, v_key, v_hash, v_part.amount, v_part.metode, p_new_method,
    v_from_code, v_to_code, v_reason, v_today, v_actor, v_rec.shift_id, v_shift_status, v_cash, v_pay_ids, v_part.amount - v_pay_sum,
    v_before, v_after, v_journal, v_result, v_user);
  return v_result;
end $$;
revoke all on function public.correct_clinic_receipt_part_method(uuid, uuid, text, text, text) from public, anon, service_role;
grant execute on function public.correct_clinic_receipt_part_method(uuid, uuid, text, text, text) to authenticated;
