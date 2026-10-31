export const AKUN_DISKON_PENJUALAN = "520002";

export type BarisJurnalPenjualan = { code: string; debit: number; credit: number };

type SplitPajak = (nilai: number) => { dpp: number; ppn: number };

export function jurnalPenjualanInklusif(o: {
  kasCode: string;
  subtotal: number;
  total: number;
  splitPajak: SplitPajak;
}): BarisJurnalPenjualan[] {
  const subtotal = Math.max(0, Math.round(Number(o.subtotal) || 0));
  const total = Math.min(subtotal, Math.max(0, Math.round(Number(o.total) || 0)));
  const bruto = o.splitPajak(subtotal);
  const netto = o.splitPajak(total);
  const diskonDpp = Math.max(0, bruto.dpp - netto.dpp);

  return [
    { code: o.kasCode, debit: total, credit: 0 },
    ...(diskonDpp > 0 ? [{ code: AKUN_DISKON_PENJUALAN, debit: diskonDpp, credit: 0 }] : []),
    { code: "510001", debit: 0, credit: bruto.dpp },
    ...(netto.ppn > 0 ? [{ code: "312005", debit: 0, credit: netto.ppn }] : []),
  ];
}

export function jurnalPenjualanKlinik(o: {
  kasCode: string;
  subtotal: number;
  discount: number;
  total: number;
  tax: number;
  cashReceived: number;
}): BarisJurnalPenjualan[] {
  const subtotal = Math.max(0, Math.round(Number(o.subtotal) || 0));
  const discount = Math.min(subtotal, Math.max(0, Math.round(Number(o.discount) || 0)));
  const total = Math.max(0, Math.round(Number(o.total) || 0));
  const tax = Math.max(0, Math.round(Number(o.tax) || 0));
  const cashReceived = Math.min(total, Math.max(0, Math.round(Number(o.cashReceived) || 0)));
  const piutang = total - cashReceived;

  return [
    ...(cashReceived > 0 ? [{ code: o.kasCode, debit: cashReceived, credit: 0 }] : []),
    ...(piutang > 0 ? [{ code: "150001", debit: piutang, credit: 0 }] : []),
    ...(discount > 0 ? [{ code: AKUN_DISKON_PENJUALAN, debit: discount, credit: 0 }] : []),
    { code: "510002", debit: 0, credit: subtotal },
    ...(tax > 0 ? [{ code: "312005", debit: 0, credit: tax }] : []),
  ];
}

export function balikJurnalPenjualan(lines: BarisJurnalPenjualan[]): BarisJurnalPenjualan[] {
  return lines.map((line) => ({ code: line.code, debit: line.credit, credit: line.debit }));
}
