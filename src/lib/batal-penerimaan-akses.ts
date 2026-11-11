/**
 * Boleh-tidaknya akun ini memakai tombol "Batalkan penerimaan" klinik. BUKAN otorisasi: RPC clinic_cancel_invoice_receipt memeriksa
 * ulang di database. Owner tidak pernah terkunci: bila pembacaan izin gagal, Owner tetap melihat tombolnya (database tetap memutuskan);
 * peran lain gagal-tertutup (tombol tidak muncul).
 */
/** Pembacaan murni (bisa dijalankan paralel dengan bacaan lain sebelum peran diketahui): true/false dari database, null = gagal baca. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function bacaBolehBatalPenerimaan(supabase: any): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.rpc("clinic_cancel_receipt_allowed");
    if (!error) return data === true;
  } catch { /* gagal baca = tidak diketahui */ }
  return null;
}

/** Keputusan akhir untuk layar: jawaban database; bila tak terbaca, Owner tetap melihat tombol (database memutuskan), peran lain tidak. */
export function putuskanBolehBatalPenerimaan(dibaca: boolean | null, role: string | null | undefined): boolean {
  return dibaca === null ? role === "OWNER" : dibaca;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function bolehBatalPenerimaan(supabase: any, role: string | null | undefined): Promise<boolean> {
  return putuskanBolehBatalPenerimaan(await bacaBolehBatalPenerimaan(supabase), role);
}

/** Tagihan yang punya uang diterima (lunas, DP, atau ada pembayaran): satu-satunya yang punya sesuatu untuk dibatalkan. */
export function adaPenerimaan(inv: { paid_status?: string | null; dp_amount?: number | string | null }, dibayar: number): boolean {
  return inv.paid_status === "Lunas" || inv.paid_status === "DP" || Number(inv.dp_amount ?? 0) > 0 || dibayar > 0;
}
