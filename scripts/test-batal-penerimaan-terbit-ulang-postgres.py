#!/usr/bin/env python3
"""'Batalkan penerimaan' untuk tagihan hasil Void & Terbitkan Ulang (migrasi 20261124100000_batal_penerimaan_terbit_ulang.sql).

Kasus nyata 17 Nov 2026: INV-202611-1285 (Kovu, Panduraya; pengganti INV-202611-1263 yang di-void; Rp90.000 QRIS; correction_pending) tidak bisa
diturunkan ke Rp45.000 karena uangnya berasal dari tagihan lama. Skrip ini membuktikan di PG17 native (rantai migrasi penuh, data fiktif, tanpa jaringan):
uang pindahan dibalik di rekening ASAL, jurnal seimbang, jejak lengkap, idempoten, tanpa pembalikan ganda, bentuk yang belum didukung ditolak dengan
bahasa biasa, lalu tagihan bisa diubah (diskon 50%) dan diterima ulang lewat jalur biasa.

  flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-batal-penerimaan-terbit-ulang-postgres.py --pg-bin DIR --json out.json
  --baseline    rantai TANPA migrasi kandidat: kasus fitur harus GAGAL (RED)
  --mutations   rantai tanpa kandidat sekali, tiap mutan di database klon; semua harus terbunuh
  --attach DIR  dev: klon database `postgres` (rantai tanpa kandidat + x.setup) pada cluster yang berjalan
  --sections a,b  hanya bagian tertentu
"""
import argparse, importlib.util, json, os, sys, time
from decimal import Decimal
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('bk', ROOT / 'scripts/test-batalkan-penerimaan-klinik-postgres.py'); assert spec and spec.loader
bk = importlib.util.module_from_spec(spec); spec.loader.exec_module(bk)
okr, m, x, r, q, j, c = bk.okr, bk.m, bk.x, bk.r, bk.q, bk.j, bk.c
CANDIDATE = '20261124100000_batal_penerimaan_terbit_ulang.sql'
MIG = ROOT / 'supabase/migrations'
RESULTS = []
RPC = bk.RPC
OWNER, ADMIN, FINANCE, STAFF = r.OWNER, r.ADMIN, r.FINANCE, r.STAFF
D, tb, net, has, nxt0 = bk.D, bk.tb, bk.net, bk.has, bk.nxt
OFF = 0
NEXT = [41000]
ACCTS = bk.ACCTS
NEW_FUNCS = {'cancel_receipt_transfer_check'}
PATCHED = {'cancel_receipt_scan', 'clinic_cancel_invoice_receipt', 'clinic_cancel_invoice_receipt_preview'}


def check(name, ok, detail=None):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:420], flush=True)


def nxt():
    NEXT[0] += 3; return NEXT[0] + OFF


def cancel(h, inv, key, user=OWNER, reason='Turunkan nilai nota, disetujui Owner'): return bk.do_cancel(h, inv, key, user, reason)


def lines90(n, disc=0):
    ls = r.baris(n, 1); ls[0] = dict(ls[0], price=90000, discount_percent=disc); return ls


def reissued(h, metode='QRIS', status='Lunas', dp=0, slots=(1, 2), user=OWNER, one=False, split=None):
    """Nota asli A (Lunas langsung / DP / split) -> Void & Terbit Ulang oleh Owner -> nota pengganti B (correction_pending, uang dipindahkan)."""
    n = nxt()
    if one:
        cust = r.buat_pelanggan(h, n); v = r.buat_kunjungan(h, n, cust, admitted=False); ls = lines90(n)
        ganti = {'paid_status': 'Lunas', 'metode_bayar': metode, 'dp_amount': 0, 'dp_date': None}
        h.sql(r.tagih_biasa_sql(v, f'k{n}-post', ls, user, alasan='Uji fiktif', ganti=ganti), user)
        old = h.aktif(v); F = dict(n=n, v=v, inv=old, no=h.no_tagihan(old), total=90000, lines=ls, slots=(1,), user=user)
    else:
        F = bk.rj(h, n, metode, status, dp, slots, user, split)
    old, oldno = F['inv'], F['no']
    new = h.nilai(r.terbit_ulang_sql(old, f'k{n}-ru', 'harusnya diskon'), OWNER)
    return dict(F, old=old, oldno=oldno, inv=new, no=h.no_tagihan(new), nos=[oldno, h.no_tagihan(new)])


def cnet(h, nos):
    out = {k: Decimal(0) for k in ACCTS}
    for no in nos:
        for k, v in net(h, no).items(): out[k] += v
    return out


def pays(h, inv):
    return json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at, p.id),'[]') from public.invoice_payments p where invoice_id={q(inv)}"))


def jnl_since(h, no, before):
    return json.loads(h.nilai("select coalesce(jsonb_agg(jsonb_build_object('source',e.source,'desc',e.deskripsi,'lines',(select jsonb_agg(jsonb_build_object('code',a.code,'d',l.debit,'c',l.credit) order by a.code) from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=e.id)) order by e.created_at, e.id),'[]') "
                              f"from public.journal_entries e where e.source_ref={q(no)} and e.created_at > {q(before)}::timestamptz and e.source like 'klinik%'"))


def now_(h): return h.nilai("select clock_timestamp()::text")


def snap(h):
    """Sidik hal-hal yang TIDAK boleh disentuh pembatalan penerimaan: stok, gerakan stok, HPP/baris tagihan, poin."""
    return dict(
        stock=h.nilai("select coalesce(md5(string_agg(to_jsonb(s)::text,',' order by s.item_id, s.warehouse_id)),'') from public.stock s"),
        moves=h.angka("select count(*) from public.stock_moves"),
        items=h.nilai("select coalesce(md5(string_agg(to_jsonb(i)::text,',' order by i.id)),'') from public.invoice_items i"),
        points=h.nilai("select coalesce(md5(string_agg(to_jsonb(c)::text,',' order by c.id)),'') from (select id, points from public.customers) c"),
        pledger=h.nilai("select coalesce(md5(string_agg(to_jsonb(p)::text,',' order by p.id)),'') from public.point_ledger p"),
        hpp=h.nilai("select coalesce(md5(string_agg(to_jsonb(e)::text,',' order by e.id)),'') from public.journal_entries e where e.source in ('klinik-hpp','klinik-hpp-edit','klinik-hpp-void')"))


def kasus_tag(h, F):
    return h.nilai(f"select md5(coalesce(string_agg(to_jsonb(e)::text||(select coalesce(string_agg(to_jsonb(l)::text,',' order by l.id),'') from public.journal_lines l where l.entry_id=e.id),',' order by e.id),'')) from public.journal_entries e where e.source_ref={q(F['oldno'])}")


