-- U11: fictional isolated fixture; every row rolls back.
begin;
insert into auth.users(id)values(md5('u11-owner')::uuid),(md5('u11-admin')::uuid),(md5('u11-finance')::uuid),(md5('u11-owner-off')::uuid);
insert into profiles(id,full_name,role,is_active)values
 (md5('u11-owner')::uuid,'Fiction owner','OWNER',true),(md5('u11-admin')::uuid,'Fiction admin','ADMIN',true),
 (md5('u11-finance')::uuid,'Fiction finance','FINANCE',true),(md5('u11-owner-off')::uuid,'Fiction inactive owner','OWNER',false)
on conflict(id)do update set full_name=excluded.full_name,role=excluded.role,is_active=excluded.is_active;
insert into branches(id,code,name,type)values(md5('u11-existing')::uuid,'U11-OLD','Fiction existing','PETSHOP');
set local role authenticated;set local request.jwt.claim.role='authenticated';

do $$declare blocked boolean;created jsonb;
begin
 -- Non-owners and an inactive owner are refused by the database itself.
 foreach created in array array[to_jsonb(md5('u11-admin')::uuid::text),to_jsonb(md5('u11-finance')::uuid::text),to_jsonb(md5('u11-owner-off')::uuid::text)] loop
  perform set_config('request.jwt.claim.sub',created#>>'{}',true);
  blocked:=false;begin perform create_branch('U11-X','Fiction blocked','KLINIK',true);exception when insufficient_privilege then blocked:=true;end;
  if not blocked then raise exception 'Non-owner created a branch: %',created;end if;
  -- No INSERT policy: direct REST-style insert stays denied for every role.
  blocked:=false;begin insert into branches(code,name,type)values('U11-D','Direct insert','KLINIK');exception when insufficient_privilege then blocked:=true;end;
  if not blocked then raise exception 'Direct branch insert accepted';end if;
 end loop;

 perform set_config('request.jwt.claim.sub',md5('u11-owner')::uuid::text,true);
 blocked:=false;begin insert into branches(code,name,type)values('U11-D','Direct insert','KLINIK');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Owner direct insert bypassed the RPC';end if;

 -- Input guards.
 blocked:=false;begin perform create_branch('','Fiction','KLINIK',true);exception when sqlstate '22023' then blocked:=true;end;
 if not blocked then raise exception 'Empty code accepted';end if;
 blocked:=false;begin perform create_branch('ABCDEFGHIJKLMNOP','Fiction','KLINIK',true);exception when sqlstate '22023' then blocked:=true;end;
 if not blocked then raise exception '16-char code accepted';end if;
 blocked:=false;begin perform create_branch('U11-N','x','KLINIK',true);exception when sqlstate '22023' then blocked:=true;end;
 if not blocked then raise exception 'One-char name accepted';end if;
 blocked:=false;begin perform create_branch('U11-T','Fiction','MALL',true);exception when sqlstate '22023' then blocked:=true;end;
 if not blocked then raise exception 'Unknown type accepted';end if;
 blocked:=false;begin perform create_branch('U11-S','Fiction',  'KLINIK',null);exception when sqlstate '22023' then blocked:=true;end;
 if not blocked then raise exception 'Null status accepted';end if;
 blocked:=false;begin perform create_branch('u11-old','Fiction duplicate','KLINIK',true);exception when sqlstate '23505' then blocked:=true;end;
 if not blocked then raise exception 'Case-insensitive duplicate code accepted';end if;

 -- Owner creates active and inactive branches with every chosen field stored.
 created:=create_branch('  U11-NEW ','  Fiction new branch ','BOTH',true);
 if not exists(select 1 from branches where id=(created->>'id')::uuid and code='U11-NEW' and name='Fiction new branch' and type='BOTH' and is_active)
  then raise exception 'Created branch fields wrong: %',created;end if;
 created:=create_branch('U11-OFF','Fiction inactive branch','KLINIK',false);
 if (select is_active from branches where id=(created->>'id')::uuid) then raise exception 'Inactive status ignored';end if;

 -- The warehouse form reads active branches: the new active branch is selectable, and a warehouse can be attached.
 perform set_config('request.jwt.claim.sub',md5('u11-admin')::uuid::text,true);
 if not exists(select 1 from branches where code='U11-NEW' and is_active) then raise exception 'New branch not visible to warehouse form';end if;
 if exists(select 1 from branches where code='U11-OFF' and is_active) then raise exception 'Inactive branch offered to warehouse form';end if;
end$$;
reset role;
insert into warehouses(branch_id,code,name,type)select id,'U11-W','Fiction new warehouse','VET' from branches where code='U11-NEW';
-- The case-insensitive unique index holds for every write path, not only the RPC.
do $$declare blocked boolean:=false;begin
 begin insert into branches(code,name,type)values('u11-new','Fiction case duplicate','KLINIK');exception when unique_violation then blocked:=true;end;
 if not blocked then raise exception 'Case-duplicate branch code accepted by the table';end if;
end$$;
rollback;
