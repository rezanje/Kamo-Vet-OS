import type { DemoFinancialPolicy } from "./clinic-demo-policy";
// Same client shape as other shared Supabase readers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readDemoPolicy(supabase: any): Promise<DemoFinancialPolicy | null> {
  const { data, error } = await supabase.from("clinic_demo_policies")
    .select("id,name,incentive_percent,fee_bearer,fee_rates,admin_revenue_code,admin_expense_code")
    .eq("is_active", true).maybeSingle();
  if (error) throw new Error(`Aturan DEMO gagal dibaca: ${error.message}`);
  return data ? { id: data.id, name: data.name, incentivePercent: Number(data.incentive_percent),
    feeBearer: data.fee_bearer, feeRates: data.fee_rates,
    adminRevenueCode: data.admin_revenue_code, adminExpenseCode: data.admin_expense_code } : null;
}
