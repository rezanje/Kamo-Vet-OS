import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bacaDaftarKartuTertunda, bacaKartuTertunda, barisKartu, calonIdentitas, hpKartuSah, isianLengkapi, KartuTertundaGagal,
  pesanPetugas, pilihanTanggal,
} from "@/lib/kartu-tertunda";

const ID = "0e000000-0000-4000-8000-000000000001";
const ID2 = "0e000000-0000-4000-8000-000000000002";
const baris = (o: Record<string, unknown> = {}) => ({
  id: ID, status: "perlu_dilengkapi", kekurangan: ["hp_kosong"], isi: { owner_name: "UJI", diagnosis: "Dx" }, sumber_berkas: "f.xlsx",
  sumber_sheet: "S1", local_record_id: "L1", visit_id: null, catatan: null, dibuat_pada: "2026-10-30T00:00:00Z", diubah_pada: null, total: 1, ...o,
});
const klienRpc = (data: unknown, error: unknown = null) => ({ rpc: vi.fn(async () => ({ data, error })) });

describe("kartu tertunda — pembaca", () => {
  it("accepts well-formed rows and rejects every malformed shape (load failure, never 'empty')", () => {
    expect(barisKartu(baris())).toMatchObject({ id: ID, total: 1, isi: { owner_name: "UJI" } });
    for (const rusak of [{ id: "x" }, { status: "lain" }, { kekurangan: "hp_kosong" }, { isi: { phone: 812 } }, { visit_id: "x" }, { total: -1 }, { dibuat_pada: "bukan" }]) {
      expect(barisKartu(baris(rusak))).toBeNull();
    }
  });
  it("list: paginates 50 per page, and fails closed on error, wrong status, oversize, or duplicate ids", async () => {
    const ok = klienRpc([baris(), baris({ id: ID2 })]);
    const h = await bacaDaftarKartuTertunda(ok, "perlu_dilengkapi", "  uji ", 3);
    expect(ok.rpc).toHaveBeenCalledWith("daftar_kartu_tertunda", { p_status: "perlu_dilengkapi", p_cari: "uji", p_dari: 100, p_jumlah: 50 });
    expect(h.baris).toHaveLength(2);
    for (const k of [klienRpc(null, { message: "x" }), klienRpc([baris({ status: "selesai" })]), klienRpc([baris(), baris()]), klienRpc(Array.from({ length: 51 }, () => baris()))]) {
      await expect(bacaDaftarKartuTertunda(k, "perlu_dilengkapi", "", 1)).rejects.toBeInstanceOf(KartuTertundaGagal);
    }
  });
  it("detail: unknown id = null; foreign row = failure", async () => {
    expect(await bacaKartuTertunda(klienRpc([]), ID)).toBeNull();
    expect(await bacaKartuTertunda(klienRpc([]), "bukan-uuid")).toBeNull();
    await expect(bacaKartuTertunda(klienRpc([baris({ id: ID2 })]), ID)).rejects.toBeInstanceOf(KartuTertundaGagal);
  });
  it("candidates use the existing identity scan: same phone key only, pets (incl. same-name variants) per owner", async () => {
    const k = klienRpc({ sudah_ada: [], customers: [
      { id: ID, name: "A", phone: "+62 812-3456-7890" }, { id: ID2, name: "B", phone: "081299999999" },
    ], pets: [{ id: "p1", customer_id: ID, name: "Molly" }, { id: "p2", customer_id: ID, name: " molly " }, { id: "p3", customer_id: ID, name: "Cimot" }] });
    const c = await calonIdentitas(k, "081234567890");
    expect(k.rpc).toHaveBeenCalledWith("import_legacy_identity_scan", { p_source_keys: [], p_owner_keys: [], p_phone_keys: ["081234567890"] });
    expect(c.pemilik.map((p) => p.id)).toEqual([ID]);
    expect(c.hewanPer(ID, "MOLLY").map((p) => p.id)).toEqual(["p1", "p2"]);
    expect((await calonIdentitas(klienRpc(null), "123")).pemilik).toEqual([]);
    await expect(calonIdentitas(klienRpc(null, { message: "x" }), "081234567890")).rejects.toBeInstanceOf(KartuTertundaGagal);
  });
});

