-- I06: terminal, traceable cancellation of untouched stock-opname drafts only.
alter type public.opname_status add value if not exists 'Batal';
alter table public.opname_orders
 add column cancelled_at timestamptz,
 add column cancelled_by uuid,
 add column cancelled_by_name text,
 add column cancel_reason text;
alter table public.opname_orders add constraint opname_cancel_evidence check(
 (status::text='Batal' and cancelled_at is not null and cancelled_by is not null and cancelled_by_name is not null and nullif(btrim(cancel_reason),'') is not null)
 or (status::text<>'Batal' and cancelled_at is null and cancelled_by is null and cancelled_by_name is null and cancel_reason is null));

create function public.opname_draft_block_reason(p_id uuid,p_ref text) returns text
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.opname_counts where order_id=p_id) then return 'Sudah ada hitungan terkunci. Pembatalan draf ditolak; periksa hitungan yang sudah disimpan.';end if;
 if exists(select 1 from public.opname_results where order_id=p_id) then return 'Sudah ada hasil atau proses posting opname. Pembatalan draf ditolak; gunakan pemeriksaan hasil asal.';end if;
 if exists(select 1 from public.stock_moves where source='opname' and source_ref in(p_ref,p_id::text))
 or exists(select 1 from public.stock_layers where source='opname' and source_ref in(p_ref,p_id::text))
 or exists(select 1 from public.journal_entries where source='opname' and source_ref in(p_ref,p_id::text))
 or exists(select 1 from public.stock_document_issue_proofs where kind='opname' and source_document->>'order_id'=p_id::text)
 or exists(select 1 from public.stock_document_corrections where kind='opname' and source_snapshot->'document'->>'order_id'=p_id::text) then
  return 'Sudah ada efek stok atau jurnal. Pembatalan draf ditolak; rekonsiliasi dokumen asal diperlukan.';
 end if;
 return null;
end$$;
revoke all on function public.opname_draft_block_reason(uuid,text) from public,anon,authenticated,service_role;

