#!/usr/bin/env python3
"""Exercise administrative backup and real isolated restore with fictional local data."""
from pathlib import Path
import base64
import importlib.util
import json
import os
import subprocess
import tempfile
import time

ROOT=Path(__file__).resolve().parents[1]
DB=f"vetos_backup_source_{os.getpid()}_{time.time_ns()}"
LOCAL=["-h127.0.0.1","-p5432"]

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def seed_source(source):
    fixture=(ROOT/"supabase/tests/pos_merchant_fees.sql").read_text().rstrip()
    assert fixture.endswith("rollback;")
    source.sql(source.fixture_owner_updates(fixture[:-len("rollback;")]+"commit;"))
    source.sql("""begin;
alter table public.profiles disable trigger guard_profile_privileges;
update public.profiles set role='OWNER',is_active=true where id='e1100000-0000-4000-8000-000000000001';
alter table public.profiles enable trigger guard_profile_privileges;
select set_config('request.jwt.claim.sub','e1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
insert into public.customers(id,name,phone) values('ef940000-0000-4000-8000-000000000001','Backup fictional customer','080000000199');
insert into public.pets(id,customer_id,name) values('ef950000-0000-4000-8000-000000000001','ef940000-0000-4000-8000-000000000001','Backup patient');
insert into public.employees(id,nama,jabatan,branch_id) values('ef930000-0000-4000-8000-000000000001','Backup fictional doctor','Dokter Hewan','e2200000-0000-4000-8000-000000000001');
insert into public.visits(id,branch_id,customer_id,pet_id,doctor_id) values('ef960000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','ef940000-0000-4000-8000-000000000001','ef950000-0000-4000-8000-000000000001','ef930000-0000-4000-8000-000000000001');
insert into public.medical_records(id,visit_id,diagnosis,submission_key,submission_hash) values('ef970000-0000-4000-8000-000000000001','ef960000-0000-4000-8000-000000000001','Fictional recovery record','backup-record',repeat('a',64));
insert into public.inpatient_records(id,branch_id,visit_id,medical_record_id) values('ef980000-0000-4000-8000-000000000001','e2200000-0000-4000-8000-000000000001','ef960000-0000-4000-8000-000000000001','ef970000-0000-4000-8000-000000000001');
insert into public.inpatient_daily_logs(inpatient_record_id,condition_note,submission_key,submission_hash) values('ef980000-0000-4000-8000-000000000001','Fictional recovery log','backup-log',repeat('b',64));
insert into public.document_attachments(modul,ref_id,nama,path) select 'purchase','ef990000-0000-4000-8000-000000000001','Bukti uji — '||n,'fictional/backup/'||n from generate_series(1,1001) n;
commit;""")


def main():
    source=load("sale_schema",ROOT/"scripts/test-posted-sales-postgres.py")
    restore=load("backup_restore",ROOT/"scripts/verify-simulation-backup.py")
    source.DB=DB
    source.ENV=restore.ENV
    source.PSQL=["psql","-X","-q","-At",*LOCAL,"-d",DB,"-v","ON_ERROR_STOP=1"]
    created=False
    try:
        subprocess.run(["createdb",*LOCAL,DB],check=True,capture_output=True,env=restore.ENV);created=True
        source.bootstrap_database()
        seed_source(source)
        metadata=json.loads(source.sql("set role service_role;select public.prepare_simulation_backup('e1100000-0000-4000-8000-000000000001');").stdout.strip())
        backup_id=metadata["backup_id"]
        document=json.loads(source.sql("set role service_role;select public.download_simulation_backup('"+backup_id+"');").stdout.strip())
        assert document["manifest"]["tables"]["document_attachments"]["count"]>=1001
        assert document["manifest"]["tables"]["pos_sale_postings"]["count"]>0
        source.sql("set role authenticated;set request.jwt.claim.sub='e1100000-0000-4000-8000-000000000001';select public.download_simulation_backup('"+backup_id+"');",succeeds=False)
        source.sql("set role authenticated;select public.prepare_simulation_backup('e1100000-0000-4000-8000-000000000001');",succeeds=False)
        with tempfile.TemporaryDirectory(prefix="vetos-backup-test-") as temporary:
            path=Path(temporary)/"snapshot.json"
            path.write_text(document["document"]);path.chmod(0o600)
            receipt=restore.verify_backup(path,document["sha256"])
            assert receipt["manifest"]==document["manifest"]
            encoded=base64.b64encode(json.dumps(receipt).encode()).decode()
            source.sql("set role service_role;select public.verify_simulation_backup('"+backup_id+"','"+document["sha256"]+"',convert_from(decode('"+encoded+"','base64'),'UTF8')::jsonb);")
            source.sql("set role service_role;select public.verify_simulation_backup('"+backup_id+"','"+("0"*64)+"','{}');",succeeds=False)
            try:
                restore.verify_backup(path,"0"*64)
            except ValueError:
                pass
            else:
                raise AssertionError("Corrupted checksum was accepted")
        assert source.sql("select verified_at is not null from kamo_maintenance.simulation_backups where id='"+backup_id+"';").stdout.strip()=="t"
        assert source.sql("select count(*) from pg_database where datname='"+receipt["isolation_database"]+"';").stdout.strip()=="0"
        print("PASS administrative-only export, protected financial/medical data, 1001-row UTF-8 restore, constraints, exact hashes, checksum rejection and owned-database cleanup")
    finally:
        if created:subprocess.run(["dropdb",*LOCAL,"--if-exists",DB],check=True,capture_output=True,env=restore.ENV)

if __name__=="__main__":main()
