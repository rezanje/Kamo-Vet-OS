import { beforeEach, expect, it, vi } from "vitest";
import { simpanBernomor, tabrakanNomor } from "../simpan-bernomor";

// Database tiruan seperlunya: satu daftar nomor yang TERBACA (bisa tertinggal dari
// kenyataan, persis seperti dua kasir yang menyimpan pada detik yang sama) dan satu
// daftar nomor yang BENAR-BENAR sudah dipakai.
const db = { terbaca: [] as string[], dipakai: new Set<string>(), terlihatSetelahTabrakan: true };

function supabase() {
  return {
    from(table: string) {
      let prefix = "";
      const query = {
        select: () => query,
        eq: () => query,
        like: (_kolom: string, pola: string) => { prefix = pola.slice(0, -1); return query; },
        order: () => query,
        limit: () => query,
        // document_numbering kosong → format bawaan POS-YYYYMMDD-NNNN dipakai.
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (value: unknown) => unknown) => {
          const cocok = table === "sales" ? db.terbaca.filter((n) => n.startsWith(prefix)).sort() : [];
          return Promise.resolve({ data: cocok.slice(-1).map((no_struk) => ({ no_struk })), error: null }).then(resolve);
        },
      };
      return query;
    },
  };
}

/** Sisipan tiruan: nomor yang sudah dipakai ditolak unique constraint, seperti Postgres. */
function sisipan(dicoba: string[]) {
  return async (nomor: string) => {
    dicoba.push(nomor);
    if (db.dipakai.has(nomor)) {
      // Baris lawan jadi terbaca sesudah transaksinya commit.
      if (db.terlihatSetelahTabrakan && !db.terbaca.includes(nomor)) db.terbaca.push(nomor);
      return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "sales_no_struk_key"' } };
    }
    db.dipakai.add(nomor);
    db.terbaca.push(nomor);
    return { data: { id: `sale-${nomor}` }, error: null };
  };
}

const opsi = { jenis: "POS", tanggal: "2026-10-29", table: "sales", column: "no_struk" };

beforeEach(() => { db.terbaca = []; db.dipakai = new Set(); db.terlihatSetelahTabrakan = true; });

it("mengenali tabrakan nomor struk, bukan tabrakan unik lain", () => {
  expect(tabrakanNomor({ code: "23505", message: 'duplicate key value violates unique constraint "sales_no_struk_key"' }, "no_struk")).toBe(true);
  expect(tabrakanNomor({ code: "23505", message: 'duplicate key value violates unique constraint "sales_checkout_key_key"' }, "no_struk")).toBe(false);
  expect(tabrakanNomor({ code: "42501", message: "no_struk" }, "no_struk")).toBe(false);
  expect(tabrakanNomor(null, "no_struk")).toBe(false);
});

it("memakai nomor berikutnya saat nomor pertama direbut transaksi lain", async () => {
  db.terbaca = ["POS-20261029-0001"];
  db.dipakai = new Set(["POS-20261029-0001", "POS-20261029-0002"]);
  const dicoba: string[] = [];

  const hasil = await simpanBernomor<{ id: string }>(supabase(), opsi, sisipan(dicoba));

  expect(dicoba).toEqual(["POS-20261029-0002", "POS-20261029-0003"]);
  expect(hasil).toMatchObject({ nomor: "POS-20261029-0003", bentrok: false, error: null });
  expect(hasil.data).toEqual({ id: "sale-POS-20261029-0003" });
});

it("menempuh nomor berikutnya lalu suffix acak saat pembacaan ulang masih tertinggal", async () => {
  db.terbaca = ["POS-20261029-0001"];
  db.dipakai = new Set(["POS-20261029-0001", "POS-20261029-0002", "POS-20261029-0003"]);
  db.terlihatSetelahTabrakan = false; // nomor lawan belum ikut terbaca
  const dicoba: string[] = [];

  const hasil = await simpanBernomor<{ id: string }>(supabase(), opsi, sisipan(dicoba));

  expect(dicoba.slice(0, 2)).toEqual(["POS-20261029-0002", "POS-20261029-0003"]);
  expect(dicoba).toHaveLength(3);
  expect(hasil.nomor).toMatch(/^POS-20261029-0002-[0-9A-Z]{4}$/);
  expect(hasil.bentrok).toBe(false);
});

it("tidak mengulang error selain tabrakan nomor", async () => {
  db.terbaca = ["POS-20261029-0001"];
  const dicoba: string[] = [];
  const hasil = await simpanBernomor<{ id: string }>(supabase(), opsi, async (nomor) => {
    dicoba.push(nomor);
    return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
  });

  expect(dicoba).toEqual(["POS-20261029-0002"]);
  expect(hasil).toMatchObject({ data: null, bentrok: false });
  expect(hasil.error?.code).toBe("42501");
});

it("tidak mengulang tabrakan checkout_key — itu urusan perlindungan pengulangan", async () => {
  db.terbaca = ["POS-20261029-0001"];
  const dicoba: string[] = [];
  const hasil = await simpanBernomor<{ id: string }>(supabase(), opsi, async (nomor) => {
    dicoba.push(nomor);
    return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "sales_checkout_key_key"' } };
  });

  expect(dicoba).toHaveLength(1);
  expect(hasil.bentrok).toBe(false);
});

it("menyerah dengan tanda bentrok setelah lima percobaan, semuanya bernomor berbeda", async () => {
  db.terbaca = ["POS-20261029-0001"];
  const dicoba: string[] = [];
  const hasil = await simpanBernomor<{ id: string }>(supabase(), opsi, async (nomor) => {
    dicoba.push(nomor);
    return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "sales_no_struk_key"' } };
  });

  expect(dicoba).toHaveLength(5);
  expect(new Set(dicoba).size).toBe(5);
  expect(hasil).toMatchObject({ data: null, bentrok: true });
});

it("menghormati batas percobaan yang diminta pemanggil", async () => {
  db.terbaca = ["POS-20261029-0001"];
  const sisip = vi.fn(async () => ({ data: null, error: { code: "23505", message: "sales_no_struk_key" } }));
  const hasil = await simpanBernomor<{ id: string }>(supabase(), { ...opsi, percobaan: 2 }, sisip);

  expect(sisip).toHaveBeenCalledTimes(2);
  expect(hasil.bentrok).toBe(true);
});
