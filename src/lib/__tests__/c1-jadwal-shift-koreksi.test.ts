// C1: salin jadwal bulan lalu, edit shift, dan keputusan koreksi absen di HRIS.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rencanaSalinJadwal, rentangSumber, tanggalSumberSalin, bulanSebelumnya } from "../jadwal-salin";

describe("tanggalSumberSalin", () => {
  it("hari yang sama di bulan sebelumnya (4 minggu, atau 5 minggu untuk tgl 29–31)", () => {
    expect(tanggalSumberSalin("2026-12-01")).toBe("2026-11-03");   // Selasa ← Selasa
    expect(tanggalSumberSalin("2026-12-28")).toBe("2026-11-30");
    expect(tanggalSumberSalin("2026-12-29")).toBe("2026-11-24");
    expect(tanggalSumberSalin("2026-12-31")).toBe("2026-11-26");
    expect(tanggalSumberSalin("2027-03-31")).toBe("2027-02-24");
    for (const t of ["2026-12-01", "2026-12-15", "2026-12-31"]) {
      expect(new Date(`${tanggalSumberSalin(t)}T00:00:00Z`).getUTCDay()).toBe(new Date(`${t}T00:00:00Z`).getUTCDay());
    }
  });
  it("rentang sumber & bulan sebelumnya", () => {
    expect(rentangSumber("2026-12")).toEqual({ dari: "2026-11-03", sampai: "2026-11-30" });
    expect(bulanSebelumnya("2027-01")).toBe("2026-12");
  });
});

describe("rencanaSalinJadwal", () => {
  const sumber = [
    { employee_id: "a", tanggal: "2026-11-03", shift_id: "pagi" },
    { employee_id: "a", tanggal: "2026-11-04", shift_id: "lama" },
    { employee_id: "a", tanggal: "2026-11-05", shift_id: "pagi" },
  ];
  it("hanya mengisi sel kosong; sel terisi dilewati; shift nonaktif dilewati", () => {
    const r = rencanaSalinJadwal({
      bulan: "2026-12", karyawan: ["a"], sumber, timpa: false, shiftBoleh: new Set(["pagi", "malam"]),
      sekarang: [{ employee_id: "a", tanggal: "2026-12-03", shift_id: "malam" }],
    });
    expect(r.isi).toEqual([{ employee_id: "a", tanggal: "2026-12-01", shift_id: "pagi" }]);
    expect(r).toMatchObject({ dilewati: 1, shiftTidakAktif: 1 });
  });
  it("timpa (sudah dikonfirmasi) mengganti sel terisi", () => {
    const r = rencanaSalinJadwal({
      bulan: "2026-12", karyawan: ["a"], sumber, timpa: true, shiftBoleh: new Set(["pagi", "malam"]),
      sekarang: [{ employee_id: "a", tanggal: "2026-12-03", shift_id: "malam" }],
    });
    expect(r.isi.map((x) => x.tanggal)).toEqual(["2026-12-01", "2026-12-03"]);
    expect(r.dilewati).toBe(0);
  });
});

// ── server actions ──
const st = vi.hoisted(() => ({ client: null as unknown, rpc: vi.fn(), papan: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/master-guard", () => ({
  assertHrisManager: async () => st.client, assertPayrollOwner: async () => st.client,
}));
vi.mock("@/lib/jadwal-karyawan", () => ({ bacaPapanJadwal: (...a: unknown[]) => st.papan(...a) }));
vi.mock("@/lib/tanggal", () => ({ hariIniWIB: () => "2026-11-20" }));
vi.mock("@/lib/posting", () => ({ postJournal: vi.fn() }));
vi.mock("@/lib/kas-akun", () => ({ kodeAkunBayar: vi.fn() }));
vi.mock("@/lib/jurnal-guard", () => ({ cekPeriode: vi.fn(), jurnalTersimpan: vi.fn() }));

import { simpanShift } from "@/app/(app)/hris/shift/actions";
import { salinJadwalBulanLalu } from "@/app/(app)/hris/jadwal/actions";
import { setujuiKoreksiAbsen, tolakKoreksiAbsen } from "@/app/(app)/hris/pengajuan/actions";

const form = (isi: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return f;
};

