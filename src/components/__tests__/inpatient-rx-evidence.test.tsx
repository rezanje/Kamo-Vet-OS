import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandoffEvidence, HandoffPrescription, InpatientHandoff } from "@/lib/inpatient-handoff";

// All data below is fictional.
const s = vi.hoisted(() => ({ rpcCalls: [] as { fn: string; args: Record<string, unknown> }[], rpcError: null as null | { message: string }, writes: [] as string[] }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw Object.assign(new Error("REDIRECT"), { to }); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => { s.rpcCalls.push({ fn, args }); return { data: "evidence-1", error: s.rpcError }; },
    from: (table: string) => ({ insert: () => { s.writes.push(table); return {}; }, update: () => { s.writes.push(table); return {}; }, delete: () => { s.writes.push(table); return {}; } }),
  }),
}));

import { catatBuktiObatBiasa, batalkanBuktiObatBiasa } from "@/app/(app)/klinik/rawat-inap/[id]/rx-evidence-actions";
import { ObatBiasaEvidence } from "@/app/(app)/klinik/rawat-inap/[id]/ObatBiasaEvidence";
import { HandoffPanel } from "@/app/(app)/klinik/rawat-inap/[id]/HandoffPanel";
import { evidenceTotals, handoffSourceStatus, isRegularDrug, loadInpatientHandoff } from "@/lib/inpatient-handoff";

const SQL = readFileSync("supabase/migrations/20261026090000_inpatient_rx_evidence.sql", "utf8");
const RECORD = "11111111-1111-4111-8111-111111111111";
const RX = "22222222-2222-4222-8222-222222222222";
const rx = (over: Partial<HandoffPrescription> = {}): HandoffPrescription => ({ id: RX, medical_record_id: "mr", nama_obat: "Fictional Tablet", qty: 6, satuan: "tab", jenis: "obat", aturan_pakai: "2x1", compound_recipe_id: null, created_at: "2026-10-26T01:00:00Z", ...over });
const ev = (over: Partial<HandoffEvidence>): HandoffEvidence => ({ id: "e", prescription_item_id: RX, kind: "handover", qty: 1, unit: "tab", occurred_at: "2026-10-26T02:00:00Z", recorded_by_name: "Perawat Fiktif", note: null, voided_at: null, voided_by_name: null, void_reason: null, ...over });
const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
const redirectOf = async (run: Promise<unknown>) => { try { await run; } catch (error) { return (error as { to?: string }).to ?? String(error); } return "no redirect"; };
const valid = { recordId: RECORD, prescriptionItemId: RX, kind: "administration", qty: "1", requestKey: "fixture-key-0001", note: "", occurredAt: "" };

beforeEach(() => { s.rpcCalls = []; s.rpcError = null; s.writes = []; });

describe("cross-branch and relation guard", () => {
  it("lets only the RPC write and checks branch access, visit and branch of the inpatient stay", () => {
    expect(SQL).toMatch(/revoke insert, update, delete, truncate on public\.inpatient_rx_evidence from anon, authenticated/);
    expect(SQL).not.toMatch(/create policy[^;]*on public\.inpatient_rx_evidence\s+for (insert|update|delete|all)/i);
    expect(SQL).toMatch(/for select to authenticated using \(public\.user_can_access_branch\(branch_id\)\)/);
    expect(SQL).toMatch(/from public\.inpatient_records where id=p_inpatient_record_id for update;\s+if not found or not public\.user_can_access_branch\(v_rec\.branch_id\)/);
    expect(SQL).toContain("v_visit is distinct from v_rec.visit_id");
    // The trigger repeats the visit+branch relation check for every insert path.
    expect(SQL).toMatch(/new\.visit_id<>v_rec\.visit_id or new\.branch_id<>v_rec\.branch_id/);
  });
  it("shows the access error from the RPC and never writes a table directly", async () => {
    s.rpcError = { message: "ACCESS_DENIED: rawat inap atau cabang tidak dapat diakses" };
    const to = await redirectOf(catatBuktiObatBiasa(form(valid)));
    expect(decodeURIComponent(to)).toContain("error=rawat inap atau cabang tidak dapat diakses");
    expect(s.rpcCalls).toEqual([{ fn: "clinic_record_rx_evidence", args: expect.objectContaining({ p_inpatient_record_id: RECORD, p_prescription_item_id: RX }) }]);
    expect(s.writes).toEqual([]);
  });
  it("hides unknown database errors instead of leaking them", async () => {
    s.rpcError = { message: 'relation "private_table" does not exist' };
    const to = decodeURIComponent(await redirectOf(catatBuktiObatBiasa(form(valid))));
    expect(to).toContain("Bukti obat belum tersimpan");
    expect(to).not.toContain("private_table");
  });
});