# ---------------------------------------------------------------- bagian
def sec_kovu(h):
    """Kasus Andri: Grooming 90.000 QRIS -> void & terbit ulang -> batalkan penerimaan -> diskon 50% -> terima ulang 45.000."""
    F = reissued(h, 'QRIS', one=True); B, nos = F['inv'], F['nos']
    row = bk.inv_row(h, B); p0 = pays(h, B); c0 = cnet(h, nos)
    check('kovu: fixture = INV-1285: pengganti Lunas, correction_pending, reissued_from nota void, uang 90.000 = SATU baris pindahan QRIS rekening bank',
          row['paid_status'] == 'Lunas' and row['correction_pending'] and row['reissued_from'] == F['old'] and len(p0) == 1 and p0[0]['transferred_from'] == F['old']
          and D(p0[0]['amount']) == 90000 and p0[0]['kas_code'] == '120002' and p0[0]['metode'] == 'QRIS' and D(row['dp_amount']) == 0, dict(p=p0))
    check('kovu: fixture: uang 90.000 ada di bank lewat jurnal nota lama (saldo bersih rantai bank = 90.000, piutang 0, pendapatan -90.000), neraca 0',
          c0['120002'] == 90000 and c0['150001'] == 0 and c0['510002'] == -90000 and tb(h) == 0, {k: str(v) for k, v in c0.items()})
    st0 = bk.money_state(h); sn0 = snap(h); a_tag = kasus_tag(h, F)
    e, pv = bk.preview(h, B)
    check('kovu: pratinjau (baca-saja) TIDAK lagi menolak: refuse kosong, 1 pembayaran pindahan 90.000 QRIS ke bank menyebut nomor nota lama, mode nonkas',
          e is None and pv['refuse'] is None and len(pv['payments']) == 1 and pv['payments'][0].get('transferred') is True and D(pv['payments'][0]['amount']) == 90000
          and pv['payments'][0]['kas_code'] == '120002' and pv['payments'][0]['transferred_from_no'] == F['oldno'] and pv['shift_mode'] == 'nonkas' and D(pv['cash_amount']) == 0,
          dict(err=(e or '')[:200], p=str(pv)[:300]))
    check('kovu: pratinjau tidak mengubah apa pun', bk.money_state(h) == st0, {})
    t0 = now_(h)
    err, res = cancel(h, B, f"c-{F['n']}")
    check('kovu: Batalkan penerimaan pada nota hasil terbit ulang BERHASIL (CANCELLED, jumlah 90.000, bukan penerimaan langsung)',
          err is None and res['status'] == 'CANCELLED' and D(res['amount']) == 90000 and D(res['direct_amount']) == 0 and res['shift_mode'] == 'nonkas' and D(res['cash_amount']) == 0, dict(err=(err or '')[:300], res=res))
    row = bk.inv_row(h, B); p1 = pays(h, B)
    check('kovu: nota kembali Belum Lunas, nomor sama, bukan void, paid_at kosong, masih hasil terbit ulang (correction_pending tetap) agar dikoreksi dulu',
          row['paid_status'] == 'Belum Lunas' and row['paid_at'] is None and row['voided_at'] is None and row['invoice_no'] == F['no'] and row['correction_pending'] and row['reissued_from'] == F['old'], dict(row=row['paid_status']))
    rev = [p for p in p1 if D(p['amount']) < 0]
    check('kovu: baris pembayaran: 2 baris neto 0; pembalik -90.000 QRIS rekening bank menunjuk baris pindahan (reversal_of), bukan pindahan, tanggal hari ini',
          len(p1) == 2 and sum(D(p['amount']) for p in p1) == 0 and len(rev) == 1 and rev[0]['reversal_of'] == p0[0]['id'] and rev[0]['kas_code'] == '120002' and rev[0]['metode'] == 'QRIS'
          and rev[0]['transferred_from'] is None and rev[0]['checkout_payment'] is False and D(rev[0]['amount']) == -90000 and rev[0]['tanggal'] == h.nilai("select (now() at time zone 'Asia/Jakarta')::date::text"), dict(rev=rev))
    js = jnl_since(h, F['no'], t0)
    check('kovu: tepat SATU jurnal baru (klinik-ar, nomor nota pengganti): Dr 150001 90.000 / Cr 120002 (bank) 90.000, seimbang; keterangan menyebut nota lama',
          len(js) == 1 and js[0]['source'] == 'klinik-ar' and js[0]['lines'] == [dict(code='120002', d=0, c=90000), dict(code='150001', d=90000, c=0)] and F['oldno'] in js[0]['desc'] and 'pindahan' in js[0]['desc'], dict(js=js))
    c1 = cnet(h, nos)
    check('kovu: rekening: bank 0 (uang dikeluarkan dari rekening ASAL), piutang 90.000, pendapatan tetap -90.000; neraca saldo seluruh basis data 0',
          c1['120002'] == 0 and c1['150001'] == 90000 and c1['510002'] == -90000 and tb(h) == 0, {k: str(v) for k, v in c1.items()})
    check('kovu: jurnal nota LAMA (void) sama sekali tidak diubah (hash jurnal dan baris)', kasus_tag(h, F) == a_tag, {})
    sn1 = snap(h)
    check('kovu: stok, gerakan stok, baris tagihan/HPP, jurnal HPP, SALDO POIN dan buku poin TIDAK berubah', sn1 == sn0, {k: (sn0[k], sn1[k]) for k in sn0 if sn0[k] != sn1[k]})
    a = json.loads(h.nilai(f"select to_jsonb(a) from public.clinic_receipt_cancellations a where invoice_id={q(B)}"))
    check('kovu: jejak audit: alasan, pelaku OWNER, peran, kunci, waktu, tanggal, total 90.000, direct 0, kas 0, mode nonkas, 1 jurnal',
          a['reason'] == 'Turunkan nilai nota, disetujui Owner' and a['actor_id'] == OWNER and a['actor_role'] == 'OWNER' and a['request_key'] == f"c-{F['n']}" and D(a['total_amount']) == 90000
          and D(a['direct_amount']) == 0 and D(a['cash_amount']) == 0 and a['shift_mode'] == 'nonkas' and len(a['journal_ids']) == 1 and a['created_at'] and audit(h, B) == 1, dict(a={k: a[k] for k in ('reason', 'actor_role', 'shift_mode')}))
    d0 = a['detail']['payments'][0]
    check('kovu: jejak audit menautkan nota asli dan nota pengganti: baris pindahan, nota lama (id+nomor), rekening; snapshot sebelum Lunas / sesudah Belum Lunas',
          d0['transferred_from'] == F['old'] and d0['transferred_from_no'] == F['oldno'] and d0['payment_id'] == p0[0]['id'] and d0['kas_code'] == '120002' and D(d0['amount']) == 90000
          and a['before_invoice']['paid_status'] == 'Lunas' and a['after_invoice']['paid_status'] == 'Belum Lunas' and a['before_invoice']['reissued_from'] == F['old'], dict(d0=d0))
    check('kovu: kunjungan kembali ke Pembayaran (muncul lagi di kasir)', h.nilai(f"select status from public.visits where id={q(F['v'])}") == 'Pembayaran', {})
    elig = h.nilai(f"select public.clinic_invoice_correction_eligible({q(B)});", OWNER)
    check('kovu: jalur koreksi yang ada menganggap nota LAYAK dikoreksi (eligible = true) dan pembayaran dianggap dibalik penuh', elig == 't'
          and json.loads(h.nilai(f"select to_jsonb(clinic_private.payments_fully_reversed({q(B)}))")) is True, dict(elig=elig))
    st1 = bk.money_state(h)
    err2, res2 = cancel(h, B, f"c-{F['n']}")
    check('kovu: kunci sama diulang: hasil lama dikembalikan, keadaan uang sama, satu baris audit (tidak membalik dua kali)', err2 is None and res2 == res and bk.money_state(h) == st1 and audit(h, B) == 1, dict(err=(err2 or '')[:160]))
    err3, _ = cancel(h, B, f"c-{F['n']}-lagi")
    check('kovu: dibatalkan lagi dengan kunci lain: ditolak BELUM_ADA_PENERIMAAN, tidak ada efek (tidak ada pembalikan ganda)', has(err3, 'BELUM_ADA_PENERIMAAN') and bk.money_state(h) == st1, dict(err=(err3 or '')[:200]))
    # --- Owner turunkan: diskon baris 50% (payload yang sama dengan kasus nyata)
    ls = lines90(F['n'], 50)
    e1 = h.gagal(r.koreksi_sql(h, B, f"e-{F['n']}", ls), OWNER)
    row = bk.inv_row(h, B); c2 = cnet(h, nos)
    check('kovu: Owner mengubah nota ke Rp45.000 (diskon baris 50%): DITERIMA (sebelumnya INVOICE_INVALID), Belum Lunas, koreksi selesai (correction_pending false)',
          e1 is None and D(row['total']) == 45000 and row['paid_status'] == 'Belum Lunas' and row['correction_pending'] is False, dict(err=(e1 or '')[:300], total=row['total']))
    check('kovu: setelah koreksi: piutang = 45.000, pendapatan bersih 45.000, bank tetap 0, neraca 0', c2['150001'] == 45000 and c2['510002'] + c2['520002'] == -45000 and c2['120002'] == 0 and tb(h) == 0, {k: str(v) for k, v in c2.items()})
    e2 = bk.settle(h, F, [{'method': 'QRIS', 'amount': 45000}], f"s-{F['n']}")
    row = bk.inv_row(h, B); c3 = cnet(h, nos)
    rc = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_object('status',status,'total',total,'tanggal',tanggal)),'[]') from public.clinic_payment_receipts where visit_id={q(F['v'])}"))
    check('kovu: terima ulang 45.000 QRIS lewat jalur biasa: Lunas, kwitansi aktif Rp45.000 (uang yang benar-benar diterima tampil), bank 45.000, piutang 0, neraca 0',
          e2 is None and row['paid_status'] == 'Lunas' and len(rc) == 1 and rc[0]['status'] == 'aktif' and D(rc[0]['total']) == 45000 and c3['120002'] == 45000 and c3['150001'] == 0
          and c3['510002'] + c3['520002'] == -45000 and tb(h) == 0 and h.diterima(B) == 45000, dict(err=(e2 or '')[:300], rc=rc, c3={k: str(v) for k, v in c3.items()}))
    check('kovu: selisih 45.000 TIDAK dibuat otomatis (tidak ada permintaan refund/refund): tetap tindakan Finance',
          h.angka(f"select count(*) from public.clinic_refund_requests where invoice_id in ({q(B)},{q(F['old'])})") == 0 and h.angka(f"select count(*) from public.clinic_refunds where invoice_id in ({q(B)},{q(F['old'])})") == 0, {})
    err4, res4 = cancel(h, B, f"c2-{F['n']}")
    ptr = json.loads(h.nilai(f"select count(*) from public.invoice_payments where invoice_id={q(B)} and reversal_of={q(p0[0]['id'])}"))
    check('kovu: batalkan penerimaan lagi (kwitansi 45.000) memakai jalur lama: berhasil, baris pindahan TIDAK dibalik lagi (tepat satu pembalik), bank 0, neraca 0',
          err4 is None and ptr == 1 and cnet(h, nos)['120002'] == 0 and h.status_bayar(B) == 'Belum Lunas' and tb(h) == 0, dict(err=(err4 or '')[:300], ptr=ptr))


