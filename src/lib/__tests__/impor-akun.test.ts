import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bacaFileAkun, rencanakanImporAkun, type AkunAda, type KonteksImporAkun } from "../impor-akun";
import { PEMETAAN_AKUN } from "../impor-akun-pemetaan";
import { KODE_SISTEM, type PemakaiAkun } from "../coa-sistem";
import { CONTOH_AKUN } from "../impor-master";

// Fictional, sanitized file in KAMO's own template format (NOT an Accurate export).
const FIXTURE = new URL("../../../supabase/tests/fixtures/coa-impor-kamo-fiktif.csv", import.meta.url);
const FIXTURE_SHA256 = "a3d5d694a68bd0f57fe46690bfc670b19ab7c2d7fc8bde0d36cecaf3aadb6365";

const kosong: PemakaiAkun = { jurnal: 0, rekeningKas: false, kategoriAset: false, jurnalBerulang: false };

function konteks(akun: Partial<AkunAda>[] = [], pemakaian: Record<string, Partial<PemakaiAkun>> = {}): KonteksImporAkun {
  return {
    versi: "v1",
    akun: akun.map((a, i) => ({
      id: a.id ?? `id-${a.code}`, code: a.code ?? String(9000 + i), name: a.name ?? "Akun",
      type: a.type ?? "ASET", normal_balance: a.normal_balance ?? "D",
      is_header: a.is_header ?? false, is_active: a.is_active ?? true, parent_id: a.parent_id ?? null,
    })),
    pemakaian: Object.fromEntries(Object.entries(pemakaian).map(([k, v]) => [k, { ...kosong, ...v }])),
  };
}

function rencana(isi: string, ctx = konteks()) {
  const baca = bacaFileAkun(isi, PEMETAAN_AKUN.kamo);
  if (!baca.ok) throw new Error(baca.pesan);
  return rencanakanImporAkun(baca, ctx);
}
const baris = (r: ReturnType<typeof rencana>, kode: string) => r.baris.find((b) => b.kode === kode)!;

describe("fixture template KAMO", () => {
  const isi = readFileSync(FIXTURE, "utf8");

  it("is pinned by SHA-256 and exact counts", () => {
    expect(createHash("sha256").update(isi).digest("hex")).toBe(FIXTURE_SHA256);
    const r = rencana(isi);
    expect(r.jumlah).toEqual({ total: 12, baru: 12, sama: 0, berubah: 0, konflik: 0, ditolak: 0 });
    expect(r.kirim.filter((k) => k.is_header)).toHaveLength(4);
    expect(r.kirim.filter((k) => k.parent_code)).toHaveLength(8);
    expect(r.bolehSimpan).toBe(true);
    expect(r.perluKonfirmasi).toBe(false);
  });

  it("accepts a parent that appears AFTER its child and keeps codes byte-exact", () => {
    const r = rencana(isi);
    expect(r.baris[0]).toMatchObject({ kode: "1610", status: "baru" });
    expect(r.kirim.find((k) => k.code === "1610")).toMatchObject({ parent_code: "1600", set_parent: true, is_header: false });
    expect(r.kirim.find((k) => k.code === "570301")?.code).toBe("570301");
    // empty saldo_normal falls back to the side of the group
    expect(r.kirim.find((k) => k.code === "4402")?.normal_balance).toBe("K");
  });

  it("shows which source columns were mapped", () => {
    const r = rencana(isi);
    expect(r.kolomDipetakan.map((k) => `${k.sumber}>${k.tujuan}`)).toEqual(
      ["kode>kode", "nama>nama", "tipe>tipe", "saldo_normal>saldo_normal", "induk>induk", "header>header"]);
  });
});

describe("source codes are never rewritten", () => {
  it.each([
    ["01101", /4–6 angka|berawalan 0/],
    ["1101.01", /4–6 angka/],
    ["1-1100", /4–6 angka/],
    ["11001001", /4–6 angka/],
  ])("%s becomes a conflict with a solution, code kept as-is", (kode, alasan) => {
    const r = rencana(`kode,nama,tipe\n${kode},Kas Kecil Fiktif,ASET`);
    expect(r.baris[0].kode).toBe(kode);
    expect(r.baris[0].status).toBe("konflik");
    expect(r.baris[0].alasan.join(" ")).toMatch(alasan);
    expect(r.baris[0].solusi).toMatch(/tidak mengubah kode/i);
    expect(r.bolehSimpan).toBe(false);
  });

  it("does not collide 01101 with an existing 1101", () => {
    const r = rencana("kode,nama,tipe\n01101,Kas,ASET", konteks([{ code: "1101", name: "Kas" }]));
    expect(r.baris[0].status).toBe("konflik");
  });

  it("code/group mismatch, cash-bank code range and missing system code are conflicts", () => {
    const r = rencana("kode,nama,tipe\n5801,Beban Salah Kelompok,ASET\n1150,Bank Fiktif,ASET\n1203,Piutang Fiktif,ASET");
    expect(baris(r, "5801")).toMatchObject({ status: "konflik" });
    expect(baris(r, "5801").alasan.join()).toMatch(/kelompok BEBAN/);
    expect(baris(r, "1150").alasan.join()).toMatch(/rekening kas\/bank/);
    expect(baris(r, "1203").alasan.join()).toMatch(/dipakai sistem/);
  });
});

