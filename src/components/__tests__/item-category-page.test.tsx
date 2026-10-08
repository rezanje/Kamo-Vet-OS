// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: [
  { id: "parent", name: "ACCESORIS", parent_id: null, is_active: true },
  { id: "child", name: "COLLAR", parent_id: "parent", is_active: true },
] }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/master-guard", () => ({ bolehKelolaMaster: async () => true }));
vi.mock("../../app/(app)/pos/kategori/actions", () => ({ simpanKategori: async () => {}, toggleKategori: async () => {}, hapusKategori: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table: string) {
  const query = { select: () => query, order: () => query, not: () => query,
    then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: table === "item_categories" ? state.rows : [] }).then(resolve) };
  return query;
} }) }));
import Page from "../../app/(app)/pos/kategori/page";
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(edit?: string) {
  const tree = await Page({ searchParams: Promise.resolve({ edit }) });
  await act(async () => root.render(tree));
}
it("loads the selected name and parent when Ubah is clicked after opening the create form", async () => {
  await render();
  container.querySelector<HTMLInputElement>('input[name="name"]')!.value = "Belum disimpan";
  await render("child");
  expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe("COLLAR");
  expect(container.querySelector<HTMLSelectElement>('select[name="parent_id"]')!.value).toBe("parent");
  await render("parent");
  expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe("ACCESORIS");
  expect(container.querySelector<HTMLSelectElement>('select[name="parent_id"]')!.value).toBe("");
  await render();
  expect(container.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe("");
});
it("offers deletion for an unused leaf category", async () => {
  await render();
  const row = Array.from(container.querySelectorAll("tbody tr")).find(row => row.textContent?.includes("COLLAR"))!;
  expect(row.textContent).toContain("Hapus");
});
