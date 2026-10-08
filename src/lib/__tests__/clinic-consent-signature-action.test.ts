import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: { id: "consent", visit_id: "visit", status: "belum_ttd", signer_name: "", signature_data: "" },
  race: false, reads: 0, release: undefined as (() => void) | undefined,
  barrier: undefined as Promise<void> | undefined,
  writes: [] as string[], readError: false, updateError: false, deniedVisit: false, authenticated: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: "owner" } : null }, error: null }) },
  from(table: string) {
    const filters: Record<string, string> = {};
    let patch: Record<string, string> | undefined;
    const matches = () => Object.entries(filters).every(([key, value]) => state.row[key as keyof typeof state.row] === value);
    const query = {
      select: () => query,
      eq: (key: string, value: string) => { filters[key] = value; return query; },
      update: (value: Record<string, string>) => { patch = value; return query; },
      async maybeSingle() {
        if (table === "visits") return { data: state.deniedVisit ? null : { id: filters.id }, error: null };
        const snapshot = matches() ? { ...state.row } : null;
        if (state.race) {
          state.reads++;
          if (state.reads === 2) state.release?.();
          await state.barrier;
        }
        return { data: snapshot, error: state.readError ? { message: "Consent read failed" } : null };
      },
      then(resolve: (value: unknown) => unknown) {
        if (state.updateError) return Promise.resolve({ data: null, error: { message: "Consent save failed" } }).then(resolve);
        const found = matches();
        if (found && patch) {
          state.row = { ...state.row, ...patch };
          state.writes.push(state.row.signer_name);
        }
        return Promise.resolve({ data: found ? [{ id: state.row.id }] : [], error: null }).then(resolve);
      },
    };
    return query;
  },
}) }));

import { tandaTanganConsent } from "../../app/(app)/klinik/consent/actions";
function form(name = "Pemilik", visit = "visit") {
  const data = new FormData();
  data.set("consentId", "consent"); data.set("visitId", visit);
  data.set("signerName", name); data.set("signature", `data:image/png;base64,${name}`);
  return data;
}
beforeEach(() => {
  state.row = { id: "consent", visit_id: "visit", status: "belum_ttd", signer_name: "", signature_data: "" };
  state.race = false; state.reads = 0; state.release = undefined; state.barrier = undefined; state.writes = [];
  state.readError = false; state.updateError = false; state.deniedVisit = false; state.authenticated = true;
});

it("keeps the first signature when two submissions both read an unsigned consent", async () => {
  state.race = true;
  state.barrier = new Promise<void>(resolve => { state.release = resolve; });
  const outcomes = await Promise.all(["First", "Second"].map(name => tandaTanganConsent(form(name)).catch(error => String(error))));
  expect(state.writes).toHaveLength(1);
  expect(outcomes.filter(message => String(message).includes("success=ttd"))).toHaveLength(1);
  expect(outcomes.filter(message => String(message).includes("?error="))).toHaveLength(1);
  expect(state.row.signer_name).toBe(state.writes[0]);
});
it("does not sign another visit's consent", async () => {
  await expect(tandaTanganConsent(form("Pemilik", "other-visit"))).rejects.toThrow("?error=");
  expect(state.writes).toEqual([]);
});
it.each(["deniedVisit", "authenticated"] as const)("rejects unavailable visit or session (%s)", async key => {
  if (key === "deniedVisit") state.deniedVisit = true; else state.authenticated = false;
  await expect(tandaTanganConsent(form())).rejects.toThrow("?error=");
  expect(state.writes).toEqual([]);
});
it("does not write after a consent read failure", async () => {
  state.readError = true;
  await expect(tandaTanganConsent(form())).rejects.toThrow("?error=");
  expect(state.writes).toEqual([]);
});
it("retains the unsigned state if saving fails", async () => {
  state.updateError = true;
  await expect(tandaTanganConsent(form())).rejects.toThrow("?error=");
  expect(state.row.status).toBe("belum_ttd");
});
it("does not replace an existing signed document", async () => {
  state.row.status = "sudah_ttd"; state.row.signer_name = "Original";
  await expect(tandaTanganConsent(form())).rejects.toThrow("?error=");
  expect(state.row.signer_name).toBe("Original");
  expect(state.writes).toEqual([]);
});
