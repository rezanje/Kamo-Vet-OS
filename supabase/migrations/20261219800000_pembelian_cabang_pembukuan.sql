-- Pembelian: pilihan 'Cabang pembukuan' untuk pembayaran faktur (permintaan Mba Anisa, 27 Nov 2026).
-- Semua pembelian dibukukan di cabang DC, tetapi uang kadang keluar dari kas toko (mis. Kas Toko CMGG).
-- Sebelumnya jurnal pembayaran ('purchase-pay') SELALU memakai cabang faktur, sehingga buku kas cabang toko tidak berkurang.
-- Sekarang pay_purchase_invoice_atomic dan pay_purchase_payment_order_atomic menerima p_journal_branch (default null).
--   * null = cabang faktur (perilaku lama, tidak berubah). Hutang (purchase_invoices / purchase_invoice_payments) TETAP milik cabang faktur.
--   * cabang terpilih harus cabang aktif yang bisa diakses pemakai; akses Kas & Bank berlaku untuk cabang faktur DAN cabang terpilih.
--   * cabang terpilih masuk ke isi permintaan (payload): pengulangan kunci yang sama dengan cabang lain ditolak; payload lama
--     (tanpa kunci) dianggap null. recover_purchase_payment membandingkan dengan cara yang sama.
--   * cancel_purchase_payment (juga jalur pembatalan uang muka bertingkat) membalik jurnal di cabang JURNAL ASLI, dan menolak bila
--     cabang jurnal berbeda dari yang tercatat pada bukti simpan.
-- Fungsi lama 9 argumen / 6 argumen diganti oleh fungsi dengan 1 argumen tambahan ber-default (tanpa overload, supaya PostgREST
-- tidak ambigu); pemanggil lama dengan argumen bernama tetap jalan. purchase_payment_source tidak diubah: ia sudah menuntut
-- journal_entries.branch_id = cabang yang diberikan pemanggil (sekarang cabang jurnal).
-- Tidak ada baris data yang diubah.
do $gate$ begin
 if md5(pg_get_functiondef('public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid,uuid)'::regprocedure))<>'cc10932dddf47630b30b7acb19501147' then raise exception 'PCB_GATE: pay_purchase_invoice_atomic berubah sejak migrasi ini ditulis; tulis ulang dari definisi terbaru';end if;
 if md5(pg_get_functiondef('public.pay_purchase_payment_order_atomic(text,uuid,date,text,uuid,integer)'::regprocedure))<>'81396f860c01e9ca15f23e1809274880' then raise exception 'PCB_GATE: pay_purchase_payment_order_atomic berubah sejak migrasi ini ditulis; tulis ulang dari definisi terbaru';end if;
 if md5(pg_get_functiondef('public.cancel_purchase_payment(uuid,integer,text,text,date)'::regprocedure))<>'2107f30206c0c3bb4c96d12e7ef693e1' then raise exception 'PCB_GATE: cancel_purchase_payment berubah sejak migrasi ini ditulis; tulis ulang dari definisi terbaru';end if;
 if md5(pg_get_functiondef('public.recover_purchase_payment(text,jsonb)'::regprocedure))<>'7570d32dd05bb10ea9c5a6f0892d198e' then raise exception 'PCB_GATE: recover_purchase_payment berubah sejak migrasi ini ditulis; tulis ulang dari definisi terbaru';end if;
