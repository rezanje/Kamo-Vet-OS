// Agregat dashboard keuangan (ala Accurate). Read-only, hitung di JS.
import { getAccountBalances } from "./ledger";

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
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() - i);
    hari7.push(iso(d));
  }
  const awal7 = hari7[0];

  const [balances, salesRows, invRows, invPays, poRows, poPays, cashLines] = await Promise.all([
    getAccountBalances(supabase, { from: awalTahun, to: today }),
    supabase.from("sales").select("total, created_at, metode_bayar"),
    supabase.from("invoices").select("id, total, dp_amount, paid_status, created_at").is("voided_at", null),
    supabase.from("invoice_payments").select("invoice_id, amount"),
    supabase.from("purchase_orders").select("id, total, status, tanggal").eq("status", "Diterima"),
    supabase.from("po_payments").select("po_id, amount"),
    // baris jurnal kas/bank 7 hari terakhir untuk arus kas harian.
    supabase
      .from("journal_lines")
      .select("debit, credit, coa_accounts!inner(code), journal_entries!inner(tanggal)")
      .in("coa_accounts.code", ["1101", "1102"])
      .gte("journal_entries.tanggal", awal7)
      .lte("journal_entries.tanggal", today),
  ]);

  // ── Laba/Rugi ──
  const bal = balances as { code: string; type: string; saldo: number }[];
  const pendapatan = bal.filter((b) => b.type === "PENDAPATAN").reduce((a, b) => a + b.saldo, 0);
  const hpp = bal.filter((b) => b.code === "5101").reduce((a, b) => a + b.saldo, 0);
  const pengeluaran = bal.filter((b) => b.type === "BEBAN" && b.code !== "5101").reduce((a, b) => a + b.saldo, 0);
  const laba = pendapatan - hpp - pengeluaran;

  // ── Beban breakdown (opex, top 5 + lainnya) ──
  const bebanAll = (balances as { code: string; name: string; type: string; saldo: number }[])
    .filter((b) => b.type === "BEBAN" && b.code !== "5101" && b.saldo > 0)
    .map((b) => ({ name: b.name, amount: b.saldo }))
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

  // ── Penjualan (tahun ini): POS sales + invoice klinik, lunas vs belum ──
  const salesTotal = (salesRows.data ?? []).filter((s: { created_at: string }) => s.created_at >= awalTahun).reduce((a: number, s: { total: number }) => a + Number(s.total), 0);

  const paidMap = new Map<string, number>();
  for (const p of (invPays.data ?? []) as { invoice_id: string; amount: number }[]) paidMap.set(p.invoice_id, (paidMap.get(p.invoice_id) ?? 0) + Number(p.amount));
  let invTotal = 0, invBelum = 0;
  for (const i of (invRows.data ?? []) as { id: string; total: number; dp_amount: number; paid_status: string; created_at: string }[]) {
    if (i.created_at.slice(0, 10) < awalTahun) continue;
    const dibayar = Number(i.dp_amount) + (paidMap.get(i.id) ?? 0);
    invTotal += Number(i.total);
    invBelum += Math.max(0, Number(i.total) - dibayar);
  }
  // POS dianggap lunas (bayar tunai/QRIS di kasir).
  const penjTotal = salesTotal + invTotal;
  const penjualan = { total: penjTotal, lunas: penjTotal - invBelum, belumLunas: invBelum };

  // ── Pembelian (PO Diterima), lunas vs belum ──
  const poPaid = new Map<string, number>();
  for (const p of (poPays.data ?? []) as { po_id: string; amount: number }[]) poPaid.set(p.po_id, (poPaid.get(p.po_id) ?? 0) + Number(p.amount));
  let pembTotal = 0, pembBelum = 0;
  for (const po of (poRows.data ?? []) as { id: string; total: number }[]) {
    pembTotal += Number(po.total);
    pembBelum += Math.max(0, Number(po.total) - (poPaid.get(po.id) ?? 0));
  }
  const pembelian = { total: pembTotal, lunas: pembTotal - pembBelum, belumLunas: pembBelum };

  // ── Tren penjualan harian (7 hari) ──
  const trenMap = new Map<string, number>();
  for (const h of hari7) trenMap.set(h, 0);
  for (const s of (salesRows.data ?? []) as { total: number; created_at: string }[]) {
    const t = s.created_at.slice(0, 10);
    if (trenMap.has(t)) trenMap.set(t, trenMap.get(t)! + Number(s.total));
  }
  const trenPenjualan = hari7.map((t) => ({ tanggal: t, total: trenMap.get(t)! }));

  const saldoKas = bal.filter((b) => b.code === "1101" || b.code === "1102").reduce((a, b) => a + b.saldo, 0);

  return { labaRugi: { pendapatan, hpp, pengeluaran, laba }, beban, arusKas, penjualan, pembelian, trenPenjualan, saldoKas };
}
