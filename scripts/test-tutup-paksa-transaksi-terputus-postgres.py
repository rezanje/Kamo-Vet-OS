#!/usr/bin/env python3
"""LOKAL SAJA: tutup paksa supervisor membuang transaksi kasir yang terputus sebelum final.

Memasang SELURUH migrasi repositori ke klaster PostgreSQL sekali pakai, lalu menulis sebagai
peran `authenticated` dengan klaim JWT pengguna fiktif — bentuk tulisan yang sama dengan
aplikasi (server action -> PostgREST/RPC). Penjualan dibuat lewat jalur asli (insert kepala
struk sebagai kasir, finalize_pos_sale, sale_stock_out_fifo). Satu-satunya jalan pintas:
umur struk dimundurkan (created_at) sebagai pemilik basis data dengan pemicu dimatikan, dan
jejak "tidak mungkin" (jurnal / efek staf pada struk belum final) ditanam dengan cara yang sama.

Pertanyaan yang dijawab (insiden 1 Nov 2026, docs/2026-11-01-insiden-tutup-shift-tertahan.md):
kasir pemilik laci tidak bisa masuk lagi dan lacinya punya struk yang checkout-nya mati di
tengah jalan. Bisakah Owner/Admin menutup paksa laci itu tanpa menyamar sebagai kasir — dan
tanpa membuang struk yang sudah memotong stok, sudah berjurnal, atau masih diproses?

  --tanpa-perbaikan   pasang semua migrasi KECUALI 20261106030000 (bukti RED)
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
PERBAIKAN = "20261106030000_tutup_paksa_buang_transaksi_terputus.sql"

spec = importlib.util.spec_from_file_location("ranap", ROOT / "scripts/test-ranap-mitigasi-penuh-postgres.py")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
q, j = r.q, r.j

HASIL = []


def uid(group, n):
    return f"fb{group}00000-0000-4000-8000-{n:012d}"


CABANG, CABANG_LAIN = uid(2, 1), uid(2, 2)
GUDANG = uid(3, 1)
JASA, BARANG = uid(5, 1), uid(5, 2)
ADMIN, OWNER, FINANCE, REKAN, ADMIN_LUAR = (uid(1, i) for i in range(1, 6))
# Satu kasir per laci nyangkut (satu laci petshop terbuka per orang).
KASIR = {k: uid(1, 10 + i) for i, k in enumerate(["bersih", "stok", "jurnal", "baru", "anak", "sendiri"])}
LACI = {k: uid(4, 10 + i) for i, k in enumerate(KASIR)}
MODAL = 100000
PECAHAN = {"Tunai": 0, "Transfer": 0, "Debit": 0, "Kredit": 0, "QRIS": 0, "E-Wallet": 0}
ALASAN = "Kasir sudah resign, laci nyangkut sejak kemarin"


def catat(kasus, ok, detail):
    HASIL.append({"kasus": kasus, "status": "PASS" if ok else "FAIL", "detail": detail})
    print(f"{'PASS' if ok else 'FAIL':5} {kasus}: {detail}", flush=True)


def satu_baris(teks):
    for line in str(teks).splitlines():
        if line.startswith("ERROR:"):
            return line.removeprefix("ERROR:").strip()
    return str(teks).strip().splitlines()[0] if teks else teks


def fixture(h):
    semua = [(ADMIN, "ADMIN", CABANG), (OWNER, "OWNER", CABANG), (FINANCE, "FINANCE", CABANG),
             (REKAN, "STAFF", CABANG), (ADMIN_LUAR, "ADMIN", CABANG_LAIN)] + [(u, "STAFF", CABANG) for u in KASIR.values()]
    h.sql(f"""
insert into public.coa_accounts(code,name,type,normal_balance,is_header) values
 ('1111','Kas Fiktif','ASET','D',false),('1112','Bank Fiktif','ASET','D',false),('510001','Penjualan Fiktif','PENDAPATAN','K',false),
 ('520002','Diskon Fiktif','PENDAPATAN','D',false),('312005','PPN Fiktif','LIABILITAS','K',false),('600001','HPP Fiktif','BEBAN','D',false),
 ('170001','Persediaan Fiktif','ASET','D',false)
 on conflict(code) do update set is_active=true,is_header=false;
