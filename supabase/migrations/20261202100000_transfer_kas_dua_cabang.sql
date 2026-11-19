-- Transfer Kas/Bank dengan dua cabang (cabang asal & cabang tujuan) + koreksi boleh ganti cabang (19 Nov 2026).
--
-- Pelapor: Mba Anisa (finance) via Reza, WA 19 Nov 2026: "pada menu transfer kas harus ada dua cabang, dari kas
-- sumber dan kas tertujunya" + video: koreksi transfer harus bisa langsung ganti cabang/tanggal/nilai seperti Accurate.
--
-- Sebelumnya: satu transfer = satu jurnal dengan SATU cabang. Uang yang pindah dari rekening cabang A ke rekening
-- cabang B tercatat seluruhnya di cabang A, sehingga saldo rekening per cabang selisih. Koreksi menolak ganti cabang.
--
-- Sesudah:
--  * cash_transfers.branch_id = cabang asal, cash_transfers.to_branch_id = cabang tujuan (baris lama diisi sama
--    dengan cabang asal, jadi tidak ada angka lama yang berubah).
--  * Cabang asal = cabang tujuan  -> satu jurnal persis seperti sebelumnya.
--  * Cabang asal <> cabang tujuan -> dua jurnal, masing-masing seimbang di cabangnya sendiri, dihubungkan akun
--    perantara 182010 "Rekening Antar Cabang" (konsolidasi = 0):
--      jurnal asal   (source 'transfer',         cabang asal):   D 182010 jumlah, D biaya admin, K rekening asal jumlah+biaya
--      jurnal tujuan (source 'transfer-tujuan',  cabang tujuan): D rekening tujuan jumlah, K 182010 jumlah
--  * Koreksi boleh mengganti cabang asal/tujuan (dan tanggal/rekening/nilai seperti sebelumnya). Jurnal lama dibalik
--    di cabang & tanggal aslinya (dua pembalik bila dulu dua jurnal), pengganti dicatat di cabang & tanggal baru.
--  * Akses: pengguna harus bisa mengakses cabang asal DAN cabang tujuan (lama dan baru).
--  * Klien lama yang belum mengirim to_branch_id tetap jalan: cabang tujuan = cabang asal.
-- Pengaman lain tidak berubah: periode tutup buku, rekonsiliasi bank, revisi bersamaan, alasan wajib, idempotensi,
-- jejak revisi, izin per grup (bank.cash_transfer.*).

insert into public.coa_accounts(code,name,type,normal_balance,is_header,is_active,parent_id)
select '182010','Rekening Antar Cabang','ASET','D',false,true,(select id from public.coa_accounts where code='182000')
where not exists(select 1 from public.coa_accounts where code='182010');

alter table public.cash_transfers add column if not exists to_branch_id uuid references public.branches(id) on delete set null;
alter table public.cash_transfers add column if not exists to_journal_entry_id uuid references public.journal_entries(id) on delete restrict;
create unique index if not exists cash_transfers_to_journal_entry_id_key on public.cash_transfers(to_journal_entry_id) where to_journal_entry_id is not null;
comment on column public.cash_transfers.branch_id is 'Cabang asal (rekening sumber).';
comment on column public.cash_transfers.to_branch_id is 'Cabang tujuan (rekening tujuan). Sama dengan branch_id = satu jurnal; beda = jurnal asal + jurnal tujuan lewat 182010.';
comment on column public.cash_transfers.to_journal_entry_id is 'Jurnal sisi cabang tujuan (source transfer-tujuan); null bila cabang asal = tujuan.';

-- Baris lama: cabang tujuan = cabang asal (pemicu penjaga hanya menolak klien, migrasi berjalan sebagai pemilik).
update public.cash_transfers set to_branch_id=branch_id where to_branch_id is null and branch_id is not null;

create or replace function public.guard_internal_transfer_journal() returns trigger
language plpgsql set search_path='' as $$
declare protected boolean;begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then
   protected:=new.source in ('transfer','transfer-tujuan','transfer-correction','transfer-reversal','transfer-void')
    or old.source in ('transfer','transfer-tujuan','transfer-correction','transfer-reversal','transfer-void');
  else
   select exists(select 1 from public.journal_entries where id in(new.entry_id,old.entry_id)
    and source in ('transfer','transfer-tujuan','transfer-correction','transfer-reversal','transfer-void')) into protected;
  end if;
  if protected then raise exception 'Jurnal transfer hanya boleh diubah melalui jalur resmi' using errcode='42501';end if;
 end if;
 return coalesce(new,old);
