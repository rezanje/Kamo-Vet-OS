import type { BarisJual } from "./komisi";

export const SERVICE_ATTRIBUTION_PENDING = "SERVICE_ATTRIBUTION_PENDING:";
/** Never turn a visible unresolved commission into an apparently complete payroll. */
export function assertServiceAttributionReady(rows:Pick<BarisJual,"commissionPending"|"fixedCommission">[]) {
  if(rows.some(row=>row.commissionPending && !row.fixedCommission)) throw Error(`${SERVICE_ATTRIBUTION_PENDING} Atribusi atau aturan insentif jasa belum lengkap. Periksa rincian baris asal di Komisi Penjual sebelum menghitung atau mengesahkan gaji.`);
}