end $gate$;
drop function public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid,uuid);
CREATE OR REPLACE FUNCTION public.pay_purchase_invoice_atomic(p_request_key text, p_invoice_id uuid, p_tanggal date, p_amount numeric, p_metode text, p_catatan text, p_account_id uuid, p_advance_id uuid, p_replaces_payment_id uuid DEFAULT NULL::uuid, p_journal_branch uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 inv public.purchase_invoices%rowtype; adv public.purchase_advances%rowtype;
 prior public.purchase_payment_requests%rowtype; payload jsonb; result jsonb;cash_source jsonb;
 v_po_id uuid; branch uuid; cash_code text; paid numeric; returns_left numeric:=0; residual numeric; available numeric:=0; from_advance numeric:=0;
 r record; payment_id uuid:=gen_random_uuid(); v_journal_id uuid; lines jsonb;
 rule_id uuid; approval_id uuid; jbranch uuid;
begin
  perform admin_online_private.deny_admin_online();
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 if p_request_key is null or length(p_request_key) not between 1 and 120 or p_amount is null or p_amount<>round(p_amount,2) or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_tanggal is null then raise exception 'Nominal atau identitas pembayaran tidak valid' using errcode='22023';end if;
 payload:=jsonb_build_object('invoice_id',p_invoice_id,'tanggal',p_tanggal,'amount',p_amount,'metode',p_metode,'catatan',p_catatan,'account_id',p_account_id,'advance_id',p_advance_id,'replaces_payment_id',p_replaces_payment_id,'journal_branch_id',p_journal_branch);
 -- No locks are acquired on an invoice before its PO: returns use this order too.
 select i.po_id into v_po_id from public.purchase_invoices i where i.id=p_invoice_id;
 if v_po_id is not null then perform 1 from public.purchase_orders where id=v_po_id for update;end if;
 if v_po_id is not null then perform 1 from public.purchase_invoices i where i.po_id=v_po_id order by id for update;end if;
 select * into inv from public.purchase_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Faktur tidak ditemukan';end if;
 branch:=inv.branch_id;if branch is null and inv.po_id is not null then select branch_id into branch from public.purchase_orders where id=inv.po_id;end if;
 if inv.voided_at is not null then raise exception 'Faktur sudah dibatalkan';end if;
 perform public.purchase_payment_scope(branch,p_account_id);
 jbranch:=coalesce(p_journal_branch,branch);
 if jbranch is distinct from branch then
  perform 1 from public.branches where id=jbranch and is_active for share;
  if not found then raise exception 'Cabang pembukuan tidak ditemukan atau tidak aktif' using errcode='22023';end if;
  if not public.user_can_access_branch(jbranch) then raise exception 'Cabang pembukuan tidak dapat diakses' using errcode='42501';end if;
  perform public.purchase_payment_scope(jbranch,p_account_id);
 end if;
 perform public.purchase_payment_period(p_tanggal,p_tanggal);
 perform pg_advisory_xact_lock(hashtext('vetos:purchase-payment:'||auth.uid()::text||':'||p_request_key)::bigint);
 select * into prior from public.purchase_payment_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then if (prior.payload||jsonb_build_object('replaces_payment_id',prior.payload->'replaces_payment_id','journal_branch_id',prior.payload->'journal_branch_id'))<>payload then raise exception 'Permintaan pembayaran sudah digunakan dengan rincian berbeda' using errcode='22023';end if;perform public.purchase_payment_source((prior.result->>'journal_id')::uuid,jbranch);return prior.result;end if;
 if p_replaces_payment_id is not null then
  if not exists(select 1 from public.purchase_invoice_payments where id=p_replaces_payment_id and invoice_id=inv.id and voided_at is not null and reversal_of is null and payment_order_id is null) then raise exception 'Pembayaran pengganti tidak sesuai sumber yang dibatalkan';end if;
  if exists(select 1 from public.purchase_invoice_payments where replaces_payment_id=p_replaces_payment_id) then raise exception 'Pembayaran pengganti sudah tersimpan. Buka riwayat faktur';end if;
  perform public.purchase_effective_date_check('payment-replace',p_tanggal,(select p.tanggal from public.purchase_invoice_payments p where p.id=p_replaces_payment_id),p_catatan,'pembayaran yang dibatalkan',false);
 end if;
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and p_tanggal<=closed_until) then raise exception 'Periode akuntansi sudah ditutup';end if;
 -- Allocate PO returns against outstanding invoices in the same due-date order as Hutang.
 if inv.po_id is not null then
  select coalesce(sum(total),0) into returns_left from public.purchase_returns where voided_at is null and purchase_returns.po_id=inv.po_id;
  for r in select i.id,i.total from public.purchase_invoices i where i.po_id=inv.po_id and i.voided_at is null order by i.jatuh_tempo,i.id loop
   select coalesce(sum(amount),0) into paid from public.purchase_invoice_payments where invoice_id=r.id;
   residual:=greatest(0,r.total-paid);
   available:=greatest(0,residual-returns_left);
   returns_left:=greatest(0,returns_left-residual);
   if r.id=inv.id then exit;end if;
  end loop;
 else
  select coalesce(sum(amount),0) into paid from public.purchase_invoice_payments where invoice_id=inv.id;
  available:=greatest(0,inv.total-paid);
 end if;
 if p_amount>available then raise exception 'Nominal melebihi sisa faktur setelah pembayaran dan retur' using errcode='22003';end if;
 if p_amount<>round(p_amount,0) and p_amount<>available then raise exception 'Nominal bersen hanya untuk melunasi sisa faktur persis (sisa Rp %). Cicilan harus rupiah bulat.',available using errcode='22023';end if;
 if p_advance_id is not null then
  select * into adv from public.purchase_advances where id=p_advance_id for update;
  if not found or adv.status<>'aktif' then raise exception 'Uang muka tidak tersedia';end if;
  if adv.supplier_id is distinct from inv.supplier_id or adv.supplier_id is null then raise exception 'Uang muka milik pemasok lain';end if;
  if adv.po_id is not null and adv.po_id is distinct from inv.po_id then raise exception 'Uang muka terkait PO lain';end if;
  if adv.account_id is not null then perform public.purchase_payment_scope(branch,adv.account_id);end if;
  if adv.terpakai is distinct from (select coalesce(sum(dari_uang_muka),0) from public.purchase_invoice_payments where advance_id=adv.id) then raise exception 'Alokasi uang muka lama perlu direkonsiliasi';end if;
  from_advance:=least(p_amount,greatest(0,adv.jumlah-adv.terpakai));
  if from_advance<=0 then raise exception 'Uang muka sudah habis terpakai';end if;
  if from_advance<>round(from_advance,2) then raise exception 'Porsi uang muka maksimal 2 angka desimal' using errcode='22023';end if;
 end if;
 -- Preserve approval thresholds and latest live request; consume only in this transaction.
 select id into rule_id from public.approval_rules where jenis='bayar-faktur' and is_active and p_amount>min_nilai order by min_nilai desc limit 1;
 if rule_id is not null then
  select id into approval_id from public.approval_requests where jenis='bayar-faktur' and ref_id=inv.id::text and status in ('menunggu','disetujui','ditolak') order by diajukan_at desc limit 1 for update;
  if approval_id is null or not exists(select 1 from public.approval_requests where id=approval_id and status='disetujui' and nilai>=p_amount) then raise exception 'Transaksi ini butuh persetujuan atasan';end if;
  update public.approval_requests set status='terpakai' where id=approval_id;
 end if;
 cash_source:=public.purchase_payment_cash(p_metode,jbranch,p_account_id);cash_code:=cash_source->>'code';
 lines:=jsonb_build_array(jsonb_build_object('code','311001','debit',p_amount,'credit',0));
 if from_advance>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','160001','debit',0,'credit',least(p_amount,from_advance)));end if;
 if p_amount>from_advance then lines:=lines||jsonb_build_array(jsonb_build_object('code',cash_code,'debit',0,'credit',p_amount-from_advance));end if;
 insert into public.purchase_invoice_payments(id,invoice_id,tanggal,amount,metode,catatan,created_by,advance_id,dari_uang_muka,replaces_payment_id) values(payment_id,inv.id,p_tanggal,p_amount,p_metode,p_catatan,auth.uid(),p_advance_id,from_advance,p_replaces_payment_id);
 if from_advance>0 then update public.purchase_advances set terpakai=terpakai+from_advance where id=adv.id;end if;
 v_journal_id:=public.clinic_write_journal(p_tanggal,'Pembayaran faktur '||inv.no_faktur||case when from_advance>0 then ' (pakai uang muka)' else '' end,'purchase-pay',inv.no_faktur,jbranch,lines);
 if v_journal_id is null then raise exception 'Jurnal pembayaran belum tersimpan';end if;
 update public.purchase_invoice_payments set journal_id=v_journal_id where id=payment_id;
 if p_replaces_payment_id is not null then perform public.purchase_backdate_record('payment-replace',payment_id,inv.no_faktur,jbranch,p_tanggal,(select p.tanggal from public.purchase_invoice_payments p where p.id=p_replaces_payment_id),p_catatan,v_journal_id,p_request_key);end if;
 result:=jsonb_build_object('payment_id',payment_id,'journal_id',v_journal_id,'no_faktur',inv.no_faktur,'cash_source',cash_source,'journal_branch_id',jbranch);
 perform public.purchase_payment_scope(jbranch,(cash_source->>'account_id')::uuid);
 insert into public.purchase_payment_requests values(auth.uid(),p_request_key,payload,result);
 return result;
