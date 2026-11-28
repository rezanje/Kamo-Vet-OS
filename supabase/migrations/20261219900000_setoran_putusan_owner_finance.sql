-- REKAP SETORAN — hanya OWNER dan FINANCE yang memutuskan (SETORAN-FINANCE-ONLY). Permintaan Mba Anisa (keuangan Kamo), disetujui Reza ('ikut Mba Anisa').
-- Apply as ONE transaction (file ini sengaja tanpa begin/commit sendiri). Hanya MEMBATASI hak: tidak ada akses baru; tidak ada data yang diubah.
--
-- Sebelumnya setoran_penyetuju() = OWNER, FINANCE, ADMIN, ADMIN_UMUM dipakai untuk dua hal berbeda: (a) MELIHAT (rekap, daftar, bagian keuangan di detail,
-- pintasan SO, kebijakan jurnal setoran) dan (b) MEMUTUSKAN (setujui / tolak setoran, konfirmasi / tolak transfer). Sekarang:
--   * setoran_penyetuju()  TIDAK diubah: tetap predikat BACA (Owner, Finance, Admin, Admin Umum) — hak baca Admin/Admin Umum persis seperti hari ini.
--   * setoran_pemutus()    BARU: hanya OWNER dan FINANCE aktif. Dipakai setoran_setujui, setoran_tolak, setoran_putuskan_transfer.
--   * setoran_akses() dan setoran_detail() mengirim kunci baru 'pemutus' supaya layar menyembunyikan tombol keputusan untuk Admin/Admin Umum.
--   * Pesan galat dan pesan peringatan: 'Owner atau Finance' (bukan 'Owner, Finance, atau Admin cabang').
-- Pemisahan tugas (pembuat/pengaju tidak menyetujui sendiri; pencatat tidak mengonfirmasi transfernya sendiri), akses cabang, periode terbuka, dan semua
-- aturan lain TIDAK diubah. Fungsi diganti lewat pg_get_functiondef + penggantian teks berjangkar (tiap jangkar harus tepat sekali; gagal tertutup),
-- sehingga ACL, pemilik, dan setelan fungsi tetap sama.
-- ROLLBACK: lihat ROLLBACK.sql di folder bukti (pulihkan definisi lama dari cadangan hosted + drop setoran_pemutus).
set local lock_timeout = '5s';

-- ───────────────────────── 0. Pagar prasyarat (gagal tertutup) ─────────────────────────
do $guard$
begin
  if to_regprocedure('public.setoran_penyetuju()') is null or to_regprocedure('public.setoran_role()') is null
     or to_regprocedure('public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)') is null
     or to_regprocedure('public.setoran_tolak(uuid,text,uuid)') is null
     or to_regprocedure('public.setoran_putuskan_transfer(uuid,uuid,boolean,text,uuid)') is null
     or to_regprocedure('public.setoran_detail(uuid)') is null or to_regprocedure('public.setoran_akses()') is null
     or to_regprocedure('public.setoran_peringatan(uuid,uuid)') is null then
    raise exception 'SETORAN_PEMUTUS_PRECONDITION: fungsi setoran belum ada; periksa urutan migrasi';
  end if;
  if to_regprocedure('public.setoran_pemutus()') is not null then
    raise exception 'SETORAN_PEMUTUS_PRECONDITION: perubahan sudah terpasang';
  end if;
  if pg_get_functiondef('public.setoran_penyetuju()'::regprocedure) !~ 'OWNER.,.FINANCE.,.ADMIN.,.ADMIN_UMUM' then
    raise exception 'SETORAN_PEMUTUS_PRECONDITION: setoran_penyetuju() bukan versi yang diharapkan';
  end if;
end $guard$;

-- ───────────────────────── 1. Predikat keputusan baru: hanya OWNER dan FINANCE ─────────────────────────
create function public.setoran_pemutus()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.setoran_role() in ('OWNER','FINANCE'), false) $$;
revoke all on function public.setoran_pemutus() from public, anon, authenticated, service_role;
comment on function public.setoran_pemutus() is 'Siapa yang boleh MEMUTUSKAN setoran (setujui/tolak) dan transfer (konfirmasi/tolak): hanya OWNER dan FINANCE aktif. Hak BACA tetap setoran_penyetuju().';

