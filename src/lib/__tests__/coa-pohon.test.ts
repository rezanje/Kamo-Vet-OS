import { describe, it, expect } from "vitest";
import { susunPohon, ratakan, saldoDenganRollup, validasiIndukAkun, type AkunPohon } from "../coa-pohon";

const akun = (id: string, code: string, opts: Partial<AkunPohon> = {}): AkunPohon => ({
  id, code, name: `Akun ${code}`, type: "BEBAN", parent_id: null, is_header: false, ...opts,
});

describe("susunPohon", () => {
  it("menaruh akun rincian di bawah induknya, urut kode", () => {
    const rows = [
      akun("b", "5302", { parent_id: "a" }),
      akun("a", "5300", { is_header: true }),
      akun("c", "5301", { parent_id: "a" }),
    ];
    const pohon = susunPohon(rows);
    expect(pohon).toHaveLength(1);
    expect(pohon[0].akun.code).toBe("5300");
    expect(pohon[0].anak.map((s) => s.akun.code)).toEqual(["5301", "5302"]);
    expect(pohon[0].anak[0].level).toBe(1);
  });

  // Akun yang induknya hilang tetap harus terlihat — kalau disembunyikan, orang
  // tidak pernah tahu ada akun yang perlu diperbaiki.
  it("akun dengan induk tidak dikenal tetap tampil sebagai tingkat atas", () => {
    const pohon = susunPohon([akun("x", "5401", { parent_id: "entah" })]);
    expect(pohon.map((s) => s.akun.code)).toEqual(["5401"]);
  });

  it("induk melingkar tidak membuat akunnya hilang", () => {
    const rows = [
      akun("a", "5300", { parent_id: "b", is_header: true }),
      akun("b", "5310", { parent_id: "a", is_header: true }),
    ];
    const kode = ratakan(susunPohon(rows)).map((s) => s.akun.code).sort();
    expect(kode).toEqual(["5300", "5310"]);
  });
});

describe("saldoDenganRollup", () => {
  it("saldo induk = jumlah rinciannya, bukan angka simpanannya sendiri", () => {
    const rows = [
      akun("a", "5300", { is_header: true }),
      akun("b", "5301", { parent_id: "a" }),
      akun("c", "5302", { parent_id: "a" }),
    ];
    const saldo = saldoDenganRollup(susunPohon(rows), new Map([["b", 100], ["c", 250], ["a", 999]]));
    expect(saldo.get("a")).toBe(350);
    expect(saldo.get("b")).toBe(100);
  });

  it("bertingkat lebih dari dua — cucu ikut terjumlah ke kakeknya", () => {
    const rows = [
      akun("a", "5300", { is_header: true }),
      akun("b", "5310", { parent_id: "a", is_header: true }),
      akun("c", "5311", { parent_id: "b" }),
    ];
    const saldo = saldoDenganRollup(susunPohon(rows), new Map([["c", 75]]));
    expect(saldo.get("a")).toBe(75);
    expect(saldo.get("b")).toBe(75);
  });
});

describe("validasiIndukAkun", () => {
  const semua = [
    akun("h", "5300", { is_header: true }),
    akun("hAset", "1300", { type: "ASET", is_header: true }),
    akun("d", "5301", { parent_id: "h" }),
  ];
  const bersih = { punyaJurnal: false, punyaAnak: false };

  it("akun yang sudah punya jurnal tidak boleh jadi akun induk", () => {
    const pesan = validasiIndukAkun(
      { id: "d", type: "BEBAN", parent_id: "h", is_header: true }, semua,
      { punyaJurnal: true, punyaAnak: false },
    );
    expect(pesan).toContain("sudah dipakai di jurnal");
  });

  it("induk masih punya anak tidak boleh diturunkan jadi detail", () => {
    const pesan = validasiIndukAkun(
      { id: "h", type: "BEBAN", parent_id: null, is_header: false }, semua,
      { punyaJurnal: false, punyaAnak: true },
    );
    expect(pesan).toContain("masih punya akun rincian");
  });

  it("induk beda kelompok ditolak", () => {
    const pesan = validasiIndukAkun(
      { id: "d", type: "BEBAN", parent_id: "hAset", is_header: false }, semua, bersih,
    );
    expect(pesan).toContain("sekelompok");
  });

  it("induk yang bukan akun header ditolak", () => {
    const pesan = validasiIndukAkun(
      { type: "BEBAN", parent_id: "d", is_header: false }, semua, bersih,
    );
    expect(pesan).toContain("bukan akun induk");
  });

  it("tidak boleh jadi induk dirinya sendiri", () => {
    const pesan = validasiIndukAkun(
      { id: "h", type: "BEBAN", parent_id: "h", is_header: true }, semua, bersih,
    );
    expect(pesan).toContain("dirinya sendiri");
  });

  it("induk melingkar ditolak", () => {
    const rows = [
      akun("a", "5300", { is_header: true }),
      akun("b", "5310", { parent_id: "a", is_header: true }),
    ];
    const pesan = validasiIndukAkun(
      { id: "a", type: "BEBAN", parent_id: "b", is_header: true }, rows,
      { punyaJurnal: false, punyaAnak: true },
    );
    expect(pesan).toContain("melingkar");
  });

  it("induk sekelompok & berjenis header diterima", () => {
    expect(validasiIndukAkun(
      { type: "BEBAN", parent_id: "h", is_header: false }, semua, bersih,
    )).toBeNull();
  });

  it("tanpa induk selalu boleh", () => {
    expect(validasiIndukAkun({ type: "BEBAN", parent_id: null, is_header: false }, semua, bersih)).toBeNull();
  });
});
