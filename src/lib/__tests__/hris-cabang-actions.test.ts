// Audit HRIS T1 & T2: cabang utama di Edit Karyawan, pembersihan massal, dan
// "Akhiri penugasan". Semua tulis wajib lewat RPC terjaga (OWNER/ADMIN).
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  klien: vi.fn(),
  assertMasterAdmin: vi.fn(),
  bolehKelolaPayroll: vi.fn(),
  simpanGajiPokok: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/master-guard", () => ({
  klienMasterAdmin: mocks.klien,
  assertMasterAdmin: mocks.assertMasterAdmin,
  assertHrisManager: vi.fn(),
  bolehKelolaPayroll: mocks.bolehKelolaPayroll,
}));
vi.mock("@/lib/employee-salary", () => ({ simpanGajiPokok: mocks.simpanGajiPokok }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tanggal", () => ({ hariIniWIB: () => "2026-10-29" }));

import { akhiriPenugasanCabang, editKaryawan, setCabangUtamaMassal } from "../../app/(app)/hris/karyawan/actions";

const EMP = "a1000000-0000-4000-8000-000000000001";
const EMP2 = "a1000000-0000-4000-8000-000000000002";
const CAB = "a2000000-0000-4000-8000-000000000001";

const klienPalsu = () => ({
  rpc: mocks.rpc,
  from: () => ({
    update: (nilai: Record<string, unknown>) => { mocks.update(nilai); return {
      eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: EMP }, error: null }) }) }),
    }; },
  }),
});

beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ data: 1, error: null });
  mocks.update.mockReset();
  mocks.simpanGajiPokok.mockReset().mockResolvedValue(true);
  mocks.bolehKelolaPayroll.mockReset().mockResolvedValue(false);
  mocks.klien.mockReset().mockResolvedValue(klienPalsu());
  mocks.assertMasterAdmin.mockReset().mockResolvedValue(klienPalsu());
});

const formEdit = (extra: Record<string, string> = {}) => {
  const data = new FormData();
  Object.entries({ id: EMP, nama: "Karyawan Uji", status: "Aktif", jabatan: "Dokter Hewan", branch_id: CAB, ...extra })
    .forEach(([key, value]) => data.set(key, value));
  return data;
};

describe("T1 — cabang utama di Edit Karyawan", () => {
  it("menyimpan cabang utama lewat RPC tercatat, bukan update kolom biasa", async () => {
    await expect(editKaryawan(formEdit({ alasan_cabang: "Pindah ke Cimanggu" }))).rejects.toThrow("success=1");
    expect(mocks.rpc).toHaveBeenCalledWith("set_employee_primary_branches", {
      p_employee_ids: [EMP], p_branch_id: CAB, p_reason: "Pindah ke Cimanggu",
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0][0]).not.toHaveProperty("branch_id");
  });

  it("karyawan aktif tidak boleh disimpan tanpa cabang utama", async () => {
    await expect(editKaryawan(formEdit({ branch_id: "" }))).rejects.toThrow(/error=/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("karyawan nonaktif boleh tetap tanpa cabang dan RPC cabang tidak dipanggil", async () => {
    await expect(editKaryawan(formEdit({ branch_id: "", status: "Nonaktif" }))).rejects.toThrow("success=1");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("menampilkan pesan RPC yang memang untuk pengguna, bukan galat database mentah", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "ACCESS_DENIED: cabang tujuan tidak diizinkan" } });
    await expect(editKaryawan(formEdit())).rejects.toThrow(/cabang%20tujuan%20tidak%20diizinkan/);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "duplicate key value violates unique constraint" } });
    await expect(editKaryawan(formEdit())).rejects.toThrow(/cabang%20utama%20belum%20berpindah/);
  });
});

describe("T1 — pembersihan massal cabang utama", () => {
  const formMassal = (ids: string[], extra: Record<string, string> = {}) => {
    const data = new FormData();
    data.set("branch_id", CAB);
    Object.entries(extra).forEach(([key, value]) => data.set(key, value));
    ids.forEach(id => data.append("employee_ids", id));
    return data;
  };

  it("mengirim seluruh pilihan ke satu RPC terjaga", async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    const hasil = await setCabangUtamaMassal(null, formMassal([EMP, EMP2], { reason: "Pendataan ulang HR" }));
    expect(hasil).toMatchObject({ ok: true });
    expect(hasil!.pesan).toContain("2 karyawan");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("set_employee_primary_branches", {
      p_employee_ids: [EMP, EMP2], p_branch_id: CAB, p_reason: "Pendataan ulang HR",
    });
  });

  it("peran tanpa hak kelola master tidak menulis apa pun", async () => {
    mocks.klien.mockResolvedValue(null);
    await expect(setCabangUtamaMassal(null, formMassal([EMP]))).resolves.toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("alasan boleh kosong", async () => {
    await setCabangUtamaMassal(null, formMassal([EMP]));
    expect(mocks.rpc).toHaveBeenCalledWith("set_employee_primary_branches", { p_employee_ids: [EMP], p_branch_id: CAB, p_reason: null });
  });
});

describe("T2 — akhiri penugasan", () => {
  const formAkhiri = (extra: Record<string, string> = {}) => {
    const data = new FormData();
    Object.entries({ employee_id: EMP, branch_id: CAB, reason: "Selesai masa bantuan", ...extra })
      .forEach(([key, value]) => data.set(key, value));
    return data;
  };

  it("tanpa tanggal memakai hari ini", async () => {
    mocks.rpc.mockResolvedValue({ data: "2026-10-29", error: null });
    await expect(akhiriPenugasanCabang(null, formAkhiri())).resolves.toMatchObject({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith("end_employee_branch_assignment", {
      p_employee_id: EMP, p_branch_id: CAB, p_end_date: "2026-10-29", p_reason: "Selesai masa bantuan",
    });
  });

  it("menerima tanggal berakhir di masa depan", async () => {
    await akhiriPenugasanCabang(null, formAkhiri({ end_date: "2026-11-30" }));
    expect(mocks.rpc).toHaveBeenCalledWith("end_employee_branch_assignment", expect.objectContaining({ p_end_date: "2026-11-30" }));
  });

  it("alasan wajib diisi dan tidak ada tulisan tanpa alasan", async () => {
    await expect(akhiriPenugasanCabang(null, formAkhiri({ reason: "" }))).resolves.toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("peran tanpa hak kelola master tidak bisa mengakhiri", async () => {
    mocks.klien.mockResolvedValue(null);
    await expect(akhiriPenugasanCabang(null, formAkhiri())).resolves.toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("meneruskan pesan penolakan RPC apa adanya bila memang untuk pengguna", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "ASSIGNMENT_INVALID: penugasan ini sudah diakhiri" } });
    const hasil = await akhiriPenugasanCabang(null, formAkhiri());
    expect(hasil).toEqual({ ok: false, pesan: "penugasan ini sudah diakhiri" });
  });
});
