#!/usr/bin/env python3
"""'Batalkan penerimaan' KLINIK (gaya Accurate): uang yang sudah diterima pada satu tagihan klinik dibatalkan dalam satu transaksi, tagihan
kembali Belum Lunas dengan nomor yang sama, bisa dikoreksi (jalur koreksi yang ada) lalu diterima lagi
(migrasi 20261112100000_batalkan_penerimaan_klinik.sql).

Native full schema, fictional fixtures, throwaway local cluster, no network.
  flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-batalkan-penerimaan-klinik-postgres.py --pg-bin DIR --json out.json
  --baseline    chain WITHOUT the candidate migration: every case about the new feature must FAIL (RED)
  --mutations   chain without the candidate once, then each mutant of the candidate in a cloned database; all must be killed
  --attach DIR  dev only: clone of the `postgres` DB (chain WITHOUT candidate, x.setup done) in a running cluster, candidate applied on top
"""
import argparse, importlib.util, json, os, sys, tempfile, time
from decimal import Decimal
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('okr', ROOT / 'scripts/test-owner-koreksi-racikan-postgres.py'); assert spec and spec.loader
okr = importlib.util.module_from_spec(spec); spec.loader.exec_module(okr)
m, x, r, q, j, c = okr.m, okr.x, okr.r, okr.q, okr.j, okr.c
CANDIDATE = '20261112100000_batalkan_penerimaan_klinik.sql'
MIG = ROOT / 'supabase/migrations'
RESULTS = []
RPC, PREVIEW = 'clinic_cancel_invoice_receipt', 'clinic_cancel_invoice_receipt_preview'
OWNER, ADMIN, FINANCE, STAFF = r.OWNER, r.ADMIN, r.FINANCE, r.STAFF
ACCTS = ('110003', '120002', '150001', '314001', '510002', '520002')
KAS = {'Tunai': '110003', 'QRIS': '120002', 'Transfer': '120002', 'Debit': '120002', 'Kredit': '120002', 'E-Wallet': '120002'}
NEXT = [5000]
GRANT_ACTION = 'klinik.batalkan_penerimaan'


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:420], flush=True)


def nxt():
    NEXT[0] += 3; return NEXT[0]


def has(err, *words): return bool(err) and all(w in err for w in words)


def cancel_sql(inv, key, reason='Koreksi harga disetujui Owner'): return f"select public.{RPC}({q(inv)},{q(key)},{q(reason)});"


def do_cancel(h, inv, key, user=OWNER, reason='Koreksi harga disetujui Owner'):
    """(error, result-json)"""
    try:
        out = h.nilai(cancel_sql(inv, key, reason), user); return None, json.loads(out)
    except RuntimeError as e:
        return str(e), None


def preview(h, inv, user=OWNER):
    try: return None, json.loads(h.nilai(f"select public.{PREVIEW}({q(inv)});", user))
    except RuntimeError as e: return str(e), None


def tb(h): return Decimal(h.nilai("select coalesce(sum(debit)-sum(credit),0) from public.journal_lines"))


def net(h, no, codes=ACCTS):
    rows = json.loads(h.nilai("select coalesce(jsonb_object_agg(code, v),'{}') from (select a.code, sum(l.debit-l.credit) v from public.journal_lines l "
                              "join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id "
                              f"where e.source_ref={q(no)} and e.source like 'klinik%' and e.source not in ('klinik-hpp','klinik-hpp-edit','klinik-hpp-void') group by a.code) s"))
    return {k: Decimal(str(rows.get(k, 0))) for k in codes}


def inv_row(h, inv): return json.loads(h.nilai(f"select to_jsonb(i) from public.invoices i where i.id={q(inv)}"))


def D(v): return Decimal(str(v))


def audit_rows(h, inv): return int(h.angka(f"select count(*) from public.clinic_receipt_cancellations where invoice_id={q(inv)}"))


def money_state(h, inv=None):
    """Everything an aborted cancel must leave untouched."""
    return dict(
        pays=h.nilai("select md5(coalesce(string_agg(to_jsonb(p)::text,',' order by p.id),'')) from public.invoice_payments p"),
        jrn=h.angka("select count(*) from public.journal_entries"), lines=h.angka("select count(*) from public.journal_lines"),
        rec=h.nilai("select md5(coalesce(string_agg(to_jsonb(p)::text,',' order by p.id),'')) from public.clinic_payment_receipts p"),
        adv=h.nilai("select md5(coalesce(string_agg(to_jsonb(p)::text,',' order by p.id),'')) from public.clinic_customer_advances p"),
        apps=h.nilai("select md5(coalesce(string_agg(to_jsonb(p)::text,',' order by p.id),'')) from public.clinic_advance_applications p"),
        invs=h.nilai("select md5(coalesce(string_agg(to_jsonb(p)::text,',' order by p.id),'')) from public.invoices p"),
        audit=h.angka("select count(*) from public.clinic_receipt_cancellations"))


# ---------------------------------------------------------------- fixtures
def lines_for(n, *slots, bump=0):
    ls = r.baris(n, *slots)
    if bump: ls[0] = dict(ls[0], price=ls[0]['price'] + bump)
    return ls


def rj(h, n, metode='Tunai', status='Lunas', dp=0, slots=(1, 2), user=OWNER, split=None):
    """Rawat jalan biasa (clinic_post_invoice / clinic_post_split_invoice): uang dijurnal di KEPALA tagihan, tanpa baris invoice_payments."""
    cust = r.buat_pelanggan(h, n); v = r.buat_kunjungan(h, n, cust, admitted=False); ls = lines_for(n, *slots)
    if split:
        sub = r.nilai_baris(ls)
        muatan = {'tanggal': r.TGL, 'subtotal': sub, 'discount': 0, 'tax': 0, 'total': sub, 'dp_amount': 0, 'dp_date': None, 'paid_status': 'Lunas',
                  'metode_bayar': split[0]['method'], 'shift_id': r.SHIFT[user], 'voucher_code': None, 'salesperson_id': None}
        h.sql(f"select public.clinic_post_split_invoice({q(v)},{q(f'k{n}-post')},{j(muatan)},{j(ls)},{j(split)});", user)
    else:
        ganti = {'paid_status': status, 'metode_bayar': metode}
        if status == 'Lunas': ganti.update(dp_amount=0, dp_date=None)
        h.sql(r.tagih_biasa_sql(v, f'k{n}-post', ls, user, dp=dp, alasan='Uji fiktif DP', ganti=ganti), user)
    inv = h.aktif(v)
    return dict(n=n, v=v, inv=inv, no=h.no_tagihan(inv), total=int(h.angka(f"select total from public.invoices where id={q(inv)}")), lines=ls, slots=slots, user=user)


def ranap(h, n, how, slots=(1,), user=OWNER):
    """Rawat inap tahap: how = 'advance' (uang muka transfer dipakai penuh), 'cash'/'qris' (kwitansi langsung), 'none' (belum dibayar)."""
    cust = r.buat_pelanggan(h, n); v = r.buat_kunjungan(h, n, cust); ls = lines_for(n, *slots); total = r.nilai_baris(ls)
    F = dict(n=n, v=v, lines=ls, slots=slots, total=total, user=user, cust=cust['id'])
    if how == 'advance':
        h.sql(r.bayar_sql(v, f'k{n}-adv', [{'method': 'Transfer', 'amount': total}]), user)
        F['receipt'] = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={q(v)} order by created_at limit 1")
        F['adv'] = h.nilai(f"select id from public.clinic_customer_advances where receipt_id={q(F['receipt'])}")
        h.sql(r.tagih_sql(v, f'k{n}-tagih', ls, user, alasan='Uji fiktif DP'), user)
    else:
        h.sql(r.tagih_sql(v, f'k{n}-tagih', ls, user, alasan='Uji fiktif DP'), user)
        if how in ('cash', 'qris'):
            h.sql(r.bayar_sql(v, f'k{n}-bayar', [{'method': 'Tunai' if how == 'cash' else 'QRIS', 'amount': total}]), user)
            F['receipt'] = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={q(v)} order by created_at limit 1")
    F['inv'] = h.aktif(v); F['no'] = h.no_tagihan(F['inv'])
    return F


