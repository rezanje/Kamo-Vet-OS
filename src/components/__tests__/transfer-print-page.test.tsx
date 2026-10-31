import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import printStyles from "@/app/(app)/pos/pemindahan/[id]/cetak/TransferPrint.module.css";
type Item = { code: string; name: string; unit: string };

const state = vi.hoisted(() => ({
  authenticated: true, authError: false, missing: false, docError: false, lineError: false, countOverride: null as number | null,
  doc: { id: "transfer-one", no_pemindahan: "IT.FIKTIF.0001", proses: "Kirim Barang", tanggal: "2026-10-31", status: "Sedang dikirim", keterangan: "Barang untuk toko sendiri", cancelled_at: null as string | null, cancel_reason: null as string | null,
    from: { code: "GDG", name: "Gudang Pusat Fiktif" }, to: { code: "TK", name: "Toko Fiktif" } },
  lines: [{ id: "line-one", item_id: "item-one", qty: 12 as number | string, selected_qty: 1 as number | string | null, satuan: "Dus", faktor: 12, items: { code: "SKU-1", name: "Barang Fiktif", unit: "Pcs" } as Item | Item[] | null }],
  projections: [] as string[],
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: "staff" } : null }, error: state.authError ? { message: "Auth unavailable" } : null }) },
  from: (table: string) => {
    let from = 0, to = 499;
    const q = {
      select: (columns: string) => { state.projections.push(columns); return q; },
      eq: () => q, order: () => q,
      range: (a: number, b: number) => { from = a; to = b; return q; },
      maybeSingle: async () => ({ data: state.missing ? null : state.doc, error: state.docError ? { message: "Unavailable" } : null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "stock_transfer_items" ? state.lines.slice(from, to + 1) : [], count: state.countOverride ?? state.lines.length, error: state.lineError ? { message: "Unavailable" } : null }).then(resolve),
      insert: () => { throw new Error("PRINT MUST NOT INSERT"); },
      update: () => { throw new Error("PRINT MUST NOT UPDATE"); },
      delete: () => { throw new Error("PRINT MUST NOT DELETE"); },
    };
    return q;
  },
  rpc: () => { throw new Error("PRINT MUST NOT CALL A WRITER"); },
}) }));

async function render(rangkap?: string) {
  const route = await import("@/app/(app)/pos/pemindahan/[id]/cetak/page").catch(() => null);
  expect(route, "A printable saved-transfer route must exist").not.toBeNull();
  if (!route) throw new Error("Missing printable transfer route");
  return renderToStaticMarkup(await route.default({ params: Promise.resolve({ id: "transfer-one" }), searchParams: Promise.resolve({ rangkap }) }));
}
beforeEach(() => {
  state.authenticated = true; state.authError = false; state.countOverride = null; state.missing = false; state.docError = false; state.lineError = false;
  state.doc.cancelled_at = null; state.doc.cancel_reason = null; state.doc.proses = "Kirim Barang"; state.doc.status = "Sedang dikirim";
  state.projections = []; state.doc.keterangan = "Barang untuk toko sendiri";
  state.lines = [{ id: "line-one", item_id: "item-one", qty: 12, selected_qty: 1, satuan: "Dus", faktor: 12, items: { code: "SKU-1", name: "Barang Fiktif", unit: "Pcs" } }];
});

it.each([
  ["0.0000001", "0,0000001"],
  ["1.23456789", "1,23456789"],
  ["0.00000000000000000001", "0,00000000000000000001"],
  ["123456789012345678.123456789012345678", "123456789012345678,123456789012345678"],
])("preserves the complete saved decimal quantity %s", async (value, expected) => {
  state.lines[0].qty = value; state.lines[0].selected_qty = value;
  state.lines[0].faktor = 1; state.lines[0].satuan = "Pcs";
  const html = await render("2");
  expect(html).toContain(`>${expected}</td>`);
  expect(state.projections.join(" ")).toContain("qty::text");
  expect(state.projections.join(" ")).toContain("selected_qty::text");
});
it("preserves complete decimal precision in the base-unit equivalent", async () => {
  state.lines[0].qty = "2.46913578"; state.lines[0].selected_qty = "1.23456789";
  state.lines[0].faktor = 2;
  const html = await render("2");
  expect(html).toContain("1,23456789");
  expect(html).toContain("Setara 2,46913578 Pcs");
});

