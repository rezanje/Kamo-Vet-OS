#!/usr/bin/env python3
"""Cadangan & pemulihan TERTARGET untuk migrasi mitigasi tagihan berjalan rawat inap.

Rollback migrasi ini TIDAK BOLEH menjatuhkan apa pun yang menyimpan jejak uang:
`clinic_private` dipakai bersama fitur lain, dan kolom/tabel jejak baru (pelepasan
uang muka, penanda tagihan tahap, permintaan pelepasan) sudah berisi riwayat begitu
fiturnya dipakai. Yang dipulihkan hanyalah DEFINISI FUNGSI dan HAK AKSESNYA, plus
pencabutan pemicu yang memang dibuat migrasi ini.

Alatnya sengaja OFFLINE: ia tidak pernah membuka koneksi sendiri dan tidak menerima
URL atau kredensial. Ia hanya menghasilkan SQL:

  python3 scripts/rollback-ranap-mitigasi.py --cadangkan > ambil-cadangan.sql
      Jalankan di konsol SQL target SEBELUM migrasi dipasang. Keluarannya satu
      baris JSON — simpan sebagai berkas cadangan.

  python3 scripts/rollback-ranap-mitigasi.py --pulihkan cadangan.json > rollback.sql
      SQL pemulihan tertarget: `create or replace` definisi lama, hak aksesnya
      dikembalikan apa adanya, pemicu baru dicabut, RPC baru dibekukan (EXECUTE
      dicabut) tanpa dihapus. Tidak ada DROP SCHEMA/TABLE/COLUMN dan tidak ada
      DELETE satu baris pun.

  python3 scripts/rollback-ranap-mitigasi.py --uji
      Uji pulang-pergi di klaster PostgreSQL lokal sekali pakai (lihat
      scripts/test-ranap-mitigasi-rollback-postgres.py yang memakainya).
"""
import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]

# Fungsi yang dibuat, diganti, atau ditambal migrasi mitigasi. Urutannya dipakai apa
# adanya saat memulihkan; `create or replace` tidak peduli urutan pemanggilan.
FUNGSI = [
    "clinic_private.stage_billing(uuid)",
    "clinic_private.billing_key(uuid,uuid,uuid)",
    "clinic_private.billing_lock(text[])",
    "clinic_private.billing_keys_visit(uuid)",
    "clinic_private.billing_keys_invoice(uuid)",
    "clinic_private.billing_keys_advance(uuid)",
    "clinic_private.billing_keys_receipt(uuid)",
    "clinic_private.context_begin(text,uuid)",
    "clinic_private.context_end()",
    "clinic_private.posting_context(uuid)",
    "clinic_private.dp_deferred(uuid)",
    "clinic_private.sync_paid_status(uuid)",
    "clinic_private.active_invoice(uuid)",
    "clinic_private.receipt_allocations(uuid)",
    "clinic_private.payments_fully_reversed(uuid)",
    "public.clinic_release_advance_application(uuid,text,text)",
    "public.clinic_post_inpatient_stage_invoice(uuid,text,jsonb,jsonb)",
    "public.clinic_receive_visit_payment(uuid,text,date,jsonb,uuid,text)",
    "public.clinic_void_payment_receipt(uuid,text,text)",
    "public.clinic_post_invoice(uuid,text,jsonb,jsonb)",
    "public.clinic_post_split_invoice(uuid,text,jsonb,jsonb,jsonb)",
    "public.clinic_post_demo_invoice(uuid,text,jsonb,jsonb,uuid,jsonb,uuid[])",
    "public.clinic_receive_invoice_payment(uuid,date,numeric,text,text,text,text)",
    "public.clinic_void_reissue_invoice_core(uuid,text,text)",
    "public.clinic_void_reissue_invoice(uuid,text,text)",
    "public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)",
    "public.clinic_edit_invoice(uuid,text,jsonb,jsonb)",
    "public.clinic_invoice_correction_eligible(uuid)",
    "public.clinic_change_inpatient_condition(uuid,text,text)",
    "public.guard_invoice_item_billed_once_final()",
]

PEMICU = [("public.invoice_items", "guard_invoice_item_billed_once_final")]

PERAN = ["public", "anon", "authenticated", "service_role"]

# Objek penyimpan jejak yang TIDAK PERNAH disentuh pemulihan; hanya diperiksa agar
# pemulihan yang salah ketik langsung ketahuan.
JEJAK = [
    ("tabel", "clinic_private.posting_ctx"),
    ("tabel", "public.clinic_advance_release_requests"),
    ("kolom", "public.invoices.stage_billing"),
    ("kolom", "public.clinic_advance_applications.released_at"),
    ("kolom", "public.clinic_customer_advances.release_request_key"),
]


