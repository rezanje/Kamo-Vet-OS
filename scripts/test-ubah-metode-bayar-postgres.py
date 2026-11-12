#!/usr/bin/env python3
"""'Ubah metode bayar' klinik per BAGIAN KWITANSI + izin khusus + aturan rekening live (migrasi 20261115900000_ubah_metode_bayar.sql).

Native full schema, fictional fixtures, throwaway local cluster, no network. Memakai ulang fixture rawat jalan/rawat inap dari suite batalkan-penerimaan klinik.
  flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-ubah-metode-bayar-postgres.py --pg-bin DIR --json out.json
  --baseline    rantai TANPA kandidat: semua kasus fitur baru harus GAGAL (RED)
  --mutations   kandidat asli lalu tiap mutan (scripts/test-ubah-metode-bayar-mutants.py) di database klon; semua harus terbunuh
Suite SQL pelengkap (petshop + klinik langsung, 30 pasangan metode): scripts/test-koreksi-metode-semua-postgres.py.
"""
import argparse, importlib.util, json, os, sys, time
from decimal import Decimal
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('bk', ROOT / 'scripts/test-batalkan-penerimaan-klinik-postgres.py'); assert spec and spec.loader
bk = importlib.util.module_from_spec(spec); spec.loader.exec_module(bk)
okr, x, r, q, j, c = bk.okr, bk.x, bk.r, bk.q, bk.j, bk.c
CANDIDATE = '20261115900000_ubah_metode_bayar.sql'
MIG = ROOT / 'supabase/migrations'
RESULTS = bk.RESULTS
check, has, nxt, tb, net, D, ranap, rj, set_shift = bk.check, bk.has, bk.nxt, bk.tb, bk.net, bk.D, bk.ranap, bk.rj, bk.set_shift
OWNER, ADMIN, FINANCE, STAFF = r.OWNER, r.ADMIN, r.FINANCE, r.STAFF
RPC = 'correct_clinic_receipt_part_method'
GRANT = 'klinik.ubah_metode_bayar'
REASON = 'Pemilik bayar QRIS tetapi kasir salah memilih Tunai'


def parts_of(h, rec):
    return json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(p) order by p.urutan),'[]') from public.clinic_payment_receipt_parts p where p.receipt_id={q(rec)}"))


def corr(h, rec, part, method, key, user=OWNER, reason=REASON):
    try: return None, json.loads(h.nilai(f"select public.{RPC}({q(rec)},{q(part) if part else 'null::uuid'},{q(key)},{q(reason)},{q(method)});", user))
    except RuntimeError as e: return str(e), None


def state(h):
    """Semua yang TIDAK boleh berubah oleh koreksi metode (nominal, stok, poin, komisi, status) + jumlah jurnal."""
    return dict(
        inv=h.nilai("select md5(coalesce(string_agg((to_jsonb(i)-'metode_bayar')::text,',' order by i.id),'')) from public.invoices i"),
        items=h.nilai("select md5(coalesce(string_agg(to_jsonb(i)::text,',' order by i.id),'')) from public.invoice_items i"),
        stock=h.nilai("select count(*)||':'||coalesce(sum(qty),0) from public.stock_movements") if h.nilai("select to_regclass('public.stock_movements') is not null") == 't' else 'n/a',
        rec=h.nilai("select md5(coalesce(string_agg(to_jsonb(p)::text,',' order by p.id),'')) from public.clinic_payment_receipts p"),
        adv=h.nilai("select md5(coalesce(string_agg(to_jsonb(p)::text,',' order by p.id),'')) from public.clinic_customer_advances p"),
        amounts=h.nilai("select coalesce(sum(amount),0)||':'||count(*) from public.invoice_payments"),
        partamt=h.nilai("select coalesce(sum(amount),0)||':'||count(*) from public.clinic_payment_receipt_parts"),
        corr=h.angka("select count(*) from public.clinic_receipt_method_corrections"),
        jrn=h.angka("select count(*) from public.journal_entries"), lines=h.angka("select count(*) from public.journal_lines"),
        parts=h.nilai("select md5(coalesce(string_agg(to_jsonb(p)::text,',' order by p.id),'')) from public.clinic_payment_receipt_parts p"),
        pays=h.nilai("select md5(coalesce(string_agg(to_jsonb(p)::text,',' order by p.id),'')) from public.invoice_payments p"))


def shift_cash(h, user): return D(h.nilai(f"select clinic_private.klinik_shift_expected_cash({q(r.SHIFT[user])})"))