def audit(h, inv): return bk.audit_rows(h, inv)


def sec_kovu2(h):
    """Keadaan SEBENARNYA INV-1285 di hosted (dry run 17 Nov): koreksi sudah diselesaikan tanpa ubah angka (correction_pending = false), masih Lunas 90.000 QRIS."""
    F = reissued(h, 'QRIS', one=True); B, nos = F['inv'], F['nos']
    e0 = h.gagal(r.koreksi_sql(h, B, f"e0-{F['n']}", lines90(F['n'], 0)), OWNER); row = bk.inv_row(h, B); c0 = cnet(h, nos)
    check('kovu2: fixture: koreksi diselesaikan tanpa ubah angka -> Lunas 90.000, correction_pending false, masih hasil terbit ulang, uang tetap SATU baris pindahan; bank 90.000 (jurnal rantai cocok)',
          e0 is None and row['paid_status'] == 'Lunas' and row['correction_pending'] is False and row['reissued_from'] == F['old'] and len(pays(h, B)) == 1 and c0['120002'] == 90000 and tb(h) == 0, dict(e0=(e0 or '')[:200], c0={k: str(v) for k, v in c0.items()}))
    e, pv = bk.preview(h, B)
    check('kovu2: pratinjau tidak menolak (sebelumnya kalimat "Hubungi tim pengembang"), menyebut pindahan dari nota lama', e is None and pv['refuse'] is None and pv['payments'][0]['transferred_from_no'] == F['oldno'], dict(e=(e or '')[:200]))
    err, res = cancel(h, B, f"c-{F['n']}"); c1 = cnet(h, nos)
    check('kovu2: Batalkan penerimaan berhasil: Belum Lunas, bank 0, piutang = total, pendapatan tetap, neraca 0, tanpa tanda koreksi tertunda',
          err is None and h.status_bayar(B) == 'Belum Lunas' and c1['120002'] == 0 and c1['150001'] == 90000 and c1['510002'] == -90000 and tb(h) == 0 and bk.inv_row(h, B)['correction_pending'] is False, dict(err=(err or '')[:300]))
    e1 = h.gagal(r.koreksi_sql(h, B, f"e-{F['n']}", lines90(F['n'], 50)), OWNER); row = bk.inv_row(h, B)
    check('kovu2: Owner menurunkan nota ke 45.000 (diskon baris 50%) DITERIMA; Belum Lunas', e1 is None and D(row['total']) == 45000 and row['paid_status'] == 'Belum Lunas', dict(err=(e1 or '')[:300]))
    e2 = bk.settle(h, F, [{'method': 'QRIS', 'amount': 45000}], f"s-{F['n']}"); c3 = cnet(h, nos)
    check('kovu2: terima ulang 45.000 QRIS lewat jalur biasa: Lunas, bank 45.000, piutang 0, pendapatan 45.000, neraca 0, diterima 45.000 (bukan 90.000)',
          e2 is None and h.status_bayar(B) == 'Lunas' and c3['120002'] == 45000 and c3['150001'] == 0 and c3['510002'] + c3['520002'] == -45000 and tb(h) == 0 and h.diterima(B) == 45000, dict(err=(e2 or '')[:300]))
    # Tunai, shift asal tertutup, keadaan sama (pending false)
    G = reissued(h, 'Tunai', one=True, user=STAFF); g0 = h.gagal(r.koreksi_sql(h, G['inv'], f"e0-{G['n']}", lines90(G['n'], 0)), OWNER)
    bk.set_shift(h, STAFF, 'closed')
    try: err3, res3 = cancel(h, G['inv'], f"c-{G['n']}")
    finally: bk.set_shift(h, STAFF, 'open')
    check('kovu2: Tunai 90.000, koreksi selesai, shift asal tutup: batal berhasil, dicatat di shift Owner (shift_berjalan), kas 0', g0 is None and err3 is None and res3['shift_mode'] == 'shift_berjalan' and D(res3['cash_amount']) == 90000 and cnet(h, G['nos'])['110003'] == 0 and tb(h) == 0, dict(g0=(g0 or '')[:160], err=(err3 or '')[:200]))


def sec_tunai(h):
    """Shift: Tunai pindahan; shift asal terbuka/tutup/tanpa shift Owner; QRIS tidak menyentuh laci."""
    F = reissued(h, 'Tunai', user=STAFF); B = F['inv']; carry0 = D(bk.inv_row(h, B)['shift_cash_carry'])
    check('shift: fixture Tunai dari shift STAFF (terbuka): nota pengganti membawa shift_cash_carry = total dan metode Tunai, rekening kas 110003',
          carry0 == F['total'] and bk.inv_row(h, B)['metode_bayar'] == 'Tunai' and pays(h, B)[0]['kas_code'] == '110003' and cnet(h, F['nos'])['110003'] == F['total'], dict(carry=str(carry0)))
    e, pv = bk.preview(h, B)
    check('shift: pratinjau Tunai pindahan: cash_amount = total dan mode shift_asal_terbuka (shift STAFF)', e is None and D(pv['cash_amount']) == F['total'] and pv['shift_mode'] == 'shift_asal_terbuka', dict(e=(e or '')[:160]))
    err, res = cancel(h, B, f"c-{F['n']}"); carry1 = D(bk.inv_row(h, B)['shift_cash_carry'])
    check('shift: shift asal TERBUKA: mode shift_asal_terbuka, cancel_shift = shift asal, cash_amount = total, kas dibalik, neraca 0',
          err is None and res['shift_mode'] == 'shift_asal_terbuka' and res['cancel_shift_id'] == r.SHIFT[STAFF] and D(res['cash_amount']) == F['total'] and cnet(h, F['nos'])['110003'] == 0 and tb(h) == 0, dict(err=(err or '')[:200], res=res))
    check('shift: shift asal terbuka: shift_cash_carry dikurangi sebesar Tunai yang dibatalkan (laci shift terbuka tidak menghitung uang itu lagi) -> 0', carry1 == 0, dict(carry=str(carry1)))
    # shift asal TUTUP
    G = reissued(h, 'Tunai', user=STAFF); bk.set_shift(h, STAFF, 'closed')
    try:
        shift_before = h.nilai(f"select to_jsonb(s)::text from public.cashier_shifts s where id={q(r.SHIFT[STAFF])}")
        err, res = cancel(h, G['inv'], f"c-{G['n']}"); carry = D(bk.inv_row(h, G['inv'])['shift_cash_carry'])
        shift_after = h.nilai(f"select to_jsonb(s)::text from public.cashier_shifts s where id={q(r.SHIFT[STAFF])}")
        check('shift: shift asal TUTUP: mode shift_berjalan: dicatat di shift Owner yang terbuka; rekaman shift tutup TIDAK berubah; carry nota tidak disentuh (laci lama beku)',
              err is None and res['shift_mode'] == 'shift_berjalan' and res['cancel_shift_id'] == r.SHIFT[OWNER] and shift_before == shift_after and D(res['cash_amount']) == G['total'] and carry == G['total'], dict(err=(err or '')[:200], res=res))
        row = json.loads(h.nilai(f"select to_jsonb(a) from public.clinic_receipt_cancellations a where invoice_id={q(G['inv'])}"))
        check('shift: baris jejak shift_berjalan membawa cancel_shift_id dan cash_amount (dibaca penutup shift Owner sebagai pengurang Tunai)', row['cancel_shift_id'] == r.SHIFT[OWNER] and D(row['cash_amount']) == G['total'] and row['source_shift_status'] == 'closed', dict(row=row['shift_mode']))
        H = reissued(h, 'Tunai', user=ADMIN); bk.set_shift(h, ADMIN, 'closed'); bk.set_shift(h, OWNER, 'closed')
        try:
            err2, res2 = cancel(h, H['inv'], f"c-{H['n']}")
            check('shift: Owner TANPA shift terbuka dan shift asal tutup tetap bisa (tidak terkunci); ditandai tanpa_shift untuk Finance, cancel_shift kosong',
                  err2 is None and res2['shift_mode'] == 'tanpa_shift' and res2['cancel_shift_id'] is None and D(res2['cash_amount']) == H['total'] and h.status_bayar(H['inv']) == 'Belum Lunas', dict(err=(err2 or '')[:200], res=res2))
        finally:
            bk.set_shift(h, ADMIN, 'open'); bk.set_shift(h, OWNER, 'open')
    finally:
        bk.set_shift(h, STAFF, 'open')
    K = reissued(h, 'QRIS', user=FINANCE); err3, res3 = cancel(h, K['inv'], f"c-{K['n']}")
    check('shift: QRIS pindahan tidak menyentuh laci: nonkas, cash 0, carry nota tidak berubah', err3 is None and res3['shift_mode'] == 'nonkas' and D(res3['cash_amount']) == 0 and D(bk.inv_row(h, K['inv'])['shift_cash_carry']) == K['total'], dict(err=(err3 or '')[:200]))
    L = reissued(h, 'Tunai', user=FINANCE)
    e4, pv4 = bk.preview(h, L['inv'])
    check('shift: pratinjau Tunai menyebut mode shift (asal terbuka) sama dengan hasil eksekusi', e4 is None and pv4['shift_mode'] == cancel(h, L['inv'], f"c-{L['n']}")[1]['shift_mode'], {})


