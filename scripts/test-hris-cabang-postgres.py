#!/usr/bin/env python3
"""Uji migrasi HRIS "cabang utama & akhiri penugasan" di PostgreSQL sungguhan.

Satu klaster sekali pakai, tiga babak:

  A. SKEMA PENUH — SELURUH migrasi repo (kecuali migrasi ini) diputar ulang dari
     nol, jadi definisi fungsi yang ditambal benar-benar direkonstruksi dari
     main + cabang ini, bukan dari Production. Yang dibuktikan: tiap jangkar
     tambalan cocok TEPAT SEKALI pada definisi berjalan, dan sebelum migrasi
     ini tidak satu pun pembaca penugasan menyaring tanggal berakhir.

  B. IDEMPOTEN — migrasi dijalankan dua kali. Yang kedua tidak boleh gagal dan
     tidak boleh menambal ulang fungsi yang sudah tertambal.

  C. PERILAKU — peran database sungguhan (OWNER/ADMIN/STAFF/DOCTOR lewat role
     `authenticated` + klaim JWT) benar-benar memanggil RPC dan menulis tabel.
     Yang dibuktikan: STAFF/DOCTOR ditolak, kolom tanggal berakhir tidak bisa
     ditulis langsung dari PostgREST, penugasan yang berakhir berhenti dipakai
     pembaca, penugasan ulang membuka kembali barisnya, dan setiap perubahan
     meninggalkan jejak beserta pelakunya.

Tidak menyentuh Production sama sekali: klaster lokal, socket unix, dibuang di akhir.

    python3 scripts/test-hris-cabang-postgres.py
"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

BIN = os.environ.get("KAMO_PG_BIN", "/opt/data/kamo-pg-harness/bin")
MIGRATIONS = ROOT / "supabase/migrations"
MIGRASI = MIGRATIONS / "20261104060000_hris_cabang_penugasan.sql"

# Jangkar persis seperti yang dipakai migrasi (bagian 7).
JANGKAR = [
    ("public.clinic_demo_care_staff(uuid)",
     "a.effective_date<=(now() at time zone 'Asia/Jakarta')::date"),
    ("public.clinic_save_initial_record(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid,uuid,text,text,text)",
     "a.effective_date <= (now() at time zone 'Asia/Jakarta')::date"),
    ("public.set_visit_service_state(uuid,text,uuid)",
     "a.effective_date <= (now() at time zone 'Asia/Jakarta')::date"),
    ("public.clinic_staff_name(uuid,uuid,text)",
     "effective_date <= (now() at time zone 'Asia/Jakarta')::date for share;"),
    ("public.normalize_service_performers(jsonb,uuid)",
     "effective_date <= (now() at time zone 'Asia/Jakarta')::date for share;"),
    ("public.guard_clinic_line_salesperson()",
     "effective_date <= (now() at time zone 'Asia/Jakarta')::date for share;"),
    ("public.guard_clinic_record_seller()",
     "effective_date <= (now() at time zone 'Asia/Jakarta')::date for share;"),
    ("public.change_master_data_lifecycle(text,uuid,text,bigint,text)",
     "exists(select 1 from public.employee_branch_assignments where employee_id=p_id "
     "and not public.user_can_access_branch(branch_id))"),
    ("public.assign_employee_secondary_branches(uuid,uuid[],date)",
     "  insert into public.employee_branch_assignments(employee_id,branch_id,role,effective_date)"),
]
PEMBACA = [sig for sig, _ in JANGKAR if sig != "public.assign_employee_secondary_branches(uuid,uuid[],date)"]

# --- Rangka Supabase: yang disediakan platform, bukan oleh migrasi repo. -----
PLATFORM = """
create extension if not exists pgcrypto;
create extension if not exists btree_gist;
create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists graphql_public;
create schema if not exists storage;
create table if not exists auth.users(id uuid primary key default gen_random_uuid(), email text,
  raw_user_meta_data jsonb, raw_app_meta_data jsonb, encrypted_password text,
  email_confirmed_at timestamptz, confirmed_at timestamptz, invited_at timestamptz,
  last_sign_in_at timestamptz, phone text, is_sso_user boolean default false,
  deleted_at timestamptz, banned_until timestamptz, aud text default 'authenticated',
  role text default 'authenticated', instance_id uuid,
  created_at timestamptz default now(), updated_at timestamptz default now());
