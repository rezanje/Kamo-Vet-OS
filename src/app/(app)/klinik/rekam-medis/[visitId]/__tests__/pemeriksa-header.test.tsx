import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import React from "react";
import { roundTripClient, filterOf, type Call } from "@/lib/__tests__/helpers/round-trip-client";
import { PemeriksaHeaderField } from "../PemeriksaHeaderField";

// Header Rekam Medis: baris "Dokter pemeriksa" (visits.pemeriksa_id), baca saja.
const s = vi.hoisted(() => ({ rt: null as null | ReturnType<typeof import("@/lib/__tests__/helpers/round-trip-client").roundTripClient>, visit: {} as Record<string, unknown>, employeeError: false }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => s.rt!.client }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm", () => ({ RekamForm: () => null }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/RacikanInline", () => ({ RacikanInline: () => null }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ admitInpatient: vi.fn(), continueToInpatient: vi.fn() }));
import Page from "@/app/(app)/klinik/rekam-medis/[visitId]/page";

const baseVisit = () => ({
  id: "visit-a", pet_id: "pet-a", branch_id: "branch-a", legacy_source_key: null, archived_at: null, poli: "Grooming", status: "Selesai",
  dokter: "Agung", doctor_id: "agung", keluhan: "Grooming", created_at: "2026-11-10T03:00:00Z", source: null, pemeriksa_id: null,
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
    case "invoices": return { data: [{ id: "inv-a", voided_at: null, paid_status: "Lunas", invoice_items: [] }] };
    case "employees":
      if (call.single && filterOf(call, "eq", "id") === "aini") return s.employeeError ? { data: null, error: { message: "gagal" } } : { data: { nama: "DRH. AINI" } };
      return { data: [{ id: "agung", nama: "Agung", jabatan: "Groomer" }] };
    case "profiles": return { data: { role: "OWNER", is_active: true } };
    default: return undefined;
  }
}

function cari(node: unknown): { found: boolean; nama: unknown } {
  let out = { found: false, nama: null as unknown };
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object" || out.found) return;
    if (Array.isArray(n)) return n.forEach(walk);
    const el = n as { type?: unknown; props?: Record<string, unknown> };
    if (el.type === PemeriksaHeaderField) { out = { found: true, nama: el.props!.nama }; return; }
    if (el.props) walk(el.props.children);
  };
  walk(node);
  return out;
}
const open = async () => { s.rt = roundTripClient(respond); return cari(await Page({ params: Promise.resolve({ visitId: "visit-a" }), searchParams: Promise.resolve({}) })); };

beforeEach(() => { s.visit = baseVisit(); s.employeeError = false; });

it("kunjungan dengan dokter pemeriksa: header memuat namanya dari kartu karyawan", async () => {
  s.visit = { ...baseVisit(), pemeriksa_id: "aini" };
  const r = await open();
  expect(r.found).toBe(true); expect(r.nama).toBe("DRH. AINI");
});
it("tanpa pemeriksa: komponen ada tetapi nama kosong (tidak menampilkan apa pun)", async () => {
  const r = await open();
  expect(r.found).toBe(true); expect(r.nama).toBeNull();
});
it("gagal membaca kartu karyawan: baris tidak tampil, halaman tetap terbuka", async () => {
  s.visit = { ...baseVisit(), pemeriksa_id: "aini" }; s.employeeError = true;
  const r = await open();
  expect(r.found).toBe(true); expect(r.nama).toBeNull();
});
it("hanya membaca: tidak ada tulis ke database", async () => {
  s.visit = { ...baseVisit(), pemeriksa_id: "aini" }; await open();
  expect(s.rt!.calls.some((c) => c.ops.some(([op]) => ["insert", "update", "upsert", "delete"].includes(op)))).toBe(false);
});
it("tampilan: label + nama; kosong bila nama null", () => {
  const html = renderToStaticMarkup(<PemeriksaHeaderField nama="DRH. AINI" />);
  expect(html).toContain("Dokter pemeriksa"); expect(html).toContain("DRH. AINI");
  expect(renderToStaticMarkup(<PemeriksaHeaderField nama={null} />)).toBe("");
});
