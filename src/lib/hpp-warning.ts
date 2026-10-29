import type { PriceFloorFinding } from "./cashier-price-floor";

/**
 * P03 (keputusan owner 29 Okt): back office (/pos/transaksi) dan penjualan grosir BOLEH menjual
 * di bawah HPP, tetapi hanya setelah pengguna mengonfirmasi peringatan yang menyebut barangnya.
 * Konfirmasi terikat ke isi peringatan (tanda tangan), jadi keranjang yang berubah memunculkan
 * peringatan baru. Kasir petshop dan kasir klinik tetap MENOLAK (lihat cashier-price-floor).
 */
export const HPP_CONFIRM_FIELD = "konfirmasi_bawah_hpp";
export type HppWarning = { nama: string; net: number; hpp: number; paket: boolean };

const rupiah = (value: number) => "Rp" + Math.round(value).toLocaleString("id-ID");

/** Zero-net and below-HPP goods lines only; an unknown cost is not a reason to warn. */
export function hppWarningsFrom(findings: PriceFloorFinding[]): HppWarning[] {
  return findings.flatMap(finding => finding.kind === "unknown" ? [] : [{
    nama: finding.nama, net: finding.net, hpp: finding.hpp ?? 0, paket: finding.paket,
  }]);
}

export function hppWarningText(warnings: HppWarning[]): string {
  const rows = warnings.map(w => `${w.paket ? "paket " : ""}${w.nama} (neto ${rupiah(w.net)}, HPP ${rupiah(w.hpp)})`);
  return `Harga jual di bawah HPP: ${rows.join("; ")}. Penjualan ini merugi. Centang konfirmasi lalu simpan lagi bila memang disengaja.`;
}

/** Stable identity of the warned lines and amounts; a changed cart needs a fresh confirmation. */
export function hppWarningSignature(warnings: HppWarning[]): string {
  const source = warnings.map(w => `${w.paket ? "G" : "P"}|${w.nama}|${Math.round(w.net)}|${Math.round(w.hpp)}`).join(";");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${warnings.length}-${hash.toString(36)}`;
}

export function hppWarningConfirmed(formData: FormData, warnings: HppWarning[]): boolean {
  return warnings.length === 0 || String(formData.get(HPP_CONFIRM_FIELD) ?? "") === hppWarningSignature(warnings);
}

/** Query string for the form page that shows the warning and the confirmation box. */
export function hppWarningQuery(warnings: HppWarning[]): string {
  return `hpp_warning=${encodeURIComponent(hppWarningText(warnings))}&hpp_sig=${encodeURIComponent(hppWarningSignature(warnings))}`;
}
