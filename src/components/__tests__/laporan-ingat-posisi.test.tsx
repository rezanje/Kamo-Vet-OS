// @vitest-environment jsdom
// Permintaan Reza 19 Nov 2026: buka laporan → pindah ke Penjualan/Pembelian → kembali ke laporan
// harus mendarat di laporan yang sama (filter + sudah ditampilkan), bukan laporan kosong.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => <a {...props} data-prefetch={String(prefetch)} />,
}));

import { IngatPosisiHalaman } from "../IngatPosisiHalaman";
import { PageTabs } from "../PageTabs";
import { ReportCatalog } from "../ReportCatalog";

let root: Root;
let host: HTMLDivElement;
const FILTER = "cabang=KMO&dari=2026-11-01&sampai=2026-11-19&tampil=1&halaman=2";

function App() {
  return <><IngatPosisiHalaman /><PageTabs /><ReportCatalog entries={[{
    key: "/laporan/penjualan-rinci", label: "Penjualan Rinci", href: "/laporan/penjualan-rinci", icon: "ti-report", bg: "#fff", fg: "#000",
    groups: ["Penjualan & operasional"], coverage: [], notes: [], gaps: [], status: "available",
  }] as never} /></>;
}
async function buka(pathname: string, search = "") {
  nav.pathname = pathname; nav.search = search;
  await act(async () => root.render(<App />));
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
}
const hrefs = (selector: string) => [...host.querySelectorAll<HTMLAnchorElement>(selector)].map((a) => a.getAttribute("href"));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("tab dan kotak Daftar Laporan membuka laporan terakhir lengkap dengan filter, bukan laporan kosong", async () => {
  await buka("/laporan/penjualan-rinci");
  await buka("/laporan/penjualan-rinci", FILTER);
  await buka("/penjualan");
  expect(hrefs(".ptab-l")).toContain(`/laporan/penjualan-rinci?${FILTER}`);
  await buka("/laporan");
  expect(hrefs("a.tile")).toEqual([`/laporan/penjualan-rinci?${FILTER}`]);
});

it("laporan yang belum pernah ditampilkan tetap dibuka polos", async () => {
  await buka("/laporan/penjualan-rinci");
  await buka("/pembelian");
  expect(hrefs(".ptab-l")).toContain("/laporan/penjualan-rinci");
  await buka("/laporan");
  expect(hrefs("a.tile")).toEqual(["/laporan/penjualan-rinci"]);
});
