-- Scope: inventory adjustments and opname results only. No historical backfill.
-- Originals stay intact; an effective replacement lives in this immutable audit.
create table public.stock_document_corrections (
 id uuid primary key,
 kind text not null check(kind in ('adjustment','opname')),
 document_id uuid not null,
 branch_id uuid not null references public.branches(id),
 warehouse_id uuid not null references public.warehouses(id),
 revision integer not null check(revision>0),
 reason text not null,
 source_snapshot jsonb not null,
 before_state jsonb not null,
 after_state jsonb not null,
 reversal_journal_ids uuid[] not null,
 replacement_journal_id uuid references public.journal_entries(id),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 unique(kind,document_id,revision)
);
create table public.stock_document_correction_requests (
 actor_id uuid not null references public.profiles(id), request_key text not null,
 kind text not null,document_id uuid not null,payload jsonb not null,result jsonb not null,
 primary key(actor_id,request_key)
);
alter table public.stock_document_corrections enable row level security;
alter table public.stock_document_correction_requests enable row level security;
revoke all on public.stock_document_corrections,public.stock_document_correction_requests from public,anon,authenticated,service_role;
create table public.stock_document_issue_proofs (
 move_id uuid primary key references public.stock_moves(id),
 kind text not null,document_id uuid not null,item_id uuid not null,
 source_document jsonb not null,source_line jsonb not null,move_snapshot jsonb not null,
 takes jsonb not null,layers_after jsonb not null,result jsonb not null,
 unique(kind,document_id,item_id)
);
alter table public.stock_document_issue_proofs enable row level security;
revoke all on public.stock_document_issue_proofs from public,anon,authenticated,service_role;

create function public.stock_correction_access(p_warehouse uuid) returns void
language plpgsql security definer set search_path='' as $$
declare wh public.warehouses%rowtype;begin
 perform 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active for share;
 if not found then raise exception 'Hanya Super Admin aktif yang dapat mengoreksi stok' using errcode='42501';end if;
 select * into wh from public.warehouses where id=p_warehouse for share;
 if not found or not wh.is_active or not public.user_can_access_branch(wh.branch_id) then
  raise exception 'Gudang koreksi tidak dapat diakses' using errcode='42501';end if;
 perform 1 from public.branches where id=wh.branch_id and is_active for share;
 if not found then raise exception 'Cabang koreksi tidak aktif' using errcode='42501';end if;
end$$;
revoke all on function public.stock_correction_access(uuid) from public,anon,authenticated,service_role;

create function public.stock_correction_source(p_kind text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare doc jsonb;rows jsonb;wh uuid;ref text;source text;last public.stock_document_corrections%rowtype;
 snapshot jsonb;effect jsonb;order_doc jsonb;begin
 if p_kind='adjustment' then
  select to_jsonb(d),d.warehouse_id,d.no_adj into doc,wh,ref from public.inventory_adjustments d where id=p_id for update;
  perform 1 from public.inventory_adjustment_items where adjustment_id=p_id order by item_id for update;
  select jsonb_agg(jsonb_build_object('item_id',i.item_id,'name',i.nama,'qty_sistem',i.qty_sistem,'qty',i.qty_baru,'selisih',i.selisih) order by i.item_id) into rows from public.inventory_adjustment_items i where adjustment_id=p_id;
  source:='penyesuaian';
 elsif p_kind='opname' then
  select to_jsonb(d),d.no_hasil into doc,ref from public.opname_results d where id=p_id for update;
  select to_jsonb(o),o.warehouse_id into order_doc,wh from public.opname_orders o where o.id=(doc->>'order_id')::uuid for update;
  perform 1 from public.opname_result_items where result_id=p_id order by item_id for update;
  select jsonb_agg(jsonb_build_object('item_id',i.item_id,'name',it.name,'qty_sistem',i.qty_sistem,'qty',i.qty_fisik,'selisih',i.selisih) order by i.item_id) into rows from public.opname_result_items i join public.items it on it.id=i.item_id where result_id=p_id;
  source:='opname';
 else raise exception 'Jenis dokumen koreksi tidak didukung';end if;
 if doc is null or wh is null then raise exception 'Dokumen stok tidak ditemukan';end if;
 -- Access is checked AFTER acquiring the document lock, including retry/recovery.
 perform public.stock_correction_access(wh);
 if rows is null or jsonb_array_length(rows)=0 then raise exception 'Rincian dokumen asal belum lengkap. Rekonsiliasi diperlukan';end if;
 if p_kind='opname' and (order_doc->>'status'<>'Selesai' or (select count(*) from public.opname_results where order_id=(doc->>'order_id')::uuid)<>1) then raise exception 'Hasil opname belum selesai atau ganda. Rekonsiliasi hasil asal terlebih dahulu';end if;
 snapshot:=jsonb_build_object('document',doc,'order',order_doc,'rows',rows);
 select * into last from public.stock_document_corrections where kind=p_kind and document_id=p_id order by revision desc limit 1;
 if last.id is not null then
  if snapshot is distinct from last.source_snapshot then raise exception 'Dokumen asal berubah. Rekonsiliasi sumber sebelum koreksi berikutnya';end if;
  rows:=last.after_state->'rows';source:='stock-correction';ref:=last.id::text;
 end if;
 effect:=jsonb_build_object('rows',rows,'source',source,'ref',ref,
  'date',doc->>'tanggal','warehouse_id',wh,'invoice_id',doc->>'invoice_id',
  'revision',coalesce(last.revision,0),'source_snapshot',snapshot,
  'last_layers',last.after_state->'layers',
  'last_moves',last.after_state->'all_moves');
 return effect;
end$$;
revoke all on function public.stock_correction_source(text,uuid) from public,anon,authenticated,service_role;

create function public.get_stock_document_correction(p_kind text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state jsonb;history jsonb;begin
 state:=public.stock_correction_source(p_kind,p_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'revision',c.revision,'reason',c.reason,'created_at',c.created_at,'created_by',c.created_by,
  'before_rows',c.before_state->'rows','after_rows',c.after_state->'rows','reversal_journal_ids',c.reversal_journal_ids,'replacement_journal_id',c.replacement_journal_id) order by c.revision),'[]') into history
  from public.stock_document_corrections c where kind=p_kind and document_id=p_id;
 return (state-'last_layers'-'last_moves')||jsonb_build_object('history',history);
