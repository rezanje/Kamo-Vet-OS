import { describe, it, expect } from "vitest";
import { getAccountBalances, getAccountLedger, getAccountOpening, getOpeningBalances, nilaiSeksi, adaAngka, akunAdaAngka, parseTampilanAkun, saringAkunTampil, PARAM_TAMPILAN_AKUN } from "../ledger";

// Mock supabase minimal: coa_accounts tetap, journal_lines difilter oleh chain gte/lte/eq/in
// persis seperti fetchLines() memanggilnya (query-builder chainable + thenable).
type Line = {
  account_id: string; debit: number; credit: number;
  journal_entries: { tanggal: string; branch_id: string | null; source: string; source_ref?: string | null; no_jurnal: string | null; deskripsi: string | null; branches?: { name: string } | null };
};

// Setiap penyaring account_id yang dikirim ke journal_lines — untuk memastikan rincian satu akun
// tidak menarik jurnal seluruh akun.
let accountFilters: string[][] = [];

function makeClient(accounts: { id: string; code: string; name: string; type: string; normal_balance: string }[], lines: Line[]) {
  return {
    from(table: string) {
      if (table === "coa_accounts") {
        const builder = {
          select() { return builder; },
          order() { return builder; },
          range(from: number, to: number) { return Promise.resolve({ data: accounts.slice(from, to + 1), count: accounts.length, error: null }); },
          eq(_col: string, val: string) { return { order() { return { range() { const data = accounts.filter(a => a.code === val); return Promise.resolve({ data, count: data.length, error: null }); } }; } }; },
          then(resolve: (v: { data: typeof accounts }) => void) { return resolve({ data: accounts }); },
        };
        return builder;
      }
      if (table === "journal_lines") {
        let rows = lines.map((line, id) => ({ ...line, id: String(id) }));
        const builder = {
          select() { return builder; },
          order() { return builder; },
          range(from: number, to: number) { return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null }); },
          gte(_col: string, val: string) { rows = rows.filter((l) => l.journal_entries.tanggal >= val); return builder; },
          lte(_col: string, val: string) { rows = rows.filter((l) => l.journal_entries.tanggal <= val); return builder; },
          eq(col: string, val: string) { rows = rows.filter((l) => (col === "account_id" ? l.account_id : l.journal_entries.branch_id) === val); return builder; },
          in(col: string, vals: string[]) {
            if (col === "account_id") accountFilters.push(vals);
            rows = rows.filter((l) => vals.includes((col === "account_id" ? l.account_id : l.journal_entries.branch_id) as string));
            return builder;
          },
          then(resolve: (v: { data: Line[] }) => void) { return resolve({ data: rows }); },
        };
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const accounts = [
  { id: "acc-4101", code: "510001", name: "Penjualan", type: "PENDAPATAN", normal_balance: "K" },
];

const lines: Line[] = [
  { account_id: "acc-4101", debit: 0, credit: 100_000, journal_entries: { tanggal: "2026-07-01", branch_id: "b1", source: "sale", no_jurnal: "J1", deskripsi: null } },
  { account_id: "acc-4101", debit: 0, credit: 200_000, journal_entries: { tanggal: "2026-07-02", branch_id: "b2", source: "sale", no_jurnal: "J2", deskripsi: null } },
];

describe("getAccountBalances — filter branchIds", () => {
  it("branchIds undefined = tanpa filter cabang (semua baris ikut)", async () => {
    const c = makeClient(accounts, lines);
    const bal = await getAccountBalances(c, {});
    expect(bal.find((b) => b.code === "510001")?.saldo).toBe(300_000);
  });

  it("branchIds [] (allow-list eksplisit kosong) = tidak ada baris, BUKAN semua cabang", async () => {
    const c = makeClient(accounts, lines);
    const bal = await getAccountBalances(c, { branchIds: [] });
    expect(bal.find((b) => b.code === "510001")?.saldo).toBe(0);
  });

  it("branchIds terisi = filter seperti biasa", async () => {
    const c = makeClient(accounts, lines);
    const bal = await getAccountBalances(c, { branchIds: ["b1"] });
    expect(bal.find((b) => b.code === "510001")?.saldo).toBe(100_000);
  });
});

describe("getAccountLedger — asal cabang", () => {
  it("membawa nama cabang di rincian akun", async () => {
    const source = [{ ...lines[0], journal_entries: { ...lines[0].journal_entries, source_ref: "INV-1", branches: { name: "Klinik A" } } }];
    const ledger = await getAccountLedger(makeClient(accounts, source), "510001");
    expect(ledger[0]).toMatchObject({ no_jurnal: "J1", source_ref: "INV-1", branch_id: "b1", branch_name: "Klinik A" });
  });
});

describe("nilaiSeksi — akun kontra jadi pengurang kelompoknya", () => {
  it("aset biasa (saldo normal D) tetap positif", () => {
    expect(nilaiSeksi({ type: "ASET", normal: "D", saldo: 1_000_000 })).toBe(1_000_000);
  });

  // Akumulasi Penyusutan: bertipe ASET tapi saldo normal Kredit. Kalau ini positif,
  // penyusutan malah MENAMBAH total aktiva.
  it("akumulasi penyusutan (ASET saldo normal K) mengurangi total aktiva", () => {
    expect(nilaiSeksi({ type: "ASET", normal: "K", saldo: 822_083 })).toBe(-822_083);
  });

  it("liabilitas & ekuitas normal K tetap positif; potongan bersaldo D jadi negatif", () => {
    expect(nilaiSeksi({ type: "LIABILITAS", normal: "K", saldo: 500_000 })).toBe(500_000);
    expect(nilaiSeksi({ type: "EKUITAS", normal: "D", saldo: 250_000 })).toBe(-250_000);
  });

  it("neraca tetap seimbang setelah aturan ini diterapkan", () => {
    const akun = [
      { type: "ASET", normal: "D", saldo: 1_415_000 },       // kas & bank
      { type: "ASET", normal: "K", saldo: 822_083 },          // akumulasi penyusutan
      { type: "ASET", normal: "D", saldo: 1_000_000 },        // aset tetap
      { type: "LIABILITAS", normal: "K", saldo: 180_000 },
      { type: "EKUITAS", normal: "K", saldo: 1_412_917 },
    ];
    const sisi = (t: string) => akun.filter((a) => a.type === t).reduce((s, a) => s + nilaiSeksi(a), 0);
    expect(sisi("ASET")).toBe(sisi("LIABILITAS") + sisi("EKUITAS"));
  });
});

it("includes every journal line beyond the API row cap in financial totals and account detail", async () => {
  const manyLines = Array.from({ length: 1201 }, () => ({ ...lines[0], credit: 100 }));
  const balances = await getAccountBalances(makeClient(accounts, manyLines));
  expect(balances[0].saldo).toBe(120_100);
  expect(await getAccountLedger(makeClient(accounts, manyLines), "510001")).toHaveLength(1201);
});

describe("getAccountBalances — agregat di database (ledger_account_totals)", () => {
  type HasilRpc = { data: unknown; error: { code?: string; message?: string } | null };
  function withRpc(result: HasilRpc | ((name: string) => HasilRpc)) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    let linesRead = false;
    const base = makeClient(accounts, lines);
    const client = {
      from(table: string) { if (table === "journal_lines") linesRead = true; return base.from(table); },
      rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args }); return Promise.resolve(typeof result === "function" ? result(name) : result); },
    };
    return { client, calls, linesRead: () => linesRead };
  }

  it("memakai total dari RPC tanpa menarik baris jurnal", async () => {
    const t = withRpc({ data: [{ account_id: "acc-4101", debit: 0, credit: "750000.50" }], error: null });
    const bal = await getAccountBalances(t.client, { from: "2026-01-01", to: "2026-11-09", branchId: "b1" });
    expect(bal.find((b) => b.code === "510001")?.saldo).toBe(750_000.5);
    expect(t.calls).toEqual([{ name: "ledger_account_totals", args: { p_from: "2026-01-01", p_to: "2026-11-09", p_branch_ids: ["b1"] } }]);
    expect(t.linesRead()).toBe(false);
  });

  it("tanpa filter = semua null; branchId + branchIds = irisan", async () => {
    const t = withRpc({ data: [], error: null });
    await getAccountBalances(t.client);
    await getAccountBalances(t.client, { branchId: "b2", branchIds: ["b1", "b2"] });
    expect(t.calls.map((c) => c.args)).toEqual([
      { p_from: null, p_to: null, p_branch_ids: null },
      { p_from: null, p_to: null, p_branch_ids: ["b2"] },
    ]);
  });

  it("allow-list kosong / irisan kosong = nol tanpa memanggil database", async () => {
    const t = withRpc({ data: [], error: null });
    expect((await getAccountBalances(t.client, { branchIds: [] })).find((b) => b.code === "510001")?.saldo).toBe(0);
    expect((await getAccountBalances(t.client, { branchId: "b3", branchIds: ["b1"] })).find((b) => b.code === "510001")?.saldo).toBe(0);
    expect(t.calls).toHaveLength(0);
  });

  it("fungsi belum dipasang -> kembali ke pembaca lama, hasil sama", async () => {
    const t = withRpc((name) => ({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}(p_branch_ids, p_from, p_to) in the schema cache` } }));
    const bal = await getAccountBalances(t.client, {});
    expect(bal.find((b) => b.code === "510001")?.saldo).toBe(300_000);
    expect(t.linesRead()).toBe(true);
  });

  it("galat lain (mis. batas waktu) dilempar, tidak diam-diam jadi saldo nol", async () => {
    const t = withRpc({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    await expect(getAccountBalances(t.client, {})).rejects.toThrow("statement timeout");
    const lain = withRpc({ data: null, error: { code: "42883", message: "function public.other_fn(uuid) does not exist" } });
    await expect(getAccountBalances(lain.client, {})).rejects.toThrow("other_fn");
  });
});

describe("Buku Besar per akun — hanya menarik baris akun yang dibuka", () => {
  const dua = [
    ...accounts,
    { id: "acc-7200", code: "720004", name: "Beban Internet", type: "BEBAN", normal_balance: "D" },
  ];
  const campur: Line[] = [
    ...lines,
    { account_id: "acc-7200", debit: 50_000, credit: 0, journal_entries: { tanggal: "2026-10-20", branch_id: "b1", source: "expense", no_jurnal: "J0", deskripsi: null } },
    { account_id: "acc-7200", debit: 75_000, credit: 0, journal_entries: { tanggal: "2026-11-05", branch_id: "b1", source: "expense", no_jurnal: "J3", deskripsi: null } },
  ];

  it("mutasi disaring account_id di database, bukan seluruh jurnal lalu dibuang di aplikasi", async () => {
    accountFilters = [];
    const ledger = await getAccountLedger(makeClient(dua, campur), "720004", { from: "2026-11-01", to: "2026-11-15" });
    expect(ledger.map((l) => l.no_jurnal)).toEqual(["J3"]);
    expect(accountFilters).toEqual([["acc-7200"]]);
  });

  it("saldo awal memakai agregat database, tanpa menarik riwayat baris jurnal", async () => {
    let linesRead = false;
    const calls: Record<string, unknown>[] = [];
    const base = makeClient(dua, campur);
    const client = {
      from(t: string) { if (t === "journal_lines") linesRead = true; return base.from(t); },
      rpc(_n: string, args: Record<string, unknown>) { calls.push(args); return Promise.resolve({ data: [{ account_id: "acc-7200", debit: 50_000, credit: 0 }, { account_id: "acc-4101", debit: 0, credit: 999 }], error: null }); },
    };
    expect(await getAccountOpening(client, "720004", { from: "2026-11-01", branchId: "b1" })).toBe(50_000);
    expect(calls).toEqual([{ p_from: null, p_to: "2026-10-31", p_branch_ids: ["b1"] }]);
    expect(linesRead).toBe(false);
  });

  it("saldo awal SEMUA akun untuk Ringkasan: satu agregat s/d sehari sebelum periode, sisi saldo normal; tanpa 'dari' = kosong", async () => {
    const calls: Record<string, unknown>[] = [];
    const base = makeClient(dua, campur);
    const client = {
      from: (t: string) => base.from(t),
      rpc(_n: string, args: Record<string, unknown>) { calls.push(args); return Promise.resolve({ data: [{ account_id: "acc-7200", debit: 372_267, credit: 0 }], error: null }); },
    };
    const awal = await getOpeningBalances(client, { from: "2026-11-01", to: "2026-11-30" });
    expect(awal.get("acc-7200")).toBe(372_267);
    expect(calls).toEqual([{ p_from: null, p_to: "2026-10-31", p_branch_ids: null }]);
    expect((await getOpeningBalances(client, { to: "2026-11-30" })).size).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("saldo awal jalur lama (fungsi belum ada) tetap hanya membaca akun itu", async () => {
    accountFilters = [];
    expect(await getAccountOpening(makeClient(dua, campur), "720004", { from: "2026-11-01" })).toBe(50_000);
    expect(accountFilters).toEqual([["acc-7200"]]);
  });
});

describe("Baris jurnal per akun lewat RPC ledger_account_lines", () => {
  const baris = [
    { id: "l2", account_id: "acc-4101", debit: 0, credit: 200_000, journal_entries: { tanggal: "2026-11-05", branch_id: "b1", source: "sale", source_ref: "S2", no_jurnal: "J2", deskripsi: "Penjualan", branches: { name: "Cabang Satu" } } },
    { id: "l1", account_id: "acc-4101", debit: 0, credit: 100_000, journal_entries: { tanggal: "2026-11-02", branch_id: null, source: "manual", source_ref: null, no_jurnal: "J1", deskripsi: null, branches: null } },
  ];
  function klien(hasil: (name: string) => { data: unknown; error: { code?: string; message?: string } | null }) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    let linesRead = false;
    const base = makeClient(accounts, lines);
    return {
      client: {
        from(table: string) { if (table === "journal_lines") linesRead = true; return base.from(table); },
        rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args }); return Promise.resolve(hasil(name)); },
      },
      calls, linesRead: () => linesRead,
    };
  }

  it("satu panggilan RPC membawa filter periode/cabang/akun; baris diurutkan tanggal lalu no_jurnal seperti jalur lama", async () => {
    const t = klien(() => ({ data: baris, error: null }));
    const hasil = await getAccountLedger(t.client, "510001", { from: "2026-11-01", to: "2026-11-30", branchIds: ["b1", "b2"], branchId: "b1" });
    const rpc = t.calls.filter((c) => c.name === "ledger_account_lines");
    expect(rpc).toHaveLength(1);
    expect(rpc[0].args).toEqual({ p_from: "2026-11-01", p_to: "2026-11-30", p_branch_ids: ["b1"], p_account_ids: ["acc-4101"] });
    expect(t.linesRead()).toBe(false);
    expect(hasil.map((r) => [r.tanggal, r.no_jurnal, r.credit, r.branch_name])).toEqual([
      ["2026-11-02", "J1", 100_000, "Pusat"], ["2026-11-05", "J2", 200_000, "Cabang Satu"],
    ]);
  });

  it("filter cabang kosong atau tidak beririsan -> tanpa baris dan tanpa panggilan", async () => {
    const t = klien(() => ({ data: baris, error: null }));
    expect(await getAccountLedger(t.client, "510001", { branchIds: [] })).toEqual([]);
    expect(await getAccountLedger(t.client, "510001", { branchId: "b3", branchIds: ["b1"] })).toEqual([]);
    expect(t.calls.filter((c) => c.name === "ledger_account_lines")).toHaveLength(0);
  });

  it("fungsi belum dipasang -> pembaca lama (hasil sama); galat lain dilempar", async () => {
    const hilang = klien((name) => ({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}(p_account_ids) in the schema cache` } }));
    const lama = await getAccountLedger(hilang.client, "510001");
    expect(hilang.linesRead()).toBe(true);
    expect(lama.length).toBeGreaterThan(0);
    const gagal = klien(() => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }));
    await expect(getAccountLedger(gagal.client, "510001")).rejects.toThrow("statement timeout");
    const bukanDaftar = klien(() => ({ data: {}, error: null }));
    await expect(getAccountLedger(bukanDaftar.client, "510001")).rejects.toThrow("baris jurnal tidak tersedia");
  });
});

