#!/usr/bin/env python3
"""B3 (meeting 12 Nov 2026, keputusan A): jurnal pembatalan struk petshop (cancel_posted_sale) dan void & terbit ulang nota klinik
(clinic_void_reissue_invoice_core + koreksi nota penggantinya) dibukukan di TANGGAL TRANSAKSI ASLI; stok & HPP tetap hari ini.
Migrasi 20261118610000_b3_jurnal_batal_tanggal_asli.sql.

Native throwaway PostgreSQL only (full migration chain, fictional fixtures). Never accepts a database URL, no network.

  mkdir -p /opt/data && python3 -I scripts/test-b3-jurnal-batal-tanggal-asli-postgres.py [--pg-bin DIR] [--json out.json] [--baseline]
  (default)   chain without candidate -> fixtures -> candidate -> behaviour checks.
  --baseline  same fixtures WITHOUT the candidate: every feature case must FAIL (RED); regression/static cases must PASS.
"""
import argparse, importlib.util, json, os, sys
from decimal import Decimal
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('bk', ROOT / 'scripts/test-batalkan-penerimaan-klinik-postgres.py'); assert spec and spec.loader
bk = importlib.util.module_from_spec(spec); spec.loader.exec_module(bk)
okr, x, r, q, j = bk.okr, bk.x, bk.r, bk.q, bk.j
CANDIDATE = ROOT / 'supabase/migrations/20261118610000_b3_jurnal_batal_tanggal_asli.sql'
RESULTS = []
CTX = {}
NEXT = [8100]

U = lambda n: f"b3000000-0000-4000-8000-{n:012d}"
PO, PC, PB, PW, PI, PS, KAS, BANK = (U(i) for i in range(1, 9))


def check(name, ok, detail=None, kind='feature'):
    RESULTS.append(dict(case=name, kind=kind, status='PASS' if ok else 'FAIL', detail=detail))
    print(RESULTS[-1]['status'], f'[{kind}]', name, json.dumps(detail, default=str)[:400], flush=True)


def nxt():
    NEXT[0] += 3; return NEXT[0]


def err_of(h, sql, user):
    try: h.sql(sql, user); return None
    except RuntimeError as e: return str(e)


def D(v): return Decimal(str(v))


# ------------------------------------------------------------------ fixtures
def setup_dates(h):
    CTX['today'] = h.nilai("select (now() at time zone 'Asia/Jakarta')::date::text")   # hari ini WIB (petshop)
    CTX['dbtoday'] = h.nilai("select current_date::text")                              # current_date (jurnal klinik 'hari ini')
    for k, back in (('orig', 3), ('e1', 2), ('e2', 1)):
        CTX[k] = h.nilai(f"select ((now() at time zone 'Asia/Jakarta')::date - {back})::text")


def petshop_fixture(h):
    o = CTX['orig']
    h.sql(f"""
insert into auth.users(id,raw_user_meta_data) values ({q(PO)},'{{"full_name":"B3 owner fiktif"}}'),({q(PC)},'{{"full_name":"B3 kasir fiktif"}}');
update public.profiles set role='OWNER',is_active=true where id={q(PO)};
update public.profiles set role='STAFF',is_active=true where id={q(PC)};
insert into public.role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into public.branches(id,code,name,type) values({q(PB)},'B3PS','B3 petshop fiktif','PETSHOP');
insert into public.user_branches(user_id,branch_id) values({q(PO)},{q(PB)}),({q(PC)},{q(PB)});
insert into public.warehouses(id,branch_id,code,name,type) values({q(PW)},{q(PB)},'B3WH','B3 gudang fiktif','RETAIL');
insert into public.items(id,code,name,unit,item_type,buy_price,sell_price) values({q(PI)},'B3GOOD','B3 barang fiktif','pcs','Persediaan',3000,50000);
insert into public.stock(warehouse_id,item_id,qty) values({q(PW)},{q(PI)},1000);
insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source) values({q(PW)},{q(PI)},{q(o)}::date-30,1000,1000,3000,'manual');
insert into public.coa_accounts(code,name,type,normal_balance,is_header) values
 ('1111','B3 kas fiktif','ASET','D',false),('1112','B3 bank fiktif','ASET','D',false),('150001','Piutang Usaha','ASET','D',false),
 ('510001','Pendapatan fiktif','PENDAPATAN','K',false),('520002','Diskon','PENDAPATAN','D',false),('312005','PPN','LIABILITAS','K',false),
 ('600001','HPP','BEBAN','D',false),('170001','Persediaan','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into public.cash_accounts(id,nama,jenis,coa_code) values({q(KAS)},'B3 kas fiktif','Kas','1111'),({q(BANK)},'B3 bank fiktif','Bank','1112');
insert into public.payment_account_map(metode,branch_id,cash_account_id) values('Tunai',{q(PB)},{q(KAS)}),('Transfer',{q(PB)},{q(BANK)}) on conflict do nothing;
insert into public.cashier_shifts(id,branch_id,opened_by,shift_type) values({q(PS)},{q(PB)},{q(PC)},'petshop');
update public.accounting_locks set closed_until=null;
update public.company_settings set mode_pkp=false,ppn_rate=11;
""")


