// Retur Penjualan untuk Faktur Penjualan grosir (N01/J01, keputusan pemilik 29 Okt 2026).
//
// Database (post_wholesale_return / void_wholesale_return) adalah sumber kebenaran: semua angka
// dihitung ulang dan dikunci di sana. File ini hanya menyiapkan tombol, batas qty, dan pratinjau
// supaya pengguna melihat dampaknya sebelum menyimpan. Rumus pratinjau sengaja sama dengan SQL:
// nilai pendapatan/diskon/PPN kumulatif terhadap nilai jurnal faktur, sehingga retur seluruh qty
// membalik persis fakturnya.
import Decimal from "decimal.js";

/** Membuat retur: sama dengan peran penerimaan grosir (OWNER/ADMIN/FINANCE aktif). */
export const PERAN_RETUR_GROSIR = ["OWNER", "ADMIN", "FINANCE"] as const;
/** Membatalkan retur = koreksi pembukuan: OWNER/FINANCE aktif, sama dengan koreksi grosir J01. */
export const PERAN_BATAL_RETUR_GROSIR = ["OWNER", "FINANCE"] as const;

type Profil = { role?: string | null; is_active?: boolean | null } | null | undefined;
export function bisaReturGrosir(profile: Profil): boolean {
  return profile?.is_active === true && (PERAN_RETUR_GROSIR as readonly string[]).includes(profile.role ?? "");
}
export function bisaBatalReturGrosir(profile: Profil): boolean {
  return profile?.is_active === true && (PERAN_BATAL_RETUR_GROSIR as readonly string[]).includes(profile.role ?? "");
}

export type FakturUntukRetur = {
  status: string;
  order_id: string | null;
  opening_batch_id: string | null;
  kategori: string | null;
};

/** Alasan faktur tidak bisa diretur, atau null kalau boleh. */
export function alasanTidakBisaRetur(faktur: FakturUntukRetur, adaPengganti: boolean): string | null {
  if (faktur.status === "batal") return "Faktur sudah dibatalkan. Buat retur dari faktur penggantinya.";
  if (adaPengganti) return "Faktur ini sudah diganti faktur lain. Buka faktur terbaru.";
  if (faktur.opening_batch_id) return "Faktur saldo awal tidak punya barang yang bisa diretur.";
  if ((faktur.kategori ?? "penjualan") === "selisih_stok") return "Faktur selisih stok lahir dari opname, bukan penjualan ke pelanggan.";
  if (!faktur.order_id) return "Faktur ini tidak terhubung ke pesanan dan pengiriman, jadi modal barangnya tidak bisa dipulihkan.";
  return null;
}

/** Sisa piutang faktur grosir: total − pembayaran terbawa − pengurang retur − penerimaan. */
export function sisaPiutangGrosir(faktur: { status?: string | null; total: number | string; carried_paid?: number | string | null; returned_ar?: number | string | null }, penerimaan: number): number {
  if ((faktur.status ?? "") === "batal") return 0;
  const sisa = new Decimal(Number(faktur.total) || 0)
    .minus(Number(faktur.carried_paid ?? 0) || 0)
    .minus(Number(faktur.returned_ar ?? 0) || 0)
    .minus(penerimaan || 0);
  return Decimal.max(sisa, 0).toNumber();
}

export type BarisFakturRetur = {
  id: string; nama: string; satuan: string | null;
  qty: number; harga: number; diskon: number; hpp: number;
  /** Barang persediaan (masuk gudang lagi); jasa/teks bebas tidak. */
  stok: boolean;
};
export type ReturAktif = {
  gross: number; diskon: number; ppn: number;
  items: { invoice_item_id: string; qty: number; gross: number; diskon: number; hpp: number }[];
};

/** Qty yang masih bisa diretur per baris faktur (qty faktur − retur aktif). */
export function sisaQtyRetur(baris: BarisFakturRetur[], aktif: ReturAktif[]): Map<string, number> {
  const terpakai = new Map<string, Decimal>();
  for (const r of aktif) for (const i of r.items) {
    terpakai.set(i.invoice_item_id, (terpakai.get(i.invoice_item_id) ?? new Decimal(0)).plus(i.qty));
  }
  return new Map(baris.map((b) => [b.id, Decimal.max(new Decimal(b.qty).minus(terpakai.get(b.id) ?? 0), 0).toNumber()]));
}

