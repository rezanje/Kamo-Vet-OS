#!/usr/bin/env python3
"""Mutan untuk migrasi 20261215100000_cabang_identitas_dokumen: (nama, [(teks lama, teks baru, jumlah kemunculan)]).
Dipakai test-cabang-identitas-postgres.py --mutations. Setiap mutan harus membuat suite SQL GAGAL lewat pernyataan uji (bukan galat pasang).
Blok pemeriksaan pasang (do $check$) dibuang dari semua varian (termasuk kontrol) supaya suite sendiri yang membuktikan."""

RPC_ROLE = "  if v_role is null or v_role not in ('OWNER', 'ADMIN') then\n    raise exception 'Hanya OWNER/ADMIN aktif yang dapat mengubah identitas cabang' using errcode = '42501';"
TULIS_ROLE = "  if v_role is null or v_role not in ('OWNER', 'ADMIN') then return false; end if;      -- Admin Online"
HAPUS_RET = "  return v_role is not null and v_role in ('OWNER', 'ADMIN');"
TULIS_NAMA = "  if p_name is null or p_name !~* '^cabang-logo/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9._-]{1,120}\\.(png|jpe?g|webp)$' then return false; end if;"
TULIS_CABANG = "  return exists (select 1 from public.branches x where x.id::text = lower(split_part(p_name, '/', 2)));"
POL_TULIS = "create policy cabang_logo_tulis_ketat on storage.objects as restrictive for insert to authenticated\n    with check (bucket_id <> 'dokumen' or name not like 'cabang-logo/%' or public.cabang_logo_boleh_tulis(name))"
POL_HAPUS = "create policy cabang_logo_hapus_ketat on storage.objects as restrictive for delete to authenticated\n    using (bucket_id <> 'dokumen' or name not like 'cabang-logo/%' or public.cabang_logo_boleh_hapus(name))"
POL_UBAH = "create policy cabang_logo_ubah_ketat on storage.objects as restrictive for update to authenticated\n    using (bucket_id <> 'dokumen' or name not like 'cabang-logo/%') with check (bucket_id <> 'dokumen' or name not like 'cabang-logo/%')"
TRG_COND = "  if current_user in ('authenticated', 'anon')\n     and (new.alamat is distinct from old.alamat or new.telepon is distinct from old.telepon or new.logo_path is distinct from old.logo_path) then"
CEK_LOGO = "  and (logo_path is null or logo_path ~* ('^cabang-logo/' || id::text || '/[a-z0-9._-]{1,120}\\.(png|jpe?g|webp)$'))"


def m(old, new): return [(old, new, 1)]


