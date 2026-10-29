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
export type SaudaraKunjungan = {
  visitId: string;
  hewan: string;
  /** Status kunjungan: Menunggu | Diperiksa | Pembayaran | Selesai */
  status: string;
};

/**
 * Versi ringan untuk layar dokter: cukup "hewan siapa saja yang datang bareng"
 * tanpa menarik tagihan. Rekam medis dibuka puluhan kali sehari — tidak perlu
 * ikut membaca invoice & pembayaran yang tidak dipakai di sana.
 *
 * Mengembalikan daftar kosong kalau pemiliknya tidak diketahui atau hanya satu
 * hewan; layar tinggal menyembunyikan tabnya.
 */
export async function bacaSaudaraKunjungan(supabase: AnyClient, visitId: string): Promise<SaudaraKunjungan[]> {
  const { data: acuan } = await supabase
    .from("visits")
    .select("customer_id, branch_id, created_at")
    .eq("id", visitId).maybeSingle();
  if (!acuan?.customer_id) return [];

  const { dari, sampai } = rentangHariWIB(acuan.created_at as string);

  const { data: visits } = await supabase
    .from("visits")
    .select("id, status, pets(name)")
    .eq("customer_id", acuan.customer_id)
    .eq("branch_id", acuan.branch_id)
    .gte("created_at", dari).lt("created_at", sampai)
    .order("created_at");

  type Row = { id: string; status: string; pets: Rel<{ name: string }> };
  const rows = (visits ?? []) as Row[];
  if (rows.length <= 1) return [];

  return rows.map((v) => ({
    visitId: v.id,
    hewan: one(v.pets)?.name ?? "—",
    status: v.status ?? "",
  }));
}

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
    .is("voided_at", null)
    .order("created_at");

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

  // Rawat inap ditagih BERTAHAP: satu kunjungan bisa punya beberapa tagihan aktif.
  // Dulu baris ini memakai Map biasa, jadi tagihan terakhir menimpa yang lain dan
  // panel rombongan menyebut total yang jauh lebih kecil dari tagihan sebenarnya.
  const invPerVisit = new Map<string, InvRow[]>();
  for (const inv of invRows) invPerVisit.set(inv.visit_id, [...(invPerVisit.get(inv.visit_id) ?? []), inv]);

  const baris: KunjunganSerombongan[] = rows.map((v) => {
    const hewan = one(v.pets)?.name ?? "—";
    const daftar = invPerVisit.get(v.id) ?? [];
    if (daftar.length === 0) {
      return { visitId: v.id, hewan, invoiceNo: null, total: 0, paidStatus: null, dibayar: 0 };
    }
    const total = daftar.reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);
    const dibayar = daftar.reduce((sum, inv) => sum + (inv.paid_status === "Lunas"
      ? Number(inv.total) || 0
      : Number(inv.dp_amount || 0) + (dibayarExtra.get(inv.id) ?? 0)), 0);
    // Beberapa tahap baru disebut lunas kalau SEMUANYA lunas; nomornya menyebut
    // tagihan tertua supaya kasir punya pegangan untuk membuka rinciannya.
    const paidStatus = daftar.every((inv) => inv.paid_status === "Lunas") ? "Lunas"
      : dibayar > 0 ? "DP" : "Belum Lunas";
    return {
      visitId: v.id, hewan,
      invoiceNo: daftar[0].invoice_no,
      invoiceNos: daftar.map((inv) => inv.invoice_no),
      total, paidStatus, dibayar,
    };
  });

  return {
    customerId: acuan.customer_id as string,
    customerName: one(acuan.customers as Rel<{ name: string }>)?.name ?? "—",
    tanggal,
    baris,
  };
}
