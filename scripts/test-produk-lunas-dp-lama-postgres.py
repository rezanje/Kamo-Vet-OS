#!/usr/bin/env python3
"""LOCAL ONLY: pembelian produk saja wajib lunas + pelunasan DP lama (Agen C).

Full original schema: SELURUH migrasi repositori dipasang ke klaster PostgreSQL native
sekali pakai, kecuali migrasi kandidat 20261104310000. Tagihan DP produk-saja LAMA
dibuat lebih dulu dengan writer asli (seperti data yang sudah ada di Production),
baru kemudian migrasi kandidat dipasang (mode GREEN) atau tidak dipasang (mode --red).

Writer publik dipanggil sebagai role `authenticated` dengan klaim JWT pengguna fiktif.
Tidak ada stub bisnis; hanya platform auth/storage Supabase yang disimulasikan
(pola yang sama dengan scripts/test-ranap-mitigasi-penuh-postgres.py).

Keluar 0 hanya bila semua kasus PASS.
"""
import argparse
import contextlib
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
MIGRASI = "20261104310000_produk_lunas_pelunasan_dp.sql"

spec = importlib.util.spec_from_file_location("ranap", ROOT / "scripts/test-ranap-mitigasi-penuh-postgres.py")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
spec = importlib.util.spec_from_file_location("paralel", ROOT / "scripts/test-ranap-mitigasi-concurrency-postgres.py")
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

q, j, uid = r.q, r.j, r.uid
OWNER, ADMIN, FINANCE, STAFF, DOCTOR = r.OWNER, r.ADMIN, r.FINANCE, r.STAFF, r.DOCTOR
FIN_NONAKTIF, FIN_LUAR = r.FIN_NONAKTIF, r.FIN_LUAR
STAFF_TANPA_SHIFT = uid(1, 8)
ITEM = r.ITEM
ITEM_TINDAKAN = uid(8, 2)
KATEGORI_TINDAKAN = uid("e", 1)
KATEGORI_SUB = uid("e", 2)
HASIL = r.HASIL


def catat(kasus, ok, detail):
    return r.catat(kasus, bool(ok), detail)


def produk(qty=2):
    return {"description": "Obat Fiktif", "qty": qty, "price": 25000, "kind": "obat", "item_id": ITEM,
            "unit": "pcs", "prescription_item_id": None, "recipe_id": None, "discount_percent": 0}


PLACEHOLDER = {"description": "Jasa Konsultasi Poli Umum", "qty": 1, "price": 0, "kind": "jasa", "item_id": None,
               "unit": None, "prescription_item_id": None, "recipe_id": None, "discount_percent": 0}
JASA = {"description": "Jasa Periksa Fiktif", "qty": 1, "price": 30000, "kind": "jasa", "item_id": None,
        "unit": "kali", "prescription_item_id": None, "recipe_id": None, "discount_percent": 0}
BEBAS = {"description": "Barang Bebas Fiktif", "qty": 1, "price": 10000, "kind": "obat", "item_id": None,
         "unit": None, "prescription_item_id": None, "recipe_id": None, "discount_percent": 0}
TINDAKAN = {"description": "Tindakan Persediaan Fiktif", "qty": 1, "price": 40000, "kind": "obat",
            "item_id": ITEM_TINDAKAN, "unit": "pcs", "prescription_item_id": None, "recipe_id": None,
            "discount_percent": 0}


def fixture_tambahan(h):
    h.sql(f"""
insert into auth.users (id, raw_user_meta_data) values ({q(STAFF_TANPA_SHIFT)},'{{"full_name":"Kasir Fiktif Tanpa Laci"}}');
update public.profiles set role='STAFF' where id={q(STAFF_TANPA_SHIFT)};
insert into public.user_branches (user_id,branch_id) values ({q(STAFF_TANPA_SHIFT)},{q(r.BRANCH)});
insert into public.item_categories (id,name) values ({q(KATEGORI_TINDAKAN)},'TINDAKAN');
insert into public.item_categories (id,name,parent_id) values ({q(KATEGORI_SUB)},'Tindakan Fiktif',{q(KATEGORI_TINDAKAN)});
insert into public.items (id,code,name,unit,buy_price,item_type,is_active,is_compound_material,category_id)
 values ({q(ITEM_TINDAKAN)},'FA-TIND','Tindakan Persediaan Fiktif','pcs',3000,'Persediaan',true,false,{q(KATEGORI_SUB)});
insert into public.stock (warehouse_id,item_id,qty) values ({q(r.WH)},{q(ITEM_TINDAKAN)},50);
insert into public.stock_layers (warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)
 values ({q(r.WH)},{q(ITEM_TINDAKAN)},current_date,50,50,3000,'purchase');
""")


