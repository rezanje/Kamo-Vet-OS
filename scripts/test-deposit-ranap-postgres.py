#!/usr/bin/env python3
"""Kompilasi migrasi deposit rawat inap di PostgreSQL sungguhan (tanpa database remote).

Tanpa skema produksi di CI, yang bisa diperiksa adalah hal yang paling mematikan saat
deploy: apakah seluruh migrasi 20261031220000 benar-benar DAPAT DIJALANKAN — tabel,
policy, fungsi SQL, badan plpgsql, dan tambalan teks pada clinic_void_reissue_invoice_core.
Tabel/fungsi lain dibuat sebagai rangka seadanya; isi datanya tidak diuji di sini.
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

BIN = os.environ.get("KAMO_PG_BIN", "/opt/data/kamo-pg-harness/bin")
MIGRASI = ROOT / "supabase/migrations/20261031220000_deposit_rawat_inap.sql"
VOID_SUMBER = ROOT / "supabase/migrations/20261005090000_clinic_split_payment.sql"

RANGKA = """
create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
create role authenticated;
create role anon;
create role service_role;

create table public.branches(id uuid primary key, name text);
create table public.customers(id uuid primary key, name text);
create table public.visits(id uuid primary key, branch_id uuid, customer_id uuid, status text);
create table public.inpatient_records(id uuid primary key, visit_id uuid, branch_id uuid,
  admitted_at timestamptz, discharged_at timestamptz);
create table public.cashier_shifts(id uuid primary key, branch_id uuid, opened_by uuid,
  shift_type text, status text, opened_at timestamptz);
create table public.journal_entries(id uuid primary key, no_jurnal text, source text, source_ref text, lines jsonb);
create table public.invoices(id uuid primary key, visit_id uuid, invoice_no text, total numeric,
  dp_amount numeric, paid_status text, metode_bayar text, paid_at timestamptz, voided_at timestamptz,
  reissued_from uuid, request_key text, request_hash text, correction_pending boolean,
  shift_cash_carry numeric, shift_id uuid, voucher_code text, salesperson_id uuid,
  subtotal numeric, discount numeric, tax numeric, dp_date date, service_pricing_version int);
create table public.invoice_payments(id uuid primary key default gen_random_uuid(), invoice_id uuid,
  tanggal date, amount numeric, metode text, catatan text, kas_code text, created_by uuid,
  request_key text, request_hash text, transferred_from uuid, checkout_payment boolean);
create table public.invoice_items(id uuid primary key, invoice_id uuid, hpp numeric);
create table public.invoice_edit_log(invoice_id uuid, edited_by uuid, field_changed text,
  old_value text, new_value text, reason text);
create table public.clinic_invoice_operations(request_key text primary key, invoice_id uuid,
  request_hash text, kind text, result_invoice_id uuid);
create table public.profiles(id uuid primary key, role text, is_active boolean);
create table public.cash_accounts(id uuid primary key, coa_code text, is_active boolean, branch_id uuid);
create table public.payment_account_map(metode text, branch_id uuid, cash_account_id uuid);
create table public.coa_accounts(code text primary key, is_active boolean, is_header boolean);
create table public.document_numbering(jenis varchar(10) primary key, pola varchar(30), digit smallint);

create function public.user_can_access_branch(b uuid) returns boolean
  language sql stable as $$ select true $$;
create function public.clinic_write_journal(p_tanggal date, p_deskripsi text, p_source text,
  p_source_ref text, p_branch_id uuid, p_lines jsonb) returns uuid
  language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_debit numeric; v_credit numeric;
begin
  select coalesce(sum((e.value->>'debit')::numeric), 0), coalesce(sum((e.value->>'credit')::numeric), 0)
    into v_debit, v_credit from jsonb_array_elements(p_lines) e;
  if v_debit <> v_credit then raise exception 'JOURNAL_UNBALANCED %', p_source; end if;
  insert into public.journal_entries(id, no_jurnal, source, source_ref, lines)
  values (v_id, 'JRN-' || substr(v_id::text, 1, 8), p_source, p_source_ref, p_lines);
  return v_id;
end $$;
create function public.clinic_reverse_journal_lines(p_ref text, p_sources text[]) returns jsonb
  language sql as $$ select '[]'::jsonb $$;
create function public.set_visit_service_state(p_visit_id uuid, p_action text,
  p_provider_id uuid default null) returns void language sql as $$ select $$;
