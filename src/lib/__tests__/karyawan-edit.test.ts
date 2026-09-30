import { describe, expect, it } from "vitest";
import { bacaEditKaryawan } from "../karyawan-edit";
const form = (extra: Record<string, string> = {}) => {
  const data = new FormData();
  Object.entries({ nama: " Aldi ", status: "Aktif", gaji_pokok: "3500000", ...extra }).forEach(([k, v]) => data.set(k, v));
  return data;
};
describe("validasi edit karyawan", () => {
  it("menyimpan nominal nol dan merapikan data opsional", () => expect(bacaEditKaryawan(form({ gaji_pokok: "0", phone: " 08123 " }))).toMatchObject({ nama: "Aldi", gaji_pokok: 0, phone: "08123", nik: null }));
  it.each(["-1", "NaN", "Infinity", "abc"])("menolak gaji %s", gaji_pokok => expect(() => bacaEditKaryawan(form({ gaji_pokok }))).toThrow());
  it("menolak nama kosong dan status tidak valid", () => {
    expect(() => bacaEditKaryawan(form({ nama: " " }))).toThrow();
    expect(() => bacaEditKaryawan(form({ status: "Lain" }))).toThrow();
  });
  it("menolak email dan tanggal tidak valid", () => {
    expect(() => bacaEditKaryawan(form({ email: "abc" }))).toThrow();
    expect(() => bacaEditKaryawan(form({ tgl_masuk: "2026-02-30" }))).toThrow();
  });
});
