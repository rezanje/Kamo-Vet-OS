// Penarikan mutasi piutang & hutang untuk buku besar pembantu.
//
// Ditarik dari DOKUMEN, bukan jurnal — baris jurnal tidak menyimpan pelanggan/pemasoknya.
// Konsekuensinya saldo di sini bisa saja beda dengan akun buku besar kalau ada dokumen
// yang tidak terjurnal; karena itu halamannya menampilkan pembandingnya secara terbuka.
import { createClient } from "@/lib/supabase/server";
import type { Mutasi } from "@/lib/buku-pembantu";

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const tgl = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : "");

export type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

// Faktur saldo awal (M05) boleh tanpa tanggal faktur. Di buku pembantu barisnya ditaruh pada
// tanggal saldo awal batch-nya — tanggal jurnal 311001/150001-nya — supaya saldonya sejalan dengan
// buku besar. Tanggal faktur itu sendiri tetap kosong; tidak ada tanggal yang dikarang.
// Batch hanya terbaca keuangan di cabangnya; kalau tidak terbaca, baris tetap ikut tanpa tanggal
// (masuk saldo awal setiap periode) — tidak dibuang dan tidak ditebak.
const KETERANGAN_TANPA_TANGGAL = "Saldo awal per faktur · tanggal faktur tidak ada, dicatat per tanggal saldo awal";
type BatchSaldoAwal = { opening_invoice_batches: Rel<{ as_of: string }> };
const tanggalSaldoAwal = (row: BatchSaldoAwal) => one(row.opening_invoice_batches)?.as_of ?? "";

