"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";
import { kodeAkunBayar } from "@/lib/kas-akun";
import { getPajakSettings, splitPpnInklusif } from "@/lib/pajak";
import { isMarketplace } from "@/lib/online";

const back = "/keuangan/sinkron";

type MissingInvoice = {
  invoice_no: string; tanggal: string; total: number; dpp: number; tax: number;
  cashReceived: number; piutang: number; metode_bayar: string; branch_id: string | null;
};
type MissingSale = {
  no_struk: string; tanggal: string; total: number; metode_bayar: string; branch_id: string | null;
};
type MissingSaleOnline = {
  no_struk: string; tanggal: string; total: number; channel: string; branch_id: string | null;
};

// Cari transaksi operasional yang TIDAK punya jurnal (drift buku besar).
// postJournal sengaja best-effort, jadi kegagalan diam-diam bisa terjadi — halaman ini penjaganya.
export async function findDrift(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ invoices: MissingInvoice[]; sales: MissingSale[]; salesOnline: MissingSaleOnline[] }> {
  const { data: refs } = await supabase.from("journal_entries").select("source, source_ref").not("source_ref", "is", null);
  // dipisah per jenis: jurnal HPP (sale-hpp) tidak dihitung sebagai jurnal pendapatan.
  const klinikRefs = new Set((refs ?? []).filter((r) => r.source === "klinik" || r.source === "klinik-edit").map((r) => r.source_ref as string));
  const saleRefs = new Set((refs ?? []).filter((r) => r.source === "sale").map((r) => r.source_ref as string));
  const saleOnlineRefs = new Set((refs ?? []).filter((r) => r.source === "sale-online").map((r) => r.source_ref as string));

  const { data: invs } = await supabase
    .from("invoices")
    .select("invoice_no, subtotal, discount, tax, total, dp_amount, paid_status, metode_bayar, created_at, visit_id, visits(branch_id)")
    .is("voided_at", null);

  const invIds = (invs ?? []).filter((i) => i.invoice_no && !klinikRefs.has(i.invoice_no));
  const { data: pays } = await supabase.from("invoice_payments").select("invoice_id, amount");

  // pembayaran dipetakan via invoice id → perlu id juga; ambil ulang dgn id.
  const { data: invsFull } = await supabase
    .from("invoices")
    .select("id, invoice_no")
    .is("voided_at", null);
  const noToId = new Map((invsFull ?? []).map((i) => [i.invoice_no, i.id]));
  const paidMap = new Map<string, number>();
  for (const p of pays ?? []) paidMap.set(p.invoice_id, (paidMap.get(p.invoice_id) ?? 0) + Number(p.amount));

  const invoices: MissingInvoice[] = invIds.map((i) => {
    const v = Array.isArray(i.visits) ? i.visits[0] : i.visits;
    const dpp = Math.max(0, Number(i.subtotal) - Number(i.discount));
    const id = noToId.get(i.invoice_no) as string | undefined;
    // kas yang benar-benar sudah diterima = DP + pelunasan tercatat; sisanya piutang.
    // (pelunasan sudah punya jurnalnya sendiri, jadi jurnal invoice memakai posisi SAAT TERBIT:
    //  kas = dp saja; kalau status Lunas tanpa pelunasan tercatat, kas = total.)
    const paid = id ? (paidMap.get(id) ?? 0) : 0;
    const cashAtIssue = i.paid_status === "Lunas" && paid === 0 ? Number(i.total) : Number(i.dp_amount);
    const piutang = Math.max(0, Number(i.total) - cashAtIssue); // posisi piutang saat terbit
    return {
      invoice_no: i.invoice_no, tanggal: String(i.created_at).slice(0, 10),
      total: Number(i.total), dpp, tax: Number(i.tax),
      cashReceived: cashAtIssue, piutang,
      metode_bayar: i.metode_bayar ?? "Tunai", branch_id: v?.branch_id ?? null,
    };
  }).filter((i) => i.total > 0);

  // Order online punya jurnalnya sendiri (source "sale-online", akun Piutang Marketplace/Bank).
  // Dipisah dari arm "sale" biasa (akun beda) = false positive + repost dengan akun salah kalau digabung.
  const { data: sls } = await supabase
    .from("sales")
    .select("no_struk, total, metode_bayar, branch_id, created_at")
    .is("channel", null);
  const sales: MissingSale[] = (sls ?? [])
    .filter((s) => s.no_struk && !saleRefs.has(s.no_struk) && Number(s.total) > 0)
    .map((s) => ({
      no_struk: s.no_struk, tanggal: String(s.created_at).slice(0, 10),
      total: Number(s.total), metode_bayar: s.metode_bayar ?? "Tunai", branch_id: s.branch_id ?? null,
    }));

  // Order online (channel terisi) — postJournal juga best-effort di sini (lihat actions.ts online),
  // jadi drift-nya sama-sama bisa senyap: stok terpotong, marketplace_status berubah, tapi jurnal
  // pendapatan tidak pernah tercatat. Tanpa arm ini tidak ada halaman lain yang mendeteksinya.
  const { data: slsOnline } = await supabase
    .from("sales")
    .select("no_struk, total, channel, branch_id, created_at")
    .not("channel", "is", null);
  const salesOnline: MissingSaleOnline[] = (slsOnline ?? [])
    .filter((s) => s.no_struk && s.channel && !saleOnlineRefs.has(s.no_struk) && Number(s.total) > 0)
    .map((s) => ({
      no_struk: s.no_struk, tanggal: String(s.created_at).slice(0, 10),
      total: Number(s.total), channel: s.channel as string, branch_id: s.branch_id ?? null,
    }));

  return { invoices, sales, salesOnline };
}

