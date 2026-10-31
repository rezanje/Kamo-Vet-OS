vi.mock("@/lib/service-performers-server",async(importOriginal)=>{
  const actual=await importOriginal<typeof import("../service-performers-server")>();
  return {...actual,loadServiceStaff:async(...args:Parameters<typeof actual.loadServiceStaff>)=>fixture.realStaff?actual.loadServiceStaff(...args):[],loadBranchGroomingPolicy:async()=>({applies:true,doctorRequired:true})};
});
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cocokOr } from "./helpers/postgrest-or";

const fixture = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, failed: "", realStaff:false }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from(table: string) {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let from = 0; let to = 999; let counted = false; let fields = "";let missingColumn=false;
    const assignmentColumns=new Set(['employee_id','branch_id','role','effective_date','end_date','created_at']);
    const q = {
      select(selectedFields: string, opts?: { count: string }) { fields = selectedFields; counted = opts?.count === "exact";if(table==='employee_branch_assignments')missingColumn=fields.split(',').some(field=>!assignmentColumns.has(field.split(':').at(-1)!.trim()));return q; },
      eq(k: string, v: unknown) { filters.push(r => r[k] === v); return q; },
      neq(k: string, v: unknown) { filters.push(r => r[k] !== v); return q; },
      lte(k:string,v:unknown){filters.push(r=>String(r[k])<=String(v));return q;},
      in(k: string, values: unknown[]) { filters.push(r => values.includes(r[k])); return q; },
      or(expression: string) {
        if (expression.startsWith("end_date.")) { filters.push(row => cocokOr(row, expression)); return q; }
        const alternatives = expression.match(/category_id\.in\.\([^)]+\)|name\.ilike\.[^,]+/g) ?? [];
        filters.push(row => alternatives.some(filter => filter.startsWith("category_id.in.")
          ? filter.slice("category_id.in.(".length, -1).split(",").includes(String(row.category_id))
          : String(row.name).toLowerCase().startsWith(filter.slice("name.ilike.".length).replace(/\*$/, "").toLowerCase())));
        return q;
      },
      order(column:string) { if(table==='employee_branch_assignments'&&!assignmentColumns.has(column))missingColumn=true;return q; },
      limit(n: number) { to = n - 1; return q; },
      range(a: number, b: number) { from = a; to = b; return q; },
      maybeSingle: async () => ({ data: fixture.failed === table ? null : (fixture.tables[table] ?? []).find(r => filters.every(f => f(r))) ?? null, error: fixture.failed === table ? { message: "secret detail" } : null }),
      single: async () => ({ data: (fixture.tables[table] ?? [])[0] ?? null, error: null }),
      then(resolve: (v: unknown) => void) {
        if(missingColumn)return Promise.resolve({data:null,count:null,error:{code:'42703',message:'column id does not exist'}}).then(resolve);
        const rows = (fixture.tables[table] ?? []).filter(r => filters.every(f => f(r)));
        const data = rows.slice(from, to + 1).map(row => table === "items"||table==='employee_branch_assignments'
          ? Object.fromEntries(fields.split(",").map(field => {const [alias,column]=field.trim().split(':');return [alias,row[column??alias]];})) : row);
        return Promise.resolve({ data: fixture.failed === table ? null : data, count: counted ? rows.length : null, error: fixture.failed === table ? { message: "secret detail" } : null }).then(resolve);
      },
    };
    return q;
  },
}) }));
vi.mock("@/lib/dokter", () => ({ daftarDokter: async () => [] }));
vi.mock("@/lib/rombongan-server", () => ({ bacaSaudaraKunjungan: async () => [] }));
vi.mock("@/lib/consent", async () => ({...await import("../consent"), templatesForBranch: () => [] }));
vi.mock("../../app/(app)/klinik/rekam-medis/[visitId]/RekamForm", () => ({ RekamForm: () => null }));
vi.mock("../../app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm", () => ({ CatatanForm: () => null }));
vi.mock("../../app/(app)/klinik/rekam-medis/[visitId]/RacikanInline", () => ({ RacikanInline: () => null }));
vi.mock("../../app/(app)/klinik/rawat-inap/actions", () => ({ admitInpatient: vi.fn() }));
import ExamPage from "../../app/(app)/klinik/rekam-medis/[visitId]/page";
import InpatientPage from "../../app/(app)/klinik/rawat-inap/[id]/catatan/page";
import InpatientMedicinePage from "../../app/(app)/klinik/rawat-inap/[id]/obat-khusus/page";

