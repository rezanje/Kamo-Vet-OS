import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/master-guard", () => ({ assertRole: async () => ({ rpc: state.rpc }) }));
vi.mock("@/components/CorrectionTransactionForm", () => ({ CorrectionTransactionForm: ({ children }: { children: (s: { ready: boolean }) => React.ReactNode }) => <form>{children({ ready: true })}</form> }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button> }));
import { batalkanPembayaranFaktur } from "@/app/(app)/pembelian/faktur/[id]/actions";
import { batalkanUangMuka } from "@/app/(app)/pembelian/uang-muka/actions";
import { batalkanUangMukaBeserta } from "@/app/(app)/pembelian/uang-muka/[id]/batal/actions";
import { PaymentCorrectionForm } from "@/app/(app)/pembelian/faktur/[id]/PaymentCorrectionForm";
import { InvoiceCorrectionForm } from "@/app/(app)/pembelian/faktur/[id]/InvoiceCorrectionForm";
import { ReceiptCancelForm } from "@/app/(app)/pembelian/penerimaan/[id]/ReceiptCancelForm";

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-12T03:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

const payForm = (o: Record<string, string> = {}) => fd({ invoice_id: "inv", payment_id: "pay", revision: "0", draft_key: "k", alasan: "Salah transfer", tindakan: "batal", ...o });
const payOk = { data: { payment_id: "pay", invoice_id: "inv", cancellation_id: "c", reversal_journal_id: "j" }, error: null };

it("batal pembayaran: tanggal efektif pilihan dikirim ke RPC bersama alasan dan kunci", async () => {
  state.rpc.mockResolvedValue(payOk);
  await expect(batalkanPembayaranFaktur(payForm({ tanggal: "2026-11-06" }))).rejects.toThrow("REDIRECT:/pembelian/faktur/inv?success=");
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("cancel_purchase_payment", { p_payment_id: "pay", p_expected_revision: 0, p_request_key: "k", p_reason: "Salah transfer", p_tanggal: "2026-11-06" });
});

it("batal pembayaran: tanggal kosong (tab lama) = hari ini WIB", async () => {
  state.rpc.mockResolvedValue(payOk);
  await expect(batalkanPembayaranFaktur(payForm())).rejects.toThrow("REDIRECT:");
  expect(state.rpc).toHaveBeenCalledWith("cancel_purchase_payment", expect.objectContaining({ p_tanggal: "2026-11-12" }));
});

it("batal pembayaran: masa depan atau format rusak ditolak sebelum RPC dengan penjelasan", async () => {
  await expect(batalkanPembayaranFaktur(payForm({ tanggal: "2026-11-13" }))).rejects.toThrow(/REDIRECT:\/pembelian\/faktur\/inv\?error=.*masa%20depan/);
  await expect(batalkanPembayaranFaktur(payForm({ tanggal: "kemarin" }))).rejects.toThrow(/error=.*tidak%20valid/);
  expect(state.rpc).not.toHaveBeenCalled();
});

it("batal pembayaran: pemulihan (periksa hasil terakhir) tidak butuh tanggal dan tidak mengirim tanggal", async () => {
  state.rpc.mockResolvedValue(payOk);
  await expect(batalkanPembayaranFaktur(payForm({ tindakan: "periksa", tanggal: "2099-01-01" }))).rejects.toThrow("REDIRECT:");
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("get_purchase_payment_cancellation", { p_payment_id: "pay", p_request_key: "k" });
});

it("batal pembayaran: penolakan database (izin tanggal mundur / periode ditutup) ditampilkan apa adanya tanpa revalidasi", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "Tanggal mundur (sebelum hari ini) hanya untuk Owner atau peran yang diberi izin Tanggal mundur di Akses Grup." } });
  await expect(batalkanPembayaranFaktur(payForm({ tanggal: "2026-11-06" }))).rejects.toThrow(/error=Tanggal%20mundur/);
  expect(state.revalidate).not.toHaveBeenCalled();
});