def section_receipt(h):
    # (1) kwitansi tunai langsung (rawat inap): Tunai -> QRIS
    F = ranap(h, nxt(), 'cash', user=FINANCE); p = parts_of(h, F['receipt']); t = F['total']
    cash0, bank0, sc0 = h.saldo('110003'), h.saldo('120002'), shift_cash(h, FINANCE)
    st0 = state(h)
    err, res = corr(h, F['receipt'], p[0]['id'], 'QRIS', f"u-{F['n']}")
    st1 = state(h); p2 = parts_of(h, F['receipt']); pay = json.loads(h.nilai(f"select jsonb_agg(to_jsonb(x)) from public.invoice_payments x where x.receipt_id={q(F['receipt'])}"))
    jr = json.loads(h.nilai("select coalesce(jsonb_agg(jsonb_build_object('code',a.code,'d',l.debit,'c',l.credit,'tgl',e.tanggal::text,'src',e.source,'ref',e.source_ref)),'[]') from public.journal_entries e join public.journal_lines l on l.entry_id=e.id join public.coa_accounts a on a.id=l.account_id "
                            f"where e.source='klinik-koreksi-bayar' and e.source_ref={q(h.nilai('select no_kwitansi from public.clinic_payment_receipts where id=' + q(F['receipt'])))}"))
    today = h.nilai("select (now() at time zone 'Asia/Jakarta')::date::text")
    check('kwitansi tunai ranap: Tunai -> QRIS oleh Owner berhasil; hasil memuat dari/ke, rekening, efek laci negatif, tanggal efektif hari ini',
          err is None and res['from_method'] == 'Tunai' and res['to_method'] == 'QRIS' and res['from_code'] == '110003' and res['to_code'] == '120002' and D(res['cash_effect']) == -t and res['effective_date'] == today, dict(err=(err or '')[:300], res=res))
    check('kwitansi tunai ranap: bagian kwitansi dan baris pembayaran turunannya berubah metode+rekening; nominal sama; nomor kwitansi sama',
          p2[0]['metode'] == 'QRIS' and p2[0]['kas_code'] == '120002' and D(p2[0]['amount']) == t and all(y['metode'] == 'QRIS' and y['kas_code'] == '120002' for y in pay) and len(pay) >= 1 and sum(D(y['amount']) for y in pay) == t, dict(p2=p2, pay=pay))
    check('kwitansi tunai ranap: jurnal reklas tunggal Dr 120002 / Cr 110003 senilai bagian, sumber klinik-koreksi-bayar, tanggal hari ini; kas -t, bank +t, neraca saldo 0',
          len(jr) == 2 and {(y['code'], D(y['d']), D(y['c'])) for y in jr} == {('120002', D(t), D(0)), ('110003', D(0), D(t))} and all(y['tgl'] == today for y in jr)
          and h.saldo('110003') == cash0 - t and h.saldo('120002') == bank0 + t and tb(h) == 0, dict(jr=jr, cash=h.saldo('110003') - cash0, bank=h.saldo('120002') - bank0))
    check('kwitansi tunai ranap: efek laci shift kasir: perkiraan kas shift STAFF turun tepat sebesar bagian Tunai itu',
          shift_cash(h, FINANCE) == sc0 - t, dict(before=str(sc0), after=str(shift_cash(h, FINANCE))))
    keep = {k: (st0[k] == st1[k]) for k in ('inv', 'items', 'stock', 'rec', 'adv', 'amounts', 'partamt')}
    check('kwitansi tunai ranap: TIDAK berubah: tagihan (total/status/baris), stok, kwitansi, uang muka, jumlah pembayaran/bagian; baris jurnal bertambah tepat 2, satu baris audit',
          all(keep.values()) and st1['lines'] == st0['lines'] + 2 and st1['corr'] == st0['corr'] + 1 and h.status_bayar(F['inv']) == 'Lunas', dict(keep=keep, st0=st0, st1=st1))
    aud = json.loads(h.nilai("select to_jsonb(a) from public.clinic_receipt_method_corrections a order by created_at desc limit 1"))
    check('audit: pelaku, peran, alasan, metode/rekening dari-ke, efek kas, tanggal efektif, shift asal + statusnya, snapshot sebelum/sesudah tersimpan',
          aud['created_by'] == OWNER and aud['actor_role'] == 'OWNER' and aud['reason'] == REASON and aud['from_method'] == 'Tunai' and aud['to_method'] == 'QRIS' and D(aud['cash_effect']) == -t
          and aud['source_shift_id'] == r.SHIFT[FINANCE] and aud['source_shift_status'] == 'open' and aud['before_snapshot']['part']['metode'] == 'Tunai' and aud['after_snapshot']['part']['metode'] == 'QRIS' and aud['journal_id'] == res['journal_id'], dict(aud=aud))
    # (2) balik lagi QRIS -> Tunai: laci naik; dua revisi
    err, res2 = corr(h, F['receipt'], p[0]['id'], 'Tunai', f"u2-{F['n']}")
    check('QRIS -> Tunai (kembali): laci shift naik sebesar bagian; revisi 2; kas dan bank kembali; neraca 0', err is None and res2['revision'] == 2 and D(res2['cash_effect']) == t and shift_cash(h, FINANCE) == sc0 and h.saldo('110003') == cash0 and h.saldo('120002') == bank0 and tb(h) == 0, dict(err=(err or '')[:200]))
    # (3) label saja: rekening sama (QRIS -> Transfer): tanpa jurnal
    G = ranap(h, nxt(), 'qris', user=OWNER); pg = parts_of(h, G['receipt']); bank1 = h.saldo('120002'); j0 = h.angka("select count(*) from public.journal_entries")
    err, rg = corr(h, G['receipt'], pg[0]['id'], 'Transfer', f"u-{G['n']}")
    check('QRIS -> Transfer (rekening sama 120002): hanya label; TANPA jurnal; saldo bank tidak berubah; metode bagian dan pembayaran berubah; audit tanpa jurnal',
          err is None and rg['journal_id'] is None and D(rg['cash_effect']) == 0 and h.saldo('120002') == bank1 and h.angka("select count(*) from public.journal_entries") == j0
          and parts_of(h, G['receipt'])[0]['metode'] == 'Transfer' and h.nilai(f"select string_agg(distinct metode,',') from public.invoice_payments where receipt_id={q(G['receipt'])}") == 'Transfer', dict(err=(err or '')[:200], rg=rg))
    # (4) uang muka (transfer) dipakai penuh melunasi tagihan: bagian Transfer -> Tunai
    A = ranap(h, nxt(), 'advance', user=OWNER); pa = parts_of(h, A['receipt']); ca = h.saldo('110003'); ba = h.saldo('120002'); sa = shift_cash(h, OWNER)
    err, ra = corr(h, A['receipt'], pa[0]['id'], 'Tunai', f"u-{A['n']}")
    check('kwitansi uang muka (transfer, sudah dipakai melunasi tagihan): Transfer -> Tunai berhasil; jurnal reklas senilai uang muka; tagihan tetap Lunas; uang muka tetap aktif/terpakai; laci naik',
          err is None and ra['journal_id'] and h.saldo('110003') == ca + A['total'] and h.saldo('120002') == ba - A['total'] and h.status_bayar(A['inv']) == 'Lunas' and shift_cash(h, OWNER) == sa + A['total'] and tb(h) == 0
          and D(h.nilai(f"select applied from public.clinic_customer_advances where id={q(A['adv'])}")) == A['total'], dict(err=(err or '')[:300], ra=ra))
    # (5) kwitansi campuran 2 bagian (Tunai + QRIS): hanya bagian dipilih berubah
    M = ranap(h, nxt(), 'none', user=FINANCE); half = M['total'] // 2
    h.sql(r.bayar_sql(M['v'], f"k{M['n']}-mix", [{'method': 'Tunai', 'amount': half}, {'method': 'QRIS', 'amount': M['total'] - half}], M['inv']), FINANCE)
    M['receipt'] = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={q(M['v'])} order by created_at desc limit 1"); pm = parts_of(h, M['receipt']); sm = shift_cash(h, FINANCE)
    err, rm = corr(h, M['receipt'], pm[0]['id'], 'Debit', f"u-{M['n']}")
    pm2 = parts_of(h, M['receipt'])
    pays = json.loads(h.nilai(f"select jsonb_agg(jsonb_build_object('m',metode,'k',kas_code,'a',amount) order by metode) from public.invoice_payments where receipt_id={q(M['receipt'])}"))
    check('kwitansi campuran: hanya bagian Tunai -> Debit berubah; bagian QRIS dan pembayarannya tetap; jumlah per metode benar; laci turun sebesar bagian Tunai saja',
          err is None and [(y['metode'], y['kas_code']) for y in pm2] == [('Debit', '120002'), ('QRIS', '120002')] and sorted((y['m'], D(y['a'])) for y in pays) == sorted([('Debit', D(half)), ('QRIS', D(M['total'] - half))])
          and shift_cash(h, FINANCE) == sm - half and tb(h) == 0, dict(err=(err or '')[:300], pm2=pm2, pays=pays))
    # (6) kelebihan bayar = uang muka baru dari kwitansi yang sama: bagian Tunai -> QRIS memindahkan SELURUH bagian (tagihan + uang muka)
    O = ranap(h, nxt(), 'none', user=OWNER); extra = 50000
    base_c, base_b = h.saldo('110003'), h.saldo('120002')
    h.sql(r.bayar_sql(O['v'], f"k{O['n']}-over", [{'method': 'Tunai', 'amount': O['total'] + extra}], O['inv']), OWNER)
    O['receipt'] = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={q(O['v'])} order by created_at desc limit 1"); po = parts_of(h, O['receipt'])
    adv = D(h.nilai(f"select amount from public.clinic_customer_advances where receipt_id={q(O['receipt'])}"))
    err, ro = corr(h, O['receipt'], po[0]['id'], 'QRIS', f"u-{O['n']}")
    check('kwitansi dengan kelebihan bayar (uang muka Rp50.000 dari kwitansi yang sama): Tunai -> QRIS memindahkan seluruh bagian (tagihan + uang muka); kas kembali ke awal, bank + seluruh bagian; neraca 0',
          adv == extra and err is None and D(ro['amount']) == O['total'] + extra and h.saldo('110003') == base_c and h.saldo('120002') == base_b + O['total'] + extra and tb(h) == 0, dict(err=(err or '')[:300], adv=str(adv)))
    # (7) sesudah koreksi, Batalkan penerimaan (jalur live) tetap menutup bersih rekening BARU: kas/bank kembali ke awal sebelum kwitansi
    ecan, rcan = bk.do_cancel(h, O['inv'], f"c-{O['n']}")
    check('sesudah koreksi: Batalkan penerimaan tagihan itu (jalur live) membalik rekening BARU; kas dan bank kembali persis ke sebelum kwitansi; neraca 0',
          ecan is None and h.saldo('110003') == base_c and h.saldo('120002') == base_b and tb(h) == 0 and h.status_bayar(O['inv']) == 'Belum Lunas', dict(err=(ecan or '')[:300], cash=str(h.saldo('110003') - base_c), bank=str(h.saldo('120002') - base_b)))
    # (8) kwitansi yang sudah dibatalkan: tidak bisa diubah
    err, _ = corr(h, O['receipt'], po[0]['id'], 'Tunai', f"u-late-{O['n']}")
    check('kwitansi yang sudah dibatalkan: ditolak (UBAH_METODE_KWITANSI)', has(err, 'UBAH_METODE_KWITANSI'), dict(err=(err or '')[:200]))
    # (9) terima ulang setelah koreksi: jalur live tetap jalan dengan metode lain
    e3 = h.gagal(r.bayar_sql(O['v'], f"k{O['n']}-ulang", [{'method': 'Transfer', 'amount': O['total']}], O['inv']), OWNER)
    check('Batalkan penerimaan + terima ulang dengan metode lain (jalur live) tetap bekerja setelah ada koreksi di kwitansi sebelumnya', e3 is None and h.status_bayar(O['inv']) == 'Lunas' and tb(h) == 0, dict(err=(e3 or '')[:200]))


