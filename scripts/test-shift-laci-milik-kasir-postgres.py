#!/usr/bin/env python3
"""LOKAL SAJA: batas tanggung jawab laci kasir (shift) klinik pada skema asli lengkap.

Memasang SELURUH migrasi repositori ke klaster PostgreSQL sekali pakai, lalu menulis
sebagai peran `authenticated` dengan klaim JWT pengguna fiktif — persis bentuk tulisan
yang dikirim aplikasi (server action -> PostgREST/RPC). Tidak ada stub bisnis.

Pertanyaan yang dijawab: di CABANG YANG SAMA, bolehkah akun X (OWNER/ADMIN/FINANCE/
DOCTOR/STAFF) membuka, menutup, membuka kembali, menghapus, mengubah modal awal, atau
menempelkan uang ke laci klinik milik akun Y? Akses halaman (lihat/kelola klinik) tidak
sama dengan memiliki laci. Pengecualian supervisor hanya lewat jalur tutup paksa yang
eksplisit, beralasan dan teraudit.

  --tanpa-perbaikan   pasang semua migrasi KECUALI 20261104320000 (bukti RED pada main)
  --json BERKAS       tulis hasil per kasus

Semua fixture fiktif. Tidak menerima URL basis data, tidak menyentuh jaringan/Production.
Keluar 0 hanya bila semua kasus PASS.
"""
import argparse
import contextlib
import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
PERBAIKAN = "20261104320000_shift_laci_milik_kasir.sql"

spec = importlib.util.spec_from_file_location("dp", ROOT / "scripts/test-dp-lanjut-ranap-postgres.py")
dp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dp)
r = dp.r
q, j = r.q, r.j

HASIL = []
# Aktor tambahan, semuanya fiktif.
STAFF2 = r.uid(1, 9)        # STAFF cabang sama, belum punya laci (korban "dibukakan")
STAFF_B = r.uid(1, 10)      # pemilik laci yang dicoba dihapus
STAFF_C = r.uid(1, 11)      # pemilik laci yang sudah ditutup (dicoba dibuka kembali)
STAFF_D = r.uid(1, 12)      # pemilik laci nyangkut > 24 jam (tutup paksa supervisor)
ADMIN_LUAR = r.uid(1, 13)   # ADMIN cabang lain
TARGET = r.SHIFT[r.STAFF]   # laci klinik STAFF di cabang FA-RANAP (cabang TARGET)
LACI = {STAFF_B: r.uid("b", 21), STAFF_C: r.uid("b", 22), STAFF_D: r.uid("b", 23), ADMIN_LUAR: r.uid("b", 24)}
NAMA = {r.OWNER: "OWNER", r.ADMIN: "ADMIN", r.FINANCE: "FINANCE", r.STAFF: "STAFF", r.DOCTOR: "DOCTOR",
        ADMIN_LUAR: "ADMIN-cabang-lain"}


def catat(kasus, ok, detail):
    HASIL.append({"kasus": kasus, "status": "PASS" if ok else "FAIL", "detail": detail})
    print(f"{'PASS' if ok else 'FAIL':5} {kasus}: {detail}", flush=True)


def fixture(h):
    h.sql(r.dasar_sql())
    h.sql("insert into public.role_modules(role,module_id) values ('FINANCE','klinik') on conflict do nothing;")
    extra = [(STAFF2, "STAFF", r.BRANCH), (STAFF_B, "STAFF", r.BRANCH), (STAFF_C, "STAFF", r.BRANCH),
             (STAFF_D, "STAFF", r.BRANCH), (ADMIN_LUAR, "ADMIN", r.BRANCH2)]
    h.sql("insert into auth.users (id, raw_user_meta_data) values "
          + ",".join(f"({q(u)},'{{\"full_name\":\"Akun Fiktif {i}\"}}')" for i, (u, _, _) in enumerate(extra, 20)) + ";\n"
          + "\n".join(f"update public.profiles set role={q(role)} where id={q(u)};" for u, role, _ in extra)
          + "\ninsert into public.user_branches(user_id,branch_id) values "
          + ",".join(f"({q(u)},{q(b)})" for u, _, b in extra) + ";")
    h.sql(f"""
update public.cashier_shifts set opening_balance=150000 where id={q(TARGET)};
insert into public.cashier_shifts(id,branch_id,opened_by,shift_type,status,opening_balance) values
 ({q(LACI[STAFF_B])},{q(r.BRANCH)},{q(STAFF_B)},'klinik','open',50000),
 ({q(LACI[STAFF_C])},{q(r.BRANCH)},{q(STAFF_C)},'klinik','open',70000),
 ({q(LACI[STAFF_D])},{q(r.BRANCH)},{q(STAFF_D)},'klinik','open',90000),
 ({q(LACI[ADMIN_LUAR])},{q(r.BRANCH2)},{q(ADMIN_LUAR)},'klinik','open',0);
update public.cashier_shifts set opened_at=now()-interval '30 hours' where id in ({q(LACI[STAFF_D])},{q(r.SHIFT[r.OWNER])});
update public.cashier_shifts set status='closed',closed_at=now(),closing_balance=70000,expected_cash=70000,
 selisih=0,closing_breakdown='{{"Tunai":0}}' where id={q(LACI[STAFF_C])};
""")


