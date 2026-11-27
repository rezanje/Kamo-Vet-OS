-- Pembelian: bayar hutang usaha dari rekening kas/bank MANA PUN yang aktif, tanpa melihat cabang rekening.
-- Sebelumnya purchase_payment_scope menolak rekening milik cabang lain (mis. 'Kas Toko CMGG' untuk faktur DC)
-- dengan 'Rekening pembayaran tidak aktif atau tidak sesuai cabang'. Hanya fungsi ini yang berubah.
-- Tetap berlaku: peran/akses pembelian (purchase_payment_access), cabang pembayaran aktif dan bisa diakses,
-- rekening harus ada dan aktif, akun COA rekening aktif/bukan header/bertipe ASET.
-- Jurnal tetap ke cabang faktur; kredit ke kode COA rekening yang dipilih (tidak diubah).
create or replace function public.purchase_payment_scope(p_branch uuid, p_account uuid default null::uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare bank public.cash_accounts%rowtype;begin
 perform public.purchase_payment_access(p_branch);
 perform 1 from public.branches where id=p_branch and is_active for share;
 if not public.user_can_access_branch(p_branch) or (p_branch is not null and not found) then raise exception 'Cabang pembayaran tidak dapat diakses' using errcode='42501';end if;
 if p_account is not null then
  select * into bank from public.cash_accounts where id=p_account for share;
  if not found or not bank.is_active then raise exception 'Rekening pembayaran tidak aktif atau tidak ditemukan' using errcode='42501';end if;
  perform 1 from public.coa_accounts where code=bank.coa_code and is_active and not is_header and type='ASET' for share;
  if not found then raise exception 'Akun kas pembayaran tidak aktif atau bukan akun rincian aset';end if;
 end if;
 perform public.purchase_payment_access(p_branch);
end$function$;
revoke all on function public.purchase_payment_scope(uuid,uuid) from public,anon,authenticated,service_role;

do $check$
declare src text:=pg_get_functiondef('public.purchase_payment_scope(uuid,uuid)'::regprocedure);
begin
 if src ~* 'bank\.branch_id' or src ~ 'tidak sesuai cabang' then raise exception 'purchase_payment_scope masih membatasi rekening per cabang';end if;
 if src !~ 'purchase_payment_access' or src !~ 'user_can_access_branch\(p_branch\)' or src !~ 'not bank\.is_active'
    or src !~ 'not is_header and type=''ASET''' or src !~ 'tidak ditemukan' then raise exception 'purchase_payment_scope kehilangan pengaman yang harus tetap ada';end if;
 if has_function_privilege('authenticated','public.purchase_payment_scope(uuid,uuid)','execute') then raise exception 'purchase_payment_scope tidak boleh dapat dipanggil langsung';end if;
end$check$;