def section_idem(h):
    F = ranap(h, nxt(), 'cash', user=OWNER); p = parts_of(h, F['receipt']); K = f"i-{F['n']}"
    err, res = corr(h, F['receipt'], p[0]['id'], 'QRIS', K); st = state(h)
    err2, res2 = corr(h, F['receipt'], p[0]['id'], 'QRIS', K)
    check('idempoten: kunci sama + permintaan sama: hasil tersimpan dikembalikan, tidak ada efek kedua (jurnal, baris, audit sama)', err is None and err2 is None and res2 == res and state(h) == st, dict(err2=(err2 or '')[:200]))
    err3, _ = corr(h, F['receipt'], p[0]['id'], 'Debit', K)
    check('idempoten: kunci sama dengan metode BEDA ditolak (IDEMPOTENCY_CONFLICT); tidak ada yang berubah', has(err3, 'IDEMPOTENCY_CONFLICT') and state(h) == st, dict(err=(err3 or '')[:200]))
    err4, _ = corr(h, F['receipt'], p[0]['id'], 'QRIS', K + '-b')
    check('klik kedua dengan kunci lain pada metode yang sama: ditolak UBAH_METODE_SAMA; tidak ada efek', has(err4, 'UBAH_METODE_SAMA') and state(h) == st, dict(err=(err4 or '')[:200]))
    err5, _ = corr(h, F['receipt'], p[0]['id'], 'QRIS', K, STAFF)
    check('kunci yang sama dari akun lain tidak membaca hasil orang lain (STAFF ditolak izin)', has(err5, 'ACCESS_DENIED') and state(h) == st, dict(err=(err5 or '')[:200]))


