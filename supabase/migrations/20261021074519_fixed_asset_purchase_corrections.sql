-- Acquisition corrections only. Historical depreciation has aggregate journals
-- without asset allocations; it must be reconciled by finance, never guessed.
alter table public.fixed_assets add column correction_revision integer not null default 0;
create table public.fixed_asset_corrections (
 id uuid primary key default gen_random_uuid(),
 asset_id uuid not null references public.fixed_assets(id),
 actor_id uuid not null references public.profiles(id),
 request_key text not null check(length(request_key) between 1 and 120),
 payload jsonb not null, reason text not null check(length(btrim(reason)) between 3 and 1000),
 before_value jsonb not null, after_value jsonb not null,
 original_journal_id uuid not null references public.journal_entries(id),
 reversal_journal_id uuid not null unique references public.journal_entries(id),
 replacement_journal_id uuid not null unique references public.journal_entries(id),
 result jsonb not null, created_at timestamptz not null default clock_timestamp(),
 unique(actor_id,request_key)
);
create index fixed_asset_corrections_asset on public.fixed_asset_corrections(asset_id);
alter table public.fixed_asset_corrections enable row level security;
revoke all on public.fixed_asset_corrections from public,anon,authenticated,service_role;
grant select on public.fixed_asset_corrections to authenticated;
create policy fixed_asset_corrections_read on public.fixed_asset_corrections for select to authenticated using (
 exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.role='OWNER')
 and exists(select 1 from public.fixed_assets a where a.id=asset_id and
  ((a.branch_id is not null and public.user_can_access_branch(a.branch_id)) or
   (a.branch_id is null and public.has_role_capability('all_branches') and nullif(nullif(current_setting('request.headers',true),'')::jsonb->>'x-kamo-operational-branch','') is null)))
);

