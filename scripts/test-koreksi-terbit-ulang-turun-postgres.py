#!/usr/bin/env python3
"""Koreksi nota hasil Void & Terbit Ulang (Lunas, correction_pending) yang MENURUNKAN total di bawah uang yang sudah diterima.

Kasus nyata 17 Nov 2026 (INV-202611-1285, Grooming 90.000 QRIS lunas, Owner ingin diskon 50%): layar menjawab
"Nilai atau rincian invoice tidak konsisten." Skrip ini memutar ulang muatan ASLI aplikasi (capture dari bayarVisit lewat vitest,
file JSON --payloads) pada database native PG17 sekali pakai dengan rantai migrasi penuh. Tidak menerima URL database, tanpa jaringan.

  python3 -I scripts/test-koreksi-terbit-ulang-turun-postgres.py --pg-bin /opt/data/kamo-pg-harness/bin --payloads FILE [--json out.json]

Hasil yang diharapkan HARI INI (diagnosis): varian (a) diskon baris 50%, (b) harga 45.000, (c) diskon invoice 45.000 SEMUA ditolak dengan
'INVOICE_INVALID: nilai koreksi tidak konsisten' karena total baru < uang diterima (90.000, dipindahkan dari nota lama); varian (d) total tetap
90.000 lolos; menaikkan total lolos; total sama tetapi metode berbeda ditolak.
"""
import argparse, importlib.util, json, os, sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('bk', ROOT / 'scripts/test-batalkan-penerimaan-klinik-postgres.py'); assert spec and spec.loader
bk = importlib.util.module_from_spec(spec); spec.loader.exec_module(bk)
okr, x, r, q, j = bk.okr, bk.x, bk.r, bk.q, bk.j
RESULTS = []
NEXT = [9100]


def check(name, ok, detail=None, kind='feature'):
    RESULTS.append(dict(case=name, kind=kind, status='PASS' if ok else 'FAIL', detail=detail))
    print(RESULTS[-1]['status'], f'[{kind}]', name, json.dumps(detail, default=str)[:500], flush=True)


def nxt():
    NEXT[0] += 3; return NEXT[0]


def err(h, sql, user=None):
    try: h.sql(sql, user or r.OWNER); return None
    except RuntimeError as e: return str(e)


def lines90(n, bump=0):
    ls = r.baris(n, 1)
    ls[0] = dict(ls[0], price=90000 + bump)
    return ls


def reissued(h, metode='QRIS'):
    """Nota Lunas 90.000 (1 baris jasa) -> Void & Terbit Ulang -> nota pengganti correction_pending dengan pembayaran dipindahkan."""
    n = nxt(); cust = r.buat_pelanggan(h, n); v = r.buat_kunjungan(h, n, cust, admitted=False); ls = lines90(n)
    h.sql(r.tagih_biasa_sql(v, f'k{n}-post', ls, r.OWNER, alasan='Uji fiktif', ganti={'paid_status': 'Lunas', 'metode_bayar': metode, 'dp_amount': 0, 'dp_date': None}), r.OWNER)
    old = h.aktif(v)
    new = h.nilai(r.terbit_ulang_sql(old, f'k{n}-reissue', 'harusnya disc'), r.OWNER)
    return dict(n=n, v=v, old=old, inv=new, no=h.no_tagihan(new), line=ls[0])


def edit_sql(inv, key, p_invoice, lines):
    return f"select public.clinic_edit_invoice({q(inv)},{q(key)},{j(p_invoice)},{j(lines)});"


def from_payload(F, rec, metode=None):
    """Muatan aplikasi asli; hanya item_id/unit/deskripsi dipetakan ke baris fixture (id dummy 'item' di tiruan)."""
    c = [c for c in rec['call'] if c['params'].get('p_invoice')][0]['params']
    inv = dict(c['p_invoice'])
    if metode: inv['metode_bayar'] = metode
    ls = []
    for ln in c['p_lines']:
        ls.append(dict(ln, description=F['line']['description'], item_id=F['line']['item_id'], unit=F['line']['unit'],
                       prescription_item_id=F['line']['prescription_item_id']))
    return inv, ls


