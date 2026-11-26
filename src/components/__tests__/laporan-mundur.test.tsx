// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ jejak: [] as unknown[], jejakError: null as null | { message: string }, kini: [] as unknown[], throwNames: false, filter: [] as string[][] }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (tabel: string) => {
      const q: Record<string, unknown> = {};
      const hasil = () => tabel === "expense_backdates" ? { data: fixture.jejakError ? null : fixture.jejak, error: fixture.jejakError }
        : tabel === "branches" ? { data: [{ id: "b1", name: "Cabang Cimanggu" }], error: null }
          : tabel === "profiles" ? { data: [{ id: "u1", full_name: "Rina Kasir" }], error: null }
            : { data: fixture.kini, error: null };
      for (const m of ["select", "order", "limit", "in"]) q[m] = () => { if (fixture.throwNames && tabel !== "expense_backdates") throw new Error("boom"); return q; };
      q.gte = (k: string, v: string) => { fixture.filter.push(["gte", k, v]); return q; };
      q.lt = (k: string, v: string) => { fixture.filter.push(["lt", k, v]); return q; };
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(hasil()).then(resolve);
      return q;
    },
  }),
}));
import { LaporanMundur } from "@/components/pengeluaran/LaporanMundur";
let host: HTMLDivElement, root: Root;
const J = (id: string, extra: Record<string, unknown> = {}) => ({ expense_id: id, actor_id: "u1", branch_id: "b1", context: "cashier", effective_date: "2026-11-20", reason: "nota listrik terlupa", recorded_at: "2026-11-26T03:00:00Z", kategori: "Listrik & Air", jumlah: 100000, ...extra });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-26T03:00:00Z"));
  Object.assign(fixture, { jejak: [], jejakError: null, kini: [], throwNames: false, filter: [] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function render(props: { dari?: string; sampai?: string } = {}) { const el = await LaporanMundur({ aksi: "/buku-besar/beban", ...props }); await act(async () => root.render(el)); }

it("tanpa data: pesan kosong dan periode bawaan = awal bulan s/d hari ini (WIB)", async () => {
  await render();
  expect(host.textContent).toContain("Tidak ada pengeluaran bertanggal mundur");
  expect(host.querySelector<HTMLInputElement>("#mdari")!.value).toBe("2026-11-01");
  expect(host.querySelector<HTMLInputElement>("#msampai")!.value).toBe("2026-11-26");
  expect(host.querySelector("form")!.getAttribute("action")).toBe("/buku-besar/beban");
  // periode input dibaca menurut WIB: dari 00:00 WIB hari pertama sampai sebelum 00:00 WIB hari sesudah hari terakhir
  expect(fixture.filter).toContainEqual(["gte", "recorded_at", "2026-11-01T00:00:00+07:00"]);
  expect(fixture.filter).toContainEqual(["lt", "recorded_at", "2026-11-27T00:00:00+07:00"]);
});
it("menampilkan pelaku, cabang, alasan, selisih hari dan total; yang dibatalkan tidak dihitung", async () => {
  fixture.jejak = [J("e1"), J("e2", { jumlah: 50000, reason: "salah input" })];
  fixture.kini = [{ id: "e1", tanggal: "2026-11-20", jumlah: 100000, voided_at: null }, { id: "e2", tanggal: "2026-11-20", jumlah: 0, voided_at: "2026-11-26T04:00:00Z" }];
  await render();
  const teks = host.textContent!;
  expect(teks).toContain("Rina Kasir"); expect(teks).toContain("Cabang Cimanggu"); expect(teks).toContain("Kasir petshop"); expect(teks).toContain("nota listrik terlupa");
  expect(teks).toContain("6 hari mundur"); expect(teks).toContain("Dibatalkan");
  expect(host.querySelector('[data-testid="ringkasan-mundur"]')!.textContent).toMatch(/2.*pengeluaran mundur, total.*Rp 100\.000.*1 sudah dibatalkan/);
  expect(host.querySelector('a[href="/buku-besar/beban/e1"]')).not.toBeNull();
});
it("lintas bulan ditandai dan dijumlahkan; nominal memakai nilai SEKARANG bila dikoreksi; tanggal yang diubah ditunjukkan", async () => {
  fixture.jejak = [J("e1", { effective_date: "2026-10-30", recorded_at: "2026-11-02T03:00:00Z" })];
  fixture.kini = [{ id: "e1", tanggal: "2026-10-28", jumlah: 120000, voided_at: null }];
  await render({ dari: "2026-11-01", sampai: "2026-11-30" });
  expect(host.textContent).toContain("Lintas bulan"); expect(host.textContent).toContain("laporan bulan itu berubah");
  expect(host.textContent).toContain("Rp 120.000"); expect(host.textContent).toContain("kini 28/10/2026");
});
it("periode terbalik dirapikan dan tanggal tidak sah diganti bawaan", async () => {
  await render({ dari: "2026-11-20", sampai: "2026-11-10" });
  expect(host.querySelector<HTMLInputElement>("#mdari")!.value).toBe("2026-11-10"); expect(host.querySelector<HTMLInputElement>("#msampai")!.value).toBe("2026-11-20");
});
it("tanggal tidak sah diganti periode bawaan", async () => {
  await render({ dari: "bukan-tanggal", sampai: "2026-02-31" });
  expect(host.querySelector<HTMLInputElement>("#mdari")!.value).toBe("2026-11-01"); expect(host.querySelector<HTMLInputElement>("#msampai")!.value).toBe("2026-11-26");
});
it("galat baca = pesan, bukan halaman rusak; galat nama/status hanya mengosongkan kolomnya", async () => {
  fixture.jejakError = { message: "denied" };
  await render();
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("belum dapat dimuat");
  fixture.jejakError = null; fixture.jejak = [J("e1")]; fixture.throwNames = true;
  await render();
  expect(host.textContent).toContain("nota listrik terlupa"); expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("lebih dari 500 baris: dipotong dengan peringatan", async () => {
  fixture.jejak = Array.from({ length: 501 }, (_, i) => J(`e${i}`));
  await render();
  expect(host.textContent).toContain("Hanya 500 baris terbaru"); expect(host.querySelectorAll("tbody tr")).toHaveLength(500);
}, 60_000);
