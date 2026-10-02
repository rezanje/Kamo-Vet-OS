import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../supabase/server", () => ({
  createClient: async () => state.client,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(url);
  },
}));
import { hitungPenggajian } from "../../app/(app)/hris/penggajian/actions";
import { kumpulkanDataGaji } from "../payroll-data";
it("refuses to calculate a whole-company payroll when RLS would hide cross-branch schedule/attendance sources", async () => {
  const client = {
    rpc: async () => ({
      data: null,
      error: { message: "HRIS: Data gaji lintas cabang tidak diizinkan" },
    }),
    from: () => {
      const q: Record<string, unknown> = {
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      for (const method of [
        "select",
        "eq",
        "order",
        "gte",
        "lte",
        "in",
        "is",
        "neq",
        "lt",
        "not",
        "limit",
      ])
        q[method] = () => q;
      return q;
    },
  };
  await expect(kumpulkanDataGaji(client, "2026-10")).rejects.toThrow(
    "Data gaji",
  );
});

it("the legacy Calculate action presents the scope refusal before any payroll write", async () => {
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) },
    rpc: async () => ({
      data: null,
      error: { message: "HRIS: Data gaji lintas cabang tidak diizinkan" },
    }),
    from: (table: string) => {
      const q: Record<string, unknown> = {
        maybeSingle: async () => ({
          data: table === "profiles" ? { role: "ADMIN" } : null,
          error: null,
        }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      for (const method of [
        "select",
        "eq",
        "order",
        "gte",
        "lte",
        "in",
        "is",
        "neq",
        "lt",
        "not",
        "limit",
      ])
        q[method] = () => q;
      return q;
    },
  };
  state.client = client;
  const f = new FormData();
  f.set("periode", "2026-10");
  await expect(hitungPenggajian(f)).rejects.toThrow("error=Kamu");
});
