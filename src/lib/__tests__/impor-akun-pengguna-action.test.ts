import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";

// The user-COA profile must never reach the writer. Every RPC and table call is recorded; the only
// allowed call is the read-only context RPC (with an empty chart here).
const calls = vi.hoisted(() => ({ rpc: [] as string[], writes: [] as string[] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: table === "profiles" ? { role: "OWNER", is_active: true } : null, error: null }),
      insert: () => { calls.writes.push(`insert:${table}`); return q; },
      update: () => { calls.writes.push(`update:${table}`); return q; },
      upsert: () => { calls.writes.push(`upsert:${table}`); return q; },
      delete: () => { calls.writes.push(`delete:${table}`); return q; },
    };
    return q;
  },
  rpc: async (name: string) => {
    calls.rpc.push(name);
    if (name === "read_coa_import_context") return { data: { versi: "v1", akun: [], pemakaian: {} }, error: null };
    return { data: { dibuat: 999 }, error: null };
  },
}) }));
import { prosesImporAkun, type HasilImporAkun } from "@/app/(app)/pengaturan/impor/actions";

const XLSX = readFileSync(new URL("../../../supabase/tests/fixtures/coa-pengguna-sintetis.xlsx", import.meta.url));
const AWAL: HasilImporAkun = { langkah: "awal", pesan: null, rencana: null, coaPengguna: null, sha: null, versi: null };
const form = (langkah: string, extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("sumber", "pengguna-kode-nama-normal"); f.set("langkah", langkah); f.set("csv", "");
  f.set("berkas", new File([new Uint8Array(XLSX)], "COA.xlsx"));
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
};
beforeEach(() => { calls.rpc = []; calls.writes = []; });

it("previews all 204 rows from the real .xlsx bytes through the action", async () => {
  const p = await prosesImporAkun(AWAL, form("periksa"));
  expect(p.langkah).toBe("pratinjau");
  expect(p.coaPengguna?.jumlah).toEqual({ totalData: 204, menunggu_pemetaan: 177, sudah_ada: 0, ditahan: 27, konflik: 0, ditolak: 0 });
  expect(p.coaPengguna?.bolehSimpan).toBe(false);
  expect(calls.rpc).toEqual(["read_coa_import_context"]);
});

it("refuses to save while the mapping is unapproved, whatever the client sends", async () => {
  const p = await prosesImporAkun(AWAL, form("periksa"));
  const s = await prosesImporAkun(p, form("simpan", { konfirmasi: "1", sha: p.sha ?? "", versi: p.versi ?? "", setuju_pemetaan: "1" }));
  expect(s.langkah).not.toBe("tersimpan");
  expect(s.pesan).toMatch(/belum bisa disimpan/i);
  expect(calls.rpc).not.toContain("import_coa_accounts");
  expect(calls.writes).toEqual([]);
});

it("the KAMO template profile does not accept .xlsx silently", async () => {
  const f = form("periksa"); f.set("sumber", "kamo");
  const p = await prosesImporAkun(AWAL, f);
  expect(p.langkah).toBe("gagal");
  expect(p.pesan).toMatch(/Template KAMO dibaca dari CSV/);
  expect(calls.rpc).toEqual([]);
});
