// Pengganti server action POS backoffice di tes layar: pelanggan dicari dari daftar
// uji dengan aturan cocok yang sama persis dengan pencarian server.
import { vi } from "vitest";
import { cocokPelanggan, BATAS_SARAN_PELANGGAN } from "@/lib/kasir-pelanggan";
import type { Cust } from "@/lib/pos-pelanggan";

export const pelangganPosUji: { rows: Cust[] } = { rows: [] };

export const posActionsMock = {
  checkoutSale: vi.fn(),
  cariPelangganPosAction: vi.fn(async (q: string) => ({
    ok: true as const,
    customers: pelangganPosUji.rows.filter(c => cocokPelanggan(c, q)).slice(0, BATAS_SARAN_PELANGGAN),
  })),
  ambilPelangganPosAction: vi.fn(async (id: string) => pelangganPosUji.rows.find(c => c.id === id) ?? null),
};