export type PratinjauRetur = { gross: number; diskon: number; ppn: number; total: number; piutang: number; kredit: number; hpp: number; valid: boolean };

const round0 = (d: Decimal) => d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/**
 * Pratinjau nilai satu retur baru. `faktur.dpp/ppn` = nilai faktur; `sisaPiutang` = sebelum retur ini.
 * Bagian yang melebihi sisa piutang menjadi kredit pelanggan (akun 2103), bukan uang keluar.
 */
export function pratinjauRetur(input: {
  faktur: { dpp: number; ppn: number };
  baris: BarisFakturRetur[];
  aktif: ReturAktif[];
  qty: Record<string, number>;
  sisaPiutang: number;
}): PratinjauRetur {
  const sisa = sisaQtyRetur(input.baris, input.aktif);
  let srcGross = new Decimal(0), srcDisc = new Decimal(0);
  for (const b of input.baris) { srcGross = srcGross.plus(new Decimal(b.qty).times(b.harga)); srcDisc = srcDisc.plus(b.diskon); }
  let prevG = new Decimal(0), prevD = new Decimal(0), prevP = new Decimal(0), prevLineG = new Decimal(0), prevLineD = new Decimal(0);
  const prevPerBaris = new Map<string, { qty: Decimal; diskon: Decimal; hpp: Decimal }>();
  for (const r of input.aktif) {
    prevG = prevG.plus(r.gross); prevD = prevD.plus(r.diskon); prevP = prevP.plus(r.ppn);
    for (const i of r.items) {
      prevLineG = prevLineG.plus(i.gross); prevLineD = prevLineD.plus(i.diskon);
      const p = prevPerBaris.get(i.invoice_item_id) ?? { qty: new Decimal(0), diskon: new Decimal(0), hpp: new Decimal(0) };
      prevPerBaris.set(i.invoice_item_id, { qty: p.qty.plus(i.qty), diskon: p.diskon.plus(i.diskon), hpp: p.hpp.plus(i.hpp) });
    }
  }
  let lineG = new Decimal(0), lineD = new Decimal(0), hpp = new Decimal(0), valid = true, ada = false;
  for (const b of input.baris) {
    const q = Number(input.qty[b.id] ?? 0);
    if (!Number.isFinite(q) || q < 0) { valid = false; continue; }
    if (q === 0) continue;
    ada = true;
    if (q > (sisa.get(b.id) ?? 0)) valid = false;
    const prev = prevPerBaris.get(b.id) ?? { qty: new Decimal(0), diskon: new Decimal(0), hpp: new Decimal(0) };
    const porsi = prev.qty.plus(q).div(b.qty);
    lineG = lineG.plus(round2(new Decimal(q).times(b.harga)));
    lineD = lineD.plus(round2(new Decimal(b.diskon).times(porsi)).minus(prev.diskon));
    if (b.stok) hpp = hpp.plus(round2(new Decimal(b.hpp).times(porsi)).minus(prev.hpp));
  }
  const cumG = prevLineG.plus(lineG), cumD = prevLineD.plus(lineD);
  const gAfter = srcGross.gt(0) ? round0(round0(srcGross).times(Decimal.min(cumG, srcGross)).div(srcGross)) : new Decimal(0);
  const dAfter = srcDisc.gt(0) ? round0(round0(srcDisc).times(Decimal.min(cumD, srcDisc)).div(srcDisc)) : new Decimal(0);
  const dpp = new Decimal(input.faktur.dpp);
  const pAfter = input.faktur.ppn > 0 && dpp.gt(0) ? round0(new Decimal(input.faktur.ppn).times(Decimal.min(cumG.minus(cumD), dpp)).div(dpp)) : new Decimal(0);
  const gross = Decimal.max(gAfter.minus(prevG), 0), diskon = Decimal.max(dAfter.minus(prevD), 0), ppn = Decimal.max(pAfter.minus(prevP), 0);
  const total = gross.minus(diskon).plus(ppn);
  const piutang = Decimal.min(total, Decimal.max(input.sisaPiutang, 0));
  return {
    gross: gross.toNumber(), diskon: diskon.toNumber(), ppn: ppn.toNumber(), total: total.toNumber(),
    piutang: piutang.toNumber(), kredit: total.minus(piutang).toNumber(), hpp: hpp.toNumber(),
    valid: valid && ada && (total.gt(0) || hpp.gt(0)),
  };
}
