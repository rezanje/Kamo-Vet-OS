#!/usr/bin/env python3
"""LOKAL SAJA: penjaga snapshot alokasi pembayaran POS (sale_payments + sale_payment_refunds).

Memasang SELURUH migrasi repositori ke klaster PostgreSQL native sekali pakai (tanpa Docker,
tanpa URL basis data), lalu menjalankan supabase/tests/pos_sale_allocation_immutable.sql:
  - hapus/ubah sale_payment_refunds selagi retur penjualannya masih ada harus ditolak dengan
    'Snapshot alokasi pembayaran sudah tetap' (bukan 'record "old" has no field "sale_id"');
  - jalur sale_payments (gerbang koreksi, larangan pindah induk, snapshot beku, RPC koreksi
    OWNER) tetap sama.

  --tanpa-perbaikan   pasang semua migrasi KECUALI 20261104370000 (bukti RED pada main)

Semua fixture fiktif dan di-rollback. Keluar 0 hanya bila tes lulus.
Pemakaian: KAMO_PG_BIN=/usr/lib/postgresql/16/bin python3 scripts/test-pos-sale-allocation-immutable-postgres.py
"""
import argparse
import contextlib
import importlib.util
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

BIN = os.environ.get("KAMO_PG_BIN", "/usr/lib/postgresql/16/bin")
PERBAIKAN = "20261104370000_pos_sale_allocation_immutable_refunds.sql"
TES = ROOT / "supabase/tests/pos_sale_allocation_immutable.sql"


def akar_tanpa_perbaikan(stack):
    tmp = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="kamo-alloc-red.")))
    (tmp / "supabase/migrations").mkdir(parents=True)
    shutil.copytree(ROOT / "supabase/tests/fixtures", tmp / "supabase/tests/fixtures")
    for m in sorted((ROOT / "supabase/migrations").glob("*.sql")):
        if m.name != PERBAIKAN:
            shutil.copy(m, tmp / "supabase/migrations" / m.name)
    return tmp


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tanpa-perbaikan", action="store_true")
    args = parser.parse_args()
    os.makedirs("/opt/data", exist_ok=True)
    with contextlib.ExitStack() as stack:
        fixture.ROOT = akar_tanpa_perbaikan(stack) if args.tanpa_perbaikan else ROOT
        db = stack.enter_context(NativePostgres(BIN))
        fixture.DisposablePostgres.bootstrap(db)
        mode = "TANPA PERBAIKAN (RED main)" if args.tanpa_perbaikan else "DENGAN PERBAIKAN"
        try:
            db.sql(TES.read_text())
        except RuntimeError as error:
            print(f"FAIL {TES.name} [{mode}]:\n{str(error).strip()}", flush=True)
            return 1
        print(f"PASS {TES.name} [{mode}]: refund allocations reject with the business message; "
              "sale_payments gate/parent/snapshot paths unchanged.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