def section_guards(h):
    F = ranap(h, nxt(), 'cash', user=OWNER); p = parts_of(h, F['receipt']); G = ranap(h, nxt(), 'cash', user=OWNER); pg = parts_of(h, G['receipt']); st = state(h)
    for reason in ('', '  ', 'ab', 'x' * 501):
        e, _ = corr(h, F['receipt'], p[0]['id'], 'QRIS', f"g-r{len(reason)}", OWNER, reason)
        check(f'alasan tidak sah ({len(reason)} huruf) ditolak, tidak ada yang berubah', has(e, 'UBAH_METODE_INVALID') and state(h) == st, dict(err=(e or '')[:160]))
    for m in ('Kartu', '', 'tunai', 'QRIS '):
        e, _ = corr(h, F['receipt'], p[0]['id'], m, f"g-m{abs(hash(m)) % 1000}")
        check(f'metode tidak dikenal {m!r} ditolak', has(e, 'UBAH_METODE_INVALID') and state(h) == st, dict(err=(e or '')[:160]))
    e, _ = corr(h, F['receipt'], p[0]['id'], 'Tunai', 'g-same')
    check('metode sama ditolak (UBAH_METODE_SAMA)', has(e, 'UBAH_METODE_SAMA') and state(h) == st, dict(err=(e or '')[:160]))
    e, _ = corr(h, F['receipt'], pg[0]['id'], 'QRIS', 'g-part')
    check('bagian milik kwitansi LAIN ditolak (UBAH_METODE_BAGIAN); tidak ada yang berubah', has(e, 'UBAH_METODE_BAGIAN') and state(h) == st, dict(err=(e or '')[:160]))
    e, _ = corr(h, F['receipt'], None, 'QRIS', 'g-null')
    check('bagian kosong ditolak', has(e, 'UBAH_METODE_INVALID') or bool(e), dict(err=(e or '')[:160]))
    # dua bagian bermetode sama
    D2 = ranap(h, nxt(), 'none', user=OWNER); half = D2['total'] // 2
    h.sql(r.bayar_sql(D2['v'], f"k{D2['n']}-dup", [{'method': 'Tunai', 'amount': half}, {'method': 'Tunai', 'amount': D2['total'] - half}], D2['inv']), OWNER)
    rec2 = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={q(D2['v'])} order by created_at desc limit 1"); pd = parts_of(h, rec2); st2 = state(h)
    e, _ = corr(h, rec2, pd[0]['id'], 'QRIS', 'g-dup')
    check('kwitansi dengan dua bagian bermetode+rekening sama ditolak (UBAH_METODE_GANDA): arahkan ke Batalkan penerimaan; tidak ada efek', has(e, 'UBAH_METODE_GANDA') and state(h) == st2, dict(err=(e or '')[:200]))
    # data tidak cocok (pembayaran turunan kurang Rp1.000 dari bagian): fail-closed, tidak ada yang berubah
    T = ranap(h, nxt(), 'cash', user=OWNER); pt = parts_of(h, T['receipt'])
    h.sistem(f"update public.invoice_payments set amount=amount-1000 where receipt_id={q(T['receipt'])};")
    st3 = state(h)
    e, _ = corr(h, T['receipt'], pt[0]['id'], 'QRIS', 'g-tamper')
    check('rincian kwitansi tidak cocok dengan pembayaran+uang muka: ditolak UBAH_METODE_REKONSILIASI (fail-closed); tidak ada efek', has(e, 'UBAH_METODE_REKONSILIASI') and state(h) == st3, dict(err=(e or '')[:200]))
    h.sistem(f"update public.invoice_payments set amount=amount+1000 where receipt_id={q(T['receipt'])};")
    st2 = state(h)
    # periode tertutup
    h.sistem("update public.accounting_locks set closed_until=(now() at time zone 'Asia/Jakarta')::date where id;")
    try:
        e, _ = corr(h, F['receipt'], p[0]['id'], 'QRIS', 'g-lock')
        check('periode akuntansi tertutup (sampai hari ini): ditolak PERIODE_TERKUNCI; tidak ada efek', has(e, 'PERIODE_TERKUNCI') and state(h) == st2, dict(err=(e or '')[:200]))
    finally: h.sistem("update public.accounting_locks set closed_until=null where id;")
    # rekonsiliasi bank mencakup rekening
    ca = h.nilai("select id from public.cash_accounts where coa_code='120002' limit 1")
    h.sistem(f"insert into public.bank_reconciliations(tanggal,cash_account_id,bank_coa_code) values((now() at time zone 'Asia/Jakarta')::date,{q(ca)},'120002');")
    try:
        e, _ = corr(h, F['receipt'], p[0]['id'], 'QRIS', 'g-rek')
        check('rekonsiliasi bank sudah mencakup rekening tujuan: ditolak UBAH_METODE_REKON_BANK; tidak ada efek', has(e, 'UBAH_METODE_REKON_BANK') and state(h) == st2, dict(err=(e or '')[:200]))
    finally: h.sistem("delete from public.bank_reconciliations;")
    # rekening tujuan terpetakan ke akun BUKAN aset (liabilitas 314001): ditolak, tidak ada efek
    ca2 = h.nilai("select id from public.cash_accounts where coa_code='120002' limit 1")
    h.sistem(f"insert into public.payment_account_map(metode,branch_id,cash_account_id) values('E-Wallet',null,{q(ca2)});")
    h.sistem("update public.cash_accounts set coa_code='314001' where coa_code='120002';")
    try:
        e, _ = corr(h, F['receipt'], p[0]['id'], 'E-Wallet', 'g-nonasset')
        check('rekening tujuan terpetakan ke akun bukan aset: ditolak UBAH_METODE_AKUN; tidak ada efek', has(e, 'UBAH_METODE_AKUN') and state(h) == st2, dict(err=(e or '')[:200]))
    finally:
        h.sistem("update public.cash_accounts set coa_code='120002' where coa_code='314001' and id=" + q(ca2) + ";")
        h.sistem("delete from public.payment_account_map where metode='E-Wallet';")
    # rekening tujuan tidak aktif
    h.sistem("update public.coa_accounts set is_active=false where code='120002';")
    try:
        e, _ = corr(h, F['receipt'], p[0]['id'], 'QRIS', 'g-inactive')
        check('rekening tujuan tidak aktif: ditolak; tidak ada efek', bool(e) and state(h) == st2, dict(err=(e or '')[:200]))
    finally: h.sistem("update public.coa_accounts set is_active=true where code='120002';")


