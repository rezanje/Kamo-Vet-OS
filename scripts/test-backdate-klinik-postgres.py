#!/usr/bin/env python3
"""'Tanggal efektif (backdate)' untuk Batalkan penerimaan KLINIK (migrasi 20261115100000_batalkan_penerimaan_klinik_tanggal_efektif.sql).
Owner memilih tanggal pembukuan: jurnal pembalik, koreksi tagihan dan penerimaan ulang jatuh pada tanggal ASLI; uang fisik (laci shift) tetap hari ini.

Native full schema, fictional fixtures, throwaway local cluster, no network.
  flock /opt/data/kamo-heavy-test.lock python3 -I scripts/test-backdate-klinik-postgres.py --pg-bin DIR --json out.json
  --baseline    chain WITHOUT the candidate: every case about the new feature must FAIL (RED)
  --mutations   chain without the candidate once, then each mutant of the candidate in a cloned database; all must be killed
  --attach DIR  dev only: clone of the `postgres` DB (chain WITHOUT candidate, x.setup done) in a running cluster, candidate applied on top
"""
import argparse, importlib.util, json, os, sys, time
from decimal import Decimal
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('bk', ROOT / 'scripts/test-batalkan-penerimaan-klinik-postgres.py'); assert spec and spec.loader
bk = importlib.util.module_from_spec(spec); spec.loader.exec_module(bk)
okr, m, x, r, q, j, c = bk.okr, bk.m, bk.x, bk.r, bk.q, bk.j, bk.c
CANDIDATE = '20261115100000_batalkan_penerimaan_klinik_tanggal_efektif.sql'
MIG = ROOT / 'supabase/migrations'
RESULTS = bk.RESULTS
check, nxt, has, tb, net, inv_row, D, blocked, set_shift = bk.check, bk.nxt, bk.has, bk.tb, bk.net, bk.inv_row, bk.D, bk.blocked, bk.set_shift
OWNER, ADMIN, FINANCE, STAFF = r.OWNER, r.ADMIN, r.FINANCE, r.STAFF
RPC, PREVIEW = 'clinic_cancel_invoice_receipt', 'clinic_cancel_invoice_receipt_preview'
GRANT, GRANT_TGL = 'klinik.batalkan_penerimaan', 'klinik.batalkan_penerimaan_tanggal'
CTX = {}


def setup_dates(h):
    CTX['today'] = h.nilai("select (now() at time zone 'Asia/Jakarta')::date::text")
    CTX['orig'] = h.nilai("select ((now() at time zone 'Asia/Jakarta')::date - 3)::text")
    CTX['mid'] = h.nilai("select ((now() at time zone 'Asia/Jakarta')::date - 1)::text")
    r.TGL = CTX['orig']; bk.r.TGL = CTX['orig']
    # kasus nyata INV-0777: satu baris Rp108.000 (turun 45.000 -> Rp63.000)
    r.BARIS[1] = ('Jasa Rawat Inap Fiktif', 1, 108000, 'jasa', None, 'hari')


def cancel(h, inv, key, eff=None, user=OWNER, reason='Koreksi harga disetujui Owner'):
    arg = '' if eff is None else f",{q(eff)}::date"
    try: return None, json.loads(h.nilai(f"select public.{RPC}({q(inv)},{q(key)},{q(reason)}{arg});", user))
    except RuntimeError as e: return str(e), None


def preview(h, inv, eff=None, user=OWNER):
    arg = '' if eff is None else f",{q(eff)}::date"
    try: return None, json.loads(h.nilai(f"select public.{PREVIEW}({q(inv)}{arg});", user))
    except RuntimeError as e: return str(e), None


def plant(h, F):
    """Tagihan fixture dianggap dibuat dan dibayar pada tanggal asli (ORIG): created_at tagihan, paid_at, dan jam pencatatan jurnal/pembayaran/kwitansi."""
    o = CTX['orig']; ts = f"({q(o)}::date + time '12:00') at time zone 'Asia/Jakarta'"
    h.sistem(f"""alter table public.invoices disable trigger user; alter table public.journal_entries disable trigger user;
update public.invoices set created_at={ts}, paid_at=case when paid_status='Lunas' then {ts} else paid_at end where id={q(F['inv'])};
update public.journal_entries set created_at={ts} where source_ref={q(F['no'])};
alter table public.invoices enable trigger user; alter table public.journal_entries enable trigger user;""")


def mk(h, n, metode='QRIS', price=108000, status='Lunas', dp=0, user=OWNER, split=None, slots=(1,)):
    """Rawat jalan biasa dengan satu baris berharga `price` (Rp108.000 -> Rp63.000 = harga turun 45.000)."""
    F = bk.rj(h, n, metode, status, dp, slots=slots, user=user, split=split)
    plant(h, F); return F


def rep(h, F, day):
    """Omzet/penerimaan tagihan ini per tanggal, menurut kolom tanggal yang dibaca tiap laporan."""
    no, inv = F['no'], F['inv']
    return dict(
        transaksi=D(h.nilai(f"select coalesce(sum(total),0) from public.invoices where id={q(inv)} and voided_at is null and (created_at at time zone 'Asia/Jakarta')::date={q(day)}")),
        pendapatan=D(h.nilai("select coalesce(sum(case when a.code='510002' then l.credit-l.debit when a.code='520002' then l.credit-l.debit else 0 end),0) from public.journal_lines l "
                             f"join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id where e.source_ref={q(no)} and e.source like 'klinik%' "
                             f"and e.source not in ('klinik-hpp','klinik-hpp-edit') and e.voided_at is null and e.tanggal={q(day)}")),
        bank=D(h.nilai("select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id "
                       f"where e.source_ref={q(no)} and e.source like 'klinik%' and e.voided_at is null and a.type='ASET' and a.code<>'150001' and e.tanggal={q(day)}")),
        pembayaran=D(h.nilai(f"select coalesce(sum(amount),0) from public.invoice_payments where invoice_id={q(inv)} and tanggal={q(day)}")),
        lunas_paid_at=int(h.angka(f"select count(*) from public.invoices where id={q(inv)} and paid_status='Lunas' and (paid_at at time zone 'Asia/Jakarta')::date={q(day)}")),
        jurnal_n=int(h.angka(f"select count(*) from public.journal_entries e where e.source_ref={q(no)} and e.voided_at is null and e.tanggal={q(day)}")))


def tb_dates(h):
    """Neraca saldo nol per cabang DAN per tanggal."""
    return int(h.angka("select count(*) from (select e.branch_id, e.tanggal from public.journal_entries e join public.journal_lines l on l.entry_id=e.id group by 1,2 having sum(l.debit-l.credit)<>0) z"))


def settle_ok(h, F, parts, key, user=OWNER):
    return bk.settle(h, F, parts, key, user)


def edit_to(h, F, key, delta, user=OWNER):
    return bk.edit_inv(h, F, key, delta, user)


def cash_expected(h, shift):
    return D(h.nilai(f"select clinic_private.klinik_shift_expected_cash({q(shift)}::uuid)"))


# ------------------------------------------------------------------ sections
def sec_preflight(h):
    ok = all(h.angka(f"select count(*) from pg_proc where proname='{p}'") >= 1 for p in ('clinic_backdate_release', 'clinic_backdated_entries'))
    check('preflight: objek tanggal efektif ada (RPC lepas + daftar Finance)', ok, {})
    check('preflight: pratinjau menerima tanggal (kolom min/max/can_backdate)', h.angka("select count(*) from pg_proc where proname='clinic_cancel_invoice_receipt_preview' and pronargs=2") == 1, {})


