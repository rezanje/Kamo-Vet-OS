-- I02 apply: sama persis dengan supabase/migrations/20261028150000_i02_opname_uniform_variance.sql.
-- Jalankan HANYA setelah preflight.sql lolos. Satu transaksi; aman diulang (create or replace).
begin;
-- I02 Jurnal stok opname: satu kebijakan akun untuk semua cabang (posting baru saja).
-- Selisih kurang dan lebih di toko maupun klinik memakai akun beban yang sama
-- (5902 Selisih Persediaan). Jurnal, faktur selisih, dan piutang lama TIDAK diubah.
-- Pemetaan akun ada di satu tempat: public.stock_opname_account().
do $$ begin
 if to_regprocedure('public.post_opname_atomic(uuid,date,jsonb)') is null
  or to_regclass('public.opname_posting_receipts') is null
  or to_regprocedure('public.opname_posting_journal(date,uuid,text,text,text,jsonb)') is null
  or to_regprocedure('public.issue_stock_document_recorded(text,uuid,uuid)') is null
 then raise exception 'I02_SOURCE_CHANGED: review atomic opname posting contract';end if;
end $$;

-- Satu-satunya pemetaan akun opname. Ubah di sini bila kebijakan akun berganti.
create or replace function public.stock_opname_account(p_role text) returns text
language sql immutable set search_path='' as $$
 select case p_role when 'inventory' then '1301' when 'variance' then '5902' end
$$;
revoke all on function public.stock_opname_account(text) from public,anon,authenticated,service_role;

create or replace function public.post_opname_atomic(p_order_id uuid,p_tanggal date,p_counts jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='8s' as $$
declare doc public.opname_orders%rowtype;prior public.opname_posting_receipts%rowtype;wh public.warehouses%rowtype;
 payload jsonb;rows jsonb;ids uuid[];r record;issued jsonb;before_qty numeric;after_qty numeric;
 result_id uuid:=gen_random_uuid();ref text;invoice_no text;
 gain numeric:=0;loss numeric:=0;cost numeric;je uuid[]:='{}';receipt jsonb;
 acc_inventory text:=public.stock_opname_account('inventory');acc_variance text:=public.stock_opname_account('variance');
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
 -- I02 (28 Okt 2026): satu kebijakan untuk semua cabang (toko & klinik).
 -- Lebih = kredit beban selisih persediaan; kurang = debit akun yang sama.
 -- Tidak ada lagi faktur/piutang ke toko pusat untuk posting baru.
 if gain>0 then je:=array_append(je,public.opname_posting_journal(p_tanggal,wh.branch_id,'opname',ref,'Selisih lebih stok opname '||ref||' ('||doc.no_opname||')',jsonb_build_array(jsonb_build_object('code',acc_inventory,'debit',gain,'credit',0),jsonb_build_object('code',acc_variance,'debit',0,'credit',gain))));end if;
 if loss>0 then je:=array_append(je,public.opname_posting_journal(p_tanggal,wh.branch_id,'opname',ref,'Selisih kurang stok opname '||ref||' ('||doc.no_opname||')',jsonb_build_array(jsonb_build_object('code',acc_variance,'debit',loss,'credit',0),jsonb_build_object('code',acc_inventory,'debit',0,'credit',loss))));end if;
 if (select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=any(je) and a.code=acc_inventory) is distinct from gain-loss then raise exception 'Rekonsiliasi nilai jurnal persediaan gagal';end if;
 receipt:=jsonb_build_object('result_id',result_id,'no_hasil',ref,'tanggal',p_tanggal,'no_faktur',invoice_no,'journal_ids',to_jsonb(je),'counted_items',cardinality(ids),'already_posted',false);
 insert into public.opname_posting_receipts(order_id,result_id,actor_id,payload,receipt,source_snapshot,journal_ids) values(doc.id,result_id,auth.uid(),payload,receipt,jsonb_build_object('order',to_jsonb(doc),'rows',rows,'warehouse_policy','uniform-variance-expense','variance_account',acc_variance,'gain_cost',gain,'loss_cost',loss,'invoice_value',0),je);
 update public.opname_orders set status='Selesai' where id=doc.id;
 return receipt;
end$$;
revoke all on function public.post_opname_atomic(uuid,date,jsonb) from public,anon,service_role;
grant execute on function public.post_opname_atomic(uuid,date,jsonb) to authenticated;

commit;
