import { describe, expect, it } from "vitest";
import { ListLoadError } from "@/lib/checked-list";
import { petakanKunjungan, kelompokkanPerPasien, type SumberBarisDaftar } from "@/lib/rekam-medis-per-pasien";
import {
  gabungkanSemuaCabang, idKunjunganTerakhirPerluDetail, MAKS_KUNJUNGAN_PER_HEWAN, type SumberKunjunganSemua,
} from "@/lib/rekam-medis-semua-cabang";
import { bacaSemuaCabang } from "@/lib/rekam-medis-semua-cabang-server";

const A = "branch-a", B = "branch-b", P = "pet-1";
const hari = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 86400_000).toISOString();
const inapSelesai = [{ created_at: "2026-10-01T00:00:00Z", discharged_at: "2026-10-03T00:00:00Z", condition_status: "sembuh" }];
const inapAktif = [{ created_at: "2026-10-01T00:00:00Z", discharged_at: null, condition_status: "stabil" }];
const src = (id: string, i: number, o: Partial<SumberKunjunganSemua> = {}): SumberKunjunganSemua => ({
  id, pet_id: P, created_at: hari(i), branch_id: A, status: "Selesai", poli: "Poli Umum", keluhan: `keluhan ${id}`, legacy_source_key: null,
  branches: { code: "VET_PDRY" }, inpatient_records: [], ...o,
});
const jendela = (id: string, i: number): SumberBarisDaftar => ({
  id, created_at: hari(i), pet_id: P, branch_id: A, dokter: null, keluhan: `keluhan ${id}`, legacy_source_key: null,
  pets: { name: "choco", species: "Kucing", breed: null }, customers: { name: "tes", phone: "085845455145" }, branches: { code: "VET_PDRY" },
  medical_records: { diagnosis: `dx ${id}`, anamnesis: `anamnesa ${id}` }, inpatient_records: [],
});
const kelompok = (...ids: [string, number][]) => kelompokkanPerPasien(ids.map(([id, i]) => petakanKunjungan(jendela(id, i))));

describe("gabungkanSemuaCabang", () => {
  it("jumlah cabang aktif berbeda dari semua cabang; rawat inap lintas cabang; Terakhir dari cabang lain dengan isi klinis", () => {
    const k = kelompok(["a0", 0], ["a1", 1]);
    const sumber = [src("a0", 0, { inpatient_records: inapSelesai }), src("a1", 1), src("b0", 5, { branch_id: B, branches: { code: "VET_CMGG" }, inpatient_records: inapSelesai }), src("b1", 9, { branch_id: B, branches: { code: "VET_CMGG" } })];
    const hasil = gabungkanSemuaCabang({ kelompok: k, sumber, rekam: [{ visit_id: "b1", diagnosis: "dx lain", anamnesis: "anamnesa lain" }], cabangAktif: A, tampilan: "semua", terpotong: false });
    const r = hasil.get(k[0].kunci)!;
    expect(r).toMatchObject({ jumlah: 4, jumlahRawatInap: 2, jumlahCabangIni: 2, lebih: false });
    expect(r.terakhir).toMatchObject({ id: "b1", branch: "VET_CMGG", branchId: B, dalamCabangIni: false, note: "anamnesa lain", diagnosis: "dx lain" });
  });

  it("tanpa cabang aktif: jumlahCabangIni null dan Terakhir bertanda dalam lingkup", () => {
    const k = kelompok(["a0", 0]);
    const r = gabungkanSemuaCabang({ kelompok: k, sumber: [src("a0", 0), src("b0", 3, { branch_id: B })], rekam: [], cabangAktif: null, tampilan: "semua", terpotong: false }).get(k[0].kunci)!;
    expect(r.jumlahCabangIni).toBeNull();
    expect(r.terakhir.dalamCabangIni).toBe(true);
  });

  it("kunjungan terakhir yang sudah ada di jendela memakai isi jendela (tanpa bacaan tambahan)", () => {
    const k = kelompok(["a0", 0], ["a1", 1]);
    const sumber = [src("a0", 0), src("a1", 1), src("b0", -4, { branch_id: B })];
    expect(idKunjunganTerakhirPerluDetail(k, sumber, "semua")).toEqual([]);
    const r = gabungkanSemuaCabang({ kelompok: k, sumber, rekam: [], cabangAktif: A, tampilan: "semua", terpotong: false }).get(k[0].kunci)!;
    expect(r.terakhir).toMatchObject({ id: "a1", note: "anamnesa a1", diagnosis: "dx a1", dalamCabangIni: true });
  });

  it("riwayat impor tanpa cabang masuk lingkup cabang aktif; rawat inap aktif disembunyikan di tampilan rawat-jalan saja", () => {
    const k = kelompok(["a0", 0]);
    const sumber = [src("a0", 0), src("imp", -3, { branch_id: null, branches: null, legacy_source_key: "impor::1" }), src("b0", 2, { branch_id: B, inpatient_records: inapAktif })];
    const jalan = gabungkanSemuaCabang({ kelompok: k, sumber, rekam: [], cabangAktif: A, tampilan: "rawat-jalan", terpotong: false }).get(k[0].kunci)!;
    expect(jalan).toMatchObject({ jumlah: 2, jumlahCabangIni: 2 });
    const semua = gabungkanSemuaCabang({ kelompok: k, sumber, rekam: [], cabangAktif: A, tampilan: "semua", terpotong: false }).get(k[0].kunci)!;
    expect(semua).toMatchObject({ jumlah: 3, jumlahCabangIni: 2, jumlahRawatInap: 1 });
  });

  it("batas per hewan: lebih dari 200 dihitung 200 dengan penanda lebih; bacaan terpotong menandai semua", () => {
    const k = kelompok(["a0", 0]);
    const banyak = Array.from({ length: MAKS_KUNJUNGAN_PER_HEWAN + 30 }, (_, i) => src(`v${String(i).padStart(3, "0")}`, i, { branch_id: B }));
    const a = gabungkanSemuaCabang({ kelompok: k, sumber: banyak, rekam: [], cabangAktif: A, tampilan: "semua", terpotong: false }).get(k[0].kunci)!;
    expect(a).toMatchObject({ jumlah: 200, lebih: true, jumlahCabangIni: 0 });
    expect(a.terakhir.id).toBe("v229"); // terbaru tetap yang terakhir
    const b = gabungkanSemuaCabang({ kelompok: k, sumber: [src("a0", 0)], rekam: [], cabangAktif: A, tampilan: "semua", terpotong: true }).get(k[0].kunci)!;
    expect(b).toMatchObject({ jumlah: 1, lebih: true });
  });

  it("gagal tertutup: kunjungan di daftar tidak ada pada bacaan semua cabang -> ListLoadError (bukan angka salah)", () => {
    const k = kelompok(["a0", 0]);
    expect(() => gabungkanSemuaCabang({ kelompok: k, sumber: [], rekam: [], cabangAktif: A, tampilan: "semua", terpotong: false })).toThrow(ListLoadError);
  });

  it("kunjungan tanpa pet_id tidak digabung dan tidak mendapat ringkasan", () => {
    const k = kelompokkanPerPasien([petakanKunjungan({ ...jendela("x", 0), pet_id: null })]);
    expect(gabungkanSemuaCabang({ kelompok: k, sumber: [], rekam: [], cabangAktif: A, tampilan: "semua", terpotong: false }).size).toBe(0);
  });
});

