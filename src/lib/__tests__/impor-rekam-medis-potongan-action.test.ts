import { beforeEach, expect, it, vi } from "vitest";

type BarisMassal = Record<string, unknown>;
const db = vi.hoisted(() => ({
  role: "OWNER" as string | null,
  owners: [] as Array<{ id: string; name: string; phone: string | null }>,
  pets: [] as Array<{ id: string; customer_id: string; name: string }>,
  tersimpan: new Set<string>(),
  panggilan: [] as Array<{ name: string; args: Record<string, unknown> }>,
  scanError: "" as string,
  bulkError: "" as string,
  gagalBaris: new Map<string, string>(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.role ? { id: "aktor" } : null } }) },
    from() {
      const q = { select: () => q, eq: () => q, in: () => q, order: () => q, maybeSingle: async () => ({ data: { role: db.role } }) };
      return q;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      db.panggilan.push({ name, args });
      if (name === "import_legacy_identity_scan") {
        if (db.scanError) return { data: null, error: { message: db.scanError } };
        const sumber = (args.p_source_keys as string[]) ?? [];
        return { data: { sudah_ada: sumber.filter((key) => db.tersimpan.has(key)), customers: db.owners, pets: db.pets }, error: null };
      }
      if (db.bulkError) return { data: null, error: { message: db.bulkError } };
      const rows = (args.p_rows as BarisMassal[]) ?? [];
      return {
        data: rows.map((row) => {
          const key = String(row.source_key);
          const gagal = db.gagalBaris.get(key);
          if (gagal) return { source_key: key, status: "ditahan", reason: gagal, visit_id: null };
          if (db.tersimpan.has(key)) return { source_key: key, status: "sudah_ada", reason: null, visit_id: "kunjungan" };
          db.tersimpan.add(key);
          return { source_key: key, status: "tersimpan", reason: null, visit_id: `kunjungan-${key}` };
        }),
        error: null,
      };
    },
  }),
}));

import { prosesPotonganImporRekamMedis } from "@/app/(app)/klinik/rekam-medis/impor/actions";
import { MAKS_BARIS_POTONGAN_REKAM_MEDIS } from "@/lib/impor-rekam-medis-aliran";
import type { RekamMedisImporRow } from "@/lib/impor-rekam-medis";

function baris(ubah: Partial<RekamMedisImporRow> = {}): RekamMedisImporRow {
  return {
    source_key: "pemilik fiktif::0800000001::anabul::01012026", source_file: "Anabul.xlsx", source_sheet: "01012026",
    record_no: null, record_date: "2026-01-01", patient_name: "Anabul", owner_name: "Pemilik Fiktif",
    phone: "0800000001", address: null, species: null, breed: null, gender: null, dob: null, doctor: null,
    note: null, anamnesis: "Riwayat fiktif", clinical_findings: null, diagnosis: null, therapy: null, warning: [],
    ...ubah,
  };
}

const massal = () => db.panggilan.filter((item) => item.name === "import_legacy_medical_records_bulk");
const pindai = () => db.panggilan.filter((item) => item.name === "import_legacy_identity_scan");

beforeEach(() => {
  db.role = "OWNER";
  db.owners = [];
  db.pets = [];
  db.tersimpan = new Set();
  db.panggilan = [];
  db.scanError = "";
  db.bulkError = "";
  db.gagalBaris = new Map();
});

it("menyimpan satu potongan dengan satu pemindaian dan satu transaksi massal", async () => {
  const rows = Array.from({ length: 40 }, (_, index) => baris({ source_key: `kunci-${index}`, source_sheet: `sheet-${index}` }));
  const hasil = await prosesPotonganImporRekamMedis(rows, [], true);
  expect(hasil).toMatchObject({ ok: true, tersimpan: 40, sudah_ada: 0, dilewati: 0 });
  expect(pindai()).toHaveLength(1);
  expect(massal()).toHaveLength(1);
  expect((massal()[0].args.p_rows as BarisMassal[])).toHaveLength(40);
  expect((massal()[0].args.p_rows as BarisMassal[])[0].record_date).toBe("2026-01-01T00:00:00+07:00");
});

it("memecah kiriman besar menjadi beberapa transaksi, bukan satu per baris", async () => {
  const rows = Array.from({ length: 200 }, (_, index) => baris({ source_key: `kunci-${index}` }));
  const hasil = await prosesPotonganImporRekamMedis(rows, [], true);
  expect(hasil.tersimpan).toBe(200);
  expect(massal()).toHaveLength(2);
  expect(massal().map((item) => (item.args.p_rows as BarisMassal[]).length)).toEqual([150, 50]);
});

