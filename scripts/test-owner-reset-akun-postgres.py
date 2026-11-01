#!/usr/bin/env python3
"""U13: uji fungsi reset login Super Admin pada PostgreSQL sekali-pakai dengan skema auth tiruan.

Jalankan: python3 scripts/test-owner-reset-akun-postgres.py [/usr/lib/postgresql/16/bin]
Data fiktif saja; tidak menyentuh database apa pun selain klaster sementara.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from native_postgres import NativePostgres  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MIGRATION = (ROOT / "supabase/migrations/20261106010000_owner_reset_akun_login.sql").read_text()

STUB = """
create role anon; create role authenticated; create role service_role;
create schema extensions; create extension pgcrypto schema extensions;
create schema auth;
create table auth.users(id uuid primary key, email varchar, encrypted_password varchar, email_confirmed_at timestamptz,
 recovery_token varchar, email_change varchar, email_change_token_new varchar, email_change_token_current varchar,
 email_change_confirm_status smallint, raw_user_meta_data jsonb, updated_at timestamptz, is_sso_user boolean not null default false);
create unique index users_email_partial_key on auth.users(email) where is_sso_user=false;
create table auth.identities(id uuid primary key default gen_random_uuid(), provider_id text, user_id uuid references auth.users,
 identity_data jsonb not null, provider text not null, updated_at timestamptz,
 email text generated always as (lower(identity_data->>'email')) stored);
create table auth.sessions(id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users);
create table auth.refresh_tokens(id bigserial primary key, user_id varchar, session_id uuid references auth.sessions on delete cascade);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
create type public.user_role as enum('OWNER','ADMIN','FINANCE','DOCTOR','STAFF');
create table public.profiles(id uuid primary key, full_name text, role public.user_role not null, is_active boolean not null default true);
grant usage on schema public, auth to authenticated;
grant select on public.profiles to authenticated;

