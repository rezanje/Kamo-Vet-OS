import { describe, it, expect } from "vitest";
import { postJournal, prefixJurnal } from "../posting";
import { kandidatNomor, prefixBulanan, seqDariNomor, ymDari } from "../no-dokumen";

// Mock supabase minimal: rekam insert; coa_accounts kenal 1101 & 4101 saja.
function makeClient() {
  const inserted: { table: string; payload: unknown }[] = [];
  const client = {
    inserted,
    from(table: string) {
      return {
        select() {
          const chain = {
            in: async () => ({
              data: [
                { id: "acc-1101", code: "1101" },
                { id: "acc-4101", code: "4101" },
              ].filter(() => table === "coa_accounts"),
              error: null,
            }),
            // nomor jurnal dibaca dari entri tertinggi bulan itu, bukan dari count
            like: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }),
          };
          return chain;
        },
        insert(payload: unknown) {
          inserted.push({ table, payload });
          return {
            select: () => ({ single: async () => ({ data: { id: "entry-1" }, error: null }) }),
            then: (res: (v: { error: null }) => void) => res({ error: null }),
          };
        },
        delete: () => ({ eq: async () => ({}) }),
      };
    },
  };
  return client;
}

describe("postJournal guards", () => {
  it("tolak jurnal tidak seimbang (tidak insert apa pun)", async () => {
    const c = makeClient();
    await postJournal(c, {
      tanggal: "2026-07-15", deskripsi: "x", source: "manual",
      lines: [
        { code: "1101", debit: 1000, credit: 0 },
        { code: "4101", debit: 0, credit: 900 },
      ],
    });
    expect(c.inserted.length).toBe(0);
  });

  it("tolak jurnal kosong / nol", async () => {
    const c = makeClient();
    await postJournal(c, {
      tanggal: "2026-07-15", deskripsi: "x", source: "manual",
      lines: [{ code: "1101", debit: 0, credit: 0 }],
    });
    expect(c.inserted.length).toBe(0);
  });

  it("tolak kalau ada kode akun tidak dikenal", async () => {
    const c = makeClient();
    await postJournal(c, {
      tanggal: "2026-07-15", deskripsi: "x", source: "manual",
      lines: [
        { code: "9999", debit: 1000, credit: 0 },
        { code: "4101", debit: 0, credit: 1000 },
      ],
    });
    expect(c.inserted.length).toBe(0);
  });

  it("jurnal seimbang → insert header + lines", async () => {
    const c = makeClient();
    await postJournal(c, {
      tanggal: "2026-07-15", deskripsi: "jual", source: "sale",
      lines: [
        { code: "1101", debit: 1000, credit: 0 },
        { code: "4101", debit: 0, credit: 1000 },
      ],
    });
    const tables = c.inserted.map((i) => i.table);
    expect(tables).toContain("journal_entries");
    expect(tables).toContain("journal_lines");
  });

  it("tidak pernah melempar error (best-effort)", async () => {
    const broken = { from() { throw new Error("db down"); } };
    await expect(postJournal(broken, {
      tanggal: "2026-07-15", deskripsi: "x", source: "manual",
      lines: [
        { code: "1101", debit: 1, credit: 0 },
        { code: "4101", debit: 0, credit: 1 },
      ],
    })).resolves.toBeUndefined();
  });
});

describe("penomoran dokumen", () => {
  const P = "JRN-202608-";

  it("prefix jurnal diambil dari string tanggal, bukan objek Date (tidak geser timezone)", () => {
    expect(prefixJurnal("2026-08-04")).toBe("JRN-202608");
    expect(prefixJurnal("2026-01-01")).toBe("JRN-202601");
  });

  it("bulan kosong mulai dari 1", () => {
    expect(seqDariNomor(null, P, 4) + 1).toBe(1);
  });

  it("lanjut dari nomor tertinggi, bukan dari jumlah entri", () => {
    // Inti bug 2026-08-04: 5 entri tersisa tapi nomor terakhir 0006 (0002 & 0007
    // sudah terhapus). count+1 menghasilkan 0006 → menabrak entri lama, dan SEMUA
    // pencatatan jurnal bulan itu berhenti.
    expect(seqDariNomor(`${P}0006`, P, 4) + 1).toBe(7);
  });

  it("nomor bersuffix acak tetap terbaca", () => {
    expect(seqDariNomor(`${P}0012-AB12`, P, 4) + 1).toBe(13);
  });

  it("nomor rusak tidak bikin NaN", () => {
    expect(seqDariNomor(`${P}xxxx`, P, 4) + 1).toBe(1);
  });

  it("prefix bulanan pola Accurate & pembacaan baliknya cocok", () => {
    const pre = prefixBulanan("FJ", "2026-08");
    expect(pre).toBe("FJ.2026.08.");
    expect(seqDariNomor(`${pre}00042`, pre, 5) + 1).toBe(43);
  });

  it("ymDari tidak lewat UTC (tanggal 1 jam 00:00 lokal tetap bulan itu)", () => {
    expect(ymDari(new Date(2026, 7, 1))).toBe("2026-08");
    expect(ymDari(new Date(2026, 0, 1))).toBe("2026-01");
  });

  it("kandidat nomor: dua beruntun lalu suffix acak", () => {
    expect(kandidatNomor("TB.2026.08.", 7, 5, "AB12")).toEqual([
      "TB.2026.08.00007",
      "TB.2026.08.00008",
      "TB.2026.08.00007-AB12",
    ]);
  });
});
