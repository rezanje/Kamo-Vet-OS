-- Bounded sales document posting. Shared stock/postJournal functions are unchanged.
create table public.sales_posting_requests (
  actor_id uuid not null references public.profiles(id),
  kind text not null check(kind in ('delivery','invoice')),
  request_key text not null check(length(request_key) between 1 and 120),
  order_id uuid not null references public.sales_orders(id),
  branch_id uuid references public.branches(id),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,kind,request_key)
);
alter table public.sales_posting_requests enable row level security;
revoke all on public.sales_posting_requests from anon,authenticated;

-- Immutable cost links for NEW invoices. Historical invoices are not backfilled.
create table public.sales_invoice_delivery_allocations (
  invoice_item_id uuid not null references public.sales_invoice_items(id),
  delivery_item_id uuid not null references public.sales_delivery_items(id),
  qty numeric not null check(qty>0),
  hpp numeric(15,2) not null check(hpp>=0),
  created_at timestamptz not null default now(),
  primary key(invoice_item_id,delivery_item_id)
);
create index on public.sales_invoice_delivery_allocations(delivery_item_id);
alter table public.sales_invoice_delivery_allocations enable row level security;
revoke all on public.sales_invoice_delivery_allocations from anon,authenticated;
grant select on public.sales_invoice_delivery_allocations to authenticated;
create policy sales_allocations_read on public.sales_invoice_delivery_allocations for select to authenticated
  using(exists(select 1 from public.sales_invoice_items i where i.id=invoice_item_id));
create function public.sales_allocations_immutable() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'Alokasi HPP faktur sudah tetap dan tidak boleh diubah.'; end $$;
revoke all on function public.sales_allocations_immutable() from public,anon,authenticated;
create trigger sales_allocations_immutable before update or delete on public.sales_invoice_delivery_allocations
  for each row execute function public.sales_allocations_immutable();

-- The cost links also freeze both referenced document-line snapshots.
create function public.sales_allocated_line_immutable() returns trigger
language plpgsql security definer set search_path='' as $$begin
  if (tg_table_name='sales_invoice_items' and exists(select 1 from public.sales_invoice_delivery_allocations where invoice_item_id=old.id))
     or (tg_table_name='sales_delivery_items' and exists(select 1 from public.sales_invoice_delivery_allocations where delivery_item_id=old.id)) then
    raise exception 'Baris dengan alokasi HPP faktur sudah tetap. Minta keuangan meninjau.';
  end if;
  return coalesce(new,old);
end $$;
revoke all on function public.sales_allocated_line_immutable() from public,anon,authenticated;
create trigger sales_allocated_invoice_line_immutable before update or delete on public.sales_invoice_items
  for each row execute function public.sales_allocated_line_immutable();
create trigger sales_allocated_delivery_line_immutable before update or delete on public.sales_delivery_items
  for each row execute function public.sales_allocated_line_immutable();

-- Match lib/akses.ts: active OWNER overrides custom modules; ADMIN/DOCTOR
-- without custom rows retain full defaults. FINANCE/STAFF require sales enabled.
create function public.sales_module_access() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active is true and (
    p.role='OWNER'
    or exists(select 1 from public.role_modules m where m.role=p.role and m.module_id='penjualan')
    or (p.role in ('ADMIN','DOCTOR') and not exists(select 1 from public.role_modules m where m.role=p.role))
  ));
$$;
revoke all on function public.sales_module_access() from public,anon;
grant execute on function public.sales_module_access() to authenticated;

-- SECURITY DEFINER entry points always check the JWT actor and source branch.
create function public.sales_assert_access(p_branch uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_active is true and role in ('OWNER','ADMIN','FINANCE','STAFF','DOCTOR'))
     or not public.sales_module_access()
     or not public.user_can_access_branch(p_branch) then
    raise exception 'Dokumen penjualan tidak ditemukan atau tidak dapat diakses.' using errcode='42501';
  end if;
end $$;
revoke all on function public.sales_assert_access(uuid) from public,anon,authenticated;