def sec_core(h):
    """Kasus nyata: Rp108.000 -> Rp63.000 pada tanggal asli, per jalur laporan."""
    o, t = CTX['orig'], CTX['today']
    F = mk(h, nxt(), 'QRIS'); T0 = F['total']
    before = {d: rep(h, F, d) for d in (o, t)}
    check('core: sebelum batal, tagihan Lunas QRIS pada tanggal asli: transaksi, pendapatan, bank, paid_at semua di tanggal asli; hari ini nol',
          before[o]['transaksi'] == T0 and before[o]['pendapatan'] == T0 and before[o]['bank'] == T0 and before[o]['lunas_paid_at'] == 1 and before[t]['pendapatan'] == 0 and before[t]['jurnal_n'] == 0, before)
    e0, p = preview(h, F['inv'], o); p = p or {}
    check('core: pratinjau Owner: batas bawah = tanggal penerimaan asli, batas atas = hari ini, boleh tanggal mundur, tanggal terpilih lolos',
          e0 is None and p.get('min_date') == o and p.get('max_date') == t and p.get('can_backdate') is True and p.get('date_refuse') is None and p.get('effective_date') == o, dict(err=e0, p={k: p.get(k) for k in ('min_date', 'max_date', 'can_backdate', 'date_refuse', 'effective_date')}))
    err, res = cancel(h, F['inv'], f"bd-{F['n']}", o)
    aud = json.loads(h.nilai(f"select to_jsonb(a) from public.clinic_receipt_cancellations a where invoice_id={q(F['inv'])}"))
    win = json.loads(h.nilai(f"select coalesce(to_jsonb(w),'null') from public.clinic_backdate_windows w where invoice_id={q(F['inv'])}"))
    check('core: batal penerimaan bertanggal asli: jurnal pembalik di tanggal asli (bukan hari ini), tagihan Belum Lunas, hasil memuat tanggal efektif + tanggal & waktu sebenarnya',
          err is None and h.status_bayar(F['inv']) == 'Belum Lunas' and res['effective_date'] == o and res['actual_date'] == t and res['backdated'] is True and rep(h, F, t)['jurnal_n'] == 0
          and rep(h, F, o)['bank'] == 0 and tb(h) == 0 and tb_dates(h) == 0, dict(err=(err or '')[:240], res=res))
    check('core: jejak audit mencatat tanggal efektif, tanggal pencatatan (hari ini WIB) dan waktu sebenarnya; jendela terbuka per tagihan',
          aud['effective_date'] == o and aud['tanggal'] == t and aud['created_at'] and win and win['status'] == 'terbuka' and win['effective_date'] == o and win['cancellation_id'] == aud['id'], dict(aud=aud['effective_date'], win=win))
    e1 = edit_to(h, F, f"e-{F['n']}", -45000)
    mid = {d: rep(h, F, d) for d in (o, t)}
    check('core: koreksi harga turun 45.000 selama jendela terbuka: jurnal penjualan/koreksi di tanggal asli, hari ini tidak ada jurnal tagihan ini',
          e1 is None and mid[t]['jurnal_n'] == 0 and mid[o]['pendapatan'] == T0 - 45000 and tb_dates(h) == 0, dict(e1=(e1 or '')[:240], mid=mid))
    newtotal = int(h.angka(f"select total from public.invoices where id={q(F['inv'])}"))
    s_before = cash_expected(h, r.SHIFT[OWNER])
    e2 = settle_ok(h, F, [{'method': 'QRIS', 'amount': newtotal}], f"s-{F['n']}")
    fin = {d: rep(h, F, d) for d in (o, t)}
    rc = json.loads(h.nilai(f"select to_jsonb(r) from public.clinic_payment_receipts r where visit_id={q(F['v'])} and status='aktif' order by created_at desc limit 1"))
    pay = json.loads(h.nilai(f"select to_jsonb(p) from public.invoice_payments p where invoice_id={q(F['inv'])} and amount>0 order by created_at desc limit 1"))
    win2 = h.nilai(f"select status from public.clinic_backdate_windows where invoice_id={q(F['inv'])}")
    brec = h.angka(f"select count(*) from public.clinic_backdate_receipts where receipt_id={q(rc['id'])} and effective_date={q(o)} and actual_date={q(t)}")
    check('core: terima ulang QRIS (Rp108.000 -> Rp63.000 analog) dibukukan di tanggal asli: kwitansi, baris pembayaran, jurnal bank; paid_at = tanggal asli; jendela selesai',
          e2 is None and h.status_bayar(F['inv']) == 'Lunas' and str(rc['tanggal']) == o and str(pay['tanggal']) == o and fin[o]['pembayaran'] == newtotal and fin[o]['lunas_paid_at'] == 1 and win2 == 'selesai' and brec == 1,
          dict(e2=(e2 or '')[:240], rc=rc['tanggal'], pay=pay['tanggal'], fin=fin[o], win=win2))
    check('core: OMZET PER TANGGAL per jalur laporan = harga baru di tanggal asli, tidak bergeser ke hari ini: laporan transaksi (created_at), jurnal pendapatan, buku besar bank/rekonsiliasi, penerimaan (pembayaran), paid_at',
          fin[o]['transaksi'] == newtotal and fin[o]['pendapatan'] == newtotal and fin[o]['bank'] == newtotal and fin[o]['pembayaran'] == newtotal and fin[o]['lunas_paid_at'] == 1
          and fin[t]['pendapatan'] == 0 and fin[t]['bank'] == 0 and fin[t]['pembayaran'] == 0 and fin[t]['transaksi'] == 0 and fin[t]['jurnal_n'] == 0 and newtotal == T0 - 45000, dict(fin=fin, T0=T0, new=newtotal))
    sh = h.nilai(f"select shift_id from public.clinic_payment_receipts where id={q(rc['id'])}")
    check('core: uang fisik tetap hari ini: kwitansi memakai shift TERBUKA pelaku (bukan tanggal efektif); trial balance nol per cabang dan per tanggal',
          sh == r.SHIFT[OWNER] and tb(h) == 0 and tb_dates(h) == 0, dict(shift=sh))
    jr = json.loads(h.nilai(f"select jsonb_agg(jsonb_build_object('tanggal',e.tanggal,'dicatat',(e.created_at at time zone 'Asia/Jakarta')::date)) from public.journal_entries e where e.source_ref={q(F['no'])} and e.created_at>now()-interval '1 hour' and e.source like 'klinik%'"))
    check('core: jurnal baru semua bertanggal asli tetapi tercatat hari ini (tanggal jurnal dan waktu catat sebenarnya keduanya ada untuk rekonsiliasi)',
          jr and all(z['tanggal'] == o and z['dicatat'] == t for z in jr), dict(n=len(jr or [])))
    # kontrol: tanpa tanggal = perilaku lama persis (hari ini); tanggal asli tetap berisi harga LAMA
    G = mk(h, nxt(), 'QRIS'); T1 = G['total']
    err, res = cancel(h, G['inv'], f"ctl-{G['n']}")
    e3 = edit_to(h, G, f"ectl-{G['n']}", -45000); new1 = int(h.angka(f"select total from public.invoices where id={q(G['inv'])}"))
    e4 = settle_ok(h, G, [{'method': 'QRIS', 'amount': new1}], f"sctl-{G['n']}")
    c_o, c_t = rep(h, G, o), rep(h, G, t)
    check('kontrol (tanpa tanggal, perilaku lama): jurnal jatuh HARI INI; omzet tanggal asli tetap harga LAMA dan hari ini memuat selisih (inilah yang diperbaiki fitur ini)',
          err is None and e3 is None and e4 is None and res['backdated'] is False and c_o['pendapatan'] == T1 and c_t['pendapatan'] == -45000 and c_t['bank'] == new1 - T1 and c_o['transaksi'] == new1
          and h.nilai(f"select count(*) from public.clinic_backdate_windows where invoice_id={q(G['inv'])}") == '0', dict(c_o=c_o, c_t=c_t, res=res))
    check('kontrol: tanpa tanggal tidak membuat jendela/catatan tanggal efektif dan kwitansi bertanggal hari ini', h.angka(f"select count(*) from public.clinic_backdate_receipts b join public.clinic_payment_receipts r on r.id=b.receipt_id where r.visit_id={q(G['v'])}") == 0, {})


def sec_methods(h):
    o = CTX['orig']
    for metode in ('Tunai', 'QRIS', 'Transfer', 'Debit', 'Kredit', 'E-Wallet'):
        F = mk(h, nxt(), metode); T0 = F['total']; kas = bk.KAS[metode]
        err, res = cancel(h, F['inv'], f"m-{F['n']}", o)
        e1 = edit_to(h, F, f"me-{F['n']}", -45000); nt = int(h.angka(f"select total from public.invoices where id={q(F['inv'])}"))
        e2 = settle_ok(h, F, [{'method': metode, 'amount': nt}], f"ms-{F['n']}")
        f = rep(h, F, o); tdy = rep(h, F, CTX['today'])
        check(f'metode {metode}: batal bertanggal -> koreksi -> terima ulang {metode}: semua di tanggal asli, bank/kas {kas} = total baru, Lunas, hari ini nol',
              err is None and e1 is None and e2 is None and h.status_bayar(F['inv']) == 'Lunas' and f['bank'] == nt and f['pendapatan'] == nt and tdy['jurnal_n'] == 0 and tb_dates(h) == 0 and net(h, F['no'])[kas] == nt,
              dict(err=(err or '')[:160], e1=(e1 or '')[:160], e2=(e2 or '')[:160], f=f))


def sec_dp_split(h):
    o, t = CTX['orig'], CTX['today']
    F = mk(h, nxt(), 'Tunai', status='DP', dp=100000, slots=(1, 2))   # total 220000, DP 100000 di kepala tagihan
    err, res = cancel(h, F['inv'], f"dp-{F['n']}", o)
    e1 = edit_to(h, F, f"dpe-{F['n']}", 20000); nt = int(h.angka(f"select total from public.invoices where id={q(F['inv'])}"))
    e2 = settle_ok(h, F, [{'method': 'QRIS', 'amount': 60000}], f"dps1-{F['n']}")
    st = h.status_bayar(F['inv']); mid_win = h.nilai(f"select status from public.clinic_backdate_windows where invoice_id={q(F['inv'])}")
    e3 = settle_ok(h, F, [{'method': 'Tunai', 'amount': nt - 60000}], f"dps2-{F['n']}")
    f = rep(h, F, o)
    check('DP: batal bertanggal (DP di kepala tagihan) -> koreksi -> pelunasan dua kali (QRIS lalu Tunai): semua pada tanggal asli, jendela tetap terbuka sampai Lunas lalu selesai',
          err is None and e1 is None and e2 is None and e3 is None and st == 'DP' and mid_win == 'terbuka' and h.status_bayar(F['inv']) == 'Lunas'
          and h.nilai(f"select status from public.clinic_backdate_windows where invoice_id={q(F['inv'])}") == 'selesai' and rep(h, F, t)['jurnal_n'] == 0 and f['bank'] == nt and tb_dates(h) == 0,
          dict(err=(err or '')[:160], e1=(e1 or '')[:160], e2=(e2 or '')[:160], e3=(e3 or '')[:160], st=st, f=f))
    # checkout campuran (split): bagian Tunai + QRIS dibalik bertanggal asli
    G = mk(h, nxt(), 'Tunai', slots=(1, 2), split=[{'method': 'Tunai', 'amount': 100000, 'kas_code': '110003'}, {'method': 'QRIS', 'amount': 128000, 'kas_code': '120002'}])
    err, res = cancel(h, G['inv'], f"sp-{G['n']}", o)
    e1 = edit_to(h, G, f"spe-{G['n']}", 20000); nt = int(h.angka(f"select total from public.invoices where id={q(G['inv'])}"))
    e2 = settle_ok(h, G, [{'method': 'Transfer', 'amount': nt}], f"sps-{G['n']}")
    f = rep(h, G, o)
    check('split: checkout campuran Tunai+QRIS dibatalkan bertanggal asli, dikoreksi, diterima ulang Transfer: semua di tanggal asli, pembayaran pembalik bertanggal asli',
          err is None and e1 is None and e2 is None and h.status_bayar(G['inv']) == 'Lunas' and rep(h, G, t)['jurnal_n'] == 0 and f['bank'] == nt
          and int(h.angka(f"select count(*) from public.invoice_payments where invoice_id={q(G['inv'])} and amount<0 and tanggal<>{q(o)}")) == 0 and tb_dates(h) == 0, dict(err=(err or '')[:160], e1=(e1 or '')[:160], e2=(e2 or '')[:160], f=f))


