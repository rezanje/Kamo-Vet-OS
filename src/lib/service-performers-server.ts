import { readCompleteList } from "./checked-list";
import { hariIniWIB } from "./tanggal";
import { servicePerformerInput, serviceStaffSlots, type ServiceStaff } from "./service-performers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadServiceStaff(client: any, branchId: string | null): Promise<ServiceStaff[]> {
  if (!branchId) return [];
  // The assignment PK is (employee_id, branch_id), with no standalone id.
  // This query fixes one branch, so employee_id is a stable unique page identity.
  const assigned = await readCompleteList<{ id: string; employee_id: string }>((from, to) => client.from("employee_branch_assignments")
    .select("id:employee_id,employee_id", { count: "exact" }).eq("branch_id", branchId).lte("effective_date", hariIniWIB()).order("employee_id").range(from, to), "Penugasan pelaksana jasa", { maxRows: null });
  const byId = new Map<string, ServiceStaff>();
  const own = await readCompleteList<ServiceStaff>((from, to) => client.from("employees")
    .select("id,nama,jabatan", { count: "exact" }).eq("status", "Aktif").eq("branch_id", branchId).order("id").range(from, to), "Pelaksana cabang", { maxRows: null });
  own.forEach(person => byId.set(person.id, person));
  const ids = [...new Set(assigned.map(row => row.employee_id))];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = await readCompleteList<ServiceStaff>((from, to) => client.from("employees")
      .select("id,nama,jabatan", { count: "exact" }).eq("status", "Aktif").in("id", ids.slice(offset, offset + 200)).order("id").range(from, to), "Pelaksana penugasan", { maxRows: null });
    batch.forEach(person => byId.set(person.id, person));
  }
  return [...byId.values()].sort((a, b) => a.nama.localeCompare(b.nama, "id"));
}

// Actor is always supplied by authenticated server context, never a submitted field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loggedInCashier(client: any, userId: string, _branchId: string | null) {
  void _branchId; // Employment is identity; branch authority comes from the open shift/account grant.
  const [{ data: employee, error: employeeError }, { data: profile, error: profileError }] = await Promise.all([
    client.from("employees").select("id,nama").eq("profile_id", userId).eq("status", "Aktif").maybeSingle(),
    client.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
  ]);
  if (employeeError || profileError) throw Error("Identitas kasir belum dapat diperiksa. Muat ulang sebelum membayar.");
  return { employeeId: employee?.id as string | undefined ?? null, name: String(employee?.nama || profile?.full_name || "Akun kasir") };
}

/** Preflight before JS stock issues; database repeats it under locks on insert. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function validateServicePerformerRows(client: any, branchId: string, rows: { item_type?: string; service_performers?: unknown }[]) {
  const normalized = rows.map(row => {
    const value = servicePerformerInput(row.service_performers);
    if (row.item_type !== "Jasa" && (value.doctor_id || value.staff_id)) throw Error("Pelaksana per baris hanya untuk item Jasa");
    return row.item_type === "Jasa" ? value : null;
  });
  if (!normalized.some(value => value?.doctor_id || value?.staff_id)) return normalized;
  const slots = serviceStaffSlots(await loadServiceStaff(client, branchId));
  for (const value of normalized) {
    if (value?.doctor_id && !slots.doctors.some(row => row.id === value.doctor_id)) throw Error("Dokter harus aktif dan ditugaskan di cabang transaksi");
    if (value?.staff_id && !slots.staff.some(row => row.id === value.staff_id)) throw Error("Non-dokter harus aktif dan ditugaskan di cabang transaksi");
  }
  return normalized;
}
