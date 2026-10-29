#!/usr/bin/env python3
"""Regresi SIKLUS PENUH mitigasi tagihan berjalan rawat inap — fungsi uang yang ASLI.

Bedanya dengan scripts/test-ranap-mitigasi-postgres.py: di sana babak B/C memakai
rangka tiruan (STUB_*) sehingga penjaga asli tidak ikut diuji. Harness ini TIDAK
memakai satu pun stub bisnis. Ia:

  * memasang SELURUH migrasi repositori (urut nama berkas) ke klaster PostgreSQL
    lokal sekali pakai — skema, trigger, RLS, jurnal, stok/FIFO/HPP yang sebenarnya;
  * memanggil RPC PUBLIK yang benar-benar dipakai aplikasi, sebagai peran
    `authenticated` dengan klaim JWT milik pengguna fiktif (bukan sebagai pemilik
    basis data, bukan lewat _core);
  * memakai hanya tabel sebenarnya (`journal_entries`/`journal_lines`,
    `invoice_payments`, `clinic_payment_receipt_parts`, `stock_layers`, ...).

Satu-satunya yang dipalsukan adalah platform Supabase (skema `auth`/`storage`,
`auth.uid()`), persis seperti harness repositori lain; tidak ada penjaga bisnis
yang diganti.

Mode:
  --pra-perbaikan   migrasi mitigasi diambil dari `git show 5fc24c78:<berkas>` (override: KAMO_RED_REVISION) (bukti RED)
  (default)         migrasi mitigasi dari pohon kerja (bukti GREEN)

Seluruh fixture fiktif: pemilik "Fiktif", telepon 0800000xxxx, tanpa identitas pasien
nyata. Tidak menerima URL basis data, tidak menyentuh jaringan atau Production.

Keluar 0 hanya bila semua kasus PASS.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
BIN = os.environ.get("KAMO_PG_BIN", "/opt/data/kamo-pg-harness/bin")
MITIGASI = "20261103010000_ranap_mitigasi_audit.sql"

spec = importlib.util.spec_from_file_location("fixture", ROOT / "scripts/test-accurate-inventory-accounting-postgres.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
sys.path.insert(0, str(ROOT / "scripts"))
from native_postgres import NativePostgres  # noqa: E402

HASIL = []

P = "fa"


def uid(group, n):
    return f"{P}{group}00000-0000-4000-8000-{n:012d}"


OWNER, ADMIN, FINANCE, STAFF, DOCTOR, FIN_NONAKTIF, FIN_LUAR = (uid(1, i) for i in range(1, 8))
PERAN = {OWNER: "OWNER", ADMIN: "ADMIN", FINANCE: "FINANCE", STAFF: "STAFF",
         DOCTOR: "DOCTOR", FIN_NONAKTIF: "FINANCE", FIN_LUAR: "FINANCE"}
SHIFT = {u: uid("b", i + 1) for i, u in enumerate([OWNER, ADMIN, FINANCE, STAFF, DOCTOR, FIN_NONAKTIF, FIN_LUAR])}
BRANCH, BRANCH2 = uid(2, 1), uid(2, 2)
WH = uid(3, 1)
ITEM = uid(8, 1)
DOKTER_PEGAWAI = uid("a", 1)
TEMPLATE_CONSENT = uid("c", 1)
TGL = "2026-11-03"

# IND yang dipertaruhkan tiap kasus; dipakai laporan RED/GREEN.
BLOKIR = {}


def catat(kasus, ok, detail, ind=None):
    status = "PASS" if ok else "FAIL"
    HASIL.append({"kasus": kasus, "status": status, "ind": ind, "detail": detail})
    if ind:
        BLOKIR[kasus] = ind
    print(f"{status:5} {kasus}: {detail}", flush=True)
    return ok


def q(value):
    return "'" + str(value).replace("'", "''") + "'"


def j(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


class Harness:
    def __init__(self, db):
        self.db = db

    def sql(self, source, user=None):
        """Satu transaksi psql tersendiri; `user` menjalankannya sebagai authenticated."""
        if user is None:
            return self.db.sql(source)
        awal = ("set role authenticated;\n"
                "select set_config('request.jwt.claim.role','authenticated',false);\n"
                f"select set_config('request.jwt.claim.sub',{q(user)},false);\n")
        return self.db.sql(awal + source)

    def sistem(self, source, user=OWNER):
        """Penyiapan fixture yang di aplikasi datang dari layar lain: klaim JWT diisi,
        peran basis data tetap pemilik supaya RLS tabel tidak menghalangi penyiapan.
        Tidak pernah dipakai untuk memanggil RPC uang yang sedang diuji."""
        return self.db.sql(
            "select set_config('request.jwt.claim.role','authenticated',false);\n"
            f"select set_config('request.jwt.claim.sub',{q(user)},false);\n" + source)

    def nilai(self, source, user=None):
        out = self.sql(source, user)
        return out.splitlines()[-1] if out else ""

    def angka(self, source, user=None):
        teks = self.nilai(source, user)
        return float(teks) if teks not in ("", None) else 0.0

    def gagal(self, source, user=None):
        """None bila sukses, pesan galat bila ditolak."""
        try:
            self.sql(source, user)
            return None
        except RuntimeError as error:
            return str(error)

    # --- pembacaan ringkas -------------------------------------------------
    def saldo(self, code):
        return self.angka(
            "select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l "
            "join public.journal_entries e on e.id=l.entry_id "
            f"join public.coa_accounts a on a.id=l.account_id where a.code={q(code)}")

    def saldo_semua(self, *codes):
        return {c: self.saldo(c) for c in codes}

    def diterima(self, invoice):
        return self.angka(
            f"select coalesce((select dp_amount from public.invoices where id={q(invoice)}),0)"
            f"+coalesce((select sum(amount) from public.invoice_payments where invoice_id={q(invoice)}),0)")

    def status_bayar(self, invoice):
        return self.nilai(f"select paid_status from public.invoices where id={q(invoice)}")

    def aktif(self, visit):
        return self.nilai(
            f"select id from public.invoices where visit_id={q(visit)} and voided_at is null "
            "order by created_at, id limit 1")


# ---------------------------------------------------------------------------
# Fixture fiktif
# ---------------------------------------------------------------------------
def dasar_sql():
    users = ",".join(
        f"({q(u)},'{{\"full_name\":\"Pengguna Fiktif {i}\"}}')"
        for i, u in enumerate([OWNER, ADMIN, FINANCE, STAFF, DOCTOR, FIN_NONAKTIF, FIN_LUAR], start=1))
    peran = "\n".join(f"update public.profiles set role={q(r)} where id={q(u)};" for u, r in PERAN.items())
    cabang = ",".join(f"({q(u)},{q(BRANCH)})" for u in [OWNER, ADMIN, FINANCE, STAFF, DOCTOR, FIN_NONAKTIF])
    shifts = ",".join(
        f"({q(SHIFT[u])},{q(BRANCH)},{q(u)},'klinik','open')"
        for u in [OWNER, ADMIN, FINANCE, STAFF, DOCTOR, FIN_NONAKTIF, FIN_LUAR])
    return f"""
