import type { KasirDraft } from "@/lib/pos-draft";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServicePerformersSnapshot } from "./service-performers";

export type SaleReplacement = {
  id: string; no_struk: string; branch_id: string; channel: string | null;
  customer_id: string | null; salesperson_id: string | null;
  buyer_name: string | null; external_ref: string | null;
  sale_items: { item_id: string; nama: string; qty: number; harga: number; satuan: string; faktor: number; service_performers?: ServicePerformersSnapshot | null }[];
};

/** Replacement starts from immutable source history; normal checkout revalidates everything. */
export async function loadSaleReplacement(db: SupabaseClient, id?: string): Promise<SaleReplacement | null> {
  if (!id) return null;
  const { data: { user } } = await db.auth.getUser();
  const { data: profile } = user ? await db.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle() : { data: null };
  if (!user || profile?.role !== "OWNER" || !profile.is_active) throw new Error("Hanya Super Admin aktif yang dapat menyiapkan pengganti.");
  const { data, error } = await db.from("sales").select("id,no_struk,branch_id,channel,customer_id,salesperson_id,buyer_name,external_ref,sale_items(item_id,nama,qty,harga,satuan,faktor,service_performers)").eq("id", id).not("voided_at", "is", null).single();
  if (error || !data) throw new Error("Penjualan yang dibatalkan tidak dapat dibaca. Buka kembali riwayat penjualan.");
  return data as SaleReplacement;
}

/** Aggregate source discounts mix points and line benefits; replacement must review them anew. */
export function saleReplacementDraft(source: SaleReplacement): KasirDraft {
  return {
    version: 1, savedAt: 0, customerId: source.customer_id ?? "",
    salespersonId: source.salesperson_id ?? "", metode: "Tunai",
    diskon: 0, diskonPct: false, poin: 0, voucher: "", bayar: 0,
    cart: source.sale_items.map(row => ({
      item_id: row.item_id, nama: row.nama, qty: Number(row.qty), harga: Number(row.harga),
      satuan: row.satuan, faktor: Number(row.faktor),
      ...(row.service_performers ? { service_performers: row.service_performers } : {}),
    })),
  };
}