def sec_dp(h):
    """DP dan bayar sebagian: DP Tunai 100.000 dari nota 220.000, terbit ulang, batal, ubah, terima penuh."""
    F = reissued(h, 'Tunai', 'DP', 100000, slots=(1, 2)); B = F['inv']; p0 = pays(h, B); row = bk.inv_row(h, B)
    check('dp: fixture: nota pengganti status DP, uang 100.000 = satu baris pindahan Tunai (kas 110003), dp_amount 0 di nota pengganti', row['paid_status'] == 'DP' and len(p0) == 1 and D(p0[0]['amount']) == 100000 and p0[0]['kas_code'] == '110003' and D(row['dp_amount']) == 0, dict(p=p0))
    err, res = cancel(h, B, f"c-{F['n']}"); c1 = cnet(h, F['nos'])
    check('dp: batalkan: Belum Lunas, kas 0, piutang = total, jumlah 100.000 (bukan total), neraca 0', err is None and D(res['amount']) == 100000 and h.status_bayar(B) == 'Belum Lunas' and c1['110003'] == 0 and c1['150001'] == F['total'] and tb(h) == 0, dict(err=(err or '')[:200]))
    e1 = bk.edit_inv(h, dict(F, inv=B), f"e-{F['n']}", -20000); e2 = bk.settle(h, F, [{'method': 'QRIS', 'amount': F['total'] - 20000}], f"s-{F['n']}")
    c2 = cnet(h, F['nos'])
    check('dp: nota diturunkan 20.000 lalu diterima penuh QRIS: Lunas, bank = total baru, kas 0, piutang 0, neraca 0', e1 is None and e2 is None and h.status_bayar(B) == 'Lunas' and c2['120002'] == F['total'] - 20000 and c2['110003'] == 0 and c2['150001'] == 0 and tb(h) == 0,
          dict(e1=(e1 or '')[:200], e2=(e2 or '')[:200]))
    # DP + pelunasan SESUDAH terbit ulang (kwitansi pada nota pengganti): semuanya dibatalkan sekaligus, baris pindahan hanya sekali
    G = reissued(h, 'Tunai', 'DP', 100000, slots=(1, 2)); e0 = bk.edit_inv(h, G, f"e0-{G['n']}", 0)   # selesaikan koreksi (angka sama) supaya bisa menerima sisanya
    ee = e0 or bk.settle(h, G, [{'method': 'QRIS', 'amount': G['total'] - 100000}], f"s2-{G['n']}")
    rc = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={q(G['v'])} and status='aktif'")
    err2, res2 = cancel(h, G['inv'], f"c-{G['n']}"); c3 = cnet(h, G['nos'])
    check('dp: DP pindahan + pelunasan kwitansi sesudah terbit ulang: batalkan membalik DUA-DUANYA: kwitansi batal, kas 0, bank 0, piutang = total, tiap baris dibalik tepat sekali, neraca 0',
          ee is None and err2 is None and h.nilai(f"select status from public.clinic_payment_receipts where id={q(rc)}") == 'batal' and c3['110003'] == 0 and c3['120002'] == 0 and c3['150001'] == G['total'] and h.status_bayar(G['inv']) == 'Belum Lunas' and tb(h) == 0
          and h.angka(f"select count(*) from public.invoice_payments where invoice_id={q(G['inv'])} and amount<0") == 2, dict(e=(ee or '')[:120], err=(err2 or '')[:200], c3={k: str(v) for k, v in c3.items()}))


def sec_split(h):
    """Pembayaran campur beberapa metode (Tunai 60.000 + QRIS 40.000, dua baris tanpa kwitansi)."""
    try:
        F = reissued(h, split=[{'method': 'Tunai', 'amount': 60000, 'kas_code': '110003'}, {'method': 'QRIS', 'amount': 40000, 'kas_code': '120002'}], slots=(1,))
    except RuntimeError as e:
        check('split: nota campur bisa disiapkan dan diterbitkan ulang (fixture)', False, str(e)[:300]); return
    B = F['inv']; p0 = pays(h, B)
    check('split: fixture: nota pengganti membawa dua baris pindahan (Tunai 60.000 kas 110003 + QRIS 40.000 bank 120002)', len(p0) == 2 and {(p['metode'], D(p['amount']), p['kas_code']) for p in p0} == {('Tunai', D(60000), '110003'), ('QRIS', D(40000), '120002')}
          and all(p['transferred_from'] == F['old'] for p in p0), dict(p=[(p['metode'], p['amount']) for p in p0]))
    err, res = cancel(h, B, f"c-{F['n']}"); c1 = cnet(h, F['nos']); p1 = pays(h, B)
    check('split: batalkan: SEMUA bagian dibalik di rekening masing-masing: kas 0 dan bank 0, piutang 100.000, Belum Lunas, 4 baris neto 0, neraca 0',
          err is None and c1['110003'] == 0 and c1['120002'] == 0 and c1['150001'] == F['total'] and h.status_bayar(B) == 'Belum Lunas' and len(p1) == 4 and sum(D(p['amount']) for p in p1) == 0 and tb(h) == 0 and D(res['amount']) == F['total'],
          dict(err=(err or '')[:300], c1={k: str(v) for k, v in c1.items()}))
    check('split: cash_amount hanya bagian Tunai (60.000) dan jurnal tepat dua (satu per rekening)', D(res['cash_amount']) == 60000 and len(json.loads(h.nilai(f"select to_jsonb(journal_ids) from public.clinic_receipt_cancellations where invoice_id={q(B)}"))) == 2, dict(res=res))
    e1 = bk.edit_inv(h, dict(F, inv=B), f"e-{F['n']}", -10000)
    e2 = bk.settle(h, F, [{'method': 'Tunai', 'amount': 40000}, {'method': 'QRIS', 'amount': 50000}], f"s-{F['n']}"); fin = cnet(h, F['nos'])
    check('split: nota diturunkan lalu diterima ulang dengan campuran baru -> Lunas, kas 40.000, bank 50.000, piutang 0, neraca 0', e1 is None and e2 is None and h.status_bayar(B) == 'Lunas' and fin['110003'] == 40000 and fin['120002'] == 50000 and fin['150001'] == 0 and tb(h) == 0, dict(e1=(e1 or '')[:200], e2=(e2 or '')[:200]))


def sec_poin(h):
    """Poin dipakai pada nota asli (buku poin + saldo pelanggan): pembatalan penerimaan tidak mengubahnya; diskon poin tetap pada nota."""
    F = reissued(h, 'QRIS', one=True); cust = h.nilai(f"select customer_id from public.visits where id={q(F['v'])}")
    h.sistem(f"update public.customers set points=700 where id={q(cust)}; insert into public.point_ledger(customer_id,delta,saldo,ref,description,entry_type) values ({q(cust)},-300,700,{q(F['oldno'])},'Tukar poin','redeem');")
    before = snap(h); led = h.angka(f"select count(*) from public.point_ledger where customer_id={q(cust)}")
    err, res = cancel(h, F['inv'], f"c-{F['n']}")
    after = snap(h)
    check('poin: poin dipakai pada nota asli (700 poin tersisa, 1 baris buku poin): batalkan penerimaan hasil terbit ulang TIDAK mengubah saldo poin maupun buku poin (sama dengan Void/Koreksi)',
          err is None and before == after and h.angka(f"select points from public.customers where id={q(cust)}") == 700 and h.angka(f"select count(*) from public.point_ledger where customer_id={q(cust)}") == led, dict(err=(err or '')[:200]))
    check('poin: tidak ada baris buku poin baru bernomor nota pengganti (tidak ada refund poin tersembunyi)', h.angka(f"select count(*) from public.point_ledger where ref={q(F['no'])}") == 0, {})
    # voucher menempel di nota: tidak disentuh
    G = reissued(h, 'QRIS', one=True); h.sistem(f"update public.invoices set voucher_code='VCH-FIKTIF' where id={q(G['inv'])};")
    err2, _ = cancel(h, G['inv'], f"c-{G['n']}")
    check('voucher: kode voucher pada nota tetap sama setelah batalkan penerimaan', err2 is None and bk.inv_row(h, G['inv'])['voucher_code'] == 'VCH-FIKTIF', dict(err=(err2 or '')[:160]))


