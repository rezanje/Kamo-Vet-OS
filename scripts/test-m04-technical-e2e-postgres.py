#!/usr/bin/env python3
"""Fictional M04 parser-to-native-Postgres test. JSON comes from the TS test on stdin."""
import importlib.util
import hashlib
import json
from pathlib import Path
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("accurate_runner", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class InMemoryPostgres(runner.DisposablePostgres):
    """Keep the owned DB's data off Docker's often-full overlay filesystem."""

    def __enter__(self):
        runner.docker("run", "--pull=never", "--rm", "-d", "--name", self.container,
                      "--label", "kamo-purpose=fictional-m04-technical-e2e",
                      "--network", "none", "--tmpfs", "/var/lib/postgresql/data:rw,size=1g",
                      "-e", "POSTGRES_HOST_AUTH_METHOD=trust", runner.IMAGE)
        self.started = True
        try:
            for _ in range(200):
                ready = runner.subprocess.run(runner.DOCKER + ["exec", self.container, "pg_isready", "-U", "postgres"], capture_output=True)
                logs = runner.docker("logs", self.container)
                if ready.returncode == 0 and "PostgreSQL init process complete" in logs.stdout + logs.stderr:
                    return self
                time.sleep(.1)
            raise RuntimeError("Owned in-memory PostgreSQL did not become ready")
        except BaseException:
            self.__exit__(None, None, None)
            raise


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def json_sql(value):
    return literal(json.dumps(value, ensure_ascii=False, separators=(",", ":"))) + "::jsonb"


def main():
    fixture = json.load(sys.stdin)
    assert [item["code"] for item in fixture["items"]] == ["M04-E2E-A", "M04-E2E-B"]
    assert [row["source_code"] for row in fixture["rows"]] == ["M04-E2E-A", "M04-E2E-B", "M04-E2E-BAD"]
    assert len(fixture["rejected_master"]) == 1
    owner_id = str(uuid.UUID(hex=hashlib.md5(b"m04-e2e-owner").hexdigest()))
    owner = literal(owner_id) + "::uuid"
    branch = literal(fixture["branch_id"]) + "::uuid"
    warehouse = literal(fixture["warehouse_id"]) + "::uuid"
    master_items = json_sql(fixture["items"])
    master_rejected = json_sql(fixture["rejected_master"])
    stock_rows = json_sql(fixture["rows"])
    with InMemoryPostgres() as db:
        db.bootstrap()
        db.sql(f"""
begin;
insert into auth.users(id) values({owner});
alter table profiles disable trigger guard_profile_privileges;
update profiles set role='OWNER',is_active=true where id={owner};
alter table profiles enable trigger guard_profile_privileges;
insert into branches(id,code,name,type) values({branch},'M04-BR','Fictional branch','PETSHOP');
insert into warehouses(id,branch_id,code,name,type) values({warehouse},{branch},'M04-WH','Fictional warehouse','RETAIL');
insert into coa_accounts(code,name,type,normal_balance,is_header) values
 ('1301','Fictional inventory','ASET','D',false),('3101','Fictional equity','EKUITAS','K',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into items(id,code,name,unit,item_type,is_active,track_expiry)
 select x.id::uuid,x.code,x.name,x.unit,x.item_type,x.is_active,x.track_expiry
 from jsonb_to_recordset({master_items}) as x(id text,code text,name text,unit text,item_type text,is_active boolean,track_expiry boolean);
insert into import_runs(kind,source_name,source_hash,status,created_by,summary)
 values('master_accurate','fictional-m04.xlsx','m04-e2e-master-hash','posted',{owner},
 jsonb_build_object('Baru',2,'Ditolak',1));
insert into import_run_rows(run_id,source_row,source_code,status,reason,payload)
 select r.id,x.source_row,x.code,'posted',null,to_jsonb(x)
 from import_runs r cross join jsonb_to_recordset({master_items}) as x(source_row int,code text)
 where r.source_hash='m04-e2e-master-hash';
insert into import_run_rows(run_id,source_row,source_code,status,reason,payload)
 select r.id,x.row_no,x.code,'rejected',x.reason,to_jsonb(x)
 from import_runs r cross join jsonb_to_recordset({master_rejected}) as x(row_no int,code text,reason text)
 where r.source_hash='m04-e2e-master-hash';
commit;
""")
        auth = f"set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub={literal(owner_id)};"
        # Strict precision refusal must leave no stock run or financial write.
        strict = f"""{auth}
do $$begin
 begin
  perform prepare_accurate_initial_stock('m04-e2e-strict-hash','fictional-m04.xlsx',{branch},{warehouse},'2026-01-01',{stock_rows},'STRICT');
  raise exception 'STRICT unexpectedly accepted fractional cents';
 exception when sqlstate '22023' then null;end;
 if exists(select 1 from import_runs where source_hash='m04-e2e-strict-hash') then raise exception 'STRICT left a batch';end if;
end$$;"""
        db.sql(strict)
        prepare = f"{auth} select prepare_accurate_initial_stock('m04-e2e-normalized-hash','fictional-m04.xlsx',{branch},{warehouse},'2026-01-01',{stock_rows},'HALF_UP_BATCH_V1');"
        run_id = db.sql(prepare).strip()
        assert run_id and len(run_id) == 36, run_id
        # This is a new connection after the source file/process state is gone:
        # the saved run and row errors must still be readable before exact retry.
        saved = json.loads(db.sql(f"""{auth}
select jsonb_build_object(
 'run_id',r.id,'status',r.status,'source_value',r.summary#>>'{{valuation,source_value}}',
 'posted_value',r.summary#>>'{{valuation,posted_value}}',
 'rows',(select jsonb_agg(jsonb_build_object('source_row',source_row,'status',status,'reason',reason) order by source_row)
         from import_run_rows where run_id=r.id))
from import_runs r where r.id={literal(run_id)}::uuid;"""))
        assert saved["run_id"] == run_id and saved["status"] == "previewed", saved
        assert saved["source_value"] == "2.333333" and float(saved["posted_value"]) == 2.33, saved
        assert [(row["source_row"], row["status"]) for row in saved["rows"]] == [(2,"valid"),(3,"valid"),(4,"rejected")], saved
        assert "tidak ditemukan" in saved["rows"][2]["reason"], saved
        assert db.sql(prepare).strip() == run_id, "Preparation retry duplicated the run"
        preview = json.loads(db.sql(f"{auth} select preview_accurate_inventory_accounting({literal(run_id)}::uuid,(select id from coa_accounts where code='3101'));"))
        assert preview["can_post"] and float(preview["original_value"]) == 2.33, preview
        reason = "Fictional M04 end-to-end reviewed opening"
        post = f"{auth} select post_accurate_inventory_accounting({literal(run_id)}::uuid,(select id from coa_accounts where code='3101'),{json_sql(preview)},{literal(reason)});"
        receipt = json.loads(db.sql(post))
        assert json.loads(db.sql(post)) == receipt, "Posting retry changed receipt"
        # Verify every persisted output, by SKU and warehouse, rather than only
        # checking the receipt or preview returned by the posting RPC.
        result = json.loads(db.sql(f"""{auth}
select jsonb_build_object(
 'runs',(select count(*) from import_runs where kind='initial_stock' and source_hash='m04-e2e-normalized-hash'),
 'status',(select status from import_runs where id={literal(run_id)}::uuid),
 'rows',(select count(*) from import_run_rows where run_id={literal(run_id)}::uuid),
 'journals',(select count(*) from journal_entries where source='accurate-stock-opening' and source_ref={literal(run_id)}),
 'debit',(select sum(debit) from journal_lines where entry_id=(select id from journal_entries where source_ref={literal(run_id)})),
 'credit',(select sum(credit) from journal_lines where entry_id=(select id from journal_entries where source_ref={literal(run_id)})),
 'per_item',(select jsonb_agg(jsonb_build_object('code',i.code,'stock',s.qty,
  'layer_qty',(select sum(qty_in) from stock_layers l where l.item_id=i.id and l.warehouse_id={warehouse} and l.source_ref={literal(run_id)}),
  'move_qty',(select sum(qty) from stock_moves m where m.item_id=i.id and m.warehouse_id={warehouse} and m.source_ref={literal(run_id)}),
  'layer_value',(select sum(qty_in*unit_cost) from stock_layers l where l.item_id=i.id and l.warehouse_id={warehouse} and l.source_ref={literal(run_id)})) order by i.code)
  from items i join stock s on s.item_id=i.id and s.warehouse_id={warehouse} where i.code like 'M04-E2E-%'));
"""))
        assert result["runs"] == 1 and result["status"] == "posted" and result["rows"] == 3, result
        assert result["journals"] == 1 and float(result["debit"]) == float(result["credit"]) == 2.33, result
        assert [(r["code"],float(r["stock"]),float(r["layer_qty"]),float(r["move_qty"])) for r in result["per_item"]] == [
            ("M04-E2E-A",1,1,1),("M04-E2E-B",2,2,2)], result
        assert sum(float(r["layer_value"]) for r in result["per_item"]) == 2.33, result
        print("M04 technical E2E passed: fictional XLSX parsed, master audited, decimal normalized, saved batch resumed, exact retries, one balanced journal and SKU stock reconciliation.", flush=True)


if __name__ == "__main__":
    main()