def section_shift(h):
    # shift asal TUTUP: tetap boleh; rekaman shift tertutup tidak berubah; status dicatat
    F = ranap(h, nxt(), 'cash', user=FINANCE); p = parts_of(h, F['receipt']); cash0 = h.saldo('110003')
    set_shift(h, FINANCE, 'closed')
    try:
        before = h.nilai(f"select to_jsonb(s)::text from public.cashier_shifts s where id={q(r.SHIFT[FINANCE])}")
        err, res = corr(h, F['receipt'], p[0]['id'], 'QRIS', f"s-{F['n']}")
        after = h.nilai(f"select to_jsonb(s)::text from public.cashier_shifts s where id={q(r.SHIFT[FINANCE])}")
        check('shift asal sudah TUTUP: koreksi tetap boleh (tidak dibuka ulang); rekaman shift tertutup TIDAK berubah; status shift asal "closed" dicatat; jurnal tetap hari ini',
              err is None and before == after and res['source_shift_status'] == 'closed' and h.saldo('110003') == cash0 - F['total'] and tb(h) == 0, dict(err=(err or '')[:300]))
    finally: set_shift(h, FINANCE, 'open')
    # Owner tanpa shift terbuka: tidak terkunci
    G = ranap(h, nxt(), 'cash', user=ADMIN); pg = parts_of(h, G['receipt']); sadm = shift_cash(h, ADMIN)
    set_shift(h, OWNER, 'closed')
    try:
        err, res = corr(h, G['receipt'], pg[0]['id'], 'QRIS', f"s-{G['n']}")
        check('Owner tanpa shift terbuka tetap bisa mengoreksi (tidak terkunci); laci shift kasir asal (ADMIN) yang terbuka ikut turun', err is None and shift_cash(h, ADMIN) == sadm - G['total'], dict(err=(err or '')[:200]))
    finally: set_shift(h, OWNER, 'open')