it("menolak kiriman melebihi batas potongan sebelum menyentuh database", async () => {
  const rows = Array.from({ length: MAKS_BARIS_POTONGAN_REKAM_MEDIS + 1 }, (_, index) => baris({ source_key: `kunci-${index}` }));
  expect(await prosesPotonganImporRekamMedis(rows, [], true)).toMatchObject({ ok: false, message: expect.stringContaining("Terlalu banyak") });
  expect(db.panggilan).toEqual([]);
});

it("mengulang potongan yang sama tanpa menulis dua kali", async () => {
  const rows = [baris()];
  await prosesPotonganImporRekamMedis(rows, [], true);
  const ulang = await prosesPotonganImporRekamMedis(rows, [], true);
  expect(ulang).toMatchObject({ ok: true, tersimpan: 0, sudah_ada: 1 });
  // Jejak yang sudah tercatat tetap dikirim supaya database membuktikan isinya identik (K1b),
  // tetapi database tidak menulis apa pun untuknya.
  expect(massal()).toHaveLength(2);
  expect(db.tersimpan.size).toBe(1);
});

it("mengembalikan jejak yang tersimpan atau sudah ada (untuk Periksa hasil), bukan yang ditahan", async () => {
  db.tersimpan.add("lama");
  db.gagalBaris.set("tahan", "Jejak sumber bentrok: isinya berbeda");
  const hasil = await prosesPotonganImporRekamMedis([baris({ source_key: "baru" }), baris({ source_key: "lama" }), baris({ source_key: "tahan" })], [], true);
  expect(hasil).toMatchObject({ ok: true, tersimpan: 1, sudah_ada: 1 });
  expect(hasil.kunci_tersimpan.sort()).toEqual(["baru", "lama"]);
  expect(hasil.ditahan.map((item) => item.source_key)).toEqual(["tahan"]);
});

it("jejak tercatat dikirim tanpa pilihan identitas dan tanpa ditanyakan ulang", async () => {
  db.tersimpan.add(baris().source_key);
  db.owners = [{ id: "pemilik", name: "Pemilik Lain", phone: "0800000001" }];
  const hasil = await prosesPotonganImporRekamMedis([baris()], [], true);
  expect(hasil).toMatchObject({ ok: true, tersimpan: 0, sudah_ada: 1, perlu_keputusan: [] });
  expect((massal()[0].args.p_rows as BarisMassal[])[0]).toMatchObject({ customer_id: null, pet_id: null });
});

it("jejak sama dengan isi berbeda yang ditolak database dilaporkan sebagai ditahan beserta alasannya", async () => {
  db.tersimpan.add(baris().source_key);
  db.gagalBaris.set(baris().source_key, "Jejak sumber bentrok: isinya berbeda");
  const hasil = await prosesPotonganImporRekamMedis([baris({ diagnosis: "Lain" })], [], true);
  expect(hasil).toMatchObject({ ok: true, tersimpan: 0, sudah_ada: 0 });
  expect(hasil.ditahan).toEqual([expect.objectContaining({ source_key: baris().source_key, reason: expect.stringContaining("bentrok") })]);
});

it("membawa identitas persis yang dikenali pemindaian ke penyimpanan", async () => {
  db.owners = [{ id: "pemilik", name: "Pemilik  Fiktif.", phone: "0800-000-001" }];
  db.pets = [{ id: "anabul", customer_id: "pemilik", name: "anabul" }];
  await prosesPotonganImporRekamMedis([baris()], [], true);
  expect((massal()[0].args.p_rows as BarisMassal[])[0]).toMatchObject({ customer_id: "pemilik", pet_id: "anabul" });
});

it("menunda pertanyaan identitas tanpa menghentikan aliran baris lain", async () => {
  db.owners = [{ id: "pemilik", name: "Pemilik Lain", phone: "0800000001" }];
  const jelas = baris({ source_key: "jelas", owner_name: "Pemilik Baru", phone: "0899999999" });
  const hasil = await prosesPotonganImporRekamMedis([baris(), jelas], [], true);
  expect(hasil.ok).toBe(true);
  expect(hasil.perlu_keputusan.map((item) => item.source_key)).toEqual([baris().source_key]);
  expect(hasil.tersimpan).toBe(1);
  expect((massal()[0].args.p_rows as BarisMassal[]).map((row) => row.source_key)).toEqual(["jelas"]);
});

