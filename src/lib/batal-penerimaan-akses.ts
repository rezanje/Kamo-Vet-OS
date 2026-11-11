/**
 * Boleh-tidaknya akun ini memakai tombol "Batalkan penerimaan" klinik. BUKAN otorisasi: RPC clinic_cancel_invoice_receipt memeriksa
 * ulang di database. Owner tidak pernah terkunci: bila pembacaan izin gagal, Owner tetap melihat tombolnya (database tetap memutuskan);
 * peran lain gagal-tertutup (tombol tidak muncul).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function bolehBatalPenerimaan(supabase: any, role: string | null | undefined): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("clinic_cancel_receipt_allowed");
    if (!error) return data === true;
  } catch { /* jatuh ke aturan di bawah */ }
  return role === "OWNER";
}

/** Tagihan yang punya uang diterima (lunas, DP, atau ada pembayaran): satu-satunya yang punya sesuatu untuk dibatalkan. */
export function adaPenerimaan(inv: { paid_status?: string | null; dp_amount?: number | string | null }, dibayar: number): boolean {
  return inv.paid_status === "Lunas" || inv.paid_status === "DP" || Number(inv.dp_amount ?? 0) > 0 || dibayar > 0;
}
