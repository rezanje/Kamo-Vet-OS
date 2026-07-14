"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { postJournal } from "@/lib/posting";

const back = "/keuangan/sinkron";

type MissingInvoice = {
  invoice_no: string; tanggal: string; total: number; dpp: number; tax: number;
  cashReceived: number; piutang: number; metode_bayar: string; branch_id: string | null;
};
type MissingSale = {
  no_struk: string; tanggal: string; total: number; metode_bayar: string; branch_id: string | null;
};

// Cari transaksi operasional yang TIDAK punya jurnal (drift buku besar).
// postJournal sengaja best-effort, jadi kegagalan diam-diam bisa terjadi — halaman ini penjaganya.
export async function findDrift(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ invoices: MissingInvoice[]; sales: MissingSale[] }> {
  const { data: refs } = await supabase.from("journal_entries").select("source, source_ref").not("source_ref", "is", null);
  // dipisah per jenis: jurnal HPP (sale-hpp) tidak dihitung sebagai jurnal pendapatan.
  const klinikRefs = new Set((refs ?? []).filter((r) => r.source === "klinik" || r.source === "klinik-edit").map((r) => r.source_ref as string));
  const saleRefs = new Set((refs ?? []).filter((r) => r.source === "sale").map((r) => r.source_ref as string));

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

  const { data: sls } = await supabase
    .from("sales")
    .select("no_struk, total, metode_bayar, branch_id, created_at");
  const sales: MissingSale[] = (sls ?? [])
    .filter((s) => s.no_struk && !saleRefs.has(s.no_struk) && Number(s.total) > 0)
    .map((s) => ({
      no_struk: s.no_struk, tanggal: String(s.created_at).slice(0, 10),
      total: Number(s.total), metode_bayar: s.metode_bayar ?? "Tunai", branch_id: s.branch_id ?? null,
    }));

  return { invoices, sales };
}

// Posting ulang jurnal yang hilang. Idempotent: hanya memproses yang masih hilang saat dijalankan.
export async function perbaikiDrift() {
  const supabase = await createClient();
  const { invoices, sales } = await findDrift(supabase);

  let n = 0;
  for (const i of invoices) {
    const kasCode = i.metode_bayar === "Tunai" ? "1101" : "1102";
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

  for (const s of sales) {
    const kasCode = s.metode_bayar === "Tunai" ? "1101" : "1102";
    const dpp = Math.round((s.total * 100) / 111);
    const ppn = s.total - dpp;
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

  redirect(`${back}?success=${n}`);
}