/** Semua pergerakan piutang s/d `sampai` — tanpa batas bawah, karena saldo awal butuh riwayat penuh. */
export async function mutasiPiutang(supabase: SupabaseServer, sampai: string): Promise<Mutasi[]> {
  const batas = `${sampai}T23:59:59+07:00`;

  const [{ data: invs }, { data: fjs }, { data: rcs }, { data: credits, error: creditError }, { data: fjTanpaTanggal, error: undatedSalesError }, { data: returs, error: returError }] = await Promise.all([
    supabase.from("invoices")
      .select("id, invoice_no, total, dp_amount, dp_date, paid_status, paid_at, created_at, visits(customer_id, customers(name)), invoice_payments!invoice_payments_invoice_id_fkey(id, tanggal, amount, metode, transferred_from)")
      .is("voided_at", null).lte("created_at", batas),
    supabase.from("sales_invoices")
      .select("id, no_faktur, tanggal, total, status, voided_on, customer_id, customers(name)")
      .lte("tanggal", sampai),
    supabase.from("sales_receipts")
      .select("invoice_id, no_terima, tanggal, jumlah, metode, sales_invoices(customer_id, customers(name))")
      .lte("tanggal", sampai),
    supabase.from("wholesale_invoice_corrections")
      .select("id,tanggal,customer_credit,sales_invoices!invoice_id(id,no_faktur,customer_id,customers(name))")
      .lte("tanggal", sampai),
    supabase.from("sales_invoices")
      .select("id, no_faktur, tanggal, total, status, voided_on, customer_id, customers(name), opening_invoice_batches!opening_batch_id(as_of)")
      .is("tanggal", null),
    // Retur faktur grosir: hanya bagian yang mengurangi piutang (ar_reduction) menyentuh 150001;
    // bagian kredit pelanggan langsung ke 314001.
    supabase.from("wholesale_returns")
      .select("id,no_retur,tanggal,ar_reduction,status,voided_on,customer_id,customers(name)")
      .lte("tanggal", sampai),
  ]);
  if (returError) throw new Error("Retur faktur penjualan belum dapat diverifikasi: " + returError.message);
  if (creditError) throw new Error("Kredit pelanggan belum dapat diverifikasi: " + creditError.message);
  if (undatedSalesError) throw new Error("Faktur saldo awal tanpa tanggal belum dapat diverifikasi: " + undatedSalesError.message);

  type InvRow = {
    id: string; invoice_no: string | null; total: number; dp_amount: number; dp_date: string | null;
    paid_status: string | null; paid_at: string | null; created_at: string;
    visits: Rel<{ customer_id: string | null; customers: Rel<{ name: string }> }>;
    invoice_payments: { id: string; tanggal: string; amount: number; metode: string | null; transferred_from: string | null }[] | null;
  };

  const out: Mutasi[] = [];

  for (const i of (invs ?? []) as unknown as InvRow[]) {
    const v = one(i.visits);
    const pihakId = v?.customer_id ?? "—";
    const pihak = one(v?.customers ?? null)?.name ?? "(pelanggan umum)";
    const nomor = i.invoice_no ?? "(tanpa nomor)";
    const total = Number(i.total) || 0;
    const href = `/klinik/pembayaran`;
    if (total > 0) {
      out.push({
        tanggal: tgl(i.created_at), pihakId, pihak, nomor, jenis: "Faktur",
        keterangan: "Tagihan klinik", naik: total, turun: 0, href,
      });
    }

    let dibayar = 0;
    const dp = Number(i.dp_amount) || 0;
    if (dp > 0) {
      dibayar += dp;
      out.push({
        tanggal: tgl(i.dp_date) || tgl(i.created_at), pihakId, pihak, nomor, jenis: "Uang muka",
        keterangan: "Uang muka tagihan", naik: 0, turun: dp, href,
      });
    }
    for (const p of i.invoice_payments ?? []) {
      const jumlah = Number(p.amount) || 0;
      if (jumlah <= 0) continue;
      dibayar += jumlah;
      out.push({
        tanggal: tgl(p.tanggal), pihakId, pihak, nomor,
        jenis: "Pembayaran",
        keterangan: p.transferred_from ? "Dari tagihan sebelumnya"
          : p.metode ? `Pelunasan ${p.metode}` : "Pelunasan", naik: 0, turun: jumlah, href,
      });
    }

    // Tagihan yang dilunasi langsung di kasir tidak meninggalkan baris pembayaran —
    // statusnya saja yang berubah jadi Lunas. Tanpa baris bayangan ini, faktur lunas
    // menggantung selamanya di buku pembantu padahal uangnya sudah masuk.
    const sisa = total - dibayar;
    if (i.paid_status === "Lunas" && sisa > 0) {
      out.push({
        tanggal: tgl(i.paid_at) || tgl(i.created_at), pihakId, pihak, nomor, jenis: "Pembayaran",
        keterangan: "Dibayar di kasir klinik", naik: 0, turun: sisa, href,
      });
    }
  }

  type FjRow = { id: string; no_faktur: string; tanggal: string | null; total: number; status: string; voided_on: string | null; customer_id: string | null; customers: Rel<{ name: string }> };
  const tanpaTanggal = ((fjTanpaTanggal ?? []) as unknown as (FjRow & BatchSaldoAwal)[])
    .map((f) => ({ ...f, tanggal: tanggalSaldoAwal(f), tanpaTanggal: true }))
    .filter((f) => f.tanggal <= sampai);
  for (const f of [...(fjs ?? []) as unknown as FjRow[], ...tanpaTanggal]) {
    if (f.status === "batal" && !f.voided_on) continue;
    out.push({
      tanggal: tgl(f.tanggal), pihakId: f.customer_id ?? "—",
      pihak: one(f.customers)?.name ?? "(tanpa pelanggan)",
      nomor: f.no_faktur, jenis: "Faktur", keterangan: "tanpaTanggal" in f ? KETERANGAN_TANPA_TANGGAL : "Faktur penjualan reseller",
      naik: Number(f.total) || 0, turun: 0, href: `/penjualan/faktur/${f.id}`,
    });
    if (f.voided_on && f.voided_on <= sampai) out.push({
      tanggal: f.voided_on, pihakId: f.customer_id ?? "—", pihak: one(f.customers)?.name ?? "(tanpa pelanggan)",
      nomor: f.no_faktur, jenis: "Faktur", keterangan: "Pembalik pencatatan faktur grosir", naik: 0, turun: Number(f.total), href: `/penjualan/faktur/${f.id}`,
    });
  }
  type CreditRow = { tanggal: string; customer_credit: number; sales_invoices: Rel<{ id: string; no_faktur: string; customer_id: string | null; customers: Rel<{ name: string }> }> };
  for (const credit of (credits ?? []) as unknown as CreditRow[]) {
    const invoice = one(credit.sales_invoices);
    if (!invoice || Number(credit.customer_credit) <= 0) continue;
    out.push({ tanggal: credit.tanggal, pihakId: invoice.customer_id ?? "—", pihak: one(invoice.customers)?.name ?? "(tanpa pelanggan)",
      nomor: invoice.no_faktur, jenis: "Faktur", keterangan: "Reklasifikasi ke kredit pelanggan (314001)",
      naik: Number(credit.customer_credit), turun: 0, href: `/penjualan/faktur/${invoice.id}` });
  }

  type ReturRow = { id: string; no_retur: string; tanggal: string; ar_reduction: number; status: string; voided_on: string | null; customer_id: string | null; customers: Rel<{ name: string }> };
  for (const r of (returs ?? []) as unknown as ReturRow[]) {
    const pihakId = r.customer_id ?? "—", pihak = one(r.customers)?.name ?? "(tanpa pelanggan)", nilai = Number(r.ar_reduction) || 0;
    if (nilai <= 0) continue;
    out.push({ tanggal: tgl(r.tanggal), pihakId, pihak, nomor: r.no_retur, jenis: "Retur", keterangan: "Retur faktur penjualan",
      naik: 0, turun: nilai, href: `/penjualan/retur-grosir/${r.id}` });
    if (r.status === "batal" && r.voided_on && r.voided_on <= sampai) out.push({ tanggal: r.voided_on, pihakId, pihak, nomor: r.no_retur,
      jenis: "Retur", keterangan: "Pembatalan retur faktur penjualan", naik: nilai, turun: 0, href: `/penjualan/retur-grosir/${r.id}` });
  }

  type RcRow = { invoice_id: string; no_terima: string; tanggal: string; jumlah: number; metode: string | null; sales_invoices: Rel<{ customer_id: string | null; customers: Rel<{ name: string }> }> };
  for (const r of (rcs ?? []) as unknown as RcRow[]) {
    const f = one(r.sales_invoices);
    out.push({
      tanggal: tgl(r.tanggal), pihakId: f?.customer_id ?? "—",
      pihak: one(f?.customers ?? null)?.name ?? "(tanpa pelanggan)",
      nomor: r.no_terima, jenis: "Pembayaran",
      keterangan: r.metode ? `Penerimaan ${r.metode}` : "Penerimaan penjualan",
      naik: 0, turun: Number(r.jumlah) || 0, href: "/penjualan/faktur",
    });
  }

  return out;
}