create function public.cancel_opname_draft(p_order_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();actor_name text;doc public.opname_orders%rowtype;branch uuid;blocked text;previous_context text;
begin
 if coalesce(auth.role(),'')<>'authenticated' or actor is null then raise exception 'Akses pembatalan opname ditolak' using errcode='42501';end if;
 select full_name into actor_name from public.profiles where id=actor and is_active for share;
 if not found then raise exception 'Akses pembatalan opname ditolak' using errcode='42501';end if;
 if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'Isi alasan pembatalan antara 3 dan 500 karakter';end if;
 select * into doc from public.opname_orders where id=p_order_id for update;
 if not found then raise exception 'Perintah opname tidak ditemukan atau tidak dapat diakses' using errcode='42501';end if;
 select branch_id into branch from public.warehouses where id=doc.warehouse_id for share;
 if not found or not public.user_can_access_branch(branch) then raise exception 'Perintah opname tidak ditemukan atau tidak dapat diakses' using errcode='42501';end if;
 -- Same existing backoffice module OR cashier's own open petshop shift.
 begin
  perform public.stock_document_access(branch,'pos');
 exception when raise_exception then
  if not exists(select 1 from public.cashier_shifts where opened_by=actor and branch_id=branch and status='open' and shift_type='petshop') then
   raise exception 'Akses pembatalan opname ditolak' using errcode='42501';
  end if;
 end;
 if doc.status::text='Batal' then return;end if; -- Retry keeps original actor/reason/time and one audit event.
 if doc.status::text<>'Terbuka' then raise exception 'OPNAME_NOT_DRAFT: Opname sudah selesai. Pembatalan draf ditolak; periksa hasil asal.';end if;
 blocked:=public.opname_draft_block_reason(doc.id,doc.no_opname);
 if blocked is not null then raise exception 'OPNAME_NOT_DRAFT: %',blocked;end if;
 previous_context:=current_setting('kamo.opname_cancel',true);
 perform set_config('kamo.opname_cancel',doc.id::text,true);
 update public.opname_orders set status='Batal',cancelled_at=clock_timestamp(),cancelled_by=actor,
  cancelled_by_name=coalesce(nullif(actor_name,''),actor::text),cancel_reason=btrim(p_reason) where id=doc.id;
 perform set_config('kamo.opname_cancel',coalesce(previous_context,''),true);
end$$;
revoke all on function public.cancel_opname_draft(uuid,text) from public,anon,service_role;
grant execute on function public.cancel_opname_draft(uuid,text) to authenticated;

create function public.guard_opname_cancellation() returns trigger
language plpgsql set search_path='' as $$
declare permitted boolean;
begin
 if tg_op='DELETE' then
  if current_user in('authenticated','anon','service_role') then raise exception 'Perintah opname tidak boleh dihapus langsung. Gunakan Batalkan draf agar riwayat tetap tersimpan.';end if;
  return old;
 end if;
 if tg_op='INSERT' then
  if new.status::text='Batal' or new.cancelled_at is not null or new.cancelled_by is not null or new.cancelled_by_name is not null or new.cancel_reason is not null then raise exception 'Bukti pembatalan hanya boleh dibuat melalui Batalkan draf';end if;
  return new;
 end if;
 if old.status::text='Batal' then
  if new is distinct from old then raise exception 'Pembatalan opname bersifat tetap; riwayat tidak boleh diubah atau dibuka kembali';end if;
  return new;
 end if;
 if new.status::text='Batal' or row(new.cancelled_at,new.cancelled_by,new.cancelled_by_name,new.cancel_reason) is distinct from row(old.cancelled_at,old.cancelled_by,old.cancelled_by_name,old.cancel_reason) then
  permitted:=current_user=pg_get_userbyid((select proowner from pg_catalog.pg_proc where oid='public.cancel_opname_draft(uuid,text)'::regprocedure))
   and current_setting('kamo.opname_cancel',true)=old.id::text;
  if not coalesce(permitted,false) then raise exception 'Bukti pembatalan hanya boleh dibuat melalui Batalkan draf';end if;
 end if;
 return new;
end$$;
revoke all on function public.guard_opname_cancellation() from public,anon,authenticated,service_role;
create trigger guard_opname_cancellation before insert or update or delete on public.opname_orders
 for each row execute function public.guard_opname_cancellation();

-- Separate definer read fence: the cancellation proof fence above must stay invoker.
create function public.guard_opname_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare blocked text;
begin
 if row(new.id,new.no_opname,new.warehouse_id) is distinct from row(old.id,old.no_opname,old.warehouse_id) then
  blocked:=public.opname_draft_block_reason(old.id,old.no_opname);
  if blocked is not null then raise exception 'Identitas opname sudah memiliki hitungan atau efek tersimpan dan tidak boleh dipindahkan';end if;
 end if;
 return new;
end$$;
revoke all on function public.guard_opname_identity() from public,anon,authenticated,service_role;
create trigger guard_opname_identity before update of id,no_opname,warehouse_id on public.opname_orders
 for each row execute function public.guard_opname_identity();

create function public.guard_cancelled_opname_children() returns trigger
language plpgsql security definer set search_path='' as $$
declare refs uuid[];parent record;old_row jsonb:='{}';new_row jsonb:='{}';
begin
 if tg_op<>'INSERT' then old_row:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then new_row:=to_jsonb(new);end if;
 if tg_table_name='opname_result_items' then
  select array_agg(distinct order_id) into refs from public.opname_results where id in(nullif(old_row->>'result_id','')::uuid,nullif(new_row->>'result_id','')::uuid);
 else refs:=array[nullif(old_row->>'order_id','')::uuid,nullif(new_row->>'order_id','')::uuid];end if;
 for parent in select id,status from public.opname_orders where id=any(refs) order by id for update loop
  if parent.status::text='Batal' then raise exception 'Opname sudah dibatalkan. Hitungan, lingkup, dan posting baru ditolak.';end if;
 end loop;
 -- A partially posted result is the durable OPR -> order link. Keep it once effects exist.
 if tg_table_name='opname_results' and tg_op<>'INSERT' and
 (tg_op='DELETE' or row(old_row->>'id',old_row->>'no_hasil',old_row->>'order_id')
 is distinct from row(new_row->>'id',new_row->>'no_hasil',new_row->>'order_id')
 or (old_row->>'invoice_id' is not null and old_row->>'invoice_id' is distinct from new_row->>'invoice_id')) then
  if old_row->>'invoice_id' is not null
  or exists(select 1 from public.stock_moves where source='opname' and source_ref in(old_row->>'no_hasil',old_row->>'id'))
  or exists(select 1 from public.stock_layers where source='opname' and source_ref in(old_row->>'no_hasil',old_row->>'id'))
  or exists(select 1 from public.journal_entries where source='opname' and source_ref in(old_row->>'no_hasil',old_row->>'id'))
  or exists(select 1 from public.stock_document_issue_proofs where kind='opname' and document_id=(old_row->>'id')::uuid)
  or exists(select 1 from public.stock_document_corrections where kind='opname' and document_id=(old_row->>'id')::uuid) then
   raise exception 'Hasil opname sudah memiliki efek tersimpan; identitas dan hubungan asal tidak boleh dihapus atau dipindahkan';
  end if;
 end if;
 return coalesce(new,old);
end$$;
revoke all on function public.guard_cancelled_opname_children() from public,anon,authenticated,service_role;
do $$declare name text;begin
 foreach name in array array['opname_counts','opname_order_items','opname_results','opname_result_items'] loop
  execute format('create trigger opname_cancel_fence before insert or update or delete on public.%I for each row execute function public.guard_cancelled_opname_children()',name);
 end loop;
end$$;
-- Existing A01 capture already records the safe status transition and session actor.
-- Free-text reason/profile snapshot stay on the protected source, not copied to log payloads.

-- Resolve explicit stored provenance only; never match descriptions or guessed numbers.
create function public.opname_source_order_ids(p_ref text) returns uuid[]
language sql volatile security definer set search_path='' as $$
 select array_agg(distinct id) from (
  select id from public.opname_orders where no_opname=p_ref or id::text=p_ref
  union select order_id from public.opname_results where no_hasil=p_ref or id::text=p_ref
 ) linked
$$;
revoke all on function public.opname_source_order_ids(text) from public,anon,authenticated,service_role;
create function public.guard_cancelled_opname_effects() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_row jsonb:='{}';new_row jsonb:='{}';refs uuid[]:='{}';parent record;new_refs uuid[];
begin
 if tg_op<>'INSERT' then old_row:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then new_row:=to_jsonb(new);end if;
 -- FIFO consumption already has a persisted source layer. Do not invert its
 -- stock -> layer lock order against correction's parent -> stock order.
 if tg_table_name='stock_layers' and tg_op='UPDATE' and
 (new_row->>'qty_left')::numeric between 0 and (old_row->>'qty_left')::numeric and
 (new_row-'qty_left')=(old_row-'qty_left') then return new;end if;
 if old_row->>'source'='opname' then refs:=coalesce(public.opname_source_order_ids(old_row->>'source_ref'),'{}');end if;
 if new_row->>'source'='opname' then refs:=refs||coalesce(public.opname_source_order_ids(new_row->>'source_ref'),'{}');end if;
 for parent in select id,status from public.opname_orders where id=any(refs) order by id for update loop
  if parent.status::text='Batal' then raise exception 'Opname sudah dibatalkan. Efek stok atau jurnal baru ditolak.';end if;
 end loop;
 if new_row->>'source'='opname' and (tg_op='INSERT' or row(old_row->>'source',old_row->>'source_ref') is distinct from row(new_row->>'source',new_row->>'source_ref')) then
  -- Recheck after parent lock: a concurrent compensation may have removed the result.
  new_refs:=public.opname_source_order_ids(new_row->>'source_ref');
  if coalesce(cardinality(new_refs),0)=0 or not new_refs <@ refs then
   raise exception 'Sumber opname berubah atau tidak ditemukan; efek stok/jurnal ditolak';
  end if;
 end if;
 -- Existing orphan legacy layers can still be consumed; no invented parent linkage.
 return coalesce(new,old);
end$$;
revoke all on function public.guard_cancelled_opname_effects() from public,anon,authenticated,service_role;
do $$declare name text;begin
 foreach name in array array['stock_moves','stock_layers','journal_entries'] loop
  execute format('create trigger opname_cancel_effect_fence before insert or update or delete on public.%I for each row execute function public.guard_cancelled_opname_effects()',name);
 end loop;
end$$;