def sale(h, ref, method='Tunai', day=None):
    """Struk kasir 2 pcs x 50.000 (barang ber-stok, HPP 2 x 3.000). day = tanggal struk (None = hari ini)."""
    sid = h.nilai("select gen_random_uuid()")
    plan = json.dumps([dict(method=method, amount=100000)])
    h.sistem(f"""
insert into public.sales(id,branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values({q(sid)},{q(PB)},{q(ref)},100000,0,100000,{q(method)},100000,0,{q(PC)},{q(PS)},{q(plan)}::jsonb,{q('k:' + ref)},repeat('a',64));
insert into public.sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp)
 select {q(sid)},{q(PI)},'Barang fiktif',2,50000,'pcs',1,(select cost from public.sale_stock_out_fifo({q(PW)},{q(PI)},2,'sale',{q(ref)}));
select public.finalize_pos_sale({q(sid)});""", PC)
    if day:
        h.sql(f"""set session_replication_role=replica;
update public.sales set created_at=({q(day)}::date + time '12:00') at time zone 'Asia/Jakarta' where id={q(sid)};
update public.journal_entries set tanggal={q(day)} where source_ref={q(ref)} and source in('sale','sale-hpp');
update public.stock_moves set tanggal={q(day)} where source_ref={q(ref)};""")
    return sid


def rev(h, sid): return int(h.angka(f"select revision from public.sales where id={q(sid)}"))


def cancel_sale(h, sid, key):
    return err_of(h, f"select public.cancel_posted_sale({q(sid)},{rev(h, sid)},{q(key)},'Salah input barang (uji B3)');", PO)


def sale_entries(sid):
    return (f"select e.* from public.journal_entries e join public.sales s on s.id={q(sid)} where e.source_ref=s.no_struk "
            f"or e.source_ref in (select id::text from public.sale_cancellations where sale_id={q(sid)}) "
            f"or e.source_ref in (select id::text from public.pos_receipt_cancellations where sale_id={q(sid)})")


def by_date(h, entries):
    """{tanggal: {akun: saldo D-K}} untuk rantai jurnal transaksi ini (akun bersaldo nol dibuang)."""
    rows = json.loads(h.nilai("select coalesce(jsonb_object_agg(t, a),'{}') from (select t, jsonb_object_agg(code, v) a from ("
                              "select e.tanggal::text t, c.code, sum(l.debit-l.credit) v from (" + entries + ") e "
                              "join public.journal_lines l on l.entry_id=e.id join public.coa_accounts c on c.id=l.account_id "
                              "group by 1,2 having sum(l.debit-l.credit)<>0) z group by t) y"))
    return {d: {k: D(v) for k, v in a.items()} for d, a in rows.items()}


def sources(h, entries):
    return json.loads(h.nilai("select coalesce(jsonb_agg(jsonb_build_object('s',source,'t',tanggal::text) order by source,tanggal),'[]') from (" + entries + ") e"))