end;
$function$;
revoke all on function public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid,uuid,uuid) to authenticated,service_role;
drop function public.pay_purchase_payment_order_atomic(text,uuid,date,text,uuid,integer);
CREATE OR REPLACE FUNCTION public.pay_purchase_payment_order_atomic(p_request_key text, p_order_id uuid, p_tanggal date, p_metode text, p_account_id uuid, p_expected_revision integer DEFAULT 0, p_journal_branch uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 ord public.payment_orders%rowtype; prior public.purchase_payment_requests%rowtype;
 payload jsonb; result jsonb;cash_source jsonb; role_name text; r record; other record; branch uuid;
 order_before jsonb;payment_ids jsonb;v_rp date;v_rp_reason text;cash_code text; v_total numeric:=0; paid numeric; ret numeric; avail numeric; residual numeric; v_journal_id uuid; jbranch uuid;
begin
  perform admin_online_private.deny_admin_online();
 perform public.purchase_payment_access(null);
 select role::text into role_name from public.profiles where id=auth.uid() and is_active;
 if role_name not in ('OWNER','ADMIN','ADMIN_UMUM') then raise exception 'Hanya pemilik/admin yang dapat membayar perintah bayar' using errcode='42501';end if;
 if p_request_key is null or length(p_request_key) not between 1 and 120 or p_tanggal is null then raise exception 'Identitas pembayaran tidak valid' using errcode='22023';end if;
 payload:=jsonb_build_object('order_id',p_order_id,'tanggal',p_tanggal,'metode',p_metode,'account_id',p_account_id,'revision',p_expected_revision,'journal_branch_id',p_journal_branch);
 select * into ord from public.payment_orders where id=p_order_id for update;
 if not found then raise exception 'Perintah bayar tidak ditemukan';end if;
 perform 1 from public.payment_order_items where order_id=ord.id order by id for update;
 if not exists(select 1 from public.payment_order_items where order_id=ord.id) then raise exception 'Perintah bayar tidak punya baris faktur';end if;
 -- All POs first, sorted; then all invoices in those POs, sorted, including direct invoices.
 perform 1 from public.purchase_orders p where p.id in(select i.po_id from public.payment_order_items b join public.purchase_invoices i on i.id=b.invoice_id where b.order_id=ord.id) order by p.id for update;
 perform 1 from public.purchase_invoices i where i.po_id in(select i2.po_id from public.payment_order_items b join public.purchase_invoices i2 on i2.id=b.invoice_id where b.order_id=ord.id) or i.id in(select invoice_id from public.payment_order_items where order_id=ord.id) order by i.id for update;
 perform public.purchase_payment_period(p_tanggal,p_tanggal);
 perform pg_advisory_xact_lock(hashtext('vetos:purchase-payment:'||auth.uid()::text||':'||p_request_key)::bigint);
 select * into prior from public.purchase_payment_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if (prior.payload||jsonb_build_object('revision',coalesce(prior.payload->'revision','0'::jsonb),'journal_branch_id',prior.payload->'journal_branch_id'))<>payload then raise exception 'Permintaan pembayaran sudah digunakan dengan rincian berbeda' using errcode='22023';end if;
  for r in select coalesce(i.branch_id,p.branch_id) branch_id from public.payment_order_items b join public.purchase_invoices i on i.id=b.invoice_id left join public.purchase_orders p on p.id=i.po_id where b.order_id=ord.id loop perform public.purchase_payment_scope(r.branch_id,p_account_id);end loop;
  select branch_id into branch from public.journal_entries where id=(prior.result->>'journal_id')::uuid;
  if p_journal_branch is not null and branch is distinct from p_journal_branch then raise exception 'Cabang pembukuan tidak sesuai jurnal pembayaran' using errcode='22023';end if;
  perform public.purchase_payment_source((prior.result->>'journal_id')::uuid,branch);
  return prior.result;
 end if;
 if (select count(distinct coalesce(coalesce(i.branch_id,p.branch_id)::text,'global')) from public.payment_order_items b join public.purchase_invoices i on i.id=b.invoice_id left join public.purchase_orders p on p.id=i.po_id where b.order_id=ord.id)<>1 then raise exception 'Perintah bayar harus satu cabang';end if;
 if ord.revision is distinct from p_expected_revision then raise exception 'Perintah bayar sudah berubah. Muat ulang';end if;
 order_before:=to_jsonb(ord);
 if exists(select 1 from public.purchase_invoice_payments where payment_order_id=ord.id and reversal_of is null and voided_at is null) then raise exception 'Perintah bayar sudah memiliki pembayaran aktif';end if;
 if ord.status<>'disetujui' then raise exception 'Perintah bayar belum disetujui';end if;
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and p_tanggal<=closed_until) then raise exception 'Periode akuntansi sudah ditutup';end if;
 select min(p.tanggal) into v_rp from public.purchase_invoice_payments p where p.payment_order_id=ord.id and p.voided_at is not null and p.reversal_of is null;
 if v_rp is not null then
  -- Alasan = alasan pembatalan yang tercatat untuk perintah bayar ini (fungsi ini tidak punya kolom alasan sendiri).
  select c.reason into v_rp_reason from public.purchase_payment_cancellations c where c.payment_order_id=ord.id order by c.created_at desc limit 1;
  perform public.purchase_effective_date_check('payment-replace',p_tanggal,v_rp,v_rp_reason,'pembayaran yang dibatalkan',false);
 end if;

 for r in select i.id,i.total,i.po_id,coalesce(i.branch_id,p.branch_id) branch_id,sum(b.jumlah) amount from public.payment_order_items b join public.purchase_invoices i on i.id=b.invoice_id left join public.purchase_orders p on p.id=i.po_id where b.order_id=ord.id group by i.id,p.branch_id order by i.id loop
  perform public.purchase_payment_scope(r.branch_id,p_account_id);
  if branch is null then branch:=r.branch_id;elsif branch is distinct from r.branch_id then raise exception 'Perintah bayar harus satu cabang';end if;
  if not exists(select 1 from public.purchase_invoices where id=r.id and supplier_id=ord.supplier_id) then raise exception 'Pemasok faktur tidak sesuai perintah bayar';end if;
  if r.po_id is not null then
   select coalesce(sum(total),0) into ret from public.purchase_returns where voided_at is null and po_id=r.po_id;
   for other in select id,total from public.purchase_invoices where po_id=r.po_id and voided_at is null order by jatuh_tempo,id loop
    select coalesce(sum(amount),0) into paid from public.purchase_invoice_payments where invoice_id=other.id;
    residual:=greatest(0,other.total-paid);avail:=greatest(0,residual-ret);ret:=greatest(0,ret-residual);
    if other.id=r.id then exit;end if;
   end loop;
  else select greatest(0,r.total-coalesce(sum(amount),0)) into avail from public.purchase_invoice_payments where invoice_id=r.id;end if;
  if r.amount<>round(r.amount) then raise exception 'Nominal pembayaran harus rupiah bulat' using errcode='22023';end if;
  if r.amount<=0 or r.amount>avail then raise exception 'Nominal melebihi sisa faktur setelah pembayaran dan retur' using errcode='22003';end if;
  insert into public.purchase_invoice_payments(invoice_id,tanggal,amount,metode,catatan,created_by,payment_order_id) values(r.id,p_tanggal,r.amount,p_metode,'Perintah bayar '||ord.no_pp,auth.uid(),ord.id);
  v_total:=v_total+r.amount;
 end loop;
 jbranch:=coalesce(p_journal_branch,branch);
 if jbranch is distinct from branch then
  perform 1 from public.branches where id=jbranch and is_active for share;
  if not found then raise exception 'Cabang pembukuan tidak ditemukan atau tidak aktif' using errcode='22023';end if;
  if not public.user_can_access_branch(jbranch) then raise exception 'Cabang pembukuan tidak dapat diakses' using errcode='42501';end if;
  perform public.purchase_payment_scope(jbranch,p_account_id);
 end if;
 cash_source:=public.purchase_payment_cash(p_metode,jbranch,p_account_id);cash_code:=cash_source->>'code';
 v_journal_id:=public.clinic_write_journal(p_tanggal,'Pembayaran hutang lewat '||ord.no_pp,'purchase-pay',ord.no_pp,jbranch,jsonb_build_array(jsonb_build_object('code','311001','debit',v_total,'credit',0),jsonb_build_object('code',cash_code,'debit',0,'credit',v_total)));
 if v_journal_id is null then raise exception 'Jurnal pembayaran belum tersimpan';end if;
 update public.purchase_invoice_payments set journal_id=v_journal_id where payment_order_id=ord.id and voided_at is null and reversal_of is null;
 select jsonb_agg(id order by id) into payment_ids from public.purchase_invoice_payments where journal_id=v_journal_id;
 update public.payment_orders set status='dibayar',paid_at=now(),revision=revision+1 where id=ord.id;
 if v_rp is not null then perform public.purchase_backdate_record('payment-replace',ord.id,ord.no_pp,jbranch,p_tanggal,v_rp,v_rp_reason,v_journal_id,p_request_key);end if;
 result:=jsonb_build_object('order_id',ord.id,'no_pp',ord.no_pp,'journal_id',v_journal_id,'payment_ids',payment_ids,'order_before',order_before,'cash_source',cash_source,'journal_branch_id',jbranch);
 perform public.purchase_payment_scope(jbranch,(cash_source->>'account_id')::uuid);
 insert into public.purchase_payment_requests values(auth.uid(),p_request_key,payload,result);
 return result;
