import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "fictional-owner" } as { id: string } | null,
  role: "OWNER" as string | null,
  profileError: null as { message: string } | null,
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.user } }) },
  from: (table: string) => {
    if (table !== "profiles") throw Error(`Unexpected table ${table}`);
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({
      data: { role: state.role }, error: state.profileError,
    }) };
    return query;
  },
  rpc: state.rpc,
}) }));

import { resetSimulasiBarangDanStok } from "@/app/(app)/pos/stok/actions";

function legacyForm() {
  const form = new FormData();
  form.set("confirmation", "RESET SIMULASI TOTAL");
  form.set("understood_impact", "1");
  return form;
}
async function response(form = legacyForm()) {
  try { await resetSimulasiBarangDanStok(form); }
  catch (error) { return decodeURIComponent((error as Error).message); }
  throw Error("Expected a blocked redirect");
}

beforeEach(() => {
  state.user = { id: "fictional-owner" };
  state.role = "OWNER";
  state.profileError = null;
  state.rpc.mockReset().mockResolvedValue({ error: {
    code: "42501", status: 403, message: "permission denied PRIVATE_BACKEND_DETAIL",
  } });
  state.revalidate.mockClear();
});

describe("legacy reset action is closed", () => {
  it("blocks repeated owner requests before the RPC even when the backend would return 403/42501", async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const message = await response();
      expect(message).toContain("Reset dari aplikasi dinonaktifkan");
      expect(message).toContain("403/42501");
      expect(message).toContain("Owner");
      expect(message).toContain("maintenance");
      expect(message).not.toMatch(/success=|selesai|coba lagi|PRIVATE_BACKEND_DETAIL|Data lama tetap utuh/i);
    }
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it("does not unlock execution with an empty or tampered confirmation", async () => {
    expect(await response(new FormData())).toContain("Reset dari aplikasi dinonaktifkan");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    state.user = null;
    expect(await response()).toBe("REDIRECT:/login");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("stays blocked even if backend permissions are changed independently", async () => {
    state.rpc.mockResolvedValue({ data: { items: 100, stock_rows: 200 }, error: null });
    const message = await response();
    expect(message).toContain("Reset dari aplikasi dinonaktifkan");
    expect(message).not.toMatch(/success=|selesai/i);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "FINANCE", "STAFF", null])("rejects direct submission by %s", async (role) => {
    state.role = role;
    expect(await response()).toContain("hanya tersedia untuk Owner");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("fails closed on profile read error without exposing backend details", async () => {
    state.profileError = { message: "PRIVATE_PROFILE_DETAIL" };
    const message = await response();
    expect(message).toContain("hanya tersedia untuk Owner");
    expect(message).not.toContain("PRIVATE_PROFILE_DETAIL");
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