def tb_dates(h):
    return int(h.angka("select count(*) from (select e.branch_id,e.tanggal from public.journal_entries e join public.journal_lines l on l.entry_id=e.id group by 1,2 having sum(l.debit-l.credit)<>0) z"))


# ------------------------------------------------------------------ petshop
def sec_petshop(h):
    o, t = CTX['orig'], CTX['today']
    HPP = {'600001': D(6000), '170001': D(-6000)}
    # 1. batal keesokan hari: pendapatan/kas dibalik di tanggal struk; stok & HPP hari ini
    sid = sale(h, 'B3-POS-0001', 'Tunai', o)
    e = cancel_sale(h, sid, 'b3-p1')
    m = by_date(h, sale_entries(sid)); src = sources(h, sale_entries(sid))
    void = [z for z in src if z['s'] == 'sale-void']; vhpp = [z for z in src if z['s'] == 'sale-void-hpp']
    check('petshop: batal struk 3 hari lalu berhasil', e is None, (e or '')[:300], 'regression')
    check('petshop: jurnal pembalik pendapatan (sale-void) bertanggal struk asli, bukan hari ini',
          e is None and len(void) == 1 and void[0]['t'] == o, src)
    check('petshop: tanggal struk asli bersih (pendapatan & kas nol), hanya HPP asli yang tersisa; hari ini hanya pembalik HPP',
          e is None and m.get(o) == HPP and m.get(t) == {k: -v for k, v in HPP.items()}, m)
    mv = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_object('t',m.tanggal::text,'q',m.qty)),'[]') from public.stock_moves m "
                            f"where m.source='sale-void' and m.source_ref in (select id::text from public.sale_cancellations where sale_id={q(sid)})"))
    check('petshop: stok kembali HARI INI (mutasi sale-void bertanggal hari ini) dan jurnal HPP pembalik hari ini',
          e is None and mv == [{'t': t, 'q': 2}] and len(vhpp) == 1 and vhpp[0]['t'] == t, dict(mv=mv, vhpp=vhpp), 'regression')
    check('petshop: neraca saldo nol per cabang per tanggal', tb_dates(h) == 0, {}, 'regression')

    # 2. hari yang sama: perilaku lama persis (semua hari ini)
    sid = sale(h, 'B3-POS-0002', 'Tunai')
    e = cancel_sale(h, sid, 'b3-p2'); src = sources(h, sale_entries(sid))
    check('petshop: batal di hari yang sama tetap seperti dulu (semua jurnal & stok hari ini, struk bersih)',
          e is None and all(z['t'] == t for z in src) and by_date(h, sale_entries(sid)) == {}, dict(e=(e or '')[:200], src=src), 'regression')

    # 3. pasangan batal penerimaan (E1) + terima ulang (E2): dibalik di tanggal masing-masing
    e1, e2 = CTX['e1'], CTX['e2']
    sid = sale(h, 'B3-POS-0003', 'Tunai', o)
    ea = err_of(h, f"select public.cancel_pos_sale_receipt({q(sid)},{rev(h, sid)},'b3-rc','Uang dikembalikan (uji B3)',{q(e1)}::date);", PO)
    eb = err_of(h, f"select public.receive_pos_sale_payment({q(sid)},{rev(h, sid)},'b3-rr','[{{\"method\":\"Transfer\",\"amount\":100000}}]'::jsonb,{q(e2)}::date,'Dibayar ulang (uji B3)');", PO)
    pre = sources(h, sale_entries(sid))
    e = cancel_sale(h, sid, 'b3-p3')
    m = by_date(h, sale_entries(sid)); src = sources(h, sale_entries(sid))
    vr = sorted(z['t'] for z in src if z['s'] == 'sale-void-receipt')
    check('petshop: penyiapan batal penerimaan (tanggal efektif) + terima ulang (tanggal efektif) berhasil',
          ea is None and eb is None and {z['s'] for z in pre} >= {'sale-receipt-cancel', 'sale-receipt-repost'}, dict(ea=(ea or '')[:200], eb=(eb or '')[:200], pre=pre), 'regression')
    check('petshop: batal struk berpasangan batal/terima ulang penerimaan: tiap pembalik penerimaan di tanggal efektifnya sendiri',
          e is None and vr == sorted([e1, e2]), dict(e=(e or '')[:200], src=src))
    check('petshop: tanggal struk, tanggal batal penerimaan dan tanggal terima ulang semuanya bersih; hari ini hanya pembalik HPP',
          e is None and m.get(o) == HPP and e1 not in m and e2 not in m and m.get(t) == {k: -v for k, v in HPP.items()} and tb_dates(h) == 0, m)

    # 4. periode tertutup pada tanggal struk -> ditolak (pagar lama, tanggal struk)
    sid = sale(h, 'B3-POS-0004', 'Tunai', o)
    h.sql(f"update public.accounting_locks set closed_until={q(o)};")
    e = cancel_sale(h, sid, 'b3-p4')
    h.sql("update public.accounting_locks set closed_until=null;")
    check('petshop: periode tanggal struk sudah ditutup -> ditolak dengan pesan, struk tetap aktif',
          bool(e) and 'sudah ditutup' in e and h.nilai(f"select voided_at is null from public.sales where id={q(sid)}") == 't', (e or '')[:300], 'regression')

    # 5. rekonsiliasi bank sesudah tanggal struk pada rekening bank struk -> ditolak (baru: sebelumnya pembalik hari ini lolos)
    sid = sale(h, 'B3-POS-0005', 'Transfer', o)
    h.sql(f"set session_replication_role=replica; insert into public.bank_reconciliations(id,tanggal,cash_account_id) values({q(U(90))},{q(e1)},{q(BANK)});")
    e = cancel_sale(h, sid, 'b3-p5')
    still = h.nilai(f"select voided_at is null from public.sales where id={q(sid)}")
    check('petshop: rekonsiliasi bank (tanggal sesudah struk) pada rekening struk -> ditolak dengan pesan rekonsiliasi, struk tetap aktif',
          bool(e) and 'Rekonsiliasi bank sudah mencakup tanggal transaksi asli' in e and still == 't', (e or '')[:300])
    h.sql(f"set session_replication_role=replica; update public.bank_reconciliations set voided_at=now() where id={q(U(90))};")
    e = cancel_sale(h, sid, 'b3-p5b') if still == 't' else None
    check('petshop: rekonsiliasi dibatalkan -> pembatalan struk lolos (struk akhirnya batal)',
          e is None and h.nilai(f"select voided_at is not null from public.sales where id={q(sid)}") == 't', (e or '')[:300], 'regression')
    # rekonsiliasi rekening LAIN (kas) tidak menghalangi struk Transfer
    sid = sale(h, 'B3-POS-0006', 'Transfer', o)
    h.sql(f"set session_replication_role=replica; insert into public.bank_reconciliations(id,tanggal,cash_account_id) values({q(U(91))},{q(e1)},{q(KAS)});")
    e = cancel_sale(h, sid, 'b3-p6')
    h.sql(f"set session_replication_role=replica; update public.bank_reconciliations set voided_at=now() where id={q(U(91))};")
    check('petshop: rekonsiliasi pada rekening lain tidak menghalangi', e is None, (e or '')[:300], 'regression')

    # 6. penggajian bulan tanggal struk sudah dibuat -> ditolak (pagar lama)
    sid = sale(h, 'B3-POS-0007', 'Tunai', o)
    h.sql(f"set session_replication_role=replica; insert into public.payrolls(periode,employee_id) values(to_char({q(o)}::date,'YYYY-MM'),{q(r.DOKTER_PEGAWAI)});")
    e = cancel_sale(h, sid, 'b3-p7')
    h.sql(f"set session_replication_role=replica; delete from public.payrolls where periode=to_char({q(o)}::date,'YYYY-MM');")
    check('petshop: penggajian bulan tanggal struk sudah dibuat -> ditolak', bool(e) and 'Penggajian periode penjualan sudah dibuat' in e, (e or '')[:300], 'regression')


