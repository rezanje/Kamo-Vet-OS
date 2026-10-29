#!/usr/bin/env python3
"""Kompilasi + perilaku migrasi "item susulan masuk rekam medis" di PostgreSQL sungguhan.

Tanpa skema produksi di CI, yang paling mematikan saat deploy adalah apakah seluruh
migrasi 20261101000000 benar-benar DAPAT DIJALANKAN dan apakah RPC barunya berlaku
seperti yang ditinjau. Tabel/fungsi lain dibuat sebagai rangka seadanya; RPC posting
tagihan diganti rangka yang MEREKAM muatan barisnya supaya penautan bisa diperiksa.
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

BIN = os.environ.get("KAMO_PG_BIN", "/opt/data/kamo-pg-harness/bin")
MIGRASI = ROOT / "supabase/migrations/20261101000000_item_susulan_rekam_medis.sql"
KOREKSI = ROOT / "supabase/migrations/20261024074043_unpaid_clinical_correction.sql"

RANGKA = """
create extension if not exists pgcrypto;
create schema auth;
create schema clinic_private;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create role authenticated;
create role anon;
create role service_role;
grant usage on schema public to authenticated, anon, service_role;

create table public.branches(id uuid primary key, name text);
create table public.profiles(id uuid primary key, role text, full_name text, is_active boolean);
create table public.role_modules(role text, module_id text);
create table public.employees(id uuid primary key, nama text, profile_id uuid, status text,
  created_at timestamptz not null default now());
create table public.visits(id uuid primary key, branch_id uuid, pet_id uuid, status text,
  service_started_at timestamptz, service_finished_at timestamptz, checked_out_at timestamptz);
create table public.medical_records(id uuid primary key default gen_random_uuid(), visit_id uuid not null,
  submission_key text, clinical_revision integer not null default 0,
  created_at timestamptz not null default now());
create table public.items(id uuid primary key, name text, unit text, item_type text,
  is_active boolean default true, tindakan_kategori text);
create table public.item_units(item_id uuid, unit text, factor numeric(15,4));
create table public.compounding_recipes(id uuid primary key default gen_random_uuid(),
  medical_record_id uuid, recipe_name text, status text);
create table public.invoices(id uuid primary key default gen_random_uuid(), visit_id uuid,
  invoice_no text, voided_at timestamptz, request_key text);
create table public.prescription_items(
  id uuid primary key default gen_random_uuid(),
  medical_record_id uuid not null references public.medical_records(id) on delete cascade,
  nama_obat varchar(120) not null,
  qty int not null default 1,
  aturan_pakai text,
  created_at timestamptz not null default now(),
  jenis varchar(8) not null default 'obat',
  harga numeric(15,2) not null default 0,
  satuan varchar(20) not null default 'pcs',
  faktor numeric(15,4) not null default 1,
  item_id uuid,
  kategori varchar(20),
  compound_recipe_id uuid,
  service_performers jsonb,
  salesperson_id uuid,
  salesperson_name text,
  bmhp_components jsonb);
alter table public.prescription_items enable row level security;
create policy pi_all on public.prescription_items for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.prescription_items to authenticated;
grant select on public.medical_records, public.visits, public.items to authenticated;

create function public.user_can_access_branch(b uuid) returns boolean language sql stable as $$
  select b = '00000000-0000-4000-8000-0000000000b1'::uuid $$;

-- Rangka RPC posting/koreksi: menyimpan muatan baris yang diterimanya apa adanya.
create table public.posting_calls(id bigserial primary key, fn text, lines jsonb, extra jsonb);
create function public.clinic_post_invoice(p_visit_id uuid, p_request_key text, p_invoice jsonb,
  p_lines jsonb) returns uuid language plpgsql security definer as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.posting_calls(fn, lines, extra) values ('post', p_lines, p_invoice);
  insert into public.invoices(id, visit_id, invoice_no, request_key)
  values (v_id, p_visit_id, 'INV-0001', p_request_key);
  return v_id;
