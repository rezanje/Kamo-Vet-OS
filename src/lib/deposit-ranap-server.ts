// Pembacaan deposit rawat inap. Dipisah dari rumusnya (deposit-ranap.ts) supaya
// rumus tetap bisa diuji tanpa database.
//
// Semua pembacaan di sini GAGAL TERTUTUP: saldo yang tidak terbaca dikembalikan
// sebagai null, bukan nol. Menganggapnya nol berarti pemilik membayar penuh di
// kasir padahal uangnya sudah dititipkan — uang yang sama diterima dua kali.

import { saldoDeposit } from "./deposit-ranap";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type DepositRanap = {
  id: string;
  no_deposit: string;
  tanggal: string;
  jumlah: number;
  terpakai: number;
  dikembalikan: number;
  metode: string;
  catatan: string | null;
  status: string;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
};

const KOLOM = "id, no_deposit, tanggal, jumlah, terpakai, dikembalikan, metode, catatan, status, created_at, voided_at, void_reason, refunded_at, refund_reason";

function rapikan(rows: Record<string, unknown>[]): DepositRanap[] {
  return rows.map((r) => ({
    id: String(r.id), no_deposit: String(r.no_deposit), tanggal: String(r.tanggal),
    jumlah: Number(r.jumlah) || 0, terpakai: Number(r.terpakai) || 0,
    dikembalikan: Number(r.dikembalikan) || 0, metode: String(r.metode),
    catatan: (r.catatan as string | null) ?? null, status: String(r.status ?? "aktif"),
    created_at: String(r.created_at),
    voided_at: (r.voided_at as string | null) ?? null,
    void_reason: (r.void_reason as string | null) ?? null,
    refunded_at: (r.refunded_at as string | null) ?? null,
    refund_reason: (r.refund_reason as string | null) ?? null,
  }));
}

/** Semua deposit satu kunjungan (termasuk yang dibatalkan) — null kalau tidak terbaca. */
export async function bacaDepositVisit(supabase: AnyClient, visitId: string): Promise<DepositRanap[] | null> {
  const { data, error } = await supabase
    .from("inpatient_deposits").select(KOLOM).eq("visit_id", visitId)
    .order("tanggal").order("created_at");
  if (error) return null;
  return rapikan((data ?? []) as Record<string, unknown>[]);
}

/** Deposit satu periode rawat inap — dipakai layar detail rawat inap. */
export async function bacaDepositRecord(supabase: AnyClient, recordId: string): Promise<DepositRanap[] | null> {
  const { data, error } = await supabase
    .from("inpatient_deposits").select(KOLOM).eq("inpatient_record_id", recordId)
    .order("tanggal").order("created_at");
  if (error) return null;
  return rapikan((data ?? []) as Record<string, unknown>[]);
}

/** Saldo titipan kunjungan yang masih bisa memotong tagihan. null = belum terbaca. */
export async function bacaSaldoDepositVisit(supabase: AnyClient, visitId: string): Promise<number | null> {
  const rows = await bacaDepositVisit(supabase, visitId);
  return rows === null ? null : saldoDeposit(rows);
}
