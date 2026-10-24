import { expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "fictional-owner" } }, error: null }) },
  from: (table: string) => {
    const q = { select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: table === "profiles" ? { role: "OWNER" } : null, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
    };
    return q;
  },
}) }));
vi.mock("@/lib/akses", () => ({ bolehBukaPath: () => true }));
vi.mock("@/app/(app)/laporan/penjualan-barang/data", () => ({
  waktuWIB: () => "24 Okt 2026",
  ambilPenjualanBarang: async () => ({ rows: [{
    id: "line-1", waktu: "2026-10-24T09:00:00Z", dokumen: "INV.FICTION", href: "/klinik/pembayaran/visit-1/invoice",
    kanal: "Klinik", jenis: "Jasa", cabang: "Ciawi", pelanggan: "Pelanggan Fiktif", hewan: "Anabul Fiktif",
    nama: "Grooming", pelaksana: "Dokter: Dokter Tersimpan · Pelaksana: Groomer Tersimpan",
    qty: 1, harga: 100, diskon: 0, nilai: 100, status: "Lunas",
  }], pesanError: "", nilaiTotal: 100, qtyTotal: 1 }),
}));

import { GET } from "@/app/(app)/laporan/penjualan-barang/unduh/route";

it("includes saved line performers in the CSV without replacing the quantity and amount columns", async () => {
  const response = await GET(new Request("https://example.test/laporan/penjualan-barang/unduh?dari=2026-10-24&sampai=2026-10-24&jenis=Jasa"));
  expect(response.status).toBe(200);
  const csv = await response.text();
  expect(csv).toContain("Pelaksana tersimpan");
  expect(csv).toContain("Dokter: Dokter Tersimpan · Pelaksana: Groomer Tersimpan");
  expect(csv).toContain("Grooming");
});