# ------------------------------------------------------------------ klinik
def klinik_invoice(h, day):
    r.TGL = day
    F = bk.rj(h, nxt(), 'Tunai', 'Lunas', slots=(1, 3))
    if day != CTX['today']:
        ts = f"({q(day)}::date + time '12:00') at time zone 'Asia/Jakarta'"
        h.sql(f"""set session_replication_role=replica;
update public.invoices set created_at={ts}, paid_at=case when paid_status='Lunas' then {ts} else paid_at end where id={q(F['inv'])};
update public.journal_entries set created_at={ts} where source_ref={q(F['no'])};""")
    return F


def reissue(h, F, key):
    try: return None, h.nilai(r.terbit_ulang_sql(F['inv'], key), r.OWNER)
    except RuntimeError as e: return str(e), None


def inv_entries(*nos):
    return "select e.* from public.journal_entries e where e.source_ref in (" + ",".join(q(n) for n in nos) + ") and e.source like 'klinik%'"


def revenue(m, day):
    a = m.get(day, {})
    return -(a.get('510002', D(0)) + a.get('520002', D(0)))


def sec_klinik(h):
    o, t = CTX['orig'], CTX['dbtoday']
    # 1. void & terbit ulang nota 3 hari lalu
    F = klinik_invoice(h, o); T0 = D(F['total'])
    e, new = reissue(h, F, f"b3-k1-{F['n']}")
    nno = h.no_tagihan(new) if new else None
    src = sources(h, inv_entries(F['no'], nno or '-'))
    get = lambda s: sorted(z['t'] for z in src if z['s'] == s)
    check('klinik: void & terbit ulang nota 3 hari lalu berhasil, nota pengganti tetap di tanggal asli',
          e is None and h.nilai(f"select (created_at at time zone 'Asia/Jakarta')::date::text from public.invoices where id={q(new)}") == o, (e or '')[:300], 'regression')
    check('klinik: jurnal batal (klinik-void) dan jurnal terbit ulang (klinik-reissue) bertanggal nota asli',
          e is None and get('klinik-void') == [o] and get('klinik-reissue') == [o], src)
    check('klinik: pasangan HPP (batal HPP + HPP terbit ulang) tetap sepasang di hari ini (stok tidak bergerak)',
          e is None and get('klinik-hpp-void') == [t] and get('klinik-hpp') == sorted([o, t]), src, 'regression')
    m = by_date(h, inv_entries(F['no'], nno or '-'))
    check('klinik: pendapatan tanggal asli tetap = nilai nota; hari ini tidak ada pendapatan/piutang (HPP saling meniadakan)',
          e is None and revenue(m, o) == T0 and m.get(t, {}) == {}, m, 'regression')

    # 2. koreksi nota pengganti (naik 20.000): selisih jatuh di tanggal asli; HPP koreksi hari ini
    F2 = dict(F, inv=new, no=nno)
    e2 = bk.edit_inv(h, F2, f"b3-k1e-{F['n']}", 20000) if new else 'no reissue'
    m = by_date(h, inv_entries(F['no'], nno or '-')); src = sources(h, inv_entries(F['no'], nno or '-'))
    get = lambda s: sorted(set(z['t'] for z in src if z['s'] == s))
    check('klinik: koreksi nota pengganti (nilai naik 20.000) berhasil', e2 is None, (e2 or '')[:300], 'regression')
    check('klinik: jurnal koreksi penjualan (klinik-edit) nota pengganti bertanggal nota asli',
          e2 is None and get('klinik-edit') == [o], src)
    check('klinik: SELISIH nilai masuk tanggal asli: pendapatan tanggal asli = nilai baru, hari ini nol pendapatan',
          e2 is None and revenue(m, o) == T0 + 20000 and revenue(m, t) == 0, m)
    check('klinik: HPP koreksi tetap hari ini (stok koreksi bergerak hari ini)', e2 is None and get('klinik-hpp-edit') == [t], src, 'regression')
    check('klinik: neraca saldo nol per cabang per tanggal', tb_dates(h) == 0, {}, 'regression')

    # 3. hari yang sama: perilaku lama persis
    G = klinik_invoice(h, CTX['today'])
    e, new = reissue(h, G, f"b3-k3-{G['n']}")
    src = sources(h, inv_entries(G['no'], h.no_tagihan(new) if new else '-'))
    check('klinik: void & terbit ulang di hari yang sama tetap seperti dulu (jurnal batal/terbit ulang current_date)',
          e is None and sorted(set(z['t'] for z in src if z['s'] in ('klinik-void', 'klinik-reissue'))) == [t], dict(e=(e or '')[:200], src=src), 'regression')

    # 4. periode tanggal asli ditutup -> terbit ulang ditolak (baru)
    F = klinik_invoice(h, o)
    h.sql(f"update public.accounting_locks set closed_until={q(o)};")
    e, new = reissue(h, F, f"b3-k4-{F['n']}")
    h.sql("update public.accounting_locks set closed_until=null;")
    check('klinik: periode tanggal nota asli sudah ditutup -> void & terbit ulang ditolak (PERIODE_TERKUNCI), nota tetap aktif',
          bool(e) and 'PERIODE_TERKUNCI' in e and 'Tutup Buku' in e and h.nilai(f"select voided_at is null from public.invoices where id={q(F['inv'])}") == 't', (e or '')[:300])
    # 5. penggajian bulan tanggal asli sudah dibuat -> ditolak (baru)
    F = klinik_invoice(h, o)
    h.sql(f"set session_replication_role=replica; insert into public.payrolls(periode,employee_id) values(to_char({q(o)}::date,'YYYY-MM'),{q(r.DOKTER_PEGAWAI)});")
    e, new = reissue(h, F, f"b3-k5-{F['n']}")
    h.sql(f"set session_replication_role=replica; delete from public.payrolls where periode=to_char({q(o)}::date,'YYYY-MM');")
    check('klinik: penggajian bulan nota asli sudah dibuat -> void & terbit ulang ditolak (GAJI_SUDAH_DIBUAT)',
          bool(e) and 'GAJI_SUDAH_DIBUAT' in e, (e or '')[:300])
    # 6. periode ditutup SESUDAH terbit ulang -> koreksi nota pengganti ditolak (baru), lalu lolos sesudah dibuka
    F = klinik_invoice(h, o)
    e, new = reissue(h, F, f"b3-k6-{F['n']}")
    F6 = dict(F, inv=new)
    h.sql(f"update public.accounting_locks set closed_until={q(o)};")
    e6 = bk.edit_inv(h, F6, f"b3-k6e-{F['n']}", 20000) if new else 'no reissue'
    h.sql("update public.accounting_locks set closed_until=null;")
    check('klinik: periode tanggal asli ditutup sesudah terbit ulang -> koreksi nota pengganti ditolak (PERIODE_TERKUNCI)',
          e is None and bool(e6) and 'PERIODE_TERKUNCI' in e6, dict(e=(e or '')[:200], e6=(e6 or '')[:300]))
    pending = lambda: h.nilai(f"select correction_pending from public.invoices where id={q(new)}") if new else 't'
    e7 = (bk.edit_inv(h, F6, f"b3-k6f-{F['n']}", 20000) if pending() == 't' else None) if new else 'no reissue'
    check('klinik: periode dibuka lagi -> koreksi nota pengganti lolos (koreksi akhirnya selesai)', e7 is None and pending() == 'f', (e7 or '')[:300], 'regression')


