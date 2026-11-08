// Tampilan awal "Ubah BMHP (Owner)": hanya tombol (isian dan alasan baru muncul setelah dibuka). Alur klik penuh diuji di
// src/components/__tests__/inpatient-cashier-ubah-bmhp-owner.test.tsx.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("../bmhp-owner-actions", () => ({ pratinjauBmhp: vi.fn(), simpanBmhp: vi.fn() }));
import { BmhpOwnerForm } from "../BmhpOwnerForm";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const komponen = [{ item_id: U(10), name: "Lacto-B Fiktif", qty: 5, unit: null, base_qty: 5, cost: 60000 }];
it.each(["pending", "tagihan"] as const)("mode %s tertutup: hanya tombol Ubah BMHP (Owner), tanpa isian", (mode) => {
  const html = renderToStaticMarkup(<BmhpOwnerForm mode={mode} visitId={U(1)} recordId={U(2)} targetId={U(3)} snapshot="s" title="Injeksi Antibiotik" price={50000} components={komponen} master={[]} requestKey="k" />);
  expect(html).toContain("Ubah BMHP (Owner)");
  expect(html).not.toContain("Alasan (wajib)");
  expect(html).not.toContain("Simpan perubahan BMHP");
});
