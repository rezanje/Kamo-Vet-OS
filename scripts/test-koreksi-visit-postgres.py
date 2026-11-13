#!/usr/bin/env python3
"""A5 (meeting 12 Nov 2026): izin Akses Grup "Koreksi visit rawat inap" (klinik.koreksi_visit)
(migrasi 20261113031357_a5_koreksi_visit_rawat_inap.sql).

Pemegang izin (dan Owner) boleh: visit dokter > 48 jam lalu; ubah waktu/tanggal/dokter/jenis/paramedis visit; tambah/ubah catatan
setelah pasien pulang (tanpa obat/tagihan). Selalu dengan alasan. ADMIN otomatis diberi izin. Peran lain tetap seperti dulu.

Native full schema, fictional fixtures, throwaway local cluster, no network.
  python3 -I scripts/test-koreksi-visit-postgres.py --pg-bin DIR --json out.json
  --baseline    chain WITHOUT the candidate: every case about the new feature must FAIL (RED); old-behaviour cases PASS
  --mutations   chain without the candidate once, then each mutant of the candidate in a cloned database; all must be killed
"""
import argparse, importlib.util, json, os, sys
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('okr', ROOT / 'scripts/test-owner-koreksi-racikan-postgres.py'); assert spec and spec.loader
okr = importlib.util.module_from_spec(spec); spec.loader.exec_module(okr)
x, r, q, j = okr.x, okr.r, okr.q, okr.j
CANDIDATE = '20261113031357_a5_koreksi_visit_rawat_inap.sql'
MIG = ROOT / 'supabase/migrations'
RESULTS = []
OWNER, ADMIN, FINANCE, STAFF, DOCTOR = r.OWNER, r.ADMIN, r.FINANCE, r.STAFF, r.DOCTOR
ACTION = 'klinik.koreksi_visit'
DOK, DOK2 = r.DOKTER_PEGAWAI, r.uid('a', 2)
PARA, PARA2 = r.uid('a', 3), r.uid('a', 4)
GRANT_ONLY_BEFORE = ['penjualan.pos_penerimaan.batalkan', 'penjualan.pos_penerimaan.tanggal_mundur', 'klinik.batalkan_penerimaan',
                     'klinik.batalkan_penerimaan_tanggal', 'pembelian.batalkan_penerimaan', 'pembelian.batalkan_faktur',
                     'pembelian.batalkan_pembayaran', 'pembelian.batalkan_uang_muka', 'pembelian.tanggal_mundur']
NEXT = [7000]
REASON = 'Visit lupa dicatat, dikonfirmasi dokter'


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1]['status'], name, json.dumps(detail, default=str)[:400], flush=True)


def nxt():
    NEXT[0] += 1; return NEXT[0]


def has(err, *words): return bool(err) and all(w in err for w in words)


def short(err): return (err or '')[:220]


# ---------------------------------------------------------------- fixtures
def prep(h):
    h.sql(f"""insert into public.employees (id,nama,jabatan,branch_id,status) values
 ({q(DOK2)},'Dokter Hewan Fiktif Dua','Dokter Hewan',{q(r.BRANCH)},'Aktif'),
 ({q(PARA)},'Paramedis Fiktif','Paramedis',{q(r.BRANCH)},'Aktif'),
 ({q(PARA2)},'Paramedis Fiktif Dua','Paramedis',{q(r.BRANCH)},'Aktif');""")


def stay(h, admitted_days=5, discharged_days=None):
    """Rawat inap fiktif lewat RPC asli (Owner), lalu tanggal masuk/pulang digeser (penyiapan, pemicu dimatikan sementara)."""
    n = nxt(); v = r.buat_kunjungan(h, n, r.buat_pelanggan(h, n))
    sid = h.nilai(f"select id from public.inpatient_records where visit_id={q(v)}")
    disc = 'null' if discharged_days is None else f"now() - interval '{discharged_days} days'"
    cond = 'stabil' if discharged_days is None else 'sembuh'
    h.sql(f"""alter table public.inpatient_records disable trigger user;
update public.inpatient_records set admitted_at=now() - interval '{admitted_days} days', discharged_at={disc}, condition_status={q(cond)} where id={q(sid)};
alter table public.inpatient_records enable trigger user;""")
    return dict(id=sid, v=v, mr=r.uid(7, n), n=n)


def ago(h, hours): return h.nilai(f"select (now() - interval '{hours} hours')::text")


def day_ago(h, days): return h.nilai(f"select ((now() at time zone 'Asia/Jakarta')::date - {days})::text")


def visit_log(created_at, doctor=DOK, paramedic=None, note='Visit fiktif'):
    d = dict(condition_note=note, log_kind='doctor_visit', visit_doctor_id=doctor, created_at=created_at)
    if paramedic: d['paramedic_id'] = paramedic
    return d


def monitor_log(log_date, created_at=None, note='Pemantauan fiktif', paramedic=None):
    d = dict(condition_note=note, log_kind='monitoring', log_date=log_date)
    if created_at: d['created_at'] = created_at
    if paramedic: d['paramedic_id'] = paramedic
    return d


def save(h, user, S, log, key, rows="'[]'", mr=None):
    """Jalur biasa aplikasi (clinic_save_inpatient_log_with_status). -> (error, log_id)"""
    try: return None, h.nilai(f"select public.clinic_save_inpatient_log_with_status({q(S['id'])},{q(mr) if mr else 'null'},{j(log)},{rows}::jsonb,'[]'::jsonb,{q(key)},null);", user)
    except RuntimeError as e: return str(e), None


def correct(h, user, S, log, key, reason=REASON, rows="'[]'", status=None, mr=None):
    """Jalur koreksi baru (clinic_save_inpatient_log_correction). -> (error, log_id)"""
    st = q(status) if status else 'null'
    try: return None, h.nilai(f"select public.clinic_save_inpatient_log_correction({q(S['id'])},{q(mr) if mr else 'null'},{j(log)},{rows}::jsonb,'[]'::jsonb,{q(key)},{st},{q(reason) if reason is not None else 'null'});", user)
    except RuntimeError as e: return str(e), None