-- Active, branch-scoped reads also serve finance AR/tax/ledger/report modules.
-- Restrict mutations independently to the sales module and supported roles.
do $$ declare t text; p text; predicate text; begin
  for t,p,predicate in select * from (values
    ('sales_quotations','sq_all','public.user_can_access_branch(branch_id)'),
    ('sales_orders','so_all','public.user_can_access_branch(branch_id)'),
    ('sales_invoices','si_all','public.user_can_access_branch(branch_id)'),
    ('sales_quotation_items','sqi_all','exists(select 1 from public.sales_quotations q where q.id=quotation_id)'),
    ('sales_order_items','soi_all','exists(select 1 from public.sales_orders o where o.id=order_id)'),
    ('sales_deliveries','sd_all','exists(select 1 from public.sales_orders o where o.id=order_id)'),
    ('sales_delivery_items','sdi_all','exists(select 1 from public.sales_deliveries d where d.id=delivery_id)'),
    ('sales_invoice_items','sii_all','exists(select 1 from public.sales_invoices i where i.id=invoice_id)')
  ) as policies(t,p,predicate) loop
    execute format('drop policy %I on public.%I',p,t);
    execute format('create policy %I on public.%I for select to authenticated using ((%s) and exists(select 1 from public.profiles actor where actor.id=auth.uid() and actor.is_active is true))',p||'_read',t,predicate);
    execute format('create policy %I on public.%I for all to authenticated using ((%s) and public.sales_module_access() and exists(select 1 from public.profiles where id=auth.uid() and role in (''OWNER'',''ADMIN'',''FINANCE'',''STAFF'',''DOCTOR''))) with check ((%s) and public.sales_module_access() and exists(select 1 from public.profiles where id=auth.uid() and role in (''OWNER'',''ADMIN'',''FINANCE'',''STAFF'',''DOCTOR'')))',p||'_write',t,predicate,predicate);
  end loop;
end $$;

-- Stock-opname shortages also create invoices from the inventory/cashier flow.
-- Permit only new, actor-owned shortage invoices; ordinary sales stay gated.
create function public.sales_opname_invoice_access(p_branch uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active is true
    and public.user_can_access_branch(p_branch) and (
      p.role='OWNER'
      or exists(select 1 from public.role_modules m where m.role=p.role and m.module_id='pos')
      or (p.role in ('ADMIN','DOCTOR') and not exists(select 1 from public.role_modules m where m.role=p.role))
      or exists(select 1 from public.cashier_shifts s where s.opened_by=auth.uid()
        and s.status='open' and s.shift_type='petshop' and s.branch_id=p_branch)
    ));
$$;
revoke all on function public.sales_opname_invoice_access(uuid) from public,anon,service_role;
grant execute on function public.sales_opname_invoice_access(uuid) to authenticated;
create policy sales_opname_invoice_insert on public.sales_invoices for insert to authenticated
  with check(kategori='selisih_stok' and order_id is null and created_by=auth.uid()
    and public.sales_opname_invoice_access(branch_id));
create policy sales_opname_invoice_item_insert on public.sales_invoice_items for insert to authenticated
  with check(order_item_id is null and exists(select 1 from public.sales_invoices i
    where i.id=invoice_id and i.kategori='selisih_stok' and i.order_id is null
      and i.created_by=auth.uid() and public.sales_opname_invoice_access(i.branch_id)));