describe("rejected rows", () => {
  it("missing parent, parent that is not a header, group mismatch, self parent", () => {
    const r = rencana([
      "kode,nama,tipe,induk,header",
      "5801,Anak Tanpa Induk,BEBAN,5800,",
      "5810,Induk Detail,BEBAN,,",
      "5811,Anak Induk Detail,BEBAN,5810,",
      "4800,Induk Pendapatan,PENDAPATAN,,ya",
      "5821,Beban Di Bawah Pendapatan,BEBAN,4800,",
      "5830,Diri Sendiri,BEBAN,5830,",
    ].join("\n"));
    expect(baris(r, "5801")).toMatchObject({ status: "ditolak" });
    expect(baris(r, "5801").alasan.join()).toMatch(/Induk 5800 tidak ada/);
    expect(baris(r, "5811").alasan.join()).toMatch(/bukan akun induk/);
    expect(baris(r, "5821").alasan.join()).toMatch(/sekelompok/);
    expect(baris(r, "5830").alasan.join()).toMatch(/dirinya sendiri/);
    expect(r.bolehSimpan).toBe(false);
  });

  it("detects cycles inside the file and rows hanging under a cycle, without looping", () => {
    const r = rencana([
      "kode,nama,tipe,induk,header",
      "5850,Siklus A,BEBAN,5851,ya",
      "5851,Siklus B,BEBAN,5850,ya",
      "5852,Di Bawah Siklus,BEBAN,5851,",
    ].join("\n"));
    expect(r.baris.map((b) => b.status)).toEqual(["ditolak", "ditolak", "ditolak"]);
    expect(r.baris.every((b) => /melingkar/.test(b.alasan.join()))).toBe(true);
  });

  it("duplicate codes, empty/too long names, unknown type, bad normal side, unknown header value", () => {
    const panjang = "N".repeat(81);
    const r = rencana([
      "kode,nama,tipe,saldo_normal,header",
      "5860,Beban Satu,BEBAN,D,",
      "5860,Beban Kembar,BEBAN,D,",
      "5861,,BEBAN,D,",
      `5862,${panjang},BEBAN,D,`,
      "5863,Beban Tipe Asing,BIAYA,D,",
      "5864,Beban Saldo Asing,BEBAN,X,",
      "5865,Beban Kontra,BEBAN,K,",
      "5866,Beban Header Asing,BEBAN,D,mungkin",
    ].join("\n"));
    expect(r.baris.map((b) => b.status)).toEqual(["baru", "ditolak", "ditolak", "ditolak", "ditolak", "ditolak", "ditolak", "ditolak"]);
    expect(r.baris[1].alasan.join()).toMatch(/kembar.*baris 2/);
    expect(r.baris[3].alasan.join()).toMatch(/80/);
    expect(r.baris[3].nama).toBe(panjang); // never silently truncated
    expect(r.jumlah).toMatchObject({ total: 8, baru: 1, ditolak: 7 });
    expect(r.bolehSimpan).toBe(false);
  });
});

