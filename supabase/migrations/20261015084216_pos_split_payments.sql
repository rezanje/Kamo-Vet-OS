-- New POS checkouts keep one sale and allocate the received money by method.
-- NULL plans preserve the deployed legacy checkout/online posting paths.
alter table public.sales add column payment_plan jsonb,
 add column payments_finalized_at timestamptz,
 add column checkout_key text,
 add column checkout_fingerprint text;
create unique index sales_checkout_actor_key on public.sales(cashier_id,checkout_key) where checkout_key is not null;
create table public.sale_payments (
 id uuid primary key default gen_random_uuid(),
 sale_id uuid not null references public.sales(id) on delete cascade,
 method text not null check(method in('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet')),
 amount numeric not null check(amount>0 and amount<=1000000000000 and amount=round(amount,2) and amount::text not in('NaN','Infinity','-Infinity')),
 coa_code text not null references public.coa_accounts(code) on update restrict on delete restrict,
 account_snapshot jsonb not null,
 created_at timestamptz not null default now(),
 unique(sale_id,method)
);
alter table public.sale_payments enable row level security;
revoke all on public.sale_payments from public,anon,authenticated,service_role;
grant select on public.sale_payments to authenticated;
create policy sale_payments_read on public.sale_payments for select to authenticated
 using(exists(select 1 from public.sales s where s.id=sale_id and public.user_can_access_branch(s.branch_id)));

-- Stage immutable account/tax snapshots without posting money. The finalizer
-- creates both journals atomically only after all source details are available.
create table public.pos_sale_postings (
 sale_id uuid primary key references public.sales(id) on delete cascade,
 revenue_journal_id uuid unique references public.journal_entries(id) on delete restrict,
 expected_lines jsonb not null,
 hpp_journal_id uuid unique references public.journal_entries(id) on delete restrict
);
alter table public.pos_sale_postings enable row level security;
revoke all on public.pos_sale_postings from public,anon,authenticated,service_role;

create table public.sale_payment_refunds (
 id uuid primary key default gen_random_uuid(),
 sales_return_id uuid not null references public.sales_returns(id) on delete cascade,
 sale_payment_id uuid not null references public.sale_payments(id) on delete restrict,
 amount numeric not null check(amount>0 and amount=round(amount,2) and amount::text not in('NaN','Infinity','-Infinity')),
 expense_id uuid not null references public.expenses(id) on delete restrict,
 created_at timestamptz not null default now(),
 unique(sales_return_id,sale_payment_id)
);
create index sale_payment_refunds_payment_idx on public.sale_payment_refunds(sale_payment_id);
alter table public.sale_payment_refunds enable row level security;
revoke all on public.sale_payment_refunds from public,anon,authenticated,service_role;
grant select on public.sale_payment_refunds to authenticated;
create policy sale_payment_refunds_read on public.sale_payment_refunds for select to authenticated
 using(exists(select 1 from public.sale_payments p where p.id=sale_payment_id));

create function public.pos_sale_assert_actor(p_sale public.sales) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or auth.role() is distinct from 'authenticated'
  or p_sale.cashier_id is distinct from auth.uid() or not public.user_can_access_branch(p_sale.branch_id)
  or not exists(select 1 from public.profiles where id=auth.uid() and is_active and role in('OWNER','ADMIN','FINANCE','STAFF','DOCTOR'))
  or not exists(select 1 from public.branches where id=p_sale.branch_id and is_active) then
  raise exception 'Akses pembayaran POS ditolak.' using errcode='42501';end if;
 if p_sale.shift_id is not null then
  perform 1 from public.cashier_shifts where id=p_sale.shift_id and branch_id=p_sale.branch_id
   and opened_by=auth.uid() and status='open' and shift_type='petshop' for update;
  if not found then raise exception 'Shift kasir tidak valid atau sudah ditutup.' using errcode='42501';end if;
 elsif not public.sales_opname_invoice_access(p_sale.branch_id) then
  raise exception 'Akses POS backoffice ditolak' using errcode='42501';
 end if;
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and (p_sale.created_at at time zone 'Asia/Jakarta')::date<=closed_until) then
  raise exception 'Periode akuntansi sudah ditutup';end if;
end $$;
revoke all on function public.pos_sale_assert_actor(public.sales) from public,anon,authenticated,service_role;

create function public.pos_sale_protect_header() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.payments_finalized_at is not null then raise exception 'Metadata pembayaran dikelola server';end if;
 else
  if new.payment_plan is distinct from old.payment_plan then raise exception 'Rencana pembayaran sudah tetap';end if;
  if new.payments_finalized_at is distinct from old.payments_finalized_at and current_user in('authenticated','anon','service_role') then
   raise exception 'Metadata pembayaran dikelola server';end if;
  if old.payment_plan is not null and
   (to_jsonb(new)-'payments_finalized_at') is distinct from
   (to_jsonb(old)-'payments_finalized_at') then
   raise exception 'Snapshot keuangan penjualan sudah tetap';end if;
 end if;
 return new;
end $$;
revoke all on function public.pos_sale_protect_header() from public,anon,authenticated,service_role;
create trigger pos_sale_protect_header before insert or update on public.sales
 for each row execute function public.pos_sale_protect_header();

create function public.pos_sale_record_payments() returns trigger
language plpgsql security definer set search_path='' as $$
declare r record;account public.coa_accounts%rowtype;cash_account public.cash_accounts%rowtype;
 account_code text;d date;cfg record;gross_dpp numeric;net_dpp numeric;vat numeric;discount_dpp numeric;
 lines jsonb:='[]';parts integer;