def sec_ranap(h):
    o, t = CTX['orig'], CTX['today']
    # uang muka (advance) dipakai penuh
    F = bk.ranap(h, nxt(), 'advance'); plant(h, F)
    err, res = cancel(h, F['inv'], f"ra-{F['n']}", o)
    adv = json.loads(h.nilai(f"select to_jsonb(a) from public.clinic_customer_advances a where id={q(F['adv'])}"))
    check('ranap uang muka: batal bertanggal asli: pemakaian dibatalkan, jurnal 150001/314001 di tanggal asli, saldo uang muka kembali, tanpa jurnal hari ini',
          err is None and D(adv['applied']) == 0 and rep(h, F, t)['jurnal_n'] == 0 and h.status_bayar(F['inv']) == 'Belum Lunas' and tb_dates(h) == 0, dict(err=(err or '')[:200]))
    check('ranap uang muka: baris pembayaran pembalik pemakaian uang muka bertanggal efektif (bukan hari ini)',
          int(h.angka(f"select count(*) from public.invoice_payments where invoice_id={q(F['inv'])} and amount<0")) >= 1 and int(h.angka(f"select count(*) from public.invoice_payments where invoice_id={q(F['inv'])} and amount<0 and tanggal<>{q(o)}")) == 0, {})
    e1 = bk.edit_inv(h, F, f"rae-{F['n']}", 25000)
    e2 = h.gagal(r.bayar_sql(F['v'], f"ra-pay-{F['n']}", [{'method': 'Tunai', 'amount': 25000}], F['inv']), OWNER)
    rc = json.loads(h.nilai(f"select to_jsonb(r) from public.clinic_payment_receipts r where request_key={q(f'ra-pay-{F[chr(110)]}')}")) if e2 is None else None
    check('ranap uang muka: terima Tunai 25.000 (status DP, uang muka tidak dipakai lagi): kwitansi + jurnal di tanggal asli (r.bayar_sql mengirim tanggal fixture, DB memakai tanggal efektif), shift = shift terbuka pelaku',
          e1 is None and e2 is None and rc and str(rc['tanggal']) == o and rc['shift_id'] == r.SHIFT[OWNER] and rep(h, F, t)['jurnal_n'] == 0 and h.status_bayar(F['inv']) == 'DP' and tb_dates(h) == 0,
          dict(e1=(e1 or '')[:160], e2=(e2 or '')[:200], rc=rc and rc['tanggal'], shift=rc and rc['shift_id'], today=rep(h, F, t), st=h.status_bayar(F['inv']), tbd=tb_dates(h)))
    # kwitansi tunai langsung, kasir lain (shift asal terbuka)
    G = bk.ranap(h, nxt(), 'cash', user=FINANCE); plant(h, G)
    err, res = cancel(h, G['inv'], f"rc-{G['n']}", o)
    e1 = bk.edit_inv(h, G, f"rce-{G['n']}", -20000)
    nt = int(h.angka(f"select total from public.invoices where id={q(G['inv'])}"))
    e2 = h.gagal(r.bayar_sql(G['v'], f"rc-pay-{G['n']}", [{'method': 'QRIS', 'amount': nt}], G['inv']), OWNER)
    f = rep(h, G, o)
    check('ranap kwitansi Tunai kasir lain: batal bertanggal, koreksi turun, terima ulang QRIS: di tanggal asli; kwitansi lama batal utuh bertanggal pembatalan asli',
          err is None and e1 is None and e2 is None and h.status_bayar(G['inv']) == 'Lunas' and rep(h, G, t)['jurnal_n'] == 0 and f['bank'] == nt and int(h.angka(f"select count(*) from public.invoice_payments where invoice_id={q(G['inv'])} and amount<0 and tanggal<>{q(o)}")) == 0 and h.nilai(f"select count(*) from public.journal_entries where source_ref={q(G['no'])} and source='klinik-uang-muka-batal' and tanggal<>{q(o)}") == '0', dict(err=(err or '')[:160], e1=(e1 or '')[:160], e2=(e2 or '')[:160], f=f))
    cash_net = net(h, G['no'])
    check('ranap kwitansi: kas 0, bank = total baru, piutang 0, neraca nol per tanggal', cash_net['110003'] == 0 and cash_net['120002'] == nt and cash_net['150001'] == 0 and tb_dates(h) == 0, dict(net={k: str(v) for k, v in cash_net.items()}))


def sec_dates(h):
    o, t, mid = CTX['orig'], CTX['today'], CTX['mid']
    F = mk(h, nxt(), 'QRIS'); st0 = bk.money_state(h)
    fut = h.nilai("select ((now() at time zone 'Asia/Jakarta')::date + 1)::text")
    err, _ = cancel(h, F['inv'], f"fut-{F['n']}", fut)
    check('tanggal masa depan ditolak (pesan jelas), tidak ada yang berubah', has(err, 'TANGGAL_MASA_DEPAN') and bk.money_state(h) == st0, dict(err=(err or '')[:200]))
    e2, p = preview(h, F['inv'], fut)
    check('pratinjau tanggal masa depan memberi alasan penolakan tanggal', e2 is None and p['date_refuse'] and p['date_refuse']['code'] == 'TANGGAL_MASA_DEPAN', dict(e=e2, p=p and p['date_refuse']))
    before_rec = h.nilai("select to_char((%s::date - 1),'YYYY-MM-DD')" % q(o))
    err, _ = cancel(h, F['inv'], f"pre-{F['n']}", before_rec)
    check('tanggal SEBELUM tanggal penerimaan asli ditolak (pesan memuat tanggal asli), tidak ada yang berubah', has(err, 'TANGGAL_SEBELUM_PENERIMAAN') and o in (err or '') and bk.money_state(h) == st0, dict(err=(err or '')[:240]))
    e3, p3 = preview(h, F['inv'], before_rec)
    check('pratinjau tanggal sebelum penerimaan memberi alasan', e3 is None and p3['date_refuse']['code'] == 'TANGGAL_SEBELUM_PENERIMAAN', dict(e=e3))
    err, res = cancel(h, F['inv'], f"mid-{F['n']}", mid)
    check('tanggal di antara tanggal asli dan hari ini (kemarin) diterima; jurnal bertanggal itu', err is None and res['effective_date'] == mid and rep(h, F, mid)['jurnal_n'] >= 1 and rep(h, F, t)['jurnal_n'] == 0, dict(err=(err or '')[:200]))
    # batas bawah memperhitungkan kwitansi yang tanggalnya LEBIH LAMBAT dari penjualan (uang diterima belakangan)
    Rr = bk.ranap(h, nxt(), 'none')
    erp = h.gagal(f"select public.clinic_receive_visit_payment({q(Rr['v'])},{q('late-'+str(Rr['n']))},{q(mid)}::date,{j([{'method': 'QRIS', 'amount': Rr['total']}])},{q(Rr['inv'])}::uuid,null);", OWNER)
    st9 = bk.money_state(h)
    err, _ = cancel(h, Rr['inv'], f"late1-{Rr['n']}", o)
    e9, p9 = preview(h, Rr['inv'], None)
    check('kwitansi diterima belakangan (tanggal kwitansi > tanggal penjualan): batas bawah = tanggal kwitansi; tanggal di antaranya ditolak, pratinjau menyebut batas yang sama',
          erp is None and has(err, 'TANGGAL_SEBELUM_PENERIMAAN') and mid in (err or '') and bk.money_state(h) == st9 and e9 is None and p9['min_date'] == mid, dict(erp=(erp or '')[:120], err=(err or '')[:200], e9=e9, mn=p9 and p9['min_date']))
    err, res = cancel(h, Rr['inv'], f"late2-{Rr['n']}", mid)
    check('kwitansi diterima belakangan: tanggal = tanggal kwitansi diterima', err is None and res['effective_date'] == mid and h.status_bayar(Rr['inv']) == 'Belum Lunas', dict(err=(err or '')[:200]))
    G = mk(h, nxt(), 'QRIS')
    err, res = cancel(h, G['inv'], f"today-{G['n']}", t)
    check('tanggal = hari ini (eksplisit) = perilaku lama: tidak backdated, tanpa jendela', err is None and res['backdated'] is False and h.nilai(f"select count(*) from public.clinic_backdate_windows where invoice_id={q(G['inv'])}") == '0' and rep(h, G, t)['jurnal_n'] >= 1, dict(err=(err or '')[:200]))
    # hak: peran tanpa izin tanggal mundur
    Hh = mk(h, nxt(), 'QRIS'); I = mk(h, nxt(), 'QRIS')
    try:
        h.sql(f"insert into role_settings_private.action_policies(role,allowed) values ('ADMIN', array[{q(GRANT)}]), ('FINANCE', array[{q(GRANT)},{q(GRANT_TGL)}]) on conflict (role) do update set allowed=excluded.allowed;")
        st1 = bk.money_state(h)
        err, _ = cancel(h, Hh['inv'], f"adm-{Hh['n']}", o, ADMIN)
        check('ADMIN dengan izin batalkan TANPA izin tanggal: tanggal mundur ditolak, tidak ada yang berubah', has(err, 'TANGGAL_MUNDUR_DITOLAK') and bk.money_state(h) == st1, dict(err=(err or '')[:200]))
        e1, pv = preview(h, Hh['inv'], None, ADMIN)
        check('ADMIN tanpa izin tanggal: pratinjau menunjukkan can_backdate = false', e1 is None and pv['can_backdate'] is False, dict(e=e1))
        e1b, pv2 = preview(h, Hh['inv'], t, ADMIN)
        check('ADMIN tanpa izin tanggal: pratinjau dengan tanggal = hari ini tidak ditolak (hari ini selalu boleh)', e1b is None and pv2['date_refuse'] is None, dict(e=e1b))
        e1c, pv3 = preview(h, Hh['inv'], o, ADMIN)
        check('ADMIN tanpa izin tanggal: pratinjau tanggal mundur memberi TANGGAL_MUNDUR_DITOLAK', e1c is None and pv3['date_refuse'] and pv3['date_refuse']['code'] == 'TANGGAL_MUNDUR_DITOLAK', dict(e=e1c))
        err, res = cancel(h, Hh['inv'], f"adm2-{Hh['n']}", None, ADMIN)
        check('ADMIN tanpa izin tanggal tetap boleh membatalkan HARI INI (izin lama tidak berubah)', err is None and res['backdated'] is False, dict(err=(err or '')[:200]))
        err, res = cancel(h, I['inv'], f"fin-{I['n']}", o, FINANCE)
        check('FINANCE dengan izin batalkan + izin tanggal mundur: boleh tanggal asli, jejak mencatat peran', err is None and res['backdated'] is True and h.nilai(f"select actor_role from public.clinic_receipt_cancellations where invoice_id={q(I['inv'])}") == 'FINANCE', dict(err=(err or '')[:200]))
        h.sql("update role_settings_private.action_policies set allowed=array['" + GRANT_TGL + "'] where role='FINANCE';")
        J = mk(h, nxt(), 'QRIS')
        err, _ = cancel(h, J['inv'], f"fin2-{J['n']}", o, FINANCE)
        check('izin tanggal mundur SAJA tanpa izin batalkan: tetap ditolak (izin tanggal tidak berdiri sendiri)', has(err, 'ACCESS_DENIED'), dict(err=(err or '')[:200]))
    finally:
        h.sql("delete from role_settings_private.action_policies where role in ('ADMIN','FINANCE');")
    K = mk(h, nxt(), 'QRIS')
    err, res = cancel(h, K['inv'], f"own-{K['n']}", o)
    check('Owner tanpa baris kebijakan apa pun: tanggal mundur boleh (Owner tidak pernah terkunci)', err is None and res['backdated'] is True, dict(err=(err or '')[:200]))
    cat = json.loads(h.nilai(f"select to_jsonb(c) from role_settings_private.action_catalog c where id={q(GRANT_TGL)}"))
    check('katalog izin: klinik.batalkan_penerimaan_tanggal ditegakkan, modul klinik', cat['enforced'] is True and h.nilai(f"select module_id from role_settings_private.action_modules where id={q(GRANT_TGL)}") == 'klinik', cat)


