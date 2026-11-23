#!/usr/bin/env python3
"""Inventaris Operasional (23 Nov 2026): perlengkapan cabang, opname kuantitas, riwayat. Migrasi
20261206100000_inventaris_operasional.sql.

Native throwaway PostgreSQL only (full migration chain, fictional fixtures, unix socket, removed on exit).
Never accepts a database URL, no network.

  python3 -I scripts/test-inventaris-operasional-postgres.py [--pg-bin DIR] [--json out.json] [--baseline]
  (default)   chain without candidate -> fixtures -> candidate -> behaviour checks.
  --baseline  same fixtures WITHOUT the candidate: every feature case must FAIL (RED).
"""
import argparse, json, os, shutil, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
CANDIDATE = ROOT / 'supabase/migrations/20261206100000_inventaris_operasional.sql'
HOSTED_AUTH_UID = (ROOT / 'supabase/tests/fixtures/hosted_auth_uid.sql').read_text()
RESULTS = []

U = lambda n: f"e1000000-0000-4000-8000-{n:012d}"
OWNER, STAFF_A, STAFF_B, ONLINE_A, INACTIVE_A, STAFF_A2, ADMIN_A, FIN_A, DOC_A = U(1), U(2), U(3), U(4), U(5), U(6), U(7), U(8), U(9)
BR_A, BR_B = U(11), U(12)
OWN_TABLES = {'operational_inventory_items', 'operational_inventory_counts', 'operational_inventory_history'}


