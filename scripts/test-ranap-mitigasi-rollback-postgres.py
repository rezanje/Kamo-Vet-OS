#!/usr/bin/env python3
"""Gerbang rollback mitigasi tagihan berjalan rawat inap — pulang-pergi di PostgreSQL lokal.

Urutannya persis seperti yang akan dilakukan operator:

  1. SEBELUM rilis — seluruh migrasi repositori KECUALI migrasi mitigasi dipasang,
     lalu cadangan tertarget diambil (scripts/rollback-ranap-mitigasi.py --cadangkan).
  2. RILIS — migrasi mitigasi dipasang; alur uang tahap dijalankan sampai ada
     kwitansi, uang muka, jurnal, dan tagihan sungguhan.
  3. ROLLBACK — SQL pemulihan dijalankan. Yang diperiksa:
       * setiap definisi fungsi dan hak aksesnya kembali IDENTIK dengan langkah 1;
       * pemicu yang dibuat migrasi dicabut;
       * skema clinic_private, tabel/kolom jejak baru, dan SELURUH baris uang
         (invoice_payments, journal_entries, kwitansi, uang muka) masih utuh;
       * isi baris uangnya identik, bukan cuma jumlah barisnya;
       * aplikasi versi LAMA masih bisa bekerja PENUH: menagih tahap, menerima
         pembayaran kunjungan, dan MEMBATALKAN kwitansinya dengan akuntansi yang
         diperiksa (kas, piutang, uang muka, status kwitansi dan tagihan).
  4. PASANG ULANG — migrasi mitigasi dipasang lagi; definisinya kembali identik
     dengan langkah 2 (maju-mundur-maju tidak meninggalkan selisih).

Fixture fiktif, tanpa URL basis data, tanpa jaringan, tanpa Production.
"""
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

spec = importlib.util.spec_from_file_location("penuh", ROOT / "scripts/test-ranap-mitigasi-penuh-postgres.py")
penuh = importlib.util.module_from_spec(spec)
sys.argv = [sys.argv[0]]
spec.loader.exec_module(penuh)
rb = importlib.util.module_from_spec(
    importlib.util.spec_from_file_location("rb", ROOT / "scripts/rollback-ranap-mitigasi.py"))
importlib.util.spec_from_file_location("rb", ROOT / "scripts/rollback-ranap-mitigasi.py").loader.exec_module(rb)

from native_postgres import NativePostgres  # noqa: E402

MITIGASI = ROOT / "supabase/migrations" / penuh.MITIGASI
HASIL = []


def catat(kasus, ok, detail):
    HASIL.append({"kasus": kasus, "status": "PASS" if ok else "FAIL", "detail": detail})
    print(f"{'PASS' if ok else 'FAIL':5} {kasus}: {detail}", flush=True)
    return ok


def potret(h):
    """Definisi + hak akses seluruh objek yang disentuh migrasi, apa adanya."""
    return json.loads(h.sql(rb.cadangkan_kueri()))


def jejak_utuh(h):
    hasil = {}
    for jenis, nama in rb.JEJAK:
        if jenis == "tabel":
            hasil[nama] = h.nilai(f"select to_regclass('{nama}') is not null")
        else:
            skema, tabel, kolom = nama.split(".")
            hasil[nama] = h.nilai(
                "select count(*)::text from information_schema.columns where table_schema="
                f"'{skema}' and table_name='{tabel}' and column_name='{kolom}'")
    return hasil


UANG = ("invoices", "invoice_payments", "journal_entries", "journal_lines",
        "clinic_payment_receipts", "clinic_payment_receipt_parts", "clinic_customer_advances")


def uang_tersimpan(h):
    return {t: h.nilai(f"select count(*) from public.{t}") for t in UANG}


