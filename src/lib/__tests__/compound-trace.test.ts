import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hrefAsalBahan, parseCompoundTrace, readCompoundTrace } from "@/lib/compound-trace";

const valid = {
  recipe_id: "recipe", visit_id: "visit",
  materials: [{ item_id: "m", item_name: "Material", unit: "gram", warehouse_name: "Vet", qty: 2, restored: false,
    origin: { source: "produksi", ref: null, tanggal: "2026-10-27", production_order_id: "job", no_produksi: "PRD.2026.10.00001" }, invoice: null }],
  moves: [{ tanggal: "2026-10-28", item_id: "m", item_name: "Material", unit: "gram", warehouse_name: "Vet", qty: -2 }],
};

it("reads only the read-only trace RPC for the requested racikan", async () => {
  const calls: unknown[] = [];
  const db = { rpc: async (...args: unknown[]) => { calls.push(args); return { data: valid, error: null }; } } as unknown as SupabaseClient;
  expect((await readCompoundTrace(db, "recipe")).materials[0].origin.no_produksi).toBe("PRD.2026.10.00001");
  expect(calls).toEqual([["read_compound_trace", { p_recipe_id: "recipe" }]]);
});

it("fails closed on denial, another racikan or malformed rows", async () => {
  const denied = { rpc: async () => ({ data: null, error: { message: "denied" } }) } as unknown as SupabaseClient;
  await expect(readCompoundTrace(denied, "recipe")).rejects.toThrow("belum dapat diperiksa");
  expect(() => parseCompoundTrace({ ...valid, recipe_id: "other" }, "recipe")).toThrow("tidak valid");
  expect(() => parseCompoundTrace({ ...valid, moves: [{ ...valid.moves[0], qty: "2" }] }, "recipe")).toThrow("tidak valid");
});

it("links production jobs and recognised document numbers only", () => {
  expect(hrefAsalBahan(valid.materials[0].origin)?.href).toBe("/pos/produksi?nomor=PRD.2026.10.00001#selected-production");
  expect(hrefAsalBahan({ ...valid.materials[0].origin, source: "produksi", no_produksi: null })).toBeNull();
  expect(hrefAsalBahan({ source: "faktur-langsung", ref: "FB.2026.10.00003", tanggal: null, production_order_id: null, no_produksi: null })?.href).toBe("/dokumen/FB.2026.10.00003");
  expect(hrefAsalBahan({ source: "fixture", ref: "free text", tanggal: null, production_order_id: null, no_produksi: null })).toBeNull();
});
