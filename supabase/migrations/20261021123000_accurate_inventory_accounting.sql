-- Explicit initial-inventory accounting. No historical repair is applied here.
-- Keep the stock writer private; every new opening now needs a reviewed GL bridge.
alter function public.post_accurate_initial_stock(uuid) rename to accurate_initial_stock_internal;
revoke all on function public.accurate_initial_stock_internal(uuid) from public,anon,authenticated,service_role;
create function public.post_accurate_initial_stock(p_run_id uuid) returns jsonb
language plpgsql set search_path='' as $$ begin
 raise exception 'Tinjau dan posting stok + jurnal melalui Keuangan / Persediaan Awal';
end $$;
revoke all on function public.post_accurate_initial_stock(uuid) from public,anon,authenticated,service_role;
grant execute on function public.post_accurate_initial_stock(uuid) to authenticated;

create table public.accurate_inventory_accounting (
 run_id uuid primary key references public.import_runs(id) on delete restrict,
 entry_id uuid not null unique references public.journal_entries(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 equity_account_id uuid not null references public.coa_accounts(id) on delete restrict,
 reason text not null check(length(btrim(reason)) between 10 and 1000),
 preview jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.accurate_inventory_accounting enable row level security;
revoke all on public.accurate_inventory_accounting from public,anon,authenticated,service_role;

create function public.preview_accurate_inventory_accounting(p_run_id uuid,p_equity_account_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 r public.import_runs%rowtype; a public.coa_accounts%rowtype; e public.coa_accounts%rowtype;
 b public.branches%rowtype; w public.warehouses%rowtype;
 blockers jsonb:='[]'; rows_evidence jsonb; gl_evidence jsonb; stock_evidence jsonb;
 receipt jsonb; layer_evidence jsonb; source_move_evidence jsonb;
 layer_q numeric; layer_value numeric; move_q numeric; move_value numeric;
 n int; excluded int; q numeric:=0; amount numeric:=0; remaining numeric:=0;
 x record; qty numeric; cost numeric; valid_payload boolean:=true; closed date;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active) then
  raise exception 'OWNER aktif diperlukan' using errcode='42501';end if;
 select * into r from public.import_runs where id=p_run_id and kind='initial_stock';
 if not found or r.branch_id is null or not public.user_can_access_branch(r.branch_id) then
  raise exception 'Batch atau cabang tidak dapat diakses' using errcode='42501';end if;
 select * into b from public.branches where id=r.branch_id;
 select * into w from public.warehouses where id=r.warehouse_id;
 if not b.is_active or w.id is null or not w.is_active or w.branch_id is distinct from r.branch_id then
  blockers:=blockers||jsonb_build_array('Cabang/gudang tidak aktif atau tidak cocok');end if;
 select * into a from public.coa_accounts where code='1301' and type='ASET' and normal_balance='D' and is_active and not is_header;
 if not found then blockers:=blockers||jsonb_build_array('Akun persediaan 1301 aktif dan detail diperlukan');end if;
 select * into e from public.coa_accounts where id=p_equity_account_id and type='EKUITAS' and normal_balance='K' and is_active and not is_header;
 if not found then blockers:=blockers||jsonb_build_array('Pilih akun lawan EKUITAS detail aktif; keputusan Finance diperlukan');end if;
 select result into receipt from public.accurate_inventory_accounting where run_id=p_run_id;
 select closed_until into closed from public.accounting_locks where id;
 if not found then blockers:=blockers||jsonb_build_array('Konfigurasi kunci periode tidak ada; keputusan Finance diperlukan');end if;
 if r.as_of_date is null or not isfinite(r.as_of_date) or r.as_of_date>(now() at time zone 'Asia/Jakarta')::date then
  blockers:=blockers||jsonb_build_array('Tanggal posisi tidak valid');end if;
 if r.as_of_date<=closed then blockers:=blockers||jsonb_build_array('Periode akuntansi sudah ditutup');end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'row',source_row,'status',status,'code',source_code,'reason',reason,'payload',payload) order by source_row,id),'[]')
 into rows_evidence from public.import_run_rows where run_id=p_run_id;
 select count(*) filter(where status=case when r.status='posted' then 'posted' else 'valid' end),
 count(*) filter(where status<>case when r.status='posted' then 'posted' else 'valid' end)
 into n,excluded from public.import_run_rows where run_id=p_run_id;
 for x in select payload from public.import_run_rows where run_id=p_run_id and status=case when r.status='posted' then 'posted' else 'valid' end loop
  begin
   qty:=(x.payload->>'base_qty')::numeric; cost:=(x.payload->>'base_unit_cost')::numeric;
   if qty is null or cost is null or qty<=0 or cost<0 or qty>1000000000 or cost>1000000000000
    or qty::text in ('NaN','Infinity','-Infinity') or cost::text in ('NaN','Infinity','-Infinity')
    or (x.payload->>'warehouse_id')::uuid is distinct from r.warehouse_id
    or (x.payload ? 'branch_id' and (x.payload->>'branch_id')::uuid is distinct from r.branch_id)
    or (x.payload->>'as_of')::date is distinct from r.as_of_date
    or (nullif(x.payload->>'exp_date','') is not null and not isfinite((x.payload->>'exp_date')::date))
    or not exists(select 1 from public.items where id=(x.payload->>'item_id')::uuid and item_type='Persediaan' and is_active)
    then valid_payload:=false;
   else q:=q+qty;amount:=amount+qty*cost;end if;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then valid_payload:=false;
  end;
 end loop;
 if not valid_payload then blockers:=blockers||jsonb_build_array('Payload stok, tanggal, barang, atau alokasi cabang tidak valid');end if;
 if n=0 or amount<=0 or amount>1000000000000 or amount<>round(amount,2) then
  blockers:=blockers||jsonb_build_array('Jumlah/nilai sumber harus positif dan tepat dua desimal; tinjau pembulatan');end if;
 if (r.summary->>'valid')::int is distinct from n then
  blockers:=blockers||jsonb_build_array('Batch belum lengkap atau jumlah baris berubah; buat preview impor ulang');end if;
 -- Evidence covers all branches and all dates: a global opening may already include this stock.
 -- Never infer an unposted amount from today's remaining FIFO or net GL balance.
 select coalesce(jsonb_agg(jsonb_build_object('entry_id',j.id,'source',j.source,'source_ref',j.source_ref,'branch_id',j.branch_id,'tanggal',j.tanggal,'line_id',l.id,'account',c.code,'debit',l.debit,'credit',l.credit) order by j.id,l.id),'[]')
 into gl_evidence from public.journal_entries j left join public.journal_lines l on l.entry_id=j.id left join public.coa_accounts c on c.id=l.account_id
 where (j.source='saldo-awal' or c.code='1301') and not exists(select 1 from public.accurate_inventory_accounting ai where ai.entry_id=j.id);
 if jsonb_array_length(gl_evidence)>0 then blockers:=blockers||jsonb_build_array('GL persediaan/saldo awal lain sudah ada; rekonsiliasi as-of dan keputusan Finance wajib, posting otomatis diblokir');end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'item_id',s.item_id,'qty',s.qty,'source',s.source,'source_ref',s.source_ref) order by s.id),'[]')
 into stock_evidence from public.stock_moves s where s.warehouse_id=r.warehouse_id and s.item_id::text in
 (select payload->>'item_id' from public.import_run_rows where run_id=p_run_id and status in ('valid','posted'));
 if r.status='previewed' and (jsonb_array_length(stock_evidence)>0 or exists(select 1 from public.stock s where s.warehouse_id=r.warehouse_id and s.qty<>0 and s.item_id::text in
  (select payload->>'item_id' from public.import_run_rows where run_id=p_run_id and status='valid')) or exists(select 1 from public.stock_layers s where s.warehouse_id=r.warehouse_id and s.item_id::text in
  (select payload->>'item_id' from public.import_run_rows where run_id=p_run_id and status='valid'))) then
  blockers:=blockers||jsonb_build_array('Barang sudah memiliki stok/layer/riwayat; impor awal baru diblokir');end if;
 select coalesce(sum(qty_left*unit_cost),0),coalesce(sum(qty_in),0),coalesce(sum(qty_in*unit_cost),0),
 coalesce(jsonb_agg(jsonb_build_object('id',id,'warehouse_id',warehouse_id,'item_id',item_id,'tanggal',tanggal,'qty_in',qty_in,'qty_left',qty_left,'unit_cost',unit_cost,'batch_no',batch_no,'exp_date',exp_date) order by id),'[]')
 into remaining,layer_q,layer_value,layer_evidence from public.stock_layers where source='saldo-awal-accurate' and source_ref=p_run_id::text;
 select coalesce(sum(sm.qty),0),coalesce(sum(sm.qty*sm.unit_cost),0),
 coalesce(jsonb_agg(jsonb_build_object('id',sm.id,'warehouse_id',sm.warehouse_id,'item_id',sm.item_id,'tanggal',sm.tanggal,'qty',sm.qty,'unit_cost',sm.unit_cost) order by sm.id),'[]')
 into move_q,move_value,source_move_evidence from public.stock_moves sm where sm.source='saldo-awal-accurate' and sm.source_ref=p_run_id::text;
 if r.status='posted' and (not valid_payload or layer_q<>q or layer_value<>amount or move_q<>q or move_value<>amount
 or jsonb_array_length(layer_evidence)<>n or jsonb_array_length(source_move_evidence)<>n
 or exists(select 1 from public.stock_layers where source='saldo-awal-accurate' and source_ref=p_run_id::text and (warehouse_id<>r.warehouse_id or tanggal<>r.as_of_date or qty_left>qty_in))
 or exists(select 1 from public.stock_moves where source='saldo-awal-accurate' and source_ref=p_run_id::text and (warehouse_id<>r.warehouse_id or tanggal<>r.as_of_date))) then
  blockers:=blockers||jsonb_build_array('Bukti historis baris/layer/kartu tidak cocok; angka sumber belum terverifikasi');end if;
 if r.status='posted' and valid_payload then
  if exists(
   (select (payload->>'item_id')::uuid item_id,(payload->>'warehouse_id')::uuid warehouse_id,(payload->>'as_of')::date tanggal,
    (payload->>'base_qty')::numeric qty,(payload->>'base_unit_cost')::numeric unit_cost,nullif(payload->>'batch_no','') batch_no,nullif(payload->>'exp_date','')::date exp_date
    from public.import_run_rows where run_id=p_run_id and status='posted'
    except all select item_id,warehouse_id,tanggal,qty_in,unit_cost,batch_no,exp_date from public.stock_layers where source='saldo-awal-accurate' and source_ref=p_run_id::text)
   union all
   (select item_id,warehouse_id,tanggal,qty_in,unit_cost,batch_no,exp_date from public.stock_layers where source='saldo-awal-accurate' and source_ref=p_run_id::text
    except all select (payload->>'item_id')::uuid,(payload->>'warehouse_id')::uuid,(payload->>'as_of')::date,(payload->>'base_qty')::numeric,(payload->>'base_unit_cost')::numeric,nullif(payload->>'batch_no',''),nullif(payload->>'exp_date','')::date
    from public.import_run_rows where run_id=p_run_id and status='posted'))
   or exists(
    (select (payload->>'item_id')::uuid,(payload->>'warehouse_id')::uuid,(payload->>'as_of')::date,(payload->>'base_qty')::numeric,(payload->>'base_unit_cost')::numeric
     from public.import_run_rows where run_id=p_run_id and status='posted'
     except all select sm.item_id,sm.warehouse_id,sm.tanggal,sm.qty,sm.unit_cost from public.stock_moves sm where source='saldo-awal-accurate' and source_ref=p_run_id::text)
    union all
    (select sm.item_id,sm.warehouse_id,sm.tanggal,sm.qty,sm.unit_cost from public.stock_moves sm where source='saldo-awal-accurate' and source_ref=p_run_id::text
     except all select (payload->>'item_id')::uuid,(payload->>'warehouse_id')::uuid,(payload->>'as_of')::date,(payload->>'base_qty')::numeric,(payload->>'base_unit_cost')::numeric
     from public.import_run_rows where run_id=p_run_id and status='posted')) then
   blockers:=blockers||jsonb_build_array('Rincian historis item/lot/layer/kartu berbeda dari baris impor');end if;
 end if;
 if r.status='posted' then blockers:=blockers||jsonb_build_array(case when receipt is null then 'Batch historis: hanya laporan; pemetaan GL global, konsumsi dan dasar as-of wajib ditinjau sebelum rencana repair terpisah' else 'Batch sudah diposting stok + jurnal; gunakan bukti posting' end);
 elsif r.status<>'previewed' then blockers:=blockers||jsonb_build_array('Status batch tidak dapat diposting');end if;
 return jsonb_build_object('version',1,'run_id',r.id,'status',r.status,'source_name',r.source_name,'source_hash',r.source_hash,
 'branch_id',r.branch_id,'branch_name',b.name,'warehouse_id',r.warehouse_id,'warehouse_name',w.name,'as_of',r.as_of_date,
 'selected_rows',n,'excluded_rows',excluded,'original_qty',q,'original_value',amount,'remaining_value',remaining,
 'inventory_account',jsonb_build_object('id',a.id,'code',a.code,'name',a.name),
 'equity_account',jsonb_build_object('id',e.id,'code',e.code,'name',e.name),'blockers',blockers,'can_post',jsonb_array_length(blockers)=0,
 'receipt',receipt,'evidence',jsonb_build_object('original_layer_qty',layer_q,'original_layer_value',layer_value,'original_move_qty',move_q,'original_move_value',move_value,'source_layers',layer_evidence,'source_moves',source_move_evidence,'rows',rows_evidence,'other_gl',gl_evidence,'stock_moves',stock_evidence,'summary',r.summary,'closed_until',closed));
