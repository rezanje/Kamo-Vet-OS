import { describe, expect, it } from "vitest";
import { estimatedWaitMinutes, nextQueueNumber, queueLetter } from "../queue";

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

describe("estimatedWaitMinutes", () => {
  it("position × 20 menit", () => {
    expect(estimatedWaitMinutes(0)).toBe(0);
    expect(estimatedWaitMinutes(3)).toBe(60);
  });
});