def update(h, user, S, log_id, patch, reason=None):
    return h.gagal(f"select public.clinic_update_inpatient_log({q(S['id'])},{q(log_id)},{j(patch)},{q(reason) if reason is not None else 'null'});", user)


def logs(h, S): return int(h.angka(f"select count(*) from public.inpatient_daily_logs where inpatient_record_id={q(S['id'])}"))


def row(h, log_id): return json.loads(h.nilai(f"select to_jsonb(l) from public.inpatient_daily_logs l where id={q(log_id)}"))


def reason_of(h, log_id):
    if not has_column(h): return 'KOLOM-TIDAK-ADA'
    return h.nilai(f"select coalesce(correction_reason,'<null>') from public.inpatient_daily_logs where id={q(log_id)}")


def has_column(h): return h.nilai("select count(*) from information_schema.columns where table_schema='public' and table_name='inpatient_daily_logs' and column_name='correction_reason'") == '1'


def edits(h, log_id): return json.loads(h.nilai(f"select coalesce(jsonb_agg(jsonb_build_object('alasan',alasan,'by',edited_by) order by edited_at),'[]') from public.inpatient_daily_log_edits where log_id={q(log_id)}"))


def grant(h, role, allowed):
    h.sql(f"insert into role_settings_private.action_policies(role,allowed) values ({q(role)}, array[{','.join(q(a) for a in allowed)}]::text[]) on conflict (role) do update set allowed=excluded.allowed;")


def ungrant(h, role): h.sql(f"delete from role_settings_private.action_policies where role={q(role)};")


def allowed_rpc(h, user):
    try: return h.nilai("select public.clinic_inpatient_visit_correction_allowed();", user)
    except RuntimeError as e: return 'ERR ' + str(e)[:80]


# ---------------------------------------------------------------- sections
def sec_preflight(h):
    objs = h.nilai("select jsonb_build_object('actor',to_regprocedure('clinic_private.inpatient_visit_correction_actor()') is not null,"
                   "'allowed',to_regprocedure('public.clinic_inpatient_visit_correction_allowed()') is not null,"
                   "'rpc',to_regprocedure('public.clinic_save_inpatient_log_correction(uuid,uuid,jsonb,jsonb,jsonb,text,text,text)') is not null,"
                   f"'catalog',exists(select 1 from role_settings_private.action_catalog where id={q(ACTION)} and enforced and \"group\"='Klinik'),"
                   f"'module',(select module_id from role_settings_private.action_modules where id={q(ACTION)}))")
    o = json.loads(objs)
    check('preflight: izin klinik.koreksi_visit (katalog enforced, modul klinik), fungsi izin, RPC koreksi dan kolom alasan terpasang',
          o == dict(actor=True, allowed=True, rpc=True, catalog=True, module='klinik') and has_column(h), o)


def sec_ontime(h):
    S = stay(h)
    for user, name in ((STAFF, 'STAFF'), (DOCTOR, 'DOCTOR')):
        err, lid = save(h, user, S, visit_log(ago(h, 2), paramedic=PARA), f"ot-{name}-{S['n']}")
        check(f'perilaku lama: {name} mencatat visit dokter tepat waktu (2 jam lalu) selama dirawat lewat jalur biasa: berhasil', err is None and lid, dict(err=short(err)))
        if lid and has_column(h):
            check(f'{name} visit tepat waktu bukan koreksi: tidak ada alasan koreksi tersimpan', reason_of(h, lid) == '<null>', dict(r=reason_of(h, lid)))
    err, lid = save(h, STAFF, S, monitor_log(day_ago(h, 4), ago(h, 96)), f"mon-old-{S['n']}")
    check('perilaku lama: STAFF mencatat PEMANTAUAN mundur 4 hari selama dirawat: tetap boleh tanpa izin (aturan 48 jam hanya untuk visit)', err is None and lid, dict(err=short(err)))
    err, _ = save(h, OWNER, S, visit_log(h.nilai("select (now() + interval '2 hours')::text")), f"fut-{S['n']}")
    check('perilaku lama: visit dokter di masa depan ditolak (CARE_INVALID), juga untuk Owner', has(err, 'CARE_INVALID', 'masa depan'), dict(err=short(err)))
    # tepat waktu lewat jalur koreksi tetap boleh untuk siapa pun (tidak ada yang dikoreksi): alasan tidak disimpan
    err, lid = correct(h, STAFF, S, visit_log(ago(h, 3)), f"ot-corr-{S['n']}")
    check('STAFF memakai RPC koreksi untuk visit tepat waktu: berhasil (bukan koreksi), alasan tidak disimpan', err is None and lid and reason_of(h, lid) == '<null>', dict(err=short(err)))


