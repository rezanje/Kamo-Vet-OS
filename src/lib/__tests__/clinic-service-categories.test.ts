import ExcelJS from "exceljs";
import { expect, it } from "vitest";
import { splitClinicItems } from "../clinic-item-categories";
import { bacaWorkbookAccurate, buatPayloadItemAccurate } from "../impor-accurate";

const item = (id: string, category_id: string | null, item_type = "Jasa") => ({
  id, category_id, item_type, is_compound_material: false,
});

it("keeps an Accurate SVC in Jasa when its imported category is Konsultasi", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Barang & Jasa");
  sheet.addRow(["Kode Barang", "Nama Barang", "Jenis Barang", "Kategori Barang", "Subkategori", "Satuan", "Def. Hrg. Jual Satuan #1"]);
  sheet.addRow(["FIX-SVC", "Konsultasi fiktif", "SVC", "KONSULTASI", "KONSULTASI", "JASA", 35000]);
  const parsed = await bacaWorkbookAccurate(new Uint8Array(await workbook.xlsx.writeBuffer()));
  expect(parsed.errors).toEqual([]);
  expect(parsed.rows).toHaveLength(1);
  const payload = buatPayloadItemAccurate(parsed.rows[0], { category_id: "consult", brand_id: null, supplier_id: null });
  const sku = { ...payload, id: "fiction-service", is_compound_material: false };
  const groups = splitClinicItems([sku], [{ id: "consult", name: "KONSULTASI" }], new Set());
  expect(groups.jasa).toEqual([sku]);
  expect(groups.obat).toEqual([]);
  expect(groups.jasa[0]).toMatchObject({ item_type: "Jasa", sell_price: 35000, unit: "JASA", tindakan_kategori: "Konsultasi" });
});

it("uses service type for categories that are absent, missing, or cyclic without matching names heuristically", () => {
  const skus = [item("none", null), item("missing", "missing"), item("cycle", "a"), item("named", "other")];
  const categories = [{ id: "a", name: "A", parent_id: "b" }, { id: "b", name: "B", parent_id: "a" }, { id: "other", name: "JASA KLINIK" }];
  expect(splitClinicItems(skus, categories, new Set()).jasa).toEqual(skus);
});

it("lets explicit clinic categories and their nearest ancestors override the fallback", () => {
  const categories = [
    { id: "service", name: " JASA " }, { id: "action", name: "Tindakan", parent_id: "service" },
    { id: "surgery", name: "Operasi", parent_id: "action" }, { id: "medicine", name: "Obat" },
    { id: "vaccine", name: "Vaksin", parent_id: "medicine" },
  ];
  const service = item("inventory-in-service", "service", "Persediaan");
  const action = item("surgery", "surgery");
  const vaccine = item("vaccine", "vaccine");
  const groups = splitClinicItems([service, action, vaccine], categories, new Set());
  expect(groups.jasa).toEqual([service]);
  expect(groups.tindakan).toEqual([action]);
  expect(groups.obat).toEqual([vaccine]);
});

it("keeps ordinary stock, compounds, and ingredients out of fallback service results", () => {
  const stock = item("stock", null, "Persediaan");
  const compound = item("compound", null, "Persediaan");
  const ingredient = { ...item("ingredient", null, "Persediaan"), is_compound_material: true };
  const groups = splitClinicItems([stock, compound, ingredient], [], new Set([compound.id]));
  expect(groups.jasa).toEqual([]);
  expect(groups.obat).toEqual([stock]);
  expect(groups.racikan).toEqual([compound]);
  expect(groups.bahan).toEqual([ingredient]);
});