def sec_period(h):
    o, t, mid = CTX['orig'], CTX['today'], CTX['mid']
    F = mk(h, nxt(), 'QRIS'); st0 = bk.money_state(h)
    h.sistem(f"update public.accounting_locks set closed_until={q(o)} where id;")
    try:
        err, _ = cancel(h, F['inv'], f"pl-{F['n']}", o)
        check('periode akuntansi tertutup pada tanggal pilihan: ditolak UTUH dengan petunjuk membuka kembali di Tutup Buku (tidak dilewati), tidak ada yang berubah',
              has(err, 'PERIODE_TERKUNCI', 'Tutup Buku') and bk.money_state(h) == st0, dict(err=(err or '')[:300]))
        e2, p = preview(h, F['inv'], o)
        check('pratinjau memberi alasan periode terkunci pada tanggal itu', e2 is None and p['date_refuse'] and p['date_refuse']['code'] == 'PERIODE_TERKUNCI' and 'Tutup Buku' in p['date_refuse']['message'], dict(e=e2))
        err, res = cancel(h, F['inv'], f"pl2-{F['n']}", mid)
        check('tanggal SESUDAH periode tertutup (kemarin) tetap boleh', err is None and res['effective_date'] == mid, dict(err=(err or '')[:200]))
    finally:
        h.sistem("update public.accounting_locks set closed_until=null where id;")
    G = mk(h, nxt(), 'QRIS'); st1 = bk.money_state(h)
    h.sistem(f"update public.inventory_costing_settings set closed_through={q(o)} where id;")
    try:
        err, _ = cancel(h, G['inv'], f"pi-{G['n']}", o)
        check('periode persediaan tertutup pada tanggal pilihan: ditolak (koreksi tagihan sesudahnya tidak bisa bertanggal itu), tidak ada yang berubah', has(err, 'PERSEDIAAN_TERKUNCI') and bk.money_state(h) == st1, dict(err=(err or '')[:240]))
    finally:
        h.sistem("update public.inventory_costing_settings set closed_through=null where id;")
    H = mk(h, nxt(), 'QRIS'); st2 = bk.money_state(h)
    bln = o[:7]
    emp = h.nilai("select id from public.employees limit 1")
    h.sistem(f"insert into public.payrolls(periode, employee_id) values ({q(bln)}, {q(emp)});")
    try:
        err, _ = cancel(h, H['inv'], f"pg-{H['n']}", o)
        check('penggajian bulan tanggal pilihan sudah dibuat: ditolak (pola grosir), tidak ada yang berubah', has(err, 'GAJI_SUDAH_DIBUAT') and bk.money_state(h) == st2, dict(err=(err or '')[:240]))
        err, res = cancel(h, H['inv'], f"pg2-{H['n']}", None)
        check('penggajian sudah dibuat: batal HARI INI (tanpa tanggal) tetap boleh (perilaku lama, Owner tidak terkunci)', err is None and res['backdated'] is False, dict(err=(err or '')[:200]))
    finally:
        h.sistem(f"delete from public.payrolls where periode={q(bln)};")
    # jendela terbuka lalu periode ditutup: koreksi dan penerimaan ulang ditolak jelas, Owner bisa melepas
    W = mk(h, nxt(), 'QRIS'); cancel(h, W['inv'], f"pw-{W['n']}", o)
    h.sistem(f"update public.accounting_locks set closed_until={q(o)} where id;")
    try:
        e1 = edit_to(h, W, f"pwe-{W['n']}", -20000)
        check('jendela terbuka tetapi periode kini tertutup: Koreksi tagihan ditolak jelas (PERIODE_TERKUNCI + Tutup Buku), tagihan tidak berubah', has(e1, 'PERIODE_TERKUNCI', 'Tutup Buku') and int(h.angka(f"select total from public.invoices where id={q(W['inv'])}")) == W['total'], dict(e1=(e1 or '')[:240]))
        e2 = settle_ok(h, W, [{'method': 'QRIS', 'amount': W['total']}], f"pws-{W['n']}")
        check('jendela terbuka tetapi periode kini tertutup: penerimaan ulang ditolak jelas, tidak ada uang tercatat', has(e2, 'PERIODE_TERKUNCI', 'Tutup Buku') and h.status_bayar(W['inv']) == 'Belum Lunas', dict(e2=(e2 or '')[:240]))
        rel = h.gagal(f"select public.clinic_backdate_release({q(W['inv'])},'Periode ditutup, lanjut hari ini');", OWNER)
        e3 = settle_ok(h, W, [{'method': 'QRIS', 'amount': W['total']}], f"pws2-{W['n']}")
        check('Owner melepas tanggal efektif -> penerimaan ulang bertanggal HARI INI diterima (Owner tidak terkunci)', rel is None and e3 is None and h.status_bayar(W['inv']) == 'Lunas' and rep(h, W, t)['bank'] == W['total'], dict(rel=(rel or '')[:200], e3=(e3 or '')[:200]))
    finally:
        h.sistem("update public.accounting_locks set closed_until=null where id;")
    check('pelepasan tercatat: status dilepas, alasan, pelaku', h.nilai(f"select status||'|'||close_reason||'|'||(closed_by is not null)::text from public.clinic_backdate_windows where invoice_id={q(W['inv'])}") == 'dilepas|Periode ditutup, lanjut hari ini|true', '')


