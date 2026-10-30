#!/usr/bin/env python3
"""Kompilasi + uji alur migrasi "tagihan berjalan rawat inap" di PostgreSQL sungguhan.

Dua babak di satu klaster sekali pakai:

  A. KOMPILASI — definisi asli clinic_post_invoice, clinic_receive_invoice_payment,
     clinic_void_reissue_invoice_core, dan clinic_change_inpatient_condition dipasang apa
     adanya dari migrasi sumbernya, lalu seluruh migrasi 20261031230000 dijalankan.
     Yang dibuktikan: tabel, policy, hak akses, badan plpgsql baru, dan SETIAP jangkar
     tambalan teks benar-benar cocok tepat sekali pada definisi berjalan.

  B. ALUR UANG — skema disetel ulang dengan rangka seadanya (clinic_post_invoice tiruan
     yang tetap memuat jangkar aslinya), lalu uang benar-benar dijalankan: tagih tahap,
     tagih-sekali, kwitansi campuran, alokasi tertua lebih dulu, uang muka, uang muka
     minimal, pembatalan kwitansi.

Isi tabel master (stok, HPP, promo) tidak diuji di sini — itu milik harness lain.
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

BIN = os.environ.get("KAMO_PG_BIN", "/opt/data/kamo-pg-harness/bin")
MIGRASI = ROOT / "supabase/migrations/20261031230000_ranap_tagihan_berjalan.sql"
MIGRATIONS = ROOT / "supabase/migrations"

SUMBER = {
    "clinic_post_invoice": ("20260924125000_clinic_invoice_post.sql",
                            "create or replace function public.clinic_post_invoice(", None),
    "clinic_receive_invoice_payment": ("20260929120000_clinic_billing_lifecycle.sql",
                                       "create function public.clinic_receive_invoice_payment(", None),
    "clinic_void_reissue_invoice_core": ("20261005090000_clinic_split_payment.sql",
                                         "create or replace function public.clinic_void_reissue_invoice(",
                                         "public.clinic_void_reissue_invoice_core("),
    "clinic_change_inpatient_condition": ("20261025180000_inpatient_forced_discharge.sql",
                                          "create or replace function public.clinic_change_inpatient_condition(", None),
}

# Jangkar yang dipakai migrasi. Dicek statis juga: kalau salah satu muncul di lebih dari
# satu migrasi, tambalan berikutnya bisa mengenai tempat yang salah.
JANGKAR = [
    "INVOICE_EXISTS: kunjungan sudah memiliki invoice aktif",
    "update public.invoices set request_key = v_request_key, request_hash = v_hash",
    "update public.visits set status='Selesai' where id = v_visit.id;",
    "and (kas_code is null or amount<=0)) then",
    "perform public.clinic_write_journal(current_date,'Terbit ulang '||v_no,",
    "INVOICE_EXISTS: tagihan sudah terbit sebelum biaya rawat inap dihitung",
]

RANGKA = """
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;

create table public.branches(id uuid primary key, name text, is_active boolean default true);
create table public.customers(id uuid primary key, name text, category_id uuid, points integer default 0);
create table public.profiles(id uuid primary key, role text, is_active boolean, full_name text);
create table public.visits(id uuid primary key, branch_id uuid, customer_id uuid, status text,
  poli text, dokter text, doctor_id uuid, service_provider_id uuid, created_at timestamptz default now());
create table public.inpatient_records(id uuid primary key, visit_id uuid, branch_id uuid,
  condition_status text, admitted_at timestamptz, discharged_at timestamptz, consent_id uuid);
create table public.inpatient_status_log(inpatient_record_id uuid, previous_status text,
  new_status text, changed_by uuid, notes text);
create table public.cashier_shifts(id uuid primary key, branch_id uuid, opened_by uuid,
  shift_type text, status text, opened_at timestamptz, opening_balance numeric);
create table public.items(id uuid primary key, name text, unit text, item_type text,
  is_active boolean, sell_price numeric, tindakan_kategori text, category_id uuid);
create table public.item_units(item_id uuid, unit text, factor numeric);
create table public.warehouses(id uuid primary key, branch_id uuid, type text, is_active boolean,
  created_at timestamptz default now());
