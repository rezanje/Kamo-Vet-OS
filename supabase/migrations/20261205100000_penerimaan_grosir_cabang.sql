-- Penerimaan faktur penjualan grosir boleh memilih cabang penerima uang (23 Nov 2026).
--
-- Permintaan Mba Anisa (finance) via Reza: "penerimaan penjualan, harus ada cabang. karena kas nya per cabang".
-- Contoh: faktur dari DC dibayar tunai di toko → uangnya masuk Kas Toko cabang itu, bukan Kas Kecil DC.
--
-- Sebelumnya receive_wholesale_payment selalu menjurnal di cabang faktur dan menolak rekening milik cabang lain
-- ("Rekening tidak aktif atau berbeda cabang"); peta rekening juga dibaca untuk cabang faktur.
--
-- Sesudah:
--  * receive_wholesale_payment(..., p_branch_id uuid) — versi 9 argumen. NULL / sama dengan cabang faktur = perilaku lama
--    persis (satu jurnal, payload idempoten sama). Versi 8 argumen tetap ada sebagai pembungkus (klien lama).
--  * Cabang penerima ≠ cabang faktur → dua jurnal, pola sama dengan Transfer Kas dua cabang (182010 Rekening Antar Cabang):
--      'sales-receipt'         (cabang faktur):   D 182010 (bagian kas) [+ D 314001 uang muka] / K 150001 piutang
--      'sales-receipt-cabang'  (cabang penerima): D rekening kas/bank / K 182010
--    Piutang tetap lunas di cabang faktur, uang masuk di cabang penerima, 182010 konsolidasi = 0.
--    Jurnal 'sales-receipt' tetap berbentuk "kas + uang muka / piutang" sehingga pemeriksa lama (koreksi faktur grosir)
--    tetap lulus tanpa diubah.
--  * Peta rekening & rekening milik cabang dicocokkan ke cabang PENERIMA. Cabang penerima wajib aktif & bisa diakses.
--  * sales_receipts.branch_id (cabang penerima; NULL = baris lama = cabang faktur) dan sales_receipts.cash_journal_id.
--  * cancel_wholesale_receipt membalik kedua jurnal (pembalik kas di cabang penerima, source 'sales-receipt-void-cbg').
--  * guard_wholesale_journal melindungi kedua source baru dari tulis langsung.
--
-- Fungsi live sudah dipatch berlapis (deny_admin_online, returned_ar, bagan akun baru), jadi diubah lewat penggantian teks
-- pada definisi yang sedang berjalan. Tiap potongan wajib ditemukan tepat satu kali; bila fungsi sudah memuat penanda
-- migrasi ini, langkah dilewati (idempoten).

alter table public.sales_receipts
  add column if not exists branch_id uuid references public.branches(id),
  add column if not exists cash_journal_id uuid references public.journal_entries(id);
comment on column public.sales_receipts.branch_id is 'Cabang penerima uang. NULL (baris lama) = cabang faktur. Beda dari cabang faktur = jurnal kas di cabang ini lewat 182010.';
comment on column public.sales_receipts.cash_journal_id is 'Jurnal kas di cabang penerima (source sales-receipt-cabang / sales-receipt-void-cbg) bila beda cabang dengan faktur.';

