import { beforeEach, expect, it, vi } from "vitest";
// Laporan klinik 11 Nov: "klik pulangkan tapi masih ada". Menyimpan tanpa mengganti
// kondisi dulu kembali diam-diam; sekarang staf diberi tahu dan tidak ada yang tersimpan.
const s = vi.hoisted(() => ({ current: "stabil", rpc: [] as unknown[] }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw Object.assign(Error("REDIRECT"), { to }); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (...args: unknown[]) => { s.rpc.push(args); return { error: null }; },
  from(table: string) {
    const q = { select: () => q, eq: () => q, maybeSingle: () => q, single: () => q,
      then: (done: (v: unknown) => unknown) => Promise.resolve({ data: table === "profiles" ? { role: "STAFF" } : { condition_status: s.current }, error: null }).then(done) };
    return q;
  },
}) }));
import { changeCondition } from "@/app/(app)/klinik/rawat-inap/actions";

const submit = async (status: string) => {
  const fd = new FormData(); fd.set("recordId", "stay"); fd.set("new_status", status);
  try { await changeCondition(fd); } catch (e) { return (e as { to: string }).to; }
  throw Error("expected redirect");
};
beforeEach(() => { s.current = "stabil"; s.rpc = []; });

it("unchanged condition tells staff to pick a new one and writes nothing", async () => {
  const to = await submit("stabil");
  expect(decodeURIComponent(to)).toContain("Kondisi belum diganti");
  expect(to.startsWith("/klinik/rawat-inap/stay?error=")).toBe(true);
  expect(s.rpc).toHaveLength(0);
});

it("choosing Sembuh still goes through the discharge RPC", async () => {
  const to = await submit("sembuh");
  expect(to).toBe("/klinik/rawat-inap/stay?success=status");
  expect(s.rpc).toEqual([["clinic_change_inpatient_condition", { p_inpatient_id: "stay", p_new_status: "sembuh", p_notes: null }]]);
});