def sec_windows(h):
    o, t = CTX['orig'], CTX['today']
    F = mk(h, nxt(), 'QRIS'); cancel(h, F['inv'], f"w-{F['n']}", o)
    rel = h.gagal(f"select public.clinic_backdate_release({q(F['inv'])},'x');", OWNER)
    check('lepas tanggal efektif: alasan wajib (min 3 huruf)', has(rel, 'RECEIPT_INVALID'), dict(rel=(rel or '')[:120]))
    rel = h.gagal(f"select public.clinic_backdate_release({q(F['inv'])},'Alasan lepas');", STAFF)
    check('lepas tanggal efektif oleh STAFF tanpa izin: ditolak', has(rel, 'ACCESS_DENIED'), dict(rel=(rel or '')[:120]))
    rel = h.gagal(f"select public.clinic_backdate_release({q(F['inv'])},'Alasan lepas');", OWNER)
    e1 = edit_to(h, F, f"we-{F['n']}", -20000); nt = int(h.angka(f"select total from public.invoices where id={q(F['inv'])}"))
    check('setelah dilepas: koreksi tagihan bertanggal HARI INI (jendela tidak berlaku lagi)', rel is None and e1 is None and rep(h, F, t)['jurnal_n'] >= 1, dict(rel=(rel or '')[:120], e1=(e1 or '')[:160]))
    rel2 = h.gagal(f"select public.clinic_backdate_release({q(F['inv'])},'Alasan lepas lagi');", OWNER)
    check('melepas jendela yang sudah tertutup: ditolak (BACKDATE_TIDAK_ADA)', has(rel2, 'BACKDATE_TIDAK_ADA'), dict(rel=(rel2 or '')[:120]))
    # pembatalan baru bertanggal hari ini mengganti jendela lama
    G = mk(h, nxt(), 'QRIS'); cancel(h, G['inv'], f"g1-{G['n']}", o)
    e = settle_ok(h, G, [{'method': 'QRIS', 'amount': G['total']}], f"gs-{G['n']}")
    err, res = cancel(h, G['inv'], f"g2-{G['n']}", None)
    check('terima ulang bertanggal asli lalu batal lagi TANPA tanggal: jendela lama sudah selesai, pembatalan baru bertanggal hari ini (tanpa jendela)', e is None and err is None and res['backdated'] is False and rep(h, G, t)['jurnal_n'] >= 1, dict(e=(e or '')[:160], err=(err or '')[:160]))
    # pembatalan bertanggal kedua menggantikan jendela
    Hh = mk(h, nxt(), 'QRIS'); cancel(h, Hh['inv'], f"h1-{Hh['n']}", o)
    e = settle_ok(h, Hh, [{'method': 'QRIS', 'amount': Hh['total']}], f"hs-{Hh['n']}")
    err, res = cancel(h, Hh['inv'], f"h2-{Hh['n']}", CTX['mid'])
    wn = json.loads(h.nilai(f"select to_jsonb(w) from public.clinic_backdate_windows w where invoice_id={q(Hh['inv'])}"))
    check('pembatalan kedua bertanggal lain: jendela baru memakai tanggal baru (satu baris per tagihan), batas bawah mengikuti penerimaan ulang', e is None and err is None and wn['effective_date'] == CTX['mid'] and wn['status'] == 'terbuka', dict(e=(e or '')[:160], err=(err or '')[:200]))
    # spill: nominal melebihi sisa pada tagihan bertanggal (ranap, kwitansi) -> ditolak, tidak jadi uang muka tanggal mundur
    R = bk.ranap(h, nxt(), 'none'); plant(h, R)
    # tagihan ranap yang belum dibayar tidak punya jendela; buat jendela lewat satu penerimaan lalu batal
    e0 = h.gagal(r.bayar_sql(R['v'], f"rs0-{R['n']}", [{'method': 'QRIS', 'amount': R['total']}], R['inv']), OWNER)
    err, res = cancel(h, R['inv'], f"rs-{R['n']}", o)
    st = bk.money_state(h)
    e2 = h.gagal(r.bayar_sql(R['v'], f"rs2-{R['n']}", [{'method': 'QRIS', 'amount': R['total'] + 5000}], R['inv']), OWNER)
    check('kelebihan nominal pada tagihan bertanggal efektif ditolak (BACKDATE_SISA), tidak ada uang muka tanggal mundur, tidak ada yang berubah', e0 is None and err is None and has(e2, 'BACKDATE_SISA') and bk.money_state(h) == st, dict(e0=(e0 or '')[:120], err=(err or '')[:120], e2=(e2 or '')[:200]))
    e3 = h.gagal(r.bayar_sql(R['v'], f"rs3-{R['n']}", [{'method': 'QRIS', 'amount': R['total']}], R['inv']), OWNER)
    rc = json.loads(h.nilai(f"select to_jsonb(r) from public.clinic_payment_receipts r where request_key={q(f'rs3-{R[chr(110)]}')}"))
    # ulang kunci yang sama sesudah jendela menutup: hasil lama, tidak bentrok
    e4 = h.gagal(r.bayar_sql(R['v'], f"rs3-{R['n']}", [{'method': 'QRIS', 'amount': R['total']}], R['inv']), OWNER)
    check('penerimaan ranap bertanggal asli; ulang kirim kunci SAMA sesudah jendela menutup (respons hilang) = hasil lama, tidak bentrok, satu kwitansi', e3 is None and e4 is None and str(rc['tanggal']) == o
          and h.angka(f"select count(*) from public.clinic_payment_receipts where request_key={q(f'rs3-{R[chr(110)]}')}") == 1 and h.nilai(f"select status from public.clinic_backdate_windows where invoice_id={q(R['inv'])}") == 'selesai', dict(e3=(e3 or '')[:160], e4=(e4 or '')[:160]))
    # kunci sama dengan isi lain pada kwitansi bertanggal efektif: tetap IDEMPOTENCY_CONFLICT
    e5 = h.gagal(r.bayar_sql(R['v'], f"rs3-{R['n']}", [{'method': 'Tunai', 'amount': R['total']}], R['inv']), OWNER)
    check('kunci sama dengan isi berbeda pada kwitansi bertanggal efektif: tetap IDEMPOTENCY_CONFLICT', has(e5, 'IDEMPOTENCY_CONFLICT'), dict(e5=(e5 or '')[:160]))
    # campur: dua tagihan tahap, satu bertanggal efektif dan satu tidak, satu kwitansi tanpa memilih tagihan
    n = nxt(); cust = r.buat_pelanggan(h, n); v = r.buat_kunjungan(h, n, cust)
    l1, l2 = bk.lines_for(n, 1), bk.lines_for(n, 2)
    h.sql(r.tagih_sql(v, f'k{n}-t1', l1, OWNER, alasan='Uji fiktif DP'), OWNER); inv1 = h.aktif(v)
    h.sql(r.tagih_sql(v, f'k{n}-t2', l2, OWNER, alasan='Uji fiktif DP'), OWNER)
    inv2 = h.nilai(f"select id from public.invoices where visit_id={q(v)} and id<>{q(inv1)} and voided_at is null")
    h.sql(r.bayar_sql(v, f'k{n}-pay1', [{'method': 'QRIS', 'amount': r.nilai_baris(l1)}], inv1), OWNER)
    plant(h, dict(inv=inv1, no=h.no_tagihan(inv1)))
    cancel(h, inv1, f"mx-{n}", o)
    st = bk.money_state(h)
    e6 = h.gagal(r.bayar_sql(v, f'k{n}-pay2', [{'method': 'QRIS', 'amount': r.nilai_baris(l1) + r.nilai_baris(l2)}], None), OWNER)
    check('dua tagihan berbeda tanggal efektif dalam satu kwitansi tanpa memilih tagihan: ditolak BACKDATE_CAMPUR (bukan tercampur diam-diam)', has(e6, 'BACKDATE_CAMPUR') and bk.money_state(h) == st, dict(e6=(e6 or '')[:200]))
    e7 = h.gagal(r.bayar_sql(v, f'k{n}-pay3', [{'method': 'QRIS', 'amount': r.nilai_baris(l1)}], inv1), OWNER)
    check('memilih tagihan bertanggal efektif itu saja: diterima bertanggal asli', e7 is None and h.status_bayar(inv1) == 'Lunas', dict(e7=(e7 or '')[:200]))