def sec_late(h):
    S = stay(h)
    before = logs(h, S)
    for user, name in ((STAFF, 'STAFF'), (DOCTOR, 'DOCTOR'), (FINANCE, 'FINANCE tanpa izin')):
        err, _ = save(h, user, S, visit_log(ago(h, 72)), f"late-{name[:3]}-{S['n']}")
        check(f'{name}: visit dokter 72 jam lalu lewat jalur biasa DITOLAK, tidak ada catatan', bool(err) and logs(h, S) == before, dict(err=short(err)))
        err, _ = correct(h, user, S, visit_log(ago(h, 72)), f"late-c-{name[:3]}-{S['n']}")
        check(f'{name}: visit dokter 72 jam lalu lewat RPC koreksi (dengan alasan) DITOLAK dengan kode izin (VISIT_CORRECTION_DENIED)', has(err, 'VISIT_CORRECTION_DENIED') and logs(h, S) == before, dict(err=short(err)))
    err, _ = save(h, ADMIN, S, visit_log(ago(h, 72)), f"late-adm-noreason-{S['n']}")
    check('ADMIN (otomatis diberi izin) visit 72 jam lalu TANPA alasan: ditolak VISIT_CORRECTION_REASON (koreksi wajib alasan)', has(err, 'VISIT_CORRECTION_REASON') and logs(h, S) == before, dict(err=short(err)))
    err, _ = correct(h, ADMIN, S, visit_log(ago(h, 72)), f"late-adm-short-{S['n']}", reason='  x ')
    check('alasan terlalu pendek (< 3 huruf) ditolak VISIT_CORRECTION_REASON', has(err, 'VISIT_CORRECTION_REASON') and logs(h, S) == before, dict(err=short(err)))
    err, lid = correct(h, ADMIN, S, visit_log(ago(h, 72), paramedic=PARA), f"late-adm-{S['n']}")
    rw = row(h, lid) if lid else {}
    check('ADMIN visit 72 jam lalu lewat RPC koreksi dengan alasan: BERHASIL; tanggal visit mengikuti jam visit (WIB); alasan tersimpan di catatan',
          err is None and lid and reason_of(h, lid) == REASON and rw.get('log_date') == h.nilai(f"select ((timestamptz {q(rw.get('created_at'))}) at time zone 'Asia/Jakarta')::date::text"),
          dict(err=short(err), r=reason_of(h, lid) if lid else None))
    err, lid = correct(h, OWNER, S, visit_log(ago(h, 100)), f"late-own-{S['n']}")
    check('OWNER visit 100 jam lalu lewat RPC koreksi: BERHASIL dan alasan tersimpan', err is None and lid and reason_of(h, lid) == REASON, dict(err=short(err)))
    err, _ = save(h, OWNER, S, visit_log(ago(h, 100)), f"late-own-noreason-{S['n']}")
    check('OWNER visit 100 jam lalu TANPA alasan (jalur biasa): ditolak VISIT_CORRECTION_REASON', has(err, 'VISIT_CORRECTION_REASON'), dict(err=short(err)))
    try:
        grant(h, 'FINANCE', [ACTION])
        err, lid = correct(h, FINANCE, S, visit_log(ago(h, 80)), f"late-fin-{S['n']}")
        check('FINANCE setelah dicentang izin Koreksi visit: visit 80 jam lalu BERHASIL dengan alasan', err is None and lid and reason_of(h, lid) == REASON, dict(err=short(err)))
        grant(h, 'STAFF', ['bank.refund_clinic.cancel'])
        err, _ = correct(h, STAFF, S, visit_log(ago(h, 80)), f"late-stf-custom-{S['n']}")
        check('STAFF dengan kebijakan kustom TANPA izin ini: tetap ditolak', has(err, 'VISIT_CORRECTION_DENIED'), dict(err=short(err)))
        # gagal baca kebijakan: FINANCE (diberi izin) ditolak (fail-closed); OWNER tetap boleh (tidak pernah terkunci)
        base = (f"begin; alter table role_settings_private.action_policies rename to action_policies_x; set role authenticated; "
                "select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub',{u},false); "
                "select public.clinic_save_inpatient_log_correction({s},null,{log},'[]'::jsonb,'[]'::jsonb,{k},null,{rs}); rollback;")
        out = h.gagal(base.format(u=q(FINANCE), s=q(S['id']), log=j(visit_log(ago(h, 80))), k=q(f"fc-{S['n']}"), rs=q(REASON)))
        check('kebijakan tidak terbaca: FINANCE (diberi izin) DITOLAK (fail-closed)', has(out, 'VISIT_CORRECTION_DENIED'), dict(err=short(out)))
        out = h.gagal(base.format(u=q(OWNER), s=q(S['id']), log=j(visit_log(ago(h, 80))), k=q(f"fo-{S['n']}"), rs=q(REASON)))
        check('kebijakan tidak terbaca: OWNER tetap BOLEH (tidak pernah terkunci tabel kebijakan)', out is None, dict(err=short(out)))
    finally:
        ungrant(h, 'FINANCE'); ungrant(h, 'STAFF')
    err, _ = correct(h, FINANCE, S, visit_log(ago(h, 80)), f"late-fin2-{S['n']}")
    check('FINANCE setelah izin dicabut: ditolak lagi', has(err, 'VISIT_CORRECTION_DENIED'), dict(err=short(err)))
    # modul klinik dicabut untuk peran ber-izin: ditolak (gerbang modul role_action_allowed)
    try:
        grant(h, 'FINANCE', [ACTION])
        h.sql("insert into public.role_modules(role,module_id) values ('FINANCE','__role_v2__'),('FINANCE','laporan');")
        err, _ = correct(h, FINANCE, S, visit_log(ago(h, 80)), f"late-fin-mod-{S['n']}")
        check('FINANCE ber-izin tetapi modul Klinik tidak dicentang (Akses Grup baru): ditolak', has(err, 'VISIT_CORRECTION_DENIED'), dict(err=short(err)))
    finally:
        h.sql("delete from public.role_modules where role='FINANCE';"); ungrant(h, 'FINANCE')
    h.sistem(f"update public.profiles set is_active=false where id={q(ADMIN)};")
    try: err, _ = correct(h, ADMIN, S, visit_log(ago(h, 80)), f"late-inactive-{S['n']}")
    finally: h.sistem(f"update public.profiles set is_active=true where id={q(ADMIN)};")
    check('akun ADMIN nonaktif: RPC koreksi menolak (akun tidak aktif)', has(err, 'ACCESS_DENIED') or has(err, 'VISIT_CORRECTION_DENIED'), dict(err=short(err)))


