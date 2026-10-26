import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [] as { name: string; args: Record<string, unknown> }[],
  paths: [] as string[], error: null as { message: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => state.paths.push(path) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT ${path}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
  state.calls.push({ name, args }); return { data: "addendum", error: state.error };
} }) }));
import { tambahAddendumRekamMedis } from "@/app/(app)/klinik/rekam-medis/[visitId]/actions";

const visit = "f2000000-0000-4000-8000-000000000001";
const record = "f4000000-0000-4000-8000-000000000001";
const form = () => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ visitId: visit, medical_record_id: record,
    amendment: " Catatan tambahan ", reason: " Alasan tambahan ", draft_key: "stable-key",
    draft_scope: `paid-clinical-addendum:${visit}:${record}`, resep: "[\"forged medicine\"]",
    total: "999999", diagnosis: "Injected diagnosis" })) data.set(key, value);
  return data;
};
beforeEach(() => { state.calls = []; state.paths = []; state.error = null; });

it("sends only the audit note, reason, source identity and stable key", async () => {
  await expect(tambahAddendumRekamMedis(form())).rejects.toThrow(/success=addendum/);
  expect(state.calls).toEqual([{ name: "clinic_add_paid_record_addendum", args: {
    p_visit_id: visit, p_record_id: record, p_amendment: "Catatan tambahan",
    p_reason: "Alasan tambahan", p_request_key: "stable-key",
  } }]);
  expect(state.paths).toContain(`/klinik/rekam-medis/${visit}/dokumen`);
});

it("rejects missing reason, invalid source, or empty request key without a write", async () => {
  for (const [field, value] of [["reason", ""], ["medical_record_id", "foreign"], ["draft_key", ""]]) {
    const data = form(); data.set(field, value);
    await expect(tambahAddendumRekamMedis(data)).rejects.toThrow(/REDIRECT.*error=/);
  }
  expect(state.calls).toEqual([]);
});

it("does not acknowledge a failed database write", async () => {
  state.error = { message: "invoice no longer paid" };
  await expect(tambahAddendumRekamMedis(form())).rejects.toThrow(/REDIRECT.*error=/);
  expect(state.paths).toEqual([]);
});
