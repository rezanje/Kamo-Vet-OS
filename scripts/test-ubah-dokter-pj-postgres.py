#!/usr/bin/env python3
"""Ubah dokter PJ kunjungan (migrasi 20261129100000_ubah_dokter_pj.sql) — rantai migrasi asli, PostgreSQL native.

Semua orang/hewan fiktif; klaster sementara lokal, tanpa jaringan.
  python3 -I scripts/test-ubah-dokter-pj-postgres.py --pg-bin DIR --json out.json
  --baseline    rantai TANPA kandidat: setiap kasus fitur baru harus GAGAL (MERAH)
  --mutations   rantai tanpa kandidat sekali, lalu tiap mutan di salinan database; semua harus terbunuh
  --attach DIR  dev saja: salinan database `postgres` di klaster yang sedang jalan (rantai tanpa kandidat + x.setup)
Laporan Tenaga Penjual dihitung di TypeScript (bukan fungsi DB): kasus 'laporan' memakai aturan atribusi yang SAMA persis
(performers baris -> penjual baris/tagihan -> dokter kunjungan) pada kolom yang dibaca laporan itu.
"""
import argparse, importlib.util, json, os, sys, time
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename); assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod


ka = load('ka', 'test-koreksi-visit-postgres.py')
cp = load('cp', 'test-ranap-cashier-performers-postgres.py')
okr, x, r, q, j = ka.okr, ka.x, ka.r, ka.q, ka.j
CANDIDATE = '20261129100000_ubah_dokter_pj.sql'
MIG = ROOT / 'supabase/migrations'
ROLLBACK = ROOT / 'docs/rollback/2026-11-29-ubah-dokter-pj.sql'
ACTION = 'klinik.ubah_dokter_pj'
RESULTS = []
OWNER, ADMIN, FINANCE, STAFF, DOCTOR, FIN_OFF, FIN_LUAR = r.OWNER, r.ADMIN, r.FINANCE, r.STAFF, r.DOCTOR, r.FIN_NONAKTIF, r.FIN_LUAR
D1 = r.DOKTER_PEGAWAI                       # dokter awal semua fixture (Dokter Hewan Fiktif)
DA, DB, DC, DS, DOFF, DNON, DTR = (r.uid('a', n) for n in (12, 13, 14, 15, 16, 17, 18))
PN, PN_OFF = r.uid('a', 19), r.uid('a', 20)
NEXT = [3000]
REASON = 'Dokter PJ salah input; seharusnya dr. Aini'
NEW_FNS = {'clinic_change_visit_doctor(uuid,uuid,text,text,boolean,boolean)', 'clinic_visit_doctor_change_allowed()',
           'clinic_private.visit_doctor_change_actor()', 'clinic_private.visit_doctor_changes_immutable()'}


def check(name, ok, detail=None):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail or {}))
    print(RESULTS[-1]['status'], name, json.dumps(detail or {}, ensure_ascii=False, default=str)[:300], flush=True)


def nxt():
    NEXT[0] += 1; return NEXT[0]


def has(err, *words): return bool(err) and all(w in err for w in words)


def short(err): return (err or '')[:200]


# ---------------------------------------------------------------- fixtures
def prep(h):
    h.sql(f"""insert into public.employees (id,nama,jabatan,branch_id,status) values
 ({q(DA)},'Dokter Aini Fiktif','Dokter Hewan',{q(r.BRANCH)},'Aktif'),
 ({q(DB)},'Dokter Budi Fiktif','Dokter Hewan',{q(r.BRANCH)},'Aktif'),
 ({q(DC)},'Dokter Cabang Lain Fiktif','Dokter Hewan',{q(r.BRANCH2)},'Aktif'),
 ({q(DS)},'Dokter Tugas Ganda Fiktif','Dokter Hewan',{q(r.BRANCH2)},'Aktif'),
 ({q(DOFF)},'Dokter Nonaktif Fiktif','Dokter Hewan',{q(r.BRANCH)},'Nonaktif'),
 ({q(DNON)},'Perawat Pilihan Fiktif','Perawat',{q(r.BRANCH)},'Aktif'),
 ({q(DTR)},'Dokter Terhapus Fiktif','Dokter Hewan',{q(r.BRANCH)},'Aktif'),
 ({q(PN)},'Paramedis Pelaksana Fiktif','Paramedis',{q(r.BRANCH)},'Aktif'),
 ({q(PN_OFF)},'Paramedis Keluar Fiktif','Paramedis',{q(r.BRANCH)},'Aktif');
alter table public.employees disable trigger user; update public.employees set trashed_at=now() where id={q(DTR)}; alter table public.employees enable trigger user;
insert into public.employee_branch_assignments (employee_id,branch_id,role,effective_date)
 values ({q(DS)},{q(r.BRANCH)},'SECONDARY',current_date-1);
insert into public.role_modules(role,module_id) values('FINANCE','klinik'),('ADMIN','klinik') on conflict do nothing;""")


def grant(h, role, allowed=(ACTION,)): ka.grant(h, role, list(allowed))
def ungrant(h, role): ka.ungrant(h, role)


def call(h, user, v, doc, reason=REASON, key=None, follow=True, ack=False):
    key = key or f'ud-key-{nxt()}-{int(time.time()*1000)%100000}'
    d = 'null' if doc is None else q(doc)
    try:
        out = h.nilai(f"select public.clinic_change_visit_doctor({q(v)},{d},{q(reason) if reason is not None else 'null'},{q(key) if key is not None else 'null'},{'true' if follow else 'false'},{'true' if ack else 'false'})::text", user)
        return None, json.loads(out)
    except RuntimeError as e:
        return str(e), None


def ranap(h, n=None, performers=None):
    """Rawat inap fiktif lewat RPC asli + 4 baris resep awal (tanpa pelaksana). performers: daftar (nama, doctor, staff) baris tambahan."""
    n = n or nxt(); v, mr, stay, _ = cp.pending_visit(h, n)
    h.sql(f"update public.visits set dokter='Dokter Hewan Fiktif' where id={q(v)};")
    ids = []
    for k, (nama, doc, staff) in enumerate(performers or []):
        lid = r.uid('f', n * 10 + k); ids.append(lid)
        h.sql(f"insert into prescription_items(id,medical_record_id,nama_obat,qty,harga,satuan,jenis,kategori,faktor,service_performers) "
              f"values({q(lid)},{q(mr)},{q(nama)},1,30000,'kali','jasa','Tindakan',1,{q(json.dumps(dict(doctor_id=doc, staff_id=staff)))}::jsonb);")
    return dict(v=v, mr=mr, stay=stay, n=n, ids=ids)


def rawat_jalan(h, n=None):
    n = n or nxt(); v = r.buat_kunjungan(h, n, r.buat_pelanggan(h, n), admitted=False); mr = r.uid(7, n)
    h.sql(f"update visits set status='Pembayaran',service_finished_at=now() where id={q(v)};update medical_records set submission_key='initial-{n}',submitted_by={q(r.DOCTOR)} where id={q(mr)};")
    return dict(v=v, mr=mr, n=n)


def visit_row(h, v): return json.loads(h.nilai(f"select to_jsonb(vv) from visits vv where id={q(v)}"))
def stay_row(h, v): return json.loads(h.nilai(f"select coalesce((select to_jsonb(s) from inpatient_records s where visit_id={q(v)} limit 1),'null')"))
def perf_of(h, pid): return json.loads(h.nilai(f"select coalesce(service_performers::text,'null') from prescription_items where id={q(pid)}"))
def audit_n(h, v=None): return int(h.angka(f"select count(*) from visit_doctor_changes{'' if v is None else ' where visit_id=' + q(v)}"))
def permits(h): return int(h.angka("select (select count(*) from clinic_private.visit_doctor_change_permits)+(select count(*) from clinic_private.performer_change_permits)"))