def sec_edit(h):
    S = stay(h)
    err, vid = save(h, STAFF, S, visit_log(ago(h, 5), paramedic=PARA), f"e-v-{S['n']}")
    err2, mid = save(h, STAFF, S, monitor_log(day_ago(h, 0), ago(h, 1), paramedic=PARA), f"e-m-{S['n']}")
    assert vid and mid, (err, err2)
    v0 = row(h, vid)
    new_time = ago(h, 7)
    e = update(h, STAFF, S, vid, dict(created_at=new_time), 'jam salah')
    check('STAFF ubah JAM visit dokter: ditolak (izin), catatan tidak berubah', bool(e) and row(h, vid)['created_at'] == v0['created_at'], dict(err=short(e)))
    e = update(h, DOCTOR, S, vid, dict(visit_doctor_id=DOK2), 'dokter salah')
    check('DOCTOR (tanpa izin) ubah DOKTER visit: ditolak', bool(e) and row(h, vid)['visit_doctor_id'] == DOK, dict(err=short(e)))
    e = update(h, STAFF, S, vid, dict(paramedic_id=PARA2), 'paramedis salah')
    check('BARU: STAFF ubah PARAMEDIS pada catatan visit dokter: ditolak VISIT_CORRECTION_DENIED (dulu bebas)', has(e, 'VISIT_CORRECTION_DENIED') and row(h, vid)['paramedic_id'] == PARA, dict(err=short(e)))
    e = update(h, STAFF, S, vid, dict(paramedic_id=None), 'paramedis dihapus')
    check('BARU: STAFF menghapus paramedis visit dokter: ditolak', has(e, 'VISIT_CORRECTION_DENIED') and row(h, vid)['paramedic_id'] == PARA, dict(err=short(e)))
    e = update(h, STAFF, S, vid, dict(tindakan='Infus fiktif'), None)
    check('perilaku lama: STAFF ubah isi (tindakan) catatan visit tanpa menyentuh waktu/dokter/paramedis: boleh', e is None and row(h, vid)['tindakan'] == 'Infus fiktif', dict(err=short(e)))
    e = update(h, STAFF, S, mid, dict(paramedic_id=PARA2), None)
    check('perilaku lama: STAFF ubah paramedis pada catatan PEMANTAUAN: tetap boleh', e is None and row(h, mid)['paramedic_id'] == PARA2, dict(err=short(e)))
    e = update(h, ADMIN, S, vid, dict(created_at=new_time), None)
    check('ADMIN ubah jam visit TANPA alasan: ditolak VISIT_CORRECTION_REASON', has(e, 'VISIT_CORRECTION_REASON') and row(h, vid)['created_at'] == v0['created_at'], dict(err=short(e)))
    e = update(h, ADMIN, S, vid, dict(created_at=new_time, log_date=h.nilai(f"select ((timestamptz {q(new_time)}) at time zone 'Asia/Jakarta')::date::text")), 'Jam visit salah ketik')
    rw = row(h, vid)
    check('ADMIN ubah jam visit dengan alasan: berhasil; riwayat koreksi menyimpan isi lama + alasan',
          e is None and rw['created_at'] != v0['created_at'] and any(x['alasan'] == 'Jam visit salah ketik' for x in edits(h, vid)), dict(err=short(e)))
    e = update(h, ADMIN, S, vid, dict(paramedic_id=PARA2), None)
    check('ADMIN ubah paramedis visit TANPA alasan: ditolak VISIT_CORRECTION_REASON', has(e, 'VISIT_CORRECTION_REASON'), dict(err=short(e)))
    e = update(h, ADMIN, S, vid, dict(paramedic_id=PARA2), 'Paramedis tertukar')
    check('ADMIN ubah paramedis visit dengan alasan: berhasil dan tercatat di riwayat koreksi',
          e is None and row(h, vid)['paramedic_id'] == PARA2 and any(x['alasan'] == 'Paramedis tertukar' for x in edits(h, vid)), dict(err=short(e)))
    try:
        grant(h, 'FINANCE', [ACTION])
        e = update(h, FINANCE, S, vid, dict(visit_doctor_id=DOK2), 'Dokter visit tertukar')
        check('FINANCE dengan izin: ubah dokter visit dengan alasan BERHASIL', e is None and row(h, vid)['visit_doctor_id'] == DOK2, dict(err=short(e)))
    finally:
        ungrant(h, 'FINANCE')
    e = update(h, OWNER, S, vid, dict(log_kind='monitoring', visit_doctor_id=None), 'Ternyata bukan visit')
    check('OWNER ubah jenis visit -> pemantauan dengan alasan: berhasil', e is None and row(h, vid)['log_kind'] == 'monitoring', dict(err=short(e)))
    e = update(h, STAFF, S, mid, dict(log_kind='doctor_visit', visit_doctor_id=DOK), 'jadi visit')
    check('perilaku lama: STAFF mengubah pemantauan menjadi visit dokter: ditolak', bool(e) and row(h, mid)['log_kind'] == 'monitoring', dict(err=short(e)))