end $$;
create function public.clinic_post_split_invoice(p_visit_id uuid, p_request_key text, p_invoice jsonb,
  p_lines jsonb, p_payments jsonb) returns uuid language plpgsql security definer as $$
begin
  insert into public.posting_calls(fn, lines, extra) values ('split', p_lines, p_payments);
  return public.clinic_post_invoice(p_visit_id, p_request_key, p_invoice, p_lines);
end $$;
create function public.clinic_post_demo_invoice(p_visit_id uuid, p_request_key text, p_invoice jsonb,
  p_lines jsonb, p_policy_id uuid, p_payments jsonb, p_employee_ids uuid[]) returns uuid
language plpgsql security definer as $$
begin
  insert into public.posting_calls(fn, lines, extra) values ('demo', p_lines, to_jsonb(p_employee_ids));
  return public.clinic_post_invoice(p_visit_id, p_request_key, p_invoice, p_lines);
end $$;
create function public.clinic_edit_invoice(p_invoice_id uuid, p_request_key text, p_invoice jsonb,
  p_lines jsonb) returns uuid language plpgsql security definer as $$
begin
  insert into public.posting_calls(fn, lines, extra) values ('edit', p_lines, p_invoice);
  return p_invoice_id;
end $$;

-- Rangka peracikan: membuat baris resep racikan seperti fungsi aslinya.
create function public.clinic_issue_compound(p_medical_record_id uuid, p_visit_id uuid,
  p_recipe jsonb, p_request_key text) returns uuid language plpgsql security definer as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.compounding_recipes(id, medical_record_id, recipe_name, status)
  values (v_id, p_medical_record_id, coalesce(p_recipe->>'recipe_name', 'Racikan'), 'pending');
  insert into public.prescription_items(medical_record_id, nama_obat, qty, satuan, jenis, compound_recipe_id)
  values (p_medical_record_id, coalesce(p_recipe->>'recipe_name', 'Racikan'), 1, 'racikan', 'obat', v_id);
  return v_id;
end $$;
create function public.clinic_issue_official_compound(p_medical_record_id uuid, p_visit_id uuid,
  p_formula_version_id uuid, p_request_key text, p_dosage_instruction text default null) returns uuid
language sql security definer as $$
  select public.clinic_issue_compound(p_medical_record_id, p_visit_id,
    jsonb_build_object('recipe_name', 'Racikan resmi'), p_request_key) $$;
create function public.clinic_issue_master_compound(p_medical_record_id uuid, p_visit_id uuid,
  p_sale_item_id uuid, p_recipe jsonb, p_request_key text, p_formula_version_id uuid default null,
  p_dosage_instruction text default null) returns uuid language sql security definer as $$
  select public.clinic_issue_compound(p_medical_record_id, p_visit_id, p_recipe, p_request_key) $$;
"""

CABANG = "00000000-0000-4000-8000-0000000000b1"
CABANG_LAIN = "00000000-0000-4000-8000-0000000000b2"
DOKTER = "00000000-0000-4000-8000-00000000000a"
KASIR = "00000000-0000-4000-8000-00000000000b"
LUAR = "00000000-0000-4000-8000-00000000000c"
VISIT = "00000000-0000-4000-8000-0000000000e1"
VISIT_TANPA_RM = "00000000-0000-4000-8000-0000000000e9"
RECORD = "00000000-0000-4000-8000-0000000000f1"
OBAT = "00000000-0000-4000-8000-00000000a001"
JASA = "00000000-0000-4000-8000-00000000a002"

DATA = f"""
insert into public.branches(id, name) values ('{CABANG}', 'Cabang Fiktif'), ('{CABANG_LAIN}', 'Cabang Lain');
insert into public.profiles(id, role, full_name, is_active) values
  ('{DOKTER}', 'DOCTOR', 'Profil Dokter', true),
  ('{KASIR}', 'STAFF', 'Profil Kasir', true),
  ('{LUAR}', 'STAFF', 'Profil Nonaktif', false);
