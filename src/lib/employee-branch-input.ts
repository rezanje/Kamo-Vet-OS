const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseEmployeeBranches(form: FormData, today: string) {
  const employeeId = String(form.get("employee_id") ?? "").trim().toLowerCase();
  const selected = form.getAll("branch_ids");
  const raw = selected.length ? selected : form.getAll("branch_id");
  const ids = raw.map(value => String(value).trim().toLowerCase());
  const effectiveDate = String(form.get("effective_date") ?? "").trim() || today;
  const role = String(form.get("role") ?? "SECONDARY");
  if (!uuid.test(employeeId) || ids.length < 1 || ids.length > 50 || ids.some(id => !uuid.test(id)) || role !== "SECONDARY") {
    throw new Error("Pilih karyawan dan satu sampai 50 cabang tambahan yang valid");
  }
  const date = new Date(`${effectiveDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== effectiveDate) {
    throw new Error("Tanggal mulai berlaku tidak valid");
  }
  return { employeeId, branchIds: [...new Set(ids)], effectiveDate };
}
