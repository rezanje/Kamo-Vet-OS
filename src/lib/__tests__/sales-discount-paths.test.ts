import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const syncAction = readFileSync(resolve(process.cwd(), "src/app/(app)/keuangan/sinkron/actions.ts"), "utf8");
const clinicAction = readFileSync(resolve(process.cwd(), "src/app/(app)/klinik/pembayaran/[visitId]/actions.ts"), "utf8");
const posActions = [
  "src/app/kasir/checkout.ts",
  "src/app/(app)/pos/transaksi/actions.ts",
].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));

describe("seluruh jalur posting diskon penjualan", () => {
  it("posting dan sinkronisasi klinik memakai jurnal diskon terpisah", () => {
    expect(clinicAction).toContain("jurnalPenjualanKlinik");
    expect(syncAction).toContain("lines: jurnalPenjualanKlinik");
  });

  it("posting dan sinkronisasi petshop memakai jurnal diskon terpisah", () => {
    for (const source of posActions) expect(source).toContain("jurnalPenjualanInklusif");
    expect(syncAction).toContain("lines: jurnalPenjualanInklusif");
  });
});
