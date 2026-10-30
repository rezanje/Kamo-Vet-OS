#!/usr/bin/env python3
"""Aggregate actual local evidence, preserving RED/failed attempts separately."""
import argparse
import json
from pathlib import Path
import subprocess
from typing import Any

ROOT=Path(__file__).resolve().parents[1]
E=ROOT/'docs/verification/ranap-bayar'
p=argparse.ArgumentParser();p.add_argument('--external-only',action='store_true');args=p.parse_args()
def git(*argv):return subprocess.check_output(['git',*argv],cwd=ROOT,text=True).strip()
def load(name):return json.loads((E/name).read_text())
native=load('19-native-final.json');rekap=load('20-original-rekap-regression.json');racikan=load('21-original-racikan-regression.json');ui=load('30-ui-final.json');quality=load('30-quality-gates.json')
scan=load('31-static-scan.json')
assert not scan['findings']
if (E/'32-staged-diff-check.json').exists(): quality.append(load('32-staged-diff-check.json'))
suites: list[dict[str,Any]] = [dict(suite='new unified public RPC',path='19-native-final.json',cases=native['cases']),dict(suite='original rekap / initial minimum / optional followup',path='20-original-rekap-regression.json',cases=rekap['cases']),dict(suite='original compound / public clinical notes',path='21-original-racikan-regression.json',cases=racikan['cases'])]
for suite in suites:
    suite['totals']={s:sum(c['status']==s for c in suite['cases']) for s in ('PASS','FAIL')}
    names=[c.get('case',c.get('kasus')) for c in suite['cases']]
    assert len(set(names))==len(names),(suite['suite'],'duplicate names')