-- Internal only: honor configured formats and allocate against all branches.
create function public.sales_next_number(p_kind text,p_date date) returns text
language plpgsql security definer set search_path='' as $$
declare v_prefix text; v_digits integer; v_table text; v_column text; v_seq bigint; begin
  if p_kind not in ('DO','FJ','FJK','SO','JRN') then raise exception 'Seri dokumen tidak valid'; end if;
  if p_kind='JRN' then
    v_prefix:='JRN-'||to_char(p_date,'YYYYMM')||'-'; v_digits:=4; v_table:='journal_entries'; v_column:='no_jurnal';
  else
    select pola,digit into v_prefix,v_digits from public.document_numbering where jenis=p_kind;
    v_prefix:=coalesce(v_prefix,p_kind||'.{YYYY}.{MM}.'); v_digits:=coalesce(v_digits,5);
    v_prefix:=replace(replace(replace(replace(v_prefix,'{YYYY}',to_char(p_date,'YYYY')),'{YY}',to_char(p_date,'YY')),'{MM}',to_char(p_date,'MM')),'{DD}',to_char(p_date,'DD'));
    v_table:=case p_kind when 'DO' then 'sales_deliveries' when 'SO' then 'sales_orders' else 'sales_invoices' end;
    v_column:=case p_kind when 'DO' then 'no_kirim' when 'SO' then 'no_pesanan' else 'no_faktur' end;
  end if;
  if v_digits not between 1 and 8 or length(v_prefix)+v_digits>(case when p_kind='JRN' then 24 else 30 end) then raise exception 'Format nomor terlalu panjang'; end if;
  -- Shared lock namespace with existing atomic journal RPCs.
  perform pg_advisory_xact_lock(hashtext(case when p_kind='JRN' then 'vetos:journal:' else 'vetos:sales-number:' end||v_prefix)::bigint);
  execute format('select coalesce(max(substring(%I from $1 for $2)::bigint),0)+1 from public.%I where left(%I,$3)=$4 and substring(%I from $1 for $2) ~ ''^[0-9]+$''',v_column,v_table,v_column,v_column)
    into v_seq using length(v_prefix)+1,v_digits,length(v_prefix),v_prefix;
  if length(v_seq::text)>v_digits then raise exception 'Urutan nomor dokumen penuh'; end if;
  return v_prefix||lpad(v_seq::text,v_digits,'0');
end $$;
revoke all on function public.sales_next_number(text,date) from public,anon,authenticated;

