#!/usr/bin/env python3
"""Exercise C05 alias redemption in owned, network-isolated PostgreSQL fixtures."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(fixture)

with fixture.DisposablePostgres() as db:
    db.bootstrap()
    cap = (ROOT / "supabase/migrations/20261026001920_c05_voucher_usage_limit.sql")
    if not cap.exists():
        cap = Path("/workspace/Kamo-Vet-OS-c05-binding/supabase/migrations/20261026001920_c05_voucher_usage_limit.sql")
    db.sql("begin;\n" + cap.read_text() + "\ncommit;")

    pos = (ROOT / "supabase/tests/pos_split_payments.sql").read_text().split("set local role authenticated;")[0]
    db.sql(pos + """
insert into auth.users(id,raw_user_meta_data) values('e1100000-0000-4000-8000-000000000003','{"full_name":"Campaign owner"}');
update profiles set role='OWNER',is_active=true where id='e1100000-0000-4000-8000-000000000003';
insert into vouchers(id,code,tipe,nilai) values('e7700000-0000-4000-8000-000000000001','SOURCEV','nominal',10000);
insert into campaign_code_bindings(code,binding_type,voucher_id,calculation_mode)
 values('ALIASV','transaction_voucher','e7700000-0000-4000-8000-000000000001','existing_voucher'),
       ('WAITING','transaction_voucher','e7700000-0000-4000-8000-000000000001',null);
insert into campaign_code_bindings(code,binding_type,promo_id,calculation_mode)
 select 'PRODUCT','product_promo',id,'existing_promo' from promos limit 1;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
update vouchers set max_uses=1 where code='SOURCEV';
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select pg_temp.assert_ok((select count(*)=0 from campaign_code_bindings),'cashier config RLS stays manager-only');
select pg_temp.assert_ok((select count(*)=1 from campaign_voucher_aliases(null)),'only selected voucher alias is shown');
select pg_temp.assert_ok((select voucher_code='SOURCEV' from campaign_voucher_aliases('ALIASV')),'alias resolves canonical source');
select pg_temp.assert_ok((select count(*)=0 from campaign_voucher_aliases('SOURCEV')),'legacy voucher keeps old path');
select pg_temp.reject($q$select * from campaign_voucher_aliases('PRODUCT')$q$,'product alias fails closed');
select pg_temp.reject($q$select * from campaign_voucher_aliases('WAITING')$q$,'unconfigured alias fails closed');
create function pg_temp.campaign_sale(ref text,source_code text,alias_code text) returns uuid language plpgsql as $$declare doc uuid;begin
 insert into sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint,voucher_code,campaign_code)
 values('e2200000-0000-4000-8000-000000000001',ref,100000,0,100000,'Split',100000,0,auth.uid(),
 'e4400000-0000-4000-8000-000000000001','[{"method":"Tunai","amount":20000},{"method":"Transfer","amount":80000}]',
 'sql:'||ref,repeat('a',64),source_code,alias_code) returning id into doc;return doc;end$$;
select pg_temp.campaign_sale('CAMPAIGN.ONE','SOURCEV','ALIASV');
select pg_temp.assert_ok((select voucher_code='SOURCEV' and campaign_code='ALIASV' from sales where no_struk='CAMPAIGN.ONE'),'alias snapshot and canonical cap key');
select pg_temp.reject($q$select pg_temp.campaign_sale('CAMPAIGN.TWO','SOURCEV','ALIASV')$q$,'canonical usage cap counts alias redemption');
select pg_temp.reject($q$select pg_temp.campaign_sale('CAMPAIGN.BAD','OTHER','ALIASV')$q$,'mismatched source refused');
select pg_temp.reject($q$select pg_temp.campaign_sale('CAMPAIGN.WAIT','OTHER','WAITING')$q$,'unconfigured alias refused on direct write');
select pg_temp.reject($q$update sales set campaign_code=null where no_struk='CAMPAIGN.ONE'$q$,'snapshot cannot be removed');
rollback;
""")
    print("PASS C05 POS alias: chosen mode, manager RLS, fail-closed product/unconfigured, canonical cap, immutable snapshot", flush=True)

    clinic = (ROOT / "supabase/tests/clinic_invoice_post.sql").read_text().split("set local role authenticated;")[0]
    db.sql(clinic + """
insert into vouchers(id,code,tipe,nilai) values('d7700000-0000-4000-8000-000000000001','CLINICV','nominal',10);
insert into campaign_code_bindings(code,binding_type,voucher_id,calculation_mode)
 values('CLINICALIAS','transaction_voucher','d7700000-0000-4000-8000-000000000001','existing_voucher');
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $test$ declare v_id uuid; v_payload jsonb; begin
  v_payload:=jsonb_build_object('tanggal',current_date::text,'subtotal',100,'discount',10,'tax',0,'total',90,
    'dp_amount',0,'dp_date',null,'paid_status','Lunas','metode_bayar','Tunai',
    'shift_id','da000000-0000-4000-8000-000000000001','voucher_code','CLINICV','campaign_code','CLINICALIAS');
  v_id:=public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001','c05-alias-clinic',v_payload,
    jsonb_build_array(jsonb_build_object('description','Jasa dummy','qty',1,'price',100,'kind','jasa','discount_percent',0)));
  if not exists(select 1 from public.invoices where id=v_id and voucher_code='CLINICV' and campaign_code='CLINICALIAS') then
    raise exception 'Clinic atomic posting lost canonical voucher or alias snapshot';
  end if;
  if public.clinic_post_invoice('d6000000-0000-4000-8000-000000000001','c05-alias-clinic',v_payload,
    jsonb_build_array(jsonb_build_object('description','Jasa dummy','qty',1,'price',100,'kind','jasa','discount_percent',0))) is distinct from v_id then
    raise exception 'Clinic alias retry lost idempotency';
  end if;
end $test$;
rollback;
""")
    print("PASS C05 clinic alias: atomic posted snapshot and idempotent retry", flush=True)