def digest(h, v):
    """Semua yang TIDAK boleh berubah oleh ubah dokter (kunjungan tanpa doctor_id/dokter, stay tanpa dokter, rekam, tagihan, catatan, resep tanpa pelaksana, jurnal)."""
    return h.nilai(f"""select md5((jsonb_build_array(
 (select to_jsonb(vv)-'doctor_id'-'dokter' from visits vv where id={q(v)}),
 (select coalesce(jsonb_agg(to_jsonb(s)-'doctor_id'-'doctor_name' order by s.id),'[]') from inpatient_records s where visit_id={q(v)}),
 (select coalesce(jsonb_agg(to_jsonb(m) order by m.id),'[]') from medical_records m where visit_id={q(v)}),
 (select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from invoices i where visit_id={q(v)}),
 (select coalesce(jsonb_agg(to_jsonb(ii) order by ii.id),'[]') from invoice_items ii join invoices i on i.id=ii.invoice_id where i.visit_id={q(v)}),
 (select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from invoice_payments p join invoices i on i.id=p.invoice_id where i.visit_id={q(v)}),
 (select coalesce(jsonb_agg(to_jsonb(l) order by l.id),'[]') from inpatient_daily_logs l join inpatient_records s on s.id=l.inpatient_record_id where s.visit_id={q(v)}),
 (select coalesce(jsonb_agg(to_jsonb(pi)-'service_performers' order by pi.id),'[]') from prescription_items pi join medical_records m on m.id=pi.medical_record_id where m.visit_id={q(v)}),
 (select jsonb_build_array(count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)) from journal_lines),
 (select jsonb_build_array(count(*),coalesce(sum(qty),0)) from stock))::jsonb)::text)""")


def attrib(h, v):
    """Atribusi omzet per dokter persis aturan laporan Tenaga Penjual / Komisi (data.ts & komisi-data.ts): performers baris, kalau kosong
    penjual baris/tagihan, kalau kosong dokter kunjungan (visits.doctor_id)."""
    return json.loads(h.nilai(f"""select coalesce(jsonb_object_agg(k,t),'{{}}') from (select coalesce(case when ii.service_performers is not null then ii.service_performers->>'doctor_id'
 when coalesce(ii.salesperson_id,i.salesperson_id) is not null then null else vv.doctor_id::text end,'-') k, sum(ii.qty*ii.harga) t
 from invoice_items ii join invoices i on i.id=ii.invoice_id join visits vv on vv.id=i.visit_id where i.visit_id={q(v)} and i.voided_at is null group by 1) s"""))


def save_cashier(v, stay, cart, rows, parts, key, dp_reason=None):
    return (f"select clinic_save_inpatient_cashier({q(stay)},{q(v)},{q(key)},'2026-11-03',{q(cart['snapshot'])},{j(rows)},{j(parts)},null,false,"
            f"{q(dp_reason) if dp_reason else 'null'},'Uji ubah dokter fiktif');")


def bill(h, S, paid, rows_fn=None, user=None):
    """Terbitkan tagihan tahap lewat kasir rawat inap (nyata). paid=True: lunas Tunai; False: belum lunas (alasan DP)."""
    user = user or (STAFF if paid else OWNER)
    cart = cp.read(h, S['v'], S['stay'], user); rows = rows_fn(cart) if rows_fn else cart['rows']
    parts = [dict(method='Tunai', amount=cp.total(cart))] if paid else []
    err = h.gagal(save_cashier(S['v'], S['stay'], cart, rows, parts, f"ud-bill-{S['n']}", None if paid else 'Uji tagihan belum lunas fiktif'), user)
    return err


def invoice_status(h, v): return json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_object('no',invoice_no,'status',paid_status,'total',total) order by created_at),'[]') from invoices where visit_id={q(v)}"))


# ---------------------------------------------------------------- sections
def sec_pre(h):
    objs = json.loads(h.nilai("""select jsonb_build_object(
 'fn', to_regprocedure('public.clinic_change_visit_doctor(uuid,uuid,text,text,boolean,boolean)') is not null,
 'allowed', to_regprocedure('public.clinic_visit_doctor_change_allowed()') is not null,
 'actor', to_regprocedure('clinic_private.visit_doctor_change_actor()') is not null,
 'audit', to_regclass('public.visit_doctor_changes') is not null,
 'permits', to_regclass('clinic_private.visit_doctor_change_permits') is not null,
 'catalog', (select count(*) from role_settings_private.action_catalog where id='klinik.ubah_dokter_pj' and enforced),
 'module', (select count(*) from role_settings_private.action_modules where id='klinik.ubah_dokter_pj' and module_id='klinik'))"""))
    check('preflight: fungsi, pembaca layar, pelaku, tabel audit, tabel izin, katalog izin dan modulnya terpasang',
          objs['fn'] and objs['allowed'] and objs['actor'] and objs['audit'] and objs['permits'] and objs['catalog'] == 1 and objs['module'] == 1, objs)
    row = h.nilai("select md5(prosrc) from pg_proc where oid='public.protect_inpatient_care_staff()'::regprocedure")
    check('pagar rawat inap memuat izin transaksi ubah dokter (ditambal)', h.nilai("select position('visit_doctor_change_permits' in prosrc)>0 from pg_proc where oid='public.protect_inpatient_care_staff()'::regprocedure")=='t', dict(md5=row))


