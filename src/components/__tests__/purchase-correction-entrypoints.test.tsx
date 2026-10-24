import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const actor = vi.hoisted(() => ({ role: "OWNER", active: true, status: "Draft", received: false, advance: false, fractional: false }));
vi.mock("@/app/(app)/pembelian/[id]/POPriceCorrectionForm",()=>({POPriceCorrectionForm:({activeAdvances}:{activeAdvances:number})=> <button data-dp={activeAdvances}>Koreksi harga saja</button>}));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/dokumen/DokumenPanel", () => ({ DokumenPanel: () => null }));
vi.mock("@/app/(app)/pembelian/[id]/POCorrectionForm", () => ({ POEditForm: () => <button>Edit PO</button>, POCancelForm: () => <button>Cancel PO</button> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  from: (table: string) => {
    const data = table === "profiles" ? { role: actor.role, is_active: actor.active }
      : table === "purchase_orders" ? { id: "po", status: actor.status, revision: 0, tanggal: "2026-10-21", total: 100, branch_id: "branch", to_warehouse_id: "warehouse", purchase_advances: actor.fractional ? [{id:"dp-a",no_um:"A",status:"aktif",jumlah:0.1},{id:"dp-b",no_um:"B",status:"aktif",jumlah:0.2}] : actor.advance ? [{id:"advance",no_um:"FICT-DP",status:"aktif",jumlah:40,terpakai:0}] : [], purchase_order_items: actor.advance ? [{id:"line",nama:"Barang",qty:2,harga_beli:50,qty_terima:0}] : actor.received ? [{ id: "line", item_id: null, nama: "Barang", qty: 2, harga_beli: 100, qty_terima: 1 }] : [] } : table === "purchase_invoices" && actor.received ? [{ id: "invoice", no_faktur: "INV-1", voided_at: null }] : [];
    const query = { select: () => query, eq: () => query, order: () => query, maybeSingle: async () => ({ data }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data }).then(resolve) };
    return query;
  },
}) }));
import PODetailPage from "@/app/(app)/pembelian/[id]/page";
const render = async () => renderToStaticMarkup(await PODetailPage({ params: Promise.resolve({ id: "po" }), searchParams: Promise.resolve({}) }));
beforeEach(() => { actor.role = "OWNER"; actor.active = true; actor.status = "Draft"; actor.received = false; actor.advance = false; actor.fractional = false; });
it("shows PO correction controls to an active owner", async () => {
  expect(await render()).toContain("Edit PO");
});
it.each(["STAFF", "ADMIN", "inactive"])("hides owner-only PO correction controls for %s", async role => {
  if (role === "inactive") actor.active = false; else actor.role = role;
  const html = await render();
  expect(html).not.toContain("Edit PO");
  expect(html).not.toContain("Cancel PO");
});

it("received PO links to safe invoice correction instead of hiding all correction entrypoints", async () => {
  actor.status = "Diterima"; actor.received = true;
  const html = await render();
  expect(html).toContain('href="/pembelian/faktur/invoice"');
  expect(html).toContain("Koreksi faktur");
  expect(html).toContain("satuan");
  expect(html).not.toContain("Edit PO");
});
it("partially received PO explains why direct editing is blocked", async () => {
  actor.status = "Dipesan"; actor.received = true;
  const html = await render();
  expect(html).not.toContain("Edit PO");
  expect(html).toContain("transaksi turunan");
});

it("DP-only PO offers price correction without full edit or cancellation",async()=>{
 actor.advance=true;const html=await render();expect(html).toContain('href="#edit-po-prices"');expect(html).not.toContain('href="#edit-po"');expect(html).not.toContain('Cancel PO');expect(html).not.toContain('href="#purchase-correction"');
});

it('sums multiple cent advances exactly for the price cap preview',async()=>{actor.advance=true;actor.fractional=true;expect(await render()).toContain('data-dp="0.3"');});
