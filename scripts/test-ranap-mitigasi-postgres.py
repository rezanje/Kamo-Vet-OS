#!/usr/bin/env python3
"""Reproduksi + perbaikan temuan audit tagihan berjalan rawat inap (#339).

Tiga babak di satu klaster PostgreSQL sekali pakai:

  A. KOMPILASI — definisi asli clinic_post_invoice, clinic_receive_invoice_payment,
     clinic_void_reissue_invoice_core, clinic_change_inpatient_condition,
     clinic_post_split_invoice dan clinic_post_demo_invoice dipasang apa adanya dari
     migrasi sumbernya, lalu migrasi #339 dan migrasi mitigasi dijalankan berurutan.
     Yang dibuktikan: SETIAP jangkar tambalan cocok tepat sekali pada definisi yang
     benar-benar berjalan, dan hasil tambalannya benar-benar ada di badan fungsi.

  B. REGRESI (#339 saja) — uang benar-benar dijalankan di atas rangka tiruan tanpa
     migrasi mitigasi. Setiap temuan audit DIREPRODUKSI: nilai yang SALAH di-assert
     apa adanya supaya tidak ada temuan yang ditandai "fixed" tanpa bukti rusaknya.

  C. PERBAIKAN (#339 + mitigasi) — skenario yang sama diulang dan sekarang
     di-assert benar, termasuk pecahan per rekening, status bayar tiap langkah,
     pelepasan uang muka, terbit ulang, dan penolakan jalur pintas.

Seluruh fixture fiktif. Tidak ada koneksi ke Production, tidak ada data pasien asli.
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

BIN = os.environ.get("KAMO_PG_BIN", "/opt/data/kamo-pg-harness/bin")
MIGRATIONS = ROOT / "supabase/migrations"
M339 = MIGRATIONS / "20261031230000_ranap_tagihan_berjalan.sql"
MITIGASI = MIGRATIONS / "20261103010000_ranap_mitigasi_audit.sql"
HASIL = Path(os.environ.get("KAMO_HASIL", "/opt/data/kamo-ranap-mitigasi-test-results.json"))

SUMBER = {
    "clinic_post_invoice": ("20260924125000_clinic_invoice_post.sql",
                            "create or replace function public.clinic_post_invoice(", None),
    "clinic_receive_invoice_payment": ("20260929120000_clinic_billing_lifecycle.sql",
                                       "create function public.clinic_receive_invoice_payment(", None),
    "clinic_void_reissue_invoice_core": ("20261005090000_clinic_split_payment.sql",
                                         "create or replace function public.clinic_void_reissue_invoice(",
                                         "public.clinic_void_reissue_invoice_core("),
    "clinic_post_split_invoice": ("20261005090000_clinic_split_payment.sql",
                                  "create function public.clinic_post_split_invoice(", None),
    "clinic_post_demo_invoice": ("20261012111000_clinic_demo_checkout.sql",
                                 "create function public.clinic_post_demo_invoice(", None),
    "clinic_change_inpatient_condition": ("20261025180000_inpatient_forced_discharge.sql",
                                          "create or replace function public.clinic_change_inpatient_condition(", None),
    # Jalan keluar koreksi tagihan tanpa uang (IND-03) menambal inti koreksi tagihan.
    "clinic_edit_invoice_core": ("20260929120000_clinic_billing_lifecycle.sql",
                                 "create function public.clinic_edit_invoice(",
                                 "public.clinic_edit_invoice_core("),
}

# Jangkar yang dipakai migrasi mitigasi, persis seperti tertulis di berkasnya.
JANGKAR = [
    "if not coalesce((p_invoice ->> 'min_dp_deferred')::boolean, false)",
    "RECIPE_LINKED: racikan tercantum lebih dari sekali",
    "v_invoice_id := public.clinic_post_invoice(p_visit_id,v_key,v_base,p_lines);",
    "perform public.set_visit_service_state(p_visit_id,'checkout');",
    "v_id:=public.clinic_post_invoice(p_visit_id,v_key,v_invoice,v_lines);",
    "PAYMENT_INVALID: selesaikan koreksi tagihan sebelum menerima pembayaran",
    "update public.invoices set voided_at=now() where id=p_invoice_id;",
    "returning id into v_new_id;",
    "where invoice_id=p_invoice_id and (transferred_from is null or not v_invoice.correction_pending))",
    "where invoice_id=p_invoice_id and transferred_from is not null;",
]

LAPORAN = []


def catat(nama, status, detail):
    LAPORAN.append({"skenario": nama, "status": status, "detail": detail})
    print(f"{status}: {nama} — {detail}", flush=True)


# ---------------------------------------------------------------------------
# Rangka skema tiruan (hanya kolom yang dipakai alur uang klinik).
# ---------------------------------------------------------------------------
RANGKA = """
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;

create table public.branches(id uuid primary key, name text, is_active boolean default true);
create table public.customers(id uuid primary key, name text);
create table public.profiles(id uuid primary key, role text, is_active boolean, full_name text);
create table public.visits(id uuid primary key, branch_id uuid, customer_id uuid, status text,
  created_at timestamptz default now());
create table public.inpatient_records(id uuid primary key, visit_id uuid, branch_id uuid,
  condition_status text, admitted_at timestamptz, discharged_at timestamptz);
create table public.inpatient_status_log(inpatient_record_id uuid, previous_status text,
  new_status text, changed_by uuid, notes text);
create table public.cashier_shifts(id uuid primary key, branch_id uuid, opened_by uuid,
  shift_type text, status text, opened_at timestamptz, opening_balance numeric);
create table public.items(id uuid primary key, name text, unit text, is_active boolean,
  sell_price numeric, tindakan_kategori text);
create table public.medical_records(id uuid primary key, visit_id uuid, created_at timestamptz default now());
create table public.prescription_items(id uuid primary key default gen_random_uuid(),
  medical_record_id uuid, item_id uuid, nama_obat text, qty numeric, harga numeric, satuan text,
  jenis text, kategori text, aturan_pakai text, compound_recipe_id uuid,
  created_at timestamptz default now());
create table public.compounding_recipes(id uuid primary key, medical_record_id uuid, status text);
create table public.invoices(id uuid primary key default gen_random_uuid(), visit_id uuid,
  invoice_no text unique, subtotal numeric, discount numeric, tax numeric, total numeric,
  dp_amount numeric default 0, dp_date date, paid_status varchar(12), metode_bayar text,
  paid_at timestamptz, voided_at timestamptz, reissued_from uuid, request_key text, request_hash text,
  correction_pending boolean default false, shift_cash_carry numeric, shift_id uuid,
  voucher_code text, campaign_code text, salesperson_id uuid, created_at timestamptz default now());
create unique index invoices_visit_active_key on public.invoices(visit_id) where voided_at is null;
create table public.invoice_items(id uuid primary key default gen_random_uuid(), invoice_id uuid,
  deskripsi text, qty numeric, harga numeric, jenis text, diskon_persen numeric, item_id uuid,
  hpp numeric, compound_recipe_id uuid, prescription_item_id uuid, satuan text, faktor numeric,
  created_at timestamptz default now());
create table public.invoice_payments(id uuid primary key default gen_random_uuid(), invoice_id uuid,
  tanggal date, amount numeric, metode varchar(16), catatan text, kas_code text, created_by uuid,
  request_key text, request_hash text, transferred_from uuid, checkout_payment boolean default false,
  created_at timestamptz default clock_timestamp());
create table public.invoice_edit_log(invoice_id uuid, edited_by uuid, field_changed text,
  old_value text, new_value text, reason text, edited_at timestamptz default now());
create table public.clinic_invoice_operations(request_key text primary key, invoice_id uuid,
  request_hash text, kind text, result_invoice_id uuid);
create table public.cash_accounts(id uuid primary key default gen_random_uuid(), coa_code text,
  is_active boolean, branch_id uuid);