begin
 if new.payment_plan is null then return new;end if;
 perform public.pos_sale_assert_actor(new);
 if jsonb_typeof(new.payment_plan) is distinct from 'array' then raise exception 'Rincian pembayaran tidak valid';end if;
 parts:=jsonb_array_length(new.payment_plan);
 if parts not between 0 and 6 or (new.total=0 and parts<>0) or (new.total>0 and parts=0) then raise exception 'Rincian pembayaran harus berisi 1 sampai 6 metode, atau kosong untuk total nol';end if;
 if new.checkout_key is null or length(new.checkout_key) not between 1 and 120 or btrim(new.checkout_key)=''
  or new.checkout_fingerprint is null or new.checkout_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'Identitas checkout tidak valid';end if;
 if new.poin_earned<0 or new.poin_digunakan<0 or (new.customer_id is null and (new.poin_earned<>0 or new.poin_digunakan<>0)) then raise exception 'Poin atau pelanggan tidak valid';end if;
 if new.channel is not null or nullif(btrim(new.no_struk),'') is null
  or new.total<0 or new.total>1000000000000 or new.total::text in('NaN','Infinity','-Infinity') or new.total<>round(new.total,2)
  or new.subtotal<new.total or new.subtotal>1000000000000 or new.subtotal::text in('NaN','Infinity','-Infinity') or new.subtotal<>round(new.subtotal,2)
  or new.discount<0 or new.discount<>round(new.discount,2) or new.discount::text in('NaN','Infinity','-Infinity')
  or new.diskon_kategori<0 or new.diskon_kategori<>round(new.diskon_kategori,2) or new.diskon_kategori::text in('NaN','Infinity','-Infinity')
  or new.total<>new.subtotal-new.discount-new.diskon_kategori
  or new.bayar<0 or new.kembali<0 or new.bayar::text in('NaN','Infinity','-Infinity') or new.kembali::text in('NaN','Infinity','-Infinity')
  or new.bayar<>round(new.bayar,2) or new.kembali<>round(new.kembali,2) or new.bayar-new.kembali<>new.total
  or (new.created_at at time zone 'Asia/Jakarta')::date>(now() at time zone 'Asia/Jakarta')::date then
  raise exception 'Total, potongan, tanggal atau uang diterima tidak valid';end if;
 if exists(select 1 from jsonb_array_elements(new.payment_plan) x where jsonb_typeof(x) is distinct from 'object'
  or jsonb_typeof(x->'method') is distinct from 'string' or jsonb_typeof(x->'amount') is distinct from 'number') then
  raise exception 'Metode dan jumlah pembayaran tidak valid';end if;
 if exists(select 1 from jsonb_to_recordset(new.payment_plan) as x(method text,amount numeric)
  where method is null or method not in('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet')
   or amount is null or amount<=0 or amount>1000000000000 or amount<>round(amount,2) or amount::text in('NaN','Infinity','-Infinity'))
  or (select count(distinct method) from jsonb_to_recordset(new.payment_plan) as x(method text))<>parts
  or (select coalesce(sum(amount),0) from jsonb_to_recordset(new.payment_plan) as x(amount numeric))<>new.total then
  raise exception 'Metode pembayaran harus unik, positif, dan berjumlah sama dengan total';end if;
 if (new.metode_bayar='Split' and parts=0)
  or (new.metode_bayar<>'Split' and (new.metode_bayar not in('Tunai','Transfer','Debit','Kredit','QRIS','E-Wallet') or (parts>0 and (parts<>1 or new.metode_bayar is distinct from new.payment_plan->0->>'method'))))
  or (new.kembali>0 and not ((parts=0 and new.metode_bayar='Tunai') or exists(select 1 from jsonb_to_recordset(new.payment_plan) as x(method text) where method='Tunai'))) then
  raise exception 'Metode pembayaran atau kembalian tidak sesuai';end if;
 d:=(new.created_at at time zone 'Asia/Jakarta')::date;
 select mode_pkp,ppn_rate into cfg from public.company_settings where id for share;
 if cfg.mode_pkp and (cfg.ppn_rate<0 or cfg.ppn_rate>100 or cfg.ppn_rate::text in('NaN','Infinity','-Infinity')) then raise exception 'Tarif PPN tidak valid';end if;
 gross_dpp:=case when coalesce(cfg.mode_pkp,false) then round(new.subtotal*100/(100+cfg.ppn_rate),2) else round(new.subtotal,2) end;
 net_dpp:=case when coalesce(cfg.mode_pkp,false) then round(new.total*100/(100+cfg.ppn_rate),2) else new.total end;
 vat:=new.total-net_dpp;discount_dpp:=gross_dpp-net_dpp;
 -- Fail missing revenue/HPP accounts before the JS stock/detail stage starts.
 for account_code in select unnest(array['5101','1301']||case when new.total>0 then array['4101'] else array[]::text[] end||case when vat>0 then array['2201'] else array[]::text[] end||case when new.total>0 and discount_dpp>0 then array['4102'] else array[]::text[] end) loop
  perform 1 from public.coa_accounts where coa_accounts.code=account_code and is_active and not is_header for share;
  if not found then raise exception 'Akun % tidak tersedia atau bukan akun detail aktif.',account_code;end if;
 end loop;
 for r in select * from jsonb_to_recordset(new.payment_plan) as x(method text,amount numeric) order by method loop
  account_code:=public.unit_posting_cash(r.method,new.branch_id);
  select * into account from public.coa_accounts where coa_accounts.code=account_code and is_active and not is_header and type='ASET' and normal_balance='D' for share;
  if not found then raise exception 'Akun pembayaran % tidak tersedia.',account_code;end if;
  select * into cash_account from public.cash_accounts where coa_code=account_code and is_active and (branch_id is null or branch_id=new.branch_id) for share;
  if not found then raise exception 'Rekening pembayaran % tidak aktif atau bukan cabang ini.',account_code;end if;
  insert into public.sale_payments(sale_id,method,amount,coa_code,account_snapshot)
   values(new.id,r.method,r.amount,account_code,jsonb_build_object('coa_id',account.id,'code',account.code,'name',account.name,'cash_account_id',cash_account.id,'cash_account_name',cash_account.nama));
  lines:=lines||jsonb_build_array(jsonb_build_object('code',account_code,'debit',r.amount,'credit',0));
 end loop;
 if new.total=0 then
  insert into public.pos_sale_postings(sale_id,expected_lines) values(new.id,'[]');
  return new;
 end if;
 if discount_dpp>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','4102','debit',discount_dpp,'credit',0));end if;
 lines:=lines||jsonb_build_array(jsonb_build_object('code','4101','debit',0,'credit',gross_dpp));
 if vat>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','2201','debit',0,'credit',vat));end if;
 insert into public.pos_sale_postings(sale_id,expected_lines) values(new.id,lines);
 return new;