create table public.stock(warehouse_id uuid, item_id uuid, qty numeric, updated_at timestamptz);
create table public.stock_layers(id uuid primary key, warehouse_id uuid, item_id uuid, qty_left numeric,
  unit_cost numeric, exp_date date, tanggal date, created_at timestamptz);
create table public.stock_moves(tanggal date, warehouse_id uuid, item_id uuid, qty numeric,
  unit_cost numeric, source text, source_ref text);
create table public.medical_records(id uuid primary key, visit_id uuid, created_at timestamptz default now());
create table public.prescription_items(id uuid primary key, medical_record_id uuid, item_id uuid,
  nama_obat text, qty numeric, harga numeric, satuan text, faktor numeric, jenis text, kategori text,
  aturan_pakai text, compound_recipe_id uuid, created_at timestamptz default now());
create table public.compounding_recipes(id uuid primary key, medical_record_id uuid, status text);
create table public.compound_issues(recipe_id uuid, qty numeric, unit_cost numeric,
  restored_at timestamptz, posted_invoice_item_id uuid);
create table public.invoices(id uuid primary key default gen_random_uuid(), visit_id uuid,
  invoice_no text unique, subtotal numeric, discount numeric, tax numeric, total numeric,
  dp_amount numeric default 0, dp_date date, paid_status text, metode_bayar text, paid_at timestamptz,
  voided_at timestamptz, reissued_from uuid, request_key text, request_hash text,
  correction_pending boolean default false, shift_cash_carry numeric, shift_id uuid,
  voucher_code text, campaign_code text, salesperson_id uuid, cashier_name text,
  service_pricing_version int, created_at timestamptz default now());
-- Indeks unik dari migrasi 0028: satu invoice aktif per kunjungan. Inilah yang harus
-- dicabut supaya tagihan tahap bisa hidup berdampingan.
create unique index invoices_visit_active_key on public.invoices(visit_id) where voided_at is null;
create table public.invoice_items(id uuid primary key default gen_random_uuid(), invoice_id uuid,
  deskripsi text, qty numeric, harga numeric, jenis text, diskon_persen numeric, item_id uuid,
  hpp numeric, compound_recipe_id uuid, prescription_item_id uuid, satuan text, faktor numeric,
  service_performers jsonb, service_source_line_id uuid, salesperson_id uuid, salesperson_name text,
  created_at timestamptz default now());
create table public.invoice_payments(id uuid primary key default gen_random_uuid(), invoice_id uuid,
  tanggal date, amount numeric, metode varchar(16), catatan text, kas_code text, created_by uuid,
  request_key text, request_hash text, transferred_from uuid, checkout_payment boolean default false,
  created_at timestamptz default now());
create table public.invoice_edit_log(invoice_id uuid, edited_by uuid, field_changed text,
  old_value text, new_value text, reason text, edited_at timestamptz default now());
create table public.clinic_invoice_operations(request_key text primary key, invoice_id uuid,
  request_hash text, kind text, result_invoice_id uuid);
create table public.cash_accounts(id uuid primary key, coa_code text, is_active boolean, branch_id uuid);
create table public.payment_account_map(metode text, branch_id uuid, cash_account_id uuid);
create table public.coa_accounts(id uuid primary key default gen_random_uuid(), code text unique,
  is_active boolean, is_header boolean);
create table public.document_numbering(jenis varchar(10) primary key, pola varchar(30), digit smallint);
create table public.journal_entries(id uuid primary key default gen_random_uuid(), no_jurnal text,
  tanggal date, deskripsi text, source text, source_ref text, branch_id uuid, lines jsonb,
  created_at timestamptz default now());
create table public.journal_lines(entry_id uuid, account_id uuid, debit numeric, credit numeric);

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
create or replace function public.clinic_post_split_invoice(p_visit_id uuid, p_request_key text,
  p_invoice jsonb, p_lines jsonb, p_payments jsonb) returns uuid language sql as $$ select null::uuid $$;
