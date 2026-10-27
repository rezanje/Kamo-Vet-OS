// Plain-language stage of a saved initial-stock batch. A prepared batch is not
// stock or GL yet; only the OWNER review in Persediaan Awal posts both together.
export function initialStockBatchStage(status: string): string {
  if (status === "previewed") return "Disiapkan, menunggu review OWNER; stok dan jurnal belum diposting";
  if (status === "posted") return "Stok sudah diposting; periksa bukti di Persediaan Awal";
  if (status === "failed") return "Gagal; perlu pemeriksaan, tidak ada posting";
  return `Status belum dikenal (${status}); periksa sebelum melanjutkan`;
}
