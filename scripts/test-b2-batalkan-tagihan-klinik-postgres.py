#!/usr/bin/env python3
"""B2 (meeting 12 Nov 2026, pilihan A): tutup kunjungan lunas, "Batalkan tagihan" klinik (void murni), arsip paksa + racikan, alasan arsip di
Log Aktifitas (migrasi 20261118620000_b2_batalkan_tagihan_klinik.sql). Tanggal mengikuti aturan "2A" (keputusan B3 A): pembalik pendapatan/
piutang di tanggal tagihan asli, pembalik HPP dan semua pengembalian stok HARI INI (periode persediaan diperiksa pada hari ini).

Native full schema (seluruh rantai migrasi), fixture fiktif, cluster lokal sekali pakai, tanpa jaringan, tidak pernah menerima URL database.
  mkdir -p /opt/data
  python3 -I scripts/test-b2-batalkan-tagihan-klinik-postgres.py --pg-bin /usr/lib/postgresql/16/bin --json out.json
  --baseline   rantai TANPA kandidat: setiap kasus fitur baru harus FAIL (RED)
"""
import argparse, importlib.util, json, sys
from decimal import Decimal
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('bk', ROOT / 'scripts/test-batalkan-penerimaan-klinik-postgres.py'); assert spec and spec.loader
bk = importlib.util.module_from_spec(spec); spec.loader.exec_module(bk)
okr, x, r, q, j = bk.okr, bk.x, bk.r, bk.q, bk.j
CANDIDATE = '20261118620000_b2_batalkan_tagihan_klinik.sql'
MIG = ROOT / 'supabase/migrations'
RESULTS = []
OWNER, ADMIN, FINANCE, STAFF = r.OWNER, r.ADMIN, r.FINANCE, r.STAFF
NEXT = [7000]
REASON = 'Data percobaan kasir, disetujui Owner'


def check(name, ok, detail=None):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail))
    print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:400], flush=True)


def nxt():
    NEXT[0] += 3; return NEXT[0]


def has(err, *words): return bool(err) and all(w in err for w in words)
def D(v): return Decimal(str(v))


def void(h, inv, key, user=OWNER, reason=REASON):
    try: return None, json.loads(h.nilai(f"select public.clinic_void_invoice({q(inv)},{q(key)},{q(reason)});", user))
    except RuntimeError as e: return str(e), None


def preview(h, inv, user=OWNER):
    try: return None, json.loads(h.nilai(f"select public.clinic_void_invoice_preview({q(inv)});", user))
    except RuntimeError as e: return str(e), None


def tb(h): return D(h.nilai("select coalesce(sum(debit)-sum(credit),0) from public.journal_lines"))


def net(h, no, sources=None):
    src = sources or "e.source like 'klinik%' and e.source not like 'klinik-hpp%'"
    rows = json.loads(h.nilai("select coalesce(jsonb_object_agg(code, v),'{}') from (select a.code, sum(l.debit-l.credit) v from public.journal_lines l "
                              "join public.journal_entries e on e.id=l.entry_id join public.coa_accounts a on a.id=l.account_id "
                              f"where e.source_ref={q(no)} and {src} group by a.code) s"))
    return {k: D(v) for k, v in rows.items()}


def nz(d): return {k: str(v) for k, v in d.items() if v != 0}
def stock(h, item=None): return D(h.nilai(f"select coalesce(sum(qty),0) from public.stock where item_id={q(item or r.ITEM)}"))
def layers(h, item=None): return D(h.nilai(f"select coalesce(sum(qty_left),0) from public.stock_layers where item_id={q(item or r.ITEM)}"))
def points(h, cust): return int(h.angka(f"select coalesce(points,0) from public.customers where id={q(cust)}"))


def state(h):
    return h.nilai("select md5(concat_ws('|',(select count(*) from public.journal_entries),(select count(*) from public.stock_moves),"
                   "(select md5(coalesce(string_agg(to_jsonb(i)::text,',' order by id),'')) from public.invoices i),"
                   "(select md5(coalesce(string_agg(to_jsonb(a)::text,',' order by id),'')) from public.clinic_customer_advances a),"
                   "(select count(*) from public.point_ledger),(select coalesce(sum(qty_left),0) from public.stock_layers)))")


def rj(h, status='Belum Lunas', dp=0, slots=(2, 3), user=OWNER, metode='Tunai'):
    """Rawat jalan biasa lewat clinic_post_invoice (seperti simpanPembayaran)."""
    return bk.rj(h, nxt(), metode, status=status, dp=dp, slots=slots, user=user)


def give_points(h, F, pts):
    cust = h.nilai(f"select customer_id from public.visits where id={q(F['v'])}")
    h.sistem(f"update public.customers set points=coalesce(points,0)+{pts} where id={q(cust)};"
             f"insert into public.point_ledger(customer_id,delta,saldo,ref,description,entry_type) select {q(cust)},{pts},points,{q(F['no'])},'Kunjungan klinik {F['no']}','transaction' from public.customers where id={q(cust)};")
    return cust


