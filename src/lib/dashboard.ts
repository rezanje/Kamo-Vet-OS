// Agregat dashboard keuangan (ala Accurate). Read-only, hitung di JS.
import { completeReportQuery } from "./report-query";
import { getAccountBalances, nilaiSeksi } from "./ledger";
import { kodeSemuaRekening } from "./kas-akun";
import { sisaFakturablePerBaris, type ItemFakturPoTersimpan } from "./faktur-beli";
import { isCompletedSale, type SaleCompletion } from "./sale-payment-reporting";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

const iso = (d: Date) => d.toISOString().slice(0, 10);

export type Dashboard = {
  labaRugi: { pendapatan: number; hpp: number; pengeluaran: number; laba: number };
  beban: { name: string; amount: number }[];
  arusKas: { tanggal: string; masuk: number; keluar: number }[];
  penjualan: { total: number; lunas: number; belumLunas: number };
  pembelian: { total: number; lunas: number; belumLunas: number };
  trenPenjualan: { tanggal: string; total: number }[];
  saldoKas: number;
};

// Rentang tahun berjalan (1 Jan s/d hari ini). today = ISO date (dari server, sekali).
export async function getDashboard(supabase: AnyClient, today: string): Promise<Dashboard> {
  const tahun = today.slice(0, 4);
  const awalTahun = `${tahun}-01-01`;

  // 7 hari terakhir termasuk hari ini (untuk chart harian).
  const hari7: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    hari7.push(iso(d));
  }
  const awal7 = hari7[0];

  const kodeRekening = await kodeSemuaRekening(supabase);

  const [balances, salesRows, invRows, invPays, fjRows, fjReceipts, poRows, poFaktur, poRetur, cashLines] = await Promise.all([
    getAccountBalances(supabase, { from: awalTahun, to: today }),
    supabase.from("sales").select("total, created_at, metode_bayar, marketplace_status, payment_plan, payments_finalized_at, voided_at"),
    supabase.from("invoices").select("id, total, dp_amount, paid_status, created_at").is("voided_at", null),
    supabase.from("invoice_payments").select("invoice_id, amount"),
    // Retain prior-year/cancelled sources: their dated reversals may fall in
    // this year or the seven-day trend. Current settlement is computed separately.
    completeReportQuery(supabase.from("sales_invoices")
      .select("id, total, tanggal, status, voided_on, carried_paid", { count: "exact" }).lte("tanggal", today)),
    completeReportQuery(supabase.from("sales_receipts")
      .select("id, invoice_id, tanggal, jumlah", { count: "exact" }).lte("tanggal", today)),
    supabase.from("purchase_orders").select("id, purchase_order_items(id,item_id,qty,qty_terima,harga_beli,faktor)").eq("status", "Diterima"),
    // Pelunasan pembelian hidup di purchase_invoice_payments (lewat Faktur Pembelian).
    // Tabel po_payments sudah tidak ditulis layar mana pun — membacanya bikin dashboard
    // selalu melaporkan seluruh PO sebagai belum dibayar.
    supabase.from("purchase_invoices").select("po_id, total, purchase_invoice_items(po_item_id,item_id,qty,faktor), purchase_invoice_payments(amount)").is("voided_at", null),
    supabase.from("purchase_returns").select("po_id, total"),
    // baris jurnal kas/bank 7 hari terakhir untuk arus kas harian.
    supabase
      .from("journal_lines")
      .select("debit, credit, coa_accounts!inner(code), journal_entries!inner(tanggal)")
      .in("coa_accounts.code", kodeRekening)
      .gte("journal_entries.tanggal", awal7)
      .lte("journal_entries.tanggal", today),
  ]);

  // ── Laba/Rugi ──
  const bal = balances as { code: string; name: string; type: string; normal: string; saldo: number }[];
  const pendapatan = bal.filter((b) => b.type === "PENDAPATAN").reduce((a, b) => a + nilaiSeksi(b), 0);
  const hpp = bal.filter((b) => b.code === "5101").reduce((a, b) => a + nilaiSeksi(b), 0);
  const pengeluaran = bal.filter((b) => b.type === "BEBAN" && b.code !== "5101").reduce((a, b) => a + nilaiSeksi(b), 0);
  const laba = pendapatan - hpp - pengeluaran;

  // ── Beban breakdown (opex, top 5 + lainnya) ──
  const bebanAll = bal
    .filter((b) => b.type === "BEBAN" && b.code !== "5101" && nilaiSeksi(b) > 0)
    .map((b) => ({ name: b.name, amount: nilaiSeksi(b) }))
    .sort((a, b) => b.amount - a.amount);
  const beban = bebanAll.slice(0, 5);
  const lainnya = bebanAll.slice(5).reduce((a, b) => a + b.amount, 0);
  if (lainnya > 0) beban.push({ name: "Lainnya", amount: lainnya });

  // ── Arus kas harian (7 hari) ──
  type CL = { debit: number; credit: number; journal_entries: { tanggal: string } | { tanggal: string }[] };
  const cashByDay = new Map<string, { masuk: number; keluar: number }>();
  for (const h of hari7) cashByDay.set(h, { masuk: 0, keluar: 0 });
  for (const l of (cashLines.data ?? []) as CL[]) {
    const je = Array.isArray(l.journal_entries) ? l.journal_entries[0] : l.journal_entries;
    const t = je?.tanggal;
    const bucket = t && cashByDay.get(t);
    if (bucket) { bucket.masuk += Number(l.debit); bucket.keluar += Number(l.credit); }
  }
  const arusKas = hari7.map((t) => ({ tanggal: t, ...cashByDay.get(t)! }));

  // ── Penjualan (tahun ini): POS + Online + invoice klinik + faktur reseller, lunas vs belum ──
  const completedSales = ((salesRows.data ?? []) as (SaleCompletion & { total: number; created_at: string; marketplace_status: string | null })[]).filter(isCompletedSale);
  const salesRowsThisYear = completedSales.filter((s) => s.created_at >= awalTahun);
  const salesTotal = salesRowsThisYear.reduce((a: number, s: { total: number }) => a + Number(s.total), 0);

  const paidMap = new Map<string, number>();
  for (const p of (invPays.data ?? []) as { invoice_id: string; amount: number }[]) paidMap.set(p.invoice_id, (paidMap.get(p.invoice_id) ?? 0) + Number(p.amount));
  let invTotal = 0, invBelum = 0;
  for (const i of (invRows.data ?? []) as { id: string; total: number; dp_amount: number; paid_status: string; created_at: string }[]) {
    if (i.created_at.slice(0, 10) < awalTahun) continue;
    const dibayar = Number(i.dp_amount) + (paidMap.get(i.id) ?? 0);
    invTotal += Number(i.total);
    invBelum += Math.max(0, Number(i.total) - dibayar);
  }
  // POS dianggap lunas (bayar tunai/QRIS di kasir). Order online marketplace TIDAK —
  // dana ditahan platform di akun 1202 Piutang Marketplace sampai "Tandai cair" dijalankan,
  // jadi ikut dihitung belum lunas selama marketplace_status masih 'piutang'.
  const salesBelumLunas = salesRowsThisYear
    .filter((s: { marketplace_status: string | null }) => s.marketplace_status === "piutang")
    .reduce((a: number, s: { total: number }) => a + Number(s.total), 0);
  // Faktur reseller: yang sudah masuk = penerimaan penjualan (termasuk porsi uang muka).
  const fjPaid = new Map<string, number>();
  for (const r of (fjReceipts.data ?? []) as { invoice_id: string; jumlah: number }[]) {
    fjPaid.set(r.invoice_id, (fjPaid.get(r.invoice_id) ?? 0) + Number(r.jumlah));
  }
  type ResellerInvoice = { id: string; total: number; tanggal: string; status: string; voided_on: string | null; carried_paid: number };
  const fjMovements: { tanggal: string; total: number }[] = [];
  let fjLunas = 0, fjBelum = 0;
  for (const f of fjRows.data as ResellerInvoice[]) {
    if (f.tanggal > today || (f.status === "batal" && !f.voided_on)) continue;
    const total = Number(f.total);
    fjMovements.push({ tanggal: f.tanggal, total });
    const reversed = !!f.voided_on && f.voided_on <= today;
    if (reversed) fjMovements.push({ tanggal: f.voided_on!, total: -total });
    else {
      // Carried applications replace the old invoice's receipts; they are not
      // additional cash or sales. Only the active invoice contributes settlement.
      const paid = Math.min(total, Number(f.carried_paid ?? 0) + (fjPaid.get(f.id) ?? 0));
      fjLunas += paid;
      fjBelum += Math.max(0, total - paid);
    }
  }
  const fjTotal = fjMovements.filter(m => m.tanggal >= awalTahun).reduce((sum, m) => sum + m.total, 0);
  const penjTotal = salesTotal + invTotal + fjTotal;
  const belumLunas = invBelum + salesBelumLunas + fjBelum;
  // Dated net sales can be negative after a prior-year correction. It must not
  // turn current applied payments negative by subtracting AR from that flow.
  const lunas = salesTotal - salesBelumLunas + invTotal - invBelum + fjLunas;
  const penjualan = { total: penjTotal, lunas, belumLunas };

  // Received goods remain a liability until billed; void invoices reopen that portion.
  type PurchaseInvoice = { po_id: string | null; total: number; purchase_invoice_items: ItemFakturPoTersimpan[] | null; purchase_invoice_payments: { amount: number }[] | null };
  const purchases = new Map<string, { total: number; paid: number }>();
  const billed = new Map<string, ItemFakturPoTersimpan[]>();
  let pembTotal = 0, pembBelum = 0;
  for (const invoice of (poFaktur.data ?? []) as PurchaseInvoice[]) {
    const total = Number(invoice.total);
    const paid = (invoice.purchase_invoice_payments ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0);
    if (!invoice.po_id) { pembTotal += total; pembBelum += Math.max(0, total - paid); continue; }
    const current = purchases.get(invoice.po_id) ?? { total: 0, paid: 0 };
    current.total += total; current.paid += paid;
    purchases.set(invoice.po_id, current);
    billed.set(invoice.po_id, [...(billed.get(invoice.po_id) ?? []), ...(invoice.purchase_invoice_items ?? [])]);
  }
  type ReceivedPo = { id: string; purchase_order_items: { id: string; item_id: string | null; qty: number; qty_terima: number | null; harga_beli: number; faktor: number }[] | null };
  for (const po of (poRows.data ?? []) as ReceivedPo[]) {
    const rows = po.purchase_order_items ?? [];
    const remaining = sisaFakturablePerBaris(rows.map(row => ({ id: row.id, item_id: row.item_id, diterima: Number(row.qty_terima ?? row.qty), faktor: Number(row.faktor) })), billed.get(po.id) ?? []);
    if (remaining.invalidLinkedLines || remaining.invalidPoItemIds.length || remaining.legacyAmbiguousItemIds.length) throw new Error("Sisa kewajiban PO perlu direkonsiliasi sebelum dashboard dapat dihitung.");
    const current = purchases.get(po.id) ?? { total: 0, paid: 0 };
    current.total += rows.reduce((sum, row) => sum + (remaining.sisaPerBaris[row.id] ?? 0) * Number(row.harga_beli), 0);
    purchases.set(po.id, current);
  }
  for (const row of (poRetur.data ?? []) as { po_id: string; total: number }[]) {
    const current = purchases.get(row.po_id);
    if (current) current.paid += Number(row.total);
  }
  for (const purchase of purchases.values()) {
    pembTotal += purchase.total;
    pembBelum += Math.max(0, purchase.total - purchase.paid);
  }
  const pembelian = { total: pembTotal, lunas: pembTotal - pembBelum, belumLunas: pembBelum };

  // ── Tren penjualan harian (7 hari) ──
  const trenMap = new Map<string, number>();
  for (const h of hari7) trenMap.set(h, 0);
  for (const s of completedSales) {
    const t = s.created_at.slice(0, 10);
    if (trenMap.has(t)) trenMap.set(t, trenMap.get(t)! + Number(s.total));
  }
  for (const movement of fjMovements) {
    if (trenMap.has(movement.tanggal)) trenMap.set(movement.tanggal, trenMap.get(movement.tanggal)! + movement.total);
  }
  const trenPenjualan = hari7.map((t) => ({ tanggal: t, total: trenMap.get(t)! }));

  // Semua rekening kas/bank dari master — bukan daftar mati 1101/1102, supaya kartu ini
  // sama angkanya dengan laporan Arus Kas ketika ada rekening QRIS/e-wallet/bank baru.
  const setRekening = new Set(kodeRekening);
  const saldoKas = bal.filter((b) => setRekening.has(b.code)).reduce((a, b) => a + b.saldo, 0);

  return { labaRugi: { pendapatan, hpp, pengeluaran, laba }, beban, arusKas, penjualan, pembelian, trenPenjualan, saldoKas };
}