def sec_chain(h):
    """Terbit ulang berlapis A -> B -> C dan terbit ulang SESUDAH batal: tidak ada pembalikan ganda."""
    F = reissued(h, 'QRIS', one=True)
    C2 = h.nilai(r.terbit_ulang_sql(F['inv'], f"k{F['n']}-ru2", 'terbit ulang lagi'), OWNER); C2no = h.no_tagihan(C2)
    nos = F['nos'] + [C2no]; pc = pays(h, C2)
    check('rantai: A -> B -> C: nota C Lunas, correction_pending, membawa uang 90.000 (baris pindahan dari B, rekening bank); rantai bank = 90.000',
          bk.inv_row(h, C2)['paid_status'] == 'Lunas' and len([p for p in pc if D(p['amount']) > 0]) == 1 and pc[0]['transferred_from'] == F['inv'] and cnet(h, nos)['120002'] == 90000, dict(p=[(p['amount'], p['kas_code']) for p in pc]))
    err, res = cancel(h, C2, f"c-{F['n']}-c"); c1 = cnet(h, nos)
    check('rantai: batalkan penerimaan nota C (dua tingkat dari nota asli): rekening dibaca dari rantai penuh; bank 0, piutang 90.000, neraca 0, C Belum Lunas, jejak menyebut nota B',
          err is None and c1['120002'] == 0 and c1['150001'] == 90000 and h.status_bayar(C2) == 'Belum Lunas' and tb(h) == 0 and json.loads(h.nilai(f"select to_jsonb(detail) from public.clinic_receipt_cancellations where invoice_id={q(C2)}"))['payments'][0]['transferred_from_no'] == F['no'], dict(err=(err or '')[:300]))
    # terbit ulang SESUDAH batal tanpa uang baru: ditolak oleh terbit ulang itu sendiri (tidak ada yang dibawa)
    G = reissued(h, 'QRIS', one=True); e0, _ = cancel(h, G['inv'], f"c-{G['n']}")
    e1 = h.gagal(r.terbit_ulang_sql(G['inv'], f"k{G['n']}-ru3", 'terbit ulang setelah batal'), OWNER)
    check('rantai: terbit ulang pada nota yang penerimaannya sudah dibatalkan (tanpa uang) ditolak oleh terbit ulang sendiri; tidak ada salinan riwayat yang bisa dibalik dua kali', e0 is None and has(e1, 'INVOICE_INVALID'), dict(e0=(e0 or '')[:100], e1=(e1 or '')[:160]))
    # nota B: batal -> ubah -> terima ulang (kwitansi 45.000) -> terbit ulang lagi: C membawa riwayat bercampur; Batalkan penerimaan ditolak aman (tidak membalik apa pun)
    H = reissued(h, 'QRIS', one=True); e0, _ = cancel(h, H['inv'], f"c-{H['n']}")
    e1 = h.gagal(r.koreksi_sql(h, H['inv'], f"e-{H['n']}", lines90(H['n'], 50)), OWNER); e2 = bk.settle(h, H, [{'method': 'QRIS', 'amount': 45000}], f"s-{H['n']}")
    C3 = h.nilai(r.terbit_ulang_sql(H['inv'], f"k{H['n']}-ru4", 'terbit ulang lagi'), OWNER) if (e0 is None and e1 is None and e2 is None) else None
    if C3:
        st = bk.money_state(h); e3, _ = cancel(h, C3, f"c-{H['n']}-c3"); pc3 = pays(h, C3)
        check('rantai: terbit ulang sesudah batal + terima ulang: nota C membawa riwayat bercampur (salinan +90.000, -90.000, kwitansi 45.000): ditolak PINDAHAN_RIWAYAT/KWITANSI, tidak ada pembalikan apa pun (uang 45.000 tidak dibalik oleh salinan 90.000 yang sudah netto 0)',
              (has(e3, 'PINDAHAN_RIWAYAT') or has(e3, 'PINDAHAN_KWITANSI')) and bk.money_state(h) == st and sum(D(p['amount']) for p in pc3) == 45000, dict(err=(e3 or '')[:240]))
    else:
        check('rantai: terbit ulang sesudah batal + terima ulang (fixture)', False, dict(e0=(e0 or '')[:100], e1=(e1 or '')[:100], e2=(e2 or '')[:100]))


