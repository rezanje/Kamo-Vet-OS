import { expect, it } from "vitest";
import { completeReportQuery, completeReportQueryParalel } from "../report-query";

it("reads beyond the server's default row cap without losing the selected rows", async () => {
  const rows = Array.from({ length: 6001 }, (_, id) => ({ id: String(id), total: id }));
  const calls: number[] = [];
  const query = { order: () => ({ range: async (from: number, to: number) => {
    calls.push(from);
    return { data: rows.slice(from, to + 1), error: null, count: rows.length };
  } }) };
  expect((await completeReportQuery(query)).data).toEqual(rows);
  expect(calls).toEqual(Array.from({ length: 13 }, (_, index) => index * 500));
});

it("refuses a silently truncated page and a failed query", async () => {
  const query = { order: () => ({ range: async () => ({ data: [{ id: "1" }], error: null, count: 1001 }) }) };
  await expect(completeReportQuery(query)).rejects.toThrow(/terpotong/);
  await expect(completeReportQuery({ order: () => ({ range: async () => ({ data: null, error: { message: "denied" }, count: null }) }) })).rejects.toThrow(/denied/);
});

it("completeReportQueryParalel: tiap halaman memakai query baru, hasil sama dengan jalur berurutan, halaman bersamaan terbatas", async () => {
  const rows = Array.from({ length: 6001 }, (_, id) => ({ id: String(id).padStart(5, "0"), total: id }));
  const dibuat: number[] = [];
  const dipanggil: number[] = [];
  let sedang = 0, puncak = 0;
  const buat = () => {
    dibuat.push(dibuat.length);
    return { order: () => ({ range: async (from: number, to: number) => {
      dipanggil.push(from); sedang++; puncak = Math.max(puncak, sedang);
      await new Promise((r) => setTimeout(r, 3));
      sedang--;
      return { data: rows.slice(from, to + 1), error: null, count: rows.length };
    } }) };
  };
  const hasil = await completeReportQueryParalel(buat);
  expect(hasil.data).toEqual(rows);
  expect(dibuat).toHaveLength(13);
  expect([...dipanggil].sort((a, b) => a - b)).toEqual(Array.from({ length: 13 }, (_, index) => index * 500));
  expect(dipanggil[0]).toBe(0);
  expect(puncak).toBeGreaterThan(1);
  expect(puncak).toBeLessThanOrEqual(6);
});

it("completeReportQueryParalel: halaman terpotong dan query gagal tetap menolak (gagal-tertutup)", async () => {
  await expect(completeReportQueryParalel(() => ({ order: () => ({ range: async () => ({ data: [{ id: "1" }], error: null, count: 1001 }) }) }))).rejects.toThrow(/terpotong/);
  await expect(completeReportQueryParalel(() => ({ order: () => ({ range: async () => ({ data: null, error: { message: "denied", code: "42501" }, count: null }) }) }))).rejects.toMatchObject({ message: expect.stringContaining("denied"), code: "42501" });
});
