import { beforeEach, expect, it, vi } from "vitest";
import { roundTripClient, filterOf, type Call } from "@/lib/__tests__/helpers/round-trip-client";

// Tautan "Riwayat pasien" di header halaman Rekam Medis satu kunjungan (menuju riwayat semua kunjungan hewan itu).
const s = vi.hoisted(() => ({ rt: null as null | ReturnType<typeof import("@/lib/__tests__/helpers/round-trip-client").roundTripClient>, visit: {} as Record<string, unknown>, status: "Selesai" }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => s.rt!.client }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/RekamForm", () => ({ RekamForm: () => null }));
vi.mock("@/app/(app)/klinik/rekam-medis/[visitId]/RacikanInline", () => ({ RacikanInline: () => null }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ admitInpatient: vi.fn(), continueToInpatient: vi.fn() }));
import Page from "@/app/(app)/klinik/rekam-medis/[visitId]/page";

const baseVisit = () => ({
  id: "visit-a", pet_id: "pet-a", branch_id: "branch-a", legacy_source_key: null, archived_at: null, poli: "Poli Umum", status: s.status,
  dokter: "DRH. ILHAM", doctor_id: "ilham", keluhan: "Batuk", created_at: "2026-11-10T03:00:00Z", source: null,
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
    case "employees": return { data: [] };
    case "profiles": return { data: { role: "OWNER", is_active: true } };
    default: return undefined;
  }
}
type Props = Record<string, unknown> & { children?: unknown };
function cari(node: unknown, testId: string): Props | null {
  let hasil: Props | null = null;
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object" || hasil) return;
    if (Array.isArray(n)) return n.forEach(walk);
    const el = n as { props?: Props };
    if (el.props?.["data-testid"] === testId) { hasil = el.props; return; }
    if (el.props) walk(el.props.children);
  };
  walk(node);
  return hasil;
}
const buka = async () => { s.rt = roundTripClient(respond); return Page({ params: Promise.resolve({ visitId: "visit-a" }), searchParams: Promise.resolve({}) }); };

beforeEach(() => { s.visit = baseVisit(); s.status = "Selesai"; });

it("rekam medis selesai: header punya tautan Riwayat pasien ke halaman hewan ini", async () => {
  const link = cari(await buka(), "riwayat-pasien-link");
  expect(link).not.toBeNull();
  expect(link!.href).toBe("/klinik/rekam-medis/pasien/pet-a");
});

it("menunggu pembayaran juga punya tautan", async () => {
  s.status = "Pembayaran"; s.visit = { ...baseVisit(), status: "Pembayaran" };
  expect(cari(await buka(), "riwayat-pasien-link")?.href).toBe("/klinik/rekam-medis/pasien/pet-a");
});

it("riwayat impor (legacy) memakai tautan yang sama", async () => {
  s.visit = { ...baseVisit(), legacy_source_key: "impor:9" };
  expect(cari(await buka(), "riwayat-pasien-link")?.href).toBe("/klinik/rekam-medis/pasien/pet-a");
});

it("tanpa pet_id tidak ada tautan rusak", async () => {
  s.visit = { ...baseVisit(), pet_id: null };
  expect(cari(await buka(), "riwayat-pasien-link")).toBeNull();
});

it("tautan hanya membaca: tidak ada tulis ke database saat membuka halaman", async () => {
  await buka();
  expect(s.rt!.calls.some((c) => c.ops.some(([op]) => ["insert", "update", "upsert", "delete"].includes(op)))).toBe(false);
});
