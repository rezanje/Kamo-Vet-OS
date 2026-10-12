"use server";
import { assertMasterAdmin } from "@/lib/master-guard";
import { METODE_BAYAR } from "@/lib/kas-akun";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export async function saveDemoPolicy(form: FormData) {
  const supabase = await assertMasterAdmin("/klinik/antrian", "aturan DEMO");
  const feeRates = Object.fromEntries(METODE_BAYAR.map(method => [method, Math.round(Number(form.get(`fee:${method}`)) * 100)]));
  const { error } = await supabase.rpc("save_clinic_demo_policy", {
    p_name: String(form.get("name") ?? ""), p_incentive_percent: Number(form.get("incentive_percent")),
    p_fee_bearer: String(form.get("fee_bearer")), p_fee_rates: feeRates,
    p_revenue_code: String(form.get("revenue_code")), p_expense_code: String(form.get("expense_code")),
  });
  if (error) redirect(`/klinik/aturan-demo?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/klinik/aturan-demo");
  redirect("/klinik/aturan-demo?success=1");
}
