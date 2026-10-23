-- Runner prepends original fictional clinic_invoice_post.sql fixture prefix.
create function pg_temp.fail_checkout_audit()returns trigger language plpgsql as $$begin
 if new.row_entity='visit_operational_events'then raise exception 'Integration checkout audit failure';end if;return new;end$$;
create trigger integration_checkout_audit_failure before insert on activity_log for each row execute function pg_temp.fail_checkout_audit();
set local role authenticated;set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
do $$declare before_state jsonb;before_status public.visit_status;n bigint;blocked boolean:=false;begin
 before_state:=test_clinic_invoice_state();select status into before_status from visits where id='d6000000-0000-4000-8000-000000000002';perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);select count(*)into n from activity_log;perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
 begin perform clinic_post_invoice('d6000000-0000-4000-8000-000000000002','integration-clinic',jsonb_build_object('tanggal',current_date,'subtotal',10,'discount',0,'tax',0,'total',10,'dp_amount',0,'paid_status','Lunas','metode_bayar','Tunai','shift_id','da000000-0000-4000-8000-000000000001'),'[{"description":"Fiction integration care","qty":1,"price":10,"kind":"jasa","item_id":null,"discount_percent":0}]');
 exception when others then if sqlerrm<>'Integration checkout audit failure'then raise;end if;blocked:=true;end;
 perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
 if not blocked or test_clinic_invoice_state()<>before_state or(select status from visits where id='d6000000-0000-4000-8000-000000000002')is distinct from before_status or(select count(*)from activity_log)<>n then raise exception 'Checkout audit failure leaked invoice/stock/journal/visit/audit';end if;
 perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
end$$;
reset role;drop trigger integration_checkout_audit_failure on activity_log;set local role authenticated;
do $$declare invoice uuid;retry uuid;n bigint;plan jsonb;lines jsonb;begin
 plan:=jsonb_build_object('tanggal',current_date,'subtotal',10,'discount',0,'tax',0,'total',10,'dp_amount',0,'paid_status','Lunas','metode_bayar','Tunai','shift_id','da000000-0000-4000-8000-000000000001');lines:='[{"description":"Fiction integration care","qty":1,"price":10,"kind":"jasa","item_id":null,"discount_percent":0}]';
 invoice:=clinic_post_invoice('d6000000-0000-4000-8000-000000000002','integration-clinic',plan,lines);
 if exists(select 1 from activity_log)then raise exception 'Doctor read OWNER/ADMIN activity log';end if;
 perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);select count(*)into n from activity_log;perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);retry:=clinic_post_invoice('d6000000-0000-4000-8000-000000000002','integration-clinic',plan,lines);
 perform set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
 if invoice<>retry or(select count(*)from activity_log)<>n then raise exception 'Paid checkout retry duplicated source/audit';end if;
 if(select status from visits where id='d6000000-0000-4000-8000-000000000002')<>'Selesai'then raise exception 'Paid invoice was not atomically checked out';end if;
 if(select count(*)from visit_operational_events where visit_id='d6000000-0000-4000-8000-000000000002'and event_type='check_out')<>1 then raise exception 'Checkout event missing/duplicated';end if;
 if not exists(select 1 from activity_log where row_entity='invoices'and row_id=invoice::text and action='create'and actor_id='d1000000-0000-4000-8000-000000000001'::uuid)or not exists(select 1 from activity_log where row_entity='visit_operational_events'and action='create'and actor_id='d1000000-0000-4000-8000-000000000001'::uuid)then raise exception 'Paid checkout missing authenticated audit events';end if;
end$$;
rollback;