def cadangkan_kueri():
    """Kueri baca-saja yang memulangkan satu baris JSON berisi seluruh cadangan."""
    fungsi = ",".join("('" + f.replace("'", "''") + "')" for f in FUNGSI)
    pemicu = ",".join(f"('{t}','{n}')" for t, n in PEMICU)
    return f"""select jsonb_pretty(jsonb_build_object(
  'versi', 1,
  'diambil_pada', now(),
  'fungsi', coalesce((
    select jsonb_object_agg(s.sig, case when p.oid is null then jsonb_build_object('ada', false)
      else jsonb_build_object('ada', true, 'definisi', pg_get_functiondef(p.oid),
        'pemilik', pg_get_userbyid(p.proowner),
        'acl', coalesce(array_to_json(p.proacl)::jsonb, 'null'::jsonb)) end)
    from (values {fungsi}) as s(sig)
    left join pg_proc p on p.oid = to_regprocedure(s.sig)), '{{}}'::jsonb),
  'pemicu', coalesce((
    select jsonb_object_agg(t.rel || '.' || t.nama, case when g.oid is null then jsonb_build_object('ada', false)
      else jsonb_build_object('ada', true, 'definisi', pg_get_triggerdef(g.oid)) end)
    from (values {pemicu}) as t(rel, nama)
    left join pg_trigger g on g.tgrelid = to_regclass(t.rel) and g.tgname = t.nama
      and not g.tgisinternal), '{{}}'::jsonb)
))"""


def cadangkan_sql():
    return ("-- Cadangan tertarget mitigasi ranap. Baca-saja: tidak mengubah apa pun.\n"
            "-- Jalankan SEBELUM migrasi 20261103010000 dipasang, simpan keluarannya sebagai JSON.\n"
            + cadangkan_kueri() + ";\n")


def _hak(sig, acl, pemilik):
    """Kembalikan hak akses fungsi persis seperti saat dicadangkan."""
    baris = [f"revoke all on function {sig} from {', '.join(PERAN)};"]
    for item in acl or []:
        penerima = str(item).split("=", 1)[0]
        if penerima in PERAN and "X" in str(item).split("=", 1)[1].split("/")[0]:
            baris.append(f"grant execute on function {sig} to {penerima};")
    if pemilik:
        baris.append(f"-- pemilik saat dicadangkan: {pemilik}")
    return baris


def pulihkan_sql(cadangan):
    if cadangan.get("versi") != 1:
        raise SystemExit("Berkas cadangan bukan versi 1")
    keluar = [
        "-- Rollback TERTARGET migrasi 20261103010000 (mitigasi tagihan berjalan rawat inap).",
        "-- Ditinjau untuk dijalankan operator; TIDAK pernah dijalankan otomatis oleh skrip ini.",
        "--",
        "-- Yang dikembalikan: definisi fungsi dan hak aksesnya persis seperti pada cadangan,",
        "-- serta pencabutan pemicu yang dibuat migrasi ini.",
        "-- Yang SENGAJA TIDAK disentuh: skema clinic_private (dipakai bersama fitur lain),",
        "-- tabel/kolom jejak baru, dan seluruh baris uang (invoice_payments, journal_entries,",
        "-- clinic_payment_receipts, clinic_customer_advances). Tidak ada DROP atau DELETE.",
        "--",
        f"-- Cadangan diambil pada: {cadangan.get('diambil_pada')}",
        "begin;",
    ]
    for sig in FUNGSI:
        simpan = cadangan["fungsi"].get(sig, {"ada": False})
        if simpan.get("ada"):
            keluar.append("")
            keluar.append(f"-- {sig}: definisi dikembalikan ke keadaan sebelum migrasi")
            keluar.append(simpan["definisi"].rstrip().rstrip(";") + ";")
            keluar.extend(_hak(sig, simpan.get("acl"), simpan.get("pemilik")))
        else:
            keluar.append("")
            keluar.append(f"-- {sig}: belum ada sebelum migrasi — DIBEKUKAN, bukan dihapus,")
            keluar.append("--   supaya jejak pemakaiannya tetap dapat ditelusuri.")
            keluar.append(f"do $$ begin if to_regprocedure('{sig}') is not null then")
            keluar.append(f"  execute 'revoke all on function {sig} from {', '.join(PERAN)}';")
            keluar.append("end if; end $$;")
    for rel, nama in PEMICU:
        simpan = cadangan["pemicu"].get(f"{rel}.{nama}", {"ada": False})
        keluar.append("")
        if simpan.get("ada"):
            keluar.append(f"drop trigger if exists {nama} on {rel};")
            keluar.append(simpan["definisi"].rstrip().rstrip(";") + ";")
        else:
            keluar.append(f"-- {nama}: dibuat migrasi ini, dicabut tanpa menyentuh satu baris pun")
            keluar.append(f"drop trigger if exists {nama} on {rel};")
    keluar.append("")
    keluar.append("commit;")
    return "\n".join(keluar) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    kelompok = parser.add_mutually_exclusive_group(required=True)
    kelompok.add_argument("--cadangkan", action="store_true", help="cetak kueri pengambil cadangan")
    kelompok.add_argument("--pulihkan", type=Path, help="cetak SQL pemulihan dari berkas cadangan JSON")
    args = parser.parse_args()
    if args.cadangkan:
        sys.stdout.write(cadangkan_sql())
    else:
        sys.stdout.write(pulihkan_sql(json.loads(args.pulihkan.read_text())))


if __name__ == "__main__":
    main()