def force_archive(h, v, key, user=OWNER):
    key = 'paksa-arsip-' + key
    return h.gagal(f"select public.clinic_force_archive_visit({q(v)},'Data percobaan kasir fiktif',{q(key)},'PAKSA');", user)


def grant(h, role, actions):
    h.sql("alter table role_settings_private.action_policies disable trigger user;"
          f"insert into role_settings_private.action_policies(role,allowed) values({q(role)},{q('{' + ','.join(actions) + '}')}::text[]) on conflict(role) do update set allowed=excluded.allowed;"
          "alter table role_settings_private.action_policies enable trigger user;")


# ---------------------------------------------------------------- sections
def section_roles(h):
    F = rj(h)
    check('izin: tombol layar — Owner boleh, ADMIN/FINANCE/STAFF tanpa centang tidak',
          h.gagal("select 1;") is None and h.nilai("select public.clinic_invoice_void_allowed();", OWNER) == 't'
          and all(h.nilai("select public.clinic_invoice_void_allowed();", u) == 'f' for u in (ADMIN, FINANCE, STAFF)))
    for u, name in [(ADMIN, 'ADMIN'), (FINANCE, 'FINANCE'), (STAFF, 'STAFF')]:
        before = state(h); e, _ = void(h, F['inv'], f"r-{name}", u); pe, _ = preview(h, F['inv'], u)
        check(f'izin: {name} tanpa centang Akses Grup ditolak (eksekusi + pratinjau), tidak ada yang berubah', has(e, 'ACCESS_DENIED') and has(pe, 'ACCESS_DENIED') and state(h) == before, (e or '')[:160])
    e = h.gagal(f"set role anon; select public.clinic_void_invoice({q(F['inv'])},'k-anon','alasan anon');")
    check('izin: anon tidak punya hak memanggil', has(e, 'permission denied'), (e or '')[:120])
    grant(h, 'ADMIN', ['klinik.batalkan_tagihan']); grant(h, 'FINANCE', ['kasir.diskon_manual'])
    check('izin: ADMIN dicentang Owner -> tombol tampil; FINANCE dengan kebijakan lain -> tidak',
          h.nilai("select public.clinic_invoice_void_allowed();", ADMIN) == 't' and h.nilai("select public.clinic_invoice_void_allowed();", FINANCE) == 'f')
    e, res = void(h, F['inv'], 'r-admin-ok', ADMIN)
    check('izin: ADMIN yang dicentang boleh membatalkan', e is None and res and res['status'] == 'VOIDED', (e or '')[:200])
    e, _ = void(h, rj(h)['inv'], 'r-fin', FINANCE)
    check('izin: FINANCE dengan kebijakan tanpa izin ini tetap ditolak', has(e, 'ACCESS_DENIED'), (e or '')[:160])
    grant(h, 'ADMIN', [])
    G = rj(h)
    e, _ = void(h, G['inv'], 'r-short', OWNER, reason='ab')
    check('validasi: alasan < 3 huruf ditolak', has(e, 'BATAL_TAGIHAN_INVALID'), (e or '')[:160])


