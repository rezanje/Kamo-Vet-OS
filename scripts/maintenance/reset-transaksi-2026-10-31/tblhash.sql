select json_agg(json_build_array(t,n,h) order by t) from (
select format('%I.%I',n.nspname,c.relname) t,
 (xpath('/row/n/text()',query_to_xml(format('select count(*) n from %I.%I',n.nspname,c.relname),false,true,'')))[1]::text::bigint n,
 (xpath('/row/h/text()',query_to_xml(format('select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'','' order by md5(to_jsonb(t)::text)),'''')) h from %I.%I t',n.nspname,c.relname),false,true,'')))[1]::text h
from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','clinic_private','kamo_import')) s
