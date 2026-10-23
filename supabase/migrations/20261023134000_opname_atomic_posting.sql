-- New SO postings only. Legacy partial documents are never replayed/backfilled.
create table public.opname_posting_receipts (
 order_id uuid primary key references public.opname_orders(id),
 result_id uuid not null unique references public.opname_results(id),
 actor_id uuid not null references public.profiles(id),
 payload jsonb not null, receipt jsonb not null, source_snapshot jsonb not null,
 journal_ids uuid[] not null, created_at timestamptz not null default now()
);
alter table public.opname_posting_receipts enable row level security;
revoke all on public.opname_posting_receipts from public,anon,authenticated,service_role;

create function public.opname_posting_access(p_wh uuid) returns void
language plpgsql security definer set search_path='' as $$
declare branch uuid;
begin
 if auth.uid() is null or coalesce(auth.role(),'')<>'authenticated' then raise exception 'Akses posting opname ditolak' using errcode='42501';end if;
 perform 1 from public.profiles where id=auth.uid() and is_active for share;
 if not found then raise exception 'Akses posting opname ditolak' using errcode='42501';end if;
 select branch_id into branch from public.warehouses where id=p_wh and is_active for share;
 if not found or not public.user_can_access_branch(branch) then raise exception 'Gudang opname tidak dapat diakses' using errcode='42501';end if;
 perform 1 from public.branches where id=branch and is_active for share;
 if not found then raise exception 'Cabang opname tidak aktif' using errcode='42501';end if;
 begin
  perform public.stock_document_access(branch,'pos');
 exception when raise_exception then
  perform 1 from public.cashier_shifts where opened_by=auth.uid() and branch_id=branch and status='open' and shift_type='petshop' for share;
  if not found then raise exception 'Akses posting opname ditolak' using errcode='42501';end if;
 end;
end$$;
revoke all on function public.opname_posting_access(uuid) from public,anon,authenticated,service_role;

-- Existing configurable OPR/FJS series, generated inside the posting transaction.
create function public.opname_posting_number(p_kind text,p_date date) returns text
language plpgsql security definer set search_path='' as $$
declare prefix text;digits integer;seq bigint;tab text;col text;max_len integer;
begin
 if p_kind not in('OPR','FJS') then raise exception 'Seri opname tidak valid';end if;
 select pola,digit into prefix,digits from public.document_numbering where jenis=p_kind;
 prefix:=coalesce(prefix,case p_kind when 'OPR' then 'OPR.' else 'FJS.{YYYY}.{MM}.' end);digits:=coalesce(digits,5);
 prefix:=replace(replace(replace(replace(prefix,'{YYYY}',to_char(p_date,'YYYY')),'{YY}',to_char(p_date,'YY')),'{MM}',to_char(p_date,'MM')),'{DD}',to_char(p_date,'DD'));
 max_len:=case p_kind when 'OPR' then 20 else 30 end;
 if digits not between 1 and 8 or length(prefix)+digits>max_len then raise exception 'Format nomor opname tidak valid';end if;
 perform pg_advisory_xact_lock(hashtext('vetos:opname-number:'||p_kind||prefix)::bigint);
 tab:=case p_kind when 'OPR' then 'opname_results' else 'sales_invoices' end;
 col:=case p_kind when 'OPR' then 'no_hasil' else 'no_faktur' end;
 execute format('select coalesce(max(substring(%I from $1 for $2)::bigint),0)+1 from public.%I where left(%I,$3)=$4 and substring(%I from $1 for $2) ~ ''^[0-9]+$''',col,tab,col,col)
 into seq using length(prefix)+1,digits,length(prefix),prefix;
 if length(seq::text)>digits then raise exception 'Urutan nomor opname penuh';end if;
 return prefix||lpad(seq::text,digits,'0');
end$$;
revoke all on function public.opname_posting_number(text,date) from public,anon,authenticated,service_role;

