import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EffectiveDateField } from "../EffectiveDateField";
import { BackdateCashTable } from "../BackdateCashTable";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-12T03:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

it("Owner/izin: bawaan hari ini, rentang tanggal dokumen asal sampai hari ini, wajib diisi", () => {
  const html = renderToStaticMarkup(<EffectiveDateField id="d" docDate="2026-11-05" docLabel="penerimaan" canBackdate />);
  expect(html).toContain('type="date"');
  expect(html).toContain('name="tanggal"');
  expect(html).toContain('value="2026-11-12"');
  expect(html).toContain('min="2026-11-05"');
  expect(html).toContain('max="2026-11-12"');
  expect(html).toContain("required");
  expect(html).not.toContain("readOnly");
  expect(html).toContain("terbaca di tanggal aslinya");
  expect(html).toContain("wajib beralasan");
});

it("tanpa izin tanggal mundur: dikunci ke hari ini dengan penjelasan", () => {
  const html = renderToStaticMarkup(<EffectiveDateField id="d" docDate="2026-11-05" canBackdate={false} />);
  expect(html).toContain('min="2026-11-12"');
  expect(html).toContain('max="2026-11-12"');
  expect(html).toContain('readOnly=""');
  expect(html).toContain("Tanggal mundur hanya untuk Owner");
});

it("tanggal dokumen di masa depan atau rusak tidak membuka rentang melewati hari ini", () => {
  for (const docDate of ["2026-12-01", "ngawur", null]) {
    const html = renderToStaticMarkup(<EffectiveDateField id="d" docDate={docDate} canBackdate />);
    expect(html).toContain('min="2026-11-12"');
    expect(html).toContain('max="2026-11-12"');
  }
});

it("dokumen yang sudah dibatalkan menonaktifkan isian", () => {
  expect(renderToStaticMarkup(<EffectiveDateField id="d" docDate="2026-11-05" canBackdate disabled />)).toContain("disabled");
});

it("tabel rekonsiliasi menampilkan tanggal pembukuan dan tanggal uang fisik berdampingan", () => {
  const html = renderToStaticMarkup(<BackdateCashTable rows={[{
    id: "a1", kind: "payment-cancel", doc_id: "p1", doc_ref: "FB.0001", effective_date: "2026-11-06", doc_date: "2026-11-06", actual_date: "2026-11-12",
    actual_at: "2026-11-12T03:00:00Z", days_back: 6, reason: "Salah transfer", no_jurnal: "JRN-202611-0009", cash_amount: 600000,
    cash_account_code: "110209", cash_account_name: "BCA Utama", actor_name: "Owner",
  }]} />);
  expect(html).toContain("Tanggal pembukuan");
  expect(html).toContain("Tanggal uang fisik");
  expect(html).toContain("06 Nov 2026");
  expect(html).toContain("12 Nov 2026");
  expect(html).toContain("mundur 6 hari");
  expect(html).toContain("Pembatalan pembayaran");
  expect(html).toContain("FB.0001");
  expect(html).toContain("BCA Utama");
  expect(html).toContain("600.000");
  expect(html).toContain("Salah transfer");
});

it("tabel kosong dan galat tidak menyembunyikan penjelasan", () => {
  expect(renderToStaticMarkup(<BackdateCashTable rows={[]} />)).toContain("Belum ada pembatalan pembelian");
  expect(renderToStaticMarkup(<BackdateCashTable rows={[]} error="Daftar belum dapat dimuat." />)).toContain("Daftar belum dapat dimuat.");
});
