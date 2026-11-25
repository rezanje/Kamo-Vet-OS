#!/usr/bin/env python3
"""Mutan untuk migrasi 20261211200000_komplain_lampiran_storage: (nama, [(teks lama, teks baru, jumlah kemunculan)]).
Dipakai test-komplain-lampiran-storage-postgres.py --mutations. Setiap mutan harus membuat suite SQL GAGAL lewat pernyataan uji (bukan galat pasang).
Blok pemeriksaan pasang (do $check$) dibuang dari semua varian (termasuk kontrol) supaya suite sendiri yang membuktikan.
Mutan yang menghapus token yang diperiksa blok pasang dipertahankan lewat komentar bila perlu."""

BACA_OWNER = "  if v_role = 'OWNER' then return true; end if;\n  if exists (select 1 from public.customer_complaint_files f join"
BACA_ACTOR = "  if v_role is null then return false; end if;                      -- Admin Online, akun nonaktif, tanpa sesi"
HAPUS_ACTOR = "  if v_role is null then return false; end if;\n  if exists (select 1 from public.customer_complaint_files f where f.path = p_name) then return false; end if;   -- lampiran tak boleh hilang"
HAPUS_ATTACHED = "  if exists (select 1 from public.customer_complaint_files f where f.path = p_name) then return false; end if;   -- lampiran tak boleh hilang"
HAPUS_RET = "return v_role = 'OWNER' or (p_owner is not null and p_owner = auth.uid()::text);"
POL_BACA = "create policy komplain_berkas_baca_ketat on storage.objects as restrictive for select to authenticated\n    using (bucket_id <> 'dokumen' or name not like 'komplain/%' or public.komplain_berkas_boleh_baca(name, coalesce(owner_id, owner::text)))"
POL_HAPUS = "create policy komplain_berkas_hapus_ketat on storage.objects as restrictive for delete to authenticated\n    using (bucket_id <> 'dokumen' or name not like 'komplain/%' or public.komplain_berkas_boleh_hapus(name, coalesce(owner_id, owner::text)))"
POL_TULIS = "create policy komplain_berkas_tulis_ketat on storage.objects as restrictive for insert to authenticated\n    with check (bucket_id <> 'dokumen' or name not like 'komplain/%' or public.komplain_boleh())"
POL_UBAH = "create policy komplain_berkas_ubah_ketat on storage.objects as restrictive for update to authenticated\n    using (bucket_id <> 'dokumen' or name not like 'komplain/%') with check (bucket_id <> 'dokumen' or name not like 'komplain/%')"


def m(old, new): return [(old, new, 1)]