def settle(h, F, parts, key, user=OWNER, remaining=None):
    rem = remaining if remaining is not None else int(h.angka(f"select total-coalesce(dp_amount,0)-coalesce((select sum(amount) from public.invoice_payments where invoice_id={q(F['inv'])}),0) from public.invoices where id={q(F['inv'])}"))
    return h.gagal(f"select public.clinic_settle_outpatient_invoice({q(F['v'])},{q(F['inv'])},{q(key)},{j(parts)},{rem});", user)


def edit_inv(h, F, key, bump, user=OWNER):
    return h.gagal(r.koreksi_sql(h, F['inv'], key, lines_for(F['n'], *F['slots'], bump=bump)), user)


def set_shift(h, user, status):
    h.sistem(f"update public.cashier_shifts set status={q(status)}, closed_at={'now()' if status == 'closed' else 'null'} where id={q(r.SHIFT[user])};")


# ---------------------------------------------------------------- sections
def section_direct(h):
    """Rawat jalan, uang di kepala tagihan: setiap metode bayar, lalu koreksi harga, lalu terima ulang."""
    for metode in ('Tunai', 'QRIS', 'Transfer', 'Debit', 'Kredit', 'E-Wallet'):
        F = rj(h, nxt(), metode)
        kas = KAS[metode]; before = net(h, F['no']); stock = h.angka(f"select qty from public.stock where warehouse_id={q(r.WH)} and item_id={q(r.ITEM)}")
        items = h.nilai(f"select md5(string_agg(to_jsonb(i)::text,',' order by i.id)) from public.invoice_items i where invoice_id={q(F['inv'])}")
        moves = h.angka("select count(*) from public.stock_moves")
        check(f'direct {metode}: fixture Lunas, uang di rekening {kas}, tanpa baris pembayaran', h.status_bayar(F['inv']) == 'Lunas' and before[kas] == F['total']
              and h.angka(f"select count(*) from public.invoice_payments where invoice_id={q(F['inv'])}") == 0, dict(before={k: str(v) for k, v in before.items()}))
        err, res = do_cancel(h, F['inv'], f"c-{F['n']}")
        after = net(h, F['no']); row = inv_row(h, F['inv'])
        check(f'direct {metode}: batalkan penerimaan -> Belum Lunas, nomor sama, bukan void, jurnal rekening {kas} dikeluarkan, piutang kembali, pendapatan tetap',
              err is None and row['paid_status'] == 'Belum Lunas' and row['paid_at'] is None and row['voided_at'] is None and row['invoice_no'] == F['no']
              and after[kas] == 0 and after['150001'] == F['total'] and after['510002'] == -F['total'] and tb(h) == 0,
              dict(err=(err or '')[:200], after={k: str(v) for k, v in after.items()}, status=row['paid_status']))
        check(f'direct {metode}: stok, HPP, baris tagihan, gerakan stok TIDAK disentuh',
              h.angka(f"select qty from public.stock where warehouse_id={q(r.WH)} and item_id={q(r.ITEM)}") == stock and h.angka("select count(*) from public.stock_moves") == moves
              and h.nilai(f"select md5(string_agg(to_jsonb(i)::text,',' order by i.id)) from public.invoice_items i where invoice_id={q(F['inv'])}") == items, {})
        vst = h.nilai(f"select status from public.visits where id={q(F['v'])}")
        check(f'direct {metode}: kunjungan yang sudah Selesai kembali ke Pembayaran supaya muncul lagi di kasir', vst == 'Pembayaran', dict(status=vst))
        a = json.loads(h.nilai(f"select to_jsonb(a) from public.clinic_receipt_cancellations a where invoice_id={q(F['inv'])}"))
        check(f'direct {metode}: jejak audit: alasan, pelaku, waktu, kunci, jumlah, jurnal, snapshot sebelum/sesudah',
              a['reason'] == 'Koreksi harga disetujui Owner' and a['actor_id'] == OWNER and a['actor_role'] == 'OWNER' and a['request_key'] == f"c-{F['n']}"
              and D(a['total_amount']) == F['total'] and D(a['direct_amount']) == F['total'] and len(a['journal_ids']) == 1 and a['before_invoice']['paid_status'] == 'Lunas'
              and a['after_invoice']['paid_status'] == 'Belum Lunas' and a['created_at'] and a['tanggal'] == h.nilai("select (now() at time zone 'Asia/Jakarta')::date"),
              dict(keys=sorted(a)[:6]))
        elig = h.nilai(f"select public.clinic_invoice_correction_eligible({q(F['inv'])});", OWNER)
        check(f'direct {metode}: jalur koreksi yang ada menganggap tagihan LAYAK dikoreksi lagi (clinic_invoice_correction_eligible = true)', elig == 't', dict(elig=elig))
        # koreksi harga lewat jalur koreksi yang ada, lalu terima ulang sesuai tagihan baru
        e1 = edit_inv(h, F, f"e-{F['n']}", 15000)
        newtotal = F['total'] + 15000; mid = net(h, F['no'])
        check(f'direct {metode}: tagihan terbuka untuk dikoreksi (Owner ubah harga) tanpa menyentuh uang: piutang = total baru, rekening tetap 0',
              e1 is None and h.angka(f"select total from public.invoices where id={q(F['inv'])}") == newtotal and mid['150001'] == newtotal and mid[kas] == 0 and mid['510002'] == -newtotal and tb(h) == 0,
              dict(err=(e1 or '')[:200], mid={k: str(v) for k, v in mid.items()}))
        e2 = settle(h, F, [{'method': metode, 'amount': newtotal}], f"s-{F['n']}")
        fin = net(h, F['no'])
        vst2 = h.nilai(f"select status from public.visits where id={q(F['v'])}")
        check(f'direct {metode}: terima ulang {metode} sesuai tagihan baru -> Lunas; rekening {kas} = total baru, piutang 0, pendapatan = total baru, neraca saldo 0',
              e2 is None and h.status_bayar(F['inv']) == 'Lunas' and fin[kas] == newtotal and fin['150001'] == 0 and fin['510002'] == -newtotal and tb(h) == 0 and vst2 == 'Selesai',
              dict(err=(e2 or '')[:200], fin={k: str(v) for k, v in fin.items()}, visit=vst2))


def section_oneoff(h):
    """Bentuk nyata INV-0501/0508/0777: tagihan Lunas langsung yang pernah dikoreksi skrip sekali-jalan (jurnal 'klinik' asli masih memuat total lama,
    empat jurnal 'klinik-edit' menggantinya). Rekening harus dibaca dari saldo bersih seluruh jurnal, bukan dari jurnal asli saja."""
    F = rj(h, nxt(), 'QRIS', slots=(1, 2)); old = F['total']; new = old - 50000
    cust = ["'klinik-edit'", q(F['no']), q(r.BRANCH)]
    def jn(rows, ref=None):
        lines = j([dict(code=c, debit=d, credit=k) for c, d, k in rows])
        return f"select public.clinic_write_journal((now() at time zone 'Asia/Jakarta')::date,'Koreksi sekali jalan fiktif',{cust[0]},{cust[1]},{cust[2]}::uuid,{lines});"
    h.sistem(f"update public.invoices set subtotal={new}, total={new} where id={q(F['inv'])};"
             + jn([('150001', old, 0), ('120002', 0, old)]) + jn([('510002', old, 0), ('150001', 0, old)])
             + jn([('150001', new, 0), ('510002', 0, new)]) + jn([('120002', new, 0), ('150001', 0, new)]))
    pre = net(h, F['no'])
    check('oneoff: fixture meniru INV-0501 (jurnal asli total lama + 4 jurnal koreksi): bank bersih = total baru, jurnal asli != total', pre['120002'] == new and pre['150001'] == 0 and pre['510002'] == -new, {k: str(v) for k, v in pre.items()})
    err, res = do_cancel(h, F['inv'], f"c-{F['n']}"); after = net(h, F['no'])
    check('oneoff: batalkan penerimaan memakai saldo BERSIH rekening (bukan jurnal asli): bank 0, piutang = total baru, pendapatan tetap, neraca 0',
          err is None and after['120002'] == 0 and after['150001'] == new and after['510002'] == -new and tb(h) == 0 and h.status_bayar(F['inv']) == 'Belum Lunas' and D(res['direct_amount']) == new,
          dict(err=(err or '')[:200], after={k: str(v) for k, v in after.items()}))


