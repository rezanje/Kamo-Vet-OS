import { expect, it } from "vitest";

// Review PR #570 MINOR-5: pengeluaran tunai bertanggal mundur mengurangi laci shift ini; rincian tutup shift menandainya.
import { muatRincianTutupShift } from "@/lib/rincian-tutup-shift-server";

function klien(expenses: unknown[]) {
  return { from: (t: string) => {
    const data = t === "cashier_shifts" ? { id: "s1", shift_type: "petshop", status: "open", branch_id: "b1", opened_by: "u", opening_balance: 100000, closing_balance: null, expected_cash: null, selisih: null, closing_breakdown: null, opened_at: "2026-11-26T01:00:00Z", closed_at: null, branches: { name: "C" }, profiles: { full_name: "K" } }
      : t === "expenses" ? expenses : [];
    const q: Record<string, unknown> = { select: () => q, eq: () => q, gte: () => q, lt: () => q, lte: () => q, in: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data, error: null }), then: (r: (v: unknown) => void) => r({ data, error: null }) };
    return q;
  } };
}

it("menandai pengeluaran tunai bertanggal sebelum hari buka shift, bukan yang bertanggal hari itu", async () => {
  const hasil = await muatRincianTutupShift(klien([
    { kategori: "Operasional", deskripsi: "beli galon", jumlah: 20000, metode_bayar: "Tunai", tanggal: "2026-11-26" },
    { kategori: "Listrik & Air", deskripsi: "token", jumlah: 50000, metode_bayar: "Tunai", tanggal: "2026-11-20" },
    { kategori: "Operasional", deskripsi: "transfer vendor", jumlah: 70000, metode_bayar: "Transfer", tanggal: "2026-11-20" },
  ]) as never, "s1");
  expect(hasil).not.toBeNull();
  expect(hasil!.pengeluaranTunaiRincian).toEqual([
    { keterangan: "beli galon", jumlah: 20000 },
    { keterangan: "token (tanggal mundur 20/11/2026)", jumlah: 50000 },
  ]);
  expect(hasil!.pengeluaranTunai).toBe(70000);
  expect(hasil!.pengeluaranNonTunai).toBe(70000);
});
it("baris tanpa kolom tanggal (data lama) tidak diberi tanda", async () => {
  const hasil = await muatRincianTutupShift(klien([{ kategori: "Operasional", deskripsi: null, jumlah: 5000, metode_bayar: "Tunai" }]) as never, "s1");
  expect(hasil!.pengeluaranTunaiRincian).toEqual([{ keterangan: "Operasional", jumlah: 5000 }]);
});
