// Panel "Kembalikan saldo uang muka" di halaman pembayaran/koreksi: saldo per uang muka, daftar pengajuan, tautan "Selesaikan" ke antrean Finance.
import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const s = vi.hoisted(() => ({ role: "OWNER" as string | null, advances: [] as unknown[], refunds: [] as unknown[], advError: null as unknown, rpc: [] as { name: string; args: Record<string, unknown> }[] }));
vi.mock("next/link", () => ({ default: ({ href, children }: React.PropsWithChildren<{ href: string }>) => <a href={href}>{children}</a> }));
vi.mock("../koreksi/UangMukaRefundForm", () => ({ UangMukaRefundForm: ({ advanceId, noUangMuka, saldo }: { advanceId: string; noUangMuka: string; saldo: number }) => <div data-testid="form">form {advanceId} {noUangMuka} saldo {saldo}</div> }));
import { UangMukaRefundSection } from "../UangMukaRefundSection";

const db = {
  from: (table: string) => { const q = { select: () => q, eq: () => q, order: () => q, then: (res: (x: unknown) => unknown) => Promise.resolve({ data: table === "clinic_customer_advances" ? s.advances : [], error: s.advError }).then(res) }; return q; },
  rpc: async (name: string, args: Record<string, unknown>) => { s.rpc.push({ name, args }); return { data: s.refunds, error: null }; },
};
const adv = (over: Record<string, unknown> = {}) => ({ id: "adv-1", no_uang_muka: "UMK-202611-0045", amount: 875200, applied: 845200, status: "aktif", refunded_amount: 0, refund_reserved: 0, ...over });
const render = async (role: string | null = s.role) => renderToStaticMarkup(await UangMukaRefundSection({ db: db as never, visitId: "v1", role, requestKeyBase: "kunci" }));
beforeEach(() => { s.role = "OWNER"; s.advances = [adv()]; s.refunds = []; s.advError = null; s.rpc = []; });

it("OWNER dan FINANCE melihat saldo uang muka dan form pengajuan; peran lain tidak melihat apa pun dan tidak ada panggilan RPC", async () => {
  for (const role of ["OWNER", "FINANCE"]) {
    const html = await render(role);
    expect(html, role).toContain("Kembalikan saldo uang muka");
    expect(html, role).toContain("UMK-202611-0045");
    expect(html, role).toContain("saldo 30000");
  }
  s.rpc = [];
  for (const role of ["ADMIN", "STAFF", "DOCTOR", null]) expect(await render(role), String(role)).toBe("");
  expect(s.rpc).toEqual([]);
});

it("uang muka tanpa saldo (terpakai penuh) tidak mendapat form; tanpa uang muka sama sekali panel tidak muncul; uang muka batal diabaikan", async () => {
  s.advances = [adv({ amount: 845200, applied: 845200 })];
  const penuh = await render();
  expect(penuh).not.toContain("data-testid=\"form\"");
  s.advances = [];
  expect(await render()).toBe("");
  s.advances = [adv({ status: "batal", amount: 1000, applied: 0 })];
  expect(await render()).toBe("");
});

it("pengajuan yang menunggu tampil dengan status dan tombol Selesaikan ke antrean Finance; yang selesai menampilkan nomor dan referensi bank; hanya OWNER/FINANCE", async () => {
  s.refunds = [
    { id: "r1", no_refund: "RUM-202611-0001", amount: 30000, status: "pending", requested_at: "2026-11-07T01:00:00Z", destination: { bank: "BCA", account: "1234567890", name: "Keripik Tempe" } },
    { id: "r2", no_refund: "RUM-202611-0002", amount: 10000, status: "selesai", bank_reference: "TRF-BCA-777", tanggal: "2026-11-07", requested_at: "2026-11-06T01:00:00Z", destination: { bank: "BCA", account: "1234567890", name: "Keripik Tempe" } },
  ];
  const html = await render("FINANCE");
  expect(html).toContain("RUM-202611-0001");
  expect(html).toContain("Menunggu");
  expect(html).toContain("href=\"/kas-bank/refund?status=pending\"");
  expect(html).toContain("Selesaikan");
  expect(html).toContain("TRF-BCA-777");
  expect(s.rpc[0]).toEqual({ name: "get_clinic_advance_refunds", args: { p_advance: "adv-1", p_office: false, p_status: "", p_offset: 0 } });
});

it("uang muka yang sudah sebagian dikembalikan menampilkan jumlah yang sudah dikembalikan dan peringatan bahwa kwitansinya tidak bisa dibatalkan", async () => {
  s.advances = [adv({ amount: 845200, applied: 0, refunded_amount: 30000 })];
  const html = await render();
  expect(html).toContain("sudah dikembalikan");
  expect(html).toContain("30.000");
  expect(html).toContain("Kwitansinya tidak bisa dibatalkan");
});

it("gagal membaca uang muka: panel menyebut belum bisa dimuat dan tidak menawarkan form (bukan layar kosong yang menyesatkan)", async () => {
  s.advError = { message: "boom" };
  const html = await render();
  expect(html).toContain("belum dapat dimuat");
  expect(html).not.toContain("data-testid=\"form\"");
});
