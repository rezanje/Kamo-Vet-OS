-- Fictional isolated N02 acceptance. No source customer rows or target writes.
begin;
insert into auth.users(id)values(md5('n02-owner')::uuid),(md5('n02-staff')::uuid);
insert into profiles(id,role,is_active)values(md5('n02-owner')::uuid,'OWNER',true),(md5('n02-staff')::uuid,'STAFF',true)on conflict(id)do update set role=excluded.role,is_active=true;
insert into branches(id,code,name,type)values(md5('n02-a')::uuid,'N02A','Fiction branch A','KLINIK'),(md5('n02-b')::uuid,'N02B','Fiction branch B','KLINIK'),(md5('n02-blank')::uuid,' ','Fiction blank code','KLINIK'),(md5('n02-literal')::uuid,'N02_C','Fiction literal punctuation','KLINIK');
insert into warehouses(id,branch_id,code,name,type)values(md5('n02-wa')::uuid,md5('n02-a')::uuid,'N02WA','Fiction warehouse A','VET'),(md5('n02-wb')::uuid,md5('n02-b')::uuid,'N02WB','Fiction warehouse B','VET'),(md5('n02-wblank')::uuid,md5('n02-blank')::uuid,'N02WX','Fiction warehouse blank','VET'),(md5('n02-wliteral')::uuid,md5('n02-literal')::uuid,'N02WL','Fiction literal warehouse','VET');
insert into user_branches(user_id,branch_id)values(md5('n02-staff')::uuid,md5('n02-a')::uuid);
insert into purchase_orders(id,no_po,branch_id,to_warehouse_id,total,status)values(md5('n02-legacy')::uuid,'PO-OLD-0007',md5('n02-a')::uuid,md5('n02-wa')::uuid,100,'Draft');
insert into purchase_orders(no_po,branch_id,total,status)values('LIT.N02XC-9999',md5('n02-a')::uuid,100,'Draft');
-- fixture-end:
set local role authenticated;
set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',md5('n02-owner')::uuid::text,true);
do $$declare a jsonb;b jsonb;c jsonb;begin
 a:=create_purchase_order_atomic('n02-a1','N02.',4,null,md5('n02-wa')::uuid,md5('n02-a')::uuid,current_date,'[{"nama":"Fiction item","qty":1,"harga_beli":100}]');
 b:=create_purchase_order_atomic('n02-b1','N02.',4,null,md5('n02-wb')::uuid,md5('n02-b')::uuid,current_date,'[{"nama":"Fiction item","qty":1,"harga_beli":100}]');
 c:=create_purchase_order_atomic('n02-a2','N02.',4,null,md5('n02-wa')::uuid,md5('n02-a')::uuid,current_date,'[{"nama":"Fiction item","qty":1,"harga_beli":100}]');
 if a->>'no_po'<>'N02.N02A-0001'or b->>'no_po'<>'N02.N02B-0001'or c->>'no_po'<>'N02.N02A-0002'then raise exception 'N02 branch identity/independent sequence missing: %, %, %',a->>'no_po',b->>'no_po',c->>'no_po';end if;
 if a is distinct from create_purchase_order_atomic('n02-a1','DIFFERENT.',4,null,md5('n02-wa')::uuid,md5('n02-a')::uuid,current_date,'[{"nama":"Fiction item","qty":1,"harga_beli":100}]')then raise exception 'N02 exact retry changed receipt';end if;
end$$;
do $$declare a jsonb;begin
 a:=create_purchase_order_atomic('n02-underscore','LIT.',4,null,md5('n02-wliteral')::uuid,md5('n02-literal')::uuid,current_date,'[{"nama":"Fiction item","qty":1,"harga_beli":100}]');
 if a->>'no_po'<>'LIT.N02_C-0001'then raise exception 'N02 literal underscore rejected, renamed or treated as wildcard';end if;
end$$;
reset role;
update branches set code='N02%C'where id=md5('n02-literal')::uuid;
set local role authenticated;
do $$declare a jsonb;begin
 a:=create_purchase_order_atomic('n02-percent','LIT.',4,null,md5('n02-wliteral')::uuid,md5('n02-literal')::uuid,current_date,'[{"nama":"Fiction item","qty":1,"harga_beli":100}]');
 if a->>'no_po'<>'LIT.N02%C-0001'then raise exception 'N02 literal percent rejected, renamed or treated as wildcard';end if;