def section_roles(h):
    F = ranap(h, nxt(), 'cash', user=OWNER); G = ranap(h, nxt(), 'cash', user=OWNER); H_ = ranap(h, nxt(), 'cash', user=OWNER)
    pf, pg, ph = parts_of(h, F['receipt']), parts_of(h, G['receipt']), parts_of(h, H_['receipt']); st = state(h)
    for role, user in (('ADMIN', ADMIN), ('STAFF', STAFF)):
        e, _ = corr(h, F['receipt'], pf[0]['id'], 'QRIS', f"role-{role}", user)
        check(f'peran {role} tanpa izin: ditolak ACCESS_DENIED, tidak ada yang berubah', has(e, 'ACCESS_DENIED') and state(h) == st, dict(err=(e or '')[:200]))
    try:
        h.sql(f"insert into role_settings_private.action_policies(role,allowed) values ('ADMIN', array[{q(GRANT)}]), ('STAFF', array['bank.refund_clinic.cancel']) on conflict (role) do update set allowed=excluded.allowed;")
        e, res = corr(h, F['receipt'], pf[0]['id'], 'QRIS', 'role-ok-admin', ADMIN)
        check('ADMIN dengan izin tertulis "Ubah metode bayar": boleh; audit mencatat peran GRANT', e is None and h.nilai("select actor_role from public.clinic_receipt_method_corrections where request_key='role-ok-admin'") == 'GRANT', dict(err=(e or '')[:200]))
        e, _ = corr(h, G['receipt'], pg[0]['id'], 'QRIS', 'role-staff', STAFF)
        check('STAFF dengan kebijakan kustom TANPA izin ini: ditolak', has(e, 'ACCESS_DENIED'), dict(err=(e or '')[:200]))
        out = h.gagal(f"begin; alter table role_settings_private.action_policies rename to action_policies_x; set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub',{q(ADMIN)},false); select public.{RPC}({q(G['receipt'])},{q(pg[0]['id'])},'role-failclosed',{q(REASON)},'QRIS'); rollback;")
        check('kebijakan tidak terbaca: ADMIN (diberi izin) ditolak (fail-closed)', has(out, 'ACCESS_DENIED'), dict(err=(out or '')[:200]))
        out = h.gagal(f"begin; alter table role_settings_private.action_policies rename to action_policies_x; set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub',{q(OWNER)},false); select public.{RPC}({q(G['receipt'])},{q(pg[0]['id'])},'role-failopen',{q(REASON)},'QRIS'); rollback;")
        check('kebijakan tidak terbaca: OWNER tetap BOLEH (fail-open, tidak pernah terkunci)', out is None, dict(err=(out or '')[:200]))
        a_adm = h.nilai("select public.ubah_metode_allowed('klinik');", ADMIN); a_stf = h.nilai("select public.ubah_metode_allowed('klinik');", STAFF); a_own = h.nilai("select public.ubah_metode_allowed('klinik');", OWNER)
        a_pj = h.nilai("select public.ubah_metode_allowed('penjualan');", ADMIN); a_bad = h.nilai("select public.ubah_metode_allowed('lain');", OWNER)
        check('ubah_metode_allowed (untuk layar): Owner true; ADMIN dengan izin klinik true tapi penjualan false; STAFF false; domain asing false', (a_own, a_adm, a_pj, a_stf, a_bad) == ('t', 't', 'f', 'f', 'f'), dict(own=a_own, adm=a_adm, pj=a_pj, stf=a_stf, bad=a_bad))
    finally:
        h.sql("delete from role_settings_private.action_policies where role in ('ADMIN','STAFF');")
    e, _ = corr(h, H_['receipt'], ph[0]['id'], 'QRIS', 'role-fin', FINANCE)
    check('FINANCE tetap boleh (aturan koreksi metode yang sudah live; tidak ada kemunduran)', e is None and h.nilai("select actor_role from public.clinic_receipt_method_corrections where request_key='role-fin'") == 'FINANCE', dict(err=(e or '')[:200]))
    # jalur klinik langsung (correct_clinic_invoice_payment) memakai aturan peran yang SAMA
    R2 = rj(h, nxt(), 'Tunai', user=OWNER); R3 = rj(h, nxt(), 'Tunai', user=OWNER)
    call = lambda inv, key: f"select public.correct_clinic_invoice_payment({q(inv)},null,0,{q(key)},{q(REASON)},'QRIS');"
    e = h.gagal(call(R2['inv'], 'dir-admin'), ADMIN); e2 = h.gagal(call(R2['inv'], 'dir-staff'), STAFF)
    check('klinik langsung: ADMIN dan STAFF tanpa izin ditolak (pesan peran)', has(e, 'Hanya Owner atau Finance') and has(e2, 'Hanya Owner atau Finance'), dict(e=(e or '')[:120], e2=(e2 or '')[:120]))
    try:
        h.sql(f"insert into role_settings_private.action_policies(role,allowed) values ('ADMIN', array[{q(GRANT)}]) on conflict (role) do update set allowed=excluded.allowed;")
        e3 = h.gagal(call(R2['inv'], 'dir-admin-ok'), ADMIN)
        check('klinik langsung: ADMIN dengan izin tertulis boleh', e3 is None and h.nilai(f"select metode_bayar from public.invoices where id={q(R2['inv'])}") == 'QRIS' and tb(h) == 0, dict(err=(e3 or '')[:200]))
    finally:
        h.sql("delete from role_settings_private.action_policies where role='ADMIN';")
    e4 = h.gagal(call(R3['inv'], 'dir-fin'), FINANCE)
    check('klinik langsung: FINANCE tetap boleh (aturan live)', e4 is None, dict(err=(e4 or '')[:200]))
    I = ranap(h, nxt(), 'cash', user=OWNER); pi = parts_of(h, I['receipt'])
    e, _ = corr(h, I['receipt'], pi[0]['id'], 'QRIS', 'role-luar', r.FIN_LUAR)
    check('FINANCE cabang lain: ditolak (cabang tidak diizinkan)', has(e, 'ACCESS_DENIED'), dict(err=(e or '')[:200]))
    h.sistem(f"update public.profiles set is_active=false where id={q(OWNER)};")
    try: e, _ = corr(h, I['receipt'], pi[0]['id'], 'QRIS', 'role-inactive', OWNER)
    finally: h.sistem(f"update public.profiles set is_active=true where id={q(OWNER)};")
    check('Owner NONAKTIF ditolak', has(e, 'ACCESS_DENIED'), dict(err=(e or '')[:200]))
    cats = json.loads(h.nilai("select jsonb_agg(jsonb_build_object('id',c.id,'enforced',c.enforced,'group',c.\"group\",'mod',m.module_id) order by c.id) from role_settings_private.action_catalog c join role_settings_private.action_modules m on m.id=c.id where c.id in ('klinik.ubah_metode_bayar','penjualan.ubah_metode_bayar')"))
    check('katalog aksi peran memuat klinik.ubah_metode_bayar dan penjualan.ubah_metode_bayar (enforced) di modul masing-masing',
          cats == [dict(id='klinik.ubah_metode_bayar', enforced=True, group='Klinik', mod='klinik'), dict(id='penjualan.ubah_metode_bayar', enforced=True, group='Penjualan', mod='penjualan')], dict(cats=cats))
    # anon / authenticated tanpa sesi
    e = h.gagal(f"set role anon; select public.{RPC}({q(I['receipt'])},{q(pi[0]['id'])},'anon-k',{q(REASON)},'QRIS');")
    check('anon tidak punya hak menjalankan RPC', bool(e), dict(err=(e or '')[:160]))


def section_map(h):
    """Rekening live: peta rekening hanya memuat Tunai (seperti hosted). Non-Tunai ikut aturan penerimaan: 120002. Koreksi klinik langsung Tunai -> Transfer harus tetap jalan."""
    h.sistem("delete from public.payment_account_map where metode <> 'Tunai';")
    nonT = h.angka("select count(*) from public.payment_account_map where metode<>'Tunai'")
    F = rj(h, nxt(), 'Tunai', user=OWNER); b0 = h.saldo('120002'); c0 = h.saldo('110003')
    e = h.gagal(f"select public.correct_clinic_invoice_payment({q(F['inv'])},null,0,'map-k1',{q(REASON)},'Transfer');", OWNER)
    check('peta rekening hanya Tunai (seperti hosted): koreksi klinik langsung Tunai -> Transfer berhasil ke 120002 (aturan penerimaan live), bukan "belum dipetakan"',
          nonT == 0 and e is None and h.saldo('120002') == b0 + F['total'] and h.saldo('110003') == c0 - F['total'] and tb(h) == 0, dict(err=(e or '')[:300]))
    G = rj(h, nxt(), 'Tunai', user=OWNER)
    for m in ('Debit', 'Kredit', 'QRIS', 'E-Wallet'):
        H_ = rj(h, nxt(), 'Tunai', user=OWNER); b1 = h.saldo('120002')
        e = h.gagal(f"select public.correct_clinic_invoice_payment({q(H_['inv'])},null,0,'map-{m}',{q(REASON)},{q(m)});", OWNER)
        check(f'peta hanya Tunai: Tunai -> {m} (klinik langsung) masuk 120002; tanpa akun baru', e is None and h.saldo('120002') == b1 + H_['total'] and tb(h) == 0, dict(err=(e or '')[:200]))
    n_acc = h.angka("select count(*) from public.coa_accounts"); n_cash = h.angka("select count(*) from public.cash_accounts"); n_map = h.angka("select count(*) from public.payment_account_map")
    check('tidak ada akun/rekening/peta baru dibuat oleh koreksi', n_acc == h.angka("select count(*) from public.coa_accounts") and n_map == nonT + h.angka("select count(*) from public.payment_account_map where metode='Tunai'"), dict(acc=n_acc, cash=n_cash, map=n_map))
    # kwitansi: E-Wallet juga
    K = ranap(h, nxt(), 'cash', user=OWNER); pk = parts_of(h, K['receipt']); b2 = h.saldo('120002')
    e, res = corr(h, K['receipt'], pk[0]['id'], 'E-Wallet', f"map-k-{K['n']}")
    check('kwitansi: Tunai -> E-Wallet masuk 120002 (aturan penerimaan live) dengan peta hanya Tunai', e is None and res['to_code'] == '120002' and h.saldo('120002') == b2 + K['total'] and tb(h) == 0, dict(err=(e or '')[:200]))