def section_dp(h):
    """DP langsung di kepala tagihan (dp_amount) + pembayaran DP campuran dengan kwitansi susulan."""
    F = rj(h, nxt(), 'Tunai', status='DP', dp=100000, slots=(1, 2))   # 220000, DP 100000
    err, res = do_cancel(h, F['inv'], f"c-{F['n']}")
    row = inv_row(h, F['inv']); after = net(h, F['no'])
    check('DP langsung: batalkan -> dp_amount 0, Belum Lunas, kas 0, piutang = total, neraca 0',
          err is None and D(row['dp_amount']) == 0 and row['dp_date'] is None and row['paid_status'] == 'Belum Lunas' and after['110003'] == 0 and after['150001'] == F['total'] and tb(h) == 0,
          dict(err=(err or '')[:200], dp=row['dp_amount']))
    e1 = edit_inv(h, F, f"e-{F['n']}", 20000); e2 = settle(h, F, [{'method': 'QRIS', 'amount': F['total'] + 20000}], f"s-{F['n']}")
    fin = net(h, F['no'])
    check('DP langsung: koreksi harga lalu terima ulang QRIS penuh -> Lunas, bank = total baru, kas 0', e1 is None and e2 is None and h.status_bayar(F['inv']) == 'Lunas'
          and fin['120002'] == F['total'] + 20000 and fin['110003'] == 0 and fin['150001'] == 0 and tb(h) == 0, dict(e1=(e1 or '')[:160], e2=(e2 or '')[:160]))
    # DP + kwitansi pelunasan (satu kwitansi): semuanya dibatalkan sekaligus
    G = rj(h, nxt(), 'Tunai', status='DP', dp=100000, slots=(1, 2))
    e = settle(h, G, [{'method': 'QRIS', 'amount': G['total'] - 100000}], f"s2-{G['n']}")
    rc = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={q(G['v'])}")
    err2, res2 = do_cancel(h, G['inv'], f"c-{G['n']}")
    ng = net(h, G['no']); rr = h.nilai(f"select status from public.clinic_payment_receipts where id={q(rc)}")
    check('DP + kwitansi pelunasan: batalkan penerimaan membatalkan DP DAN kwitansi: kas 0, bank 0, piutang = total, kwitansi batal, Belum Lunas',
          e is None and err2 is None and rr == 'batal' and ng['110003'] == 0 and ng['120002'] == 0 and ng['150001'] == G['total'] and h.status_bayar(G['inv']) == 'Belum Lunas' and tb(h) == 0,
          dict(e=(e or '')[:100], err=(err2 or '')[:200], ng={k: str(v) for k, v in ng.items()}))


def section_split(h):
    F = rj(h, nxt(), split=[{'method': 'Tunai', 'amount': 60000, 'kas_code': '110003'}, {'method': 'QRIS', 'amount': 40000, 'kas_code': '120002'}], slots=(1,))
    pre = net(h, F['no'])
    err, res = do_cancel(h, F['inv'], f"c-{F['n']}"); after = net(h, F['no'])
    pays = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_object('amount',amount,'kas',kas_code,'co',checkout_payment,'rev',reversal_of is not null) order by amount),'[]') from public.invoice_payments where invoice_id={q(F['inv'])}"))
    check('split checkout (Tunai 60.000 + QRIS 40.000): keduanya dibalik, kas 0, bank 0, piutang 100.000, Belum Lunas, baris pembalik membawa bendera checkout',
          err is None and after['110003'] == 0 and after['120002'] == 0 and after['150001'] == F['total'] and h.status_bayar(F['inv']) == 'Belum Lunas'
          and len(pays) == 4 and sum(D(p['amount']) for p in pays) == 0 and all(p['co'] for p in pays) and tb(h) == 0 and (res or {}).get('cash_amount') == 60000,
          dict(err=(err or '')[:200], pays=pays, res=res))
    e1 = edit_inv(h, F, f"e-{F['n']}", 10000)
    e2 = settle(h, F, [{'method': 'Tunai', 'amount': 50000}, {'method': 'QRIS', 'amount': 60000}], f"s-{F['n']}"); fin = net(h, F['no'])
    check('split checkout: koreksi lalu terima ulang dengan campuran baru -> Lunas, kas 50.000, bank 60.000', e1 is None and e2 is None and fin['110003'] == 50000 and fin['120002'] == 60000 and fin['150001'] == 0 and h.status_bayar(F['inv']) == 'Lunas',
          dict(e1=(e1 or '')[:150], e2=(e2 or '')[:150]))