describe("bacaSemuaCabang (kueri)", () => {
  type Hasil = { data: unknown; count: number | null; error: unknown };
  const klien = (rows: SumberKunjunganSemua[], opsi: { error?: boolean; jumlahPalsu?: number } = {}) => {
    const calls: { table: string; select: string; filters: [string, unknown][]; range?: [number, number] }[] = [];
    return {
      calls,
      client: {
        from(table: string) {
          const call = { table, select: "", filters: [] as [string, unknown][], range: undefined as [number, number] | undefined };
          calls.push(call);
          const q = {
            select(k: string) { call.select = k; return q; },
            in(f: string, v: unknown) { call.filters.push([f, v]); return q; },
            is(f: string, v: unknown) { call.filters.push([f, v]); return q; },
            order() { return q; },
            range(a: number, b: number) { call.range = [a, b]; return q; },
            then(resolve: (v: Hasil) => void) {
              if (opsi.error) return resolve({ data: null, count: null, error: { message: "rahasia" } });
              if (table === "medical_records") return resolve({ data: [], count: null, error: null });
              const [a, b] = call.range ?? [0, rows.length];
              return resolve({ data: rows.slice(a, b + 1), count: opsi.jumlahPalsu ?? rows.length, error: null });
            },
          };
          return q;
        },
      },
    };
  };
  it("satu bacaan visits (pet_id in, archived_at is null) tanpa filter cabang; halaman berikutnya diverifikasi terhadap jumlah", async () => {
    const k = kelompok(["a0", 0]);
    const rows = Array.from({ length: 1100 }, (_, i) => src(`v${String(i).padStart(4, "0")}`, i));
    const { client, calls } = klien(rows);
    const hasil = await bacaSemuaCabang(client as never, k, { cabangAktif: A, tampilan: "semua" });
    expect(hasil.get(k[0].kunci)?.jumlah).toBe(200);
    expect(calls.filter((c) => c.table === "visits").map((c) => c.range)).toEqual([[0, 499], [500, 999], [1000, 1099]]);
    for (const c of calls) expect(c.filters.some(([f]) => f === "branch_id")).toBe(false);
    expect(calls[0].filters).toContainEqual(["archived_at", null]);
    expect(calls[0].select).toContain("medical_records!inner(id)");
  });
  it("lebih dari 4.000 baris: hanya 4.000 dibaca dan semua hitungan bertanda lebih", async () => {
    const k = kelompok(["a0", 0]);
    const rows = Array.from({ length: 4200 }, (_, i) => src(`v${String(i).padStart(4, "0")}`, 5000 - i));
    const { client, calls } = klien(rows);
    const hasil = await bacaSemuaCabang(client as never, k, { cabangAktif: A, tampilan: "semua" });
    expect(hasil.get(k[0].kunci)?.lebih).toBe(true);
    expect(Math.max(...calls.filter((c) => c.table === "visits").map((c) => c.range![1]))).toBe(3999);
  });
  it("galat DB atau jumlah tak konsisten -> ListLoadError tanpa membocorkan detail", async () => {
    const k = kelompok(["a0", 0]);
    await expect(bacaSemuaCabang(klien([src("a0", 0)], { error: true }).client as never, k, { cabangAktif: A, tampilan: "semua" })).rejects.toThrow("belum dapat dimuat lengkap");
    await expect(bacaSemuaCabang(klien([src("a0", 0)], { jumlahPalsu: 3 }).client as never, k, { cabangAktif: A, tampilan: "semua" })).rejects.toBeInstanceOf(ListLoadError);
    await expect(bacaSemuaCabang(klien([src("a0", 0)], { error: true }).client as never, k, { cabangAktif: A, tampilan: "semua" })).rejects.not.toThrow(/rahasia/);
  });
  it("tanpa hewan ber-pet_id: tidak ada bacaan", async () => {
    const { client, calls } = klien([]);
    expect((await bacaSemuaCabang(client as never, [], { cabangAktif: A, tampilan: "semua" })).size).toBe(0);
    expect(calls).toEqual([]);
  });
});