function formProps(node: React.ReactNode): Record<string, unknown> | undefined {
  if (!React.isValidElement<Record<string, unknown>>(node)) return;
  if ("katalogRacikan" in node.props) return node.props;
  for (const child of React.Children.toArray(node.props.children as React.ReactNode)) {
    const result = formProps(child); if (result) return result;
  }
}
beforeEach(() => {
  fixture.failed = "";
  fixture.realStaff=false;
  const visit = { id: "visit", pet_id: "pet", branch_id: "branch", status: "Diperiksa", created_at: "2026-10-05T00:00:00Z", pets: { name: "Fictional", species: "Kucing" }, customers: { name: "Fictional owner" } };
  fixture.tables = {
    profiles: [{ id: "owner", role: "OWNER" }], visits: [visit],
    inpatient_records: [{ id: "inpatient", visit_id: "visit", condition_status: "stable", admitted_at: visit.created_at, visits: visit }],
    warehouses: [{ id: "retail", branch_id: "branch", type: "RETAIL", is_active: true }, { id: "warehouse", branch_id: "branch", type: "VET", is_active: true }],
    item_categories: [{ id: "cat", name: "OBAT RACIK" }, { id: "services", name: "Jasa" }],
    items: [
      ...Array.from({ length: 550 }, (_, i) => ({ id: `ordinary-${i}`, name: `A ordinary ${i}`, is_active: true, is_compound_material: false, item_type: "Persediaan", category_id: "ordinary", unit: "PCS", sell_price: 1000 })),
      { id: "racik", name: "Obat Racik Sirup Flu", is_active: true, is_compound_material: false, item_type: "Persediaan", category_id: "cat", unit: "PCS", sell_price: 20000 },
      { id: "inactive", name: "Nonaktif", is_active: false, is_compound_material: false, item_type: "Persediaan", category_id: "cat" },
      { id: "material", name: "Bahan", is_active: true, is_compound_material: true, item_type: "Persediaan", category_id: "cat" },
      { id: "service", name: "Jasa", is_active: true, is_compound_material: false, item_type: "Jasa", category_id: "services" },
    ],
    stock: [{ id: "stock", warehouse_id: "warehouse", item_id: "racik", qty: 8 }, { id: "foreign", warehouse_id: "other-branch", item_id: "racik", qty: 99 }],
    item_branch_prices: [{ id: "price", item_id: "racik", branch_id: "branch", unit: "PCS", sell_price: 25000 }],
  };
});
const exam = () => ExamPage({ params: Promise.resolve({ visitId: "visit" }), searchParams: Promise.resolve({}) });
const inpatient = () => InpatientPage({ params: Promise.resolve({ id: "inpatient" }) });
describe("compound master SKUs reach clinic POS", () => {
  it('actual OBAT KHUSUS route supplies billable mode and same stay/stock/catalogue while daily route supplies clinical mode',async()=>{
    const props=formProps(await InpatientMedicinePage({params:Promise.resolve({id:'inpatient'})}));
    expect(props).toMatchObject({mode:'billables',recordId:'inpatient',backHref:'/klinik/rawat-inap/inpatient'});
    expect(props?.racikanItems).toEqual(expect.arrayContaining([expect.objectContaining({id:'racik',stok:8,sell_price:25000})]));
    expect(formProps(await inpatient())?.mode).toBe('clinical');
  });
  it('opens an in-progress medical visit using the real staff reader against assignment columns without a synthetic id',async()=>{
    fixture.realStaff=true;
    fixture.tables.employees=[{id:'own',nama:'Fictional doctor',jabatan:'Dokter',status:'Aktif',branch_id:'branch'},{id:'assigned',nama:'Fictional nurse',jabatan:'Paramedis',status:'Aktif',branch_id:'other'}];
    fixture.tables.employees.push({id:'ended',nama:'Fictional helper',jabatan:'Paramedis',status:'Aktif',branch_id:'other'});
    fixture.tables.employee_branch_assignments=[
      {employee_id:'assigned',branch_id:'branch',role:'SECONDARY',effective_date:'2020-01-01',end_date:null},
      // T2: penugasan yang sudah berakhir tidak boleh lagi muncul sebagai pelaksana.
      {employee_id:'ended',branch_id:'branch',role:'SECONDARY',effective_date:'2020-01-01',end_date:'2020-06-30'},
    ];
    const props=formProps(await exam());
    expect(props?.serviceStaff).toEqual(expect.arrayContaining([expect.objectContaining({id:'own'}),expect.objectContaining({id:'assigned'})]));
    expect(props?.serviceStaff).toHaveLength(2);
  });
  it('loads assignment pages beyond 500 while preserving branch, active and effective-date eligibility',async()=>{
    fixture.realStaff=true;
    fixture.tables.employees=Array.from({length:605},(_,i)=>({id:`staff-${i}`,nama:`Fictional ${i}`,jabatan:'Paramedis',status:i===603?'Nonaktif':'Aktif',branch_id:'other'}));
    fixture.tables.employee_branch_assignments=fixture.tables.employees.map((row,i)=>({employee_id:row.id,branch_id:i===604?'other':'branch',effective_date:i===602?'2099-01-01':'2020-01-01',role:'SECONDARY',end_date:i===601?'2020-06-30':null}));
    const staff=formProps(await exam())?.serviceStaff as {id:string}[];
    expect(staff).toHaveLength(601);expect(staff.map(row=>row.id)).toContain('staff-600');
    for(const id of ['staff-601','staff-602','staff-603','staff-604'])expect(staff.map(row=>row.id)).not.toContain(id);
  });
  it.each([["exam", exam], ["inpatient", inpatient]] as const)("%s supplies separate code and name for every clinical picker", async (_name, page) => {
    fixture.tables.items.forEach(row => { row.code = `CODE-${row.id}`; });
    const props = formProps(await page());
    expect(props?.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: "ordinary-549", name: "A ordinary 549", code: "CODE-ordinary-549" })]));
    expect(props?.jasaItems).toEqual([expect.objectContaining({ id: "service", name: "Jasa", code: "CODE-service" })]);
    expect(props?.bahanItems).toEqual([expect.objectContaining({ id: "material", name: "Bahan", code: "CODE-material" })]);
    expect(props?.racikanItems).toEqual([expect.objectContaining({ id: "racik", name: "Obat Racik Sirup Flu", code: "CODE-racik" })]);
  });
  it.each([["exam", exam], ["inpatient", inpatient]] as const)("%s sends inventory barcodes to the medicine search", async (_name, page) => {
    fixture.tables.items[0].upc = "8900012345678";
    const props = formProps(await page());
    expect(props?.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: "ordinary-0", upc: "8900012345678" })]));
  });
  it.each([["exam", exam], ["inpatient", inpatient]] as const)("%s lists active finished compounds in child racikan categories only", async (_name, page) => {
    fixture.tables.item_categories.push({ id: "cat-child", name: "Sirup", parent_id: "cat" });
    fixture.tables.items.push(
      { id: "child-compound", name: "Sirup batuk fiktif", is_active: true, is_compound_material: false, item_type: "Persediaan", category_id: "cat-child", unit: "PCS", sell_price: 18000 },
      { id: "child-material", name: "Bahan sirup fiktif", is_active: true, is_compound_material: true, item_type: "Persediaan", category_id: "cat-child", unit: "PCS", sell_price: 1000 },
      { id: "child-inactive", name: "Sirup lama fiktif", is_active: false, is_compound_material: false, item_type: "Persediaan", category_id: "cat-child", unit: "PCS", sell_price: 18000 },
    );
    const props = formProps(await page());
    const compoundIds = (props?.racikanItems as { id: string }[]).map(item => item.id);
    expect(compoundIds).toContain("child-compound");
    expect(compoundIds).not.toContain("child-material");
    expect(compoundIds).not.toContain("child-inactive");
    expect((props?.items as { id: string }[]).map(item => item.id)).not.toContain("child-compound");
  });
  it("does not reopen the editable initial form for a recorded visit", async () => {
    fixture.tables.visits[0].status = "Pembayaran";
    expect(formProps(await exam())).toBeUndefined();
  });
  it("includes inventory ingredients but keeps services out of the inpatient medicine picker", async () => {
    const props = formProps(await inpatient());
    expect((props?.items as { id: string }[]).map(item => item.id)).toContain("material");
    expect((props?.items as { id: string }[]).map(item => item.id)).not.toContain("service");
    expect(props?.bahanItems).toEqual([expect.objectContaining({ id: "material" })]);
  });
  it.each([["exam", exam], ["inpatient", inpatient]] as const)("%s loads every ordinary medicine with units beyond the old limit", async (_name, page) => {
    const ordinary = Array.from({ length: 1250 }, (_, i) => ({ id: `medicine-${i}`, name: `Medicine ${i}`, is_active: true, is_compound_material: false, item_type: "Persediaan", category_id: "ordinary", unit: "ml", sell_price: 1000 }));
    fixture.tables.items = ordinary;
    fixture.tables.item_units = [{ id: "late-unit", item_id: "medicine-1249", unit: "btl", factor: 50, sell_price: 40000, buy_price: 10000 }];
    fixture.tables.item_branch_prices = [{ id: "late-price", item_id: "medicine-1249", unit: "btl", branch_id: "branch", sell_price: 45000 }];
    const props = formProps(await page());
    expect(props?.items).toHaveLength(1250);
    expect((props?.items as { id: string; units: unknown[] }[]).find(item => item.id === "medicine-1249")?.units)
      .toEqual(expect.arrayContaining([expect.objectContaining({ unit: "btl", factor: 50, sell_price: 45000 })]));
  });
  it.each([["exam", exam], ["inpatient", inpatient]] as const)("%s keeps late-page inventory ingredients with branch stock/price and active-state filtering", async (_name, page) => {
    const base = { is_active: true, is_compound_material: true, item_type: "Persediaan", category_id: "worm", unit: "tablet", sell_price: 1000 };
    fixture.tables.item_categories.push({ id: "medicine", name: "OBAT & VITAMIN" }, { id: "worm", name: "OBAT CACING", parent_id: "medicine" });
    fixture.tables.items.push(
      ...Array.from({ length: 655 }, (_, i) => ({ ...base, id: `ingredient-${i}`, name: `Medicine ${i}` })),
      { ...base, id: "anthel", name: "Anthel fixture" },
      { ...base, id: "zero-stock", name: "Anthel zero stock" },
      { ...base, id: "archived", name: "Anthel archived", is_active: false },
    );
    fixture.tables.stock.push({ id: "anthel-stock", item_id: "anthel", warehouse_id: "warehouse", qty: 50 },
      { id: "retail-stock", item_id: "anthel", warehouse_id: "retail", qty: 900 },
      { id: "other-stock", item_id: "zero-stock", warehouse_id: "other-branch", qty: 700 });
    fixture.tables.item_branch_prices.push({ id: "anthel-price", item_id: "anthel", branch_id: "branch", unit: "tablet", sell_price: 2500 },
      { id: "other-price", item_id: "anthel", branch_id: "other-branch", unit: "tablet", sell_price: 99000 });
    const props = formProps(await page());
    const medicines = props?.items as { id: string }[];
    expect(medicines).toContainEqual(expect.objectContaining({ id: "anthel", stok: 50, sell_price: 2500 }));
    expect(medicines).toContainEqual(expect.objectContaining({ id: "zero-stock", stok: 0, sell_price: 1000 }));
    expect(medicines).toContainEqual(expect.objectContaining({ id: "ingredient-654" }));
    expect(medicines.map(row => row.id)).not.toContain("archived");
    expect(props?.bahanItems).toContainEqual(expect.objectContaining({ id: "anthel" }));
  });
  it.each([["exam", exam], ["inpatient", inpatient]] as const)("%s exposes an active compound SKU beyond the old master limit with branch price and stock", async (_name, page) => {
    const props = formProps(await page());
    expect(props?.racikanItems).toEqual([expect.objectContaining({ id: "racik", sell_price: 25000, stok: 8, unit: "PCS" })]);
    expect((props?.items as { id: string }[]).some(i => i.id === "racik")).toBe(false);
    expect(props?.katalogRacikan).toEqual([]);
  });
  it("keeps stock, branch price and extra units for SKUs beyond 1000 enrichment rows", async () => {
    const compounds = Array.from({ length: 1010 }, (_, i) => ({ id: `compound-${i}`, name: `ZZ ${i}`, is_active: true, is_compound_material: false, item_type: "Persediaan", category_id: "cat", unit: "PCS", sell_price: 1000 }));
    fixture.tables.items.push(...compounds);
    for (const item of compounds) {
      fixture.tables.stock.push({ id: `stock-${item.id}`, item_id: item.id, warehouse_id: "warehouse", qty: 9 });
      fixture.tables.item_branch_prices.push({ id: `price-${item.id}`, item_id: item.id, branch_id: "branch", unit: "PCS", sell_price: 2000 });
    }
    fixture.tables.item_units = compounds.map(item => ({ id: `unit-${item.id}`, item_id: item.id, unit: "box", factor: 10, sell_price: 15000, buy_price: 10000 }));
    const props = formProps(await exam());
    const last = (props?.racikanItems as { id: string; stok: number; sell_price: number; units: unknown[] }[]).find(item => item.id === "compound-1009");
    expect(last).toMatchObject({ stok: 9, sell_price: 2000, units: expect.arrayContaining([expect.objectContaining({ unit: "box", factor: 10 })]) });
  });
  it("includes legacy Obat Racik names stored in other master categories", async () => {
    fixture.tables.items.push({ id: "legacy", name: "Obat Racik Salep Jamur", is_active: true, is_compound_material: false, item_type: "Persediaan", category_id: "other", unit: "PCS", sell_price: 10000 });
    const props = formProps(await exam());
    expect(props?.racikanItems).toEqual(expect.arrayContaining([expect.objectContaining({ id: "legacy" })]));
  });
  it("finds legacy named compound SKUs even without a compound category", async () => {
    fixture.tables.item_categories = [];
    expect(formProps(await exam())?.racikanItems).toEqual([expect.objectContaining({ id: "racik" })]);
  });
  it.each([["category", "item_categories"], ["SKU", "items"], ["warehouse", "warehouses"], ["stock", "stock"], ["unit", "item_units"], ["branch price", "item_branch_prices"]])("fails visibly when the %s source cannot be read", async (_name, table) => {
    fixture.failed = table;
    const result = await exam().then(() => null, error => error as Error);
    expect(result).toBeInstanceOf(Error);
    expect(result?.message).toMatch(/belum.*dimuat/i);
    expect(result?.message).not.toContain("secret detail");
  });
});


