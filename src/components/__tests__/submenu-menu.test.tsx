import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AturanTersimpan } from "@/lib/akses";
import { ROLE_V2_MARKER } from "@/lib/akses";
import { submenuLanding } from "@/lib/submenu-access";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("next/link", () => ({ default: ({ prefetch, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => <a {...props} data-prefetch={String(prefetch)}>{children}</a> }));
vi.mock("@/app/login/actions", () => ({ logout: vi.fn() }));

import { Sidebar } from "../Sidebar";
import { TileGrid } from "../ModuleHome";
import { RoleMenuProvider } from "../RoleMenuContext";

const ALL = ["dashboard", "klinik", "crm", "hris", "pengaturan", "perusahaan", "buku-besar", "kas-bank", "penjualan", "pembelian", "pos", "aset-tetap", "pajak", "laporan", "kasir", "quest-staff", "pos-shift"];
const admin = (subs: Record<string, string[]>): AturanTersimpan => [
  { role: "ADMIN", module_id: ROLE_V2_MARKER },
  ...ALL.map(m => (m in subs ? { role: "ADMIN", module_id: m, submenus: subs[m] } : { role: "ADMIN", module_id: m })),
];
const tiles = (moduleId: string, rules: AturanTersimpan, role = "ADMIN") =>
  renderToStaticMarkup(<RoleMenuProvider role={role} rules={rules}><TileGrid moduleId={moduleId} /></RoleMenuProvider>);
const sidebar = (rules: AturanTersimpan, role = "ADMIN") => renderToStaticMarkup(<Sidebar branches={[]} fullName="Admin Kamo" role={role} aksesModul={rules} />);

describe("home tiles show only the allowed sub-menus", () => {
  const rules = admin({ klinik: ["klinik.registrasi", "klinik.antrian"] });
  it("restricted ADMIN sees only the chosen klinik tiles (and no 'dalam pengembangan' placeholders)", () => {
    const html = tiles("klinik", rules);
    expect(html).toContain('href="/klinik/registrasi"'); expect(html).toContain('href="/klinik/antrian"');
    for (const gone of ["/klinik/rekam-medis", "/klinik/rawat-inap", "/klinik/racik", "/klinik/booking"]) expect(html).not.toContain(`href="${gone}"`);
    expect((html.match(/class="tile"/g) ?? []).length).toBe(2);
  });
  it("a module without a policy shows every tile as today, placeholders included", () => {
    const html = tiles("crm", rules);
    expect(html).toContain('href="/crm/promo"'); expect(html).toContain("Retention (WA)");
  });
  it("tile in another module's pages follows that module's sub-menu: pos 'Penerimaan Barang Klinik' needs klinik.penerimaan", () => {
    expect(tiles("pos", admin({ klinik: ["klinik.antrian"] }))).not.toContain('href="/klinik/penerimaan"');
    expect(tiles("pos", admin({ klinik: ["klinik.penerimaan"] }))).toContain('href="/klinik/penerimaan"');
  });
  it("STAFF with whole klinik and no policy sees every klinik tile", () => {
    const staff: AturanTersimpan = [{ role: "STAFF", module_id: ROLE_V2_MARKER }, { role: "STAFF", module_id: "klinik" }];
    expect(tiles("klinik", [...rules, ...staff], "STAFF")).toContain('href="/klinik/rawat-inap"');
  });
});

describe("sidebar", () => {
  it("lists a restricted module while one sub-menu is allowed, and lands on an allowed page", () => {
    const html = sidebar(admin({ pembelian: ["pembelian.faktur"], klinik: ["klinik.antrian"] }));
    expect(html).toContain('title="Klinik"'); expect(html).toContain('title="Persediaan"');
    expect(html).toMatch(/href="\/pembelian\/faktur"[^>]*title="Pembelian"/);
    expect(html).toMatch(/href="\/klinik"[^>]*title="Klinik"/);
  });
  it("a module with every sub-menu unchecked disappears", () => {
    const html = sidebar(admin({ klinik: [] }));
    expect(html).not.toContain('title="Klinik"');
    expect(html).toContain('title="CRM"');
  });
  it("OWNER and no-policy ADMIN keep the whole sidebar", () => {
    for (const html of [sidebar([], "OWNER"), sidebar(admin({}))]) expect(html).toContain('title="Klinik"');
  });
});

describe("submenuLanding", () => {
  it("is null without a policy", () => { expect(submenuLanding("klinik", undefined)).toBeNull(); });
  it("module home when the module has a home", () => { expect(submenuLanding("klinik", ["klinik.antrian"])).toBe("/klinik"); });
  it("root entry when allowed, else the first allowed page", () => {
    expect(submenuLanding("pembelian", ["pembelian.pesanan"])).toBe("/pembelian");
    expect(submenuLanding("pembelian", ["pembelian.retur", "pembelian.faktur"])).toBe("/pembelian/faktur");
  });
  it("null when nothing known is allowed", () => { expect(submenuLanding("pembelian", [])).toBeNull(); });
});