"""

# Hak dasar proyek Supabase: skema public terbuka untuk peran aplikasi, RLS yang membatasi.
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

# clinic_post_invoice tiruan untuk babak B. Jangkar aslinya disalin PERSIS supaya tambalan
# migrasi mengenai teks yang sama dengan di produksi.
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
declare v_visit public.visits%rowtype; v_payment_id uuid;
begin
  select v.* into v_visit from public.visits v
  join public.invoices i on i.visit_id = v.id where i.id = p_invoice_id;
  insert into public.invoice_payments(invoice_id, tanggal, amount, metode, kas_code, request_key)
  values (p_invoice_id, p_tanggal, p_amount, p_metode, p_kas_code, p_request_key)
  returning id into v_payment_id;
  if true then
    update public.visits set status='Selesai' where id = v_visit.id;
  end if;
  return v_payment_id;
end;
$function$;
"""

STUB_VOID = r"""
create or replace function public.clinic_void_reissue_invoice_core(
  p_invoice_id uuid, p_request_key text, p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $function$
declare v_visit public.visits%rowtype; v_invoice public.invoices%rowtype; v_new_id uuid;
  v_no text; v_lines jsonb := '[]'::jsonb;
begin
  select v.* into v_visit from public.visits v join public.invoices i on i.visit_id = v.id where i.id = p_invoice_id;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if exists(select 1 from public.invoice_payments where invoice_id=p_invoice_id
      and (kas_code is null or amount<=0)) then
    raise exception using errcode='P0001', message='JOURNAL_MISSING: rekening cicilan tidak lengkap'; end if;
  v_no := v_invoice.invoice_no || '-R';
  update public.invoices set voided_at=now() where id=p_invoice_id;
  insert into public.invoices(visit_id, invoice_no, subtotal, discount, tax, total, dp_amount,
    paid_status, reissued_from, request_key, correction_pending)
  values(v_visit.id, v_no, v_invoice.subtotal, 0, 0, v_invoice.total, 0, 'Belum Lunas',
    p_invoice_id, p_request_key, true) returning id into v_new_id;
  insert into public.invoice_items(invoice_id, deskripsi, qty, harga, jenis, prescription_item_id)
  select v_new_id, deskripsi, qty, harga, jenis, prescription_item_id
  from public.invoice_items where invoice_id = p_invoice_id;
  perform public.clinic_write_journal(current_date,'Terbit ulang '||v_no,
    'klinik-reissue',v_no,v_visit.branch_id,v_lines);
  insert into public.invoice_payments(invoice_id, tanggal, amount, metode, kas_code, transferred_from)
  select v_new_id, current_date, p.amount, p.metode, p.kas_code, p_invoice_id
  from public.invoice_payments p where p.invoice_id = p_invoice_id;
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
        insert into public.prescription_items(id, medical_record_id, item_id, nama_obat, qty, harga, satuan, jenis, kategori)
        values (gen_random_uuid(), v_medical_record_id, v_tariff.id, v_tariff.name, v_days, 0, 'hari', 'jasa', 'Rawat Inap');
      end if;
    end if;
  end if;
  return true;
end;
$function$;
"""

# Penjaga INPATIENT_OPEN versi berjalan (migrasi 20260929120000) beserta pemicunya: migrasi
# ini menggantikan fungsinya, jadi versi lamanya harus benar-benar ada lebih dulu.
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

OWNER = "00000000-0000-4000-8000-00000000000a"
STAF = "00000000-0000-4000-8000-00000000000b"
VISIT = "00000000-0000-4000-8000-0000000000e1"
RECORD = "00000000-0000-4000-8000-0000000000e2"
SHIFT = "00000000-0000-4000-8000-0000000000e3"
SHIFT2 = "00000000-0000-4000-8000-0000000000e4"
BRANCH = "00000000-0000-4000-8000-0000000000b1"
CUST = "00000000-0000-4000-8000-0000000000c1"
MR = "00000000-0000-4000-8000-0000000000d1"