create function public.sales_write_journal(p_date date,p_branch uuid,p_source text,p_ref text,p_description text,p_lines jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare v_line record; v_account uuid; v_id uuid:=gen_random_uuid(); v_lines jsonb:='[]'; begin
  if jsonb_array_length(p_lines)=0 then return; end if;
  if (select sum(debit)-sum(credit) from jsonb_to_recordset(p_lines) as x(code text,debit numeric,credit numeric))<>0 then raise exception 'Jurnal tidak seimbang'; end if;
  for v_line in select * from jsonb_to_recordset(p_lines) as x(code text,debit numeric,credit numeric) where debit>0 or credit>0 loop
    select id into v_account from public.coa_accounts where code=v_line.code and is_active and not is_header;
    if not found then raise exception 'Akun % tidak tersedia atau bukan akun detail aktif.',v_line.code; end if;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',v_account,'debit',v_line.debit,'credit',v_line.credit));
  end loop;
  insert into public.journal_entries(id,no_jurnal,tanggal,branch_id,source,source_ref,deskripsi)
    values(v_id,public.sales_next_number('JRN',p_date),p_date,p_branch,p_source,p_ref,p_description);
  insert into public.journal_lines(entry_id,account_id,debit,credit)
    select v_id,account_id,debit,credit from jsonb_to_recordset(v_lines) as x(account_id uuid,debit numeric,credit numeric);
end $$;
revoke all on function public.sales_write_journal(date,uuid,text,text,text,jsonb) from public,anon,authenticated;

create function public.sales_post_order(p_kind text,p_order_id uuid,p_request_key text,p_header jsonb,p_items jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_order public.sales_orders%rowtype; v_row public.sales_order_items%rowtype;
  v_input record; v_stock record; v_layer record; v_delivery record;
  v_payload jsonb; v_prior public.sales_posting_requests%rowtype; v_result jsonb;
  v_date date; v_due date; v_warehouse uuid; v_no text; v_id uuid:=gen_random_uuid();
  v_qty numeric; v_left numeric; v_take numeric; v_hpp numeric; v_total_hpp numeric:=0;
  v_available numeric; v_allocated_hpp numeric; v_cost numeric; v_invoice_item_id uuid;
  v_allocations jsonb; v_dpp numeric:=0; v_tax numeric:=0; v_pkp boolean; v_rate numeric; v_type text;
  v_is_inventory boolean; v_lines jsonb:='[]'; v_count integer;
begin
  if p_kind not in ('delivery','invoice') then raise exception 'Jenis posting tidak valid'; end if;
  select * into v_order from public.sales_orders where id=p_order_id for update;
  if not found then raise exception 'Pesanan tidak ditemukan atau tidak dapat diakses.' using errcode='42501'; end if;
  perform public.sales_assert_access(v_order.branch_id);
  if p_request_key is null or length(p_request_key) not between 1 and 120
     or jsonb_typeof(p_header) is distinct from 'object' or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Identitas permintaan atau rincian tidak valid.' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('order_id',p_order_id,'header',p_header,'items',p_items);
  -- Serialize the same actor/key even when reused on a different order.
  perform pg_advisory_xact_lock(hashtext('vetos:sales-request:'||auth.uid()::text||':'||p_kind||':'||p_request_key)::bigint);
  select * into v_prior from public.sales_posting_requests where actor_id=auth.uid() and kind=p_kind and request_key=p_request_key;
  if found then
    perform public.sales_assert_access(v_prior.branch_id);
    if v_prior.payload<>v_payload then raise exception 'Permintaan sudah digunakan dengan rincian berbeda. Muat ulang formulir.' using errcode='22023'; end if;
    return v_prior.result;
  end if;
  if v_order.status='batal' then raise exception 'Pesanan sudah dibatalkan'; end if;
  v_date:=(p_header->>'tanggal')::date;
  v_due:=coalesce((p_header->>'jatuh_tempo')::date,v_date);
  if v_date is null or v_due<v_date then raise exception 'Tanggal atau jatuh tempo tidak valid'; end if;
  perform 1 from public.accounting_locks where id for share;
  if exists(select 1 from public.accounting_locks where id and v_date<=closed_until) then raise exception 'Periode akuntansi sudah ditutup'; end if;
  select count(*) into v_count from jsonb_to_recordset(p_items) as x(order_item_id uuid,qty numeric);
  if v_count=0 or v_count<>(select count(distinct order_item_id) from jsonb_to_recordset(p_items) as x(order_item_id uuid,qty numeric)) then
    raise exception 'Pilih baris dan jangan gandakan baris yang sama' using errcode='22023'; end if;
  -- Lock all order lines so edits cannot alter their unit/price snapshots midway.
  perform 1 from public.sales_order_items where order_id=p_order_id order by id for update;
  for v_input in select * from jsonb_to_recordset(p_items) as x(order_item_id uuid,qty numeric) order by order_item_id loop
    select * into v_row from public.sales_order_items where id=v_input.order_item_id and order_id=p_order_id;
    if not found then raise exception 'Baris bukan bagian dari pesanan' using errcode='22023'; end if;
    if v_input.qty is null or v_input.qty<=0 or v_input.qty>1000000000 or v_row.faktor is null or v_row.faktor<=0 or v_row.faktor>1000000000 then
      raise exception 'Qty atau faktor tidak valid' using errcode='22023'; end if;
    if v_input.qty>(case when p_kind='delivery' then v_row.qty-v_row.qty_kirim else v_row.qty_kirim-v_row.qty_faktur end) then
      raise exception 'Qty % melebihi sisa % pesanan.',v_row.nama,p_kind using errcode='22003'; end if;
  end loop;
  v_warehouse:=coalesce(nullif(p_header->>'warehouse_id','')::uuid,v_order.warehouse_id);
  if p_kind='delivery' then
    -- Aggregate same SKU across box/pcs rows and lock balances in stock RPC order.
    for v_stock in
      select oi.item_id,min(i.name) as item_name,sum(x.qty*oi.faktor) as qty from jsonb_to_recordset(p_items) as x(order_item_id uuid,qty numeric)
      join public.sales_order_items oi on oi.id=x.order_item_id
      join public.items i on i.id=oi.item_id where coalesce(i.item_type,'Persediaan')='Persediaan'
      group by oi.item_id order by oi.item_id
    loop
      if v_warehouse is null or not exists(select 1 from public.warehouses where id=v_warehouse and is_active and (v_order.branch_id is null or branch_id=v_order.branch_id)) then
        raise exception 'Pilih gudang aktif pada cabang pesanan untuk mengirim barang.'; end if;
      perform public.sales_assert_access((select branch_id from public.warehouses where id=v_warehouse));
      perform 1 from public.stock where warehouse_id=v_warehouse and item_id=v_stock.item_id and qty>=v_stock.qty for update;
      if not found then raise exception 'Stok % tidak cukup untuk % satuan dasar.',v_stock.item_name,v_stock.qty using errcode='22003'; end if;
    end loop;
    v_no:=public.sales_next_number('DO',(now() at time zone 'Asia/Jakarta')::date);
    insert into public.sales_deliveries(id,no_kirim,order_id,tanggal,ekspedisi,no_resi,catatan,created_by)
      values(v_id,v_no,p_order_id,v_date,nullif(p_header->>'ekspedisi',''),nullif(p_header->>'no_resi',''),nullif(p_header->>'catatan',''),auth.uid());
  else
    select type::text into v_type from public.branches where id=v_order.branch_id;
    v_no:=public.sales_next_number(case when v_type='KLINIK' then 'FJK' else 'FJ' end,(now() at time zone 'Asia/Jakarta')::date);
    insert into public.sales_invoices(id,no_faktur,order_id,customer_id,branch_id,tanggal,jatuh_tempo,catatan,created_by)
      values(v_id,v_no,p_order_id,v_order.customer_id,v_order.branch_id,v_date,v_due,nullif(p_header->>'catatan',''),auth.uid());
  end if;
  for v_input in select * from jsonb_to_recordset(p_items) as x(order_item_id uuid,qty numeric) order by order_item_id loop
    select * into v_row from public.sales_order_items where id=v_input.order_item_id;
    v_hpp:=0; v_qty:=v_input.qty*v_row.faktor;
    select coalesce(item_type,'Persediaan')='Persediaan' into v_is_inventory from public.items where id=v_row.item_id;
    if p_kind='delivery' then
      if v_row.item_id is not null and coalesce(v_is_inventory,false) then
        v_left:=v_qty;
        for v_layer in select * from public.stock_layers where warehouse_id=v_warehouse and item_id=v_row.item_id and qty_left>0
          order by exp_date nulls last,tanggal,created_at,id for update loop
          exit when v_left<=0;
          if v_layer.unit_cost is null or v_layer.unit_cost<=0 then raise exception 'Lapisan stok % tidak memiliki HPP positif.',v_row.nama; end if;
          v_take:=least(v_left,v_layer.qty_left); v_left:=v_left-v_take; v_hpp:=v_hpp+v_take*v_layer.unit_cost;
          update public.stock_layers set qty_left=qty_left-v_take where id=v_layer.id;
        end loop;
        if v_left>0 then raise exception 'Lapisan stok % tidak cukup.',v_row.nama using errcode='22003'; end if;
        update public.stock set qty=qty-v_qty,updated_at=now() where warehouse_id=v_warehouse and item_id=v_row.item_id;
        insert into public.stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref)
          values(v_date,v_warehouse,v_row.item_id,-v_qty,v_hpp/v_qty,'sales-delivery',v_no);
        v_total_hpp:=v_total_hpp+v_hpp;
      end if;
      insert into public.sales_delivery_items(delivery_id,order_item_id,item_id,nama,satuan,faktor,qty,hpp)
        values(v_id,v_row.id,v_row.item_id,v_row.nama,v_row.satuan,v_row.faktor,v_input.qty,case when v_row.item_id is null then null else round(v_hpp,2) end);
      update public.sales_order_items set qty_kirim=qty_kirim+v_input.qty where id=v_row.id;
    else
      -- Cumulative qty alone cannot identify the historical cost consumed by
      -- legacy invoices. Fail closed until finance reconciles those documents.
      if v_row.qty_faktur<>(select coalesce(sum(ii.qty),0) from public.sales_invoice_items ii
          join public.sales_invoices inv on inv.id=ii.invoice_id where ii.order_item_id=v_row.id and inv.order_id=p_order_id)
        or exists(select 1 from public.sales_invoice_items ii join public.sales_invoices inv on inv.id=ii.invoice_id
          where ii.order_item_id=v_row.id and inv.order_id=p_order_id and (
            ii.qty<>(select coalesce(sum(a.qty),0) from public.sales_invoice_delivery_allocations a where a.invoice_item_id=ii.id)
            or ii.hpp<>(select coalesce(sum(a.hpp),0) from public.sales_invoice_delivery_allocations a where a.invoice_item_id=ii.id))) then
        raise exception 'Alokasi HPP faktur lama % belum dapat diverifikasi. Minta keuangan merekonsiliasi faktur dan pengiriman sebelum menagih sisa.' ,v_row.nama using errcode='22023';
      end if;
      v_left:=v_input.qty; v_allocations:='[]'; v_invoice_item_id:=gen_random_uuid();
      for v_delivery in select di.id,di.qty,di.hpp,
          coalesce((select sum(a.qty) from public.sales_invoice_delivery_allocations a where a.delivery_item_id=di.id),0) as allocated_qty,
          coalesce((select sum(a.hpp) from public.sales_invoice_delivery_allocations a where a.delivery_item_id=di.id),0) as allocated_hpp
        from public.sales_delivery_items di join public.sales_deliveries d on d.id=di.delivery_id
        where di.order_item_id=v_row.id and d.order_id=p_order_id order by d.tanggal,d.created_at,d.id,di.id loop
        exit when v_left<=0;
        v_available:=v_delivery.qty-v_delivery.allocated_qty;
        v_allocated_hpp:=coalesce(v_delivery.hpp,0)-v_delivery.allocated_hpp;
        if v_available<0 or v_allocated_hpp<0 then raise exception 'Alokasi HPP pengiriman % tidak konsisten. Minta keuangan meninjau.',v_row.nama; end if;
        if v_available=0 then continue; end if;
        v_take:=least(v_left,v_available);
        if v_row.item_id is not null and coalesce(v_is_inventory,false) and v_delivery.hpp is null then raise exception 'HPP pengiriman % belum tersedia. Minta keuangan meninjau.',v_row.nama; end if;
        -- Final allocation carries residual cents so line and shipment HPP reconcile exactly.
        v_cost:=case when v_take=v_available then v_allocated_hpp else least(v_allocated_hpp,round(v_take*coalesce(v_delivery.hpp,0)/v_delivery.qty,2)) end;
        v_hpp:=v_hpp+v_cost; v_left:=v_left-v_take;
        v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object('delivery_item_id',v_delivery.id,'qty',v_take,'hpp',v_cost));
      end loop;
      if v_left>0 then raise exception 'Rincian pengiriman % tidak cukup untuk alokasi HPP.',v_row.nama; end if;
      insert into public.sales_invoice_items(id,invoice_id,order_item_id,item_id,nama,satuan,faktor,qty,harga,hpp)
        values(v_invoice_item_id,v_id,v_row.id,v_row.item_id,v_row.nama,v_row.satuan,v_row.faktor,v_input.qty,v_row.harga,round(v_hpp,2));
      insert into public.sales_invoice_delivery_allocations(invoice_item_id,delivery_item_id,qty,hpp)
        select v_invoice_item_id,a.delivery_item_id,a.qty,a.hpp from jsonb_to_recordset(v_allocations) as a(delivery_item_id uuid,qty numeric,hpp numeric);
      update public.sales_order_items set qty_faktur=qty_faktur+v_input.qty where id=v_row.id;
      v_dpp:=v_dpp+v_input.qty*v_row.harga;
    end if;
  end loop;
  if p_kind='delivery' then
    if round(v_total_hpp)>0 then v_lines:=jsonb_build_array(jsonb_build_object('code','5101','debit',round(v_total_hpp),'credit',0),jsonb_build_object('code','1301','debit',0,'credit',round(v_total_hpp))); end if;
    perform public.sales_write_journal(v_date,v_order.branch_id,'sales-delivery',v_no,'Pengiriman pesanan '||v_no||' ('||v_order.no_pesanan||')',v_lines);
    update public.sales_orders set status='diproses' where id=p_order_id and status='draft';
  else
    select mode_pkp,ppn_rate into v_pkp,v_rate from public.company_settings where id for share;
    if coalesce(v_pkp,false) and v_dpp>0 then v_tax:=round(v_dpp*coalesce(nullif(v_rate,0),11)/100); end if;
    update public.sales_invoices set dpp=v_dpp,ppn=v_tax,total=v_dpp+v_tax where id=v_id;
    if round(v_dpp)+v_tax>0 then
      v_lines:=jsonb_build_array(jsonb_build_object('code','1201','debit',round(v_dpp)+v_tax,'credit',0),jsonb_build_object('code','4101','debit',0,'credit',round(v_dpp)));
      if v_tax>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','2201','debit',0,'credit',v_tax)); end if;
    end if;
    perform public.sales_write_journal(v_date,v_order.branch_id,'sales-invoice',v_no,'Faktur penjualan '||v_no||' ('||v_order.no_pesanan||')',v_lines);
    update public.sales_orders set status=case when not exists(select 1 from public.sales_order_items where order_id=p_order_id and (qty_kirim<qty or qty_faktur<qty_kirim)) then 'selesai' else 'diproses' end where id=p_order_id;
  end if;
  v_result:=jsonb_build_object('document_id',v_id,'document_no',v_no);
  insert into public.sales_posting_requests(actor_id,kind,request_key,order_id,branch_id,payload,result) values(auth.uid(),p_kind,p_request_key,p_order_id,v_order.branch_id,v_payload,v_result);
  return v_result;
