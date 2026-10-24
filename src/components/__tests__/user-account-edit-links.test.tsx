// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ role: "OWNER", id: "owner" }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => null }));
vi.mock("@/app/(app)/pengaturan/pengguna/actions", () => ({ buatPengguna: vi.fn(), togglePengguna: vi.fn(), tautkanPengguna: vi.fn() }));
vi.mock("@/lib/master-guard", () => ({ assertAccountCreator: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: state.id } } }) },
  from(table: string) {
    const q = { select: () => q, eq: () => q, order: () => q,
      maybeSingle: async () => ({ data: { role: state.role } }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "profiles" ? [
        { id: "owner", role: "OWNER", full_name: "Pemilik", is_active: true },
        { id: "admin", role: "ADMIN", full_name: "Admin", is_active: true },
        { id: "staff", role: "STAFF", full_name: "Staf", is_active: true },
      ] : [] }).then(resolve),
    }; return q;
  },
}) }));
import Page from "@/app/(app)/pengaturan/pengguna/page";
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); state.role = "OWNER"; state.id = "owner"; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render() { const view = await Page({ searchParams: Promise.resolve({}) }); await act(async () => root.render(view)); }
function links() { return [...host.querySelectorAll<HTMLAnchorElement>('a[href$="/edit"]')].map((link) => link.getAttribute("href")); }
it("shows a named action column and account-specific edit links for OWNER", async () => { await render(); expect([...host.querySelectorAll("th")].map((th) => th.textContent)).toContain("Aksi"); expect(links()).toEqual(["/pengaturan/pengguna/owner/edit", "/pengaturan/pengguna/admin/edit", "/pengaturan/pengguna/staff/edit"]); });
it("shows ADMIN only its own edit link and nonprivileged target links", async () => { state.role = "ADMIN"; state.id = "admin"; await render(); expect(links()).toEqual(["/pengaturan/pengguna/admin/edit", "/pengaturan/pengguna/staff/edit"]); });
it("does not turn delegated account creation into existing-account management", async () => { state.role = "FINANCE"; state.id = "finance"; await render(); expect(links()).toEqual([]); });