def sec_discharged(h):
    S = stay(h, admitted_days=5, discharged_days=1)
    # catatan yang sudah ada sebelum pulang (disiapkan saat masih dirawat)
    h.sql(f"alter table public.inpatient_records disable trigger user; update public.inpatient_records set discharged_at=null where id={q(S['id'])}; alter table public.inpatient_records enable trigger user;")
    err0, old_id = save(h, STAFF, S, visit_log(ago(h, 40), paramedic=PARA), f"d-old-{S['n']}")
    h.sql(f"alter table public.inpatient_records disable trigger user; update public.inpatient_records set discharged_at=now() - interval '1 day' where id={q(S['id'])}; alter table public.inpatient_records enable trigger user;")
    assert old_id, err0
    n0 = logs(h, S)
    for user, name in ((STAFF, 'STAFF'), (DOCTOR, 'DOCTOR'), (FINANCE, 'FINANCE tanpa izin')):
        err, _ = save(h, user, S, visit_log(ago(h, 30)), f"d-ins-{name[:3]}-{S['n']}")
        check(f'perilaku lama: {name} menambah catatan setelah pasien pulang (jalur biasa): ditolak', bool(err) and logs(h, S) == n0, dict(err=short(err)))
        err, _ = correct(h, user, S, visit_log(ago(h, 30)), f"d-cor-{name[:3]}-{S['n']}")
        check(f'{name} menambah koreksi setelah pulang lewat RPC koreksi: ditolak VISIT_CORRECTION_DENIED', has(err, 'VISIT_CORRECTION_DENIED') and logs(h, S) == n0, dict(err=short(err)))
        e = update(h, user, S, old_id, dict(tindakan='diubah setelah pulang'), 'alasan cukup')
        check(f'perilaku lama: {name} mengubah catatan setelah pasien pulang: ditolak, isi tetap', bool(e) and row(h, old_id)['tindakan'] is None, dict(err=short(e)))
    err, lid = correct(h, ADMIN, S, visit_log(ago(h, 30), paramedic=PARA), f"d-adm-{S['n']}")
    check('ADMIN menambah koreksi visit setelah pasien pulang (30 jam lalu, di masa rawat) dengan alasan: BERHASIL, alasan tersimpan',
          err is None and lid and reason_of(h, lid) == REASON and logs(h, S) == n0 + 1, dict(err=short(err)))
    err, lid2 = correct(h, ADMIN, S, monitor_log(day_ago(h, 3), ago(h, 70)), f"d-adm-mon-{S['n']}")
    check('ADMIN menambah catatan PEMANTAUAN setelah pulang (tanggal di masa rawat) dengan alasan: berhasil', err is None and lid2 and reason_of(h, lid2) == REASON, dict(err=short(err)))
    n1 = logs(h, S)
    err, _ = save(h, ADMIN, S, visit_log(ago(h, 30)), f"d-adm-noreason-{S['n']}")
    check('ADMIN menambah setelah pulang TANPA alasan (jalur biasa): ditolak VISIT_CORRECTION_REASON', has(err, 'VISIT_CORRECTION_REASON') and logs(h, S) == n1, dict(err=short(err)))
    rx = json.dumps([dict(nama_obat='Obat Fiktif', item_id=r.ITEM, qty=1, satuan='pcs', faktor=1, harga=25000, aturan_pakai=None, jenis='obat', kategori=None)])
    rx_before = int(h.angka(f"select count(*) from public.prescription_items where medical_record_id={q(S['mr'])}"))
    err, _ = correct(h, ADMIN, S, visit_log(ago(h, 30)), f"d-adm-cart-{S['n']}", rows=q(rx), mr=S['mr'])
    check('ADMIN koreksi setelah pulang MEMBAWA obat: ditolak VISIT_CORRECTION_CART; tidak ada catatan maupun baris resep baru',
          has(err, 'VISIT_CORRECTION_CART') and logs(h, S) == n1 and int(h.angka(f"select count(*) from public.prescription_items where medical_record_id={q(S['mr'])}")) == rx_before, dict(err=short(err)))
    err, _ = correct(h, ADMIN, S, visit_log(ago(h, 30)), f"d-adm-status-{S['n']}", status='rip')
    check('ADMIN koreksi setelah pulang dengan UBAH KONDISI: ditolak VISIT_CORRECTION_CART (tanpa ubah kondisi)', has(err, 'VISIT_CORRECTION_CART') and logs(h, S) == n1, dict(err=short(err)))
    err, _ = correct(h, ADMIN, S, visit_log(ago(h, 24 * 8)), f"d-adm-window-{S['n']}")
    check('ADMIN koreksi setelah pulang bertanggal SEBELUM masuk rawat inap: ditolak VISIT_CORRECTION_WINDOW', has(err, 'VISIT_CORRECTION_WINDOW') and logs(h, S) == n1, dict(err=short(err)))
    err, _ = correct(h, ADMIN, S, monitor_log(day_ago(h, -1)), f"d-adm-window2-{S['n']}")
    check('ADMIN koreksi pemantauan bertanggal SESUDAH tanggal pulang: ditolak VISIT_CORRECTION_WINDOW', has(err, 'VISIT_CORRECTION_WINDOW') and logs(h, S) == n1, dict(err=short(err)))
    e = update(h, ADMIN, S, old_id, dict(tindakan='Koreksi tindakan'), None)
    check('ADMIN mengubah catatan setelah pulang TANPA alasan: ditolak VISIT_CORRECTION_REASON', has(e, 'VISIT_CORRECTION_REASON') and row(h, old_id)['tindakan'] is None, dict(err=short(e)))
    e = update(h, ADMIN, S, old_id, dict(tindakan='Koreksi tindakan', paramedic_id=PARA2), 'Koreksi setelah pulang')
    check('ADMIN mengubah catatan (isi + paramedis visit) setelah pulang dengan alasan: BERHASIL; riwayat koreksi menyimpan isi lama + alasan',
          e is None and row(h, old_id)['tindakan'] == 'Koreksi tindakan' and row(h, old_id)['paramedic_id'] == PARA2 and any(x['alasan'] == 'Koreksi setelah pulang' for x in edits(h, old_id)), dict(err=short(e)))
    e = update(h, ADMIN, S, old_id, dict(log_date=day_ago(h, -2), created_at=h.nilai("select (now() + interval '1 day')::text")), 'Geser keluar masa rawat')
    check('ADMIN memindah tanggal catatan keluar masa rawat setelah pulang: ditolak VISIT_CORRECTION_WINDOW', has(e, 'VISIT_CORRECTION_WINDOW'), dict(err=short(e)))
    err, lid = correct(h, OWNER, S, visit_log(ago(h, 50)), f"d-own-{S['n']}")
    check('OWNER menambah koreksi visit setelah pulang: BERHASIL, alasan tersimpan', err is None and lid and reason_of(h, lid) == REASON, dict(err=short(err)))
    try:
        grant(h, 'FINANCE', [ACTION])
        err, lid = correct(h, FINANCE, S, visit_log(ago(h, 31)), f"d-fin-{S['n']}")
        check('FINANCE dengan izin menambah koreksi setelah pulang: BERHASIL', err is None and lid and reason_of(h, lid) == REASON, dict(err=short(err)))
        e = update(h, FINANCE, S, old_id, dict(keterangan='Koreksi Finance'), 'Koreksi oleh Finance')
        check('FINANCE dengan izin mengubah catatan setelah pulang dengan alasan: BERHASIL', e is None and row(h, old_id)['keterangan'] == 'Koreksi Finance', dict(err=short(e)))
    finally:
        ungrant(h, 'FINANCE')
    # balasan idempoten: kunci sama -> catatan yang sama, tidak ganda
    err, again = correct(h, OWNER, S, visit_log(ago(h, 50)), f"d-own-{S['n']}")
    check('kirim ulang koreksi dengan kunci sama: tidak membuat catatan ganda', (err is None and logs(h, S) == n1 + 2) or has(err, 'IDEMPOTENCY'), dict(err=short(err)))