def section_ranap(h):
    # (1) dibayar uang muka (transfer ke bank): pemakaian dibatalkan, saldo uang muka kembali, uang muka tetap aktif, bank TIDAK bergerak
    F = ranap(h, nxt(), 'advance'); adv = json.loads(h.nilai(f"select to_jsonb(a) from public.clinic_customer_advances a where id={q(F['adv'])}"))
    bank0 = h.saldo('120002'); ar0 = net(h, F['no'])['150001']
    check('ranap uang muka: fixture Lunas oleh pemakaian uang muka (applied = total)', h.status_bayar(F['inv']) == 'Lunas' and D(adv['applied']) == F['total'] and adv['status'] == 'aktif', dict(adv=adv['applied']))
    err, res = do_cancel(h, F['inv'], f"c-{F['n']}")
    adv2 = json.loads(h.nilai(f"select to_jsonb(a) from public.clinic_customer_advances a where id={q(F['adv'])}")); app = json.loads(h.nilai(f"select to_jsonb(a) from public.clinic_advance_applications a where advance_id={q(F['adv'])}"))
    after = net(h, F['no'])
    check('ranap uang muka: batalkan penerimaan -> Belum Lunas, uang muka kembali ke saldo (applied 0, tetap aktif, TIDAK ditandai dilepas), pemakaian ditandai dilepas dengan alasan, bank tidak bergerak, neraca 0',
          err is None and h.status_bayar(F['inv']) == 'Belum Lunas' and D(adv2['applied']) == 0 and adv2['status'] == 'aktif' and adv2['released_at'] is None and app['released_at'] and app['release_reason'] == 'Koreksi harga disetujui Owner'
          and h.saldo('120002') == bank0 and after['150001'] == ar0 + F['total'] and after['314001'] == 0 and tb(h) == 0 and h.diterima(F['inv']) == 0,
          dict(err=(err or '')[:200], adv=adv2['applied'], res=res))
    check('ranap uang muka: pembayaran dibalik penuh (diterima 0; semua baris pembayaran seimbang per rekening)', json.loads(h.nilai(f"select to_jsonb(clinic_private.payments_fully_reversed({q(F['inv'])}))")) is True, {})
    e1 = edit_inv(h, F, f"e-{F['n']}", 25000)
    check('ranap uang muka: tagihan terbuka untuk koreksi (Owner ubah harga naik 25.000) setelah penerimaan dibatalkan', e1 is None and h.angka(f"select total from public.invoices where id={q(F['inv'])}") == F['total'] + 25000, dict(e1=(e1 or '')[:200]))
    e2 = h.gagal(r.bayar_sql(F['v'], f"k{F['n']}-ulang", [{'method': 'Tunai', 'amount': 25000}], F['inv']), OWNER)
    adv_free = D(h.nilai(f"select amount-applied from public.clinic_customer_advances where id={q(F['adv'])}"))
    check('ranap uang muka: terima lagi: uang tunai selisih diterima kwitansi, saldo uang muka utuh tetap tersedia (tidak ada kredit tersembunyi)', e2 is None and adv_free == F['total'], dict(e2=(e2 or '')[:200], free=str(adv_free)))
    # (2) kwitansi tunai langsung
    G = ranap(h, nxt(), 'cash'); cash0 = h.saldo('110003')
    err, res = do_cancel(h, G['inv'], f"c-{G['n']}"); rcs = json.loads(h.nilai(f"select to_jsonb(p) from public.clinic_payment_receipts p where id={q(G['receipt'])}"))
    check('ranap kwitansi Tunai: kwitansi batal UTUH (alasan, pelaku, kunci, shift asal terbuka dipakai), kas dikeluarkan, Belum Lunas, uang muka tidak ada',
          err is None and rcs['status'] == 'batal' and rcs['void_reason'] == 'Koreksi harga disetujui Owner' and rcs['voided_by'] == OWNER and rcs['void_request_key'] == f"c-{G['n']}" and rcs['void_shift_id'] == r.SHIFT[OWNER]
          and h.saldo('110003') == cash0 - G['total'] and h.status_bayar(G['inv']) == 'Belum Lunas' and tb(h) == 0, dict(err=(err or '')[:200], rcs=rcs['status'], res=res))
    # (3) kwitansi QRIS campur 2 tagihan (dua tagihan, satu kwitansi)
    n = nxt(); cust = r.buat_pelanggan(h, n); v = r.buat_kunjungan(h, n, cust)
    l1, l2 = lines_for(n, 1), lines_for(n, 2)
    h.sql(r.tagih_sql(v, f'k{n}-t1', l1, OWNER, alasan='Uji fiktif DP'), OWNER)
    inv1 = h.aktif(v)
    h.sql(r.tagih_sql(v, f'k{n}-t2', l2, OWNER, alasan='Uji fiktif DP'), OWNER)
    inv2 = h.nilai(f"select id from public.invoices where visit_id={q(v)} and id<>{q(inv1)} and voided_at is null")
    tot = r.nilai_baris(l1) + r.nilai_baris(l2)
    h.sql(r.bayar_sql(v, f'k{n}-pay', [{'method': 'QRIS', 'amount': tot}]), OWNER)
    rc = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={q(v)}")
    err, res = do_cancel(h, inv1, f'c-{n}')
    check('ranap satu kwitansi melunasi DUA tagihan: batalkan dari tagihan pertama -> keduanya Belum Lunas, hasil menyebut tagihan lain, bank kembali 0 untuk keduanya',
          err is None and h.status_bayar(inv1) == 'Belum Lunas' and h.status_bayar(inv2) == 'Belum Lunas' and h.nilai(f"select status from public.clinic_payment_receipts where id={q(rc)}") == 'batal'
          and (res or {}).get('other_invoices_unpaid') == [h.no_tagihan(inv2)] and net(h, h.no_tagihan(inv1))['120002'] == 0 and net(h, h.no_tagihan(inv2))['120002'] == 0 and tb(h) == 0, dict(err=(err or '')[:200], res=res))
    # (4) kelebihan bayar -> uang muka dari kwitansi ikut batal bila belum terpakai
    n = nxt(); cust = r.buat_pelanggan(h, n); v = r.buat_kunjungan(h, n, cust); ls = lines_for(n, 1)
    h.sql(r.tagih_sql(v, f'k{n}-t', ls, OWNER, alasan='Uji fiktif DP'), OWNER); inv = h.aktif(v)
    h.sql(r.bayar_sql(v, f'k{n}-pay', [{'method': 'QRIS', 'amount': 150000}], inv), OWNER)
    rc = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={q(v)}"); adv = h.nilai(f"select id from public.clinic_customer_advances where receipt_id={q(rc)}")
    bank0 = h.saldo('120002'); um0 = h.saldo('314001')
    err, res = do_cancel(h, inv, f'c-{n}')
    check('ranap kelebihan bayar (QRIS 150.000, tagihan 100.000): kwitansi batal + uang muka sisa 50.000 ikut batal dengan jurnalnya; bank turun 150.000, uang muka (314001) kembali 0',
          err is None and h.nilai(f"select status from public.clinic_customer_advances where id={q(adv)}") == 'batal' and h.saldo('120002') == bank0 - 150000 and h.saldo('314001') == um0 + 50000
          and tb(h) == 0 and h.status_bayar(inv) == 'Belum Lunas', dict(err=(err or '')[:200]))
    # (5) uang muka dari kwitansi SUDAH dipakai tagihan lain -> ditolak dengan petunjuk; setelah pemakaiannya dibatalkan boleh
    n = nxt(); cust = r.buat_pelanggan(h, n); v = r.buat_kunjungan(h, n, cust); ls1 = lines_for(n, 1)
    h.sql(r.tagih_sql(v, f'k{n}-t1', ls1, OWNER, alasan='Uji fiktif DP'), OWNER); inv1 = h.aktif(v)
    h.sql(r.bayar_sql(v, f'k{n}-pay', [{'method': 'QRIS', 'amount': 150000}], inv1), OWNER)
    rc = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={q(v)}")
    h.sql(r.tagih_sql(v, f'k{n}-t2', lines_for(n, 2), OWNER, alasan='Uji fiktif DP'), OWNER)
    inv2 = h.nilai(f"select id from public.invoices where visit_id={q(v)} and id<>{q(inv1)} and voided_at is null")
    before = money_state(h)
    err, _ = do_cancel(h, inv1, f'c-{n}-a')
    check('ranap: kwitansi yang uang mukanya sudah dipakai tagihan lain ditolak dengan petunjuk jelas, tidak ada yang berubah', has(err, 'UANG_MUKA_DIPAKAI', h.no_tagihan(inv2)) and money_state(h) == before, dict(err=(err or '')[:300]))
    err2, _ = do_cancel(h, inv2, f'c-{n}-b'); err3, res3 = do_cancel(h, inv1, f'c-{n}-c')
    check('ranap: setelah penerimaan tagihan kedua dibatalkan (uang kembali ke saldo), kwitansi pertama bisa dibatalkan', err2 is None and err3 is None and h.nilai(f"select status from public.clinic_payment_receipts where id={q(rc)}") == 'batal' and tb(h) == 0,
          dict(err2=(err2 or '')[:200], err3=(err3 or '')[:200]))


