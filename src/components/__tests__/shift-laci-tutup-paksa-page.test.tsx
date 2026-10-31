// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Layar Shift Kasir backoffice: laci nyangkut milik orang lain hanya punya jalan
// "Tutup Paksa" ber-alasan untuk Owner/Admin; laci sendiri tidak ditutup paksa; peran
// lain tidak melihat tombolnya. Ini hanya kenyamanan tampilan — batas keamanannya di
// basis data (scripts/test-shift-laci-milik-kasir-postgres.py).
const fx = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("@/components/LocalTransactionDraft", () => ({ TransactionForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form> }));
vi.mock("@/app/(app)/pos/shift/actions", () => ({ openShift: async () => {}, closeShift: async () => {}, forceCloseShift: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "admin-a" } } }) },
  from(table: string) {
    const filters: Record<string, unknown> = {};
    const rows = () => table === "cashier_shifts" && filters.status === "open" ? [
      { id: "laci-orang", shift_type: "klinik", opening_balance: 100000, opened_at: "2026-10-01T01:00:00Z", opened_by: "kasir-b", branches: { name: "Klinik A" }, profiles: { full_name: "Kasir B" } },
      { id: "laci-sendiri", shift_type: "petshop", opening_balance: 50000, opened_at: "2026-10-01T02:00:00Z", opened_by: "admin-a", branches: { name: "Klinik A" }, profiles: { full_name: "Admin A" } },
    ] : [];
    const q = {
      select: () => q, eq: (k: string, v: unknown) => { filters[k] = v; return q; }, lt: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: table === "profiles" ? { role: fx.role } : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
    };
    return q;
  },
}) }));

import ShiftPage from "@/app/(app)/pos/shift/page";

const render = async () => new DOMParser().parseFromString(
  renderToStaticMarkup(await ShiftPage({ searchParams: Promise.resolve({}) })), "text/html");
const baris = (page: Document, kasir: string) =>
  [...page.querySelectorAll("tbody tr")].find(tr => tr.textContent?.includes(kasir))!;

beforeEach(() => { fx.role = "ADMIN"; });

it.each(["ADMIN", "OWNER"])("%s melihat tutup paksa ber-alasan wajib untuk laci kasir lain", async (role) => {
  fx.role = role;
  const row = baris(await render(), "Kasir B");
  const form = row.querySelector("form");
  expect(form?.querySelector("input[name=shiftId]")?.getAttribute("value")).toBe("laci-orang");
  const alasan = form?.querySelector("input[name=alasan]");
  expect(alasan?.hasAttribute("required")).toBe(true);
  expect(alasan?.getAttribute("minlength")).toBe("10");
  expect(row.textContent).toContain("Tutup Paksa");
});

it("laci sendiri tidak punya tombol tutup paksa", async () => {
  const row = baris(await render(), "Admin A");
  expect(row.querySelector("form")).toBeNull();
  expect(row.textContent).toContain("tutup lewat Selesai Shift");
});

it.each(["FINANCE", "STAFF", "DOCTOR"])("%s tidak melihat tombol menutup laci orang lain", async (role) => {
  fx.role = role;
  const page = await render();
  expect(baris(page, "Kasir B").querySelector("form")).toBeNull();
  expect(page.querySelector("input[name=alasan]")).toBeNull();
});
