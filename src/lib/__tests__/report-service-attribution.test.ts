import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ tables: [] as string[], snapshotsSelected: false }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: (table: string) => {
    fixture.tables.push(table);
    const q = {
      select: (fields: string) => { if (table === "invoice_items") fixture.snapshotsSelected = fields.includes("service_performers"); return q; },
      is: () => q, gte: () => q, lte: () => q, order: () => q, in: () => q, range: () => q,
      then: (resolve: (result: unknown) => void) => {
        const rows = table === "invoice_items" ? [{
          id: "line-1", deskripsi: "Grooming", qty: 1, harga: 100, diskon_persen: 0,
          jenis: "jasa", item_id: "service-1", service_performers: {
            doctor_id: "doctor-saved", doctor_name: "Dokter Tersimpan",
            staff_id: "groomer-saved", staff_name: "Groomer Tersimpan",
          },
          invoices: { visit_id: "visit-1", invoice_no: "INV.FICTION", created_at: "2026-10-24T09:00:00Z",
            paid_status: "Lunas", visits: { branches: { name: "Ciawi" }, customers: { name: "Pelanggan Fiktif" }, pets: { name: "Anabul Fiktif" } } },
        }] : [];
        return resolve({ data: rows, count: rows.length, error: null });
      },
    };
    return q;
  },
}) }));

import { ambilPenjualanBarang } from "@/app/(app)/laporan/penjualan-barang/data";

beforeEach(() => { fixture.tables = []; fixture.snapshotsSelected = false; });

it("reports the saved doctor and groomer on the exact service line without reconstructing current staff", async () => {
  const result = await ambilPenjualanBarang({ dari: "2026-10-24", sampai: "2026-10-24", kanal: "Klinik", jenis: "Jasa", q: "" });
  expect(result.pesanError).toBe("");
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].pelaksana).toBe("Dokter: Dokter Tersimpan · Pelaksana: Groomer Tersimpan");
  expect(result.nilaiTotal).toBe(100);
  expect(fixture.snapshotsSelected).toBe(true);
  expect(fixture.tables).not.toContain("employees");
});