def sec_integrity(h):
    S = stay(h)
    err, lid = correct(h, ADMIN, S, visit_log(ago(h, 60)), f"i-adm-{S['n']}")
    out = h.gagal(f"update public.inpatient_daily_logs set correction_reason='dipalsukan', tindakan='x' where id={q(lid)};", OWNER) if lid else 'no log'
    check('alasan tambah-koreksi tidak bisa diubah lewat update langsung (tetap alasan asli)', lid and out is None and reason_of(h, lid) == REASON, dict(err=short(out), r=reason_of(h, lid) if lid else None))
    try:
        nid = h.nilai(f"insert into public.inpatient_daily_logs(inpatient_record_id,condition_note,log_kind,visit_doctor_id,correction_reason) values ({q(S['id'])},'Langsung fiktif','doctor_visit',{q(DOK)},'palsu') returning id;", STAFF)
        nid = nid.splitlines()[-1]
    except RuntimeError as e:
        nid = None; out = str(e)
    check('insert langsung dengan correction_reason dari klien: kolom dikosongkan pagar (bukan koreksi)', nid and reason_of(h, nid) == '<null>', dict(err=short(out) if not nid else None))


def sec_allowed(h):
    got = {name: allowed_rpc(h, u) for u, name in ((OWNER, 'OWNER'), (ADMIN, 'ADMIN'), (FINANCE, 'FINANCE'), (STAFF, 'STAFF'), (DOCTOR, 'DOCTOR'))}
    check('layar: clinic_inpatient_visit_correction_allowed() OWNER/ADMIN true, FINANCE/STAFF/DOCTOR false (bawaan mati)',
          got == dict(OWNER='t', ADMIN='t', FINANCE='f', STAFF='f', DOCTOR='f'), got)
    try:
        grant(h, 'STAFF', [ACTION])
        got2 = allowed_rpc(h, STAFF)
    finally:
        ungrant(h, 'STAFF')
    check('layar: STAFF setelah dicentang izin -> true', got2 == 't', dict(got=got2))


def sec_admin_grant(h):
    try:
        pol = json.loads(h.nilai("select coalesce((select to_jsonb(allowed) from role_settings_private.action_policies where role='ADMIN'),'null')"))
        enforced = json.loads(h.nilai("select coalesce(jsonb_agg(id order by id),'[]') from role_settings_private.action_catalog where enforced"))
    except RuntimeError as e:
        check('ADMIN grant: terbaca', False, str(e)[:200]); return
    expected = sorted([a for a in enforced if a == ACTION or a not in GRANT_ONLY_BEFORE])
    check('ADMIN (bawaan lama) setelah migrasi: kebijakan aksi tertulis = SEMUA aksi aktif kecuali izin khusus lama, + klinik.koreksi_visit (setara bawaan lama)',
          pol is not None and sorted(pol) == expected and ACTION in pol and not any(g in pol for g in GRANT_ONLY_BEFORE), dict(n=len(pol or []), missing=sorted(set(expected) - set(pol or []))[:5], extra=sorted(set(pol or []) - set(expected))[:5]))
    try:
        ids = [a for a in enforced if a not in GRANT_ONLY_BEFORE and a != ACTION]
        ok = h.nilai("select coalesce(bool_and(public.role_action_allowed(id)),true) from unnest(array[" + ','.join(q(i) for i in ids) + "]::text[]) id", ADMIN)
    except RuntimeError as e:
        ok = 'ERR ' + str(e)[:120]
    check('ADMIN tetap boleh SEMUA aksi biasa yang dulu boleh (role_action_allowed true untuk tiap aksi aktif bukan izin khusus)', ok == 't', dict(ok=ok))
    cancel = h.nilai("select public.clinic_cancel_receipt_allowed();", ADMIN)
    check('izin khusus lain TIDAK ikut diberikan ke ADMIN (Batalkan penerimaan klinik tetap mati)', cancel == 'f', dict(cancel=cancel))
    aud = json.loads(h.nilai("select coalesce(jsonb_agg(jsonb_build_object('reason',reason,'by',created_by,'before',before->'actions'->>'source','after',after->'actions'->>'source') order by created_at),'[]') from role_settings_private.audit where role='ADMIN'"))
    check('riwayat Akses Grup ADMIN mencatat perubahan migrasi A5 (sebelum: bawaan lama, sesudah: tertulis)',
          any('A5' in a['reason'] and a['before'] == 'legacy' and a['after'] == 'custom' for a in aud), aud[-2:])
    ep = int(h.angka("select epoch from role_settings_private.epochs where role='ADMIN'"))
    check('epoch ADMIN naik (revisi lama di editor Akses Grup menjadi basi)', ep >= 1, dict(epoch=ep))
    trg = h.nilai("select string_agg(tgname||':'||tgenabled::text,',' order by tgname) from pg_trigger where tgrelid in ('role_settings_private.action_policies'::regclass,'role_settings_private.epochs'::regclass) and not tgisinternal")
    check('pemicu penjaga Akses Grup kembali AKTIF setelah migrasi', trg and all(p.endswith(':O') for p in trg.split(',')), dict(trg=trg))
    e = h.gagal("set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub'," + q(OWNER) + ",false); update role_settings_private.action_policies set allowed='{}' where role='ADMIN';")
    check('tulis langsung ke kebijakan aksi tetap ditolak (penjaga aktif / tanpa hak)', bool(e), dict(err=short(e)))