def baris(h, shift):
    return h.nilai(f"select to_jsonb(s)-'employee_id' from public.cashier_shifts s where id={q(shift)}")


def pulihkan(h, shift, snap):
    """Hanya untuk bukti RED: bila serangan TERNYATA berhasil, kembalikan baris laci (sebagai
    pemilik basis data) supaya kasus berikutnya tetap independen. Pada kode yang benar
    fungsi ini tidak melakukan apa pun."""
    if baris(h, shift) == snap:
        return
    if baris(h, shift) == "":
        h.sql(f"insert into public.cashier_shifts select * from jsonb_populate_record(null::public.cashier_shifts,{q(snap)}::jsonb);")
        return
    h.sql("update public.cashier_shifts s set status=x.status,opening_balance=x.opening_balance,closing_balance=x.closing_balance,"
          "expected_cash=x.expected_cash,selisih=x.selisih,closed_at=x.closed_at,closing_breakdown=x.closing_breakdown,opened_at=x.opened_at "
          f"from jsonb_populate_record(null::public.cashier_shifts,{q(snap)}::jsonb) x where s.id={q(shift)};")


def uang_laci(h, shift):
    """Semua sumber uang yang menempel ke laci ini (yang dibaca tutup shift)."""
    return h.nilai(f"""select jsonb_build_object(
 'invoices',(select coalesce(jsonb_agg(jsonb_build_array(i.id,i.total,i.dp_amount,i.metode_bayar,i.voided_at) order by i.id),'[]') from public.invoices i where i.shift_id={q(shift)}),
 'receipts',(select coalesce(jsonb_agg(jsonb_build_array(c.id,c.status,c.shift_id,c.void_shift_id) order by c.id),'[]') from public.clinic_payment_receipts c where c.shift_id={q(shift)} or c.void_shift_id={q(shift)}),
 'parts',(select coalesce(jsonb_agg(jsonb_build_array(p.metode,p.amount) order by p.id),'[]') from public.clinic_payment_receipt_parts p join public.clinic_payment_receipts c on c.id=p.receipt_id where c.shift_id={q(shift)} or c.void_shift_id={q(shift)}),
 'expenses',(select coalesce(jsonb_agg(jsonb_build_array(e.id,e.jumlah,e.metode_bayar) order by e.id),'[]') from public.expenses e where e.shift_id={q(shift)}))""")


def tutup_sql(shift, closing=150000, expected=150000, breakdown=None):
    """UPDATE persis dari lib/tutup-shift.ts (tutupShift) lewat PostgREST."""
    breakdown = breakdown or {"Tunai": 0, "Transfer": 0}
    return (f"update public.cashier_shifts set closing_balance={closing},expected_cash={expected},"
            f"selisih={closing - expected},closing_breakdown={j(breakdown)},closed_at=now(),status='closed' "
            f"where id={q(shift)} and status='open' returning id;")


def coba(h, sql, user):
    """(error, baris_terubah) — error None bila pernyataan diterima."""
    try:
        out = h.sql(sql, user)
        return None, len([x for x in out.splitlines() if x.strip() and x.strip() not in ("authenticated",) and x.strip() != user])
    except RuntimeError as error:
        return str(error).strip().splitlines()[0], 0


