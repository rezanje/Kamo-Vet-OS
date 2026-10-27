import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const employeeId = "10000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({ denied: false, failed: "", writes: [] as { table: string; kind: string; row: Row }[], components: [] as Row[], assignments: [] as Row[], reads: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(href); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/master-guard", () => ({ bolehKelolaMaster: async () => !state.denied, bolehKelolaPayroll: async () => !state.denied, assertMasterAdmin: async () => { if (state.denied) throw new Error("DENIED"); return client(); }, assertPayrollOwner: async () => { if (state.denied) throw new Error("DENIED"); return client(); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client() }));
vi.mock("@/app/(app)/hris/karyawan/actions", () => ({ editKaryawan: vi.fn() }));
function client() {
  return { from(table: string) {
    state.reads.push(table);
    const filters: Record<string, unknown> = {};
    let mutation: { kind: string; row: Row } | undefined;
    const rows = () => table === "salary_components" ? state.components : table === "employee_salary_components" ? state.assignments
      : table === "employees" ? [{ id: employeeId, nama: "Fictional employee", status: "Aktif", branch_id: "branch" }]
      : table === "employee_base_salaries" ? [{ employee_id: employeeId, gaji_pokok: 3500000 }]
      : table === "branches" ? [{ id: "branch", name: "Fictional branch" }] : [];
    const result = () => {
      if (mutation && state.failed !== table) {
        state.writes.push({ table, ...mutation });
        if (table === "salary_components") {
          if (mutation.kind === "update") state.components = state.components.map(row => row.id === filters.id ? { ...row, ...mutation!.row } : row);
          else state.components.push({ id: "created", is_active: true, ...mutation.row });
        }
        if (table === "employee_salary_components" && mutation.kind === "upsert") {
          const index = state.assignments.findIndex(row => row.employee_id === mutation!.row.employee_id && row.component_id === mutation!.row.component_id);
          if (index >= 0) state.assignments[index] = { ...state.assignments[index], ...mutation.row };
          else state.assignments.push({ id: `assignment-${state.assignments.length}`, ...mutation.row });
        }
      }
      return { data: rows().filter(row => Object.entries(filters).every(([key, value]) => row[key] === value)), error: state.failed === table ? { message: "private benefit fixture" } : null };
    };
    const query = {
      select() { return query; }, order() { return query; }, limit() { return query; }, in() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; },
      update(row: Row) { mutation = { kind: "update", row }; return query; }, insert(row: Row) { mutation = { kind: "insert", row }; return query; },
      upsert(row: Row) { mutation = { kind: "upsert", row }; return query; }, delete() { mutation = { kind: "delete", row: {} }; return query; },
      maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  } };
}
import Profile from "@/app/(app)/hris/karyawan/[id]/page";
import Master from "@/app/(app)/hris/komponen-gaji/page";
import { pasangKomponen, simpanKomponen } from "@/app/(app)/hris/komponen-gaji/actions";
const form = (values: Record<string, string>) => { const data = new FormData(); Object.entries(values).forEach(([key, value]) => data.set(key, value)); return data; };
const profile = () => Profile({ params: Promise.resolve({ id: employeeId }), searchParams: Promise.resolve({}) });
beforeEach(() => {
  state.denied = false; state.failed = ""; state.writes = []; state.reads = [];
  state.components = [{ id: "benefit-1", nama: "Tunjangan jabatan", tipe: "tunjangan", nominal: 100000, is_active: true },
    { id: "benefit-2", nama: "Transport", tipe: "tunjangan", nominal: 200000, is_active: true },
    { id: "benefit-3", nama: "Makan", tipe: "tunjangan", nominal: 300000, is_active: true }];
  state.assignments = state.components.map((row, i) => ({ id: `assigned-${i}`, employee_id: employeeId, component_id: row.id, nominal: i === 1 ? 250000.75 : null }));
});
it("shows base salary plus three named fixed allowances and actual employee overrides with direct name-edit links", async () => {
  const html = renderToStaticMarkup(await profile());
  for (const name of ["Tunjangan jabatan", "Transport", "Makan"]) expect(html).toContain(name);
  expect(html).toContain("Rp 3.500.000"); expect(html).toContain("Rp 250.000,75"); expect(html).toContain("ikut master");
  expect(html).toContain(`emp=${employeeId}&amp;edit=benefit-1`);
});
it("opens a stored component for name/amount editing without changing its type or losing the employee context", async () => {
  const params = { emp: employeeId, edit: "benefit-1" };
  const html = renderToStaticMarkup(await Master({ searchParams: Promise.resolve(params) }));
  expect(html).toContain('name="id" value="benefit-1"'); expect(html).toContain('value="Tunjangan jabatan"');
  expect(html).toContain('name="emp"'); expect(html).toContain("seluruh karyawan"); expect(html).toContain("Batal edit");
});
it("persists a renamed fixed component while preserving personal overrides and salary, then returns to that employee", async () => {
  await expect(simpanKomponen(form({ id: "benefit-1", nama: " Jabatan senior ", tipe: "tunjangan", nominal: "125000.25", emp: employeeId }))).rejects.toThrow(`emp=${employeeId}`);
  const html = renderToStaticMarkup(await profile());
  expect(html).toContain("Jabatan senior"); expect(html).toContain("Rp 125.000,25"); expect(html).toContain("Rp 250.000,75"); expect(html).toContain("Rp 3.500.000");
  expect(state.writes.map(write => write.table)).toEqual(["salary_components"]);
});
it("uses existing assignments for individual amount changes, explicit zero and master fallback without duplicating allowances", async () => {
  for (const [id, nominal] of [["benefit-1", "175000.25"], ["benefit-2", "0"], ["benefit-3", ""]]) {
    await expect(pasangKomponen(form({ employee_id: employeeId, component_id: id, nominal, return_to: "profil" }))).rejects.toThrow("success=benefit");
  }
  expect(state.assignments).toHaveLength(3);
  const html = renderToStaticMarkup(await profile());
  expect(html).toContain("Rp 175.000,25"); expect(html).toContain("Rp 0"); expect(html).toContain("Rp 300.000");
  expect(state.writes.every(write => write.table === "employee_salary_components")).toBe(true);
});
it.each(["not-a-number", "NaN", "Infinity", "1e9999", "-1"])("rejects invalid master allowance amount %s before any write", async nominal => {
  await expect(simpanKomponen(form({ nama: "Invalid", tipe: "tunjangan", nominal }))).rejects.toThrow("error=");
  expect(state.writes).toEqual([]);
});
it.each(["validation", "database"])("keeps the existing edit target and employee context on %s failure so retry remains an update", async mode => {
  if (mode === "database") state.failed = "salary_components";
  const error = await simpanKomponen(form({ id: "benefit-1", emp: employeeId, nama: "Transport renamed", tipe: "tunjangan", nominal: mode === "validation" ? "NaN" : "100" })).catch(result => result as Error);
  expect(error).toBeInstanceOf(Error);
  const query = new URL(`https://fixture.invalid${(error as Error).message}`).searchParams;
  expect(query.get("edit")).toBe("benefit-1"); expect(query.get("emp")).toBe(employeeId); expect(query.has("error")).toBe(true);
  expect(state.components).toHaveLength(3); expect(state.components[0].nama).toBe("Tunjangan jabatan");
});
it("retains the existing role guard before either profile reads or component writes", async () => {
  state.denied = true;
  await expect(profile()).rejects.toThrow("/hris/karyawan"); expect(state.reads).toEqual([]);
  await expect(simpanKomponen(form({ nama: "X", tipe: "tunjangan", nominal: "1" }))).rejects.toThrow("DENIED");
  await expect(pasangKomponen(form({ employee_id: employeeId, component_id: "benefit-1", nominal: "1" }))).rejects.toThrow("DENIED");
  expect(state.writes).toEqual([]);
});
it("does not offer a misleading create form for an unavailable edit target or a failed component read", async () => {
  let params = { emp: employeeId, edit: "missing" };
  let html = renderToStaticMarkup(await Master({ searchParams: Promise.resolve(params) }));
  expect(html).toContain('role="alert"'); expect(html).not.toContain('name="nama"');
  state.failed = "salary_components"; params = { emp: employeeId, edit: "benefit-1" };
  html = renderToStaticMarkup(await Master({ searchParams: Promise.resolve(params) }));
  expect(html).toContain('role="alert"'); expect(html).not.toContain('name="nama"'); expect(html).not.toContain("private benefit");
});