# Kolom UANG pada tagihan. Pemasangan ulang migrasi menandai ulang klasifikasi
# dokumen (`stage_billing`) untuk tagihan yang terbit saat rollback aktif — itu
# memang tugasnya dan bukan perubahan uang, jadi perbandingan maju-mundur-maju
# memakai proyeksi ini. Perbandingan rollback sendiri tetap memakai baris penuh.
KOLOM_UANG = {"invoices": "row(t.id, t.invoice_no, t.subtotal, t.discount, t.tax, t.total,"
                          " t.dp_amount, t.dp_date, t.paid_status, t.paid_at, t.voided_at,"
                          " t.correction_pending, t.reissued_from)"}


def isi_uang(h, uang_saja=False):
    """ISI tiap baris uang, bukan sekadar jumlah barisnya: {tabel: {id: sidik-baris}}.

    Dipakai untuk membuktikan pemulihan/pemasangan ulang tidak diam-diam menulis
    ulang nominal, rekening, atau statusnya."""
    hasil = {}
    for t in UANG:
        kolom = KOLOM_UANG.get(t, "t") if uang_saja else "t"
        keluaran = h.sql(f"select t.id::text || ' ' || md5({kolom}::text) from public.{t} t order by t.id")
        hasil[t] = dict(baris.split(" ", 1) for baris in keluaran.splitlines() if " " in baris)
    return hasil


def alur_uang_lama(h, n, cust, awalan):
    """Alur aplikasi versi LAMA, LENGKAP: tagih tahap -> terima pembayaran ->
    batalkan kwitansi, dengan pemeriksaan uangnya — bukan sekadar "tidak error".

    Dicek: kas berkurang persis sebesar kwitansi, sisa uang muka kembali ke
    liabilitas, kwitansi berstatus batal, tagihan kembali Belum Lunas tanpa uang."""
    visit = penuh.buat_kunjungan(h, n, cust)
    galat = h.gagal(penuh.tagih_sql(visit, f"{awalan}-tagih", penuh.baris(n, 1), penuh.OWNER,
                                    alasan="Uji fiktif DP"), penuh.OWNER)
    if galat:
        return False, "tagih tahap ditolak: " + galat.strip().splitlines()[0]
    galat = h.gagal(penuh.bayar_sql(visit, f"{awalan}-bayar",
                                    [{"method": "Tunai", "amount": 150000}]), penuh.OWNER)
    if galat:
        return False, "terima pembayaran ditolak: " + galat.strip().splitlines()[0]
    kwt = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={penuh.q(visit)}")
    inv = h.aktif(visit)
    terima = h.diterima(inv)
    if terima != 100000:
        return False, f"uang muka tidak terpakai sebagaimana mestinya: diterima={terima}"
    sisa_muka = h.angka("select amount-applied from public.clinic_customer_advances "
                        f"where receipt_id={penuh.q(kwt)}")

    sebelum = h.saldo_semua("1101", "1201", "2103")
    galat = h.gagal(penuh.batal_kwitansi_sql(kwt, f"{awalan}-batal"), penuh.OWNER)
    if galat:
        return False, "pembatalan kwitansi ditolak: " + galat.strip().splitlines()[0]
    sesudah = h.saldo_semua("1101", "1201", "2103")
    kas = round(sebelum["1101"] - sesudah["1101"], 2)
    muka = round(sesudah["2103"] - sebelum["2103"], 2)
    piutang = round(sesudah["1201"] - sebelum["1201"], 2)
    status_kwt = h.nilai(f"select status from public.clinic_payment_receipts where id={penuh.q(kwt)}")
    terima2 = h.diterima(inv)
    status_inv = h.status_bayar(inv)
    ok = (kas == 150000 and muka == sisa_muka and piutang == 150000 - sisa_muka
          and status_kwt == "batal" and terima2 == 0 and status_inv == "Belum Lunas")
    return ok, (f"tagihan {inv[:8]} diterima {terima}->{terima2} status={status_inv} "
                f"kwitansi={status_kwt} kas kredit {kas} piutang debit {piutang} "
                f"uang muka debit {muka} (sisa {sisa_muka})")


