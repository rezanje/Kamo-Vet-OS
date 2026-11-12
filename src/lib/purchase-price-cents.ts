import { PosDecimal } from "@/lib/pos-money";

/**
 * Harga beli PO maksimal 2 desimal dan qty x harga tepat sen — sama dengan penjaga database
 * (`purchase_order_item_price_cents`) dan syarat faktur pembelian. Tanpa ini PO bisa tersimpan
 * dan diterima, tetapi ditolak saat difakturkan.
 */
export function purchaseLineCentsProblem(qty: number, harga: number): string | null {
  const q = Number(qty), h = Number(harga);
  if (!Number.isFinite(q) || !Number.isFinite(h)) return null;
  const price = new PosDecimal(h);
  if (price.decimalPlaces() > 2) {
    return "Harga maksimal 2 angka di belakang koma. Kalau beli per botol/box, pilih satuan botol/box dan isi harga per botol/box.";
  }
  if (price.times(q).decimalPlaces() > 2) return "Qty x harga harus pas sampai sen. Ubah qty atau harganya.";
  return null;
}