def tutup_paksa_sql(shift, alasan, expected=90000, breakdown=None):
    breakdown = breakdown or {"Tunai": 0}
    return (f"select public.cashier_shift_supervisor_close({q(shift)},{q(alasan)},{expected},{j(breakdown)});")


def jalankan(h):
    fixture(h)
    # --- Uang nyata di laci STAFF (pemilik) lewat writer asli -------------------------
    v = dp.visit(h, 501)
    err = h.gagal(r.tagih_biasa_sql(v, "laci-staff-dp", dp.lines(501), r.STAFF, dp=200000), r.STAFF)
    catat("pemilik-terima-DP-tunai-di-laci-sendiri", not err and h.angka(
        f"select count(*) from public.invoices where shift_id={q(TARGET)}") == 1, err or "DP Tunai 200000 masuk laci STAFF")
    err = h.gagal(r.bayar_sql(v, "laci-staff-transfer", [{"method": "Transfer", "amount": 50000}]), r.STAFF)
    rcpt = h.nilai(f"select id from public.clinic_payment_receipts where shift_id={q(TARGET)} order by created_at limit 1")
    # Pembatalan kwitansi (peran keuangan) tercatat di laci PEMBATAL sendiri, bukan laci STAFF.
    err2 = h.gagal(r.batal_kwitansi_sql(rcpt, "laci-staff-batal"), r.FINANCE) if rcpt else "kwitansi tidak terbit"
    catat("kwitansi-per-metode-dan-pembatalan-di-laci-pembatal-sendiri", not err and not err2 and h.nilai(
        f"select status||'|'||shift_id||'|'||void_shift_id from public.clinic_payment_receipts where id={q(rcpt)}")
        == f"batal|{TARGET}|{r.SHIFT[r.FINANCE]}",
        err or err2 or "Transfer 50000 diterima di laci STAFF, dibatalkan FINANCE di laci FINANCE")
    err = h.gagal(f"insert into public.expenses(branch_id,tanggal,kategori,deskripsi,jumlah,metode_bayar,shift_id,created_by) "
                  f"values ({q(r.BRANCH)},{q(r.TGL)},'Operasional','Pengeluaran fiktif kasir',25000,'Tunai',{q(TARGET)},{q(r.STAFF)}) returning id;", r.STAFF)
    catat("pemilik-catat-pengeluaran-tunai-di-laci-sendiri", not err, err or "Tunai 25000 dari laci sendiri")
    laci_awal, uang_awal = baris(h, TARGET), uang_laci(h, TARGET)

    # --- Akun lain cabang SAMA, laci TARGET = STAFF @ FA-RANAP --------------------------
    for aktor in [r.OWNER, r.ADMIN, r.FINANCE, r.DOCTOR]:
        err, n = coba(h, tutup_sql(TARGET, closing=0), aktor)
        catat(f"{NAMA[aktor]}-tidak-boleh-menutup-laci-STAFF-cabang-sama",
              baris(h, TARGET) == laci_awal and n == 0, err or f"{n} baris berubah")
        pulihkan(h, TARGET, laci_awal)
    for aktor in [r.OWNER, r.ADMIN, r.FINANCE]:
        catat(f"{NAMA[aktor]}-tetap-boleh-melihat-laci-STAFF",
              h.angka(f"select count(*) from public.cashier_shifts where id={q(TARGET)}", aktor) == 1,
              "akses lihat/laporan tetap ada")
    err, n = coba(h, f"update public.cashier_shifts set opening_balance=0 where id={q(TARGET)} returning id;", r.ADMIN)
    catat("ADMIN-tidak-boleh-mengubah-modal-awal-laci-STAFF", baris(h, TARGET) == laci_awal and n == 0, err or f"{n} baris")
    pulihkan(h, TARGET, laci_awal)
    err, n = coba(h, f"update public.cashier_shifts set opening_balance=1 where id={q(TARGET)} returning id;", r.STAFF)
    catat("pemilik-pun-tidak-boleh-mengubah-modal-awal-setelah-buka", baris(h, TARGET) == laci_awal and n == 0, err or f"{n} baris")
    pulihkan(h, TARGET, laci_awal)
    for aktor in [r.OWNER, r.ADMIN, r.FINANCE, r.DOCTOR]:
        sql = (f"insert into public.cashier_shifts(branch_id,opened_by,opening_balance,shift_type) "
               f"values ({q(r.BRANCH)},{q(STAFF2)},0,'klinik') returning id;")
        err, n = coba(h, sql, aktor)
        ada = h.angka(f"select count(*) from public.cashier_shifts where opened_by={q(STAFF2)}")
        catat(f"{NAMA[aktor]}-tidak-boleh-membukakan-laci-atas-nama-STAFF2", ada == 0, err or f"{n} laci terbuka atas nama STAFF2")
        if ada:
            h.sql(f"delete from public.cashier_shifts where opened_by={q(STAFF2)};")
    sebelum = baris(h, LACI[STAFF_B])
    for aktor in [r.OWNER, r.ADMIN]:
        err, n = coba(h, f"delete from public.cashier_shifts where id={q(LACI[STAFF_B])} returning id;", aktor)
        catat(f"{NAMA[aktor]}-tidak-boleh-menghapus-laci-STAFF_B", baris(h, LACI[STAFF_B]) == sebelum and sebelum != "",
              err or f"{n} baris terhapus")
        pulihkan(h, LACI[STAFF_B], sebelum)
    tertutup = baris(h, LACI[STAFF_C])
    for aktor, label in [(r.ADMIN, "ADMIN"), (r.OWNER, "OWNER"), (STAFF_C, "pemilik")]:
        err, n = coba(h, f"update public.cashier_shifts set status='open',closed_at=null where id={q(LACI[STAFF_C])} returning id;", aktor)
        catat(f"{label}-tidak-boleh-membuka-kembali-laci-tertutup", baris(h, LACI[STAFF_C]) == tertutup, err or f"{n} baris")
        pulihkan(h, LACI[STAFF_C], tertutup)
    err, n = coba(h, f"update public.cashier_shifts set closing_balance=1,selisih=-69999 where id={q(LACI[STAFF_C])} returning id;", STAFF_C)
    catat("laci-tertutup-kekal-termasuk-bagi-pemilik", baris(h, LACI[STAFF_C]) == tertutup, err or f"{n} baris")
    pulihkan(h, LACI[STAFF_C], tertutup)

    err, n = coba(h, f"update public.cashier_shifts set status='closed',closed_at=now() where id={q(TARGET)} returning id;", r.STAFF)
    catat("pemilik-tidak-boleh-menutup-tanpa-hitungan-lengkap", baris(h, TARGET) == laci_awal and n == 0, err or f"{n} baris")
    pulihkan(h, TARGET, laci_awal)
    err, n = coba(h, f"update public.cashier_shifts set shift_type='petshop' where id={q(TARGET)} returning id;", r.ADMIN)
    catat("ADMIN-tidak-boleh-mengganti-jenis-laci-STAFF-untuk-lolos", baris(h, TARGET) == laci_awal and n == 0, err or f"{n} baris")
    pulihkan(h, TARGET, laci_awal)

    # --- Menempelkan uang ke laci orang lain --------------------------------------------
    for aktor in [r.ADMIN, r.FINANCE, r.OWNER]:
        sql = (f"insert into public.expenses(branch_id,tanggal,kategori,deskripsi,jumlah,metode_bayar,shift_id,created_by) "
               f"values ({q(r.BRANCH)},{q(r.TGL)},'Operasional','Tempel fiktif',300000,'Tunai',{q(TARGET)},{q(aktor)}) returning id;")
        err, n = coba(h, sql, aktor)
        catat(f"{NAMA[aktor]}-tidak-boleh-menempel-pengeluaran-ke-laci-STAFF", uang_laci(h, TARGET) == uang_awal, err or f"{n} baris")
        h.sql("delete from public.expenses where deskripsi='Tempel fiktif';")
    err, n = coba(h, f"insert into public.expenses(branch_id,tanggal,kategori,deskripsi,jumlah,metode_bayar,shift_id,created_by) "
                     f"values ({q(r.BRANCH)},{q(r.TGL)},'Operasional','Ke laci tertutup',1000,'Tunai',{q(LACI[STAFF_C])},{q(STAFF_C)}) returning id;", STAFF_C)
    catat("pengeluaran-tidak-boleh-masuk-laci-tertutup", h.angka(
        f"select count(*) from public.expenses where shift_id={q(LACI[STAFF_C])}") == 0, err or f"{n} baris")
    h.sql("delete from public.expenses where deskripsi='Ke laci tertutup';")
    v2 = dp.visit(h, 502)
    err = h.gagal(r.tagih_biasa_sql(v2, "tempel-invoice", dp.lines(502), r.ADMIN, dp=200000, ganti={"shift_id": TARGET}), r.ADMIN)
    catat("ADMIN-tidak-boleh-menagih-ke-laci-STAFF", bool(err and "SHIFT_INVALID" in err) and uang_laci(h, TARGET) == uang_awal, err)
    err, n = coba(h, tutup_sql(TARGET, closing=0), ADMIN_LUAR)
    catat("ADMIN-cabang-lain-tidak-boleh-menutup-laci-STAFF", baris(h, TARGET) == laci_awal and n == 0, err or f"{n} baris")
    pulihkan(h, TARGET, laci_awal)
    catat("laci-STAFF-dan-uangnya-utuh-setelah-semua-percobaan",
          baris(h, TARGET) == laci_awal and uang_laci(h, TARGET) == uang_awal, "modal, kwitansi, batal, pengeluaran tidak bergeser")

    # --- Tutup paksa supervisor: eksplisit, beralasan, teraudit --------------------------
    stale = LACI[STAFF_D]
    awal_stale, jurnal0 = baris(h, stale), h.angka("select count(*) from public.journal_entries")
    for aktor, label, alasan in [(r.FINANCE, "FINANCE", "Kasir lupa tutup laci kemarin"),
                                 (r.DOCTOR, "DOCTOR", "Kasir lupa tutup laci kemarin"),
                                 (r.STAFF, "STAFF", "Kasir lupa tutup laci kemarin"),
                                 (ADMIN_LUAR, "ADMIN-cabang-lain", "Kasir lupa tutup laci kemarin"),
                                 (r.ADMIN, "ADMIN-tanpa-alasan", "  ")]:
        err = h.gagal(tutup_paksa_sql(stale, alasan), aktor)
        catat(f"tutup-paksa-ditolak-{label}", bool(err and "SHIFT_SUPERVISOR_DENIED" in err) and baris(h, stale) == awal_stale, err)
    err = h.gagal(tutup_paksa_sql(TARGET, "Kasir lupa tutup laci kemarin"), r.ADMIN)
    catat("tutup-paksa-ditolak-laci-belum-24-jam", bool(err and "SHIFT_SUPERVISOR_DENIED" in err) and baris(h, TARGET) == laci_awal, err)
    err = h.gagal(tutup_paksa_sql(r.SHIFT[r.OWNER], "Laci saya sendiri nyangkut"), r.OWNER)
    catat("tutup-paksa-ditolak-untuk-laci-sendiri", bool(err and "SHIFT_SUPERVISOR_DENIED" in err), err)
    err = h.gagal(tutup_paksa_sql(stale, "Kasir lupa tutup laci kemarin, dicek CCTV"), r.ADMIN)
    audit = h.nilai(f"select jsonb_build_object('n',count(*),'reason',max(reason),'actor',max(actor_id::text),'role',max(actor_role),"
                    f"'owner',max(drawer_owner::text),'branch',max(branch_id::text)) from public.cashier_shift_supervisor_closures where shift_id={q(stale)}") if not err else "{}"
    st = h.nilai(f"select status||'|'||closing_balance||'|'||expected_cash||'|'||selisih||'|'||opening_balance from public.cashier_shifts where id={q(stale)}")
    a = json.loads(audit or "{}")
    catat("tutup-paksa-ADMIN-cabang-sama-beralasan-teraudit",
          not err and st == "closed|90000|90000|0|90000" and a.get("n") == 1 and a.get("role") == "ADMIN"
          and a.get("actor") == r.ADMIN and a.get("owner") == STAFF_D and a.get("branch") == r.BRANCH
          and "CCTV" in (a.get("reason") or "") and h.angka("select count(*) from public.journal_entries") == jurnal0,
          err or {"laci": st, "audit": a})
    err = h.gagal(tutup_paksa_sql(stale, "Coba tutup paksa kedua kali"), r.ADMIN)
    catat("tutup-paksa-tidak-dua-kali", bool(err and "SHIFT_SUPERVISOR_DENIED" in err) and h.angka(
        f"select count(*) from public.cashier_shift_supervisor_closures where shift_id={q(stale)}") == 1, err)
    err = h.gagal(f"insert into public.cashier_shift_supervisor_closures(shift_id,branch_id,shift_type,drawer_owner,actor_id,actor_role,reason,opened_at,expected_cash) "
                  f"values ({q(TARGET)},{q(r.BRANCH)},'klinik',{q(r.STAFF)},{q(r.ADMIN)},'ADMIN','palsu',now(),0);", r.ADMIN)
    catat("audit-tutup-paksa-tidak-bisa-ditulis-langsung", bool(err), err)

    # --- Positif: setiap peran tetap boleh membuka/menutup laci MILIKNYA sendiri ----------
    for aktor in [r.OWNER, r.ADMIN, r.FINANCE, r.DOCTOR]:
        err, n = coba(h, tutup_sql(r.SHIFT[aktor], closing=0, expected=0), aktor)
        st = h.nilai(f"select status from public.cashier_shifts where id={q(r.SHIFT[aktor])}")
        err2, n2 = coba(h, f"insert into public.cashier_shifts(branch_id,opened_by,opening_balance,shift_type) "
                           f"values ({q(r.BRANCH)},{q(aktor)},10000,'klinik') returning id;", aktor)
        catat(f"{NAMA[aktor]}-boleh-tutup-dan-buka-laci-sendiri", not err and st == "closed" and not err2,
              err or err2 or "tutup sendiri lalu buka laci baru")
    err, n = coba(h, tutup_sql(TARGET, closing=320000, expected=325000, breakdown={"Tunai": 200000, "Transfer": 0}), r.STAFF)
    st = h.nilai(f"select status||'|'||opening_balance||'|'||closing_balance||'|'||expected_cash||'|'||selisih from public.cashier_shifts where id={q(TARGET)}")
    catat("STAFF-tutup-laci-sendiri-modal-dan-uang-utuh", not err and st == "closed|150000|320000|325000|-5000"
          and uang_laci(h, TARGET) == uang_awal, err or st)
    akhir = baris(h, TARGET)
    err, n = coba(h, f"update public.cashier_shifts set status='open',closed_at=null where id={q(TARGET)} returning id;", r.STAFF)
    catat("STAFF-tidak-boleh-membuka-kembali-laci-sendiri", baris(h, TARGET) == akhir, err or f"{n} baris")
    pulihkan(h, TARGET, akhir)
    err = h.gagal(r.bayar_sql(v, "setelah-tutup", [{"method": "Tunai", "amount": 10000}]), r.STAFF)
    catat("uang-tidak-masuk-laci-tertutup", bool(err and "SHIFT_INVALID" in err) and uang_laci(h, TARGET) == uang_awal, err)


