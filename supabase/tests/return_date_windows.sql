-- Existing return contract: restate the original OPEN date, retaining actual
-- correction time in audit. This is distinct from a current-date invoice reversal.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $$declare
 return_kind text;source uuid;source_line uuid;event_date date;dates date[]:=array[current_date-1,date_trunc('year',current_date)::date-1];
 original jsonb;changed jsonb;cancelled jsonb;input jsonb;new_no text;audit uuid;entry_ids uuid[];net numeric;expected numeric;
begin
 foreach return_kind in array array['sales','purchase'] loop
  source:=case when return_kind='sales' then 'f6000000-0000-4000-8000-000000000011' else 'f6000000-0000-4000-8000-000000000010' end;
  source_line:=case when return_kind='sales' then 'f7000000-0000-4000-8000-000000000020' else 'f7000000-0000-4000-8000-000000000010' end;
  expected:=case when return_kind='sales' then 18 else 20 end;
  foreach event_date in array dates loop
   input:=jsonb_build_array(jsonb_build_object('source_line_id',source_line,'item_id','f5000000-0000-4000-8000-000000000001','qty',3,'satuan','pcs','kondisi','baik'));
   original:=post_unit_return(return_kind,source,'date-create:'||return_kind||':'||event_date,jsonb_build_object('tanggal',event_date),input);
   changed:=correct_return_record(return_kind,(original->>'document_id')::uuid,0,'date-edit:'||return_kind||':'||event_date,'Actual quantity is two','TEST physical evidence confirms two original units',jsonb_set(input,'{0,qty}','2'));
   audit:=(changed->>'audit_id')::uuid;
   new_no:=changed->>'replacement_no';
   select array_agg((j->>'id')::uuid) into entry_ids from public.return_record_postings rp cross join lateral jsonb_array_elements(rp.snapshot->'journals')j
    where rp.kind=return_kind and rp.return_id in((original->>'document_id')::uuid,(changed->>'replacement_id')::uuid);
   entry_ids:=entry_ids||(select reversal_journal_ids from return_record_corrections where id=audit);
   if exists(select 1 from journal_entries where id=any(entry_ids) and tanggal<>event_date) then raise exception 'Journal restatement crossed date/year bucket';end if;
   select coalesce(sum(l.debit-l.credit),0) into net from journal_entries e join journal_lines l on l.entry_id=e.id join coa_accounts a on a.id=l.account_id
    where e.id=any(entry_ids) and e.tanggal<=event_date and a.code=case when return_kind='sales' then '1101' else '2101' end;
   if net<>(case when return_kind='sales' then -expected else expected end) then raise exception 'Dated financial net % differs from replacement %',net,expected;end if;
   if exists(select 1 from journal_entries where id=any(entry_ids) and tanggal>event_date) then raise exception 'Artificial correction-day financial movement';end if;
   select coalesce(sum(qty),0) into net from stock_moves where source_ref in(original->>'document_no',new_no,audit::text) and tanggal<=event_date;
   if net<>(case when return_kind='sales' then 2 else -2 end) then raise exception 'Stock as-of original date differs from actual quantity';end if;
   if exists(select 1 from stock_moves where source_ref in(original->>'document_no',new_no,audit::text) and tanggal>event_date) then raise exception 'Artificial correction-day stock movement';end if;
   if not exists(select 1 from return_record_corrections where id=audit and (created_at at time zone 'Asia/Jakarta')::date=(now() at time zone 'Asia/Jakarta')::date
    and before_value->'header'->>'tanggal'=event_date::text) then raise exception 'Historical original or actual audit time lost';end if;
   if event_date<date_trunc('year',current_date)::date and exists(select 1 from journal_entries where id=any(entry_ids) and tanggal>=date_trunc('year',current_date)::date) then raise exception 'Prior-year return correction leaked into current-year financial movement';end if;
   cancelled:=correct_return_record(return_kind,(changed->>'replacement_id')::uuid,0,'date-void:'||return_kind||':'||event_date,'No actual return occurred','TEST evidence confirms zero physical returned units','[]');
   entry_ids:=entry_ids||(select reversal_journal_ids from return_record_corrections where id=(cancelled->>'audit_id')::uuid);
   select coalesce(sum(l.debit-l.credit),0) into net from journal_entries e join journal_lines l on l.entry_id=e.id join coa_accounts a on a.id=l.account_id
    where e.id=any(entry_ids) and e.tanggal<=event_date and a.code=case when return_kind='sales' then '1101' else '2101' end;
   if net<>0 then raise exception 'Cancellation did not net original date/year to zero';end if;
  end loop;
 end loop;
end$$;
rollback;

-- Prior-year restatement is prohibited once that original year is closed.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
create temporary table closed_year_result(result jsonb);
insert into closed_year_result select post_unit_return('sales','f6000000-0000-4000-8000-000000000011','closed-year-create',jsonb_build_object('tanggal',date_trunc('year',current_date)::date-1),'[{"source_line_id":"f7000000-0000-4000-8000-000000000020","item_id":"f5000000-0000-4000-8000-000000000001","qty":1,"satuan":"pcs","kondisi":"baik"}]');
reset role;
update accounting_locks set closed_until=date_trunc('year',current_date)::date-1;
set local role authenticated;
do $$begin
 begin
  perform correct_return_record('sales',(result->>'document_id')::uuid,0,'closed-year-edit','Wrong count','TEST verified zero physical return','[]') from closed_year_result;
 exception when raise_exception then if position('ditutup' in sqlerrm)>0 then return;end if;raise;
 end;
 raise exception 'Closed original year was restated';
end$$;
rollback;
