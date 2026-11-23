#!/usr/bin/env python3
"""Catat Pembelian Inventaris Operasional (migrasi 20261207100000_inventaris_pembelian.sql).

Native throwaway PostgreSQL only (full migration chain, fictional fixtures, unix socket, removed on exit).
Never accepts a database URL, no network. Reuses the harness of scripts/test-inventaris-operasional-postgres.py.

  python3 -I scripts/test-inventaris-pembelian-postgres.py [--pg-bin DIR] [--json out.json] [--baseline]
  (default)   chain without candidate -> fixtures -> candidate -> behaviour checks.
  --baseline  same fixtures WITHOUT the candidate: every feature case must FAIL (RED).
"""
import argparse, importlib.util, json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('invop', ROOT / 'scripts/test-inventaris-operasional-postgres.py'); assert spec and spec.loader
t = importlib.util.module_from_spec(spec); spec.loader.exec_module(t)
CANDIDATE = ROOT / 'supabase/migrations/20261207100000_inventaris_pembelian.sql'
t.CANDIDATE = CANDIDATE  # bootstrap applies every migration except this one
q, as_user, err = t.q, t.as_user, t.err
RESULTS = t.RESULTS

U = lambda n: f"e3000000-0000-4000-8000-{n:012d}"
OWNER, FIN_A, FIN_B, STAFF_A, ADMIN_A, ONLINE_A, FIN_OFF = (U(i) for i in range(1, 8))
BR_A, BR_B = U(11), U(12)
KAS_A, KAS_B, BANK_UMUM, KAS_OFF = U(21), U(22), U(23), U(24)
TODAY = (datetime.now(timezone.utc) + timedelta(hours=7)).date().isoformat()
NOTA = [dict(path='pengeluaran/1700000000000-nota-fiktif.jpg', nama='nota-fiktif.jpg', mime='image/jpeg', ukuran=12345)]
check = t.check


def fixtures(db):
    db.sql(f"""
insert into auth.users(id,email) select x, x::text||'@contoh.invalid' from unnest(array[{','.join(q(u) for u in (OWNER, FIN_A, FIN_B, STAFF_A, ADMIN_A, ONLINE_A, FIN_OFF))}]::uuid[]) x on conflict do nothing;
insert into public.profiles(id,full_name,role,is_active) values
 ({q(OWNER)},'Owner Fiktif','OWNER',true),({q(FIN_A)},'Finance Cabang A','FINANCE',true),({q(FIN_B)},'Finance Cabang B','FINANCE',true),
 ({q(STAFF_A)},'Staf Cabang A','STAFF',true),({q(ADMIN_A)},'Admin Fiktif','ADMIN',true),({q(ONLINE_A)},'Admin Online Fiktif','ADMIN_ONLINE',true),
 ({q(FIN_OFF)},'Finance Nonaktif','FINANCE',false)
 on conflict(id) do update set full_name=excluded.full_name,role=excluded.role,is_active=excluded.is_active;
insert into public.branches(id,code,name,type) values ({q(BR_A)},'BELI-A','Cabang Pilot Fiktif A','BOTH'),({q(BR_B)},'BELI-B','Cabang Pembanding Fiktif B','BOTH');
-- Finance dibatasi per cabang di fixture ini supaya isolasi cabang bisa diuji (bawaan KAMO: Finance semua cabang).
insert into public.role_capabilities(role,all_branches,create_accounts) values ('FINANCE',false,false)
 on conflict(role) do update set all_branches=false;
insert into public.user_branches(user_id,branch_id,role) values
 ({q(FIN_A)},{q(BR_A)},'PRIMARY'),({q(FIN_B)},{q(BR_B)},'PRIMARY'),({q(STAFF_A)},{q(BR_A)},'PRIMARY'),({q(ADMIN_A)},{q(BR_A)},'PRIMARY'),
 ({q(ONLINE_A)},{q(BR_A)},'PRIMARY'),({q(FIN_OFF)},{q(BR_A)},'PRIMARY');
insert into public.coa_accounts(code,name,type,normal_balance) values
 ('119901','Kas Kecil Fiktif A','ASET','D'),('119902','Kas Kecil Fiktif B','ASET','D'),('119903','Bank Umum Fiktif','ASET','D'),('119904','Kas Nonaktif Fiktif','ASET','D');
insert into public.cash_accounts(id,nama,jenis,coa_code,branch_id,is_active) values
 ({q(KAS_A)},'Kas Kecil Cabang A','Kas','119901',{q(BR_A)},true),({q(KAS_B)},'Kas Kecil Cabang B','Kas','119902',{q(BR_B)},true),
 ({q(BANK_UMUM)},'Bank Umum Fiktif','Bank','119903',null,true),({q(KAS_OFF)},'Kas Nonaktif','Kas','119904',{q(BR_A)},false);
-- Akses Grup pilot: Finance (modul keuangan bawaan) + Persediaan > Inventaris Operasional saja; STAFF juga diberi menu (untuk uji "bukan Finance").
insert into public.role_modules(role,module_id) select 'FINANCE',m from unnest(array['__role_v2__','dashboard','buku-besar','kas-bank','aset-tetap','pajak','laporan','pos-shift','pos']) m on conflict do nothing;
insert into public.role_modules(role,module_id) select 'STAFF',m from unnest(array['__role_v2__','klinik','pos']) m on conflict do nothing;
""")