end$$;

create or replace function public.internal_transfer_scope(p_transfer_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare doc public.cash_transfers%rowtype;begin
 select * into doc from public.cash_transfers where id=p_transfer_id;
 if not found or not public.user_can_access_branch(doc.branch_id)
  or (doc.to_branch_id is distinct from doc.branch_id and not public.user_can_access_branch(doc.to_branch_id)) or exists(
  select 1 from public.cash_accounts a where a.id in(doc.from_account_id,doc.to_account_id)
   and a.branch_id is not null and not public.user_can_access_branch(a.branch_id)
 ) then raise exception 'Cabang atau rekening transfer tidak dapat diakses' using errcode='42501';end if;
end$$;

create or replace function public.mutate_cash_transfer(p_request_key text, p_action text, p_transfer_id uuid, p_expected_revision integer, p_header jsonb, p_reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
 set lock_timeout to '5s'
as $function$
declare
 prior public.cash_transfer_requests%rowtype;doc public.cash_transfers%rowtype;replacement public.cash_transfers%rowtype;
 original public.journal_entries%rowtype;original_to public.journal_entries%rowtype;
 from_account public.cash_accounts%rowtype;to_account public.cash_accounts%rowtype;
 payload jsonb;result jsonb;before_value jsonb;d date;closed date;amount numeric;fee numeric;notes text;
 -- branch/to_branch: cabang catatan lama (edit/void) atau baru (create). new_*: cabang pengganti/baru.
 branch uuid;to_branch uuid;new_branch uuid;new_to_branch uuid;old_split boolean:=false;new_split boolean:=false;
 from_coa uuid;to_coa uuid;fee_coa uuid;rac_coa uuid;expected jsonb;actual jsonb;expected_to jsonb;actual_to jsonb;old_from uuid;old_to uuid;
 journal uuid:=gen_random_uuid();journal_to uuid:=gen_random_uuid();reversal uuid:=gen_random_uuid();reversal_to uuid:=gen_random_uuid();
 audit uuid:=gen_random_uuid();
 prefix text;digits integer;seq bigint;document_number text;
begin
  perform admin_online_private.deny_admin_online();
 if auth.uid() is null or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or length(p_request_key)>120
  or p_action is null or p_action not in ('create','edit','void') or jsonb_typeof(p_header) is distinct from 'object'
  or (p_action='create' and (p_transfer_id is not null or p_expected_revision is not null))
  or (p_action<>'create' and (p_transfer_id is null or p_expected_revision is null or p_expected_revision<0
   or length(btrim(coalesce(p_reason,''))) not between 3 and 1000)) then
  raise exception 'Identitas atau alasan transfer tidak valid';
 end if;
 payload:=jsonb_build_object('action',p_action,'id',p_transfer_id,'revision',p_expected_revision,'header',p_header,'reason',nullif(btrim(p_reason),''));
 perform pg_advisory_xact_lock(hashtextextended('vetos:transfer:'||auth.uid()::text||':'||p_request_key,0));
 perform public.internal_transfer_access(p_action);
 if p_action='create' then
  branch:=nullif(p_header->>'branch_id','')::uuid;
  to_branch:=case when p_header ? 'to_branch_id' then nullif(p_header->>'to_branch_id','')::uuid else branch end;
 else
  select * into doc from public.cash_transfers where id=p_transfer_id for update;
  if not found then raise exception 'Transfer tidak ditemukan';end if;
  perform public.internal_transfer_scope(doc.id);
  branch:=doc.branch_id;
  -- Catatan sebelum kolom cabang tujuan ada: tujuan = asal.
  to_branch:=case when doc.to_journal_entry_id is null then doc.branch_id else doc.to_branch_id end;
  old_split:=doc.to_journal_entry_id is not null;
 end if;
 select * into prior from public.cash_transfer_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda';end if;
  perform public.internal_transfer_scope(prior.transfer_id);
  if prior.result->>'replacement_transfer_id' is not null then
   perform public.internal_transfer_scope((prior.result->>'replacement_transfer_id')::uuid);
  end if;
  perform public.require_role_action('bank.cash_transfer.'||p_action);
 perform role_settings_private.require_bank_request_scope('cash_transfer',p_request_key);
 return prior.result;
 end if;
 if p_action='create' then new_branch:=branch;new_to_branch:=to_branch;
 elsif p_action='edit' then
  new_branch:=case when p_header ? 'branch_id' then nullif(p_header->>'branch_id','')::uuid else branch end;
  new_to_branch:=case when p_header ? 'to_branch_id' then nullif(p_header->>'to_branch_id','')::uuid
   when p_header ? 'branch_id' and to_branch is not distinct from branch then new_branch else to_branch end;
 end if;
 new_split:=p_action<>'void' and new_branch is distinct from new_to_branch;
 if not public.user_can_access_branch(branch) or not public.user_can_access_branch(to_branch)
  or (p_action<>'void' and (not public.user_can_access_branch(new_branch) or not public.user_can_access_branch(new_to_branch))) then
  raise exception 'Cabang transfer tidak dapat diakses' using errcode='42501';
 end if;
 select closed_until into closed from public.accounting_locks where id for share;
 if not found then raise exception 'Pengaturan periode akuntansi tidak tersedia. Hubungi administrator';end if;
 if p_action<>'create' then
  if doc.jumlah::text in ('NaN','Infinity','-Infinity') or doc.biaya_admin::text in ('NaN','Infinity','-Infinity')
   or doc.jumlah<=0 or doc.biaya_admin<0 or doc.jumlah+doc.biaya_admin>1000000000000 then
   raise exception 'Jurnal transfer sumber memiliki nominal tidak valid. Lakukan pencocokan terlebih dahulu';
  end if;
  if doc.voided_at is not null or doc.revision<>p_expected_revision then raise exception 'Transfer sudah berubah atau dibatalkan. Muat ulang sebelum mengoreksi';end if;
  if not isfinite(doc.tanggal) or doc.tanggal>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal transfer sumber belum boleh dikoreksi';end if;
  if closed is not null and doc.tanggal<=closed then raise exception 'Periode akuntansi sudah ditutup';end if;
 end if;
 if p_action<>'void' then
  d:=(p_header->>'tanggal')::date;amount:=(p_header->>'jumlah')::numeric;fee:=(p_header->>'biaya_admin')::numeric;
  notes:=nullif(btrim(p_header->>'keterangan'),'');
  if d is null or not isfinite(d) or d>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal transfer tidak valid';end if;
  if closed is not null and d<=closed then raise exception 'Periode akuntansi sudah ditutup';end if;
  if amount is null or fee is null or amount<=0 or fee<0 or amount+fee>1000000000000
   or amount<>round(amount,2) or fee<>round(fee,2) or amount::text in ('NaN','Infinity','-Infinity')
   or fee::text in ('NaN','Infinity','-Infinity') or length(coalesce(notes,''))>1000 then raise exception 'Nilai transfer tidak valid';end if;
 end if;
 -- Lock old and new masters in one order. Never reconstruct a reversal using a
 -- changed mapping: compare the exact expected source posting below, then copy.
 perform 1 from public.cash_accounts where id in(doc.from_account_id,doc.to_account_id,
  nullif(p_header->>'from_account_id','')::uuid,nullif(p_header->>'to_account_id','')::uuid) order by id for share;
 perform 1 from public.branches where id in(branch,to_branch,new_branch,new_to_branch) or id in(select branch_id from public.cash_accounts where id in(
  doc.from_account_id,doc.to_account_id,nullif(p_header->>'from_account_id','')::uuid,nullif(p_header->>'to_account_id','')::uuid)) order by id for share;
 if p_action<>'void' and exists(select 1 from unnest(array[new_branch,new_to_branch]) b(id)
   where b.id is not null and not exists(select 1 from public.branches x where x.id=b.id and x.is_active)) then
  raise exception 'Cabang transfer tidak aktif';
 end if;
 if exists(select 1 from public.cash_accounts a where a.id in(doc.from_account_id,doc.to_account_id,
   nullif(p_header->>'from_account_id','')::uuid,nullif(p_header->>'to_account_id','')::uuid)
   and (not a.is_active or (a.branch_id is not null and (not public.user_can_access_branch(a.branch_id)
    or not exists(select 1 from public.branches b where b.id=a.branch_id and b.is_active))))) then
  raise exception 'Rekening transfer tidak aktif atau di luar cabang yang dapat diakses' using errcode='42501';
 end if;
 perform 1 from public.coa_accounts where code in('740010','182010') or code in(select coa_code from public.cash_accounts where id in(
  doc.from_account_id,doc.to_account_id,nullif(p_header->>'from_account_id','')::uuid,nullif(p_header->>'to_account_id','')::uuid)) order by id for share;
 select id into fee_coa from public.coa_accounts where code='740010' and is_active and not is_header and type='BEBAN';
 select id into rac_coa from public.coa_accounts where code='182010' and is_active and not is_header and type='ASET';
 if (old_split or new_split) and rac_coa is null then
  raise exception 'Akun 182010 Rekening Antar Cabang belum aktif. Hubungi administrator';
 end if;
 if p_action<>'void' then
  select * into from_account from public.cash_accounts where id=(p_header->>'from_account_id')::uuid;
  select * into to_account from public.cash_accounts where id=(p_header->>'to_account_id')::uuid;
  if from_account.id is null or to_account.id is null or from_account.id=to_account.id then raise exception 'Rekening sumber/tujuan tidak valid atau sama';end if;
  select id into from_coa from public.coa_accounts where code=from_account.coa_code and is_active and not is_header and type='ASET' and normal_balance='D';
  select id into to_coa from public.coa_accounts where code=to_account.coa_code and is_active and not is_header and type='ASET' and normal_balance='D';
  if from_coa is null or to_coa is null or from_coa=to_coa or (fee>0 and fee_coa is null) then raise exception 'Akun transfer harus akun aset detail aktif dan biaya harus akun beban';end if;
 end if;
 -- Same ledger snapshot lock as bank reconciliation and payment correction.
 -- Acquire before source row locks/number generation; both reconciliation orders
 -- either see the corrected balance or reject the correction atomically.
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 perform public.internal_transfer_access(p_action);
 if p_action<>'create' then
  if doc.journal_entry_id is null then
   if (select count(*) from public.journal_entries where source='transfer' and source_ref=doc.no_transfer)<>1 then raise exception 'Jurnal transfer sumber tidak unik atau belum lengkap. Lakukan pencocokan terlebih dahulu';end if;
   select * into original from public.journal_entries where source='transfer' and source_ref=doc.no_transfer;
  else select * into original from public.journal_entries where id=doc.journal_entry_id;end if;
  if original.id is null or original.source<>'transfer' or original.source_ref is distinct from doc.no_transfer
   or original.branch_id is distinct from branch or original.tanggal is distinct from doc.tanggal or original.voided_at is not null
   or exists(select 1 from public.journal_entries where source in('transfer-void','transfer-reversal') and source_ref=doc.no_transfer)
   or exists(select 1 from public.cash_transfer_revisions where transfer_id=doc.id) then raise exception 'Jurnal transfer sumber tidak sesuai. Lakukan pencocokan terlebih dahulu';end if;
  if old_split then
   select * into original_to from public.journal_entries where id=doc.to_journal_entry_id;
   if original_to.id is null or original_to.source<>'transfer-tujuan' or original_to.source_ref is distinct from doc.no_transfer
    or original_to.branch_id is distinct from to_branch or original_to.tanggal is distinct from doc.tanggal or original_to.voided_at is not null then
    raise exception 'Jurnal transfer sumber tidak sesuai. Lakukan pencocokan terlebih dahulu';
   end if;
  end if;
  select c.id into old_from from public.cash_accounts a join public.coa_accounts c on c.code=a.coa_code
   where a.id=doc.from_account_id and c.is_active and not c.is_header and c.type='ASET' and c.normal_balance='D';
  select c.id into old_to from public.cash_accounts a join public.coa_accounts c on c.code=a.coa_code
   where a.id=doc.to_account_id and c.is_active and not c.is_header and c.type='ASET' and c.normal_balance='D';
  -- Satu jurnal: D tujuan / K asal (+biaya). Dua jurnal: asal D 182010 / K asal (+biaya); tujuan D tujuan / K 182010.
  select jsonb_agg(jsonb_build_object('account_id',a,'debit',v_debit,'credit',v_credit) order by a,v_debit,v_credit) into expected from(
   select case when old_split then rac_coa else old_to end a,doc.jumlah v_debit,0::numeric v_credit union all select old_from,0,doc.jumlah+doc.biaya_admin
   union all select fee_coa,doc.biaya_admin,0 where doc.biaya_admin>0) x;
  select jsonb_agg(jsonb_build_object('account_id',account_id,'debit',debit,'credit',credit) order by account_id,debit,credit) into actual
   from public.journal_lines where entry_id=original.id;
  if old_split then
   select jsonb_agg(jsonb_build_object('account_id',a,'debit',v_debit,'credit',v_credit) order by a,v_debit,v_credit) into expected_to from(
    select old_to a,doc.jumlah v_debit,0::numeric v_credit union all select rac_coa,0,doc.jumlah) x;
   select jsonb_agg(jsonb_build_object('account_id',account_id,'debit',debit,'credit',credit) order by account_id,debit,credit) into actual_to
    from public.journal_lines where entry_id=original_to.id;
  end if;
  if old_from is null or old_to is null or (doc.biaya_admin>0 and fee_coa is null) or actual is distinct from expected
   or actual_to is distinct from expected_to then
   raise exception 'Jurnal transfer sumber tidak cocok dengan nominal/rekening. Lakukan pencocokan terlebih dahulu';
  end if;
  before_value:=jsonb_build_object('transfer',to_jsonb(doc),'journal',to_jsonb(original),'lines',
   (select jsonb_agg(to_jsonb(l) order by id) from public.journal_lines l where entry_id=original.id))
   ||case when old_split then jsonb_build_object('to_journal',to_jsonb(original_to),'to_lines',
   (select jsonb_agg(to_jsonb(l) order by id) from public.journal_lines l where entry_id=original_to.id)) else '{}'::jsonb end;
 end if;
 -- Includes backdated new transfers and every old/new affected bank account.
 -- Legacy reconciliation codes are checked even when cash_account_id is absent.
 if exists(select 1 from public.bank_reconciliations r left join public.cash_accounts a on a.id=r.cash_account_id
  left join public.coa_accounts c on c.code=coalesce(r.bank_coa_code,a.coa_code)
  where r.voided_at is null and ((p_action<>'create' and r.tanggal>=doc.tanggal and (c.id is null or c.id in(old_from,old_to)))
   or (p_action<>'void' and r.tanggal>=d and (c.id is null or c.id in(from_coa,to_coa))))) then
  raise exception 'Rekonsiliasi bank sudah mencakup rekening dan tanggal ini. Koreksi atau batalkan rekonsiliasi terkait dahulu; rekonsiliasi lama tanpa pemetaan rekening perlu dicocokkan';
 end if;
 if p_action<>'void' then
  select pola,digit into prefix,digits from public.document_numbering where jenis='TF';
  prefix:=coalesce(prefix,'TF.{YYYY}.{MM}.');digits:=coalesce(digits,5);
  prefix:=replace(replace(replace(replace(prefix,'{YYYY}',to_char(d,'YYYY')),'{YY}',to_char(d,'YY')),'{MM}',to_char(d,'MM')),'{DD}',to_char(d,'DD'));
  if digits not between 1 and 8 or length(prefix)+digits>24 then raise exception 'Format nomor transfer tidak valid';end if;
  perform pg_advisory_xact_lock(hashtextextended('vetos:transfer-number:'||prefix,0));
  select coalesce(max(substring(no_transfer from length(prefix)+1)::bigint),0)+1 into seq from public.cash_transfers
   where left(no_transfer,length(prefix))=prefix and substring(no_transfer from length(prefix)+1)~'^[0-9]+$';
  if length(seq::text)>digits then raise exception 'Urutan nomor transfer penuh';end if;
  document_number:=prefix||lpad(seq::text,digits,'0');
 end if;
 if p_action<>'create' then
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
   values(reversal,public.sales_next_number('JRN',doc.tanggal),doc.tanggal,'Pembalik transfer '||doc.no_transfer||': '||btrim(p_reason),'transfer-reversal',audit::text,branch);
  insert into public.journal_lines(entry_id,account_id,debit,credit) select reversal,account_id,credit,debit from public.journal_lines where entry_id=original.id;
  if old_split then
   insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
    values(reversal_to,public.sales_next_number('JRN',doc.tanggal),doc.tanggal,'Pembalik transfer '||doc.no_transfer||' (cabang tujuan): '||btrim(p_reason),'transfer-reversal',audit::text,to_branch);
   insert into public.journal_lines(entry_id,account_id,debit,credit) select reversal_to,account_id,credit,debit from public.journal_lines where entry_id=original_to.id;
  end if;
  -- Financial fields, original journal, document identity and original author remain intact.
  update public.cash_transfers set voided_at=clock_timestamp(),voided_by=auth.uid(),void_reason=btrim(p_reason),revision=revision+1 where id=doc.id;
 end if;
 if p_action<>'void' then
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
   values(journal,public.sales_next_number('JRN',d),d,'Transfer '||document_number||coalesce(' — '||notes,''),'transfer',document_number,new_branch);
  if new_split then
   insert into public.journal_lines(entry_id,account_id,debit,credit) values(journal,rac_coa,amount,0),(journal,from_coa,0,amount+fee);
   if fee>0 then insert into public.journal_lines(entry_id,account_id,debit,credit) values(journal,fee_coa,fee,0);end if;
   insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
    values(journal_to,public.sales_next_number('JRN',d),d,'Transfer '||document_number||' masuk dari cabang lain'||coalesce(' — '||notes,''),'transfer-tujuan',document_number,new_to_branch);
   insert into public.journal_lines(entry_id,account_id,debit,credit) values(journal_to,to_coa,amount,0),(journal_to,rac_coa,0,amount);
  else
   insert into public.journal_lines(entry_id,account_id,debit,credit) values(journal,to_coa,amount,0),(journal,from_coa,0,amount+fee);
   if fee>0 then insert into public.journal_lines(entry_id,account_id,debit,credit) values(journal,fee_coa,fee,0);end if;
  end if;
  insert into public.cash_transfers(no_transfer,tanggal,from_account_id,to_account_id,jumlah,biaya_admin,branch_id,to_branch_id,keterangan,created_by,journal_entry_id,to_journal_entry_id,replacement_of)
   values(document_number,d,from_account.id,to_account.id,amount,fee,new_branch,new_to_branch,notes,auth.uid(),journal,case when new_split then journal_to end,case when p_action='edit' then doc.id end) returning * into replacement;
  if p_action='create' then doc:=replacement;end if;
 end if;
 if p_action<>'create' then
  insert into public.cash_transfer_revisions(id,transfer_id,replacement_transfer_id,branch_id,action,reason,before_value,after_value,original_journal_id,reversal_journal_id,replacement_journal_id,created_by)
   values(audit,doc.id,replacement.id,branch,p_action,btrim(p_reason),before_value,
    jsonb_build_object('transfer',(select to_jsonb(t) from public.cash_transfers t where id=doc.id),'replacement',to_jsonb(replacement),
     'reversal_to_journal_id',case when old_split then reversal_to end,'replacement_to_journal_id',case when new_split then journal_to end),
    original.id,reversal,case when p_action='edit' then journal end,auth.uid());
 end if;
 result:=jsonb_build_object('transfer_id',doc.id,'no_transfer',doc.no_transfer,'revision',case when p_action='create' then 0 else doc.revision+1 end,
  'journal_entry_id',case when p_action='create' then journal else original.id end,
  'to_journal_entry_id',case when p_action='create' and new_split then journal_to when p_action<>'create' and old_split then original_to.id end,
  'reversal_journal_id',case when p_action<>'create' then reversal end,
  'reversal_to_journal_id',case when p_action<>'create' and old_split then reversal_to end,
  'replacement_transfer_id',case when p_action='edit' then replacement.id end,
  'replacement_journal_id',case when p_action='edit' then journal end,
  'replacement_to_journal_id',case when p_action='edit' and new_split then journal_to end,'action',p_action);
 insert into public.cash_transfer_requests(actor_id,request_key,transfer_id,payload,result) values(auth.uid(),p_request_key,doc.id,payload,result);
 perform public.require_role_action('bank.cash_transfer.'||p_action);
 perform role_settings_private.require_bank_request_scope('cash_transfer',p_request_key);
 return result;
end$function$;
revoke all on function public.mutate_cash_transfer(text,text,uuid,integer,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.mutate_cash_transfer(text,text,uuid,integer,jsonb,text) to authenticated;
revoke all on function public.internal_transfer_scope(uuid) from public,anon,authenticated,service_role;