create table public.payment_account_map(metode text, branch_id uuid, cash_account_id uuid);
create table public.coa_accounts(id uuid primary key default gen_random_uuid(), code text unique,
  is_active boolean, is_header boolean);
create table public.document_numbering(jenis varchar(10) primary key, pola varchar(30), digit smallint);
create table public.journal_entries(id uuid primary key default gen_random_uuid(), no_jurnal text,
  tanggal date, deskripsi text, source text, source_ref text, branch_id uuid, lines jsonb,
  created_at timestamptz default clock_timestamp());

create table public.employees(id uuid primary key, nama text, is_active boolean,
  user_id uuid, branch_id uuid);
create table public.clinic_demo_policies(id uuid primary key default gen_random_uuid(), name text,
  incentive_percent numeric(5,2), fee_bearer text, fee_rates jsonb, admin_revenue_code varchar(12),
  admin_expense_code varchar(12), is_active boolean default true,
  created_at timestamptz default now(), created_by uuid);
create table public.clinic_demo_invoice_snapshots(invoice_id uuid primary key, policy_id uuid,
  branch_id uuid, request_key text, request_hash text, base_total numeric(15,2),
  fee_amount numeric(15,2), fee_bearer text, payments jsonb, service_basis numeric(15,2),
  incentive_pool bigint, earned_at timestamptz default now(), created_at timestamptz default now());
create table public.clinic_demo_incentive_allocations(id uuid default gen_random_uuid(),
  invoice_id uuid, employee_id uuid, amount bigint, primary key(invoice_id, employee_id));

create or replace function public.user_can_access_branch(b uuid) returns boolean
  language sql stable as $$ select true $$;
create or replace function public.clinic_write_journal(p_tanggal date, p_deskripsi text, p_source text,
  p_source_ref text, p_branch_id uuid, p_lines jsonb) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_debit numeric; v_credit numeric;
begin
  select coalesce(sum((e.value->>'debit')::numeric), 0), coalesce(sum((e.value->>'credit')::numeric), 0)
    into v_debit, v_credit from jsonb_array_elements(p_lines) e;
  if v_debit <> v_credit then
    raise exception 'JOURNAL_UNBALANCED % (% vs %)', p_source, v_debit, v_credit;
  end if;
  if v_debit = 0 then return null; end if;
  insert into public.journal_entries(id, no_jurnal, tanggal, deskripsi, source, source_ref, branch_id, lines)
  values (v_id, 'JRN-' || substr(v_id::text, 1, 8), p_tanggal, p_deskripsi, p_source, p_source_ref, p_branch_id, p_lines);
  return v_id;
end $$;
create or replace function public.clinic_reverse_journal_lines(p_ref text, p_sources text[]) returns jsonb
  language sql as $$ select '[]'::jsonb $$;
create or replace function public.set_visit_service_state(p_visit_id uuid, p_action text,
  p_provider_id uuid default null) returns void language sql as $$ select $$;
"""

HAK_RANGKA = """
grant usage on schema public, auth to authenticated, anon, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
"""

ROLES = """
do $$ begin
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
"""

# ---------------------------------------------------------------------------
# Tiruan RPC berjalan. Setiap jangkar yang dipakai #339 DAN migrasi mitigasi
# disalin PERSIS dari definisi aslinya.
# ---------------------------------------------------------------------------
STUB_POST = r"""
create or replace function public.clinic_post_invoice(
  p_visit_id uuid, p_request_key text, p_invoice jsonb, p_lines jsonb
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_request_key text := nullif(btrim(p_request_key), '');
  v_hash text;
  v_existing public.invoices%rowtype;
  v_invoice_id uuid;
  v_invoice_no text;
  v_line jsonb;
begin
  v_hash := md5(jsonb_build_object('invoice', p_invoice - 'invoice_no' - 'paid_at', 'lines', p_lines)::text);
  select i.* into v_existing from public.invoices i where i.request_key = v_request_key for update;
  if found then
    if v_existing.visit_id is distinct from p_visit_id or v_existing.request_hash is distinct from v_hash then
      raise exception using errcode = 'P0001', message = 'IDEMPOTENCY_CONFLICT: kunci invoice telah dipakai untuk data berbeda';
    end if;
    return v_existing.id;
  end if;
  if exists (select 1 from public.invoices i where i.visit_id = p_visit_id and i.voided_at is null) then
    raise exception using errcode = 'P0001', message = 'INVOICE_EXISTS: kunjungan sudah memiliki invoice aktif';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) as e(value)
    where nullif(e.value ->> 'recipe_id', '') is not null
    group by e.value ->> 'recipe_id' having count(*) > 1
  ) then
    raise exception using errcode = 'P0001', message = 'RECIPE_LINKED: racikan tercantum lebih dari sekali';
  end if;

  v_invoice_no := 'INV-' || lpad((select count(*) + 1 from public.invoices)::text, 4, '0');
  insert into public.invoices(visit_id, invoice_no, subtotal, discount, tax, total, dp_amount,
    paid_status, metode_bayar, created_at)
  values (p_visit_id, v_invoice_no, (p_invoice->>'subtotal')::numeric, 0, 0,
    (p_invoice->>'total')::numeric, coalesce((p_invoice->>'dp_amount')::numeric, 0),
    p_invoice->>'paid_status', coalesce(p_invoice->>'metode_bayar', 'Tunai'), clock_timestamp())
  returning id into v_invoice_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    insert into public.invoice_items(invoice_id, deskripsi, qty, harga, jenis, prescription_item_id)
    values (v_invoice_id, v_line->>'description', (v_line->>'qty')::numeric, (v_line->>'price')::numeric,
      coalesce(v_line->>'kind','obat'), nullif(v_line->>'prescription_item_id','')::uuid);
  end loop;
  perform public.clinic_write_journal((p_invoice->>'tanggal')::date, 'Penjualan ' || v_invoice_no,
    'klinik', v_invoice_no, (select branch_id from public.visits where id = p_visit_id),
    jsonb_build_array(
      jsonb_build_object('code','1201','debit',(p_invoice->>'total')::numeric,'credit',0),
      jsonb_build_object('code','4201','debit',0,'credit',(p_invoice->>'total')::numeric)));
  update public.invoices set request_key = v_request_key, request_hash = v_hash
  where id = v_invoice_id;

  return v_invoice_id;
