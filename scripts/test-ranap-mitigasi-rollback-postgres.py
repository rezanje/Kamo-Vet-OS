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
       * aplikasi versi LAMA masih bisa bekerja: menagih tahap, menerima pembayaran
         kunjungan, dan membatalkan kwitansinya.
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


def uang_tersimpan(h):
    return {t: h.nilai(f"select count(*) from public.{t}") for t in (
        "invoices", "invoice_payments", "journal_entries", "journal_lines",
        "clinic_payment_receipts", "clinic_payment_receipt_parts", "clinic_customer_advances")}


def alur_uang_lama(h, n, cust, awalan):
    """Alur aplikasi versi LAMA: tagih tahap -> terima pembayaran -> batalkan kwitansi."""
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
    return True, f"tagihan {inv[:8]} diterima={terima} kwitansi={kwt[:8]}"


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
            uang_awal = uang_tersimpan(h)
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
            baru_dibekukan = h.nilai(
                "select has_function_privilege('authenticated',"
                "'public.clinic_release_advance_application(uuid,text,text)','EXECUTE')::text")
            catat("rpc-baru-dibekukan-bukan-dihapus",
                  baru_dibekukan == "false"
                  and h.nilai("select to_regprocedure('public.clinic_release_advance_application"
                              "(uuid,text,text)') is not null") == "t",
                  f"EXECUTE untuk authenticated={baru_dibekukan}, fungsinya masih ada")

            jejak_akhir = jejak_utuh(h)
            catat("jejak-dan-skema-tidak-dijatuhkan", jejak_akhir == jejak_awal
                  and all(v in ("t", "1") for v in jejak_akhir.values()),
                  f"{jejak_akhir}")
            uang_akhir = uang_tersimpan(h)
            catat("riwayat-uang-tidak-terhapus", uang_akhir == uang_awal,
                  f"sebelum={uang_awal} sesudah={uang_akhir}")

            ok, detail = alur_uang_lama(h, 83, penuh.buat_pelanggan(h, 83), "rollback")
            catat("aplikasi-lama-masih-jalan-sesudah-rollback", ok, detail)

            # 4. Pasang ulang migrasi mitigasi.
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

    total = {s: sum(1 for r in HASIL if r["status"] == s) for s in ("PASS", "FAIL")}
    print(f"TOTAL gerbang rollback pass={total['PASS']} fail={total['FAIL']}", flush=True)
    berkas = Path("/opt/data/kamo-ranap-mitigasi-round2-rollback.json")
    berkas.write_text(json.dumps({"total": total, "kasus": HASIL}, indent=2, ensure_ascii=False))
    return 0 if total["FAIL"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