-- Rangka: cukup menyimpan apa yang diputuskan pembungkus deposit, supaya status
-- bayar dan uang muka yang diturunkannya bisa diperiksa.
create function public.clinic_post_invoice(p_visit_id uuid, p_request_key text, p_invoice jsonb,
  p_lines jsonb) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.invoices(id, visit_id, invoice_no, total, dp_amount, paid_status,
    request_key, correction_pending)
  values (v_id, p_visit_id, 'INV-' || substr(v_id::text, 1, 8),
    (p_invoice->>'total')::numeric, coalesce((p_invoice->>'dp_amount')::numeric, 0),
    p_invoice->>'paid_status', p_request_key, false);
  return v_id;
end $$;
"""


def badan_void() -> str:
    """Definisi clinic_void_reissue_invoice versi 2026-10-05, dipasang dengan nama _core."""
    teks = VOID_SUMBER.read_text()
    mulai = teks.index("create or replace function public.clinic_void_reissue_invoice(")
    akhir = teks.index("$function$;", mulai) + len("$function$;")
    return teks[mulai:akhir].replace(
        "public.clinic_void_reissue_invoice(", "public.clinic_void_reissue_invoice_core(", 1)


DATA = """
insert into auth.users(id) values
  ('00000000-0000-4000-8000-00000000000a'), ('00000000-0000-4000-8000-00000000000b');
insert into public.profiles(id, role, is_active) values
  ('00000000-0000-4000-8000-00000000000a', 'OWNER', true),
  ('00000000-0000-4000-8000-00000000000b', 'STAFF', true);
insert into public.branches(id, name) values ('00000000-0000-4000-8000-0000000000b1', 'Cabang Fiktif');
insert into public.customers(id, name) values ('00000000-0000-4000-8000-0000000000c1', 'Pemilik Fiktif');
insert into public.visits(id, branch_id, customer_id) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000b1',
   '00000000-0000-4000-8000-0000000000c1');
insert into public.inpatient_records(id, visit_id, branch_id, admitted_at) values
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000b1', now());
insert into public.cashier_shifts(id, branch_id, opened_by, shift_type, status, opened_at) values
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000b1',
   '00000000-0000-4000-8000-00000000000a', 'klinik', 'open', now());
insert into public.coa_accounts(code, is_active, is_header) values
  ('1101', true, false), ('1102', true, false), ('1201', true, false), ('2103', true, false);
