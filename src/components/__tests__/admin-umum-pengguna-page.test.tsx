import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ actorRole: "OWNER", rows: [] as Record<string, unknown>[] }));
const baseRows = (): Record<string, unknown[]> => ({
  profiles: state.rows,
  user_branches: [],
  branches: [{ id: "b1", code: "CIAW", name: "Cabang Fiktif", type: "PETSHOP", is_active: true }],
  employees: [], role_capabilities: [],
});
function client() {
  const rows = baseRows();
  return {
    auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
    from(table: string) {
      return {
        select() { return this; }, eq() { return this; }, order() { return this; },
        maybeSingle: async () => ({ data: table === "profiles" ? { id: "actor", full_name: "Aktor Fiktif", role: state.actorRole, is_active: true } : rows[table]?.[0] ?? null }),
        then(resolve: (v: { data: unknown[] }) => void) { return Promise.resolve({ data: rows[table] ?? [] }).then(resolve); },
      };
    },
  };
}
vi.mock("@/lib/master-guard", () => ({ assertAccountCreator: async () => client() }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => null }));
vi.mock("@/app/(app)/pengaturan/pengguna/actions", () => ({ buatPengguna: async () => {}, togglePengguna: async () => {}, tautkanPengguna: async () => {} }));
import PenggunaPage from "@/app/(app)/pengaturan/pengguna/page";

/** Hanya isi <select name="role"> pada formulir buat akun. */
const pilihanRole = (html: string) => { const a = html.indexOf('<select class="fi" name="role" required'); return html.slice(a, html.indexOf("</select>", a)); };

beforeEach(() => {
  state.actorRole = "OWNER";
  state.rows = [
    { id: "actor", full_name: "Aktor Fiktif", role: "OWNER", is_active: true },
    { id: "u-umum", full_name: "Pegawai Umum Fiktif", role: "ADMIN_UMUM", is_active: true },
  ];
});

it("OWNER: dropdown Role punya Admin Umum, nilainya ADMIN_UMUM, di antara ADMIN dan OWNER; lencana baris berlabel Admin Umum", async () => {
  const full = renderToStaticMarkup(await PenggunaPage({ searchParams: Promise.resolve({}) }));
  const html = pilihanRole(full);
  expect(html).toContain('<option value="ADMIN_UMUM">Admin Umum');
  const i = (v: string) => html.indexOf(`<option value="${v}"`);
  expect(i("ADMIN")).toBeGreaterThan(-1);
  expect(i("ADMIN_UMUM")).toBeGreaterThan(i("ADMIN"));
  expect(i("OWNER")).toBeGreaterThan(i("ADMIN_UMUM"));
  expect(full).toContain(">Admin Umum</span>");
});

it("peran yang bukan OWNER tidak ditawari ADMIN, ADMIN_UMUM, maupun OWNER (sama seperti ADMIN hari ini)", async () => {
  for (const role of ["ADMIN", "ADMIN_UMUM"]) {
    state.actorRole = role;
    const html = pilihanRole(renderToStaticMarkup(await PenggunaPage({ searchParams: Promise.resolve({}) })));
    expect(html).not.toContain('<option value="ADMIN_UMUM"');
    expect(html).not.toContain('<option value="ADMIN">');
    expect(html).not.toContain('<option value="OWNER">');
    expect(html).toContain('<option value="STAFF"');
  }
});

it("ADMIN_UMUM bisa mengelola daftar pengguna seperti ADMIN, tetapi tidak bisa mengutak-atik akun OWNER/ADMIN/ADMIN_UMUM lain", async () => {
  state.actorRole = "ADMIN_UMUM";
  state.rows = [
    { id: "actor", full_name: "Aktor Fiktif", role: "ADMIN_UMUM", is_active: true },
    { id: "u-staf", full_name: "Staf Fiktif", role: "STAFF", is_active: true },
    { id: "u-adm", full_name: "Admin Lain Fiktif", role: "ADMIN", is_active: true },
  ];
  const html = renderToStaticMarkup(await PenggunaPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("Staf Fiktif");
  expect(html).toContain("Role *"); // formulir buat akun tampil (canManage)
});