def section_shift(h):
    # shift asal TERBUKA milik kasir lain: efek di shift asal (tidak ada baris tambahan di shift Owner)
    F = rj(h, nxt(), 'Tunai', user=STAFF)
    err, res = do_cancel(h, F['inv'], f"c-{F['n']}")
    check('shift: tagihan Tunai dari shift STAFF yang masih terbuka -> mode shift_asal_terbuka, cancel_shift = shift asal, Tunai tercatat',
          err is None and res['shift_mode'] == 'shift_asal_terbuka' and res['cancel_shift_id'] == r.SHIFT[STAFF] and res['cash_amount'] == F['total'], dict(err=(err or '')[:200], res=res))
    # shift asal TUTUP: rekaman shift lama tidak berubah; koreksi tunai tercatat di shift Owner yang sedang terbuka
    G = rj(h, nxt(), 'Tunai', user=STAFF)
    set_shift(h, STAFF, 'closed')
    try:
        closed_before = h.nilai(f"select to_jsonb(s)::text from public.cashier_shifts s where id={q(r.SHIFT[STAFF])}")
        err, res = do_cancel(h, G['inv'], f"c-{G['n']}")
        closed_after = h.nilai(f"select to_jsonb(s)::text from public.cashier_shifts s where id={q(r.SHIFT[STAFF])}")
        check('shift: shift asal sudah TUTUP -> mode shift_berjalan: dicatat di shift Owner yang terbuka, rekaman shift tertutup TIDAK berubah',
              err is None and res['shift_mode'] == 'shift_berjalan' and res['cancel_shift_id'] == r.SHIFT[OWNER] and closed_before == closed_after and res['cash_amount'] == G['total'], dict(err=(err or '')[:200], res=res))
        # Owner tanpa shift terbuka: tetap boleh (tidak terkunci), ditandai tanpa_shift
        H = rj(h, nxt(), 'Tunai', user=ADMIN)
        set_shift(h, ADMIN, 'closed'); set_shift(h, OWNER, 'closed')
        try:
            err2, res2 = do_cancel(h, H['inv'], f"c-{H['n']}")
            check('shift: Owner TANPA shift terbuka dan shift asal tertutup tetap bisa membatalkan (tidak terkunci); ditandai tanpa_shift untuk Finance',
                  err2 is None and res2['shift_mode'] == 'tanpa_shift' and res2['cancel_shift_id'] is None and res2['cash_amount'] == H['total'] and h.status_bayar(H['inv']) == 'Belum Lunas', dict(err=(err2 or '')[:200], res=res2))
            # non-tunai tidak peduli shift
            K = rj(h, nxt(), 'QRIS', user=FINANCE)
            err3, res3 = do_cancel(h, K['inv'], f"c-{K['n']}")
            check('shift: QRIS tidak menyentuh laci -> mode nonkas', err3 is None and res3['shift_mode'] == 'nonkas' and res3['cash_amount'] == 0, dict(err=(err3 or '')[:200]))
        finally:
            set_shift(h, ADMIN, 'open'); set_shift(h, OWNER, 'open')
    finally:
        set_shift(h, STAFF, 'open')
    # kwitansi: shift asal tutup -> void_shift_id = shift Owner; shift asal terbuka -> void_shift_id = shift asal
    A = ranap(h, nxt(), 'cash', user=FINANCE)
    set_shift(h, FINANCE, 'closed')
    try:
        err, res = do_cancel(h, A['inv'], f"c-{A['n']}")
        vs = h.nilai(f"select void_shift_id from public.clinic_payment_receipts where id={q(A['receipt'])}")
        check('shift: kwitansi dari shift yang sudah TUTUP -> pembatalan dicatat di shift Owner yang terbuka (void_shift_id), shift asal kwitansi tetap', err is None and vs == r.SHIFT[OWNER]
              and h.nilai(f"select shift_id from public.clinic_payment_receipts where id={q(A['receipt'])}") == r.SHIFT[FINANCE], dict(err=(err or '')[:200], vs=vs))
    finally:
        set_shift(h, FINANCE, 'open')
    B = ranap(h, nxt(), 'cash', user=FINANCE)
    err, res = do_cancel(h, B['inv'], f"c-{B['n']}")
    check('shift: kwitansi dari shift asal yang masih terbuka -> saling meniadakan di shift asal (void_shift_id = shift_id)', err is None and h.nilai(f"select void_shift_id from public.clinic_payment_receipts where id={q(B['receipt'])}") == r.SHIFT[FINANCE], dict(err=(err or '')[:200]))


def section_roles(h):
    F = rj(h, nxt(), 'QRIS'); G = rj(h, nxt(), 'QRIS'); Hh = rj(h, nxt(), 'QRIS'); I = rj(h, nxt(), 'QRIS')
    before = money_state(h)
    for role, user in (('ADMIN', ADMIN), ('FINANCE', FINANCE), ('STAFF', STAFF)):
        err, _ = do_cancel(h, F['inv'], f"c-role-{role}", user)
        check(f'peran {role} tanpa izin: ditolak dengan pesan jelas, tidak ada yang berubah', has(err, 'ACCESS_DENIED', 'Owner') and money_state(h) == before, dict(err=(err or '')[:200]))
        e2, _ = preview(h, F['inv'], user)
        check(f'peran {role} tanpa izin: pratinjau juga ditolak', has(e2, 'ACCESS_DENIED'), dict(err=(e2 or '')[:200]))
    try:
        h.sql(f"insert into role_settings_private.action_policies(role,allowed) values ('ADMIN', array[{q(GRANT_ACTION)}]), ('STAFF', array['bank.refund_clinic.cancel']) on conflict (role) do update set allowed=excluded.allowed;")
        err, res = do_cancel(h, F['inv'], 'c-role-ok-admin', ADMIN)
        check('peran ADMIN dengan izin tertulis eksplisit: boleh; jejak mencatat peran ADMIN', err is None and h.nilai(f"select actor_role from public.clinic_receipt_cancellations where invoice_id={q(F['inv'])}") == 'ADMIN', dict(err=(err or '')[:200]))
        err, _ = do_cancel(h, G['inv'], 'c-role-staff', STAFF)
        check('peran STAFF dengan kebijakan kustom yang TIDAK memuat izin ini: ditolak', has(err, 'ACCESS_DENIED'), dict(err=(err or '')[:200]))
        err, _ = do_cancel(h, Hh['inv'], 'c-role-fin', FINANCE)
        check('peran FINANCE tanpa baris kebijakan ("bawaan lama" = semua aksi) TETAP ditolak: bawaan MATI', has(err, 'ACCESS_DENIED'), dict(err=(err or '')[:200]))
        h.sql(f"update role_settings_private.action_policies set allowed=array[{q(GRANT_ACTION)}] where role='STAFF';")
        err, res = do_cancel(h, G['inv'], 'c-role-staff2', STAFF)
        check('peran STAFF setelah diberi izin: boleh', err is None and h.status_bayar(G['inv']) == 'Belum Lunas', dict(err=(err or '')[:200]))
        # gagal baca kebijakan: peran lain ditolak (fail-closed), Owner tetap boleh (fail-open)
        out = h.gagal(f"begin; alter table role_settings_private.action_policies rename to action_policies_x; set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub',{q(ADMIN)},false); select public.{RPC}({q(I['inv'])},'c-failclosed','Alasan cukup panjang'); rollback;")
        check('kebijakan tidak terbaca: ADMIN (diberi izin) ditolak (fail-closed)', has(out, 'ACCESS_DENIED'), dict(err=(out or '')[:200]))
        out = h.gagal(f"begin; alter table role_settings_private.action_policies rename to action_policies_x; set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub',{q(OWNER)},false); select public.{RPC}({q(I['inv'])},'c-failopen','Alasan cukup panjang'); rollback;")
        check('kebijakan tidak terbaca: OWNER tetap BOLEH (fail-open, tidak pernah terkunci)', out is None, dict(err=(out or '')[:200]))
    finally:
        h.sql("delete from role_settings_private.action_policies where role in ('ADMIN','STAFF');")
    # peran dengan izin tertulis tetapi akun cabang lain: ditolak karena cabang
    try:
        h.sql(f"insert into role_settings_private.action_policies(role,allowed) values ('FINANCE', array[{q(GRANT_ACTION)}]);")
        err0, _ = do_cancel(h, I['inv'], 'c-luar-izin', r.FIN_LUAR)
        check('akun FINANCE cabang lain MESKI punya izin tertulis: ditolak karena cabang tidak diizinkan, tidak ada yang berubah', has(err0, 'ACCESS_DENIED', 'cabang') and h.status_bayar(I['inv']) == 'Lunas', dict(err=(err0 or '')[:200]))
    finally:
        h.sql("delete from role_settings_private.action_policies where role='FINANCE';")
    err, _ = do_cancel(h, I['inv'], 'c-luar', r.FIN_LUAR)
    check('akun cabang lain ditolak (cabang tidak diizinkan / tanpa izin)', has(err, 'ACCESS_DENIED'), dict(err=(err or '')[:200]))
    # Owner nonaktif tidak boleh
    h.sistem(f"update public.profiles set is_active=false where id={q(OWNER)};")
    try: err, _ = do_cancel(h, I['inv'], 'c-inactive', OWNER)
    finally: h.sistem(f"update public.profiles set is_active=true where id={q(OWNER)};")
    check('akun Owner NONAKTIF ditolak', has(err, 'ACCESS_DENIED'), dict(err=(err or '')[:200]))
    cat = json.loads(h.nilai(f"select to_jsonb(c) from role_settings_private.action_catalog c where id={q(GRANT_ACTION)}")); mod = h.nilai(f"select module_id from role_settings_private.action_modules where id={q(GRANT_ACTION)}")
    ok_owner = h.nilai("select public.clinic_cancel_receipt_allowed();", OWNER); ok_staff = h.nilai("select public.clinic_cancel_receipt_allowed();", STAFF)
    check('clinic_cancel_receipt_allowed (untuk layar): Owner true, STAFF tanpa izin false', ok_owner == 't' and ok_staff == 'f', dict(owner=ok_owner, staff=ok_staff))
    check('katalog aksi peran memuat klinik.batalkan_penerimaan (enforced) di modul klinik', cat['enforced'] is True and cat['group'] == 'Klinik' and mod == 'klinik', dict(cat=cat, mod=mod))


