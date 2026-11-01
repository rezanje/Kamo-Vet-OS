import { expect, it } from "vitest";
import { semuaPelanggan } from "@/lib/pelanggan-semua";

// Server database memotong 10.000 baris per permintaan; pelanggan produksi sudah >10.000.
function db(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `c-${String(i).padStart(6, "0")}`, name: `P${i}`, phone: "08" }));
  return {
    from: () => {
      let a = 0, b = 0;
      const q = {
        select: () => q, order: () => q,
        range: (from: number, to: number) => { a = from; b = to; return q; },
        then: (resolve: (r: unknown) => void) => resolve({ data: rows.slice(a, Math.min(b + 1, a + 10_000)), count: total, error: null }),
      };
      return q;
    },
  };
}

it("memuat semua pelanggan walau lebih dari 10.000", async () => {
  const { data } = await semuaPelanggan(db(10_425) as never, "id, name, phone");
  expect(data).toHaveLength(10_425);
  expect(data.at(-1)?.id).toBe("c-010424");
});
