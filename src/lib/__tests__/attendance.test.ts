import { describe, expect, it } from "vitest";
import { attendanceState, nextAction } from "../attendance";

describe("attendanceState", () => {
  it("no row → not_in", () => {
    expect(attendanceState(null)).toBe("not_in");
  });
  it("row without jam_masuk → not_in", () => {
    expect(attendanceState({ jam_masuk: null, jam_pulang: null })).toBe("not_in");
  });
  it("jam_masuk set, no jam_pulang → in", () => {
    expect(attendanceState({ jam_masuk: "08:00", jam_pulang: null })).toBe("in");
  });
  it("both set → done", () => {
    expect(attendanceState({ jam_masuk: "08:00", jam_pulang: "17:00" })).toBe("done");
  });
});

describe("nextAction", () => {
  it("not_in → clockIn", () => expect(nextAction("not_in")).toBe("clockIn"));
  it("in → clockOut", () => expect(nextAction("in")).toBe("clockOut"));
  it("done → null", () => expect(nextAction("done")).toBeNull());
});
