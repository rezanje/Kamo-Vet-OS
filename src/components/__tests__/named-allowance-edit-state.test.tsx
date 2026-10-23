// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/master-guard", () => ({ bolehKelolaMaster: async () => true }));
vi.mock("@/app/(app)/hris/komponen-gaji/actions", () => ({ simpanKomponen: vi.fn(), toggleKomponen: vi.fn(), lepasKomponen: vi.fn(), pasangKomponen: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table: string) {
  const query = { select: () => query, eq: () => query, order: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "salary_components" ? [
      { id: "a", nama: "Transport", nominal: 100, tipe: "tunjangan", is_active: true },
      { id: "b", nama: "Makan", nominal: 200, tipe: "tunjangan", is_active: true },
    ] : [], error: null }).then(resolve) };
  return query;
} }) }));
import Page from "@/app/(app)/hris/komponen-gaji/page";
let root: Root, host: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (edit?: string) => { const page = await Page({ searchParams: Promise.resolve({ edit }) }); await act(async () => root.render(page)); };
const input = (name: string) => host.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
async function type(name: string, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(name), value); input(name).dispatchEvent(new Event("input", { bubbles: true })); });
}
it("resets dirty name/amount together with the target ID when switching edit targets and returning to create", async () => {
  await render("a"); await type("nama", "Unsaved A"); await type("nominal", "999");
  await render("b");
  expect(input("id").value).toBe("b"); expect(input("nama").value).toBe("Makan"); expect(input("nominal").value).toBe("200");
  await type("nama", "Unsaved B"); await render();
  expect(input("id").value).toBe(""); expect(input("nama").value).toBe(""); expect(input("nominal").value).toBe("0");
});