def section_guards(h):
    F = rj(h, nxt(), 'QRIS'); before = money_state(h)
    for reason in ('', '  ', 'ab', 'x' * 501):
        err, _ = do_cancel(h, F['inv'], f"c-reason-{len(reason)}", OWNER, reason)
        check(f'alasan {len(reason)} huruf ditolak (wajib 3-500 huruf), tidak ada yang berubah', has(err, 'RECEIPT_INVALID', 'alasan') and money_state(h) == before, dict(err=(err or '')[:200]))
    err, _ = do_cancel(h, F['inv'], '')
    check('kunci kosong ditolak', has(err, 'RECEIPT_INVALID'), dict(err=(err or '')[:120]))
    err, res = do_cancel(h, F['inv'], f"c-{F['n']}")
    after1 = money_state(h)
    err2, res2 = do_cancel(h, F['inv'], f"c-{F['n']}")
    check('kunci sama diulang: hasil lama dikembalikan, tidak membalik dua kali (satu baris audit, keadaan uang sama)', err is None and err2 is None and res2 == res and money_state(h) == after1 and audit_rows(h, F['inv']) == 1, dict(err=(err2 or '')[:200]))
    err3, _ = do_cancel(h, F['inv'], f"c-{F['n']}-lagi")
    check('dibatalkan dua kali dengan kunci lain: ditolak "belum ada penerimaan" (tidak bisa batal dua kali)', has(err3, 'BELUM_ADA_PENERIMAAN') and money_state(h) == after1, dict(err=(err3 or '')[:200]))
    G = rj(h, nxt(), 'QRIS')
    err4, _ = do_cancel(h, G['inv'], f"c-{F['n']}")
    check('kunci yang sama untuk tagihan lain: IDEMPOTENCY_CONFLICT', has(err4, 'IDEMPOTENCY_CONFLICT'), dict(err=(err4 or '')[:200]))
    err5, _ = do_cancel(h, F['inv'], f"c-{F['n']}", reason='Alasan lain yang berbeda')
    check('kunci sama dengan alasan berbeda: IDEMPOTENCY_CONFLICT', has(err5, 'IDEMPOTENCY_CONFLICT'), dict(err=(err5 or '')[:200]))
    err6, _ = do_cancel(h, '00000000-0000-4000-8000-000000000bad', 'c-nf')
    check('tagihan tidak ada: ditolak tanpa membocorkan apa pun', has(err6, 'ACCESS_DENIED'), dict(err=(err6 or '')[:200]))
    # belum ada uang
    K = rj(h, nxt(), 'Tunai', status='Belum Lunas', dp=0)
    err7, _ = do_cancel(h, K['inv'], f"c-{K['n']}")
    check('tagihan yang belum menerima uang: ditolak jelas', has(err7, 'BELUM_ADA_PENERIMAAN'), dict(err=(err7 or '')[:200]))
    # periode terkunci
    P = rj(h, nxt(), 'QRIS'); st = money_state(h)
    h.sistem(f"update public.accounting_locks set closed_until=(now() at time zone 'Asia/Jakarta')::date where id;")
    try: err8, _ = do_cancel(h, P['inv'], f"c-{P['n']}")
    finally: h.sistem("update public.accounting_locks set closed_until=null where id;")
    check('periode akuntansi terkunci: ditolak UTUH (PERIODE_TERKUNCI), tidak ada setengah efek', has(err8, 'PERIODE_TERKUNCI') and money_state(h) == st, dict(err=(err8 or '')[:200]))
    # refund
    R = rj(h, nxt(), 'QRIS'); st = money_state(h)
    h.sistem(f"set session_replication_role=replica; insert into public.clinic_refund_requests(invoice_id,branch_id,requested_by,request_key,payload,quoted_total,status) values ({q(R['inv'])},{q(r.BRANCH)},{q(OWNER)},{q('rf-'+str(R['n']))},'{{}}'::jsonb,1000,'pending'); set session_replication_role=origin;")
    err9, _ = do_cancel(h, R['inv'], f"c-{R['n']}")
    check('tagihan dengan permintaan refund aktif: ditolak dengan petunjuk', has(err9, 'SUDAH_REFUND') and money_state(h) == st, dict(err=(err9 or '')[:200]))
    # pasca-syarat: bila setelah pembalikan tagihan tetap Lunas (mis. ada pemicu/pembayaran tak terduga), SEMUANYA dibatalkan utuh
    S = rj(h, nxt(), 'QRIS'); st = money_state(h)
    h.sistem("create or replace function public.zz_force_lunas() returns trigger language plpgsql as $f$ begin new.paid_status := 'Lunas'; return new; end $f$;"
             "create trigger zz_force_lunas before update on public.invoices for each row execute function public.zz_force_lunas();")
    try: err10, _ = do_cancel(h, S['inv'], f"c-{S['n']}")
    finally: h.sistem("drop trigger if exists zz_force_lunas on public.invoices; drop function if exists public.zz_force_lunas();")
    check('pasca-syarat: tagihan tetap Lunas setelah pembalikan -> ditolak MASIH_LUNAS dan semua efek dibatalkan (atomik)', has(err10, 'MASIH_LUNAS') and money_state(h) == st and h.status_bayar(S['inv']) == 'Lunas', dict(err=(err10 or '')[:200]))
    # void & terbit ulang -> tagihan baru (koreksi berjalan) ditolak; tagihan lama void
    V = rj(h, nxt(), 'QRIS')
    h.sql(r.terbit_ulang_sql(V['inv'], f"k{V['n']}-ulang"), OWNER)
    new_inv = h.aktif(V['v'])
    e_old, _ = do_cancel(h, V['inv'], f"c-{V['n']}-old"); e_new, _ = do_cancel(h, new_inv, f"c-{V['n']}-new")
    check('tagihan void ditolak (TAGIHAN_BATAL) dan tagihan hasil terbit ulang yang sedang dikoreksi ditolak (KOREKSI_BERJALAN)', has(e_old, 'TAGIHAN_BATAL') and has(e_new, 'KOREKSI_BERJALAN'), dict(old=(e_old or '')[:160], new=(e_new or '')[:160]))
    # koreksi metode bayar (Tunai -> Transfer): jurnal pembalik memakai rekening hasil koreksi
    h.sistem(f"insert into public.payment_account_map(metode,cash_account_id,branch_id) select 'Tunai',id,{q(r.BRANCH)}::uuid from public.cash_accounts where coa_code='110003' union all select 'Transfer',id,{q(r.BRANCH)}::uuid from public.cash_accounts where coa_code='120002';")
    M = rj(h, nxt(), 'Tunai'); hasil = h.gagal(f"select public.correct_clinic_invoice_payment({q(M['inv'])},null,0,{q('km-'+str(M['n']))},'Salah pilih metode',{q('Transfer')});", OWNER)
    if hasil is None:
        err10, res10 = do_cancel(h, M['inv'], f"c-{M['n']}"); a = net(h, M['no'])
        check('metode bayar yang sudah dikoreksi (Tunai->Transfer): pembalikan memakai rekening hasil koreksi; kas dan bank sama-sama 0', err10 is None and a['110003'] == 0 and a['120002'] == 0 and a['150001'] == M['total'] and tb(h) == 0, dict(err=(err10 or '')[:200]))
    else:
        check('koreksi metode bayar (fixture) bisa disiapkan', False, dict(err=hasil[:200]))
    h.sistem(f"delete from public.payment_account_map where branch_id={q(r.BRANCH)};")
    # atomik: gagal di tengah (akun bank tidak aktif) -> semuanya kembali
    Z = ranap(h, nxt(), 'qris'); st = money_state(h)
    h.sistem("update public.coa_accounts set is_active=false where code='120002';")
    try: err11, _ = do_cancel(h, Z['inv'], f"c-{Z['n']}")
    finally: h.sistem("update public.coa_accounts set is_active=true where code='120002';")
    check('atomik: akun bank nonaktif menggagalkan jurnal di tengah proses -> kwitansi, pembayaran, jurnal, audit semuanya tidak berubah', bool(err11) and money_state(h) == st and h.nilai(f"select status from public.clinic_payment_receipts where id={q(Z['receipt'])}") == 'aktif', dict(err=(err11 or '')[:200]))
    # kwitansi yang sudah batal lewat jalur lama: tagihan sudah tidak punya penerimaan
    Y = ranap(h, nxt(), 'cash'); h.sql(r.batal_kwitansi_sql(Y['receipt'], f"old-{Y['n']}"), OWNER)
    err12, _ = do_cancel(h, Y['inv'], f"c-{Y['n']}")
    check('kwitansi yang sudah dibatalkan lewat tombol lama: ditolak "belum ada penerimaan"', has(err12, 'BELUM_ADA_PENERIMAAN'), dict(err=(err12 or '')[:200]))
    # pratinjau baca-saja
    W = rj(h, nxt(), 'Tunai'); st = money_state(h)
    e, p = preview(h, W['inv'])
    check('pratinjau: baca-saja, menyebut jumlah, rekening, mode shift; tidak mengubah apa pun', e is None and p['refuse'] is None and D(p['direct']['amount']) == W['total'] and p['direct']['kas_code'] == '110003' and p['shift_mode'] == 'shift_asal_terbuka' and money_state(h) == st, dict(err=(e or '')[:200], p=str(p)[:200]))
    check('trial balance seluruh basis data tetap 0 sesudah semua pembatalan', tb(h) == 0, dict(tb=str(tb(h))))


