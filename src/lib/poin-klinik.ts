// Poin loyalty di klinik — mesin yang sama dengan kasir petshop (permintaan
// Pak Aldi, meeting 14 Agustus: "promo, voucher, dan poin harus muncul di klinik
// persis seperti di petshop").
//
// Dipisah ke sini karena dipakai dua jalur: bayar per hewan dan bayar rombongan.

import { poinDidapat } from "./harga-golongan";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/** Nilai tukar penukaran poin — sama dengan kasir: 1 poin = Rp1. */
export const RUPIAH_PER_POIN = 1;

export type PoinPelanggan = { saldo: number; rupiahPerPoin: number | null };

/** Saldo poin & rumus perolehan menurut golongan pelanggan (dibaca dari master). */
export async function bacaPoinPelanggan(
  supabase: AnyClient,
  customerId: string | null,
): Promise<PoinPelanggan> {
  if (!customerId) return { saldo: 0, rupiahPerPoin: null };
  const { data } = await supabase
    .from("customers")
    .select("points, customer_categories(rupiah_per_poin, is_active)")
    .eq("id", customerId).maybeSingle();

  const rel = data?.customer_categories as
    | { rupiah_per_poin: number; is_active: boolean }
    | { rupiah_per_poin: number; is_active: boolean }[] | null | undefined;
  const kat = Array.isArray(rel) ? rel[0] : rel;
  return {
    saldo: Number(data?.points) || 0,
    rupiahPerPoin: kat?.is_active ? Number(kat.rupiah_per_poin) : null,
  };
}

/**
 * Berapa poin yang BOLEH dipakai: tidak melebihi saldo, dan tidak melebihi
 * tagihan yang tersisa. Poin yang "hangus" karena melebihi tagihan tidak pernah
 * dipotong dari saldo.
 */
export function poinTerpakai(diminta: number, saldo: number, sisaTagihan: number): number {
  const minta = Math.max(0, Math.floor(Number(diminta) || 0));
  const punya = Math.max(0, Math.floor(Number(saldo) || 0));
  const batasTagihan = Math.max(0, Math.floor(Number(sisaTagihan) || 0) / RUPIAH_PER_POIN);
  return Math.floor(Math.min(minta, punya, batasTagihan));
}

/**
 * Catat pemakaian & perolehan poin satu transaksi klinik.
 *
 * Urutannya redeem dulu baru earn, sama seperti kasir, supaya saldo berjalan di
 * buku poin selalu cocok dengan saldo pelanggan.
 */
export async function catatPoinKlinik(
  supabase: AnyClient,
  opts: {
    customerId: string | null;
    ref: string;
    dipakai: number;
    totalDibayar: number;
    rupiahPerPoin: number | null;
    saldoAwal: number;
  },
): Promise<{ dipakai: number; didapat: number; saldoAkhir: number }> {
  const { customerId, ref, rupiahPerPoin } = opts;
  const dipakai = Math.max(0, Math.floor(Number(opts.dipakai) || 0));
  const didapat = customerId ? poinDidapat(opts.totalDibayar, rupiahPerPoin) : 0;
  let saldo = Math.max(0, Math.floor(Number(opts.saldoAwal) || 0));
  if (!customerId || (dipakai === 0 && didapat === 0)) return { dipakai: 0, didapat: 0, saldoAkhir: saldo };

  if (dipakai > 0) {
    saldo -= dipakai;
    await supabase.from("point_ledger").insert({
      customer_id: customerId, delta: -dipakai, saldo, ref, description: `Poin digunakan ${ref}`,
    });
  }
  if (didapat > 0) {
    saldo += didapat;
    await supabase.from("point_ledger").insert({
      customer_id: customerId, delta: didapat, saldo, ref, description: `Kunjungan klinik ${ref}`,
    });
  }
  await supabase.from("customers").update({ points: saldo }).eq("id", customerId);
  return { dipakai, didapat, saldoAkhir: saldo };
}