describe("tampilan akun Ringkasan Buku Besar (semua / hanya yang ada angkanya)", () => {
  it("memakai param `tampilan`, bukan `tampil` milik gerbang laporan", () => {
    expect(PARAM_TAMPILAN_AKUN).toBe("tampilan");
  });

  it("parseTampilanAkun: bawaan ringkas, hanya `semua` persis yang membuka seluruh akun", () => {
    expect(parseTampilanAkun(undefined)).toBe("berangka");
    expect(parseTampilanAkun("")).toBe("berangka");
    expect(parseTampilanAkun("berangka")).toBe("berangka");
    expect(parseTampilanAkun("ngawur")).toBe("berangka");
    expect(parseTampilanAkun("SEMUA")).toBe("berangka");
    expect(parseTampilanAkun("semua")).toBe("semua");
    expect(parseTampilanAkun(["semua", "berangka"])).toBe("semua");
    expect(parseTampilanAkun(["berangka", "semua"])).toBe("berangka");
  });

  it("adaAngka: nol, -0 dan sisa pecahan di bawah Rp 0,5 dianggap nol (sama dengan tampilan Rp -0)", () => {
    expect(adaAngka(0)).toBe(false);
    expect(adaAngka(-0)).toBe(false);
    expect(adaAngka(0.4)).toBe(false);
    expect(adaAngka(-0.4)).toBe(false);
    expect(Math.round(-0.4)).toBe(-0); // bukti: inilah asal "Rp -0" di layar
    expect(adaAngka(1)).toBe(true);
    expect(adaAngka(-1)).toBe(true);
    expect(adaAngka(0.6)).toBe(true);
    expect(adaAngka(-0.6)).toBe(true);
    expect(adaAngka(Number.NaN)).toBe(true);
  });

  it("akunAdaAngka: salah satu dari Saldo Awal, Debit, Kredit, Saldo Akhir cukup", () => {
    expect(akunAdaAngka({ debit: 0, credit: 0, saldo: 0 })).toBe(false);
    expect(akunAdaAngka({ debit: -0, credit: 0, saldo: -0 }, -0)).toBe(false);
    expect(akunAdaAngka({ debit: 0, credit: 0, saldo: 0 }, 500)).toBe(true); // hanya saldo awal
    expect(akunAdaAngka({ debit: 10, credit: 0, saldo: 0 })).toBe(true); // hanya debit
    expect(akunAdaAngka({ debit: 0, credit: 10, saldo: 0 })).toBe(true); // hanya kredit
    expect(akunAdaAngka({ debit: 0, credit: 0, saldo: 7 })).toBe(true); // hanya saldo akhir
    // debit = kredit dan saldo awal ditutup mutasi: saldo akhir 0 tapi Debit/Kredit/Awal tetap ada angka
    expect(akunAdaAngka({ debit: 100, credit: 600, saldo: -500 }, 500)).toBe(true);
    // pecahan kecil di semua kolom -> nol
    expect(akunAdaAngka({ debit: 0.2, credit: 0.3, saldo: -0.1 }, 0.1)).toBe(false);
  });

  const akun = [
    { id: "a", code: "100", debit: 0, credit: 0, saldo: 0 },
    { id: "b", code: "110", debit: 50, credit: 0, saldo: 50 },
    { id: "c", code: "120", debit: -0, credit: 0, saldo: -0 },
    { id: "d", code: "130", debit: 0, credit: 0, saldo: 0 }, // hanya saldo awal
    { id: "h", code: "100000", debit: 0, credit: 0, saldo: 0 }, // header tanpa angka
  ];
  const awal = (id: string) => (id === "d" ? 1000 : 0);

  it("saringAkunTampil: `semua` mengembalikan seluruh akun apa adanya", () => {
    expect(saringAkunTampil(akun, awal, "semua")).toBe(akun);
  });

  it("saringAkunTampil: `berangka` membuang akun nol (termasuk header nol), urutan tetap", () => {
    expect(saringAkunTampil(akun, awal, "berangka").map((x) => x.code)).toEqual(["110", "130"]);
  });

  it("saringAkunTampil: akun yang sedang dibuka tetap tampil walau nol", () => {
    expect(saringAkunTampil(akun, awal, "berangka", "100").map((x) => x.code)).toEqual(["100", "110", "130"]);
  });

  it("saringAkunTampil tidak mengubah data masukan", () => {
    const salinan = structuredClone(akun);
    saringAkunTampil(akun, awal, "berangka", "120");
    expect(akun).toEqual(salinan);
  });
});
