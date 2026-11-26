"""Mutan untuk migrasi 20261214100100_admin_umum_role.sql (dipakai: test-role-admin-umum-postgres.py --mutations).

build(body) -> [(nama, [(jangkar, pengganti), ...], [bagian tes yang dijalankan])]
Tiap jangkar harus muncul TEPAT 1 kali di berkas migrasi. Mutan harus tetap terpasang (bukan galat pasang) dan harus dimatikan oleh minimal satu kasus tes.
Pemeriksaan pasca-pasang di migrasi (bagian 7) sengaja strict; mutan yang menyentuhnya ikut menyunting pemeriksaannya supaya yang diuji adalah tes, bukan pemeriksa."""

REWRITE = ["struktur", "matriks", "kebijakan", "cabang"]
JURNAL = ["jurnal", "batas"]
CHECK_BUAT = "'jurnal_aksi_diizinkan\\(''jurnal\\.buat_manual''\\)'"


def build(body):
    M = []

    def m(nama, edit, sections):
        M.append((nama, edit, sections))

    # --- penulis ulang
    m("rewrite-eq-any-ditambah-finance", [("'\\1\\2any(''{ADMIN,ADMIN_UMUM}'')'", "'\\1\\2any(''{ADMIN,ADMIN_UMUM,FINANCE}'')'")], REWRITE)
    m("rewrite-ne-all-tanpa-umum", [("'\\1\\2all(''{ADMIN,ADMIN_UMUM}'')'", "'\\1\\2all(''{ADMIN}'')'")], REWRITE)
    m("rewrite-ne-any-bukan-all", [("'\\1\\2all(''{ADMIN,ADMIN_UMUM}'')'", "'\\1\\2any(''{ADMIN,ADMIN_UMUM}'')'")], REWRITE)
    m("rewrite-daftar-in-ditambah-finance", [("regexp_replace(lst, '''ADMIN''', '''ADMIN'',''ADMIN_UMUM''', 'g')", "regexp_replace(lst, '''ADMIN''', '''ADMIN'',''ADMIN_UMUM'',''FINANCE''', 'g')")], REWRITE)
    m("rewrite-daftar-in-ditambah-owner", [("regexp_replace(lst, '''ADMIN''', '''ADMIN'',''ADMIN_UMUM''', 'g')", "regexp_replace(lst, '''ADMIN''', '''ADMIN'',''ADMIN_UMUM'',''OWNER''', 'g')")], REWRITE)
    m("kebijakan-eq-text-tidak-ditulis", [("'= ANY (ARRAY[''ADMIN''::text, ''ADMIN_UMUM''::text])', 'g');", "'= ''ADMIN''::text', 'g');")], ["struktur", "kebijakan"])
    m("kebijakan-daftar-user-role-tidak-ditulis", [("'''ADMIN''::user_role, ''ADMIN_UMUM''::user_role', 'g');", "'''ADMIN''::user_role', 'g');")], ["struktur", "kebijakan"])
    m("kebijakan-daftar-text-tidak-ditulis", [("'''ADMIN''::text, ''ADMIN_UMUM''::text', 'g');", "'''ADMIN''::text', 'g');")], ["struktur", "kebijakan"])
    m("kebijakan-eq-text-ditambah-owner", [("'= ANY (ARRAY[''ADMIN''::text, ''ADMIN_UMUM''::text])', 'g');", "'= ANY (ARRAY[''ADMIN''::text, ''ADMIN_UMUM''::text, ''OWNER''::text])', 'g');")], ["struktur", "kebijakan"])
    # --- cakupan penerap massal
    m("cakupan-skema-private-dilewati", [("and n.nspname not in ('pg_catalog','information_schema','extensions','admin_umum_private','auth','storage','realtime','vault','graphql','graphql_public','pgsodium','supabase_functions','supabase_migrations','net','cron','pgbouncer')\n      and p.prosrc ~ '''ADMIN''(?![A-Za-z_0-9])'", "and n.nspname not in ('pg_catalog','information_schema','extensions','admin_umum_private','private','auth','storage','realtime','vault','graphql','graphql_public','pgsodium','supabase_functions','supabase_migrations','net','cron','pgbouncer')\n      and p.prosrc ~ '''ADMIN''(?![A-Za-z_0-9])'")], ["struktur", "matriks", "cabang"])
    m("cakupan-skema-platform-disentuh", [("and n.nspname not in ('pg_catalog','information_schema','extensions','admin_umum_private','auth','storage','realtime','vault','graphql','graphql_public','pgsodium','supabase_functions','supabase_migrations','net','cron','pgbouncer')\n      and p.prosrc ~ '''ADMIN''(?![A-Za-z_0-9])'", "and n.nspname not in ('pg_catalog','information_schema','extensions','admin_umum_private')\n      and p.prosrc ~ '''ADMIN''(?![A-Za-z_0-9])'")], ["struktur"])
    m("cakupan-kebijakan-bentuk-text-dilewati", [("~ '''ADMIN''::'\n    order by 3, 2", "~ '''ADMIN''::user_role'\n    order by 3, 2")], ["struktur", "kebijakan"])
    # --- fungsi jurnal_aksi_diizinkan / jurnal_izin
    m("izin-koreksi-bawaan-hidup", [("when 'jurnal.koreksi_manual' then false when", "when 'jurnal.koreksi_manual' then true when")], JURNAL)
    m("izin-owner-tidak-selalu", [("if v_role = 'OWNER' then return true; end if;", "if v_role = 'OWNER' then return false; end if;")], JURNAL)
    m("izin-koreksi-tanpa-grant-eksplisit", [("if not v_grant then return false; end if;", "null;")], JURNAL)
    m("izin-abaikan-tombol-akses-grup", [("return public.role_action_allowed(p_action);", "return true;")], JURNAL)
    m("izin-akun-nonaktif-lolos", [("where id = auth.uid() and is_active;", "where id = auth.uid();")], JURNAL)
    m("izin-aksi-tak-dikenal-lolos", [("p_action not in ('jurnal.lihat','jurnal.buat_manual','jurnal.koreksi_manual','jurnal.lihat_semua_sumber') then return false", "p_action not in ('jurnal.lihat','jurnal.buat_manual','jurnal.koreksi_manual','jurnal.lihat_semua_sumber') then return true")], JURNAL)
    m("izin-lihat-semua-sumber-tak-dikenal", [("p_action not in ('jurnal.lihat','jurnal.buat_manual','jurnal.koreksi_manual','jurnal.lihat_semua_sumber') then return false", "p_action not in ('jurnal.lihat','jurnal.buat_manual','jurnal.koreksi_manual') then return false")], JURNAL)
    m("izin-json-koreksi-salah-kunci", [("'koreksi_manual', public.jurnal_aksi_diizinkan('jurnal.koreksi_manual')", "'koreksi_manual', public.jurnal_aksi_diizinkan('jurnal.buat_manual')")], JURNAL)
    # --- penegakan di fungsi inti
    m("tegak-buat-manual-tidak-ditegakkan", [("and not public.jurnal_aksi_diizinkan(''jurnal.buat_manual'') then raise exception ''Izin Buat", "and not (public.jurnal_aksi_diizinkan(''jurnal.buat_manual'') or true) then raise exception ''Izin Buat")], JURNAL)
    m("tegak-buat-manual-kunci-salah", [("and not public.jurnal_aksi_diizinkan(''jurnal.buat_manual'') then raise exception ''Izin Buat", "and not public.jurnal_aksi_diizinkan(''jurnal.lihat'') then raise exception ''Izin Buat"), (CHECK_BUAT, "'jurnal_aksi_diizinkan\\(''jurnal\\.lihat''\\)'")], JURNAL)
    m("tegak-koreksi-tidak-ditegakkan", [("(v_profile.role<>''OWNER'' and not public.jurnal_aksi_diizinkan(''jurnal.koreksi_manual''))", "(v_profile.role<>''OWNER'' and not (public.jurnal_aksi_diizinkan(''jurnal.koreksi_manual'') or true))")], JURNAL)
    m("tegak-koreksi-semua-peran-lolos", [("(v_profile.role<>''OWNER'' and not public.jurnal_aksi_diizinkan(''jurnal.koreksi_manual''))", "(v_profile.role<>''OWNER'' and v_profile.role<>''ADMIN'' and not public.jurnal_aksi_diizinkan(''jurnal.koreksi_manual''))")], JURNAL)
    # --- katalog Akses Grup
    m("katalog-tombol-tampil-untuk-semua-peran", [("where c.id not like ''jurnal.%'' or p_role=''ADMIN_UMUM''),''audit'''", "where true),''audit'''")], ["struktur", "batas", "jurnal"])
    m("simpan-tombol-jurnal-diterima-semua-peran", [("enforced and (c.id not like ''jurnal.%'' or p_role=''ADMIN_UMUM'')'", "enforced and true'")], ["struktur", "batas", "jurnal"])
    m("katalog-tombol-modul-salah", [("select a, 'buku-besar' from unnest(", "select a, 'laporan' from unnest("), ("and module_id = 'buku-besar') <> 4", "and module_id = 'laporan') <> 4")], ["struktur", "jurnal"])
    # --- log aktivitas
    m("aktivitas-pembaca-bawaan-data-tidak-dipetakan", [("(p.role::text=any(c.reader_roles) or (p.role::text=''ADMIN_UMUM'' and ''ADMIN'' /*umum*/ =any(c.reader_roles)))", "p.role::text=any(c.reader_roles)")], ["aktivitas"])
    m("aktivitas-dipetakan-ke-owner", [("(p.role::text=''ADMIN_UMUM'' and ''ADMIN'' /*umum*/ =any(p_roles))", "(p.role::text=''ADMIN_UMUM'' and ''OWNER'' /*umum*/ =any(p_roles))")], ["aktivitas"])
    # --- epoch, pagar Admin Online
    m("epoch-peran-tidak-dibuat", [("insert into role_settings_private.epochs(role, epoch) values ('ADMIN_UMUM', 0) on conflict (role) do nothing;", "select 1;"), ("if not exists (select 1 from role_settings_private.epochs where role = 'ADMIN_UMUM') then raise exception 'ADMIN_UMUM_CHECK: epoch peran tidak ada'; end if;", "null;")], ["struktur", "jurnal", "batas"])
    m("epoch-guard-tidak-dinyalakan", [("alter table role_settings_private.epochs enable trigger epoch_guard;", "select 1;"), ("t.tgname = 'epoch_guard' and t.tgenabled = 'O') <> 1", "t.tgname = 'epoch_guard' and t.tgenabled = 'D') <> 1")], ["struktur", "batas"])
    m("pagar-admin-online-tidak-dijalankan", [("select admin_online_private.fence_all();\nselect admin_online_private.guard_all();", "select 1;"), ("if r.sig like '%jurnal_izin%' and r.prosrc !~ 'admin_online_private\\.deny_admin_online' then", "if false then")], ["struktur", "acl", "batas", "jurnal"])
    return M
