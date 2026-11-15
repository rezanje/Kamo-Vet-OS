#!/usr/bin/env python3
"""Koreksi Berat Badan di rekam medis sebelum tagihan — rantai migrasi asli, PostgreSQL native.
Semua orang/hewan fiktif. --baseline membuang hanya migrasi kandidat (hasil MERAH yang diharapkan);
--mutants memasang satu mutan per jalankan dan mengharapkan minimal satu kasus GAGAL.
"""
import argparse, importlib.util, json, sys, tempfile
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('ranap', ROOT / 'scripts/test-ranap-racikan-postgres.py')
assert spec and spec.loader
x = importlib.util.module_from_spec(spec); spec.loader.exec_module(x)
r, q, j = x.r, x.q, x.j
CANDIDATE = '20261120100000_koreksi_berat_rekam_medis.sql'
RESULTS = []


def check(name, ok, detail=None):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail or {}))
    print(RESULTS[-1]['status'], name, json.dumps(detail or {}, ensure_ascii=False, default=str)[:300], flush=True)


ABSENT = object()


def fields(berat=ABSENT, **kw):
    f = dict(anamnesis='Req vaksin, groom BB 1kg', diagnosis='Diagnosis Fiktif', therapy='Terapi Fiktif', suhu=39.6,
             gejala_klinis=None, hasil_penunjang=None)
    f.update(kw)
    if berat is not ABSENT:
        f['berat'] = berat
    return f


def edit(v, m, revision, rows, key, changes, reason='Salah ketik berat, timbangan 1 kg'):
    # Jalur yang dipakai layar: pembungkus dengan racikan kosong.
    return (f"select public.clinic_edit_queued_record_with_compounds({q(v)},{q(m)},{revision},{j(changes)},{j(rows)},'[]'::jsonb,"
            f"{q(reason)},{q(key)});")


def rows(h, m):
    return json.loads(h.nilai(f"select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from prescription_items p where medical_record_id={q(m)}"))


def visit(h, n, species=None, weight='2.6', berat='2.6'):
    v = r.buat_kunjungan(h, n, r.buat_pelanggan(h, n))
    m = r.uid(7, n)
    pet = h.nilai(f"select pet_id from visits where id={q(v)}")
    sp = 'null' if species is None else q(species)
    h.sql(f"update medical_records set submission_key='initial-{n}',submitted_by={q(r.DOCTOR)},berat={berat},suhu=39.6 where id={q(m)};"
          f"update visits set status='Pembayaran',service_started_at=now()-interval '10 minutes',service_finished_at=now() where id={q(v)};"
          f"update pets set species={sp},weight={weight} where id={q(pet)};")
    return v, m, pet


def berat(h, m): return h.nilai(f"select berat from medical_records where id={q(m)}")
def weight(h, pet): return h.nilai(f"select weight from pets where id={q(pet)}")
def audits(h, m): return h.angka(f"select count(*) from clinic_record_corrections where medical_record_id={q(m)}")
def rev(h, m): return h.angka(f"select clinical_revision from medical_records where id={q(m)}")