/** Semua pergerakan hutang usaha s/d `sampai`. */
export async function mutasiHutang(supabase: SupabaseServer, sampai: string): Promise<Mutasi[]> {
  const kolom = "id, no_faktur, tanggal, total, voided_on, supplier_id, suppliers(nama), purchase_invoice_payments(id, tanggal, amount, dari_uang_muka)";
  const [{ data: invs }, { data: rets }, { data: tanpaTanggalData, error: undatedError }] = await Promise.all([
    supabase.from("purchase_invoices")
      .select(kolom)
      .lte("tanggal", sampai),
    supabase.from("purchase_returns")
      .select("no_retur, tanggal, total, purchase_orders(supplier_id, suppliers(nama))").is("voided_at", null)
      .lte("tanggal", sampai),
    supabase.from("purchase_invoices")
      .select(`${kolom}, opening_invoice_batches!opening_batch_id(as_of)`)
      .is("tanggal", null),
  ]);
  if (undatedError) throw new Error("Faktur saldo awal tanpa tanggal belum dapat diverifikasi: " + undatedError.message);

  type PiRow = {
    id: string; no_faktur: string; tanggal: string | null; total: number; voided_on: string | null;
    supplier_id: string | null; suppliers: Rel<{ nama: string }>;
    purchase_invoice_payments: { id: string; tanggal: string; amount: number; dari_uang_muka: number | null }[] | null;
  };
  const tanpaTanggal = ((tanpaTanggalData ?? []) as unknown as (PiRow & BatchSaldoAwal)[])
    .map((v) => ({ ...v, tanggal: tanggalSaldoAwal(v), tanpaTanggal: true }))
    .filter((v) => v.tanggal <= sampai);

  const out: Mutasi[] = [];
  for (const v of [...(invs ?? []) as unknown as PiRow[], ...tanpaTanggal]) {
    const pihakId = v.supplier_id ?? "—";
    const pihak = one(v.suppliers)?.nama ?? "(tanpa pemasok)";
    out.push({
      tanggal: tgl(v.tanggal), pihakId, pihak, nomor: v.no_faktur, jenis: "Faktur",
      keterangan: "tanpaTanggal" in v ? KETERANGAN_TANPA_TANGGAL : "Faktur pembelian", naik: Number(v.total) || 0, turun: 0,
      href: "/pembelian/faktur",
    });
    if (v.voided_on && v.voided_on <= sampai) out.push({
      tanggal: v.voided_on, pihakId, pihak, nomor: v.no_faktur, jenis: "Faktur",
      keterangan: "Pembalik faktur pembelian", naik: 0, turun: Number(v.total) || 0,
      href: `/pembelian/faktur/${v.id}`,
    });
    for (const p of v.purchase_invoice_payments ?? []) {
      if (tgl(p.tanggal) > sampai) continue;
      const jumlah = Number(p.amount) || 0;
      if (jumlah === 0) continue;
      const dariUM = Number(p.dari_uang_muka) || 0;
      out.push({
        tanggal: tgl(p.tanggal), pihakId, pihak, nomor: v.no_faktur,
        jenis: jumlah > 0 && dariUM >= jumlah ? "Uang muka" : "Pembayaran",
        keterangan: jumlah < 0 ? "Pembalik pembayaran hutang" : dariUM > 0 ? "Dibayar (sebagian dari uang muka)" : "Pembayaran hutang",
        naik: Math.max(0, -jumlah), turun: Math.max(0, jumlah), href: `/pembelian/faktur/${v.id}`,
      });
    }
  }

  type RetRow = { no_retur: string; tanggal: string; total: number; purchase_orders: Rel<{ supplier_id: string | null; suppliers: Rel<{ nama: string }> }> };
  for (const r of (rets ?? []) as unknown as RetRow[]) {
    const po = one(r.purchase_orders);
    out.push({
      tanggal: tgl(r.tanggal), pihakId: po?.supplier_id ?? "—",
      pihak: one(po?.suppliers ?? null)?.nama ?? "(tanpa pemasok)",
      nomor: r.no_retur, jenis: "Retur", keterangan: "Retur pembelian",
      naik: 0, turun: Number(r.total) || 0, href: "/pembelian/retur",
    });
  }

  return out;
}