end $$;
revoke all on function public.pos_sale_record_payments() from public,anon,authenticated,service_role;
create trigger pos_sale_record_payments after insert on public.sales for each row execute function public.pos_sale_record_payments();

-- Client roles cannot rewrite the sale or HPP journals after finalization.
-- Internal finalization/cancellation runs as the validated function owner.
create function public.pos_sale_journal_protected(p_entry uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.pos_sale_postings where revenue_journal_id=p_entry or hpp_journal_id=p_entry)
$$;
revoke all on function public.pos_sale_journal_protected(uuid) from public,anon,service_role;
grant execute on function public.pos_sale_journal_protected(uuid) to authenticated,service_role;
create function public.pos_sale_protect_journal() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if current_user in('authenticated','anon','service_role') then
  if tg_table_name='journal_entries' then
   if public.pos_sale_journal_protected(old.id) then raise exception 'Jurnal pembayaran POS sudah tetap';end if;
  else
   if tg_op='INSERT' then
    if public.pos_sale_journal_protected(new.entry_id) then raise exception 'Jurnal pembayaran POS sudah tetap';end if;
   else
    if public.pos_sale_journal_protected(old.entry_id) then raise exception 'Jurnal pembayaran POS sudah tetap';end if;
    if tg_op='UPDATE' then
     if public.pos_sale_journal_protected(new.entry_id) then raise exception 'Jurnal pembayaran POS sudah tetap';end if;
    end if;
   end if;
  end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
revoke all on function public.pos_sale_protect_journal() from public,anon,authenticated,service_role;
create trigger pos_sale_protect_journal_header before update or delete on public.journal_entries for each row execute function public.pos_sale_protect_journal();
create trigger pos_sale_protect_journal_lines before insert or update or delete on public.journal_lines for each row execute function public.pos_sale_protect_journal();

