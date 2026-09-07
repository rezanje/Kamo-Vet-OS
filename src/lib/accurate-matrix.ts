export const ACCURATE_MATRIX_COLUMNS = [
  { key: "item_type", label: "Jenis" },
  { key: "category_name", label: "Kategori" },
  { key: "brand_name", label: "Merek" },
  { key: "unit", label: "Satuan dasar" },
  { key: "extra_units", label: "Satuan tambahan" },
  { key: "sell_price", label: "Harga jual" },
  { key: "buy_price", label: "Harga beli" },
  { key: "min_stock", label: "Batas stok minimum" },
  { key: "supplier_name", label: "Pemasok" },
  { key: "buy_unit", label: "Satuan beli" },
  { key: "min_buy", label: "Minimum beli" },
  { key: "upc", label: "Barcode" },
  { key: "track_expiry", label: "Tanggal kadaluarsa" },
  { key: "default_discount", label: "Diskon default" },
  { key: "is_active", label: "Status aktif" },
] as const;

export type AccurateMatrixColumn = (typeof ACCURATE_MATRIX_COLUMNS)[number]["key"];

export type AccurateMatrixValues = Record<
  "code" | "name" | AccurateMatrixColumn,
  string
>;
