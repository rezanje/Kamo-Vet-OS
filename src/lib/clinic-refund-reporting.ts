// R02 (audit 29 Okt): refund invoice klinik (J03) mengurangi omzet, sama seperti retur
// petshop mengurangi omzet struk. Logika murni, dites di __tests__/clinic-refund-reporting.test.ts.
//
// Sumber angka = tabel clinic_refunds saja. Baris di sana hanya ada setelah refund benar-benar
// diposting: Tunai langsung saat dicatat, Transfer baru saat finance menandai "selesai".
// Permintaan transfer yang masih pending/diproses (clinic_refund_requests) belum mengurangi
// omzet — sama seperti permintaan refund petshop yang belum menghasilkan sales_returns.
// Refund klinik tidak dapat di-void (immutable), jadi tidak ada filter void.

export type ClinicRefundRow = { invoice_id: string; total: number | string | null; tanggal?: string | null };

const sen = (n: number) => Math.round(n * 100) / 100;

/** Total refund klinik yang sudah diposting per invoice asal (dipakai laporan berbasis dokumen asal). */
export function clinicRefundPerInvoice(rows: readonly ClinicRefundRow[] | null | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows ?? []) {
    if (!row?.invoice_id) continue;
    map.set(row.invoice_id, sen((map.get(row.invoice_id) ?? 0) + (Number(row.total) || 0)));
  }
  return map;
}

/** Total refund klinik bertanggal refund di [dari, sampai] (dipakai laporan berbasis tanggal refund). */
export function clinicRefundTotalBetween(rows: readonly ClinicRefundRow[] | null | undefined, dari: string, sampai: string): number {
  let total = 0;
  for (const row of rows ?? []) {
    const tanggal = row?.tanggal ?? "";
    if (tanggal && tanggal >= dari && tanggal <= sampai) total = sen(total + (Number(row.total) || 0));
  }
  return total;
}
