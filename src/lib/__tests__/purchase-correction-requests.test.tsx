import React from "react";
import { readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseCorrectionRequest } from "@/lib/purchase-correction-requests";

const po = "20000000-0000-4000-8000-000000000001";
const invoice = "20000000-0000-4000-8000-000000000002";
const state = vi.hoisted(() => ({
  role: "OWNER", active: true, fail: false, rows: [] as unknown[],
  filters: [] as [string, unknown][], rpc: [] as [string, Record<string, unknown>][], rpcError: null as null | { message: string },
}));

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error("REDIRECT " + to); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, args: Record<string, unknown>) => { state.rpc.push([name, args]); return { data: {}, error: state.rpcError }; },
  from: (table: string) => {
    let from = 0, to = 999;
    const query = {
      select: () => query, order: () => query, in: () => query,
      eq: (column: string, value: unknown) => { if (table === "purchase_correction_requests") state.filters.push([column, value]); return query; },
      range: (start: number, end: number) => { from = start; to = end; return query; },
      maybeSingle: async () => ({ data: table === "profiles" ? { role: state.role, is_active: state.active } : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        if (table === "purchase_correction_requests" && state.fail) return Promise.resolve({ data: null, count: null, error: { message: "offline" } }).then(resolve);
        const rows = table === "purchase_correction_requests" ? state.rows : table === "profiles" ? [{ id: "requester", full_name: "Fiction Staff" }, { id: "owner", full_name: "Fiction Owner" }] : [];
        return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null }).then(resolve);
      },
    };
    return query;
  },
}) }));

import { PurchaseCorrectionRequestPanel } from "@/components/PurchaseCorrectionRequestPanel";
import QueuePage from "@/app/(app)/pembelian/koreksi/page";
import { ajukanKoreksiPembelian, prosesKoreksiPembelian } from "@/app/(app)/pembelian/koreksi/actions";

const request = (over: Partial<PurchaseCorrectionRequest> = {}): PurchaseCorrectionRequest => ({
  id: "30000000-0000-4000-8000-000000000001", source_kind: "purchase_order", po_id: po, invoice_id: null,
  source_label: "PO-A02", detail: "Harga baris 1 seharusnya 90", requested_by: "requester", status: "pending",
  processed_by: null, processed_at: null, resolution: null, created_at: "2026-10-27T01:00:00Z", ...over,
});
const panel = (props: Partial<React.ComponentProps<typeof PurchaseCorrectionRequestPanel>>) => renderToStaticMarkup(
  <PurchaseCorrectionRequestPanel kind="purchase_order" sourceId={po} label="PO-A02" owner={false} requests={[]} requestKey="fixture-key-0001" {...props} />);
const form = (entries: Record<string, string>) => { const data = new FormData(); for (const [k, v] of Object.entries(entries)) data.set(k, v); return data; };

beforeEach(() => {
  state.role = "OWNER"; state.active = true; state.fail = false; state.rows = []; state.filters = []; state.rpc = []; state.rpcError = null;
});

describe("origin-bound request panel", () => {
  it("lets a non-owner send a request bound to this exact document without edit controls", () => {
    const html = panel({});
    expect(html).toContain('name="source_kind" value="purchase_order"');
    expect(html).toContain(`name="source_id" value="${po}"`);
    expect(html).toContain('name="request_key" value="fixture-key-0001"');
    expect(html).toContain("tidak mengubah PO");
    expect(html).not.toContain("belum dikirim atau dicatat");
  });

  it("shows a failed request read as unknown, never as no request", () => {
    const html = panel({ requests: null });
    expect(html).toContain("Status permintaan koreksi belum dapat dimuat");
    expect(html).not.toContain("Kirim permintaan koreksi");
    expect(panel({ owner: true, requests: null })).toContain("belum dapat dimuat");
  });

  it("shows the requester the processed status, follow-up and queue link", () => {
    const done = request({ status: "selesai", processed_by: "owner", processed_at: "2026-10-27T02:00:00Z", resolution: "Faktur diganti" });
    const html = panel({ requests: [done] });
    expect(html).toContain("Sudah diproses");
    expect(html).toContain("Tindak lanjut: Faktur diganti");
    expect(html).toContain(`href="/pembelian/koreksi?status=selesai#request-${done.id}"`);
  });

  it("gives Super Admin the pending count instead of a request form", () => {
    expect(panel({ owner: true, requests: [] })).toBe("");
    const html = panel({ owner: true, requests: [request(), request({ id: "30000000-0000-4000-8000-000000000002", status: "selesai", resolution: "ok", processed_by: "owner", processed_at: "2026-10-27T02:00:00Z" })] });
    expect(html).toContain("1 menunggu · 2 total");
    expect(html).not.toContain("Kirim permintaan koreksi");
  });
});