def sec_windows2(h):
    o, t = CTX['orig'], CTX['today']
    # M22: ulang kirim kunci penerimaan yang sudah bertanggal efektif, SESUDAH jendela menutup (Lunas): hasil lama, bukan konflik
    F = mk(h, nxt(), 'QRIS'); cancel(h, F['inv'], f"rp-{F['n']}", o)
    e1 = settle_ok(h, F, [{'method': 'QRIS', 'amount': F['total']}], f"rpk-{F['n']}")
    n1 = bk.money_state(h)
    e2 = settle_ok(h, F, [{'method': 'QRIS', 'amount': F['total']}], f"rpk-{F['n']}"); n1b = bk.money_state(h)
    # jalur langsung penerimaan (tanpa pembungkus): kunci sama diulang SESUDAH jendela menutup harus mengembalikan hasil lama
    G0 = mk(h, nxt(), 'QRIS'); cancel(h, G0['inv'], f"rq-{G0['n']}", o)
    # tanggal yang dikirim klien = HARI INI (bukan tanggal asli): kunci diulang harus tetap cocok dengan kwitansi bertanggal efektif yang tercatat
    pay0 = f"select public.clinic_receive_visit_payment({q(G0['v'])},{q(f'rqk-'+str(G0['n']))},{q(t)}::date,{j([{'method': 'QRIS', 'amount': G0['total']}])},{q(G0['inv'])}::uuid,null);"
    d1 = h.gagal(pay0, OWNER); n0 = bk.money_state(h); d2 = h.gagal(pay0, OWNER)
    check('penerimaan langsung: kunci sama diulang setelah jendela menutup = hasil lama (tanggal kwitansi tercatat dipakai), tidak konflik, tidak ada uang baru',
          d1 is None and d2 is None and bk.money_state(h) == n0 and h.status_bayar(G0['inv']) == 'Lunas' and h.nilai(f"select tanggal::text from public.clinic_payment_receipts where request_key={q(f'rqk-'+str(G0['n']))}") == o, dict(d1=(d1 or '')[:160], d2=(d2 or '')[:160]))
    check('ulang kirim kunci penerimaan bertanggal efektif setelah jendela menutup: hasil lama (idempoten), tidak konflik, tidak ada uang baru',
          e1 is None and e2 is None and h.status_bayar(F['inv']) == 'Lunas' and n1b == n1 and h.angka(f"select count(*) from public.clinic_backdate_windows where invoice_id={q(F['inv'])} and status='selesai'") == 1, dict(e1=(e1 or '')[:160], e2=(e2 or '')[:160]))
    # M17: pembatalan baru bertanggal HARI INI pada tagihan yang masih berjendela menggantikan jendela lama (status 'diganti'), penerimaan berikutnya bertanggal hari ini
    G = mk(h, nxt(), 'QRIS'); cancel(h, G['inv'], f"sg-{G['n']}", o)
    e3 = settle_ok(h, G, [{'method': 'QRIS', 'amount': 10000}], f"sgp-{G['n']}")
    e4, res4 = cancel(h, G['inv'], f"sg2-{G['n']}", None)
    st = json.loads(h.nilai(f"select coalesce(jsonb_agg(status order by opened_at),'[]') from public.clinic_backdate_windows where invoice_id={q(G['inv'])}"))
    rest = int(h.angka(f"select total from public.invoices where id={q(G['inv'])}"))
    e5 = settle_ok(h, G, [{'method': 'QRIS', 'amount': rest}], f"sgq-{G['n']}")
    d5 = h.nilai(f"select max(tanggal)::text from public.clinic_payment_receipts where visit_id={q(G['v'])} and status='aktif'")
    check('pembatalan baru bertanggal HARI INI menggantikan jendela lama (diganti, tidak ada yang terbuka); penerimaan berikutnya bertanggal hari ini',
          e3 is None and e4 is None and st == ['diganti'] and e5 is None and d5 == t and tb_dates(h) == 0, dict(e3=(e3 or '')[:100], e4=(e4 or '')[:100], st=st, e5=(e5 or '')[:120], d5=d5))
    # M03: pembacaan izin tanggal gagal (galat tak terduga di role_action_allowed disuntikkan di klon uji) = TIDAK boleh mundur (gagal tertutup)
    defn = h.sql("select pg_get_functiondef('public.role_action_allowed(text)'::regprocedure);")
    try:
        h.sql(f"insert into role_settings_private.action_policies(role,allowed) values ('FINANCE', array[{q(GRANT)},{q(GRANT_TGL)}]) on conflict (role) do update set allowed=excluded.allowed;")
        okv = h.nilai(f"select set_config('request.jwt.claims', json_build_object('sub',{q(FINANCE)},'role','authenticated')::text, false); select 'ok='||clinic_private.cancel_receipt_backdate_ok('GRANT');")
        h.sql("create or replace function public.role_action_allowed(p_action text) returns boolean language plpgsql as $f$ begin raise exception 'uji: pembacaan izin gagal'; end $f$;")
        bad = h.nilai(f"select set_config('request.jwt.claims', json_build_object('sub',{q(FINANCE)},'role','authenticated')::text, false); select 'ok='||clinic_private.cancel_receipt_backdate_ok('GRANT');")
        check('pembacaan izin tanggal gagal (galat tak terduga): TIDAK boleh mundur (gagal tertutup); dengan pembacaan normal peran berizin boleh', okv == 'ok=true' and bad == 'ok=false', dict(okv=okv, bad=bad))
    finally:
        h.sql(defn.strip().rstrip(';') + ';' if defn else 'select 1;')
        h.sql("delete from role_settings_private.action_policies where role in ('ADMIN','FINANCE');")


def sec_multi(h):
    o, t = CTX['orig'], CTX['today']
    n = nxt(); cust = r.buat_pelanggan(h, n); v = r.buat_kunjungan(h, n, cust)
    l1, l2 = bk.lines_for(n, 1), bk.lines_for(n, 2)
    h.sql(r.tagih_sql(v, f'k{n}-t1', l1, OWNER, alasan='Uji fiktif DP'), OWNER); inv1 = h.aktif(v)
    h.sql(r.tagih_sql(v, f'k{n}-t2', l2, OWNER, alasan='Uji fiktif DP'), OWNER)
    inv2 = h.nilai(f"select id from public.invoices where visit_id={q(v)} and id<>{q(inv1)} and voided_at is null")
    h.sql(r.bayar_sql(v, f'k{n}-pay', [{'method': 'QRIS', 'amount': r.nilai_baris(l1) + r.nilai_baris(l2)}], None), OWNER)
    err, res = cancel(h, inv1, f"mu-{n}", o)
    wins = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_object('i',invoice_id,'e',effective_date,'s',status)),'[]') from public.clinic_backdate_windows where invoice_id in ({q(inv1)},{q(inv2)})"))
    check('kwitansi yang melunasi dua tagihan dibatalkan bertanggal asli: KEDUA tagihan mendapat jendela tanggal efektif yang sama; keduanya Belum Lunas',
          err is None and len(wins) == 2 and all(w['e'] == o and w['s'] == 'terbuka' for w in wins) and h.status_bayar(inv1) == 'Belum Lunas' and h.status_bayar(inv2) == 'Belum Lunas' and tb_dates(h) == 0, dict(err=(err or '')[:200], wins=wins))
    e = h.gagal(r.bayar_sql(v, f'k{n}-pay2', [{'method': 'QRIS', 'amount': r.nilai_baris(l1) + r.nilai_baris(l2)}], None), OWNER)
    rc = json.loads(h.nilai(f"select to_jsonb(r) from public.clinic_payment_receipts r where request_key={q(f'k{n}-pay2')}")) if e is None else None
    check('terima ulang kedua tagihan dalam satu kwitansi (jendela sama): diterima bertanggal asli, kedua jendela selesai, tidak ada jurnal hari ini',
          e is None and rc and str(rc['tanggal']) == o and h.status_bayar(inv1) == 'Lunas' and h.status_bayar(inv2) == 'Lunas'
          and h.angka(f"select count(*) from public.clinic_backdate_windows where invoice_id in ({q(inv1)},{q(inv2)}) and status='selesai'") == 2
          and h.angka(f"select count(*) from public.journal_entries e where e.source_ref in ({q(h.no_tagihan(inv1))},{q(h.no_tagihan(inv2))}) and e.tanggal>{q(o)}") == 0, dict(e=(e or '')[:200]))
    # kasir (STAFF) menerima di tagihan yang berjendela: tanggal ikut jendela (keputusan Owner), uang di shift STAFF
    S = mk(h, nxt(), 'QRIS'); cancel(h, S['inv'], f"su-{S['n']}", o)
    e2 = settle_ok(h, S, [{'method': 'QRIS', 'amount': S['total']}], f"sus-{S['n']}", STAFF)
    rc2 = json.loads(h.nilai(f"select to_jsonb(r) from public.clinic_payment_receipts r where visit_id={q(S['v'])} and status='aktif' order by created_at desc limit 1")) if e2 is None else None
    check('kasir STAFF menerima di tagihan berjendela: kwitansi bertanggal efektif (keputusan Owner), uang masuk shift terbuka STAFF sendiri',
          e2 is None and rc2 and str(rc2['tanggal']) == o and rc2['shift_id'] == r.SHIFT[STAFF], dict(e2=(e2 or '')[:200], rc=rc2 and (rc2['tanggal'], rc2['shift_id'])))


