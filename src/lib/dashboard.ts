// Agregat dashboard keuangan (ala Accurate). Read-only, hitung di JS.
import { completeReportQuery } from "./report-query";
import { getAccountBalances, nilaiSeksi } from "./ledger";
import { kodeSemuaRekening } from "./kas-akun";
import { sisaFakturablePerBaris, type ItemFakturPoTersimpan } from "./faktur-beli";
import { isCompletedSale, type SaleCompletion } from "./sale-payment-reporting";
import { akunHpp } from "./coa-sistem";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

const iso = (d: Date) => d.toISOString().slice(0, 10);

export type Dashboard = {
  labaRugi: { pendapatan: number; hpp: number; pengeluaran: number; laba: number };
  beban: { name: string; amount: number }[];
  arusKas: { tanggal: string; masuk: number; keluar: number }[];
  penjualan: { total: number; lunas: number; belumLunas: number };
  pembelian: { total: number; lunas: number; belumLunas: number };
  /** PO diterima yang sisa belum difakturkannya tidak dapat dihitung (lihat Hutang Usaha). */
  poPerluTinjau: number;
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

  // Batas API 1.000 baris per permintaan memotong data diam-diam (9 Nov 2026: 3.790 transaksi
  // kasir dan 3.522 baris kas 7 hari, terbaca masing-masing 1.000) — penjualan & arus kas jadi
  // kurang. Daftar yang bisa melewati batas itu dibaca lengkap; arus kas dijumlah di database.
  const [balances, kasirKlinik, salesReturnRows, fjRows, fjReceipts, poRows, poFaktur, poRetur, cashTotals] = await Promise.all([
    getAccountBalances(supabase, { from: awalTahun, to: today }),
    // Kasir (tahun berjalan + jendela 7 hari) dan tagihan klinik: dijumlah di database.
    ringkasKasirKlinik(supabase, awalTahun, awal7, today, hari7),
    // Return corrections restate the original open date. Include both YTD and
    // the complete seven-day window, which can begin in the preceding year.
    completeReportQuery(supabase.from("sales_returns").select("id,total,tanggal", { count: "exact" }).is("voided_at", null)
      .gte("tanggal", awal7 < awalTahun ? awal7 : awalTahun).lte("tanggal", today)),
    // Retain prior-year/cancelled sources: their dated reversals may fall in
    // this year or the seven-day trend. Current settlement is computed separately.
    completeReportQuery(supabase.from("sales_invoices")
      .select("id, total, tanggal, status, voided_on, carried_paid, returned_ar", { count: "exact" }).is("opening_batch_id", null).lte("tanggal", today)),
    completeReportQuery(supabase.from("sales_receipts")
      .select("id, invoice_id, tanggal, jumlah", { count: "exact" }).lte("tanggal", today)),
    supabase.from("purchase_orders").select("id, purchase_order_items(id,item_id,qty,qty_terima,harga_beli,faktor)").eq("status", "Diterima"),
    // Pelunasan pembelian hidup di purchase_invoice_payments (lewat Faktur Pembelian).
    // Tabel po_payments sudah tidak ditulis layar mana pun — membacanya bikin dashboard
    // selalu melaporkan seluruh PO sebagai belum dibayar.
    supabase.from("purchase_invoices").select("po_id, total, purchase_invoice_items(po_item_id,item_id,qty,faktor), purchase_invoice_payments(amount)").is("voided_at", null).is("opening_batch_id", null),
    supabase.from("purchase_returns").select("po_id, total").is("voided_at", null),
    // Arus kas harian 7 hari: total debit/kredit per akun per hari, dihitung di database
    // (RPC yang sama dengan saldo akun; hak baca setara RLS jurnal).
    kodeRekening.length === 0 ? Promise.resolve([]) : Promise.all(hari7.map(async (hari) => {
      const { data, error } = await supabase.rpc("ledger_account_totals", { p_from: hari, p_to: hari, p_branch_ids: null });
      if (error || !Array.isArray(data)) throw new Error(`Arus kas dashboard gagal dibaca: ${error?.message ?? "data tidak tersedia"}`);
      return { hari, rows: data as { account_id: string; debit: number | string; credit: number | string }[] };
    })),
  ]);

  // ── Laba/Rugi ──
  const bal = balances as { code: string; name: string; type: string; normal: string; saldo: number }[];
  const pendapatan = bal.filter((b) => b.type === "PENDAPATAN").reduce((a, b) => a + nilaiSeksi(b), 0);
  const hpp = bal.filter((b) => akunHpp(b.code)).reduce((a, b) => a + nilaiSeksi(b), 0);
  const pengeluaran = bal.filter((b) => b.type === "BEBAN" && !akunHpp(b.code)).reduce((a, b) => a + nilaiSeksi(b), 0);
  const laba = pendapatan - hpp - pengeluaran;

  // ── Beban breakdown (opex, top 5 + lainnya) ──
  const bebanAll = bal
    .filter((b) => b.type === "BEBAN" && !akunHpp(b.code) && nilaiSeksi(b) > 0)
    .map((b) => ({ name: b.name, amount: nilaiSeksi(b) }))
    .sort((a, b) => b.amount - a.amount);
  const beban = bebanAll.slice(0, 5);
  const lainnya = bebanAll.slice(5).reduce((a, b) => a + b.amount, 0);
  if (lainnya > 0) beban.push({ name: "Lainnya", amount: lainnya });

  // ── Arus kas harian (7 hari) ──
  const setRekening = new Set(kodeRekening);
  const idRekening = new Set((balances as { id: string; code: string }[]).filter((b) => setRekening.has(b.code)).map((b) => b.id));
  const cashByDay = new Map<string, { masuk: number; keluar: number }>();
  for (const h of hari7) cashByDay.set(h, { masuk: 0, keluar: 0 });
  for (const { hari, rows } of cashTotals) {
    const bucket = cashByDay.get(hari)!;
    for (const r of rows) if (idRekening.has(r.account_id)) { bucket.masuk += Number(r.debit); bucket.keluar += Number(r.credit); }
  }
  const arusKas = hari7.map((t) => ({ tanggal: t, ...cashByDay.get(t)! }));

  // ── Penjualan (tahun ini): POS + Online + invoice klinik + faktur reseller, lunas vs belum ──
  if (salesReturnRows.error) throw new Error("Retur penjualan dashboard belum dapat diverifikasi.");
  const customerReturns = (salesReturnRows.data ?? []) as { total: number; tanggal: string }[];
  const salesTotal = kasirKlinik.kasirTotal
    - customerReturns.filter(row => row.tanggal >= awalTahun).reduce((sum, row) => sum + Number(row.total), 0);
  const invTotal = kasirKlinik.klinikTotal, invBelum = kasirKlinik.klinikBelum;
  // POS dianggap lunas (bayar tunai/QRIS di kasir). Order online marketplace TIDAK —
  // dana ditahan platform di akun 130009 Piutang Marketplace sampai "Tandai cair" dijalankan,
  // jadi ikut dihitung belum lunas selama marketplace_status masih 'piutang'.
  const salesBelumLunas = kasirKlinik.kasirPiutang;
  // Faktur reseller: yang sudah masuk = penerimaan penjualan (termasuk porsi uang muka).
  const fjPaid = new Map<string, number>();
  for (const r of (fjReceipts.data ?? []) as { invoice_id: string; jumlah: number }[]) {
    fjPaid.set(r.invoice_id, (fjPaid.get(r.invoice_id) ?? 0) + Number(r.jumlah));
  }
  type ResellerInvoice = { id: string; total: number; tanggal: string; status: string; voided_on: string | null; carried_paid: number; returned_ar?: number | null };
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
      const paid = Math.min(total, Number(f.carried_paid ?? 0) + Number(f.returned_ar ?? 0) + (fjPaid.get(f.id) ?? 0));
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
  let pembTotal = 0, pembBelum = 0, poPerluTinjau = 0;
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
    const current = purchases.get(po.id) ?? { total: 0, paid: 0 };
    // Satu PO bermasalah tidak boleh menjatuhkan seluruh dashboard (7 Nov 2026: Owner
    // tidak bisa membuka dashboard sama sekali). Sama dengan Hutang Usaha: sisa belum
    // difakturkan PO ini tidak ditambahkan dan PO-nya dihitung sebagai perlu ditinjau.
    if (remaining.invalidLinkedLines || remaining.invalidPoItemIds.length || remaining.legacyAmbiguousItemIds.length) {
      poPerluTinjau += 1;
      purchases.set(po.id, current);
      continue;
    }
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
  for (const [t, total] of kasirKlinik.kasirHarian) {
    if (trenMap.has(t)) trenMap.set(t, trenMap.get(t)! + total);
  }
  for (const row of customerReturns) {
    if (trenMap.has(row.tanggal)) trenMap.set(row.tanggal, trenMap.get(row.tanggal)! - Number(row.total));
  }
  for (const movement of fjMovements) {
    if (trenMap.has(movement.tanggal)) trenMap.set(movement.tanggal, trenMap.get(movement.tanggal)! + movement.total);
  }
  const trenPenjualan = hari7.map((t) => ({ tanggal: t, total: trenMap.get(t)! }));

  // Semua rekening kas/bank dari master — bukan daftar mati 110003/120002, supaya kartu ini
  // sama angkanya dengan laporan Arus Kas ketika ada rekening QRIS/e-wallet/bank baru.
  const saldoKas = bal.filter((b) => setRekening.has(b.code)).reduce((a, b) => a + b.saldo, 0);

  return { labaRugi: { pendapatan, hpp, pengeluaran, laba }, beban, arusKas, penjualan, pembelian, poPerluTinjau, trenPenjualan, saldoKas };
}

