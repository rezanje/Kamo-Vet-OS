import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "OWNER", active: true, rpc: [] as [string, Record<string, unknown>][],
  rpcError: null as null | { message: string; code?: string }, revalidated: [] as string[],
}));

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => { state.revalidated.push(path); } }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error("REDIRECT " + to); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, args: Record<string, unknown>) => { state.rpc.push([name, args]); return { data: {}, error: state.rpcError }; },
  from: (table: string) => {
    const query = {
      select: () => query, order: () => query, eq: () => query,
      maybeSingle: async () => ({ data: table === "profiles" ? { role: state.role, is_active: state.active } : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return query;
  },
}) }));

import { tambahCabang } from "@/app/(app)/perusahaan/cabang/actions";
import CabangPage from "@/app/(app)/perusahaan/cabang/page";

const form = (entries: Record<string, string>) => { const data = new FormData(); for (const [k, v] of Object.entries(entries)) data.set(k, v); return data; };
const page = async () => renderToStaticMarkup(await CabangPage({ searchParams: Promise.resolve({}) }));

beforeEach(() => { state.role = "OWNER"; state.active = true; state.rpc = []; state.rpcError = null; state.revalidated = []; });

describe("U11 owner creates a branch", () => {
  it("shows the create form to an active OWNER only", async () => {
    expect(await page()).toContain("Tambah cabang");
    state.role = "ADMIN";
    expect(await page()).not.toContain("Tambah cabang");
    state.role = "OWNER"; state.active = false;
    expect(await page()).not.toContain("Tambah cabang");
  });

  it("creates through the owner-guarded RPC and refreshes the warehouse form", async () => {
    await expect(tambahCabang(form({ code: " PDRY ", name: "KAMO Pondok Dry", type: "BOTH", is_active: "1" })))
      .rejects.toThrow("REDIRECT /perusahaan/cabang?success=");
    expect(state.rpc).toEqual([["create_branch", { p_code: "PDRY", p_name: "KAMO Pondok Dry", p_type: "BOTH", p_is_active: true }]]);
    expect(state.revalidated).toContain("/perusahaan/gudang");
  });

  it("rejects incomplete input before calling the database", async () => {
    await expect(tambahCabang(form({ code: "X", name: "Nama", type: "MALL", is_active: "1" }))).rejects.toThrow("REDIRECT /perusahaan/cabang?error=");
    await expect(tambahCabang(form({ code: "X", name: "Nama", type: "KLINIK", is_active: "" }))).rejects.toThrow("REDIRECT /perusahaan/cabang?error=");
    expect(state.rpc).toEqual([]);
  });

  it("shows the database guard for non-owners and a friendly duplicate message", async () => {
    state.rpcError = { code: "42501", message: "Hanya Super Admin (OWNER) aktif yang dapat membuat cabang" };
    await expect(tambahCabang(form({ code: "X1", name: "Nama", type: "KLINIK", is_active: "0" })))
      .rejects.toThrow("error=" + encodeURIComponent("Hanya Super Admin (OWNER) aktif yang dapat membuat cabang"));
    state.rpcError = { code: "23505", message: 'duplicate key value violates unique constraint "branches_code_key"' };
    await expect(tambahCabang(form({ code: "X1", name: "Nama", type: "KLINIK", is_active: "0" })))
      .rejects.toThrow("error=" + encodeURIComponent("Kode cabang sudah dipakai. Gunakan kode lain."));
    state.rpcError = { code: "XX000", message: "internal" };
    await expect(tambahCabang(form({ code: "X1", name: "Nama", type: "KLINIK", is_active: "0" })))
      .rejects.toThrow("error=" + encodeURIComponent("Cabang belum dapat disimpan. Coba lagi."));
  });
});
