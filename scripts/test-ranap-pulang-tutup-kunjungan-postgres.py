#!/usr/bin/env python3
"""Native full schema: pasien rawat inap dipulangkan SETELAH lunas -> kunjungan Selesai.

Kasus nyata: Chloe (Klinik TKI, 2 Nov 2026) dibayar lunas lalu dipulangkan, tetapi
kunjungannya tertahan di "Pembayaran". Semua panggilan memakai RPC publik asli
(kasir rawat inap + ubah kondisi) sebagai pengguna fiktif terautentikasi.

  --baseline  : tanpa migrasi kandidat (harus MERAH pada kasus utama).
  --live-def  : berkas teks pg_get_functiondef produksi; dibandingkan dengan definisi
                hasil rangkaian migrasi TANPA kandidat (bukti kandidat dibangun dari teks
                yang sama dengan produksi).
"""
import argparse, importlib.util, json, re, sys, tempfile
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('medical', ROOT / 'scripts/test-rekam-full-edit-postgres.py'); assert spec and spec.loader
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
x, r, q, j = m.x, m.r, m.q, m.j
CANDIDATE = '20261106070000_ranap_pulang_tutup_kunjungan_lunas.sql'
RESULTS = []


def check(name, ok, detail):
    RESULTS.append(dict(case=name, status='PASS' if ok else 'FAIL', detail=detail)); print(RESULTS[-1], flush=True)


def read(h, v, stay): return json.loads(h.nilai(f'select clinic_read_inpatient_cashier({q(stay)},{q(v)});', r.STAFF))


def save(v, stay, snapshot, rows, parts, key):
    return (f"select clinic_save_inpatient_cashier({q(stay)},{q(v)},{q(key)},'2026-11-03',{q(snapshot)},"
            f"{j(rows)},{j(parts)},null,false,null,'Kasir Fiktif');")


def pulang(stay, status='sembuh'):
    return f"select clinic_change_inpatient_condition({q(stay)},{q(status)},'Pulang fiktif');"


def status(h, v): return h.nilai(f'select status from visits where id={q(v)}')


def stay_of(h, v): return h.nilai(f'select id from inpatient_records where visit_id={q(v)}')


def bayar_lunas(h, v, stay, key, method='Kredit'):
    cart = read(h, v, stay)
    amount = sum(row['qty'] * row['harga'] for row in cart['rows'])
    return h.gagal(save(v, stay, cart['snapshot'], cart['rows'], [dict(method=method, amount=amount)], key), r.STAFF)


