import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "user-1", email: "staff@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", identities: [{ provider: "email" }] } as { id: string; email?: string; email_confirmed_at?: string | null; identities?: { provider: string }[] } | null,
  profile: null as { is_active: boolean } | null,
  profileError: null as { message: string } | null,
  userError: null as { message: string } | null,
  signIn: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: {
    getUser: async () => ({ data: { user: state.user }, error: state.userError }),
    signInWithPassword: state.signIn,
    updateUser: state.updateUser,
  },
  from: (table: string) => {
    if (table !== "profiles") throw new Error(`unexpected table ${table}`);
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: state.profile, error: state.profileError }),
    };
    return chain;
  },
}) }));

import { ubahPasswordPribadi } from "@/app/me/actions";

function form(values: Record<string, string>) {
  const result = new FormData();
  Object.entries(values).forEach(([key, value]) => result.set(key, value));
  return result;
}

beforeEach(() => {
  state.user = { id: "user-1", email: "staff@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", identities: [{ provider: "email" }] };
  state.profile = { is_active: true };
  state.profileError = null;
  state.userError = null;
  state.signIn.mockReset().mockResolvedValue({ data: { user: state.user }, error: null });
  state.updateUser.mockReset().mockResolvedValue({ error: null });
});

describe("ubahPasswordPribadi", () => {
  it("rejects a wrong current password without updating", async () => {
    state.signIn.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    await expect(ubahPasswordPribadi(form({ password_lama: "wrong", password_baru: "new-pass-123", konfirmasi_password: "new-pass-123" }))).rejects.toThrow("Password%20saat%20ini%20salah");
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirmation before auth calls", async () => {
    await expect(ubahPasswordPribadi(form({ password_lama: "old-pass", password_baru: "new-pass-123", konfirmasi_password: "different" }))).rejects.toThrow("Konfirmasi%20password%20baru%20tidak%20cocok");
    expect(state.signIn).not.toHaveBeenCalled();
  });

  it("updates the password after active-profile and current-password checks", async () => {
    await expect(ubahPasswordPribadi(form({ password_lama: "old-pass", password_baru: "new-pass-123", konfirmasi_password: "new-pass-123" }))).rejects.toThrow("success=password");
    expect(state.signIn).toHaveBeenCalledWith({ email: "staff@example.test", password: "old-pass" });
    expect(state.updateUser).toHaveBeenCalledWith({ password: "new-pass-123" });
  });

  it("rejects a reauthentication for a different user", async () => {
    state.signIn.mockResolvedValue({ data: { user: { id: "other-user" } }, error: null });
    await expect(ubahPasswordPribadi(form({ password_lama: "old-pass", password_baru: "new-pass-123", konfirmasi_password: "new-pass-123" }))).rejects.toThrow("Password%20saat%20ini%20salah");
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it("denies unauthenticated and inactive profiles", async () => {
    state.user = null;
    await expect(ubahPasswordPribadi(form({ password_lama: "old-pass", password_baru: "new-pass-123", konfirmasi_password: "new-pass-123" }))).rejects.toThrow("Sesi%20login%20sudah%20berakhir");
    state.user = { id: "user-1", email: "staff@example.test", email_confirmed_at: "2026-01-01T00:00:00Z", identities: [{ provider: "email" }] };
    state.profile = { is_active: false };
    await expect(ubahPasswordPribadi(form({ password_lama: "old-pass", password_baru: "new-pass-123", konfirmasi_password: "new-pass-123" }))).rejects.toThrow("Akun%20belum%20aktif");
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it("denies session and profile lookup errors", async () => {
    state.userError = { message: "session lookup failed" };
    await expect(ubahPasswordPribadi(form({ password_lama: "old-pass", password_baru: "new-pass-123", konfirmasi_password: "new-pass-123" }))).rejects.toThrow("Sesi%20login%20sudah%20berakhir");
    state.userError = null;
    state.profileError = { message: "profile lookup failed" };
    await expect(ubahPasswordPribadi(form({ password_lama: "old-pass", password_baru: "new-pass-123", konfirmasi_password: "new-pass-123" }))).rejects.toThrow("Akun%20belum%20aktif");
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it("rejects a password update failure without acknowledging success", async () => {
    state.updateUser.mockResolvedValue({ error: { message: "update failed" } });
    await expect(ubahPasswordPribadi(form({ password_lama: "old-pass", password_baru: "new-pass-123", konfirmasi_password: "new-pass-123" }))).rejects.toThrow("Password%20baru%20gagal%20disimpan");
  });

  it("denies accounts without a verified email/password identity", async () => {
    state.user = { id: "user-1", email: "staff@example.test", identities: [{ provider: "google" }] };
    await expect(ubahPasswordPribadi(form({ password_lama: "old-pass", password_baru: "new-pass-123", konfirmasi_password: "new-pass-123" }))).rejects.toThrow("belum%20bisa%20diverifikasi");
    expect(state.signIn).not.toHaveBeenCalled();
    expect(state.updateUser).not.toHaveBeenCalled();
  });
});
