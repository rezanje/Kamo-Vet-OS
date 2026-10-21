import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";
const fixture = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fixture.client }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
import ClosingPage from "@/app/(app)/keuangan/closing-hpp/page";

it("shows method activation and disables global changes without every branch", async () => {
  fixture.client = clientFixture({ deniedBranch: "b2" }).client;
  const html = renderToStaticMarkup(await ClosingPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("Aktifkan rata-rata bergerak");
  expect(html).toContain("memerlukan akses seluruh cabang");
  expect(html).toContain('disabled=""');
  expect(html).toContain("Belum ada snapshot");
});

it("surfaces a snapshot read error without rendering mutation forms", async () => {
  fixture.client = clientFixture({ errorTable: "inventory_month_closes" }).client;
  const html = renderToStaticMarkup(await ClosingPage({ searchParams: Promise.resolve({}) }));
  expect(html).toContain("belum bisa dibaca lengkap");
  expect(html).not.toContain("Aktifkan rata-rata bergerak");
});