class Pg:
    """Same contract as scripts/native_postgres.NativePostgres, temp dir under the system temp root."""
    def __init__(self, bin_dir):
        self.bin = Path(bin_dir); p = self.bin / 'psql'
        self.psql = str(p) if p.exists() else shutil.which('psql'); assert self.psql, 'psql not found'

    def __enter__(self):
        self.root = Path(tempfile.mkdtemp(prefix='pgk.'))
        self.as_user = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
        if self.as_user: shutil.chown(self.root, 'postgres')
        self.run(self.bin / 'initdb', '-D', self.root / 'data', '-U', 'postgres', '-E', 'UTF8', '--locale=C.UTF-8', '-A', 'trust')
        self.run(self.bin / 'pg_ctl', '-D', self.root / 'data', '-l', self.root / 'log', '-w', 'start',
                 '-o', f"-c listen_addresses='' -k {self.root} -c timezone=Etc/UTC -c shared_buffers=64MB -c max_connections=20")
        return self

    def __exit__(self, *_):
        subprocess.run(self.as_user + [str(self.bin / 'pg_ctl'), '-D', str(self.root / 'data'), '-m', 'fast', '-w', 'stop'], capture_output=True)
        shutil.rmtree(self.root, ignore_errors=True)
        print('Stopped and removed the throwaway PostgreSQL cluster.', flush=True)

    def run(self, *args):
        subprocess.run(self.as_user + [str(a) for a in args], check=True, capture_output=True)

    def sql(self, source):
        res = subprocess.run(self.as_user + [self.psql, '-X', '-qAt', '-h', str(self.root), '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                             input=source, text=True, capture_output=True, env={**os.environ, 'PSQLRC': '/dev/null'})
        if res.returncode: raise RuntimeError(res.stderr + res.stdout)
        return res.stdout.strip()


def q(v): return "'" + str(v).replace("'", "''") + "'"


def as_user(user, branch_header=None):
    headers = json.dumps({'x-kamo-operational-branch': branch_header} if branch_header else {})
    claims = json.dumps({'role': 'authenticated', 'sub': user})
    return (f"set role authenticated; select set_config('request.jwt.claims',{q(claims)},false);"
            f"select set_config('request.headers',{q(headers)},false);\n")


def check(name, ok, detail=None, kind='feature'):
    RESULTS.append(dict(case=name, kind=kind, status='PASS' if ok else 'FAIL', detail=detail))
    print(RESULTS[-1]['status'], f'[{kind}]', name, json.dumps(detail, default=str)[:400], flush=True)


def apply_later(db):
    """Migrations numbered after the candidate (they depend on its tables); applied in order after it."""
    later = [m for m in sorted((ROOT / 'supabase/migrations').glob('*.sql')) if m.name > CANDIDATE.name]
    for m in later:
        try: db.sql('begin;\n' + m.read_text() + '\ncommit;')
        except RuntimeError as e: raise RuntimeError(m.name + ': ' + str(e)[:1500]) from e
    if later: print(f'Applied {len(later)} later migrations.', flush=True)


def bootstrap(db):
    db.sql("""create extension if not exists pgcrypto;
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
""" + HOSTED_AUTH_UID + """
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
create publication supabase_realtime;
grant usage on schema public,auth,storage to authenticated,anon,service_role;
grant execute on all functions in schema auth to authenticated,anon,service_role;
alter default privileges in schema public grant all on tables to authenticated,service_role;
alter default privileges in schema public grant all on sequences to authenticated,service_role;
""")
    # Only migrations BEFORE the candidate: later ones (e.g. 20261207100000_inventaris_pembelian) build on its tables
    # and are applied after it by apply_later().
    migrations = [m for m in sorted((ROOT / 'supabase/migrations').glob('*.sql')) if m.name < CANDIDATE.name]
    for m in migrations:
        if m.name.startswith('0068'):
            db.sql("insert into coa_accounts(code,name,type,normal_balance) values('1101','Fictional cash','ASET','D'),('1102','Fictional bank','ASET','D') on conflict do nothing;")
        if m.name == '20261123084004_kategori_pengeluaran_rinci.sql':
            # This migration expects account codes that were seeded in production.
            db.sql("""insert into public.coa_accounts(code,name,type,normal_balance) values
 ('740021','Fictional meal expense','BEBAN','D'),('740022','Fictional supply expense','BEBAN','D')
 on conflict (code) do nothing;""")
        if m.name == '20261123085116_sambung_jurnal_pengeluaran_klinik_awal_nov.sql':
            # Exercise the historical link repair with fictional rows only.
            db.sql("""
insert into public.branches(id,code,name,type)
 values ('e1000000-0000-4000-8000-000000000020','INV-HIST','Cabang Riwayat Fiktif','BOTH');
with inserted_expenses as (
 insert into public.expenses(branch_id,tanggal,kategori,jumlah)
 select 'e1000000-0000-4000-8000-000000000020','2026-11-01','Uang Makan',100
 from generate_series(1,13)
 returning id,branch_id,tanggal
), inserted_journals as (
 insert into public.journal_entries(branch_id,tanggal,source,source_ref)
 select branch_id,tanggal,'expense',id::text from inserted_expenses
 returning id
)
insert into public.journal_lines(entry_id,account_id,debit)
 select j.id,a.id,100 from inserted_journals j
 cross join public.coa_accounts a where a.code='740021';
""")
        try: db.sql('begin;\n' + m.read_text() + '\ncommit;')
        except RuntimeError as e: raise RuntimeError(m.name + ': ' + str(e)[:1500]) from e
    print(f'Applied {len(migrations)} migrations (without candidate).', flush=True)


def fixtures(db):
    db.sql(f"""
insert into auth.users(id,email) values ({q(STAFF_A2)},'a2@contoh.invalid'),({q(ADMIN_A)},'adm@contoh.invalid'),({q(FIN_A)},'fin@contoh.invalid'),({q(DOC_A)},'doc@contoh.invalid') on conflict do nothing;
insert into public.profiles(id,full_name,role,is_active) values
 ({q(STAFF_A2)},'Staf Cabang A Tanpa Menu','STAFF',true),({q(ADMIN_A)},'Admin Fiktif','ADMIN',true),({q(FIN_A)},'Finance Fiktif','FINANCE',true),({q(DOC_A)},'Dokter Fiktif','DOCTOR',true)
 on conflict(id) do update set full_name=excluded.full_name,role=excluded.role,is_active=excluded.is_active;
""")
    db.sql(f"""
insert into auth.users(id,email) values ({q(OWNER)},'owner@contoh.invalid'),({q(STAFF_A)},'a@contoh.invalid'),({q(STAFF_B)},'b@contoh.invalid'),
 ({q(ONLINE_A)},'online@contoh.invalid'),({q(INACTIVE_A)},'off@contoh.invalid') on conflict do nothing;
insert into public.profiles(id,full_name,role,is_active) values
 ({q(OWNER)},'Owner Fiktif','OWNER',true),({q(STAFF_A)},'Staf Cabang A','STAFF',true),({q(STAFF_B)},'Staf Cabang B','STAFF',true),
 ({q(ONLINE_A)},'Admin Online Fiktif','ADMIN_ONLINE',true),({q(INACTIVE_A)},'Staf Nonaktif','STAFF',false)
 on conflict(id) do update set full_name=excluded.full_name,role=excluded.role,is_active=excluded.is_active;
insert into public.branches(id,code,name,type) values ({q(BR_A)},'INV-A','Cabang Pilot Fiktif A','BOTH'),({q(BR_B)},'INV-B','Cabang Pembanding Fiktif B','BOTH');
insert into public.user_branches(user_id,branch_id,role) values
 ({q(STAFF_A)},{q(BR_A)},'PRIMARY'),({q(STAFF_B)},{q(BR_B)},'PRIMARY'),({q(ONLINE_A)},{q(BR_A)},'PRIMARY'),({q(INACTIVE_A)},{q(BR_A)},'PRIMARY'),
 ({q(STAFF_A2)},{q(BR_A)},'PRIMARY'),({q(ADMIN_A)},{q(BR_A)},'PRIMARY'),({q(FIN_A)},{q(BR_A)},'PRIMARY'),({q(DOC_A)},{q(BR_A)},'PRIMARY');
""")


def err(db, source):
    try: db.sql(source); return None
    except RuntimeError as e: return str(e)


def counts_snapshot(db):
    """Row count of every public table except the module's own (proves no journal/stock/asset side effect)."""
    return json.loads(db.sql("""select coalesce(jsonb_object_agg(t, n),'{}') from (
 select c.relname t, (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', c.relname), false, true, '')))[1]::text::bigint n
 from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind in ('r','p')) z;"""))


def tambah(user, key, branch, nama, satuan, qty, header=None):
    return as_user(user, header) + f"select public.inventaris_operasional_tambah({q(key)},{q(branch)},{q(nama)},{q(satuan)},{qty});"


def opname(user, key, branch, lines, catatan=None, header=None):
    c = 'null' if catatan is None else q(catatan)
    return as_user(user, header) + f"select public.inventaris_operasional_opname({q(key)},{q(branch)},{q(json.dumps(lines))}::jsonb,{c});"


def items(db, branch):
    raw = db.sql(f"select coalesce(jsonb_agg(jsonb_build_object('id',id,'nama',nama,'qty',qty,'rev',revision) order by nama),'[]') from public.operational_inventory_items where branch_id={q(branch)};")
    return {r['nama']: r for r in json.loads(raw)}


def n(db, source): return int(db.sql(source))


STAFF_GRANT = """
delete from role_settings_private.account_access_overrides;
delete from role_settings_private.submenu_policies where role='STAFF';
delete from public.role_modules where role='STAFF';
insert into public.role_modules(role,module_id) values ('STAFF','__role_v2__'),('STAFF','klinik'),('STAFF','pos');
insert into role_settings_private.submenu_policies(role,module_id,allowed) values ('STAFF','pos','{pos.inventaris-operasional}');
"""


def run_cases(db):
    # Pilot: Owner memberi peran STAFF Persediaan > Inventaris Operasional saja lewat Akses Grup.
    db.sql(STAFF_GRANT)
    before = counts_snapshot(db)

    # 1. Daftar perlengkapan cabang A (saldo awal tercatat sebagai riwayat).
    ids = {}
    for key, nama, qty in (('tambah-sapu-0001', 'Sapu', 5), ('tambah-ember-001', 'Ember', 3), ('tambah-pel-00001', 'Alat pel', 2)):
        ids[nama] = db.sql(tambah(STAFF_A, key, BR_A, nama, 'pcs', qty)).splitlines()[-1]
    a = items(db, BR_A)
    check('daftar: 3 barang cabang A tercatat dengan nama, satuan, jumlah',
          {k: (float(v['qty']), v['rev']) for k, v in a.items()} == {'Sapu': (5.0, 1), 'Ember': (3.0, 1), 'Alat pel': (2.0, 1)}, a)
    check('daftar: saldo awal masuk riwayat dengan pelaku dan sebelum 0 -> sesudah',
          db.sql(f"select string_agg(jenis||':'||qty_sebelum||'>'||qty_sesudah||':'||actor_nama, ',' order by qty_sesudah) from public.operational_inventory_history where branch_id={q(BR_A)};")
          == 'saldo_awal:0.00>2.00:Staf Cabang A,saldo_awal:0.00>3.00:Staf Cabang A,saldo_awal:0.00>5.00:Staf Cabang A')
    retry = db.sql(tambah(STAFF_A, 'tambah-sapu-0001', BR_A, 'Sapu', 'pcs', 5)).splitlines()[-1]
    check('klik ganda tambah: kiriman ulang mengembalikan barang yang sama, tidak dobel',
          retry == ids['Sapu'] and n(db, f"select count(*) from public.operational_inventory_items where branch_id={q(BR_A)}") == 3)
    e = err(db, tambah(STAFF_A, 'tambah-sapu-0001', BR_A, 'Sapu', 'pcs', 9))
    check('kunci yang sama dengan isi berbeda ditolak', e is not None and 'Kunci permintaan sudah dipakai' in e, (e or '')[:200])
    e = err(db, tambah(STAFF_A, 'tambah-sapu-0002', BR_A, 'sapu', 'PCS', 1))
    check('nama+satuan kembar di cabang yang sama ditolak', e is not None and 'sudah ada di cabang ini' in e, (e or '')[:200])
    db.sql(tambah(STAFF_B, 'tambah-b-sapu-01', BR_B, 'Sapu', 'pcs', 7))

    # 2. Isolasi cabang.
    check('isolasi: staf A hanya melihat barang cabang A',
          db.sql(as_user(STAFF_A) + "select string_agg(distinct branch_id::text, ',') from public.operational_inventory_items;").splitlines()[-1] == BR_A)
    check('isolasi: staf B tidak melihat riwayat cabang A',
          db.sql(as_user(STAFF_B) + f"select count(*) from public.operational_inventory_history where branch_id={q(BR_A)};").splitlines()[-1] == '0')
    e = err(db, tambah(STAFF_A, 'tambah-a-ke-b-1', BR_B, 'Ember', 'pcs', 1))
    check('isolasi: staf A tidak bisa menambah barang di cabang B', e is not None and 'INVENTARIS_CABANG_DITOLAK' in e, (e or '')[:200])
    b = items(db, BR_B)
    e = err(db, opname(STAFF_A, 'opname-a-ke-b-1', BR_B, [dict(item_id=b['Sapu']['id'], revision=1, qty_fisik=0, alasan='hilang semua')]))
    check('isolasi: staf A tidak bisa opname cabang B', e is not None and 'INVENTARIS_CABANG_DITOLAK' in e, (e or '')[:200])
    e = err(db, opname(OWNER, 'opname-owner-hdr', BR_A, [dict(item_id=ids['Sapu'], revision=1, qty_fisik=5)], header=BR_B))
    check('isolasi: Owner yang sedang memilih cabang B tidak bisa menulis ke cabang A', e is not None and 'INVENTARIS_CABANG_DITOLAK' in e, (e or '')[:200])
    check('isolasi: Owner tanpa pilihan cabang melihat kedua cabang (pola akses KAMO)',
          db.sql(as_user(OWNER) + "select count(distinct branch_id) from public.operational_inventory_items;").splitlines()[-1] == '2')
    e = err(db, tambah(ONLINE_A, 'tambah-online-01', BR_A, 'Kemoceng', 'pcs', 1))
    check('Admin Online ditolak walau terdaftar di cabang A', e is not None and ('ADMIN_ONLINE' in e or '42501' in e or 'ditolak' in e.lower()), (e or '')[:200])
    e = err(db, tambah(INACTIVE_A, 'tambah-off-0001', BR_A, 'Kemoceng', 'pcs', 1))
    check('akun nonaktif ditolak', e is not None, (e or '')[:200])
    for label, stmt in (('insert', f"insert into public.operational_inventory_items(branch_id,nama,satuan,qty,request_key,created_by) values({q(BR_A)},'Kain','pcs',1,'langsung-0001',{q(STAFF_A)});"),
                        ('update', f"update public.operational_inventory_items set qty=99 where id={q(ids['Sapu'])};"),
                        ('history insert', f"insert into public.operational_inventory_history(item_id,branch_id,jenis,qty_sebelum,qty_sesudah,actor_id,actor_nama) values({q(ids['Sapu'])},{q(BR_A)},'saldo_awal',0,1,{q(STAFF_A)},'x');")):
        e = err(db, as_user(STAFF_A) + stmt)
        check(f'tulis langsung ke tabel ({label}) ditolak; hanya lewat fungsi', e is not None and 'permission denied' in e, (e or '')[:160])

    # 3. Opname dengan selisih: alasan wajib, ditolak utuh bila kosong.
    hist0 = n(db, "select count(*) from public.operational_inventory_history")
    lines = [dict(item_id=ids['Sapu'], revision=1, qty_fisik=4, alasan=''), dict(item_id=ids['Ember'], revision=1, qty_fisik=3), dict(item_id=ids['Alat pel'], revision=1, qty_fisik=2)]
    e = err(db, opname(STAFF_A, 'opname-a-000001', BR_A, lines))
    check('selisih tanpa alasan ditolak dan tidak ada yang tersimpan',
          e is not None and 'Alasan selisih "Sapu" wajib diisi' in e and n(db, "select count(*) from public.operational_inventory_history") == hist0
          and float(items(db, BR_A)['Sapu']['qty']) == 5.0 and n(db, "select count(*) from public.operational_inventory_counts") == 0, (e or '')[:200])
    lines[0]['alasan'] = 'Satu patah, dibuang'
    count_id = db.sql(opname(STAFF_A, 'opname-a-000002', BR_A, lines, 'Opname akhir bulan')).splitlines()[-1]
    a = items(db, BR_A)
    hist = json.loads(db.sql(f"select jsonb_agg(jsonb_build_object('nama',i.nama,'sebelum',h.qty_sebelum,'sesudah',h.qty_sesudah,'selisih',h.selisih,'alasan',h.alasan,'pelaku',h.actor_nama,'waktu',h.created_at is not null) order by i.nama) from public.operational_inventory_history h join public.operational_inventory_items i on i.id=h.item_id where h.count_id={q(count_id)};"))
    check('opname dengan selisih: saldo Sapu jadi 4, revisi naik, barang lain tetap',
          float(a['Sapu']['qty']) == 4.0 and a['Sapu']['rev'] == 2 and float(a['Ember']['qty']) == 3.0 and a['Ember']['rev'] == 2, a)
    check('opname dengan selisih: riwayat pelaku, waktu, sebelum, sesudah, selisih, alasan',
          [(h['nama'], float(h['sebelum']), float(h['sesudah']), float(h['selisih']), h['alasan'], h['pelaku'], h['waktu']) for h in hist] ==
          [('Alat pel', 2.0, 2.0, 0.0, None, 'Staf Cabang A', True), ('Ember', 3.0, 3.0, 0.0, None, 'Staf Cabang A', True),
           ('Sapu', 5.0, 4.0, -1.0, 'Satu patah, dibuang', 'Staf Cabang A', True)], hist)
    check('opname dengan selisih: kepala opname mencatat 3 barang, 1 selisih, catatan',
          db.sql(f"select jumlah_barang||'/'||jumlah_selisih||'/'||catatan||'/'||actor_nama from public.operational_inventory_counts where id={q(count_id)};") == '3/1/Opname akhir bulan/Staf Cabang A')
    again = db.sql(opname(STAFF_A, 'opname-a-000002', BR_A, lines, 'Opname akhir bulan')).splitlines()[-1]
    check('klik ganda opname: kiriman ulang mengembalikan opname yang sama tanpa riwayat tambahan',
          again == count_id and n(db, f"select count(*) from public.operational_inventory_history where count_id={q(count_id)}") == 3
          and float(items(db, BR_A)['Sapu']['qty']) == 4.0)

    # 4. Saldo berubah sejak dibaca.
    e = err(db, opname(STAFF_A, 'opname-a-000003', BR_A, [dict(item_id=ids['Sapu'], revision=1, qty_fisik=4), dict(item_id=ids['Ember'], revision=2, qty_fisik=3), dict(item_id=ids['Alat pel'], revision=2, qty_fisik=2)]))
    check('saldo berubah sejak dibaca (revisi lama) ditolak utuh', e is not None and 'INVENTARIS_SALDO_BERUBAH' in e and items(db, BR_A)['Ember']['rev'] == 2, (e or '')[:200])
    e = err(db, opname(STAFF_A, 'opname-a-000004', BR_A, [dict(item_id=ids['Sapu'], revision=2, qty_fisik=4)]))
    check('opname yang melewatkan barang aktif ditolak (daftar berubah)', e is not None and 'INVENTARIS_DAFTAR_BERUBAH' in e, (e or '')[:200])
    e = err(db, opname(STAFF_A, 'opname-a-000005', BR_A, [dict(item_id=ids['Sapu'], revision=2, qty_fisik=-1, alasan='minus'), dict(item_id=ids['Ember'], revision=2, qty_fisik=3), dict(item_id=ids['Alat pel'], revision=2, qty_fisik=2)]))
    check('jumlah fisik negatif ditolak', e is not None and 'Jumlah fisik harus 0 atau lebih' in e, (e or '')[:200])

    # 5. Opname tanpa selisih.
    same = [dict(item_id=ids['Sapu'], revision=2, qty_fisik=4, alasan='diabaikan karena tidak ada selisih'), dict(item_id=ids['Ember'], revision=2, qty_fisik=3), dict(item_id=ids['Alat pel'], revision=2, qty_fisik=2)]
    c2 = db.sql(opname(STAFF_A, 'opname-a-000006', BR_A, same)).splitlines()[-1]
    check('opname tanpa selisih: tersimpan, 0 selisih, alasan tidak disimpan, saldo sama',
          db.sql(f"select jumlah_selisih||'/'||(select count(*) from public.operational_inventory_history where count_id={q(c2)} and alasan is null) from public.operational_inventory_counts where id={q(c2)};") == '0/3'
          and float(items(db, BR_A)['Sapu']['qty']) == 4.0 and items(db, BR_A)['Sapu']['rev'] == 3)

    # 6. Klik ganda bersamaan (dua sesi, kunci sama) -> satu opname.
    cur = items(db, BR_A)
    par = [dict(item_id=v['id'], revision=v['rev'], qty_fisik=float(v['qty']) + (1 if k == 'Ember' else 0), alasan='ketemu satu di gudang' if k == 'Ember' else None) for k, v in cur.items()]
    with ThreadPoolExecutor(2) as pool:
        outs = list(pool.map(lambda _: db.sql(opname(STAFF_A, 'opname-a-paralel', BR_A, par)).splitlines()[-1], range(2)))
    check('dua kiriman bersamaan dengan kunci sama: satu opname, id sama',
          outs[0] == outs[1] and n(db, f"select count(*) from public.operational_inventory_counts where request_key='opname-a-paralel'") == 1
          and float(items(db, BR_A)['Ember']['qty']) == 4.0, outs)

    # 7. Riwayat tidak dapat diubah; tidak ada dampak ke modul lain.
    e = err(db, f"update public.operational_inventory_history set alasan='ubah' where count_id={q(count_id)};")
    check('riwayat tidak dapat diubah (bahkan oleh pemilik database)', e is not None and 'tidak dapat diubah' in e, (e or '')[:160])
    after = counts_snapshot(db)
    changed = {t: (before.get(t), after.get(t)) for t in set(before) | set(after) if t not in OWN_TABLES and before.get(t) != after.get(t)}
    check('tanpa jurnal, penyusutan, atau stok barang jual: tabel lain tidak bertambah/berubah jumlah barisnya', not changed, changed)
    check('jurnal & stok jual tetap kosong untuk data uji', all(after.get(t, 0) == before.get(t, 0) for t in ('journal_entries', 'journal_lines', 'stock', 'stock_movements', 'stock_layers', 'items', 'fixed_assets')),
          {t: after.get(t) for t in ('journal_entries', 'journal_lines', 'stock', 'stock_movements', 'items', 'fixed_assets')})


def can(db, user, branch=BR_A):
    """(rows visible in branch, allowed() value, write error or None) for one actor."""
    rows = int(db.sql(as_user(user) + f"select count(*) from public.operational_inventory_items where branch_id={q(branch)};").splitlines()[-1])
    allowed = db.sql(as_user(user) + "select public.inventaris_operasional_allowed();").splitlines()[-1]
    e = err(db, tambah(user, 'gate-' + os.urandom(6).hex(), branch, 'Gate ' + os.urandom(3).hex(), 'pcs', 1))
    return rows, allowed, e


def gate_cases(db):
    """Hak menu (Akses Grup / akses khusus) ditegakkan di database, beririsan dengan akses cabang."""
    def setcfg(sql): db.sql(STAFF_GRANT + sql)
    denied = lambda r: r[0] == 0 and r[1] == 'f' and r[2] is not None and 'INVENTARIS_MENU_DITOLAK' in r[2]
    granted = lambda r: r[0] > 0 and r[1] == 't' and r[2] is None
    # 1. Sub-menu lain saja: staf aktif dengan cabang sah tetapi tanpa hak sub-menu -> tidak bisa baca/simpan.
    setcfg("update role_settings_private.submenu_policies set allowed='{pos.stok}' where role='STAFF' and module_id='pos';")
    r = can(db, STAFF_A); check('gerbang: staf cabang A tanpa centang sub-menu tidak bisa membaca maupun menyimpan', denied(r), r)
    e = err(db, opname(STAFF_A, 'gate-opname-0001', BR_A, [dict(item_id=U(99), revision=1, qty_fisik=1)]))
    check('gerbang: opname juga ditolak tanpa hak sub-menu', e is not None and 'INVENTARIS_MENU_DITOLAK' in e, (e or '')[:160])
    check('gerbang: riwayat & sesi opname tidak terbaca tanpa hak sub-menu',
          db.sql(as_user(STAFF_A) + f"select (select count(*) from public.operational_inventory_history)+(select count(*) from public.operational_inventory_counts);").splitlines()[-1] == '0')
    # 2. Hak sah: sub-menu dicentang -> lulus; cabang lain tetap tertutup (irisan).
    setcfg('')
    r = can(db, STAFF_A); check('gerbang: sub-menu dicentang -> staf cabang A bisa membaca dan menyimpan', granted(r), r)
    r = can(db, STAFF_A, BR_B); check('gerbang: hak menu tidak membuka cabang lain (irisan dengan akses cabang)', r[0] == 0 and r[1] == 't' and r[2] and 'INVENTARIS_CABANG_DITOLAK' in r[2], r)
    # 3. Modul Persediaan tanpa kebijakan sub-menu = semua sub-menu (semantik KAMO).
    setcfg("delete from role_settings_private.submenu_policies where role='STAFF';")
    r = can(db, STAFF_A); check('gerbang: modul Persediaan tanpa kebijakan sub-menu -> semua sub-menu (semantik KAMO)', granted(r), r)
    # 4. Peran punya aturan tetapi tanpa modul Persediaan -> tidak.
    setcfg("delete from public.role_modules where role='STAFF' and module_id='pos'; delete from role_settings_private.submenu_policies where role='STAFF';")
    r = can(db, STAFF_A); check('gerbang: aturan peran tanpa modul Persediaan -> ditolak', denied(r), r)
    # 5. Bawaan tanpa baris Akses Grup: STAFF (Klinik) dan FINANCE ditolak; ADMIN dan DOCTOR (semua modul) boleh.
    setcfg("delete from public.role_modules where role='STAFF'; delete from role_settings_private.submenu_policies where role='STAFF';")
    r = can(db, STAFF_A); check('gerbang: STAFF bawaan (hanya Klinik) ditolak', denied(r), r)
    r = can(db, FIN_A); check('gerbang: FINANCE bawaan ditolak', denied(r), r)
    r = can(db, ADMIN_A); check('gerbang: ADMIN bawaan (semua modul) boleh', granted(r), r)
    r = can(db, DOC_A); check('gerbang: DOCTOR bawaan (semua modul) boleh', granted(r), r)
    # 6. Akses khusus akun (E3): 'tambah' menambah hak; 'khusus' hanya isi akses khusus.
    setcfg(f"""delete from public.role_modules where role='STAFF'; delete from role_settings_private.submenu_policies where role='STAFF';
insert into role_settings_private.account_access_overrides(profile_id,mode,modules,updated_by) values
 ({q(STAFF_A)},'tambah','{{"pos":["pos.inventaris-operasional"]}}',{q(OWNER)});""")
    r = can(db, STAFF_A); check('gerbang: akses khusus akun "tambah" Inventaris Operasional -> staf A boleh', granted(r), r)
    r = can(db, STAFF_A2); check('gerbang: staf lain di cabang yang sama tanpa akses khusus tetap ditolak', denied(r), r)
    setcfg(f"""insert into role_settings_private.account_access_overrides(profile_id,mode,modules,updated_by) values
 ({q(STAFF_A)},'khusus','{{"klinik":null}}',{q(OWNER)});""")
    r = can(db, STAFF_A); check('gerbang: akses khusus "hanya khusus" tanpa Inventaris Operasional menutup hak peran', denied(r), r)
    setcfg(f"""insert into role_settings_private.account_access_overrides(profile_id,mode,modules,updated_by) values
 ({q(STAFF_A)},'khusus','{{"pos":null}}',{q(OWNER)});""")
    r = can(db, STAFF_A); check('gerbang: akses khusus seluruh modul Persediaan -> boleh', granted(r), r)
    # 7. Konfigurasi hilang -> gagal tertutup; Owner tetap boleh.
    setcfg("delete from role_settings_private.submenu_catalog where id='pos.inventaris-operasional';")
    r = can(db, STAFF_A); check('gerbang: id sub-menu hilang dari katalog -> staf ditolak (gagal tertutup)', denied(r), r)
    r = can(db, OWNER); check('gerbang: Owner tetap boleh walau katalog hilang', granted(r), r)
    db.sql("insert into role_settings_private.submenu_catalog(id,module_id) values ('pos.inventaris-operasional','pos') on conflict do nothing;")
    # Fungsi yang dipakai kebijakan RLS sengaja dilewati guard_all() (#549); penolakan Admin Online ada di dalam fungsinya.
    v = db.sql(as_user(ONLINE_A) + "select public.inventaris_operasional_allowed();").splitlines()[-1]
    rows = db.sql(as_user(ONLINE_A) + "select count(*) from public.operational_inventory_items;").splitlines()[-1]
    check('gerbang: Admin Online ditolak oleh gerbang menu (false) dan tidak membaca baris apa pun', v == 'f' and rows == '0', (v, rows))
    db.sql(STAFF_GRANT)


def static_checks(db):
    check('fungsi tulis diberi penjaga Admin Online', db.sql("select count(*) from pg_proc where proname in ('inventaris_operasional_tambah','inventaris_operasional_opname') and prosrc ~ 'deny_admin_online'") == '2', kind='static')
    check('gerbang menu menolak ADMIN_ONLINE secara eksplisit dan gagal tertutup saat galat',
          db.sql("select count(*) from pg_proc where proname='inventaris_operasional_allowed' and prosecdef and prosrc ~ 'ADMIN_ONLINE' and prosrc ~ 'exception when others then return false'") == '1', kind='static')
    check('ketiga kebijakan baca memakai gerbang menu DAN akses cabang',
          db.sql("select count(*) from pg_policies where tablename in ('operational_inventory_items','operational_inventory_counts','operational_inventory_history') and cmd='SELECT' and qual ~ 'inventaris_operasional_allowed' and qual ~ 'user_can_access_branch'") == '3', kind='static')
    check('sub-menu pos.inventaris-operasional terdaftar di katalog Akses Grup',
          db.sql("select count(*) from role_settings_private.submenu_catalog where id='pos.inventaris-operasional' and module_id='pos'") == '1', kind='static')
    check('authenticated tidak punya hak insert/update/delete ke tabel modul',
          db.sql("select bool_or(has_table_privilege('authenticated','public.'||t,p)) from unnest(array['operational_inventory_items','operational_inventory_counts','operational_inventory_history']) t, unnest(array['insert','update','delete','truncate']) p") == 'f', kind='static')
    check('anon tidak bisa memanggil fungsi tulis',
          db.sql("select bool_or(has_function_privilege('anon',f,'execute')) from unnest(array['public.inventaris_operasional_tambah(text,uuid,text,text,numeric)','public.inventaris_operasional_opname(text,uuid,jsonb,text)']) f") == 'f', kind='static')


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path); ap.add_argument('--baseline', action='store_true')
    ap.add_argument('--pg-bin', default=os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin')); a = ap.parse_args()
    try:
        with Pg(a.pg_bin) as db:
            bootstrap(db); fixtures(db)
            if not a.baseline:
                db.sql('begin;\n' + CANDIDATE.read_text() + '\ncommit;')
                print('Applied candidate ' + CANDIDATE.name, flush=True)
                apply_later(db)
            try: run_cases(db)
            except Exception as e: check('SECTION cases aborted', False, str(e)[:600], 'feature' if a.baseline else 'harness')
            if not a.baseline:
                try: gate_cases(db)
                except Exception as e: check('SECTION gate aborted', False, str(e)[:600], 'harness')
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
