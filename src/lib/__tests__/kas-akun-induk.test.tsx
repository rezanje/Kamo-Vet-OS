import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

// Laporan klinik 15 Nov 2026: Kas Keluar ke "730000 · Beban Marketing" (akun induk)
// gagal dengan "Jurnal gagal tersimpan". Akun induk tidak bisa dijurnal, jadi tidak
// boleh ditawarkan, dan server menolaknya dengan pesan jelas sebelum apa pun tersimpan.
const state = vi.hoisted(() => ({ inserts: [] as string[], pickerCodes: [] as string[] }));
const COA = [
  { code: "730000", name: "Beban Marketing", type: "BEBAN", is_header: true, is_active: true },
  { code: "730001", name: "Beban Iklan dan Promosi", type: "BEBAN", is_header: false, is_active: true },
  { code: "110005", name: "Kas Toko", type: "ASET", is_header: false, is_active: true },
];

function client() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
    from: (table: string) => {
      let filterCode: string | null = null;
      const rows = () => table === "coa_accounts" ? COA.filter((a) => !filterCode || a.code === filterCode)
        : table === "cash_accounts" ? [{ id: "rek-1", nama: "Kas Blu BCA", coa_code: "110005", is_active: true }] : [];
      const q = {
        select: () => q, order: () => q, limit: () => q, gte: () => q, lte: () => q, range: () => q, in: () => q,
        eq: (col: string, val: string) => { if (table === "coa_accounts" && col === "code") filterCode = val; return q; },
        insert: () => { state.inserts.push(table); return q; },
        maybeSingle: async () => ({ data: table === "profiles" ? { role: "OWNER", is_active: true } : null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: rows(), error: null }),
      };
      return q;
    },
  };
}

vi.mock("@/lib/master-guard", () => ({ bolehTransaksiKas: async () => true, assertRole: async () => client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client() }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: async () => null, jurnalTersimpan: async () => true }));
vi.mock("@/lib/no-dokumen", () => ({ nomorBerikutnya: async () => { state.inserts.push("nomor"); return { nomor: "KK.2026.11.00001" }; } }));
vi.mock("@/lib/persetujuan-server", () => ({ cekPersetujuan: async () => ({ boleh: true }) }));
vi.mock("@/lib/posting", () => ({ postJournal: async () => { state.inserts.push("jurnal"); } }));
vi.mock("@/lib/ledger", () => ({ getAccountBalances: async () => [] }));
vi.mock("@/components/LocalTransactionDraft", async (importOriginal) => ({ ...(await importOriginal<object>()), TransactionForm: ({ children }: { children: React.ReactNode }) => <form>{children}</form> }));
vi.mock("@/components/LampiranPicker", () => ({ LampiranPicker: () => null }));
vi.mock("@/components/PilihAkunCari", () => ({
  PilihAkunCari: ({ akun }: { akun: { code: string }[] }) => { state.pickerCodes = akun.map((a) => a.code); return null; },
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace() {}, push() {}, refresh() {} }),
  usePathname: () => "/kas-bank/kas-keluar",
  redirect: (url: string) => { throw new Error(`REDIRECT ${decodeURIComponent(url)}`); },
}));

import { KasEntryScreen } from "@/app/(app)/kas-bank/kas/KasEntryScreen";
import { simpanKasEntry } from "@/app/(app)/kas-bank/kas/actions";

beforeEach(() => { state.inserts = []; state.pickerCodes = []; });

function form(lawan: string) {
  const f = new FormData();
  Object.entries({ jenis: "Keluar", tanggal: "2026-11-02", account_id: "rek-1", lawan_code: lawan, jumlah: "1000000",
    keterangan: "Giveaway", lampiran: JSON.stringify([{ path: "pengeluaran/bukti.jpg", nama: "bukti.jpg", tipe: "image/jpeg", ukuran: 10 }]) })
    .forEach(([k, v]) => f.set(k, v));
  return f;
}

it("does not offer parent accounts in the Kas Keluar account picker", async () => {
  renderToStaticMarkup(await KasEntryScreen({ jenis: "Keluar", searchParams: Promise.resolve({}) }));
  expect(state.pickerCodes).toContain("730001");
  expect(state.pickerCodes).not.toContain("730000");
  expect(state.pickerCodes).not.toContain("110005"); // rekening kas tetap dikeluarkan
});

it("rejects a parent account with a clear message before numbering or saving anything", async () => {
  await expect(simpanKasEntry(form("730000"))).rejects.toThrow("Akun 730000 · Beban Marketing adalah akun induk");
  expect(state.inserts).toEqual([]);
});

it("still saves a detail account", async () => {
  await expect(simpanKasEntry(form("730001"))).rejects.toThrow("REDIRECT /kas-bank/kas-keluar?error=Gagal menyimpan");
  expect(state.inserts).toEqual(["nomor", "cash_entries"]);
});
