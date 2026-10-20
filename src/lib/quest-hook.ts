// Quest effects share the sale lock with cancellation; RPC retries cannot award twice.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function processQuestProgress(supabase: any, opts: { saleId: string }): Promise<void> {
  try {
    const { error } = await supabase.rpc("apply_sale_staff_effects", { p_sale_id: opts.saleId });
    if (error) console.error("[quest] progress could not be recorded:", error.message);
  } catch (error) {
    console.error("[quest] progress could not be recorded:", error);
  }
}
