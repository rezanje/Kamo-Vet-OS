// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ role: "FINANCE", shift: "open", closed: null as string | null, backdate: null as null | { effective_date: string; reason: string; recorded_at: string }, revisions: [] as unknown[] }));
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
          : table === "accounting_locks" ? { closed_until: fixture.closed }
            : table === "expense_backdates" ? fixture.backdate : table === "expense_revisions" ? fixture.revisions : [];
    const query = { select: () => query, eq: () => query, order: () => query, maybeSingle: async () => ({ data, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve) };
    return query;
  },
}) }));
import { PengeluaranDetail } from "@/components/pengeluaran/PengeluaranDetail";
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); fixture.role = "FINANCE"; fixture.shift = "open"; fixture.closed = null; fixture.backdate = null; fixture.revisions = []; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render() { const detail = await PengeluaranDetail({ id: "ee400000-0000-4000-8000-000000000001", kembaliHref: "/buku-besar/beban", kembaliLabel: "Kembali" }); await act(async () => root.render(detail)); }

it("lets finance edit or cancel a POS cashier expense from its shared detail", async () => {
  await render(); expect(host.textContent).toContain("Simpan Perubahan"); expect(host.textContent).toContain("Batalkan Pengeluaran");
  expect(host.textContent).toContain("POS cashier"); expect(host.querySelectorAll('input[name="revision"]')).toHaveLength(2);
});
it("does not offer expense corrections to cashier staff", async () => { fixture.role = "STAFF"; await render(); expect(host.textContent).not.toContain("Simpan Perubahan"); expect(host.textContent).not.toContain("Batalkan Pengeluaran"); });
it("lets finance and owner correct an expense after its shift is closed", async () => {
  for (const role of ["FINANCE", "OWNER"]) {
    fixture.role = role; fixture.shift = "closed"; await render();
    expect(host.textContent).toContain("Simpan Perubahan"); expect(host.textContent).toContain("Batalkan Pengeluaran");
    expect(host.textContent).toContain("angka tutup shift");
  }
});
it("explains why admin cannot change an expense from a closed shift", async () => { fixture.role = "ADMIN"; fixture.shift = "closed"; await render(); expect(host.textContent).toContain("hanya dapat dilakukan Owner atau Finance"); expect(host.textContent).not.toContain("Simpan Perubahan"); });
it("lets admin correct an expense while the shift is open", async () => { fixture.role = "ADMIN"; await render(); expect(host.textContent).toContain("Simpan Perubahan"); expect(host.textContent).not.toContain("angka tutup shift"); });
it("explains the accounting period lock before offering a correction", async () => { fixture.closed = "2026-10-15"; await render(); expect(host.textContent).toContain("Periode akuntansi"); expect(host.textContent).not.toContain("Simpan Perubahan"); });

it("shows the immutable backdate trail (reason and real time) on a backdated expense, nothing on a normal one", async () => {
  await render(); expect(host.querySelector('[data-testid="jejak-tanggal-mundur"]')).toBeNull();
  fixture.backdate = { effective_date: "2026-10-15", reason: "Nota listrik terlupa diinput", recorded_at: "2026-10-18T03:00:00Z" };
  await render();
  const note = host.querySelector('[data-testid="jejak-tanggal-mundur"]')!;
  expect(note.textContent).toContain("Dicatat mundur"); expect(note.textContent).toContain("Nota listrik terlupa diinput"); expect(note.textContent).toContain("WIB");
});

const rev = (before: Record<string, unknown>, after: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: "r1", action: "edit", reason: "Salah tanggal input", before_value: { tanggal: "2026-10-15", kategori: "Operasional", metode_bayar: "Tunai", jumlah: 25000, ...before }, after_value: { tanggal: "2026-10-15", kategori: "Operasional", metode_bayar: "Tunai", jumlah: 25000, ...after }, created_at: "2026-11-26T03:00:00Z", ...extra });

it("review MINOR-3: jejak tetap menyebut tanggal sekarang bila tanggal diubah lewat koreksi", async () => {
  fixture.backdate = { effective_date: "2026-10-10", reason: "Nota listrik terlupa diinput", recorded_at: "2026-10-18T03:00:00Z" };
  await render();
  const note = host.querySelector('[data-testid="jejak-tanggal-mundur"]')!;
  expect(note.textContent).toContain("Tanggal pengeluaran sekarang"); expect(note.textContent).toContain("diubah lewat koreksi");
  fixture.backdate = { effective_date: "2026-10-15", reason: "Nota listrik terlupa diinput", recorded_at: "2026-10-18T03:00:00Z" };
  await render();
  expect(host.querySelector('[data-testid="jejak-tanggal-mundur"]')!.textContent).not.toContain("Tanggal pengeluaran sekarang");
});
it("review MINOR-3: pengeluaran yang dipindah ke masa lalu lewat Ubah (tanpa jejak) diberi catatan dan riwayat menampilkan tanggal sebelum-sesudah", async () => {
  fixture.revisions = [rev({ tanggal: "2026-11-26" }, { tanggal: "2026-10-15" })];
  await render();
  expect(host.querySelector('[data-testid="tanggal-diubah-koreksi"]')!.textContent).toContain("pernah diubah lewat koreksi");
  expect(host.textContent).toContain("RIWAYAT KOREKSI"); expect(host.textContent).toContain("Tanggal 26/11/2026 → 15/10/2026"); expect(host.textContent).toContain("Salah tanggal input");
});
it("koreksi nominal saja: tidak ada catatan tanggal dan tidak ada baris tanggal di riwayat", async () => {
  fixture.revisions = [rev({}, { jumlah: 30000 })];
  await render();
  expect(host.querySelector('[data-testid="tanggal-diubah-koreksi"]')).toBeNull();
  expect(host.textContent).not.toContain("Tanggal 15/10/2026"); expect(host.textContent).toContain("Rp 25.000 → Rp 30.000");
});
it("formulir Ubah: tanggal tidak boleh melewati hari ini dan aturan 31 hari dijelaskan", async () => {
  await render();
  const tanggal = host.querySelector<HTMLInputElement>('input[type="date"][name="tanggal"]')!;
  expect(tanggal.max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(tanggal.min).toBe(""); // tanggal lama yang tidak diganti harus tetap bisa disimpan
  expect(host.querySelector('[data-testid="aturan-tanggal-ubah"]')!.textContent).toMatch(/31 hari.*tidak boleh masa depan.*alasan koreksi wajib/);
});