describe("double submit / idempotency", () => {
  it("replays the same request key on a double submit and the RPC returns the first record", async () => {
    await redirectOf(catatBuktiObatBiasa(form(valid)));
    await redirectOf(catatBuktiObatBiasa(form(valid)));
    expect(s.rpcCalls.map((c) => c.args.p_request_key)).toEqual(["fixture-key-0001", "fixture-key-0001"]);
    expect(SQL).toContain("constraint inpatient_rx_evidence_request_unique unique (request_key)");
    expect(SQL).toMatch(/if v_existing\.request_hash is distinct from v_hash then\s+raise exception 'IDEMPOTENCY_CONFLICT/);
    expect(SQL).toMatch(/return v_existing\.id;/);
  });
  it("renders a distinct key per form so separate records are not merged by accident", () => {
    const html = renderToStaticMarkup(<ObatBiasaEvidence rx={rx()} evidence={[]} recordId={RECORD} active />);
    const keys = [...html.matchAll(/name="requestKey" value="([^"]+)"/g)].map((m) => m[1]);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });
  it("rejects a missing or short request key before calling the RPC", async () => {
    expect(decodeURIComponent(await redirectOf(catatBuktiObatBiasa(form({ ...valid, requestKey: "x" }))))).toContain("Muat ulang halaman");
    expect(s.rpcCalls).toEqual([]);
  });
});

describe("traceable void", () => {
  it("keeps voided evidence visible with who/when/why and excludes it from totals", () => {
    const rows = [ev({ id: "a", qty: 2 }), ev({ id: "b", kind: "administration", qty: 1, voided_at: "2026-10-26T03:00:00Z", voided_by_name: "Dokter Fiktif", void_reason: "Salah pasien" })];
    expect(evidenceTotals(rows, RX)).toEqual({ handedOver: 2, administered: 0, voided: 1 });
    const html = renderToStaticMarkup(<ObatBiasaEvidence rx={rx()} evidence={rows} recordId={RECORD} active />);
    expect(html).toContain("Dibatalkan");
    expect(html).toContain("Dokter Fiktif");
    expect(html).toContain("Salah pasien");
    expect(html).toContain("line-through");
    // A void form exists only for the active row.
    expect(html.match(/name="evidenceId" value="([^"]+)"/g)).toEqual(['name="evidenceId" value="a"']);
  });
  it("requires a reason and forbids delete or content edits in the database", async () => {
    expect(decodeURIComponent(await redirectOf(batalkanBuktiObatBiasa(form({ recordId: RECORD, evidenceId: RX, reason: "x" }))))).toContain("alasan pembatalan");
    expect(s.rpcCalls).toEqual([]);
    await redirectOf(batalkanBuktiObatBiasa(form({ recordId: RECORD, evidenceId: RX, reason: "Dicatat ganda" })));
    expect(s.rpcCalls).toEqual([{ fn: "clinic_void_rx_evidence", args: { p_evidence_id: RX, p_reason: "Dicatat ganda" } }]);
    expect(SQL).toContain("RX_EVIDENCE_LOCKED: bukti tidak dapat dihapus");
    expect(SQL).toContain("RX_EVIDENCE_LOCKED: isi bukti tidak dapat diubah");
    expect(SQL).toContain("RX_EVIDENCE_LOCKED: pembatalan tidak dapat diubah atau dicabut");
    expect(SQL).toContain("batalkan catatan pemberian terlebih dahulu");
  });
});

describe("over-quantity", () => {
  it("rejects an impossible WIB date instead of silently moving it to another day", async () => {
    const to = decodeURIComponent(await redirectOf(catatBuktiObatBiasa(form({ ...valid, occurredAt: "2026-02-31T10:30" }))));
    expect(to).toContain("Waktu bukti tidak valid");
    expect(s.rpcCalls).toEqual([]);
  });
  it("rejects malformed, zero, negative or over-precise quantities before the RPC", async () => {
    for (const qty of ["0", "-1", "abc", "1.2345", "", "1e3"]) {
      expect(decodeURIComponent(await redirectOf(catatBuktiObatBiasa(form({ ...valid, qty }))))).toContain("Jumlah harus lebih dari nol");
    }
    expect(s.rpcCalls).toEqual([]);
  });
  it("limits the form to the remaining quantity and disables it when nothing remains", () => {
    const html = renderToStaticMarkup(<ObatBiasaEvidence rx={rx({ qty: 2 })} evidence={[ev({ id: "a", qty: 2 })]} recordId={RECORD} active />);
    const qtyInputs = [...html.matchAll(/<input[^>]*name="qty"[^>]*>/g)].map((m) => m[0]);
    expect(qtyInputs).toHaveLength(2);
    expect(qtyInputs[0]).toMatch(/max="0"/);
    expect(qtyInputs[0]).toMatch(/disabled=""/);
    expect(qtyInputs[1]).toMatch(/max="2"/);
    expect(qtyInputs[1]).not.toMatch(/disabled/);
  });
  it("enforces prescription limits and keeps handover dependency explicitly configurable", () => {
    expect(SQL).toContain("jumlah diserahkan melebihi jumlah resep");
    expect(SQL).toContain("jumlah diberikan melebihi jumlah resep");
    expect(SQL).toContain("jumlah diberikan melebihi jumlah yang sudah diserahkan");
    expect(SQL).toMatch(/v_requires:=coalesce\(v_requires,false\);v_backdate:=coalesce\(v_backdate,0\);/);
    expect(SQL).toMatch(/administration_requires_handover boolean not null default false/);
    expect(SQL).toMatch(/max_backdate_minutes integer not null default 0/);
    expect(SQL).not.toMatch(/create policy[^;]*inpatient_rx_evidence_settings\s+for (insert|update|delete|all)/i);
  });
});

describe("prescriptions without a valid relation", () => {
  it("offers evidence only for regular drugs, not compounds or services", () => {
    expect(isRegularDrug(rx())).toBe(true);
    expect(isRegularDrug(rx({ compound_recipe_id: "recipe" }))).toBe(false);
    expect(isRegularDrug(rx({ jenis: "jasa" }))).toBe(false);
    expect(SQL).toMatch(/v_rx\.jenis is distinct from 'obat' or v_rx\.compound_recipe_id is not null/);
    const data: InpatientHandoff = { doctor: null, complaint: null, records: [], recipes: [], invoices: [], invoiceLines: [], evidence: [], prescriptions: [rx({ id: "svc", jenis: "jasa", nama_obat: "Fictional Service" }), rx({ id: "cmp", compound_recipe_id: "recipe", nama_obat: "Fictional Compound" })] };
    const html = renderToStaticMarkup(<HandoffPanel data={data} visitId="visit" admittedAt="2026-10-26T00:00:00Z" recordId={RECORD} active />);
    expect(html).toContain("Belum ada obat biasa dalam resep tersimpan untuk kunjungan ini.");
    expect(html).not.toContain("data-rx-evidence");
  });
  it("ignores evidence for another prescription id and never matches by name", () => {
    const other = ev({ id: "x", prescription_item_id: "33333333-3333-4333-8333-333333333333", qty: 5 });
    expect(evidenceTotals([other], RX)).toEqual({ handedOver: 0, administered: 0, voided: 0 });
    const [row] = handoffSourceStatus({ doctor: null, complaint: null, records: [], recipes: [], invoices: [], invoiceLines: [], prescriptions: [rx()], evidence: [other] }).rows;
    expect(row.handover).toBe("Belum ada bukti penyerahan per baris");
    expect(row.administration).toBe("Belum ada bukti pemberian per resep");
  });
  it("does not claim 'not given' when the evidence read failed, and shows no forms", () => {
    const html = renderToStaticMarkup(<ObatBiasaEvidence rx={rx()} evidence={null} recordId={RECORD} active />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Jangan menyimpulkan obat belum diserahkan atau diberikan");
    expect(html).not.toContain("<form");
    const [row] = handoffSourceStatus({ doctor: null, complaint: null, records: [], recipes: [], invoices: [], invoiceLines: [], prescriptions: [rx()], evidence: null }).rows;
    expect(row.administration).toBe("Bukti pemberian belum dapat dimuat");
  });
  it("keeps billing/payment separate from handover and administration", () => {
    const [row] = handoffSourceStatus({ doctor: null, complaint: null, records: [], recipes: [], prescriptions: [rx()], evidence: [ev({ id: "h", qty: 3 }), ev({ id: "g", kind: "administration", qty: 2 })],
      invoices: [{ id: "inv", invoice_no: "INV.FIKTIF", paid_status: "DP", voided_at: null, created_at: "2026-10-26" }], invoiceLines: [{ id: "l", invoice_id: "inv", prescription_item_id: RX, compound_recipe_id: null, qty: 6 }] }).rows;
    expect(row.billing).toContain("INV.FIKTIF");
    expect(row.payment).toContain("Faktur DP");
    expect(row.handover).toBe("Diserahkan 3 dari 6 tab");
    expect(row.administration).toBe("Diberikan 2 dari 6 tab");
  });
});

describe("loader and side effects", () => {
  it("reads evidence only for regular-drug ids of the same visit and keeps the summary when evidence fails", async () => {
    const reads: { table: string; in?: unknown }[] = [];
    const db = { from(table: string) { const r: { table: string; in?: unknown } = { table }; reads.push(r); const q = { select: () => q, eq: () => q, order: () => q, in: (_: string, v: unknown) => { r.in = v; return q; }, range: () => q, maybeSingle: () => q,
      then(done: (v: unknown) => unknown) {
        const rows: Record<string, unknown> = { visits: { id: "visit", dokter: null, keluhan: null }, medical_records: [{ id: "mr", visit_id: "visit", created_at: "2026-10-26" }],
          prescription_items: [rx(), rx({ id: "svc", jenis: "jasa" }), rx({ id: "cmp", compound_recipe_id: "recipe" })] };
        const data = rows[table] ?? [];
        return Promise.resolve({ data, count: Array.isArray(data) ? data.length : 1, error: table === "inpatient_rx_evidence" ? { message: "missing" } : null }).then(done);
      } }; return q; } };
    const result = await loadInpatientHandoff(db as never, "visit", "branch");
    expect(result?.prescriptions).toHaveLength(3);
    expect(result?.evidence).toBeNull();
    expect(reads.filter((r) => r.table === "inpatient_rx_evidence").map((r) => r.in)).toEqual([[RX]]);
  });
  it("does not touch stock, journals or invoices", () => {
    const writes = [...SQL.matchAll(/(insert into|update|delete from)\s+public\.([a-z_]+)/gi)].map((m) => m[2]);
    expect(new Set(writes)).toEqual(new Set(["inpatient_rx_evidence"]));
    expect(SQL).not.toMatch(/stock_|journal|invoice/i);
  });
});
