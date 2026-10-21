import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const { profile, client } = vi.hoisted(() => ({ profile: { role: "OWNER", is_active: true }, client: { from: vi.fn(), auth: { getUser: vi.fn(async () => ({ data: { user: { id: "owner" } } })) } } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
vi.mock("@/lib/master-guard", () => ({ bolehTransaksiKas: async () => true }));
vi.mock("@/lib/ledger", () => ({ getAccountBalances: async () => [] }));
vi.mock("@/app/(app)/kas-bank/transfer/TransferForm", () => ({ TransferForm: ({ mode = "create" }: { mode?: string }) => <div data-mode={mode}/> }));
vi.mock("@/app/(app)/kas-bank/transfer/TransferRecovery", () => ({ TransferRecovery: () => <div>Transfer recovery</div> }));
import TransferPage from "@/app/(app)/kas-bank/transfer/page";
const doc = { id: "transfer-id", no_transfer: "TF.TEST", tanggal: "2026-10-20", jumlah: 100, biaya_admin: 0, revision: 0, voided_at: null, from_account_id: "a", to_account_id: "b" };
let documents = [doc];
beforeEach(() => {
  documents = [doc];
  profile.role = "OWNER"; profile.is_active = true;
  client.from.mockImplementation((table: string) => {
    const data = table === "profiles" ? profile : table === "cash_transfers" ? documents : table === "cash_accounts" ? [{ id: "a", nama: "Source", coa_code: "1171" }, { id: "b", nama: "Destination", coa_code: "1172" }] : [];
    let filtered: unknown = data; let from = 0; let to = 49; let single = false;
    const query: Record<string, unknown> = { then: (resolve: (data: unknown) => void) => resolve({ data: Array.isArray(filtered) ? single ? filtered[0] : filtered.slice(from,to+1) : filtered, count: Array.isArray(filtered) ? filtered.length : 1, error: null }) };
    query.range = (start: number, end: number) => { from=start;to=end;return query; };
    query.eq = (name: string, value: string) => { if(table === "cash_transfers" && name === "id" && Array.isArray(filtered)) filtered = filtered.filter(row=>row.id===value); return query; };
    query.maybeSingle = () => { single=true;return query; };
    for (const method of ["select", "order", "limit", "in"]) query[method] = () => query;
    return query;
  });
});
it("opens a selected correction in a full width panel and retains recovery", async () => {
  const html = renderToStaticMarkup(await TransferPage({ searchParams: Promise.resolve({ koreksi: "transfer-id" }) }));
  expect(html).toContain('id="koreksi-transfer"'); expect(html).toContain('data-mode="edit"'); expect(html).toContain("Transfer recovery");
});
it.each(["ADMIN", "FINANCE"])("never exposes correction or cancellation to %s", async role => {
  profile.role = role;
  const html = renderToStaticMarkup(await TransferPage({ searchParams: Promise.resolve({ koreksi: "transfer-id" }) }));
  expect(html).not.toContain('data-mode="edit"'); expect(html).not.toContain('data-mode="void"');
});

it("keeps older transfers reachable beyond the first fifty records", async () => {
  documents = Array.from({length:51},(_,index)=>({...doc,id:`transfer-${index}`}));
  const html = renderToStaticMarkup(await TransferPage({searchParams:Promise.resolve({koreksi:"transfer-50",hal:"2"})}));
  expect(html).toContain('id="koreksi-transfer"');
  expect(html).toContain("51–51 dari 51");
  expect(html).toContain("Sebelumnya");
});