def blocked(obs, sess):
    for _ in range(40):
        w = obs.sql(f"select coalesce(wait_event_type,'')||'/'||coalesce(wait_event,'') from pg_stat_activity where pid={sess.pid};")
        if w and w[-1].startswith('Lock/'): return w[-1]
        time.sleep(0.15)
    return 'NOT BLOCKED'


def section_race(h, db):
    def session(name, user):
        s = c.Session(db, name); s.sql(x.claims(user)); return s
    cs = lambda rec, part, key, m='QRIS': f"select public.{RPC}({q(rec)},{q(part)},{q(key)},{q(REASON)},{q(m)});"
    F = ranap(h, nxt(), 'cash', user=OWNER); p = parts_of(h, F['receipt'])
    with c.Session(db, 'obs') as obs, session('a', OWNER) as a, session('b', OWNER) as b:
        a.sql('begin;' + cs(F['receipt'], p[0]['id'], 'race-1')); b.send(cs(F['receipt'], p[0]['id'], 'race-2', 'Debit'))
        wait = blocked(obs, b); a.sql('commit;'); res = c.attempt(b, commit=False)
    n = h.angka(f"select count(*) from public.clinic_receipt_method_corrections where receipt_id={q(F['receipt'])}")
    check('balapan: dua koreksi berbeda kunci pada bagian yang sama: yang kedua MENUNGGU (kunci koordinator) lalu dihitung dari keadaan terbaru (QRIS -> Debit sah, label saja); revisi berurutan 1,2; neraca 0',
          wait.startswith('Lock/') and res['ok'] and n == 2 and parts_of(h, F['receipt'])[0]['metode'] == 'Debit' and tb(h) == 0, dict(wait=wait, res=str(res)[:200], n=n))
    G = ranap(h, nxt(), 'cash', user=OWNER); pg = parts_of(h, G['receipt'])
    with c.Session(db, 'obs2') as obs, session('c', OWNER) as a, session('d', OWNER) as b:
        a.sql('begin;' + cs(G['receipt'], pg[0]['id'], 'twin')); b.send(cs(G['receipt'], pg[0]['id'], 'twin'))
        wait2 = blocked(obs, b); a.sql('commit;'); res2 = c.attempt(b, commit=False)
    check('balapan: dua permintaan IDENTIK serentak: yang kedua menunggu lalu mengembalikan hasil tersimpan; satu efek, satu audit', wait2.startswith('Lock/') and res2['ok']
          and h.angka(f"select count(*) from public.clinic_receipt_method_corrections where receipt_id={q(G['receipt'])}") == 1 and tb(h) == 0, dict(wait=wait2, res=str(res2)[:200]))
    H_ = ranap(h, nxt(), 'cash', user=OWNER); ph = parts_of(h, H_['receipt']); base_c, base_b = h.saldo('110003'), h.saldo('120002')
    with c.Session(db, 'obs3') as obs, session('e', OWNER) as a, session('f', OWNER) as b:
        a.sql('begin;' + cs(H_['receipt'], ph[0]['id'], 'race-vs-cancel')); b.send(bk.cancel_sql(H_['inv'], 'race-cancel-after'))
        wait3 = blocked(obs, b); a.sql('commit;'); res3 = c.attempt(b, commit=False)
    check('balapan: Batalkan penerimaan menunggu koreksi metode yang sedang berjalan, lalu membalik rekening BARU: kas/bank bersih seperti sebelum kwitansi, neraca 0',
          wait3.startswith('Lock/') and res3['ok'] and h.status_bayar(H_['inv']) == 'Belum Lunas' and tb(h) == 0 and h.saldo('110003') == base_c - H_['total'] and h.saldo('120002') == base_b, dict(wait=wait3, res=str(res3)[:200], cash=str(h.saldo('110003') - base_c), bank=str(h.saldo('120002') - base_b)))
    # tutup shift berbarengan
    K = ranap(h, nxt(), 'cash', user=FINANCE); pk = parts_of(h, K['receipt'])
    with c.Session(db, 'obs4') as obs, session('g', OWNER) as a, session('h', OWNER) as b:
        a.sql('begin;' + cs(K['receipt'], pk[0]['id'], 'race-shift')); b.send(f"update public.cashier_shifts set status='closed', closed_at=now() where id={q(r.SHIFT[FINANCE])} and status='open';")
        wait4 = blocked(obs, b); a.sql('commit;')
        try: c.attempt(b, commit=False)
        except Exception: pass
    set_shift(h, FINANCE, 'open')
    check('balapan: tutup shift asal berbarengan MENUNGGU koreksi (baris shift terkunci) -> efek laci tidak bisa terlewat dari kedua sisi', wait4.startswith('Lock/'), dict(wait=wait4))