describe("simpanShift — edit shift", () => {
  let updated: { row: unknown; id: unknown } | null;
  let hasilUpdate: { data: unknown[] | null; error: null | { message: string } };
  beforeEach(() => {
    updated = null;
    hasilUpdate = { data: [{ id: "s1" }], error: null };
    st.client = { from: () => ({
      update: (row: unknown) => ({ eq: (_c: string, id: unknown) => ({ select: async () => { updated = { row, id }; return hasilUpdate; } }) }),
      insert: async () => ({ error: null }),
    }) };
  });
  it("form mengirim id → update shift itu", async () => {
    await expect(simpanShift(form({ id: "s1", nama: "Pagi", jam_masuk: "07:30", jam_pulang: "16:30", warna: "#000000" }))).rejects.toThrow("success=ubah");
    expect(updated).toMatchObject({ id: "s1", row: { nama: "Pagi", jam_masuk: "07:30", jam_pulang: "16:30", is_libur: false } });
  });
  it("update yang tidak mengenai baris (bukan cabangnya) dilaporkan gagal", async () => {
    hasilUpdate = { data: [], error: null };
    await expect(simpanShift(form({ id: "s1", nama: "Pagi", jam_masuk: "07:30", jam_pulang: "16:30" }))).rejects.toThrow("error=Shift%20tidak%20ditemukan");
  });
});

describe("salinJadwalBulanLalu", () => {
  let upserted: unknown[] | null;
  const rows: Record<string, { employee_id: string; tanggal: string; shift_id: string }[]> = {
    "2026-11-03": [{ employee_id: "a", tanggal: "2026-11-03", shift_id: "pagi" }],
    "2026-12-01": [{ employee_id: "a", tanggal: "2026-12-03", shift_id: "pagi" }],
  };
  beforeEach(() => {
    upserted = null;
    st.papan.mockReset().mockResolvedValue({ karyawan: [{ id: "a", nama: "A", jabatan: null }], shifts: [{ id: "pagi" }] });
    st.client = {
      auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) },
      from: () => ({
        select: () => {
          let dari = "";
          const q = {
            in: () => q,
            gte: (_c: string, v: string) => { dari = v; return q; },
            lte: async () => ({ data: rows[dari] ?? [], error: null }),
          };
          return q;
        },
        upsert: async (r: unknown[]) => { upserted = r; return { error: null }; },
      }),
    };
  });
  it("mengisi sel kosong dari pola bulan lalu, sel terisi dilewati & dilaporkan", async () => {
    await expect(salinJadwalBulanLalu(form({ cabang: "c1", bulan: "2026-12" }))).rejects.toThrow("success=salin");
    expect(upserted).toEqual([{ employee_id: "a", tanggal: "2026-12-01", shift_id: "pagi", created_by: "admin" }]);
  });
  it("tanpa jadwal bulan lalu: pesan jelas, tidak menulis apa pun", async () => {
    rows["2026-11-03"] = [];
    await expect(salinJadwalBulanLalu(form({ cabang: "c1", bulan: "2026-12" }))).rejects.toThrow("masih%20kosong");
    expect(upserted).toBeNull();
  });
});

describe("keputusan koreksi absen", () => {
  beforeEach(() => {
    st.rpc.mockReset().mockResolvedValue({ data: { status: "Disetujui" }, error: null });
    st.client = { rpc: st.rpc };
  });
  it("setujui & tolak memanggil putuskan_koreksi_absen", async () => {
    await expect(setujuiKoreksiAbsen(form({ id: "k1", catatan: "ok" }))).rejects.toThrow("success=koreksi");
    expect(st.rpc).toHaveBeenCalledWith("putuskan_koreksi_absen", { p_id: "k1", p_setuju: true, p_catatan: "ok" });
    await expect(tolakKoreksiAbsen(form({ id: "k1" }))).rejects.toThrow("success=koreksi");
    expect(st.rpc).toHaveBeenLastCalledWith("putuskan_koreksi_absen", { p_id: "k1", p_setuju: false, p_catatan: null });
  });
  it("penolakan database (mis. menyetujui diri sendiri) ditampilkan", async () => {
    st.rpc.mockResolvedValue({ data: null, error: { message: "KOREKSI_DIRI_SENDIRI: koreksi absen milikmu sendiri diputuskan oleh atasan/OWNER." } });
    await expect(setujuiKoreksiAbsen(form({ id: "k1" }))).rejects.toThrow(encodeURIComponent("Koreksi absen milikmu sendiri"));
  });
});
