import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); }, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/CorrectionTransactionForm", () => ({ CorrectionTransactionForm: ({ children }: { children: (s: { ready: boolean }) => React.ReactNode }) => <form>{children({ ready: true })}</form> }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button> }));
vi.mock("@/components/PilihRekening", () => ({ PilihRekening: () => <span /> }));
vi.mock("@/components/NumberInput", () => ({ NumberInput: (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} /> }));
vi.mock("@/app/(app)/pembelian/faktur/actions", () => ({ bayarFaktur: vi.fn() }));
import { PurchasePaymentForm } from "@/components/PurchasePaymentForm";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-12T03:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

it("bayar ulang: tanggal dibatasi mulai tanggal pembayaran yang dibatalkan sampai hari ini, dengan kolom alasan", () => {
  const html = renderToStaticMarkup(<PurchasePaymentForm userId="u" invoiceId="i1" remaining={500} today="2026-11-12" accounts={[]} advances={[]}
    replacement={{ id: "p1", amount: 500, metode: "Transfer", advance_id: null, tanggal: "2026-11-07" }} />);
  expect(html).toContain('min="2026-11-07"');
  expect(html).toContain('max="2026-11-12"');
  expect(html).toContain('name="catatan"');
  expect(html).not.toMatch(/mundur|wajib beralasan/i);
  expect(html).toContain('name="replaces_payment_id"');
});

it("pembayaran biasa: tidak ada batas bawah dan tidak ada kolom alasan baru (alur lama tidak berubah)", () => {
  const html = renderToStaticMarkup(<PurchasePaymentForm userId="u" invoiceId="i1" remaining={500} today="2026-11-12" accounts={[]} advances={[]} />);
  expect(html).not.toContain("min=\"20");
  expect(html).not.toContain('name="catatan"');
  expect(html).toContain('max="2026-11-12"');
});

it("faktur pengganti (langsung): tanpa izin dikunci hari ini tanpa kata tanggal; Owner/izin bisa memilih sampai tanggal faktur asal", async () => {
  vi.doMock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
  vi.doMock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), redirect: vi.fn(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
  vi.doMock("@/app/(app)/pembelian/faktur/langsung/actions", () => ({ buatFakturLangsung: vi.fn() }));
  const { FakturLangsungForm } = await import("@/app/(app)/pembelian/faktur/langsung/FakturLangsungForm");
  const initial = { id: "o", supplier_id: "s", warehouse_id: "w", tanggal: "2026-11-03", jatuh_tempo: "2026-12-03", no_faktur_pemasok: null, surat_jalan: null, keterangan: null, lampiran: [], purchase_invoice_items: [] } as never;
  const base = { userId: "u", suppliers: [], warehouses: [], items: [], initial };
  const locked = renderToStaticMarkup(<FakturLangsungForm {...base} canBackdate={false} />);
  expect(locked).toContain('value="2026-11-12"'); expect(locked).toContain('min="2026-11-12"'); expect(locked).not.toMatch(/mundur|Owner|dibukukan hari ini/i);
  const owner = renderToStaticMarkup(<FakturLangsungForm {...base} canBackdate />);
  expect(owner).toContain('value="2026-11-12"'); expect(owner).toContain('min="2026-11-03"'); expect(owner).toContain('max="2026-11-12"'); expect(owner).toContain("Bila bukan hari ini, isi Keterangan sebagai alasan."); expect(owner).not.toMatch(/mundur/i);
});