def kunjungan(h, n, poli="Poli Umum", rekam=False):
    """Kunjungan rawat jalan fiktif. Tanpa rekam medis = alur 'Simpan & pembayaran' registrasi."""
    cust = r.buat_pelanggan(h, n)
    visit, pet = uid(6, n), uid(5, n)
    h.sql(f"""
insert into public.pets (id,customer_id,name) values ({q(pet)},{q(cust['id'])},'Pasien Fiktif {n}');
insert into public.visits (id,branch_id,customer_id,pet_id,status,doctor_id,poli)
 values ({q(visit)},{q(r.BRANCH)},{q(cust['id'])},{q(pet)},'Pembayaran',{q(r.DOKTER_PEGAWAI)},{q(poli)});
""")
    if rekam:
        h.sql(f"""
insert into public.medical_records (id,visit_id) values ({q(uid(7, n))},{q(visit)});
insert into public.prescription_items (id,medical_record_id,nama_obat,qty,harga,satuan,jenis,kategori,item_id,faktor)
 values ({q(uid(9, n * 10 + 3))},{q(uid(7, n))},'Obat Fiktif',2,25000,'pcs','obat','Obat',{q(ITEM)},1);
""")
    return visit


def resep_produk(n):
    line = produk()
    line["prescription_item_id"] = uid(9, n * 10 + 3)
    return line


def posting(visit, key, lines, user, dp=0, status=None, alasan=None):
    ganti = None
    if status == "Lunas":
        ganti = {"paid_status": "Lunas", "dp_amount": 0, "dp_date": None}
    return r.tagih_biasa_sql(visit, key, lines, user, dp=dp, alasan=alasan, ganti=ganti)


def split_sql(visit, key, lines, user, parts):
    subtotal = r.nilai_baris(lines)
    invoice = {"tanggal": r.TGL, "subtotal": subtotal, "discount": 0, "tax": 0, "total": subtotal,
               "dp_amount": 0, "dp_date": None, "paid_status": "Lunas", "metode_bayar": parts[0]["method"],
               "shift_id": r.SHIFT[user], "voucher_code": None, "salesperson_id": None}
    return (f"select public.clinic_post_split_invoice({q(visit)},{q(key)},{j(invoice)},{j(lines)},{j(parts)});")


def lunasi_sql(visit, invoice, key, parts, expected):
    exp = "null" if expected is None else str(expected)
    return (f"select public.clinic_settle_outpatient_invoice({q(visit)}::uuid,{q(invoice)}::uuid,"
            f"{q(key)},{j(parts)},{exp}::numeric);")


def potret(h, visit):
    return {
        "invoices": h.angka(f"select count(*) from public.invoices where visit_id={q(visit)}"),
        "journals": h.angka("select count(*) from public.journal_entries"),
        "moves": h.angka("select count(*) from public.stock_moves"),
        "stock": h.angka(f"select qty from public.stock where item_id={q(ITEM)} and warehouse_id={q(r.WH)}"),
        "receipts": h.angka(f"select count(*) from public.clinic_payment_receipts where visit_id={q(visit)}"),
        "payments": h.angka("select count(*) from public.invoice_payments"),
        "advances": h.angka(f"select count(*) from public.clinic_customer_advances where visit_id={q(visit)}"),
    }


def sisa(h, invoice):
    return h.angka(f"select total from public.invoices where id={q(invoice)}") - h.diterima(invoice)


# ---------------------------------------------------------------------------
# Data lama: dibuat SEBELUM migrasi kandidat, dengan writer asli.
# ---------------------------------------------------------------------------
LAMA = {}


