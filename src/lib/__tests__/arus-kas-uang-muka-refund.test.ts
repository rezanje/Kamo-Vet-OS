// Laporan Arus Kas: transfer pengembalian saldo uang muka punya label sendiri (bukan nama sumber mentah) dan masuk aktivitas operasi.
import { expect, it } from "vitest";
import { aktivitasSumber, labelSumber } from "../arus-kas";

it("sumber jurnal klinik-uang-muka-refund dibaca manusia dan termasuk operasi", () => {
  expect(labelSumber("klinik-uang-muka-refund")).toBe("Pengembalian saldo uang muka pelanggan");
  expect(aktivitasSumber("klinik-uang-muka-refund")).toBe("operasi");
});