def akar_tanpa_perbaikan(stack):
    tmp = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="kamo-shift-red.", dir="/opt/data")))
    (tmp / "supabase/migrations").mkdir(parents=True)
    (tmp / "supabase/tests/fixtures").mkdir(parents=True)
    for m in sorted((ROOT / "supabase/migrations").glob("*.sql")):
        if m.name != PERBAIKAN:
            shutil.copy(m, tmp / "supabase/migrations" / m.name)
    for f in (ROOT / "supabase/tests/fixtures").glob("*"):
        shutil.copy(f, tmp / "supabase/tests/fixtures" / f.name)
    return tmp


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tanpa-perbaikan", action="store_true")
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    with contextlib.ExitStack() as stack:
        r.fixture.ROOT = akar_tanpa_perbaikan(stack) if args.tanpa_perbaikan else ROOT
        db = stack.enter_context(r.NativePostgres(r.BIN))
        r.fixture.DisposablePostgres.bootstrap(db)
        try:
            jalankan(r.Harness(db))
        except Exception as error:  # noqa: BLE001
            catat("HARNESS", False, str(error).strip().splitlines()[0])
    total = {s: sum(x["status"] == s for x in HASIL) for s in ("PASS", "FAIL")}
    mode = "TANPA PERBAIKAN (RED main)" if args.tanpa_perbaikan else "DENGAN PERBAIKAN"
    print(f"TOTAL {mode} {json.dumps(total)}", flush=True)
    if args.json:
        args.json.write_text(json.dumps({"mode": mode, "total": total, "cases": HASIL}, indent=2))
    return 1 if total["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
