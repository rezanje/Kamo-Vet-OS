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
 * Bagi bilangan bulat `jumlah` proporsional terhadap `bobot`; sisa pembulatan jatuh
 * ke bobot terbesar, jadi jumlah bagiannya selalu tepat `jumlah`.
 */
export function bagiProporsional(bobot: number[], jumlah: number): number[] {
  const dasar = bobot.map((b) => Math.max(0, Number(b) || 0));
  const total = dasar.reduce((a, b) => a + b, 0);
  const nilai = Math.max(0, Math.floor(Number(jumlah) || 0));
  if (total <= 0 || nilai <= 0) return dasar.map(() => 0);
  const bagian = dasar.map((d) => Math.floor((d * nilai) / total));
  const sisa = nilai - bagian.reduce((a, b) => a + b, 0);
  if (sisa > 0) bagian[dasar.indexOf(Math.max(...dasar))] += sisa;
  return bagian;
}

export type NotaPoin = { ref: string; dipakai: number; total: number };

/**
 * Catat pemakaian & perolehan poin satu pembayaran klinik yang bisa menerbitkan
 * beberapa nota (bayar rombongan).
 *
 * Tiap baris buku poin memakai nomor nota sebagai ref, supaya refund invoice klinik
 * (J03) bisa menemukan poin nota itu dan menyesuaikannya. Poin didapat tetap dihitung
 * dari total gabungan — sama seperti sebelum dipecah — lalu dibagi proporsional ke
 * nota. Per nota urutannya redeem dulu baru earn, sama seperti kasir, supaya saldo
 * berjalan di buku poin selalu cocok dengan saldo pelanggan.
 */
export async function catatPoinNota(
  supabase: AnyClient,
  opts: {
    customerId: string | null;
    nota: NotaPoin[];
    rupiahPerPoin: number | null;
    saldoAwal: number;
  },
): Promise<{ dipakai: number; didapat: number; saldoAkhir: number }> {
  const { customerId, rupiahPerPoin } = opts;
  const dipakaiNota = opts.nota.map((n) => Math.max(0, Math.floor(Number(n.dipakai) || 0)));
  const dipakai = dipakaiNota.reduce((a, b) => a + b, 0);
  const totalDibayar = opts.nota.reduce((a, n) => a + Math.max(0, Number(n.total) || 0), 0);
  const didapat = customerId ? poinDidapat(totalDibayar, rupiahPerPoin) : 0;
  let saldo = Math.max(0, Math.floor(Number(opts.saldoAwal) || 0));
  if (!customerId || (dipakai === 0 && didapat === 0)) return { dipakai: 0, didapat: 0, saldoAkhir: saldo };

  const didapatNota = bagiProporsional(opts.nota.map((n) => n.total), didapat);
  for (const [i, { ref }] of opts.nota.entries()) {
    if (dipakaiNota[i] > 0) {
      saldo -= dipakaiNota[i];
      await supabase.from("point_ledger").insert({
        customer_id: customerId, delta: -dipakaiNota[i], saldo, ref, description: `Poin digunakan ${ref}`,
      });
    }
    if (didapatNota[i] > 0) {
      saldo += didapatNota[i];
      await supabase.from("point_ledger").insert({
        customer_id: customerId, delta: didapatNota[i], saldo, ref, description: `Kunjungan klinik ${ref}`,
      });
    }
  }
  await supabase.from("customers").update({ points: saldo }).eq("id", customerId);
  return { dipakai, didapat, saldoAkhir: saldo };
}

/** Catat pemakaian & perolehan poin satu transaksi klinik (satu nota). */
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
  return catatPoinNota(supabase, {
    customerId: opts.customerId,
    nota: [{ ref: opts.ref, dipakai: opts.dipakai, total: opts.totalDibayar }],
    rupiahPerPoin: opts.rupiahPerPoin,
    saldoAwal: opts.saldoAwal,
  });
}
