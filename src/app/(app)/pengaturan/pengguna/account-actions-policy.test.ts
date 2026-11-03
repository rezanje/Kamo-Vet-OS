import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rpc: vi.fn(), signup: vi.fn(), from: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { signUp: db.signup } }) }));
vi.mock("@/lib/master-guard", () => ({
  assertAccountCreator: async () => ({ rpc: db.rpc, from: db.from }),
  assertMasterAdmin: async () => ({ rpc: db.rpc, from: db.from, auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) } }),
}));
import { buatPengguna, togglePengguna } from "./actions";
beforeEach(() => {
 vi.clearAllMocks();
 db.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "employee", profile_id: null, status: "Aktif" } }) }), in: () => ({ eq: async () => ({ data: [{ id: "branch" }] }) }) }), update: () => ({ eq: async () => ({ error: null }) }) });
 db.rpc.mockResolvedValue({ error: { code: "42501", message: "ROLE_ACTION_DENIED" } });
 db.signup.mockResolvedValue({ data: { user: { id: "new" } }, error: null });
});
it("rejects custom creation denial before any Auth signup call", async () => {
 const f = new FormData();
 for (const [k,v] of Object.entries({ full_name: "Person", email: "fixture@fiction.invalid", password: "fictional-only", role: "STAFF", employee_id: "employee", branch_ids: "branch" })) f.set(k,v);
 await expect(buatPengguna(f)).rejects.toThrow("/pengaturan/pengguna?error=");
 expect(db.rpc).toHaveBeenCalledWith("preflight_employee_account", { p_employee_id: "employee", p_role: "STAFF", p_branch_ids: ["branch"] });
 expect(db.signup).not.toHaveBeenCalled();
});
it("activation uses the bounded RPC instead of raw profiles DML", async () => {
 const f = new FormData(); f.set("id", "target"); f.set("aktif", "1");
 await expect(togglePengguna(f)).rejects.toThrow("/pengaturan/pengguna?error=");
 expect(db.rpc).toHaveBeenCalledWith("set_user_account_active", { p_profile_id: "target", p_active: true });
 expect(db.from).not.toHaveBeenCalled();
});