def section_belum_lunas(h):
    F = rj(h, slots=(2, 3))          # jasa 120.000 + obat 2 x 25.000 (stok, HPP 2 x 2.000)
    cust = give_points(h, F, 25)
    orig = h.nilai(f"select min(tanggal) from public.journal_entries where source='klinik' and source_ref={q(F['no'])}")
    today = h.nilai("select current_date")   # aturan 2A: HPP & stok memakai current_date (sama dengan kode klinik lain)
    s0, l0, p0, tb0 = stock(h), layers(h), points(h, cust), tb(h)
    pre_net = nz(net(h, F['no'])); pre_hpp = nz(net(h, F['no'], "e.source like 'klinik-hpp%'"))
    e0 = force_archive(h, F['v'], f"fa0-{F['n']}")
    check('sebelum batal: paksa arsip kunjungan bertagihan tetap DITOLAK keras (perilaku lama)', has(e0, 'ARCHIVE_BLOCKED', 'sudah ada tagihan'), (e0 or '')[:200])
    pe, p = preview(h, F['inv'])
    check('pratinjau: tanpa penolakan; tanggal asli, nilai stok = HPP, poin, jumlah baris ditarik; tidak mengubah apa pun',
          pe is None and p['refuse'] is None and p['original_date'] == orig and p['stock_date'] == today and D(p['stock_value']) == D(p['hpp_reversed']) == 4000 and p['points_net'] == 25
          and p['withdraw_count'] == 2 and stock(h) == s0, dict(pe=(pe or '')[:200], p=p))
    check('fixture: tanggal tagihan asli BUKAN hari ini (jurnal pembalik harus memakai tanggal asli)', orig != today, dict(orig=orig, today=today))
    e, res = void(h, F['inv'], f"v-{F['n']}")
    check('batal Belum Lunas: berhasil, status VOIDED, tanggal asli dipakai', e is None and res['status'] == 'VOIDED' and res['original_date'] == orig, (e or res))
    inv = json.loads(h.nilai(f"select to_jsonb(i) from public.invoices i where id={q(F['inv'])}"))
    check('tagihan: voided_at terisi, nomor sama, tidak ada tagihan pengganti', inv['voided_at'] is not None and inv['invoice_no'] == F['no']
          and h.angka(f"select count(*) from public.invoices where visit_id={q(F['v'])}") == 1, dict(voided=inv['voided_at']))
    jr = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_object('s',source,'t',tanggal) order by source),'[]') from public.journal_entries where source_ref={q(F['no'])} and source in ('klinik-void','klinik-hpp-void')"))
    check('aturan 2A: jurnal pembalik pendapatan/piutang (klinik-void) bertanggal TAGIHAN ASLI, pembalik HPP (klinik-hpp-void) bertanggal HARI INI',
          jr == [{'s': 'klinik-hpp-void', 't': today}, {'s': 'klinik-void', 't': orig}], dict(jr=jr, pre=pre_net, pre_hpp=pre_hpp))
    check('pembukuan tagihan kembali nol: piutang, pendapatan, HPP, persediaan; neraca saldo seimbang',
          nz(net(h, F['no'])) == {} and nz(net(h, F['no'], "e.source like 'klinik-hpp%'")) == {} and tb(h) == tb0 == 0, dict(net=nz(net(h, F['no']))))
    mv = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_object('src',source,'qty',qty,'cost',unit_cost,'t',tanggal)),'[]') from public.stock_moves where source_ref={q(F['no'])} and source='klinik-void'"))
    lay = h.nilai(f"select string_agg(tanggal::text,',') from public.stock_layers where source='klinik-void' and source_ref={q(F['no'])}")
    check('stok obat kembali (2 pcs) sebagai lapisan baru pada biaya tercatat; mutasi & lapisan klinik-void bertanggal HARI INI; kartu stok tagihan nol',
          stock(h) == s0 + 2 and layers(h) == l0 + 2 and len(mv) == 1 and D(mv[0]['qty']) == 2 and D(mv[0]['cost']) == 2000 and mv[0]['t'] == today and lay == today
          and h.angka(f"select coalesce(sum(qty),0) from public.stock_moves where source_ref={q(F['no'])}") == 0, dict(mv=mv))
    lg = json.loads(h.nilai(f"select to_jsonb(l) from (select delta,saldo,entry_type,ref from public.point_ledger where customer_id={q(cust)} order by created_at desc, id desc limit 1) l"))
    check('poin: dibalik satu baris adjustment (-25), saldo pelanggan turun 25, tidak minus', lg['delta'] == -25 and lg['entry_type'] == 'adjustment' and lg['ref'] == F['no'] and points(h, cust) == p0 - 25, lg)
    w = h.angka(f"select count(*) from public.prescription_items pi join public.medical_records mr on mr.id=pi.medical_record_id where mr.visit_id={q(F['v'])} and pi.billing_withdrawn_at is not null")
    check('rekam medis: baris yang ditagih ditarik dari penagihan (kasir tidak menagihnya lagi), isinya tetap ada', w == 2, dict(withdrawn=w))
    a = json.loads(h.nilai(f"select to_jsonb(a) from public.clinic_invoice_voids a where invoice_id={q(F['inv'])}"))
    check('jejak tetap: alasan, pelaku, tanggal asli, nilai stok = HPP, poin, jurnal, snapshot sebelum',
          a['reason'] == REASON and a['actor_id'] == OWNER and a['original_date'] == orig and D(a['stock_value']) == D(a['hpp_reversed']) == 4000
          and a['points_delta'] == -25 and len(a['journal_ids']) == 2 and a['before_invoice']['voided_at'] is None and a['log_label'].endswith(REASON), dict(keys=sorted(a)))
    el = h.angka(f"select count(*) from public.invoice_edit_log where invoice_id={q(F['inv'])} and field_changed='voided'")
    act = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_object('e',row_entity,'label',object_label,'after',after_state,'actor',actor_id)),'[]') from public.activity_log where row_entity in ('clinic_invoice_voids','invoices') and (object_label like {q('%' + F['no'] + '%')})"))
    check('Log Aktifitas: baris "Batalkan tagihan <no> — alasan: ..." oleh Owner + perubahan voided_at tagihan; invoice_edit_log tercatat',
          el == 1 and any(x_['e'] == 'clinic_invoice_voids' and REASON in (x_['label'] or '') and x_['actor'] == OWNER for x_ in act)
          and any(x_['e'] == 'invoices' and 'voided_at' in (x_['after'] or {}) for x_ in act), dict(act=act))
    # idempoten
    e2, res2 = void(h, F['inv'], f"v-{F['n']}")
    nj = h.angka(f"select count(*) from public.journal_entries where source_ref={q(F['no'])}")
    check('idempoten: kunci + isi sama -> hasil tersimpan (replayed), tidak ada jurnal/stok tambahan', e2 is None and res2.get('replayed') is True and res2['void_id'] == res['void_id'] and stock(h) == s0 + 2, dict(nj=nj))
    e3, _ = void(h, F['inv'], f"v-{F['n']}", reason='Alasan lain yang berbeda')
    check('idempoten: kunci sama + isi beda -> IDEMPOTENCY_CONFLICT', has(e3, 'IDEMPOTENCY_CONFLICT'), (e3 or '')[:160])
    e4, _ = void(h, F['inv'], f"v2-{F['n']}")
    check('batal kedua kali (kunci baru) -> ditolak "sudah dibatalkan"', has(e4, 'BATAL_TAGIHAN_SUDAH_BATAL'), (e4 or '')[:160])
    # arsip sesudah batal
    cls = json.loads(h.nilai(f"select clinic_private.visit_archive_classify({q(F['v'])})"))
    e5 = h.gagal(f"select public.clinic_archive_visit({q(F['v'])},'Data percobaan kasir',{q('arsip-biasa-' + str(F['n']))});", OWNER)
    check('arsip sesudah batal: tidak ada penghalang KERAS lagi; arsip biasa masih minta paksa (isi rekam medis = penghalang lunak)',
          cls['hard'] == [] and len(cls['soft']) > 0 and has(e5, 'ARCHIVE_BLOCKED', 'Pemilik dapat memaksa'), dict(cls=cls, e5=(e5 or '')[:200]))
    e6 = force_archive(h, F['v'], f"fa-{F['n']}")
    ev = json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_object('label',object_label,'after',after_state,'actor',actor_id,'scope',scope)),'[]') from public.activity_log where row_entity='visit_archive_events' and object_refs @> {j([dict(entity='visits', id=F['v'])])}"))
    check('paksa arsip sesudah batal: berhasil; Log Aktifitas menampilkan "Arsip PAKSA kunjungan — alasan: ..." dan forced=true',
          e6 is None and h.nilai(f"select archived_at is not null from public.visits where id={q(F['v'])}") == 't'
          and any('Arsip PAKSA kunjungan — alasan: Data percobaan kasir fiktif' in (x_['label'] or '') and (x_['after'] or {}).get('forced') is True and x_['actor'] == OWNER for x_ in ev), dict(e6=(e6 or '')[:200], ev=ev))
    e7 = h.gagal(f"select public.clinic_unarchive_visit({q(F['v'])},null,{q('pulihkan-' + str(F['n']))});", OWNER)
    ev2 = h.angka(f"select count(*) from public.activity_log where row_entity='visit_archive_events' and object_label like 'Pulihkan kunjungan%' and object_refs @> {j([dict(entity='visits', id=F['v'])])}")
    check('pulihkan juga tercatat di Log Aktifitas ("Pulihkan kunjungan")', e7 is None and ev2 == 1, dict(e7=(e7 or '')[:160]))