create function public.opname_posting_journal(p_date date,p_branch uuid,p_source text,p_ref text,p_description text,p_lines jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare journal uuid;
begin
 perform public.sales_write_journal(p_date,p_branch,p_source,p_ref,p_description,p_lines);
 select id into strict journal from public.journal_entries where source=p_source and source_ref=p_ref and deskripsi=p_description;
 perform public.wholesale_assert_journal(journal,p_source,p_ref,p_date,p_branch,p_lines);
 return journal;
end$$;
revoke all on function public.opname_posting_journal(date,uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;

create function public.post_opname_atomic(p_order_id uuid,p_tanggal date,p_counts jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare doc public.opname_orders%rowtype;prior public.opname_posting_receipts%rowtype;wh public.warehouses%rowtype;
 payload jsonb;rows jsonb;ids uuid[];r record;issued jsonb;before_qty numeric;after_qty numeric;
 result_id uuid:=gen_random_uuid();ref text;v_invoice_id uuid;invoice_no text;branch_type text;retail boolean;
 gain numeric:=0;loss numeric:=0;sale_value numeric:=0;cost numeric;je uuid[]:='{}';receipt jsonb;
begin
 if p_order_id is null or p_tanggal is null or not isfinite(p_tanggal) or jsonb_typeof(p_counts) is distinct from 'object' then raise exception 'Perintah, tanggal, atau hitungan opname tidak valid';end if;
 if exists(select 1 from jsonb_each(p_counts) e where e.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(e.value)<>'number') then raise exception 'Identitas atau jumlah fisik tidak valid';end if;
 if exists(select 1 from jsonb_each_text(p_counts) e where e.value::numeric<0 or e.value::numeric>1e9) then raise exception 'Jumlah fisik tidak valid';end if;
 -- Shared inventory activation/closing lock precedes source/stock locks.
 perform public.inventory_is_average();
 select * into doc from public.opname_orders where id=p_order_id for update;
 if not found then raise exception 'Perintah opname tidak ditemukan atau tidak dapat diakses' using errcode='42501';end if;
 perform public.opname_posting_access(doc.warehouse_id);
 payload:=jsonb_build_object('tanggal',p_tanggal,'counts',p_counts);
 select * into prior from public.opname_posting_receipts where order_id=doc.id;
 if found then
  if prior.payload is distinct from payload then raise exception 'Opname sudah diposting dengan hitungan atau tanggal berbeda. Periksa hasil asal; tidak ada posting ulang.';end if;
  return prior.receipt||jsonb_build_object('already_posted',true);
 end if;
 if doc.status::text<>'Terbuka' then raise exception 'Opname tidak terbuka. Periksa hasil atau pembatalan asal.';end if;
 if exists(select 1 from public.opname_results where order_id=doc.id) then raise exception 'Sudah ada hasil atau posting parsial lama. Rekonsiliasi hasil asal sebelum melanjutkan; jangan posting ulang.';end if;
 perform 1 from public.accounting_locks where id for share;
 if not found then raise exception 'Status tutup buku tidak tersedia';end if;
 perform public.purchase_payment_period(p_tanggal,p_tanggal);
 select * into wh from public.warehouses where id=doc.warehouse_id;
 select type into branch_type from public.branches where id=wh.branch_id;
 retail:=case when upper(coalesce(wh.type::text,''))='VET' then false when upper(coalesce(wh.type::text,''))='RETAIL' then true else upper(coalesce(branch_type,''))<>'KLINIK' end;
 select array_agg(distinct item_id order by item_id) into ids from (
  select key::uuid item_id from jsonb_each(p_counts) union select item_id from public.opname_counts where order_id=doc.id
 ) selected;
 if coalesce(cardinality(ids),0)=0 then raise exception 'Belum ada barang yang dihitung';end if;
 if exists(select 1 from public.opname_order_items where order_id=doc.id) and exists(select 1 from unnest(ids) as selected(item_id) where not exists(select 1 from public.opname_order_items i where i.order_id=doc.id and i.item_id=selected.item_id)) then raise exception 'Hitungan di luar lingkup opname. Periksa perintah asal.';end if;
 perform 1 from public.items where id=any(ids) order by id for share;
 if exists(select 1 from unnest(ids) as selected(item_id) left join public.items i on i.id=selected.item_id where i.id is null or not i.is_active or coalesce(i.item_type,'Persediaan')<>'Persediaan' or i.buy_price<0 or i.sell_price<0 or i.buy_price::text in('NaN','Infinity','-Infinity') or i.sell_price::text in('NaN','Infinity','-Infinity')) then raise exception 'Barang hitungan bukan persediaan aktif atau harganya tidak valid';end if;
 insert into public.stock(warehouse_id,item_id,qty) select wh.id,selected.item_id,0 from unnest(ids) as selected(item_id) order by selected.item_id on conflict(warehouse_id,item_id) do nothing;
 perform 1 from public.stock where warehouse_id=wh.id and item_id=any(ids) order by item_id for update;
 -- Child writers already take the parent lock. Read snapshots without child row
 -- locks to avoid inverting concurrent Buka's row -> parent trigger lock order.
 select jsonb_agg(jsonb_build_object('item_id',i.id,'qty_sistem',coalesce(c.qty_sistem,s.qty),'qty_fisik',coalesce(c.qty_fisik,(p_counts->>i.id::text)::numeric),'selisih',coalesce(c.qty_fisik,(p_counts->>i.id::text)::numeric)-coalesce(c.qty_sistem,s.qty),'buy_price',i.buy_price,'sell_price',i.sell_price,'name',i.name,'unit',i.unit) order by i.id)
 into rows from public.items i join public.stock s on s.item_id=i.id and s.warehouse_id=wh.id left join public.opname_counts c on c.item_id=i.id and c.order_id=doc.id where i.id=any(ids);
 if exists(select 1 from jsonb_to_recordset(rows) as x(qty_sistem numeric,qty_fisik numeric,selisih numeric) where qty_fisik is null or qty_fisik<0 or abs(selisih)>1e9 or qty_sistem::text in('NaN','Infinity','-Infinity') or qty_fisik::text in('NaN','Infinity','-Infinity')) then raise exception 'Snapshot hitungan tidak valid';end if;
 if exists(select 1 from public.stock s where s.warehouse_id=wh.id and s.item_id=any(ids) and (s.qty::text in('NaN','Infinity','-Infinity') or greatest(s.qty,0) is distinct from (select coalesce(sum(l.qty_left),0) from public.stock_layers l where l.warehouse_id=wh.id and l.item_id=s.item_id))) or exists(select 1 from public.stock_layers l where l.warehouse_id=wh.id and l.item_id=any(ids) and (l.unit_cost<0 or l.unit_cost::text in('NaN','Infinity','-Infinity'))) then raise exception 'Saldo/lapisan stok tidak konsisten. Rekonsiliasi sumber diperlukan.';end if;
 -- Preserve the existing retail whole-rupiah rule without inventing residual
 -- allocation that would disagree with invoice lines.
 if retail then
  select coalesce(sum(-selisih*sell_price),0) into sale_value from jsonb_to_recordset(rows) as x(selisih numeric,sell_price numeric) where selisih<0;
  if sale_value is distinct from round(sale_value) then raise exception 'Nilai tagihan selisih mengandung pecahan. Kebijakan pembulatan perlu ditinjau; seluruh posting dibatalkan.';end if;
 end if;
 ref:=public.opname_posting_number('OPR',p_tanggal);
 insert into public.opname_results(id,no_hasil,order_id,tanggal,created_by) values(result_id,ref,doc.id,p_tanggal,auth.uid());
 insert into public.opname_result_items(result_id,item_id,qty_sistem,qty_fisik,selisih) select result_id,item_id,qty_sistem,qty_fisik,selisih from jsonb_to_recordset(rows) as x(item_id uuid,qty_sistem numeric,qty_fisik numeric,selisih numeric);
 insert into public.opname_counts(order_id,item_id,qty_sistem,qty_fisik,locked_by) select doc.id,item_id,qty_sistem,qty_fisik,auth.uid() from jsonb_to_recordset(rows) as x(item_id uuid,qty_sistem numeric,qty_fisik numeric) on conflict(order_id,item_id) do nothing;
 for r in select * from jsonb_to_recordset(rows) as x(item_id uuid,qty_sistem numeric,qty_fisik numeric,selisih numeric,buy_price numeric,sell_price numeric,name text,unit text) order by item_id loop
  select qty into before_qty from public.stock where warehouse_id=wh.id and item_id=r.item_id;
  if r.selisih>0 then
   perform public.stock_in_fifo(wh.id,r.item_id,r.selisih,r.buy_price,'opname',ref,p_tanggal,null);
   gain:=gain+r.selisih*r.buy_price;
  elsif r.selisih<0 then
   issued:=public.issue_stock_document_recorded('opname',result_id,r.item_id);
   cost:=(issued->>'cost')::numeric;
   if cost is null or cost<0 or cost::text in('NaN','Infinity','-Infinity') then raise exception 'Biaya pengeluaran opname tidak valid';end if;
   loss:=loss+cost;
  end if;
  select qty into after_qty from public.stock where warehouse_id=wh.id and item_id=r.item_id;
  if after_qty is distinct from before_qty+r.selisih then raise exception 'Rekonsiliasi kuantitas opname gagal';end if;
 end loop;
 if gain>0 then je:=array_append(je,public.opname_posting_journal(p_tanggal,wh.branch_id,'opname',ref,'Selisih lebih stok opname '||ref||' ('||doc.no_opname||')',jsonb_build_array(jsonb_build_object('code','1301','debit',gain,'credit',0),jsonb_build_object('code','5902','debit',0,'credit',gain))));end if;
 if loss>0 then je:=array_append(je,public.opname_posting_journal(p_tanggal,wh.branch_id,'opname',ref,(case when retail then 'HPP selisih stok opname ' else 'Selisih kurang stok opname ' end)||ref||' ('||doc.no_opname||')',jsonb_build_array(jsonb_build_object('code',case when retail then '5101' else '5902' end,'debit',loss,'credit',0),jsonb_build_object('code','1301','debit',0,'credit',loss))));end if;
 if retail and sale_value>0 then
  v_invoice_id:=gen_random_uuid();invoice_no:=public.opname_posting_number('FJS',p_tanggal);
  insert into public.sales_invoices(id,no_faktur,branch_id,tanggal,kategori,dpp,ppn,total,catatan,created_by) values(v_invoice_id,invoice_no,wh.branch_id,p_tanggal,'selisih_stok',sale_value,0,sale_value,'Selisih kurang stok opname '||ref||' ('||doc.no_opname||') — ditanggung kepala toko.',auth.uid());
  insert into public.sales_invoice_items(invoice_id,item_id,nama,satuan,qty,harga) select v_invoice_id,item_id,name,unit,-selisih,sell_price from jsonb_to_recordset(rows) as x(item_id uuid,name text,unit text,selisih numeric,sell_price numeric) where selisih<0;
  update public.opname_results set invoice_id=v_invoice_id where id=result_id;
  je:=array_append(je,public.opname_posting_journal(p_tanggal,wh.branch_id,'opname-selisih',invoice_no,'Faktur selisih stok '||invoice_no||' ('||ref||')',jsonb_build_array(jsonb_build_object('code','1201','debit',sale_value,'credit',0),jsonb_build_object('code','4101','debit',0,'credit',sale_value))));
 end if;
 if (select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=any(je) and a.code='1301') is distinct from gain-loss then raise exception 'Rekonsiliasi nilai jurnal persediaan gagal';end if;
 receipt:=jsonb_build_object('result_id',result_id,'no_hasil',ref,'tanggal',p_tanggal,'no_faktur',invoice_no,'journal_ids',to_jsonb(je),'counted_items',cardinality(ids),'already_posted',false);
 insert into public.opname_posting_receipts(order_id,result_id,actor_id,payload,receipt,source_snapshot,journal_ids) values(doc.id,result_id,auth.uid(),payload,receipt,jsonb_build_object('order',to_jsonb(doc),'rows',rows,'warehouse_policy',case when retail then 'legacy-retail-charge' else 'clinic-cost-variance' end,'gain_cost',gain,'loss_cost',loss,'invoice_value',sale_value),je);
 update public.opname_orders set status='Selesai' where id=doc.id;
 return receipt;
end$$;
revoke all on function public.post_opname_atomic(uuid,date,jsonb) from public,anon,service_role;
grant execute on function public.post_opname_atomic(uuid,date,jsonb) to authenticated;

-- Serializes stale count/unlock/scope writes with the final parent transition.
create function public.guard_completed_opname_counts() returns trigger
language plpgsql security definer set search_path='' as $$
declare parent record;refs uuid[];
begin
 if tg_op='INSERT' then refs:=array[new.order_id];elsif tg_op='DELETE' then refs:=array[old.order_id];else refs:=array[old.order_id,new.order_id];end if;
 for parent in select id,status from public.opname_orders where id=any(refs) order by id for update loop
  if parent.status::text<>'Terbuka' or exists(select 1 from public.opname_posting_receipts where order_id=parent.id) then raise exception 'Opname tidak terbuka. Hitungan dan lingkup tidak boleh diubah lagi.';end if;
 end loop;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_completed_opname_counts() from public,anon,authenticated,service_role;
create trigger opname_completed_count_fence before insert or update or delete on public.opname_counts for each row execute function public.guard_completed_opname_counts();
create trigger opname_completed_scope_fence before insert or update or delete on public.opname_order_items for each row execute function public.guard_completed_opname_counts();

-- Prevent stale legacy clients from creating a second result after the atomic
-- receipt committed. Historical sources without a new receipt remain untouched.
create function public.guard_posted_opname_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_row jsonb:='{}';new_row jsonb:='{}';refs uuid[];parent record;
begin
 if tg_op<>'INSERT' then old_row:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then new_row:=to_jsonb(new);end if;
 if tg_table_name='opname_results' then refs:=array[nullif(old_row->>'order_id','')::uuid,nullif(new_row->>'order_id','')::uuid];
 else select array_agg(order_id) into refs from public.opname_results where id in(nullif(old_row->>'result_id','')::uuid,nullif(new_row->>'result_id','')::uuid);end if;
 for parent in select id from public.opname_orders where id=any(refs) order by id for update loop
  if exists(select 1 from public.opname_posting_receipts where order_id=parent.id) then raise exception 'Hasil opname sudah diposting atomik. Gunakan pemeriksaan/koreksi sumber; jangan membuat atau mengubah hasil asal.';end if;
 end loop;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_posted_opname_source() from public,anon,authenticated,service_role;
create trigger opname_posted_result_fence before insert or update or delete on public.opname_results for each row execute function public.guard_posted_opname_source();
create trigger opname_posted_line_fence before insert or update or delete on public.opname_result_items for each row execute function public.guard_posted_opname_source();

-- The receipt is authoritative even if a stale/direct client attempts to reopen
-- an order through the existing table UPDATE grant.
create function public.guard_opname_posted_status() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status::text is distinct from 'Selesai' and exists(select 1 from public.opname_posting_receipts where order_id=old.id) then
  raise exception 'Opname sudah diposting. Status tidak boleh dibuka kembali; periksa hasil atau koreksi sumber.';
 end if;
 return new;
end$$;
revoke all on function public.guard_opname_posted_status() from public,anon,authenticated,service_role;
create trigger opname_posted_status_fence before update of status on public.opname_orders for each row execute function public.guard_opname_posted_status();