DATA = f"""
insert into auth.users(id) values ('{OWNER}'), ('{STAF}');
insert into public.profiles(id, role, is_active) values ('{OWNER}', 'OWNER', true), ('{STAF}', 'STAFF', true);
insert into public.branches(id, name) values ('{BRANCH}', 'Cabang Fiktif');
insert into public.customers(id, name) values ('{CUST}', 'Pemilik Fiktif');
insert into public.visits(id, branch_id, customer_id, status) values ('{VISIT}', '{BRANCH}', '{CUST}', 'Diperiksa');
insert into public.inpatient_records(id, visit_id, branch_id, condition_status, admitted_at)
  values ('{RECORD}', '{VISIT}', '{BRANCH}', 'stabil', now() - interval '2 days');
insert into public.cashier_shifts(id, branch_id, opened_by, shift_type, status, opened_at)
  values ('{SHIFT}', '{BRANCH}', '{OWNER}', 'klinik', 'open', now());
insert into public.coa_accounts(code, is_active, is_header) values
  ('1101', true, false), ('1102', true, false), ('1201', true, false),
  ('2103', true, false), ('4201', true, false);
insert into public.medical_records(id, visit_id) values ('{MR}', '{VISIT}');
insert into public.prescription_items(id, medical_record_id, nama_obat, qty, harga, jenis)
select ('00000000-0000-4000-8000-00000000f00' || n)::uuid, '{MR}', 'Baris ' || n, 1, 100000, 'obat'
from generate_series(1, 6) n;
"""


def sebagai(pg, perintah, user=OWNER):
    return pg.sql(
        f"select set_config('request.jwt.claim.sub', '{user}', false);"
        "select set_config('request.jwt.claim.role', 'authenticated', false);"
        f"set role authenticated; {perintah}")


def ditolak(pg, perintah, kode, user=OWNER):
    try:
        sebagai(pg, perintah, user)
    except RuntimeError as error:
        assert kode in str(error), f"Diharapkan {kode}, dapat: {error}"
        return
    raise AssertionError(f"Seharusnya ditolak dengan {kode}: {perintah}")


def definisi_asli(nama):
    berkas, mulai_teks, rename = SUMBER[nama]
    teks = (MIGRATIONS / berkas).read_text()
    mulai = teks.index(mulai_teks)
    akhir = teks.index("$function$;", mulai) + len("$function$;")
    potongan = teks[mulai:akhir]
    if rename:
        potongan = potongan.replace(mulai_teks[len("create or replace function "):], rename, 1)
    return potongan


def cek_jangkar_statis():
    """Jangkar harus unik: sekali di tiap migrasi, dan tepat sekali pada definisi yang dipasang.

    Jangkar yang muncul dua kali dalam satu definisi membuat tambalan berikutnya mengenai
    tempat yang salah; migrasi sendiri menolaknya, tapi di sini ketahuan sebelum klaster jalan.
    """
    for jangkar in JANGKAR:
        for berkas in sorted(MIGRATIONS.glob("*.sql")):
            if berkas.name == MIGRASI.name:
                continue
            jumlah = berkas.read_text().count(jangkar)
            assert jumlah <= 1, f"Jangkar {jangkar!r} muncul {jumlah}x di {berkas.name}"
    gabungan = "".join(definisi_asli(nama) for nama in SUMBER)
    for jangkar in JANGKAR:
        assert gabungan.count(jangkar) == 1, f"Jangkar {jangkar!r} tidak tepat sekali di definisi terpasang"
    print("PASS: setiap jangkar tambalan unik di migrasi sumber dan di definisi terpasang", flush=True)


