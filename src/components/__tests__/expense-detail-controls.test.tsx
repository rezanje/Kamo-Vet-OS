// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ role: "FINANCE", shift: "open", closed: null as string | null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Error("notFound"); } }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/dokumen/DokumenPanel", () => ({ DokumenPanel: () => <div>Proof remains available</div> }));
vi.mock("@/app/(app)/pos/expense/actions", () => ({ ubahExpense: vi.fn(), batalkanExpense: vi.fn(), periksaExpense: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "finance-user" } } }) },
  from: (table: string) => {
    const data = table === "expenses" ? { id: "ee400000-0000-4000-8000-000000000001", tanggal: "2026-10-15", kategori: "Operasional", deskripsi: "Cashier expense", jumlah: 25000, metode_bayar: "Tunai", revision: 0, voided_at: null, shift_id: "shift", branches: { name: "Cabang" }, pembuat: { full_name: "POS cashier" } }
      : table === "profiles" ? { role: fixture.role, is_active: true }
        : table === "cashier_shifts" ? { status: fixture.shift }
          : table === "accounting_locks" ? { closed_until: fixture.closed } : [];
    const query = { select: () => query, eq: () => query, order: () => query, maybeSingle: async () => ({ data, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
    return query;
  },
}) }));
import { PengeluaranDetail } from "@/components/pengeluaran/PengeluaranDetail";
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); fixture.role = "FINANCE"; fixture.shift = "open"; fixture.closed = null; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render() { const detail = await PengeluaranDetail({ id: "ee400000-0000-4000-8000-000000000001", kembaliHref: "/buku-besar/beban", kembaliLabel: "Kembali" }); await act(async () => root.render(detail)); }

it("lets finance edit or cancel a POS cashier expense from its shared detail", async () => {
  await render(); expect(host.textContent).toContain("Simpan Perubahan"); expect(host.textContent).toContain("Batalkan Pengeluaran");
  expect(host.textContent).toContain("POS cashier"); expect(host.querySelectorAll('input[name="revision"]')).toHaveLength(2);
});
it("does not offer expense corrections to cashier staff", async () => { fixture.role = "STAFF"; await render(); expect(host.textContent).not.toContain("Simpan Perubahan"); expect(host.textContent).not.toContain("Batalkan Pengeluaran"); });
it("explains why a closed shift cannot be changed", async () => { fixture.shift = "closed"; await render(); expect(host.textContent).toContain("Shift sudah ditutup"); expect(host.textContent).not.toContain("Simpan Perubahan"); });
it("explains the accounting period lock before offering a correction", async () => { fixture.closed = "2026-10-15"; await render(); expect(host.textContent).toContain("Periode akuntansi"); expect(host.textContent).not.toContain("Simpan Perubahan"); });
