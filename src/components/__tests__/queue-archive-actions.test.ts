import { beforeEach, expect, it, vi } from "vitest";

// Server actions Arsipkan / Pulihkan: peran dicek di server SEBELUM memanggil RPC (RPC mengulang cek di database),
// pesan galat RPC sampai ke layar tanpa awalan kode, dan Batal (hapus Menunggu) tidak pernah menyentuh baris arsip.
const f = vi.hoisted(() => ({
  role: "OWNER" as string | null, active: true, rpcError: null as null | { message: string }, calls: [] as { fn: string; args: unknown }[],
  deletes: [] as unknown[][],
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    rpc: async (fn: string, args: unknown) => { f.calls.push({ fn, args }); return { data: null, error: f.rpcError }; },
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q, eq: (...a: unknown[]) => { f.deletes.push(["eq", ...a]); return q; },
        is: (...a: unknown[]) => { f.deletes.push(["is", ...a]); return q; },
        delete: () => { f.deletes.push(["delete", table]); return q; },
        maybeSingle: async () => ({ data: f.role ? { role: f.role, is_active: f.active } : null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return q;
    },
  }),
}));
import { archiveVisit, unarchiveVisit, cancelVisit } from "@/app/(app)/klinik/antrian/actions";

const form = (fields: Record<string, string>) => { const d = new FormData(); for (const [k, v] of Object.entries(fields)) d.set(k, v); return d; };
const redirectOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as Error).message; } };

beforeEach(() => { f.role = "OWNER"; f.active = true; f.rpcError = null; f.calls = []; f.deletes = []; });

for (const role of ["OWNER", "ADMIN"]) {
  it(`${role}: archive calls clinic_archive_visit with id, trimmed reason and the request key, then returns to the queue with a success flag`, async () => {
    f.role = role;
    const to = await redirectOf(archiveVisit(form({ id: "v1", reason: "  Percobaan batal fiktif  ", request_key: "key-123456789" })));
    expect(f.calls).toEqual([{ fn: "clinic_archive_visit", args: { p_visit_id: "v1", p_reason: "Percobaan batal fiktif", p_request_key: "key-123456789" } }]);
    expect(to).toContain("/klinik/antrian");
    expect(to).toContain("success=arsip");
  });
  it(`${role}: unarchive calls clinic_unarchive_visit and returns with the restored flag`, async () => {
    f.role = role;
    const to = await redirectOf(unarchiveVisit(form({ id: "v1", request_key: "key-abcdefghi" })));
    expect(f.calls).toEqual([{ fn: "clinic_unarchive_visit", args: { p_visit_id: "v1", p_reason: null, p_request_key: "key-abcdefghi" } }]);
    expect(to).toContain("filter=diarsipkan");
    expect(to).toContain("success=pulih");
  });
}

for (const role of ["STAFF", "DOCTOR", "FINANCE", null, "OWNERX"]) {
  it(`${role ?? "no profile"}: archive and unarchive are refused by the server action itself (no RPC call), with a clear message`, async () => {
    f.role = role;
    for (const action of [archiveVisit, unarchiveVisit]) {
      f.calls = [];
      const to = await redirectOf(action(form({ id: "v1", reason: "Percobaan batal fiktif", request_key: "key-123456789" })));
      expect(f.calls).toEqual([]);
      expect(to).toContain("error=");
      expect(decodeURIComponent(to!)).toContain("pemilik atau admin");
    }
  });
}

it("an inactive OWNER profile is refused", async () => {
  f.role = "OWNER"; f.active = false;
  const to = await redirectOf(archiveVisit(form({ id: "v1", reason: "Percobaan batal fiktif", request_key: "key-123456789" })));
  expect(f.calls).toEqual([]);
  expect(to).toContain("error=");
});

it("a missing/short reason or missing id/key is refused before the RPC with a readable message", async () => {
  for (const bad of [{ id: "v1", reason: "", request_key: "key-123456789" }, { id: "v1", reason: "abcd", request_key: "key-123456789" }, { id: "", reason: "Percobaan batal fiktif", request_key: "key-123456789" }, { id: "v1", reason: "Percobaan batal fiktif", request_key: "" }]) {
    f.calls = [];
    const to = await redirectOf(archiveVisit(form(bad)));
    expect(f.calls).toEqual([]);
    expect(to).toContain("error=");
  }
  const reason = await redirectOf(archiveVisit(form({ id: "v1", reason: "abc", request_key: "key-123456789" })));
  expect(decodeURIComponent(reason!)).toContain("alasan");
});

it("RPC refusals (blocked / stale / denied) reach the screen without the technical code prefix", async () => {
  f.rpcError = { message: "ARCHIVE_BLOCKED: kunjungan tidak dapat diarsipkan karena sudah ada pembayaran." };
  const to = await redirectOf(archiveVisit(form({ id: "v1", reason: "Percobaan batal fiktif", request_key: "key-123456789" })));
  const message = decodeURIComponent(to!.split("error=")[1]);
  expect(message).toBe("kunjungan tidak dapat diarsipkan karena sudah ada pembayaran.");
  expect(to).not.toContain("success=");
});

it("Batal (hard delete of a Menunggu patient) never touches an archived row", async () => {
  await cancelVisit(form({ id: "v1" }));
  expect(f.deletes).toContainEqual(["delete", "visits"]);
  expect(f.deletes).toContainEqual(["is", "archived_at", null]);
  expect(f.deletes).toContainEqual(["eq", "status", "Menunggu"]);
});
