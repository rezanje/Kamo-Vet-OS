// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ preview: vi.fn(), validate: vi.fn(), save: vi.fn() }));
vi.mock("@/app/(app)/crm/promo/impor/actions", () => ({
  previewPromoExcel: (data: FormData) => actions.preview(data),
  validatePromoDraft: (rows: unknown, scope: unknown) => actions.validate(rows, scope),
  savePromoExcelBatch: (input: unknown) => actions.save(input),
}));
import { PromoImportWorkspace } from "@/app/(app)/crm/promo/impor/PromoImportWorkspace";

let host: HTMLDivElement, root: Root;
const finalRow = {
  line: 2, code: "FIKTIF-1", unit: "KG", discount_type: "final_price", discount_value: "36000", item_name: "Barang Fiktif Satu",
  error: null, normal_price: 38000, final_price: 36000, potongan: 2000, percent_off: 5.26, matched_unit: "KG",
};
const percentRow = { line: 3, code: "FIKTIF-2", unit: "400gr", discount_type: "percent", discount_value: "10", item_name: "Barang Fiktif Dua", error: null,
  normal_price: null, final_price: null, potongan: null, percent_off: null, matched_unit: "400gr" };
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.includes(label))!;
async function click(label: string) { await act(async () => { button(label).click(); }); }
async function chooseFile() {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "promo.xlsx")] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
async function fill(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  actions.preview.mockReset().mockResolvedValue({ rows: [finalRow, percentRow], valid: true });
  actions.validate.mockReset().mockImplementation(async (rows: typeof finalRow[]) => ({ rows, valid: true }));
  actions.save.mockReset().mockResolvedValue({ ok: true, message: "2 promo berhasil disimpan" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<PromoImportWorkspace branches={[{ id: "branch-1", name: "Cabang Fiktif" }]} today="2099-01-01" />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("explains Harga Akhir and its nominal-storage limitation in Indonesian", () => {
  expect(text()).toContain("Harga Akhir");
  expect(text()).toContain("Harga akhir promo per barang dan satuan");
  expect(text()).toMatch(/disimpan sebagai potongan nominal/);
  expect(text()).toMatch(/harga normal diubah.*bergeser/);
  expect(text()).toMatch(/Persen\/Nominal\/Harga Akhir/);
  expect(text()).toMatch(/selisih.*rupiah bulat/);
  expect(text()).toMatch(/golongan pelanggan.*lebih rendah dari Harga Akhir/);
  expect(text()).toMatch(/satu promo.*terbesar/);
});

it("shows item, unit, normal price, final price, potongan and percent off for a Harga Akhir preview row", async () => {
  await chooseFile(); await click("Baca dan preview");
  const headers = [...host.querySelectorAll("th")].map(th => th.textContent);
  expect(headers).toEqual(expect.arrayContaining(["Barang", "Satuan", "Harga normal", "Harga akhir", "Potongan", "% diskon"]));
  const cells = [...host.querySelectorAll("tbody tr")[0].querySelectorAll("td")].map(td => td.textContent ?? "");
  const joined = cells.join("|");
  expect(joined).toContain("Barang Fiktif Satu");
  expect(joined).toContain("Satuan cocok: KG");
  expect(joined).toMatch(/Rp\s?38\.000/);
  expect(joined).toMatch(/Rp\s?36\.000/);
  expect(joined).toMatch(/Rp\s?2\.000/);
  expect(joined).toMatch(/5,26\s?%/);
  const second = [...host.querySelectorAll("tbody tr")[1].querySelectorAll("td")].map(td => td.textContent ?? "");
  expect(second.filter(value => value === "—").length).toBeGreaterThanOrEqual(4);
});

it("offers Harga Akhir in the Jenis Diskon select and sends branch scope with revalidation", async () => {
  await chooseFile(); await click("Baca dan preview");
  const select = host.querySelector<HTMLSelectElement>('[aria-label="Jenis diskon baris 2"]')!;
  expect([...select.options].map(option => option.textContent)).toEqual(expect.arrayContaining(["Persen", "Nominal", "Harga Akhir"]));
  expect(select.value).toBe("final_price");
  await act(async () => host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click());
  await click("Validasi ulang");
  expect(actions.validate).toHaveBeenLastCalledWith(expect.any(Array), { allBranches: false, branchIds: ["branch-1"] });
});

it("passes the branch scope to preview and invalidates a reviewed Harga Akhir batch when the branches change", async () => {
  await act(async () => host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click());
  await chooseFile(); await click("Baca dan preview");
  const form = actions.preview.mock.calls[0][0] as FormData;
  expect(form.getAll("branchId")).toEqual(["branch-1"]);
  expect(button("Simpan seluruh batch").disabled).toBe(false);
  await act(async () => host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click());
  expect(button("Simpan seluruh batch").disabled).toBe(true);
  expect(text()).toMatch(/Cabang berubah.*Validasi ulang/);
});

it("keeps the save bound to the reviewed normal price and clears derived values after an edit", async () => {
  await act(async () => host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click());
  await chooseFile(); await click("Baca dan preview");
  await fill(host.querySelector<HTMLInputElement>('input[maxlength="40"]')!, "Promo test");
  await fill(host.querySelectorAll<HTMLInputElement>('input[type="date"]')[1], "2099-01-31");
  await click("Simpan seluruh batch");
  expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({
    rows: [expect.objectContaining({ code: "FIKTIF-1", discount_type: "final_price", normal_price: 38000 }), expect.anything()],
  }));
  actions.save.mockClear();
  await fill(host.querySelector<HTMLInputElement>('[aria-label="Nilai diskon baris 2"]')!, "35000");
  expect(host.querySelector("tbody tr")!.textContent).not.toMatch(/Rp\s?38\.000/);
  expect(button("Simpan seluruh batch").disabled).toBe(true);
});

it("still shows rejected Harga Akhir rows with their message and blocks saving", async () => {
  actions.preview.mockResolvedValue({ rows: [{ ...finalRow, error: "Harga akhir sama dengan harga normal (Rp38.000): tidak ada potongan", potongan: null, percent_off: null, final_price: null }], valid: false });
  await chooseFile(); await click("Baca dan preview");
  expect(text()).toContain("tidak ada potongan");
  expect(button("Simpan seluruh batch").disabled).toBe(true);
});

const WARNING = "HPP master belum terisi; harga akhir belum bisa dicek terhadap modal. Kasir petshop dan klinik menolak penjualan di bawah HPP FIFO; transaksi back office (/pos/transaksi) hanya memberi peringatan yang bisa dikonfirmasi (tanpa peringatan bila HPP FIFO tidak terbaca).";
const warnRow = (line: number, code: string) => ({ ...finalRow, line, code, item_name: `Barang ${code}`, warning: WARNING });

it("help text says missing master HPP is a warning and the cashier still enforces FIFO", () => {
  expect(text()).toMatch(/belum terisi[^.]*peringatan/);
  expect(text()).toMatch(/[Kk]asir petshop dan klinik menolak penjualan di bawah HPP FIFO/);
  expect(text()).toContain("transaksi back office (/pos/transaksi) hanya memberi peringatan yang bisa dikonfirmasi");
  expect(text()).not.toMatch(/[Kk]asir tetap menolak/);
  expect(text()).not.toMatch(/ditolak bila[^.]*HPP[^.]*belum terisi/);
  expect(text()).toContain("Modal satuan turunan = harga beli barang dasar × faktor satuan, seperti kasir");
  expect(text()).not.toContain("Satuan turunan tanpa harga beli sendiri");
});

it("shows an amber warning (not red, not an error) on warning rows, a count above Save, and keeps Save enabled", async () => {
  actions.preview.mockResolvedValue({ rows: [warnRow(2, "A-1"), warnRow(3, "A-2"), percentRow], valid: true, warningCount: 2 });
  await chooseFile(); await click("Baca dan preview");
  const cell = [...host.querySelectorAll("tbody tr")[0].querySelectorAll("td")].pop() as HTMLElement;
  expect(cell.textContent).toContain(WARNING);
  expect(cell.textContent).not.toMatch(/^Valid$/);
  expect(cell.style.color).not.toBe("rgb(185, 28, 28)");
  expect(cell.style.color).not.toBe("rgb(21, 128, 61)");
  expect(cell.style.color).toBe("rgb(180, 83, 9)");
  const last = [...host.querySelectorAll("tbody tr")[2].querySelectorAll("td")].pop() as HTMLElement;
  expect(last.textContent).toBe("Valid");
  const notice = host.querySelector('[data-testid="promo-warning-count"]') as HTMLElement;
  expect(notice.textContent).toContain("2 baris tanpa HPP master");
  expect(notice.compareDocumentPosition(button("Simpan seluruh batch")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(button("Simpan seluruh batch").disabled).toBe(false);
  expect(host.querySelectorAll('input[type="checkbox"]').length).toBe(2); // only the branch checkboxes: no confirmation checkbox
});

it("shows no warning count when no row has a warning, and error rows stay red and block Save", async () => {
  await chooseFile(); await click("Baca dan preview");
  expect(host.querySelector('[data-testid="promo-warning-count"]')).toBeNull();
  actions.preview.mockResolvedValue({ rows: [warnRow(2, "A-1"), { ...finalRow, line: 3, error: "Harga akhir Rp7.000 di bawah HPP/harga beli master Rp8.000" }], valid: false });
  await click("Baca dan preview");
  const cells = [...host.querySelectorAll("tbody tr")].map(tr => [...tr.querySelectorAll("td")].pop() as HTMLElement);
  expect(cells[1].style.color).toBe("rgb(185, 28, 28)");
  expect(button("Simpan seluruh batch").disabled).toBe(true);
});

it("editing a warning row clears its warning until it is validated again; saving reports the server message", async () => {
  actions.preview.mockResolvedValue({ rows: [warnRow(2, "A-1")], valid: true, warningCount: 1 });
  actions.save.mockResolvedValue({ ok: true, message: "1 promo berhasil disimpan. 1 baris tanpa HPP master.", warningCount: 1 });
  await chooseFile(); await click("Baca dan preview");
  await fill(host.querySelector<HTMLInputElement>('input[maxlength="40"]')!, "Promo test");
  await fill(host.querySelectorAll<HTMLInputElement>('input[type="date"]')[1], "2099-01-31");
  await click("Simpan seluruh batch");
  expect(text()).toContain("1 baris tanpa HPP master.");
  actions.preview.mockResolvedValue({ rows: [warnRow(2, "A-1")], valid: true, warningCount: 1 });
  await click("Baca dan preview");
  await fill(host.querySelector<HTMLInputElement>('[aria-label="Nilai diskon baris 2"]')!, "35000");
  expect(text()).not.toContain(WARNING);
  expect(host.querySelector('[data-testid="promo-warning-count"]')).toBeNull();
  expect(button("Simpan seluruh batch").disabled).toBe(true);
});