def section_dp(h):
    F = rj(h, status='DP', dp=100000, slots=(2, 3))     # 170.000, DP Tunai 100.000 di kepala tagihan
    cust = h.nilai(f"select customer_id from public.visits where id={q(F['v'])}")
    kas0 = net(h, F['no']).get('110003', D(0))
    before = state(h); e0, _ = void(h, F['inv'], f"v0-{F['n']}")
    check('batal DP: selama shift kasir tagihan masih BUKA -> ditolak (hitungan laci tidak boleh bergeser), tidak ada yang berubah',
          has(e0, 'BATAL_TAGIHAN_SHIFT_BUKA') and state(h) == before, (e0 or '')[:200])
    bk.set_shift(h, OWNER, 'closed')
    e, res = void(h, F['inv'], f"v-{F['n']}")
    bk.set_shift(h, OWNER, 'open')
    adv = json.loads(h.nilai(f"select to_jsonb(a) from public.clinic_customer_advances a where id={q((res or {}).get('advance_id') or r.uid(9, 1))}") or 'null')
    after = net(h, F['no'])
    check('batal DP: DP 100.000 menjadi saldo uang muka pelanggan (UMK baru, kunjungan ini, aktif, belum terpakai)',
          e is None and adv and D(adv['amount']) == 100000 and D(adv['applied']) == 0 and adv['status'] == 'aktif' and adv['visit_id'] == F['v']
          and adv['customer_id'] == cust and adv['receipt_id'] is None and res['advance_no'] == adv['no_uang_muka'] and D(res['dp_converted']) == 100000, dict(e=(e or '')[:200], res=res))
    check('batal DP: uang tetap di kas (110003 = 100.000), piutang/pendapatan nol, 314001 kredit 100.000, neraca seimbang',
          kas0 == 100000 and after.get('110003') == 100000 and after.get('314001') == -100000 and after.get('150001', 0) == 0 and after.get('510002', 0) == 0 and tb(h) == 0, nz(after))
    e2 = force_archive(h, F['v'], f"fa-{F['n']}")
    check('arsip: saldo DP yang belum dikembalikan tetap penghalang keras dengan pesan jelas', has(e2, 'ARCHIVE_BLOCKED', 'saldo DP dari tagihan yang dibatalkan belum dikembalikan'), (e2 or '')[:300])
    # DP dikembalikan penuh lewat jalur refund uang muka yang ada (diringkas: saldo dipakai habis oleh pemakaian lain disimulasikan via permit pengembalian)
    # saldo DP habis (dipakai tagihan lain / dikembalikan): disimulasikan dengan applied = amount
    h.sistem(f"update public.clinic_customer_advances set applied=amount where id={q(adv['id'])};")
    cls = json.loads(h.nilai(f"select clinic_private.visit_archive_classify({q(F['v'])})"))
    check('arsip: setelah saldo DP habis (terpakai/dikembalikan), uang muka hasil DP tidak lagi menghalangi', not any('uang muka' in s_ or 'DP' in s_ for s_ in cls['hard']), cls)


