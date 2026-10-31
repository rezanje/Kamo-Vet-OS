create temp table del(tbl text, id uuid);
\copy del from '/tmp/claude-0/-home-user-Kamo-Vet-OS/8951f758-6e5a-530d-9f68-09d7403b622a/scratchpad/deleted_ids.csv' csv
create index on del(id);
create temp table hits(src text, col text, tbl text, n bigint);
do $$ declare r record; begin
 for r in select table_schema s, table_name t, column_name c, udt_name u from information_schema.columns
  where table_schema in ('public','clinic_private','kamo_import') and table_name<>all(current_setting('kr.reset')::text[])
   and table_name not in ('activity_log','inpatient_bill_pay_requests','inpatient_cashier_requests','posting_ctx')
   and udt_name in ('uuid','_uuid','jsonb') loop
  if r.u='uuid' then
   execute format('insert into hits select %L,%L,d.tbl,count(*) from %I.%I x join del d on d.id=x.%I group by d.tbl',r.s||'.'||r.t,r.c,r.s,r.t,r.c);
  elsif r.u='_uuid' then
   execute format('insert into hits select %L,%L,d.tbl,count(*) from %I.%I x cross join unnest(x.%I) v join del d on d.id=v group by d.tbl',r.s||'.'||r.t,r.c,r.s,r.t,r.c);
  else
   execute format('insert into hits select %L,%L,d.tbl,count(*) from %I.%I x cross join lateral regexp_matches(x.%I::text,''[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'',''g'') m join del d on d.id=m[1]::uuid group by d.tbl',r.s||'.'||r.t,r.c,r.s,r.t,r.c);
  end if;
 end loop; end $$;
select src||'.'||col||' -> '||tbl||' : '||n from hits order by 1;