insert into auth.users(id,raw_user_meta_data) values
 {",".join(f"({q(u)},'{{\"full_name\":\"Akun Fiktif {i}\"}}')" for i, (u, _, _) in enumerate(semua, 1))};
{"".join(f"update public.profiles set role={q(role)},is_active=true where id={q(u)};" for u, role, _ in semua)}
insert into public.role_modules(role,module_id) values('STAFF','pos') on conflict do nothing;
insert into public.branches(id,code,name,type) values({q(CABANG)},'FB-PET','Petshop Fiktif','PETSHOP'),({q(CABANG_LAIN)},'FB-LAIN','Petshop Lain','PETSHOP');
insert into public.user_branches(user_id,branch_id) values {",".join(f"({q(u)},{q(b)})" for u, _, b in semua)};
insert into public.role_capabilities(role,all_branches,create_accounts) values('ADMIN',false,true) on conflict do nothing;
insert into public.warehouses(id,branch_id,code,name,type) values({q(GUDANG)},{q(CABANG)},'FB-WH','Gudang Fiktif','RETAIL');
insert into public.items(id,code,name,unit,item_type,buy_price) values
 ({q(JASA)},'FB-JASA','Jasa Fiktif','pcs','Jasa',0),({q(BARANG)},'FB-PAKAN','Pakan Fiktif','pcs','Persediaan',8000);
insert into public.stock(warehouse_id,item_id,qty) values({q(GUDANG)},{q(BARANG)},50);
insert into public.stock_layers(warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)
 values({q(GUDANG)},{q(BARANG)},current_date,50,50,8000,'purchase');
insert into public.cash_accounts(id,nama,jenis,coa_code) values({q(uid(6, 1))},'Kas Fiktif','Kas','1111'),({q(uid(6, 2))},'Bank Fiktif','Bank','1112');
insert into public.payment_account_map(metode,branch_id,cash_account_id) values
 ('Tunai',{q(CABANG)},{q(uid(6, 1))}),('QRIS',{q(CABANG)},{q(uid(6, 2))}) on conflict do nothing;
update public.accounting_locks set closed_until=null;
update public.company_settings set mode_pkp=false;
-- Laci nyangkut: dibuka 30 jam lalu, jadi memenuhi syarat tutup paksa (> 24 jam).
insert into public.cashier_shifts(id,branch_id,opened_by,shift_type,status,opening_balance,opened_at) values
 {",".join(f"({q(LACI[k])},{q(CABANG)},{q(KASIR[k])},'petshop','open',{MODAL},now()-interval '30 hours')" for k in KASIR)};
""")


def struk(h, kasir, no, total=35000, metode="Tunai", item=JASA, qty=1):
    """Kepala + baris struk persis seperti checkout kasir: belum final."""
    laci = LACI[next(k for k, v in KASIR.items() if v == kasir)]
    plan = [{"method": metode, "amount": total}]
    out = h.sql(f"""
insert into public.sales(branch_id,no_struk,subtotal,discount,total,metode_bayar,bayar,kembali,cashier_id,shift_id,payment_plan,checkout_key,checkout_fingerprint)
 values({q(CABANG)},{q(no)},{total},0,{total},{q(metode)},{total},0,{q(kasir)},{q(laci)},{j(plan)},{q('uji:' + no)},repeat('a',64)) returning id;