def data_lama(h):
    for n in (301, 302, 303, 304, 307, 308, 309, 310, 311, 312):
        v = kunjungan(h, n)
        h.sql(posting(v, f"lama-{n}", [produk()], STAFF, dp=30000), STAFF)
        LAMA[n] = (v, h.aktif(v))
    v = kunjungan(h, 305)
    h.sql(posting(v, "lama-305", [produk()], STAFF, status="Lunas"), STAFF)
    LAMA[305] = (v, h.aktif(v))
    v = kunjungan(h, 306)
    h.sql(posting(v, "lama-306", [produk()], FINANCE, alasan="Pelanggan tetap fiktif"), FINANCE)
    LAMA[306] = (v, h.aktif(v))
    # Bukti bahwa masalahnya nyata di writer lama: produk saja tersimpan DP / Belum Lunas.
    catat("baseline-legacy-product-only-DP-accepted-by-original-writer",
          h.status_bayar(LAMA[301][1]) == "DP" and h.diterima(LAMA[301][1]) == 30000
          and h.status_bayar(LAMA[306][1]) == "Belum Lunas",
          {"dp": h.status_bayar(LAMA[301][1]), "belum": h.status_bayar(LAMA[306][1])})


# ---------------------------------------------------------------------------
# Bagian 1: produk saja wajib lunas
# ---------------------------------------------------------------------------
def tolak_produk(h, n, label, lines, user, dp=0, alasan=None):
    v = kunjungan(h, n)
    before = potret(h, v)
    err = h.gagal(posting(v, f"g-{n}", lines, user, dp=dp, alasan=alasan), user)
    catat(label, bool(err and "PRODUCT_ONLY_FULL_PAYMENT" in err) and potret(h, v) == before,
          (err or "DITERIMA: " + h.status_bayar(h.aktif(v))).strip().splitlines()[0])