ui_cases=[dict(case=c['fullName'],status=c['status'],file=r['name'].replace(str(ROOT)+'/','')) for r in ui['testResults'] for c in r['assertionResults']]
assert len(ui_cases)==ui['numTotalTests'] and all(c['status']=='passed' for c in ui_cases)
assert all(not s['totals']['FAIL'] for s in suites) and all(q['exit_code']==0 for q in quality)
failures=[
 dict(evidence='01-red-native.json',kind='expected RED',detail='Original 328 migrations: new public one-action RPC absent; 0 PASS / 1 FAIL. First tracer fixture record argument corrected to actual stay before GREEN; this RED is absence proof, not a complete clinical journey.'),
 dict(evidence='03-credit-red-native.json',kind='real implementation defect, fixed',detail='3 PASS / 1 FAIL: old AR 100000 remained despite available owner credit. Extracted original stage allocation loop to one private helper and apply existing available credit oldest-first; original public stage still uses same helper.'),
 dict(evidence='05-ui-red.log',kind='initial test setup failure',detail='New component did not exist; import resolution failed, zero executed tests. Kept separately from assertion RED.'),
 dict(evidence='06-ui-red-assertions.log',kind='expected RED',detail='Empty component: 5 failed tests; absent controls also produce null-input errors. Subsequent real rendered-component tests passed.'),
 dict(evidence='07-action-red-ui-first.log',kind='expected RED',detail='Missing simpanBayar action: 10 FAIL / 5 PASS.'),
 dict(evidence='08-page-red.log',kind='expected RED',detail='New top-order and fail-closed quote tests: 2 FAIL / 27 PASS.'),
 dict(evidence='09-focused-first.log',kind='outdated old-contract assertions',detail='6 FAIL / 74 PASS: separate Tagih/manual selection, DP including unused credit, old helper copy. Replaced only superseded UI expectations while preserving money assertions and adding initial-minimum/current-quote rendering checks.'),
 dict(evidence='10-native-matrix-first.json',kind='fixture error, fixed',detail='21 PASS / 1 HARNESS FAIL: ON CONFLICT(metode,branch_id) did not match existing partial unique index. Plain insert into fictional new branch mapping fixed fixture; no production index changes.'),
 dict(evidence='12-native-matrix-second.json',kind='assertion error, fixed',detail='34 PASS / 2 FAIL: actual original error codes are STOCK_SHORT and Indonesian closed-period text, not STOCK_SHORTAGE/PERIOD. Both failures already showed unchanged=true. Exact expected rejection strings corrected; no retry masked either run.'),
 dict(evidence='13-typecheck.log',kind='unfinished full-project gate',detail='Full-project tsc --noEmit --incremental false hit 2048 MB heap limit, process exit 134. Core removed. No larger heap/full rerun. Focused typecheck of changed route/components/tests and transitive imports passes. Not proof full-project tsc passes or that baseline has same failure.'),
 dict(evidence='18-bank-race-red.json',kind='real implementation race, fixed',detail='42 PASS / 1 FAIL: changing payment map while receipt waited at shift lock could post a different account from current quote. Added actual receipt-parts vs quoted-method account comparison; mismatch raises ACCOUNT_INVALID and entire transaction rolls back. Deterministic real independent-session proof now passes.'),
 dict(evidence='22-next-navigation-red.log',kind='real Next navigation issue, fixed',detail='3 FAIL / 13 PASS after source inspection of installed Next reducer proved redirect promises reject. New async client catch could swallow redirect. New action now returns verified document-bound SAVED href; useRouter navigates/refreshes. Old actions unchanged.'),
 dict(evidence='23-session-red.log',kind='expected RED',detail='1 FAIL / 16 PASS: expired session redirected through old helper. New action now returns explicit session/shift error without a redirect inside local catch.'),
 dict(evidence='26-ui-targeted-final.json',kind='existing route mock incomplete, fixed',detail='1 FAIL / 174 PASS: original popup test lacked new quote RPC and useRouter mock, so fail-closed page correctly omitted form. Extended mock with actual new read shape; retained original dialog/no-resubmit assertions.'),
 dict(evidence='27-no-excess-reconfirm-red.log',kind='expected RED',detail='1 FAIL / 6 PASS: stale quote with zero excess wrongly described credit Rp0. Modal now explicitly says Tagihan berubah / Tidak ada kelebihan bayar and requires fresh acknowledgment.'),
 dict(evidence='29-authoritative-tax-red.log',kind='real display inconsistency, fixed',detail='1 FAIL / 31 PASS: UI tax fallback OFF could disagree with trusted quote tax. Total transaction card/footer now combine stored invoices with DB-validated pending amount, including its tax.'),
]
limits=[
 'LOCAL ONLY. No network, hosted read/write/preflight, Production patient rows, push, PR creation, merge, deployment, packages, paid CLI or new browser/Auth stack used. Parent owns rebase/new main, independent review, exact-head CI, backup, hosted compilation/apply/readback and release. Latest steering says meeting hold was lifted; this child scope nevertheless remains LOCAL ONLY.',
 'Full-project typecheck remains unverified after heap-2048 OOM; focused typecheck, changed-file lint and targeted tests passed. No full 5000-test suite, production build, Technical checks CI or authenticated browser/PostgREST/UAT claim.',
 'Bank selection is existing method->branch/global/default mapping only. Displays actual cash-account name/bank/number and validates resulting receipt account. No per-transaction bank dropdown, arbitrary client COA, global map mutation or new banking authority.',
 'Overpayment acknowledgment and one-action orchestration are enforced at NEW public clinic_bill_and_pay_inpatient and the new visible form. Existing low-level public clinic_receive_visit_payment / legacy server actions remain their original advance-capable contract; this change does not retrofit acknowledgment onto every legacy money API. Parent should review this explicit compatibility boundary before release.',
 'Original public stage invoice batch limit of 200 lines is retained; a larger pending batch fails atomically, not partially. Original clinical/stock restrictions and posted snapshots remain authoritative; no historical real money was corrected.',
 'The original native bootstrap fakes only Supabase auth/storage/platform, never accounting/stock/minimum/role business cores. New harness uses JWT claims JSON and actual authenticated public RPCs. Regression harness adapts temp placement only; it does not substitute business functions.',
 'RED evidence covers tracer and discovered defects/UX slices; later expanded native cases are regression coverage, not a claim that all 51 individual final cases were each run RED before all implementation.',
 'Independent reviewer is the parent: no delegate/reviewer tool is exposed in this child and paid/network CLI was prohibited. No independently-reviewed or release-ready badge claimed.',
]
result: dict[str,Any] = dict(status='LOCAL_IMPLEMENTED_TARGETED_VERIFIED_PARENT_REVIEW_REQUIRED',branch=git('branch','--show-current'),base='5e2cce8d2ca32a80255e8a63e8b425e553e61646',candidate_head=git('rev-parse','HEAD') if args.external_only else None,migration='supabase/migrations/20261104040000_ranap_simpan_bayar.sql',migration_count=native['migration_count'],public_money_rpc='clinic_bill_and_pay_inpatient(uuid,uuid,text,date,jsonb,text,boolean,text)',public_quote_rpc='clinic_quote_inpatient_payment(uuid,uuid,jsonb)',native_suites=suites,ui=dict(evidence='30-ui-final.json',files=len(ui['testResults']),passed=ui['numPassedTests'],failed=ui['numFailedTests'],total=ui['numTotalTests'],cases=ui_cases),quality_gates=quality,static_scan=scan,evidence_preservation='raw-logs.tar.gz + SHA256 raw-logs-manifest.json retain byte-exact raw logs; readable .log copies trim trailing whitespace only. Initial staged diff-check exit 2 was evidence whitespace, not source failure; final staged check recorded separately.',prior_red_failed_attempts=failures,limits=limits)
result['final_executed_assertion_totals']=dict(native_pass=sum(s['totals']['PASS'] for s in suites),native_fail=sum(s['totals']['FAIL'] for s in suites),ui_pass=ui['numPassedTests'],ui_fail=ui['numFailedTests'])
result['final_executed_assertion_totals']['combined_pass']=result['final_executed_assertion_totals']['native_pass']+result['final_executed_assertion_totals']['ui_pass']
text='# Laporan rilis KAMO — #56 Simpan/Bayar rawat inap\n\n'
text+='**Status: implementasi LOCAL selesai, verifikasi terarah lulus; belum live.**\n\n'
text+=f"Branch: `{result['branch']}` · base `{result['base']}`\n\n"
if args.external_only:text+=f"Commit kandidat: `{result['candidate_head']}`\n\n"
text+='## Perubahan\n- Satu Simpan/Bayar: derive seluruh resep pending milik kunjungan di DB di bawah koordinator uang, gunakan kredit tersedia pada piutang tertua, penerimaan asli lalu posting tahap asli dalam satu transaksi. Gagal apa pun membatalkan invoice, stok, omzet/HPP/piutang dan penerimaan/advance sekaligus.\n- DP awal/global dan override beralasan tetap; lanjutan boleh nol tanpa kwitansi palsu. Pengulangan kunci sama tidak menerima uang atau mengeluarkan stok lagi.\n- Lebih bayar ditolak sebelum uang ditulis sampai ada persetujuan eksplisit yang terikat nominal, metode, saldo, resep pending, pajak dan rekening terkini. Surplus tetap saldo pemilik/utang 2103, bukan omzet atau kembalian otomatis. Data berubah memerlukan persetujuan ulang.\n- Panel pembayaran di atas rincian; enam tombol metode berwarna, nominal besar, split maksimal enam, isian tidak ditimpa, informasi rekening aktual. DP terpakai dan saldo pemilik terpisah. Tidak ada Tagih terpisah pada alur utama.\n- Sukses baru terikat kwitansi/invoice nyata milik kunjungan yang sedang dibuka; Simpan nol uang disebut transaksi, bukan penerimaan fiktif.\n\n'
text+='## Hasil tes final\n'
for s in suites:text+=f"- {s['suite']}: **{s['totals']['PASS']} PASS / {s['totals']['FAIL']} FAIL**, rantai lengkap {native['migration_count']} migrasi ({native['migration_count']-1} asli + 1 kandidat) pada PostgreSQL native lokal sekali pakai. Bukti `{s['path']}`.\n"
text+=f"- Targeted Vitest: **{ui['numPassedTests']} PASS / {ui['numFailedTests']} FAIL**, {len(ui['testResults'])} berkas; bukan full suite/UAT. Bukti `30-ui-final.json`.\n"
text+='- Typecheck terarah, eslint seluruh TS/TSX berubah, git diff --check: exit 0 (`30-quality-gates.json`). Full-project typecheck: OOM pada batas 2048 MB, belum lulus; tidak diulang dengan heap lebih besar.\n- Expected posting diperiksa tidak hanya seimbang: obat 2×25000 + jasa 280000 = invoice/omzet 330000, HPP 4000, stok -2; pembayaran campuran tunai 100000 + bank 300000 untuk tagihan 340000 menyisakan kredit nyata 60000. Racikan HPP 2000 tanpa pengeluaran bahan kedua; BMHP HPP 3000/stok bahan -3. Bank cabang 1109 dan per-bagian kwitansi diperiksa.\n\n'
text+='## Migrasi / urutan penerapan\n`20261104040000_ranap_simpan_bayar.sql` baru, sesudah dependensi `20261104030000`. Tidak ada SQL lama yang ditulis ulang dan tidak ada assertion harus menjadi migrasi terbaru. Kandidat menambah tabel permintaan privat, quote privat/publik, wrapper publik, dan mengekstrak loop aplikasi advance ASLI dari stage ke helper privat lewat satu jangkar eksak. `clinic_post_invoice`, `clinic_receive_visit_payment`, dan aturan minimum global tidak diganti.\n\n**DB-dependent: parent wajib backup, preflight, apply dan readback migrasi sebelum merge**, sesudah rebase/CI/review sesuai otorisasi parent. Tidak ada perubahan hosted di pekerjaan ini.\n\n'
text+='## Sisa kendala / batas\n'+'\n'.join('- '+l for l in limits)+'\n\n'
text+='## Riwayat RED dan kegagalan (tidak ditimpa menjadi hijau)\nRaw log byte-exact disimpan di `raw-logs.tar.gz`, diverifikasi SHA256 per berkas di `raw-logs-manifest.json`; salinan `.log` yang bisa dibaca hanya dinormalisasi whitespace akhir. Pemeriksaan staged pertama gagal karena whitespace log mentah (exit 2), bukan sumber; pemeriksaan staged final dicatat terpisah. Supporting static scan production tidak menemukan pola yang dicari, bukan pengganti review independen.\n\n'
for f in failures:text+=f"- `{f['evidence']}` — **{f['kind']}**: {f['detail']}\n"
text+='\n## Kasus native final — tepat sesuai hasil eksekusi\n'
for s in suites:
    text+=f"\n### {s['suite']}\n"
    for c in s['cases']:text+=f"- {c['status']} — {c.get('case',c.get('kasus'))}\n"
text+='\n## Kasus UI/action final\n'
for c in ui_cases:text+=f"- {c['status']} — {c['case']}\n"
encoded=json.dumps(result,indent=2,ensure_ascii=False)+'\n'
if not args.external_only:
    (E/'results.json').write_text(encoded);(E/'REPORT.md').write_text(text)
Path('/opt/data/kamo-ranap-bayar-results.json').write_text(encoded)
Path('/opt/data/kamo-pr-ranap-bayar.md').write_text(text)
print(json.dumps(dict(status=result['status'],totals=result['final_executed_assertion_totals'],candidate_head=result['candidate_head'],reports=['/opt/data/kamo-ranap-bayar-results.json','/opt/data/kamo-pr-ranap-bayar.md']),indent=2))
