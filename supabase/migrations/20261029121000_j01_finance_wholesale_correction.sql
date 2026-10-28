-- J01 (keputusan pemilik 28 Okt 2026): koreksi faktur penjualan B2B/grosir yang sudah dibayar
-- boleh dilakukan OWNER dan FINANCE (sebelumnya hanya OWNER). Pembayaran yang sudah diterima
-- tetap tercatat; kelebihan bayar menjadi kredit pelanggan (perilaku correct_wholesale_invoice
-- yang sudah ada, tidak diubah). Struk kasir dan tagihan klinik tidak terdampak.
--
-- Satu-satunya perubahan: helper wholesale_access(p_branch, p_owner=true) yang hanya dipakai
-- jalur koreksi (correct_wholesale_invoice dan get_wholesale_operation kind='correction')
-- kini menerima OWNER atau FINANCE aktif. Jalur penerimaan (p_owner=false) tetap
-- OWNER/ADMIN/FINANCE. Cek cabang/modul (sales_assert_access) tidak berubah.
--
-- Hash guard: tubuh fungsi harus persis versi 20261021073000 (md5 prosrc
-- 6b15f97c64b813e269a7b2f3bfcbc8c1, sama dengan production per 28 Okt 2026) atau sudah versi J01.
-- Selain itu migrasi berhenti tanpa mengubah apa pun. Idempoten.
do $j01$
declare
  v_src text;
  v_old constant text := '6b15f97c64b813e269a7b2f3bfcbc8c1';
  v_new_body constant text := $body$
begin
 perform 1 from public.profiles where id=auth.uid() and is_active
  and (role in ('OWNER','FINANCE') or (not p_owner and role='ADMIN')) for share;
 if not found then raise exception 'Koreksi grosir hanya oleh OWNER/FINANCE; penerimaan oleh OWNER/ADMIN/FINANCE aktif' using errcode='42501';end if;
 perform public.sales_assert_access(p_branch);
 if p_branch is not null then
  perform 1 from public.branches where id=p_branch and is_active for share;
  if not found then raise exception 'Cabang grosir tidak aktif' using errcode='42501';end if;
 end if;
end$body$;
begin
  select prosrc into v_src from pg_proc where oid = to_regprocedure('public.wholesale_access(uuid,boolean)');
  if v_src is null then
    raise exception 'J01: public.wholesale_access(uuid,boolean) tidak ada; terapkan 20261021073000 dahulu';
  end if;
  if v_src = v_new_body then
    return;
  end if;
  if md5(v_src) <> v_old then
    raise exception 'J01: tubuh wholesale_access berbeda dari versi yang ditinjau (md5 %); periksa production sebelum apply', md5(v_src);
  end if;
  execute 'create or replace function public.wholesale_access(p_branch uuid,p_owner boolean default false) returns void'
    || ' language plpgsql security definer set search_path='''' as $fn$' || v_new_body || '$fn$';
  revoke all on function public.wholesale_access(uuid,boolean) from public,anon,authenticated,service_role;
end
$j01$;
