import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import type { createClient } from "@/lib/supabase/server";
import { recomputeCustomerTier } from "@/lib/customer-tier";

type Client = Awaited<ReturnType<typeof createClient>>;
export type PosCheckoutIdentity = { key: string; fingerprint: string };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** The same draft must resolve to its existing sale after a lost response. */
export function posCheckoutIdentity(form: FormData, branchId: string): PosCheckoutIdentity {
  const key = String(form.get("checkout_key") ?? "");
  if (!key.trim() || key.length > 120) throw new Error("Identitas transaksi belum siap. Muat ulang halaman sebelum membayar.");
  const number = (name: string) => Number(form.get(name) ?? 0);
  const text = (name: string) => String(form.get(name) ?? "");
  const parsed = (name: string) => {
    try { return JSON.parse(text(name) || "[]"); }
    catch { return text(name); }
  };
  const rawCart = parsed("cart");
  const cart = Array.isArray(rawCart) ? rawCart.map(line => !line || typeof line !== "object" ? line : ({
    item_id: line.item_id || null, qty: Number(line.qty),
    ...(!line.item_id ? { nama: line.nama, harga: Number(line.harga), target_species: line.target_species || "Universal" } : {}),
    satuan: line.satuan || null,
    item_discount_type: line.item_discount_type || null, item_discount_value: Number(line.item_discount_value || 0),
  })) : rawCart;
  const intent = canonical({ branchId, cart, customerId: text("customerId"), petId: text("petId"), salespersonId: text("salespersonId"),
    method: text("metode"), payments: parsed("split_payments"), bayar: number("bayar"),
    diskon: Number(form.get("checkout_diskon_requested") ?? form.get("diskon") ?? 0), diskonPct: text("checkout_diskon_pct"),
    discount: number("discount"), poin: Number(form.get("checkout_poin_requested") ?? form.get("poinDigunakan") ?? 0), voucher: text("voucherCode").trim().toUpperCase() });
  return { key, fingerprint: createHash("sha256").update(JSON.stringify(intent)).digest("hex") };
}

/** Redirect only for the exact intent; a changed draft is never silently cleared. */
export async function resumePosCheckout(supabase: Client, cashierId: string, identity: PosCheckoutIdentity, kind: "cashier" | "backoffice", failedSaleId?: string): Promise<void> {
  const back = kind === "cashier" ? "/kasir" : "/pos/transaksi";
  const { data: prior, error } = await supabase.from("sales")
    .select("id, no_struk, customer_id, checkout_fingerprint, payments_finalized_at")
    .eq("cashier_id", cashierId).eq("checkout_key", identity.key).maybeSingle();
  if (error) redirect(`${back}?error=${encodeURIComponent("Hasil transaksi sebelumnya belum dapat diperiksa. Coba lagi sebelum membayar.")}`);
  if (!prior) return;
  if (prior.checkout_fingerprint !== identity.fingerprint) {
    const recovery = prior.payments_finalized_at ? `&completed_sale_id=${encodeURIComponent(prior.id)}&draft_used=${encodeURIComponent(identity.key)}` : "";
    redirect(`${back}?error=${encodeURIComponent(`Draft ini sudah digunakan untuk transaksi ${prior.no_struk ?? "sebelumnya"}. Periksa transaksi tersebut sebelum membuat pembayaran baru.`)}${recovery}`);
  }
  if (!prior.payments_finalized_at) {
    if (prior.id === failedSaleId) return;
    redirect(`${back}?error=${encodeURIComponent("Transaksi ini masih diproses. Tunggu sebentar, lalu coba lagi untuk memeriksa hasilnya.")}`);
  }
  if (prior.customer_id) await recomputeCustomerTier(supabase, prior.customer_id);
  redirect(kind === "cashier" ? `/kasir/struk/${prior.id}?print=1&draft_done=${encodeURIComponent(identity.key)}` : `/pos/struk/${prior.id}?draft_done=${encodeURIComponent(identity.key)}`);
}