def sec_guards(h):
    F = reissued(h, 'QRIS', one=True); B = F['inv']; st = bk.money_state(h)
    for reason in ('', '  ', 'ab', 'x' * 501):
        err, _ = cancel(h, B, f"g-reason-{len(reason)}-{F['n']}", OWNER, reason)
        check(f'guard: alasan {len(reason)} huruf ditolak (wajib 3-500), tidak ada yang berubah', has(err, 'RECEIPT_INVALID', 'alasan') and bk.money_state(h) == st, dict(err=(err or '')[:160]))
    err, _ = cancel(h, B, '')
    check('guard: kunci kosong ditolak', has(err, 'RECEIPT_INVALID'), dict(err=(err or '')[:120]))
    G = reissued(h, 'QRIS', one=True); cancel(h, G['inv'], f"g-k-{G['n']}"); st = bk.money_state(h)
    err, _ = cancel(h, B, f"g-k-{G['n']}")
    check('guard: kunci yang sama untuk nota lain: IDEMPOTENCY_CONFLICT', has(err, 'IDEMPOTENCY_CONFLICT') and bk.money_state(h) == st, dict(err=(err or '')[:160]))
    err, _ = cancel(h, G['inv'], f"g-k-{G['n']}", OWNER, 'Alasan lain yang berbeda')
    check('guard: kunci sama dengan alasan berbeda: IDEMPOTENCY_CONFLICT', has(err, 'IDEMPOTENCY_CONFLICT'), dict(err=(err or '')[:160]))
    err, _ = cancel(h, F['old'], f"g-old-{F['n']}")
    check('guard: nota lama yang di-void ditolak TAGIHAN_BATAL (uangnya hanya bisa dibalik lewat nota pengganti)', has(err, 'TAGIHAN_BATAL') and bk.money_state(h) == st, dict(err=(err or '')[:160]))
    # nota biasa yang kebetulan correction_pending (bukan hasil terbit ulang) tetap ditolak
    N = bk.rj(h, nxt(), 'QRIS'); h.sistem(f"update public.invoices set correction_pending=true where id={q(N['inv'])};"); st2 = bk.money_state(h)
    err, _ = cancel(h, N['inv'], f"g-np-{N['n']}")
    check('guard: nota yang correction_pending TANPA reissued_from tetap ditolak KOREKSI_BERJALAN (kelonggaran hanya untuk hasil terbit ulang)', has(err, 'KOREKSI_BERJALAN') and bk.money_state(h) == st2, dict(err=(err or '')[:160]))
    # refund pada nota ASAL
    R = reissued(h, 'QRIS', one=True); st = bk.money_state(h)
    h.sistem(f"set session_replication_role=replica; insert into public.clinic_refund_requests(invoice_id,branch_id,requested_by,request_key,payload,quoted_total,status) values ({q(R['old'])},{q(r.BRANCH)},{q(OWNER)},{q('rf-' + str(R['n']))},'{{}}'::jsonb,1000,'pending'); set session_replication_role=origin;")
    err, _ = cancel(h, R['inv'], f"g-rf-{R['n']}")
    check('guard: nota ASAL punya permintaan refund aktif: ditolak SUDAH_REFUND_ASAL dengan nomor nota asal, tidak ada efek', has(err, 'SUDAH_REFUND_ASAL', R['oldno']) and bk.money_state(h) == st, dict(err=(err or '')[:240]))
    R2 = reissued(h, 'QRIS', one=True); st = bk.money_state(h)
    h.sistem(f"set session_replication_role=replica; insert into public.clinic_refund_requests(invoice_id,branch_id,requested_by,request_key,payload,quoted_total,status) values ({q(R2['old'])},{q(r.BRANCH)},{q(OWNER)},{q('rf2-' + str(R2['n']))},'{{}}'::jsonb,1000,'batal'); set session_replication_role=origin;")
    err, _ = cancel(h, R2['inv'], f"g-rf2-{R2['n']}")
    check('guard: permintaan refund nota asal yang sudah BATAL tidak menghalangi (hanya pending/diproses/refund jadi)', err is None, dict(err=(err or '')[:200]))
    # refund selesai pada nota asal (clinic_refunds) -> ditolak
    R3 = reissued(h, 'QRIS', one=True); st = bk.money_state(h)
    exp = h.nilai("select id from public.journal_entries limit 1")
    h.sistem(f"set session_replication_role=replica; insert into public.clinic_refunds(no_refund,invoice_id,visit_id,branch_id,tanggal,total,method,cash_account_id,account_snapshot,expense_id,request_id,created_by) select 'RF-FIK-{R3['n']}',{q(R3['old'])},{q(R3['v'])},{q(r.BRANCH)},current_date,1000,'Transfer',(select id from public.cash_accounts limit 1),'{{}}'::jsonb,{q(exp)},{q(exp)},{q(OWNER)}; set session_replication_role=origin;")
    err, _ = cancel(h, R3['inv'], f"g-rf3-{R3['n']}")
    check('guard: nota asal yang sudah direfund (clinic_refunds): ditolak SUDAH_REFUND_ASAL', has(err, 'SUDAH_REFUND_ASAL') and bk.money_state(h) == st, dict(err=(err or '')[:200]))
    # rekening jurnal tidak cocok dengan baris pindahan
    S = reissued(h, 'QRIS', one=True)
    h.sistem(f"set session_replication_role=replica; update public.invoice_payments set kas_code='110003' where invoice_id={q(S['inv'])}; set session_replication_role=origin;"); st = bk.money_state(h)
    err, _ = cancel(h, S['inv'], f"g-rek-{S['n']}")
    check('guard: rekening baris pindahan tidak cocok dengan saldo jurnal rantai: ditolak REKENING_PINDAHAN, tidak menebak, tidak ada efek', has(err, 'REKENING_PINDAHAN') and bk.money_state(h) == st, dict(err=(err or '')[:240]))
    # jurnal rantai dikoreksi (saldo bank di jurnal tidak sama dengan baris)
    S2 = reissued(h, 'QRIS', one=True); st = bk.money_state(h)
    h.sistem(f"select public.clinic_write_journal((now() at time zone 'Asia/Jakarta')::date,'Penyesuaian fiktif','klinik-edit',{q(S2['oldno'])},{q(r.BRANCH)}::uuid,{j([dict(code='120002', debit=0, credit=1000), dict(code='150001', debit=1000, credit=0)])});")
    err, _ = cancel(h, S2['inv'], f"g-rek2-{S2['n']}")
    check('guard: jurnal rantai bergeser 1.000 dari baris pembayaran: ditolak REKENING_PINDAHAN (fail-closed)', has(err, 'REKENING_PINDAHAN'), dict(err=(err or '')[:200]))
    # kwitansi / uang muka / riwayat / koreksi metode yang dipindah
    RK = bk.ranap(h, nxt(), 'cash')   # menyediakan satu kwitansi nyata
    for code, upd, label in (('PINDAHAN_KWITANSI', f"receipt_id={q(RK['receipt'])}", 'baris pindahan berkwitansi'),
                             ('PINDAHAN_UANG_MUKA', "metode='Uang Muka'", 'baris pindahan pemakaian uang muka')):
        Z = reissued(h, 'QRIS', one=True)
        h.sistem(f"set session_replication_role=replica; update public.invoice_payments set {upd} where invoice_id={q(Z['inv'])}; set session_replication_role=origin;"); st = bk.money_state(h)
        err, _ = cancel(h, Z['inv'], f"g-{code}-{Z['n']}")
        check(f'guard: {label}: ditolak {code} dengan kalimat jelas, tidak ada efek', has(err, code) and bk.money_state(h) == st, dict(err=(err or '')[:200]))
    Z = reissued(h, 'QRIS', one=True)
    h.sistem(f"set session_replication_role=replica; insert into public.invoice_payments(invoice_id,tanggal,amount,metode,kas_code,transferred_from,reversal_of) select invoice_id,tanggal,-1000,metode,kas_code,transferred_from,id from public.invoice_payments where invoice_id={q(Z['inv'])}; set session_replication_role=origin;"); st = bk.money_state(h)
    err, _ = cancel(h, Z['inv'], f"g-rw-{Z['n']}")
    check('guard: riwayat pindahan memuat baris minus/reversal_of (netto tak pasti): ditolak PINDAHAN_RIWAYAT, tidak ada efek', has(err, 'PINDAHAN_RIWAYAT') and bk.money_state(h) == st, dict(err=(err or '')[:200]))
    Z = reissued(h, 'QRIS', one=True); st = bk.money_state(h)
    h.sistem(f"set session_replication_role=replica; insert into public.clinic_payment_corrections(invoice_id,branch_id,revision,amount,from_method,to_method,from_code,to_code,reason,before_snapshot,after_snapshot,journal_id,created_by) values ({q(Z['old'])},{q(r.BRANCH)},1,1000,'Tunai','Transfer','110003','120002','fiktif','{{}}','{{}}',{q(exp)},{q(OWNER)}); set session_replication_role=origin;")
    err, _ = cancel(h, Z['inv'], f"g-kor-{Z['n']}")
    check('guard: metode bayar nota asal pernah dikoreksi: ditolak PINDAHAN_DIKOREKSI, tidak ada efek', has(err, 'PINDAHAN_DIKOREKSI') and bk.money_state(h) == st, dict(err=(err or '')[:200]))
    # salinan riwayat netto 0 tanpa tautan pembalik (mis. terbit ulang berlapis): tidak boleh dibalik lagi
    Zr = reissued(h, 'QRIS', one=True); er0, _ = cancel(h, Zr['inv'], f"g-z0-{Zr['n']}")
    h.sistem(f"set session_replication_role=replica; update public.invoice_payments set reversal_of=null where invoice_id={q(Zr['inv'])} and amount<0; set session_replication_role=origin;"); st = bk.money_state(h)
    err, _ = cancel(h, Zr['inv'], f"g-z1-{Zr['n']}")
    check('guard: baris pindahan positif tanpa tautan pembalik tetapi uang neto nol: ditolak BELUM_ADA_PENERIMAAN, TIDAK dibalik lagi (tidak ada baris minus, jurnal, atau audit baru)', er0 is None and has(err, 'BELUM_ADA_PENERIMAAN') and bk.money_state(h) == st, dict(err=(err or '')[:200]))
    # periode terkunci
    P = reissued(h, 'QRIS', one=True); st = bk.money_state(h)
    h.sistem("update public.accounting_locks set closed_until=(now() at time zone 'Asia/Jakarta')::date where id;")
    try: err, _ = cancel(h, P['inv'], f"g-per-{P['n']}")
    finally: h.sistem("update public.accounting_locks set closed_until=null where id;")
    check('guard: periode akuntansi terkunci: ditolak UTUH PERIODE_TERKUNCI, tidak ada setengah efek (baris, jurnal, audit sama)', has(err, 'PERIODE_TERKUNCI') and bk.money_state(h) == st, dict(err=(err or '')[:200]))
    # tanggal mundur: sebelum tanggal baris pindahan ditolak (batas bawah)
    Q = reissued(h, 'QRIS', one=True); st = bk.money_state(h)
    try: err = h.gagal(f"select public.{RPC}({q(Q['inv'])},'g-mundur-{Q['n']}','Alasan cukup panjang',(current_date - 400)::date);", OWNER)
    except Exception as e: err = str(e)
    check('guard: tanggal mundur sebelum tanggal penerimaan (baris pindahan) ditolak, tidak ada efek', bool(err) and ('TANGGAL' in err or 'PERIODE' in err) and bk.money_state(h) == st, dict(err=(err or '')[:200]))
    # atomik: akun bank nonaktif -> semua kembali
    Y = reissued(h, 'QRIS', one=True); st = bk.money_state(h)
    h.sistem("update public.coa_accounts set is_active=false where code='120002';")
    try: err, _ = cancel(h, Y['inv'], f"g-atom-{Y['n']}")
    finally: h.sistem("update public.coa_accounts set is_active=true where code='120002';")
    check('guard: atomik: rekening bank nonaktif menggagalkan jurnal di tengah proses -> baris pembalik, jurnal, audit TIDAK ada (semua kembali)', bool(err) and bk.money_state(h) == st and h.status_bayar(Y['inv']) == 'Lunas', dict(err=(err or '')[:200]))
    # pasca-syarat Lunas
    W = reissued(h, 'QRIS', one=True); st = bk.money_state(h)
    h.sistem("create or replace function public.zz_force_lunas() returns trigger language plpgsql as $f$ begin new.paid_status := 'Lunas'; return new; end $f$;"
             "create trigger zz_force_lunas before update on public.invoices for each row execute function public.zz_force_lunas();")
    try: err, _ = cancel(h, W['inv'], f"g-lunas-{W['n']}")
    finally: h.sistem("drop trigger if exists zz_force_lunas on public.invoices; drop function if exists public.zz_force_lunas();")
    check('guard: pasca-syarat: nota tetap Lunas setelah pembalikan -> MASIH_LUNAS dan semua efek dibatalkan', has(err, 'MASIH_LUNAS') and bk.money_state(h) == st, dict(err=(err or '')[:200]))
    # tanpa uang: terbit ulang nota Belum Lunas tidak boleh dibatalkan (tidak ada penerimaan)
    U = bk.rj(h, nxt(), 'Tunai', status='Belum Lunas', dp=0)
    err, _ = cancel(h, U['inv'], f"g-nu-{U['n']}")
    check('guard: nota tanpa uang ditolak BELUM_ADA_PENERIMAAN', has(err, 'BELUM_ADA_PENERIMAAN'), dict(err=(err or '')[:200]))
    check('guard: neraca saldo seluruh basis data tetap 0 sesudah semua uji', tb(h) == 0, dict(tb=str(tb(h))))