# ------------------------------------------------------------------ static / ACL
def sec_static(h, baseline):
    text = CANDIDATE.read_text()
    head = '\n'.join(text.splitlines()[:3])
    check('statik: "Apply as ONE transaction" di 3 baris pertama, tanpa begin/commit sendiri, tanpa create or replace function',
          'Apply as ONE transaction' in head and not any(l.strip().lower() in ('begin;', 'commit;') for l in text.splitlines())
          and 'create or replace function' not in text.lower(), {}, 'static')
    if baseline: return
    acl = json.loads(h.nilai("select coalesce(jsonb_agg(jsonb_build_object('f',p.proname,'auth',has_function_privilege('authenticated',p.oid,'execute'),'anon',has_function_privilege('anon',p.oid,'execute'),'svc',has_function_privilege('service_role',p.oid,'execute'),'def',p.prosecdef)),'[]') from pg_proc p where p.proname in ('b3_tanggal_jurnal','b3_tolak_tanggal_asli')"))
    check('ACL: helper B3 definer tanpa hak aplikasi (authenticated/anon/service_role)', len(acl) == 2 and all(a['def'] and not a['auth'] and not a['anon'] and not a['svc'] for a in acl), acl)
    fns = json.loads(h.nilai("select coalesce(jsonb_agg(jsonb_build_object('f',p.proname,'def',p.prosecdef,'cfg',p.proconfig,'auth',has_function_privilege('authenticated',p.oid,'execute'),'mark',p.prosrc like '%B3_TANGGAL_ASLI%')),'[]') from pg_proc p "
                             "where p.oid in ('public.cancel_posted_sale(uuid,integer,text,text)'::regprocedure,'public.clinic_void_reissue_invoice_core(uuid,text,text)'::regprocedure,'public.clinic_edit_invoice_core(uuid,text,jsonb,jsonb)'::regprocedure,'public.pos_sale_edit_void(uuid,integer,text,text)'::regprocedure)"))
    marked = {f['f'] for f in fns if f['mark']}
    check('fungsi yang ditambal tetap definer + search_path kosong; tanda B3 di 3 fungsi, pos_sale_edit_void tidak berubah',
          len(fns) == 4 and all(f['def'] and 'search_path=""' in ' '.join(f['cfg'] or []) for f in fns)
          and marked == {'cancel_posted_sale', 'clinic_void_reissue_invoice_core', 'clinic_edit_invoice_core'}, fns)
    check('ACL lama tetap: cancel_posted_sale boleh authenticated',
          any(f['f'] == 'cancel_posted_sale' and f['auth'] for f in fns), {})
    e = err_of(h, 'begin;\n' + text + '\nrollback;', None)
    check('migrasi menolak dipasang dua kali (helper/tanda sudah ada), tanpa mengubah apa pun', bool(e) and 'already exists' in e, (e or '')[:200])


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path)
    ap.add_argument('--pg-bin', default=os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
    ap.add_argument('--baseline', action='store_true'); a = ap.parse_args()
    try:
        with r.NativePostgres(a.pg_bin) as db:
            okr.build(db, {CANDIDATE.name})
            h = x.Harness(db); x.setup(h); setup_dates(h); petshop_fixture(h)
            if not a.baseline: db.sql('begin;\n' + CANDIDATE.read_text() + '\ncommit;')
            for name, fn in (('petshop', sec_petshop), ('klinik', sec_klinik)):
                print('=== section', name, flush=True)
                try: fn(h)
                except Exception as e: check(f'SECTION {name} aborted', False, str(e)[:500], 'harness')
            sec_static(h, a.baseline)
    except Exception as e: check('HARNESS', False, str(e)[:800], 'harness')
    feature = [c for c in RESULTS if c['kind'] == 'feature']
    other = [c for c in RESULTS if c['kind'] != 'feature']
    if a.baseline:
        red = [c for c in feature if c['status'] == 'FAIL']
        ok = len(red) == len(feature) and all(c['status'] == 'PASS' for c in other)
        print(f"BASELINE: {len(red)}/{len(feature)} feature cases RED; {sum(c['status'] == 'PASS' for c in other)}/{len(other)} regression/static PASS.", flush=True)
    else:
        ok = all(c['status'] == 'PASS' for c in RESULTS)
        print(f"{sum(c['status'] == 'PASS' for c in RESULTS)}/{len(RESULTS)} PASS", flush=True)
    if a.json: a.json.write_text(json.dumps(dict(candidate=CANDIDATE.name, baseline=a.baseline, ok=ok, results=RESULTS), indent=1, default=str))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