def babak_kompilasi(pg):
    pg.sql(ROLES)
    pg.sql(RANGKA)
    pg.sql(HAK_RANGKA)
    pg.sql(GUARD_ASLI)
    for nama in SUMBER:
        pg.sql(definisi_asli(nama))
    pg.sql(MIGRASI.read_text())
    print("PASS: seluruh migrasi berjalan di atas definisi RPC yang asli", flush=True)

    harus = {
        "public.clinic_post_invoice(uuid,text,jsonb,jsonb)": [
            "clinic_private.stage_billing(p_visit_id)",
            "clinic_private.enforce_min_dp(v_invoice_id, p_invoice ->> 'dp_override_reason')",
            "not (p_invoice ? 'split_payments')",
        ],
        "public.clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text)": [
            "r.discharged_at is null",
            "i2.paid_status <> 'Lunas' and i2.id <> p_invoice_id",
        ],
        "public.clinic_void_reissue_invoice_core(uuid,text,text)": [
            "(kas_code is null or amount=0)",
            "clinic_private.remap_advance_applications(p_invoice_id,v_new_id)",
        ],
        "public.clinic_change_inpatient_condition(uuid,text,text)": [
            "i.request_key is not null",
        ],
        "public.guard_open_inpatient_invoice()": [
            "clinic_private.stage_billing(new.visit_id)",
        ],
    }
    for sig, potongan in harus.items():
        definisi = pg.sql(f"select pg_get_functiondef('{sig}'::regprocedure)")
        for teks in potongan:
            assert teks in definisi, f"Tambalan hilang di {sig}: {teks}"
    kondisi = pg.sql("select pg_get_functiondef('public.clinic_change_inpatient_condition(uuid,text,text)'::regprocedure)")
    assert "INVOICE_EXISTS" not in kondisi, "Penjaga kepulangan lama masih ada"
    print("PASS: keempat RPC berjalan tertambal lengkap dan penjaga kepulangan dicabut", flush=True)

    tulis = pg.sql(
        "select table_name || '=' || coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), 'none') "
        "from information_schema.table_privileges where grantee='authenticated' and table_name in "
        "('clinic_payment_receipts','clinic_payment_receipt_parts','clinic_customer_advances',"
        "'clinic_advance_applications','clinic_dp_overrides') group by table_name order by table_name")
    for baris in tulis.splitlines():
        assert baris.endswith("=SELECT"), f"hak tulis langsung masih terbuka: {baris}"
    print("PASS: seluruh tabel baru hanya bisa dibaca; semua tulisan lewat RPC", flush=True)

    pengaturan = pg.sql(
        "select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), 'none') "
        "from information_schema.table_privileges where grantee='authenticated' "
        "and table_name='clinic_billing_settings'")
    assert "SELECT" in pengaturan, pengaturan
    policies = pg.sql("select count(*) from pg_policies where tablename='clinic_billing_settings'")
    assert policies == "2", policies
    rls = pg.sql("select coalesce(string_agg(c.relname, ','), 'none') from pg_class c "
                 "join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not c.relrowsecurity "
                 "and c.relname in ('clinic_billing_settings','clinic_dp_overrides','clinic_payment_receipts',"
                 "'clinic_payment_receipt_parts','clinic_customer_advances','clinic_advance_applications')")
    assert rls == "none", f"ada tabel baru tanpa RLS: {rls}"
    print("PASS: pengaturan uang muka minimal dibaca semua, ditulis OWNER/ADMIN, RLS aktif", flush=True)

    pemicu = pg.sql("select tgname from pg_trigger where tgrelid='public.invoice_items'::regclass "
                    "and not tgisinternal order by tgname")
    assert "guard_invoice_item_billed_once" in pemicu, pemicu
    inap = pg.sql("select tgname from pg_trigger where tgrelid='public.invoices'::regclass and not tgisinternal")
    assert "guard_open_inpatient_invoice" in inap, inap
    # Indeks unik satu-invoice-per-kunjungan harus benar-benar tercabut, diganti indeks biasa.
    indeks = pg.sql("select coalesce(string_agg(indexname || ':' || (indexdef like 'CREATE UNIQUE%')::text, ','"
                    " order by indexname), 'none') from pg_indexes where tablename='invoices'"
                    " and indexname in ('invoices_visit_active_key','invoices_visit_active_idx')")
    assert indeks == "invoices_visit_active_idx:false", indeks
    print("PASS: kunci unik satu-invoice-per-kunjungan dicabut, pencarian per kunjungan tetap berindeks", flush=True)
    print("PASS: penjaga tagih-sekali terpasang pada invoice_items", flush=True)


def reset(pg):
    pg.sql("drop schema public cascade; create schema public; drop schema if exists clinic_private cascade;"
           "drop schema if exists auth cascade;")
    pg.sql(RANGKA)
    pg.sql(HAK_RANGKA)