MUTANTS = [
    # ── fungsi baca
    ('baca-owner-tidak-khusus', m(BACA_OWNER, "  if exists (select 1 from public.customer_complaint_files f join")),
    ('baca-admin-seperti-owner', m(BACA_OWNER, "  if v_role in ('OWNER', 'ADMIN') then return true; end if;\n  if exists (select 1 from public.customer_complaint_files f join")),
    ('baca-tanpa-cek-aktor', m(BACA_ACTOR, "  null;                      -- Admin Online, akun nonaktif, tanpa sesi")),
    ('baca-terlampir-tanpa-visibilitas', m("where f.path = p_name and public.komplain_visible(c.branch_id, c.created_by, c.assigned_to)) then", "where f.path = p_name) then")),
    ('baca-yatim-siapa-saja', m("return p_owner is not null and p_owner = auth.uid()::text         -- unggahan", "return p_owner is not null         -- unggahan")),
    ('baca-yatim-null-lolos', m("return p_owner is not null and p_owner = auth.uid()::text         -- unggahan", "return coalesce(p_owner, auth.uid()::text) = auth.uid()::text         -- unggahan")),
    ('baca-terlampir-masih-milik-pengunggah', m("\n     and not exists (select 1 from public.customer_complaint_files f where f.path = p_name);", "\n;")),
    # ── fungsi hapus
    ('hapus-tanpa-cek-aktor', m(HAPUS_ACTOR, "  null;\n" + HAPUS_ATTACHED)),
    ('hapus-terlampir-boleh', m(HAPUS_ATTACHED, "  null;")),
    ('hapus-owner-tidak-khusus', m(HAPUS_RET, "return (p_owner is not null and p_owner = auth.uid()::text);")),
    ('hapus-admin-seperti-owner', m(HAPUS_RET, "return v_role in ('OWNER', 'ADMIN') or (p_owner is not null and p_owner = auth.uid()::text);")),
    ('hapus-siapa-saja-bila-ada-pemilik', m(HAPUS_RET, "return v_role = 'OWNER' or p_owner is not null;")),
    ('hapus-pemilik-null-lolos', m(HAPUS_RET, "return v_role = 'OWNER' or coalesce(p_owner, auth.uid()::text) = auth.uid()::text;")),
    # ── kebijakan
    ('kebijakan-baca-terbuka', m(POL_BACA, POL_BACA.replace("public.komplain_berkas_boleh_baca(name, coalesce(owner_id, owner::text))", "true"))),
    ('kebijakan-hapus-terbuka', m(POL_HAPUS, POL_HAPUS.replace("public.komplain_berkas_boleh_hapus(name, coalesce(owner_id, owner::text))", "true"))),
    ('kebijakan-tulis-terbuka', m(POL_TULIS, POL_TULIS.replace("public.komplain_boleh()", "true"))),
    ('kebijakan-ubah-terbuka', m(POL_UBAH, "create policy komplain_berkas_ubah_ketat on storage.objects as restrictive for update to authenticated\n    using (true) with check (true)")),
    ('kebijakan-baca-permissive', m(POL_BACA, POL_BACA.replace("as restrictive", "as permissive"))),
    ('kebijakan-hapus-permissive', m(POL_HAPUS, POL_HAPUS.replace("as restrictive", "as permissive"))),
    ('kebijakan-baca-tanpa-bucket', m(POL_BACA, POL_BACA.replace("bucket_id <> 'dokumen' or ", ""))),
    ('kebijakan-hapus-tanpa-bucket', m(POL_HAPUS, POL_HAPUS.replace("bucket_id <> 'dokumen' or ", ""))),
    ('kebijakan-tulis-tanpa-bucket', m(POL_TULIS, POL_TULIS.replace("bucket_id <> 'dokumen' or ", ""))),
    ('kebijakan-ubah-tanpa-bucket', m(POL_UBAH, POL_UBAH.replace("bucket_id <> 'dokumen' or ", ""))),
    ('kebijakan-baca-awalan-longgar', m(POL_BACA, POL_BACA.replace("'komplain/%'", "'komplain%'"))),
    ('kebijakan-hapus-awalan-longgar', m(POL_HAPUS, POL_HAPUS.replace("'komplain/%'", "'komplain%'"))),
    ('kebijakan-tulis-awalan-longgar', m(POL_TULIS, POL_TULIS.replace("'komplain/%'", "'komplain%'"))),
    ('kebijakan-ubah-awalan-longgar', m(POL_UBAH, POL_UBAH.replace("'komplain/%'", "'komplain%'"))),
    ('kebijakan-baca-hilang', m(POL_BACA, "select 1")),
    ('kebijakan-hapus-hilang', m(POL_HAPUS, "select 1")),
    # ── ACL / definer
    ('acl-baca-anon', m("grant execute on function public.komplain_berkas_boleh_baca(text, text) to authenticated;", "grant execute on function public.komplain_berkas_boleh_baca(text, text) to authenticated, anon;")),
    ('acl-hapus-tidak-dicabut', m("revoke all on function public.komplain_berkas_boleh_hapus(text, text) from public, anon, service_role;", "-- revoke all on function public.komplain_berkas_boleh_hapus(text, text) from public, anon, service_role;")),
    ('baca-tanpa-search-path', m("language plpgsql stable security definer set search_path = '' as $f$\ndeclare v_role text;\nbegin\n  v_role := clinic_private.komplain_actor();\n  if v_role is null then return false; end if;                      --",
                                 "language plpgsql stable security definer as $f$\ndeclare v_role text;\nbegin\n  v_role := clinic_private.komplain_actor();\n  if v_role is null then return false; end if;                      --")),
    ('config-log-truncate-lepas', m("create trigger komplain_config_log_tetap_truncate before truncate on public.complaint_config_log for each statement execute function clinic_private.komplain_guard_tetap();", "select 1;  -- komplain_config_log_tetap_truncate dilepas")),
    # ── lampiran harus milik pemanggil
    ('lampiran-tanpa-cek-pemilik', m("                               and coalesce(o.owner_id, o.owner::text) = auth.uid()::text)) then", "                               )) then")),
    ('lampiran-tanpa-cek-bucket', m("o.bucket_id = ''dokumen'' and o.name = x.path", "o.name = x.path")),
    ('lampiran-tanpa-kolom-owner', m("coalesce(o.owner_id, o.owner::text) = auth.uid()::text", "o.owner_id = auth.uid()::text")),
    ('lampiran-cek-hanya-bila-ada-objek-lain', m("if jsonb_array_length(v) > 0 and exists (select 1 from jsonb_to_recordset(v) as x(path text)", "if jsonb_array_length(v) > 1 and exists (select 1 from jsonb_to_recordset(v) as x(path text)")),
    # ── daftar petugas menurut peran pelihat
    ('petugas-staf-tanpa-rekan', m("or p.role::text in (''STAFF'', ''DOCTOR'') /* KOMPLAIN_PETUGAS_PERAN */", "or false /* KOMPLAIN_PETUGAS_PERAN */")),
    ('petugas-dokter-tersembunyi', m("or p.role::text in (''STAFF'', ''DOCTOR'') /* KOMPLAIN_PETUGAS_PERAN */", "or p.role::text in (''STAFF'') /* KOMPLAIN_PETUGAS_PERAN */")),
    ('petugas-finance-dibatasi', m("v_role in (''OWNER'', ''ADMIN'', ''FINANCE'') or", "v_role in (''OWNER'', ''ADMIN'') or")),
    ('petugas-admin-dibatasi', m("v_role in (''OWNER'', ''ADMIN'', ''FINANCE'') or", "v_role in (''OWNER'', ''FINANCE'') or")),
    ('petugas-izin-kelola-diabaikan', m("or clinic_private.komplain_kelola() or p.role::text", "or p.role::text")),
    ('petugas-semua-bagi-semua', m("or clinic_private.komplain_kelola() or p.role::text in (''STAFF'', ''DOCTOR'') /* KOMPLAIN_PETUGAS_PERAN */", "or true /* KOMPLAIN_PETUGAS_PERAN */")),
]
