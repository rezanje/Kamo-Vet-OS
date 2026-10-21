-- B2B invoice recording corrections. Physical delivery/FIFO and original receipts
-- are retained. Customer credit is a liability record, never a money transfer.
alter table public.sales_invoices
 add column revision integer not null default 0,
 add column carried_paid numeric(15,2) not null default 0 check(carried_paid>=0),
 add column voided_on date,
 add column void_reason text,
 add column replaces_invoice_id uuid unique references public.sales_invoices(id);
alter table public.sales_receipts add column journal_id uuid unique references public.journal_entries(id);
create table public.wholesale_invoice_corrections(
 id uuid primary key default gen_random_uuid(), invoice_id uuid not null unique references public.sales_invoices(id),
 replacement_id uuid unique references public.sales_invoices(id),
 action text not null check(action in ('replace','cancel')), reason text not null,
 tanggal date not null, before_value jsonb not null, after_value jsonb,
 original_journal_id uuid not null references public.journal_entries(id),
 reversal_journal_id uuid not null references public.journal_entries(id),
 replacement_journal_id uuid references public.journal_entries(id),
 credit_journal_id uuid references public.journal_entries(id),
 paid_preserved numeric(15,2) not null, customer_credit numeric(15,2) not null check(customer_credit>=0),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
create table public.wholesale_operation_requests(
 actor_id uuid not null references public.profiles(id), kind text not null check(kind in ('receipt','correction')),
 request_key text not null, invoice_id uuid not null references public.sales_invoices(id),
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 primary key(actor_id,kind,request_key)
);
alter table public.wholesale_invoice_corrections enable row level security;
alter table public.wholesale_operation_requests enable row level security;
revoke all on public.wholesale_invoice_corrections,public.wholesale_operation_requests from public,anon,authenticated,service_role;
grant select on public.wholesale_invoice_corrections to authenticated;
create policy wholesale_corrections_read on public.wholesale_invoice_corrections for select to authenticated
 using(exists(select 1 from public.sales_invoices i where i.id=invoice_id));

create function public.wholesale_access(p_branch uuid,p_owner boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where id=auth.uid() and is_active
  and (role='OWNER' or (not p_owner and role in ('ADMIN','FINANCE'))) for share;
 if not found then raise exception 'Koreksi grosir hanya oleh OWNER; penerimaan oleh OWNER/ADMIN/FINANCE aktif' using errcode='42501';end if;
 perform public.sales_assert_access(p_branch);
 if p_branch is not null then
  perform 1 from public.branches where id=p_branch and is_active for share;
  if not found then raise exception 'Cabang grosir tidak aktif' using errcode='42501';end if;
 end if;
end$$;
revoke all on function public.wholesale_access(uuid,boolean) from public,anon,authenticated,service_role;
create function public.wholesale_period(p_original date,p_date date) returns void
language plpgsql security definer set search_path='' as $$
declare closed date;today date:=(now() at time zone 'Asia/Jakarta')::date;begin
 select closed_until into closed from public.accounting_locks where id for share;
 if p_original is null or p_date is null or not isfinite(p_original) or not isfinite(p_date) or p_original>today or p_date>today then raise exception 'Tanggal grosir tidak valid atau di masa depan';end if;
 if closed is not null and (p_original<=closed or p_date<=closed) then raise exception 'Periode sumber atau koreksi sudah ditutup';end if;
end$$;
revoke all on function public.wholesale_period(date,date) from public,anon,authenticated,service_role;

-- Restrict direct client writes without extending any role's permissions. Keep
-- the existing stock-opname invoice insert route outside the B2B family intact.
create function public.guard_wholesale_document() returns trigger
language plpgsql set search_path='' as $$
declare protected boolean:=false;begin
 if current_user not in ('authenticated','anon','service_role') then return coalesce(new,old);end if;
 if tg_table_name='sales_invoices' then
  protected:=new.order_id is not null or old.order_id is not null
   or coalesce(new.carried_paid,0)<>0 or coalesce(old.carried_paid,0)<>0
   or new.replaces_invoice_id is not null or old.replaces_invoice_id is not null
   or new.voided_on is not null or old.voided_on is not null or coalesce(new.revision,0)<>0 or coalesce(old.revision,0)<>0;
 elsif tg_table_name='sales_invoice_items' then
  protected:=exists(select 1 from public.sales_invoices where id in(new.invoice_id,old.invoice_id) and order_id is not null);
 elsif tg_table_name in ('sales_receipts','sales_deliveries','sales_delivery_items') then protected:=true;
 elsif tg_table_name='sales_orders' then
  protected:=exists(select 1 from public.sales_deliveries where order_id=old.id) or exists(select 1 from public.sales_invoices where order_id=old.id);
 elsif tg_table_name='sales_order_items' then
  protected:=exists(select 1 from public.sales_deliveries where order_id in(new.order_id,old.order_id))
   or exists(select 1 from public.sales_invoices where order_id in(new.order_id,old.order_id));
 end if;
 if protected then raise exception 'Dokumen grosir terlindungi; gunakan proses resmi dengan alasan dan audit' using errcode='42501';end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_wholesale_document() from public,anon,authenticated,service_role;
create trigger wholesale_invoice_guard before insert or update or delete on public.sales_invoices for each row execute function public.guard_wholesale_document();
create trigger wholesale_invoice_line_guard before insert or update or delete on public.sales_invoice_items for each row execute function public.guard_wholesale_document();
create trigger wholesale_receipt_guard before insert or update or delete on public.sales_receipts for each row execute function public.guard_wholesale_document();
create trigger wholesale_delivery_guard before insert or update or delete on public.sales_deliveries for each row execute function public.guard_wholesale_document();
create trigger wholesale_delivery_line_guard before insert or update or delete on public.sales_delivery_items for each row execute function public.guard_wholesale_document();
create trigger wholesale_order_guard before update or delete on public.sales_orders for each row execute function public.guard_wholesale_document();
create trigger wholesale_order_line_guard before insert or update or delete on public.sales_order_items for each row execute function public.guard_wholesale_document();
revoke insert,update,delete on public.sales_receipts,public.sales_deliveries,public.sales_delivery_items from authenticated,anon,service_role;

create function public.guard_wholesale_journal() returns trigger language plpgsql set search_path='' as $$
declare protected boolean;advance record;begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then
   protected:=new.source in ('sales-invoice','sales-delivery','sales-receipt','wholesale-invoice-void','wholesale-credit')
    or old.source in ('sales-invoice','sales-delivery','sales-receipt','wholesale-invoice-void','wholesale-credit');
  else
   select exists(select 1 from public.journal_entries where id in(new.entry_id,old.entry_id)
    and source in ('sales-invoice','sales-delivery','sales-receipt','wholesale-invoice-void','wholesale-credit')) into protected;
  end if;
  if not coalesce(protected,false) then
   -- A locking read sees committed usage after waiting and serializes journal
   -- line INSERT phantoms with the advance's first receipt allocation.
   if tg_table_name='journal_entries' then
    for advance in select a.* from public.sales_advances a where
     (new.source='sales-advance' and new.source_ref=a.no_um) or (old.source='sales-advance' and old.source_ref=a.no_um)
     order by a.id for share loop
      protected:=coalesce(protected,false) or advance.terpakai>0;
    end loop;
   else
    for advance in select a.* from public.sales_advances a where exists(select 1 from public.journal_entries j
     where j.id in(new.entry_id,old.entry_id) and j.source='sales-advance' and j.source_ref=a.no_um)
     order by a.id for share loop
      protected:=coalesce(protected,false) or advance.terpakai>0;
    end loop;
   end if;
  end if;
  if protected then raise exception 'Jurnal grosir hanya melalui proses resmi' using errcode='42501';end if;
 end if;return coalesce(new,old);
end$$;
revoke all on function public.guard_wholesale_journal() from public,anon,authenticated,service_role;
create trigger wholesale_journal_guard before insert or update or delete on public.journal_entries for each row execute function public.guard_wholesale_journal();
create trigger wholesale_journal_line_guard before insert or update or delete on public.journal_lines for each row execute function public.guard_wholesale_journal();

-- Lock account rows before posting; all source journals use the established writer.
create function public.wholesale_write_journal(p_date date,p_branch uuid,p_source text,p_ref text,p_description text,p_lines jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare journal uuid;begin
 perform 1 from public.coa_accounts where code in(select x.code from jsonb_to_recordset(p_lines) as x(code text)) order by id for share;
 perform public.sales_write_journal(p_date,p_branch,p_source,p_ref,p_description,p_lines);
 select id into strict journal from public.journal_entries where source=p_source and source_ref=p_ref;
 return journal;
end$$;
revoke all on function public.wholesale_write_journal(date,uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;

-- Exact aggregate equality fails closed on legacy journals with missing/extra
-- lines. Receipts already recorded are evidence, never deleted or re-posted.
create function public.wholesale_assert_journal(p_id uuid,p_source text,p_ref text,p_date date,p_branch uuid,p_expected jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare actual jsonb;expected jsonb;begin
 perform 1 from public.journal_entries where id=p_id and source=p_source and source_ref=p_ref and tanggal=p_date and branch_id is not distinct from p_branch and voided_at is null for share;
 if not found then raise exception 'Rekonsiliasi jurnal sumber grosir diperlukan';end if;
 perform 1 from public.journal_lines where entry_id=p_id order by id for share;
 select jsonb_agg(jsonb_build_object('code',code,'debit',debit,'credit',credit) order by code) into actual from (
  select a.code,sum(l.debit) debit,sum(l.credit) credit from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where entry_id=p_id group by a.code) t;
 select jsonb_agg(to_jsonb(t) order by code) into expected from (
  select code,sum(debit) debit,sum(credit) credit from jsonb_to_recordset(p_expected) as x(code text,debit numeric,credit numeric) where debit>0 or credit>0 group by code) t;
 if actual is distinct from expected then raise exception 'Rekonsiliasi nilai jurnal sumber grosir diperlukan';end if;
end$$;
revoke all on function public.wholesale_assert_journal(uuid,text,text,date,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.receive_wholesale_payment(p_request_key text,p_invoice_id uuid,p_tanggal date,p_amount numeric,p_metode text,p_account_id uuid,p_advance_id uuid,p_catatan text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare inv public.sales_invoices%rowtype;adv public.sales_advances%rowtype;prior public.wholesale_operation_requests%rowtype;
 ord uuid;payload jsonb;result jsonb;paid numeric;from_advance numeric:=0;cash_code text;cash_id uuid:=p_account_id;
 account public.cash_accounts%rowtype;mapping public.payment_account_map%rowtype;lines jsonb:='[]';receipt uuid:=gen_random_uuid();journal uuid;number text;prefix text;seq bigint;next_seq bigint;advance_journal uuid;advance_cash text;advance_branch uuid;
begin
 select order_id into ord from public.sales_invoices where id=p_invoice_id;
 if ord is not null then perform 1 from public.sales_orders where id=ord for update;end if;
 select * into inv from public.sales_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Faktur tidak ditemukan' using errcode='42501';end if;
 perform public.wholesale_access(inv.branch_id,false);
 if p_request_key is null or length(btrim(p_request_key)) not between 1 and 120 or p_amount is null or p_amount<=0 or p_amount>1000000000000 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount<>round(p_amount,2)
  or p_metode is null or p_metode not in ('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') or length(coalesce(p_catatan,''))>1000 then raise exception 'Data penerimaan tidak valid' using errcode='22023';end if;
 payload:=jsonb_build_object('invoice_id',p_invoice_id,'tanggal',p_tanggal,'amount',p_amount,'metode',p_metode,'account_id',p_account_id,'advance_id',p_advance_id,'catatan',p_catatan);
 perform pg_advisory_xact_lock(hashtextextended('kamo:wholesale:receipt:'||auth.uid()::text||':'||p_request_key,0));
 select * into prior from public.wholesale_operation_requests where actor_id=auth.uid() and kind='receipt' and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Identitas penerimaan dipakai untuk rincian berbeda' using errcode='22023';end if;
  return prior.result;
 end if;
 if inv.status='batal' then raise exception 'Faktur sudah dibatalkan; buka faktur pengganti';end if;
 perform public.wholesale_period(p_tanggal,p_tanggal);
 if p_tanggal<inv.tanggal then raise exception 'Tanggal penerimaan mendahului faktur';end if;
 select inv.carried_paid+coalesce(sum(jumlah),0) into paid from public.sales_receipts where invoice_id=inv.id;
 if p_amount>inv.total-paid then raise exception 'Nominal melebihi sisa tagihan' using errcode='22003';end if;
 if p_advance_id is not null then
  select * into adv from public.sales_advances where id=p_advance_id for update;
  if not found or adv.status<>'aktif' or adv.customer_id is distinct from inv.customer_id or inv.customer_id is null
   or (adv.order_id is not null and adv.order_id is distinct from inv.order_id) then raise exception 'Uang muka tidak cocok dengan pelanggan/pesanan';end if;
  perform public.wholesale_period(adv.tanggal,p_tanggal);
  if adv.tanggal>p_tanggal then raise exception 'Penerimaan mendahului tanggal uang muka';end if;
  if adv.order_id is not null then select branch_id into advance_branch from public.sales_orders where id=adv.order_id;end if;
  if (select count(*) from public.journal_entries where source='sales-advance' and source_ref=adv.no_um)<>1 then raise exception 'Jurnal uang muka belum lengkap; rekonsiliasi sumber dahulu';end if;
  select id into advance_journal from public.journal_entries where source='sales-advance' and source_ref=adv.no_um;
  select min(a.code) into advance_cash from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=advance_journal and a.code<>'2103' and a.type='ASET'
   and (a.code in ('1101','1102') or exists(select 1 from public.cash_accounts ca where ca.coa_code=a.code));
  if advance_cash is null then raise exception 'Akun kas uang muka belum terbukti; rekonsiliasi sumber dahulu';end if;
  perform public.wholesale_assert_journal(advance_journal,'sales-advance',adv.no_um,adv.tanggal,advance_branch,
   jsonb_build_array(jsonb_build_object('code',advance_cash,'debit',adv.jumlah,'credit',0),jsonb_build_object('code','2103','debit',0,'credit',adv.jumlah)));
  if adv.terpakai is distinct from (select coalesce(sum(dari_uang_muka),0) from public.sales_receipts where advance_id=adv.id) then raise exception 'Counter pemakaian uang muka belum cocok; rekonsiliasi sumber dahulu';end if;
  if exists(select 1 from public.cash_accounts where coa_code=advance_cash and branch_id is not null and branch_id is distinct from inv.branch_id) then raise exception 'Uang muka dari rekening cabang lain; rekonsiliasi lintas cabang diperlukan' using errcode='42501';end if;
  from_advance:=least(adv.jumlah-adv.terpakai,p_amount);
  if from_advance<=0 then raise exception 'Uang muka sudah habis';end if;
 end if;
 if p_amount>from_advance then
  if cash_id is null then
   select * into mapping from public.payment_account_map where metode=p_metode and (branch_id=inv.branch_id or branch_id is null) order by branch_id nulls last limit 1 for share;
   if found then cash_id:=mapping.cash_account_id;
   else
    cash_code:=case when p_metode='Tunai' then '1101' else '1102' end;
    if (select count(*) from public.cash_accounts where coa_code=cash_code)>1 then raise exception 'Rekening bawaan tidak unik';end if;
    select id into cash_id from public.cash_accounts where coa_code=cash_code;
   end if;
  end if;
  if cash_id is not null then
   select * into account from public.cash_accounts where id=cash_id for share;
   if not found or not account.is_active or (account.branch_id is not null and account.branch_id is distinct from inv.branch_id) then raise exception 'Rekening tidak aktif atau berbeda cabang' using errcode='42501';end if;
   cash_code:=account.coa_code;
  end if;
  perform 1 from public.coa_accounts where code=cash_code and is_active and not is_header and type='ASET' for share;
  if not found or cash_code in ('1201','2103') then raise exception 'Akun kas tidak valid';end if;
  -- Ledger relation lock serializes with bank reconciliation's as-of snapshot.
  lock table public.journal_entries in row exclusive mode;
  if exists(select 1 from public.bank_reconciliations r join public.cash_accounts a on a.id=r.cash_account_id
    where r.voided_at is null and coalesce(r.bank_coa_code,a.coa_code)=cash_code and p_tanggal<=r.tanggal) then raise exception 'Rekonsiliasi bank membekukan tanggal penerimaan; tinjau rekonsiliasi dahulu';end if;
  lines:=lines||jsonb_build_array(jsonb_build_object('code',cash_code,'debit',p_amount-from_advance,'credit',0));
 end if;
 if from_advance>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','2103','debit',from_advance,'credit',0));end if;
 lines:=lines||jsonb_build_array(jsonb_build_object('code','1201','debit',0,'credit',p_amount));
 -- The existing configurable RC format, unique numbering across all branches.
 select pola,digit into prefix,seq from public.document_numbering where jenis='RC';
 prefix:=coalesce(prefix,'RC.{YYYY}.{MM}.');seq:=coalesce(seq,5);
 prefix:=replace(replace(replace(replace(prefix,'{YYYY}',to_char(p_tanggal,'YYYY')),'{YY}',to_char(p_tanggal,'YY')),'{MM}',to_char(p_tanggal,'MM')),'{DD}',to_char(p_tanggal,'DD'));
 perform pg_advisory_xact_lock(hashtextextended('kamo:wholesale:receipt-number:'||prefix,0));
 select coalesce(max(substring(no_terima,length(prefix)+1)::bigint),0)+1 into next_seq from public.sales_receipts where left(no_terima,length(prefix))=prefix and substring(no_terima,length(prefix)+1)~'^[0-9]+$';
 number:=prefix||lpad(next_seq::text,greatest(length(next_seq::text),seq::integer),'0');
 journal:=public.wholesale_write_journal(p_tanggal,inv.branch_id,'sales-receipt',number,'Penerimaan '||number||' atas '||inv.no_faktur,lines);
 insert into public.sales_receipts(id,no_terima,invoice_id,tanggal,jumlah,dari_uang_muka,advance_id,metode,account_id,catatan,created_by,journal_id)
  values(receipt,number,inv.id,p_tanggal,p_amount,from_advance,p_advance_id,p_metode,cash_id,p_catatan,auth.uid(),journal);
 if from_advance>0 then update public.sales_advances set terpakai=terpakai+from_advance where id=adv.id;end if;
 update public.sales_invoices set status=case when paid+p_amount>=total then 'lunas' else 'berjalan' end,revision=revision+1 where id=inv.id;
 perform public.wholesale_access(inv.branch_id,false);
 result:=jsonb_build_object('invoice_id',inv.id,'receipt_id',receipt,'document_no',number,'journal_id',journal);
 insert into public.wholesale_operation_requests(actor_id,kind,request_key,invoice_id,payload,result) values(auth.uid(),'receipt',p_request_key,inv.id,payload,result);
 return result;
end$$;
revoke all on function public.receive_wholesale_payment(text,uuid,date,numeric,text,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.receive_wholesale_payment(text,uuid,date,numeric,text,uuid,uuid,text) to authenticated;

-- Bounded dependency fence: payroll still calculates in the application. A read
-- token prevents its later upsert from using pre-correction commission inputs.
create table public.wholesale_payroll_epochs(periode text primary key,epoch bigint not null default 0 check(epoch>=0));
alter table public.wholesale_payroll_epochs enable row level security;
revoke all on public.wholesale_payroll_epochs from public,anon,authenticated,service_role;
alter table public.payrolls add column wholesale_source_epoch bigint not null default 0;
create function public.get_wholesale_payroll_epoch(p_periode text) returns bigint
language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in ('OWNER','ADMIN')) then raise exception 'Akses penggajian diperlukan' using errcode='42501';end if;
 if p_periode is null or p_periode!~'^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Periode tidak valid';end if;
 return coalesce((select epoch from public.wholesale_payroll_epochs where periode=p_periode),0);
end$$;
revoke all on function public.get_wholesale_payroll_epoch(text) from public,anon,authenticated,service_role;
grant execute on function public.get_wholesale_payroll_epoch(text) to authenticated;
create function public.guard_wholesale_payroll_snapshot() returns trigger
language plpgsql security definer set search_path='' as $$
declare expected bigint;begin
 -- INSERT/UPDATE already holds payrolls ROW EXCLUSIVE before this row trigger,
 -- matching correction's payrolls SHARE → epoch order, including absent rows.
 insert into public.wholesale_payroll_epochs(periode) values(new.periode) on conflict do nothing;
 select epoch into expected from public.wholesale_payroll_epochs where periode=new.periode for share;
 if new.wholesale_source_epoch is distinct from expected then
  raise exception 'Sumber komisi grosir berubah sejak dihitung. Muat ulang dan hitung ulang penggajian sebelum menyimpan' using errcode='40001';
 end if;
 return new;
end$$;
revoke all on function public.guard_wholesale_payroll_snapshot() from public,anon,authenticated,service_role;
create trigger wholesale_payroll_snapshot_guard before insert or update on public.payrolls for each row execute function public.guard_wholesale_payroll_snapshot();

create function public.correct_wholesale_invoice(p_invoice_id uuid,p_expected_revision integer,p_request_key text,p_action text,p_reason text,p_header jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare inv public.sales_invoices%rowtype;ord public.sales_orders%rowtype;prior public.wholesale_operation_requests%rowtype;
 r record;item record;new_line uuid;new_invoice uuid;new_no text;original uuid;reversal uuid;replacement uuid;credit_journal uuid;audit uuid:=gen_random_uuid();
 payload jsonb;result jsonb;lines jsonb;before_value jsonb;d date;due date;dpp numeric:=0;tax numeric:=0;rate numeric:=0;paid numeric;credit numeric;cash_code text;receipt_journal uuid;
begin
 select o.* into ord from public.sales_orders o join public.sales_invoices i on i.order_id=o.id where i.id=p_invoice_id for update of o;
 select * into inv from public.sales_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Faktur grosir tidak ditemukan' using errcode='42501';end if;
 perform public.wholesale_access(inv.branch_id,true);
 if inv.order_id is null or coalesce(inv.kategori,'penjualan')='selisih_stok' or ord.id is null or ord.branch_id is distinct from inv.branch_id or ord.customer_id is distinct from inv.customer_id then raise exception 'Sumber ini bukan faktur grosir terhubung; rekonsiliasi dokumen sumber diperlukan';end if;
 if p_request_key is null or length(btrim(p_request_key)) not between 1 and 120 or p_action is null or p_action not in ('replace','cancel') or p_expected_revision is null or p_expected_revision<0
  or length(btrim(coalesce(p_reason,''))) not between 3 and 1000 or jsonb_typeof(p_header) is distinct from 'object' then raise exception 'Identitas, tindakan atau alasan koreksi tidak valid' using errcode='22023';end if;
 payload:=jsonb_build_object('invoice_id',p_invoice_id,'revision',p_expected_revision,'action',p_action,'reason',btrim(p_reason),'header',p_header);
 perform pg_advisory_xact_lock(hashtextextended('kamo:wholesale:correction:'||auth.uid()::text||':'||p_request_key,0));
 select * into prior from public.wholesale_operation_requests where actor_id=auth.uid() and kind='correction' and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Identitas koreksi dipakai untuk rincian berbeda' using errcode='22023';end if;
  return prior.result;
 end if;
 if inv.status='batal' or inv.revision<>p_expected_revision then raise exception 'Faktur atau pembayaran sudah berubah. Muat ulang sebelum koreksi' using errcode='40001';end if;
 if ord.status='batal' then raise exception 'Pesanan dibatalkan. Rekonsiliasi pengiriman dan faktur diperlukan';end if;
 d:=(p_header->>'tanggal')::date;
 perform public.wholesale_period(inv.tanggal,d);
 if d<inv.tanggal then raise exception 'Tanggal koreksi mendahului sumber';end if;
 if exists(select 1 from jsonb_object_keys(p_header) k where k not in ('tanggal','jatuh_tempo','catatan','items')) or length(coalesce(p_header->>'catatan',''))>1000 then raise exception 'Koreksi pencatatan hanya harga, tempo dan catatan; perubahan barang/qty memerlukan rekonsiliasi pengiriman atau retur fisik' using errcode='22023';end if;
 -- Payroll is a downstream consumer of reseller invoice commission. Freeze it
 -- while checking; do not silently alter an already-created payroll basis.
 lock table public.payrolls in share mode;
 if exists(select 1 from public.payrolls where periode in(to_char(inv.tanggal,'YYYY-MM'),to_char(d,'YYYY-MM'))) then raise exception 'Penggajian sudah memakai periode ini; rekonsiliasi komisi dahulu';end if;
 insert into public.wholesale_payroll_epochs(periode,epoch)
  select distinct p,1 from unnest(array[to_char(inv.tanggal,'YYYY-MM'),to_char(d,'YYYY-MM')]) p order by p
  on conflict(periode) do update set epoch=public.wholesale_payroll_epochs.epoch+1;
 perform 1 from public.sales_order_items where order_id=ord.id order by id for update;
 if not exists(select 1 from public.sales_invoice_items where invoice_id=inv.id) or exists(
  select 1 from public.sales_invoice_items ii left join public.sales_order_items oi on oi.id=ii.order_item_id
  where ii.invoice_id=inv.id and (oi.id is null or oi.order_id<>ord.id or oi.item_id is distinct from ii.item_id or oi.satuan is distinct from ii.satuan or oi.faktor is distinct from ii.faktor
   or ii.qty<>(select coalesce(sum(a.qty),0) from public.sales_invoice_delivery_allocations a where a.invoice_item_id=ii.id)
   or coalesce(ii.hpp,0)<>(select coalesce(sum(a.hpp),0) from public.sales_invoice_delivery_allocations a where a.invoice_item_id=ii.id))) then
  raise exception 'Alokasi pengiriman/HPP sumber belum terbukti. Rekonsiliasi faktur dan pengiriman dahulu';end if;
 if exists(select 1 from public.sales_invoice_delivery_allocations a join public.sales_invoice_items ii on ii.id=a.invoice_item_id
  join public.sales_delivery_items di on di.id=a.delivery_item_id join public.sales_deliveries sd on sd.id=di.delivery_id
  where ii.invoice_id=inv.id and (sd.order_id<>ord.id or di.order_item_id is distinct from ii.order_item_id or di.item_id is distinct from ii.item_id or di.faktor is distinct from ii.faktor))
  or exists(select 1 from public.sales_order_items oi where oi.order_id=ord.id and (
   oi.qty_kirim<>(select coalesce(sum(di.qty),0) from public.sales_delivery_items di join public.sales_deliveries sd on sd.id=di.delivery_id where di.order_item_id=oi.id and sd.order_id=ord.id)
   or oi.qty_faktur<>(select coalesce(sum(ii.qty),0) from public.sales_invoice_items ii join public.sales_invoices si on si.id=ii.invoice_id where ii.order_item_id=oi.id and si.order_id=ord.id and si.status<>'batal')
   or oi.qty_faktur>oi.qty_kirim)) then raise exception 'Counter/alokasi pengiriman fisik tidak konsisten. Rekonsiliasi dahulu; stok tidak boleh dibalik dari faktur';end if;
 if inv.dpp is distinct from (select sum(qty*harga) from public.sales_invoice_items where invoice_id=inv.id)
  or inv.total<>round(inv.dpp)+inv.ppn then raise exception 'Nilai baris/faktur tidak cocok dengan pembukuan; rekonsiliasi sumber dahulu';end if;
 lock table public.journal_entries in row exclusive mode;
 if (select count(*) from public.journal_entries where source='sales-invoice' and source_ref=inv.no_faktur)<>1 then raise exception 'Tautan jurnal faktur tidak unik; rekonsiliasi sumber dahulu';end if;
 select id into original from public.journal_entries where source='sales-invoice' and source_ref=inv.no_faktur;
 lines:=jsonb_build_array(jsonb_build_object('code','1201','debit',inv.total,'credit',0),jsonb_build_object('code','4101','debit',0,'credit',round(inv.dpp)));
 if inv.ppn>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','2201','debit',0,'credit',inv.ppn));end if;
 perform public.wholesale_assert_journal(original,'sales-invoice',inv.no_faktur,inv.tanggal,inv.branch_id,lines);
 select inv.carried_paid+coalesce(sum(jumlah),0) into paid from public.sales_receipts where invoice_id=inv.id;
 if paid>inv.total or (inv.carried_paid>0 and not exists(select 1 from public.wholesale_invoice_corrections c where c.replacement_id=inv.id and least(c.paid_preserved,(c.after_value->>'total')::numeric)=inv.carried_paid)) then raise exception 'Saldo pembayaran sumber memerlukan rekonsiliasi';end if;
 -- Validate each original receipt and its exact source cash/advance journal.
 for r in with recursive lineage as (
  select id,replaces_invoice_id from public.sales_invoices where id=inv.id
  union all select i.id,i.replaces_invoice_id from public.sales_invoices i join lineage p on i.id=p.replaces_invoice_id
 ) select rc.* from public.sales_receipts rc where invoice_id in(select id from lineage) order by id for share loop
  perform public.wholesale_period(r.tanggal,d);
  if r.tanggal>d then raise exception 'Tanggal koreksi mendahului pembayaran';end if;
  if r.dari_uang_muka>r.jumlah or (r.dari_uang_muka>0 and r.advance_id is null) then raise exception 'Bukti uang muka penerimaan tidak lengkap; rekonsiliasi dahulu';end if;
  if r.dari_uang_muka>0 and (r.journal_id is null or not exists(select 1 from public.wholesale_operation_requests w where w.kind='receipt'
    and w.result->>'receipt_id'=r.id::text and w.result->>'journal_id'=r.journal_id::text and w.payload->>'advance_id'=r.advance_id::text)) then
   raise exception 'Bukti pendanaan uang muka penerimaan lama belum terverifikasi; rekonsiliasi uang muka dan penerimaan dahulu';
  end if;
  select id into receipt_journal from public.journal_entries where source='sales-receipt' and source_ref=r.no_terima;
  if (select count(*) from public.journal_entries where source='sales-receipt' and source_ref=r.no_terima)<>1
   or (r.journal_id is not null and r.journal_id<>receipt_journal) then raise exception 'Tautan jurnal penerimaan tidak lengkap; rekonsiliasi dahulu';end if;
  select min(a.code) into cash_code from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where entry_id=receipt_journal and a.code not in ('1201','2103');
  lines:=jsonb_build_array(jsonb_build_object('code','1201','debit',0,'credit',r.jumlah));
  if r.dari_uang_muka>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','2103','debit',r.dari_uang_muka,'credit',0));end if;
  if r.jumlah>r.dari_uang_muka then
   if cash_code is null then raise exception 'Akun kas penerimaan belum terbukti; rekonsiliasi dahulu';end if;
   lines:=lines||jsonb_build_array(jsonb_build_object('code',cash_code,'debit',r.jumlah-r.dari_uang_muka,'credit',0));
   if exists(select 1 from public.bank_reconciliations br join public.cash_accounts a on a.id=br.cash_account_id where br.voided_at is null and coalesce(br.bank_coa_code,a.coa_code)=cash_code and r.tanggal<=br.tanggal) then raise exception 'Penerimaan sudah direkonsiliasi bank; tinjau rekonsiliasi dahulu';end if;
  end if;
  perform public.wholesale_assert_journal(receipt_journal,'sales-receipt',r.no_terima,r.tanggal,inv.branch_id,lines);
 end loop;
 if p_action='replace' then
  due:=(p_header->>'jatuh_tempo')::date;
  if due is null or not isfinite(due) or due<d or jsonb_typeof(p_header->'items') is distinct from 'array' then raise exception 'Tempo atau rincian pengganti tidak valid' using errcode='22023';end if;
  if jsonb_array_length(p_header->'items')<>(select count(*) from public.sales_invoice_items where invoice_id=inv.id)
   or jsonb_array_length(p_header->'items')<>(select count(distinct x.id) from jsonb_to_recordset(p_header->'items') as x(id uuid,harga numeric)) then raise exception 'Semua baris sumber wajib ada tepat sekali' using errcode='22023';end if;
  for item in select value from jsonb_array_elements(p_header->'items') loop
   if exists(select 1 from jsonb_object_keys(item.value) k where k not in ('id','harga')) then raise exception 'Perubahan barang/qty memerlukan rekonsiliasi pengiriman atau retur fisik' using errcode='22023';end if;
  end loop;
  for item in select * from jsonb_to_recordset(p_header->'items') as x(id uuid,harga numeric) loop
   if item.harga is null or item.harga<0 or item.harga>1000000000 or item.harga::text in ('NaN','Infinity','-Infinity') or item.harga<>round(item.harga,2) then raise exception 'Harga pengganti tidak valid' using errcode='22023';end if;
   select * into r from public.sales_invoice_items where id=item.id and invoice_id=inv.id;
   if not found then raise exception 'Baris pengganti bukan milik faktur' using errcode='22023';end if;
   dpp:=dpp+r.qty*item.harga;
  end loop;
  if dpp<=0 or dpp<>round(dpp) then raise exception 'DPP pengganti harus positif dalam rupiah bulat agar jurnal dan piutang konsisten' using errcode='22023';end if;
  if inv.ppn>0 then
   select coalesce(nullif(ppn_rate,0),11) into rate from public.company_settings where id for share;
   if round(inv.dpp*rate/100)<>inv.ppn then raise exception 'Tarif pajak sumber tidak dapat dibuktikan; rekonsiliasi dahulu';end if;
   tax:=round(dpp*rate/100);
  end if;
 end if;
 credit:=greatest(0,paid-case when p_action='replace' then dpp+tax else 0 end);
 if credit>0 and inv.customer_id is null then raise exception 'Kredit memerlukan identitas pelanggan; rekonsiliasi sumber dahulu';end if;
 before_value:=jsonb_build_object('invoice',to_jsonb(inv),'items',(select jsonb_agg(to_jsonb(ii) order by id) from public.sales_invoice_items ii where invoice_id=inv.id),
  'allocations',(select jsonb_agg(to_jsonb(a) order by a.invoice_item_id,a.delivery_item_id) from public.sales_invoice_delivery_allocations a join public.sales_invoice_items ii on ii.id=a.invoice_item_id where ii.invoice_id=inv.id),
  'receipts',(select coalesce(jsonb_agg(to_jsonb(rc) order by id),'[]') from public.sales_receipts rc where invoice_id=inv.id));
 select jsonb_agg(jsonb_build_object('code',a.code,'debit',l.credit,'credit',l.debit)) into lines from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where entry_id=original;
 reversal:=public.wholesale_write_journal(d,inv.branch_id,'wholesale-invoice-void',inv.id::text,'Pembalik '||inv.no_faktur||': '||btrim(p_reason),lines);
 update public.sales_invoices set status='batal',voided_on=d,void_reason=btrim(p_reason),revision=revision+1 where id=inv.id;
 if p_action='replace' then
  new_invoice:=gen_random_uuid();
  new_no:=public.sales_next_number(case when (select type::text from public.branches where id=inv.branch_id)='KLINIK' then 'FJK' else 'FJ' end,d);
  insert into public.sales_invoices(id,no_faktur,order_id,customer_id,branch_id,tanggal,jatuh_tempo,dpp,ppn,total,status,catatan,created_by,carried_paid,replaces_invoice_id)
   values(new_invoice,new_no,inv.order_id,inv.customer_id,inv.branch_id,d,due,dpp,tax,dpp+tax,case when paid>=dpp+tax then 'lunas' else 'berjalan' end,nullif(p_header->>'catatan',''),inv.created_by,least(paid,dpp+tax),inv.id);
  for item in select * from jsonb_to_recordset(p_header->'items') as x(id uuid,harga numeric) loop
   new_line:=gen_random_uuid();
   insert into public.sales_invoice_items(id,invoice_id,order_item_id,item_id,nama,satuan,faktor,qty,harga,hpp)
    select new_line,new_invoice,order_item_id,item_id,nama,satuan,faktor,qty,item.harga,hpp from public.sales_invoice_items where id=item.id;
   insert into public.sales_invoice_delivery_allocations(invoice_item_id,delivery_item_id,qty,hpp)
    select new_line,delivery_item_id,qty,hpp from public.sales_invoice_delivery_allocations where invoice_item_id=item.id;
  end loop;
  lines:=jsonb_build_array(jsonb_build_object('code','1201','debit',dpp+tax,'credit',0),jsonb_build_object('code','4101','debit',0,'credit',dpp));
  if tax>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','2201','debit',0,'credit',tax));end if;
  replacement:=public.wholesale_write_journal(d,inv.branch_id,'sales-invoice',new_no,'Pengganti '||inv.no_faktur,lines);
 else
  update public.sales_order_items oi set qty_faktur=qty_faktur-x.qty from (select order_item_id,sum(qty) qty from public.sales_invoice_items where invoice_id=inv.id group by order_item_id) x where oi.id=x.order_item_id;
  update public.sales_orders set status='diproses' where id=ord.id;
 end if;
 if credit>0 then
  credit_journal:=public.wholesale_write_journal(d,inv.branch_id,'wholesale-credit',audit::text,'Kredit pelanggan dari '||inv.no_faktur,
   jsonb_build_array(jsonb_build_object('code','1201','debit',credit,'credit',0),jsonb_build_object('code','2103','debit',0,'credit',credit)));
 end if;
 insert into public.wholesale_invoice_corrections(id,invoice_id,replacement_id,action,reason,tanggal,before_value,after_value,original_journal_id,reversal_journal_id,replacement_journal_id,credit_journal_id,paid_preserved,customer_credit,created_by)
  values(audit,inv.id,new_invoice,p_action,btrim(p_reason),d,before_value,(select to_jsonb(si) from public.sales_invoices si where id=new_invoice),original,reversal,replacement,credit_journal,paid,credit,auth.uid());
 perform public.wholesale_access(inv.branch_id,true);
 result:=jsonb_build_object('correction_id',audit,'invoice_id',inv.id,'replacement_id',new_invoice,'reversal_journal_id',reversal,'replacement_journal_id',replacement,'customer_credit',credit,'paid_preserved',paid);
 insert into public.wholesale_operation_requests(actor_id,kind,request_key,invoice_id,payload,result) values(auth.uid(),'correction',p_request_key,inv.id,payload,result);
 return result;
end$$;
revoke all on function public.correct_wholesale_invoice(uuid,integer,text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.correct_wholesale_invoice(uuid,integer,text,text,text,jsonb) to authenticated;

create function public.get_wholesale_operation(p_invoice_id uuid,p_kind text,p_request_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv public.sales_invoices%rowtype;prior public.wholesale_operation_requests%rowtype;begin
 select * into inv from public.sales_invoices where id=p_invoice_id;
 if not found then raise exception 'Faktur tidak ditemukan' using errcode='42501';end if;
 perform public.wholesale_access(inv.branch_id,p_kind='correction');
 if p_kind not in ('receipt','correction') then raise exception 'Jenis operasi tidak valid';end if;
 select * into prior from public.wholesale_operation_requests where actor_id=auth.uid() and kind=p_kind and request_key=p_request_key and invoice_id=p_invoice_id;
 return prior.result;
end$$;
revoke all on function public.get_wholesale_operation(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_wholesale_operation(uuid,text,text) to authenticated;

-- Retained allocations on a voided invoice are history. Only active invoices
-- consume a delivery's billable quantity/HPP, including subsequent replacements.
do $$declare body text;needle text;begin
 select pg_get_functiondef('public.sales_post_order(text,uuid,text,jsonb,jsonb)'::regprocedure) into body;
 needle:='where ii.order_item_id=v_row.id and inv.order_id=p_order_id';
 if length(body)-length(replace(body,needle,''))<>2*length(needle) then raise exception 'Wholesale active invoice insertion points changed';end if;
 body:=replace(body,needle,needle||' and inv.status<>''batal''');
 body:=replace(body,'from public.sales_invoice_delivery_allocations a where a.delivery_item_id=di.id',
  'from public.sales_invoice_delivery_allocations a join public.sales_invoice_items ai on ai.id=a.invoice_item_id join public.sales_invoices av on av.id=ai.invoice_id where a.delivery_item_id=di.id and av.status<>''batal''');
 execute body;
end$$;

-- Original receipt visibility follows its invoice; no customer/branch leakage.
drop policy src_all on public.sales_receipts;
create policy wholesale_receipts_read on public.sales_receipts for select to authenticated
 using(exists(select 1 from public.sales_invoices si where si.id=invoice_id));
-- Prevent client edits to the used counter from undoing preserved allocations.
create function public.guard_wholesale_advance_usage() returns trigger language plpgsql set search_path='' as $$begin
 if current_user in ('authenticated','anon','service_role') and ((tg_op='INSERT' and new.terpakai<>0)
  or (tg_op='UPDATE' and (new.terpakai is distinct from old.terpakai or (old.terpakai>0 and new is distinct from old)))
  or (tg_op='DELETE' and old.terpakai>0)) then raise exception 'Pemakaian uang muka hanya melalui penerimaan atomik' using errcode='42501';end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_wholesale_advance_usage() from public,anon,authenticated,service_role;
create trigger wholesale_advance_usage_guard before insert or update or delete on public.sales_advances for each row execute function public.guard_wholesale_advance_usage();

create function public.guard_wholesale_stock_move() returns trigger language plpgsql set search_path='' as $$begin
 if current_user in ('authenticated','anon','service_role') and (new.source='sales-delivery' or old.source='sales-delivery') then
  raise exception 'Mutasi pengiriman grosir hanya melalui proses resmi' using errcode='42501';
 end if;return coalesce(new,old);
end$$;
revoke all on function public.guard_wholesale_stock_move() from public,anon,authenticated,service_role;
create trigger wholesale_stock_move_guard before insert or update or delete on public.stock_moves for each row execute function public.guard_wholesale_stock_move();