type KasirKlinik = { kasirTotal: number; kasirPiutang: number; kasirHarian: Map<string, number>; klinikTotal: number; klinikBelum: number };
const RINGKAS_RPC = "dashboard_penjualan_ringkas";

const angka = (v: unknown, label: string) => {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !Number.isFinite(n)) throw new Error(`Ringkasan penjualan dashboard tidak lengkap (${label}).`);
  return n;
};

/**
 * Penjualan kasir (tahun berjalan + 7 hari) dan tagihan klinik tahun berjalan.
 * Jalur utama: satu RPC agregat (migrasi 20261118045543) — tidak menarik seluruh struk tahun berjalan
 * ke aplikasi 500 baris per permintaan (18 Nov 2026: dashboard lama sekali terbuka).
 * Jalur lama (baca semua baris lalu jumlah di sini) hanya dipakai bila fungsi itu belum terpasang.
 */
async function ringkasKasirKlinik(supabase: AnyClient, awalTahun: string, awal7: string, today: string, hari7: string[]): Promise<KasirKlinik> {
  const { data, error } = typeof supabase.rpc === "function"
    ? await supabase.rpc(RINGKAS_RPC, { p_awal_tahun: awalTahun, p_awal7: awal7, p_hari_ini: today })
    : { data: null, error: { code: "PGRST202", message: RINGKAS_RPC } };
  if (!error) {
    const d = data as { kasir_total?: unknown; kasir_piutang?: unknown; kasir_harian?: unknown; klinik_total?: unknown; klinik_belum?: unknown } | null;
    if (!d || !Array.isArray(d.kasir_harian)) throw new Error("Ringkasan penjualan dashboard tidak tersedia.");
    const kasirHarian = new Map<string, number>();
    for (const row of d.kasir_harian as { tanggal?: unknown; total?: unknown }[]) {
      if (typeof row?.tanggal !== "string") throw new Error("Ringkasan penjualan dashboard tidak lengkap (tanggal).");
      kasirHarian.set(row.tanggal, angka(row.total, "tren harian"));
    }
    return {
      kasirTotal: angka(d.kasir_total, "kasir"), kasirPiutang: angka(d.kasir_piutang, "piutang kasir"), kasirHarian,
      klinikTotal: angka(d.klinik_total, "klinik"), klinikBelum: angka(d.klinik_belum, "sisa klinik"),
    };
  }
  const belumTerpasang = (error.code === "PGRST202" || error.code === "42883") && String(error.message ?? "").includes(RINGKAS_RPC);
  if (!belumTerpasang) throw Object.assign(new Error(`Ringkasan penjualan dashboard gagal dibaca: ${error.message}`), { code: error.code });

  const awalBaca = awal7 < awalTahun ? awal7 : awalTahun;
  const [salesRows, invRows, invPays] = await Promise.all([
    completeReportQuery(supabase.from("sales")
      .select("id, total, created_at, marketplace_status, payment_plan, payments_finalized_at, voided_at", { count: "exact" })
      .gte("created_at", awalBaca)),
    completeReportQuery(supabase.from("invoices").select("id, total, dp_amount, created_at", { count: "exact" })
      .is("voided_at", null).gte("created_at", awalTahun)),
    completeReportQuery(supabase.from("invoice_payments").select("id, invoice_id, amount", { count: "exact" })),
  ]);
  const completed = ((salesRows.data ?? []) as (SaleCompletion & { total: number; created_at: string; marketplace_status: string | null })[]).filter(isCompletedSale);
  const tahunIni = completed.filter((s) => s.created_at >= awalTahun);
  const kasirHarian = new Map<string, number>();
  const hariSet = new Set(hari7);
  for (const s of completed) {
    const t = s.created_at.slice(0, 10);
    if (hariSet.has(t)) kasirHarian.set(t, (kasirHarian.get(t) ?? 0) + Number(s.total));
  }
  const paidMap = new Map<string, number>();
  for (const p of (invPays.data ?? []) as { invoice_id: string; amount: number }[]) paidMap.set(p.invoice_id, (paidMap.get(p.invoice_id) ?? 0) + Number(p.amount));
  let klinikTotal = 0, klinikBelum = 0;
  for (const i of (invRows.data ?? []) as { id: string; total: number; dp_amount: number; created_at: string }[]) {
    if (i.created_at.slice(0, 10) < awalTahun) continue;
    const dibayar = Number(i.dp_amount) + (paidMap.get(i.id) ?? 0);
    klinikTotal += Number(i.total);
    klinikBelum += Math.max(0, Number(i.total) - dibayar);
  }
  return {
    kasirTotal: tahunIni.reduce((a, s) => a + Number(s.total), 0),
    kasirPiutang: tahunIni.filter((s) => s.marketplace_status === "piutang").reduce((a, s) => a + Number(s.total), 0),
    kasirHarian, klinikTotal, klinikBelum,
  };
}
