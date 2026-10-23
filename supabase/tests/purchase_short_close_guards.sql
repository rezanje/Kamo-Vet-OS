-- Runner prepends genuine fictional partial-receipt fixture from purchase_short_close.sql.
do $$declare expected jsonb;blocked boolean;before_journals bigint;before_stock numeric;proof jsonb;begin
 expected:=jsonb_build_array(jsonb_build_object('id',md5('p07-line')::uuid,'qty',10,'qty_terima',5,'qty_rusak',0,'satuan','pcs','faktor',1));
 blocked:=false;begin perform close_purchase_order_remainder(md5('p07-po')::uuid,'unconfirmed',expected,'Supplier remainder unavailable',false);exception when sqlstate '22023'then blocked:=true;end;
 if not blocked then raise exception 'Close accepted without explicit confirmation';end if;
 blocked:=false;begin perform close_purchase_order_remainder(md5('p07-po')::uuid,'stale',jsonb_set(expected,'{0,qty_terima}','4'),'Supplier remainder unavailable',true);exception when sqlstate '40001'then blocked:=true;end;
 if not blocked then raise exception 'Close silently accepted a stale receipt snapshot';end if;
 blocked:=false;begin perform close_purchase_order_remainder(md5('p07-po')::uuid,'duplicate',expected||expected,'Supplier remainder unavailable',true);exception when sqlstate '22023'then blocked:=true;end;
 if not blocked then raise exception 'Close accepted duplicate rows';end if;
 perform set_config('request.jwt.claim.sub',md5('p07-staff')::uuid::text,true);blocked:=false;
 begin perform close_purchase_order_remainder(md5('p07-po')::uuid,'staff',expected,'Supplier remainder unavailable',true);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Ordinary receiver short-closed PO';end if;
 blocked:=false;begin perform get_purchase_order_short_close(md5('p07-po')::uuid,'p07-close');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Ordinary receiver recovered closure request';end if;
 perform set_config('request.jwt.claim.sub',md5('p07-owner')::uuid::text,true);
 perform set_config('request.headers',jsonb_build_object('x-kamo-operational-branch',md5('p07-other')::uuid)::text,true);blocked:=false;
 begin perform close_purchase_order_remainder(md5('p07-po')::uuid,'other-branch',expected,'Supplier remainder unavailable',true);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Close crossed selected operational branch';end if;
 perform set_config('request.headers','{}',true);
 if exists(select po_id from purchase_order_receipt_closures)or(select status from purchase_orders where id=md5('p07-po')::uuid)<>'Dipesan'then raise exception 'Rejected close left partial proof/lifecycle';end if;
end$$;
reset role;
-- Never-received lines must remain unbillable when the final lifecycle is set.
insert into purchase_order_items(id,po_id,item_id,nama,qty,harga_beli,satuan,faktor)values(md5('p07-never-received')::uuid,md5('p07-po')::uuid,md5('p07-item')::uuid,'Fiction undelivered item',3,100,'pcs',1);
update purchase_orders set total=1300 where id=md5('p07-po')::uuid;
create function pg_temp.p07_fail_audit()returns trigger language plpgsql as $$begin
 if new.row_entity='purchase_orders'and new.row_id=md5('p07-po')::uuid::text and new.after_state->>'status'='Diterima'then raise exception 'Fiction P07 audit failure';end if;return new;end$$;
create trigger p07_audit_failure before insert on activity_log for each row execute function pg_temp.p07_fail_audit();
set local role authenticated;
do $$declare expected jsonb;proof jsonb;blocked boolean:=false;before_audit bigint;begin
 select jsonb_agg(jsonb_build_object('id',id,'qty',qty,'qty_terima',coalesce(qty_terima,0),'qty_rusak',coalesce(qty_rusak,0),'satuan',satuan,'faktor',faktor)order by id)into expected from purchase_order_items where po_id=md5('p07-po')::uuid;
 select count(*)into before_audit from activity_log;
 begin perform close_purchase_order_remainder(md5('p07-po')::uuid,'p07-null-close',expected,'Supplier remainder unavailable',true);exception when others then if sqlerrm<>'Fiction P07 audit failure'then raise;end if;blocked:=true;end;
 if not blocked or exists(select po_id from purchase_order_receipt_closures)or(select status from purchase_orders where id=md5('p07-po')::uuid)<>'Dipesan'or(select qty_terima from purchase_order_items where id=md5('p07-never-received')::uuid)is not null or(select count(*)from activity_log)<>before_audit then raise exception 'Audit failure leaked closure proof/zero-normalization/status/audit';end if;
end$$;
reset role;drop trigger p07_audit_failure on activity_log;set local role authenticated;
do $$declare expected jsonb;proof jsonb;blocked boolean:=false;begin
 select jsonb_agg(jsonb_build_object('id',id,'qty',qty,'qty_terima',coalesce(qty_terima,0),'qty_rusak',coalesce(qty_rusak,0),'satuan',satuan,'faktor',faktor)order by id)into expected from purchase_order_items where po_id=md5('p07-po')::uuid;
 proof:=close_purchase_order_remainder(md5('p07-po')::uuid,'p07-null-close',expected,'Supplier remainder unavailable',true);
 if get_purchase_order_short_close(md5('p07-po')::uuid,'p07-null-close')is distinct from proof then raise exception 'Lost-response recovery changed the proof';end if;
 if close_purchase_order_remainder(md5('p07-po')::uuid,'p07-null-close',expected,'Supplier remainder unavailable',true)is distinct from proof then raise exception 'Null-line normalization broke identical retry';end if;
 if(select qty_terima from purchase_order_items where id=md5('p07-never-received')::uuid)is distinct from 0::numeric then raise exception 'Unreceived line retained billable legacy NULL fallback';end if;
 if not exists(select 1 from jsonb_array_elements(proof->'lines')x where x->>'id'=md5('p07-never-received')::uuid::text and x->>'received_was_null'='true'and(x->>'closed_qty')::numeric=3)then raise exception 'Original neverreceived state/remainder missing from proof';end if;
 begin perform create_purchase_invoice_from_po(md5('p07-po')::uuid,'FB.P07.',5,null,current_date,current_date+30,null,jsonb_build_array(jsonb_build_object('po_item_id',md5('p07-never-received')::uuid,'qty',1,'harga',100)),'[]','[]',0,'p07-fake-invoice');exception when others then blocked:=true;end;
 if not blocked or exists(select 1 from purchase_invoices)then raise exception 'Unreceived row was invoiced';end if;
 blocked:=false;begin perform close_purchase_order_remainder(md5('p07-po')::uuid,'p07-null-close',expected,'Changed reason',true);exception when sqlstate '22023'then blocked:=true;end;
 if not blocked then raise exception 'Request key reused with changed close reason';end if;
end$$;
-- Table writer privileges and immutable proof protect direct tampering too.
do $$declare blocked boolean:=false;begin
 begin perform payload from purchase_order_receipt_closures;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Private close request payload exposed';end if;
end$$;
reset role;
do $$declare blocked boolean:=false;begin
 begin update purchase_order_receipt_closures set reason='Tampered';exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Privileged write rewrote immutable close proof';end if;
 blocked:=false;begin delete from purchase_order_receipt_closures;exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Immutable close proof deleted';end if;
end$$;
rollback;
