#!/usr/bin/env python3
"""Regenerate the apply.sql / rollback.sql files of both owner-apply packages from the repository migrations.

apply.sql = migration text verbatim (sha256 in header) + supabase_migrations history row, one transaction.
Run from anywhere: python3 docs/evidence/2026-10-28-k03-j01-s04/build-owner-apply.py
"""
from pathlib import Path
import hashlib

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
MIG = ROOT / 'supabase/migrations'

GUARD = """begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
do $$ begin
  if current_user <> 'postgres' then
    raise exception 'apply must run as postgres (current role: %); nothing was applied', current_user;
  end if;
end $$;
"""


def migration(name):
    text = (MIG / name).read_text()
    return text, hashlib.sha256(text.encode()).hexdigest()


def history(version, name):
    return (f"insert into supabase_migrations.schema_migrations(version, name) values ('{version}', '{name}') "
            "on conflict (version) do nothing;\n")


# K03 + J01
k03, k03_sha = migration('20261029120000_k03_racikan_recipe_required.sql')
j01, j01_sha = migration('20261029121000_j01_finance_wholesale_correction.sql')
(HERE / 'owner-apply-k03-j01/apply.sql').write_text(
    "-- K03 + J01 APPLY — WRITES. Satu transaksi; galat apa pun (termasuk tunggu kunci > 5 dtk, tubuh wholesale_access\n"
    "-- berbeda dari versi yang ditinjau, atau bukan role postgres) membatalkan semuanya.\n"
    f"-- 20261029120000_k03_racikan_recipe_required.sql sha256 {k03_sha}\n"
    f"-- 20261029121000_j01_finance_wholesale_correction.sql sha256 {j01_sha}\n"
    + GUARD + "\n-- ===== K03 (verbatim) =====\n" + k03
    + "\n-- ===== J01 (verbatim) =====\n" + j01 + "\n"
    + history('20261029120000', 'k03_racikan_recipe_required')
    + history('20261029121000', 'j01_finance_wholesale_correction') + "commit;\n")

source = (MIG / '20261021073000_wholesale_invoice_corrections.sql').read_text()
start = source.index('create function public.wholesale_access')
end = source.index('$$;', start) + 3
original = source[start:end].replace('create function', 'create or replace function', 1)
(HERE / 'owner-apply-k03-j01/rollback.sql').write_text(
    "-- K03 + J01 ROLLBACK — WRITES. Hanya bila diputuskan mundur; revert commit aplikasi sesudahnya.\n"
    "-- K03: lepas kedua trigger dan fungsinya (data tidak diubah). J01: kembalikan wholesale_access ke versi\n"
    "-- 20261021073000 apa adanya (koreksi grosir kembali OWNER saja). Koreksi yang sudah dibuat FINANCE tetap tercatat.\n"
    "begin;\nset local lock_timeout = '5s';\nset local statement_timeout = '60s';\n"
    "drop trigger if exists zz_racikan_recipe_required on public.prescription_items;\n"
    "drop trigger if exists zz_racikan_recipe_required on public.invoice_items;\n"
    "drop function if exists clinic_private.k03_prescription_recipe_required();\n"
    "drop function if exists clinic_private.k03_invoice_recipe_required();\n"
    "drop function if exists clinic_private.is_racikan_sku(uuid);\n"
    + original + "\n"
    "revoke all on function public.wholesale_access(uuid,boolean) from public,anon,authenticated,service_role;\n"
    "delete from supabase_migrations.schema_migrations where version in ('20261029120000','20261029121000');\n"
    "commit;\n")

# S04
s04, s04_sha = migration('20261026002000_service_commission_policy.sql')
(HERE / 'owner-apply-s04/apply.sql').write_text(
    "-- S04 APPLY — WRITES. Satu transaksi: migrasi 20261026002000_service_commission_policy.sql apa adanya\n"
    f"-- (sha256 {s04_sha}) + baris riwayat, lalu SATU pernyataan terpisah: kebijakan keputusan pemilik 28 Okt 2026\n"
    "-- (dua pelaksana jasa = masing-masing memakai aturan komisinya sendiri, mulai 2026-11-01, semua cabang).\n"
    "-- Galat apa pun membatalkan semuanya.\n"
    + GUARD + "\n-- ===== Migrasi S04 (verbatim) =====\n" + s04 + "\n"
    + history('20261026002000', 'service_commission_policy') +
    """
-- ===== Kebijakan keputusan pemilik (pernyataan terpisah) =====
-- branch_id NULL = semua cabang; mode personal_rules = aturan khusus masing-masing karyawan, dasar penuh keduanya.
-- created_by wajib terisi (default auth.uid() kosong di SQL editor): dicatat atas nama satu-satunya OWNER aktif
-- (preflight memastikan tepat satu). Tabel append-only; tidak menimpa baris lain.
do $$
declare v_owner uuid;
begin
  select id into strict v_owner from public.profiles where role='OWNER' and is_active;
  insert into public.service_commission_policies(branch_id, effective_from, mode, doctor_share_pct, staff_share_pct, created_by)
  select null, date '2026-11-01', 'personal_rules', null, null, v_owner
  where not exists (select 1 from public.service_commission_policies
    where branch_id is null and effective_from = date '2026-11-01' and mode = 'personal_rules');
end $$;
commit;
""")
print('built', k03_sha, j01_sha, s04_sha)
