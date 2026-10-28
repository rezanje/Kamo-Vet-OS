import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc }) }));
vi.mock("@/components/RelatedDocuments", () => ({ DocumentLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button> }));
import { batalkanUangMukaBeserta } from "@/app/(app)/pembelian/uang-muka/[id]/batal/actions";
import BatalUangMukaPage from "@/app/(app)/pembelian/uang-muka/[id]/batal/page";

const form = (overrides: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [key, value] of Object.entries({ advance_id: "adv", request_key: "key-1", fingerprint: "fp", alasan: "Salah pemasok", setuju: "1", ...overrides })) data.set(key, value);
  return data;
};
beforeEach(() => { vi.clearAllMocks(); });

it("P08: cancels a used advance and its payments through one RPC with the previewed fingerprint", async () => {
  state.rpc.mockResolvedValue({ data: { advance_id: "adv", journal_id: "j", no_um: "UM.1", payment_count: 2 }, error: null });
  await expect(batalkanUangMukaBeserta(form())).rejects.toThrow(/REDIRECT:\/pembelian\/uang-muka\?success=.*2%20pembayaran/);
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("cancel_purchase_advance_cascade", { p_advance_id: "adv", p_reason: "Salah pemasok", p_request_key: "key-1", p_expected_fingerprint: "fp" });
  expect(state.revalidate).toHaveBeenCalledWith("/keuangan/hutang");
});

it("P08: refuses without confirmation or reason, and never acknowledges a partial result", async () => {
  await expect(batalkanUangMukaBeserta(form({ setuju: "" }))).rejects.toThrow("error=");
  await expect(batalkanUangMukaBeserta(form({ alasan: "x" }))).rejects.toThrow("error=");
  expect(state.rpc).not.toHaveBeenCalled();
  state.rpc.mockResolvedValue({ data: null, error: { message: "Pembayaran yang memakai uang muka ini berubah sejak pratinjau" } });
  await expect(batalkanUangMukaBeserta(form())).rejects.toThrow("berubah%20sejak%20pratinjau");
  state.rpc.mockResolvedValue({ data: { advance_id: "adv" }, error: null });
  await expect(batalkanUangMukaBeserta(form())).rejects.toThrow("belum terkonfirmasi");
  expect(state.revalidate).not.toHaveBeenCalled();
});

it("P08: preview lists every payment and invoice that will be reversed", async () => {
  state.rpc.mockResolvedValue({ data: { advance_id: "adv", no_um: "UM.1", status: "aktif", jumlah: 200, terpakai: 200, fingerprint: "fp", payments: [
    { payment_id: "p1", group_key: "j1", tanggal: "2026-10-01", amount: 150, dari_uang_muka: 150, uses_this_advance: true, no_um: "UM.1", invoice_id: "i1", no_faktur: "FB.1", invoice_voided: false, payment_order_id: null, no_pp: null },
    { payment_id: "p2", group_key: "j2", tanggal: "2026-10-02", amount: 100, dari_uang_muka: 50, uses_this_advance: true, no_um: "UM.1", invoice_id: "i2", no_faktur: "FB.2", invoice_voided: false, payment_order_id: "o", no_pp: "PP.1" },
  ] }, error: null });
  const html = renderToStaticMarkup(await BatalUangMukaPage({ params: Promise.resolve({ id: "adv" }), searchParams: Promise.resolve({}) }));
  expect(state.rpc).toHaveBeenCalledWith("preview_purchase_advance_cascade", { p_advance_id: "adv" });
  expect(html).toContain("FB.1");
  expect(html).toContain("FB.2");
  expect(html).toContain("Perintah bayar PP.1");
  expect(html).toContain('name="fingerprint" value="fp"');
  expect(html).toContain("2 pembayaran");
});

it("P08: preview refused for non-owners shows the database message and no form", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "hanya oleh Super Admin (OWNER)" } });
  const html = renderToStaticMarkup(await BatalUangMukaPage({ params: Promise.resolve({ id: "adv" }), searchParams: Promise.resolve({}) }));
  expect(html).toContain("Super Admin");
  expect(html).not.toContain("<form");
});
