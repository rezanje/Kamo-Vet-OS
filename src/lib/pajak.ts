// PPN & Mode PKP — pure logic dites di __tests__/pajak.test.ts.
// Default OFF: belum PKP → tidak mungut/memisah PPN sama sekali.

export type PajakSettings = { mode_pkp: boolean; ppn_rate: number };

export const PAJAK_OFF: PajakSettings = { mode_pkp: false, ppn_rate: 11 };

// Harga jual retail = PPN-inklusif. ON → pisah DPP & PPN; OFF → semua = DPP.
export function splitPpnInklusif(total: number, s: PajakSettings): { dpp: number; ppn: number } {
  if (!s.mode_pkp || total <= 0) return { dpp: total, ppn: 0 };
  const dpp = Math.round((total * 100) / (100 + Number(s.ppn_rate)));
  return { dpp, ppn: total - dpp };
}

// Tagihan klinik = PPN ditambahkan di atas DPP. OFF → pelanggan tidak dibebani PPN.
export function tambahPpn(dpp: number, s: PajakSettings): { tax: number; total: number } {
  if (!s.mode_pkp || dpp <= 0) return { tax: 0, total: dpp };
  const tax = Math.round((dpp * Number(s.ppn_rate)) / 100);
  return { tax, total: dpp + tax };
}

// Server util: baca setting (default OFF bila row belum ada / error).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPajakSettings(supabase: any): Promise<PajakSettings> {
  try {
    const { data } = await supabase
      .from("company_settings").select("mode_pkp, ppn_rate").eq("id", true).maybeSingle();
    if (!data) return PAJAK_OFF;
    return { mode_pkp: !!data.mode_pkp, ppn_rate: Number(data.ppn_rate) || 11 };
  } catch {
    return PAJAK_OFF;
  }
}