def run(h):
    x.setup(h)
    # 1. Jalur layar: DOKTER mengoreksi 2,6 -> 1 pada rekam terbaru; audit, alasan, profil ikut.
    v, m, pet = visit(h, 2000, species='Kucing')
    cart = rows(h, m)
    snap = h.nilai(f"select jsonb_build_array((select jsonb_agg(to_jsonb(p) order by id) from prescription_items p where medical_record_id={q(m)}),"
                   f"(select to_jsonb(vv)-'updated_at' from visits vv where id={q(v)}),(select count(*) from invoices where visit_id={q(v)}),"
                   f"(select m.submission_key||m.submitted_by::text||m.created_at::text from medical_records m where m.id={q(m)}))")
    err = h.gagal(edit(v, m, 0, cart, 'kb-1', fields(1)), r.DOCTOR)
    check('DOKTER koreksi berat 2,6 -> 1 lewat jalur layar tersimpan', not err and berat(h, m) == '1.00' and rev(h, m) == 1, dict(error=err, berat=berat(h, m)))
    if err:
        return
    a = json.loads(h.nilai(f"select jsonb_build_object('chg',changes,'bef',before_value->'berat','aft',after_value->'berat','reason',reason,'by',created_by) from clinic_record_corrections where medical_record_id={q(m)}"))
    check('audit menyimpan berat lama (2,6), berat baru (1), alasan, pelaku', a['bef'] == 2.6 and a['aft'] == 1 and a['chg']['berat'] == 1
          and a['reason'].startswith('Salah ketik') and a['by'] == r.DOCTOR, a)
    check('profil anabul ikut (rekam terbaru & profil = nilai lama)', weight(h, pet) == '1.00', dict(weight=weight(h, pet)))
    snap2 = h.nilai(f"select jsonb_build_array((select jsonb_agg(to_jsonb(p) order by id) from prescription_items p where medical_record_id={q(m)}),"
                    f"(select to_jsonb(vv)-'updated_at' from visits vv where id={q(v)}),(select count(*) from invoices where visit_id={q(v)}),"
                    f"(select m.submission_key||m.submitted_by::text||m.created_at::text from medical_records m where m.id={q(m)}))")
    check('resep, kunjungan, invoice, identitas rekam tidak berubah oleh koreksi berat', snap == snap2, {})
    err = h.gagal(edit(v, m, 0, cart, 'kb-1', fields(1)), r.DOCTOR)
    check('kirim ulang kunci sama = tidak ganda', not err and audits(h, m) == 1 and rev(h, m) == 1 and weight(h, pet) == '1.00', dict(error=err))
    err = h.gagal(edit(v, m, 1, rows(h, m), 'kb-1b', fields(1.55), reason='Koreksi lagi'), r.OWNER)
    check('OWNER boleh; dua desimal diterima (numeric(6,2))', not err and berat(h, m) == '1.55' and weight(h, pet) == '1.55', dict(error=err))

    # 2. Validasi DB: nilai tidak sah ditolak tanpa jejak.
    v2, m2, pet2 = visit(h, 2001, species='Kucing')
    c2 = rows(h, m2)
    for label, val, pesan in [('nol', 0, 'Berat badan tidak valid'), ('negatif', -1, 'Berat badan tidak valid'), ('3 desimal', 2.555, 'Berat badan tidak valid'),
                              ('>= 10000', 10000, 'Berat badan tidak valid'), ('teks', '3', 'Hanya catatan klinis'), ('di atas batas Kucing 15', 15.5, 'tidak wajar untuk kucing'),
                              ('dikosongkan', None, 'tidak boleh dikosongkan')]:
        err = h.gagal(edit(v2, m2, 0, c2, 'bad-' + label.replace(' ', ''), fields(val)), r.DOCTOR)
        check('tolak berat ' + label + ' dengan pesan yang benar', bool(err) and pesan in err and berat(h, m2) == '2.60' and audits(h, m2) == 0 and weight(h, pet2) == '2.60', dict(error=(err or '')[:160]))
    err = h.gagal(edit(v2, m2, 0, c2, 'edge-15', fields(15)), r.DOCTOR)
    check('batas Kucing 15 kg tepat diterima', not err and berat(h, m2) == '15.00', dict(error=err))
    for sp, ok_, bad_ in [('Anjing', 100, 101), ('Kelinci', 10, 10.5), ('Burung', 5, 5.5)]:
        n = 2010 + ['Anjing', 'Kelinci', 'Burung'].index(sp)
        vv, mm, pp = visit(h, n, species=sp, berat='1', weight='1')
        cc = rows(h, mm)
        e1 = h.gagal(edit(vv, mm, 0, cc, 'cap-bad-' + sp, fields(bad_)), r.DOCTOR)
        e2 = h.gagal(edit(vv, mm, 0, cc, 'cap-ok-' + sp, fields(ok_)), r.DOCTOR)
        check(f'batas {sp} {ok_} kg: {bad_} ditolak, {ok_} diterima', bool(e1) and not e2 and berat(h, mm) == f'{ok_}.00', dict(bad=(e1 or '')[:100], ok=e2))
    vs, ms, ps = visit(h, 2020, species=None, berat='1', weight='1')
    err = h.gagal(edit(vs, ms, 0, rows(h, ms), 'cap-none', fields(250)), r.DOCTOR)
    check('spesies tanpa batas (null) tidak dibatasi, sama dengan layar', not err and berat(h, ms) == '250.00', dict(error=err))

    # 3. Alasan wajib.
    v3, m3, pet3 = visit(h, 2030, species='Kucing')
    for label, reason in [('kosong', ''), ('spasi', '   '), ('2 huruf', 'ab')]:
        err = h.gagal(edit(v3, m3, 0, rows(h, m3), 'reason-' + label.replace(' ', ''), fields(2), reason=reason), r.DOCTOR)
        check('alasan ' + label + ' ditolak', bool(err) and berat(h, m3) == '2.60' and audits(h, m3) == 0, dict(error=(err or '')[:120]))

    # 4. Berat tidak diubah / kunci berat tidak dikirim (klien lama): profil tidak disentuh.
    v4, m4, pet4 = visit(h, 2040, species='Kucing')
    h.sql(f"update pets set weight=9 where id={q(pet4)}")
    # Profil = nilai rekam (2,6) dan berat yang sama dikirim: baris profil tidak boleh ditulis sama sekali (xmin tetap).
    v4b, m4b, pet4b = visit(h, 2041, species='Kucing')
    xmin0 = h.nilai(f"select xmin::text from pets where id={q(pet4b)}")
    err = h.gagal(edit(v4b, m4b, 0, rows(h, m4b), 'same-berat-eq', fields(2.6), reason='Koreksi diagnosis saja'), r.DOCTOR)
    check('berat sama + profil sama: profil tidak ditulis ulang (xmin tetap)', not err and h.nilai(f"select xmin::text from pets where id={q(pet4b)}") == xmin0 and rev(h, m4b) == 1, dict(error=err))
    err = h.gagal(edit(v4, m4, 0, rows(h, m4), 'same-berat', fields(2.6), reason='Koreksi diagnosis saja'), r.DOCTOR)
    check('berat sama dikirim: rekam tetap 2,6 dan profil (9) tidak ditulis', not err and berat(h, m4) == '2.60' and weight(h, pet4) == '9.00' and rev(h, m4) == 1, dict(error=err, weight=weight(h, pet4)))
    err = h.gagal(edit(v4, m4, 1, rows(h, m4), 'absent-berat', fields(), reason='Klien lama tanpa berat'), r.DOCTOR)
    check('payload tanpa kunci berat (klien lama): berat & profil tetap', not err and berat(h, m4) == '2.60' and weight(h, pet4) == '9.00' and rev(h, m4) == 2, dict(error=err))
    # profil diubah orang lain (9) != nilai lama rekam (2,6): koreksi berat rekam terbaru tidak menimpa profil
    err = h.gagal(edit(v4, m4, 2, rows(h, m4), 'profile-diff', fields(1.2), reason='Koreksi berat, profil sudah diubah'), r.DOCTOR)
    check('berat profil yang sudah diubah orang lain tidak ditimpa', not err and berat(h, m4) == '1.20' and weight(h, pet4) == '9.00', dict(error=err, weight=weight(h, pet4)))

    # 5. Rekam lama vs terbaru pada hewan yang sama.
    v5, m5, pet5 = visit(h, 2050, species='Kucing', berat='2.6', weight='2.6')   # rekam terbaru
    v5o = r.uid(6, 2051); m5o = r.uid(7, 2051)
    h.sql(f"""insert into visits(id,branch_id,customer_id,pet_id,status,doctor_id,service_started_at,service_finished_at)
 select {q(v5o)},branch_id,customer_id,pet_id,'Pembayaran',doctor_id,now()-interval '3 hour',now()-interval '2 hour' from visits where id={q(v5)};
insert into medical_records(id,visit_id,submission_key,submitted_by,berat,suhu,created_at) values ({q(m5o)},{q(v5o)},'initial-old',{q(r.DOCTOR)},0.8,38,now()-interval '14 day');
insert into prescription_items(medical_record_id,nama_obat,qty,harga,jenis,satuan,faktor) values ({q(m5o)},'Jasa Fiktif',1,1000,'jasa','kali',1);""")
    err = h.gagal(edit(v5o, m5o, 0, rows(h, m5o), 'old-rec', fields(0.9), reason='Koreksi rekam lama'), r.DOCTOR)
    check('koreksi rekam LAMA: rekam berubah, profil (rekam terbaru 2,6) tidak ditimpa', not err and berat(h, m5o) == '0.90' and weight(h, pet5) == '2.60' and berat(h, m5) == '2.60', dict(error=err, weight=weight(h, pet5)))
    err = h.gagal(edit(v5, m5, 0, rows(h, m5), 'new-rec', fields(2.2), reason='Koreksi rekam terbaru'), r.DOCTOR)
    check('koreksi rekam TERBARU memperbarui profil, rekam lama utuh', not err and weight(h, pet5) == '2.20' and berat(h, m5o) == '0.90', dict(error=err, weight=weight(h, pet5)))

    # 5b. Rekam lama dengan berat SAMA dengan profil (bukan terbaru): tetap tidak menimpa profil.
    v5b, m5b, pet5b = visit(h, 2055, species='Kucing', berat='2.6', weight='2.6')
    v5c = r.uid(6, 2056); m5c = r.uid(7, 2056)
    h.sql(f"""insert into visits(id,branch_id,customer_id,pet_id,status,doctor_id,service_started_at,service_finished_at)
 select {q(v5c)},branch_id,customer_id,pet_id,'Pembayaran',doctor_id,now()-interval '3 hour',now()-interval '2 hour' from visits where id={q(v5b)};
insert into medical_records(id,visit_id,submission_key,submitted_by,berat,suhu,created_at) values ({q(m5c)},{q(v5c)},'initial-old2',{q(r.DOCTOR)},2.6,38,now()-interval '14 day');
insert into prescription_items(medical_record_id,nama_obat,qty,harga,jenis,satuan,faktor) values ({q(m5c)},'Jasa Fiktif',1,1000,'jasa','kali',1);""")
    err = h.gagal(edit(v5c, m5c, 0, rows(h, m5c), 'old-eq', fields(1.0), reason='Koreksi rekam lama sama berat'), r.DOCTOR)
    check('rekam LAMA berberat sama dengan profil: profil tetap 2,6 (bukan rekam terbaru)', not err and berat(h, m5c) == '1.00' and weight(h, pet5b) == '2.60', dict(error=err, weight=weight(h, pet5b)))

    # 6. Peran & tagihan: gerbang lama tidak melebar.
    v6, m6, pet6 = visit(h, 2060, species='Kucing')
    for user in [r.ADMIN, r.STAFF, r.FINANCE, r.FIN_NONAKTIF, r.FIN_LUAR]:
        err = h.gagal(edit(v6, m6, 0, rows(h, m6), 'deny-' + user, fields(1)), user)
        check('berat: ' + r.PERAN[user] + ' ' + user[-2:] + ' ditolak', bool(err) and berat(h, m6) == '2.60' and audits(h, m6) == 0 and weight(h, pet6) == '2.60', dict(error=(err or '')[:100]))
    err = h.gagal(f"update medical_records set berat=1 where id={q(m6)}", r.OWNER)
    check('UPDATE langsung berat (Owner) tetap ditolak penjaga RECORD_POSTED', bool(err) and berat(h, m6) == '2.60', dict(error=(err or '')[:100]))
    err2 = h.gagal(f"insert into clinic_record_corrections(medical_record_id,expected_revision,changes,reason,request_key,created_by,transaction_id,before_value,after_value) values ({q(m6)},0,{q(json.dumps(fields(1)))}::jsonb,'Langsung','direct',{q(r.OWNER)},0,'{{}}','{{}}')", r.OWNER)
    check('INSERT langsung ke tabel audit tetap ditolak', bool(err2) and berat(h, m6) == '2.60' and audits(h, m6) == 0, dict(error=(err2 or '')[:100]))
    vp, mp, petp = visit(h, 2070, species='Kucing')
    # Invoice fiktif (pemicu rawat inap dilewati hanya untuk menyiapkan data); alur invoice asli diuji di rekam-full-edit.
    try:
        h.sql(f"set session_replication_role=replica; insert into invoices(id,visit_id,voided_at) values (gen_random_uuid(),{q(vp)},now())")
        made = True
    except RuntimeError as e:
        made = False; check('SIAPKAN invoice fiktif', False, dict(error=str(e)[:200]))
    if made:
        err = h.gagal(edit(vp, mp, 0, rows(h, mp), 'invoiced', fields(1)), r.OWNER)
        check('setelah invoice terbit: koreksi berat ditolak (RECORD_POSTED), berat & profil utuh', bool(err and 'RECORD_POSTED' in err) and berat(h, mp) == '2.60' and weight(h, petp) == '2.60', dict(error=(err or '')[:100]))
    # Migrasi tidak melonggarkan field lain: kunci tak dikenal tetap ditolak.
    err = h.gagal(edit(v6, m6, 0, rows(h, m6), 'unknown-key', dict(fields(1), follow_up='x')), r.DOCTOR)
    check('kunci tak dikenal (follow_up) tetap ditolak', bool(err) and audits(h, m6) == 0, dict(error=(err or '')[:100]))
    # Fungsi trigger tidak bisa dipanggil langsung oleh pengguna.
    err = h.gagal("select public.apply_clinic_record_correction()", r.OWNER)
    check('fungsi trigger tidak dapat dieksekusi pengguna', bool(err), dict(error=(err or '')[:100]))
    # 7. ROLLBACK terdokumentasi: kembali ke perilaku lama (berat ditolak), data & audit yang sudah ada utuh.
    before_rb = h.nilai(f"select to_jsonb(m)::text from medical_records m where id={q(m)}")
    audits_before = h.angka("select count(*) from clinic_record_corrections")
    h.sql((ROOT / 'docs/rollback/2026-11-20-koreksi-berat-rekam-medis.sql').read_text())
    v7, m7, pet7 = visit(h, 2080, species='Kucing')
    err = h.gagal(edit(v7, m7, 0, rows(h, m7), 'after-rollback', fields(1)), r.DOCTOR)
    check('setelah ROLLBACK: berat ditolak lagi, data lama dan audit utuh',
          bool(err and 'Hanya catatan klinis' in err) and berat(h, m7) == '2.60'
          and h.nilai(f"select to_jsonb(m)::text from medical_records m where id={q(m)}") == before_rb
          and h.angka("select count(*) from clinic_record_corrections") == audits_before, dict(error=(err or '')[:100]))
    err = h.gagal(edit(v7, m7, 0, rows(h, m7), 'after-rollback-ok', fields(suhu=38.5), reason='Koreksi catatan biasa'), r.DOCTOR)
    check('setelah ROLLBACK: koreksi catatan lain (tanpa berat) tetap jalan', not err and rev(h, m7) == 1, dict(error=err))


