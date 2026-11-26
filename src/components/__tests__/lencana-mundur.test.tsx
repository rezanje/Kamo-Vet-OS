// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { LencanaMundur } from "@/components/pengeluaran/LencanaMundur";

async function render(el: React.ReactElement) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); const root = createRoot(host);
  await act(async () => root.render(el)); const html = host.innerHTML; await act(async () => root.unmount()); return html;
}
it("tidak menampilkan apa pun tanpa jejak", async () => {
  expect(await render(<LencanaMundur jejak={undefined} />)).toBe("");
  expect(await render(<LencanaMundur jejak={null} />)).toBe("");
});
it("menampilkan lencana Mundur dengan alasan, tanggal efektif dan waktu input di tooltip", async () => {
  const html = await render(<LencanaMundur jejak={{ expense_id: "e", effective_date: "2026-11-20", reason: "nota listrik terlupa", recorded_at: "2026-11-26T03:00:00Z" }} />);
  expect(html).toContain("Mundur"); expect(html).toContain("nota listrik terlupa"); expect(html).toContain("20/11/2026"); expect(html).toContain("WIB");
});