def sec_roles(h):
    F = reissued(h, 'QRIS', one=True); G = reissued(h, 'QRIS', one=True); I = reissued(h, 'QRIS', one=True); st = bk.money_state(h)
    for role, user in (('ADMIN', ADMIN), ('FINANCE', FINANCE), ('STAFF', STAFF)):
        err, _ = cancel(h, F['inv'], f"r-{role}-{F['n']}", user)
        e2, _ = bk.preview(h, F['inv'], user)
        check(f'peran {role} tanpa izin: eksekusi dan pratinjau pada nota hasil terbit ulang ditolak ACCESS_DENIED, tidak ada efek', has(err, 'ACCESS_DENIED') and has(e2, 'ACCESS_DENIED') and bk.money_state(h) == st, dict(err=(err or '')[:160]))
    try:
        h.sql(f"insert into role_settings_private.action_policies(role,allowed) values ('ADMIN', array[{q(bk.GRANT_ACTION)}]) on conflict (role) do update set allowed=excluded.allowed;")
        err, res = cancel(h, F['inv'], f"r-ok-{F['n']}", ADMIN)
        check('peran ADMIN dengan izin tertulis eksplisit (aturan lama tidak berubah): boleh; jejak mencatat peran ADMIN', err is None and h.nilai(f"select actor_role from public.clinic_receipt_cancellations where invoice_id={q(F['inv'])}") == 'ADMIN', dict(err=(err or '')[:200]))
        err, _ = cancel(h, G['inv'], f"r-fin-{G['n']}", FINANCE)
        check('peran FINANCE tanpa baris kebijakan (bawaan lama) TETAP ditolak: izin bawaan mati', has(err, 'ACCESS_DENIED'), dict(err=(err or '')[:160]))
    finally:
        h.sql("delete from role_settings_private.action_policies where role='ADMIN';")
    err, _ = cancel(h, G['inv'], f"r-luar-{G['n']}", r.FIN_LUAR)
    check('akun cabang lain ditolak (cabang/izin), nota tetap Lunas', has(err, 'ACCESS_DENIED') and h.status_bayar(G['inv']) == 'Lunas', dict(err=(err or '')[:160]))
    try:
        h.sql(f"insert into role_settings_private.action_policies(role,allowed) values ('FINANCE', array[{q(bk.GRANT_ACTION)}]);")
        err, _ = cancel(h, G['inv'], f"r-luar2-{G['n']}", r.FIN_LUAR)
        check('akun FINANCE cabang lain MESKI punya izin tertulis: ditolak karena cabang (RLS/scope cabang), tidak ada efek', has(err, 'ACCESS_DENIED', 'cabang') and h.status_bayar(G['inv']) == 'Lunas', dict(err=(err or '')[:160]))
    finally:
        h.sql("delete from role_settings_private.action_policies where role='FINANCE';")
    h.sistem(f"update public.profiles set is_active=false where id={q(OWNER)};")
    try: err, _ = cancel(h, I['inv'], f"r-off-{I['n']}", OWNER)
    finally: h.sistem(f"update public.profiles set is_active=true where id={q(OWNER)};")
    check('Owner NONAKTIF ditolak', has(err, 'ACCESS_DENIED'), dict(err=(err or '')[:160]))
    ok_owner = h.nilai("select public.clinic_cancel_receipt_allowed();", OWNER); ok_staff = h.nilai("select public.clinic_cancel_receipt_allowed();", STAFF)
    check('clinic_cancel_receipt_allowed (tombol di layar): Owner true, STAFF false (tidak berubah)', ok_owner == 't' and ok_staff == 'f', dict(o=ok_owner, s=ok_staff))
    out = h.gagal(f"begin; alter table role_settings_private.action_policies rename to action_policies_x; set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub',{q(OWNER)},false); select public.{RPC}({q(I['inv'])},'r-failopen-{I['n']}','Alasan cukup panjang'); rollback;")
    check('kebijakan tidak terbaca: Owner tetap BOLEH membatalkan penerimaan hasil terbit ulang (tidak pernah terkunci)', out is None, dict(err=(out or '')[:200]))


def blocked(obs, sess): return bk.blocked(obs, sess)


def sec_race(h, db):
    def session(name, user):
        s = c.Session(db, name); s.sql(x.claims(user)); return s
    cs = lambda inv, key, reason='Alasan balapan yang cukup': f"select public.{RPC}({q(inv)},{q(key)},{q(reason)});"
    F = reissued(h, 'QRIS', one=True)
    with c.Session(db, 'obs') as obs, session('a', OWNER) as a, session('b', OWNER) as b:
        a.sql('begin;' + cs(F['inv'], 'race-1-' + str(F['n']))); b.send(cs(F['inv'], 'race-2-' + str(F['n'])))
        wait = blocked(obs, b); a.sql('commit;'); res = c.attempt(b, commit=False)
    check('balapan: dua pembatalan KUNCI BEDA pada nota hasil terbit ulang yang sama: yang kedua MENUNGGU (advisory) lalu ditolak BELUM_ADA_PENERIMAAN; tepat satu efek, satu baris audit, bank 0 (bukan -90.000)',
          wait.endswith('advisory') and not res['ok'] and 'BELUM_ADA_PENERIMAAN' in res.get('error', '') and audit(h, F['inv']) == 1 and cnet(h, F['nos'])['120002'] == 0 and tb(h) == 0
          and h.angka(f"select count(*) from public.invoice_payments where invoice_id={q(F['inv'])} and amount<0") == 1, dict(wait=wait, res=str(res)[:200]))
    G = reissued(h, 'QRIS', one=True)
    with c.Session(db, 'obs2') as obs, session('c', OWNER) as a, session('d', OWNER) as b:
        a.sql('begin;' + cs(G['inv'], 'twin-' + str(G['n']))); b.send(cs(G['inv'], 'twin-' + str(G['n'])))
        wait2 = blocked(obs, b); a.sql('commit;'); res2 = c.attempt(b, commit=False)
    check('balapan: dua permintaan IDENTIK serentak: yang kedua menunggu lalu mengembalikan hasil tersimpan; satu efek', wait2.endswith('advisory') and res2['ok'] and audit(h, G['inv']) == 1 and cnet(h, G['nos'])['120002'] == 0, dict(wait=wait2, res=str(res2)[:200]))
    # pembatalan vs terbit ulang lagi (koordinator tagihan): terbit ulang menunggu; sesudahnya nota C membawa salinan neto-nol, tidak ada pembalikan ganda
    H = reissued(h, 'QRIS', one=True)
    with c.Session(db, 'obs3') as obs, session('e', OWNER) as a, session('f', OWNER) as b:
        a.sql('begin;' + cs(H['inv'], 'race-ru-' + str(H['n']))); b.send(r.terbit_ulang_sql(H['inv'], f"k{H['n']}-ru9", 'balapan terbit ulang'))
        wait3 = blocked(obs, b); a.sql('commit;'); res3 = c.attempt(b, commit=False)
    check('balapan: terbit ulang berbarengan dengan batalkan penerimaan: terbit ulang MENUNGGU koordinator tagihan (advisory); sesudahnya neraca 0 dan bank bersih 0 (tidak ada uang ganda/hilang)',
          wait3.endswith('advisory') and tb(h) == 0 and cnet(h, H['nos'] + [x_ for x_ in [h.nilai(f"select invoice_no from public.invoices where reissued_from={q(H['inv'])}")] if x_])['120002'] == 0, dict(wait=wait3, res=str(res3)[:200]))
    # tutup shift berbarengan
    K = reissued(h, 'Tunai', user=FINANCE)
    with c.Session(db, 'obs4') as obs, session('g', OWNER) as a, session('h', OWNER) as b:
        a.sql('begin;' + cs(K['inv'], 'race-shift-' + str(K['n']))); b.send(f"update public.cashier_shifts set status='closed', closed_at=now() where id={q(r.SHIFT[FINANCE])} and status='open';")
        wait4 = blocked(obs, b); a.sql('commit;')
        try: c.attempt(b, commit=False)
        except Exception: pass
    bk.set_shift(h, FINANCE, 'open')
    check('balapan: tutup shift asal berbarengan MENUNGGU pembatalan (baris shift asal terkunci FOR UPDATE)', wait4.startswith('Lock/'), dict(wait=wait4))
    # urutan kunci konsisten: pembatalan memegang kunci kunjungan -> pembayaran biasa pada kunjungan yang sama menunggu, tanpa deadlock
    L = reissued(h, 'QRIS', one=True)
    with c.Session(db, 'obs5') as obs, session('i', OWNER) as a, session('j', OWNER) as b:
        a.sql('begin;' + cs(L['inv'], 'race-lock-' + str(L['n']))); b.send(r.koreksi_sql(h, L['inv'], f"e-{L['n']}", lines90(L['n'], 50), paid_status='Belum Lunas'))
        wait5 = blocked(obs, b); a.sql('commit;'); res5 = c.attempt(b, commit=False)
    check('balapan: koreksi nota berbarengan: MENUNGGU pembatalan lalu berjalan sesudah nota Belum Lunas (tanpa deadlock); total akhir 45.000', wait5.endswith('advisory') and res5['ok'] and D(bk.inv_row(h, L['inv'])['total']) == 45000 and tb(h) == 0, dict(wait=wait5, res=str(res5)[:200]))


