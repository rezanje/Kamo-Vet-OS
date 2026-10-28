// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => null }));
vi.mock("@/app/(app)/pengaturan/pengguna/actions", () => ({ buatPengguna: vi.fn(), togglePengguna: vi.fn(), tautkanPengguna: vi.fn() }));
vi.mock("@/lib/master-guard", () => ({ assertAccountCreator: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    const data = table === "profiles" ? [
      { id: "owner", role: "OWNER", full_name: "Pemilik", is_active: true },
      { id: "a", role: "STAFF", full_name: "ABDUL RAFI H", is_active: true },
      { id: "b", role: "STAFF", full_name: "ACENG PURNAMA", is_active: false },
      { id: "c", role: "FINANCE", full_name: "Budi", is_active: true },
    ] : table === "employees" ? [
      { id: "e1", nik: "K-2025085050", nama: "ABDUL RAFI H", jabatan: null, profile_id: "a", status: "Aktif" },
    ] : [];
    const q = { select: () => q, eq: () => q, order: () => q,
      maybeSingle: async () => ({ data: { role: "OWNER" } }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data }).then(resolve) };
    return q;
  },
}) }));
import Page from "@/app/(app)/pengaturan/pengguna/page";
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function names(params: Record<string, string>) {
  const view = await Page({ searchParams: Promise.resolve(params) });
  await act(async () => root.render(view));
  return [...host.querySelectorAll("tbody tr td:first-child")].map((td) => td.textContent);
}
it("shows every account and a search box without a query", async () => {
  expect(await names({})).toEqual(["Pemilik", "ABDUL RAFI H", "ACENG PURNAMA", "Budi"]);
  expect(host.querySelector('input[name="q"]')).not.toBeNull();
});
it("filters by account name, HRIS NIK and role, case-insensitively", async () => {
  expect(await names({ q: "aceng" })).toEqual(["ACENG PURNAMA"]);
  expect(await names({ q: "K-2025085050" })).toEqual(["ABDUL RAFI H"]);
  expect(await names({ role: "FINANCE" })).toEqual(["Budi"]);
});
it("filters by status and reports an empty result", async () => {
  expect(await names({ status: "nonaktif" })).toEqual(["ACENG PURNAMA"]);
  expect(await names({ q: "tidak-ada" })).toEqual(["Tidak ada pengguna yang cocok."]);
});
