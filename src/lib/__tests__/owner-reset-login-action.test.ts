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
import { resetLoginPengguna } from "@/app/(app)/pengaturan/pengguna/actions";

const profile = "a0000000-0000-4000-8000-000000000001";
function form(isi: Record<string, string>) {
  const data = new FormData();
  data.set("profile_id", profile);
  for (const [k, v] of Object.entries(isi)) data.set(k, v);
  return data;
}
beforeEach(() => {
  vi.clearAllMocks(); db.denied = false;
  db.rpc.mockResolvedValue({ data: { profile_id: profile, email_changed: true, password_changed: true }, error: null });
});

it("mengirim email (huruf kecil) dan password baru lewat satu fungsi database", async () => {
  const res = await resetLoginPengguna(form({ email: " Baru@Kamo.ID ", password: "rahasia-baru", password_konfirmasi: "rahasia-baru" }));
  expect(res.ok).toBe(true);
  expect(res.message).not.toContain("rahasia-baru");
  expect(db.rpc).toHaveBeenCalledExactlyOnceWith("owner_reset_akun_login", { p_profile_id: profile, p_email: "baru@kamo.id", p_password: "rahasia-baru" });
});

it("password saja: email kosong dikirim null", async () => {
  db.rpc.mockResolvedValue({ data: { email_changed: false, password_changed: true }, error: null });
  const res = await resetLoginPengguna(form({ email: "", password: "rahasia-baru", password_konfirmasi: "rahasia-baru" }));
  expect(res).toMatchObject({ ok: true, message: expect.stringContaining("password baru aktif") });
  expect(db.rpc.mock.calls[0][1]).toMatchObject({ p_email: null, p_password: "rahasia-baru" });
});

it.each([
  [{ password: "pendek", password_konfirmasi: "pendek" }, "8–72"],
  [{ password: "rahasia-baru", password_konfirmasi: "rahasia-lain" }, "tidak sama"],
  [{ email: "", password: "", password_konfirmasi: "" }, "Tidak ada perubahan"],
  [{ profile_id: "bukan-id", email: "a@b.id" }, "tidak valid"],
])("menolak isian tidak valid tanpa menyentuh database (%o)", async (isi, pesan) => {
  expect(await resetLoginPengguna(form(isi))).toMatchObject({ ok: false, message: expect.stringContaining(pesan) });
  expect(db.rpc).not.toHaveBeenCalled();
});

it("menerjemahkan penolakan database tanpa membocorkan detail", async () => {
  db.rpc.mockResolvedValue({ data: null, error: { message: "LOGIN_RESET_EMAIL_TAKEN: email sudah dipakai akun lain" } });
  expect(await resetLoginPengguna(form({ email: "a@b.id" }))).toEqual({ ok: false, message: "Email ini sudah dipakai akun lain." });
  db.rpc.mockResolvedValue({ data: null, error: { message: "LOGIN_RESET_DENIED: hanya Super Admin" } });
  expect(await resetLoginPengguna(form({ email: "a@b.id" }))).toMatchObject({ ok: false, message: expect.stringContaining("Super Admin") });
  db.rpc.mockResolvedValue({ data: null, error: { message: "PRIVATE_DETAIL" } });
  expect(await resetLoginPengguna(form({ email: "a@b.id" }))).toMatchObject({ ok: false, message: expect.not.stringContaining("PRIVATE") });
});

it("non-pengelola ditolak sebelum memanggil database", async () => {
  db.denied = true;
  await expect(resetLoginPengguna(form({ email: "a@b.id" }))).rejects.toThrow("manager required");
  expect(db.rpc).not.toHaveBeenCalled();
});
