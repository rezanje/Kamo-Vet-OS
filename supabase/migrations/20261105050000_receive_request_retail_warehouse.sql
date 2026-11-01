-- Receipt destination only. No stock/history repair and no change to POS readers.
-- Fail closed on function drift; CREATE OR REPLACE retains owner and existing ACL.
do $patch$
declare
 v_definition text := pg_get_functiondef('public.receive_stock_request_atomic(uuid,uuid,jsonb)'::regprocedure);
 v_anchor constant text := $anchor$select id into v_wh from warehouses where branch_id=p_branch_id and is_active and type<>'TRANSIT' order by code,id limit 1;$anchor$;
 v_selector constant text := $replacement$if exists(select 1 from branches where id=p_branch_id and type='PETSHOP') then
  select case when count(*)=1 then (array_agg(id))[1] else null end into v_wh
  from warehouses where branch_id=p_branch_id and is_active and type='RETAIL';
  if v_wh is null then raise exception 'Cabang PETSHOP harus memiliki tepat satu gudang RETAIL aktif untuk penerimaan'; end if;
 else
  select id into v_wh from warehouses where branch_id=p_branch_id and is_active and type<>'TRANSIT' order by code,id limit 1;
 end if;$replacement$;
begin
 if encode(sha256(convert_to(v_definition,'UTF8')),'hex') <> '8021e3a46592957c412986a0fd5679450027fdac4877442323033f4353588ee0'
    or (length(v_definition)-length(replace(v_definition,v_anchor,''))) / length(v_anchor) <> 1 then
  raise exception 'receive_stock_request_atomic definition drift: receipt destination patch not applied';
 end if;
 execute replace(v_definition,v_anchor,v_selector);
end
$patch$;