def grant_menu(db):
    db.sql("""insert into role_settings_private.submenu_policies(role,module_id,allowed) values
 ('FINANCE','pos','{pos.inventaris-operasional}'),('STAFF','pos','{pos.inventaris-operasional}')
 on conflict (role,module_id) do update set allowed=excluded.allowed;""")


def beli(user, key, branch, item, qty, nominal, account, nota=None, catatan=None):
    c = 'null' if catatan is None else q(catatan)
    return as_user(user) + (f"select public.inventaris_operasional_beli({q(key)},{q(branch)},{q(json.dumps(item))}::jsonb,{qty},{nominal},"
                            f"{q(account)},{c},{q(json.dumps(NOTA if nota is None else nota))}::jsonb);")


def batal(user, key, purchase, reason='Salah input'):
    return as_user(user) + f"select public.inventaris_operasional_batal_pembelian({q(key)},{q(purchase)},{q(reason)});"


def j(db, source):
    return json.loads(db.sql(source).splitlines()[-1])


def n(db, source): return int(db.sql(source).splitlines()[-1])


def snap(db):
    return j(db, """select jsonb_build_object(
 'cash',(select count(*) from public.cash_entries),'journal',(select count(*) from public.journal_entries),
 'lines',(select count(*) from public.journal_lines),'attach',(select count(*) from public.document_attachments),
 'items',(select count(*) from public.operational_inventory_items),'qty',(select coalesce(sum(qty),0) from public.operational_inventory_items),
 'hist',(select count(*) from public.operational_inventory_history),'purch',(select count(*) from public.operational_inventory_purchases),
 'approvals_used',(select count(*) from public.approval_requests where status='terpakai'))""")


def journal_of(db, purchase):
    return j(db, f"""select jsonb_build_object('source',e.source,'ref',e.source_ref,'branch',e.branch_id,'tanggal',e.tanggal,
 'lines',(select jsonb_agg(jsonb_build_object('code',a.code,'d',l.debit,'k',l.credit) order by a.code) from public.journal_lines l join public.coa_accounts a on a.id=l.account_id where l.entry_id=e.id))
 from public.operational_inventory_purchases p join public.journal_entries e on e.id=p.journal_entry_id where p.id={q(purchase)};""")