def digest(h, names_only=False):
    return json.loads(h.nilai("select coalesce(jsonb_object_agg(k, v),'{}') from (select p.oid::regprocedure::text k, md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.prosecdef::text||coalesce(p.proconfig::text,'')||p.proowner::text) v "
                              "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private','role_settings_private') and p.prokind='f') s"))


def sec_static(h, base_digest=None):
    cur = digest(h)
    if base_digest is not None:
        changed = {k for k in cur if k in base_digest and cur[k] != base_digest[k]}; added = set(cur) - set(base_digest); removed = set(base_digest) - set(cur)
        nm = lambda s: {k.replace('public.', '').split('(')[0].split('.')[-1] for k in s}
        check('statik: PERSIS tiga fungsi berubah (scan, pratinjau, eksekutor) dan satu fungsi baru (transfer_check); fungsi lain byte-identik termasuk ACL/owner/config; tidak ada yang hilang',
              nm(changed) == PATCHED and nm(added) == NEW_FUNCS and not removed and len(changed) == 3, dict(changed=sorted(changed), added=sorted(added), removed=sorted(removed)))
    text = (MIG / CANDIDATE).read_text() if (MIG / CANDIDATE).exists() else ''; low = text.lower()
    check('statik: migrasi tanpa begin/commit sendiri, tanpa DDL tabel/kolom/index/trigger, tanpa menyentuh data (insert/update/delete di luar tambalan fungsi)',
          text != '' and not any(l.strip().lower() in ('begin;', 'commit;') for l in text.splitlines()) and 'create table public' not in low and 'alter table' not in low and 'create index' not in low and 'create trigger' not in low and 'drop ' not in low.replace('drop function', '') .replace('on commit drop', ''), {})
    meta = json.loads(h.nilai("select coalesce(jsonb_agg(jsonb_build_object('f',p.proname,'sec',p.prosecdef,'cfg',p.proconfig,'anon',has_function_privilege('anon',p.oid,'execute'),'auth',has_function_privilege('authenticated',p.oid,'execute'),'svc',has_function_privilege('service_role',p.oid,'execute'),'pub',has_function_privilege('public',p.oid,'execute'),'own',pg_get_userbyid(p.proowner)) order by p.proname),'[]') "
                              "from pg_proc p where p.proname in ('clinic_cancel_invoice_receipt','clinic_cancel_invoice_receipt_preview','cancel_receipt_scan','cancel_receipt_transfer_check')"))
    pub = [f for f in meta if f['f'].startswith('clinic_cancel')]; priv = [f for f in meta if not f['f'].startswith('clinic_cancel')]
    check('ACL: RPC publik hanya authenticated (anon/PUBLIC/service_role tidak), SECURITY DEFINER, search_path kosong, lock_timeout 8s (tidak berubah); fungsi privat (scan, transfer_check) tanpa hak app dan bukan definer',
          len(pub) == 2 and all(f['sec'] and f['auth'] and not f['anon'] and not f['svc'] and not f['pub'] and 'search_path=""' in ' '.join(f['cfg'] or []) and 'lock_timeout=8s' in ' '.join(f['cfg'] or []) for f in pub if f['f'] == 'clinic_cancel_invoice_receipt')
          and all(f['sec'] and f['auth'] and not f['anon'] and not f['svc'] and not f['pub'] and 'search_path=""' in ' '.join(f['cfg'] or []) for f in pub)
          and len(priv) == 2 and all(not f['auth'] and not f['anon'] and not f['svc'] and not f['pub'] and not f['sec'] and 'search_path=""' in ' '.join(f['cfg'] or []) for f in priv), dict(meta=meta))
    e1 = h.gagal("select clinic_private.cancel_receipt_transfer_check(id) from public.invoices limit 1;", STAFF)
    check('fungsi pemeriksa baru tidak bisa dipanggil akun aplikasi langsung (permission denied)', bool(e1) and ('permission denied' in e1.lower() or 'schema' in e1.lower()), dict(err=(e1 or '')[:160]))
    check('fungsi lama TIDAK tersentuh: void_payment_receipt, release_advance_application, void_reissue_core, edit_core hanya ada dan sama dengan baseline',
          base_digest is None or all(cur.get(k) == base_digest.get(k) for k in base_digest if any(t in k for t in ('clinic_void_payment_receipt', 'clinic_release_advance_application', 'clinic_void_reissue_invoice', 'clinic_edit_invoice', 'clinic_receive_visit_payment', 'sync_paid_status'))), {})
    check('jejak audit lama utuh: tabel clinic_receipt_cancellations tetap tambah-saja (update/delete/truncate ditolak AUDIT_IMMUTABLE)',
          all(has(h.gagal(s), 'AUDIT_IMMUTABLE') for s in ("update public.clinic_receipt_cancellations set reason='diubah';", "delete from public.clinic_receipt_cancellations;", "truncate public.clinic_receipt_cancellations;")), {})


SECTIONS = ['kovu', 'kovu2', 'tunai', 'dp', 'split', 'poin', 'chain', 'guards', 'roles', 'race', 'static']


def run(h, db, setup=True, baseline=False, sections=None, base_digest=None):
    if setup: x.setup(h)
    want = [s for s in SECTIONS if (sections is None or s in sections)]
    fns = dict(kovu=sec_kovu, kovu2=sec_kovu2, tunai=sec_tunai, dp=sec_dp, split=sec_split, poin=sec_poin, chain=sec_chain, guards=sec_guards, roles=sec_roles)
    for s in want:
        print('=== section', s, flush=True)
        try:
            if s == 'race': sec_race(h, db)
            elif s == 'static': sec_static(h, base_digest)
            else: fns[s](h)
        except Exception as e:
            check(f'SECTION {s} aborted', False, str(e).strip()[:500])


def apply_candidate(db, text): db.sql('begin;\n' + text + '\ncommit;')
def build_chain(db, exclude): okr.build(db, exclude)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin'); ap.add_argument('--attach')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--sections'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--only'); a = ap.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    global OFF
    SEC = set(a.sections.split(',')) if a.sections else None
    extra = {}
    try:
        if a.attach:
            with okr.Attached(r.BIN, a.attach) as db:
                os.environ['PGDATABASE'] = 'postgres'; base = digest(x.Harness(db))
                name = 'bpr_dev_%d' % int(time.time()); db.sql(f'create database {name} template postgres;'); os.environ['PGDATABASE'] = name
                if not a.baseline: apply_candidate(db, (MIG / CANDIDATE).read_text())
                run(x.Harness(db), db, setup=False, baseline=a.baseline, sections=SEC, base_digest=base)
        elif a.mutations:
            from importlib.machinery import SourceFileLoader
            mut = SourceFileLoader('mut', str(ROOT / 'scripts/test-batal-penerimaan-terbit-ulang-mutants.py')).load_module()
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
                    db.sql(f'create database v{i} template postgres'); os.environ['PGDATABASE'] = f'v{i}'; OFF = 100 * i
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
                build_chain(db, {CANDIDATE}); h = x.Harness(db); x.setup(h)
                os.environ.pop('PGDATABASE', None); base = digest(h)
                db.sql('create database cand template postgres'); os.environ['PGDATABASE'] = 'cand'
                if not a.baseline: apply_candidate(db, (MIG / CANDIDATE).read_text())
                run(h, db, setup=False, baseline=a.baseline, sections=SEC, base_digest=base)
    except Exception as e: check('HARNESS', False, str(e)[:800])
    totals = {s: sum(cc['status'] == s for cc in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='mutations' if a.mutations else 'RED' if a.baseline else 'GREEN', cases=RESULTS, totals=totals, **extra), indent=2, default=str)); print(totals)
    return 0 if a.baseline else int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