-- 1. receive_wholesale_payment versi 9 argumen ----------------------------------------------------------------------
do $migrate$
declare
 v_def text; v_old text; v_new text; v_count integer; i integer;
 v_pairs text[][] := array[
  [$q$p_catatan text)$q$,
   $q$p_catatan text, p_branch_id uuid)$q$],
  [$q$advance_cash text;advance_branch uuid;$q$,
   $q$advance_cash text;advance_branch uuid;rc_branch uuid;cash_journal uuid;kas_lines jsonb;$q$],
  [$q$'advance_id',p_advance_id,'catatan',p_catatan);$q$,
   $q$'advance_id',p_advance_id,'catatan',p_catatan);
 -- penerimaan-grosir-cabang: cabang penerima uang (permintaan Anisa, 23 Nov 2026). NULL/sama = cabang faktur, payload lama.
 rc_branch:=coalesce(p_branch_id,inv.branch_id);
 if rc_branch is distinct from inv.branch_id then
  if rc_branch is null or not public.user_can_access_branch(rc_branch) or not exists(select 1 from public.branches where id=rc_branch and is_active) then
   raise exception 'Cabang penerimaan tidak ditemukan atau tidak dapat diakses' using errcode='42501';end if;
  payload:=payload||jsonb_build_object('branch_id',rc_branch);
 end if;$q$],
  [$q$(branch_id=inv.branch_id or branch_id is null)$q$,
   $q$(branch_id=rc_branch or branch_id is null)$q$],
  [$q$account.branch_id is distinct from inv.branch_id)$q$,
   $q$account.branch_id is distinct from rc_branch)$q$],
  [$q$lines:=lines||jsonb_build_array(jsonb_build_object('code',cash_code,'debit',p_amount-from_advance,'credit',0));$q$,
   $q$if rc_branch is distinct from inv.branch_id then
   kas_lines:=jsonb_build_array(jsonb_build_object('code',cash_code,'debit',p_amount-from_advance,'credit',0),jsonb_build_object('code','182010','debit',0,'credit',p_amount-from_advance));
   lines:=lines||jsonb_build_array(jsonb_build_object('code','182010','debit',p_amount-from_advance,'credit',0));
  else
   lines:=lines||jsonb_build_array(jsonb_build_object('code',cash_code,'debit',p_amount-from_advance,'credit',0));
  end if;$q$],
  [$q$'Penerimaan '||number||' atas '||inv.no_faktur,lines);$q$,
   $q$'Penerimaan '||number||' atas '||inv.no_faktur,lines);
 if kas_lines is not null then
  cash_journal:=public.wholesale_write_journal(p_tanggal,rc_branch,'sales-receipt-cabang',number,'Penerimaan '||number||' atas '||inv.no_faktur||' (kas cabang penerima)',kas_lines);
 end if;$q$],
  [$q$account_id,catatan,created_by,journal_id)$q$,
   $q$account_id,catatan,created_by,journal_id,branch_id,cash_journal_id)$q$],
  [$q$cash_id,p_catatan,auth.uid(),journal);$q$,
   $q$cash_id,p_catatan,auth.uid(),journal,rc_branch,cash_journal);$q$],
  [$q$'document_no',number,'journal_id',journal);$q$,
   $q$'document_no',number,'journal_id',journal,'branch_id',rc_branch,'cash_journal_id',cash_journal);$q$]
 ];
begin
 if to_regprocedure('public.receive_wholesale_payment(text,uuid,date,numeric,text,uuid,uuid,text,uuid)') is not null then return; end if;
 v_def := pg_get_functiondef('public.receive_wholesale_payment(text,uuid,date,numeric,text,uuid,uuid,text)'::regprocedure);
 for i in 1..array_length(v_pairs,1) loop
  v_old := v_pairs[i][1]; v_new := v_pairs[i][2];
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then raise exception 'receive_wholesale_payment: potongan % ditemukan % kali', i, v_count; end if;
  v_def := replace(v_def, v_old, v_new);
 end loop;
 execute v_def;
end
$migrate$;

-- Versi 8 argumen (klien lama, mis. tab yang belum dimuat ulang saat rilis) = cabang faktur.
create or replace function public.receive_wholesale_payment(p_request_key text,p_invoice_id uuid,p_tanggal date,p_amount numeric,p_metode text,p_account_id uuid,p_advance_id uuid,p_catatan text) returns jsonb
language sql security invoker set search_path='' as $$
 select public.receive_wholesale_payment(p_request_key,p_invoice_id,p_tanggal,p_amount,p_metode,p_account_id,p_advance_id,p_catatan,null::uuid)
