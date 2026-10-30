import { keadaanPenugasan, labelPenugasan, type KeadaanPenugasan } from "./employee-assignment";

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
  end_date?: string | null;
};

export type PenugasanTampil = PenugasanKaryawan & {
  branchName: string;
  keadaan: KeadaanPenugasan;
  /** "Mulai 5 Nov" / "Berakhir 30 Okt" / "" bila sedang berjalan tanpa batas. */
  keterangan: string;
};

export function tampilkanKaryawan<T extends KaryawanMaster>(
  employees: T[],
  branches: CabangMaster[],
  assignments: PenugasanKaryawan[],
  hariIni: string,
) {
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  const assignmentsByEmployee = new Map<string, PenugasanKaryawan[]>();
  for (const assignment of assignments) {
    const current = assignmentsByEmployee.get(assignment.employee_id) ?? [];
    current.push(assignment);
    assignmentsByEmployee.set(assignment.employee_id, current);
  }

  // `branch_id` ikut dikembalikan supaya penyaringan per cabang tidak perlu
  // mencocokkan nama cabang yang bisa berubah tampilannya.
  return employees.map((employee) => ({
    ...employee,
    branchName: employee.branch_id ? branchName.get(employee.branch_id) ?? "Cabang tidak ditemukan" : "—",
    assignments: (assignmentsByEmployee.get(employee.id) ?? []).map((assignment): PenugasanTampil => ({
      ...assignment,
      branchName: branchName.get(assignment.branch_id) ?? "Cabang tidak ditemukan",
      keadaan: keadaanPenugasan(assignment, hariIni),
      keterangan: labelPenugasan(assignment, hariIni),
    })),
  }));
}
