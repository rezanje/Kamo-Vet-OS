// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("./actions", () => ({ saveRoleSettings: vi.fn() }));
import { NewRoleSettingsForm } from "./newRoleSettingsForm";
import type { RoleAccessConfig } from "@/lib/role-access-catalog";
import { selectableSubmenus, SUBMENU_ENTRIES } from "@/lib/submenu-access";

let root: Root, host: HTMLDivElement;
const ALL = ["dashboard", "klinik", "crm", "hris", "pengaturan", "perusahaan", "buku-besar", "kas-bank", "penjualan", "pembelian", "pos", "aset-tetap", "pajak", "laporan", "kasir", "quest-staff", "pos-shift"];
// ADMIN's default: every module, no saved sub-menu policy.
const admin: RoleAccessConfig = { role: "ADMIN", revision: "a".repeat(32), source: "defaults", modules: ALL, capabilities: { all_branches: true, create_accounts: true }, audit: [], actions: { source: "legacy", allowed: [] }, action_catalog: [] };
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = (config: RoleAccessConfig, canEdit = true) => act(async () => root.render(<NewRoleSettingsForm userId="owner-a" config={config} canEdit={canEdit} />));
const subs = (m: string) => [...host.querySelectorAll<HTMLInputElement>(`input[name^="sub_${m}."]`)];
const section = (m: string) => host.querySelector(`[data-submenu-module="${m}"]`)!;
const summary = (m: string) => section(m).querySelector("summary")!.textContent!;
const modulesWithSubmenus = [...new Set(SUBMENU_ENTRIES.map(e => e.module))];

it("ADMIN default: every module with sub-menus has an expandable all-checked list and a clear summary", async () => {
  await render(admin);
  for (const m of modulesWithSubmenus) {
    const total = selectableSubmenus(m).length;
    expect(section(m).tagName).toBe("DETAILS");
    expect(subs(m)).toHaveLength(total);
    expect(subs(m).every(i => i.checked), m).toBe(true);
    expect(summary(m)).toContain(`${total} dari ${total} sub-menu`);
    expect(host.querySelector<HTMLInputElement>(`input[name="subs_${m}"]`)!.value).toBe("1");
  }
  expect(summary("klinik")).toMatch(/^Klinik: \d+ dari \d+ sub-menu/);
  // the module checkboxes are untouched
  expect(host.querySelectorAll('input[name^="mod_"]')).toHaveLength(17);
});

it("uses plain tile labels for the checkboxes and shows which other tiles they also cover", async () => {
  await render(admin);
  expect(section("klinik").textContent).toContain("Registrasi pasien");
  expect(section("klinik").textContent).toContain("Pembayaran kasir klinik");
  expect(section("penjualan").textContent).toContain("Faktur penjualan dan penerimaan");
  expect(section("pos").textContent).toContain("Stok opname");
});

it("a saved policy checks only its sub-menus and summarises 'n dari m'", async () => {
  await render({ ...admin, submenus: { klinik: ["klinik.registrasi", "klinik.antrian", "klinik.pembayaran"] } });
  expect(subs("klinik").filter(i => i.checked).map(i => i.name)).toEqual(["sub_klinik.registrasi", "sub_klinik.antrian", "sub_klinik.pembayaran"]);
  expect(summary("klinik")).toContain(`3 dari ${selectableSubmenus("klinik").length} sub-menu`);
  expect(subs("pos").every(i => i.checked)).toBe(true);
});

it("'Kosongkan' unchecks all and warns; 'Pilih semua' restores; the summary follows", async () => {
  await render(admin);
  const buttons = [...section("klinik").querySelectorAll("button")];
  const empty = buttons.find(b => b.textContent === "Kosongkan")!, all = buttons.find(b => b.textContent === "Pilih semua")!;
  expect(empty.type).toBe("button"); expect(all.type).toBe("button");
  expect(section("klinik").querySelector('[role="alert"]')).toBeNull();
  await act(async () => empty.click());
  expect(subs("klinik").some(i => i.checked)).toBe(false);
  expect(summary("klinik")).toContain(`0 dari ${selectableSubmenus("klinik").length} sub-menu`);
  expect(section("klinik").querySelector('[role="alert"]')!.textContent).toContain("tidak bisa dibuka");
  await act(async () => all.click());
  expect(subs("klinik").every(i => i.checked)).toBe(true);
  expect(section("klinik").querySelector('[role="alert"]')).toBeNull();
});

