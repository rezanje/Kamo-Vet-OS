import { beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rpc: vi.fn(), denied: false }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/master-guard", () => ({
  assertAccountCreator: vi.fn(),
  assertMasterAdmin: async () => {
    if (db.denied) throw new Error("manager required");
    return { rpc: db.rpc };
  },
}));
import * as actions from "@/app/(app)/pengaturan/pengguna/actions";
import { revalidatePath } from "next/cache";

const profile = "a0000000-0000-4000-8000-000000000001";
const branch = "a0000000-0000-4000-8000-000000000002";
const request = "a0000000-0000-4000-8000-000000000003";
function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ profile_id: profile, full_name: "Nama akun baru", role: "STAFF", expected_version: "saved-version", request_id: request })) data.set(key, value);
  data.append("branch_ids", branch);
  data.set("email", "ignored@example.test"); data.set("is_active", "0"); data.set("employee_id", "ignored");
  return data;
}
beforeEach(() => { vi.clearAllMocks(); db.denied = false; db.rpc.mockResolvedValue({ data: { profile_id: profile, version: "new-version", replayed: false }, error: null }); });
it("provides a dedicated edit action", () => { expect(actions).toHaveProperty("simpanEditPengguna", expect.any(Function)); });
it("submits only account edit fields through the atomic RPC and redirects after confirmed success", async () => {
  await expect(actions.simpanEditPengguna(form())).rejects.toThrow("/pengaturan/pengguna?success=");
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith("edit_user_account", { p_profile_id: profile, p_full_name: "Nama akun baru", p_role: "STAFF", p_branch_ids: [branch], p_expected_version: "saved-version", p_request_id: request });
  expect(revalidatePath).toHaveBeenCalledWith("/pengaturan/pengguna");
});
it("blocks account creators without manager rights before making any edit RPC", async () => {
  db.denied = true;
  await expect(actions.simpanEditPengguna(form())).rejects.toThrow("manager required");
  expect(db.rpc).not.toHaveBeenCalled();
});
it.each(["profile_id", "branch_ids", "request_id"])("rejects invalid %s without making a write", async (field) => {
  const data = form(); data.set(field, "invalid");
  expect(await actions.simpanEditPengguna(data)).toMatchObject({ ok: false }); expect(db.rpc).not.toHaveBeenCalled();
});
it.each([{ code: "40001", message: "PRIVATE_CONFLICT_DETAIL" }, { code: "P0001", message: "ACCOUNT_EDIT_CONFLICT: akun berubah; muat ulang sebelum menyimpan" }])("returns stale and rejected saves without redirect or invalidating the form (%s)", async (error) => {
  db.rpc.mockResolvedValue({ error });
  expect(await actions.simpanEditPengguna(form())).toMatchObject({ ok: false, message: expect.stringContaining("berubah") });
  expect(revalidatePath).not.toHaveBeenCalled();
  db.rpc.mockResolvedValue({ error: { code: "42501", message: "PRIVATE_AUTH_DETAIL" } });
  expect(await actions.simpanEditPengguna(form())).toMatchObject({ ok: false, message: expect.not.stringContaining("PRIVATE") });
});
it("retries the identical request ID after a lost response without creating another identity", async () => {
  db.rpc.mockRejectedValueOnce(new Error("connection lost"));
  const data = form(); expect(await actions.simpanEditPengguna(data)).toMatchObject({ ok: false });
  await expect(actions.simpanEditPengguna(data)).rejects.toThrow("/pengaturan/pengguna?success=");
  expect(db.rpc.mock.calls.map((call) => call[1].p_request_id)).toEqual([request, request]);
});
