// @vitest-environment jsdom
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
let sp = "";
let pn = "/pos/sku";
vi.mock("next/navigation", () => ({ usePathname: () => pn, useSearchParams: () => new URLSearchParams(sp) }));

import { BackLink } from "@/components/BackLink";
import { JejakDaftar } from "@/components/JejakDaftar";
import { LIST_URL_KEY, PENDING_SCROLL_KEY, rememberListUrl, rememberScroll } from "@/lib/back-state";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/pos/sku/abc");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

// jsdom belum mengimplementasikan navigasi: batalkan default klik, yang diuji adalah penanganannya.
const klik = (a: HTMLAnchorElement) => { a.addEventListener("click", (e) => e.preventDefault(), { once: true }); a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); };
const detail = () => <BackLink href="/pos/sku" className="back-btn"><i className="ti ti-arrow-left" /> Barang &amp; Jasa</BackLink>;

describe("BackLink", () => {
  it("SSR: selalu tautan <a> biasa ke href cadangan (tanpa kedip), walau tab punya catatan", () => {
    rememberListUrl(window.sessionStorage, "/pos/sku", "view=all&cari=pentacat");
    const html = renderToStaticMarkup(detail());
    const host = document.createElement("div");
    host.innerHTML = html;
    const a = host.querySelector("a")!;
    expect(host.children).toHaveLength(1);
    expect(a.getAttribute("href")).toBe("/pos/sku");
    expect(a.className).toBe("back-btn");
    expect(a.textContent).toBe(" Barang & Jasa");
  });

  it("tanpa catatan: tetap ke href cadangan", async () => {
    await act(async () => root.render(detail()));
    expect(container.querySelector("a")!.getAttribute("href")).toBe("/pos/sku");
  });

  it("dengan catatan daftar: tautan membawa pencarian/filter yang terakhir dilihat", async () => {
    rememberListUrl(window.sessionStorage, "/pos/sku", "view=all&cari=pentacat&jenis=&induk=");
    await act(async () => root.render(detail()));
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("/pos/sku?view=all&cari=pentacat&jenis=&induk=");
    expect(a.className).toBe("back-btn");
  });

  it("klik menandai tujuan supaya gulir dipulihkan, dan tetap memanggil onClick milik pemanggil", async () => {
    rememberListUrl(window.sessionStorage, "/pos/sku", "cari=a&hal=2");
    const onClick = vi.fn();
    await act(async () => root.render(<BackLink href="/pos/sku" onClick={onClick}>Kembali</BackLink>));
    await act(async () => { klik(container.querySelector("a")!); });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.sessionStorage.getItem(PENDING_SCROLL_KEY)!).u).toBe("/pos/sku?cari=a&hal=2");
  });

  it("tanpa catatan klik tidak menulis tanda apa pun", async () => {
    await act(async () => root.render(detail()));
    await act(async () => { klik(container.querySelector("a")!); });
    expect(window.sessionStorage.getItem(PENDING_SCROLL_KEY)).toBeNull();
  });

  it("tidak mengubah tautan ke halaman yang sedang dibuka", async () => {
    window.history.replaceState(null, "", "/crm/promo");
    rememberListUrl(window.sessionStorage, "/crm/promo", "status=aktif");
    await act(async () => root.render(<BackLink href="/crm/promo">Kembali</BackLink>));
    expect(container.querySelector("a")!.getAttribute("href")).toBe("/crm/promo");
  });
});

describe("menu samping dan tab TIDAK memulihkan filter (hanya BackLink)", () => {
  const src = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
  it("Sidebar, PageTabs, ReportCatalog dan IngatPosisiHalaman tidak memakai back-state/BackLink", () => {
    for (const f of ["src/components/Sidebar.tsx", "src/components/PageTabs.tsx", "src/components/ReportCatalog.tsx", "src/components/IngatPosisiHalaman.tsx", "src/components/Breadcrumb.tsx"]) {
      const text = src(f);
      expect(text, f).not.toMatch(/back-state|BackLink|JejakDaftar/);
    }
  });
  it("tautan polos tidak berubah walau catatan ada: catatan hanya dibaca resolveBackHref", () => {
    rememberListUrl(window.sessionStorage, "/pos/sku", "cari=a");
    const html = renderToStaticMarkup(<a href="/pos/sku">Barang &amp; Jasa</a>);
    expect(html).toBe('<a href="/pos/sku">Barang &amp; Jasa</a>');
  });
});