MUTANTS = [
    ('cap-dihapus', "if v_cap is not null and v_berat>v_cap then", "if false then"),
    ('presisi-dihapus', "or v_berat<>round(v_berat,2) then", "then"),
    ('nol-diterima', "if v_berat<=0 or", "if v_berat<0 or"),
    ('kosong-diterima', "if source.berat is not null then raise exception 'Berat badan tidak boleh", "if false then raise exception 'Berat badan tidak boleh"),
    ('berat-tidak-disimpan', "berat=case when new.changes?'berat' then(new.changes->>'berat')::numeric else berat end,", "berat=berat,"),
    ('profil-tanpa-cek-terbaru', "where v2.pet_id=v_pet and m2.id<>new.medical_record_id and m2.berat is not null and(m2.created_at,m2.id)>(v_at,new.medical_record_id))then", "where false)then"),
    ('profil-tanpa-cek-nilai-lama', "where id=v_pet and weight is not distinct from v_old;", "where id=v_pet;"),
    ('profil-selalu-ditulis-bila-sama', "if new.changes?'berat' and v_new is not null and v_new is distinct from v_old then", "if new.changes?'berat' and v_new is not null then"),
    ('profil-tidak-pernah-ikut', "update public.pets set weight=v_new where", "update public.pets set weight=weight where"),
    ('kunci-berat-tak-dikenal', "e.key not in('suhu','berat')and", "e.key not in('suhu')and"),
]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--baseline', action='store_true'); p.add_argument('--mutant'); p.add_argument('--list-mutants', action='store_true')
    p.add_argument('--json', type=Path); a = p.parse_args()
    if a.list_mutants:
        print('\n'.join(m[0] for m in MUTANTS)); return 0
    cand = ROOT / 'supabase/migrations' / CANDIDATE
    text = cand.read_text()
    if a.mutant:
        name, old, new = next(m for m in MUTANTS if m[0] == a.mutant)
        assert text.count(old) == 1, ('mutan tidak berjangkar', name)
        text = text.replace(old, new)
    with tempfile.TemporaryDirectory(prefix='berat-chain.', dir='/opt/data') as d:
        root = Path(d); target = root / 'supabase/migrations'; target.mkdir(parents=True)
        for s in (ROOT / 'supabase/migrations').glob('*.sql'):
            if s.name == CANDIDATE:
                if a.baseline:
                    continue
                (target / s.name).write_text(text)
            else:
                (target / s.name).symlink_to(s)
        r.fixture.ROOT = root
        try:
            with r.NativePostgres(r.BIN) as db:
                r.fixture.DisposablePostgres.bootstrap(db)
                h = x.Harness(db)
                run(h)
        except Exception as e:
            check('HARNESS', False, dict(error=str(e)[:400]))
    totals = {s: sum(c['status'] == s for c in RESULTS) for s in ['PASS', 'FAIL']}
    if a.json:
        a.json.write_text(json.dumps(dict(mode='MUTANT:' + a.mutant if a.mutant else 'RED' if a.baseline else 'candidate', cases=RESULTS, totals=totals), indent=2, ensure_ascii=False))
    print(totals)
    return int(totals['FAIL'] > 0)


if __name__ == '__main__':
    sys.exit(main())
