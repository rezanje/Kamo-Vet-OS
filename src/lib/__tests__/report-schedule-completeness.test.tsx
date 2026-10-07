import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";
const fixture = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fixture.client }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
vi.mock("@/lib/tanggal", async importOriginal => ({ ...await importOriginal<typeof import("../tanggal")>(), hariIniWIB: () => "2026-10-07" }));
import JadwalAnabulPage from "../../app/(app)/laporan/jadwal-anabul/page";

it("applies the selected schedule kind before reading every report page", async () => {
  const row = (id: string, jenis = "vaksin") => ({ id, jenis, status: "Menunggu", tanggal: "2026-10-08", catatan: null, pets: { name: `Anabul ${id}`, species: "Kucing" }, customers: { name: "Pemilik", phone: null }, branches: { name: "Klinik A" } });
  const { client, records } = clientFixture({ tables: { follow_ups: [
    ...Array.from({ length: 1201 }, (_, index) => row(String(index))), row("grooming-only", "grooming"),
  ] } });
  fixture.client = client;
  const html = renderToStaticMarkup(await JadwalAnabulPage({ searchParams: Promise.resolve({ jenis: "vaksin", horizon: "30" }) }));
  expect(html).toContain("Anabul 1200");
  expect(html).not.toContain("Anabul grooming-only");
  expect(records.some(record => record.table === "follow_ups" && record.method === "eq" && record.args[0] === "jenis" && record.args[1] === "vaksin")).toBe(true);
  expect(records.filter(record => record.table === "follow_ups" && record.method === "range")).toHaveLength(3);
});
