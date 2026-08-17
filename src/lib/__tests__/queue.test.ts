import { describe, expect, it } from "vitest";
import { estimatedWaitMinutes, nextQueueNumber, queueLetter, queuePrefix } from "../queue";

describe("queueLetter", () => {
  it("maps known poli, defaults to A", () => {
    expect(queueLetter("Poli Umum")).toBe("A");
    expect(queueLetter("Grooming")).toBe("G");
    expect(queueLetter("Poli Gigi")).toBe("A");
  });
});

describe("nextQueueNumber", () => {
  it("starts at 001 for empty day", () => {
    expect(nextQueueNumber("Poli Umum", [])).toBe("A001");
  });
  it("increments from max, per letter sequence", () => {
    expect(nextQueueNumber("Poli Umum", ["A001", "A002", "G001"])).toBe("A003");
    expect(nextQueueNumber("Grooming", ["A001", "A002", "G001"])).toBe("G002");
  });
  it("tolerates gaps (max-based, not count-based)", () => {
    expect(nextQueueNumber("Poli Umum", ["A005", null, "A002"])).toBe("A006");
  });
});

describe("awalan cabang", () => {
  it("kode cabang jadi awalan nomor", () => {
    expect(nextQueueNumber("Poli Umum", [], "CMGG")).toBe("CMGG-A001");
    expect(nextQueueNumber("Grooming", ["CMGG-G004"], "CMGG")).toBe("CMGG-G005");
  });
  it("awalan VET_ dibuang, kode kepanjangan dipotong", () => {
    expect(queuePrefix("VET_CMGG")).toBe("CMGG");
    expect(queuePrefix("vet-btkm")).toBe("BTKM");
    expect(queuePrefix("PANJANGBANGET")).toBe("PANJA");
    expect(queuePrefix(null)).toBe("");
  });
  it("cabang tanpa kode tetap pola lama", () => {
    expect(nextQueueNumber("Poli Umum", ["A002"], null)).toBe("A003");
  });
  it("nomor lama tanpa awalan tetap dihitung saat awalan mulai dipakai", () => {
    expect(nextQueueNumber("Poli Umum", ["A007"], "CMGG")).toBe("CMGG-A008");
  });
  it("huruf poli lain tidak ikut menaikkan urutan", () => {
    expect(nextQueueNumber("Grooming", ["CMGG-A009"], "CMGG")).toBe("CMGG-G001");
  });
});

describe("estimatedWaitMinutes", () => {
  it("position × 20 menit", () => {
    expect(estimatedWaitMinutes(0)).toBe(0);
    expect(estimatedWaitMinutes(3)).toBe(60);
  });
});