def sec_static(h):
    funcs = json.loads(h.nilai("select coalesce(jsonb_agg(jsonb_build_object('f',p.proname,'sec',p.prosecdef,'cfg',p.proconfig,'anon',has_function_privilege('anon',p.oid,'execute'),'auth',has_function_privilege('authenticated',p.oid,'execute'),'svc',has_function_privilege('service_role',p.oid,'execute')) order by p.proname),'[]') "
                               "from pg_proc p where p.proname in ('clinic_save_inpatient_log_correction','clinic_inpatient_visit_correction_allowed','inpatient_visit_correction_actor','inpatient_visit_correction_reason','guard_inpatient_doctor_visit','protect_inpatient_care_staff')"))
    by = {f['f']: f for f in funcs}
    ok = (len(by) == 6 and by['clinic_save_inpatient_log_correction']['sec'] is False and by['clinic_save_inpatient_log_correction']['auth'] and not by['clinic_save_inpatient_log_correction']['anon']
          and by['clinic_inpatient_visit_correction_allowed']['sec'] and by['clinic_inpatient_visit_correction_allowed']['auth'] and not by['clinic_inpatient_visit_correction_allowed']['anon']
          and all(not by[k]['auth'] and not by[k]['anon'] and not by[k]['svc'] for k in ('inpatient_visit_correction_actor', 'inpatient_visit_correction_reason', 'guard_inpatient_doctor_visit', 'protect_inpatient_care_staff'))
          and all('search_path=""' in ' '.join(f['cfg'] or []) for f in funcs))
    check('ACL: RPC koreksi INVOKER (tidak menambah hak) hanya authenticated; fungsi izin layar definer; fungsi privat/pemicu tanpa hak aplikasi; search_path kosong', ok, by)
    trg = h.nilai("select string_agg(tgname,',' order by tgname) from pg_trigger where tgrelid='public.inpatient_daily_logs'::regclass and not tgisinternal")
    check('pemicu catatan harian tetap lengkap (h06, protect, audit edit, log aktivitas)', all(t in (trg or '') for t in ('h06_doctor_visit_guard', 'protect_inpatient_care_staff', 'audit_inpatient_care_edit', 'a01_activity_change')), dict(trg=trg))
    text = (MIG / CANDIDATE).read_text() if (MIG / CANDIDATE).exists() else ''
    check('statik: migrasi tanpa begin/commit sendiri, memakai lock_timeout', text != '' and "set local lock_timeout" in text and not any(l.strip().lower() in ('begin;', 'commit;') for l in text.splitlines()), {})
    if has_column(h):
        e = h.gagal('begin;\n' + text + '\ncommit;')
        check('memasang ulang migrasi ditolak A5_PRECONDITION (tidak ada yang berubah dua kali)', has(e, 'A5_PRECONDITION'), dict(err=short(e)))
    else:
        check('memasang ulang migrasi ditolak A5_PRECONDITION (tidak ada yang berubah dua kali)', False, 'kandidat belum terpasang')


SECTIONS = ['preflight', 'ontime', 'late', 'edit', 'discharged', 'integrity', 'allowed', 'admin', 'static']


def run(h, sections=None):
    fns = dict(preflight=sec_preflight, ontime=sec_ontime, late=sec_late, edit=sec_edit, discharged=sec_discharged, integrity=sec_integrity,
               allowed=sec_allowed, admin=sec_admin_grant, static=sec_static)
    for s in SECTIONS:
        if sections is not None and s not in sections: continue
        print('=== section', s, flush=True)
        try: fns[s](h)
        except Exception as e: check(f'SECTION {s} aborted', False, str(e).strip()[:400])


def apply_candidate(db, text): db.sql('begin;\n' + text + '\ncommit;')


def check_custom_branch(db, h, cand, applied):
    """Salinan database: ADMIN SUDAH punya kebijakan tertulis -> izin ditambahkan, isi lain tetap; pemasangan kandidat di sini."""
    os.environ.pop('PGDATABASE', None)
    db.sql('create database a5_custom template postgres')
    os.environ['PGDATABASE'] = 'a5_custom'
    try:
        grant(h, 'ADMIN', ['bank.cash_entry.view_history'])
        if applied: apply_candidate(db, cand)
        pol = json.loads(h.nilai("select coalesce((select to_jsonb(allowed) from role_settings_private.action_policies where role='ADMIN'),'null')"))
        check('ADMIN yang SUDAH punya kebijakan tertulis: klinik.koreksi_visit DITAMBAHKAN, aksi lain tidak berubah', pol == ['bank.cash_entry.view_history', ACTION], dict(pol=pol))
    finally:
        os.environ.pop('PGDATABASE', None)


def check_guarded_runner(db, h, cand, applied):
    """Runner migrasi Supabase BUKAN superuser: jalan pintas DBA di config_guard tidak berlaku. Ditiru dengan klaim peran non-kosong
    (auth.role() terisi -> config_guard menegakkan izin-transaksi). Kandidat harus tetap berhasil (pemicu penjaga dimatikan sementara
    di dalam transaksinya), dan tanpa langkah itu penulisan kebijakan memang ditolak."""
    claim = "select set_config('request.jwt.claim.role','service_role',true);\n"
    for name, text, want_ok in (('a5_runner', cand, True),
                                ('a5_runner_neg', cand.replace('alter table role_settings_private.epochs disable trigger epoch_guard;', '')
                                 .replace('alter table role_settings_private.action_policies disable trigger action_policy_guard;', ''), False)):
        os.environ.pop('PGDATABASE', None)
        db.sql(f'create database {name} template postgres')
        os.environ['PGDATABASE'] = name
        try:
            err = None
            if applied:
                try: db.sql('begin;\n' + claim + text + '\ncommit;')
                except RuntimeError as e: err = str(e)
            pol = h.nilai("select coalesce((select to_jsonb(allowed) from role_settings_private.action_policies where role='ADMIN'),'null')")
            if want_ok:
                check('runner non-superuser (penjaga Akses Grup aktif): migrasi tetap terpasang dan ADMIN diberi izin', bool(applied and err is None and pol != 'null' and ACTION in json.loads(pol)), dict(err=short(err)))
            else:
                check('kontrol: tanpa mematikan pemicu penjaga, runner non-superuser DITOLAK config_guard (langkah itu memang perlu)', applied and has(err, 'Pengaturan akses berubah') and pol == 'null', dict(err=short(err)))
        finally:
            os.environ.pop('PGDATABASE', None)


