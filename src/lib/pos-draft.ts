import type { ServicePerformersInput } from "./service-performers";
import { POS_PAYMENT_METHODS, type PosPaymentPart } from "./pos-payments";

export const POS_DRAFT_KEY = "vetos:pos-transaksi:draft:v1";
export const KASIR_DRAFT_KEY = "vetos:kasir:draft:v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1_000;

type PaymentDraft = { split?: boolean; payments?: PosPaymentPart[]; merchantFeePercent?: number };

function validFeeRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    && Math.round(value * 100) / 100 === value;
}

function paymentDraftFields(draft: PaymentDraft & { metode?: string }): PaymentDraft {
  const fields: PaymentDraft = {};
  if (draft.metode !== "Tunai" && validFeeRate(draft.merchantFeePercent) && draft.merchantFeePercent > 0) {
    fields.merchantFeePercent = draft.merchantFeePercent;
  }
  if (typeof draft.split === "boolean") fields.split = draft.split;
  if (Array.isArray(draft.payments)) {
    const seen = new Set<string>();
    fields.payments = draft.payments.filter((part): part is PosPaymentPart => {
      if (!part || !(POS_PAYMENT_METHODS as readonly string[]).includes(part.method)
        || !Number.isFinite(part.amount) || part.amount < 0 || seen.has(part.method)) return false;
      seen.add(part.method);
      return true;
    }).map(part => ({ method: part.method, amount: part.amount,
      ...(part.method !== "Tunai" && validFeeRate(part.feePercent) && part.feePercent > 0 ? { feePercent: part.feePercent } : {}),
    }));
  }
  return fields;
}

export function kasirDraftKey(context?: string): string {
  return context ? `${KASIR_DRAFT_KEY}:${context}` : KASIR_DRAFT_KEY;
}

export type PosDraftLine = {
  row_key?: string; item_type?: string; service_performers?: ServicePerformersInput | null;
  item_id: string;
  nama: string;
  qty: number;
  harga: number;
  target_species: string;
  satuan: string;
  faktor: number;
};

export type PosDraft = PaymentDraft & {
  version: 1;
  savedAt: number;
  /** Stable database posting identity, retained until checkout is confirmed. */
  checkoutKey?: string;
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
      ...(typeof draft.checkoutKey === "string" && draft.checkoutKey ? { checkoutKey: draft.checkoutKey } : {}),
      branchId: String(draft.branchId ?? ""),
      customerId: String(draft.customerId ?? ""),
      petId: String(draft.petId ?? ""),
      salespersonId: String(draft.salespersonId ?? ""),
      metode: String(draft.metode ?? "Tunai"),
      ...paymentDraftFields(draft),
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

export type KasirDraft = PaymentDraft & {
  version: 1;
  savedAt: number;
  /** Stable database posting identity, also used to acknowledge its browser draft. */
  checkoutKey?: string;
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
      ...(typeof draft.checkoutKey === "string" && draft.checkoutKey ? { checkoutKey: draft.checkoutKey } : {}),
      customerId: String(draft.customerId ?? ""),
      salespersonId: String(draft.salespersonId ?? ""),
      metode: String(draft.metode ?? ""),
      ...paymentDraftFields(draft),
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
