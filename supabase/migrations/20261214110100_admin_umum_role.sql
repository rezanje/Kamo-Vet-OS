-- Peran "Admin Umum" (ADMIN_UMUM), Andri 26 Nov 2026: admin umum yang membantu pekerjaan finance. Berkas 2 dari 2
-- (nilai enum ada di 20261214110000_admin_umum_enum.sql dan harus sudah ter-commit).
--
-- TUJUAN: ADMIN_UMUM berperilaku SAMA PERSIS seperti ADMIN (peran ADMIN tanpa pengaturan Akses Grup tersimpan: semua modul, semua cabang)
-- di setiap tempat database yang menyebut ADMIN; hak aksesnya kemudian diatur sendiri lewat Akses Grup (modul, sub-menu, tindakan, kemampuan).
-- TIDAK menjadi setara OWNER: setiap daftar peran yang memuat OWNER dan ADMIN tetap memuat OWNER persis seperti semula; peran ini hanya DITAMBAHKAN
-- di sebelah ADMIN. Aturan "hanya OWNER yang boleh memberi/mengubah peran ADMIN" otomatis berlaku juga untuk ADMIN_UMUM (ia ikut daftar peran istimewa).
--
-- CARA (terpusat, bukan ratusan sunting tangan):
--  1. admin_umum_private.tulis_ulang(teks, mode): fungsi murni yang menambahkan ADMIN_UMUM di sebelah ADMIN pada daftar peran (in (...), array[...]),
--     `= 'ADMIN'` -> `= any('{ADMIN,ADMIN_UMUM}')`, `<> 'ADMIN'` -> `<> all(...)`. Gagal tertutup bila masih ada 'ADMIN' yang tidak dikenali bentuknya.
--  2. admin_umum_private.terapkan_semua(dry): memutar SELURUH fungsi (semua skema non-sistem) dan kebijakan RLS yang menyebut 'ADMIN' memakai definisi HIDUP
--     (pg_get_functiondef / pg_get_expr), sehingga drift hosted ikut terbawa. Idempotent; dapat dijalankan ulang (pemilik saja) sesudah migrasi lain
--     menambah fungsi/kebijakan yang menyebut ADMIN. Mode dry hanya melaporkan.
--  3. admin_umum_private.kembalikan_semua(): kebalikan persis (dipakai ROLLBACK.sql dan tes pulang-pergi).
--  4. Tambalan berjangkar (tepat 1 kemunculan, gagal tertutup) untuk hal yang bukan daftar peran: pembaca log aktivitas berbasis data (reader_roles),
--     daftar peran yang bisa diedit di Akses Grup (get/save_role_access_config), kunci advisory per peran.
--  5. Tombol Jurnal Umum per peran (Akses Grup > Tindakan): jurnal.lihat, jurnal.buat_manual, jurnal.koreksi_manual (izin khusus, bawaan MATI seperti
--     ADMIN: koreksi jurnal manual hari ini khusus OWNER), jurnal.lihat_semua_sumber. Hanya berlaku untuk ADMIN_UMUM; peran lain tidak berubah.
--  6. Pagar Admin Online (fence_all/guard_all) dijalankan ulang sesudahnya; ADMIN_UMUM BUKAN Admin Online.
-- Sengaja TIDAK diubah: CHECK approval_rules_penyetuju_role_check (penyetuju tetap OWNER/ADMIN/FINANCE; ADMIN_UMUM memakai antrean ADMIN di aplikasi),
-- DEFAULT reader_roles log aktivitas (dipetakan di pembaca), fungsi kamo_import.* milik kamo_legacy_import_writer bila tidak bisa diubah (dilaporkan).
-- Tidak ada akun yang diberi peran ini oleh migrasi ini. Rollback: ROLLBACK.sql di bukti (ubah/nonaktifkan semua akun ADMIN_UMUM lebih dulu).
set local lock_timeout = '15s';