export type DriftLain = { jenis: string; ref: string; tanggal: string; nilai: number; layar: string };

// Dokumen di luar POS/klinik/online yang kehilangan jurnalnya.
//
// Sengaja DETEKSI SAJA, tanpa tombol posting ulang: memilih akun lawan untuk faktur
// pembelian, gaji, atau kas keluar butuh konteks dokumennya (rekening mana, akun beban
// mana). Menebaknya di sini justru menghasilkan jurnal yang salah tapi terlihat beres.
// Yang dibutuhkan pemakai adalah TAHU dokumen mana yang bolong, lalu membukanya lagi.
export async function findDriftLain(supabase: Awaited<ReturnType<typeof createClient>>): Promise<DriftLain[]> {
  const { data: refs } = await supabase.from("journal_entries").select("source, source_ref").not("source_ref", "is", null);
  const punya = (source: string, ref: string) =>
    (refs ?? []).some((r) => r.source === source && r.source_ref === ref);

  const [faktur, bayar, gaji, kas, transfer, returJual, returBeli] = await Promise.all([
    supabase.from("purchase_invoices").select("no_faktur, tanggal, total"),
    supabase.from("purchase_invoice_payments").select("amount, tanggal, purchase_invoices(no_faktur)"),
    // Hanya slip yang SUDAH disahkan yang punya jurnal; yang masih draft memang belum.
    supabase.from("payrolls").select("periode, total").eq("status", "final"),
    supabase.from("cash_entries").select("no_bukti, tanggal, jumlah").is("voided_at", null),
    supabase.from("cash_transfers").select("no_transfer, tanggal, jumlah").is("voided_at", null),
    supabase.from("sales_returns").select("no_retur, tanggal, total"),
    supabase.from("purchase_returns").select("no_retur, tanggal, total"),
  ]);

  const out: DriftLain[] = [];
  const tambah = (ok: boolean, d: DriftLain) => { if (!ok) out.push(d); };

  for (const f of (faktur.data ?? []) as { no_faktur: string; tanggal: string; total: number }[]) {
    tambah(punya("purchase-invoice", f.no_faktur),
      { jenis: "Faktur Pembelian", ref: f.no_faktur, tanggal: f.tanggal, nilai: Number(f.total), layar: "/pembelian/faktur" });
  }
  for (const p of (bayar.data ?? []) as { amount: number; tanggal: string; purchase_invoices: { no_faktur: string } | { no_faktur: string }[] | null }[]) {
    const inv = Array.isArray(p.purchase_invoices) ? p.purchase_invoices[0] : p.purchase_invoices;
    if (!inv?.no_faktur) continue;
    tambah(punya("purchase-pay", inv.no_faktur),
      { jenis: "Pembayaran Hutang", ref: inv.no_faktur, tanggal: p.tanggal, nilai: Number(p.amount), layar: "/keuangan/hutang" });
  }
  // payrolls = satu baris per KARYAWAN; jurnalnya satu per periode → dijumlahkan dulu.
  const perPeriode = new Map<string, number>();
  for (const g of (gaji.data ?? []) as { periode: string; total: number }[]) {
    perPeriode.set(g.periode, (perPeriode.get(g.periode) ?? 0) + Number(g.total));
  }
  for (const [periode, nilai] of perPeriode) {
    tambah(punya("payroll", periode),
      { jenis: "Penggajian", ref: periode, tanggal: `${periode}-01`, nilai, layar: "/hris/penggajian" });
  }
  for (const k of (kas.data ?? []) as { no_bukti: string; tanggal: string; jumlah: number }[]) {
    tambah(punya("kas-entry", k.no_bukti),
      { jenis: "Kas Masuk/Keluar", ref: k.no_bukti, tanggal: k.tanggal, nilai: Number(k.jumlah), layar: "/kas-bank/kas" });
  }
  for (const t of (transfer.data ?? []) as { no_transfer: string; tanggal: string; jumlah: number }[]) {
    tambah(punya("transfer", t.no_transfer),
      { jenis: "Transfer Rekening", ref: t.no_transfer, tanggal: t.tanggal, nilai: Number(t.jumlah), layar: "/kas-bank/transfer" });
  }
  for (const r of (returJual.data ?? []) as { no_retur: string; tanggal: string; total: number }[]) {
    tambah(punya("sales-return", r.no_retur),
      { jenis: "Retur Penjualan", ref: r.no_retur, tanggal: r.tanggal, nilai: Number(r.total), layar: "/penjualan/retur" });
  }
  for (const r of (returBeli.data ?? []) as { no_retur: string; tanggal: string; total: number }[]) {
    tambah(punya("purchase-return", r.no_retur),
      { jenis: "Retur Pembelian", ref: r.no_retur, tanggal: r.tanggal, nilai: Number(r.total), layar: "/pembelian/retur" });
  }

  return out.sort((a, b) => a.tanggal.localeCompare(b.tanggal));
}

