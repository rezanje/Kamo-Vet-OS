import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// U07: the inpatient detail page (and its handoff summary) start independent reads
// together, keep the branch guard first, and hand Obat Khusus its preloaded data.
const s = vi.hoisted(() => ({
  started: [] as string[], gates: new Map<string, Promise<void>>(), authReads: 0, clientCalls: 0,
  obatProps: null as null | Record<string, unknown>, broken: "",
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("NOT_FOUND"); } }));
vi.mock("@/lib/branch-access", () => ({ allowedBranchIds: async () => ["branch-a"], canUseBranch: (allowed: string[] | null, id: string) => allowed === null || allowed.includes(id) }));
vi.mock("@/app/(app)/klinik/rawat-inap/[id]/PapanPemantauan", () => ({ PapanPemantauan: () => <div>DAILY MONITORING</div> }));
vi.mock("@/app/(app)/klinik/rawat-inap/[id]/ObatKhusus", () => ({ ObatKhusus: (props: Record<string, unknown>) => { s.obatProps = props; return <div>DOSE PROTOCOL</div>; } }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ changeCondition: async () => {}, sendRipWa: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => { s.clientCalls++; return {
  auth: { getUser: async () => { s.authReads++; return { data: { user: { id: "actor" } } }; } },
  from(table: string) {
    let single = false; let byVisit = false;
    const q = {
      select: () => q, eq: (k: string) => { if (k === "visit_id") byVisit = true; return q; }, in: () => q, order: () => q, limit: () => q, is: () => q, range: () => q,
      maybeSingle: () => { single = true; return q; },
      then: (done: (v: unknown) => unknown) => {
        const name = table === "inpatient_records" && byVisit ? "inpatient_records:visit" : table;
        s.started.push(name);
        let data: unknown = [];
        if (table === "inpatient_records") data = byVisit ? [{ id: "inpat" }] : { id: "inpat", branch_id: "branch-a", visit_id: "visit-a", admitted_at: "2026-10-22T10:00:00Z", condition_status: "stabil", discharged_at: null, treatment_plan: "Fictional care", doctor_name: "Drh Inap", branches: { name: "Branch A" }, visits: { id: "visit-a", poli: "Umum", keluhan: "Fictional complaint", created_at: "2026-10-22T08:00:00Z", pets: { name: "Fictional pet" }, customers: { name: "Fictional owner" } } };
        if (table === "profiles") data = { role: "DOCTOR" };
        if (table === "visits") data = single ? { id: "visit-a", dokter: "Drh Konsultasi", keluhan: "Fictional complaint" } : [];
        if (table === "medical_records") data = [{ id: "mr-a", visit_id: "visit-a", created_at: "2026-10-22T09:00:00Z", anamnesis: "Fictional consultation note", diagnosis: null, catatan_resep: null }];
        if (table === "invoices") data = [{ id: "invoice-a", invoice_no: "INV.A", paid_status: "Lunas", voided_at: null, created_at: "2026-10-22T09:30:00Z" }];
        if (table === "inpatient_medications") data = [{ id: "med-a", nama_obat: "Fictional protocol", dosis: null, rute: null, frekuensi_per_hari: 2, durasi_hari: 3, mulai_tanggal: "2026-10-22", dihentikan_at: null, catatan: null }];
        const rows = Array.isArray(data) ? data : [];
        const result = { data: single ? (Array.isArray(data) ? data[0] ?? null : data) : data, count: rows.length, error: table === s.broken ? { message: "private read failure" } : null };
        return (s.gates.get(name) ?? Promise.resolve()).then(() => done(result));
      },
    };
    return q;
  },
}; } }));
import Page from "@/app/(app)/klinik/rawat-inap/[id]/page";

const render = async () => renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "inpat" }), searchParams: Promise.resolve({}) }));
function gate(name: string) { let open!: () => void; s.gates.set(name, new Promise<void>((resolve) => { open = resolve; })); return () => open(); }
beforeEach(() => {
  s.started = []; s.gates = new Map(); s.authReads = 0; s.clientCalls = 0; s.obatProps = null; s.broken = "";
  vi.spyOn(console, "info").mockImplementation(() => {});
});

it("starts consents, logs, role, tariff, stay type, continuation and medication history while the handoff summary is still loading", async () => {
  const openVisit = gate("visits");
  const page = render();
  await vi.waitFor(() => expect(s.started).toEqual(expect.arrayContaining(
    ["consents", "inpatient_daily_logs", "inpatient_status_log", "profiles", "items", "inpatient_medications"])));
  expect(s.started).not.toContain("medical_records");
  openVisit();
  const html = await page;
  expect(html).toContain("Ringkasan konsultasi dan resep");
  expect(html).toContain("DOSE PROTOCOL");
  expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/^\[u07:detailRawatInap\] inpat induk=\d+ms anak=\d+ms total=\d+ms$/));
});

it("passes the signed-in user and medication history to Obat Khusus so it does not read them again", async () => {
  await render();
  expect(s.authReads).toBe(1);
  expect(s.obatProps).toMatchObject({ recordId: "inpat", aktif: true, userId: "actor" });
  expect((s.obatProps!.history as { medications: { id: string }[] }).medications.map((m) => m.id)).toEqual(["med-a"]);
});

it("hands Obat Khusus a failed history as null so it still shows the incomplete-history warning", async () => {
  s.broken = "inpatient_medications";
  await render();
  expect(s.obatProps!.history).toBeNull();
});

it("loads invoice lines and the visit's stays while prescriptions are still loading", async () => {
  const openRx = gate("prescription_items");
  const page = render();
  await vi.waitFor(() => expect(s.started).toEqual(expect.arrayContaining(["prescription_items", "invoice_items", "inpatient_records:visit"])));
  openRx();
  expect(await page).toContain("INV.A");
});

it("still fails the handoff summary closed when invoice lines fail while prescriptions are in flight", async () => {
  s.broken = "invoice_items";
  const html = await render();
  expect(html).toContain("Ringkasan belum dapat dimuat lengkap");
  expect(html).not.toContain("INV.A");
  expect(html).toContain("DAILY MONITORING");
});

