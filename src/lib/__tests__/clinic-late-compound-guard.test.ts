import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ posted: false, exactRetry: false, calls: [] as string[] }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT ${href}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  rpc: async (name: string) => {
    state.calls.push(name);
    return { data: "recipe", error: state.posted && !state.exactRetry
      ? { code: "P0001", message: "RECIPE_POSTED: kunjungan sudah ditagih atau selesai" } : null };
  },
}) }));

import { addRacikan } from "@/app/(app)/klinik/racik/actions";

const form = () => {
  const data = new FormData();
  data.set("visitId", "visit");
  data.set("medicalRecordId", "record");
  data.set("requestKey", "request");
  data.set("official_version_id", "version");
  return data;
};

beforeEach(() => { state.posted = false; state.exactRetry = false; state.calls = []; });

it("surfaces a database rejection of new late racikan without acknowledging success", async () => {
  state.posted = true;
  await expect(addRacikan(form())).rejects.toThrow("Racikan%20baru");
  expect(state.calls).toEqual(["clinic_issue_official_compound"]);
});

it("lets the database acknowledge an exact retry after invoice posting", async () => {
  state.posted = true;
  state.exactRetry = true;
  await expect(addRacikan(form())).rejects.toThrow("REDIRECT /klinik/rekam-medis/visit?racikan=dibuat");
  expect(state.calls).toEqual(["clinic_issue_official_compound"]);
});