def alur_pelepasan(h, n, cust, awalan):
    """Pelepasan uang muka yang SUDAH terpakai — hanya ada sesudah migrasi dipasang.

    Mengembalikan (id uang muka, id tagihan, pesan) supaya nasib barisnya bisa
    diperiksa sesudah rollback."""
    visit = penuh.buat_kunjungan(h, n, cust)
    h.sql(penuh.bayar_sql(visit, f"{awalan}-bayar", [{"method": "Tunai", "amount": 150000}]), penuh.OWNER)
    kwt = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={penuh.q(visit)}")
    muka = h.nilai(f"select id from public.clinic_customer_advances where receipt_id={penuh.q(kwt)}")
    h.sql(penuh.tagih_sql(visit, f"{awalan}-tagih", penuh.baris(n, 1), penuh.OWNER), penuh.OWNER)
    inv = h.aktif(visit)
    hasil = h.nilai(penuh.lepas_sql(muka, f"{awalan}-lepas"), penuh.FINANCE)
    dipakai = h.angka(f"select applied from public.clinic_customer_advances where id={penuh.q(muka)}")
    return muka, inv, f"dilepas={hasil} applied={dipakai} tagihan={inv[:8]}"


def main():
    with tempfile.TemporaryDirectory(prefix="kamo-ranap-rollback-") as tmp:
        tujuan = Path(tmp) / "supabase/migrations"
        tujuan.mkdir(parents=True)
        for sumber in (ROOT / "supabase/migrations").glob("*.sql"):
            if sumber.name != penuh.MITIGASI:
                (tujuan / sumber.name).symlink_to(sumber)
        penuh.fixture.ROOT = Path(tmp)
        with NativePostgres(penuh.BIN) as db:
            penuh.fixture.DisposablePostgres.bootstrap(db)
            h = penuh.Harness(db)
            h.sql(penuh.dasar_sql())

            # 1. Cadangan tertarget sebelum rilis.
            dasar = potret(h)
            ada_sebelum = sorted(k for k, v in dasar["fungsi"].items() if v["ada"])
            catat("cadangan-sebelum-rilis", len(ada_sebelum) > 0,
                  f"{len(ada_sebelum)} fungsi tercadangkan, "
                  f"{len(dasar['fungsi']) - len(ada_sebelum)} belum ada sebelum migrasi")
            ok, detail = alur_uang_lama(h, 81, penuh.buat_pelanggan(h, 81), "pra")
            catat("alur-uang-sebelum-rilis", ok, detail)

            # 2. Pasang migrasi mitigasi dan jalankan uang sungguhan di atasnya.
            h.sql(MITIGASI.read_text())
            sesudah_rilis = potret(h)
            ok, detail = alur_uang_lama(h, 82, penuh.buat_pelanggan(h, 82), "rilis")
            catat("alur-uang-sesudah-rilis", ok, detail)
            # Pelepasan uang muka hanya ada sesudah migrasi; barisnya harus selamat
            # melewati rollback supaya rekonsiliasinya masih bisa ditelusuri.
            cust_lepas = penuh.buat_pelanggan(h, 85)
            muka_lepas, inv_lepas, detail_lepas = alur_pelepasan(h, 85, cust_lepas, "lepas")
            catat("pelepasan-uang-muka-sebelum-rollback",
                  h.angka(f"select applied from public.clinic_customer_advances where id={penuh.q(muka_lepas)}") == 0,
                  detail_lepas)
            uang_awal = uang_tersimpan(h)
            isi_awal = isi_uang(h)
            jejak_awal = jejak_utuh(h)

            # 3. Rollback tertarget.
            skrip = rb.pulihkan_sql(dasar)
            h.sql(skrip)
            dipulihkan = potret(h)
            beda = [sig for sig in rb.FUNGSI
                    if dasar["fungsi"][sig].get("definisi") != dipulihkan["fungsi"][sig].get("definisi")
                    and dasar["fungsi"][sig]["ada"]]
            catat("definisi-kembali-identik", not beda, f"selisih={beda or 'tidak ada'}")
            hak_beda = [sig for sig in rb.FUNGSI if dasar["fungsi"][sig]["ada"]
                        and dasar["fungsi"][sig].get("acl") != dipulihkan["fungsi"][sig].get("acl")]
            catat("hak-akses-kembali-identik", not hak_beda, f"selisih={hak_beda or 'tidak ada'}")
            pemicu = h.nilai("select count(*) from pg_trigger where tgrelid='public.invoice_items'::regclass"
                             " and tgname='guard_invoice_item_billed_once_final'")
            catat("pemicu-baru-dicabut", pemicu == "0", f"jumlah pemicu tersisa={pemicu}")
            # SELURUH RPC yang belum ada sebelum migrasi — termasuk RPC kelayakan
            # koreksi yang baru — harus dibekukan untuk SEMUA peran aplikasi, bukan
            # dihapus, dan hak aksesnya persis nol.
            baru = [sig for sig in rb.FUNGSI if not dasar["fungsi"][sig]["ada"]]
            masih_bisa, hilang = [], []
            for sig in baru:
                if h.nilai(f"select to_regprocedure('{sig}') is not null") != "t":
                    hilang.append(sig)
                    continue
                for peran in rb.PERAN:
                    if peran == "public":
                        continue
                    if h.nilai(f"select has_function_privilege('{peran}','{sig}','EXECUTE')::text") != "false":
                        masih_bisa.append(f"{sig}/{peran}")
            acl_baru = h.nilai("select coalesce(array_to_json(p.proacl)::text,'kosong') from pg_proc p "
                               "where p.oid = to_regprocedure('public.clinic_invoice_correction_eligible(uuid)')")
            catat("rpc-baru-dibekukan-bukan-dihapus",
                  bool(baru) and not masih_bisa and not hilang,
                  f"{len(baru)} RPC baru dibekukan (mis. kelayakan koreksi acl={acl_baru}); "
                  f"masih bisa dieksekusi={masih_bisa or 'tidak ada'} hilang={hilang or 'tidak ada'}")

            jejak_akhir = jejak_utuh(h)
            catat("jejak-dan-skema-tidak-dijatuhkan", jejak_akhir == jejak_awal
                  and all(v in ("t", "1") for v in jejak_akhir.values()),
                  f"{jejak_akhir}")
            uang_akhir = uang_tersimpan(h)
            catat("riwayat-uang-tidak-terhapus", uang_akhir == uang_awal,
                  f"sebelum={uang_awal} sesudah={uang_akhir}")
            isi_akhir = isi_uang(h)
            beda_isi = {t: sorted(set(isi_awal[t].items()) ^ set(isi_akhir[t].items()))[:3]
                        for t in isi_awal if isi_awal[t] != isi_akhir[t]}
            catat("isi-baris-uang-tidak-berubah", not beda_isi,
                  f"selisih={beda_isi or 'tidak ada'} "
                  f"({sum(len(v) for v in isi_awal.values())} baris diperiksa per isi)")
            lepas_utuh = h.nilai(
                "select (released_at is not null)::text from public.clinic_advance_applications "
                f"where advance_id={penuh.q(muka_lepas)} order by released_at desc nulls last limit 1")
            # Rekonsiliasi sesudah rollback: kode LAMA tidak mengenal released_at.
            # Yang diuji di sini nasib BARISNYA; perilaku kode lama dicatat apa adanya.
            # Kunjungan BARU milik pemilik yang sama, ditagih dengan kode LAMA: kalau
            # saldo yang sudah dilepas ikut terpakai lagi, itu celah rekonsiliasi
            # sesudah rollback — dicatat apa adanya, bukan disembunyikan.
            visit_lanjut = penuh.buat_kunjungan(h, 86, cust_lepas)
            galat_lanjut = h.gagal(penuh.tagih_sql(visit_lanjut, "lepas-lanjut", penuh.baris(86, 1),
                                                   penuh.OWNER, alasan="Uji fiktif DP"), penuh.OWNER)
            dipakai_lagi = h.angka(
                f"select applied from public.clinic_customer_advances where id={penuh.q(muka_lepas)}")
            catat("jejak-pelepasan-uang-muka-selamat", lepas_utuh == "true",
                  f"baris pelepasan tersimpan={lepas_utuh}; tagihan baru kode lama "
                  f"{'ditolak ' + galat_lanjut.strip().splitlines()[0] if galat_lanjut else 'diterima'}")
            # CELAH TERBUKA, bukan klaim aman: kode lama tidak mengenal released_at,
            # jadi saldo yang sudah dilepas ikut terpakai lagi oleh tagihan berikutnya.
            # Perilaku ini dikunci di sini supaya perubahannya ketahuan, dan tetap
            # dilaporkan sebagai pekerjaan rekonsiliasi manual sesudah rollback.
            catat("celah-rekonsiliasi-pelepasan-sesudah-rollback", dipakai_lagi == 100000,
                  f"saldo yang sudah dilepas terpakai lagi sebesar {dipakai_lagi} oleh tagihan "
                  "kode lama — WAJIB direkonsiliasi manual bila rollback dijalankan")

            ok, detail = alur_uang_lama(h, 83, penuh.buat_pelanggan(h, 83), "rollback")
            catat("aplikasi-lama-masih-jalan-sesudah-rollback", ok, detail)

            # 4. Pasang ulang migrasi mitigasi. Pembandingnya keadaan TEPAT SEBELUM
            # pemasangan ulang: baris yang sengaja diubah uji di atas tidak dihitung
            # sebagai kerusakan pemasangan ulang.
            isi_pra_pasang_ulang = isi_uang(h, uang_saja=True)
            h.sql(MITIGASI.read_text())
            lagi = potret(h)
            beda2 = [sig for sig in rb.FUNGSI
                     if sesudah_rilis["fungsi"][sig].get("definisi") != lagi["fungsi"][sig].get("definisi")]
            catat("pasang-ulang-identik", not beda2, f"selisih={beda2 or 'tidak ada'}")
            ok, detail = alur_uang_lama(h, 84, penuh.buat_pelanggan(h, 84), "ulang")
            catat("alur-uang-sesudah-pasang-ulang", ok, detail)
            uang_ulang = uang_tersimpan(h)
            catat("riwayat-uang-bertambah-bukan-hilang",
                  all(int(uang_ulang[t]) >= int(uang_awal[t]) for t in uang_awal), f"{uang_ulang}")
            isi_ulang = isi_uang(h, uang_saja=True)
            hilang_isi = {t: [k for k, v in isi_pra_pasang_ulang[t].items() if isi_ulang[t].get(k) != v][:3]
                          for t in isi_pra_pasang_ulang
                          if any(isi_ulang[t].get(k) != v for k, v in isi_pra_pasang_ulang[t].items())}
            catat("isi-baris-uang-lama-tetap-sama-sesudah-pasang-ulang", not hilang_isi,
                  f"baris berubah/hilang={hilang_isi or 'tidak ada'} "
                  "(penandaan ulang tagihan tahap dikecualikan: klasifikasi dokumen, bukan uang)")

    total = {s: sum(1 for r in HASIL if r["status"] == s) for s in ("PASS", "FAIL")}
    print(f"TOTAL gerbang rollback pass={total['PASS']} fail={total['FAIL']}", flush=True)
    berkas = Path("/opt/data/kamo-ranap-mitigasi-round3-rollback.json")
    berkas.write_text(json.dumps({"total": total, "kasus": HASIL}, indent=2, ensure_ascii=False))
    return 0 if total["FAIL"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
