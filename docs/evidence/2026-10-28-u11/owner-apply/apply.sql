-- U11 APPLY — WRITES. Satu transaksi: isi migrasi 20261028131000_u11_owner_create_branch.sql apa adanya (sha256 a8800bd18da41a3dfd7e9f6b5c3d306bccba822281e6d452bfbf57a4064e1f8e) + baris riwayat.
-- Galat apa pun (termasuk tunggu kunci > 5 dtk, duplikat kode beda huruf besar/kecil, atau bukan role postgres)
-- membatalkan semuanya.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$ begin
  if current_user <> 'postgres' then
    raise exception 'U11 apply must run as postgres (current role: %); nothing was applied', current_user;
  end if;
end $$;

-- U11 (keputusan default 28 Okt 2026): hanya OWNER boleh membuat cabang baru
-- (kode, nama, jenis, status aktif). Cabang baru langsung bisa dipilih di form gudang.
--
-- Tabel branches sejak 0002 tidak punya policy INSERT, jadi akun aplikasi tidak bisa
-- menambah cabang sama sekali. Jalan satu-satunya sekarang adalah RPC ini: SECURITY
-- DEFINER dengan cek OWNER aktif di database, bukan hanya di layar. Tidak ada policy
-- INSERT yang dibuka, sehingga insert langsung lewat REST tetap ditolak untuk semua peran.
-- Idempoten: create or replace dengan tanda tangan tetap.

-- Kode cabang unik tanpa membedakan huruf besar/kecil ("pdry" = "PDRY"), juga untuk jalur
-- penulisan lain. Preflight owner memastikan production belum punya duplikat seperti itu.
create unique index if not exists branches_code_lower_key on public.branches (lower(code));

create or replace function public.create_branch(p_code text, p_name text, p_type text, p_is_active boolean)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  r public.branches%rowtype;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='OWNER' and p.is_active) then
    raise exception 'Hanya Super Admin (OWNER) aktif yang dapat membuat cabang' using errcode='42501';
  end if;
  if v_code !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,14}$' then
    raise exception 'Kode cabang 1 sampai 15 karakter: huruf, angka, spasi, titik, garis bawah, atau tanda minus' using errcode='22023';
  end if;
  if length(v_name) not between 2 and 100 or v_name ~ '[[:cntrl:]]' then
    raise exception 'Nama cabang 2 sampai 100 karakter' using errcode='22023';
  end if;
  if p_type is null or p_type not in ('PETSHOP','KLINIK','BOTH','DC','ONLINE','OFFICE') then
    raise exception 'Jenis cabang tidak dikenal' using errcode='22023';
  end if;
  if p_is_active is null then
    raise exception 'Status aktif cabang wajib dipilih' using errcode='22023';
  end if;
  -- Kode unik tanpa membedakan huruf besar/kecil, agar "pdry" tidak menduplikasi "PDRY".
  if exists(select 1 from public.branches b where lower(b.code)=lower(v_code)) then
    raise exception 'Kode cabang sudah dipakai' using errcode='23505';
  end if;
  insert into public.branches(code, name, type, is_active)
    values (v_code, v_name, p_type::public.branch_type, p_is_active)
    returning * into r;
  return jsonb_build_object('id', r.id, 'code', r.code, 'name', r.name, 'type', r.type, 'is_active', r.is_active);
end$$;
revoke all on function public.create_branch(text,text,text,boolean) from public,anon,service_role;
grant execute on function public.create_branch(text,text,text,boolean) to authenticated;

insert into supabase_migrations.schema_migrations(version, name) values ('20261028131000', 'u11_owner_create_branch') on conflict (version) do nothing;
commit;