""" + (ROOT / "supabase/tests/fixtures/hosted_auth_uid.sql").read_text() + """
create or replace function auth.role() returns text language sql stable as
  $f$ select nullif(current_setting('request.jwt.claim.role', true), '') $f$;
create or replace function auth.email() returns text language sql stable as
  $f$ select nullif(current_setting('request.jwt.claim.email', true), '') $f$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $f$;
create table if not exists storage.buckets(id text primary key, name text, public boolean default false,
  owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects(id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid, created_at timestamptz default now(),
  updated_at timestamptz default now(), last_accessed_at timestamptz default now(),
  metadata jsonb, path_tokens text[]);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as
  $f$ select string_to_array(name, '/') $f$;
do $p$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $p$;
"""
PERAN = "\n".join(
    f"do $r$ begin if not exists (select 1 from pg_roles where rolname='{r}') then create role {r} nologin; end if; end $r$;"
    for r in ("anon", "authenticated", "service_role", "supabase_auth_admin", "authenticator",
              "supabase_admin", "dashboard_user", "supabase_storage_admin",
              "supabase_realtime_admin", "supabase_functions_admin", "supabase_read_only_user")
) + """
grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
"""

# Chart of accounts: di Production baris ini sudah ada sebelum 0068 dibuat
# (lihat komentar di 0068_kas_bank.sql), jadi di klaster kosong harus diisi dulu.
COA = """insert into coa_accounts (code, name, type, normal_balance) values
  ('1101','Kas','ASET','D'),('1102','Bank BCA','ASET','D'),('1105','PPN Masukan','ASET','D'),
  ('1201','Piutang Usaha','ASET','D'),('1301','Persediaan Obat & Produk','ASET','D'),
  ('1401','Perlengkapan Klinik','ASET','D'),('2101','Hutang Usaha','LIABILITAS','K'),
  ('2201','PPN Keluaran','LIABILITAS','K'),('2301','Hutang Gaji','LIABILITAS','K'),
  ('3101','Modal Pemilik','EKUITAS','K'),('3201','Laba Ditahan','EKUITAS','K'),
  ('5501','Beban Administrasi Bank','BEBAN','D'),('4301','Pendapatan Bunga Bank','PENDAPATAN','K')
on conflict (code) do nothing;"""
SEBELUM = {"0068_kas_bank.sql": COA}

OWNER = "11111111-1111-1111-1111-111111111111"
ADMIN_A = "22222222-2222-2222-2222-222222222222"
STAFF = "33333333-3333-3333-3333-333333333333"
DOCTOR = "44444444-4444-4444-4444-444444444444"
CABANG_A = "aaaaaaaa-0000-0000-0000-00000000000a"
CABANG_B = "bbbbbbbb-0000-0000-0000-00000000000b"
DRH = "dddddddd-0000-0000-0000-00000000000d"   # dokter, cabang utama A
PRM = "eeeeeeee-0000-0000-0000-00000000000e"   # paramedis, cabang utama A

DATA = f"""
insert into auth.users(id) values ('{OWNER}'),('{ADMIN_A}'),('{STAFF}'),('{DOCTOR}');
insert into public.profiles(id, role, is_active, full_name) values
  ('{OWNER}','OWNER',true,'Pemilik Uji'),
  ('{ADMIN_A}','ADMIN',true,'Admin Cabang A'),
  ('{STAFF}','STAFF',true,'Staf Uji'),
  ('{DOCTOR}','DOCTOR',true,'Dokter Uji')
on conflict (id) do update set role = excluded.role, is_active = excluded.is_active, full_name = excluded.full_name;
-- Bawaan ADMIN adalah "semua cabang"; di sini sengaja dibatasi per cabang supaya
-- penjagaan jangkauan RPC benar-benar teruji, bukan sekadar lolos karena bawaan.
insert into public.role_capabilities(role, all_branches, create_accounts)
  values ('ADMIN', false, true)
on conflict (role) do update set all_branches = false;
insert into public.branches(id, code, name, type, is_active) values
  ('{CABANG_A}','UJI-A','Cabang Uji A','KLINIK',true),
  ('{CABANG_B}','UJI-B','Cabang Uji B','KLINIK',true);
insert into public.user_branches(user_id, branch_id) values
  ('{OWNER}','{CABANG_A}'),('{OWNER}','{CABANG_B}'),
  ('{ADMIN_A}','{CABANG_A}'),
  ('{STAFF}','{CABANG_A}'),('{DOCTOR}','{CABANG_A}');
insert into public.employees(id, nama, jabatan, status, branch_id) values
  ('{DRH}','Drh. Uji Satu','Dokter Hewan','Aktif','{CABANG_A}'),
  ('{PRM}','Paramedis Uji','Paramedis','Aktif','{CABANG_A}');
insert into public.employee_branch_assignments(employee_id, branch_id, role, effective_date) values
  ('{DRH}','{CABANG_A}','PRIMARY', current_date - 60),
  ('{DRH}','{CABANG_B}','SECONDARY', current_date - 30),
  ('{PRM}','{CABANG_A}','PRIMARY', current_date - 60);
"""


def sebagai(pg, perintah, user=OWNER):
    """Jalankan sebagai pengguna login sungguhan: role `authenticated` + klaim JWT."""
    return pg.sql(
        "begin;\n"
        "set local role authenticated;\n"
        f"select set_config('request.jwt.claim.sub', '{user}', true);\n"
        "select set_config('request.jwt.claim.role', 'authenticated', true);\n"
        f"{perintah}\n"
        "commit;"
    )


def ditolak(pg, perintah, potongan, user=OWNER, label=""):
    try:
        sebagai(pg, perintah, user)
    except RuntimeError as error:
        assert potongan in str(error), f"{label}: diharapkan {potongan!r}, dapat: {str(error)[:400]}"
        return
    raise AssertionError(f"{label}: seharusnya ditolak ({potongan})")


def gagal(pg, perintah, potongan, label=""):
    """Penolakan dari fungsi internal yang memang tidak boleh dipanggil `authenticated`."""
    try:
        pg.sql(perintah)
    except RuntimeError as error:
        assert potongan in str(error), f"{label}: diharapkan {potongan!r}, dapat: {str(error)[:400]}"
        return
    raise AssertionError(f"{label}: seharusnya ditolak ({potongan})")


def putar_ulang(pg):
    pg.sql(PLATFORM)
    pg.sql(PERAN)
    lain = [f for f in sorted(MIGRATIONS.glob("*.sql")) if f.name != MIGRASI.name]
    for berkas in lain:
        if berkas.name in SEBELUM:
            pg.sql(SEBELUM[berkas.name])
        try:
            pg.sql("begin;\n" + berkas.read_text() + "\ncommit;")
        except RuntimeError as error:
            raise AssertionError(f"Migrasi {berkas.name} gagal di klaster bersih:\n{str(error)[:2000]}") from None
    print(f"PASS: {len(lain)} migrasi repo (tanpa migrasi ini) berjalan dari nol", flush=True)


def definisi(pg, sig):
    return pg.sql(f"select pg_get_functiondef('{sig}'::regprocedure);")


def babak_jangkar(pg):
    for sig in PEMBACA:
        teks = definisi(pg, sig)
        assert "employee_assignment_current" not in teks, f"{sig} sudah tertambal sebelum migrasi dijalankan"
    for sig, jangkar in JANGKAR:
        jumlah = definisi(pg, sig).count(jangkar)
        assert jumlah == 1, f"Jangkar {jangkar[:60]!r} muncul {jumlah}x di {sig} (harus tepat 1)"
    print(f"PASS: {len(JANGKAR)} jangkar cocok tepat sekali pada definisi hasil skema penuh lokal", flush=True)

    pg.sql(MIGRASI.read_text())
    print("PASS: migrasi HRIS cabang berjalan di atas skema penuh", flush=True)

    for sig in PEMBACA:
        assert "employee_assignment_current" in definisi(pg, sig), f"{sig} masih mengabaikan tanggal berakhir"
    assign = definisi(pg, "public.assign_employee_secondary_branches(uuid,uuid[],date)")
    assert "reopen_employee_branch_assignments" in assign, "penugasan ulang belum membuka kembali baris berakhir"
    print("PASS: kedelapan pembaca + penugasan ulang tertambal", flush=True)


def babak_idempoten(pg):
    sebelum = {sig: definisi(pg, sig).count("employee_assignment_current") for sig in PEMBACA}
    pg.sql(MIGRASI.read_text())
    for sig, jumlah in sebelum.items():
        ulang = definisi(pg, sig).count("employee_assignment_current")
        assert ulang == jumlah, f"{sig} tertambal dua kali ({jumlah} → {ulang})"
    print("PASS: migrasi boleh dijalankan ulang tanpa menambal dua kali", flush=True)


def babak_perilaku(pg):
    pg.sql(DATA)

    # --- 1. Hak akses: hanya OWNER/ADMIN aktif yang boleh menulis -------------
    for peran, user in (("STAFF", STAFF), ("DOCTOR", DOCTOR)):
        ditolak(pg, f"select public.set_employee_primary_branches(array['{DRH}']::uuid[], '{CABANG_B}', null);",
                "ACCESS_DENIED", user, f"{peran} pindah cabang utama")
        ditolak(pg, f"select public.end_employee_branch_assignment('{DRH}', '{CABANG_B}', current_date, 'coba-coba');",
                "ACCESS_DENIED", user, f"{peran} akhiri penugasan")
        ditolak(pg, f"select public.reopen_employee_branch_assignments('{DRH}', array['{CABANG_B}']::uuid[], current_date);",
                "ACCESS_DENIED", user, f"{peran} buka kembali penugasan")
    print("PASS: STAFF dan DOCTOR ditolak di ketiga RPC penugasan", flush=True)

    # --- 2. Kolom tanggal berakhir tidak bisa ditulis langsung ----------------
    ditolak(pg, f"update public.employee_branch_assignments set end_date = current_date, ended_at = now(),"
                f" ended_by = '{OWNER}', ended_reason = 'lewat PostgREST'"
                f" where employee_id = '{DRH}' and branch_id = '{CABANG_B}';",
            "permission denied", OWNER, "OWNER menulis end_date langsung")
    ditolak(pg, f"insert into public.employee_branch_assignments"
                f"(employee_id, branch_id, role, effective_date, end_date, ended_by, ended_reason)"
                f" values ('{PRM}', '{CABANG_B}', 'SECONDARY', current_date, current_date, '{OWNER}', 'langsung');",
            "permission denied", OWNER, "OWNER menyisipkan end_date langsung")
    # Kolom yang memang dipakai aplikasi tetap boleh ditulis.
    sebagai(pg, f"insert into public.employee_branch_assignments(employee_id, branch_id, role, effective_date)"
                f" values ('{PRM}', '{CABANG_B}', 'SECONDARY', current_date - 10);")
    print("PASS: end_date hanya lewat RPC; insert penugasan biasa tetap jalan", flush=True)

    # --- 3. Jejak tidak bisa dikarang dari browser ----------------------------
    ditolak(pg, f"insert into public.employee_branch_change_log(employee_id, action, actor_id)"
                f" values ('{DRH}', 'assignment_ended', '{OWNER}');",
            "permission denied", OWNER, "OWNER menulis jejak langsung")

    # --- 4. Validasi RPC akhiri penugasan ------------------------------------
    ditolak(pg, f"select public.end_employee_branch_assignment('{DRH}', '{CABANG_A}', current_date, 'pindah tugas');",
            "cabang utama diubah lewat Edit Karyawan", OWNER, "akhiri cabang utama")
    ditolak(pg, f"select public.end_employee_branch_assignment('{DRH}', '{CABANG_B}', current_date, 'ok');",
            "alasan wajib diisi", OWNER, "alasan terlalu pendek")
    ditolak(pg, f"select public.end_employee_branch_assignment('{DRH}', '{CABANG_B}', current_date - 90, 'mundur jauh');",
            "tidak boleh sebelum tanggal mulai", OWNER, "berakhir sebelum mulai")
    ditolak(pg, f"select public.end_employee_branch_assignment('{DRH}', '{CABANG_B}', current_date + 1000, 'terlalu jauh');",
            "terlalu jauh ke depan", OWNER, "tanggal terlalu jauh")
    # ADMIN cabang A tidak boleh mengakhiri penugasan di cabang B.
    ditolak(pg, f"select public.end_employee_branch_assignment('{DRH}', '{CABANG_B}', current_date, 'di luar wewenang');",
            "ACCESS_DENIED", ADMIN_A, "ADMIN cabang lain")
    print("PASS: validasi tanggal, alasan, cabang utama, dan jangkauan ADMIN", flush=True)

    # --- 5. Tanggal depan diterima, pembaca belum membuangnya ----------------
    sebagai(pg, f"select public.end_employee_branch_assignment('{DRH}', '{CABANG_B}', current_date + 7, 'kontrak selesai pekan depan');")
    masih = pg.sql(f"select public.employee_assignment_current(effective_date, end_date)"
                   f" from public.employee_branch_assignments where employee_id='{DRH}' and branch_id='{CABANG_B}';")
    assert masih == "t", f"penugasan bertanggal depan harus masih berlaku, dapat {masih!r}"
    ditolak(pg, f"select public.end_employee_branch_assignment('{DRH}', '{CABANG_B}', current_date, 'dobel');",
            "sudah diakhiri", OWNER, "akhiri dua kali")

    # Majukan tanggalnya ke masa lalu lewat jalur pemilik fungsi (meniru lewatnya
    # waktu), lalu buktikan pembaca benar-benar membuangnya.
    pg.sql(f"update public.employee_branch_assignments set end_date = current_date - 1"
           f" where employee_id='{DRH}' and branch_id='{CABANG_B}';")
    lewat = pg.sql(f"select public.employee_assignment_current(effective_date, end_date)"
                   f" from public.employee_branch_assignments where employee_id='{DRH}' and branch_id='{CABANG_B}';")
    assert lewat == "f", f"penugasan yang sudah lewat harus berhenti berlaku, dapat {lewat!r}"

    # Pembaca sungguhan: normalize_service_performers menolak pelaksana yang
    # penugasannya sudah berakhir di cabang itu.
    # Fungsi ini sengaja tertutup untuk `authenticated` (dipanggil trigger), jadi
    # dijalankan sebagai pemilik fungsi — yang diuji perilakunya, bukan hak aksesnya.
    gagal(pg, f"select public.normalize_service_performers("
              f"jsonb_build_object('doctor_id','{DRH}','staff_id',null), '{CABANG_B}');",
          "tidak ditugaskan di cabang transaksi", "pelaksana dengan penugasan berakhir")
    # Di cabang utamanya ia tetap boleh dipilih.
    hasil = pg.sql(f"select (public.normalize_service_performers("
                   f"jsonb_build_object('doctor_id','{DRH}','staff_id',null), '{CABANG_A}')->>'doctor_id');")
    assert DRH in hasil, f"dokter harus tetap bisa dipilih di cabang utamanya: {hasil!r}"
    print("PASS: tanggal depan masih berlaku; setelah lewat, pembaca membuangnya", flush=True)

    # --- 6. Jejak pengakhiran tercatat ---------------------------------------
    jejak = pg.sql(f"select action || '|' || coalesce(reason,'') || '|' || actor_id"
                   f" from public.employee_branch_change_log where employee_id='{DRH}' order by created_at;")
    assert jejak.count("assignment_ended") == 1, f"jejak pengakhiran tidak tepat satu: {jejak!r}"
    assert "kontrak selesai pekan depan" in jejak and OWNER in jejak, f"pelaku/alasan tidak tercatat: {jejak!r}"

    # --- 7. Menugaskan ulang membuka kembali barisnya -------------------------
    sebagai(pg, f"select public.assign_employee_secondary_branches('{DRH}', array['{CABANG_B}']::uuid[], current_date);")
    baris = pg.sql(f"select coalesce(end_date::text,'-') || '|' || coalesce(ended_reason,'-') || '|' || effective_date::text"
                   f" from public.employee_branch_assignments where employee_id='{DRH}' and branch_id='{CABANG_B}';")
    assert baris.startswith("-|-|"), f"baris harus dibuka kembali tanpa sisa jejak pengakhiran: {baris!r}"
    dibuka = pg.sql(f"select count(*) from public.employee_branch_change_log"
                    f" where employee_id='{DRH}' and action='assignment_reopened';")
    assert dibuka == "1", f"pembukaan kembali harus tercatat sekali, dapat {dibuka}"
    hasil = pg.sql(f"select (public.normalize_service_performers("
                   f"jsonb_build_object('doctor_id','{DRH}','staff_id',null), '{CABANG_B}')->>'doctor_id');")
    assert DRH in hasil, "setelah ditugaskan ulang, dokter harus bisa dipilih lagi"
    print("PASS: penugasan ulang membuka kembali baris yang berakhir dan tercatat", flush=True)

    # --- 8. Pindah cabang utama ----------------------------------------------
    ditolak(pg, f"select public.set_employee_primary_branches(array['{PRM}']::uuid[], '{CABANG_B}', null);",
            "ACCESS_DENIED", ADMIN_A, "ADMIN memindahkan ke cabang di luar wewenang")
    pindah = sebagai(pg, f"select public.set_employee_primary_branches(array['{PRM}']::uuid[], '{CABANG_B}', 'pendataan ulang HR');")
    assert pindah.strip().endswith("1"), f"satu karyawan seharusnya berpindah: {pindah!r}"
    utama = pg.sql(f"select branch_id::text from public.employees where id='{PRM}';")
    assert utama == CABANG_B, f"cabang utama belum berpindah: {utama!r}"
    lama = pg.sql(f"select role::text || '|' || coalesce(end_date::text,'-') || '|' || coalesce(ended_reason,'-')"
                  f" from public.employee_branch_assignments where employee_id='{PRM}' and branch_id='{CABANG_A}';")
    assert lama.startswith("SECONDARY|"), f"cabang lama harus turun jadi tambahan yang berakhir: {lama!r}"
    assert "-|-" not in lama, f"cabang lama harus punya tanggal berakhir dan alasan: {lama!r}"
    baru = pg.sql(f"select role::text || '|' || coalesce(end_date::text,'-')"
                  f" from public.employee_branch_assignments where employee_id='{PRM}' and branch_id='{CABANG_B}';")
    assert baru == "PRIMARY|-", f"cabang baru harus jadi PRIMARY yang berjalan: {baru!r}"
    satu_primary = pg.sql(f"select count(*) from public.employee_branch_assignments"
                          f" where employee_id='{PRM}' and role='PRIMARY';")
    assert satu_primary == "1", f"hanya boleh ada satu cabang utama, dapat {satu_primary}"
    log = pg.sql(f"select action from public.employee_branch_change_log where employee_id='{PRM}';")
    assert log == "primary_branch", f"perpindahan cabang utama harus tercatat sekali: {log!r}"
    # Memindahkan ke cabang yang sama tidak membuat jejak palsu.
    ulang = sebagai(pg, f"select public.set_employee_primary_branches(array['{PRM}']::uuid[], '{CABANG_B}', 'ulang');")
    assert ulang.strip().endswith("0"), f"pindah ke cabang yang sama harus 0 perubahan: {ulang!r}"
    print("PASS: cabang utama berpindah, cabang lama diakhiri, jejaknya tepat satu", flush=True)

    # --- 9. Jejak hanya terbaca OWNER/ADMIN ----------------------------------
    terbaca = sebagai(pg, "select count(*) from public.employee_branch_change_log;", STAFF)
    assert terbaca.strip().endswith("0"), f"STAFF tidak boleh membaca jejak, dapat {terbaca!r}"
    print("PASS: jejak perubahan cabang tertutup untuk STAFF", flush=True)


def babak_matriks(pg):
    """Exercise original RPCs under real roles/branch scope; roll back every case."""
    admin_b = '22222222-2222-2222-2222-222222222223'
    employee_a = 'dddddddd-0000-0000-0000-00000000000a'
    employee_b = 'dddddddd-0000-0000-0000-00000000000b'
    pg.sql(f"""
insert into auth.users(id) values ('{admin_b}');
update public.profiles set role='ADMIN',is_active=true,full_name='Admin Cabang B Uji' where id='{admin_b}';
insert into public.user_branches(user_id,branch_id) values ('{admin_b}','{CABANG_B}');
insert into public.employees(id,nama,jabatan,status,branch_id) values
 ('{employee_a}','Dokter Matriks A','Dokter','Aktif','{CABANG_A}'),
 ('{employee_b}','Dokter Matriks B','Dokter','Aktif','{CABANG_B}');
insert into public.employee_branch_assignments(employee_id,branch_id,role,effective_date) values
 ('{employee_a}','{CABANG_A}','PRIMARY',current_date-30),
 ('{employee_a}','{CABANG_B}','SECONDARY',current_date-30),
 ('{employee_b}','{CABANG_B}','PRIMARY',current_date-30),
 ('{employee_b}','{CABANG_A}','SECONDARY',current_date-30);
""")
    count = 0
    for role, user, allowed in [('OWNER', OWNER, {CABANG_A, CABANG_B}),
                                ('ADMIN_A', ADMIN_A, {CABANG_A}),
                                ('ADMIN_B', admin_b, {CABANG_B}),
                                ('STAFF', STAFF, set()), ('DOCTOR', DOCTOR, set())]:
        for branch, employee in [(CABANG_A, employee_b), (CABANG_B, employee_a)]:
            for operation in ['primary', 'end', 'reopen']:
                preparation = ''
                if operation == 'primary':
                    call = f"select public.set_employee_primary_branches(array['{employee}']::uuid[],'{branch}','Matriks cabang');"
                    check = f"(select branch_id='{branch}' from public.employees where id='{employee}')"
                    action = 'primary_branch'
                elif operation == 'end':
                    call = f"select public.end_employee_branch_assignment('{employee}','{branch}',current_date,'Matriks cabang');"
                    check = f"(select end_date=current_date and ended_by='{user}' from public.employee_branch_assignments where employee_id='{employee}' and branch_id='{branch}')"
                    action = 'assignment_ended'
                else:
                    preparation = f"update public.employee_branch_assignments set end_date=current_date-1,ended_at=now(),ended_by='{OWNER}',ended_reason='Fixture periode selesai' where employee_id='{employee}' and branch_id='{branch}';"
                    call = f"select public.reopen_employee_branch_assignments('{employee}',array['{branch}']::uuid[],current_date);"
                    check = f"(select end_date is null and ended_by is null from public.employee_branch_assignments where employee_id='{employee}' and branch_id='{branch}')"
                    action = 'assignment_reopened'
                # Claims role metadata is untrusted; persisted profile remains decisive.
                claims = ('{"sub":"'+user+'","role":"OWNER","app_metadata":{"role":"ADMIN"}}')
                sql = (f"begin; {preparation}\nset local role authenticated;\n"
                       f"select set_config('request.jwt.claim.sub','{user}',true);\n"
                       "select set_config('request.jwt.claim.role','authenticated',true);\n"
                       f"select set_config('request.jwt.claims','{claims}',true);\n" + call +
                       f"select {check} and exists(select from public.employee_branch_change_log where employee_id='{employee}' and action='{action}' and actor_id='{user}'); rollback;")
                try:
                    result = pg.sql(sql)
                except RuntimeError as error:
                    assert branch not in allowed and 'ACCESS_DENIED' in str(error), f'{role}/{branch}/{operation}: {error}'
                else:
                    assert branch in allowed, f'{role}/{branch}/{operation}: forbidden call succeeded'
                    assert result.splitlines()[-1] == 't', f'{role}/{operation}: mutation/audit readback failed: {result}'
                count += 1
    assert pg.sql(f"select count(*) from public.employee_branch_change_log where employee_id in ('{employee_a}','{employee_b}');") == '0', 'matrix rollback leaked audit rows'
    print(f'PASS: {count} native RPC role/branch cases (OWNER, ADMIN A/B, STAFF, DOCTOR), spoofed metadata cannot elevate roles', flush=True)
    return admin_b


def babak_pembaca_publik(pg, admin_b):
    """Reach actual public care picker, not a stubbed business core."""
    customer = 'cccccccc-0000-0000-0000-000000000001'
    pet = 'cccccccc-0000-0000-0000-000000000002'
    visit_a = 'cccccccc-0000-0000-0000-000000000003'
    visit_b = 'cccccccc-0000-0000-0000-000000000004'
    pg.sql(f"""
set session_replication_role=replica;
insert into public.customers(id,name,phone) values ('{customer}','Pemilik Fiktif Matriks HRIS','08000009001');
insert into public.pets(id,customer_id,name) values ('{pet}','{customer}','Hewan Fiktif Matriks HRIS');
insert into public.visits(id,customer_id,pet_id,branch_id,doctor_id) values
 ('{visit_a}','{customer}','{pet}','{CABANG_A}','{DRH}'),
 ('{visit_b}','{customer}','{pet}','{CABANG_B}','{DRH}');
set session_replication_role=origin;
""")
    assert pg.sql("select cardinality(public.clinic_employee_roles('Staff Klinik (Admin - PCA)'));") == '0', 'PCA must remain outside paramedic mapping'
    n = 0
    today = "(now() at time zone 'Asia/Jakarta')::date"
    for state, effective, end, visible in [('current',today+'-30','null',True),
                                           ('last_day',today+'-30',today,True),
                                           ('future_end',today+'-30',today+'+7',True),
                                           ('expired',today+'-30',today+'-1',False),
                                           ('future_start',today+'+1','null',False)]:
        # Owner-only fixture edits represent elapsed time, never replace the reader.
        pg.sql(f"update public.employee_branch_assignments set effective_date={effective},end_date={end},"
               f"ended_at={'null' if end=='null' else 'now()'},ended_by={'null' if end=='null' else chr(39)+OWNER+chr(39)},"
               f"ended_reason={'null' if end=='null' else chr(39)+'Fixture periode'+chr(39)} "
               f"where employee_id='{DRH}' and branch_id='{CABANG_B}';")
        for role,user,allowed in [('OWNER',OWNER,{CABANG_A,CABANG_B}),('ADMIN_A',ADMIN_A,{CABANG_A}),
                                  ('ADMIN_B',admin_b,{CABANG_B}),('STAFF',STAFF,{CABANG_A}),('DOCTOR',DOCTOR,{CABANG_A})]:
            for branch,visit in [(CABANG_A,visit_a),(CABANG_B,visit_b)]:
                query = f"select coalesce(string_agg(id::text,','),'EMPTY') from public.clinic_demo_care_staff('{visit}');"
                if branch not in allowed:
                    ditolak(pg,query,'ACCESS_DENIED',user,f'{role}/{state}/forbidden branch')
                else:
                    result = sebagai(pg,query,user).splitlines()[-1]
                    expected = DRH if branch==CABANG_A or visible else 'EMPTY'
                    assert result==expected, f'{role}/{state}/{branch}: {result!r} != {expected!r}'
                n += 1
    print(f'PASS: {n} public clinical picker role/branch/period cases; primary branch stays available; PCA excluded', flush=True)


def main():
    with NativePostgres(BIN) as pg:
        putar_ulang(pg)
        babak_jangkar(pg)
        babak_idempoten(pg)
        print('CATALOG_ASSIGNMENT_READERS=' + pg.sql("select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'period_filter',position('employee_assignment_current' in p.prosrc)>0) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' and position('employee_branch_assignments' in p.prosrc)>0;"), flush=True)
        babak_perilaku(pg)
        admin_b = babak_matriks(pg)
        babak_pembaca_publik(pg, admin_b)
    print("SEMUA PEMERIKSAAN HRIS CABANG LULUS", flush=True)


if __name__ == "__main__":
    main()
