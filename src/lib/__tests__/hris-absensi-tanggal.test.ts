// C1 (meeting 12 Nov 2026): Catat Absensi tidak lagi terkunci di tanggal uji 2026-07-01.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), assertHrisManager: vi.fn() }));
vi.mock("@/lib/master-guard", () => ({ assertHrisManager: mocks.assertHrisManager }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/tanggal", () => ({ hariIniWIB: () => "2026-11-14" }));

import { simpanAbsensi } from "../../app/(app)/hris/absensi/actions";

const form = (isi: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(isi)) f.set(k, v);
  return f;
};

beforeEach(() => {
  mocks.upsert.mockReset().mockResolvedValue({ error: null });
  mocks.assertHrisManager.mockReset().mockResolvedValue({ from: () => ({ upsert: mocks.upsert }) });
});

describe("simpanAbsensi — tanggal bawaan", () => {
  it("tanggal kosong = hari ini (WIB), bukan 2026-07-01", async () => {
    await expect(simpanAbsensi(form({ employee_id: "e1", status: "Hadir" }))).rejects.toThrow("/hris/absensi?success=1&tgl=2026-11-14");
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({ employee_id: "e1", tanggal: "2026-11-14" });
    expect(mocks.assertHrisManager).toHaveBeenCalledWith("/hris/absensi?tgl=2026-11-14");
  });

  it("tanggal yang dipilih dipakai apa adanya", async () => {
    await expect(simpanAbsensi(form({ employee_id: "e1", tanggal: "2026-11-02" }))).rejects.toThrow("tgl=2026-11-02");
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({ tanggal: "2026-11-02" });
  });

  it("format tanggal salah = hari ini, tidak diteruskan ke database", async () => {
    await expect(simpanAbsensi(form({ employee_id: "e1", tanggal: "14/11/2026" }))).rejects.toThrow("tgl=2026-11-14");
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({ tanggal: "2026-11-14" });
  });
});
