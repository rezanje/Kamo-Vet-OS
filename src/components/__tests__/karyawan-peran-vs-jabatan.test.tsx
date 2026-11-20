import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const employeeId = "10000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({ jabatan: "Paramedis" as string | null, profileId: "p-1" as string | null, role: "ADMIN" }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(href); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/master-guard", () => ({ bolehKelolaMaster: async () => true, bolehKelolaPayroll: async () => false }));
vi.mock("@/app/(app)/hris/karyawan/actions", () => ({ editKaryawan: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table: string) {
  const data = table === "employees" ? [{ id: employeeId, nama: "Fiktif", status: "Aktif", jabatan: state.jabatan, profile_id: state.profileId, branch_id: null }]
    : table === "profiles" ? [{ id: "p-1", role: state.role }] : [];
  const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, in: () => q,
    maybeSingle: async () => ({ data: data[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
  return q;
} }) }));
import Profile from "@/app/(app)/hris/karyawan/[id]/page";
const render = async () => renderToStaticMarkup(await Profile({ params: Promise.resolve({ id: employeeId }), searchParams: Promise.resolve({}) }));
beforeEach(() => { state.jabatan = "Paramedis"; state.profileId = "p-1"; state.role = "ADMIN"; });

it("warns when a paramedic's login account still carries the Admin role, with a link to fix it", async () => {
  const html = await render();
  expect(html).toContain('data-testid="peran-vs-jabatan"');
  expect(html).toContain("ubah role akun ke Staf");
  expect(html).toContain('href="/pengaturan/pengguna/p-1/edit"');
  expect(html).toContain("hanya bisa diubah Super Admin");
});
it("stays silent when the role fits the job title, or there is no login account", async () => {
  state.role = "STAFF";
  expect(await render()).not.toContain("peran-vs-jabatan");
  state.role = "ADMIN"; state.profileId = null;
  expect(await render()).not.toContain("peran-vs-jabatan");
});
