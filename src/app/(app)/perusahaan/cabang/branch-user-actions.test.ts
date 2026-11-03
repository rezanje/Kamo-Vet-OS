import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: db.rpc, from: db.from, auth: { getUser: db.getUser } }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { assignUser, unassignUser } from "./actions";
const target = "00000000-0000-0000-0000-000000000001";
const branch = "00000000-0000-0000-0000-000000000002";
beforeEach(() => {
  vi.clearAllMocks();
  db.getUser.mockResolvedValue({ data: { user: { id: target } } });
  db.from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "ADMIN" } }) }) }), upsert: vi.fn().mockResolvedValue({ error: null }), delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) });
  db.rpc.mockResolvedValue({ data: { profile_id: target, version: "v1" }, error: null });
});
it.each([[assignUser, false], [unassignUser, true]] as const)("uses bounded audited RPC for alternate account branch action (%s)", async (action, remove) => {
  const form = new FormData(); form.set("user_id", target); form.set("branch_id", branch); form.set("role", "PRIMARY");
  await expect(action(form)).rejects.toThrow("/perusahaan/cabang?success=1");
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith("set_user_branch_assignment", { p_profile_id: target, p_branch_id: branch, p_assignment_role: "PRIMARY", p_remove: remove });
});
it("does not report success for denied database branch mutation", async () => {
  db.rpc.mockResolvedValue({ error: { message: "ACCOUNT_EDIT_DENIED" } });
  const form = new FormData(); form.set("user_id", target); form.set("branch_id", branch);
  await expect(assignUser(form)).rejects.toThrow("/perusahaan/cabang?error=");
});