insert into auth.users(id,email,encrypted_password,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','owner@x.id',extensions.crypt('lama-owner',extensions.gen_salt('bf')),'{}'),
 ('00000000-0000-0000-0000-00000000000b','admin@x.id',extensions.crypt('lama-admin',extensions.gen_salt('bf')),'{}'),
 ('00000000-0000-0000-0000-00000000000c','staf@x.id',extensions.crypt('lama-staf',extensions.gen_salt('bf')),'{"email":"staf@x.id","sub":"c"}'),
 ('00000000-0000-0000-0000-00000000000d','nonaktif@x.id',extensions.crypt('x',extensions.gen_salt('bf')),'{}');
insert into auth.identities(provider_id,user_id,identity_data,provider) values
 ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000c','{"email":"staf@x.id","sub":"c"}','email');
insert into public.profiles values
 ('00000000-0000-0000-0000-00000000000a','Owner','OWNER',true),
 ('00000000-0000-0000-0000-00000000000b','Admin','ADMIN',true),
 ('00000000-0000-0000-0000-00000000000c','Staf','STAFF',true),
 ('00000000-0000-0000-0000-00000000000d','Owner Nonaktif','OWNER',false);
insert into auth.sessions(id,user_id) values ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-00000000000c');
insert into auth.refresh_tokens(user_id,session_id) values ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000f1');
"""

OWNER, ADMIN, STAF, OFF = (f"00000000-0000-0000-0000-00000000000{c}" for c in "abcd")


def as_user(uid, body):
    return f"begin; set local role authenticated; set local test.uid='{uid}'; {body}; commit;"


def expect_error(pg, uid, call, code):
    try:
        pg.sql(as_user(uid, f"select {call}"))
    except RuntimeError as err:
        assert code in str(err), f"{call}: harap {code}, dapat {err}"
        return
    raise AssertionError(f"{call}: harusnya ditolak ({code})")


def main():
    bin_dir = sys.argv[1] if len(sys.argv) > 1 else "/usr/lib/postgresql/16/bin"
    with NativePostgres(bin_dir) as pg:
        pg.sql(STUB)
        pg.sql(MIGRATION)
        reset = lambda e, p: f"public.owner_reset_akun_login('{STAF}',{e},{p})"  # noqa: E731

        # Hanya Super Admin aktif.
        expect_error(pg, ADMIN, reset("'baru@x.id'", "null"), "LOGIN_RESET_DENIED")
        expect_error(pg, STAF, reset("null", "'passwordbaru'"), "LOGIN_RESET_DENIED")
        expect_error(pg, OFF, reset("null", "'passwordbaru'"), "LOGIN_RESET_DENIED")
        expect_error(pg, ADMIN, f"public.get_user_login_email('{STAF}')", "LOGIN_RESET_DENIED")
        # Tabel riwayat & fungsi internal tidak bisa diubah langsung.
        expect_error(pg, OWNER, f"1; insert into public.user_login_resets(profile_id,actor_id,email_changed,password_changed) values('{STAF}','{OWNER}',true,true)", "permission denied")

        # Validasi.
        expect_error(pg, OWNER, reset("'bukan-email'", "null"), "LOGIN_RESET_EMAIL_INVALID")
        expect_error(pg, OWNER, reset("'ADMIN@x.id'", "null"), "LOGIN_RESET_EMAIL_TAKEN")
        expect_error(pg, OWNER, reset("null", "'pendek'"), "LOGIN_RESET_PASSWORD_INVALID")
        expect_error(pg, OWNER, reset("'staf@x.id'", "''"), "LOGIN_RESET_NOTHING")
        expect_error(pg, OWNER, "public.owner_reset_akun_login('00000000-0000-0000-0000-0000000000ee',null,'passwordbaru')", "LOGIN_RESET_NOT_FOUND")
        assert pg.last("select count(*) from public.user_login_resets") == "0"
        assert pg.last(as_user(OWNER, f"select public.get_user_login_email('{STAF}')")) == "staf@x.id"

        # Ganti email + password sekaligus.
        out = pg.last(as_user(OWNER, f"select {reset(chr(39) + ' Staf.Baru@X.id ' + chr(39), chr(39) + 'rahasia-baru-1' + chr(39))}"))
        assert '"email_changed": true' in out and '"password_changed": true' in out, out
        assert pg.last(f"select email from auth.users where id='{STAF}'") == "staf.baru@x.id"
        assert pg.last(f"select encrypted_password=extensions.crypt('rahasia-baru-1',encrypted_password) from auth.users where id='{STAF}'") == "t"
        assert pg.last(f"select encrypted_password like '$2a$10$%' from auth.users where id='{STAF}'") == "t"
        assert pg.last(f"select email||'|'||(identity_data->>'email_verified') from auth.identities where user_id='{STAF}'") == "staf.baru@x.id|true"
        assert pg.last(f"select raw_user_meta_data->>'email' from auth.users where id='{STAF}'") == "staf.baru@x.id"
        assert pg.last(f"select (select count(*) from auth.sessions where user_id='{STAF}')+(select count(*) from auth.refresh_tokens)") == "0"
        # Akun lain tidak tersentuh.
        assert pg.last(f"select encrypted_password=extensions.crypt('lama-admin',encrypted_password) from auth.users where id='{ADMIN}'") == "t"

        # Hanya password; email sama (beda huruf besar) tidak dihitung perubahan.
        out = pg.last(as_user(OWNER, f"select {reset(chr(39) + 'STAF.BARU@x.id' + chr(39), chr(39) + 'rahasia-baru-2' + chr(39))}"))
        assert '"email_changed": false' in out and '"password_changed": true' in out, out

        # Riwayat tanpa kredensial, terbaca hanya oleh OWNER.
        assert pg.last("select string_agg(email_changed::text||'/'||password_changed::text,',' order by created_at,id) from public.user_login_resets") in ("true/true,false/true", "false/true,true/true")
        assert pg.last(as_user(OWNER, "select count(*) from public.user_login_resets")) == "2"
        assert pg.last(as_user(ADMIN, "select count(*) from public.user_login_resets")) == "0"
        cols = pg.last("select string_agg(column_name,',' order by ordinal_position) from information_schema.columns where table_name='user_login_resets'")
        assert cols == "id,profile_id,actor_id,created_at,email_changed,password_changed", cols
    print("OK: reset login Super Admin — 20 pemeriksaan lulus")


if __name__ == "__main__":
    main()