$$;
revoke all on function public.receive_wholesale_payment(text,uuid,date,numeric,text,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.receive_wholesale_payment(text,uuid,date,numeric,text,uuid,uuid,text) to authenticated;
revoke all on function public.receive_wholesale_payment(text,uuid,date,numeric,text,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.receive_wholesale_payment(text,uuid,date,numeric,text,uuid,uuid,text,uuid) to authenticated;

-- 2. cancel_wholesale_receipt membalik jurnal kas cabang penerima juga ----------------------------------------------
do $migrate$
declare
 v_def text; v_old text; v_new text; v_count integer; i integer;
 v_pairs text[][] := array[
  [$q$cash_code text;paid numeric;$q$,
   $q$cash_code text;paid numeric;real_cash text;kas_lines jsonb;kas_reversal uuid;$q$],
  [$q$perform public.wholesale_assert_journal(original,'sales-receipt',rc.no_terima,rc.tanggal,inv.branch_id,lines);$q$,
   $q$perform public.wholesale_assert_journal(original,'sales-receipt',rc.no_terima,rc.tanggal,inv.branch_id,lines);
 -- penerimaan-grosir-cabang: uang masuk di cabang lain → jurnal kas cabang penerima ikut diperiksa & dibalik.
 if rc.cash_journal_id is not null then
  if rc.branch_id is null or cash_code is distinct from '182010'
   or (select count(*) from public.journal_entries where source='sales-receipt-cabang' and source_ref=rc.no_terima)<>1
   or not exists(select 1 from public.journal_entries where id=rc.cash_journal_id and source='sales-receipt-cabang' and source_ref=rc.no_terima) then
   raise exception 'Tautan jurnal kas cabang penerimaan tidak cocok; rekonsiliasi dahulu';end if;
  select min(a.code) into real_cash from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
   where l.entry_id=rc.cash_journal_id and a.code<>'182010';
  if real_cash is null then raise exception 'Akun kas cabang penerimaan belum terbukti; rekonsiliasi dahulu';end if;
  perform public.wholesale_assert_journal(rc.cash_journal_id,'sales-receipt-cabang',rc.no_terima,rc.tanggal,rc.branch_id,
   jsonb_build_array(jsonb_build_object('code',real_cash,'debit',rc.jumlah-rc.dari_uang_muka,'credit',0),
    jsonb_build_object('code','182010','debit',0,'credit',rc.jumlah-rc.dari_uang_muka)));
  if exists(select 1 from public.bank_reconciliations br join public.cash_accounts a on a.id=br.cash_account_id
    where br.voided_at is null and coalesce(br.bank_coa_code,a.coa_code)=real_cash and rc.tanggal<=br.tanggal) then
   raise exception 'Penerimaan sudah direkonsiliasi bank; tinjau rekonsiliasi dahulu';end if;
 elsif cash_code='182010' then
  raise exception 'Jurnal kas cabang penerimaan tidak tertaut; rekonsiliasi dahulu';
 end if;$q$],
  [$q$'Pembalik penerimaan '||rc.no_terima||' atas '||inv.no_faktur||': '||btrim(p_reason),lines);$q$,
   $q$'Pembalik penerimaan '||rc.no_terima||' atas '||inv.no_faktur||': '||btrim(p_reason),lines);
 if rc.cash_journal_id is not null then
  select jsonb_agg(jsonb_build_object('code',a.code,'debit',l.credit,'credit',l.debit)) into kas_lines
   from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=rc.cash_journal_id;
  kas_reversal:=public.wholesale_write_journal(today,rc.branch_id,'sales-receipt-void-cbg',audit::text,
   'Pembalik kas cabang penerimaan '||rc.no_terima||' atas '||inv.no_faktur||': '||btrim(p_reason),kas_lines);
 end if;$q$],
  [$q$account_id,catatan,created_by,journal_id,reversal_of)$q$,
   $q$account_id,catatan,created_by,journal_id,reversal_of,branch_id,cash_journal_id)$q$],
  [$q$btrim(p_reason),auth.uid(),reversal,rc.id);$q$,
   $q$btrim(p_reason),auth.uid(),reversal,rc.id,rc.branch_id,kas_reversal);$q$],
  [$q$'reversal_receipt_id',reversal_receipt,$q$,
   $q$'reversal_receipt_id',reversal_receipt,'cash_reversal_journal_id',kas_reversal,$q$]
 ];
begin
 v_def := pg_get_functiondef('public.cancel_wholesale_receipt(uuid,integer,text,text)'::regprocedure);
 if position('penerimaan-grosir-cabang' in v_def) > 0 then return; end if;
 for i in 1..array_length(v_pairs,1) loop
  v_old := v_pairs[i][1]; v_new := v_pairs[i][2];
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then raise exception 'cancel_wholesale_receipt: potongan % ditemukan % kali', i, v_count; end if;
  v_def := replace(v_def, v_old, v_new);
 end loop;
 execute v_def;
end
$migrate$;

-- 3. Source jurnal baru dilindungi seperti jurnal grosir lain -------------------------------------------------------
do $migrate$
declare v_def text; v_old text := $q$'sales-receipt-void',$q$; v_count integer;
begin
 v_def := pg_get_functiondef('public.guard_wholesale_journal()'::regprocedure);
 if position('sales-receipt-cabang' in v_def) > 0 then return; end if;
 v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
 if v_count < 1 then raise exception 'guard_wholesale_journal: daftar source tidak ditemukan'; end if;
 v_def := replace(v_def, v_old, $q$'sales-receipt-void','sales-receipt-cabang','sales-receipt-void-cbg',$q$);
 execute v_def;
end
$migrate$;