-- ───────────────────────── 2. Ganti gerbang keputusan + pesan (penggantian berjangkar, tepat sekali per jangkar) ─────────────────────────
do $ganti$
declare
  v_spec jsonb := $spec$[
    {"sig":"public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)","rep":[
      ["if not public.setoran_penyetuju() then","if not public.setoran_pemutus() then"],
      ["SETORAN_DITOLAK_PERAN: hanya Owner, Finance, atau Admin cabang yang dapat menyetujui setoran.","SETORAN_DITOLAK_PERAN: hanya Owner atau Finance yang dapat menyetujui setoran."],
      ["Minta Owner/Finance/Admin lain yang menyetujui.","Minta Owner atau Finance lain yang menyetujui."]]},
    {"sig":"public.setoran_tolak(uuid,text,uuid)","rep":[
      ["if not public.setoran_penyetuju() then","if not public.setoran_pemutus() then"],
      ["SETORAN_DITOLAK_PERAN: hanya Owner, Finance, atau Admin cabang yang dapat menolak setoran.","SETORAN_DITOLAK_PERAN: hanya Owner atau Finance yang dapat menolak setoran."]]},
    {"sig":"public.setoran_putuskan_transfer(uuid,uuid,boolean,text,uuid)","rep":[
      ["if not public.setoran_penyetuju() then","if not public.setoran_pemutus() then"],
      ["SETORAN_DITOLAK_PERAN: hanya Owner, Finance, atau Admin cabang yang dapat mengonfirmasi transfer.","SETORAN_DITOLAK_PERAN: hanya Owner atau Finance yang dapat mengonfirmasi transfer."]]},
    {"sig":"public.setoran_peringatan(uuid,uuid)","rep":[
      ["Minta Owner/Finance/Admin lain.","Minta Owner atau Finance lain."]]},
    {"sig":"public.setoran_detail(uuid)","rep":[
      ["'penyetuju', v_app,","'penyetuju', v_app, 'pemutus', public.setoran_pemutus(),"]]},
    {"sig":"public.setoran_akses()","rep":[
      ["jsonb_build_object('masuk', false, 'penyetuju', false, 'void', false)","jsonb_build_object('masuk', false, 'penyetuju', false, 'pemutus', false, 'void', false)"],
      ["'penyetuju', public.setoran_penyetuju(), 'void'","'penyetuju', public.setoran_penyetuju(), 'pemutus', public.setoran_pemutus(), 'void'"]]}
  ]$spec$;
  v_f jsonb; v_r jsonb; v_def text; v_new text; v_n integer; v_oid oid;
begin
  for v_f in select * from jsonb_array_elements(v_spec) loop
    v_oid := (v_f ->> 'sig')::regprocedure;
    v_def := pg_get_functiondef(v_oid); v_new := v_def;
    for v_r in select * from jsonb_array_elements(v_f -> 'rep') loop
      v_n := (length(v_new) - length(replace(v_new, v_r ->> 0, ''))) / length(v_r ->> 0);
      if v_n <> 1 then
        raise exception 'SETORAN_PEMUTUS_ANCHOR: % jangkar "%" ditemukan % kali (harus 1)', v_f ->> 'sig', v_r ->> 0, v_n;
      end if;
      v_new := replace(v_new, v_r ->> 0, v_r ->> 1);
    end loop;
    if v_new = v_def then raise exception 'SETORAN_PEMUTUS_ANCHOR: % tidak berubah', v_f ->> 'sig'; end if;
    execute v_new;
  end loop;
end $ganti$;

-- ───────────────────────── 3. Pemeriksaan sesudah pasang (gagal tertutup) ─────────────────────────
do $check$
declare v_def text; f text; v_acl text;
begin
  foreach f in array array['public.setoran_setujui(uuid,uuid,text,jsonb,boolean,boolean,text)', 'public.setoran_tolak(uuid,text,uuid)', 'public.setoran_putuskan_transfer(uuid,uuid,boolean,text,uuid)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    if position('setoran_pemutus()' in v_def) = 0 or position('setoran_penyetuju()' in v_def) > 0 or position('Admin cabang' in v_def) > 0
       or v_def !~ 'admin_online_private\.deny_admin_online' or not exists (select 1 from pg_proc p where p.oid = f::regprocedure and p.prosecdef) then
      raise exception 'SETORAN_PEMUTUS_CHECK: % belum memakai setoran_pemutus() saja', f; end if;
  end loop;
  -- fungsi BACA tetap memakai setoran_penyetuju()
  foreach f in array array['public.setoran_daftar(date,date,uuid,text,uuid)', 'public.setoran_rekap(date,date,uuid,text,uuid)', 'public.setoran_so_terakhir(uuid)', 'public.setoran_jurnal_boleh()', 'public.setoran_detail(uuid)', 'public.setoran_akses()'] loop
    if position('setoran_penyetuju()' in pg_get_functiondef(f::regprocedure)) = 0 then raise exception 'SETORAN_PEMUTUS_CHECK: % kehilangan predikat baca', f; end if;
  end loop;
  if pg_get_functiondef('public.setoran_penyetuju()'::regprocedure) !~ 'OWNER.,.FINANCE.,.ADMIN.,.ADMIN_UMUM' then raise exception 'SETORAN_PEMUTUS_CHECK: setoran_penyetuju() berubah'; end if;
  if position('''pemutus''' in pg_get_functiondef('public.setoran_detail(uuid)'::regprocedure)) = 0 or position('''pemutus''' in pg_get_functiondef('public.setoran_akses()'::regprocedure)) = 0 then
    raise exception 'SETORAN_PEMUTUS_CHECK: kunci pemutus belum dikirim'; end if;
  select p.proacl::text into v_acl from pg_proc p where p.oid = 'public.setoran_pemutus()'::regprocedure;
  if has_function_privilege('anon', 'public.setoran_pemutus()', 'execute') or has_function_privilege('authenticated', 'public.setoran_pemutus()', 'execute')
     or has_function_privilege('service_role', 'public.setoran_pemutus()', 'execute') or v_acl is distinct from (select p.proacl::text from pg_proc p where p.oid = 'public.setoran_penyetuju()'::regprocedure) then
    raise exception 'SETORAN_PEMUTUS_CHECK: ACL setoran_pemutus() harus sama dengan setoran_penyetuju() (hanya pemilik)'; end if;
  if pg_get_functiondef('public.setoran_pemutus()'::regprocedure) !~ 'OWNER.,.FINANCE' or pg_get_functiondef('public.setoran_pemutus()'::regprocedure) ~ 'ADMIN' then
    raise exception 'SETORAN_PEMUTUS_CHECK: setoran_pemutus() harus hanya OWNER dan FINANCE'; end if;
end $check$;