def sec_gate(h):
    S = ranap(h); v = S['v']
    err, res = call(h, OWNER, v, DA)
    check('OWNER mengubah dokter PJ rawat inap D1 -> Aini: berhasil', not err and res and res['ok'] is True and res['idempotent'] is False, dict(error=short(err)))
    if err or not res:
        return
    vr, sr = visit_row(h, v), stay_row(h, v)
    check('visits.doctor_id dan visits.dokter (teks) ikut dokter baru', vr['doctor_id'] == DA and vr['dokter'] == 'Dokter Aini Fiktif', dict(doctor=vr['doctor_id'], dokter=vr['dokter']))
    check('inpatient_records.doctor_id dan doctor_name (Dokter PJ) ikut dokter baru', sr and sr['doctor_id'] == DA and sr['doctor_name'] == 'Dokter Aini Fiktif', dict(sr=sr and [sr['doctor_id'], sr['doctor_name']]))
    a = json.loads(h.nilai(f"select to_jsonb(c) from visit_doctor_changes c where visit_id={q(v)}"))
    check('audit: pelaku, peran, alasan, dokter lama (id+nama) dan baru (id+nama), stay',
          a['actor'] == OWNER and a['actor_role'] == 'OWNER' and a['reason'] == REASON and a['old_doctor_id'] == D1 and a['old_doctor_name'] == 'Dokter Hewan Fiktif'
          and a['new_doctor_id'] == DA and a['new_doctor_name'] == 'Dokter Aini Fiktif' and a['inpatient_record_id'] == S['stay'] and a['branch_id'] == r.BRANCH, a)
    check('tidak ada izin transaksi tersisa setelah koreksi', permits(h) == 0, dict(permits=permits(h)))
    # peran tanpa izin
    for user, label in ((ADMIN, 'ADMIN'), (DOCTOR, 'DOCTOR'), (FINANCE, 'FINANCE'), (STAFF, 'STAFF'), (FIN_OFF, 'pengguna nonaktif'), (FIN_LUAR, 'FINANCE cabang lain')):
        S2 = ranap(h); d0 = digest(h, S2['v'])
        err, res = call(h, user, S2['v'], DA)
        check(f'{label} tanpa izin tertulis ditolak (UBAH_DOKTER_DENIED), tidak ada yang berubah',
              has(err, 'UBAH_DOKTER_DENIED') and visit_row(h, S2['v'])['doctor_id'] == D1 and audit_n(h, S2['v']) == 0 and digest(h, S2['v']) == d0, dict(error=short(err)))
    e = h.gagal(f"select public.clinic_change_visit_doctor({q(v)},{q(DB)},'alasan fiktif cukup','kunci-anon-12345',true,false);", None)
    check('tanpa login (tanpa klaim JWT) ditolak', has(e, 'UBAH_DOKTER_AUTH'), dict(error=short(e)))
    # izin tertulis
    grant(h, 'ADMIN', ['klinik.koreksi_visit'])
    S3 = ranap(h)
    err, _ = call(h, ADMIN, S3['v'], DA)
    check('ADMIN dengan kebijakan tertulis TANPA izin ini tetap ditolak (bawaan MATI)', has(err, 'UBAH_DOKTER_DENIED'), dict(error=short(err)))
    grant(h, 'ADMIN', ['klinik.koreksi_visit', ACTION])
    err, res = call(h, ADMIN, S3['v'], DA)
    check('ADMIN dengan izin tertulis dan cabang sama berhasil; audit mencatat peran ADMIN',
          not err and res and visit_row(h, S3['v'])['doctor_id'] == DA and h.nilai(f"select actor_role from visit_doctor_changes where visit_id={q(S3['v'])}") == 'ADMIN', dict(error=short(err)))
    h.sql("insert into public.role_modules(role,module_id) values('ADMIN','__role_v2__') on conflict do nothing;")
    h.sql("delete from public.role_modules where role='ADMIN' and module_id='klinik';")
    S4 = ranap(h); err, _ = call(h, ADMIN, S4['v'], DA)
    check('ADMIN berizin tetapi modul Klinik dicabut (pagar modul Akses Grup) ditolak', has(err, 'UBAH_DOKTER_DENIED'), dict(error=short(err)))
    h.sql("delete from public.role_modules where role='ADMIN' and module_id='__role_v2__'; insert into public.role_modules(role,module_id) values('ADMIN','klinik') on conflict do nothing;")
    grant(h, 'FINANCE', [ACTION]); grant(h, 'DOCTOR', [ACTION])
    S5 = ranap(h); err, _ = call(h, FIN_LUAR, S5['v'], DA)
    check('peran berizin di CABANG LAIN ditolak (UBAH_DOKTER_CABANG) dan tidak mengubah apa pun', has(err, 'UBAH_DOKTER_CABANG') and visit_row(h, S5['v'])['doctor_id'] == D1, dict(error=short(err)))
    grant(h, 'DOCTOR', [ACTION])
    err, res = call(h, DOCTOR, S5['v'], DA)
    check('DOCTOR dengan izin tertulis di cabang sama berhasil', not err and visit_row(h, S5['v'])['doctor_id'] == DA, dict(error=short(err)))
    grant(h, 'ADMIN', [ACTION]); grant(h, 'FINANCE', [ACTION]); ungrant(h, 'DOCTOR')
    vals = {u: h.nilai('select public.clinic_visit_doctor_change_allowed()', u) for u in (OWNER, ADMIN, FINANCE, STAFF, FIN_OFF)}
    check('pembaca layar: Owner/ADMIN/FINANCE berizin = true; STAFF tanpa izin dan pengguna nonaktif = false',
          vals == {OWNER: 't', ADMIN: 't', FINANCE: 't', STAFF: 'f', FIN_OFF: 'f'}, dict(vals=vals))
    ungrant(h, 'ADMIN'); ungrant(h, 'FINANCE')


def sec_input(h):
    S = ranap(h); v = S['v']; d0 = digest(h, v)
    cases = [
        ('alasan kosong', dict(reason=''), 'UBAH_DOKTER_ALASAN'),
        ('alasan 4 huruf', dict(reason='abcd'), 'UBAH_DOKTER_ALASAN'),
        ('alasan > 500 huruf', dict(reason='a' * 501), 'UBAH_DOKTER_ALASAN'),
        ('alasan spasi saja', dict(reason='      '), 'UBAH_DOKTER_ALASAN'),
        ('kunci permintaan terlalu pendek', dict(key='abc'), 'UBAH_DOKTER_INPUT'),
        ('dokter baru kosong', dict(doc=None), 'UBAH_DOKTER_INPUT'),
        ('dokter tidak ada', dict(doc=r.uid('a', 77)), 'UBAH_DOKTER_PILIHAN'),
        ('dokter nonaktif', dict(doc=DOFF), 'UBAH_DOKTER_PILIHAN'),
        ('karyawan non-dokter (perawat)', dict(doc=DNON), 'UBAH_DOKTER_PILIHAN'),
        ('dokter cabang lain tanpa penugasan', dict(doc=DC), 'tidak bertugas di cabang'),
        ('dokter terhapus (trashed)', dict(doc=DTR), 'UBAH_DOKTER_PILIHAN'),
        ('dokter sama dengan saat ini', dict(doc=D1), 'UBAH_DOKTER_SAMA'),
    ]
    for label, kw, word in cases:
        doc = kw.pop('doc', DA) if 'doc' in kw else DA
        err, _ = call(h, OWNER, v, doc, **kw)
        check(f'ditolak: {label}', has(err, word), dict(error=short(err)))
    check('semua penolakan input: tidak ada baris audit dan tidak ada perubahan data', audit_n(h, v) == 0 and digest(h, v) == d0 and visit_row(h, v)['doctor_id'] == D1, {})
    err, res = call(h, OWNER, v, DS)
    check('dokter berpenugasan SEKUNDER di cabang kunjungan diterima', not err and visit_row(h, v)['doctor_id'] == DS, dict(error=short(err)))
    err, res = call(h, OWNER, v, DA, reason='abcde')
    check('alasan tepat 5 huruf diterima (batas bawah)', not err and res and res['dokter_baru_id'] == DA, dict(error=short(err)))
    err, _ = call(h, OWNER, r.uid(6, 99999), DA)
    check('kunjungan tidak ada ditolak (UBAH_DOKTER_KUNJUNGAN)', has(err, 'UBAH_DOKTER_KUNJUNGAN'), dict(error=short(err)))
    A = ranap(h)
    h.sql(f"alter table public.visits disable trigger user; update public.visits set archived_at=now(), archived_by={q(OWNER)}, archive_reason='Uji arsip fiktif' where id={q(A['v'])}; alter table public.visits enable trigger user;")
    err, _ = call(h, OWNER, A['v'], DA)
    check('kunjungan diarsipkan ditolak (UBAH_DOKTER_ARSIP)', has(err, 'UBAH_DOKTER_ARSIP') and visit_row(h, A['v'])['doctor_id'] == D1, dict(error=short(err)))


def sec_idem(h):
    S = ranap(h); v = S['v']; key = f'ud-idem-{nxt()}-abcdef'
    e1, r1 = call(h, OWNER, v, DA, key=key, ack=False)
    d1 = digest(h, v); snap = h.nilai(f"select md5(jsonb_build_array((select to_jsonb(vv) from visits vv where id={q(v)}),(select jsonb_agg(to_jsonb(c) order by c.id) from visit_doctor_changes c where visit_id={q(v)}))::text)")
    e2, r2 = call(h, OWNER, v, DA, key=key, ack=False)
    check('kunci sama + isian sama diulang: berhasil, idempotent=true, hasil sama',
          not e1 and not e2 and r2 and r2['idempotent'] is True and r2['dokter_baru_id'] == r1['dokter_baru_id'] and r2['audit_id'] == r1['audit_id'], dict(e1=short(e1), e2=short(e2)))
    snap2 = h.nilai(f"select md5(jsonb_build_array((select to_jsonb(vv) from visits vv where id={q(v)}),(select jsonb_agg(to_jsonb(c) order by c.id) from visit_doctor_changes c where visit_id={q(v)}))::text)")
    check('ulang tidak menambah audit dan tidak menyentuh data', audit_n(h, v) == 1 and snap == snap2 and digest(h, v) == d1, dict(audit=audit_n(h, v)))
    e3, _ = call(h, OWNER, v, DB, key=key)
    check('kunci sama + dokter lain: ditolak (UBAH_DOKTER_KUNCI_BEDA), dokter tetap Aini', has(e3, 'UBAH_DOKTER_KUNCI_BEDA') and visit_row(h, v)['doctor_id'] == DA, dict(error=short(e3)))
    e4, _ = call(h, OWNER, v, DA, key=key, reason='alasan berbeda lagi')
    check('kunci sama + alasan lain: ditolak (UBAH_DOKTER_KUNCI_BEDA)', has(e4, 'UBAH_DOKTER_KUNCI_BEDA'), dict(error=short(e4)))
    e5, _ = call(h, OWNER, v, DB, key=key + 'x')
    check('kunci baru untuk koreksi berikutnya (Aini -> Budi) berhasil; dua baris audit berurutan', not e5 and audit_n(h, v) == 2 and visit_row(h, v)['doctor_id'] == DB, dict(error=short(e5)))
    grant(h, 'ADMIN'); S2 = ranap(h)
    e6, _ = call(h, OWNER, S2['v'], DA, key=key + 'y'); e7, _ = call(h, ADMIN, S2['v'], DB, key=key + 'y')
    check('kunci berlaku per pelaku: pelaku lain dengan kunci sama tidak terbentur (koreksi kedua oleh ADMIN berhasil)', not e6 and not e7 and visit_row(h, S2['v'])['doctor_id'] == DB, dict(e6=short(e6), e7=short(e7)))
    ungrant(h, 'ADMIN')