def sec_shift(h):
    o, t = CTX['orig'], CTX['today']
    own = r.SHIFT[OWNER]
    # shift asal TUTUP: rekaman shift lama tidak berubah; tunai di shift Owner hari ini; tidak ganda
    F = mk(h, nxt(), 'Tunai', user=STAFF)
    set_shift(h, STAFF, 'closed')
    try:
        closed0 = h.nilai(f"select to_jsonb(s)::text from public.cashier_shifts s where id={q(r.SHIFT[STAFF])}")
        ex0 = cash_expected(h, own)
        err, res = cancel(h, F['inv'], f"sh-{F['n']}", o)
        ex1 = cash_expected(h, own)
        check('shift: tagihan Tunai dari shift STAFF yang sudah TUTUP dibatalkan bertanggal asli: efek laci di shift Owner HARI INI (shift_berjalan), pengurang tunai tepat satu kali, rekaman shift tertutup tidak berubah, jurnal di tanggal asli',
              err is None and res['shift_mode'] == 'shift_berjalan' and res['cancel_shift_id'] == own and ex1 == ex0 - F['total'] and closed0 == h.nilai(f"select to_jsonb(s)::text from public.cashier_shifts s where id={q(r.SHIFT[STAFF])}")
              and rep(h, F, t)['jurnal_n'] == 0 and rep(h, F, o)['bank'] == 0, dict(err=(err or '')[:200], ex0=str(ex0), ex1=str(ex1)))
        e1 = edit_to(h, F, f"she-{F['n']}", -20000); nt = int(h.angka(f"select total from public.invoices where id={q(F['inv'])}"))
        e2 = settle_ok(h, F, [{'method': 'Tunai', 'amount': nt}], f"shs-{F['n']}")
        ex2 = cash_expected(h, own)
        check('shift: terima ulang Tunai bertanggal asli masuk shift Owner hari ini: laci = awal - batal + terima ulang (tidak hilang, tidak ganda); jurnal kas di tanggal asli',
              e1 is None and e2 is None and ex2 == ex0 - F['total'] + nt and rep(h, F, o)['bank'] == nt and rep(h, F, t)['jurnal_n'] == 0 and h.nilai(f"select shift_id from public.clinic_payment_receipts where visit_id={q(F['v'])} and status='aktif'") == own,
              dict(e1=(e1 or '')[:160], e2=(e2 or '')[:160], ex0=str(ex0), ex2=str(ex2), nt=nt))
        # tutup shift basi ditolak (mitigasi F2) tetap bekerja pada pembatalan bertanggal
        G = mk(h, nxt(), 'Tunai', user=OWNER)
        stale = cash_expected(h, own); err, _ = cancel(h, G['inv'], f"shg-{G['n']}", o)
        fresh = cash_expected(h, own)
        out = h.gagal(f"update public.cashier_shifts set status='closed', closed_at=now(), closing_balance={stale}, expected_cash={stale}, selisih=0, closing_breakdown='{{\"Tunai\":{stale},\"Transfer\":0,\"Debit\":0,\"Kredit\":0,\"QRIS\":0,\"E-Wallet\":0}}' where id={q(own)} and status='open';", OWNER)
        still_open = h.nilai(f"select status from public.cashier_shifts where id={q(own)}")
        check('shift: tutup shift dengan angka basi (dibaca sebelum batal bertanggal Tunai) DITOLAK Hitung ulang, shift tetap terbuka (penjaga F2 utuh)', err is None and stale != fresh and has(out, 'Hitung ulang') and still_open == 'open', dict(err=(err or '')[:120], out=(out or '')[:160], stale=str(stale), fresh=str(fresh)))
        out2 = h.gagal(f"update public.cashier_shifts set status='closed', closed_at=now(), closing_balance={fresh}, expected_cash={fresh}, selisih=0, closing_breakdown='{{\"Tunai\":{fresh},\"Transfer\":0,\"Debit\":0,\"Kredit\":0,\"QRIS\":0,\"E-Wallet\":0}}' where id={q(own)} and status='open';", OWNER)
        check('shift: tutup shift dengan angka segar diterima', out2 is None and h.nilai(f"select status from public.cashier_shifts where id={q(own)}") == 'closed', dict(out2=(out2 or '')[:160]))
    finally:
        h.sistem(f"update public.cashier_shifts set status='open', closed_at=null where id in ({q(r.SHIFT[STAFF])},{q(own)});")
    # Owner tanpa shift terbuka: tetap boleh bertanggal mundur (tanpa_shift)
    H = mk(h, nxt(), 'Tunai', user=ADMIN)
    set_shift(h, ADMIN, 'closed'); set_shift(h, OWNER, 'closed')
    try:
        err, res = cancel(h, H['inv'], f"shn-{H['n']}", o)
        check('shift: Owner TANPA shift terbuka tetap bisa membatalkan bertanggal asli (tidak terkunci); ditandai tanpa_shift', err is None and res['shift_mode'] == 'tanpa_shift' and res['cancel_shift_id'] is None and rep(h, H, o)['bank'] == 0, dict(err=(err or '')[:200]))
    finally:
        set_shift(h, ADMIN, 'open'); set_shift(h, OWNER, 'open')


def sec_idem(h):
    o = CTX['orig']
    F = mk(h, nxt(), 'QRIS')
    err, res = cancel(h, F['inv'], f"id-{F['n']}", o)
    n0 = bk.money_state(h)
    err2, res2 = cancel(h, F['inv'], f"id-{F['n']}", o)
    check('idempoten: ulang kirim kunci + tanggal yang sama mengembalikan hasil lama, tidak membalik dua kali', err is None and err2 is None and res2 == res and bk.money_state(h) == n0, dict(err=(err or '')[:120], err2=(err2 or '')[:120]))
    err3, _ = cancel(h, F['inv'], f"id-{F['n']}", CTX['mid'])
    check('idempoten: kunci sama dengan tanggal BERBEDA = IDEMPOTENCY_CONFLICT (tanggal ikut sidik)', has(err3, 'IDEMPOTENCY_CONFLICT'), dict(err=(err3 or '')[:160]))
    err4, _ = cancel(h, F['inv'], f"id-{F['n']}", None)
    check('idempoten: kunci sama tanpa tanggal setelah memakai tanggal = IDEMPOTENCY_CONFLICT', has(err4, 'IDEMPOTENCY_CONFLICT'), dict(err=(err4 or '')[:160]))
    G = mk(h, nxt(), 'QRIS')
    e, r1 = cancel(h, G['inv'], f"idn-{G['n']}", None)
    e2, r2 = cancel(h, G['inv'], f"idn-{G['n']}", None)
    check('idempoten: tanpa tanggal, ulang kirim kunci sama = hasil lama (sidik sama persis dengan versi lama)', e is None and e2 is None and r1 == r2, dict(e=(e or '')[:100]))
    aud = json.loads(h.nilai(f"select jsonb_build_object('n',count(*),'eff',min(effective_date)::text,'tanggal',min(tanggal)::text) from public.clinic_receipt_cancellations where invoice_id={q(F['inv'])}"))
    check('audit: tepat satu baris per pembatalan, tanggal efektif tersimpan', aud['n'] == 1 and aud['eff'] == o, aud)
    e1 = h.gagal("delete from public.clinic_backdate_windows;"); e2 = h.gagal("truncate public.clinic_backdate_windows;"); e3 = h.gagal("update public.clinic_backdate_receipts set actual_date=actual_date;")
    e4 = h.gagal("delete from public.clinic_backdate_receipts;"); e5 = h.gagal("truncate public.clinic_backdate_receipts;"); e6 = h.gagal("update public.clinic_receipt_cancellations set effective_date=null;")
    check('jejak tanggal efektif: hapus/kosongkan jendela, ubah/hapus/kosongkan catatan kwitansi, ubah jejak batal = AUDIT_IMMUTABLE', all(has(e, 'AUDIT_IMMUTABLE') for e in (e1, e2, e3, e4, e5, e6)), dict(e=[(z or '')[:60] for z in (e1, e2, e3, e4, e5, e6)]))
    e7 = h.gagal("update public.clinic_backdate_windows set invoice_id=gen_random_uuid();")
    check('jendela: invoice_id/cabang tidak bisa dipindahkan', bool(e7), dict(e=(e7 or '')[:100]))
    seen = h.gagal("set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub'," + q(STAFF) + ",false); update public.clinic_backdate_windows set status='terbuka';")
    seen2 = h.gagal("set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub'," + q(OWNER) + ",false); insert into public.clinic_backdate_receipts(receipt_id,branch_id,effective_date,actual_date,created_by) values (gen_random_uuid(),gen_random_uuid(),current_date,current_date,gen_random_uuid());")
    check('akun aplikasi (bahkan Owner) tidak bisa menulis langsung ke tabel jendela/kwitansi tanggal efektif', bool(seen) and bool(seen2), dict(a=(seen or '')[:80], b=(seen2 or '')[:80]))


def sec_finance(h):
    o = CTX['orig']; t = CTX['today']
    F = mk(h, nxt(), 'QRIS'); cancel(h, F['inv'], f"fn-{F['n']}", o)
    edit_to(h, F, f"fne-{F['n']}", -20000); nt = int(h.angka(f"select total from public.invoices where id={q(F['inv'])}"))
    settle_ok(h, F, [{'method': 'QRIS', 'amount': nt}], f"fns-{F['n']}")
    try: rows = json.loads(h.nilai(f"select public.clinic_backdated_entries({q(o)},{q(t)},null);", FINANCE))
    except RuntimeError as e: rows = str(e)
    mine = [z for z in rows if z['ref'] == F['no']] if isinstance(rows, list) else []
    check('Finance: daftar jurnal klinik bertanggal mundur menunjukkan tanggal jurnal DAN waktu catat sebenarnya untuk jurnal batal/koreksi/terima ulang (dan hanya itu untuk tagihan ini)',
          len(mine) >= 4 and all(z['tanggal'] == o and z['dicatat_pada'][:10] >= o for z in mine) and any(z['rekening'] and '120002' in z['rekening'] for z in mine), dict(n=len(mine), sample=mine[:1]))
    other = [z for z in rows if z['ref'] not in (F['no'],)] if isinstance(rows, list) else []
    check('Finance: jurnal tagihan fixture yang dicatat pada harinya (tidak mundur) tidak muncul di daftar', all(z['dicatat_pada'][:10] > z['tanggal'] for z in (rows if isinstance(rows, list) else [])), dict(n=len(other)))
    try: j2 = h.gagal(f"select public.clinic_backdated_entries({q(o)},{q(t)},null);", STAFF)
    except Exception as e: j2 = str(e)
    check('Finance: STAFF ditolak', has(j2, 'ACCESS_DENIED'), dict(e=(j2 or '')[:100]))
    j3 = h.gagal(f"select public.clinic_backdated_entries({q(t)},{q(o)},null);", FINANCE); j4 = h.gagal(f"select public.clinic_backdated_entries('2020-01-01','2026-01-01',null);", OWNER)
    check('Finance: rentang terbalik atau > 1 tahun ditolak', has(j3, 'RANGE_INVALID') and has(j4, 'RANGE_INVALID'), dict(a=(j3 or '')[:60], b=(j4 or '')[:60]))
    j5 = h.gagal(f"select public.clinic_backdated_entries({q(o)},{q(t)},null);", r.FIN_LUAR)
    rows5 = []
    if j5 is None: rows5 = json.loads(h.nilai(f"select public.clinic_backdated_entries({q(o)},{q(t)},null);", r.FIN_LUAR))
    check('Finance cabang lain tidak melihat jurnal cabang ini', not [z for z in rows5 if z['ref'] == F['no']], dict(j5=(j5 or '')[:80], n=len(rows5)))


