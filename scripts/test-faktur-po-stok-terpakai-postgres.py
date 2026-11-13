#!/usr/bin/env python3
"""Faktur PO saat barang sudah terpakai + harga PO maksimal 2 desimal: bukti pada PostgreSQL native sekali pakai.

Tidak pernah memakai URL database. Memasang semua migrasi repo (data fiktif), lalu:
  1. GREEN: supabase/tests/faktur_po_stok_terpakai.sql harus lulus dengan kedua migrasi kandidat.
  2. RED:   tambalan faktur dibalik -> tes yang sama harus GAGAL (membuktikan tes menguji perilaku baru).
  3. Suite tetangga (PO / penerimaan / faktur) dijalankan DENGAN dan TANPA kedua kandidat; hasil harus identik.

  python3 -I scripts/test-faktur-po-stok-terpakai-postgres.py --pg-bin /usr/lib/postgresql/16/bin
"""
import argparse
import importlib.util
import os
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from native_postgres import NativePostgres  # noqa: E402

os.environ['PGTZ'] = 'Asia/Jakarta'
TEST = ROOT / 'supabase/tests/faktur_po_stok_terpakai.sql'
PATCH = ROOT / 'supabase/migrations/20261117110000_faktur_po_stok_terpakai_harga_sama.sql'
NEIGHBOURS = ['purchase_order_lifecycle.sql', 'goods_receipt_cancellation.sql', 'n01_purchase_invoice_receipts.sql',
              'purchase_invoice_lifecycle.sql', 'purchase_invoice_line_correction.sql', 'purchase_order_line_correction.sql',
              'average_purchase_corrections.sql', 'purchase_recovery.sql',
              'purchase_short_close.sql', 'purchase_correction_requests.sql']
SIG = "public.create_purchase_invoice_from_po(uuid,text,integer,text,date,date,text,jsonb,jsonb,jsonb,numeric,text,uuid)"


def owner_updates(source):
    # Sama dengan test-posted-sales-postgres.py: ubah peran fiktif tanpa sesi aktor agar penjaga hak akses tidak menolak.
    return re.sub(r"(?m)^update profiles (.*);$", r"alter table profiles disable trigger guard_profile_privileges;\nselect set_config('test.fixture_actor',coalesce(current_setting('request.jwt.claim.sub',true),''),true);\nselect set_config('request.jwt.claim.sub','',true);\nupdate profiles \1;\nselect set_config('request.jwt.claim.sub',current_setting('test.fixture_actor',true),true);\nalter table profiles enable trigger guard_profile_privileges;", source)


def suite_text(path):
    if path.name == 'average_purchase_corrections.sql':
        # Suite ini tidak berdiri sendiri: runner aslinya menempelkan fixture faktur + saldo awal average di depannya.
        base = (ROOT / 'supabase/tests/purchase_invoice_lifecycle.sql').read_text()
        return (base[:base.index('set local role authenticated;')]
                + (ROOT / 'supabase/tests/fixtures/average_opening_gl.sql').read_text() + path.read_text())
    return path.read_text()


def run_suite(db, path):
    text = owner_updates(suite_text(path)).replace('__MODE__', 'fifo')
    try:
        db.sql(text)
        return 'PASS'
    except RuntimeError as exc:
        m = re.search(r'ERROR:[^\n]*', str(exc))
        return 'FAIL ' + re.sub(r'[0-9a-f]{8}-[0-9a-f-]{27}', '<uuid>', (m.group(0) if m else str(exc)[-200:]))[:220]


def anchors():
    text = PATCH.read_text()
    old = re.search(r"\$a\$(.*?)\$a\$", text, re.S).group(1)
    new = re.search(r"\$b\$(.*?)\$b\$", text, re.S).group(1)
    return old, new


def set_function(db, from_text, to_text):
    q = lambda s: "$x$" + s + "$x$"
    db.sql(f"""do $d$ declare v text:=pg_get_functiondef('{SIG}'::regprocedure); begin
 if position({q(from_text)} in v)=0 then raise exception 'anchor missing'; end if;
 execute replace(v,{q(from_text)},{q(to_text)}); end $d$;""")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--pg-bin', required=True)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/test-accurate-inventory-accounting-postgres.py')
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)
    failures = []
    with NativePostgres(args.pg_bin) as db:
        fixture.DisposablePostgres.bootstrap(db)
        green = run_suite(db, TEST)
        print('GREEN faktur_po_stok_terpakai.sql:', green, flush=True)
        if green != 'PASS':
            failures.append('green')
        with_candidates = {name: run_suite(db, ROOT / 'supabase/tests' / name) for name in NEIGHBOURS}

        old, new = anchors()
        set_function(db, new, old)
        db.sql('drop trigger purchase_order_item_price_cents on public.purchase_order_items;')
        red = run_suite(db, TEST)
        print('RED   faktur_po_stok_terpakai.sql (tanpa kandidat):', red, flush=True)
        if red == 'PASS':
            failures.append('red-not-failing')
        without = {name: run_suite(db, ROOT / 'supabase/tests' / name) for name in NEIGHBOURS}
        for name in NEIGHBOURS:
            same = with_candidates[name] == without[name]
            print(f"{'SAMA ' if same else 'BEDA '} {name}: dengan={with_candidates[name]} | tanpa={without[name]}", flush=True)
            if not same:
                failures.append(name)
    if failures:
        sys.exit('GAGAL: ' + ', '.join(failures))
    print('OK: semua pemeriksaan lulus.')


if __name__ == '__main__':
    main()