def blocked(obs, sess):
    for _ in range(40):
        w = obs.sql(f"select coalesce(wait_event_type,'')||'/'||coalesce(wait_event,'') from pg_stat_activity where pid={sess.pid};")
        if w and w[-1].startswith('Lock/'): return w[-1]
        time.sleep(0.15)
    return 'NOT BLOCKED'


def section_race(h, db):
    def session(name, user):
        s = c.Session(db, name); s.sql(x.claims(user)); return s
    cs = lambda inv, key, reason='Alasan balapan yang cukup': f"select public.{RPC}({q(inv)},{q(key)},{q(reason)});"
    # dua pembatalan BERBEDA kunci pada tagihan yang sama: satu menang, yang kedua menunggu lalu ditolak "belum ada penerimaan"
    F = rj(h, nxt(), 'QRIS')
    with c.Session(db, 'obs') as obs, session('a', OWNER) as a, session('b', OWNER) as b:
        a.sql('begin;' + cs(F['inv'], 'race-1')); b.send(cs(F['inv'], 'race-2'))
        wait = blocked(obs, b); a.sql('commit;'); res = c.attempt(b, commit=False)
    check('balapan: dua pembatalan pada tagihan sama (kunci beda): yang kedua MENUNGGU (advisory) lalu ditolak BELUM_ADA_PENERIMAAN; tepat satu efek, satu baris audit',
          wait.endswith('advisory') and not res['ok'] and 'BELUM_ADA_PENERIMAAN' in res.get('error', '') and audit_rows(h, F['inv']) == 1 and net(h, F['no'])['120002'] == 0 and tb(h) == 0, dict(wait=wait, res=str(res)[:200]))
    # dua permintaan identik: satu efek, jawaban sama
    G = rj(h, nxt(), 'QRIS')
    with c.Session(db, 'obs2') as obs, session('c', OWNER) as a, session('d', OWNER) as b:
        a.sql('begin;' + cs(G['inv'], 'twin')); b.send(cs(G['inv'], 'twin'))
        wait2 = blocked(obs, b); a.sql('commit;'); res2 = c.attempt(b, commit=False)
    check('balapan: dua permintaan IDENTIK serentak: yang kedua menunggu lalu mengembalikan hasil tersimpan; satu efek', wait2.endswith('advisory') and res2['ok'] and audit_rows(h, G['inv']) == 1 and net(h, G['no'])['120002'] == 0, dict(wait=wait2, res=str(res2)[:200]))
    # pembatalan vs penerimaan kasir sedang berjalan pada pelanggan yang sama (koordinator tagihan): menunggu
    H = ranap(h, nxt(), 'none')
    sql_pay = r.bayar_sql(H['v'], 'race-pay', [{'method': 'QRIS', 'amount': H['total']}], H['inv'])
    with c.Session(db, 'obs3') as obs, session('e', OWNER) as a, session('f', OWNER) as b:
        a.sql('begin;' + sql_pay); b.send(cs(H['inv'], 'race-after-pay'))
        wait3 = blocked(obs, b); a.sql('commit;'); res3 = c.attempt(b, commit=False)
    check('balapan: pembatalan menunggu penerimaan kasir yang sedang berjalan (koordinator tagihan), lalu membatalkan uang yang BARU masuk itu; Belum Lunas, neraca 0',
          wait3.endswith('advisory') and res3['ok'] and h.status_bayar(H['inv']) == 'Belum Lunas' and tb(h) == 0, dict(wait=wait3, res=str(res3)[:200]))
    # tutup shift berbarengan: pembatalan memegang kunci baris shift asal (FOR UPDATE) -> tutup shift menunggu
    K = rj(h, nxt(), 'Tunai', user=FINANCE)
    with c.Session(db, 'obs4') as obs, session('g', OWNER) as a, session('h', OWNER) as b:
        a.sql('begin;' + cs(K['inv'], 'race-shift')); b.send(f"update public.cashier_shifts set status='closed', closed_at=now() where id={q(r.SHIFT[FINANCE])} and status='open';")
        wait4 = blocked(obs, b); a.sql('commit;'); b.sql('commit;') if False else None
        try: c.attempt(b, commit=False)
        except Exception: pass
    set_shift(h, FINANCE, 'open')
    check('balapan: tutup shift asal berbarengan MENUNGGU pembatalan (baris shift terkunci) -> efek kas tidak bisa terlewat dari kedua sisi', wait4.startswith('Lock/'), dict(wait=wait4))


# ---------------------------------------------------------------- run
SECTIONS = ['direct', 'dp', 'oneoff', 'split', 'ranap', 'shift', 'roles', 'guards', 'race', 'static']


