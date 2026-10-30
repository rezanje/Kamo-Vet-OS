import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// U07: the detail page preloads the user and medication history in its parallel wave.
const s = vi.hoisted(() => ({ clientCalls: 0 }));
vi.mock("@/app/(app)/klinik/rawat-inap/actions", () => ({ tambahObatInap: vi.fn(), catatPemberianObat: vi.fn(), hentikanObatInap: vi.fn(), batalkanPemberianObat: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => { s.clientCalls++; throw new Error("unexpected database session"); } }));
import { ObatKhusus } from "@/app/(app)/klinik/rawat-inap/[id]/ObatKhusus";

beforeEach(() => { s.clientCalls = 0; });

it("renders preloaded history without opening its own database session or reading the user again", async () => {
  const html = renderToStaticMarkup(await ObatKhusus({ recordId: "inpat", aktif: true, userId: "actor", history: { medications: [], doses: [] } }));
  expect(s.clientCalls).toBe(0);
  expect(html).toContain("Belum ada riwayat obat berprotokol");
  expect(html).not.toContain("<form");
  expect(html).not.toContain("TAMBAH OBAT BERPROTOKOL");
  expect(html).toContain('/klinik/rawat-inap/inpat/obat-khusus');
});

it("a preloaded failed history still shows the incomplete-history warning and no forms", async () => {
  const html = renderToStaticMarkup(await ObatKhusus({ recordId: "inpat", aktif: true, userId: "actor", history: null }));
  expect(s.clientCalls).toBe(0);
  expect(html).toContain('role="alert"');
  expect(html).toContain("belum dapat dimuat lengkap");
  expect(html).not.toContain("Belum ada riwayat obat berprotokol");
  expect(html).not.toContain("<form");
});
