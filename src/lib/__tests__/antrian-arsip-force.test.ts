import { expect, it } from "vitest";
import { bolehPaksaArsip, hurufBermakna, pesanArsip } from "@/lib/antrian-arsip";

it("only an active OWNER may force", () => {
  expect(bolehPaksaArsip({ role: "OWNER", is_active: true })).toBe(true);
  for (const p of [{ role: "ADMIN", is_active: true }, { role: "OWNER", is_active: false }, { role: "STAFF", is_active: true }, { role: null, is_active: true }, null, undefined]) expect(bolehPaksaArsip(p)).toBe(false);
});

it("significant characters are letters/digits only (punctuation and spaces do not count)", () => {
  expect(hurufBermakna(".....")).toBe(0);
  expect(hurufBermakna("a-b-c-d---")).toBe(4);
  expect(hurufBermakna("  ab cde  ")).toBe(5);
  expect(hurufBermakna("Uji 123")).toBe(6);
});

it("lock timeouts are explained in plain Indonesian; coded prefixes are stripped", () => {
  expect(pesanArsip("canceling statement due to lock timeout")).toContain("sedang diproses pengguna lain");
  expect(pesanArsip("ERROR: 55P03")).toContain("sedang diproses pengguna lain");
  expect(pesanArsip("FORCE_DENIED: hanya pemilik yang boleh memaksa arsip")).toBe("hanya pemilik yang boleh memaksa arsip");
});