insert into public.coa_accounts (code,name,type,normal_balance,is_active,is_header) values
 ('1101','Kas Fiktif','ASET','D',true,false),('1102','Bank Fiktif','ASET','D',true,false),
 ('1201','Piutang Fiktif','ASET','D',true,false),('1301','Persediaan Fiktif','ASET','D',true,false),
 ('2103','Uang Muka Penjualan Fiktif','LIABILITAS','K',true,false),
 ('2201','PPN Keluaran Fiktif','LIABILITAS','K',true,false),
 ('4102','Diskon Penjualan Fiktif','PENDAPATAN','D',true,false),
 ('4201','Pendapatan Klinik Fiktif','PENDAPATAN','K',true,false),
 ('5101','HPP Fiktif','BEBAN','D',true,false)
on conflict (code) do update set is_active=true, is_header=false;
insert into auth.users (id, raw_user_meta_data) values {users};
{peran}
update public.profiles set is_active=false where id={q(FIN_NONAKTIF)};
insert into public.branches (id,code,name,type) values
 ({q(BRANCH)},'FA-RANAP','Klinik Fiktif Ranap','KLINIK'),
 ({q(BRANCH2)},'FA-LAIN','Klinik Fiktif Lain','KLINIK');
insert into public.user_branches (user_id,branch_id) values {cabang};
insert into public.user_branches (user_id,branch_id) values ({q(FIN_LUAR)},{q(BRANCH2)});
insert into public.role_capabilities (role,all_branches,create_accounts) values
 ('ADMIN',false,true),('FINANCE',false,false);
insert into public.employees (id,nama,jabatan,branch_id,status)
 values ({q(DOKTER_PEGAWAI)},'Dokter Hewan Fiktif','Dokter Hewan',{q(BRANCH)},'Aktif');
insert into public.warehouses (id,branch_id,code,name,type)
 values ({q(WH)},{q(BRANCH)},'FA-WH','Gudang Fiktif','VET');
insert into public.items (id,code,name,unit,buy_price,item_type,is_active,is_compound_material)
 values ({q(ITEM)},'FA-OBAT','Obat Fiktif','pcs',2000,'Persediaan',true,false);
insert into public.stock (warehouse_id,item_id,qty) values ({q(WH)},{q(ITEM)},200);
insert into public.stock_layers (warehouse_id,item_id,tanggal,qty_in,qty_left,unit_cost,source)
 values ({q(WH)},{q(ITEM)},current_date,200,200,2000,'purchase');
insert into public.cash_accounts (nama,jenis,coa_code) values ('Kas Klinik Fiktif','Kas','1101')
 on conflict (coa_code) do update set is_active=true;
insert into public.cashier_shifts (id,branch_id,opened_by,shift_type,status) values {shifts};
insert into public.consent_templates (id,nama,isi,kategori,is_active)
 values ({q(TEMPLATE_CONSENT)},'Persetujuan Rawat Inap Fiktif','Isi persetujuan fiktif','Rawat Inap',true);
insert into public.consent_rules (kategori,wajib,template_id)
 values ('Rawat Inap',true,{q(TEMPLATE_CONSENT)})
 on conflict (kategori) do update set wajib=true, template_id=excluded.template_id;
"""


def buat_kunjungan(h, n, customer, admitted=True):
    """Satu kunjungan rawat inap fiktif + baris resep siap tagih."""
    visit, mr, pet = uid(6, n), uid(7, n), uid(5, n)
    # Satu pasien hidup per hewan: tiap kunjungan memakai hewan sendiri, pemilik sama.
    h.sql(f"""
insert into public.pets (id,customer_id,name) values ({q(pet)},{q(customer['id'])},'Pasien Fiktif {n}');
insert into public.visits (id,branch_id,customer_id,pet_id,status,doctor_id)
 values ({q(visit)},{q(BRANCH)},{q(customer['id'])},{q(pet)},'Diperiksa',{q(DOKTER_PEGAWAI)});
