import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RacikanPasien } from "./RacikanPasien";
import { bacaRacikanKunjungan, infoStatusRacikan } from "./racikan-pasien";

const baris = (id: string, status: string, nama = `Racikan ${id}`) => ({ id, recipe_name: nama, status, created_at: "2026-11-06T03:00:00Z" });
const html = (recipes: ReturnType<typeof baris>[] | null) => renderToStaticMarkup(<RacikanPasien recipes={recipes} />);

describe("RacikanPasien — bagian 'Racikan pasien ini' di detail rawat inap", () => {
  it("pending: tombol 'Koreksi / Kembalikan bahan' menuju /klinik/racik/<id>#aksi", () => {
    const out = html([baris("r1", "pending")]);
    expect(out).toContain("Racikan pasien ini");
    expect(out).toContain('href="/klinik/racik/r1#aksi"');
    expect(out).toContain("Koreksi / Kembalikan bahan");
    expect(out).toContain("Menunggu diracik");
  });
  it("ready: tombol juga tampil", () => {
    const out = html([baris("r2", "ready")]);
    expect(out).toContain('href="/klinik/racik/r2#aksi"');
    expect(out).toContain("Siap diserahkan");
  });
  it("void: status + alasan, tanpa tombol aksi", () => {
    const out = html([baris("r3", "void")]);
    expect(out).toContain("Void");
    expect(out).toMatch(/sudah dikembalikan/i);
    expect(out).not.toContain("#aksi");
    expect(out).not.toContain("Koreksi / Kembalikan bahan");
  });
  it("handed_over: status + alasan kenapa tidak bisa, tanpa tombol", () => {
    const out = html([baris("r4", "handed_over")]);
    expect(out).toContain("Sudah diserahkan");
    expect(out).toMatch(/sudah diserahkan ke pasien/i);
    expect(out).toMatch(/Owner\/Reza/);
    expect(out).not.toContain("#aksi");
  });
  it("status tak dikenal: tampilkan teks status apa adanya + alasan, tanpa tombol", () => {
    const out = html([baris("r5", "aneh_baru")]);
    expect(out).toContain("aneh_baru");
    expect(out).toMatch(/tidak dikenali/i);
    expect(out).not.toContain("#aksi");
  });
  it("campuran: hanya pending/ready yang bertombol", () => {
    const out = html([baris("a", "pending"), baris("b", "void"), baris("c", "ready"), baris("d", "handed_over")]);
    expect(out.match(/#aksi/g)).toHaveLength(2);
    expect(out).toContain("/klinik/racik/a#aksi");
    expect(out).toContain("/klinik/racik/c#aksi");
  });
  it("tanpa racikan: pesan kosong, tanpa tombol", () => {
    const out = html([]);
    expect(out).toContain("Racikan pasien ini");
    expect(out).toMatch(/Belum ada racikan/);
    expect(out).not.toContain("#aksi");
  });
  it("gagal baca (null): 'tidak terbaca', bukan 'belum ada racikan'", () => {
    const out = html(null);
    expect(out).toMatch(/tidak terbaca/i);
    expect(out).not.toMatch(/Belum ada racikan/);
    expect(out).not.toContain("#aksi");
  });
  it("pending/ready menjelaskan bahwa DP/pembayaran akan ditolak sistem dengan alasan jelas", () => {
    expect(html([baris("r1", "pending")])).toMatch(/DP\/pembayaran/);
  });
  it("id di URL di-encode dan nama racikan di-escape", () => {
    const out = html([baris("x/y", "pending", "<b>Hack</b>")]);
    expect(out).toContain('href="/klinik/racik/x%2Fy#aksi"');
    expect(out).not.toContain("<b>Hack</b>");
  });
});

describe("infoStatusRacikan", () => {
  it.each([["pending", true], ["ready", true], ["void", false], ["handed_over", false], ["lain", false]])("%s -> bisaAksi=%s", (status, bisa) => {
    const info = infoStatusRacikan(status);
    expect(info.bisaAksi).toBe(bisa);
    if (!bisa) expect(info.alasan).toBeTruthy();
  });
});

describe("bacaRacikanKunjungan — satu query, toleran gagal", () => {
  function fake(result: { data: unknown; error: unknown } | "throw") {
    const calls: { table: string; select?: string; eq?: [string, unknown] }[] = [];
    const client = { from(table: string) {
      const call: (typeof calls)[number] = { table }; calls.push(call);
      const q = { select(s: string) { call.select = s; return q; }, eq(c: string, v: unknown) { call.eq = [c, v]; return q; }, order() { return q; }, limit() { return q; },
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return (result === "throw" ? Promise.reject(new Error("boom")) : Promise.resolve(result)).then(res, rej); } };
      return q;
    } };
    return { client, calls };
  }
  it("memakai tepat satu query ke compounding_recipes berfilter kunjungan", async () => {
    const { client, calls } = fake({ data: [baris("a", "pending")], error: null });
    const out = await bacaRacikanKunjungan(client as never, "visit-1");
    expect(out).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("compounding_recipes");
    expect(calls[0].eq).toEqual(["medical_records.visit_id", "visit-1"]);
    expect(calls[0].select).toContain("medical_records!inner(visit_id)");
  });
  it("error dari database -> null (tidak terbaca)", async () => {
    const { client } = fake({ data: null, error: { message: "denied" } });
    expect(await bacaRacikanKunjungan(client as never, "v")).toBeNull();
  });
  it("exception -> null", async () => {
    const { client } = fake("throw");
    expect(await bacaRacikanKunjungan(client as never, "v")).toBeNull();
  });
  it("data null tanpa error -> null, bukan daftar kosong", async () => {
    const { client } = fake({ data: null, error: null });
    expect(await bacaRacikanKunjungan(client as never, "v")).toBeNull();
  });
});