def sec_lines(h):
    S = ranap(h, performers=[('Jasa Dokter Lama + Paramedis', D1, PN), ('Jasa Dokter Lama saja', D1, None), ('Jasa Dokter Lain', DB, PN),
                             ('Jasa Staf saja', None, PN), ('Jasa Paramedis Keluar', D1, PN_OFF)])
    v, ids = S['v'], S['ids']; base = [r.uid(9, S['n'] * 10 + k) for k in (1, 2, 3, 4)]
    h.sql(f"alter table public.employees disable trigger user; update public.employees set status='Nonaktif' where id={q(PN_OFF)}; alter table public.employees enable trigger user;")
    d0 = digest(h, v); other = {i: perf_of(h, i) for i in base + [ids[2], ids[3]]}
    err, res = call(h, OWNER, v, DA)
    p0, p1, p2, p3, p4 = (perf_of(h, i) for i in ids)
    check('baris belum ditagih berpelaksana dokter lama (+ paramedis) -> dokter baru; paramedis dan nama ikut tersimpan',
          not err and p0['doctor_id'] == DA and p0['doctor_name'] == 'Dokter Aini Fiktif' and p0['staff_id'] == PN and p0['staff_name'] == 'Paramedis Pelaksana Fiktif', dict(error=short(err), p0=p0))
    check('baris dokter lama tanpa paramedis -> dokter baru, staf tetap kosong', p1['doctor_id'] == DA and p1['staff_id'] is None, p1)
    check('baris berpelaksana dokter LAIN dan baris berpelaksana staf saja tidak berubah', perf_of(h, ids[2]) == other[ids[2]] and perf_of(h, ids[3]) == other[ids[3]] and p2['doctor_id'] == DB, dict(p2=p2))
    check('baris tanpa pelaksana (obat: null; jasa: snapshot kosong) tidak disentuh — barang tetap mengikuti dokter kunjungan saat ditagih', all(perf_of(h, i) == other[i] for i in base) and other[base[2]] is None, dict(base=[other[i] for i in base]))
    check('tidak ada izin transaksi (stay/baris) tersisa setelah koreksi baris', permits(h) == 0, dict(permits=permits(h)))
    check('baris yang paramedisnya nonaktif dilewati dan DIHITUNG (baris_tetap_tak_valid=1), koreksi lain tetap jalan',
          res and res['baris_tetap_tak_valid'] == 1 and p4['doctor_id'] == D1 and res['baris_diganti'] == 2, dict(res=res))
    a = json.loads(h.nilai(f"select to_jsonb(c) from visit_doctor_changes c where visit_id={q(v)}"))
    check('audit menyimpan id+nama baris yang diganti dan semua hitungan',
          sorted(x['id'] for x in a['lines_changed']) == sorted([ids[0], ids[1]]) and a['lines_kept_invalid'] == 1 and a['lines_kept_invoiced'] == 0 and a['follow_lines'] is True, a)
    check('selain pelaksana baris yang diganti, tidak ada kolom lain yang berubah (rekam, resep, tagihan, catatan, jurnal, stok)', digest(h, v) == d0, {})
    # centang dimatikan
    S2 = ranap(h, performers=[('Jasa Dokter Lama', D1, PN)]); err, res = call(h, OWNER, S2['v'], DA, follow=False)
    check('tanpa centang "ikut ubah baris": kunjungan berpindah tetapi baris tetap dokter lama (dihitung baris_tetap_lain=1)',
          not err and visit_row(h, S2['v'])['doctor_id'] == DA and perf_of(h, S2['ids'][0])['doctor_id'] == D1 and res['baris_tetap_lain'] == 1 and res['baris_diganti'] == 0, dict(error=short(err), res=res))
    # baris ditarik dari tagihan
    S3 = ranap(h, performers=[('Jasa Ditarik', D1, None)])
    h.sql(f"alter table public.prescription_items disable trigger user; update public.prescription_items set billing_withdrawn_at=now() where id={q(S3['ids'][0])}; alter table public.prescription_items enable trigger user;")
    err, res = call(h, OWNER, S3['v'], DA)
    check('baris ditarik dari tagihan tidak diubah (baris_tetap_lain)', not err and perf_of(h, S3['ids'][0])['doctor_id'] == D1 and res['baris_tetap_lain'] == 1, dict(error=short(err), res=res))
    # racikan
    S4 = ranap(h, performers=[('Racikan Fiktif', D1, None)])
    rid = h.nilai("select id from compound_recipes limit 1") if h.nilai("select to_regclass('public.compound_recipes') is not null") == 't' else ''
    if rid:
        h.sql(f"alter table public.prescription_items disable trigger user; update public.prescription_items set compound_recipe_id={q(rid)} where id={q(S4['ids'][0])}; alter table public.prescription_items enable trigger user;")
        err, res = call(h, OWNER, S4['v'], DA)
        check('baris racikan tidak diubah (baris_tetap_racikan)', not err and perf_of(h, S4['ids'][0])['doctor_id'] == D1 and res['baris_tetap_racikan'] == 1, dict(error=short(err), res=res))
    else:
        check('baris racikan tidak diubah (fixture racikan tidak tersedia di rantai; dicatat)', True, dict(catatan='tidak ada compound_recipes'))
    # kunjungan dengan dokter lama kosong (legacy hanya teks)
    S5 = ranap(h, performers=[('Jasa Legacy', D1, None)])
    h.sql(f"alter table public.visits disable trigger user; update public.visits set doctor_id=null, dokter='DRH. LAMA TEKS' where id={q(S5['v'])}; alter table public.visits enable trigger user;"
          f"alter table public.inpatient_records disable trigger user; update public.inpatient_records set doctor_id={q(D1)} where visit_id={q(S5['v'])}; alter table public.inpatient_records enable trigger user;")
    err, res = call(h, OWNER, S5['v'], DA)
    check('kunjungan lama yang hanya menyimpan nama dokter (doctor_id kosong): dokter lama dicatat dari teks, id dan teks baru terisi, baris resep tidak ditebak',
          not err and res['dokter_lama_id'] is None and res['dokter_lama_nama'] == 'DRH. LAMA TEKS' and visit_row(h, S5['v'])['doctor_id'] == DA and perf_of(h, S5['ids'][0])['doctor_id'] == D1, dict(error=short(err), res=res))
    # tagihan terbit SETELAH koreksi membawa dokter baru
    S6 = ranap(h, performers=[('Jasa Tagih Setelah Koreksi', D1, None)])
    err, _ = call(h, OWNER, S6['v'], DA); e2 = bill(h, S6, True)
    inv = json.loads(h.nilai(f"select coalesce(jsonb_agg(ii.service_performers),'[]') from invoice_items ii join invoices i on i.id=ii.invoice_id where i.visit_id={q(S6['v'])} and ii.prescription_item_id={q(S6['ids'][0])}"))
    check('tagihan yang terbit SETELAH koreksi membawa dokter baru pada baris yang diikutkan', not err and not e2 and len(inv) == 1 and inv[0]['doctor_id'] == DA, dict(e2=short(e2), inv=inv))