it("batal uang muka tunggal: tanggal dan alasan dikirim; kosong = hari ini; masa depan ditolak sebelum RPC", async () => {
  state.rpc.mockResolvedValue({ data: { advance_id: "a", journal_id: "j", no_um: "UM.1" }, error: null });
  await expect(batalkanUangMuka(fd({ id: "a", tanggal: "2026-11-03", alasan: " Salah pemasok " }))).rejects.toThrow("REDIRECT:");
  expect(state.rpc).toHaveBeenLastCalledWith("cancel_purchase_advance_atomic", { p_advance_id: "a", p_tanggal: "2026-11-03", p_reason: "Salah pemasok" });
  await expect(batalkanUangMuka(fd({ id: "a" }))).rejects.toThrow("REDIRECT:");
  expect(state.rpc).toHaveBeenLastCalledWith("cancel_purchase_advance_atomic", { p_advance_id: "a", p_tanggal: "2026-11-12", p_reason: null });
  state.rpc.mockClear();
  await expect(batalkanUangMuka(fd({ id: "a", tanggal: "2026-11-20" }))).rejects.toThrow(/error=.*masa%20depan/);
  expect(state.rpc).not.toHaveBeenCalled();
});

it("batal uang muka + pembayaran: tanggal efektif ikut ke cascade", async () => {
  state.rpc.mockResolvedValue({ data: { advance_id: "adv", journal_id: "j", no_um: "UM.1", payment_count: 1 }, error: null });
  await expect(batalkanUangMukaBeserta(fd({ advance_id: "adv", request_key: "key", fingerprint: "fp", alasan: "Salah pemasok", setuju: "1", tanggal: "2026-11-04" }))).rejects.toThrow("REDIRECT:");
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("cancel_purchase_advance_cascade", { p_advance_id: "adv", p_reason: "Salah pemasok", p_request_key: "key", p_expected_fingerprint: "fp", p_tanggal: "2026-11-04" });
  state.rpc.mockClear();
  await expect(batalkanUangMukaBeserta(fd({ advance_id: "adv", request_key: "key", fingerprint: "fp", alasan: "Salah pemasok", setuju: "1", tanggal: "2026-11-13" }))).rejects.toThrow(/error=.*masa%20depan/);
  expect(state.rpc).not.toHaveBeenCalled();
});

it("formulir pembatalan: Owner/izin bisa mundur sampai tanggal dokumen asal; tanpa izin dikunci hari ini", () => {
  const forms: [string, React.ReactElement, string][] = [
    ["penerimaan", <ReceiptCancelForm key="r" userId="u" receiptId="r1" docDate="2026-11-05" canBackdate />, "2026-11-05"],
    ["faktur", <InvoiceCorrectionForm key="i" userId="u" invoiceId="i1" revision={0} voided={false} docDate="2026-11-05" canBackdate />, "2026-11-05"],
    ["pembayaran", <PaymentCorrectionForm key="p" userId="u" invoiceId="i1" paymentId="p1" revision={0} grouped={false} docDate="2026-11-05" canBackdate />, "2026-11-05"],
  ];
  for (const [name, el, min] of forms) {
    const html = renderToStaticMarkup(el);
    expect(html, name).toContain('name="tanggal"');
    expect(html, name).toContain(`min="${min}"`);
    expect(html, name).toContain('max="2026-11-12"');
    expect(html, name).toContain('value="2026-11-12"');
  }
  const locked = [
    <ReceiptCancelForm key="r" userId="u" receiptId="r1" docDate="2026-11-05" canBackdate={false} />,
    <InvoiceCorrectionForm key="i" userId="u" invoiceId="i1" revision={0} voided={false} docDate="2026-11-05" canBackdate={false} />,
    <PaymentCorrectionForm key="p" userId="u" invoiceId="i1" paymentId="p1" revision={0} grouped={false} docDate="2026-11-05" canBackdate={false} />,
  ].map(el => renderToStaticMarkup(el));
  for (const html of locked) { expect(html).toContain('min="2026-11-12"'); expect(html).toContain("readOnly"); expect(html).toContain("Tanggal mundur hanya untuk Owner"); }
});

it("faktur yang sudah dibatalkan: isian tanggal dinonaktifkan", () => {
  expect(renderToStaticMarkup(<InvoiceCorrectionForm userId="u" invoiceId="i1" revision={1} voided docDate="2026-11-05" canBackdate />)).toContain("disabled");
});