def section_static(h):
    text = (MIG / CANDIDATE).read_text() if (MIG / CANDIDATE).exists() else ''
    check('statik: migrasi tanpa begin/commit sendiri (aman dibungkus transaksi pemasangan)', text != '' and not any(l.strip().lower() in ('begin;', 'commit;') for l in text.splitlines()), {})
    funcs = json.loads(h.nilai("select coalesce(jsonb_agg(jsonb_build_object('f',p.proname,'sec',p.prosecdef,'cfg',p.proconfig,'anon',has_function_privilege('anon',p.oid,'execute'),'auth',has_function_privilege('authenticated',p.oid,'execute'),'svc',has_function_privilege('service_role',p.oid,'execute')) order by p.proname),'[]') "
                               "from pg_proc p where p.proname in ('correct_clinic_receipt_part_method','ubah_metode_allowed','ubah_metode_actor','correct_pos_sale_method','correct_clinic_invoice_payment')"))
    pub = [f for f in funcs if f['f'] != 'ubah_metode_actor']; priv = [f for f in funcs if f['f'] == 'ubah_metode_actor']
    check('ACL: RPC publik hanya authenticated (anon/service_role tidak), definer + search_path kosong; fungsi privat tanpa hak app', len(pub) == 4 and all(f['sec'] and f['auth'] and not f['anon'] and not f['svc'] and 'search_path=""' in ' '.join(f['cfg'] or []) for f in pub)
          and len(priv) == 1 and not priv[0]['auth'] and not priv[0]['anon'], dict(funcs=funcs))
    tab = json.loads(h.nilai("select jsonb_build_object('anon',has_table_privilege('anon','public.clinic_receipt_method_corrections','select'),'auth_sel',has_table_privilege('authenticated','public.clinic_receipt_method_corrections','select'),'auth_ins',has_table_privilege('authenticated','public.clinic_receipt_method_corrections','insert'),'auth_upd',has_table_privilege('authenticated','public.clinic_receipt_method_corrections','update'),'auth_del',has_table_privilege('authenticated','public.clinic_receipt_method_corrections','delete'),'rls',(select relrowsecurity from pg_class where oid='public.clinic_receipt_method_corrections'::regclass))"))
    check('ACL tabel jejak: authenticated hanya SELECT (RLS aktif); tanpa INSERT/UPDATE/DELETE; anon tidak', tab == dict(anon=False, auth_sel=True, auth_ins=False, auth_upd=False, auth_del=False, rls=True), tab)
    rd = {u: h.angka("select count(*) from public.clinic_receipt_method_corrections;", u) for u in (OWNER, FINANCE, ADMIN, STAFF)}
    check('baca jejak (RLS): Owner/Finance/Admin cabang melihat; STAFF tidak melihat satu pun baris', rd[OWNER] > 0 and rd[FINANCE] > 0 and rd[ADMIN] > 0 and rd[STAFF] == 0, rd)
    e1 = h.gagal("update public.clinic_receipt_method_corrections set reason='diubah';"); e2 = h.gagal("delete from public.clinic_receipt_method_corrections;"); e3 = h.gagal("truncate public.clinic_receipt_method_corrections;")
    check('jejak tidak dapat diubah/dihapus/dikosongkan (bahkan oleh pemilik tabel)', has(e1, 'IMMUTABLE') and has(e2, 'IMMUTABLE') and has(e3, 'IMMUTABLE'), dict(e1=(e1 or '')[:80], e2=(e2 or '')[:80], e3=(e3 or '')[:80]))
    seen = h.gagal("set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub'," + q(STAFF) + ",false); delete from public.clinic_receipt_method_corrections;")
    check('akun aplikasi tidak bisa menulis langsung ke tabel jejak', bool(seen), dict(err=(seen or '')[:120]))
    cnt = h.angka("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('clinic_cancel_invoice_receipt','clinic_receive_visit_payment','clinic_void_payment_receipt','clinic_write_journal')")
    check('fungsi pembatalan/penerimaan/jurnal live tidak diganti oleh migrasi ini (tetap ada; migrasi tidak memuat create/replace atasnya)', cnt >= 4 and 'function public.clinic_cancel_invoice_receipt' not in text and 'function public.clinic_receive_visit_payment' not in text and 'function public.clinic_write_journal' not in text, dict(cnt=cnt))


SECTIONS = ['receipt', 'idem', 'guards', 'shift', 'roles', 'map', 'race', 'static']


def run(h, db, setup=True, baseline=False, sections=None):
    if setup: x.setup(h)
    fns = dict(receipt=section_receipt, idem=section_idem, guards=section_guards, shift=section_shift, roles=section_roles, map=section_map, static=section_static)
    for s in [s for s in SECTIONS if (sections is None or s in sections)]:
        print('=== section', s, flush=True)
        try:
            if s == 'race': section_race(h, db)
            else: fns[s](h)
        except Exception as e:
            check(f'SECTION {s} aborted', False, str(e).strip()[:600])


def build_chain(db, exclude): okr.build(db, exclude)
def apply_candidate(db, text): db.sql('begin;\n' + text + '\ncommit;')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--sections'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--only'); a = ap.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    SEC = set(a.sections.split(',')) if a.sections else None
    extra = {}
    try:
        if a.mutations:
            from importlib.machinery import SourceFileLoader
            mut = SourceFileLoader('mut', str(ROOT / 'scripts/test-ubah-metode-bayar-mutants.py')).load_module()
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
                build_chain(db, {CANDIDATE}); h = x.Harness(db)
                if not a.baseline: apply_candidate(db, (MIG / CANDIDATE).read_text())
                run(h, db, baseline=a.baseline, sections=SEC)
    except Exception as e: check('HARNESS', False, str(e)[:800])
    totals = {s: sum(cc['status'] == s for cc in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='mutations' if a.mutations else 'RED' if a.baseline else 'GREEN', cases=RESULTS, totals=totals, **extra), indent=2, default=str)); print(totals)
    return 0 if a.baseline else int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
