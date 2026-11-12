// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ action: vi.fn(async () => {}) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/app/(app)/klinik/pembayaran/[visitId]/payment-correction-actions", () => ({ koreksiMetodeBayarKlinik: fixture.action }));
import { ClinicPaymentCorrectionForm } from "@/app/(app)/klinik/pembayaran/[visitId]/ClinicPaymentCorrectionForm";
import { ClinicPaymentCorrectionPanel } from "@/app/(app)/klinik/pembayaran/[visitId]/ClinicPaymentCorrectionPanel";
import { METODE_BAYAR } from "@/lib/metode-bayar";

let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it.each(METODE_BAYAR.map(o => o.m))("offers every other method for a %s part", async (method) => {
  await act(async () => root.render(<ClinicPaymentCorrectionForm userId="u" visitId="v" invoiceId="i" paymentId={null} revision={0}
    label="Pembayaran invoice" method={method} amount={100000} />));
  const select = host.querySelector<HTMLSelectElement>('select[name="metode"]')!;
  expect([...select.options].map(o => o.value).filter(Boolean)).toEqual(METODE_BAYAR.map(o => o.m).filter(m => m !== method));
  expect(select.required).toBe(true);
  expect(host.querySelector('input[type="hidden"][name="metode"]')).toBeNull();
});
it("the panel no longer claims the correction is limited to cash and transfer", async () => {
  await act(async () => root.render(<ClinicPaymentCorrectionPanel userId="u" visitId="v" invoiceId="i" history={[]} readError={false} blocked={null}
    parts={[{ paymentId: null, label: "Pembayaran invoice", method: "QRIS", amount: 50000 }]} />));
  expect(host.textContent).toContain("KOREKSI METODE PEMBAYARAN");
  expect(host.textContent).not.toContain("TUNAI ↔ TRANSFER");
  expect(host.textContent).not.toContain("Tidak ada bagian pembayaran Tunai atau Transfer");
});
