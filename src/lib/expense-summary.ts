export function totalPengeluaranAktif(rows: { jumlah: number; voided_at: string | null }[]): number {
  return rows.filter((r) => !r.voided_at).reduce((total, r) => total + Number(r.jumlah), 0);
}