describe("kartu tertunda — isian & pesan", () => {
  const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  it("maps the form to RPC args; blanks become null; bad ids/dates rejected", () => {
    expect(isianLengkapi(form({ id: ID, phone: " 0812 ", owner_name: "", record_date: "2024-09-29" }))).toEqual({ ok: true, isian: {
      p_id: ID, p_phone: "0812", p_customer_id: null, p_owner_name: null, p_patient_name: null, p_pet_id: null, p_record_date: "2024-09-29" } });
    expect(isianLengkapi(form({ id: "x" })).ok).toBe(false);
    expect(isianLengkapi(form({ id: ID, customer_id: "x" })).ok).toBe(false);
    expect(isianLengkapi(form({ id: ID, record_date: "29/09/2024" })).ok).toBe(false);
    expect(isianLengkapi(form({ id: ID, owner_name: "x".repeat(101) })).ok).toBe(false);
  });
  it("passes staff-facing DB messages, hides everything else", () => {
    expect(pesanPetugas("Ada beberapa pemilik dengan nomor HP ini; pilih pemiliknya")).toBe("Ada beberapa pemilik dengan nomor HP ini; pilih pemiliknya");
    expect(pesanPetugas('relation "kamo_import.kartu_tertunda" does not exist')).toBe("Kartu belum dapat disimpan. Coba lagi atau hubungi admin.");
    expect(pesanPetugas(null)).toMatch(/belum dapat disimpan/);
  });
  it("never auto-uses a phone the card flags as problematic; lists date choices without duplicates", () => {
    expect(hpKartuSah({ kekurangan: ["hp_angka"], isi: { phone: "8812345678" } })).toBeNull();
    expect(hpKartuSah({ kekurangan: ["tanggal_bentrok"], isi: { phone: " 081234567890 " } })).toBe("081234567890");
    expect(pilihanTanggal({ tanggal_tab: "2024-09-29", tanggal_sel: "2024-04-29", tanggal_usulan: "2024-04-29" }).map((t) => t.tanggal)).toEqual(["2024-04-29", "2024-09-29"]);
  });
});

// ------------------------------------------------------------------------------------------------- server actions
const db = vi.hoisted(() => ({ role: "OWNER", active: true, rpc: [] as { name: string; args: unknown }[], hasil: { data: null as unknown, error: null as null | { message: string } } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: db.role, is_active: db.active }, error: null }) }) }) }),
  rpc: async (name: string, args: unknown) => { db.rpc.push({ name, args }); return db.hasil; },
}) }));

describe("kartu tertunda — server actions", () => {
  beforeEach(() => { db.role = "OWNER"; db.active = true; db.rpc = []; db.hasil = { data: ID2, error: null }; });
  const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  it("completes a card through the RPC and returns to the list with a success message", async () => {
    const { lengkapiKartuTertunda } = await import("@/app/(app)/klinik/rekam-medis/perlu-dilengkapi/actions");
    await expect(lengkapiKartuTertunda(form({ id: ID, phone: "081234567890", record_date: "2024-09-29" }))).rejects.toThrow(/REDIRECT \/klinik\/rekam-medis\/perlu-dilengkapi\?ok=/);
    expect(db.rpc).toEqual([{ name: "lengkapi_kartu_tertunda", args: expect.objectContaining({ p_id: ID, p_phone: "081234567890", p_record_date: "2024-09-29" }) }]);
  });
  it("non-OWNER/ADMIN never reaches the RPC; DB errors come back as staff messages with the phone kept", async () => {
    const { lengkapiKartuTertunda, batalkanKartuTertunda } = await import("@/app/(app)/klinik/rekam-medis/perlu-dilengkapi/actions");
    db.role = "DOCTOR";
    await expect(lengkapiKartuTertunda(form({ id: ID, phone: "0812" }))).rejects.toThrow(/error=Hanya\+OWNER/);
    expect(db.rpc).toHaveLength(0);
    db.role = "ADMIN"; db.hasil = { data: null, error: { message: "Ada beberapa pemilik dengan nomor HP ini; pilih pemiliknya" } };
    await expect(lengkapiKartuTertunda(form({ id: ID, phone: "081234567890" }))).rejects.toThrow(/hp=081234567890&error=Ada\+beberapa\+pemilik/);
    await expect(batalkanKartuTertunda(form({ id: ID, alasan: " " }))).rejects.toThrow(/Alasan/);
    db.hasil = { data: null, error: null };
    await expect(batalkanKartuTertunda(form({ id: ID, alasan: "Salinan" }))).rejects.toThrow(/ok=Kartu\+dibatalkan/);
    expect(db.rpc.at(-1)).toEqual({ name: "batalkan_kartu_tertunda", args: { p_id: ID, p_alasan: "Salinan" } });
  });
});
