import { after } from "next/server";
import { kirimStrukWa } from "./wa-engine";
import { gabungPaketCetak } from "./paket-klinik";
import type { WaResult } from "./fonnte";

// Struk WA otomatis setelah pembayaran (permintaan Aldi, 14 Nov 2026): begitu kasir
// menekan Bayar, struk dikirim dari nomor WA klinik ke pelanggan — bukan dari HP kasir,
// jadi tidak bisa dilewati. Isi struk dibaca ulang dari transaksi yang SUDAH tersimpan,
// bukan dari layar. Pengiriman tidak pernah menggagalkan/menahan pembayaran.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
type Rel<T> = T | T[] | null | undefined;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : (r ?? null));
const tidakDikirim = (reason: string): WaResult => ({ ok: false, reason });

/** Jalankan setelah respons dikirim ke kasir; di luar konteks request (tes) jalan langsung. */
export async function setelahResponsStruk(label: string, task: () => Promise<unknown>) {
  const aman = () => task().then(() => undefined, (error: unknown) => {
    console.error(`[struk-wa] ${label}: pengiriman gagal`, error);
  });
  try { after(aman); } catch { await aman(); }
}

/** Struk WA penjualan kasir toko / POS. Pelanggan umum (tanpa nomor) dilewati. */
export async function kirimStrukWaPenjualan(supabase: Db, saleId: string): Promise<WaResult> {
  const [{ data: sale, error }, { data: items, error: itemsError }] = await Promise.all([
    supabase.from("sales")
      .select("no_struk, total, customer_id, branch_id, voided_at, customers(name, phone), branches(name)")
      .eq("id", saleId).maybeSingle(),
    supabase.from("sale_items").select("nama, qty, harga, source_position").eq("sale_id", saleId).order("source_position"),
  ]);
  if (error || itemsError || !sale) return tidakDikirim("Transaksi belum bisa dibaca untuk struk WA");
  if (sale.voided_at) return tidakDikirim("Transaksi sudah dibatalkan");
  const customer = one<{ name?: string | null; phone?: string | null }>(sale.customers);
  if (!sale.customer_id || !customer?.phone?.trim()) return tidakDikirim("Pelanggan belum punya nomor WA");
  return kirimStrukWa(supabase, {
    invoiceNo: sale.no_struk, customerId: sale.customer_id, phone: customer.phone, customerName: customer.name ?? "",
    branchId: sale.branch_id ?? null, branchName: one<{ name?: string | null }>(sale.branches)?.name ?? null, jenis: "toko",
    total: Number(sale.total) || 0,
    items: ((items ?? []) as { nama: string; qty: number; harga: number }[])
      .map((row) => ({ deskripsi: row.nama, qty: Number(row.qty), harga: Number(row.harga) })),
  });
}

type BarisInvoice = {
  invoice_id: string; deskripsi: string; qty: number; harga: number; diskon_persen: number | null; jenis: string | null;
  package_item_id: string | null; package_qty: number | null; paket: Rel<{ name: string | null }>;
};

/** Struk WA invoice klinik yang sudah LUNAS (bayar rombongan, pelunasan DP). */
export async function kirimStrukWaInvoiceKlinik(supabase: Db, invoiceId: string): Promise<WaResult> {
  const [{ data: invoice, error }, { data: items, error: itemsError }] = await Promise.all([
    supabase.from("invoices")
      .select("invoice_no, total, paid_status, visits(customer_id, branch_id, customers(name, phone), pets(name), branches(name))")
      .eq("id", invoiceId).maybeSingle(),
    supabase.from("invoice_items")
      .select("invoice_id, deskripsi, qty, harga, diskon_persen, jenis, package_item_id, package_qty, paket:items!invoice_items_package_item_id_fkey(name)")
      .eq("invoice_id", invoiceId).order("created_at").order("id"),
  ]);
  if (error || itemsError || !invoice) return tidakDikirim("Invoice belum bisa dibaca untuk struk WA");
  if (invoice.paid_status !== "Lunas") return tidakDikirim("Invoice belum lunas");
  const visit = one<{ customer_id: string | null; branch_id: string | null; customers: Rel<{ name?: string | null; phone?: string | null }>; pets: Rel<{ name?: string | null }>; branches: Rel<{ name?: string | null }> }>(invoice.visits);
  const customer = one(visit?.customers);
  if (!visit?.customer_id || !customer?.phone?.trim()) return tidakDikirim("Pelanggan belum punya nomor WA");
  // Isi paket tidak dikirim ke pelanggan (Reza 2 Nov): satu baris nama paket, harga paket.
  const baris = gabungPaketCetak(((items ?? []) as BarisInvoice[]).map((row) => ({ ...row, paket: one(row.paket) })));
  return kirimStrukWa(supabase, {
    invoiceNo: invoice.invoice_no, customerId: visit.customer_id, phone: customer.phone, customerName: customer.name ?? "",
    petName: one(visit.pets)?.name ?? null, branchId: visit.branch_id ?? null, branchName: one(visit.branches)?.name ?? null, jenis: "klinik",
    total: Number(invoice.total) || 0,
    items: baris.map((row) => ({ deskripsi: row.deskripsi, qty: Number(row.qty), harga: Number(row.harga) })),
  });
}