describe("correction queue", () => {
  const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await QueuePage({ searchParams: Promise.resolve(sp) }));

  it("lets Super Admin process pending requests with links back to PO and invoice", async () => {
    state.rows = [request(), request({ id: "30000000-0000-4000-8000-000000000003", source_kind: "purchase_invoice", po_id: null, invoice_id: invoice, source_label: "FB-A02" })];
    const html = await render();
    expect(state.filters).toContainEqual(["status", "pending"]);
    expect(html).toContain(`href="/pembelian/${po}#request-purchase-correction"`);
    expect(html).toContain(`href="/pembelian/faktur/${invoice}#request-purchase-correction"`);
    expect(html).toContain("Tandai sudah diproses");
    expect(html).toContain("Fiction Staff");
    expect(html).toContain("MENUNGGU SUPER ADMIN (2)");
  });

  it.each(["ADMIN", "STAFF", "FINANCE"])("gives %s a read-only view of own requests", async role => {
    state.role = role;
    state.rows = [request()];
    const html = await render();
    expect(html).toContain("Permintaan koreksi saya");
    expect(html).not.toContain("Tandai sudah diproses");
  });

  it("does not let an inactive owner process", async () => {
    state.active = false;
    state.rows = [request()];
    expect(await render()).not.toContain("Tandai sudah diproses");
  });

  it("shows a read failure instead of an empty queue", async () => {
    state.fail = true;
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).toContain("(—)");
    expect(html).not.toContain("Tidak ada permintaan koreksi yang menunggu");
  });

  it("lists processed requests with who handled them", async () => {
    state.rows = [request({ status: "selesai", processed_by: "owner", processed_at: "2026-10-27T02:00:00Z", resolution: "Tidak perlu koreksi" })];
    const html = await render({ status: "selesai" });
    expect(state.filters).toContainEqual(["status", "selesai"]);
    expect(html).toContain("Fiction Owner");
    expect(html).toContain("Tidak perlu koreksi");
    expect(html).not.toContain("Tandai sudah diproses");
  });
});

describe("request actions", () => {
  it("stores a request through the guarded RPC and returns to the origin document", async () => {
    await expect(ajukanKoreksiPembelian(form({ source_kind: "purchase_invoice", source_id: invoice, request_key: "fixture-key-0002", detail: "Satuan seharusnya box" })))
      .rejects.toThrow(`REDIRECT /pembelian/faktur/${invoice}?koreksi=terkirim#request-purchase-correction`);
    expect(state.rpc).toEqual([["create_purchase_correction_request", { p_source_kind: "purchase_invoice", p_source_id: invoice, p_request_key: "fixture-key-0002", p_detail: "Satuan seharusnya box" }]]);
  });

  it("returns the database guard message on failure without claiming success", async () => {
    state.rpcError = { message: "Dokumen asal tidak ditemukan atau tidak dapat diakses" };
    await expect(ajukanKoreksiPembelian(form({ source_kind: "purchase_order", source_id: po, request_key: "fixture-key-0003", detail: "x" })))
      .rejects.toThrow(`REDIRECT /pembelian/${po}?koreksi_error=${encodeURIComponent("Dokumen asal tidak ditemukan atau tidak dapat diakses")}#request-purchase-correction`);
    state.rpcError = { message: 'new row violates check constraint "x"' };
    await expect(ajukanKoreksiPembelian(form({ source_kind: "purchase_order", source_id: po, request_key: "k", detail: "x" })))
      .rejects.toThrow("koreksi_error=" + encodeURIComponent("Permintaan koreksi belum tersimpan. Coba lagi."));
  });

  it("never forwards a malformed source id", async () => {
    await expect(ajukanKoreksiPembelian(form({ source_kind: "purchase_order", source_id: "not-a-uuid", request_key: "fixture-key-0004", detail: "Rincian cukup panjang" })))
      .rejects.toThrow("REDIRECT /pembelian?");
    expect(state.rpc[0][1].p_source_id).toBeNull();
  });

  it("marks a request processed only through the owner-guarded RPC", async () => {
    const id = "30000000-0000-4000-8000-000000000001";
    await expect(prosesKoreksiPembelian(form({ id, resolution: "Faktur diganti" }))).rejects.toThrow("REDIRECT /pembelian/koreksi?status=selesai");
    expect(state.rpc).toEqual([["process_purchase_correction_request", { p_id: id, p_resolution: "Faktur diganti" }]]);
    state.rpcError = { message: "Hanya Super Admin aktif yang dapat memproses permintaan koreksi" };
    await expect(prosesKoreksiPembelian(form({ id, resolution: "x" }))).rejects.toThrow("error=" + encodeURIComponent("Hanya Super Admin aktif yang dapat memproses permintaan koreksi"));
  });
});

describe("release safety", () => {
  it("keeps the A02 migration version unique so it cannot collide with another release", () => {
    const files = readdirSync("supabase/migrations");
    const mine = files.filter(name => name.endsWith("_purchase_correction_requests.sql"));
    expect(mine).toHaveLength(1);
    const version = mine[0].split("_")[0];
    expect(files.filter(name => name.split("_")[0] === version)).toEqual(mine);
  });
});