end$$;
reset role;
update branches set code='N02AX'where id=md5('n02-a')::uuid;
set local role authenticated;
do $$declare a jsonb;failed boolean;begin
 a:=create_purchase_order_atomic('n02-a1','N02.',4,null,md5('n02-wa')::uuid,md5('n02-a')::uuid,current_date,'[{"nama":"Fiction item","qty":1,"harga_beli":100}]');
 if a->>'no_po'<>'N02.N02A-0001'then raise exception 'N02 branch rename rewrote retry';end if;
 a:=create_purchase_order_atomic('n02-renamed','N02.',4,null,md5('n02-wa')::uuid,md5('n02-a')::uuid,current_date,'[{"nama":"Fiction item","qty":1,"harga_beli":100}]');
 if a->>'no_po'<>'N02.N02AX-0001'then raise exception 'N02 new request ignored current branch';end if;
 failed:=false;begin perform create_purchase_order_atomic('n02-blank','N02.',4,null,md5('n02-wblank')::uuid,md5('n02-blank')::uuid,current_date,'[{"nama":"Fiction item","qty":1,"harga_beli":100}]');exception when sqlstate '22023'then failed:=true;end;
 if not failed then raise exception 'N02 blank code accepted';end if;
 failed:=false;begin perform create_purchase_order_atomic('n02-long',repeat('X',24),4,null,md5('n02-wb')::uuid,md5('n02-b')::uuid,current_date,'[{"nama":"Fiction item","qty":1,"harga_beli":100}]');exception when sqlstate '22023'then failed:=true;end;
 if not failed then raise exception 'N02 expanded length overflow accepted';end if;
 failed:=false;begin perform create_purchase_order_atomic('n02-warehouse','N02.',4,null,md5('n02-wa')::uuid,md5('n02-b')::uuid,current_date,'[{"nama":"Fiction item","qty":1,"harga_beli":100}]');exception when others then if sqlerrm<>'Cabang atau gudang tujuan tidak aktif'then raise;end if;failed:=true;end;
 if not failed then raise exception 'N02 branch/warehouse mismatch accepted';end if;
end$$;
select set_config('request.jwt.claim.sub',md5('n02-staff')::uuid::text,true);
do $$declare failed boolean:=false;begin
 begin perform create_purchase_order_atomic('n02-denied','N02.',4,null,md5('n02-wb')::uuid,md5('n02-b')::uuid,current_date,'[{"nama":"Fiction item","qty":1,"harga_beli":100}]');exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'N02 unassigned branch accepted';end if;
end$$;
reset role;
create function public.qa_n02_audit_fail()returns trigger language plpgsql as $$begin if new.row_entity='purchase_orders'then raise exception 'fictional N02 audit failure';end if;return new;end$$;
create trigger qa_n02_audit_fail before insert on activity_log for each row execute function qa_n02_audit_fail();
set local role authenticated;
select set_config('request.jwt.claim.sub',md5('n02-owner')::uuid::text,true);
do $$declare failed boolean:=false;begin
 begin perform create_purchase_order_atomic('n02-audit','N02.',4,null,md5('n02-wb')::uuid,md5('n02-b')::uuid,current_date,'[{"nama":"Fiction item","qty":1,"harga_beli":100}]');exception when others then if sqlerrm<>'fictional N02 audit failure'then raise;end if;failed:=true;end;
 if not failed then raise exception 'N02 audit failure ignored';end if;
end$$;
reset role;
do $$begin
 if(select no_po from purchase_orders where id=md5('n02-legacy')::uuid)<>'PO-OLD-0007'then raise exception 'N02 historical number changed';end if;
 if(select count(*)from purchase_orders where no_po like 'N02.%')<>4 or(select count(*)from purchase_order_items where po_id in(select id from purchase_orders where no_po like 'N02.%'))<>4 then raise exception 'N02 failure left partial source';end if;
 if exists(select 1 from purchase_order_requests where request_key in('n02-blank','n02-long','n02-warehouse','n02-denied','n02-audit'))then raise exception 'N02 failed request persisted';end if;
end$$;
rollback;
