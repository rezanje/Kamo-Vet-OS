// Operational selectors use only the safe directory, never full HR cards.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
export type PilihanPenjual = {
  id: string;
  nama: string;
  jabatan: string | null;
};
type DirectoryEmployee = PilihanPenjual & {
  branch_id: string | null;
  assigned_branch_ids: string[];
};
export async function daftarPenjual(
  db: AnyClient,
  branchId: string,
): Promise<PilihanPenjual[]> {
  const { data, error } = await db
    .from("employee_directory")
    .select("id,nama,jabatan,branch_id,assigned_branch_ids")
    .eq("status", "Aktif")
    .order("nama");
  if (error) throw new Error("Daftar penjual gagal dibaca");
  return ((data ?? []) as DirectoryEmployee[]).filter(
    (e) =>
      !branchId ||
      e.branch_id === branchId ||
      e.assigned_branch_ids?.includes(branchId),
  );
}
export async function penjualValid(
  db: AnyClient,
  employeeId: string,
  branchId: string,
): Promise<boolean> {
  if (!employeeId || !branchId) return false;
  const { data, error } = await db
    .from("employee_directory")
    .select("id,branch_id,assigned_branch_ids")
    .eq("id", employeeId)
    .eq("status", "Aktif")
    .maybeSingle();
  return (
    !error &&
    !!data &&
    (data.branch_id === branchId ||
      data.assigned_branch_ids?.includes(branchId))
  );
}
