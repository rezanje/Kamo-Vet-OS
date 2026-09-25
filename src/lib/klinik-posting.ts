export type ClinicPostingLine = {
  itemId: string | null;
  recipeId: string | null;
  qty: number;
  description: string;
  price: number;
  kind: "obat" | "jasa";
};

export type ClinicInvoiceLineInput = {
  description: string;
  qty: number;
  price: number;
  kind: "obat" | "jasa";
  item_id: string | null;
  unit: string | null;
  prescription_item_id: string | null;
  recipe_id: string | null;
  discount_percent: number;
};

export type ClinicInvoiceInput = {
  tanggal: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  dp_amount: number;
  dp_date: string | null;
  paid_status: "Belum Lunas" | "DP" | "Lunas";
  metode_bayar: string;
  shift_id: string;
  voucher_code: string | null;
  salesperson_id: string | null;
};

export type ClinicPostInvoiceParams = {
  p_visit_id: string;
  p_request_key: string;
  p_invoice: ClinicInvoiceInput;
  p_lines: ClinicInvoiceLineInput[];
};

export type ClinicCompoundIssue = {
  itemId: string;
  qty: number;
  unit: string;
};

export type ClinicCompoundIngredientInput = {
  item_id: string;
  quantity: number;
  unit: string;
  unit_price: number;
};

export type ClinicCompoundRecipeInput = {
  recipe_name: string;
  dosage_instruction: string | null;
  dosage_form: string;
  ingredients: ClinicCompoundIngredientInput[];
};

export type ClinicIssueCompoundParams = {
  p_medical_record_id: string;
  p_visit_id: string;
  p_recipe: ClinicCompoundRecipeInput;
  p_request_key: string;
};

export type ClinicVoidCompoundParams = { p_recipe_id: string };

export function toClinicCompoundRecipeInput(input: {
  recipeName: string;
  dosageInstruction?: string | null;
  dosageForm?: string | null;
  ingredients: readonly {
    item_id: string;
    qty: number;
    satuan?: string | null;
    harga?: number | null;
  }[];
}): ClinicCompoundRecipeInput {
  return {
    recipe_name: input.recipeName.trim(),
    dosage_instruction: input.dosageInstruction?.trim() || null,
    dosage_form: input.dosageForm?.trim() || "lainnya",
    ingredients: input.ingredients.map((ingredient) => ({
      item_id: ingredient.item_id,
      quantity: Number(ingredient.qty),
      unit: ingredient.satuan?.trim() || "pcs",
      unit_price: Number(ingredient.harga) || 0,
    })),
  };
}

export function parseClinicPostingError(error: { code?: string; message: string } | null): string {
  if (error?.code === "P0001") {
    const detailMessages: Record<string, string> = {
      STOCK_SHORT: "Stok tidak cukup",
      WAREHOUSE_MISSING: "Gudang aktif cabang belum tersedia",
      ACCOUNT_INVALID: "Akun jurnal tidak siap",
      ITEM_INVALID: "Barang tidak aktif atau jenisnya tidak sesuai",
      INGREDIENT_INVALID: "Bahan racikan tidak valid",
      LAYER_SHORT: "Lapisan stok tidak cukup",
      COST_MISSING: "HPP historis bahan tidak tersedia",
      RECIPE_INVALID: "Racikan tidak dapat diubah",
      UNIT_INVALID: "Satuan barang tidak cocok",
    };
    const fixedMessages: Record<string, string> = {
      ACCESS_DENIED: "Akses cabang atau kunjungan tidak diizinkan.",
      IDEMPOTENCY_CONFLICT: "Permintaan racikan bertentangan dengan penyimpanan sebelumnya.",
      RECIPE_LINKED: "Racikan sudah terhubung ke invoice dan tidak dapat dibatalkan di sini.",
      RECIPE_ID_MISSING: "Identitas racikan atau histori HPP belum tersedia. Minta bantuan keuangan sebelum menagih.",
      INVOICE_EXISTS: "Kunjungan sudah memiliki invoice aktif.",
      INVOICE_INVALID: "Nilai atau rincian invoice tidak konsisten.",
      INVOICE_NO_INVALID: "Format nomor invoice tidak valid.",
      LINE_INVALID: "Rincian invoice tidak valid.",
      JOURNAL_UNBALANCED: "Jurnal invoice tidak seimbang; tidak ada perubahan yang disimpan.",
      JOURNAL_DUPLICATE: "Nomor atau jurnal invoice sudah digunakan. Coba simpan kembali.",
      SHIFT_INVALID: "Shift klinik sudah tidak aktif. Periksa shift lalu coba lagi.",
    };
    const match = /^([A-Z_]+)(?::\s*([^\r\n]{1,100}))?$/.exec(error.message);
    if (match && fixedMessages[match[1]]) return fixedMessages[match[1]];
    if (match && match[2] && detailMessages[match[1]]) return `${detailMessages[match[1]]}: ${match[2]}`;
  }
  return "Transaksi belum tersimpan. Periksa apakah invoice sudah dibuat lalu coba lagi.";
}
