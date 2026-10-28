import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Saat baris pengaturan satu baris belum pernah disimpan, layar memberi tahu itu dan
// kolom angkanya kosong + wajib diisi: tidak ada angka bawaan yang ikut tersimpan.
const state = vi.hoisted(() => ({ rows: {} as Record<string, unknown> }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/app/(app)/pengaturan/gaji/actions", () => ({ simpanAturanGaji: async () => {} }));
vi.mock("@/app/(app)/pengaturan/pajak/actions", () => ({ simpanPajak: async () => {} }));
vi.mock("@/app/(app)/pengaturan/tier/actions", () => ({ updateTierSettings: async () => {}, tutupPoinTahunan: async () => {}, jalankanPerawatanLoyaltyAction: async () => {} }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: ({ children }: { children: React.ReactNode }) => <button type="submit">{children}</button> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "a0000000-0000-4000-8000-000000000001" } }, error: null }) },
  from: (table: string) => {
    const result = () => table === "profiles" ? { data: { role: "OWNER", is_active: true }, error: null } : { data: state.rows[table] ?? null, error: null };
    const query = {
      select: () => query, eq: () => query, gt: () => query,
      maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return query;
  },
}) }));
import GajiPage from "@/app/(app)/pengaturan/gaji/page";
import PajakPage from "@/app/(app)/pengaturan/pajak/page";
import TierPage from "@/app/(app)/pengaturan/tier/page";

const sp = Promise.resolve({});
const field = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
beforeEach(() => { state.rows = {}; });

it("payroll settings: never-saved banner, empty required fields, no worked examples from defaults", async () => {
  const html = renderToStaticMarkup(await GajiPage({ searchParams: sp }));
  expect(html).toContain("Aturan gaji belum pernah disimpan");
  for (const name of ["telat_mulai_menit", "telat_blok_menit", "telat_nominal_per_blok", "telat_maks", "bolos_per_hari", "lembur_per_jam"]) {
    expect(field(html, name)).toMatch(/value=""/);
    expect(field(html, name)).toContain("required");
  }
  expect(html).not.toContain("Contoh dengan aturan tersimpan");
});

it("payroll settings: saved values are prefilled and the banner is gone", async () => {
  state.rows.payroll_settings = { telat_mulai_menit: 2, telat_blok_menit: 10, telat_nominal_per_blok: 5000, telat_maks: 0, bolos_per_hari: 0, lembur_per_jam: 0 };
  const html = renderToStaticMarkup(await GajiPage({ searchParams: sp }));
  expect(html).not.toContain("belum pernah disimpan");
  expect(field(html, "telat_blok_menit")).toMatch(/value="10"/);
  expect(field(html, "lembur_per_jam")).toMatch(/value="0"/);
});

it("tax settings: never-saved banner and an empty required PPN rate instead of 11", async () => {
  const html = renderToStaticMarkup(await PajakPage({ searchParams: sp }));
  expect(html).toContain("Pengaturan pajak belum pernah disimpan");
  expect(field(html, "ppn_rate")).toMatch(/value=""/);
  expect(field(html, "ppn_rate")).toContain("required");
});

it("loyalty settings: never-saved banner and empty required thresholds instead of hardcoded ones", async () => {
  const html = renderToStaticMarkup(await TierPage({ searchParams: sp }));
  expect(html).toContain("Aturan loyalty belum pernah disimpan");
  for (const name of ["bronze_min", "silver_min", "gold_min", "platinum_min", "points_expiry_months", "tier_downgrade_days"]) {
    expect(field(html, name)).toMatch(/value=""/);
    expect(field(html, name)).toContain("required");
  }
});