end;$function$;
revoke all on function public.pay_purchase_payment_order_atomic(text,uuid,date,text,uuid,integer,uuid) from public,anon;
grant execute on function public.pay_purchase_payment_order_atomic(text,uuid,date,text,uuid,integer,uuid) to authenticated,service_role;
CREATE OR REPLACE FUNCTION public.cancel_purchase_payment(p_payment_id uuid, p_expected_revision integer, p_request_key text, p_reason text, p_tanggal date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pay public.purchase_invoice_payments%rowtype;ord public.payment_orders%rowtype;original public.journal_entries%rowtype;
 prior public.purchase_payment_cancellation_requests%rowtype;posting public.purchase_payment_requests%rowtype;adv public.purchase_advances%rowtype;
 payload jsonb;result jsonb;before_value jsonb;linked_ids jsonb;row record;branch uuid;jbranch uuid;
 v_order uuid;v_invoice uuid;v_po uuid;total numeric;advance_total numeric;debit_total numeric;credit_total numeric;ap_total numeric;advance_credit numeric;
 audit uuid:=gen_random_uuid();reversal uuid:=gen_random_uuid();today date:=(now() at time zone 'Asia/Jakarta')::date;
begin
  perform admin_online_private.deny_admin_online();
 if auth.uid() is null or auth.role() is distinct from 'authenticated' then raise exception 'Sesi login diperlukan' using errcode='42501';end if;
 if p_payment_id is null or p_expected_revision is null or p_expected_revision<0 or length(btrim(coalesce(p_request_key,''))) not between 1 and 120 or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 or p_tanggal is null then raise exception 'Identitas, alasan, atau tanggal pembatalan tidak valid';end if;
 -- MITIGASI_1111 R1: izin diperiksa SEBELUM kunci apa pun (pemeriksaan yang sama diulang setelah kunci, tetap ada).
 if not public.purchase_cancel_allowed('pembelian.batalkan_pembayaran') then raise exception 'Hanya Owner aktif (atau peran yang diberi izin Batalkan pembayaran di Akses Grup) dapat membatalkan pembayaran' using errcode='42501';end if;
 payload:=jsonb_build_object('payment_id',p_payment_id,'revision',p_expected_revision,'reason',btrim(p_reason),'tanggal',p_tanggal);
 perform pg_advisory_xact_lock(hashtextextended('vetos:purchase-payment-cancel:'||auth.uid()::text||':'||p_request_key,0));
 select payment_order_id,invoice_id into v_order,v_invoice from public.purchase_invoice_payments where id=p_payment_id;
 if not found then raise exception 'Pembayaran tidak ditemukan';end if;
 if v_order is not null then
  select * into ord from public.payment_orders where id=v_order for update;
  perform 1 from public.payment_order_items where order_id=v_order order by id for update;
 end if;
 select po_id into v_po from public.purchase_invoices where id=v_invoice;
 perform 1 from public.purchase_orders where id=v_po or id in(select i.po_id from public.purchase_invoice_payments p join public.purchase_invoices i on i.id=p.invoice_id where p.payment_order_id=v_order) order by id for update;
 perform 1 from public.purchase_invoices where id=v_invoice or po_id=v_po or po_id in(select i.po_id from public.purchase_invoice_payments p join public.purchase_invoices i on i.id=p.invoice_id where p.payment_order_id=v_order) or id in(select invoice_id from public.purchase_invoice_payments where payment_order_id=v_order) order by id for update;
 select * into pay from public.purchase_invoice_payments where id=p_payment_id for update;
 perform 1 from public.profiles where id=auth.uid() and is_active for share;
 if not found or not public.purchase_cancel_allowed('pembelian.batalkan_pembayaran') then raise exception 'Hanya Owner aktif (atau peran yang diberi izin Batalkan pembayaran di Akses Grup) dapat membatalkan pembayaran' using errcode='42501';end if;
 select coalesce(i.branch_id,p.branch_id) into branch from public.purchase_invoices i left join public.purchase_orders p on p.id=i.po_id where i.id=pay.invoice_id;
 perform public.purchase_payment_scope(branch);
 perform public.purchase_payment_period(pay.tanggal,p_tanggal);
 if pay.journal_id is null then raise exception 'Jurnal pembayaran lama tidak memiliki tautan pasti; rekonsiliasi diperlukan';end if;
 select * into original from public.journal_entries where id=pay.journal_id for update;
 if not found then raise exception 'Jurnal pembayaran sumber tidak ditemukan';end if;
 jbranch:=original.branch_id;
 perform public.purchase_payment_scope(jbranch);
 perform public.purchase_payment_period(original.tanggal,p_tanggal);
 perform 1 from public.purchase_invoice_payments where journal_id=original.id order by id for update;
 for row in select coalesce(i.branch_id,o.branch_id) invoice_branch from public.purchase_invoice_payments p join public.purchase_invoices i on i.id=p.invoice_id left join public.purchase_orders o on o.id=i.po_id where p.journal_id=original.id loop
  perform public.purchase_payment_scope(row.invoice_branch);
  if row.invoice_branch is distinct from branch then raise exception 'Pembayaran sumber mencampur cabang';end if;
 end loop;
 perform public.purchase_payment_source(original.id,jbranch);
 select * into prior from public.purchase_payment_cancellation_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then if prior.payload is distinct from payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda';end if;return prior.result;end if;
 if pay.reversal_of is not null or pay.voided_at is not null or pay.revision<>p_expected_revision then raise exception 'Pembayaran sudah berubah atau dibatalkan. Muat ulang';end if;
 perform public.purchase_effective_date_check('payment-cancel',p_tanggal,pay.tanggal,p_reason,'pembayaran',false);
 if original.source<>'purchase-pay' or original.branch_id is distinct from jbranch or original.tanggal<>pay.tanggal or original.voided_at is not null then raise exception 'Jurnal sumber tidak sesuai pembayaran';end if;
 if (select count(*) from public.purchase_payment_requests request where request.result->>'journal_id'=original.id::text)<>1 then raise exception 'Tautan jurnal pembayaran tidak unik';end if;
 select * into posting from public.purchase_payment_requests request where request.result->>'journal_id'=original.id::text;
 if coalesce((posting.payload->>'journal_branch_id')::uuid,branch) is distinct from jbranch then raise exception 'Cabang jurnal pembayaran tidak sesuai bukti simpan';end if;
 if v_order is null then
  if posting.result->>'payment_id' is distinct from pay.id::text or posting.payload->>'invoice_id' is distinct from pay.invoice_id::text
   or original.source_ref is distinct from (select no_faktur from public.purchase_invoices where id=pay.invoice_id)
   or (select count(*) from public.purchase_invoice_payments where journal_id=original.id)<>1 then raise exception 'Pembayaran sumber tidak cocok dengan bukti simpan';end if;
 else
  select jsonb_agg(id order by id) into linked_ids from public.purchase_invoice_payments where journal_id=original.id;
  if posting.result->>'order_id' is distinct from v_order::text or posting.result->'payment_ids' is distinct from linked_ids
   or posting.result->'order_before'->>'status' is distinct from 'disetujui' or ord.status<>'dibayar'
   or ord.revision is distinct from (posting.result->'order_before'->>'revision')::integer+1
   or original.source_ref is distinct from ord.no_pp then raise exception 'Bukti perintah bayar tidak lengkap atau sudah berubah';end if;
  if exists(select 1 from public.purchase_invoice_payments where payment_order_id=v_order and voided_at is null and reversal_of is null and journal_id is distinct from original.id)
   or exists(select 1 from public.purchase_invoice_payments where journal_id=original.id and payment_order_id is distinct from v_order) then raise exception 'Pembayaran perintah bayar tidak dapat dipisahkan';end if;
 end if;
 if exists(select 1 from public.purchase_invoice_payments where journal_id=original.id and (voided_at is not null or reversal_of is not null or tanggal<>original.tanggal or amount<>round(amount,2) or dari_uang_muka<>round(dari_uang_muka,2))) then raise exception 'Rincian pembayaran sumber tidak valid';end if;
 select sum(amount),sum(dari_uang_muka) into total,advance_total from public.purchase_invoice_payments where journal_id=original.id;
 perform 1 from public.journal_lines where entry_id=original.id order by id for update;
 select sum(l.debit),sum(l.credit),coalesce(sum(l.debit-l.credit) filter(where a.code='311001'),0),coalesce(sum(l.credit-l.debit) filter(where a.code='160001'),0)
 into debit_total,credit_total,ap_total,advance_credit from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=original.id;
 if total is null or debit_total is distinct from total or credit_total is distinct from total or ap_total is distinct from total or advance_credit is distinct from advance_total
  or exists(select 1 from public.journal_lines where entry_id=original.id and (debit<0 or credit<0 or debit<>round(debit,2) or credit<>round(credit,2) or (debit>0 and credit>0))) then raise exception 'Jurnal pembayaran tidak lengkap atau tidak cocok dengan alokasi';end if;
 -- Posting locks the advance before writing its journal; cancellation must use the same order.
 perform 1 from public.purchase_advances where id in(select advance_id from public.purchase_invoice_payments where journal_id=original.id and dari_uang_muka>0) order by id for update;
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 perform public.purchase_payment_source(original.id,jbranch);
 -- Bank reconciliation freezes the account balance through its statement date.
 if exists(select 1 from public.bank_reconciliations r join public.cash_accounts a on a.id=r.cash_account_id join public.coa_accounts c on c.code=coalesce(r.bank_coa_code,a.coa_code) join public.journal_lines l on l.account_id=c.id
  where l.entry_id=original.id and r.voided_at is null and r.tanggal>=original.tanggal) then raise exception 'Rekonsiliasi bank sudah mencakup pembayaran. Koreksi rekonsiliasi dahulu';end if;
 before_value:=jsonb_build_object('payments',(select jsonb_agg(to_jsonb(p) order by id) from public.purchase_invoice_payments p where journal_id=original.id),'order',to_jsonb(ord),'journal',to_jsonb(original),'lines',(select jsonb_agg(to_jsonb(l) order by id) from public.journal_lines l where entry_id=original.id));
 for row in select advance_id,sum(dari_uang_muka) used from public.purchase_invoice_payments where journal_id=original.id and dari_uang_muka>0 group by advance_id order by advance_id loop
  select * into adv from public.purchase_advances where id=row.advance_id;
  if not found or adv.status<>'aktif' or adv.terpakai<row.used or adv.terpakai is distinct from (select coalesce(sum(dari_uang_muka),0) from public.purchase_invoice_payments where advance_id=adv.id) then raise exception 'Alokasi uang muka sudah berubah; rekonsiliasi diperlukan';end if;
  if adv.account_id is not null then perform public.purchase_payment_scope(jbranch,adv.account_id);end if;
  if exists(select 1 from public.purchase_invoice_payments p join public.purchase_invoices i on i.id=p.invoice_id where p.journal_id=original.id and p.advance_id=adv.id and (i.supplier_id is distinct from adv.supplier_id or (adv.po_id is not null and adv.po_id is distinct from i.po_id))) then raise exception 'Sumber uang muka tidak sesuai faktur';end if;
  update public.purchase_advances set terpakai=terpakai-row.used where id=adv.id;
 end loop;
 insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values(reversal,public.sales_next_number('JRN',p_tanggal),p_tanggal,'Pembatalan pembayaran hutang'||case when p_tanggal<today then ' (dibukukan mundur ke '||p_tanggal||', dicatat '||today||')' else '' end,'purchase-pay-void',audit::text,jbranch);
 insert into public.journal_lines(entry_id,account_id,debit,credit) select reversal,account_id,credit,debit from public.journal_lines where entry_id=original.id;
 insert into public.purchase_invoice_payments(invoice_id,tanggal,amount,metode,catatan,created_by,advance_id,dari_uang_muka,payment_order_id,reversal_of,journal_id)
 select invoice_id,p_tanggal,-amount,metode,btrim(p_reason),auth.uid(),advance_id,-dari_uang_muka,payment_order_id,id,reversal from public.purchase_invoice_payments where journal_id=original.id;
 update public.purchase_invoice_payments set voided_at=now(),revision=revision+1 where journal_id=original.id;
 if v_order is not null then update public.payment_orders set status='disetujui',paid_at=null,revision=revision+1 where id=v_order;end if;
 insert into public.purchase_payment_cancellations(id,payment_id,payment_order_id,reason,before_value,original_journal_id,reversal_journal_id,created_by) values(audit,pay.id,v_order,btrim(p_reason),before_value,original.id,reversal,auth.uid());
 perform public.purchase_backdate_record('payment-cancel',pay.id,(select i.no_faktur from public.purchase_invoices i where i.id=pay.invoice_id),jbranch,p_tanggal,pay.tanggal,btrim(p_reason),reversal,p_request_key);
 result:=jsonb_build_object('payment_id',pay.id,'invoice_id',pay.invoice_id,'order_id',v_order,'cancellation_id',audit,'reversal_journal_id',reversal,'tanggal',p_tanggal);
 perform public.purchase_payment_source(original.id,jbranch);
 insert into public.purchase_payment_cancellation_requests values(auth.uid(),p_request_key,payload,result);
 return result;
end$function$;
CREATE OR REPLACE FUNCTION public.recover_purchase_payment(p_request_key text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prior public.purchase_payment_requests%rowtype;branch uuid;jbranch uuid;begin
  perform admin_online_private.deny_admin_online();
 perform public.purchase_payment_access(null);
 select * into prior from public.purchase_payment_requests where actor_id=auth.uid() and request_key=p_request_key;
 if not found then return null;end if;
 if not (prior.payload ? 'invoice_id') then raise exception 'Jenis permintaan pembayaran berbeda' using errcode='22023';end if;
 -- Older requests predate the optional replacement link.
 if (prior.payload||jsonb_build_object('replaces_payment_id',prior.payload->'replaces_payment_id','journal_branch_id',prior.payload->'journal_branch_id')) is distinct from (p_payload||jsonb_build_object('replaces_payment_id',p_payload->'replaces_payment_id','journal_branch_id',p_payload->'journal_branch_id')) then raise exception 'Permintaan pembayaran sudah digunakan dengan rincian berbeda' using errcode='22023';end if;
 select coalesce(i.branch_id,p.branch_id) into branch from public.purchase_invoices i left join public.purchase_orders p on p.id=i.po_id where i.id=(prior.payload->>'invoice_id')::uuid;
 if not found then raise exception 'Faktur hasil pembayaran tidak ditemukan';end if;
 perform public.purchase_payment_scope(branch,(prior.payload->>'account_id')::uuid);
 select e.branch_id into jbranch from public.journal_entries e where e.id=(prior.result->>'journal_id')::uuid;
 if not found then jbranch:=branch;end if;
 if coalesce((prior.payload->>'journal_branch_id')::uuid,branch) is distinct from jbranch then raise exception 'Cabang jurnal pembayaran tidak sesuai bukti simpan';end if;
 perform public.purchase_payment_scope(jbranch,(prior.payload->>'account_id')::uuid);
 perform public.purchase_payment_period((prior.payload->>'tanggal')::date,(prior.payload->>'tanggal')::date);
 perform public.purchase_payment_source((prior.result->>'journal_id')::uuid,jbranch);
 return prior.result;
end$function$;

do $check$
declare i text:=pg_get_functiondef('public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid,uuid,uuid)'::regprocedure);
 o text:=pg_get_functiondef('public.pay_purchase_payment_order_atomic(text,uuid,date,text,uuid,integer,uuid)'::regprocedure);
 c text:=pg_get_functiondef('public.cancel_purchase_payment(uuid,integer,text,text,date)'::regprocedure);
 r text:=pg_get_functiondef('public.recover_purchase_payment(text,jsonb)'::regprocedure);
begin
 if (select count(*) from pg_proc where proname in('pay_purchase_invoice_atomic','pay_purchase_payment_order_atomic') and pronamespace='public'::regnamespace)<>2 then raise exception 'PCB_CHECK: overload ganda pay_purchase_*';end if;
 if i !~ 'p_journal_branch' or i !~ 'clinic_write_journal\(p_tanggal,[^;]*jbranch,lines\)' or i !~ 'Cabang pembukuan tidak dapat diakses' or i !~ 'Cabang pembukuan tidak ditemukan atau tidak aktif'
    or i !~ 'admin_online_private.deny_admin_online' or i !~ 'journal_branch_id' then raise exception 'PCB_CHECK: pay_purchase_invoice_atomic';end if;
 if o !~ 'p_journal_branch' or o !~ 'ord.no_pp,jbranch' or o !~ 'Cabang pembukuan tidak dapat diakses' or o !~ 'admin_online_private.deny_admin_online' or o !~ 'journal_branch_id' then raise exception 'PCB_CHECK: pay_purchase_payment_order_atomic';end if;
 if c !~ 'jbranch:=original.branch_id' or c !~ 'audit::text,jbranch' or c !~ 'Cabang jurnal pembayaran tidak sesuai bukti simpan' or c !~ 'admin_online_private.deny_admin_online' then raise exception 'PCB_CHECK: cancel_purchase_payment';end if;
 if r !~ 'jbranch' or r !~ 'journal_branch_id' or r !~ 'admin_online_private.deny_admin_online' then raise exception 'PCB_CHECK: recover_purchase_payment';end if;
 if has_function_privilege('anon','public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid,uuid,uuid)','execute')
    or has_function_privilege('anon','public.pay_purchase_payment_order_atomic(text,uuid,date,text,uuid,integer,uuid)','execute')
    or not has_function_privilege('authenticated','public.pay_purchase_invoice_atomic(text,uuid,date,numeric,text,text,uuid,uuid,uuid,uuid)','execute')
    or not has_function_privilege('authenticated','public.pay_purchase_payment_order_atomic(text,uuid,date,text,uuid,integer,uuid)','execute') then raise exception 'PCB_CHECK: hak eksekusi';end if;
end$check$;