it("toggling a single sub-menu updates the count live; the warning only shows while the module itself is checked", async () => {
  await render({ ...admin, submenus: { klinik: ["klinik.antrian"] } });
  await act(async () => subs("klinik").find(i => i.name === "sub_klinik.antrian")!.click());
  expect(summary("klinik")).toContain("0 dari");
  expect(section("klinik").querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLInputElement>('input[name="mod_klinik"]')!.click());
  expect(section("klinik").querySelector('[role="alert"]')).toBeNull();
  await act(async () => subs("klinik")[0].click());
  expect(summary("klinik")).toContain("1 dari");
});

it("an unchecked module still lists its sub-menus, marked as not allowed", async () => {
  await render({ ...admin, modules: ALL.filter(m => m !== "pos") });
  expect(subs("pos").length).toBeGreaterThan(0);
  expect(section("pos").textContent).toContain("belum dicentang");
});

it("read-only viewers cannot change sub-menus (fieldset disabled)", async () => {
  await render(admin, false);
  expect(host.querySelector("fieldset")!.disabled).toBe(true);
});

it("explains the sub-menu feature in plain Indonesian", async () => {
  await render(admin);
  expect(host.textContent).toContain("sub-menu");
  expect(host.textContent).toContain("Bawaan: semua sub-menu");
});

// ---- Halaman tanpa pemilik: aturan yang sebenarnya ada di bolehBukaPath ----
// Peran yang bawaannya SEMUA modul (ADMIN/DOCTOR) hanya memegang halaman tanpa pemilik modul
// (/dokumen, /keuangan, /pajak/faktur, /aset-tetap, /keuangan/laba-ditahan) selama SEMUA modul tercentang
// dan punya sub-menu terbuka. Satu modul tak dicentang atau dikosongkan => semuanya tertutup.
import { bolehBukaPath, ROLE_V2_MARKER } from "@/lib/akses";
import { OWNERLESS_FULL_REACH_PAGES } from "@/lib/submenu-access";
const ownerless = (m: string) => section(m).querySelector("[data-ownerless-warning]");

it("the listed ownerless pages are exactly the ones bolehBukaPath closes when a module is emptied (rule, not a guess)", () => {
  expect([...OWNERLESS_FULL_REACH_PAGES].sort()).toEqual(["/aset-tetap", "/dokumen", "/keuangan", "/keuangan/laba-ditahan", "/pajak/faktur"]);
  const rules = (sub?: Record<string, string[]>) => [{ role: "ADMIN", module_id: ROLE_V2_MARKER }, ...ALL.map(m => (sub && m in sub ? { role: "ADMIN", module_id: m, submenus: sub[m] } : { role: "ADMIN", module_id: m }))];
  for (const p of OWNERLESS_FULL_REACH_PAGES) {
    expect(bolehBukaPath("ADMIN", p, rules()), `${p} full`).toBe(true);
    expect(bolehBukaPath("ADMIN", p, rules({ klinik: ["klinik.antrian"] })), `${p} partly restricted`).toBe(true);
    expect(bolehBukaPath("ADMIN", p, rules({ klinik: [] })), `${p} emptied`).toBe(false);
    expect(bolehBukaPath("ADMIN", p, rules().filter(r => r.module_id !== "crm")), `${p} unchecked`).toBe(false);
  }
});

it("emptying a module of a full-reach role (ADMIN) also warns, in plain words, about the ownerless pages", async () => {
  await render(admin);
  expect(ownerless("klinik")).toBeNull();
  await act(async () => [...section("klinik").querySelectorAll("button")].find(b => b.textContent === "Kosongkan")!.click());
  const text = ownerless("klinik")!.textContent!;
  for (const p of OWNERLESS_FULL_REACH_PAGES) expect(text, p).toContain(p);
  expect(text).toContain("ikut tertutup");
  expect(text).toMatch(/semua modul/i);
});

it("unchecking a whole module warns the same way; restoring it removes the warning", async () => {
  await render(admin);
  await act(async () => host.querySelector<HTMLInputElement>('input[name="mod_crm"]')!.click());
  expect(ownerless("crm")!.textContent).toContain("/dokumen");
  await act(async () => host.querySelector<HTMLInputElement>('input[name="mod_crm"]')!.click());
  expect(ownerless("crm")).toBeNull();
});

it("a role whose default is NOT every module (STAFF) gets no ownerless-pages claim", async () => {
  await render({ ...admin, role: "STAFF", modules: ["klinik"] });
  await act(async () => [...section("klinik").querySelectorAll("button")].find(b => b.textContent === "Kosongkan")!.click());
  expect(ownerless("klinik")).toBeNull();
});