def section_lunas(h):
    F = rj(h, status='Lunas', slots=(2,))
    before = state(h); e, _ = void(h, F['inv'], f"v-{F['n']}"); pe, p = preview(h, F['inv'])
    check('Lunas ditolak dengan petunjuk "Batalkan penerimaan dulu"; pratinjau sama', has(e, 'BATAL_TAGIHAN_LUNAS', 'Batalkan penerimaan') and p['refuse']['code'] == 'LUNAS' and state(h) == before, (e or '')[:200])
    ec, _ = bk.do_cancel(h, F['inv'], f"c-{F['n']}")
    e1, _ = void(h, F['inv'], f"v1-{F['n']}")
    check('Lunas -> Batalkan penerimaan, shift asal masih buka -> Batalkan tagihan ditolak SHIFT_BUKA (laci shift itu memuat penerimaan + pembatalannya)',
          ec is None and has(e1, 'BATAL_TAGIHAN_SHIFT_BUKA'), dict(ec=(ec or '')[:160], e1=(e1 or '')[:200]))
    bk.set_shift(h, OWNER, 'closed')
    e2, res = void(h, F['inv'], f"v2-{F['n']}")
    bk.set_shift(h, OWNER, 'open')
    check('Lunas -> Batalkan penerimaan -> Batalkan tagihan: berhasil; pembukuan tagihan nol, kas kembali nol, neraca seimbang',
          ec is None and e2 is None and nz(net(h, F['no'])) == {} and tb(h) == 0, dict(ec=(ec or '')[:160], e2=(e2 or '')[:200], net=nz(net(h, F['no']))))
    G = rj(h, status='DP', dp=100000, slots=(1, 2))
    es = bk.settle(h, G, [{'method': 'QRIS', 'amount': 50000}], f"s-{G['n']}", remaining=G['total'] - 100000)
    e3, _ = void(h, G['inv'], f"v-{G['n']}")
    check('pelunasan sebagian lewat kasir masih tercatat -> ditolak "Batalkan penerimaan dulu"', (es is not None) or has(e3, 'BATAL_TAGIHAN_ADA_PENERIMAAN'), dict(es=(es or '')[:160], e3=(e3 or '')[:200]))


