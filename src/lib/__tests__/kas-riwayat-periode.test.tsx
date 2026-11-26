import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { periodeKas } from "@/lib/kas-entry";

// Laporan klinik 26 Nov 2026: Kas Keluar cuma menampilkan transaksi mulai 19 Nov —
// riwayat dipotong 50 baris terbaru, jadi tanggal 1–18 hilang. Riwayat sekarang
// diambil per periode dan dimuat per halaman sampai habis.
const state = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; args: unknown[] }[],
  cashTotal: 0,
  boleh: false,
  role: "OWNER",
  expenses: [] as unknown[],
}));

function cashRow(i: number) {
  const hari = String(1 + (i % 25)).padStart(2, "0");
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, no_bukti: `KK.2026.11.${String(i + 1).padStart(5, "0")}`,
    tanggal: `2026-11-${hari}`, jumlah: 1000, lawan_code: "720002", account_id: "rek-1", revision: 1, branch_id: null,
    keterangan: `baris ${i}`, voided_at: null, rekening: { nama: "Kas Blu BCA" }, branches: null,
  };
}

function client() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
    from: (table: string) => {
      let awal = 0, akhir = Infinity;
      const log = (op: string) => (...args: unknown[]) => { state.calls.push({ table, op, args }); return q; };
      const q: Record<string, unknown> = {
        select: log("select"), eq: log("eq"), order: log("order"), gte: log("gte"), lte: log("lte"),
        limit: () => { throw new Error("riwayat tidak boleh dipotong limit"); },
        range: (a: number, b: number) => { awal = a; akhir = b; state.calls.push({ table, op: "range", args: [a, b] }); return q; },
        maybeSingle: async () => ({ data: table === "profiles" ? { role: state.role, is_active: true } : null, error: null }),
        then: (resolve: (v: unknown) => void) => {
          let data: unknown[] = [];
          if (table === "cash_entries") data = Array.from({ length: state.cashTotal }, (_, i) => cashRow(i)).slice(awal, akhir + 1);
          if (table === "expenses") data = state.expenses.slice(awal, akhir + 1);
          if (table === "cash_accounts") data = [{ id: "rek-1", nama: "Kas Blu BCA", coa_code: "110005", branch_id: null }];
          resolve({ data, error: null });
        },
      };
      return q;
    },
  };
}

vi.mock("@/lib/master-guard", () => ({ bolehTransaksiKas: async () => state.boleh }));
vi.mock("@/components/LocalTransactionDraft", async (orig) => ({ ...(await orig<object>()), TransactionForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client() }));
vi.mock("@/lib/tanggal", async (orig) => ({ ...(await orig<object>()), hariIniWIB: () => "2026-11-26" }));
vi.mock("@/components/LampiranPicker", () => ({ LampiranPicker: () => null }));
vi.mock("@/components/PilihAkunCari", () => ({ PilihAkunCari: () => null }));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<object>()),
  useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
  usePathname: () => "/kas-bank/kas-keluar",
}));

import { KasEntryScreen } from "@/app/(app)/kas-bank/kas/KasEntryScreen";

beforeEach(() => { state.calls = []; state.cashTotal = 0; state.boleh = false; state.role = "OWNER"; state.expenses = []; });

it("defaults the period to the start of this month through today and fixes bad input", () => {
  expect(periodeKas(undefined, undefined, "2026-11-26")).toEqual({ dari: "2026-11-01", sampai: "2026-11-26" });
  expect(periodeKas("2026-10-01", "2026-10-31", "2026-11-26")).toEqual({ dari: "2026-10-01", sampai: "2026-10-31" });
  expect(periodeKas("2026-11-20", "2026-11-05", "2026-11-26")).toEqual({ dari: "2026-11-05", sampai: "2026-11-20" });
  expect(periodeKas("2026-02-30", "kemarin", "2026-11-26")).toEqual({ dari: "2026-11-01", sampai: "2026-11-26" });
});

it("shows every Kas Keluar of the month, not just the latest 50", async () => {
  state.cashTotal = 1200; // lebih dari satu halaman
  const html = renderToStaticMarkup(await KasEntryScreen({ jenis: "Keluar", searchParams: Promise.resolve({}) }));
  expect(html).toContain("KK.2026.11.00001");
  expect(html).toContain("KK.2026.11.01200");
  expect(html).toContain("1200 transaksi");
  const cash = state.calls.filter((c) => c.table === "cash_entries");
  expect(cash).toContainEqual({ table: "cash_entries", op: "gte", args: ["tanggal", "2026-11-01"] });
  expect(cash).toContainEqual({ table: "cash_entries", op: "lte", args: ["tanggal", "2026-11-26"] });
  expect(cash.filter((c) => c.op === "range").map((c) => c.args)).toEqual([[0, 999], [1000, 1999]]);
  const beban = state.calls.filter((c) => c.table === "expenses");
  expect(beban).toContainEqual({ table: "expenses", op: "gte", args: ["tanggal", "2026-11-01"] });
});

it("uses the period chosen in the filter", async () => {
  const html = renderToStaticMarkup(await KasEntryScreen({ jenis: "Masuk", searchParams: Promise.resolve({ dari: "2026-10-01", sampai: "2026-10-31" }) }));
  expect(state.calls).toContainEqual({ table: "cash_entries", op: "gte", args: ["tanggal", "2026-10-01"] });
  expect(state.calls).toContainEqual({ table: "cash_entries", op: "lte", args: ["tanggal", "2026-10-31"] });
  expect(state.calls.some((c) => c.table === "expenses")).toBe(false); // kas masuk tidak memuat beban kasir
  expect(html).toContain('name="dari"');
  expect(html).toContain('value="2026-10-01"');
});

// Anisa 25 Nov 2026: "kalo edit pengeluaran yang diinput toko dimana?" — tombolnya ada di baris itu sendiri.
const EXP = "8e692432-a8c6-4363-bf23-24c13b73faf6";
const expense = (voided: boolean) => ({ id: EXP, tanggal: "2026-11-03", kategori: "Beban Listrik", deskripsi: "token listrik",
  jumlah: 193500, metode_bayar: "Tunai", voided_at: voided ? "2026-11-04T00:00:00Z" : null, branches: { name: "Kamo Petshop Ciawi" } });

it("offers an Edit button for a store expense to finance staff", async () => {
  state.boleh = true; state.role = "FINANCE"; state.expenses = [expense(false)];
  const html = renderToStaticMarkup(await KasEntryScreen({ jenis: "Keluar", searchParams: Promise.resolve({}) }));
  expect(html).toMatch(new RegExp(`href="/buku-besar/beban/${EXP}"[^>]*>Edit<`));
});

it("shows only a view link for a cancelled store expense", async () => {
  state.boleh = true; state.role = "FINANCE"; state.expenses = [expense(true)];
  const html = renderToStaticMarkup(await KasEntryScreen({ jenis: "Keluar", searchParams: Promise.resolve({}) }));
  expect(html).toMatch(new RegExp(`href="/buku-besar/beban/${EXP}"[^>]*>Lihat<`));
  expect(html).not.toMatch(/>Edit</);
});