def state(h, inv):
    return json.loads(h.nilai(f"select jsonb_build_object('subtotal',subtotal,'discount',discount,'total',total,'status',paid_status,'pending',correction_pending) from public.invoices where id={q(inv)}"))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path); ap.add_argument('--payloads', type=Path, default=ROOT / 'scripts/fixtures/koreksi-turun-payload-aplikasi.json')
    ap.add_argument('--pg-bin', default=os.environ.get('PG_BIN', '/opt/data/kamo-pg-harness/bin')); a = ap.parse_args()
    pay = json.loads(a.payloads.read_text())
    try:
        with r.NativePostgres(a.pg_bin) as db:
            okr.build(db, set())
            h = x.Harness(db); x.setup(h)
            r.TGL = h.nilai("select current_date::text")
            # ---- fixture sanity
            F = reissued(h)
            s = state(h, F['inv'])
            cred = h.angka(f"select coalesce(sum(amount),0) from public.invoice_payments where invoice_id={q(F['inv'])}")
            check('fixture: nota pengganti Lunas, correction_pending, 90.000, pembayaran dipindahkan 90.000 (sama dengan INV-202611-1285)',
                  s['status'] == 'Lunas' and s['pending'] and int(s['total']) == 90000 and int(cred) == 90000, dict(s=s, credit=str(cred)), 'regression')
            MSG = 'INVOICE_INVALID: nilai koreksi tidak konsisten'
            for key, label in (('a_line_discount_50', '(a) diskon baris 50% (subtotal 45.000 bersih, baris 90.000 diskon_persen 50)'),
                               ('b_price_45000', '(b) harga baris diubah 45.000 (subtotal 45.000)'),
                               ('c_invoice_discount_45000', '(c) diskon invoice 45.000 (subtotal 90.000, discount 45.000)')):
                F = reissued(h)
                inv, ls = from_payload(F, pay[key])
                e = err(h, edit_sql(F['inv'], f'k{F["n"]}-e', inv, ls))
                s = state(h, F['inv'])
                check(f'turun {label}: ditolak {MSG}, tidak ada yang tersimpan (total tetap 90.000, masih correction_pending)',
                      bool(e) and MSG in e and int(s['total']) == 90000 and s['pending'], dict(e=(e or '')[:200], s=s))
            # kontrol: total tetap 90.000 lolos dan menyelesaikan koreksi
            F = reissued(h); inv, ls = from_payload(F, pay['d_unchanged_90000'])
            e = err(h, edit_sql(F['inv'], f'k{F["n"]}-e', inv, ls)); s = state(h, F['inv'])
            check('kontrol (d): total tetap 90.000 lolos dan koreksi selesai (correction_pending false)', e is None and not s['pending'] and int(s['total']) == 90000, dict(e=(e or '')[:200], s=s), 'regression')
            # kontrol: total naik lolos
            F = reissued(h); inv, ls = from_payload(F, pay['d_unchanged_90000'])
            inv = dict(inv, subtotal=100000, total=100000, paid_status='DP'); ls = [dict(ls[0], price=100000)]
            e = err(h, edit_sql(F['inv'], f'k{F["n"]}-e', inv, ls)); s = state(h, F['inv'])
            check('kontrol: total naik 100.000 (status DP) lolos', e is None and int(s['total']) == 100000 and s['status'] == 'DP', dict(e=(e or '')[:200], s=s), 'regression')
            # kontrol: total turun tetapi status dibiarkan Lunas -> ditolak oleh alasan yang sama (bukan soal status)
            F = reissued(h); inv, ls = from_payload(F, pay['b_price_45000'])
            e = err(h, edit_sql(F['inv'], f'k{F["n"]}-e', dict(inv, paid_status='DP'), ls))
            check('kontrol: total turun dengan status DP juga ditolak (uang diterima melebihi total baru)', bool(e) and MSG in e, (e or '')[:200])
            # kontrol: jalur lain yang menyelesaikan masalah yang sama tidak ada: refund/batal penerimaan ditolak untuk nota correction_pending
            F = reissued(h)
            e = err(h, f"select public.clinic_cancel_invoice_receipt({q(F['inv'])},{q('c-' + str(F['n']))},'uji');")
            check('kontrol: Batalkan penerimaan pada nota correction_pending ditolak (KOREKSI_BERJALAN/selesaikan dulu)', bool(e), (e or '')[:240], 'regression')
    except Exception as e:
        check('HARNESS', False, str(e)[:800], 'harness')
    ok = all(c['status'] == 'PASS' for c in RESULTS)
    print(f"{sum(c['status'] == 'PASS' for c in RESULTS)}/{len(RESULTS)} PASS", flush=True)
    if a.json: a.json.write_text(json.dumps(dict(ok=ok, results=RESULTS), indent=1, default=str))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