insert into public.medical_records (id,visit_id) values ({q(mr)},{q(visit)});
insert into public.prescription_items (id,medical_record_id,nama_obat,qty,harga,satuan,jenis,kategori,faktor)
 values ({q(uid(9, n * 10 + 1))},{q(mr)},'Jasa Rawat Inap Fiktif',1,100000,'hari','jasa','Rawat Inap',1),
        ({q(uid(9, n * 10 + 2))},{q(mr)},'Jasa Perawatan Fiktif',1,120000,'kali','jasa','Tindakan',1),
        ({q(uid(9, n * 10 + 4))},{q(mr)},'Jasa Tambahan Fiktif',1,60000,'kali','jasa','Tindakan',1);
insert into public.prescription_items (id,medical_record_id,nama_obat,qty,harga,satuan,jenis,kategori,item_id,faktor)
 values ({q(uid(9, n * 10 + 3))},{q(mr)},'Obat Fiktif',2,25000,'pcs','obat','Obat',{q(ITEM)},1);
""")
    if admitted:
        # Persetujuan khusus rawat inap dan masuk rawat inap lewat RPC yang sebenarnya.
        h.sql(f"""
insert into public.consents (id,visit_id,template_id,tindakan,isi_snapshot)
 values ({q(uid('d', n))},{q(visit)},{q(TEMPLATE_CONSENT)},'Rawat Inap Fiktif','Isi persetujuan fiktif');
update public.consents set status='sudah_ttd', signer_name='Pemilik Fiktif',
 signature_data='data:image/png;base64,ZmlrdGlm', signed_at=now() where id={q(uid('d', n))};
