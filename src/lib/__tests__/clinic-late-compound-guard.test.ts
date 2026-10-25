import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ status: "Pembayaran", invoice: false, failed: "", recordVisit: "visit", calls: [] as string[] }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT ${href}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, limit: () => query,
      maybeSingle: async () => {
        state.calls.push(`read:${table}`);
        return { error: state.failed === table ? { message: "read failed" } : null,
          data: table === "medical_records" ? { visit_id: state.recordVisit }
            : table === "visits" ? { status: state.status, checked_out_at: null }
              : state.invoice ? { id: "invoice" } : null };
      },
    };
    return query;
  },
  rpc: async (name: string) => {
    state.calls.push(name);
    return { data: "recipe", error: null };
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

beforeEach(() => { state.status = "Pembayaran"; state.invoice = false; state.failed = ""; state.recordVisit = "visit"; state.calls = []; });

it.each(["paid", "invoice", "failed invoice read", "wrong record"])("blocks %s before any compound issue", async (reason) => {
  if (reason === "paid") state.status = "Selesai";
  if (reason === "invoice") state.invoice = true;
  if (reason === "failed invoice read") state.failed = "invoices";
  if (reason === "wrong record") state.recordVisit = "other";
  await expect(addRacikan(form())).rejects.toThrow("Racikan%20baru");
  expect(state.calls).toEqual(["read:medical_records", "read:visits", "read:invoices"]);
});

it("keeps the existing unpaid official issue route after a successful guard", async () => {
  await expect(addRacikan(form())).rejects.toThrow("REDIRECT /klinik/rekam-medis/visit?racikan=dibuat");
  expect(state.calls).toEqual(["read:medical_records", "read:visits", "read:invoices", "clinic_issue_official_compound"]);
});