def run(h, baseline, live_def, live_billpay=None):
    x.setup(h)
    if live_def:
        # Teks produksi kedua fungsi publik yang diubah. Baseline: rangkaian migrasi tanpa
        # kandidat harus menghasilkan teks yang SAMA PERSIS dengan produksi. Kandidat: teks
        # produksi + hanya blok panggilan penutupan.
        import base64
        src = (ROOT / 'supabase/migrations' / CANDIDATE).read_text()
        for sig, path, marker in [
            ('public.clinic_change_inpatient_condition(uuid,text,text)', live_def,
             '\n  -- Bayar dulu, baru dipulangkan'),
            ('public.clinic_bill_and_pay_inpatient(uuid,uuid,text,date,jsonb,text,boolean,text)', live_billpay,
             '  -- Pulang dulu, baru dibayar lewat kasir rawat inap'),
        ]:
            if not path: continue
            local = base64.b64decode(h.nilai(
                f"select translate(encode(convert_to(pg_get_functiondef({q(sig)}::regprocedure),'UTF8'),'base64'),E'\\n','');"
            )).decode().rstrip('\n')
            live = Path(path).read_text().rstrip('\n')
            if baseline:
                check(f'baseline chain {sig.split("(")[0]} identical to production text', local == live,
                      dict(local_len=len(local), live_len=len(live)))
            else:
                i = local.find(marker); k = local.find('tutup_kunjungan_ranap_lunas(', i)
                k = local.index('\n', k) + 1 if i >= 0 and k >= 0 else -1
                stripped = local[:i] + local[k:] if i >= 0 and k > 0 else local
                if marker.startswith('\n  -- Bayar'):
                    stripped = local[:i] + local[local.index('  end if;\n', k) + len('  end if;\n'):] if i >= 0 else local
                check(f'candidate {sig.split("(")[0]} = production text + closing call only',
                      i >= 0 and stripped == live, dict(found=i >= 0))

    # 1. Urutan Chloe: bayar lunas dulu (kartu), lalu dipulangkan sembuh.
    v, _ = m.visit(h, 2101); stay = stay_of(h, v)
    err = bayar_lunas(h, v, stay, 'chloe-pay')
    lunas = h.nilai(f"select bool_and(paid_status='Lunas') from invoices where visit_id={q(v)} and voided_at is null")
    check('pay-first: invoice Lunas, visit still open while patient admitted',
          not err and lunas in ('t', True, 'true') and status(h, v) == 'Pembayaran', dict(error=err, status=status(h, v)))
    err = h.gagal(pulang(stay), r.STAFF)
    check('pay-first then discharge sembuh closes the visit (Chloe order)',
          not err and status(h, v) == 'Selesai', dict(error=err, status=status(h, v)))

    # 2. Pulang paksa / RIP memakai jalur yang sama: cukup buktikan RIP oleh dokter.
    v, _ = m.visit(h, 2102); stay = stay_of(h, v)
    err = bayar_lunas(h, v, stay, 'rip-pay', method='Tunai')
    err = err or h.gagal(pulang(stay, 'rip'), r.DOCTOR)
    check('pay-first then RIP discharge also closes the visit', not err and status(h, v) == 'Selesai',
          dict(error=err, status=status(h, v)))

    # 3. Belum ada tagihan sama sekali: pulang TIDAK menutup (masih harus ditagih).
    v, _ = m.visit(h, 2103); stay = stay_of(h, v)
    err = h.gagal(pulang(stay), r.STAFF)
    check('discharge without any invoice keeps visit open for billing',
          not err and status(h, v) == 'Pembayaran', dict(error=err, status=status(h, v)))

    # 4. Lunas, lalu dokter menambah biaya baru sebelum pulang: biaya belum ditagih -> tetap terbuka.
    v, mr = m.visit(h, 2104); stay = stay_of(h, v)
    err = bayar_lunas(h, v, stay, 'pending-pay')
    h.sql(f"insert into prescription_items(id,medical_record_id,nama_obat,qty,harga,satuan,jenis) "
          f"values({q(r.uid('e', 2104))},{q(mr)},'Obat Tambahan Fiktif',1,15000,'PCS','obat');")
    err = err or h.gagal(pulang(stay), r.STAFF)
    check('discharge with unbilled new charge keeps visit open', not err and status(h, v) == 'Pembayaran',
          dict(error=err, status=status(h, v)))
    # ...dan setelah biaya itu dibayar, jalur pembayaran lama yang menutupnya (regresi).
    err = bayar_lunas(h, v, stay, 'pending-pay-2')
    check('discharge first then pay remaining via inpatient cashier closes the visit', not err and status(h, v) == 'Selesai',
          dict(error=err, status=status(h, v)))

    # 5. Tagihan aktif belum lunas: pulang TIDAK menutup.
    v, _ = m.visit(h, 2105); stay = stay_of(h, v)
    cart = read(h, v, stay)
    amount = sum(row['qty'] * row['harga'] for row in cart['rows'])
    part = (amount + 1) // 2
    err = h.gagal(save(v, stay, cart['snapshot'], cart['rows'], [dict(method='Tunai', amount=part)], 'half-pay'), r.STAFF)
    if err:
        # DP minimal dapat menolak; pakai alasan pengecualian resmi fiktif.
        err = h.gagal(
            f"select clinic_save_inpatient_cashier({q(stay)},{q(v)},'half-pay-ovr','2026-11-03',{q(cart['snapshot'])},"
            f"{j(cart['rows'])},{j([dict(method='Tunai', amount=part)])},null,false,'Pengecualian fiktif','Kasir Fiktif');",
            r.OWNER)
    unpaid = h.angka(f"select count(*) from invoices where visit_id={q(v)} and voided_at is null and paid_status<>'Lunas'")
    err2 = h.gagal(pulang(stay), r.STAFF)
    check('discharge with an unpaid active invoice keeps visit open',
          not err and not err2 and unpaid >= 1 and status(h, v) == 'Pembayaran',
          dict(error=err, error2=err2, unpaid=unpaid, status=status(h, v)))

    # 6. Kondisi biasa (bukan pulang) tidak menutup apa pun.
    v, _ = m.visit(h, 2106); stay = stay_of(h, v)
    err = bayar_lunas(h, v, stay, 'stable-pay')
    err = err or h.gagal(pulang(stay, 'kritis'), r.STAFF)
    check('non-discharge condition change leaves visit open', not err and status(h, v) == 'Pembayaran',
          dict(error=err, status=status(h, v)))

    # 7. Rapikan data: kunjungan yang tertahan sebelum perbaikan ditutup oleh blok backfill.
    v, _ = m.visit(h, 2107); stay = stay_of(h, v)
    err = bayar_lunas(h, v, stay, 'stuck-pay')
    if baseline:
        return
    # Keadaan lama dibuat ulang: pulang lewat RPC asli, lalu status dikembalikan ke
    # "Pembayaran" seperti sebelum perbaikan.
    err = err or h.gagal(pulang(stay), r.STAFF)
    h.sql(f"update visits set status='Pembayaran' where id={q(v)};")
    before = status(h, v)
    source = (ROOT / 'supabase/migrations' / CANDIDATE).read_text()
    h.sql(source[source.index('-- Rapikan kunjungan yang sudah tertahan'):])
    check('backfill closes previously stuck paid+discharged visit', not err and before == 'Pembayaran'
          and status(h, v) == 'Selesai', dict(error=err, before=before, after=status(h, v)))
    open_admitted = h.angka("select count(*) from visits v join inpatient_records ir on ir.visit_id=v.id "
                            "where ir.discharged_at is null and v.status='Selesai'")
    check('backfill never closes a visit whose patient is still admitted', open_admitted == 0, dict(count=open_admitted))


def main():
    p = argparse.ArgumentParser(); p.add_argument('--baseline', action='store_true'); p.add_argument('--json', type=Path, required=True)
    p.add_argument('--live-def'); p.add_argument('--live-billpay'); a = p.parse_args()
    sources = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
    selected = [s for s in sources if not (a.baseline and s.name == CANDIDATE)]
    try:
        with tempfile.TemporaryDirectory(prefix='chain.', dir=ROOT) as d:
            target = Path(d) / 'supabase/migrations'; target.mkdir(parents=True)
            for s in selected: (target / s.name).symlink_to(s)
            r.fixture.ROOT = Path(d)
            with r.NativePostgres(r.BIN) as db:
                r.fixture.DisposablePostgres.bootstrap(db); run(x.Harness(db), a.baseline, a.live_def, a.live_billpay)
    except Exception as e:
        check('HARNESS', False, str(e))
    totals = {s: sum(c['status'] == s for c in RESULTS) for s in ['PASS', 'FAIL']}
    a.json.write_text(json.dumps(dict(mode='baseline' if a.baseline else 'candidate', migration_count=len(selected), cases=RESULTS, totals=totals), indent=2))
    print(totals); return int(totals['FAIL'] > 0)


if __name__ == '__main__': sys.exit(main())
