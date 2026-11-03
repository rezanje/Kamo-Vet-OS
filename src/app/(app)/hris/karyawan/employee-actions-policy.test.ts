import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), update: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/master-guard", () => ({
  assertMasterAdmin: async () => db,
  assertHrisManager: async () => db,
  klienMasterAdmin: async () => db,
  bolehKelolaPayroll: async () => false,
}));
import { editKaryawan } from "./actions";
const DENIED = /Tindakan ini tidak diizinkan untuk peran Anda\. Tidak ada yang disimpan\./;
const UNCHECKED = /Hak akses belum dapat diperiksa\. Tidak ada yang disimpan\. Coba lagi sebentar lagi\./;
const RETRY = /Sistem sedang memproses perubahan akun atau hak akses lain\. Tidak ada perubahan yang tersimpan\./;
const RAW = /ROLE_[A-Z_]+|database unavailable|42501|55P03|40001/;
/** The action never throws a (production-masked) error: it redirects back to the employee page with a mapped message. */
async function rejection() {
  const thrown = await editKaryawan(form()).then(() => null, (e: unknown) => e);
  expect(thrown).toBeInstanceOf(Error);
  const url = new URL((thrown as Error).message, "https://example.test");
  expect(url.pathname).toBe(`/hris/karyawan/${id}`);
  expect(url.searchParams.get("edit")).toBe("1"); expect(url.searchParams.get("success")).toBeNull();
  const message = url.searchParams.get("error") ?? "";
  expect(message).not.toMatch(RAW);
  return message;
}
function expectNoMutation() {
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith("role_action_allowed", { p_action: "people.editKaryawan" });
  expect(db.from).not.toHaveBeenCalled(); expect(db.update).not.toHaveBeenCalled();
}
const id = "00000000-0000-0000-0000-000000091006";
function form() {
  const data = new FormData();
  data.set("id", id); data.set("nama", "Employee contact"); data.set("status", "Aktif");
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  db.rpc.mockResolvedValue({ data: false, error: null });
  db.update.mockReturnValue({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id }, error: null }) }) }) });
  db.from.mockReturnValue({ update: db.update });
});
it("real contact/job action fails closed before any employee, branch, or salary mutation", async () => {
  expect(await rejection()).toMatch(DENIED);
  expectNoMutation();
});
it("real contact/job action permits selected action without changing employee status or login fields", async () => {
  db.rpc.mockResolvedValue({ data: true, error: null });
  await expect(editKaryawan(form())).rejects.toThrow(`/hris/karyawan/${id}?success=1`);
  expect(db.rpc).toHaveBeenCalledWith("role_action_allowed", { p_action: "people.editKaryawan" });
  expect(db.from).toHaveBeenCalledWith("employees");
  expect(db.update).toHaveBeenCalledWith({ nama: "Employee contact", nik: null, jabatan: null, departemen: null, phone: null, email: null, tgl_masuk: null });
});
it.each([
  [{ data: true, error: { message: "database unavailable" } }, UNCHECKED],
  [{ data: null, error: null }, UNCHECKED],
  [{ data: "true", error: null }, UNCHECKED],
  [{ data: true, error: { code: "42501", message: "ROLE_ACTION_DENIED" } }, DENIED],
  [{ data: null, error: { code: "55P03", message: "could not obtain lock" } }, RETRY],
])("real action rejects failed or unknown policy reads with a mapped message and zero writes (%j)", async (result, expected) => {
  db.rpc.mockResolvedValue(result);
  const message = await rejection();
  expect(message).toMatch(expected);
  if (expected !== DENIED) expect(message).not.toMatch(DENIED); // unknown/retry is never reported as a definite denial
  expectNoMutation();
});
it("real action treats a throwing policy read as unchecked (not allowed) with zero writes", async () => {
  db.rpc.mockRejectedValue(new Error("connection lost"));
  expect(await rejection()).toMatch(UNCHECKED);
  expectNoMutation();
});
