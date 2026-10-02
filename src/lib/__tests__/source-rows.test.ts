import { expect, it } from "vitest";
import { sourceRows } from "../source-rows";
function fake(
  rows: { id: string }[],
  options: {
    count?: number;
    max?: number;
    error?: boolean;
    repeat?: boolean;
  } = {},
) {
  return {
    from: () => {
      let start = 0,
        end = 0;
      const q = {
        select: () => q,
        order: () => q,
        range: (a: number, b: number) => {
          start = a;
          end = b;
          return q;
        },
        then: (r: (v: unknown) => unknown) =>
          Promise.resolve({
            data: options.repeat
              ? rows.slice(0, 500)
              : rows.slice(
                  start,
                  Math.min(end + 1, start + (options.max ?? 500)),
                ),
            count: options.count ?? rows.length,
            error: options.error ? { message: "fiction source error" } : null,
          }).then(r),
      };
      return q;
    },
  };
}
it("reads all 1102 source rows after PostgREST page boundaries", async () => {
  const rows = Array.from({ length: 1102 }, (_, i) => ({ id: String(i) }));
  expect(await sourceRows(fake(rows), "fiction", "id")).toEqual(rows);
});
it("short page with remaining exact count fails instead of paying partial source", async () => {
  await expect(
    sourceRows(
      fake(
        Array.from({ length: 1102 }, (_, i) => ({ id: String(i) })),
        { max: 100 },
      ),
      "fiction",
      "id",
    ),
  ).rejects.toThrow("terpotong");
});
it("repeated rows during pagination fail instead of duplicate commission", async () => {
  await expect(
    sourceRows(
      fake(
        Array.from({ length: 1102 }, (_, i) => ({ id: String(i) })),
        { repeat: true },
      ),
      "fiction",
      "id",
    ),
  ).rejects.toThrow("berulang");
});
it("source query failure does not become empty financial data", async () => {
  await expect(
    sourceRows(fake([], { error: true }), "fiction", "id"),
  ).rejects.toThrow("gagal");
});
