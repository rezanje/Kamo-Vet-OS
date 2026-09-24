export type ClinicPostingLine = {
  itemId: string | null;
  recipeId: string | null;
  qty: number;
  description: string;
  price: number;
  kind: "obat" | "jasa";
};

export type ClinicCompoundIssue = {
  itemId: string;
  qty: number;
  unit: string;
};

export function parseClinicPostingError(error: { code?: string; message: string } | null): string {
  if (error?.code === "P0001") {
    const known: Record<string, string> = {
      STOCK_SHORT: "Stok tidak cukup",
      WAREHOUSE_MISSING: "Gudang aktif cabang belum tersedia",
      ACCOUNT_INVALID: "Akun jurnal tidak siap",
    };
    const match = /^(STOCK_SHORT|WAREHOUSE_MISSING|ACCOUNT_INVALID):\s*([^\r\n]{1,100})$/.exec(error.message);
    if (match) return `${known[match[1]]}: ${match[2]}`;
  }
  return "Transaksi belum tersimpan. Periksa apakah invoice sudah dibuat lalu coba lagi.";
}
