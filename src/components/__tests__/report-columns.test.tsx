// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ path: "/laporan/promo", search: "", href: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ replace: (href: string) => { state.href = href; } }),
}));
import { ReportColumns, ReportColumnsFilterInput } from "../ReportColumns";
import { inspectReportTables } from "@/lib/report-columns";
import { displayTable } from "@/lib/report-display-export";

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.path = "/laporan/promo"; state.search = ""; state.href = "";
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const content = <table><thead><tr><th>Barang</th><th>Qty</th><th>Total</th></tr></thead><tbody><tr><td>Obat</td><td>2</td><td>300</td></tr></tbody><tfoot><tr><td colSpan={2}>TOTAL</td><td>300</td></tr></tfoot></table>;
async function render(children = content) {
  await act(async () => root.render(<><form data-report-filters><input name="bulan" defaultValue="2026-10"/><ReportColumnsFilterInput /></form><ReportColumns>{children}</ReportColumns></>));
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(button => button.textContent === text);
  expect(button).toBeDefined(); await act(async () => button!.click());
}

it("applies chosen columns via URL while preserving repeated filters and applied GET choices", async () => {
  state.search = "bulan=2026-10&cabang=a&cabang=b";
  await render();
  const qty = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1];
  expect(qty).toBeDefined();
  await act(async () => qty.click());
  expect(displayTable(host.querySelector("table")!)[0]).toEqual(["Barang", "Qty", "Total"]);
  expect(new FormData(host.querySelector("form")!).get("kolom")).toBeNull();
  await click("Terapkan kolom");
  const applied = new URL(state.href, "https://example.com");
  expect(applied.searchParams.getAll("cabang")).toEqual(["a", "b"]);
  expect(applied.searchParams.get("bulan")).toBe("2026-10");
  expect(applied.searchParams.get("kolom")).toMatch(/\[1\]/);
  state.search = applied.searchParams.toString(); await render();
  expect(displayTable(host.querySelector("table")!)).toEqual([["Barang", "Total"], ["Obat", "300"], ["TOTAL", "300"]]);
  expect(new FormData(host.querySelector("form")!).get("kolom")).toBe(applied.searchParams.get("kolom"));
});

it("keeps at least one column and resets to all columns through the applied URL", async () => {
  await render();
  const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  await act(async () => { boxes[0].click(); });
  await act(async () => { boxes[1].click(); });
  expect(boxes[2].disabled).toBe(true);
  await click("Terapkan kolom");
  state.search = state.href.split("?")[1]; await render();
  expect(displayTable(host.querySelector("table")!)[0]).toEqual(["Total"]);
  await click("Tampilkan semua kolom");
  expect(new URL(state.href, "https://example.com").searchParams.has("kolom")).toBe(false);
  state.search = ""; await render();
  expect(displayTable(host.querySelector("table")!)[0]).toEqual(["Barang", "Qty", "Total"]);
});

it.each(["broken", '{"t00000000-1":[1]}'])("shows full data and a visible failure for invalid or stale choice %s", async raw => {
  state.search = new URLSearchParams({ kolom: raw }).toString(); await render();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector('[role="alert"]')!.closest("details:not([open])")).toBeNull();
  expect(displayTable(host.querySelector("table")!)[0]).toEqual(["Barang", "Qty", "Total"]);
  await click("Tampilkan semua kolom");
  expect(new URL(state.href, "https://example.com").searchParams.has("kolom")).toBe(false);
});

it("rejects all-hidden choices and duplicate kolom query values without hiding data", async () => {
  await render();
  const key = inspectReportTables(host.querySelector("#laporan-isi")!).tables[0].key;
  state.search = new URLSearchParams({ kolom: JSON.stringify({ [key]: [0, 1, 2] }) }).toString(); await render();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(displayTable(host.querySelector("table")!)[0]).toHaveLength(3);
  state.search = "kolom=%7B%7D&kolom=%7B%7D"; await render();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});

it("restores detached owned DOM during navigation and inspects fresh report columns", async () => {
  await render();
  const key = inspectReportTables(host.querySelector("#laporan-isi")!).tables[0].key;
  state.search = new URLSearchParams({ kolom: JSON.stringify({ [key]: [1] }) }).toString(); await render();
  const old = host.querySelector("table")!;
  expect(old.rows[0].cells[1].hidden).toBe(true);
  state.search = "bulan=2026-11"; await render(<table><thead><tr><th>Nama</th><th>Saldo</th></tr></thead><tbody><tr><td>Klinik</td><td>500</td></tr></tbody></table>);
  expect(old.rows[0].cells[1].hidden).toBe(false);
  expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  expect(displayTable(host.querySelector("table")!)).toEqual([["Nama", "Saldo"], ["Klinik", "500"]]);
});

it("explains unsupported tables and keeps non-report shared wrappers outside the selector", async () => {
  await render(<table><thead><tr><th colSpan={2}>Saldo</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>);
  expect(host.textContent).toContain("tetap ditampilkan lengkap");
  expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  state.path = "/hris/gaji"; state.search = "kolom=broken"; await render();
  expect(host.querySelector("details")).toBeNull();
  expect(host.querySelector('[name="kolom"]')).toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("uses fresh merged cells after a server refresh at the same applied URL", async () => {
  await render();
  const key = inspectReportTables(host.querySelector("#laporan-isi")!).tables[0].key;
  state.search = new URLSearchParams({ kolom: JSON.stringify({ [key]: [1] }) }).toString(); await render();
  const old = host.querySelector("table")!;
  await render(<table><thead><tr><th>Barang</th><th>Qty</th><th>Total</th></tr></thead><tbody><tr><td colSpan={3}>Belum ada data</td></tr></tbody></table>);
  expect(old.rows[0].cells[1].hidden).toBe(false);
  expect(host.querySelector("tbody td")?.getAttribute("colspan")).toBe("2");
  expect(displayTable(host.querySelector("table")!)).toEqual([["Barang", "Total"], ["Belum ada data", ""]]);
});
