// Pembacaan kunjungan serombongan — dipakai layar pembayaran & struk gabungan.
// Dipisah dari keduanya supaya "siapa saja yang serombongan" tidak ditulis dua kali
// lalu melenceng satu sama lain.

import type { KunjunganSerombongan } from "./rombongan-tagihan";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

export type Rombongan = {
  customerId: string | null;
  customerName: string;
  tanggal: string;              // YYYY-MM-DD (WIB)
  baris: KunjunganSerombongan[];
};

/** Batas hari WIB dari sebuah timestamp — server bisa jalan di UTC. */
function rentangHariWIB(iso: string): { dari: string; sampai: string; tanggal: string } {
  const wib = new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
  const tanggal = wib.toISOString().slice(0, 10);
  // Kembalikan ke UTC untuk membandingkan created_at yang tersimpan dalam UTC.
  const dari = new Date(`${tanggal}T00:00:00.000Z`);
  dari.setTime(dari.getTime() - 7 * 3600 * 1000);
  const sampai = new Date(dari.getTime() + 24 * 3600 * 1000);
  return { dari: dari.toISOString(), sampai: sampai.toISOString(), tanggal };
}

/**
 * Semua kunjungan milik pemilik yang sama, di cabang yang sama, pada hari yang sama
 * dengan kunjungan yang sedang dibuka. Kunjungan itu sendiri ikut di dalamnya.
 *
 * Mengembalikan null kalau pemiliknya tidak diketahui — tanpa pemilik tidak ada
 * dasar untuk menyatakan dua kunjungan datang bersama.
 */
export async function bacaRombongan(supabase: AnyClient, visitId: string): Promise<Rombongan | null> {
  const { data: acuan } = await supabase
    .from("visits")
    .select("id, customer_id, branch_id, created_at, customers(name)")
    .eq("id", visitId).maybeSingle();
  if (!acuan?.customer_id) return null;

  const { dari, sampai, tanggal } = rentangHariWIB(acuan.created_at as string);

  const { data: visits } = await supabase
    .from("visits")
    .select("id, created_at, pets(name)")
    .eq("customer_id", acuan.customer_id)
    .eq("branch_id", acuan.branch_id)
    .gte("created_at", dari).lt("created_at", sampai)
    .order("created_at");

  type VisitRow = { id: string; pets: Rel<{ name: string }> };
  const rows = (visits ?? []) as VisitRow[];
  if (rows.length === 0) return null;

  // Tagihan aktif tiap kunjungan (yang sudah di-void tidak dihitung).
  const { data: invs } = await supabase
    .from("invoices")
    .select("id, visit_id, invoice_no, total, dp_amount, paid_status")
    .in("visit_id", rows.map((v) => v.id))
    .is("voided_at", null);

  type InvRow = { id: string; visit_id: string; invoice_no: string; total: number; dp_amount: number; paid_status: string };
  const invRows = (invs ?? []) as InvRow[];

  // Pelunasan piutang menyusul setelah invoice terbit — tanpa ini, tagihan DP yang
  // sudah dilunasi belakangan tetap terlihat kurang bayar di panel rombongan.
  const { data: pays } = invRows.length
    ? await supabase.from("invoice_payments").select("invoice_id, amount").in("invoice_id", invRows.map((i) => i.id))
    : { data: [] as { invoice_id: string; amount: number }[] };
  const dibayarExtra = new Map<string, number>();
  for (const p of (pays ?? []) as { invoice_id: string; amount: number }[]) {
    dibayarExtra.set(p.invoice_id, (dibayarExtra.get(p.invoice_id) ?? 0) + Number(p.amount));
  }

  const invPerVisit = new Map(invRows.map((i) => [i.visit_id, i]));

  const baris: KunjunganSerombongan[] = rows.map((v) => {
    const inv = invPerVisit.get(v.id);
    if (!inv) {
      return { visitId: v.id, hewan: one(v.pets)?.name ?? "—", invoiceNo: null, total: 0, paidStatus: null, dibayar: 0 };
    }
    const total = Number(inv.total) || 0;
    const dibayar = inv.paid_status === "Lunas"
      ? total
      : Number(inv.dp_amount || 0) + (dibayarExtra.get(inv.id) ?? 0);
    return {
      visitId: v.id, hewan: one(v.pets)?.name ?? "—",
      invoiceNo: inv.invoice_no, total, paidStatus: inv.paid_status, dibayar,
    };
  });

  return {
    customerId: acuan.customer_id as string,
    customerName: one(acuan.customers as Rel<{ name: string }>)?.name ?? "—",
    tanggal,
    baris,
  };
}