describe("clinic item categories", () => {
  it.each([["exam", exam], ["inpatient", inpatient]] as const)("%s prioritizes explicit clinic categories and falls back to service type", async (_name, page) => {
    fixture.tables.item_categories.push(
      { id: "actions", name: " TINDAKAN " },
      { id: "surgery", name: "Operasi", parent_id: "actions" },
      { id: "food", name: "Makanan" },
    );
    const base = { is_active: true, is_compound_material: false, unit: "pcs", sell_price: 35000 };
    fixture.tables.items = [
      { ...base, id: "consult", name: "Konsultasi", item_type: "Jasa", category_id: "services" },
      { ...base, id: "steril", name: "Steril", item_type: "Jasa", category_id: "surgery", tindakan_kategori: "Operasi" },
      { ...base, id: "scaling", name: "Scaling", item_type: "Jasa", category_id: "actions" },
      { ...base, id: "vaccine", name: "Vaksin", item_type: "Jasa", category_id: "vaccine" },
      { ...base, id: "lab", name: "Cek darah", item_type: "Jasa", category_id: "lab" },
      { ...base, id: "food", name: "Makanan kucing", item_type: "Persediaan", category_id: "food" },
      { ...base, id: "group", name: "Grouping", item_type: "Grup", category_id: "food" },
      { ...base, id: "uncategorized", name: "Tanpa kategori", item_type: "Persediaan", category_id: null },
      { ...base, id: "ingredient", name: "Bahan racik", item_type: "Persediaan", category_id: "food", is_compound_material: true },
    ];
    fixture.tables.item_branch_prices = [{ id: "steril-price", item_id: "steril", branch_id: "branch", unit: "pcs", sell_price: 75000 }];
    const props = formProps(await page());
    const ids = (key: string) => (props?.[key] as { id: string }[]).map(item => item.id);
    expect(ids("jasaItems")).toEqual(["consult", "vaccine", "lab"]);
    expect(ids("tindakanItems")).toEqual(["steril", "scaling"]);
    expect(ids("items")).toEqual(["food", "uncategorized", "ingredient"]);
    expect(ids("bahanItems")).toEqual(["ingredient"]);
    expect(props?.tindakanItems).toEqual(expect.arrayContaining([expect.objectContaining({ id: "steril", sell_price: 75000, tindakan_kategori: "Operasi" })]));
  });

  it.each([["exam", exam], ["inpatient", inpatient]] as const)("%s exposes imported services without a literal Jasa ancestor and preserves pricing metadata", async (_name, page) => {
    fixture.tables.item_categories = [
      { id: "consult-category", name: "KONSULTASI" },
      { id: "actions", name: "Tindakan" }, { id: "medicine", name: "Obat" },
      { id: "vaccine", name: "Vaksin", parent_id: "medicine" },
    ];
    const base = { is_active: true, is_compound_material: false, unit: "kali", sell_price: 35000, item_type: "Jasa", tindakan_kategori: "Konsultasi" };
    fixture.tables.items = [
      { ...base, id: "imported-service", name: "Konsultasi fiktif", category_id: "consult-category" },
      { ...base, id: "uncategorized-service", name: "Jasa tanpa kategori", category_id: null },
      { ...base, id: "inactive-service", name: "Jasa nonaktif", category_id: "consult-category", is_active: false },
      { ...base, id: "action", name: "Tindakan fiktif", category_id: "actions", tindakan_kategori: "Operasi" },
      { ...base, id: "vaccine", name: "Vaksin fiktif", category_id: "vaccine" },
      { ...base, id: "stock", name: "Barang fiktif", category_id: "consult-category", item_type: "Persediaan" },
    ];
    fixture.tables.item_branch_prices = [{ id: "consult-price", item_id: "imported-service", branch_id: "branch", unit: "kali", sell_price: 45000 }];
    fixture.tables.item_units = [{ id: "consult-unit", item_id: "imported-service", unit: "paket", factor: 2, sell_price: 80000, buy_price: 0 }];
    const props = formProps(await page());
    const ids = (key: string) => (props?.[key] as { id: string }[]).map(sku => sku.id);
    expect(ids("jasaItems")).toEqual(["imported-service", "uncategorized-service", "vaccine"]);
    expect(ids("tindakanItems")).toEqual(["action"]);
    expect(ids("items")).toEqual(["stock"]);
    expect(props?.jasaItems).toContainEqual(expect.objectContaining({
      id: "imported-service", item_type: "Jasa", tindakan_kategori: "Konsultasi", sell_price: 45000,
      units: expect.arrayContaining([expect.objectContaining({ unit: "paket", factor: 2, sell_price: 80000 })]),
    }));
  });
});

