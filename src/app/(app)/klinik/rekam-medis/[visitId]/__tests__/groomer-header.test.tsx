import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import React from "react";
import { roundTripClient, filterOf, type Call } from "@/lib/__tests__/helpers/round-trip-client";
import { GroomerHeaderField } from "../GroomerHeaderField";

const s = vi.hoisted(() => ({ rt: null as null | ReturnType<typeof import("@/lib/__tests__/helpers/round-trip-client").roundTripClient>, visit: {} as Record<string, unknown>, lines: [] as unknown[], status: "Selesai" }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => s.rt!.client }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm", () => ({ RekamForm: () => null }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/RacikanInline", () => ({ RacikanInline: () => null }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ admitInpatient: vi.fn(), continueToInpatient: vi.fn() }));
import Page from "@/app/(app)/klinik/rekam-medis/[visitId]/page";

const baseVisit = () => ({
  id: "visit-a", pet_id: "pet-a", branch_id: "branch-a", legacy_source_key: null, archived_at: null, poli: "Poli Umum", status: s.status,
  dokter: "DRH. ILHAM", doctor_id: "ilham", keluhan: "Grooming", created_at: "2026-11-10T03:00:00Z", source: null,
  checked_in_at: null, service_started_at: null, service_finished_at: null, checked_out_at: null, service_provider_id: null,
  pets: { name: "Belang", species: "Kucing", breed: null, weight: 4, photo_url: null, created_at: "2026-01-01T00:00:00Z" },
  customers: { name: "Wita", phone: "0800", address: null, tier: null },
});
function respond(call: Call) {
  if (call.kind === "auth") return {};
  if (call.kind === "rpc") return { data: false };
  switch (call.name) {
    case "visits":
      if (filterOf(call, "eq", "id") === "visit-a" && call.single) {
        return { data: call.ops.some(([op, args]) => op === "select" && String(args[0]).startsWith("id, pet_id")) ? s.visit : { customer_id: "c", branch_id: "branch-a", created_at: "2026-11-10T03:00:00Z", continued_from_visit_id: null } };
      }
      return { data: [] };
    case "medical_records": return { data: [{ id: "record-a", visit_id: "visit-a", anamnesis: "A", diagnosis: "D", therapy: "T", clinical_revision: 1 }] };
    case "invoices": {
      const embedded = call.ops.some(([op, a]) => op === "select" && String(a[0]).includes("invoice_items"));
      return { data: embedded ? [{ id: "inv-a", invoice_items: s.lines }] : [{ id: "inv-a", voided_at: null, paid_status: "Lunas" }] };
    }
    case "employees": return { data: [
      { id: "ilham", nama: "DRH. ILHAM", jabatan: "Dokter Hewan" }, { id: "agung", nama: "Agung", jabatan: "Groomer" }] };
    case "profiles": return { data: { role: "OWNER", is_active: true } };
    default: return undefined;
  }
}
const line = (p: Record<string, unknown>, desc = "Grooming VET Lengkap + CU") => ({ deskripsi: desc, service_performers: { doctor_id: "ilham", doctor_name: "DRH. ILHAM", staff_id: null, staff_name: null, ...p }, items: { item_type: "Jasa", tindakan_kategori: "Konsultasi" } });

function findInfo(node: unknown): { found: boolean; info: unknown } {
  let out: { found: boolean; info: unknown } = { found: false, info: null };
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object" || out.found) return;
    if (Array.isArray(n)) return n.forEach(walk);
    const el = n as { type?: unknown; props?: Record<string, unknown> };
    if (el.type === GroomerHeaderField) { out = { found: true, info: el.props!.info }; return; }
    if (el.props) walk(el.props.children);
  };
  walk(node);
  return out;
}
const open = async () => { s.rt = roundTripClient(respond); return findInfo(await Page({ params: Promise.resolve({ visitId: "visit-a" }), searchParams: Promise.resolve({}) })); };

beforeEach(() => { s.visit = baseVisit(); s.lines = []; s.status = "Selesai"; });

it("Rekam Medis Belang (selesai, read-only): header memuat baris Groomer 'belum diisi'", async () => {
  s.lines = [line({})];
  const r = await open();
  expect(r.found).toBe(true);
  expect(r.info).toEqual({ label: "Groomer", nama: null });
});
it("groomer dari snapshot pelaksana invoice tampil di header", async () => {
  s.lines = [line({ staff_id: "agung", staff_name: "Agung" })];
  expect((await open()).info).toEqual({ label: "Groomer", nama: "Agung" });
});
it("groomer dari visits.service_provider_id; menunggu pembayaran juga tampil", async () => {
  s.status = "Pembayaran"; s.visit = { ...baseVisit(), status: "Pembayaran", service_provider_id: "agung" };
  expect((await open()).info).toEqual({ label: "Groomer", nama: "Agung" });
});
it("kunjungan bukan grooming: tidak ada baris", async () => {
  s.visit = { ...baseVisit(), keluhan: "Batuk" }; s.lines = [line({}, "Konsultasi dokter")];
  expect((await open()).info).toBeNull();
});
it("kunjungan legacy: tidak ditandai belum diisi", async () => {
  s.visit = { ...baseVisit(), legacy_source_key: "impor:9" };
  expect((await open()).info).toBeNull();
});
it("hanya membaca: tidak ada tulis ke database", async () => {
  s.lines = [line({})]; const r = await open(); void r;
  expect(s.rt!.calls.filter((c) => c.kind === "rpc" && /^(clinic_(save|post|edit|void)|update_|insert_)/.test(c.name))).toEqual([]);
  expect(s.rt!.calls.some((c) => c.ops.some(([op]) => ["insert", "update", "upsert", "delete"].includes(op)))).toBe(false);
});

it("tampilan: nama, 'belum diisi' redup, dan tidak ada apa pun bila null", () => {
  expect(renderToStaticMarkup(<GroomerHeaderField info={{ label: "Groomer", nama: "Agung, Bima" }} />)).toContain("Agung, Bima");
  const kosong = renderToStaticMarkup(<GroomerHeaderField info={{ label: "Groomer", nama: null }} />);
  expect(kosong).toContain("Groomer"); expect(kosong).toContain("belum diisi");
  expect(renderToStaticMarkup(<GroomerHeaderField info={{ label: "Pelaksana", nama: "Rina" }} />)).toContain("Pelaksana");
  expect(renderToStaticMarkup(<GroomerHeaderField info={null} />)).toBe("");
});
