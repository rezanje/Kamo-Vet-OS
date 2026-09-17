export type KaryawanMaster = {
  id: string;
  nama: string;
  status: string;
  branch_id: string | null;
};

export type CabangMaster = { id: string; name: string };

export type PenugasanKaryawan = {
  employee_id: string;
  branch_id: string;
  role: "PRIMARY" | "SECONDARY";
  effective_date: string;
};

export function tampilkanKaryawan<T extends KaryawanMaster>(
  employees: T[],
  branches: CabangMaster[],
  assignments: PenugasanKaryawan[],
) {
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  const assignmentsByEmployee = new Map<string, PenugasanKaryawan[]>();
  for (const assignment of assignments) {
    const current = assignmentsByEmployee.get(assignment.employee_id) ?? [];
    current.push(assignment);
    assignmentsByEmployee.set(assignment.employee_id, current);
  }

  return employees.map(({ branch_id, ...employee }) => ({
    ...employee,
    branchName: branch_id ? branchName.get(branch_id) ?? "Cabang tidak ditemukan" : "—",
    assignments: (assignmentsByEmployee.get(employee.id) ?? []).map((assignment) => ({
      ...assignment,
      branchName: branchName.get(assignment.branch_id) ?? "Cabang tidak ditemukan",
    })),
  }));
}
