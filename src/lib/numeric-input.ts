import Decimal from "decimal.js";

/** Presentation only: never round or convert the submitted decimal string. */
export function formatNumericDisplay(value: string | number | readonly string[] | undefined): string {
  let raw = String(value ?? "");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) return raw;
  if (/[eE]/.test(raw)) {
    // Native number editors accept extreme underflow exponents. Expanding them
    // could allocate billions of zeros; keep that short representation intact.
    if (Math.abs(Number(raw.split(/[eE]/)[1])) > 324) return raw.replace(".", ",");
    raw = new Decimal(raw).toFixed();
  }
  const [integer, fraction] = raw.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return grouped + (fraction === undefined ? "" : `,${fraction}`);
}

/** A single grouping-shaped dot is ambiguous with existing decimal input. */
export function numericPaste(text: string, canonicalCopy = false): { value: string } | { error: string } {
  const currency = /^\s*Rp\s*/i.test(text);
  const raw = text.trim().replace(/^Rp\s*/i, "");
  const canonical = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  if ((canonicalCopy || /^[+-]?0\./.test(raw)) && canonical.test(raw)) return { value: raw };
  const localized = /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;
  if (localized.test(raw) && (currency || raw.includes(",") || (raw.match(/\./g)?.length ?? 0) > 1)) {
    return { value: raw.replaceAll(".", "").replace(",", ".") };
  }
  if (/^[+-]?\d{1,3}\.\d{3}$/.test(raw)) {
    return { error: "Titik ini bisa berarti ribuan atau desimal. Untuk ribuan, tempel tanpa titik (15000) atau dengan Rp (Rp 15.000). Untuk desimal gunakan koma (15,000)." };
  }
  if (canonical.test(raw)) return { value: raw };
  return { error: "Tempel angka yang valid. Gunakan koma untuk desimal dan titik untuk ribuan." };
}