end$$;
revoke all on function public.get_stock_document_correction(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_stock_document_correction(text,uuid) to authenticated;

-- Narrow issuance endpoint for NEW outgoing rows of these same two families.
-- Quantity/warehouse/reference come from the source document, never the caller.
-- Stock mutation and its immutable lot proof either commit together or roll back.
create function public.issue_stock_document_recorded(p_kind text,p_id uuid,p_item_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare doc jsonb;line jsonb;wh public.warehouses%rowtype;actor public.profiles%rowtype;
 wh_id uuid;ref text;source_kind text;qty numeric;issued record;move public.stock_moves%rowtype;
 proof public.stock_document_issue_proofs%rowtype;result jsonb;layers jsonb;begin
 if p_kind='adjustment' then
  select to_jsonb(d),warehouse_id,no_adj into doc,wh_id,ref from public.inventory_adjustments d where id=p_id for update;
  select to_jsonb(i) into line from public.inventory_adjustment_items i where adjustment_id=p_id and item_id=p_item_id for update;
  source_kind:='penyesuaian';
 elsif p_kind='opname' then
  select to_jsonb(d),o.warehouse_id,d.no_hasil into doc,wh_id,ref from public.opname_results d join public.opname_orders o on o.id=d.order_id where d.id=p_id for update of d;
  select to_jsonb(i) into line from public.opname_result_items i where result_id=p_id and item_id=p_item_id for update;
  source_kind:='opname';
 else raise exception 'Jenis pengeluaran stok tidak didukung';end if;
 select * into actor from public.profiles where id=auth.uid() and is_active for share;
 if not found or doc is null or line is null or doc->>'created_by' is distinct from auth.uid()::text then raise exception 'Akses pengeluaran stok asal ditolak' using errcode='42501';end if;
 select * into wh from public.warehouses where id=wh_id and is_active for share;
 if not found or not public.user_can_access_branch(wh.branch_id) then raise exception 'Gudang pengeluaran stok tidak dapat diakses' using errcode='42501';end if;
 perform 1 from public.branches where id=wh.branch_id and is_active for share;
 if not found then raise exception 'Cabang pengeluaran stok tidak aktif' using errcode='42501';end if;
 if p_kind='adjustment' then
  if actor.role not in('OWNER','ADMIN') then raise exception 'Hanya owner/admin dapat membuat penyesuaian' using errcode='42501';end if;
  perform public.stock_document_access(wh.branch_id,'pos');
 elsif not (actor.role='OWNER' or exists(select 1 from public.role_modules where role=actor.role and module_id='pos') or
  (not exists(select 1 from public.role_modules where role=actor.role) and actor.role in('ADMIN','DOCTOR')) or
  exists(select 1 from public.cashier_shifts where opened_by=auth.uid() and branch_id=wh.branch_id and status='open' and shift_type='petshop')) then
  raise exception 'Akses hitungan gudang ditolak' using errcode='42501';
 end if;
 select * into proof from public.stock_document_issue_proofs where kind=p_kind and document_id=p_id and item_id=p_item_id;
 if found then
  if proof.source_line is distinct from line then raise exception 'Rincian pengeluaran asal berubah. Periksa dokumen sebelum mengulang';end if;
  return proof.result;
 end if;
 qty:=-(line->>'selisih')::numeric;
 if qty is null or qty<=0 or qty>1e9 or qty::text in('NaN','Infinity','-Infinity') or
  (line->>'qty_sistem')::numeric-coalesce((line->>'qty_baru')::numeric,(line->>'qty_fisik')::numeric) is distinct from qty then raise exception 'Jumlah pengeluaran asal tidak valid';end if;
 perform 1 from public.accounting_locks where id for share;
 if not found then raise exception 'Status tutup buku tidak tersedia';end if;
 perform public.purchase_payment_period((doc->>'tanggal')::date,(now() at time zone 'Asia/Jakarta')::date);
 perform 1 from public.items where id=p_item_id and is_active and coalesce(item_type,'Persediaan')='Persediaan' for share;
 if not found then raise exception 'Barang pengeluaran tidak aktif atau bukan persediaan';end if;
 perform 1 from public.stock where warehouse_id=wh.id and item_id=p_item_id for update;
 if not found then raise exception 'Saldo stok asal tidak tersedia';end if;
 perform 1 from public.stock_layers where warehouse_id=wh.id and item_id=p_item_id order by id for update;
 if (select s.qty from public.stock s where warehouse_id=wh.id and item_id=p_item_id)<qty or
  (select s.qty from public.stock s where warehouse_id=wh.id and item_id=p_item_id) is distinct from
   (select coalesce(sum(l.qty_left),0) from public.stock_layers l where warehouse_id=wh.id and item_id=p_item_id) or
  exists(select 1 from public.stock_layers where warehouse_id=wh.id and item_id=p_item_id and (unit_cost<0 or unit_cost::text in('NaN','Infinity','-Infinity'))) then raise exception 'Stok/lapisan biaya tidak cukup atau tidak konsisten. Rekonsiliasi diperlukan';end if;
 if p_kind='adjustment' and (select s.qty from public.stock s where warehouse_id=wh.id and item_id=p_item_id) is distinct from (line->>'qty_sistem')::numeric then raise exception 'Stok berubah sejak dihitung. Periksa kembali penyesuaian sebelum menyimpan';end if;
 if exists(select 1 from public.stock_moves m where m.warehouse_id=wh.id and m.item_id=p_item_id and m.source=source_kind and m.source_ref=ref) then raise exception 'Pengeluaran lama sudah ada tanpa bukti; rekonsiliasi diperlukan';end if;
 select * into issued from public.stock_out_fifo(wh.id,p_item_id,qty,source_kind,ref,(doc->>'tanggal')::date);
 if issued.shortfall<>0 then raise exception 'Stok tidak cukup. Seluruh pengeluaran ini dibatalkan';end if;
 select * into move from public.stock_moves m where m.warehouse_id=wh.id and m.item_id=p_item_id and m.source=source_kind and m.source_ref=ref;
 if p_kind='adjustment' then
  update public.inventory_adjustment_items set nilai=round(issued.cost) where adjustment_id=p_id and item_id=p_item_id returning to_jsonb(inventory_adjustment_items) into line;
 end if;
 select jsonb_agg(to_jsonb(l) order by l.id) into layers from public.stock_layers l where l.id in(select (x->>'id')::uuid from jsonb_array_elements(issued.takes)x);
 result:=jsonb_build_object('cost',issued.cost);
 insert into public.stock_document_issue_proofs(move_id,kind,document_id,item_id,source_document,source_line,move_snapshot,takes,layers_after,result) values(move.id,p_kind,p_id,p_item_id,doc,line,to_jsonb(move),issued.takes,layers,result);
 return result;
end$$;
revoke all on function public.issue_stock_document_recorded(text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.issue_stock_document_recorded(text,uuid,uuid) to authenticated;

-- Shared planner: preview only locks/reads. Save recomputes the same plan under
-- the same stock/layer locks and rejects a changed preview before its first write.
create function public.stock_correction_plan(p_kind text,p_id uuid,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state jsonb;canonical jsonb;rows jsonb;wh uuid;branch uuid;r record;m record;l record;t record;
 moves jsonb;journals jsonb;layers jsonb;all_moves jsonb;virtual jsonb;lines jsonb:='[]';newrows jsonb:='[]';
 original numeric:=0;replacement numeric:=0;old_diff numeric;new_diff numeric;current_qty numeric;newqty numeric;
 cost numeric;needed numeric;take numeric;takes jsonb;restored numeric;buy numeric;value numeric;entry record;
 count_rows integer;changed boolean:=false;result jsonb;inventory numeric:=0;contra numeric:=0;
 proof public.stock_document_issue_proofs%rowtype;
 original_in numeric:=0;original_out numeric:=0;
begin
 state:=public.stock_correction_source(p_kind,p_id);wh:=(state->>'warehouse_id')::uuid;rows:=state->'rows';
 select branch_id into branch from public.warehouses where id=wh;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>10000 then raise exception 'Rincian koreksi tidak valid';end if;
 select jsonb_agg(jsonb_build_object('item_id',x.item_id,'qty',x.qty) order by x.item_id),count(*) into canonical,count_rows from jsonb_to_recordset(p_rows)x(item_id uuid,qty numeric);
 if count_rows<>(select count(distinct x.item_id) from jsonb_to_recordset(canonical)x(item_id uuid,qty numeric))
  or exists(select 1 from jsonb_to_recordset(canonical)x(item_id uuid,qty numeric) where x.item_id is null or x.qty is null or x.qty<0 or x.qty>1e9 or x.qty::text in('NaN','Infinity','-Infinity'))
  or (select jsonb_agg(x->'item_id' order by x->>'item_id') from jsonb_array_elements(canonical)x) is distinct from
     (select jsonb_agg(x->'item_id' order by x->>'item_id') from jsonb_array_elements(rows)x) then raise exception 'Isi jumlah valid untuk seluruh barang pada dokumen asal';end if;
 if (state->>'invoice_id') is not null then raise exception 'Hasil opname memiliki faktur tagihan. Selesaikan rekonsiliasi faktur/piutang asal melalui Finance sebelum koreksi stok; jalur ini tidak membatalkan tagihan';end if;
 perform 1 from public.accounting_locks where id for share;
 if not found then raise exception 'Status tutup buku tidak tersedia. Koreksi dihentikan';end if;
 perform public.purchase_payment_period((state->>'date')::date,(now() at time zone 'Asia/Jakarta')::date);
 for r in select x.* from jsonb_to_recordset(rows)x(item_id uuid) order by item_id loop
  perform 1 from public.items where id=r.item_id and is_active and coalesce(item_type,'Persediaan')='Persediaan' for share;
  if not found then raise exception 'Barang sumber tidak aktif atau bukan persediaan';end if;
  perform 1 from public.stock where warehouse_id=wh and item_id=r.item_id for update;
  if not found then raise exception 'Saldo stok sumber tidak lengkap. Rekonsiliasi diperlukan';end if;
 end loop;
 perform 1 from public.stock_layers where warehouse_id=wh and item_id in(select (x->>'item_id')::uuid from jsonb_array_elements(rows)x) order by item_id,id for update;
 select coalesce(jsonb_agg(to_jsonb(layer_row) order by layer_row.item_id,layer_row.id),'[]') into layers from public.stock_layers layer_row where warehouse_id=wh and item_id in(select (x->>'item_id')::uuid from jsonb_array_elements(rows)x);
 select coalesce(jsonb_agg(to_jsonb(move_row) order by move_row.item_id,move_row.id),'[]') into all_moves from public.stock_moves move_row where warehouse_id=wh and item_id in(select (x->>'item_id')::uuid from jsonb_array_elements(rows)x);
 if (state->>'revision')::integer>0 and (layers is distinct from state->'last_layers' or all_moves is distinct from state->'last_moves') then raise exception 'Stok sudah terpakai, terjual, diretur atau berpindah setelah koreksi terakhir. Rekonsiliasi dependensi sebelum koreksi berikutnya';end if;
 select coalesce(jsonb_agg(to_jsonb(move_row) order by move_row.item_id,move_row.id),'[]') into moves from public.stock_moves move_row where warehouse_id=wh and source=state->>'source' and source_ref=state->>'ref';
 if exists(select 1 from jsonb_to_recordset(moves)x(item_id uuid) where not exists(select 1 from jsonb_to_recordset(rows)y(item_id uuid) where x.item_id=y.item_id)) then raise exception 'Mutasi sumber di luar rincian dokumen. Rekonsiliasi diperlukan';end if;
 perform 1 from public.journal_entries where source=state->>'source' and source_ref=state->>'ref' order by id for update;
 perform 1 from public.journal_lines where entry_id in(select id from public.journal_entries where source=state->>'source' and source_ref=state->>'ref') order by id for update;
 select coalesce(jsonb_agg(jsonb_build_object('entry',to_jsonb(e),'lines',(select jsonb_agg(to_jsonb(j) order by j.id) from public.journal_lines j where j.entry_id=e.id)) order by e.id),'[]') into journals from public.journal_entries e where e.source=state->>'source' and e.source_ref=state->>'ref';
 for entry in select e.* from public.journal_entries e where e.source=state->>'source' and e.source_ref=state->>'ref' loop
  perform public.purchase_payment_period(entry.tanggal,(now() at time zone 'Asia/Jakarta')::date);
  if entry.voided_at is not null or entry.branch_id is distinct from branch
   or (select coalesce(sum(debit-credit),1) from public.journal_lines where entry_id=entry.id)<>0 then raise exception 'Jurnal sumber tidak utuh atau tidak seimbang. Rekonsiliasi diperlukan';end if;
 end loop;
 if exists(select 1 from public.journal_lines j join public.coa_accounts a on a.id=j.account_id where j.entry_id in(select id from public.journal_entries where source=state->>'source' and source_ref=state->>'ref') and
  (a.code not in('1301','5902') or j.debit<0 or j.credit<0 or j.debit::text in('NaN','Infinity','-Infinity') or j.credit::text in('NaN','Infinity','-Infinity'))) then raise exception 'Jurnal sumber memiliki dependensi keuangan lain. Rekonsiliasi diperlukan';end if;
 for r in select x.* from jsonb_to_recordset(rows)x(item_id uuid,name text,qty_sistem numeric,qty numeric,selisih numeric) order by item_id loop
  select x.qty into newqty from jsonb_to_recordset(canonical)x(item_id uuid,qty numeric) where x.item_id=r.item_id;
  if newqty<>r.qty then changed:=true;end if;
  old_diff:=r.qty-r.qty_sistem;new_diff:=newqty-r.qty_sistem;
  if old_diff is distinct from r.selisih or old_diff::text in('NaN','Infinity','-Infinity') or r.qty<0 or r.qty_sistem<0 then raise exception 'Angka sumber tidak konsisten. Rekonsiliasi diperlukan';end if;
  if p_kind='opname' and new_diff<0 and exists(select 1 from public.warehouses w join public.branches b on b.id=w.branch_id where w.id=wh and w.type<>'VET' and (w.type='RETAIL' or b.type<>'KLINIK')) then raise exception 'Selisih kurang opname gudang ini memerlukan faktur tagihan. Gunakan rekonsiliasi opname dan piutang melalui Finance';end if;
  select qty into current_qty from public.stock where warehouse_id=wh and item_id=r.item_id;
  if current_qty<0 or current_qty::text in('NaN','Infinity','-Infinity') or current_qty is distinct from
   (select coalesce(sum(x.qty_left),0) from jsonb_to_recordset(layers)x(item_id uuid,qty_left numeric) where x.item_id=r.item_id) then raise exception 'Saldo dan lapisan FIFO tidak cocok. Rekonsiliasi stok diperlukan';end if;
  if (select count(*) from jsonb_to_recordset(moves)x(item_id uuid) where x.item_id=r.item_id)<>(case when old_diff=0 then 0 else 1 end) then raise exception 'Bukti mutasi sumber tidak lengkap. Rekonsiliasi diperlukan';end if;
  select * into m from jsonb_to_recordset(moves)x(id uuid,item_id uuid,qty numeric,unit_cost numeric,fifo_takes jsonb,fifo_shortfall numeric,created_at timestamptz) where x.item_id=r.item_id;
  if old_diff<0 and m.fifo_takes is null then
   select * into proof from public.stock_document_issue_proofs where move_id=m.id and kind=p_kind and document_id=p_id and item_id=r.item_id;
   if found then
    if (proof.source_document-'nilai_masuk'-'nilai_keluar') is distinct from ((state->'source_snapshot'->'document')-'nilai_masuk'-'nilai_keluar') or
     (p_kind='adjustment' and proof.source_line is distinct from (select to_jsonb(i) from public.inventory_adjustment_items i where adjustment_id=p_id and item_id=r.item_id)) or
     (p_kind='opname' and proof.source_line is distinct from (select to_jsonb(i) from public.opname_result_items i where result_id=p_id and item_id=r.item_id)) then raise exception 'Dokumen pengeluaran asal berubah sejak diposting. Rekonsiliasi diperlukan';end if;
    if proof.move_snapshot is distinct from (select to_jsonb(sm) from public.stock_moves sm where sm.id=m.id) or
     exists(select 1 from jsonb_array_elements(proof.layers_after)x where x is distinct from (select to_jsonb(sl) from public.stock_layers sl where sl.id=(x->>'id')::uuid)) then raise exception 'Lapisan FIFO sumber sudah terpakai atau berubah. Rekonsiliasi diperlukan';end if;
    m.fifo_takes:=proof.takes;m.fifo_shortfall:=0;
   end if;
  end if;
  if old_diff<>0 and (m.qty is distinct from old_diff or m.unit_cost<0 or m.unit_cost::text in('NaN','Infinity','-Infinity')) then raise exception 'Nilai mutasi sumber tidak konsisten. Rekonsiliasi diperlukan';end if;
  -- Later revisions already compare every layer and movement to their recorded
  -- after-state. A zero-effect replacement has no own move/timestamp; falling
  -- back to the original date would mistake its prior reversals for dependencies.
  if (state->>'revision')::integer=0 and exists(select 1 from public.stock_moves other where other.warehouse_id=wh and other.item_id=r.item_id and other.created_at>coalesce(m.created_at,(state->'source_snapshot'->'document'->>'created_at')::timestamptz) and other.source_ref is distinct from state->>'ref') then raise exception 'Stok sudah terpakai, terjual, diretur atau dipindahkan. Rekonsiliasi dokumen lanjutan terlebih dahulu';end if;
  virtual:='[]';
  for l in select x.* from jsonb_to_recordset(layers)x(id uuid,item_id uuid,qty_in numeric,qty_left numeric,unit_cost numeric,source text,source_ref text,exp_date date,tanggal date,created_at timestamptz) where x.item_id=r.item_id order by exp_date nulls last,tanggal,created_at,id loop
   restored:=l.qty_left;
   if old_diff>0 and l.source=state->>'source' and l.source_ref=state->>'ref' then
    if l.qty_in<>old_diff or l.qty_left<>l.qty_in or l.unit_cost<>m.unit_cost then raise exception 'Lapisan sumber sudah terpakai atau nilai berubah. Rekonsiliasi diperlukan';end if;
    restored:=0;
   elsif old_diff<0 then
    if m.fifo_takes is null or m.fifo_shortfall is distinct from 0::numeric then raise exception 'Bukti FIFO stok keluar lama tidak lengkap. Rekonsiliasi sumber diperlukan; saldo tidak boleh dibalik dengan perkiraan';end if;
    select coalesce(sum(x.qty),0) into take from jsonb_to_recordset(m.fifo_takes)x(id uuid,qty numeric,unit_cost numeric) where x.id=l.id and x.unit_cost=l.unit_cost;
    restored:=restored+take;
    if restored>l.qty_in then raise exception 'Lapisan FIFO sumber berubah. Rekonsiliasi diperlukan';end if;
   end if;
   if l.unit_cost<0 or l.unit_cost::text in('NaN','Infinity','-Infinity') then raise exception 'Nilai lapisan FIFO tidak valid';end if;
   virtual:=virtual||jsonb_build_array(jsonb_build_object('id',l.id,'qty',restored,'unit_cost',l.unit_cost,'exp_date',l.exp_date));
  end loop;
  if old_diff>0 and (select count(*) from jsonb_to_recordset(layers)x(item_id uuid,source text,source_ref text) where x.item_id=r.item_id and x.source=state->>'source' and x.source_ref=state->>'ref')<>1 then raise exception 'Asal lapisan stok masuk tidak lengkap. Rekonsiliasi diperlukan';end if;
  if old_diff<0 and (m.fifo_takes is null or m.fifo_shortfall is distinct from 0::numeric or
   (select sum(x.qty) from jsonb_to_recordset(m.fifo_takes)x(qty numeric)) is distinct from -old_diff or
   (select sum((x->>'qty')::numeric) from jsonb_array_elements(virtual)x) is distinct from current_qty-old_diff) then raise exception 'Bukti FIFO stok keluar lama tidak lengkap. Rekonsiliasi sumber diperlukan';end if;
  original:=original+round(coalesce(old_diff*m.unit_cost,0),2);
  original_in:=original_in+greatest(round(coalesce(old_diff*m.unit_cost,0),2),0);
  original_out:=original_out+greatest(-round(coalesce(old_diff*m.unit_cost,0),2),0);
  if current_qty+newqty-r.qty<0 then raise exception 'Stok tidak cukup untuk koreksi. Barang sudah terpakai/terjual; rekonsiliasi dependensi dahulu';end if;
  takes:='[]';cost:=0;needed:=greatest(-new_diff,0);
  for t in select x.* from jsonb_to_recordset(virtual)x(id uuid,qty numeric,unit_cost numeric,exp_date date) loop
   exit when needed<=0;take:=least(needed,t.qty);
   if take>0 then cost:=cost+take*t.unit_cost;needed:=needed-take;takes:=takes||jsonb_build_array(jsonb_build_object('id',t.id,'qty',take,'unit_cost',t.unit_cost,'exp_date',t.exp_date));end if;
  end loop;
  if needed>0 then raise exception 'Lapisan FIFO tidak cukup untuk koreksi';end if;
  select buy_price into buy from public.items where id=r.item_id;
  if buy is null or buy<0 or buy>1e12 or buy::text in('NaN','Infinity','-Infinity') then raise exception 'Harga modal barang tidak valid';end if;
  value:=case when new_diff>0 then new_diff*buy else -cost end;
  replacement:=replacement+round(value,2);
  newrows:=newrows||jsonb_build_array(jsonb_build_object('item_id',r.item_id,'name',r.name,'qty_sistem',r.qty_sistem,'qty',newqty,'selisih',new_diff,'value',round(value,2)));
  lines:=lines||jsonb_build_array(jsonb_build_object('item_id',r.item_id,'name',r.name,'old_qty',r.qty,'new_qty',newqty,'stock_before',current_qty,'stock_after',current_qty+newqty-r.qty,'delta',newqty-r.qty,'old_diff',old_diff,'new_diff',new_diff,'old_move',case when old_diff<>0 then to_jsonb(m) end,'restored_layers',virtual,'takes',takes,'unit_cost',buy,'value',round(value,2)));
 end loop;
 if not changed then raise exception 'Jumlah koreksi sama dengan hasil saat ini';end if;
 select coalesce(sum(j.debit-j.credit) filter(where a.code='1301'),0),coalesce(sum(j.debit-j.credit) filter(where a.code='5902'),0) into inventory,contra from public.journal_lines j join public.coa_accounts a on a.id=j.account_id where j.entry_id in(select id from public.journal_entries where source=state->>'source' and source_ref=state->>'ref');
 if inventory is distinct from round(original,2) or contra is distinct from -round(original,2) then raise exception 'Nilai jurnal dan stok sumber tidak cocok. Rekonsiliasi sumber diperlukan';end if;
 if exists(select 1 from public.coa_accounts a where a.code in('1301','5902') and (
  (select coalesce(sum(j.debit),0) from public.journal_lines j where j.account_id=a.id and j.entry_id in(select id from public.journal_entries where source=state->>'source' and source_ref=state->>'ref')) is distinct from case a.code when '1301' then original_in else original_out end or
  (select coalesce(sum(j.credit),0) from public.journal_lines j where j.account_id=a.id and j.entry_id in(select id from public.journal_entries where source=state->>'source' and source_ref=state->>'ref')) is distinct from case a.code when '1301' then original_out else original_in end)) then raise exception 'Rincian debit/kredit sumber tidak cocok dengan mutasi stok. Rekonsiliasi diperlukan';end if;
 if p_kind='adjustment' and (state->>'revision')::integer=0 and
  ((state->'source_snapshot'->'document'->>'nilai_masuk')::numeric is distinct from original_in or
   (state->'source_snapshot'->'document'->>'nilai_keluar')::numeric is distinct from original_out) then raise exception 'Nilai header dokumen asal belum lengkap atau berbeda dari FIFO. Rekonsiliasi diperlukan';end if;
 perform 1 from public.coa_accounts where code in('1301','5902') and is_active and not is_header order by code for share;
 if (select count(*) from public.coa_accounts where code in('1301','5902') and is_active and not is_header)<>2 then raise exception 'Akun persediaan/selisih tidak aktif';end if;
 result:=jsonb_build_object('kind',p_kind,'document_id',p_id,'warehouse_id',wh,'branch_id',branch,'revision',state->'revision','rows',newrows,'lines',lines,'before',state,'moves',moves,'layers',layers,'all_moves',all_moves,'journals',journals,'value_before',round(original,2),'value_after',replacement,'value_delta',replacement-round(original,2),'date',(now() at time zone 'Asia/Jakarta')::date);
 return result||jsonb_build_object('token',md5(result::text));
end$$;
revoke all on function public.stock_correction_plan(text,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.preview_stock_document_correction(p_kind text,p_id uuid,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare plan jsonb;begin
 plan:=public.stock_correction_plan(p_kind,p_id,p_rows);
 return jsonb_build_object('token',plan->'token','revision',plan->'revision','lines',plan->'lines','value_before',plan->'value_before','value_after',plan->'value_after','value_delta',plan->'value_delta');
end$$;
revoke all on function public.preview_stock_document_correction(text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.preview_stock_document_correction(text,uuid,jsonb) to authenticated;

create function public.correct_stock_document(p_kind text,p_id uuid,p_rows jsonb,p_reason text,p_request_key text,p_preview_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare state jsonb;payload jsonb;prior public.stock_document_correction_requests%rowtype;plan jsonb;
 correction_id uuid:=gen_random_uuid();r record;t record;j record;rev uuid;replacement uuid;reversals uuid[]:='{}';
 wh uuid;branch uuid;date date:=(now() at time zone 'Asia/Jakarta')::date;cost record;after_state jsonb;result jsonb;
begin
 if auth.uid() is null then raise exception 'Hanya Super Admin aktif yang dapat mengoreksi stok' using errcode='42501';end if;
 if p_request_key is null or length(btrim(p_request_key))<1 or length(p_request_key)>120 or p_reason is null or length(btrim(p_reason))<3 or length(p_reason)>1000 then raise exception 'Identitas permintaan dan alasan koreksi wajib diisi';end if;
 perform pg_advisory_xact_lock(hashtextextended('vetos:stock-correction:'||auth.uid()::text||':'||p_request_key,0));
 state:=public.stock_correction_source(p_kind,p_id);
 payload:=jsonb_build_object('kind',p_kind,'id',p_id,'rows',p_rows,'reason',btrim(p_reason),'preview',p_preview_token);
 select * into prior from public.stock_document_correction_requests where actor_id=auth.uid() and request_key=p_request_key;
 if found then
  if prior.payload is distinct from payload then raise exception 'Identitas permintaan sudah digunakan dengan isi berbeda. Periksa hasil terakhir';end if;
  return prior.result;
 end if;
 plan:=public.stock_correction_plan(p_kind,p_id,p_rows);
 if p_preview_token is null or p_preview_token is distinct from plan->>'token' then raise exception 'Preview berubah atau kedaluwarsa. Periksa dampak koreksi lagi sebelum menyimpan';end if;
 wh:=(plan->>'warehouse_id')::uuid;branch:=(plan->>'branch_id')::uuid;
 for r in select x.* from jsonb_to_recordset(plan->'lines')x(item_id uuid,old_diff numeric,new_diff numeric,old_move jsonb,restored_layers jsonb,takes jsonb,unit_cost numeric) order by item_id loop
  if r.old_diff<>0 then
   for t in select x.* from jsonb_to_recordset(r.restored_layers)x(id uuid,qty numeric) loop update public.stock_layers set qty_left=t.qty where id=t.id;end loop;
   update public.stock set qty=qty-r.old_diff,updated_at=now() where warehouse_id=wh and item_id=r.item_id;
   insert into public.stock_moves(tanggal,warehouse_id,item_id,qty,unit_cost,source,source_ref) values(date,wh,r.item_id,-r.old_diff,(r.old_move->>'unit_cost')::numeric,'stock-correct-reverse',correction_id::text);
  end if;
  if r.new_diff>0 then perform public.stock_in_fifo(wh,r.item_id,r.new_diff,r.unit_cost,'stock-correction',correction_id::text,date);
  elsif r.new_diff<0 then
   select * into cost from public.stock_out_fifo(wh,r.item_id,-r.new_diff,'stock-correction',correction_id::text,date);
   if cost.shortfall<>0 or cost.takes is distinct from r.takes then raise exception 'FIFO berubah saat koreksi; seluruh perubahan dibatalkan';end if;
   update public.stock_moves set fifo_takes=cost.takes,fifo_shortfall=cost.shortfall where warehouse_id=wh and item_id=r.item_id and source='stock-correction' and source_ref=correction_id::text;
  end if;
 end loop;
 for j in select x.* from jsonb_array_elements(plan->'journals')x loop
  rev:=gen_random_uuid();
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values(rev,'SCV.'||left(replace(rev::text,'-',''),20),date,'Pembalikan koreksi stok '||p_id::text,'stock-correct-reverse',correction_id::text,branch);
  insert into public.journal_lines(entry_id,account_id,debit,credit) select rev,(l->>'account_id')::uuid,(l->>'credit')::numeric,(l->>'debit')::numeric from jsonb_array_elements(j.value->'lines')l;
  reversals:=array_append(reversals,rev);
 end loop;
 if exists(select 1 from jsonb_array_elements(plan->'lines')x where (x->>'value')::numeric<>0) then
  replacement:=gen_random_uuid();
  insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id) values(replacement,'SCR.'||left(replace(replacement::text,'-',''),20),date,'Pengganti koreksi stok '||p_id::text||' — '||btrim(p_reason),'stock-correction',correction_id::text,branch);
  insert into public.journal_lines(entry_id,account_id,debit,credit)
   select replacement,a.id,case when (a.code='1301' and v.amount>0) or (a.code='5902' and v.amount<0) then abs(v.amount) else 0 end,
   case when (a.code='1301' and v.amount<0) or (a.code='5902' and v.amount>0) then abs(v.amount) else 0 end
   from (select sum((x->>'value')::numeric) amount from jsonb_array_elements(plan->'lines')x group by sign((x->>'value')::numeric))v cross join public.coa_accounts a where a.code in('1301','5902') and v.amount<>0;
 end if;
 after_state:=jsonb_build_object('rows',plan->'rows','layers',(select coalesce(jsonb_agg(to_jsonb(layer_row) order by layer_row.item_id,layer_row.id),'[]') from public.stock_layers layer_row where warehouse_id=wh and item_id in(select (x->>'item_id')::uuid from jsonb_array_elements(plan->'rows')x)),
  'all_moves',(select coalesce(jsonb_agg(to_jsonb(move_row) order by move_row.item_id,move_row.id),'[]') from public.stock_moves move_row where warehouse_id=wh and item_id in(select (x->>'item_id')::uuid from jsonb_array_elements(plan->'rows')x)));
 insert into public.stock_document_corrections(id,kind,document_id,branch_id,warehouse_id,revision,reason,source_snapshot,before_state,after_state,reversal_journal_ids,replacement_journal_id,created_by)
 values(correction_id,p_kind,p_id,branch,wh,(plan->>'revision')::integer+1,btrim(p_reason),state->'source_snapshot',jsonb_build_object('rows',state->'rows','journals',plan->'journals','moves',plan->'moves'),after_state,reversals,replacement,auth.uid());
 result:=jsonb_build_object('correction_id',correction_id,'revision',(plan->>'revision')::integer+1,'document_id',p_id);
 insert into public.stock_document_correction_requests(actor_id,request_key,kind,document_id,payload,result) values(auth.uid(),p_request_key,p_kind,p_id,payload,result);
 return result;
end$$;
revoke all on function public.correct_stock_document(text,uuid,jsonb,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.correct_stock_document(text,uuid,jsonb,text,text,text) to authenticated;

create function public.get_stock_document_correction_result(p_kind text,p_id uuid,p_request_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null or p_request_key is null or length(p_request_key)>120 then raise exception 'Identitas pemulihan koreksi tidak valid' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('vetos:stock-correction:'||auth.uid()::text||':'||p_request_key,0));
 perform public.stock_correction_source(p_kind,p_id);
 select r.result into result from public.stock_document_correction_requests r where r.actor_id=auth.uid() and r.request_key=p_request_key and r.kind=p_kind and r.document_id=p_id;
 return result;
end$$;
revoke all on function public.get_stock_document_correction_result(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_stock_document_correction_result(text,uuid,text) to authenticated;

-- Existing screens read the effective counts without granting direct audit access
-- or exposing inventory valuation to cashier users of the shared opname view.
create function public.read_stock_document_effective(p_kind text,p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb:='{}';c record;rows jsonb;begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_active) then raise exception 'Akun aktif diperlukan' using errcode='42501';end if;
 if coalesce(cardinality(p_ids),0)>100 then raise exception 'Terlalu banyak dokumen';end if;
 for c in select distinct on(document_id) * from public.stock_document_corrections where kind=p_kind and document_id=any(p_ids) and public.user_can_access_branch(branch_id) order by document_id,revision desc loop
  select jsonb_agg(jsonb_build_object('item_id',x->'item_id','qty',x->'qty','selisih',x->'selisih')||case when p_kind='adjustment' then jsonb_build_object('value',x->'value') else '{}'::jsonb end order by x->>'item_id') into rows from jsonb_array_elements(c.after_state->'rows')x;
  result:=result||jsonb_build_object(c.document_id::text,jsonb_build_object('revision',c.revision,'rows',rows));
 end loop;
 return result;
end$$;
revoke all on function public.read_stock_document_effective(text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.read_stock_document_effective(text,uuid[]) to authenticated;

-- Keep corrected source documents and ledger history immutable at API boundaries.
-- SECURITY INVOKER guards let the checked definer RPC append exact effects.
create function public.stock_correction_row_protected(p_table text,p_row jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_table='inventory_adjustments' then return exists(select 1 from public.stock_document_corrections where kind='adjustment' and document_id=(p_row->>'id')::uuid);
 elsif p_table='inventory_adjustment_items' then return exists(select 1 from public.stock_document_corrections where kind='adjustment' and document_id=(p_row->>'adjustment_id')::uuid);
 elsif p_table='opname_results' then return exists(select 1 from public.stock_document_corrections where kind='opname' and document_id=(p_row->>'id')::uuid);
 elsif p_table='opname_result_items' then return exists(select 1 from public.stock_document_corrections where kind='opname' and document_id=(p_row->>'result_id')::uuid);
 elsif p_table='opname_orders' then return exists(select 1 from public.stock_document_corrections where kind='opname' and source_snapshot->'document'->>'order_id'=p_row->>'id');
 elsif p_table='journal_lines' then return exists(select 1 from public.journal_entries e where e.id=(p_row->>'entry_id')::uuid and public.stock_correction_row_protected('journal_entries',to_jsonb(e)));
 elsif p_table in('stock_moves','stock_layers','journal_entries') then
  if p_table='stock_moves' and exists(select 1 from public.stock_document_issue_proofs where move_id=(p_row->>'id')::uuid) then return true;end if;
  return p_row->>'source' in('stock-correction','stock-correct-reverse') or exists(select 1 from public.stock_document_corrections c where
   (p_row->>'source'='penyesuaian' and c.kind='adjustment' and c.source_snapshot->'document'->>'no_adj'=p_row->>'source_ref') or
   (p_row->>'source'='opname' and c.kind='opname' and c.source_snapshot->'document'->>'no_hasil'=p_row->>'source_ref'));
 end if;
 return false;
end$$;
revoke all on function public.stock_correction_row_protected(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.stock_correction_row_protected(text,jsonb) to authenticated,service_role;
create function public.guard_stock_correction_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user in('authenticated','anon','service_role') and
  (public.stock_correction_row_protected(tg_table_name,to_jsonb(old)) or public.stock_correction_row_protected(tg_table_name,to_jsonb(new))) then
  -- Legitimate FIFO consumers may decrease the remainder of a protected layer;
  -- they cannot alter its cost, source, identity, or restore spent quantities.
  if tg_table_name='stock_layers' and tg_op='UPDATE' then
   if new.qty_left<=old.qty_left and new.qty_left>=0 and (to_jsonb(new)-'qty_left')=(to_jsonb(old)-'qty_left') then return new;end if;
  end if;
  raise exception 'Riwayat koreksi stok dilindungi. Gunakan proses koreksi resmi' using errcode='42501';
 end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_stock_correction_history() from public,anon,authenticated,service_role;
do $$declare table_name text;begin
 foreach table_name in array array['inventory_adjustments','inventory_adjustment_items','opname_orders','opname_results','opname_result_items','stock_moves','stock_layers','journal_entries','journal_lines'] loop
  execute format('create trigger stock_document_correction_history before insert or update or delete on public.%I for each row execute function public.guard_stock_correction_history()',table_name);
 end loop;
end$$;