it("renders actual printable fictional fixtures for two, three, long and cancelled copies", async () => {
  const output = process.env.TRANSFER_PRINT_ARTIFACT_DIR;
  let css = readFileSync(join(process.cwd(), "src/app/(app)/pos/pemindahan/[id]/cetak/TransferPrint.module.css"), "utf8");
  const classNames = new Set(Array.from(css.matchAll(/\.([a-z][\w-]*)/g), match => match[1]));
  for (const key of classNames) css = css.replace(new RegExp(`\\.${key}(?![\\w-])`, "g"), `.${printStyles[key]}`);
  expect(css).toContain(`.${printStyles.sheet} {`);
  if (output) mkdirSync(output, { recursive: true });
  const first = state.lines[0];
  for (const fixture of [
    { name: "two-copies", copies: "2", length: 1, cancelled: false },
    { name: "three-copies", copies: "3", length: 1, cancelled: false },
    { name: "long-three-copies", copies: "3", length: 100, cancelled: false },
    { name: "cancelled-three-copies", copies: "3", length: 1, cancelled: true },
  ]) {
    state.doc.status = fixture.cancelled ? "Dibatalkan" : "Sedang dikirim";
    state.doc.cancelled_at = fixture.cancelled ? "2026-10-31T10:00:00Z" : null;
    state.doc.cancel_reason = fixture.cancelled ? "Kiriman fiktif dibatalkan" : null;
    state.lines = Array.from({ length: fixture.length }, (_, i) => ({ ...first, id: `line-${i}`, item_id: `item-${i}`,
      items: { code: `FIKTIF-${i + 1}`, name: `Barang Fiktif Baris ${i + 1}`, unit: "Pcs" } }));
    const html = await render(fixture.copies);
    expect(html.match(/data-transfer-copy=/g)).toHaveLength(Number(fixture.copies));
    if (output) {
      const globals = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(/^@import[^;]+;/gm, "");
      // Same shared layout classes as AppLayout; synthetic chrome, not authenticated UAT.
      const layout = `<div class="shell"><aside class="sb">SIDEBAR-FIKTIF</aside><div class="main"><div class="topbar">TOPBAR-FIKTIF</div><div class="no-print">TABS-FIKTIF</div><div class="ct">${html}</div></div></div>`;
      writeFileSync(join(output, `${fixture.name}.html`), `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>CONTOH FIKTIF — ${fixture.name}</title><style>${globals}\n${css}</style></head><body>${layout}</body></html>`);
    }
  }
});

it("withholds print when the item count does not match the received lines", async () => {
  state.countOverride = 2;
  const html = await render();
  expect(html).toContain("Cetak ditahan"); expect(html).not.toContain("data-transfer-copy");
});
it("redirects on an authentication error even when a user object exists", async () => {
  state.authError = true;
  await expect(render()).rejects.toThrow("REDIRECT:/login");
  expect(state.projections).toEqual([]);
});
it.each(["status", "timestamp"])("marks cancellation independently from %s", async field => {
  if (field === "status") state.doc.status = "Dibatalkan";
  else state.doc.cancelled_at = "2026-10-31T10:00:00Z";
  const html = await render("2");
  expect(html.match(/data-transfer-cancelled=/g)).toHaveLength(2);
});

