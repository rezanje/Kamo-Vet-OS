// A1 (meeting 12 Nov 2026): laporan di Daftar Laporan dibuka kosong. Query berat baru
// jalan setelah Tampilkan (tampil=1); isian filter ringan (cabang) tetap dibaca.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { clientFixture } from "./fixtures/hpp-report-client";

const fixture = vi.hoisted(() => ({ client: null as SupabaseClient | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fixture.client }));
vi.mock("next/link", () => ({ default: ({ children, href }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
import AbsensiPage from "../../app/(app)/laporan/absensi/page";
import AkuisisiPage from "../../app/(app)/laporan/akuisisi/page";
import AnamnesaPage from "../../app/(app)/laporan/anamnesa/page";
import GajiPage from "../../app/(app)/laporan/gaji/page";
import KpiPage from "../../app/(app)/laporan/kpi/page";
import MemberPage from "../../app/(app)/laporan/member/page";
import PelangganTeratasPage from "../../app/(app)/laporan/pelanggan-teratas/page";
import PembelianPage from "../../app/(app)/laporan/pembelian/page";
import RetensiPage from "../../app/(app)/laporan/retensi/page";

type Halaman = (props: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>;
const render = async (Page: unknown, sp: Record<string, string>) =>
  renderToStaticMarkup(await (Page as Halaman)({ searchParams: Promise.resolve(sp) }));

describe("tanpa tampil=1: kosong, tanpa query berat", () => {
  it.each([
    ["absensi", AbsensiPage, ["attendance", "employees"]],
    ["akuisisi", AkuisisiPage, ["sales", "invoices", "sales_invoices"]],
    ["anamnesa", AnamnesaPage, ["medical_records"]],
    ["gaji", GajiPage, ["payrolls"]],
    ["kpi", KpiPage, ["kpi_records"]],
    ["member", MemberPage, ["customers", "point_ledger"]],
    ["pelanggan-teratas", PelangganTeratasPage, ["sales", "invoices", "sales_invoices", "customers"]],
    ["pembelian", PembelianPage, ["purchase_invoices", "purchase_returns"]],
    ["retensi", RetensiPage, ["sales", "invoices", "sales_invoices", "customers"]],
  ] as const)("%s", async (_nama, Page, berat) => {
    const { client, records } = clientFixture();
    fixture.client = client;
    const html = await render(Page, { cabang: "b1" });
    expect(html).toContain("Laporan belum ditampilkan");
    expect(html).toContain('name="tampil"');
    expect(records.filter(row => (berat as readonly string[]).includes(row.table))).toEqual([]);
  });
});

describe("dengan tampil=1 + cabang: saringan cabang ikut ke query", () => {
  const emp = (nama: string, cabang: string) => ({ nama, jabatan: "Staf", branches: { name: cabang } });

  it("gaji", async () => {
    const { client, records } = clientFixture({ tables: { payrolls: [
      { id: "p1", periode: "2026-10", gaji_pokok: 100, tunjangan: 0, potongan: 0, total: 100, employees: emp("Ani", "Satu") },
      { id: "p2", periode: "2026-10", gaji_pokok: 200, tunjangan: 0, potongan: 0, total: 200, employees: emp("Budi", "Dua") },
    ] } });
    fixture.client = client;
    const html = await render(GajiPage, { periode: "2026-10", cabang: "Satu", tampil: "1" });
    expect(html).toContain("Ani");
    expect(html).not.toContain("Budi");
    expect(records.some(r => r.table === "payrolls" && r.method === "select" && String(r.args[0]).includes("employees!inner"))).toBe(true);
    expect(records.some(r => r.table === "payrolls" && r.method === "eq" && r.args[0] === "employees.branches.name" && r.args[1] === "Satu")).toBe(true);
  });

  it("kpi", async () => {
    const { client, records } = clientFixture({ tables: { kpi_records: [
      { id: "k1", periode: "2026-10", employee_id: "e1", metrik: "Omzet", target: 1, realisasi: 1, skor: 90, catatan: null, employees: emp("Ani", "Satu") },
      { id: "k2", periode: "2026-10", employee_id: "e2", metrik: "Omzet", target: 1, realisasi: 1, skor: 50, catatan: null, employees: emp("Budi", "Dua") },
    ] } });
    fixture.client = client;
    const html = await render(KpiPage, { periode: "2026-10", cabang: "Satu", tampil: "1" });
    expect(html).toContain("Ani");
    expect(html).not.toContain("Budi");
    expect(records.some(r => r.table === "kpi_records" && r.method === "eq" && r.args[0] === "employees.branches.name" && r.args[1] === "Satu")).toBe(true);
  });

  it("absensi", async () => {
    const { client, records } = clientFixture({ tables: {
      employees: [
        { id: "e1", nama: "Ani", jabatan: null, status: "Aktif", branches: { name: "Satu" } },
        { id: "e2", nama: "Budi", jabatan: null, status: "Aktif", branches: { name: "Dua" } },
      ],
      attendance: [{ id: "a1", employee_id: "e1", status: "Hadir", tanggal: "2026-10-02", jam_masuk: null, jam_pulang: null, employees: { branches: { name: "Satu" } } }],
    } });
    fixture.client = client;
    const html = await render(AbsensiPage, { periode: "2026-10", cabang: "Satu", tampil: "1" });
    expect(html).toContain("Ani");
    expect(html).not.toContain("Budi");
    expect(records.some(r => r.table === "attendance" && r.method === "eq" && r.args[0] === "employees.branches.name")).toBe(true);
    expect(records.some(r => r.table === "employees" && r.method === "eq" && r.args[0] === "branches.name")).toBe(true);
  });

  it("anamnesa", async () => {
    const { client, records } = clientFixture({ tables: { medical_records: [
      { id: "m1", diagnosis: "Scabies", anamnesis: null, gejala_klinis: null, follow_up: null, created_at: "2026-10-02T03:00:00Z", visits: { branch_id: "b1", dokter: "Dr A", branches: { name: "Satu" }, pets: null, customers: null } },
      { id: "m2", diagnosis: "Flu kucing", anamnesis: null, gejala_klinis: null, follow_up: null, created_at: "2026-10-02T03:00:00Z", visits: { branch_id: "b2", dokter: "Dr B", branches: { name: "Dua" }, pets: null, customers: null } },
    ] } });
    fixture.client = client;
    const html = await render(AnamnesaPage, { dari: "2026-10-01", sampai: "2026-10-31", cabang: "b1", tampil: "1" });
    expect(html).toContain("Scabies");
    expect(html).not.toContain("Flu kucing");
    expect(records.some(r => r.table === "medical_records" && r.method === "eq" && r.args[0] === "visits.branch_id" && r.args[1] === "b1")).toBe(true);
  });

  it("pembelian", async () => {
    const { client, records } = clientFixture({ tables: { purchase_invoices: [
      { id: "f1", no_faktur: "F1", tanggal: "2026-10-02", total: 100, branch_id: "b1", supplier_id: "s1", suppliers: { nama: "Pemasok Satu" }, voided_at: null, opening_batch_id: null, purchase_invoice_payments: [], purchase_invoice_items: [] },
      { id: "f2", no_faktur: "F2", tanggal: "2026-10-02", total: 100, branch_id: "b2", supplier_id: "s2", suppliers: { nama: "Pemasok Dua" }, voided_at: null, opening_batch_id: null, purchase_invoice_payments: [], purchase_invoice_items: [] },
    ] } });
    fixture.client = client;
    const html = await render(PembelianPage, { dari: "2026-10-01", sampai: "2026-10-31", cabang: "b1", tampil: "1" });
    expect(html).toContain("Pemasok Satu");
    expect(html).not.toContain("Pemasok Dua");
    expect(records.some(r => r.table === "purchase_invoices" && r.method === "eq" && r.args[0] === "branch_id" && r.args[1] === "b1")).toBe(true);
  });
});
