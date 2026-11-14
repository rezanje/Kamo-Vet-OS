import { beforeEach, expect, it, vi } from "vitest";

// B2 "Tutup kunjungan": peran dicek di server SEBELUM memanggil RPC (RPC mengulang di database), pesan galat RPC tanpa kode teknis.
const f = vi.hoisted(() => ({ role: "OWNER" as string | null, active: true, rpcError: null as null | { message: string }, calls: [] as { fn: string; args: unknown }[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    rpc: async (fn: string, args: unknown) => { f.calls.push({ fn, args }); return { data: { closed: true }, error: f.rpcError }; },
    from: () => {
      const q: Record<string, unknown> = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: f.role ? { role: f.role, is_active: f.active } : null }) };
      return q;
    },
  }),
}));
import { closeSettledVisit } from "@/app/(app)/klinik/antrian/actions";

const form = (fields: Record<string, string>) => { const d = new FormData(); for (const [k, v] of Object.entries(fields)) d.set(k, v); return d; };
const redirectOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as Error).message; } };
beforeEach(() => { f.role = "OWNER"; f.active = true; f.rpcError = null; f.calls = []; });

for (const role of ["OWNER", "ADMIN"]) {
  it(`${role}: memanggil clinic_close_settled_visit lalu kembali ke antrian dengan tanda sukses`, async () => {
    f.role = role;
    const to = await redirectOf(closeSettledVisit(form({ id: "v1" })));
    expect(f.calls).toEqual([{ fn: "clinic_close_settled_visit", args: { p_visit_id: "v1" } }]);
    expect(to).toContain("success=tutup");
  });
}
for (const role of ["STAFF", "DOCTOR", "FINANCE", null]) {
  it(`${role ?? "tanpa profil"}: ditolak di server tanpa memanggil RPC`, async () => {
    f.role = role;
    const to = await redirectOf(closeSettledVisit(form({ id: "v1" })));
    expect(f.calls).toEqual([]);
    expect(decodeURIComponent(to!)).toContain("pemilik atau admin");
  });
}
it("admin nonaktif ditolak", async () => {
  f.role = "ADMIN"; f.active = false;
  expect(await redirectOf(closeSettledVisit(form({ id: "v1" })))).toContain("error=");
  expect(f.calls).toEqual([]);
});
it("penolakan database tampil tanpa kode teknis", async () => {
  f.rpcError = { message: "CLOSE_BLOCKED: kunjungan belum bisa ditutup karena pasien masih dirawat inap." };
  const to = decodeURIComponent((await redirectOf(closeSettledVisit(form({ id: "v1" }))))!);
  expect(to).toContain("Kunjungan belum bisa ditutup karena pasien masih dirawat inap.");
  expect(to).not.toContain("CLOSE_BLOCKED");
});
