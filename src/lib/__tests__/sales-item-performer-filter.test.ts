import { expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
import { ambilPenjualanBarang } from "../../app/(app)/laporan/penjualan-barang/data";

const invoice = (id: string, subtotal: number, discount = 0) => ({
  id, visit_id: `visit-${id}`, invoice_no: `INV-${id}`, created_at: "2026-10-24T09:00:00Z",
  subtotal, discount, paid_status: "Lunas", voided_at: null,
  visits: { branch_id: "branch-1", branches: { name: "Ciawi" }, customers: { name: "Pelanggan Fiktif" } },
});
const line = (id: string, source: ReturnType<typeof invoice>, performers: unknown) => ({
  id, deskripsi: "Konsultasi", qty: 1, harga: source.subtotal, diskon_persen: 0,
  jenis: "jasa", item_id: null, service_performers: performers, invoices: source,
});
const filters = { dari: "2026-10-24", sampai: "2026-10-24", kanal: "Klinik" as const, jenis: "Jasa", q: "" };

it("filters by saved performer ID, keeps a two-person source line once, and preserves zero-net lines", async () => {
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { invoice_items: [
    line("a", invoice("a", 100), { doctor_id: "doctor-a", doctor_name: "Nama Sama", staff_id: "staff-a", staff_name: "Nama Sama" }),
    line("b", invoice("b", 200, 200), { doctor_id: "doctor-b", doctor_name: "Nama Sama", staff_id: null }),
  ], medical_records: [] } }).client);

  const all = await ambilPenjualanBarang(filters);
  expect(all.pesanError).toBe("");
  expect(all.rows.map(row => row.nilai)).toEqual([100, 0]);
  expect(all.nilaiTotal).toBe(100);
  expect(all.pelaksanaOptions.map(person => person.id)).toEqual(["doctor-a", "doctor-b", "staff-a"]);
  const doctor = await ambilPenjualanBarang({ ...filters, pelaksanaId: "doctor-a" });
  const staff = await ambilPenjualanBarang({ ...filters, pelaksanaId: "staff-a" });
  expect(doctor.rows.map(row => row.id)).toEqual(["klinik-a"]);
  expect(staff.rows.map(row => row.id)).toEqual(["klinik-a"]);
  expect(doctor.nilaiTotal).toBe(100);
  expect(staff.nilaiTotal).toBe(100);
  expect((await ambilPenjualanBarang({ ...filters, pelaksanaId: "doctor-b" })).rows.map(row => row.nilai)).toEqual([0]);
  expect((await ambilPenjualanBarang({ ...filters, pelaksanaId: "unknown" })).rows).toEqual([]);
});

it("does not treat customer or document text as performer identity", async () => {
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { invoice_items: [
    line("a", invoice("a", 100), { doctor_id: "doctor-a", doctor_name: "Dokter A", staff_id: null }),
  ], medical_records: [] } }).client);
  const result = await ambilPenjualanBarang({ ...filters, q: "Pelanggan", pelaksanaId: "doctor-b" });
  expect(result.rows).toEqual([]);
});

it("reconciles a mixed posted invoice while selecting its saved doctor or ward performer", async () => {
  const source = invoice("mixed", 500, 100);
  const make = (id: string, deskripsi: string, harga: number, diskon_persen: number, jenis: string, item_id: string | null,
    service_performers: unknown = null, compound_recipe_id: string | null = null) => ({
    id, deskripsi, qty: 1, harga, diskon_persen, jenis, item_id, service_performers, compound_recipe_id, invoices: source,
  });
  mocks.createClient.mockResolvedValue(clientFixture({ tables: { invoice_items: [
    make("obat", "Obat", 100, 0, "obat", "item-obat"),
    make("racikan", "Puyer", 200, 50, "obat", null, null, "recipe-puyer"),
    make("konsultasi", "Konsultasi", 300, 0, "jasa", null, { doctor_id: "doctor-a", doctor_name: "Dokter A", staff_id: null }),
    make("ranap", "Rawat inap", 400, 100, "jasa", null, { doctor_id: null, staff_id: "staff-a", staff_name: "Perawat A" }),
  ], medical_records: [] } }).client);

  const obat = await ambilPenjualanBarang({ ...filters, jenis: "Obat" });
  const racikan = await ambilPenjualanBarang({ ...filters, jenis: "Racikan" });
  const jasa = await ambilPenjualanBarang(filters);
  expect([obat.nilaiTotal, racikan.nilaiTotal, jasa.nilaiTotal]).toEqual([80, 80, 240]);
  expect(jasa.rows.map(row => [row.nama, row.nilai, row.href])).toEqual([
    ["Konsultasi", 240, "/klinik/pembayaran/visit-mixed/invoice?invoice_id=mixed"],
    ["Rawat inap", 0, "/klinik/pembayaran/visit-mixed/invoice?invoice_id=mixed"],
  ]);
  expect((await ambilPenjualanBarang({ ...filters, pelaksanaId: "doctor-a" })).nilaiTotal).toBe(240);
  expect((await ambilPenjualanBarang({ ...filters, pelaksanaId: "staff-a" })).rows.map(row => row.nilai)).toEqual([0]);
});
