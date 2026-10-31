// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TagihanBerjalan } from "@/lib/tagihan-berjalan-server";

const state = vi.hoisted(() => ({
  data: null as TagihanBerjalan | null,
  shift: { id: "shift-1" } as { id: string } | null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/lib/shift", () => ({ getOpenShift: async () => state.shift }));
vi.mock("@/lib/pajak", () => ({ getPajakSettings: async () => ({ mode_pkp: false, ppn_rate: 11 }) }));
vi.mock("@/lib/tagihan-berjalan-server", () => ({ muatTagihanBerjalan: async () => state.data }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "cashier-fixture" } } }) },
    rpc: async () => {
      const d = state.data!;
      const pending = d.belumDitagih.reduce((sum, b) => sum + Number(b.qty) * Number(b.harga), 0);
      const debt = d.tahap.reduce((sum, t) => sum + t.sisa, 0);
      return { error: null, data: { token: "fixture-quote", amount: 0, excess: 0, pending, debt, remaining: Math.max(0, debt + pending - d.saldoUangMuka), credit: d.saldoUangMuka,
        accounts: ["Tunai", "Transfer", "Debit", "Kredit", "QRIS", "E-Wallet"].map(method => ({ method, code: method === "Tunai" ? "110003" : "120002", name: "Rekening Fiktif", bank: null, number: null })) } };
    },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data:
        table === "clinic_billing_settings" ? { min_dp_percent: 50 } : { role: "STAFF" },
      }) }) }),
    }),
  }),
}));
vi.mock("@/app/(app)/klinik/rawat-inap/[id]/tagihan/actions", () => ({
  simpanBayar: vi.fn(), tagihSekarang: vi.fn(), terimaPembayaran: vi.fn(), batalkanKwitansi: vi.fn(), lepaskanUangMuka: vi.fn(),
}));
import TagihanRawatInapPage from "@/app/(app)/klinik/rawat-inap/[id]/tagihan/page";
import * as actions from "@/app/(app)/klinik/rawat-inap/[id]/tagihan/actions";

// Fictional read-model fixture only. Rendering a query flag never receives money.
function dasar(): TagihanBerjalan {
  return {
    record: { id: "record-fixture", visit_id: "visit-fixture", branch_id: "branch-fixture", admitted_at: "2026-10-27T00:00:00Z", discharged_at: null },
    visit: { id: "visit-fixture", status: "Diperiksa", poli: null, dokter: null, customer_id: "customer-fixture" },
    pasien: "Pasien fixture", pemilik: "Pemilik fixture", telepon: null,
    belumDitagih: [{ id: "pending-1", nama_obat: "Jasa tambahan", qty: 1, harga: 200_000, jenis: "jasa", item_id: null, satuan: null, compound_recipe_id: null }],
    rincianDitagih: [{ id: "line-1", invoice_id: "inv-1", prescription_item_id: null, deskripsi: "Jasa tersimpan", qty: 1, harga: 1_300_000, diskon_persen: 0 }],
    tahap: [{ id: "inv-1", invoice_no: "INV-FIXTURE", created_at: "2026-10-27T01:00:00Z", total: 1_300_000, subtotal: 1_300_000, tax: 0, discount: 0, dp_amount: 500_000, paid_status: "DP", voided_at: null, dibayar: 500_000, sisa: 800_000, correction_pending: false }],
    piutang: 800_000, kwitansi: [], uangMuka: [], saldoUangMuka: 0, riwayatUangTerpasang: true,
  };
}

let host: HTMLDivElement, root: Root;
let showModal: ReturnType<typeof vi.fn<(this: HTMLDialogElement) => void>>;
const dialog = () => host.querySelector<HTMLDialogElement>('dialog[role="dialog"]');
const render = async (query: { success?: string; error?: string } = { success: "bayar" }) => {
  const page = await TagihanRawatInapPage({ params: Promise.resolve({ id: "record-fixture" }), searchParams: Promise.resolve(query) });
  await act(async () => root.render(page));
};