end $$;

create function public.post_accurate_inventory_accounting(p_run_id uuid,p_equity_account_id uuid,p_expected jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb; prior public.accurate_inventory_accounting%rowtype; j uuid:=gen_random_uuid(); no text; result jsonb; amount numeric;
begin
 perform 1 from public.profiles where id=auth.uid() and role='OWNER' and is_active for share;
 if not found then raise exception 'OWNER aktif diperlukan' using errcode='42501';end if;
 -- Same lock order as PR70 global opening. Serialize duplicate detection with all journal writers.
 lock table public.journal_entries,public.journal_lines in share row exclusive mode;
 lock table public.import_runs,public.import_run_rows in share row exclusive mode;
 perform 1 from public.import_runs where id=p_run_id and public.user_can_access_branch(branch_id) for update;
 if not found then raise exception 'Batch/cabang tidak dapat diakses' using errcode='42501';end if;
 -- Hold operational evidence steady until the stock writer and GL commit together.
 lock table public.stock,public.stock_layers,public.stock_moves in share row exclusive mode;
 perform 1 from public.accounting_locks where id for share;
 perform 1 from public.branches where id=(select branch_id from public.import_runs where id=p_run_id) for share;
 perform 1 from public.warehouses where id=(select warehouse_id from public.import_runs where id=p_run_id) for share;
 perform 1 from public.coa_accounts where id=p_equity_account_id or code='1301' order by id for share;
 perform 1 from public.items where id::text in(select payload->>'item_id' from public.import_run_rows where run_id=p_run_id and status='valid') order by id for share;
 if p_reason is null or length(btrim(p_reason)) not between 10 and 1000 then raise exception 'Alasan keputusan ekuitas diperlukan' using errcode='22023';end if;
 select * into prior from public.accurate_inventory_accounting where run_id=p_run_id;
 if found then
  if prior.actor_id<>auth.uid() or prior.equity_account_id is distinct from p_equity_account_id or prior.preview is distinct from p_expected or prior.reason<>btrim(p_reason) then
   raise exception 'Batch sudah diposting dengan keputusan berbeda' using errcode='22023';end if;
  return prior.result;
 end if;
 p:=public.preview_accurate_inventory_accounting(p_run_id,p_equity_account_id);
 if p is distinct from p_expected then raise exception 'Bukti berubah; tinjau preview ulang' using errcode='22023';end if;
 if not (p->>'can_post')::boolean then raise exception 'Posting diblokir: %',p->'blockers' using errcode='22023';end if;
 perform public.accurate_initial_stock_internal(p_run_id);
 amount:=(p->>'original_value')::numeric;
 -- Detect any unexpected writer divergence before creating the journal.
 if exists(select 1 from public.stock s join (select (payload->>'item_id')::uuid item_id,sum((payload->>'base_qty')::numeric) expected_qty from public.import_run_rows where run_id=p_run_id and status='posted' group by 1) expected on expected.item_id=s.item_id where s.warehouse_id=(p->>'warehouse_id')::uuid and s.qty<>expected.expected_qty)
 or (select coalesce(sum(qty_in*unit_cost),0) from public.stock_layers where source='saldo-awal-accurate' and source_ref=p_run_id::text)<>amount
 or (select count(*) from public.stock_moves where source='saldo-awal-accurate' and source_ref=p_run_id::text)<>(p->>'selected_rows')::int then
  raise exception 'Bukti posting stok tidak cocok';end if;
 no:=public.sales_next_number('JRN',(p->>'as_of')::date);
 insert into public.journal_entries(id,no_jurnal,tanggal,deskripsi,source,source_ref,branch_id)
 values(j,no,(p->>'as_of')::date,'Persediaan awal Accurate: '||(p->>'source_name'),'accurate-stock-opening',p_run_id::text,(p->>'branch_id')::uuid);
 insert into public.journal_lines(entry_id,account_id,debit,credit) values
 (j,(p#>>'{inventory_account,id}')::uuid,amount,0),(j,p_equity_account_id,0,amount);
 if (select sum(debit-credit) from public.journal_lines where entry_id=j)<>0 or (select sum(debit) from public.journal_lines where entry_id=j)<>amount then raise exception 'Jurnal tidak seimbang';end if;
 result:=jsonb_build_object('run_id',p_run_id,'entry_id',j,'no_jurnal',no,'amount',amount,'branch_id',p->>'branch_id','as_of',p->>'as_of');
 insert into public.accurate_inventory_accounting(run_id,entry_id,actor_id,equity_account_id,reason,preview,result) values(p_run_id,j,auth.uid(),p_equity_account_id,btrim(p_reason),p,result);
 return result;
end $$;

-- Protect provenance/receipt and both journal sides from direct Data API edits.
create function public.guard_accurate_inventory_accounting() returns trigger language plpgsql security definer set search_path='' as $$
declare entry uuid; run uuid; src text; code text; protected_old boolean:=false; protected_new boolean:=false;begin
 if tg_table_name='accurate_inventory_accounting' then raise exception 'Audit persediaan awal tidak dapat diubah' using errcode='42501';end if;
 if tg_table_name in ('stock_moves','stock_layers') then
  if tg_op<>'INSERT' then
   protected_old:=old.source='saldo-awal-accurate' and exists(select 1 from public.accurate_inventory_accounting where run_id::text=old.source_ref);
  end if;
  if tg_op<>'DELETE' then
   protected_new:=new.source='saldo-awal-accurate' and exists(select 1 from public.accurate_inventory_accounting where run_id::text=new.source_ref);
  end if;
  if protected_old or protected_new then
   if tg_table_name='stock_layers' and tg_op='UPDATE' then
    if protected_old and (to_jsonb(new)-'qty_left')=(to_jsonb(old)-'qty_left') and new.qty_left<=new.qty_in then return new;end if;
   end if;
   raise exception 'Dasar stok/layer persediaan awal terkunci; konsumsi FIFO tetap diizinkan' using errcode='42501';
  end if;
  return coalesce(new,old);
 end if;
 if tg_table_name='import_run_rows' then run:=old.run_id;
  if tg_op='INSERT' then run:=new.run_id;end if;
 elsif tg_table_name='import_runs' then run:=old.id;
 elsif tg_table_name='journal_entries' then
  entry:=old.id;if tg_op='INSERT' then entry:=new.id;end if;
  if tg_op='UPDATE' and new.source='saldo-awal' and exists(select 1 from public.accurate_inventory_accounting)
   and exists(select 1 from public.journal_lines l join public.coa_accounts c on c.id=l.account_id where l.entry_id=new.id and c.code='1301') then
   raise exception 'Saldo awal global persediaan diblokir setelah bridge' using errcode='42501';end if;
 elsif tg_table_name='journal_lines' then
  entry:=old.entry_id;if tg_op='INSERT' then entry:=new.entry_id;end if;
  select j.source into src from public.journal_entries j where j.id=coalesce(new.entry_id,old.entry_id);
  select c.code into code from public.coa_accounts c where c.id=coalesce(new.account_id,old.account_id);
  if tg_op<>'DELETE' and src='saldo-awal' and code='1301' and exists(select 1 from public.accurate_inventory_accounting) then
   raise exception 'Persediaan Accurate sudah dijurnal per batch; saldo awal global persediaan diblokir' using errcode='42501';end if;
 end if;
 if run is not null and exists(select 1 from public.accurate_inventory_accounting where run_id=run) then
  raise exception 'Provenance persediaan awal terkunci' using errcode='42501';end if;
 if entry is not null and exists(select 1 from public.accurate_inventory_accounting where entry_id=entry) then
  raise exception 'Jurnal persediaan awal terkunci' using errcode='42501';end if;
 if tg_table_name='import_run_rows' and tg_op='UPDATE' then
  if exists(select 1 from public.accurate_inventory_accounting where run_id=new.run_id) then
   raise exception 'Provenance persediaan awal terkunci' using errcode='42501';end if;
 end if;
 if tg_table_name='journal_lines' and tg_op='UPDATE' then
  if exists(select 1 from public.accurate_inventory_accounting where entry_id=new.entry_id) then
   raise exception 'Jurnal persediaan awal terkunci' using errcode='42501';end if;
 end if;
 return coalesce(new,old);
end $$;
create trigger accurate_inventory_move_basis_guard before insert or update or delete on public.stock_moves for each row execute function public.guard_accurate_inventory_accounting();
create trigger accurate_inventory_layer_basis_guard before insert or update or delete on public.stock_layers for each row execute function public.guard_accurate_inventory_accounting();
create trigger accurate_inventory_receipt_guard before update or delete on public.accurate_inventory_accounting for each row execute function public.guard_accurate_inventory_accounting();
create trigger accurate_inventory_run_guard before update or delete on public.import_runs for each row execute function public.guard_accurate_inventory_accounting();
create trigger accurate_inventory_row_guard before insert or update or delete on public.import_run_rows for each row execute function public.guard_accurate_inventory_accounting();
create trigger accurate_inventory_journal_guard before update or delete on public.journal_entries for each row execute function public.guard_accurate_inventory_accounting();
create trigger accurate_inventory_line_guard before insert or update or delete on public.journal_lines for each row execute function public.guard_accurate_inventory_accounting();

-- Only the owner of the definer posting function may create this source; no caller flag.
create function public.guard_accurate_inventory_source() returns trigger language plpgsql set search_path='' as $$
begin
 if new.source='accurate-stock-opening' and current_user<>pg_get_userbyid((select proowner from pg_proc where oid='public.post_accurate_inventory_accounting(uuid,uuid,jsonb,text)'::regprocedure)) then
 raise exception 'Sumber jurnal khusus bridge persediaan' using errcode='42501';end if;
 return new;
end $$;
create trigger accurate_inventory_source_guard before insert or update on public.journal_entries for each row execute function public.guard_accurate_inventory_source();
revoke all on function public.preview_accurate_inventory_accounting(uuid,uuid),public.post_accurate_inventory_accounting(uuid,uuid,jsonb,text),public.guard_accurate_inventory_accounting(),public.guard_accurate_inventory_source() from public,anon,authenticated,service_role;
grant execute on function public.preview_accurate_inventory_accounting(uuid,uuid),public.post_accurate_inventory_accounting(uuid,uuid,jsonb,text) to authenticated;