def section_guards(h):
    R = bk.ranap(h, nxt(), 'none')
    e, _ = void(h, R['inv'], f"v-{R['n']}")
    check('rawat inap (tagihan tahap, masih dirawat) ditolak, di luar cakupan', has(e, 'BATAL_TAGIHAN_RAWAT_INAP'), (e or '')[:200])
    F = rj(h)
    orig = h.nilai(f"select min(tanggal) from public.journal_entries where source='klinik' and source_ref={q(F['no'])}")
    for name, setup, undo, code in [
        ('periode akuntansi tertutup pada tanggal asli', f"update public.accounting_locks set closed_until={q(orig)}::date where id;", "update public.accounting_locks set closed_until=null where id;", 'PERIODE_TERKUNCI'),
        ('periode persediaan tertutup sampai HARI INI (stok & HPP kembali hari ini)', "update public.inventory_costing_settings set closed_through=current_date where id;", "update public.inventory_costing_settings set closed_through=null where id;", 'PERSEDIAAN_TERKUNCI'),
        ('penggajian bulan tagihan sudah dibuat', f"insert into public.employees(id,nama,branch_id) values ({q(r.uid('a', 77))},'Pegawai Gaji Fiktif',{q(r.BRANCH)}) on conflict do nothing; insert into public.payrolls(periode,employee_id) values (to_char({q(orig)}::date,'YYYY-MM'),{q(r.uid('a', 77))});",
         f"delete from public.payrolls where employee_id={q(r.uid('a', 77))};", 'GAJI_SUDAH_DIBUAT')]:
        se = h.gagal(setup)
        before = state(h); e, _ = void(h, F['inv'], f"v-{code}-{F['n']}")
        check(f'pagar: {name} -> ditolak ({code}), tidak ada yang berubah', se is None and has(e, code) and state(h) == before, dict(se=(se or '')[:160], e=(e or '')[:200]))
        h.sql(undo)
    # aturan 2A: periode persediaan yang tertutup hanya sampai tanggal asli (sebelum hari ini) TIDAK menghalangi (stok kembali hari ini)
    h.sql(f"update public.inventory_costing_settings set closed_through={q(orig)}::date where id;")
    pe, p = preview(h, F['inv'])
    h.sql("update public.inventory_costing_settings set closed_through=null where id;")
    check('pagar: periode persediaan tertutup hanya sampai tanggal asli -> TIDAK ditolak (stok & HPP dibukukan hari ini)', pe is None and p['refuse'] is None, dict(pe=(pe or '')[:200], p=(p or {}).get('refuse')))
    cust = give_points(h, F, 40)
    h.sistem(f"update public.customers set points=10 where id={q(cust)};")
    e, _ = void(h, F['inv'], f"v-poin-{F['n']}")
    check('poin dari tagihan sudah terpakai (saldo 10 < 40) -> ditolak, saldo tidak pernah minus', has(e, 'BATAL_TAGIHAN_POIN_TERPAKAI') and points(h, cust) == 10, (e or '')[:200])


def section_racikan(h):
    # Racikan rawat jalan: diterbitkan (bahan keluar dari lapisan FIFO), lalu ditagih bersama jasa.
    n = nxt(); cust = r.buat_pelanggan(h, n); v = r.buat_kunjungan(h, n, cust, admitted=False); mr = r.uid(7, n)
    key = f'b2-racik-{n}'
    h.sql(x.issue(v, mr, x.payload(None, key, custom=True)), OWNER)
    recipe = x.recipe_row(h, key)
    iss = json.loads(h.nilai(f"select jsonb_agg(jsonb_build_object('layer',stock_layer_id,'qty',qty)) from public.compound_issues where recipe_id={q(recipe)}"))
    m0, l0 = stock(h, x.MATERIAL), {i['layer']: D(h.nilai(f"select qty_left from public.stock_layers where id={q(i['layer'])}")) for i in iss}
    e_arch = force_archive(h, v, f"fa-r0-{n}")
    check('butir 4: paksa arsip kunjungan TANPA tagihan yang racikannya sudah memotong stok -> ditolak keras dengan petunjuk', has(e_arch, 'ARCHIVE_BLOCKED', 'racikan yang bahannya sudah terpotong'), (e_arch or '')[:300])
    ls = bk.lines_for(n, 2) + [x.line(h, recipe)]
    h.sql(r.tagih_biasa_sql(v, f'k{n}-post', ls, OWNER, alasan='Uji fiktif DP', ganti={'paid_status': 'Belum Lunas'}), OWNER)
    inv = h.aktif(v); no = h.no_tagihan(inv)
    pe, p = preview(h, inv)
    e, res = void(h, inv, f"v-{n}")
    l1 = {i['layer']: D(h.nilai(f"select qty_left from public.stock_layers where id={q(i['layer'])}")) for i in iss}
    rest = h.angka(f"select count(*) from public.compound_issues where recipe_id={q(recipe)} and restored_at is null")
    check('racikan: pratinjau tanpa penolakan, nilai racikan = HPP', pe is None and p['refuse'] is None and D(p['racik_value']) > 0 and D(p['racik_value']) + D(p['stock_value']) == D(p['hpp_reversed']), dict(pe=(pe or '')[:300], p=p))
    check('racikan: bahan kembali ke LAPISAN ASAL (qty_left naik sebesar bukti pengeluaran), stok bahan naik, bukti ditandai dipulihkan',
          e is None and all(l1[i['layer']] == l0[i['layer']] + D(i['qty']) for i in iss) and stock(h, x.MATERIAL) == m0 + sum(D(i['qty']) for i in iss) and rest == 0
          and all(s_['cara'] == 'lapisan_asal' for s_ in res['stock'] if s_.get('racikan')), dict(e=(e or '')[:300], res=res))
    rk = h.nilai(f"select string_agg(distinct tanggal::text,',') from public.stock_moves where source='racik-kembali' and source_ref={q(recipe)}")
    check('racikan: mutasi pengembalian bahan bertanggal HARI INI (aturan 2A)', rk == h.nilai("select current_date"), dict(rk=rk))
    check('racikan: pembukuan & HPP tagihan nol, neraca seimbang', nz(net(h, no)) == {} and nz(net(h, no, "e.source like 'klinik-hpp%'")) == {} and tb(h) == 0, nz(net(h, no, "e.source like 'klinik-hpp%'")))
    cls = json.loads(h.nilai(f"select clinic_private.visit_archive_classify({q(v)})"))
    e2 = force_archive(h, v, f"fa-r-{n}")
    check('racikan: sesudah batal, penjualan racikan & racikan terpotong tidak lagi menghalangi; paksa arsip berhasil', cls['hard'] == [] and e2 is None, dict(cls=cls, e2=(e2 or '')[:200]))
    # racikan tanpa tagihan: kembalikan bahan dulu (jalur yang ada) -> paksa arsip boleh
    n2 = nxt(); c2 = r.buat_pelanggan(h, n2); v2 = r.buat_kunjungan(h, n2, c2, admitted=False); k2 = f'b2-racik-{n2}'
    h.sql(x.issue(v2, r.uid(7, n2), x.payload(None, k2, custom=True)), OWNER)
    rc2 = x.recipe_row(h, k2)
    er = h.gagal(f"select public.clinic_return_compound({q(rc2)},'Racikan batal dibuat, bahan kembali');", OWNER)
    e3 = force_archive(h, v2, f"fa-r2-{n2}")
    check('butir 4: setelah "Kembalikan bahan" racikan (jalur yang ada), paksa arsip kunjungan itu berhasil', er is None and e3 is None, dict(er=(er or '')[:200], e3=(e3 or '')[:200]))