beforeEach(() => {
  vi.clearAllMocks();
  state.data = dasar(); state.shift = { id: "shift-1" };
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // jsdom has no top-layer/layout engine: emulate native dialog, not Popup itself.
  showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  vi.stubGlobal("scrollY", 2400);
  vi.stubGlobal("pageYOffset", 2400);
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = function () {
    this.open = false; this.dispatchEvent(new Event("close"));
  };
  host = document.createElement("div");
  host.style.transform = "translateZ(0)";
  host.style.marginTop = "2400px";
  document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("popup hasil pembayaran pada route tagihan ranap", () => {
  it("pelunasan hanya disebut lunas saat biaya nyata sudah seluruhnya tertutup dan riwayat terbaca", async () => {
    state.data!.belumDitagih = [];
    state.data!.tahap[0] = { ...state.data!.tahap[0], dibayar: 1_300_000, sisa: 0, paid_status: "Lunas" };
    state.data!.piutang = 0;
    await render();
    expect(dialog()?.open).toBe(true);
    expect(dialog()?.textContent).toContain("Pembayaran lunas");
    expect(dialog()?.textContent).toContain("Total dibayar: Rp 1.300.000");
    expect(dialog()?.textContent).toContain("Sisa pembayaran: Rp 0");
  });

  it("piutang terbit nol dengan biaya pending bukan pelunasan kunjungan", async () => {
    state.data!.tahap[0] = { ...state.data!.tahap[0], dibayar: 1_300_000, sisa: 0, paid_status: "Lunas" };
    state.data!.piutang = 0;
    await render();
    expect(dialog()?.textContent).toContain("Pembayaran diterima");
    expect(dialog()?.textContent).toContain("Sisa pembayaran: Rp 200.000");
    expect(dialog()?.textContent).not.toContain("Pembayaran lunas");
  });

  it("pending yang tertutup saldo uang muka tetap belum disebut lunas sebelum diterbitkan", async () => {
    state.data!.tahap[0] = { ...state.data!.tahap[0], dibayar: 1_300_000, sisa: 0, paid_status: "Lunas" };
    state.data!.saldoUangMuka = 200_000;
    state.data!.piutang = 0;
    await render();
    expect(dialog()?.textContent).toContain("Pembayaran diterima");
    expect(dialog()?.textContent).toContain("Total dibayar: Rp 1.500.000");
    expect(dialog()?.textContent).not.toContain("Pembayaran lunas");
  });

  it.each(["tanpa invoice", "invoice nol", "koreksi belum selesai"])("saldo sisa nol bukan bukti pelunasan (%s)", async (kondisi) => {
    state.data!.belumDitagih = [];
    state.data!.saldoUangMuka = 1_300_000;
    if (kondisi === "tanpa invoice") state.data!.tahap = [];
    if (kondisi === "invoice nol") state.data!.tahap[0] = { ...state.data!.tahap[0], total: 0, dibayar: 0, sisa: 0 };
    if (kondisi === "koreksi belum selesai") state.data!.tahap[0].correction_pending = true;
    await render();
    expect(dialog()?.textContent).toContain("Pembayaran diterima");
    expect(dialog()?.textContent).not.toContain("Pembayaran lunas");
  });

  it("riwayat belum terbaca tidak menghasilkan sukses/lunas dan aksi uang tetap terkunci", async () => {
    state.data!.riwayatUangTerpasang = false;
    await render();
    expect(dialog()).toBeNull();
    expect(host.textContent).toContain("Riwayat pembayaran dan uang muka belum tersedia");
    expect(host.textContent).toContain("Belum terbaca");
    expect(host.querySelector('[name="parts"]')).toBeNull();
    expect(host.querySelector('[name="ids"]')).toBeNull();
  });

  it("query sukses tanpa uang tercatat tidak menciptakan bukti penerimaan", async () => {
    state.data!.tahap[0] = { ...state.data!.tahap[0], dp_amount: 0, dibayar: 0, sisa: 1_300_000 };
    await render();
    expect(dialog()).toBeNull();
    expect(host.textContent).not.toContain("Pembayaran tersimpan");
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  });

  it("error mengalahkan success tanpa dua dialog atau sukses semu", async () => {
    await render({ success: "bayar", error: "Pembayaran belum dapat dipastikan" });
    expect(dialog()).toBeNull();
    const error = host.querySelector<HTMLDialogElement>('dialog[role="alertdialog"]');
    expect(error?.open).toBe(true);
    expect(error?.textContent).toContain("Pembayaran belum dapat dipastikan");
    expect(showModal).toHaveBeenCalledTimes(1);
  });

  it("tombol Mengerti hanya menutup native dialog, tidak mengirim pembayaran lagi", async () => {
    await render();
    const popup = dialog()!;
    const form = popup.querySelector<HTMLFormElement>("form")!;
    expect(form.getAttribute("method")).toBe("dialog");
    expect(form.hasAttribute("action")).toBe(false);
    // Emulate native method=dialog submission, missing from jsdom.
    form.addEventListener("submit", (event) => { event.preventDefault(); popup.close(); });
    const button = form.querySelector<HTMLButtonElement>("button")!;
    expect(button.textContent).toBe("Mengerti");
    await act(async () => button.click());
    expect(popup.open).toBe(false);
    expect(showModal).toHaveBeenCalledTimes(1);
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLInputElement>('[name="parts"]')?.value).toBe("[]");
  });

  it("DP memakai native modal terpusat walau kasir di bawah halaman, dengan angka rekap terkini", async () => {
    await render();
    const popup = dialog();
    expect(popup).not.toBeNull();
    expect(popup!.open).toBe(true);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(showModal.mock.instances[0]).toBe(popup);
    expect(popup!.style.margin).toBe("auto");
    expect(window.scrollY).toBe(2400);
    expect(popup!.textContent).toContain("Pembayaran diterima");
    expect(popup!.textContent).toContain("Total dibayar: Rp 500.000");
    expect(popup!.textContent).toContain("Sisa pembayaran: Rp 1.000.000");
    expect(popup!.textContent).not.toContain("Pembayaran lunas");
    for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
  });
});