MUTANTS = [
    # ── RPC: peran
    ('rpc-finance-boleh', m(RPC_ROLE, RPC_ROLE.replace("('OWNER', 'ADMIN')", "('OWNER', 'ADMIN', 'FINANCE')"))),
    ('rpc-staf-boleh', m(RPC_ROLE, RPC_ROLE.replace("('OWNER', 'ADMIN')", "('OWNER', 'ADMIN', 'STAFF')"))),
    ('rpc-dokter-boleh', m(RPC_ROLE, RPC_ROLE.replace("('OWNER', 'ADMIN')", "('OWNER', 'ADMIN', 'DOCTOR')"))),
    ('rpc-admin-ditolak', m(RPC_ROLE, RPC_ROLE.replace("('OWNER', 'ADMIN')", "('OWNER')"))),
    ('rpc-tanpa-cek-peran', m(RPC_ROLE, RPC_ROLE.replace("v_role is null or v_role not in ('OWNER', 'ADMIN')", "false"))),
    ('rpc-nonaktif-boleh', m("  v_role text := clinic_private.master_actor_role();\n  b public.branches%rowtype;\n  v_alamat text;", "  v_role text := (select p.role::text from public.profiles p where p.id = auth.uid());\n  b public.branches%rowtype;\n  v_alamat text;")),
    ('pagar-admin-online-dibuang', m("select admin_online_private.guard_all();\nselect admin_online_private.fence_all();\nnotify pgrst, 'reload schema';", "select admin_online_private.fence_all();\nnotify pgrst, 'reload schema';")),
    # ── RPC: validasi + perilaku
    ('rpc-alamat-min-1', m("length(v_alamat) not between 3 and 200", "length(v_alamat) not between 1 and 200")),
    ('rpc-alamat-max-longgar', m("length(v_alamat) not between 3 and 200", "length(v_alamat) not between 3 and 2000")),
    ('rpc-alamat-kontrol-lolos', m(" or v_alamat ~ '[[:cntrl:]]') then", ") then")),
    ('rpc-telepon-huruf-lolos', m(" or v_telepon !~ '^[0-9+()./, -]+$') then", ") then")),
    ('rpc-telepon-max-longgar', m("length(v_telepon) not between 3 and 30", "length(v_telepon) not between 3 and 300")),
    ('rpc-spasi-alamat-tidak-dirapikan', m("v_alamat := nullif(regexp_replace(btrim(coalesce(p_alamat, '')), '\\s+', ' ', 'g'), '');", "v_alamat := nullif(btrim(coalesce(p_alamat, '')), '');")),
    ('rpc-spasi-telepon-tidak-dirapikan', m("v_telepon := nullif(regexp_replace(btrim(coalesce(p_telepon, '')), '\\s+', ' ', 'g'), '');", "v_telepon := nullif(btrim(coalesce(p_telepon, '')), '');")),
    ('rpc-logo-tanpa-cek-jalur', m("    if v_logo !~* ('^cabang-logo/' || b.id::text || '/[a-z0-9._-]{1,120}\\.(png|jpe?g|webp)$') then", "    if false then")),
    ('rpc-logo-tanpa-cek-objek', m("    if not exists (select 1 from storage.objects o where o.bucket_id = 'dokumen' and o.name = v_logo) then", "    if false then")),
    ('rpc-logo-cek-objek-bucket-lain', m("where o.bucket_id = 'dokumen' and o.name = v_logo", "where o.name = v_logo")),
    ('rpc-ubah-logo-diabaikan', m("v_logo := case when coalesce(p_ubah_logo, false) then", "v_logo := case when true then")),
    ('rpc-logo-lama-tidak-dilaporkan', m("'logo_lama', case when b.logo_path is distinct from v_logo then b.logo_path end, 'changed', true);", "'logo_lama', null, 'changed', true);")),
    ('rpc-tanpa-deteksi-tidak-berubah', m("if v_alamat is not distinct from b.alamat and v_telepon is not distinct from b.telepon and v_logo is not distinct from b.logo_path then", "if false then")),
    ('rpc-audit-tanpa-logo', m("jsonb_build_object('alamat', v_alamat, 'telepon', v_telepon, 'logo_path', v_logo), auth.uid());", "jsonb_build_object('alamat', v_alamat, 'telepon', v_telepon), auth.uid());")),
    ('rpc-audit-pelaku-salah', m("'logo_path', v_logo), auth.uid());", "'logo_path', v_logo), b.id);")),
    ('rpc-cabang-hilang-diam', m("  if not found then raise exception 'Cabang tidak ditemukan' using errcode = 'CG002'; end if;", "  if not found then return null; end if;")),
    # ── penjaga penulisan langsung
    ('pemicu-tidak-dipasang', m("create trigger a00_guard_branch_identity_edit before update on public.branches\n  for each row execute function public.guard_branch_identity_direct_edit();", "select 1;")),
    ('pemicu-lupa-alamat', m(TRG_COND, TRG_COND.replace("new.alamat is distinct from old.alamat or ", ""))),
    ('pemicu-lupa-telepon', m(TRG_COND, TRG_COND.replace("new.telepon is distinct from old.telepon or ", ""))),
    ('pemicu-lupa-logo', m(TRG_COND, TRG_COND.replace(" or new.logo_path is distinct from old.logo_path", ""))),
    ('pemicu-semua-peran-lolos', m(TRG_COND, TRG_COND.replace("current_user in ('authenticated', 'anon')", "false"))),
    ('pemicu-sistem-ikut-ditolak', m(TRG_COND, TRG_COND.replace("current_user in ('authenticated', 'anon')", "true"))),
    ('pemicu-hanya-anon', m(TRG_COND, TRG_COND.replace("current_user in ('authenticated', 'anon')", "current_user in ('anon')"))),
    ('pemicu-ikut-tolak-kolom-lama', m(TRG_COND, TRG_COND.replace("new.alamat is distinct from old.alamat or", "new.radius_m is distinct from old.radius_m or new.alamat is distinct from old.alamat or"))),
    # ── batasan data
    ('cek-logo-cabang-lain-boleh', m(CEK_LOGO, "  and (logo_path is null or logo_path ~* ('^cabang-logo/[0-9a-f-]{36}/[a-z0-9._-]{1,120}\\.(png|jpe?g|webp)$'))")),
    ('cek-logo-gif-boleh', m(CEK_LOGO, CEK_LOGO.replace("(png|jpe?g|webp)", "(png|gif|jpe?g|webp)"))),
    ('cek-logo-tanpa-awalan', m(CEK_LOGO, CEK_LOGO.replace("'^cabang-logo/' || id::text", "'^[a-z-]+/' || id::text"))),
    ('cek-alamat-kontrol-boleh', m("length(alamat) between 3 and 200 and alamat !~ '[[:cntrl:]]'", "length(alamat) between 3 and 200")),
    ('cek-alamat-min-1', m("length(alamat) between 3 and 200", "length(alamat) between 1 and 200")),
    ('cek-telepon-huruf-boleh', m("length(telepon) between 3 and 30 and telepon ~ '^[0-9+()./, -]+$'", "length(telepon) between 3 and 30")),
    ('cek-batasan-dibuang', m("alter table public.branches add constraint branches_identitas_cek check (", "alter table public.branches add constraint branches_identitas_cek check (true or ")),
    # ── fungsi kebijakan storage
    ('tulis-staf-boleh', m(TULIS_ROLE, TULIS_ROLE.replace("('OWNER', 'ADMIN')", "('OWNER', 'ADMIN', 'STAFF')"))),
    ('tulis-finance-boleh', m(TULIS_ROLE, TULIS_ROLE.replace("('OWNER', 'ADMIN')", "('OWNER', 'ADMIN', 'FINANCE')"))),
    ('tulis-tanpa-cek-peran', m(TULIS_ROLE, "  null;  -- tanpa cek peran")),
    ('tulis-tanpa-cek-nama', m(TULIS_NAMA, "  null;")),
    ('tulis-nama-ekstensi-gif', m(TULIS_NAMA, TULIS_NAMA.replace("(png|jpe?g|webp)", "(png|gif|jpe?g|webp)"))),
    ('tulis-tanpa-cek-cabang-ada', m(TULIS_CABANG, "  return true;")),
    ('hapus-semua-boleh', m(HAPUS_RET, "  return true;")),
    ('hapus-finance-boleh', m(HAPUS_RET, HAPUS_RET.replace("('OWNER', 'ADMIN')", "('OWNER', 'ADMIN', 'FINANCE')"))),
    ('hapus-admin-ditolak', m(HAPUS_RET, HAPUS_RET.replace("('OWNER', 'ADMIN')", "('OWNER')"))),
    ('hapus-peran-null-lolos', m(HAPUS_RET, "  return v_role is null or v_role in ('OWNER', 'ADMIN');")),
    ('hapus-bukan-definer', m("create function public.cabang_logo_boleh_hapus(p_name text) returns boolean\nlanguage plpgsql stable security definer set search_path = '' as $f$", "create function public.cabang_logo_boleh_hapus(p_name text) returns boolean\nlanguage plpgsql stable set search_path = '' as $f$")),
    ('tulis-tanpa-search-path', m("create function public.cabang_logo_boleh_tulis(p_name text) returns boolean\nlanguage plpgsql stable security definer set search_path = '' as $f$", "create function public.cabang_logo_boleh_tulis(p_name text) returns boolean\nlanguage plpgsql stable security definer as $f$")),
    # ── kebijakan
    ('kebijakan-tulis-terbuka', m(POL_TULIS, POL_TULIS.replace("public.cabang_logo_boleh_tulis(name)", "true"))),
    ('kebijakan-hapus-terbuka', m(POL_HAPUS, POL_HAPUS.replace("public.cabang_logo_boleh_hapus(name)", "true"))),
    ('kebijakan-ubah-terbuka', m(POL_UBAH, "create policy cabang_logo_ubah_ketat on storage.objects as restrictive for update to authenticated\n    using (true) with check (true)")),
    ('kebijakan-tulis-permissive', m(POL_TULIS, POL_TULIS.replace("as restrictive", "as permissive"))),
    ('kebijakan-hapus-permissive', m(POL_HAPUS, POL_HAPUS.replace("as restrictive", "as permissive"))),
    ('kebijakan-tulis-tanpa-bucket', m(POL_TULIS, POL_TULIS.replace("bucket_id <> 'dokumen' or ", ""))),
    ('kebijakan-hapus-tanpa-bucket', m(POL_HAPUS, POL_HAPUS.replace("bucket_id <> 'dokumen' or ", ""))),
    ('kebijakan-ubah-tanpa-bucket', m(POL_UBAH, POL_UBAH.replace("bucket_id <> 'dokumen' or ", ""))),
    ('kebijakan-tulis-awalan-longgar', m(POL_TULIS, POL_TULIS.replace("'cabang-logo/%'", "'cabang-logo%'"))),
    ('kebijakan-hapus-awalan-longgar', m(POL_HAPUS, POL_HAPUS.replace("'cabang-logo/%'", "'cabang-logo%'"))),
    ('kebijakan-ubah-awalan-longgar', m(POL_UBAH, POL_UBAH.replace("'cabang-logo/%'", "'cabang-logo%'"))),
    ('kebijakan-tulis-hilang', m(POL_TULIS, "select 1")),
    ('kebijakan-hapus-hilang', m(POL_HAPUS, "select 1")),
    ('kebijakan-ubah-hilang', m(POL_UBAH, "select 1")),
    ('kebijakan-baca-ketat-ikut-dipasang', m("  execute $p$create policy cabang_logo_hapus_ketat", "  execute $p$create policy cabang_logo_baca_ketat on storage.objects as restrictive for select to authenticated\n    using (bucket_id <> 'dokumen' or name not like 'cabang-logo/%' or public.cabang_logo_boleh_hapus(name))$p$;\n  execute $p$create policy cabang_logo_hapus_ketat")),
    # ── ACL
    ('acl-rpc-anon', m("grant execute on function public.update_branch_identity(uuid, text, text, text, boolean) to authenticated;", "grant execute on function public.update_branch_identity(uuid, text, text, text, boolean) to authenticated, anon;")),
    ('acl-rpc-tidak-dicabut', m("revoke all on function public.update_branch_identity(uuid, text, text, text, boolean) from public, anon, service_role;", "-- revoke dibuang")),
    ('acl-tulis-service-role', m("grant execute on function public.cabang_logo_boleh_tulis(text) to authenticated;", "grant execute on function public.cabang_logo_boleh_tulis(text) to authenticated, service_role;")),
    ('acl-hapus-tidak-dicabut', m("revoke all on function public.cabang_logo_boleh_hapus(text) from public, anon, service_role;", "-- revoke dibuang")),
    ('acl-pemicu-authenticated', m("revoke all on function public.guard_branch_identity_direct_edit() from public, anon, authenticated, service_role;", "revoke all on function public.guard_branch_identity_direct_edit() from public, anon, service_role;")),
    # ── tanpa data
    ('migrasi-mengisi-data', m("notify pgrst, 'reload schema';\n\n-- ───────────── 7.", "notify pgrst, 'reload schema';\nupdate public.branches set alamat = 'Jl. Bocor 1';\n\n-- ───────────── 7.")),
]
