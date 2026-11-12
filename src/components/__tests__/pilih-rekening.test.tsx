import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PilihRekening, labelRekening, loadRekeningAktif, type RekeningOpsi } from "@/components/PilihRekening";

const rekening: RekeningOpsi[] = [
  { id: "b2", nama: "Bank BCA Transaksi (4270086743)", coa_code: "120002", jenis: "Bank", no_rekening: "4270086743" },
  { id: "b3", nama: "BCA Gudang", coa_code: "120003", jenis: "Bank", no_rekening: "4270242486" },
  { id: "k3", nama: "Kas Kecil", coa_code: "110003", jenis: "Kas", no_rekening: null },
];

it("labels each account with code, name and the account number once", () => {
  expect(labelRekening(rekening[0])).toBe("120002 · Bank BCA Transaksi (4270086743)");
  expect(labelRekening(rekening[1])).toBe("120003 · BCA Gudang · 4270242486");
  expect(labelRekening(rekening[2])).toBe("110003 · Kas Kecil");
});

it("lists every active account grouped Kas then Bank, default follows the payment map", () => {
  const html = renderToStaticMarkup(<PilihRekening rekening={rekening} label="Masuk ke" />);
  expect(html).toContain('<option value="" selected="">— ikut peta —</option>');
  expect(html.indexOf('label="Kas"')).toBeLessThan(html.indexOf('label="Bank"'));
  for (const r of rekening) expect(html).toContain(`value="${r.id}"`);
  expect(html).toContain("120003 · BCA Gudang · 4270242486");
});

it("keeps old callers without jenis working as a flat list", () => {
  const html = renderToStaticMarkup(<PilihRekening rekening={[{ id: "x", nama: "Kas", coa_code: "110003" }]} />);
  expect(html).not.toContain("optgroup");
  expect(html).toContain("110003 · Kas");
});

it("loads active accounts with the fields the label needs", async () => {
  const calls: unknown[][] = [];
  const query = {
    select: (...a: unknown[]) => (calls.push(["select", ...a]), query),
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), query),
    order: (...a: unknown[]) => (calls.push(["order", ...a]), query),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rekening }),
  };
  const rows = await loadRekeningAktif({ from: (t: string) => (calls.push(["from", t]), query) });
  expect(rows).toHaveLength(3);
  expect(calls).toContainEqual(["from", "cash_accounts"]);
  expect(calls).toContainEqual(["select", "id, nama, coa_code, jenis, no_rekening"]);
  expect(calls).toContainEqual(["eq", "is_active", true]);
});