insert into public.employees(id, nama, profile_id, status) values
  ('00000000-0000-4000-8000-0000000000d1', 'Drh. Andri', '{DOKTER}', 'Aktif'),
  ('00000000-0000-4000-8000-0000000000d2', 'Kasir Wulan', '{KASIR}', 'Aktif');
insert into public.visits(id, branch_id, status, service_started_at, service_finished_at) values
  ('{VISIT}', '{CABANG}', 'Pembayaran', now(), now()),
  ('{VISIT_TANPA_RM}', '{CABANG}', 'Pembayaran', now(), now());
insert into public.medical_records(id, visit_id, submission_key) values ('{RECORD}', '{VISIT}', 'exam-1');
insert into public.items(id, name, unit, item_type, is_active, tindakan_kategori) values
  ('{OBAT}', 'Amoxicillin', 'tablet', 'Persediaan', true, null),
  ('{JASA}', 'Vaksinasi Rabies', 'jasa', 'Jasa', true, 'Vaksinasi');
insert into public.item_units(item_id, unit, factor) values ('{OBAT}', 'tablet', 1), ('{OBAT}', 'strip', 10);
"""


def sebagai(pg, perintah: str, user: str = DOKTER, role: str = "authenticated") -> str:
    return pg.sql(
        f"select set_config('request.jwt.claim.sub', '{user}', false);"
        f"select set_config('request.jwt.claim.role', '{role}', false);"
        f"set role authenticated; {perintah}")


def ditolak(pg, perintah: str, kode: str, user: str = DOKTER, role: str = "authenticated") -> None:
    try:
        sebagai(pg, perintah, user, role)
    except RuntimeError as error:
        assert kode in str(error), f"Diharapkan {kode}, dapat: {error}"
        return
    raise AssertionError(f"Seharusnya ditolak dengan {kode}: {perintah}")


def fungsi_koreksi() -> str:
    """clinic_record_correction_actor + clinic_can_correct_record, verbatim dari migrasinya."""
    teks = KOREKSI.read_text()
    potong = []
    for nama in ("clinic_record_correction_actor", "clinic_can_correct_record"):
        mulai = teks.index(f"create function public.{nama}(")
        akhir = teks.index("$$;", mulai) + len("$$;")
        potong.append(teks[mulai:akhir])
    return "\n".join(potong)


def jalan(pg) -> None:
    pg.sql(RANGKA)
    pg.sql(fungsi_koreksi())
    pg.sql(DATA)
    pg.sql("begin;\n" + MIGRASI.read_text() + "\ncommit;")
    print("PASS: migrasi 20261101000000 terpasang utuh di PostgreSQL sungguhan", flush=True)

    rpc = ("select public.clinic_add_record_items('{v}', '{k}', '{items}'::jsonb, '{c}'::jsonb)")
    items = json.dumps([
        {"nama_obat": "Amoxicillin", "item_id": OBAT, "qty": 6, "satuan": "tablet", "faktor": 1,
         "harga": 5000, "aturan_pakai": "3x1", "jenis": "obat", "kategori": None},
        {"nama_obat": "Vaksinasi Rabies", "item_id": JASA, "qty": 1, "satuan": "jasa", "faktor": 1,
         "harga": 150000, "aturan_pakai": None, "jenis": "jasa", "kategori": "Vaksinasi"},
    ])
    compounds = json.dumps([{"recipe": {"recipe_name": "Puyer batuk"}, "request_key": "racik-1"}])

    # 1. Dokter menambah item susulan: baris resep bertambah dan bertanda susulan.
    hasil = sebagai(pg, rpc.format(v=VISIT, k="susulan-1", items=items, c=compounds)).splitlines()[-1]
    assert hasil == RECORD, hasil
    assert pg.sql("select count(*) from public.prescription_items") == "3"
    tanda = pg.sql("select string_agg(nama_obat || '|' || susulan_source || '|' || susulan_by_name"
                   " || '|' || (susulan_at is not null)::text, ';' order by nama_obat)"
                   " from public.prescription_items")
    assert tanda == ("Amoxicillin|dokter|Drh. Andri|true;Puyer batuk|dokter|Drh. Andri|true;"
                     "Vaksinasi Rabies|dokter|Drh. Andri|true"), tanda
    assert pg.sql(f"select kategori from public.prescription_items where item_id = '{JASA}'") == "Vaksinasi"
    assert pg.sql("select count(*) from public.compounding_recipes") == "1"
    print("PASS: obat, jasa, dan racikan susulan tercatat di rekam medis beserta pelaku & waktunya", flush=True)

    # 2. Kiriman ulang tidak menggandakan baris; kunci yang sama untuk isi lain ditolak.
    ulang = sebagai(pg, rpc.format(v=VISIT, k="susulan-1", items=items, c=compounds)).splitlines()[-1]
    assert ulang == RECORD and pg.sql("select count(*) from public.prescription_items") == "3"
    ditolak(pg, rpc.format(v=VISIT, k="susulan-1", items="[]", c=compounds), "IDEMPOTENCY_CONFLICT")
    # Kunci milik pengguna lain tidak boleh dipakai ulang diam-diam.
    ditolak(pg, rpc.format(v=VISIT, k="susulan-1", items=items, c=compounds),
            "IDEMPOTENCY_CONFLICT", user=KASIR)
    print("PASS: klik ganda tidak menggandakan item; kunci yang dipakai ulang ditolak", flush=True)

    # 3. Penjaga isian, peran, cabang, dan keadaan kunjungan.
    ditolak(pg, rpc.format(v=VISIT, k="", items=items, c="[]"), "RECORD_INVALID")
    ditolak(pg, rpc.format(v=VISIT, k="kosong", items="[]", c="[]"), "RECORD_INVALID")
    ditolak(pg, rpc.format(v=VISIT, k="anon-1", items=items, c="[]"), "ACCESS_DENIED", role="anon")
    ditolak(pg, rpc.format(v=VISIT, k="mati-1", items=items, c="[]"), "ACCESS_DENIED", user=LUAR)
    ditolak(pg, rpc.format(v=VISIT_TANPA_RM, k="norm-1", items=items, c="[]"), "RECORD_INVALID")
    pg.sql(f"update public.visits set branch_id = '{CABANG_LAIN}' where id = '{VISIT}';")
    ditolak(pg, rpc.format(v=VISIT, k="cabang-1", items=items, c="[]"), "ACCESS_DENIED")
    pg.sql(f"update public.visits set branch_id = '{CABANG}' where id = '{VISIT}';")
    print("PASS: tanpa autentikasi, profil nonaktif, rekam medis, atau kunci yang sah item ditolak", flush=True)

    # 4. Begitu tagihan terbit, jalur susulan dokter tertutup (pakai syarat koreksi yang sama).
    pg.sql(f"insert into public.invoices(visit_id, invoice_no) values ('{VISIT}', 'INV-LAMA');")
    ditolak(pg, rpc.format(v=VISIT, k="susulan-2", items=items, c="[]"), "RECORD_LOCKED")
    pg.sql("delete from public.invoices;")
    print("PASS: setelah tagihan terbit, item susulan harus lewat koreksi tagihan", flush=True)

    # 5. Penanda susulan tidak dapat dikarang atau diubah lewat tulisan langsung.
    # Dicoba dengan DUA cara: nilai langsung di kolom, dan dengan memasang sendiri
    # setelan transaksi yang dipakai RPC. Keduanya harus berakhir tanpa penanda.
    sebagai(pg, "insert into public.prescription_items(medical_record_id, nama_obat, susulan_at,"
                f" susulan_source, susulan_by_name) values ('{RECORD}', 'Palsu', now(), 'dokter', 'Bukan saya');")
    sebagai(pg, "begin; select set_config('kamo.clinic_record_susulan',"
                " '{\"by\":null,\"by_name\":\"Bukan saya\",\"source\":\"dokter\"}', true);"
                f" insert into public.prescription_items(medical_record_id, nama_obat)"
                f" values ('{RECORD}', 'Palsu'); commit;")
    palsu = pg.sql("select string_agg(coalesce(susulan_source, '-') || '|' || coalesce(susulan_by_name, '-'), ';')"
                   " from public.prescription_items where nama_obat = 'Palsu'")
    assert palsu == "-|-;-|-", palsu
    ditolak(pg, "update public.prescription_items set susulan_source = 'kasir'"
                " where nama_obat = 'Amoxicillin';", "SUSULAN_LOCKED")
    pg.sql("delete from public.prescription_items where nama_obat = 'Palsu';")
    print("PASS: penanda susulan hanya dari RPC-nya, dan tidak dapat ditulis ulang", flush=True)

    # 6. Baris tambahan kasir di layar Pembayaran dicatat lalu ditautkan ke baris invoice.
    resep_id = pg.sql(f"select id from public.prescription_items where item_id = '{OBAT}'")
    lines = json.dumps([
        {"description": "Amoxicillin", "qty": 6, "price": 5000, "kind": "obat", "item_id": OBAT,
         "unit": "tablet", "prescription_item_id": resep_id},
        {"description": "Infus NaCl", "qty": 1, "price": 90000, "kind": "obat", "item_id": None,
         "unit": None, "prescription_item_id": None},
        {"description": "Vaksinasi Rabies", "qty": 1, "price": 150000, "kind": "jasa", "item_id": JASA,
         "unit": None, "prescription_item_id": None},
    ])
    faktur = json.dumps({"tanggal": "2026-11-01", "total": 270000})
    posting = ("select public.clinic_post_invoice_with_record('{v}', '{k}', '{inv}'::jsonb, '{l}'::jsonb)")
    sebagai(pg, posting.format(v=VISIT, k="bayar-1", inv=faktur, l=lines), user=KASIR)
    kasir = pg.sql("select string_agg(nama_obat || '|' || jenis || '|' || satuan || '|' || faktor"
                   " || '|' || coalesce(kategori, '-') || '|' || susulan_source || '|' || susulan_by_name,"
                   " ';' order by nama_obat) from public.prescription_items where susulan_source = 'kasir'")
    assert kasir == ("Infus NaCl|obat|pcs|1.0000|-|kasir|Kasir Wulan;"
                     "Vaksinasi Rabies|jasa|jasa|1.0000|-|kasir|Kasir Wulan"), kasir
    diteruskan = json.loads(pg.sql("select lines::text from public.posting_calls where fn = 'post'"))
    assert diteruskan[0]["prescription_item_id"] == resep_id, diteruskan[0]
    assert all(baris["prescription_item_id"] for baris in diteruskan), diteruskan
    assert [baris["unit"] for baris in diteruskan] == ["tablet", "pcs", "jasa"], diteruskan
    tertaut = pg.sql("select count(distinct prescription_item_id) from ("
                     " select x.value->>'prescription_item_id' as prescription_item_id"
                     " from public.posting_calls c, jsonb_array_elements(c.lines) x where c.fn='post') t")
    assert tertaut == "3", tertaut
    print("PASS: baris tambahan kasir jadi baris rekam medis dan baris tagihannya ditautkan", flush=True)

    # 7. Kiriman ulang pembayaran memakai baris resep yang sama (hash invoice tetap cocok).
    sebelum = pg.sql("select count(*) from public.prescription_items")
    sebagai(pg, posting.format(v=VISIT, k="bayar-1", inv=faktur, l=lines), user=KASIR)
    assert pg.sql("select count(*) from public.prescription_items") == sebelum
    kedua = json.loads(pg.sql("select lines::text from public.posting_calls where fn='post' order by id desc limit 1"))
    assert [b["prescription_item_id"] for b in kedua] == [b["prescription_item_id"] for b in diteruskan], kedua
    ditolak(pg, posting.format(v=VISIT, k="bayar-1", inv=faktur,
                               l=json.dumps([{"description": "Lain", "qty": 1, "price": 1, "kind": "jasa"}])),
            "IDEMPOTENCY_CONFLICT", user=KASIR)
    print("PASS: kiriman ulang pembayaran memakai baris resep yang sama, bukan baris baru", flush=True)

    # 8. Kunjungan tanpa rekam medis tetap ditagih seperti sebelumnya.
    pg.sql("delete from public.posting_calls;")
    sebagai(pg, posting.format(v=VISIT_TANPA_RM, k="bayar-2", inv=faktur,
                               l=json.dumps([{"description": "Jasa lain", "qty": 1, "price": 1000, "kind": "jasa"}])),
            user=KASIR)
    lewat = json.loads(pg.sql("select lines::text from public.posting_calls where fn='post'"))
    assert "prescription_item_id" not in lewat[0], lewat
    print("PASS: kunjungan tanpa rekam medis tetap bisa ditagih tanpa perubahan", flush=True)

    # 9. Koreksi tagihan: baris warisan dibiarkan, baris baru kasir ikut tercatat.
    pg.sql("delete from public.posting_calls;")
    faktur_id = pg.sql(f"select id from public.invoices where visit_id = '{VISIT}' limit 1")
    koreksi = json.dumps([
        {"description": "Amoxicillin", "qty": 6, "price": 5000, "kind": "obat", "item_id": OBAT,
         "unit": "tablet", "source_invoice_item_id": "00000000-0000-4000-8000-00000000c001"},
        {"description": "Nebulizer", "qty": 1, "price": 75000, "kind": "jasa", "item_id": None, "unit": None},
    ])
    sebagai(pg, "select public.clinic_edit_invoice_with_record('%s', 'koreksi-1', '%s'::jsonb, '%s'::jsonb)"
            % (faktur_id, faktur, koreksi), user=KASIR)
    baris = json.loads(pg.sql("select lines::text from public.posting_calls where fn='edit'"))
    assert "prescription_item_id" not in baris[0], baris[0]
    assert baris[1]["prescription_item_id"] and baris[1]["unit"] == "jasa", baris[1]
    assert pg.sql("select susulan_source from public.prescription_items where nama_obat='Nebulizer'") == "kasir"
    print("PASS: koreksi tagihan mencatat baris baru kasir tanpa menyentuh baris warisan", flush=True)

    # 10. Satuan berjenjang: faktor baris resep kasir mengikuti master, bukan form.
    pg.sql("delete from public.posting_calls; delete from public.clinic_record_item_additions;")
    sebagai(pg, posting.format(v=VISIT, k="bayar-3", inv=faktur, l=json.dumps(
        [{"description": "Amoxicillin", "qty": 2, "price": 45000, "kind": "obat", "item_id": OBAT,
          "unit": "strip"}])), user=KASIR)
    assert pg.sql("select faktor from public.prescription_items where satuan = 'strip'") == "10.0000"
    ditolak(pg, posting.format(v=VISIT, k="bayar-4", inv=faktur, l=json.dumps(
        [{"description": "Amoxicillin", "qty": 2, "price": 45000, "kind": "obat", "item_id": OBAT,
          "unit": "karton"}])), "UNIT_INVALID", user=KASIR)
    print("PASS: faktor satuan baris susulan dibaca ulang dari master, satuan asing ditolak", flush=True)

    # 11. Tabel kunci permintaan tertutup untuk pengguna aplikasi.
    for perintah in ("select 1 from public.clinic_record_item_additions",
                     "insert into public.clinic_record_item_additions(request_key, visit_id,"
                     f" medical_record_id, source, request_hash, prescription_item_ids)"
                     f" values ('x', '{VISIT}', '{RECORD}', 'dokter', 'h', '{{}}')"):
        ditolak(pg, perintah + ";", "permission denied", user=KASIR)
    print("PASS: buku kunci permintaan tidak dapat dibaca atau ditulis langsung", flush=True)


if __name__ == "__main__":
    with NativePostgres(BIN) as pg:
        jalan(pg)
    print("SEMUA LULUS: migrasi item susulan rekam medis terpasang dan berperilaku sesuai tinjauan.")
