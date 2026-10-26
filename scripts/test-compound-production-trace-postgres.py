#!/usr/bin/env python3
"""I09 exact source-link fixture in an owned network-isolated PostgreSQL container."""
from pathlib import Path
import importlib.util
import sys

sys.dont_write_bytecode = True
root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("isolated", root / "scripts/test-accurate-inventory-accounting-postgres.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.IMAGE = "postgres:17.6"

with module.DisposablePostgres() as db:
    db.bootstrap()
    db.sql((root / "supabase/tests/compound_production_layer_trace.sql").read_text())
    print("PASS exact FIFO-to-production lineage, denied role, restored flag, and ambiguous source", flush=True)
