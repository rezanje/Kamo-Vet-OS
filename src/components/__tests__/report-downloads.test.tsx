// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Blob as NodeBlob } from "node:buffer";
import ExcelJS from "exceljs";
import { afterEach, expect, it, vi } from "vitest";
import { UnduhLaporan } from "../UnduhLaporan";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

it("downloads real CSV and Excel with displayed columns, merged totals, summaries and applied filters", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Blob", NodeBlob);
  const blobs: NodeBlob[] = [];
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (blob: NodeBlob) => { blobs.push(blob); return "blob:report"; }, revokeObjectURL: () => {} }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  document.body.innerHTML = '<form><div><label>Dari</label><input name="dari" value="2026-10-01"></div></form><div id="controls"></div><div id="laporan-isi"><div data-report-row><span>Omzet</span><span>Rp 300</span></div><table><tr><th>Barang</th><th>Qty</th><th>Total</th></tr><tr><td>=obat</td><td>2</td><td>Rp 300</td></tr><tr><td colspan="2">TOTAL</td><td>Rp 300</td></tr></table><p>Data sesuai cabang Klinik A</p></div>';
  document.querySelector("input")!.value = "2026-10-07";
  const root = createRoot(document.getElementById("controls")!);
  await act(async () => root.render(<UnduhLaporan judul="Penjualan" />));
  await act(async () => (document.querySelectorAll("button")[0] as HTMLButtonElement).click());
  const csv = await blobs[0].text();
  expect(csv).toContain('"Dari","2026-10-01"');
  expect(csv).toContain('"Omzet","Rp 300"');
  expect(csv).toContain('"TOTAL","","Rp 300"');
  expect(csv).toContain("'=obat");
  expect(csv).toContain("Data sesuai cabang Klinik A");
  await act(async () => {
    (document.querySelectorAll("button")[1] as HTMLButtonElement).click();
    await vi.waitFor(() => expect(blobs).toHaveLength(2));
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await blobs[1].arrayBuffer()) as unknown as ExcelJS.Buffer);
  expect(book.getWorksheet("Tabel 1")!.getRow(3).getCell(3).value).toBe("Rp 300");
  expect(book.getWorksheet("Ringkasan")!.getRow(1).getCell(2).value).toBe("Rp 300");
  expect(book.getWorksheet("Filter laporan")!.getRow(3).getCell(2).value).toBe("2026-10-01");
  await act(async () => root.unmount());
});

it("opens a report-only print document with a clear save-PDF action and selected context", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const popup = { document: document.implementation.createHTMLDocument(), print: vi.fn(), opener: window };
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  document.body.innerHTML = '<div id="controls"></div><form><div><label>Cabang</label><select name="cabang"><option selected>Klinik A</option></select></div></form><div id="laporan-isi"><table><tr><th>Qty</th></tr><tr><td>1201</td></tr></table><p>Jumlah sesuai filter</p><div class="no-print">Kontrol aplikasi</div></div>';
  const root = createRoot(document.getElementById("controls")!);
  await act(async () => root.render(<UnduhLaporan judul="Laporan <klinik>" />));
  await act(async () => (document.querySelectorAll("button")[2] as HTMLButtonElement).click());
  expect(popup.document.body.textContent).toContain("Cabang: Klinik A");
  expect(popup.document.body.textContent).toContain("1201");
  expect(popup.document.body.textContent).not.toContain("Kontrol aplikasi");
  expect(popup.document.querySelector("h1")!.textContent).toBe("Laporan <klinik>");
  (popup.document.getElementById("cetak") as HTMLButtonElement).click();
  expect(popup.print).toHaveBeenCalledOnce();
  expect(popup.opener).toBeNull();
  await act(async () => root.unmount());
});