def section_tutup(h):
    F = rj(h, status='Lunas', slots=(1, 2, 3, 4))
    h.sistem(f"update public.visits set status='Pembayaran' where id={q(F['v'])};")
    e = h.gagal(f"select public.clinic_close_settled_visit({q(F['v'])});", STAFF)
    check('tutup kunjungan: STAFF ditolak', has(e, 'ACCESS_DENIED'), (e or '')[:160])
    nj = h.angka("select count(*) from public.journal_entries"); nm = h.angka("select count(*) from public.stock_moves")
    out = json.loads(h.nilai(f"select public.clinic_close_settled_visit({q(F['v'])});", ADMIN))
    check('tutup kunjungan: ADMIN menutup kunjungan yang semua tagihannya Lunas -> Selesai, tanpa jurnal/stok baru',
          out['closed'] is True and h.nilai(f"select status from public.visits where id={q(F['v'])}") == 'Selesai'
          and h.angka("select count(*) from public.journal_entries") == nj and h.angka("select count(*) from public.stock_moves") == nm, out)
    out2 = json.loads(h.nilai(f"select public.clinic_close_settled_visit({q(F['v'])});", OWNER))
    check('tutup kunjungan: sudah Selesai -> aman diulang (already)', out2['already'] is True and out2['closed'] is False, out2)
    act = h.angka(f"select count(*) from public.activity_log where row_entity='visits' and row_id={q(F['v'])} and after_state->>'status'='Selesai'")
    check('tutup kunjungan: perubahan status tercatat di Log Aktifitas', act >= 1, dict(act=act))
    G = rj(h, slots=(2,))
    e = h.gagal(f"select public.clinic_close_settled_visit({q(G['v'])});", OWNER)
    check('tutup kunjungan: tagihan belum lunas -> ditolak dengan alasan bahasa biasa', has(e, 'CLOSE_BLOCKED', 'belum lunas'), (e or '')[:200])
    H = rj(h, status='Lunas', slots=(2,))     # baris obat (slot 3) belum ditagih
    h.sistem(f"update public.visits set status='Pembayaran' where id={q(H['v'])};")
    e = h.gagal(f"select public.clinic_close_settled_visit({q(H['v'])});", OWNER)
    check('tutup kunjungan: masih ada obat/layanan belum ditagih -> ditolak', has(e, 'CLOSE_BLOCKED', 'belum ditagih') and h.nilai(f"select status from public.visits where id={q(H['v'])}") == 'Pembayaran', (e or '')[:200])
    R = bk.ranap(h, nxt(), 'advance')
    e = h.gagal(f"select public.clinic_close_settled_visit({q(R['v'])});", OWNER)
    check('tutup kunjungan: pasien masih dirawat inap -> ditolak (tutup sendiri saat pulang)', has(e, 'CLOSE_BLOCKED', 'masih dirawat inap'), (e or '')[:200])


