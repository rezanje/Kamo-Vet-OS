#!/usr/bin/env python3
"""Disposable native PostgreSQL acceptance for PO lifecycle."""
from pathlib import Path
import os, subprocess, time

ROOT=Path(__file__).resolve().parents[1]
DB=f"vetos_po_acceptance_{os.getpid()}_{int(time.time())}"
PSQL=["psql","-X","-q","-h127.0.0.1","-p5432","-v","ON_ERROR_STOP=1"]
ENV={key:value for key,value in os.environ.items() if not key.startswith('PG')}
ENV['PGOPTIONS']='-c client_min_messages=warning'
MIGRATIONS="""0001_core.sql 0002_rls.sql 0004_perf_security_fixes.sql 0005_klinik_visits.sql 0006_rekam_medis.sql 0007_crm_fields.sql 0008_klinik_pembayaran.sql 0010_pos_sales.sql 0013_stock.sql 0015_keuangan.sql 0021_pembelian.sql 0029_compounding.sql 0040_rekam_medis_fields.sql 0043_ar_ap_fixed_assets.sql 0053_returns.sql 0055_tutup_buku.sql 0056_faktur_pembelian.sql 0058_stock_layers_fifo.sql 0060_user_admin.sql 0063_satuan_berjenjang.sql 0064_penerimaan_qty.sql 0065_barang_jasa_master.sql 0066_master_data_kategori.sql 0068_kas_bank.sql 0074_kartu_stok.sql 0093_penerimaan_barang.sql 0094_uang_muka_pembelian.sql 0101_akses_grup.sql 0104_kadaluarsa.sql 0109_faktur_langsung.sql 0113_coa_header_detail.sql 0117_kadaluarsa_bertingkat.sql 20260924120000_purchase_invoice_po_units.sql 20260924121000_atomic_purchase_layer_reprice.sql 20260924122000_atomic_po_invoice_and_stock_out.sql 20260924123000_atomic_fixed_asset_purchase.sql 20261004120000_purchase_recovery.sql 20261020134110_po_lifecycle_completion.sql""".split()
def run(*args,input=None):
 r=subprocess.run([*args],cwd=ROOT,env=ENV,input=input,text=True,check=False,capture_output=True)
 if r.returncode: raise RuntimeError(r.stderr)
 return r
def sql(*args,input=None): return run(*PSQL,"-d",DB,*args,input=input)
BOOT="""create extension if not exists pgcrypto;
do $$begin create role anon nologin; exception when duplicate_object then null; end$$;
do $$begin create role authenticated nologin; exception when duplicate_object then null; end$$;
do $$begin create role service_role nologin; exception when duplicate_object then null; end$$;
create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role()returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
grant usage on schema auth to authenticated,anon,service_role; grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;"""
created=False
try:
 run("createdb","-h127.0.0.1","-p5432",DB); created=True; sql(input=BOOT)
 for name in MIGRATIONS:
  path=ROOT/"supabase/migrations"/name
  if not path.is_file(): raise RuntimeError(f"missing migration {name}")
  if name=="0066_master_data_kategori.sql": sql(input="alter table customers add column if not exists kategori text default 'Umum';")
  if name=="0068_kas_bank.sql": sql(input="insert into coa_accounts(code,name,type,normal_balance) values('1101','Test cash','ASET','D'),('1102','Test bank','ASET','D'),('1301','Inventory','ASET','D'),('2102','GRNI','LIABILITAS','K') on conflict(code) do nothing;")
  try: sql("-f",str(path))
  except subprocess.CalledProcessError as e: raise RuntimeError(f"{name}: {e.stderr}") from e
 sql(input="grant usage on schema public to authenticated,anon,service_role; grant all on all tables in schema public to authenticated,service_role; grant all on all sequences in schema public to authenticated,service_role;")
 sql("-f",str(ROOT/"supabase/tests/purchase_order_lifecycle.sql")); print("PASS purchase_order_lifecycle.sql")
 # Exercise the parent-lock contract with two real PostgreSQL sessions: the
 # void wins the lock, and the concurrent advance must then be rejected.
 sql(input="""insert into auth.users(id) values ('b0000000-0000-4000-8000-000000000001');
 insert into profiles(id,role,is_active) values ('b0000000-0000-4000-8000-000000000001','OWNER',true) on conflict (id) do update set role='OWNER',is_active=true;
 insert into branches(id,code,name,type,is_active) values ('b1000000-0000-4000-8000-000000000001','CONC','Concurrent','KLINIK',true);
 insert into warehouses(id,branch_id,code,name,type,is_active) values ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','CONC-WH','Concurrent','VET',true);
 insert into suppliers(id,nama) values ('b3000000-0000-4000-8000-000000000001','Concurrent supplier');
 set role rezanje;
 insert into purchase_orders(id,no_po,branch_id,to_warehouse_id,status,total) values
 ('b4000000-0000-4000-8000-000000000001','PO-CONC','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','Draft',100),
 ('b4000000-0000-4000-8000-000000000002','PO-NULL-SUPPLIER','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','Draft',100);""")
 a=subprocess.Popen([*PSQL,"-d",DB,"-c", "set role authenticated; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='b0000000-0000-4000-8000-000000000001'; begin; select id from purchase_orders where id='b4000000-0000-4000-8000-000000000001' for update; select pg_sleep(1); select revise_purchase_order('conc-void','b4000000-0000-4000-8000-000000000001',0,'void','{}','[]','Concurrent void'); commit;"], cwd=ROOT, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
 time.sleep(0.2)
 b=subprocess.run([*PSQL,"-d",DB,"-c", "set role authenticated; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='b0000000-0000-4000-8000-000000000001'; insert into purchase_advances(no_um,po_id,tanggal,jumlah) values ('UM-CONC','b4000000-0000-4000-8000-000000000001',current_date,10);"], cwd=ROOT, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
 a_out,a_err=a.communicate()
 remaining=sql("-At", "-c", "select count(*) from purchase_advances where no_um='UM-CONC'").stdout.strip()
 if a.returncode != 0 or b.returncode == 0 or "PO uang muka sudah tidak aktif" not in b.stderr or remaining != "0": raise RuntimeError(f"concurrent parent-lock acceptance failed: A={a_err} B={b.stderr} rows={remaining}")
 print("PASS concurrent advance/void parent lock")
 accepted=subprocess.run([*PSQL,"-d",DB,"-c", "set role authenticated; set request.jwt.claim.role='authenticated'; set request.jwt.claim.sub='b0000000-0000-4000-8000-000000000001'; insert into purchase_advances(no_um,supplier_id,po_id,tanggal,jumlah) values ('UM-NULL-PO','b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000002',current_date,10);"], cwd=ROOT, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
 null_po_rows=sql("-At", "-c", "select count(*) from purchase_advances where no_um='UM-NULL-PO'").stdout.strip()
 if accepted.returncode != 0 or null_po_rows != "1": raise RuntimeError(f"null-supplier PO advance compatibility failed: {accepted.stderr} rows={null_po_rows}")
 print("PASS null-supplier PO advance compatibility")
finally:
 if created: subprocess.run(["dropdb","-h127.0.0.1","-p5432",DB],env=ENV,check=True)
