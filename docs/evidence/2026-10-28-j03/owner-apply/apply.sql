-- J03 APPLY — identical to supabase/migrations/20261028140000_j03_clinic_refund.sql, wrapped in one transaction.
-- Run only after preflight.sql shows SUMMARY 0 failed. Idempotent: a second run changes nothing.
begin;
-- J03 clinic invoice refund (owner decision 2026-10-28).
-- Per invoice line, qty <= remaining. Payout Tunai (own open clinic shift) or Transfer
-- (finance queue pending -> diproses -> selesai), same flow as the petshop refund.
-- Services/procedures/compounds and free-text lines: money only. Whole stocked medicine:
-- stock returns when marked layak jual ("baik"); otherwise its cost moves to 5902 like petshop.
-- Earned loyalty points are deducted proportionally, never below a zero balance.
-- Also lifts the petshop "transaksi berpoin" refusal with the same point rule.

-- 1. Tables -----------------------------------------------------------------------------
create table if not exists public.clinic_refund_requests(
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.invoices(id),
 branch_id uuid not null references public.branches(id),
 requested_by uuid not null references public.profiles(id),
 request_key text not null,
 payload jsonb not null,
 quoted_total numeric not null check(quoted_total>0),
 status text not null check(status in('pending','diproses','selesai','batal')),
 processed_by uuid references public.profiles(id), processing_at timestamptz,
 completion_payload jsonb, receipt jsonb not null default '{}',
 refund_id uuid unique,
 cancel_reason text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(requested_by,request_key)
);
create index if not exists clinic_refund_requests_source on public.clinic_refund_requests(invoice_id,status);