do $pre$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'user_role' and e.enumlabel = 'ADMIN_UMUM') then
    raise exception 'ADMIN_UMUM_PRECONDITION: nilai enum ADMIN_UMUM belum ter-commit (jalankan 20261214110000 lebih dulu)';
  end if;
  if to_regprocedure('admin_online_private.fence_all()') is null or to_regprocedure('admin_online_private.guard_all()') is null
     or to_regprocedure('public.role_action_allowed(text)') is null or to_regprocedure('public.get_role_access_config(text)') is null
     or to_regprocedure('public.save_role_access_config(text,text,uuid,text,jsonb,jsonb,text,jsonb,jsonb)') is null
     or to_regprocedure('public.create_manual_journal_atomic(text,date,text,uuid,jsonb)') is null
     or to_regprocedure('public.revise_manual_journal(text,uuid,integer,text,jsonb,jsonb,text)') is null
     or to_regprocedure('public.activity_log_reader_guard(text,text[],boolean,uuid[])') is null
     or to_regclass('role_settings_private.action_catalog') is null or to_regclass('role_settings_private.action_modules') is null
     or to_regclass('role_settings_private.epochs') is null then
    raise exception 'ADMIN_UMUM_PRECONDITION: prasyarat tidak lengkap; periksa urutan migrasi';
  end if;
  if exists (select 1 from pg_namespace where nspname = 'admin_umum_private') then
    raise exception 'ADMIN_UMUM_PRECONDITION: skema admin_umum_private sudah ada; periksa urutan migrasi';
  end if;
end $pre$;

create schema admin_umum_private;
revoke all on schema admin_umum_private from public, anon, authenticated, service_role;

