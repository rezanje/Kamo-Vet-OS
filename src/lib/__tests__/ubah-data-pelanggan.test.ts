import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "OWNER" as string | null,
  updates: [] as { values: Record<string, unknown>; id: string }[],
  updateResult: { data: [{ id: "x" }] as { id: string }[] | null, error: null as { message: string } | null },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.role ? { role: state.role } : null }) }) }) };
      }
      return {
        update: (values: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => ({
            select: async () => { state.updates.push({ values, id }); return state.updateResult; },
          }),
        }),
      };
    },
  }),
}));

import { ubahDataPelanggan } from "@/app/(app)/crm/pelanggan/actions";

const ID = "11111111-2222-4333-8444-555555555555";
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const run = async (fd: FormData) => {
  try { await ubahDataPelanggan(fd); return "no-redirect"; } catch (e) { return decodeURIComponent((e as Error).message); }
};

describe("ubahDataPelanggan", () => {
  beforeEach(() => { state.role = "OWNER"; state.updates = []; state.updateResult = { data: [{ id: ID }], error: null }; });

  it("saves a corrected owner name and keeps the customer in view", async () => {
    const out = await run(form({ id: ID, phone: "+62 812-8843-0637", nama: "  Gora   Wijaya ", email: "", alamat: "Bogor", pekerjaan: "" }));
    expect(state.updates).toEqual([{ id: ID, values: { name: "Gora Wijaya", email: null, address: "Bogor", pekerjaan: null } }]);
    expect(out).toContain("success=Data pelanggan tersimpan.");
    expect(out).toContain("cari=+62 812-8843-0637");
  });

  it("never touches the phone number", async () => {
    await run(form({ id: ID, phone: "0812", nama: "Gora" }));
    expect(state.updates[0].values).not.toHaveProperty("phone");
  });

  it("rejects non owner/admin roles", async () => {
    state.role = "KASIR";
    expect(await run(form({ id: ID, nama: "Gora" }))).toContain("Hanya owner/admin");
    expect(state.updates).toHaveLength(0);
  });

  it("rejects an empty name", async () => {
    expect(await run(form({ id: ID, nama: "   " }))).toContain("Nama pelanggan wajib diisi");
    expect(state.updates).toHaveLength(0);
  });

  it("rejects an invalid customer id", async () => {
    expect(await run(form({ id: "abc", nama: "Gora" }))).toContain("Pelanggan tidak valid");
  });

  it("reports a customer that no longer exists", async () => {
    state.updateResult = { data: [], error: null };
    expect(await run(form({ id: ID, nama: "Gora" }))).toContain("Pelanggan tidak ditemukan");
  });
});