it("redirects an unauthenticated print request without reading shipment data", async () => {
  state.authenticated = false;
  await expect(render()).rejects.toThrow("REDIRECT:/login");
  expect(state.projections).toEqual([]);
});
it("does not print an inaccessible shipment", async () => {
  state.missing = true;
  await expect(render()).rejects.toThrow("NOT_FOUND");
});
it("does not print a receiving document as a fresh shipment", async () => {
  state.doc.proses = "Terima Barang";
  await expect(render()).rejects.toThrow("NOT_FOUND");
});
it("withholds output on a header query error", async () => {
  state.docError = true;
  const html = await render();
  expect(html).toContain("Cetak ditahan");
  expect(html).not.toContain("data-transfer-copy");
});
it("retains legacy base quantity/unit rather than labeling base stock as boxes", async () => {
  state.lines[0].selected_qty = null;
  const html = await render("2");
  expect(html).toContain(">12</td><td>Pcs</td>");
  expect(html).not.toContain("<td>Dus</td>");
});
it("loads every line beyond the API page cap", async () => {
  const first = state.lines[0];
  state.lines = Array.from({ length: 501 }, (_, i) => ({ ...first, id: `line-${i}`, item_id: `item-${i}`,
    items: { code: `SKU-${i}`, name: `Barang urutan ${i + 1}`, unit: "Pcs" } }));
  const html = await render("2");
  expect(html.match(/Barang urutan 501/g)).toHaveLength(2);
  expect(html.match(/data-transfer-copy=/g)).toHaveLength(2);
});
it.each(["0", "1000000", "-1", "2.5", "<script>"])("bounds an unsupported copy query (%s) to three copies", async rangkap => {
  const html = await render(rangkap);
  expect(html.match(/data-transfer-copy=/g)).toHaveLength(3);
});
it("escapes shipment notes rather than running pasted markup", async () => {
  state.doc.keterangan = "<script>window.fake=1</script>";
  const html = await render("2");
  expect(html).toContain("&lt;script&gt;window.fake=1&lt;/script&gt;");
  expect(html).not.toContain("<script>window.fake=1</script>");
});

it.each(["empty", "missing-item", "invalid-qty"])("withholds incomplete shipment output (%s)", async kind => {
  if (kind === "empty") state.lines = [];
  if (kind === "missing-item") state.lines[0].items = null;
  if (kind === "invalid-qty") state.lines[0].qty = Number.NaN;
  const html = await render();
  expect(html).toContain("Cetak ditahan");
  expect(html).not.toContain("data-transfer-copy");
});

it("shows a read failure without printable copies when item loading fails", async () => {
  state.lineError = true;
  const html = await render();
  expect(html).toContain('role="alert"');
  expect(html).toContain("Cetak ditahan");
  expect(html).not.toContain("data-transfer-copy");
});

it("marks every copy of a cancelled shipment as invalid for active delivery", async () => {
  state.doc.status = "Dibatalkan"; state.doc.cancelled_at = "2026-10-31T10:00:00Z";
  state.doc.cancel_reason = "Kiriman ditarik kembali";
  const html = await render();
  expect(html.match(/data-transfer-cancelled=/g)).toHaveLength(3);
  expect(html).toContain("BUKAN BUKTI PENGIRIMAN AKTIF");
  expect(html).toContain("Kiriman ditarik kembali");
});

it("preserves item identity when the relationship is returned as an array", async () => {
  state.lines[0].items = [{ code: "SKU-ARRAY", name: "Identitas dari relasi array", unit: "Pcs" }];
  const html = await render("2");
  expect(html).toContain("Identitas dari relasi array");
  expect(html).toContain("SKU-ARRAY");
});

it("allows two copies for Gudang and Toko without creating a new shipment", async () => {
  const html = await render("2");
  expect(html.match(/data-transfer-copy=/g)).toHaveLength(2);
  expect(html).toContain('data-transfer-copy="Gudang"');
  expect(html).toContain('data-transfer-copy="Toko"');
  expect(html).not.toContain('data-transfer-copy="Pengantar"');
  expect(html).toContain('name="rangkap"');
  expect(html).toContain("Pilih 1 salinan");
});

it("renders three labeled copies of one saved transfer with the same number and no prices", async () => {
  const html = await render();
  expect(html.match(/data-transfer-copy=/g)).toHaveLength(3);
  expect(html).toContain("Gudang"); expect(html).toContain("Pengantar"); expect(html).toContain("Toko");
  expect(html.match(/IT\.FIKTIF\.0001/g)).toHaveLength(3);
  expect(html).toContain("Barang Fiktif"); expect(html).toContain("Dus");
  expect(html).toContain("bukan faktur penjualan");
  expect(state.projections.join(" ")).not.toMatch(/hpp|unit_cost|harga/);
});
