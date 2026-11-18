import { beforeEach, expect, it, vi } from "vitest";

// Dokter pemeriksa di antrian: server action registrasi ASLI dengan infrastruktur (Supabase, redirect) diganti.
// Aturan database diuji terpisah di supabase/tests/dokter_pemeriksa_antrian.sql.
const PID = "0f2b6c1e-8a43-4d2a-9b7e-1c5d3e7f9a10";
const s = vi.hoisted(() => ({
  rpc: [] as Array<{ name: string; args: Record<string, unknown> }>,
  inserts: [] as Array<{ table: string; value: Record<string, unknown> }>,
  employee: null as Record<string, unknown> | null,
  assignments: [] as unknown[],
  visitError: "" as string,
}));

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT:${url}`), { url }); } }));
vi.mock("@/lib/operational-branch-server", () => ({ requireOperationalBranch: async () => ({ id: "cabang" }) }));
vi.mock("@/lib/dokter", () => ({ resolveDokter: async (_c: unknown, id: string | null) => id ? { doctorId: id, nama: "Agung Groomer" } : { doctorId: null, nama: null } }));
vi.mock("@/lib/anabul", async (original) => ({ ...(await original<typeof import("@/lib/anabul")>()), cariAnabulSenama: async () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "staf" } } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      s.rpc.push({ name, args });
      if (name === "registrasi_pelanggan_atomik") return { data: { customer_id: "pemilik-ada" }, error: null };
      return { data: null, error: null };
    },
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      let berisi = false;
      Object.assign(q, {
        select: chain, eq: chain, gte: chain, lt: chain, in: chain, order: chain, limit: chain, lte: chain, or: chain,
        maybeSingle: async () => ({ data: table === "branches" ? { code: "TST" } : table === "employees" ? s.employee : null, error: null }),
        single: async () => (table === "visits" && s.visitError
          ? { data: null, error: { message: s.visitError } }
          : { data: { id: `${table}-baru` }, error: null }),
        insert: (value: Record<string, unknown>) => { berisi = true; s.inserts.push({ table, value }); return q; },
        update: chain, delete: chain,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: berisi ? [] : table === "employee_branch_assignments" ? s.assignments : [], error: null }).then(resolve),
      });
      return q;
    },
  }),
}));

import { registrasiPasien } from "@/app/(app)/klinik/registrasi/actions";

function form(poli: string, extra: Record<string, string> = {}) {
  const data = new FormData();
  data.set("phone", "+62 812-3456-7890"); data.set("name", "Pemilik Fiktif"); data.set("branchId", "cabang");
  data.set("poli", poli); data.set("doctor_id", "g-agung");
  data.set("pets", JSON.stringify([{ name: "Kucing Fiktif", species: "Kucing" }]));
  for (const [k, v] of Object.entries(extra)) data.set(k, v);
  return data;
}
async function jalankan(data: FormData) {
  try { await registrasiPasien(data); return "tanpa redirect"; }
  catch (error) { return decodeURIComponent((error as { url?: string }).url ?? String(error)); }
}
const kunjungan = () => s.inserts.filter((i) => i.table === "visits").map((i) => i.value);
const dokterRow = (o: Record<string, unknown> = {}) => ({ id: PID, nama: "DRH. AINI", jabatan: "Dokter Hewan Poli", status: "Aktif", branch_id: "cabang", trashed_at: null, ...o });

beforeEach(() => { s.rpc = []; s.inserts = []; s.employee = dokterRow(); s.assignments = []; s.visitError = ""; });

it("Grooming + dokter pemeriksa sah: tersimpan di visits.pemeriksa_id; groomer tetap di doctor_id/dokter", async () => {
  const hasil = await jalankan(form("Grooming", { pemeriksa_id: PID }));
  expect(hasil).toContain("/klinik/antrian?success=1");
  expect(kunjungan()).toHaveLength(1);
  expect(kunjungan()[0]).toMatchObject({ poli: "Grooming", doctor_id: "g-agung", dokter: "Agung Groomer", pemeriksa_id: PID, status: "Menunggu" });
});

it("Grooming tanpa pemeriksa: kiriman ke visits TANPA kolom baru (perilaku lama persis)", async () => {
  await jalankan(form("Grooming"));
  expect(kunjungan()).toHaveLength(1);
  expect("pemeriksa_id" in kunjungan()[0]).toBe(false);
  expect(kunjungan()[0]).toMatchObject({ doctor_id: "g-agung", dokter: "Agung Groomer" });
});

it("poli lain mengabaikan pemeriksa_id yang terkirim (tidak ditulis, tidak divalidasi)", async () => {
  await jalankan(form("Poli Umum", { pemeriksa_id: PID }));
  expect(kunjungan()).toHaveLength(1);
  expect("pemeriksa_id" in kunjungan()[0]).toBe(false);
});

it("pemeriksa bukan dokter: ditolak SEBELUM menulis pemilik, hewan, atau kunjungan", async () => {
  s.employee = dokterRow({ jabatan: "Staff Toko - Groomer" });
  const hasil = await jalankan(form("Grooming", { pemeriksa_id: PID }));
  expect(hasil).toContain("/klinik/registrasi?error=Dokter pemeriksa harus berjabatan dokter.");
  expect(s.rpc.some((r) => r.name === "registrasi_pelanggan_atomik")).toBe(false);
  expect(s.inserts).toHaveLength(0);
});

it("pemeriksa nonaktif / tidak ditemukan / cabang lain: ditolak dengan pesan jelas, tidak ada tulisan", async () => {
  for (const [baris, pesan] of [
    [dokterRow({ status: "Nonaktif" }), "masih aktif"], [null, "masih aktif"], [dokterRow({ branch_id: "lain" }), "bertugas di cabang"],
  ] as const) {
    s.employee = baris; s.inserts = []; s.rpc = [];
    const hasil = await jalankan(form("Grooming", { pemeriksa_id: PID }));
    expect(hasil).toContain(pesan);
    expect(s.inserts).toHaveLength(0); expect(s.rpc.some((r) => r.name === "registrasi_pelanggan_atomik")).toBe(false);
  }
});

it("pemeriksa cabang lain tetapi bertugas di cabang ini (penugasan berlaku): diterima", async () => {
  s.employee = dokterRow({ branch_id: "lain" }); s.assignments = [{ employee_id: PID }];
  await jalankan(form("Grooming", { pemeriksa_id: PID }));
  expect(kunjungan()[0]).toMatchObject({ pemeriksa_id: PID });
});

it("isian bukan uuid diperlakukan kosong: pendaftaran tetap jalan tanpa pemeriksa", async () => {
  const hasil = await jalankan(form("Grooming", { pemeriksa_id: "bukan-uuid" }));
  expect(hasil).toContain("/klinik/antrian?success=1");
  expect("pemeriksa_id" in kunjungan()[0]).toBe(false);
});

it("pagar database menolak saat menyimpan kunjungan: pesan ramah, bukan teks mentah", async () => {
  s.visitError = "PEMERIKSA_BUKAN_CABANG: dokter pemeriksa harus bertugas di cabang kunjungan";
  const hasil = await jalankan(form("Grooming", { pemeriksa_id: PID }));
  expect(hasil).toContain("/klinik/registrasi?error=Dokter pemeriksa harus bertugas di cabang ini.");
});