describe("re-upload and diffs against existing accounts", () => {
  const ada = konteks([
    { id: "h", code: "5700", name: "Beban Klinik Lain", type: "BEBAN", normal_balance: "D", is_header: true },
    { id: "a", code: "5701", name: "Beban Laundry", type: "BEBAN", normal_balance: "D", parent_id: "h" },
    { id: "j", code: "5702", name: "Beban Limbah", type: "BEBAN", normal_balance: "D", parent_id: "h" },
    { id: "k", code: "1101", name: "Kas", type: "ASET", normal_balance: "D" },
    { id: "s", code: "1509", name: "Akumulasi Penyusutan", type: "ASET", normal_balance: "K" },
    { id: "r", code: "1720", name: "Aset Lain", type: "ASET", normal_balance: "D" },
  ], { "5702": { jurnal: 3 }, "1101": { rekeningKas: true } });

  it("identical rows are duplicates (no-op) and nothing is sent", () => {
    const r = rencana("kode,nama,tipe,saldo_normal,induk,header\n5700,Beban Klinik Lain,BEBAN,D,,ya\n5701,Beban Laundry,BEBAN,D,5700,", ada);
    expect(r.jumlah).toMatchObject({ total: 2, sama: 2 });
    expect(r.kirim).toEqual([]);
    expect(r.bolehSimpan).toBe(false);
  });

  it("a rename/reparent is a diff that needs explicit confirmation, never a blind overwrite", () => {
    const r = rencana("kode,nama,tipe,induk\n5701,Beban Laundry Kandang,BEBAN,", ada);
    expect(r.baris[0].status).toBe("berubah");
    expect(r.baris[0].perubahan).toEqual([
      { kolom: "nama", lama: "Beban Laundry", baru: "Beban Laundry Kandang" },
      { kolom: "induk", lama: "5700", baru: "" },
    ]);
    expect(r.perluKonfirmasi).toBe(true);
    expect(r.bolehSimpan).toBe(true);
    expect(r.kirim).toEqual([{ code: "5701", name: "Beban Laundry Kandang", type: "BEBAN", normal_balance: "D",
      is_header: false, is_active: null, set_parent: true, parent_code: null }]);
  });

  it("absent optional columns leave existing values untouched", () => {
    const r = rencana("kode,nama,tipe\n5701,Beban Laundry,BEBAN", ada);
    expect(r.baris[0].status).toBe("sama");
  });

  it("group/normal side of an account with journals cannot change", () => {
    const r = rencana("kode,nama,tipe,saldo_normal\n5702,Beban Limbah,BEBAN,K", ada);
    expect(r.baris[0].status).not.toBe("berubah");
    expect(r.bolehSimpan).toBe(false);
  });

  it("system accounts keep group/normal side even without journals; cash-mapped accounts are not renamed", () => {
    const r = rencana("kode,nama,tipe,saldo_normal\n1509,Akumulasi Penyusutan,ASET,D\n1101,Kas Besar,ASET,D", ada);
    expect(baris(r, "1509")).toMatchObject({ status: "konflik" });
    expect(baris(r, "1509").alasan.join()).toMatch(/sistem/);
    expect(baris(r, "1101")).toMatchObject({ status: "konflik" });
    expect(baris(r, "1101").alasan.join()).toMatch(/rekening kas\/bank/);
  });

  it("deactivating a system/cash account is a conflict; an account with journals cannot become a header", () => {
    const r = rencana("kode,nama,tipe,aktif,header\n1101,Kas,ASET,tidak,\n5702,Beban Limbah,BEBAN,,ya", ada);
    expect(baris(r, "1101")).toMatchObject({ status: "konflik" });
    expect(baris(r, "5702")).toMatchObject({ status: "ditolak" });
    expect(baris(r, "5702").alasan.join()).toMatch(/dipakai di jurnal/);
  });

  it("a header with children cannot be turned into a detail account", () => {
    const r = rencana("kode,nama,tipe,header\n5700,Beban Klinik Lain,BEBAN,", ada);
    expect(r.baris[0].status).toBe("ditolak");
    expect(r.baris[0].alasan.join()).toMatch(/rincian di bawahnya/);
  });

  it("changing a parent's group while existing children stay under it is rejected", () => {
    const r = rencana("kode,nama,tipe,header\n5700,Beban Klinik Lain,ASET,ya", ada);
    expect(r.baris[0].status).not.toBe("berubah");
    expect(r.bolehSimpan).toBe(false);
  });

  it("new child under an existing header is fine; under an existing detail account it is rejected", () => {
    const r = rencana("kode,nama,tipe,induk\n5703,Beban Baru,BEBAN,5700\n1721,Aset Anak,ASET,1720", ada);
    expect(baris(r, "5703").status).toBe("baru");
    expect(baris(r, "1721").status).toBe("ditolak");
  });
});

describe("balances are never part of a master import", () => {
  it("balance columns are separated and listed, never sent", () => {
    const r = rencana("kode,nama,tipe,saldo_awal,debit\n5880,Beban Fiktif,BEBAN,150000,\n5881,Beban Fiktif 2,BEBAN,0,");
    expect(r.kolomSaldo).toEqual(["saldo_awal", "debit"]);
    expect(r.barisBersaldo).toBe(1);
    expect(JSON.stringify(r.kirim)).not.toMatch(/150000|saldo_awal|debit/);
    expect(r.bolehSimpan).toBe(true);
  });
});

describe("file reading and mapping hook", () => {
  it("the downloadable sample is itself importable without issues", () => {
    const r = rencana(CONTOH_AKUN);
    expect(r.jumlah).toMatchObject({ total: 3, baru: 3 });
    expect(r.bolehSimpan).toBe(true);
  });

  it("reports missing required columns", () => {
    const r = bacaFileAkun("kode,nama\n5890,X", PEMETAAN_AKUN.kamo);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.pesan).toMatch(/tipe/);
  });

  it("refuses more than 1000 rows", () => {
    const isi = ["kode,nama,tipe", ...Array.from({ length: 1001 }, (_, i) => `${510000 + i},Beban ${i},BEBAN`)].join("\n");
    const r = bacaFileAkun(isi, PEMETAAN_AKUN.kamo);
    expect(r.ok).toBe(false);
  });

  it("only ships reviewed mappings: KAMO template only, no guessed Accurate headers", () => {
    expect(Object.keys(PEMETAAN_AKUN)).toEqual(["kamo"]);
    for (const p of Object.values(PEMETAAN_AKUN)) {
      expect(new Set(Object.values(p.kolom)).size).toBe(Object.values(p.kolom).length);
    }
  });
});

describe("database backstop uses the same system-code list", () => {
  it("migration array equals KODE_SISTEM", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/20261104330000_coa_import_atomic.sql", import.meta.url), "utf8");
    const m = sql.match(/coa_import_system_codes\(\)[\s\S]*?array\[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const kode = m![1].match(/'(\d+)'/g)!.map((s) => s.slice(1, -1)).sort();
    expect(kode).toEqual(Object.keys(KODE_SISTEM).sort());
  });
});
