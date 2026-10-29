#!/usr/bin/env python3
"""Two real psql sessions, complete local schema, fictional fixtures, public money RPCs.

No DB URL/network, packages, business stubs, SQL edits, or commits. Reuses the full
harness bootstrap and NativePostgres. A third connection is only a lock gate;
pg_blocking_pids proves the competing RPC is actually in flight before release.
Every wait has a deadline (no sleeps); PostgreSQL also bounds statements/locks.
Exit 1 on a deadlock, timeout, missing overlap, or wrong numeric outcome, even if
an explicit retry recovers. The JSON distinguishes first attempts from retries.
"""
import argparse
import contextlib
from decimal import Decimal
import importlib.util
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import time
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
spec = importlib.util.spec_from_file_location("full", ROOT / "scripts/test-ranap-mitigasi-penuh-postgres.py")
assert spec is not None and spec.loader is not None
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)
from native_postgres import NativePostgres  # noqa: E402

TIMEOUT = 12
CODES = ("1101", "1102", "1201", "2103", "4201")
RESULTS = []
DIAGNOSTICS = {}


class BoundedPostgres(NativePostgres):
    def sql(self, source):
        assert self.psql is not None
        result = subprocess.run(self.as_user + [self.psql, "-X", "-qAt", "-h", str(self.root),
            "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
            input="set statement_timeout='15s'; set lock_timeout='8s';\n" + source,
            text=True, capture_output=True, timeout=20,
            env={**os.environ, "PSQLRC": "/dev/null"})
        if result.returncode:
            raise RuntimeError(result.stderr + result.stdout)
        return result.stdout.strip()


class Session:
    """Interactive psql with line markers, OS readiness and monotonic deadlines."""
    def __init__(self, db, name, user=None):
        self.name = name
        self.pending = b""
        self.history = []
        self.p = subprocess.Popen(db.as_user + [db.psql, "-X", "-qAt", "-h", str(db.root),
            "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env={**os.environ, "PSQLRC": "/dev/null", "PGAPPNAME": name})
        assert self.p.stdin is not None and self.p.stdout is not None and self.p.stderr is not None
        self.stdin, self.stdout, self.stderr = self.p.stdin, self.p.stdout, self.p.stderr
        self.sel = selectors.DefaultSelector()
        self.sel.register(self.stdout, selectors.EVENT_READ)
        self.sql("set statement_timeout='8s'; set lock_timeout='6s'; "
                 "set idle_in_transaction_session_timeout='20s'; set deadlock_timeout='300ms';")
        self.pid = int(self.sql("select pg_backend_pid();")[-1])
        if user:
            self.sql("set role authenticated; "
                "select set_config('request.jwt.claim.role','authenticated',false); "
                f"select set_config('request.jwt.claim.sub',{f.q(user)},false);")
            assert self.sql("select current_user||'|'||auth.uid()::text;")[-1] == "authenticated|" + user

    def send(self, sql):
        self.marker = ("DONE_" + uuid.uuid4().hex).encode()
        self.started = time.monotonic()
        self.stdin.write((sql + "\n\\echo " + self.marker.decode() + "\n").encode())
        self.stdin.flush()

    def finish(self):
        deadline = time.monotonic() + TIMEOUT
        lines = []
        while True:
            while b"\n" in self.pending:
                line, self.pending = self.pending.split(b"\n", 1)
                if line == self.marker:
                    self.history.append({"ok": True, "seconds": round(time.monotonic()-self.started, 4),
                                         "output": lines})
                    return lines
                if line:
                    lines.append(line.decode())
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not self.sel.select(remaining):
                self.p.kill()
                raise TimeoutError(f"{self.name}: client deadline {TIMEOUT}s")
            chunk = os.read(self.stdout.fileno(), 65536)
            if not chunk:
                self.p.wait(timeout=TIMEOUT)
                error = self.stderr.read().decode()
                self.history.append({"ok": False, "seconds": round(time.monotonic()-self.started, 4),
                                     "error": error, "output": lines})
                raise RuntimeError(error)
            self.pending += chunk

    def sql(self, sql):
        self.send(sql)
        return self.finish()

    def close(self):
        if self.p.poll() is None:
            try:
                self.stdin.write(b"\\q\n")
                self.stdin.flush()
                self.p.wait(timeout=2)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                self.p.kill()
                self.p.wait(timeout=2)
        self.sel.close()
        for stream in (self.stdin, self.stdout, self.stderr):
            stream.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def number(h, sql):
    return int(Decimal(h.nilai(sql)))


def balances(h):
    return {c: number(h, "select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l "
        "join public.coa_accounts a on a.id=l.account_id " + f"where a.code={f.q(c)}") for c in CODES}


def wait_block(observer, waiter, blocker, evidence):
    """Poll real lock state, never infer readiness from elapsed time."""
    deadline = time.monotonic() + 5
    rows = []
    while time.monotonic() < deadline:
        rows = observer.sql("select json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),"
            "'wait_event_type',wait_event_type,'wait_event',wait_event,'query',query)::text "
            f"from pg_stat_activity where pid={waiter.pid};")
        if rows:
            state = json.loads(rows[-1])
            if blocker.pid in state["blockers"]:
                evidence.append(state)
                return
        if waiter.p.poll() is not None:
            raise AssertionError(f"{waiter.name} exited before the expected lock barrier")
    raise TimeoutError(f"No observed lock {waiter.name} -> {blocker.name} within 5s; last={rows}")


def attempt(session, commit=True):
    try:
        result = session.finish()
        seconds = session.history[-1]["seconds"]
        if commit:
            session.sql("commit;")  # includes deferred constraint trigger verification
        return {"ok": True, "result": result, "rpc_seconds":seconds}
    except (RuntimeError, TimeoutError) as exc:
        return {"ok": False, "error": str(exc),
                "seconds_to_error":round(time.monotonic()-session.started,4)}


def fixture(h, n, applied=True):
    cust = f.buat_pelanggan(h, n)
    visit = f.buat_kunjungan(h, n, cust)
    h.sql(f.bayar_sql(visit, f"cc-{n}-seed", [
        {"method": "Tunai", "amount": 60000}, {"method": "QRIS", "amount": 90000}]), f.OWNER)
    receipt = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={f.q(visit)}")
    advance = h.nilai(f"select id from public.clinic_customer_advances where receipt_id={f.q(receipt)}")
    if applied:
        h.sql(f.tagih_sql(visit, f"cc-{n}-stage-a", f.baris(n, 1), f.STAFF), f.STAFF)
    return cust, visit, receipt, advance


def assert_equal(actual, expected):
    if actual != expected:
        raise AssertionError(f"actual={actual!r}; expected={expected!r}")


def snapshot(h, visit, advance=None):
    invoices = json.loads(h.nilai("select coalesce(jsonb_agg(x order by request_key),'[]') from "
        "(select i.request_key,i.total,i.paid_status,coalesce((select sum(p.amount) "
        "from public.invoice_payments p where p.invoice_id=i.id),0)+i.dp_amount received "
        f"from public.invoices i where i.visit_id={f.q(visit)} and i.voided_at is null) x"))
    result = {"invoices": invoices,
        "receipts": number(h, f"select count(*) from public.clinic_payment_receipts where visit_id={f.q(visit)}"),
        "context_rows": number(h, "select count(*) from clinic_private.posting_ctx"),
        "unbalanced_journals": number(h, "select count(*) from (select entry_id from public.journal_lines "
            "group by entry_id having sum(debit)<>sum(credit)) x")}
    if advance:
        result["advance"] = json.loads(h.nilai("select row_to_json(x) from (select amount,applied,status,"
            f"released_at is not null released from public.clinic_customer_advances where id={f.q(advance)}) x"))
        result["applications"] = json.loads(h.nilai("select json_build_object('count',count(*),"
            "'active',count(*) filter(where released_at is null),'released_amount',"
            "coalesce(sum(amount) filter(where released_at is not null),0),'reversals',"
            "count(release_payment_id)) from public.clinic_advance_applications " + f"where advance_id={f.q(advance)}"))
    return result


def verify_clean(snap):
    assert_equal(snap["context_rows"], 0)
    assert_equal(snap["unbalanced_journals"], 0)


def stage_race(h, db, n, first, hazard=False, other_visit=False):
    before = balances(h)
    cust, visit, receipt, advance = fixture(h, n)
    target = f.buat_kunjungan(h, n+100, cust) if other_visit else visit
    slot_n = n+100 if other_visit else n
    post = f.tagih_sql(target, f"cc-{n}-stage-b", f.baris(slot_n, 2), f.OWNER,
                       alasan="Uji fiktif concurrency")
    release = f.lepas_sql(advance, f"cc-{n}-release")
    evidence, attempts = [], {}
    with contextlib.ExitStack() as stack:
        obs = stack.enter_context(Session(db, f"cc-{n}-observer"))
        a = stack.enter_context(Session(db, f"cc-{n}-release", f.FINANCE))
        b = stack.enter_context(Session(db, f"cc-{n}-stage", f.OWNER))
        if hazard:
            gate = stack.enter_context(Session(db, f"cc-{n}-shift-gate"))
            gate.sql(f"begin; select id from public.cashier_shifts where id={f.q(f.SHIFT[f.FINANCE])} for update;")
            a.send("begin; " + release)
            wait_block(obs, a, gate, evidence)  # release has advance; pauses at its shift
            b.send("begin; " + post)
            wait_block(obs, b, a, evidence)     # stage has visit; waits for advance
            gate.sql("commit;")
            attempts["release"] = attempt(a)
            attempts["stage"] = attempt(b)
        else:
            leading, trailing = (a, b) if first == "release" else (b, a)
            leading.sql("begin; " + (release if first == "release" else post))
            trailing.send("begin; " + (post if first == "release" else release))
            wait_block(obs, trailing, leading, evidence)
            leading.sql("commit;")
            attempts[first] = {"ok": True}
            attempts["stage" if first == "release" else "release"] = attempt(trailing)
    first_ok = all(x["ok"] for x in attempts.values())
    DIAGNOSTICS.update({"barriers":evidence,"first_attempts":attempts})
    # Read committed DB state BEFORE any retry, including the losing transaction's
    # deferred invoice/receipt/context work. Prove rollback, not only eventual success.
    initial = snapshot(h, visit, advance)
    initial_delta = {c:v-before[c] for c,v in balances(h).items()}
    DIAGNOSTICS.update({"before_retry_state":initial,"before_retry_balance_delta":initial_delta})
    verify_clean(initial)
    if not attempts["stage"]["ok"] and attempts["release"]["ok"]:
        assert_equal(initial_delta,{"1101":60000,"1102":90000,"1201":100000,"2103":-150000,"4201":-100000})
        assert_equal(len(initial["invoices"]),1)
        assert_equal(initial["advance"]["applied"],0)
        assert_equal(initial["applications"],{"count":1,"active":0,"released_amount":100000,"reversals":1})
    elif not attempts["release"]["ok"] and attempts["stage"]["ok"]:
        assert_equal(initial_delta,{"1101":60000,"1102":90000,"1201":70000,"2103":0,"4201":-220000})
        assert_equal(initial["advance"]["applied"],150000)
        assert_equal(initial["advance"]["released"],False)
        assert_equal(initial["applications"],{"count":2,"active":2,"released_amount":0,"reversals":0})
    # Diagnose atomic recovery without silently counting a deadlocked RPC as PASS.
    recovered = []
    if not attempts["stage"]["ok"]:
        h.sql(post, f.OWNER)
        recovered.append("stage")
    if not attempts["release"]["ok"]:
        h.sql(release, f.FINANCE)
        recovered.append("release")
    snap = snapshot(h, visit, advance)
    extra = snapshot(h, target) if other_visit else snap
    after = balances(h)
    delta = {c: after[c]-before[c] for c in CODES}
    expected_apps = 2 if first == "stage" and not hazard else 1
    # A failed release retried after stage commit also releases its new application.
    if not attempts["release"]["ok"] and attempts["stage"]["ok"]:
        expected_apps = 2
    expected_amount = 150000 if expected_apps == 2 else 100000
    detail = {"barriers": evidence, "first_attempts": attempts, "explicit_retries": recovered,
              "before_retry_state":initial,"before_retry_balance_delta":initial_delta,
              "state": snap, "other_visit_state": extra if other_visit else None,
              "balance_delta": delta, "expected_applications": expected_apps}
    DIAGNOSTICS.update(detail)
    assert_equal(delta, {"1101":60000,"1102":90000,"1201":220000,"2103":-150000,"4201":-220000})
    assert_equal(snap["advance"], {"amount":150000,"applied":0,"status":"aktif","released":True})
    assert_equal(snap["applications"], {"count":expected_apps,"active":0,
        "released_amount":expected_amount,"reversals":expected_apps})
    for inv in snap["invoices"] + (extra["invoices"] if other_visit else []):
        assert_equal((inv["received"], inv["paid_status"]), (0, "Belum Lunas"))
    assert_equal(len(snap["invoices"])+(len(extra["invoices"]) if other_visit else 0), 2)
    assert_equal(snap["receipts"], 1)
    verify_clean(snap)
    verify_clean(extra)
    detail["numeric_invariants_pass"] = True
    return first_ok, detail


def cancel_race(h, db, n, cancellation_first=False, hazard=False):
    before = balances(h)
    _, visit, receipt, advance = fixture(h, n)
    release = f.lepas_sql(advance, f"cc-{n}-release")
    cancel = f.batal_kwitansi_sql(receipt, f"cc-{n}-void")
    evidence, attempts = [], {}
    cancelling_user = f.FINANCE if hazard else f.ADMIN
    with contextlib.ExitStack() as stack:
        obs = stack.enter_context(Session(db, f"cc-{n}-observer"))
        a = stack.enter_context(Session(db, f"cc-{n}-release", f.FINANCE))
        b = stack.enter_context(Session(db, f"cc-{n}-void", cancelling_user))
        if hazard:
            # Two tabs of the same financial actor: cancellation reaches the shift
            # first, release holds advance before joining the same shift queue.
            gate = stack.enter_context(Session(db, f"cc-{n}-shift-gate"))
            gate.sql(f"begin; select id from public.cashier_shifts where id={f.q(f.SHIFT[f.FINANCE])} for update;")
            b.send("begin; " + cancel)
            wait_block(obs, b, gate, evidence)
            a.send("begin; " + release)
            wait_block(obs, a, b, evidence)
            gate.sql("commit;")
            attempts["void"] = attempt(b)
            attempts["release"] = attempt(a)
        elif cancellation_first:
            gate = stack.enter_context(Session(db, f"cc-{n}-advance-gate"))
            gate.sql(f"begin; select id from public.clinic_customer_advances where id={f.q(advance)} for update;")
            b.send("begin; " + cancel)
            wait_block(obs, b, gate, evidence)
            a.send("begin; " + release)
            wait_block(obs, a, b, evidence)  # tuple-lock queue behind the cancellation
            gate.sql("commit;")
            attempts["void"] = attempt(b)
            attempts["release"] = attempt(a)
        else:
            a.sql("begin; " + release)
            b.send("begin; " + cancel)
            wait_block(obs, b, a, evidence)
            a.sql("commit;")
            attempts["release"] = {"ok": True}
            attempts["void"] = attempt(b)
    DIAGNOSTICS.update({"barriers":evidence,"first_attempts":attempts})
    # Both schedules start cancellation before release. Under the corrected shared
    # coordinator cancellation can now reach ADVANCE_USED before release proceeds;
    # that is the required business guard, NOT a database retry/deadlock success.
    # In particular 40P01/timeouts cannot satisfy this exact allowed rejection.
    expected_rejection = (cancellation_first or hazard) and not attempts["void"]["ok"] and "ADVANCE_USED" in attempts["void"].get("error", "") and "40P01" not in attempts["void"].get("error", "")
    retries = []
    initial = snapshot(h, visit, advance)
    initial_delta = {c:v-before[c] for c,v in balances(h).items()}
    DIAGNOSTICS.update({"before_retry_state":initial,"before_retry_balance_delta":initial_delta})
    verify_clean(initial)
    if hazard and not attempts["release"]["ok"]:
        h.sql(release, f.FINANCE)
        retries.append("release")
    if expected_rejection or (hazard and not attempts["void"]["ok"]):
        h.sql(cancel, cancelling_user)
        retries.append("void")
    snap = snapshot(h, visit, advance)
    after = balances(h)
    delta = {c: after[c]-before[c] for c in CODES}
    detail = {"barriers": evidence, "first_attempts": attempts,
              "expected_ADVANCE_USED": expected_rejection, "state": snap, "balance_delta": delta,
              "explicit_retries":retries,"before_retry_state":initial,"before_retry_balance_delta":initial_delta}
    DIAGNOSTICS.update(detail)
    assert_equal(delta, {"1101":0,"1102":0,"1201":100000,"2103":0,"4201":-100000})
    assert_equal(snap["advance"], {"amount":150000,"applied":0,"status":"batal","released":True})
    assert_equal(snap["applications"], {"count":1,"active":0,"released_amount":100000,"reversals":1})
    assert_equal(snap["receipts"], 1)
    assert_equal(f.Harness.nilai(h, f"select status from public.clinic_payment_receipts where id={f.q(receipt)}"), "batal")
    assert_equal([(x["received"],x["paid_status"]) for x in snap["invoices"]], [(0,"Belum Lunas")])
    verify_clean(snap)
    replay_before = balances(h)
    journal_before = number(h, "select count(*) from public.journal_entries")
    h.sql(cancel, cancelling_user)
    h.sql(release, f.FINANCE)
    assert_equal(balances(h), replay_before)
    assert_equal(number(h, "select count(*) from public.journal_entries"), journal_before)
    detail["numeric_invariants_pass"] = True
    return attempts["release"]["ok"] and (expected_rejection or attempts["void"]["ok"]), detail


def unrelated_customers_race(h, db, n, shared_cashier_shift):
    """Distinct customer coordinators: independent work proceeds; shared shift queues safely."""
    _, visit_a, _, advance_a = fixture(h, n)
    _, visit_b, _, advance_b = fixture(h, n + 1)
    release_a = f.lepas_sql(advance_a, f"cc-{n}-release-a")
    evidence = []
    with Session(db, f"cc-{n}-observer") as obs, Session(db, f"cc-{n}-a", f.FINANCE) as a, Session(db, f"cc-{n}-b", f.FINANCE if shared_cashier_shift else f.OWNER) as b:
        a.sql("begin; " + release_a)
        if shared_cashier_shift:
            action_b = f.lepas_sql(advance_b, f"cc-{n}-release-b")
            b.send("begin; " + action_b)
            wait_block(obs, b, a, evidence)
            a.sql("commit;")
            second = attempt(b)
        else:
            action_b = f.tagih_sql(visit_b, f"cc-{n}-independent-stage", f.baris(n + 1, 2), f.OWNER, alasan="Uji concurrency pelanggan berbeda")
            # Different customers have distinct billing coordinators, but original
            # business functions can still share shift/journal rows. Observe that
            # genuine row wait, then commit the first transaction; completion must
            # not require recovery from a deadlock or timeout.
            b.send("begin; " + action_b)
            wait_block(obs, b, a, evidence)
            assert_equal(evidence[-1]["wait_event_type"], "Lock")
            assert evidence[-1]["wait_event"] in ("transactionid", "tuple"), evidence[-1]
            a.sql("commit;")
            second = attempt(b)
    detail = {"shared_cashier_shift": shared_cashier_shift, "barriers": evidence, "second_attempt": second,
              "a": snapshot(h, visit_a, advance_a), "b": snapshot(h, visit_b, advance_b)}
    DIAGNOSTICS.update(detail)
    assert_equal(second["ok"], True)
    assert_equal(detail["a"]["advance"], {"amount":150000,"applied":0,"status":"aktif","released":True})
    if shared_cashier_shift:
        assert_equal(detail["b"]["advance"], {"amount":150000,"applied":0,"status":"aktif","released":True})
    else:
        assert_equal(detail["b"]["advance"]["applied"], 150000)
        assert_equal(detail["b"]["advance"]["released"], False)
    verify_clean(detail["a"])
    verify_clean(detail["b"])
    return True, detail


def duplicate_race(h, db, n, invoice_first):
    before = balances(h)
    cust = f.buat_pelanggan(h, n)
    visit = f.buat_kunjungan(h, n, cust)
    if invoice_first:
        h.sql(f.tagih_sql(visit, f"cc-{n}-stage-a", f.baris(n,1), f.OWNER,
                           alasan="Uji fiktif concurrency"), f.OWNER)
    key = f"cc-{n}-payment"
    pay = f.bayar_sql(visit, key, [{"method":"Tunai","amount":60000},{"method":"QRIS","amount":90000}])
    evidence = []
    with Session(db, f"cc-{n}-observer") as obs, Session(db, f"cc-{n}-payment-a", f.OWNER) as a, Session(db, f"cc-{n}-payment-b", f.ADMIN) as b:
        first = a.sql("begin; " + pay)[-1]
        b.send("begin; " + pay)
        wait_block(obs, b, a, evidence)
        a.sql("commit;")
        second = attempt(b)
    advance = h.nilai(f"select id from public.clinic_customer_advances where receipt_id={f.q(first)}")
    snap = snapshot(h, visit, advance)
    after = balances(h)
    delta = {c:after[c]-before[c] for c in CODES}
    counts = json.loads(h.nilai("select json_build_object('receipts',count(*),'amount',sum(total)) "
        f"from public.clinic_payment_receipts where request_key={f.q(key)}"))
    parts = json.loads(h.nilai("select json_build_object('count',count(*),'cash',sum(amount) filter(where kas_code='1101'),"
        f"'bank',sum(amount) filter(where kas_code='1102')) from public.clinic_payment_receipt_parts where receipt_id={f.q(first)}"))
    allocations = json.loads(h.nilai("select json_build_object('count',count(*),'amount',coalesce(sum(amount),0)) "
        f"from public.invoice_payments where receipt_id={f.q(first)}"))
    detail = {"barriers":evidence,"first_receipt":first,"second_attempt":second,"state":snap,
              "balance_delta":delta,"receipts":counts,"parts":parts,"allocations":allocations}
    DIAGNOSTICS.update(detail)
    assert_equal(number(h,f"select count(*) from public.clinic_customer_advances where receipt_id={f.q(first)}"),1)
    assert_equal(second.get("result", [None])[-1], first)
    assert_equal(counts, {"receipts":1,"amount":150000})
    assert_equal(parts, {"count":2,"cash":60000,"bank":90000})
    assert_equal(allocations, {"count":2 if invoice_first else 0,"amount":100000 if invoice_first else 0})
    assert_equal(snap["advance"]["amount"], 50000 if invoice_first else 150000)
    assert_equal(snap["advance"]["applied"], 0)
    assert_equal(delta, {"1101":60000,"1102":90000,"1201":0,"2103":-50000 if invoice_first else -150000,"4201":-100000 if invoice_first else 0})
    if invoice_first:
        assert_equal([(x["received"], x["paid_status"]) for x in snap["invoices"]], [(100000,"Lunas")])
    verify_clean(snap)
    journal_before = number(h, "select count(*) from public.journal_entries")
    h.sql(pay, f.OWNER)
    assert_equal(balances(h), after)
    assert_equal(number(h,"select count(*) from public.journal_entries"),journal_before)
    detail["numeric_invariants_pass"] = True
    return second["ok"], detail


def run_case(name, fn):
    DIAGNOSTICS.clear()
    try:
        ok, detail = fn()
        result = {"case": name, "status": "PASS" if ok else "FAIL", "detail":detail}
    except Exception as exc:
        result = {"case":name,"status":"FAIL","error":str(exc),"detail":dict(DIAGNOSTICS)}
    RESULTS.append(result)
    print(result["status"], name, json.dumps(result.get("error") or result["detail"], ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path, default=Path("/opt/data/kamo-ranap-mitigasi-concurrency-results.json"))
    parser.add_argument("--migration-revision", help="Replay only corrective SQL from this git revision (RED baseline)")
    args = parser.parse_args()
    head = subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip()
    started = time.monotonic()
    version = None
    try:
        with contextlib.ExitStack() as stack, BoundedPostgres(f.BIN) as db:
            f.fixture.ROOT = f.siapkan_migrasi(args.migration_revision, stack)
            f.fixture.DisposablePostgres.bootstrap(db)
            version = db.sql("show server_version;")

            h = f.Harness(db)
            h.sql(f.dasar_sql())
            cases = [
                ("release-first-vs-next-stage",lambda:stage_race(h,db,201,"release")),
                ("next-stage-first-vs-release",lambda:stage_race(h,db,202,"stage")),
                ("release-first-vs-other-visit-stage",lambda:stage_race(h,db,203,"release",other_visit=True)),
                ("overlapping-release-stage-lock-order",lambda:stage_race(h,db,204,"release",hazard=True)),
                ("release-first-vs-receipt-void",lambda:cancel_race(h,db,205)),
                ("receipt-void-first-vs-release",lambda:cancel_race(h,db,206,cancellation_first=True)),
                ("overlapping-release-void-same-cashier-lock-order",lambda:cancel_race(h,db,209,hazard=True)),
                ("duplicate-payment-before-invoice",lambda:duplicate_race(h,db,207,False)),
                ("duplicate-payment-allocated-and-advance",lambda:duplicate_race(h,db,208,True)),
                ("different-customers-same-cashier-shift",lambda:unrelated_customers_race(h,db,211,True)),
                ("different-customers-existing-row-lock-queues",lambda:unrelated_customers_race(h,db,213,False)),
            ]
            for name, fn in cases:
                run_case(name,fn)
            final = {"context_rows":number(h,"select count(*) from clinic_private.posting_ctx"),
                     "unbalanced_journals":number(h,"select count(*) from (select entry_id from public.journal_lines group by entry_id having sum(debit)<>sum(credit)) x")}
            run_case("final-context-and-journal-clean",lambda:(final=={"context_rows":0,"unbalanced_journals":0},final))
    except Exception as exc:
        RESULTS.append({"case":"HARNESS","status":"FAIL","error":str(exc)})
    totals = {s:sum(r["status"]==s for r in RESULTS) for s in ("PASS","FAIL")}
    report = {"head":head,"postgres_version":version,"migrations":len(list((ROOT/"supabase/migrations").glob("*.sql"))),
        "scope":"local disposable native PostgreSQL; fictional fixtures; original public RPCs as authenticated",
        "driver":"stdlib subprocess + psql (no installed Python PostgreSQL driver)",
        "timeouts_seconds":{"statement":8,"lock":6,"client":TIMEOUT,"barrier":5},
        "duration_seconds":round(time.monotonic()-started,3),"total":totals,"cases":RESULTS,
        "limits":["Deterministic bounded schedules, not exhaustive schedule exploration or load testing.",
                  "No network, production, UI, PostgREST, authenticated browser UAT, merge, push or deploy.",
                  "Auth/storage are fictional platform shims; complete business migrations unmodified.",
                  "A third gate/observer connection coordinates locks only; monetary calls use independent authenticated sessions.",
                  "Monetary scenarios use jasa; concurrent stock/FIFO/HPP mutation is outside this test.",
                  "Deadlock recovery is reported separately and never upgrades the failed first attempt to PASS."]}
    args.json.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n")
    print("TOTAL",json.dumps(totals),str(args.json),flush=True)
    return 1 if totals["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
