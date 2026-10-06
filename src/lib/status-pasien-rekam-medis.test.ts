import { describe, expect, it } from "vitest";
import { statusPasienRekamMedis } from "./status-pasien-rekam-medis";

describe("status pasien dari catatan rawat inap", () => {
  it("membedakan rawat jalan dari riwayat impor tanpa status", () => {
    expect(statusPasienRekamMedis(null, false).label).toBe("Rawat jalan");
    expect(statusPasienRekamMedis([], true).label).toBe("Status belum tercatat");
  });
  it("tetap rawat inap sampai waktu keluar tercatat meski kondisinya sembuh", () => {
    expect(statusPasienRekamMedis([{ created_at: "2026-10-05", discharged_at: null, condition_status: "sembuh" }], false).label).toBe("Rawat inap");
  });
  it("menampilkan sudah pulang hanya untuk catatan dengan waktu keluar", () => {
    expect(statusPasienRekamMedis([{ created_at: "2026-10-05", discharged_at: "2026-10-06", condition_status: "sembuh" }], true).label).toBe("Sudah pulang");
  });
  it("membedakan pasien meninggal dari pasien pulang", () => {
    expect(statusPasienRekamMedis([{ created_at: "2026-10-05", discharged_at: "2026-10-06", condition_status: "rip" }], false).label).toBe("Meninggal");
  });
  it("menggunakan rawat inap terbaru tanpa mengubah urutan sumber", () => {
    const records = [
      { created_at: "2026-09-05", discharged_at: "2026-09-06", condition_status: "sembuh" },
      { created_at: "2026-10-05", discharged_at: null, condition_status: "stabil" },
    ];
    expect(statusPasienRekamMedis(records, false).label).toBe("Rawat inap");
    expect(records[0].created_at).toBe("2026-09-05");
  });
});
