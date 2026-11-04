/**
 * POS back office: what the transaction page hands to PosClient for the promo picker. Kept out of promo-syarat-hasil-checkout.ts
 * (composer/loader, shared with the cashier) so that file stays exactly as the cashier ships it.
 */
import { loadSyaratHasilKasir } from "./promo-syarat-hasil-checkout";
import type { SyaratHasilDef } from "./promo-syarat-hasil";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/** What one branch shows. `pickerReleased` = DB flag promo_picker (the cashier-style picker is offered only then). */
export type SyaratHasilTampilan = { defs: SyaratHasilDef[]; pickerReleased: boolean };

/**
 * Definitions and picker flag per branch, DISPLAY ONLY. Undefined when nothing applies anywhere (the screen stays the legacy one).
 * A failing read only hides the preview/picker: checkoutSale loads its own definitions and flags and fails closed.
 */
export async function loadSyaratHasilTampilanPerCabang(supabase: AnyClient, branchIds: readonly string[]): Promise<Record<string, SyaratHasilTampilan> | undefined> {
  const entries = await Promise.all(branchIds.map(async (id) => {
    try { const sh = await loadSyaratHasilKasir(supabase, id); return [id, { defs: sh.defs, pickerReleased: sh.pickerReleased }] as const; }
    catch (error) { console.error("[pos/transaksi] promo syarat-hasil tidak terbaca untuk tampilan:", error); return [id, { defs: [] as SyaratHasilDef[], pickerReleased: false }] as const; }
  }));
  const present = entries.filter(([, tampilan]) => tampilan.defs.length > 0);
  return present.length > 0 ? Object.fromEntries(present) : undefined;
}

/** What the POS page hands to PosClient: definitions per branch, and the branches that may use the picker (flag promo_picker). Both undefined when nothing applies. */
export function pisahTampilanSyaratHasil(tampilan: Record<string, SyaratHasilTampilan> | undefined): { syaratHasilPerCabang: Record<string, SyaratHasilDef[]> | undefined; promoPickerPerCabang: Record<string, boolean> | undefined } {
  if (!tampilan) return { syaratHasilPerCabang: undefined, promoPickerPerCabang: undefined };
  const picker = Object.entries(tampilan).filter(([, t]) => t.pickerReleased).map(([id]) => [id, true] as const);
  return {
    syaratHasilPerCabang: Object.fromEntries(Object.entries(tampilan).map(([id, t]) => [id, t.defs])),
    promoPickerPerCabang: picker.length > 0 ? Object.fromEntries(picker) : undefined,
  };
}