it("menyimpan baris tertunda setelah keputusannya diberikan", async () => {
  db.owners = [{ id: "pemilik", name: "Pemilik Lain", phone: "0800000001" }];
  const tertunda = await prosesPotonganImporRekamMedis([baris()], [], true);
  expect(tertunda.perlu_keputusan).toHaveLength(1);
  db.panggilan = [];
  const hasil = await prosesPotonganImporRekamMedis([baris()], [{ source_key: baris().source_key, decision: { customer_id: "pemilik", pet_id: null } }], true);
  expect(hasil).toMatchObject({ ok: true, tersimpan: 1 });
  expect((massal()[0].args.p_rows as BarisMassal[])[0]).toMatchObject({ customer_id: "pemilik", pet_id: null });
});

it("menahan baris saat pilihan identitas sudah tidak cocok lagi, tanpa menjatuhkan potongan", async () => {
  db.owners = [{ id: "pemilik", name: "Pemilik Lain", phone: "0800000001" }];
  const lain = baris({ source_key: "lain", owner_name: "Pemilik Baru", phone: "0899999999" });
  const hasil = await prosesPotonganImporRekamMedis([baris(), lain], [{ source_key: baris().source_key, decision: { customer_id: "sudah-hilang", pet_id: null } }], true);
  expect(hasil.ok).toBe(true);
  expect(hasil.ditahan.map((item) => item.reason)).toEqual([expect.stringContaining("sudah berubah")]);
  expect(hasil.tersimpan).toBe(1);
});

it("menghormati keputusan lewati tanpa mengirimnya ke database", async () => {
  const hasil = await prosesPotonganImporRekamMedis([baris()], [{ source_key: baris().source_key, decision: "skip" }], true);
  expect(hasil).toMatchObject({ ok: true, tersimpan: 0, dilewati: 1 });
  expect(massal()).toEqual([]);
  expect(pindai()).toEqual([]);
});

it("melaporkan baris yang ditolak database beserta file dan alasannya", async () => {
  db.gagalBaris.set("rusak", "Tanggal, pemilik, nomor telepon, dan pasien wajib diisi");
  const hasil = await prosesPotonganImporRekamMedis([baris({ source_key: "rusak", source_file: "Rusak.xlsx" }), baris({ source_key: "baik" })], [], true);
  expect(hasil).toMatchObject({ ok: true, tersimpan: 1 });
  expect(hasil.ditahan).toEqual([{ source_key: "rusak", source_file: "Rusak.xlsx", source_sheet: "01012026", reason: "Tanggal, pemilik, nomor telepon, dan pasien wajib diisi" }]);
});

it("menolak pengguna tanpa peran impor sebelum menyentuh database", async () => {
  db.role = "STAFF";
  expect(await prosesPotonganImporRekamMedis([baris()], [], true)).toMatchObject({ ok: false, message: expect.stringContaining("OWNER/ADMIN") });
  expect(db.panggilan).toEqual([]);
});

it("menolak kiriman tanpa persetujuan", async () => {
  expect(await prosesPotonganImporRekamMedis([baris()], [], false)).toMatchObject({ ok: false, message: expect.stringContaining("persetujuan") });
  expect(db.panggilan).toEqual([]);
});

it("menerjemahkan fungsi database yang belum ada menjadi pesan yang bisa ditindaklanjuti", async () => {
  db.scanError = 'Could not find the function public.import_legacy_identity_scan in the schema cache';
  expect(await prosesPotonganImporRekamMedis([baris()], [], true)).toMatchObject({ ok: false, message: expect.stringContaining("Database belum diperbarui") });
});

it("meneruskan batas waktu database apa adanya supaya layar bisa mengulang potongan", async () => {
  db.bulkError = "canceling statement due to statement timeout";
  const hasil = await prosesPotonganImporRekamMedis([baris({ source_key: "a" }), baris({ source_key: "b" })], [], true);
  expect(hasil).toMatchObject({ ok: false, tersimpan: 0, message: expect.stringContaining("statement timeout") });
});

it("mengirim kunci yang sudah dinormalkan ke pemindaian identitas", async () => {
  await prosesPotonganImporRekamMedis([baris({ owner_name: "Pemilik  Fiktif.", phone: "0800-000-0001" })], [], true);
  expect(pindai()[0].args).toMatchObject({ p_owner_keys: ["pemilik fiktif"], p_phone_keys: ["08000000001"] });
});

it("mengirim kunci HP kanonik: +62 dan 08 menjadi satu kunci pemindaian", async () => {
  await prosesPotonganImporRekamMedis([
    baris({ source_key: "a", phone: "+62 800-000-0001" }),
    baris({ source_key: "b", phone: "0800-000-0001" }),
  ], [], true);
  expect(pindai()[0].args).toMatchObject({ p_phone_keys: ["08000000001"] });
});
