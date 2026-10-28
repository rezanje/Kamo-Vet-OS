// Quest effects share the sale lock with cancellation; RPC retries cannot award twice
// (one effect row per sale). Progress is best effort and never blocks a paid checkout.
//
// Q01 recovery: a failed call is no longer lost. Every paid checkout first re-applies the
// cashier's own paid receipts that still have no quest effect (oldest first, this sale
// included), then applies this sale explicitly. Both calls are idempotent per sale, and the
// quest period follows the sale's payment day, so a late repair counts in the right period.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function processQuestProgress(supabase: any, opts: { saleId: string }): Promise<void> {
  try {
    const { error } = await supabase.rpc("apply_pending_sale_staff_effects");
    if (error) console.error("[quest] pending progress could not be repaired:", error.message);
  } catch (error) {
    console.error("[quest] pending progress could not be repaired:", error);
  }
  try {
    const { error } = await supabase.rpc("apply_sale_staff_effects", { p_sale_id: opts.saleId });
    if (error) console.error("[quest] progress could not be recorded (retried on the next checkout):", error.message);
  } catch (error) {
    console.error("[quest] progress could not be recorded (retried on the next checkout):", error);
  }
}
