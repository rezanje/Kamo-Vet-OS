import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const owner = "owner";
const clinic = "clinic";
const rows: Record<string, unknown[]> = {
  profiles: [{ id: owner, full_name: "Fictional owner", role: "OWNER", is_active: true }],
  user_branches: [{ user_id: owner, branches: { code: "VET_CIAW", name: "Older clinic label", type: "KLINIK" } }],
  branches: [
    { id: "petshop", code: "CIAW", name: "Kamo Petshop Ciawi", type: "PETSHOP", is_active: true },
    { id: clinic, code: "VET_CIAW", name: "Older clinic label", type: "KLINIK", is_active: true },
  ],
  employees: [], role_capabilities: [],
};
const client = {
  auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
  from(table: string) {
    return {
      select() { return this; }, eq() { return this; },
      order() { return this; },
      maybeSingle: async () => ({ data: rows[table]?.[0] ?? null }),
      then(resolve: (value: { data: unknown[] }) => void) { return Promise.resolve({ data: rows[table] ?? [] }).then(resolve); },
    };
  },
};
vi.mock("@/lib/master-guard", () => ({ assertAccountCreator: async () => client }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => null }));
vi.mock("@/app/(app)/pengaturan/pengguna/actions", () => ({ buatPengguna: async () => {}, togglePengguna: async () => {}, tautkanPengguna: async () => {} }));

import PenggunaPage from "@/app/(app)/pengaturan/pengguna/page";

it("shows the paired POS name plus Vet in account list and branch choice without changing the branch ID", async () => {
  const html = renderToStaticMarkup(await PenggunaPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("Kamo Petshop Ciawi · Vet");
  expect(html).not.toContain("Older clinic label");
  expect(html).toContain(`name="branch_ids" value="${clinic}"`);
});
