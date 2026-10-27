import { readCompleteList } from "./checked-list";
import type { VoucherRow } from "./voucher";

// A valid code after the first PostgREST page must remain usable at checkout.
// Keep the complete, counted read on the display path; posting still resolves
// the submitted code independently and checks the current voucher rules.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadActiveVouchers(supabase: any): Promise<VoucherRow[]> {
  return readCompleteList<VoucherRow & { id: string }>((from, to) => supabase
    .from("vouchers")
    .select("id, code, tipe, nilai, is_active, valid_from, valid_until, max_potongan, min_belanja, boleh_gabung_promo, customer_id, category_id", { count: "exact" })
    .eq("is_active", true).order("id").range(from, to), "Kode voucher aktif", { maxRows: null });
}