-- ───────────────────────── 1. Penulis ulang murni ─────────────────────────
-- mode 'fn'  : teks fungsi (pg_get_functiondef): daftar `in (...)` / `array[...]` yang hanya berisi string, serta `= 'ADMIN'` / `<> 'ADMIN'`.
-- mode 'pol' : keluaran pg_get_expr kebijakan: `'ADMIN'::user_role` / `'ADMIN'::text` dalam ARRAY[...] dan `= 'ADMIN'::text`.
create function admin_umum_private.tulis_ulang(p_src text, p_mode text) returns text
language plpgsql immutable set search_path = '' as $f$
declare s text := p_src; m text[]; lst text;
begin
  if p_mode = 'fn' then
    for m in select regexp_matches(s, '((?:\mnot\s+)?\min\s*\(\s*''[A-Za-z_]+''(?:\s*,\s*''[A-Za-z_]+'')*\s*\)|\marray\s*\[\s*''[A-Za-z_]+''(?:\s*,\s*''[A-Za-z_]+'')*\s*\])', 'gi') loop
      lst := m[1];
      if lst ~ '''ADMIN''' and lst !~ '''ADMIN_UMUM''' then
        s := replace(s, lst, regexp_replace(lst, '''ADMIN''', '''ADMIN'',''ADMIN_UMUM''', 'g'));
      end if;
    end loop;
    -- spasi asli di sekitar operator dipertahankan supaya kebalikannya (kembalikan) persis sama
    s := regexp_replace(s, '(<>|!=)(\s*)''ADMIN''(?![A-Za-z_0-9])(?!\s*/\*umum\*/)', '\1\2all(''{ADMIN,ADMIN_UMUM}'')', 'g');
    s := regexp_replace(s, '(?<![<>!=:])(=)(\s*)''ADMIN''(?![A-Za-z_0-9])(?!\s*/\*umum\*/)', '\1\2any(''{ADMIN,ADMIN_UMUM}'')', 'g');
  elsif p_mode = 'pol' then
    s := regexp_replace(s, '(?<![<>!=])=\s*''ADMIN''::text', '= ANY (ARRAY[''ADMIN''::text, ''ADMIN_UMUM''::text])', 'g');
    s := regexp_replace(s, '''ADMIN''::user_role(?!\s*,\s*''ADMIN_UMUM'')(?=\s*[,\]])', '''ADMIN''::user_role, ''ADMIN_UMUM''::user_role', 'g');
    s := regexp_replace(s, '''ADMIN''::text(?!\s*,\s*''ADMIN_UMUM'')(?=\s*[,\]])', '''ADMIN''::text, ''ADMIN_UMUM''::text', 'g');
  else
    raise exception 'UMUM_MODE: % tidak dikenal', p_mode;
  end if;
  return s;
end $f$;
revoke all on function admin_umum_private.tulis_ulang(text, text) from public, anon, authenticated, service_role;

-- Sisa 'ADMIN' yang BELUM dipasangkan dengan ADMIN_UMUM (bentuk tak dikenal). Pengecualian tertulis: penanda /*umum*/ dan `when 'ADMIN' then N when 'ADMIN_UMUM'`.
create function admin_umum_private.sisa(p_src text) returns integer
language sql immutable set search_path = '' as $f$
  select count(*)::int from regexp_matches(p_src, '''ADMIN''(?![A-Za-z_0-9])(?!\s*,\s*''ADMIN_UMUM'')(?!::[a-z_]+\s*,\s*''ADMIN_UMUM'')(?!\s*/\*umum\*/)(?!\s+then\s+[0-9]+\s+when\s+''ADMIN_UMUM'')', 'g');
$f$;
revoke all on function admin_umum_private.sisa(text) from public, anon, authenticated, service_role;

create function admin_umum_private.kembalikan(p_src text, p_mode text) returns text
language plpgsql immutable set search_path = '' as $f$
declare s text := p_src;
begin
  if p_mode = 'fn' then
    s := regexp_replace(s, '''ADMIN'',''ADMIN_UMUM''', '''ADMIN''', 'g');
    s := regexp_replace(s, '(<>|!=)(\s*)all\(''\{ADMIN,ADMIN_UMUM\}''\)', '\1\2''ADMIN''', 'g');
    s := regexp_replace(s, '(=)(\s*)any\(''\{ADMIN,ADMIN_UMUM\}''\)', '\1\2''ADMIN''', 'g');
  elsif p_mode = 'pol' then
    s := replace(s, '= ANY (ARRAY[''ADMIN''::text, ''ADMIN_UMUM''::text])', '= ''ADMIN''::text');
    s := replace(s, '''ADMIN''::user_role, ''ADMIN_UMUM''::user_role', '''ADMIN''::user_role');
    s := replace(s, '''ADMIN''::text, ''ADMIN_UMUM''::text', '''ADMIN''::text');
  else
    raise exception 'UMUM_MODE: % tidak dikenal', p_mode;
  end if;
  return s;
end $f$;
revoke all on function admin_umum_private.kembalikan(text, text) from public, anon, authenticated, service_role;

-- ───────────────────────── 2. Penerap massal (definisi hidup) ─────────────────────────
-- Skema milik platform (auth, storage, realtime, vault, dst.) sengaja TIDAK disentuh: itu kode Supabase, bukan aturan peran Kamo.
-- p_dry = true: hanya melaporkan. Fungsi yang bukan milik pengguna migrasi dilaporkan 'DILEWATI_BUKAN_PEMILIK' (tidak diubah, tidak gagal).
create function admin_umum_private.terapkan_semua(p_dry boolean default false)
returns table (jenis text, nama text, status text)
language plpgsql set search_path = public, pg_temp as $f$
declare r record; v text; v2 text; w text; w2 text; cmd text;
begin
  for r in
    select p.oid, n.nspname, p.oid::regprocedure::text as sig, p.proowner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind in ('f','p') and n.nspname not in ('pg_catalog','information_schema','extensions','admin_umum_private','auth','storage','realtime','vault','graphql','graphql_public','pgsodium','supabase_functions','supabase_migrations','net','cron','pgbouncer')
      and p.prosrc ~ '''ADMIN''(?![A-Za-z_0-9])'
      and not exists (select 1 from pg_depend e where e.classid = 'pg_proc'::regclass and e.objid = p.oid and e.deptype = 'e')
    order by p.oid::regprocedure::text
  loop
    v := pg_get_functiondef(r.oid);
    v2 := admin_umum_private.tulis_ulang(v, 'fn');
    if v2 = v then
      jenis := 'fungsi'; nama := r.sig; status := case when admin_umum_private.sisa(v) > 0 then 'SISA_TAK_DIKENAL' else 'SUDAH' end; return next; continue;
    end if;
    if admin_umum_private.sisa(v2) > 0 then
      jenis := 'fungsi'; nama := r.sig; status := 'SISA_TAK_DIKENAL';
      if not p_dry then raise exception 'ADMIN_UMUM_SISA: % masih memuat ''ADMIN'' dalam bentuk yang tidak dikenali', r.sig; end if;
      return next; continue;
    end if;
    if not pg_has_role(current_user, r.proowner, 'USAGE') then
      jenis := 'fungsi'; nama := r.sig; status := 'DILEWATI_BUKAN_PEMILIK'; return next; continue;
    end if;
    if not p_dry then execute v2; end if;
    jenis := 'fungsi'; nama := r.sig; status := 'DIUBAH'; return next;
  end loop;
  for r in
    select pol.oid, pol.polname, pol.polrelid::regclass::text as rel,
           pg_get_expr(pol.polqual, pol.polrelid) as q, pg_get_expr(pol.polwithcheck, pol.polrelid) as wc
    from pg_policy pol join pg_class c on c.oid = pol.polrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema','extensions')
      and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) ~ '''ADMIN''::'
    order by 3, 2
  loop
    v := r.q; w := r.wc;
    v2 := case when v is null then null else admin_umum_private.tulis_ulang(v, 'pol') end;
    w2 := case when w is null then null else admin_umum_private.tulis_ulang(w, 'pol') end;
    if v2 is not distinct from v and w2 is not distinct from w then
      jenis := 'kebijakan'; nama := r.rel || '.' || r.polname; status := 'SUDAH'; return next; continue;
    end if;
    if admin_umum_private.sisa(coalesce(v2, '') || coalesce(w2, '')) > 0 then raise exception 'ADMIN_UMUM_SISA: kebijakan % pada % memuat bentuk tak dikenal', r.polname, r.rel; end if;
    cmd := format('alter policy %I on %s', r.polname, r.rel)
           || case when v2 is not null then ' using (' || v2 || ')' else '' end
           || case when w2 is not null then ' with check (' || w2 || ')' else '' end;
    if not p_dry then execute cmd; end if;
    jenis := 'kebijakan'; nama := r.rel || '.' || r.polname; status := 'DIUBAH'; return next;
  end loop;
end $f$;
revoke all on function admin_umum_private.terapkan_semua(boolean) from public, anon, authenticated, service_role;

-- Kebalikan persis (untuk ROLLBACK.sql dan tes pulang-pergi). Hanya menyentuh bentuk yang ditulis fungsi di atas.
create function admin_umum_private.kembalikan_semua() returns integer
language plpgsql set search_path = public, pg_temp as $f$
declare r record; v text; v2 text; w text; w2 text; cmd text; n int := 0;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind in ('f','p') and n.nspname not in ('pg_catalog','information_schema','extensions','admin_umum_private','auth','storage','realtime','vault','graphql','graphql_public','pgsodium','supabase_functions','supabase_migrations','net','cron','pgbouncer')
      and p.prosrc ~ 'ADMIN_UMUM' and not exists (select 1 from pg_depend e where e.classid = 'pg_proc'::regclass and e.objid = p.oid and e.deptype = 'e')
  loop
    v := pg_get_functiondef(r.oid); v2 := admin_umum_private.kembalikan(v, 'fn');
    if v2 <> v then execute v2; n := n + 1; end if;
  end loop;
  for r in
    select pol.polname, pol.polrelid::regclass::text as rel, pg_get_expr(pol.polqual, pol.polrelid) as q, pg_get_expr(pol.polwithcheck, pol.polrelid) as wc
    from pg_policy pol
    where (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) ~ 'ADMIN_UMUM'
  loop
    v2 := case when r.q is null then null else admin_umum_private.kembalikan(r.q, 'pol') end;
    w2 := case when r.wc is null then null else admin_umum_private.kembalikan(r.wc, 'pol') end;
    cmd := format('alter policy %I on %s', r.polname, r.rel) || case when v2 is not null then ' using (' || v2 || ')' else '' end
           || case when w2 is not null then ' with check (' || w2 || ')' else '' end;
    execute cmd; n := n + 1;
  end loop;
  return n;
end $f$;
revoke all on function admin_umum_private.kembalikan_semua() from public, anon, authenticated, service_role;

-- ───────────────────────── 3. Tambalan berjangkar (tepat 1 kemunculan, gagal tertutup) ─────────────────────────
create function pg_temp.umum_patch(p_sig text, p_anchor text, p_new text) returns void
language plpgsql as $f$
declare v text; n int;
begin
  v := pg_get_functiondef(p_sig::regprocedure);
  n := (length(v) - length(replace(v, p_anchor, ''))) / length(p_anchor);
  if n <> 1 then raise exception 'ADMIN_UMUM_ANCHOR: % kemunculan (harus 1) di % untuk jangkar [%]', n, p_sig, left(p_anchor, 60); end if;
  execute replace(v, p_anchor, p_new);
end $f$;

-- 3a. Akses Grup: katalog tombol Jurnal Umum hanya tampil/diterima untuk ADMIN_UMUM; kunci advisory per peran; peran ADMIN_UMUM dapat diedit.
select pg_temp.umum_patch('public.get_role_access_config(text)',
  'from role_settings_private.action_catalog c),''audit''',
  'from role_settings_private.action_catalog c where c.id not like ''jurnal.%'' or p_role=''ADMIN_UMUM''),''audit''');
select pg_temp.umum_patch('public.save_role_access_config(text,text,uuid,text,jsonb,jsonb,text,jsonb,jsonb)',
  'case p_role when ''ADMIN'' then 1 when ''FINANCE'' then 2',
  'case p_role when ''ADMIN'' then 1 when ''ADMIN_UMUM'' then 5 when ''FINANCE'' then 2');
select pg_temp.umum_patch('public.save_role_access_config(text,text,uuid,text,jsonb,jsonb,text,jsonb,jsonb)',
  'action_catalog c where c.id=x#>>''{}'' and c.enforced',
  'action_catalog c where c.id=x#>>''{}'' and c.enforced and (c.id not like ''jurnal.%'' or p_role=''ADMIN_UMUM'')');

-- 3b. Pembaca log aktivitas berbasis DATA (reader_roles memuat teks peran): ADMIN_UMUM membaca apa yang dibaca ADMIN.
select pg_temp.umum_patch('public.activity_log_reader_guard(text,text[],boolean,uuid[])',
  'p.role::text=any(p_roles) and p.role::text=any(c.reader_roles)',
  '(p.role::text=any(p_roles) or (p.role::text=''ADMIN_UMUM'' and ''ADMIN'' /*umum*/ =any(p_roles))) and (p.role::text=any(c.reader_roles) or (p.role::text=''ADMIN_UMUM'' and ''ADMIN'' /*umum*/ =any(c.reader_roles)))');

-- ───────────────────────── 4. Tombol Jurnal Umum (Akses Grup > Tindakan; hanya ADMIN_UMUM) ─────────────────────────
-- (bentuk "select" supaya tidak terbaca sebagai baris katalog sub-menu oleh tes sinkron)
insert into role_settings_private.action_catalog(id, label, "group", enforced)
select 'jurnal.lihat', 'Jurnal Umum — buka halaman dan lihat jurnal (Admin Umum)', 'Jurnal Umum', true
union all select 'jurnal.buat_manual', 'Jurnal Umum — buat jurnal manual (Admin Umum)', 'Jurnal Umum', true
union all select 'jurnal.koreksi_manual', 'Jurnal Umum — koreksi atau batalkan jurnal manual (izin khusus; bawaan MATI, hari ini hanya Owner)', 'Jurnal Umum', true
union all select 'jurnal.lihat_semua_sumber', 'Jurnal Umum — lihat jurnal dari semua sumber (otomatis dari kasir, klinik, pembelian, dll.), bukan hanya yang manual', 'Jurnal Umum', true
on conflict (id) do nothing;
insert into role_settings_private.action_modules(id, module_id)
select a, 'buku-besar' from unnest(array['jurnal.lihat','jurnal.buat_manual','jurnal.koreksi_manual','jurnal.lihat_semua_sumber']) a
on conflict (id) do nothing;

-- Boleh/tidak untuk akun yang sedang masuk. OWNER selalu. Peran lain: perilaku lama (tombol ini tidak mengaturnya).
-- ADMIN_UMUM: lewat kebijakan Akses Grup (role_action_allowed: modul + daftar tindakan); koreksi = izin khusus, harus dicentang eksplisit.
create function public.jurnal_aksi_diizinkan(p_action text) returns boolean
language plpgsql security definer set search_path = '' as $f$
declare v_role public.user_role; v_grant boolean;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then return false; end if;
  if p_action is null or p_action not in ('jurnal.lihat','jurnal.buat_manual','jurnal.koreksi_manual','jurnal.lihat_semua_sumber') then return false; end if;
  select role into v_role from public.profiles where id = auth.uid() and is_active;
  if v_role is null then return false; end if;
  if v_role = 'OWNER' then return true; end if;
  if v_role <> 'ADMIN_UMUM' then
    return case p_action when 'jurnal.koreksi_manual' then false when 'jurnal.buat_manual' then (v_role = 'FINANCE' or v_role = 'ADMIN' /*umum*/) else true end;
  end if;
  if p_action = 'jurnal.koreksi_manual' then
    select exists(select 1 from role_settings_private.action_policies a where a.role = v_role and p_action = any(a.allowed)) into v_grant;
    if not v_grant then return false; end if;
  end if;
  return public.role_action_allowed(p_action);
end $f$;
revoke all on function public.jurnal_aksi_diizinkan(text) from public, anon, authenticated, service_role;

create function public.jurnal_izin() returns jsonb
language plpgsql security definer set search_path = '' as $f$
begin
  return jsonb_build_object('lihat', public.jurnal_aksi_diizinkan('jurnal.lihat'),
    'buat_manual', public.jurnal_aksi_diizinkan('jurnal.buat_manual'),
    'koreksi_manual', public.jurnal_aksi_diizinkan('jurnal.koreksi_manual'),
    'lihat_semua_sumber', public.jurnal_aksi_diizinkan('jurnal.lihat_semua_sumber'));
end $f$;
revoke all on function public.jurnal_izin() from public, anon, service_role;
grant execute on function public.jurnal_izin() to authenticated;
comment on function public.jurnal_izin() is 'Untuk layar Jurnal Umum: empat izin akun yang sedang masuk. Bukan otorisasi; database menegakkan lagi di create_manual_journal_atomic / revise_manual_journal.';

-- Penegakan di database: buat jurnal manual dan koreksi/batalkan.
-- Dipasang SESUDAH pemeriksaan modul Buku Besar yang lama, supaya pesan penolakan lama (Akses Buku Besar diperlukan) tetap yang pertama (sama seperti ADMIN).
select pg_temp.umum_patch('public.create_manual_journal_atomic(text,date,text,uuid,jsonb)',
  '''Akses Buku Besar diperlukan'' using errcode=''42501'';' || chr(10) || '  end if;',
  '''Akses Buku Besar diperlukan'' using errcode=''42501'';' || chr(10) || '  end if;' || chr(10) || '  if v_actor.role=''ADMIN_UMUM'' and not public.jurnal_aksi_diizinkan(''jurnal.buat_manual'') then raise exception ''Izin Buat jurnal manual belum diberikan untuk peran Admin Umum'' using errcode=''42501''; end if;');
select pg_temp.umum_patch('public.revise_manual_journal(text,uuid,integer,text,jsonb,jsonb,text)',
  'v_profile.role<>''OWNER'' then raise exception ''Hanya Super Admin yang bisa mengoreksi jurnal''',
  '(v_profile.role<>''OWNER'' and not public.jurnal_aksi_diizinkan(''jurnal.koreksi_manual'')) then raise exception ''Hanya Super Admin yang bisa mengoreksi jurnal''');

-- ───────────────────────── 5. Semua tempat yang menyebut ADMIN ─────────────────────────
do $apply$
declare n_fn int; n_pol int; n_skip int; n_sisa int;
begin
  select count(*) filter (where jenis = 'fungsi' and status = 'DIUBAH'), count(*) filter (where jenis = 'kebijakan' and status = 'DIUBAH'),
         count(*) filter (where status = 'DILEWATI_BUKAN_PEMILIK'), count(*) filter (where status = 'SISA_TAK_DIKENAL')
    into n_fn, n_pol, n_skip, n_sisa from admin_umum_private.terapkan_semua(false);
  raise notice 'admin_umum: % fungsi dan % kebijakan diubah; % dilewati (bukan pemilik); % sisa tak dikenal', n_fn, n_pol, n_skip, n_sisa;
end $apply$;

-- Baris epoch Akses Grup untuk peran baru (pemicu config_guard hanya mengizinkan jalur atomik; dimatikan sebentar di transaksi ini).
alter table role_settings_private.epochs disable trigger epoch_guard;
insert into role_settings_private.epochs(role, epoch) values ('ADMIN_UMUM', 0) on conflict (role) do nothing;
alter table role_settings_private.epochs enable trigger epoch_guard;

-- ───────────────────────── 6. Pagar Admin Online dijalankan ulang ─────────────────────────
-- (fungsi DEFINER baru jurnal_aksi_diizinkan/jurnal_izin mendapat penjaga deny_admin_online; tidak ada tabel baru)
select admin_online_private.fence_all();
select admin_online_private.guard_all();

-- ───────────────────────── 7. Pemeriksaan pasca-pasang (gagal tertutup) ─────────────────────────
do $check$
declare n int; r record;
begin
  select count(*) into n from admin_umum_private.terapkan_semua(true) where status in ('DIUBAH', 'SISA_TAK_DIKENAL');
  if n <> 0 then raise exception 'ADMIN_UMUM_CHECK: % objek masih perlu diubah / tak dikenal sesudah pemasangan', n; end if;
  if exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
             where s.nspname = 'public' and p.proname = 'is_admin' and p.prosrc !~ 'ADMIN_UMUM') then raise exception 'ADMIN_UMUM_CHECK: is_admin() belum memuat ADMIN_UMUM'; end if;
  if (select count(*) from role_settings_private.action_catalog where id like 'jurnal.%' and enforced) <> 4
     or (select count(*) from role_settings_private.action_modules where id like 'jurnal.%' and module_id = 'buku-besar') <> 4 then
    raise exception 'ADMIN_UMUM_CHECK: katalog tombol Jurnal Umum tidak lengkap'; end if;
  if not exists (select 1 from role_settings_private.epochs where role = 'ADMIN_UMUM') then raise exception 'ADMIN_UMUM_CHECK: epoch peran tidak ada'; end if;
  if (select count(*) from pg_trigger t where t.tgrelid = 'role_settings_private.epochs'::regclass and t.tgname = 'epoch_guard' and t.tgenabled = 'O') <> 1 then
    raise exception 'ADMIN_UMUM_CHECK: epoch_guard tidak menyala'; end if;
  if has_function_privilege('anon', 'public.jurnal_aksi_diizinkan(text)', 'execute') or has_function_privilege('authenticated', 'public.jurnal_aksi_diizinkan(text)', 'execute')
     or has_function_privilege('anon', 'public.jurnal_izin()', 'execute') or not has_function_privilege('authenticated', 'public.jurnal_izin()', 'execute')
     or has_function_privilege('authenticated', 'admin_umum_private.terapkan_semua(boolean)', 'execute')
     or has_function_privilege('anon', 'admin_umum_private.terapkan_semua(boolean)', 'execute')
     or has_function_privilege('authenticated', 'admin_umum_private.kembalikan_semua()', 'execute')
     or has_schema_privilege('authenticated', 'admin_umum_private', 'usage') or has_schema_privilege('anon', 'admin_umum_private', 'usage') then
    raise exception 'ADMIN_UMUM_CHECK: hak akses fungsi/skema baru salah'; end if;
  -- jurnal_izin dapat dipanggil `authenticated` -> wajib berpenjaga; jurnal_aksi_diizinkan hanya dipanggil fungsi DEFINER (tanpa hak EXECUTE bagi peran API).
  for r in select p.oid::regprocedure::text sig, p.prosrc, p.proconfig from pg_proc p where p.oid in ('public.jurnal_aksi_diizinkan(text)'::regprocedure, 'public.jurnal_izin()'::regprocedure) loop
    if r.sig like '%jurnal_izin%' and r.prosrc !~ 'admin_online_private\.deny_admin_online' then raise exception 'ADMIN_UMUM_CHECK: % tanpa penjaga Admin Online', r.sig; end if;
    if r.proconfig is distinct from array['search_path='''''] and r.proconfig is distinct from array['search_path=""'] then raise exception 'ADMIN_UMUM_CHECK: % search_path salah (%)', r.sig, r.proconfig; end if;
  end loop;
  if (select prosrc from pg_proc where oid = 'public.create_manual_journal_atomic(text,date,text,uuid,jsonb)'::regprocedure) !~ 'jurnal_aksi_diizinkan\(''jurnal\.buat_manual''\)'
     or (select prosrc from pg_proc where oid = 'public.revise_manual_journal(text,uuid,integer,text,jsonb,jsonb,text)'::regprocedure) !~ 'jurnal_aksi_diizinkan\(''jurnal\.koreksi_manual''\)' then
    raise exception 'ADMIN_UMUM_CHECK: penegak jurnal manual tidak terpasang'; end if;
end $check$;