def babak_alur(pg):
    reset(pg)
    pg.sql(GUARD_ASLI)
    for stub in (STUB_POST, STUB_RECEIVE, STUB_VOID, STUB_CONDITION):
        pg.sql(stub)
    pg.sql(MIGRASI.read_text())
    pg.sql(DATA)

    tahap = ("select public.clinic_post_inpatient_stage_invoice('%s', '%s', "
             "'{\"tanggal\":\"2026-10-29\",\"subtotal\":%d,\"total\":%d,\"paid_status\":\"Belum Lunas\"%s}'::jsonb, "
             "'%s'::jsonb)")
    baris = lambda n: ('[{"description":"Baris %d","qty":1,"price":100000,"kind":"obat",'
                       '"prescription_item_id":"00000000-0000-4000-8000-00000000f00%d"}]' % (n, n))

    # 1. Pasien masih dirawat: jalur lama tetap diblokir, jalur tahap boleh.
    ditolak(pg, "select public.clinic_post_invoice('%s', 'lama-1', "
                "'{\"tanggal\":\"2026-10-29\",\"total\":100000,\"paid_status\":\"Lunas\"}'::jsonb, '[]'::jsonb)" % VISIT,
            "INPATIENT_OPEN")
    inv1 = sebagai(pg, tahap % (VISIT, "tahap-1", 100000, 100000, ', "dp_override_reason": "DP ditunda, pemilik bayar nanti"', baris(1))).splitlines()[-1]
    assert pg.sql(f"select paid_status from public.invoices where id='{inv1}'") == "Belum Lunas"
    print("PASS: jalur invoice tunggal tetap tertutup, tagihan tahap terbit saat pasien dirawat", flush=True)

    # 2. Tahap kedua boleh terbit walau tahap pertama masih aktif.
    inv2 = sebagai(pg, tahap % (VISIT, "tahap-2", 100000, 100000, ', "dp_override_reason": "Menunggu transfer pemilik"', baris(2))).splitlines()[-1]
    assert pg.sql("select count(*) from public.invoices where voided_at is null") == "2"
    assert sebagai(pg, tahap % (VISIT, "tahap-2", 100000, 100000, ', "dp_override_reason": "Menunggu transfer pemilik"', baris(2))).splitlines()[-1] == inv2
    print("PASS: beberapa tagihan tahap hidup berdampingan; kunci yang sama tidak menggandakan", flush=True)

    # 3. Satu baris resep hanya boleh ditagih sekali.
    ditolak(pg, tahap % (VISIT, "tahap-3", 100000, 100000, "", baris(1)), "LINE_BILLED")
    print("PASS: baris resep yang sudah ditagih tidak bisa masuk tagihan kedua", flush=True)

    # 4. Uang muka minimal: tanpa alasan ditolak, alasan dari STAFF ditolak.
    ditolak(pg, tahap % (VISIT, "tahap-4", 100000, 100000, "", baris(3)), "DP_MINIMAL")
    ditolak(pg, tahap % (VISIT, "tahap-4b", 100000, 100000, ', "dp_override_reason": "coba"', baris(3)),
            "DP_OVERRIDE_DENIED", user=STAF)
    assert pg.sql("select count(*) from public.clinic_dp_overrides") == "2"
    catatan = pg.sql("select reason from public.clinic_dp_overrides order by created_at limit 1")
    assert catatan == "DP ditunda, pemilik bayar nanti", catatan
    print("PASS: uang muka minimal 50% ditegakkan database, penerobosan wajib beralasan & berperan", flush=True)

    # 5. Kwitansi campuran: alokasi tertua lebih dulu, sisanya jadi uang muka.
    bayar = ("select public.clinic_receive_visit_payment('%s', '%s', date '2026-10-29', "
             "'[{\"method\":\"Tunai\",\"amount\":120000},{\"method\":\"QRIS\",\"amount\":130000}]'::jsonb, null, null)")
    ditolak(pg, bayar % (VISIT, "kwt-1"), "SHIFT_INVALID", user=STAF)
    kwt1 = sebagai(pg, bayar % (VISIT, "kwt-1")).splitlines()[-1]
    assert sebagai(pg, bayar % (VISIT, "kwt-1")).splitlines()[-1] == kwt1
    nomor = pg.sql(f"select no_kwitansi from public.clinic_payment_receipts where id='{kwt1}'")
    assert nomor == "KWT-202610-0001", nomor
    assert pg.sql(f"select paid_status from public.invoices where id='{inv1}'") == "Lunas"
    assert pg.sql(f"select paid_status from public.invoices where id='{inv2}'") == "Lunas"
    # Tahap kedua dibayar dari sisa bagian Tunai lalu bagian QRIS: satu kwitansi boleh
    # memotong beberapa tagihan, dan tiap potongan menyimpan metodenya sendiri.
    rinci = pg.sql(f"select string_agg(metode || ':' || amount::text, ',' order by metode) "
                   f"from public.invoice_payments where invoice_id='{inv2}'")
    assert rinci == "QRIS:80000.00,Tunai:20000.00", rinci
    muka = pg.sql("select no_uang_muka || '|' || amount || '|' || applied from public.clinic_customer_advances")
    assert muka == "UMK-202610-0001|50000.00|0.00", muka
    jurnal = pg.sql("select lines::text from public.journal_entries where source='klinik-uang-muka'")
    assert '"code": "2103", "debit": 0, "credit": 50000' in jurnal, jurnal
    assert pg.sql("select count(*) from public.journal_entries where source='klinik-ar'") == "3"
    print("PASS: satu kwitansi campuran melunasi tahap tertua lalu menyisakan uang muka", flush=True)

    # 6. Pemilik tidak boleh terkunci status Selesai selagi dirawat.
    assert pg.sql(f"select status from public.visits where id='{VISIT}'") == "Diperiksa"
    print("PASS: kunjungan rawat inap tidak ditutup oleh pembayaran tahap", flush=True)

    # 7. Tahap berikutnya otomatis memotong uang muka.
    inv3 = sebagai(pg, tahap % (VISIT, "tahap-5", 50000, 50000, "", baris(4))).splitlines()[-1]
    assert pg.sql(f"select paid_status from public.invoices where id='{inv3}'") == "Lunas"
    pakai = pg.sql(f"select metode || '|' || amount || '|' || kas_code from public.invoice_payments where invoice_id='{inv3}'")
    assert pakai == "Uang Muka|50000.00|2103", pakai
    assert pg.sql("select applied from public.clinic_customer_advances") == "50000.00"
    lines = pg.sql("select lines::text from public.journal_entries where deskripsi like 'Pemakaian uang muka%'")
    assert '"code": "2103", "debit": 50000.00' in lines, lines
    print("PASS: uang muka otomatis memotong tagihan tahap berikutnya tanpa kas kedua", flush=True)

    # 8. Kwitansi yang uang mukanya sudah terpakai tidak bisa dibatalkan dari layar kwitansi.
    ditolak(pg, f"select public.clinic_void_payment_receipt('{kwt1}', 'void-1', 'salah input')", "ADVANCE_USED")
    print("PASS: uang muka yang sudah menempel di tagihan tidak bisa dibatalkan diam-diam", flush=True)

    # 9. Kwitansi baru lalu dibatalkan: baris pembalik, jurnal balik, status bayar mundur.
    inv4 = sebagai(pg, tahap % (VISIT, "tahap-7", 100000, 100000, ', "dp_override_reason": "pemilik bayar sebagian besok"', baris(5))).splitlines()[-1]
    kwt2 = sebagai(pg, "select public.clinic_receive_visit_payment('%s', 'kwt-2', date '2026-10-29', "
                       "'[{\"method\":\"Tunai\",\"amount\":40000}]'::jsonb, null, null)" % VISIT).splitlines()[-1]
    assert pg.sql(f"select sum(amount) from public.invoice_payments where invoice_id='{inv4}'") == "40000.00"
    ditolak(pg, f"select public.clinic_void_payment_receipt('{kwt2}', 'void-2', '')", "RECEIPT_INVALID")
    ditolak(pg, f"select public.clinic_void_payment_receipt('{kwt2}', 'void-2', 'salah nominal')",
            "ACCESS_DENIED", user=STAF)
    sebagai(pg, f"select public.clinic_void_payment_receipt('{kwt2}', 'void-2', 'salah nominal')")
    assert pg.sql(f"select sum(amount) from public.invoice_payments where invoice_id='{inv4}'") == "0.00"
    assert pg.sql(f"select paid_status from public.invoices where id='{inv4}'") == "Belum Lunas"
    assert pg.sql(f"select status || '|' || void_reason from public.clinic_payment_receipts where id='{kwt2}'") == "batal|salah nominal"
    balik = pg.sql("select lines::text from public.journal_entries where deskripsi like 'Pembatalan pembayaran%'")
    assert '"code": "1201", "debit": 40000.00' in balik, balik
    # Diulang dengan kunci sama: tidak membalik dua kali.
    sebagai(pg, f"select public.clinic_void_payment_receipt('{kwt2}', 'void-2', 'salah nominal')")
    assert pg.sql("select count(*) from public.journal_entries where deskripsi like 'Pembatalan pembayaran%'") == "1"
    ditolak(pg, f"select public.clinic_void_payment_receipt('{kwt2}', 'void-3', 'lagi')", "RECEIPT_VOIDED")
    print("PASS: kwitansi dibatalkan dengan baris & jurnal pembalik, sekali saja, wajib beralasan", flush=True)

    # 10. Kunci yang sama untuk nominal berbeda tidak pernah lolos.
    ditolak(pg, "select public.clinic_receive_visit_payment('%s', 'kwt-1', date '2026-10-29', "
                "'[{\"method\":\"Tunai\",\"amount\":999}]'::jsonb, null, null)" % VISIT, "IDEMPOTENCY_CONFLICT")
    print("PASS: kunci kwitansi yang dipakai ulang untuk data berbeda ditolak", flush=True)

    # 11. Kepulangan tidak lagi diblokir tagihan, dan tarif otomatis tidak ditambahkan lagi.
    sebagai(pg, f"select public.clinic_change_inpatient_condition('{RECORD}', 'sembuh', 'pulang')")
    assert pg.sql(f"select discharged_at is not null from public.inpatient_records where id='{RECORD}'") == "t"
    assert pg.sql("select count(*) from public.prescription_items where kategori='Rawat Inap'") == "0"
    print("PASS: pasien boleh pulang walau tagihan sudah terbit; hari inap tidak dihitung otomatis", flush=True)

    # 12. Void & terbit ulang memindahkan pemakaian uang muka ke tagihan pengganti.
    # _core memang tidak boleh dipanggil akun aplikasi (dibungkus clinic_void_reissue_invoice),
    # jadi di sini dipanggil langsung sebagai pemilik seperti pembungkusnya melakukannya.
    baru = pg.sql(f"select set_config('request.jwt.claim.sub', '{OWNER}', false);"
                  f"select public.clinic_void_reissue_invoice_core('{inv3}', 'reissue-1', 'koreksi')").splitlines()[-1]
    assert pg.sql(f"select invoice_id='{baru}' from public.clinic_advance_applications") == "t"
    print("PASS: void & terbit ulang membawa uang muka ke tagihan pengganti, saldo tidak hilang", flush=True)

    # 13. Baris resep yang tagihannya sudah di-void boleh ditagih ulang.
    pg.sql(f"update public.invoices set voided_at=now() where id='{baru}'")
    ulang = sebagai(pg, tahap % (VISIT, "tahap-6", 50000, 50000, ', "dp_override_reason": "tagih ulang setelah void"', baris(4))).splitlines()[-1]
    assert ulang != baru
    print("PASS: setelah tagihan di-void, baris resepnya bisa ditagih lagi", flush=True)


def main():
    cek_jangkar_statis()
    assert re.search(r"^\s*(alter|drop)\s+table\s+public\.(invoices|invoice_items|prescription_items)\b",
                     MIGRASI.read_text(), re.M | re.I) is None, "migrasi mengubah tabel inti di luar rencana"
    with NativePostgres(BIN) as pg:
        babak_kompilasi(pg)
        babak_alur(pg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
