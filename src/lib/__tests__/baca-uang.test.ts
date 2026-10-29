import { describe, expect, it } from "vitest";
import { gagalBacaUang, tabelBelumAda } from "../baca-uang";

describe("membedakan fitur belum terpasang dari gangguan baca", () => {
  it("tabel yang memang belum ada dikenali dari kodenya", () => {
    expect(tabelBelumAda({ code: "42P01", message: 'relation "clinic_payment_receipts" does not exist' })).toBe(true);
    expect(tabelBelumAda({ code: "PGRST205", message: "Could not find the table 'public.x' in the schema cache" })).toBe(true);
  });

  it("gangguan baca, izin, dan embed ambigu TIDAK boleh dianggap nol", () => {
    // PGRST201 = relasi embed ambigu. Inilah yang dulu membuat riwayat kwitansi
    // diam-diam kosong padahal uangnya ada.
    expect(gagalBacaUang({ code: "PGRST201", message: "Could not embed because more than one relationship was found" })).toBe(true);
    expect(gagalBacaUang({ code: "42501", message: "permission denied for table clinic_payment_receipts" })).toBe(true);
    expect(gagalBacaUang({ message: "fetch failed" })).toBe(true);
    expect(gagalBacaUang({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(true);
  });

  it("tanpa error sama sekali bukan kegagalan", () => {
    expect(gagalBacaUang(null)).toBe(false);
    expect(gagalBacaUang(undefined)).toBe(false);
    expect(tabelBelumAda(null)).toBe(false);
  });

  it("tanpa kode, hanya pesan tabel hilang yang dimaafkan", () => {
    expect(tabelBelumAda({ message: 'relation "clinic_customer_advances" does not exist' })).toBe(true);
    expect(tabelBelumAda({ message: 'column "x" does not exist' })).toBe(false);
  });
});
