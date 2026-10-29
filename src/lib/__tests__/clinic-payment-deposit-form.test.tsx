import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/useClinicDraft", () => ({ useClinicDraft: ({ requestKey }: { requestKey: string }) => ({ submissionKey: requestKey, submit: vi.fn(), capture: vi.fn(), attachForm: vi.fn(), discard: vi.fn(), recovered: false, storageError: "", saveError: "" }) }));
vi.mock("@/components/SubmitButton", () => ({ SubmitButton: () => null }));
vi.mock("../../app/(app)/klinik/pembayaran/[visitId]/actions", () => ({ bayarVisit: vi.fn() }));
vi.mock("@/lib/tanggal", async () => await import("../tanggal"));
vi.mock("@/lib/metode-bayar", async () => await import("../metode-bayar"));
vi.mock("@/lib/promo-hitung", async () => await import("../promo-hitung"));
vi.mock("@/lib/harga-golongan", async () => await import("../harga-golongan"));
vi.mock("@/lib/voucher", async () => await import("../voucher"));
vi.mock("@/lib/tagihan-klinik", () => ({ hargaNetto: (r: { harga: number }) => r.harga, nilaiBaris: (r: { qty: number; harga: number }) => r.qty * r.harga }));
import { PembayaranForm } from "../../app/(app)/klinik/pembayaran/[visitId]/PembayaranForm";

const props = {
  visitId: "visit", requestKey: "request",
  patient: { photo: null, name: "Fiction", species: "Kucing", owner: "Owner", phone: "", address: "", dokter: "Doctor", jenisLayanan: "Rawat Inap", noInvoice: "(baru)", tanggal: "2026-10-29" },
  initialObat: [], initialJasa: [{ deskripsi: "Rawat inap 5 hari", qty: 1, harga: 500000 }], catatanResep: null,
  bekal: { promos: [], aturanDiskon: [], golonganPersen: 0, infoBarang: {}, vouchers: [], hariIni: "2026-10-29", customerId: null, categoryId: null, poinSaldo: 0, rupiahPerPoin: 1 },
};
const render = (extra: Record<string, unknown>) =>
  renderToStaticMarkup(React.createElement(PembayaranForm, { ...props, ...extra } as never));

describe("deposit rawat inap di layar pembayaran", () => {
  it("memperlihatkan deposit yang dipakai dan sisa yang masih harus dibayar", () => {
    const html = render({ depositBalance: 300000 });
    expect(html).toContain("Deposit dipakai");
    expect(html).toContain("Rp 300.000");
    // Total 500.000 − deposit 300.000 = sisa 200.000 yang harus ditagih ke pemilik.
    expect(html).toContain("Rp 200.000");
  });

  it("tidak pernah memotong lebih besar daripada tagihannya; kelebihannya diberitahukan", () => {
    const html = render({ depositBalance: 900000 });
    expect(html).toContain("Deposit dipakai");
    expect(html).toContain("Rp 500.000");
    expect(html).toContain("Deposit lebih Rp 400.000");
    expect(html).not.toContain("Rp 900.000");
  });

  it("mengirim uang yang diterima di meja supaya server menurunkan statusnya sendiri", () => {
    expect(render({ depositBalance: 300000 })).toContain('name="cash_received"');
  });

  it("tanpa deposit, layar pembayaran tidak berubah", () => {
    const html = render({});
    expect(html).not.toContain("Deposit dipakai");
    expect(html).not.toContain("Deposit lebih");
  });

  it("koreksi tagihan tidak menerima uang baru, jadi tidak mengirim uang di meja", () => {
    expect(render({ editMode: true, depositBalance: 300000 })).not.toContain('name="cash_received"');
  });

  it("deposit dan aturan DEMO belum boleh digabung — potongannya tidak diperlihatkan", () => {
    const html = render({
      depositBalance: 300000, initialMetode: "Transfer",
      patient: { ...props.patient, owner: "DEMO Owner" },
      demoPolicy: { id: "policy", name: "DEMO 5%", incentivePercent: 5, feeBearer: "customer", feeRates: { Transfer: 100 }, adminRevenueCode: "4303", adminExpenseCode: "5501" },
      demoStaff: [{ id: "staff", nama: "Petugas", jabatan: "Groomer" }],
    });
    expect(html).toContain("belum bisa digabung dengan pembayaran campuran atau aturan DEMO");
    expect(html).not.toContain("Deposit dipakai");
  });
});