def bagian_produk(h):
    tolak_produk(h, 401, "product-only-DP-STAFF-rejected-atomic", [produk()], STAFF, dp=30000)
    tolak_produk(h, 402, "product-only-with-default-zero-consult-row-rejected", [PLACEHOLDER, produk()], STAFF, dp=30000)
    tolak_produk(h, 403, "product-only-unpaid-FINANCE-override-rejected", [produk()], FINANCE, alasan="Uji fiktif")
    tolak_produk(h, 404, "product-only-DP-OWNER-rejected", [produk()], OWNER, dp=40000)

    v = kunjungan(h, 405)
    stock = h.angka(f"select qty from public.stock where item_id={q(ITEM)} and warehouse_id={q(r.WH)}")
    err = h.gagal(posting(v, "g-405", [PLACEHOLDER, produk()], STAFF, status="Lunas"), STAFF)
    inv = h.aktif(v)
    catat("product-only-full-cash-allowed", not err and h.status_bayar(inv) == "Lunas"
          and h.angka(f"select qty from public.stock where item_id={q(ITEM)} and warehouse_id={q(r.WH)}") == stock - 2
          and h.saldo_ref("1101", h.no_tagihan(inv)) == 50000
          and h.nilai(f"select status from public.visits where id={q(v)}") == "Selesai", err or "Lunas 50000 tunai")

    v = kunjungan(h, 406)
    parts = [{"method": "Tunai", "amount": 20000, "kas_code": "1101"},
             {"method": "Transfer", "amount": 30000, "kas_code": "1102"}]
    err = h.gagal(split_sql(v, "g-406", [produk()], STAFF, parts), STAFF)
    inv = h.aktif(v)
    no = h.no_tagihan(inv) if inv else ""
    catat("product-only-full-split-cash-transfer-allowed", not err and h.status_bayar(inv) == "Lunas"
          and h.saldo_ref("1101", no) == 20000 and h.saldo_ref("1102", no) == 30000 and h.saldo_ref("1201", no) == 0
          and h.angka(f"select count(*) from public.invoice_payments where invoice_id={q(inv)} and checkout_payment") == 2,
          (err or f"Lunas; 1101={h.saldo_ref('1101', no)} 1102={h.saldo_ref('1102', no)}").strip().splitlines()[0])

    for n, label, lines, kw in [
        (407, "product-plus-service-DP-still-allowed", [produk(), JASA], {"dp": 40000}),
        (409, "cashier-added-Tindakan-Persediaan-DP-still-allowed", [produk(), TINDAKAN], {"dp": 50000}),
        (413, "free-text-line-without-master-not-classified-product-only", [produk(), BEBAS], {"dp": 40000}),
    ]:
        v = kunjungan(h, n)
        err = h.gagal(posting(v, f"g-{n}", lines, STAFF, **kw), STAFF)
        catat(label, not err and h.status_bayar(h.aktif(v)) == "DP", (err or "DP tersimpan").strip().splitlines()[0])

    v = kunjungan(h, 408, rekam=True)
    err = h.gagal(posting(v, "g-408", [resep_produk(408)], STAFF, dp=30000), STAFF)
    catat("doctor-record-prescription-DP-still-allowed", not err and h.status_bayar(h.aktif(v)) == "DP",
          (err or "DP tersimpan").strip().splitlines()[0])

    v = kunjungan(h, 410, poli="Vaksinasi")
    err = h.gagal(posting(v, "g-410", [produk()], STAFF, dp=30000), STAFF)
    catat("vaccination-poli-not-classified-product-only", not err and h.status_bayar(h.aktif(v)) == "DP",
          (err or "DP tersimpan").strip().splitlines()[0])

    # DP lalu Rawat Inap (keputusan eksplisit, #345) tetap sah. Masuk rawat inap selalu
    # mensyaratkan rekam medis + dokter, jadi kunjungan seperti ini tidak pernah produk-saja.
    def dp_admit(n, lines, rekam):
        v = kunjungan(h, n, rekam=rekam)
        h.sql(f"""insert into public.consents(id,visit_id,template_id,tindakan,isi_snapshot)
          values ({q(uid('d', n))},{q(v)},{q(r.TEMPLATE_CONSENT)},'Fiktif','Fiktif');
          update public.consents set status='sudah_ttd',signer_name='Fiktif',
          signature_data='data:image/png;base64,ZmlrdGlm',signed_at=now() where id={q(uid('d', n))};""", OWNER)
        before = potret(h, v)
        sql = posting(v, f"g-{n}", lines, STAFF, dp=30000).replace(
            "clinic_post_invoice(", "clinic_post_dp_and_admit(").replace(");", ",'Penitipan fiktif','pet_hotel');")
        return v, before, h.gagal(sql, STAFF)
    v, _, err = dp_admit(411, [resep_produk(411)], True)
    catat("explicit-DP-and-admission-still-allowed", not err and h.status_bayar(h.aktif(v)) == "DP"
          and h.angka(f"select count(*) from public.inpatient_records where visit_id={q(v)}") == 1,
          (err or "DP + 1 rawat inap").strip().splitlines()[0])
    v, before, err = dp_admit(412, [produk()], False)
    catat("no-record-DP-admission-impossible-before-and-after-atomic", bool(err) and potret(h, v) == before
          and h.angka(f"select count(*) from public.inpatient_records where visit_id={q(v)}") == 0,
          (err or "DITERIMA").strip().splitlines()[0])

    # Replay permintaan lama (sebelum migrasi) tetap mengembalikan invoice yang sama.
    v, inv = LAMA[312]
    before = potret(h, v)
    out = h.nilai(posting(v, "lama-312", [produk()], STAFF, dp=30000), STAFF)
    catat("legacy-request-replay-returns-same-invoice", out == inv and potret(h, v) == before, out)
    err = h.gagal(posting(v, "lama-312-baru", [produk()], STAFF, dp=30000), STAFF)
    catat("legacy-DP-visit-no-second-invoice", bool(err and "INVOICE_EXISTS" in err) and potret(h, v) == before,
          (err or "invoice kedua diterima").strip().splitlines()[0])