end;
$function$;
"""

STUB_RECEIVE = r"""
create or replace function public.clinic_receive_invoice_payment(
  p_invoice_id uuid, p_tanggal date, p_amount numeric, p_metode text,
  p_kas_code text, p_catatan text, p_request_key text
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_visit public.visits%rowtype; v_invoice public.invoices%rowtype;
  v_payment_id uuid; v_paid numeric; v_remaining numeric;
begin
  select v.* into v_visit from public.visits v
  join public.invoices i on i.visit_id = v.id where i.id = p_invoice_id;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.paid_status = 'Lunas' or v_invoice.invoice_no is null
     or v_invoice.correction_pending then
    raise exception using errcode='P0001', message='PAYMENT_INVALID: selesaikan koreksi tagihan sebelum menerima pembayaran';
  end if;
  select coalesce(sum(amount), 0) into v_paid from public.invoice_payments
  where invoice_id = p_invoice_id;
  v_remaining := v_invoice.total - v_invoice.dp_amount - v_paid;
  if v_remaining <= 0 or p_amount > v_remaining then
    raise exception using errcode='P0001', message='PAYMENT_INVALID: pelunasan melebihi sisa piutang';
  end if;
  insert into public.invoice_payments(invoice_id, tanggal, amount, metode, kas_code, request_key)
  values (p_invoice_id, p_tanggal, p_amount, p_metode, p_kas_code, p_request_key)
  returning id into v_payment_id;
  perform public.clinic_write_journal(p_tanggal, 'Pelunasan piutang ' || v_invoice.invoice_no,
    'klinik-ar', v_invoice.invoice_no, v_visit.branch_id, jsonb_build_array(
      jsonb_build_object('code',p_kas_code,'debit',p_amount,'credit',0),
      jsonb_build_object('code','1201','debit',0,'credit',p_amount)));
  if p_amount = v_remaining then
    update public.invoices set paid_status='Lunas', paid_at=now()
    where id = p_invoice_id;
    update public.visits set status='Selesai' where id = v_visit.id;
  end if;
  return v_payment_id;
end;
$function$;
"""

STUB_SPLIT = r"""
create or replace function public.clinic_post_split_invoice(
  p_visit_id uuid, p_request_key text, p_invoice jsonb, p_lines jsonb, p_payments jsonb
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_key text := nullif(btrim(p_request_key),''); v_invoice_id uuid; v_base jsonb;
  v_part jsonb; v_payment_id uuid; v_index integer := 0; v_total numeric := 0;
begin
  for v_part in select value from jsonb_array_elements(p_payments) loop
    v_total := v_total + (v_part->>'amount')::numeric;
  end loop;
  if (p_invoice->>'total')::numeric is distinct from v_total
    or p_invoice->>'paid_status' is distinct from 'Lunas' then
    raise exception using errcode='P0001', message='PAYMENT_INVALID: jumlah pembayaran harus sama dengan total invoice';
  end if;
  v_base := p_invoice || jsonb_build_object('paid_status','Belum Lunas',
    'dp_amount',0,'dp_date',null,'metode_bayar',p_payments->0->>'method',
    'split_payments',p_payments);
  v_invoice_id := public.clinic_post_invoice(p_visit_id,v_key,v_base,p_lines);
  for v_part in select value from jsonb_array_elements(p_payments) loop
    v_index := v_index + 1;
    v_payment_id := public.clinic_receive_invoice_payment(v_invoice_id,
      (p_invoice->>'tanggal')::date,(v_part->>'amount')::numeric,
      v_part->>'method',v_part->>'kas_code',null,
      'split:' || md5(v_key) || ':' || v_index::text);
    update public.invoice_payments set checkout_payment=true where id=v_payment_id;
  end loop;
  perform public.set_visit_service_state(p_visit_id,'checkout');
  return v_invoice_id;
end;
$function$;
"""

STUB_DEMO = r"""
create or replace function public.clinic_post_demo_invoice(p_visit_id uuid,p_request_key text,
  p_invoice jsonb,p_lines jsonb,p_policy_id uuid,p_payments jsonb,p_employee_ids uuid[]) returns uuid
language plpgsql security definer set search_path='' as $function$
declare v_key text:=nullif(btrim(p_request_key),'');v_invoice jsonb;v_lines jsonb:=p_lines;v_id uuid;
  v_part jsonb;v_payment_id uuid;v_index integer:=0;v_total numeric:=0;
begin
  for v_part in select value from jsonb_array_elements(p_payments) loop
    v_total:=v_total+(v_part->>'amount')::numeric;
  end loop;
  if v_total is distinct from (p_invoice->>'total')::numeric or p_invoice->>'paid_status' is distinct from 'Lunas' then
    raise exception using errcode='P0001', message='PAYMENT_INVALID: jumlah bagian tidak sama dengan tagihan dasar';end if;
  v_invoice:=p_invoice||jsonb_build_object('paid_status','Belum Lunas','dp_amount',0,'dp_date',null,
    'metode_bayar',p_payments->0->>'method','demo_policy',p_policy_id);
  v_id:=public.clinic_post_invoice(p_visit_id,v_key,v_invoice,v_lines);
  for v_part in select value from jsonb_array_elements(p_payments) loop
    v_index:=v_index+1;
    v_payment_id:=public.clinic_receive_invoice_payment(v_id,(p_invoice->>'tanggal')::date,
      (v_part->>'amount')::numeric,v_part->>'method',v_part->>'kas_code',null,'demo:'||md5(v_key)||':'||v_index);
    update public.invoice_payments set checkout_payment=true where id=v_payment_id;
  end loop;
  return v_id;
end $function$;
"""

STUB_VOID = r"""
create or replace function public.clinic_void_reissue_invoice_core(
  p_invoice_id uuid, p_request_key text, p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_visit public.visits%rowtype; v_invoice public.invoices%rowtype; v_new_id uuid;
  v_user uuid := auth.uid(); v_no text; v_paid numeric; v_direct numeric := 0;
  v_shift_cash numeric := 0; v_lines jsonb := '[]'::jsonb;
begin
  select v.* into v_visit from public.visits v join public.invoices i on i.visit_id = v.id where i.id = p_invoice_id;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  select coalesce(sum(amount),0) into v_paid from public.invoice_payments where invoice_id=p_invoice_id;
  if exists(select 1 from public.invoice_payments where invoice_id=p_invoice_id
      and (kas_code is null or amount<=0)) then
    raise exception using errcode='P0001', message='JOURNAL_MISSING: rekening cicilan tidak lengkap'; end if;
  v_no := v_invoice.invoice_no || '-R';
  update public.invoices set voided_at=now() where id=p_invoice_id;
  insert into public.invoices(visit_id,invoice_no,subtotal,discount,tax,total,dp_amount,
    dp_date,paid_status,metode_bayar,paid_at,shift_id,voucher_code,salesperson_id,
    reissued_from,request_key,request_hash,correction_pending,shift_cash_carry)
  values(v_visit.id,v_no,v_invoice.subtotal,v_invoice.discount,v_invoice.tax,v_invoice.total,
    0,null,case when v_paid=v_invoice.total then 'Lunas' else 'DP' end,
    v_invoice.metode_bayar,case when v_paid=v_invoice.total then now() else null end,v_invoice.shift_id,
    v_invoice.voucher_code,v_invoice.salesperson_id,p_invoice_id,p_request_key,md5(p_request_key),true,v_shift_cash)
  returning id into v_new_id;
  insert into public.invoice_items(invoice_id,deskripsi,qty,harga,jenis,diskon_persen,
    item_id,hpp,prescription_item_id,satuan,faktor)
  select v_new_id,deskripsi,qty,harga,jenis,diskon_persen,item_id,hpp,
    prescription_item_id,satuan,faktor from public.invoice_items where invoice_id=p_invoice_id;
  perform public.clinic_write_journal(current_date,'Terbit ulang '||v_no,
    'klinik-reissue',v_no,v_visit.branch_id,v_lines);
  if v_paid>0 then
    insert into public.invoice_payments(invoice_id,tanggal,amount,metode,catatan,
      kas_code,created_by,transferred_from,checkout_payment)
    select v_new_id,current_date,p.amount,p.metode,
      'Dialihkan dari '||v_invoice.invoice_no,p.kas_code,v_user,p_invoice_id,p.checkout_payment
    from public.invoice_payments p where p.invoice_id=p_invoice_id;
  end if;
  insert into public.invoice_edit_log(invoice_id,edited_by,field_changed,old_value,new_value,reason)
    values(p_invoice_id,v_user,'voided',v_invoice.invoice_no,v_no,p_reason);
  return v_new_id;
end;
$function$;
"""

STUB_CONDITION = r"""
create or replace function public.clinic_change_inpatient_condition(
  p_inpatient_id uuid, p_new_status text, p_notes text
) returns boolean language plpgsql security definer set search_path = '' as $function$
declare v_record public.inpatient_records%rowtype; v_tariff public.items%rowtype;
  v_medical_record_id uuid; v_days integer; v_discharged_at timestamptz;
begin
  select * into v_record from public.inpatient_records where id = p_inpatient_id for update;
  v_discharged_at := case when p_new_status in ('sembuh','rip','pulang_paksa') then now() else null end;
  if v_discharged_at is not null and exists(select 1 from public.invoices
      where visit_id=v_record.visit_id and voided_at is null) then
    raise exception using errcode='P0001', message='INVOICE_EXISTS: tagihan sudah terbit sebelum biaya rawat inap dihitung';
  end if;
  update public.inpatient_records set condition_status=p_new_status,
    discharged_at=v_discharged_at where id=p_inpatient_id;
  if v_discharged_at is not null then
    select * into v_tariff from public.items
    where tindakan_kategori='Rawat Inap' and is_active
    order by name, id limit 1;
    if found then
      select m.id into v_medical_record_id from public.medical_records m
      where m.visit_id = v_record.visit_id order by m.created_at desc, m.id desc limit 1;
      if v_medical_record_id is not null then
        v_days := greatest(1, ceil(extract(epoch from (v_discharged_at - v_record.admitted_at)) / 86400)::integer);
        delete from public.prescription_items
        where medical_record_id=v_medical_record_id and item_id=v_tariff.id;
        insert into public.prescription_items(medical_record_id, item_id, nama_obat, qty, harga, satuan, jenis, kategori)
        values (v_medical_record_id, v_tariff.id, v_tariff.name, v_days,
          coalesce(v_tariff.sell_price,0), coalesce(v_tariff.unit,'hari'), 'jasa', 'Rawat Inap');
      end if;
    end if;
  end if;
  return true;
end;
$function$;
"""

GUARD_ASLI = r"""
create function public.guard_open_inpatient_invoice() returns trigger
language plpgsql security definer set search_path = '' as $function$
begin
  if exists(select 1 from public.inpatient_records r
    where r.visit_id=new.visit_id and r.discharged_at is null for share) then
    raise exception using errcode='P0001', message='INPATIENT_OPEN: biaya rawat inap belum dihitung';
  end if;
  return new;
end;
$function$;
create trigger guard_open_inpatient_invoice before insert on public.invoices
  for each row execute function public.guard_open_inpatient_invoice();
"""

# ---------------------------------------------------------------------------
# Fixture fiktif. Tiap skenario memakai kunjungan sendiri supaya alokasi kwitansi
# satu skenario tidak bocor ke skenario lain.
# ---------------------------------------------------------------------------
OWNER = "00000000-0000-4000-8000-00000000000a"
STAF = "00000000-0000-4000-8000-00000000000b"
BRANCH = "00000000-0000-4000-8000-0000000000b1"
CUST = "00000000-0000-4000-8000-0000000000c1"
SHIFT = "00000000-0000-4000-8000-0000000000e3"
ITEM_RANAP = "00000000-0000-4000-8000-0000000000a1"

P = "00000000-0000-4000-8000-"
VIS = {k: f"{P}1{k:03d}00000000" for k in range(1, 14)}
REC = {k: f"{P}2{k:03d}00000000" for k in range(1, 14)}
MRID = {k: f"{P}3{k:03d}00000000" for k in range(1, 14)}
def PRES(k, n): return f"{P}4{k:03d}{n:03d}00000"

# Kunjungan rawat inap: 1 FIN-01 pembalikan per rekening · 2 FIN-04 status tiap langkah ·
# 3 FIN-03 pelepasan uang muka · 4 FIN-02 terbit ulang (pasien sudah pulang) ·
# 5 FIN-05 jalur piutang · 6 UF-04 tarif manual · 7 FIN-07 duplikat baris resep.
# Kunjungan rawat jalan: 8/9/10 FIN-06 tiga cara menerobos · 11 pelunasan piutang biasa ·
# 12 checkout campuran · 13 checkout DEMO.
RANAP = [1, 2, 3, 4, 5, 6, 7]
SUDAH_PULANG = {4}
LAMA_INAP = {6: 5}


def fixture_sql():
    s = [f"""
insert into auth.users(id) values ('{OWNER}'), ('{STAF}');
insert into public.profiles(id, role, is_active) values ('{OWNER}', 'OWNER', true), ('{STAF}', 'STAFF', true);
insert into public.branches(id, name) values ('{BRANCH}', 'Cabang Fiktif');
insert into public.customers(id, name) values ('{CUST}', 'Pemilik Fiktif');
insert into public.cashier_shifts(id, branch_id, opened_by, shift_type, status, opened_at)
  values ('{SHIFT}', '{BRANCH}', '{OWNER}', 'klinik', 'open', now());
insert into public.coa_accounts(code, is_active, is_header) values
  ('1101', true, false), ('1102', true, false), ('1201', true, false),
  ('2103', true, false), ('4201', true, false);
insert into public.cash_accounts(coa_code, is_active, branch_id) values ('1101', true, null), ('1102', true, null);
insert into public.items(id, name, unit, is_active, sell_price, tindakan_kategori)
  values ('{ITEM_RANAP}', 'Kamar Rawat Inap', 'hari', true, 150000, 'Rawat Inap');
"""]
    for k in range(1, 14):
        s.append(f"insert into public.visits(id, branch_id, customer_id, status) "
                 f"values ('{VIS[k]}', '{BRANCH}', '{CUST}', 'Diperiksa');")
        s.append(f"insert into public.medical_records(id, visit_id) values ('{MRID[k]}', '{VIS[k]}');")
        if k in RANAP:
            pulang = "now() - interval '1 hour'" if k in SUDAH_PULANG else "null"
            hari = LAMA_INAP.get(k, 3)
            s.append(f"insert into public.inpatient_records(id, visit_id, branch_id, condition_status,"
                     f" admitted_at, discharged_at) values ('{REC[k]}', '{VIS[k]}', '{BRANCH}', 'stabil',"
                     f" now() - interval '{hari} days', {pulang});")
        for n in range(1, 7):
            s.append(f"insert into public.prescription_items(id, medical_record_id, nama_obat, qty, harga, jenis)"
                     f" values ('{PRES(k, n)}', '{MRID[k]}', 'Baris {k}-{n}', 1, 100000, 'obat');")
    # UF-04: jasa rawat inap yang DIISI PETUGAS (3 hari @120.000), bukan hitungan otomatis.
    s.append(f"insert into public.prescription_items(id, medical_record_id, item_id, nama_obat, qty, harga,"
             f" satuan, jenis, kategori) values ('{PRES(6, 9)}', '{MRID[6]}', '{ITEM_RANAP}',"
             f" 'Kamar Rawat Inap', 3, 120000, 'hari', 'jasa', 'Rawat Inap');")
    return "\n".join(s)


# ---------------------------------------------------------------------------
# Penolong
# ---------------------------------------------------------------------------
def sebagai(pg, perintah, user=OWNER):
    return pg.sql(
        f"select set_config('request.jwt.claim.sub', '{user}', false);"
        "select set_config('request.jwt.claim.role', 'authenticated', false);"
        f"set role authenticated; {perintah}")


def nilai(pg, perintah, user=OWNER):
    return sebagai(pg, perintah, user).splitlines()[-1]


def sebagai_pembungkus(pg, perintah, user=OWNER):
    """`_core` memang tidak boleh dipanggil akun aplikasi; di sini dipanggil persis
    seperti pembungkus security-definer-nya melakukannya."""
    return pg.sql(
        f"select set_config('request.jwt.claim.sub', '{user}', false);"
        "select set_config('request.jwt.claim.role', 'authenticated', false);"
        f"{perintah}")


def ditolak_pembungkus(pg, perintah, kode, user=OWNER):
    try:
        sebagai_pembungkus(pg, perintah, user)
    except RuntimeError as error:
        assert kode in str(error), f"Diharapkan {kode}, dapat: {error}"
        return str(error)
    raise AssertionError(f"Seharusnya ditolak dengan {kode}: {perintah}")


def ditolak(pg, perintah, kode, user=OWNER):
    try:
        sebagai(pg, perintah, user)
    except RuntimeError as error:
        assert kode in str(error), f"Diharapkan {kode}, dapat: {error}"
        return str(error)
    raise AssertionError(f"Seharusnya ditolak dengan {kode}: {perintah}")


def definisi_asli(nama):
    berkas, mulai_teks, rename = SUMBER[nama]
    teks = (MIGRATIONS / berkas).read_text()
    mulai = teks.index(mulai_teks)
    # Dua gaya penutup dipakai di repositori: $function$; dan `end $$;`.
    kandidat = [(teks.find(tutup, mulai), tutup) for tutup in ("$function$;", "\nend $$;")]
    akhir, tutup = min((i, s) for i, s in kandidat if i != -1)
    potongan = teks[mulai:akhir + len(tutup)]
    if rename:
        # Dua gaya pembuka dipakai: `create function` dan `create or replace function`.
        nama_lama = mulai_teks.split("function ", 1)[1]
        potongan = potongan.replace(nama_lama, rename, 1)
    return potongan


def kredit_per_akun(pg, pola):
    """Total KREDIT per kode akun dari jurnal yang deskripsinya cocok `pola`."""
    baris = pg.sql(
        "select (e.value->>'code') || '=' || sum((e.value->>'credit')::numeric)::text "
        "from public.journal_entries j, jsonb_array_elements(j.lines) e "
        f"where j.deskripsi like '{pola}' and (e.value->>'credit')::numeric > 0 "
        "group by e.value->>'code' order by 1")
    return {b.split("=")[0]: float(b.split("=")[1]) for b in baris.splitlines() if b}


def reset(pg):
    pg.sql("drop schema public cascade; create schema public; drop schema if exists clinic_private cascade;"
           "drop schema if exists auth cascade;")
    pg.sql(RANGKA)
    pg.sql(HAK_RANGKA)
    pg.sql(GUARD_ASLI)
    for stub in (STUB_POST, STUB_RECEIVE, STUB_SPLIT, STUB_DEMO, STUB_VOID, STUB_CONDITION):
        pg.sql(stub)
    # Inti koreksi tagihan dipasang APA ADANYA dari migrasi sumbernya (bukan stub):
    # migrasi mitigasi menambalnya, jadi jangkarnya harus benar-benar ada. Babak B/C
    # tidak memanggilnya — siklus koreksi penuhnya diuji oleh harness skema penuh.
    pg.sql(definisi_asli("clinic_edit_invoice_core"))


TAHAP = ("select public.clinic_post_inpatient_stage_invoice('%s', '%s', "
         "'{\"tanggal\":\"2026-10-29\",\"subtotal\":%d,\"total\":%d,\"paid_status\":\"Belum Lunas\"%s}'::jsonb, "
         "'%s'::jsonb)")
ALASAN = ', "dp_override_reason":"Pemilik membayar bertahap, disetujui pemilik klinik"'


def baris_json(k, nomor, harga=100000, ulang=1):
    satu = ('{"description":"Baris %d-%d","qty":1,"price":%d,"kind":"obat",'
            '"prescription_item_id":"%s"}' % (k, nomor, harga, PRES(k, nomor)))
    return "[" + ",".join([satu] * ulang) + "]"


def tagih(pg, k, key, total, nomor, alasan=True, ulang=1, user=OWNER):
    return nilai(pg, TAHAP % (VIS[k], key, total, total, ALASAN if alasan else "",
                              baris_json(k, nomor, total // ulang, ulang)), user)


def bayar_sql(k, key, parts, invoice="null"):
    return ("select public.clinic_receive_visit_payment('%s', '%s', date '2026-10-29', "
            "'%s'::jsonb, %s, null)" % (VIS[k], key, json.dumps(parts), invoice))


def status(pg, inv):
    return pg.sql(f"select paid_status from public.invoices where id='{inv}'")


def dibayar(pg, inv):
    return float(pg.sql(f"select coalesce(sum(amount),0) from public.invoice_payments where invoice_id='{inv}'"))


def jml_jurnal(pg):
    return int(pg.sql("select count(*) from public.journal_entries"))


def kredit_setelah(pg, n):
    """Total KREDIT per kode akun untuk jurnal yang terbit SESUDAH penanda `n`."""
    baris = pg.sql(
        "select (e.value->>'code') || '=' || sum((e.value->>'credit')::numeric)::text from "
        f"(select * from public.journal_entries order by created_at, id offset {n}) j, "
        "jsonb_array_elements(j.lines) e where (e.value->>'credit')::numeric > 0 "
        "group by e.value->>'code' order by 1")
    return {b.split("=")[0]: float(b.split("=")[1]) for b in baris.splitlines() if b}


def debit_setelah(pg, n):
    baris = pg.sql(
        "select (e.value->>'code') || '=' || sum((e.value->>'debit')::numeric)::text from "
        f"(select * from public.journal_entries order by created_at, id offset {n}) j, "
        "jsonb_array_elements(j.lines) e where (e.value->>'debit')::numeric > 0 "
        "group by e.value->>'code' order by 1")
    return {b.split("=")[0]: float(b.split("=")[1]) for b in baris.splitlines() if b}


JALAN = ("select public.clinic_post_invoice('%s', '%s', "
         "'{\"tanggal\":\"2026-10-29\",\"subtotal\":100000,\"total\":100000,"
         "\"paid_status\":\"Belum Lunas\",\"dp_amount\":%d%s}'::jsonb, '%s'::jsonb)")


# ===========================================================================
# Skenario — dijalankan dua kali: tanpa mitigasi (reproduksi) dan dengan mitigasi.
# ===========================================================================
def fin01(pg, mitigasi):
    """FIN-01 — pembatalan kwitansi campuran harus mengembalikan rekening aslinya."""
    inv1 = tagih(pg, 1, "s1-a", 100000, 1)
    inv2 = tagih(pg, 1, "s1-b", 100000, 2)
    kwt = nilai(pg, bayar_sql(1, "s1-k", [{"method": "Tunai", "amount": 120000},
                                          {"method": "QRIS", "amount": 130000}]))
    assert pg.sql("select amount || '|' || applied from public.clinic_customer_advances") == "50000.00|0.00"
    assert status(pg, inv1) == "Lunas" and status(pg, inv2) == "Lunas"
    tanda = jml_jurnal(pg)
    sebagai(pg, f"select public.clinic_void_payment_receipt('{kwt}', 's1-v', 'salah rekening')")
    kredit = kredit_setelah(pg, tanda)
    harap = {"1101": 120000.0, "1102": 130000.0} if mitigasi else {"1101": 170000.0, "1102": 80000.0}
    assert {k: v for k, v in kredit.items() if k in ("1101", "1102")} == harap, kredit
    assert debit_setelah(pg, tanda) == {"1201": 200000.0, "2103": 50000.0}, debit_setelah(pg, tanda)
    assert dibayar(pg, inv1) == 0 and dibayar(pg, inv2) == 0
    assert status(pg, inv1) == "Belum Lunas" and status(pg, inv2) == "Belum Lunas"
    assert pg.sql("select status from public.clinic_customer_advances") == "batal"
    # Diulang dengan kunci yang sama: tidak membalik dua kali.
    sebagai(pg, f"select public.clinic_void_payment_receipt('{kwt}', 's1-v', 'salah rekening')")
    assert jml_jurnal(pg) == tanda + 4, jml_jurnal(pg)
    ditolak(pg, f"select public.clinic_void_payment_receipt('{kwt}', 's1-v2', 'lagi')", "RECEIPT_VOIDED")

    # Dua bagian pada REKENING YANG SAMA, sebagian jadi uang muka.
    kwt2 = nilai(pg, bayar_sql(1, "s1-k2", [{"method": "Tunai", "amount": 60000},
                                            {"method": "Tunai", "amount": 190000}]))
    tanda2 = jml_jurnal(pg)
    sebagai(pg, f"select public.clinic_void_payment_receipt('{kwt2}', 's1-v3', 'uji satu rekening')")
    kredit2 = kredit_setelah(pg, tanda2)
    assert kredit2.get("1101") == 250000.0, kredit2
    catat("FIN-01 pembalikan kwitansi campuran",
          "REPRODUKSI" if not mitigasi else "PASS",
          f"kredit pembalik per rekening = {harap}; kwitansi satu rekening = {kredit2}")


def fin04(pg, mitigasi):
    """FIN-04 — status bayar dihitung ulang setelah SETIAP langkah uang."""
    inv = tagih(pg, 2, "s2-a", 100000, 1)
    assert status(pg, inv) == "Belum Lunas"
    nilai(pg, bayar_sql(2, "s2-k1", [{"method": "Tunai", "amount": 40000}]))
    sesudah_dp = status(pg, inv)
    assert sesudah_dp == ("DP" if mitigasi else "Belum Lunas"), sesudah_dp
    kwt2 = nilai(pg, bayar_sql(2, "s2-k2", [{"method": "Tunai", "amount": 60000}]))
    assert status(pg, inv) == "Lunas"
    sebagai(pg, f"select public.clinic_void_payment_receipt('{kwt2}', 's2-v', 'salah nominal')")
    sesudah_batal = status(pg, inv)
    assert sesudah_batal == ("DP" if mitigasi else "Belum Lunas"), sesudah_batal
    assert dibayar(pg, inv) == 40000.0
    catat("FIN-04 status bayar tiap langkah",
          "REPRODUKSI" if not mitigasi else "PASS",
          f"setelah DP Rp40.000 = {sesudah_dp}; setelah batal kwitansi pelunasan = {sesudah_batal}"
          f" (dibayar Rp40.000, sisa Rp60.000)")


def fin03(pg, mitigasi):
    """FIN-03 — uang muka yang sudah dipakai punya jalan keluar yang sah."""
    kwt = nilai(pg, bayar_sql(3, "s3-k", [{"method": "Tunai", "amount": 150000}]))
    adv = pg.sql("select id from public.clinic_customer_advances order by created_at desc limit 1")
    inv = tagih(pg, 3, "s3-a", 100000, 1, alasan=False)
    assert status(pg, inv) == "Lunas"
    assert pg.sql(f"select applied from public.clinic_customer_advances where id='{adv}'") == "100000.00"
    pesan = ditolak(pg, f"select public.clinic_void_payment_receipt('{kwt}', 's3-v', 'salah metode')", "ADVANCE_USED")
    ada_rpc = pg.sql("select count(*) from pg_proc where proname='clinic_release_advance_application'") == "1"
    if not mitigasi:
        assert not ada_rpc
        ditolak_pembungkus(pg, f"select public.clinic_void_reissue_invoice_core('{inv}', 's3-r', 'koreksi')",
                           "INPATIENT_OPEN")
        catat("FIN-03 uang muka terpakai terkunci", "REPRODUKSI",
              "ADVANCE_USED tanpa jalan keluar: tidak ada RPC pelepasan, terbit ulang saat masih dirawat "
              "ditolak INPATIENT_OPEN")
        return
    assert ada_rpc
    ditolak(pg, f"select public.clinic_release_advance_application('{adv}', 's3-l', 'coba')",
            "ACCESS_DENIED", user=STAF)
    ditolak(pg, f"select public.clinic_release_advance_application('{adv}', 's3-l', '')", "RELEASE_INVALID")
    tanda = jml_jurnal(pg)
    assert nilai(pg, f"select public.clinic_release_advance_application('{adv}', 's3-l', 'salah metode pembayaran')") == "1"
    assert kredit_setelah(pg, tanda) == {"2103": 100000.0}, kredit_setelah(pg, tanda)
    assert debit_setelah(pg, tanda) == {"1201": 100000.0}, debit_setelah(pg, tanda)
    assert pg.sql(f"select applied from public.clinic_customer_advances where id='{adv}'") == "0.00"
    assert dibayar(pg, inv) == 0.0 and status(pg, inv) == "Belum Lunas"
    # Tidak boleh dilepas dua kali. Kunci yang sama menjawab hasil yang dulu; kunci
    # baru tidak ditolak permanen (itu yang dulu membuat jalan buntu), tetapi tidak
    # ada lagi pemakaian yang bisa dilepas sehingga hasilnya nol dan jurnal diam.
    diam = jml_jurnal(pg)
    assert nilai(pg, f"select public.clinic_release_advance_application('{adv}', 's3-l', 'salah metode pembayaran')") == "1"
    assert nilai(pg, f"select public.clinic_release_advance_application('{adv}', 's3-l2', 'lagi')") == "0"
    assert jml_jurnal(pg) == diam, "pelepasan ulang menulis jurnal baru"
    assert pg.sql(f"select applied from public.clinic_customer_advances where id='{adv}'") == "0.00"
    tanda2 = jml_jurnal(pg)
    sebagai(pg, f"select public.clinic_void_payment_receipt('{kwt}', 's3-v2', 'salah metode pembayaran')")
    assert kredit_setelah(pg, tanda2) == {"1101": 150000.0}, kredit_setelah(pg, tanda2)
    assert pg.sql(f"select status from public.clinic_customer_advances where id='{adv}'") == "batal"
    # Tagihan tahap pasien yang MASIH dirawat boleh diterbitkan ulang lewat konteks internal.
    baru = sebagai_pembungkus(pg, f"select public.clinic_void_reissue_invoice_core('{inv}', 's3-r', 'koreksi')").splitlines()[-1]
    assert pg.sql(f"select stage_billing from public.invoices where id='{baru}'") == "t"
    assert pg.sql("select count(*) from clinic_private.posting_ctx") == "0"
    catat("FIN-03 pelepasan uang muka berwenang", "PASS",
          f"ADVANCE_USED menunjuk jalan keluar ({pesan.strip().splitlines()[0][:60]}…); pelepasan "
          "OWNER/ADMIN/FINANCE membalik 2103/1201 Rp100.000, applied kembali 0, kwitansi lalu bisa "
          "dibatalkan penuh Rp150.000, dan terbit ulang saat masih dirawat berhasil")


def fin02(pg, mitigasi):
    """FIN-02 — kwitansi mengikuti tagihan pengganti setelah terbit ulang."""
    inv = tagih(pg, 4, "s4-a", 100000, 1)
    kwt = nilai(pg, bayar_sql(4, "s4-k", [{"method": "Tunai", "amount": 100000}]))
    assert status(pg, inv) == "Lunas"
    baru = sebagai_pembungkus(pg, f"select public.clinic_void_reissue_invoice_core('{inv}', 's4-r', 'koreksi deskripsi')").splitlines()[-1]
    punya_kwitansi = pg.sql(
        f"select count(*) from public.invoice_payments where invoice_id='{baru}' and receipt_id='{kwt}'")
    sebagai(pg, f"select public.clinic_void_payment_receipt('{kwt}', 's4-v', 'uang dikembalikan')")
    sisa_baru = dibayar(pg, baru)
    assert sisa_baru == (0.0 if mitigasi else 100000.0), sisa_baru
    if mitigasi:
        assert punya_kwitansi == "1", punya_kwitansi
        assert status(pg, baru) == "Belum Lunas", status(pg, baru)
        # Pembalik hanya sekali: tagihan lama yang sudah void tidak ikut dibalik lagi.
        assert pg.sql(f"select count(*) from public.invoice_payments where receipt_id='{kwt}' and amount < 0") == "1"
    else:
        assert punya_kwitansi == "0", punya_kwitansi
    catat("FIN-02 lineage kwitansi pada terbit ulang",
          "REPRODUKSI" if not mitigasi else "PASS",
          f"pembayaran tagihan pengganti setelah kwitansi dibatalkan = Rp{sisa_baru:,.0f}"
          f"; baris berkwitansi pada pengganti = {punya_kwitansi}")


def fin05(pg, mitigasi):
    """FIN-05 — uang tagihan tahap tidak boleh masuk lewat jalur piutang lama."""
    inv = tagih(pg, 5, "s5-a", 100000, 1)
    perintah = ("select public.clinic_receive_invoice_payment('%s', date '2026-10-29', 40000, "
                "'Tunai', '1101', null, 's5-p')" % inv)
    if mitigasi:
        ditolak(pg, perintah, "STAGE_RECEIPT")
        assert dibayar(pg, inv) == 0.0
        assert pg.sql(f"select stage_billing from public.invoices where id='{inv}'") == "t"
        catat("FIN-05 pelunasan tahap lewat Keuangan → Piutang", "PASS",
              "RPC piutang menolak tagihan tahap (STAGE_RECEIPT) sehingga uangnya wajib lewat kwitansi "
              "kunjungan di dalam shift klinik")
    else:
        sebagai(pg, perintah)
        kwitansi = pg.sql(f"select count(*) from public.clinic_payment_receipts where visit_id='{VIS[5]}'")
        assert dibayar(pg, inv) == 40000.0 and kwitansi == "0"
        catat("FIN-05 pelunasan tahap lewat Keuangan → Piutang", "REPRODUKSI",
              "Rp40.000 masuk ke tagihan tahap tanpa kwitansi dan tanpa shift klinik (kwitansi kunjungan = 0)")


def uf04(pg, mitigasi):
    """UF-04 — kepulangan tidak menimpa jasa rawat inap yang diisi petugas."""
    sebagai(pg, f"select public.clinic_change_inpatient_condition('{REC[6]}', 'sembuh', 'pulang')")
    hasil = pg.sql(f"select count(*) || '|' || coalesce(sum(qty),0) || '|' || coalesce(sum(harga),0) "
                   f"from public.prescription_items where medical_record_id='{MRID[6]}' and kategori='Rawat Inap'")
    jumlah, qty, harga = hasil.split("|")
    if mitigasi:
        # Pilihan petugas (3 hari @ Rp120.000) tidak boleh dihapus/dihitung ulang.
        assert (jumlah, qty, harga) == ("1", "3", "120000"), hasil
    else:
        # #339 masih menghapus baris manual dan menggantinya dengan ceil(lama inap)
        # pada tarif master: qty berubah dan harganya ikut berubah.
        assert jumlah == "1" and int(qty) >= 5 and harga == "150000", hasil
    catat("UF-04 tarif rawat inap manual",
          "REPRODUKSI" if not mitigasi else "PASS",
          f"baris Rawat Inap sesudah pulang (jumlah|qty|harga) = {hasil}")


def fin07(pg, mitigasi):
    """FIN-07 — satu baris resep tidak boleh dua kali dalam SATU tagihan."""
    perintah = TAHAP % (VIS[7], "s7-a", 200000, 200000, ALASAN, baris_json(7, 1, 100000, 2))
    if mitigasi:
        ditolak(pg, perintah, "LINE_BILLED")
        assert pg.sql(f"select count(*) from public.invoices where visit_id='{VIS[7]}'") == "0"
        assert pg.sql(f"select count(*) from public.invoice_items where prescription_item_id='{PRES(7,1)}'") == "0"
        # Penjaga akhir transaksi juga menangkap penulisan di luar jalur RPC tahap.
        ditolak(pg, "insert into public.invoice_items(invoice_id, deskripsi, prescription_item_id) "
                    "select i.id, 'dobel', '%s' from public.invoices i where i.visit_id='%s' limit 1"
                    % (PRES(1, 1), VIS[1]), "LINE_BILLED")
        catat("FIN-07 duplikat baris resep dalam satu tagihan", "PASS",
              "payload berisi dua salinan prescription_item_id ditolak LINE_BILLED; tidak ada invoice, "
              "baris invoice, atau jurnal yang tersisa")
    else:
        sebagai(pg, perintah)
        dobel = pg.sql(f"select count(*) from public.invoice_items where prescription_item_id='{PRES(7,1)}'")
        assert dobel == "2", dobel
        catat("FIN-07 duplikat baris resep dalam satu tagihan", "REPRODUKSI",
              f"satu baris resep tertagih {dobel}x dalam satu invoice senilai Rp200.000")


def fin06(pg, mitigasi):
    """FIN-06/ACCESS-02 — penundaan uang muka minimal tidak boleh diminta pemanggil."""
    garis = ('[{"description":"Jalan","qty":1,"price":100000,"kind":"obat",'
             '"prescription_item_id":"%s"}]')
    kasus = [
        (8, "s6-flag", ',"min_dp_deferred":true'),
        (9, "s6-split", ',"split_payments":[]'),
        (10, "s6-guc", ',"min_dp_deferred":true'),
    ]
    hasil = []
    for k, key, tambahan in kasus:
        perintah = JALAN % (VIS[k], key, 0, tambahan, garis % PRES(k, 1))
        if k == 10:
            # GUC `clinic.stage_visit` dipalsukan: penanda #339 berasal dari sesi, bukan
            # dari konteks internal, jadi harus dicoba sebagai penyerang.
            perintah = f"select set_config('clinic.stage_visit', '{VIS[k]}', false); " + perintah
        if mitigasi:
            ditolak(pg, perintah, "DP_MINIMAL", user=STAF)
            assert pg.sql(f"select count(*) from public.invoices where visit_id='{VIS[k]}'") == "0"
            hasil.append(f"{key}=DP_MINIMAL")
        else:
            inv = nilai(pg, perintah, user=STAF)
            assert pg.sql(f"select paid_status from public.invoices where id='{inv}'") == "Belum Lunas"
            hasil.append(f"{key}=lolos")
    # Tanpa alasan dan tanpa peran, penerobosan tetap ditolak di kedua babak.
    ditolak(pg, JALAN % (VIS[11], "s6-polos", 0, "", garis % PRES(11, 1)), "DP_MINIMAL", user=STAF)
    catat("FIN-06/ACCESS-02 uang muka minimal dari payload",
          "REPRODUKSI" if not mitigasi else "PASS", "; ".join(hasil))


def piutang_biasa(pg, mitigasi):
    """Regresi: pelunasan piutang rawat jalan biasa tetap jalan, statusnya ikut uang."""
    garis = ('[{"description":"Jalan","qty":1,"price":100000,"kind":"obat",'
             '"prescription_item_id":"%s"}]' % PRES(11, 2))
    inv = nilai(pg, JALAN % (VIS[11], "s8-a", 60000, "", garis))
    sebagai(pg, f"select public.clinic_receive_invoice_payment('{inv}', date '2026-10-29', 20000,"
                " 'Tunai', '1101', null, 's8-p1')")
    sebagian = status(pg, inv)
    assert sebagian == ("DP" if mitigasi else "Belum Lunas"), sebagian
    sebagai(pg, f"select public.clinic_receive_invoice_payment('{inv}', date '2026-10-29', 20000,"
                " 'Tunai', '1101', null, 's8-p2')")
    assert status(pg, inv) == "Lunas"
    assert pg.sql(f"select status from public.visits where id='{VIS[11]}'") == "Selesai"
    catat("Regresi pelunasan piutang rawat jalan", "PASS",
          f"status sesudah cicilan pertama = {sebagian}; pelunasan penuh tetap Lunas dan menutup kunjungan")


def checkout(pg, mitigasi):
    """Regresi: checkout campuran dan checkout DEMO tetap bisa diposting."""
    garis = ('[{"description":"Jalan","qty":1,"price":100000,"kind":"obat",'
             '"prescription_item_id":"%s"}]')
    faktur = ('{"tanggal":"2026-10-29","subtotal":100000,"total":100000,'
              '"paid_status":"Lunas","dp_amount":0}')
    bagian = ('[{"method":"Tunai","amount":60000,"kas_code":"1101"},'
              '{"method":"QRIS","amount":40000,"kas_code":"1102"}]')
    split = nilai(pg, "select public.clinic_post_split_invoice('%s','s9-s','%s'::jsonb,'%s'::jsonb,'%s'::jsonb)"
                  % (VIS[12], faktur, garis % PRES(12, 1), bagian))
    assert status(pg, split) == "Lunas" and dibayar(pg, split) == 100000.0
    demo = "select public.clinic_post_demo_invoice('%s','s9-d','%s'::jsonb,'%s'::jsonb,null,'%s'::jsonb,'{}')" % (
        VIS[13], faktur, garis % PRES(13, 1), bagian)
    if mitigasi:
        inv = nilai(pg, demo)
        assert status(pg, inv) == "Lunas" and dibayar(pg, inv) == 100000.0
        catat("Regresi checkout campuran & DEMO", "PASS",
              "keduanya terposting lunas; penundaan uang muka minimal berasal dari konteks internal")
    else:
        ditolak(pg, demo, "DP_MINIMAL")
        catat("Regresi checkout campuran & DEMO", "REPRODUKSI",
              "checkout campuran lolos karena kunci split_payments, tetapi checkout DEMO justru "
              "tertahan DP_MINIMAL sejak #339 walaupun dibayar penuh")


SKENARIO = [fin01, fin04, fin03, fin02, fin05, uf04, fin07, fin06, piutang_biasa, checkout]


def babak_uang(pg, mitigasi):
    reset(pg)
    pg.sql(M339.read_text())
    if mitigasi:
        pg.sql(MITIGASI.read_text())
    pg.sql(fixture_sql())
    for skenario in SKENARIO:
        skenario(pg, mitigasi)


# ===========================================================================
# Babak A — kompilasi di atas definisi RPC yang sebenarnya berjalan
# ===========================================================================
def cek_jangkar_statis():
    for jangkar in JANGKAR:
        for berkas in sorted(MIGRATIONS.glob("*.sql")):
            if berkas.name in (MITIGASI.name,):
                continue
            jumlah = berkas.read_text().count(jangkar)
            assert jumlah <= 2, f"Jangkar {jangkar!r} muncul {jumlah}x di {berkas.name}"
    catat("Jangkar tambalan", "PASS", "setiap jangkar mitigasi tetap dapat dilacak di migrasi sumbernya")


def babak_kompilasi(pg):
    pg.sql(ROLES)
    pg.sql(RANGKA)
    pg.sql(HAK_RANGKA)
    pg.sql(GUARD_ASLI)
    for nama in SUMBER:
        pg.sql(definisi_asli(nama))
    pg.sql(M339.read_text())
    pg.sql(MITIGASI.read_text())
    catat("Kompilasi migrasi mitigasi", "PASS",
          "berjalan di atas definisi RPC asli + #339; setiap jangkar cocok tepat sekali")

    harus = {
        "public.clinic_post_invoice(uuid,text,jsonb,jsonb)": [
            "if not clinic_private.dp_deferred(p_visit_id) then",
            "LINE_BILLED: baris resep tercantum lebih dari sekali dalam satu tagihan",
        ],
        "public.clinic_post_split_invoice(uuid,text,jsonb,jsonb,jsonb)": [
            "clinic_private.context_begin('split',p_visit_id)",
            "clinic_private.enforce_min_dp(v_invoice_id,p_invoice ->> 'dp_override_reason')",
        ],
        "public.clinic_post_demo_invoice(uuid,text,jsonb,jsonb,uuid,jsonb,uuid[])": [
            "clinic_private.context_begin('demo',p_visit_id)",
        ],
        "public.clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text)": [
            "STAGE_RECEIPT: terima uang tagihan tahap lewat layar Tagihan rawat inap",
            "clinic_private.sync_paid_status(p_invoice_id)",
        ],
        "public.clinic_void_reissue_invoice_core(uuid,text,text)": [
            "p.receipt_id,p.reversal_of",
            "clinic_private.context_begin('stage',v_visit.id)",
            "update public.invoices set stage_billing=true where id=v_new_id",
        ],
        "public.clinic_change_inpatient_condition(uuid,text,text)": [
            "pi.kategori='Rawat Inap'",
        ],
        "public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)": [
            "and not clinic_private.payments_fully_reversed(p_invoice_id))",
            "select coalesce(sum(amount),0) into v_credit from public.invoice_payments\n    where invoice_id=p_invoice_id;",
        ],
        "public.clinic_void_reissue_invoice(uuid,text,text)": [
            "ACCESS_DENIED: hanya OWNER, ADMIN, atau FINANCE boleh membatalkan dan menerbitkan ulang tagihan",
        ],
        "public.clinic_edit_invoice(uuid,text,jsonb,jsonb)": [
            "ACCESS_DENIED: hanya OWNER, ADMIN, atau FINANCE boleh mengoreksi tagihan yang sudah menyangkut uang",
        ],
    }
    for sig, potongan in harus.items():
        definisi = pg.sql(f"select pg_get_functiondef('{sig}'::regprocedure)")
        for teks in potongan:
            assert teks in definisi, f"Tambalan hilang di {sig}: {teks}"
    posting = pg.sql("select pg_get_functiondef('public.clinic_post_invoice(uuid,text,jsonb,jsonb)'::regprocedure)")
    assert "min_dp_deferred" not in posting, "flag pemanggil masih dibaca clinic_post_invoice"
    assert "p_invoice ? 'split_payments'" not in posting, "kunci split_payments masih membuka pengecualian"
    catat("Tambalan RPC berjalan", "PASS",
          "min_dp_deferred dan split_payments tidak lagi dibaca clinic_post_invoice; keenam RPC tertambal")

    hak = pg.sql("select coalesce(string_agg(distinct privilege_type, ','), 'none') "
                 "from information_schema.table_privileges where grantee in ('authenticated','anon','service_role') "
                 "and table_schema='clinic_private'")
    assert hak == "none", hak
    skema = pg.sql("select coalesce(string_agg(nspname || ':' || coalesce(nullif(array_to_string("
                   "array(select r from unnest(array['authenticated','anon','service_role']) r "
                   "where has_schema_privilege(r, nspname, 'USAGE')), ','), ''), 'none'), ','), 'none') "
                   "from pg_namespace where nspname='clinic_private'")
    assert skema == "clinic_private:none", skema
    catat("Konteks posting internal", "PASS",
          "tabel penanda clinic_private.posting_ctx tidak dapat dibaca/ditulis akun aplikasi, "
          "dan skema clinic_private tidak dapat dipakai sama sekali")

    hak_rpc = pg.sql("select has_function_privilege('authenticated', "
                     "'public.clinic_release_advance_application(uuid,text,text)', 'EXECUTE')::text")
    assert hak_rpc == "true", hak_rpc
    pemicu = pg.sql("select string_agg(tgname, ',' order by tgname) from pg_trigger "
                    "where tgrelid='public.invoice_items'::regclass and not tgisinternal")
    assert "guard_invoice_item_billed_once_final" in pemicu, pemicu
    kolom = pg.sql("select count(*) from information_schema.columns where table_name='invoices' "
                   "and column_name='stage_billing'")
    assert kolom == "1", kolom
    catat("Struktur baru", "PASS",
          "RPC pelepasan uang muka dapat dipanggil akun login, penjaga tagih-sekali akhir transaksi "
          "terpasang, penanda tagihan tahap ada di tabel invoices")


def main():
    cek_jangkar_statis()
    with NativePostgres(BIN) as pg:
        babak_kompilasi(pg)
        print("\n--- BABAK B: reproduksi di atas #339 saja ---\n", flush=True)
        babak_uang(pg, mitigasi=False)
        print("\n--- BABAK C: sesudah migrasi mitigasi ---\n", flush=True)
        babak_uang(pg, mitigasi=True)
    HASIL.write_text(json.dumps({
        "harness": "scripts/test-ranap-mitigasi-postgres.py",
        "postgres": "lokal sekali pakai (/opt/data/kamo-pg-harness), fixture fiktif",
        "head_base": "a561b05572b983d89651aa0324e32dd63f6ad9be",
        "migrasi": ["20261031230000_ranap_tagihan_berjalan.sql", "20261103010000_ranap_mitigasi_audit.sql"],
        "hasil": LAPORAN,
    }, indent=1, ensure_ascii=False) + "\n")
    print(f"\nHasil eksekusi disimpan ke {HASIL}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