create function public.finalize_pos_sale(p_sale_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sale public.sales%rowtype;posting public.pos_sale_postings%rowtype;
 gross numeric;cost numeric;d date;hpp_id uuid;journal uuid;loyalty_balance integer;
begin
 select * into sale from public.sales where id=p_sale_id for update;
 if not found or sale.payment_plan is null then raise exception 'Pembayaran POS tidak ditemukan' using errcode='42501';end if;
 perform public.pos_sale_assert_actor(sale);
 select * into strict posting from public.pos_sale_postings where sale_id=sale.id for update;
 if sale.payments_finalized_at is not null then
  if sale.total>0 and not exists(select 1 from public.journal_entries where id=posting.revenue_journal_id and source='sale' and source_ref=sale.no_struk and branch_id=sale.branch_id) then raise exception 'Jurnal pembayaran tidak sesuai';end if;
  return jsonb_build_object('sale_id',sale.id,'journal_id',posting.revenue_journal_id,'finalized',true);
 end if;
 if posting.revenue_journal_id is not null or posting.hpp_journal_id is not null then raise exception 'Jurnal pembayaran sudah ada — rekonsiliasi diperlukan';end if;
 if (select coalesce(sum(amount),0) from public.sale_payments where sale_id=sale.id) is distinct from sale.total then raise exception 'Alokasi pembayaran tidak lengkap';end if;
 perform 1 from public.sale_items where sale_id=sale.id order by id for update;
 if not found or exists(select 1 from public.sale_items where sale_id=sale.id and (qty<=0 or qty::text in('NaN','Infinity','-Infinity') or harga<0 or harga::text in('NaN','Infinity','-Infinity') or hpp<0 or hpp::text in('NaN','Infinity','-Infinity') or faktor<=0 or faktor::text in('NaN','Infinity','-Infinity')))
  or exists(select 1 from public.sale_items si join public.items i on i.id=si.item_id where si.sale_id=sale.id and i.item_type in('Persediaan','Grup') and si.hpp is null) then raise exception 'Rincian atau HPP penjualan belum lengkap';end if;
 perform 1 from public.sale_item_group_components c join public.sale_items i on i.id=c.sale_item_id where i.sale_id=sale.id order by c.id for update of c;
 select round(sum(qty*harga),2),sum(coalesce(hpp,0)) into gross,cost from public.sale_items where sale_id=sale.id;
 if gross is distinct from round(sale.subtotal,2) then raise exception 'Subtotal rincian tidak sama dengan header';end if;
 if exists(select 1 from public.journal_entries where source in('sale','sale-hpp') and source_ref=sale.no_struk) then raise exception 'Jurnal penjualan sudah ada — rekonsiliasi diperlukan';end if;
 -- Loyalty shares the same commit as money. A lost RPC response can safely
 -- retry finalization without re-earning/redeeming or orphaning points.
 if sale.poin_earned<0 or sale.poin_digunakan<0 or (sale.customer_id is null and (sale.poin_earned<>0 or sale.poin_digunakan<>0)) then raise exception 'Poin atau pelanggan tidak valid';end if;
 if sale.customer_id is not null then
  select coalesce(points,0) into loyalty_balance from public.customers where id=sale.customer_id for update;
  if not found or loyalty_balance<sale.poin_digunakan then raise exception 'Saldo poin pelanggan tidak cukup';end if;
  if exists(select 1 from public.point_ledger where ref=sale.no_struk) then raise exception 'Ledger poin sumber sudah ada — rekonsiliasi diperlukan';end if;
  if sale.poin_digunakan>0 then
   loyalty_balance:=loyalty_balance-sale.poin_digunakan;
   insert into public.point_ledger(customer_id,delta,saldo,ref,description) values(sale.customer_id,-sale.poin_digunakan,loyalty_balance,sale.no_struk,'Poin digunakan '||sale.no_struk);
  end if;
  if sale.poin_earned>0 then
   loyalty_balance:=loyalty_balance+sale.poin_earned;
   insert into public.point_ledger(customer_id,delta,saldo,ref,description) values(sale.customer_id,sale.poin_earned,loyalty_balance,sale.no_struk,'Transaksi '||sale.no_struk);
  end if;
  update public.customers set points=loyalty_balance where id=sale.customer_id;
 end if;
 d:=(sale.created_at at time zone 'Asia/Jakarta')::date;
 -- The existing snapshot trigger seals zero-total details as well as paid ones.
 -- If either journal fails, this header update and both journals roll back.
 update public.sales set payments_finalized_at=now() where id=sale.id;
 if sale.total>0 then
  perform public.sales_write_journal(d,sale.branch_id,'sale',sale.no_struk,'Penjualan POS '||sale.no_struk,posting.expected_lines);
  select id into strict journal from public.journal_entries where source='sale' and source_ref=sale.no_struk;
 end if;
 if cost>0 then
  perform public.sales_write_journal(d,sale.branch_id,'sale-hpp',sale.no_struk,'HPP penjualan '||sale.no_struk,
   jsonb_build_array(jsonb_build_object('code','5101','debit',cost,'credit',0),jsonb_build_object('code','1301','debit',0,'credit',cost)));
  select id into strict hpp_id from public.journal_entries where source='sale-hpp' and source_ref=sale.no_struk;
 end if;
 update public.pos_sale_postings set revenue_journal_id=journal,hpp_journal_id=hpp_id where sale_id=sale.id;
 return jsonb_build_object('sale_id',sale.id,'journal_id',journal,'finalized',true);
end $$;
revoke all on function public.finalize_pos_sale(uuid) from public,anon,service_role;
grant execute on function public.finalize_pos_sale(uuid) to authenticated;

create function public.pos_sale_cancel_pending() returns trigger
language plpgsql security definer set search_path='' as $$
declare posting public.pos_sale_postings%rowtype;
begin
 if old.payment_plan is null or old.payments_finalized_at is not null then return old;end if;
 if auth.uid() is null or auth.role() is distinct from 'authenticated' or old.cashier_id is distinct from auth.uid()
  or not public.user_can_access_branch(old.branch_id) then raise exception 'Akses pembatalan POS ditolak' using errcode='42501';end if;
 select * into posting from public.pos_sale_postings where sale_id=old.id for update;
 if found then
  if posting.revenue_journal_id is not null or posting.hpp_journal_id is not null then raise exception 'Jurnal penjualan sudah diposting';end if;
  delete from public.pos_sale_postings where sale_id=old.id;
 end if;
 return old;
end $$;
revoke all on function public.pos_sale_cancel_pending() from public,anon,authenticated,service_role;
-- Pending cleanup runs before the existing posted-source guard. Finalized
-- headers retain that guard; no journal exists for a pending checkout.
create trigger pos_sale_cancel_pending before delete on public.sales for each row execute function public.pos_sale_cancel_pending();

create function public.pos_sale_allocation_immutable() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  if tg_table_name='sale_payments' then
   if not exists(select 1 from public.sales where id=old.sale_id) then return old;end if;
  else
   if not exists(select 1 from public.sales_returns where id=old.sales_return_id) then return old;end if;
  end if;
 end if;
 raise exception 'Snapshot alokasi pembayaran sudah tetap';
end $$;
revoke all on function public.pos_sale_allocation_immutable() from public,anon,authenticated,service_role;
create trigger sale_payments_immutable before update or delete on public.sale_payments for each row execute function public.pos_sale_allocation_immutable();
create trigger sale_payment_refunds_immutable before update or delete on public.sale_payment_refunds for each row execute function public.pos_sale_allocation_immutable();

-- Cumulative proportional targets use the divisor method at cent precision.
-- Unlike independently rounded percentages / largest remainders, targets never
-- decrease when a later return raises the cumulative amount. Only <=5 residual
-- cents need allocation after the proportional floor, even for large sales.
create function public.pos_sale_refund_targets(p_sale uuid,p_total numeric)
returns table(sale_payment_id uuid,amount numeric)
language plpgsql security definer set search_path='' as $$
declare ids uuid[];weights numeric[];targets numeric[];denominator numeric;units numeric;
 remaining integer;n integer;i integer;best integer;priority numeric;best_priority numeric;
begin
 select array_agg(p.id order by p.method,p.id),array_agg(p.amount*100 order by p.method,p.id),sum(p.amount*100)
  into ids,weights,denominator from public.sale_payments p where p.sale_id=p_sale;
 if denominator is null or p_total is null or p_total<0 or p_total*100>denominator or p_total<>round(p_total,2) then raise exception 'Nilai alokasi refund tidak valid';end if;
 n:=array_length(ids,1);units:=p_total*100;targets:=array_fill(0::numeric,array[n]);
 for i in 1..n loop targets[i]:=floor(units*weights[i]/denominator);end loop;
 select (units-sum(x))::integer into remaining from unnest(targets) x;
 while remaining>0 loop
  best:=null;best_priority:=null;
  for i in 1..n loop
   if targets[i]<weights[i] then
    priority:=weights[i]/(targets[i]+1);
    if best is null or priority>best_priority then best:=i;best_priority:=priority;end if;
   end if;
  end loop;
  if best is null then raise exception 'Alokasi refund melebihi sumber';end if;
  targets[best]:=targets[best]+1;remaining:=remaining-1;
 end loop;
 for i in 1..n loop sale_payment_id:=ids[i];amount:=targets[i]/100;return next;end loop;
end $$;
revoke all on function public.pos_sale_refund_targets(uuid,numeric) from public,anon,authenticated,service_role;

create function public.pos_sale_post_refund(p_sale public.sales,p_doc uuid,p_no text,p_date date,p_total numeric) returns void
language plpgsql security definer set search_path='' as $$
declare previous numeric;cumulative numeric;r record;shift uuid;expense uuid;credits jsonb:='[]';lines jsonb;
 source_lines jsonb;source_vat numeric;source_discount numeric;vat numeric;discount numeric;allocated numeric:=0;
begin
 if p_sale.payments_finalized_at is null or p_sale.total<=0 then raise exception 'Pembayaran sumber belum final';end if;
 select coalesce(sum(total),0) into previous from public.sales_returns where sale_id=p_sale.id and id<>p_doc;
 cumulative:=previous+p_total;
 if cumulative>p_sale.total or p_total<=0 then raise exception 'Refund melebihi pembayaran sumber';end if;
 if (select coalesce(sum(f.amount),0) from public.sale_payment_refunds f join public.sale_payments p on p.id=f.sale_payment_id where p.sale_id=p_sale.id) is distinct from previous then raise exception 'Riwayat alokasi refund perlu rekonsiliasi';end if;
 select expected_lines into strict source_lines from public.pos_sale_postings where sale_id=p_sale.id;
 select coalesce(sum(credit-debit) filter(where code='2201'),0),coalesce(sum(debit-credit) filter(where code='4102'),0)
  into source_vat,source_discount from jsonb_to_recordset(source_lines) as x(code text,debit numeric,credit numeric);
 vat:=round(source_vat*cumulative/p_sale.total,2)-round(source_vat*previous/p_sale.total,2);
 discount:=round(source_discount*cumulative/p_sale.total,2)-round(source_discount*previous/p_sale.total,2);
 for r in select p.id,p.method,p.coa_code,t.amount-coalesce((select sum(f.amount) from public.sale_payment_refunds f where f.sale_payment_id=p.id),0) refund
  from public.sale_payments p join public.pos_sale_refund_targets(p_sale.id,cumulative) t on t.sale_payment_id=p.id order by p.method,p.id loop
  if r.refund<0 then raise exception 'Alokasi refund tidak boleh negatif';end if;
  if r.refund=0 then continue;end if;
  shift:=null;
  if r.method='Tunai' then
   select id into shift from public.cashier_shifts where branch_id=p_sale.branch_id and opened_by=auth.uid() and status='open' and shift_type='petshop' order by opened_at desc,id limit 1 for update;
  end if;
  expense:=gen_random_uuid();
  insert into public.expenses(id,branch_id,tanggal,kategori,deskripsi,jumlah,metode_bayar,shift_id,created_by)
   values(expense,p_sale.branch_id,p_date,'Retur Penjualan','Refund retur '||p_no||' (struk '||p_sale.no_struk||')',r.refund,r.method,shift,auth.uid());
  insert into public.sale_payment_refunds(sales_return_id,sale_payment_id,amount,expense_id) values(p_doc,r.id,r.refund,expense);
  credits:=credits||jsonb_build_array(jsonb_build_object('code',r.coa_code,'debit',0,'credit',r.refund));allocated:=allocated+r.refund;
 end loop;
 if allocated<>p_total then raise exception 'Jumlah refund tidak sama dengan nilai retur';end if;
 lines:=jsonb_build_array(jsonb_build_object('code','4101','debit',p_total-vat+discount,'credit',0))||credits;
 if discount>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','4102','debit',0,'credit',discount));end if;
 if vat>0 then lines:=lines||jsonb_build_array(jsonb_build_object('code','2201','debit',vat,'credit',0));end if;
 perform public.sales_write_journal(p_date,p_sale.branch_id,'sales-return',p_no,'Retur penjualan '||p_no,lines);
end $$;
revoke all on function public.pos_sale_post_refund(public.sales,uuid,text,date,numeric) from public,anon,authenticated,service_role;

-- Full source definition retained so stock/group and legacy return logic remain inspectable.
create or replace function public.post_unit_return(p_kind text,p_source uuid,p_request_key text,p_header jsonb,p_items jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare po public.purchase_orders%rowtype;sale public.sales%rowtype;prior public.unit_posting_requests%rowtype;v_scope text;branch uuid;wh uuid;payload jsonb;result jsonb;d date;no text;doc uuid:=gen_random_uuid();r record;src record;u record;it public.items%rowtype;c record;lines jsonb:='[]';base numeric;available numeric;used numeric;cost numeric;price numeric;total numeric:=0;hppgood numeric:=0;hppbad numeric:=0;ratio numeric:=1;paid numeric;accepted numeric;previous numeric;cash text;shift uuid;dpp numeric;ppn numeric;cfg record;componentqty numeric;componentcost numeric;stockqty numeric;source_hpp numeric;is_group boolean;raw_return_total numeric;previous_hpp numeric;issued record;inventory_cost numeric:=0;variance numeric;
begin
 if p_kind not in ('purchase','sales') or p_kind is null then raise exception 'Jenis retur tidak valid';end if;
 v_scope:=case when p_kind='purchase' then 'purchase-return:' else 'sales-return:' end||p_source::text;
 if p_kind='purchase' then
  select * into po from public.purchase_orders where id=p_source for update;if not found then raise exception 'PO tidak ditemukan';end if;
  branch:=po.branch_id;wh:=po.to_warehouse_id;
 else
  select * into sale from public.sales where id=p_source and channel is null for update;if not found then raise exception 'Struk tidak ditemukan atau online';end if;
  branch:=sale.branch_id;
  if not exists(select 1 from public.journal_entries where source='sale' and source_ref=sale.no_struk) then raise exception 'Jurnal sumber penjualan belum tersedia — rekonsiliasi diperlukan';end if;
 end if;
 perform public.unit_posting_access(v_scope,branch);
 if p_kind='sales' and coalesce(p_header->>'dari','')<>'kasir' then perform public.sales_assert_access(branch);end if;
 if p_request_key is null or length(p_request_key) not between 1 and 120 or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Identitas atau barang tidak valid' using errcode='22023';end if;
 payload:=jsonb_build_object('header',p_header,'items',p_items);
 perform pg_advisory_xact_lock(hashtext('vetos:unit-request:'||auth.uid()::text||':'||p_request_key)::bigint);
 select * into prior from public.unit_posting_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then if prior.scope<>v_scope or prior.payload<>payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda' using errcode='22023';end if;return prior.result;end if;
 if p_kind='purchase' and (po.status<>'Diterima' or wh is null) then raise exception 'PO belum diterima atau tidak punya gudang';end if;
 if p_kind='sales' then
  if nullif(p_header->>'lock_branch_id','') is not null and (p_header->>'lock_branch_id')::uuid<>branch then raise exception 'Struk bukan cabang kasir';end if;
  -- Cashier authorization derives from the actual active shift, never a client branch field.
  if p_header->>'dari'='kasir' and not exists(select 1 from public.cashier_shifts where opened_by=auth.uid() and branch_id=branch and status='open' and shift_type='petshop') then raise exception 'Shift kasir tidak ditemukan' using errcode='42501';end if;
  select id into wh from public.warehouses where branch_id=branch and is_active order by type,id limit 1;
  ratio:=case when sale.subtotal>0 then least(1,greatest(0,sale.total/sale.subtotal)) else 1 end;
 end if;
 d:=(p_header->>'tanggal')::date;if d is null then raise exception 'Tanggal wajib';end if;
 perform 1 from public.accounting_locks where id for share;
 if exists(select 1 from public.accounting_locks where id and d<=closed_until) then raise exception 'Periode akuntansi sudah ditutup';end if;
 if (select count(*) from jsonb_to_recordset(p_items) as x(source_line_id uuid))<>(select count(distinct source_line_id) from jsonb_to_recordset(p_items) as x(source_line_id uuid)) then raise exception 'Baris sumber dobel atau kosong' using errcode='22023';end if;
 for r in select * from jsonb_to_recordset(p_items) as x(source_line_id uuid,item_id uuid,qty numeric,satuan text,kondisi text,exp_date date) order by item_id,source_line_id loop
  if r.qty is null or r.qty<=0 or r.qty>1000000000 or r.qty::text='NaN' then raise exception 'Qty tidak valid' using errcode='22023';end if;
  if r.kondisi is not null and r.kondisi not in ('baik','rusak') then raise exception 'Kondisi tidak valid' using errcode='22023';end if;
  if p_kind='purchase' then
   select id,item_id,nama,coalesce(qty_terima,qty) qty,faktor,harga_beli harga,null::numeric hpp into src from public.purchase_order_items where id=r.source_line_id and po_id=p_source for update;
  else
   select id,item_id,nama,qty,faktor,harga,hpp into src from public.sale_items where id=r.source_line_id and sale_id=p_source for update;
  end if;
  if not found or src.item_id is null or src.item_id is distinct from r.item_id then raise exception 'Baris bukan milik dokumen sumber' using errcode='22023';end if;
  if src.faktor is null or src.faktor<=0 then raise exception 'Snapshot faktor sumber tidak valid';end if;
  select * into u from public.unit_posting_factor(src.item_id,r.satuan,true);
  base:=r.qty*u.factor;
  if p_kind='purchase' then
   if exists(select 1 from public.purchase_return_items ri join public.purchase_returns rt on rt.id=ri.return_id where rt.po_id=p_source and ri.item_id=src.item_id and ri.source_line_id is null)
      and (select count(*) from public.purchase_order_items where po_id=p_source and item_id=src.item_id)>1 then raise exception 'Retur lama perlu rekonsiliasi sumber baris';end if;
   select coalesce(sum(ri.qty),0) into used from public.purchase_return_items ri join public.purchase_returns rt on rt.id=ri.return_id where rt.po_id=p_source and (ri.source_line_id=src.id or (ri.source_line_id is null and ri.item_id=src.item_id));
   price:=src.harga/src.faktor;cost:=base*price;
  else
   if exists(select 1 from public.sales_return_items ri join public.sales_returns rt on rt.id=ri.return_id where rt.sale_id=p_source and ri.item_id=src.item_id and ri.source_line_id is null)
      and (select count(*) from public.sale_items where sale_id=p_source and item_id=src.item_id)>1 then raise exception 'Retur lama perlu rekonsiliasi sumber baris';end if;
   select coalesce(sum(ri.qty),0) into used from public.sales_return_items ri join public.sales_returns rt on rt.id=ri.return_id where rt.sale_id=p_source and (ri.source_line_id=src.id or (ri.source_line_id is null and ri.item_id=src.item_id));
   price:=src.harga/src.faktor*ratio;
   select * into it from public.items where id=src.item_id;
   if coalesce(it.item_type,'Persediaan')='Persediaan' and src.hpp is null then raise exception 'HPP sumber belum tersedia — rekonsiliasi diperlukan';end if;
   is_group:=exists(select 1 from public.sale_item_group_components where sale_item_id=src.id);
   if is_group then select coalesce(sum(hpp),0) into source_hpp from public.sale_item_group_components where sale_item_id=src.id and item_type='Persediaan';
   else source_hpp:=coalesce(src.hpp,0);end if;

   select coalesce(sum(coalesce(ri.hpp,ri.qty*source_hpp/(src.qty*src.faktor))),0) into previous_hpp from public.sales_return_items ri join public.sales_returns rt on rt.id=ri.return_id where rt.sale_id=p_source and (ri.source_line_id=src.id or (ri.source_line_id is null and ri.item_id=src.item_id));
   if previous_hpp<0 or previous_hpp>source_hpp then raise exception 'Alokasi HPP sumber perlu rekonsiliasi';end if;
   cost:=greatest(0,least(source_hpp,case when is_group then source_hpp*(used+base)/(src.qty*src.faktor) else round(source_hpp*(used+base)/(src.qty*src.faktor),2) end)-previous_hpp);
  end if;
  available:=src.qty*src.faktor-used;
  if base>available then raise exception 'Qty melebihi sisa % satuan dasar',available using errcode='22003';end if;
  total:=total+base*price;
  lines:=lines||jsonb_build_array(jsonb_build_object('source_line_id',src.id,'item_id',src.item_id,'nama',src.nama,'qty',base,'selected_qty',r.qty,'satuan',u.unit,'faktor',u.factor,'harga',price,'hpp',cost,'source_base',src.qty*src.faktor,'kondisi',coalesce(r.kondisi,'baik'),'exp_date',r.exp_date));
 end loop;
 if total<=0 then raise exception 'Nilai retur nol';end if;
 if p_kind='purchase' then
  -- Same PO lock as invoice creation; lock invoices before payments can change the debt.
  perform 1 from public.purchase_invoices where po_id=p_source order by id for update;
  select coalesce(sum(p.amount),0) into paid from public.purchase_invoice_payments p join public.purchase_invoices i on i.id=p.invoice_id where i.po_id=p_source;
  select coalesce(sum(coalesce(qty_terima,qty)*harga_beli),0) into accepted from public.purchase_order_items where po_id=p_source;
  select coalesce(sum(rt.total),0) into previous from public.purchase_returns rt where rt.po_id=p_source;
  if total>greatest(0,accepted-paid-previous) then raise exception 'Nilai retur melebihi sisa hutang' using errcode='22003';end if;
  for r in select item_id,sum(qty) qty from jsonb_to_recordset(lines) as x(item_id uuid,qty numeric) group by item_id order by item_id loop
   select qty into stockqty from public.stock where warehouse_id=wh and item_id=r.item_id for update;
   if stockqty is null or stockqty<r.qty then raise exception 'Stok tidak cukup' using errcode='22003';end if;
  end loop;
  no:=public.unit_posting_number('RB',d);
  insert into public.purchase_returns(id,no_retur,po_id,tanggal,keterangan,total,created_by) values(doc,no,p_source,d,nullif(p_header->>'keterangan',''),total,auth.uid());
 else
  if sale.payment_plan is not null then
   -- Round the cumulative selected value, not each return independently. This
   -- preserves the exact paid ceiling for fractional quantities/prices.
   select coalesce(sum(rt.total),0) into previous from public.sales_returns rt where rt.sale_id=sale.id;
   raw_return_total:=total;
   select round(coalesce(sum(ri.qty*ri.harga),0)+raw_return_total,2)-previous into total
    from public.sales_return_items ri join public.sales_returns rt on rt.id=ri.return_id where rt.sale_id=sale.id;
   if total<=0 or previous+total>sale.total then raise exception 'Nilai retur melebihi pembayaran atau di bawah presisi uang';end if;
  end if;
  no:=public.unit_posting_number('RJ',d);
  insert into public.sales_returns(id,no_retur,sale_id,tanggal,keterangan,total,created_by) values(doc,no,p_source,d,nullif(p_header->>'keterangan',''),total,auth.uid());
 end if;
 for r in select * from jsonb_to_recordset(lines) as x(source_line_id uuid,item_id uuid,nama text,qty numeric,selected_qty numeric,satuan text,faktor numeric,harga numeric,hpp numeric,source_base numeric,kondisi text,exp_date date) order by item_id,source_line_id loop
  if p_kind='purchase' then
   select * into issued from public.stock_out_fifo(wh,r.item_id,r.qty,'retur-beli',no,d);
   if issued.shortfall>0 then raise exception 'Lapisan stok tidak cukup untuk HPP FIFO' using errcode='22003';end if;
   inventory_cost:=inventory_cost+issued.cost;
   insert into public.purchase_return_items(return_id,source_line_id,item_id,nama,qty,harga,selected_qty,satuan,faktor,hpp) values(doc,r.source_line_id,r.item_id,r.nama,r.qty,r.harga,r.selected_qty,r.satuan,r.faktor,issued.cost);
  else
   insert into public.sales_return_items(return_id,source_line_id,item_id,nama,qty,harga,selected_qty,satuan,faktor,hpp,kondisi,exp_date) values(doc,r.source_line_id,r.item_id,r.nama,r.qty,r.harga,r.selected_qty,r.satuan,r.faktor,r.hpp,r.kondisi,r.exp_date);
   if exists(select 1 from public.sale_item_group_components where sale_item_id=r.source_line_id) then
    for c in select * from public.sale_item_group_components where sale_item_id=r.source_line_id and item_type='Persediaan' order by component_item_id loop
     componentqty:=c.total_base_qty*r.qty/r.source_base;componentcost:=c.hpp*r.qty/r.source_base;
     if c.component_item_id is null then raise exception 'Komponen sumber sudah dihapus';end if;
     if r.kondisi='baik' then
      if wh is null then raise exception 'Gudang aktif diperlukan';end if;
      perform public.stock_in_fifo(wh,c.component_item_id,componentqty,componentcost/componentqty,'retur-jual-group',no,d,r.exp_date);hppgood:=hppgood+componentcost;
     else hppbad:=hppbad+componentcost;end if;
    end loop;
   else
    select * into it from public.items where id=r.item_id;
    if coalesce(it.item_type,'Persediaan')='Persediaan' then
     if r.kondisi='baik' then
      if wh is null then raise exception 'Gudang aktif diperlukan';end if;
      perform public.stock_in_fifo(wh,r.item_id,r.qty,r.hpp/r.qty,'retur-jual',no,d,r.exp_date);hppgood:=hppgood+r.hpp;
     else hppbad:=hppbad+r.hpp;end if;
    end if;
   end if;
  end if;
 end loop;
 if p_kind='purchase' then
  variance:=inventory_cost-total;
  perform public.sales_write_journal(d,branch,'purchase-return',no,'Retur pembelian '||no,jsonb_build_array(jsonb_build_object('code','2101','debit',total,'credit',0),jsonb_build_object('code','1301','debit',0,'credit',inventory_cost),jsonb_build_object('code','5902','debit',greatest(variance,0),'credit',greatest(-variance,0))));
 else
  if sale.payment_plan is not null then
   perform public.pos_sale_post_refund(sale,doc,no,d,total);
  else
  if sale.metode_bayar='Tunai' then select id into shift from public.cashier_shifts where branch_id=branch and opened_by=auth.uid() and status='open' and shift_type='petshop' order by opened_at desc limit 1 for update;end if;
  insert into public.expenses(branch_id,tanggal,kategori,deskripsi,jumlah,metode_bayar,shift_id,created_by) values(branch,d,'Retur Penjualan','Refund retur '||no||' (struk '||sale.no_struk||')',total,sale.metode_bayar,shift,auth.uid());
  select a.code into cash from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id where e.source='sale' and e.source_ref=sale.no_struk and l.debit>0 and (a.code in ('1101','1102') or a.code in(select coa_code from public.cash_accounts)) limit 1;
  cash:=coalesce(cash,public.unit_posting_cash(sale.metode_bayar,branch));
  select mode_pkp,ppn_rate into cfg from public.company_settings where id;
  dpp:=case when coalesce(cfg.mode_pkp,false) then round(total*100/(100+cfg.ppn_rate)) else total end;ppn:=total-dpp;
  perform public.sales_write_journal(d,branch,'sales-return',no,'Retur penjualan '||no,jsonb_build_array(jsonb_build_object('code','4101','debit',dpp,'credit',0),jsonb_build_object('code','2201','debit',ppn,'credit',0),jsonb_build_object('code',cash,'debit',0,'credit',total)));
  end if;
  if hppgood+hppbad>0 then perform public.sales_write_journal(d,branch,'sales-return-hpp',no,'HPP retur '||no,jsonb_build_array(jsonb_build_object('code','1301','debit',hppgood,'credit',0),jsonb_build_object('code','5902','debit',hppbad,'credit',0),jsonb_build_object('code','5101','debit',0,'credit',hppgood+hppbad)));end if;
 end if;
 result:=jsonb_build_object('document_id',doc,'document_no',no);
 insert into public.unit_posting_requests values(auth.uid(),v_scope,p_request_key,payload,result,branch);return result;
end $$;
revoke all on function public.post_unit_return(text,uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.post_unit_return(text,uuid,text,jsonb,jsonb) to authenticated;


create or replace function public.unit_posted_sale_source_immutable() returns trigger language plpgsql security definer set search_path='' as $$
declare sale_id uuid;ref text;posted boolean;
begin
 if tg_op='UPDATE' and tg_table_name='sale_items' then if new.sale_id is distinct from old.sale_id then raise exception 'Induk rincian penjualan tidak boleh dipindah' using errcode='22023';end if;end if;
 if tg_op='UPDATE' and tg_table_name='sale_item_group_components' then if new.sale_item_id is distinct from old.sale_item_id then raise exception 'Induk snapshot komponen tidak boleh dipindah' using errcode='22023';end if;end if;
 if tg_table_name='sales' then sale_id:=old.id;
 elsif tg_table_name='sale_item_group_components' then select si.sale_id into sale_id from public.sale_items si where si.id=case when tg_op='INSERT' then new.sale_item_id else old.sale_item_id end;
 elsif tg_op='INSERT' then sale_id:=new.sale_id;
 else sale_id:=old.sale_id;end if;
 -- Serialize source writes with finalization before checking the seal. A late
 -- child INSERT must not pass this check then wait at its foreign key until
 -- after finalization has committed.
 select no_struk into ref from public.sales where id=sale_id for update;
 posted:=exists(select 1 from public.journal_entries where source in ('sale','sale-online') and source_ref=ref)
  or exists(select 1 from public.sales where id=sale_id and payments_finalized_at is not null);
 if posted then
  if tg_table_name='sales' and tg_op='UPDATE' then
   if (to_jsonb(new)-array['marketplace_status','komisi','disbursed_at','external_ref','buyer_name']) is distinct from (to_jsonb(old)-array['marketplace_status','komisi','disbursed_at','external_ref','buyer_name']) then raise exception 'Snapshot penjualan yang sudah diposting tidak boleh diubah' using errcode='22023';end if;
  else raise exception 'Snapshot rincian penjualan yang sudah diposting tidak boleh diubah' using errcode='22023';end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
revoke all on function public.unit_posted_sale_source_immutable() from public,anon,authenticated,service_role;

-- The shift row lock used by header insertion/finalization serializes a close
-- with checkout staging. Closing cannot strand an in-flight FIFO checkout.
create index sales_pending_checkout_shift_idx on public.sales(shift_id)
 where payment_plan is not null and payments_finalized_at is null;
-- Includes legacy headers when validating a mixed shift's final snapshot.
create index sales_payment_shift_idx on public.sales(shift_id);
create function public.pos_shift_pending_checkout_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare actual_breakdown jsonb;cash_expenses numeric;actual_expected numeric;
begin
 if old.status<>'open' or new.status is not distinct from old.status then return new;end if;
 if exists(select 1 from public.sales where shift_id=old.id and payment_plan is not null and payments_finalized_at is null) then
  raise exception 'Pembayaran masih diproses. Selesaikan transaksi sebelum menutup shift.';
 end if;
 -- Header insertion and finalization lock this same shift row. Recompute after
 -- acquiring the close's UPDATE lock: a checkout may have finalized since the
 -- app read its totals. Reject that stale snapshot before any variance journal.
 if old.shift_type='petshop' and new.status='closed'
  and exists(select 1 from public.sales where shift_id=old.id and payment_plan is not null) then
  select coalesce(jsonb_object_agg(t.method,round(t.amount,2)),'{}'::jsonb) into actual_breakdown
   from(select incoming.method,sum(incoming.amount) amount from(
    select s.metode_bayar method,s.total amount from public.sales s
     where s.shift_id=old.id and s.payment_plan is null and s.total<>0
    union all
    select p.method,p.amount from public.sale_payments p join public.sales s on s.id=p.sale_id
     where s.shift_id=old.id and s.payment_plan is not null and s.payments_finalized_at is not null
   ) incoming group by incoming.method) t;
  actual_breakdown:=jsonb_build_object('Tunai',0,'Transfer',0,'Debit',0,'Kredit',0,'QRIS',0,'E-Wallet',0)||actual_breakdown;
  select round(coalesce(sum(jumlah),0),2) into cash_expenses from public.expenses where shift_id=old.id and metode_bayar='Tunai';
  actual_expected:=round(new.opening_balance+(actual_breakdown->>'Tunai')::numeric-cash_expenses,2);
  if new.expected_cash is distinct from actual_expected or new.closing_breakdown is distinct from actual_breakdown then
   raise exception 'Pembayaran shift berubah. Hitung ulang sebelum menutup shift.';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.pos_shift_pending_checkout_guard() from public,anon,authenticated,service_role;
create trigger pos_shift_pending_checkout_guard before update on public.cashier_shifts
 for each row execute function public.pos_shift_pending_checkout_guard();
