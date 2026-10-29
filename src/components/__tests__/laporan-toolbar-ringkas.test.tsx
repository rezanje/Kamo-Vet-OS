// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Andri: tampilan laporan "penuh banget, banyak space kosong". Kotak konfigurasi
// tersimpan + unduh tidak boleh lagi makan satu layar sebelum filter.
vi.mock("next/navigation", () => ({ usePathname: () => "/laporan/penjual", useSearchParams: () => new URLSearchParams(""), useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/LocalTransactionDraft", () => ({ useDraftUserId: () => "user-a" }));
vi.mock("@/app/(app)/laporan/preset-actions", () => ({
  listPrivateReportPresets: async () => ({ ok: true, userId: "user-a", rows: [] }),
  savePrivateReportPreset: vi.fn(), deletePrivateReportPreset: vi.fn(),
}));
import { LaporanPage } from "../LaporanPage";

let host: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("unduh + konfigurasi tersimpan ada di satu baris toolbar, konfigurasi terlipat", async () => {
  await act(async () => root.render(<LaporanPage icon="ti-x" title="Uji" desc="d" filter={<input name="dari" />}><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></LaporanPage>));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const toolbar = host.querySelector("[data-report-toolbar]");
  expect(toolbar).not.toBeNull();
  expect(toolbar!.textContent).toContain("CSV");
  const presets = toolbar!.querySelector<HTMLDetailsElement>("details[data-report-presets]");
  expect(presets).not.toBeNull();
  expect(presets!.open).toBe(false);
  expect(presets!.querySelector("summary")!.textContent).toContain("Konfigurasi tersimpan");
  // fungsi tetap ada di dalam lipatan
  expect(presets!.querySelector('[aria-label="Nama konfigurasi laporan"]')).not.toBeNull();
  // filter langsung setelah toolbar, bukan setelah kotak besar
  expect(toolbar!.nextElementSibling?.matches("form[data-report-filters]")).toBe(true);
});
