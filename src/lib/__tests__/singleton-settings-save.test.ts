import { beforeEach, expect, it, vi } from "vitest";

// Tabel pengaturan satu baris (aturan gaji, loyalitas, pajak): simpan wajib upsert,
// dan "berhasil" hanya kalau tepat 1 baris benar-benar tertulis.
const db = vi.hoisted(() => ({
  role: "OWNER",
  denied: false,
  result: { data: [{ id: true }] as unknown, error: null as unknown },
  upserts: [] as { table: string; values: Record<string, unknown>; options: unknown }[],
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/loyalty-server", () => ({ jalankanPerawatanLoyalty: vi.fn() }));
const client = {
  auth: { getUser: async () => ({ data: { user: { id: "a0000000-0000-4000-8000-000000000001" } } }) },
  from: (table: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: db.role }, error: null }) }) }),
    upsert: (values: Record<string, unknown>, options: unknown) => {
      db.upserts.push({ table, values, options });
      return { select: async () => db.result };
    },
    update: () => { throw new Error("singleton settings must not be saved with update"); },
  }),
};
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
vi.mock("@/lib/master-guard", () => ({
  assertRole: async (back: string, _apa: string, boleh: string[]) => {
    if (db.denied || !boleh.includes(db.role)) throw new Error(`${back}?error=denied`);
    return client;
  },
}));
import { simpanAturanGaji } from "@/app/(app)/pengaturan/gaji/actions";
import { updateTierSettings } from "@/app/(app)/pengaturan/tier/actions";
import { simpanPajak } from "@/app/(app)/pengaturan/pajak/actions";

const gajiForm = () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ telat_mulai_menit: "1", telat_blok_menit: "5", telat_nominal_per_blok: "0", telat_maks: "0", bolos_per_hari: "0", lembur_per_jam: "0" })) f.set(k, v);
  return f;
};
const tierForm = () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({ bronze_min: "1", silver_min: "2", gold_min: "3", platinum_min: "4", points_expiry_months: "12", tier_downgrade_days: "180" })) f.set(k, v);
  return f;
};
const pajakForm = () => { const f = new FormData(); f.set("ppn_rate", "11"); return f; };

beforeEach(() => {
  db.role = "OWNER"; db.denied = false; db.upserts = [];
  db.result = { data: [{ id: true }], error: null };
});

it("creates the missing payroll settings row with an upsert on the singleton key", async () => {
  await expect(simpanAturanGaji(gajiForm())).rejects.toThrow("/pengaturan/gaji?success=1");
  expect(db.upserts).toHaveLength(1);
  expect(db.upserts[0]).toMatchObject({ table: "payroll_settings", values: { id: true, telat_blok_menit: 5, lembur_per_jam: 0 }, options: { onConflict: "id" } });
});

it("reports an error instead of success when the payroll save wrote 0 rows", async () => {
  db.result = { data: [], error: null };
  await expect(simpanAturanGaji(gajiForm())).rejects.toThrow(/\/pengaturan\/gaji\?error=.*tidak%20tersimpan/);
  db.result = { data: null, error: null };
  await expect(simpanAturanGaji(gajiForm())).rejects.toThrow(/\/pengaturan\/gaji\?error=/);
  db.result = { data: null, error: { message: "new row violates row-level security policy" } };
  await expect(simpanAturanGaji(gajiForm())).rejects.toThrow(/\/pengaturan\/gaji\?error=/);
});

it.each(["ADMIN", "FINANCE", "STAFF"])("keeps payroll settings OWNER-only (%s is refused before any write)", async (role) => {
  db.role = role;
  await expect(simpanAturanGaji(gajiForm())).rejects.toThrow("?error=denied");
  expect(db.upserts).toHaveLength(0);
});

it("upserts loyalty tier settings and reports 0 written rows as a failure", async () => {
  db.role = "ADMIN";
  await expect(updateTierSettings(tierForm())).rejects.toThrow("/pengaturan/tier?success=1");
  expect(db.upserts[0]).toMatchObject({ table: "tier_settings", values: { id: 1, bronze_min: 1, platinum_min: 4 }, options: { onConflict: "id" } });
  db.result = { data: [], error: null };
  await expect(updateTierSettings(tierForm())).rejects.toThrow("/pengaturan/tier?error=");
});

it("upserts tax settings and reports 0 written rows as a failure", async () => {
  await expect(simpanPajak(pajakForm())).rejects.toThrow("/pengaturan/pajak?success=");
  expect(db.upserts[0]).toMatchObject({ table: "company_settings", values: { id: true, ppn_rate: 11 }, options: { onConflict: "id" } });
  db.result = { data: [], error: null };
  await expect(simpanPajak(pajakForm())).rejects.toThrow("/pengaturan/pajak?error=");
});

it.each(["telat_mulai_menit", "telat_blok_menit", "telat_nominal_per_blok", "telat_maks", "bolos_per_hari", "lembur_per_jam"])(
  "refuses to save payroll settings when %s was left empty (typed 0 is still accepted)", async (field) => {
    const f = gajiForm(); f.set(field, "");
    await expect(simpanAturanGaji(f)).rejects.toThrow(/\/pengaturan\/gaji\?error=Semua%20angka%20wajib%20diisi/);
    f.delete(field);
    await expect(simpanAturanGaji(f)).rejects.toThrow(/\/pengaturan\/gaji\?error=Semua%20angka%20wajib%20diisi/);
    expect(db.upserts).toHaveLength(0);
  });

it.each(["bronze_min", "silver_min", "gold_min", "platinum_min", "points_expiry_months", "tier_downgrade_days"])(
  "refuses to write default loyalty numbers when %s was left empty", async (field) => {
    const f = tierForm(); f.set(field, "");
    await expect(updateTierSettings(f)).rejects.toThrow("/pengaturan/tier?error=Semua%20angka%20wajib%20diisi");
    expect(db.upserts).toHaveLength(0);
  });

it("refuses to write the default PPN rate when the rate was left empty", async () => {
  const f = pajakForm(); f.set("ppn_rate", "");
  await expect(simpanPajak(f)).rejects.toThrow("/pengaturan/pajak?error=Tarif%20PPN%20wajib%20diisi.");
  expect(db.upserts).toHaveLength(0);
});

it.each(["ADMIN", "FINANCE", "STAFF", "CASHIER"])("keeps tax settings OWNER-only (%s is refused before any write)", async (role) => {
  db.role = role;
  await expect(simpanPajak(pajakForm())).rejects.toThrow("?error=denied");
  expect(db.upserts).toHaveLength(0);
});