create table if not exists public.clinic_refunds(
 id uuid primary key default gen_random_uuid(),
 no_refund text not null unique,
 invoice_id uuid not null references public.invoices(id),
 visit_id uuid not null references public.visits(id),
 branch_id uuid not null references public.branches(id),
 tanggal date not null,
 total numeric not null check(total>0 and total=round(total,2)),
 method text not null check(method in('Tunai','Transfer')),
 cash_account_id uuid not null references public.cash_accounts(id),
 account_snapshot jsonb not null,
 expense_id uuid not null unique references public.expenses(id),
 request_id uuid not null unique references public.clinic_refund_requests(id),
 shift_id uuid references public.cashier_shifts(id),
 keterangan text,
 point_delta integer not null default 0 check(point_delta<=0),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create index if not exists clinic_refunds_invoice on public.clinic_refunds(invoice_id);
create index if not exists clinic_refunds_tanggal on public.clinic_refunds(tanggal);
do $$begin
 if not exists(select 1 from pg_constraint where conname='clinic_refund_requests_refund_fk') then
  alter table public.clinic_refund_requests add constraint clinic_refund_requests_refund_fk foreign key(refund_id) references public.clinic_refunds(id);
 end if;
end$$;

create table if not exists public.clinic_refund_items(
 id uuid primary key default gen_random_uuid(),
 refund_id uuid not null references public.clinic_refunds(id),
 invoice_item_id uuid not null references public.invoice_items(id),
 item_id uuid references public.items(id),
 deskripsi text not null,
 jenis text not null,
 qty integer not null check(qty>0),
 amount numeric not null check(amount>=0),
 restock boolean not null,
 kondisi text check(kondisi in('baik','rusak')),
 base_qty numeric,
 hpp numeric,
 exp_date date,
 warehouse_id uuid references public.warehouses(id),
 unique(refund_id,invoice_item_id)
);
create index if not exists clinic_refund_items_line on public.clinic_refund_items(invoice_item_id);

alter table public.clinic_refund_requests enable row level security;
alter table public.clinic_refunds enable row level security;
alter table public.clinic_refund_items enable row level security;
-- Requests hold bank destinations: RPC only. Posted refunds are readable per branch.
revoke all on public.clinic_refund_requests,public.clinic_refunds,public.clinic_refund_items from public,anon,authenticated,service_role;
grant select on public.clinic_refunds,public.clinic_refund_items to authenticated;
drop policy if exists clinic_refunds_branch_read on public.clinic_refunds;
create policy clinic_refunds_branch_read on public.clinic_refunds for select to authenticated using(public.user_can_access_branch(branch_id));
drop policy if exists clinic_refund_items_branch_read on public.clinic_refund_items;
create policy clinic_refund_items_branch_read on public.clinic_refund_items for select to authenticated
 using(exists(select 1 from public.clinic_refunds r where r.id=refund_id and public.user_can_access_branch(r.branch_id)));

-- 2. Shared helpers -----------------------------------------------------------------------
-- Proportional earned-point deduction: cumulative target floor(earned*refunded/total),
-- minus what earlier refunds already took, capped by the live balance (never below 0).
create or replace function public.refund_point_deduction(p_customer uuid,p_earned integer,p_already integer,p_cumulative numeric,p_total numeric,p_ref text,p_description text)
returns integer language plpgsql security definer set search_path='' as $$
declare target integer;want integer;balance integer;take integer;begin
 if p_customer is null or coalesce(p_earned,0)<=0 or p_total is null or p_total<=0 then return 0;end if;
 target:=floor(p_earned*least(1,greatest(0,p_cumulative/p_total)));
 want:=greatest(0,target-greatest(coalesce(p_already,0),0));
 if want=0 then return 0;end if;
 select coalesce(points,0) into balance from public.customers where id=p_customer for update;
 if not found then return 0;end if;
 take:=least(want,greatest(balance,0));
 if take>0 then
  insert into public.point_ledger(customer_id,delta,saldo,ref,description,entry_type) values(p_customer,-take,balance-take,left(p_ref,50),left(p_description,200),'adjustment');
  update public.customers set points=balance-take where id=p_customer;
 end if;
 return take;
end$$;
revoke all on function public.refund_point_deduction(uuid,integer,integer,numeric,numeric,text,text) from public,anon,authenticated,service_role;

-- Clinic refund number: configured RJK pattern, highest existing + 1 (never count+1).
create or replace function public.clinic_refund_number(p_date date) returns text
language plpgsql security definer set search_path='' as $$
declare prefix text;digits integer;n bigint;begin
 select pola,digit into prefix,digits from public.document_numbering where jenis='RJK';
 prefix:=coalesce(prefix,'RJK.{YYYY}.{MM}.');digits:=coalesce(digits,5);
 prefix:=replace(replace(replace(replace(prefix,'{YYYY}',to_char(p_date,'YYYY')),'{YY}',to_char(p_date,'YY')),'{MM}',to_char(p_date,'MM')),'{DD}',to_char(p_date,'DD'));
 if digits not between 1 and 8 or length(prefix)+digits>30 or prefix ~ '\{[^}]+\}' then raise exception 'Format nomor refund klinik tidak valid';end if;
 perform pg_advisory_xact_lock(hashtext('vetos:clinic-refund-number:'||prefix)::bigint);
 select coalesce(max(substring(no_refund from length(prefix)+1 for digits)::bigint),0)+1 into n from public.clinic_refunds
  where left(no_refund,length(prefix))=prefix and substring(no_refund from length(prefix)+1 for digits) ~ '^[0-9]+$';
 if length(n::text)>digits then raise exception 'Urutan nomor refund klinik penuh';end if;
 return prefix||lpad(n::text,digits,'0');
end$$;
revoke all on function public.clinic_refund_number(date) from public,anon,authenticated,service_role;

-- Requester: active branch actor. Cash leaves the actor's own open clinic shift; without
-- a shift only OWNER/ADMIN/FINANCE may file a transfer request.
create or replace function public.clinic_refund_actor_access(p_branch uuid,p_method text) returns uuid
language plpgsql security definer set search_path='' as $$
declare role_name text;shift uuid;begin
 select role into role_name from public.profiles where id=auth.uid() and is_active;
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or role_name is null
  or role_name not in('OWNER','ADMIN','FINANCE','STAFF','DOCTOR') or not public.user_can_access_branch(p_branch) then
  raise exception 'Akses refund klinik ditolak' using errcode='42501';end if;
 select id into shift from public.cashier_shifts where opened_by=auth.uid() and branch_id=p_branch and status='open' and shift_type='klinik' order by opened_at desc,id limit 1 for update;
 if p_method='Tunai' and shift is null then raise exception 'Refund Tunai memerlukan shift klinik aktif milik Anda';end if;
 if shift is null and role_name not in('OWNER','ADMIN','FINANCE') then raise exception 'Shift klinik aktif diperlukan untuk mengajukan refund' using errcode='42501';end if;
 return shift;
end$$;
revoke all on function public.clinic_refund_actor_access(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.clinic_refund_finance_access(p_branch uuid) returns void
language plpgsql security definer set search_path='' as $$begin
 perform public.expense_assert_access(p_branch,true);
 if not exists(select 1 from public.branches where id=p_branch and is_active) then raise exception 'Cabang refund tidak aktif';end if;
end$$;
revoke all on function public.clinic_refund_finance_access(uuid) from public,anon,authenticated,service_role;

-- 3. Source eligibility: racikan, BMHP procedures and free-text lines are money-only lines --
do $patch$declare body text;needle text;begin
 body:=pg_get_functiondef('public.clinic_refund_source_core(uuid)'::regprocedure);
 needle:=$o$or x.compound_recipe_id is not null or x.bmhp_components is not null or(x.jenis='obat'and(x.item_id is null or x.faktor is null$o$;
 if position(needle in body)>0 then
  body:=replace(body,needle,$n$or(x.jenis='obat'and x.item_id is not null and x.compound_recipe_id is null and(x.faktor is null$n$);
 elsif position($n$or(x.jenis='obat'and x.item_id is not null and x.compound_recipe_id is null and(x.faktor is null$n$ in body)=0 then
  raise exception 'Clinic refund line provenance mismatch';end if;
 needle:=$o$where invoice_id=i.id and jenis='obat'group by item_id loop$o$;
 if position(needle in body)>0 then
  body:=replace(body,needle,$n$where invoice_id=i.id and jenis='obat'and item_id is not null and compound_recipe_id is null group by item_id loop$n$);
 elsif position($n$and jenis='obat'and item_id is not null and compound_recipe_id is null group by item_id loop$n$ in body)=0 then
  raise exception 'Clinic refund stock provenance mismatch';end if;
 execute body;
end$patch$;

-- 4. Quote: remaining qty per line and cumulative cent allocation ------------------------
create or replace function public.clinic_refund_quote(p_invoice uuid,p_items jsonb,p_except uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare src jsonb;i public.invoices%rowtype;r record;l public.invoice_items%rowtype;used integer;reserved integer;restock boolean;kondisi text;
 ratio numeric;raw numeric:=0;prev_raw numeric;previous numeric;total numeric;rows jsonb:='[]';open_left boolean:=false;begin
 src:=public.clinic_refund_source_core(p_invoice);
 if (src->>'eligible')::boolean is not true then raise exception 'Invoice belum dapat direfund: %',coalesce(src->>'reason','sumber tidak valid');end if;
 select * into i from public.invoices where id=p_invoice;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then raise exception 'Isi 1 sampai 200 baris refund';end if;
 if (select count(*) from jsonb_array_elements(p_items))<>(select count(distinct x->>'invoice_item_id') from jsonb_array_elements(p_items)x where nullif(x->>'invoice_item_id','') is not null) then raise exception 'Baris invoice dobel atau kosong';end if;
 ratio:=i.total/i.subtotal;
 for r in select * from jsonb_to_recordset(p_items)x(invoice_item_id uuid,qty numeric,kondisi text,exp_date date) order by invoice_item_id loop
  if r.qty is null or r.qty::text in('NaN','Infinity','-Infinity') or r.qty<=0 or r.qty<>trunc(r.qty) or r.qty>1000000 then raise exception 'Qty refund harus bilangan bulat positif';end if;
  select * into l from public.invoice_items where id=r.invoice_item_id and invoice_id=p_invoice;
  if not found then raise exception 'Baris bukan milik invoice ini';end if;
  select coalesce(sum(ri.qty),0) into used from public.clinic_refund_items ri where ri.invoice_item_id=l.id;
  select coalesce(sum((x->>'qty')::integer),0) into reserved from public.clinic_refund_requests q cross join lateral jsonb_array_elements(q.payload->'items')x
   where q.invoice_id=p_invoice and q.status='diproses' and q.id is distinct from p_except and (x->>'invoice_item_id')::uuid=l.id;
  if r.qty>l.qty-used-reserved then raise exception 'Qty refund % melebihi sisa % (sudah direfund/diproses %)',l.deskripsi,l.qty-used-reserved,used+reserved;end if;
  restock:=l.jenis='obat' and l.item_id is not null and l.compound_recipe_id is null;
  kondisi:=case when restock then coalesce(nullif(r.kondisi,''),'baik') end;
  if kondisi is not null and kondisi not in('baik','rusak') then raise exception 'Kondisi obat tidak valid';end if;
  raw:=raw+r.qty*l.harga*(1-coalesce(l.diskon_persen,0)/100)*ratio;
  rows:=rows||jsonb_build_array(jsonb_build_object('invoice_item_id',l.id,'qty',r.qty::integer,'kondisi',kondisi,'exp_date',case when kondisi='baik' then r.exp_date end));
 end loop;
 select coalesce(sum(f.total),0) into previous from public.clinic_refunds f where f.invoice_id=p_invoice;
 select coalesce(sum(ri.qty*x.harga*(1-coalesce(x.diskon_persen,0)/100)*ratio),0) into prev_raw
  from public.clinic_refund_items ri join public.clinic_refunds f on f.id=ri.refund_id join public.invoice_items x on x.id=ri.invoice_item_id where f.invoice_id=p_invoice;
 -- Lines left after this refund: when none remain, the invoice is refunded to the cent.
 select exists(select 1 from public.invoice_items x where x.invoice_id=p_invoice and x.qty
   >(select coalesce(sum(ri.qty),0) from public.clinic_refund_items ri where ri.invoice_item_id=x.id)
   +coalesce((select (y->>'qty')::integer from jsonb_array_elements(rows)y where (y->>'invoice_item_id')::uuid=x.id),0)) into open_left;
 total:=case when open_left then least(round(prev_raw+raw,2),i.total)-previous else i.total-previous end;
 if total<=0 or total<>round(total,2) or previous+total>i.total then raise exception 'Nilai refund tidak valid atau di bawah presisi uang';end if;
 return jsonb_build_object('total',total,'items',rows);
end$$;
revoke all on function public.clinic_refund_quote(uuid,jsonb,uuid) from public,anon,authenticated,service_role;

-- 5. Posting core: refund document, stock, journals, payout, points (one transaction) ----
create or replace function public.clinic_refund_apply(p_request uuid,p_date date,p_account uuid,p_shift uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.clinic_refund_requests%rowtype;i public.invoices%rowtype;v public.visits%rowtype;quote jsonb;method text;account public.cash_accounts%rowtype;
 doc uuid:=gen_random_uuid();expense uuid:=gen_random_uuid();no text;total numeric;previous numeric;cumulative numeric;r record;l public.invoice_items%rowtype;
 used integer;prev_hpp numeric;cost numeric;base numeric;wh uuid;hppgood numeric:=0;hppbad numeric:=0;disc numeric;tax numeric;lines jsonb;
 earned integer;already integer;taken integer:=0;result jsonb;begin
 select * into q from public.clinic_refund_requests where id=p_request for update;
 select * into i from public.invoices where id=q.invoice_id;select * into v from public.visits where id=i.visit_id;
 quote:=public.clinic_refund_quote(q.invoice_id,q.payload->'items',q.id);
 if (quote->>'total')::numeric<>q.quoted_total or quote->'items' is distinct from q.payload->'items' then raise exception 'Sumber/nilai refund berubah; periksa dan buat permintaan baru';end if;
 total:=q.quoted_total;method:=q.payload->>'method';
 if p_date is null or not isfinite(p_date) or p_date>(now() at time zone 'Asia/Jakarta')::date or p_date<(i.created_at at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal refund tidak valid';end if;
 perform public.inventory_assert_open_date(p_date);
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and p_date<=closed_until) then raise exception 'Periode akuntansi sudah ditutup';end if;
 if method='Tunai' then
  if p_shift is null then raise exception 'Refund Tunai memerlukan shift klinik aktif';end if;
  select a.* into account from public.payment_account_map m join public.cash_accounts a on a.id=m.cash_account_id where m.metode='Tunai' and (m.branch_id=v.branch_id or m.branch_id is null) order by m.branch_id nulls last limit 1 for share of m,a;
  if not found then raise exception 'Pemetaan kas Tunai belum tersedia';end if;
 else select * into account from public.cash_accounts where id=p_account for share;end if;
 if account.id is null or not account.is_active or account.jenis<>(case when method='Tunai' then 'Kas' else 'Bank' end) or (account.branch_id is not null and account.branch_id<>v.branch_id) then raise exception 'Rekening payout tidak aktif atau berbeda cabang';end if;
 perform 1 from public.coa_accounts where code=account.coa_code and type='ASET' and is_active and not is_header for share;if not found then raise exception 'COA payout tidak valid';end if;
 no:=public.clinic_refund_number(p_date);
 select coalesce(sum(f.total),0) into previous from public.clinic_refunds f where f.invoice_id=i.id;cumulative:=previous+total;
 insert into public.expenses(id,branch_id,tanggal,kategori,deskripsi,jumlah,metode_bayar,shift_id,created_by)
  values(expense,v.branch_id,p_date,'Refund Klinik','Refund klinik '||no||' (invoice '||i.invoice_no||')',total,method,case when method='Tunai' then p_shift end,auth.uid());
 insert into public.clinic_refunds(id,no_refund,invoice_id,visit_id,branch_id,tanggal,total,method,cash_account_id,account_snapshot,expense_id,request_id,shift_id,keterangan,created_by)
  values(doc,no,i.id,v.id,v.branch_id,p_date,total,method,account.id,to_jsonb(account),expense,q.id,case when method='Tunai' then p_shift end,q.payload#>>'{header,keterangan}',auth.uid());
 for r in select * from jsonb_to_recordset(q.payload->'items')x(invoice_item_id uuid,qty integer,kondisi text,exp_date date) order by invoice_item_id loop
  select * into l from public.invoice_items where id=r.invoice_item_id;
  cost:=null;base:=null;wh:=null;
  if r.kondisi is not null then
   select coalesce(sum(ri.qty),0),coalesce(sum(ri.hpp),0) into used,prev_hpp from public.clinic_refund_items ri where ri.invoice_item_id=l.id;
   cost:=greatest(0,least(l.hpp,round(l.hpp*(used+r.qty)/l.qty,2))-prev_hpp);base:=r.qty*l.faktor;
   if r.kondisi='baik' then
    select warehouse_id into wh from public.stock_moves where source='klinik' and source_ref=i.invoice_no and item_id=l.item_id limit 1;
    if wh is null then raise exception 'Gudang asal obat tidak ditemukan';end if;
    perform public.stock_in_fifo(wh,l.item_id,base,cost/base,'retur-klinik',no,p_date,r.exp_date);hppgood:=hppgood+cost;
   else hppbad:=hppbad+cost;end if;
  end if;
  insert into public.clinic_refund_items(refund_id,invoice_item_id,item_id,deskripsi,jenis,qty,amount,restock,kondisi,base_qty,hpp,exp_date,warehouse_id)
   values(doc,l.id,l.item_id,l.deskripsi,l.jenis,r.qty,round(r.qty*l.harga*(1-coalesce(l.diskon_persen,0)/100)*i.total/i.subtotal,2),coalesce(r.kondisi='baik',false),r.kondisi,base,cost,r.exp_date,wh);
 end loop;
 -- Reverse the source revenue journal pro rata (cumulative cents, revenue is the plug).
 disc:=round(i.discount*cumulative/i.total,2)-round(i.discount*previous/i.total,2);
 tax:=round(i.tax*cumulative/i.total,2)-round(i.tax*previous/i.total,2);
 lines:=jsonb_build_array(jsonb_build_object('code','4201','debit',total+disc-tax,'credit',0),jsonb_build_object('code',account.coa_code,'debit',0,'credit',total));
 if disc>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','4102','debit',0,'credit',disc));end if;
 if tax>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','2201','debit',tax,'credit',0));end if;
 perform public.clinic_write_journal(p_date,'Refund klinik '||no||' (invoice '||i.invoice_no||')','klinik-refund',no,v.branch_id,lines);
 if hppgood+hppbad>0 then
  perform public.clinic_write_journal(p_date,'HPP refund klinik '||no,'klinik-refund-hpp',no,v.branch_id,jsonb_build_array(
   jsonb_build_object('code','1301','debit',hppgood,'credit',0),jsonb_build_object('code','5902','debit',hppbad,'credit',0),jsonb_build_object('code','5101','debit',0,'credit',hppgood+hppbad)));
 end if;
 if v.customer_id is not null then
  select coalesce(sum(delta),0) into earned from public.point_ledger where customer_id=v.customer_id and ref=i.invoice_no and delta>0;
  select coalesce(-sum(point_delta),0) into already from public.clinic_refunds where invoice_id=i.id and id<>doc;
  taken:=public.refund_point_deduction(v.customer_id,earned,already,cumulative,i.total,no,'Refund '||no||' (invoice '||i.invoice_no||')');
  if taken>0 then update public.clinic_refunds set point_delta=-taken where id=doc;end if;
  perform public.refresh_customer_spending(v.customer_id);
 end if;
 result:=jsonb_build_object('refund_request_id',q.id,'status','selesai','document_id',doc,'document_no',no,'total',total,'point_delta',-taken,'source_ref',i.invoice_no,'invoice_id',i.id);
 update public.clinic_refund_requests set status='selesai',refund_id=doc,receipt=result,updated_at=now() where id=q.id;
 return result;
end$$;
revoke all on function public.clinic_refund_apply(uuid,date,uuid,uuid) from public,anon,authenticated,service_role;

-- 6. Public RPCs -----------------------------------------------------------------------------
create or replace function public.post_clinic_refund(p_invoice uuid,p_request_key text,p_header jsonb,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare prior public.clinic_refund_requests%rowtype;i public.invoices%rowtype;v public.visits%rowtype;method text;d date;header jsonb;destination jsonb;payload jsonb;quote jsonb;shift uuid;rid uuid:=gen_random_uuid();result jsonb;begin
 if auth.uid() is null then raise exception 'Sesi aktif diperlukan' using errcode='42501';end if;
 if p_request_key is null or p_request_key !~ '^[A-Za-z0-9._:-]{1,120}$' or jsonb_typeof(p_header) is distinct from 'object' then raise exception 'Permintaan refund tidak valid';end if;
 method:=p_header->>'refund_method';if method is null or method not in('Tunai','Transfer') then raise exception 'Pilih payout Tunai atau Transfer';end if;
 d:=(p_header->>'tanggal')::date;if d is null or not isfinite(d) or d>(now() at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal permintaan refund tidak valid';end if;
 header:=jsonb_build_object('tanggal',d,'keterangan',left(nullif(btrim(p_header->>'keterangan'),''),500));
 destination:=case when method='Transfer' then jsonb_build_object('bank',btrim(p_header#>>'{destination,bank}'),'account',btrim(p_header#>>'{destination,account}'),'name',btrim(p_header#>>'{destination,name}')) end;
 if method='Transfer' and (coalesce(length(destination->>'bank'),0) not between 1 and 80 or coalesce(length(destination->>'name'),0) not between 1 and 120 or coalesce(destination->>'account','') !~ '^[A-Za-z0-9 -]{3,40}$') then raise exception 'Lengkapi bank, nomor rekening dan nama tujuan refund';end if;
 payload:=jsonb_build_object('header',header,'items',p_items,'method',method,'destination',destination);
 perform pg_advisory_xact_lock(hashtext('vetos:clinic-refund-request:'||auth.uid()::text||':'||p_request_key)::bigint);
 select * into prior from public.clinic_refund_requests where requested_by=auth.uid() and request_key=p_request_key;
 if found then
  if prior.invoice_id<>p_invoice or prior.payload->'submitted' is distinct from payload then raise exception 'Identitas refund digunakan dengan rincian berbeda';end if;
  return prior.receipt;
 end if;
 -- Lock order shared with clinic billing: visit, then invoice.
 select * into v from public.visits where id=(select visit_id from public.invoices where id=p_invoice) for update;
 if not found then raise exception 'Invoice tidak dapat diakses' using errcode='42501';end if;
 select * into i from public.invoices where id=p_invoice for update;
 shift:=public.clinic_refund_actor_access(v.branch_id,method);
 quote:=public.clinic_refund_quote(p_invoice,p_items,null);
 insert into public.clinic_refund_requests(id,invoice_id,branch_id,requested_by,request_key,payload,quoted_total,status)
  values(rid,p_invoice,v.branch_id,auth.uid(),p_request_key,payload||jsonb_build_object('submitted',payload,'items',quote->'items'),(quote->>'total')::numeric,'pending');
 if method='Tunai' then result:=public.clinic_refund_apply(rid,d,null,shift);
 else
  result:=jsonb_build_object('refund_request_id',rid,'status','pending','quoted_total',(quote->>'total')::numeric,'source_ref',i.invoice_no,'invoice_id',i.id);
  update public.clinic_refund_requests set receipt=result where id=rid;
 end if;
 return result;
end$$;
revoke all on function public.post_clinic_refund(uuid,text,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.post_clinic_refund(uuid,text,jsonb,jsonb) to authenticated;

create or replace function public.claim_clinic_refund_request(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare r public.clinic_refund_requests%rowtype;inv uuid;quote jsonb;begin
 select invoice_id into inv from public.clinic_refund_requests where id=p_id;
 perform 1 from public.visits where id=(select visit_id from public.invoices where id=inv) for update;perform 1 from public.invoices where id=inv for update;
 select * into r from public.clinic_refund_requests where id=p_id for update;if not found then raise exception 'Permintaan refund tidak ditemukan';end if;
 perform public.clinic_refund_finance_access(r.branch_id);
 if r.status='diproses' and r.processed_by=auth.uid() then return r.receipt;end if;
 if r.status<>'pending' then raise exception 'Refund sudah diproses petugas lain atau bukan pending';end if;
 quote:=public.clinic_refund_quote(r.invoice_id,r.payload->'items',r.id);
 if (quote->>'total')::numeric<>r.quoted_total or quote->'items' is distinct from r.payload->'items' then raise exception 'Sumber/nilai refund berubah; periksa dan buat permintaan baru';end if;
 update public.clinic_refund_requests set status='diproses',processed_by=auth.uid(),processing_at=now(),updated_at=now(),receipt=receipt||jsonb_build_object('status','diproses') where id=p_id returning * into r;
 return r.receipt;
end$$;
revoke all on function public.claim_clinic_refund_request(uuid) from public,anon,service_role;
grant execute on function public.claim_clinic_refund_request(uuid) to authenticated;

create or replace function public.complete_clinic_refund_request(p_id uuid,p_date date,p_account uuid,p_reference text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare r public.clinic_refund_requests%rowtype;inv uuid;v_completion jsonb;begin
 select invoice_id into inv from public.clinic_refund_requests where id=p_id;
 perform 1 from public.visits where id=(select visit_id from public.invoices where id=inv) for update;perform 1 from public.invoices where id=inv for update;
 select * into r from public.clinic_refund_requests where id=p_id for update;if not found then raise exception 'Permintaan refund tidak ditemukan';end if;
 perform public.clinic_refund_finance_access(r.branch_id);
 if p_date is null or not isfinite(p_date) or p_date>(now() at time zone 'Asia/Jakarta')::date or p_date<(r.payload#>>'{header,tanggal}')::date or coalesce(length(btrim(p_reference)),0) not between 1 and 120 or p_account is null then raise exception 'Isi tanggal, rekening dan referensi transfer yang valid';end if;
 v_completion:=jsonb_build_object('tanggal',p_date,'account_id',p_account,'reference',btrim(p_reference));
 if r.status='selesai' then if r.completion_payload is distinct from v_completion then raise exception 'Transfer sudah tercatat dengan rincian berbeda';end if;return r.receipt;end if;
 if r.status<>'diproses' or r.processed_by is distinct from auth.uid() then raise exception 'Ambil proses refund sebelum mencatat transfer';end if;
 update public.clinic_refund_requests set completion_payload=v_completion where id=r.id;
 return public.clinic_refund_apply(r.id,p_date,p_account,null);
end$$;
revoke all on function public.complete_clinic_refund_request(uuid,date,uuid,text) from public,anon,service_role;
grant execute on function public.complete_clinic_refund_request(uuid,date,uuid,text) to authenticated;

create or replace function public.cancel_clinic_refund_request(p_id uuid,p_reason text,p_unpaid_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$declare r public.clinic_refund_requests%rowtype;inv uuid;begin
 select invoice_id into inv from public.clinic_refund_requests where id=p_id;
 perform 1 from public.visits where id=(select visit_id from public.invoices where id=inv) for update;perform 1 from public.invoices where id=inv for update;
 select * into r from public.clinic_refund_requests where id=p_id for update;if not found then raise exception 'Permintaan refund tidak ditemukan';end if;
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or not public.user_can_access_branch(r.branch_id) or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception 'Akses refund ditolak' using errcode='42501';end if;
 if r.status='batal' then return r.receipt;end if;
 if r.status not in('pending','diproses') or p_unpaid_confirmed is distinct from true or coalesce(length(btrim(p_reason)),0) not between 3 and 500 then raise exception 'Hanya refund belum dibayar yang boleh dibatalkan dengan konfirmasi dan alasan';end if;
 if r.requested_by is distinct from auth.uid() or r.status='diproses' then
  perform public.clinic_refund_finance_access(r.branch_id);
  if r.status='diproses' and r.processed_by is distinct from auth.uid() and not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER') then raise exception 'Hubungi petugas pemroses refund sebelum membatalkan';end if;
 end if;
 update public.clinic_refund_requests set status='batal',cancel_reason=btrim(p_reason),updated_at=now(),receipt=receipt||jsonb_build_object('status','batal') where id=p_id returning * into r;
 return r.receipt;
end$$;
revoke all on function public.cancel_clinic_refund_request(uuid,text,boolean) from public,anon,service_role;
grant execute on function public.cancel_clinic_refund_request(uuid,text,boolean) to authenticated;

create or replace function public.get_clinic_refund_result(p_request_key text) returns jsonb
language plpgsql security definer set search_path='' as $$declare r public.clinic_refund_requests%rowtype;begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception 'Sesi aktif diperlukan' using errcode='42501';end if;
 select * into r from public.clinic_refund_requests where requested_by=auth.uid() and request_key=p_request_key;
 if not found then return null;end if;
 if not public.user_can_access_branch(r.branch_id) then raise exception 'Cabang refund tidak dapat diakses' using errcode='42501';end if;
 return r.receipt;
end$$;
revoke all on function public.get_clinic_refund_result(text) from public,anon,service_role;
grant execute on function public.get_clinic_refund_result(text) to authenticated;

-- Invoice panel (p_office=false, one invoice, bank destination only for its requester) and
-- finance queue (p_office=true).
create or replace function public.get_clinic_refund_requests(p_invoice uuid default null,p_office boolean default false,p_status text default '',p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$declare r record;b uuid;allowed uuid[]:='{}';result jsonb:='[]';begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception 'Sesi aktif diperlukan' using errcode='42501';end if;
 if p_office and not exists(select 1 from public.profiles where id=auth.uid() and role in('OWNER','ADMIN','FINANCE')) then raise exception 'Antrian refund hanya tersedia untuk finance berwenang' using errcode='42501';end if;
 if not p_office and p_invoice is null then raise exception 'Pilih invoice';end if;
 if p_status not in('','pending','diproses','selesai','batal') or p_offset is null or p_offset<0 or p_offset>100000 then raise exception 'Filter refund tidak valid';end if;
 for b in select id from public.branches where public.user_can_access_branch(id) and (not p_office or is_active) loop
  if p_office then begin perform public.clinic_refund_finance_access(b);exception when insufficient_privilege then continue;end;end if;
  allowed:=array_append(allowed,b);
 end loop;
 for r in select q.*,i.invoice_no,i.visit_id,f.no_refund from public.clinic_refund_requests q join public.invoices i on i.id=q.invoice_id left join public.clinic_refunds f on f.id=q.refund_id
  where q.branch_id=any(allowed) and (p_invoice is null or q.invoice_id=p_invoice) and (p_status='' or q.status=p_status) order by q.created_at desc,q.id limit 100 offset p_offset loop
  result:=result||jsonb_build_array(jsonb_build_object('id',r.id,'invoice_id',r.invoice_id,'visit_id',r.visit_id,'source_ref',r.invoice_no,'branch_id',r.branch_id,'requested_by',r.requested_by,'status',r.status,'quoted_total',r.quoted_total,
   'method',r.payload->>'method','destination',case when p_office or r.requested_by=auth.uid() then r.payload->'destination' end,'requested_date',r.payload#>>'{header,tanggal}','created_at',r.created_at,'processed_by',r.processed_by,'refund_id',r.refund_id,'refund_no',r.no_refund));
 end loop;return result;
end$$;
revoke all on function public.get_clinic_refund_requests(uuid,boolean,text,integer) from public,anon,service_role;
grant execute on function public.get_clinic_refund_requests(uuid,boolean,text,integer) to authenticated;

-- 7. Guards: a refunded (or finance-reserved) invoice and its payout cannot be edited away --
create or replace function public.guard_refunded_clinic_invoice() returns trigger
language plpgsql security definer set search_path='' as $$declare inv uuid;begin
 if tg_table_name='invoices' then inv:=old.id;elsif tg_op='INSERT' then inv:=new.invoice_id;else inv:=old.invoice_id;end if;
 if exists(select 1 from public.clinic_refunds where invoice_id=inv) or exists(select 1 from public.clinic_refund_requests where invoice_id=inv and status='diproses') then
  if tg_op='UPDATE' and to_jsonb(new) is not distinct from to_jsonb(old) then return new;end if;
  raise exception 'Invoice sudah direfund atau sedang diproses refund. Koreksi/void invoice tidak diizinkan' using errcode='P0001';
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
revoke all on function public.guard_refunded_clinic_invoice() from public,anon,authenticated,service_role;
drop trigger if exists clinic_refund_invoice_guard on public.invoices;
create trigger clinic_refund_invoice_guard before update or delete on public.invoices for each row execute function public.guard_refunded_clinic_invoice();
drop trigger if exists clinic_refund_invoice_line_guard on public.invoice_items;
create trigger clinic_refund_invoice_line_guard before insert or update or delete on public.invoice_items for each row execute function public.guard_refunded_clinic_invoice();

create or replace function public.guard_clinic_refund_expense() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.clinic_refunds where expense_id=old.id) and (tg_op='DELETE' or to_jsonb(new) is distinct from to_jsonb(old)) then
  raise exception 'Pengeluaran ini adalah payout refund klinik; tidak dapat diubah atau dihapus' using errcode='42501';end if;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
revoke all on function public.guard_clinic_refund_expense() from public,anon,authenticated,service_role;
drop trigger if exists clinic_refund_expense_guard on public.expenses;
create trigger clinic_refund_expense_guard before update or delete on public.expenses for each row execute function public.guard_clinic_refund_expense();

create or replace function public.guard_clinic_refund_immutable() returns trigger
language plpgsql security definer set search_path='' as $$begin
 raise exception 'Refund klinik yang sudah diposting tidak dapat diubah' using errcode='42501';
end$$;
revoke all on function public.guard_clinic_refund_immutable() from public,anon,authenticated,service_role;
drop trigger if exists clinic_refund_items_immutable on public.clinic_refund_items;
create trigger clinic_refund_items_immutable before update or delete on public.clinic_refund_items for each row execute function public.guard_clinic_refund_immutable();
-- clinic_refunds: only point_delta is set once, right after insert, inside the posting.
create or replace function public.guard_clinic_refund_header() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if tg_op='DELETE' or (to_jsonb(new)-'point_delta') is distinct from (to_jsonb(old)-'point_delta') or old.point_delta<>0 then
  raise exception 'Refund klinik yang sudah diposting tidak dapat diubah' using errcode='42501';end if;
 return new;
end$$;
revoke all on function public.guard_clinic_refund_header() from public,anon,authenticated,service_role;
drop trigger if exists clinic_refunds_immutable on public.clinic_refunds;
create trigger clinic_refunds_immutable before update or delete on public.clinic_refunds for each row execute function public.guard_clinic_refund_header();

-- 8. Customer spending: clinic invoice value is net of its refunds -------------------------
do $patch$declare body text;needle text:=$o$for s in select i.total from public.invoices i join public.visits v on v.id=i.visit_id$o$;
 repl text:=$n$for s in select i.total-coalesce((select sum(f.total) from public.clinic_refunds f where f.invoice_id=i.id),0) as total from public.invoices i join public.visits v on v.id=i.visit_id$n$;begin
 body:=pg_get_functiondef('public.refresh_customer_spending(uuid)'::regprocedure);
 if position(needle in body)>0 then execute replace(body,needle,repl);
 elsif position(repl in body)=0 then raise exception 'Customer spending provenance mismatch';end if;
end$patch$;

-- 9. Petshop: lift the point refusal; deduct earned points with the same rule -------------
do $patch$declare body text;
 needle text:=$o$raise exception 'Transaksi berpoin memerlukan rekonsiliasi pembalikan poin. Refund baru belum diposting';$o$;
 repl text:=$n$null; -- J03: earned points are deducted proportionally when the refund posts$n$;begin
 body:=pg_get_functiondef('public.sales_refund_quote(uuid,jsonb,uuid)'::regprocedure);
 if position(needle in body)>0 then execute replace(body,needle,repl);
 elsif position(repl in body)=0 then raise exception 'Petshop point refusal provenance mismatch';end if;
end$patch$;
do $patch$declare body text;
 needle text:=$o$values(p_doc,p_sale.id,p_sale.branch_id,method,expense,request.id,to_jsonb(account),p_total,auth.uid());$o$;
 repl text:=$n$values(p_doc,p_sale.id,p_sale.branch_id,method,expense,request.id,to_jsonb(account),p_total,auth.uid());
 update public.sales_refund_payouts set point_delta=-public.refund_point_deduction(p_sale.customer_id,coalesce(p_sale.poin_earned,0),(select coalesce(-sum(x.point_delta),0)::integer from public.sales_refund_payouts x where x.sale_id=p_sale.id),cumulative,p_sale.total,p_no,'Refund '||p_no||' (struk '||p_sale.no_struk||')') where return_id=p_doc;$n$;begin
 body:=pg_get_functiondef('public.pos_sale_post_refund_selected(public.sales,uuid,text,date,numeric,jsonb,text,jsonb)'::regprocedure);
 if position(repl in body)>0 then return;end if;
 if position(needle in body)=0 then raise exception 'Petshop payout provenance mismatch';end if;
 execute replace(body,needle,repl);
end$patch$;

-- 10. Activity index (metadata only for requests: no bank destination) ---------------------
insert into public.activity_log_sources(entity,module_id,label_key,value_keys,scope_kind,identity_keys,branch_columns,scope_parents,metadata_only,reader_roles)
 values('clinic_refund_requests','kas-bank',null,'{}','refs',array['id'],array['branch_id'],'[]',true,array['OWNER','ADMIN']),
 ('clinic_refunds','klinik','no_refund','{tanggal,total,method,point_delta}','refs',array['id'],array['branch_id'],'[]',false,array['OWNER','ADMIN'])
 on conflict (entity) do nothing;
drop trigger if exists a01_activity_change on public.clinic_refund_requests;
create trigger a01_activity_change after insert or update on public.clinic_refund_requests for each row execute function public.capture_activity_log();
drop trigger if exists a01_activity_change on public.clinic_refunds;
create trigger a01_activity_change after insert or update on public.clinic_refunds for each row execute function public.capture_activity_log();

commit;