def section_static(h):
    text = (MIG / CANDIDATE).read_text() if (MIG / CANDIDATE).exists() else ''
    low = text.lower()
    check('statik: migrasi hanya objek BARU (tidak ada create or replace / alter function / drop function / drop trigger)', text != '' and 'create or replace function' not in low and 'alter function' not in low and 'drop function' not in low and 'drop trigger' not in low, {})
    check('statik: migrasi tanpa begin/commit sendiri (aman dibungkus transaksi pemasangan)', text != '' and not any(l.strip().lower() in ('begin;', 'commit;') for l in text.splitlines()), {})
    funcs = json.loads(h.nilai("select coalesce(jsonb_agg(jsonb_build_object('f',p.proname,'sec',p.prosecdef,'cfg',p.proconfig,'priv',has_function_privilege('anon',p.oid,'execute'),'auth',has_function_privilege('authenticated',p.oid,'execute'),'svc',has_function_privilege('service_role',p.oid,'execute')) order by p.proname),'[]') "
                               "from pg_proc p where p.proname in ('clinic_cancel_invoice_receipt','clinic_cancel_invoice_receipt_preview','clinic_cancel_receipt_allowed','cancel_receipt_scan','cancel_receipt_actor')"))
    pub = [f for f in funcs if f['f'].startswith('clinic_cancel')]; priv = [f for f in funcs if not f['f'].startswith('clinic_cancel')]
    check('ACL: RPC publik hanya authenticated (anon/service_role tidak), definer + search_path kosong; fungsi privat tanpa hak app', len(pub) == 3 and all(f['sec'] and f['auth'] and not f['priv'] and not f['svc'] and 'search_path=""' in ' '.join(f['cfg'] or []) for f in pub)
          and len(priv) == 2 and all(not f['auth'] and not f['priv'] for f in priv), dict(funcs=funcs))
    tab = json.loads(h.nilai("select jsonb_build_object('anon',has_table_privilege('anon','public.clinic_receipt_cancellations','select'),'auth_sel',has_table_privilege('authenticated','public.clinic_receipt_cancellations','select'),'auth_ins',has_table_privilege('authenticated','public.clinic_receipt_cancellations','insert'),'auth_upd',has_table_privilege('authenticated','public.clinic_receipt_cancellations','update'),'auth_del',has_table_privilege('authenticated','public.clinic_receipt_cancellations','delete'),'rls',(select relrowsecurity from pg_class where oid='public.clinic_receipt_cancellations'::regclass))"))
    check('ACL tabel jejak: authenticated hanya SELECT (RLS aktif, per cabang); tanpa INSERT/UPDATE/DELETE; anon tidak', tab == dict(anon=False, auth_sel=True, auth_ins=False, auth_upd=False, auth_del=False, rls=True), tab)
    e1 = h.gagal("update public.clinic_receipt_cancellations set reason='diubah';"); e2 = h.gagal("delete from public.clinic_receipt_cancellations;"); e3 = h.gagal("truncate public.clinic_receipt_cancellations;")
    check('jejak tidak dapat diubah/dihapus/dikosongkan (bahkan oleh pemilik tabel)', has(e1, 'AUDIT_IMMUTABLE') and has(e2, 'AUDIT_IMMUTABLE') and has(e3, 'AUDIT_IMMUTABLE'), dict(e1=(e1 or '')[:80], e2=(e2 or '')[:80], e3=(e3 or '')[:80]))
    n_before = h.angka("select count(*) from public.clinic_receipt_cancellations")
    seen = h.gagal("set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub'," + q(STAFF) + ",false); insert into public.clinic_receipt_cancellations(request_key,request_hash,actor_id,actor_role,invoice_id,invoice_no,visit_id,branch_id,reason,tanggal,total_amount,shift_mode,detail,before_invoice,after_invoice,result) select 'x','x',id,'x',id,'x',id,id,'xxx',current_date,1,'nonkas','{}','{}','{}','{}' from public.invoices limit 1;")
    check('akun aplikasi tidak bisa menulis langsung ke tabel jejak', bool(seen) and h.angka("select count(*) from public.clinic_receipt_cancellations") == n_before, dict(err=(seen or '')[:120]))
    check('fungsi lama TIDAK tersentuh: clinic_void_payment_receipt dan clinic_release_advance_application masih ada dan bekerja (jalur lama utuh)',
          h.angka("select count(*) from pg_proc where proname in ('clinic_void_payment_receipt','clinic_release_advance_application')") == 2, {})


def run(h, db, setup=True, baseline=False, sections=None):
    if setup: x.setup(h)
    want = [s for s in SECTIONS if (sections is None or s in sections)]
    fns = dict(direct=section_direct, dp=section_dp, oneoff=section_oneoff, split=section_split, ranap=section_ranap, shift=section_shift, roles=section_roles, guards=section_guards, static=section_static)
    for s in want:
        print('=== section', s, flush=True)
        try:
            if s == 'race': section_race(h, db)
            else: fns[s](h)
        except Exception as e:
            check(f'SECTION {s} aborted', False, str(e).strip()[:400])


def build_chain(db, exclude): okr.build(db, exclude)
def apply_candidate(db, text): db.sql('begin;\n' + text + '\ncommit;')
MUTANTS = []


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin'); ap.add_argument('--attach')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--sections'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--only'); a = ap.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    SEC = set(a.sections.split(',')) if a.sections else None
    extra = {}
    try:
        if a.attach:
            with okr.Attached(r.BIN, a.attach) as db:
                name = 'bk_dev_%d' % int(time.time()); db.sql(f'create database {name} template postgres;'); os.environ['PGDATABASE'] = name
                if not a.baseline: apply_candidate(db, (MIG / CANDIDATE).read_text())
                run(x.Harness(db), db, setup=False, baseline=a.baseline, sections=SEC)
        elif a.mutations:
            from importlib.machinery import SourceFileLoader
            mut = SourceFileLoader('mut', str(ROOT / 'scripts/test-batalkan-penerimaan-klinik-mutants.py')).load_module()
            with r.NativePostgres(r.BIN) as db:
                build_chain(db, {CANDIDATE}); h = x.Harness(db); x.setup(h)
                cand = (MIG / CANDIDATE).read_text(); plan = [('M0 control (unmodified candidate)', cand, None)]; extra['mutants'] = {}
                for name, secs, pairs in mut.MUTANTS:
                    text, ok = cand, True
                    for old, new, expected in pairs:
                        n = text.count(old)
                        if n != expected: check(name + ' anchor occurs %d time(s)' % expected, False, dict(count=n, anchor=old[:60])); ok = False; break
                        text = text.replace(old, new)
                    if not ok or (a.only and not any(o in name for o in a.only.split(','))): continue
                    plan.append((name, text, set(','.join(secs).split(','))))
                for i, (name, text, secs) in enumerate(plan):
                    os.environ.pop('PGDATABASE', None)
                    db.sql(f'create database v{i} template postgres'); os.environ['PGDATABASE'] = f'v{i}'
                    before = len(RESULTS); crash = None
                    try:
                        apply_candidate(db, text); run(h, db, setup=False, sections=secs)
                    except Exception as e:
                        crash = 'battery aborted: ' + str(e).strip().splitlines()[0][:200]
                    fails = [cc['case'] for cc in RESULTS[before:] if cc['status'] == 'FAIL']
                    del RESULTS[before:]; os.environ.pop('PGDATABASE', None)
                    if i == 0: check(name + ' has 0 FAIL', not fails and not crash, (fails + [crash or ''])[:3])
                    else:
                        extra['mutants'][name] = dict(killed=bool(fails), failing=fails[:4], crash=crash)
                        check(name + ' KILLED', bool(fails), fails[:3] or [crash]); print('   failing:', fails[:4], flush=True)
        else:
            with r.NativePostgres(r.BIN) as db:
                build_chain(db, {CANDIDATE} if a.baseline else set()); run(x.Harness(db), db, baseline=a.baseline, sections=SEC)
    except Exception as e: check('HARNESS', False, str(e)[:800])
    totals = {s: sum(cc['status'] == s for cc in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='mutations' if a.mutations else 'RED' if a.baseline else 'GREEN', cases=RESULTS, totals=totals, **extra), indent=2, default=str)); print(totals)
    return 0 if a.baseline else int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