// Posting ulang jurnal yang hilang. Idempotent: hanya memproses yang masih hilang saat dijalankan.
export async function perbaikiDrift() {
  const supabase = await createClient();
  const { invoices, sales, salesOnline } = await findDrift(supabase);

  let n = 0;
  for (const i of invoices) {
    const kasCode = await kodeAkunBayar(supabase, i.metode_bayar, i.branch_id);
    await postJournal(supabase, {
      tanggal: i.tanggal,
      deskripsi: `Sinkronisasi: pendapatan jasa klinik ${i.invoice_no}`,
      source: "klinik",
      sourceRef: i.invoice_no,
      branchId: i.branch_id,
      lines: [
        ...(i.cashReceived > 0 ? [{ code: kasCode, debit: i.cashReceived, credit: 0 }] : []),
        ...(i.piutang > 0 ? [{ code: "1201", debit: i.piutang, credit: 0 }] : []),
        { code: "4201", debit: 0, credit: i.dpp },
        ...(i.tax > 0 ? [{ code: "2201", debit: 0, credit: i.tax }] : []),
      ],
    });
    n += 1;
  }

  const pajak = await getPajakSettings(supabase);
  for (const s of sales) {
    const kasCode = await kodeAkunBayar(supabase, s.metode_bayar, s.branch_id);
    const { dpp, ppn } = splitPpnInklusif(Number(s.total), pajak);
    await postJournal(supabase, {
      tanggal: s.tanggal,
      deskripsi: `Sinkronisasi: penjualan POS ${s.no_struk}`,
      source: "sale",
      sourceRef: s.no_struk,
      branchId: s.branch_id,
      lines: [
        { code: kasCode, debit: s.total, credit: 0 },
        { code: "4101", debit: 0, credit: dpp },
        ...(ppn > 0 ? [{ code: "2201", debit: 0, credit: ppn }] : []),
      ],
    });
    n += 1;
  }

  for (const s of salesOnline) {
    // Marketplace ditahan platform → piutang (1202); WA langsung ke bank (1102) — sama seperti
    // jurnal asli di penjualan/online/actions.ts.
    const debitCode = isMarketplace(s.channel) ? "1202" : await kodeAkunBayar(supabase, "Transfer", s.branch_id);
    const { dpp, ppn } = splitPpnInklusif(Number(s.total), pajak);
    await postJournal(supabase, {
      tanggal: s.tanggal,
      deskripsi: `Sinkronisasi: penjualan online ${s.channel} ${s.no_struk}`,
      source: "sale-online",
      sourceRef: s.no_struk,
      branchId: s.branch_id,
      lines: [
        { code: debitCode, debit: s.total, credit: 0 },
        { code: "4101", debit: 0, credit: dpp },
        ...(ppn > 0 ? [{ code: "2201", debit: 0, credit: ppn }] : []),
      ],
    });
    n += 1;
  }

  redirect(`${back}?success=${n}`);
}