# ---------------------------------------------------------------------------
# Bagian 2: pelunasan DP lama oleh kasir klinik
# ---------------------------------------------------------------------------
def bagian_pelunasan(h, db):
    # Baseline: writer kwitansi asli sudah bisa melunasi DP rawat jalan ke laci kasir.
    v, inv = LAMA[309]
    h.sql(r.bayar_sql(v, "base-309", [{"method": "Tunai", "amount": 20000}], invoice=inv), STAFF)
    catat("baseline-original-receipt-writer-settles-outpatient-DP", h.status_bayar(inv) == "Lunas"
          and h.nilai(f"select shift_id from public.clinic_payment_receipts where visit_id={q(v)}") == r.SHIFT[STAFF],
          "original clinic_receive_visit_payment, same invoice, receipt in cashier shift")
    # Baseline: writer asli memindahkan kelebihan ke saldo pemilik (2103) — alasan pembungkus
    # pelunasan memeriksa sisa di bawah kunci yang sama.
    v, inv = LAMA[310]
    h.sql(r.bayar_sql(v, "base-310", [{"method": "Tunai", "amount": 25000}], invoice=inv), STAFF)
    catat("baseline-original-writer-turns-excess-into-owner-credit",
          h.angka(f"select coalesce(sum(amount),0) from public.clinic_customer_advances where visit_id={q(v)}") == 5000,
          "excess 5000 becomes 2103 advance on the original writer")

    # Pelunasan campuran Tunai + Transfer pada invoice yang sama.
    v, inv = LAMA[301]
    no = h.no_tagihan(inv)
    stock = h.angka(f"select qty from public.stock where item_id={q(ITEM)} and warehouse_id={q(r.WH)}")
    moves = h.angka("select count(*) from public.stock_moves")
    hpp = h.angka(f"select count(*) from public.journal_entries where source='klinik-hpp' and source_ref={q(no)}")
    rev = h.saldo_ref("4201", no)
    parts = [{"method": "Tunai", "amount": 5000}, {"method": "Transfer", "amount": 15000}]
    err = h.gagal(lunasi_sql(v, inv, "lunas-301", parts, 20000), STAFF)
    rc = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={q(v)}")
    ok = (not err and h.status_bayar(inv) == "Lunas" and h.diterima(inv) == 50000 and h.aktif(v) == inv
          and h.angka(f"select count(*) from public.invoices where visit_id={q(v)}") == 1
          and h.nilai(f"select shift_id from public.clinic_payment_receipts where id={q(rc)}") == r.SHIFT[STAFF]
          and h.nilai(f"select created_by from public.clinic_payment_receipts where id={q(rc)}") == STAFF
          and h.angka(f"select count(*) from public.invoice_payments where invoice_id={q(inv)} and receipt_id={q(rc)}") == 2
          and h.saldo_ref("1101", no) == 35000 and h.saldo_ref("1102", no) == 15000 and h.saldo_ref("1201", no) == 0
          and h.saldo_ref("4201", no) == rev
          and h.angka(f"select qty from public.stock where item_id={q(ITEM)} and warehouse_id={q(r.WH)}") == stock
          and h.angka("select count(*) from public.stock_moves") == moves
          and h.angka(f"select count(*) from public.journal_entries where source='klinik-hpp' and source_ref={q(no)}") == hpp
          and h.angka(f"select count(*) from public.clinic_customer_advances where visit_id={q(v)}") == 0
          and h.nilai(f"select status from public.visits where id={q(v)}") == "Selesai")
    catat("settle-old-DP-split-same-invoice-drawer-accounts-no-stock-repeat", ok,
          (err or f"Lunas; kas 1101={h.saldo_ref('1101', no)} bank 1102={h.saldo_ref('1102', no)} AR={h.saldo_ref('1201', no)}").strip().splitlines()[0])
    before = potret(h, v)
    out = h.nilai(lunasi_sql(v, inv, "lunas-301", parts, 20000), STAFF) if not err else ""
    catat("settle-replay-same-key-no-new-money", not err and out == rc and potret(h, v) == before, out or err)
    err2 = h.gagal(lunasi_sql(v, inv, "lunas-301", [{"method": "Tunai", "amount": 20000}], 20000), STAFF)
    catat("settle-replay-changed-payload-conflict", bool(err2 and "IDEMPOTENCY_CONFLICT" in err2) and potret(h, v) == before,
          (err2 or "diterima").strip().splitlines()[0])
    err3 = h.gagal(lunasi_sql(v, inv, "lunas-301-lagi", [{"method": "Tunai", "amount": 1000}], 0), STAFF)
    catat("settle-paid-invoice-rejected", bool(err3 and "SETTLE_INVALID" in err3) and potret(h, v) == before,
          (err3 or "diterima").strip().splitlines()[0])

    # Bertahap: sebagian dulu, lalu sisanya; sisa benar setiap langkah.
    v, inv = LAMA[302]
    e1 = h.gagal(lunasi_sql(v, inv, "lunas-302-a", [{"method": "QRIS", "amount": 8000}], 20000), STAFF)
    s1 = sisa(h, inv)
    e2 = h.gagal(lunasi_sql(v, inv, "lunas-302-b", [{"method": "Tunai", "amount": 12000}], 12000), DOCTOR)
    catat("settle-partial-then-rest-remaining-correct", not e1 and not e2 and s1 == 12000 and sisa(h, inv) == 0
          and h.status_bayar(inv) == "Lunas"
          and h.angka(f"select count(*) from public.clinic_payment_receipts where visit_id={q(v)}") == 2,
          (e1 or e2 or f"sisa 20000 -> {s1} -> 0").strip().splitlines()[0])

    # Belum Lunas lama (override keuangan) dilunasi penuh oleh kasir klinik.
    v, inv = LAMA[306]
    err = h.gagal(lunasi_sql(v, inv, "lunas-306", [{"method": "Tunai", "amount": 50000}], 50000), STAFF)
    catat("settle-legacy-unpaid-full", not err and h.status_bayar(inv) == "Lunas", (err or "Lunas").strip().splitlines()[0])

    # Penolakan: tidak boleh ada efek uang sama sekali.
    v, inv = LAMA[307]
    cases = [
        ("over-remaining", STAFF, [{"method": "Tunai", "amount": 25000}], 20000, "PAYMENT_INVALID"),
        ("stale-expected-remaining", STAFF, [{"method": "Tunai", "amount": 10000}], 50000, "REMAINING_CHANGED"),
        ("missing-expected-remaining", STAFF, [{"method": "Tunai", "amount": 10000}], None, "REMAINING_CHANGED"),
        ("cross-branch-user", FIN_LUAR, [{"method": "Tunai", "amount": 20000}], 20000, "ACCESS_DENIED"),
        ("inactive-user", FIN_NONAKTIF, [{"method": "Tunai", "amount": 20000}], 20000, "ACCESS_DENIED"),
        ("role-without-clinic-module", FINANCE, [{"method": "Tunai", "amount": 20000}], 20000, "ACCESS_DENIED"),
        ("cashier-without-own-open-drawer", STAFF_TANPA_SHIFT, [{"method": "Tunai", "amount": 20000}], 20000, "SHIFT_INVALID"),
        ("non-integer-amount", STAFF, [{"method": "Tunai", "amount": 100.5}], 20000, "PAYMENT_INVALID"),
        ("unknown-method", STAFF, [{"method": "Cek", "amount": 20000}], 20000, "PAYMENT_INVALID"),
    ]
    for label, user, parts, expected, code in cases:
        before = potret(h, v)
        err = h.gagal(lunasi_sql(v, inv, f"neg-{label}", parts, expected), user)
        catat("settle-rejected-" + label, bool(err and code in err) and potret(h, v) == before and sisa(h, inv) == 20000,
              (err or "DITERIMA").strip().splitlines()[0])
    other, _ = LAMA[308]
    before = potret(h, v)
    err = h.gagal(lunasi_sql(other, inv, "neg-visit-mismatch", [{"method": "Tunai", "amount": 20000}], 20000), STAFF)
    catat("settle-rejected-invoice-of-other-visit", bool(err and "SETTLE_INVALID" in err) and potret(h, v) == before,
          (err or "DITERIMA").strip().splitlines()[0])
    # Periode tertutup dan rekening nonaktif: atomik.
    h.sql("update public.accounting_locks set closed_until=(now() at time zone 'Asia/Jakarta')::date where id;")
    before = potret(h, v)
    err = h.gagal(lunasi_sql(v, inv, "neg-period", [{"method": "Tunai", "amount": 20000}], 20000), STAFF)
    h.sql("update public.accounting_locks set closed_until=null where id;")
    catat("settle-rejected-closed-period-atomic", bool(err and ("ditutup" in err or "PERIOD" in err)) and potret(h, v) == before,
          (err or "DITERIMA").strip().splitlines()[0])
    h.sql("update public.cash_accounts set is_active=false where coa_code='1102';"
          "insert into public.payment_account_map(metode,branch_id,cash_account_id) "
          "select 'Transfer',null,id from public.cash_accounts where coa_code='1102' "
          "on conflict do nothing;")
    before = potret(h, v)
    err = h.gagal(lunasi_sql(v, inv, "neg-account", [{"method": "Tunai", "amount": 5000},
                                                      {"method": "Transfer", "amount": 15000}], 20000), STAFF)
    h.sql("update public.cash_accounts set is_active=true where coa_code='1102';")
    catat("settle-rejected-inactive-account-atomic", bool(err and "ACCOUNT_INVALID" in err) and potret(h, v) == before,
          (err or "DITERIMA").strip().splitlines()[0])
    err = h.gagal(lunasi_sql(v, inv, "pos-307", [{"method": "Transfer", "amount": 20000}], 20000), ADMIN)
    catat("settle-after-rejections-succeeds-once", not err and h.status_bayar(inv) == "Lunas" and h.diterima(inv) == 50000,
          (err or "Lunas").strip().splitlines()[0])

    # Lunas, void dan koreksi tertunda.
    v, inv = LAMA[305]
    before = potret(h, v)
    err = h.gagal(lunasi_sql(v, inv, "neg-lunas", [{"method": "Tunai", "amount": 1000}], 0), STAFF)
    catat("settle-rejected-legacy-paid-invoice", bool(err and "SETTLE_INVALID" in err) and potret(h, v) == before,
          (err or "DITERIMA").strip().splitlines()[0])
    v, inv = LAMA[304]
    h.sql(r.terbit_ulang_sql(inv, "void-304"), OWNER)
    baru = h.aktif(v)
    before = potret(h, v)
    err = h.gagal(lunasi_sql(v, inv, "neg-void", [{"method": "Tunai", "amount": 20000}], 20000), STAFF)
    catat("settle-rejected-voided-invoice", bool(err and "SETTLE_INVALID" in err) and potret(h, v) == before,
          (err or "DITERIMA").strip().splitlines()[0])
    pending = h.nilai(f"select correction_pending from public.invoices where id={q(baru)}")
    err = h.gagal(lunasi_sql(v, baru, "neg-pending", [{"method": "Tunai", "amount": 20000}], sisa(h, baru)), STAFF)
    catat("settle-rejected-correction-pending", pending == "t" and bool(err and "SETTLE_INVALID" in err) and potret(h, v) == before,
          (err or f"DITERIMA pending={pending}").strip().splitlines()[0])

    # Tagihan rawat inap tetap lewat layar Tagihan rawat inap.
    cust = r.buat_pelanggan(h, 320)
    vr = r.buat_kunjungan(h, 320, cust)
    h.sql(r.tagih_sql(vr, "stage-320", r.baris(320, 1), OWNER, alasan="Uji fiktif"), OWNER)
    ir = h.aktif(vr)
    before = potret(h, vr)
    err = h.gagal(lunasi_sql(vr, ir, "neg-ranap", [{"method": "Tunai", "amount": 10000}], sisa(h, ir)), STAFF)
    catat("settle-rejected-inpatient-uses-ward-screen", bool(err and "STAGE_RECEIPT" in err) and potret(h, vr) == before,
          (err or "DITERIMA").strip().splitlines()[0])

    # Dua kasir bersamaan atas sisa yang sama: hanya satu yang masuk, tanpa saldo pemilik.
    v, inv = LAMA[303]
    evidence = []
    with contextlib.ExitStack() as stack:
        observer = stack.enter_context(c.Session(db, "settle-observer"))
        first = stack.enter_context(c.Session(db, "settle-first", STAFF))
        second = stack.enter_context(c.Session(db, "settle-second", OWNER))
        first.sql("begin; " + lunasi_sql(v, inv, "race-a", [{"method": "Tunai", "amount": 20000}], 20000))
        second.send("begin; " + lunasi_sql(v, inv, "race-b", [{"method": "Transfer", "amount": 20000}], 20000))
        c.wait_block(observer, second, first, evidence)
        first.sql("commit;")
        outcome = c.attempt(second)
    catat("concurrent-settlement-single-receipt-no-overpay", not outcome["ok"] and "SETTLE_INVALID" in outcome.get("error", "")
          and len(evidence) == 1 and h.diterima(inv) == 50000 and h.status_bayar(inv) == "Lunas"
          and h.angka(f"select count(*) from public.clinic_payment_receipts where visit_id={q(v)}") == 1
          and h.angka(f"select count(*) from public.clinic_customer_advances where visit_id={q(v)}") == 0,
          {"barrier": len(evidence), "second": outcome.get("error", "ok")[:160]})

    # Sisa berubah (pelunasan sebagian) selama kasir kedua menunggu kunci.
    v, inv = LAMA[311]
    evidence = []
    with contextlib.ExitStack() as stack:
        observer = stack.enter_context(c.Session(db, "change-observer"))
        first = stack.enter_context(c.Session(db, "change-first", ADMIN))
        second = stack.enter_context(c.Session(db, "change-second", STAFF))
        first.sql("begin; " + lunasi_sql(v, inv, "chg-a", [{"method": "Tunai", "amount": 5000}], 20000))
        second.send("begin; " + lunasi_sql(v, inv, "chg-b", [{"method": "Tunai", "amount": 20000}], 20000))
        c.wait_block(observer, second, first, evidence)
        first.sql("commit;")
        outcome = c.attempt(second)
    catat("concurrent-remaining-change-rejects-stale-cashier", not outcome["ok"] and "REMAINING_CHANGED" in outcome.get("error", "")
          and len(evidence) == 1 and sisa(h, inv) == 15000 and h.status_bayar(inv) == "DP"
          and h.angka(f"select count(*) from public.clinic_customer_advances where visit_id={q(v)}") == 0,
          {"barrier": len(evidence), "remaining": sisa(h, inv), "second": outcome.get("error", "ok")[:160]})

    catat("all-journals-balanced", h.angka("select count(*) from (select entry_id from public.journal_lines group by entry_id "
                                          "having sum(debit)<>sum(credit)) x") == 0, "per-entry debit=credit")