def run_cases(db):
    grant_menu(db)
    base = snap(db)

    # 1. Finance A: barang baru.
    r1 = j(db, beli(FIN_A, 'beli-a-000001', BR_A, dict(nama='Ember', satuan='pcs'), 3, 75000, KAS_A, catatan='Toko Fiktif'))
    after = snap(db)
    check('Finance cabang A mencatat pembelian barang baru: 1 kas, 1 jurnal (2 baris), 1 nota, 1 barang, 1 riwayat',
          {k: after[k] - base[k] for k in after} == dict(cash=1, journal=1, lines=2, attach=1, items=1, qty=3, hist=1, purch=1, approvals_used=0), after)
    cash = j(db, f"select to_jsonb(c) from public.cash_entries c where c.id={q(r1['cash_entry_id'])};")
    check('Kas Keluar biasa: jenis Keluar, nomor KK bulan ini, rekening kas cabang A, akun lawan 740001, nominal, cabang, jurnal terhubung',
          cash['jenis'] == 'Keluar' and cash['no_bukti'] == f"KK.{TODAY[:4]}.{TODAY[5:7]}.00001" and cash['account_id'] == KAS_A
          and cash['lawan_code'] == '740001' and float(cash['jumlah']) == 75000 and cash['branch_id'] == BR_A
          and cash['journal_entry_id'] == r1['journal_id'] and cash['tanggal'] == TODAY and cash['voided_at'] is None, cash)
    jr = journal_of(db, r1['purchase_id'])
    check('jurnal seimbang: Dr 740001 Beban Perlengkapan 75.000 / Cr 119901 Kas Kecil A 75.000, sumber kas-entry = no bukti',
          jr['source'] == 'kas-entry' and jr['ref'] == cash['no_bukti'] and jr['branch'] == BR_A and jr['tanggal'] == TODAY
          and jr['lines'] == [dict(code='119901', d=0, k=75000), dict(code='740001', d=75000, k=0)], jr)
    att = j(db, f"select jsonb_agg(jsonb_build_object('modul',modul,'path',path,'by',uploaded_by)) from public.document_attachments where ref_id={q(r1['cash_entry_id'])};")
    check('nota tersimpan di lampiran Kas Keluar (modul pengeluaran) oleh Finance', att == [dict(modul='pengeluaran', path=NOTA[0]['path'], by=FIN_A)], att)
    h = j(db, f"select jsonb_agg(jsonb_build_object('jenis',jenis,'sebelum',qty_sebelum,'sesudah',qty_sesudah,'pelaku',actor_nama)) from public.operational_inventory_history where purchase_id={q(r1['purchase_id'])};")
    check('riwayat pembelian 0 -> 3 terhubung ke pembelian, pelaku Finance', h == [dict(jenis='pembelian', sebelum=0, sesudah=3, pelaku='Finance Cabang A')], h)

    # 2. Barang lama (saldo awal tanpa jurnal) lalu dibeli: tidak ada jurnal retroaktif untuk saldo awal.
    db.sql(t.tambah(FIN_A, 'tambah-sapu-0001', BR_A, 'Sapu', 'pcs', 1))
    sapu = db.sql(f"select id from public.operational_inventory_items where branch_id={q(BR_A)} and nama='Sapu';")
    j0 = n(db, "select count(*) from public.journal_entries")
    check('barang lama (sapu, saldo awal 1) tidak dijurnal retroaktif', n(db, "select count(*) from public.journal_entries") == j0 and
          n(db, f"select count(*) from public.operational_inventory_purchases where item_id={q(sapu)}") == 0)
    r2 = j(db, beli(FIN_A, 'beli-a-000002', BR_A, dict(id=sapu), 2, 30000, BANK_UMUM))
    check('pembelian barang terdaftar: sapu 1 -> 3, revisi naik; rekening umum (tanpa cabang) sah untuk cabang A',
          db.sql(f"select qty||'/'||revision from public.operational_inventory_items where id={q(sapu)};") == '3.00/2'
          and journal_of(db, r2['purchase_id'])['lines'] == [dict(code='119903', d=0, k=30000), dict(code='740001', d=30000, k=0)])
    check('nomor KK berurutan', r2['no_bukti'] == f"KK.{TODAY[:4]}.{TODAY[5:7]}.00002", r2)

    # 3. Kirim ulang / kunci dipakai ulang / bersamaan.
    s0 = snap(db)
    again = j(db, beli(FIN_A, 'beli-a-000001', BR_A, dict(nama='Ember', satuan='pcs'), 3, 75000, KAS_A, catatan='Toko Fiktif'))
    check('kirim ulang (kunci + isi sama) mengembalikan hasil pertama tanpa kas/jurnal/jumlah baru', again == r1 and snap(db) == s0, again)
    e = err(db, beli(FIN_A, 'beli-a-000001', BR_A, dict(nama='Ember', satuan='pcs'), 4, 75000, KAS_A, catatan='Toko Fiktif'))
    check('kunci sama dengan isi berbeda ditolak, tidak ada perubahan', e is not None and 'Kunci permintaan sudah dipakai' in e and snap(db) == s0, (e or '')[:160])
    ember = r1['item_id']
    with ThreadPoolExecutor(2) as pool:
        outs = list(pool.map(lambda _: j(db, beli(FIN_A, 'beli-a-paralel', BR_A, dict(id=ember), 1, 25000, KAS_A)), range(2)))
    check('dua kiriman bersamaan (klik ganda) = satu pembelian, satu kas, qty +1', outs[0] == outs[1]
          and n(db, "select count(*) from public.operational_inventory_purchases where request_key='beli-a-paralel'") == 1
          and db.sql(f"select qty from public.operational_inventory_items where id={q(ember)};") == '4.00', outs)

    # 4. Hak akses.
    s0 = snap(db)
    for who, label, code in ((STAFF_A, 'staf cabang (lolos menu)', 'INVENTARIS_PEMBELIAN_FINANCE'), (ADMIN_A, 'Admin', 'INVENTARIS_PEMBELIAN_FINANCE'),
                             (OWNER, 'Owner', 'INVENTARIS_PEMBELIAN_FINANCE'), (FIN_OFF, 'Finance nonaktif', 'Akun tidak aktif'), (ONLINE_A, 'Admin Online', 'ADMIN_ONLINE')):
        e = err(db, beli(who, 'beli-tolak-' + who[-4:], BR_A, dict(id=ember), 1, 1000, KAS_A))
        check(f'bukan Finance aktif ditolak: {label}', e is not None and code in e and snap(db) == s0, (e or '')[:160])
    e = err(db, beli(FIN_A, 'beli-a-ke-b-01', BR_B, dict(nama='Kain', satuan='pcs'), 1, 1000, KAS_B))
    check('Finance cabang A ditolak mencatat di cabang B', e is not None and 'INVENTARIS_CABANG_DITOLAK' in e and snap(db) == s0, (e or '')[:160])
    e = err(db, beli(FIN_A, 'beli-a-kasb-01', BR_A, dict(id=ember), 1, 1000, KAS_B))
    check('kas milik cabang B ditolak untuk pembelian cabang A', e is not None and 'INVENTARIS_KAS_TIDAK_SAH' in e and snap(db) == s0, (e or '')[:160])
    e = err(db, beli(FIN_A, 'beli-a-kasoff-1', BR_A, dict(id=ember), 1, 1000, KAS_OFF))
    check('kas nonaktif ditolak', e is not None and 'INVENTARIS_KAS_TIDAK_SAH' in e and snap(db) == s0, (e or '')[:160])
    e = err(db, beli(FIN_B, 'beli-b-item-a1', BR_B, dict(id=ember), 1, 1000, KAS_B))
    check('barang cabang A tidak bisa dibeli atas nama cabang B', e is not None and 'Barang tidak ditemukan di cabang ini' in e and snap(db) == s0, (e or '')[:160])
    db.sql("update role_settings_private.submenu_policies set allowed='{pos.stok}' where role='FINANCE';")
    e = err(db, beli(FIN_A, 'beli-a-nomenu-1', BR_A, dict(id=ember), 1, 1000, KAS_A))
    check('Finance tanpa centang sub-menu Inventaris Operasional ditolak (gerbang menu sempit)', e is not None and 'INVENTARIS_MENU_DITOLAK' in e and snap(db) == s0, (e or '')[:160])
    check('Finance tanpa menu tidak membaca pembelian', n(db, as_user(FIN_A) + "select count(*) from public.operational_inventory_purchases;") == 0)
    grant_menu(db)
    check('akses Finance tidak membuka modul lain: hanya sub-menu pos.inventaris-operasional di modul Persediaan',
          db.sql("select allowed::text from role_settings_private.submenu_policies where role='FINANCE' and module_id='pos';") == '{pos.inventaris-operasional}')
    check('isolasi baca: Finance B tidak melihat pembelian/kas pembelian cabang A',
          n(db, as_user(FIN_B) + f"select count(*) from public.operational_inventory_purchases where branch_id={q(BR_A)};") == 0)

    # 5. Nota wajib.
    for label, nota in (('tanpa nota', []), ('path di luar folder pengeluaran', [dict(path='lain/x.jpg', nama='x.jpg', mime='image/jpeg', ukuran=10)]),
                        ('path menyusup ..', [dict(path='pengeluaran/../x.jpg', nama='x.jpg', mime='image/jpeg', ukuran=10)])):
        e = err(db, beli(FIN_A, 'beli-nota-' + str(len(label)), BR_A, dict(id=ember), 1, 1000, KAS_A, nota=nota))
        check(f'nota wajib & valid: {label} ditolak', e is not None and 'INVENTARIS_NOTA_WAJIB' in e and snap(db) == s0, (e or '')[:160])
    for label, qty, nominal in (('jumlah 0', 0, 1000), ('nominal 0', 1, 0), ('nominal 3 desimal', 1, 1000.123)):
        e = err(db, beli(FIN_A, 'beli-angka-' + label.replace(' ', '-'), BR_A, dict(id=ember), qty, nominal, KAS_A))
        check(f'angka tidak valid ditolak: {label}', e is not None and snap(db) == s0, (e or '')[:160])

    # 6. Kegagalan atomik di tengah (setelah kas & jurnal ditulis): semuanya batal, termasuk barang baru dan persetujuan.
    db.sql("alter table public.document_attachments add constraint uji_gagal_nota check (nama is distinct from 'GAGAL.jpg');")
    db.sql("insert into public.approval_rules(jenis,min_nilai,penyetuju_role,is_active) values ('kas-keluar',1000000,'OWNER',true);")
    key = '|'.join(['kas', TODAY, KAS_A, '740001', '1500000'])
    db.sql(f"insert into public.approval_requests(jenis,ref_id,nilai,penyetuju_role,status,diajukan_oleh) values ('kas-keluar',{q(key)},1500000,'OWNER','disetujui',{q(FIN_A)});")
    s0 = snap(db)
    e = err(db, beli(FIN_A, 'beli-gagal-0001', BR_A, dict(nama='Alat pel', satuan='pcs'), 2, 1500000, KAS_A,
                     nota=[dict(path='pengeluaran/gagal.jpg', nama='GAGAL.jpg', mime='image/jpeg', ukuran=10)]))
    check('kegagalan simpan nota setelah kas+jurnal dibuat: semuanya batal (kas, jurnal, barang baru, jumlah, persetujuan)',
          e is not None and 'uji_gagal_nota' in e and snap(db) == s0
          and db.sql(f"select status from public.approval_requests where ref_id={q(key)};") == 'disetujui', (e or '')[:160])
    db.sql("alter table public.document_attachments drop constraint uji_gagal_nota;")

    # 7. Persetujuan Kas Keluar tetap berlaku.
    e = err(db, beli(FIN_A, 'beli-besar-0001', BR_A, dict(id=ember), 1, 1200000, KAS_A))
    check('di atas batas persetujuan tanpa pengajuan disetujui ditolak', e is not None and 'INVENTARIS_PERLU_PERSETUJUAN' in e and snap(db) == s0, (e or '')[:160])
    r3 = j(db, beli(FIN_A, 'beli-besar-0002', BR_A, dict(nama='Alat pel', satuan='pcs'), 2, 1500000, KAS_A))
    check('dengan pengajuan disetujui (kunci sama dengan Kas Keluar biasa): tersimpan dan pengajuan jadi terpakai',
          r3.get('purchase_id') and db.sql(f"select status from public.approval_requests where ref_id={q(key)};") == 'terpakai', r3)
    e = err(db, beli(FIN_A, 'beli-besar-0003', BR_A, dict(id=r3['item_id']), 2, 1500000, KAS_A))
    check('persetujuan dipakai sekali: pembelian berikutnya dengan nilai sama butuh pengajuan baru', e is not None and 'INVENTARIS_PERLU_PERSETUJUAN' in e, (e or '')[:160])
    db.sql("update public.approval_rules set is_active=false where jenis='kas-keluar';")

    # 8. Jalur kas umum tidak bisa membatalkan/mengubah Kas Keluar pembelian.
    s0 = snap(db)
    rev = lambda action, k: as_user(FIN_A) + (f"select public.revise_cash_entry({q(k)},{q(r1['cash_entry_id'])},0,{q(action)},"
                                               f"{q(json.dumps({'jumlah': 1}) if action == 'edit' else '{}')}::jsonb,'koreksi lewat kas umum');")
    for action in ('void', 'edit'):
        e = err(db, rev(action, 'kas-umum-' + action))
        check(f'jalur kas umum ({action}) ditolak untuk Kas Keluar pembelian', e is not None and 'INVENTARIS_KAS_TERKUNCI' in e and snap(db) == s0, (e or '')[:160])
    e = err(db, as_user(FIN_A) + f"delete from public.cash_entries where id={q(r1['cash_entry_id'])};")
    check('hapus langsung Kas Keluar pembelian ditolak', e is not None and 'INVENTARIS_KAS_TERKUNCI' in e and snap(db) == s0, (e or '')[:160])
    e = err(db, as_user(FIN_A) + f"delete from public.document_attachments where ref_id={q(r1['cash_entry_id'])};")
    check('hapus nota pembelian ditolak', e is not None and 'INVENTARIS_NOTA_TERKUNCI' in e and snap(db) == s0, (e or '')[:160])
    e = err(db, f"update public.cash_entries set jumlah=1 where id={q(r1['cash_entry_id'])};")
    check('bahkan pemilik database tidak bisa mengubah Kas Keluar pembelian tanpa jalur resmi', e is not None and 'INVENTARIS_KAS_TERKUNCI' in e, (e or '')[:160])
    # Regresi: Kas Keluar biasa (bukan pembelian) tetap bisa dibatalkan lewat jalur kas umum.
    db.sql(f"""select public.sales_write_journal(current_date,{q(BR_A)},'kas-entry','KK-UJI-BIASA','Kas biasa',
 '[{{"code":"760003","debit":5000,"credit":0}},{{"code":"119901","debit":0,"credit":5000}}]'::jsonb);
insert into public.cash_entries(id,no_bukti,jenis,tanggal,account_id,lawan_code,jumlah,branch_id,journal_entry_id)
 select {q(U(90))},'KK-UJI-BIASA','Keluar',current_date,{q(KAS_A)},'760003',5000,{q(BR_A)},id from public.journal_entries where source_ref='KK-UJI-BIASA';""")
    r = j(db, as_user(FIN_A) + f"select public.revise_cash_entry('kas-biasa-void',{q(U(90))},0,'void','{{}}'::jsonb,'regresi kas biasa');")
    check('regresi: Kas Keluar biasa tetap bisa dibatalkan lewat jalur kas umum', bool(r.get('revision_id')), r)

    # 9. Pembatalan resmi dari menu Inventaris Operasional.
    e = err(db, batal(STAFF_A, 'batal-staf-001', r1['purchase_id']))
    check('pembatalan oleh selain Finance ditolak', e is not None and 'INVENTARIS_PEMBELIAN_FINANCE' in e, (e or '')[:160])
    qty0 = float(db.sql(f"select qty from public.operational_inventory_items where id={q(ember)};"))
    b = j(db, batal(FIN_A, 'batal-a-000001', r1['purchase_id']))
    rev_lines = j(db, f"""select jsonb_agg(jsonb_build_object('code',a.code,'d',l.debit,'k',l.credit) order by a.code) from public.cash_entry_revisions r
 join public.journal_lines l on l.entry_id=r.reversal_journal_id join public.coa_accounts a on a.id=l.account_id where r.id={q(b['cash_revision_id'])};""")
    check('batal: Kas Keluar dibatalkan lewat jalur resmi dengan jurnal pembalik Dr kas / Cr beban',
          db.sql(f"select voided_at is not null from public.cash_entries where id={q(r1['cash_entry_id'])};") == 't'
          and rev_lines == [dict(code='119901', d=75000, k=0), dict(code='740001', d=0, k=75000)], rev_lines)
    check('batal: jumlah barang berkurang 3 dan riwayat batal_pembelian tercatat; pembelian ditandai batal',
          float(db.sql(f"select qty from public.operational_inventory_items where id={q(ember)};")) == qty0 - 3
          and n(db, f"select count(*) from public.operational_inventory_history where purchase_id={q(r1['purchase_id'])} and jenis='batal_pembelian'") == 1
          and db.sql(f"select voided_at is not null and void_reason='Salah input' from public.operational_inventory_purchases where id={q(r1['purchase_id'])};") == 't')
    net = j(db, f"""select jsonb_object_agg(code,saldo) from (select a.code, sum(l.debit-l.credit) saldo from public.journal_lines l join public.coa_accounts a on a.id=l.account_id
 where l.entry_id in ({q(r1['journal_id'])},(select reversal_journal_id from public.cash_entry_revisions where id={q(b['cash_revision_id'])})) group by a.code) x;""")
    check('batal: saldo akun kas & beban kembali netral untuk pembelian itu', {k: float(v) for k, v in net.items()} == {'119901': 0.0, '740001': 0.0}, net)
    s0 = snap(db)
    check('batal dikirim ulang (kunci sama) = hasil sama, tanpa perubahan', j(db, batal(FIN_A, 'batal-a-000001', r1['purchase_id'])) == b and snap(db) == s0)
    e = err(db, batal(FIN_A, 'batal-a-000002', r1['purchase_id']))
    check('pembelian yang sudah batal tidak bisa dibatalkan lagi', e is not None and 'sudah dibatalkan' in e, (e or '')[:160])
    # Batal ditolak bila jumlah sekarang < jumlah pembelian (mis. sudah diopname turun); tidak ada yang berubah.
    items = j(db, f"select jsonb_agg(jsonb_build_object('item_id',id,'revision',revision,'qty',qty)) from public.operational_inventory_items where branch_id={q(BR_A)} and is_active;")
    lines = [dict(item_id=i['item_id'], revision=i['revision'], qty_fisik=(0 if i['item_id'] == r3['item_id'] else float(i['qty'])),
                  alasan=('hilang' if i['item_id'] == r3['item_id'] else None)) for i in items]
    jb = n(db, "select count(*) from public.journal_entries")
    db.sql(t.opname(FIN_A, 'opname-setelah-beli', BR_A, lines))
    check('opname tetap kuantitas saja: tidak membuat jurnal setelah ada pembelian', n(db, "select count(*) from public.journal_entries") == jb)
    s0 = snap(db)
    e = err(db, batal(FIN_A, 'batal-kurang-01', r3['purchase_id']))
    check('batal ditolak bila jumlah barang sekarang lebih kecil dari pembelian; kas & jumlah tidak berubah',
          e is not None and 'INVENTARIS_BATAL_KURANG' in e and snap(db) == s0
          and db.sql(f"select voided_at is null from public.cash_entries where id={q(r3['cash_entry_id'])};") == 't', (e or '')[:160])

    # 10. Opname lama ditolak setelah pembelian mengubah saldo (revisi).
    stale = [dict(item_id=i['item_id'], revision=i['revision'], qty_fisik=float(i['qty'])) for i in items]
    e = err(db, t.opname(FIN_A, 'opname-basi-0001', BR_A, stale))
    check('opname dengan data sebelum pembelian/opname ditolak (saldo berubah sejak dibaca)', e is not None and 'INVENTARIS_SALDO_BERUBAH' in e, (e or '')[:160])

    # 11. Ganti akun beban dengan aman.
    for bad, label in (('740000', 'akun induk'), ('119901', 'akun rekening kas'), ('999999', 'tidak ada')):
        e = err(db, f"update public.operational_inventory_settings set beban_code='{bad}' where id;")
        check(f'ganti akun beban ditolak: {label}', e is not None and 'Akun beban pembelian inventaris' in e, (e or '')[:160])
    db.sql("update public.operational_inventory_settings set beban_code='740002' where id;")
    r4 = j(db, beli(FIN_A, 'beli-akun-baru-1', BR_A, dict(id=ember), 1, 10000, KAS_A))
    check('setelah ganti akun: pembelian baru ke akun baru; pembelian lama tetap di akun lama',
          journal_of(db, r4['purchase_id'])['lines'][1]['code'] == '740002'
          and db.sql(f"select beban_code from public.operational_inventory_purchases where id={q(r2['purchase_id'])};") == '740001'
          and journal_of(db, r2['purchase_id'])['lines'][1]['code'] == '740001')

    # 12. Semua jurnal pembelian seimbang dan tidak ada stok barang jual yang berubah.
    check('semua jurnal pembelian & pembalik seimbang', n(db, """select count(*) from (select l.entry_id from public.journal_lines l
 where l.entry_id in (select journal_entry_id from public.operational_inventory_purchases union select reversal_journal_id from public.cash_entry_revisions)
 group by l.entry_id having sum(l.debit)<>sum(l.credit)) x""") == 0)
    check('tidak menyentuh barang jual / stok', n(db, "select count(*) from public.stock") == 0 and n(db, "select count(*) from public.items") == 0)


