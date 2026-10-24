// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const id = "a0000000-0000-4000-8000-000000000001", active = "a0000000-0000-4000-8000-000000000002", old = "a0000000-0000-4000-8000-000000000003", unknown = "a0000000-0000-4000-8000-000000000004", outside = "a0000000-0000-4000-8000-000000000005";
const state = vi.hoisted(() => ({ rpc: vi.fn(), error: "", allowed: null as string[] | null, requests: [] as string[] }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => state.allowed }));
vi.mock("@/app/(app)/pengaturan/pengguna/actions", () => ({ simpanEditPengguna: vi.fn() }));
vi.mock("@/lib/master-guard", () => ({ assertMasterAdmin: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "manager" } } }) }, rpc: state.rpc,
  from(table: string) {
    state.requests.push(table); let ids: string[] | undefined; let isActive: boolean | undefined; let from = 0, to = 499;
    const q = { select: () => q, eq(key: string, value: boolean) { if (key === "is_active") isActive = value; return q; },
      in(_key: string, values: string[]) { ids = values; return q; }, order: () => q, range(start: number, end: number) { from = start; to = end; return q; }, limit: () => q,
      then(resolve: (value: unknown) => unknown) {
        let rows = table === "branches" ? [
          { id: active, name: "Cabang aktif", is_active: true }, { id: old, name: "Cabang lama", is_active: false }, { id: outside, name: "Di luar lingkup", is_active: true },
        ] : [];
        if (isActive !== undefined) rows = rows.filter((row) => row.is_active === isActive);
        if (ids) rows = rows.filter((row) => ids!.includes(row.id));
        return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: table === state.error ? { message: "PRIVATE_DATABASE_DETAIL" } : null }).then(resolve);
      },
    }; return q;
  },
}) }));
import Page from "@/app/(app)/pengaturan/pengguna/[id]/edit/page";
let host: HTMLDivElement, root: Root;
const snapshot = { profile_id: id, full_name: "Nama akun login", role: "STAFF", is_active: true, branch_ids: [old, unknown], version: "saved-version", editable_roles: ["STAFF", "DOCTOR"], self: false };
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); state.rpc.mockReset(); state.rpc.mockResolvedValue({ data: snapshot, error: null }); state.error = ""; state.allowed = [active, old, unknown]; state.requests = []; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(target = id) { const view = await Page({ params: Promise.resolve({ id: target }) }); await act(async () => root.render(view)); }
it("loads the exact target and current login name, preserving old/unknown branches without offering other scope", async () => {
  await render(); expect(state.rpc).toHaveBeenCalledExactlyOnceWith("get_user_account_for_edit", { p_profile_id: id });
  const data = new FormData(host.querySelector("form")!); expect(data.get("profile_id")).toBe(id); expect(data.get("full_name")).toBe("Nama akun login"); expect(data.getAll("branch_ids")).toEqual([old, unknown]);
  expect(host.textContent).toContain("Cabang lama"); expect(host.textContent).toContain("tidak tersedia"); expect(host.textContent).not.toContain("Di luar lingkup"); expect(host.textContent).toContain("HRIS"); expect(host.querySelector('a[href="/pengaturan/pengguna"]')).not.toBeNull();
});
it("does not load data for an invalid target ID", async () => { await render("invalid"); expect(state.rpc).not.toHaveBeenCalled(); expect(host.querySelector("form")).toBeNull(); });
it("fails closed for missing, denied or invalid snapshot reads", async () => { state.rpc.mockResolvedValue({ data: null, error: { message: "PRIVATE_DETAIL" } }); await render(); expect(host.querySelector("form")).toBeNull(); expect(host.textContent).not.toContain("PRIVATE"); state.rpc.mockResolvedValue({ data: { ...snapshot, profile_id: outside }, error: null }); await render(); expect(host.querySelector("form")).toBeNull(); });
it("does not render partial branch options after a failed checked read", async () => { state.error = "branches"; await render(); expect(host.querySelector("form")).toBeNull(); expect(host.textContent).toContain("belum dapat dimuat lengkap"); expect(host.textContent).not.toContain("PRIVATE"); });
it("shows history failures visibly instead of pretending there were no edits", async () => { state.error = "user_account_edits"; await render(); expect(host.querySelector("form")).not.toBeNull(); expect(host.textContent).toContain("Riwayat perubahan belum dapat dimuat"); expect(host.textContent).not.toContain("Belum ada perubahan akun"); });