end $$;
revoke all on function public.sales_post_order(text,uuid,text,jsonb,jsonb) from public,anon,authenticated;
create function public.sales_create_delivery(p_order_id uuid,p_request_key text,p_header jsonb,p_items jsonb) returns jsonb
language sql security definer set search_path='' as $$select public.sales_post_order('delivery',p_order_id,p_request_key,p_header,p_items)$$;
create function public.sales_create_invoice(p_order_id uuid,p_request_key text,p_header jsonb,p_items jsonb) returns jsonb
language sql security definer set search_path='' as $$select public.sales_post_order('invoice',p_order_id,p_request_key,p_header,p_items)$$;
revoke all on function public.sales_create_delivery(uuid,text,jsonb,jsonb),public.sales_create_invoice(uuid,text,jsonb,jsonb) from public,anon;
grant execute on function public.sales_create_delivery(uuid,text,jsonb,jsonb),public.sales_create_invoice(uuid,text,jsonb,jsonb) to authenticated;

create function public.sales_convert_quotation(p_quotation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_q public.sales_quotations%rowtype; v_existing public.sales_orders%rowtype; v_id uuid:=gen_random_uuid(); v_no text; begin
  select * into v_q from public.sales_quotations where id=p_quotation_id for update;
  if not found then raise exception 'Penawaran tidak ditemukan' using errcode='42501'; end if;
  perform public.sales_assert_access(v_q.branch_id);
  select * into v_existing from public.sales_orders where quotation_id=p_quotation_id order by created_at limit 1;
  if found then return jsonb_build_object('order_id',v_existing.id,'order_no',v_existing.no_pesanan); end if;
  perform 1 from public.sales_quotation_items where quotation_id=p_quotation_id order by id for update;
  if not exists(select 1 from public.sales_quotation_items where quotation_id=p_quotation_id) then raise exception 'Penawaran tidak punya baris'; end if;
  if exists(select 1 from public.sales_quotation_items qi left join public.items i on i.id=qi.item_id where qi.quotation_id=p_quotation_id and qi.item_id is not null
    and (i.id is null or not i.is_active or not ((qi.satuan=i.unit and qi.faktor=1) or exists(select 1 from public.item_units u where u.item_id=i.id and u.unit=qi.satuan and u.factor=qi.faktor)))) then
    raise exception 'Satuan atau faktor barang berubah. Pilih barang dan satuannya lagi.';
  end if;
  v_no:=public.sales_next_number('SO',(now() at time zone 'Asia/Jakarta')::date);
  insert into public.sales_orders(id,no_pesanan,quotation_id,customer_id,branch_id,total,catatan,created_by)
    values(v_id,v_no,p_quotation_id,v_q.customer_id,v_q.branch_id,v_q.total,v_q.catatan,auth.uid());
  insert into public.sales_order_items(order_id,item_id,nama,satuan,faktor,qty,harga)
    select v_id,item_id,nama,satuan,faktor,qty,harga from public.sales_quotation_items where quotation_id=p_quotation_id;
  update public.sales_quotations set status='diterima' where id=p_quotation_id;
  return jsonb_build_object('order_id',v_id,'order_no',v_no);
end $$;
revoke all on function public.sales_convert_quotation(uuid) from public,anon;
grant execute on function public.sales_convert_quotation(uuid) to authenticated;

-- Cancellation shares the posting lock and checks current shipped quantities.
create function public.sales_cancel_order(p_order_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_o public.sales_orders%rowtype; begin
  select * into v_o from public.sales_orders where id=p_order_id for update;
  if not found then raise exception 'Pesanan tidak ditemukan' using errcode='42501'; end if;
  perform public.sales_assert_access(v_o.branch_id);
  if exists(select 1 from public.sales_order_items where order_id=p_order_id and qty_kirim>0) then
    raise exception 'Sebagian barang sudah dikirim — pesanan ini tidak bisa dibatalkan'; end if;
  update public.sales_orders set status='batal' where id=p_order_id;
end $$;
revoke all on function public.sales_cancel_order(uuid) from public,anon;
grant execute on function public.sales_cancel_order(uuid) to authenticated;


-- Read-only recovery waits behind the posting order lock before inspecting the
-- actor's key. Lock order matches posting: source order, then request identity.
create function public.sales_get_posting_result(p_order_id uuid,p_kind text,p_request_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_order public.sales_orders%rowtype; v_request public.sales_posting_requests%rowtype; begin
  if p_kind not in ('delivery','invoice') or p_request_key is null or length(p_request_key) not between 1 and 120 then
    raise exception 'Identitas transaksi tidak valid.' using errcode='22023'; end if;
  select * into v_order from public.sales_orders where id=p_order_id for share;
  if not found then raise exception 'Pesanan tidak ditemukan atau tidak dapat diakses.' using errcode='42501'; end if;
  perform public.sales_assert_access(v_order.branch_id);
  perform pg_advisory_xact_lock(hashtext('vetos:sales-request:'||auth.uid()::text||':'||p_kind||':'||p_request_key)::bigint);
  select * into v_request from public.sales_posting_requests where actor_id=auth.uid() and kind=p_kind and request_key=p_request_key;
  if not found then return null; end if;
  if v_request.order_id<>p_order_id then raise exception 'Identitas bukan milik pesanan ini.' using errcode='42501'; end if;
  perform public.sales_assert_access(v_request.branch_id);
  if (p_kind='delivery' and not exists(select 1 from public.sales_deliveries where id=(v_request.result->>'document_id')::uuid and order_id=p_order_id))
    or (p_kind='invoice' and not exists(select 1 from public.sales_invoices where id=(v_request.result->>'document_id')::uuid and order_id=p_order_id)) then
    raise exception 'Dokumen hasil permintaan tidak ditemukan. Minta keuangan meninjau.'; end if;
  return v_request.result;
end $$;
revoke all on function public.sales_get_posting_result(uuid,text,text) from public,anon;
grant execute on function public.sales_get_posting_result(uuid,text,text) to authenticated;
