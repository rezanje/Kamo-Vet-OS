// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PromoMasterReview } from "@/lib/promo-master-import";
import { PROMO_MASTER_HEADERS } from "@/lib/promo-master-excel";

const calls = vi.hoisted(() => ({ preview: vi.fn(), save: vi.fn(), review: vi.fn() }));
vi.mock("@/app/(app)/crm/promo/impor-daftar/actions", () => ({
  previewPromoMaster: calls.preview, simpanPromoMaster: calls.save, periksaPromoMaster: calls.review,
}));
import { PromoMasterWorkspace } from "@/app/(app)/crm/promo/impor-daftar/PromoMasterWorkspace";

let host: HTMLDivElement;
let root: Root;
const button = (label: string) => [...host.querySelectorAll("button")].find(b => b.textContent === label)!;
const result = (error: string | null = null): PromoMasterReview => ({
  valid: !error, error: null, plans: [],
  rows: [{ line: 2, ...Object.fromEntries(PROMO_MASTER_HEADERS.map(h => [h, ""])),
    "Nama Promo": "Promo example", "Kode SKU": "SKU-001", item_name: "Example item", error,
  } as PromoMasterReview["rows"][number]],
  diffs: error ? [] : [{ name: "Promo example", promoId: "existing-promo", status: "ubah",
    itemsAdded: ["SKU-001"], itemsRemoved: ["SKU-002"],
    changes: [{ label: "Nilai", dari: "5", ke: "10" }],
  }],
});

beforeEach(async () => {
  vi.clearAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root.render(<PromoMasterWorkspace />); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function upload(review: PromoMasterReview) {
  calls.preview.mockResolvedValue(review);
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["fixture"], "promo.xlsx")] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await act(async () => button("Baca dan preview").click());
}

it("links the template and prevents saving red validation rows", async () => {
  expect(host.querySelector('a[href="/crm/promo/impor-daftar/template"]')).not.toBeNull();
  await upload(result("SKU tidak ada di master"));
  expect(host.textContent).toContain("SKU tidak ada di master");
  const row = host.querySelector("tbody tr") as HTMLTableRowElement;
  expect(row.style.background).toBe("rgb(254, 242, 242)");
  expect(button("Simpan seluruh daftar").disabled).toBe(true);
  await act(async () => button("Simpan seluruh daftar").click());
  expect(calls.save).not.toHaveBeenCalled();
});

it("shows same-name update diff and saves the reviewed rows once", async () => {
  const reviewed = result();
  await upload(reviewed);
  expect(host.textContent).toContain("DIPERBARUI");
  expect(host.textContent).toContain("Nilai: 5 → 10");
  expect(host.textContent).toContain("Barang ditambah: SKU-001");
  expect(host.textContent).toContain("Barang dikeluarkan: SKU-002");
  calls.save.mockResolvedValue({ ok: true, message: "0 promo baru dan 1 promo diperbarui." });
  await act(async () => button("Simpan seluruh daftar").click());
  expect(calls.save).toHaveBeenCalledExactlyOnceWith(reviewed.rows);
  expect(host.textContent).toContain("0 promo baru dan 1 promo diperbarui.");
  expect(button("Simpan seluruh daftar").disabled).toBe(true);
});

it("clears the old valid preview when another file is selected", async () => {
  await upload(result());
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["new"], "other.xlsx")] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(host.textContent).not.toContain("DIPERBARUI");
  expect(host.textContent).not.toContain("Simpan seluruh daftar");
  expect(calls.save).not.toHaveBeenCalled();
});