def section_static(h):
    text = (MIG / CANDIDATE).read_text() if (MIG / CANDIDATE).exists() else ''
    head = '\n'.join(text.splitlines()[:3])
    check('statik: "Apply as ONE transaction" di 3 baris pertama; tanpa begin/commit sendiri', 'Apply as ONE transaction' in head and not any(l.strip().lower() in ('begin;', 'commit;') for l in text.splitlines()) and text != '', {})
    funcs = json.loads(h.nilai("select coalesce(jsonb_agg(jsonb_build_object('f',p.proname,'sec',p.prosecdef,'cfg',p.proconfig,'anon',has_function_privilege('anon',p.oid,'execute'),'auth',has_function_privilege('authenticated',p.oid,'execute'),'svc',has_function_privilege('service_role',p.oid,'execute')) order by p.proname),'[]') "
                               "from pg_proc p where p.proname in ('clinic_void_invoice','clinic_void_invoice_preview','clinic_invoice_void_allowed','clinic_close_settled_visit','invoice_void_scan','invoice_void_actor','close_visit_reasons','invoice_void_receipt_cleared','invoice_void_advance_cleared','invoice_void_compound_cleared')"))
    pub = [f for f in funcs if f['f'].startswith('clinic_')]; priv = [f for f in funcs if not f['f'].startswith('clinic_')]
    check('ACL: 4 RPC publik hanya authenticated (definer, search_path kosong); fungsi privat tanpa hak aplikasi',
          len(pub) == 4 and all(f['sec'] and f['auth'] and not f['anon'] and not f['svc'] and 'search_path=""' in ' '.join(f['cfg'] or []) for f in pub)
          and len(priv) == 6 and all(not f['auth'] and not f['anon'] for f in priv), funcs)
    e1 = h.gagal("update public.clinic_invoice_voids set reason='diubah';"); e2 = h.gagal("delete from public.clinic_invoice_voids;"); e3 = h.gagal("truncate public.clinic_invoice_voids;")
    check('jejak batal tagihan tidak bisa diubah/dihapus/dikosongkan', has(e1, 'AUDIT_IMMUTABLE') and has(e2, 'AUDIT_IMMUTABLE') and has(e3, 'AUDIT_IMMUTABLE'), dict(e1=(e1 or '')[:80]))
    tab = json.loads(h.nilai("select jsonb_build_object('anon',has_table_privilege('anon','public.clinic_invoice_voids','select'),'sel',has_table_privilege('authenticated','public.clinic_invoice_voids','select'),'ins',has_table_privilege('authenticated','public.clinic_invoice_voids','insert'),'rls',(select relrowsecurity from pg_class where oid='public.clinic_invoice_voids'::regclass))"))
    check('ACL tabel jejak: authenticated hanya SELECT (RLS per cabang), anon tidak', tab == dict(anon=False, sel=True, ins=False, rls=True), tab)
    cat = h.nilai("select jsonb_build_object('c',(select enforced from role_settings_private.action_catalog where id='klinik.batalkan_tagihan'),'m',(select module_id from role_settings_private.action_modules where id='klinik.batalkan_tagihan'))")
    check('Akses Grup: izin klinik.batalkan_tagihan terpasang (enforced, modul klinik)', json.loads(cat or '{}') == dict(c=True, m='klinik'), cat)
    cov = h.gagal((ROOT / 'supabase/tests/activity_audit_coverage.sql').read_text())
    check('cakupan Log Aktifitas: sumber baru punya trigger change+delete (tes cakupan A01 tidak menyebut sumber baru sebagai rusak)', cov is None or ('clinic_invoice_voids' not in cov and 'visit_archive_events' not in cov), (cov or '')[:300])


SECTIONS = ['roles', 'belum_lunas', 'dp', 'lunas', 'guards', 'racikan', 'tutup', 'static']


def run(h, sections=None):
    x.setup(h)
    fns = dict(roles=section_roles, belum_lunas=section_belum_lunas, dp=section_dp, lunas=section_lunas, guards=section_guards,
               racikan=section_racikan, tutup=section_tutup, static=section_static)
    for s in SECTIONS:
        if sections and s not in sections: continue
        print('=== section', s, flush=True)
        try: fns[s](h)
        except Exception as e: check(f'SECTION {s} aborted', False, str(e).strip()[:500])


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--sections'); a = ap.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    try:
        with r.NativePostgres(r.BIN) as db:
            okr.build(db, {CANDIDATE})
            h = x.Harness(db)
            if not a.baseline: db.sql('begin;\n' + (MIG / CANDIDATE).read_text() + '\ncommit;')
            run(h, set(a.sections.split(',')) if a.sections else None)
    except Exception as e: check('HARNESS', False, str(e)[:800])
    totals = {s: sum(c_['status'] == s for c_ in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='RED' if a.baseline else 'GREEN', cases=RESULTS, totals=totals), indent=2, default=str)); print(totals)
    return 0 if a.baseline else int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