def siapkan(stack):
    tmp = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="kamo-produk-lunas-")))
    tujuan = tmp / "supabase/migrations"
    tujuan.mkdir(parents=True)
    for sumber in (ROOT / "supabase/migrations").glob("*.sql"):
        if sumber.name != MIGRASI:
            (tujuan / sumber.name).symlink_to(sumber)
    return tmp


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--red", action="store_true", help="jangan pasang migrasi kandidat (bukti RED)")
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    with contextlib.ExitStack() as stack:
        r.fixture.ROOT = siapkan(stack)
        db = stack.enter_context(r.NativePostgres(r.BIN))
        r.fixture.DisposablePostgres.bootstrap(db)
        h = r.Harness(db)
        try:
            h.sql(r.dasar_sql())
            fixture_tambahan(h)
            data_lama(h)
            if not args.red:
                db.sql("begin;\n" + (ROOT / "supabase/migrations" / MIGRASI).read_text() + "\ncommit;")
                print("Applied candidate migration " + MIGRASI, flush=True)
            for bagian in (lambda: bagian_produk(h), lambda: bagian_pelunasan(h, db)):
                try:
                    bagian()
                except Exception as error:  # noqa: BLE001 - one broken section must not hide the other
                    catat("HARNESS-SECTION", False, str(error).strip().splitlines()[0][:300])
        except Exception as error:  # noqa: BLE001
            catat("HARNESS", False, str(error).strip().splitlines()[0][:300])
        migrations = len(list((r.fixture.ROOT / "supabase/migrations").glob("*.sql"))) + (0 if args.red else 1)
    totals = {s: sum(x["status"] == s for x in HASIL) for s in ("PASS", "FAIL")}
    mode = "RED (tanpa migrasi kandidat)" if args.red else "GREEN (dengan migrasi kandidat)"
    print(f"TOTAL {mode} migrations={migrations} pass={totals['PASS']} fail={totals['FAIL']}", flush=True)
    if args.json:
        args.json.write_text(json.dumps({"mode": "red" if args.red else "green", "migrations": migrations,
                                         "total": totals, "cases": HASIL}, indent=2, ensure_ascii=False))
    return 1 if totals["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
