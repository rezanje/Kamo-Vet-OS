import { describe, it, expect } from "vitest";
import { postJournal } from "../posting";

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
            like: async () => ({ count: 0 }),
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