create function public.fixed_asset_correction_access(p_branch uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Login diperlukan' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and is_active and role='OWNER' for share;
 if not found then raise exception 'Koreksi aset memerlukan Super Admin / OWNER aktif' using errcode='42501';end if;
 if p_branch is null then
  if not public.has_role_capability('all_branches') or nullif(nullif(current_setting('request.headers',true),'')::jsonb->>'x-kamo-operational-branch','') is not null then
   raise exception 'Aset global memerlukan konteks seluruh cabang' using errcode='42501';end if;
 else
  perform 1 from public.branches where id=p_branch and is_active for share;
  if not found or not public.user_can_access_branch(p_branch) then raise exception 'Cabang aset tidak dapat diakses atau tidak aktif' using errcode='42501';end if;
 end if;
end$$;
revoke all on function public.fixed_asset_correction_access(uuid) from public,anon,authenticated,service_role;

-- Callers cannot use a request GUC to masquerade as an official financial RPC.
create function public.guard_fixed_asset_acquisition() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_op='DELETE' or new.harga_perolehan is distinct from old.harga_perolehan
   or new.tanggal_perolehan is distinct from old.tanggal_perolehan
   or new.correction_revision is distinct from old.correction_revision then
   raise exception 'Gunakan jalur koreksi aset resmi; riwayat pembelian harus dipertahankan' using errcode='42501';
  end if;
 end if;
 if tg_op='UPDATE' then new.correction_revision:=old.correction_revision+1;end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_fixed_asset_acquisition() from public,anon,authenticated,service_role;
create trigger fixed_asset_acquisition_guard before update or delete on public.fixed_assets for each row execute function public.guard_fixed_asset_acquisition();

create function public.guard_fixed_asset_purchase_journal() returns trigger
language plpgsql set search_path='' as $$
declare protected boolean;begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then
   protected:=new.source in ('asset-purchase','asset-purchase-reversal','asset-purchase-fix') or old.source in ('asset-purchase','asset-purchase-reversal','asset-purchase-fix');
  else
   select exists(select 1 from public.journal_entries where id in(new.entry_id,old.entry_id) and source in ('asset-purchase','asset-purchase-reversal','asset-purchase-fix')) into protected;
  end if;
  if protected then raise exception 'Gunakan jalur aset resmi untuk jurnal pembelian' using errcode='42501';end if;
 end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_fixed_asset_purchase_journal() from public,anon,authenticated,service_role;
create trigger fixed_asset_purchase_journal_guard before insert or update or delete on public.journal_entries for each row execute function public.guard_fixed_asset_purchase_journal();
create trigger fixed_asset_purchase_lines_guard before insert or update or delete on public.journal_lines for each row execute function public.guard_fixed_asset_purchase_journal();

-- Dependency writers and corrections serialize on the parent asset. Depreciation
-- reads happen in the app before INSERT: validate its computed amount again here.
create function public.guard_asset_correction_dependency() returns trigger
language plpgsql set search_path='' as $$
declare a public.fixed_assets%rowtype; elapsed integer; accumulated numeric;expected numeric;begin
 if tg_op<>'INSERT' and current_user in ('authenticated','anon','service_role') then
  raise exception 'Riwayat dependensi aset tidak boleh ditimpa; perlu koreksi resmi' using errcode='42501';end if;
 perform 1 from public.fixed_assets where id in(new.asset_id,old.asset_id) order by id for update;
 if tg_op='INSERT' then
  select * into a from public.fixed_assets where id=new.asset_id;
  if a.correction_revision>0 then
   if tg_table_name='asset_disposals' then
    select coalesce(sum(amount),0) into accumulated from public.asset_depreciations where asset_id=a.id;
    if new.harga_perolehan is distinct from a.harga_perolehan or new.akumulasi is distinct from least(a.harga_perolehan,accumulated) then raise exception 'Aset berubah; hitung ulang pelepasan';end if;
   elsif tg_table_name='asset_changes' then
    if new.jenis='nilai' and new.nilai_lama is distinct from a.harga_perolehan or new.jenis='umur' and new.umur_lama is distinct from a.umur_bulan then raise exception 'Aset berubah; hitung ulang perubahan';end if;
   elsif tg_table_name='asset_transfers' then
    if new.dari_branch_id is distinct from a.branch_id then raise exception 'Aset berubah; periksa cabang asal';end if;
   end if;
  end if;
 end if;
 if tg_table_name='asset_depreciations' and tg_op<>'DELETE' then
  select * into a from public.fixed_assets where id=new.asset_id;
  if a.correction_revision>0 then
   if new.periode !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Periode penyusutan tidak valid';end if;
   elapsed:=(substring(new.periode,1,4)::int-extract(year from a.tanggal_perolehan)::int)*12+substring(new.periode,6,2)::int-extract(month from a.tanggal_perolehan)::int+1;
   select coalesce(sum(amount),0) into accumulated from public.asset_depreciations where asset_id=a.id and id<>new.id;
   expected:=least(round((a.harga_perolehan-a.nilai_sisa)/nullif(a.umur_bulan,0)),greatest(0,a.harga_perolehan-a.nilai_sisa-accumulated));
   if not a.is_active or a.status<>'aktif' or elapsed<1 or elapsed>a.umur_bulan or new.amount is distinct from expected or expected<=0 then
    raise exception 'Aset berubah; hitung ulang penyusutan sebelum menyimpan';end if;
  end if;
 end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_asset_correction_dependency() from public,anon,authenticated,service_role;
create trigger asset_correction_dep_guard before insert or update or delete on public.asset_depreciations for each row execute function public.guard_asset_correction_dependency();
create trigger asset_correction_change_guard before insert or update or delete on public.asset_changes for each row execute function public.guard_asset_correction_dependency();
create trigger asset_correction_disposal_guard before insert or update or delete on public.asset_disposals for each row execute function public.guard_asset_correction_dependency();
create trigger asset_correction_transfer_guard before insert or update or delete on public.asset_transfers for each row execute function public.guard_asset_correction_dependency();

-- No writes; used by preview and re-evaluated in the committing transaction.
create function public.fixed_asset_correction_plan(p_asset_id uuid,p_expected_revision integer,p_tanggal date,p_harga numeric,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.fixed_assets%rowtype; j public.journal_entries%rowtype;c public.fixed_asset_corrections%rowtype;
 purchase jsonb; baseline jsonb; problems jsonb:='[]';closed date;asset_account uuid;cash public.cash_accounts%rowtype;cash_account uuid;n integer;
begin
 select * into a from public.fixed_assets where id=p_asset_id for update;
 if not found then raise exception 'Aset tidak ditemukan';end if;
 perform public.fixed_asset_correction_access(a.branch_id);
 if p_expected_revision is null or p_expected_revision<>a.correction_revision then problems:=problems||jsonb_build_array('Aset sudah berubah; muat ulang sebelum koreksi');end if;
 if p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then problems:=problems||jsonb_build_array('Alasan koreksi wajib diisi 3–1000 karakter');end if;
 if p_tanggal is null or not isfinite(p_tanggal) or p_tanggal>(now() at time zone 'Asia/Jakarta')::date
  or not isfinite(a.tanggal_perolehan) or a.tanggal_perolehan>(now() at time zone 'Asia/Jakarta')::date then
  problems:=problems||jsonb_build_array('Tanggal pembelian harus sah dan tidak di masa depan');end if;
 if p_harga is null or p_harga::text in ('NaN','Infinity','-Infinity') or p_harga<=0 or p_harga>1e15
  or a.harga_perolehan::text in ('NaN','Infinity','-Infinity') or a.harga_perolehan<=0 or a.harga_perolehan>1e15
  or a.nilai_sisa::text in ('NaN','Infinity','-Infinity') or a.nilai_sisa<0 or a.nilai_sisa>=p_harga or a.umur_bulan<=0 then
  problems:=problems||jsonb_build_array('Nominal tidak valid atau lebih kecil dari nilai sisa; kebijakan nilai sisa/umur tidak diubah otomatis');end if;
 if p_tanggal=a.tanggal_perolehan and p_harga=a.harga_perolehan then problems:=problems||jsonb_build_array('Nominal dan tanggal belum berubah');end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if closed is not null and (a.tanggal_perolehan<=closed or p_tanggal<=closed) then
  problems:=problems||jsonb_build_array('Periode pembelian asal atau pengganti sudah ditutup. Minta Finance menyiapkan koreksi periode terbuka yang disetujui; riwayat terkunci tidak ditimpa');end if;
 if a.status<>'aktif' or not a.is_active or exists(select 1 from public.asset_disposals where asset_id=a.id) then
  problems:=problems||jsonb_build_array('Aset sudah dilepas/nonaktif; Finance perlu memeriksa dan membalik pelepasan terlebih dahulu');end if;
 if exists(select 1 from public.asset_depreciations where asset_id=a.id) then
  problems:=problems||jsonb_build_array('Sudah ada penyusutan. Jurnal gabungan belum tertaut per aset; Finance perlu merekonsiliasi penyusutan dan menyetujui perlakuan koreksinya');end if;
 if least(a.tanggal_perolehan,p_tanggal)<date_trunc('month',now() at time zone 'Asia/Jakarta')::date then
  problems:=problems||jsonb_build_array('Tanggal mencakup bulan selesai; Finance perlu memeriksa penyusutan historis dan menyetujui penyesuaiannya sebelum koreksi');end if;
 if exists(select 1 from public.asset_changes where asset_id=a.id) or exists(select 1 from public.asset_transfers where asset_id=a.id) then
  problems:=problems||jsonb_build_array('Ada perubahan nilai/umur atau perpindahan aset; cocokkan riwayat dan jurnal terkait bersama Finance sebelum koreksi');end if;
 select count(*) into n from public.purchase_operations where kind='asset' and result->>'asset_id'=a.id::text;
 if n<>1 then problems:=problems||jsonb_build_array('Pembelian lama/saldo awal belum punya bukti pembayaran dan tautan jurnal yang pasti; perlu pencocokan Finance');
 else
  select payload into purchase from public.purchase_operations where kind='asset' and result->>'asset_id'=a.id::text;
  if purchase->>'funding' not in ('Bank','Tunai') or purchase->>'funding' is null then
   problems:=problems||jsonb_build_array('Sumber pembayaran tidak pasti; cocokkan pelunasan/utang sebelum koreksi');end if;
  select * into c from public.fixed_asset_corrections where asset_id=a.id order by (after_value->>'correction_revision')::integer desc limit 1;
  if found then
   select * into j from public.journal_entries where id=c.replacement_journal_id;
   baseline:=c.after_value;
   if j.source is distinct from 'asset-purchase-fix' or j.source_ref is distinct from c.id::text then problems:=problems||jsonb_build_array('Tautan jurnal koreksi sebelumnya tidak sesuai');end if;
  else
   select count(*) into n from public.journal_entries where source='asset-purchase' and source_ref=a.id::text;
   if n=1 then select * into j from public.journal_entries where source='asset-purchase' and source_ref=a.id::text;end if;
   baseline:=jsonb_build_object('harga_perolehan',purchase->'harga','tanggal_perolehan',purchase->'tanggal','umur_bulan',purchase->'umur_bulan','nilai_sisa',purchase->'nilai_sisa','category_id',purchase->'category_id','branch_id',purchase->'branch_id');
  end if;
  if j.id is null or j.tanggal is distinct from a.tanggal_perolehan or j.branch_id is distinct from a.branch_id
   or baseline->'harga_perolehan' is distinct from to_jsonb(a.harga_perolehan) or baseline->>'tanggal_perolehan' is distinct from a.tanggal_perolehan::text
   or baseline->'umur_bulan' is distinct from to_jsonb(a.umur_bulan) or baseline->'nilai_sisa' is distinct from to_jsonb(a.nilai_sisa)
   or baseline->>'category_id' is distinct from a.category_id::text or baseline->>'branch_id' is distinct from a.branch_id::text then
   problems:=problems||jsonb_build_array('Nilai aset tidak cocok dengan bukti pembelian/jurnal; perlu pencocokan Finance');end if;
  select count(*) into n from public.cash_accounts where coa_code=purchase->>'credit_code';
  if n=1 then select * into cash from public.cash_accounts where coa_code=purchase->>'credit_code' for share;end if;
  if cash.id is null or not cash.is_active or cash.branch_id is not null and cash.branch_id is distinct from a.branch_id then
   problems:=problems||jsonb_build_array('Rekening pembayaran asal tidak aktif, ganda, atau tidak sesuai cabang');end if;
  perform 1 from public.coa_accounts where code in ('1501',purchase->>'credit_code') order by id for share;
  select id into asset_account from public.coa_accounts where code='1501' and is_active and not is_header;
  select id into cash_account from public.coa_accounts where code=purchase->>'credit_code' and is_active and not is_header and type='ASET';
  if asset_account is null or cash_account is null or asset_account=cash_account then problems:=problems||jsonb_build_array('Akun aset/rekening pembukuan harus aktif dan terpisah');end if;
  if j.id is not null and ((select count(*) from public.journal_lines where entry_id=j.id)<>2
   or not exists(select 1 from public.journal_lines where entry_id=j.id and account_id=asset_account and debit=a.harga_perolehan and credit=0)
   or not exists(select 1 from public.journal_lines where entry_id=j.id and account_id=cash_account and credit=a.harga_perolehan and debit=0)) then
   problems:=problems||jsonb_build_array('Baris jurnal pembayaran tidak cocok; perlu pencocokan Finance');end if;
  if exists(select 1 from public.bank_reconciliations r where r.voided_at is null and r.tanggal>=least(a.tanggal_perolehan,p_tanggal)
   and (r.cash_account_id=cash.id or r.bank_coa_code=purchase->>'credit_code' or r.cash_account_id is null and r.bank_coa_code is null)) then
   problems:=problems||jsonb_build_array('Rekonsiliasi bank terdampak; Finance perlu membatalkan/mencocokkan rekonsiliasi lebih dahulu');end if;
 end if;
 return jsonb_build_object('allowed',jsonb_array_length(problems)=0,'blockers',problems,'revision',a.correction_revision,
  'harga_before',a.harga_perolehan,'harga_after',p_harga,'tanggal_before',a.tanggal_perolehan,'tanggal_after',p_tanggal,
  'monthly_before',round((a.harga_perolehan-a.nilai_sisa)/nullif(a.umur_bulan,0)),'monthly_after',round((p_harga-a.nilai_sisa)/nullif(a.umur_bulan,0)),
  'cash_code',purchase->>'credit_code','asset_account',asset_account,'cash_account',cash_account,'original_journal_id',j.id);
end$$;
revoke all on function public.fixed_asset_correction_plan(uuid,integer,date,numeric,text) from public,anon,authenticated,service_role;

create function public.preview_fixed_asset_correction(p_asset_id uuid,p_expected_revision integer,p_tanggal date,p_harga numeric,p_reason text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin return public.fixed_asset_correction_plan(p_asset_id,p_expected_revision,p_tanggal,p_harga,p_reason);end$$;
revoke all on function public.preview_fixed_asset_correction(uuid,integer,date,numeric,text) from public,anon,authenticated,service_role;
grant execute on function public.preview_fixed_asset_correction(uuid,integer,date,numeric,text) to authenticated;

create function public.correct_fixed_asset_purchase(p_asset_id uuid,p_expected_revision integer,p_tanggal date,p_harga numeric,p_reason text,p_request_key text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare a public.fixed_assets%rowtype;c public.fixed_asset_corrections%rowtype;plan jsonb;payload jsonb;before_value jsonb;result jsonb;
 audit uuid:=gen_random_uuid();reversal uuid:=gen_random_uuid();replacement uuid:=gen_random_uuid();branch uuid;
begin
 if p_request_key is null or p_request_key<>btrim(p_request_key) or length(p_request_key) not between 1 and 120 then raise exception 'Identitas koreksi tidak valid';end if;
 perform pg_advisory_xact_lock(hashtextextended('asset-correction:'||auth.uid()::text||':'||p_request_key,0));
 -- Same relation-lock order as reconciliation, before asset/number locks. Freezes
 -- the bank dependency check, and prevents source journal mutation mid-correction.
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 select * into a from public.fixed_assets where id=p_asset_id for update;
 if not found then raise exception 'Aset tidak ditemukan';end if;
 perform public.fixed_asset_correction_access(a.branch_id);
 payload:=jsonb_build_object('asset_id',p_asset_id,'revision',p_expected_revision,'tanggal',p_tanggal,'harga',p_harga,'reason',btrim(p_reason));
 select * into c from public.fixed_asset_corrections where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if c.payload is distinct from payload then raise exception 'Identitas koreksi dipakai untuk rincian berbeda';end if;
  perform public.fixed_asset_correction_access((c.before_value->>'branch_id')::uuid);
  return c.result;
 end if;
 plan:=public.fixed_asset_correction_plan(p_asset_id,p_expected_revision,p_tanggal,p_harga,p_reason);
 if not (plan->>'allowed')::boolean then raise exception '%',plan->'blockers'->>0;end if;
 before_value:=to_jsonb(a);
 insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
  values(reversal,public.sales_next_number('JRN',a.tanggal_perolehan),a.tanggal_perolehan,'Pembalik pembelian aset: '||a.nama,'asset-purchase-reversal',audit::text,a.branch_id);
 insert into public.journal_lines(entry_id,account_id,debit,credit)
  select reversal,account_id,credit,debit from public.journal_lines where entry_id=(plan->>'original_journal_id')::uuid;
 insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
  values(replacement,public.sales_next_number('JRN',p_tanggal),p_tanggal,'Koreksi pembelian aset: '||a.nama,'asset-purchase-fix',audit::text,a.branch_id);
 insert into public.journal_lines(entry_id,account_id,debit,credit) values
  (replacement,(plan->>'asset_account')::uuid,p_harga,0),(replacement,(plan->>'cash_account')::uuid,0,p_harga);
 update public.fixed_assets set harga_perolehan=p_harga,tanggal_perolehan=p_tanggal where id=a.id returning * into a;
 result:=jsonb_build_object('asset_id',a.id,'correction_id',audit,'revision',a.correction_revision,'reversal_journal_id',reversal,'replacement_journal_id',replacement);
 insert into public.fixed_asset_corrections(id,asset_id,actor_id,request_key,payload,reason,before_value,after_value,original_journal_id,reversal_journal_id,replacement_journal_id,result)
  values(audit,a.id,auth.uid(),p_request_key,payload,btrim(p_reason),before_value,to_jsonb(a),(plan->>'original_journal_id')::uuid,reversal,replacement,result);
 return result;
end$$;
revoke all on function public.correct_fixed_asset_purchase(uuid,integer,date,numeric,text,text) from public,anon,authenticated,service_role;
grant execute on function public.correct_fixed_asset_purchase(uuid,integer,date,numeric,text,text) to authenticated;

create function public.get_fixed_asset_correction_result(p_asset_id uuid,p_request_key text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare a public.fixed_assets%rowtype;c public.fixed_asset_corrections%rowtype;begin
 perform pg_advisory_xact_lock(hashtextextended('asset-correction:'||auth.uid()::text||':'||p_request_key,0));
 select * into a from public.fixed_assets where id=p_asset_id for update;
 if not found then raise exception 'Aset tidak ditemukan';end if;
 perform public.fixed_asset_correction_access(a.branch_id);
 select * into c from public.fixed_asset_corrections where actor_id=auth.uid() and request_key=p_request_key and asset_id=a.id;
 if not found then return null;end if;
 perform public.fixed_asset_correction_access((c.before_value->>'branch_id')::uuid);
 return c.result;
end$$;
revoke all on function public.get_fixed_asset_correction_result(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_fixed_asset_correction_result(uuid,text) to authenticated;

-- Keep the existing capitalization action working after raw acquisition-price
-- edits are protected. This retains its existing policy and financial roles.
create table public.fixed_asset_value_requests(
 actor_id uuid not null references public.profiles(id),request_key text not null,
 asset_id uuid not null references public.fixed_assets(id),payload jsonb not null,result jsonb not null,
 primary key(actor_id,request_key)
);
alter table public.fixed_asset_value_requests enable row level security;
revoke all on public.fixed_asset_value_requests from public,anon,authenticated,service_role;
create function public.add_fixed_asset_value_atomic(p_asset_id uuid,p_tanggal date,p_amount numeric,p_credit_code text,p_reason text,p_request_key text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare a public.fixed_assets%rowtype;prior public.fixed_asset_value_requests%rowtype;payload jsonb;result jsonb;change uuid:=gen_random_uuid();journal uuid:=gen_random_uuid();asset_account uuid;cash_account uuid;bank public.cash_accounts%rowtype;closed date;
begin
 if p_request_key is null or length(p_request_key) not between 1 and 120 or p_request_key<>btrim(p_request_key) then raise exception 'Identitas penambahan nilai tidak valid';end if;
 perform pg_advisory_xact_lock(hashtextextended('asset-value:'||auth.uid()::text||':'||p_request_key,0));
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 select * into a from public.fixed_assets where id=p_asset_id for update;
 if not found then raise exception 'Aset tidak ditemukan';end if;
 perform public.purchase_assert_access('asset',a.branch_id);
 perform 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','ADMIN','FINANCE') for share;
 if not found then raise exception 'Akses keuangan aktif diperlukan' using errcode='42501';end if;
 payload:=jsonb_build_object('asset_id',p_asset_id,'tanggal',p_tanggal,'amount',p_amount,'credit_code',p_credit_code,'reason',p_reason);
 select * into prior from public.fixed_asset_value_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Identitas dipakai untuk rincian berbeda';end if;
  return prior.result;
 end if;
 if a.status<>'aktif' or not a.is_active then raise exception 'Aset sudah dilepas/nonaktif';end if;
 if p_tanggal is null or not isfinite(p_tanggal) or p_tanggal>(now() at time zone 'Asia/Jakarta')::date or p_tanggal<a.tanggal_perolehan then raise exception 'Tanggal penambahan nilai tidak valid';end if;
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<=0 or p_amount+a.harga_perolehan>1e15 then raise exception 'Nominal penambahan nilai tidak valid';end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if p_tanggal<=closed then raise exception 'Periode akuntansi sudah ditutup';end if;
 if (select count(*) from public.cash_accounts where coa_code=p_credit_code)<>1 then raise exception 'Rekening asal tidak pasti';end if;
 select * into bank from public.cash_accounts where coa_code=p_credit_code for share;
 if not bank.is_active or bank.branch_id is not null and bank.branch_id is distinct from a.branch_id then raise exception 'Rekening tidak aktif atau tidak sesuai cabang';end if;
 perform 1 from public.coa_accounts where code in ('1501',p_credit_code) order by id for share;
 select id into asset_account from public.coa_accounts where code='1501' and is_active and not is_header;
 select id into cash_account from public.coa_accounts where code=p_credit_code and is_active and not is_header and type='ASET';
 if asset_account is null or cash_account is null or asset_account=cash_account then raise exception 'Akun penambahan nilai tidak valid';end if;
 insert into public.asset_changes(id,asset_id,tanggal,jenis,nilai_lama,nilai_baru,keterangan,created_by)
  values(change,a.id,p_tanggal,'nilai',a.harga_perolehan,a.harga_perolehan+p_amount,p_reason,auth.uid());
 update public.fixed_assets set harga_perolehan=harga_perolehan+p_amount where id=a.id;
 insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
  values(journal,public.sales_next_number('JRN',p_tanggal),p_tanggal,'Penambahan nilai aset: '||a.nama,'asset-change',change::text,a.branch_id);
 insert into public.journal_lines(entry_id,account_id,debit,credit) values(journal,asset_account,p_amount,0),(journal,cash_account,0,p_amount);
 result:=jsonb_build_object('change_id',change,'journal_id',journal,'asset_id',a.id);
 insert into public.fixed_asset_value_requests values(auth.uid(),p_request_key,a.id,payload,result);
 return result;
end$$;
revoke all on function public.add_fixed_asset_value_atomic(uuid,date,numeric,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.add_fixed_asset_value_atomic(uuid,date,numeric,text,text,text) to authenticated;
