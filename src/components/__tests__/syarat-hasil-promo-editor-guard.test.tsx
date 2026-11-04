// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/crm/promo/actions", () => ({ editPromo: vi.fn() }));
import { PromoEditor } from "@/app/(app)/crm/promo/PromoEditor";
import type { PromoEditSnapshot } from "@/lib/promo-edit";

const snapshot: PromoEditSnapshot = {
  version: "a".repeat(32), item_ids: ["x"],
  promo: { id: "sh", name: "Beli 2 Bolt, ANC -Rp1.000", promo_type: "bundling", rule: { discount_mode: "syarat_hasil", syarat_hasil: { version: 1 } } as unknown as PromoEditSnapshot["promo"]["rule"], is_active: false, branch_ids: null, valid_from: null, valid_until: null, min_qty: null, max_qty: null, kelipatan: true, auto_apply: true, discount_type: null, discount_value: null },
};
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("the legacy editor fails closed on a syarat_hasil promo (read-only notice, no form, no submit)", async () => {
  await act(async () => root.render(<PromoEditor userId="owner" snapshot={snapshot} items={[]} branches={[]} categories={[]} />));
  expect(host.textContent).toContain("syarat");
  expect(host.textContent).toContain("Beli 2 Bolt, ANC -Rp1.000");
  expect(host.querySelector("form")).toBeNull();
  expect(host.querySelector("button[type=submit]")).toBeNull();
});