describe("JejakDaftar", () => {
  async function pasang(path: string, search: string) {
    pn = path; sp = search;
    await act(async () => root.render(<JejakDaftar />));
  }

  it("mencatat alamat lengkap daftar (tanpa parameter sekali pakai)", async () => {
    await pasang("/pos/sku", "view=all&cari=pentacat&success=1");
    const map = JSON.parse(window.sessionStorage.getItem(LIST_URL_KEY)!);
    expect(map["/pos/sku"].u).toBe("/pos/sku?view=all&cari=pentacat");
  });

  it("memperbarui catatan saat filter berubah dan kunjungan polos mengosongkannya", async () => {
    await pasang("/pos/sku", "cari=a");
    await pasang("/pos/sku", "cari=b&hal=2");
    expect(JSON.parse(window.sessionStorage.getItem(LIST_URL_KEY)!)["/pos/sku"].u).toBe("/pos/sku?cari=b&hal=2");
    await pasang("/pos/sku", "");
    expect(JSON.parse(window.sessionStorage.getItem(LIST_URL_KEY)!)["/pos/sku"].u).toBe("/pos/sku");
  });

  it("memulihkan gulir saat Kembali browser (popstate) ke alamat yang punya posisi tersimpan", async () => {
    const ct = document.createElement("div");
    ct.className = "ct";
    Object.defineProperty(ct, "scrollHeight", { value: 3000, configurable: true });
    Object.defineProperty(ct, "clientHeight", { value: 600, configurable: true });
    document.body.append(ct);
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { setTimeout(() => cb(0), 0); return 0; });
    try {
      rememberScroll(window.sessionStorage, "/pos/sku?cari=a", 750);
      await pasang("/pos/sku/abc", "");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await pasang("/pos/sku", "cari=a");
      await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
      expect(ct.scrollTop).toBe(750);
    } finally { raf.mockRestore(); ct.remove(); }
  });

  it("memulihkan gulir juga setelah klik BackLink (tanda sekali pakai)", async () => {
    const ct = document.createElement("div");
    ct.className = "ct";
    Object.defineProperty(ct, "scrollHeight", { value: 3000, configurable: true });
    Object.defineProperty(ct, "clientHeight", { value: 600, configurable: true });
    document.body.append(ct);
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { setTimeout(() => cb(0), 0); return 0; });
    try {
      rememberScroll(window.sessionStorage, "/pos/sku?cari=a", 420);
      window.sessionStorage.setItem(PENDING_SCROLL_KEY, JSON.stringify({ u: "/pos/sku?cari=a", t: Date.now() }));
      await pasang("/pos/sku", "cari=a");
      await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
      expect(ct.scrollTop).toBe(420);
      expect(window.sessionStorage.getItem(PENDING_SCROLL_KEY)).toBeNull();
    } finally { raf.mockRestore(); ct.remove(); }
  });

  it("navigasi biasa (klik menu / buka daftar baru) TIDAK memulihkan gulir", async () => {
    const ct = document.createElement("div");
    ct.className = "ct";
    Object.defineProperty(ct, "scrollHeight", { value: 3000, configurable: true });
    Object.defineProperty(ct, "clientHeight", { value: 600, configurable: true });
    document.body.append(ct);
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { setTimeout(() => cb(0), 0); return 0; });
    try {
      rememberScroll(window.sessionStorage, "/pos/sku?cari=a", 750);
      await pasang("/pos/sku/abc", "");
      await pasang("/pos/sku", "cari=a");
      await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
      expect(ct.scrollTop).toBe(0);
    } finally { raf.mockRestore(); ct.remove(); }
  });

  it("menyimpan posisi gulir area isi saat digulir (dan sebelum klik pindah halaman)", async () => {
    const ct = document.createElement("div");
    ct.className = "ct";
    document.body.append(ct);
    try {
      window.history.replaceState(null, "", "/pos/sku?cari=a");
      await pasang("/pos/sku", "cari=a");
      ct.scrollTop = 333;
      ct.dispatchEvent(new Event("scroll"));
      document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(JSON.parse(window.sessionStorage.getItem("vetos:list-scroll")!)["/pos/sku?cari=a"].y).toBe(333);
    } finally { ct.remove(); }
  });
});
