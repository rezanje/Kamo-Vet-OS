#!/usr/bin/env python3
"""Batalkan penjualan kasir walau kasir sudah membuat transaksi sesudahnya, selama struk itu tidak memberi hadiah staf
(21 Nov 2026, kasus POS-20261120-0008-K821). Migrasi 20261202100000_batal_struk_hadiah_staf_tak_berurutan.sql.

Native throwaway PostgreSQL only (full migration chain, fictional fixtures). Never accepts a database URL, no network.
Fixture petshop & helper struk dipinjam dari scripts/test-b3-jurnal-batal-tanggal-asli-postgres.py.

  mkdir -p /opt/data && python3 -I scripts/test-batal-struk-hadiah-staf-postgres.py [--pg-bin DIR] [--json out.json] [--baseline]
  (default)   chain without candidate -> fixtures -> candidate -> behaviour checks.
  --baseline  same fixtures WITHOUT the candidate: every feature case must FAIL (RED); regression cases must PASS.
"""
import argparse, importlib.util, json, os, sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('b3', ROOT / 'scripts/test-b3-jurnal-batal-tanggal-asli-postgres.py'); assert spec and spec.loader
b3 = importlib.util.module_from_spec(spec); spec.loader.exec_module(b3)
okr, x, r, q = b3.okr, b3.x, b3.r, b3.q
PO, PC = b3.PO, b3.PC
CANDIDATE = ROOT / 'supabase/migrations/20261202100000_batal_struk_hadiah_staf_tak_berurutan.sql'
RESULTS = []
QUEST = 'c5000000-0000-4000-8000-000000000001'
BLOCK = 'Transaksi staf berikutnya masih aktif'


def check(name, ok, detail=None, kind='feature'):
    RESULTS.append(dict(case=name, kind=kind, status='PASS' if ok else 'FAIL', detail=detail))
    print(RESULTS[-1]['status'], f'[{kind}]', name, json.dumps(detail, default=str)[:400], flush=True)


def sale(h, ref):
    sid = b3.sale(h, ref, 'Tunai')   # 100.000 hari ini, kasir PC
    h.sql(f"select public.apply_sale_staff_effects({q(sid)});", PC)
    return sid


def cancel(h, sid, key): return b3.cancel_sale(h, sid, key)


def voided(h, sid): return h.nilai(f"select voided_at is not null from public.sales where id={q(sid)}") == 't'


def progress(h):
    v = h.nilai(f"select coalesce((select current_value::bigint||':'||status from public.staff_quest_progress where staff_id={q(PC)} and quest_definition_id={q(QUEST)}),'none')")
    return v


def staff_state(h):
    return json.loads(h.nilai(f"select jsonb_build_object('points',(select total_points from public.staff_points where staff_id={q(PC)}),"
                              f"'streak',(select current_streak_days from public.staff_streaks where staff_id={q(PC)}),"
                              f"'ledger',(select coalesce(sum(points_delta),0) from public.staff_points_ledger where staff_id={q(PC)}))"))


def reset_staff(h, target, reward=100):
    """Kasir mulai bersih: semua struk aktif lama dibatalkan berurutan dulu oleh pemanggil; di sini set misi & poin."""
    h.sql(f"""set session_replication_role=replica;
delete from public.staff_quest_progress where staff_id={q(PC)};
delete from public.staff_streaks where staff_id={q(PC)};
update public.sale_staff_effects set reversed_at=now() where staff_id={q(PC)} and reversed_at is null;
insert into public.staff_points(staff_id,total_points) values({q(PC)},7) on conflict(staff_id) do update set total_points=7;
update public.staff_quest_definitions set is_active=false where id<>{q(QUEST)};
insert into public.staff_quest_definitions(id,quest_type,title,target_kind,target_value,points_reward)
 values({q(QUEST)},'daily','Uji omzet harian','total_sales_amount',{target},{reward})
 on conflict(id) do update set target_value=excluded.target_value,points_reward=excluded.points_reward,is_active=true;
update public.quest_settings set streak_bonus_every_days=0,streak_bonus_points=0;
set session_replication_role=origin;""")


