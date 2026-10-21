// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/(app)/pos/stok/actions", () => ({ resetSimulasiBarangDanStok: vi.fn() }));
import { ResetSimulasiForm } from "@/app/(app)/pos/stok/ResetSimulasiForm";

function render(role: string | null | undefined) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<ResetSimulasiForm role={role} />);
  return host;
}

describe("read-only reset maintenance guidance", () => {
  it("explains global destructive scope independently of the warehouse filter", () => {
    const host = render("OWNER");
    expect(host.textContent).toContain("Reset simulasi total — seluruh cabang");
    expect(host.textContent).toContain("termasuk master barang/SKU");
    expect(host.textContent).toContain("Filter gudang di atas tidak membatasi reset");
    expect(host.textContent).toContain("transaksi terkait dan jurnal terkait");
    expect(host.textContent).toContain("Reset dari aplikasi dinonaktifkan");
    expect(host.textContent).toContain("403/42501");
  });

  it("offers read-only review links and approved manual maintenance steps with no submit controls", () => {
    const host = render("OWNER");
    expect(host.querySelectorAll("form, button, input")).toHaveLength(0);
    expect([...host.querySelectorAll("a")].map(link => link.getAttribute("href"))).toEqual([
      "/pos/sku", "/pos/kartu-stok", "/pos/penyesuaian",
    ]);
    expect(host.textContent).toMatch(/backup.*restore/i);
    expect(host.textContent).toContain("persetujuan Owner");
    expect(host.textContent).toContain("hasilnya belum diketahui");
    expect(host.textContent).not.toMatch(/coba lagi|tetap utuh|Reset simulasi selesai/i);
  });

  it.each(["ADMIN", "FINANCE", "STAFF", null, undefined])("hides owner maintenance guidance from %s", role => {
    expect(render(role).innerHTML).toBe("");
  });
});
