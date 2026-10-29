import { servicePerformerInput, type ServicePerformersInput } from "./service-performers";
import { pesanGagalKampanye } from "./kode-kampanye";

/** Keep legacy payload keys absent so retries retain their original request hash.
 * Attribution is per line regardless of kind: services and ordinary goods alike. */
export function clinicServicePerformerInput(value: unknown): ServicePerformersInput | undefined {
  return value == null ? undefined : servicePerformerInput(value);
}

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
  source_invoice_item_id?: string | null;
  recipe_id: string | null;
  discount_percent: number;
  service_performers?: ServicePerformersInput | null;
  salesperson_id?: string;
  package_item_id?: string;
  package_qty?: number;
  /** Promo yang memotong baris ini; hanya dikirim bila potongannya > 0. */
  promo_id?: string;
  promo_discount?: number;
};

export type ClinicInvoiceInput = {
  service_pricing_version?: 1;
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
  /** Kode kampanye yang diketik (C05); batas pemakaiannya dijaga database. */
  campaign_code?: string | null;
  /** Bagian `discount` yang berasal dari voucher; dipisah supaya laporan tidak menebak. */
  voucher_discount?: number;
  /** Bagian `discount` yang berasal dari diskon golongan pelanggan. */
  diskon_kategori?: number;
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

/** K03: obat racik di klinik wajib dibuat lewat menu racikan (komposisi), bukan baris obat biasa. */
function recipeRequiredMessage(message: string): string {
  const name = message.slice("RECIPE_REQUIRED:".length).trim().split(/[\r\n]/)[0].slice(0, 100);
  return `Obat racik${name ? ` "${name}"` : ""} wajib diisi komposisinya. Hapus baris ini lalu tambahkan lewat tombol "Racikan baru" di rekam medis.`;
}

export function parseClinicPostingError(error: { code?: string; message: string } | null, uncertainFallback?: string): string {
  const kampanye = pesanGagalKampanye(error?.message);
  if (kampanye) return kampanye;
  if (error?.code === "P0001") {
    if(error.message.startsWith('CARE_INVALID:'))return error.message.slice('CARE_INVALID:'.length).trim();
    if (error.message.startsWith("RECIPE_REQUIRED:")) return recipeRequiredMessage(error.message);
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
      // K02: database rejections of procedure BMHP name the reason (unit, item, qty).
      BMHP_INVALID: "BMHP tindakan ditolak",
      BMHP_POSTED: "BMHP tindakan sudah tercatat di tagihan aktif",
    };
    const fixedMessages: Record<string, string> = {
      POLICY_INVALID: "Versi aturan DEMO berubah atau tidak valid. Muat ulang halaman dan periksa aturan.",
      INCENTIVE_INVALID: "Pilih petugas aktif yang tercatat menangani pasien di cabang ini.",
      CONSENT_REQUIRED: "Tandatangani persetujuan khusus rawat inap yang berlaku sebelum melanjutkan.",
      INVOICE_POSTED: "Uang dan penerima insentif DEMO terkunci; terbit ulang mempertahankan snapshot.",
      RECIPE_POSTED: "Racikan baru hanya dapat ditambahkan sebelum invoice dibuat atau kunjungan selesai.",
      ACCESS_DENIED: "Akses cabang atau kunjungan tidak diizinkan.",
      IDEMPOTENCY_CONFLICT: "Permintaan racikan bertentangan dengan penyimpanan sebelumnya.",
      RECIPE_LINKED: "Racikan sudah terhubung ke invoice dan tidak dapat dibatalkan di sini.",
      RECIPE_ID_MISSING: "Identitas racikan atau histori HPP belum tersedia. Minta bantuan keuangan sebelum menagih.",
      INVOICE_EXISTS: "Kunjungan sudah memiliki invoice aktif.",
      INVOICE_INVALID: "Nilai atau rincian invoice tidak konsisten.",
      PAYMENT_INVALID: "Pembayaran tidak cocok dengan sisa piutang.",
      JOURNAL_MISSING: "Catatan pembukuan lama belum lengkap. Minta keuangan meninjau tagihan.",
      INPATIENT_OPEN: "Biaya rawat inap belum dihitung. Selesaikan kepulangan pasien sebelum membuat tagihan.",
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
  return uncertainFallback ?? "Transaksi belum tersimpan. Periksa apakah invoice sudah dibuat lalu coba lagi.";
}

export function parseClinicRecordError(error: { code?: string; message: string } | null): string {
  if (error?.code === "P0001") {
    if (error.message.startsWith("CONSENT_REQUIRED: tandatangani form Pulang Paksa")) return "Buat dan tandatangani form khusus Pulang Paksa untuk cabang pasien sebelum mengubah kondisi.";
    if (error.message.startsWith("INPATIENT_CLOSED:")) return "Pasien sudah keluar dari rawat inap; kondisi kepulangan tidak dapat diubah di sini.";
    if (error.message.startsWith("INPATIENT_ATOMIC_REQUIRED:")) return "Ubah kondisi melalui aksi rawat inap agar formulir dan biaya diperiksa bersama.";
    if (error.message.startsWith("RECORD_INVALID:")) return "Kunjungan belum siap diselesaikan atau data pemeriksaan tidak lengkap.";
    if (error.message.startsWith("LOG_INVALID:")) return "Catatan rawat inap atau rekam medis untuk tagihan belum lengkap.";
    if (error.message.startsWith("IDEMPOTENCY_CONFLICT:")) return "Form pemeriksaan ini sudah dipakai untuk data berbeda. Muat ulang kunjungan.";
    if (error.message.startsWith("RECIPE_REQUIRED:")) return recipeRequiredMessage(error.message);
  }
  const message = parseClinicPostingError(error);
  return message.startsWith("Transaksi belum tersimpan.")
    ? "Rekam medis belum tersimpan. Periksa data dan coba lagi."
    : message;
}
