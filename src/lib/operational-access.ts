export type OperationalScope = {
  role: string;
  branchIds: string[] | null;
  employeeId: string | null;
};

export type VisitScopeRow = {
  branchId: string | null;
  doctorId: string | null;
};

export function canReadVisit(scope: OperationalScope, visit: VisitScopeRow): boolean {
  if (scope.branchIds === null) return true;
  if (visit.branchId && scope.branchIds.includes(visit.branchId)) return true;
  return scope.role === "DOCTOR" && !!scope.employeeId && visit.doctorId === scope.employeeId;
}

export function canReadEmployee(scope: OperationalScope, employeeBranchIds: string[]): boolean {
  if (scope.branchIds === null) return true;
  const allowed = scope.branchIds;
  return employeeBranchIds.some((id) => allowed.includes(id));
}

export function visitScopeFilter(scope: OperationalScope): string | null {
  if (scope.branchIds === null) return null;
  const clauses = scope.branchIds.map((id) => `branch_id.eq.${id}`);
  if (scope.role === "DOCTOR" && scope.employeeId) clauses.push(`doctor_id.eq.${scope.employeeId}`);
  return clauses.length ? clauses.join(",") : "id.is.null";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveOperationalScope(supabase: any): Promise<OperationalScope> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { role: "", branchIds: [], employeeId: null };

  const [{ data: profile }, { data: branches }, { data: employee }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase.from("user_branches").select("branch_id").eq("user_id", user.id),
    supabase.from("employees").select("id").eq("profile_id", user.id).maybeSingle(),
  ]);
  const role = String(profile?.role ?? "");
  return {
    role,
    branchIds: role === "OWNER" || role === "FINANCE"
      ? null
      : (branches ?? []).map((row: { branch_id: string }) => String(row.branch_id)),
    employeeId: employee?.id ? String(employee.id) : null,
  };
}
