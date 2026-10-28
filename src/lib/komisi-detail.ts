import type { RincianAturan } from "./komisi";

type Rate = { tipe: string; basis: string; nominal: number; persen: number; sumber?: string };
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const number = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 6 });

/** Keep quantity and money distinct in the rule-level commission readout. */
export function rincianKomisiText(row: RincianAturan, rate?: Rate) {
  if (rate?.tipe === "nominal" && rate.sumber === "visit_ranap") return {
    basis: `${number(row.dasar)} visit`, tarif: `${rp(rate.nominal)}/visit`,
  };
  if (rate?.tipe === "nominal") return {
    basis: `${number(row.dasar)} unit`, tarif: `${rp(rate.nominal)}/unit`,
  };
  if (rate?.tipe === "persen") return {
    basis: `${rate.basis === "laba" ? "laba" : "omzet neto"} ${rp(row.dasar)}`,
    tarif: `${number(rate.persen)}%`,
  };
  // Posted DEMO allocations have a stored basis and payout, not a commission rule.
  return { basis: `basis tersimpan ${rp(row.dasar)}`, tarif: null };
}