def sec_money(h):
    # (a) tagihan BELUM lunas bergantung visit: boleh, ikut dokter baru; nilai tidak berubah
    S = ranap(h); e = bill(h, S, False); v = S['v']
    st = invoice_status(h, v); d0 = digest(h, v); at0 = attrib(h, v)
    A = at0.get(D1, 0)
    check('fixture: tagihan tahap BELUM lunas terbit; baris barang tanpa pelaksana bergantung dokter kunjungan (D1), jasa kosong tidak mengkredit siapa pun', not e and st and st[0]['status'] != 'Lunas' and A > 0 and set(at0) <= {D1, '-'}, dict(error=short(e), st=st, at=at0))
    err, res = call(h, OWNER, v, DA)
    check('tagihan belum lunas: koreksi berhasil dan dilaporkan (tagihan_belum_lunas_ikut=1)', not err and res and res['tagihan_belum_lunas_ikut'] == 1 and res['tagihan_lunas_digeser'] == 0, dict(error=short(err), res=res))
    at1 = attrib(h, v); total = sum(at0.values())
    check('LAPORAN: omzet dokter lama turun tepat sejumlah yang berpindah, dokter baru naik sama, bagian lain dan total tidak berubah',
          at1.get(D1, 0) == at0[D1] - A and at1.get(DA, 0) == A and at1.get('-') == at0.get('-') and sum(at1.values()) == total, dict(sebelum=at0, sesudah=at1))
    check('tagihan belum lunas, jurnal, pembayaran, stok: byte-identik (hanya dokter kunjungan berubah)', digest(h, v) == d0, {})
    # (b) tagihan LUNAS bergantung visit
    P = ranap(h); e = bill(h, P, True); pv = P['v']; d0 = digest(h, pv); at0 = attrib(h, pv)
    A = at0.get(D1, 0)
    check('fixture: tagihan tahap LUNAS dengan baris bergantung dokter kunjungan', not e and invoice_status(h, pv)[0]['status'] == 'Lunas' and A > 0, dict(error=short(e), st=invoice_status(h, pv), at=at0))
    grant(h, 'ADMIN'); grant(h, 'FINANCE')
    for user, label in ((ADMIN, 'ADMIN berizin'), (FINANCE, 'FINANCE berizin')):
        err, _ = call(h, user, pv, DA)
        check(f'{label} ditolak untuk tagihan lunas berbasis visit (UBAH_DOKTER_FINAL)', has(err, 'UBAH_DOKTER_FINAL', 'hanya Owner') and visit_row(h, pv)['doctor_id'] == D1, dict(error=short(err)))
    err, _ = call(h, OWNER, pv, DA)
    check('OWNER tanpa konfirmasi eksplisit ditolak (UBAH_DOKTER_FINAL), komisi tidak bergeser', has(err, 'UBAH_DOKTER_FINAL', 'Centang') and visit_row(h, pv)['doctor_id'] == D1 and attrib(h, pv) == at0, dict(error=short(err)))
    pay = h.angka("select count(*) from payrolls"); paid_month = h.nilai(f"select to_char(paid_at at time zone 'Asia/Jakarta','YYYY-MM') from invoices where visit_id={q(pv)} and voided_at is null limit 1")
    h.sql(f"insert into payrolls(id,periode,employee_id,gaji_pokok,total,status,disahkan_at,disahkan_by) values(gen_random_uuid(),{q(paid_month)},{q(D1)},0,0,'final',now(),{q(OWNER)});")
    err, _ = call(h, OWNER, pv, DA, ack=True)
    check('OWNER + konfirmasi tetap ditolak bila slip gaji dokter lama bulan pelunasan sudah disahkan (UBAH_DOKTER_PAYROLL)', has(err, 'UBAH_DOKTER_PAYROLL') and visit_row(h, pv)['doctor_id'] == D1, dict(error=short(err), bulan=paid_month))
    h.sql("delete from payrolls;"); h.sql(f"insert into payrolls(id,periode,employee_id,gaji_pokok,total,status) values(gen_random_uuid(),{q(paid_month)},{q(D1)},0,0,'draft');")
    h.sql(f"insert into payrolls(id,periode,employee_id,gaji_pokok,total,status,disahkan_at,disahkan_by) values(gen_random_uuid(),{q(paid_month)},{q(PN)},0,0,'final',now(),{q(OWNER)});"
          f"insert into payrolls(id,periode,employee_id,gaji_pokok,total,status,disahkan_at,disahkan_by) values(gen_random_uuid(),'2020-01',{q(D1)},0,0,'final',now(),{q(OWNER)});")
    err, res = call(h, OWNER, pv, DA, ack=True)
    at1 = attrib(h, pv)
    check('slip belum disahkan / milik orang lain / bulan lain tidak menghalangi; OWNER + konfirmasi berhasil, dicatat tagihan_lunas_digeser=1',
          not err and res and res['tagihan_lunas_digeser'] == 1 and visit_row(h, pv)['doctor_id'] == DA, dict(error=short(err), res=res))
    check('LAPORAN setelah geser sadar: omzet baris berbasis visit pindah ke dokter baru, total tetap',
          at1.get(DA, 0) == A and D1 not in at1 and at1.get('-') == at0.get('-') and sum(at1.values()) == sum(at0.values()), dict(sebelum=at0, sesudah=at1))
    a = json.loads(h.nilai(f"select to_jsonb(c) from visit_doctor_changes c where visit_id={q(pv)}"))
    check('audit mencatat konfirmasi Owner (ack_final) dan jumlah tagihan lunas yang bergeser', a['ack_final'] is True and a['invoices_paid_shifted'] == 1, a)
    check('tagihan lunas, jurnal, pembayaran, stok: byte-identik meski dokter berpindah', digest(h, pv) == d0, {})
    h.sql("delete from payrolls;")
    # (c) tagihan LUNAS dengan pelaksana eksplisit pada semua baris: tidak bergantung visit -> tidak menghalangi, tidak tersentuh
    F = ranap(h)

    def explicit(cart):
        rows = json.loads(json.dumps(cart['rows']))
        for row in rows: row['service_performers'] = cp.perf(D1, PN)
        return rows
    e = bill(h, F, True, explicit); fv = F['v']; d0 = digest(h, fv); at0 = attrib(h, fv)
    check('fixture: tagihan lunas dengan pelaksana eksplisit di semua baris (tidak bergantung dokter kunjungan)', not e and list(at0.keys()) == [D1], dict(error=short(e), at=at0))
    err, res = call(h, ADMIN, fv, DA)
    check('tagihan lunas berpelaksana eksplisit tidak menghalangi (ADMIN berizin berhasil tanpa konfirmasi); tagihan_lunas_tak_berubah=1',
          not err and res and res['tagihan_lunas_tak_berubah'] == 1 and res['tagihan_lunas_digeser'] == 0 and visit_row(h, fv)['doctor_id'] == DA, dict(error=short(err), res=res))
    check('baris resep yang SUDAH TERTAGIH (pelaksana dokter lama) tidak diubah dan dihitung baris_tetap_tertagih=4; resep tetap dokter lama',
          res and res['baris_tetap_tertagih'] == 4 and res['baris_diganti'] == 0 and all(perf_of(h, i['id'])['doctor_id'] == D1 for i in json.loads(h.nilai(f"select jsonb_agg(jsonb_build_object('id',pi.id)) from prescription_items pi join medical_records m on m.id=pi.medical_record_id where m.visit_id={q(fv)}"))), dict(res=res))
    check('LAPORAN: komisi tagihan lunas eksplisit TETAP di dokter lama (tidak bergeser diam-diam); invoice byte-identik', attrib(h, fv) == at0 and digest(h, fv) == d0, dict(at=attrib(h, fv)))
    # (d) tagihan void tidak dihitung
    V = ranap(h); e = bill(h, V, True); vv = V['v']
    h.sql(f"alter table public.invoices disable trigger user; update public.invoices set voided_at=now() where visit_id={q(vv)}; alter table public.invoices enable trigger user;")
    err, res = call(h, ADMIN, vv, DA)
    check('tagihan Lunas yang sudah di-VOID tidak dihitung sebagai komisi final: ADMIN berizin berhasil', not e and not err and res['tagihan_lunas_digeser'] == 0 and visit_row(h, vv)['doctor_id'] == DA, dict(error=short(err), res=res))
    # (e) campuran: satu tagihan lunas eksplisit + satu tagihan belum lunas bergantung
    ungrant(h, 'ADMIN'); ungrant(h, 'FINANCE')