"""
OWNER = "00000000-0000-4000-8000-00000000000a"
STAF = "00000000-0000-4000-8000-00000000000b"
RECORD = "00000000-0000-4000-8000-0000000000e2"
VISIT = "00000000-0000-4000-8000-0000000000e1"


def sebagai(pg, perintah: str, user: str = OWNER) -> str:
    """Jalankan sebagai pengguna aplikasi, bukan superuser."""
    return pg.sql(
        f"select set_config('request.jwt.claim.sub', '{user}', false);"
        "select set_config('request.jwt.claim.role', 'authenticated', false);"
        f"set role authenticated; {perintah}")


def ditolak(pg, perintah: str, kode: str, user: str = OWNER) -> None:
    try:
        sebagai(pg, perintah, user)
    except RuntimeError as error:
        assert kode in str(error), f"Diharapkan {kode}, dapat: {error}"
        return
    raise AssertionError(f"Seharusnya ditolak dengan {kode}: {perintah}")


def alur_uang(pg) -> None:
    pg.sql(DATA)
    catat = ("select public.clinic_record_inpatient_deposit('{r}', '{k}', current_date, {n}, '{m}', null)")

    # 1. Menerima titipan: nomor dokumen, saldo, dan jurnalnya.
    id1 = sebagai(pg, catat.format(r=RECORD, k="key-1", n=500000, m="Tunai")).splitlines()[-1]
    baris = pg.sql(
        "select no_deposit || '|' || jumlah || '|' || terpakai || '|' || metode || '|' || kas_code "
        f"|| '|' || coalesce(shift_id::text, '-') from public.inpatient_deposits where id = '{id1}'")
    assert baris.startswith("DEP-"), baris
    assert "|500000.00|0.00|Tunai|1101|00000000-0000-4000-8000-0000000000e3" in baris, baris
    jurnal = pg.sql("select lines::text from public.journal_entries where source = 'klinik-deposit'")
    assert '{"code": "1101", "debit": 500000.00, "credit": 0}' in jurnal, jurnal
    assert '{"code": "2103", "debit": 0, "credit": 500000.00}' in jurnal, jurnal
    print("PASS: titipan masuk bernomor, terikat shift, dijurnal sebagai utang ke pemilik", flush=True)

    # 2. Kunci yang sama tidak pernah membuat deposit kedua.
    ulang = sebagai(pg, catat.format(r=RECORD, k="key-1", n=500000, m="Tunai")).splitlines()[-1]
    assert ulang == id1, (ulang, id1)
    assert pg.sql("select count(*) from public.inpatient_deposits") == "1"
    ditolak(pg, catat.format(r=RECORD, k="key-1", n=900000, m="Tunai"), "IDEMPOTENCY_CONFLICT")
    print("PASS: klik ganda dan kunci yang dipakai ulang tidak menggandakan uang", flush=True)

    # 3. Penjaga isian dan keadaan.
    ditolak(pg, catat.format(r=RECORD, k="key-x", n=0, m="Tunai"), "DEPOSIT_INVALID")
    ditolak(pg, catat.format(r=RECORD, k="key-x", n=1000, m="Barter"), "DEPOSIT_INVALID")
    ditolak(pg, catat.format(r=RECORD, k="key-x", n=1000, m="Tunai"), "SHIFT_INVALID", user=STAF)
    print("PASS: nominal, metode, dan shift kasir dijaga database", flush=True)

    # 4. Deposit kedua: nomor berurutan dan saldo bertambah.
    id2 = sebagai(pg, catat.format(r=RECORD, k="key-2", n=300000, m="Transfer")).splitlines()[-1]
    assert pg.sql(f"select kas_code from public.inpatient_deposits where id='{id2}'") == "1102"
    nomor = pg.sql("select string_agg(right(no_deposit, 4), ',' order by no_deposit) from public.inpatient_deposits")
    assert nomor == "0001,0002", nomor
    print("PASS: nomor deposit berurutan dan metode non-tunai masuk rekening bank", flush=True)

    # 5. Batal hanya untuk peran keuangan, dan hanya selama titipan belum terpakai.
    ditolak(pg, f"select public.clinic_cancel_inpatient_deposit('{id2}', 'void-2', 'coba')",
            "ACCESS_DENIED", user=STAF)
    ditolak(pg, f"select public.clinic_cancel_inpatient_deposit('{id2}', 'void-2', '')", "DEPOSIT_INVALID")
    sebagai(pg, f"select public.clinic_cancel_inpatient_deposit('{id2}', 'void-2', 'Salah metode')")
    batal = pg.sql("select status || '|' || coalesce(void_reason, '-') from public.inpatient_deposits "
                   f"where id='{id2}'")
    assert batal == "batal|Salah metode", batal
    assert pg.sql("select count(*) from public.journal_entries where source='klinik-deposit-batal'") == "1"
    # Mengulang kunci pembatalan tidak menjurnal dua kali.
    sebagai(pg, f"select public.clinic_cancel_inpatient_deposit('{id2}', 'void-2', 'Salah metode')")
    assert pg.sql("select count(*) from public.journal_entries where source='klinik-deposit-batal'") == "1"
    print("PASS: batal wajib beralasan, hanya peran keuangan, dan tidak menjurnal dua kali", flush=True)

    # 6. Tagihan pulang: pembungkus menurunkan sendiri status bayar dari uang di meja,
    #    dan kembalian tidak pernah ikut dihitung sebagai pembayaran.
    faktur = {"tanggal": "2026-10-29", "total": 700000, "subtotal": 700000, "discount": 0, "tax": 0,
              "cash_received": 999999}
    posting = ("select public.clinic_post_invoice_with_deposit('%s', 'inv-1', '%s'::jsonb, '[]'::jsonb)"
               % (VISIT, __import__("json").dumps(faktur)))
    inv = sebagai(pg, posting).splitlines()[-1]
    hasil = pg.sql(f"select paid_status || '|' || dp_amount from public.invoices where id = '{inv}'")
    assert hasil == "Lunas|200000.00", hasil
    bayar = pg.sql("select metode || '|' || amount || '|' || kas_code from public.invoice_payments "
                   f"where invoice_id = '{inv}'")
    assert bayar == "Deposit|500000.00|2103", bayar
    assert pg.sql("select count(*) from public.journal_entries where source='klinik-ar'") == "1"
    pakai = pg.sql("select string_agg(terpakai::text, ',' order by created_at) from public.inpatient_deposits")
    assert pakai == "500000.00,0.00", pakai
    print("PASS: uang di meja 200rb + deposit 500rb melunasi tagihan 700rb tanpa kas kedua", flush=True)

    # 7. Mengulang posting mengembalikan tagihan yang sama, bukan memotong deposit lagi.
    assert sebagai(pg, posting).splitlines()[-1] == inv
    assert pg.sql("select count(*) from public.invoice_payments") == "1"
    assert pg.sql("select count(*) from public.invoices") == "1"
    print("PASS: posting yang diulang tidak memotong deposit dua kali", flush=True)

    # 8. Titipan yang sudah menempel di tagihan tidak bisa dibatalkan dari layar rawat inap.
    ditolak(pg, f"select public.clinic_cancel_inpatient_deposit('{id1}', 'void-1', 'coba')", "DEPOSIT_USED")
    print("PASS: titipan yang sudah terpakai hanya bisa dibalik lewat tagihannya", flush=True)

    # 9. Void tagihan mengembalikan titipan ke saldo pemilik.
    pg.sql(f"select clinic_private.release_inpatient_deposit('{inv}', "
           "'00000000-0000-4000-8000-0000000000b1', 'INV-UJI', 'Terbit ulang')")
    assert pg.sql(f"select terpakai from public.inpatient_deposits where id='{id1}'") == "0.00"
    assert pg.sql("select count(*) from public.inpatient_deposit_applications where released_at is not null") == "1"
    lepas = pg.sql("select lines::text from public.journal_entries where source='klinik-deposit-lepas'")
    assert '{"code": "1201", "debit": 500000.00, "credit": 0}' in lepas, lepas
    assert '{"code": "2103", "debit": 0, "credit": 500000.00}' in lepas, lepas
    print("PASS: void tagihan mengembalikan deposit ke saldo dan membalik jurnalnya", flush=True)

    # 10. Pengembalian sisa titipan hanya sekali.
    sebagai(pg, f"select public.clinic_refund_inpatient_deposit('{id1}', 'ref-1', 'Pemilik minta kembali')")
    kembali = pg.sql("select dikembalikan || '|' || coalesce(refund_reason, '-') from public.inpatient_deposits "
                     f"where id='{id1}'")
    assert kembali == "500000.00|Pemilik minta kembali", kembali
    ditolak(pg, f"select public.clinic_refund_inpatient_deposit('{id1}', 'ref-2', 'lagi')", "DEPOSIT_EMPTY")
    print("PASS: sisa titipan dikembalikan sekali, sisanya nol tidak bisa dikembalikan lagi", flush=True)

    # 11. Pasien yang sudah pulang tidak menerima titipan baru.
    pg.sql(f"update public.inpatient_records set discharged_at = now() where id = '{RECORD}'")
    ditolak(pg, catat.format(r=RECORD, k="key-9", n=100000, m="Tunai"), "DEPOSIT_CLOSED")
    print("PASS: setelah pasien pulang, uang masuk bukan lagi deposit", flush=True)


def main() -> int:
    migrasi = MIGRASI.read_text()
    with NativePostgres(BIN) as pg:
        pg.sql(RANGKA)
        pg.sql(badan_void())
        pg.sql(migrasi)
        print("PASS: seluruh migrasi deposit rawat inap dijalankan tanpa error", flush=True)

        definisi = pg.sql(
            "select pg_get_functiondef("
            "'public.clinic_void_reissue_invoice_core(uuid,text,text)'::regprocedure)")
        for potongan, label in [
            ("v_deposit numeric(15,2) := 0", "variabel deposit"),
            ("where p.invoice_id=p_invoice_id and p.metode='Deposit'", "penjumlahan deposit"),
            ("v_paid := v_paid - v_deposit", "deposit dikeluarkan dari uang yang dialihkan"),
            ("clinic_private.release_inpatient_deposit(", "pelepasan deposit"),
            ("p.metode is distinct from 'Deposit'", "baris deposit tidak ikut dialihkan"),
            ("and v_paid=0 and v_deposit=0", "void tetap boleh untuk tagihan berdeposit"),
        ]:
            assert potongan in definisi, f"Tambalan hilang: {label}"
        print("PASS: clinic_void_reissue_invoice_core tertambal lengkap", flush=True)

        # Jangkar harus unik; kalau tidak, tambalan berikutnya bisa mengenai tempat salah.
        asli = badan_void()
        for jangkar in ["  v_lines jsonb;\nbegin",
                        "  update public.invoices set voided_at=now() where id=p_invoice_id;",
                        "    from public.invoice_payments p where p.invoice_id=p_invoice_id;"]:
            assert asli.count(jangkar) == 1, f"Jangkar tidak unik: {jangkar!r}"
        print("PASS: setiap jangkar tambalan muncul tepat sekali di definisi aslinya", flush=True)

        jumlah = pg.sql("select count(*) from pg_policies where tablename like 'inpatient_deposit%'")
        assert jumlah == "2", jumlah
        tulis = pg.sql(
            "select coalesce(string_agg(privilege_type, ','), 'none') from information_schema.table_privileges "
            "where grantee='authenticated' and table_name='inpatient_deposits'")
        assert tulis == "SELECT", f"hak tulis langsung masih terbuka: {tulis}"
        print("PASS: tabel deposit hanya bisa dibaca; semua tulisan lewat RPC", flush=True)

        assert re.search(r"create trigger|drop trigger", migrasi) is None, "migrasi menyentuh trigger"
        print("PASS: penjaga INPATIENT_OPEN tidak disentuh", flush=True)

        alur_uang(pg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
