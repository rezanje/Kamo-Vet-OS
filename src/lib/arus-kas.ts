// Peta source jurnal → aktivitas arus kas + label yang dibaca manusia.
// Dipakai laporan Arus Kas dan Rincian Arus Kas per Rekening, supaya satu
// transaksi tidak pernah disebut dengan dua nama berbeda di dua laporan.

export type Aktivitas = "operasi" | "investasi" | "pendanaan";

export const SUMBER_KAS: Record<string, { act: Aktivitas; label: string }> = {
  sale: { act: "operasi", label: "Penerimaan penjualan POS" },
  klinik: { act: "operasi", label: "Penerimaan jasa klinik" },
  "klinik-ar": { act: "operasi", label: "Pelunasan piutang pelanggan" },
  "klinik-edit": { act: "operasi", label: "Koreksi invoice klinik" },
  "klinik-void": { act: "operasi", label: "Void invoice klinik" },
  expense: { act: "operasi", label: "Pembayaran beban operasional" },
  payroll: { act: "operasi", label: "Pembayaran gaji karyawan" },
  shift: { act: "operasi", label: "Selisih kas kasir" },
  purchase: { act: "operasi", label: "Pembayaran pembelian" },
  "purchase-pay": { act: "operasi", label: "Pembayaran hutang pembelian" },
  "stock-in": { act: "operasi", label: "Pembelian stok" },
  "bank-rec": { act: "operasi", label: "Penyesuaian rekonsiliasi bank" },
  asset: { act: "investasi", label: "Pembelian aset tetap" },
  manual: { act: "pendanaan", label: "Setoran modal / jurnal manual" },
};

export function labelSumber(source: string): string {
  return SUMBER_KAS[source]?.label ?? source;
}

export function aktivitasSumber(source: string): Aktivitas {
  return SUMBER_KAS[source]?.act ?? "operasi";
}
