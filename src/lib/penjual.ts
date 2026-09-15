// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type PilihanPenjual = { id: string; nama: string; jabatan: string | null };

export async function daftarPenjual(supabase: AnyClient, branchId: string): Promise<PilihanPenjual[]> {
  const { data } = await supabase
    .from("employees")
    .select("id, nama, jabatan, branch_id")
    .eq("status", "Aktif")
    .order("nama");
  const semua = (data ?? []) as (PilihanPenjual & { branch_id: string | null })[];
  if (!branchId || semua.length === 0) return semua;

  const { data: assignments } = await supabase
    .from("employee_branch_assignments")
    .select("employee_id")
    .eq("branch_id", branchId)
    .in("employee_id", semua.map((e) => e.id));
  const assigned = new Set((assignments ?? []).map((r: { employee_id: string }) => r.employee_id));
  return semua.filter((e) => e.branch_id === branchId || assigned.has(e.id));
}

export async function penjualValid(supabase: AnyClient, employeeId: string, branchId: string): Promise<boolean> {
  if (!employeeId || !branchId) return false;
  const { data: employee } = await supabase
    .from("employees")
    .select("id, branch_id")
    .eq("id", employeeId)
    .eq("status", "Aktif")
    .maybeSingle();
  if (!employee) return false;
  if (employee.branch_id === branchId) return true;
  const { data: assignment } = await supabase
    .from("employee_branch_assignments")
    .select("employee_id")
    .eq("employee_id", employeeId)
    .eq("branch_id", branchId)
    .maybeSingle();
  return Boolean(assignment);
}