insert into public.sale_items(sale_id,item_id,nama,qty,harga,satuan,faktor,hpp)
 select id,{q(item)},'Barang Fiktif {no}',{qty},{total / qty},'pcs',1,0 from public.sales where no_struk={q(no)};""", kasir)
    return [x for x in out.splitlines() if len(x) == 36][-1]


def mundurkan(h, sale, menit):
    """Umur struk = seolah checkout-nya mati `menit` menit lalu (pemicu dimatikan, fixture saja)."""
    h.sql(f"set session_replication_role=replica; update public.sales set created_at=now()-interval '{menit} minutes' where id={q(sale)};")


def tanam(h, sql):
    h.sql("set session_replication_role=replica;\n" + sql)


def ada(h, sale):
    return h.angka(f"select count(*) from public.sales where id={q(sale)}") == 1


def laci(h, k):
    return h.nilai(f"select status from public.cashier_shifts where id={q(LACI[k])}")


def tutup_paksa(h, k, aktor=ADMIN, expected=MODAL, pecahan=None):
    return h.gagal(f"select public.cashier_shift_supervisor_close({q(LACI[k])},{q(ALASAN)},{expected},{j(pecahan or PECAHAN)});", aktor)


def jalankan(h, tanpa_perbaikan):
    fixture(h)
    # --- Laci "bersih": satu penjualan final + dua struk terputus tanpa jejak ------------
    final = struk(h, KASIR["bersih"], "FB-FINAL", total=50000)
    err = h.gagal(f"select public.finalize_pos_sale({q(final)});", KASIR["bersih"])
    catat("fixture-penjualan-final-lewat-jalur-asli", not err, satu_baris(err) or "50.000 Tunai final, berjurnal")
    o1 = struk(h, KASIR["bersih"], "FB-PUTUS-1", total=35000)
    o2 = struk(h, KASIR["bersih"], "FB-PUTUS-2", total=88000, metode="QRIS")
    mundurkan(h, o1, 45)
    mundurkan(h, o2, 600)
    # Kasir tidak bisa masuk lagi (resign / akun dinonaktifkan).
    h.sql(f"update public.profiles set is_active=false where id={q(KASIR['bersih'])};")
    jurnal0 = h.angka("select count(*) from public.journal_entries")
    final0 = h.nilai(f"select to_jsonb(s)-'created_at' from public.sales s where id={q(final)}")

    # Penanda supervisor tidak boleh membuka jalan bagi selain Owner/Admin (pertahanan berlapis;
    # klien PostgREST pun tidak bisa memasang GUC bebas).
    for aktor, label in [(REKAN, "STAFF-rekan"), (FINANCE, "FINANCE")]:
        err = h.gagal(f"select set_config('kamo.supervisor_pending_cleanup',{q(LACI['bersih'])},false);"
                      f"delete from public.sales where id={q(o1)} returning id;", aktor)
        catat(f"{label}-tidak-bisa-hapus-struk-kasir-lain-walau-memasang-penanda",
              bool(err) and "Akses pembatalan POS ditolak" in err and ada(h, o1), satu_baris(err) or "TERHAPUS")
    for aktor, label in [(ADMIN, "ADMIN"), (OWNER, "OWNER"), (REKAN, "STAFF-rekan")]:
        err = h.gagal(f"delete from public.sales where id={q(o1)} returning id;", aktor)
        catat(f"{label}-tidak-bisa-hapus-langsung-struk-kasir-lain",
              bool(err) and "Akses pembatalan POS ditolak" in err and ada(h, o1), satu_baris(err) or "TERHAPUS")
    err = h.gagal(f"select set_config('kamo.supervisor_pending_cleanup',{q(LACI['stok'])},false);"
                  f"delete from public.sales where id={q(o1)} returning id;", ADMIN)
    catat("ADMIN-penanda-laci-lain-tidak-berlaku", bool(err) and ada(h, o1), satu_baris(err) or "TERHAPUS")
    for aktor, label in [(FINANCE, "FINANCE"), (REKAN, "STAFF-rekan"), (ADMIN_LUAR, "ADMIN-cabang-lain")]:
        err = tutup_paksa(h, "bersih", aktor, expected=MODAL + 50000, pecahan={**PECAHAN, "Tunai": 50000})
        catat(f"tutup-paksa-ditolak-{label}", bool(err) and "SHIFT_SUPERVISOR_DENIED" in err
              and ada(h, o1) and ada(h, o2) and laci(h, "bersih") == "open", satu_baris(err))

    # Supervisor berhasil: struk terputus dibuang, penjualan final utuh, laci tertutup, teraudit.
    err = tutup_paksa(h, "bersih", ADMIN, expected=MODAL + 50000, pecahan={**PECAHAN, "Tunai": 50000})
    st = laci(h, "bersih")
    catat("tutup-paksa-ADMIN-membuang-struk-terputus-dan-menutup-laci",
          not err and st == "closed" and not ada(h, o1) and not ada(h, o2),
          satu_baris(err) or f"laci={st} sisa={[n for n, s in [('FB-PUTUS-1', o1), ('FB-PUTUS-2', o2)] if ada(h, s)]}")
    sisa = h.angka(f"select (select count(*) from public.sale_items where sale_id in ({q(o1)},{q(o2)}))"
                   f"+(select count(*) from public.sale_payments where sale_id in ({q(o1)},{q(o2)}))"
                   f"+(select count(*) from public.pos_sale_postings where sale_id in ({q(o1)},{q(o2)}))")
    catat("baris-barang-bayar-posting-ikut-terbuang", sisa == 0, f"{int(sisa)} baris anak tersisa")
    catat("penjualan-final-dan-jurnal-tidak-tersentuh",
          h.nilai(f"select to_jsonb(s)-'created_at' from public.sales s where id={q(final)}") == final0
          and h.angka("select count(*) from public.journal_entries") == jurnal0,
          f"jurnal {int(jurnal0)} -> {int(h.angka('select count(*) from public.journal_entries'))}")
    audit = {}
    if not tanpa_perbaikan:
        audit = json.loads(h.nilai(f"select jsonb_build_object('actor',actor_id,'owner',drawer_owner,'removed',removed_pending_sales) "
                                   f"from public.cashier_shift_supervisor_closures where shift_id={q(LACI['bersih'])}") or "{}")
    removed = audit.get("removed") or []
    catat("audit-tutup-paksa-mencatat-struk-yang-dibuang",
          audit.get("actor") == ADMIN and audit.get("owner") == KASIR["bersih"]
          and sorted(x.get("no_struk") for x in removed) == ["FB-PUTUS-1", "FB-PUTUS-2"]
          and {x.get("sale_id") for x in removed} == {o1, o2}
          and all(x.get("cashier_id") == KASIR["bersih"] and x.get("items") for x in removed)
          and sorted(float(x.get("total")) for x in removed) == [35000, 88000],
          {"actor": audit.get("actor"), "dibuang": [(x.get("no_struk"), x.get("total"), len(x.get("items") or [])) for x in removed]})
    pelaku = h.nilai(f"select coalesce(string_agg(distinct actor_id::text,','),'-') from public.activity_log "
                     f"where row_entity='sales' and action='delete' and row_id in ({q(o1)},{q(o2)})")
    catat("riwayat-aktivitas-atas-nama-supervisor-bukan-kasir", pelaku == ADMIN, f"pelaku hapus={pelaku}")
    err = h.gagal(f"begin; select public.cashier_shift_supervisor_close({q(LACI['bersih'])},{q(ALASAN)},0,'{{}}'::jsonb);"
                  " rollback;", ADMIN)
    catat("tutup-paksa-tidak-dua-kali", bool(err) and "laci sudah ditutup" in err, satu_baris(err))

    # --- Struk terputus yang SUDAH memotong stok tidak dibuang; tutup paksa ditolak utuh --
    s_stok = struk(h, KASIR["stok"], "FB-STOK", total=20000, item=BARANG, qty=2)
    err = h.gagal(f"select * from public.sale_stock_out_fifo({q(GUDANG)},{q(BARANG)},2,'sale','FB-STOK');", KASIR["stok"])
    gerak = h.angka("select count(*) from public.stock_moves where source_ref='FB-STOK'")
    catat("fixture-stok-keluar-lewat-jalur-asli", not err and gerak > 0, satu_baris(err) or f"{int(gerak)} mutasi stok")
    s_bersih = struk(h, KASIR["stok"], "FB-STOK-TEMAN", total=15000)
    mundurkan(h, s_stok, 120)
    mundurkan(h, s_bersih, 120)
    err = tutup_paksa(h, "stok")
    catat("tutup-paksa-menolak-struk-yang-sudah-memotong-stok",
          bool(err) and "SHIFT_SUPERVISOR_DENIED" in err and "FB-STOK" in err and "tim teknis" in err
          and ada(h, s_stok) and laci(h, "stok") == "open", satu_baris(err) or "DITERIMA")
    catat("penolakan-utuh-struk-bersih-di-laci-yang-sama-tidak-ikut-dibuang", ada(h, s_bersih), "FB-STOK-TEMAN tetap ada")
    catat("mutasi-stok-tetap-utuh", h.angka("select count(*) from public.stock_moves where source_ref='FB-STOK'") == gerak, "")

    # --- Struk terputus yang sudah punya jurnal tidak dibuang ----------------------------
    s_jurnal = struk(h, KASIR["jurnal"], "FB-JURNAL")
    mundurkan(h, s_jurnal, 120)
    tanam(h, f"insert into public.journal_entries(tanggal,deskripsi,source,source_ref,branch_id) "
             f"values(current_date,'Jejak jurnal fiktif','sale','FB-JURNAL',{q(CABANG)});")
    err = tutup_paksa(h, "jurnal")
    catat("tutup-paksa-menolak-struk-yang-sudah-berjurnal",
          bool(err) and "SHIFT_SUPERVISOR_DENIED" in err and "FB-JURNAL" in err
          and ada(h, s_jurnal) and laci(h, "jurnal") == "open", satu_baris(err) or "DITERIMA")

    # --- Struk yang baru < 10 menit: checkout bisa jadi masih berjalan --------------------
    s_baru = struk(h, KASIR["baru"], "FB-BARU")
    mundurkan(h, s_baru, 3)
    err = tutup_paksa(h, "baru")
    catat("tutup-paksa-menolak-struk-di-bawah-10-menit",
          bool(err) and "SHIFT_SUPERVISOR_DENIED" in err and "FB-BARU" in err and "10 menit" in err
          and ada(h, s_baru) and laci(h, "baru") == "open", satu_baris(err) or "DITERIMA")
    mundurkan(h, s_baru, 11)
    err = tutup_paksa(h, "baru")
    catat("struk-yang-sama-dibuang-setelah-lewat-10-menit", not err and not ada(h, s_baru) and laci(h, "baru") == "closed",
          satu_baris(err) or "laci tertutup, struk dibuang")

    # --- Struk dengan dokumen turunan (RESTRICT) tidak dibuang ----------------------------
    s_anak = struk(h, KASIR["anak"], "FB-ANAK")
    mundurkan(h, s_anak, 120)
    tanam(h, f"insert into public.sale_staff_effects(sale_id,staff_id,before_value,after_value,ledger_ids) "
             f"values({q(s_anak)},{q(KASIR['anak'])},'{{}}','{{}}','{{}}');")
    err = tutup_paksa(h, "anak")
    catat("tutup-paksa-menolak-struk-dengan-dokumen-turunan",
          bool(err) and "SHIFT_SUPERVISOR_DENIED" in err and "FB-ANAK" in err
          and ada(h, s_anak) and laci(h, "anak") == "open", satu_baris(err) or "DITERIMA")

    # --- Regresi jalur kasir: pemilik struk tetap bisa membuang struknya sendiri ----------
    s_sendiri = struk(h, KASIR["sendiri"], "FB-SENDIRI")
    err = h.gagal(f"delete from public.sales where id={q(s_sendiri)} and payments_finalized_at is null returning id;", KASIR["sendiri"])
    catat("kasir-pemilik-tetap-bisa-membuang-struk-sendiri", not err and not ada(h, s_sendiri), satu_baris(err) or "terbuang")
    s_sendiri2 = struk(h, KASIR["sendiri"], "FB-SENDIRI-2")
    err = h.gagal(f"select public.finalize_pos_sale({q(s_sendiri2)});", KASIR["sendiri"])
    err2 = h.gagal(f"delete from public.sales where id={q(s_sendiri2)} returning id;", KASIR["sendiri"])
    catat("struk-final-tetap-tidak-bisa-dihapus", not err and bool(err2) and ada(h, s_sendiri2), satu_baris(err or err2))
    tutup = (f"update public.cashier_shifts set closing_balance={MODAL + 35000},expected_cash={MODAL + 35000},selisih=0,"
             f"closing_breakdown={j({**PECAHAN, 'Tunai': 35000})},closed_at=now(),status='closed' where id={q(LACI['sendiri'])} returning id;")
    err = h.gagal(tutup, KASIR["sendiri"])
    catat("kasir-tetap-bisa-menutup-laci-sendiri-seperti-biasa", not err and laci(h, "sendiri") == "closed", satu_baris(err) or "tertutup")


def akar_tanpa_perbaikan(stack):
    tmp = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="kamo-tutup-paksa-red.", dir="/opt/data")))
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
            jalankan(r.Harness(db), args.tanpa_perbaikan)
        except Exception as error:  # noqa: BLE001
            catat("HARNESS", False, satu_baris(error))
    total = {s: sum(x["status"] == s for x in HASIL) for s in ("PASS", "FAIL")}
    mode = "TANPA PERBAIKAN (RED)" if args.tanpa_perbaikan else "DENGAN PERBAIKAN"
    print(f"TOTAL {mode} {json.dumps(total)}", flush=True)
    if args.json:
        args.json.write_text(json.dumps({"mode": mode, "total": total, "cases": HASIL}, indent=2))
    return 1 if total["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