def static_checks(db):
    check('kebijakan baca pembelian memakai gerbang menu DAN akses cabang',
          db.sql("select count(*) from pg_policies where tablename='operational_inventory_purchases' and cmd='SELECT' and qual ~ 'inventaris_operasional_allowed' and qual ~ 'user_can_access_branch'") == '1', kind='static')
    check('fungsi tulis pembelian diberi penjaga Admin Online', db.sql("select count(*) from pg_proc where proname in ('inventaris_operasional_beli','inventaris_operasional_batal_pembelian') and prosrc ~ 'deny_admin_online'") == '2', kind='static')
    check('authenticated tidak punya hak tulis ke tabel pembelian & pengaturan',
          db.sql("select bool_or(has_table_privilege('authenticated','public.'||x,p)) from unnest(array['operational_inventory_purchases','operational_inventory_settings']) x, unnest(array['insert','update','delete']) p") == 'f', kind='static')
    check('izin pembatalan tidak tersisa setelah transaksi', db.sql("select count(*) from invop_private.cash_permits") == '0', kind='static')
    check('anon tidak bisa memanggil fungsi pembelian', db.sql("select bool_or(has_function_privilege('anon',f,'execute')) from unnest(array['public.inventaris_operasional_beli(text,uuid,jsonb,numeric,numeric,uuid,text,jsonb)','public.inventaris_operasional_batal_pembelian(text,uuid,text)']) f") == 'f', kind='static')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path); ap.add_argument('--baseline', action='store_true')
    ap.add_argument('--pg-bin', default=os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin')); a = ap.parse_args()
    try:
        with t.Pg(a.pg_bin) as db:
            t.bootstrap(db); fixtures(db)
            if not a.baseline:
                db.sql('begin;\n' + CANDIDATE.read_text() + '\ncommit;'); print('Applied candidate ' + CANDIDATE.name, flush=True)
            try: run_cases(db)
            except Exception as e: check('SECTION cases aborted', False, str(e)[:700], 'feature' if a.baseline else 'harness')
            if not a.baseline: static_checks(db)
    except Exception as e: check('HARNESS', False, str(e)[:800], 'harness')
    if a.baseline:
        ok = all(c['status'] == 'FAIL' for c in RESULTS if c['kind'] == 'feature') and not any(c['kind'] == 'harness' for c in RESULTS)
        print(f"BASELINE: {sum(c['status'] == 'FAIL' for c in RESULTS)}/{len(RESULTS)} RED", flush=True)
    else:
        ok = all(c['status'] == 'PASS' for c in RESULTS)
        print(f"{sum(c['status'] == 'PASS' for c in RESULTS)}/{len(RESULTS)} PASS", flush=True)
    if a.json: a.json.write_text(json.dumps(dict(candidate=CANDIDATE.name, baseline=a.baseline, ok=ok, results=RESULTS), indent=1, default=str))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