// Paket B: stok yang belum terbaca tidak boleh sampai ke layar sebagai angka 0.
describe("clinic input paths keep unread stock distinct from zero", () => {
  const obatKhusus = () => InpatientMedicinePage({ params: Promise.resolve({ id: "inpatient" }) });
  it.each([["exam", exam], ["inpatient", inpatient], ["obat-khusus", obatKhusus]] as const)("%s: branch without an active clinic warehouse sends null stock, not 0 or another warehouse", async (_name, page) => {
    fixture.tables.warehouses = fixture.tables.warehouses.filter(row => row.type !== "VET");
    const props = formProps(await page());
    const lists = ["items", "racikanItems", "bahanItems"].map(key => props?.[key] as { id: string; stok: unknown }[]);
    expect(lists.flat().length).toBeGreaterThan(0);
    for (const item of lists.flat()) expect(item.stok, item.id).toBeNull();
  });
  it("racikan susulan (Detail rekam medis / Ubah komposisi): material and compound readers keep unread stock as null", async () => {
    const { bahanRacikanUntukKunjungan, obatRacikUntukKunjungan } = await import("../../app/(app)/klinik/racik/actions");
    expect((await bahanRacikanUntukKunjungan("visit")).find(row => row.id === "material")).toMatchObject({ stok: 0 });
    expect((await obatRacikUntukKunjungan("visit")).find(row => row.id === "racik")).toMatchObject({ stok: 8 });
    fixture.tables.warehouses = fixture.tables.warehouses.filter(row => row.type !== "VET");
    expect((await bahanRacikanUntukKunjungan("visit")).find(row => row.id === "material")).toMatchObject({ stok: null });
    expect((await obatRacikUntukKunjungan("visit")).find(row => row.id === "racik")).toMatchObject({ stok: null });
  });
});