def sec_report_ts(h):
    """Visit rawat jalan: tagihan belum lunas dan baris resep dari satu kunjungan; laporan tagihan sesudah koreksi."""
    S = ranap(h, performers=[('Jasa Lama', D1, PN)]); err, res = call(h, OWNER, S['v'], DA); e = bill(h, S, True)
    at = attrib(h, S['v'])
    check('tagihan terbit setelah koreksi: omzet baris eksplisit dan berbasis visit di dokter baru; dokter lama nol; jasa kosong tetap tak berpemilik',
          not err and not e and set(at.keys()) == {DA, '-'} and D1 not in at, dict(error=short(err), e=short(e), at=at))


def sec_audit(h):
    S = ranap(h); err, res = call(h, OWNER, S['v'], DA); aid = res['audit_id']
    e1 = h.gagal(f"update visit_doctor_changes set reason='diubah diam-diam' where id={q(aid)};")
    e2 = h.gagal(f"delete from visit_doctor_changes where id={q(aid)};")
    e3 = h.gagal(f"update visit_doctor_changes set reason='diubah lagi lewat user' where id={q(aid)};", OWNER)
    check('jejak audit tidak dapat di-UPDATE/DELETE (superuser maupun Owner)', has(e1, 'UBAH_DOKTER_JEJAK') and has(e2, 'UBAH_DOKTER_JEJAK') and bool(e3), dict(e1=short(e1), e2=short(e2), e3=short(e3)))
    e4 = h.gagal(f"insert into visit_doctor_changes(visit_id,branch_id,new_doctor_id,new_doctor_name,reason,request_key,request_hash,follow_lines,ack_final,actor,actor_role,result) values({q(S['v'])},{q(r.BRANCH)},{q(DA)},'x','alasan palsu','kunci-palsu-1','h',true,false,{q(OWNER)},'OWNER','{{}}');", OWNER)
    check('klien (authenticated, termasuk Owner) tidak dapat menulis jejak langsung', bool(e4), dict(error=short(e4)))
    cnt = {u: int(h.angka('select count(*) from visit_doctor_changes', u)) for u in (OWNER, STAFF, FIN_LUAR)}
    check('RLS baca per cabang: pengguna cabang kunjungan melihat jejak, pengguna cabang lain tidak', cnt[STAFF] >= 1 and cnt[FIN_LUAR] == 0 and cnt[OWNER] >= 1, cnt)
    an = h.gagal('select count(*) from visit_doctor_changes', 'anon') if False else None


def sec_guard(h):
    S = ranap(h); v = S['v']
    def jwt(user): return "select set_config('request.jwt.claims'," + q(json.dumps(dict(sub=user, role='authenticated'))) + ',false);\n'
    base = f"update public.inpatient_records set doctor_id={q(DA)}, doctor_name='Dokter Aini Fiktif' where visit_id={q(v)};"
    e = h.gagal('begin;' + jwt(OWNER) + base + 'commit;')
    check('pagar lama utuh: perubahan dokter PJ rawat inap langsung (tanpa izin) tetap ditolak walau Owner/definer', has(e, 'dokter PJ awal tetap tersimpan'), dict(error=short(e)))
    plant = lambda actor, vis: f"insert into clinic_private.visit_doctor_change_permits values(txid_current(),{q(actor)},{q(vis)});"
    e = h.gagal('begin;' + plant(OWNER, v) + jwt(OWNER) + base + 'commit;')
    check('dengan izin transaksi untuk kunjungan + pelaku yang sama: perubahan diizinkan', e is None, dict(error=short(e)))
    S2 = ranap(h); b2 = f"update public.inpatient_records set doctor_id={q(DA)}, doctor_name='Dokter Aini Fiktif' where visit_id={q(S2['v'])};"
    e = h.gagal('begin;' + plant(OWNER, S['v']) + jwt(OWNER) + b2 + 'commit;')
    check('izin untuk KUNJUNGAN LAIN tidak berlaku', has(e, 'dokter PJ awal tetap tersimpan'), dict(error=short(e)))
    e = h.gagal('begin;' + plant(ADMIN, S2['v']) + jwt(OWNER) + b2 + 'commit;')
    check('izin milik PELAKU LAIN tidak berlaku', has(e, 'dokter PJ awal tetap tersimpan'), dict(error=short(e)))
    e = h.gagal('begin;' + plant(OWNER, S2['v']) + 'commit;' + 'begin;' + jwt(OWNER) + b2 + 'commit;')
    check('izin dari TRANSAKSI LAIN (sudah commit) tidak berlaku', has(e, 'dokter PJ awal tetap tersimpan'), dict(error=short(e)))
    h.sql(f"delete from clinic_private.visit_doctor_change_permits where visit_id={q(S2['v'])};")
    e = h.gagal('begin;' + plant(OWNER, S2['v']) + jwt(OWNER) + f"update public.inpatient_records set branch_id={q(r.BRANCH2)} where visit_id={q(S2['v'])};" + 'commit;')
    check('izin ubah dokter TIDAK membuka perubahan kolom lain (branch/visit)', has(e, 'dokter PJ awal tetap tersimpan'), dict(error=short(e)))
    h.sql(f"delete from clinic_private.visit_doctor_change_permits where visit_id={q(S2['v'])};")
    e = h.gagal('begin;' + plant(OWNER, S2['v']) + jwt(OWNER) + f"update public.inpatient_records set visit_id={q(S['v'])} where id={q(S2['stay'])};" + 'commit;')
    check('izin ubah dokter TIDAK membuka pemindahan stay ke kunjungan lain', bool(e), dict(error=short(e)))
    h.sql("delete from clinic_private.visit_doctor_change_permits;")
    # izin performers tidak dapat dipalsukan lewat tabel baru: DML langsung pada baris resep tetap ditolak untuk klien
    P = ranap(h, performers=[('Jasa Uji Langsung', D1, None)])
    e = h.gagal(f"update prescription_items set service_performers={q(json.dumps(dict(doctor_id=DA, staff_id=None)))}::jsonb where id={q(P['ids'][0])};", STAFF)
    check('DML langsung klien pada pelaksana baris resep tetap ditolak (jalur lama utuh)', bool(e) and perf_of(h, P['ids'][0])['doctor_id'] == D1, dict(error=short(e)))
    e = h.gagal(f"update visits set doctor_id={q(DA)} where id={q(v)};", STAFF)
    # tidak ada klaim: dokter PJ stay lewat klien STAFF
    e2 = h.gagal(f"update inpatient_records set doctor_id={q(DA)} where visit_id={q(v)};", STAFF)
    check('klien STAFF tidak dapat mengubah dokter PJ rawat inap langsung', bool(e2), dict(error=short(e2)))


