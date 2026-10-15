import { expect, it } from "vitest";
import { diskonGolonganKeranjang, loadAturanDiskon } from "@/lib/harga-golongan";

function api(failedPage = -1) {
  const rows = Array.from({ length: 1205 }, (_, index) => ({ id: `rule-${index}`, item_id: `item-${index}`, item_category_id: null, diskon_persen: 5 }));
  return { from() {
    let start = 0; let end = 999; let counted = false;
    const query = {
      select: (_fields: string, options?: { count: string }) => { counted = options?.count === "exact"; return query; },
      eq: () => query, order: () => query,
      range: (from: number, to: number) => { start = from; end = to; return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows.slice(start, end + 1), count: counted ? rows.length : null,
        error: start === failedPage ? { message: "unavailable" } : null }).then(resolve),
    };
    return query;
  } };
}

it("uses the same per-product discount at checkout for a rule beyond the API's first 1,000 rows", async () => {
  const rules = await loadAturanDiskon(api(), "golongan");
  expect(diskonGolonganKeranjang([{ item_id: "item-1204", qty: 1, harga: 15000 }], rules, 0, new Map([
    ["item-1204", { item_id: "item-1204", category_id: null, parent_category_id: null }],
  ]))).toBe(750);
});

it("stops checkout when a later discount page is unavailable", async () => {
  const result = await loadAturanDiskon(api(500), "golongan").then(() => "partial rules", error => error.message);
  expect(result).toMatch(/belum.*dimuat/);
});
