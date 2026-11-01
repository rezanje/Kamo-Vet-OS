// Pengganti server action kasir di tes layar: pelanggan dicari dari daftar uji
// dengan aturan cocok yang sama persis dengan pencarian server.
import { vi } from "vitest";
import { cocokPelanggan, BATAS_SARAN_PELANGGAN, type CustRow } from "@/lib/kasir-pelanggan";

export const pelangganUji: { rows: CustRow[] } = { rows: [] };

export const kasirActionsMock = {
  tambahCustomerKasir: vi.fn(),
  cariCustomerKasir: vi.fn(async (q: string) => ({
    ok: true as const,
    customers: pelangganUji.rows.filter(c => cocokPelanggan(c, q)).slice(0, BATAS_SARAN_PELANGGAN),
  })),
  ambilCustomerKasir: vi.fn(async (id: string) => pelangganUji.rows.find(c => c.id === id) ?? null),
};