""", OWNER)
        h.sql(f"select public.clinic_admit_inpatient({q(visit)},'Rencana rawat inap fiktif',"
              f"'masuk-{n}');", OWNER)
    return visit


def buat_pelanggan(h, n):
    cust = uid(4, n)
    h.sql(f"insert into public.customers (id,name,phone) values "
          f"({q(cust)},'Pemilik Fiktif {n}','0800000{n:04d}');")
    return {"id": cust}


def pulangkan(h, visit):
    # Kepulangan setelah tagihan terbit tidak lagi bisa lewat RPC kondisi (INVOICE_EXISTS),
    # jadi keadaan "sudah pulang" disiapkan langsung — yang diuji koreksinya, bukan ini.
    h.sistem(f"update public.inpatient_records set discharged_at=now(), condition_status='sembuh'"
             f" where visit_id={q(visit)};")


# ---------------------------------------------------------------------------
# Pemanggilan RPC publik, persis seperti aksi server memanggilnya
# ---------------------------------------------------------------------------
BARIS = {
    1: ("Jasa Rawat Inap Fiktif", 1, 100000, "jasa", None, "hari"),
    2: ("Jasa Perawatan Fiktif", 1, 120000, "jasa", None, "kali"),
    3: ("Obat Fiktif", 2, 25000, "obat", ITEM, "pcs"),
    4: ("Jasa Tambahan Fiktif", 1, 60000, "jasa", None, "kali"),
}


def baris(n, *slots, ulang=1):
    out = []
    for s in slots:
        nama, qty, harga, kind, item, unit = BARIS[s]
        for _ in range(ulang):
            out.append({"description": nama, "qty": qty, "price": harga, "kind": kind,
                        "item_id": item, "unit": unit,
                        "prescription_item_id": uid(9, n * 10 + s), "recipe_id": None,
                        "discount_percent": 0})
    return out


def nilai_baris(lines):
    return sum(int(round(b["qty"] * b["price"] * (1 - b["discount_percent"] / 100))) for b in lines)


def tagih_sql(visit, key, lines, user, alasan=None, ganti=None):
    """clinic_post_inpatient_stage_invoice persis seperti tagihSekarang() memanggilnya."""
    subtotal = nilai_baris(lines)
    invoice = {"tanggal": TGL, "subtotal": subtotal, "discount": 0, "tax": 0, "total": subtotal,
               "dp_amount": 0, "dp_date": None, "paid_status": "Belum Lunas",
               "metode_bayar": "Tunai", "shift_id": SHIFT[user], "voucher_code": None,
               "salesperson_id": None}
    if alasan:
        invoice["dp_override_reason"] = alasan
    if ganti:
        invoice.update(ganti)
    return (f"select public.clinic_post_inpatient_stage_invoice({q(visit)},{q(key)},"
            f"{j(invoice)},{j(lines)});")


def bayar_sql(visit, key, parts, invoice=None, catatan=None):
    return (f"select public.clinic_receive_visit_payment({q(visit)},{q(key)},{q(TGL)}::date,"
            f"{j(parts)},{'null' if invoice is None else q(invoice)}::uuid,"
            f"{'null' if catatan is None else q(catatan)});")


def batal_kwitansi_sql(receipt, key, alasan="Uji pembatalan fiktif"):
    return f"select public.clinic_void_payment_receipt({q(receipt)},{q(key)},{q(alasan)});"


def lepas_sql(advance, key, alasan="Koreksi tagihan fiktif"):
    return f"select public.clinic_release_advance_application({q(advance)},{q(key)},{q(alasan)});"


def terbit_ulang_sql(invoice, key, alasan="Koreksi fiktif"):
    return f"select public.clinic_void_reissue_invoice({q(invoice)},{q(key)},{q(alasan)});"


def koreksi_sql(h, invoice, key, lines, alasan="Koreksi fiktif", paid_status=None):
    """clinic_edit_invoice persis seperti simpanPembayaran() memanggilnya untuk koreksi."""
    subtotal = nilai_baris(lines)
    dp = h.angka(f"select dp_amount from public.invoices where id={q(invoice)}")
    kredit = h.angka(f"select coalesce(sum(amount),0) from public.invoice_payments where invoice_id={q(invoice)}")
    metode = h.nilai(f"select metode_bayar from public.invoices where id={q(invoice)}")
    if paid_status is None:
        paid_status = ("Lunas" if subtotal == dp + kredit else "DP" if dp + kredit > 0 else "Belum Lunas")
    payload = {"subtotal": subtotal, "discount": 0, "tax": 0, "total": subtotal,
               "dp_amount": dp, "paid_status": paid_status, "metode_bayar": metode,
               "voucher_code": None, "reason": alasan}
    return f"select public.clinic_edit_invoice({q(invoice)},{q(key)},{j(payload)},{j(lines)});"


# ---------------------------------------------------------------------------
# IND-01 — sisa uang muka setelah terbit ulang
# ---------------------------------------------------------------------------
def ind01(h, n, cust, reissues, parts, label):
    visit = buat_kunjungan(h, n, cust)
    lines = baris(n, 1)                      # Jasa 100.000
    h.sql(tagih_sql(visit, f"k{n}-tagih", lines, OWNER, alasan="Uji fiktif DP"), OWNER)
    inv1 = h.aktif(visit)
    h.sql(bayar_sql(visit, f"k{n}-bayar", parts), OWNER)
    receipt = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={q(visit)}")
    advance = h.nilai(f"select id from public.clinic_customer_advances where receipt_id={q(receipt)}")
    sisa_muka = h.angka(f"select amount from public.clinic_customer_advances where id={q(advance)}")

    aktif = inv1
    for r in range(reissues):
        h.sql(terbit_ulang_sql(aktif, f"k{n}-ulang{r}"), FINANCE)
        aktif = h.aktif(visit)
        h.sql(koreksi_sql(h, aktif, f"k{n}-koreksi{r}", lines), FINANCE)

    sebelum = h.saldo_semua("1101", "1102", "1201", "2103")
    galat = h.gagal(batal_kwitansi_sql(receipt, f"k{n}-batal"), FINANCE)
    if galat:
        return catat(f"IND01-{label}", False, f"pembatalan kwitansi ditolak: {galat.strip().splitlines()[0]}", "IND-01")
    sesudah = h.saldo_semua("1101", "1102", "1201", "2103")

    total_kwitansi = sum(p["amount"] for p in parts)
    per_akun = {}
    for p in parts:
        kode = "1101" if p["method"] == "Tunai" else "1102"
        per_akun[kode] = per_akun.get(kode, 0) + p["amount"]
    kas_ok = all(round(sebelum[k] - sesudah[k], 2) == v for k, v in per_akun.items())
    piutang = round(sesudah["1201"] - sebelum["1201"], 2)
    muka = round(sesudah["2103"] - sebelum["2103"], 2)
    aktif_id = h.aktif(visit)
    terima = h.diterima(aktif_id)
    status = h.status_bayar(aktif_id)
    kwitansi_status = h.nilai(f"select status from public.clinic_payment_receipts where id={q(receipt)}")
    pembalik = h.angka(f"select count(*) from public.invoice_payments where receipt_id={q(receipt)} and amount<0")
    # Diulang dengan kunci yang sama tidak boleh membalik dua kali.
    h.sql(batal_kwitansi_sql(receipt, f"k{n}-batal"), FINANCE)
    pembalik2 = h.angka(f"select count(*) from public.invoice_payments where receipt_id={q(receipt)} and amount<0")

    ok = (kas_ok and piutang == total_kwitansi - sisa_muka and muka == sisa_muka
          and terima == 0 and status == "Belum Lunas" and kwitansi_status == "batal"
          and pembalik == pembalik2)
    return catat(f"IND01-{label}", ok,
                 f"kas={per_akun} terbalik={ {k: round(sebelum[k]-sesudah[k],2) for k in per_akun} } "
                 f"piutang debit {piutang} uang muka debit {muka} (sisa {sisa_muka}) diterima={terima} "
                 f"status={status} kwitansi={kwitansi_status} pembalik={pembalik}/{pembalik2}",
                 "IND-01")


# ---------------------------------------------------------------------------
# IND-02 — uang muka yang sudah dilepas tidak boleh dipakai ulang diam-diam
# ---------------------------------------------------------------------------
def ind02(h, n, cust):
    visit = buat_kunjungan(h, n, cust)
    h.sql(bayar_sql(visit, f"k{n}-bayar", [{"method": "Tunai", "amount": 150000}]), OWNER)
    receipt = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={q(visit)}")
    advance = h.nilai(f"select id from public.clinic_customer_advances where receipt_id={q(receipt)}")

    h.sql(tagih_sql(visit, f"k{n}-tahapA", baris(n, 1), STAFF), STAFF)   # 100.000, uang muka menutup
    inv_a = h.aktif(visit)
    dipakai = h.angka(f"select applied from public.clinic_customer_advances where id={q(advance)}")

    hasil = h.nilai(lepas_sql(advance, f"k{n}-lepas1"), FINANCE)
    dipakai2 = h.angka(f"select applied from public.clinic_customer_advances where id={q(advance)}")
    ok_lepas = hasil == "1" and dipakai == 100000 and dipakai2 == 0
    catat("IND02-lepas", ok_lepas, f"dilepas={hasil} applied {dipakai}->{dipakai2}", "IND-02")

    # Ulangi dengan kunci sama: tidak boleh membalik dua kali.
    ulang = h.nilai(lepas_sql(advance, f"k{n}-lepas1"), FINANCE)
    pembalik = h.angka("select count(*) from public.invoice_payments p "
                       f"where p.invoice_id={q(inv_a)} and p.amount<0")
    catat("IND02-ulangi-kunci", ulang == "1" and pembalik == 1,
          f"ulangi={ulang} pembalik={pembalik}", "IND-02")

    # Tahap B SEBELUM kwitansi dibatalkan: saldo yang sudah dilepas tidak boleh dipakai lagi.
    h.sql(tagih_sql(visit, f"k{n}-tahapB", baris(n, 2), FINANCE, alasan="Uji fiktif DP"), FINANCE)
    inv_b = h.nilai(f"select id from public.invoices where visit_id={q(visit)} and voided_at is null"
                    f" and id<>{q(inv_a)} order by created_at desc limit 1")
    dipakai3 = h.angka(f"select applied from public.clinic_customer_advances where id={q(advance)}")
    terima_b = h.diterima(inv_b)
    catat("IND02-tahap-berikutnya", dipakai3 == 0 and terima_b == 0,
          f"applied={dipakai3} diterima tahap B={terima_b}", "IND-02")

    # Kunjungan lain milik pemilik yang sama, cabang sama.
    visit2 = buat_kunjungan(h, n + 1, cust)
    h.sql(tagih_sql(visit2, f"k{n}-lain", baris(n + 1, 1), FINANCE, alasan="Uji fiktif DP"), FINANCE)
    dipakai4 = h.angka(f"select applied from public.clinic_customer_advances where id={q(advance)}")
    catat("IND02-kunjungan-lain", dipakai4 == 0, f"applied={dipakai4}", "IND-02")

    # Jalan keluarnya tetap ada: kwitansinya bisa dibatalkan, uang pemilik kembali.
    sebelum = h.saldo_semua("1101", "2103")
    galat = h.gagal(batal_kwitansi_sql(receipt, f"k{n}-batal"), FINANCE)
    sesudah = h.saldo_semua("1101", "2103")
    ok = (galat is None and round(sebelum["1101"] - sesudah["1101"], 2) == 150000
          and round(sesudah["2103"] - sebelum["2103"], 2) == 150000)
    catat("IND02-batal-setelah-lepas", ok,
          f"galat={None if galat is None else galat.strip().splitlines()[0]} "
          f"kas kredit {round(sebelum['1101']-sesudah['1101'],2)} "
          f"uang muka debit {round(sesudah['2103']-sebelum['2103'],2)}",
          "IND-02")


# ---------------------------------------------------------------------------
# IND-03 — koreksi tagihan dengan riwayat pembayaran nol-bersih
# ---------------------------------------------------------------------------
def ind03(h, n, cust, pulang, label):
    visit = buat_kunjungan(h, n, cust)
    h.sql(bayar_sql(visit, f"k{n}-bayar", [{"method": "Tunai", "amount": 150000}]), OWNER)
    receipt = h.nilai(f"select id from public.clinic_payment_receipts where visit_id={q(visit)}")
    advance = h.nilai(f"select id from public.clinic_customer_advances where receipt_id={q(receipt)}")
    h.sql(tagih_sql(visit, f"k{n}-tahap", baris(n, 1), STAFF), STAFF)
    inv = h.aktif(visit)
    h.sql(lepas_sql(advance, f"k{n}-lepas"), FINANCE)
    h.sql(batal_kwitansi_sql(receipt, f"k{n}-batal"), FINANCE)
    if pulang:
        pulangkan(h, visit)

    riwayat = h.angka(f"select count(*) from public.invoice_payments where invoice_id={q(inv)}")
    bersih = h.diterima(inv)
    # Terbit ulang memang BUKAN jalurnya: tagihan tanpa uang cukup dikoreksi.
    tolak_ulang = h.gagal(terbit_ulang_sql(inv, f"k{n}-ulang"), FINANCE)
    catat(f"IND03-{label}-terbit-ulang-ditolak", bool(tolak_ulang) and "cukup dikoreksi" in str(tolak_ulang),
          f"{str(tolak_ulang).strip().splitlines()[0] if tolak_ulang else 'DITERIMA'}", "IND-03")

    sebelum_lines = h.angka(f"select count(*) from public.invoice_items where invoice_id={q(inv)}")
    stok_awal = h.angka(f"select qty from public.stock where warehouse_id={q(WH)} and item_id={q(ITEM)}")
    # Peran non-keuangan tidak boleh memakai jalan keluar ini.
    tolak_staf = h.gagal(koreksi_sql(h, inv, f"k{n}-koreksi-staf", baris(n, 1, 3)), STAFF)
    catat(f"IND03-{label}-staf-ditolak", bool(tolak_staf) and "ACCESS_DENIED" in str(tolak_staf),
          f"{str(tolak_staf).strip().splitlines()[0] if tolak_staf else 'DITERIMA'}", "IND-05")

    galat = h.gagal(koreksi_sql(h, inv, f"k{n}-koreksi", baris(n, 1, 3)), FINANCE)
    if galat:
        return catat(f"IND03-{label}", False,
                     f"koreksi ditolak: {galat.strip().splitlines()[0]}", "IND-03")
    sesudah_lines = h.angka(f"select count(*) from public.invoice_items where invoice_id={q(inv)}")
    stok_akhir = h.angka(f"select qty from public.stock where warehouse_id={q(WH)} and item_id={q(ITEM)}")
    hpp = h.angka("select coalesce(sum(l.debit-l.credit),0) from public.journal_lines l "
                  "join public.journal_entries e on e.id=l.entry_id "
                  "join public.coa_accounts a on a.id=l.account_id "
                  f"where a.code='5101' and e.source_ref=(select invoice_no from public.invoices where id={q(inv)})")
    riwayat2 = h.angka(f"select count(*) from public.invoice_payments where invoice_id={q(inv)}")
    total = h.angka(f"select total from public.invoices where id={q(inv)}")
    # Idempoten: kunci yang sama mengembalikan hasil yang sama tanpa menggandakan apa pun.
    h.sql(koreksi_sql(h, inv, f"k{n}-koreksi", baris(n, 1, 3)), FINANCE)
    lines3 = h.angka(f"select count(*) from public.invoice_items where invoice_id={q(inv)}")

    ok = (sebelum_lines == 1 and sesudah_lines == 2 and lines3 == 2
          and stok_awal - stok_akhir == 2 and hpp == 4000
          and riwayat == 2 and riwayat2 == 2 and bersih == 0 and total == 150000
          and h.status_bayar(inv) == "Belum Lunas")
    return catat(f"IND03-{label}", ok,
                 f"baris {sebelum_lines}->{sesudah_lines}(ulang {lines3}) stok-{stok_awal-stok_akhir} "
                 f"hpp={hpp} riwayat={riwayat}/{riwayat2} total={total} status={h.status_bayar(inv)}",
                 "IND-03")


def ind03_negatif(h, n, cust):
    """Riwayat pembayaran yang BELUM dikompensasi tetap harus menolak koreksi."""
    visit = buat_kunjungan(h, n, cust)
    h.sql(tagih_sql(visit, f"k{n}-tahap", baris(n, 1), OWNER, alasan="Uji fiktif DP"), OWNER)
    inv = h.aktif(visit)
    h.sql(bayar_sql(visit, f"k{n}-bayar", [{"method": "Tunai", "amount": 60000}]), OWNER)
    galat = h.gagal(koreksi_sql(h, inv, f"k{n}-koreksi", baris(n, 1, 3)), FINANCE)
    catat("IND03-uang-belum-dibalik-ditolak", bool(galat) and "INVOICE_INVALID" in str(galat),
          f"{str(galat).strip().splitlines()[0] if galat else 'DITERIMA'}", "IND-03")

    # Koreksi biasa (tagihan tanpa pembayaran sama sekali) tetap terbuka untuk kasir.
    visit2 = buat_kunjungan(h, n + 1, cust)
    h.sql(tagih_sql(visit2, f"k{n}-tahap2", baris(n + 1, 1), OWNER, alasan="Uji fiktif DP"), OWNER)
    inv2 = h.aktif(visit2)
    galat2 = h.gagal(koreksi_sql(h, inv2, f"k{n}-koreksi2", baris(n + 1, 1, 4)), STAFF)
    catat("IND03-koreksi-biasa-tetap-boleh", galat2 is None,
          "diterima" if galat2 is None else str(galat2).strip().splitlines()[0], "IND-05")


# ---------------------------------------------------------------------------
# IND-04 — kepala tagihan tahap tidak boleh membawa uang
# ---------------------------------------------------------------------------
def ind04(h, n, cust):
    muatan = [
        ("staf-dp", STAFF, {"dp_amount": 60000, "paid_status": "DP"}),
        ("dokter-dp", DOCTOR, {"dp_amount": 60000, "paid_status": "DP"}),
        ("staf-lunas", STAFF, {"paid_status": "Lunas"}),
        ("staf-teks", STAFF, {"dp_amount": "60000", "paid_status": "DP"}),
        ("staf-negatif", STAFF, {"dp_amount": -1, "paid_status": "DP"}),
        ("staf-pecahan", STAFF, {"dp_amount": 0.5, "paid_status": "DP"}),
        ("staf-split", STAFF, {"split_payments": [{"method": "Tunai", "amount": 100000}]}),
        ("staf-tanggal-dp", STAFF, {"dp_amount": 0, "dp_date": TGL, "paid_status": "DP"}),
    ]
    for i, (label, user, ganti) in enumerate(muatan):
        # Tiap muatan memakai kunjungannya sendiri supaya "tidak ada tagihan tersimpan"
        # benar-benar diuji, bukan tertolak gara-gara baris resep yang sudah tertagih.
        visit = buat_kunjungan(h, n + i, cust)
        kas = h.saldo("1101")
        stok = h.angka(f"select qty from public.stock where warehouse_id={q(WH)} and item_id={q(ITEM)}")
        galat = h.gagal(tagih_sql(visit, f"k{n}-{label}", baris(n + i, 1), user, ganti=ganti), user)
        tagihan = h.angka(f"select count(*) from public.invoices where visit_id={q(visit)}")
        kwitansi = h.angka(f"select count(*) from public.clinic_payment_receipts where visit_id={q(visit)}")
        kas2 = h.saldo("1101")
        stok2 = h.angka(f"select qty from public.stock where warehouse_id={q(WH)} and item_id={q(ITEM)}")
        catat(f"IND04-{label}", bool(galat) and "STAGE_INVALID" in str(galat)
              and tagihan == 0 and kwitansi == 0 and kas == kas2 and stok == stok2,
              f"{str(galat).strip().splitlines()[0] if galat else 'DITERIMA'} tagihan={tagihan} "
              f"kwitansi={kwitansi} kas={kas2-kas} stok={stok2-stok}", "IND-04")

    # Jalur sahnya tetap jalan: kwitansi kunjungan dulu, baru tahapnya terbit.
    visit = buat_kunjungan(h, n + len(muatan), cust)
    h.sql(bayar_sql(visit, f"k{n}-bayar", [{"method": "Tunai", "amount": 60000}]), STAFF)
    galat = h.gagal(tagih_sql(visit, f"k{n}-sah", baris(n + len(muatan), 1), STAFF), STAFF)
    inv = h.aktif(visit)
    catat("IND04-jalur-kwitansi-sah", galat is None and h.diterima(inv) == 60000
          and h.status_bayar(inv) == "DP",
          f"{'diterima' if galat is None else str(galat).strip().splitlines()[0]} "
          f"diterima={h.diterima(inv) if inv else '-'} status={h.status_bayar(inv) if inv else '-'}", "IND-04")

    # Uang muka di bawah minimum tetap ditolak walau kwitansinya sah.
    m = n + len(muatan) + 1
    visit2 = buat_kunjungan(h, m, cust)
    h.sql(bayar_sql(visit2, f"k{n}-bayar2", [{"method": "Tunai", "amount": 40000}]), STAFF)
    galat2 = h.gagal(tagih_sql(visit2, f"k{n}-kurang", baris(m, 1), STAFF), STAFF)
    catat("IND04-dp-minimal-tetap-ditegakkan", bool(galat2) and "DP_MINIMAL" in str(galat2),
          f"{str(galat2).strip().splitlines()[0] if galat2 else 'DITERIMA'}", "IND-04")


# ---------------------------------------------------------------------------
# IND-05 — batas peran pada pembungkus publik siklus hidup tagihan
# ---------------------------------------------------------------------------
def ind05(h, n, cust):
    hasil = {}
    for i, (label, user, boleh) in enumerate([
        ("staf", STAFF, False), ("dokter", DOCTOR, False),
        ("nonaktif", FIN_NONAKTIF, False), ("luar-cabang", FIN_LUAR, False),
        ("keuangan", FINANCE, True), ("admin", ADMIN, True), ("pemilik", OWNER, True),
    ]):
        visit = buat_kunjungan(h, n + i, cust)
        h.sql(tagih_sql(visit, f"k{n}{i}-tahap", baris(n + i, 1), OWNER, alasan="Uji fiktif DP"), OWNER)
        inv = h.aktif(visit)
        h.sql(bayar_sql(visit, f"k{n}{i}-bayar", [{"method": "Tunai", "amount": 100000}]), OWNER)
        jurnal = h.angka("select count(*) from public.journal_entries")
        bayar = h.angka(f"select count(*) from public.invoice_payments where invoice_id={q(inv)}")
        galat = h.gagal(terbit_ulang_sql(inv, f"k{n}{i}-ulang"), user)
        dibatalkan = h.nilai(f"select voided_at is not null from public.invoices where id={q(inv)}")
        jurnal2 = h.angka("select count(*) from public.journal_entries")
        bayar2 = h.angka(f"select count(*) from public.invoice_payments where invoice_id={q(inv)}")
        if boleh:
            ok = galat is None and dibatalkan == "t"
        else:
            ok = (bool(galat) and "ACCESS_DENIED" in str(galat) and dibatalkan == "f"
                  and jurnal == jurnal2 and bayar == bayar2)
        hasil[label] = ok
        catat(f"IND05-terbit-ulang-{label}", ok,
              f"{'diterima' if galat is None else str(galat).strip().splitlines()[0]} "
              f"dibatalkan={dibatalkan} jurnal={jurnal}->{jurnal2} bayar={bayar}->{bayar2}", "IND-05")
    return hasil


# ---------------------------------------------------------------------------
# Lintas-temuan: pemicu tertunda, stok/HPP sekali, konteks posting, idempotensi
# ---------------------------------------------------------------------------
def lintas(h, n, cust):
    visit = buat_kunjungan(h, n, cust)
    stok = h.angka(f"select qty from public.stock where warehouse_id={q(WH)} and item_id={q(ITEM)}")
    lapis = h.angka(f"select coalesce(sum(qty_left),0) from public.stock_layers where item_id={q(ITEM)}")
    # Dua salinan baris resep yang sama dalam SATU tagihan.
    galat = h.gagal(tagih_sql(visit, f"k{n}-dobel", baris(n, 3, ulang=2), OWNER, alasan="Uji fiktif DP"), OWNER)
    stok2 = h.angka(f"select qty from public.stock where warehouse_id={q(WH)} and item_id={q(ITEM)}")
    lapis2 = h.angka(f"select coalesce(sum(qty_left),0) from public.stock_layers where item_id={q(ITEM)}")
    tagihan = h.angka(f"select count(*) from public.invoices where visit_id={q(visit)}")
    catat("LINTAS-baris-resep-dobel", bool(galat) and "LINE_BILLED" in str(galat)
          and stok == stok2 and lapis == lapis2 and tagihan == 0,
          f"{str(galat).strip().splitlines()[0] if galat else 'DITERIMA'} stok={stok2-stok} "
          f"lapisan={lapis2-lapis} tagihan={tagihan}")

    # Stok/FIFO/HPP bergerak tepat sekali untuk tagihan obat yang sah.
    h.sql(tagih_sql(visit, f"k{n}-obat", baris(n, 3), OWNER, alasan="Uji fiktif DP"), OWNER)
    inv = h.aktif(visit)
    stok3 = h.angka(f"select qty from public.stock where warehouse_id={q(WH)} and item_id={q(ITEM)}")
    gerak = h.angka(f"select count(*) from public.stock_moves where item_id={q(ITEM)} and source_ref="
                    f"(select invoice_no from public.invoices where id={q(inv)})")
    hpp = h.angka(f"select coalesce(sum(hpp),0) from public.invoice_items where invoice_id={q(inv)}")
    # Ulangi dengan kunci sama: tidak ada gerakan stok atau jurnal baru.
    jurnal = h.angka("select count(*) from public.journal_entries")
    h.sql(tagih_sql(visit, f"k{n}-obat", baris(n, 3), OWNER, alasan="Uji fiktif DP"), OWNER)
    jurnal2 = h.angka("select count(*) from public.journal_entries")
    stok4 = h.angka(f"select qty from public.stock where warehouse_id={q(WH)} and item_id={q(ITEM)}")
    catat("LINTAS-stok-hpp-sekali", stok2 - stok3 == 2 and gerak == 1 and hpp == 4000
          and jurnal == jurnal2 and stok3 == stok4,
          f"stok-{stok2-stok3} gerakan={gerak} hpp={hpp} jurnal={jurnal}->{jurnal2}")

    sisa_ctx = h.angka("select count(*) from clinic_private.posting_ctx")
    catat("LINTAS-konteks-posting-bersih", sisa_ctx == 0, f"baris konteks tersisa={sisa_ctx}")

    tak_seimbang = h.angka(
        "select count(*) from (select entry_id from public.journal_lines group by entry_id "
        "having round(sum(debit),2)<>round(sum(credit),2)) t")
    catat("LINTAS-jurnal-seimbang", tak_seimbang == 0, f"entri tidak seimbang={tak_seimbang}")


# ---------------------------------------------------------------------------
def jalankan(h):
    h.sql(dasar_sql())
    ind01(h, 11, buat_pelanggan(h, 11), 1, [{"method": "Tunai", "amount": 150000}], "satu-terbit-ulang")
    ind01(h, 12, buat_pelanggan(h, 12), 2, [{"method": "Tunai", "amount": 150000}], "dua-terbit-ulang")
    ind01(h, 13, buat_pelanggan(h, 13), 1,
          [{"method": "Tunai", "amount": 60000}, {"method": "QRIS", "amount": 90000}], "rekening-campur")
    ind02(h, 21, buat_pelanggan(h, 21))
    ind03(h, 31, buat_pelanggan(h, 31), False, "dirawat")
    ind03(h, 33, buat_pelanggan(h, 33), True, "sudah-pulang")
    ind03_negatif(h, 35, buat_pelanggan(h, 35))
    ind04(h, 41, buat_pelanggan(h, 41))
    ind05(h, 51, buat_pelanggan(h, 51))
    lintas(h, 71, buat_pelanggan(h, 71))


def siapkan_migrasi(pra_perbaikan, stack):
    """Direktori migrasi yang dipakai bootstrap; mode RED memakai revisi tetap sebelum perbaikan."""
    if not pra_perbaikan:
        return ROOT
    tmp = stack.enter_context(tempfile.TemporaryDirectory(prefix="kamo-ranap-red-"))
    tujuan = Path(tmp) / "supabase/migrations"
    tujuan.mkdir(parents=True)
    for sumber in (ROOT / "supabase/migrations").glob("*.sql"):
        if sumber.name != MITIGASI:
            (tujuan / sumber.name).symlink_to(sumber)
    asal = subprocess.run(["git", "show", f"{os.environ.get('KAMO_RED_REVISION', '5fc24c78780b12818c8e06b8aaa6656480f92c32')}:supabase/migrations/{MITIGASI}"],
                          cwd=ROOT, text=True, capture_output=True)
    if asal.returncode:
        raise SystemExit("Tidak dapat membaca revisi pra-perbaikan migrasi mitigasi: " + asal.stderr)
    (tujuan / MITIGASI).write_text(asal.stdout)
    return Path(tmp)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pra-perbaikan", action="store_true",
                        help="pakai migrasi mitigasi sebelum perbaikan, revisi 5fc24c78 (bukti RED)")
    parser.add_argument("--json", type=Path, help="tulis hasil tiap kasus ke berkas ini")
    args = parser.parse_args()

    import contextlib
    with contextlib.ExitStack() as stack:
        fixture.ROOT = siapkan_migrasi(args.pra_perbaikan, stack)
        db = stack.enter_context(NativePostgres(BIN))
        fixture.DisposablePostgres.bootstrap(db)
        h = Harness(db)
        try:
            jalankan(h)
        except RuntimeError as error:
            catat("HARNESS", False, "berhenti: " + str(error).strip().splitlines()[0])

    total = {s: sum(1 for r in HASIL if r["status"] == s) for s in ("PASS", "FAIL")}
    gagal_per_ind = sorted({r["ind"] for r in HASIL if r["status"] == "FAIL" and r["ind"]})
    mode = "PRA-PERBAIKAN (RED)" if args.pra_perbaikan else "SESUDAH PERBAIKAN (GREEN)"
    print(f"TOTAL {mode} pass={total['PASS']} fail={total['FAIL']} "
          f"temuan-gagal={','.join(gagal_per_ind) or '-'}", flush=True)
    if args.json:
        args.json.write_text(json.dumps(
            {"mode": "red" if args.pra_perbaikan else "green", "total": total,
             "temuan_gagal": gagal_per_ind, "kasus": HASIL}, indent=2, ensure_ascii=False))
    sys.exit(0 if total["FAIL"] == 0 else 1)


if __name__ == "__main__":
    main()