MUTANTS = [
    ('M1 izin tanpa baris kebijakan eksplisit (bawaan lama = boleh)', 'admin,late',
     [("v_ok := exists (select 1 from role_settings_private.action_policies a\n                    where a.role = v_role and 'klinik.koreksi_visit' = any (a.allowed))\n            and public.role_action_allowed", "v_ok := public.role_action_allowed", 1)]),
    ('M2 visit > 48 jam tanpa alasan', 'late',
     [("          raise exception using errcode = 'P0001',\n            message = 'VISIT_CORRECTION_REASON: visit dokter lebih dari 48 jam lalu adalah koreksi; alasan koreksi wajib diisi';", "          null;", 1)]),
    ('M3 paramedis visit tidak dijaga', 'edit',
     [("\n       or new.paramedic_id is distinct from old.paramedic_id)", "\n       )", 1)]),
    ('M4 setelah pulang semua peran boleh', 'discharged',
     [("   if clinic_private.inpatient_visit_correction_actor() is null then\n     raise exception using errcode='P0001',message='VISIT_CORRECTION_DENIED: rawat inap sudah ditutup", "   if false then\n     raise exception using errcode='P0001',message='VISIT_CORRECTION_DENIED: rawat inap sudah ditutup", 1)]),
    ('M5 setelah pulang boleh membawa obat', 'discharged',
     [("if coalesce(current_setting('clinic.inpatient_correction_extra',true),'')='1' then", "if false then", 1)]),
    ('M6 tanpa batas masa rawat', 'discharged',
     [("and (tg_op='INSERT' or new.log_date is distinct from old.log_date) then", "and false then", 1)]),
    ('M7 ADMIN bawaan lama tidak diberi izin', 'admin,allowed,late',
     [("  else\n    insert into role_settings_private.action_policies(role, allowed)", "  elsif false then\n    insert into role_settings_private.action_policies(role, allowed)", 1)]),
    ('M8 alasan bisa diubah lewat update', 'integrity',
     [("  new.correction_reason := old.correction_reason;\n", "", 1)]),
    ('M9 Owner ikut dikunci tabel kebijakan', 'late,discharged',
     [("  if v_role = 'OWNER' then return 'OWNER'; end if;\n  begin\n    -- Peran lain: HARUS ada izin tertulis eksplisit (kebijakan \"bawaan lama\" = semua aksi bukan izin tertulis) dan lolos pagar modul/epoch.\n    v_ok := exists (select 1 from role_settings_private.action_policies a\n                    where a.role = v_role and 'klinik.koreksi_visit'",
       "  begin\n    v_ok := exists (select 1 from role_settings_private.action_policies a\n                    where a.role = v_role and 'klinik.koreksi_visit'", 1)]),
    ('M10 pemicu penjaga Akses Grup tidak dinyalakan lagi', 'admin',
     [("alter table role_settings_private.action_policies enable trigger action_policy_guard;\n", "", 1)]),
]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path, required=True); ap.add_argument('--pg-bin')
    ap.add_argument('--baseline', action='store_true'); ap.add_argument('--mutations', action='store_true'); ap.add_argument('--sections'); a = ap.parse_args()
    if a.pg_bin: r.BIN = a.pg_bin
    SEC = set(a.sections.split(',')) if a.sections else None
    extra = {}
    cand = (MIG / CANDIDATE).read_text()
    try:
        with r.NativePostgres(r.BIN) as db:
            okr.build(db, {CANDIDATE}); h = x.Harness(db); x.setup(h); prep(h)
            if a.mutations:
                plan = [('M0 control (unmodified candidate)', cand, None)]; extra['mutants'] = {}
                for name, secs, pairs in MUTANTS:
                    text, ok = cand, True
                    for old, new, expected in pairs:
                        n = text.count(old)
                        if n != expected: check(name + ' anchor occurs %d time(s)' % expected, False, dict(count=n, anchor=old[:60])); ok = False; break
                        text = text.replace(old, new)
                    if ok: plan.append((name, text, set(secs.split(','))))
                for i, (name, text, secs) in enumerate(plan):
                    os.environ.pop('PGDATABASE', None)
                    db.sql(f'create database v{i} template postgres'); os.environ['PGDATABASE'] = f'v{i}'
                    before = len(RESULTS); crash = None
                    try: apply_candidate(db, text); run(h, secs)
                    except Exception as e: crash = 'battery aborted: ' + str(e).strip().splitlines()[0][:200]
                    fails = [cc['case'] for cc in RESULTS[before:] if cc['status'] == 'FAIL']
                    del RESULTS[before:]; os.environ.pop('PGDATABASE', None)
                    if i == 0: check(name + ' has 0 FAIL', not fails and not crash, (fails + [crash or ''])[:3])
                    else:
                        extra['mutants'][name] = dict(killed=bool(fails or crash), failing=fails[:4], crash=crash)
                        check(name + ' KILLED', bool(fails or crash), fails[:3] or [crash])
            else:
                check_custom_branch(db, h, cand, applied=not a.baseline)
                check_guarded_runner(db, h, cand, applied=not a.baseline)
                if not a.baseline: apply_candidate(db, cand)
                run(h, SEC)
    except Exception as e: check('HARNESS', False, str(e)[:800])
    totals = {s: sum(cc['status'] == s for cc in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='mutations' if a.mutations else 'RED' if a.baseline else 'GREEN', cases=RESULTS, totals=totals, **extra), indent=2, default=str)); print(totals)
    return 0 if a.baseline else int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