def sec_race(h, db):
    o = CTX['orig']

    def session(name, user):
        s = c.Session(db, name); s.sql(x.claims(user)); return s
    # penerimaan ulang menunggu pembatalan bertanggal yang sedang berjalan, lalu memakai tanggal efektif (jendela baru terlihat sesudah komit)
    F = mk(h, nxt(), 'QRIS')
    cs = f"select public.{RPC}({q(F['inv'])},'race-bd','Alasan balapan yang cukup',{q(o)}::date);"
    # tagihan Lunas: penerimaan tidak mungkin; balapan bermakna = dua pembatalan bertanggal berbeda kunci
    with c.Session(db, 'obs') as obs, session('a', OWNER) as a, session('b', OWNER) as b:
        a.sql('begin;' + cs); b.send(f"select public.{RPC}({q(F['inv'])},'race-bd2','Alasan balapan yang cukup',{q(o)}::date);")
        wait = blocked(obs, b); a.sql('commit;'); res = c.attempt(b, commit=False)
    check('balapan: dua pembatalan bertanggal pada tagihan sama: yang kedua MENUNGGU lalu ditolak BELUM_ADA_PENERIMAAN; tepat satu efek, satu jendela',
          wait.endswith('advisory') and not res['ok'] and 'BELUM_ADA_PENERIMAAN' in res.get('error', '') and bk.audit_rows(h, F['inv']) == 1 and h.angka(f"select count(*) from public.clinic_backdate_windows where invoice_id={q(F['inv'])}") == 1 and tb_dates(h) == 0, dict(wait=wait, res=str(res)[:200]))
    # koreksi/terima ulang menunggu pembatalan bertanggal yang SEDANG berjalan pada tagihan ranap: pembatalan menang, penerimaan berikutnya bertanggal asli
    R = bk.ranap(h, nxt(), 'qris'); plant(h, R)
    cs2 = f"select public.{RPC}({q(R['inv'])},'race-bd3','Alasan balapan yang cukup',{q(o)}::date);"
    pay = r.bayar_sql(R['v'], 'race-pay', [{'method': 'QRIS', 'amount': R['total']}], R['inv'])
    with c.Session(db, 'obs2') as obs, session('c', OWNER) as a, session('d', OWNER) as b:
        a.sql('begin;' + cs2); b.send(pay)
        wait2 = blocked(obs, b); a.sql('commit;'); res2 = c.attempt(b, commit=False)
    rc = h.nilai(f"select tanggal::text from public.clinic_payment_receipts where request_key='race-pay'")
    check('balapan: penerimaan ulang yang menunggu pembatalan bertanggal berjalan MENUNGGU (koordinator), lalu melihat jendela dan dibukukan di tanggal asli; Lunas, neraca nol per tanggal',
          wait2.endswith('advisory') and res2['ok'] and rc == o and h.status_bayar(R['inv']) == 'Lunas' and tb_dates(h) == 0, dict(wait=wait2, res=str(res2)[:200], rc=rc))


SECTIONS = ['preflight', 'core', 'methods', 'dp_split', 'ranap', 'dates', 'period', 'windows', 'windows2', 'multi', 'shift', 'idem', 'finance', 'race', 'static']


def sec_static(h):
    text = (MIG / CANDIDATE).read_text() if (MIG / CANDIDATE).exists() else ''
    check('statik: migrasi tanpa begin/commit sendiri (aman dibungkus transaksi pemasangan)', text != '' and not any(l.strip().lower() in ('begin;', 'commit;') for l in text.splitlines()), {})
    pub = json.loads(h.nilai("select coalesce(jsonb_agg(jsonb_build_object('f',p.oid::regprocedure::text,'sec',p.prosecdef,'cfg',p.proconfig,'anon',has_function_privilege('anon',p.oid,'execute'),'auth',has_function_privilege('authenticated',p.oid,'execute'),'svc',has_function_privilege('service_role',p.oid,'execute'))),'[]') "
                             "from pg_proc p where p.proname in ('clinic_cancel_invoice_receipt','clinic_cancel_invoice_receipt_preview','clinic_backdate_release','clinic_backdated_entries','clinic_cancel_receipt_allowed')"))
    check('ACL: RPC publik (batal, pratinjau, lepas, daftar Finance, boleh) hanya authenticated; definer + search_path kosong; TIDAK ada overload ganda (3 arg lama sudah diganti)',
          len(pub) == 5 and all(f['sec'] and f['auth'] and not f['anon'] and not f['svc'] and 'search_path=""' in ' '.join(f['cfg'] or []) for f in pub) and sum('clinic_cancel_invoice_receipt(' in f['f'] for f in pub) == 1, dict(pub=pub))
    priv = json.loads(h.nilai("select coalesce(jsonb_agg(jsonb_build_object('f',p.proname,'auth',has_function_privilege('authenticated',p.oid,'execute'),'anon',has_function_privilege('anon',p.oid,'execute'))),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                              "where n.nspname='clinic_private' and p.proname in ('backdate_date','backdate_paid_at','backdate_receipt_date','backdate_window_close','backdate_assert_open','cancel_receipt_backdate_ok','cancel_receipt_orig_date','cancel_receipt_date_check','backdate_tables_guard','backdate_receipts_guard')"))
    check('ACL: fungsi privat tanggal efektif tanpa hak aplikasi (10 fungsi)', len(priv) == 10 and all(not f['auth'] and not f['anon'] for f in priv), dict(n=len(priv)))
    tab = json.loads(h.nilai("select jsonb_build_object('w_sel',has_table_privilege('authenticated','public.clinic_backdate_windows','select'),'w_ins',has_table_privilege('authenticated','public.clinic_backdate_windows','insert'),'w_upd',has_table_privilege('authenticated','public.clinic_backdate_windows','update'),"
                             "'r_sel',has_table_privilege('authenticated','public.clinic_backdate_receipts','select'),'r_ins',has_table_privilege('authenticated','public.clinic_backdate_receipts','insert'),'anon',has_table_privilege('anon','public.clinic_backdate_windows','select') or has_table_privilege('anon','public.clinic_backdate_receipts','select'),"
                             "'rls',(select bool_and(relrowsecurity) from pg_class where oid in ('public.clinic_backdate_windows'::regclass,'public.clinic_backdate_receipts'::regclass)))"))
    check('ACL tabel: authenticated hanya SELECT (RLS aktif per cabang), tanpa INSERT/UPDATE; anon tidak', tab == dict(w_sel=True, w_ins=False, w_upd=False, r_sel=True, r_ins=False, anon=False, rls=True), tab)
    # cabang lain tidak membaca jendela
    own_rows = int(h.angka("select count(*) from public.clinic_backdate_windows"))
    cross = h.nilai("set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub'," + q(r.FIN_LUAR) + ",false); select count(*) from public.clinic_backdate_windows;")
    check('RLS: akun cabang lain tidak melihat jendela tanggal efektif cabang ini', own_rows > 0 and str(cross).strip().splitlines()[-1] == '0', dict(own=own_rows, cross=str(cross)[-20:]))
    check('fungsi lama yang ditambal tetap definer + search_path kosong + pemilik/ACL sama (clinic_edit_invoice_core, clinic_receive_visit_payment, sync_paid_status)',
          h.angka("select count(*) from pg_proc p where p.proname in ('clinic_edit_invoice_core','clinic_receive_visit_payment','sync_paid_status') and p.prosecdef and 'search_path=\"\"' = any(p.proconfig) and not has_function_privilege('anon',p.oid,'execute')") == 3, {})
    check('pencatatan: fungsi baru memuat tanda BACKDATE_KLINIK di 3 fungsi lama', h.angka("select count(*) from pg_proc where proname in ('clinic_edit_invoice_core','clinic_receive_visit_payment','sync_paid_status') and prosrc like '%BACKDATE_KLINIK%'") == 3, {})


def run(h, db, setup=True, baseline=False, sections=None):
    if setup: x.setup(h)
    setup_dates(h)
    want = [s for s in SECTIONS if (sections is None or s in sections)]
    fns = dict(preflight=sec_preflight, core=sec_core, methods=sec_methods, dp_split=sec_dp_split, ranap=sec_ranap, dates=sec_dates, period=sec_period, windows=sec_windows, windows2=sec_windows2, multi=sec_multi, shift=sec_shift, idem=sec_idem, finance=sec_finance, static=sec_static)
    for s in want:
        print('=== section', s, flush=True)
        try:
            if s == 'race': sec_race(h, db)
            else: fns[s](h)
        except Exception as e:
            check(f'SECTION {s} aborted', False, str(e).strip()[:400])


def build_chain(db, exclude): okr.build(db, exclude)
def apply_candidate(db, text): db.sql('begin;\n' + text + '\ncommit;')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin'); ap.add_argument('--attach')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--sections'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--only'); a = ap.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    SEC = set(a.sections.split(',')) if a.sections else None
    extra = {}
    try:
        if a.attach:
            with okr.Attached(r.BIN, a.attach) as db:
                name = 'bd_dev_%d' % int(time.time()); db.sql(f'create database {name} template postgres;'); os.environ['PGDATABASE'] = name
                if not a.baseline: apply_candidate(db, (MIG / CANDIDATE).read_text())
                run(x.Harness(db), db, setup=False, baseline=a.baseline, sections=SEC)
        elif a.mutations:
            from importlib.machinery import SourceFileLoader
            mut = SourceFileLoader('mut', str(ROOT / 'scripts/test-backdate-klinik-mutants.py')).load_module()
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