def sec_acl(h):
    S = ranap(h); sig = 'public.clinic_change_visit_doctor(uuid,uuid,text,text,boolean,boolean)'
    acl = {role: h.nilai(f"select has_function_privilege({q(role)},{q(sig)},'execute')") for role in ('anon', 'authenticated', 'service_role', 'public')} if False else None
    acl = json.loads(h.nilai(f"select jsonb_build_object('anon',has_function_privilege('anon',{q(sig)},'execute'),'auth',has_function_privilege('authenticated',{q(sig)},'execute'),'service',has_function_privilege('service_role',{q(sig)},'execute'),"
                             f"'allowed_anon',has_function_privilege('anon','public.clinic_visit_doctor_change_allowed()','execute'),'allowed_auth',has_function_privilege('authenticated','public.clinic_visit_doctor_change_allowed()','execute'),"
                             f"'actor_auth',has_function_privilege('authenticated','clinic_private.visit_doctor_change_actor()','execute'),'imm_auth',has_function_privilege('authenticated','clinic_private.visit_doctor_changes_immutable()','execute'))"))
    check('ACL: koreksi dan pembaca layar hanya authenticated; anon/service_role tidak; fungsi pelaku & trigger tidak dapat dieksekusi klien',
          acl == {'anon': False, 'auth': True, 'service': False, 'allowed_anon': False, 'allowed_auth': True, 'actor_auth': False, 'imm_auth': False}, acl)
    t = json.loads(h.nilai("""select jsonb_build_object('permit_auth',has_table_privilege('authenticated','clinic_private.visit_doctor_change_permits','select,insert,update,delete'),
 'audit_sel',has_table_privilege('authenticated','public.visit_doctor_changes','select'),'audit_ins',has_table_privilege('authenticated','public.visit_doctor_changes','insert'),
 'audit_upd',has_table_privilege('authenticated','public.visit_doctor_changes','update'),'audit_del',has_table_privilege('authenticated','public.visit_doctor_changes','delete'),
 'audit_anon',has_table_privilege('anon','public.visit_doctor_changes','select'),'rls',(select relrowsecurity from pg_class where oid='public.visit_doctor_changes'::regclass))"""))
    check('ACL tabel: izin transaksi tertutup untuk klien; audit hanya SELECT untuk authenticated dengan RLS; anon tidak',
          t == {'permit_auth': False, 'audit_sel': True, 'audit_ins': False, 'audit_upd': False, 'audit_del': False, 'audit_anon': False, 'rls': True}, t)
    cfg = h.nilai(f"select proconfig::text||'|'||prosecdef::text||'|'||proowner::regrole::text from pg_proc where oid={q(sig)}::regprocedure")
    check('fungsi koreksi: SECURITY DEFINER, search_path kosong, pemilik postgres', 'search_path' in cfg and '|true|postgres' in cfg, dict(cfg=cfg))
    e = h.gagal(f"set role anon; select public.clinic_change_visit_doctor({q(S['v'])},{q(DA)},'alasan fiktif cukup','kunci-acl-12345',true,false);")
    check('anon memanggil fungsi koreksi: permission denied; kunjungan tidak berubah', has(e, 'permission denied') and visit_row(h, S['v'])['doctor_id'] == D1, dict(error=short(e)))


def sec_scope(h):
    """Hanya fungsi yang dimaksud yang berubah: digest fungsi seluruh schema dibandingkan dengan sebelum kandidat dipasang."""
    now = json.loads(h.nilai(FN_DIGEST_SQL)); before = FN_BEFORE.get('d')
    if before is None:
        check('digest fungsi sebelum kandidat tersedia', False, {}); return
    changed = sorted(k for k in before if k in now and before[k] != now[k]); new = sorted(k for k in now if k not in before); gone = sorted(k for k in before if k not in now)
    check('hanya protect_inpatient_care_staff yang berubah di antara fungsi lama; tidak ada yang hilang', changed == ['public.protect_inpatient_care_staff()'] and not gone, dict(changed=changed, gone=gone))
    check('fungsi baru persis: koreksi, pembaca layar, pelaku, trigger jejak', {k.split('(')[0] for k in new} == {'public.' + k.split('(')[0] if not k.startswith('clinic_private') else k.split('(')[0] for k in NEW_FNS} and len(new) == 4, dict(new=new))
    trg = h.nilai("select string_agg(tgrelid::regclass::text||':'||tgname,',' order by tgrelid::regclass::text,tgname) from pg_trigger where not tgisinternal and tgrelid::regclass::text in ('visit_doctor_changes','public.visit_doctor_changes')")
    check('tabel jejak punya tepat trigger penolak ubah/hapus', 'visit_doctor_changes_immutable' in (trg or ''), dict(trg=trg))


def sec_rj(h):
    R = rawat_jalan(h)
    h.sql(f"insert into prescription_items(id,medical_record_id,nama_obat,qty,harga,satuan,jenis,kategori,faktor,service_performers) values({q(r.uid('f', R['n'] * 10))},{q(R['mr'])},'Jasa Rawat Jalan',1,50000,'kali','jasa','Tindakan',1,{q(json.dumps(dict(doctor_id=D1, staff_id=PN)))}::jsonb);")
    err, res = call(h, OWNER, R['v'], DA)
    check('RAWAT JALAN (tanpa rawat inap): kunjungan berpindah, tanpa stay (inpatient_record_id kosong), baris belum ditagih ikut',
          not err and res and res['inpatient_record_id'] is None and visit_row(h, R['v'])['doctor_id'] == DA and perf_of(h, r.uid('f', R['n'] * 10))['doctor_id'] == DA, dict(error=short(err), res=res))


def sec_catatan(h):
    """Catatan harian dokter visit (riwayat penulis) tidak berubah; laporan visit membaca penulis lama."""
    S = ranap(h); v = S['v']
    log = dict(condition_note='Visit fiktif', log_kind='doctor_visit', visit_doctor_id=D1)
    try: lid = h.nilai(f"select public.clinic_save_inpatient_log_with_status({q(S['stay'])},null,{j(log)},'[]'::jsonb,'[]'::jsonb,'ud-log-{nxt()}-abcdef',null);", OWNER); e0 = None
    except RuntimeError as e: lid, e0 = None, str(e)
    before = h.nilai(f"select md5(jsonb_agg(to_jsonb(l) order by id)::text) from inpatient_daily_logs l where inpatient_record_id={q(S['stay'])}")
    err, res = call(h, OWNER, v, DA)
    after = h.nilai(f"select md5(jsonb_agg(to_jsonb(l) order by id)::text) from inpatient_daily_logs l where inpatient_record_id={q(S['stay'])}")
    rowl = json.loads(h.nilai(f"select to_jsonb(l) from inpatient_daily_logs l where id={q(lid)}")) if lid else {}
    check('catatan visit dokter (penulis/dokter pelaku visit) tidak berubah setelah ubah dokter PJ; laporan visit tetap menampilkan dokter pelaku visit',
          not e0 and not err and before == after and rowl.get('visit_doctor_id') == D1 and rowl.get('doctor_name') == 'Dokter Hewan Fiktif' and stay_row(h, v)['doctor_name'] == 'Dokter Aini Fiktif',
          dict(e0=short(e0), err=short(err), log=rowl.get('doctor_name')))


def sec_bubel(h):
    """Replika kasus Bubel: 3 baris awal berpelaksana dokter visit (salah), 3 baris susulan berpelaksana dokter yang benar, belum ada tagihan."""
    S = ranap(h, performers=[('Rawat Inap Cat', D1, None), ('Biaya Admin', D1, PN), ('Underpadku Klinik', D1, PN), ('Obat Racik Kapsul', DA, None),
                             ('Rawat Inap Cat Susulan', DA, PN), ('Icare Can Recovery', DA, PN)])
    v = S['v']; h.sql(f"update visits set status='Pembayaran' where id={q(v)};")
    d0 = digest(h, v); before = [perf_of(h, i) for i in S['ids']]
    err, res = call(h, OWNER, v, DA, reason='Dokter PJ dan pemberi obat dr. Aini; dr. Ilham dokter visit')
    after = [perf_of(h, i) for i in S['ids']]
    check('BUBEL: PJ -> Aini; 3 baris awal (dokter salah) ikut Aini; 3 baris susulan (sudah Aini) tak berubah; tanpa tagihan, laporan visit/catatan utuh',
          not err and res['baris_diganti'] == 3 and [p['doctor_id'] for p in after] == [DA] * 6 and after[3:] == before[3:] and res['tagihan_belum_lunas_ikut'] == 0
          and stay_row(h, v)['doctor_name'] == 'Dokter Aini Fiktif' and digest(h, v) == d0, dict(error=short(err), res=res))
    e = bill(h, S, True)
    inv = json.loads(h.nilai(f"select coalesce(jsonb_agg(distinct coalesce(ii.service_performers->>'doctor_id','-')),'[]') from invoice_items ii join invoices i on i.id=ii.invoice_id where i.visit_id={q(v)}"))
    check('BUBEL: tagihan yang terbit sesudahnya mengkredit hanya dokter Aini (laporan Tenaga Penjual); dokter lama tidak lagi', not e and set(attrib(h, v).keys()) == {DA, '-'}, dict(e=short(e), at=attrib(h, v), inv=inv))


