export const POS_DRAFT_KEY = "vetos:pos-transaksi:draft:v1";
export const KASIR_DRAFT_KEY = "vetos:kasir:draft:v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export type PosDraftLine = {
  item_id: string;
  nama: string;
  qty: number;
  harga: number;
  target_species: string;
  satuan: string;
  faktor: number;
};

export type PosDraft = {
  version: 1;
  savedAt: number;
  branchId: string;
  customerId: string;
  petId: string;
  salespersonId: string;
  metode: string;
  discount: number;
  bayar: number;
  cart: PosDraftLine[];
};

export function bacaDraftPos(raw: string | null, now = Date.now()): PosDraft | null {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Partial<PosDraft>;
    if (draft.version !== 1 || !Number.isFinite(draft.savedAt) || now - Number(draft.savedAt) > MAX_AGE_MS) return null;
    if (!Array.isArray(draft.cart)) return null;
    return {
      version: 1,
      savedAt: Number(draft.savedAt),
      branchId: String(draft.branchId ?? ""),
      customerId: String(draft.customerId ?? ""),
      petId: String(draft.petId ?? ""),
      salespersonId: String(draft.salespersonId ?? ""),
      metode: String(draft.metode ?? "Tunai"),
      discount: Math.max(0, Number(draft.discount) || 0),
      bayar: Math.max(0, Number(draft.bayar) || 0),
      cart: draft.cart.filter((line): line is PosDraftLine => Boolean(
        line && typeof line === "object" && String(line.item_id ?? "") && Number(line.qty) > 0,
      )),
    };
  } catch {
    return null;
  }
}

export type KasirDraftLine = {
  item_id: string;
  nama: string;
  qty: number;
  harga: number;
  satuan?: string;
  faktor?: number;
  [key: string]: unknown;
};

export type KasirDraft = {
  version: 1;
  savedAt: number;
  customerId: string;
  salespersonId: string;
  metode: string;
  diskon: number;
  diskonPct: boolean;
  poin: number;
  voucher: string;
  bayar: number;
  cart: KasirDraftLine[];
};

export function bacaDraftKasir(raw: string | null, now = Date.now()): KasirDraft | null {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Partial<KasirDraft>;
    if (draft.version !== 1 || !Number.isFinite(draft.savedAt) || now - Number(draft.savedAt) > MAX_AGE_MS) return null;
    if (!Array.isArray(draft.cart)) return null;
    const cart = draft.cart.filter((line): line is KasirDraftLine => Boolean(
      line && typeof line === "object" && String(line.item_id ?? "") && Number(line.qty) > 0,
    ));
    if (cart.length === 0) return null;
    return {
      version: 1,
      savedAt: Number(draft.savedAt),
      customerId: String(draft.customerId ?? ""),
      salespersonId: String(draft.salespersonId ?? ""),
      metode: String(draft.metode ?? ""),
      diskon: Math.max(0, Number(draft.diskon) || 0),
      diskonPct: Boolean(draft.diskonPct),
      poin: Math.max(0, Number(draft.poin) || 0),
      voucher: String(draft.voucher ?? ""),
      bayar: Math.max(0, Number(draft.bayar) || 0),
      cart,
    };
  } catch {
    return null;
  }
}
