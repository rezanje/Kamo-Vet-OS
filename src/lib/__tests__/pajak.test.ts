import { describe, expect, it } from "vitest";
import { splitPpnInklusif, tambahPpn, PAJAK_OFF } from "../pajak";

const PKP = { mode_pkp: true, ppn_rate: 11 };

describe("splitPpnInklusif", () => {
  it("OFF: semua jadi DPP, PPN 0", () => {
    expect(splitPpnInklusif(111000, PAJAK_OFF)).toEqual({ dpp: 111000, ppn: 0 });
  });
  it("ON: pisah 100/111", () => {
    expect(splitPpnInklusif(111000, PKP)).toEqual({ dpp: 100000, ppn: 11000 });
  });
  it("tarif lain ikut", () => {
    expect(splitPpnInklusif(112000, { mode_pkp: true, ppn_rate: 12 })).toEqual({ dpp: 100000, ppn: 12000 });
  });
});

describe("tambahPpn", () => {
  it("OFF: tidak menambah apa-apa", () => {
    expect(tambahPpn(100000, PAJAK_OFF)).toEqual({ tax: 0, total: 100000 });
  });
  it("ON: tambah 11% di atas DPP", () => {
    expect(tambahPpn(100000, PKP)).toEqual({ tax: 11000, total: 111000 });
  });
});
