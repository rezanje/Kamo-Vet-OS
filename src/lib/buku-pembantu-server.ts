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

/** Semua pergerakan piutang s/d `sampai` — tanpa batas bawah, karena saldo awal butuh riwayat penuh. */
export async function mutasiPiutang(supabase: SupabaseServer, sampai: string): Promise<Mutasi[]> {
  const batas = `${sampai}T23:59:59+07:00`;

  const [{ data: invs }, { data: fjs }, { data: rcs }] = await Promise.all([
    supabase.from("invoices")
      .select("id, invoice_no, total, dp_amount, dp_date, paid_status, paid_at, created_at, visits(customer_id, customers(name)), invoice_payments(id, tanggal, amount, metode)")
      .is("voided_at", null).lte("created_at", batas),
    supabase.from("sales_invoices")
      .select("id, no_faktur, tanggal, total, customer_id, customers(name)")
      .neq("status", "batal").lte("tanggal", sampai),
    supabase.from("sales_receipts")
      .select("invoice_id, no_terima, tanggal, jumlah, metode, sales_invoices(customer_id, customers(name))")
      .lte("tanggal", sampai),
  ]);

  type InvRow = {
    id: string; invoice_no: string | null; total: number; dp_amount: number; dp_date: string | null;
    paid_status: string | null; paid_at: string | null; created_at: string;
    visits: Rel<{ customer_id: string | null; customers: Rel<{ name: string }> }>;
    invoice_payments: { id: string; tanggal: string; amount: number; metode: string | null }[] | null;
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
        tanggal: tgl(p.tanggal), pihakId, pihak, nomor, jenis: "Pembayaran",
        keterangan: p.metode ? `Pelunasan ${p.metode}` : "Pelunasan", naik: 0, turun: jumlah, href,
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

  type FjRow = { id: string; no_faktur: string; tanggal: string; total: number; customer_id: string | null; customers: Rel<{ name: string }> };
  for (const f of (fjs ?? []) as unknown as FjRow[]) {
    out.push({
      tanggal: tgl(f.tanggal), pihakId: f.customer_id ?? "—",
      pihak: one(f.customers)?.name ?? "(tanpa pelanggan)",
      nomor: f.no_faktur, jenis: "Faktur", keterangan: "Faktur penjualan reseller",
      naik: Number(f.total) || 0, turun: 0, href: "/penjualan/faktur",
    });
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
  const [{ data: invs }, { data: rets }] = await Promise.all([
    supabase.from("purchase_invoices")
      .select("id, no_faktur, tanggal, total, supplier_id, suppliers(nama), purchase_invoice_payments(id, tanggal, amount, dari_uang_muka)")
      .lte("tanggal", sampai),
    supabase.from("purchase_returns")
      .select("no_retur, tanggal, total, purchase_orders(supplier_id, suppliers(nama))")
      .lte("tanggal", sampai),
  ]);

  type PiRow = {
    id: string; no_faktur: string; tanggal: string; total: number;
    supplier_id: string | null; suppliers: Rel<{ nama: string }>;
    purchase_invoice_payments: { id: string; tanggal: string; amount: number; dari_uang_muka: number | null }[] | null;
  };

  const out: Mutasi[] = [];
  for (const v of (invs ?? []) as unknown as PiRow[]) {
    const pihakId = v.supplier_id ?? "—";
    const pihak = one(v.suppliers)?.nama ?? "(tanpa pemasok)";
    out.push({
      tanggal: tgl(v.tanggal), pihakId, pihak, nomor: v.no_faktur, jenis: "Faktur",
      keterangan: "Faktur pembelian", naik: Number(v.total) || 0, turun: 0,
      href: "/pembelian/faktur",
    });
    for (const p of v.purchase_invoice_payments ?? []) {
      const jumlah = Number(p.amount) || 0;
      if (jumlah <= 0) continue;
      const dariUM = Number(p.dari_uang_muka) || 0;
      out.push({
        tanggal: tgl(p.tanggal), pihakId, pihak, nomor: v.no_faktur,
        jenis: dariUM >= jumlah ? "Uang muka" : "Pembayaran",
        keterangan: dariUM > 0 ? "Dibayar (sebagian dari uang muka)" : "Pembayaran hutang",
        naik: 0, turun: jumlah, href: "/pembelian/faktur",
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