SECTIONS = [('pre', sec_pre), ('gate', sec_gate), ('input', sec_input), ('idem', sec_idem), ('lines', sec_lines), ('money', sec_money),
            ('report', sec_report_ts), ('audit', sec_audit), ('guard', sec_guard), ('acl', sec_acl), ('scope', sec_scope), ('rj', sec_rj),
            ('catatan', sec_catatan), ('bubel', sec_bubel)]
FN_DIGEST_SQL = """select jsonb_object_agg(case when n.nspname='public' then 'public.' else n.nspname||'.' end||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', md5(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'')||p.proowner::regrole::text))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','clinic_private','role_settings_private') and p.prokind='f'"""
FN_BEFORE = {}


def run(h, secs=None):
    for name, fn in SECTIONS:
        if secs is None or name in secs:
            fn(h)


def sec_rollback(db, h):
    """Salinan database: pasang kandidat, koreksi satu kunjungan, jalankan ROLLBACK terdokumentasi, bandingkan dengan keadaan sebelum kandidat."""
    S = ranap(h); call(h, OWNER, S['v'], DA)
    audit_before = audit_n(h)
    h.sql(ROLLBACK.read_text())
    fns = json.loads(h.nilai(FN_DIGEST_SQL))
    check('ROLLBACK: fungsi baru hilang dan protect_inpatient_care_staff kembali PERSIS seperti sebelum kandidat (md5 definisi + ACL)',
          fns.get('public.protect_inpatient_care_staff()') == FN_BEFORE['d'].get('public.protect_inpatient_care_staff()')
          and not any('clinic_change_visit_doctor' in k or 'visit_doctor_change' in k for k in fns if 'visit_doctor_changes_immutable' not in k),
          dict(prot=fns.get('public.protect_inpatient_care_staff()') == FN_BEFORE['d'].get('public.protect_inpatient_care_staff()'), sisa=[k for k in fns if 'visit_doctor' in k]))
    check('ROLLBACK: jejak audit dipertahankan sebagai arsip; katalog izin dan modul dicabut', audit_n(h) == audit_before and h.nilai("select count(*) from role_settings_private.action_catalog where id='klinik.ubah_dokter_pj'") == '0', dict(audit=audit_n(h)))
    S2 = ranap(h)
    e = h.gagal(f"begin;select set_config('request.jwt.claims',{q(json.dumps(dict(sub=OWNER, role='authenticated')))},false);update public.inpatient_records set doctor_id={q(DA)}, doctor_name='x' where visit_id={q(S2['v'])};commit;")
    check('setelah ROLLBACK: dokter PJ stay kembali terkunci seperti dulu', has(e, 'dokter PJ awal tetap tersimpan'), dict(error=short(e)))
    h.sql(f"update public.visits set doctor_id={q(DA)}, dokter='Dokter Aini Fiktif' where id={q(S2['v'])};")
    check('setelah ROLLBACK: data kunjungan yang sudah dikoreksi tetap (tidak dikembalikan diam-diam)', visit_row(h, S['v'])['doctor_id'] == DA and stay_row(h, S['v'])['doctor_id'] == DA, {})


MUTANTS = []   # diisi dari scripts/test-ubah-dokter-pj-mutants.py: (nama, sections, [(lama, baru, jumlah)])


def apply_text(db, text): db.sql('begin;\n' + text + '\ncommit;')


class Attached(r.NativePostgres):
    def __init__(self, bin_dir, root):
        super().__init__(bin_dir); self.root = Path(root); self.as_user = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
    def __enter__(self): return self
    def __exit__(self, *_): return None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin'); ap.add_argument('--attach')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--only'); ap.add_argument('--sections'); a = ap.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    secs = set(a.sections.split(',')) if a.sections else None
    cand = (MIG / CANDIDATE).read_text(); extra = {}
    try:
        if a.attach:
            with Attached(r.BIN, a.attach) as db:
                name = 'udp_dev_%d' % int(time.time()); db.sql(f'create database {name} template postgres;'); os.environ['PGDATABASE'] = name
                h = x.Harness(db); prep(h); FN_BEFORE['d'] = json.loads(h.nilai(FN_DIGEST_SQL))
                if not a.baseline: apply_text(db, cand)
                run(h, secs)
                if not a.baseline and (secs is None or 'rollback' in secs): sec_rollback(db, h)
        else:
            with r.NativePostgres(r.BIN) as db:
                okr.build(db, {CANDIDATE}); h = x.Harness(db); x.setup(h); prep(h); FN_BEFORE['d'] = json.loads(h.nilai(FN_DIGEST_SQL))
                if a.mutations:
                    from importlib.machinery import SourceFileLoader
                    mut = SourceFileLoader('mut', str(ROOT / 'scripts/test-ubah-dokter-pj-mutants.py')).load_module()
                    plan = [('M0 kontrol (kandidat utuh)', cand, None)]; extra['mutants'] = {}
                    cut = cand.split('-- ───────────────────────── 6)')[0]
                    for name, ss, pairs in mut.MUTANTS:
                        text, ok = cut, True
                        for old, new, expected in pairs:
                            n = text.count(old)
                            if n != expected: check(name + ' jangkar muncul %d kali' % expected, False, dict(count=n, anchor=old[:70])); ok = False; break
                            text = text.replace(old, new)
                        if ok and (not a.only or any(o in name for o in a.only.split(','))): plan.append((name, text, set(ss.split(','))))
                    for i, (name, text, ss) in enumerate(plan):
                        os.environ.pop('PGDATABASE', None); db.sql(f'create database v{i} template postgres'); os.environ['PGDATABASE'] = f'v{i}'
                        before = len(RESULTS); crash = None
                        try: apply_text(db, text); run(h, ss)
                        except Exception as e: crash = 'baterai berhenti: ' + str(e).strip().splitlines()[0][:200]
                        fails = [c['case'] for c in RESULTS[before:] if c['status'] == 'FAIL']; del RESULTS[before:]; os.environ.pop('PGDATABASE', None)
                        if i == 0: check(name + ' 0 GAGAL', not fails and not crash, (fails + [crash or ''])[:3])
                        else:
                            extra['mutants'][name] = dict(killed=bool(fails or crash), failing=fails[:4], crash=crash)
                            check(name + ' TERBUNUH', bool(fails or crash), fails[:3] or [crash])
                else:
                    if not a.baseline:
                        os.environ.pop('PGDATABASE', None); db.sql('create database rbk template postgres'); 
                        apply_text(db, cand)
                    run(h, secs)
                    if not a.baseline:
                        os.environ['PGDATABASE'] = 'rbk'; apply_text(db, cand); h2 = x.Harness(db); sec_rollback(db, h2)
    except Exception as e: check('HARNESS', False, str(e)[:800])
    totals = {s: sum(c['status'] == s for c in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='mutations' if a.mutations else 'RED' if a.baseline else 'GREEN', cases=RESULTS, totals=totals, **extra), indent=2, default=str, ensure_ascii=False)); print(totals)
    return 0 if a.baseline else int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
