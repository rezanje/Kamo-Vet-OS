-- Percepatan pengecekan akses cabang (public.user_can_access_branch) — perilaku TIDAK berubah.
-- Versi riwayat Production: 20261031082216 (dipasang 31 Okt 2026 lewat Management API). Teks fungsi masih
-- menyebut 20261105010000 = nomor draf; sengaja tidak diubah agar isi repo = isi Production.
--
-- Masalah (Production 31 Okt 2026): setelah ~3.800 riwayat kartu medis lama masuk, Klinik > Rekam medis
-- menampilkan "Rekam medis belum dapat dimuat lengkap". Satu halaman daftar (500 baris) butuh ~9,6 detik,
-- sedangkan batas waktu query role `authenticated` = 8 detik, jadi semua halaman dibatalkan server.
--
-- Penyebab: user_can_access_branch dipanggil per baris oleh 99 kebijakan RLS (visits, medical_records, dst. —
-- kebijakan medical_records memeriksa visits induknya lagi, jadi satu baris rekam medis = ~5 panggilan).
-- Di dalamnya ada panggilan fungsi SQL SECURITY DEFINER bersarang public.has_role_capability('all_branches').
-- Fungsi SQL non-inline yang dipanggil dari dalam query fungsi lain direncanakan ulang (plan) di SETIAP
-- panggilan: terukur ~250 µs per panggilan (10.000 panggilan = 2,5 detik) versus ~33 µs bila logika
-- has_role_capability('all_branches') ditulis langsung di sini (10.000 panggilan = 0,33 detik).
-- Simulasi query daftar rekam medis di Production (baca-saja, transaksi dibatalkan): 8,8 detik -> 0,95 detik.
--
-- Perubahan: hanya isi fungsi. Cabang "all_branches" dari has_role_capability ditulis di tempat
-- (role OWNER, atau role_capabilities.all_branches, atau bawaan ADMIN/FINANCE) untuk profil aktif yang sama.
-- Tanda tangan, SECURITY DEFINER, STABLE, search_path='', pemilik, dan hak EXECUTE tetap (CREATE OR REPLACE).
-- Kebijakan RLS tidak disentuh. Kesetaraan perilaku dibuktikan di scripts/test-akses-cabang-cepat-postgres.py.
--
-- PENTING: bila logika has_role_capability('all_branches') berubah kelak, fungsi ini wajib ikut diubah.
-- Pra-cek di bawah mengunci definisi has_role_capability yang direview (gagal tertutup bila berbeda).

do $pra$
declare
  v_akses text := md5((select prosrc from pg_proc where oid = to_regprocedure('public.user_can_access_branch(uuid)')));
  v_kapabilitas text := md5((select prosrc from pg_proc where oid = to_regprocedure('public.has_role_capability(text)')));
begin
  if to_regprocedure('public.user_can_access_branch(uuid)') is null
     or to_regprocedure('public.has_role_capability(text)') is null
     or to_regclass('public.role_capabilities') is null then
    raise exception 'AKSES_CABANG_CEPAT: prasyarat tidak lengkap';
  end if;
  -- has_role_capability harus versi yang direview (20261017090000), karena logikanya disalin ke sini.
  if v_kapabilitas is distinct from 'c5f1cee77a8984555bfcafaacb7b226e' then
    raise exception 'AKSES_CABANG_CEPAT: definisi has_role_capability berbeda dari yang direview (%)', v_kapabilitas;
  end if;
  -- Hanya menimpa versi lama yang direview (20261017090000); versi ini sendiri diterima agar idempoten.
  if v_akses is distinct from '732c83442a975e7725c94de592e2b836'
     and position('akses_cabang_cepat' in (select prosrc from pg_proc where oid = 'public.user_can_access_branch(uuid)'::regprocedure)) = 0 then
    raise exception 'AKSES_CABANG_CEPAT: definisi user_can_access_branch berbeda dari yang direview (%)', v_akses;
  end if;
end $pra$;

create or replace function public.user_can_access_branch(b uuid)
returns boolean language plpgsql security definer stable set search_path='' as $$
-- akses_cabang_cepat (20261105010000): logika kapabilitas 'all_branches' ditulis di tempat, tanpa panggilan
-- fungsi bersarang, supaya pengecekan RLS per baris tidak direncanakan ulang tiap panggilan.
declare v_selected text;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p left join public.role_capabilities c on c.role=p.role
   where p.id=auth.uid() and p.is_active
   and (p.role='OWNER' or coalesce(c.all_branches,p.role in ('ADMIN','FINANCE'))
        or exists(select 1 from public.user_branches u where u.user_id=p.id and u.branch_id=b))) then return false; end if;
 v_selected := nullif(nullif(current_setting('request.headers',true),'')::jsonb->>'x-kamo-operational-branch','');
 if v_selected is not null then
   if v_selected<>b::text or not exists(select 1 from public.branches where id=b and is_active) then return false; end if;
 end if;
 return true;
end $$;

do $pasca$
declare v_fn record;
begin
  select p.prosecdef, p.provolatile, p.proconfig, p.prosrc into v_fn
    from pg_proc p where p.oid = 'public.user_can_access_branch(uuid)'::regprocedure;
  if not v_fn.prosecdef or v_fn.provolatile <> 's' or v_fn.proconfig is distinct from array['search_path=""']
     or position('has_role_capability' in v_fn.prosrc) > 0 or position('akses_cabang_cepat' in v_fn.prosrc) = 0 then
    raise exception 'AKSES_CABANG_CEPAT: pasca-cek gagal';
  end if;
  if has_function_privilege('anon', 'public.user_can_access_branch(uuid)', 'execute') then
    raise exception 'AKSES_CABANG_CEPAT: anon tidak boleh mendapat EXECUTE';
  end if;
end $pasca$;