def sec(h):
    # 1. Tiga struk berurutan, misi belum selesai (target 1 juta): batalkan yang TENGAH.
    reset_staff(h, 1000000)
    s1, s2, s3 = sale(h, 'HS-0001'), sale(h, 'HS-0002'), sale(h, 'HS-0003')
    before = staff_state(h)
    check('penyiapan: 3 struk -> progres misi 300.000 belum selesai, poin tetap 7', progress(h) == '300000:in_progress' and before['points'] == 7, dict(p=progress(h), s=before), 'regression')
    e = cancel(h, s2, 'hs-mid')
    check('struk tengah (tanpa hadiah) bisa dibatalkan walau kasir sudah transaksi sesudahnya', e is None and voided(h, s2), (e or '')[:300])
    check('progres misi berkurang tepat 100.000 (kontribusi struk itu saja), poin & rangkaian tidak berubah',
          progress(h) == '200000:in_progress' and staff_state(h) == before, dict(p=progress(h), s=staff_state(h)))
    e = cancel(h, s3, 'hs-last')
    check('struk sesudahnya tetap bisa dibatalkan berurutan; progres jadi 100.000 persis', e is None and progress(h) == '100000:in_progress', dict(e=(e or '')[:200], p=progress(h)))
    e = cancel(h, s1, 'hs-first')
    check('struk pertama (pembuka progres & rangkaian) lalu dibatalkan berurutan: progres & rangkaian hilang, poin 7',
          e is None and progress(h) == 'none' and staff_state(h)['streak'] is None and staff_state(h)['points'] == 7, dict(e=(e or '')[:200], p=progress(h), s=staff_state(h)))

    # 2. Struk pertama hari itu (memulai rangkaian & membuat progres) tetap tidak bisa dibatalkan di luar urutan.
    reset_staff(h, 1000000)
    a, b = sale(h, 'HS-0011'), sale(h, 'HS-0012')
    e = cancel(h, a, 'hs-open')
    check('struk pembuka rangkaian/progres + ada transaksi sesudahnya -> tetap ditolak, tidak ada yang berubah',
          bool(e) and BLOCK in e and not voided(h, a) and progress(h) == '200000:in_progress', (e or '')[:300], 'regression')

    # 3. Struk yang menyelesaikan misi (memberi poin) tetap tidak bisa dibatalkan di luar urutan.
    reset_staff(h, 250000)
    sale(h, 'HS-0021'); c2 = sale(h, 'HS-0022'); c3 = sale(h, 'HS-0023')   # c3 menyelesaikan misi (300.000 >= 250.000)
    sale(h, 'HS-0024')
    pts = staff_state(h)['points']
    e = cancel(h, c3, 'hs-award')
    check('struk yang memberi poin misi + ada transaksi sesudahnya -> tetap ditolak, poin utuh',
          bool(e) and BLOCK in e and not voided(h, c3) and staff_state(h)['points'] == pts == 107, dict(e=(e or '')[:200], pts=pts), 'regression')
    # 4. Struk tanpa hadiah, tapi misi diselesaikan oleh struk SESUDAHNYA -> ditolak (progres itu ikut menentukan poin).
    e = cancel(h, c2, 'hs-before-award')
    check('struk tanpa hadiah tetapi misi selesai karena struk sesudahnya -> ditolak, progres & poin utuh',
          bool(e) and BLOCK in e and not voided(h, c2) and progress(h) == '400000:completed' and staff_state(h)['points'] == 107, dict(e=(e or '')[:200], p=progress(h)), 'regression')

    # 5. Misi sudah selesai SEBELUM struk ini (seperti kasus produksi): batalkan struk tengah boleh, status tetap selesai.
    reset_staff(h, 150000)
    sale(h, 'HS-0031'); d2 = sale(h, 'HS-0032'); d3 = sale(h, 'HS-0033'); sale(h, 'HS-0034')   # selesai di d2 (200.000)
    pts = staff_state(h)['points']
    e = cancel(h, d3, 'hs-after-done')
    check('misi sudah selesai sebelum struk itu: struk tengah bisa dibatalkan, progres -100.000, status tetap selesai, poin utuh',
          e is None and voided(h, d3) and progress(h) == '300000:completed' and staff_state(h)['points'] == pts, dict(e=(e or '')[:200], p=progress(h), pts=pts))
    e = cancel(h, d2, 'hs-award-2')
    check('struk yang menyelesaikan misi tetap ditolak di luar urutan', bool(e) and BLOCK in e and not voided(h, d2), (e or '')[:200], 'regression')

    # 6. Ulangi dengan kunci sama -> hasil sama (idempoten), tidak mengurangi progres dua kali.
    e = cancel(h, d3, 'hs-after-done')
    check('ulang permintaan yang sama tidak mengurangi progres dua kali', progress(h) == '300000:completed', dict(e=(e or '')[:200], p=progress(h)))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--json', type=Path)
    ap.add_argument('--pg-bin', default=os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
    ap.add_argument('--baseline', action='store_true'); a = ap.parse_args()
    try:
        with r.NativePostgres(a.pg_bin) as db:
            okr.build(db, {CANDIDATE.name})
            h = x.Harness(db); x.setup(h); b3.setup_dates(h); b3.petshop_fixture(h)
            if not a.baseline: db.sql('begin;\n' + CANDIDATE.read_text() + '\ncommit;')
            try: sec(h)
            except Exception as e: check('SECTION aborted', False, str(e)[:800], 'harness')
    except Exception as e: check('HARNESS', False, str(e)[:800], 'harness')
    feature = [c for c in RESULTS if c['kind'] == 'feature']
    other = [c for c in RESULTS if c['kind'] != 'feature']
    if a.baseline:
        red = [c for c in feature if c['status'] == 'FAIL']
        ok = len(red) == len(feature) and all(c['status'] == 'PASS' for c in other)
        print(f"BASELINE: {len(red)}/{len(feature)} feature cases RED; {sum(c['status'] == 'PASS' for c in other)}/{len(other)} regression PASS.", flush=True)
    else:
        ok = all(c['status'] == 'PASS' for c in RESULTS)
        print(f"{sum(c['status'] == 'PASS' for c in RESULTS)}/{len(RESULTS)} PASS", flush=True)
    if a.json: a.json.write_text(json.dumps(dict(candidate=CANDIDATE.name, baseline=a.baseline, ok=ok, results=RESULTS), indent=1, default=str))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
