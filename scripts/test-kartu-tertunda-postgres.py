#!/usr/bin/env python3
"""Kartu rekam medis tertunda ("Perlu Dilengkapi") — integrasi di PostgreSQL sekali pakai, data fiktif.

Rantai migrasi repo terkini + 20261104140000. Semua panggilan sebagai `authenticated` dengan klaim JWT (seperti
PostgREST). Bukti hanya untuk DB SINTETIS; tidak pernah terhubung ke Production.

Usage: python3 scripts/test-kartu-tertunda-postgres.py --pg-bin DIR [--json OUT]
"""
from pathlib import Path
import argparse
import importlib.util
import json
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location('mkm', ROOT / 'scripts/test-migrasi-kartu-medis-postgres.py')
mkm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mkm)
rs2, rls = mkm.rs2, mkm.rls
record = rls.record
MIGRASI = ROOT / 'supabase/migrations/20261104140000_kartu_rekam_medis_tertunda.sql'
SHA = 'a' * 64


def kartu(key, kekurangan, **isi):
    dasar = {'owner_name': 'UJI TERTUNDA', 'patient_name': 'UJI KUCING T', 'tanggal_usulan': '2024-03-01', 'doctor': 'drh. Fiktif',
             'note': f'Keluhan {key}', 'diagnosis': f'Dx {key}', 'therapy': f'Tx {key}'}
    dasar.update(isi)
    return {'source_key': key, 'batch_sha256': SHA, 'local_record_id': f'L-{key}', 'sumber_berkas': 'fiktif.xlsx',
            'sumber_sheet': key, 'kekurangan': kekurangan, 'isi': {k: v for k, v in dasar.items() if v is not None}}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--pg-bin', required=True)
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT / 'scripts'))
    from native_postgres import NativePostgres
    with NativePostgres(args.pg_bin) as db:
        rls.fresh_without_new(args.pg_bin, db)
        ok, msg, _ = rls.apply_new(db)
        record('Prasyarat: 20261101120000 terpasang', ok, msg[:120] if not ok else 'ok')
        ok, msg = rs2.apply_sql(db, rs2.RS2.read_text())
        record('Prasyarat: RS-2 terpasang', ok, msg[:120] if not ok else 'ok')
        d = rls.Db(db)
        h = rls.base.Harness(db, None)
        rls.base.bootstrap_fixture(h)
        rls.bootstrap(d)
        POLIS = "select md5(string_agg(pol.polrelid::regclass::text||pol.polname||pol.polcmd::text||coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),''), ',' order by 1)) from pg_policy pol"
        FUNGSI_LAMA = ("select md5(string_agg(p.oid::regprocedure::text||md5(pg_get_functiondef(p.oid))||coalesce(p.proacl::text,''), ',' order by 1)) from pg_proc p"
                       " where p.pronamespace in ('public'::regnamespace, 'kamo_import'::regnamespace) and p.proname not like '%kartu%'")
        HAK = "select md5(string_agg(c.oid::regclass::text||coalesce(c.relacl::text,''), ',' order by 1)) from pg_class c where c.relnamespace in ('public'::regnamespace,'kamo_import'::regnamespace) and c.relname <> 'kartu_tertunda' and c.relname not like 'kartu_tertunda%'"
        katalog_lama = [d.last(POLIS), d.last(FUNGSI_LAMA), d.last(HAK)]
        ok, msg = rs2.apply_sql(db, MIGRASI.read_text())
        record('Migrasi 20261104140000 terpasang', ok, msg[:160] if not ok else 'ok')
        if not ok:
            sys.exit(1)
        finansial_awal = mkm.hitung_finansial(d)
        O, A, DOC, OFF = rls.OWNER, rls.ADMIN, rls.DOCTOR, rls.OWNER_OFF
        q = rls.q
        sebagai = lambda sql, who=O: d.try_(rls.actor(sql, who))
        simpan = lambda rows, who=O: sebagai(f"select public.simpan_kartu_tertunda({q(json.dumps(rows))}::jsonb);", who)
        idk = lambda key: d.last(f"select id from kamo_import.kartu_tertunda where source_key={q(key)}")

        # 0. Katalog lama tidak berubah (hanya objek baru ditambahkan).
        record('Migrasi hanya menambah: semua kebijakan, fungsi lama (definisi + hak), dan hak tabel lama identik',
               [d.last(POLIS), d.last(FUNGSI_LAMA), d.last(HAK)] == katalog_lama
               and d.last("select count(*) from pg_policy where polrelid='kamo_import.kartu_tertunda'::regclass") == '0'
               and d.last("select relrowsecurity::text||'|'||pg_get_userbyid(relowner) from pg_class where oid='kamo_import.kartu_tertunda'::regclass") == 'true|kamo_legacy_import_writer', 'md5 sama')

        # 1. Peran / akses langsung.
        for nama, who in [('DOCTOR', DOC), ('OWNER nonaktif', OFF)]:
            for label, sql in [('simpan', f"select public.simpan_kartu_tertunda({q(json.dumps([kartu('x1', ['hp_kosong'])]))}::jsonb);"),
                               ('daftar', "select count(*) from public.daftar_kartu_tertunda('perlu_dilengkapi', null, 0, 10);")]:
                ok, out = sebagai(sql, who)
                record(f'{nama} ditolak: {label}', not ok and ('OWNER/ADMIN' in out or '42501' in out or 'permission' in out), out[:120])
        ok, out = sebagai("select count(*) from kamo_import.kartu_tertunda;")
        record('authenticated tidak bisa membaca tabel kartu langsung (hanya lewat fungsi)', not ok and 'permission denied' in out, out[:120])
        ok, out = d.try_("set role anon; select public.daftar_kartu_tertunda('perlu_dilengkapi', null, 0, 10);")
        record('anon tidak punya EXECUTE', not ok and 'permission denied' in out, out[:120])

        # 2. Simpan idempoten.
        rows = [kartu('t-baru', ['hp_kosong']), kartu('t-ada', ['hp_kosong'], owner_name='NAMA KARTU BEDA'),
                kartu('t-tgl', ['tanggal_bentrok'], phone='083100000001', tanggal_usulan=None, tanggal_tab='2024-09-29', tanggal_sel='2024-04-29'),
                kartu('t-ganda', ['hp_kosong']), kartu('t-hewan', ['hp_kosong']), kartu('t-batal', ['kemungkinan_salinan'], phone='083100000009'),
                kartu('t-atom', ['hp_kosong'])]
        ok, out = simpan(rows)
        hasil = json.loads(out) if ok else []
        record('OWNER menyimpan 7 kartu: semua tersimpan', ok and [x['status'] for x in hasil] == ['tersimpan'] * 7, out[:200])
        ok, out = simpan(rows[:2], A)
        record('Kirim ulang (ADMIN): sudah_ada, tidak dobel', ok and [x['status'] for x in json.loads(out)] == ['sudah_ada'] * 2
               and d.last("select count(*) from kamo_import.kartu_tertunda") == '7', out[:200])
        ubah = kartu('t-baru', ['hp_kosong'], diagnosis='DIUBAH')
        ok, out = simpan([ubah])
        record('Isi berubah dengan jejak sama: bentrok, kartu lama utuh', ok and json.loads(out)[0]['status'] == 'bentrok'
               and d.last("select isi->>'diagnosis' from kamo_import.kartu_tertunda where source_key='t-baru'") == 'Dx t-baru', out[:200])
        d.sql("""set session_replication_role=replica;
          insert into public.customers(id,name,phone) values ('0d000000-0000-4000-8000-0000000000a1','UJI JEJAK','083199999999');
          insert into public.pets(id,customer_id,name) values ('0d000000-0000-4000-8000-0000000000a2','0d000000-0000-4000-8000-0000000000a1','UJI JEJAK');
          insert into public.visits(id,customer_id,pet_id,poli,status,legacy_source_key,legacy_source_hash) values
            ('0d000000-0000-4000-8000-0000000000a3','0d000000-0000-4000-8000-0000000000a1','0d000000-0000-4000-8000-0000000000a2','Poli Umum','Selesai','t-sudah','x'),
            ('0d000000-0000-4000-8000-0000000000a4','0d000000-0000-4000-8000-0000000000a1','0d000000-0000-4000-8000-0000000000a2','Poli Umum','Selesai','t-atom-bentrok','hash-lain');
          set session_replication_role=origin;""")
        ok, out = simpan([kartu('t-sudah', ['hp_kosong'])])
        record('Jejak yang sudah jadi riwayat resmi: sudah_masuk, tidak disimpan', ok and json.loads(out)[0]['status'] == 'sudah_masuk', out[:200])
        for label, row, harap in [
            ('tanpa isi klinis', kartu('t-kosong', ['hp_kosong'], note=None, diagnosis=None, therapy=None), 'tanpa isi klinis'),
            ('kolom tak dikenal', {**kartu('t-asing', ['hp_kosong']), 'isi': {'note': 'x', 'customer_id': 'y'}}, 'tidak dikenal'),
            ('kekurangan tak dikenal', kartu('t-kode', ['bebas']), 'check'),
            ('nama terlalu panjang (tidak dipotong)', kartu('t-panjang', ['hp_kosong'], owner_name='x' * 101), 'melebihi'),
        ]:
            ok, out = simpan([row])
            record(f'Ditolak: {label}', not ok and harap in out.lower(), out[:140])

        # 3. Daftar / detail.
        ok, out = sebagai("select count(*)||'|'||max(total) from public.daftar_kartu_tertunda('perlu_dilengkapi', null, 0, 200);")
        record('Daftar perlu dilengkapi: 7 kartu, total benar', ok and out == '7|7', out)
        ok, out = sebagai("select count(*) from public.daftar_kartu_tertunda('perlu_dilengkapi', 'beda', 0, 200);")
        record('Cari nama pemilik', ok and out == '1', out)
        ok, out = sebagai(f"select isi->>'diagnosis' from public.detail_kartu_tertunda({q(idk('t-tgl'))});")
        record('Detail kartu', ok and out == 'Dx t-tgl', out)
        ok, out = sebagai("select count(*) from public.daftar_kartu_tertunda('perlu_dilengkapi', null, 0, 201);")
        record('Halaman >200 ditolak', not ok, out[:100])

        lengkapi = lambda key, args='', who=O: sebagai(f"select public.lengkapi_kartu_tertunda({q(idk(key))}{args});", who)
        jumlah_pelanggan = lambda: d.last("select count(*) from public.customers")

        # 4. HP kosong: tanpa HP ditolak; HP baru -> pemilik baru bertanda impor, riwayat tanpa cabang.
        ok, out = lengkapi('t-baru')
        record('Tanpa HP (kartu hp_kosong): ditolak', not ok and 'nomor HP' in out, out[:120])
        ok, out = lengkapi('t-baru', ", p_phone => '0000000000'")
        record('HP angka berulang ditolak (tidak dikarang)', not ok and 'tidak valid' in out, out[:120])
        sebelum = jumlah_pelanggan()
        ok, visit = lengkapi('t-baru', ", p_phone => '+62 831-0000-0002'")
        cek = d.last(f"""select json_build_object('cust', (select count(*) from public.customers c where c.phone='+62 831-0000-0002' and c.imported_at is not null and c.name='UJI TERTUNDA'),
            'cabang_null', v.branch_id is null, 'dx', m.diagnosis, 'status', k.status, 'vid', k.visit_id = v.id, 'tgl', to_char(v.created_at at time zone 'Asia/Jakarta','YYYY-MM-DD HH24:MI'))
            from public.visits v join public.medical_records m on m.visit_id=v.id join kamo_import.kartu_tertunda k on k.source_key=v.legacy_source_key
            where v.id={q(visit) if ok else 'null'}""") if ok else '{}'
        record('HP baru: 1 pemilik baru ber-imported_at, riwayat tanpa cabang, kartu selesai dengan visit_id', ok and json.loads(cek) == {
            'cust': 1, 'cabang_null': True, 'dx': 'Dx t-baru', 'status': 'selesai', 'vid': True, 'tgl': '2024-03-01 00:00'}
            and int(jumlah_pelanggan()) == int(sebelum) + 1, cek)
        ok, out = lengkapi('t-baru', ", p_phone => '083100000002'")
        record('Kartu selesai tidak bisa dilengkapi ulang', not ok and 'sudah selesai' in out, out[:120])

        # 5. HP sama dengan pemilik lama bernama lain: dipakai, nama lama utuh, tanpa pemilik baru.
        d.sql("insert into public.customers(id,name,phone,address) values ('0d000000-0000-4000-8000-0000000000b1','NAMA LAMA','6283100000003','Alamat lama');")
        sebelum = jumlah_pelanggan()
        ok, visit = lengkapi('t-ada', ", p_phone => '083100000003'")
        record('HP sama nama beda: pemilik lama dipakai, nama/alamat lama utuh, tanpa pemilik baru',
               ok and jumlah_pelanggan() == sebelum and d.last(f"select customer_id::text from public.visits where id={q(visit)}") == '0d000000-0000-4000-8000-0000000000b1'
               and d.last("select name||'|'||address||'|'||(imported_at is null)::text from public.customers where id='0d000000-0000-4000-8000-0000000000b1'") == 'NAMA LAMA|Alamat lama|true', visit[:120])

        # 6. Dua pemilik dengan HP sama: ditolak; dengan pemilik dipilih: masuk.
        d.sql("""insert into public.customers(id,name,phone) values ('0d000000-0000-4000-8000-0000000000c1','GANDA A','083100000004'),
                 ('0d000000-0000-4000-8000-0000000000c2','GANDA B','+6283100000004');""")
        ok, out = lengkapi('t-ganda', ", p_phone => '083100000004'")
        record('Dua pemilik ber-HP sama: ditolak, minta pilih (tidak digabung)', not ok and 'pilih pemiliknya' in out, out[:120])
        ok, out = lengkapi('t-ganda', ", p_customer_id => '0d000000-0000-4000-8000-0000000000c1', p_phone => '083100000099'")
        record('Pemilik dipilih tapi HP berbeda: ditolak', not ok and 'berbeda' in out, out[:120])
        ok, visit = lengkapi('t-ganda', ", p_customer_id => '0d000000-0000-4000-8000-0000000000c2'")
        record('Pemilik dipilih: masuk ke pemilik itu', ok and d.last(f"select customer_id::text from public.visits where id={q(visit)}") == '0d000000-0000-4000-8000-0000000000c2', visit[:120])

        # 7. Tanggal bentrok: wajib pilih tanggal; masa depan ditolak; tanggal pilihan dipakai (00:00 WIB).
        ok, out = lengkapi('t-tgl')
        record('Tanggal bentrok tanpa pilihan: ditolak', not ok and 'tanggal' in out.lower(), out[:120])
        ok, out = lengkapi('t-tgl', ", p_record_date => (now() at time zone 'Asia/Jakarta')::date + 2")
        record('Tanggal masa depan ditolak', not ok and 'rentang' in out, out[:120])
        ok, visit = lengkapi('t-tgl', ", p_record_date => date '2024-09-29'")
        record('Tanggal pilihan dipakai; HP kartu yang sah dipakai otomatis', ok and d.last(
            f"select to_char(v.created_at at time zone 'Asia/Jakarta','YYYY-MM-DD HH24:MI')||'|'||c.phone from public.visits v join public.customers c on c.id=v.customer_id where v.id={q(visit)}")
            == '2024-09-29 00:00|083100000001', visit[:120])

        # 8. Hewan senama >1 (termasuk nonaktif): ditolak; dengan hewan dipilih: masuk.
        d.sql("""insert into public.customers(id,name,phone) values ('0d000000-0000-4000-8000-0000000000d1','UJI HEWAN','083100000005');
          insert into public.pets(id,customer_id,name,status) values ('0d000000-0000-4000-8000-0000000000d2','0d000000-0000-4000-8000-0000000000d1','UJI KUCING T','Nonaktif'),
            ('0d000000-0000-4000-8000-0000000000d3','0d000000-0000-4000-8000-0000000000d1','uji kucing t','Aktif');""")
        ok, out = lengkapi('t-hewan', ", p_phone => '083100000005'")
        record('Hewan senama >1 (termasuk nonaktif): ditolak, minta pilih', not ok and 'pilih hewannya' in out, out[:120])
        ok, visit = lengkapi('t-hewan', ", p_phone => '083100000005', p_pet_id => '0d000000-0000-4000-8000-0000000000d3'")
        record('Hewan dipilih: masuk ke hewan itu', ok and d.last(f"select pet_id::text from public.visits where id={q(visit)}") == '0d000000-0000-4000-8000-0000000000d3', visit[:120])

        # 9. Atomik: penulisan riwayat gagal (jejak bentrok) -> pemilik baru batal, kartu tetap menunggu.
        d.sql("update kamo_import.kartu_tertunda set source_key='t-atom-bentrok' where source_key='t-atom';")
        sebelum = jumlah_pelanggan()
        ok, out = lengkapi('t-atom-bentrok', ", p_phone => '083100000006'")
        record('Gagal di tengah: tidak ada pemilik baru tertinggal, kartu tetap perlu dilengkapi',
               not ok and jumlah_pelanggan() == sebelum and d.last("select status from kamo_import.kartu_tertunda where source_key='t-atom-bentrok'") == 'perlu_dilengkapi', out[:120])

        # 10. Batalkan (salinan): wajib alasan; setelah batal tidak bisa dilengkapi; tidak ada DELETE.
        ok, out = sebagai(f"select public.batalkan_kartu_tertunda({q(idk('t-batal'))}, '  ');")
        record('Batal tanpa alasan ditolak', not ok and 'Alasan' in out, out[:120])
        ok, out = sebagai(f"select public.batalkan_kartu_tertunda({q(idk('t-batal'))}, 'Salinan identik kartu lain');", A)
        ok2, out2 = lengkapi('t-batal', ", p_phone => '083100000009'")
        record('ADMIN membatalkan salinan; kartu batal tidak bisa dilengkapi; baris tetap ada',
               ok and not ok2 and d.last("select status||'|'||catatan from kamo_import.kartu_tertunda where source_key='t-batal'") == 'dibatalkan|Salinan identik kartu lain', out2[:120])
        ok, out = sebagai(f"select public.batalkan_kartu_tertunda({q(idk('t-baru'))}, 'x');", DOC)
        record('DOCTOR tidak bisa membatalkan', not ok, out[:120])

        # 11. Invarian.
        record('Tidak ada efek keuangan/stok/resep/quest (hitungan tabel sama persis)', mkm.hitung_finansial(d) == finansial_awal, '')
        record('Setiap pemilik yang dibuat dari kartu tertunda bertanda imported_at',
               d.last("""select count(*) from kamo_import.kartu_tertunda k join public.customers c on c.id=(k.penyelesaian->>'customer_id')::uuid
                         where (k.penyelesaian->>'pemilik_baru')::boolean and c.imported_at is null""") == '0'
               and d.last("select count(*) from kamo_import.kartu_tertunda where (penyelesaian->>'pemilik_baru')::boolean") == '2', '')
        record('Riwayat dari kartu tertunda: tanpa cabang, tepat satu rekam medis',
               d.last("""select count(*) from kamo_import.kartu_tertunda k join public.visits v on v.id=k.visit_id
                         where v.branch_id is not null or (select count(*) from public.medical_records m where m.visit_id=v.id) <> 1""") == '0', '')

    fails = [x for x in rls.RESULTS if x['status'] != 'PASS']
    print(f"TOTAL pass={len(rls.RESULTS) - len(fails)} fail={len(fails)}", flush=True)
    if args.json:
        args.json.write_text(json.dumps({'results': rls.RESULTS}, indent=2))
    sys.exit(0 if not fails else 1)


if __name__ == '__main__':
    main()
